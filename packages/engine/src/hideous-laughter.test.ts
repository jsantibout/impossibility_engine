import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, isErr, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, restoreRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { declaredCasting } from './spellcasting.js';
import { checkSpellDefinitionValue } from './spell-schema.js';
import type { ReactionFeature } from './reactions.js';
import { resolveAttack, resolveSpell, resolveTurn, settleDamage, standUp } from './commands.js';

/**
 * SRD Hideous Laughter, and the save a **blow** raises.
 *
 * > "One creature of your choice that you can see within range makes a Wisdom
 * > saving throw. On a failed save, it has the Prone and Incapacitated
 * > conditions for the duration. During that time, it laughs uncontrollably if
 * > it's capable of laughter, and it can't end the Prone condition on itself.
 * > At the end of each of its turns **and each time it takes damage**, it makes
 * > another Wisdom saving throw. The target has Advantage on the save if the
 * > save is triggered by damage. On a successful save, the spell ends."
 *
 * The turn boundary is what `RepeatSave` has always named. The second trigger
 * is the shape: a save raised by something that *happened*, rolled in the same
 * batch as the blow that raised it, and with a mode the sentence prints.
 */

const id = (s: string) => asCharacterId(s);
const WIZARD = id('wizard');
const FIGHTER = id('fighter');
const GOBLIN = id('goblin');
const HOBGOBLIN = id('hobgoblin');

/**
 * A goblin that can answer a damage roll, so the blow takes the **held** road.
 *
 * Compiled onto the creature rather than granted by a level, because what is
 * under test is the window and not how anybody came by the feature — the
 * reading `damage-dice-in-the-log.test.ts` already takes of the same feature.
 */
const CUTTING_WORDS: ReactionFeature = {
  feature: 'bard:cutting-words',
  name: 'Cutting Words',
  window: 'damage-rolled',
  costsReaction: true,
  pool: null,
  reach: { kind: 'within', feet: 60 },
  requiresSight: true,
  does: { kind: 'reduce-damage', amount: { dice: '1d6' } },
};

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
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
  ...over,
});

const added = (
  who: CharacterId,
  side: string,
  over: Partial<CharacterSheet> = {},
): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(over),
  maxHp: 400,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side,
});

const field = (withAlly: boolean): readonly GameEvent[] => [
  added(WIZARD, 'party'),
  added(FIGHTER, 'party'),
  added(GOBLIN, 'foes'),
  // **The goblin's own Reaction is no use here**, which is the thing worth
  // saying: a laughing creature is Incapacitated and takes none. So the
  // window is opened by an ally standing beside it — the same road, reached
  // by the creature the book would actually have answer for a helpless one.
  // Present only for the test that drives the held road, because a window
  // that is always open is a different fixture for every other test here.
  ...(withAlly ? [added(HOBGOBLIN, 'foes', { reactions: [CUTTING_WORDS] })] : []),
  {
    type: 'spellcasting-declared',
    id: WIZARD,
    spellcasting: declaredCasting({
      ability: 'int',
      classId: 'wizard',
      prepared: ['hideous-laughter'],
    }),
  },
  ...[1, 2, 3].map((level): GameEvent => ({
    type: 'resource-pool-declared',
    id: WIZARD,
    pool: { key: `spell-slot:${level}`, label: `level ${level}`, max: 4, recovers: 'long-rest' },
  })),
  {
    type: 'items-gained',
    id: FIGHTER,
    items: [{ id: 'longsword', quantity: 1 }],
    source: 'kit',
  },
  { type: 'item-equipped', id: FIGHTER, item: 'longsword', armor: null },
  { type: 'scene-set', extent: { width: 600, depth: 600, height: 40 } },
  { type: 'landmark-added', name: 'the door', at: { x: 200, y: 200, z: 0 } },
  { type: 'creature-placed', id: WIZARD, placement: { from: { landmark: 'the door' }, feet: 0 } },
  {
    type: 'creature-placed',
    id: FIGHTER,
    placement: { from: { creature: WIZARD }, feet: 5, bearing: 90 },
  },
  {
    type: 'creature-placed',
    id: GOBLIN,
    placement: { from: { creature: FIGHTER }, feet: 5, bearing: 90 },
  },
  ...(withAlly
    ? ([
        {
          type: 'creature-placed',
          id: HOBGOBLIN,
          placement: { from: { creature: GOBLIN }, feet: 5, bearing: 90 },
        },
        { type: 'sight-declared', from: HOBGOBLIN, to: FIGHTER, seen: true },
        { type: 'sight-declared', from: FIGHTER, to: HOBGOBLIN, seen: true },
      ] as readonly GameEvent[])
    : []),
  ...[WIZARD, FIGHTER].flatMap((who): readonly GameEvent[] => [
    { type: 'sight-declared', from: who, to: GOBLIN, seen: true },
    { type: 'sight-declared', from: GOBLIN, to: who, seen: true },
  ]),
  {
    type: 'combat-started',
    combatants: [
      { id: WIZARD, initiative: 20, speed: 30 },
      { id: FIGHTER, initiative: 15, speed: 30 },
      { id: GOBLIN, initiative: 10, speed: 30 },
      ...(withAlly ? [{ id: HOBGOBLIN, initiative: 5, speed: 30 }] : []),
    ],
  },
];

const supply = (state: GameState, flat?: number) => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: (state.rng === null ? createRng('laughter') : restoreRng(state.rng)) as Rng,
  ...(flat === undefined ? {} : { bonuses: [{ source: 'the test insists', flat }] }),
  content: SRD_CONTENT,
});

/** A save nobody could make, and one nobody could miss. */
const DOOMED = -40;
const SPARED = 40;

/** The Wisdom save the spell raises, wherever it was raised. */
const laughterSave = (events: readonly GameEvent[]) => {
  const found = events.find(
    (event) => event.type === 'roll-recorded' && event.label.includes('Hideous Laughter'),
  );
  return found?.type === 'roll-recorded' ? found : undefined;
};

/** What the log says was said about the mode of that roll. */
const modesOf = (events: readonly GameEvent[]): readonly string[] =>
  (laughterSave(events)?.modes ?? []).map((mode) => mode.mode);

class Game {
  readonly events: GameEvent[];

  constructor(withAlly = false) {
    this.events = [...field(withAlly)];
  }

  get state(): GameState {
    return fold('laughter', this.events);
  }

  push(more: readonly GameEvent[]): this {
    this.events.push(...more);
    return this;
  }

  laugh(flat: number): this {
    const out = unwrap(
      resolveSpell(
        this.state,
        WIZARD,
        { spellId: 'hideous-laughter', targets: [GOBLIN] },
        supply(this.state, flat),
      ),
      'hideous laughter',
    );
    return this.push(out.events);
  }

  /** A blow the fighter cannot miss with, and everything it wrote. */
  strike(flat?: number): readonly GameEvent[] {
    const out = unwrap(
      resolveAttack(
        this.state,
        FIGHTER,
        {
          target: GOBLIN,
          weapon: 'longsword',
          attackBonuses: [{ source: 'the test insists', flat: 40 }],
        },
        { ...supply(this.state, flat) },
      ),
      'swing',
    );
    this.push(out.events);
    return out.events;
  }

  turn(flat?: number): readonly GameEvent[] {
    const out = unwrap(resolveTurn(this.state, supply(this.state, flat)), 'turn');
    this.push(out.events);
    return out.events;
  }

  until(who: CharacterId, flat?: number): this {
    for (let guard = 0; guard < 12; guard += 1) {
      const combat = this.state.combat;
      if (combat !== null && combat.order[combat.turnIndex]?.id === who) return this;
      this.turn(flat);
    }
    throw new Error(`the order never reached ${who}`);
  }

  /** Settle a blow the goblin held open at its Reaction window. */
  settle(): readonly GameEvent[] {
    const out = unwrap(settleDamage(this.state, supply(this.state)), 'settle');
    this.push(out.events);
    return out.events;
  }

  conditionsOn(who: CharacterId): readonly string[] {
    return (this.state.creatures[who]?.conditions.instances ?? []).map((held) => held.condition);
  }
}

describe('a repeat save raised by a trigger', () => {
  it('raises the Wisdom save when the goblin is struck, with Advantage', () => {
    const game = new Game().laugh(DOOMED);
    expect(game.conditionsOn(GOBLIN)).toContain('prone');

    game.until(FIGHTER);
    const struck = game.strike(DOOMED);
    const save = laughterSave(struck);
    expect(save, 'the blow raised no save').toBeDefined();
    expect(modesOf(struck)).toContain('advantage');
    // Failed, so the laughter holds and the casting runs on.
    expect(game.conditionsOn(GOBLIN)).toContain('prone');
    expect(Object.keys(game.state.ongoing)).toHaveLength(1);
  });

  it('ends the spell on a success, in the same batch as the blow', () => {
    const game = new Game().laugh(DOOMED);
    game.until(FIGHTER);
    const struck = game.strike(SPARED);
    expect(laughterSave(struck)).toBeDefined();
    expect(game.conditionsOn(GOBLIN)).not.toContain('prone');
    expect(Object.keys(game.state.ongoing)).toHaveLength(0);
  });

  /**
   * **One function, asked twice**, which is the rule `printedTypeTriggers`
   * beside it already keeps: a blow somebody held open at a Reaction window is
   * the same blow, and "each time it takes damage" is about the damage
   * landing rather than about which road it landed by.
   */
  it('raises it on the road a Reaction held open too', () => {
    const game = new Game(true).laugh(DOOMED);
    game.until(FIGHTER);
    const struck = game.strike(DOOMED);
    // Held rather than dealt: the swing wrote a `damage-rolled` and no save.
    expect(struck.some((event) => event.type === 'damage-rolled')).toBe(true);
    expect(laughterSave(struck)).toBeUndefined();

    const settled = game.settle();
    const save = laughterSave(settled);
    expect(save, 'the settled blow raised no save').toBeDefined();
    expect(modesOf(settled)).toContain('advantage');
  });

  it('raises the same save at the end of the goblin’s turn, without Advantage', () => {
    const game = new Game().laugh(DOOMED);
    game.until(GOBLIN);
    const boundary = game.turn(DOOMED);
    const save = laughterSave(boundary);
    expect(save, 'the boundary raised no save').toBeDefined();
    expect(modesOf(boundary)).toEqual([]);
  });

  it('refuses a trigger mode the SRD does not print', () => {
    const problems = checkSpellDefinitionValue({
      id: 'homebrew-giggling',
      name: 'Homebrew Giggling',
      level: 1,
      school: 'enchantment',
      castingTime: 'action',
      concentration: true,
      range: { kind: 'ranged', feet: 30 },
      targets: { count: 1 },
      durationSeconds: 60,
      effects: [
        {
          kind: 'save',
          ability: 'wis',
          condition: 'prone',
          repeats: {
            at: 'end-of-turn',
            onSuccess: 'end-casting',
            alsoWhenDamaged: { mode: 'disadvantage' },
          },
        },
      ],
    });
    expect(problems.map((problem) => problem.code)).toContain('bad_damage_trigger');
  });
});

/**
 * "During that time … **it can't end the Prone condition on itself**."
 *
 * The last clause of the spell, and it needed two things that did not exist:
 * a command that stands a creature up, and somewhere for the prohibition to
 * live. It lives on the condition instance the failure creates — so it ends
 * when the Laughter does, through the door the Prone itself leaves by, and
 * nothing has to remember to take it away.
 *
 * **A second Prone from somewhere else is what makes the test mean
 * something.** The Laughter owns the Prone it imposed, so a spell that ended
 * takes that instance with it and "the goblin may now stand" would be true of
 * a creature that was no longer on the floor. The shove is the reason there is
 * still a floor to get up from.
 */
describe('the clause that keeps a laughing creature down', () => {
  const SHOVED: GameEvent = {
    type: 'condition-applied',
    id: GOBLIN,
    condition: 'prone',
    source: 'the shove',
  };

  it('refuses the goblin its own feet while the spell runs, and returns them when it ends', () => {
    const game = new Game().laugh(DOOMED).push([SHOVED]);
    game.until(GOBLIN);

    const held = standUp(game.state, GOBLIN);
    expect(isErr(held) && held.code).toBe('cannot_stand');
    expect(isErr(held) && held.reason).toContain('Hideous Laughter');

    // A repeat save the goblin cannot fail: "On a successful save, the spell
    // ends", and with it the Prone the Laughter owned and the mark on it.
    game.turn(SPARED);
    expect(game.conditionsOn(GOBLIN)).toContain('prone');

    game.until(GOBLIN);
    const up = unwrap(standUp(game.state, GOBLIN), 'stand');
    expect(up.some((event) => event.type === 'movement-spent' && event.feet === 15)).toBe(true);
    game.push(up);
    expect(game.conditionsOn(GOBLIN)).not.toContain('prone');
  });

  /** And the mark is on the Prone alone: a definition that marked anything else is refused. */
  it('is refused by the validator on a condition that is not Prone', () => {
    const problems = checkSpellDefinitionValue({
      id: 'homebrew-pinning',
      name: 'Homebrew Pinning',
      level: 1,
      school: 'enchantment',
      castingTime: 'action',
      concentration: true,
      range: { kind: 'ranged', feet: 30 },
      targets: { count: 1 },
      durationSeconds: 60,
      effects: [
        { kind: 'save', ability: 'wis', condition: 'restrained', forbidsStandingUp: true },
      ],
    });
    expect(problems.map((problem) => problem.code)).toContain('forbids_standing_without_prone');
  });
});

describe('the catalogue says what this spell does', () => {
  it('says nothing about the damage-triggered save, which it executes', () => {
    const definition = SRD_CONTENT.spell('hideous-laughter')!;
    expect(definition.unmodelled ?? []).not.toContain(
      'the second Wisdom save each time the target takes damage, which is made with Advantage',
    );
  });

  /** The clause the engine could not say, now said. */
  it('no longer hands the self-cure back to the table', () => {
    const definition = SRD_CONTENT.spell('hideous-laughter')!;
    expect(definition.unmodelled ?? []).not.toContain(
      'the target being unable to end the Prone condition on itself, so it may stand up while the spell runs',
    );
    expect(definition.effects[0]).toMatchObject({ forbidsStandingUp: true });
  });
});
