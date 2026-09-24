import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { spellSlotKey } from './resources.js';
import { declaredCasting } from './spellcasting.js';
import { resolveSpell } from './commands.js';
import { armorClassOf } from './standing.js';

/**
 * An Armour Class a spell **floors**, which is not one it sets.
 *
 * SRD Barkskin: "the target has an Armor Class of 17 if its AC is lower than
 * that." `armor-class` supplies a *base calculation* the engine then picks
 * between — Mage Armor's shape — and 17 written that way is wrong in both
 * directions at once: it would beat a plate-armoured 18 down if it replaced,
 * and be discarded under armour if it competed only in the unarmoured branch.
 *
 * So the floor is the last thing read, after the calculation, after the flat
 * bonuses and after whatever a worn item is granting — which is what "if its
 * AC is lower than that" means about a total.
 */

const id = (s: string) => asCharacterId(s);
const DRUID = id('druid');
const SCOUT = id('scout');
const KNIGHT = id('knight');

const plate = () => SRD_CONTENT.item('plate-armor')?.armor ?? null;

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 5,
  abilities: { str: 16, dex: 14, con: 14, int: 10, wis: 18, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'wis',
  ...over,
});

const added = (who: CharacterId, over: Partial<CharacterSheet> = {}): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(over),
  maxHp: 40,
  diesAtZero: false,
  creatureType: 'Humanoid',
});

const SETUP: readonly GameEvent[] = [
  added(DRUID),
  // Dexterity +2 and no armour: 12, which the floor beats.
  added(SCOUT),
  // Plate is 18 flat, which beats the floor and is left alone.
  added(KNIGHT, { armor: plate() }),
  ...[1, 2, 3].map(
    (level): GameEvent => ({
      type: 'resource-pool-declared',
      id: DRUID,
      pool: {
        key: spellSlotKey(level),
        label: `level ${level} spell slot`,
        max: 4,
        recovers: 'long-rest',
      },
    }),
  ),
  { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
  { type: 'landmark-added', name: 'the grove', at: { x: 50, y: 50, z: 0 } },
  { type: 'creature-placed', id: DRUID, placement: { from: { landmark: 'the grove' }, feet: 0 } },
  { type: 'creature-placed', id: SCOUT, placement: { from: { creature: DRUID }, feet: 5, bearing: 0 } },
  { type: 'creature-placed', id: KNIGHT, placement: { from: { creature: DRUID }, feet: 5, bearing: 90 } },
  { type: 'sight-declared', from: DRUID, to: SCOUT, seen: true },
  { type: 'sight-declared', from: DRUID, to: KNIGHT, seen: true },
  {
    type: 'spellcasting-declared',
    id: DRUID,
    spellcasting: declaredCasting({
      ability: 'wis',
      classId: 'druid',
      cantrips: [],
      prepared: ['barkskin'],
    }),
  },
];

const base = (): GameState => fold('seed', SETUP);

const supply = (seed = 'cast') => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

const castOn = (state: GameState, target: CharacterId) =>
  resolveSpell(state, DRUID, { spellId: 'barkskin', targets: [target], slotLevel: 2 }, supply());

describe('Barkskin floors the Armour Class rather than replacing it', () => {
  it('raises a creature whose Armour Class is lower than 17', () => {
    const before = base();
    expect(armorClassOf(before, SCOUT)).toBe(12);

    const out = unwrap(castOn(before, SCOUT), 'barkskin');
    const after = fold('seed', [...SETUP, ...out.events]);

    expect(armorClassOf(after, SCOUT)).toBe(17);
    expect(out.outcomes[0]?.armorClass).toBe(17);
    expect(out.outcomes[0]?.affected).toBe(true);
  });

  /** "if its AC is lower than that" — and a plate-armoured 18 is not. */
  it('leaves a creature already better armoured exactly where it was', () => {
    const before = base();
    expect(armorClassOf(before, KNIGHT)).toBe(18);

    const out = unwrap(castOn(before, KNIGHT), 'barkskin');
    const after = fold('seed', [...SETUP, ...out.events]);

    expect(armorClassOf(after, KNIGHT)).toBe(18);
    expect(out.outcomes[0]?.armorClass).toBe(18);
  });

  /**
   * The floor is read **after** everything else — the calculation, the Shield,
   * every flat bonus — and it is a floor rather than an addend, which is the
   * pair of facts a `+5` bonus would get wrong in both directions. A Shield of
   * Faith's +2 on a 12 is 14, still under the seventeen, so the total is
   * seventeen and not nineteen; a +6 clears it, and the floor then does
   * nothing at all.
   */
  it('is a floor on the total rather than a number added to it', () => {
    const out = unwrap(castOn(base(), SCOUT), 'barkskin');
    const withFloor = fold('seed', [...SETUP, ...out.events]);
    expect(armorClassOf(withFloor, SCOUT)).toBe(17);

    const acBonus = (flat: number, source: string): GameEvent => ({
      type: 'bonus-applied',
      id: SCOUT,
      bonus: { source, bonus: { source, flat }, applies: ['ac'], direction: 'add' },
    });

    const warded = fold('seed', [...SETUP, ...out.events, acBonus(2, 'Shield of Faith#cast:9')]);
    expect(armorClassOf(warded, SCOUT)).toBe(17);

    const shielded = fold('seed', [...SETUP, ...out.events, acBonus(6, 'Shield#cast:9')]);
    expect(armorClassOf(shielded, SCOUT)).toBe(18);
  });

  /** The casting leaves a record, and the floor goes when it does. */
  it('ends with the casting', () => {
    const out = unwrap(castOn(base(), SCOUT), 'barkskin');
    const after = fold('seed', [...SETUP, ...out.events]);
    const casting = Object.keys(after.ongoing)[0];
    expect(casting).toBeDefined();

    const ended = fold('seed', [
      ...SETUP,
      ...out.events,
      { type: 'spell-ended', castingId: casting!, on: null, reason: 'dispelled' },
    ]);
    expect(armorClassOf(ended, SCOUT)).toBe(12);
  });
});
