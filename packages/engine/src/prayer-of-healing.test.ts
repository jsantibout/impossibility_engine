import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, isErr, type CharacterId, type Result } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { applyEvent, fold, type GameEvent, type GameState } from './events.js';
import { declaredCasting } from './spellcasting.js';
import { hitDieKey, remaining, spellSlotKey } from './resources.js';
import { checkSpellDefinitionValue } from './spell-schema.js';
import { beginRest, endRest } from './rest.js';
import {
  advanceTime,
  pendingCastingsOf,
  resolveDeclaredCast,
  resolveSpell,
} from './commands.js';

/**
 * The three sentences of SRD Prayer of Healing that stood as debts.
 *
 * > "Up to five creatures of your choice who **remain within range for the
 * > spell's entire casting** gain **the benefits of a Short Rest** and also
 * > regain 2d8 Hit Points. **A creature can't be affected by this spell again
 * > until that creature finishes a Long Rest.**"
 *
 * **The benefits of a Short Rest** are the two the glossary prints — "Spend
 * Hit Point Dice" and "Special Feature … recharged by a Short Rest" — and are
 * the `rest-benefits` effect: the pools a Short Rest recovers are restored, and
 * the Hit Point Dice each creature spends are named at the casting
 * (`CastSpellRequest.hitDice`) and rolled by the engine, Constitution and all,
 * exactly as `endRest` rolls them.
 *
 * **"Until that creature finishes a Long Rest"** is a mark the spell leaves on
 * each creature it affected, which the target rule reads (`onceUntilLongRest`)
 * and a finished Long Rest takes away.
 *
 * **"Remain within range for the entire casting"** is read while the rite is
 * said: a target that is ever farther than the spell's range from the caster
 * during the ten minutes is marked strayed on the declaration, by the fold,
 * whoever moved, and the settlement passes it over.
 */

const id = (s: string): CharacterId => asCharacterId(s);
const CLERIC = id('cleric');
const HURT = id('hurt');
const ALLY = id('ally');

const sheet = (con = 14): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 10, con, int: 10, wis: 18, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'wis',
});

const added = (who: CharacterId): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 100,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side: 'party',
});

const SETUP: readonly GameEvent[] = [
  added(CLERIC),
  added(HURT),
  added(ALLY),
  { type: 'damage-taken', id: HURT, amount: 80, source: 'the road' },
  { type: 'damage-taken', id: ALLY, amount: 80, source: 'the road' },
  {
    type: 'spellcasting-declared',
    id: CLERIC,
    spellcasting: declaredCasting({ ability: 'wis', classId: 'cleric', prepared: ['prayer-of-healing'] }),
  },
  {
    type: 'resource-pool-declared',
    id: CLERIC,
    pool: { key: spellSlotKey(2), label: 'level 2 spell slot', max: 4, recovers: 'long-rest' },
  },
  // What a Short Rest gives back: a pool the hurt creature spent, and its dice.
  {
    type: 'resource-pool-declared',
    id: HURT,
    pool: { key: 'second-wind', label: 'Second Wind', max: 1, recovers: 'short-rest' },
  },
  { type: 'resource-spent', id: HURT, key: 'second-wind', amount: 1 },
  {
    type: 'resource-pool-declared',
    id: HURT,
    pool: { key: hitDieKey(10), label: 'Hit Point Dice (d10)', max: 5, recovers: 'long-rest' },
  },
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
  { type: 'landmark-added', name: 'the shrine', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: CLERIC, placement: { from: { landmark: 'the shrine' }, feet: 0 } },
  { type: 'creature-placed', id: HURT, placement: { from: { creature: CLERIC }, feet: 10, bearing: 0 } },
  { type: 'creature-placed', id: ALLY, placement: { from: { creature: CLERIC }, feet: 10, bearing: 180 } },
  { type: 'sight-declared', from: CLERIC, to: HURT, seen: true },
  { type: 'sight-declared', from: CLERIC, to: ALLY, seen: true },
];

const supply = (seed: string) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

const must = <T,>(result: Result<T>, what: string): T => unwrap(result, what);
const step = (state: GameState, events: readonly GameEvent[]): GameState => events.reduce(applyEvent, state);

interface Prayer {
  readonly targets?: readonly CharacterId[];
  readonly hitDice?: Readonly<Record<string, readonly string[]>>;
  /** What happens while the rite is said, before the ten minutes are up. */
  readonly during?: readonly GameEvent[];
}

/** Declared, the ten minutes waited out, settled. */
const prayed = (state: GameState, prayer: Prayer = {}) => {
  const declared = must(
    resolveSpell(
      state,
      CLERIC,
      {
        spellId: 'prayer-of-healing',
        targets: [...(prayer.targets ?? [HURT, ALLY])],
        slotLevel: 2,
        ...(prayer.hitDice === undefined ? {} : { hitDice: prayer.hitDice }),
      },
      supply('declare'),
    ),
    'declare',
  );
  let current = step(state, declared.events);
  const castingId = pendingCastingsOf(current)[0]!.castingId;
  current = step(current, prayer.during ?? []);
  current = step(current, must(advanceTime(current, 600, 'the rite'), 'ten minutes'));
  const settled = must(resolveDeclaredCast(current, castingId, supply('settle')), 'settle');
  return { state: step(current, settled.events), settled, castingId };
};

const hp = (state: GameState, who: CharacterId): number => state.creatures[who]!.vitals.hp;

describe('"the benefits of a Short Rest"', () => {
  it('gives back what a Short Rest recovers', () => {
    const before = fold('seed', SETUP);
    expect(remaining(before.creatures[HURT]!.resources, 'second-wind')).toBe(0);
    const { state } = prayed(before);
    expect(remaining(state.creatures[HURT]!.resources, 'second-wind')).toBe(1);
  });

  it('spends the Hit Point Dice the creature names, rolled with its Constitution', () => {
    const before = fold('seed', SETUP);
    const { state, settled } = prayed(before, { hitDice: { [HURT]: [hitDieKey(10), hitDieKey(10)] } });
    expect(remaining(state.creatures[HURT]!.resources, hitDieKey(10))).toBe(3);
    const dice = settled.events.filter((event) => event.type === 'roll-recorded' && event.label === 'Hit Die (d10)');
    expect(dice).toHaveLength(2);
    // 2d8 from the prayer and two d10 + 2 from the dice, each at least 3.
    expect(hp(state, HURT) - hp(before, HURT)).toBeGreaterThanOrEqual(2 + 6);
  });

  it('refuses a Hit Point Die the creature does not have, before anything is spent', () => {
    const out = resolveSpell(
      fold('seed', SETUP),
      CLERIC,
      { spellId: 'prayer-of-healing', targets: [HURT, ALLY], slotLevel: 2, hitDice: { [ALLY]: [hitDieKey(10)] } },
      supply('declare'),
    );
    expect(isErr(out) && out.code).toBe('not_enough_hit_dice');
  });

  it('refuses Hit Point Dice on a spell that gives no rest’s benefits', () => {
    const out = resolveSpell(
      fold('seed', [
        ...SETUP,
        {
          type: 'spellcasting-declared',
          id: CLERIC,
          spellcasting: declaredCasting({ ability: 'wis', classId: 'cleric', prepared: ['prayer-of-healing', 'healing-word'] }),
        },
        {
          type: 'resource-pool-declared',
          id: CLERIC,
          pool: { key: spellSlotKey(1), label: 'level 1 spell slot', max: 2, recovers: 'long-rest' },
        },
      ]),
      CLERIC,
      { spellId: 'healing-word', targets: [HURT], slotLevel: 1, hitDice: { [HURT]: [hitDieKey(10)] } },
      supply('declare'),
    );
    expect(isErr(out) && out.code).toBe('no_rest_benefits');
  });

  it('refuses Hit Point Dice named for a creature the prayer is not said over', () => {
    const out = resolveSpell(
      fold('seed', SETUP),
      CLERIC,
      { spellId: 'prayer-of-healing', targets: [ALLY], slotLevel: 2, hitDice: { [HURT]: [hitDieKey(10)] } },
      supply('declare'),
    );
    expect(isErr(out) && out.code).toBe('hit_dice_off_target');
  });
});

describe('"can\'t be affected by this spell again until that creature finishes a Long Rest"', () => {
  it('marks every creature it affected', () => {
    const { state } = prayed(fold('seed', SETUP));
    expect(state.creatures[HURT]?.untilLongRest).toEqual(['prayer-of-healing']);
    expect(state.creatures[CLERIC]?.untilLongRest).toBeUndefined();
  });

  it('refuses a second prayer over a creature it already affected, before the slot is spent', () => {
    const { state } = prayed(fold('seed', SETUP));
    const again = resolveSpell(
      state,
      CLERIC,
      { spellId: 'prayer-of-healing', targets: [HURT], slotLevel: 2 },
      supply('again'),
    );
    expect(isErr(again) && again.code).toBe('affected_until_long_rest');
  });

  it('lets it be affected again once it has finished a Long Rest', () => {
    let { state } = prayed(fold('seed', SETUP));
    state = step(state, must(beginRest(state, HURT, 'long'), 'lie down'));
    state = step(state, must(advanceTime(state, 8 * 3600, 'the night'), 'night'));
    state = step(state, must(endRest(state, HURT), 'wake').events);
    expect(state.creatures[HURT]?.untilLongRest).toBeUndefined();
    expect(
      isErr(resolveSpell(state, CLERIC, { spellId: 'prayer-of-healing', targets: [HURT], slotLevel: 2 }, supply('again'))),
    ).toBe(false);
  });

  it('is not lifted by a Short Rest', () => {
    let { state } = prayed(fold('seed', SETUP));
    state = step(state, must(beginRest(state, HURT, 'short'), 'sit down'));
    state = step(state, must(advanceTime(state, 3600, 'an hour'), 'hour'));
    state = step(state, must(endRest(state, HURT), 'up').events);
    expect(state.creatures[HURT]?.untilLongRest).toEqual(['prayer-of-healing']);
  });
});

describe('"who remain within range for the spell\'s entire casting"', () => {
  /** The ally walks forty feet off and back again during the ten minutes. */
  const wandered: readonly GameEvent[] = [
    { type: 'creature-moved', id: ALLY, placement: { from: { creature: CLERIC }, feet: 40, bearing: 180 }, forced: true },
    { type: 'creature-moved', id: ALLY, placement: { from: { creature: CLERIC }, feet: 10, bearing: 180 }, forced: true },
  ];

  it('passes over a creature that left the range during the rite, though it came back', () => {
    const before = fold('seed', SETUP);
    const { state, settled } = prayed(before, { during: wandered });
    expect(hp(state, ALLY)).toBe(hp(before, ALLY));
    expect(hp(state, HURT)).toBeGreaterThan(hp(before, HURT));
    expect(settled.outcomes.find((one) => one.target === ALLY)?.affected ?? false).toBe(false);
    // And it is not marked: the prayer did not affect it.
    expect(state.creatures[ALLY]?.untilLongRest).toBeUndefined();
  });

  it('notes the stray on the declaration as it happens', () => {
    const before = fold('seed', SETUP);
    const declared = must(
      resolveSpell(before, CLERIC, { spellId: 'prayer-of-healing', targets: [HURT, ALLY], slotLevel: 2 }, supply('d')),
      'declare',
    );
    const open = step(before, declared.events);
    const castingId = pendingCastingsOf(open)[0]!.castingId;
    expect(step(open, wandered.slice(0, 1)).pendingCastings[castingId]?.strayed).toEqual([ALLY]);
  });

  it('passes over a creature the caster walked away from', () => {
    const before = fold('seed', SETUP);
    const { state } = prayed(before, {
      during: [
        { type: 'creature-moved', id: CLERIC, placement: { from: { creature: HURT }, feet: 35, bearing: 90 }, forced: true },
        { type: 'creature-moved', id: CLERIC, placement: { from: { landmark: 'the shrine' }, feet: 0 }, forced: true },
      ],
    });
    expect(hp(state, HURT)).toBe(hp(before, HURT));
    expect(hp(state, ALLY)).toBe(hp(before, ALLY));
  });
});

describe('what a definition may say', () => {
  const codes = (over: Record<string, unknown>): readonly string[] =>
    checkSpellDefinitionValue({ ...SRD_CONTENT.spell('prayer-of-healing')!, ...over }).map((one) => one.code);

  it('takes the book as written', () => {
    expect(codes({})).toEqual([]);
  });

  it('refuses a rest whose benefits the engine does not know', () => {
    expect(codes({ effects: [{ kind: 'rest-benefits', rest: 'nap' }] })).toContain('unknown_rest');
  });

  it('refuses "remain within range" on a casting with no rite to remain through', () => {
    expect(
      codes({ castingTime: 'action', castingSeconds: undefined, targets: { count: 5, self: true, remainInRange: true } }),
    ).toContain('nothing_to_remain_through');
  });
});
