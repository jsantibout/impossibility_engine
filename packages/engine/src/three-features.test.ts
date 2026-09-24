import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent } from './events.js';
import { resolveAttack, useBudgetPurchase, usePoolOption } from './commands.js';
import { createCharacter, type CharacterChoices } from './creation.js';
import { remaining } from './resources.js';

/**
 * Three features a level 5 party holds, each of which was waiting on a shape
 * the vocabulary nearly had.
 *
 * SRD Breath Weapon is the one this file is named for and the one that needed
 * three fields: a cost of **one attack of the Attack action**, a save DC a
 * species derives from its own Constitution rather than from a spellcasting
 * ability no species has, and an **area chosen at the use** — "a 15-foot Cone
 * or a 30-foot Line that is 5 feet wide (choose the shape each time)".
 *
 * Everything else about it was already built: the pool is sized by the
 * Proficiency Bonus and refilled by a Long Rest, the dice are a column read at
 * the character's own level exactly as Sneak Attack's are, the damage type
 * comes off the Draconic Ancestry table through the same `damageTypesFromChoice`
 * the Damage Resistance trait already reads, and the save itself is the
 * `save-damage` every spell in the book rolls.
 */

const id = (s: string) => asCharacterId(s);
const KESS = id('kess');
const THUG = id('thug');
const OGRE = id('ogre');

const plain = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: null,
  ...over,
});

/** A Dragonborn Fighter 5: two attacks in the Attack action, and a breath. */
const dragonborn = (over: Partial<CharacterChoices> = {}): CharacterChoices => ({
  name: 'Kess',
  classId: 'fighter',
  level: 5,
  speciesId: 'dragonborn',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
  },
  abilityIncreases: { con: 2, wis: 1 },
  classSkills: ['athletics', 'survival'],
  languages: ['Dwarvish', 'Orc'],
  alignment: 'Neutral',
  subclassId: 'champion',
  cantrips: [],
  spellbook: [],
  preparedSpells: [],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: { 'dragonborn:draconic-ancestry': ['Red'], 'fighter:weapon-mastery': [] },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int',
      cantrips: ['mage-hand', 'light'],
      levelOneSpell: 'find-familiar',
    },
    'fighter:fighting-style': { featId: 'archery' },
    'fighter:ability-score-improvement': { featId: 'savage-attacker' },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
  ...over,
});

const BREATH = 'dragonborn:breath-weapon';

const ANSEL = id('ansel');

/** A Cleric 3, for the one option on a menu that prints a single template. */
const cleric = (): CharacterChoices => ({
  name: 'Ansel',
  classId: 'cleric',
  level: 3,
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 14, dex: 10, con: 13, int: 8, wis: 15, cha: 12 },
  },
  abilityIncreases: { con: 2, wis: 1 },
  classSkills: ['insight', 'religion'],
  languages: ['Dwarvish', 'Orc'],
  alignment: 'Neutral',
  subclassId: 'life-domain',
  cantrips: ['sacred-flame', 'guidance', 'light'],
  preparedSpells: ['bless', 'cure-wounds', 'healing-word', 'guiding-bolt', 'inflict-wounds', 'hold-person'],
  spellbook: [],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: { 'human:skillful': ['perception'], 'cleric:divine-order': ['Protector'] },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int' as const,
      cantrips: ['mage-hand', 'light'],
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId: 'alert' },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
});

/** Kess, two thugs down the lane, and a fight already running. */
const table = (over: Partial<CharacterChoices> = {}): readonly GameEvent[] => [
  ...(unwrap(createCharacter(SRD_CONTENT, dragonborn(over), KESS), 'create') as GameEvent[]),
  { type: 'creature-side-declared', id: KESS, side: 'party' },
  {
    type: 'creature-added',
    id: THUG,
    name: 'thug',
    sheet: plain(),
    maxHp: 400,
    diesAtZero: false,
    creatureType: 'Humanoid',
    side: 'thugs',
  },
  {
    type: 'creature-added',
    id: OGRE,
    name: 'ogre',
    sheet: plain(),
    maxHp: 400,
    diesAtZero: false,
    creatureType: 'Giant',
    side: 'thugs',
  },
  { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
  { type: 'landmark-added', name: 'the mouth', at: { x: 50, y: 50, z: 0 } },
  { type: 'landmark-added', name: 'the step', at: { x: 55, y: 50, z: 0 } },
  { type: 'landmark-added', name: 'the lane', at: { x: 75, y: 50, z: 0 } },
  { type: 'creature-placed', id: KESS, placement: { from: { landmark: 'the mouth' }, feet: 0 } },
  { type: 'creature-placed', id: THUG, placement: { from: { landmark: 'the step' }, feet: 0 } },
  { type: 'creature-placed', id: OGRE, placement: { from: { landmark: 'the lane' }, feet: 0 } },
  {
    type: 'combat-started',
    combatants: [
      { id: KESS, initiative: 20, speed: 30 },
      { id: THUG, initiative: 10, speed: 30 },
      { id: OGRE, initiative: 5, speed: 30 },
    ],
  },
];

/** Straight down the lane, which is where both templates are pointed. */
const DOWN_THE_LANE = { x: 150, y: 50, z: 0 };

const supply = (seed: string) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

/** Take the Attack action, so there is an attack for the breath to replace. */
const swing = (log: readonly GameEvent[], seed = 'swing'): readonly GameEvent[] => {
  const out = unwrap(
    resolveAttack(
      fold('seed', log),
      KESS,
      { target: THUG, weapon: null, attackBonuses: [{ source: 'forced', flat: 40 }] },
      supply(seed),
    ),
    'attack',
  );
  return [...log, ...out.events];
};

const breathe = (
  log: readonly GameEvent[],
  request: Record<string, unknown> = {},
  seed = 'breath',
) =>
  usePoolOption(
    fold('seed', log),
    KESS,
    {
      feature: BREATH,
      option: 'breath-weapon',
      shape: 'cone',
      towards: DOWN_THE_LANE,
      ...request,
    } as unknown as Parameters<typeof usePoolOption>[2],
    supply(seed),
  );

/** The same call with the shape left out entirely, which is not the same as `undefined`. */
const breatheUnshaped = (log: readonly GameEvent[]) =>
  usePoolOption(
    fold('seed', log),
    KESS,
    { feature: BREATH, option: 'breath-weapon', towards: DOWN_THE_LANE },
    supply('breath'),
  );

describe('SRD Breath Weapon — an exhalation in place of one attack', () => {
  it('replaces one attack of the Attack action and leaves the other standing', () => {
    const log = swing(table());
    const before = fold('seed', log);
    expect(before.combat?.budgets[KESS]?.attacksRemaining).toBe(1);

    const used = unwrap(breathe(log), 'breath');
    const after = fold('seed', [...log, ...used.events]);

    // The exhalation took the attack the Fighter had left, and took no Action
    // of its own: the Attack action was paid for by the swing above.
    expect(after.combat?.budgets[KESS]?.attacksRemaining).toBe(0);
    expect(after.combat?.budgets[KESS]?.action).toBe(false);
    expect(after.combat?.budgets[KESS]?.bonusAction).toBe(true);
  });

  it('rolls a Dexterity save against 8 + Constitution + Proficiency Bonus', () => {
    const log = swing(table());
    const used = unwrap(breathe(log), 'breath');

    // Constitution 14 + 2 from the increases is 16, a modifier of 3; the
    // Proficiency Bonus at character level 5 is 3. SRD: "DC 8 plus your
    // Constitution modifier and Proficiency Bonus."
    expect(used.outcomes.length).toBeGreaterThan(0);
    for (const outcome of used.outcomes) {
      expect(outcome.save).toMatchObject({ kind: 'saving-throw', ability: 'dex', dc: 14 });
    }

    // And the die is in the log under the name the trait gave it, which is
    // what a narrator reads back.
    expect(
      used.events.filter(
        (event) =>
          event.type === 'roll-recorded' && event.label === 'Dexterity save vs Breath Weapon',
      ).length,
    ).toBe(used.outcomes.length);
  });

  it('deals 2d10 Fire at character level 5, halved on a success, with the faces in the log', () => {
    const log = swing(table());
    const used = unwrap(breathe(log), 'breath');

    const rolled = used.events.filter((event) => event.type === 'damage-dice-recorded');
    expect(rolled.length).toBeGreaterThan(0);
    for (const roll of rolled) {
      const dice = roll as unknown as {
        readonly source: string;
        readonly components: readonly {
          readonly type: string;
          readonly dice: readonly unknown[];
        }[];
      };
      expect(dice.source).toBe('Breath Weapon');
      // The type is the Draconic Ancestry's, and a Red Dragonborn breathes
      // Fire; the count is the column's row at character level 5.
      expect(dice.components.map((one) => one.type)).toEqual(['fire']);
      // The faces, not a total: the log says which two d10s fell.
      expect(dice.components[0]!.dice).toHaveLength(2);
    }

    const outcome = used.outcomes.find((one) => one.target === THUG);
    expect(outcome?.save).toBeDefined();
    // SRD: "On a failed save, a creature takes 1d10 damage ... On a successful
    // save, a creature takes half as much damage."
    const taken = used.events.find(
      (event) => event.type === 'damage-taken' && event.id === THUG,
    ) as unknown as { readonly amount: number };
    const thrown = (
      rolled[0] as unknown as { readonly components: readonly { readonly total: number }[] }
    ).components[0]!.total;
    expect(taken.amount).toBe(
      outcome?.save?.success === true ? Math.floor(thrown / 2) : thrown,
    );
  });

  it('spends one use, and a breath with the pool empty is refused', () => {
    const log = swing(table());
    const before = remaining(fold('seed', log).creatures[KESS]!.resources, BREATH);
    // SRD: "a number of times equal to your Proficiency Bonus."
    expect(before).toBe(3);

    const used = unwrap(breathe(log), 'breath');
    const after = fold('seed', [...log, ...used.events]);
    expect(remaining(after.creatures[KESS]!.resources, BREATH)).toBe(before - 1);

    const drained = [
      ...log,
      { type: 'resource-spent', id: KESS, key: BREATH, amount: before } as GameEvent,
    ];
    const refused = breathe(drained);
    expect(isErr(refused) && refused.code).toBe('exhausted');
  });

  it('catches a different set as a Line than as a Cone', () => {
    const log = swing(table());

    // The 15-foot Cone reaches the thug five feet away and not the ogre at
    // twenty-five.
    const cone = unwrap(breathe(log, { shape: 'cone' }), 'cone');
    expect(cone.outcomes.map((one) => one.target).sort()).toEqual([THUG]);

    // The 30-foot Line reaches both.
    const line = unwrap(breathe(log, { shape: 'line' }), 'line');
    expect(line.outcomes.map((one) => one.target).sort()).toEqual([OGRE, THUG].sort());
  });

  it('refuses a shape it does not offer, and refuses breathing outside the Attack action', () => {
    const log = swing(table());

    const wrong = breathe(log, { shape: 'sphere' });
    expect(isErr(wrong) && wrong.code).toBe('no_such_shape');

    const silent = breatheUnshaped(log);
    expect(isErr(silent) && silent.code).toBe('shape_required');

    // No Attack action taken at all: there is no attack to replace.
    const fresh = breathe(table());
    expect(isErr(fresh) && fresh.code).toBe('no_attack_action');
  });

  it('refuses a shape named for an option that prints a single area', () => {
    // SRD Turn Undead fills one 30-foot Emanation and offers nothing to choose
    // between, so naming a shape is a caller who has misread the feature —
    // the reading `damage_type_fixed` already takes one field along.
    const log = [
      ...(unwrap(createCharacter(SRD_CONTENT, cleric(), ANSEL), 'cleric') as GameEvent[]),
    ];
    const refused = usePoolOption(
      fold('seed', log),
      ANSEL,
      { feature: 'cleric:channel-divinity', option: 'turn-undead', shape: 'cone' },
      supply('cleric'),
    );
    expect(isErr(refused) && refused.code).toBe('shape_fixed');
  });

  it('refuses a third breath in one Attack action, because there is no attack left', () => {
    // Both of the Fighter's two attacks swung, so the action is empty.
    const log = swing(swing(table(), 'a'), 'b');
    const refused = breathe(log);
    expect(isErr(refused) && refused.code).toBe('no_attacks_left');
  });
});

/**
 * SRD Open Hand Technique: "Whenever you hit a creature with an attack granted
 * by your **Flurry of Blows**, you can impose one of the following effects on
 * that target."
 *
 * The three effects were nearly data the day a hit could buy an effect list.
 * What blocked them was the sentence's first clause: a swing knew what it cost
 * and not what had *bought* it, so nothing could tell a Flurry's punch from
 * any other. `GrantedAttacks` carries what sold it now, and `fromGrant` is the
 * filter that reads it.
 */

const SHAN = id('shan');
const MARK = id('mark');

const TECHNIQUE = 'open-hand:technique';

const monk = (): CharacterChoices => ({
  name: 'Shan',
  classId: 'monk',
  level: 5,
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 12, dex: 15, con: 13, int: 8, wis: 14, cha: 10 },
  },
  abilityIncreases: { con: 2, wis: 1 },
  classSkills: ['acrobatics', 'stealth'],
  languages: ['Dwarvish', 'Orc'],
  alignment: 'Lawful Neutral',
  subclassId: 'warrior-of-the-open-hand',
  cantrips: [],
  spellbook: [],
  preparedSpells: [],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: { 'human:skillful': ['perception'] },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int' as const,
      cantrips: ['mage-hand', 'light'],
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId: 'alert' },
    'monk:ability-score-improvement': { featId: 'defense' },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
});

/** The Monk, a mark five feet away, and a fight on the Monk's turn. */
const dojo = (): readonly GameEvent[] => [
  ...(unwrap(createCharacter(SRD_CONTENT, monk(), SHAN), 'monk') as GameEvent[]),
  { type: 'creature-side-declared', id: SHAN, side: 'party' },
  {
    type: 'creature-added',
    id: MARK,
    name: 'mark',
    sheet: plain(),
    maxHp: 400,
    diesAtZero: false,
    creatureType: 'Humanoid',
    side: 'thugs',
  },
  { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
  { type: 'landmark-added', name: 'the mat', at: { x: 50, y: 50, z: 0 } },
  { type: 'landmark-added', name: 'the edge', at: { x: 55, y: 50, z: 0 } },
  { type: 'creature-placed', id: SHAN, placement: { from: { landmark: 'the mat' }, feet: 0 } },
  { type: 'creature-placed', id: MARK, placement: { from: { landmark: 'the edge' }, feet: 0 } },
  {
    type: 'combat-started',
    combatants: [
      { id: SHAN, initiative: 20, speed: 30 },
      { id: MARK, initiative: 10, speed: 30 },
    ],
  },
];

/** SRD Flurry of Blows: a Bonus Action and a Focus Point buy two strikes. */
const flurry = (log: readonly GameEvent[]): readonly GameEvent[] => [
  ...log,
  ...unwrap(
    useBudgetPurchase(fold('seed', log), SHAN, {
      feature: 'monk:focus',
      purchase: 'flurry-of-blows',
    }),
    'flurry',
  ),
];

/** A punch, with the roll forced to land so the test is about the rider. */
const punch = (
  log: readonly GameEvent[],
  onHit: { readonly feature: string; readonly option: string } | undefined,
  options: { readonly seed?: string; readonly save?: number } = {},
) =>
  resolveAttack(
    fold('seed', log),
    SHAN,
    {
      target: MARK,
      weapon: null,
      attackBonuses: [{ source: 'forced', flat: 40 }],
      ...(onHit === undefined ? {} : { onHit }),
    },
    {
      issuer: createRollIssuer('r'),
      rng: createRng(options.seed ?? 'flurry') as Rng,
      content: SRD_CONTENT,
      ...(options.save === undefined
        ? {}
        : { bonuses: [{ source: 'the test insists', flat: options.save }] }),
    },
  );

const landed = (
  log: readonly GameEvent[],
  onHit: { readonly feature: string; readonly option: string },
  options: Parameters<typeof punch>[2] = {},
) => {
  const out = unwrap(punch(log, onHit, options), 'punch');
  return { out, state: fold('seed', [...log, ...out.events]), log: [...log, ...out.events] };
};

/** The die is the engine's; which side of the DC it lands on is the test's. */
const DOOMED = -40;
const CERTAIN = 40;

describe('SRD Open Hand Technique — a rider the Flurry has to have bought', () => {
  it('refuses the rider on an ordinary punch that no Flurry paid for', () => {
    const refused = punch(dojo(), { feature: TECHNIQUE, option: 'topple' });
    expect(isErr(refused) && refused.code).toBe('not_from_that_grant');

    // And nothing was spent: the refusal arrives before the roll.
    const after = fold('seed', dojo());
    expect(after.combat?.budgets[SHAN]?.action).toBe(true);
  });

  it('allows it on a strike the Flurry bought, and Topple knocks a failure Prone', () => {
    const log = flurry(dojo());
    expect(fold('seed', log).combat?.budgets[SHAN]?.grantedAttacks?.remaining).toBe(2);

    const { state } = landed(log, { feature: TECHNIQUE, option: 'topple' }, { save: DOOMED });
    expect(state.creatures[MARK]?.conditions.conditions).toContain('prone');
    // The strike came out of the Flurry rather than out of the Attack action.
    expect(state.combat?.budgets[SHAN]?.grantedAttacks?.remaining).toBe(1);
    expect(state.combat?.budgets[SHAN]?.action).toBe(true);
  });

  it('leaves a Dexterity save that succeeds standing', () => {
    const log = flurry(dojo());
    const { state } = landed(log, { feature: TECHNIQUE, option: 'topple' }, { save: CERTAIN });
    expect(state.creatures[MARK]?.conditions.conditions ?? []).not.toContain('prone');
  });

  it('Push moves a failed Strength save fifteen feet straight away', () => {
    const log = flurry(dojo());
    const start = fold('seed', log).scene?.positions[MARK];
    const { state } = landed(log, { feature: TECHNIQUE, option: 'push' }, { save: DOOMED });
    const end = state.scene?.positions[MARK];
    // SRD: "pushed up to 15 feet away from you", along the bearing between them.
    expect(end?.x).toBe((start?.x ?? 0) + 15);
  });

  it('Addle stops the target making an Opportunity Attack until the start of its turn', () => {
    const log = flurry(dojo());
    const { state, log: after } = landed(log, { feature: TECHNIQUE, option: 'addle' });

    const rules = state.creatures[MARK]?.actionRules ?? [];
    expect(rules).toHaveLength(1);
    expect(rules[0]?.rule).toMatchObject({ kind: 'forbids', actions: ['opportunity-attack'] });

    // "until the start of its next turn" — the target's own, not the Monk's.
    const later = fold('seed', [
      ...after,
      { type: 'turn-advanced', from: SHAN, to: MARK } as GameEvent,
    ]);
    expect(later.creatures[MARK]?.actionRules ?? []).toEqual([]);
  });
});
