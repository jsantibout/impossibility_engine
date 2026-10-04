import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { currentCombatant } from './combat.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { addCreature, beginCombat, resolveTurn, rollImprovisedDamage } from './commands.js';
import { tallied } from './resources.js';
import { SEVERED_LIMB_TALLY } from './monster.js';

/**
 * M-RISE: SRD Troll, Loathsome Limbs (4/Day).
 *
 * > If the troll ends any turn Bloodied and took 15+ Slashing damage during that
 * > turn, one of the troll's limbs is severed, falls into the troll's space, and
 * > becomes a **Troll Limb**. The limb acts immediately after the troll's turn.
 * > The troll has 1 Exhaustion level for each missing limb, and it grows
 * > replacement limbs the next time it regains Hit Points.
 */

const id = (s: string) => asCharacterId(s);
const TROLL = id('troll');
const HERO = id('hero');
const LIMB = id('troll-limb-1');

const sheet = (): CharacterSheet => ({
  level: 5,
  abilities: { str: 16, dex: 10, con: 14, int: 8, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: ['str', 'con'],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: null,
  weaponProficiencies: ['simple', 'martial'],
});

const supply = (seed = 'troll') => ({
  issuer: createRollIssuer(`r-${seed}`),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

const state = (events: readonly GameEvent[]): GameState => fold('seed', events);

/** A hero and a troll 5 feet apart, the hero first in the order, the troll Bloodied. */
function fight(order: 'hero-first' | 'troll-first' = 'hero-first'): GameEvent[] {
  const events: GameEvent[] = [
    {
      type: 'creature-added',
      id: HERO,
      name: 'hero',
      sheet: sheet(),
      maxHp: 44,
      diesAtZero: false,
      creatureType: 'Humanoid',
      side: 'party',
    },
  ];
  events.push(...unwrap(addCreature(state(events), SRD_CONTENT, TROLL, 'troll'), 'troll').events);
  events.push(
    { type: 'creature-side-declared', id: TROLL, side: 'foes' },
    { type: 'scene-set', extent: { width: 300, depth: 300, height: 40 } },
    { type: 'landmark-added', name: 'the bridge', at: { x: 100, y: 100, z: 0 } },
    { type: 'creature-placed', id: HERO, placement: { from: { landmark: 'the bridge' }, feet: 0 } },
    {
      type: 'creature-placed',
      id: TROLL,
      placement: { from: { creature: HERO }, feet: 5, bearing: 0, size: 'large' },
    },
  );
  events.push(
    ...unwrap(
      beginCombat(
        state(events),
        order === 'hero-first'
          ? [
              { id: HERO, initiative: 20, speed: 30 },
              { id: TROLL, initiative: 10, speed: 30 },
            ]
          : [
              { id: TROLL, initiative: 20, speed: 30 },
              { id: HERO, initiative: 10, speed: 30 },
            ],
      ),
      'combat',
    ),
  );
  // Bloodied: 94 Hit Points, 50 gone.
  events.push({ type: 'damage-taken', id: TROLL, amount: 50 });
  return events;
}

/** Slashing damage on the troll, dealt by the hero, through the typed funnel. */
const slash = (events: GameEvent[], dice: string, type = 'slashing', seed = 'slash'): GameEvent[] => [
  ...events,
  ...unwrap(
    rollImprovisedDamage(state(events), TROLL, { dice, damageType: type, source: 'Greataxe', by: HERO }, supply(seed)),
    'the blow',
  ).events,
];

const endTurn = (events: GameEvent[], seed = 'turn'): GameEvent[] => [
  ...events,
  ...unwrap(resolveTurn(state(events), supply(seed)), 'end of turn').events,
];

describe('Loathsome Limbs', () => {
  it('severs a limb when the troll ends a turn Bloodied having taken 15+ Slashing', () => {
    const events = slash(fight(), '15d2');
    const out = unwrap(resolveTurn(state(events), supply()), 'end of turn');
    const severed = out.events.findIndex((e) => e.type === 'limb-severed');
    const advanced = out.events.findIndex((e) => e.type === 'turn-advanced');
    // At the end of the turn — before the next one begins.
    expect(severed).toBeGreaterThanOrEqual(0);
    expect(severed).toBeLessThan(advanced);

    const atTheEnd = state([...events, ...out.events.slice(0, advanced)]);
    const limb = atTheEnd.creatures[LIMB]!;
    expect(limb.name).toBe('Troll Limb');
    expect(limb.side).toBe('foes');
    // "falls into the troll's space".
    expect(atTheEnd.scene!.positions[LIMB]).toEqual(atTheEnd.scene!.positions[TROLL]);
    // "The limb acts immediately after the troll's turn."
    const order = atTheEnd.combat!.order.map((one) => one.id);
    expect(order.indexOf(LIMB)).toBe(order.indexOf(TROLL) + 1);
    // "The troll has 1 Exhaustion level for each missing limb."
    expect(atTheEnd.creatures[TROLL]!.conditions.exhaustion).toBe(1);
    expect(tallied(atTheEnd.creatures[TROLL]!.resources, SEVERED_LIMB_TALLY)).toBe(1);
  });

  it('grows the limb back the next time the troll regains Hit Points', () => {
    // The hero's turn ends; the troll's begins and Regeneration heals 15.
    const after = state(endTurn(slash(fight(), '15d2')));
    expect(currentCombatant(after.combat!).id).toBe(TROLL);
    expect(after.creatures[LIMB]).toBeDefined();
    expect(after.creatures[TROLL]!.conditions.exhaustion).toBe(0);
  });

  it('keeps the Exhaustion while fire stops the regeneration', () => {
    const burnt = slash(slash(fight(), '15d2'), '1d2', 'fire', 'fire');
    const after = state(endTurn(burnt));
    expect(after.creatures[TROLL]!.conditions.exhaustion).toBe(1);
  });

  it('counts the turn’s Slashing together, and only that turn’s', () => {
    // At least 8, twice in one turn, is at least 16.
    const together = state(endTurn(slash(slash(fight(), '8d2', 'slashing', 'a'), '8d2', 'slashing', 'b')));
    expect(together.creatures[LIMB]).toBeDefined();
    // At most 6, twice, is at most 12.
    const short = state(endTurn(slash(slash(fight(), '3d2', 'slashing', 'a'), '3d2', 'slashing', 'b')));
    expect(short.creatures[LIMB]).toBeUndefined();
  });

  it('does not carry one turn’s Slashing into the next', () => {
    // Fire on the hero's turn keeps the troll Bloodied through its own turn's
    // start; each blow is at most 14, under the line, and together over it.
    const heroTurn = slash(slash(fight(), '7d2', 'slashing', 'a'), '1d2', 'fire', 'f');
    const trollTurn = slash(endTurn(heroTurn), '7d2', 'slashing', 'b');
    const before = state(trollTurn);
    expect(currentCombatant(before.combat!).id).toBe(TROLL);
    const after = state(endTurn(trollTurn, 'troll-end'));
    expect(after.creatures[LIMB]).toBeUndefined();
  });

  it('does not carry a fight’s Slashing into the next fight’s turn of the same number', () => {
    // Turn numbers restart with every fight; the count goes with the fight.
    const first = slash(fight(), '15d2');
    const again: GameEvent[] = [
      ...first,
      { type: 'combat-ended' },
      ...unwrap(
        beginCombat(state([...first, { type: 'combat-ended' }]), [
          { id: HERO, initiative: 20, speed: 30 },
          { id: TROLL, initiative: 10, speed: 30 },
        ]),
        'the second fight',
      ),
    ];
    expect(state(again).creatures[TROLL]!.turnDamage).toBeUndefined();
    expect(state(endTurn(again)).creatures[LIMB]).toBeUndefined();
  });

  it('severs nothing for Fire, or for a troll that is not Bloodied', () => {
    const fire = state(endTurn(slash(fight(), '15d2', 'fire')));
    expect(fire.creatures[LIMB]).toBeUndefined();
    const healthy = fight().filter((e) => !(e.type === 'damage-taken' && e.id === TROLL));
    const unhurt = state(endTurn(slash(healthy, '15d2')));
    expect(unhurt.creatures[LIMB]).toBeUndefined();
  });

  it('seats a limb cut at the end of the troll’s own turn to act next', () => {
    const events = slash(fight('troll-first'), '15d2');
    const after = state(endTurn(events));
    expect(currentCombatant(after.combat!).id).toBe(LIMB);
  });

  it('stops at the four a day the heading prints', () => {
    let events = fight();
    events.push(
      ...[1, 2, 3, 4].map(
        (): GameEvent => ({
          type: 'resource-spent',
          id: TROLL,
          key: SEVERED_LIMB_TALLY,
          amount: 1,
          tally: 'dawn',
        }),
      ),
    );
    events = slash(events, '15d2');
    const after = state(endTurn(events));
    expect(after.creatures[LIMB]).toBeUndefined();
  });

  it('refuses to end the turn without the catalogue a limb is raised from', () => {
    const events = slash(fight(), '15d2');
    const refused = resolveTurn(state(events));
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.code).toBe('limb_owed');
  });

  it('replays to the same world', () => {
    const events = endTurn(slash(fight(), '15d2'));
    expect(fold('seed', JSON.parse(JSON.stringify(events)) as GameEvent[])).toEqual(state(events));
  });
});
