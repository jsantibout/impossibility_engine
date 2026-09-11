import { describe, expect, it } from 'vitest';
import { asCharacterId, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { conditionState, targetConditionModes } from './conditions.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent } from './events.js';
import { resolveAttack, resolveSpell } from './commands.js';
import { declaredCasting } from './spellcasting.js';

/**
 * What the engine does when it does not know where somebody is standing.
 *
 * The rule this file exists to defend: **absence from structured state is not
 * evidence of absence from the world.** An unplaced creature is a creature
 * nobody has said the position of, which is a normal state — positioning is
 * declared, and `position` is `Point | null` precisely so that null can mean
 * "nobody has said" rather than "nowhere".
 *
 * The place that bites is SRD Prone, because it is the one condition whose
 * effect *flips* on distance rather than merely switching off:
 *
 * > "An attack roll against you has Advantage if the attacker is within 5 feet
 * > of you. **Otherwise, that attack roll has Disadvantage.**"
 *
 * There is no conservative direction to fall back on. Reading an unknown
 * distance as "not within 5 feet" hands the attacker Disadvantage on the
 * strength of a fact nobody established — the engine inventing a position by
 * implication, which is exactly the failure the whole positioning design was
 * built to avoid.
 *
 * So distance is three-valued at the point it is read: within, beyond, or
 * nobody has said. The third applies neither half and reports itself.
 */

const id = (s: string) => asCharacterId(s);
const FIGHTER = id('fighter');
const OGRE = id('ogre');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 5,
  abilities: { str: 18, dex: 14, con: 14, int: 10, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: null,
  weaponProficiencies: ['simple', 'martial'],
  ...over,
});

const added = (who: CharacterId, side: string): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 60,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side,
});

/** Two creatures, a weapon, and deliberately no scene at all. */
const NOWHERE: readonly GameEvent[] = [
  added(FIGHTER, 'party'),
  added(OGRE, 'ogres'),
  { type: 'items-gained', id: FIGHTER, items: [{ id: 'longsword', quantity: 1 }], source: 'kit' },
  { type: 'condition-applied', id: OGRE, condition: 'prone', source: 'a shove' },
];

/** The same pair, placed, so the distance is a fact. */
const PLACED: readonly GameEvent[] = [
  ...NOWHERE,
  { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
  { type: 'landmark-added', name: 'the ford', at: { x: 50, y: 50, z: 0 } },
  { type: 'creature-placed', id: FIGHTER, placement: { from: { landmark: 'the ford' }, feet: 0 } },
  { type: 'creature-placed', id: OGRE, placement: { from: { creature: FIGHTER }, feet: 30, bearing: 0 } },
];

const supply = (seed = 'swing') => ({ issuer: createRollIssuer('r'), rng: createRng(seed) as Rng });

const swing = (log: readonly GameEvent[], weapon: string | null = 'longsword') =>
  unwrap(
    resolveAttack(fold('seed', log), FIGHTER, { target: OGRE, weapon }, supply()),
    'attack',
  );

describe('an unknown distance is not a known one', () => {
  /**
   * The condition layer itself, which is where the three states have to exist:
   * a boolean cannot carry "nobody has said".
   */
  it('applies neither half of Prone when nobody has said how far apart they are', () => {
    const prone = conditionState(['prone']);

    expect(targetConditionModes(prone, { withinFiveFeet: true })).toMatchObject([
      { mode: 'advantage' },
    ]);
    expect(targetConditionModes(prone, { withinFiveFeet: false })).toMatchObject([
      { mode: 'disadvantage' },
    ]);
    // Neither, because the rule has no answer without the distance.
    expect(targetConditionModes(prone, {})).toEqual([]);
  });

  /** And the same through the command, which is where it would have bitten. */
  it('does not hand the attacker Disadvantage against an unplaced prone target', () => {
    expect(swing(NOWHERE).attack!.mode).toBe('normal');
  });

  /** The rule still works in full once somebody has said where they are. */
  it('still reads Prone both ways when the distance is known', () => {
    const shooting: readonly GameEvent[] = [
      ...PLACED,
      { type: 'items-gained', id: FIGHTER, items: [{ id: 'longbow', quantity: 1 }], source: 'kit' },
    ];
    expect(swing(shooting, 'longbow').attack!.mode).toBe('disadvantage');

    const beside: readonly GameEvent[] = [
      ...NOWHERE,
      { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
      { type: 'landmark-added', name: 'the ford', at: { x: 50, y: 50, z: 0 } },
      { type: 'creature-placed', id: FIGHTER, placement: { from: { landmark: 'the ford' }, feet: 0 } },
      { type: 'creature-placed', id: OGRE, placement: { from: { creature: FIGHTER }, feet: 5, bearing: 0 } },
    ];
    expect(swing(beside).attack!.mode).toBe('advantage');
  });

  /**
   * And the engine says so rather than staying quiet. A silent normal roll
   * looks exactly like a roll where nothing applied, which is the state this
   * is trying not to be confused with.
   */
  it('reports the fact it could not check', () => {
    expect(swing(NOWHERE).unverified.join(' ')).toMatch(/distance|position|standing/i);

    const shooting: readonly GameEvent[] = [
      ...PLACED,
      { type: 'items-gained', id: FIGHTER, items: [{ id: 'longbow', quantity: 1 }], source: 'kit' },
    ];
    expect(swing(shooting, 'longbow').unverified).toEqual([]);
  });

  /**
   * The automatic critical reads the same distance, and withholding it is the
   * conservative direction — but it is still a fact nobody established, so it
   * is reported too rather than passing as a checked "no".
   */
  it('does not award an automatic critical it cannot justify', () => {
    const paralysed: readonly GameEvent[] = [
      ...NOWHERE.filter((e) => e.type !== 'condition-applied'),
      { type: 'condition-applied', id: OGRE, condition: 'paralyzed', source: 'a spell' },
    ];
    const out = swing(paralysed);
    if (out.attack!.hit) expect(out.attack!.critical).toBe(false);
    expect(out.unverified.join(' ')).toMatch(/distance|position|standing/i);
  });
});

describe('an unplaced enemy is not a distant one either', () => {
  /**
   * SRD: a ranged attack has Disadvantage while an enemy is within 5 feet of
   * you. An enemy nobody has placed might be standing right there, so the
   * engine neither applies it nor pretends to have checked.
   */
  it('reports that it could not tell whether an enemy was close', () => {
    const shooting: readonly GameEvent[] = [
      ...NOWHERE.filter((e) => e.type !== 'condition-applied'),
      { type: 'items-gained', id: FIGHTER, items: [{ id: 'longbow', quantity: 1 }], source: 'kit' },
    ];
    const out = unwrap(
      resolveAttack(
        fold('seed', shooting),
        FIGHTER,
        { target: OGRE, weapon: 'longbow', twoHanded: true },
        supply(),
      ),
      'shot',
    );
    expect(out.unverified.join(' ')).toMatch(/distance|position|standing/i);
  });
});

describe('a creature the engine has no record of is a gap, not an absence', () => {
  /**
   * The refusal has to read as "nobody has told me about this creature", not
   * as "there is no such creature". A DM who has just narrated a second ogre
   * out of the treeline has a real ogre; the engine simply has not been told.
   */
  it('says the record is missing rather than that the creature is not real', () => {
    const out = resolveAttack(
      fold('seed', NOWHERE),
      FIGHTER,
      { target: id('second-ogre'), weapon: 'longsword' },
      supply(),
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe('unknown_creature');
    expect(out.reason).toMatch(/no record|not been added|add it/i);
    expect(out.reason).not.toMatch(/does not exist|no such creature/i);
  });
});

describe('a spell attack measures the same way a weapon does', () => {
  /**
   * `resolveSpell` knew the positions all along — it checks range with them —
   * and passed no distance to the attack roll, so a Prone target handed every
   * spell attack Disadvantage regardless of where the caster stood.
   */
  it('reads Prone off the real distance rather than assuming', () => {
    const table = (feet: number): readonly GameEvent[] => [
      added(FIGHTER, 'party'),
      added(OGRE, 'ogres'),
      { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
      { type: 'landmark-added', name: 'the ford', at: { x: 100, y: 100, z: 0 } },
      { type: 'creature-placed', id: FIGHTER, placement: { from: { landmark: 'the ford' }, feet: 0 } },
      { type: 'creature-placed', id: OGRE, placement: { from: { creature: FIGHTER }, feet, bearing: 0 } },
      { type: 'sight-declared', from: FIGHTER, to: OGRE, seen: true },
      { type: 'condition-applied', id: OGRE, condition: 'prone', source: 'a shove' },
      {
        type: 'spellcasting-declared',
        id: FIGHTER,
        spellcasting: declaredCasting({ ability: 'int', cantrips: ['fire-bolt'] }),
      },
    ];

    const bolt = (feet: number) => {
      const out = unwrap(
        resolveSpell(
          fold('seed', table(feet)),
          FIGHTER,
          { spellId: 'fire-bolt', targets: [OGRE] },
          supply(),
        ),
        'fire-bolt',
      );
      if (out.kind !== 'resolved') throw new Error('expected a resolved cast');
      return out.outcomes[0]?.attack?.mode;
    };

    expect(bolt(5)).toBe('advantage');
    expect(bolt(60)).toBe('disadvantage');
  });
});
