import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, isErr, type CharacterId, type Result } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { declaredCasting } from './spellcasting.js';
import { extendContent } from './content.js';
import { checkSpellDefinitionValue } from './spell-schema.js';
import type { SpellDefinition } from './spell-definitions.js';
import { resolveMove, resolveSpell, settleAreaEffects } from './commands.js';

/**
 * The two words SRD Conjure Animals gates its pack on.
 *
 * > "Whenever the pack moves within 10 feet of a creature **you can see** and
 * > whenever a creature **you can see** enters a space within 10 feet of the
 * > pack or ends its turn there, **you can force** that creature to make a
 * > Dexterity saving throw."
 *
 * **Sight is read where the save is settled**, off the caster's own pairwise
 * line to the creature (`canSee`): a creature the caster cannot see is owed
 * nothing and the debt is discharged unrolled; one nobody has said anything
 * about is forced and the question is named beside the outcome — the ruling
 * Faerie Fire's "if the attacker can see it" and Hypnotic Pattern's gate
 * already take, so a silence never quietly shrinks the spell.
 *
 * **"Can" is the caster's word.** The settlement takes the creatures the
 * caster spares (`spare`), only off a trigger that prints the permission
 * (`casterMayDecline`): a spared debt is discharged with no save rolled and no
 * 3d10 dealt. A trigger that prints "must" refuses the word.
 */

const id = (s: string): CharacterId => asCharacterId(s);
const DRUID = id('druid');
const GOBLIN = id('goblin');

const sheet = (): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 10, con: 12, int: 10, wis: 18, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'wis',
});

const added = (who: CharacterId, side: string): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 80,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side,
});

/** A homebrew pack whose bite is not the caster's to hold back, and sees nobody. */
const HOUNDS: SpellDefinition = {
  id: 'homebrew-hounds',
  name: 'Homebrew Hounds',
  level: 3,
  school: 'conjuration',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 0 },
  area: { kind: 'sphere', radius: 0, origin: 'point' },
  areaMovesWithCaster: 30,
  effects: [],
  areaTrigger: {
    at: 'end-of-turn',
    onEntry: 'every-entry',
    onAreaEntry: true,
    within: 10,
    oncePerTurn: true,
    label: 'Homebrew Hounds',
    effects: [
      { kind: 'save-damage', ability: 'dex', damage: { dice: '3d10' }, damageType: 'slashing', onSuccess: 'none' },
    ],
  },
  durationSeconds: 600,
  unmodelled: ['what the hounds look like is the DM’s'],
};

const CONTENT = unwrap(extendContent(SRD_CONTENT, { spells: [HOUNDS] }), 'the hounds beside the book');

const PACK = { x: 120, y: 100, z: 0 };
const ONWARD = { x: 150, y: 100, z: 0 };

/** The moor, with whatever the druid has been said to see of the goblin. */
const moor = (sight: boolean | null): readonly GameEvent[] => [
  added(DRUID, 'party'),
  added(GOBLIN, 'goblins'),
  {
    type: 'spellcasting-declared',
    id: DRUID,
    spellcasting: declaredCasting({
      ability: 'wis',
      classId: 'druid',
      prepared: ['conjure-animals', 'homebrew-hounds'],
    }),
  },
  {
    type: 'resource-pool-declared',
    id: DRUID,
    pool: { key: 'spell-slot:3', label: 'level 3', max: 3, recovers: 'long-rest' },
  },
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
  { type: 'landmark-added', name: 'the moor', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: DRUID, placement: { from: { landmark: 'the moor' }, feet: 0 } },
  { type: 'creature-placed', id: GOBLIN, placement: { from: { point: { x: 155, y: 100, z: 0 } }, feet: 0 } },
  ...(sight === null ? [] : [{ type: 'sight-declared', from: DRUID, to: GOBLIN, seen: sight } as GameEvent]),
  {
    type: 'combat-started',
    combatants: [
      { id: DRUID, initiative: 20, speed: 30 },
      { id: GOBLIN, initiative: 10, speed: 30 },
    ],
  },
];

const supply = (seed: string) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: CONTENT,
});

const must = <T,>(result: Result<T>, what: string): T => unwrap(result, what);

/** The pack conjured and walked five feet short of the goblin, which is owed a save. */
const owed = (sight: boolean | null, spellId = 'conjure-animals') => {
  const setup = moor(sight);
  const cast = must(
    resolveSpell(fold('seed', setup), DRUID, { spellId, targets: [], slotLevel: 3, at: PACK }, supply('pack')),
    spellId,
  );
  const castingId = cast.castingId!;
  const log = [...setup, ...cast.events];
  const moved = must(
    resolveMove(
      fold('seed', log),
      DRUID,
      { placement: { from: { point: { x: 105, y: 100, z: 0 } }, feet: 0 }, alsoMoves: { castingId, to: ONWARD } },
      supply('walk'),
    ),
    'the walk',
  );
  const state = fold('seed', [...log, ...moved.events]) as GameState;
  expect(state.owedAreaEffects.map((one) => one.target)).toEqual([GOBLIN]);
  return { state, castingId };
};

const rolledFor = (events: readonly GameEvent[], who: CharacterId): boolean =>
  events.some((event) => event.type === 'roll-recorded' && event.who === who);

describe('"a creature you can see"', () => {
  it('forces the save on a creature the druid can see', () => {
    const { state } = owed(true);
    const out = must(settleAreaEffects(state, supply('bite')), 'settle');
    expect(out.outcomes[0]?.save).toBeDefined();
    expect(rolledFor(out.events, GOBLIN)).toBe(true);
  });

  it('owes nothing to a creature the druid cannot see, and discharges the debt unrolled', () => {
    const { state } = owed(false);
    const out = must(settleAreaEffects(state, supply('bite')), 'settle');
    expect(rolledFor(out.events, GOBLIN)).toBe(false);
    expect(out.outcomes.find((one) => one.target === GOBLIN)?.affected ?? false).toBe(false);
    expect(out.settled.map((one) => one.target)).toEqual([GOBLIN]);
  });

  it('forces it where nobody has said, and names the question', () => {
    const { state } = owed(null);
    const out = must(settleAreaEffects(state, supply('bite')), 'settle');
    expect(rolledFor(out.events, GOBLIN)).toBe(true);
    expect(out.unverified.some((line) => line.includes(GOBLIN) && line.includes('see'))).toBe(true);
  });
});

describe('"you can force"', () => {
  it('spares a creature the druid holds the pack back from', () => {
    const { state, castingId } = owed(true);
    const out = must(settleAreaEffects(state, supply('bite'), { spare: [{ castingId, target: GOBLIN }] }), 'settle');
    expect(rolledFor(out.events, GOBLIN)).toBe(false);
    expect(out.settled.map((one) => one.target)).toEqual([GOBLIN]);
    expect(out.events.some((event) => event.type === 'damage-taken')).toBe(false);
  });

  it('refuses to spare a creature nothing owes a save', () => {
    const { state, castingId } = owed(true);
    const out = settleAreaEffects(state, supply('bite'), { spare: [{ castingId, target: DRUID }] });
    expect(isErr(out) && out.code).toBe('nothing_to_spare');
  });

  it('refuses to spare anybody from a trigger that prints no "can"', () => {
    const { state, castingId } = owed(true, 'homebrew-hounds');
    const out = settleAreaEffects(state, supply('bite'), { spare: [{ castingId, target: GOBLIN }] });
    expect(isErr(out) && out.code).toBe('must_be_forced');
  });

  it('and a trigger that prints no sight reads none: the hounds bite an unseen goblin', () => {
    const { state } = owed(false, 'homebrew-hounds');
    const out = must(settleAreaEffects(state, supply('bite')), 'settle');
    expect(rolledFor(out.events, GOBLIN)).toBe(true);
  });
});

describe('what a definition may say', () => {
  const codes = (over: Record<string, unknown>): readonly string[] =>
    checkSpellDefinitionValue({ ...HOUNDS, areaTrigger: { ...HOUNDS.areaTrigger, ...over } }).map(
      (one) => one.code,
    );

  it('accepts both words written as true', () => {
    expect(codes({ onlyWhomCasterSees: true, casterMayDecline: true })).toEqual([]);
  });

  it('refuses either written as anything else', () => {
    expect(codes({ onlyWhomCasterSees: 'yes' })).toContain('malformed_field');
    expect(codes({ casterMayDecline: false })).toContain('malformed_field');
  });
});
