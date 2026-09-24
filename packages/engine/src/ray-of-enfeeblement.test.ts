import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { SKILL_ABILITY, asCharacterId, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, restoreRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { declaredCasting } from './spellcasting.js';
import { parseSpellDefinition } from './spell-schema.js';
import { rollSelectorProblems, selectorMatches, type RollSelector } from './roll-modifiers.js';
import {
  endConcentration,
  resolveAttack,
  resolveSpell,
  resolveTest,
  resolveTurn,
  type TurnResolution,
} from './commands.js';

/**
 * SRD Ray of Enfeeblement, whole:
 *
 * > "A beam of enervating energy shoots from you toward a creature within
 * > range. The target must make a Constitution saving throw. On a successful
 * > save, the target has Disadvantage on the next attack roll it makes until
 * > the start of your next turn.
 * >
 * > On a failed save, the target has Disadvantage on Strength-based D20 Tests
 * > for the duration. During that time, it also subtracts 1d8 from all its
 * > damage rolls. The target repeats the save at the end of each of its turns,
 * > ending the spell on a success."
 *
 * Three shapes in one spell and each of them a named gap:
 * `a-selector-for-every-d20-test`, `a-damage-penalty-a-spell-grants` and
 * `a-success-branch-that-does-something`. A fourth arrived with them and had
 * no name of its own: a repeat save on a failure that imposes **no
 * condition**, which has no condition instance to be filed on and rides the
 * casting's own deadline exactly as SRD Searing Smite's does.
 */

const id = (s: string) => asCharacterId(s);
const WIZARD = id('wizard');
const GOBLIN = id('goblin');

const problems = (selector: RollSelector): readonly string[] =>
  rollSelectorProblems(selector, (skill) => SKILL_ABILITY[skill]).map((one) => one.code);

const sheet = (): CharacterSheet => ({
  level: 9,
  abilities: { str: 16, dex: 14, con: 12, int: 18, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
  weaponProficiencies: ['simple', 'martial'],
});

const added = (who: CharacterId, side: string): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 400,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side,
});

const slots = (who: CharacterId): readonly GameEvent[] =>
  [1, 2, 3].map((level) => ({
    type: 'resource-pool-declared',
    id: who,
    pool: { key: `spell-slot:${level}`, label: `level ${level}`, max: 4, recovers: 'long-rest' },
  }));

/**
 * A wizard with the beam, and a goblin with a longsword, a rapier and a cantrip.
 *
 * **The rapier is the Dexterity half of the sentence rather than a second
 * creature.** A Finesse weapon swung with Dexterity is not a Strength attack
 * roll, which is what `RollQuery.ability` carries and the whole of what a
 * narrowed selector has to read; two weapons would have tested the catalogue
 * instead. And the goblin casts as well as swings, because "all its damage
 * rolls" is not only the sword.
 */
const FIELD: readonly GameEvent[] = [
  added(WIZARD, 'party'),
  added(GOBLIN, 'foes'),
  {
    type: 'spellcasting-declared',
    id: WIZARD,
    spellcasting: declaredCasting({
      ability: 'int',
      classId: 'wizard',
      prepared: ['ray-of-enfeeblement'],
    }),
  },
  {
    type: 'spellcasting-declared',
    id: GOBLIN,
    spellcasting: declaredCasting({ ability: 'int', cantrips: ['fire-bolt'] }),
  },
  ...slots(WIZARD),
  {
    type: 'items-gained',
    id: GOBLIN,
    items: [
      { id: 'longsword', quantity: 1 },
      { id: 'rapier', quantity: 1 },
    ],
    source: 'kit',
  },
  { type: 'item-equipped', id: GOBLIN, item: 'longsword', armor: null },
  { type: 'item-equipped', id: GOBLIN, item: 'rapier', armor: null },
  { type: 'scene-set', extent: { width: 600, depth: 600, height: 40 } },
  { type: 'landmark-added', name: 'the door', at: { x: 200, y: 200, z: 0 } },
  { type: 'creature-placed', id: WIZARD, placement: { from: { landmark: 'the door' }, feet: 0 } },
  {
    type: 'creature-placed',
    id: GOBLIN,
    placement: { from: { creature: WIZARD }, feet: 5, bearing: 90 },
  },
  { type: 'sight-declared', from: WIZARD, to: GOBLIN, seen: true },
  { type: 'sight-declared', from: GOBLIN, to: WIZARD, seen: true },
  {
    type: 'combat-started',
    combatants: [
      { id: WIZARD, initiative: 20, speed: 30 },
      { id: GOBLIN, initiative: 5, speed: 30 },
    ],
  },
];

const supply = (state: GameState, flat?: number) => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: (state.rng === null ? createRng('beam') : restoreRng(state.rng)) as Rng,
  ...(flat === undefined ? {} : { bonuses: [{ source: 'the test insists', flat }] }),
  content: SRD_CONTENT,
});

/** A save nobody could make, and one nobody could miss. */
const DOOMED = -40;
const SPARED = 40;

class Game {
  readonly events: GameEvent[] = [...FIELD];

  get state(): GameState {
    return fold('beam', this.events);
  }

  push(more: readonly GameEvent[]): this {
    this.events.push(...more);
    return this;
  }

  /** The beam, at a save the goblin is made to fail or made to make. */
  beam(flat: number): this {
    const out = unwrap(
      resolveSpell(
        this.state,
        WIZARD,
        { spellId: 'ray-of-enfeeblement', targets: [GOBLIN] },
        supply(this.state, flat),
      ),
      'ray of enfeeblement',
    );
    return this.push(out.events);
  }

  /** A D20 Test the goblin makes, and the mode it came out under. */
  test(kind: 'ability-check' | 'saving-throw', ability: 'str' | 'dex' | 'wis'): string {
    const out = unwrap(
      resolveTest(
        this.state,
        GOBLIN,
        { kind, ability, dc: 10, commandId: `${kind}:${ability}:${this.events.length}` },
        supply(this.state),
      ),
      `${ability} ${kind}`,
    );
    this.push(out.events);
    return out.test!.roll.mode;
  }

  /** A swing the goblin cannot miss with, and everything it wrote. */
  swing(
    weapon: string,
    finesseAbility?: 'str' | 'dex',
  ): { readonly mode: string; readonly events: readonly GameEvent[] } {
    const out = unwrap(
      resolveAttack(
        this.state,
        GOBLIN,
        {
          target: WIZARD,
          weapon,
          ...(finesseAbility === undefined ? {} : { finesseAbility }),
          attackBonuses: [{ source: 'the test insists', flat: 40 }],
        },
        supply(this.state),
      ),
      `swing with ${weapon}`,
    );
    this.push(out.events);
    return { mode: out.attack!.roll.mode, events: out.events };
  }

  /** The goblin's own Fire Bolt, which is a damage roll like any other. */
  bolt(): readonly GameEvent[] {
    const out = unwrap(
      resolveSpell(
        this.state,
        GOBLIN,
        { spellId: 'fire-bolt', targets: [WIZARD] },
        { ...supply(this.state), bonuses: [{ source: 'the test insists', flat: 40 }] },
      ),
      'fire bolt',
    );
    this.push(out.events);
    return out.events;
  }

  /**
   * One turn boundary, at whatever the repeat save is made to come out as.
   *
   * `resolveTurn` raises the debts the boundary owes **and settles them**, so
   * the repeat save the casting's timer carries is rolled here rather than by
   * a second command.
   */
  turn(flat?: number): TurnResolution {
    const out = unwrap(resolveTurn(this.state, supply(this.state, flat)), 'turn');
    this.push(out.events);
    return out;
  }

  /** Advance the order until it is this creature's turn to act. */
  until(who: CharacterId, flat?: number): this {
    for (let guard = 0; guard < 8; guard += 1) {
      const combat = this.state.combat;
      if (combat !== null && combat.order[combat.turnIndex]?.id === who) return this;
      this.turn(flat);
    }
    throw new Error(`the order never reached ${who}`);
  }

  modesOn(who: CharacterId): readonly string[] {
    return (this.state.creatures[who]?.rollModifiers ?? []).map((held) => held.modifier.mode);
  }

  penaltiesOn(who: CharacterId): readonly { readonly source: string }[] {
    return this.state.creatures[who]?.damagePenalties ?? [];
  }
}

/** What the dice showed before anything was taken off. */
const rawOf = (events: readonly GameEvent[]): number => {
  const dice = events.find((e) => e.type === 'damage-dice-recorded');
  return dice?.type === 'damage-dice-recorded' ? dice.rolled : 0;
};

/** What the target actually lost. */
const takenIn = (events: readonly GameEvent[]): number => {
  const taken = events.find((e) => e.type === 'damage-taken');
  return taken?.type === 'damage-taken' ? taken.amount : 0;
};

/** What a penalty's line says actually came off the blow. */
const subtracted = (line: { readonly outcome?: string }): number =>
  Number((line.outcome ?? '').split(' ')[0]);

/** The line the penalty writes in the log, if it wrote one. */
const penaltyLine = (events: readonly GameEvent[]) => {
  const line = events.find(
    (e) => e.type === 'roll-recorded' && (e.outcome ?? '').endsWith('subtracted from the damage'),
  );
  return line?.type === 'roll-recorded' ? line : undefined;
};

/** A definition the validator is asked to judge, with one field varied. */
const written = (effect: Record<string, unknown>) =>
  parseSpellDefinition({
    id: 'homebrew-beam',
    name: 'Homebrew Beam',
    level: 2,
    school: 'necromancy',
    castingTime: 'action',
    concentration: true,
    range: { kind: 'ranged', feet: 60 },
    targets: { count: 1 },
    durationSeconds: 60,
    effects: [effect],
  });

/**
 * The same, on a casting that is over the moment it resolves.
 *
 * What the lifetime rule is asked about: a grant hung by a casting with no
 * duration and no Concentration has nothing that could ever lift it.
 */
const writtenInstantaneous = (effect: Record<string, unknown>) =>
  parseSpellDefinition({
    id: 'homebrew-flash',
    name: 'Homebrew Flash',
    level: 2,
    school: 'necromancy',
    castingTime: 'action',
    concentration: false,
    range: { kind: 'ranged', feet: 60 },
    targets: { count: 1 },
    effects: [effect],
  });

describe('a family of D20 Tests, picked out by the ability behind them', () => {
  const strengthTests: RollSelector = { roll: 'd20-test', relation: 'roller', ability: 'str' };

  it('reaches a Strength attack roll, a Strength check and a Strength save', () => {
    expect(problems(strengthTests)).toEqual([]);
    for (const family of ['attack', 'ability-check', 'saving-throw'] as const) {
      expect(
        selectorMatches(strengthTests, GOBLIN, {
          family,
          roller: GOBLIN,
          ability: 'str',
          ...(family === 'attack' ? { against: WIZARD } : {}),
        }),
      ).toBe(true);
    }
  });

  it('reaches no roll made with another ability, whichever family it is', () => {
    for (const family of ['attack', 'ability-check', 'saving-throw'] as const) {
      expect(
        selectorMatches(strengthTests, GOBLIN, {
          family,
          roller: GOBLIN,
          ability: 'dex',
          ...(family === 'attack' ? { against: WIZARD } : {}),
        }),
      ).toBe(false);
    }
  });

  it('reaches neither Initiative nor a death save, which name no ability', () => {
    for (const family of ['initiative', 'death-save'] as const) {
      expect(selectorMatches(strengthTests, GOBLIN, { family, roller: GOBLIN })).toBe(false);
    }
  });

  it('is refused at authoring without an ability, because no spell in reach prints the bare phrase', () => {
    expect(problems({ roll: 'd20-test', relation: 'roller' })).toEqual([
      'd20_test_without_an_ability',
    ]);
  });

  it('keeps every narrowing the single families refuse, because it is not one of them', () => {
    expect(problems({ roll: 'd20-test', relation: 'against-holder', ability: 'str' })).toContain(
      'against_holder_without_target',
    );
    expect(
      problems({ roll: 'd20-test', relation: 'roller', ability: 'str', skill: 'athletics' }),
    ).toContain('skill_off_ability_check');
    expect(
      problems({ roll: 'd20-test', relation: 'roller', ability: 'str', condition: 'grappled' }),
    ).toContain('condition_off_a_saving_throw');
    expect(
      problems({ roll: 'd20-test', relation: 'roller', ability: 'str', counterpart: WIZARD }),
    ).toContain('counterpart_without_target');
  });
});

describe('what a failed save costs, through the public API', () => {
  it('puts Disadvantage on a Strength check and a Strength save and on no other test', () => {
    const game = new Game().beam(DOOMED);

    expect(game.test('ability-check', 'str')).toBe('disadvantage');
    expect(game.test('saving-throw', 'str')).toBe('disadvantage');
    expect(game.test('saving-throw', 'wis')).toBe('normal');
    expect(game.test('ability-check', 'dex')).toBe('normal');
  });

  it('puts it on the longsword swing, which is made with Strength', () => {
    const game = new Game().beam(DOOMED).until(GOBLIN);
    expect(game.swing('longsword').mode).toBe('disadvantage');
  });

  it('leaves the same creature’s Dexterity swing alone, Finesse and all', () => {
    const game = new Game().beam(DOOMED).until(GOBLIN);
    expect(game.swing('rapier', 'dex').mode).toBe('normal');
  });

  it('takes 1d8 off the swing that lands, and says so in the log', () => {
    const game = new Game().beam(DOOMED).until(GOBLIN);
    const hit = game.swing('longsword').events;

    const line = penaltyLine(hit);
    expect(line, 'the penalty wrote no line').toBeDefined();
    expect(line!.label).toBe('Ray of Enfeeblement');
    expect(line!.total).toBeGreaterThanOrEqual(1);
    expect(line!.total).toBeLessThanOrEqual(8);
    // **And nothing below nothing.** Ray of Enfeeblement prints no floor, so a
    // d8 larger than the blow leaves the target taking none at all rather than
    // healing the wizard — which is `adjustmentsFor`'s own ceiling and what
    // `floor` would raise for SRD Enlarge/Reduce. The line says what actually
    // came off rather than what the die showed, which is the difference a
    // floor makes visible.
    expect(takenIn(hit)).toBe(rawOf(hit) - subtracted(line!));
    expect(subtracted(line!)).toBe(Math.min(line!.total, rawOf(hit)));
  });

  it('takes it off a spell the target casts as well, because the book says all of them', () => {
    const game = new Game().beam(DOOMED).until(GOBLIN);
    const bolt = game.bolt();

    const line = penaltyLine(bolt);
    expect(line, 'the penalty wrote no line').toBeDefined();
    expect(takenIn(bolt)).toBe(rawOf(bolt) - subtracted(line!));
  });

  it('leaves an unenfeebled creature’s damage exactly as it was', () => {
    const game = new Game().until(GOBLIN);
    const hit = game.swing('longsword').events;
    expect(penaltyLine(hit)).toBeUndefined();
    expect(takenIn(hit)).toBe(rawOf(hit));
  });

  it('is refused at authoring if the penalty subtracts nothing', () => {
    const out = written({
      kind: 'save',
      ability: 'con',
      modifiers: [{ kind: 'damage-penalty' }],
    });
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error('unreachable');
    expect(out.code).toBe('penalty_subtracts_nothing');
  });

  it('names the die and the printed number apart, so the line adds up', () => {
    const game = new Game();
    game.push([
      {
        type: 'damage-penalty-granted',
        id: GOBLIN,
        penalty: { source: 'the fixture', label: 'Weakening', dice: '1d4', flat: 2 },
      },
    ]);
    game.until(GOBLIN);
    const hit = game.swing('longsword').events;

    const line = penaltyLine(hit);
    expect(line, 'the penalty wrote no line').toBeDefined();
    // A grant may carry both, and a single contribution naming the notation
    // would say the d4 showed six.
    expect(line!.contributions.map((part) => part.source)).toEqual([
      '1d4',
      'the printed number',
    ]);
    expect(line!.contributions.reduce((sum, part) => sum + part.amount, 0)).toBe(line!.total);
    expect(line!.contributions[1]!.amount).toBe(2);
    expect(line!.contributions[0]!.amount).toBeGreaterThanOrEqual(1);
    expect(line!.contributions[0]!.amount).toBeLessThanOrEqual(4);
  });

  it('is refused at authoring if the number it subtracts is not a hit point', () => {
    const out = written({
      kind: 'save',
      ability: 'con',
      modifiers: [{ kind: 'damage-penalty', flat: 0 }],
    });
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error('unreachable');
    expect(out.code).toBe('bad_damage_penalty');
  });

  it('is refused at authoring if the floor is not a hit point', () => {
    const out = written({
      kind: 'save',
      ability: 'con',
      modifiers: [{ kind: 'damage-penalty', dice: '1d4', floor: 0 }],
    });
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error('unreachable');
    expect(out.code).toBe('bad_damage_floor');
  });
});

describe('what a successful save costs, which is the branch nothing used to reach', () => {
  it('hangs the success’s Disadvantage and nothing the failure would have', () => {
    const game = new Game().beam(SPARED);
    expect(game.penaltiesOn(GOBLIN)).toHaveLength(0);
    expect(game.modesOn(GOBLIN)).toEqual(['disadvantage']);
  });

  it('costs the target its next attack roll and nothing after it', () => {
    const game = new Game().beam(SPARED).until(GOBLIN);

    expect(game.swing('longsword').mode).toBe('disadvantage');
    // Spent by the roll it reached, which is what `oneShot` means — and before
    // any boundary, so it is the swing that ended it rather than the deadline.
    expect(game.modesOn(GOBLIN)).toEqual([]);

    // A round on, with the beam's own minute still running.
    game.turn(DOOMED);
    game.until(GOBLIN, DOOMED);
    expect(game.swing('rapier').mode).toBe('normal');
  });

  it('ends at the start of the caster’s next turn when no swing came', () => {
    const game = new Game().beam(SPARED);
    expect(game.modesOn(GOBLIN)).toEqual(['disadvantage']);

    // The wizard went first, so the goblin's turn and then the wizard's next
    // one is two boundaries; the goblin's save at the end of its own turn is
    // made to fail so the casting is still running.
    game.turn();
    game.turn(DOOMED);
    expect(game.state.combat?.order[game.state.combat.turnIndex]?.id).toBe(WIZARD);
    expect(game.modesOn(GOBLIN)).toEqual([]);
  });

  it('is refused at authoring if a success would deal damage', () => {
    const out = written({
      kind: 'save',
      ability: 'con',
      condition: 'poisoned',
      onSuccessRiders: { delayed: { damage: { dice: '1d8' }, damageType: 'necrotic' } },
    });
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error('unreachable');
    expect(out.code).toBe('damage_on_a_success');
  });

  it('is refused at authoring if a success would light the target up', () => {
    const out = written({
      kind: 'save',
      ability: 'con',
      condition: 'poisoned',
      onSuccessRiders: { light: { level: 'dim', radius: 10 } },
    });
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error('unreachable');
    expect(out.code).toBe('rider_off_a_success');
  });
});

describe('what a casting with no duration may not leave standing, on either branch', () => {
  /**
   * The rule is {@link checkGrantLifetimes}' and it used to stop at the
   * failure slot: `modifierRidersOf` reads the flat `modifiers`, and a grant
   * hung on a **success** was walked by nothing at all. An Instantaneous
   * homebrew could therefore hang a permanent Poisoned or a permanent damage
   * penalty on a creature that had made its save — the silent failure the
   * refusal exists to convert into an authoring error.
   */
  it.each([
    ['a mode with no deadline', { modifiers: [{ kind: 'mode', modifier: { mode: 'disadvantage', selector: { roll: 'attack', relation: 'roller' } } }] }],
    ['a damage penalty', { modifiers: [{ kind: 'damage-penalty', dice: '1d8' }] }],
    ['a condition with no deadline', { conditions: [{ name: 'poisoned' }] }],
    ['a creature held in the air', { movement: { feet: 20, kind: 'lift' } }],
  ])('refuses %s on a success branch it could never lift', (_what, riders) => {
    const out = writtenInstantaneous({
      kind: 'save',
      ability: 'con',
      condition: 'poisoned',
      outlivesCasting: true,
      onSuccessRiders: riders,
    });
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error('unreachable');
    expect(out.code).toBe('grant_without_lifetime');
  });

  /**
   * And the pair a lift may not be written beside, on **either** slot.
   *
   * A `grants` deadline is keyed by the casting's source and the creature and
   * knows nothing about which branch hung what: when it fires, `releaseGrants`
   * takes off everything that source hung there, the lift among them, with a
   * creature and no scene to set anybody down in. So a lift on a success and a
   * deadline on a failure are the same pair one slot apart, which is the shape
   * `checkLiftAgainstDeadlines` says a refusal has to cover.
   */
  it.each([
    [
      'a lift on the failure and a deadline on the success',
      {
        movement: { feet: 20, kind: 'lift' },
        onSuccessRiders: {
          modifiers: [
            {
              kind: 'mode',
              modifier: { mode: 'disadvantage', selector: { roll: 'attack', relation: 'roller' } },
              lasts: 'start-of-casters-next-turn',
            },
          ],
        },
      },
      'effects[0].movement.kind',
    ],
    [
      'a lift on the success and a deadline on the failure',
      {
        modifiers: [
          {
            kind: 'mode',
            modifier: { mode: 'disadvantage', selector: { roll: 'attack', relation: 'roller' } },
            lasts: 'start-of-casters-next-turn',
          },
        ],
        onSuccessRiders: { movement: { feet: 20, kind: 'lift' } },
      },
      'effects[0].onSuccessRiders.movement.kind',
    ],
    [
      'both of them on the success',
      {
        onSuccessRiders: {
          movement: { feet: 20, kind: 'lift' },
          modifiers: [
            {
              kind: 'mode',
              modifier: { mode: 'disadvantage', selector: { roll: 'attack', relation: 'roller' } },
              lasts: 'start-of-casters-next-turn',
            },
          ],
        },
      },
      'effects[0].onSuccessRiders.movement.kind',
    ],
  ])('refuses %s', (_what, slots, field) => {
    const out = written({ kind: 'save', ability: 'con', condition: 'poisoned', ...slots });
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error('unreachable');
    expect(out.code).toBe('lift_beside_a_shorter_grant');
    // **The field an author would have to change**, which is the one this
    // refusal's own docstring promises to name — and a lift may now be written
    // on either branch, so a path that always said `movement` would point at
    // nothing for two of these three.
    expect(out.reason.startsWith(`${field}:`), out.reason).toBe(true);
  });

  /** And the same slot is fine the moment the casting has something to end it. */
  it('accepts the very same riders on a casting that lasts', () => {
    const out = written({
      kind: 'save',
      ability: 'con',
      condition: 'poisoned',
      onSuccessRiders: { modifiers: [{ kind: 'damage-penalty', dice: '1d8' }] },
    });
    expect(out.ok).toBe(true);
  });
});

describe('the repeat save, on a failure that imposed no condition', () => {
  it('rides the casting’s own deadline, because there is no instance to file it on', () => {
    const game = new Game().beam(DOOMED);
    const timers = Object.values(game.state.timers);
    expect(timers).toHaveLength(1);
    expect(timers[0]!.target.kind).toBe('casting');
    expect(timers[0]!.repeatSave?.of).toBe(GOBLIN);
    expect(timers[0]!.repeatSave?.at).toBe('end-of-turn');
    expect(timers[0]!.repeatSave?.onSuccess).toBe('end-casting');
    // "the target repeats **the** save" — the one the spell already rolled.
    expect(timers[0]!.repeatSave?.ability).toBe('con');
  });

  it('is raised at the end of the target’s turn and ends the spell on a success', () => {
    const game = new Game().beam(DOOMED);
    expect(game.penaltiesOn(GOBLIN)).toHaveLength(1);

    // The wizard's turn ends, and then the goblin's — which is the boundary
    // the hook names.
    expect(game.turn().saves).toEqual([]);
    const settled = game.turn(SPARED);
    expect(settled.saves).toHaveLength(1);
    expect(settled.saves[0]!.success).toBe(true);

    expect(Object.keys(game.state.ongoing)).toHaveLength(0);
    expect(game.penaltiesOn(GOBLIN)).toHaveLength(0);
    expect(game.modesOn(GOBLIN)).toEqual([]);
    expect(game.state.creatures.wizard?.concentration).toBeNull();
  });

  it('is owed again at the next boundary when the save is failed', () => {
    const game = new Game().beam(DOOMED);
    game.turn();
    expect(game.turn(DOOMED).saves[0]!.success).toBe(false);

    expect(Object.keys(game.state.ongoing)).toHaveLength(1);
    expect(game.penaltiesOn(GOBLIN)).toHaveLength(1);

    game.turn();
    expect(game.turn(SPARED).saves).toHaveLength(1);
    expect(Object.keys(game.state.ongoing)).toHaveLength(0);
  });

  it('goes with the Concentration, like every other grant the casting hung', () => {
    const game = new Game().beam(DOOMED);
    expect(game.penaltiesOn(GOBLIN)).toHaveLength(1);
    expect(game.modesOn(GOBLIN)).toEqual(['disadvantage']);

    game.push(unwrap(endConcentration(game.state, WIZARD, 'voluntary'), 'let go'));
    expect(game.penaltiesOn(GOBLIN)).toHaveLength(0);
    expect(game.modesOn(GOBLIN)).toEqual([]);

    game.until(GOBLIN);
    const hit = game.swing('longsword');
    expect(hit.mode).toBe('normal');
    expect(penaltyLine(hit.events)).toBeUndefined();
  });

  it('is refused at authoring when a success would end on the target instead', () => {
    const out = written({
      kind: 'save',
      ability: 'con',
      modifiers: [{ kind: 'damage-penalty', dice: '1d8' }],
      repeats: { at: 'end-of-turn', onSuccess: 'end-on-target' },
    });
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error('unreachable');
    expect(out.code).toBe('repeat_without_condition');
  });

  it('is refused at authoring when it names a second ability', () => {
    const out = written({
      kind: 'save',
      ability: 'con',
      modifiers: [{ kind: 'damage-penalty', dice: '1d8' }],
      repeats: { at: 'end-of-turn', onSuccess: 'end-casting', ability: 'wis' },
    });
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error('unreachable');
    expect(out.code).toBe('repeat_states_an_ability');
  });

  it('is refused at authoring on a spell that could catch more than one creature', () => {
    const out = parseSpellDefinition({
      id: 'homebrew-wide-beam',
      name: 'Wide Beam',
      level: 2,
      school: 'necromancy',
      castingTime: 'action',
      concentration: true,
      range: { kind: 'ranged', feet: 60 },
      targets: { count: 2 },
      durationSeconds: 60,
      effects: [
        {
          kind: 'save',
          ability: 'con',
          modifiers: [{ kind: 'damage-penalty', dice: '1d8' }],
          repeats: { at: 'end-of-turn', onSuccess: 'end-casting' },
        },
      ],
    });
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error('unreachable');
    expect(out.code).toBe('casting_repeat_over_several_targets');
  });
});

describe('the catalogue says what this spell does', () => {
  it('leaves the table nothing and hands over no unmodelled sentence', () => {
    const definition = SRD_CONTENT.spell('ray-of-enfeeblement')!;
    expect(definition.unmodelled ?? []).toEqual([]);
    expect(definition.effects).toHaveLength(1);
  });
});
