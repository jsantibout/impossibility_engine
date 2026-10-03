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
import { extendContent } from './content.js';
import { attunedItems, attuneItem, equipItem, resolveSpell } from './commands.js';
import { beginRest } from './rest.js';

/**
 * An attunement something other than a command ends.
 *
 * > SRD Remove Curse: "At your touch, all curses affecting one creature or
 * > object end. If the object is a cursed magic item, its curse remains, but
 * > the spell breaks its owner's Attunement to the object so it can be removed
 * > or discarded."
 *
 * A curse is fiction and the attunement is not: `CreatureState.attuned` holds
 * it, `attuneItem` writes it and `attunement-ended` takes it away. So this is
 * the shape `what-ends-attunement-besides-a-command` names — a table fact a
 * rule then reads, which is a debt.
 *
 * **The Attunement broken is a cursed item's, and only a cursed item's**
 * (E-L1). It was a kind of its own, `end-attunement`, that broke an Attunement
 * to whatever the caster named; the book breaks it only where "the object is a
 * cursed magic item", so the kind was folded into Remove Curse's `end-curses`
 * and an item that carries no curse is refused as its object. The Cloak of
 * Woe below is a homebrew copy of the SRD Cloak of Elvenkind carrying
 * `CatalogueItem.cursed`; the SRD cloak itself carries none.
 *
 * The object is stated at the casting, because the engine will not pick it: a
 * creature attuned to three items has three answers and the book asked the
 * caster. Naming none is the first sentence — every curse on the creature —
 * which `remove-curse.test.ts` drives.
 */

const id = (s: string): CharacterId => asCharacterId(s);
const CLERIC = id('cleric');
const BEARER = id('bearer');

const CLOAK = 'cloak-of-elvenkind';
const WOE = 'cloak-of-woe';
const AMULET = 'amulet-of-health';

const CONTENT = unwrap(
  extendContent(SRD_CONTENT, {
    items: [{ ...SRD_CONTENT.item(CLOAK)!, id: WOE, name: 'Cloak of Woe', cursed: true }],
  }),
  'content',
);

const sheet: CharacterSheet = {
  level: 5,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 18, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'wis',
};

const added = (who: CharacterId): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet,
  maxHp: 30,
  diesAtZero: false,
  creatureType: 'Humanoid',
});

const run = (
  log: readonly GameEvent[],
  command: (s: GameState) => Result<GameEvent[]>,
): readonly GameEvent[] => [...log, ...unwrap(command(fold('seed', log)), 'command')];

const BASE: readonly GameEvent[] = [
  added(CLERIC),
  added(BEARER),
  {
    type: 'spellcasting-declared',
    id: CLERIC,
    spellcasting: declaredCasting({
      ability: 'wis',
      classId: 'cleric',
      prepared: ['remove-curse'],
    }),
  },
  {
    type: 'resource-pool-declared',
    id: CLERIC,
    pool: { key: spellSlotKey(3), label: 'level 3 spell slot', max: 3, recovers: 'long-rest' },
  },
  {
    type: 'resource-pool-declared',
    id: CLERIC,
    pool: { key: spellSlotKey(1), label: 'level 1 spell slot', max: 3, recovers: 'long-rest' },
  },
  {
    type: 'items-gained',
    id: BEARER,
    items: [
      { id: CLOAK, quantity: 1 },
      { id: WOE, quantity: 1 },
      { id: AMULET, quantity: 1 },
    ],
    source: 'the hoard',
  },
  { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
  { type: 'landmark-added', name: 'the shrine', at: { x: 50, y: 50, z: 0 } },
  { type: 'creature-placed', id: CLERIC, placement: { from: { landmark: 'the shrine' }, feet: 0 } },
  { type: 'creature-placed', id: BEARER, placement: { from: { creature: CLERIC }, feet: 5 } },
  { type: 'sight-declared', from: CLERIC, to: BEARER, seen: true },
];

/** The bearer wears one cloak and is attuned to it. */
const attunedTo = (cloak: string): readonly GameEvent[] => {
  const worn = run(BASE, (s) => equipItem(s, CONTENT, BEARER, cloak));
  const resting = run(worn, (s) => beginRest(s, BEARER, 'short'));
  return run(resting, (s) => attuneItem(s, CONTENT, BEARER, cloak));
};

const supply = () => ({
  issuer: createRollIssuer('r'),
  rng: createRng('curse') as Rng,
  content: CONTENT,
});

const cast = (state: GameState, over: Record<string, unknown> = {}) =>
  resolveSpell(
    state,
    CLERIC,
    { spellId: 'remove-curse', targets: [BEARER], slotLevel: 3, ...over },
    supply(),
  );

describe('what a definition may say about ending curses', () => {
  const definition = (effects: unknown[], over: Record<string, unknown> = {}): unknown => ({
    id: 'homebrew-unbinding',
    name: 'Homebrew Unbinding',
    level: 3,
    school: 'abjuration',
    castingTime: 'action',
    concentration: false,
    range: { kind: 'touch' },
    targets: { count: 1 },
    effects,
    ...over,
  });

  const codes = (effects: unknown[], over: Record<string, unknown> = {}): readonly string[] =>
    checkSpellDefinitionValue(definition(effects, over)).map((one) => one.code);

  it('accepts the bare kind, which names no object of its own', () => {
    expect(codes([{ kind: 'end-curses' }])).toEqual([]);
  });

  it('refuses it where no casting is being made to state the object at', () => {
    expect(
      codes([], {
        concentration: true,
        durationSeconds: 60,
        activation: { action: 'action', label: 'again', effects: [{ kind: 'end-curses' }] },
      }),
    ).toContain('attunement_outside_the_casting');
  });
});

describe('SRD Remove Curse breaks the Attunement to a cursed item named as its object', () => {
  it('ends the attunement to the item the caster names', () => {
    const before = fold('seed', attunedTo(WOE));
    expect(attunedItems(before, BEARER)).toEqual([WOE]);

    const out = unwrap(cast(before, { object: WOE }), 'the unbinding');
    const after = out.events.reduce(applyEvent, before);
    expect(attunedItems(after, BEARER)).toEqual([]);
    // The cloak is still worn and still owned — SRD: "so it can be removed or
    // discarded", which is somebody's later decision rather than this spell's.
    expect(after.creatures[BEARER]?.equipped.map((worn) => worn.id)).toContain(WOE);
  });

  it('says what did it, in the event the fold applies', () => {
    const before = fold('seed', attunedTo(WOE));
    const out = unwrap(cast(before, { object: WOE }), 'the unbinding');
    const ended = out.events.find((event) => event.type === 'attunement-ended');
    expect(ended).toBeDefined();
    expect(ended && 'item' in ended && ended.item).toBe(WOE);
  });

  it('refuses an item the target is not attuned to', () => {
    const out = cast(fold('seed', attunedTo(WOE)), { object: AMULET });
    expect(isErr(out) && out.code).toBe('not_attuned');
  });

  it('refuses an item the catalogue does not hold', () => {
    const out = cast(fold('seed', attunedTo(WOE)), { object: 'a-cursed-hat' });
    expect(isErr(out) && out.code).toBe('unknown_item');
  });

  it('refuses an item that carries no curse, which the book breaks no Attunement to', () => {
    const out = cast(fold('seed', attunedTo(CLOAK)), { object: CLOAK });
    expect(isErr(out) && out.code).toBe('not_cursed');
  });

  it('costs nothing when it refuses', () => {
    const before = fold('seed', attunedTo(CLOAK));
    expect(isErr(cast(before, { object: CLOAK }))).toBe(true);
    expect(before.creatures[CLERIC]?.resources.pools[spellSlotKey(3)]?.spent ?? 0).toBe(0);
  });

  it('touches the creature where no object is named: the cursed Attunement goes, the plain one stays', () => {
    const woe = fold('seed', attunedTo(WOE));
    const lifted = unwrap(cast(woe), 'the touch').events.reduce(applyEvent, woe);
    expect(attunedItems(lifted, BEARER)).toEqual([]);

    const plain = fold('seed', attunedTo(CLOAK));
    const kept = unwrap(cast(plain), 'the touch').events.reduce(applyEvent, plain);
    expect(attunedItems(kept, BEARER)).toEqual([CLOAK]);
  });

  it('refuses an object named at a spell that touches none', () => {
    const state = fold('seed', [
      ...BASE,
      {
        type: 'spellcasting-declared',
        id: CLERIC,
        spellcasting: declaredCasting({
          ability: 'wis',
          classId: 'cleric',
          prepared: ['cure-wounds'],
        }),
      },
    ]);
    const out = resolveSpell(
      state,
      CLERIC,
      { spellId: 'cure-wounds', targets: [BEARER], slotLevel: 1, object: CLOAK },
      supply(),
    );
    expect(isErr(out) && out.code).toBe('no_object_clause');
  });
});
