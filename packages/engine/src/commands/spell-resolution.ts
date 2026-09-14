/**
 * Casting a spell the engine has a definition for, and landing its effects.
 *
 * `castOrRelease` is the one path: the ordinary cast, the settlement of a
 * casting Counterspell was offered, and the release of a readied one all run
 * through it, because everything after the payment is identical and a second
 * copy of it would be a second place for a rules fix to miss.
 *
 * Everything mechanical is derived rather than supplied — the attack modifier
 * and save DC from the caster's sheet, the dice from the definition's scaling
 * and either the caster's level or the slot. A caller names a spell; it does
 * not get to say what the spell does.
 */

import { type CommandIdentity, commandOutcome, once } from '../idempotency.js';
import {
  type Ability,
  ABILITY_NAMES,
  type CharacterId,
  type ConditionName,
  type ContextRequest,
  err,
  needsContext,
  ok,
  type Result,
} from '@ie/shared';
import { type DamageComponent, rollAttack, rollAttackDamage } from '../attack.js';
import { bonusesFor } from '../bonuses.js';
import { modifierFor, spellAttackModifierWith, spellSaveDcWith } from '../character.js';
import { type D20TestResult, rollAbilityCheck, rollSavingThrow } from '../checks.js';
import { reasonsFor } from '../conditions.js';
import { type Duration, endOfNextTurn, resolveDuration, timeView } from '../duration.js';
import {
  applyEvent,
  type CommandStamp,
  type CreatureState,
  type GameEvent,
  type GameState,
} from '../events.js';
import { ONGOING_RECORD_VERSION } from '../ongoing-compatibility.js';
import { apartFromSource, type Point, type PointAnchoring } from '../positioning.js';
import { remaining } from '../resources.js';
import {
  type ConditionRider,
  conditionRiderOf,
  creatureTypesRead,
  definitionFor,
  type DelayedDamage,
  isCreatureType,
  onCaster,
  outcomeRidersOf,
  type OutcomeRiders,
  persists,
  ranged,
  riderDuration,
  riderDurations,
  scaledDiceFor,
  scaledFlatFor,
  type SpellDefinition,
  type SpellEffect,
  statedDamageType,
} from '../spell-definitions.js';
import { type CastingRoute } from '../spellcasting.js';
import { type CastingNumbers, castingSource } from '../spells.js';
import { armorClassOf, effectiveConditions, evadesHalfDamage, speedOf } from '../standing.js';
import {
  applySpellEffect,
  choosePayment,
  chooseRoute,
  type ConcentrationSaveSupply,
  deflectTriggeringAttack,
  nextCastingId,
  resolveCastWith,
  settlementEvents,
  type SpellEffectOptions,
  triggerRefusal,
} from './casting.js';
import { creatureOf, unknownCreature } from './command.js';
import { endConditionsOn, schedule } from './conditions.js';
import { grantTemporaryHpTo, healCreature } from './creatures.js';
import { dealSpellDamage } from './damage.js';
import { unsettledRefusal } from './holds.js';
import { ongoingSpellsOn, replacedCastings } from './ongoing.js';
import {
  defendingModes,
  effectCheckFrom,
  recordD20Test,
  rollSpellDice,
  savingSupport,
  withFlatAddend,
} from './rolls.js';
import {
  anchoringFor,
  areaTargets,
  castingIdentity,
  type CastSpellRequest,
  declaredFacts,
  foughtFor,
  type HeldCasting,
  namedTargets,
  placeOrigin,
  type SpellResolution,
  type SpellTargetOutcome,
} from './targeting.js';

/**
 * Cast a spell the engine has a definition for, and resolve it on its targets.
 *
 * Everything mechanical is derived, not supplied: the attack modifier and save
 * DC from the caster's sheet, the damage dice from the definition's scaling and
 * the caster's level or the slot, the condition and its duration and its
 * end-of-turn repeat save from the definition. A caller names a spell, some
 * targets, and a slot; it does not get to say what the spell does.
 *
 * It refuses what it can check and *reports* what it cannot. Access and
 * preparation, the slot, the action, range and Total Cover are checked; the
 * creature type a spell demands is not, because nothing in state carries one,
 * and that comes back in `unverified` rather than passing quietly.
 */
export function resolveSpell(
  state: GameState,
  casterId: CharacterId,
  request: CastSpellRequest,
  supply: ConcentrationSaveSupply,
): Result<SpellResolution> {
  return castOrRelease(state, casterId, request, supply, null);
}

/**
 * Let a declared casting take effect: spend the slot, run the spell.
 *
 * The other half of {@link resolveSpell} with `hold`. Everything the
 * declaration deliberately left undone happens here, and nothing the
 * declaration already did happens twice: the action stays spent, the
 * Concentration that was dropped stays dropped, and the slot — untouched until
 * now, because SRD Counterspell spares it — is expended at last.
 *
 * **The caller does not restate the spell.** Who it was aimed at, what level it
 * was cast at and which route supplied it were all settled and written down at
 * declaration. A settlement that took a fresh request could declare Fireball
 * at the goblins and settle it at the party, and no rule in the engine would
 * have noticed.
 */
export function resolveDeclaredCast(
  state: GameState,
  supply: ConcentrationSaveSupply,
  command: CommandIdentity = {},
): Result<SpellResolution> {
  // Before the pending casting is even read. A retry that arrives after the
  // first settlement finds no casting open, and reporting "nothing is being
  // cast" for a spell that has already landed is the exact confusion command
  // ids exist to prevent.
  return once(state, 'settle-cast', command, () => {
    const already = command.commandId === undefined ? null : commandOutcome(state, command.commandId);
    return {
      events: [],
      castingId: already?.castingId ?? '',
      outcomes: [],
      unverified: [],
    };
  }, (stamp) => {
    const pending = state.pendingCasting;
    if (pending === null) {
      return err('no_casting_pending', 'no casting is waiting to resolve');
    }

    const caster = creatureOf(state, pending.caster);
    if (caster === null) return unknownCreature(pending.caster);

    const definition = definitionFor(pending.spellId);
    if (definition === null) {
      return err(
        'no_definition',
        `${pending.spellId} has no executable definition; the casting cannot be settled`,
      );
    }

    // Re-derived rather than stored: the route is a fact about the caster's
    // sheet, which nothing between the declaration and here can have changed,
    // and a `CastingRoute` in the log would be a derived value pretending to be
    // history.
    const chosen = chooseRoute(caster.spellcasting, pending.spellId, pending.route);
    if (!chosen.ok) return chosen;

    const events: GameEvent[] = settlementEvents(pending, stamp);

    // What the caster stated at the declaration, read back off the record it
    // was written on. Normalised already — this is the same function that
    // normalised it, and it is idempotent precisely so that the settlement
    // does not have to spell the copy out a second time.
    const stated = statedFacts(pending);

    return resolveEffects(state, pending.caster, caster, definition, {
      castLevel: pending.level,
      route: chosen.value,
      targets: pending.targets,
      unverified: [...pending.unverified],
      supply,
      castingId: pending.castingId,
      events,
      // SRD Protection from Energy states its type for an effect that lands at
      // the cast, so the substitution has to reach the casting's own effects
      // and not only an area trigger's. Identity when nothing was stated,
      // which is every other spell in the book.
      effects: statedDamageType(definition.effects, pending.damageType),
      ...(pending.origin === undefined ? {} : { from: pending.origin }),
      // The third stated fact, read back off the record rather than from a
      // fresh request there is none of. A held Charm Person settles with the
      // Advantage its caster said it had.
      ...(pending.fought === undefined ? {} : { fought: pending.fought }),
      ...(persists(definition)
        ? {
            becomesOngoing: {
              spellId: definition.id,
              on: onCaster(definition)
                ? ('caster' as const)
                : pending.origin === undefined
                  ? ('targets' as const)
                  : ('point' as const),
              ...(definition.area === undefined ? {} : { fromArea: true as const }),
              ...((pending.origin ?? pending.area?.at) === undefined
                ? {}
                : { origin: (pending.origin ?? pending.area?.at)! }),
              ...(pending.area?.towards === undefined ? {} : { towards: pending.area.towards }),
              ...(pending.area?.anchoring === undefined
                ? {}
                : { anchoring: pending.area.anchoring }),
              // The designation and the stated type reach the record the area
              // detectors read, exactly as they do on the atomic path: without
              // them a held Spirit Guardians catches a creature its caster
              // spared and burns it with the type it did not choose.
              ...stated,
            },
          }
        : {}),
    });
  });
}

/**
 * {@link resolveSpell}, and the same thing for a spell already paid for.
 *
 * One function rather than two because everything after the payment is
 * identical — targets, range, cover, the save DC, the effects — and a second
 * copy of it would be a second place for a rules fix to miss.
 */
export function castOrRelease(
  state: GameState,
  casterId: CharacterId,
  request: CastSpellRequest,
  supply: ConcentrationSaveSupply,
  held: HeldCasting | null,
): Result<SpellResolution> {
  // **The duplicate check comes first, always.** A retry arrives at whatever
  // the world has become since its first run — the caster removed, the free
  // casting spent, the targets moved, a save the next boundary raised — and
  // every guard below reports that world instead of the fact that the command
  // already landed. This was the engine's one command whose identity was
  // established *after* half a dozen such refusals, and the caster leaving is
  // the case no amount of re-checking could rescue: the retry has no caster to
  // validate against and has to answer from the ledger alone.
  //
  // **The identity is the wrapper's, and it is established once.** Two
  // `identify` calls under one id would fingerprint two different objects —
  // this request, and the `CastCommand` derived from it — and refuse every
  // honest retry. So the stamp is made here and carried down to the event that
  // records the casting.
  return once(state, `resolve-spell:${casterId}`, castingIdentity(request), () => {
    // The casting it already made is the one to report; `nextCastingId` would
    // name the casting that *would* come next, which is a different spell.
    const already =
      request.commandId === undefined ? null : commandOutcome(state, request.commandId);
    return {
      events: [],
      castingId: already?.castingId ?? nextCastingId(state),
      outcomes: [],
      unverified: [],
    };
  }, (stamp) => {
    // A turn-boundary save outstanding means somebody may or may not still be
    // Paralyzed, and a damage roll or a D20 Test held open is an outcome nobody
    // has settled; casting into either would change the world underneath it.
    // See `unsettledRefusal`, which `activateSpell` reads too.
    const unsettled = unsettledRefusal(state, casterId);
    if (unsettled !== null) return unsettled;

    const caster = creatureOf(state, casterId);
    if (caster === null) return unknownCreature(casterId);

    const definition = definitionFor(request.spellId);
    if (definition === null) {
      return err(
        'no_definition',
        `${request.spellId} has no executable definition; the engine can look a spell up but only executes the ones it has been taught`,
      );
    }

    // Before anything is spent, and before a die is thrown. A Reaction is a
    // whole action-economy slot and usually a spell slot too, and handing both
    // over for a moment that never came is the expensive kind of wrong. A
    // released readied spell is exempt: its trigger was declared and paid for
    // when it was readied, and this is the release.
    //
    // **After the duplicate check, never before it.** The first Shield closed
    // the very attack that triggered it, so by the time a retry arrives the
    // trigger is gone — and reporting `no_trigger` for a casting that already
    // happened is the exact confusion command ids exist to prevent. A retry has
    // already returned its empty batch above and never reaches here.
    if (held === null) {
      const refused = triggerRefusal(state, casterId, definition, request);
      if (refused !== null) return refused;
    }

    // A casting already open is a moment the rules are in the middle of, and the
    // only thing that may happen in it is the Reaction that answers it. Anything
    // else would be a second spell begun before the first has taken effect.
    //
    // Checked against the trigger rather than against the spell, so this stays a
    // rule about *answering a casting* rather than a mention of Counterspell in
    // the middle of the casting path.
    //
    // **After the duplicate check, never before it** — the same trap the trigger
    // above fell into, and it bites harder here: a retried *declaration* looks
    // at a window its own first run opened, so an eager guard would report
    // `casting_pending` for the command that opened it. A retry has already
    // returned its empty batch above and never reaches here.
    const open = state.pendingCasting;
    if (open !== null && definition.trigger !== 'casting-a-spell') {
      return err(
        'casting_pending',
        `${open.caster} is midway through casting ${open.spell}; settle that casting before beginning another`,
      );
    }

    // **One window at a time, and the refusal is a value.** The exemption above
    // lets a Reaction *answer* the open casting; it does not let that Reaction
    // open a second one. A held Counterspell, or one aimed at a casting that is
    // itself an answer, is the nesting this deliberately does not build — "one
    // pending casting, no stack" — and the reducer's `CorruptLogError` on a
    // second `spell-declared` was the only thing saying so. An exception is
    // reserved for programmer error; a rules refusal is something the DM
    // narrates around.
    if (open !== null && definition.trigger === 'casting-a-spell') {
      const answered = definitionFor(open.spellId);
      if (request.hold === true || answered?.trigger === 'casting-a-spell') {
        return err(
          'casting_pending',
          `${definition.name} may answer ${open.spell} but may not be held open beside it; one casting is open at a time and a Reaction to a Reaction is not nested`,
        );
      }
    }

    // SRD gives "until the end of your next turn" no meaning where there are no
    // turns, and `resolveDuration` refuses rather than inventing six seconds.
    // Asked here, before the slot and before the first die: the same
    // validate-before-rolling rule the rest of casting obeys, and the reason a
    // Color Spray outside combat costs its caster nothing at all.
    for (const lasts of riderDurations(definition)) {
      const pinned = resolveDuration(
        { elapsed: state.elapsed, combat: state.combat },
        riderDuration(lasts, casterId) as Duration,
      );
      if (!pinned.ok) return pinned;
    }

    // SRD Divine Smite is cast "immediately after hitting a target", so the
    // attack is the thing it needs and this command has none to give it.
    if (definition.effects.some((effect) => effect.kind === 'attack-damage')) {
      return err(
        'cast_on_a_hit',
        `${definition.name} is cast on an attack that has hit; settle the attack's damage with it instead`,
      );
    }

    // SRD: you cast what you know or have prepared, and nothing else.
    const chosen = chooseRoute(caster.spellcasting, request.spellId, request.source);
    if (!chosen.ok) return chosen;
    const route = chosen.value;

    const slotLevel = request.slotLevel ?? definition.level;
    const castLevel = Math.max(definition.level, slotLevel);
    // What this definition knowingly leaves out, reported on every casting so
    // the narrating layer can hand the rest to the DM rather than lose it.
    const unverified: string[] = [
      ...(definition.unmodelled ?? []).map((gap) => `${definition.name}: ${gap}`),
    ];
    const needs: ContextRequest[] = [];

    // — the three facts the caster states, and the engine will not guess ——————
    //
    // Validated here, before a slot or an action is spent, so a casting that
    // names an unknown creature or a damage type the spell never prints costs
    // nothing. Both are clauses transcribed from the book, and both refuse to be
    // used by a spell that does not print them — a field quietly ignored is a
    // caller who thinks they said something.
    const declared = declaredFacts(state, definition, request);
    if (!declared.ok) return declared;

    // — targets ————————————————————————————————————————————————————————————
    //
    // Two ways a spell finds its targets, and they do not mix. A named-target
    // spell is handed ids; an area spell is handed a place and works out for
    // itself who is standing in it.
    const reach = ranged(definition.range);
    let targets: readonly CharacterId[];

    // — the point it keeps ——————————————————————————————————————————————————
    //
    // Before the targets, because the targets are measured from it: SRD
    // Spiritual Weapon aims at "one creature within 5 feet of **the force**",
    // and the force has to be somewhere before that sentence has a meaning.
    let origin: Point | null = null;
    if (definition.origin !== undefined) {
      const placed = placeOrigin(state, casterId, definition, request.at, reach, needs);
      if (!placed.ok) return placed;
      origin = placed.value;
    }

    // Where a **persistent** area sits, kept exactly as `placeArea` resolved it.
    // The shape and its dimensions are printed and reconstruct themselves; the
    // point and the direction were decisions taken once, at this casting, and
    // nothing else in the engine remembers them.
    let area: {
      readonly at: Point;
      readonly towards?: Point;
      readonly anchoring?: PointAnchoring;
    } | null = null;

    if (definition.area !== undefined) {
      const resolved = areaTargets(state, casterId, definition, definition.area, request, reach);
      if (!resolved.ok) return resolved;
      targets = resolved.value;
      if (definition.areaTrigger !== undefined && request.at !== undefined) {
        area = {
          at: request.at,
          ...(request.towards === undefined ? {} : { towards: request.towards }),
          // `space` *is* the absence, so a casting that names it explicitly
          // serialises exactly as one that says nothing. Two records that mean
          // the same thing have to fold to the same bytes.
          //
          // Resolved the same way `placeArea` resolves it — request, then
          // definition, then `space` — because the record is what every later
          // trigger reads, and a footprint the spell declared must survive to
          // them rather than being re-derived from a request that said nothing.
          ...(anchoringFor(definition, request) === 'space'
            ? {}
            : { anchoring: anchoringFor(definition, request) }),
        };
      }
    } else {
      const named = namedTargets(state, casterId, definition, request, castLevel, reach, needs, origin);
      if (!named.ok) return named;
      targets = named.value;
    }

    // What the targets **are**, where the spell answers differently by type.
    // Asked here, with the targets settled and before anything is spent, so a
    // Blight aimed at a creature nobody has typed costs its caster nothing —
    // and joins the same list the position and sight requests use, because a
    // caller fixing a thin record should be told everything that is thin
    // rather than one fact at a time.
    needs.push(...creatureTypeNeeds(state, definition, definition.effects, targets));

    if (needs.length > 0) {
      return needsContext(
        'needs_context',
        `${definition.name} cannot be resolved until ${needs.length === 1 ? 'a fact is' : `${needs.length} facts are`} established: ${needs.map((n) => n.need).join('; ')}`,
        needs,
      );
    }

    return resolveOnTargets(state, casterId, caster, definition, request, {
      castLevel,
      route,
      targets,
      unverified,
      supply,
      held,
      origin,
      area,
      stamp,
    });
  });
}

/**
 * Pay for the casting and apply its effects to the targets already settled.
 *
 * Split out from `resolveSpell` when areas arrived: how a spell finds its
 * targets and what it then does to them are two questions, and only the first
 * of them cares whether the spell fills a Cone or was aimed at a goblin.
 */
function resolveOnTargets(
  state: GameState,
  casterId: CharacterId,
  caster: CreatureState,
  definition: SpellDefinition,
  request: CastSpellRequest,
  context: {
    readonly castLevel: number;
    readonly route: CastingRoute;
    readonly targets: readonly CharacterId[];
    readonly unverified: string[];
    readonly supply: ConcentrationSaveSupply;
    /** Set when the casting was paid for earlier — a readied spell. */
    readonly held: HeldCasting | null;
    /** The point this casting keeps, for a spell that holds one. */
    readonly origin: Point | null;
    /** Where a persistent area sits, for a spell that leaves one behind. */
    readonly area: {
      readonly at: Point;
      readonly towards?: Point;
      readonly anchoring?: PointAnchoring;
    } | null;
    /** The identity the wrapper established, stamped on the casting's event. */
    readonly stamp: CommandStamp | null;
  },
): Result<SpellResolution> {
  const { castLevel, route, targets, unverified, supply, held, origin, area, stamp } = context;

  // Normalised here, once, and read by both paths out of this file: the
  // ongoing record an atomic casting writes, and the declaration a held one
  // writes for its own settlement to read back.
  const stated = statedFacts(request);

  // The third stated fact, normalised beside them and **not through them**,
  // for two reasons that both matter. `statedFacts` also feeds the ongoing
  // record, and no later sentence of any of the five spells re-rolls the save,
  // so keeping this there would be a field nothing reads. And it elides an
  // empty list, which this must never do: see `foughtFor`.
  const fought = foughtFor(request);

  const ongoingWith = (): OngoingRecordPlan => ({
    spellId: definition.id,
    // **Three answers, stated rather than inferred.** A Range: Self spell is
    // on its caster; a casting that holds a point is on the point and so on
    // nobody; everything else is on whoever it actually caught.
    on: onCaster(definition) ? 'caster' : origin === null ? 'targets' : 'point',
    ...(definition.area === undefined ? {} : { fromArea: true as const }),
    ...(origin === null && area === null ? {} : { origin: origin ?? area!.at }),
    ...(area?.towards === undefined ? {} : { towards: area.towards }),
    ...(area?.anchoring === undefined ? {} : { anchoring: area.anchoring }),
    // Two facts the caster stated at the casting, kept because every later
    // sentence of the spell reads them and neither can be recovered from
    // anything else. **A carried area records no position**: `caster` and the
    // definition's `origin: 'self'` already say where it is.
    ...stated,
  });

  /**
   * The effects, using the type this casting named.
   *
   * Spirit Guardians' stated type reached only the *area trigger*, because
   * that is where its damage is and its own `effects` list is empty. SRD
   * Protection from Energy states its type for an effect that lands at the
   * cast — "Resistance to one damage type of your choice" — so the same
   * substitution has to happen here, through the same function, rather than a
   * second reading of the same field.
   *
   * Identity when nothing was stated, which is every other spell in the book.
   */
  const running = statedDamageType(definition.effects, request.damageType);

  // — paying for it ——————————————————————————————————————————————————————
  //
  // A free casting from a feat spends its own pool; anything else goes through
  // the ordinary casting command, which owns slots, the action, and the
  // Concentration that starts or is replaced.
  const events: GameEvent[] = [];

  // SRD Ready: "you cast it as normal (expending any resources used to cast
  // it) but hold its energy." The expending happened when it was readied, so
  // a release skips the whole of it — including the action, which the Ready
  // itself was.
  // SRD Ready: "you cast it as normal (**expending any resources used to cast
  // it**) but hold its energy." The slot went when the spell was readied, so a
  // release has no unspent cost for Counterspell's "the slot isn't expended"
  // to spare, and there is no window to open here. `ReleaseCommand` has no
  // `hold` to ask for one, which is where that rule is actually enforced — a
  // runtime guard here would be unreachable code claiming to be a rule.
  if (held !== null) {
    return resolveEffects(state, casterId, caster, definition, {
      castLevel,
      route,
      targets,
      unverified,
      supply,
      castingId: held.castingId,
      events,
      effects: running,
      ...(origin === null ? {} : { from: origin }),
      ...(fought === undefined ? {} : { fought }),
      // A released spell leaves the same thing running that a cast one does.
      // This was the one resolution path of three that wrote no record, so a
      // readied Bless was running, concentrated on, and invisible to Dispel
      // Magic.
      ...(persists(definition) ? { becomesOngoing: ongoingWith() } : {}),
    });
  }

  const payment = choosePayment(definition, route, request);
  if (!payment.ok) return payment;
  const freePool = payment.value;

  // The DC a later examiner rolls against, fixed now. `route.ability` is the
  // *chosen* source's, so a Sage Fighter's Minor Illusion is seen through at
  // the feat's DC rather than at a class's.
  const offered = effectCheckFrom(
    definition.check,
    definition.name,
    spellSaveDcWith(caster.sheet, route.ability),
  );

  const castingId = nextCastingId(state);

  if (freePool !== null) {
    if (remaining(caster.resources, freePool) < 1) {
      return err(
        'no_free_casting',
        `${casterId} has used the free casting of ${definition.name} and must spend a slot`,
      );
    }
    events.push({ type: 'resource-spent', id: casterId, key: freePool, amount: 1 });
  }

  // The identity is the wrapper's: `castOrRelease` established it over the
  // request the caller actually sent, and a second `identify` here would
  // fingerprint this derived command instead and refuse every honest retry.
  const cast = resolveCastWith(
    state,
    casterId,
    {
      spell: definition.name,
      level: definition.level,
      concentration: definition.concentration,
      castingTime: definition.castingTime,
      ...(freePool !== null || definition.level === 0
        ? { slotless: definition.level === 0 ? ('cantrip' as const) : ('special-ability' as const) }
        : {
            slotLevel: castLevel,
            ...(request.slotKind === undefined ? {} : { slotKind: request.slotKind }),
          }),
      route: route.kind === 'granted' ? route.grant.source : `class:${route.classId}`,
      ...(request.slotless === undefined ? {} : { slotless: request.slotless }),
      // A span of seconds, or a moment in the turn order. A definition carries
      // one or the other: Shield's "until the start of your next turn" is not
      // six seconds, and `resolveDuration` refuses to pretend otherwise where
      // there are no turns to anchor to.
      ...(definition.durationSeconds !== undefined
        ? { duration: { kind: 'seconds' as const, seconds: definition.durationSeconds } }
        : definition.durationUntil === undefined
          ? {}
          : { duration: riderDuration(definition.durationUntil, casterId)! }),
      // No `commandId`: the identity was established above and travels as the
      // stamp. Repeating it here would be a second name for one command.
      // The window, and everything settlement will need to finish the job
      // without the caller getting to restate what the spell was aimed at —
      // the space it appears in included, for a spell that holds one.
      ...(request.hold === true
        ? {
            hold: {
              spellId: request.spellId,
              targets,
              unverified,
              ...(origin === null ? {} : { origin }),
              ...(area === null ? {} : { area }),
              // The same three stated facts, from the same normalisation the
              // atomic path uses. A casting held open for a Counterspell is
              // still the casting its caster described, and the settlement has
              // no request to read them off.
              //
              // `fought` is normalised by `foughtFor` rather than by
              // `statedFacts` — see where it is bound above.
              ...stated,
              ...(fought === undefined ? {} : { fought }),
            },
          }
        : {}),
      ...(offered === undefined ? {} : { check: offered }),
    },
    stamp,
  );
  if (!cast.ok) return cast;

  // SRD Mage Hand: "The hand vanishes ... if you cast this spell again."
  // **After the duplicate check**, so a retried casting does not end the
  // casting its own first run created — the same trap the trigger guard and
  // the pending-casting guard both sprang before it, and the third instance
  // of the rule that a retry must never look at the world it made.
  events.push(...replacedCastings(state, casterId, definition));
  events.push(...cast.value);

  // Declared and held open. The action is spent, any Concentration the caster
  // was holding is gone, and the slot is not — which is exactly the state SRD
  // Counterspell describes and the reason the effects are not run here.
  if (request.hold === true) {
    return ok({ events, castingId, outcomes: [], unverified });
  }

  const resolved = resolveEffects(state, casterId, caster, definition, {
    castLevel,
    route,
    targets,
    unverified,
    supply,
    castingId,
    events,
    effects: running,
    ...(origin === null ? {} : { from: origin }),
    ...(fought === undefined ? {} : { fought }),
    ...(persists(definition) ? { becomesOngoing: ongoingWith() } : {}),
  });
  if (!resolved.ok) return resolved;

  // The spell has landed; now the attack it answered is re-measured against
  // what it did. Nothing for any spell that is not a Reaction to a hit.
  const deflected = deflectTriggeringAttack(state, casterId, definition, resolved.value.events);
  if (deflected.length === 0) return resolved;

  return ok({ ...resolved.value, events: [...resolved.value.events, ...deflected] });
}

/**
 * What a spell does, once it has been paid for.
 *
 * Split from the payment above it for exactly one reason: SRD Ready pays on
 * one turn and resolves on another, and everything from here down is the same
 * either way. Nothing else about the two halves differs, which is why they are
 * one function called twice rather than two functions kept in step by hand.
 */
/**
 * The `damage-scheduled` event a delayed hit needs, or nothing.
 *
 * SRD writes the moment as "at the end of its next turn" — anchored to the
 * **target**, which is why this cannot reuse `riderDuration`'s caster-anchored
 * pair. `endOfNextTurn` already encodes the asymmetry that makes it right: said
 * on the target's own turn, the end of their *next* turn is two turn-endings
 * away, not one.
 *
 * Outside combat there are no turns for it to be the end of, so nothing is
 * scheduled and the caller is told. Refusing the whole casting would be worse
 * — Acid Arrow is perfectly legal at a fleeing target nobody has rolled
 * Initiative against, and its first 4d4 lands either way.
 */
function scheduleDelayed(
  state: GameState,
  target: CharacterId,
  delayed: DelayedDamage,
  context: {
    readonly casterId: CharacterId;
    readonly definition: SpellDefinition;
    readonly castingId: string;
    readonly castLevel: number;
    readonly casterLevel: number;
    readonly unverified: string[];
  },
): GameEvent | null {
  const { casterId, definition, castingId, castLevel, casterLevel, unverified } = context;

  const deadline = resolveDuration(timeView(state), endOfNextTurn(target));
  if (!deadline.ok) {
    unverified.push(
      `${definition.name} owes ${target} a second hit at the end of their next turn, and there are no turns outside combat; it was not scheduled`,
    );
    return null;
  }

  return {
    type: 'damage-scheduled',
    schedule: {
      target,
      by: casterId,
      deadline: deadline.value,
      notation: scaledDiceFor(delayed.damage, definition.level, casterLevel, castLevel),
      damageType: delayed.damageType,
      // Through the canonical encoder, not by hand: `castingIdOf` reads this
      // back to find the casting, and a second spelling of the link is a
      // second place for it to drift out of step with the reader.
      source: castingSource(definition.name, castingId),
      label: `${definition.name} (delayed)`,
    },
  };
}

/**
 * The creature types a casting has to know, and a request for each it does not.
 *
 * SRD singles a type out three times — Blight's Plant, Shatter's Construct,
 * Divine Smite's Fiend or Undead — and every one of them decides an outcome
 * the engine is about to compute. A creature nobody has typed is a **thin
 * record**, not a creature of some other type, so the answer is the request
 * targeting has always raised rather than the default branch taken quietly.
 * That is the whole of the three-valued discipline, and taking the default is
 * the easiest thing in this rule to get wrong: nothing downstream would ever
 * look different.
 *
 * Raised over every target and every effect **before the first die**, so a
 * casting that has to ask costs nothing — not a slot, not an action, and not a
 * turn of the generator. Asking after the first target had already rolled
 * would be the "validate before rolling" rule broken in its usual way: the
 * refusal arrives after it has moved authoritative state.
 */
function creatureTypeNeeds(
  state: GameState,
  definition: SpellDefinition,
  effects: readonly SpellEffect[],
  targets: readonly CharacterId[],
): readonly ContextRequest[] {
  const wanted = [...new Set(effects.flatMap(creatureTypesRead))];
  if (wanted.length === 0) return [];

  const asked: ContextRequest[] = [];
  for (const target of targets) {
    const creature = state.creatures[target];
    // A creature the casting cannot find is somebody else's refusal; this one
    // is only about a record that exists and does not say what it is.
    if (creature === undefined || creature.creatureType !== null) continue;
    asked.push({
      kind: 'creature-type',
      subject: target,
      need: `what kind of creature ${target} is`,
      because: `${definition.name} resolves differently against ${wanted.join(' or ')}`,
      satisfyWith: `declareCreatureType(${target}, …), or a creatureType when the creature is added`,
    });
  }
  return asked;
}

/**
 * The `applySpellEffect` options one condition rider asks for.
 *
 * Four effect kinds impose a condition — an `attack` on a hit, a `save-damage`
 * or a `save` on a failure, and a `condition` with nothing rolled at all — and
 * before this there were three near-identical blocks translating a rider into
 * options, each reading a different subset of the fields. That was an accident
 * of the order the spells were written in: an escape check reached two of the
 * three, `outlivesCasting` reached one. One translation means a rider's field
 * works wherever the rider does.
 *
 * `held` is the other half a caller still does for itself, because it is not
 * an option: `outlivesCasting` keeps the target out of `OngoingSpell.on`, and
 * the branch that knows whether the target was affected at all is the one that
 * decides to add them.
 *
 * **`repeats` is here too, and its ability and DC are the host's.** SRD writes
 * "the target repeats **the** save" — the one the spell already asked for — so
 * a rider that named its own would be a second place for one sentence to go
 * wrong. `saveAbility` is null for a host that rolled none, and a rider on
 * such a host has no save to repeat; `checkSpellDefinition` refuses that
 * combination at authoring, so this reads a value the validator has already
 * rejected rather than stating a rule of its own.
 */
function riderOptions(
  rider: ConditionRider,
  context: {
    readonly castingId: string;
    readonly spell: string;
    readonly casterId: CharacterId;
    readonly saveDc: number;
    /** Who the rider landed on, for a repeat save anchored to their turns. */
    readonly target: CharacterId;
    /** The ability the host rolled its saving throw with, or null for none. */
    readonly saveAbility: Ability | null;
  },
): SpellEffectOptions {
  const escape = effectCheckFrom(rider.check, context.spell, context.saveDc);
  const duration = riderDuration(rider.lasts, context.casterId);
  const ability = context.saveAbility;
  const repeats =
    rider.repeats === undefined || ability === null
      ? undefined
      : {
          at: rider.repeats.at,
          of: context.target,
          ability,
          dc: context.saveDc,
          onSuccess: rider.repeats.onSuccess,
          label: `${ABILITY_NAMES[ability]} save vs ${context.spell}`,
        };
  return {
    casting: { castingId: context.castingId, spell: context.spell },
    ...(rider.outlivesCasting === true ? { unowned: true as const } : {}),
    ...(escape === undefined ? {} : { check: escape }),
    ...(duration === undefined ? {} : { duration }),
    ...(repeats === undefined ? {} : { repeatSave: repeats }),
  };
}

/**
 * Everything one settled outcome carries with it, applied in one place.
 *
 * Three host branches used to do this inline and each knew a different subset:
 * the attack's condition block and the saving throw's were near-copies, the
 * `save` branch built its repeat save by hand, and nothing anywhere applied a
 * *grant* that a roll had already settled. That is the drift IE-001 removed
 * once for `riderOptions`, applied to the whole of what an outcome carries.
 *
 * **The branch is the host's and never this function's.** A caller reaches
 * here having already decided that the affirmative outcome happened — the
 * attack hit, the save failed — so there is no success branch, no miss branch
 * and no predicate. That is the invariant the whole rider design rests on, and
 * what makes it hold is that there is nowhere here for one to be written.
 *
 * **Order is fixed: conditions, then modifiers, then delayed.** It is
 * observable in the log and nowhere else, so it is decided once rather than by
 * whichever branch a reader happens to be looking at.
 *
 * **A rider rolls nothing.** The only die below this line is the delayed hit's,
 * and that one is *scheduled* rather than thrown — the generator does not move.
 * That is what makes a rider a leaf rather than a second resolution hiding
 * inside the first.
 */
function applyRiders(
  state: GameState,
  target: CharacterId,
  riders: OutcomeRiders,
  context: {
    readonly definition: SpellDefinition;
    readonly castingId: string;
    readonly casterId: CharacterId;
    readonly saveDc: number;
    readonly castLevel: number;
    readonly casterLevel: number;
    readonly unverified: string[];
    /** Whom the casting is holding something on, for `OngoingSpell.on`. */
    readonly held: Set<CharacterId>;
    /** The ability the host rolled its saving throw with, or null for none. */
    readonly saveAbility: Ability | null;
  },
): Result<{
  readonly events: readonly GameEvent[];
  readonly conditions: readonly ConditionName[];
}> {
  const { definition, castingId, casterId, saveDc, held } = context;
  const source = castingSource(definition.name, castingId);
  const events: GameEvent[] = [];
  const conditions: ConditionName[] = [];
  let current = state;

  for (const rider of riders.conditions ?? []) {
    // A condition the casting causes and does not keep is recorded under the
    // spell's bare name, linked to nothing that could later take it away — so
    // it does not put the casting *on* the target either.
    if (rider.outlivesCasting !== true) held.add(target);
    const landed = applySpellEffect(
      current,
      target,
      rider.name,
      casterId,
      riderOptions(rider, {
        castingId,
        spell: definition.name,
        casterId,
        saveDc,
        target,
        saveAbility: context.saveAbility,
      }),
    );
    if (!landed.ok) return landed;
    events.push(...landed.value);
    current = landed.value.reduce(applyEvent, current);
    conditions.push(rider.name);
  }

  for (const modifier of riders.modifiers ?? []) {
    // A grant is always the casting's, so every door that ends the spell — a
    // broken Concentration, the deadline, a dispel, the caster leaving — ends
    // it too, through machinery that already existed. There is no
    // `outlivesCasting` here: what a rider may say instead is `lasts`, a
    // deadline of its own that ends the grant **sooner** than the casting,
    // which is what `EffectTarget.grants` was built for and what an
    // Instantaneous host has no alternative to.
    held.add(target);
    const granted: GameEvent =
      modifier.kind === 'bonus'
        ? {
            type: 'bonus-applied',
            id: target,
            bonus: {
              source,
              bonus: { ...modifier.bonus, source: definition.name },
              applies: modifier.applies,
              direction: modifier.direction,
            },
          }
        : modifier.kind === 'mode'
          ? {
              type: 'roll-modifier-granted',
              id: target,
              modifier: { source, modifier: modifier.modifier },
            }
          : {
              type: 'speed-modifier-granted',
              id: target,
              modifier: {
                source,
                change: modifier.change,
                ...(modifier.feet === undefined ? {} : { feet: modifier.feet }),
              },
            };
    events.push(granted);
    current = applyEvent(current, granted);

    // **A deadline on what this source granted here, and on nothing else.**
    // SRD Ray of Frost: "until the start of your next turn", on a cantrip
    // whose casting is over the instant it resolves — so `grants` is the only
    // `EffectTarget` member that could ever take the reduction back. It names
    // the source rather than the casting, so it ends what this casting hung on
    // *this* creature and leaves what it hung on anybody else alone.
    //
    // Scheduled after the grant, because the deadline is only meaningful once
    // there is something to end; and the duration is `resolveDuration`'s to
    // refuse, which `riderDurations` has already asked before a die was thrown.
    const lasts = modifier.kind === 'speed-change' ? modifier.lasts : undefined;
    const duration = riderDuration(lasts, casterId);
    if (duration !== undefined) {
      const timer = schedule(current, { kind: 'grants', on: target, source }, duration);
      if (!timer.ok) return timer;
      events.push(timer.value);
      current = applyEvent(current, timer.value);
    }
  }

  if (riders.delayed !== undefined) {
    const scheduled = scheduleDelayed(current, target, riders.delayed, {
      casterId,
      definition,
      castingId,
      castLevel: context.castLevel,
      casterLevel: context.casterLevel,
      unverified: context.unverified,
    });
    if (scheduled !== null) {
      events.push(scheduled);
      current = applyEvent(current, scheduled);
    }
  }

  return ok({ events, conditions });
}

/**
 * Everything a per-kind resolver reads, gathered once before the loop.
 *
 * `resolveEffects` was one function with a branch per effect kind, and every
 * branch reached the same dozen bindings out of the enclosing scope. Naming
 * them once is what lets each kind be its own function without any of them
 * growing a parameter list of its own — and what makes the *difference*
 * between two kinds visible, because a resolver destructures exactly what its
 * rule reads and nothing else.
 *
 * **The three mutable members are mutable on purpose.** `events`, `outcomes`
 * and `held` are the resolution’s running record, appended to by whichever
 * kind is being resolved and read afterwards by the `spell-ongoing` record and
 * the return; `unverified` is the same thing for what the casting could not
 * check. They are shared arrays rather than returned values because that is
 * exactly what they were as closed-over locals, and a split that changed it
 * would be a behaviour change wearing a refactor’s clothes.
 *
 * **The world is not in here.** It is threaded through the loop instead — each
 * resolver takes the state its predecessors left and returns the state it
 * leaves — because the order effects are applied in is the loop’s business and
 * a mutable `current` on a shared object would hide it.
 */
interface EffectContext {
  readonly casterId: CharacterId;
  /** Null when the casting has outlived its caster. */
  readonly caster: CreatureState | null;
  /** The caster’s sheet, loud rather than absent when there is none. */
  readonly casterSheet: () => CreatureState;
  readonly definition: SpellDefinition;
  readonly castLevel: number;
  /** Null for a later use, which rolls with {@link EffectContext.numbers}. */
  readonly route: CastingRoute | null;
  /** The numbers this casting was made with, pinned at the cast. */
  readonly numbers: CastingNumbers;
  readonly attackModifier: number;
  readonly saveDc: number;
  readonly supply: ConcentrationSaveSupply;
  readonly castingId: string;
  /** How the log reads, when an activation wants its own wording. */
  readonly label: string;
  /** Where the spell acts **from**, when that is not the caster’s own space. */
  readonly from?: Point;
  /**
   * Which creatures the caster or their allies are fighting, where the spell
   * asks. Absent for every spell that does not print the clause; **empty where
   * the caster answered "none of them"**, which is not the same thing.
   */
  readonly fought?: readonly CharacterId[];
  /** What the casting could not check, appended to as it resolves. */
  readonly unverified: string[];
  /** The batch being built. Appended to by every resolver. */
  readonly events: GameEvent[];
  /** What the casting did, target by target. */
  readonly outcomes: SpellTargetOutcome[];
  /** Whom this casting has left something of its own on — see `landedOn`. */
  readonly held: Set<CharacterId>;
}

/** One arm of the effect union, by its `kind`. */
type EffectOfKind<K extends SpellEffect['kind']> = Extract<SpellEffect, { kind: K }>;

/**
 * A spell attack roll, the damage a hit deals, and the riders it carries.
 *
 * The longest of the thirteen because it is three resolutions in one: the
 * attack, the miss branch SRD Acid Arrow prints, and the hit.
 */
function resolveAttackEffect(
  ctx: EffectContext,
  effect: EffectOfKind<'attack'>,
  target: CharacterId,
  world: GameState,
): Result<GameState> {
  const {
    casterId,
    caster,
    casterSheet,
    definition,
    castLevel,
    numbers,
    supply,
    castingId,
    label,
    unverified,
    events,
    outcomes,
    held,
    attackModifier,
    saveDc,
    from,
  } = ctx;
  let current = world;

  // **A spell attack is an attack roll.** SRD Dodge says "any attack
  // roll made against you" and Blur says "attack rolls against you";
  // neither says "with a weapon". This path never read the defender's
  // standing effects at all, so a Dodging target was easier to hit with
  // a Fire Bolt than with a dagger — the same gatherer the weapon attack
  // uses removes the fork rather than copying its version of it.
  const defending = defendingModes(current, casterId, target);
  unverified.push(...defending.unverified);

  const attack = rollAttack(supply.issuer, supply.rng, casterSheet().sheet, {
    weapon: null,
    targetAc: armorClassOf(current, target),
    modes: [...defending.modes, ...(supply.modes ?? [])],
    attackBonuses: [
      { source: `${definition.name} (spell attack)`, flat: attackModifier },
      // Bless is on the caster, not in the caller's head.
      ...bonusesFor((caster?.bonuses ?? []), 'attack'),
      ...(supply.bonuses ?? []),
    ],
    // A condition a feature has suppressed gives an attacker nothing:
    // SRD Aura of Courage says the condition "has no effect on that ally
    // while there", and being easier to hit is an effect.
    targetConditions: effectiveConditions(current, target),
    // Prone reads the distance, and a spell attack is measured the same
    // way a weapon's is — **from where the attack comes from**, which
    // for a casting that holds a point is that point rather than the
    // caster. Absent where nobody has placed them, so the rule gives no
    // answer rather than a guessed one.
    ...(apartFromSource(current, from, casterId, target) === null
      ? {}
      : { withinFiveFeet: apartFromSource(current, from, casterId, target)! <= 5 }),
  });
  if (!attack.ok) return attack;

  events.push({
    type: 'roll-recorded',
    who: casterId,
    label: `${label} attack`,
    natural: attack.value.roll.natural,
    total: attack.value.total,
    contributions: [{ source: 'spell attack', amount: attackModifier }],
    outcome: attack.value.hit ? 'hit' : 'miss',
  });

  if (!attack.value.hit) {
    // SRD Acid Arrow: "On a miss, the arrow splashes the target with
    // acid for half as much of the initial damage **only**." *Only* is
    // the whole of the branch: the riders are the hit's, and a miss owes
    // neither the condition nor the later hit. Halved before the
    // target's own defences, exactly as a made saving throw is —
    // "half the damage that would be dealt" is half of what the *spell*
    // deals, and Resistance then halves that again.
    if (effect.onMiss !== 'half') {
      outcomes.push({ target, attack: attack.value, affected: false });
      return ok(current);
    }

    const splash = rollSpellDice(
      supply,
      casterSheet().sheet,
      definition.name,
      effect.damageType,
      scaledDiceFor(effect.damage, definition.level, numbers.casterLevel, castLevel),
    );
    if (!splash.ok) return splash;

    const splashed = dealSpellDamage(
      current,
      target,
      withFlatAddend(
        splash.value,
        scaledFlatFor(effect.damage, definition.level, castLevel) +
          (effect.addSpellcastingModifier === true ? numbers.spellcastingModifier : 0),
      ).map((component) => ({ ...component, total: Math.floor(component.total / 2) })),
      definition.name,
      supply,
      { by: casterId },
    );
    if (!splashed.ok) return splashed;

    events.push(...splashed.value.events);
    current = splashed.value.events.reduce(applyEvent, current);
    outcomes.push({
      target,
      attack: attack.value,
      damage: splashed.value.amount,
      concentration: splashed.value.concentration,
      // The attack missed. A spell that still splashes has not *affected*
      // the target in the sense every other outcome uses the word —
      // the same answer `save-damage` gives a creature that saved and
      // took half anyway.
      affected: false,
    });
    return ok(current);
  }

  const dice = scaledDiceFor(effect.damage, definition.level, numbers.casterLevel, castLevel);
  // A critical doubles the dice, which is `rollAttackDamage`'s job, so
  // this one call keeps the weapon-shaped signature rather than going
  // through `rollSpellDice`.
  const rolled = rollAttackDamage(
    supply.issuer,
    supply.rng,
    casterSheet().sheet,
    {
      weapon: null,
      targetAc: armorClassOf(current, target),
      extraDamage: [{ source: definition.name, type: effect.damageType, dice }],
    },
    attack.value.critical,
  );
  if (!rolled.ok) return rolled;

  const hurt = dealSpellDamage(
    current,
    target,
    withFlatAddend(
      rolled.value.components.filter((c) => c.source === definition.name),
      // SRD Flame Blade: "3d6 **plus your spellcasting ability
      // modifier**" — the chosen route's, so a feat's version adds its
      // own. A flat addend printed beside the dice adds on top of it.
      scaledFlatFor(effect.damage, definition.level, castLevel) +
        (effect.addSpellcastingModifier === true
          ? numbers.spellcastingModifier
          : 0),
    ),
    definition.name,
    supply,
    { by: casterId, ...(attack.value.critical ? { critical: true } : {}) },
  );
  if (!hurt.ok) return hurt;

  events.push(...hurt.value.events);
  current = hurt.value.events.reduce(applyEvent, current);

  // SRD Vampiric Touch: "you regain Hit Points equal to **half the
  // amount of Necrotic damage dealt**." Half of what actually landed, so
  // a resistant target heals the caster for less — which is why it reads
  // the damage taken rather than the dice thrown. Rounding is the SRD's
  // usual: down, and a single point heals nothing.
  if (effect.healsCasterForHalf === true && hurt.value.amount > 0) {
    const back = Math.floor(hurt.value.amount / 2);
    if (back > 0) {
      const drained = healCreature(current, casterId, back);
      if (!drained.ok) return drained;
      events.push(...drained.value);
      current = drained.value.reduce(applyEvent, current);
    }
  }

  // SRD Ray of Sickness: "On a hit, the target takes 2d8 Poison damage
  // **and** has the Poisoned condition", and Acid Arrow's "and 2d4 Acid
  // damage at the end of its next turn". The attack roll settled it up
  // there and a miss already returned, so reaching here **is** the
  // affirmative outcome — which is why the riders need no branch of
  // their own. An attack rolls no saving throw, so nothing it hangs has
  // one to repeat.
  const riders = applyRiders(current, target, outcomeRidersOf(effect), {
    definition,
    castingId,
    casterId,
    saveDc,
    castLevel,
    casterLevel: numbers.casterLevel,
    unverified,
    held,
    saveAbility: null,
  });
  if (!riders.ok) return riders;
  events.push(...riders.value.events);
  current = riders.value.events.reduce(applyEvent, current);

  outcomes.push({
    target,
    attack: attack.value,
    damage: hurt.value.amount,
    concentration: hurt.value.concentration,
    ...(riders.value.conditions.length === 0
      ? {}
      : { conditions: riders.value.conditions }),
    affected: true,
  });
  return ok(current);
}

/**
 * Temporary Hit Points. Beside the hit points, never in them.
 */
function resolveTempHpEffect(
  ctx: EffectContext,
  effect: EffectOfKind<'temp-hp'>,
  target: CharacterId,
  world: GameState,
): Result<GameState> {
  const { casterSheet, definition, castLevel, numbers, supply, events, outcomes } = ctx;
  let current = world;

  const dice = scaledDiceFor(effect.amount, definition.level, numbers.casterLevel, castLevel);
  const rolled = rollSpellDice(supply, casterSheet().sheet, definition.name, 'temporary', dice);
  if (!rolled.ok) return rolled;

  const flat = scaledFlatFor(effect.amount, definition.level, castLevel);
  const modifier = effect.addSpellcastingModifier
    ? numbers.spellcastingModifier
    : 0;
  const amount = Math.max(
    0,
    rolled.value.reduce((sum, c) => sum + c.total, 0) + flat + modifier,
  );

  const granted = grantTemporaryHpTo(current, target, amount);
  if (!granted.ok) return granted;
  events.push(...granted.value);
  current = granted.value.reduce(applyEvent, current);
  outcomes.push({ target, temporaryHp: amount, affected: true });
  return ok(current);
}

/**
 * A named bonus later rolls will read. Bane saves first; Bless does not.
 */
function resolveBuffEffect(
  ctx: EffectContext,
  effect: EffectOfKind<'buff'>,
  target: CharacterId,
  victim: CreatureState,
  world: GameState,
): Result<GameState> {
  const { definition, supply, castingId, events, outcomes, held, saveDc } = ctx;
  let current = world;

  let save: D20TestResult | null = null;
  if (effect.ability !== undefined) {
    const support = savingSupport(current, target, victim, effect.ability, supply);
    const rolled = rollSavingThrow(supply.issuer, supply.rng, victim.sheet, effect.ability, {
      dc: saveDc,
      conditions: support.conditions,
      modes: support.modes,
      bonuses: support.bonuses,
    });
    if (!rolled.ok) return rolled;
    save = rolled.value;

    events.push(
      recordD20Test(
        target,
        `${ABILITY_NAMES[effect.ability]} save vs ${definition.name}`,
        save,
        save.success ? 'resisted' : 'affected',
      ),
    );

    if (save.success) {
      outcomes.push({ target, save, affected: false });
      return ok(current);
    }
  }

  // The casting is in the source, so ending the spell ends the bonus.
  held.add(target);
  events.push({
    type: 'bonus-applied',
    id: target,
    bonus: {
      source: castingSource(definition.name, castingId),
      bonus: { ...effect.bonus, source: definition.name },
      applies: effect.applies,
      direction: effect.direction,
    },
  });
  current = events.slice(-1).reduce(applyEvent, current);
  outcomes.push({
    target,
    ...(save === null ? {} : { save }),
    affected: true,
  });
  return ok(current);
}

/**
 * Advantage or Disadvantage for as long as the spell runs. Bane's
 * shape when the spell offers a save, Bless's when it does not — the
 * same fork the bonus above takes, because it is the same sentence
 * shape with presence in place of arithmetic.
 */
function resolveRollModeEffect(
  ctx: EffectContext,
  effect: EffectOfKind<'roll-mode'>,
  target: CharacterId,
  world: GameState,
): Result<GameState> {
  const { definition, castingId, events, outcomes, held } = ctx;
  let current = world;

  // **Nothing is resisted here**, and that is the effect rather than an
  // omission: Blur and Beacon of Hope ask nobody to save, and the
  // speculative `save` field that used to sit on this kind had no user
  // in the catalogue from the day it was written. A spell that *does*
  // make a roll first says so with a host, and hangs this as a
  // `modifiers` rider on the outcome — one roll, shared.
  //
  // The casting is in the source, so every door that ends the spell —
  // a broken Concentration, the minute running out, a dispel, the
  // caster leaving — ends this too, through machinery that already
  // existed rather than a lifecycle of its own.
  held.add(target);
  events.push({
    type: 'roll-modifier-granted',
    id: target,
    modifier: {
      source: castingSource(definition.name, castingId),
      modifier: effect.modifier,
    },
  });
  current = events.slice(-1).reduce(applyEvent, current);
  outcomes.push({ target, affected: true });
  return ok(current);
}

/**
 * A base Armour Class the spell supplies, in place of the one the
 * target would otherwise calculate. Nothing is rolled and nothing is
 * resisted: SRD Mage Armor asks for no save and touches a willing
 * creature.
 */
function resolveArmorClassEffect(
  ctx: EffectContext,
  effect: EffectOfKind<'armor-class'>,
  target: CharacterId,
  world: GameState,
): Result<GameState> {
  const { definition, castingId, events, outcomes, held } = ctx;
  let current = world;

  held.add(target);
  events.push({
    type: 'armor-class-granted',
    id: target,
    armorClass: {
      source: castingSource(definition.name, castingId),
      base: effect.base,
      plusAbility: effect.plusAbility,
      shieldAllowed: effect.shieldAllowed,
    },
  });
  current = events.slice(-1).reduce(applyEvent, current);
  // Reported after the grant, because the number is the comparison’s
  // answer rather than the definition’s: a Barbarian whose Unarmoured
  // Defense already beats 13 + Dexterity keeps their own calculation,
  // and the outcome should say what their Armour Class actually is.
  outcomes.push({ target, armorClass: armorClassOf(current, target), affected: true });
  return ok(current);
}

/**
 * Resistance, Immunity or Vulnerability, for as long as the spell runs.
 * SRD Stoneskin touches a willing creature and Protection from Energy
 * does the same, so nothing is rolled and nothing is resisted — the same
 * shape the Armour Class above takes, on the other half of what a
 * defence is.
 *
 * The casting is in the source, so `releaseCasting` ends it with the
 * spell; a `grants` timer is what could end it sooner, and no SRD spell
 * asks for one.
 */
function resolveDamageDefenseEffect(
  ctx: EffectContext,
  effect: EffectOfKind<'damage-defense'>,
  target: CharacterId,
  world: GameState,
): Result<GameState> {
  const { definition, castingId, events, outcomes, held } = ctx;
  let current = world;

  held.add(target);
  events.push({
    type: 'damage-defense-granted',
    id: target,
    defense: {
      source: castingSource(definition.name, castingId),
      damageTypes: effect.damageTypes,
      defense: effect.defense,
    },
  });
  current = events.slice(-1).reduce(applyEvent, current);
  outcomes.push({ target, affected: true });
  return ok(current);
}

/**
 * A Speed the spell changes, for as long as it runs. SRD Longstrider
 * touches a creature and asks nobody to save, so nothing is rolled and
 * nothing is resisted — the same shape the Armour Class and the
 * defence above take, on the third thing a spell hands out that is
 * not a roll.
 *
 * The casting is in the source, so `releaseCasting` ends it with the
 * spell; a `grants` timer is what could end it sooner, and the
 * standalone kind carries no deadline of its own because no SRD
 * sentence writes one without a roll to hang it on. A rider does —
 * see {@link applyRiders}.
 */
function resolveSpeedEffect(
  ctx: EffectContext,
  effect: EffectOfKind<'speed'>,
  target: CharacterId,
  world: GameState,
): Result<GameState> {
  const { definition, castingId, events, outcomes, held } = ctx;
  let current = world;

  held.add(target);
  events.push({
    type: 'speed-modifier-granted',
    id: target,
    modifier: {
      source: castingSource(definition.name, castingId),
      change: effect.change,
      ...(effect.feet === undefined ? {} : { feet: effect.feet }),
    },
  });
  current = events.slice(-1).reduce(applyEvent, current);
  // Reported after the grant, because the number is what the creature's
  // Speed actually *is* — a Longstrider on a Grappled creature adds ten
  // feet to a Speed the rules have already pinned at 0, and the outcome
  // should say 0 rather than what the definition asked for.
  outcomes.push({ target, speed: speedOf(current, target), affected: true });
  return ok(current);
}

/**
 * Hit points restored. No roll to beat and nothing to resist: healing is
 * not damage, and a target at full is a legal target who gains nothing.
 */
function resolveHealEffect(
  ctx: EffectContext,
  effect: EffectOfKind<'heal'>,
  target: CharacterId,
  victim: CreatureState,
  world: GameState,
): Result<GameState> {
  const { casterId, casterSheet, definition, castLevel, numbers, supply, events, outcomes } = ctx;
  let current = world;

  const dice = scaledDiceFor(effect.healing, definition.level, numbers.casterLevel, castLevel);
  const rolled = rollSpellDice(supply, casterSheet().sheet, definition.name, 'healing', dice);
  if (!rolled.ok) return rolled;

  // SRD: "2d8 plus your spellcasting ability modifier" — and it is the
  // *chosen route's* ability, so a feat's version heals by its own.
  const bonus = effect.addSpellcastingModifier ? numbers.spellcastingModifier : 0;
  const addend = scaledFlatFor(effect.healing, definition.level, castLevel);
  const amount = Math.max(
    0,
    rolled.value.reduce((sum, c) => sum + c.total, 0) + bonus + addend,
  );

  events.push({
    type: 'roll-recorded',
    who: casterId,
    label: `${definition.name} healing`,
    natural: 0,
    total: amount,
    contributions: [{ source: 'spellcasting modifier', amount: bonus }],
    outcome: 'healed',
  });

  // `healCreature` refuses a corpse and refuses nothing-at-all, and it
  // lifts exactly the unconsciousness that having no hit points caused.
  // The cap at the maximum is `heal`'s, in vitals, where it always was.
  const before = victim.vitals.hp;
  const healed = healCreature(current, target, Math.max(1, amount));
  if (!healed.ok) return healed;

  events.push(...healed.value);
  current = healed.value.reduce(applyEvent, current);
  outcomes.push({
    target,
    healed: (current.creatures[target]?.vitals.hp ?? before) - before,
    affected: true,
  });
  return ok(current);
}

/**
 * A saving throw that deals damage, with what a success buys stated.
 */
function resolveSaveDamageEffect(
  ctx: EffectContext,
  effect: EffectOfKind<'save-damage'>,
  target: CharacterId,
  victim: CreatureState,
  world: GameState,
): Result<GameState> {
  const {
    casterId,
    casterSheet,
    definition,
    castLevel,
    numbers,
    supply,
    castingId,
    unverified,
    events,
    outcomes,
    held,
    saveDc,
  } = ctx;
  let current = world;

  const support = savingSupport(current, target, victim, effect.ability, supply);
  // SRD singles a creature type out twice, and both sentences are about
  // this save: Blight's "A Plant creature automatically fails the save"
  // and Shatter's "A Construct has Disadvantage on the save". The type
  // is known — `creatureTypeNeeds` asked for it above, before a die —
  // so the only question left is which of the two the spell printed.
  const singled =
    effect.againstType !== undefined &&
    effect.againstType.types.some((named) =>
      isCreatureType(victim.creatureType, named),
    )
      ? effect.againstType.outcome
      : null;
  const save = rollSavingThrow(supply.issuer, supply.rng, victim.sheet, effect.ability, {
    dc: saveDc,
    conditions: support.conditions,
    // Presence, not arithmetic: it goes in as a named source and
    // `combineRollModes` decides, so a Construct that is somehow also
    // helped rolls a normal save rather than a net-negative one.
    modes: [
      ...support.modes,
      ...(singled === 'disadvantage'
        ? [{ source: `${definition.name} (${victim.creatureType})`, mode: 'disadvantage' as const }]
        : []),
    ],
    bonuses: support.bonuses,
    // The die is still thrown and recorded; the total is overridden, so
    // no bonus applied afterwards rescues it — the reading `checks.ts`
    // has taken for a condition's automatic failure since it was written.
    ...(singled === 'automatic-failure'
      ? {
          autoFail: `${definition.name}: a ${victim.creatureType} creature automatically fails the save`,
        }
      : {}),
  });
  if (!save.ok) return save;

  events.push(
    recordD20Test(
      target,
      `${ABILITY_NAMES[effect.ability]} save vs ${definition.name}`,
      save.value,
      save.value.success ? 'resisted' : 'affected',
    ),
  );

  // SRD Evasion: a successful Dexterity save against an effect that
  // would have halved the damage takes **none** of it, and a failed one
  // takes half. Read off the *target's* features, because it is a
  // defence rather than something the caster does.
  const evading = evadesHalfDamage(current, target, effect.ability, effect.onSuccess === 'half');

  // Nothing at all on a success means no damage roll either: the spell
  // did nothing, and rolling would move the generator for no reason.
  // Evasion reaches the same place from the other direction.
  if (save.value.success && (effect.onSuccess === 'none' || evading)) {
    outcomes.push({ target, save: save.value, damage: 0, affected: false });
    return ok(current);
  }

  // One save, and every damage type the spell names under it. Each
  // type rolls and scales separately; the save was already made once.
  const parts = [
    { damage: effect.damage, damageType: effect.damageType },
    ...(effect.plus ?? []),
  ];
  const rolledParts: DamageComponent[] = [];
  for (const part of parts) {
    const dice = scaledDiceFor(part.damage, definition.level, numbers.casterLevel, castLevel);
    const rolled = rollSpellDice(
      supply,
      casterSheet().sheet,
      definition.name,
      part.damageType,
      dice,
    );
    if (!rolled.ok) return rolled;
    rolledParts.push(
      ...withFlatAddend(
        rolled.value,
        scaledFlatFor(part.damage, definition.level, castLevel),
      ),
    );
  }

  // SRD: "The halved damage is equal to half the damage that would be
  // dealt on a failed save." Half of what the spell deals, therefore
  // *before* the target's own Resistance — which then halves again.
  // Without Evasion the success is halved; with it the *failure* is,
  // and the success took nothing at all above.
  const halve = evading ? !save.value.success : save.value.success;
  const components = halve
    ? rolledParts.map((c) => ({ ...c, total: Math.floor(c.total / 2) }))
    : rolledParts;

  const hurt = dealSpellDamage(
    current,
    target,
    components,
    definition.name,
    supply,
    { by: casterId },
  );
  if (!hurt.ok) return hurt;

  events.push(...hurt.value.events);
  current = hurt.value.events.reduce(applyEvent, current);

  // SRD Sunbeam: "takes 6d8 Radiant damage **and** has the Blinded
  // condition"; Vitriolic Sphere: "On a successful save, a creature
  // takes half the initial damage **only**." A failed save is the
  // affirmative outcome and the riders are all on it — a success buys
  // whatever `onSuccess` says about the *damage* and nothing else,
  // however much of it still landed.
  let imposed: readonly ConditionName[] = [];
  if (!save.value.success) {
    const riders = applyRiders(current, target, outcomeRidersOf(effect), {
      definition,
      castingId,
      casterId,
      saveDc,
      castLevel,
      casterLevel: numbers.casterLevel,
      unverified,
      held,
      // SRD Sunburst: "another Constitution saving throw" — the one this
      // host just rolled, which is why a repeat save names no ability of
      // its own.
      saveAbility: effect.ability,
    });
    if (!riders.ok) return riders;
    events.push(...riders.value.events);
    current = riders.value.events.reduce(applyEvent, current);
    imposed = riders.value.conditions;
  }

  outcomes.push({
    target,
    save: save.value,
    damage: hurt.value.amount,
    concentration: hurt.value.concentration,
    ...(imposed.length === 0 ? {} : { conditions: imposed }),
    affected: !save.value.success,
  });
  return ok(current);
}

/**
 * A saving throw, and whatever a failure carries.
 */
function resolveSaveEffect(
  ctx: EffectContext,
  effect: EffectOfKind<'save'>,
  target: CharacterId,
  victim: CreatureState,
  world: GameState,
): Result<GameState> {
  const {
    casterId,
    definition,
    castLevel,
    numbers,
    supply,
    castingId,
    unverified,
    events,
    outcomes,
    held,
    saveDc,
    fought,
  } = ctx;
  let current = world;

  // A saving throw, and a condition on a failure.
  const support = savingSupport(current, target, victim, effect.ability, supply);
  const save = rollSavingThrow(supply.issuer, supply.rng, victim.sheet, effect.ability, {
    dc: saveDc,
    conditions: support.conditions,
    // SRD Charm Person: "It does so with Advantage if you or your allies are
    // fighting **it**." The fact was stated at the casting and refused if it
    // was not — `declaredFacts` asked before a slot went — so the only
    // question left is whether the caster named *this* creature.
    //
    // **Per target, because that is who the sentence is about.** An upcast
    // Charm Person names several, and the goblin you are fighting and the
    // bystander you are not get different saves out of one casting.
    //
    // **Presence, not arithmetic.** It goes in as a named source and
    // `combineRollModes` decides, so a fought target who is also Restrained
    // rolls a normal save rather than a net-positive one, and `modeSources`
    // still says both effects were in play.
    modes: [
      ...support.modes,
      ...(effect.advantageIfFought === true && fought?.includes(target) === true
        ? [
            {
              source: `${definition.name} (you or your allies are fighting it)`,
              mode: 'advantage' as const,
            },
          ]
        : []),
    ],
    bonuses: support.bonuses,
  });
  if (!save.ok) return save;

  events.push(
    recordD20Test(
      target,
      `${ABILITY_NAMES[effect.ability]} save vs ${definition.name}`,
      save.value,
      save.value.success ? 'resisted' : 'affected',
    ),
  );

  if (save.value.success) {
    outcomes.push({ target, save: save.value, affected: false });
    return ok(current);
  }

  // `save` writes its first rider flat; `conditionRiderOf` is the one
  // place that knows, so from here the four kinds that impose a
  // condition are reading one shape — including the flat `repeats`,
  // which belongs to the saving throw this host just made rather than to
  // any one of the conditions the failure imposed.
  const landed = applyRiders(current, target, outcomeRidersOf(effect), {
    definition,
    castingId,
    casterId,
    saveDc,
    castLevel,
    casterLevel: numbers.casterLevel,
    unverified,
    held,
    saveAbility: effect.ability,
  });
  if (!landed.ok) return landed;

  events.push(...landed.value.events);
  current = landed.value.events.reduce(applyEvent, current);
  outcomes.push({
    target,
    save: save.value,
    conditions: landed.value.conditions,
    affected: true,
  });
  return ok(current);
}

/**
 * SRD Greater Invisibility: "A creature you touch has the Invisible
 * condition until the spell ends." The `save` branch above, minus the
 * roll — no die, no `roll-recorded`, and the generator does not move,
 * because the spell asked for nothing to be thrown.
 */
function resolveConditionEffect(
  ctx: EffectContext,
  effect: EffectOfKind<'condition'>,
  target: CharacterId,
  world: GameState,
): Result<GameState> {
  const { casterId, definition, castingId, events, outcomes, held, saveDc } = ctx;
  let current = world;

  // **Not a rider host**, because it has no outcome: there is no roll
  // whose affirmative branch anything could ride, so the rider *is* the
  // effect and there is exactly one of it. `conditionRiderOf` types that
  // as a non-empty list, which is why the first element is not a guess.
  const [rider] = conditionRiderOf(effect);
  const landed = applySpellEffect(
    current,
    target,
    rider.name,
    casterId,
    riderOptions(rider, {
      castingId,
      spell: definition.name,
      casterId,
      saveDc,
      target,
      saveAbility: null,
    }),
  );
  if (!landed.ok) return landed;

  events.push(...landed.value);
  current = landed.value.reduce(applyEvent, current);
  if (rider.outlivesCasting !== true) held.add(target);
  outcomes.push({ target, conditions: [rider.name], affected: true });
  return ok(current);
}

/**
 * SRD Lesser Restoration: "You touch a creature and end one condition on
 * it: Blinded, Deafened, Paralyzed, or Poisoned." The `condition` branch
 * above, inverted — and inverted is the only thing it shares, because a
 * removal has no rider: no deadline, no escape check, no repeat save, and
 * nothing for the casting to own. Nothing is rolled and the generator
 * does not move; the spell asked for nothing to be thrown.
 */
function resolveEndConditionEffect(
  ctx: EffectContext,
  effect: EffectOfKind<'end-condition'>,
  target: CharacterId,
  victim: CreatureState,
  world: GameState,
): Result<GameState> {
  const { events, outcomes } = ctx;
  let current = world;

  // **Ask what there is to remove, of the thing the removal acts on.**
  // `removeCondition` works over the instances, so the instances are what
  // decide whether anything happens. `conditions.conditions` is derived
  // from exactly those and agrees with this today — but `hasCondition`,
  // the other reader to hand, does **not**: it special-cases Exhaustion,
  // which is a level rather than an instance, so it would report a
  // removal for an Exhaustion that `removeCondition` could never take
  // away. No registered spell ends Exhaustion; that is a reason to write
  // the direct question down rather than to rely on the agreement.
  const present = effect.conditions.filter(
    (condition) => reasonsFor(victim.conditions, condition).length > 0,
  );

  // **Nothing to cure is not an error, and it is not an event either.**
  // The casting happened and the slot went; what the log must not carry
  // is a `condition-removed` for a condition that was never there, which
  // would be a record of something that did not happen.
  if (present.length === 0) {
    outcomes.push({ target, affected: false });
    return ok(current);
  }

  // One removal, shared with `useHealingTouch` — see `endConditionsOn`
  // for why the source is omitted and what that means.
  const lifted = endConditionsOn(target, present);
  events.push(...lifted);
  current = lifted.reduce(applyEvent, current);
  outcomes.push({ target, ended: present, affected: true });
  return ok(current);
}

/**
 * SRD Dispel Magic, against whatever is running on the target.
 *
 * **It takes no `effect`**, which is the shape of the spell rather than an
 * omission: every number Dispel Magic needs — the threshold, the DC, the
 * ability — is a fact the engine already holds, so the definition carries none
 * and there is nothing here to read off one.
 */
function resolveDispelEffect(
  ctx: EffectContext,
  target: CharacterId,
  world: GameState,
): Result<GameState> {
  const { casterId, casterSheet, definition, castLevel, route, supply, events, outcomes } = ctx;
  let current = world;

  // SRD Dispel Magic: "Any ongoing spell of level 3 or lower **on the
  // target** ends." What is on the target is live state, and before the
  // ongoing record the engine could not have answered it: a spell's
  // level lived in the log and on a concentrating caster, and neither is
  // a thing a later spell can ask about.
  const running = ongoingSpellsOn(current, target);
  if (running.length === 0) {
    outcomes.push({ target, affected: false });
    return ok(current);
  }

  for (const spell of running) {
    // SRD "Using a Higher-Level Spell Slot": "You automatically end a
    // spell on the target if the spell's level is equal to or less than
    // the level of the spell slot you use." Dispel Magic is level 3, so
    // the printed "level 3 or lower" is the same sentence read at the
    // spell's own level — one rule, not two.
    const automatic = spell.level <= castLevel;
    let rolled: D20TestResult | undefined;

    if (!automatic) {
      // "make an ability check using your spellcasting ability (DC 10
      // plus that spell's level)" — a bare ability check, no skill and
      // no proficiency, through the one calculator the engine has.
      const check = rollAbilityCheck(
        supply.issuer,
        supply.rng,
        casterSheet().sheet,
        route!.ability,
        {
          dc: 10 + spell.level,
          conditions: effectiveConditions(current, casterId),
          ...(supply.modes === undefined ? {} : { modes: supply.modes }),
          ...(supply.bonuses === undefined ? {} : { bonuses: supply.bonuses }),
        },
      );
      if (!check.ok) return check;

      events.push(
        recordD20Test(
          casterId,
          `${definition.name} vs ${spell.spell} (level ${spell.level})`,
          check.value,
          check.value.success ? 'dispelled' : 'held',
        ),
      );

      if (!check.value.success) {
        // A failed check changes nothing at all. The spell runs on, the
        // slot is still spent, and the log says which.
        outcomes.push({ target, check: check.value, affected: false });
        continue;
      }
      rolled = check.value;
    }

    // Whether the whole casting ends or only its hold on this creature
    // is the distinction SRD draws by letting Dispel Magic target "one
    // creature, object, or magical effect": a spell that is on this
    // creature and nobody else has nothing left to be, so it ends, while
    // one that caught three creatures loses only this one.
    const whole = spell.on.length <= 1;
    const ended: GameEvent = {
      type: 'spell-ended',
      castingId: spell.castingId,
      on: whole ? null : target,
      reason: 'dispelled',
    };
    events.push(ended);
    current = applyEvent(current, ended);

    outcomes.push({
      target,
      // Present only when the spell was high enough to need one, which
      // is the difference between the two halves of the SRD's sentence.
      ...(rolled === undefined ? {} : { check: rolled }),
      dispelled: spell.castingId,
      affected: true,
    });
  }
  return ok(current);
}

/**
 * SRD Counterspell: the save that decides whether a casting dissipates.
 */
function resolveInterruptCastingEffect(
  ctx: EffectContext,
  effect: EffectOfKind<'interrupt-casting'>,
  target: CharacterId,
  victim: CreatureState,
  world: GameState,
): Result<GameState> {
  const { casterId, definition, supply, events, outcomes, saveDc } = ctx;
  let current = world;

  // SRD Counterspell: "The creature makes a Constitution saving throw.
  // On a failed save, the spell dissipates with no effect."
  //
  // The window was proved open by the trigger before anything was spent.
  // It is read again here because the events emitted since — the
  // Counterspell's own casting — have been folded in, and reading the
  // stale copy would be reading a different game than the one being
  // changed.
  const open = current.pendingCasting;
  if (open === null) {
    return err(
      'nothing_to_interrupt',
      `${definition.name} found no casting in progress to interrupt`,
    );
  }

  const support = savingSupport(current, target, victim, effect.ability, supply);
  const save = rollSavingThrow(supply.issuer, supply.rng, victim.sheet, effect.ability, {
    dc: saveDc,
    conditions: support.conditions,
    modes: support.modes,
    bonuses: support.bonuses,
  });
  if (!save.ok) return save;

  events.push(
    recordD20Test(
      target,
      `${ABILITY_NAMES[effect.ability]} save vs ${definition.name}`,
      save.value,
      save.value.success ? 'resisted' : 'affected',
    ),
  );

  // A success buys the caster nothing beyond their spell going ahead —
  // the SRD states no other consequence, so neither does this.
  if (save.value.success) {
    outcomes.push({ target, save: save.value, affected: false });
    return ok(current);
  }

  const interrupted: GameEvent = {
    type: 'spell-interrupted',
    castingId: open.castingId,
    id: open.caster,
    by: casterId,
    reason: 'countered',
  };
  events.push(interrupted);
  current = applyEvent(current, interrupted);

  outcomes.push({
    target,
    save: save.value,
    affected: true,
    interrupted: open.castingId,
  });
  return ok(current);
}

/**
 * Which rule resolves this effect.
 *
 * The whole of the branching, in one place, over a union the compiler closes:
 * the `never` binding in the default is what makes a kind added to the union
 * and not to this switch a compile error rather than a wrong answer in a
 * fight. That guarantee is the reason the dispatch is a `switch` and not a
 * lookup table — a record keyed by `kind` would be satisfied by a partial one.
 */
function resolveOneEffect(
  ctx: EffectContext,
  effect: SpellEffect,
  target: CharacterId,
  victim: CreatureState,
  world: GameState,
): Result<GameState> {
  switch (effect.kind) {
    case 'attack':
      return resolveAttackEffect(ctx, effect, target, world);
    case 'temp-hp':
      return resolveTempHpEffect(ctx, effect, target, world);
    case 'buff':
      return resolveBuffEffect(ctx, effect, target, victim, world);
    case 'roll-mode':
      return resolveRollModeEffect(ctx, effect, target, world);
    case 'armor-class':
      return resolveArmorClassEffect(ctx, effect, target, world);
    case 'damage-defense':
      return resolveDamageDefenseEffect(ctx, effect, target, world);
    case 'speed':
      return resolveSpeedEffect(ctx, effect, target, world);
    case 'heal':
      return resolveHealEffect(ctx, effect, target, victim, world);
    case 'save-damage':
      return resolveSaveDamageEffect(ctx, effect, target, victim, world);
    case 'save':
      return resolveSaveEffect(ctx, effect, target, victim, world);
    case 'condition':
      return resolveConditionEffect(ctx, effect, target, world);
    case 'end-condition':
      return resolveEndConditionEffect(ctx, effect, target, victim, world);
    case 'dispel':
      return resolveDispelEffect(ctx, target, world);
    case 'interrupt-casting':
      return resolveInterruptCastingEffect(ctx, effect, target, victim, world);

    // An on-hit spell never reaches here: `resolveSpell` refuses one up
    // front, because the attack it rides on is not this command's to give.
    case 'attack-damage':
      return ok(world);

    default: {
      // A branch for every kind, and the `never` binding is what keeps that
      // true. Until now the last kind was an unguarded fall-through, so
      // an effect this chain had no rule for was read as a saving throw: it
      // took `effect.ability` off a definition that has none and rolled
      // against a DC of NaN. A definition and its resolver disagreeing is a
      // bug in this repo rather than a rules dispute, so it is loud — and,
      // more to the point, a merge that drops one of these branches now
      // fails to compile instead of failing in a fight.
      const unhandled: never = effect;
      throw new Error(
        `no spell-effect rule for ${(unhandled as SpellEffect).kind}; ` +
          'the definition and the resolver disagree',
      );
    }
  }
}

export function resolveEffects(
  state: GameState,
  casterId: CharacterId,
  /**
   * Null when the casting has outlived its caster.
   *
   * SRD Grease runs its minute whether or not the wizard does, and a save it
   * calls for afterwards is still owed. Only effects that read nothing off a
   * sheet can be resolved then, which is checked before this is called —
   * {@link casterSheet} is the accessor that says so out loud.
   */
  caster: CreatureState | null,
  definition: SpellDefinition,
  context: {
    readonly castLevel: number;
    /** Null for a later use, which rolls with {@link context.numbers}. */
    readonly route: CastingRoute | null;
    /** The numbers this casting was made with, for every use after the first. */
    readonly numbers?: CastingNumbers;
    readonly targets: readonly CharacterId[];
    readonly unverified: string[];
    readonly supply: ConcentrationSaveSupply;
    readonly castingId: string;
    readonly events: GameEvent[];
    /**
     * What to run, when it is not the spell's own effect list.
     *
     * SRD Vampiric Touch does the same thing on a later turn that it did on
     * the first, so the later turn runs a list the definition supplies rather
     * than a second resolver kept in step with this one by hand.
     */
    readonly effects?: readonly SpellEffect[];
    /** How the log reads, when an activation wants its own wording. */
    readonly label?: string;
    /**
     * Where the spell acts **from**, when that is not the caster's own space.
     *
     * The one seam Spiritual Weapon needed and the smallest it could be: the
     * roller, the attack modifier and the dice are all still the caster's, and
     * only the *spatial* questions move. SRD reads the force's adjacency, not
     * the Cleric's — "a creature within 5 feet of the force" — so the Prone
     * rule ("Advantage if the attacker is within 5 feet of you") is answered
     * from here too.
     *
     * Not a teleport and not a creature: nothing about the caster's position
     * changes, and there is no second actor. Absent means the caster acts from
     * where they stand, which is every other spell in the book.
     */
    readonly from?: Point;
    /**
     * Which creatures the caster or their allies are fighting.
     *
     * SRD Charm Person gives a target's save Advantage when they are, and the
     * engine neither holds the fact nor derives one — so it arrives here from
     * the casting that stated it, or from the pending record a held casting
     * wrote it on. It is read **per target**, inside the loop, because the
     * book asks it of the creature rather than of the casting; it reaches the
     * roll as a named `ModeSource` and never as a number, because Advantage
     * cancels rather than stacks.
     */
    readonly fought?: readonly CharacterId[];
    /**
     * Set when this casting leaves something running.
     *
     * Recorded **after** the effects rather than beside the slot, because what
     * a spell is *on* is not who it was aimed at: a target who saved against
     * Banishment is not banished, and a record claiming otherwise would let
     * Dispel Magic end a spell that was never on them.
     *
     * Absent for an activation, which acts through a record that already
     * exists rather than making a second one.
     */
    readonly becomesOngoing?: OngoingRecordPlan;
  },
): Result<SpellResolution> {
  const { castLevel, route, targets, unverified, supply, castingId, events } = context;
  const running = context.effects ?? definition.effects;
  const label = context.label ?? definition.name;

  /**
   * The caster's sheet, for the rolls that genuinely need one.
   *
   * A casting that outlives its caster keeps its *numbers* and loses its
   * *sheet*, and the two are not the same thing: a save DC is pinned, while
   * the dice a caster throws are thrown by a creature. Every effect that needs
   * this is refused before it gets here — `settleAreaEffects` checks, and a
   * test asserts no registered spell can reach it — so arriving here with no
   * caster is a programmer error rather than a rules dispute, and is loud.
   */
  const casterSheet = (): CreatureState => {
    if (caster === null) {
      throw new Error(
        `${definition.name} needs its caster's sheet to resolve and ${casterId} has left the game; ` +
          'the caller should have refused this effect rather than reaching here',
      );
    }
    return caster;
  };

  // — what it does ———————————————————————————————————————————————————————
  let current = events.reduce(applyEvent, state);
  const outcomes: SpellTargetOutcome[] = [];
  // Whom this casting has left something of its own on — see {@link landedOn}.
  const held = new Set<CharacterId>();
  const issuedBefore = supply.issuer.count;

  // **Derived once, at the casting, and read from the record ever after.**
  // The *chosen source's* ability, not the class's — a feat brings its own —
  // and a later use of the same casting takes the numbers it was made with
  // rather than asking a sheet that may have levelled since.
  const numbers: CastingNumbers = context.numbers ?? {
    attackModifier: spellAttackModifierWith(casterSheet().sheet, route!.ability),
    saveDc: spellSaveDcWith(casterSheet().sheet, route!.ability),
    spellcastingModifier: modifierFor(casterSheet().sheet, route!.ability),
    casterLevel: casterSheet().sheet.level,
  };

  // **Before the first die, and on every path into here.** `castOrRelease`
  // asks the same question earlier so an ordinary casting never reaches this
  // one; what arrives here instead is an area trigger settling a minute later,
  // a declared casting being settled, and an activation — each of which can
  // meet a creature nobody had typed when the spell was first cast. Asking
  // mid-loop would leave the generator advanced for the targets already
  // resolved, which is a refused operation that moved the world.
  const untyped = creatureTypeNeeds(state, definition, running, targets);
  if (untyped.length > 0) {
    return needsContext(
      'needs_context',
      `${label} cannot be resolved until ${untyped.length === 1 ? 'a fact is' : `${untyped.length} facts are`} established: ${untyped.map((n) => n.need).join('; ')}`,
      untyped,
    );
  }

  // Named once, for thirteen resolvers that used to read them out of this
  // function's scope. Nothing here is derived: every field is a binding the
  // branches already had, under the name they already had it under.
  const ctx: EffectContext = {
    casterId,
    caster,
    casterSheet,
    definition,
    castLevel,
    route,
    numbers,
    attackModifier: numbers.attackModifier,
    saveDc: numbers.saveDc,
    supply,
    castingId,
    label,
    unverified,
    events,
    outcomes,
    held,
    ...(context.from === undefined ? {} : { from: context.from }),
    ...(context.fought === undefined ? {} : { fought: context.fought }),
  };

  for (const target of targets) {
    for (const effect of running) {
      const victim = current.creatures[target];
      if (victim === undefined) continue;

      const done = resolveOneEffect(ctx, effect, target, victim, current);
      if (!done.ok) return done;
      current = done.value;
    }
  }

  if (supply.issuer.count > issuedBefore) {
    events.push({
      type: 'rolls-issued',
      count: supply.issuer.count - issuedBefore,
      rng: supply.rng.snapshot(),
    });
  }

  // The live half of the casting, now that it is known what the casting
  // actually caught. See `OngoingSpell` for why each field is there.
  const becomes = context.becomesOngoing;
  if (becomes !== undefined) {
    events.push({
      type: 'spell-ongoing',
      casting: {
        version: ONGOING_RECORD_VERSION,
        castingId,
        caster: casterId,
        spellId: becomes.spellId,
        spell: definition.name,
        level: castLevel,
        numbers,
        // **Pinned at the cast, exactly as the numbers are.** A persistent
        // area's shape and the clauses that fire in it are catalogue data, and
        // a fold that looked them up later would let a corrected transcription
        // rewrite what a historical replay raised.
        ...(definition.area === undefined ? {} : { area: definition.area }),
        ...(definition.areaTrigger === undefined ? {} : { areaTrigger: definition.areaTrigger }),
        // And what ends it early, pinned by the same rule for the same
        // reason: a sentence corrected in the catalogue next month must not
        // reach a casting made today.
        ...(definition.endsEarly === undefined ? {} : { endsEarly: definition.endsEarly }),
        // **A casting that holds a point is on its point, not on a creature.**
        // The force is not on the goblin it hit, so a Dispel Magic aimed at
        // the goblin must not put it out — and `on: []` is the state the
        // record already has for a spell that caught nobody.
        //
        // **A Range: Self casting is on its caster *and* on whoever it holds
        // something on**, which is one rule rather than two. `[casterId]`
        // alone was a second rule — "Range: Self means the caster, full stop"
        // — and it threw `held` away: SRD Sunbeam comes out of the caster and
        // blinds whoever the Line catches "until the start of your next
        // turn", so a Dispel Magic aimed at the blinded creature found
        // nothing to end. The rule the rest of the engine applies is
        // `alsoOn`'s, and it is the one applied here too: **a casting is on a
        // creature while it has a live effect there that the casting owns.**
        on:
          becomes.on === 'caster'
            ? [...new Set([casterId, ...held])].sort()
            : becomes.on === 'point'
              ? []
              : landedOn(targets, outcomes, becomes.fromArea === true, held),
        ...(becomes.origin === undefined ? {} : { origin: becomes.origin }),
        ...(becomes.towards === undefined ? {} : { towards: becomes.towards }),
        ...(becomes.anchoring === undefined ? {} : { anchoring: becomes.anchoring }),
        ...(becomes.unaffected === undefined ? {} : { unaffected: becomes.unaffected }),
        ...(becomes.damageType === undefined ? {} : { damageType: becomes.damageType }),
      },
    });
  }

  return ok({ events, castingId, outcomes, unverified });
}

/**
 * Which of the creatures a spell was aimed at it is actually **on**.
 *
 * A target the spell reported nothing about keeps its place: a tracked spell
 * resolves no effects at all and is still on whoever it was cast on, which is
 * how Darkvision gets dispelled. A target every effect reported as unaffected
 * comes off — a creature that saved against Banishment is not banished, and a
 * spell is not on somebody it failed to touch.
 *
 * Sorted, so the record serialises identically however the targets arrived.
 */
function landedOn(
  targets: readonly CharacterId[],
  outcomes: readonly SpellTargetOutcome[],
  fromArea: boolean,
  held: ReadonlySet<CharacterId>,
): readonly CharacterId[] {
  return [...targets]
    .filter((target) => {
      // **A casting is on a creature while it has a live effect there that the
      // casting owns**, which is the same rule `alsoOn` applies when a
      // triggered effect lands a minute later. One rule, two moments.
      //
      // So damage alone is not being *on* somebody — the swarm bit you and is
      // not carrying anything of yours — and neither is a condition the
      // casting caused and does not keep: SRD Grease knocks you Prone and
      // Prone is yours to stand up from, so a Dispel Magic aimed at you finds
      // no Grease to end.
      if (held.has(target)) return true;
      // **Standing in an area is not being cast on.** A tracked spell keeps a
      // target it reported nothing about because somebody *aimed* it there —
      // Darkvision is on the creature it was cast on. An area spell aimed at
      // nobody: the geometry found them, and a Web that has done nothing to
      // you yet is not on you.
      const said = outcomes.filter((outcome) => outcome.target === target);
      return said.length === 0 && !fromArea;
    })
    .sort();
}

/**
 * What a resolution needs to say about the record it is about to create.
 *
 * Shared by the three paths that resolve a casting — the ordinary cast, the
 * settlement of a declared one, and the release of a readied one — so that a
 * fourth cannot quietly disagree about what a casting ends up on.
 */
interface OngoingRecordPlan {
  readonly spellId: string;
  readonly on: 'caster' | 'targets' | 'point';
  /** Set when the geometry chose the targets rather than the caller. */
  readonly fromArea?: true;
  readonly origin?: Point;
  readonly towards?: Point;
  /** Which convention `origin` and `towards` are read under. Absent means `space`. */
  readonly anchoring?: PointAnchoring;
  /** Creatures the caster designated unaffected, for a spell that offers it. */
  readonly unaffected?: readonly string[];
  /** The damage type the casting was declared with, where the spell prints two. */
  readonly damageType?: string;
}

/**
 * The two facts a caster states at the casting, normalised once.
 *
 * SRD Spirit Guardians asks for both in one paragraph — "3d8 Radiant damage
 * (if you are good or neutral) or 3d8 Necrotic damage (if you are evil)", and
 * "you can designate creatures to be unaffected by it" — and SRD Protection
 * from Energy asks for the first on its own. Neither can be worked out from
 * anything else: the engine holds no alignment for a declared NPC cleric, and
 * allegiance is not the designation.
 *
 * **One normalisation, three readers.** The atomic path writes these onto the
 * ongoing record, a held casting writes them onto the declaration, and the
 * settlement reads them back off it — and the sort and the empty-list elision
 * have to be identical in all three, or two declarations that mean the same
 * thing fold to different bytes. Written out twice they would eventually
 * disagree, which is the failure this repository records about every rule kept
 * in two places.
 *
 * **Idempotent**, which is what lets the settlement call it on an
 * already-normalised pending record rather than spelling the copy out a second
 * time: a sorted list sorts to itself, a non-empty list stays non-empty, and an
 * absent field stays absent.
 */
function statedFacts(stated: {
  readonly damageType?: string;
  readonly unaffected?: readonly CharacterId[];
}): {
  readonly damageType?: string;
  readonly unaffected?: readonly CharacterId[];
} {
  return {
    ...(stated.unaffected === undefined || stated.unaffected.length === 0
      ? {}
      : { unaffected: [...stated.unaffected].sort() }),
    ...(stated.damageType === undefined ? {} : { damageType: stated.damageType }),
  };
}

