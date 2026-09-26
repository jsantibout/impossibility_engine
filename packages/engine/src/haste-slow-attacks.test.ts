/**
 * The count inside an Attack action, which the economy kept and nothing could
 * bend.
 *
 * > SRD Haste: "That action can be used to take only the Attack (**one attack
 * > only**), Dash, Disengage, Hide, or Utilize action."
 * > SRD Slow: "it can make **only one attack** if it takes the Attack action."
 *
 * **Two sentences, two fields, and they are not one field.** Haste's parenthesis
 * narrows the action the spell *hands over* and says nothing about the turn's
 * own: a hasted Fighter with Extra Attack swings twice on their own Attack action
 * and once on Haste's. Slow's stands on the creature and reaches every Attack
 * action it takes, its own included. A single number would have made one of the
 * two wrong in the direction nothing measures.
 *
 * `GrantedAction.attacksCap` travels with the extra action; `ActionRule`'s
 * `caps-attacks` stands on the creature. Both are read where the quiver is
 * filled, and `cappedAttacks` takes the smallest — a cap never raises anything,
 * so a creature with no Extra Attack is not handed a second swing by a spell that
 * took one away.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, restoreRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { spellSlotKey } from './resources.js';
import { declaredCasting } from './spellcasting.js';
import { resolveAttack, resolveSpell, resolveTurn, takeDodge } from './commands.js';
import { checkActionRule } from './spell-schema.js';

const id = (s: string) => asCharacterId(s);
const WIZ = id('wiz');
const FIGHTER = id('fighter');
const FOE = id('foe');

/** Extra Attack, as the sheet carries it: two swings in one Attack action. */
const sheet = (attacksPerAction?: number): CharacterSheet => ({
  level: 9,
  abilities: { str: 18, dex: 14, con: 14, int: 18, wis: 12, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
  weaponProficiencies: ['simple', 'martial'],
  ...(attacksPerAction === undefined ? {} : { attacksPerAction }),
});

const added = (who: CharacterId, attacksPerAction?: number): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(attacksPerAction),
  maxHp: 400,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side: who === FOE ? 'foes' : 'party',
});

const SETUP: readonly GameEvent[] = [
  added(WIZ),
  added(FIGHTER, 2),
  added(FOE),
  // **Two casters, because both spells hold Concentration**: a wizard who cast
  // Haste and then Slow would have dropped the Haste in the same breath, which
  // is the SRD and not a fixture problem.
  ...[WIZ, FOE].flatMap((who): readonly GameEvent[] => [
    {
      type: 'spellcasting-declared',
      id: who,
      spellcasting: declaredCasting({ ability: 'int', prepared: ['haste', 'slow'] }),
    },
    ...[1, 2, 3].map(
      (level): GameEvent => ({
        type: 'resource-pool-declared',
        id: who,
        pool: { key: spellSlotKey(level), label: `level ${level}`, max: 4, recovers: 'long-rest' },
      }),
    ),
  ]),
  ...[FIGHTER, FOE].flatMap((who): readonly GameEvent[] => [
    { type: 'items-gained', id: who, items: [{ id: 'longsword', quantity: 1 }], source: 'the kit' },
    { type: 'item-equipped', id: who, item: 'longsword', armor: null },
  ]),
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
  { type: 'landmark-added', name: 'the yard', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: WIZ, placement: { from: { landmark: 'the yard' }, feet: 0 } },
  { type: 'creature-placed', id: FIGHTER, placement: { from: { creature: WIZ }, feet: 5, bearing: 0 } },
  { type: 'creature-placed', id: FOE, placement: { from: { creature: FIGHTER }, feet: 5, bearing: 0 } },
  { type: 'sight-declared', from: WIZ, to: FIGHTER, seen: true },
  { type: 'sight-declared', from: WIZ, to: FOE, seen: true },
  {
    type: 'combat-started',
    combatants: [
      { id: WIZ, initiative: 20, speed: 30 },
      { id: FIGHTER, initiative: 15, speed: 30 },
      { id: FOE, initiative: 10, speed: 30 },
    ],
  },
];

const supply = (state: GameState) => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: (state.rng === null ? createRng('quick') : restoreRng(state.rng)) as Rng,
  content: SRD_CONTENT,
  // Every swing lands and every save fails, so nothing here rests on a die.
  bonuses: [{ source: 'the test insists', flat: 40 }],
});

class Game {
  readonly events: GameEvent[] = [...SETUP];

  get state(): GameState {
    return fold('quick', this.events);
  }

  push(more: readonly GameEvent[]): this {
    this.events.push(...more);
    return this;
  }

  /** A spell on the fighter, from whoever is casting it, on their own turn. */
  cast(spellId: string, on: CharacterId, by: CharacterId = WIZ): this {
    this.until(by);
    const out = unwrap(
      resolveSpell(
        this.state,
        by,
        {
          spellId,
          targets: [on],
          slotLevel: 3,
          ...(spellId === 'haste'
            ? { willing: [on] }
            : // Slow bounds its six targets with a 40-foot Cube, which has to be
              // pointed as well as placed.
              { at: { x: 100, y: 100, z: 0 }, towards: { x: 100, y: 200, z: 0 } }),
        } as never,
        // Slow's Wisdom save has to fail, and Haste needs no die at all.
        { ...supply(this.state), bonuses: [{ source: 'the test insists', flat: -40 }] },
      ),
      spellId,
    );
    return this.push(out.events);
  }

  until(who: CharacterId): this {
    for (let guard = 0; guard < 12; guard += 1) {
      const combat = this.state.combat;
      if (combat !== null && combat.order[combat.turnIndex]?.id === who) return this;
      this.push(unwrap(resolveTurn(this.state, supply(this.state)), 'turn').events);
    }
    throw new Error(`the order never reached ${who}`);
  }

  /** Swing, and say whether the swing was allowed. */
  swing(who: CharacterId, usingFeature?: string): string | null {
    const out = resolveAttack(
      this.state,
      who,
      {
        target: FOE,
        weapon: 'longsword',
        attackBonuses: [{ source: 'the test insists', flat: 40 }],
        ...(usingFeature === undefined ? {} : { usingFeature }),
      },
      supply(this.state),
    );
    if (isErr(out)) return out.code;
    this.push(unwrap(out, 'the swing').events);
    return null;
  }

  /** How many swings the Attack action has left. */
  get left(): number | null {
    return this.state.combat?.budgets[FIGHTER]?.attacksRemaining ?? null;
  }

  /** The extra actions this turn holds, as the log minted them. */
  get extras(): readonly { readonly source: string; readonly attacksCap?: number }[] {
    return this.state.combat?.budgets[FIGHTER]?.extraActions ?? [];
  }
}

describe('SRD Haste: "the Attack (one attack only)"', () => {
  it('mints the extra action with the parenthesis on it', () => {
    const game = new Game().cast('haste', FIGHTER).until(FIGHTER);
    expect(game.extras).toEqual([{ source: 'Haste', only: ['attack', 'dash', 'disengage', 'hide', 'utilize'], attacksCap: 1 }]);
  });

  it('leaves the fighter’s own Attack action holding two and Haste’s holding one', () => {
    const game = new Game().cast('haste', FIGHTER).until(FIGHTER);

    // The turn's own action first, which is the economy's rule: Extra Attack
    // fills the quiver with two.
    expect(game.swing(FIGHTER)).toBeNull();
    expect(game.left).toBe(1);
    expect(game.swing(FIGHTER)).toBeNull();
    expect(game.left).toBe(0);

    // And now Haste's, which holds one — so the third swing fills the quiver
    // again with a single attack and the fourth is refused.
    expect(game.swing(FIGHTER)).toBeNull();
    expect(game.left).toBe(0);
    // `no_attacks_left` rather than `no_action`: `spendAttack` reports the more
    // useful of the two true sentences to a creature whose quiver is empty.
    expect(game.swing(FIGHTER)).toBe('no_attacks_left');
  });

  it('leaves an unhasted fighter both swings and no third', () => {
    const game = new Game().until(FIGHTER);
    expect(game.swing(FIGHTER)).toBeNull();
    expect(game.swing(FIGHTER)).toBeNull();
    expect(game.swing(FIGHTER)).toBe('no_attacks_left');
  });
});

describe('SRD Slow: "only one attack if it takes the Attack action"', () => {
  it('caps the fighter’s own Attack action at one swing', () => {
    const game = new Game().cast('slow', FIGHTER).until(FIGHTER);

    expect(game.swing(FIGHTER)).toBeNull();
    // One, not two: the cap is read where the quiver is filled, so Extra
    // Attack's second swing was never put in it.
    expect(game.left).toBe(0);
    // And the Bonus Action is gone with the action, which is the same spell's
    // other clause — so the second swing has nothing left to buy it.
    expect(game.swing(FIGHTER)).toBe('no_attacks_left');
  });

  it('caps a hasted and slowed fighter at one swing in each action', () => {
    const game = new Game().cast('haste', FIGHTER).cast('slow', FIGHTER, FOE).until(FIGHTER);

    expect(game.swing(FIGHTER)).toBeNull();
    expect(game.left).toBe(0);
    // Slow couples the action and the Bonus Action, and Haste's extra is an
    // action of its own that the coupling does not close — the note on
    // `refuseForeclosed` says exactly this — so the second swing comes out of
    // Haste's action and is its one attack.
    expect(game.swing(FIGHTER)).toBeNull();
    expect(game.left).toBe(0);
    expect(game.swing(FIGHTER)).toBe('no_attacks_left');
  });
});

describe('the vocabulary holds the two numbers apart', () => {
  it('refuses a cap of nothing on either field', () => {
    const problems = (rule: unknown): readonly string[] => {
      const found: { readonly field: string; readonly code: string; readonly reason: string }[] = [];
      // The validator is the engine's own, shared by the spell and the feature
      // books; this is the same call `checkSpellDefinition` makes.
      checkActionRule(rule as never, 'rule', found as never);
      return found.map((one) => one.reason);
    };

    expect(problems({ kind: 'caps-attacks', attacks: 0 }).join(' ')).toContain('at least one');
    expect(problems({ kind: 'caps-attacks', attacks: 1 })).toEqual([]);
    expect(
      problems({ kind: 'grants', at: 'each-turn', only: ['dash'], attacksCap: 1 }).join(' '),
    ).toContain('read by nothing');
  });

  /** And a Dodge is still a Dodge: the cap says nothing about any other action. */
  it('leaves every other action alone', () => {
    const game = new Game().cast('slow', FIGHTER).until(FIGHTER);
    expect(takeDodge(game.state, FIGHTER, {}).ok).toBe(true);
  });
});
