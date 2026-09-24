import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, restoreRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { declaredCasting } from './spellcasting.js';
import { checkSpellDefinitionValue } from './spell-schema.js';
import { resolveAttack, resolveSpell, resolveTurn } from './commands.js';

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

const FIELD: readonly GameEvent[] = [
  added(WIZARD, 'party'),
  added(FIGHTER, 'party'),
  added(GOBLIN, 'foes'),
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
  readonly events: GameEvent[] = [...FIELD];

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

describe('the catalogue says what this spell does', () => {
  it('keeps the self-cure it cannot close and nothing else about the save', () => {
    const definition = SRD_CONTENT.spell('hideous-laughter')!;
    expect(definition.unmodelled ?? []).not.toContain(
      'the second Wisdom save each time the target takes damage, which is made with Advantage',
    );
  });
});
