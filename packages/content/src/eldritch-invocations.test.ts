import { describe, expect, it } from 'vitest';
import { ELDRITCH_INVOCATIONS, SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap } from '@ie/shared';
import {
  advanceCharacter,
  canSee,
  checkCharacter,
  createCharacter,
  createRng,
  createRollIssuer,
  fold,
  pactSlotKey,
  planCharacter,
  remaining,
  resolveDamage,
  resolveSpell,
  resolveTest,
  routesFor,
  speedOf,
  type CharacterChoices,
  type GameEvent,
  type GameState,
  type Rng,
} from '@ie/engine';

/**
 * SRD Eldritch Invocations, the Warlock's level 1 feature, and the eleven
 * invocations a level 5 Warlock can take that this catalogue executes.
 *
 * "You have unearthed Eldritch Invocations ... You gain one invocation of your
 * choice ... You gain more invocations at higher levels, as shown in the
 * Invocations column of the Warlock Features table. Whenever you gain a
 * Warlock level, you can replace one of your invocations with another one for
 * which you qualify."
 *
 * The shape is the plural choice Divine Order built plus one count that
 * scales: an `option` question whose count is a column, each option carrying
 * its own gated grants, and a Prerequisite the validator and creation check.
 * What is asserted here is what a player would see at the table — the modifier
 * on the beams, the slot that was not spent, the creature seen in magical
 * darkness, the Advantage on the save, the Temporary Hit Points that were not
 * rolled for, the feat on the sheet, and the book the Rituals came out of.
 */

const WHO = asCharacterId('kael');
const TARGET = asCharacterId('ogre');
const FIEND = 'warlock:eldritch-invocations';

const base = (over: Partial<CharacterChoices> = {}): CharacterChoices => ({
  name: 'Kael',
  classId: 'warlock',
  level: 5,
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 8, dex: 14, con: 13, int: 12, wis: 10, cha: 15 },
  },
  abilityIncreases: { con: 2, int: 1 },
  classSkills: ['arcana', 'deception'],
  languages: ['Draconic', 'Goblin'],
  alignment: 'Neutral Evil',
  subclassId: 'fiend-patron',
  cantrips: ['eldritch-blast', 'chill-touch', 'poison-spray'],
  spellbook: [],
  preparedSpells: ['hex', 'charm-person', 'hold-person', 'hypnotic-pattern', 'mind-spike', 'fear'],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: ['leather-armor'],
  hitPoints: { method: 'fixed' },
  featureChoices: { 'human:skillful': ['perception'] },
  feats: {
    // Fire Bolt through the feat, so the Warlock holds a cantrip that deals
    // damage and is **not** the one Agonizing Blast named.
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int',
      cantrips: ['fire-bolt', 'light'],
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId: 'alert' },
    'warlock:ability-score-improvement': { featId: 'savage-attacker' },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
  ...over,
});

/** A Warlock holding the invocations named, and whatever they ask for after. */
const warlock = (
  invocations: readonly string[],
  answers: Record<string, readonly string[]> = {},
  over: Partial<CharacterChoices> = {},
): CharacterChoices =>
  base({
    featureChoices: {
      'human:skillful': ['perception'],
      [FIEND]: invocations,
      ...answers,
    },
    ...over,
  });

/**
 * The same Warlock below level 5, with only what that level really holds: no
 * subclass before 3, no Improvement before 4, and the spells the table prints.
 */
const atLevel = (level: number, invocations: readonly string[]): CharacterChoices =>
  warlock(invocations, {}, {
    level,
    ...(level < 3 ? { subclassId: undefined } : {}),
    cantrips: ['eldritch-blast', 'chill-touch'],
    // A Warlock's slots *become* the next level rather than accumulating, so
    // nothing here is above what the table prints at that level.
    preparedSpells: ['hex', 'charm-person', 'hellish-rebuke', 'hold-person'].slice(
      0,
      Math.min(level + 1, 4),
    ),
    feats: {
      'sage:magic-initiate-wizard': base().feats['sage:magic-initiate-wizard']!,
      'human:versatile': { featId: 'alert' },
    },
  });

const codes = (choices: CharacterChoices): readonly string[] =>
  checkCharacter(SRD_CONTENT, choices).map((problem) => problem.code);

const plan = (choices: CharacterChoices) => unwrap(planCharacter(SRD_CONTENT, choices), 'plan');

const supply = (seed: string, flat?: number) => ({
  issuer: createRollIssuer(seed),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
  ...(flat === undefined ? {} : { bonuses: [{ source: 'the test insists', flat }] }),
});

/** The Warlock, an ogre twenty feet away, and a scene to stand them in. */
const table = (choices: CharacterChoices): GameEvent[] => [
  ...(unwrap(createCharacter(SRD_CONTENT, choices, WHO), 'creation') as GameEvent[]),
  {
    type: 'creature-added',
    id: TARGET,
    name: 'an ogre',
    maxHp: 200,
    diesAtZero: true,
    creatureType: 'Giant',
    sheet: {
      level: 1,
      abilities: { str: 19, dex: 8, con: 16, int: 5, wis: 7, cha: 7 },
      skills: {},
      saveProficiencies: [],
      armor: null,
      shield: null,
      armorTraining: { light: false, medium: false, heavy: false, shields: false },
      baseSpeed: 40,
      spellcastingAbility: null,
      stated: { armorClass: 11, proficiencyBonus: 2, initiative: -1 },
    },
  },
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
  { type: 'landmark-added', name: 'the well', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: WHO, placement: { from: { landmark: 'the well' }, feet: 0 } },
  {
    type: 'creature-placed',
    id: TARGET,
    placement: { from: { creature: WHO }, feet: 20, bearing: 90 },
  },
  { type: 'sight-declared', from: WHO, to: TARGET, seen: true },
];

/** Everything this log says was taken off the ogre. */
const dealt = (events: readonly GameEvent[]): number =>
  events
    .filter((event): event is Extract<GameEvent, { type: 'damage-taken' }> =>
      event.type === 'damage-taken' && event.id === TARGET)
    .reduce((sum, event) => sum + event.amount, 0);

// ─── the count, and the Prerequisite ────────────────────────────────────────

describe('the count the Invocations column prints', () => {
  it('asks a Warlock 1 for one, a Warlock 2 for three and a Warlock 5 for five', () => {
    expect([ELDRITCH_INVOCATIONS[0], ELDRITCH_INVOCATIONS[1], ELDRITCH_INVOCATIONS[4]]).toEqual([
      1, 3, 5,
    ]);

    // A Warlock 1 has no invocation with a Prerequisite in reach at all, so
    // the one they take is one of the three the SRD prints bare.
    expect(codes(atLevel(1, ['Armor of Shadows']))).toEqual([]);
    expect(codes(atLevel(2, ['Armor of Shadows', 'Eldritch Mind', "Devil's Sight"]))).toEqual([]);
    expect(codes(warlock(['Armor of Shadows', 'Eldritch Mind', "Devil's Sight", 'Fiendish Vigor', 'Misty Visions']))).toEqual([]);
  });

  it('refuses a sixth, and refuses four', () => {
    expect(
      codes(
        warlock([
          'Armor of Shadows',
          'Eldritch Mind',
          "Devil's Sight",
          'Fiendish Vigor',
          'Misty Visions',
          'Mask of Many Faces',
        ]),
      ),
    ).toContain('missing_feature_choice');
    expect(codes(warlock(['Armor of Shadows', 'Eldritch Mind', "Devil's Sight", 'Fiendish Vigor'])))
      .toContain('missing_feature_choice');
  });

  /**
   * "If an invocation has a prerequisite, you must meet it to learn that
   * invocation." Read at the level of the class that granted the feature.
   */
  it('refuses an invocation whose printed level this Warlock has not reached', () => {
    // Ascendant Step is "Level 5+ Warlock", and this one is 3.
    expect(codes(atLevel(3, ['Armor of Shadows', 'Eldritch Mind', 'Ascendant Step']))).toContain(
      'prerequisite_not_met',
    );
    // And the same invocation at level 5 is legal.
    expect(
      codes(
        warlock(['Armor of Shadows', 'Eldritch Mind', "Devil's Sight", 'Fiendish Vigor', 'Ascendant Step']),
      ),
    ).toEqual([]);
  });

  it('refuses an invocation the catalogue does not offer', () => {
    expect(
      codes(
        warlock([
          'Armor of Shadows',
          'Eldritch Mind',
          "Devil's Sight",
          'Fiendish Vigor',
          // Gaze of Two Minds is printed by the book and is not offered here:
          // what it does — one creature borrowing another's senses — has no
          // state to sit in, and an option that does nothing is forbidden.
          'Gaze of Two Minds',
        ]),
      ),
    ).toContain('option_not_offered');
  });
});

// ─── Agonizing Blast ────────────────────────────────────────────────────────

describe('Agonizing Blast', () => {
  const ALL = ['Agonizing Blast', 'Armor of Shadows', 'Eldritch Mind', "Devil's Sight", 'Fiendish Vigor'];
  const WITHOUT = ['Misty Visions', 'Armor of Shadows', 'Eldritch Mind', "Devil's Sight", 'Fiendish Vigor'];

  const blasting = (invocations: readonly string[], answers: Record<string, readonly string[]> = {}) =>
    table(warlock(invocations, answers));

  /**
   * "You can add your Charisma modifier to that spell's damage rolls." Two
   * beams at level 5, so two modifiers: the plural is the whole of `everyRoll`.
   */
  it('adds Charisma to every beam of the cantrip it named', () => {
    const answers = { [`${FIEND}:agonizing-blast`]: ['eldritch-blast'] };
    const withIt = blasting(ALL, answers);
    const without = blasting(WITHOUT);

    const cast = (log: readonly GameEvent[]) =>
      unwrap(
        resolveSpell(
          fold('seed', log),
          WHO,
          // One creature, and the cantrip's two beams both go to it.
          { spellId: 'eldritch-blast', targets: [TARGET] },
          supply('one', 50),
        ),
        'blast',
      );

    // Charisma 15 is a +2, and the cantrip throws two beams at level 5.
    expect(dealt(cast(withIt).events) - dealt(cast(without).events)).toBe(4);
  });

  /** "**That** spell's damage rolls" — and no other spell's. */
  it('adds nothing to a cantrip it did not name', () => {
    const answers = { [`${FIEND}:agonizing-blast`]: ['eldritch-blast'] };
    const cast = (log: readonly GameEvent[]) =>
      unwrap(
        resolveSpell(
          fold('seed', log),
          WHO,
          { spellId: 'fire-bolt', targets: [TARGET] },
          supply('two', 50),
        ),
        'bolt',
      );

    expect(dealt(cast(blasting(ALL, answers)).events)).toBe(dealt(cast(blasting(WITHOUT)).events));
  });
});

// ─── the at-will castings ───────────────────────────────────────────────────

describe('an invocation that casts a spell for nothing', () => {
  const FIVE = ['Armor of Shadows', 'Eldritch Mind', "Devil's Sight", 'Fiendish Vigor', 'Misty Visions'];

  it('puts Mage Armor on the sheet as a granted route with no pool and no slot', () => {
    const granted = plan(warlock(FIVE)).spellcasting.granted.find(
      (one) => one.spellId === 'mage-armor',
    );
    expect(granted?.atWill).toBe(true);
    expect(granted?.freeCastPool).toBeNull();
    expect(granted?.slotCasting).toBe(false);
    expect(granted?.source).toBe(FIEND);

    // And it is **not** a prepared Warlock spell: the invocation prints a
    // route, not a place on the class's list.
    const warlockCasting = plan(warlock(FIVE)).spellcasting.classes[0];
    expect(warlockCasting?.prepared).not.toContain('mage-armor');
  });

  it('casts Mage Armor as often as asked and spends no Pact slot', () => {
    // Mage Armor is cast on a creature wearing none, so this Warlock is not.
    const log = table(warlock(FIVE, {}, { equipped: [] }));
    const slots = (state: GameState): number =>
      remaining(state.creatures[WHO]!.resources, pactSlotKey(3));

    let state = fold('seed', log);
    let events: GameEvent[] = [...log];
    expect(slots(state)).toBe(2);

    for (const seed of ['one', 'two', 'three']) {
      const cast = unwrap(
        resolveSpell(state, WHO, { spellId: 'mage-armor', targets: [WHO] }, supply(seed)),
        `cast ${seed}`,
      );
      events = [...events, ...cast.events];
      state = fold('seed', events);
    }

    expect(slots(state)).toBe(2);
  });

  /** Silent Image, Disguise Self, Alter Self, Levitate and Jump, all the same sentence. */
  it('grants every other spell an invocation prices at nothing', () => {
    const granted = (invocation: string, spellId: string) => {
      const five = [invocation, 'Armor of Shadows', 'Eldritch Mind', "Devil's Sight", 'Fiendish Vigor']
        .filter((one, index, all) => all.indexOf(one) === index)
        .slice(0, 5);
      return plan(warlock(five)).spellcasting.granted.find((one) => one.spellId === spellId);
    };

    expect(granted('Misty Visions', 'silent-image')?.atWill).toBe(true);
    expect(granted('Mask of Many Faces', 'disguise-self')?.atWill).toBe(true);
    expect(granted('Otherworldly Leap', 'jump')?.atWill).toBe(true);
    expect(granted('Ascendant Step', 'levitate')?.atWill).toBe(true);
    expect(granted('Master of Myriad Forms', 'alter-self')?.atWill).toBe(true);
  });
});

// ─── Devil's Sight ──────────────────────────────────────────────────────────

describe("Devil's Sight", () => {
  const FIVE = ['Armor of Shadows', 'Eldritch Mind', "Devil's Sight", 'Fiendish Vigor', 'Misty Visions'];

  /**
   * A **Dwarf** Warlock, because SRD's word is "normally": what the invocation
   * buys is the removal of the sentence that stops an ordinary sight-sense
   * working in Darkness, and the sense underneath it is what answers. A human
   * with the invocation and nothing else gets the question back rather than a
   * yes — `docs/design/light-and-sight.md`'s model, unchanged.
   */
  const dwarf = (invocations: readonly string[]): CharacterChoices =>
    warlock(invocations, {}, {
      speciesId: 'dwarf',
      featureChoices: { [FIEND]: invocations },
      feats: {
        'sage:magic-initiate-wizard': base().feats['sage:magic-initiate-wizard']!,
        'warlock:ability-score-improvement': { featId: 'savage-attacker' },
      },
    });

  const inDarkness = (feet: number, invocations: readonly string[]): GameState => {
    const log: GameEvent[] = [
      ...(unwrap(createCharacter(SRD_CONTENT, dwarf(invocations), WHO), 'creation') as GameEvent[]),
      {
        type: 'creature-added',
        id: TARGET,
        name: 'an ogre',
        maxHp: 60,
        diesAtZero: true,
        creatureType: 'Giant',
        sheet: {
          level: 1,
          abilities: { str: 19, dex: 8, con: 16, int: 5, wis: 7, cha: 7 },
          skills: {},
          saveProficiencies: [],
          armor: null,
          shield: null,
          armorTraining: { light: false, medium: false, heavy: false, shields: false },
          baseSpeed: 40,
          spellcastingAbility: null,
          stated: { armorClass: 11, proficiencyBonus: 2, initiative: -1 },
        },
      },
      { type: 'scene-set', extent: { width: 600, depth: 600, height: 40 } },
      { type: 'landmark-added', name: 'the well', at: { x: 200, y: 200, z: 0 } },
      { type: 'creature-placed', id: WHO, placement: { from: { landmark: 'the well' }, feet: 0 } },
      {
        type: 'creature-placed',
        id: TARGET,
        placement: { from: { creature: WHO }, feet, bearing: 90 },
      },
      // Magical darkness over the ogre: the kind Darkvision does not answer.
      {
        type: 'light-declared',
        patch: 'the dark',
        region: { origin: { creature: TARGET }, shape: { kind: 'sphere', radius: 0 } },
        level: 'darkness',
        magical: { spellLevel: 2 },
      },
    ];
    return fold('seed', log, SRD_CONTENT);
  };

  /** "within 120 feet of yourself" — a range, and it is read as one. */
  it('sees a creature in magical darkness at 100 feet and not at 130', () => {
    expect(canSee(inDarkness(100, FIVE), WHO, TARGET)).toBe(true);
    expect(canSee(inDarkness(130, FIVE), WHO, TARGET)).toBe(false);
  });

  it('gives a Warlock who did not take it nothing', () => {
    const without = ['Armor of Shadows', 'Eldritch Mind', 'Fiendish Vigor', 'Misty Visions', 'Mask of Many Faces'];
    expect(canSee(inDarkness(100, without), WHO, TARGET)).toBe(false);
  });
});

// ─── Eldritch Mind ──────────────────────────────────────────────────────────

describe('Eldritch Mind', () => {
  const WITH = ['Armor of Shadows', 'Eldritch Mind', "Devil's Sight", 'Fiendish Vigor', 'Misty Visions'];
  const WITHOUT = ['Armor of Shadows', 'Mask of Many Faces', "Devil's Sight", 'Fiendish Vigor', 'Misty Visions'];

  const concentrating = (invocations: readonly string[]): GameState =>
    fold('seed', [
      ...table(warlock(invocations)),
      { type: 'concentration-started', id: WHO, castingId: 'cast:1', spell: 'Hex', level: 1 },
    ]);

  const saveAfterDamage = (invocations: readonly string[]) => {
    const hurt = unwrap(
      resolveDamage(
        concentrating(invocations),
        WHO,
        { amount: 8, source: 'a club' },
        supply('hurt'),
      ),
      'damage',
    );
    return hurt.concentration;
  };

  it('gives Advantage on the Constitution save that maintains Concentration', () => {
    const settled = saveAfterDamage(WITH);
    expect(settled.kind).toBe('resolved');
    if (settled.kind !== 'resolved') throw new Error('unreachable');
    expect(settled.save.mode).toBe('advantage');
  });

  it('gives a Warlock who did not take it nothing', () => {
    const settled = saveAfterDamage(WITHOUT);
    if (settled.kind !== 'resolved') throw new Error('unreachable');
    expect(settled.save.mode).toBe('normal');
  });

  /**
   * "Constitution saving throws that you make **to maintain Concentration**" —
   * and no other save, not even another Constitution one.
   */
  it('gives nothing to a Dexterity save or to a plain Constitution save', () => {
    const state = concentrating(WITH);
    for (const ability of ['dex', 'con'] as const) {
      const rolled = unwrap(
        resolveTest(state, WHO, { kind: 'saving-throw', ability, dc: 12 }, supply(ability)),
        `${ability} save`,
      );
      expect(rolled.test?.mode).toBe('normal');
    }
  });
});

// ─── Fiendish Vigor ─────────────────────────────────────────────────────────

describe('Fiendish Vigor', () => {
  const FIVE = ['Armor of Shadows', 'Eldritch Mind', "Devil's Sight", 'Fiendish Vigor', 'Misty Visions'];

  /**
   * "you don't roll the die for the Temporary Hit Points; you automatically
   * get the highest number on the die." SRD 5.2.1 False Life is "2d4 + 4", so
   * the highest is 8 + 4 — every die takes its top face and the flat addend
   * stands.
   */
  it('takes the top face of every die False Life throws', () => {
    const log = table(warlock(FIVE));
    const cast = unwrap(
      resolveSpell(fold('seed', log), WHO, { spellId: 'false-life', targets: [WHO] }, supply('vigor')),
      'false life',
    );
    const after = fold('seed', [...log, ...cast.events]);
    expect(after.creatures[WHO]?.vitals.temporaryHp).toBe(12);
  });

  /**
   * And a Warlock who casts the same spell off a Pact slot rolls it, because
   * the rule is the grant's rather than the spell's. Driven twenty times from
   * twenty seeds: the maximum is legal on any one of them, and never rolling
   * anything else is not.
   */
  /**
   * And it is the same twenty seeds running. Nothing here is "the dice came
   * out well": 2d4 would be 6 through 12 and this is 12 every time, which is
   * what "you don't roll the die" means.
   */
  it('is the same on every seed, which a rolled 2d4 would not be', () => {
    const log = table(warlock(FIVE));
    const amounts = new Set<number>();
    for (let seed = 0; seed < 20; seed += 1) {
      const cast = unwrap(
        resolveSpell(
          fold('seed', log),
          WHO,
          { spellId: 'false-life', targets: [WHO] },
          supply(`vigor-${String(seed)}`),
        ),
        'false life',
      );
      amounts.add(fold('seed', [...log, ...cast.events]).creatures[WHO]?.vitals.temporaryHp ?? 0);
    }
    expect([...amounts]).toEqual([12]);
  });

  /**
   * The rule is the **grant's** rather than the spell's, which is what the
   * flag on the route says: no other route to False Life carries it.
   */
  it('rides the route rather than the spell', () => {
    const granted = plan(warlock(FIVE)).spellcasting.granted.find(
      (one) => one.spellId === 'false-life',
    );
    expect(granted?.maximisedDice).toBe(true);
    const without = ['Armor of Shadows', 'Eldritch Mind', "Devil's Sight", 'Misty Visions', 'Mask of Many Faces'];
    expect(
      plan(warlock(without)).spellcasting.granted.some((one) => one.spellId === 'false-life'),
    ).toBe(false);
  });
});

// ─── Lessons of the First Ones ──────────────────────────────────────────────

describe('Lessons of the First Ones', () => {
  const five = (featId: string, choice: Record<string, unknown> = {}) =>
    warlock(
      ['Armor of Shadows', 'Eldritch Mind', "Devil's Sight", 'Fiendish Vigor', 'Lessons of the First Ones'],
      {},
      {
        feats: {
          ...base().feats,
          // The level 4 slot takes the Improvement, so the invocation's own
          // slot is free to take an Origin feat nothing else has taken.
          'warlock:ability-score-improvement': {
            featId: 'ability-score-improvement',
            abilities: ['cha', 'con'],
          },
          [`${FIEND}:lessons`]: { featId, ...choice },
        },
      },
    );

  it('grants the Origin feat its holder named', () => {
    expect(codes(five('savage-attacker'))).toEqual([]);
    // The plan names each feat and the slot it came through: the invocation's
    // own key, which is where a second question's answer is filed.
    expect(plan(five('savage-attacker')).feats).toContain(`Savage Attacker (${FIEND}:lessons)`);
  });

  /** "one **Origin** feat of your choice" — and a General feat is not one. */
  it('refuses a feat of another category', () => {
    expect(codes(five('ability-score-improvement', { abilities: ['cha', 'con'] }))).toContain(
      'wrong_feat_category',
    );
  });

  /**
   * And the other half of the same rule: a feat filed under a question this
   * Warlock was never asked. Every compiler of a feat walks the whole record
   * with no gate, so the answer would be honoured rather than merely unread.
   */
  it('refuses a feat filed under an invocation this Warlock did not take', () => {
    const impostor = warlock(
      ['Armor of Shadows', 'Eldritch Mind', "Devil's Sight", 'Fiendish Vigor', 'Misty Visions'],
      {},
      { feats: { ...base().feats, [`${FIEND}:lessons`]: { featId: 'skilled', proficiencies: ['nature', 'stealth', 'survival'] } } },
    );
    expect(codes(impostor)).toContain('feat_not_asked');
  });

  it('refuses a Warlock who took it and named no feat', () => {
    const none = warlock([
      'Armor of Shadows',
      'Eldritch Mind',
      "Devil's Sight",
      'Fiendish Vigor',
      'Lessons of the First Ones',
    ]);
    expect(codes(none)).toContain('missing_feat_choice');
  });
});

// ─── Pact of the Tome ───────────────────────────────────────────────────────

describe('Pact of the Tome', () => {
  const tome = (
    cantrips: readonly string[],
    rituals: readonly string[],
  ): CharacterChoices =>
    warlock(
      ['Armor of Shadows', 'Eldritch Mind', "Devil's Sight", 'Fiendish Vigor', 'Pact of the Tome'],
      {
        [`${FIEND}:tome-cantrips`]: cantrips,
        [`${FIEND}:tome-rituals`]: rituals,
      },
    );

  // Three cantrips off three different class lists, and two Rituals off two
  // more: "The spells can be from any class's spell list."
  const CANTRIPS = ['druidcraft', 'sacred-flame', 'fire-bolt'];
  const RITUALS = ['alarm', 'detect-magic'];

  it('prepares three cantrips from any class list, as Warlock cantrips', () => {
    expect(codes(tome(CANTRIPS, RITUALS))).toEqual([]);
    const casting = plan(tome(CANTRIPS, RITUALS)).spellcasting.classes[0];
    expect(casting?.classId).toBe('warlock');
    for (const id of CANTRIPS) expect(casting?.cantrips).toContain(id);
  });

  it('prepares the two Ritual-tagged level 1 spells over the count the table prints', () => {
    const casting = plan(tome(CANTRIPS, RITUALS)).spellcasting.classes[0];
    for (const id of RITUALS) expect(casting?.prepared).toContain(id);
    // Over and above whatever the table and the patron already gave, which is
    // what "you have the chosen spells prepared" means: the same Warlock
    // without the book has exactly these two fewer, and neither of them.
    const without = warlock(['Armor of Shadows', 'Eldritch Mind', "Devil's Sight", 'Fiendish Vigor', 'Misty Visions']);
    const bare = plan(without).spellcasting.classes[0]?.prepared ?? [];
    expect(casting?.prepared).toHaveLength(bare.length + 2);
    for (const id of RITUALS) expect(bare).not.toContain(id);
  });

  /** A prepared spell with the Ritual tag is cast as one, and spends nothing. */
  it('casts one of them as a Ritual, without a slot', () => {
    const log = table(tome(CANTRIPS, RITUALS));
    const before = fold('seed', log);
    const slots = (state: GameState): number =>
      remaining(state.creatures[WHO]!.resources, pactSlotKey(3));
    expect(slots(before)).toBe(2);

    // Alarm is cast on a place rather than a creature, so it names nobody.
    const cast = unwrap(
      resolveSpell(before, WHO, { spellId: 'alarm', targets: [], ritual: true }, supply('rite')),
      'ritual',
    );
    expect(slots(fold('seed', [...log, ...cast.events]))).toBe(2);

    // The route it came through is the Warlock's own, on Charisma: "they
    // function as Warlock spells for you".
    expect(routesFor(plan(tome(CANTRIPS, RITUALS)).spellcasting, 'alarm')).toEqual([
      { kind: 'prepared', ability: 'cha', classId: 'warlock' },
    ]);
  });

  it('refuses a cantrip the Warlock already has prepared', () => {
    expect(codes(tome(['eldritch-blast', 'sacred-flame', 'fire-bolt'], RITUALS))).toContain(
      'spell_already_known',
    );
  });

  it('refuses a level 2 spell in the Rituals, and a level 1 spell with no Ritual tag', () => {
    expect(codes(tome(CANTRIPS, ['alarm', 'augury']))).toContain('spell_level_not_allowed');
    expect(codes(tome(CANTRIPS, ['alarm', 'magic-missile']))).toContain('spell_not_a_ritual');
  });
});

// ─── the swap on a level-up ─────────────────────────────────────────────────

describe('replacing an invocation on a level-up', () => {
  /**
   * "Whenever you gain a Warlock level, you can replace one of your
   * invocations with another one for which you qualify." The answer is a
   * re-choice and `advance_character` already writes one, so what this asserts
   * is that the swap arrives on the sheet and takes the old one away.
   */
  it('takes the old invocation off the sheet and puts the new one on', () => {
    const before = atLevel(3, ['Armor of Shadows', 'Eldritch Mind', "Devil's Sight"]);
    const log = unwrap(createCharacter(SRD_CONTENT, before, WHO), 'creation') as GameEvent[];
    const state = fold('seed', log);

    // Mage Armor is on the sheet before the swap and Silent Image is not.
    const spellsOf = (world: GameState): readonly string[] =>
      (world.creatures[WHO]?.spellcasting.granted ?? []).map((one) => one.spellId);
    expect(spellsOf(state)).toContain('mage-armor');
    expect(spellsOf(state)).not.toContain('silent-image');

    const gained = unwrap(
      advanceCharacter(state, SRD_CONTENT, WHO, {
        cantrips: ['eldritch-blast', 'chill-touch', 'poison-spray'],
        preparedSpells: ['hex', 'charm-person', 'hellish-rebuke', 'hold-person', 'mind-spike'],
        featureChoices: {
          'human:skillful': ['perception'],
          [FIEND]: ['Misty Visions', 'Eldritch Mind', "Devil's Sight"],
        },
        // Level 4 is an Improvement, and the level-up asks for its feat.
        feats: {
          'warlock:ability-score-improvement': {
            featId: 'ability-score-improvement',
            abilities: ['cha', 'con'],
          },
        },
      }),
      'advance',
    );
    const after = fold('seed', [...log, ...gained]);

    expect(after.creatures[WHO]?.sheet.level).toBe(4);
    expect(spellsOf(after)).toContain('silent-image');
    expect(spellsOf(after)).not.toContain('mage-armor');
  });
});

// ─── Eldritch Spear ─────────────────────────────────────────────────────────

/**
 * "When you cast the chosen cantrip, its range increases by a number of feet
 * equal to 30 times your Warlock level."
 *
 * A Warlock 5 adds 150 feet, so Eldritch Blast reaches 270 and not 275 — and
 * Fire Bolt, which prints the same 120, reaches exactly what it printed.
 */
describe('Eldritch Spear', () => {
  const SPEAR = [
    'Eldritch Spear',
    'Armor of Shadows',
    'Eldritch Mind',
    "Devil's Sight",
    'Fiendish Vigor',
  ];
  const WITHOUT = [
    'Misty Visions',
    'Armor of Shadows',
    'Eldritch Mind',
    "Devil's Sight",
    'Fiendish Vigor',
  ];
  const SPEAR_AT = { [`${FIEND}:eldritch-spear`]: ['eldritch-blast'] };

  const DISTANT = asCharacterId('the-far-ogre');

  /** The table above with a second ogre standing a long way off. */
  const farTable = (choices: CharacterChoices, feet: number): GameEvent[] => [
    ...table(choices),
    {
      type: 'creature-added',
      id: DISTANT,
      name: 'a distant ogre',
      maxHp: 200,
      diesAtZero: true,
      creatureType: 'Giant',
      sheet: {
        level: 1,
        abilities: { str: 19, dex: 8, con: 16, int: 5, wis: 7, cha: 7 },
        skills: {},
        saveProficiencies: [],
        armor: null,
        shield: null,
        armorTraining: { light: false, medium: false, heavy: false, shields: false },
        baseSpeed: 40,
        spellcastingAbility: null,
        stated: { armorClass: 11, proficiencyBonus: 2, initiative: -1 },
      },
    },
    {
      type: 'creature-placed',
      id: DISTANT,
      placement: { from: { creature: WHO }, feet, bearing: 90 },
    },
    { type: 'sight-declared', from: WHO, to: DISTANT, seen: true },
  ];

  const castAt = (
    invocations: readonly string[],
    answers: Record<string, readonly string[]>,
    spellId: string,
    feet: number,
  ) =>
    resolveSpell(
      fold('seed', farTable(warlock(invocations, answers), feet)),
      WHO,
      { spellId, targets: [DISTANT] },
      supply('spear'),
    );

  it('reaches 270 feet with the cantrip it named, and 275 is still too far', () => {
    expect(castAt(SPEAR, SPEAR_AT, 'eldritch-blast', 270).ok).toBe(true);

    const beyond = castAt(SPEAR, SPEAR_AT, 'eldritch-blast', 275);
    expect(beyond.ok).toBe(false);
    expect(beyond.ok ? null : beyond.code).toBe('out_of_range');
  });

  it('leaves a cantrip it did not name at its printed range', () => {
    const bolt = castAt(SPEAR, SPEAR_AT, 'fire-bolt', 270);
    expect(bolt.ok).toBe(false);
    expect(bolt.ok ? null : bolt.code).toBe('out_of_range');
    expect(castAt(SPEAR, SPEAR_AT, 'fire-bolt', 120).ok).toBe(true);
  });

  it('does nothing at all for a Warlock who did not take it', () => {
    const blast = castAt(WITHOUT, {}, 'eldritch-blast', 270);
    expect(blast.ok).toBe(false);
    expect(blast.ok ? null : blast.code).toBe('out_of_range');
  });
});

// ─── Repelling Blast ────────────────────────────────────────────────────────

/**
 * "When you hit a Large or smaller creature with the chosen cantrip, you can
 * push the creature up to 10 feet straight away from you."
 *
 * The shove `applyRiders` already performs, hung on the caster's side: the
 * definition of Eldritch Blast says nothing about pushing anybody, and the
 * sentence is printed on the Warlock.
 */
describe('Repelling Blast', () => {
  const REPEL = [
    'Repelling Blast',
    'Armor of Shadows',
    'Eldritch Mind',
    "Devil's Sight",
    'Fiendish Vigor',
  ];
  const WITHOUT = [
    'Misty Visions',
    'Armor of Shadows',
    'Eldritch Mind',
    "Devil's Sight",
    'Fiendish Vigor',
  ];
  const REPEL_AT = { [`${FIEND}:repelling-blast`]: ['eldritch-blast'] };

  const MOB = asCharacterId('the-mob');

  /** The table above with one more creature of a stated size standing near. */
  const sized = (choices: CharacterChoices, size: 'medium' | 'huge'): GameEvent[] => [
    ...table(choices),
    {
      type: 'creature-added',
      id: MOB,
      name: `a ${size} thing`,
      maxHp: 200,
      diesAtZero: true,
      creatureType: 'Humanoid',
      size,
      sheet: {
        level: 1,
        abilities: { str: 8, dex: 14, con: 10, int: 10, wis: 8, cha: 8 },
        skills: {},
        saveProficiencies: [],
        armor: null,
        shield: null,
        armorTraining: { light: false, medium: false, heavy: false, shields: false },
        baseSpeed: 30,
        spellcastingAbility: null,
        stated: { armorClass: 10, proficiencyBonus: 2, initiative: 2 },
      },
    },
    {
      type: 'creature-placed',
      id: MOB,
      placement: { from: { creature: WHO }, feet: 40, bearing: 90 },
    },
    { type: 'sight-declared', from: WHO, to: MOB, seen: true },
  ];

  const blastAt = (
    invocations: readonly string[],
    answers: Record<string, readonly string[]>,
    size: 'medium' | 'huge',
  ) =>
    unwrap(
      resolveSpell(
        fold('seed', sized(warlock(invocations, answers), size)),
        WHO,
        { spellId: 'eldritch-blast', targets: [MOB] },
        // The bonus makes every beam hit, so what is asserted is the rider
        // rather than the die.
        supply('repel', 50),
      ),
      'blast',
    );

  /** Every forced move this casting made the thing take. */
  const shoves = (events: readonly GameEvent[]) =>
    events.filter(
      (event) => event.type === 'creature-moved' && event.id === MOB && event.forced === true,
    );

  it('pushes a Medium creature ten feet for each beam that hits', () => {
    // A Warlock 5's Eldritch Blast throws two beams, and each hit shoves.
    expect(shoves(blastAt(REPEL, REPEL_AT, 'medium').events)).toHaveLength(2);
  });

  it('leaves a Huge creature standing, and says why', () => {
    const huge = blastAt(REPEL, REPEL_AT, 'huge');
    expect(shoves(huge.events)).toHaveLength(0);
    expect(huge.unverified.join(' ')).toContain('Large or smaller');
  });

  it('shoves nobody for a Warlock who did not take it', () => {
    expect(shoves(blastAt(WITHOUT, {}, 'medium').events)).toHaveLength(0);
  });
});

// ─── Gift of the Depths and One with Shadows ────────────────────────────────

describe('Gift of the Depths', () => {
  const GIFT = [
    'Gift of the Depths',
    'Armor of Shadows',
    'Eldritch Mind',
    "Devil's Sight",
    'Fiendish Vigor',
  ];

  /** "You gain a Swim Speed equal to your Speed." */
  it('swims at the Speed it walks at', () => {
    const state = fold('seed', table(warlock(GIFT)));
    expect(speedOf(state, WHO, 'swim')).toBe(speedOf(state, WHO, 'walk'));
    expect(speedOf(state, WHO, 'swim')).toBeGreaterThan(0);

    const without = fold('seed', table(warlock(['Misty Visions', 'Armor of Shadows', 'Eldritch Mind', "Devil's Sight", 'Fiendish Vigor'])));
    expect(speedOf(without, WHO, 'swim')).toBe(0);
  });

  /** "You can also cast Water Breathing once without expending a spell slot." */
  it('casts Water Breathing out of a pool of one that a Long Rest refills', () => {
    const granted = plan(warlock(GIFT)).spellcasting.granted.find(
      (one) => one.spellId === 'water-breathing',
    );
    expect(granted?.freeCastPool).toBe('warlock:gift-of-the-depths');
    // The feature's route is the free one, and no slot route beside it.
    expect(granted?.slotCasting).toBe(false);

    // One use, standing on the sheet as a pool the Long Rest already refills.
    const state = fold('seed', table(warlock(GIFT)));
    expect(remaining(state.creatures[WHO]!.resources, 'warlock:gift-of-the-depths')).toBe(1);
  });
});

describe('One with Shadows', () => {
  const SHADOWS = [
    'One with Shadows',
    'Armor of Shadows',
    'Eldritch Mind',
    "Devil's Sight",
    'Fiendish Vigor',
  ];

  /** The table above, lit the way the argument is about. */
  const lit = (level: 'bright' | 'dim'): GameEvent[] => [
    ...table(warlock(SHADOWS)),
    {
      type: 'light-declared',
      patch: 'where the Warlock stands',
      region: { origin: { creature: WHO }, shape: { kind: 'sphere', radius: 5 } },
      level,
    },
  ];

  const castIt = (level: 'bright' | 'dim') =>
    resolveSpell(
      fold('seed', lit(level)),
      WHO,
      { spellId: 'invisibility', targets: [WHO] },
      supply('shadows'),
    );

  it('casts Invisibility for nothing in Dim Light', () => {
    expect(castIt('dim').ok).toBe(true);
  });

  it('is refused in Bright Light', () => {
    const bright = castIt('bright');
    expect(bright.ok).toBe(false);
    expect(bright.ok ? null : bright.code).toBe('route_not_open');
  });

  /**
   * A room nobody has lit refuses too — the "no default ambient" ruling, which
   * is why `declareLight` settles no `ContextRequest` kind — but it is a
   * different problem from a brightly lit one, and only this one is repaired
   * by saying something. So the refusal says which it met.
   */
  it('refuses in a room nobody has lit, and names what would settle it', () => {
    const unlit = resolveSpell(
      fold('seed', table(warlock(SHADOWS))),
      WHO,
      { spellId: 'invisibility', targets: [WHO] },
      supply('unlit'),
    );
    expect(unlit.ok).toBe(false);
    expect(unlit.ok ? null : unlit.code).toBe('route_not_open');
    expect(unlit.ok ? '' : unlit.reason).toContain('declareLight');

    // And the lit room's refusal does not, because nothing was left unsaid.
    const bright = castIt('bright');
    expect(bright.ok ? '' : bright.reason).not.toContain('declareLight');
  });

  /**
   * A room and a creature standing in it are ordinary missing facts, and both
   * have a `ContextRequest` kind and a door — so those two ask rather than
   * refuse. Only the light is the ruling.
   */
  it('asks for a room, and for somewhere to stand in it', () => {
    const creation = unwrap(
      createCharacter(SRD_CONTENT, warlock(SHADOWS), WHO),
      'creation',
    ) as GameEvent[];
    const cast = (log: readonly GameEvent[]) =>
      resolveSpell(
        fold('seed', log),
        WHO,
        { spellId: 'invisibility', targets: [WHO] },
        supply('nowhere'),
      );

    const roomless = cast(creation);
    expect(roomless.ok ? null : roomless.kind).toBe('needs-context');
    expect(roomless.ok ? [] : (roomless.requests ?? []).map((one) => one.kind)).toEqual(['scene']);

    const unplaced = cast([
      ...creation,
      { type: 'scene-set', extent: { width: 100, depth: 100, height: 20 } },
    ]);
    expect(unplaced.ok ? null : unplaced.kind).toBe('needs-context');
    expect(unplaced.ok ? [] : (unplaced.requests ?? []).map((one) => one.kind)).toEqual([
      'position',
    ]);
    expect(unplaced.ok ? '' : (unplaced.requests ?? [])[0]?.satisfyWith).toContain(
      'placeCreatureInScene',
    );
  });
});

// ─── the invocations a Warlock may take more than once ──────────────────────

/**
 * "You can't pick the same invocation more than once unless its description
 * says otherwise." Four say otherwise, and each says the same second sentence:
 * "Each time you do so, choose a different qualifying cantrip."
 */
describe('a Repeatable invocation', () => {
  const TWICE = [
    'Agonizing Blast',
    'Agonizing Blast',
    'Armor of Shadows',
    'Eldritch Mind',
    "Devil's Sight",
  ];

  it('is taken twice and names a different cantrip each time', () => {
    expect(
      codes(
        warlock(TWICE, {
          [`${FIEND}:agonizing-blast`]: ['eldritch-blast'],
          [`${FIEND}:agonizing-blast#2`]: ['chill-touch'],
        }),
      ),
    ).toEqual([]);
  });

  it('refuses the same cantrip twice', () => {
    expect(
      codes(
        warlock(TWICE, {
          [`${FIEND}:agonizing-blast`]: ['eldritch-blast'],
          [`${FIEND}:agonizing-blast#2`]: ['eldritch-blast'],
        }),
      ),
    ).toContain('repeat_names_the_same');
  });

  it('wants an answer for the second copy as well as the first', () => {
    expect(
      codes(warlock(TWICE, { [`${FIEND}:agonizing-blast`]: ['eldritch-blast'] })),
    ).toContain('missing_feature_choice');
  });

  /** Both grants reach the sheet, so both cantrips carry the modifier. */
  it('adds Charisma to each of the two cantrips it named', () => {
    const log = table(
      warlock(TWICE, {
        [`${FIEND}:agonizing-blast`]: ['eldritch-blast'],
        [`${FIEND}:agonizing-blast#2`]: ['poison-spray'],
      }),
    );
    const without = table(
      warlock(['Misty Visions', 'Armor of Shadows', 'Eldritch Mind', "Devil's Sight", 'Fiendish Vigor']),
    );

    const cast = (world: readonly GameEvent[], spellId: string, seed: string) =>
      unwrap(
        resolveSpell(fold('seed', world), WHO, { spellId, targets: [TARGET] }, supply(seed, 50)),
        spellId,
      );

    // Two beams at level 5, so Eldritch Blast gains 2 × +2; Poison Spray is
    // one roll and gains +2.
    expect(dealt(cast(log, 'eldritch-blast', 'a').events) - dealt(cast(without, 'eldritch-blast', 'a').events)).toBe(4);
    expect(dealt(cast(log, 'poison-spray', 'b').events) - dealt(cast(without, 'poison-spray', 'b').events)).toBe(2);
  });

  it('still refuses a second copy of an invocation whose description says nothing', () => {
    expect(
      codes(
        warlock([
          'Armor of Shadows',
          'Armor of Shadows',
          'Eldritch Mind',
          "Devil's Sight",
          'Fiendish Vigor',
        ]),
      ),
    ).toContain('duplicate_option');
  });

  /** Lessons of the First Ones is the one whose repeat is a feat. */
  it('grants a second Origin feat when Lessons of the First Ones is taken twice', () => {
    const choices = warlock(
      [
        'Lessons of the First Ones',
        'Lessons of the First Ones',
        'Armor of Shadows',
        'Eldritch Mind',
        "Devil's Sight",
      ],
      {},
      {
        feats: {
          ...base().feats,
          // The Improvement takes the feat of its own name, so the two the
          // SRD prints under Origin that nothing else here holds are free.
          'warlock:ability-score-improvement': {
            featId: 'ability-score-improvement',
            abilities: ['cha', 'con'],
          },
          [`${FIEND}:lessons`]: { featId: 'skilled', proficiencies: ['athletics', 'acrobatics', 'stealth'] },
          [`${FIEND}:lessons#2`]: { featId: 'savage-attacker' },
        },
      },
    );
    expect(codes(choices)).toEqual([]);
    expect(plan(choices).feats.filter((one) => one.includes(`${FIEND}:lessons`))).toHaveLength(2);
  });

  it('refuses the same feat twice', () => {
    expect(
      codes(
        warlock(
          [
            'Lessons of the First Ones',
            'Lessons of the First Ones',
            'Armor of Shadows',
            'Eldritch Mind',
            "Devil's Sight",
          ],
          {},
          {
            feats: {
              ...base().feats,
              [`${FIEND}:lessons`]: { featId: 'skilled', proficiencies: ['athletics', 'acrobatics', 'stealth'] },
              [`${FIEND}:lessons#2`]: { featId: 'skilled', proficiencies: ['arcana', 'history', 'insight'] },
            },
          },
        ),
      ),
    ).toContain('repeat_names_the_same');
  });
});
