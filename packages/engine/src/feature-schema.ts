import { ABILITIES, DAMAGE_TYPES, err, ok, type Ability, type Result } from '@ie/shared';
import { CREATURE_SIZES, WEAPON_PROPERTIES } from '@ie/srd/schemas';
import { WEAPON_CATEGORIES, WEAPON_KINDS, type WeaponSelector } from './attack.js';
import { RESERVED_LEDGER_NAMESPACES } from './combat.js';
import {
  ABILITY_SCORE_MAXIMUM,
  MOVEMENT_MODES,
  type ArmorTraining,
  type MovementMode,
} from './character.js';
import { parseNotation } from './dice.js';
import {
  MAX_LEVEL,
  featureChoicesOf,
  featureGrants,
  primaryChoiceOf,
  type FeatureChoice,
  type FeatureDefinition,
  type GatedFeatureGrant,
  type FeatureOptionMeaning,
  type PoolSizing,
  type ShapeShiftRow,
} from './progression.js';
import {
  oneShotProblem,
  type RollModifier,
  type RollSelector,
} from './roll-modifiers.js';
import { LIGHT_LEVELS } from './positioning.js';
import { checkActionRule } from './spell-schema.js';
import type { CastingTime } from './spells.js';
import { hours, TURN_ANCHORS } from './time.js';

/**
 * The Long Rest a `long-rest-length` grant has to come in under.
 *
 * `rest.ts` owns the constant and this module may not reach it: `rest.ts` now
 * reads a character back out of `creation.ts`, and this file is what
 * `content.ts` validates with, so the import would run a ring round the
 * engine. It is spelled here from the clock's own unit instead and held equal
 * to `LONG_REST` by `trance.test.ts`, which is the one place both are in
 * scope — a checked copy rather than a second opinion.
 */
export const LONGEST_LONG_REST = hours(8);

/**
 * What a `weapon-and-armor-training` grant may name, on each of its two sides.
 *
 * **Exhaustive by construction rather than by eye.** A list typed as "an array
 * of the grant's own union" would go on compiling the day the union grew, and
 * the word nobody added here would be refused as unknown for ever — so each
 * side is the keys of a `Record` over its union, which fails to compile when a
 * member is added *or* invented. `ArmorTraining`'s four flags are the sheet's
 * own; the weapons are the two whole categories a class grants, and the two
 * narrowed ones (`martial-light`, `martial-finesse-or-light`) are a class's own
 * proficiency list that no feature prints.
 */
type TrainedWeapon = NonNullable<
  Extract<GatedFeatureGrant, { kind: 'weapon-and-armor-training' }>['weapons']
>[number];

const TRAINABLE_WEAPONS = Object.keys({
  simple: true,
  martial: true,
} satisfies Record<TrainedWeapon, true>) as readonly TrainedWeapon[];

const TRAINABLE_ARMOR = Object.keys({
  light: true,
  medium: true,
  heavy: true,
  shields: true,
} satisfies Record<keyof ArmorTraining, true>) as readonly (keyof ArmorTraining)[];

/**
 * Whether a feature definition is *coherent*, asked of a value rather than of a
 * compilation.
 *
 * The twelve class files are already pure declarative data — a level, an
 * automation, a note, and at most one closed-union grant. What they never had
 * is anything that checks one at **runtime**: the TypeScript compiler was the
 * only guard, so every claim a definition makes about itself was believed.
 *
 * **The failure this exists to catch is on the record.** Nine features
 * declared `automation: 'engine'` on the strength of a note saying "declared
 * as a pool", and not one of them declared a pool: Bardic Inspiration, both
 * Channel Divinities, Wild Shape, Second Wind, Action Surge, Monk's Focus, Lay
 * On Hands and Sorcery Points. A Bard built by the engine had a Hit Die, three
 * spell-slot pools and nowhere to spend an inspiration from.
 * `class-pools.test.ts` closed that instance by scanning the *prose*; this is
 * the structural half, and it asks a different question:
 *
 * | | Asks |
 * |---|---|
 * | `class-pools.test.ts` | is this feature's **note** honest about what it declares |
 * | here | is this **declaration** coherent, and does anything read it |
 * | `creation.ts` | may **this character** take it, at this level, with these choices |
 *
 * `spell-schema.ts` is the precedent and the shape: every problem is reported
 * rather than the first, each carries a path, and
 * {@link parseFeatureDefinition} is the `Result` half over `unknown` — so a
 * definition may come from a file, a loader or a tool rather than from `tsc`.
 *
 * **Every rule below was run against all of the engine's features before it
 * was written.** Only one fires, and it fires on a blind spot rather than a
 * defect: see {@link FeatureContext.readableFields}.
 */

/** One thing wrong with a feature definition, and where. */
export interface FeatureDefinitionProblem {
  /** The path to the offending field, e.g. `grants.usesByLevel`. */
  readonly field: string;
  readonly code: string;
  readonly reason: string;
}

/**
 * An object and not a list, which is what every untyped clause below has to
 * establish before it reads a field off one.
 *
 * `content.ts`'s twin, because the other door onto these checks is JSON text
 * and a `TypeError` thrown at a malformed blob is a refusal that stopped being
 * a value.
 */
const isShape = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The Speed a feature grants, held to the pairing a spell's is.
 *
 * SRD prints four features of this shape and they split two ways: three add
 * feet to the walking Speed unqualified — Fast Movement, Roving, Unarmored
 * Movement — and Second-Story Work gives a Climb Speed equal to the holder's
 * Speed. One vocabulary says both, the same vocabulary a `speed` *effect*
 * says SRD Fly and Spider Climb in, so there is one set of rules about it
 * rather than two that will drift.
 *
 * Three refusals, each of them a reader that would otherwise never match:
 *
 * - **An operation that takes Speed away.** `speedOf` gathers a feature's
 *   grant only under `add`, and {@link StandingGrant}'s own note says why —
 *   "Speed reductions are not this member's business". A feature written
 *   `halve` would compile onto the sheet and slow nobody.
 * - **A match with no mode, or matching walking to itself.** The number would
 *   be the number it already was.
 * - **Feet beside a match.** Two numbers for one Speed, and the reader takes
 *   neither.
 *
 * **Four of the five fields, and `hover` is refused rather than shared**,
 * which is the one place this door and the spell's part company: a spell's
 * `speed` effect may hand over SRD Fly's "and can hover" because a casting's
 * grant is stored where `fliesWithoutFallingOn` reads it, and a feature's is
 * derived onto a sheet where nothing reads it at all.
 *
 * Exported because a **feat** reaches none of this function's callers: a
 * class, a subclass, a species and a background feature all come through
 * `checkFeatureDefinition`, and a feat's grant goes through
 * `featStandingProblems` and `ownedStandingEffectProblems` in `content.ts`
 * instead. That door calls this one, because a rule enforced on one of two
 * doors is a rule with a hole in it — and the hole would have been a feat
 * whose halved Climb Speed validated and was then skipped by `speedOf`.
 */
export function speedGrantProblems(
  effect: {
    readonly change?: unknown;
    readonly feet?: unknown;
    readonly mode?: unknown;
    readonly hover?: unknown;
  },
  at: string,
): readonly FeatureDefinitionProblem[] {
  const found: FeatureDefinitionProblem[] = [];
  const change = effect.change ?? 'add';
  const { feet, mode } = effect;

  // **Hovering is a casting's to hand over and a stat block's to print, and a
  // grant's nowhere at all.** `fliesWithoutFallingOn` reads two places — the
  // sheet's own `speeds.hover`, which `adaptMonster` fills from "Fly 40 ft.
  // (hover)", and a stored `GrantedSpeed`, which SRD Fly writes — and a
  // standing grant is neither. `StandingGrant`'s `speed` member has no such
  // field, so typed content cannot write one; this is the door untyped
  // homebrew arrives through, and the alternative is a flier who silently
  // falls.
  if (effect.hover !== undefined) {
    found.push({
      field: `${at}.hover`,
      code: 'bad_speed_change',
      reason:
        'hovering is read off the sheet a stat block printed or off a casting’s own grant, and a feature’s grant is neither, so nothing would ever read this',
    });
  }

  if (change !== 'add' && change !== 'match-walk') {
    found.push({
      field: `${at}.change`,
      code: 'bad_speed_change',
      reason: `a feature gives a Speed and does not take one away: "${String(change)}" is read by nothing, because \`speedOf\` gathers a feature's grant under "add" alone`,
    });
    return found;
  }

  if (mode !== undefined && !MOVEMENT_MODES.includes(mode as MovementMode)) {
    found.push({
      field: `${at}.mode`,
      code: 'bad_speed_change',
      reason: `"${String(mode)}" is not one of the five Speeds the SRD prints: ${MOVEMENT_MODES.join(', ')}`,
    });
  }

  if (change === 'match-walk') {
    if (mode === undefined || mode === 'walk') {
      found.push({
        field: `${at}.mode`,
        code: 'bad_speed_change',
        reason:
          '"a Climb Speed equal to your Speed" names the mode it gives; matching the walking Speed to itself changes nothing',
      });
    }
    if (feet !== undefined) {
      found.push({
        field: `${at}.feet`,
        code: 'bad_speed_change',
        reason:
          'a matched Speed is the walking one, so these feet are a second number for one Speed and the reader takes neither',
      });
    }
    return found;
  }

  if (!Number.isInteger(feet) || feet === 0) {
    found.push({
      field: `${at}.feet`,
      code: 'bad_speed_change',
      reason: `a Speed a feature adds to needs the number of feet, and a change of no feet is no change; this is ${String(feet)}`,
    });
  }
  return found;
}

/**
 * Everything wrong with an offer to restate the weapon's own damage type.
 *
 * SRD Sacred Weapon: "each time you hit with it, you cause it to deal its
 * normal damage type or Radiant damage." One question, and it is the one
 * nothing downstream could recover from: an offer of *no* types is a choice
 * with nothing in it, so the holder could never name anything and the clause
 * would compile onto the sheet, be gathered by `damageTypesOffered` and refuse
 * every type anybody asked for.
 *
 * The damage types themselves are **not** held to a list, for the reason no
 * other damage type in this engine is: the engine names none, and what a blow
 * deals is the catalogue's word carried through to the log.
 *
 * Exported for {@link speedGrantProblems}' reason — a feat reaches
 * `ownedStandingEffectProblems` in `content.ts` and none of this file's own
 * callers, so both doors call the one function.
 */
export function weaponDamageTypeProblems(
  effect: { readonly damageTypes?: unknown },
  at: string,
): readonly FeatureDefinitionProblem[] {
  const types = effect.damageTypes;
  if (
    !Array.isArray(types) ||
    types.length === 0 ||
    !types.every((one) => typeof one === 'string' && one.length > 0)
  ) {
    return [
      {
        field: `${at}.damageTypes`,
        code: 'offers_no_damage_type',
        reason:
          "an offer to restate a weapon's damage type names the types it offers; one that names none could never be answered, so the feature would refuse every type its holder asked for",
      },
    ];
  }
  return [];
}

/**
 * Everything wrong with a weapon narrowing, wherever one is written.
 *
 * `WeaponNarrowing` is a *description* of a weapon rather than a list of ids,
 * which is what keeps rule 4 — and the cost of a description is that one
 * naming a category nobody prints matches no weapon at all and says nothing
 * about it. That is the quiet failure this whole validator exists to turn into
 * a refusal at authoring, and the reason `weaponSelectorProblems` is reused
 * rather than restated: a `strike-style` and an `on-hit` rider already hold
 * their selectors to the same three closed sets.
 *
 * Its own function because four doors write the clause — an item's grant, a
 * class feature's, a feat's, and the weapon an activation imbues — and a rule
 * enforced at three of four is a rule with a hole in it. It lives here rather
 * than in `content.ts` for {@link speedGrantProblems}' reason, the other way
 * about: the fourth door is an `activated` grant, which this file validates.
 */
export function weaponNarrowingProblems(
  narrowing: unknown,
  at: string,
): readonly FeatureDefinitionProblem[] {
  const found: FeatureDefinitionProblem[] = [];
  if (!isShape(narrowing)) {
    return [
      {
        code: 'bad_weapon_narrowing',
        reason: 'a weapon narrowing is an object naming the weapons it covers, how they are held, or both',
        field: at,
      },
    ];
  }
  const weapons = narrowing['weapons'];
  if (weapons !== undefined) {
    if (!Array.isArray(weapons) || weapons.length === 0) {
      found.push({
        code: 'bad_weapon_narrowing',
        reason: 'the weapons a narrowing covers are a non-empty list of selectors; one that asks nothing of the weapon omits the field',
        field: `${at}.weapons`,
      });
    } else {
      weapons.forEach((selector, index) => {
        found.push(
          ...weaponSelectorProblems(
            selector as Parameters<typeof weaponSelectorProblems>[0],
            `${at}.weapons[${index}]`,
          ),
        );
      });
    }
  }
  const held = narrowing['heldInTwoHands'];
  if (held !== undefined && held !== true) {
    found.push({
      code: 'bad_weapon_narrowing',
      reason: 'SRD\'s "holding it with two hands" is asked or not asked; `false` is a clause that says nothing, so the field is omitted instead',
      field: `${at}.heldInTwoHands`,
    });
  }
  if (weapons === undefined && held === undefined) {
    found.push({
      code: 'bad_weapon_narrowing',
      reason: 'a narrowing that narrows nothing withholds a benefit from nobody; omit the field rather than writing an empty one',
      field: at,
    });
  }
  return found;
}


/**
 * Everything wrong with the weapon an activation imbues.
 *
 * SRD Sacred Weapon: "imbue one **Melee** weapon that you are holding ... you
 * add your Charisma modifier to attack rolls you make with that weapon
 * (minimum bonus of +1) ... you cause it to deal its normal damage type or
 * Radiant damage."
 *
 * Three clauses and three questions, each of them one nothing downstream could
 * recover from. A narrowing naming a category nobody prints reaches no weapon,
 * so the feature could never be used at all. A bonus sized by something that
 * is not an ability, or floored at something that is not points, is arithmetic
 * `standingBonuses` cannot do. And an offer of no types is a choice with
 * nothing in it — {@link weaponDamageTypeProblems}, which is where that
 * sentence has always been judged, now reached through this host instead of
 * through a standing grant.
 */
export function imbuedWeaponProblems(
  imbues: unknown,
  at: string,
): readonly FeatureDefinitionProblem[] {
  if (!isShape(imbues)) {
    return [
      {
        field: at,
        code: 'bad_imbued_weapon',
        reason:
          'the weapon an activation imbues is an object naming the weapons it may be, what it adds to their attack rolls, and the damage types it offers',
      },
    ];
  }
  const found: FeatureDefinitionProblem[] = [];
  const weapons = imbues['weapons'];
  if (weapons !== undefined) found.push(...weaponNarrowingProblems(weapons, `${at}.weapons`));

  const sized = imbues['attackBonusFrom'];
  if (sized !== undefined) {
    if (!isShape(sized)) {
      found.push({
        field: `${at}.attackBonusFrom`,
        code: 'bad_imbued_weapon',
        reason: "SRD's \"your Charisma modifier ... (minimum bonus of +1)\" is an ability and a floor",
      });
    } else {
      const ability = sized['ability'];
      if (typeof ability !== 'string' || !(ABILITIES as readonly string[]).includes(ability)) {
        found.push({
          field: `${at}.attackBonusFrom.ability`,
          code: 'bad_imbued_weapon',
          reason: `"${String(ability)}" is not one of the six abilities`,
        });
      }
      const minimum = sized['minimum'];
      if (!Number.isInteger(minimum) || (minimum as number) < 0) {
        found.push({
          field: `${at}.attackBonusFrom.minimum`,
          code: 'bad_imbued_weapon',
          reason: `SRD's "(minimum bonus of +1)" is a floor of a whole number of points, not ${JSON.stringify(minimum)}`,
        });
      }
    }
  }

  if (imbues['damageTypes'] !== undefined) {
    found.push(...weaponDamageTypeProblems(imbues as { readonly damageTypes?: unknown }, at));
  }

  // The ability the imbuing offers in place of the weapon's own — SRD Pact of
  // the Blade's Charisma. A word that is not an ability is a modifier
  // `attackAbility` would have to weigh and cannot find.
  const offered = imbues['offersAbility'];
  if (offered !== undefined && !(ABILITIES as readonly string[]).includes(offered as string)) {
    found.push({
      field: `${at}.offersAbility`,
      code: 'bad_imbued_weapon',
      reason: `"${String(offered)}" is not one of the six abilities`,
    });
  }

  // And the training — SRD Pact of the Blade's "you have proficiency with the
  // weapon". Printed or not, on `endsWhenLetGo`'s rule below.
  const trained = imbues['grantsProficiency'];
  if (trained !== undefined && trained !== true) {
    found.push({
      field: `${at}.grantsProficiency`,
      code: 'bad_imbued_weapon',
      reason:
        'SRD’s "you have proficiency with the weapon" is printed or it is not; `false` is a clause that says nothing, so the field is omitted instead',
    });
  }

  // The clause is printed or it is not; `false` is a sentence that says
  // nothing, which is the reading `heldInTwoHands` above already takes.
  const letGo = imbues['endsWhenLetGo'];
  if (letGo !== undefined && letGo !== true) {
    found.push({
      field: `${at}.endsWhenLetGo`,
      code: 'bad_imbued_weapon',
      reason:
        'SRD\'s "this effect also ends if you aren\'t carrying the weapon" is printed or it is not; `false` is a clause that says nothing, so the field is omitted instead',
    });
  }
  return found;
}

/**
 * Everything wrong with the light a feature sheds.
 *
 * SRD Sacred Weapon: "The weapon also emits Bright Light in a 20-foot radius
 * and Dim Light for an additional 20 feet." A level out of the glossary's
 * three, a radius of whole feet with at least one space in it, and — where the
 * sentence prints the second half — an "additional" measured the same way.
 * Every one of the three is a benefit nothing would read if it were wrong
 * rather than refused: `carriedLight` lays one sphere per radius, a sphere of
 * nought feet lights nothing, and a level nobody prints is compared against by
 * no rule.
 *
 * The same three questions the `light` **spell** effect is asked, under the
 * same two codes, because it is the same sentence printed on a class table.
 */
export function shedLightProblems(
  effect: { readonly level?: unknown; readonly radius?: unknown; readonly dimBeyond?: unknown },
  at: string,
): readonly FeatureDefinitionProblem[] {
  const found: FeatureDefinitionProblem[] = [];
  const { level, radius, dimBeyond } = effect;
  if (typeof level !== 'string' || !(LIGHT_LEVELS as readonly string[]).includes(level)) {
    found.push({
      field: `${at}.level`,
      code: 'bad_light_level',
      reason: `"${String(level)}" is not a level of light; the glossary prints ${LIGHT_LEVELS.join(', ')}`,
    });
  }
  if (!Number.isInteger(radius) || (radius as number) < 5) {
    found.push({
      field: `${at}.radius`,
      code: 'bad_light_radius',
      reason: `light reaches a whole number of feet, at least one space, not ${String(radius)}`,
    });
  }
  if (dimBeyond !== undefined && (!Number.isInteger(dimBeyond) || (dimBeyond as number) < 5)) {
    found.push({
      field: `${at}.dimBeyond`,
      code: 'bad_light_radius',
      reason: `dim light beyond the bright reaches a whole number of feet, at least one space, not ${String(dimBeyond)}`,
    });
  }
  return found;
}

/**
 * The two things the **grant around** a `light` effect may say that would stop
 * anybody gathering it.
 *
 * `activatedLight` honours exactly two shapes — a grant with no requirements,
 * which is a creature that simply glows, and one whose requirements are all
 * `feature-active` — and it withholds anything else rather than answering
 * wrongly. That silence has to be paid for at the door, because it is not the
 * silence `speed` gets: `speedOf` calls the full `meetsRequirements` and so
 * withholds nothing, and this reader **cannot**, for the reason written on
 * {@link activatedLight} — `requirementsHold` answers `in-sunlight` by calling
 * `lightAt`, and a light gathered through it would be a function asking a
 * question of its own answer.
 *
 * Reach is the other half, and only at a door where the reach is the grant's
 * to write. A light is shed *from* whoever carries it, and an aura's feet
 * would be a second radius beside the one the effect already prints;
 * `carriedLight` drops such a grant, so the catalogue is refused it. **An
 * absent reach is refused with the rest**, because `creation.ts` compiles
 * every reach that is not literally `'self'` — a missing one included — to an
 * aura, so silence here is the aura spelled quietly.
 *
 * {@link reachIsTheGrants} is false at a **feat's** door, where the question
 * has nothing to ask: a feat belongs to no source, creation compiles its grant
 * to the holder's own reach whatever it says, and `feat_grant_not_read`
 * already refuses an aura there. Asking twice would report one mistake twice,
 * which is the rule the feature door's `speed` skip is written for.
 *
 * Asked of the grant rather than of the effect because both fields are the
 * grant's. It has nothing to say about a `whileActive` list, where creation
 * writes `self` and one `feature-active` requirement itself — which is why
 * every SRD light passes without this function seeing it.
 */
export function shedLightHostProblems(
  grant: {
    readonly reach?: unknown;
    readonly requires?: unknown;
    readonly effects?: unknown;
  },
  at: string,
  reachIsTheGrants: boolean,
): readonly FeatureDefinitionProblem[] {
  const effects = Array.isArray(grant.effects) ? grant.effects : [];
  if (!effects.some((effect) => (effect as { readonly kind?: unknown })?.kind === 'light')) {
    return [];
  }

  const found: FeatureDefinitionProblem[] = [];
  if (reachIsTheGrants && grant.reach !== 'self') {
    found.push({
      field: `${at}.reach`,
      code: 'light_nobody_gathers',
      reason:
        'light is shed from whoever carries it, and `carriedLight` reads a grant that reaches the holder alone; an aura would be a second radius beside the one the light already prints, and nothing would gather it — and a reach left unwritten is compiled as one',
    });
  }
  (Array.isArray(grant.requires) ? grant.requires : []).forEach((requirement, index) => {
    const kind = (requirement as { readonly kind?: unknown })?.kind;
    if (kind === 'feature-active') return;
    found.push({
      field: `${at}.requires[${index}]`,
      code: 'light_nobody_gathers',
      reason: `\`carriedLight\` sits inside \`lightAt\`, which the requirement reader itself calls, so it answers "${String(kind)}" for nobody: a light gated on it would be withheld for ever rather than shed when the clause held`,
    });
  });
  return found;
}

/**
 * What a feature cannot know about itself.
 *
 * Every member is a fact held somewhere else — the table that grants it, the
 * readers that consume it, the parsed book. Passed in rather than read,
 * because `packages/engine` is pure and cannot open a file, and because a
 * derivation the caller supplies is one a test can drive over a synthetic case
 * it must catch. That is the `coverageGaps` discipline, applied here.
 */
export interface FeatureContext {
  /** How many levels the granting source's table has. */
  readonly levels: number;
  /**
   * The `FeatureGrant` kinds the engine's readers discriminate on.
   *
   * Derived by {@link readableGrantKinds} from the readers themselves, never
   * from a hand-written list: a list is the claim this repository has had
   * falsified four times, and the thing rule 4 is about is exactly a claim
   * nobody checked.
   */
  readonly readableGrants: ReadonlySet<string>;
  /**
   * The optional `FeatureDefinition` fields the readers dereference.
   *
   * A feature is executed through one of these or through nothing. The
   * derivation is blind to a feature executed through a declaration on its
   * *class* rather than on itself — a `spellcasting` block, or a sibling
   * feature's table — and that blindness is stated in the test rather than
   * exempted away.
   */
  readonly readableFields: ReadonlySet<string>;
  /** Whether the parsed SRD prints a spell with this id. */
  readonly spellExists: (id: string) => boolean;
  /**
   * Feature ids the granting source itself executes, through a declaration
   * on the source rather than on the feature.
   *
   * A class's `spellcasting` block executes exactly one of its features —
   * the one `ClassSpellcasting.feature` names, `<class>:spellcasting` or
   * `<class>:pact-magic` — so that feature declares nothing of its own and
   * is not the failure rule 4 exists to catch. Derived from the class by
   * whoever builds the context, never typed out.
   */
  readonly executedBySource?: ReadonlySet<string>;
}

const ABILITY_NAMES: ReadonlySet<string> = new Set<Ability>(ABILITIES);

/**
 * `CastingTime` written out as data, for the one grant that states one.
 *
 * Transcribed for `ABILITY_NAMES`' reason turned around: the union is declared
 * as a type and a validator needs it as data. `spell-schema.ts` keeps its own
 * copy for the definition's field; four words in two validators is cheaper
 * than an export that couples the two files' change histories together.
 */
const CASTING_TIME_NAMES: ReadonlySet<string> = new Set<CastingTime>([
  'action',
  'bonus-action',
  'reaction',
  'long',
]);

/**
 * A note that says nothing.
 *
 * The failure mode a required note has is not an absent sentence but a hollow
 * one, and this is the half of that which is mechanically checkable — the same
 * floor `refusal-sweep.test.ts` applies to an exemption and
 * `spell-honesty.test.ts` to an adjudication. Whether a note is *true* is
 * review's; whether it is prose rather than a placeholder is this.
 *
 * The second alternative is the one worth having: CLAUDE.md's rule is that "an
 * unexplained 'not automated' is not a useful thing to read at three in the
 * morning", so a bare negation naming nothing is refused while the shortest
 * real note in the engine — "The Wish effect is not modelled." — names Wish
 * and passes.
 */
const HOLLOW_NOTE =
  /^(?:(?:todo|tbd|n\/?a|none|later|unknown)|(?:(?:this )?(?:feature|it) )?(?:is )?not (?:modelled|modeled|automated|implemented|executed|applied|done))\.?$/i;

/** The damage types the game has, for the one grant that names one outright. */
const DAMAGE_KINDS: ReadonlySet<string> = new Set(DAMAGE_TYPES);

/** The highest level the SRD prints a spell at, for a ceiling a grant states. */
const TOP_SPELL_LEVEL = 9;

/** A whole number of at least one — what the SRD prints for a pool's size. */
const isCount = (value: unknown): boolean =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1;

/**
 * The sizing a grant declares, wherever it declares one.
 *
 * Five grant kinds carry one and `poolsFor` reads all five, so a rule that
 * looked only at `pool` would leave Rage's column and Indomitable's unchecked
 * — and Favored Enemy's, whose free castings are a column of the same table,
 * and Font of Magic's Sorcery Points, which a trade declares.
 */
const poolSizingOf = (
  grant: GatedFeatureGrant,
): { readonly at: string; readonly sizing: PoolSizing } | null => {
  if (grant.kind === 'pool') return { at: 'grants', sizing: grant };
  // An activation that says the pool is somebody else's sizes nothing, for
  // `reaction`'s reason one arm down: a use count on a pool this feature does
  // not own is a number nothing would read.
  if (grant.kind === 'activated' && grant.pool !== null && grant.spendsOnly !== true) {
    return { at: 'grants', sizing: grant };
  }
  // The sixth: a shape declares the pool its forms come out of, on the same
  // sentence that prints them — SRD Wild Shape's "You can use Wild Shape
  // twice" is two paragraphs under one heading.
  if (grant.kind === 'shape-shift') return { at: 'grants', sizing: grant };
  if (grant.kind === 'reaction' && grant.declares !== undefined) {
    return { at: 'grants.declares', sizing: grant.declares };
  }
  if (grant.kind === 'spells' && grant.freeCasting?.declares !== undefined) {
    return { at: 'grants.freeCasting.declares', sizing: grant.freeCasting.declares };
  }
  // The fifth, and the one this list has been wrong about before: a `trade`
  // may declare the pool its own conversions run between, which is SRD Font of
  // Magic. A sizing site `poolsFor` reads and this does not is a column
  // nothing checks.
  if (grant.kind === 'trade' && grant.declares !== undefined) {
    return { at: 'grants.declares', sizing: grant.declares };
  }
  return null;
};

/**
 * The pools one grant declares, which is at most one.
 *
 * The arms `poolsFor` in `creation.ts` pushes a declaration from, so that
 * "this feature spends a pool nobody declares" can be asked at the door —
 * here for a price on an allowance, and in `content.ts` across a source's
 * features. A list rather than a single key because the question is
 * membership, and a feature that declared two would answer for both.
 */
export const poolKeysIn = (grant: GatedFeatureGrant): readonly string[] => {
  if (grant.kind === 'pool') return [grant.key];
  if (grant.kind === 'activated' && grant.pool !== null && grant.spendsOnly !== true) {
    return [grant.pool];
  }
  if (grant.kind === 'shape-shift') return [grant.pool];
  if (grant.kind === 'reaction' && grant.declares !== undefined && grant.pool !== undefined) {
    return [grant.pool];
  }
  if (grant.kind === 'recovery') return [grant.pool];
  if (grant.kind === 'spells' && grant.freeCasting?.declares !== undefined) {
    return [grant.freeCasting.pool];
  }
  // The pool a feature's trades run between, where the feature holds it. SRD
  // Font of Magic is the whole of this arm: the Sorcery Points and both
  // conversions are one printed feature, so Metamagic spends a key this grant
  // declares. A trade's *own* `pool` is the pool of one its daily limit lives
  // in, which no other feature has ever named and so is not membership here.
  if (grant.kind === 'trade' && grant.pool !== undefined && grant.declares !== undefined) {
    return [grant.pool];
  }
  return [];
};

/**
 * Everything wrong with the price an `action-rule` effect puts on its
 * allowance — SRD Adrenaline Rush's use and Temporary Hit Points.
 *
 * Only an `allows` rule has a price to put: a rule that forbids or narrows
 * charges nobody anything. The pool it spends is one this feature declares,
 * because a use spent from a pool nobody sized is a count nothing refuses;
 * and the Temporary Hit Points are a number or the holder's Proficiency Bonus,
 * which is the one thing the book prints there.
 */
function allowancePriceProblems(
  effect: {
    readonly rule: unknown;
    readonly spends?: unknown;
    readonly temporaryHitPoints?: unknown;
  },
  at: string,
  declared: ReadonlySet<string>,
): readonly FeatureDefinitionProblem[] {
  const found: FeatureDefinitionProblem[] = [];
  const priced = effect.spends !== undefined || effect.temporaryHitPoints !== undefined;
  const allows =
    typeof effect.rule === 'object' &&
    effect.rule !== null &&
    (effect.rule as { readonly kind?: unknown }).kind === 'allows';
  if (priced && !allows) {
    found.push({
      field: `${at}.spends`,
      code: 'bad_allowance_price',
      reason: 'only an allowance — a cheaper price for a named action — spends a use or pays Temporary Hit Points when it is taken; a rule that forbids or narrows charges nothing',
    });
  }
  if (
    effect.spends !== undefined &&
    (typeof effect.spends !== 'string' || !declared.has(effect.spends))
  ) {
    found.push({
      field: `${at}.spends`,
      code: 'unknown_allowance_pool',
      reason: `the allowance spends "${String(effect.spends)}" and no grant of this feature declares a pool by that name`,
    });
  }
  if (
    effect.temporaryHitPoints !== undefined &&
    effect.temporaryHitPoints !== 'proficiency-bonus' &&
    !isCount(effect.temporaryHitPoints)
  ) {
    found.push({
      field: `${at}.temporaryHitPoints`,
      code: 'bad_allowance_price',
      reason: `Temporary Hit Points an allowance pays are a whole number of at least one or "proficiency-bonus", not ${String(effect.temporaryHitPoints)}`,
    });
  }
  return found;
}

/** A spread as the rules compare them: the points, largest first. */
const asSpread = (points: readonly number[]): string =>
  [...points].sort((a, b) => b - a).join('+');

/**
 * The branches an ability-score question prints, judged against the two
 * things that read them — **wherever the question is asked**.
 *
 * A class feature asks it through `FeatureChoice` and a feat through
 * `FeatRequirement`, in the same units and with the same meaning, so one
 * checker answers for both: a rule enforced on one of two spellings is a rule
 * with a hole in it, which is the reasoning `senseProblems` in `content.ts`
 * already states for a standing grant's two doors.
 *
 * `checkFeatureChoices` and `checkFeatChoice` each count the player's answer
 * into a spread and look for it here, and each reads the length a legal
 * answer must have off the branches' common total — so branches that disagree
 * about the total would make one of them unanswerable, which is the quiet
 * kind of wrong.
 *
 * `at` is the path the caller's own shape puts this under, because the two
 * callers spell it differently (`choice.spreads`, `requires.spreads`) and a
 * problem that pointed at the wrong field would send a reader to the wrong
 * line.
 */
export function abilitySpreadProblems(
  spreads: unknown,
  from: unknown,
  at: string,
): readonly FeatureDefinitionProblem[] {
  const found: FeatureDefinitionProblem[] = [];

  if (!Array.isArray(spreads) || spreads.length === 0) {
    return [
      {
        field: `${at}.spreads`,
        code: 'bad_ability_spread',
        reason:
          'a choice that raises ability scores prints at least one branch, as the points it puts into that many distinct scores',
      },
    ];
  }

  const totals = new Set<number>();
  const seen = new Set<string>();
  let widest = 0;
  (spreads as readonly unknown[]).forEach((spread, index) => {
    const at2 = `${at}.spreads[${index}]`;
    if (!Array.isArray(spread) || spread.length === 0) {
      found.push({
        field: at2,
        code: 'bad_ability_spread',
        reason: 'a branch puts points into at least one score; one that puts none raises nothing',
      });
      return;
    }
    // Six scores, six places for a point to go: a branch naming more distinct
    // scores than a creature has could never be answered.
    if (spread.length > ABILITY_NAMES.size) {
      found.push({
        field: at2,
        code: 'bad_ability_spread',
        reason: `a branch spreads points over ${String(spread.length)} distinct scores and a creature has ${String(ABILITY_NAMES.size)}`,
      });
      return;
    }
    const bad = (spread as readonly unknown[]).findIndex((points) => !isCount(points));
    if (bad !== -1) {
      found.push({
        field: `${at2}[${bad}]`,
        code: 'bad_ability_spread',
        reason: `a score is raised by a whole number of at least one point, not ${String((spread as readonly unknown[])[bad])}`,
      });
      return;
    }
    const points = spread as readonly number[];
    widest = Math.max(widest, points.length);
    totals.add(points.reduce((sum, one) => sum + one, 0));
    const shape = asSpread(points);
    if (seen.has(shape)) {
      found.push({
        field: at2,
        code: 'duplicate_ability_spread',
        reason: `${shape} is printed twice, and one branch of a sentence is one way of answering it`,
      });
    }
    seen.add(shape);
  });

  if (totals.size > 1) {
    found.push({
      field: `${at}.spreads`,
      code: 'uneven_ability_spreads',
      reason: `the branches hand out ${[...totals].sort((a, b) => a - b).join(' and ')} points, and the length of a legal answer is read off that total, so one of them could never be answered`,
    });
  }

  // The narrowing, where the sentence prints one: SRD Boon of Irresistible
  // Offense is "your Strength or Dexterity score". A set naming something
  // that is not an ability offers nothing, and a set smaller than the widest
  // branch leaves that branch with nowhere to put its last point — both are
  // a sentence no player could answer, which is what this whole function
  // exists to catch.
  if (from !== undefined) {
    if (!Array.isArray(from) || from.length === 0) {
      found.push({
        field: `${at}.from`,
        code: 'bad_ability_choice',
        reason: 'a narrowed choice names at least one ability; one that names none offers nothing',
      });
    } else {
      (from as readonly unknown[]).forEach((ability, index) => {
        if (typeof ability !== 'string' || !ABILITY_NAMES.has(ability)) {
          found.push({
            field: `${at}.from[${index}]`,
            code: 'bad_ability_choice',
            reason: `"${String(ability)}" is not one of the six abilities`,
          });
        }
      });
      if (new Set(from as readonly unknown[]).size < widest) {
        found.push({
          field: `${at}.from`,
          code: 'bad_ability_choice',
          reason: `a branch spreads points over ${String(widest)} distinct scores and the choice offers ${String(new Set(from as readonly unknown[]).size)}, so that branch could never be answered`,
        });
      }
    }
  }

  return found;
}

/**
 * One question, and the path a problem with it is reported under.
 *
 * The shape {@link featureGrants}'s readers already use for a grant: a feature
 * that writes one question reports `choice.x` exactly as it always did, and
 * one that writes a list reports `choices[1].x`, so a problem can be found in
 * the file it came from.
 */
interface AskedQuestion {
  readonly question: FeatureChoice;
  readonly at: string;
}

const questionsIn = (feature: FeatureDefinition): readonly AskedQuestion[] =>
  featureChoicesOf(feature).map((question, index) => ({
    question,
    at: feature.choices === undefined ? 'choice' : `choices[${index}]`,
  }));

/**
 * Rule 8b: the questions a feature asks, held to the shape a plural one takes.
 *
 * Five ways a second question is one nobody could ever answer, and every one
 * of them is silent at every later moment — creation would file an answer
 * under a key nothing reads, or ask for one it never offered, and the feature
 * would compile and grant nothing.
 *
 * | | |
 * |---|---|
 * | `choice` **and** `choices` | {@link featureChoicesOf} returns the plural, so the singular is a question quietly dropped |
 * | a key on the first question | the first answer is filed under the feature's own id, which is what every answer ever written uses |
 * | a later question with no key | two questions filed under one id, and the second answer would be read as the first's |
 * | two questions sharing a key | the same, one step along |
 * | a gate naming no option the first question offers | a question nobody is ever asked |
 *
 * The gate is the primary question's alone: `onlyIfChoice` on the first is a
 * gate with nothing before it to read, and a first question that is not a list
 * of options has no named answers for a later one to name.
 */
function choiceProblems(
  feature: FeatureDefinition,
  context: FeatureContext,
): readonly FeatureDefinitionProblem[] {
  const found: FeatureDefinitionProblem[] = [];

  if (feature.choice !== undefined && feature.choices !== undefined) {
    found.push({
      field: 'choices',
      code: 'choice_asked_twice',
      reason: `${feature.id} writes a question in "choice" and a list of them in "choices", and the list is what every reader takes — so the single one would be asked by nobody`,
    });
  }

  const asked = questionsIn(feature);
  const primary = asked[0];
  const offered =
    primary !== undefined && primary.question.kind === 'option' ? primary.question.from : [];
  const keys = new Set<string>();

  asked.forEach(({ question, at }, index) => {
    if (index === 0) {
      if (question.key !== undefined) {
        found.push({
          field: `${at}.key`,
          code: 'keyed_first_choice',
          reason: `the first question a feature asks is answered under ${feature.id} itself, so the key "${question.key}" would be looked for by nothing`,
        });
      }
    } else if (question.key === undefined) {
      found.push({
        field: `${at}.key`,
        code: 'unkeyed_later_choice',
        reason: `${feature.id} asks a second question and files its answer under the feature's own id, where the first question's answer already is`,
      });
    } else if (keys.has(question.key)) {
      found.push({
        field: `${at}.key`,
        code: 'duplicate_choice_key',
        reason: `${feature.id} asks two questions under the key "${question.key}", and one answer cannot be both`,
      });
    }
    // And the one character a key may not contain. `repeatAnswerKey` suffixes
    // a repeated question's later copies with `#2`, `#3`, so a key with a `#`
    // in it could spell the same answer key two ways and `answersAcrossCopies`
    // would gather somebody else's answer into this grant.
    if (question.key?.includes('#') === true) {
      found.push({
        field: `${at}.key`,
        code: 'bad_choice_key',
        reason: `"${question.key}" contains a #, which is how a repeated question numbers its later copies`,
      });
    }
    if (question.key !== undefined) keys.add(question.key);

    // A Weapon Mastery choice is sized by a printed number or by a column of
    // the class table, and exactly one of the two. Neither is a ceiling of zero
    // wearing a feature's name — a character who could never unlock anything —
    // and both is a count sized twice, which is the rule `usesRolled` keeps
    // beside `uses` on a charge pool.
    if (question.kind === 'weapon') {
      const shapes = [
        question.choose === undefined ? null : 'choose',
        question.chooseByLevel === undefined ? null : 'chooseByLevel',
      ].filter((shape): shape is string => shape !== null);

      if (shapes.length !== 1) {
        found.push({
          field: at,
          code: shapes.length === 0 ? 'unsized_weapon_choice' : 'ambiguous_weapon_choice',
          reason:
            shapes.length === 0
              ? 'a weapon choice says how many kinds it unlocks through `choose` or through `chooseByLevel`, and this says neither'
              : 'a weapon choice is sized by a number or by a column of the class table, not by both',
        });
      }

      if (question.chooseByLevel !== undefined && question.chooseByLevel.length !== context.levels) {
        found.push({
          field: `${at}.chooseByLevel`,
          code: 'not_a_table_column',
          reason: `a column of this source's table has ${context.levels} entries, not ${question.chooseByLevel.length}`,
        });
      }

      const counts =
        question.chooseByLevel ?? (question.choose === undefined ? [] : [question.choose]);
      const bad = counts.findIndex((count) => !Number.isInteger(count) || count < 0);
      if (bad !== -1) {
        found.push({
          field: at,
          code: 'bad_weapon_choice',
          reason: `a feature unlocks a whole number of kinds of weapon, not ${String(counts[bad])}`,
        });
      }
    }

    // **An option choice is sized the same two ways**, and the weapon
    // paragraph above is the whole argument: SRD Eldritch Invocations prints a
    // column where Divine Order prints "choose one", so exactly one of the two
    // says how many, and a column read off a class table has one entry per row.
    if (question.kind === 'option') {
      const shapes = [
        question.choose === undefined ? null : 'choose',
        question.chooseByLevel === undefined ? null : 'chooseByLevel',
      ].filter((shape): shape is string => shape !== null);

      if (shapes.length !== 1) {
        found.push({
          field: at,
          code: shapes.length === 0 ? 'unsized_option_choice' : 'ambiguous_option_choice',
          reason:
            shapes.length === 0
              ? 'an option choice says how many it offers through `choose` or through `chooseByLevel`, and this says neither'
              : 'an option choice is sized by a number or by a column of the class table, not by both',
        });
      }

      if (question.chooseByLevel !== undefined && question.chooseByLevel.length !== context.levels) {
        found.push({
          field: `${at}.chooseByLevel`,
          code: 'not_a_table_column',
          reason: `a column of this source's table has ${context.levels} entries, not ${question.chooseByLevel.length}`,
        });
      }

      const counts =
        question.chooseByLevel ?? (question.choose === undefined ? [] : [question.choose]);
      const bad = counts.findIndex((count) => !Number.isInteger(count) || count < 0);
      if (bad !== -1) {
        found.push({
          field: at,
          code: 'bad_option_choice',
          reason: `a feature offers a whole number of options, not ${String(counts[bad])}`,
        });
      }

      // A licence to take an option twice is printed over an option the
      // question offers, for the reason a Prerequisite is: a permission over
      // an option nobody is offered would permit nothing.
      for (const repeated of question.repeatable ?? []) {
        if (!question.from.includes(repeated)) {
          found.push({
            field: `${at}.repeatable`,
            code: 'repeatable_not_offered',
            reason: `${feature.id} says ${repeated} may be taken more than once and offers ${question.from.join(', ')}, so the licence would permit nothing`,
          });
        }
      }

      // A Prerequisite is printed over an option the question offers, and it
      // names another one: both halves are read against `from`, because a line
      // over an option nobody is offered is a rule nothing would ever apply.
      for (const line of question.prerequisites ?? []) {
        if (!question.from.includes(line.option)) {
          found.push({
            field: `${at}.prerequisites`,
            code: 'prerequisite_not_offered',
            reason: `${feature.id} prints a prerequisite over ${line.option} and offers ${question.from.join(', ')}, so the line would gate nothing`,
          });
        }
        if (line.requiresOption !== undefined && !question.from.includes(line.requiresOption)) {
          found.push({
            field: `${at}.prerequisites`,
            code: 'prerequisite_not_offered',
            reason: `${feature.id} requires ${line.requiresOption} before ${line.option} and offers no such option, so nobody could ever take it`,
          });
        }
        if (line.level === undefined && line.requiresOption === undefined) {
          found.push({
            field: `${at}.prerequisites`,
            code: 'empty_prerequisite',
            reason: `${feature.id} prints a prerequisite over ${line.option} that demands nothing, which reads as a rule and is none`,
          });
        }
      }
    }

    const gate = question.onlyIfChoice;
    if (gate === undefined) return;
    if (index === 0 || offered.length === 0) {
      found.push({
        field: `${at}.onlyIfChoice`,
        code: 'gate_without_a_choice',
        reason:
          index === 0
            ? `${feature.id} asks this question only of whoever chose ${gate}, and it is the first thing it asks, so there is no earlier answer to read`
            : `${feature.id} asks this question only of whoever chose ${gate}, and the question it asks first offers no named options`,
      });
    } else if (!offered.includes(gate)) {
      found.push({
        field: `${at}.onlyIfChoice`,
        code: 'option_not_offered',
        reason: `${feature.id} asks this question only of whoever chose ${gate} and offers ${offered.join(' or ')}, so nobody would ever be asked it`,
      });
    }
  });

  return found;
}

/** The feature half of {@link abilitySpreadProblems}: its own path, its own field. */
function abilityChoiceProblems(
  feature: FeatureDefinition,
): readonly FeatureDefinitionProblem[] {
  return questionsIn(feature).flatMap(({ question, at }) =>
    question.kind === 'ability-score' ? abilitySpreadProblems(question.spreads, undefined, at) : [],
  );
}

/**
 * The scores an `ability-score-increase` grant raises, and the ceiling it
 * lifts for them.
 *
 * A grant that lifts a maximum for no score lifts it for nobody, and a holder
 * that both names its scores and asks which is two sentences the SRD never
 * prints together — both would read as transcribed and grant something other
 * than what the book says.
 *
 * **Asked of a feat as well as a feature**, for the reason
 * {@link abilitySpreadProblems} is: the grant is one member of one
 * vocabulary, and the two holders differ only in where the question beside it
 * was asked. `asks` is whichever of the two said yes, and `who` is the id a
 * refusal names.
 */
export function abilityGrantProblemsOf(
  grant: GatedFeatureGrant | undefined,
  asks: boolean,
  who: string,
): readonly FeatureDefinitionProblem[] {
  if (grant === undefined || grant.kind !== 'ability-score-increase') return [];
  const found: FeatureDefinitionProblem[] = [];
  const raises: unknown = grant.raises;

  if (raises !== undefined) {
    if (asks) {
      found.push({
        field: 'grants.raises',
        code: 'ability_raise_and_choice',
        reason: `${who} names the scores it raises and asks which to raise; the SRD writes one sentence or the other, and a reader cannot tell which the maximum belongs to`,
      });
    }
    if (!Array.isArray(raises) || raises.length === 0) {
      found.push({
        field: 'grants.raises',
        code: 'bad_ability_raise',
        reason: 'a feature that raises scores outright names at least one, with the points it adds',
      });
    } else {
      const named = new Set<string>();
      (raises as readonly unknown[]).forEach((raise, index) => {
        const at = `grants.raises[${index}]`;
        const entry = raise as { ability?: unknown; points?: unknown } | null;
        if (entry === null || typeof entry !== 'object') {
          found.push({ field: at, code: 'bad_ability_raise', reason: 'a raise names an ability and the points it adds' });
          return;
        }
        if (typeof entry.ability !== 'string' || !ABILITY_NAMES.has(entry.ability as Ability)) {
          found.push({
            field: `${at}.ability`,
            code: 'bad_ability_raise',
            reason: `"${String(entry.ability)}" is not one of the six abilities`,
          });
          return;
        }
        if (!isCount(entry.points)) {
          found.push({
            field: `${at}.points`,
            code: 'bad_ability_raise',
            reason: `a score is raised by a whole number of at least one point, not ${String(entry.points)}`,
          });
        }
        if (named.has(entry.ability)) {
          found.push({
            field: `${at}.ability`,
            code: 'duplicate_ability_raise',
            reason: `${entry.ability} is raised twice by one sentence, and the second would be read and the first forgotten`,
          });
        }
        named.add(entry.ability);
      });
    }
  }

  const maximum: unknown = grant.maximum;
  if (maximum !== undefined) {
    if (!Number.isInteger(maximum) || (maximum as number) <= ABILITY_SCORE_MAXIMUM) {
      found.push({
        field: 'grants.maximum',
        code: 'bad_ability_maximum',
        reason: `a lifted ceiling is a whole number above the ${ABILITY_SCORE_MAXIMUM} every score already has, not ${String(maximum)}`,
      });
    }
    if (raises === undefined && !asks) {
      found.push({
        field: 'grants.maximum',
        code: 'ability_maximum_lifts_nothing',
        reason: `${who} lifts a ceiling for the scores it touches, and it neither names a score nor asks for one, so it would lift nothing for anybody`,
      });
    }
  }

  if (raises === undefined && maximum === undefined) {
    found.push({
      field: 'grants',
      code: 'empty_ability_grant',
      reason: `${who} neither raises a score nor lifts a ceiling, so nothing about it reaches a sheet`,
    });
  }

  return found;
}

/**
 * Everything wrong with one **sizing**, wherever a grant declares one.
 *
 * Its own function because {@link poolSizingOf} answers for one site per grant
 * and a `pool-options` grant's amendments carry one apiece — SRD Sear Undead's
 * "a number of d8s equal to your Wisdom modifier (minimum of 1d8)" is a
 * sizing, read by the same `poolSizeOf`, and a sizing site nothing checks is
 * the column this file's own comment above says must not exist.
 */
function sizingProblems(
  sizing: PoolSizing,
  at: string,
  context: FeatureContext,
): readonly FeatureDefinitionProblem[] {
  const found: FeatureDefinitionProblem[] = [];
  const shapes = [
    sizing.usesByLevel === undefined ? null : 'usesByLevel',
    sizing.fromAbilityModifier === undefined ? null : 'fromAbilityModifier',
    sizing.perClassLevel === undefined ? null : 'perClassLevel',
    sizing.perProficiencyBonus === undefined ? null : 'perProficiencyBonus',
  ].filter((shape): shape is string => shape !== null);

  // The one sizing that is a flag rather than a number, asked of the value
  // because the other door is JSON: `true` and nothing else.
  if (sizing.perProficiencyBonus !== undefined && sizing.perProficiencyBonus !== true) {
    found.push({
      field: `${at}.perProficiencyBonus`,
      code: 'bad_pool_sizing',
      reason: `"a number of times equal to your Proficiency Bonus" is written perProficiencyBonus: true, not ${String(sizing.perProficiencyBonus)}`,
    });
  }

  if (shapes.length > 1) {
    found.push({
      field: at,
      code: 'ambiguous_pool_sizing',
      reason: `${shapes.join(' and ')} both size this pool, and poolSizeOf reads exactly one — the others are silently ignored`,
    });
  }

  if (sizing.usesByLevel !== undefined) {
    if (sizing.usesByLevel.length !== context.levels) {
      found.push({
        field: `${at}.usesByLevel`,
        code: 'not_a_table_column',
        reason: `a column of this source's table has ${context.levels} entries, not ${sizing.usesByLevel.length}`,
      });
    }
    // A use count may be zero — the levels before the feature arrives — but
    // never negative and never fractional.
    const bad = sizing.usesByLevel.findIndex(
      (uses) => !Number.isInteger(uses) || uses < 0,
    );
    if (bad !== -1) {
      found.push({
        field: `${at}.usesByLevel[${bad}]`,
        code: 'bad_pool_sizing',
        reason: `a class table prints a whole number of uses, not ${String(sizing.usesByLevel[bad])}`,
      });
    }
  }

  if (
    sizing.fromAbilityModifier !== undefined &&
    !ABILITY_NAMES.has(sizing.fromAbilityModifier)
  ) {
    found.push({
      field: `${at}.fromAbilityModifier`,
      code: 'bad_pool_sizing',
      reason: `"${String(sizing.fromAbilityModifier)}" is not one of the six abilities`,
    });
  }

  if (sizing.perClassLevel !== undefined && !isCount(sizing.perClassLevel)) {
    found.push({
      field: `${at}.perClassLevel`,
      code: 'bad_pool_sizing',
      reason: `a multiple of the class level is a whole number of at least one, not ${String(sizing.perClassLevel)}`,
    });
  }

  if (sizing.minimum !== undefined && !isCount(sizing.minimum)) {
    found.push({
      field: `${at}.minimum`,
      code: 'bad_pool_sizing',
      reason: `a floor is a whole number of at least one, not ${String(sizing.minimum)}`,
    });
  }
  return found;
}

/**
 * Everything wrong with **one** of a feature's grants.
 *
 * Its own function because a feature may carry several — see
 * {@link featureGrants} — and every rule here is about one grant on its own.
 * The caller indexes the paths where there is more than one, so a feature that
 * writes a single grant reports exactly the paths it always did.
 */
function grantProblems(
  feature: FeatureDefinition,
  grant: GatedFeatureGrant,
  context: FeatureContext,
): readonly FeatureDefinitionProblem[] {
  const found: FeatureDefinitionProblem[] = [];
  // What this feature's own grants declare, for a price on an allowance to
  // name: SRD Adrenaline Rush declares its uses and spends them in one entry.
  const declaredPools = new Set(featureGrants(feature).flatMap(poolKeysIn));

  // Rule 4's first half, asked of each grant: a feature that claims the engine
  // executes it and carries a grant no reader discriminates on.
  if (feature.automation === 'engine' && !context.readableGrants.has(grant.kind)) {
    found.push({
      field: 'grants.kind',
      code: 'grant_not_read',
      reason: `nothing in the engine's readers discriminates on a "${grant.kind}" grant, so this feature claims to be executed and nothing executes it`,
    });
  }

  // Rule 9, the half that is about the grant: the scores it raises outright,
  // and the ceiling it lifts for them. The other half — the spread the feature
  // offers — is the feature's own and is asked once, beside rule 8.
  found.push(
    ...abilityGrantProblemsOf(
      grant,
      featureChoicesOf(feature).some((question) => question.kind === 'ability-score'),
      feature.id,
    ),
  );

  // Rule 5. A fixed grant is the feature's own answer rather than the
  // player's, so its ids are never validated against a character's choices —
  // which is precisely why a typo in one would go unseen for ever.
  if (grant.kind === 'spells' && grant.fixed !== undefined) {
    if (grant.fixed.length === 0) {
      found.push({
        field: 'grants.fixed',
        code: 'empty_spell_grant',
        reason: 'a fixed spell grant that names no spell grants nothing',
      });
    }
    grant.fixed.forEach((id, index) => {
      if (!context.spellExists(id)) {
        found.push({
          field: `grants.fixed[${index}]`,
          code: 'unknown_granted_spell',
          reason: `the SRD prints no spell with the id "${id}"`,
        });
      }
    });
    const seen = new Set<string>();
    grant.fixed.forEach((id, index) => {
      if (seen.has(id)) {
        found.push({
          field: `grants.fixed[${index}]`,
          code: 'duplicate_granted_spell',
          reason: `"${id}" is granted twice by one feature`,
        });
      }
      seen.add(id);
    });
  }

  // Rule 5b. A casting the feature pays for out of a pool, judged by the two
  // things creation reads off it: a spell there is a definition to cast, and a
  // pool to take the casting out of.
  //
  // The spell for rule 5's own reason — the feature's answer is never checked
  // against a character's choices, so a typo in one would go unseen for ever —
  // and the pool because a free casting with nowhere to come from is a feature
  // that refuses every casting it offers, at the table rather than here. The
  // *sizing* is rule 6 below, which reads this grant with the other three.
  if (grant.kind === 'spells' && grant.freeCasting !== undefined) {
    const free = grant.freeCasting;
    if (typeof free.spell !== 'string' || free.spell.trim() === '') {
      found.push({
        field: 'grants.freeCasting.spell',
        code: 'unknown_free_casting',
        reason: 'a feature that pays for a casting names the spell it pays for',
      });
    } else if (!context.spellExists(free.spell)) {
      found.push({
        field: 'grants.freeCasting.spell',
        code: 'unknown_free_casting',
        reason: `this content holds no spell with the id "${free.spell}", so the casting this feature pays for names nothing`,
      });
    }
    if (typeof free.pool !== 'string' || free.pool.trim() === '') {
      found.push({
        field: 'grants.freeCasting.pool',
        code: 'free_casting_without_a_pool',
        reason:
          'a casting without a slot is paid for out of a pool, named here — its own through "declares", or one another feature of the same class declares',
      });
    }
  }

  // A reroll that names a test the window does not roll, or an outcome that is
  // neither of the two. The window is `offersForTest`'s, and it asks exactly
  // these two questions of a reroll; an answer it cannot read is a Reaction
  // never offered, silently.
  if (grant.kind === 'reaction') {
    grant.does.forEach((effect, index) => {
      if (effect.kind !== 'reroll') return;
      const at = `grants.does[${index}]`;
      const tests: unknown = effect.tests;
      if (tests !== undefined) {
        if (!Array.isArray(tests) || tests.length === 0) {
          found.push({
            field: `${at}.tests`,
            code: 'bad_reroll_tests',
            reason: 'a reroll that names its tests names at least one: an ability check, a saving throw, or both',
          });
        } else {
          tests.forEach((test: unknown, i) => {
            if (test !== 'ability-check' && test !== 'saving-throw') {
              found.push({
                field: `${at}.tests[${i}]`,
                code: 'bad_reroll_tests',
                reason: `"${String(test)}" is not a D20 Test the window rolls; an attack roll has no window a reroll can answer in`,
              });
            }
          });
        }
      }
    });
  }

  // A conferred Reaction has no pool of its own — the giver's use was spent
  // when they gave it away — so a refund on failure is an ending nothing
  // keeps: what a use of it spends is the grant, and the grant is gone. The
  // same guard `oneShotProblem` puts on a modifier promising an ending, at the
  // one door that could promise this one.
  if (grant.kind === 'pool' && grant.confersReaction !== undefined) {
    grant.confersReaction.does.forEach((effect, index) => {
      if (effect.kind === 'intervene' && effect.refundedOnFailure === true) {
        found.push({
          field: `grants.confersReaction.does[${index}].refundedOnFailure`,
          code: 'refund_without_a_pool',
          reason:
            'a conferred Reaction costs its holder no pool use, so there is nothing to refund on a failure; what a use of it spends is the grant itself',
        });
      }
    });
  }

  // A recovery a later feature rewrites, judged by the two things that would
  // make the rewrite silent.
  //
  // **A feature nobody is named**, so nothing could ever bring the new tag in:
  // `recoveryOf` in `creation.ts` gates the rewrite on the character holding
  // the feature named here, and an empty name is held by nobody. **And a tag
  // that is the one already declared**, which is a sentence saying the book
  // changed its mind and printed the same rule — the reading
  // `ambiguous_pool_sizing` below refuses in its own units. Whether the *id*
  // names one of the features this source reaches — its own, and for a
  // subclass its parent class's — is `checkContent`'s `bad_recovery_rewrite`,
  // asked beside `executedBy`'s own cross-feature question, because a
  // definition cannot see its siblings from here.
  if (grant.kind === 'pool' && grant.recoversSooner !== undefined) {
    const sooner = grant.recoversSooner;
    if (typeof sooner.withFeature !== 'string' || sooner.withFeature.trim() === '') {
      found.push({
        field: 'grants.recoversSooner.withFeature',
        code: 'rewrite_without_a_feature',
        reason:
          "a pool's recovery is rewritten by a later feature, named here — a rewrite naming nobody is one no character could ever be granted",
      });
    }
    if (sooner.recovers === grant.recovers) {
      found.push({
        field: 'grants.recoversSooner.recovers',
        code: 'rewrite_changes_nothing',
        reason: `this pool already recovers on a ${String(grant.recovers)}, so the later feature rewrites nothing`,
      });
    }
  }

  // **A move handed over by nobody**, which is `recoversSooner`'s own guard
  // one field along and is here for the same reason: creation compiles the
  // rider only where the character really holds the feature named, so an id
  // that names nothing is dropped in silence and the class file reads as
  // though a use hands feet over when it hands over none. The cross-feature
  // half — whether any feature this source reaches carries the id — is
  // `checkContent`'s, beside `bad_recovery_rewrite`, because a definition
  // cannot see its siblings from here.
  if (grant?.kind === 'pool' && grant.heals?.handsMove !== undefined) {
    const hands = grant.heals.handsMove;
    if (typeof hands.withFeature !== 'string' || hands.withFeature.trim() === '') {
      found.push({
        field: 'grants.heals.handsMove.withFeature',
        code: 'handed_move_without_a_feature',
        reason:
          'a move handed over by a use of this pool is handed over by a later feature, named here — a rider naming nobody is one no character could ever be granted',
      });
    }
    if (grant.heals.action !== 'bonus-action') {
      found.push({
        field: 'grants.heals.handsMove',
        code: 'handed_move_off_a_bonus_action',
        reason: `SRD hands this move over for activating the feature **with a Bonus Action**, and a use of this pool costs ${String(grant.heals.action)}`,
      });
    }
  }

  // The two things a hung grant can promise that nothing would keep.
  //
  // **An ending no roll delivers.** A grant a use hangs is *stored* state, so
  // `oneShot` on it is a real promise rather than the inert one it is on a
  // derived `whileActive` effect — and only an attack roll and an ability
  // check keep it. On any other family the flag compiles, the grant lands, and
  // it then runs to its deadline like a durable one. Which families those are
  // is `oneShotProblem`'s to say and not this comment's; the same refusal
  // `spell-schema.ts` and the item door already make, at the third door onto
  // the same field.
  //
  // **And two clauses filed under one name.** `hungSource` names a grant by its
  // kind, because everything one source granted a creature ends together —
  // `roll-modifier-consumed`'s body *is* `releaseGrants`. Two grants of one
  // kind would therefore share a source, and the roll that spent the first
  // would silently end the second.
  if (grant.kind === 'activated') {
    // Rule 6a. The object a use imbues, where it imbues one — SRD Sacred
    // Weapon's "one Melee weapon that you are holding".
    if (grant.imbuesWeapon !== undefined) {
      found.push(...imbuedWeaponProblems(grant.imbuesWeapon, 'grants.imbuesWeapon'));
    }
    // Rule 6b. One lifetime, in one of **three** spellings: a turn anchor (SRD
    // Rage, pushed round by round), a printed span (SRD Innate Sorcery's
    // minute), or none at all (SRD Pact of the Blade, which prints three
    // endings and no deadline). More than one is more than one deadline for
    // one activation; none of the three is a feature whose lifetime nobody
    // wrote down, which is what the third member exists to tell apart from a
    // typo. Asked of the values, because the other door is JSON.
    const span = grant as {
      readonly lasts?: unknown;
      readonly lastsSeconds?: unknown;
      readonly lastsUntilEnded?: unknown;
    };
    const spans = [span.lasts, span.lastsSeconds, span.lastsUntilEnded].filter(
      (one) => one !== undefined,
    );
    if (spans.length > 1) {
      found.push({
        field: 'grants.lasts',
        code: 'ambiguous_activation_span',
        reason:
          'an activation runs to a turn anchor, for a printed span, or until something ends it — one of the three',
      });
    }
    if (spans.length === 0) {
      found.push({
        field: 'grants.lasts',
        code: 'no_activation_span',
        reason:
          'an activation says how long it runs: "lasts" names a turn anchor, "lastsSeconds" a printed span, "lastsUntilEnded" says the book prints neither',
      });
    }
    if (span.lastsUntilEnded !== undefined && span.lastsUntilEnded !== true) {
      found.push({
        field: 'grants.lastsUntilEnded',
        code: 'bad_activation_span',
        reason: `an activation either prints no deadline or does not say so, and "${String(span.lastsUntilEnded)}" is neither`,
      });
    }
    // Rule 6b(ii). A conjuring hangs on an imbuing. SRD Pact of the Blade
    // conjures the weapon it is about to bond, and a use that made a weapon
    // and hung nothing on it would hand its holder an ordinary Glaive out of
    // the air — which is a feature the book does not print and which
    // `activateFeature` has no narrowing to hold the named weapon to, because
    // the narrowing lives on the imbuing.
    if (grant.conjuresWeapon !== undefined && grant.imbuesWeapon === undefined) {
      found.push({
        field: 'grants.conjuresWeapon',
        code: 'conjuring_without_an_imbuing',
        reason:
          'an activation conjures the weapon it imbues; with no imbuing beside it there is nothing to hold the named weapon to and nothing hung on what appears',
      });
    }
    if (span.lasts !== undefined && !(TURN_ANCHORS as readonly unknown[]).includes(span.lasts)) {
      found.push({
        field: 'grants.lasts',
        code: 'bad_activation_span',
        reason: `"${String(span.lasts)}" is not a turn anchor; the engine has ${TURN_ANCHORS.join(', ')}`,
      });
    }
    if (span.lastsSeconds !== undefined && !isCount(span.lastsSeconds)) {
      found.push({
        field: 'grants.lastsSeconds',
        code: 'bad_activation_span',
        reason: `a printed span is a whole number of seconds of at least one, not ${String(span.lastsSeconds)}`,
      });
    }
    // Rule 6c. An activation that says the pool is somebody else's has to name
    // one, and may not size it: a use count on a pool this feature does not
    // own is a number `poolsFor` never reads, and a flag with no key is a
    // declaration withheld from nothing.
    if (grant.spendsOnly === true) {
      if (grant.pool === null) {
        found.push({
          field: 'grants.spendsOnly',
          code: 'spends_no_pool',
          reason:
            'this activation says the pool it spends is another feature’s and then names none, so it costs nothing and withholds nothing',
        });
      }
      const sized = ['usesByLevel', 'perProficiencyBonus', 'minimum', 'recovers', 'poolLabel', 'regainsOnShortRest']
        .filter((field) => (grant as unknown as Record<string, unknown>)[field] !== undefined);
      if (sized.length > 0) {
        found.push({
          field: `grants.${sized[0]!}`,
          code: 'sizes_anothers_pool',
          reason: `${sized.join(' and ')} size a pool, and this activation spends one another feature declares — the numbers would be read off that feature's own grant`,
        });
      }
    }
    if (grant.size !== undefined && !(CREATURE_SIZES as readonly unknown[]).includes(grant.size)) {
      found.push({
        field: 'grants.size',
        code: 'bad_activation_size',
        reason: `"${String(grant.size)}" is not a creature size; the engine has ${CREATURE_SIZES.join(', ')}`,
      });
    }
    // An awareness with no radius or nothing to report is a use of a pool that
    // buys silence — SRD Divine Sense's "any creature of those types within 60
    // feet". Both halves are the feature's and neither has a default: a radius
    // of nothing finds nobody and an empty list names nobody, and a caller who
    // spent the use would be told the room was empty.
    if (grant.detects !== undefined) {
      const detects = grant.detects;
      if (!isCount(detects.feet)) {
        found.push({
          field: 'grants.detects.feet',
          code: 'bad_awareness',
          reason: `an awareness reaches a whole number of feet of at least one, not ${String(detects.feet)}`,
        });
      }
      const types: unknown = detects.creatureTypes;
      if (
        !Array.isArray(types) ||
        types.length === 0 ||
        types.some((one: unknown) => typeof one !== 'string' || one.trim() === '')
      ) {
        found.push({
          field: 'grants.detects.creatureTypes',
          code: 'bad_awareness',
          reason:
            'an awareness names the creature types it reports, and one naming none would spend a use to find nobody',
        });
      }
    }

    const kinds = new Set<string>();
    (grant.hangs ?? []).forEach((hung, index) => {
      const at = `grants.hangs[${index}]`;
      if (kinds.has(hung.kind)) {
        found.push({
          field: `${at}.kind`,
          code: 'two_grants_of_one_kind',
          reason: `a use hangs one "${hung.kind}" grant: two share a source, and whatever ends the first ends the second`,
        });
      }
      kinds.add(hung.kind);

      if (hung.kind !== 'roll-mode') return;

      // **Asked of the value rather than of the type**, because this validator's
      // other half takes `unknown`: `parseFeatureDefinition` is the door a
      // homebrew class comes through as JSON text, and a missing modifier there
      // is a *refusal* rather than a `TypeError` thrown out of a function whose
      // contract is to return every problem it found.
      const modifier = hung.modifier as Partial<RollModifier> | undefined;
      const selector = modifier?.selector as Partial<RollSelector> | undefined;
      if (modifier === undefined || selector?.roll === undefined) {
        found.push({
          field: `${at}.modifier`,
          code: 'bad_roll_modifier',
          reason: 'a hung roll-mode grant carries a modifier, and a modifier says which rolls it reaches',
        });
        return;
      }

      if (modifier.oneShot === true) {
        const wrong = oneShotProblem(selector.roll);
        if (wrong !== null) {
          found.push({ field: `${at}.modifier.oneShot`, code: wrong.code, reason: wrong.reason });
        }
      }
    });
  }

  // Rule 6. The three ways the SRD sizes a pool, which are the three branches
  // `poolSizeOf` implements — plus its fourth, which names no shape at all and
  // is a pool of one ("Once you use this feature, you can't do so again until
  // you finish a Long Rest").
  const sized = poolSizingOf(grant);
  if (sized !== null) found.push(...sizingProblems(sized.sizing, sized.at, context));

  // Rule 10. A feature that reaches into a casting's damage, and the two
  // things it can say that nothing downstream could recover from.
  //
  // **A band that reaches no slot**, which is a narrowing that narrows to
  // nothing: a feature written `{ from: 5, to: 1 }` matches no casting at all,
  // and there is no moment at which anybody would find out.
  //
  // **A price counted in two dice.** SRD Overchannel escalates a d12 cost by a
  // d12, and the arithmetic is "how many of *the* die", so a cost printed in
  // d12s and escalating by d8s has no single answer. The resolver refuses it
  // (`mismatched_backlash_dice`) and this refuses it at the door, which is
  // where a catalogue error belongs.
  // **The rule a feature holds about a turn, asked of the one validator, on
  // both spellings of a standing effect.** `action-rule` is `combat.ts`'s
  // vocabulary written on a class table, and the sentence that refuses a
  // spell's allowance refuses a feature's for the same reason: a price no
  // command will charge is a clause that validates, compiles onto the sheet,
  // is handed back by `actionRulesOn` and is honoured by nothing.
  //
  // `standing.effects` and `activated.whileActive` are both `StandingGrant[]`
  // and creation compiles both onto the sheet, so a guard on one of them is a
  // rule enforced on whichever spelling the author happened not to use.
  // **And the Speed a feature grants, on both spellings for the same
  // reason.** SRD Second-Story Work's "a Climb Speed equal to your Speed" is
  // spelled exactly as SRD Spider Climb's is, so the pairing is held to the
  // same rule: a mode only beside an operation that *gives* a Speed, a match
  // only with a mode to give, and feet only with an `add`. A feature that
  // halved one mode would be a sentence the book does not print, and one that
  // matched the walking Speed to itself would compile onto a sheet and change
  // nothing.
  for (const [at, effects] of [
    ['grants.effects', grant.kind === 'standing' ? grant.effects : undefined],
    ['grants.whileActive', grant.kind === 'activated' ? grant.whileActive : undefined],
  ] as const) {
    (effects ?? []).forEach((effect, index) => {
      if (effect.kind === 'action-rule') {
        checkActionRule(effect.rule, `${at}[${index}].rule`, found);
        found.push(...allowancePriceProblems(effect, `${at}[${index}]`, declaredPools));
        return;
      }
      if (effect.kind === 'speed') {
        found.push(...speedGrantProblems(effect, `${at}[${index}]`));
      }
      // **The light SRD Sacred Weapon prints, on the spelling it prints it
      // in.** A light of no radius is a benefit that compiles onto the sheet
      // and is matched by no reader. The `standing` spelling one line up
      // reaches `ownedStandingEffectProblems`, which asks the same question of
      // a feat's grant and of a `standing` feature's, so asking it here as
      // well would report one mistake twice.
      if (at === 'grants.whileActive' && effect.kind === 'light') {
        found.push(...shedLightProblems(effect, `${at}[${index}]`));
      }
    });
  }

  if (grant.kind === 'standing') {
    (grant.effects ?? []).forEach((effect, index) => {
      if (effect.kind !== 'casting-damage') return;
      const at = `grants.effects[${index}]`;
      const band = effect.when.slotLevels;
      if (band !== undefined && band.from > band.to) {
        found.push({
          field: `${at}.when.slotLevels`,
          code: 'empty_slot_band',
          reason: `levels ${band.from} to ${band.to} is a band no slot falls in, so this feature would reach nothing`,
        });
      }
      const cost = effect.costs;
      if (cost !== undefined) {
        const base = parseNotation(cost.dicePerSlotLevel);
        const step = parseNotation(cost.increasesBy);
        if (!base.ok || !step.ok) {
          found.push({
            field: `${at}.costs`,
            code: 'bad_backlash_dice',
            reason: `a price is paid in dice: "${cost.dicePerSlotLevel}" and "${cost.increasesBy}" are not both notation`,
          });
        } else if (base.value.sides !== step.value.sides) {
          found.push({
            field: `${at}.costs.increasesBy`,
            code: 'mismatched_backlash_dice',
            reason: `a price printed in d${base.value.sides}s cannot escalate by a d${step.value.sides}; one price is counted in one die`,
          });
        }
        if (!Number.isInteger(cost.freeUses) || cost.freeUses < 0) {
          found.push({
            field: `${at}.costs.freeUses`,
            code: 'bad_free_uses',
            reason: `"the first time you do so" is a whole number of free uses, not ${String(cost.freeUses)}`,
          });
        }
        if (cost.key.trim().length === 0) {
          found.push({
            field: `${at}.costs.key`,
            code: 'bad_backlash_key',
            reason: 'the uses are counted under a key, and a blank one names no tally',
          });
        }
      }
    });
  }

  // Rule 11. A style that redefines an attack, and the three things it can say
  // that nothing downstream could recover from.
  //
  // **A die that is not a die.** The notation is thrown by `rollAttackDamage`
  // and compared against the weapon's own before it is, so a malformed one
  // would silently lose that comparison and the feature would appear to do
  // nothing at all — the quietest possible failure.
  //
  // **A table that does not reach the level it is read at.** The die is a
  // column of a class table, indexed by that class's level, and a short column
  // leaves a high-level holder with no die rather than an error.
  //
  // **A style that says nothing.** A grant with no die, no ability and no
  // Bonus Action strike is `automation: 'engine'` claiming an execution that
  // changes nothing, which is rule 4's failure wearing a legal grant kind.
  if (grant.kind === 'strike-style') {
    const table = grant.dieByLevel;
    if (table !== undefined) {
      if (table.length < MAX_LEVEL) {
        found.push({
          field: 'grants.dieByLevel',
          code: 'short_die_table',
          reason: `a die read at a class level needs a row for each of the ${MAX_LEVEL} levels, and this has ${table.length}`,
        });
      }
      const bad = table.filter((notation) => !parseNotation(notation).ok);
      if (bad.length > 0) {
        found.push({
          field: 'grants.dieByLevel',
          code: 'bad_strike_die',
          reason: `a die rolled in place of a weapon's damage is notation: ${bad.join(', ')} ${bad.length === 1 ? 'is' : 'are'} not`,
        });
      }
    }
    if (
      grant.dieByLevel === undefined &&
      grant.ability === undefined &&
      grant.bonusUnarmedStrike !== true
    ) {
      found.push({
        field: 'grants',
        code: 'empty_strike_style',
        reason:
          'a style redefines a die, an ability or the action a strike costs; one that redefines none of the three is a feature claiming to be executed and changing nothing',
      });
    }
    // **And a selector nobody could ever match**, which is the same quiet
    // failure from the other end: a category, a kind or a property outside the
    // closed sets the equipment tables print names no weapon, so the style
    // would cover less than it says and nothing would ever say so. The
    // compiler holds a class file written here; this holds one that arrived as
    // JSON.
    (grant.weapons ?? []).forEach((selector, index) => {
      found.push(...weaponSelectorProblems(selector, `grants.weapons[${index}]`));
    });

    if (grant.whileWieldingOnly === true && (grant.weapons ?? []).length === 0) {
      found.push({
        field: 'grants.whileWieldingOnly',
        code: 'wields_nothing',
        reason:
          '"wielding only" reads the weapons this style names, and a style that names none would be lost the moment its holder picked up anything at all',
      });
    }
  }

  // The two fields a trait that grants a spell writes about **itself**, and
  // the ways each of them can name nothing.
  //
  // `abilities` is the set the player picks from — SRD's lineages print
  // "Intelligence, Wisdom, or Charisma" — so an empty offer asks a question
  // with no legal answer and a word that is not an ability is an answer
  // nothing could match. Neither would fail anywhere: the trait would compile,
  // the character would be refused `missing_feature_spellcasting` for ever,
  // and nothing would say which end was wrong.
  //
  // `fromLevel` is the character level a staged spell arrives at, and a level
  // past the end of the table is `unreachable_level`'s failure one step down:
  // a grant nobody is ever given, on a feature that validates.
  if (grant.kind === 'spells') {
    const abilities = grant.abilities;
    if (abilities !== undefined) {
      if (abilities.length === 0) {
        found.push({
          field: 'grants.abilities',
          code: 'bad_spellcasting_ability',
          reason: 'a trait that offers no ability at all asks a question with no legal answer',
        });
      }
      for (const [index, ability] of abilities.entries()) {
        if (!ABILITY_NAMES.has(ability)) {
          found.push({
            field: `grants.abilities[${index}]`,
            code: 'bad_spellcasting_ability',
            reason: `"${String(ability)}" is not one of the six abilities`,
          });
        }
      }
    }
    // The casting time this grant states over the spell's own — SRD Pact of
    // the Chain's "as a Magic action" over Find Familiar's hour. Held to the
    // four the vocabulary has, because `castingOf` prefers it to the
    // definition's and a fifth word would price the casting against a slot of
    // the action economy that does not exist.
    const time = grant.castingTime;
    if (time !== undefined && !CASTING_TIME_NAMES.has(time)) {
      found.push({
        field: 'grants.castingTime',
        code: 'bad_casting_time',
        reason: `a route casts its spell as an Action, a Bonus Action, a Reaction or over a span, and "${String(time)}" is none of them`,
      });
    }
    // **And `long` is the one of the four a route may not state**, because the
    // field carries no seconds to measure it by: a definition prints
    // `castingSeconds` beside its own `long`, and a route that shortened a
    // spell to "a span" and said nothing about how long would leave the
    // settlement with a casting that never completes. Every route the book
    // writes shortens a casting to a moment in the turn; a feature that
    // lengthened one would be a sentence nobody has printed.
    if (time === 'long') {
      found.push({
        field: 'grants.castingTime',
        code: 'bad_casting_time',
        reason:
          'a route states a casting time to shorten one to a moment in the turn; "long" is a span and this field carries no seconds to measure it by',
      });
    }
    // And the forms it adds to a summons' list. Whether the ids name stat
    // blocks is `checkContent`'s, which holds the bestiary; what is asked here
    // is whether the sentence says anything at all — a list of none widens
    // nothing, and a blank id names nothing.
    const widened = grant.widensForm;
    if (widened !== undefined) {
      if (widened.length === 0) {
        found.push({
          field: 'grants.widensForm',
          code: 'widens_no_form',
          reason: 'a grant that widens a summons’ forms by nothing offers what the spell already offered',
        });
      }
      widened.forEach((id, index) => {
        if (typeof id === 'string' && id.trim() !== '') return;
        found.push({
          field: `grants.widensForm[${index}]`,
          code: 'widens_no_form',
          reason: 'a form is named by its stat block id, and a blank one names nothing',
        });
      });
    }
    const from = grant.fromLevel;
    if (from !== undefined && (!Number.isInteger(from) || from < 1 || from > context.levels)) {
      found.push({
        field: 'grants.fromLevel',
        code: 'unreachable_grant_level',
        reason: `this grant arrives at character level ${String(from)}, which is outside the 1 to ${context.levels} a character reaches, so nobody would ever be given it`,
      });
    }
  }

  // The spell whose summons a forgone attack is about — SRD Pact of the
  // Chain's "**your** familiar". Rule 5's reason: the id is the feature's own
  // answer and is never checked against a character's choices, so a typo in
  // one would refuse every order its holder ever gave and say nothing here.
  if (grant.kind === 'summons-attack') {
    if (typeof grant.from !== 'string' || grant.from.trim() === '') {
      found.push({
        field: 'grants.from',
        code: 'unknown_granted_spell',
        reason:
          'a forgone attack names the spell whose summons may take it; a blank id names nothing, and every summons would be somebody else’s',
      });
    } else if (!context.spellExists(grant.from)) {
      found.push({
        field: 'grants.from',
        code: 'unknown_granted_spell',
        reason: `this content holds no spell with the id "${grant.from}", so no creature is ever the familiar this sentence is about`,
      });
    }
  }

  // A hit point maximum that raises nothing, and a step counted in levels
  // nobody has.
  //
  // `flat` is what the feature is worth at the level it arrives at — Dwarven
  // Toughness's 1 and Draconic Resilience's 3 — so a zero is a trait whose
  // sentence says nothing happens and a fraction is a hit point the sheet
  // cannot hold. Both would validate, compile into the maximum and move it by
  // nothing or by half, which is the quiet failure this file exists to refuse
  // at authoring.
  //
  // And the per-level term is read at a level: the **character's** for a
  // species trait, or the **granting class's** for a class feature, which are
  // the only two levels `planCharacter` can answer for. Anything else names a
  // column of somebody else's book.
  if (grant.kind === 'hit-point-maximum') {
    if (!isCount(grant.flat)) {
      found.push({
        field: 'grants.flat',
        code: 'bad_hit_point_maximum',
        reason: `a feature's hit points are a whole number of at least one, not ${String(grant.flat)}`,
      });
    }
    if (grant.perLevel !== undefined && grant.perLevel !== 'character' && grant.perLevel !== 'class') {
      found.push({
        field: 'grants.perLevel',
        code: 'bad_hit_point_maximum',
        reason: `a level is the character's or the granting class's, and "${String(grant.perLevel)}" is neither`,
      });
    }
  }

  // A shape with no table, a table nobody reaches, or scores nobody has.
  //
  // Every number on this grant is read at a class level and multiplied or
  // compared, so a row at level 0, a negative ceiling, no hours per level, or
  // a kept score that is not one of the six would each compile onto a sheet
  // and misbehave quietly. The form *list* is the character's and is checked
  // at creation against the row; what is checked here is the vocabulary the
  // feature itself wrote.
  if (grant.kind === 'shape-shift') {
    const bad = (field: string, reason: string): void => {
      found.push({ field, code: 'bad_shape_shift', reason });
    };
    if (typeof grant.pool !== 'string' || grant.pool.trim() === '') {
      bad('grants.pool', 'a shape spends a pool it declares, and the pool needs a key');
    }
    if (typeof grant.formType !== 'string' || grant.formType.trim() === '') {
      bad('grants.formType', 'a shape names the creature type a form must print');
    }
    const rows: readonly Partial<ShapeShiftRow>[] | undefined = Array.isArray(grant.forms)
      ? grant.forms
      : undefined;
    if (rows === undefined || rows.length === 0) {
      bad(
        'grants.forms',
        'a shape prints at least one row of forms: how many are known, the Challenge Rating ceiling, and whether a flier may be taken',
      );
    } else {
      let last = 0;
      rows.forEach((row, index) => {
        const at = `grants.forms[${index}]`;
        const from = row.fromLevel;
        if (!Number.isInteger(from) || (from as number) < 1 || (from as number) > context.levels) {
          bad(`${at}.fromLevel`, `a row arrives at a class level between 1 and ${context.levels}, not ${String(from)}`);
        } else if ((from as number) <= last) {
          bad(`${at}.fromLevel`, 'rows are printed in ascending order of level, each above the one before');
        }
        if (typeof from === 'number') last = from;
        if (!isCount(row.known)) {
          bad(`${at}.known`, `a row knows a whole number of forms of at least one, not ${String(row.known)}`);
        }
        if (typeof row.maxChallengeRating !== 'number' || !(row.maxChallengeRating >= 0)) {
          bad(`${at}.maxChallengeRating`, `a Challenge Rating ceiling is a number of at least 0, not ${String(row.maxChallengeRating)}`);
        }
        if (typeof row.flying !== 'boolean') {
          bad(`${at}.flying`, 'a row says whether a form with a Fly Speed may be taken');
        }
      });
    }
    if (typeof grant.hoursPerLevel !== 'number' || !(grant.hoursPerLevel > 0)) {
      bad('grants.hoursPerLevel', `a form lasts a positive number of hours per class level, not ${String(grant.hoursPerLevel)}`);
    }
    const temporary = grant.temporaryHitPointsPerLevel;
    if (temporary !== undefined && (typeof temporary !== 'number' || !(temporary >= 0))) {
      bad('grants.temporaryHitPointsPerLevel', `Temporary Hit Points per class level are a number of at least 0, not ${String(temporary)}`);
    }
    const kept: unknown = grant.keeps?.abilities;
    if (!Array.isArray(kept)) {
      bad('grants.keeps.abilities', 'a shape lists the scores its holder keeps, even where the list is empty');
    } else {
      kept.forEach((ability: unknown, index) => {
        if (!ABILITY_NAMES.has(ability as string)) {
          bad(`grants.keeps.abilities[${index}]`, `"${String(ability)}" is not one of the six abilities`);
        }
      });
    }
  }

  // What a later feature adds to a form already on somebody else's menu, and
  // the three ways it can be a sentence nothing could execute.
  //
  // **An amended form is validated where an added one is not**, and that is
  // the point rather than an oversight: `featureOptionsProblems` judges the
  // forms this grant *adds*, and the amendments go nowhere near it because
  // they declare no form at all — so a die nobody parsed, a damage type no
  // defence will ever match and a count read by `poolSizeOf` would each have
  // compiled onto the sheet and reached `dealSpellDamage` as data the engine
  // cannot argue with.
  if (grant.kind === 'pool-options') {
    (grant.amends ?? []).forEach((amendment, at) => {
      const field = `grants.amends[${at}].damagesFailures`;
      const damage = amendment?.damagesFailures;
      // `== null` and not `=== undefined`: `typeof null` is "object", so a
      // homebrew that writes `damagesFailures: null` would have walked through
      // the gate and been dereferenced. A catalogue arriving as JSON is not
      // programmer error, and rule 6 says what it gets back.
      if (damage == null || typeof damage !== 'object') {
        found.push({
          field,
          code: 'amends_nothing',
          reason: `${feature.id} changes "${String(amendment?.option)}" and says nothing about what changes`,
        });
        return;
      }
      // **One die and nothing else.** The field is a die and the count beside
      // it is the sizing, so a notation that carries its own count, a flat
      // addend or a keep rule says something the compiler then throws away —
      // `withDiceCountOf` writes the sizing's count and the parsed sides and
      // reads nothing else. A sentence silently dropped is the failure this
      // file exists to refuse at authoring.
      const die = parseNotation(String(damage.die));
      if (!die.ok) {
        found.push({
          field: `${field}.die`,
          code: 'bad_dice',
          reason: `"${String(damage.die)}" is not dice this engine can roll`,
        });
      } else if (die.value.count !== 1 || die.value.modifier !== 0 || die.value.keep !== null) {
        found.push({
          field: `${field}.die`,
          code: 'bad_dice',
          reason: `"${String(damage.die)}" says more than a die: how many is the count beside it, and a flat addend or a keep rule is read by nothing`,
        });
      }
      if (!DAMAGE_KINDS.has(damage.damageType)) {
        found.push({
          field: `${field}.damageType`,
          code: 'unknown_damage_type',
          reason: `"${String(damage.damageType)}" is not a damage type, so nothing a creature resists or is immune to would ever match it`,
        });
      }
      // The **shape** before the rules, which is the half `content.ts` gives
      // every other declared sizing ("a declared pool is an object"): a count
      // written `3` or `"wis"` reaches `poolSizeOf`, falls through every branch
      // to `minimum ?? 1`, and the feature quietly deals one die for ever.
      if (damage.count == null || typeof damage.count !== 'object') {
        found.push({
          field: `${field}.count`,
          code: 'bad_pool_sizing',
          reason: `how many dice is one of the sizings the engine reads, written as an object, not ${String(damage.count)}`,
        });
      } else {
        found.push(...sizingProblems(damage.count, `${field}.count`, context));
      }
    });
  }

  // A Long Rest this trait shortens, and the two lengths that would be a
  // sentence the book never printed.
  //
  // Zero or less is a rest that is over before it starts, and a length at or
  // past the eight hours the engine holds for everybody is a trait that
  // compiles onto the sheet and changes nothing — or lengthens a rest, which
  // no printed trait does and which the field was not built to say.
  // The training a feature grants, held to the two lists it feeds. A category
  // no sheet carries trains nobody — `proficientWithCategories` answers false
  // for a word it does not know and `ArmorTraining` has four flags and no
  // fifth — so a typo would be a Protector who is not proficient with a
  // longsword and nothing at all would say why.
  if (grant.kind === 'weapon-and-armor-training') {
    const { weapons, armor } = grant;
    if (weapons === undefined && armor === undefined) {
      found.push({
        field: 'grants',
        code: 'empty_training_grant',
        reason: `${feature.id} grants training and names neither weapons nor armour, so it trains nobody in anything`,
      });
    }
    for (const [field, named, allowed] of [
      ['weapons', weapons, TRAINABLE_WEAPONS],
      ['armor', armor, TRAINABLE_ARMOR],
    ] as const) {
      if (named === undefined) continue;
      if (!Array.isArray(named) || named.length === 0) {
        found.push({
          field: `grants.${field}`,
          code: 'bad_training_grant',
          reason: `${feature.id} trains its holder with ${field} and names none; leave the field out instead`,
        });
        continue;
      }
      (named as readonly string[]).forEach((one, index) => {
        if (!(allowed as readonly string[]).includes(one)) {
          found.push({
            field: `grants.${field}[${index}]`,
            code: 'bad_training_grant',
            reason: `a sheet knows ${allowed.join(', ')}, not "${String(one)}", so this training would reach nothing`,
          });
        }
      });
    }
  }

  // What a feature pays when an enemy falls, and the three ways it could be a
  // sentence nobody could act on.
  //
  // An ability nobody has is a modifier read off a sheet that has no such
  // score; a minimum below zero is a floor under a number that cannot go
  // there, and SRD's own floor is one; and a distance that is not a positive
  // whole number of feet is a reach the scene cannot answer — a zero would be
  // an ally who has to be standing *inside* the body, which is not a sentence
  // the book prints and is worse than leaving the field out, which already
  // means "your own kills only".
  if (grant.kind === 'on-dropping-a-hostile') {
    const points = grant.temporaryHitPoints;
    if (points === null || typeof points !== 'object') {
      found.push({
        field: 'grants.temporaryHitPoints',
        code: 'bad_drop_reward',
        reason: `${feature.id} pays its holder when an enemy falls and says nothing about how much`,
      });
    } else {
      if (!ABILITY_NAMES.has(String(points.ability))) {
        found.push({
          field: 'grants.temporaryHitPoints.ability',
          code: 'bad_drop_reward',
          reason: `a sheet holds ${[...ABILITY_NAMES].join(', ')}, not "${String(points.ability)}"`,
        });
      }
      if (!Number.isInteger(points.minimum) || points.minimum < 0) {
        found.push({
          field: 'grants.temporaryHitPoints.minimum',
          code: 'bad_drop_reward',
          reason: `a minimum number of Temporary Hit Points is a whole number of none or more, not ${String(points.minimum)}`,
        });
      }
    }
    if (grant.within !== undefined && !isCount(grant.within)) {
      found.push({
        field: 'grants.within',
        code: 'bad_drop_reward',
        reason: `"within N feet of you" is a whole number of feet of at least one, not ${String(grant.within)}; leave the field out for a feature that pays only its holder's own kills`,
      });
    }
  }

  if (grant.kind === 'long-rest-length') {
    if (!isCount(grant.seconds)) {
      found.push({
        field: 'grants.seconds',
        code: 'bad_rest_length',
        reason: `a Long Rest takes a whole number of seconds of at least one, not ${String(grant.seconds)}`,
      });
    } else if (grant.seconds >= LONGEST_LONG_REST) {
      found.push({
        field: 'grants.seconds',
        code: 'bad_rest_length',
        reason: `a Long Rest already takes ${LONGEST_LONG_REST} seconds for everybody, so ${grant.seconds} shortens nothing`,
      });
    }
  }

  // A question re-asked on a rest, and the two ways it can be a question
  // nobody could ever answer.
  //
  // A rest is a Short one or a Long one and nothing else, so a third word is a
  // grant `endRest` would compare against both kinds and match neither — a
  // feature that validates, compiles, and is silently never re-asked.
  //
  // And a grant that re-asks **this feature's own choice** on a feature that
  // asks nothing is the same failure from the other end: the rest would hand
  // `planCharacter` an answer to a question the feature does not print, and
  // creation would refuse the character on a rest rather than at the door.
  // The swap count is a count for the reason every other count here is one: a
  // zero is a sentence that says nothing happens.
  if (grant.kind === 'rechosen-on-a-rest') {
    if (grant.rest !== 'short' && grant.rest !== 'long') {
      found.push({
        field: 'grants.rest',
        code: 'bad_rest_kind',
        reason: `a rest is short or long, and "${String(grant.rest)}" is neither`,
      });
    }
    const rechooses = grant.rechooses;
    if (rechooses?.kind === 'this-features-choice') {
      if (featureChoicesOf(feature).length === 0) {
        found.push({
          field: 'grants.rechooses',
          code: 'rechooses_nothing',
          reason: `${feature.id} re-asks its own choice on a rest and asks no choice, so there is nothing to answer again`,
        });
      }
    } else if (rechooses?.kind === 'prepared-spells') {
      if (!isCount(rechooses.swap)) {
        found.push({
          field: 'grants.rechooses.swap',
          code: 'rechooses_nothing',
          reason: `a swap is a whole number of at least one spell, not ${String(rechooses.swap)}`,
        });
      }
    } else {
      found.push({
        field: 'grants.rechooses',
        code: 'rechooses_nothing',
        reason: `a rest re-asks this feature's own choice or a line of the prepared list, and "${String((rechooses as { kind?: unknown } | undefined)?.kind)}" is neither`,
      });
    }
  }

  // The other spelling of the same sentence, and the three facts a re-choice
  // on a **grant** needs before anything can answer it: SRD Elven Lineage's
  // "you can replace **that** cantrip with a different cantrip from the
  // **Wizard** spell list".
  //
  // The one fixed spell is the load-bearing rule. The offer names the spell
  // being replaced, the answer is filed under it, and creation reads it back —
  // so a grant handing over two spells has no *that*, and every one of those
  // three readers would have to invent which one the rest meant.
  if (grant.kind === 'spells' && grant.rechosenOn !== undefined) {
    const rechosen = grant.rechosenOn;
    if (rechosen.rest !== 'short' && rechosen.rest !== 'long') {
      found.push({
        field: 'grants.rechosenOn.rest',
        code: 'bad_rest_kind',
        reason: `a rest is short or long, and "${String(rechosen.rest)}" is neither`,
      });
    }
    if ((grant.fixed ?? []).length !== 1) {
      found.push({
        field: 'grants.rechosenOn',
        code: 'rechooses_nothing',
        reason: `a rest replaces the one spell this grant prints, and ${(grant.fixed ?? []).length} are printed`,
      });
    }
    if (typeof rechosen.fromClass !== 'string' || rechosen.fromClass.trim() === '') {
      found.push({
        field: 'grants.rechosenOn.fromClass',
        code: 'rechooses_nothing',
        reason:
          'a replacement comes from a named class’s spell list, and a grant naming none would refuse every answer',
      });
    }
    if (
      !Number.isInteger(rechosen.maxLevel) ||
      rechosen.maxLevel < 0 ||
      rechosen.maxLevel > TOP_SPELL_LEVEL
    ) {
      found.push({
        field: 'grants.rechosenOn.maxLevel',
        code: 'bad_rechosen_level',
        reason: `a replacement's ceiling is a spell level from 0 to ${TOP_SPELL_LEVEL}, not ${String(rechosen.maxLevel)}`,
      });
    }
  }

  // A feature that makes a thing, judged on the five numbers the trait prints
  // and the menu it offers. Each of them is read by a command and none has a
  // default: a thing with no hit points cannot be broken, a thing that stands
  // for no time never falls apart, a ceiling of nothing refuses every making,
  // and a menu of nothing refuses every function anybody names — four
  // different ways for the feature to validate and do nothing.
  if (grant.kind === 'creates-object') {
    const made = grant.object as Partial<typeof grant.object> | undefined;
    if (!(CREATURE_SIZES as readonly unknown[]).includes(made?.size)) {
      found.push({
        field: 'grants.object.size',
        code: 'bad_made_object',
        reason: `"${String(made?.size)}" is not a creature size; the engine has ${CREATURE_SIZES.join(', ')}`,
      });
    }
    if (!isCount(made?.armorClass) || !isCount(made?.hitPoints)) {
      found.push({
        field: 'grants.object',
        code: 'bad_made_object',
        reason: 'a thing a feature makes prints an Armour Class and a hit point total, each a whole number of at least one',
      });
    }
    for (const [field, value] of [
      ['castingSeconds', grant.castingSeconds],
      ['lastsSeconds', grant.lastsSeconds],
      ['atOnce', grant.atOnce],
    ] as const) {
      if (!isCount(value)) {
        found.push({
          field: `grants.${field}`,
          code: 'bad_made_object',
          reason: `${field} is a whole number of at least one, not ${String(value)}`,
        });
      }
    }
    if (typeof grant.spell !== 'string' || grant.spell.trim() === '') {
      found.push({
        field: 'grants.spell',
        code: 'bad_made_object',
        reason: 'the making is a casting, and what is made is kept on a bond that records which spell made it',
      });
    } else if (!context.spellExists(grant.spell)) {
      found.push({
        field: 'grants.spell',
        code: 'unknown_granted_spell',
        reason: `this content holds no spell with the id "${grant.spell}", so the casting this feature makes its thing with names nothing`,
      });
    }
    const menu: unknown = grant.functions;
    if (
      !Array.isArray(menu) ||
      menu.length === 0 ||
      menu.some((one: unknown) => typeof one !== 'string' || one.trim() === '')
    ) {
      found.push({
        field: 'grants.functions',
        code: 'bad_made_object',
        reason: 'a thing a feature makes does one of the effects the feature prints, and a menu naming none would refuse every making',
      });
    }
    // What touching it costs, which is a price the command really charges —
    // unlike the making's own, which is the clock's. A third word here is a
    // Bonus Action nobody could spend.
    if (grant.activation !== 'action' && grant.activation !== 'bonus-action') {
      found.push({
        field: 'grants.activation',
        code: 'bad_made_object',
        reason: `touching the thing costs an action or a Bonus Action, and "${String(grant.activation)}" is neither`,
      });
    }
  }

  // A gate on an option nobody can pick — the half a definition can answer
  // about itself, which is the half where the choice is its own.
  //
  // A gate that matches nothing is never an error at any moment: the character
  // simply never gets the benefit, every pass compiles, and nothing anywhere
  // says why. The other half — a gate reading a **sibling's** choice — is
  // `checkContent`'s, because it needs the source this feature belongs to.
  if (grant.onlyIfChoice !== undefined && grant.choiceFrom === undefined) {
    // The **primary** question, which is the one an answer is filed under the
    // feature's own id — a keyed question's answer is a cantrip or a skill and
    // never an option a grant could be gated on.
    const asked = primaryChoiceOf(feature);
    if (asked === undefined || asked.kind !== 'option') {
      found.push({
        field: 'grants.onlyIfChoice',
        code: 'gate_without_a_choice',
        reason:
          asked === undefined
            ? `${feature.id} grants ${grant.onlyIfChoice} only to whoever chose it, and asks the player for nothing`
            : `a "${asked.kind}" choice offers no named options, so nothing could ever answer ${String(grant.onlyIfChoice)}`,
      });
    } else if (!asked.from.includes(grant.onlyIfChoice)) {
      found.push({
        field: 'grants.onlyIfChoice',
        code: 'option_not_offered',
        reason: `${feature.id} gates this grant on ${grant.onlyIfChoice} and offers ${asked.from.join(' or ')}, so nobody could ever hold it`,
      });
    }
  }

  // And the reading end of the same rule: the field says where a choice is
  // read *from*, so a grant that reads no choice names a source for nothing.
  //
  // Asked of every kind, because the gate is every kind's now. Only a
  // `standing` grant reads a choice for anything but the gate, which is the
  // damage types its table supplies.
  if (
    grant.choiceFrom !== undefined &&
    grant.onlyIfChoice === undefined &&
    !(grant.kind === 'standing' && grant.damageTypesFromChoice === true) &&
    // And the second host of that same field: SRD Breath Weapon's damage is
    // "of the type determined by your Draconic Ancestry trait", read off the
    // menu's options exactly as the Resistance beneath it is read off a
    // standing effect.
    !(grant.kind === 'pool' && grant.damageTypesFromChoice === true) &&
    // A `spells` grant reads a third thing off the feature that asked: the
    // spellcasting ability. SRD Otherworldly Presence is "the spell uses the
    // same spellcasting ability you use for your Fiendish Legacy trait", which
    // is one question and two traits written in terms of it.
    grant.kind !== 'spells'
  ) {
    found.push({
      field: 'grants.choiceFrom',
      code: 'choice_from_reads_nothing',
      reason: `${feature.id} says its choice is made on ${grant.choiceFrom} and nothing on the grant reads a choice`,
    });
  }

  return found;
}

/**
 * Everything wrong with a feature definition, rather than the first thing.
 *
 * The shape `checkCharacter` and `checkSpellDefinition` already use, for the
 * same reason: somebody filling in a definition does not want to be told about
 * one mistake at a time. {@link parseFeatureDefinition} is the `Result` half.
 */
export function checkFeatureDefinition(
  feature: FeatureDefinition,
  context: FeatureContext,
): readonly FeatureDefinitionProblem[] {
  const found: FeatureDefinitionProblem[] = [];

  // Rule 1, the half that is about one definition. A feature id is a global
  // key — `featureChoices` is keyed by it, `classLevelFor` splits it on the
  // colon, and it reaches the log inside `character-created`. So the namespace
  // is not decoration.
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*:[a-z0-9]+(?:-[a-z0-9]+)*$/.test(feature.id)) {
    found.push({
      field: 'id',
      code: 'bad_feature_id',
      reason: `"${feature.id}" is not a namespaced id: lower-case hyphenated words either side of one colon, as in "source:feature-name"`,
    });
  }

  // **And not one of the namespaces the engine writes into the turn ledger.**
  // A feature id is a key in `featureUsedOnTurn` the moment something spends it
  // once per turn, and the engine's own entries live in that same map behind a
  // prefix. A content id inside one of those prefixes is a key the engine's
  // readers would pick up as theirs — `stated-bonus-action:` is read by a gated
  // Multiattack, which would then be opened by a class feature rather than by
  // the printed line the book names.
  if (RESERVED_LEDGER_NAMESPACES.some((namespace) => feature.id.startsWith(namespace))) {
    found.push({
      field: 'id',
      code: 'reserved_feature_namespace',
      reason: `"${feature.id}" is in a namespace the engine keeps for its own turn ledger (${RESERVED_LEDGER_NAMESPACES.join(', ')}); pick another`,
    });
  }

  if (feature.name.trim().length === 0) {
    found.push({ field: 'name', code: 'bad_name', reason: 'a feature needs a name' });
  }

  if (feature.automation !== 'engine' && feature.automation !== 'manual') {
    found.push({
      field: 'automation',
      code: 'bad_automation',
      reason: `"${String(feature.automation)}" is neither "engine" nor "manual"; there is no third state in which the engine half-does something`,
    });
  }

  // Rule 2. A feature granted at a level its own source's table does not reach
  // is unreachable: `featuresAt` filters by equality and `cumulativeFeatures`
  // by `<=`, so nobody would ever be granted it and nothing would say so.
  if (
    !Number.isInteger(feature.level) ||
    feature.level < 1 ||
    feature.level > context.levels
  ) {
    found.push({
      field: 'level',
      code: 'unreachable_level',
      reason: `level ${feature.level} is outside the 1 to ${context.levels} this source's table reaches, so nothing would ever grant it`,
    });
  }

  // Rule 3. Only of a manual feature: `manual` means a DM applies it, and the
  // note is the whole of what tells them what is left to do. An absent note
  // and a placeholder one are the same failure, so they take one code.
  const note = feature.note.trim();
  if (feature.automation === 'manual' && (note.length === 0 || HOLLOW_NOTE.test(note))) {
    found.push({
      field: 'note',
      code: 'hollow_note',
      reason:
        'a manual feature\'s note says what a DM still has to do; an unexplained "not automated" is not a useful thing to read at three in the morning',
    });
  }

  // Rule 4. The structural form of the nine-features failure: a feature that
  // claims the engine executes it, and declares nothing the engine reads.
  if (feature.automation === 'engine') {
    const declares = [...context.readableFields].filter(
      (field) => (feature as unknown as Record<string, unknown>)[field] !== undefined,
    );
    // Executed through another feature's declaration, or through the source's
    // own — see {@link FeatureDefinition.executedBy} and
    // {@link FeatureContext.executedBySource}.
    const elsewhere =
      feature.executedBy !== undefined || context.executedBySource?.has(feature.id) === true;
    if (declares.length === 0 && !elsewhere) {
      found.push({
        field: 'automation',
        code: 'engine_declares_nothing',
        reason: `this feature claims to be executed and declares none of ${[...context.readableFields].sort().join(', ')}, so nothing on the feature reaches a reader`,
      });
    }
  }

  // Rule 8, the half a definition can answer about itself — rule 7 is the
  // population's and lives below. The other half, whether the sibling a grant
  // names exists and asks anything, is `checkContent`'s: it needs the source
  // this feature belongs to, which a feature does not know.
  const table = feature.optionMeans;
  if (table !== undefined) {
    // The primary question's, for the reason the gate above reads that one:
    // the table is the other column of the table the book prints beside the
    // options, and only an option question has options.
    const asked = primaryChoiceOf(feature);
    if (asked === undefined || asked.kind !== 'option') {
      found.push({
        field: 'optionMeans',
        code: 'table_without_a_choice',
        reason:
          asked === undefined
            ? 'a table of what each option means is keyed by a choice, and this feature asks for none'
            : `a "${asked.kind}" choice offers no named options for a table to be keyed by`,
      });
    } else {
      const offered = new Set(asked.from);
      for (const option of asked.from) {
        if (!Object.prototype.hasOwnProperty.call(table, option)) {
          found.push({
            field: `optionMeans.${option}`,
            code: 'option_missing_from_table',
            reason: `the choice offers ${option} and the table says nothing about it, so a character who took it would get nothing and nothing would say so`,
          });
        }
      }
      for (const key of Object.keys(table)) {
        if (!offered.has(key)) {
          found.push({
            field: `optionMeans.${key}`,
            code: 'unknown_option_in_table',
            reason: `the table says what ${key} means and the choice does not offer it, so nobody can pick it`,
          });
        }
      }
    }

    // The values, whatever the keys came to. An unknown *field* on a meaning
    // is left alone — see {@link FeatureOptionMeaning} — but a field this
    // engine does know has to be the shape it knows.
    for (const [key, meaning] of Object.entries(table)) {
      if (typeof meaning !== 'object' || meaning === null || Array.isArray(meaning)) {
        found.push({
          field: `optionMeans.${key}`,
          code: 'bad_option_meaning',
          reason: 'what an option means is an object saying what it supplies',
        });
        continue;
      }
      const types = (meaning as FeatureOptionMeaning).damageTypes;
      if (
        types !== undefined &&
        (!Array.isArray(types) ||
          types.length === 0 ||
          types.some((type) => typeof type !== 'string' || type.trim().length === 0))
      ) {
        found.push({
          field: `optionMeans.${key}.damageTypes`,
          code: 'bad_option_meaning',
          reason: 'damage types an option supplies are a non-empty list of named types',
        });
      }
    }
  }

  // Rule 9. Two points of ability, and a score above twenty — the shape every
  // class prints twice. Both halves are checkable one definition at a time,
  // because both live on the same feature: the branches the sentence offers,
  // and the scores its grant raises or lifts a ceiling for.
  found.push(...abilityChoiceProblems(feature));

  // Rule 8b. The questions themselves, where there is more than one.
  found.push(...choiceProblems(feature, context));

  // Rule 12. Two grants of one kind on one feature, and whether that kind
  // composes.
  //
  // | Kind | Repeats | Why |
  // |---|---|---|
  // | `standing` | freely | the reader is a loop over effects, each with its own source; SRD prints several benefits under one heading |
  // | `spells` | freely | every reader of one is a loop too, each grant is its own "you know X" sentence, and each free casting names its own pool — SRD's lineages and legacies print a cantrip and two levelled spells under one heading |
  // | every other kind | only under distinct gates | every other reader looks for *the* grant of its kind, so two that could both apply is an ambiguity nothing resolves |
  //
  // A gate makes the difference only where it is really exclusive, and that is
  // **this feature's own choice, taking one answer**: "you gain one of the
  // following options" is one answer, so at most one of two differently gated
  // grants is ever compiled. Three ways it stops being exclusive, and each is
  // the ambiguity back in an option's clothes — two grants under the *same*
  // gate, a choice that takes two answers (SRD Metamagic is `choose: 2`), and
  // a gate read off a sibling, whose answers this definition cannot see.
  const asked = primaryChoiceOf(feature);
  const exclusive = asked !== undefined && asked.kind === 'option' && asked.choose === 1;
  const byKind = new Map<string, GatedFeatureGrant[]>();
  for (const grant of featureGrants(feature)) {
    byKind.set(grant.kind, [...(byKind.get(grant.kind) ?? []), grant]);
  }
  for (const [kind, sharing] of byKind) {
    if (sharing.length < 2 || kind === 'standing' || kind === 'spells') continue;
    const gates = new Set(sharing.map((grant) => grant.onlyIfChoice ?? ''));
    const ownGate = sharing.every((grant) => grant.choiceFrom === undefined);
    if (exclusive && ownGate && gates.size === sharing.length && !gates.has('')) continue;
    found.push({
      field: 'grants',
      code: 'grants_do_not_compose',
      reason: `${feature.id} carries ${sharing.length} "${kind}" grants, and a reader looking for the ${kind} would find two; only "standing" and "spells" repeat freely, and any other kind repeats only as one option each of this feature's own choice of one`,
    });
  }

  // Every rule about a grant, asked of each grant the feature carries.
  //
  // The path says which: a feature that writes one grant reports `grants.x`
  // exactly as it always did, and one that writes a list reports `grants[1].x`,
  // so a problem can be found in the file it came from.
  const listed = Array.isArray(feature.grants);
  featureGrants(feature).forEach((grant, index) => {
    for (const problem of grantProblems(feature, grant, context)) {
      found.push({
        ...problem,
        field: listed ? problem.field.replace(/^grants/, `grants[${index}]`) : problem.field,
      });
    }
  });

  return found;
}

/**
 * A weapon selector nobody could ever match.
 *
 * A category, a kind or a property outside the closed sets the equipment
 * tables print names no weapon at all, so whatever reads the selector covers
 * less than it says and nothing says so — the quiet failure this whole file
 * exists to convert into a refusal at authoring. The compiler holds a class
 * file written in TypeScript to the same three sets; this holds one that
 * arrived as JSON.
 *
 * **Its own function because two grants read a selector**: a `strike-style`
 * names the weapons a class redefines its strike for, and an `on-hit` rider
 * names the ones it rides on — SRD Martial Arts and SRD Stunning Strike print
 * the same list in two sentences. One rule, or two spellings of it drifting.
 */
export function weaponSelectorProblems(
  selector: WeaponSelector,
  at: string,
): readonly FeatureDefinitionProblem[] {
  const found: FeatureDefinitionProblem[] = [];
  if (selector.category !== undefined && !WEAPON_CATEGORIES.includes(selector.category)) {
    found.push({
      field: `${at}.category`,
      code: 'unknown_weapon_category',
      reason: `the equipment tables print ${WEAPON_CATEGORIES.join(' and ')}, not "${String(selector.category)}"`,
    });
  }
  if (selector.kind !== undefined && !WEAPON_KINDS.includes(selector.kind)) {
    found.push({
      field: `${at}.kind`,
      code: 'unknown_weapon_kind',
      reason: `a weapon is ${WEAPON_KINDS.join(' or ')}, not "${String(selector.kind)}"`,
    });
  }
  for (const property of selector.properties ?? []) {
    if (!WEAPON_PROPERTIES.includes(property)) {
      found.push({
        field: `${at}.properties`,
        code: 'unknown_weapon_property',
        reason: `"${String(property)}" is not one of the ${WEAPON_PROPERTIES.length} properties the SRD prints, so this selector would match no weapon at all`,
      });
    }
  }
  return found;
}

/**
 * Rule 1's other half, which is about a population rather than a definition.
 *
 * Two features may not share an id anywhere in the engine, not merely within
 * one class: `featureChoices` is one flat record keyed by feature id, and a
 * multiclassed character holds features from two classes at once.
 */
export function duplicateFeatureIds(
  features: readonly FeatureDefinition[],
): readonly string[] {
  const seen = new Set<string>();
  const shared = new Set<string>();
  for (const feature of features) {
    if (seen.has(feature.id)) shared.add(feature.id);
    seen.add(feature.id);
  }
  return [...shared].sort();
}

/**
 * Enough of the shape that the semantic rules can read it without throwing.
 *
 * Not a second copy of the type: the compiler owns the shape for anything
 * written in this repository, and this exists for the input that was not. So
 * it checks the fields the rules above **dereference**, and stops — an unknown
 * extra field is not an error, because a definition written against a later
 * engine is data this one does not understand rather than data that is wrong.
 *
 * The dereferences are the whole of the list: rule 4 reads `grants.kind`, rule
 * 5 walks `grants.fixed`, and rule 6 measures the three arrays a `PoolSizing`
 * may carry. Each is a place where an untyped blob turns a refusal into a
 * `TypeError`, and **rules-legal refusals are values, not exceptions.**
 */
function checkFeatureShape(value: unknown): FeatureDefinitionProblem | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { field: '', code: 'not_a_feature', reason: 'a feature definition is an object' };
  }
  const record = value as Record<string, unknown>;

  if (record['executedBy'] !== undefined && typeof record['executedBy'] !== 'string') {
    return { field: 'executedBy', code: 'bad_feature_shape', reason: 'executedBy names a feature id' };
  }
  // Rule 8 walks the table's keys and its values; a string here would walk as
  // an array of characters and report options nobody wrote.
  const table = record['optionMeans'];
  if (table !== undefined && (typeof table !== 'object' || table === null || Array.isArray(table))) {
    return {
      field: 'optionMeans',
      code: 'bad_feature_shape',
      reason: 'a table of what each option means is an object keyed by the option',
    };
  }
  for (const field of ['id', 'name', 'automation', 'note'] as const) {
    if (typeof record[field] !== 'string') {
      return {
        field,
        code: 'bad_feature_shape',
        reason: `every feature definition carries a string ${field}`,
      };
    }
  }
  if (typeof record['level'] !== 'number') {
    return {
      field: 'level',
      code: 'bad_feature_shape',
      reason: 'every feature definition carries a level',
    };
  }

  // One grant or a list of them — see {@link featureGrants}. A list is checked
  // arm by arm and the path says which; the shape rules below are asked of the
  // first, because the first thing wrong with a definition is what this
  // function returns.
  const declared = record['grants'];
  if (declared === undefined) return null;
  if (Array.isArray(declared) && declared.length === 0) {
    return {
      field: 'grants',
      code: 'bad_feature_shape',
      reason: 'a list of grants that names none is a feature granting nothing; leave the field out',
    };
  }
  for (const [index, one] of (Array.isArray(declared) ? declared : [declared]).entries()) {
    const at = Array.isArray(declared) ? `grants[${index}]` : 'grants';
    if (typeof one !== 'object' || one === null || Array.isArray(one)) {
      return { field: at, code: 'bad_feature_shape', reason: 'a grant is an object' };
    }
    if (typeof (one as Record<string, unknown>)['kind'] !== 'string') {
      return {
        field: `${at}.kind`,
        code: 'bad_feature_shape',
        reason: 'a grant says which kind it is, as a string',
      };
    }
  }
  const grant = (Array.isArray(declared) ? declared[0] : declared) as Record<string, unknown>;

  // Rule 8's reading end names a feature, exactly as `executedBy` does.
  if (grant['choiceFrom'] !== undefined && typeof grant['choiceFrom'] !== 'string') {
    return {
      field: 'grants.choiceFrom',
      code: 'bad_feature_shape',
      reason: 'choiceFrom names the feature whose choice this grant reads',
    };
  }

  if (grant['fixed'] !== undefined) {
    if (!Array.isArray(grant['fixed']) || grant['fixed'].some((id) => typeof id !== 'string')) {
      return {
        field: 'grants.fixed',
        code: 'bad_feature_shape',
        reason: 'a fixed spell grant is a list of spell ids',
      };
    }
  }

  // `declares` is where a reaction grant keeps its sizing, so its arrays are
  // read exactly as the grant's own are.
  const declares = grant['declares'];
  if (declares !== undefined && (typeof declares !== 'object' || declares === null)) {
    return {
      field: 'grants.declares',
      code: 'bad_feature_shape',
      reason: 'a declared pool is an object',
    };
  }
  for (const [at, holder] of [
    ['grants', grant],
    ['grants.declares', declares as Record<string, unknown> | undefined],
  ] as const) {
    if (holder === undefined) continue;
    const column = holder['usesByLevel'];
    if (column === undefined) continue;
    if (!Array.isArray(column) || column.some((uses) => typeof uses !== 'number')) {
      return {
        field: `${at}.usesByLevel`,
        code: 'bad_feature_shape',
        reason: 'a column of a class table is a list of numbers',
      };
    }
  }

  return null;
}

/**
 * A definition, or the first thing wrong with it.
 *
 * Takes `unknown` deliberately, for the reason `parseSpellDefinition` does:
 * the point of a validator is that a definition need not have come through the
 * compiler. The shape is checked first and the semantics second, so a caller
 * handing over a JSON blob gets the same answers as one handing over a
 * compiled constant — and, in particular, gets an answer at all rather than an
 * exception.
 */
export function parseFeatureDefinition(
  value: unknown,
  context: FeatureContext,
): Result<FeatureDefinition> {
  const shape = checkFeatureShape(value);
  if (shape !== null) {
    return err(shape.code, shape.field === '' ? shape.reason : `${shape.field}: ${shape.reason}`);
  }

  const problems = checkFeatureDefinition(value as FeatureDefinition, context);
  if (problems.length > 0) {
    const first = problems[0]!;
    return err(first.code, `${first.field}: ${first.reason}`);
  }
  return ok(value as FeatureDefinition);
}

// `spell-schema.ts` carries a third entry point — every problem at once, over
// untyped input — and this deliberately does not. It would have no user, and a
// member with no user is a guess dressed up as a structure: add it with the
// authoring path that wants it, not ahead of one.

/**
 * Comments removed, so a kind named only in prose is not mistaken for a reader.
 *
 * This file's whole population is heavily documented — `progression.ts` names
 * every grant kind in prose several times over — so a search that counted a
 * docstring would report that everything is read and check nothing.
 */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

/**
 * The `FeatureGrant` members the engine's readers actually discriminate on.
 *
 * Derived from the readers rather than listed, because rule 4 is about a claim
 * nobody checked and a hand-kept list is another one. A kind is readable when
 * it appears as a string literal in reader *code*.
 *
 * **The probe is coarser than the reader**, deliberately and in the way
 * `spell-schema.test.ts`'s member sweep already is: it matches the literal
 * anywhere in code rather than only in a `kind ===` position, because
 * `choicesGranting(choices, features, 'expertise')` passes the kind as a typed
 * *argument* and a position-aware probe would call Expertise unread. What that
 * coarseness costs is a kind whose name the readers use for something else —
 * there is none today, and the union's members are hyphenated phrases
 * (`unarmored-defense`, `widens-reaction`) rather than ordinary words.
 */
export function readableGrantKinds(
  declared: Iterable<string>,
  readerSources: readonly string[],
): ReadonlySet<string> {
  const code = readerSources.map(stripComments).join('\n');
  const readable = new Set<string>();
  for (const kind of declared) {
    if (code.includes(`'${kind}'`) || code.includes(`"${kind}"`)) readable.add(kind);
  }
  return readable;
}

/**
 * The optional `FeatureDefinition` fields the readers dereference.
 *
 * The boundary matters: `.grants` must not be matched by `.grantsFeat`, which
 * is a different field read by a different rule. A loose boundary would make
 * every `grantsFeat` reader look like a `grants` reader and the derivation
 * would answer "yes" to everything.
 */
export function readableFeatureFields(
  declared: Iterable<string>,
  readerSources: readonly string[],
): ReadonlySet<string> {
  const code = readerSources.map(stripComments).join('\n');
  const readable = new Set<string>();
  for (const field of declared) {
    if (new RegExp(`\\.${field}(?![A-Za-z0-9_$])`).test(code)) readable.add(field);
  }
  return readable;
}

/**
 * The kinds the `FeatureGrant` union declares, read out of its own source.
 *
 * **The union's arms and not the unions nested inside them.** `recovery`
 * carries `restores: { kind: 'pool' } | { kind: 'pact-slots' }`, and
 * `pact-slots` is not a `FeatureGrant` member — reading it as one would report
 * a member nobody could ever write, which is the one thing a guard must not
 * do. Prettier writes a top-level arm at two spaces and a nested one deeper,
 * so the arms are what the split reads.
 */
export function declaredGrantKinds(progressionSource: string): ReadonlySet<string> {
  const start = progressionSource.indexOf('export type FeatureGrant =');
  if (start === -1) return new Set();
  const rest = progressionSource.slice(start + 'export type FeatureGrant ='.length);
  const end = rest.search(/^export /m);
  const union = end === -1 ? rest : rest.slice(0, end);

  const kinds = new Set<string>();
  for (const arm of union.split(/^ {2}\| /m).slice(1)) {
    const match = /readonly kind: '([a-z0-9-]+)'/.exec(stripComments(arm));
    if (match?.[1] !== undefined) kinds.add(match[1]);
  }
  return kinds;
}

/**
 * The optional fields `FeatureDefinition` declares, read out of its own source.
 *
 * The candidates rule 4's second half asks about: a feature is executed
 * through one of these or through nothing on the feature at all.
 *
 * **The interface's own fields, not the ones inside them.** `grantsFeat` is
 * declared as an inline object carrying its own optional `spellList`, on the
 * same line — so indentation cannot separate the two and the probe anchors to
 * the start of a line instead. Reading `spellList` as a field of a feature
 * would report a field no reader reads that no definition declares either,
 * which is the same false positive the nested-union case has.
 */
export function declaredOptionalFields(progressionSource: string): ReadonlySet<string> {
  const start = progressionSource.indexOf('export interface FeatureDefinition {');
  if (start === -1) return new Set();
  const rest = progressionSource.slice(start);
  const end = rest.search(/^}/m);
  const body = stripComments(end === -1 ? rest : rest.slice(0, end));

  const fields = new Set<string>();
  for (const match of body.matchAll(/^ {2}readonly ([A-Za-z0-9_$]+)\?:/gm)) {
    if (match[1] !== undefined) fields.add(match[1]);
  }
  return fields;
}

/**
 * Rule 7: the members no class writes.
 *
 * **Names, never a count.** A count needs maintaining by whoever next changes
 * the format and passes for the wrong reason the moment two changes cancel.
 * A member that turns out to have zero users is *reported* here and never
 * removed — removing one belongs to `progression.ts`'s owner.
 */
export function unwrittenGrantKinds(
  declared: Iterable<string>,
  written: ReadonlySet<string>,
): readonly string[] {
  return [...declared].filter((kind) => !written.has(kind)).sort();
}
