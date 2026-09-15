import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SRD_CONTENT, SRD_CONTENT_INPUT } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CatalogueItem } from './catalogue.js';
import type { CharacterSheet } from './character.js';
import {
  checkContent,
  createContent,
  emptyContent,
  extendContent,
  ITEM_EFFECT_KINDS,
  loadContent,
  parseClassDefinition,
  parseSubclassDefinition,
  REQUIREMENT_KINDS,
  type Content,
} from './content.js';
import { activateFeature, attuneItem, chargesLeft, equipItem, resolveSpell } from './commands.js';
import {
  checkCharacter,
  createCharacter,
  planCharacter,
  type CharacterChoices,
} from './creation.js';
import { createRng, type Rng } from './dice.js';
import { fold, type GameEvent } from './events.js';
import { declaredCasting } from './spellcasting.js';
import { rollModesFor } from './standing.js';
import { remaining, spellSlotKey } from './resources.js';
import { createRollIssuer } from './rolls.js';

/**
 * The boundary this file exists to prove: **the engine holds no catalogue**.
 *
 * Every spell, class, species, background, feat and item a campaign uses is
 * content, handed to the engine as a validated `Content` value. The SRD's
 * catalogue is one such value and a DM's homebrew is another, and both go
 * through the same door — so a spell or a class that uses mechanics the
 * engine already has can be added without touching the engine at all. The
 * tests below add one of each **from JSON text**, through the public API,
 * and drive them through the same commands the SRD content goes through.
 */

const id = (s: string): CharacterId => asCharacterId(s);
const CASTER = id('caster');
const TARGET = id('target');

const sheet = (): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 10, con: 10, int: 18, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
});

const added = (who: CharacterId): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 100,
  diesAtZero: false,
  creatureType: 'Humanoid',
});

/** A homebrew spell, written as the JSON a DM's file or a database row would hold. */
const EMBER_LASH = JSON.stringify({
  id: 'ember-lash',
  name: 'Ember Lash',
  level: 1,
  school: 'evocation',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 1 },
  effects: [
    {
      kind: 'attack',
      attack: 'ranged',
      damage: { dice: '2d6', perSlotLevelAbove: '1d6' },
      damageType: 'fire',
    },
  ],
});

/** Everything a caster of Ember Lash needs: a table, a target it can see, a slot. */
const table = (content: Content): readonly GameEvent[] => [
  added(CASTER),
  added(TARGET),
  {
    type: 'resource-pool-declared',
    id: CASTER,
    pool: { key: spellSlotKey(1), label: 'level 1 spell slot', max: 2, recovers: 'long-rest' },
  },
  { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
  { type: 'landmark-added', name: 'here', at: { x: 50, y: 50, z: 0 } },
  { type: 'creature-placed', id: CASTER, placement: { from: { landmark: 'here' }, feet: 0 } },
  {
    type: 'creature-placed',
    id: TARGET,
    placement: { from: { creature: CASTER }, feet: 30, bearing: 0 },
  },
  { type: 'sight-declared', from: CASTER, to: TARGET, seen: true },
  {
    type: 'spellcasting-declared',
    id: CASTER,
    spellcasting: declaredCasting({
      ability: 'int',
      cantrips: [],
      prepared: content.spells.map((spell) => spell.id),
    }),
  },
];

const supply = (content: Content) => ({
  issuer: createRollIssuer('r'),
  rng: createRng('ember') as Rng,
  content,
  // Force the hit, so the assertion is about the definition and not the die.
  bonuses: [{ source: 'the test insists', flat: 40 }],
});

describe('a homebrew spell goes through the same door as the book', () => {
  const homebrew = unwrap(loadContent({ spells: [JSON.parse(EMBER_LASH)] }), 'load');

  it('is loaded from JSON, validated, and cast end to end with no engine change', () => {
    const state = fold('seed', table(homebrew));
    const before = state.creatures[TARGET]?.vitals.hp;

    const cast = resolveSpell(
      state,
      CASTER,
      { spellId: 'ember-lash', targets: [TARGET], slotLevel: 1 },
      supply(homebrew),
    );
    expect(isErr(cast)).toBe(false);
    if (!cast.ok) return;

    const after = fold('seed', [...table(homebrew), ...cast.value.events]);
    expect(after.creatures[TARGET]?.vitals.hp).toBeLessThan(before ?? 0);
    expect(cast.value.events.some((event) => event.type === 'damage-taken')).toBe(true);
    // The slot was the engine's to spend, and it spent it.
    expect(remaining(after.creatures[CASTER]!.resources, spellSlotKey(1))).toBe(1);
  });

  it('is unknown to a world that was not given it', () => {
    const state = fold('seed', table(SRD_CONTENT));
    const cast = resolveSpell(
      state,
      CASTER,
      { spellId: 'ember-lash', targets: [TARGET], slotLevel: 1 },
      supply(SRD_CONTENT),
    );
    expect(isErr(cast)).toBe(true);
    if (isErr(cast)) expect(cast.code).toBe('no_definition');
  });

  it('sits beside the book, on a class list, once an entry says whose it is', () => {
    const content = unwrap(
      extendContent(SRD_CONTENT, {
        spells: [JSON.parse(EMBER_LASH)],
        spellEntries: [
          {
            id: 'ember-lash',
            name: 'Ember Lash',
            level: 1,
            school: 'evocation',
            classes: ['wizard'],
            castingTime: 'Action',
            ritual: false,
            concentration: false,
          },
        ],
      }),
      'extend',
    );
    expect(content.spell('fireball')).not.toBeNull();
    expect(content.spell('ember-lash')).not.toBeNull();
    expect(content.spellEntry('ember-lash')?.classes).toEqual(['wizard']);

    // A level 1 Wizard writes it into the book and prepares it, and creation
    // — which validates every spell against the class list — is satisfied.
    const problems = checkCharacter(content, wizardWith(['ember-lash']));
    expect(problems.map((p) => p.code)).not.toContain('unknown_spell');
    expect(problems.map((p) => p.code)).not.toContain('spell_not_on_class_list');
    // And the same character against the plain book is refused for it.
    expect(checkCharacter(SRD_CONTENT, wizardWith(['ember-lash'])).map((p) => p.code)).toContain(
      'unknown_spell',
    );
  });

  it('may not shadow a printed spell', () => {
    const shadow = extendContent(SRD_CONTENT, {
      spells: [{ ...JSON.parse(EMBER_LASH), id: 'fireball', name: 'Fireball' }],
    });
    expect(isErr(shadow)).toBe(true);
    if (isErr(shadow)) expect(shadow.reason).toContain('fireball twice');
  });
});

/** A level 1 Human Sage Wizard whose spellbook holds `extra` beside the printed spells. */
const wizardWith = (extra: readonly string[]): CharacterChoices => ({
  name: 'Kessa',
  classId: 'wizard',
  level: 1,
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 },
  },
  abilityIncreases: { int: 2, con: 1 },
  classSkills: ['investigation', 'insight'],
  languages: ['Draconic', 'Elvish'],
  alignment: 'Chaotic Good',
  cantrips: ['fire-bolt', 'light', 'prestidigitation'],
  spellbook: ['magic-missile', 'shield', 'detect-magic', 'feather-fall', 'mage-armor', ...extra]
    .slice(0, 6)
    .map((spellId) => ({ spellId, acquiredAt: 1, origin: 'level' as const })),
  preparedSpells: [...extra, 'shield', 'magic-missile', 'mage-armor'].slice(0, 4),
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: {
    'wizard:scholar': ['arcana'],
    'human:skillful': ['perception'],
  },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int',
      cantrips: ['mage-hand', 'ray-of-frost'],
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId: 'skilled', proficiencies: ['stealth', 'nature', 'survival'] },
  },
});

/** A homebrew class, as JSON: a martial class with one activated feature and one standing one. */
const BLOODHUNTER = JSON.stringify({
  id: 'bloodhunter',
  name: 'Blood Hunter',
  primaryAbility: 'str',
  hitDie: 10,
  saveProficiencies: ['str', 'wis'],
  skillChoices: { choose: 2, from: ['athletics', 'arcana', 'survival', 'insight'] },
  weaponProficiencies: ['simple', 'martial'],
  armorTraining: { light: true, medium: true, heavy: false, shields: true },
  subclassLevel: 3,
  table: Array.from({ length: 20 }, (_, i) => ({
    level: i + 1,
    proficiencyBonus: 2 + Math.floor(i / 4),
  })),
  startingEquipment: [
    { option: 'A', items: [{ id: 'longsword', quantity: 1 }], goldPieces: 10 },
  ],
  multiclass: {
    weapons: ['martial'],
    armorTraining: { light: true, medium: true, heavy: false, shields: true },
    tools: [],
  },
  features: [
    {
      id: 'bloodhunter:crimson-rite',
      name: 'Crimson Rite',
      level: 1,
      automation: 'engine',
      note: 'A Bonus Action out of a pool of two per Long Rest; resistance to necrotic damage while it runs.',
      grants: {
        kind: 'activated',
        action: 'bonus-action',
        pool: 'crimson-rite',
        usesByLevel: Array.from({ length: 20 }, () => 2),
        poolLabel: 'Crimson Rite',
        recovers: 'long-rest',
        lasts: 'end-of-next-turn',
        whileActive: [{ kind: 'damage-resistance', damageTypes: ['necrotic'] }],
      },
    },
    {
      id: 'bloodhunter:hunters-bane',
      name: "Hunter's Bane",
      level: 1,
      automation: 'engine',
      note: 'Advantage on Wisdom (Survival) checks, applied from state.',
      grants: {
        kind: 'standing',
        reach: 'self',
        effects: [
          {
            kind: 'roll-mode',
            modifier: {
              mode: 'advantage',
              selector: { roll: 'ability-check', relation: 'roller', skill: 'survival' },
            },
          },
        ],
      },
    },
  ],
});

const bloodhunter = (): CharacterChoices => ({
  name: 'Ruben',
  classId: 'bloodhunter',
  level: 1,
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 },
  },
  abilityIncreases: { con: 2, wis: 1 },
  classSkills: ['athletics', 'survival'],
  languages: ['Draconic', 'Elvish'],
  alignment: 'Neutral',
  cantrips: [],
  spellbook: [],
  preparedSpells: [],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: ['longsword'],
  hitPoints: { method: 'fixed' },
  featureChoices: { 'human:skillful': ['perception'] },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int',
      cantrips: ['mage-hand', 'ray-of-frost'],
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId: 'skilled', proficiencies: ['stealth', 'nature', 'medicine'] },
  },
});

describe('a homebrew class goes through the same door as the book', () => {
  const parsed = unwrap(parseClassDefinition(JSON.parse(BLOODHUNTER)), 'parse');
  const content = unwrap(extendContent(SRD_CONTENT, { classes: [parsed] }), 'extend');
  const WHO = id('ruben');

  it('is parsed from JSON and validated beside the printed classes', () => {
    expect(content.classes.map((c) => c.id)).toContain('bloodhunter');
    expect(content.classById('bloodhunter')?.hitDie).toBe(10);
    expect(SRD_CONTENT.classById('bloodhunter')).toBeNull();
  });

  it('creates a character of it, pools and features included', () => {
    const log = unwrap(createCharacter(content, bloodhunter(), WHO), 'create');
    const state = fold('seed', log);
    const creature = state.creatures[WHO];
    expect(creature?.resources.pools['crimson-rite']?.max).toBe(2);
    expect(creature?.sheet.activated?.map((a) => a.feature)).toEqual(['bloodhunter:crimson-rite']);
    expect(creature?.character?.classId).toBe('bloodhunter');
    // What the character wears was pinned into the log, not looked up later.
    expect(creature?.equipped.map((held) => held.id)).toEqual(['longsword']);
  });

  it('runs the feature through the engine’s own command', () => {
    const log = unwrap(createCharacter(content, bloodhunter(), WHO), 'create');
    const state = fold('seed', log);
    const on = unwrap(
      activateFeature(state, WHO, { feature: 'bloodhunter:crimson-rite' }),
      'activate',
    );
    const after = fold('seed', [...log, ...on]);
    expect(after.creatures[WHO]?.activeFeatures).toContain('bloodhunter:crimson-rite');
    expect(remaining(after.creatures[WHO]!.resources, 'crimson-rite')).toBe(1);
  });

  it('is refused by creation against a world that does not hold it', () => {
    const refused = createCharacter(SRD_CONTENT, bloodhunter(), WHO);
    expect(isErr(refused)).toBe(true);
    if (isErr(refused)) expect(refused.code).toBe('unknown_class');
  });
});

/**
 * A homebrew magic item, written as the JSON a DM's file would hold.
 *
 * Nothing about it is a new population: it is a `CatalogueItem` that carries a
 * `standing` grant in the vocabulary a class feature is already written in,
 * plus the line the SRD prints in brackets after the rarity.
 */
const QUIET_HAND = JSON.stringify({
  id: 'gloves-of-the-quiet-hand',
  name: 'Gloves of the Quiet Hand',
  kind: 'wondrous',
  weightLb: 0,
  costCp: null,
  armor: null,
  weapon: null,
  contents: [],
  attunement: {},
  grants: [
    {
      kind: 'standing',
      reach: 'self',
      effects: [
        {
          kind: 'roll-mode',
          modifier: {
            mode: 'advantage',
            selector: {
              roll: 'ability-check',
              relation: 'roller',
              ability: 'dex',
              skill: 'sleight-of-hand',
            },
          },
        },
      ],
      requires: [{ kind: 'while-worn' }, { kind: 'while-attuned' }],
    },
  ],
});

describe('a homebrew magic item goes through the same door as the book', () => {
  const content = unwrap(loadContent({ items: [JSON.parse(QUIET_HAND)] }), 'load');
  const GLOVES = 'gloves-of-the-quiet-hand';

  const sleight = (state: ReturnType<typeof fold>) =>
    rollModesFor(state, {
      family: 'ability-check',
      roller: CASTER,
      ability: 'dex',
      skill: 'sleight-of-hand',
    }).modes;

  it('is parsed from JSON text and validated beside the printed items', () => {
    expect(content.item(GLOVES)?.attunement).toEqual({});
    expect(content.item(GLOVES)?.grants).toHaveLength(1);
    expect(SRD_CONTENT.item(GLOVES)).toBeNull();
  });

  /**
   * The claim the whole file is about, for items: a magic item nobody wrote
   * engine code for is owned, worn, attuned to and read off the sheet through
   * the same commands the SRD's own cloak goes through.
   */
  it('is equipped and attuned through the public API, with no engine change', () => {
    const owned: readonly GameEvent[] = [
      added(CASTER),
      { type: 'items-gained', id: CASTER, items: [{ id: GLOVES, quantity: 1 }], source: 'a gift' },
      { type: 'rest-begun', id: CASTER, kind: 'short' },
    ];
    expect(sleight(fold('seed', owned))).toEqual([]);

    const worn = [...owned, ...unwrap(equipItem(fold('seed', owned), content, CASTER, GLOVES), 'equip')];
    // Worn and not attuned: the item's own bracket has not been satisfied.
    expect(sleight(fold('seed', worn))).toEqual([]);

    const attuned = [...worn, ...unwrap(attuneItem(fold('seed', worn), content, CASTER, GLOVES), 'attune')];
    expect(sleight(fold('seed', attuned))).toEqual([
      { source: 'Gloves of the Quiet Hand', mode: 'advantage' },
    ]);

    // And the log stands on its own: the grant was pinned when the gloves went
    // on, so folding with no content at all says the same thing.
    expect(fold('seed', attuned)).toStrictEqual(fold('seed', attuned, content));
  });
});

/**
 * A homebrew wand casting a homebrew spell, written as the JSON a DM's file
 * would hold.
 *
 * The `casts` grant's whole claim, made where the file's other claims are:
 * an item that casts a spell nobody wrote engine code for is a `CatalogueItem`
 * carrying a pool and a route, and what comes out the far end is a casting —
 * an id, a `spell-cast` saying a magic item paid for it, and a charge gone.
 */
const EMBER_WAND = JSON.stringify({
  id: 'wand-of-embers',
  name: 'Wand of Embers',
  kind: 'wand',
  weightLb: 1,
  costCp: null,
  armor: null,
  weapon: null,
  contents: [],
  grants: [
    {
      kind: 'pool',
      key: 'wand-of-embers:charges',
      label: 'Wand of Embers charges',
      uses: 4,
      recovers: 'dawn',
      regainsAtDawn: '1d4',
    },
    { kind: 'casts', spell: 'ember-lash', charges: 1, upToCharges: 3, saveDc: 14, attackBonus: 6 },
  ],
});

describe('a homebrew wand casting a homebrew spell needs no engine change', () => {
  const content = unwrap(
    loadContent({ spells: [JSON.parse(EMBER_LASH)], items: [JSON.parse(EMBER_WAND)] }),
    'load',
  );
  const WAND = 'wand-of-embers';

  it('is parsed from JSON text and validated beside the printed items', () => {
    const grants = content.item(WAND)?.grants ?? [];
    expect(grants.map((grant) => grant.kind)).toEqual(['pool', 'casts']);
    expect(SRD_CONTENT.item(WAND)).toBeNull();
    expect(SRD_CONTENT.spell('ember-lash')).toBeNull();
  });

  it('casts it through the public API, spending a charge and no slot', () => {
    const owned: readonly GameEvent[] = [
      ...table(content).filter((event) => event.type !== 'resource-pool-declared'),
      { type: 'items-gained', id: CASTER, items: [{ id: WAND, quantity: 1 }], source: 'a gift' },
    ];
    const held = [...owned, ...unwrap(equipItem(fold('seed', owned), content, CASTER, WAND), 'equip')];

    const out = unwrap(
      resolveSpell(
        fold('seed', held),
        CASTER,
        { spellId: 'ember-lash', targets: [TARGET], item: WAND, charges: 2 },
        supply(content),
      ),
      'the wand casting Ember Lash',
    );

    const cast = out.events.find((event) => event.type === 'spell-cast');
    expect(cast && cast.type === 'spell-cast' && cast.slotless).toBe('magic-item');
    expect(cast && cast.type === 'spell-cast' && cast.route).toBe(`item:${WAND}`);
    // One charge above the price, so Ember Lash goes off at level 2.
    expect(cast && cast.type === 'spell-cast' && cast.level).toBe(2);
    expect(out.outcomes[0]?.affected).toBe(true);

    // The spell attack rolled with the number the wand prints rather than the
    // caster's own, which would be +7 (Proficiency 3, Intelligence +4). Read
    // off the contribution the log names, because the roll's total also
    // carries the fixture's +40 and whatever else the attack path adds.
    const rolled = out.events.find((event) => event.type === 'roll-recorded');
    expect(rolled && rolled.type === 'roll-recorded' && rolled.contributions).toContainEqual({
      source: 'spell attack',
      amount: 6,
    });
    expect(chargesLeft(fold('seed', [...held, ...out.events]), content, CASTER, WAND)).toBe(2);
  });
});

/**
 * The two lists an item is validated against are unions in `standing.ts`
 * written out as data, and this is what holds them there.
 *
 * The shape `feature-schema.test.ts` established for `READABLE_GRANT_KINDS`:
 * derive the set from the source rather than recalling it, and check the
 * allowlist in both directions. A `StandingGrant` kind added to the union and
 * not to `ITEM_EFFECT_KINDS` would make every item carrying it fail
 * `checkContent` with a `bad_item_effect` nobody meant, and nothing else in
 * the suite would say why.
 */
describe('what an item may grant is derived from the union, not recalled', () => {
  const here = fileURLToPath(new URL('.', import.meta.url));
  // Comments stripped first: this file's unions name their own members in
  // prose several times over, and a scan that counted a docstring would
  // report everything as present and check nothing.
  const STANDING = readFileSync(`${here}standing.ts`, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  const unionKinds = (name: string): readonly string[] => {
    const start = STANDING.indexOf(`export type ${name} =`);
    const end = STANDING.indexOf('\nexport ', start + 1);
    const body = STANDING.slice(start, end === -1 ? undefined : end);
    return [...new Set([...body.matchAll(/readonly kind: '([a-z-]+)'/g)].map((m) => m[1]!))].sort();
  };

  /** The analysis is not vacuous: it finds unions with members in them. */
  it('reads both unions out of the module', () => {
    expect(unionKinds('StandingGrant').length).toBeGreaterThan(4);
    expect(unionKinds('StandingGrant')).toContain('roll-mode');
    expect(unionKinds('StandingRequirement').length).toBeGreaterThan(4);
    expect(unionKinds('StandingRequirement')).toContain('unarmored');
  });

  it('carries every standing requirement, and invents none', () => {
    expect([...REQUIREMENT_KINDS].sort()).toEqual(unionKinds('StandingRequirement'));
  });

  /**
   * And every standing grant but the one deliberately withheld: `speedOf`
   * gathers Speed from the sheet alone, because it is the function a
   * `has-speed` requirement asks, so an item's Speed grant is refused by name
   * rather than accepted and never read.
   */
  it('carries every standing grant but Speed, and invents none', () => {
    expect(unionKinds('StandingGrant')).toContain('speed');
    expect([...ITEM_EFFECT_KINDS].sort()).toEqual(
      unionKinds('StandingGrant').filter((kind) => kind !== 'speed'),
    );
  });
});

describe('the one door refuses what it cannot execute, with a path', () => {
  /**
   * An item may grant only what something executes from an item, and the
   * refusals say which is which — a grant nothing reads is an item whose line
   * in the book quietly does nothing, which is the failure the whole content
   * validator exists to prevent.
   */
  it('refuses an item grant nothing executes, and one no reader reaches', () => {
    const codesOf = (item: unknown): readonly string[] =>
      checkContent({ items: [item as CatalogueItem] }).map(
        (problem) => `${problem.code} @ ${problem.field}`,
      );

    const gloves = JSON.parse(QUIET_HAND);
    // Two of the grant kinds are executed from an item — a standing benefit and
    // a charge pool — and the rest are not. Extra Attack is one nothing reads
    // off an item, so declaring it is refused rather than accepted inert.
    expect(codesOf({ ...gloves, grants: [{ kind: 'extra-attack', attacks: 2 }] })).toContain(
      'item_grant_not_read @ items[gloves-of-the-quiet-hand].grants[0]',
    );
    // And the charge pool that *is* executed still has to be one an item can
    // size: the class-table sizings have nothing on an item to read.
    expect(
      codesOf({
        ...gloves,
        grants: [{ kind: 'pool', key: 'gloves:charges', recovers: 'dawn' }],
      }),
    ).toContain('item_pool_without_uses @ items[gloves-of-the-quiet-hand].grants[0].uses');
    // A Speed from an item is read by nothing: `speedOf` gathers Speed off the
    // sheet alone, because it is the function a `has-speed` requirement asks.
    expect(
      codesOf({
        ...gloves,
        grants: [{ kind: 'standing', reach: 'self', effects: [{ kind: 'speed', feet: 10 }] }],
      }),
    ).toContain('item_speed_grant @ items[gloves-of-the-quiet-hand].grants[0].effects[0]');
    // And a selector describing a roll nobody makes is caught by the same
    // predicate a spell's is.
    expect(
      codesOf({
        ...gloves,
        grants: [
          {
            kind: 'standing',
            reach: 'self',
            effects: [
              {
                kind: 'roll-mode',
                modifier: {
                  mode: 'advantage',
                  selector: { roll: 'saving-throw', relation: 'against-holder', ability: 'dex' },
                },
              },
            ],
          },
        ],
      }),
    ).toContain(
      'against_holder_without_target @ items[gloves-of-the-quiet-hand].grants[0].effects[0].modifier.selector',
    );
  });

  /**
   * And the two requirements that are an item's alone. Both are looked up by
   * the id of the item granting them, so a class feature carrying one would
   * name nothing and hold never — which looks perfectly well-formed.
   */
  it('refuses "while worn" on a class feature, which is not an item', () => {
    const cls = JSON.parse(BLOODHUNTER);
    cls.features = [
      {
        id: 'bloodhunter:borrowed-cloak',
        name: 'Borrowed Cloak',
        level: 1,
        automation: 'engine',
        note: 'A feature pretending to be an item.',
        grants: {
          kind: 'standing',
          reach: 'self',
          effects: [{ kind: 'evasion' }],
          requires: [{ kind: 'while-worn' }],
        },
      },
    ];
    expect(checkContent({ classes: [cls] }).map((problem) => problem.code)).toContain(
      'item_requirement_on_a_feature',
    );
  });

  /**
   * And the same claim in the other direction. A flat number of uses is how an
   * item's line sizes its charges — "This wand has 7 charges" — and a class
   * feature's pool is sized off its table, so `poolSizeOf` would never read it.
   */
  it('refuses a flat number of uses on a class feature, which is not an item', () => {
    const cls = JSON.parse(BLOODHUNTER);
    cls.features = [
      {
        id: 'bloodhunter:borrowed-wand',
        name: 'Borrowed Wand',
        level: 1,
        automation: 'engine',
        note: 'A feature pretending to be an item.',
        grants: { kind: 'pool', key: 'borrowed-wand', uses: 7, recovers: 'dawn' },
      },
    ];
    expect(checkContent({ classes: [cls] }).map((problem) => problem.code)).toContain(
      'item_sizing_on_a_feature',
    );
  });

  /**
   * And the third door in the same wall. SRD "Spells Cast from Items" is about
   * an *item*, the charges it spends are looked up by the granting item's id,
   * and a class feature has none — so a feature carrying the grant would name
   * a pool nothing declares and cast nothing at all. A feature that really
   * does grant a spell has `kind: 'spells'`, which creation executes.
   */
  it('refuses a casting grant on a class feature, which is not an item', () => {
    const cls = JSON.parse(BLOODHUNTER);
    cls.features = [
      {
        id: 'bloodhunter:borrowed-wand-again',
        name: 'Borrowed Wand Again',
        level: 1,
        automation: 'engine',
        note: 'A feature pretending to be an item.',
        grants: { kind: 'casts', spell: 'ember-lash', charges: 1 },
      },
    ];
    expect(
      checkContent({ spells: [JSON.parse(EMBER_LASH)], classes: [cls] }).map((p) => p.code),
    ).toContain('item_casting_on_a_feature');
  });

  it('reports every incoherence in a typed catalogue rather than the first', () => {
    const problems = checkContent({
      spells: [{ ...JSON.parse(EMBER_LASH), effects: [{ kind: 'attack', attack: 'ranged', damage: { dice: 'lots' }, damageType: 'fire' }] }],
      classes: [{ ...JSON.parse(BLOODHUNTER), table: [], hitDie: 2, spellcasting: { ability: 'int', style: 'known', startsAtLevel: 1 } }],
      subclasses: [{ id: 'order-of-nothing', name: 'Order of Nothing', classId: 'nobody', features: [] }],
    });
    const codes = problems.map((p) => `${p.code} @ ${p.field}`);
    expect(codes.some((c) => c.startsWith('bad_notation @ spells[ember-lash]') || c.includes('spells[ember-lash].effects[0]'))).toBe(true);
    expect(codes).toContain('bad_table @ classes[bloodhunter].table');
    expect(codes).toContain('bad_hit_die @ classes[bloodhunter].hitDie');
    expect(codes).toContain('no_progression @ classes[bloodhunter].spellcasting.progression');
    expect(codes).toContain('unknown_class @ subclasses[order-of-nothing].classId');
    const refused = createContent({ subclasses: [{ id: 'x', name: 'X', classId: 'nobody', features: [] }] });
    expect(isErr(refused)).toBe(true);
    if (isErr(refused)) expect(refused.code).toBe('invalid_content');
  });

  it('refuses a duplicate id and a feature executed by nobody', () => {
    const twice = checkContent({ spells: [JSON.parse(EMBER_LASH), JSON.parse(EMBER_LASH)] });
    expect(twice.map((p) => p.code)).toContain('duplicate_id');

    const orphan = JSON.parse(BLOODHUNTER);
    orphan.features[0] = { ...orphan.features[0], grants: undefined, executedBy: 'bloodhunter:nobody' };
    const problems = checkContent({ classes: [orphan] });
    expect(problems.map((p) => p.code)).toContain('bad_executed_by');
  });

  it('narrows untyped input before judging it, one code per kind', () => {
    const codeOf = (value: unknown): string => {
      const result = loadContent(value);
      expect(isErr(result)).toBe(true);
      return result.ok ? '' : `${result.code}: ${result.reason}`;
    };
    // The door's own code, with the parser's code and path inside the reason.
    expect(codeOf(null)).toContain('bad_content');
    expect(codeOf({ spells: [{ id: 'nope' }] })).toContain('bad_content');
    expect(codeOf({ classes: [null] })).toContain('classes[0]: bad_class');
    expect(codeOf({ classes: [{ id: 'x' }] })).toContain('bad_class');
    expect(codeOf({ subclasses: ['x'] })).toContain('bad_subclass');
    expect(codeOf({ species: [{ id: 'x' }] })).toContain('bad_species');
    expect(codeOf({ backgrounds: [{ id: 'x' }] })).toContain('bad_background');
    expect(codeOf({ feats: [{ id: 'x' }] })).toContain('bad_feat');
    expect(codeOf({ spellEntries: [{ id: 'x' }] })).toContain('bad_spell_entry');
    expect(codeOf({ items: [{ id: 'x' }] })).toContain('bad_item');
    // Including the line an item prints in brackets after its rarity.
    expect(
      codeOf({ items: [{ ...JSON.parse(QUIET_HAND), attunement: 'by a Druid' }] }),
    ).toContain('attunement must be an object');
    expect(
      codeOf({ items: [{ ...JSON.parse(QUIET_HAND), attunement: { byClass: 'druid' } }] }),
    ).toContain('byClass must be a list of strings');
    // And the two parsers a caller may reach directly answer with their own.
    const cls = parseClassDefinition(null);
    expect(isErr(cls) && cls.code).toBe('bad_class');
    const sub = parseSubclassDefinition('x');
    expect(isErr(sub) && sub.code).toBe('bad_subclass');
  });

  it('starts empty, and an empty world executes nothing', () => {
    const nothing = emptyContent();
    expect(nothing.spells).toEqual([]);
    expect(nothing.spell('fireball')).toBeNull();
    expect(nothing.classById('wizard')).toBeNull();
    expect(nothing.item('longsword')).toBeNull();
    expect(nothing.expandPack('explorers-pack')).toEqual([]);
  });
});

describe('the SRD catalogue is content like any other', () => {
  it('is data: it round-trips through JSON and the untyped door', () => {
    const reloaded = unwrap(loadContent(JSON.parse(JSON.stringify(SRD_CONTENT_INPUT))), 'reload');
    expect(reloaded.spells.length).toBe(SRD_CONTENT.spells.length);
    expect(reloaded.classes.map((c) => c.id)).toEqual(SRD_CONTENT.classes.map((c) => c.id));
    expect(reloaded.subclasses.length).toBe(SRD_CONTENT.subclasses.length);
    expect(reloaded.items.length).toBe(SRD_CONTENT.items.length);
    expect(reloaded.spell('fireball')).toEqual(SRD_CONTENT.spell('fireball'));
    expect(reloaded.classById('wizard')).toEqual(SRD_CONTENT.classById('wizard'));
  });

  it('passes the same checks homebrew does, and every printed spell has an entry', () => {
    expect(checkContent(SRD_CONTENT_INPUT)).toEqual([]);
    for (const spell of SRD_CONTENT.spells) {
      expect(SRD_CONTENT.spellEntry(spell.id)?.level, spell.id).toBe(spell.level);
    }
    expect(SRD_CONTENT.spellEntries.length).toBeGreaterThan(SRD_CONTENT.spells.length);
  });

  it('answers the same lookups the engine used to hold as globals', () => {
    expect(SRD_CONTENT.classes).toHaveLength(12);
    expect(SRD_CONTENT.subclasses).toHaveLength(12);
    expect(SRD_CONTENT.speciesById('human')?.name).toBe('Human');
    expect(SRD_CONTENT.backgroundById('sage')?.name).toBe('Sage');
    expect(SRD_CONTENT.featById('magic-initiate')?.requires.kind).toBe('magic-initiate');
    expect(SRD_CONTENT.item('chain-shirt')?.armor?.category).toBe('medium');
    expect(SRD_CONTENT.expandPack('scholars-pack').length).toBeGreaterThan(1);
  });
});

/**
 * Languages and alignments are catalogue, not mechanics.
 *
 * A world with its own tongues, or with a different alignment axis, or with
 * none at all, is a content change and nothing else — the same door the
 * homebrew spell and the homebrew class above went through. What stays the
 * engine's is the *rule*: the language everybody speaks plus a fixed number
 * more, whoever "everybody" turns out to speak in this world.
 */
const SKYSPEECH = JSON.stringify({
  languages: [
    { id: 'skyspeech', name: 'Skyspeech' },
    { id: 'deep-hymn', name: 'Deep Hymn', availability: 'rare' },
  ],
});

describe('languages and alignments go through the same door as the book', () => {
  const world = unwrap(extendContent(SRD_CONTENT, JSON.parse(SKYSPEECH)), 'extend');
  /** A character valid in every other respect, so only the tongue is on trial. */
  const speaking = (languages: readonly string[]): CharacterChoices => ({
    ...wizardWith(['identify']),
    languages,
  });

  it('lets a character choose a language the SRD never printed', () => {
    const codes = checkCharacter(world, speaking(['Skyspeech', 'Draconic'])).map((p) => p.code);
    expect(codes).not.toContain('unknown_language');
    expect(isErr(createCharacter(world, speaking(['Skyspeech', 'Draconic']), id('kessa')))).toBe(
      false,
    );
  });

  it('refuses one this world does not hold, as a value naming what it does', () => {
    const problems = checkCharacter(SRD_CONTENT, speaking(['Skyspeech', 'Draconic']));
    const refusal = problems.find((p) => p.code === 'unknown_language');
    expect(refusal?.field).toBe('languages');
    expect(refusal?.reason).toContain('Skyspeech');
    expect(refusal?.reason).toContain('Dwarvish');
    expect(
      isErr(createCharacter(SRD_CONTENT, speaking(['Skyspeech', 'Draconic']), id('kessa'))),
    ).toBe(true);
  });

  it('refuses one the world holds but a character does not choose at creation', () => {
    const codes = checkCharacter(world, speaking(['Deep Hymn', 'Draconic'])).map((p) => p.code);
    expect(codes).toContain('unknown_language');
  });

  it('knows whichever language this world gives everyone, not Common by name', () => {
    const elsewhere = unwrap(
      createContent({
        ...SRD_CONTENT_INPUT,
        languages: [
          { id: 'skyspeech', name: 'Skyspeech', availability: 'everyone' },
          { id: 'deep-hymn', name: 'Deep Hymn' },
          { id: 'root-cant', name: 'Root Cant' },
        ],
      }),
      'elsewhere',
    );
    const planned = planCharacter(elsewhere, speaking(['Deep Hymn', 'Root Cant']));
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.value.languages).toEqual(['Skyspeech', 'Deep Hymn', 'Root Cant']);
  });

  it('counts the choices the same where nobody speaks a common tongue', () => {
    const babel = unwrap(
      createContent({
        ...SRD_CONTENT_INPUT,
        languages: [
          { id: 'deep-hymn', name: 'Deep Hymn' },
          { id: 'root-cant', name: 'Root Cant' },
        ],
      }),
      'babel',
    );
    const counted = (world: Content, languages: readonly string[]) =>
      checkCharacter(world, speaking(languages)).find((p) => p.code === 'wrong_language_count');
    // The count is the engine's rule and does not move; only the sentence
    // does, because there is no Common to say "plus" about.
    expect(counted(babel, ['Deep Hymn'])?.reason).toBe('a character chooses 2 languages, got 1');
    expect(counted(SRD_CONTENT, ['Draconic'])?.reason).toBe(
      'a character knows Common plus 2 more, got 1',
    );
    expect(counted(babel, ['Deep Hymn', 'Root Cant'])).toBeUndefined();
  });

  it('takes a world that names no language, and claims nothing about tongues', () => {
    const wordless = unwrap(createContent({ ...SRD_CONTENT_INPUT, languages: [] }), 'wordless');
    const codes = checkCharacter(wordless, speaking(['Thorn Speech', 'Tide Cant'])).map(
      (p) => p.code,
    );
    expect(codes).not.toContain('unknown_language');
    // The count is still the engine's rule, and still bites.
    expect(checkCharacter(wordless, speaking(['Thorn Speech'])).map((p) => p.code)).toContain(
      'wrong_language_count',
    );
  });

  it('takes a different alignment axis, and refuses the SRD nine against it', () => {
    const wheel = unwrap(
      createContent({
        ...SRD_CONTENT_INPUT,
        alignments: [
          { id: 'ordered', name: 'Ordered' },
          { id: 'wild', name: 'Wild' },
        ],
      }),
      'wheel',
    );
    const ordered = { ...wizardWith(['identify']), alignment: 'Ordered' };
    expect(checkCharacter(wheel, ordered).map((p) => p.code)).not.toContain('unknown_alignment');
    expect(isErr(createCharacter(wheel, ordered, id('kessa')))).toBe(false);

    const refusal = checkCharacter(wheel, wizardWith(['identify'])).find(
      (p) => p.code === 'unknown_alignment',
    );
    expect(refusal?.reason).toContain('Ordered');
    expect(refusal?.reason).toContain('Wild');
  });

  it('takes a world with no alignment axis at all', () => {
    const axisless = unwrap(createContent({ ...SRD_CONTENT_INPUT, alignments: [] }), 'axisless');
    const nobody = { ...wizardWith(['identify']), alignment: '' };
    expect(checkCharacter(axisless, nobody).map((p) => p.code)).not.toContain('unknown_alignment');
    expect(isErr(createCharacter(axisless, nobody, id('kessa')))).toBe(false);
  });

  it('refuses a malformed language or alignment at the door, with a path', () => {
    const codeOf = (value: unknown): string => {
      const result = loadContent(value);
      expect(isErr(result)).toBe(true);
      return result.ok ? '' : `${result.code}: ${result.reason}`;
    };
    expect(codeOf({ languages: [{ id: 'x' }] })).toContain('bad_language');
    expect(codeOf({ languages: [{ id: 'x', name: 'X', availability: 'sometimes' }] })).toContain(
      'bad_language',
    );
    expect(codeOf({ alignments: [{ id: 'x' }] })).toContain('bad_alignment');
    expect(
      checkContent({
        languages: [
          { id: 'skyspeech', name: 'Skyspeech' },
          { id: 'sky-speech', name: 'Skyspeech' },
        ],
      }).map((p) => p.code),
    ).toContain('duplicate_name');
  });

  it('is the SRD’s own list, answered by the catalogue rather than the engine', () => {
    expect(SRD_CONTENT.languages.map((l) => l.name)).toContain('Common');
    expect(SRD_CONTENT.languageNamed('Common')?.availability).toBe('everyone');
    expect(SRD_CONTENT.languageNamed('Ignan')).toBeNull();
    expect(SRD_CONTENT.alignments).toHaveLength(9);
    expect(SRD_CONTENT.alignmentNamed('Lawful Sarcastic')).toBeNull();
    expect(emptyContent().languages).toEqual([]);
    expect(emptyContent().alignmentNamed('Neutral')).toBeNull();
  });
});
