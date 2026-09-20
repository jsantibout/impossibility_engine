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
 *
 * **The pre-flight, the loop and the dispatch are here; the rules each kind
 * applies are not.** `resolveOneEffect` is still one `switch` with one `never`
 * default, because that binding is what makes a kind added to the union and
 * not to the dispatch a compile error rather than a wrong answer in a fight —
 * a lookup table keyed by `kind` would be satisfied by a partial one. What
 * moved out are the per-kind resolvers themselves, into six modules named for
 * the family each rule belongs to, over the one `EffectContext` they all read:
 *
 * | module | the kinds it holds |
 * |---|---|
 * | `spell-effect-rolls.ts` | `attack`, `save-damage`, `save` |
 * | `spell-effect-grants.ts` | the six sourced-grant families |
 * | `spell-effect-hit-points.ts` | `heal`, `temp-hp` |
 * | `spell-effect-conditions.ts` | `condition`, `end-condition` |
 * | `spell-effect-magic.ts` | `dispel`, `interrupt-casting` |
 * | `spell-effect-teleport.ts` | `teleport` |
 *
 * with `spell-effect-context.ts` holding the context type both halves read and
 * `spell-effect-riders.ts` holding what a settled outcome carries. The split
 * is what it is because this file was the engine's measured contention point —
 * four merges and three thousand lines across one tranche, and a task lost to
 * it outright — and because IE-027 had already done the hard half by making
 * each kind a separate function over one gathered context.
 */

import {
  CONFERRED_LEVEL,
  cumulativeChance,
  itemCasting,
  itemFailureCount,
  itemSource,
} from '../catalogue.js';
import { featureSource } from '../progression.js';
import { spendAction, spendBonusAction, spendReaction } from '../combat.js';
import { rollRecorded } from '../rolls.js';
import { type CommandIdentity, commandOutcome, once } from '../idempotency.js';
import {
  type Ability,
  type CharacterId,
  type ContextRequest,
  contextRequestsOf,
  err,
  needsContext,
  ok,
  type Result,
} from '@ie/shared';
import { type Duration, isDue, resolveDuration, timeView } from '../time.js';
import {
  applyEvent,
  type CommandStamp,
  type CreatureState,
  type GameEvent,
  type GameState,
} from '../events.js';
import { ONGOING_RECORD_VERSION } from '../ongoing-compatibility.js';
import { type Placement, type Point, type PointAnchoring } from '../positioning.js';
import { remaining, tallied } from '../resources.js';
import {
  creatureTypesRead,
  delayedDuration,
  delaysDamage,
  onCaster,
  persists,
  ranged,
  durationSecondsAt,
  riderDuration,
  anchoredOnTarget,
  riderDurations,
  type SpellDefinition,
  type SpellEffect,
  teleportOf,
  statedDamageType,
  damageTypesDealt,
} from '../spell-definitions.js';
import { type CastingRoute } from '../spellcasting.js';
import { castingSource, type CastingNumbers, type CastingTime } from '../spells.js';
import {
  castingDamageFeatures,
  type CastingDamageFeature,
  sheetAsItStands,
} from '../standing.js';
import {
  answeredCasting,
  choosePayment,
  chooseRoute,
  type Supply,
  deflectTriggeringAttack,
  nextCastingId,
  resolveCastWith,
  settlementEvents,
  triggerRefusal,
} from './casting.js';
import { creatureOf, turnContextFor, unknownCreature } from './command.js';
import {
  chargeSpend,
  itemCastOf,
  itemPaysRefusal,
  itemRoute,
  selfOnlyRefusal,
  numbersFor,
  routeLabel,
} from './item-casting.js';
import { unsettledRefusal } from './holds.js';
import { teleportTo } from './teleport.js';
import { payCastingDamageCost } from './damage.js';
import { replacedCastings } from './ongoing.js';
import {
  type CastingAlterations,
  castingAlterations,
  effectCheckFrom,
  electedFeatures,
  NO_ALTERATIONS,
} from './rolls.js';
import {
  type CastingOrigin,
  type EffectContext,
  type EffectOrigin,
} from './spell-effect-context.js';
import {
  resolveConditionEffect,
  resolveEndConditionEffect,
} from './spell-effect-conditions.js';
import {
  resolveArmorClassEffect,
  resolveAttackRiderEffect,
  resolveBuffEffect,
  resolveConditionImmunityEffect,
  resolveDamageDefenseEffect,
  resolveRollModeEffect,
  resolveActionRuleEffect,
  resolveSpeedEffect,
} from './spell-effect-grants.js';
import {
  resolveHealEffect,
  resolveTempHpEffect,
  resolveTurnPayoutEffect,
} from './spell-effect-hit-points.js';
import {
  resolveDispelEffect,
  resolveInterruptCastingEffect,
} from './spell-effect-magic.js';
import {
  resolveAttackEffect,
  resolveSaveDamageEffect,
  resolveSaveEffect,
} from './spell-effect-rolls.js';
import { resolveTeleportEffect } from './spell-effect-teleport.js';
import {
  anchoringFor,
  areaTargets,
  areaSourceOf,
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
  supply: Supply,
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
 *
 * **What it does take is a casting id.** Several castings may be open at once,
 * and several of them may belong to one caster, so "the" casting stopped being
 * a thing a settlement could address. The id is in the idempotency kind as well
 * as in the lookup, so one command id used to settle two different castings is
 * refused as a recycled id rather than silently swallowing the second.
 */
export function resolveDeclaredCast(
  state: GameState,
  castingId: string,
  supply: Supply,
  command: CommandIdentity = {},
): Result<SpellResolution> {
  // Before the pending casting is even read. A retry that arrives after the
  // first settlement finds no casting open, and reporting "nothing is being
  // cast" for a spell that has already landed is the exact confusion command
  // ids exist to prevent.
  return once(state, `settle-cast:${castingId}`, command, () => {
    const already = command.commandId === undefined ? null : commandOutcome(state, command.commandId);
    return {
      events: [],
      castingId: already?.castingId ?? castingId,
      outcomes: [],
      unverified: [],
    };
  }, (stamp) => {
    const pending = state.pendingCastings[castingId];
    if (pending === undefined) {
      return err('no_casting_pending', `no casting ${castingId} is waiting to resolve`);
    }

    // SRD "Longer Casting Times": the spell takes effect when the casting is
    // finished, and the caster has to still be at it until then. **`isDue` and
    // not `hasExpired`** — see `PendingCasting.completesAt`: the two are
    // opposites for a moment that can never arrive, and a casting that
    // completed because the fight ended would be a completion the engine
    // invented.
    if (pending.completesAt !== undefined && !isDue(timeView(state), pending.completesAt)) {
      return err(
        'still_casting',
        `${pending.caster} is still casting ${pending.spell}; it takes a minute or more and the time has not passed`,
      );
    }

    const caster = creatureOf(state, pending.caster);
    if (caster === null) return unknownCreature(pending.caster);

    const definition = supply.content.spell(pending.spellId);
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
    //
    // **Except where the route was an item's**, which is the one case that is
    // not a fact about the sheet: the wand can be put down, given away or
    // unattuned between the declaration and the settlement, and asking the
    // catalogue again would find no route where one demonstrably existed. So a
    // declaration made from an item wrote its numbers down, and a record that
    // carries them settles with them rather than re-deriving anything.
    const chosen =
      pending.numbers === undefined
        ? chooseRoute(caster.spellcasting, pending.spellId, pending.route)
        : ok(null);
    if (!chosen.ok) return chosen;

    const events: GameEvent[] = settlementEvents(state, pending, stamp);

    // What the caster stated at the declaration, read back off the record it
    // was written on. Normalised already — this is the same function that
    // normalised it, and it is idempotent precisely so that the settlement
    // does not have to spell the copy out a second time.
    const stated = statedFacts(pending);

    // **And what their own features do to the damage, asked again here.** The
    // route was re-derived just above for the reason this is: both are facts
    // about a sheet that nothing between the declaration and the settlement can
    // have changed, and a derived value written into the log would be a
    // derivation pretending to be history.
    //
    // `using` is empty and can only be empty: an *elected* feature is the one
    // thing a declaration cannot record, so `resolveOnTargets` refuses one on a
    // declaration rather than dropping it. What reaches here is every feature
    // that needs no election — Foe Slayer's die, Potent Cantrip's floor — which
    // is the whole of what a long casting could have wanted.
    const running = statedDamageType(definition.effects, pending.damageType);
    const damage = castingDamageOf(state, pending.caster, caster, {
      definition,
      effects: running,
      route: chosen.value,
      castLevel: pending.level,
      using: [],
    });
    const charged = chargingWith(
      state,
      pending.caster,
      damage,
      pending.level,
      supply,
      events,
    );

    return charged(resolveEffects(state, pending.caster, caster, definition, {
      castLevel: pending.level,
      route: chosen.value,
      ...(pending.numbers === undefined ? {} : { numbers: pending.numbers }),
      ...(pending.ability === undefined ? {} : { ability: pending.ability }),
      targets: pending.targets,
      unverified: [...pending.unverified],
      supply,
      castingId: pending.castingId,
      events,
      // SRD Protection from Energy states its type for an effect that lands at
      // the cast, so the substitution has to reach the casting's own effects
      // and not only an area trigger's. Identity when nothing was stated,
      // which is every other spell in the book.
      effects: running,
      ...(pending.origin === undefined ? {} : { from: pending.origin }),
      // The third stated fact, read back off the record rather than from a
      // fresh request there is none of. A held Charm Person settles with the
      // Advantage its caster said it had.
      ...(pending.fought === undefined ? {} : { fought: pending.fought }),
      // The fourth stated fact, read back off the record. A Dimension Door
      // declared at one space settles at that space and at no other.
      ...(pending.teleportTo === undefined ? {} : { teleportTo: pending.teleportTo }),
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
      alters: damage.alters,
    }));
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
  supply: Supply,
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
    //
    // **Including where it made none.** A use of a Wind Fan that tore records
    // `castingId: null` in the ledger, because the event it stamped was the
    // loss rather than a `spell-cast` — and a retry has to say the same thing.
    // Reading the ledger's `null` as "nothing remembered" and answering with
    // the next id would hand a caller the id of a casting that has not
    // happened, for a command that already landed and never will.
    const already =
      request.commandId === undefined ? null : commandOutcome(state, request.commandId);
    return {
      events: [],
      castingId: already === null ? nextCastingId(state) : already.castingId,
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

    const definition = supply.content.spell(request.spellId);
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

    // **There is no refusal here for "a casting is already open", and deleting
    // it deleted no rule.** It refused every other creature's casting for the
    // whole of a ten-minute rite, and it refused the rite's own caster a
    // Reaction spell — neither of which the SRD says. What stops a second
    // casting is the real primitive in every case: the action economy for a
    // second Magic action, `spellSlotSpentOnTurn` for a second slot on one
    // turn, and `releaseCasting`'s single door for a second Concentration.
    //
    // **Which casting this answers, where it answers one.** Asked of the same
    // function the trigger check above asked, which is pure and reads nothing
    // that has changed between the two calls — so it resolves to the same
    // casting, and the trigger has already refused if it could not resolve.
    // The `ok` guard below is therefore only reachable on the released-readied
    // path, which skips the trigger check entirely.
    const answering =
      definition.trigger === 'casting-a-spell' ? answeredCasting(state, definition, request) : null;

    // **A field quietly ignored is a caller who thinks they said something.**
    // The shape every other stated fact on this request takes: refused for a
    // spell that prints no clause it could belong to.
    if (request.answers !== undefined && definition.trigger !== 'casting-a-spell') {
      return err(
        'no_answer_clause',
        `${definition.name} is not a Reaction taken when a creature casts a spell, so it answers no casting`,
      );
    }

    // **The two clauses of the nesting limit, and they are rules about the
    // answering relationship rather than about uniqueness.** An answer is not a
    // window, and an answer may not answer an answer.
    //
    // Both are **engine limits standing in for a settle-order rule the engine
    // does not have, and neither is an SRD rule**: SRD Counterspell triggers on
    // "a creature within 60 feet of yourself casting a spell with Verbal,
    // Somatic, or Material components", and a creature casting Counterspell is
    // doing exactly that. Lifting them needs an order in which nested answers
    // settle, which is a semantic change and is not this.
    //
    // **After the duplicate check, never before it** — the same trap the
    // trigger above fell into. A retried *declaration* looks at a window its
    // own first run opened; a retry has already returned its empty batch and
    // never reaches here.
    if (definition.trigger === 'casting-a-spell' && request.hold === true) {
      return err(
        'answer_cannot_be_held',
        `${definition.name} answers a casting and cannot itself be held open; the engine has no rule for the order two nested answers would settle in, which is a limit of this engine rather than of the SRD`,
      );
    }
    if (answering !== null && answering.ok) {
      const answered = supply.content.spell(answering.value.spellId);
      if (answered?.trigger === 'casting-a-spell') {
        return err(
          'answer_to_an_answer',
          `${answering.value.spell} is itself an answer to a casting, and ${definition.name} may not answer it; the engine has no rule for the order two nested answers would settle in, which is a limit of this engine rather than of the SRD`,
        );
      }
    }

    // SRD gives "until the end of your next turn" no meaning where there are no
    // turns, and `resolveDuration` refuses rather than inventing six seconds.
    // Asked here, before the slot and before the first die: the same
    // validate-before-rolling rule the rest of casting obeys, and the reason a
    // Color Spray outside combat costs its caster nothing at all.
    //
    // **And it asks rather than refusing.** A turn timeline is a thin record,
    // not a rule saying no — the conversion below still refuses, because
    // calling that moment six seconds is exactly what the two-type split
    // exists to prevent, and this is the layer that knows a `beginCombat` is
    // what would settle it. Raised here, the request costs a caller nothing to
    // answer: the slot, the action and the generator are all still where they
    // were, so the same casting is sent again unchanged.
    //
    // **The caster-anchored deadlines only**, which is the half that can be
    // asked here at all: they are the same moment for every target a casting
    // catches, so the caster answers for all of them and the targets need not
    // exist yet. A deadline anchored on the creature the rider lands on is a
    // different moment per target and is asked below, where the targets are
    // settled — the division {@link anchoredOnTarget} owns, and the one
    // `delayedDuration` has always made for the same reason.
    for (const lasts of riderDurations(definition)) {
      if (anchoredOnTarget(lasts)) continue;
      const wants = riderDuration(lasts, casterId) as Duration;
      const pinned = resolveDuration({ elapsed: state.elapsed, combat: state.combat }, wants);
      if (!pinned.ok) return turnContextFor(pinned, wants, casterId);
    }

    // SRD Divine Smite is cast "immediately after hitting a target", so the
    // attack is the thing it needs and this command has none to give it.
    if (definition.effects.some((effect) => effect.kind === 'attack-damage')) {
      return err(
        'cast_on_a_hit',
        `${definition.name} is cast on an attack that has hit; settle the attack's damage with it instead`,
      );
    }

    // SRD "Spells Cast from Items": a wand's Fireball is a casting, and the
    // item supplies the route the way a class or a feat does. Read before the
    // route is chosen and refused before anything is spent — the attunement
    // included, so an unattuned wand costs no charge.
    const fromItem = itemCastOf(request);
    if (!fromItem.ok) return fromItem;
    if (fromItem.value !== null) {
      // "doesn't expend any of the user's spell slots", so nothing else may
      // say how this casting is paid for.
      const paid = itemPaysRefusal(request);
      if (!paid.ok) return paid;
    }

    // SRD: you cast what you know or have prepared, and nothing else.
    const chosen =
      fromItem.value === null
        ? chooseRoute(caster.spellcasting, request.spellId, request.source)
        : // The sheet as it stands, because a wand that printed no numbers
          // leaves them to the wielder's own — and an item that sets the
          // ability those are derived from is on the wielder right now.
          itemRoute(
            caster,
            sheetAsItStands(state, casterId) ?? caster.sheet,
            supply.content,
            definition,
            fromItem.value,
          );
    if (!chosen.ok) return chosen;
    const route = chosen.value;

    // How long this casting takes, and whether it is a Ritual. Refused here,
    // before a slot, an action or a die — and computed once, because the
    // arithmetic and the refusals are three consequences of one SRD sentence.
    const casting = castingOf(definition, request);
    if (!casting.ok) return casting;

    const slotLevel = request.slotLevel ?? definition.level;
    // The item's level where an item is casting it — SRD's "lowest possible
    // spell level", raised by the charges where the item's line says so.
    const castLevel =
      route.kind === 'item' ? route.castLevel : Math.max(definition.level, slotLevel);
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
      const resolved = areaTargets(
        state,
        casterId,
        areaSourceOf(definition),
        definition.area,
        request,
        reach,
      );
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

    // SRD Ring of Jumping: "but can target only yourself when you do so."
    // The item narrowing the spell under it, asked once the spell's own rule
    // has had its say and before anything at all is spent — so a ring aimed at
    // an ally is a refusal its wearer pays nothing for.
    const narrowed = selfOnlyRefusal(route, supply.content, definition, casterId, targets);
    if (!narrowed.ok) return narrowed;

    // What the targets **are**, where the spell answers differently by type.
    // Asked here, with the targets settled and before anything is spent, so a
    // Blight aimed at a creature nobody has typed costs its caster nothing —
    // and joins the same list the position and sight requests use, because a
    // caller fixing a thin record should be told everything that is thin
    // rather than one fact at a time.
    needs.push(...creatureTypeNeeds(state, definition.name, definition.effects, targets));

    // **A printed later consequence asks for the timeline it needs**, at the
    // same moment and by the same rule: with the targets settled, before the
    // slot, the action and the first die.
    //
    // SRD writes the moment as "at the end of **its** next turn", so it is
    // anchored on the target rather than on the caster — which is why it is
    // asked here, where the targets exist, rather than in the caster-anchored
    // half of the `riderDurations` loop above. A *rider's* deadline can be
    // anchored the same way, and the loop below this one asks those in exactly
    // this place for exactly this reason; `anchoredOnTarget` is what sorts a
    // deadline into one half or the other, and a new one anchored on the
    // creature it lands on belongs in that loop rather than in a third.
    // Outside combat there is no turn whose
    // end that names, and the one thing this engine may never do is quietly
    // call the moment six seconds; so the casting asks for the fact instead,
    // and asks *before* anything is spent, because a `needs-context` promises
    // nothing was. It used to resolve in part and forgive the rest: the slot
    // went, the attack rolled, the first hit landed, and the later one was
    // dropped with a line in `unverified` that reached a caller too late to
    // act on.
    //
    // **The engine asks; it does not answer.** It does not begin a fight, roll
    // Initiative or decide that this action was hostile enough to start one —
    // that ruling is the DM's, above this layer, and what arrives back is the
    // same casting sent again unchanged.
    //
    // One request per target that cannot be pinned, because the fact is about
    // that creature: two targets can be missing from the order independently,
    // and a caller repairing a thin record is told everything that is thin.
    if (delaysDamage(definition)) {
      for (const target of targets) {
        const owed = delayedDuration(target);
        const pinned = resolveDuration(timeView(state), owed);
        if (pinned.ok) continue;
        const asked = turnContextFor(pinned, owed, target);
        const requests = contextRequestsOf(asked);
        if (requests.length === 0) return asked;
        needs.push(...requests);
      }
    }

    // **And a rider's own deadline, where the rider anchors it on the creature
    // it lands on** — the other half of the loop above, asked here for the
    // reason the paragraph above gives and in the same shape.
    //
    // SRD Vicious Mockery: "Disadvantage on the next attack roll it makes
    // before the end of **its** next turn", on an Instantaneous cantrip, so
    // the rider's own deadline is the only thing that could ever lift the
    // Disadvantage and "its" is the target rather than the caster. A creature
    // can be in the fight and not in the order — `joinCombat` is what that
    // command is for — so asking the caster would pass the pre-flight and
    // leave `schedule` to refuse after the save had been rolled. That is the
    // failure the paragraph above records in the past tense, and this is the
    // same fix for the same shape of sentence.
    //
    // One request per target that cannot be pinned, because the fact is about
    // that creature.
    for (const lasts of riderDurations(definition)) {
      if (!anchoredOnTarget(lasts)) continue;
      for (const target of targets) {
        const owed = riderDuration(lasts, casterId, target) as Duration;
        const pinned = resolveDuration(timeView(state), owed);
        if (pinned.ok) continue;
        const asked = turnContextFor(pinned, owed, target);
        const requests = contextRequestsOf(asked);
        if (requests.length === 0) return asked;
        needs.push(...requests);
      }
    }

    // And whether the teleport this casting performs can happen at all, asked
    // at the same moment and for the same two reasons. Before the slot and the
    // action, so a Misty Step aimed at a space nobody has described costs
    // nothing — and before a **declaration**, because SRD Counterspell makes
    // the action "wasted" whatever follows, so a casting held open must always
    // be able to settle. `teleportTo` is the pre-flight rather than a second
    // reading of it: it is pure and its events are discarded here, so every
    // refusal the resolver could give — the distance, the occupied space, the
    // scene's extent, the declared sight — is reachable before anything is
    // spent, and there is no second answer to any of those questions.
    const teleport = teleportOf(definition);
    if (teleport !== null && request.teleportTo !== undefined) {
      for (const target of targets) {
        const reachable = teleportTo(state, target, {
          placement: request.teleportTo,
          within: teleport.feet,
          ...(teleport.requiresSight === undefined
            ? {}
            : { requiresSight: teleport.requiresSight }),
        });
        if (reachable.ok) continue;
        const asked = contextRequestsOf(reachable);
        if (asked.length === 0) return reachable;
        needs.push(...asked);
      }
    }

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
      casting: casting.value,
      ...(answering !== null && answering.ok ? { answers: answering.value.castingId } : {}),
    });
  });
}

/** SRD: "The Ritual version of a spell takes 10 minutes longer to cast." */
const RITUAL_SECONDS = 600;

/** How long this casting takes, and whether a Ritual was asked for. */
export interface CastingTiming {
  readonly castingTime: CastingTime;
  /** Whole seconds, for a casting of a minute or more. */
  readonly castingSeconds?: number;
  readonly ritual: boolean;
}

/**
 * What the casting time of *this* casting is, Ritual included.
 *
 * SRD's whole Ritual rule is one sentence with three consequences, and all
 * three are here rather than in three places: "The Ritual version of a spell
 * takes 10 minutes longer to cast than normal. It also doesn't expend a spell
 * slot, **which means the ritual version of a spell can't be cast at a higher
 * level.**"
 *
 * So a Ritual is **always a long casting**, whatever the spell's printed
 * casting time is — Detect Magic prints "Action or Ritual" and its Ritual
 * version takes ten minutes, which is a minute or more by any reading. That is
 * why `PendingCasting.completesAt` rather than `castingTime` is what the
 * settlement branches on.
 *
 * A spell that prints no Ritual tag has no Ritual version, so asking for one
 * is refused rather than quietly cast normally — the shape `damageType` and
 * `fought` already take for a clause a spell does not print.
 *
 * **Exported because the arithmetic below needed a fixture no registered
 * spell could reach, and now six of them can.** Every definition tagged as a
 * Ritual before IE-036 prints "Action or Ritual", so none had a
 * `castingSeconds` of its own and "adds ten minutes" and "is ten minutes"
 * gave the same answer for all ten — a mutation replacing the sum with the
 * constant survived the whole suite, and the only way to reach the difference
 * was to build a definition by hand, which is pure over one and is the move
 * `restoreOn`'s dawn-recovering pool already makes for a branch no class can
 * reach.
 *
 * SRD Alarm prints "1 minute or Ritual" and comes to **660**; IE-036 wrote it
 * and five more that print the same line, so the sum has catalogue writers and
 * that mutation now reddens three tests in two files. The export stays,
 * because being pure over a definition is what lets the sweep in
 * `long-casting.test.ts` ask the question of every tagged definition at once.
 */
export function castingOf(
  definition: SpellDefinition,
  request: CastSpellRequest,
): Result<CastingTiming> {
  if (request.ritual !== true) {
    return ok({
      castingTime: definition.castingTime,
      ...(definition.castingSeconds === undefined
        ? {}
        : { castingSeconds: definition.castingSeconds }),
      ritual: false,
    });
  }

  if (definition.ritual !== true) {
    return err(
      'not_a_ritual',
      `${definition.name} does not carry the Ritual tag, so it has no Ritual version`,
    );
  }

  // "which means the ritual version of a spell can't be cast at a higher
  // level" — the book's own gloss on the slot, so the refusal names the level.
  // Checked first because it is the more informative of the two answers a
  // caller who named a slot level can get.
  if (request.slotLevel !== undefined && request.slotLevel > definition.level) {
    return err(
      'ritual_not_upcast',
      `a Ritual expends no spell slot, so ${definition.name} cannot be cast as one above level ${definition.level}`,
    );
  }

  // **One sentence, enforced one way.** "It also doesn't expend a spell slot"
  // is the rule, and the upcast prohibition above is the book's gloss on it —
  // so *every* way a caller can say how the casting is paid for is refused,
  // not only the one the gloss names. A `slotLevel` at the spell's own level
  // was silently dropped and a `slotless` reason silently overwrote the
  // `'ritual'` the casting had just decided, which is the field-quietly-
  // ignored failure this very refusal was written against.
  const paid =
    request.payment !== undefined
      ? 'a payment'
      : request.slotLevel !== undefined
        ? 'a slot level'
        : request.slotless !== undefined
          ? 'a reason for skipping a slot'
          : null;
  if (paid !== null) {
    return err(
      'ritual_pays_nothing',
      `a Ritual expends neither a spell slot nor a free casting, so ${paid} says nothing about how ${definition.name} is cast as one`,
    );
  }

  return {
    ok: true,
    value: {
      castingTime: 'long',
      castingSeconds: (definition.castingSeconds ?? 0) + RITUAL_SECONDS,
      ritual: true,
    },
  };
}

/** SRD writes these chances as percentages, so the die has a hundred faces. */
const FAILURE_DIE = '1d100';

/** Nothing happened, which is what using an item that cannot fail comes to. */
const WORKED = { events: [] as readonly GameEvent[], torn: false };

/**
 * Whether the item this casting comes from **works at all**, and what it costs
 * when it does not.
 *
 * SRD Wind Fan: "Each subsequent time the fan is used before the next dawn, it
 * has a cumulative 20 percent chance of not working; if the fan fails to work,
 * it tears into useless, nonmagical tatters." Two mechanisms in one sentence
 * and neither of them is a casting: a count of uses, and a die thrown against
 * it before the spell is cast at all.
 *
 * **The use is counted whether it works or not**, because the book counts uses
 * rather than successes — and the count is a tally rather than a pool, so
 * there is nothing here that can refuse. See `Tally` in `resources.ts`.
 *
 * **The die is thrown where the charge is spent**: after every validation and
 * before the first die of the spell itself. That is the line this file's own
 * docstring already draws for a charge, and the fan's percentage sits on it for
 * the same reason — everything that can refuse has refused, so a failure is an
 * outcome rather than a refusal that arrived late.
 *
 * **Not thrown at all on the first use**, where the chance is zero. A die
 * thrown for an outcome that is already decided moves the generator for
 * nothing, which is the quiet way a replay stops matching — the same rule that
 * keeps `declareDawn` from rolling for a pool with nothing spent.
 *
 * **The action is settled before the die and spent on the way out.** A failed
 * use still costs its user the Magic action — the fan was waved — and the
 * ordinary path spends that inside `resolveCastWith`, which a failure never
 * reaches. So the economy is asked here first, where a refusal ("it is not your
 * turn") still costs no die and no fan, and the event it hands back is either
 * pushed by the failure or dropped for the casting to spend properly.
 *
 * **And the fan leaves the hand it was held in.** `items-lost` takes the copy
 * off the inventory and no more; a torn fan left standing in `equipped` would
 * be a route `itemRoute` still finds, and the tatters would go on casting.
 */
function itemFailure(
  state: GameState,
  casterId: CharacterId,
  caster: CreatureState,
  definition: SpellDefinition,
  route: CastingRoute,
  castingTime: CastingTime,
  supply: Supply,
  stamp: CommandStamp | null,
): Result<{ readonly events: readonly GameEvent[]; readonly torn: boolean }> {
  if (route.kind !== 'item') return ok(WORKED);
  const item = supply.content.item(route.item);
  const grant = item === null ? null : itemCasting(item, definition.id);
  // Both were read by `itemRoute` before this casting had a route at all, so
  // neither miss is reachable; answering "it worked" is what a reader of an
  // item that says nothing about failing gets, and there is nothing else true
  // to say.
  if (item === null || grant === null) return ok(WORKED);

  const held = caster.equipped.find((worn) => worn.id === item.id);
  const counting = itemFailureCount(grant, held?.instance);
  if (counting === null) return ok(WORKED);

  const chance = cumulativeChance(counting.percentEach, tallied(caster.resources, counting.key));
  const counted: GameEvent = {
    type: 'resource-spent',
    id: casterId,
    key: counting.key,
    amount: 1,
    tally: counting.recovers,
  };
  if (chance <= 0) return ok({ events: [counted], torn: false });

  const economy = castingEconomy(state, casterId, caster, castingTime);
  if (!economy.ok) return economy;

  const issuedBefore = supply.issuer.count;
  const thrown = rollRecorded(supply.issuer, supply.rng, FAILURE_DIE);
  if (!thrown.ok) return thrown;

  // A percentage is the chance of *failing*, so the roll fails at or under it
  // — and a hundred takes every face of the die, which is what the sixth wave
  // of a Wind Fan is.
  const torn = thrown.value.total <= chance;
  const rolled: readonly GameEvent[] = [
    {
      type: 'roll-recorded',
      who: casterId,
      label: `${item.name} works (${FAILURE_DIE} against ${chance}%)`,
      natural: thrown.value.total,
      total: thrown.value.total,
      contributions: [],
      outcome: torn ? 'it fails' : 'it works',
    },
    {
      type: 'rolls-issued',
      count: supply.issuer.count - issuedBefore,
      rng: supply.rng.snapshot(),
    },
  ];
  if (!torn) return ok({ events: [counted, ...rolled], torn: false });

  // **The stamp rides the loss**, because it is the one event a failed use
  // always writes: the action exists only in combat and the count is not this
  // command's to answer for. A batch carrying no stamped event is a command
  // the fold never records, and the retry would wave the fan again.
  return ok({
    events: [
      ...(economy.value === null ? [] : [economy.value]),
      counted,
      ...rolled,
      ...(held === undefined
        ? []
        : [{ type: 'item-unequipped' as const, id: casterId, item: item.id }]),
      {
        type: 'items-lost',
        id: casterId,
        items: [
          {
            id: item.id,
            quantity: 1,
            ...(held?.instance === undefined ? {} : { instance: held.instance }),
          },
        ],
        source: `${item.name}, which failed to work`,
        ...(stamp === null ? {} : { command: stamp }),
      },
    ],
    torn: true,
  });
}

/**
 * The action, Bonus Action or Reaction a casting spends, or null outside
 * combat — worked out **without spending it**.
 *
 * The same three-way `resolveCastWith` takes, asked ahead of time by the one
 * path that has to know the answer before it has decided whether there will be
 * a casting to spend it on. Pure, so asking twice costs nothing: a use that
 * works drops this and lets the casting spend the action itself, through the
 * call that owns it.
 *
 * **Every casting route is the Magic action**, which is why the name travels
 * with all three — SRD Befuddlement forbids "casting spells" rather than an
 * Action, and a fan waved by somebody who cannot cast is not waved.
 */
function castingEconomy(
  state: GameState,
  casterId: CharacterId,
  caster: CreatureState,
  castingTime: CastingTime,
): Result<GameEvent | null> {
  const combat = state.combat;
  if (combat === null || combat.budgets[casterId] === undefined) return ok(null);

  const spend = { rules: caster.actionRules, as: 'magic' as const };
  const spent =
    castingTime === 'reaction'
      ? spendReaction(combat, casterId, caster.conditions, spend)
      : castingTime === 'bonus-action'
        ? spendBonusAction(combat, casterId, caster.conditions, spend)
        : spendAction(combat, casterId, caster.conditions, spend);
  if (!spent.ok) return spent;

  return ok(
    castingTime === 'reaction'
      ? { type: 'reaction-spent', id: casterId }
      : castingTime === 'bonus-action'
        ? { type: 'bonus-action-spent', id: casterId }
        : { type: 'action-spent', id: casterId },
  );
}

/** What a caster's own features are doing to a casting, and what it costs. */
interface CastingDamage {
  readonly alters: CastingAlterations;
  /** The features whose alteration this casting is paying for. Usually empty. */
  readonly costs: readonly CastingDamageFeature[];
}

/**
 * The caster's features that reach this casting, gathered once.
 *
 * **Both casting paths ask this**, which is why it is a function rather than
 * two blocks: an atomic casting asks it in {@link resolveOnTargets} and a
 * declared one asks it again at its settlement, where the route has been
 * re-derived off a sheet nothing between the two moments can have changed.
 * Written twice they would have drifted the first time a narrowing was added.
 */
function castingDamageOf(
  state: GameState,
  casterId: CharacterId,
  caster: CreatureState,
  of: {
    readonly definition: SpellDefinition;
    /** The list this casting is actually running, stated damage type and all. */
    readonly effects: readonly SpellEffect[];
    readonly route: CastingRoute | null;
    readonly castLevel: number;
    /** The optional features the caster elected; empty where none could be. */
    readonly using: readonly string[];
  },
): CastingDamage {
  const reaching = castingDamageFeatures(state, casterId, {
    spell: of.definition.id,
    school: of.definition.school,
    // A class's route says whose spell this is; a feat's grant and an item's
    // say nobody's, which is the honest answer to "a **Wizard** spell".
    classId:
      of.route?.kind === 'cantrip' || of.route?.kind === 'prepared' ? of.route.classId : null,
    damageTypes: damageTypesDealt(of.effects),
    slotLevel: of.castLevel,
    using: of.using,
  });
  return {
    alters: castingAlterations(reaching, sheetAsItStands(state, casterId) ?? caster.sheet),
    costs: reaching.filter((feature) => feature.costs !== undefined),
  };
}

/**
 * SRD Overchannel's price, charged immediately after the casting that bought it
 * — "you take 2d12 Necrotic damage for each level of the spell slot
 * **immediately after you cast it**."
 *
 * Wrapped around the resolution rather than run inside it, because it is the
 * *casting command's* debt and not the effect list's: an area settling a minute
 * later and an activation run the same list, and neither of them is a casting
 * anybody made. `events` is the batch both halves share, so the charge lands in
 * the resolution's own events by appending to it.
 */
function chargingWith(
  state: GameState,
  casterId: CharacterId,
  damage: CastingDamage,
  castLevel: number,
  supply: Supply,
  events: GameEvent[],
): (resolution: Result<SpellResolution>) => Result<SpellResolution> {
  return (resolution) => {
    if (!resolution.ok || damage.costs.length === 0) return resolution;
    const issuedBefore = supply.issuer.count;
    let current = events.reduce(applyEvent, state);
    for (const feature of damage.costs) {
      const paid = payCastingDamageCost(current, casterId, feature, castLevel, supply);
      if (!paid.ok) return paid;
      events.push(...paid.value);
      current = paid.value.reduce(applyEvent, current);
    }
    // Where the backlash threw dice, the generator's bookmark goes in the log
    // beside them — the same event `runEffects` writes for the spell's own, and
    // the same place in the batch: after what it accounts for.
    if (supply.issuer.count > issuedBefore) {
      events.push({
        type: 'rolls-issued',
        count: supply.issuer.count - issuedBefore,
        rng: supply.rng.snapshot(),
      });
    }
    return resolution;
  };
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
    readonly supply: Supply;
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
    /** How long it takes and whether it is a Ritual — see `castingOf`. */
    readonly casting: CastingTiming;
    /**
     * The casting a Reaction spell answers, by id.
     *
     * Resolved by the wrapper, before anything was spent, through the same
     * function the trigger check read — so the `interrupt-casting` effect
     * settles the casting the trigger accepted rather than whichever one
     * happens to be open when it runs.
     */
    readonly answers?: string;
  },
): Result<SpellResolution> {
  const { castLevel, route, targets, unverified, supply, held, origin, area, stamp, casting } =
    context;

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

  // The numbers this casting is made with, worked out once and read by
  // everything below: the DC a later examiner rolls against, the DC and the
  // attack modifier every effect rolls with, and the pair the ongoing record
  // pins. A class route derives them from the sheet; an item route has already
  // answered, because nothing later can ask a wand that is not in hand.
  //
  // **The sheet as it stands**, so a Headband of Intellect moves the save DC
  // and the spell attack modifier a wizard's casting is made with. Asked once,
  // here, where the state is — and pinned into the events below like every
  // other number, so the substitution happens at the casting and never again.
  const numbers = numbersFor(sheetAsItStands(state, casterId) ?? caster.sheet, route);

  // What the caster's own features do to this casting's damage, asked once,
  // here, where the request and the route are both in hand. `running` is the
  // effect list as the casting's stated type leaves it, so a Sorcerer's
  // affinity reads the type the spell is actually dealing rather than the one
  // the definition prints first.
  const elected = electedFeatures(state, casterId, request.usingFeatures);
  if (!elected.ok) return elected;
  const reaching = castingDamageOf(state, casterId, caster, {
    definition,
    effects: running,
    route,
    castLevel,
    using: elected.value,
  });
  const alters = reaching.alters;

  // — paying for it ——————————————————————————————————————————————————————
  //
  // A free casting from a feat spends its own pool; anything else goes through
  // the ordinary casting command, which owns slots, the action, and the
  // Concentration that starts or is replaced.
  const events: GameEvent[] = [];
  const charged = chargingWith(state, casterId, reaching, castLevel, supply, events);

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
    return charged(
      resolveEffects(state, casterId, caster, definition, {
        castLevel,
        numbers,
        route,
        targets,
        unverified,
        supply,
        castingId: held.castingId,
        events,
        effects: running,
        ...(origin === null ? {} : { from: origin }),
        ...(fought === undefined ? {} : { fought }),
        ...(request.teleportTo === undefined ? {} : { teleportTo: request.teleportTo }),
        alters,
        // A released spell leaves the same thing running that a cast one does.
        // This was the one resolution path of three that wrote no record, so a
        // readied Bless was running, concentrated on, and invisible to Dispel
        // Magic.
        ...(persists(definition) ? { becomesOngoing: ongoingWith() } : {}),
      }),
    );
  }

  // **Two reasons to declare rather than resolve, and one of them is not the
  // caller's.** `hold` asks for the Counterspell window; a casting time of a
  // minute or more *is* a process the SRD lets a Counterspell interrupt, so it
  // is declared whether the caller asked or not. Both write `spell-declared`
  // and both settle through `resolveDeclaredCast`; what differs is only when
  // the settlement is allowed to happen.
  const declaring = request.hold === true || casting.castingTime === 'long';

  // **And a declared casting may not elect a feature**, because it has nowhere
  // to write the election down. Everything a settlement reads is pinned on
  // `spell-declared` — the stated type, the designation, the space a teleport
  // named — and this is not: `PendingCasting` carries no such field, so a
  // casting held open for a Counterspell would settle a minute later having
  // silently forgotten that its caster said they were using Overchannel.
  //
  // Refused rather than dropped, which is the rule a stated fact that cannot be
  // honoured follows everywhere else. The features that need no election reach
  // a declared casting perfectly well — the settlement asks for them again off
  // the same sheet, and a Ranger's Foe Slayer does not care how long the
  // casting took. Pinning the election is the change that would lift this, and
  // it is a field on a pending record rather than a rule.
  if (declaring && (request.usingFeatures ?? []).length > 0) {
    return err(
      'election_on_a_declaration',
      `${definition.name} is declared now and settled later, and nothing on the declaration records which of ${casterId}'s features the casting uses; cast it without holding it, or leave the feature out`,
    );
  }

  // SRD: a Ritual "doesn't expend a spell slot" — nor a feat's free casting,
  // nor anything else. So there is no payment to choose and none is asked for;
  // `castingOf` has already refused a caller who named one. An item's casting
  // is the same shape for the same reason: it "doesn't expend any of the
  // user's spell slots", and what it *does* expend is the charge below.
  const payment =
    casting.ritual || route.kind === 'item' ? ok(null) : choosePayment(definition, route, request);
  if (!payment.ok) return payment;
  const freePool = payment.value;

  // The DC a later examiner rolls against, fixed now. It is the *chosen*
  // source's, so a Sage Fighter's Minor Illusion is seen through at the feat's
  // DC rather than at a class's — and a wand's illusion at the wand's.
  const offered = effectCheckFrom(definition.check, definition.name, numbers.saveDc);

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

  // **The charge stands exactly where the free casting stands**, and that is
  // the whole of why a casting from an item is not `expendCharges` followed by
  // a cast. Two commands are two ids, and the first would land while the
  // second refused: a wand aimed at nobody would be a charge gone and no
  // Fireball. Here it is inside the casting's own batch, after every
  // validation and before the first die.
  const charge = chargeSpend(route, casterId);
  if (charge !== null) {
    const stored = remaining(caster.resources, charge.key);
    if (stored < charge.amount) {
      return err(
        'exhausted',
        `${definition.name} costs ${charge.amount} charge${charge.amount === 1 ? '' : 's'} from this item and ${stored} ${stored === 1 ? 'is' : 'are'} left`,
      );
    }
    events.push({ type: 'resource-spent', id: casterId, key: charge.key, amount: charge.amount });
  }

  // **And whether the item works at all**, which stands exactly where the
  // charge stands and for the same reason: after every validation, before the
  // first die of the spell. SRD Wind Fan's "cumulative 20 percent chance of not
  // working" is the only line in the book that reaches here, and what it can
  // produce is an *outcome* rather than a refusal — the use happened, the fan
  // tore, and no casting came of it.
  const attempt = itemFailure(
    state,
    casterId,
    caster,
    definition,
    route,
    casting.castingTime,
    supply,
    stamp,
  );
  if (!attempt.ok) return attempt;
  events.push(...attempt.value.events);
  if (attempt.value.torn) {
    // No casting id, because there is no casting: nothing was cast, nothing is
    // running, and a caller that tries to hang an effect on this is stopped by
    // the type rather than by a `cast:undefined` in a log.
    //
    // **And nothing unverified**, though the definition has plenty. What that
    // list carries is the clauses of *this casting* a DM still has to apply —
    // Gust of Wind's unrolled Strength save, its untemplated Line — and handing
    // them to a narrator who has just been told the fan tore would be homework
    // for a spell nobody cast.
    return ok({ events, castingId: null, outcomes: [], unverified: [] });
  }

  // The identity is the wrapper's: `castOrRelease` established it over the
  // request the caller actually sent, and a second `identify` here would
  // fingerprint this derived command instead and refuse every honest retry.
  const cast = resolveCastWith(
    state,
    casterId,
    {
      spell: definition.name,
      // **The level the item casts it at, where an item is casting it.** No
      // slot decides it, so `castSpell` takes the spell's level as the cast
      // level — which for a Wand of Fireballs at three charges is level 5.
      level: route.kind === 'item' ? castLevel : definition.level,
      concentration: definition.concentration,
      castingTime: casting.castingTime,
      ...(casting.castingSeconds === undefined
        ? {}
        : { castingSeconds: casting.castingSeconds }),
      // SRD: a Ritual "doesn't expend a spell slot", and the log says which of
      // the reasons for skipping one this was — the value `SlotlessReason` has
      // carried since it was written and nothing has ever meant. `magic-item`
      // is the second of those: SRD "Spells Cast from Items" says the casting
      // "doesn't expend any of the user's spell slots", and the charge that
      // paid for it is a `resource-spent` in the same batch.
      ...(casting.ritual
        ? { slotless: 'ritual' as const }
        : route.kind === 'item'
          ? { slotless: 'magic-item' as const }
          : freePool !== null || definition.level === 0
            ? {
                slotless:
                  definition.level === 0 ? ('cantrip' as const) : ('special-ability' as const),
              }
            : {
                slotLevel: castLevel,
                ...(request.slotKind === undefined ? {} : { slotKind: request.slotKind }),
              }),
      route: routeLabel(route),
      ...(request.slotless === undefined ? {} : { slotless: request.slotless }),
      // A span of seconds, or a moment in the turn order. A definition carries
      // one or the other: Shield's "until the start of your next turn" is not
      // six seconds, and `resolveDuration` refuses to pretend otherwise where
      // there are no turns to anchor to.
      // **The band the slot falls in, not the printed number.** SRD Hunter's
      // Mark: "Your Concentration can last longer with a spell slot of level
      // 3–4 (up to 8 hours) or 5+ (up to 24 hours)." `durationSecondsAt` is
      // the one reader, so this and the readied-spell path cannot disagree
      // about which band a slot reaches.
      ...(definition.durationSeconds !== undefined
        ? {
            duration: {
              kind: 'seconds' as const,
              seconds: durationSecondsAt(definition, castLevel)!,
            },
          }
        : definition.durationUntil === undefined
          ? {}
          : { duration: riderDuration(definition.durationUntil, casterId)! }),
      // No `commandId`: the identity was established above and travels as the
      // stamp. Repeating it here would be a second name for one command.
      // The window, and everything settlement will need to finish the job
      // without the caller getting to restate what the spell was aimed at —
      // the space it appears in included, for a spell that holds one.
      ...(declaring
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
              // The fourth, and the one settlement could not possibly work
              // out again: where the caster said they were going.
              ...(request.teleportTo === undefined ? {} : { teleportTo: request.teleportTo }),
              // **And the numbers, for a casting an item made.** A class
              // casting's route is re-derived at settlement because it is a
              // fact about a sheet nothing between here and there can change.
              // An item's is not: the wand can be dropped, given away or
              // unattuned while the casting is held open, and a settlement
              // that asked the catalogue again would find no route at all. So
              // this is the one casting whose numbers are written down.
              ...(route.kind === 'item'
                ? { numbers, ...(route.ability === null ? {} : { ability: route.ability }) }
                : {}),
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
  if (declaring) {
    return ok({ events, castingId, outcomes: [], unverified });
  }

  const resolved = charged(
    resolveEffects(state, casterId, caster, definition, {
      castLevel,
      numbers,
      route,
      targets,
      unverified,
      supply,
      castingId,
      events,
      effects: running,
      ...(origin === null ? {} : { from: origin }),
      ...(fought === undefined ? {} : { fought }),
      ...(request.teleportTo === undefined ? {} : { teleportTo: request.teleportTo }),
      alters,
      // The casting this Reaction answers, as an **id** rather than as the record
      // that was read. The resolver looks it up again on the state its own events
      // have been folded into, so it settles exactly the casting the trigger
      // accepted and reads it as it now stands.
      ...(context.answers === undefined ? {} : { answers: context.answers }),
      ...(persists(definition) ? { becomesOngoing: ongoingWith() } : {}),
    }),
  );
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
  /** What the request calls the thing that wants the fact: a spell, or an item. */
  name: string,
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
      because: `${name} resolves differently against ${wanted.join(' or ')}`,
      satisfyWith: `declareCreatureType(${target}, …), or a creatureType when the creature is added`,
    });
  }
  return asked;
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
    case 'condition-immunity':
      return resolveConditionImmunityEffect(ctx, effect, target, world);
    case 'speed':
      return resolveSpeedEffect(ctx, effect, target, world);
    case 'action-rule':
      return resolveActionRuleEffect(ctx, effect, target, world);
    case 'attack-rider':
      return resolveAttackRiderEffect(ctx, effect, target, world);
    case 'heal':
      return resolveHealEffect(ctx, effect, target, victim, world);
    case 'turn-payout':
      return resolveTurnPayoutEffect(ctx, effect, target, world);
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
    case 'teleport':
      return resolveTeleportEffect(ctx, effect, target, world);

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
    /**
     * The spellcasting ability this casting rolls with, where the route is gone.
     *
     * Beside {@link context.numbers} and for the same reason, and it is a
     * separate field because an ability is not a number — see
     * `EffectContext.ability`. A casting an item made pins both at the
     * declaration, because the item that answered the question can be out of
     * the wielder's hand by the time the casting settles.
     */
    readonly ability?: Ability;
    /** The numbers this casting was made with, for every use after the first. */
    readonly numbers?: CastingNumbers;
    readonly targets: readonly CharacterId[];
    readonly unverified: string[];
    readonly supply: Supply;
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
     * Where a `teleport` effect puts its target.
     *
     * The caster's decision, stated at the casting and never derived — the
     * shape `damageType` and the designation already take. A held casting
     * pins it on the declaration, because settlement takes no fresh request
     * and a Dimension Door declared at one space must not settle at another.
     */
    readonly teleportTo?: Placement;
    /**
     * Which casting a Reaction spell answers, by id.
     *
     * Several castings may be open at once and several may belong to one
     * caster, so an `interrupt-casting` effect cannot read "the" casting. The
     * id was resolved before anything was spent and is looked up again inside
     * the resolver — see {@link EffectContext.answers}.
     */
    readonly answers?: string;
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
    /** What the caster's features do to this casting's damage — see EffectRun. */
    readonly alters?: CastingAlterations;
  },
): Result<SpellResolution> {
  const { castLevel, route, targets, unverified, supply, castingId, events } = context;

  const resolved = runEffects(state, casterId, caster, {
    origin: { kind: 'casting', castingId, definition },
    effects: context.effects ?? definition.effects,
    castLevel,
    route,
    // The chosen source's ability, from the route while there is one and from
    // what the casting pinned once there is not. The sheet's own is the last
    // resort and is right for exactly one case: a later use of a casting a
    // class made, where the route was never written down because it could
    // always be re-derived.
    //
    // **`caster` and not the sheet accessor**, which is the difference between
    // a value and a throw: SRD Grease runs its minute whether or not the
    // wizard does. A casting that has outlived its caster has no ability, and
    // the one effect that reads this refuses rather than resolving — the same
    // answer the sheet would have given for a caster who had none.
    ability: context.ability ?? route?.ability ?? caster?.sheet.spellcastingAbility ?? null,
    targets,
    unverified,
    supply,
    events,
    ...(context.numbers === undefined ? {} : { numbers: context.numbers }),
    ...(context.label === undefined ? {} : { label: context.label }),
    ...(context.from === undefined ? {} : { from: context.from }),
    ...(context.fought === undefined ? {} : { fought: context.fought }),
    ...(context.teleportTo === undefined ? {} : { teleportTo: context.teleportTo }),
    ...(context.answers === undefined ? {} : { answers: context.answers }),
    ...(context.alters === undefined ? {} : { alters: context.alters }),
  });
  if (!resolved.ok) return resolved;
  const { numbers, outcomes, held } = resolved.value;

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
        // **What the cast knows and the world will not say** — see
        // `OngoingSpell.aimed`. Every creature the casting hung something on
        // is left out of all three branches below, because `spellOn` reads
        // them off the world at every read; what is written here is the rest.
        //
        // **A casting that holds a point is aimed at nobody.** The force is
        // not on the goblin it hit, so a Dispel Magic aimed at the goblin must
        // not put it out.
        //
        // **A Range: Self casting stores its caster, and only when it is
        // holding nothing on them.** The caster is the half no world fact can
        // cover — SRD Vampiric Touch is Range: Self, attacks somebody else
        // every turn, and hangs nothing on the wizard at all — so without this
        // the spell would be on nobody. When the casting *is* holding
        // something there, Divine Favor's die for one, the world answers and
        // storing the name as well would be storing a derivation.
        //
        // The creatures such a casting caught are not here either, and they
        // used to be: SRD Sunbeam comes out of the caster and blinds whoever
        // the Line catches "until the start of your next turn", so a Dispel
        // Magic aimed at the blinded creature has to find it — and it does,
        // because the casting is holding the Blinded on them.
        aimed:
          becomes.on === 'caster'
            ? held.has(casterId)
              ? []
              : [casterId]
            : becomes.on === 'point'
              ? []
              : aimedAt(targets, outcomes, becomes.fromArea === true, held),
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

/** What a run of an effect list is: the list, whose it is, and what it reads. */
export interface EffectRun {
  /** A casting, or an item that confers without casting — see {@link EffectOrigin}. */
  readonly origin: EffectOrigin;
  /** The list to resolve. Never derived here: the caller knows which list it means. */
  readonly effects: readonly SpellEffect[];
  readonly castLevel: number;
  /** Null for a later use, and for an item, which rolls with {@link numbers}. */
  readonly route: CastingRoute | null;
  readonly ability: Ability | null;
  /**
   * The numbers this run is made with.
   *
   * Absent only where a route can still be asked — a class's first casting —
   * which is why an item supplies them and never omits them: an item has no
   * route to derive a save DC from, and a conferral rolls no D20 Test that
   * would want one.
   */
  readonly numbers?: CastingNumbers;
  readonly targets: readonly CharacterId[];
  readonly unverified: string[];
  readonly supply: Supply;
  /** The batch being built; every event this run produces is appended to it. */
  readonly events: GameEvent[];
  /** How the log reads, when the caller wants its own wording. */
  readonly label?: string;
  readonly from?: Point;
  readonly fought?: readonly CharacterId[];
  readonly teleportTo?: Placement;
  readonly answers?: string;
  /**
   * What the caster's features do to this casting's damage, and what electing
   * one of them costs — see {@link CastingAlterations} and `castingDamageCost`.
   *
   * **Supplied only where a casting is being made**, which is the whole of the
   * rule: SRD Overchannel says "on the turn you cast it", and the other four
   * alter the damage the casting deals rather than the debts it leaves. Both
   * casting paths supply it — `resolveOnTargets` for one made now,
   * `resolveDeclaredCast` for one made a minute ago — and the three runs that
   * are not castings omit it: an activation of a spell already running, an area
   * settling later, and an item's conferral. Each of those rolls what the
   * definition prints.
   *
   * A scheduled hit falling due is not in that list because it is not a run at
   * all: `collectDueDamage` rolls and lands the debt itself and reaches neither
   * {@link runEffects} nor {@link resolveEffects}. It prints the definition's
   * dice for the same reason the three above do — a casting's alterations are
   * spent on the turn it was made — and it would need its own reader to do
   * anything else.
   *
   * The one thing a declared casting cannot carry is an *elected* feature,
   * because nothing on the declaration records one; it is refused there rather
   * than dropped. See `resolveOnTargets`.
   */
  readonly alters?: CastingAlterations;
}

/** What a run leaves behind, for whoever has to write the record of it. */
export interface EffectRunOutcome {
  /** The world with this run's events folded in. */
  readonly state: GameState;
  /** The numbers it was made with, derived here where the caller supplied none. */
  readonly numbers: CastingNumbers;
  readonly outcomes: readonly SpellTargetOutcome[];
  /** Whom this run has left something of its own on — see `landedOn`. */
  readonly held: ReadonlySet<CharacterId>;
}

/**
 * Resolve one effect list over one gathered context: **the loop, and nothing
 * either side of it**.
 *
 * The half of {@link resolveEffects} that has nothing to do with castings.
 * Everything a casting needs and a conferral does not — the slot, the route,
 * the casting id, the ongoing record, Concentration — is the caller's, and
 * what is left here is the thing both of them actually do: gather the context
 * once, ask for any creature type an effect reads before a die moves, run each
 * effect on each target in order, and record how far the generator went.
 *
 * SRD "Magic Items": "Many items, such as Potions, **bypass the casting of a
 * spell** and confer the spell's effects with its usual duration." Two callers
 * because the book prints two sentences, and one loop because the effects
 * themselves are the same effects — an item with a resolver of its own would
 * be a second place for every rules fix to be missed.
 */
export function runEffects(
  state: GameState,
  casterId: CharacterId,
  /**
   * Null when the casting has outlived its caster — see {@link resolveEffects}.
   * An item's conferral always has one, because somebody used the item.
   */
  caster: CreatureState | null,
  run: EffectRun,
): Result<EffectRunOutcome> {
  const { origin, effects, castLevel, route, targets, unverified, supply, events } = run;
  const name =
    origin.kind === 'casting'
      ? origin.definition.name
      : origin.kind === 'item'
        ? origin.item.name
        : origin.name;
  // **Not a spell, so not a spell's level.** An item's printed line is the
  // same whoever uses it and a feature's dice are resolved off its class table
  // before they ever reach here, so neither has a slot or a caster level for a
  // `DiceScaling` to read — and `checkContent` refuses both of them every
  // field that would have read one.
  const level = origin.kind === 'casting' ? origin.definition.level : CONFERRED_LEVEL;
  const source =
    origin.kind === 'casting'
      ? castingSource(origin.definition.name, origin.castingId)
      : origin.kind === 'item'
        ? itemSource(origin.item.id)
        : featureSource(origin.feature);
  const label = run.label ?? name;

  /**
   * The caster's sheet, for the rolls that genuinely need one.
   *
   * A casting that outlives its caster keeps its *numbers* and loses its
   * *sheet*, and the two are not the same thing: a save DC is pinned, while
   * the dice a caster throws are thrown by a creature. Every effect that needs
   * this is refused before it gets here — `settleAreaEffects` checks, and a
   * test asserts no registered spell can reach it — so arriving here with no
   * caster is a programmer error rather than a rules dispute, and is loud.
   *
   * **And it is the sheet as it stands.** The substitution is made here, once,
   * rather than by each resolver that reaches for a sheet: this is the command,
   * and it is where the state is. The same object comes back for the
   * overwhelming majority of casters, because `sheetAsItStands` hands back the
   * creature's own sheet when nothing is setting a score — so a resolver that
   * compares identity still sees what it always saw.
   */
  const casterSheet = (): CreatureState => {
    if (caster === null) {
      throw new Error(
        `${name} needs its caster's sheet to resolve and ${casterId} has left the game; ` +
          'the caller should have refused this effect rather than reaching here',
      );
    }
    const standing = sheetAsItStands(state, casterId);
    return standing === null || standing === caster.sheet ? caster : { ...caster, sheet: standing };
  };

  /**
   * The casting this is, for the resolvers that cannot be anything else.
   *
   * {@link casterSheet}'s pattern and its argument. `attack` reaches for it
   * unconditionally, because the riders a settled outcome carries hang off a
   * casting and it is refused on an item by `checkContent` before any content
   * loads, so reaching here from an item is the validator and the resolver
   * disagreeing.
   *
   * **`save` reaches for it only on the casting arm.** An item may confer one
   * — SRD writes "must succeed on a DC 13 Constitution saving throw or have
   * the Poisoned condition" on a bottle — and the item arm files the one
   * condition the kind requires under `item:<id>`, with the repeat naming that
   * source and the deadline on the timer `useItem` writes. What still needs a
   * casting is everything *else* a failure can carry, and `checkContent`
   * refuses a conferral every one of those fields.
   *
   * **`condition` no longer reaches for it at all.** An item may confer one —
   * SRD Potion of Invisibility — so that resolver branches on the origin and
   * the item arm files the condition under `item:<id>`, with the deadline on
   * the timer `useItem` writes.
   *
   * **`save-damage` reaches for it only when it has a rider to hang.** An item
   * may confer one — the DC is the item's printed number — and a conferral may
   * carry no rider at all, so that resolver asks the question only on the
   * branch where the answer is needed.
   *
   * The two magic kinds and `teleport` are refused on an item too and never
   * ask — they read a name, which both origins have — which is the difference
   * between what the validator guarantees and what this accessor is for.
   */
  const casting = (): CastingOrigin => {
    if (origin.kind !== 'casting') {
      throw new Error(
        `${name} confers its effects without casting a spell, and an effect that needs the casting reached it; ` +
          'checkContent refuses that effect kind on an item and on a feature, so the validator and the resolver disagree',
      );
    }
    return origin;
  };

  // — what it does ———————————————————————————————————————————————————————
  let current = events.reduce(applyEvent, state);
  const outcomes: SpellTargetOutcome[] = [];
  // Whom this run has left something of its own on — the half of "what is this
  // casting on" the world holds, so the half the record does *not* store.
  // See {@link aimedAt}.
  const held = new Set<CharacterId>();
  const issuedBefore = supply.issuer.count;

  // **Derived once, at the casting, and read from the record ever after.**
  // The *chosen source's* ability, not the class's — a feat brings its own —
  // and a later use of the same casting takes the numbers it was made with
  // rather than asking a sheet that may have levelled since.
  const numbers: CastingNumbers = run.numbers ?? numbersFor(casterSheet().sheet, route!);

  // **Before the first die, and on every path into here.** `castOrRelease`
  // asks the same question earlier so an ordinary casting never reaches this
  // one; what arrives here instead is an area trigger settling a minute later,
  // a declared casting being settled, and an activation — each of which can
  // meet a creature nobody had typed when the spell was first cast. Asking
  // mid-loop would leave the generator advanced for the targets already
  // resolved, which is a refused operation that moved the world.
  const untyped = creatureTypeNeeds(state, name, effects, targets);
  if (untyped.length > 0) {
    return needsContext(
      'needs_context',
      `${label} cannot be resolved until ${untyped.length === 1 ? 'a fact is' : `${untyped.length} facts are`} established: ${untyped.map((n) => n.need).join('; ')}`,
      untyped,
    );
  }

  // Named once, for the resolvers that used to read them out of the enclosing
  // scope. Nothing here is derived that the caller could have derived: what
  // varies between a casting and a conferral is `origin`, and `name`, `level`
  // and `source` are the three questions every resolver asked of it.
  const ctx: EffectContext = {
    casterId,
    caster,
    casterSheet,
    origin,
    casting,
    name,
    level,
    source,
    castLevel,
    route,
    ability: run.ability,
    numbers,
    attackModifier: numbers.attackModifier,
    saveDc: numbers.saveDc,
    supply,
    label,
    unverified,
    events,
    outcomes,
    held,
    alters: run.alters ?? NO_ALTERATIONS(),
    ...(run.from === undefined ? {} : { from: run.from }),
    ...(run.fought === undefined ? {} : { fought: run.fought }),
    ...(run.teleportTo === undefined ? {} : { teleportTo: run.teleportTo }),
    ...(run.answers === undefined ? {} : { answers: run.answers }),
  };

  for (const target of targets) {
    for (const effect of effects) {
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

  return ok({ state: current, numbers, outcomes, held });
}

/**
 * Which of the creatures a spell was aimed at only the **cast** can say it is
 * on — `OngoingSpell.aimed`, and nothing wider.
 *
 * One bucket survives here: a target the spell reported nothing about. A
 * tracked spell resolves no effects at all and is still on whoever it was cast
 * on, which is how Darkvision gets dispelled, and there is no world fact that
 * says so — the casting owns nothing on them, for ever. A target every effect
 * reported as unaffected comes off: a creature that saved against Banishment
 * is not banished, and a spell is not on somebody it failed to touch.
 *
 * Sorted, so the record serialises identically however the targets arrived.
 *
 * **`held` is subtracted rather than unioned in**, which is the change IE-053
 * made and the reason the list finally stops needing maintenance. A creature
 * the casting is holding something on is on it by a fact `holdsNothingOf`
 * reads at every read, so storing them is storing a derivation — and a stored
 * derivation went stale exactly where the hand-written passes did not reach.
 *
 * It also settles the case that forced the union. SRD Hunter's Mark is Range:
 * 90 feet and the extra die is the **ranger's**, so the casting owns something
 * on a creature who is not in `targets` at all; a filter over the target list
 * dropped them and a Dispel Magic could reach the spell from nobody. The
 * derived half finds them without this function having to know they exist.
 *
 * **Standing in an area is not being cast on.** A tracked spell keeps a target
 * it reported nothing about because somebody *aimed* it there; an area spell
 * aimed at nobody has the geometry to thank, and a Web that has done nothing
 * to you yet is not on you.
 *
 * **`held` changes no answer today, and that is stated rather than tidied
 * away.** Every resolver that hangs something on a target also reports an
 * outcome for it, so the second test already excludes everyone the first one
 * would; the one effect that hangs a grant elsewhere — `attack-rider`, on the
 * caster — puts somebody in `held` who is not in `targets` at all. It is here
 * because the rule is one rule in all three branches of the record's write,
 * and a resolver that holds without reporting would otherwise store a name the
 * world was already answering for. The caster branch is where the same
 * subtraction *is* reachable, and `derived-on.test.ts` drives it.
 */
function aimedAt(
  targets: readonly CharacterId[],
  outcomes: readonly SpellTargetOutcome[],
  fromArea: boolean,
  held: ReadonlySet<CharacterId>,
): readonly CharacterId[] {
  if (fromArea) return [];
  return [...new Set(targets)]
    .filter(
      (target) =>
        !held.has(target) && !outcomes.some((outcome) => outcome.target === target),
    )
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

