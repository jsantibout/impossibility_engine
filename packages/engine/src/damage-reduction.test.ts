import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, restoreRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { declaredCasting } from './spellcasting.js';
import {
  endConcentration,
  resolveAttack,
  resolveSpell,
  resolveTurn,
  settleDamage,
  takeDamageReaction,
} from './commands.js';

/**
 * A rolled amount an ongoing effect takes off a hit, before the defences.
 *
 * SRD Resistance, whole: "You touch a willing creature and choose a damage
 * type … When the creature takes damage of the chosen type before the spell
 * ends, the creature reduces the total damage taken by 1d4. A creature can
 * benefit from this spell only once per turn."
 *
 * **Not the defence of the same name.** `defensesOf` halves; this subtracts a
 * roll, and the two are different arithmetic wearing one word — which is why
 * the order matters and is tested: SRD's "Order of Application" puts an
 * adjustment first and Resistance second, so a d4 off 10 Radiant against a
 * radiant-resistant target leaves 3 and not 4.
 *
 * `reduceDamage` already took an amount off a total, and it was reachable from
 * exactly one place: a Reaction somebody spends. A **standing** grant on the
 * defender was consulted by nothing at all, which is the gap
 * `a-reduction-an-effect-applies-to-damage` named. The grant is the eighth
 * member of the sourced-grant family and needs no lifecycle of its own: the
 * casting is in its source, so a deadline, a dispel and a broken Concentration
 * all end it through the door the other fifteen already use.
 */

const id = (s: string) => asCharacterId(s);
const CLERIC = id('cleric');
const WARD = id('ward');
const MAGE = id('mage');
const THUG = id('thug');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 9,
  abilities: { str: 16, dex: 10, con: 14, int: 18, wis: 18, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'wis',
  weaponProficiencies: ['simple', 'martial'],
  ...over,
});

/**
 * A Reaction that halves what it is offered, built on the sheet so the fixture
 * tests the held path rather than the Rogue.
 */
const BLUNTING: CharacterSheet['reactions'] = [
  {
    feature: 'test:blunt',
    name: 'Blunting',
    window: 'damage-rolled',
    costsReaction: true,
    pool: null,
    reach: { kind: 'self' },
    does: { kind: 'reduce-damage', amount: { halve: true }, fromAttackOnly: true },
  },
];

const added = (
  who: CharacterId,
  side: string,
  over: Partial<CharacterSheet> = {},
  defenses: Record<string, { readonly resistant?: boolean }> = {},
): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(over),
  maxHp: 200,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side,
  ...(Object.keys(defenses).length === 0 ? {} : { defenses }),
});

const supply = (state: GameState, seed = 'guard') => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: (state.rng === null ? createRng(seed) : restoreRng(state.rng)) as Rng,
  content: SRD_CONTENT,
});

/**
 * A saving throw no target makes, so the fixture is about what the damage came
 * to rather than about whether it landed. Sacred Flame's failure deals its
 * whole 2d8 and its success deals nothing, which is why it is the blow here:
 * an attack roll can show a natural 1 and miss whatever is added to it.
 */
const DOOMED = {
  bonuses: [{ source: 'the test insists', flat: -40 }],
} as const;

const slots = (who: CharacterId): readonly GameEvent[] =>
  [1, 2, 3].map((level) => ({
    type: 'resource-pool-declared',
    id: who,
    pool: { key: `spell-slot:${level}`, label: `level ${level}`, max: 4, recovers: 'long-rest' },
  }));

/**
 * A cleric beside the creature it wards, a priest forty feet off with a Sacred
 * Flame, and a thug with a longsword. `radiantResistant` gives the ward the
 * *defence* of the same name, which is the case the order of application is
 * about.
 */
const field = (options: { radiantResistant?: boolean; blunts?: boolean } = {}): GameEvent[] => [
  added(CLERIC, 'party'),
  added(
    WARD,
    'party',
    options.blunts === true ? { reactions: BLUNTING } : {},
    options.radiantResistant === true ? { radiant: { resistant: true } } : {},
  ),
  added(MAGE, 'foes'),
  added(THUG, 'foes'),
  {
    type: 'spellcasting-declared',
    id: CLERIC,
    spellcasting: declaredCasting({ ability: 'wis', prepared: ['resistance'] }),
  },
  {
    type: 'spellcasting-declared',
    id: MAGE,
    spellcasting: declaredCasting({
      ability: 'wis',
      prepared: ['sacred-flame', 'scorching-ray'],
    }),
  },
  ...slots(CLERIC),
  ...slots(MAGE),
  { type: 'items-gained', id: THUG, items: [{ id: 'longsword', quantity: 1 }], source: 'kit' },
  {
    type: 'item-equipped',
    id: THUG,
    item: 'longsword',
    armor: SRD_CONTENT.item('longsword')?.armor ?? null,
  },
  { type: 'scene-set', extent: { width: 600, depth: 600, height: 40 } },
  { type: 'landmark-added', name: 'the altar', at: { x: 200, y: 200, z: 0 } },
  { type: 'creature-placed', id: CLERIC, placement: { from: { landmark: 'the altar' }, feet: 0 } },
  { type: 'creature-placed', id: WARD, placement: { from: { creature: CLERIC }, feet: 5, bearing: 90 } },
  { type: 'creature-placed', id: MAGE, placement: { from: { creature: CLERIC }, feet: 40, bearing: 180 } },
  { type: 'creature-placed', id: THUG, placement: { from: { creature: WARD }, feet: 5, bearing: 90 } },
  { type: 'sight-declared', from: CLERIC, to: WARD, seen: true },
  { type: 'sight-declared', from: MAGE, to: WARD, seen: true },
  { type: 'sight-declared', from: THUG, to: WARD, seen: true },
  {
    type: 'combat-started',
    combatants: [
      { id: CLERIC, initiative: 30, speed: 30 },
      { id: MAGE, initiative: 25, speed: 30 },
      { id: THUG, initiative: 20, speed: 30 },
      { id: WARD, initiative: 10, speed: 30 },
    ],
  },
];

class Game {
  constructor(readonly events: GameEvent[]) {}

  get state(): GameState {
    return fold('ward', this.events);
  }

  push(more: readonly GameEvent[]): this {
    this.events.push(...more);
    return this;
  }

  /** Resistance, from the cleric onto the ward, against a named type. */
  ward(damageType: string): string {
    const out = unwrap(
      resolveSpell(
        this.state,
        CLERIC,
        { spellId: 'resistance', targets: [WARD], willing: [WARD], damageType },
        supply(this.state),
      ),
      `warding against ${damageType}`,
    );
    this.push(out.events);
    return out.castingId!;
  }

  /** A Sacred Flame the ward cannot save against, and what it lost to it. */
  smite(): { readonly rolled: number; readonly taken: number; readonly events: readonly GameEvent[] } {
    const out = unwrap(
      resolveSpell(
        this.state,
        MAGE,
        { spellId: 'sacred-flame', targets: [WARD] },
        { ...supply(this.state), ...DOOMED },
      ),
      'sacred flame',
    );
    this.push(out.events);
    return { rolled: rawOf(out.events), taken: takenIn(out.events), events: out.events };
  }

  /** Three rays in one action, at one creature, which the mage cannot miss with. */
  rays(): readonly GameEvent[] {
    const out = unwrap(
      resolveSpell(
        this.state,
        MAGE,
        { spellId: 'scorching-ray', targets: [WARD], slotLevel: 2 },
        { ...supply(this.state), bonuses: [{ source: 'the test insists', flat: 40 }] },
      ),
      'scorching ray',
    );
    this.push(out.events);
    return out.events;
  }

  /** The thug's longsword, held open by the ward's own Reaction. */
  swing(): readonly GameEvent[] {
    const out = unwrap(
      resolveAttack(
        this.state,
        THUG,
        { target: WARD, weapon: 'longsword', attackBonuses: [{ source: 'forced', flat: 40 }] },
        supply(this.state),
      ),
      'swing',
    );
    this.push(out.events);
    return out.events;
  }

  turn(): this {
    const out = unwrap(resolveTurn(this.state, supply(this.state)), 'turn');
    return this.push(out.events);
  }

  /** Advance the order until it is this creature's turn to act. */
  until(who: CharacterId): this {
    for (let guard = 0; guard < 12; guard += 1) {
      const combat = this.state.combat;
      if (combat !== null && combat.order[combat.turnIndex]?.id === who) return this;
      this.turn();
    }
    throw new Error(`the order never reached ${who}`);
  }

  reductionsOn(who: CharacterId): readonly { readonly source: string }[] {
    return this.state.creatures[who]?.damageReductions ?? [];
  }
}

/** What the dice showed before anything was taken off. */
const rawOf = (events: readonly GameEvent[]): number => {
  const dice = events.find((e) => e.type === 'damage-dice-recorded');
  return dice === undefined || dice.type !== 'damage-dice-recorded' ? 0 : dice.rolled;
};

/**
 * What a **held** blow came to before anything was taken off. The dealt path
 * writes `damage-dice-recorded` and the held path carries its components
 * inside `damage-rolled`, which is the asymmetry the two readers exist for.
 */
const heldRawOf = (events: readonly GameEvent[]): number => {
  const held = events.find((e) => e.type === 'damage-rolled');
  return held === undefined || held.type !== 'damage-rolled'
    ? 0
    : held.damage.components.reduce((sum, c) => sum + c.total, 0);
};

/** What the creature actually lost. */
const takenIn = (events: readonly GameEvent[]): number =>
  events.reduce((sum, e) => (e.type === 'damage-taken' ? sum + e.amount : sum), 0);

/** The reduction Resistance rolled, or null where it rolled none. */
const reductionIn = (events: readonly GameEvent[]): number | null => {
  const rolled = events.find((e) => e.type === 'roll-recorded' && e.label.startsWith('Resistance'));
  return rolled === undefined || rolled.type !== 'roll-recorded' ? null : rolled.total;
};

describe('SRD Resistance: a d4 off the total, before the defences', () => {
  it('takes a rolled amount off a hit of the type the caster named', () => {
    const game = new Game(field());
    game.ward('radiant');
    game.until(MAGE);

    const blow = game.smite();
    const off = reductionIn(blow.events);

    expect(off).not.toBeNull();
    expect(off!).toBeGreaterThanOrEqual(1);
    expect(off!).toBeLessThanOrEqual(4);
    expect(blow.taken).toBe(blow.rolled - off!);
  });

  /** The faces reach the log, because every die this engine throws does. */
  it('records the die it threw, with the faces on it', () => {
    const game = new Game(field());
    game.ward('radiant');
    game.until(MAGE);
    const blow = game.smite();

    const recorded = blow.events.find(
      (e) => e.type === 'roll-recorded' && e.label.startsWith('Resistance'),
    );
    expect(recorded).toMatchObject({ who: WARD });
    expect(recorded && recorded.type === 'roll-recorded' ? recorded.natural : 0).toBeGreaterThan(0);
  });

  /**
   * SRD "Order of Application": "adjustments such as bonuses, penalties, or
   * multipliers are applied first; Resistance is applied second." Halving
   * first would lose the rounding step and give the wrong number.
   */
  it('comes off before the defence of the same name halves what is left', () => {
    const game = new Game(field({ radiantResistant: true }));
    game.ward('radiant');
    game.until(MAGE);

    const blow = game.smite();
    const off = reductionIn(blow.events);

    expect(off).not.toBeNull();
    expect(blow.taken).toBe(Math.floor((blow.rolled - off!) / 2));
  });

  it('leaves a hit of another type alone', () => {
    const game = new Game(field());
    game.ward('cold');
    game.until(MAGE);

    const blow = game.smite();
    expect(reductionIn(blow.events)).toBeNull();
    expect(blow.taken).toBe(blow.rolled);
  });

  /**
   * "A creature can benefit from this spell only once per turn." Three
   * Scorching Ray rays are three blows inside one action, which is the
   * sharpest form of the question: the ward answers the first and watches the
   * other two.
   */
  it('reduces one blow a turn, however many arrive', () => {
    const game = new Game(field());
    game.ward('fire');
    game.until(MAGE);

    const rays = game.rays();
    const landed = rays.filter((e) => e.type === 'damage-taken');
    expect(landed.length).toBeGreaterThan(1);
    expect(
      rays.filter((e) => e.type === 'roll-recorded' && e.label.startsWith('Resistance')),
    ).toHaveLength(1);
  });

  /** And the next turn it is offered again, because the limit is per turn. */
  it('offers the reduction again on the next turn', () => {
    const game = new Game(field());
    game.ward('fire');
    game.until(MAGE);
    game.rays();

    game.turn();
    game.until(MAGE);
    const again = game.rays();
    expect(
      again.filter((e) => e.type === 'roll-recorded' && e.label.startsWith('Resistance')),
    ).toHaveLength(1);
  });

  /**
   * The held path, which `settleDamage` owns: a Reaction window with a taker
   * means `dealSpellDamage` never runs, and a reduction written only there
   * would be skipped by every blow somebody answered.
   */
  it('reduces a blow held open for a Reaction, beside what the Reaction took', () => {
    const game = new Game(field({ blunts: true }));
    game.ward('slashing');
    game.until(THUG);

    const swing = game.swing();
    const raw = heldRawOf(swing);
    expect(raw).toBeGreaterThan(0);
    // The blow is held rather than dealt: nothing has landed yet.
    expect(takenIn(swing)).toBe(0);

    const answered = unwrap(
      takeDamageReaction(game.state, WARD, { feature: 'test:blunt' }, supply(game.state)),
      'blunting',
    );
    game.push(answered.events);
    const blunted = answered.reduction?.amount ?? 0;
    expect(blunted).toBeGreaterThan(0);

    const settled = unwrap(settleDamage(game.state, supply(game.state)), 'settle');
    game.push(settled.events);

    const off = reductionIn(settled.events);
    expect(off).not.toBeNull();
    expect(settled.amount).toBe(raw - blunted - off!);
  });

  /**
   * **A die thrown is a die counted.** `rollsIssued` is what the next command
   * starts its roll ids from, so a d4 thrown with no `rolls-issued` beside it
   * would have the next roll reusing an id the log already holds. The dealt
   * road is covered by the one event a casting emits for its whole effect
   * loop; the held road has no such loop and emits its own.
   */
  it('counts the die it threw on the held road, so no roll id is reused', () => {
    const game = new Game(field({ blunts: true }));
    game.ward('slashing');
    game.until(THUG);
    game.swing();
    game.push(
      unwrap(
        takeDamageReaction(game.state, WARD, { feature: 'test:blunt' }, supply(game.state)),
        'blunting',
      ).events,
    );

    const before = game.state.rollsIssued;
    const kit = supply(game.state);
    game.push(unwrap(settleDamage(game.state, kit), 'settle').events);
    expect(kit.issuer.count).toBeGreaterThan(0);
    expect(game.state.rollsIssued).toBe(before + kit.issuer.count);
  });

  /**
   * And the same on the road a blow nobody answers takes.
   *
   * **Counted twice rather than not at all**, which is the safe direction and
   * the one `resolveDamage`'s own narrow `rolls-issued` already takes inside a
   * casting's effect loop: five of `dealSpellDamage`'s callers take their
   * generator delta *before* the call, so a ward that trusted the caller would
   * leave `rollsIssued` short and the next command reusing an id the log
   * already holds. A doubled count skips ids and never reuses one, so the
   * claim is the inequality rather than the equality.
   */
  it('counts the die it threw on the dealt road', () => {
    const game = new Game(field());
    game.ward('radiant');
    game.until(MAGE);

    const before = game.state.rollsIssued;
    const kit = { ...supply(game.state), ...DOOMED };
    const out = unwrap(
      resolveSpell(game.state, MAGE, { spellId: 'sacred-flame', targets: [WARD] }, kit),
      'sacred flame',
    );
    game.push(out.events);
    expect(reductionIn(out.events)).not.toBeNull();
    expect(game.state.rollsIssued).toBeGreaterThanOrEqual(before + kit.issuer.count);
  });

  /**
   * The road the ward is most often actually on: a sword, swung at a creature
   * with no Reaction to answer with.
   *
   * `resolveAttack` takes its generator delta **before** `landDamage`, so this
   * is the case a ward counted by its caller would have got wrong — and SRD
   * Resistance prints Slashing among its eleven, so it is reachable rather
   * than hypothetical.
   */
  it('reduces an ordinary weapon hit nobody answers, and counts its die', () => {
    const game = new Game(field());
    game.ward('slashing');
    game.until(THUG);

    const before = game.state.rollsIssued;
    const kit = supply(game.state);
    const out = unwrap(
      resolveAttack(
        game.state,
        THUG,
        { target: WARD, weapon: 'longsword', attackBonuses: [{ source: 'forced', flat: 40 }] },
        kit,
      ),
      'swing',
    );
    game.push(out.events);

    const off = reductionIn(out.events);
    expect(off).not.toBeNull();
    expect(rawOf(out.events) - off!).toBe(takenIn(out.events));
    expect(game.state.rollsIssued).toBeGreaterThanOrEqual(before + kit.issuer.count);
  });

  it('gives the grant back when the casting ends', () => {
    const game = new Game(field());
    game.ward('radiant');
    expect(game.reductionsOn(WARD)).toHaveLength(1);

    game.push(unwrap(endConcentration(game.state, CLERIC, 'voluntary'), 'letting go'));
    expect(game.reductionsOn(WARD)).toHaveLength(0);

    game.until(MAGE);
    const blow = game.smite();
    expect(reductionIn(blow.events)).toBeNull();
  });

  /**
   * "choose a damage type: Acid, Bludgeoning, Cold, …" — stated or refused,
   * never defaulted, which is the rule Spirit Guardians and Protection from
   * Energy already keep.
   */
  it('refuses a casting that names no damage type', () => {
    const game = new Game(field());
    const out = resolveSpell(
      game.state,
      CLERIC,
      { spellId: 'resistance', targets: [WARD], willing: [WARD] },
      supply(game.state),
    );
    expect(isErr(out) && out.code).toBe('damage_type_required');
  });

  it('refuses a type the spell does not print', () => {
    const game = new Game(field());
    const out = resolveSpell(
      game.state,
      CLERIC,
      { spellId: 'resistance', targets: [WARD], willing: [WARD], damageType: 'force' },
      supply(game.state),
    );
    expect(isErr(out)).toBe(true);
  });
});
