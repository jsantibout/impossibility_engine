import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, type CharacterId, type Result } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { hasCondition } from './conditions.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { spellSlotKey } from './resources.js';
import { declaredCasting } from './spellcasting.js';
import {
  resolveAttack,
  resolveMove,
  resolveSpell,
  resolveTurn,
  takeOpportunityAttack,
} from './commands.js';

/**
 * The spell that ends when its target does one of three things.
 *
 * > SRD Invisibility: "A creature you touch has the Invisible condition until
 * > the spell ends. The spell ends early immediately after the target makes an
 * > attack roll, deals damage, or casts a spell."
 *
 * The three causes were transcribed and two of them were whole: damage names
 * its dealer and a settled casting names its caster. The first read
 * `attack-made`, which is the **Attack action** — so a swing that spent no
 * action, an Opportunity Attack or any attack outside a fight, ended the
 * spell only if it landed, through the damage. "Makes an attack roll" is
 * about the roll and not about the action that paid for it, so the roll's
 * own record now says it was an attack roll, and the ending seam reads that
 * mark wherever a d20 was thrown at an Armour Class.
 */

const id = (s: string): CharacterId => asCharacterId(s);
const WIZARD = id('wizard');
const OGRE = id('ogre');
const ROGUE = id('rogue');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 5,
  abilities: { str: 16, dex: 12, con: 12, int: 16, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
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

/** The ogre beside the wizard who will hide it, the rogue within its reach. */
const PEACE: readonly GameEvent[] = [
  added(WIZARD, 'ogres'),
  added(OGRE, 'ogres'),
  added(ROGUE, 'party'),
  { type: 'items-gained', id: OGRE, items: [{ id: 'greatclub', quantity: 1 }], source: 'kit' },
  {
    type: 'item-equipped',
    id: OGRE,
    item: 'greatclub',
    armor: SRD_CONTENT.item('greatclub')?.armor ?? null,
  },
  {
    type: 'spellcasting-declared',
    id: WIZARD,
    spellcasting: declaredCasting({ ability: 'int', classId: 'wizard', prepared: ['invisibility'] }),
  },
  {
    type: 'resource-pool-declared',
    id: WIZARD,
    pool: { key: spellSlotKey(2), label: 'level 2 spell slot', max: 2, recovers: 'long-rest' },
  },
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
  { type: 'landmark-added', name: 'the ford', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: ROGUE, placement: { from: { landmark: 'the ford' }, feet: 0 } },
  { type: 'creature-placed', id: OGRE, placement: { from: { creature: ROGUE }, feet: 5, bearing: 0 } },
  { type: 'creature-placed', id: WIZARD, placement: { from: { creature: OGRE }, feet: 5, bearing: 0 } },
  { type: 'sight-declared', from: OGRE, to: ROGUE, seen: true },
  { type: 'sight-declared', from: WIZARD, to: OGRE, seen: true },
  { type: 'sight-declared', from: ROGUE, to: OGRE, seen: true },
];


/** A forced flat bonus large enough to settle the attack either way. */
const supply = (flat: number, seed = 'a-quiet-miss') => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
  bonuses: [{ source: 'forced', flat }],
});

const MISSES = -40;
const HITS = 40;

const must = <T,>(result: Result<T>, what: string): T => unwrap(result, what);

const run = (
  log: readonly GameEvent[],
  command: (state: GameState) => Result<{ readonly events: readonly GameEvent[] }>,
  what: string,
): readonly GameEvent[] => [...log, ...must(command(fold('seed', log)), what).events];

/** The wizard hides the ogre, before any fight, so the turn order asks nothing. */
const HIDDEN: readonly GameEvent[] = run(
  PEACE,
  (state) =>
    resolveSpell(state, WIZARD, { spellId: 'invisibility', targets: [OGRE] }, supply(0, 'cast')),
  'invisibility',
);

/** And then the fight, with the ogre acting first. */
const FIGHT: readonly GameEvent[] = [
  ...HIDDEN,
  {
    type: 'combat-started',
    combatants: [
      { id: OGRE, initiative: 20, speed: 30 },
      { id: ROGUE, initiative: 10, speed: 30 },
      { id: WIZARD, initiative: 5, speed: 30 },
    ],
  },
];

/** The rogue's turn: the ogre ends its turn without swinging. */
const ROGUES_TURN: readonly GameEvent[] = run(
  FIGHT,
  (state) => resolveTurn(state, supply(0, 'turn')),
  'end of the ogre turn',
);

const invisibilityRunning = (log: readonly GameEvent[]): boolean =>
  Object.values(fold('seed', log).ongoing).some((record) => record.spell === 'Invisibility');

const isInvisible = (log: readonly GameEvent[]): boolean =>
  hasCondition(fold('seed', log).creatures[OGRE]!.conditions, 'invisible');

/** The roll this creature threw, which the seed must have made a miss. */
const missedBy = (log: readonly GameEvent[], who: CharacterId): boolean =>
  log.some(
    (event) => event.type === 'roll-recorded' && event.who === who && event.outcome === 'miss',
  );

describe('Invisibility ends the moment its target makes an attack roll', () => {
  it('stands after the casting, with the ogre Invisible', () => {
    const log = FIGHT;
    expect(invisibilityRunning(log)).toBe(true);
    expect(isInvisible(log)).toBe(true);
  });

  /**
   * SRD Opportunity Attack: "take a Reaction to make one melee attack" — no
   * Attack action is spent, and the swing here misses, so neither of the other
   * two causes can catch it. The roll alone has to.
   */
  it('ends on an Opportunity Attack that misses', () => {
    const provoked = run(
      ROGUES_TURN,
      (state) =>
        resolveMove(
          state,
          ROGUE,
          { placement: { from: { landmark: 'the ford' }, feet: 20, bearing: 90 } },
          supply(0, 'move'),
        ),
      'move',
    );
    expect(invisibilityRunning(provoked)).toBe(true);

    const swung = run(
      provoked,
      (state) => takeOpportunityAttack(state, OGRE, { weapon: 'greatclub' }, supply(MISSES)),
      'opportunity',
    );
    expect(missedBy(swung, OGRE)).toBe(true);
    expect(invisibilityRunning(swung)).toBe(false);
    expect(isInvisible(swung)).toBe(false);
  });

  /** An attack outside any fight spends no action either. */
  it('ends on a swing outside combat that misses', () => {
    const swung = run(
      HIDDEN,
      (state) => resolveAttack(state, OGRE, { target: ROGUE, weapon: 'greatclub' }, supply(MISSES)),
      'swing',
    );
    expect(missedBy(swung, OGRE)).toBe(true);
    expect(invisibilityRunning(swung)).toBe(false);
  });

  /** The road that always worked: the Attack action, landing. */
  it('still ends on an Attack action that hits', () => {
    const swung = run(
      FIGHT,
      (state) => resolveAttack(state, OGRE, { target: ROGUE, weapon: 'greatclub' }, supply(HITS)),
      'swing',
    );
    expect(invisibilityRunning(swung)).toBe(false);
  });

  /** "the **target** makes an attack roll": somebody else's swing is not the ogre's. */
  it('is untouched by an attack roll somebody else makes', () => {
    const swung = run(
      HIDDEN,
      (state) => resolveAttack(state, ROGUE, { target: OGRE, weapon: null }, supply(MISSES)),
      'swing',
    );
    expect(invisibilityRunning(swung)).toBe(true);
  });
});
