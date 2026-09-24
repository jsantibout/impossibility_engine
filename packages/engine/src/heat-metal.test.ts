import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, isErr, type CharacterId, type Result } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { applyEvent, fold, type GameEvent, type GameState } from './events.js';
import { spellSlotKey } from './resources.js';
import { declaredCasting } from './spellcasting.js';
import { checkSpellDefinitionValue } from './spell-schema.js';
import { rollModesFor } from './standing.js';
import { activateSpell, equipItem, resolveSpell } from './commands.js';

/**
 * A thing taken out of a creature's hands against its will.
 *
 * > SRD Heat Metal: "Choose a manufactured metal object … Any creature in
 * > physical contact with the object takes 2d8 Fire damage when you cast the
 * > spell. Until the spell ends, you can take a Bonus Action on each of your
 * > later turns to deal this damage again if the object is within range.
 * >
 * > If a creature is holding or wearing the object and takes the damage from
 * > it, the creature must succeed on a Constitution saving throw or drop the
 * > object if it can. If it doesn't drop the object, it has Disadvantage on
 * > attack rolls and ability checks until the start of your next turn."
 *
 * The half of `what-a-creature-is-holding` that was left: hands are counted
 * and a casting may put a thing *into* one, and nothing took a thing **out**
 * of one. `dropConjured` ends a conjured thing, which ceases to exist; an
 * ordinary object has to land somewhere, and the floor is a thing the engine
 * keeps now.
 *
 * **The object is an equipped item**, which is the holding fact the engine
 * has: a weapon in a hand or armour on a body. An unattended metal gate is
 * still the table's, and the definition says so.
 *
 * **"If it can" is `handsFor`.** A thing wielded in a hand can be let go of; a
 * suit of armour is worn, takes no hands, and comes off with a doffing the
 * spell does not grant — so the wearer keeps it and takes the Disadvantage,
 * which is the second sentence read as the book's grammar reads it: the drop
 * it refers back to is the one the failure demanded.
 */

const id = (s: string): CharacterId => asCharacterId(s);
const DRUID = id('druid');
const KNIGHT = id('knight');
const THUG = id('thug');

const MACE = 'mace';
const BREASTPLATE = 'breastplate';

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 5,
  abilities: { str: 14, dex: 10, con: 10, int: 10, wis: 18, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'wis',
  ...over,
});

const added = (who: CharacterId): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 60,
  diesAtZero: false,
  creatureType: 'Humanoid',
});

const run = (
  log: readonly GameEvent[],
  command: (s: GameState) => Result<GameEvent[]>,
): readonly GameEvent[] => [...log, ...unwrap(command(fold('seed', log)), 'command')];

const BASE: readonly GameEvent[] = [
  added(DRUID),
  added(KNIGHT),
  added(THUG),
  {
    type: 'spellcasting-declared',
    id: DRUID,
    spellcasting: declaredCasting({
      ability: 'wis',
      classId: 'druid',
      prepared: ['heat-metal'],
    }),
  },
  {
    type: 'resource-pool-declared',
    id: DRUID,
    pool: { key: spellSlotKey(2), label: 'level 2 spell slot', max: 3, recovers: 'long-rest' },
  },
  {
    type: 'items-gained',
    id: KNIGHT,
    items: [{ id: BREASTPLATE, quantity: 1 }],
    source: 'the quartermaster',
  },
  { type: 'items-gained', id: THUG, items: [{ id: MACE, quantity: 1 }], source: 'the alley' },
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
  { type: 'landmark-added', name: 'the road', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: DRUID, placement: { from: { landmark: 'the road' }, feet: 0 } },
  { type: 'creature-placed', id: KNIGHT, placement: { from: { creature: DRUID }, feet: 10 } },
  { type: 'creature-placed', id: THUG, placement: { from: { creature: DRUID }, feet: 15 } },
  { type: 'sight-declared', from: DRUID, to: KNIGHT, seen: true },
  { type: 'sight-declared', from: DRUID, to: THUG, seen: true },
];

/** Both of them wearing and wielding what the spell will heat. */
const ARMED: readonly GameEvent[] = (() => {
  const worn = run(BASE, (s) => equipItem(s, SRD_CONTENT, KNIGHT, BREASTPLATE));
  return run(worn, (s) => equipItem(s, SRD_CONTENT, THUG, MACE));
})();

/** A fight, so the Bonus Action has a turn to be spent out of. */
const FIGHTING: readonly GameEvent[] = [
  ...ARMED,
  {
    type: 'combat-started',
    combatants: [
      { id: DRUID, initiative: 20, speed: 30 },
      { id: KNIGHT, initiative: 10, speed: 30 },
      { id: THUG, initiative: 5, speed: 30 },
    ],
  },
];

/** A bonus large enough to settle the save either way. */
const supply = (bonus: number, seed = 'heat') => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
  bonuses: [{ source: 'forced', flat: bonus }],
});

const FAILS = -40;
const SAVES = 40;

const cast = (
  state: GameState,
  at: CharacterId,
  object: string,
  bonus: number,
  over: Record<string, unknown> = {},
) =>
  resolveSpell(
    state,
    DRUID,
    { spellId: 'heat-metal', targets: [at], slotLevel: 2, object, ...over },
    supply(bonus),
  );

/** The Disadvantage this creature has on an attack roll right now. */
const attackModes = (state: GameState, who: CharacterId) =>
  rollModesFor(state, { family: 'attack', roller: who }).modes;

describe('what a definition may say about taking a thing out of a hand', () => {
  const definition = (rider: unknown): unknown => ({
    id: 'homebrew-scald',
    name: 'Homebrew Scald',
    level: 2,
    school: 'transmutation',
    castingTime: 'action',
    concentration: true,
    range: { kind: 'ranged', feet: 60 },
    targets: { count: 1 },
    effects: [{ kind: 'save', ability: 'con', ...(rider as object) }],
    durationSeconds: 60,
  });

  const codes = (rider: unknown): readonly string[] =>
    checkSpellDefinitionValue(definition(rider)).map((one) => one.code);

  it('accepts a drop the outcome forces', () => {
    expect(codes({ drops: {} })).toEqual([]);
  });

  it('accepts a drop with what happens instead where it cannot be dropped', () => {
    expect(
      codes({
        drops: {
          orElse: [{
            kind: 'mode',
            modifier: { mode: 'disadvantage', selector: { roll: 'attack', relation: 'roller' } },
            lasts: 'start-of-casters-next-turn',
          }],
        },
      }),
    ).toEqual([]);
  });

});

describe('Heat Metal', () => {
  it('burns the wearer of the breastplate the caster named', () => {
    const before = fold('seed', ARMED);
    const out = unwrap(cast(before, KNIGHT, BREASTPLATE, SAVES), 'the heat');
    const after = out.events.reduce(applyEvent, before);
    expect(after.creatures[KNIGHT]!.vitals.hp).toBeLessThan(before.creatures[KNIGHT]!.vitals.hp);
  });

  it('refuses an object the target is not wearing or wielding', () => {
    const out = cast(fold('seed', ARMED), KNIGHT, MACE, SAVES);
    expect(isErr(out) && out.code).toBe('not_equipped');
  });

  it('costs nothing when it refuses', () => {
    const before = fold('seed', ARMED);
    expect(isErr(cast(before, KNIGHT, MACE, SAVES))).toBe(true);
    expect(before.creatures[DRUID]!.resources.pools[spellSlotKey(2)]?.spent ?? 0).toBe(0);
  });

  it('makes a failed save drop a held mace', () => {
    const before = fold('seed', ARMED);
    const out = unwrap(cast(before, THUG, MACE, FAILS), 'the heat');
    const after = out.events.reduce(applyEvent, before);
    expect(after.creatures[THUG]!.equipped.map((worn) => worn.id)).not.toContain(MACE);
    expect(out.events.some((event) => event.type === 'item-dropped')).toBe(true);
  });

  it('leaves a dropped mace with no Disadvantage, because it was let go of', () => {
    const before = fold('seed', FIGHTING);
    const out = unwrap(cast(before, THUG, MACE, FAILS), 'the heat');
    const after = out.events.reduce(applyEvent, before);
    expect(attackModes(after, THUG)).toEqual([]);
  });

  it('gives the breastplate’s wearer Disadvantage instead, because armour cannot be dropped', () => {
    const before = fold('seed', FIGHTING);
    const out = unwrap(cast(before, KNIGHT, BREASTPLATE, FAILS), 'the heat');
    const after = out.events.reduce(applyEvent, before);
    expect(after.creatures[KNIGHT]!.equipped.map((worn) => worn.id)).toContain(BREASTPLATE);
    expect(attackModes(after, KNIGHT).map((one) => one.mode)).toContain('disadvantage');
  });

  it('leaves a creature that made its save holding the mace and unhindered', () => {
    const before = fold('seed', FIGHTING);
    const out = unwrap(cast(before, THUG, MACE, SAVES), 'the heat');
    const after = out.events.reduce(applyEvent, before);
    expect(after.creatures[THUG]!.equipped.map((worn) => worn.id)).toContain(MACE);
    expect(attackModes(after, THUG)).toEqual([]);
  });

  /**
   * "If a creature is holding or wearing the object **and takes the damage
   * from it**" — a thug who let the mace fall last round is touching nothing,
   * so the Bonus Action reaches him with neither the dice nor the clause about
   * not letting go. The refusal is what stops the second half punishing a
   * creature for keeping a thing lying at its feet.
   */
  it('refuses a later Bonus Action against a creature that has dropped it', () => {
    const started = fold('seed', FIGHTING);
    const first = unwrap(cast(started, THUG, MACE, FAILS), 'the heat');
    const log = [...FIGHTING, ...first.events];
    const state = fold('seed', log);
    expect(state.creatures[THUG]!.equipped.map((worn) => worn.id)).not.toContain(MACE);

    const record = Object.values(state.ongoing).find((one) => one.spellId === 'heat-metal')!;
    const again = activateSpell(
      state,
      DRUID,
      { castingId: record.castingId, targets: [THUG] },
      supply(SAVES, 'again'),
    );
    expect(isErr(again) && again.code).toBe('not_equipped');
    expect(state.creatures[THUG]!.vitals.hp).toBe(
      fold('seed', log).creatures[THUG]!.vitals.hp,
    );
  });

  /** And the casting itself is refused for the same reason, before a slot. */
  it('refuses a casting aimed at a creature not wearing or wielding the thing', () => {
    const out = cast(fold('seed', ARMED), THUG, BREASTPLATE, SAVES);
    expect(isErr(out) && out.code).toBe('not_equipped');
  });

  it('deals the damage again on a later Bonus Action', () => {
    const started = fold('seed', FIGHTING);
    const cast1 = unwrap(cast(started, KNIGHT, BREASTPLATE, SAVES), 'the heat');
    const log = [...FIGHTING, ...cast1.events];
    const state = fold('seed', log);
    const record = Object.values(state.ongoing).find((one) => one.spellId === 'heat-metal')!;

    const again = unwrap(
      activateSpell(
        state,
        DRUID,
        { castingId: record.castingId, targets: [KNIGHT] },
        supply(SAVES, 'again'),
      ),
      'the bonus action',
    );
    const after = again.events.reduce(applyEvent, state);
    expect(after.creatures[KNIGHT]!.vitals.hp).toBeLessThan(state.creatures[KNIGHT]!.vitals.hp);
    expect(after.combat?.budgets[DRUID]?.bonusAction).toBe(false);
  });
});
