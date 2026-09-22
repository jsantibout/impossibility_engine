import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { declaredCasting } from './spellcasting.js';
import type { SpellDefinition } from './spell-definitions.js';
import { checkSpellDefinition } from './spell-schema.js';
import {
  advanceTime,
  ongoingSpellOf,
  pendingCastingsOf,
  resolveDamage,
  resolveDeclaredCast,
  resolveSpell,
} from './commands.js';
import { summonedId } from './commands/spell-effect-summon.js';
import { spellOn } from './fold/release.js';

/**
 * The three sentences the SRD writes about a blow nobody had to deal.
 *
 * **The finding this file was written against.** `CastingEndTrigger` reads
 * like a vocabulary with two readers and no consumer, because the type's
 * *name* appears in exactly two engine files. The mechanism is in fact
 * complete: the field is `endsEarly`, the reader is `fold/endings.ts`, and it
 * ends running castings and the timers an item filed off one reading of the
 * log. What was missing is narrower than a machine and is an **axis** — every
 * one of the five causes is a fact about a creature the casting is *on*, and
 * about a blow somebody *dealt*. The book also writes a blow with no dealer
 * at all, a drop to 0 Hit Points, and a fact about the creature a casting is
 * **sustaining**, which is not a target and not an ally.
 *
 * | Member | SRD |
 * |---|---|
 * | `target-takes-damage` | Hypnotic Pattern: "The spell ends for an affected creature if it takes any damage". |
 * | `target-drops-to-0` | Gaseous Form: "The spell ends on the target if it drops to 0 Hit Points". |
 * | `summon-takes-damage` | Phantom Steed: "the spell ends if the steed takes any damage". |
 *
 * The first two are still about a creature the casting is on, so `isOn` is
 * still what gates them. The third is not: `isOn` asks what a creature is
 * *holding* of a casting, and a steed holds nothing — the casting holds the
 * steed — so `summonedBy` is the only link that can answer, and that is why
 * it is its own cause rather than a scope written beside another one.
 */

const id = (s: string) => asCharacterId(s);
const WIZ = id('wiz');
const PAL = id('pal');
const FOE = id('foe');
const MOB = id('mob');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 9,
  abilities: { str: 14, dex: 14, con: 12, int: 18, wis: 10, cha: 10 },
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

/**
 * A Wisdom no save can make, so the pattern always lands and the fixture is
 * about what ends the casting rather than about a saving throw.
 */
const DOOMED: Partial<CharacterSheet> = {
  abilities: { str: 14, dex: 14, con: 12, int: 10, wis: 1, cha: 10 },
};

const PREPARED = ['hypnotic-pattern', 'gaseous-form', 'phantom-steed'];

const added = (
  who: CharacterId,
  side: string,
  over: Partial<CharacterSheet> = {},
): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(over),
  maxHp: 80,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side,
});

const supply = (seed = 'blow') => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

/**
 * A hundred feet between the caster and the two creatures a Cube is dropped
 * on, so the area catches the pair it is aimed at and nobody else.
 */
const field = (): GameEvent[] => [
  added(WIZ, 'party'),
  added(PAL, 'party'),
  added(FOE, 'foes', DOOMED),
  added(MOB, 'foes', DOOMED),
  {
    type: 'spellcasting-declared',
    id: WIZ,
    spellcasting: declaredCasting({ ability: 'int', prepared: PREPARED }),
  },
  ...[1, 2, 3, 4].map(
    (level): GameEvent => ({
      type: 'resource-pool-declared',
      id: WIZ,
      pool: { key: `spell-slot:${level}`, label: `level ${level}`, max: 4, recovers: 'long-rest' },
    }),
  ),
  { type: 'scene-set', extent: { width: 600, depth: 600, height: 40 } },
  { type: 'landmark-added', name: 'the hall', at: { x: 200, y: 200, z: 0 } },
  { type: 'landmark-added', name: 'the mound', at: { x: 200, y: 300, z: 0 } },
  { type: 'creature-placed', id: WIZ, placement: { from: { landmark: 'the hall' }, feet: 0 } },
  { type: 'creature-placed', id: PAL, placement: { from: { creature: WIZ }, feet: 5, bearing: 90 } },
  { type: 'creature-placed', id: FOE, placement: { from: { landmark: 'the mound' }, feet: 0 } },
  { type: 'creature-placed', id: MOB, placement: { from: { creature: FOE }, feet: 5, bearing: 90 } },
  { type: 'sight-declared', from: WIZ, to: PAL, seen: true },
  { type: 'sight-declared', from: WIZ, to: FOE, seen: true },
  { type: 'sight-declared', from: WIZ, to: MOB, seen: true },
];

/** Where the pattern is dropped, and which way the Cube is pointed. */
const ON_THE_MOUND = { x: 200, y: 285, z: 0 } as const;
const AWAY = { x: 200, y: 340, z: 0 } as const;

class Game {
  constructor(readonly events: GameEvent[]) {}

  get state(): GameState {
    return fold('seed', this.events);
  }

  push(more: readonly GameEvent[]): this {
    this.events.push(...more);
    return this;
  }

  cast(
    spellId: string,
    targets: readonly CharacterId[],
    area?: { at: { x: number; y: number; z: number }; towards: { x: number; y: number; z: number } },
    slotLevel = 3,
  ): string {
    const out = unwrap(
      resolveSpell(
        this.state,
        WIZ,
        { spellId, targets, slotLevel, ...(area === undefined ? {} : area) },
        supply(spellId),
      ),
      `casting ${spellId}`,
    );
    this.push(out.events);
    return out.castingId!;
  }

  /** Damage one creature, naming a dealer or naming nobody at all. */
  hit(target: CharacterId, by: CharacterId | null, amount = 5): this {
    const out = unwrap(
      resolveDamage(
        this.state,
        target,
        { amount, source: 'a blow', ...(by === null ? {} : { by }) },
        supply(`hit-${target}-${String(by)}`),
      ),
      `damaging ${target}`,
    );
    return this.push(out.events);
  }

  running(castingId: string): boolean {
    return ongoingSpellOf(this.state, castingId) !== null;
  }

  on(castingId: string): readonly string[] {
    const state = this.state;
    const record = ongoingSpellOf(state, castingId);
    return record === null ? [] : spellOn(state, record);
  }

  conditions(who: CharacterId): readonly string[] {
    return this.state.creatures[who]?.conditions.conditions ?? [];
  }
}

describe('a casting the SRD ends on a blow nobody had to deal', () => {
  /**
   * SRD Hypnotic Pattern: "The spell ends for an affected creature if it takes
   * any damage." **Any** damage — which none of the four dealer-shaped causes
   * can say, because every one of them reads the creature at the *other* end
   * of the blow.
   */
  it('releases the creature a trap hurt, which nobody dealt', () => {
    const game = new Game(field());
    const casting = game.cast('hypnotic-pattern', [], { at: ON_THE_MOUND, towards: AWAY });

    expect(game.conditions(FOE)).toContain('charmed');
    expect(game.conditions(MOB)).toContain('charmed');

    // No dealer at all: a falling rock, which is what an absent
    // `damage-taken.by` means and what every dealer-shaped cause walks past.
    game.hit(FOE, null);

    expect(game.running(casting)).toBe(true);
    expect(game.on(casting)).toEqual([MOB]);
    expect(game.conditions(FOE)).not.toContain('charmed');
    expect(game.conditions(MOB)).toContain('charmed');
  });

  /**
   * **A hit for no damage is not damage**, which is a distinction this engine
   * already draws in the pass next door: `breakLostConcentration` reads
   * `event.amount > 0` off the same event, because a blow a Resistance took
   * down to nothing raises no Concentration save. Two passes in one fold
   * disagreeing about whether a `damage-taken` was damage is the defect, and
   * "if it takes **any** damage" is the sentence that would have hidden it.
   */
  it('is not pulled by a hit that dealt nothing', () => {
    const game = new Game(field());
    const casting = game.cast('hypnotic-pattern', [], { at: ON_THE_MOUND, towards: AWAY });
    game.hit(FOE, WIZ, 0);

    expect(game.running(casting)).toBe(true);
    expect(game.on(casting)).toEqual([FOE, MOB]);
    expect(game.conditions(FOE)).toContain('charmed');
  });

  /** And a blow somebody did deal ends it on that creature by the same words. */
  it('releases the creature an enemy hurt, and leaves the rest charmed', () => {
    const game = new Game(field());
    const casting = game.cast('hypnotic-pattern', [], { at: ON_THE_MOUND, towards: AWAY });
    game.hit(MOB, WIZ);

    expect(game.running(casting)).toBe(true);
    expect(game.on(casting)).toEqual([FOE]);
  });

  /**
   * SRD Gaseous Form: "The spell ends on the target if it drops to 0 Hit
   * Points." The damage and the drop are one moment and two facts, so a blow
   * the target walks away from ends nothing.
   */
  it('leaves Gaseous Form running on a target the blow did not drop', () => {
    const game = new Game(field());
    const casting = game.cast('gaseous-form', [PAL]);
    game.hit(PAL, FOE, 10);

    expect(game.running(casting)).toBe(true);
    expect(game.on(casting)).toEqual([PAL]);
  });

  /**
   * "The spell ends **on the target**", which a level 4 slot is what makes
   * visible: two creatures go to mist and one of them falling leaves the other
   * one a cloud.
   */
  it('ends Gaseous Form on the target a blow put at 0, and on nobody else', () => {
    const game = new Game(field());
    const casting = game.cast('gaseous-form', [WIZ, PAL], undefined, 4);
    expect(game.on(casting)).toEqual([PAL, WIZ]);

    game.hit(PAL, FOE, 200);

    expect(game.state.creatures[PAL]?.vitals.hp).toBe(0);
    expect(game.running(casting)).toBe(true);
    expect(game.on(casting)).toEqual([WIZ]);
  });
});

describe('a casting ended by a blow on the creature it is sustaining', () => {
  /**
   * SRD Phantom Steed is a minute-long rite, so it is declared, waited out and
   * settled — the shape `long-casting.test.ts` drives, here only because it is
   * the way this spell reaches the world at all.
   */
  const ride = (game: Game): { casting: string; steed: CharacterId } => {
    const declared = unwrap(
      resolveSpell(
        game.state,
        WIZ,
        { spellId: 'phantom-steed', targets: [WIZ], slotLevel: 3 },
        supply('steed'),
      ),
      'declaring the rite',
    );
    game.push(declared.events);
    const pending = pendingCastingsOf(game.state);
    const casting = pending[pending.length - 1]!.castingId;
    game.push(unwrap(advanceTime(game.state, 60, 'the rite'), 'the minute'));
    game.push(
      unwrap(resolveDeclaredCast(game.state, casting, supply('steed')), 'settling the rite').events,
    );
    return { casting, steed: summonedId(casting, 'phantom-steed') };
  };

  const rideOut = (): { game: Game; casting: string; steed: CharacterId } => {
    const game = new Game(field());
    return { game, ...ride(game) };
  };

  it('puts a steed in the world that the casting is holding there', () => {
    const { game, casting, steed } = rideOut();

    expect(game.running(casting)).toBe(true);
    expect(game.state.creatures[steed]?.summonedBy?.castingId).toBe(casting);
    // And it is not a creature the casting is *on*: the steed holds nothing.
    expect(game.on(casting)).not.toContain(steed);
  });

  it('ends the whole casting when the steed takes any damage', () => {
    const { game, casting, steed } = rideOut();
    game.hit(steed, null, 3);

    expect(game.running(casting)).toBe(false);
  });

  it('is untouched by a blow on a creature it did not summon', () => {
    const { game, casting } = rideOut();
    game.hit(FOE, MOB, 3);

    expect(game.running(casting)).toBe(true);
  });

  /**
   * **The link is to *this* casting and not to summoning in general**, which
   * only a second steed can prove: a rider with two of them loses the one that
   * was struck and keeps the one that was not. Asking merely whether the
   * bleeding creature was summoned by somebody passes every fixture above and
   * ends both rites here.
   */
  it('ends the casting that raised the steed that was struck, and no other', () => {
    const game = new Game(field());
    const first = ride(game);
    const second = ride(game);

    expect(first.casting).not.toBe(second.casting);
    expect(game.state.creatures[second.steed]?.summonedBy?.castingId).toBe(second.casting);

    game.hit(second.steed, null, 3);

    expect(game.running(second.casting)).toBe(false);
    expect(game.running(first.casting)).toBe(true);
  });

  it('is untouched by a blow on its own caster', () => {
    const { game, casting } = rideOut();
    game.hit(WIZ, FOE, 3);

    expect(game.running(casting)).toBe(true);
  });

  /** And a swing at the steed that got through its hide ends nothing. */
  it('is untouched by a hit on the steed that dealt nothing', () => {
    const { game, casting, steed } = rideOut();
    game.hit(steed, FOE, 0);

    expect(game.running(casting)).toBe(true);
  });
});

describe('the schema knows the three causes and still refuses what it cannot see', () => {
  /**
   * Cast at the validator rather than typed, because the point of the check is
   * the definition nobody compiled — homebrew arriving as JSON text.
   */
  const lasting = (endsEarly: unknown): SpellDefinition => ({
    id: 'homebrew-ward',
    name: 'Homebrew Ward',
    level: 1,
    school: 'abjuration',
    castingTime: 'action',
    concentration: false,
    range: { kind: 'touch' },
    targets: { count: 1, self: true },
    effects: [],
    durationSeconds: 600,
    unmodelled: ['everything this ward does is the DM’s; it exists to carry a trigger'],
    endsEarly,
  }) as never;

  it('accepts each of the three', () => {
    for (const on of ['target-takes-damage', 'target-drops-to-0', 'summon-takes-damage']) {
      expect(checkSpellDefinition(lasting([{ on, ends: 'casting' }]))).toEqual([]);
    }
  });

  it('still refuses a cause the log cannot see happen', () => {
    const found = checkSpellDefinition(lasting([{ on: 'target-sneezes', ends: 'casting' }]));
    expect(found.map((problem) => problem.code)).toEqual(['unknown_end_trigger']);
  });

  /**
   * A scope that would find nothing to release is a sentence that compiles and
   * never fires, which is the defect this codebase spends its validators on.
   */
  it('refuses a release on a creature the casting is not on', () => {
    const found = checkSpellDefinition(lasting([{ on: 'summon-takes-damage', ends: 'target' }]));
    expect(found.map((problem) => problem.code)).toEqual(['inert_end_scope']);
    expect(found[0]?.field).toBe('endsEarly[0].ends');
  });
});
