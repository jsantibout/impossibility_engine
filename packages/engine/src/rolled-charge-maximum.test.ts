import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CatalogueItem } from './catalogue.js';
import { itemChargePool, itemChargeRoll } from './catalogue.js';
import { checkContent, extendContent } from './content.js';
import { awardItems } from './commands.js';
import { createRng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent } from './events.js';
import { createCharacter, type CharacterChoices } from './creation.js';

/**
 * The rolled charge maximum, refused at the door the other pool strings are.
 *
 * It used to sit on `CatalogueItem` itself, where `checkContent` never looked:
 * a malformed one loaded clean and refused later at the award, and one written
 * on an item with no pool was silently inert. It is a **pool's** sizing — the
 * item's own line saying how many charges this copy has — so it lives beside
 * `uses` in the `pool` grant, and is item-only there for `casts`'s reason: the
 * charges are an item's and a feature has none.
 */

const id = (s: string) => asCharacterId(s);
const GRUM: CharacterId = id('grum');

const NECKLACE = 'necklace-of-small-fireballs';

/** SRD Necklace of Fireballs: "A necklace has 1d6 + 3 beads." No flat count. */
const necklace = (over: Record<string, unknown> = {}): CatalogueItem =>
  ({
    id: NECKLACE,
    name: 'Necklace of Small Fireballs',
    kind: 'wondrous',
    weightLb: 1,
    costCp: null,
    armor: null,
    weapon: null,
    contents: [],
    grants: [
      {
        kind: 'pool',
        key: `${NECKLACE}:charges`,
        usesRolled: '1d6+3',
        recovers: 'special',
        ...over,
      },
    ],
  }) as unknown as CatalogueItem;

const codesFor = (item: CatalogueItem): readonly string[] =>
  checkContent({ items: [item] }).map((problem) => problem.code);

const character = (): CharacterChoices => ({
  name: 'Grum',
  classId: 'fighter',
  level: 1,
  speciesId: 'human',
  backgroundId: 'soldier',
  abilities: {
    method: 'standard-array',
    assignment: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 },
  },
  abilityIncreases: { str: 2, con: 1 },
  classSkills: ['athletics', 'intimidation'],
  languages: ['Dwarvish', 'Orc'],
  alignment: 'Neutral',
  cantrips: [],
  spellbook: [],
  preparedSpells: [],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: { 'human:skillful': ['perception'] },
  feats: {
    'soldier:savage-attacker': { featId: 'savage-attacker' },
    'human:versatile': { featId: 'alert' },
    'fighter:fighting-style': { featId: 'defense' },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
});

describe('a pool whose maximum the book rolls', () => {
  it('is accepted with no flat count at all, which is how the book prints it', () => {
    expect(codesFor(necklace())).toEqual([]);
    const pool = itemChargePool(necklace());
    expect(pool?.key).toBe(`${NECKLACE}:charges`);
    expect(itemChargeRoll(necklace())).toBe('1d6+3');
  });

  it('refuses a pool that names neither a count nor dice', () => {
    const silent = necklace();
    delete (silent.grants![0] as unknown as Record<string, unknown>)['usesRolled'];
    expect(codesFor(silent)).toContain('item_pool_without_uses');
  });

  it('refuses dice that are not dice', () => {
    expect(codesFor(necklace({ usesRolled: 'a handful' }))).toContain('bad_rolled_uses');
    expect(codesFor(necklace({ usesRolled: '4' }))).toContain('bad_rolled_uses');
  });

  it('refuses a pool sized twice, by a number and by dice', () => {
    expect(codesFor(necklace({ uses: 3 }))).toContain('item_pool_sized_twice');
  });

  /** The half the old placement could not refuse: a sizing with no pool. */
  it('refuses a rolled maximum on a grant that is not a pool', () => {
    const wrong = {
      id: 'cloak-of-nothing',
      name: 'Cloak of Nothing',
      kind: 'wondrous',
      weightLb: 1,
      costCp: null,
      armor: null,
      weapon: null,
      contents: [],
      grants: [
        {
          kind: 'standing',
          reach: 'self',
          effects: [{ kind: 'flat-bonus', applies: 'ac', amount: 1 }],
          usesRolled: '1d6+3',
        },
      ],
    } as unknown as CatalogueItem;
    expect(codesFor(wrong)).toContain('rolled_uses_without_a_pool');
  });

  /** And the field where it used to live, which now sizes nothing. */
  it('refuses a rolled maximum left on the item itself', () => {
    const old = necklace();
    (old as unknown as Record<string, unknown>)['chargesRolled'] = '1d6+3';
    expect(codesFor(old)).toContain('rolled_uses_without_a_pool');
  });

  /** An item-only member, for the reason `casts` and a flat `uses` are. */
  it('refuses a rolled maximum on a class feature’s pool', () => {
    const cls = {
      id: 'rollmancer',
      name: 'Rollmancer',
      primaryAbility: 'int',
      hitDie: 6,
      saveProficiencies: ['int', 'wis'],
      skillChoices: { choose: 2, from: ['arcana', 'history'] },
      weaponProficiencies: ['simple'],
      armorTraining: { light: false, medium: false, heavy: false, shields: false },
      subclassLevel: 3,
      table: Array.from({ length: 20 }, (_, i) => ({
        level: i + 1,
        proficiencyBonus: 2 + Math.floor(i / 4),
      })),
      startingEquipment: [{ option: 'A', items: [], goldPieces: 10 }],
      multiclass: {
        weapons: ['simple'],
        armorTraining: { light: false, medium: false, heavy: false, shields: false },
        tools: [],
      },
      features: [
        {
          id: 'rollmancer:dice-pool',
          name: 'Dice Pool',
          level: 1,
          automation: 'engine',
          note: 'A pool a class table cannot size, because no class table has ever rolled.',
          grants: {
            kind: 'pool',
            key: 'dice-pool',
            usesRolled: '1d6+3',
            recovers: 'long-rest',
          },
        },
      ],
    };
    expect(checkContent({ classes: [cls as never] }).map((p) => p.code)).toContain(
      'item_rolled_sizing_on_a_feature',
    );
  });
});

describe('a pool with a rolled maximum and no flat count is awarded', () => {
  const HOARD = unwrap(extendContent(SRD_CONTENT, { items: [necklace()] }), 'homebrew');

  it('rolls the count once, at the copy’s birth, and pins it', () => {
    const log = unwrap(createCharacter(HOARD, character(), GRUM), 'create') as GameEvent[];
    const supply = {
      issuer: createRollIssuer('beads'),
      rng: createRng('beads'),
      content: HOARD,
    };
    const given = unwrap(
      awardItems(fold('seed', log), supply, GRUM, [{ id: NECKLACE, quantity: 1 }], 'the barrow'),
      'award',
    );
    const after = fold('seed', [...log, ...given]);
    const pool = after.creatures[GRUM]?.resources.pools[`${NECKLACE}:charges@item:1`];
    expect(pool).toBeDefined();
    expect(pool!.max).toBeGreaterThanOrEqual(4);
    expect(pool!.max).toBeLessThanOrEqual(9);
    expect(pool!.spent).toBe(0);
    // Replay reads the log and rerolls nothing.
    expect(fold('seed', [...log, ...given])).toStrictEqual(after);
  });
});
