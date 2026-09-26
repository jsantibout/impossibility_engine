/**
 * SRD Shining Smite: "Until the spell ends, the target sheds Bright Light in a
 * 5-foot radius, attack rolls against it have Advantage, and it can't benefit
 * from the Invisible condition."
 *
 * **Three sentences that were all sayable, and a host that could not say any of
 * them.** A `light` rider hangs a glow on a creature; a `mode` rider with
 * `relation: 'against-holder'` *is* "attack rolls against it have Advantage",
 * written as a grant on the creature that every attacker reads; and `benefit`
 * withholds what a condition gives while leaving the condition where it is. What
 * this spell had no way to reach them with was the `attack-damage` kind: a smite
 * is cast in the window a hit opens, so the creature the sentences are about is
 * the one the blow landed on, and nothing in the request names them.
 *
 * So the kind carries `riders` now, applied to the creature `keptRunning` has
 * just written onto the record as `aimed`, in the world that record and its
 * deadline exist in — which is what lets every door that ends the casting take
 * all three away in one breath.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, type CharacterId, type Result } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, restoreRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { spellSlotKey } from './resources.js';
import { declaredCasting } from './spellcasting.js';
import { benefitsFrom } from './conditions.js';
import { lightAt } from './positioning.js';
import { effectiveConditions } from './standing.js';
import {
  advanceTime,
  applyConditionTo,
  endCombat,
  endConcentration,
  resolveAttack,
  resolveAttackDamage,
  resolveTurn,
} from './commands.js';

const id = (s: string) => asCharacterId(s);
const PALADIN = id('paladin');
const ROGUE = id('rogue');
const GOBLIN = id('goblin');

const sheet = (): CharacterSheet => ({
  level: 5,
  abilities: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 16 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'cha',
  weaponProficiencies: ['simple', 'martial'],
});

const added = (who: CharacterId): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 200,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side: who === GOBLIN ? 'goblins' : 'party',
});

const AT = { x: 100, y: 100, z: 0 } as const;

const SETUP: readonly GameEvent[] = [
  added(PALADIN),
  added(ROGUE),
  added(GOBLIN),
  {
    type: 'spellcasting-declared',
    id: PALADIN,
    spellcasting: declaredCasting({ ability: 'cha', prepared: ['shining-smite'] }),
  },
  ...[1, 2, 3].map(
    (level): GameEvent => ({
      type: 'resource-pool-declared',
      id: PALADIN,
      pool: { key: spellSlotKey(level), label: `level ${level}`, max: 4, recovers: 'long-rest' },
    }),
  ),
  ...[PALADIN, ROGUE].flatMap((who): readonly GameEvent[] => [
    { type: 'items-gained', id: who, items: [{ id: 'longsword', quantity: 1 }], source: 'the kit' },
    { type: 'item-equipped', id: who, item: 'longsword', armor: null },
  ]),
  { type: 'scene-set', extent: { width: 300, depth: 300, height: 40 } },
  { type: 'landmark-added', name: 'the bridge', at: AT },
  { type: 'creature-placed', id: GOBLIN, placement: { from: { landmark: 'the bridge' }, feet: 0 } },
  { type: 'creature-placed', id: PALADIN, placement: { from: { creature: GOBLIN }, feet: 5, bearing: 0 } },
  { type: 'creature-placed', id: ROGUE, placement: { from: { creature: GOBLIN }, feet: 5, bearing: 180 } },
  ...[PALADIN, ROGUE].flatMap((who): readonly GameEvent[] => [
    { type: 'sight-declared', from: who, to: GOBLIN, seen: true },
    { type: 'sight-declared', from: GOBLIN, to: who, seen: true },
  ]),
  {
    type: 'combat-started',
    combatants: [
      { id: PALADIN, initiative: 20, speed: 30 },
      { id: ROGUE, initiative: 15, speed: 30 },
      { id: GOBLIN, initiative: 10, speed: 30 },
    ],
  },
];

const supply = (state: GameState) => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: (state.rng === null ? createRng('shine') : restoreRng(state.rng)) as Rng,
  content: SRD_CONTENT,
});

const must = <T,>(result: Result<T>): T => unwrap(result, 'the smite');

class Fight {
  readonly events: GameEvent[] = [...SETUP];

  get state(): GameState {
    return fold('shine', this.events);
  }

  push(more: readonly GameEvent[]): this {
    this.events.push(...more);
    return this;
  }

  /** A swing held open, then settled with the smite cast into the window. */
  smite(slotLevel = 2): this {
    const hit = must(
      resolveAttack(
        this.state,
        PALADIN,
        {
          target: GOBLIN,
          weapon: 'longsword',
          hold: true,
          attackBonuses: [{ source: 'the test insists', flat: 40 }],
        },
        supply(this.state),
      ),
    );
    this.push(hit.events);
    const settled = must(
      resolveAttackDamage(
        this.state,
        PALADIN,
        { smite: { spellId: 'shining-smite', slotLevel } },
        supply(this.state),
      ),
    );
    return this.push(settled.events);
  }

  /** The goblin turns Invisible, by a ruling rather than by a spell. */
  vanish(): this {
    return this.push(
      must(
        applyConditionTo(this.state, GOBLIN, 'invisible', 'ruling:the mists', [], undefined, undefined, {
          commandId: 'vanish',
        }),
      ),
    );
  }

  /** Advance the order until it is this creature's turn. */
  until(who: CharacterId): this {
    for (let guard = 0; guard < 12; guard += 1) {
      const combat = this.state.combat;
      if (combat !== null && combat.order[combat.turnIndex]?.id === who) return this;
      this.push(must(resolveTurn(this.state, supply(this.state))).events);
    }
    throw new Error(`the order never reached ${who}`);
  }

  /** The rogue's swing at the goblin, on the rogue's own turn. */
  rogueSwing(): string {
    this.until(ROGUE);
    const out = must(
      resolveAttack(this.state, ROGUE, { target: GOBLIN, weapon: 'longsword' }, supply(this.state)),
    );
    return out.attack!.roll.mode;
  }

  /** The fight over, so the clock may be declared rather than derived. */
  quiet(): this {
    return this.push(must(endCombat(this.state, { kind: 'surrender', side: 'goblins' })));
  }
}

describe('SRD Shining Smite: what the casting leaves on the creature it struck', () => {
  it('lights the goblin up, five feet of Bright Light', () => {
    const dark = new Fight();
    // Nobody has said anything about the light on this bridge.
    expect(lightAt(dark.state, AT).level).toBeNull();

    dark.smite();
    expect(lightAt(dark.state, AT).level).toBe('bright');
    // Five feet of radius and no more: the space beyond it is unsaid again.
    expect(lightAt(dark.state, { x: 115, y: 100, z: 0 }).level).toBeNull();
  });

  it('gives every attacker Advantage against it', () => {
    // Two fights, because the paladin's smite is cast on the paladin's turn and
    // the rogue swings on the rogue's: one order cannot hold both readings.
    expect(new Fight().rogueSwing()).toBe('normal');
    expect(new Fight().smite().rogueSwing()).toBe('advantage');
  });

  it('leaves the goblin Invisible and lets it benefit from none of it', () => {
    const fight = new Fight().vanish();
    expect(benefitsFrom(effectiveConditions(fight.state, GOBLIN), 'invisible')).toBe(true);

    fight.smite();
    // The condition is still on the creature — this is neither a cure nor an
    // Immunity — and what it hands out is withheld.
    expect(fight.state.creatures[GOBLIN]!.conditions.conditions).toContain('invisible');
    expect(benefitsFrom(effectiveConditions(fight.state, GOBLIN), 'invisible')).toBe(false);
  });

  it('takes all three away when the Concentration goes', () => {
    const fight = new Fight().vanish().smite();
    fight.push(must(endConcentration(fight.state, PALADIN, 'voluntary')));

    expect(lightAt(fight.state, AT).level).toBeNull();
    // And the Advantage with them: the rogue swings at an ordinary goblin.
    expect(fight.rogueSwing()).toBe('normal');
    expect(benefitsFrom(effectiveConditions(fight.state, GOBLIN), 'invisible')).toBe(true);
  });

  it('takes all three away when the minute runs out', () => {
    const fight = new Fight().vanish().smite().quiet();
    fight.push(must(advanceTime(fight.state, 61, 'the minute')));

    expect(lightAt(fight.state, AT).level).toBeNull();
    expect(benefitsFrom(effectiveConditions(fight.state, GOBLIN), 'invisible')).toBe(true);
  });

  it('leaves the definition owing the table nothing', () => {
    expect(SRD_CONTENT.spell('shining-smite')?.unmodelled).toBeUndefined();
  });
});
