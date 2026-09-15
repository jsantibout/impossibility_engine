import { describe, expect, it } from 'vitest';
import { SPELL_DEFINITIONS, SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, type CharacterId, type Result } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, grantSourcesOf, type GameEvent } from './events.js';
import { spellSlotKey } from './resources.js';
import { declaredCasting } from './spellcasting.js';
import { durationSecondsAt } from './spell-definitions.js';
import type { DamageDefenses } from './attack.js';
import {
  advanceTime,
  endConcentration,
  releaseReady,
  resolveAttack,
  resolveAttackDamage,
  resolveSpell,
  takeReady,
} from './commands.js';
import { spellOn } from './fold/release.js';

/**
 * A rider on the caster's later attacks — the **sixth** sourced grant.
 *
 * Two SRD sentences, and the whole design is that they are *not* the same
 * sentence:
 *
 * > Divine Favor: "Until the spell ends, **your attacks with weapons** deal an
 * > extra 1d4 Radiant damage on a hit." **Range:** Self. **Duration:** 1
 * > minute.
 *
 * > Hunter's Mark: "you deal an extra 1d6 Force damage **to the target**
 * > whenever you hit it **with an attack roll**." **Range:** 90 feet.
 * > **Duration:** Concentration, up to 1 hour.
 *
 * One names the *weapon* and not the target; the other names the *target* and
 * not the weapon. So Divine Favor reaches every weapon in the caster's hands
 * and no Fire Bolt, and Hunter's Mark reaches a Fire Bolt aimed at the quarry
 * and nothing aimed at anybody else. A single predicate would have made one of
 * the two wrong in the direction nothing measures.
 *
 * And Hunter's Mark is the spell blocked on **both** of this task's shapes, so
 * its second sentence is here too:
 *
 * > "_Using a Higher-Level Spell Slot._ Your Concentration can last longer
 * > with a spell slot of level 3–4 (up to 8 hours) or 5+ (up to 24 hours)."
 */

const id = (s: string) => asCharacterId(s);
const CASTER = id('caster');
const QUARRY = id('quarry');
const BYSTANDER = id('bystander');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 18, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'wis',
  weaponProficiencies: ['simple', 'martial'],
  ...over,
});

/**
 * A target whose defences are the fixture's whole point.
 *
 * **An undefended dummy cannot tell a rider from a bonus**, which is the
 * lesson `featureDamageTypes` already carries: a die folded into the weapon's
 * own damage and a die of its own come to the same number against a creature
 * that resists neither. So every damage fixture here resists exactly one of
 * the two types in play, and the discriminating case is the one that resists
 * **the rider's** type and not the weapon's.
 */
const added = (
  who: CharacterId,
  defenses: Readonly<Record<string, DamageDefenses>> = {},
  over: Partial<CharacterSheet> = {},
): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(over),
  maxHp: 400,
  diesAtZero: false,
  creatureType: 'Humanoid',
  defenses,
});

const slotsFor = (who: CharacterId): readonly GameEvent[] =>
  [1, 2, 3, 4, 5, 6, 7].map((level) => ({
    type: 'resource-pool-declared',
    id: who,
    pool: {
      key: spellSlotKey(level),
      label: `level ${level} spell slot`,
      max: 4,
      recovers: 'long-rest',
    },
  }));

/**
 * A declared caster rather than a class one.
 *
 * Divine Favor is a Paladin spell and Hunter's Mark a Ranger's, and the third
 * spell this file needs is a *spell attack* to prove Hunter's Mark reaches
 * one. `spellcasting-declared` is the engine's own answer to a caster with no
 * class table — the same rule as a stat block's printed Armour Class — so one
 * fixture can hold all three without inventing a multiclass nobody asked for.
 */
const casting = (
  who: CharacterId,
  defenses: Readonly<Record<string, DamageDefenses>> = {},
  over: Partial<CharacterSheet> = {},
): readonly GameEvent[] => [
  added(who, defenses, over),
  ...slotsFor(who),
  {
    type: 'spellcasting-declared',
    id: who,
    spellcasting: declaredCasting({
      ability: 'wis',
      cantrips: ['fire-bolt'],
      prepared: ['divine-favor', 'hunters-mark', 'dispel-magic', 'mass-suggestion'],
    }),
  },
  {
    type: 'items-gained',
    id: who,
    items: [{ id: 'mace', quantity: 1 }],
    source: 'kit',
  },
];

const table = (
  quarry: Readonly<Record<string, DamageDefenses>> = {},
  caster: Partial<CharacterSheet> = {},
): readonly GameEvent[] => [
  ...casting(CASTER, {}, caster),
  added(QUARRY, quarry),
  // The bystander casts too, so a Dispel Magic has somebody to come from: SRD
  // refuses one aimed at yourself, and Divine Favor is Range: Self.
  ...casting(BYSTANDER),
  { type: 'scene-set', extent: { width: 600, depth: 600, height: 40 } },
  { type: 'landmark-added', name: 'the road', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: CASTER, placement: { from: { landmark: 'the road' }, feet: 0 } },
  { type: 'creature-placed', id: QUARRY, placement: { from: { creature: CASTER }, feet: 5, bearing: 0 } },
  {
    type: 'creature-placed',
    id: BYSTANDER,
    placement: { from: { creature: CASTER }, feet: 5, bearing: 180 },
  },
  { type: 'sight-declared', from: CASTER, to: QUARRY, seen: true },
  { type: 'sight-declared', from: CASTER, to: BYSTANDER, seen: true },
];

const supply = (seed = 'swing') => ({ issuer: createRollIssuer('r'), rng: createRng(seed) as Rng, content: SRD_CONTENT });

const must = <T,>(result: Result<T>): T => unwrap(result, 'attack riders');

const cast = (
  log: readonly GameEvent[],
  spellId: string,
  targets: readonly CharacterId[],
  slotLevel = 1,
): readonly GameEvent[] => [
  ...log,
  ...must(resolveSpell(fold('seed', log), CASTER, { spellId, targets, slotLevel }, supply(spellId)))
    .events,
];

/**
 * Swing with the attack roll forced to land, so the test is about the rider.
 *
 * A huge flat bonus rather than a lucky seed — the same reason
 * `once-per-turn.test.ts` gives: what is under test is whether the rider
 * applied, and a miss answers nothing.
 */
const swing = (log: readonly GameEvent[], target: CharacterId, seed = 'blow') => {
  const out = must(
    resolveAttack(
      fold('seed', log),
      CASTER,
      { target, weapon: 'mace', attackBonuses: [{ source: 'forced', flat: 40 }] },
      supply(seed),
    ),
  );
  // A natural 1 misses whatever the bonus is, which is the SRD and not a
  // fixture problem — so the seed is chosen to land rather than the guard
  // relaxed.
  if (out.attack?.hit !== true) throw new Error('the fixture meant this swing to land');
  return out;
};

/** A Fire Bolt, which is an attack roll and is not a weapon. */
const bolt = (log: readonly GameEvent[], target: CharacterId, seed = 'bolt') =>
  must(
    resolveSpell(
      fold('seed', log),
      CASTER,
      { spellId: 'fire-bolt', targets: [target] },
      { ...supply(seed), bonuses: [{ source: 'forced', flat: 40 }] },
    ),
  );

describe('Divine Favor: "your attacks with weapons"', () => {
  it('adds its die to a weapon attack', () => {
    const plain = swing(table(), QUARRY);
    const blessed = swing(cast(table(), 'divine-favor', [CASTER]), QUARRY);
    expect(blessed.damage!).toBeGreaterThan(plain.damage!);
  });

  /**
   * **The discriminating fixture.** A target that resists Radiant and not
   * Bludgeoning takes *less* than an undefended one — which can only happen if
   * the 1d4 met the target's defences as Radiant. Folded into the mace's own
   * damage it would be Bludgeoning, and resisting Radiant would change nothing
   * at all.
   */
  it('is Radiant damage, resisted as Radiant and not as the weapon’s type', () => {
    const open = swing(cast(table(), 'divine-favor', [CASTER]), QUARRY);
    const radiantProof = swing(
      cast(table({ radiant: { resistant: true } }), 'divine-favor', [CASTER]),
      QUARRY,
    );
    const maceProof = swing(
      cast(table({ bludgeoning: { resistant: true } }), 'divine-favor', [CASTER]),
      QUARRY,
    );

    expect(radiantProof.damage!).toBeLessThan(open.damage!);
    expect(maceProof.damage!).toBeLessThan(open.damage!);
    // And the two resistances bite on different halves: the mace is the bigger
    // component, so resisting it costs more than resisting the 1d4.
    expect(maceProof.damage!).toBeLessThan(radiantProof.damage!);
  });

  /** SRD says "with weapons", and a Fire Bolt is not one. */
  it('does not reach a spell attack', () => {
    const plain = bolt(table(), QUARRY);
    const blessed = bolt(cast(table(), 'divine-favor', [CASTER]), QUARRY);
    expect(blessed.outcomes[0]!.damage).toBe(plain.outcomes[0]!.damage);
  });
});

describe('Hunter’s Mark: "to the target ... with an attack roll"', () => {
  const marked = () => cast(table(), 'hunters-mark', [QUARRY]);

  it('adds its die against the quarry', () => {
    expect(swing(marked(), QUARRY).damage!).toBeGreaterThan(swing(table(), QUARRY).damage!);
  });

  /** "to the target" — and the bystander is not the target. */
  it('leaves everybody else alone', () => {
    expect(swing(marked(), BYSTANDER).damage!).toBe(swing(table(), BYSTANDER).damage!);
  });

  /**
   * "whenever you hit it **with an attack roll**" — which a Fire Bolt is.
   *
   * This is the clause Divine Favor does not write, and the reason the spell
   * attack path calls the gatherer directly: had the rider only been folded
   * into the weapon path, a marked quarry would have been safe from every
   * cantrip in the book.
   */
  it('reaches a spell attack', () => {
    expect(bolt(marked(), QUARRY).outcomes[0]!.damage!).toBeGreaterThan(
      bolt(table(), QUARRY).outcomes[0]!.damage!,
    );
  });

  it('is Force damage, resisted as Force', () => {
    const open = swing(cast(table(), 'hunters-mark', [QUARRY]), QUARRY);
    const forceProof = swing(
      cast(table({ force: { resistant: true } }), 'hunters-mark', [QUARRY]),
      QUARRY,
    );
    expect(forceProof.damage!).toBeLessThan(open.damage!);
  });
});

describe('a Critical Hit doubles the rider’s dice', () => {
  /**
   * SRD: "Roll the attack's damage dice twice, add them together, and add any
   * relevant modifiers as normal" — and "If the attack involves other damage
   * dice, such as from the Rogue's Sneak Attack feature, **you also roll those
   * dice twice**."
   *
   * **The quarry is Immune to the mace's own type**, which is what makes the
   * number readable: with Bludgeoning taken to zero the only damage that lands
   * is Divine Favor's Radiant, so the total *is* the rider. A single d4 cannot
   * exceed 4, so a landed total above that is the doubling and nothing else —
   * and the same swing without the crit is asserted inside the d4's range, so
   * the case cannot pass by the fixture simply hitting harder.
   *
   * The crit is forced off the attacker's own sheet rather than waited for:
   * `criticalOn` is the Champion's 19 read down to 2, which is the mechanism
   * `resolveAttack` already reads and needs no seed to be lucky.
   *
   * **The rider carries no flat to double**, which is why the other half of
   * the SRD sentence is not asserted here: `attack-rider` has dice and a
   * damage type and no flat field, so "flat bonuses never double" has nothing
   * on this component to be true of. `attack.ts` owns that half for the
   * components that do carry one.
   */
  const IMMUNE_TO_THE_MACE = { bludgeoning: { immune: true } };

  it('rolls the extra die twice on a critical', () => {
    const ordinary = swing(
      cast(table(IMMUNE_TO_THE_MACE), 'divine-favor', [CASTER]),
      QUARRY,
      'smite',
    );
    const critical = swing(
      cast(table(IMMUNE_TO_THE_MACE, { criticalOn: 2 }), 'divine-favor', [CASTER]),
      QUARRY,
      'smite',
    );

    expect(critical.attack!.critical).toBe(true);
    expect(ordinary.attack!.critical).toBe(false);

    // Only the Radiant lands, so the total is the rider itself.
    expect(ordinary.damage!).toBeGreaterThanOrEqual(1);
    expect(ordinary.damage!).toBeLessThanOrEqual(4);
    // 2d4 rather than 1d4: above what one die could ever show.
    expect(critical.damage!).toBeGreaterThan(4);
    expect(critical.damage!).toBeLessThanOrEqual(8);
  });
});

describe('the sixth grant ends through the one door', () => {
  it('is enumerated beside the other five', () => {
    const state = fold('seed', cast(table(), 'divine-favor', [CASTER]));
    expect(grantSourcesOf(state.creatures[CASTER]!)).toEqual(['Divine Favor#cast:1']);
  });

  it('goes when Concentration breaks', () => {
    const log = cast(table(), 'hunters-mark', [QUARRY]);
    expect(fold('seed', log).creatures[CASTER]!.attackRiders).toHaveLength(1);

    const ended = [...log, ...must(endConcentration(fold('seed', log), CASTER, 'voluntary'))];
    expect(fold('seed', ended).creatures[CASTER]!.attackRiders).toEqual([]);
  });

  /** Divine Favor is a minute, and the minute is what takes the die away. */
  it('goes when the deadline arrives', () => {
    const log = cast(table(), 'divine-favor', [CASTER]);
    const later = [
      ...log,
      ...must(advanceTime(fold('seed', log), 120, 'a walk')),
    ];
    expect(fold('seed', later).creatures[CASTER]!.attackRiders).toEqual([]);
  });

  /**
   * And the third door, which is the one the other two cannot stand in for.
   *
   * SRD Dispel Magic ends "any ongoing spell of level 3 or lower on the
   * target", and Divine Favor is Range: Self — so the casting is on its caster
   * and a Dispel Magic aimed at them finds it. That is also the assertion that
   * the rider makes the casting *on* somebody at all: a grant nothing owned
   * would leave `spellOn` empty and the dispel nothing to reach.
   */
  it('goes when the casting is dispelled', () => {
    const log = cast(table(), 'divine-favor', [CASTER]);
    const running = fold('seed', log);
    expect(running.creatures[CASTER]!.attackRiders).toHaveLength(1);
    expect(spellOn(running, Object.values(running.ongoing)[0]!)).toEqual([CASTER]);

    // The **bystander** dispels it: SRD refuses a Dispel Magic aimed at
    // yourself, which is also what makes this a real second creature reaching
    // a grant rather than the caster tidying up after themselves.
    const dispelled = [
      ...log,
      ...must(
        resolveSpell(
          fold('seed', log),
          BYSTANDER,
          { spellId: 'dispel-magic', targets: [CASTER], slotLevel: 3 },
          supply('dispel'),
        ),
      ).events,
    ];
    expect(fold('seed', dispelled).creatures[CASTER]!.attackRiders).toEqual([]);
  });

  /**
   * **And the same door from ninety feet away, which is the case Range: Self
   * cannot stand in for.**
   *
   * Divine Favor above is Range: Self, so its record takes the branch that
   * puts the caster in `on` by construction and proves nothing about the rule.
   * SRD Hunter's Mark is cast at a quarry and the die is the **ranger's**, so
   * the casting owns something on a creature who is not one of its targets —
   * the first effect in the catalogue that does. The record is on the ranger
   * and the quarry is not in it: the mark is a fact *about* the quarry and
   * nothing of the casting's is running there, which is the same reading that
   * keeps a creature Insect Plague merely damaged off the list.
   *
   * Without that, the record folded to nobody at all and the spell was
   * dispellable from nowhere.
   */
  it('is on the caster even when the spell was cast at somebody else', () => {
    const log = cast(table(), 'hunters-mark', [QUARRY]);
    const running = fold('seed', log);
    expect(spellOn(running, Object.values(running.ongoing)[0]!)).toEqual([CASTER]);

    const dispelled = [
      ...log,
      ...must(
        resolveSpell(
          fold('seed', log),
          BYSTANDER,
          { spellId: 'dispel-magic', targets: [CASTER], slotLevel: 3 },
          supply('dispel'),
        ),
      ).events,
    ];
    expect(fold('seed', dispelled).creatures[CASTER]!.attackRiders).toEqual([]);
    expect(fold('seed', dispelled).ongoing).toEqual({});
  });
});

describe('a duration the slot changes', () => {
  /**
   * SRD Hunter's Mark: "Your Concentration can last longer with a spell slot
   * of level 3–4 (up to 8 hours) or 5+ (up to 24 hours)." Its printed Duration
   * is "Concentration, up to 1 hour".
   */
  const HUNTERS_MARK = SPELL_DEFINITIONS.find((d) => d.id === 'hunters-mark')!;

  it('reads the band the slot falls in', () => {
    expect(durationSecondsAt(HUNTERS_MARK, 1)).toBe(3600);
    expect(durationSecondsAt(HUNTERS_MARK, 2)).toBe(3600);
    expect(durationSecondsAt(HUNTERS_MARK, 3)).toBe(28800);
    expect(durationSecondsAt(HUNTERS_MARK, 4)).toBe(28800);
    expect(durationSecondsAt(HUNTERS_MARK, 5)).toBe(86400);
    expect(durationSecondsAt(HUNTERS_MARK, 9)).toBe(86400);
  });

  /**
   * And the band reaches the deadline, which is the half a table of numbers
   * nobody reads would not buy.
   */
  const survives = (slotLevel: number, seconds: number): boolean => {
    const log = cast(table(), 'hunters-mark', [QUARRY], slotLevel);
    const later = [
      ...log,
      ...must(advanceTime(fold('seed', log), seconds, 'a march')),
    ];
    return fold('seed', later).creatures[CASTER]!.attackRiders.length > 0;
  };

  it('ends after an hour at level 1 and runs eight at level 3', () => {
    expect(survives(1, 3660)).toBe(false);
    expect(survives(3, 3660)).toBe(true);
    expect(survives(3, 28860)).toBe(false);
  });

  it('runs a full day at level 5', () => {
    expect(survives(5, 28860)).toBe(true);
    expect(survives(5, 86460)).toBe(false);
  });
});

describe('two spells, two tables', () => {
  /**
   * SRD Hex bands at "level 2 (up to 4 hours), 3–4 (up to 8 hours), or 5+ (24
   * hours)" where Hunter's Mark bands at "3–4" and "5+". One shared field
   * would silently make one of the two wrong, which is why `durationAtSlot` is
   * per definition and not a formula.
   *
   * Hex has no definition — it is blocked on the ability chosen at its casting
   * — so what is pinned here is the *shape*: a table read at its own levels,
   * with a level 2 band Hunter's Mark does not have.
   */
  it('gives a level 2 slot nothing on Hunter’s Mark', () => {
    const HUNTERS_MARK = SPELL_DEFINITIONS.find((d) => d.id === 'hunters-mark')!;
    expect(durationSecondsAt(HUNTERS_MARK, 2)).toBe(HUNTERS_MARK.durationSeconds);
    expect(HUNTERS_MARK.durationAtSlot?.[2]).toBeUndefined();
  });
});

describe('the gatherer is one gatherer, not three spelled alike', () => {
  /**
   * **The held attack is the third path**, and it is the one a fixture is most
   * likely to leave out: `resolveAttack` with `hold` records the hit and rolls
   * nothing, and `resolveAttackDamage` settles the damage in a second command.
   * Both reach the rider through `standingAttackDamage`, which is the whole
   * argument for folding it in there rather than calling it at each site — and
   * that argument is only worth making if something drives the second site.
   *
   * SRD Divine Smite is why the window exists at all ("Bonus Action, which you
   * take immediately after hitting a target"), and it is exactly where a
   * Paladin's own Divine Favor has to go on working.
   */
  it('reaches the damage of an attack that was held', () => {
    const held = (log: readonly GameEvent[]) => {
      const swung = must(
        resolveAttack(
          fold('seed', log),
          CASTER,
          {
            target: QUARRY,
            weapon: 'mace',
            hold: true,
            attackBonuses: [{ source: 'forced', flat: 40 }],
          },
          supply('held'),
        ),
      );
      if (swung.attack?.hit !== true) throw new Error('the fixture meant this swing to land');
      const after = [...log, ...swung.events];
      return must(resolveAttackDamage(fold('seed', after), CASTER, {}, supply('settle')));
    };

    expect(held(cast(table(), 'divine-favor', [CASTER])).damage!).toBeGreaterThan(
      held(table()).damage!,
    );
  });
});

describe('the band reaches a readied spell too', () => {
  /**
   * SRD writes a readied spell's Duration from the moment it takes effect, so
   * `releaseReady` schedules the deadline rather than the casting doing it —
   * which makes it the **second** place a slot level has to become seconds.
   * Both go through `durationSecondsAt`, and this is what says so.
   *
   * **Mass Suggestion rather than Hunter's Mark**, and the engine chose twice.
   * SRD requires a readied spell's casting time to be an Action, and both of
   * this task's own spells are a Bonus Action; and `ReadiedResponse` carries a
   * spell id, a casting id and a level and **no stated facts**, so the three
   * Dominates — which print "Advantage if you or your allies are fighting it"
   * and are refused `fought_fact_required` — cannot be readied at all. That is
   * a gap in the readied path rather than in this one, and it is recorded
   * rather than worked around.
   *
   * So the fixture is the Action-cast band-carrying spell that states no fact:
   * SRD Mass Suggestion, "Duration: 24 hours", with "The duration is longer
   * with a spell slot of level 7 (10 days), 8 (30 days), or 9 (366 days)". A
   * release from its own level 6 is over inside two days and one from a level
   * 7 slot is not. The observable is the ongoing record rather than a rider,
   * because this spell hangs a condition; what is under test is the deadline,
   * and the deadline is the casting's.
   */
  const readied = (slotLevel: number, seconds: number): boolean => {
    const start = table();
    const combat: readonly GameEvent[] = [
      ...start,
      {
        type: 'combat-started',
        combatants: [
          { id: CASTER, initiative: 20, speed: 30 },
          { id: QUARRY, initiative: 10, speed: 30 },
        ],
      },
    ];
    const held = [
      ...combat,
      ...must(
        takeReady(fold('seed', combat), CASTER, {
          trigger: 'when the quarry breaks cover',
          response: { kind: 'spell', spellId: 'mass-suggestion', slotLevel },
        }, SRD_CONTENT),
      ),
    ];
    const released = [
      ...held,
      ...must(releaseReady(fold('seed', held), CASTER, { targets: [QUARRY] }, supply('release')))
        .events,
    ];
    const later = [
      ...released,
      ...must(advanceTime(fold('seed', released), seconds, 'a long watch')),
    ];
    return Object.keys(fold('seed', later).ongoing).length > 0;
  };

  it('runs the band the slot bought rather than the printed day', () => {
    // Its own level 6: "24 hours", so two days ends it.
    expect(readied(6, 172800)).toBe(false);
    // Level 7: ten days, which two days does not reach and eleven do.
    expect(readied(7, 172800)).toBe(true);
    expect(readied(7, 950400)).toBe(false);
  });
});
