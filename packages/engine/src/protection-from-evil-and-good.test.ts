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
 * All three are built here: a roll mode narrowed by the **attacker's** creature
 * type, a condition Immunity narrowed by the type of whatever is causing the
 * condition, and — for a creature that was already Frightened when the ward went
 * up — Advantage on the repeat save that would shake it off, narrowed by what
 * *forced* the save. That last axis is the one `CLAUDE.md` recorded as missing
 * since Countercharm: "a saving throw knows its DC and not who set it". It knows
 * now, at the one end where the answer is in the log — a repeat save is raised by
 * a timer, the timer names the source that hung the condition, and a casting's
 * record names its caster.
 *
 * Possession stays the table's, in the book's own words, and the Advantage on a
 * new save against *that* effect goes with it.
 */

const id = (s: string) => asCharacterId(s);
const CLERIC = id('cleric');
const GHOUL = id('ghoul');
const BANDIT = id('bandit');
/**
 * A second warder, and the fixture needs one for a reason the spell itself
 * creates: the Immunity refuses a Fright from a warded type outright, so the
 * only way to be *already* Frightened by such a creature is for the ward to
 * arrive afterwards — and a Frightened creature may only Dash, so it cannot
 * cast the ward on itself. Range: Touch, so the acolyte stands beside the
 * cleric and off the Cone's axis.
 */
const ACOLYTE = id('acolyte');

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
  added(ACOLYTE, 'party', 'Humanoid'),
  added(GHOUL, 'foes', 'Undead'),
  added(BANDIT, 'foes', 'Humanoid'),
  ...[CLERIC, ACOLYTE].flatMap((who): readonly GameEvent[] => [
    {
      type: 'spellcasting-declared',
      id: who,
      spellcasting: declaredCasting({
        ability: 'wis',
        classId: 'cleric',
        prepared: ['protection-from-evil-and-good'],
      }),
    },
    ...[1, 2, 3].map((level): GameEvent => ({
      type: 'resource-pool-declared',
      id: who,
      pool: { key: `spell-slot:${level}`, label: `level ${level}`, max: 4, recovers: 'long-rest' },
    })),
  ]),
  ...[GHOUL, BANDIT].flatMap((who): readonly GameEvent[] => [
    { type: 'items-gained', id: who, items: [{ id: 'longsword', quantity: 1 }], source: 'kit' },
    { type: 'item-equipped', id: who, item: 'longsword', armor: null },
    // Both of them can cast Fear, which is how the *spell* road is driven: a
    // condition a casting imposes names no creature in its source, so the
    // resolver that imposes it has to state who cast it.
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
  // Beside the cleric and square to the Cone's axis, which runs east–west
  // between the Ghoul and the Bandit: a wedge five feet from its own origin is
  // five feet wide, so the acolyte is in reach of a Touch and out of the Fear.
  {
    type: 'creature-placed',
    id: ACOLYTE,
    placement: { from: { creature: CLERIC }, feet: 5, bearing: 0 },
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
      { id: ACOLYTE, initiative: 5, speed: 30 },
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

  /**
   * The ward, cast on the cleric by somebody standing beside them.
   *
   * The only road to "already Frightened by such a creature": the Immunity
   * refuses a new one outright, and a Frightened creature may only Dash.
   */
  wardBy(who: CharacterId): this {
    this.until(who);
    const out = unwrap(
      resolveSpell(
        this.state,
        who,
        {
          spellId: 'protection-from-evil-and-good',
          targets: [CLERIC],
          willing: [CLERIC],
        },
        supply(this.state),
      ),
      `${who} wards the cleric`,
    );
    return this.push(out.events);
  }

  /**
   * Fear's repeat is owed only where the creature cannot see the caster, which
   * is a fact a table declares — so the fixture declares it.
   */
  blind(to: CharacterId): this {
    return this.push([{ type: 'sight-declared', from: CLERIC, to, seen: false }]);
  }

  /**
   * Drive the order to the end of the cleric's turn and hand back the repeat
   * save that boundary rolled.
   */
  repeat(): { readonly mode: string; readonly label: string; readonly sources: readonly string[] } {
    this.until(CLERIC);
    const out = unwrap(resolveTurn(this.state, supply(this.state)), 'the cleric ends its turn');
    this.push(out.events);
    const mine = out.saves.filter((one) => one.target === CLERIC);
    if (mine.length !== 1) {
      throw new Error(`the boundary rolled ${mine.length} saves for the cleric`);
    }
    const save = mine[0]!;
    return {
      mode: save.save.mode,
      label: save.label,
      sources: save.save.modeSources.map((one) => one.source),
    };
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
   * **The road whose source names no creature.** A condition a casting imposes
   * is filed under `Fear#cast:N`, and there is nothing in that string to read
   * a caster out of — nor anywhere else at that moment, because the record a
   * casting leaves is written *after* its effects resolve. So the caster is
   * **stated**: `applySpellEffect` already holds it and hands it to the door.
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

  it('is told who cast it, so the Ghoul’s Fear is refused and the bandit’s is not', () => {
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

describe('a mode on a save narrowed by what forced it', () => {
  it('is legal on a saving throw and on nothing else', () => {
    const problems = (roll: 'saving-throw' | 'attack' | 'ability-check') =>
      rollSelectorProblems(
        { roll, relation: 'roller', againstSourceType: ['Fiend'] },
        (skill) => SKILL_ABILITY[skill],
      ).map((one) => one.code);

    expect(problems('saving-throw')).toEqual([]);
    expect(problems('attack')).toContain('source_type_off_a_saving_throw');
    expect(problems('ability-check')).toContain('source_type_off_a_saving_throw');
  });

  it('refuses an empty list, which reads as a filter and is none', () => {
    expect(
      rollSelectorProblems(
        { roll: 'saving-throw', relation: 'roller', againstSourceType: [] },
        (skill) => SKILL_ABILITY[skill],
      ).map((one) => one.code),
    ).toContain('type_filters_nothing');
  });

  /**
   * The whole sentence, driven: the Ghoul's Fear lands before the ward does,
   * the acolyte wards the cleric afterwards, and the repeat save the boundary
   * raises is rolled with Advantage — because the thing that forced it is
   * Undead.
   */
  it('gives the cleric Advantage on the repeat against an Undead’s Fear', () => {
    const game = new Game();
    expect(game.fear(GHOUL)).toContain('frightened');
    game.wardBy(ACOLYTE).blind(GHOUL);

    const { mode, label, sources } = game.repeat();
    expect(label).toContain('Fear');
    expect(mode).toBe('advantage');
    // And it is this spell's doing, named on the roll.
    expect(sources.join(' ')).toContain('Protection from Evil and Good');
  });

  /** And the bandit is a Humanoid, whom this spell wards against not at all. */
  it('leaves the repeat against a Humanoid’s Fear alone', () => {
    const game = new Game();
    expect(game.fear(BANDIT)).toContain('frightened');
    game.wardBy(ACOLYTE).blind(BANDIT);

    expect(game.repeat().mode).toBe('normal');
  });

  /** And a cleric nobody has warded rolls its repeat plainly either way. */
  it('grants nothing to a creature the spell is not on', () => {
    const game = new Game();
    expect(game.fear(GHOUL)).toContain('frightened');
    game.blind(GHOUL);

    expect(game.repeat().mode).toBe('normal');
  });
});

describe('the catalogue says what this spell does', () => {
  it('hands over the one clause the engine cannot hold, in the book’s words', () => {
    const { unverified } = new Game().ward();
    expect(unverified.join(' ')).toContain('possessed');
    // And the clause that used to sit beside it is granted now, so it is no
    // longer reported as a debt.
    expect(unverified.join(' ')).not.toContain('nothing records what a save was against');
  });
});
