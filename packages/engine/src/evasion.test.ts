import { describe, expect, it } from 'vitest';
import { SPELL_DEFINITIONS, SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent } from './events.js';
import { resolveSpell } from './commands.js';
import { declaredCasting } from './spellcasting.js';
import { planCharacter, type CharacterChoices } from './creation.js';

/**
 * SRD Evasion, which the Rogue and the Monk both have under that name.
 *
 * > "When you're subjected to an effect that allows you to make a Dexterity
 * > saving throw to take only half damage, you instead take no damage if you
 * > succeed on the saving throw and only half damage if you fail."
 *
 * Two features, one rule, and the rule has a name — so the grant is named for
 * it rather than for either class, exactly as `expertise` is. Where the two
 * differ is one clause: the Monk "can't use this feature if you have the
 * Incapacitated condition" and the Rogue's text says nothing of the kind,
 * which is the reason requirements are declared per feature rather than
 * assumed.
 *
 * It is a **defence**, so it is read off the target rather than the caster —
 * the Rogue standing in the Fireball is the one who evades it.
 */

const id = (s: string) => asCharacterId(s);
const WIZARD = id('wizard');
const ROGUE = id('rogue');
const MONK = id('monk');
const OAF = id('oaf');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 9,
  abilities: { str: 10, dex: 10, con: 10, int: 20, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
  ...over,
});

const common = {
  speciesId: 'human',
  backgroundId: 'sage',
  languages: ['Dwarvish', 'Orc'],
  alignment: 'Neutral',
  spellbook: [],
  backgroundEquipment: 'A' as const,
  classEquipment: 'A' as const,
  equipped: [],
  hitPoints: { method: 'fixed' as const },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
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
};

const rogueChoices: CharacterChoices = {
  ...common,
  name: 'Nyx',
  classId: 'rogue',
  level: 7,
  abilities: {
    method: 'standard-array',
    assignment: { str: 8, dex: 15, con: 13, int: 14, wis: 12, cha: 10 },
  },
  abilityIncreases: { con: 2, int: 1 },
  classSkills: ['stealth', 'sleight-of-hand', 'acrobatics', 'investigation'],
  subclassId: 'thief',
  cantrips: [],
  preparedSpells: [],
  featureChoices: {
    'human:skillful': ['perception'],
    'rogue:expertise': ['stealth', 'sleight-of-hand'],
    'rogue:second-expertise': ['acrobatics', 'investigation'],
  },
  feats: { ...common.feats, 'rogue:ability-score-improvement': { featId: 'savage-attacker' } },
};

const monkChoices: CharacterChoices = {
  ...common,
  name: 'Tam',
  classId: 'monk',
  level: 7,
  abilities: {
    method: 'standard-array',
    assignment: { str: 10, dex: 15, con: 13, int: 8, wis: 14, cha: 12 },
  },
  abilityIncreases: { con: 2, wis: 1 },
  classSkills: ['acrobatics', 'stealth'],
  subclassId: 'warrior-of-the-open-hand',
  cantrips: [],
  preparedSpells: [],
  featureChoices: { 'human:skillful': ['perception'] },
  feats: { ...common.feats, 'monk:ability-score-improvement': { featId: 'savage-attacker' } },
};

const built = (choices: CharacterChoices): CharacterSheet =>
  unwrap(planCharacter(SRD_CONTENT,choices), choices.classId).sheet;

const added = (who: CharacterId, character: CharacterSheet): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: character,
  maxHp: 400,
  diesAtZero: false,
  creatureType: 'Humanoid',
});

const SETUP: readonly GameEvent[] = [
  added(WIZARD, sheet()),
  added(ROGUE, built(rogueChoices)),
  added(MONK, built(monkChoices)),
  // Nobody's feature, as the control: the same save, the same spell, no Evasion.
  added(OAF, sheet({ abilities: { str: 10, dex: 15, con: 10, int: 10, wis: 10, cha: 10 } })),
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
  { type: 'landmark-added', name: 'the hall', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: WIZARD, placement: { from: { landmark: 'the hall' }, feet: 0 } },
  { type: 'creature-placed', id: ROGUE, placement: { from: { creature: WIZARD }, feet: 20, bearing: 0 } },
  { type: 'creature-placed', id: MONK, placement: { from: { creature: WIZARD }, feet: 20, bearing: 30 } },
  { type: 'creature-placed', id: OAF, placement: { from: { creature: WIZARD }, feet: 20, bearing: 60 } },
  { type: 'sight-declared', from: WIZARD, to: ROGUE, seen: true },
  { type: 'sight-declared', from: WIZARD, to: MONK, seen: true },
  { type: 'sight-declared', from: WIZARD, to: OAF, seen: true },
  {
    type: 'spellcasting-declared',
    id: WIZARD,
    spellcasting: declaredCasting({
      ability: 'int',
      classId: 'wizard',
      cantrips: SPELL_DEFINITIONS.filter((d) => d.level === 0).map((d) => d.id),
      prepared: SPELL_DEFINITIONS.filter((d) => d.level > 0).map((d) => d.id),
    }),
  },
  ...[1, 2, 3, 4, 5].map(
    (level): GameEvent => ({
      type: 'resource-pool-declared',
      id: WIZARD,
      pool: { key: `spell-slot:${level}`, label: `level ${level}`, max: 9, recovers: 'long-rest' },
    }),
  ),
];

const supply = (bonus: number, seed = 'boom') => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  // The save is forced either way, so the test is about what the damage does
  // rather than about which way a die fell.
  bonuses: [{ source: 'forced', flat: bonus }],
  content: SRD_CONTENT,
});

/**
 * Fireball on everybody, with every save forced the same way.
 *
 * A 20-foot-radius Sphere centred between the three of them, so one casting
 * subjects all three to the same roll of the same dice — which is what makes
 * the comparison between them mean anything.
 */
const fireball = (bonus: number, log: readonly GameEvent[] = SETUP) =>
  unwrap(
    resolveSpell(
      fold('seed', log),
      WIZARD,
      { spellId: 'fireball', targets: [], at: { x: 100, y: 125, z: 0 }, slotLevel: 3 },
      supply(bonus),
    ),
    'fireball',
  );

const damageTo = (out: ReturnType<typeof fireball>, who: CharacterId): number =>
  out.outcomes.find((o) => o.target === who)?.damage ?? -1;

/**
 * A table with the caster and exactly one target.
 *
 * The arithmetic tests need *the same creature with and without the feature*,
 * and they need the dice to be the same both times. An area spell rolls its
 * dice per target and skips the roll entirely for a target that evaded, so any
 * table with two evaders in it has a different generator sequence in the two
 * runs being compared. One target, one save, one roll — and the only
 * difference between the two logs is the sheet under test.
 */
const solo = (who: CharacterId, character: CharacterSheet): readonly GameEvent[] => [
  added(WIZARD, sheet()),
  added(who, character),
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
  { type: 'landmark-added', name: 'the hall', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: WIZARD, placement: { from: { landmark: 'the hall' }, feet: 0 } },
  { type: 'creature-placed', id: who, placement: { from: { creature: WIZARD }, feet: 40, bearing: 0 } },
  { type: 'sight-declared', from: WIZARD, to: who, seen: true },
  {
    type: 'spellcasting-declared',
    id: WIZARD,
    spellcasting: declaredCasting({
      ability: 'int',
      classId: 'wizard',
      cantrips: SPELL_DEFINITIONS.filter((d) => d.level === 0).map((d) => d.id),
      prepared: SPELL_DEFINITIONS.filter((d) => d.level > 0).map((d) => d.id),
    }),
  },
  ...[1, 2, 3, 4, 5].map(
    (level): GameEvent => ({
      type: 'resource-pool-declared',
      id: WIZARD,
      pool: { key: `spell-slot:${level}`, label: `level ${level}`, max: 9, recovers: 'long-rest' },
    }),
  ),
];

/** The Rogue at 7 has Evasion; at 6 the same character does not. */
const rogueAt = (level: number): CharacterSheet =>
  built({
    ...rogueChoices,
    level,
    ...(level >= 4
      ? {}
      : { feats: common.feats }),
  });

const soloFireball = (who: CharacterId, character: CharacterSheet, bonus: number) =>
  unwrap(
    resolveSpell(
      fold('seed', solo(who, character)),
      WIZARD,
      { spellId: 'fireball', targets: [], at: { x: 100, y: 140, z: 0 }, slotLevel: 3 },
      supply(bonus),
    ),
    'fireball',
  );

const soloDamage = (who: CharacterId, character: CharacterSheet, bonus: number): number =>
  soloFireball(who, character, bonus).outcomes.find((o) => o.target === who)?.damage ?? -1;

describe('Evasion turns a halved Dexterity save into none', () => {
  /** SRD: "you instead take no damage if you succeed on the saving throw." */
  it('takes nothing on a success where everybody else takes half', () => {
    const out = fireball(40);
    expect(out.outcomes.map((o) => o.save?.success)).toEqual([true, true, true]);

    expect(damageTo(out, OAF)).toBeGreaterThan(0);
    expect(damageTo(out, ROGUE)).toBe(0);
    expect(damageTo(out, MONK)).toBe(0);
  });

  /**
   * SRD: "and only half damage if you fail."
   *
   * The same Rogue one level either side of the feature, alone in the blast,
   * so the 8d6 is the same roll both times and the only difference is Evasion.
   */
  it('takes half on a failure where the same creature without it takes all', () => {
    const full = soloDamage(ROGUE, rogueAt(6), -40);
    const halved = soloDamage(ROGUE, rogueAt(7), -40);
    expect(full).toBeGreaterThan(0);
    expect(halved).toBe(Math.floor(full / 2));
  });

  /**
   * The halving is the same halving the save already did, so a Rogue who
   * failed takes exactly what an ordinary creature who *succeeded* takes.
   * That equality is the rule stated arithmetically, and it is what a
   * half-of-a-half or a double-halving would break.
   */
  it('halves once, to exactly what a successful save without it would take', () => {
    expect(soloDamage(ROGUE, rogueAt(7), -40)).toBe(soloDamage(ROGUE, rogueAt(6), 40));
  });

  /**
   * SRD: "an effect that allows you to make a Dexterity saving throw **to take
   * only half damage**." Sacred Flame offers nothing on a success, so there is
   * no half to take and Evasion says nothing about it — a successful save
   * already takes none, and a failed one takes all.
   */
  it('says nothing about an effect that offers no half', () => {
    const failed = unwrap(
      resolveSpell(
        fold('seed', SETUP),
        WIZARD,
        { spellId: 'sacred-flame', targets: [ROGUE] },
        supply(-40),
      ),
      'sacred flame',
    );
    const control = unwrap(
      resolveSpell(
        fold('seed', solo(ROGUE, rogueAt(6))),
        WIZARD,
        { spellId: 'sacred-flame', targets: [ROGUE] },
        supply(-40),
      ),
      'sacred flame',
    );
    expect(failed.outcomes[0]?.save?.success).toBe(false);
    expect(failed.outcomes[0]?.damage).toBe(control.outcomes[0]?.damage);
    expect(failed.outcomes[0]?.damage ?? 0).toBeGreaterThan(0);
  });

  /**
   * And nothing about a save of another ability. Ice Storm is Dexterity;
   * Blight is Constitution, and a Rogue takes it whole.
   */
  it('says nothing about a Constitution save', () => {
    const out = unwrap(
      resolveSpell(
        fold('seed', SETUP),
        WIZARD,
        { spellId: 'blight', targets: [ROGUE], slotLevel: 4 },
        supply(40),
      ),
      'blight',
    );
    const control = unwrap(
      resolveSpell(
        fold('seed', SETUP),
        WIZARD,
        { spellId: 'blight', targets: [ROGUE], slotLevel: 4 },
        supply(40),
      ),
      'blight',
    );
    expect(out.outcomes[0]?.save?.success).toBe(true);
    expect(out.outcomes[0]?.damage).toBe(control.outcomes[0]?.damage);
    expect(out.outcomes[0]?.damage ?? 0).toBeGreaterThan(0);
  });
});

describe('the clause that is the Monk’s and not the Rogue’s', () => {
  /** SRD Monk: "You can't use this feature if you have the Incapacitated condition." */
  it('stops for an Incapacitated Monk', () => {
    const stunned: readonly GameEvent[] = [
      ...SETUP,
      { type: 'condition-applied', id: MONK, condition: 'incapacitated', source: 'a spell' },
    ];
    const out = fireball(40, stunned);
    expect(damageTo(out, MONK)).toBeGreaterThan(0);
  });

  /** And the Rogue's text says no such thing, so an Incapacitated Rogue evades. */
  it('does not stop for an Incapacitated Rogue', () => {
    const stunned: readonly GameEvent[] = [
      ...SETUP,
      { type: 'condition-applied', id: ROGUE, condition: 'incapacitated', source: 'a spell' },
    ];
    const out = fireball(40, stunned);
    expect(damageTo(out, ROGUE)).toBe(0);
  });

  /** The requirement is on the feature, and only on the one whose text has it. */
  it('declares the clause on the Monk’s feature alone', () => {
    const requirementsOf = (character: CharacterSheet, feature: string) =>
      character.standing?.find((e) => e.feature === feature)?.requires ?? [];
    expect(requirementsOf(built(monkChoices), 'monk:evasion')).toEqual([
      { kind: 'not-incapacitated' },
    ]);
    expect(requirementsOf(built(rogueChoices), 'rogue:evasion')).toEqual([]);
  });
});

describe('Evasion is a defence, so it is read off the target', () => {
  it('does not help a caster whose target has it', () => {
    // The Rogue casting at the Oaf: the Oaf has no Evasion and takes half.
    const out = fireball(40);
    expect(damageTo(out, OAF)).toBeGreaterThan(0);
    // And the Wizard, who cast it, is outside the Sphere and untouched.
    expect(out.outcomes.some((o) => o.target === WIZARD)).toBe(false);
  });

  /** A creature without the feature takes the ordinary half on a success. */
  it('leaves a creature without the feature exactly where it was', () => {
    expect(soloDamage(ROGUE, rogueAt(6), 40)).toBe(
      Math.floor(soloDamage(ROGUE, rogueAt(6), -40) / 2),
    );
  });
});
