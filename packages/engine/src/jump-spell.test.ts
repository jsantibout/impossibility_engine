import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng } from './dice.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { spellSlotKey } from './resources.js';
import { createRollIssuer } from './rolls.js';
import { declaredCasting } from './spellcasting.js';
import type { Point } from './positioning.js';
import { endOngoingSpell, ongoingSpellOf, resolveMove, resolveSpell, resolveTurn } from './commands.js';

/**
 * A jump a spell bought, at a price the spell fixed.
 *
 * SRD *Jump*, whole: "You touch a willing creature. **Once on each of its
 * turns until the spell ends, that creature can jump up to 30 feet by spending
 * 10 feet of movement.**"
 *
 * Three claims in one sentence and no two of them are the same kind of thing:
 *
 * | Clause | What it changes |
 * |---|---|
 * | "up to 30 feet" | the **bound** on a declared Long Jump, beside the sheet's own |
 * | "by spending 10 feet of movement" | the **price**, which replaces what the ground came to |
 * | "once on each of its turns" | a cap stamped on the grant, counted only where there are turns |
 *
 * **The price is the half a multiplier could not have said**, and it is the
 * whole reason the 2014 wording would have needed different machinery: this
 * printing does not lengthen a jump the creature already had, it sells a fixed
 * one for a fixed number of feet. A Wizard with Strength 8 clears thirty feet
 * for ten, which is exactly what the spell is worth.
 */

const id = (s: string) => asCharacterId(s);
const DRUID = id('druid');
/** Strength 8: a standing Long Jump of four feet, a running one of eight. */
const WIZARD = id('wizard');
/** Strength 20: a running Long Jump of twenty feet under their own legs. */
const BARBARIAN = id('barbarian');

const sheet = (str: number): CharacterSheet => ({
  level: 5,
  abilities: { str, dex: 10, con: 14, int: 16, wis: 16, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'wis',
  weaponProficiencies: ['simple'],
});

const added = (who: CharacterId, str: number): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(str),
  maxHp: 40,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side: 'party',
});

const supply = (seed = 'jump') => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed),
  content: SRD_CONTENT,
});

/**
 * One lane, with the druid between the two creatures they touch.
 *
 * Jump's Range is Touch, so the caster stands next to both: the wizard jumps
 * west and the barbarian east, and no jump ever crosses anybody.
 */
const at = (x: number): Point => ({ x, y: 100, z: 0 });
const DRUID_AT = 300;
const WIZARD_AT = 295;
const BARBARIAN_AT = 305;

const place = (who: CharacterId, p: Point): GameEvent => ({
  type: 'creature-placed',
  id: who,
  placement: { from: { point: p }, feet: 0 },
});

const TABLE: readonly GameEvent[] = [
  added(DRUID, 12),
  added(WIZARD, 8),
  added(BARBARIAN, 20),
  {
    type: 'resource-pool-declared',
    id: DRUID,
    pool: { key: spellSlotKey(1), label: 'level 1 spell slot', max: 4, recovers: 'long-rest' },
  },
  {
    type: 'spellcasting-declared',
    id: DRUID,
    spellcasting: declaredCasting({ ability: 'wis', prepared: ['jump'] }),
  },
  { type: 'scene-set', extent: { width: 600, depth: 600, height: 100 } },
  place(DRUID, at(DRUID_AT)),
  place(WIZARD, at(WIZARD_AT)),
  place(BARBARIAN, at(BARBARIAN_AT)),
];

/** Speeds large enough that the price is the only thing under test. */
const FIGHT: readonly GameEvent[] = [
  {
    type: 'combat-started',
    combatants: [
      { id: WIZARD, initiative: 30, speed: 30 },
      { id: BARBARIAN, initiative: 20, speed: 30 },
      { id: DRUID, initiative: 10, speed: 30 },
    ],
  },
];

class Game {
  constructor(private readonly events: GameEvent[] = [...TABLE]) {}

  get state(): GameState {
    return fold('s', this.events);
  }

  get log(): readonly GameEvent[] {
    return this.events;
  }

  push(more: readonly GameEvent[]): this {
    this.events.push(...more);
    return this;
  }

  fight(): this {
    if (this.state.combat === null) this.push(FIGHT);
    return this;
  }

  /** The druid touches somebody. The spell is a Bonus Action, so it needs no turn. */
  cast(on: CharacterId = WIZARD): string {
    const out = unwrap(
      resolveSpell(this.state, DRUID, { spellId: 'jump', targets: [on], willing: [on] }, supply()),
      'casting Jump',
    );
    this.push(out.events);
    return out.castingId!;
  }

  to(who: CharacterId): this {
    this.fight();
    for (let n = 0; n < 12; n += 1) {
      const combat = this.state.combat;
      if (combat === null) return this;
      if (combat.order[combat.turnIndex]?.id === who) return this;
      this.push(unwrap(resolveTurn(this.state, supply(`to-${n}`)), 'advancing').events);
    }
    throw new Error(`never reached ${who}'s turn`);
  }

  /** A declared Long Jump to a point on the same lane. */
  leap(who: CharacterId, to: Point, options: { readonly running?: boolean } = {}) {
    return resolveMove(
      this.state,
      who,
      {
        placement: { from: { point: to }, feet: 0 },
        jump: { kind: 'long', ...(options.running === undefined ? {} : { running: options.running }) },
      },
      supply('leap'),
    );
  }

  leapt(who: CharacterId, to: Point, options: { readonly running?: boolean } = {}) {
    const out = unwrap(this.leap(who, to, options), `${who} jumping`);
    this.push(out.events);
    return out;
  }

  spent(who: CharacterId): number {
    return this.state.combat?.budgets[who]?.movementSpent ?? 0;
  }

  allowances(who: CharacterId) {
    return this.state.creatures[who]?.jumpAllowances ?? [];
  }
}

// — what the casting hangs ——————————————————————————————————————————————————

describe('the spell buys a jump rather than lengthening one', () => {
  it('hangs the book’s two numbers on the creature it touched', () => {
    const g = new Game();
    g.cast();
    expect(g.allowances(WIZARD).map(({ feet, costsMovement }) => ({ feet, costsMovement }))).toEqual(
      [{ feet: 30, costsMovement: 10 }],
    );
    expect(g.allowances(BARBARIAN)).toEqual([]);
  });

  it('takes it back when the casting ends', () => {
    const g = new Game();
    const casting = g.cast();
    expect(ongoingSpellOf(g.state, casting)).not.toBeNull();
    g.push(unwrap(endOngoingSpell(g.state, DRUID, casting, null), 'ending it'));
    expect(g.allowances(WIZARD)).toEqual([]);
  });

  /** And on the clock, which is the ending nobody has to remember. */
  it('takes it back when the minute runs out', () => {
    const g = new Game();
    g.cast();
    g.push([{ type: 'time-advanced', seconds: 60, reason: 'the minute' }]);
    expect(g.allowances(WIZARD)).toEqual([]);
  });
});

// — the bound —————————————————————————————————————————————————————————————————

describe('the distance the spell bounds', () => {
  /** Strength 8: a standing Long Jump covers four feet, so five is already too far. */
  it('refuses a thirty-foot jump the creature’s own legs cannot make', () => {
    const g = new Game();
    g.fight().to(WIZARD);
    const refused = g.leap(WIZARD, at(WIZARD_AT - 30));
    expect(isErr(refused) ? refused.code : 'ok').toBe('jump_too_far');
  });

  it('allows the same jump once the spell is on them', () => {
    const g = new Game();
    g.cast();
    g.fight().to(WIZARD);
    expect(g.leap(WIZARD, at(WIZARD_AT - 30)).ok).toBe(true);
  });

  /** "Up to 30 feet" is a bound and not a licence: thirty-five is still too far. */
  it('refuses a jump beyond the thirty feet the book prints', () => {
    const g = new Game();
    g.cast();
    g.fight().to(WIZARD);
    const refused = g.leap(WIZARD, at(WIZARD_AT - 35));
    expect(isErr(refused) ? refused.code : 'ok').toBe('jump_too_far');
  });

  /**
   * And the creature's own reach is not shortened by having the spell on it.
   * A Barbarian with a running Long Jump of twenty keeps it — the spell is a
   * second bound and the longer one wins.
   */
  it('leaves a longer jump of the creature’s own alone', () => {
    const g = new Game();
    g.cast(BARBARIAN);
    g.fight().to(BARBARIAN);
    // Ten feet of running start first, out of the turn's own thirty.
    g.push(
      unwrap(
        resolveMove(
          g.state,
          BARBARIAN,
          { placement: { from: { point: at(BARBARIAN_AT + 10) }, feet: 0 } },
          supply('run'),
        ),
        'the run-up',
      ).events,
    );
    expect(g.leap(BARBARIAN, at(BARBARIAN_AT + 30), { running: true }).ok).toBe(true);
    // And the allowance is untouched: a jump the creature could make on its
    // own must not quietly spend the once a turn the spell bought. Asserted
    // against a list that is *there* — `takenOnTurn` on an empty list is
    // undefined too, and would have passed for the wrong reason.
    g.leapt(BARBARIAN, at(BARBARIAN_AT + 30), { running: true });
    expect(g.allowances(BARBARIAN)).toHaveLength(1);
    expect(g.allowances(BARBARIAN)[0]?.takenOnTurn).toBeUndefined();
  });
});

// — the price —————————————————————————————————————————————————————————————————

describe('the ten feet the jump costs', () => {
  it('charges the spell’s price rather than the ground covered', () => {
    const g = new Game();
    g.cast();
    g.fight().to(WIZARD);
    g.leapt(WIZARD, at(WIZARD_AT - 30));
    expect(g.spent(WIZARD)).toBe(10);
  });

  /**
   * Which is the whole point: a thirty-foot jump paid for out of a Speed of 30
   * would have left nothing, and the spell leaves twenty feet of walking.
   */
  it('leaves the rest of the turn’s movement to walk with', () => {
    const g = new Game();
    g.cast();
    g.fight().to(WIZARD);
    g.leapt(WIZARD, at(WIZARD_AT - 30));
    expect(
      resolveMove(
        g.state,
        WIZARD,
        { placement: { from: { point: at(WIZARD_AT - 50) }, feet: 0 } },
        supply('walk'),
      ).ok,
    ).toBe(true);
  });

  /** An ordinary jump on the creature's own legs still costs what it covered. */
  it('charges an unbought jump the feet it covered', () => {
    const g = new Game();
    g.fight().to(BARBARIAN);
    g.leapt(BARBARIAN, at(BARBARIAN_AT + 10));
    expect(g.spent(BARBARIAN)).toBe(10);
    g.leapt(BARBARIAN, at(BARBARIAN_AT + 20));
    expect(g.spent(BARBARIAN)).toBe(20);
  });
});

// — the cap ———————————————————————————————————————————————————————————————————

describe('once on each of its turns', () => {
  it('refuses a second bought jump on the same turn, and says why', () => {
    const g = new Game();
    g.cast();
    g.fight().to(WIZARD);
    g.leapt(WIZARD, at(WIZARD_AT - 30));
    const refused = g.leap(WIZARD, at(WIZARD_AT - 60));
    expect(isErr(refused) ? refused.code : 'ok').toBe('jump_too_far');
    // **The reason names the spell, not only the legs.** A refusal that said
    // nothing but "your standing Long Jump covers 4 feet" would hide the thirty
    // the caster paid a slot for, and the once a turn they have just spent.
    expect(isErr(refused) ? refused.reason : '').toContain(
      'reaches 30 feet and has already been taken this turn',
    );
  });

  it('records which turn it was taken on', () => {
    const g = new Game();
    g.cast();
    g.fight().to(WIZARD);
    g.leapt(WIZARD, at(WIZARD_AT - 30));
    expect(g.allowances(WIZARD)[0]?.takenOnTurn).toBe(g.state.combat?.turnsTaken);
  });

  it('gives it back on the creature’s next turn', () => {
    const g = new Game();
    g.cast();
    g.fight().to(WIZARD);
    g.leapt(WIZARD, at(WIZARD_AT - 30));
    // Round the order all the way back to the wizard, who is now standing
    // thirty feet west; the next jump is measured from there. The first
    // advance is forced, because `to` stops the moment it is already this
    // creature's turn.
    g.push(unwrap(resolveTurn(g.state, supply('ends')), 'ending the turn').events);
    g.to(WIZARD);
    const again = g.leap(WIZARD, at(WIZARD_AT - 60));
    expect(isErr(again) ? `${again.code}: ${again.reason}` : 'ok').toBe('ok');
  });

  /**
   * Outside a fight there is no turn to count, so nothing is capped — the
   * reading every once-per-turn rule in this engine takes, and the one that
   * keeps a spell from being unusable at a table that has not rolled
   * Initiative.
   */
  it('counts nothing outside a fight', () => {
    const g = new Game();
    g.cast();
    g.leapt(WIZARD, at(WIZARD_AT - 30));
    expect(g.allowances(WIZARD)[0]?.takenOnTurn).toBeUndefined();
    expect(g.leap(WIZARD, at(WIZARD_AT - 60)).ok).toBe(true);
  });
});

// — and it folds ——————————————————————————————————————————————————————————————

describe('the whole spell, end to end through the public API', () => {
  it('folds to the same state from the log alone', () => {
    const g = new Game();
    g.cast();
    g.fight().to(WIZARD);
    g.leapt(WIZARD, at(WIZARD_AT - 30));
    expect(fold('s', JSON.parse(JSON.stringify(g.log)) as GameEvent[])).toEqual(g.state);
    for (let n = 0; n <= g.log.length; n += 1) {
      expect(() => fold('s', g.log.slice(0, n))).not.toThrow();
    }
  });
});
