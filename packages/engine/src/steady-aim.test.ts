import { SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import { asCharacterId, isErr, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { applyEvent, fold, type GameEvent, type GameState } from './events.js';
import { activateFeature, resolveAttack, resolveMove, resolveTurn } from './commands.js';
import { createCharacter, type CharacterChoices } from './creation.js';
import { movementLeftFor, speedOf } from './standing.js';

/**
 * A feature whose use **hangs a grant** at the moment it pays for it.
 *
 * SRD Steady Aim: "As a Bonus Action, you give yourself Advantage on your next
 * attack roll on the current turn. You can use this feature only if you haven't
 * moved during this turn, and after you use it, your Speed is 0 until the end
 * of the current turn."
 *
 * Three clauses, and the first is the one nothing could write. `oneShot` is a
 * field a feature's own `roll-mode` grant could already carry, and writing it
 * there would have done nothing at all: a feature's standing grant is
 * **derived** from the sheet on every read, and `consumedRollModifiers` spends
 * what it finds in `creature.rollModifiers`, which is **stored** state. Derived
 * rules say what a feature permits; only stored state is ever spent. So the
 * grant has to be emitted where the Bonus Action is spent, which is
 * `activateFeature`.
 *
 * | Clause | Shape |
 * |---|---|
 * | "Advantage on your next attack roll" | a hung `roll-mode` grant, `oneShot` |
 * | "only if you haven't moved during this turn" | `onlyIfUnmoved`, read off `TurnBudget.movementSpent` |
 * | "your Speed is 0 until the end of the current turn" | a hung `speed` grant, `zero` |
 * | "on the current turn" / "until the end of the current turn" | `end-of-current-turn`, on each grant's own `grants` timer |
 *
 * **The two grants carry two sources, which is a rule rather than a spelling.**
 * `roll-modifier-consumed` releases everything one source granted a creature —
 * that is `releaseGrants`, the same body a `grants` deadline has — so a Rogue
 * whose Advantage and Speed of 0 shared a source would get their Speed back by
 * swinging, which is not a sentence the SRD prints.
 */

const id = (s: string) => asCharacterId(s);
const ROGUE = id('rogue');
const GOBLIN = id('goblin');
/** A homebrew holder, for the half of the vocabulary no SRD feature writes. */
const MARKSMAN = id('marksman');

const STEADY_AIM = 'rogue:steady-aim';

const plain = (): CharacterSheet => ({
  level: 3,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: null,
});

/** A Rogue at the level Steady Aim arrives. */
const rogueChoices: CharacterChoices = {
  name: 'Nyx',
  classId: 'rogue',
  level: 3,
  speciesId: 'human',
  backgroundId: 'sage',
  languages: ['Dwarvish', 'Orc'],
  alignment: 'Neutral',
  spellbook: [],
  backgroundEquipment: 'A',
  classEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
  cantrips: [],
  preparedSpells: [],
  abilities: {
    method: 'standard-array',
    assignment: { str: 8, dex: 15, con: 13, int: 14, wis: 12, cha: 10 },
  },
  abilityIncreases: { con: 2, int: 1 },
  classSkills: ['stealth', 'sleight-of-hand', 'acrobatics', 'investigation'],
  subclassId: 'thief',
  featureChoices: {
    'human:skillful': ['perception'],
    'rogue:expertise': ['stealth', 'sleight-of-hand'],
    'rogue:weapon-mastery': [],
  },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int',
      cantrips: ['mage-hand', 'light'],
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId: 'alert' },
  },
};

/** The Rogue, a goblin within reach of a fist, and the Rogue holding the turn. */
const SETUP: readonly GameEvent[] = [
  ...(unwrap(createCharacter(SRD_CONTENT, rogueChoices, ROGUE), 'create') as GameEvent[]),
  { type: 'creature-side-declared', id: ROGUE, side: 'party' },
  {
    type: 'creature-added',
    id: GOBLIN,
    name: 'goblin',
    sheet: plain(),
    maxHp: 200,
    diesAtZero: false,
    creatureType: 'Humanoid',
    side: 'goblins',
  },
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
  { type: 'landmark-added', name: 'the yard', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: ROGUE, placement: { from: { landmark: 'the yard' }, feet: 0 } },
  {
    type: 'creature-placed',
    id: GOBLIN,
    placement: { from: { creature: ROGUE }, feet: 5, bearing: 0 },
  },
  { type: 'sight-declared', from: ROGUE, to: GOBLIN, seen: true },
  {
    type: 'combat-started',
    combatants: [
      { id: ROGUE, initiative: 20, speed: 30 },
      { id: GOBLIN, initiative: 10, speed: 30 },
    ],
  },
];

const supply = (seed = 'aim') => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

const types = (events: readonly GameEvent[]): readonly string[] => events.map((e) => e.type);

const applyAll = (state: GameState, events: readonly GameEvent[]): GameState =>
  events.reduce(applyEvent, state);

const aim = (log: readonly GameEvent[] = SETUP) =>
  unwrap(activateFeature(fold('seed', log), ROGUE, { feature: STEADY_AIM }, SRD_CONTENT), 'steady aim');

/** A fist, free of the Attack action, so two swings fit in one turn. */
const swing = (state: GameState) =>
  unwrap(
    resolveAttack(state, ROGUE, { target: GOBLIN, weapon: null, free: true }, supply('swing')),
    'swing',
  );

const modifiersOn = (state: GameState, who: CharacterId) =>
  state.creatures[who]?.rollModifiers ?? [];

describe('SRD Steady Aim: a Bonus Action that hangs a one-shot Advantage', () => {
  it('spends the Bonus Action and hangs the grant the roll will spend', () => {
    const events = aim();
    expect(types(events)).toEqual([
      'bonus-action-spent',
      'feature-activated',
      'roll-modifier-granted',
      'effect-scheduled',
      'speed-modifier-granted',
      'effect-scheduled',
      'effect-scheduled',
    ]);

    const after = applyAll(fold('seed', SETUP), events);
    const held = modifiersOn(after, ROGUE);
    expect(held).toHaveLength(1);
    expect(held[0]?.modifier.mode).toBe('advantage');
    expect(held[0]?.modifier.selector).toMatchObject({ roll: 'attack', relation: 'roller' });
    expect(held[0]?.modifier.oneShot).toBe(true);
    // Stored, which is the whole point: a derived grant is never spent.
    expect(after.combat?.budgets[ROGUE]?.bonusAction).toBe(false);
  });

  it('gives the next attack roll Advantage and is gone from the one after', () => {
    const log = [...SETUP, ...aim()];
    const state = fold('seed', log);

    const first = swing(state);
    expect(first.attack?.roll.mode).toBe('advantage');
    expect(types(first.events)).toContain('roll-modifier-consumed');

    const spent = applyAll(state, first.events);
    expect(modifiersOn(spent, ROGUE)).toEqual([]);

    const second = swing(spent);
    expect(second.attack?.roll.mode).toBe('normal');
  });

  /**
   * The rule the two sources exist for: swinging spends the Advantage and
   * nothing else. A shared source would have handed the Speed back.
   */
  it('leaves the Speed of 0 standing when the attack spends the Advantage', () => {
    const state = fold('seed', [...SETUP, ...aim()]);
    const spent = applyAll(state, swing(state).events);
    expect(speedOf(spent, ROGUE)).toBe(0);
  });

  it('sets the Speed to 0 for the rest of the turn', () => {
    const before = fold('seed', SETUP);
    expect(speedOf(before, ROGUE)).toBe(30);

    const after = fold('seed', [...SETUP, ...aim()]);
    expect(speedOf(after, ROGUE)).toBe(0);
    expect(movementLeftFor(after, ROGUE)).toBe(0);
    expect(isErr(resolveMove(after, ROGUE, { placement: { from: { landmark: 'the yard' }, feet: 5, bearing: 90 } }, supply()))).toBe(true);
  });

  it('is refused once the Rogue has moved this turn', () => {
    const moved = unwrap(
      resolveMove(
        fold('seed', SETUP),
        ROGUE,
        { placement: { from: { landmark: 'the yard' }, feet: 10, bearing: 90 } },
        supply(),
      ),
      'move',
    );
    const after = fold('seed', [...SETUP, ...moved.events]);
    expect(after.combat?.budgets[ROGUE]?.movementSpent).toBe(10);

    const refused = activateFeature(after, ROGUE, { feature: STEADY_AIM }, SRD_CONTENT);
    expect(isErr(refused) && refused.code).toBe('already_moved');
    // Nothing was spent by a refusal.
    expect(after.combat?.budgets[ROGUE]?.bonusAction).toBe(true);
  });

  /** "on the current turn": nothing of it outlives the turn it was taken on. */
  it('leaves nothing standing at the turn boundary', () => {
    const log = [...SETUP, ...aim()];
    const ended = [
      ...log,
      ...unwrap(resolveTurn(fold('seed', log), supply('turn')), 'turn').events,
    ];
    const after = fold('seed', ended);

    expect(modifiersOn(after, ROGUE)).toEqual([]);
    expect(after.creatures[ROGUE]?.speedModifiers).toEqual([]);
    expect(speedOf(after, ROGUE)).toBe(30);
  });

  /**
   * The record of the use ends at the start of the holder's next turn, which is
   * the earliest anchor a feature's own deadline has — so the Bonus Action is
   * there to be spent again on every turn the SRD allows one.
   */
  it('may be taken again on the next turn', () => {
    let log: readonly GameEvent[] = [...SETUP, ...aim()];
    expect(fold('seed', log).creatures[ROGUE]?.activeFeatures).toEqual([STEADY_AIM]);

    for (const seed of ['goblin', 'round-two']) {
      log = [...log, ...unwrap(resolveTurn(fold('seed', log), supply(seed)), 'turn').events];
    }

    const theirs = fold('seed', log);
    expect(theirs.combat?.order[theirs.combat.turnIndex]?.id).toBe(ROGUE);
    expect(theirs.creatures[ROGUE]?.activeFeatures).toEqual([]);
    expect(aim(log).length).toBeGreaterThan(0);
  });

  /**
   * "on the current turn" is a moment in the order, and outside combat there is
   * no order to have one. The refusal is the whole activation's, before
   * anything is spent: a grant with a deadline nothing can reach would run for
   * ever, which is the reading `masteryAfterHit` takes for the same three
   * sentences.
   */
  it('is refused where there are no turns to end', () => {
    const outside = SETUP.filter((event) => event.type !== 'combat-started');
    const refused = activateFeature(fold('seed', outside), ROGUE, { feature: STEADY_AIM }, SRD_CONTENT);
    expect(refused.ok).toBe(false);
  });

  /**
   * The span is the grant's own and not the engine's, which is what keeps this
   * a shape rather than one feature's rule: a hung grant may name either turn
   * anchor as well as the turn in progress, and every one of the three is a
   * `Duration` the engine already builds.
   */
  it('hangs a grant until a turn anchor where the feature says so', () => {
    const marked = [
      ...SETUP.filter((event) => event.type !== 'combat-started'),
      {
        type: 'creature-added',
        id: MARKSMAN,
        name: 'marksman',
        sheet: {
          ...plain(),
          activated: [
            {
              feature: 'homebrew:mark',
              name: 'Mark',
              action: 'bonus-action',
              pool: null,
              lasts: 'start-of-next-turn',
              hangs: [
                {
                  kind: 'roll-mode',
                  modifier: {
                    mode: 'advantage',
                    selector: { roll: 'attack', relation: 'roller' },
                    oneShot: true,
                  },
                  lasts: 'end-of-next-turn',
                },
              ],
            },
          ],
        },
        maxHp: 40,
        diesAtZero: false,
        creatureType: 'Humanoid',
        side: 'party',
      },
      {
        type: 'combat-started',
        combatants: [
          { id: MARKSMAN, initiative: 25, speed: 30 },
          { id: ROGUE, initiative: 20, speed: 30 },
          { id: GOBLIN, initiative: 10, speed: 30 },
        ],
      },
    ] as readonly GameEvent[];

    const events = unwrap(
      activateFeature(fold('seed', marked), MARKSMAN, { feature: 'homebrew:mark' }, SRD_CONTENT),
      'mark',
    );
    let log: readonly GameEvent[] = [...marked, ...events];
    expect(modifiersOn(fold('seed', log), MARKSMAN)).toHaveLength(1);

    // "the end of your next turn" said on your own turn is two turn-endings
    // away, so the grant outlives the turn it was hung on and the round after.
    for (const seed of ['a', 'b', 'c']) {
      log = [...log, ...unwrap(resolveTurn(fold('seed', log), supply(seed)), 'turn').events];
      expect(modifiersOn(fold('seed', log), MARKSMAN)).toHaveLength(1);
    }
    log = [...log, ...unwrap(resolveTurn(fold('seed', log), supply('d')), 'turn').events];
    expect(modifiersOn(fold('seed', log), MARKSMAN)).toEqual([]);
  });

  it('is idempotent under a repeated command id', () => {
    const state = fold('seed', SETUP);
    const first = unwrap(
      activateFeature(state, ROGUE, { commandId: 'c1', feature: STEADY_AIM }, SRD_CONTENT),
      'first',
    );
    expect(first.length).toBeGreaterThan(0);

    const again = unwrap(
      activateFeature(fold('seed', [...SETUP, ...first]), ROGUE, {
        commandId: 'c1',
        feature: STEADY_AIM,
      }, SRD_CONTENT),
      'again',
    );
    expect(again).toEqual([]);
  });
});
