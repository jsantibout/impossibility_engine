import { describe, expect, it } from 'vitest';
import { MAGIC_CIRCLE, SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, isErr, type CharacterId, type Result } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, restoreRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { declaredCasting } from './spellcasting.js';
import { checkSpellDefinitionValue } from './spell-schema.js';
import { durationSecondsAt } from './spell-definitions.js';
import { remaining } from './resources.js';
import { lift } from './commands/spell-effect-movement.js';
import {
  addCreature,
  applyConditionTo,
  relocateCreature,
  resolveAttack,
  resolveDeclaredCast,
  resolveMove,
  resolveSpell,
  resolveTurn,
  takePrintedTeleport,
} from './commands.js';

/**
 * SRD Magic Circle, whole.
 *
 * > "You create a 10-foot-radius, 20-foot-tall Cylinder of magical energy
 * > centered on a point on the ground that you can see within range. … Choose
 * > one or more of the following types of creatures: Celestials, Elementals,
 * > Fey, Fiends, or Undead. The circle affects a creature of the chosen type in
 * > the following ways: The creature can't willingly enter the Cylinder by
 * > nonmagical means. If the creature tries to use teleportation or
 * > interplanar travel to do so, it must first succeed on a Charisma saving
 * > throw. The creature has Disadvantage on attack rolls against targets within
 * > the Cylinder. Targets within the Cylinder can't be possessed by or gain the
 * > Charmed or Frightened condition from the creature. Each time you cast this
 * > spell, you can cause its magic to operate in the reverse direction,
 * > preventing a creature of the specified type from leaving the Cylinder and
 * > protecting targets outside it."
 *
 * The types are **stated** at the casting — `CastSpellRequest.types`, a list
 * because the book says "one or more" — and substituted into the clauses the
 * record pins, so the fold reads a list and never the word "stated". The
 * reverse is an `options` pair: `inward` bars entering and protects inside,
 * `outward` bars leaving and protects outside.
 */

const id = (s: string) => asCharacterId(s);
const CLERIC = id('cleric');
const FIEND = id('fiend');
const BANDIT = id('bandit');

const sheet = (): CharacterSheet => ({
  level: 9,
  abilities: { str: 16, dex: 14, con: 12, int: 10, wis: 18, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'wis',
  weaponProficiencies: ['simple', 'martial'],
});

const added = (who: CharacterId, side: string, creatureType: string): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 400,
  diesAtZero: false,
  creatureType,
  side,
});

const slots = (who: CharacterId): readonly GameEvent[] =>
  [1, 2, 3].map((level) => ({
    type: 'resource-pool-declared',
    id: who,
    pool: { key: `spell-slot:${level}`, label: `level ${level}`, max: 4, recovers: 'long-rest' },
  }));

const LANDMARKS = {
  'the altar': { x: 200, y: 200, z: 0 },
  'inside east': { x: 205, y: 200, z: 0 },
  'inside west': { x: 195, y: 200, z: 0 },
  'outside east': { x: 215, y: 200, z: 0 },
  'outside west': { x: 185, y: 200, z: 0 },
} as const;
type Landmark = keyof typeof LANDMARKS;

/** The fiend starts where the scenario needs it: outside for the ward, inside for the reverse. */
const field = (fiendAt: Landmark): readonly GameEvent[] => [
  added(CLERIC, 'party', 'Humanoid'),
  added(FIEND, 'foes', 'Fiend'),
  added(BANDIT, 'foes', 'Humanoid'),
  {
    type: 'spellcasting-declared',
    id: CLERIC,
    spellcasting: declaredCasting({
      ability: 'wis',
      classId: 'cleric',
      prepared: ['magic-circle', 'bless'],
    }),
  },
  {
    type: 'spellcasting-declared',
    id: FIEND,
    spellcasting: declaredCasting({ ability: 'cha', classId: 'warlock', prepared: ['misty-step'] }),
  },
  ...slots(CLERIC),
  ...slots(FIEND),
  ...[FIEND, BANDIT].flatMap((who): readonly GameEvent[] => [
    { type: 'items-gained', id: who, items: [{ id: 'longbow', quantity: 1 }], source: 'kit' },
    { type: 'item-equipped', id: who, item: 'longbow', armor: null },
  ]),
  { type: 'scene-set', extent: { width: 600, depth: 600, height: 40 } },
  ...Object.entries(LANDMARKS).map(
    ([name, at]): GameEvent => ({ type: 'landmark-added', name, at }),
  ),
  { type: 'creature-placed', id: CLERIC, placement: { from: { landmark: 'the altar' }, feet: 0 } },
  { type: 'creature-placed', id: FIEND, placement: { from: { landmark: fiendAt }, feet: 0 } },
  {
    type: 'creature-placed',
    id: BANDIT,
    placement: { from: { landmark: 'outside west' }, feet: 0 },
  },
  ...[FIEND, BANDIT].flatMap((who): readonly GameEvent[] => [
    { type: 'sight-declared', from: CLERIC, to: who, seen: true },
    { type: 'sight-declared', from: who, to: CLERIC, seen: true },
  ]),
];

const supply = (state: GameState, flat?: number) => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: (state.rng === null ? createRng('circle') : restoreRng(state.rng)) as Rng,
  ...(flat === undefined ? {} : { bonuses: [{ source: 'the test insists', flat }] }),
  content: SRD_CONTENT,
});

const codeOf = (result: Result<unknown>): string | null => (isErr(result) ? result.code : null);

class Game {
  readonly events: GameEvent[];
  castingId = '';

  constructor(fiendAt: Landmark = 'outside east') {
    this.events = [...field(fiendAt)];
  }

  get state(): GameState {
    return fold('circle', this.events);
  }

  push(more: readonly GameEvent[]): this {
    this.events.push(...more);
    return this;
  }

  /** The circle: declared, a minute on the clock, settled. */
  draw(
    option: 'inward' | 'outward' = 'inward',
    types: readonly string[] = ['Fiend'],
    slotLevel?: number,
  ): this {
    const declared = unwrap(
      resolveSpell(
        this.state,
        CLERIC,
        {
          spellId: 'magic-circle',
          targets: [],
          at: LANDMARKS['the altar'],
          types,
          option,
          ...(slotLevel === undefined ? {} : { slotLevel }),
        },
        supply(this.state),
      ),
      'declare magic circle',
    );
    this.push(declared.events);
    this.push([{ type: 'time-advanced', seconds: 60, reason: 'the rite' }]);
    const settled = unwrap(
      resolveDeclaredCast(this.state, declared.castingId!, supply(this.state)),
      'settle magic circle',
    );
    this.push(settled.events);
    this.castingId = declared.castingId!;
    return this;
  }

  move(who: CharacterId, to: Landmark) {
    return resolveMove(
      this.state,
      who,
      { placement: { from: { landmark: to }, feet: 0 } },
      supply(this.state),
    );
  }

  /** The fiend's Misty Step to a space inside, with the save the test insists on. */
  mistyStep(to: Landmark, flat: number) {
    return resolveSpell(
      this.state,
      FIEND,
      {
        spellId: 'misty-step',
        targets: [FIEND],
        teleportTo: { from: { landmark: to }, feet: 0 },
        slotLevel: 2,
      },
      supply(this.state, flat),
    );
  }

  fight(): this {
    return this.push([
      {
        type: 'combat-started',
        combatants: [
          { id: CLERIC, initiative: 20, speed: 30 },
          { id: FIEND, initiative: 15, speed: 30 },
          { id: BANDIT, initiative: 10, speed: 30 },
        ],
      },
    ]);
  }

  until(who: CharacterId): this {
    for (let guard = 0; guard < 12; guard += 1) {
      const combat = this.state.combat;
      if (combat !== null && combat.order[combat.turnIndex]?.id === who) return this;
      this.push(unwrap(resolveTurn(this.state, supply(this.state)), 'turn').events);
    }
    throw new Error(`the order never reached ${who}`);
  }

  /** A longbow shot at the cleric, and the mode it came out under. */
  shoot(who: CharacterId): string {
    this.until(who);
    const out = unwrap(
      resolveAttack(this.state, who, { target: CLERIC, weapon: 'longbow' }, supply(this.state)),
      `${who} shoots`,
    );
    this.push(out.events);
    return out.attack!.roll.mode;
  }

  frighten(by: CharacterId): string | null {
    const out = applyConditionTo(
      this.state,
      CLERIC,
      'frightened',
      `ruling:${by}`,
      [],
      undefined,
      undefined,
      { commandId: `frighten:${by}` },
      undefined,
      undefined,
      undefined,
      by,
    );
    if (!out.ok) return out.code;
    this.push(out.value);
    return null;
  }
}

describe('SRD Magic Circle: the definition', () => {
  it('validates: a Cylinder, stated types, and the two directions as a pair of branches', () => {
    const circle = SRD_CONTENT.spell('magic-circle')!;
    expect(checkSpellDefinitionValue(circle)).toEqual([]);
    expect(circle.area).toEqual({ kind: 'cylinder', radius: 10, height: 20, origin: 'point' });
    expect(circle.typesStated?.options).toEqual(['Celestial', 'Elemental', 'Fey', 'Fiend', 'Undead']);
    expect(Object.keys(circle.options ?? {}).sort()).toEqual(['inward', 'outward']);
  });
});

describe('SRD Magic Circle: "Choose one or more of the following types"', () => {
  it('refuses a casting that states no type, and one that states a type the spell does not print', () => {
    const game = new Game();
    const none = resolveSpell(
      game.state,
      CLERIC,
      { spellId: 'magic-circle', targets: [], at: LANDMARKS['the altar'], option: 'inward' },
      supply(game.state),
    );
    expect(codeOf(none)).toBe('types_required');
    const wrong = resolveSpell(
      game.state,
      CLERIC,
      {
        spellId: 'magic-circle',
        targets: [],
        at: LANDMARKS['the altar'],
        option: 'inward',
        types: ['Humanoid'],
      },
      supply(game.state),
    );
    expect(codeOf(wrong)).toBe('type_not_offered');
  });

  it('refuses a type list on a spell that prints no such clause', () => {
    const game = new Game();
    const bless = resolveSpell(
      game.state,
      CLERIC,
      { spellId: 'bless', targets: [CLERIC], types: ['Fiend'] },
      supply(game.state),
    );
    expect(codeOf(bless)).toBe('no_types_clause');
  });

  it('pins the stated types into every clause the record carries, so the fold never reads "stated"', () => {
    const game = new Game().draw('inward', ['Fiend', 'Undead']);
    const record = game.state.ongoing[game.castingId];
    expect(record?.types).toEqual(['Fiend', 'Undead']);
    expect(JSON.stringify(record?.areaStanding)).not.toContain('stated');
    for (const clause of record?.areaStanding ?? []) {
      if (clause.kind === 'bars-passage') expect(clause.to).toEqual({ types: ['Fiend', 'Undead'] });
      if (clause.kind === 'attack-mode') expect(clause.attackerType).toEqual(['Fiend', 'Undead']);
      if (clause.kind === 'condition-immunity') expect(clause.fromTypes).toEqual(['Fiend', 'Undead']);
    }
  });
});

describe('SRD Magic Circle: "can’t willingly enter the Cylinder by nonmagical means"', () => {
  it('refuses the Fiend a step into the circle and lets the Humanoid in', () => {
    const game = new Game().draw();
    expect(codeOf(game.move(FIEND, 'inside east'))).toBe('barred');
    expect(game.move(BANDIT, 'inside west').ok).toBe(true);
  });

  it('refuses a bare relocation into the circle too, naming the save the spell’s own road rolls', () => {
    const game = new Game().draw();
    const dropped = relocateCreature(game.state, FIEND, {
      placement: { from: { landmark: 'inside east' }, feet: 0 },
    });
    expect(codeOf(dropped)).toBe('barred');
  });
});

describe('SRD Magic Circle: "it must first succeed on a Charisma saving throw"', () => {
  it('rolls the save on a Misty Step in, and leaves the Fiend where it was on a failure', () => {
    const game = new Game().draw();
    const out = unwrap(game.mistyStep('inside east', -40), 'misty step, failing');
    const save = out.events.find(
      (e) => e.type === 'roll-recorded' && e.label === 'Charisma save vs Magic Circle',
    );
    expect(save).toBeDefined();
    game.push(out.events);
    expect(game.state.scene?.positions[FIEND]).toEqual(LANDMARKS['outside east']);
    // The slot went: the book says the creature "must first succeed", and a
    // failed attempt is a casting made.
    expect(remaining(game.state.creatures[FIEND]!.resources, 'spell-slot:2')).toBe(3);
  });

  it('lets the Fiend through on a success', () => {
    const game = new Game().draw();
    const out = unwrap(game.mistyStep('inside east', 40), 'misty step, succeeding');
    game.push(out.events);
    expect(game.state.scene?.positions[FIEND]).toEqual(LANDMARKS['inside east']);
  });
});

describe('SRD Magic Circle: "Disadvantage on attack rolls against targets within the Cylinder"', () => {
  it('gives the Fiend’s shot Disadvantage and leaves the Humanoid’s alone', () => {
    const game = new Game().draw().fight();
    expect(game.shoot(FIEND)).toBe('disadvantage');
    expect(game.shoot(BANDIT)).toBe('normal');
  });
});

describe('SRD Magic Circle: "can’t … gain the Charmed or Frightened condition from the creature"', () => {
  it('refuses the Fiend’s Frightened on the cleric inside, and lets the Humanoid’s land', () => {
    const game = new Game().draw();
    expect(game.frighten(FIEND)).toBe('immune');
    expect(game.frighten(BANDIT)).toBeNull();
  });
});

describe('SRD Magic Circle: "cause its magic to operate in the reverse direction"', () => {
  it('cast outward, holds the Fiend inside and lets the Humanoid walk out', () => {
    const game = new Game('inside east').draw('outward');
    expect(codeOf(game.move(FIEND, 'outside east'))).toBe('barred');
    // A step that stays inside is not a crossing.
    expect(game.move(FIEND, 'inside west').ok).toBe(true);
    // And the Humanoid, who walks in and out as it pleases.
    expect(game.move(BANDIT, 'inside west').ok).toBe(true);
  });

  it('cast outward, lets the Fiend in: the reverse bars leaving, not entering', () => {
    const game = new Game().draw('outward');
    expect(game.move(FIEND, 'inside east').ok).toBe(true);
  });

  /**
   * "protecting targets outside it": the two clauses the reverse turns round
   * reach the cleric standing **outside** the Cylinder — see `AreaSide` — and
   * the Humanoid's swing and Frightened are untouched by either.
   */
  it('cast outward, protects the cleric outside from the Fiend held inside', () => {
    const game = new Game('inside east').draw('outward');
    // The cleric is put outside her own circle — ten feet beyond the bandit,
    // so his shot is not one SRD gives Disadvantage for an enemy at his elbow,
    // and well clear of the Cylinder — by the authoritative position change a
    // walk and a teleport both write, so no Opportunity Attack from the Fiend
    // holds the step open. It cannot follow.
    game.push([
      {
        type: 'creature-moved',
        id: CLERIC,
        placement: { from: { creature: BANDIT }, feet: 10, bearing: 270 },
      },
    ]);
    expect(game.state.scene?.positions[CLERIC]).toEqual({ x: 175, y: 200, z: 0 });
    expect(game.frighten(FIEND)).toBe('immune');
    expect(game.frighten(BANDIT)).toBeNull();
    game.fight();
    expect(game.shoot(FIEND)).toBe('disadvantage');
    expect(game.shoot(BANDIT)).toBe('normal');
  });

  /**
   * **And it protects them from the creature it is holding, and from no
   * other.** `outside` on its own said half the sentence: a reversed circle
   * handed its two clauses to everybody standing outside, so a *second* Fiend
   * out on the road had Disadvantage attacking a cleric on the far side of the
   * field and could Frighten nobody out there — a protection the spell does not
   * grant, from a circle the imp had never been near.
   *
   * The whole sentence is "preventing a creature of the specified type from
   * **leaving** the Cylinder and protecting targets outside it": the creature
   * it is about is the one penned in. `AreaSide.attackerInside` is the other
   * end of the pair, and the imp is what it is for.
   */
  it('cast outward, leaves a Fiend that is not in the circle out of it entirely', () => {
    const IMP = id('imp');
    const game = new Game('inside east').draw('outward');
    game.push([
      added(IMP, 'foes', 'Fiend'),
      { type: 'items-gained', id: IMP, items: [{ id: 'longbow', quantity: 1 }], source: 'kit' },
      { type: 'item-equipped', id: IMP, item: 'longbow', armor: null },
      // Fifty feet off across the field: outside the Cylinder, and far enough
      // from the cleric that a longbow is not at close quarters.
      { type: 'landmark-added', name: 'the far hedge', at: { x: 150, y: 250, z: 0 } },
      {
        type: 'creature-placed',
        id: IMP,
        placement: { from: { landmark: 'the far hedge' }, feet: 0 },
      },
      { type: 'sight-declared', from: IMP, to: CLERIC, seen: true },
      { type: 'sight-declared', from: CLERIC, to: IMP, seen: true },
    ]);
    // The cleric outside her own circle, exactly as the test above puts her.
    game.push([
      {
        type: 'creature-moved',
        id: CLERIC,
        placement: { from: { creature: BANDIT }, feet: 10, bearing: 270 },
      },
    ]);

    // The Fiend the circle is holding is refused; the one across the field is
    // not, and neither is the Humanoid.
    expect(game.frighten(FIEND)).toBe('immune');
    expect(game.frighten(IMP)).toBeNull();

    game.push([
      {
        type: 'combat-started',
        combatants: [
          { id: CLERIC, initiative: 20, speed: 30 },
          { id: FIEND, initiative: 15, speed: 30 },
          { id: IMP, initiative: 12, speed: 30 },
          { id: BANDIT, initiative: 10, speed: 30 },
        ],
      },
    ]);
    expect(game.shoot(FIEND)).toBe('disadvantage');
    expect(game.shoot(IMP)).toBe('normal');
  });
});

/**
 * A lift that would carry a creature out through the roof of a circle drawn to
 * keep it in.
 *
 * `shoveAwayFrom`'s question on the one axis a bearing cannot name. A reversed
 * circle bars a Fiend from **leaving** a Cylinder that is twenty feet tall, and
 * a Levitate raising it thirty feet would have taken it out through the top —
 * the same walk-through-a-wall a Thunderwave used to make, standing up.
 *
 * Forced movement reports rather than refuses, so the rise stops under the roof
 * and the casting's `unverified` says which wall it is against.
 */
describe('SRD Magic Circle: a lift that would carry the Fiend out of the top', () => {
  it('stops the rise under the roof and names the circle', () => {
    const game = new Game('inside east').draw('outward');
    const out = lift(game.state, FIEND, { feet: 30 }, 'Levitate#cast:3', 'Levitate');
    expect(out.events).toHaveLength(2);
    const moved = out.events[0];
    expect(moved).toMatchObject({ type: 'creature-moved', id: FIEND, forced: true });
    // Fifteen feet: the last space whose whole volume is still under a
    // twenty-foot ceiling, which is the same reading `moverInRegionAt` gives a
    // creature with one corner in a dome.
    expect(moved?.type === 'creature-moved' ? moved.placement.elevation : null).toBe(15);
    expect(out.unverified.join(' ')).toContain('Magic Circle');
    expect(out.unverified.join(' ')).toContain('comes to rest against it after 15 feet');
  });

  /** And the cleric outside it rises the whole way: the circle bars her nothing. */
  it('lifts the creature the circle says nothing about all the way', () => {
    const game = new Game('inside east').draw('outward');
    const out = lift(game.state, CLERIC, { feet: 30 }, 'Levitate#cast:4', 'Levitate');
    expect(out.unverified).toEqual([]);
    const moved = out.events[0];
    expect(moved?.type === 'creature-moved' ? moved.placement.elevation : null).toBe(30);
  });
});

describe('SRD Magic Circle: a printed Teleport is a teleport too', () => {
  /**
   * SRD Blink Dog is Fey, and its Teleport is a Bonus Action a stat block
   * prints. `takePrintedTeleport` holds no dice, so a crossing the circle
   * demands a Charisma save for is refused there — as `relocateCreature`
   * refuses it — rather than performed with the save skipped.
   */
  it('refuses a Blink Dog’s printed Teleport into a circle drawn against Fey', () => {
    const DOG = id('dog');
    const game = new Game();
    game.push(unwrap(addCreature(game.state, SRD_CONTENT, DOG, 'blink-dog'), 'the dog').events);
    game.push([
      { type: 'creature-placed', id: DOG, placement: { from: { landmark: 'outside east' }, feet: 5, bearing: 90 } },
    ]);
    game.draw('inward', ['Fey']);
    game.push([
      {
        type: 'combat-started',
        combatants: [
          { id: DOG, initiative: 20, speed: 40 },
          { id: CLERIC, initiative: 10, speed: 30 },
        ],
      },
    ]);
    const blink = SRD_CONTENT.monsterById('blink-dog')!.bonusActions[0]!.name;
    const refused = takePrintedTeleport(game.state, DOG, {
      line: blink,
      to: { from: { landmark: 'inside east' }, feet: 0 },
    });
    expect(codeOf(refused)).toBe('barred');
    // And a space outside the circle is still the dog's to blink to.
    expect(
      takePrintedTeleport(game.state, DOG, {
        line: blink,
        to: { from: { landmark: 'outside west' }, feet: 0 },
      }).ok,
    ).toBe(true);
  });
});

/**
 * SRD Magic Circle, _Using a Higher-Level Spell Slot_: "The duration increases
 * by 1 hour for each spell slot level above 3."
 *
 * A table of seconds per band, which is what `durationAtSlot` is — six keys for
 * the six slots above this level 3 spell, an hour apart. The mechanism was
 * already there and the definition simply had not written the table, so this is
 * a clause read off the book rather than a shape built for it.
 */
describe('SRD Magic Circle: an hour for each slot above the third', () => {
  it('runs an hour at level 3 and three at level 5', () => {
    expect(durationSecondsAt(MAGIC_CIRCLE, 3)).toBe(3600);
    expect(durationSecondsAt(MAGIC_CIRCLE, 4)).toBe(7200);
    expect(durationSecondsAt(MAGIC_CIRCLE, 5)).toBe(10800);
    expect(durationSecondsAt(MAGIC_CIRCLE, 9)).toBe(25200);
  });

  /** And the deadline the casting hangs is the band's, not the printed hour. */
  it('hangs a three-hour deadline on a circle drawn from a level 5 slot', () => {
    const game = new Game();
    game.push([
      {
        type: 'resource-pool-declared',
        id: CLERIC,
        pool: { key: 'spell-slot:5', label: 'level 5', max: 1, recovers: 'long-rest' },
      },
    ]);
    game.draw('inward', ['Fiend'], 5);
    const timer = Object.values(game.state.timers).find(
      (effect) => effect.target.kind === 'casting' && effect.target.castingId === game.castingId,
    );
    // The minute of casting is already on the clock when the deadline is hung.
    expect(timer?.deadline).toEqual({ kind: 'elapsed', at: 60 + 10800 });
  });
});
