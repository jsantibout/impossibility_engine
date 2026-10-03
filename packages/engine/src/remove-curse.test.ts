import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, isErr, type CharacterId, type Result } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { spellSlotKey } from './resources.js';
import { declaredCasting } from './spellcasting.js';
import { checkSpellDefinition } from './spell-schema.js';
import { checkContent, extendContent } from './content.js';
import type { CatalogueItem } from './catalogue.js';
import type { SpellDefinition } from './spell-definitions.js';
import { attunedItems, resolveSpell } from './commands.js';

/**
 * SRD Remove Curse: "At your touch, **all curses affecting one creature or
 * object end**. If the object is a cursed magic item, its curse remains, but
 * the spell breaks its owner's Attunement to the object so it can be removed
 * or discarded."
 *
 * The first sentence waited on one fact: which of the castings and marks a
 * creature holds **is a curse**. Three kinds of thing are, and each now says
 * so (E-L1):
 *
 * | Curse | Where the engine holds it | What says it is one |
 * |---|---|---|
 * | SRD Bestow Curse, SRD Hex | a running casting | `SpellDefinition.curse`, pinned on the record |
 * | a werewolf's bite | `CreatureState.curses` | it is the curses list |
 * | Attunement to a cursed item | `CreatureState.attuned` | `CatalogueItem.cursed` — SRD Greater Restoration: "A curse, including the target's Attunement to a cursed magic item" |
 *
 * Touched, a creature loses every one of them: `end-curses`. Named as the
 * object, a cursed item keeps its curse and its owner's Attunement to it is
 * broken — and only that.
 */

const id = (s: string): CharacterId => asCharacterId(s);
const CLERIC = id('cleric');
const WARLOCK = id('warlock');
const HAG = id('hag');
const GOBLIN = id('goblin');

const sheet = (ability: 'wis' | 'cha'): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 18, cha: 18 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: ability,
  weaponProficiencies: ['simple'],
});

const added = (who: CharacterId, ability: 'wis' | 'cha' = 'wis'): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(ability),
  maxHp: 200,
  diesAtZero: false,
  creatureType: 'Humanoid',
});

/** A homebrew pair: the cursed amulet, and the same thing with no curse. */
const CURSED: CatalogueItem = {
  id: 'amulet-of-woe',
  name: 'Amulet of Woe',
  kind: 'gear',
  weightLb: 1,
  costCp: null,
  armor: null,
  weapon: null,
  contents: [],
  attunement: {},
  cursed: true,
};
const PLAIN: CatalogueItem = { ...CURSED, id: 'amulet-of-weal', name: 'Amulet of Weal' };
const { cursed: _unused, ...PLAIN_FIELDS } = PLAIN;
void _unused;
const CONTENT = unwrap(
  extendContent(SRD_CONTENT, { items: [CURSED, PLAIN_FIELDS as CatalogueItem] }),
  'content',
);

const slots = (who: CharacterId): readonly GameEvent[] =>
  [1, 2, 3].map((level) => ({
    type: 'resource-pool-declared',
    id: who,
    pool: { key: spellSlotKey(level), label: `level ${level}`, max: 4, recovers: 'long-rest' },
  }));

const BASE: readonly GameEvent[] = [
  added(CLERIC),
  added(WARLOCK, 'cha'),
  added(HAG),
  added(GOBLIN),
  {
    type: 'spellcasting-declared',
    id: CLERIC,
    spellcasting: declaredCasting({ ability: 'wis', classId: 'cleric', prepared: ['remove-curse', 'shield-of-faith'] }),
  },
  {
    type: 'spellcasting-declared',
    id: WARLOCK,
    spellcasting: declaredCasting({ ability: 'cha', classId: 'warlock', prepared: ['hex'] }),
  },
  {
    type: 'spellcasting-declared',
    id: HAG,
    spellcasting: declaredCasting({ ability: 'wis', classId: 'cleric', prepared: ['bestow-curse'] }),
  },
  ...slots(CLERIC),
  ...slots(WARLOCK),
  ...slots(HAG),
  {
    type: 'items-gained',
    id: GOBLIN,
    items: [
      { id: CURSED.id, quantity: 1 },
      { id: PLAIN.id, quantity: 1 },
    ],
    source: 'the barrow',
  },
  { type: 'attuned', id: GOBLIN, item: CURSED.id },
  { type: 'attuned', id: GOBLIN, item: PLAIN.id },
  { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
  { type: 'landmark-added', name: 'the shrine', at: { x: 50, y: 50, z: 0 } },
  { type: 'creature-placed', id: CLERIC, placement: { from: { landmark: 'the shrine' }, feet: 0 } },
  { type: 'creature-placed', id: GOBLIN, placement: { from: { creature: CLERIC }, feet: 5 } },
  { type: 'creature-placed', id: WARLOCK, placement: { from: { creature: CLERIC }, feet: 5, bearing: 90 } },
  { type: 'creature-placed', id: HAG, placement: { from: { creature: GOBLIN }, feet: 5, bearing: 0 } },
  ...[CLERIC, WARLOCK, HAG].flatMap((from): GameEvent[] =>
    [GOBLIN, WARLOCK, CLERIC]
      .filter((to) => to !== from)
      .map((to) => ({ type: 'sight-declared', from, to, seen: true })),
  ),
];

const supply = (state: GameState, flat?: number) => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: createRng('curse') as Rng,
  content: CONTENT,
  ...(flat === undefined ? {} : { bonuses: [{ source: 'the test insists', flat }] }),
});

const step = (
  log: readonly GameEvent[],
  who: CharacterId,
  request: Record<string, unknown>,
  flat?: number,
): readonly GameEvent[] => {
  const state = fold('s', log);
  const out = unwrap(
    resolveSpell(state, who, request as never, supply(state, flat)) as Result<{ readonly events: readonly GameEvent[] }>,
    String(request['spellId']),
  );
  return [...log, ...out.events];
};

/** The goblin under a Bestow Curse and a Hex, each its own casting. */
const CURSED_GOBLIN: readonly GameEvent[] = (() => {
  let log = step(
    BASE,
    HAG,
    { spellId: 'bestow-curse', targets: [GOBLIN], slotLevel: 3, option: 'attacks-against-you' },
    -40,
  );
  log = step(log, WARLOCK, { spellId: 'hex', targets: [GOBLIN], slotLevel: 1, choice: 'str' });
  // And a spell on the goblin that is no curse, which the touch must leave alone.
  log = step(log, CLERIC, { spellId: 'shield-of-faith', targets: [GOBLIN], slotLevel: 1 });
  return [
    ...log,
    {
      type: 'printed-curse-laid',
      id: GOBLIN,
      curse: { source: 'printed:werewolf:Bite', by: HAG, line: 'Bite' },
    },
  ];
})();

const removeCurse = (log: readonly GameEvent[], target: CharacterId, over: Record<string, unknown> = {}) =>
  resolveSpell(
    fold('s', log),
    CLERIC,
    { spellId: 'remove-curse', targets: [target], slotLevel: 3, ...over } as never,
    supply(fold('s', log)),
  ) as Result<{ readonly events: readonly GameEvent[] }>;

const running = (state: GameState): readonly string[] =>
  Object.values(state.ongoing)
    .map((record) => record.spellId)
    .sort();

describe('SRD Remove Curse: all curses affecting one creature end', () => {
  it('starts from a goblin under two curse castings, a printed curse and a cursed amulet', () => {
    const state = fold('s', CURSED_GOBLIN);
    expect(running(state)).toEqual(['bestow-curse', 'hex', 'shield-of-faith']);
    expect(state.ongoing['cast:1']?.curse).toBe(true);
    expect(state.creatures[GOBLIN]!.curses).toHaveLength(1);
    expect([...attunedItems(state, GOBLIN)].sort()).toEqual([PLAIN.id, CURSED.id].sort());
  });

  it('ends every one of them at the touch, and nothing that is not a curse', () => {
    const out = unwrap(removeCurse(CURSED_GOBLIN, GOBLIN), 'remove curse');
    const after = fold('s', [...CURSED_GOBLIN, ...out.events]);
    expect(running(after)).toEqual(['shield-of-faith']);
    // The two casters' Concentration went with their spells.
    expect(after.creatures[HAG]!.concentration).toBeNull();
    expect(after.creatures[WARLOCK]!.concentration).toBeNull();
    expect(after.creatures[GOBLIN]!.curses).toEqual([]);
    // The cursed amulet's hold is broken; the plain one is not a curse.
    expect(attunedItems(after, GOBLIN)).toEqual([PLAIN.id]);
  });

  it('ends nothing on the creature who laid the curse', () => {
    // The Hex is held by the warlock and affects the goblin: touching the
    // warlock touches no curse.
    const out = unwrap(removeCurse(CURSED_GOBLIN, WARLOCK), 'remove curse on the warlock');
    const after = fold('s', [...CURSED_GOBLIN, ...out.events]);
    expect(running(after)).toEqual(['bestow-curse', 'hex', 'shield-of-faith']);
  });

  it('breaks the Attunement to a cursed item named as the object, and only that', () => {
    const out = unwrap(removeCurse(CURSED_GOBLIN, GOBLIN, { object: CURSED.id }), 'the amulet');
    const after = fold('s', [...CURSED_GOBLIN, ...out.events]);
    expect(attunedItems(after, GOBLIN)).toEqual([PLAIN.id]);
    // "its curse remains" — and the creature's own curses are not touched.
    expect(running(after)).toEqual(['bestow-curse', 'hex', 'shield-of-faith']);
    expect(after.creatures[GOBLIN]!.curses).toHaveLength(1);
  });

  it('refuses a log that lifts a curse nobody laid', () => {
    expect(() =>
      fold('s', [...BASE, { type: 'printed-curse-lifted', id: GOBLIN, source: 'printed:werewolf:Bite' }]),
    ).toThrow(/carries no curse/);
  });

  it('refuses an object that is not a cursed magic item, before anything is spent', () => {
    const refused = removeCurse(CURSED_GOBLIN, GOBLIN, { object: PLAIN.id });
    expect(isErr(refused) && refused.code).toBe('not_cursed');
  });
});

describe('the validator and the catalogue hold the two marks', () => {
  it('marks the SRD’s two curse spells, and refuses a curse with nothing running', () => {
    expect(SRD_CONTENT.spell('bestow-curse')?.curse).toBe(true);
    expect(SRD_CONTENT.spell('hex')?.curse).toBe(true);
    const fireball = SRD_CONTENT.spell('fireball')!;
    const codes = (over: Partial<SpellDefinition>) =>
      checkSpellDefinition({ ...fireball, ...over } as SpellDefinition).map((one) => one.code);
    expect(codes({ curse: 'yes' as never })).toContain('malformed_field');
    expect(codes({ curse: true })).toContain('curse_with_nothing_running');
  });

  it('refuses a cursed mark that is not true', () => {
    const problems = checkContent({ items: [{ ...CURSED, cursed: 'yes' as never }] });
    expect(problems.map((one) => one.code)).toContain('malformed_field');
  });
});
