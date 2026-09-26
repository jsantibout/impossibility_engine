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

import { asCharacterId, ok, type Ability, type CharacterId, type Result } from '@ie/shared';
import type { Monster } from '@ie/srd';
import { applyEvent, type GameState } from '../events.js';
import type {
  InlineStatBlock,
  PrintedSummonSpeeds,
  SummonedNumber,
} from '../spell-definitions.js';
import type { PrintedSpeedMode } from '../monster.js';
import { castingSource } from '../spells.js';
import { applyConditionTo } from './conditions.js';
import { removeCreatureEverywhere, summonCreature } from './creatures.js';
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
