import { err, ok, type Ability, type CharacterId, type Result, type RollMode } from '@ie/shared';
import type { Weapon, WeaponMastery, WeaponProperty } from '@ie/srd';
import { parseNotation, type DieEffect, type Rng } from './dice.js';
import type { Content } from './content.js';
// Type-only, and deliberately: `events.ts` reads this module's damage types
// the same way, so a value edge in either direction would be a real cycle.
import type { CreatureState } from './events.js';
import { modifierFor, proficiencyBonus, type CharacterSheet } from './character.js';
import { characterRollModes, combineRollModes, resolveStatedD20, type StatedD20 } from './checks.js';
import {
  flatBonusTotal,
  rollBonusDice,
  sumResolved,
  validateBonusDice,
  type Bonus,
  type ModeSource,
  type ResolvedBonus,
} from './bonuses.js';
import {
  attackerConditionModes,
  exhaustionBonus,
  isAutomaticCritical,
  targetConditionModes,
  type AttackerContext,
  type ConditionState,
  type TargetContext,
} from './conditions.js';
import {
  rollD20Recorded,
  rollRecorded,
  type RecordedD20,
  type RecordedRoll,
  type RollIssuer,
} from './rolls.js';

/**
 * Attack rolls and weapon damage — the third D20 Test, and the only one where
 * a natural 20 or natural 1 decides the outcome by itself.
 *
 * Rules verified against SRD 5.2.1 (see ATTRIBUTION.md).
 */

/**
 * Damage of a *different* type riding along with an attack.
 *
 * Flame Tongue deals "an extra 2d6 Fire damage" on top of the weapon's own
 * damage, and resistance applies per type — so this cannot be folded into the
 * weapon's damage without giving a fire-immune target the wrong answer.
 */
export interface ExtraDamage {
  readonly source: string;
  readonly type: string;
  readonly dice?: string;
  readonly flat?: number;
}

/**
 * Whether a character is proficient with this weapon.
 *
 * SRD gives four shapes and the last two are easy to flatten into "martial":
 *
 * | Class text | Category |
 * |---|---|
 * | "Simple weapons" | `simple` |
 * | "Simple and Martial weapons" | `martial` |
 * | "Martial weapons that have the Light property" (Monk) | `martial-light` |
 * | "Martial weapons that have the Finesse or Light property" (Rogue) | `martial-finesse-or-light` |
 *
 * A sheet that names no categories is proficient with everything, which is the
 * right answer for a stat block: a monster prints its attack bonus rather than
 * deriving one, so withholding a Proficiency Bonus from it would change a
 * number the block already stated.
 */
export function proficientWith(sheet: CharacterSheet, weapon: Weapon | null): boolean {
  const categories = sheet.weaponProficiencies;
  // SRD Unarmed Strike: "Your bonus to the roll equals your Strength modifier
  // plus your Proficiency Bonus" — there is no unproficient Unarmed Strike.
  if (weapon === null || categories === undefined) return true;

  return proficientWithCategories(categories, weapon);
}

/**
 * What the attacker says about the mastery property of the weapon in hand.
 *
 * Present at all means "use it"; what is inside says which, how far, and —
 * for Cleave — whom the extra swing follows.
 */
export interface MasteryUse {
  /**
   * SRD Tactical Master: "you can replace its mastery property with the Push,
   * Sap, or Slow property **for that attack**." Refused unless a feature said
   * this character may.
   */
  readonly property?: WeaponMastery;
  /** SRD Push: "up to 10 feet". Absent pushes the whole ten. */
  readonly feet?: number;
  /**
   * SRD Cleave: the creature already hit, whose neighbour this swing is
   * against. Its presence is what makes this attack the extra one.
   */
  readonly cleaving?: CharacterId;
}

/**
 * The two mastery properties the SRD does not ask permission for.
 *
 * Five of the eight are written "you can" — Cleave, Graze, Push, Slow, Topple
 * — and are a decision the attacker states. Sap and Vex are written as things
 * that happen: "that creature **has** Disadvantage", "you **have** Advantage".
 * So the split is the book's wording rather than a rule of this engine's, and
 * it is here rather than in five branches because it is one sentence about the
 * whole list.
 */
const UNASKED: readonly WeaponMastery[] = ['sap', 'vex'];

/**
 * Which mastery property is in play for this swing, if any.
 *
 * SRD: "Each weapon has a mastery property, which is usable only by a
 * character who has a feature, such as Weapon Mastery, that **unlocks the
 * property** for the character." So the weapon prints the property, the
 * character's record says whether it is theirs to use, and a swing with a
 * weapon nobody unlocked has no property at all.
 *
 * Refusing rather than ignoring when the attacker asked for one they do not
 * have: a mastery silently skipped is a rule the caller believes is running.
 */
export function masteryInPlay(
  sheet: CharacterSheet,
  weaponId: string | null,
  weapon: Weapon | null,
  asked: MasteryUse | undefined,
): Result<WeaponMastery | null> {
  const unlocked =
    weapon !== null && weaponId !== null && (sheet.weaponMasteries ?? []).includes(weaponId);

  if (asked === undefined) {
    return ok(unlocked && UNASKED.includes(weapon.mastery) ? weapon.mastery : null);
  }

  if (!unlocked) {
    return err(
      'no_mastery',
      weapon === null
        ? 'an Unarmed Strike has no mastery property'
        : `this character does not have mastery with a ${weapon.name}`,
    );
  }

  const substituted = asked.property;
  if (substituted === undefined || substituted === weapon.mastery) return ok(weapon.mastery);

  if (!(sheet.masterySubstitutions ?? []).includes(substituted)) {
    return err(
      'no_mastery',
      `nothing lets this character use ${substituted} in place of a ${weapon.name}'s own property`,
    );
  }
  return ok(substituted);
}

/**
 * The same question asked of a list of categories rather than of a sheet.
 *
 * Creation needs it before there is a sheet to ask: SRD Weapon Mastery's
 * "weapons of your choice with which you have proficiency" is checked while
 * the choices are still being validated. One rule, two callers, and the
 * qualified categories are the reason it is not four lines inlined twice.
 */
export function proficientWithCategories(
  categories: readonly string[],
  weapon: Weapon,
): boolean {
  const light = weapon.properties.includes('light');
  const finesse = weapon.properties.includes('finesse');

  return categories.some((category) => {
    switch (category) {
      case 'simple':
        return weapon.category === 'simple';
      case 'martial':
        return weapon.category === 'martial';
      case 'martial-light':
        return weapon.category === 'martial' && light;
      case 'martial-finesse-or-light':
        return weapon.category === 'martial' && (finesse || light);
      default:
        return false;
    }
  });
}

/**
 * A set of weapons, named the way the SRD names one.
 *
 * SRD writes such a set as a short bulleted list of category, kind and
 * property — Martial Arts' "Simple Melee weapons; Martial Melee weapons that
 * have the Light property" — so a set is a *list* of these and a weapon is in
 * it when it matches any one.
 *
 * **Not {@link proficientWith}'s four categories**, and the difference is the
 * SRD's own. A Monk is proficient with "Simple weapons and Martial weapons
 * that have the Light property" and their *Monk weapons* are the Melee halves
 * of the same two lines: a Light Crossbow is one of the first and none of the
 * second. Two sentences that differ are two declarations, and folding them
 * into one would quietly give a class benefits on a bow.
 *
 * An absent field asks nothing. `{}` therefore means every weapon, which is
 * what a style covering anything held would say.
 */
/**
 * The two axes a weapon row is sorted by, as values.
 *
 * The *type* of each is the parsed weapon record's own, held by `satisfies`,
 * so these cannot drift from what the equipment tables were parsed into. They
 * are values as well as types because `checkFeatureDefinition` has to hold a
 * catalogue that arrived as JSON to them, where the compiler was never asked.
 */
export const WEAPON_CATEGORIES = ['simple', 'martial'] as const satisfies readonly Weapon['category'][];
export const WEAPON_KINDS = ['melee', 'ranged'] as const satisfies readonly Weapon['kind'][];

export interface WeaponSelector {
  /** SRD's two weapon categories. Absent matches either. */
  readonly category?: (typeof WEAPON_CATEGORIES)[number];
  /** Melee or Ranged, as the equipment tables print it. Absent matches either. */
  readonly kind?: (typeof WEAPON_KINDS)[number];
  /**
   * Properties the weapon must have, **all** of them. Absent asks for none.
   *
   * SRD's closed nine, so the compiler holds a class file to them and
   * `checkFeatureDefinition` holds a catalogue that arrived as JSON to the
   * same list — a property nobody prints would otherwise make a selector match
   * nothing at all and the style would quietly cover less than it says.
   */
  readonly properties?: readonly WeaponProperty[];
}

/**
 * Whether this weapon is in the set these selectors name.
 *
 * An Unarmed Strike — `null` — is in no set of weapons, because it is not a
 * weapon. A rule that covers both says so in two clauses, exactly as SRD
 * Martial Arts does ("your Unarmed Strike **and** Monk weapons").
 */
export function weaponInSet(
  weapon: Weapon | null,
  selectors: readonly WeaponSelector[],
): boolean {
  if (weapon === null) return false;
  return selectors.some(
    (selector) =>
      (selector.category === undefined || weapon.category === selector.category) &&
      (selector.kind === undefined || weapon.kind === selector.kind) &&
      (selector.properties ?? []).every((property) => weapon.properties.includes(property)),
  );
}

/**
 * How far this weapon reaches in melee, in feet.
 *
 * SRD Reach: "This weapon adds 5 feet to your reach when you attack with it."
 * Everything else, an Unarmed Strike included, reaches five.
 */
export function meleeReach(weapon: Weapon | null): number {
  return weapon?.properties.includes('reach') === true ? 10 : 5;
}

/** The melee reach of whatever this creature is actually holding. */
export function reachOf(content: Content, creature: CreatureState): number {
  let reach = 5;
  for (const held of creature.equipped) {
    const weapon = content.item(held.id)?.weapon;
    if (weapon === undefined || weapon === null || weapon.kind !== 'melee') continue;
    reach = Math.max(reach, meleeReach(weapon));
  }
  return reach;
}

/**
 * The normal and long range of a ranged attack, or null for a melee one.
 *
 * A Thrown melee weapon uses its Thrown range; an Ammunition weapon uses its
 * own. A weapon that is neither is not making a ranged attack.
 */
export function rangeOf(
  weapon: Weapon | null,
  thrown: boolean,
): { readonly normal: number; readonly long: number } | null {
  if (weapon === null) return null;
  if (thrown) return weapon.thrownRange;
  return weapon.kind === 'ranged' ? weapon.ammunitionRange : null;
}

/**
 * A spell attack, and the bonus its caster brings to it.
 *
 * SRD "Spells" → "Attack Rolls": **"Spell attack modifier = your spellcasting
 * ability modifier + your Proficiency Bonus."** Both terms are already inside
 * `modifier`, pinned at the casting — so the weapon derivation must not run
 * beside it and add either of them again.
 *
 * **This exists because `weapon: null` cannot say it.** That sentinel is an
 * Unarmed Strike, whose bonus "equals your Strength modifier plus your
 * Proficiency Bonus", and the spell path borrowing it inherited an Unarmed
 * Strike's arithmetic on top of its own: a level 5 Wizard with Strength 16
 * rolled a Fire Bolt at +13 where the book says +7.
 *
 * `ability` is the spellcasting ability the attack is made with — "Varies (the
 * ability used is determined by the spellcaster's spellcasting feature)" in
 * the Attack Roll Abilities table. Null where nobody's spellcasting feature
 * decided it: an item that prints its own bonus in the hands of a wielder with
 * no spellcasting ability, which SRD answers with the number and names no
 * ability for. Nothing that reads an ability then reads one.
 */
export interface SpellAttack {
  readonly modifier: number;
  readonly ability: Ability | null;
  /**
   * Whether the book calls this a **ranged** spell attack.
   *
   * SRD prints one of two sentences and never neither: "Make a ranged spell
   * attack against the target" (Fire Bolt) or "Make a melee spell attack"
   * (Shocking Grasp). It is the attack's own range, stated by the spell, and
   * it is what {@link isRangedAttack} has to read here — a spell attack names
   * no weapon, so a rule that asks the weapon whether an attack is ranged gets
   * "no" for every spell in the book.
   */
  readonly ranged: boolean;
}

/**
 * A class's own way of striking, as it reaches one swing.
 *
 * Whether the style applies at all — its gate, and whether it covers the thing
 * being swung — is settled before this exists, by the command that can see the
 * creature's state and the catalogue. What arrives here is only what the style
 * changes about the arithmetic: a die rolled in place of the normal damage,
 * and an ability offered in place of the attack's own.
 *
 * It is beside `criticalOn` in spirit and for the same reason: `attack.ts` is
 * pure and holds no state, so a rule read off a creature is read by the
 * command and handed down.
 */
export interface StrikeStyleInPlay {
  /** The feature that grants it, so a refusal or a log can name the rule. */
  readonly source: string;
  /**
   * SRD Martial Arts Die: "You can roll 1d6 **in place of** the normal damage
   * of your Unarmed Strike or Monk weapons."
   *
   * *In place of*, not beside — so this replaces the weapon's own dice, or the
   * flat 1 an Unarmed Strike deals. See {@link rollAttackDamage} for which of
   * the two is used when the weapon's own is the better.
   */
  readonly die?: string;
  /**
   * SRD Dexterous Attacks: "You **can** use your Dexterity modifier instead of
   * your Strength modifier for the attack and damage rolls."
   *
   * An offer, not a substitution: see {@link attackAbility}.
   */
  readonly ability?: Ability;
}

/**
 * An attack a stat block **states**, as it reaches one swing.
 *
 * The third way an attack's arithmetic can be settled, beside a weapon's and a
 * spell's, and it is the simplest of the three: everything is printed. SRD
 * Wolf: "_Melee Attack Roll:_ +4, reach 5 ft. _Hit:_ 5 (1d6 + 2) Piercing
 * damage." The +4 is the whole bonus and the +2 is the whole modifier —
 * neither is an ability's, neither is a Proficiency Bonus, and a pipeline that
 * derived either would add it a second time.
 *
 * **`weapon: null` cannot say this**, for the reason {@link SpellAttack}
 * records: that sentinel is an Unarmed Strike, which deals 1 plus Strength and
 * rolls at Strength plus proficiency. A Wolf given it bites for 3 with a +4
 * that happened to agree — the numbers of a creature nobody printed.
 *
 * Which of the two the swing is — melee or ranged — is settled by the command,
 * because a block that prints both offers the attacker the choice and only the
 * command can see the distance.
 */
export interface StatedAttackInPlay {
  /** The printed name, for the log and for each damage component. */
  readonly source: string;
  /** The printed bonus to the attack roll, used whole. */
  readonly modifier: number;
  /** Whether this swing is the ranged half of the line. */
  readonly ranged: boolean;
  /** Every damage component the line prints, in printed order. */
  readonly damage: readonly StatedDamage[];
}

/** One component of a stated attack's damage: `5 (1d6 + 2) Piercing`. */
export interface StatedDamage {
  readonly dice: string | null;
  readonly flat: number;
  readonly type: string;
}

export interface AttackOptions {
  /** The weapon used, or null for an Unarmed Strike. */
  readonly weapon: Weapon | null;
  /**
   * Set when the attack is one a stat block prints rather than a weapon's.
   *
   * Exclusive with {@link AttackOptions.spellAttack} and with a weapon: all
   * three are answers to "where do this attack's numbers come from", and the
   * command refuses a swing that names two.
   */
  readonly statedAttack?: StatedAttackInPlay;
  /**
   * A class feature that redefines this attack — the Monk's growing fist, and
   * whatever a homebrew class writes with the same grant.
   *
   * Set by the command, which resolved it against the creature's own state.
   * Absent for every creature no such feature belongs to, which is nearly
   * every creature: the arithmetic below is then exactly what it always was.
   */
  readonly strikeStyle?: StrikeStyleInPlay;
  /** Set when this is a spell attack rather than a weapon's or a fist's. */
  readonly spellAttack?: SpellAttack;
  readonly targetAc: number;
  /**
   * The lowest natural d20 that scores a Critical Hit. 20 unless a feature
   * lowers it — SRD Improved Critical and Superior Critical are the two that
   * do. Read off the attacker's sheet by `resolveAttack`.
   */
  readonly criticalOn?: number;
  /** Whether the attacker is proficient. Defaults to true. */
  readonly proficient?: boolean;
  /** Wielded in two hands, for a Versatile weapon. */
  readonly twoHanded?: boolean;
  /** Thrown rather than swung, for a Thrown weapon. */
  readonly thrown?: boolean;
  /**
   * Which ability to use **where a rule offers the attacker a choice of two**.
   * Defaults to the better one.
   *
   * Named for SRD Finesse — "your choice of your Strength or Dexterity
   * modifier" — which was the only such rule when the field was written. SRD
   * Dexterous Attacks is the second and is the same sentence in different
   * words, so it is answered through the same field rather than through a
   * second one: `PendingAttack` carries this so a held attack rolls its damage
   * with the ability it was made with, and a second field meaning the same
   * thing would be two answers to one question.
   */
  readonly finesseAbility?: 'str' | 'dex';
  /** Situational advantage or disadvantage from the fiction. */
  readonly modes?: readonly (RollMode | ModeSource)[];
  /**
   * A die thrown at a table rather than by the engine — see {@link StatedD20}.
   *
   * Absent for every attack an AI-held surface can cause: no command carries
   * this field, so nothing above the engine can reach it, and the door a human
   * table knocks on is its own and is never a model's.
   */
  readonly statedRoll?: StatedD20;
  readonly beyondNormalRange?: boolean;
  /** An enemy is within 5 feet, which hampers a ranged attack. */
  readonly nearbyEnemy?: boolean;
  /** Modifiers to the attack roll: a magic weapon, Archery, Bless. */
  readonly attackBonuses?: readonly Bonus[];
  /** Modifiers to damage *of the weapon's own type*: a magic weapon, Dueling. */
  readonly damageBonuses?: readonly Bonus[];
  /** Damage of other types: Flame Tongue's fire, a Divine Smite's radiant. */
  readonly extraDamage?: readonly ExtraDamage[];
  /**
   * SRD Cleave: "the second creature takes the weapon's damage, but **don't add
   * your ability modifier** to that damage unless that modifier is negative."
   *
   * The clause keeps a negative modifier, so this floors the modifier at zero
   * rather than dropping it — which is the whole of the sentence and the reason
   * it is not a boolean the caller has to read as "no modifier".
   */
  readonly withoutAbilityModifier?: true;
  /**
   * Per-die rules applied to damage rolls — Great Weapon Fighting, and anything
   * else that reads or reacts to an individual die.
   */
  readonly damageEffects?: readonly DieEffect[];
  /** The attacker's own conditions: Blinded, Poisoned, Prone, Invisible. */
  readonly attackerConditions?: ConditionState;
  /** The target's conditions: Prone, Restrained, Paralyzed, Invisible. */
  readonly targetConditions?: ConditionState;
  readonly attackerContext?: AttackerContext;
  readonly targetContext?: TargetContext;
  /** The attacker is within 5 feet — flips Prone, and enables automatic crits. */
  readonly withinFiveFeet?: boolean;
}

const has = (weapon: Weapon | null, property: string): boolean =>
  weapon?.properties.some((p) => p === property) === true;

/**
 * A ranged attack: one made at a range rather than in reach.
 *
 * **The attack's own range answers this, not the weapon behind it.** A spell
 * attack has no weapon at all and states which of the two it is — so asking
 * `weapon.kind` made every Fire Bolt in the engine a melee attack, and the
 * Disadvantage SRD puts on a ranged attack with an enemy at your elbow never
 * once reached a caster. Where a weapon *is* behind it, the weapon is the only
 * thing that can say: a ranged weapon, or a melee one being thrown.
 */
function isRangedAttack(options: AttackOptions): boolean {
  if (options.spellAttack !== undefined) return options.spellAttack.ranged;
  // A printed line says which of the two it is in the same words a spell does
  // — "_Ranged Attack Roll:_" — and has no weapon behind it to ask.
  if (options.statedAttack !== undefined) return options.statedAttack.ranged;
  return options.weapon?.kind === 'ranged' || options.thrown === true;
}

/**
 * SRD "Attack Roll Abilities": Strength for a melee weapon or Unarmed Strike,
 * Dexterity for a ranged weapon.
 *
 * Finesse lets you choose between them — and Thrown keeps a melee weapon on its
 * melee ability, so a thrown Dagger is still Finesse rather than automatically
 * Dexterity.
 *
 * The table's third row is "Varies" — a spell attack uses whichever ability
 * the caster's spellcasting feature named, which is why a {@link SpellAttack}
 * carries its own rather than falling through to the Strength an Unarmed
 * Strike shares its sentinel with.
 *
 * **A style offers an ability; it does not impose one.** SRD Dexterous Attacks
 * says "you **can** use your Dexterity modifier instead of your Strength
 * modifier", which is Finesse's "your choice" in different words — so it gets
 * Finesse's reading: the attacker's own answer if they gave one, and otherwise
 * whichever of the two is better for them. A Monk with Strength 16 and
 * Dexterity 12 punches with Strength, and one who says `str` punches with
 * Strength whatever their scores.
 */
export function attackAbility(sheet: CharacterSheet, options: AttackOptions): Ability {
  const weapon = options.weapon;

  const spell = options.spellAttack;
  if (spell !== undefined && spell.ability !== null) return spell.ability;

  const chosen = options.finesseAbility;
  const better = (one: Ability, other: Ability): Ability =>
    modifierFor(sheet, one) > modifierFor(sheet, other) ? one : other;

  // What the attack would be made with if no feature had anything to say.
  let ability: Ability;
  if (has(weapon, 'finesse')) {
    // SRD leaves the choice to the player; default to whichever is better.
    ability = chosen ?? better('dex', 'str');
  } else {
    ability = weapon?.kind === 'ranged' ? 'dex' : 'str';
  }

  const offered = options.strikeStyle?.ability;
  if (offered === undefined || offered === ability) return ability;
  // Naming either of the two the rule puts on the table settles it; naming
  // neither — or naming nothing — takes the better of them, as Finesse does.
  if (chosen === offered || chosen === ability) return chosen;
  return better(offered, ability);
}

/**
 * The flat part of the attack roll: ability, proficiency, and every flat bonus.
 * Dice bonuses such as Bless are rolled separately by {@link rollAttack}.
 *
 * SRD Unarmed Strike: "Your bonus to the roll equals your Strength modifier
 * plus your Proficiency Bonus" — there is no unproficient unarmed strike.
 *
 * SRD "Spells" → "Attack Rolls": "**Spell attack modifier** = your spellcasting
 * ability modifier + your Proficiency Bonus." A spell attack states that sum
 * outright, so the derivation above it — an ability modifier and a Proficiency
 * Bonus — is the *same two terms* and adding them again is adding them twice.
 * See {@link SpellAttack} for why one sentinel could not say both.
 */
export function attackModifier(sheet: CharacterSheet, options: AttackOptions): number {
  const exhaustion =
    options.attackerConditions === undefined ? null : exhaustionBonus(options.attackerConditions);
  const situational = flatBonusTotal(options.attackBonuses) + (exhaustion?.flat ?? 0);

  // Stated, not derived: the caster's own two terms are already in it, and an
  // item that printed a bonus has settled it for a wielder who has neither.
  if (options.spellAttack !== undefined) return options.spellAttack.modifier + situational;

  // The same sentence about a stat block's line. "+4" is the bonus, whole; a
  // Wolf's Strength modifier and a Proficiency Bonus are already inside it,
  // and adding them again is adding them twice.
  if (options.statedAttack !== undefined) return options.statedAttack.modifier + situational;

  const ability = attackAbility(sheet, options);
  const proficient = options.weapon === null || (options.proficient ?? true);
  return (
    modifierFor(sheet, ability) + (proficient ? proficiencyBonus(sheet) : 0) + situational
  );
}

export function attackRollModes(sheet: CharacterSheet, options: AttackOptions): ModeSource[] {
  const modes: ModeSource[] = [];
  const weapon = options.weapon;
  const ability = attackAbility(sheet, options);

  // SRD Heavy: Disadvantage if it's a Melee weapon and Strength isn't at least
  // 13, or a Ranged weapon and Dexterity isn't at least 13. Note this reads the
  // *score*, not the modifier — 12 and 13 share a +1 but differ here.
  if (has(weapon, 'heavy') && weapon !== null) {
    const required = weapon.kind === 'melee' ? 'str' : 'dex';
    if (sheet.abilities[required] < 13) {
      modes.push({ source: `${weapon.name} is Heavy`, mode: 'disadvantage' });
    }
  }

  // SRD: "Your attack roll has Disadvantage when your target is beyond normal
  // range" — and beyond long range it is not a legal attack at all, which is
  // the caller's check to make.
  if (options.beyondNormalRange === true) {
    modes.push({ source: 'beyond normal range', mode: 'disadvantage' });
  }

  // SRD: a ranged attack has Disadvantage within 5 feet of a capable enemy.
  if (options.nearbyEnemy === true && isRangedAttack(options)) {
    modes.push({ source: 'enemy within 5 feet', mode: 'disadvantage' });
  }

  // Untrained armour hampers any Strength or Dexterity D20 Test, attacks
  // included. A spell attack whose bonus an item printed for a wielder with no
  // spellcasting ability involves no ability of theirs at all, so the rule has
  // nothing to read and gives no answer rather than reading the Strength the
  // weaponless sentinel falls back to. A stat block's printed line is the same
  // absence: "+4" involves no ability of the Wolf's, and SRD gives a monster
  // training with any armour in its own block besides.
  if (
    options.statedAttack === undefined &&
    (options.spellAttack === undefined || options.spellAttack.ability !== null)
  ) {
    modes.push(...characterRollModes(sheet, ability, null));
  }

  // Conditions on both sides of the attack.
  const targetContext: TargetContext = {
    ...options.targetContext,
    ...(options.withinFiveFeet === undefined ? {} : { withinFiveFeet: options.withinFiveFeet }),
  };
  if (options.attackerConditions !== undefined) {
    modes.push(...attackerConditionModes(options.attackerConditions, options.attackerContext ?? {}));
  }
  if (options.targetConditions !== undefined) {
    modes.push(...targetConditionModes(options.targetConditions, targetContext));
  }

  return modes;
}

export interface AttackResult {
  /**
   * The ability this attack was actually made with, or null where it was made
   * with none.
   *
   * There are two of the second, and both are an attack whose bonus somebody
   * printed. A spell attack from an item, in the hands of a wielder with no
   * spellcasting ability: SRD's Attack Roll Abilities table gives a spell
   * attack "Varies (the ability used is determined by the spellcaster's
   * spellcasting feature)" and that wielder has no such feature — the book
   * answers them with the item's number and names no ability at all. And a
   * stat block's printed line, which states "+4" and says nothing whatever
   * about where the +4 came from.
   *
   * It said `str` until this was nullable, because that is where
   * {@link attackAbility} lands when nothing else claims the roll, and that
   * fallback is the Unarmed Strike's row. A result naming an ability the
   * attack was not made with is the same failure as a total that does not add
   * up: the audit trail says something the dice did not do. Nothing reads it
   * for arithmetic — the modifier was stated, not derived — so nothing is
   * being asked to handle a null it would have to invent an answer for.
   */
  readonly ability: Ability | null;
  readonly mode: RollMode;
  readonly roll: RecordedD20;
  /** Bonuses that rolled dice, e.g. Bless. Flat bonuses are already in `roll`. */
  readonly bonuses: readonly ResolvedBonus[];
  /** The d20 result plus every bonus — what is actually compared to AC. */
  readonly total: number;
  readonly targetAc: number;
  readonly hit: boolean;
  readonly critical: boolean;
}

export function rollAttack(
  issuer: RollIssuer,
  rng: Rng,
  sheet: CharacterSheet,
  options: AttackOptions,
): Result<AttackResult> {
  // Validate before rolling: a malformed bonus must not leave the generator
  // advanced and a roll id consumed behind a returned error.
  const valid = validateBonusDice(options.attackBonuses);
  if (!valid.ok) return valid;

  // **What the attack was made with, and what it can honestly say it was made
  // with.** For everything but one case these are the same answer.
  // `attackAbility` has to return an `Ability` because the damage modifier is
  // read off it, and its last line is the Unarmed Strike's `str` — which is a
  // real answer for a fist and a fabricated one for a spell attack whose bonus
  // an item printed. See {@link AttackResult.ability}.
  // A stat block names no ability either: the line prints a bonus and nothing
  // about where it came from, so the result says so rather than reporting the
  // Strength the weaponless sentinel falls back to.
  const named =
    options.statedAttack !== undefined
      ? null
      : options.spellAttack === undefined
        ? attackAbility(sheet, options)
        : options.spellAttack.ability;
  const mode = combineRollModes([...attackRollModes(sheet, options), ...(options.modes ?? [])]);

  // Flat bonuses ride on the d20's own modifier; dice bonuses are rolled after.
  // A die the table threw enters here and nowhere else: the modifier, the mode
  // and everything below are the engine's either way, and a refused face
  // returns before the bonus dice are thrown, so it leaves the generator where
  // it found it.
  const modifier = attackModifier(sheet, options);
  const stated =
    options.statedRoll === undefined
      ? ok(rollD20Recorded(issuer, rng, mode, modifier))
      : resolveStatedD20(issuer, options.statedRoll, mode, modifier);
  if (!stated.ok) return stated;
  const roll = stated.value;

  const bonuses = rollBonusDice(issuer, rng, options.attackBonuses);
  if (!bonuses.ok) return bonuses;

  const total = roll.total + sumResolved(bonuses.value);

  // SRD "Rolling 20 or 1": a natural 20 hits regardless of modifiers or AC, and
  // a natural 1 misses regardless. This is the one D20 Test where the die face
  // overrides the total.
  //
  // A feature may lower which face scores a Critical Hit — SRD Improved
  // Critical: "can score a Critical Hit on a roll of 19 or 20" — and the
  // auto-hit follows it rather than staying pinned to the number 20. The
  // glossary binds the two in one sentence: "you score a Critical Hit, **and
  // the attack hits** regardless of any modifiers or the target's AC." So a
  // Champion's 19 hits an Armour Class it could not otherwise reach.
  //
  // A natural 1 is untouched. No SRD feature raises the miss face, and the
  // sentence that sets it names the number rather than a rule.
  const criticalOn = options.criticalOn ?? 20;
  const naturalCritical = roll.natural >= criticalOn && !roll.isCriticalMiss;
  const hit = naturalCritical || (!roll.isCriticalMiss && total >= options.targetAc);

  // SRD Paralyzed and Unconscious: "Any attack roll that hits you is a Critical
  // Hit if the attacker is within 5 feet of you." A hit that was not a natural
  // 20 still becomes a critical.
  const automaticCritical =
    hit &&
    options.targetConditions !== undefined &&
    isAutomaticCritical(options.targetConditions, options.withinFiveFeet === true);

  return ok({
    ability: named,
    mode,
    roll,
    bonuses: bonuses.value,
    total,
    targetAc: options.targetAc,
    hit,
    critical: naturalCritical || automaticCritical,
  });
}

/** One typed slice of an attack's damage. */
export interface DamageComponent {
  /** Where it came from: the weapon, "Flame Tongue", "Dueling". */
  readonly source: string;
  readonly type: string;
  readonly roll: RecordedRoll | null;
  readonly flat: number;
  readonly total: number;
}

/** What a set of components comes to before anything is taken off. */
export const rawDamageTotal = (components: readonly DamageComponent[]): number =>
  components.reduce((sum, c) => sum + Math.max(0, c.total), 0);

/**
 * Damage taken away after the roll, by something like Cutting Words.
 *
 * Kept alongside the components rather than folded into them, because the
 * reduction is not damage of any type — subtracting it from the slashing
 * component would make a fire-immune target's arithmetic wrong.
 */
export interface DamageReduction {
  readonly source: string;
  readonly roll: RecordedRoll | null;
  readonly amount: number;
}

export interface AttackDamage {
  /**
   * Damage broken out by type and source. Resistance applies per type, so a
   * flaming sword against a fire-immune target still deals its slashing.
   */
  readonly components: readonly DamageComponent[];
  readonly critical: boolean;
  /** Reductions applied after the roll, e.g. Cutting Words. */
  readonly reductions: readonly DamageReduction[];
  /** Sum of every component less any reductions, before the target's defences. */
  readonly total: number;
}

/** SRD Unarmed Strike damage: 1 Bludgeoning plus the Strength modifier. */
const UNARMED_DAMAGE = { fixed: 1, type: 'bludgeoning' } as const;

/**
 * SRD Critical Hits: "Roll the attack's damage dice twice ... If the attack
 * involves other damage dice, such as from the Rogue's Sneak Attack feature,
 * you also roll those dice twice." Every damage die doubles; flat modifiers do
 * not.
 */
function doubledOnCrit(notation: string, critical: boolean): Result<string> {
  const parsed = parseNotation(notation);
  if (!parsed.ok) return parsed;
  const count = critical ? parsed.value.count * 2 : parsed.value.count;
  return ok(`${count}d${parsed.value.sides}`);
}

/**
 * What a damage expression comes to on average, for comparing two of them.
 *
 * Unparseable notation is worth nothing, which is the safe direction: a
 * malformed style die then loses to the weapon's own rather than replacing it,
 * and the catalogue validator is what refuses the malformed die at the door.
 */
function averageDamage(dice: string | null, fixed: number | null): number {
  const flat = fixed ?? 0;
  if (dice === null) return flat;
  const parsed = parseNotation(dice);
  if (!parsed.ok) return flat;
  return flat + (parsed.value.count * (parsed.value.sides + 1)) / 2;
}

export function rollAttackDamage(
  issuer: RollIssuer,
  rng: Rng,
  sheet: CharacterSheet,
  options: AttackOptions,
  critical: boolean,
): Result<AttackDamage> {
  const weapon = options.weapon;

  // Every notation in play — the weapon's, each bonus's, each extra damage —
  // is checked before a single die is thrown.
  const valid = validateBonusDice([
    ...(options.damageBonuses ?? []),
    ...(options.extraDamage ?? []).map((e) => ({ source: e.source, ...(e.dice === undefined ? {} : { dice: e.dice }) })),
  ]);
  if (!valid.ok) return valid;

  const effects = options.damageEffects ?? [];
  const ownModifier = modifierFor(sheet, attackAbility(sheet, options));
  const modifier =
    options.withoutAbilityModifier === true ? Math.min(0, ownModifier) : ownModifier;
  const components: DamageComponent[] = [];

  // **A stated attack's damage is printed whole**, so the weapon derivation
  // below must not run beside it: `5 (1d6 + 2)` already holds whatever
  // modifier the book put in it, and the Unarmed Strike's flat 1 belongs to
  // nobody here. Every component the line prints is rolled in its own type,
  // and the bonuses and extra damage the caller brought ride on top exactly as
  // they do for a weapon — of the *first* component's type, which is the
  // component a printed line leads with and the one the block calls the
  // attack's own.
  const stated = options.statedAttack;
  if (stated !== undefined) {
    for (const part of stated.damage) {
      if (part.dice === null) {
        components.push({
          source: stated.source,
          type: part.type,
          roll: null,
          flat: part.flat,
          total: part.flat,
        });
        continue;
      }
      const notation = doubledOnCrit(part.dice, critical);
      if (!notation.ok) return notation;
      const outcome = rollRecorded(issuer, rng, notation.value, effects);
      if (!outcome.ok) return outcome;
      components.push({
        source: stated.source,
        type: part.type,
        roll: outcome.value,
        flat: part.flat,
        total: outcome.value.total + part.flat,
      });
    }

    // A bonus is of the attack's own type, and a printed line's own type is
    // the one it leads with: the Ghoul bites for Piercing "plus" Necrotic, and
    // the Piercing is what the block calls the bite. The schema promises a
    // component, so the fallback below is the weaponless sentinel's type and
    // is reached by nothing.
    const ownType = stated.damage[0]?.type ?? UNARMED_DAMAGE.type;
    const rest = rollAddedDamage(issuer, rng, options, critical, effects, ownType);
    if (!rest.ok) return rest;
    const all = [...components, ...rest.value];
    return ok({
      components: all,
      critical,
      reductions: [],
      total: all.reduce((sum, c) => sum + Math.max(0, c.total), 0),
    });
  }

  // SRD Versatile: the parenthesised die applies when used with two hands.
  const normalDice =
    weapon === null
      ? null
      : options.twoHanded === true && weapon.versatileDamage !== null
        ? weapon.versatileDamage
        : weapon.damage.dice;

  const type = weapon === null ? UNARMED_DAMAGE.type : weapon.damage.type;
  const normalFixed = weapon === null ? UNARMED_DAMAGE.fixed : weapon.damage.fixed;
  const source = weapon?.name ?? 'Unarmed Strike';

  // **SRD Martial Arts Die: "You *can* roll 1d6 in place of the normal damage
  // of your Unarmed Strike or Monk weapons."**
  //
  // "Can", so the style's die does not simply displace the weapon's: a Monk 1
  // with a Quarterstaff in two hands keeps its 1d8 over the style's 1d6, which
  // is what the SRD's permission is *for*. The die replaces the normal damage
  // rather than joining it, so the flat 1 an Unarmed Strike deals goes with
  // the dice it stands in for.
  //
  // **Unlike `attackAbility`'s offer, this is a default and not a choice**, and
  // the asymmetry is deliberate rather than an oversight. The ability the
  // attacker picks is read by things beyond the roll — Rage Damage is "when you
  // make an attack using Strength", and the modifier lands on the damage — so
  // there is a reason to elect the *worse* score and a field to elect it with.
  // Nothing downstream reads which die was thrown, so the larger average is the
  // whole of what the permission is worth, and a field to decline it would be a
  // question with one answer. The day a feature reads the die — SRD Empowered
  // Strikes is the nearest — is the day this wants one.
  const styleDie = options.strikeStyle?.die;
  const inPlaceOf =
    styleDie !== undefined &&
    averageDamage(styleDie, null) > averageDamage(normalDice, normalFixed)
      ? styleDie
      : null;
  const dice = inPlaceOf ?? normalDice;
  const fixed = inPlaceOf === null ? normalFixed : null;

  // The weapon's own damage, carrying the ability modifier.
  if (dice === null) {
    // Flat damage — the Blowgun, and Unarmed Strikes. No dice to double.
    if (fixed === null) {
      return err('no_damage', `${source} has neither damage dice nor a flat amount`);
    }
    components.push({
      source,
      type,
      roll: null,
      flat: fixed + modifier,
      total: fixed + modifier,
    });
  } else {
    const notation = doubledOnCrit(dice, critical);
    if (!notation.ok) return notation;
    const outcome = rollRecorded(issuer, rng, notation.value, effects);
    if (!outcome.ok) return outcome;
    components.push({
      source,
      type,
      roll: outcome.value,
      flat: modifier,
      total: outcome.value.total + modifier,
    });
  }

  const added = rollAddedDamage(issuer, rng, options, critical, effects, type);
  if (!added.ok) return added;
  const all = [...components, ...added.value];

  const total = all.reduce((sum, c) => sum + Math.max(0, c.total), 0);

  return ok({ components: all, critical, reductions: [], total });
}

/**
 * Everything that rides along with an attack's own damage: the bonuses of its
 * type, and the extra damage of other types.
 *
 * One function because there are two attacks that have their own damage — a
 * weapon's and a stat block's printed line — and two copies of this walk is
 * how the two would come to disagree about whether a Vicious Weapon's dice
 * double on a critical.
 *
 * `ownType` is what a *bonus* is of: a bonus meets Resistance with the blade,
 * so it takes the attack's own type rather than naming one.
 */
function rollAddedDamage(
  issuer: RollIssuer,
  rng: Rng,
  options: AttackOptions,
  critical: boolean,
  effects: readonly DieEffect[],
  ownType: string,
): Result<readonly DamageComponent[]> {
  const components: DamageComponent[] = [];

  // Bonuses to the attack's own damage type: a +1 weapon, Dueling, Rage.
  for (const bonus of options.damageBonuses ?? []) {
    let roll: RecordedRoll | null = null;
    if (bonus.dice !== undefined) {
      const notation = doubledOnCrit(bonus.dice, critical);
      if (!notation.ok) return notation;
      const outcome = rollRecorded(issuer, rng, notation.value, effects);
      if (!outcome.ok) return outcome;
      roll = outcome.value;
    }
    const flat = bonus.flat ?? 0;
    components.push({
      source: bonus.source,
      type: ownType,
      roll,
      flat,
      total: (roll?.total ?? 0) + flat,
    });
  }

  // Damage of other types, which must stay separate for resistance.
  for (const extra of options.extraDamage ?? []) {
    let roll: RecordedRoll | null = null;
    if (extra.dice !== undefined) {
      const notation = doubledOnCrit(extra.dice, critical);
      if (!notation.ok) return notation;
      const outcome = rollRecorded(issuer, rng, notation.value, effects);
      if (!outcome.ok) return outcome;
      roll = outcome.value;
    }
    const flat = extra.flat ?? 0;
    components.push({
      source: extra.source,
      type: extra.type,
      roll,
      flat,
      total: (roll?.total ?? 0) + flat,
    });
  }

  return ok(components);
}

/**
 * Take damage away after it has been rolled.
 *
 * SRD Cutting Words: "when a creature ... makes a damage roll ... roll your
 * Bardic Inspiration die, and subtract the number rolled from the creature's
 * roll, **reducing the damage**". So this is not only a d20-test effect — the
 * same Reaction can blunt a hit that has already landed.
 *
 * The reduction comes off the total rather than off a component, because it is
 * not damage of any type. Subtracting it from the slashing half of a flaming
 * sword would give a fire-immune target the wrong answer, which is the exact
 * error typed components exist to prevent.
 */
export function reduceDamage(
  issuer: RollIssuer,
  rng: Rng,
  damage: AttackDamage,
  reduction: { readonly source: string; readonly flat?: number; readonly dice?: string },
): Result<AttackDamage> {
  const rolled = rollBonusDice(issuer, rng, [reduction]);
  if (!rolled.ok) return rolled;

  const amount = (reduction.flat ?? 0) + sumResolved(rolled.value);
  const applied: DamageReduction = {
    source: reduction.source,
    roll: rolled.value[0]?.roll ?? null,
    amount,
  };

  return ok({
    ...damage,
    reductions: [...damage.reductions, applied],
    // Damage never goes below zero, however much is subtracted.
    total: Math.max(0, damage.total - amount),
  });
}

export interface DamageDefenses {
  readonly immune?: boolean;
  readonly resistant?: boolean;
  readonly vulnerable?: boolean;
}

/**
 * Which of the three answers a defence gives.
 *
 * The same three {@link DamageDefenses} holds, named so a *grant* can carry
 * one of them rather than a record of booleans: an effect grants Resistance,
 * or Immunity, or Vulnerability, and no SRD sentence grants two at once.
 */
export type DefenseKind = 'resistant' | 'immune' | 'vulnerable';

/**
 * A defence an ongoing effect has hung on a creature.
 *
 * The fourth member of the family `bonuses`, `armorClasses` and
 * `rollModifiers` already form, and it needed no new lifecycle: the casting is
 * in the `source`, so `releaseCasting` and `releaseOnTarget` end it with the
 * spell through the door the other three already use.
 *
 * **Separate from `CreatureState.defenses`, which is the stat block's.** That
 * table is written when the creature enters the game and holds only
 * *unconditional* entries — a qualified one ("except from its vampire master")
 * deliberately stays out of it, because no boolean captures a qualification.
 * A grant is unconditional by construction, and keeping the two apart is what
 * lets one end without disturbing the other.
 *
 * **A list of types rather than one**, because the SRD writes it plural:
 * Stoneskin's "Resistance to Bludgeoning, Piercing, and Slashing damage" is
 * one sentence, one casting and one thing to end.
 */
export interface GrantedDefense {
  /** The casting (`Stoneskin#cast:3`) or the feature that granted it. */
  readonly source: string;
  /** Lower-cased, so it keys the same table `applyDamage` sums into. */
  readonly damageTypes: readonly string[];
  readonly defense: DefenseKind;
}

/**
 * SRD "Order of Application": adjustments such as bonuses, penalties or
 * multipliers first; Resistance second; Vulnerability third.
 *
 * The order is load-bearing. The SRD's own example: 28 Fire damage, an aura
 * reducing damage by 5, Resistance to all damage and Vulnerability to Fire —
 * reduced to 23, halved to 11, doubled to 22. Doubling before halving gives 23
 * instead, and halving a doubled number loses the rounding step entirely.
 *
 * Resistance and Vulnerability are booleans rather than counts because the SRD
 * says multiple instances affecting the same damage type count as only one.
 */
export function applyDefenses(amount: number, defenses: DamageDefenses, adjustment = 0): number {
  if (defenses.immune === true) return 0;

  let damage = Math.max(0, amount + adjustment);
  if (defenses.resistant === true) damage = Math.floor(damage / 2);
  if (defenses.vulnerable === true) damage = damage * 2;

  return damage;
}

export interface AppliedDamage {
  /** What actually landed, per damage type, after defences. */
  readonly byType: Readonly<Record<string, number>>;
  readonly total: number;
}

/**
 * Apply a target's defences to multi-type damage.
 *
 * Components are summed per type first and the defences applied once per type,
 * because Resistance halves *an instance of damage of that type* — halving each
 * component separately would round down repeatedly and undercount.
 */
export function applyDamage(
  components: readonly DamageComponent[],
  defenses: Readonly<Record<string, DamageDefenses>>,
  adjustments: Readonly<Record<string, number>> = {},
): AppliedDamage {
  const rawByType = new Map<string, number>();
  for (const component of components) {
    rawByType.set(component.type, (rawByType.get(component.type) ?? 0) + Math.max(0, component.total));
  }

  const byType: Record<string, number> = {};
  let total = 0;
  for (const [type, raw] of rawByType) {
    const applied = applyDefenses(raw, defenses[type] ?? {}, adjustments[type] ?? 0);
    byType[type] = applied;
    total += applied;
  }

  return { byType, total };
}
