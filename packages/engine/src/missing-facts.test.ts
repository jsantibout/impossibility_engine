import { describe, expect, it } from 'vitest';
import {
  asCharacterId,
  contextRequestsOf,
  isErr,
  isNeedsContext,
  expect as unwrap,
  type CharacterId,
} from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent } from './events.js';
import { resolveAttack, resolveMove } from './commands.js';

/**
 * What the engine does about a fact nobody has told it, stated as one policy
 * rather than decided command by command.
 *
 * **A rule is never silently skipped for want of a fact.** There are exactly
 * three things that may happen, and which one applies is a property of the
 * rule, not of the command that happened to reach it:
 *
 * | | |
 * |---|---|
 * | The fact is a **precondition of legality** | ask — `needs-context`, nothing spent |
 * | The fact only changes **how well it goes** | proceed under a stated reading, and say which in `unverified` |
 * | The fact is **declared-or-default by design** | the default stands, and it is documented where it is read |
 *
 * The middle row is `unknown-distance.test.ts`'s subject and is settled there:
 * Prone, the automatic critical and the ranged-into-melee penalty all read a
 * distance, and an unknown one applies neither half and reports itself.
 *
 * This file is the other two rows, and the reason it exists is that the engine
 * was inconsistent about the first. Casting Fire Bolt at a creature nobody had
 * placed asked for a position; swinging a longsword at that same creature
 * simply hit, whatever the reach. Same rule — may this attack reach that
 * target — and two different answers, one of which quietly skipped the check.
 */

const id = (s: string) => asCharacterId(s);
const FIGHTER = id('fighter');
const OGRE = id('ogre');

const sheet = (): CharacterSheet => ({
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
});

const added = (who: CharacterId, side: string | null): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 60,
  diesAtZero: false,
  creatureType: 'Humanoid',
  ...(side === null ? {} : { side }),
});

const KIT: GameEvent = {
  type: 'items-gained',
  id: FIGHTER,
  items: [
    { id: 'longsword', quantity: 1 },
    { id: 'longbow', quantity: 1 },
  ],
  source: 'kit',
};

/** A table playing entirely in the fiction: no map, no coordinates. */
const NO_SCENE: readonly GameEvent[] = [added(FIGHTER, 'party'), added(OGRE, 'ogres'), KIT];

/** A table keeping a map, with the ogre not yet on it. */
const MAP_WITHOUT_THE_OGRE: readonly GameEvent[] = [
  ...NO_SCENE,
  { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
  { type: 'landmark-added', name: 'the ford', at: { x: 50, y: 50, z: 0 } },
  { type: 'creature-placed', id: FIGHTER, placement: { from: { landmark: 'the ford' }, feet: 0 } },
];

const PLACED: readonly GameEvent[] = [
  ...MAP_WITHOUT_THE_OGRE,
  { type: 'creature-placed', id: OGRE, placement: { from: { creature: FIGHTER }, feet: 5, bearing: 0 } },
];

const supply = (seed = 'm') => ({ issuer: createRollIssuer('r'), rng: createRng(seed) as Rng });

const swing = (log: readonly GameEvent[], weapon: string | null = 'longsword', dice = supply()) =>
  resolveAttack(fold('s', log), FIGHTER, { target: OGRE, weapon }, dice);

describe('reach is a precondition, so an unknown distance is asked about', () => {
  /**
   * A map is being kept and the ogre is not on it. That is a gap in a record
   * the table is actively maintaining, and the fix is one event — exactly the
   * round trip `resolveSpell` has always made, invisible to the player.
   */
  it('asks where an unplaced target is, rather than reaching any distance', () => {
    const out = swing(MAP_WITHOUT_THE_OGRE);
    expect(isNeedsContext(out)).toBe(true);
    expect(contextRequestsOf(out).map((r) => r.subject)).toContain(OGRE);
    expect(contextRequestsOf(out)[0]?.kind).toBe('position');
  });

  it('asks about the attacker too, when they are the one off the map', () => {
    const attackerOff: readonly GameEvent[] = [
      ...NO_SCENE,
      { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
      { type: 'landmark-added', name: 'the ford', at: { x: 50, y: 50, z: 0 } },
      { type: 'creature-placed', id: OGRE, placement: { from: { landmark: 'the ford' }, feet: 0 } },
    ];
    const out = swing(attackerOff);
    expect(isNeedsContext(out)).toBe(true);
    expect(contextRequestsOf(out).map((r) => r.subject)).toContain(FIGHTER);
  });

  /** A ranged weapon has the same precondition, and a longer one. */
  it('asks for a bow as readily as for a sword', () => {
    expect(isNeedsContext(swing(MAP_WITHOUT_THE_OGRE, 'longbow'))).toBe(true);
  });

  it('costs nothing to ask — no dice, no action, no state', () => {
    const dice = supply();
    const before = {
      state: fold('s', MAP_WITHOUT_THE_OGRE),
      rng: dice.rng.snapshot(),
      rolls: dice.issuer.count,
    };

    expect(isNeedsContext(swing(MAP_WITHOUT_THE_OGRE, 'longsword', dice))).toBe(true);

    expect(fold('s', MAP_WITHOUT_THE_OGRE)).toEqual(before.state);
    expect(dice.rng.snapshot()).toEqual(before.rng);
    expect(dice.issuer.count).toBe(before.rolls);
  });

  it('goes through once somebody says where the ogre is', () => {
    const out = swing(PLACED);
    expect(isErr(out) ? `${out.code}: ${out.reason}` : 'ok').toBe('ok');
  });

  /** And an established distance that is simply too far is still a refusal. */
  it('refuses a reach that has actually been exceeded', () => {
    const far: readonly GameEvent[] = [
      ...MAP_WITHOUT_THE_OGRE,
      { type: 'creature-placed', id: OGRE, placement: { from: { creature: FIGHTER }, feet: 60, bearing: 0 } },
    ];
    const out = swing(far);
    expect(isErr(out)).toBe(true);
    expect(isNeedsContext(out)).toBe(false);
  });
});

describe('a table with no map is not a table with a gap in one', () => {
  /**
   * The asymmetry is deliberate and is the whole reason the seam sits where it
   * does. **No scene at all means positioning is not being used** — an ambush
   * narrated in a corridor nobody drew, a brawl in a room with no grid. SRD
   * play is mostly like this, and demanding a map before anyone may swing a
   * sword is the obstructive behaviour this engine exists not to have.
   *
   * So there the reach check has nothing to check, the attack proceeds, and
   * the result says which rules went unapplied.
   */
  it('swings without a scene, and says what it could not check', () => {
    const out = unwrap(swing(NO_SCENE), 'swing');
    expect(out.unverified.join(' ')).toMatch(/standing|distance|position/i);
  });

  it('lets a sword reach as far as the fiction says, with no map to contradict it', () => {
    // A longsword reaches five feet. With no map there is no distance to
    // measure it against, so the fiction decides and the engine says so.
    expect(isErr(swing(NO_SCENE))).toBe(false);
  });
});

describe('an undeclared side silences two rules, and now says so', () => {
  /**
   * Who is an ally is declared, like cover and sight, and null is a real
   * state — "nobody is anybody's ally by default" withholds a benefit rather
   * than inventing one. That reading is right and it was **silent**, which is
   * the part that was not: two SRD rules simply did not fire, and nothing in
   * the result said why.
   */
  const unsided = (log: readonly GameEvent[]): readonly GameEvent[] =>
    log.map((e) => (e.type === 'creature-added' ? added(e.id, null) : e));

  /** SRD: a ranged attack has Disadvantage while an enemy is within 5 feet. */
  it('reports that it could not tell whether the creature beside you is an enemy', () => {
    const out = unwrap(
      resolveAttack(
        fold('s', unsided(PLACED)),
        FIGHTER,
        { target: OGRE, weapon: 'longbow' },
        supply(),
      ),
      'shoot',
    );
    expect(out.attack!.mode).toBe('normal');
    expect(out.unverified.join(' ')).toMatch(/side|ally|enemy/i);
  });

  /** And with the sides declared it fires, so the report is not noise. */
  it('applies it once somebody says whose side they are on', () => {
    const out = unwrap(
      resolveAttack(fold('s', PLACED), FIGHTER, { target: OGRE, weapon: 'longbow' }, supply()),
      'shoot',
    );
    expect(out.attack!.mode).toBe('disadvantage');
    expect(out.unverified.join(' ')).not.toMatch(/side/i);
  });

  /**
   * SRD: "You can make an Opportunity Attack when a creature that you can see
   * leaves your reach." An ally does not swing at you for walking away, so an
   * undeclared side withholds the offer — and that is a whole Reaction nobody
   * was told about.
   */
  it('reports that nobody was offered an Opportunity Attack for want of sides', () => {
    const out = unwrap(
      resolveMove(
        fold('s', unsided(PLACED)),
        FIGHTER,
        { placement: { from: { creature: OGRE }, feet: 25, bearing: 180 } },
        supply(),
      ),
      'move',
    );
    expect(out.unverified.join(' ')).toMatch(/side/i);
  });

  it('says nothing about sides when they are declared', () => {
    const out = unwrap(
      resolveMove(
        fold('s', PLACED),
        FIGHTER,
        { placement: { from: { creature: OGRE }, feet: 25, bearing: 180 } },
        supply(),
      ),
      'move',
    );
    expect(out.unverified.join(' ')).not.toMatch(/side/i);
  });
});
