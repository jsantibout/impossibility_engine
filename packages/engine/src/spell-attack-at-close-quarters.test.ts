import { SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import { asCharacterId, expect as unwrap, type CharacterId } from '@ie/shared';
import type { Weapon } from '@ie/srd';
import { attackRollModes } from './attack.js';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { resolveAttack, resolveSpell } from './commands.js';
import { createRollIssuer } from './rolls.js';
import { declaredCasting, type SpellcastingState } from './spellcasting.js';

/**
 * SRD "Ranged Attacks": "You have Disadvantage on the attack roll if you are
 * within 5 feet of an enemy who can see you and who isn't Incapacitated."
 *
 * The sentence says *ranged attack*, and a spell attack is one of the two
 * kinds the book prints — "Make a ranged spell attack against the target" is
 * Fire Bolt's own line. The engine decided a ranged attack was happening by
 * asking the **weapon**, and a spell attack names none, so a Wizard shot a
 * Fire Bolt past the ogre's elbow at no penalty while the archer beside them
 * took Disadvantage for standing in the same square.
 *
 * What this file pins is that the rule now reads the *attack's* own range —
 * `attack: 'ranged'` is a field a definition has always carried and nothing
 * has ever read — and that it reads it under exactly the SRD's conditions and
 * no others. A melee spell attack in the same square is untouched.
 */

const id = (s: string) => asCharacterId(s);
const CASTER = id('kessa');
const VICTIM = id('victim');
/** The enemy at the caster's elbow. */
const BRUTE = id('brute');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 14, con: 14, int: 18, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
  weaponProficiencies: ['simple'],
  ...over,
});

const added = (who: CharacterId, side: string): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 200,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side,
});

const WIZARDLY: SpellcastingState = declaredCasting({
  ability: 'int',
  classId: 'wizard',
  cantrips: ['fire-bolt', 'shocking-grasp'],
  prepared: [],
});

/**
 * The caster, a target thirty feet off, and an enemy five feet away.
 *
 * `brute` is the whole fixture: an enemy, close enough, able to act. Each test
 * below removes exactly one of the SRD's conditions and expects the rule to
 * stop applying.
 */
const scene = (extra: readonly GameEvent[] = [], bruteFeet = 5): readonly GameEvent[] => [
  added(CASTER, 'party'),
  added(VICTIM, 'foes'),
  added(BRUTE, 'foes'),
  { type: 'spellcasting-declared', id: CASTER, spellcasting: WIZARDLY },
  { type: 'scene-set', extent: { width: 900, depth: 900, height: 60 } },
  { type: 'landmark-added', name: 'here', at: { x: 200, y: 200, z: 0 } },
  { type: 'creature-placed', id: CASTER, placement: { from: { landmark: 'here' }, feet: 0 } },
  {
    type: 'creature-placed',
    id: VICTIM,
    placement: { from: { creature: CASTER }, feet: 30, bearing: 0 },
  },
  {
    type: 'creature-placed',
    id: BRUTE,
    placement: { from: { creature: CASTER }, feet: bruteFeet, bearing: 180 },
  },
  { type: 'sight-declared', from: CASTER, to: VICTIM, seen: true },
  { type: 'sight-declared', from: VICTIM, to: CASTER, seen: true },
  { type: 'sight-declared', from: CASTER, to: BRUTE, seen: true },
  ...extra,
];

/**
 * An Initiative order, which Shocking Grasp now needs and Fire Bolt does not.
 *
 * Its clause ends "until the start of **its** next turn", so the casting pins
 * a turn-anchored deadline — and a moment in the turn order means nothing
 * before there is one. That is the refusal SRD Ray of Frost has always come
 * back with out of combat, arriving on the second cantrip to carry a rider's
 * own deadline; nothing about the rule this file is testing changed.
 */
const IN_INITIATIVE: readonly GameEvent[] = [
  {
    type: 'combat-started',
    combatants: [
      { id: CASTER, initiative: 20, speed: 30 },
      { id: BRUTE, initiative: 10, speed: 30 },
      { id: VICTIM, initiative: 5, speed: 30 },
    ],
  },
];

/** The brute, declared unable to see the creature at its elbow. */
const BLIND: readonly GameEvent[] = [
  { type: 'sight-declared', from: BRUTE, to: CASTER, seen: false },
];

const state = (log: readonly GameEvent[]): GameState => fold('seed', log);

const supply = (seed = 'bolt') => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

/** The mode a casting's attack roll was actually made at. */
const modeOf = (log: readonly GameEvent[], spellId: string, target: CharacterId): string => {
  const out = unwrap(
    resolveSpell(state(log), CASTER, { spellId, targets: [target] }, supply()),
    `${spellId} at ${target}`,
  );
  const attack = out.outcomes[0]?.attack;
  expect(attack).toBeDefined();
  return attack!.mode;
};

const SHORTBOW: Weapon = (() => {
  const found = SRD_CONTENT.item('shortbow')?.weapon;
  if (found === undefined || found === null) throw new Error('no shortbow in the catalogue');
  return found;
})();

describe('the rule reads the attack’s own range, not the weapon behind it', () => {
  /**
   * The attribution is the claim: a spell attack and a bow are hampered by the
   * *same* rule, so the log names one source for both rather than growing a
   * second spelling of the sentence.
   */
  it('names the same source for a ranged spell attack as for a ranged weapon', () => {
    const weapon = attackRollModes(sheet(), {
      weapon: SHORTBOW,
      targetAc: 10,
      nearbyEnemy: true,
    });
    const spell = attackRollModes(sheet(), {
      weapon: null,
      targetAc: 10,
      nearbyEnemy: true,
      spellAttack: { modifier: 7, ability: 'int', ranged: true },
    });
    expect(weapon).toEqual([{ source: 'enemy within 5 feet', mode: 'disadvantage' }]);
    expect(spell).toEqual(weapon);
  });

  /** SRD Shocking Grasp: "Make a **melee** spell attack." The sentence is not about it. */
  it('leaves a melee spell attack alone', () => {
    expect(
      attackRollModes(sheet(), {
        weapon: null,
        targetAc: 10,
        nearbyEnemy: true,
        spellAttack: { modifier: 7, ability: 'int', ranged: false },
      }),
    ).toEqual([]);
  });
});

describe('a ranged spell attack with an enemy at the caster’s elbow', () => {
  it('is made at Disadvantage', () => {
    expect(modeOf(scene(), 'fire-bolt', VICTIM)).toBe('disadvantage');
  });

  /**
   * SRD Shocking Grasp is a melee spell attack at Touch range, so the enemy
   * five feet away is both the neighbour and the target — and the rule still
   * has nothing to say about it.
   */
  it('does not hamper a melee spell attack from the same square', () => {
    expect(modeOf(scene(IN_INITIATIVE), 'shocking-grasp', BRUTE)).toBe('normal');
  });
});

describe('the three ways out of the sentence', () => {
  /** "…an enemy who **can see you**." */
  it('spares a caster the enemy cannot see', () => {
    expect(modeOf(scene(BLIND), 'fire-bolt', VICTIM)).toBe('normal');
  });

  /**
   * **And the bow answers the same**, because it is the same gatherer.
   *
   * This clause is the one thing about the rule that did change: sight was
   * left out on the grounds that it is usually unsaid, and undeclared still
   * leaves the rule standing — but a creature *declared* unable to see the
   * archer is out of the SRD sentence, and was not before. The claim is
   * asserted through `resolveAttack` as well as through a casting so that a
   * weapon attack cannot quietly grow its own answer again.
   */
  it('spares an archer the enemy cannot see, by the same clause', () => {
    const shooting = (log: readonly GameEvent[]): string => {
      const out = unwrap(
        resolveAttack(
          state([
            ...log,
            {
              type: 'items-gained',
              id: CASTER,
              items: [{ id: 'shortbow', quantity: 1 }],
              source: 'the quiver',
            },
          ]),
          CASTER,
          { target: VICTIM, weapon: 'shortbow' },
          supply(),
        ),
        'the bow',
      );
      expect(out.attack).not.toBeNull();
      return out.attack!.mode;
    };

    expect(shooting(scene())).toBe('disadvantage');
    expect(shooting(scene(BLIND))).toBe('normal');
  });

  /** "…and who **isn't Incapacitated**." */
  it('spares a caster whose neighbour is Incapacitated', () => {
    const stunned: readonly GameEvent[] = [
      { type: 'condition-applied', id: BRUTE, condition: 'stunned', source: 'a spell' },
    ];
    expect(modeOf(scene(stunned), 'fire-bolt', VICTIM)).toBe('normal');
  });

  /** "…if you are **within 5 feet** of an enemy." Ten is not five. */
  it('spares a caster whose nearest enemy is ten feet away', () => {
    expect(modeOf(scene([], 10), 'fire-bolt', VICTIM)).toBe('normal');
  });

  /**
   * And an ally at the elbow is nobody's enemy. Not one of the SRD's three
   * escapes but the fourth word of the sentence, and the one a rule that read
   * "anybody within 5 feet" would get wrong.
   */
  it('spares a caster standing beside a friend', () => {
    const friendly = scene().map((event) =>
      event.type === 'creature-added' && event.id === BRUTE
        ? { ...event, side: 'party' }
        : event,
    );
    expect(modeOf(friendly, 'fire-bolt', VICTIM)).toBe('normal');
  });
});
