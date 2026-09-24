import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, restoreRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { declaredCasting } from './spellcasting.js';
import { rollSelectorProblems } from './roll-modifiers.js';
import { SKILL_ABILITY } from '@ie/shared';
import { conditionImmunitiesOf } from './standing.js';
import { applyConditionTo, resolveAttack, resolveSpell, resolveTurn } from './commands.js';

/**
 * SRD Protection from Evil and Good, and the word that used to ruin all three
 * of its benefits: *them*.
 *
 * > "Until the spell ends, one willing creature you touch is protected against
 * > creatures that are Aberrations, Celestials, Elementals, Fey, Fiends, or
 * > Undead. The protection grants several benefits. Creatures of those types
 * > have Disadvantage on attack rolls against the target. The target also
 * > can't be possessed by or gain the Charmed or Frightened conditions from
 * > them. If the target is already possessed, Charmed, or Frightened by such a
 * > creature, the target has Advantage on any new saving throw against the
 * > relevant effect."
 *
 * Two of the three are built here: a roll mode narrowed by the **attacker's**
 * creature type, and a condition Immunity narrowed by the type of whatever is
 * causing the condition. The third and the possession are the table's, in the
 * book's own words.
 */

const id = (s: string) => asCharacterId(s);
const CLERIC = id('cleric');
const GHOUL = id('ghoul');
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

const FIELD: readonly GameEvent[] = [
  added(CLERIC, 'party', 'Humanoid'),
  added(GHOUL, 'foes', 'Undead'),
  added(BANDIT, 'foes', 'Humanoid'),
  {
    type: 'spellcasting-declared',
    id: CLERIC,
    spellcasting: declaredCasting({
      ability: 'wis',
      classId: 'cleric',
      prepared: ['protection-from-evil-and-good'],
    }),
  },
  ...[1, 2, 3].map((level): GameEvent => ({
    type: 'resource-pool-declared',
    id: CLERIC,
    pool: { key: `spell-slot:${level}`, label: `level ${level}`, max: 4, recovers: 'long-rest' },
  })),
  ...[GHOUL, BANDIT].flatMap((who): readonly GameEvent[] => [
    { type: 'items-gained', id: who, items: [{ id: 'longsword', quantity: 1 }], source: 'kit' },
    { type: 'item-equipped', id: who, item: 'longsword', armor: null },
    // Both of them can cast Fear, which is how the *spell* road is driven: a
    // condition a casting imposes names no creature in its source, so the door
    // reads the caster off the casting's own record.
    {
      type: 'spellcasting-declared',
      id: who,
      spellcasting: declaredCasting({ ability: 'cha', classId: 'warlock', prepared: ['fear'] }),
    },
    ...[1, 2, 3].map((level): GameEvent => ({
      type: 'resource-pool-declared',
      id: who,
      pool: { key: `spell-slot:${level}`, label: `level ${level}`, max: 4, recovers: 'long-rest' },
    })),
  ]),
  { type: 'scene-set', extent: { width: 600, depth: 600, height: 40 } },
  { type: 'landmark-added', name: 'the door', at: { x: 200, y: 200, z: 0 } },
  { type: 'creature-placed', id: CLERIC, placement: { from: { landmark: 'the door' }, feet: 0 } },
  {
    type: 'creature-placed',
    id: GHOUL,
    placement: { from: { creature: CLERIC }, feet: 5, bearing: 90 },
  },
  {
    type: 'creature-placed',
    id: BANDIT,
    placement: { from: { creature: CLERIC }, feet: 5, bearing: 270 },
  },
  ...[GHOUL, BANDIT].flatMap((who): readonly GameEvent[] => [
    { type: 'sight-declared', from: CLERIC, to: who, seen: true },
    { type: 'sight-declared', from: who, to: CLERIC, seen: true },
  ]),
  {
    type: 'combat-started',
    combatants: [
      { id: CLERIC, initiative: 20, speed: 30 },
      { id: GHOUL, initiative: 15, speed: 30 },
      { id: BANDIT, initiative: 10, speed: 30 },
    ],
  },
];

const supply = (state: GameState) => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: (state.rng === null ? createRng('ward') : restoreRng(state.rng)) as Rng,
  content: SRD_CONTENT,
});

class Game {
  readonly events: GameEvent[] = [...FIELD];

  get state(): GameState {
    return fold('ward', this.events);
  }

  push(more: readonly GameEvent[]): this {
    this.events.push(...more);
    return this;
  }

  /** The ward, on the cleric's own willing self. */
  ward(): { readonly game: Game; readonly unverified: readonly string[] } {
    const out = unwrap(
      resolveSpell(
        this.state,
        CLERIC,
        {
          spellId: 'protection-from-evil-and-good',
          targets: [CLERIC],
          willing: [CLERIC],
        },
        supply(this.state),
      ),
      'protection from evil and good',
    );
    this.push(out.events);
    return { game: this, unverified: out.unverified };
  }

  /** Advance the order until it is this creature's turn to act. */
  until(who: CharacterId): this {
    for (let guard = 0; guard < 12; guard += 1) {
      const combat = this.state.combat;
      if (combat !== null && combat.order[combat.turnIndex]?.id === who) return this;
      this.push(unwrap(resolveTurn(this.state, supply(this.state)), 'turn').events);
    }
    throw new Error(`the order never reached ${who}`);
  }

  /** A swing at the cleric, and the mode it came out under. */
  swing(who: CharacterId): string {
    this.until(who);
    const out = unwrap(
      resolveAttack(
        this.state,
        who,
        { target: CLERIC, weapon: 'longsword' },
        supply(this.state),
      ),
      `${who} swings`,
    );
    this.push(out.events);
    return out.attack!.roll.mode;
  }

  /**
   * Somebody casts Fear over the cleric, and what the engine said about the
   * Frightened it tried to impose.
   *
   * **The road that names no creature.** A condition a casting imposes is
   * filed under `Fear#cast:N`, and the door reads the caster back off the
   * casting's own record rather than being handed one — which is the whole of
   * what makes a narrowed Immunity answerable without threading a caster
   * through four resolvers.
   */
  fear(by: CharacterId): readonly string[] {
    this.until(by);
    const out = unwrap(
      resolveSpell(
        this.state,
        by,
        { spellId: 'fear', targets: [], towards: { x: 200, y: 200, z: 0 }, slotLevel: 3 },
        { ...supply(this.state), bonuses: [{ source: 'the test insists', flat: -40 }] },
      ),
      `${by} casts Fear`,
    );
    this.push(out.events);
    return (this.state.creatures[CLERIC]?.conditions.instances ?? []).map(
      (held) => held.condition,
    );
  }

  /** Somebody makes the cleric Frightened, and what the engine said about it. */
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

describe('a filter on the attacker’s creature type', () => {
  it('is legal only on a selector about rolls against its holder', () => {
    const problems = (relation: 'roller' | 'against-holder') =>
      rollSelectorProblems(
        { roll: 'attack', relation, attackerType: ['Undead'] },
        (skill) => SKILL_ABILITY[skill],
      ).map((one) => one.code);

    expect(problems('against-holder')).toEqual([]);
    expect(problems('roller')).toContain('type_on_the_wrong_end');
  });

  it('refuses an empty list, which reads as a filter and is none', () => {
    expect(
      rollSelectorProblems(
        { roll: 'attack', relation: 'against-holder', attackerType: [] },
        (skill) => SKILL_ABILITY[skill],
      ).map((one) => one.code),
    ).toContain('type_filters_nothing');
  });

  it('gives the Ghoul Disadvantage and leaves the bandit’s swing alone', () => {
    const { game } = new Game().ward();
    expect(game.swing(GHOUL)).toBe('disadvantage');
    expect(game.swing(BANDIT)).toBe('normal');
  });
});

describe('a condition Immunity narrowed to its source', () => {
  it('refuses the Ghoul’s Frightened and admits the bandit’s', () => {
    const { game } = new Game().ward();
    expect(game.frighten(GHOUL)).toBe('immune');
    expect(game.frighten(BANDIT)).toBeNull();
  });

  it('reads the caster off a casting, so the Ghoul’s Fear is refused and the bandit’s is not', () => {
    // Two games, because one Cone catches both of them and a Frightened
    // creature may only Dash — the second caster would be refused its own
    // Action by the first caster's spell.
    expect(new Game().ward().game.fear(GHOUL)).not.toContain('frightened');
    expect(new Game().ward().game.fear(BANDIT)).toContain('frightened');
  });

  it('is not read at all where nobody says what caused the condition', () => {
    const { game } = new Game().ward();
    // The unqualified gatherer answers about the condition and says nothing
    // about a cause, so a narrowed grant is not in it.
    expect(conditionImmunitiesOf(game.state, CLERIC)).not.toContain('frightened');
  });
});

describe('the catalogue says what this spell does', () => {
  it('hands over the two clauses the engine cannot hold, in the book’s words', () => {
    const { unverified } = new Game().ward();
    expect(unverified.join(' ')).toContain('possessed');
    expect(unverified.join(' ')).toContain('relevant effect');
  });
});
