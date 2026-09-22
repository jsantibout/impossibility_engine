import { describe, expect, it } from 'vitest';
import { SPELL_DEFINITIONS, SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap, type CharacterId, type Result } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import type { Rng, RngState } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, grantSourcesOf, type GameEvent, type GameState } from './events.js';
import { spellSlotKey } from './resources.js';
import { declaredCasting } from './spellcasting.js';
import { checkSpellDefinition } from './spell-schema.js';
import type { SpellDefinition } from './spell-definitions.js';
import { extendContent, type Content } from './content.js';
import { weaponRidersFor } from './standing.js';
import {
  advanceTime,
  releaseReady,
  resolveAttack,
  resolveSpell,
  takeReady,
} from './commands.js';
import { spellOn } from './fold/release.js';

/**
 * **The weapon this casting was aimed at**, and what a later swing with it
 * reads back.
 *
 * Two SRD sentences, and neither of them is the `attack-rider` grant beside
 * this one. That one hangs a notation and a damage type on the *caster* and
 * fires on every attack the narrowing lets through; these two change the
 * arithmetic of **one object**:
 *
 * > Shillelagh: "A Club or Quarterstaff you are holding is imbued with
 * > nature's power. For the duration, you can use your spellcasting ability
 * > instead of Strength for the attack and damage rolls of melee attacks using
 * > that weapon, and the weapon's damage die becomes a d8." _Cantrip Upgrade._
 * > "The damage die changes when you reach levels 5 (d10), 11 (d12), and 17
 * > (2d6)."
 *
 * > Magic Weapon: "You touch a nonmagical weapon. Until the spell ends, that
 * > weapon becomes a magic weapon with a +1 bonus to attack rolls and damage
 * > rolls." _Using a Higher-Level Spell Slot._ "The bonus increases to +2 with
 * > a level 3–5 spell slot. The bonus increases to +3 with a level 6+ spell
 * > slot."
 *
 * **Neither narrowing the engine already had can say it.** `onlyWithItem` is
 * keyed on the id of the item *granting* the benefit — a Weapon, +1 narrowing
 * its own plus to itself — and there is no item granting anything here.
 * `onlyWithWeapon` describes a *kind* of weapon, so a Shillelagh written with
 * one would enchant every Quarterstaff in the pack at once. What was missing
 * was a casting naming the particular weapon it was aimed at, which is
 * `CastSpellRequest.weapon`, and a grant keyed on that id, which is
 * `GrantedWeaponRider`.
 */

const id = (s: string): CharacterId => asCharacterId(s);
const CASTER = id('caster');
const DUMMY = id('dummy');
const ALLY = id('ally');

/**
 * The d20 is whatever the test asks for; every die after it comes up on its
 * highest face — `strike-style.test.ts`'s rng, for its reason.
 *
 * A damage total is then a number the SRD sentence predicts: a Quarterstaff's
 * own `1d6` is 6 and Shillelagh's `1d8` is 8, so which die was rolled is read
 * off the total rather than sampled.
 */
const scripted = (d20: number): Rng => {
  let thrown = 0;
  return {
    int: (sides: number) => (thrown++ === 0 ? d20 : sides),
    snapshot: (): RngState => [0, 0, 0, 0],
  };
};

const supply = (d20 = 15) => ({
  issuer: createRollIssuer('r'),
  rng: scripted(d20),
  content: SRD_CONTENT,
});

/**
 * Strength 10 and Wisdom 18, which is what makes the substitution readable: a
 * Quarterstaff swung by this caster adds nothing, and the same Quarterstaff
 * under Shillelagh adds +4.
 */
const sheet = (level: number, over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level,
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

/** A sandbag with four hundred hit points and an Armour Class of 10. */
const dummy = (who: CharacterId): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(1),
  maxHp: 400,
  diesAtZero: false,
  creatureType: 'Humanoid',
});

const table = (
  level = 1,
  carrying = ['quarterstaff', 'club', 'mace', 'dart'],
  over: Partial<CharacterSheet> = {},
): readonly GameEvent[] => [
  {
    type: 'creature-added',
    id: CASTER,
    name: CASTER,
    sheet: sheet(level, over),
    maxHp: 400,
    diesAtZero: false,
    creatureType: 'Humanoid',
  },
  ...slotsFor(CASTER),
  {
    type: 'spellcasting-declared',
    id: CASTER,
    spellcasting: declaredCasting({
      ability: 'wis',
      cantrips: ['shillelagh'],
      prepared: ['magic-weapon', 'cure-wounds'],
    }),
  },
  {
    type: 'items-gained',
    id: CASTER,
    items: carrying.map((item) => ({ id: item, quantity: 1 })),
    source: 'kit',
  },
  dummy(DUMMY),
  dummy(ALLY),
  // The ally carries a Mace of their own, which is what Magic Weapon's Range:
  // Touch is asserted against: the Paladin enchants somebody else's weapon and
  // the plus is theirs.
  { type: 'items-gained', id: ALLY, items: [{ id: 'mace', quantity: 1 }], source: 'kit' },
  { type: 'scene-set', extent: { width: 600, depth: 600, height: 40 } },
  { type: 'landmark-added', name: 'the grove', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: CASTER, placement: { from: { landmark: 'the grove' }, feet: 0 } },
  { type: 'creature-placed', id: DUMMY, placement: { from: { creature: CASTER }, feet: 5, bearing: 0 } },
  { type: 'creature-placed', id: ALLY, placement: { from: { creature: CASTER }, feet: 5, bearing: 180 } },
  { type: 'sight-declared', from: CASTER, to: DUMMY, seen: true },
  { type: 'sight-declared', from: CASTER, to: ALLY, seen: true },
];

const must = <T,>(result: Result<T>): T => unwrap(result, 'weapon rider');

type CastRequest = Parameters<typeof resolveSpell>[2];

const casting = (log: readonly GameEvent[], request: CastRequest) =>
  resolveSpell(fold('seed', log), CASTER, request, supply());

const cast = (log: readonly GameEvent[], request: CastRequest): readonly GameEvent[] => [
  ...log,
  ...must(casting(log, request)).events,
];

/** Swing, with the d20 fixed so the total is the arithmetic and not the luck. */
const swing = (log: readonly GameEvent[], weapon: string | null, d20 = 15) =>
  must(
    resolveAttack(fold('seed', log), CASTER, { target: DUMMY, weapon }, supply(d20)),
  );

const state = (log: readonly GameEvent[]): GameState => fold('seed', log);

const ridersOn = (log: readonly GameEvent[], who: CharacterId = CASTER) =>
  state(log).creatures[who]!.weaponRiders;

// — Shillelagh ————————————————————————————————————————————————————————————

/**
 * The Quarterstaff's own numbers, so every assertion below is a delta against
 * a printed line rather than against a remembered one.
 */
describe('the unenchanted staff, which is the control', () => {
  it('rolls its own d6 and adds a Strength of nothing', () => {
    expect(SRD_CONTENT.item('quarterstaff')?.weapon?.damage.dice).toBe('1d6');
    const hit = swing(table(), 'quarterstaff');
    expect(hit.attack?.ability).toBe('str');
    expect(hit.damage).toBe(6 + 0);
  });
});

describe('Shillelagh imbues the weapon it was aimed at', () => {
  const enchanted = (level = 1) =>
    cast(table(level), { spellId: 'shillelagh', targets: [CASTER], weapon: 'quarterstaff' });

  /**
   * "you can use your spellcasting ability instead of Strength for the attack
   * and damage rolls of melee attacks using that weapon".
   *
   * "Can", so it is the offer `attackAbility` already knows how to weigh —
   * Wisdom 18 beats Strength 10 and is taken.
   */
  it('offers the caster’s spellcasting ability in place of Strength', () => {
    const hit = swing(enchanted(), 'quarterstaff');
    expect(hit.attack?.ability).toBe('wis');
  });

  /** "the weapon's damage die becomes a d8" — 8 on the scripted die, plus +4. */
  it('rolls the spell’s die in place of the weapon’s own', () => {
    expect(swing(enchanted(), 'quarterstaff').damage).toBe(8 + 4);
  });

  /**
   * **The clause neither existing narrowing could say.** The Club in the same
   * pack is a Club the spell was not aimed at, and it is untouched — where a
   * `WeaponNarrowing` over "Simple Melee" would have enchanted it, the Mace
   * and every Dagger besides.
   */
  it('leaves every other weapon in the pack exactly as it was', () => {
    expect(SRD_CONTENT.item('club')?.weapon?.damage.dice).toBe('1d4');
    const hit = swing(enchanted(), 'club');
    expect(hit.attack?.ability).toBe('str');
    expect(hit.damage).toBe(4 + 0);
  });

  /**
   * _Cantrip Upgrade._ "The damage die changes when you reach levels 5 (d10),
   * 11 (d12), and 17 (2d6)" — a band table read off the **character's** level,
   * not off a slot, and pinned into the grant at the casting.
   */
  it('grows the die with the caster’s level, pinned at the casting', () => {
    expect(ridersOn(enchanted(1))[0]?.die).toBe('1d8');
    expect(ridersOn(enchanted(4))[0]?.die).toBe('1d8');
    expect(ridersOn(enchanted(5))[0]?.die).toBe('1d10');
    expect(ridersOn(enchanted(10))[0]?.die).toBe('1d10');
    expect(ridersOn(enchanted(11))[0]?.die).toBe('1d12');
    expect(ridersOn(enchanted(17))[0]?.die).toBe('2d6');

    // And the pinned die is the die that is rolled.
    expect(swing(enchanted(5), 'quarterstaff').damage).toBe(10 + 4);
  });

  /** "Duration: 1 minute", and the minute is what takes the staff back. */
  it('ends on its own deadline', () => {
    const log = enchanted();
    expect(ridersOn(log)).toHaveLength(1);
    const later = [...log, ...must(advanceTime(state(log), 120, 'a walk'))];
    expect(ridersOn(later)).toEqual([]);
    expect(swing(later, 'quarterstaff').damage).toBe(6 + 0);
  });

  /** "The spell ends early if you cast it again." */
  it('ends the prior casting when it is cast again', () => {
    const first = enchanted();
    const again = cast(first, { spellId: 'shillelagh', targets: [CASTER], weapon: 'club' });
    expect(ridersOn(again)).toHaveLength(1);
    expect(ridersOn(again)[0]?.weapon).toBe('club');
    // The staff is a staff again.
    expect(swing(again, 'quarterstaff').damage).toBe(6 + 0);
    expect(swing(again, 'club').damage).toBe(8 + 4);
  });

  /**
   * "A **Club or Quarterstaff** you are holding" — the two the spell names,
   * and a Mace is neither.
   */
  it('refuses a weapon the spell does not name', () => {
    const refused = casting(table(), {
      spellId: 'shillelagh',
      targets: [CASTER],
      weapon: 'mace',
    });
    expect(isErr(refused)).toBe(true);
    if (isErr(refused)) expect(refused.code).toBe('weapon_not_named');
  });

  /** "you are holding" — and this caster has no Quarterstaff at all. */
  it('refuses a weapon the target has not got', () => {
    const refused = casting(table(1, ['mace']), {
      spellId: 'shillelagh',
      targets: [CASTER],
      weapon: 'quarterstaff',
    });
    expect(isErr(refused)).toBe(true);
    if (isErr(refused)) expect(refused.code).toBe('weapon_not_held');
  });
});

// — Magic Weapon ——————————————————————————————————————————————————————————

describe('Magic Weapon adds its plus to both rolls', () => {
  const armed = (slotLevel = 2, target: CharacterId = CASTER) =>
    cast(table(5), { spellId: 'magic-weapon', targets: [target], slotLevel, weapon: 'mace' });

  /**
   * "+1 bonus to attack rolls **and damage rolls**", which is why this is not
   * a `buff`: `BonusApplies` reaches an attack roll and never a damage roll,
   * and the plus is of the weapon's own type rather than a component of its
   * own — a Mace under Magic Weapon deals 7 Bludgeoning, not 6 Bludgeoning and
   * 1 of something else.
   */
  it('reaches the attack roll and the damage roll alike', () => {
    const plain = swing(table(5), 'mace');
    const magic = swing(armed(), 'mace');
    expect(magic.attack!.total).toBe(plain.attack!.total + 1);
    expect(magic.damage).toBe(plain.damage! + 1);
  });

  /**
   * "The bonus increases to +2 with a level 3–5 spell slot. The bonus
   * increases to +3 with a level 6+ spell slot." A band table read off the
   * slot, exactly as `durationAtSlot` is, and pinned at the casting.
   */
  it('reads the band the slot falls in', () => {
    const plain = swing(table(5), 'mace').damage!;
    expect(swing(armed(2), 'mace').damage).toBe(plain + 1);
    expect(swing(armed(3), 'mace').damage).toBe(plain + 2);
    expect(swing(armed(5), 'mace').damage).toBe(plain + 2);
    expect(swing(armed(6), 'mace').damage).toBe(plain + 3);
    expect(swing(armed(7), 'mace').damage).toBe(plain + 3);
  });

  it('leaves the rest of the pack alone', () => {
    const plain = swing(table(5), 'quarterstaff');
    const magic = swing(armed(), 'quarterstaff');
    expect(magic.attack!.total).toBe(plain.attack!.total);
    expect(magic.damage).toBe(plain.damage);
  });

  /**
   * **Range: Touch, so the grant lands on the creature touched.** Shillelagh
   * is Range: Self and cannot tell the two apart; this can. The ally's mace is
   * enchanted and the caster's own is not — which is the asymmetry
   * `attack-rider` records in the other direction, where the die belongs to
   * whoever swings however far away the quarry is.
   */
  it('hangs the grant on the creature it was cast at', () => {
    const log = armed(2, ALLY);
    expect(ridersOn(log, ALLY)).toHaveLength(1);
    expect(ridersOn(log, CASTER)).toEqual([]);
  });

  it('ends on its hour', () => {
    const log = armed();
    const later = [...log, ...must(advanceTime(state(log), 3700, 'a march'))];
    expect(ridersOn(later)).toEqual([]);
  });
});

// — a casting and a class feature reaching the same swing ————————————————————

/**
 * **The ordering ruling, which was asserted in a comment and by no test.**
 *
 * `strikeStyleFor` asks the casting's rider before the sheet's own styles, and
 * the reason is a reading rather than an accident: a style is something the
 * character *has* and a casting is something they just *did*, so the
 * deliberate act wins where both reach one swing. A Monk/Druid who spends a
 * Bonus Action on Shillelagh gets Shillelagh's die.
 *
 * **The fixture is built so that no other rule could produce the answer.** The
 * class style's die is a **d12** — bigger than Shillelagh's d8 and bigger than
 * the Quarterstaff's own d6 — so "the better die wins" predicts 12 and the
 * ordering predicts 8. And the style offers **Dexterity 20 (+5)** against
 * Shillelagh's Wisdom 18 (+4), so the better *modifier* predicts +5 and the
 * ordering predicts +4. Both discriminate, and they discriminate in the same
 * direction, which is what makes the pair worth having: moving the rider
 * branch below the style loop fails this and nothing else in the suite did.
 */
describe('a casting outranks a class style on the weapon it imbued', () => {
  /**
   * SRD Martial Arts' shape, with the two numbers chosen to lose the
   * comparison rather than to win it. `whileWieldingOnly` is deliberately
   * absent: this caster is carrying a rack of weapons and the gate is not what
   * is under test.
   */
  const MARTIAL_ARTS = {
    source: 'homebrew:martial-arts',
    name: 'Martial Arts',
    weapons: [{ category: 'simple' as const, kind: 'melee' as const }],
    die: '1d12',
    ability: 'dex' as const,
    bonusUnarmedStrike: true,
  };

  const monkish = (level = 1) =>
    table(level, ['quarterstaff', 'club', 'mace', 'dart'], {
      abilities: { str: 10, dex: 20, con: 10, int: 10, wis: 18, cha: 10 },
      strikeStyles: [MARTIAL_ARTS],
    });

  /** The control: with no casting in play, the class style is what answers. */
  it('leaves the class style in charge when no casting has touched the weapon', () => {
    const hit = swing(monkish(), 'quarterstaff');
    expect(hit.attack?.ability).toBe('dex');
    expect(hit.damage).toBe(12 + 5);
  });

  it('gives the imbued weapon the casting’s die and the casting’s ability', () => {
    const log = cast(monkish(), {
      spellId: 'shillelagh',
      targets: [CASTER],
      weapon: 'quarterstaff',
    });
    const hit = swing(log, 'quarterstaff');
    // Shillelagh's d8 and Wisdom, not the style's d12 and Dexterity — and
    // neither is the better of the two, which is the point.
    expect(hit.attack?.ability).toBe('wis');
    expect(hit.damage).toBe(8 + 4);
  });

  /**
   * **And it shadows the style nowhere else**, which is what makes putting it
   * first safe rather than merely convenient.
   *
   * A weapon rider is keyed on one weapon's catalogue id, so it can never
   * answer for a weapon the casting did not name — and it can never answer for
   * an Unarmed Strike at all, which every class style covers and no rider
   * could. A style with an empty `weapons` list in the same position would
   * have taken the Monk's fist away.
   */
  it('leaves the Monk’s other weapon and the Monk’s fist alone', () => {
    const log = cast(monkish(), {
      spellId: 'shillelagh',
      targets: [CASTER],
      weapon: 'quarterstaff',
    });
    // The Club in the same pack is a Monk weapon and no casting touched it.
    const club = swing(log, 'club');
    expect(club.attack?.ability).toBe('dex');
    expect(club.damage).toBe(12 + 5);

    // And the fist, which is the branch a rider can never reach.
    const fist = swing(log, null);
    expect(fist.attack?.ability).toBe('dex');
    expect(fist.damage).toBe(12 + 5);
  });

  /**
   * And a rider that changes **neither** die nor ability is not a style at all,
   * so it must not displace one. SRD Magic Weapon writes a plus and nothing
   * else; a Monk whose Mace it enchants keeps the Martial Arts die and gains
   * the +1 on top.
   */
  it('yields no style for a rider that only adds a plus', () => {
    const log = cast(monkish(5), {
      spellId: 'magic-weapon',
      targets: [CASTER],
      slotLevel: 2,
      weapon: 'mace',
    });
    const hit = swing(log, 'mace');
    expect(hit.attack?.ability).toBe('dex');
    // The style's d12 survives, and the plus is added to it rather than
    // replacing it with the Mace's own d6.
    expect(hit.damage).toBe(12 + 5 + 1);
  });
});

// — "melee attacks using that weapon" ——————————————————————————————————————

/**
 * SRD Shillelagh: "the attack and damage rolls of **melee** attacks using that
 * weapon".
 *
 * **Unreachable through the SRD catalogue and built anyway**, which is why it
 * needs a homebrew definition to be tested at all: Shillelagh narrows itself
 * to a Club and a Quarterstaff and both are Melee, so no SRD casting can put a
 * `meleeOnly` rider on a Ranged weapon and the predicate would never once
 * return false. Deleting the line was a green mutation before this.
 *
 * A Dart is the fixture because it is the one Ranged weapon in the book that
 * needs no ammunition: `kind: 'ranged'`, Simple, 1d4 Piercing, thrown.
 */
describe('a melee-only rider does nothing for a ranged weapon', () => {
  const definition = (meleeOnly: boolean) => ({
    id: 'homebrew-oil',
    name: 'Homebrew Oil',
    level: 1,
    school: 'transmutation',
    castingTime: 'action',
    concentration: false,
    range: { kind: 'touch' },
    targets: { count: 1, self: true },
    effects: [{ kind: 'weapon-rider', bonus: 2, ...(meleeOnly ? { meleeOnly: true } : {}) }],
    durationSeconds: 60,
  });

  const contentWith = (meleeOnly: boolean): Content =>
    unwrap(
      extendContent(SRD_CONTENT, {
        spells: [definition(meleeOnly) as unknown as SpellDefinition],
      }),
      'homebrew',
    );

  const oiled = (meleeOnly: boolean, weapon: string): readonly GameEvent[] => {
    // The same table, with the homebrew spell prepared: a caster who has not
    // prepared it is refused `spell_not_available` before any of this matters.
    const log: readonly GameEvent[] = table().map((event) =>
      event.type === 'spellcasting-declared'
        ? {
            ...event,
            spellcasting: declaredCasting({
              ability: 'wis',
              cantrips: ['shillelagh'],
              prepared: ['magic-weapon', 'cure-wounds', 'homebrew-oil'],
            }),
          }
        : event,
    );
    const content = contentWith(meleeOnly);
    const request = { spellId: 'homebrew-oil', targets: [CASTER], slotLevel: 1, weapon };
    return [
      ...log,
      ...must(
        resolveSpell(fold('seed', log), CASTER, request, {
          ...supply(),
          content,
        }),
      ).events,
    ];
  };

  it('is withheld from the Dart it was cast on', () => {
    expect(SRD_CONTENT.item('dart')?.weapon?.kind).toBe('ranged');
    const plain = swing(table(), 'dart');
    const narrowed = swing(oiled(true, 'dart'), 'dart');
    expect(narrowed.attack!.total).toBe(plain.attack!.total);
    expect(narrowed.damage).toBe(plain.damage);
  });

  /**
   * The other half, and what makes the first non-vacuous: the *same* casting
   * without the clause reaches the same Dart. Only the narrowing differs, so a
   * predicate that never fired would fail here instead.
   */
  it('reaches the same Dart when the spell does not print the clause', () => {
    const plain = swing(table(), 'dart');
    const open = swing(oiled(false, 'dart'), 'dart');
    expect(open.attack!.total).toBe(plain.attack!.total + 2);
    expect(open.damage).toBe(plain.damage! + 2);
  });

  /** And a melee weapon is reached either way, so the clause narrows and does not forbid. */
  it('reaches a melee weapon with the clause in place', () => {
    const plain = swing(table(), 'mace');
    const oil = swing(oiled(true, 'mace'), 'mace');
    expect(oil.damage).toBe(plain.damage! + 2);
  });

  /** And the predicate itself, asked directly, on the record a swing resolves. */
  it('answers off the weapon record the swing resolved', () => {
    const running = state(oiled(true, 'mace'));
    const creature = running.creatures[CASTER]!;
    expect(creature.weaponRiders).toHaveLength(1);
    expect(weaponRidersFor(creature, SRD_CONTENT.item('mace')!.weapon!)).toHaveLength(1);
    // The same rider, asked about a Ranged record: the id would match and the
    // kind does not.
    expect(
      weaponRidersFor(creature, { ...SRD_CONTENT.item('mace')!.weapon!, kind: 'ranged' }),
    ).toEqual([]);
    // And a swing with no weapon in it at all.
    expect(weaponRidersFor(creature, null)).toEqual([]);
  });
});

// — a readied casting, which is the second door the weapon travels through ——

/**
 * **The evidence for the two edits into `commands/actions.ts`.**
 *
 * SRD spends the slot at the Ready, so a readied casting states its facts
 * there and the release takes no fresh request — which is why `StatedFacts`
 * carries the damage type, the choice, the fought list and the teleport
 * destination. The weapon is the sixth, and without it a readied casting
 * reaches `resolveSpell` with nothing naming the weapon and is refused
 * `weapon_required` at the moment of release, after the slot has gone.
 *
 * **Neither SRD spell can be readied**, and that is worth saying rather than
 * discovering: SRD requires a readied spell's casting time to be an Action,
 * and Shillelagh and Magic Weapon are both a Bonus Action. So the field is
 * vocabulary rather than a road either of them travels, and the homebrew
 * definition above — whose casting time *is* an Action — is what drives it.
 * That is the same reason `attack-riders.test.ts` reaches for Mass Suggestion
 * to test a readied duration band.
 */
describe('a readied casting keeps the weapon it named', () => {
  const OIL: SpellDefinition = {
    id: 'homebrew-readied-oil',
    name: 'Homebrew Readied Oil',
    level: 1,
    school: 'transmutation',
    castingTime: 'action',
    concentration: false,
    range: { kind: 'touch' },
    targets: { count: 1, self: true },
    effects: [{ kind: 'weapon-rider', bonus: 2 }],
    durationSeconds: 60,
  } as unknown as SpellDefinition;

  const CONTENT: Content = unwrap(
    extendContent(SRD_CONTENT, { spells: [OIL] }),
    'readied homebrew',
  );

  const readied = (weapon: string): readonly GameEvent[] => {
    const base: readonly GameEvent[] = [
      ...table(1).map((event) =>
        event.type === 'spellcasting-declared'
          ? {
              ...event,
              spellcasting: declaredCasting({
                ability: 'wis',
                cantrips: ['shillelagh'],
                prepared: ['magic-weapon', 'cure-wounds', OIL.id],
              }),
            }
          : event,
      ),
      {
        type: 'combat-started',
        combatants: [
          { id: CASTER, initiative: 20, speed: 30 },
          { id: DUMMY, initiative: 10, speed: 30 },
        ],
      },
    ];
    const held: readonly GameEvent[] = [
      ...base,
      ...must(
        takeReady(
          fold('seed', base),
          CASTER,
          {
            trigger: 'when the goblin steps up',
            response: { kind: 'spell', spellId: OIL.id, slotLevel: 1, weapon },
          },
          CONTENT,
        ),
      ),
    ];
    return [
      ...held,
      ...must(
        releaseReady(
          fold('seed', held),
          CASTER,
          { targets: [CASTER] },
          { ...supply(), content: CONTENT },
        ),
      ).events,
    ];
  };

  /**
   * **Asserted on the grant and on the reader rather than on a swing**, and
   * the reason is the Ready itself: the action went at the Ready, so the
   * caster cannot also attack on that turn and `resolveAttack` refuses with
   * `no_action`. That every other test in this file drives the swing is what
   * makes reading the grant here enough — what is in doubt at this door is
   * whether the weapon survived the round trip, not what a rider does once it
   * has.
   */
  const staff = SRD_CONTENT.item('quarterstaff')!.weapon!;
  const club = SRD_CONTENT.item('club')!.weapon!;

  it('imbues the weapon the Ready named, and not another in the pack', () => {
    const creature = state(readied('quarterstaff')).creatures[CASTER]!;
    expect(creature.weaponRiders).toHaveLength(1);
    expect(creature.weaponRiders[0]?.weapon).toBe('quarterstaff');
    expect(creature.weaponRiders[0]?.bonus).toBe(2);

    // And the reader honours it for that weapon and no other.
    expect(weaponRidersFor(creature, staff)).toHaveLength(1);
    expect(weaponRidersFor(creature, club)).toEqual([]);
  });

  /** And the other weapon in the pack, to prove the id travelled rather than a default. */
  it('imbues the Club when the Club is what was named', () => {
    const creature = state(readied('club')).creatures[CASTER]!;
    expect(creature.weaponRiders[0]?.weapon).toBe('club');
    expect(weaponRidersFor(creature, club)).toHaveLength(1);
    expect(weaponRidersFor(creature, staff)).toEqual([]);
  });
});

// — the family it joins ————————————————————————————————————————————————————

describe('the fourteenth grant ends through the one door', () => {
  const armed = () =>
    cast(table(5), { spellId: 'magic-weapon', targets: [CASTER], slotLevel: 2, weapon: 'mace' });

  it('is enumerated beside the other thirteen', () => {
    expect(grantSourcesOf(state(armed()).creatures[CASTER]!)).toEqual(['Magic Weapon#cast:1']);
  });

  /** A grant nothing owned would leave the casting on nobody and undispellable. */
  it('puts the casting on the creature that holds it', () => {
    const running = state(armed());
    expect(spellOn(running, Object.values(running.ongoing)[0]!)).toEqual([CASTER]);
  });
});

// — the fact the casting states ————————————————————————————————————————————

describe('the weapon is stated, never guessed', () => {
  it('refuses a casting that names no weapon', () => {
    const refused = casting(table(), { spellId: 'shillelagh', targets: [CASTER] });
    expect(isErr(refused)).toBe(true);
    if (isErr(refused)) expect(refused.code).toBe('weapon_required');
  });

  /** The other half of the symmetry every stated fact keeps. */
  it('refuses a weapon named at a spell that enchants none', () => {
    const refused = casting(table(), {
      spellId: 'cure-wounds',
      targets: [CASTER],
      slotLevel: 1,
      weapon: 'mace',
    });
    expect(isErr(refused)).toBe(true);
    if (isErr(refused)) expect(refused.code).toBe('no_weapon_clause');
  });

  it('refuses a weapon that is not a weapon', () => {
    const refused = casting(table(), {
      spellId: 'shillelagh',
      targets: [CASTER],
      weapon: 'rope-hempen',
    });
    expect(isErr(refused)).toBe(true);
    if (isErr(refused)) expect(refused.code).toBe('unknown_weapon');
  });
});

// — the vocabulary ————————————————————————————————————————————————————————

describe('the validator holds a weapon rider to what a definition may say', () => {
  const definition = (effect: Record<string, unknown>): SpellDefinition =>
    ({
      id: 'homebrew',
      name: 'Homebrew',
      level: 1,
      school: 'transmutation',
      castingTime: 'action',
      concentration: false,
      range: { kind: 'touch' },
      targets: { count: 1, self: true },
      durationSeconds: 60,
      effects: [effect],
    }) as unknown as SpellDefinition;

  const problems = (effect: Record<string, unknown>): readonly string[] =>
    checkSpellDefinition(definition(effect)).map((p) => p.code);

  it('accepts the two shapes the SRD prints', () => {
    expect(problems({ kind: 'weapon-rider', bonus: 1, bonusAtSlot: { 3: 2 } })).toEqual([]);
    expect(
      problems({ kind: 'weapon-rider', die: '1d8', dieAtLevel: { 5: '1d10' }, castingAbility: true }),
    ).toEqual([]);
  });

  it('refuses a rider that does nothing at all', () => {
    expect(problems({ kind: 'weapon-rider' })).toContain('rider_does_nothing');
    expect(problems({ kind: 'weapon-rider', meleeOnly: true })).toContain('rider_does_nothing');
  });

  it('refuses a band with nothing to be a band of', () => {
    expect(problems({ kind: 'weapon-rider', bonusAtSlot: { 3: 2 } })).toContain('band_without_base');
    expect(problems({ kind: 'weapon-rider', dieAtLevel: { 5: '1d10' } })).toContain(
      'band_without_base',
    );
  });

  it('refuses dice that are not dice', () => {
    expect(problems({ kind: 'weapon-rider', die: 'a stick' })).toContain('bad_dice');
    expect(problems({ kind: 'weapon-rider', die: '1d8', dieAtLevel: { 5: 'a bigger stick' } })).toContain(
      'bad_dice',
    );
  });

  /**
   * A grant that outlives nothing. `checkGrantLifetimes` refuses every sourced
   * grant on an Instantaneous casting, and this is the fourteenth of them: a
   * weapon enchanted for ever by a spell that is over.
   */
  it('refuses the grant on an Instantaneous casting', () => {
    const instantaneous = {
      ...definition({ kind: 'weapon-rider', bonus: 1 }),
      durationSeconds: undefined,
    } as unknown as SpellDefinition;
    expect(checkSpellDefinition(instantaneous).map((p) => p.code)).toContain(
      'grant_without_lifetime',
    );
  });
});

// — what the catalogue now says ————————————————————————————————————————————

describe('the two SRD spells the shape was blocking', () => {
  const definitionOf = (spellId: string) => SPELL_DEFINITIONS.find((d) => d.id === spellId);

  it('defines Shillelagh and Magic Weapon', () => {
    expect(definitionOf('shillelagh')).toBeDefined();
    expect(definitionOf('magic-weapon')).toBeDefined();
  });

  it('writes each spell’s own table', () => {
    const shillelagh = definitionOf('shillelagh')!.effects[0] as Record<string, unknown>;
    expect(shillelagh.die).toBe('1d8');
    expect(shillelagh.dieAtLevel).toEqual({ 5: '1d10', 11: '1d12', 17: '2d6' });
    expect(shillelagh.weapons).toEqual(['club', 'quarterstaff']);

    const magicWeapon = definitionOf('magic-weapon')!.effects[0] as Record<string, unknown>;
    expect(magicWeapon.bonus).toBe(1);
    expect(magicWeapon.bonusAtSlot).toEqual({ 3: 2, 6: 3 });
  });
});
