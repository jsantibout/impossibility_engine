import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import {
  asCharacterId,
  contextRequestsOf,
  expect as unwrap,
  isErr,
  type CharacterId,
  type Result,
} from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { applyEvent, fold, type GameEvent, type GameState } from './events.js';
import { spellSlotKey } from './resources.js';
import { declaredCasting } from './spellcasting.js';
import { checkSpellDefinitionValue } from './spell-schema.js';
import { checkContent } from './content.js';
import { rollModesFor } from './standing.js';
import { contactNow } from './objects.js';
import {
  activateSpell,
  declareContact,
  declareObject,
  equipItem,
  resolveSpell,
  resolveTurn,
} from './commands.js';

/**
 * SRD Heat Metal's two facts nobody's sheet holds (E-L1, the owner's answers
 * of 2026-10-03).
 *
 * > "Choose a **manufactured metal object**, such as a metal weapon or a suit
 * > of Heavy or Medium metal armor, that you can see within range. … **Any
 * > creature in physical contact with the object** takes 2d8 Fire damage when
 * > you cast the spell."
 *
 * **Metal is a mark in the data.** Every SRD weapon and armour row says
 * whether it is metal (`CatalogueItem.metal`), read off the SRD's own crafting
 * tools; every substance in the Object Armor Class table says so too
 * (`ObjectMaterial.metal`), and a declared object pins the answer on its
 * record. `TargetRule.metal` refuses a thing marked otherwise, before a slot.
 *
 * **Contact is the DM's to state.** Who is touching an unattended iron gate is
 * a fact about the room, declared through `declareContact` as a momentary
 * fact — the turn and the clock, `fall-declared`'s rule — and a casting whose
 * 2d8 would land on somebody nobody has named asks rather than guessing.
 * `TargetRule.inContact` is the clause that turns the casting at the object
 * into dice on everybody touching it.
 */

const id = (s: string): CharacterId => asCharacterId(s);
const DRUID = id('druid');
const KNIGHT = id('knight');
const THUG = id('thug');
const GATE = id('the-gate');
const DOOR = id('the-door');

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

const BASE: readonly GameEvent[] = (() => {
  const people: readonly GameEvent[] = [
    added(DRUID),
    added(KNIGHT),
    added(THUG),
    {
      type: 'spellcasting-declared',
      id: DRUID,
      spellcasting: declaredCasting({ ability: 'wis', classId: 'druid', prepared: ['heat-metal'] }),
    },
    {
      type: 'resource-pool-declared',
      id: DRUID,
      pool: { key: spellSlotKey(2), label: 'level 2 spell slot', max: 3, recovers: 'long-rest' },
    },
    {
      type: 'items-gained',
      id: THUG,
      items: [{ id: 'club', quantity: 1 }],
      source: 'the alley',
    },
    {
      type: 'items-gained',
      id: KNIGHT,
      items: [{ id: 'shield', quantity: 1 }],
      source: 'the quartermaster',
    },
  ];
  const gate = run(people, (s) =>
    declareObject(s, SRD_CONTENT, GATE, { name: 'the iron gate', material: 'iron', size: 'large', build: 'resilient' }),
  );
  const door = run(gate, (s) =>
    declareObject(s, SRD_CONTENT, DOOR, { name: 'the oak door', material: 'wood', size: 'large', build: 'resilient' }),
  );
  const club = run(door, (s) => equipItem(s, SRD_CONTENT, THUG, 'club'));
  const shield = run(club, (s) => equipItem(s, SRD_CONTENT, KNIGHT, 'shield'));
  return [
    ...shield,
    { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
    { type: 'landmark-added', name: 'the road', at: { x: 100, y: 100, z: 0 } },
    { type: 'creature-placed', id: DRUID, placement: { from: { landmark: 'the road' }, feet: 0 } },
    { type: 'creature-placed', id: KNIGHT, placement: { from: { creature: DRUID }, feet: 10 } },
    { type: 'creature-placed', id: THUG, placement: { from: { creature: DRUID }, feet: 15 } },
    { type: 'creature-placed', id: GATE, placement: { from: { creature: DRUID }, feet: 20 } },
    { type: 'creature-placed', id: DOOR, placement: { from: { creature: DRUID }, feet: 25 } },
    { type: 'sight-declared', from: DRUID, to: KNIGHT, seen: true },
    { type: 'sight-declared', from: DRUID, to: THUG, seen: true },
    { type: 'sight-declared', from: DRUID, to: GATE, seen: true },
    { type: 'sight-declared', from: DRUID, to: DOOR, seen: true },
  ];
})();

const FIGHTING: readonly GameEvent[] = [
  ...BASE,
  {
    type: 'combat-started',
    combatants: [
      { id: DRUID, initiative: 20, speed: 30 },
      { id: KNIGHT, initiative: 10, speed: 30 },
      { id: THUG, initiative: 5, speed: 30 },
    ],
  },
];

const supply = (bonus: number, seed = 'heat') => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
  bonuses: [{ source: 'forced', flat: bonus }],
});

const FAILS = -40;

const heat = (state: GameState, at: CharacterId, over: Record<string, unknown> = {}) =>
  resolveSpell(state, DRUID, { spellId: 'heat-metal', targets: [at], slotLevel: 2, ...over }, supply(FAILS));

const slotsSpent = (state: GameState): number =>
  state.creatures[DRUID]!.resources.pools[spellSlotKey(2)]?.spent ?? 0;

const hp = (state: GameState, who: CharacterId): number => state.creatures[who]!.vitals.hp;

describe('what a definition may say about the object it heats', () => {
  const definition = (targets: Record<string, unknown>, effects: unknown[] = []): unknown => ({
    id: 'homebrew-scald',
    name: 'Homebrew Scald',
    level: 2,
    school: 'transmutation',
    castingTime: 'action',
    concentration: true,
    range: { kind: 'ranged', feet: 60 },
    targets: { count: 1, ...targets },
    effects: [{ kind: 'auto-damage', damage: { dice: '2d8' }, damageType: 'fire' }, ...effects],
    durationSeconds: 60,
  });
  const codes = (targets: Record<string, unknown>, effects: unknown[] = []): readonly string[] =>
    checkSpellDefinitionValue(definition(targets, effects)).map((one) => one.code);

  it('accepts a metal object the damage reaches through whoever touches it', () => {
    expect(codes({ metal: true, inContact: true })).toEqual([]);
    expect(codes({ metal: true }, [{ kind: 'save', ability: 'con', drops: {} }])).toEqual([]);
  });

  it('refuses a flag that is not true', () => {
    expect(codes({ metal: false, inContact: true })).toContain('malformed_field');
    expect(codes({ inContact: 'yes' })).toContain('malformed_field');
  });

  it('refuses a material rule with no object for it to read', () => {
    expect(codes({ metal: true })).toContain('metal_without_an_object');
  });
});

describe('what content may say an item or a substance is made of', () => {
  it('refuses a metal mark that is not a yes or a no', () => {
    const problems = checkContent({
      items: [
        { id: 'odd-blade', name: 'Odd Blade', kind: 'gear', weightLb: 1, costCp: 1, armor: null, weapon: null, contents: [], metal: 'iron' as unknown as boolean },
      ],
      objectMaterials: [{ id: 'voidsteel', name: 'Voidsteel', armorClass: 20, metal: 1 as unknown as boolean }],
    });
    expect(problems.map((one) => one.field)).toEqual(
      expect.arrayContaining(['items[odd-blade].metal', 'objectMaterials[voidsteel].metal']),
    );
  });
});

describe('Heat Metal on a thing in somebody’s hand', () => {
  it('refuses a club, which no smith makes, before the slot', () => {
    const before = fold('seed', BASE);
    const out = heat(before, THUG, { object: 'club' });
    expect(isErr(out) && out.code).toBe('not_metal');
    expect(slotsSpent(before)).toBe(0);
  });

  it('casts at a Shield, whose material the book never states, and says it could not check', () => {
    const before = fold('seed', BASE);
    const out = unwrap(heat(before, KNIGHT, { object: 'shield' }), 'the shield');
    expect(out.unverified.some((line) => /recorded whether Shield is metal/.test(line))).toBe(true);
    const after = out.events.reduce(applyEvent, before);
    expect(hp(after, KNIGHT)).toBeLessThan(hp(before, KNIGHT));
  });
});

describe('Heat Metal on an unattended object', () => {
  it('pins the substance on the declared object, so the fold reads no catalogue', () => {
    const added = BASE.find((event) => event.type === 'creature-added' && event.id === GATE);
    expect(added).toMatchObject({ material: { id: 'iron', metal: true } });
    expect(fold('seed', BASE).creatures[GATE]!.material).toEqual({ id: 'iron', metal: true, flammable: false });
  });

  it('refuses a wooden door before the slot', () => {
    const before = fold('seed', BASE);
    const out = heat(before, DOOR);
    expect(isErr(out) && out.code).toBe('not_metal');
    expect(slotsSpent(before)).toBe(0);
  });

  it('asks who is touching the gate before a die or a slot', () => {
    const before = fold('seed', BASE);
    const out = heat(before, GATE);
    expect(isErr(out) && out.code).toBe('contact_unstated');
    expect(contextRequestsOf(out).map((one) => [one.kind, one.subject])).toEqual([['scene', GATE]]);
    expect(slotsSpent(before)).toBe(0);
  });

  it('refuses an item named beside the object it is aimed at', () => {
    const touched = fold('seed', run(BASE, (s) => declareContact(s, GATE, [THUG])));
    const out = heat(touched, GATE, { object: 'mace' });
    expect(isErr(out) && out.code).toBe('object_is_the_target');
  });

  it('burns everybody the DM said is touching it, and not the gate, with no save to drop it', () => {
    const log = run(BASE, (s) => declareContact(s, GATE, [THUG, KNIGHT]));
    const before = fold('seed', log);
    const out = unwrap(heat(before, GATE), 'the heat');
    const after = out.events.reduce(applyEvent, before);
    expect(hp(after, THUG)).toBeLessThan(hp(before, THUG));
    expect(hp(after, KNIGHT)).toBeLessThan(hp(before, KNIGHT));
    expect(hp(after, GATE)).toBe(hp(before, GATE));
    // Nobody holds a gate, so the clause about letting go of it is nobody's.
    expect(out.events.some((event) => event.type === 'item-dropped')).toBe(false);
    expect(rollModesFor(after, { family: 'attack', roller: THUG }).modes).toEqual([]);
    expect(slotsSpent(after)).toBe(1);
  });

  it('burns nobody when the DM says nobody is touching it', () => {
    const log = run(BASE, (s) => declareContact(s, GATE, []));
    const before = fold('seed', log);
    const out = unwrap(heat(before, GATE), 'the heat');
    const after = out.events.reduce(applyEvent, before);
    expect(hp(after, THUG)).toBe(hp(before, THUG));
    expect(hp(after, KNIGHT)).toBe(hp(before, KNIGHT));
    expect(slotsSpent(after)).toBe(1);
  });

  it('asks again on a later turn, because a touch is a moment', () => {
    const touched = run(FIGHTING, (s) => declareContact(s, GATE, [THUG]));
    const cast = [...touched, ...unwrap(heat(fold('seed', touched), GATE), 'the heat').events];
    const record = Object.values(fold('seed', cast).ongoing).find((one) => one.spellId === 'heat-metal')!;
    // Round two: the druid's turn again.
    let later: readonly GameEvent[] = cast;
    for (let turn = 0; turn < 3; turn += 1) {
      const step = `turn ${turn}`;
      later = [...later, ...unwrap(resolveTurn(fold('seed', later), supply(0, step), { commandId: step }), step).events];
    }
    const state = fold('seed', later);
    expect(state.combat?.order[state.combat.turnIndex]?.id).toBe(DRUID);

    const asked = activateSpell(state, DRUID, { castingId: record.castingId, targets: [GATE] }, supply(FAILS, 'again'));
    expect(isErr(asked) && asked.code).toBe('contact_unstated');
    expect(state.combat?.budgets[DRUID]?.bonusAction).toBe(true);

    const told = fold('seed', run(later, (s) => declareContact(s, GATE, [KNIGHT])));
    const again = unwrap(
      activateSpell(told, DRUID, { castingId: record.castingId, targets: [GATE] }, supply(FAILS, 'again')),
      'the bonus action',
    );
    const after = again.events.reduce(applyEvent, told);
    expect(hp(after, KNIGHT)).toBeLessThan(hp(told, KNIGHT));
    expect(hp(after, THUG)).toBe(hp(told, THUG));
  });
});

describe('declareContact', () => {
  it('refuses a thing that is not a declared object', () => {
    const out = declareContact(fold('seed', BASE), KNIGHT, [THUG]);
    expect(isErr(out) && out.code).toBe('not_an_object');
  });

  it('refuses an object said to be touching it, and a creature nobody added', () => {
    const state = fold('seed', BASE);
    const object = declareContact(state, GATE, [DOOR]);
    expect(isErr(object) && object.code).toBe('not_a_creature');
    const nobody = declareContact(state, GATE, [id('ghost')]);
    expect(isErr(nobody)).toBe(true);
  });

  it('holds for the turn it was said on, and not the next one in the same round', () => {
    const said = run(FIGHTING, (s) => declareContact(s, GATE, [THUG]));
    expect(contactNow(fold('seed', said), GATE)).toEqual([THUG]);
    const next = [
      ...said,
      ...unwrap(resolveTurn(fold('seed', said), supply(0, 'next'), { commandId: 'next' }), 'next').events,
    ];
    const state = fold('seed', next);
    // The clock has not moved within the round, so it is the turn that closes it.
    expect(state.elapsed).toBe(fold('seed', said).elapsed);
    expect(contactNow(state, GATE)).toBeNull();
  });

  it('writes the creatures sorted and once each', () => {
    const out = unwrap(declareContact(fold('seed', BASE), GATE, [THUG, KNIGHT, THUG]), 'contact');
    expect(out).toEqual([{ type: 'contact-declared', object: GATE, creatures: [KNIGHT, THUG] }]);
  });
});

/**
 * A second hand on a thing somebody else is wearing or wielding — the
 * coordinator applying the owner's "the DM states contact" ruling to equipped
 * items (2026-10-03). The holder is the contact the engine already reads; the
 * DM may name more, through the same door, by the holder and the item.
 */
describe('Heat Metal on a thing somebody wears, with a second hand on it', () => {
  const DRUID_TOO = id('druid-too');
  /** The knight in a breastplate as well as the shield, and a bystander nobody names. */
  const ARMOURED: readonly GameEvent[] = (() => {
    const log: readonly GameEvent[] = [
      ...BASE,
      added(DRUID_TOO),
      { type: 'creature-placed', id: DRUID_TOO, placement: { from: { creature: DRUID }, feet: 30 } },
      { type: 'items-gained', id: KNIGHT, items: [{ id: 'breastplate', quantity: 1 }], source: 'the quartermaster' },
    ];
    // In a fight, because the wearer's failed save hangs Disadvantage until the
    // start of the caster's next turn, which only a fight has.
    return [
      ...run(log, (s) => equipItem(s, SRD_CONTENT, KNIGHT, 'breastplate')),
      FIGHTING[FIGHTING.length - 1]!,
    ];
  })();

  it('burns the wearer as before, the creature the DM named on it, and nobody else', () => {
    const log = run(ARMOURED, (s) => declareContact(s, KNIGHT, [THUG], { item: 'breastplate' }));
    const before = fold('seed', log);
    const out = unwrap(heat(before, KNIGHT, { object: 'breastplate' }), 'the heat');
    const after = out.events.reduce(applyEvent, before);
    expect(hp(after, KNIGHT)).toBeLessThan(hp(before, KNIGHT));
    expect(hp(after, THUG)).toBeLessThan(hp(before, THUG));
    expect(hp(after, DRUID_TOO)).toBe(hp(before, DRUID_TOO));
    expect(hp(after, DRUID)).toBe(hp(before, DRUID));
    // The wearer still cannot take armour off, so the failed save hangs the
    // Disadvantage on him; the hand that touched it holds nothing and takes
    // only the burn.
    expect(rollModesFor(after, { family: 'attack', roller: KNIGHT }).modes.length).toBeGreaterThan(0);
    expect(rollModesFor(after, { family: 'attack', roller: THUG }).modes).toEqual([]);
  });

  it('burns only the wearer where nobody is named, or somebody is named on another thing', () => {
    for (const log of [
      ARMOURED,
      run(ARMOURED, (s) => declareContact(s, KNIGHT, [THUG], { item: 'shield' })),
    ]) {
      const before = fold('seed', log);
      const out = unwrap(heat(before, KNIGHT, { object: 'breastplate' }), 'the heat');
      const after = out.events.reduce(applyEvent, before);
      expect(hp(after, KNIGHT)).toBeLessThan(hp(before, KNIGHT));
      expect(hp(after, THUG)).toBe(hp(before, THUG));
    }
  });

  it('refuses a thing the holder is not wearing or wielding, and an item named on a declared object', () => {
    const state = fold('seed', ARMOURED);
    const unworn = declareContact(state, THUG, [KNIGHT], { item: 'breastplate' });
    expect(isErr(unworn) && unworn.code).toBe('not_equipped');
    const onGate = declareContact(state, GATE, [KNIGHT], { item: 'breastplate' });
    expect(isErr(onGate) && onGate.code).toBe('object_holds_nothing');
  });

  it('pins the item on the statement', () => {
    const out = unwrap(declareContact(fold('seed', ARMOURED), KNIGHT, [THUG], { item: 'breastplate' }), 'contact');
    expect(out).toEqual([{ type: 'contact-declared', object: KNIGHT, item: 'breastplate', creatures: [THUG] }]);
  });
});
