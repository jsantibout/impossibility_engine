import { describe, expect, it } from 'vitest';
import { asCharacterId, isErr, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { resolveAttack, resolveSpell, resolveTurn, takeDodge } from './commands.js';
import { declaredCasting } from './spellcasting.js';
import { standingSaveModes } from './standing.js';

/**
 * Dodge, which is the one common action whose benefit outlives the turn.
 *
 * SRD: "If you take the Dodge action, you gain the following benefits: until
 * the start of your next turn, any attack roll made against you has
 * Disadvantage **if you can see the attacker**, and you make Dexterity saving
 * throws with Advantage. You lose these benefits if you have the Incapacitated
 * condition or if your Speed is 0."
 *
 * Every clause of that is a rule the engine already has a shape for, which is
 * why this needed no new machinery of its own:
 *
 * | Clause | Shape |
 * |---|---|
 * | "until the start of your next turn" | a turn-anchored deadline on an active feature |
 * | "any attack roll against you has Disadvantage" | a standing effect, read at the attack |
 * | "Dexterity saving throws with Advantage" | a standing effect, read at the save |
 * | "if you can see the attacker" | declared sight, three-valued |
 * | "lose these benefits if Incapacitated or Speed is 0" | requirements on the effect |
 *
 * What Dodge is not is a feature on anybody's sheet: it is an action every
 * creature can take, so the benefits live in one small table rather than being
 * copied onto every creature ever made.
 */

const id = (s: string) => asCharacterId(s);
const ROGUE = id('rogue');
const OGRE = id('ogre');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 5,
  abilities: { str: 14, dex: 16, con: 12, int: 10, wis: 10, cha: 10 },
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

const SETUP: readonly GameEvent[] = [
  added(ROGUE, 'party'),
  added(OGRE, 'ogres'),
  { type: 'items-gained', id: OGRE, items: [{ id: 'greatclub', quantity: 1 }], source: 'kit' },
  { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
  { type: 'landmark-added', name: 'the hall', at: { x: 50, y: 50, z: 0 } },
  { type: 'creature-placed', id: ROGUE, placement: { from: { landmark: 'the hall' }, feet: 0 } },
  { type: 'creature-placed', id: OGRE, placement: { from: { creature: ROGUE }, feet: 5, bearing: 0 } },
  { type: 'sight-declared', from: ROGUE, to: OGRE, seen: true },
  {
    type: 'combat-started',
    combatants: [
      { id: ROGUE, initiative: 20, speed: 30 },
      { id: OGRE, initiative: 10, speed: 30 },
    ],
  },
];

const supply = (seed = 'swing') => ({ issuer: createRollIssuer('r'), rng: createRng(seed) as Rng });

/** Advance to whoever is next, rolling anything the boundary owes. */
const nextTurn = (log: readonly GameEvent[]): readonly GameEvent[] => [
  ...log,
  ...unwrap(resolveTurn(fold('seed', log), supply('turn')), 'turn').events,
];

/**
 * The rogue Dodges on their own turn, and play passes to the ogre — which is
 * the only order in which the ogre can then swing at them.
 */
const dodging = (log: readonly GameEvent[] = SETUP): readonly GameEvent[] =>
  nextTurn([...log, ...unwrap(takeDodge(fold('seed', log), ROGUE, {}), 'dodge')]);

/** The same passage of play with no Dodge in it, for comparison. */
const waiting = (log: readonly GameEvent[] = SETUP): readonly GameEvent[] => nextTurn(log);

/** The ogre swings at the rogue. */
const swungAt = (log: readonly GameEvent[]) =>
  unwrap(
    resolveAttack(fold('seed', log), OGRE, { target: ROGUE, weapon: 'greatclub' }, supply()),
    'attack',
  );

describe('Dodge makes an attack against you harder', () => {
  it('gives the attacker Disadvantage', () => {
    expect(swungAt(waiting()).attack!.mode).toBe('normal');
    expect(swungAt(dodging()).attack!.mode).toBe('disadvantage');
  });

  it('costs the action', () => {
    const dodged = [...SETUP, ...unwrap(takeDodge(fold('seed', SETUP), ROGUE, {}), 'dodge')];
    expect(fold('seed', dodged).combat?.budgets.rogue?.action).toBe(false);
  });

  it('refuses when the action is already gone', () => {
    const dodged = [...SETUP, ...unwrap(takeDodge(fold('seed', SETUP), ROGUE, {}), 'dodge')];
    expect(isErr(takeDodge(fold('seed', dodged), ROGUE, {}))).toBe(true);
  });

  /** SRD: "if you can see the attacker". A declared blindness gives nothing. */
  it('gives nothing against an attacker the dodger cannot see', () => {
    const blind: readonly GameEvent[] = [
      ...SETUP.filter((e) => !(e.type === 'sight-declared' && e.from === ROGUE)),
      { type: 'sight-declared', from: ROGUE, to: OGRE, seen: false },
    ];
    expect(swungAt(dodging(blind)).attack!.mode).toBe('normal');
  });

  /**
   * But an undeclared line of sight is not blindness. The benefit applies and
   * the fact is reported, on the same reading every other unsaid fact gets.
   */
  it('applies anyway when nobody has said, and says so', () => {
    const unsaid = SETUP.filter((e) => e.type !== 'sight-declared');
    const out = swungAt(dodging(unsaid));
    expect(out.attack!.mode).toBe('disadvantage');
    expect(out.unverified.join(' ')).toMatch(/see/i);
  });
});

describe('Dodge helps a Dexterity saving throw and nothing else', () => {
  /** SRD: "you make Dexterity saving throws with Advantage." */
  it('grants Advantage on Dexterity saves', () => {
    expect(standingSaveModes(fold('seed', dodging()), ROGUE, 'dex')).toEqual([
      { source: 'Dodge', mode: 'advantage' },
    ]);
  });

  it('grants nothing on any other save', () => {
    expect(standingSaveModes(fold('seed', dodging()), ROGUE, 'wis')).toEqual([]);
  });

  /** And it reaches a save the engine rolls, without anybody passing it. */
  it('reaches a saving throw a spell forces', () => {
    const casting: readonly GameEvent[] = [
      ...SETUP,
      {
        type: 'resource-pool-declared',
        id: OGRE,
        pool: { key: 'spell-slot:3', label: 'level 3 spell slot', max: 2, recovers: 'long-rest' },
      },
      {
        type: 'spellcasting-declared',
        id: OGRE,
        spellcasting: declaredCasting({ ability: 'int', prepared: ['fireball'] }),
      },
      { type: 'sight-declared', from: OGRE, to: ROGUE, seen: true },
    ];

    const blast = (log: readonly GameEvent[]) => {
      const out = unwrap(
        resolveSpell(
          fold('seed', log),
          OGRE,
          { spellId: 'fireball', targets: [], at: { x: 50, y: 60, z: 0 }, slotLevel: 3 },
          supply('blast'),
        ),
        'fireball',
      );
      return out.outcomes.find((o) => o.target === ROGUE)?.save?.mode;
    };

    expect(blast(waiting(casting))).toBe('normal');
    expect(blast(dodging(casting))).toBe('advantage');
  });
});

describe('Dodge ends when the SRD says it ends', () => {
  /** SRD: "until the start of your next turn." */
  it('lapses at the start of the dodger’s next turn', () => {
    // On the ogre's turn, the Dodge still stands.
    const during = dodging();
    expect(swungAt(during).attack!.mode).toBe('disadvantage');

    // Round to the rogue's turn and on to the ogre's again: the benefit ended
    // the moment the rogue's turn started, a full turn before this swing.
    const later = nextTurn(nextTurn(during));
    expect(swungAt(later).attack!.mode).toBe('normal');
  });

  /**
   * The moment that tells "start of your next turn" from "end of your next
   * turn", which are a full round apart and which nothing derives from one
   * another. During the rogue's own next turn the Dodge is already over — an
   * end-of-turn deadline would still have it running.
   */
  it('is already over during the dodger’s next turn, not after it', () => {
    const ownTurn = nextTurn(dodging());
    expect(fold('seed', ownTurn).combat?.order[fold('seed', ownTurn).combat!.turnIndex]?.id).toBe(
      ROGUE,
    );
    expect(standingSaveModes(fold('seed', ownTurn), ROGUE, 'dex')).toEqual([]);
  });

  /** SRD: "You lose these benefits if you have the Incapacitated condition." */
  it('gives nothing while Incapacitated', () => {
    const stunned: readonly GameEvent[] = [
      ...dodging(),
      { type: 'condition-applied', id: ROGUE, condition: 'stunned', source: 'a spell' },
    ];
    expect(swungAt(stunned).attack!.mode).toBe('advantage');
  });

  /** SRD: "...or if your Speed is 0." SRD Grappled: "Your Speed becomes 0." */
  it('gives nothing while the dodger’s Speed is 0', () => {
    const held: readonly GameEvent[] = [
      ...dodging(),
      { type: 'condition-applied', id: ROGUE, condition: 'grappled', source: 'the ogre' },
    ];
    expect(swungAt(held).attack!.mode).toBe('normal');
    expect(standingSaveModes(fold('seed', held), ROGUE, 'dex')).toEqual([]);
  });
});

describe('it replays', () => {
  it('replays prefix by prefix', () => {
    const log = dodging();
    for (let n = 0; n <= log.length; n += 1) {
      expect(fold('seed', log.slice(0, n))).toEqual(fold('seed', log.slice(0, n)));
    }
  });

  it('survives JSON', () => {
    const state: GameState = fold('seed', dodging());
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });
});
