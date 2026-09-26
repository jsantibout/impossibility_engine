/**
 * The effect kind that adds a creature to the world rather than changing one.
 *
 * Alone in a module for the reason `spell-effect-teleport.ts` is: the arrival,
 * every refusal and every number are `summonCreature`'s, so there is nothing
 * here to share with a neighbour and a contrived family would be worse than a
 * module of one.
 *
 * **What this file is, measured by its body:** it works out the two numbers
 * SRD prints over a stat block, asks the order what rung its caster is on, and
 * calls the door. Everything else — reading the block out of content, pinning
 * the sheet and the printed hit points into `creature-added`, giving the
 * creature the summoner's side, refusing a stat block this world does not hold
 * — was built and shipped with `summonCreature` and is not repeated.
 *
 * **The bond is not written here.** A `creature-summoned` naming a casting
 * that is not yet in `state.ongoing` is a log the fold refuses, and a casting
 * writes its `spell-ongoing` record *after* its effects resolve. So this
 * records which creatures it raised and `resolveEffects` binds them through
 * `bindSummonsToCasting` once the record exists. That ordering is the whole
 * reason the two halves are apart, and it is the same ordering
 * `summonCreature` enforces for a DM doing it by hand.
 */

import { asCharacterId, err, ok, type Ability, type CharacterId, type Result } from '@ie/shared';
import type { Monster } from '@ie/srd';
import { applyEvent, type GameEvent, type GameState } from '../events.js';
import { type CommandIdentity, once } from '../idempotency.js';
import type { Placement, Point } from '../positioning.js';
import { creatureOf, spendFor } from './command.js';
import { mayAct } from './holds.js';
// `sceneFor` and `unknownCreature` are imported with the arrival below.
import { moveWithin, type MoveResolution } from './movement.js';
import type { Supply } from './casting.js';
import {
  type InlineStatBlock,
  type PrintedSummonSpeeds,
  rangeFeetAt,
  type SummonedNumber,
} from '../spell-definitions.js';
import type { PrintedSpeedMode } from '../monster.js';
import { distanceBetween } from '../positioning.js';
import { castingSource } from '../spells.js';
import type { ControlledBond, CreatureState } from '../state.js';
import { sceneFor, unknownCreature } from './command.js';
import { applyConditionTo } from './conditions.js';
import { removeCreatureEverywhere, settleDeparture, summonCreature } from './creatures.js';
import { undeadForbiddenProblem, walkingBodyProblem } from './spell-effect-creatures.js';
import { type EffectContext, type EffectOfKind } from './spell-effect-context.js';

/**
 * What the casting calls the creature it raised.
 *
 * **Derived from the casting rather than stated**, which is the one thing this
 * effect does that its neighbours do not, and it is derived for three reasons.
 * A casting id is unique and already in the log, so the key is stable across a
 * replay and a retry of the same casting resolves to the same creature rather
 * than a second one. An id a caller supplied would be a fact the request has
 * nowhere to put and one more thing for a model to get wrong. And it is
 * *pure*: no clock, no counter and no randomness, which is what an id the
 * engine mints has to be.
 *
 * The stat block's id is in it so that a spell raising two different creatures
 * has two different keys; two of the *same* block from one casting would
 * collide, and `addCreature` answers `already_present` rather than quietly
 * making one creature into two.
 */
export const summonedId = (castingId: string, monsterId: string): CharacterId =>
  asCharacterId(`${castingId}:${monsterId}`);

/** `base + perSpellLevel × level`, worked out once, at the cast. */
const scaled = (number: SummonedNumber, level: number): number =>
  number.base + number.perSpellLevel * level;

/**
 * A creature appears, out of the bestiary and on the spell's terms.
 *
 * **The level the numbers scale from is `castLevel`**, the level the casting
 * was actually made at, and not the spell's own: SRD Find Steed's "Use the
 * spell slot's level for the spell's level in the stat block" says so in as
 * many words, and it is the same number every `DiceScaling` in the catalogue
 * already reads. The Speeds the spell prints are gated on the same level —
 * "Fly 60 ft. (requires level 4+ spell)" — and withheld below it.
 *
 * **The Initiative count is read off the order, never taken from a caller,
 * and so is the seat.** SRD Find Steed's "it shares your Initiative count"
 * names a number the engine holds, and "the steed takes its turn immediately
 * after yours" names a *position* — so the creature is seated on the caster's
 * count, at the caster's tiebreak, immediately after the caster
 * (`CombatantInput.after`), and no tiebreak is invented to put it there. A
 * fight that is not running holds no order, and then the creature arrives with
 * no rung exactly as a summons with no stated total always has — the two
 * commands that give one still work, because the creature is in the game.
 *
 * **The form, where the spell leaves it to the caster**, is read off the
 * casting (`EffectContext.form`): `resolveSpell` has already refused a form
 * the spell does not admit and a spell that asks for none, before anything
 * was spent, so by here the id names a block the world holds.
 *
 * **One kept creature per spell.** SRD Find Steed: "If you already have a
 * steed from this spell, the steed is replaced by the new one"; SRD Find
 * Familiar: "If you cast this spell while you have a familiar, you instead
 * cause it to adopt a new eligible form." The creature this caster keeps from
 * this spell leaves first, through the ordinary departure, in the same batch
 * as the arrival — so the log says what happened in the order it happened.
 */
export function resolveSummonEffect(
  ctx: EffectContext,
  effect: EffectOfKind<'summon'>,
  world: GameState,
): Result<GameState> {
  const { name, events, outcomes, unverified, casterId } = ctx;
  const { definition, castingId } = ctx.casting();
  // A block the spell prints inside itself is keyed by the spell, under a
  // prefix no bestiary id wears — SRD Unseen Servant's servant is
  // `cast:N:inline:unseen-servant`, and a bestiary entry called that could not
  // be confused with it.
  const monsterId =
    effect.inline !== undefined
      ? `inline:${definition.id}`
      : typeof effect.monster === 'string'
        ? effect.monster
        : ctx.form;
  if (monsterId === undefined) {
    // Programmer error rather than a refusal: the pre-flight refuses a stated
    // form that is missing before anything is spent, so a run without one is a
    // caller that bypassed it.
    throw new Error(`${name}: a form the casting states was not checked before resolution`);
  }
  const id = summonedId(castingId, monsterId);

  let current = world;
  if (effect.kept !== undefined) {
    for (const held of keptBy(current, casterId, definition.id)) {
      const gone = removeCreatureEverywhere(current, held);
      if (!gone.ok) return gone;
      events.push(...gone.value);
      current = gone.value.reduce(applyEvent, current);
    }
  }

  // The caster's own rung, where the spell says the creature shares it and a
  // fight is running to share. `undefined` is silence rather than a refusal —
  // see `Summons.initiative`.
  const sharing =
    effect.sharesCastersInitiative === true
      ? current.combat?.order.find((combatant) => combatant.id === casterId)
      : undefined;
  const speeds = effect.speeds === undefined ? undefined : printedSpeedsAt(effect.speeds, ctx.castLevel);

  const arrived = summonCreature(current, ctx.supply.content, {
    id,
    monsterId,
    by: casterId,
    ...(effect.armorClass === undefined
      ? {}
      : { armorClass: scaled(effect.armorClass, ctx.castLevel) }),
    ...(effect.hitPoints === undefined
      ? {}
      : { hitPointMaximum: scaled(effect.hitPoints, ctx.castLevel) }),
    ...(effect.creatureType === undefined ? {} : { creatureType: effect.creatureType }),
    ...(effect.kept === undefined
      ? {}
      : {
          kept: {
            spell: definition.id,
            untilSummonerDies: effect.kept.untilSummonerDies === true,
            // SRD Find Familiar's pocket dimension, pinned so the two doors
            // that use it (`dismissKeptSummons`, `recallKeptSummons`) open
            // no book.
            ...(effect.kept.pocket === undefined ? {} : { pocket: effect.kept.pocket }),
            // And SRD Find Familiar's other sentence about the bond: "your
            // familiar can deliver the touch ... within 100 feet of you",
            // pinned for the same reason the pocket is.
            ...(effect.kept.delivers === undefined ? {} : { delivers: effect.kept.delivers }),
            // SRD Wild Companion: a lifetime the *feature* puts on the bond,
            // over what the spell prints — read off the route the casting came
            // by, and dated so a rest already taken does not count.
            ...(ctx.route?.kind === 'granted' &&
            ctx.route.grant.keptUntilSummonerLongRests === true
              ? { untilSummonerLongRests: true as const, since: current.elapsed }
              : {}),
          },
        }),
    ...(speeds === undefined ? {} : { speeds }),
    // **The casting's numbers, for a block whose lines are the summoner's** —
    // SRD Otherworldly Steed's Slam and Bonus Actions. Three numbers the
    // record already pins and the choice the caster stated, handed to the
    // door so the block is resolved before it is adapted; a block that prints
    // no mark is untouched by them. See `Summons.fromTheCasting`.
    fromTheCasting: {
      spellAttack: ctx.attackModifier,
      spellSave: ctx.saveDc,
      slotLevel: ctx.castLevel,
      ...(effect.creatureType === undefined ? {} : { choice: effect.creatureType }),
    },
    ...(effect.cannotAttack === true ? { forbidsAttacks: { label: definition.name } } : {}),
    ...(effect.inline === undefined
      ? {}
      : {
          block: {
            monster: inlineBlock(effect.inline, monsterId),
            ...(effect.inline.type === undefined ? { untyped: true as const } : {}),
          },
        }),
    // The count, the tiebreak and the seat, all the caster's own.
    ...(sharing === undefined
      ? {}
      : { initiative: sharing.initiative, tiebreak: sharing.tiebreak, after: casterId }),
  });
  if (!arrived.ok) return arrived;

  events.push(...arrived.value.events);
  unverified.push(...arrived.value.unverified.map((gap) => `${name}: ${gap}`));
  current = arrived.value.events.reduce(applyEvent, current);

  // **The conditions the sentence gives the creature itself** — SRD Unseen
  // Servant's "an Invisible … force". Sourced to the casting, so that what
  // ends the casting ends them, and applied after the arrival because a
  // condition needs a creature to stand on. A block content holds prints none
  // here: its conditions, if any, are the bestiary's own business.
  for (const condition of effect.inline?.conditions ?? []) {
    const applied = applyConditionTo(
      current,
      id,
      condition,
      castingSource(definition.name, castingId),
    );
    if (!applied.ok) return applied;
    events.push(...applied.value);
    current = applied.value.reduce(applyEvent, current);
  }

  // A creature a casting holds is bound after the record — see
  // `resolveEffects`. A kept one was bound at the arrival, on the terms it is
  // kept on, and waits for no record.
  if (effect.kept === undefined) ctx.summoned.push(id);
  outcomes.push({ target: casterId, affected: true });
  return ok(current);
}

/**
 * What a raising calls the creatures it makes: the casting, the block and a
 * count, since one casting may raise several of one block — SRD Animate Dead
 * at level 4 raises three. Derived for `summonedId`'s three reasons.
 */
const raisedId = (castingId: string, monsterId: string, ordinal: number): CharacterId =>
  asCharacterId(`${castingId}:${monsterId}:${ordinal}`);

/**
 * **Whose corpse keeps its record when it rises: the one predicate.**
 *
 * The owner, 2026-09-26: "a player character's corpse" — the character can
 * come back, so the body is not deleted when a Zombie stands up in it. The
 * engine's fact for a player character is a creature built from choices, a
 * `CharacterRecord`; a bestiary corpse — a Bandit — leaves the roster as it
 * always has. Widening the ruling to every corpse is this function returning
 * `true`, and nothing else moves.
 */
const keepsItsRecord = (body: CreatureState): boolean => body.character !== null;

/**
 * Bodies become creatures under the caster's control — SRD Animate Dead.
 *
 * **Runs once over the casting**, from `runEffects` rather than from the
 * per-target loop, because its subjects are two lists: the corpses named as
 * targets and the piles of bones stated as points (`EffectContext.bonesAt`),
 * and a casting of bones alone names no target for a loop to visit. The count
 * was held against the slot in the pre-flight (`too_many_raised`).
 *
 * **A corpse leaves and the creature arrives in its space.** "The target
 * becomes an Undead creature": the body's key goes through the ordinary
 * departure, so nothing dangles, and the block arrives through
 * `summonCreature` at the point the body lay — a raised corpse cannot be
 * raised again, which is the book's "each of the creatures must come from a
 * different corpse". A body nobody placed raises a creature nobody placed.
 *
 * **Except a player character's body, which keeps its key** (the owner,
 * 2026-09-26; {@link keepsItsRecord}): the departure settles everything it
 * always settled — holds, the map, the order — and writes no
 * `creature-removed`, so the record stays under the character's id, dead and
 * unplaced, and the creature that rises names it (`Summons.raisedFrom`). It
 * cannot be raised twice for a different reason: while that creature stands
 * the body walks (`body_walks`), and when it falls the fold lays the body
 * where it fell (`layBodiesWhereWalkersFell`). A body a running Gentle Repose
 * keeps is refused `cannot_become_undead`. Both are asked by the pre-flight,
 * before the slot or the rite, and again here, where the rule lives — which is
 * what refuses a rite declared before the fact that refuses it.
 *
 * **A creature the caster already controls through this spell is renewed,
 * not raised.** "This use of the spell reasserts your control": the bond
 * stands and only its clock moves, which is `summons-control-renewed` — a
 * second `creature-summoned` is a log the fold refuses, because a creature
 * bound twice would end at whichever bond ran out first. The pre-flight
 * admitted it as a target (`TargetRule.orControlled`).
 *
 * **Bones are a stated point inside the spell's range.** Nothing checks that
 * bones lie there — that is the table's fiction — but the creature is placed
 * where the caster pointed and the ruler measures it from the caster, so a
 * pile beyond the range is refused (`out_of_range`) before anything is
 * spent, the whole batch being one `Result`.
 *
 * Every creature this raises is bound `controlled` for the printed span from
 * the clock as it stands at the raising: for a rite of a minute, the minute
 * has passed.
 */
export function resolveRaiseEffect(
  ctx: EffectContext,
  effect: EffectOfKind<'raise'>,
  world: GameState,
): Result<GameState> {
  const { name, events, outcomes, unverified, casterId } = ctx;
  const { definition, castingId } = ctx.casting();
  let current = world;
  const controlled: ControlledBond = { spell: definition.id, until: current.elapsed + effect.controlSeconds };
  let ordinal = 0;

  for (const target of ctx.targets) {
    const body = current.creatures[target];
    if (body === undefined) return unknownCreature(target);

    const bond = body.summonedBy;
    if (bond != null && bond.by === casterId && bond.controlled?.spell === definition.id) {
      const renewed: GameEvent = { type: 'summons-control-renewed', id: target, by: casterId, until: controlled.until };
      events.push(renewed);
      current = applyEvent(current, renewed);
      outcomes.push({ target, affected: true });
      continue;
    }
    if (!body.vitals.dead) {
      // Programmer error rather than a refusal: the pre-flight refuses a live
      // target the caster does not control before anything is spent, so a
      // run that meets one is a caller that bypassed it.
      throw new Error(`${name}: ${target} is alive and not ${casterId}'s; the target rule should have refused it`);
    }

    // The pre-flight asked both before anything was spent; asked again here,
    // where the rule lives, for a rite declared before the fact that refuses
    // it — a body another rite raised first, a Gentle Repose laid during the
    // minute.
    const walking = walkingBodyProblem(current, target, name);
    if (!walking.ok) return walking;
    const kept = undeadForbiddenProblem(current, target, name);
    if (!kept.ok) return kept;

    // A player character's body keeps its key and its whole record, dead and
    // off the map, and settles everything a departure settles; any other
    // corpse leaves the game. See `keepsItsRecord`.
    const where = current.scene?.positions[target];
    const keeps = keepsItsRecord(body);
    const settled = keeps ? ok(settleDeparture(current, target)) : removeCreatureEverywhere(current, target);
    if (!settled.ok) return settled;
    events.push(...settled.value);
    current = settled.value.reduce(applyEvent, current);

    const arrived = summonCreature(current, ctx.supply.content, {
      id: raisedId(castingId, effect.fromCorpse, ordinal++),
      monsterId: effect.fromCorpse,
      by: casterId,
      controlled,
      ...(keeps ? { raisedFrom: target } : {}),
      ...(where === undefined ? {} : { placement: { from: { point: where }, feet: 0 } }),
    });
    if (!arrived.ok) return arrived;
    events.push(...arrived.value.events);
    unverified.push(...arrived.value.unverified.map((gap) => `${name}: ${gap}`));
    current = arrived.value.events.reduce(applyEvent, current);
    outcomes.push({ target, affected: true });
  }

  const piles = ctx.bonesAt ?? [];
  if (piles.length === 0) return ok(current);
  if (effect.fromBones === undefined) {
    throw new Error(`${name}: bones were stated and the pre-flight should have refused them`);
  }
  // A point means nothing without a scene to hold it, and the fold would
  // refuse the placement; asked here, before anything is raised, and asked the
  // way every command that needs a scene asks.
  const scene = sceneFor(current, casterId, `${name} to raise a creature from a pile of bones at a stated point`);
  if (!scene.ok) return scene;
  const reach = rangeFeetAt(definition, ctx.casterSheet().sheet.level);
  for (const pile of piles) {
    // The size is the block's and is not the caller's to state.
    const { size: _stated, ...placement } = pile;
    void _stated;
    const id = raisedId(castingId, effect.fromBones, ordinal++);
    const arrived = summonCreature(current, ctx.supply.content, {
      id,
      monsterId: effect.fromBones,
      by: casterId,
      controlled,
      placement,
    });
    if (!arrived.ok) return arrived;
    const after = arrived.value.events.reduce(applyEvent, current);
    if (reach !== null && after.scene !== null) {
      const apart = distanceBetween(after.scene, casterId, id);
      if (!apart.ok) return apart;
      if (apart.value > reach) {
        return err(
          'out_of_range',
          `${name} reaches ${reach} feet, and the bones are ${apart.value} feet from ${casterId}`,
        );
      }
    }
    events.push(...arrived.value.events);
    unverified.push(...arrived.value.unverified.map((gap) => `${name}: ${gap}`));
    current = after;
    outcomes.push({ target: casterId, affected: true });
  }
  return ok(current);
}

/**
 * The stat block a spell's sentence amounts to, in the shape the adapter reads.
 *
 * Every field the sentence does not print is the absence `InlineStatBlock`
 * documents: an unprinted ability is 10, an unprinted Speed is 0, no skills,
 * no defences, no senses, no lines, a rating of 0 — and a type the arrival
 * pins as none (`Summons.block.untyped`), with a placeholder here only because
 * the adapter's input requires the field. The numbers the sentence does not
 * print are the absences `InlineStatBlock` documents and nothing more: an
 * unprinted score is 10, so the Initiative and Passive Perception derived from
 * it are +0 and 10; the rating and its XP are 0, the lowest the schema
 * admits, because the book rates the servant nowhere; and the Proficiency
 * Bonus is 2, the lowest any creature has, read by nothing the servant can do.
 * The modifier and the save beside each score are the glossary's own
 * arithmetic, and the Hit Point total is the one the sentence prints.
 */
function inlineBlock(inline: InlineStatBlock, id: string): Monster {
  const score = (ability: Ability): number => inline.abilities[ability] ?? 10;
  const block = (ability: Ability) => {
    const modifier = Math.floor((score(ability) - 10) / 2);
    return { score: score(ability), modifier, save: modifier };
  };
  return {
    id,
    name: inline.name,
    size: inline.size,
    alternateSizes: [],
    type: inline.type ?? 'Construct',
    subtype: null,
    swarmMemberSize: null,
    alignment: 'Unaligned',
    ac: inline.armorClass,
    initiative: block('dex').modifier,
    hp: { average: inline.hitPoints, formula: null },
    speed: { walk: inline.walkingSpeed ?? 0, burrow: null, climb: null, fly: null, swim: null, hover: false },
    abilities: {
      str: block('str'),
      dex: block('dex'),
      con: block('con'),
      int: block('int'),
      wis: block('wis'),
      cha: block('cha'),
    },
    skills: {},
    vulnerabilities: [],
    resistances: [],
    immunities: [],
    gear: [],
    senses: [],
    passivePerception: 10 + block('wis').modifier,
    languages: [],
    cr: 0,
    crLabel: '0',
    xp: 0,
    proficiencyBonus: 2,
    traits: [],
    actions: [],
    bonusActions: [],
    reactions: [],
    legendaryActions: [],
  };
}

/** The creatures this caster keeps from this spell, sorted so the departure order is fixed. */
function keptBy(state: GameState, by: CharacterId, spell: string): readonly CharacterId[] {
  return (Object.keys(state.creatures) as CharacterId[]).sort().filter((who) => {
    const bond = state.creatures[who]?.summonedBy;
    return bond != null && bond.castingId === null && bond.by === by && bond.kept?.spell === spell;
  });
}

/** The Speeds the slot paid for: each printed mode whose level the casting reached. */
function printedSpeedsAt(
  speeds: PrintedSummonSpeeds,
  castLevel: number,
): Partial<Record<PrintedSpeedMode, number>> | undefined {
  const paid: Partial<Record<PrintedSpeedMode, number>> = {};
  for (const mode of ['walk', 'fly', 'climb', 'swim', 'burrow'] as const) {
    const printed = speeds[mode];
    if (printed === undefined) continue;
    if (printed.fromSpellLevel !== undefined && castLevel < printed.fromSpellLevel) continue;
    paid[mode] = printed.feet;
  }
  return Object.keys(paid).length === 0 ? undefined : paid;
}

// — the command a caster gives a creature a casting holds (W7-S19) ——————————

export interface CommandSummonsCommand extends CommandIdentity {
  /** The creature the casting holds and the caster commands. */
  readonly who: CharacterId;
  /**
   * Where it goes, measured as every destination is. Absent for a command
   * that moves it nowhere — an object interacted with where it stands.
   */
  readonly to?: Placement;
  /** The spaces the move passes through, where the ground asks — see `MoveCommand.route`. */
  readonly route?: readonly Point[];
  /**
   * What the creature does with an object, in the caller's words — SRD Unseen
   * Servant's "interact with an object". The engine holds no objects for a
   * servant to fetch, clean or pour, so this is reported as the table's rather
   * than performed; it is on the command so the log says what was ordered.
   */
  readonly interact?: string;
}

export interface CommandSummonsOutcome {
  readonly events: readonly GameEvent[];
  /** The move the creature made, or null for a command that moved it nowhere. */
  readonly moved: MoveResolution | null;
  readonly unverified: readonly string[];
  readonly duplicate: boolean;
}

/**
 * SRD Unseen Servant: "Once on each of your turns as a Bonus Action, you can
 * mentally command the servant to move up to 15 feet and interact with an
 * object." / "If you command the servant to perform a task that would move it
 * more than 60 feet away from you, the spell ends."
 *
 * **A charge on one creature's economy for deciding what another does**, which
 * no ordinary spender is told apart by: the Bonus Action is the caster's and is
 * spent where there is an economy to spend it from, the feet are the
 * creature's and come out of no budget of its own — `moveWithin`'s allowance
 * road, the one SRD Ready's response move already takes for a move the turn
 * budget knows nothing about — and "once on each of your turns" is the Bonus
 * Action's own rule. The price and the feet are read off the casting's record
 * (`OngoingSpell.commanded`), pinned at the cast, so a servant conjured under
 * last year's book is commanded on last year's terms.
 *
 * The sixty feet are not this door's: the fold reads `separated-beyond` off the
 * servant's arrival, as it reads Warding Bond's, and the spell ends whoever
 * moved it and however.
 *
 * Refused for a creature this caster does not hold through a running casting
 * (`not_your_summons`) and for one whose spell prints no command
 * (`not_commanded`); the destination's own refusals — the feet, the ground, a
 * space somebody stands in — are the move's and pass through under their own
 * codes.
 */
export function commandSummons(
  state: GameState,
  casterId: CharacterId,
  command: CommandSummonsCommand,
  supply: Supply,
): Result<CommandSummonsOutcome> {
  return once(
    state,
    `command-summons:${casterId}`,
    command,
    () => ({ events: [], moved: null, unverified: [], duplicate: true }),
    (stamp) => {
      const owedHere = mayAct(state, casterId);
      if (owedHere !== null) return owedHere;
      const creature = creatureOf(state, command.who);
      if (creature === null) return unknownCreature(command.who);
      const bond = creature.summonedBy;
      const record = bond?.castingId == null ? undefined : state.ongoing[bond.castingId];
      if (bond === null || bond.by !== casterId || record === undefined) {
        return err(
          'not_your_summons',
          `${command.who} is not a creature ${casterId} holds through a running casting`,
        );
      }
      if (record.commanded === undefined) {
        return err(
          'not_commanded',
          `${record.spell} prints no command for ${casterId} to give ${command.who}`,
        );
      }

      const events: GameEvent[] = [];
      const unverified: string[] = [];
      let current = state;
      // The caster's price, where there is an economy to pay it from — and
      // paid before the move, so a second command this turn is refused before
      // anything moves.
      if (current.combat !== null) {
        const spent = spendFor(current, casterId, record.commanded.costs);
        if (!spent.ok) return spent;
        events.push(spent.value);
        current = applyEvent(current, spent.value);
      }

      let moved: MoveResolution | null = null;
      if (command.to !== undefined) {
        // The move carries no id of its own: the command's stamp rides the
        // first event below, and a move stamped again would be a second claim
        // on one command.
        const walked = moveWithin(
          current,
          command.who,
          {
            placement: command.to,
            ...(command.route === undefined ? {} : { route: command.route }),
          },
          supply,
          record.commanded.moveUpTo,
        );
        if (!walked.ok) return walked;
        moved = walked.value;
        events.push(...walked.value.events);
        unverified.push(...walked.value.unverified);
      }

      if (command.interact !== undefined) {
        unverified.push(
          `${record.spell}: ${command.who} was commanded to ${command.interact}; the engine holds no objects, so what that comes to is the table's`,
        );
      }

      // The stamp rides the first event the command wrote, so a retry finds
      // it whether the command spent a Bonus Action or only moved.
      if (stamp !== null && events.length > 0) {
        events[0] = { ...events[0]!, command: stamp } as GameEvent;
      }
      return ok({ events, moved, unverified, duplicate: false });
    },
  );
}
