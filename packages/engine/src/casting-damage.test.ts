import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, restoreRng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { resolveDeclaredCast, resolveSpell } from './commands.js';
import { createCharacter, planCharacter, type CharacterChoices } from './creation.js';
import { tallied } from './resources.js';
import { levelGrantedSpells, type SpellbookEntry } from './spellbook.js';
import type { FeatureDefinition } from './progression.js';

/**
 * The five SRD features that reach into a casting's own arithmetic, driven end
 * to end through the public API.
 *
 * | SRD | What it asks for |
 * |---|---|
 * | Foe Slayer (Ranger 20) | "The damage die of your _Hunter's Mark_ is a d10 rather than a d6." |
 * | Elemental Affinity (Draconic Sorcery 6) | "when you cast a spell that deals damage of that type, you can add your Charisma modifier to one damage roll of that spell" |
 * | Potent Cantrip (Evoker 3) | "you miss with the attack roll or the target succeeds on a saving throw ... the target takes half the cantrip's damage" |
 * | Empowered Evocation (Evoker 10) | "Whenever you cast a Wizard spell from the Evocation school, you can add your Intelligence modifier to one damage roll of that spell." |
 * | Overchannel (Evoker 14) | "you can deal maximum damage with that spell", and 2d12 Necrotic per slot level for every use after the first |
 *
 * **Five sentences and one vocabulary member**, which is the claim these tests
 * are here to support. They share a reader — a feature of the *caster*, asked
 * once at the casting, that decides whether this casting is one it reaches and
 * then what it does to the damage — and that shared reader is the shape. What
 * differs between them is one field: a flat addend, a die size, a floor on a
 * miss, a maximisation. The addend is the only arm with two SRD writers, and
 * `casting-damage-homebrew.test.ts` is what shows the other three are
 * vocabulary rather than three special cases.
 *
 * Every damage assertion here is a **number**. Where the dice are rolled the
 * number is the one this seed produces and a control without the feature is
 * asserted beside it, so a change in the arithmetic fails rather than a change
 * in the dice.
 */

const id = (s: string) => asCharacterId(s);
const CASTER = id('caster');
const TARGET = id('target');
const SECOND = id('second');

// — a character of any class at any level, with every choice the plan owes ——
//
// Filled from the catalogue rather than written out, because the five features
// arrive at Ranger 20, Sorcerer 6 and Wizard 3, 10 and 14: a hand-written
// fixture for each would be four hundred lines about spellbooks and Ability
// Score Improvements, none of which any assertion below is about. What each
// test *does* write by hand is the one choice it is about — the Sorcerer's
// damage type.

const SKILLS = [
  'acrobatics',
  'animal-handling',
  'arcana',
  'athletics',
  'deception',
  'history',
  'insight',
  'intimidation',
  'investigation',
  'medicine',
  'nature',
  'perception',
  'performance',
  'persuasion',
  'religion',
  'sleight-of-hand',
  'stealth',
  'survival',
];

const subclassFor = (classId: string): string =>
  SRD_CONTENT.subclasses.find((one) => one.classId === classId)!.id;

const onList = (classId: string, level: number): readonly string[] =>
  SRD_CONTENT.spells
    .filter(
      (spell) =>
        spell.level === level &&
        (SRD_CONTENT.spellEntry(spell.id)?.classes ?? []).includes(classId),
    )
    .map((spell) => spell.id);

const row = (classId: string, level: number) => SRD_CONTENT.classById(classId)!.table[level - 1]!;

/**
 * A list of exactly `want` spells, the ones this test needs first.
 *
 * The counts are the class table's and are not negotiable, so "have Fire Bolt"
 * is expressed by putting it at the front rather than by adding it — which is
 * why every fixture below names the spells its assertion is about.
 */
const filled = (
  want: number,
  needs: readonly string[],
  pool: readonly string[],
): readonly string[] => {
  const out = [...needs.filter((spellId) => pool.includes(spellId))];
  for (const spellId of pool) {
    if (out.length >= want) break;
    if (!out.includes(spellId)) out.push(spellId);
  }
  return out.slice(0, want);
};

const cantripsFor = (classId: string, level: number, needs: readonly string[]): readonly string[] =>
  filled(row(classId, level).cantripsKnown ?? 0, needs, onList(classId, 0));

const levelled = (classId: string): readonly string[] => {
  const out: string[] = [];
  for (let spellLevel = 1; spellLevel <= 9; spellLevel += 1) out.push(...onList(classId, spellLevel));
  return out;
};

/** As many spells off the class list as the table says are prepared. */
const preparedFor = (classId: string, level: number, needs: readonly string[]): readonly string[] =>
  filled(row(classId, level).preparedSpells ?? 0, needs, levelled(classId));

const bookFor = (
  classId: string,
  level: number,
  needs: readonly string[],
): SpellbookEntry[] => {
  if (classId !== 'wizard') return [];
  return filled(levelGrantedSpells(level), needs, levelled('wizard')).map((spellId, index) => ({
    spellId,
    acquiredAt: index < 6 ? 1 : Math.ceil((index - 5) / 2) + 1,
    origin: 'level' as const,
  }));
};

const featuresUpTo = (classId: string, level: number): readonly FeatureDefinition[] =>
  [
    ...(SRD_CONTENT.classById(classId)?.features ?? []),
    ...(SRD_CONTENT.subclassById(subclassFor(classId))?.features ?? []),
    ...(SRD_CONTENT.speciesById('human')?.features ?? []),
    ...(SRD_CONTENT.backgroundById('sage')?.features ?? []),
  ].filter((feature) => (feature.level ?? 1) <= level);

/** The first legal answer to every choice the plan asks, whatever they are. */
const autoChoices = (
  classId: string,
  level: number,
  taken: readonly string[],
  needs: readonly string[] = [],
): Record<string, readonly string[]> => {
  const out: Record<string, readonly string[]> = {};
  const used = new Set<string>(taken);
  const known = new Set(bookFor(classId, level, needs).map((entry) => entry.spellId));
  for (const feature of featuresUpTo(classId, level)) {
    const choice = feature.choice;
    if (choice === undefined) continue;
    if (choice.kind === 'skill') {
      // Expertise doubles a proficiency the character already has, so its
      // options come out of what has been taken rather than out of the rest.
      const expertise = feature.grants?.kind === 'expertise';
      const from = expertise
        ? [...used]
        : (choice.from ?? SKILLS).filter((skill) => !used.has(skill));
      const picked = from.slice(0, choice.choose);
      if (!expertise) for (const skill of picked) used.add(skill);
      out[feature.id] = picked;
    } else if (choice.kind === 'option') {
      out[feature.id] = choice.from.slice(0, choice.choose);
    } else if (choice.kind === 'spell') {
      out[feature.id] = SRD_CONTENT.spells
        .filter((spell) => !known.has(spell.id))
        .filter((spell) => (SRD_CONTENT.spellEntry(spell.id)?.classes ?? []).includes(classId))
        .filter(
          (spell) =>
            (choice.school === undefined || spell.school === choice.school) &&
            (choice.maxLevel === undefined || spell.level <= choice.maxLevel) &&
            spell.level > 0,
        )
        .map((spell) => spell.id)
        .slice(0, choice.choose);
    }
  }
  return out;
};

const improvementSlots = (classId: string, level: number): readonly string[] =>
  (SRD_CONTENT.classById(classId)?.features ?? [])
    .filter(
      (feature) =>
        feature.id.startsWith(`${classId}:ability-score-improvement`) && feature.level <= level,
    )
    .map((feature) => feature.id);

const character = (
  classId: string,
  level: number,
  needs: readonly string[] = [],
  over: Partial<CharacterChoices> = {},
): CharacterChoices => {
  const classSkills =
    classId === 'ranger' ? ['survival', 'perception', 'stealth'] : ['arcana', 'insight'];
  return {
    name: 'Vashti',
    classId,
    level,
    // SRD gives no subclass before level 3, and the level 2 builds below are
    // the controls: the same class, the same spell, and no feature.
    ...(level >= 3 ? { subclassId: subclassFor(classId) } : {}),
    speciesId: 'human',
    backgroundId: 'sage',
    abilities: {
      method: 'standard-array',
      assignment: { str: 8, dex: 14, con: 13, int: 15, wis: 10, cha: 12 },
    },
    abilityIncreases: { con: 2, int: 1 },
    classSkills: classSkills as never,
    languages: ['Draconic', 'Elvish'],
    alignment: 'Neutral',
    cantrips: cantripsFor(classId, level, needs) as never,
    spellbook: bookFor(classId, level, needs),
    preparedSpells: preparedFor(classId, level, needs),
    classEquipment: 'A',
    backgroundEquipment: 'A',
    equipped: [],
    hitPoints: { method: 'fixed' },
    featureChoices: autoChoices(classId, level, classSkills, needs) as never,
    feats: {
      'sage:magic-initiate-wizard': {
        featId: 'magic-initiate',
        spellList: 'wizard',
        spellcastingAbility: 'int',
        cantrips: ['mage-hand', 'ray-of-frost'],
        levelOneSpell: 'find-familiar',
      },
      'human:versatile': { featId: 'alert' },
      ...(classId === 'ranger' ? { 'ranger:fighting-style': { featId: 'archery' } } : {}),
      ...Object.fromEntries(
        improvementSlots(classId, level).map((slot) => [
          slot,
          { featId: 'ability-score-improvement', abilities: ['cha', 'cha'] },
        ]),
      ),
      ...(level >= 19
        ? { [`${classId}:epic-boon`]: { featId: 'boon-of-combat-prowess', abilities: ['cha'] } }
        : {}),
    },
    dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
    ...over,
  };
};

const sheetOf = (choices: CharacterChoices): CharacterSheet =>
  unwrap(planCharacter(SRD_CONTENT, choices), choices.classId).sheet;

/** A target with nothing of its own: no resistance, no feature, plenty of hit points. */
const dummy = (who: CharacterId): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  maxHp: 400,
  diesAtZero: false,
  creatureType: 'Humanoid',
  sheet: {
    level: 1,
    abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    skills: {},
    saveProficiencies: [],
    armor: null,
    shield: null,
    armorTraining: { light: true, medium: true, heavy: true, shields: true },
    baseSpeed: 30,
    spellcastingAbility: null,
    stated: { armorClass: 12, proficiencyBonus: 2, initiative: 0 },
  },
});

/** The caster, two victims and a scene. The slots are the character's own. */
const table = (
  choices: CharacterChoices,
  extra: readonly GameEvent[] = [],
  feet = 40,
): GameEvent[] => [
  ...unwrap(createCharacter(SRD_CONTENT, choices, CASTER), 'create'),
  dummy(TARGET),
  dummy(SECOND),
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
  { type: 'landmark-added', name: 'the hall', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: CASTER, placement: { from: { landmark: 'the hall' }, feet: 0 } },
  {
    type: 'creature-placed',
    id: TARGET,
    placement: { from: { creature: CASTER }, feet, bearing: 0 },
  },
  {
    type: 'creature-placed',
    id: SECOND,
    placement: { from: { creature: CASTER }, feet: feet + 5, bearing: 0 },
  },
  { type: 'sight-declared', from: CASTER, to: TARGET, seen: true },
  { type: 'sight-declared', from: CASTER, to: SECOND, seen: true },
  ...extra,
];

const supply = (state: GameState, flat?: number) => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: state.rng === null ? createRng('seed') : restoreRng(state.rng),
  ...(flat === undefined ? {} : { bonuses: [{ source: 'the test insists', flat }] }),
  content: SRD_CONTENT,
});

/** Certain to hit and certain to fail a save; and the reverse. */
const CERTAIN = 40;
const DOOMED = -40;

const cast = (
  log: readonly GameEvent[],
  request: Parameters<typeof resolveSpell>[2],
  flat?: number,
) => {
  const state = fold('seed', log);
  const result = unwrap(resolveSpell(state, CASTER, request, supply(state, flat)), 'cast');
  const after = [...log, ...result.events];
  return { log: after, state: fold('seed', after), outcome: result };
};

const damageTo = (
  outcome: ReturnType<typeof cast>['outcome'],
  who: CharacterId,
): number => outcome.outcomes.find((one) => one.target === who)?.damage ?? -1;

// — Foe Slayer: a d6 that becomes a d10 —————————————————————————————————

describe("Foe Slayer makes Hunter's Mark a d10", () => {
  const ranger = (level: number) => character('ranger', level, ['hunters-mark']);

  /**
   * SRD Foe Slayer, the whole feature: "The damage die of your _Hunter's Mark_
   * is a d10 rather than a d6."
   *
   * The assertion is on the **event**, not on a roll, because the die is the
   * thing the casting writes down: `attack-rider-granted` carries the notation
   * every later attack will throw, so this is the pinning as well as the rule.
   */
  it('pins the d10 into the rider the casting grants', () => {
    const { log } = cast(table(ranger(20)), { spellId: 'hunters-mark', targets: [TARGET] });
    const granted = log.find((event) => event.type === 'attack-rider-granted');
    expect(granted && granted.type === 'attack-rider-granted' && granted.rider).toMatchObject({
      dice: '1d10',
      damageType: 'force',
      target: TARGET,
    });
  });

  /** A Ranger 19 has the spell and not the feature, and rolls what it prints. */
  it('leaves a Ranger without the feature on a d6', () => {
    const { log } = cast(table(ranger(19)), { spellId: 'hunters-mark', targets: [TARGET] });
    const granted = log.find((event) => event.type === 'attack-rider-granted');
    expect(granted && granted.type === 'attack-rider-granted' && granted.rider.dice).toBe('1d6');
  });

  /**
   * **And a replay reads the d10 off the log.**
   *
   * The fold opens no catalogue, so a state folded from the events alone knows
   * nothing about Rangers, Foe Slayer or Hunter's Mark. It still holds a rider
   * that rolls a d10, because the casting wrote the altered notation down.
   */
  it('folds to the same rider with no catalogue at all', () => {
    const { log, state } = cast(table(ranger(20)), {
      spellId: 'hunters-mark',
      targets: [TARGET],
    });
    const replayed = fold('seed', log);
    expect(replayed).toEqual(state);
    expect(replayed.creatures[CASTER]?.attackRiders.map((rider) => rider.dice)).toEqual(['1d10']);
  });
});

// — Elemental Affinity: a modifier on one damage roll ———————————————————

describe('Elemental Affinity adds Charisma to one damage roll', () => {
  /** A Draconic Sorcerer 6 who chose Fire, with a Charisma the test can read. */
  const sorcerer = () =>
    character('sorcerer', 6, ['burning-hands', 'ice-knife', 'fire-bolt'], {
      abilities: {
        method: 'standard-array',
        assignment: { str: 8, dex: 14, con: 13, int: 10, wis: 12, cha: 15 },
      },
      featureChoices: {
        ...autoChoices('sorcerer', 6, ['arcana', 'insight'], [
          'burning-hands',
          'ice-knife',
          'fire-bolt',
        ]),
        'draconic-sorcery:elemental-affinity': ['Fire'],
      } as never,
    });

  const CHARISMA_MODIFIER = 3;

  it('reads the chosen type off the same answer the Resistance reads', () => {
    const standing = (sheetOf(sorcerer()).standing ?? []).filter(
      (effect) => effect.feature === 'draconic-sorcery:elemental-affinity',
    );
    expect(standing.map((effect) => effect.grant.kind)).toEqual([
      'damage-resistance',
      'casting-damage',
    ]);
    expect(sheetOf(sorcerer()).abilities.cha).toBe(17);
    expect(standing[0]?.grant).toMatchObject({ damageTypes: ['fire'] });
    expect(standing[1]?.grant).toMatchObject({
      when: { damageTypes: ['fire'] },
      alters: { kind: 'ability-modifier', ability: 'cha' },
      optional: true,
    });
  });

  /**
   * SRD: "when you cast a spell that deals damage of that type, you can add
   * your Charisma modifier to one damage roll of that spell."
   *
   * Fire Bolt at one creature, certain to hit: one damage roll, and the
   * difference between the two castings is exactly the modifier. The cantrip
   * is chosen over a Cone because one target makes "one damage roll"
   * unambiguous — the Cone below is where the ambiguity is the subject.
   */
  it('adds the modifier to a Fire spell the Sorcerer elected it on', () => {
    const request = { spellId: 'fire-bolt', targets: [TARGET] } as const;
    const plain = cast(table(sorcerer(), [], 10), request, CERTAIN);
    const empowered = cast(
      table(sorcerer(), [], 10),
      { ...request, usingFeatures: ['draconic-sorcery:elemental-affinity'] },
      CERTAIN,
    );

    expect(damageTo(plain.outcome, TARGET)).toBe(10);
    expect(damageTo(empowered.outcome, TARGET)).toBe(10 + CHARISMA_MODIFIER);
  });

  /**
   * "**One** damage roll", and the Cone is where that bites.
   *
   * This engine throws a spell's dice once per creature the area caught, so an
   * upcast Cone makes two damage rolls and the SRD lets the caster pick which
   * one the modifier rides. The engine does not pick between candidates when a
   * caller could say, and no caller can say here — so it takes **the first roll
   * the casting makes** and nothing else, which is the stated choice in
   * `takeCastingAddend`. What the assertion pins is the rule that matters:
   * exactly one creature's damage moved, and it moved by exactly the modifier.
   */
  it('adds it to one damage roll and not to every target', () => {
    const request = {
      spellId: 'burning-hands',
      targets: [],
      towards: { x: 100, y: 140, z: 0 },
      slotLevel: 1,
    } as const;
    const plain = cast(table(sorcerer(), [], 10), request, DOOMED);
    const empowered = cast(
      table(sorcerer(), [], 10),
      { ...request, usingFeatures: ['draconic-sorcery:elemental-affinity'] },
      DOOMED,
    );

    expect(plain.outcome.outcomes.map((one) => one.damage)).toEqual([9, 10]);
    expect(empowered.outcome.outcomes.map((one) => one.damage)).toEqual([
      9 + CHARISMA_MODIFIER,
      10,
    ]);
  });

  /**
   * **"You can" is declined by saying nothing**, which is what makes the
   * election a fact the caller states rather than one the engine assumes.
   */
  it('adds nothing when the casting does not name the feature', () => {
    const { outcome } = cast(
      table(sorcerer(), [], 10),
      { spellId: 'fire-bolt', targets: [TARGET] },
      CERTAIN,
    );
    expect(damageTo(outcome, TARGET)).toBe(10);
  });

  /** "of **that** type": a Cold spell is not a Fire one. */
  it('adds nothing to a spell of another damage type', () => {
    const request = {
      spellId: 'ice-knife',
      targets: [TARGET],
      usingFeatures: ['draconic-sorcery:elemental-affinity'],
    } as const;
    const { outcome } = cast(table(sorcerer(), [], 10), request, DOOMED);
    const plain = cast(table(sorcerer(), [], 10), { spellId: 'ice-knife', targets: [TARGET] }, DOOMED);
    expect(damageTo(outcome, TARGET)).toBe(damageTo(plain.outcome, TARGET));
  });

  /** A feature nobody has is a refusal naming it, not a silent no-op. */
  it('refuses a feature the caster has not got', () => {
    const state = fold('seed', table(sorcerer(), [], 10));
    const out = resolveSpell(
      state,
      CASTER,
      {
        spellId: 'burning-hands',
        targets: [],
        towards: { x: 100, y: 140, z: 0 },
        slotLevel: 1,
        usingFeatures: ['evoker:overchannel'],
      },
      supply(state),
    );
    expect(isErr(out)).toBe(true);
    if (isErr(out)) {
      expect(out.code).toBe('no_such_feature');
      expect(out.reason).toContain('evoker:overchannel');
    }
  });
});

// — Potent Cantrip: a floor where the definition offers none ————————————

describe('Potent Cantrip puts half under a miss and a made save', () => {
  const evoker = (level: number) =>
    character('wizard', level, ['fire-bolt', 'acid-splash', 'burning-hands']);

  /**
   * SRD: "you miss with the attack roll ... the target takes half the cantrip's
   * damage (if any) but suffers no additional effect from the cantrip."
   *
   * Fire Bolt at Wizard 3 is 1d10, and the miss deals half of whatever it
   * rolled. The outcome still reports the miss: `affected` is false, exactly as
   * it is for a creature that made its save and took half anyway.
   */
  it('deals half of a missed Fire Bolt', () => {
    const { outcome } = cast(table(evoker(3)), { spellId: 'fire-bolt', targets: [TARGET] }, DOOMED);
    expect(outcome.outcomes[0]).toMatchObject({ affected: false });
    expect(damageTo(outcome, TARGET)).toBe(3);
  });

  /** A Wizard 2 has Fire Bolt and not the feature, and a miss is a miss. */
  it('leaves a Wizard without the feature dealing nothing on a miss', () => {
    const { outcome, state } = cast(
      table(evoker(2)),
      { spellId: 'fire-bolt', targets: [TARGET] },
      DOOMED,
    );
    expect(damageTo(outcome, TARGET)).toBe(-1);
    expect(state.creatures[TARGET]?.vitals.hp).toBe(400);
  });

  /**
   * SRD: "or the target succeeds on a saving throw against the cantrip".
   *
   * Acid Splash offers nothing on a success — the definition's `onSuccess` is
   * `none` — so this is the floor the feature puts under a sentence that had
   * none, rather than a halving of a halving.
   */
  it('deals half of an Acid Splash the target saved against', () => {
    const request = { spellId: 'acid-splash', targets: [], at: { x: 100, y: 140, z: 0 } } as const;
    const { outcome } = cast(table(evoker(3)), request, CERTAIN);
    expect(outcome.outcomes[0]).toMatchObject({ affected: false });
    expect(damageTo(outcome, TARGET)).toBe(1);
  });

  it('leaves a Wizard without the feature dealing nothing on a made save', () => {
    const request = { spellId: 'acid-splash', targets: [], at: { x: 100, y: 140, z: 0 } } as const;
    const { outcome } = cast(table(evoker(2)), request, CERTAIN);
    expect(damageTo(outcome, TARGET)).toBe(0);
  });

  /**
   * **And Evasion is asked about the spell, not about the feature.**
   *
   * SRD Evasion triggers on "an effect that allows you to make a Dexterity
   * saving throw to take only half damage". Acid Splash allows a save to take
   * *none*, and Potent Cantrip does not turn it into a spell that offers half —
   * it says the target still takes half anyway. So a Rogue's Evasion does not
   * start biting because the wizard opposite them reached level 3, which is the
   * wrong creature's feature deciding: a failed save takes the cantrip's full
   * damage either way.
   */
  it('leaves a target with Evasion exactly where the spell left them', () => {
    const evading = (who: CharacterId): GameEvent => {
      const base = dummy(who);
      if (base.type !== 'creature-added') throw new Error('not a creature');
      return {
        ...base,
        sheet: {
          ...base.sheet,
          standing: [
            { feature: 'rogue:evasion', name: 'Evasion', reach: { kind: 'self' }, grant: { kind: 'evasion' } },
          ],
        },
      };
    };
    const at = { x: 100, y: 140, z: 0 } as const;
    const nimble = table(evoker(3)).map((event) =>
      event.type === 'creature-added' && event.id === TARGET ? evading(TARGET) : event,
    );
    const failed = cast(nimble, { spellId: 'acid-splash', targets: [], at }, DOOMED);
    const plain = cast(table(evoker(3)), { spellId: 'acid-splash', targets: [], at }, DOOMED);
    expect(damageTo(failed.outcome, TARGET)).toBe(damageTo(plain.outcome, TARGET));
    expect(damageTo(failed.outcome, TARGET)).toBeGreaterThan(0);
  });

  /** "A cantrip", and nothing else: a level 1 slot is outside the sentence. */
  it('does nothing to a levelled spell', () => {
    const request = {
      spellId: 'burning-hands',
      targets: [],
      towards: { x: 100, y: 140, z: 0 },
      slotLevel: 1,
    } as const;
    const withFeature = cast(table(evoker(3), [], 10), request, CERTAIN);
    const without = cast(table(evoker(2), [], 10), request, CERTAIN);
    expect(damageTo(withFeature.outcome, TARGET)).toBe(damageTo(without.outcome, TARGET));
  });
});

// — Empowered Evocation: the same reader on a second class ——————————————

describe('Empowered Evocation adds Intelligence to an Evocation', () => {
  const evoker = (level: number) =>
    character('wizard', level, ['fireball', 'ray-of-sickness']);

  /**
   * SRD: "Whenever you cast a Wizard spell from the Evocation school, you can
   * add your Intelligence modifier to one damage roll of that spell."
   *
   * Fireball at a level 3 slot, one target, the save failed. A level 10 Wizard
   * whose Intelligence is 18 after four Improvements adds +4.
   */
  it('adds the modifier to a Fireball the Wizard elected it on', () => {
    const request = {
      spellId: 'fireball',
      targets: [],
      at: { x: 100, y: 140, z: 0 },
      slotLevel: 3,
    } as const;
    const plain = cast(table(evoker(10)), request, DOOMED);
    const empowered = cast(
      table(evoker(10)),
      { ...request, usingFeatures: ['evoker:empowered-evocation'] },
      DOOMED,
    );

    const modifier = Math.floor((sheetOf(evoker(10)).abilities.int - 10) / 2);
    expect(modifier).toBe(3);
    // One damage roll of the spell, and the Sphere makes one per creature it
    // caught — so the first takes it and the second is untouched, exactly as
    // the Sorcerer's Cone above.
    expect(plain.outcome.outcomes.map((one) => one.damage)).toEqual([26, 19]);
    expect(empowered.outcome.outcomes.map((one) => one.damage)).toEqual([26 + modifier, 19]);
  });

  /**
   * "From the **Evocation** school", and Ray of Sickness is Necromancy.
   *
   * The election is accepted rather than refused — a Wizard 10 who says they
   * are using Empowered Evocation and then casts a Necromancy spell has done
   * nothing illegal — and the feature simply does not reach it.
   */
  it('does nothing to a spell from another school', () => {
    // Ray of Sickness poisons "until the end of your next turn", so it needs an
    // Initiative order for the moment to mean anything.
    const fighting: readonly GameEvent[] = [
      {
        type: 'combat-started',
        combatants: [
          { id: CASTER, initiative: 20, speed: 30 },
          { id: TARGET, initiative: 10, speed: 30 },
          { id: SECOND, initiative: 5, speed: 30 },
        ],
      },
    ];
    const request = { spellId: 'ray-of-sickness', targets: [TARGET], slotLevel: 1 } as const;
    const withFeature = cast(
      table(evoker(10), fighting),
      { ...request, usingFeatures: ['evoker:empowered-evocation'] },
      CERTAIN,
    );
    const without = cast(table(evoker(10), fighting), request, CERTAIN);
    expect(damageTo(without.outcome, TARGET)).toBeGreaterThan(0);
    expect(damageTo(withFeature.outcome, TARGET)).toBe(damageTo(without.outcome, TARGET));
  });

  /** A Wizard 9 has Fireball and not the feature. */
  it('refuses the election from a Wizard who has not got it yet', () => {
    const state = fold('seed', table(evoker(9)));
    const out = resolveSpell(
      state,
      CASTER,
      {
        spellId: 'fireball',
        targets: [],
        at: { x: 100, y: 140, z: 0 },
        slotLevel: 3,
        usingFeatures: ['evoker:empowered-evocation'],
      },
      supply(state),
    );
    expect(isErr(out)).toBe(true);
    if (isErr(out)) expect(out.code).toBe('no_such_feature');
  });
});

// — Overchannel: maximum damage, and what it costs ——————————————————————

describe('Overchannel deals maximum damage and charges for it', () => {
  const evoker = () => character('wizard', 14, ['fireball', 'mage-armor']);

  const FIREBALL = {
    spellId: 'fireball',
    targets: [],
    at: { x: 100, y: 140, z: 0 },
    slotLevel: 3,
    usingFeatures: ['evoker:overchannel'],
  } as const;

  /**
   * SRD: "you can deal maximum damage with that spell on the turn you cast it."
   *
   * 8d6 maximised is 48, and it is 48 every time: nothing is thrown, so the
   * number is the rule rather than the seed. The target's save fails, so
   * nothing is halved.
   */
  it('deals 8d6 as 48', () => {
    const { outcome } = cast(table(evoker()), FIREBALL, DOOMED);
    expect(damageTo(outcome, TARGET)).toBe(48);
    expect(damageTo(outcome, SECOND)).toBe(48);
  });

  /** And a made save takes half of the maximum, which is half of 48. */
  it('halves the maximum for a target that saved', () => {
    const { outcome } = cast(table(evoker()), FIREBALL, CERTAIN);
    expect(damageTo(outcome, TARGET)).toBe(24);
  });

  /** Upcast: a level 5 slot is 10d6, maximised to 60. */
  it('maximises the dice the slot actually bought', () => {
    const { outcome } = cast(table(evoker()), { ...FIREBALL, slotLevel: 5 }, DOOMED);
    expect(damageTo(outcome, TARGET)).toBe(60);
  });

  /**
   * "a spell slot of levels 1–5": a level 6 slot is outside the sentence.
   *
   * The dice are thrown rather than maximised, so the number is the seed's and
   * the control beside it is what makes it mean anything: an unelected casting
   * at the same slot rolls the same, and neither is the 66 an 11d6 maximum
   * would have been. The use is not counted either — the feature did nothing.
   */
  it('does nothing at a slot level above five', () => {
    const elected = cast(table(evoker()), { ...FIREBALL, slotLevel: 6 }, DOOMED);
    const plain = cast(
      table(evoker()),
      { spellId: 'fireball', targets: [], at: { x: 100, y: 140, z: 0 }, slotLevel: 6 },
      DOOMED,
    );
    expect(damageTo(elected.outcome, TARGET)).toBe(36);
    expect(damageTo(plain.outcome, TARGET)).toBe(36);
    expect(tallied(elected.state.creatures[CASTER]!.resources, 'evoker:overchannel')).toBe(0);
  });

  /**
   * SRD: "The first time you do so, you suffer no adverse effect."
   *
   * The use is still counted — "the first time" is a fact about how many have
   * gone before — so the tally reads 1 and the caster is untouched.
   */
  it('charges nothing for the first use and still counts it', () => {
    const { state } = cast(table(evoker()), FIREBALL, DOOMED);
    expect(tallied(state.creatures[CASTER]!.resources, 'evoker:overchannel')).toBe(1);
    expect(state.creatures[CASTER]?.vitals.hp).toBe(
      fold('seed', table(evoker())).creatures[CASTER]?.vitals.hp,
    );
  });

  /**
   * SRD: "If you use this feature again before you finish a Long Rest, you take
   * 2d12 Necrotic damage for each level of the spell slot immediately after you
   * cast it."
   *
   * Two per level at a level 3 slot is 6d12 — between 6 and 72, and this seed
   * rolls a number the assertion names.
   */
  it('charges 6d12 Necrotic for the second use at a level 3 slot', () => {
    const first = cast(table(evoker()), FIREBALL, DOOMED);
    const before = first.state.creatures[CASTER]!.vitals.hp;
    const second = cast(first.log, FIREBALL, DOOMED);

    expect(tallied(second.state.creatures[CASTER]!.resources, 'evoker:overchannel')).toBe(2);
    const backlash = second.log
      .slice(first.log.length)
      .filter((event) => event.type === 'damage-taken' && event.id === CASTER);
    expect(backlash.length).toBe(1);
    expect(backlash[0]).toMatchObject({ source: 'Overchannel' });
    const taken = before - second.state.creatures[CASTER]!.vitals.hp;
    expect(taken).toBe(41);
    expect(taken).toBeGreaterThanOrEqual(6);
    expect(taken).toBeLessThanOrEqual(72);
    // And the spell still dealt its maximum: the price is not a discount.
    expect(damageTo(second.outcome, TARGET)).toBe(48);
  });

  /**
   * SRD: "Each time you use this feature again before finishing a Long Rest,
   * the Necrotic damage per spell level increases by 1d12."
   *
   * The third use is 3d12 per level, so 9d12 at a level 3 slot: strictly more
   * dice than the second, which is what "increases" means.
   */
  it('escalates the price with every further use', () => {
    const first = cast(table(evoker()), FIREBALL, DOOMED);
    const second = cast(first.log, FIREBALL, DOOMED);
    const third = cast(second.log, FIREBALL, DOOMED);

    expect(tallied(third.state.creatures[CASTER]!.resources, 'evoker:overchannel')).toBe(3);
    const price = (a: ReturnType<typeof cast>, b: ReturnType<typeof cast>) =>
      a.state.creatures[CASTER]!.vitals.hp - b.state.creatures[CASTER]!.vitals.hp;
    expect(price(first, second)).toBe(41);
    expect(price(second, third)).toBe(45);
    expect(price(second, third)).toBeGreaterThanOrEqual(9);
    expect(price(second, third)).toBeLessThanOrEqual(108);
  });

  /**
   * SRD: "This damage ignores Resistance and Immunity."
   *
   * The same second use against a caster who resists Necrotic: the backlash is
   * the same number, where a Fireball's Fire would have been halved.
   */
  it('ignores a Resistance the caster holds', () => {
    const resisted = (log: readonly GameEvent[]): GameEvent[] => [
      ...log,
      {
        type: 'damage-defense-granted',
        id: CASTER,
        defense: { source: 'a ring', defense: 'resistant', damageTypes: ['necrotic'] },
      },
    ];
    const first = cast(resisted(table(evoker())), FIREBALL, DOOMED);
    const before = first.state.creatures[CASTER]!.vitals.hp;
    const second = cast(first.log, FIREBALL, DOOMED);
    expect(before - second.state.creatures[CASTER]!.vitals.hp).toBe(41);
  });

  /**
   * "**that deals damage**", which is the clause that keeps the price honest:
   * a Wizard spell that deals none is not a use of the feature at all, so
   * nothing is counted and nothing is charged.
   */
  it('counts no use for a casting that deals no damage', () => {
    const { state } = cast(table(evoker()), {
      spellId: 'mage-armor',
      targets: [CASTER],
      slotLevel: 1,
      usingFeatures: ['evoker:overchannel'],
    });
    expect(tallied(state.creatures[CASTER]!.resources, 'evoker:overchannel')).toBe(0);
  });

  /** A maximised casting throws no die for its damage, and a replay folds the same. */
  it('replays byte-identically with no catalogue', () => {
    const { log, state } = cast(table(evoker()), FIREBALL, DOOMED);
    expect(fold('seed', log)).toEqual(state);
  });
});

// — a casting declared now and settled later ————————————————————————————

/**
 * SRD "Longer Casting Times" and SRD Ready both make a casting a *process*: it
 * is declared, held open for a Counterspell, and settled afterwards. What
 * reaches that settlement is everything the declaration pinned — and an
 * election is the one thing it cannot pin, because `PendingCasting` carries no
 * field for one.
 *
 * So the two halves part company, and both are here: a feature that needs no
 * election reaches the settlement exactly as it reaches any other casting, and
 * an election is **refused at the declaration** rather than accepted and
 * quietly dropped a minute later.
 */
describe('a declared casting takes the features it needs no permission for', () => {
  const evoker = (level: number) =>
    character('wizard', level, level >= 14 ? ['fireball'] : ['fire-bolt', 'acid-splash']);

  const declare = (
    log: readonly GameEvent[],
    request: Parameters<typeof resolveSpell>[2],
    flat?: number,
  ) => {
    const state = fold('seed', log);
    const held = unwrap(resolveSpell(state, CASTER, request, supply(state, flat)), 'declare');
    const after = [...log, ...held.events];
    const mid = fold('seed', after);
    const settled = unwrap(resolveDeclaredCast(mid, held.castingId!, supply(mid, flat)), 'settle');
    return { outcome: settled, state: fold('seed', [...after, ...settled.events]) };
  };

  /** Potent Cantrip needs nobody's permission, so a held Fire Bolt still stings. */
  it('still deals half of a missed cantrip settled a moment later', () => {
    const { outcome } = declare(
      table(evoker(3)),
      { spellId: 'fire-bolt', targets: [TARGET], hold: true },
      DOOMED,
    );
    expect(outcome.outcomes[0]).toMatchObject({ affected: false });
    expect(damageTo(outcome, TARGET)).toBe(3);
  });

  /** And a Wizard 2 settling the same held cantrip takes nothing from a miss. */
  it('leaves a Wizard without the feature dealing nothing', () => {
    const { outcome } = declare(
      table(evoker(2)),
      { spellId: 'fire-bolt', targets: [TARGET], hold: true },
      DOOMED,
    );
    expect(damageTo(outcome, TARGET)).toBe(-1);
  });

  /**
   * **The election is refused, not dropped.** A caster who says they are using
   * Overchannel and holds the casting open is told that the declaration cannot
   * carry the answer, before a slot goes anywhere.
   */
  it('refuses an elected feature on a casting it cannot record one for', () => {
    const log = table(evoker(14));
    const state = fold('seed', log);
    const out = resolveSpell(
      state,
      CASTER,
      {
        spellId: 'fireball',
        targets: [],
        at: { x: 100, y: 140, z: 0 },
        slotLevel: 3,
        hold: true,
        usingFeatures: ['evoker:overchannel'],
      },
      supply(state),
    );
    expect(isErr(out)).toBe(true);
    if (isErr(out)) {
      expect(out.code).toBe('election_on_a_declaration');
      expect(out.reason).toContain('Fireball');
    }
    // And nothing moved: no slot spent, no casting open.
    expect(fold('seed', log)).toEqual(state);
  });
});
