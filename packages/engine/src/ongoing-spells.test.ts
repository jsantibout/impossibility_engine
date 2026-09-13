import { describe, expect, it } from 'vitest';
import { asCharacterId, isErr, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { declaredCasting } from './spellcasting.js';
import { remaining } from './resources.js';
import {
  activateSpell,
  ongoingSpellOf,
  ongoingSpellsBy,
  ongoingSpellsOn,
  releaseReady,
  removeCreatureEverywhere,
  resolveSpell,
  resolveTest,
  resolveTurn,
  takeReady,
} from './commands.js';

/**
 * A casting that is still running, and the mechanics that name it later.
 *
 * The engine has always given a casting an identity and used it to link the
 * conditions and bonuses that casting created. What it never had was the other
 * half: a live record saying **which castings are still running, on whom, and
 * at what level.** Without it three SRD sentences are unwritable.
 *
 * | Sentence | What it needs |
 * |---|---|
 * | Dispel Magic: "any ongoing spell of level 3 or lower **on the target**" | which spells are on a creature, and their level |
 * | Vampiric Touch: "you can make the attack again on each of your turns" | the casting, its caster, and the level it was cast at |
 * | Mage Hand: "the hand vanishes ... if you cast this spell again" | the caster's own prior casting of that spell |
 *
 * **History and live state are not the same thing**, and this file is careful
 * about the difference. The log holds the casting for ever — which slot, which
 * action, at what moment. `state.ongoing` holds only the handful of facts a
 * later rule has to be able to ask, and it disappears the instant the spell
 * does. A test below checks both halves of that at once: the record goes and
 * the `spell-cast` event stays.
 */

const id = (s: string) => asCharacterId(s);
const WIZ = id('wiz'); // the caster under test
const RIVAL = id('rival'); // a second caster, so instances stay apart
const ALLY = id('ally');
const FOE = id('foe');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 9,
  abilities: { str: 10, dex: 14, con: 12, int: 18, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
  weaponProficiencies: ['simple'],
  ...over,
});

const PREPARED = [
  'bless',
  'banishment',
  'dispel-magic',
  'vampiric-touch',
  'flame-blade',
  // Flame Blade's shape at cantrip level — see the block at the end of this
  // file. A cantrip sits in this list exactly as Fire Bolt does.
  'produce-flame',
  'minor-illusion',
  'mage-hand',
  'hold-person',
  'fire-bolt',
];

const added = (who: CharacterId, side: string, over: Partial<CharacterSheet> = {}): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(over),
  maxHp: 80,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side,
});

const casts = (who: CharacterId): readonly GameEvent[] => [
  {
    type: 'spellcasting-declared',
    id: who,
    spellcasting: declaredCasting({ ability: 'int', prepared: PREPARED }),
  },
  ...[1, 2, 3, 4, 5].map(
    (level): GameEvent => ({
      type: 'resource-pool-declared',
      id: who,
      pool: { key: `spell-slot:${level}`, label: `level ${level}`, max: 4, recovers: 'long-rest' },
    }),
  ),
];

const supply = (seed = 'cast') => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
});

const SETUP: readonly GameEvent[] = [
  added(WIZ, 'party'),
  added(RIVAL, 'party'),
  added(ALLY, 'party'),
  added(FOE, 'foes'),
  ...casts(WIZ),
  ...casts(RIVAL),
  { type: 'scene-set', extent: { width: 600, depth: 600, height: 40 } },
  { type: 'landmark-added', name: 'the hall', at: { x: 200, y: 200, z: 0 } },
  { type: 'creature-placed', id: WIZ, placement: { from: { landmark: 'the hall' }, feet: 0 } },
  { type: 'creature-placed', id: RIVAL, placement: { from: { creature: WIZ }, feet: 5, bearing: 90 } },
  { type: 'creature-placed', id: ALLY, placement: { from: { creature: WIZ }, feet: 5, bearing: 180 } },
  { type: 'creature-placed', id: FOE, placement: { from: { creature: WIZ }, feet: 5, bearing: 0 } },
  { type: 'sight-declared', from: WIZ, to: FOE, seen: true },
  { type: 'sight-declared', from: WIZ, to: ALLY, seen: true },
  { type: 'sight-declared', from: RIVAL, to: FOE, seen: true },
];

/** A log that folds, with the helpers every test here wants. */
class Game {
  constructor(private readonly events: GameEvent[] = [...SETUP]) {}

  get state(): GameState {
    return fold('seed', this.events);
  }

  get log(): readonly GameEvent[] {
    return this.events;
  }

  push(more: readonly GameEvent[]): this {
    this.events.push(...more);
    return this;
  }

  /** Cast, fold, and hand back the casting id it produced. */
  cast(
    who: CharacterId,
    spellId: string,
    targets: readonly CharacterId[],
    slotLevel?: number,
    seed = spellId,
  ): string {
    const out = unwrap(
      resolveSpell(
        this.state,
        who,
        {
          spellId,
          targets,
          ...(slotLevel === undefined ? {} : { slotLevel }),
        },
        supply(seed),
      ),
      `${who} casting ${spellId}`,
    );
    this.push(out.events);
    return out.castingId;
  }

  hp(who: CharacterId): number {
    const creature = this.state.creatures[who];
    if (creature === undefined) throw new Error(`${who} is not in the game`);
    return creature.vitals.hp;
  }

  left(who: CharacterId, key: string): number {
    const creature = this.state.creatures[who];
    if (creature === undefined) throw new Error(`${who} is not in the game`);
    return remaining(creature.resources, key);
  }

  /** Fold every prefix, so a partially written log is never a special case. */
  foldsAtEveryPrefix(): void {
    for (let n = 0; n <= this.events.length; n += 1) {
      expect(() => fold('seed', this.events.slice(0, n))).not.toThrow();
    }
  }
}

const roundTrip = (log: readonly GameEvent[]): GameState =>
  fold('seed', JSON.parse(JSON.stringify(log)) as GameEvent[]);

// — what becomes live, and what does not ——————————————————————————————————————

describe('a casting becomes a live record when it leaves something running', () => {
  it('records a spell with a duration, and nothing for an Instantaneous one', () => {
    const g = new Game();
    const bless = g.cast(WIZ, 'bless', [ALLY]);
    expect(ongoingSpellOf(g.state, bless)?.spell).toBe('Bless');

    g.cast(WIZ, 'fire-bolt', [FOE]);
    // Fire Bolt is over the moment it lands; the only record is the Bless.
    expect(Object.keys(g.state.ongoing)).toEqual([bless]);
  });

  /**
   * The reason the record exists at all. Dispel Magic reads a spell's level,
   * and before this the level lived in the log and on a **concentrating**
   * caster — so a spell whose caster was not concentrating had no live level
   * anywhere.
   */
  it('pins the level it was cast at, not the level the spell prints', () => {
    const g = new Game();
    const upcast = g.cast(WIZ, 'bless', [ALLY], 4);
    expect(ongoingSpellOf(g.state, upcast)?.level).toBe(4);
  });

  /**
   * Range decides what a spell is *on*, not the list of creatures its effects
   * reached. Vampiric Touch is Range: Self and punches somebody else.
   */
  it('puts a Range: Self spell on its caster and a ranged one on its targets', () => {
    const g = new Game();
    const drain = g.cast(WIZ, 'vampiric-touch', [FOE], 3);
    expect(ongoingSpellOf(g.state, drain)?.on).toEqual([WIZ]);
    expect(ongoingSpellsOn(g.state, FOE)).toEqual([]);

    const bless = g.cast(WIZ, 'bless', [ALLY, FOE], 1);
    expect(ongoingSpellOf(g.state, bless)?.on).toEqual([ALLY, FOE]);
  });

  /** Two castings of one spell are two things, and nothing merges them. */
  it('keeps two simultaneous castings of the same spell apart', () => {
    const g = new Game();
    const first = g.cast(WIZ, 'minor-illusion', []);
    const second = g.cast(RIVAL, 'minor-illusion', []);

    expect(first).not.toBe(second);
    expect(ongoingSpellOf(g.state, first)?.caster).toBe(WIZ);
    expect(ongoingSpellOf(g.state, second)?.caster).toBe(RIVAL);
    expect(ongoingSpellsBy(g.state, WIZ).map((o) => o.castingId)).toEqual([first]);
    expect(ongoingSpellsBy(g.state, RIVAL).map((o) => o.castingId)).toEqual([second]);
  });

  /** And two casters' Blesses on the same creature stay two Blesses. */
  it('keeps two casters instances apart on one target', () => {
    const g = new Game();
    const mine = g.cast(WIZ, 'bless', [ALLY], 1, 'mine');
    const theirs = g.cast(RIVAL, 'bless', [ALLY], 1, 'theirs');

    expect(ongoingSpellsOn(g.state, ALLY).map((o) => o.castingId)).toEqual([mine, theirs]);
  });

  /**
   * A spell is on whom it **caught**, not whom it was aimed at.
   *
   * SRD Banishment on a creature that succeeds on its save does nothing to
   * that creature, and a record claiming otherwise would let Dispel Magic end
   * a spell that was never on them — reporting a hit where there was none.
   *
   * Two seeds, and the fixture picks by outcome rather than by hope: whichever
   * of them the target saved against is the one that must be on nobody.
   */
  it('is on the creatures it caught, not the ones it missed', () => {
    const runs = ['b1', 'b2', 'b3', 'b4', 'b5', 'b6'].map((seed) => {
      const g = new Game();
      const ban = g.cast(WIZ, 'banishment', [FOE], 4, seed);
      return { saved: ongoingSpellOf(g.state, ban)?.on.length === 0, g, ban };
    });

    const missed = runs.find((r) => r.saved);
    const landed = runs.find((r) => !r.saved);
    expect(missed, 'no seed produced a successful save').toBeDefined();
    expect(landed, 'no seed produced a failed save').toBeDefined();

    // The one that landed is on the target and dispellable through them; the
    // one that missed is on nobody and cannot be reached that way at all.
    expect(ongoingSpellsOn(landed!.g.state, FOE).map((o) => o.castingId)).toEqual([landed!.ban]);
    expect(ongoingSpellsOn(missed!.g.state, FOE)).toEqual([]);
    // And the casting is still running either way: the Wizard is concentrating.
    expect(ongoingSpellOf(missed!.g.state, missed!.ban)).not.toBeNull();
  });

  /** The queries are pure: asking changes nothing. */
  it('answers about a casting that never existed with null', () => {
    expect(ongoingSpellOf(new Game().state, 'cast:99')).toBeNull();
  });
});

// — lifecycle —————————————————————————————————————————————————————————————————

describe('the record lives exactly as long as the spell', () => {
  /**
   * The one place a record is removed is the one place a casting ends, so
   * there cannot be a route by which a finished spell stays queryable.
   */
  it('goes when Concentration goes, and takes only its own with it', () => {
    const g = new Game();
    const mine = g.cast(WIZ, 'bless', [ALLY], 1, 'mine');
    const theirs = g.cast(RIVAL, 'bless', [ALLY], 1, 'theirs');

    // The Wizard is Stunned, so Concentration is lost — derived, not commanded.
    g.push([
      { type: 'condition-applied', id: WIZ, condition: 'stunned', source: 'a blow' },
    ]);

    expect(ongoingSpellOf(g.state, mine)).toBeNull();
    expect(ongoingSpellOf(g.state, theirs)?.caster).toBe(RIVAL);
    // And the bonus it hung went with it, while the rival's stayed.
    expect(g.state.creatures[ALLY]?.bonuses).toHaveLength(1);
  });

  /**
   * The exact boundary. Bless runs 60 seconds: it is still there at 59 and
   * gone at 60, and a test that only checked "much later" would pass with the
   * comparison off by one in either direction.
   */
  it('goes when the deadline arrives, and not one second early', () => {
    const before = new Game();
    const bless = before.cast(WIZ, 'bless', [ALLY], 1);
    before.push([{ type: 'time-advanced', seconds: 59, reason: 'a search' }]);
    expect(ongoingSpellOf(before.state, bless)).not.toBeNull();

    before.push([{ type: 'time-advanced', seconds: 1, reason: 'one more' }]);
    expect(ongoingSpellOf(before.state, bless)).toBeNull();
  });

  /** Expiry ends only what expired. */
  it('expires one casting and leaves a longer one running', () => {
    const g = new Game();
    const bless = g.cast(WIZ, 'bless', [ALLY], 1, 'bless');
    const blade = g.cast(RIVAL, 'flame-blade', [], 2, 'blade');

    // Bless is a minute; Flame Blade is ten.
    g.push([{ type: 'time-advanced', seconds: 61, reason: 'a while' }]);
    expect(ongoingSpellOf(g.state, bless)).toBeNull();
    expect(ongoingSpellOf(g.state, blade)).not.toBeNull();
  });

  /**
   * A creature that shakes the spell off leaves `on` while the casting runs
   * for everyone else. Dispel Magic reads that list, so a stale name in it
   * would let somebody dispel a spell that is no longer on them.
   */
  it('drops a released target from the list and keeps the casting', () => {
    const g = new Game();
    const bless = g.cast(WIZ, 'bless', [ALLY, FOE], 1);
    expect(ongoingSpellOf(g.state, bless)?.on).toEqual([ALLY, FOE]);

    g.push([{ type: 'spell-ended', castingId: bless, on: FOE, reason: 'dispelled' }]);
    expect(ongoingSpellOf(g.state, bless)?.on).toEqual([ALLY]);
    expect(ongoingSpellsOn(g.state, FOE)).toEqual([]);
    expect(ongoingSpellsOn(g.state, ALLY).map((o) => o.castingId)).toEqual([bless]);
  });

  /** A creature leaving the game leaves every list it was on. */
  it('drops a departing creature from every spell it was under', () => {
    const g = new Game();
    const bless = g.cast(WIZ, 'bless', [ALLY, FOE], 1);
    g.push(unwrap(removeCreatureEverywhere(g.state, FOE), 'remove'));

    expect(ongoingSpellOf(g.state, bless)?.on).toEqual([ALLY]);
  });

  /**
   * History outlives live state, which is the distinction this whole record
   * exists to respect: the log is what happened, `ongoing` is what is still
   * happening, and ending the second must not touch the first.
   */
  it('keeps the casting in the log after the live record has gone', () => {
    const g = new Game();
    const bless = g.cast(WIZ, 'bless', [ALLY], 1);
    g.push([{ type: 'time-advanced', seconds: 61, reason: 'a while' }]);

    expect(ongoingSpellOf(g.state, bless)).toBeNull();
    // The slot is still spent, the casting is still in the log, and the
    // counter still knows it happened.
    expect(g.log.some((e) => e.type === 'spell-cast' && e.castingId === bless)).toBe(true);
    expect(g.state.castingsBegun).toBe(1);
    expect(g.left(WIZ, 'spell-slot:1')).toBe(3);
  });

  /** No zombies: nothing survives its casting by any route. */
  it('leaves no record standing once every spell has ended', () => {
    const g = new Game();
    g.cast(WIZ, 'bless', [ALLY], 1, 'a');
    g.cast(RIVAL, 'banishment', [FOE], 4, 'b');
    expect(Object.keys(g.state.ongoing)).toHaveLength(2);

    g.push([{ type: 'time-advanced', seconds: 61, reason: 'a minute' }]);
    expect(g.state.ongoing).toEqual({});
  });

  /** A log that claims a spell nobody cast is corrupt, loudly. */
  it('refuses a record for a casting that never happened', () => {
    const g = new Game();
    expect(() =>
      fold('seed', [
        ...g.log,
        {
          type: 'spell-ongoing',
          casting: {
            castingId: 'cast:7',
            caster: WIZ,
            spellId: 'bless',
            spell: 'Bless',
            level: 1,
            concentration: true,
            route: null,
            numbers: { saveDc: 15, attackModifier: 7, spellcastingModifier: 4, casterLevel: 9 },
            on: [ALLY],
          },
        },
      ]),
    ).toThrow();
  });

  /** And one that ends a spell twice. */
  it('refuses a log that ends the same casting twice', () => {
    const g = new Game();
    const bless = g.cast(WIZ, 'bless', [ALLY], 1);
    const ended: GameEvent = { type: 'spell-ended', castingId: bless, on: null, reason: 'dispelled' };
    expect(() => fold('seed', [...g.log, ended, ended])).toThrow();
  });
});

// — Dispel Magic ——————————————————————————————————————————————————————————————

describe('Dispel Magic', () => {
  const dispel = (g: Game, target: CharacterId, slotLevel = 3, seed = 'dispel') =>
    resolveSpell(
      g.state,
      RIVAL,
      { spellId: 'dispel-magic', targets: [target], slotLevel },
      supply(seed),
    );

  /**
   * SRD: "Any ongoing spell of level 3 or lower on the target ends." **No
   * check at all** below the threshold — the 2014 habit of rolling for
   * everything is a different spell.
   */
  it('ends a spell at or below the slot level with no check', () => {
    const g = new Game();
    const bless = g.cast(WIZ, 'bless', [ALLY], 1);

    const out = unwrap(dispel(g, ALLY), 'dispel');
    expect(out.events.some((e) => e.type === 'roll-recorded' && e.label.includes('Bless'))).toBe(
      false,
    );
    g.push(out.events);
    expect(ongoingSpellOf(g.state, bless)).toBeNull();
    expect(out.outcomes[0]?.dispelled).toBe(bless);
  });

  /**
   * SRD: "For each ongoing spell of level 4 or higher on the target, make an
   * ability check using your spellcasting ability (DC 10 plus that spell's
   * level)."
   */
  it('rolls an ability check against DC 10 plus the spell level', () => {
    const g = new Game();
    g.cast(WIZ, 'banishment', [FOE], 4);

    const out = unwrap(dispel(g, FOE), 'dispel');
    const roll = out.outcomes[0]?.check;
    expect(roll?.dc).toBe(14);
    expect(roll?.kind).toBe('ability-check');
    // A bare Intelligence check: the modifier is the ability and nothing else.
    expect(roll?.modifier).toBe(4);
  });

  /** A success ends it; a failure changes nothing whatever. */
  it('ends the spell on a success and leaves it running on a failure', () => {
    // The same casting, dispelled with two seeds — one roll clears DC 14 and
    // the other does not, and the *outcome* decides, not the test.
    const results = ['s1', 's2', 's3', 's4', 's5', 's6'].map((seed) => {
      const g = new Game();
      const ban = g.cast(WIZ, 'banishment', [FOE], 4);
      const out = unwrap(dispel(g, FOE, 3, seed), 'dispel');
      g.push(out.events);
      return {
        success: out.outcomes[0]?.check?.success ?? false,
        running: ongoingSpellOf(g.state, ban) !== null,
      };
    });

    expect(results.some((r) => r.success)).toBe(true);
    expect(results.some((r) => !r.success)).toBe(true);
    for (const r of results) expect(r.running).toBe(!r.success);
  });

  /**
   * SRD "Using a Higher-Level Spell Slot": "You automatically end a spell on
   * the target if the spell's level is equal to or less than the level of the
   * spell slot you use."
   */
  it('ends a level 4 spell without a check when cast from a level 4 slot', () => {
    const g = new Game();
    const ban = g.cast(WIZ, 'banishment', [FOE], 4);

    const out = unwrap(dispel(g, FOE, 4), 'dispel');
    expect(out.outcomes[0]?.check).toBeUndefined();
    g.push(out.events);
    expect(ongoingSpellOf(g.state, ban)).toBeNull();
  });

  /** The level comes from the casting, not from the spell's printed level. */
  it('reads the level the spell was cast at, not the one it prints', () => {
    const g = new Game();
    // Bless is level 1, cast from a level 5 slot. Dispel Magic at 3 must roll.
    g.cast(WIZ, 'bless', [ALLY], 5);
    const out = unwrap(dispel(g, ALLY), 'dispel');
    expect(out.outcomes[0]?.check?.dc).toBe(15);
  });

  /** It ends what is on the target and nothing else. */
  it('leaves a spell on somebody else alone', () => {
    const g = new Game();
    const onAlly = g.cast(WIZ, 'bless', [ALLY], 1, 'a');
    const onFoe = g.cast(RIVAL, 'bless', [FOE], 1, 'b');

    g.push(unwrap(dispel(g, ALLY), 'dispel').events);
    expect(ongoingSpellOf(g.state, onAlly)).toBeNull();
    expect(ongoingSpellOf(g.state, onFoe)).not.toBeNull();
  });

  /**
   * Two identical castings on one creature. Ending "Bless" by name would end
   * both; ending the casting ends one, which is the whole reason a casting has
   * an identity.
   */
  it('ends one of two identical castings on the same creature', () => {
    const g = new Game();
    const mine = g.cast(WIZ, 'bless', [ALLY], 1, 'mine');
    const theirs = g.cast(RIVAL, 'bless', [ALLY], 1, 'theirs');
    expect(ongoingSpellsOn(g.state, ALLY)).toHaveLength(2);

    // Dispel Magic walks the list in casting order and ends both, one at a
    // time — but each is ended by its own id, and the log says which.
    const out = unwrap(dispel(g, ALLY), 'dispel');
    const ended = out.events.filter((e) => e.type === 'spell-ended').map((e) => e.castingId);
    expect(ended).toEqual([mine, theirs]);
  });

  /**
   * A multi-target spell loses only the creature that was dispelled — which is
   * the distinction SRD draws by letting Dispel Magic target "one creature,
   * object, or **magical effect**".
   */
  it('releases a multi-target spell on the target and leaves it running', () => {
    const g = new Game();
    const bless = g.cast(WIZ, 'bless', [ALLY, FOE], 1);

    g.push(unwrap(dispel(g, FOE), 'dispel').events);
    expect(ongoingSpellOf(g.state, bless)?.on).toEqual([ALLY]);
    // And the ally still has the bonus the spell hung on them.
    expect(g.state.creatures[ALLY]?.bonuses).toHaveLength(1);
    expect(g.state.creatures[FOE]?.bonuses).toEqual([]);
  });

  /** Nothing on the target is a legal cast that does nothing. */
  it('is cast and does nothing when no spell is on the target', () => {
    const g = new Game();
    const out = unwrap(dispel(g, FOE), 'dispel');
    expect(out.outcomes[0]?.affected).toBe(false);
    g.push(out.events);
    // The slot still went: SRD spends it on the attempt.
    expect(g.left(RIVAL, 'spell-slot:3')).toBe(3);
  });

  /** A spell that has already ended cannot be dispelled a second time. */
  it('cannot end a spell that has already ended', () => {
    const g = new Game();
    const bless = g.cast(WIZ, 'bless', [ALLY], 1);
    g.push(unwrap(dispel(g, ALLY, 3, 'first'), 'first').events);
    expect(ongoingSpellOf(g.state, bless)).toBeNull();

    const again = unwrap(dispel(g, ALLY, 3, 'second'), 'second');
    expect(again.events.some((e) => e.type === 'spell-ended')).toBe(false);
    expect(again.outcomes[0]?.affected).toBe(false);
  });

  /** And a retry does not roll a second check. */
  it('does not reroll on a retry', () => {
    const g = new Game();
    g.cast(WIZ, 'banishment', [FOE], 4);

    const first = unwrap(
      resolveSpell(
        g.state,
        RIVAL,
        { spellId: 'dispel-magic', targets: [FOE], slotLevel: 3, commandId: 'd1' },
        supply('retry'),
      ),
      'first',
    );
    g.push(first.events);
    const after = g.state;

    const retry = unwrap(
      resolveSpell(
        g.state,
        RIVAL,
        { spellId: 'dispel-magic', targets: [FOE], slotLevel: 3, commandId: 'd1' },
        supply('retry'),
      ),
      'retry',
    );
    expect(retry.events).toEqual([]);
    expect(fold('seed', [...g.log, ...retry.events])).toEqual(after);
  });
});

// — acting through a spell on a later turn ————————————————————————————————————

describe('activating an ongoing spell', () => {
  /** In combat, so there is an economy for the Magic action to come out of. */
  const fighting = (): GameEvent[] => [
    {
      type: 'combat-started',
      combatants: [
        { id: WIZ, initiative: 20, speed: 30 },
        { id: FOE, initiative: 10, speed: 30 },
        { id: RIVAL, initiative: 5, speed: 30 },
      ],
    },
  ];

  /** Round the Initiative order back to the caster, with a fresh Action. */
  const comeRound = (g: Game): Game => {
    for (let n = 0; n < 3; n += 1) g.push(unwrap(resolveTurn(g.state, supply()), 'turn').events);
    return g;
  };

  const drained = (seed = 'drain', slotLevel = 3): { g: Game; castingId: string } => {
    const g = new Game();
    g.push(fighting());
    const castingId = g.cast(WIZ, 'vampiric-touch', [FOE], slotLevel, seed);
    // The casting itself was the Action; acting through it needs another turn.
    comeRound(g);
    return { g, castingId };
  };

  /**
   * SRD Vampiric Touch: "Until the spell ends, you can make the attack again
   * on each of your turns as a Magic action."
   */
  it('spends the Action and strikes again', () => {
    const { g, castingId } = drained();
    expect(g.state.combat?.budgets[WIZ]?.action).toBe(true);

    const before = g.hp(FOE);
    const out = unwrap(
      activateSpell(g.state, WIZ, { castingId, targets: [FOE] }, supply('again')),
      'activate',
    );
    g.push(out.events);

    expect(out.events.some((e) => e.type === 'spell-activated')).toBe(true);
    expect(g.state.combat?.budgets[WIZ]?.action).toBe(false);
    expect(g.hp(FOE)).toBeLessThanOrEqual(before);
  });

  /**
   * SRD: "you regain Hit Points equal to half the amount of Necrotic damage
   * dealt." Half of what actually landed, so the arithmetic is the claim.
   */
  it('heals the caster for half of what it dealt', () => {
    const { g, castingId } = drained();
    g.push([{ type: 'damage-taken', id: WIZ, amount: 40, source: 'a trap' }]);
    const before = g.hp(WIZ);

    const out = unwrap(
      activateSpell(g.state, WIZ, { castingId, targets: [FOE] }, supply('bite')),
      'activate',
    );
    const dealt = out.events.find((e) => e.type === 'damage-taken');
    g.push(out.events);

    const done = dealt?.type === 'damage-taken' ? dealt.amount : 0;
    expect(g.hp(WIZ)).toBe(before + Math.floor(done / 2));
  });

  /**
   * The level is the one the casting was made at. A wizard who gained a level
   * in the meantime does not upcast a spell already in the air, and a spell
   * cast from a bigger slot keeps the bigger dice.
   */
  it('rolls the dice the casting was made with, not the spell printed level', () => {
    const low = drained('low', 3);
    const high = drained('low', 5);

    const damageOf = (g: Game, castingId: string): number => {
      const out = unwrap(
        activateSpell(g.state, WIZ, { castingId, targets: [FOE] }, supply('same')),
        'activate',
      );
      const hurt = out.events.find((e) => e.type === 'damage-taken');
      return hurt?.type === 'damage-taken' ? hurt.amount : 0;
    };

    // 3d6 against 5d6, the same dice from the same seed: the upcast one hits
    // harder because two more dice were thrown, not because the seed was kind.
    expect(damageOf(high.g, high.castingId)).toBeGreaterThan(damageOf(low.g, low.castingId));
  });

  /** SRD Flame Blade: the casting does nothing and every blow is an activation. */
  it('works for a spell whose casting does nothing at all', () => {
    const g = new Game().push(fighting());
    const blade = g.cast(WIZ, 'flame-blade', [], 2);
    // Casting it dealt nobody any damage.
    expect(g.hp(FOE)).toBe(80);
    comeRound(g);

    const out = unwrap(
      activateSpell(g.state, WIZ, { castingId: blade, targets: [FOE] }, supply('swing')),
      'activate',
    );
    g.push(out.events);
    expect(out.events.some((e) => e.type === 'roll-recorded')).toBe(true);
  });

  /**
   * SRD Flame Blade: "Fire damage equal to 3d6 **plus your spellcasting
   * ability modifier**."
   *
   * Two casters, the same seed, the same slot: the dice are identical and the
   * only difference is the modifier, so the gap between the two damages *is*
   * the clause. A single caster could not show it — 3d6 and 3d6+4 overlap.
   */
  it('adds the caster spellcasting modifier to the blade', () => {
    const swing = (intelligence: number, seed: string): { hit: boolean; damage: number } => {
      const g = new Game([
        added(WIZ, 'party', { abilities: { str: 10, dex: 14, con: 12, int: intelligence, wis: 10, cha: 10 } }),
        added(FOE, 'foes'),
        ...casts(WIZ),
        { type: 'scene-set', extent: { width: 600, depth: 600, height: 40 } },
        { type: 'landmark-added', name: 'the hall', at: { x: 200, y: 200, z: 0 } },
        { type: 'creature-placed', id: WIZ, placement: { from: { landmark: 'the hall' }, feet: 0 } },
        { type: 'creature-placed', id: FOE, placement: { from: { creature: WIZ }, feet: 5, bearing: 0 } },
        {
          type: 'combat-started',
          combatants: [
            { id: WIZ, initiative: 20, speed: 30 },
            { id: FOE, initiative: 10, speed: 30 },
          ],
        },
      ]);
      const blade = g.cast(WIZ, 'flame-blade', [], 2, 'blade');
      for (let n = 0; n < 2; n += 1) {
        g.push(unwrap(resolveTurn(g.state, supply()), 'turn').events);
      }
      // The attack is pushed well past any Armour Class, so the two runs
      // differ in the damage modifier and in nothing else — a higher
      // Intelligence also buys a better attack roll, and one run hitting while
      // the other missed would have made the comparison meaningless. A natural
      // 1 still misses whatever the bonus, which is why the seed is chosen
      // below rather than assumed.
      const out = unwrap(
        activateSpell(g.state, WIZ, { castingId: blade, targets: [FOE] }, {
          ...supply(seed),
          bonuses: [{ source: 'forced', flat: 40 }],
        }),
        'activate',
      );
      const landed = out.outcomes[0];
      return { hit: landed?.attack?.hit === true, damage: landed?.damage ?? 0 };
    };

    const seed = ['cut', 'slash', 'burn', 'sear', 'char'].find(
      (candidate) => swing(18, candidate).hit && swing(10, candidate).hit,
    );
    expect(seed, 'no seed landed both swings').toBeDefined();

    // 18 gives +4 and 10 gives +0, and nothing else about the two differs.
    expect(swing(18, seed!).damage - swing(10, seed!).damage).toBe(4);
  });

  /** SRD: "**you** can make the attack again." */
  it('cannot be stolen by another creature', () => {
    const { g, castingId } = drained();
    const out = activateSpell(g.state, RIVAL, { castingId, targets: [FOE] }, supply());
    expect(isErr(out) ? out.code : 'ok').toBe('not_your_spell');
  });

  /** And it cannot outlive the spell. */
  it('cannot happen after the spell has ended', () => {
    const { g, castingId } = drained();
    g.push([{ type: 'concentration-ended', id: WIZ, castingId, reason: 'voluntary' }]);

    const out = activateSpell(g.state, WIZ, { castingId, targets: [FOE] }, supply());
    expect(isErr(out) ? out.code : 'ok').toBe('not_ongoing');
  });

  /**
   * And it refuses **this** casting rather than reaching for whatever else is
   * running. A fixture with only one ongoing spell cannot tell the two apart:
   * a lookup that fell back to "any running spell" would pass it, and would
   * let a caster act through a Bless because their Vampiric Touch had ended.
   */
  it('cannot fall through to another spell that is still running', () => {
    const { g, castingId } = drained();
    // A second, entirely different casting, still going. A cantrip, because a
    // second Concentration spell would end the first one before the test began.
    const illusion = g.cast(WIZ, 'minor-illusion', [], undefined, 'illusion');
    g.push([{ type: 'spell-ended', castingId, on: null, reason: 'dispelled' }]);
    expect(ongoingSpellOf(g.state, illusion)).not.toBeNull();

    const out = activateSpell(g.state, WIZ, { castingId, targets: [FOE] }, supply());
    expect(isErr(out) ? out.code : 'ok').toBe('not_ongoing');
  });

  /** Nor before it exists. */
  it('refuses a casting nobody made', () => {
    const g = new Game();
    const out = activateSpell(g.state, WIZ, { castingId: 'cast:9', targets: [FOE] }, supply());
    expect(isErr(out) ? out.code : 'ok').toBe('not_ongoing');
  });

  /** The range is checked afresh: the creature in reach a minute ago may not be. */
  it('refuses a target out of reach now', () => {
    const g = new Game().push(fighting());
    const castingId = g.cast(WIZ, 'vampiric-touch', [FOE], 3);
    g.push([
      { type: 'creature-unplaced', id: FOE },
      { type: 'creature-placed', id: FOE, placement: { from: { creature: WIZ }, feet: 40, bearing: 0 } },
    ]);

    const out = activateSpell(g.state, WIZ, { castingId, targets: [FOE] }, supply());
    expect(isErr(out) ? out.code : 'ok').toBe('out_of_range');
  });

  /** A spell with no activation is not one to act through. */
  it('refuses a spell that offers nothing to do again', () => {
    const g = new Game().push(fighting());
    const bless = g.cast(WIZ, 'bless', [ALLY], 1);
    const out = activateSpell(g.state, WIZ, { castingId: bless, targets: [FOE] }, supply());
    expect(isErr(out) ? out.code : 'ok').toBe('no_activation');
  });

  /** A retry spends no second action and deals no second blow. */
  it('does not act twice on a retry', () => {
    const { g, castingId } = drained();
    const first = unwrap(
      activateSpell(g.state, WIZ, { castingId, targets: [FOE], commandId: 'a1' }, supply('one')),
      'first',
    );
    g.push(first.events);
    const after = g.state;

    const retry = unwrap(
      activateSpell(g.state, WIZ, { castingId, targets: [FOE], commandId: 'a1' }, supply('one')),
      'retry',
    );
    expect(retry.events).toEqual([]);
    expect(fold('seed', [...g.log, ...retry.events])).toEqual(after);
  });
});

// — a second casting that ends the first ——————————————————————————————————————

describe('a spell whose text says a second casting ends the first', () => {
  /** SRD Minor Illusion: "The illusion ends if you cast this spell again." */
  it('ends the caster own prior casting', () => {
    const g = new Game();
    const first = g.cast(WIZ, 'minor-illusion', [], undefined, 'first');
    const second = g.cast(WIZ, 'minor-illusion', [], undefined, 'second');

    expect(ongoingSpellOf(g.state, first)).toBeNull();
    expect(ongoingSpellOf(g.state, second)).not.toBeNull();
    expect(
      g.log.some(
        (e) => e.type === 'spell-ended' && e.castingId === first && e.reason === 'recast',
      ),
    ).toBe(true);
  });

  /** Somebody else's illusion is not yours to end. */
  it('leaves another caster instance alone', () => {
    const g = new Game();
    const theirs = g.cast(RIVAL, 'minor-illusion', [], undefined, 'theirs');
    g.cast(WIZ, 'minor-illusion', [], undefined, 'mine');

    expect(ongoingSpellOf(g.state, theirs)).not.toBeNull();
  });

  /** And a different spell of yours is not ended either. */
  it('leaves your other spells alone', () => {
    const g = new Game();
    const bless = g.cast(WIZ, 'bless', [ALLY], 1, 'bless');
    g.cast(WIZ, 'minor-illusion', [], undefined, 'a');
    g.cast(WIZ, 'minor-illusion', [], undefined, 'b');

    expect(ongoingSpellOf(g.state, bless)).not.toBeNull();
  });

  /**
   * **At most one at a time, ever** — which is why "ends the previous" and
   * "ends every prior one" cannot be told apart here, and a mutation swapping
   * them is equivalent rather than a bug. Recorded as a property instead of
   * left as a hole: three castings in a row leave exactly one running, and it
   * is the last.
   */
  it('leaves exactly one of the caster castings running, however many are made', () => {
    const g = new Game();
    const ids = ['one', 'two', 'three'].map((seed) =>
      g.cast(WIZ, 'minor-illusion', [], undefined, seed),
    );

    expect(ongoingSpellsBy(g.state, WIZ).map((o) => o.castingId)).toEqual([ids[2]]);
    // And each ending names the casting before it, never the one being made.
    expect(
      g.log.filter((e) => e.type === 'spell-ended').map((e) => e.castingId),
    ).toEqual([ids[0], ids[1]]);
  });

  /** Mage Hand writes the same sentence and gets the same rule. */
  it('applies to every spell whose text says it', () => {
    const g = new Game();
    const first = g.cast(WIZ, 'mage-hand', [], undefined, 'one');
    const second = g.cast(WIZ, 'mage-hand', [], undefined, 'two');
    expect(ongoingSpellOf(g.state, first)).toBeNull();
    expect(ongoingSpellOf(g.state, second)).not.toBeNull();
  });

  /**
   * **The guard is after the duplicate check.** A retried casting must not end
   * the casting its own first run created, which is the third time that trap
   * has been sprung in this repo.
   */
  it('does not end its own casting on a retry', () => {
    const g = new Game();
    const first = unwrap(
      resolveSpell(
        g.state,
        WIZ,
        { spellId: 'minor-illusion', targets: [], commandId: 'm1' },
        supply(),
      ),
      'first',
    );
    g.push(first.events);
    const after = g.state;

    const retry = unwrap(
      resolveSpell(
        g.state,
        WIZ,
        { spellId: 'minor-illusion', targets: [], commandId: 'm1' },
        supply(),
      ),
      'retry',
    );
    expect(retry.events).toEqual([]);
    expect(fold('seed', [...g.log, ...retry.events])).toEqual(after);
    expect(ongoingSpellOf(g.state, first.castingId)).not.toBeNull();
  });
});

// — replay ————————————————————————————————————————————————————————————————————

describe('the live record is rebuilt from the log', () => {
  const busy = (): Game => {
    const g = new Game();
    // The rival blesses before Initiative, so there is no turn to be out of.
    g.cast(RIVAL, 'bless', [ALLY, FOE], 1, 'bless');
    g.push([
      {
        type: 'combat-started',
        combatants: [
          { id: WIZ, initiative: 20, speed: 30 },
          { id: FOE, initiative: 10, speed: 30 },
          { id: RIVAL, initiative: 5, speed: 30 },
        ],
      },
    ]);
    const drain = g.cast(WIZ, 'vampiric-touch', [FOE], 3, 'drain');
    for (let n = 0; n < 3; n += 1) {
      g.push(unwrap(resolveTurn(g.state, supply()), 'turn').events);
    }
    g.push(
      unwrap(activateSpell(g.state, WIZ, { castingId: drain, targets: [FOE] }, supply('bite')), 'a')
        .events,
    );
    return g;
  };

  it('folds to the same state after a round trip through JSON', () => {
    const g = busy();
    expect(roundTrip(g.log)).toStrictEqual(g.state);
    expect(Object.keys(roundTrip(g.log).ongoing)).toEqual(Object.keys(g.state.ongoing));
  });

  it('folds at every prefix of the log', () => {
    busy().foldsAtEveryPrefix();
  });

  it('folds the same way twice, and the same way under a different seed', () => {
    const g = busy();
    expect(fold('seed', g.log)).toStrictEqual(fold('seed', g.log));
    expect(fold('other', g.log)).toStrictEqual({ ...fold('seed', g.log), seed: 'other' });
  });

  /** And a reloaded record is as usable as the original. */
  it('can be acted through after a reload', () => {
    const g = new Game().push([
      {
        type: 'combat-started',
        combatants: [
          { id: WIZ, initiative: 20, speed: 30 },
          { id: FOE, initiative: 10, speed: 30 },
        ],
      },
    ]);
    const castingId = g.cast(WIZ, 'vampiric-touch', [FOE], 3);
    // The casting spent the Action; the turn comes round before the reload.
    for (let n = 0; n < 2; n += 1) {
      g.push(unwrap(resolveTurn(g.state, supply()), 'turn').events);
    }

    const reloaded = roundTrip(g.log);
    expect(
      isErr(activateSpell(reloaded, WIZ, { castingId, targets: [FOE] }, supply('after'))),
    ).toBe(false);
  });
});

// — three resolution paths, one record ————————————————————————————————————————

/**
 * SRD Ready pays for a spell on one turn and lands it on another, and the
 * release was the one resolution path of three that wrote no live record: a
 * readied Bless was running, concentrated on, adding its d4 to every roll —
 * and invisible to Dispel Magic. A fork nothing single-path could catch.
 */
describe('a readied spell is a running spell once released', () => {
  const fighting = (): GameEvent[] => [
    {
      type: 'combat-started',
      combatants: [
        { id: WIZ, initiative: 20, speed: 30 },
        { id: RIVAL, initiative: 10, speed: 30 },
        { id: FOE, initiative: 5, speed: 30 },
      ],
    },
  ];

  const readied = (slotLevel: number): { g: Game; castingId: string } => {
    const g = new Game().push(fighting());
    g.push(
      unwrap(
        takeReady(g.state, WIZ, {
          trigger: 'when the foe moves',
          response: { kind: 'spell', spellId: 'bless', slotLevel },
        }),
        'ready',
      ),
    );
    // Paid for and held: nothing is running yet.
    expect(g.state.ongoing).toEqual({});
    const released = unwrap(releaseReady(g.state, WIZ, { targets: [ALLY] }, supply()), 'release');
    g.push(released.events);
    return { g, castingId: released.spell!.castingId };
  };

  it('records the release on whom it landed, at the level it was readied at', () => {
    const { g, castingId } = readied(2);
    const record = ongoingSpellOf(g.state, castingId);
    expect(record?.on).toEqual([ALLY]);
    expect(record?.level).toBe(2);
    expect(ongoingSpellsOn(g.state, ALLY).map((o) => o.castingId)).toEqual([castingId]);
  });

  it('can be dispelled like any other running spell', () => {
    const { g, castingId } = readied(1);
    expect(g.state.creatures[ALLY]?.bonuses).toHaveLength(1);

    // Round to the rival, who has the Action to dispel with.
    g.push(unwrap(resolveTurn(g.state, supply()), 'turn').events);
    g.push(
      unwrap(
        resolveSpell(
          g.state,
          RIVAL,
          { spellId: 'dispel-magic', targets: [ALLY], slotLevel: 3 },
          supply(),
        ),
        'dispel',
      ).events,
    );
    expect(ongoingSpellOf(g.state, castingId)).toBeNull();
    expect(g.state.creatures[ALLY]?.bonuses).toEqual([]);
    expect(g.state.creatures[WIZ]?.concentration).toBeNull();
  });
});

/**
 * An activation is a Magic action taken into the world exactly as a casting
 * is, and it lacked every guard the casting path keeps: Vampiric Touch could
 * strike while a damage roll against somebody was still held open, or while
 * a casting stood open to be Counterspelled.
 */
describe('acting through a spell respects the debts a casting respects', () => {
  const heldDamage = (): GameEvent => ({
    type: 'damage-rolled',
    damage: {
      target: ALLY,
      by: FOE,
      source: 'Longsword',
      components: [{ source: 'Longsword', type: 'slashing', roll: null, flat: 8, total: 8 }],
      critical: false,
      fromAttack: true,
      reductions: [],
      offers: [{ reactor: ALLY, feature: 'x', name: 'x', costsReaction: true, pool: null }],
    },
  });

  it('is refused while a damage roll is held open', () => {
    const g = new Game();
    const drain = g.cast(WIZ, 'vampiric-touch', [FOE], 3);
    g.push([heldDamage()]);
    const out = activateSpell(g.state, WIZ, { castingId: drain, targets: [FOE] }, supply());
    expect(isErr(out) ? out.code : 'ok').toBe('damage_pending');
  });

  it('is refused while a D20 Test is held open', () => {
    const g = new Game();
    const drain = g.cast(WIZ, 'vampiric-touch', [FOE], 3);
    const rolled = unwrap(
      resolveTest(g.state, ALLY, { kind: 'saving-throw', ability: 'dex', dc: 40 }, supply()),
      'test',
    );
    g.push([
      ...rolled.events,
      {
        type: 'test-rolled',
        test: {
          who: ALLY,
          label: 'a pit',
          result: rolled.test!,
          offers: [{ reactor: ALLY, feature: 'x', name: 'x', costsReaction: false, pool: null }],
        },
      },
    ]);
    const out = activateSpell(g.state, WIZ, { castingId: drain, targets: [FOE] }, supply());
    expect(isErr(out) ? out.code : 'ok').toBe('test_pending');
  });

  it('is refused while another casting stands open to be interrupted', () => {
    const g = new Game();
    const drain = g.cast(WIZ, 'vampiric-touch', [FOE], 3);
    g.push(
      unwrap(
        resolveSpell(
          g.state,
          RIVAL,
          { spellId: 'bless', targets: [ALLY], slotLevel: 1, hold: true },
          supply(),
        ),
        'declare',
      ).events,
    );
    const out = activateSpell(g.state, WIZ, { castingId: drain, targets: [FOE] }, supply());
    expect(isErr(out) ? out.code : 'ok').toBe('casting_pending');
  });
});

/**
 * `releaseCasting` is the one place a casting ends, and it forgot one kind of
 * debt: a hit the casting scheduled for a later moment. No ongoing spell
 * schedules one yet — both delayed-damage spells are Instantaneous — so the
 * log is assembled by hand, which is what a pure fold is for.
 */
describe('a casting takes the damage it scheduled with it', () => {
  const owed = (castingId: string, target: CharacterId): GameEvent => ({
    type: 'damage-scheduled',
    schedule: {
      target,
      by: WIZ,
      deadline: { kind: 'elapsed', at: 30 },
      notation: '2d4',
      damageType: 'acid',
      source: `Bless#${castingId}`,
      label: 'Bless (delayed)',
    },
  });

  it('drops every hit the casting owed when the casting ends', () => {
    const g = new Game();
    const bless = g.cast(WIZ, 'bless', [ALLY, FOE], 1);
    g.push([owed(bless, ALLY), owed(bless, FOE)]);
    expect(Object.keys(g.state.scheduledDamage)).toHaveLength(2);

    g.push([{ type: 'spell-ended', castingId: bless, on: null, reason: 'dispelled' }]);
    expect(g.state.scheduledDamage).toEqual({});
  });

  it('drops only that creature’s hit when the casting is released on them', () => {
    const g = new Game();
    const bless = g.cast(WIZ, 'bless', [ALLY, FOE], 1);
    g.push([owed(bless, ALLY), owed(bless, FOE)]);

    g.push([{ type: 'spell-ended', castingId: bless, on: FOE, reason: 'dispelled' }]);
    expect(Object.values(g.state.scheduledDamage).map((s) => s.target)).toEqual([ALLY]);
  });

  it('leaves what another casting owes, and goes when Concentration goes', () => {
    const g = new Game();
    const mine = g.cast(WIZ, 'bless', [ALLY], 1, 'mine');
    const theirs = g.cast(RIVAL, 'bless', [FOE], 1, 'theirs');
    g.push([owed(mine, ALLY), owed(theirs, FOE)]);

    g.push([{ type: 'condition-applied', id: WIZ, condition: 'stunned', source: 'a blow' }]);
    expect(ongoingSpellOf(g.state, mine)).toBeNull();
    expect(Object.values(g.state.scheduledDamage).map((s) => s.source)).toEqual([`Bless#${theirs}`]);
  });
});

/**
 * **The duplicate check comes first, always** — and three guards on the
 * casting path sat above it: a boundary save owed, a damage roll held, a D20
 * Test held. None is opened by a casting's own first run, so the trap was
 * quieter than the ones this repo has sprung before, and the same: a retry
 * arriving after the world moved on was told about the world instead of
 * being told its command had already landed.
 */
describe('a retried casting reports the duplicate however the world has moved on', () => {
  const heldDamage = (): GameEvent => ({
    type: 'damage-rolled',
    damage: {
      target: ALLY,
      by: FOE,
      source: 'Longsword',
      components: [{ source: 'Longsword', type: 'slashing', roll: null, flat: 8, total: 8 }],
      critical: false,
      fromAttack: true,
      reductions: [],
      offers: [{ reactor: ALLY, feature: 'x', name: 'x', costsReaction: true, pool: null }],
    },
  });

  const illusion = (g: Game) =>
    resolveSpell(g.state, WIZ, { spellId: 'minor-illusion', targets: [], commandId: 'm1' }, supply());

  it('after a damage roll somebody else held open', () => {
    const g = new Game();
    g.push(unwrap(illusion(g), 'first').events);
    g.push([heldDamage()]);
    const before = g.state;

    const retry = unwrap(illusion(g), 'retry');
    expect(retry.events).toEqual([]);
    expect(fold('seed', [...g.log, ...retry.events])).toEqual(before);
  });

  it('after a D20 Test somebody else held open', () => {
    const g = new Game();
    g.push(unwrap(illusion(g), 'first').events);
    const rolled = unwrap(
      resolveTest(g.state, ALLY, { kind: 'saving-throw', ability: 'dex', dc: 40 }, supply()),
      'test',
    );
    g.push([
      ...rolled.events,
      {
        type: 'test-rolled',
        test: {
          who: ALLY,
          label: 'a pit',
          result: rolled.test!,
          offers: [{ reactor: ALLY, feature: 'x', name: 'x', costsReaction: false, pool: null }],
        },
      },
    ]);
    const before = g.state;

    const retry = unwrap(illusion(g), 'retry');
    expect(retry.events).toEqual([]);
    expect(fold('seed', [...g.log, ...retry.events])).toEqual(before);
  });

  /**
   * The one PROGRESS.md had already named as a debt: Hold Person lands, the
   * turn comes round to the end of the held creature's turn, the repeat save
   * is raised and left owed — and the retry of the casting that put it there
   * was refused with `saves_pending`.
   */
  it('after the boundary raised a save the first run made owed', () => {
    const g = new Game().push([
      {
        type: 'combat-started',
        combatants: [
          { id: WIZ, initiative: 20, speed: 30 },
          { id: FOE, initiative: 10, speed: 30 },
        ],
      },
    ]);
    const hold = (seed: string) =>
      resolveSpell(
        g.state,
        WIZ,
        { spellId: 'hold-person', targets: [FOE], slotLevel: 2, commandId: 'hp1' },
        supply(seed),
      );
    // A seed the foe fails against, chosen by outcome rather than by hope.
    const seed = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].find(
      (candidate) => unwrap(hold(candidate), 'hold').outcomes[0]?.affected === true,
    );
    expect(seed, 'no seed made the save fail').toBeDefined();
    g.push(unwrap(hold(seed!), 'first').events);

    // Without a generator, the boundary raises the save and leaves it owed.
    g.push(unwrap(resolveTurn(g.state), 'to the foe').events);
    g.push(unwrap(resolveTurn(g.state), 'past the foe').events);
    expect(Object.keys(g.state.pendingSaves)).toHaveLength(1);
    const before = g.state;

    const retry = unwrap(hold(seed!), 'retry');
    expect(retry.events).toEqual([]);
    expect(fold('seed', [...g.log, ...retry.events])).toEqual(before);
  });
});

// — a cantrip whose whole content is what it does on later turns ———————————————

/**
 * SRD Produce Flame:
 *
 * > "A flickering flame appears in your hand and remains there for the
 * > duration... The spell ends if you cast it again.
 * >
 * > Until the spell ends, you can take a Magic action to hurl fire at a
 * > creature or an object within 60 feet of you. Make a ranged spell attack.
 * > On a hit, the target takes 1d8 Fire damage."
 * > _Cantrip Upgrade._ "The damage increases by 1d8 when you reach levels 5
 * > (2d8), 11 (3d8), and 17 (4d8)."
 *
 * Flame Blade's shape, one level down, and the two numbers that only a test
 * casting the spell can read back: the **1d8**, and the fact that it grows
 * with the *caster* rather than with a slot — which is the exact confusion
 * that once had a level 3 Wizard throwing Fire Bolt for 2d10, and which a
 * cantrip with an activation could reintroduce unseen.
 */
describe('Produce Flame hurls its fire on later turns', () => {
  const NOVICE = id('novice');
  /** Exactly sixty feet from the caster: the furthest the fire is thrown. */
  const REACHED = id('reached');
  /** Sixty-five, one cube past it. */
  const BEYOND = id('beyond');

  /**
   * The same table, plus a caster below the first Cantrip Upgrade and a pair
   * standing either side of the throw's own limit.
   *
   * **The pair is what makes the sixty feet checkable at all.** The printed
   * `Range: Self` is oracled against the book; the sixty belong to the
   * activation and nothing else in the suite reads them, so a fixture whose
   * every target stands five feet away passes just as happily with a reach of
   * five. That is the 600-foot-hall lesson: a guard needs a case where it is
   * the only thing that can refuse.
   */
  const FLAME_SETUP: readonly GameEvent[] = [
    ...SETUP,
    added(NOVICE, 'party', { level: 4 }),
    ...casts(NOVICE),
    added(REACHED, 'foes'),
    added(BEYOND, 'foes'),
    {
      type: 'creature-placed',
      id: NOVICE,
      placement: { from: { creature: WIZ }, feet: 10, bearing: 270 },
    },
    {
      type: 'creature-placed',
      id: REACHED,
      placement: { from: { creature: WIZ }, feet: 60, bearing: 0 },
    },
    {
      type: 'creature-placed',
      id: BEYOND,
      placement: { from: { creature: WIZ }, feet: 65, bearing: 0 },
    },
  ];

  /** A bonus large enough that the attack lands, so the dice are what is under test. */
  const hitting = (seed: string) => ({
    issuer: createRollIssuer('r'),
    rng: createRng(seed) as Rng,
    bonuses: [{ source: 'forced', flat: 40 }],
  });

  /** Conjure the flame and hand it back unthrown. */
  const conjureFlame = (who: CharacterId, seed: string) => {
    const g = new Game([...FLAME_SETUP]);
    const conjured = unwrap(
      resolveSpell(g.state, who, { spellId: 'produce-flame', targets: [] }, hitting(seed)),
      'produce flame',
    );
    g.push(conjured.events);
    return { g, conjured };
  };

  /** Hurl it without unwrapping: one of these is meant to be refused. */
  const tryHurl = (who: CharacterId, seed: string, at: CharacterId) => {
    const { g, conjured } = conjureFlame(who, seed);
    return {
      g,
      conjured,
      out: activateSpell(
        g.state,
        who,
        { castingId: conjured.castingId, targets: [at] },
        hitting(seed),
      ),
    };
  };

  /** Conjure the flame, then hurl it; hand back what the hurl did. */
  const hurl = (who: CharacterId, seed: string, at: CharacterId = FOE) => {
    const { g, conjured, out } = tryHurl(who, seed, at);
    const thrown = unwrap(out, 'hurling');
    g.push(thrown.events);
    return { g, conjured, thrown };
  };

  /**
   * The casting resolves nothing — conjuring a flame is not an attack — and
   * says so, which is the obligation `spell-catalogue.test.ts` holds every
   * definition with an empty effect list to.
   */
  it('conjures a flame that hurts nobody, and names the light it leaves to the DM', () => {
    const g = new Game([...FLAME_SETUP]);
    const out = unwrap(
      resolveSpell(g.state, WIZ, { spellId: 'produce-flame', targets: [] }, hitting('quiet')),
      'produce flame',
    );
    g.push(out.events);

    expect(out.outcomes).toEqual([]);
    expect(g.hp(FOE)).toBe(80);
    expect(out.unverified.join(' ')).toContain('light is not modelled');
    expect(ongoingSpellOf(g.state, out.castingId)?.spellId).toBe('produce-flame');
  });

  /** "you can take a Magic action to hurl fire": the Action, and a ranged attack. */
  it('spends the Magic action and makes a ranged spell attack', () => {
    const { thrown } = hurl(WIZ, 'hurl');
    expect(thrown.outcomes[0]?.attack).toBeDefined();
    expect(thrown.events.some((e) => e.type === 'spell-activated')).toBe(true);
  });

  /**
   * **"within 60 feet of you", measured from the caster on every throw.**
   * Sixty is reached and sixty-five is refused, which is the only pair that can
   * tell the printed distance from any other — a suite that only ever aims five
   * feet away is equally happy with a reach of five.
   */
  it('throws the fire sixty feet and no further', () => {
    const reached = hurl(WIZ, 'sixty', REACHED);
    expect(reached.thrown.outcomes[0]?.attack).toBeDefined();
    expect(reached.g.hp(REACHED)).toBeLessThan(80);

    const { out } = tryHurl(WIZ, 'sixty', BEYOND);
    expect(isErr(out)).toBe(true);
    if (isErr(out)) expect(out.code).toBe('out_of_range');
  });

  /**
   * **1d8 at level 4 and 2d8 at level 9.** The Cantrip Upgrade is read off the
   * caster, so the novice can never exceed 8 on a hit and the wizard sometimes
   * must. Criticals are skipped rather than bounded, because doubling the dice
   * would widen the novice's ceiling past the wizard's floor.
   */
  it('reads the Cantrip Upgrade off the caster’s level', () => {
    let novicesBest = 0;
    let wizardsBest = 0;
    let counted = 0;

    for (let n = 0; n < 30; n += 1) {
      for (const [who, cap] of [
        [NOVICE, 8],
        [WIZ, 16],
      ] as const) {
        const outcome = hurl(who, `flame-${n}`).thrown.outcomes[0];
        if (outcome?.attack?.hit !== true || outcome.attack.critical) continue;
        counted += 1;

        const dealt = outcome.damage ?? 0;
        expect(dealt).toBeGreaterThanOrEqual(1);
        expect(dealt).toBeLessThanOrEqual(cap);
        if (who === NOVICE) novicesBest = Math.max(novicesBest, dealt);
        else wizardsBest = Math.max(wizardsBest, dealt);
      }
    }

    expect(counted).toBeGreaterThan(30);
    // One die cannot beat 8, and the level 9 caster throws two.
    expect(novicesBest).toBeLessThanOrEqual(8);
    expect(wizardsBest).toBeGreaterThan(8);
  });

  /** SRD: "The spell ends if you cast it again." */
  it('ends its own earlier casting when the caster conjures another flame', () => {
    const { g, conjured } = hurl(WIZ, 'again');
    const second = unwrap(
      resolveSpell(g.state, WIZ, { spellId: 'produce-flame', targets: [] }, hitting('second')),
      'second flame',
    );
    g.push(second.events);

    expect(ongoingSpellOf(g.state, conjured.castingId)).toBeNull();
    expect(ongoingSpellOf(g.state, second.castingId)).not.toBeNull();
    expect(ongoingSpellsBy(g.state, WIZ).filter((o) => o.spellId === 'produce-flame')).toHaveLength(
      1,
    );
  });

  /**
   * **The sixty feet are the activation's, not the spell's.** SRD prints
   * Range: Self, so the casting aims at nobody; naming a target is refused,
   * and the distance is checked on each later hurl instead.
   */
  it('refuses a casting aimed at somebody, because its Range is Self', () => {
    const g = new Game([...FLAME_SETUP]);
    const out = resolveSpell(
      g.state,
      WIZ,
      { spellId: 'produce-flame', targets: [FOE] },
      hitting('aimed'),
    );
    expect(isErr(out)).toBe(true);
    if (isErr(out)) expect(out.code).toBe('takes_no_target');
  });
});
