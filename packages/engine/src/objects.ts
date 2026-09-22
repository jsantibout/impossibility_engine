import type { ConditionName, DamageType } from '@ie/shared';
import type { CreatureSize } from '@ie/srd/schemas';
import type { DamageDefenses } from './attack.js';
import type { CharacterSheet } from './character.js';

/**
 * A thing you can attack and break.
 *
 * ## An object is a stated sheet, exactly as a monster is
 *
 * The other design was to widen what an attack may be aimed at, and it is a
 * phase rather than a track: an attack's target is a `CharacterId` and every
 * reader past it — the Armour Class, the defences, the conditions, the vitals,
 * the hold a pending attack files, the riders a hit hangs — is keyed on a
 * creature. Threading a second kind of target through all of that buys nothing
 * the sheet does not already give, because `creature-added` already carries
 * every field an object needs: a sheet to read an Armour Class off, a hit
 * point maximum, `diesAtZero` for a door that is destroyed rather than dying,
 * a creature type, a table of damage defences, and a list of conditions it
 * cannot be given. So a door arrives the way a goblin does and **the attack
 * path needs no change at all** — which is the measurement this file rests on,
 * not a hope.
 *
 * What an object is *not* is a monster. `adaptMonster` reads a parsed stat
 * block, and an object has no stat block: it has no ability scores at all
 * (SRD: "an object lacks ability scores unless a rule assigns scores to the
 * object"), no speed, no challenge rating and no actions. Putting it through
 * the adapter would mean inventing every one of those, and the first invented
 * number — a Dexterity of 10 — is one a door would then *succeed* a saving
 * throw with. So the adapter is not the right home and this is a file of its
 * own.
 *
 * ## The rule is the engine's; the suggested numbers are content's
 *
 * The SRD prints two tables and calls both suggestions — "The Object Armor
 * Class table **suggests** ACs for various substances", "The Object Hit Points
 * table **suggests** Hit Points". A suggestion keyed by a name is a catalogue,
 * so it is content ({@link ObjectMaterial}, {@link ObjectSize}) and a homebrew
 * world puts voidsteel through the same `createContent` door the SRD's wood
 * goes through.
 *
 * What is *not* a suggestion is the sentence beside them: "Objects have
 * Immunity to Poison and Psychic damage." That is a rule about every object
 * there will ever be, in the same class as "a monster dies the instant it
 * drops to 0 Hit Points", and it names no catalogue id — `poison` and
 * `charmed` are `@ie/shared` vocabulary, the same words a condition is applied
 * by. So the rule lives here and the table lives there, and the sweep in
 * `spell-schema.test.ts` has nothing to catch.
 */

/**
 * Which column of the SRD's Object Hit Points table this thing is in.
 *
 * The book prints two numbers per size and no way to derive which one applies:
 * a bottle and a lock are both Tiny, and one of them is fragile. So it is the
 * declaration's, exactly as the material is — the DM describing the thing is
 * the only one who knows.
 */
export type ObjectBuild = 'fragile' | 'resilient';

/**
 * One row of the SRD's Object Armour Class table.
 *
 * Content, because the table is a list of substances with numbers beside them
 * and a world may hold substances the SRD never printed.
 */
export interface ObjectMaterial {
  /** `wood`, `stone`, `iron`. Lower-case hyphenated, as every content id is. */
  readonly id: string;
  /** What the table calls it — `Wood`, `Iron, steel`. For narration. */
  readonly name: string;
  /** The Armour Class the table suggests. */
  readonly armorClass: number;
  /**
   * Defences this substance carries beyond every object's own.
   *
   * SRD: "Paper or cloth objects **might** have Vulnerability to Fire damage."
   * *Might* is a GM's word, so the SRD's own rows leave this empty and a
   * table that rules otherwise writes it into its own catalogue — which is
   * the whole reason the substances are content rather than a constant here.
   */
  readonly defenses?: Readonly<Record<string, DamageDefenses>>;
}

/**
 * One row of the SRD's Object Hit Points table.
 *
 * Content for the same reason, and keyed by size because that is what the
 * book keys it by. The SRD prints Tiny through Large and stops: "To track Hit
 * Points for a Huge or Gargantuan object, divide it into Large or smaller
 * sections". Dividing is the GM's, so the absence of a row is a refusal rather
 * than a gap to fill in with arithmetic nobody printed.
 */
export interface ObjectSize {
  /** The size itself, which is also the row's id: `tiny`, `small`, `medium`, `large`. */
  readonly id: CreatureSize;
  /** Hit points for a fragile object of this size — a bottle, a lute. */
  readonly fragile: number;
  /** Hit points for a resilient one — a lock, a chest. */
  readonly resilient: number;
  /** What the table lists beside the size: `bottle`, `lock`. For narration. */
  readonly examples?: readonly string[];
}

/**
 * What a creature record says this thing **is**.
 *
 * The same field a stat block's `Fey` or `Undead` reaches, because a rule
 * reads it: a spell that chooses a Humanoid must not choose a door, and the
 * only thing standing between the two is this word. Not a catalogue id — it
 * is the noun the glossary uses for the whole category.
 */
export const OBJECT_CREATURE_TYPE = 'Object';

/**
 * SRD "Damage Types and Objects": "Objects have Immunity to Poison and Psychic
 * damage."
 *
 * Unconditional and printed, so it is applied rather than reported — the
 * reading `adaptMonster` already takes of a stat block's unqualified entries.
 */
export const OBJECT_DAMAGE_IMMUNITIES: readonly DamageType[] = ['poison', 'psychic'];

/**
 * Conditions no object can be given.
 *
 * **The SRD prints no such list**, and this is the engine reading one sentence
 * — "an object is a nonliving, distinct thing" — rather than transcribing a
 * table, so it is named here where it can be argued with instead of being
 * scattered through the refusals.
 *
 * Four, and each one is a condition whose own text asks something of the
 * target that an object has not got: Charmed and Frightened need something to
 * feel it, Poisoned needs something to poison, and Prone is a posture a door
 * does not have. Exhaustion is the obvious fifth and is deliberately not here:
 * nothing in the SRD applies Exhaustion to anything that is not a creature, so
 * the immunity would be inert, and a list that grows by what *seems* right is
 * the list this comment exists to stop.
 */
export const OBJECT_CONDITION_IMMUNITIES: readonly ConditionName[] = [
  'charmed',
  'frightened',
  'poisoned',
  'prone',
];

/**
 * The defence table an object arrives with: its substance's, over every
 * object's own.
 *
 * The rule wins where the two meet, because the rule is printed flat and a
 * substance's entry is a GM's ruling about a type the rule has already
 * settled. Nothing in the SRD collides here; the order is stated so that a
 * homebrew catalogue cannot make an object take Poison damage by accident.
 */
export function objectDefenses(
  material: ObjectMaterial,
): Readonly<Record<string, DamageDefenses>> {
  const defenses: Record<string, DamageDefenses> = { ...(material.defenses ?? {}) };
  for (const type of OBJECT_DAMAGE_IMMUNITIES) defenses[type] = { immune: true };
  return defenses;
}

/**
 * The sheet a declared object is written onto.
 *
 * **Every ability score is 0**, and that is the honest transcription rather
 * than a placeholder: SRD says an object has no ability scores, and the
 * nearest thing the sheet can say is the lowest score there is. What it does
 * *not* yet say is the other half of that sentence — "without ability scores,
 * an object can't make ability checks, and it fails all saving throws" — which
 * is a rule in the D20 pipeline and not on this sheet. A door rolls a saving
 * throw at −5 today instead of failing it outright, and that gap is named
 * here rather than papered over.
 *
 * The Armour Class is **stated**, exactly as a monster's is: it is read off a
 * table rather than derived from armour and a Dexterity the thing has not got.
 * The speed is 0 because an object does not move, and the level is 1 for the
 * reason `adaptMonster` gives — it is inert, and it has to be something.
 */
export function objectSheet(
  armorClass: number,
  damageThreshold?: number,
): CharacterSheet {
  return {
    level: 1,
    abilities: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
    skills: {},
    saveProficiencies: [],
    armor: null,
    shield: null,
    armorTraining: { light: false, medium: false, heavy: false, shields: false },
    baseSpeed: 0,
    spellcastingAbility: null,
    stated: {
      armorClass,
      ...(damageThreshold === undefined ? {} : { damageThreshold }),
    },
  };
}
