import { err, ok, type Result } from '@ie/shared';
import type { Point } from './positioning.js';

/**
 * Casting: what a spell costs, who is concentrating on what, and which effects
 * belong to which casting.
 *
 * The load-bearing idea here is the **casting instance**. "Hold Person" is not
 * a thing that is running; *this* casting of Hold Person, by this caster, at
 * this level, is. Two Clerics can have Hold Person on the same goblin, and one
 * of them losing Concentration must end exactly one of the two paralyses.
 *
 * So every casting gets an id, and every effect it creates carries that id in
 * its source. Breaking a casting is then an exact match rather than a search
 * for a spell name — which would catch the other Cleric's spell as well.
 */

/**
 * The separator between a spell's name and the casting that produced it.
 *
 * A condition's source is free-form text, and keeping it readable matters —
 * the log should say "Hold Person", not an opaque id. Appending the casting id
 * keeps both properties: legible to a DM, exact to the engine.
 */
export const CASTING_MARK = '#';

const CASTING_ID = /^cast:\d+$/;

/** The source string an effect created by a casting carries. */
export function castingSource(spell: string, castingId: string): string {
  return `${spell}${CASTING_MARK}${castingId}`;
}

/** The casting an effect came from, or null if it did not come from one. */
export function castingIdOf(source: string): string | null {
  const at = source.lastIndexOf(CASTING_MARK);
  if (at < 0) return null;
  const candidate = source.slice(at + CASTING_MARK.length);
  return CASTING_ID.test(candidate) ? candidate : null;
}

/** The readable half of a source: the spell name, or the source unchanged. */
export function spellOfSource(source: string): string {
  return castingIdOf(source) === null ? source : source.slice(0, source.lastIndexOf(CASTING_MARK));
}

/**
 * A spell name has to be usable and must not forge a casting link.
 *
 * Validated before anything is spent, so a bad name costs no slot — the same
 * "validate before rolling" discipline the rest of the engine follows.
 */
export function validateSpellName(name: string): Result<string> {
  const trimmed = name.trim();
  if (trimmed === '') return err('bad_spell', 'a spell needs a name');
  if (trimmed.includes(CASTING_MARK)) {
    return err('bad_spell', `a spell name may not contain ${CASTING_MARK}`);
  }
  return ok(trimmed);
}

/**
 * SRD: "A level 1 spell fits into a slot of any size, but a level 2 spell fits
 * only into a slot that's at least level 2."
 */
export function slotFits(spellLevel: number, slotLevel: number): boolean {
  return slotLevel >= spellLevel;
}

/** SRD "Casting without Slots", plus the innate casting monsters do. */
export type SlotlessReason = 'cantrip' | 'ritual' | 'special-ability' | 'magic-item' | 'innate';

export type CastingTime = 'action' | 'bonus-action' | 'reaction' | 'long';

/** What a creature is currently concentrating on. */
export interface Concentration {
  readonly castingId: string;
  readonly spell: string;
  /** The level it was cast at — the slot's level when it was upcast. */
  readonly level: number;
}

/**
 * A casting that is still mechanically running.
 *
 * **This is not the casting; it is what the casting left behind.** The casting
 * is history and the event log has it — which slot went, which action, at what
 * moment. This is the live half: the handful of facts a *later* mechanic has
 * to be able to ask about, and which nothing else holds.
 *
 * The SRD decides every field, and Dispel Magic decides most of them: "Any
 * ongoing spell of level 3 or lower on the target ends. For each ongoing spell
 * of level 4 or higher on the target, make an ability check ... (DC 10 plus
 * that spell's level)." To obey that sentence an engine must be able to say,
 * of one creature, **which spells are on it and at what level** — and before
 * this record the level lived only in the log and on a concentrating caster.
 *
 * | Field | The mechanic that needs it |
 * |---|---|
 * | `castingId` | the handle everything already uses to link an effect to its cause |
 * | `level` | Dispel Magic's threshold and its DC |
 * | `caster` | "**you** can take a Magic action" — nobody else may act through it |
 * | `spellId` | finding the definition again, a minute later |
 * | `route` | the save DC and attack modifier a later activation rolls with |
 * | `on` | "on the target": which creatures this spell is currently affecting |
 * | `concentration` | whether losing Concentration is what ends it |
 * | `origin` | "within 5 feet of the force": where a spell that holds a point is |
 *
 * **No second identity.** One casting can affect several creatures — Hold
 * Person at level 3 holds two — and each is released independently, but each
 * is addressed as *(casting, creature)*, which the engine has always done.
 * The spells that create a *thing* with a position of its own do not need one
 * either: SRD addresses that thing only through the caster's own action on
 * this casting, so `origin` below is a field rather than an entity.
 *
 * **What is deliberately absent**: the slot, the casting time, the targets as
 * they were named, anything a narrator would like. Those are history, the log
 * has them, and duplicating them here would make two answers to one question.
 */
export interface OngoingSpell {
  /** The casting that created it — the same id every effect already carries. */
  readonly castingId: string;
  readonly caster: string;
  /** The SRD slug, so a later activation finds the same definition. */
  readonly spellId: string;
  /** The display name, so a log needs no lookup. */
  readonly spell: string;
  /**
   * The level it was cast at, which is the slot's level when upcast.
   *
   * The reason this record exists at all: Dispel Magic reads it, and nothing
   * live held it for a spell whose caster is not concentrating.
   */
  readonly level: number;
  readonly concentration: boolean;
  /** Which grant supplied it, so a later activation rolls the same numbers. */
  readonly route: string | null;
  /**
   * The creatures this spell is currently on, sorted.
   *
   * SRD Dispel Magic ends "any ongoing spell ... **on the target**", so this
   * is the question it asks. It shrinks: a creature that shakes the spell off
   * — Hold Person's repeat save, an escape check — leaves this list while the
   * casting carries on for everyone else.
   *
   * **Range decides it, not the target list.** A Range: Self spell is on its
   * caster however many creatures its effects reach: Vampiric Touch attacks
   * somebody else every turn and is on the wizard. Everything else is on whom
   * it was cast.
   *
   * Empty is a real state and not an error — Minor Illusion is on nobody,
   * which is exactly why Dispel Magic calls that case "a magical effect"
   * rather than a creature.
   */
  readonly on: readonly string[];
  /**
   * Where this casting is, for a spell that holds a point in the scene.
   *
   * SRD Spiritual Weapon: "The force appears within range **in a space of your
   * choice**", and every later sentence measures from it — "one creature
   * within 5 feet of the force", "move the force up to 20 feet". Nothing else
   * in the engine could answer where the force is: a creature's position is in
   * the scene, and the force is not a creature.
   *
   * **It is a point, and the SRD is why it is only a point.** Read Spiritual
   * Weapon against the two spells that look like it and print more:
   *
   * | | Spiritual Weapon | Unseen Servant / Arcane Hand |
   * |---|---|---|
   * | Armour Class, Hit Points | none printed | "AC 10, 1 Hit Point"; "AC 20 and Hit Points equal to your Hit Point maximum" |
   * | Can be attacked | nothing addresses it | dropping to 0 Hit Points ends the spell |
   * | Occupies its space | nothing says so | Arcane Hand says explicitly that it does *not*, because it otherwise would |
   * | Acts | the caster spends a Bonus Action | the caster commands it, and it has a Strength score |
   *
   * So a creature record here would be inventing an Armour Class the book
   * declines to print. The second column is the **summons** seam and waits
   * there.
   *
   * Absent means this casting holds no point — which is most of them. Not
   * null: "nobody has said where it is" is not a state a spell with an origin
   * can be in, because the space is chosen at the cast or the cast is refused.
   */
  readonly origin?: Point;
}

/**
 * Why an ongoing spell stopped, when somebody *decided* it.
 *
 * Deliberately short. Concentration breaking and a deadline passing are
 * derived — nobody decides either — so they end the record through the same
 * reducer pass that already ends the conditions, with no event of their own.
 * That is the audit trade `CLAUDE.md` records for expiry, unchanged.
 */
export type OngoingEndReason =
  /** SRD Dispel Magic, and anything else that ends a spell by naming it. */
  | 'dispelled'
  /** SRD Mage Hand: "The hand vanishes ... if you cast this spell again." */
  | 'recast';

/**
 * Why a Concentration ended. Every one of these is in the SRD except
 * `dispelled`, which stands in for the effects that end a spell by name.
 */
export type ConcentrationEndReason =
  | 'voluntary'
  /**
   * SRD Ready: a held spell's magic let go on purpose, at its trigger.
   *
   * Distinct from `voluntary`, which is a caster dropping a spell that was
   * doing something. This one is a spell that had not started yet: the
   * Concentration existed only to hold it, and releasing it is the spell
   * finally happening rather than the caster giving up on it.
   */
  | 'released'
  | 'another-concentration-effect'
  | 'failed-save'
  | 'incapacitated'
  | 'died'
  | 'removed'
  | 'dispelled';

/** What a damaged concentrator has to roll, and against what. */
export interface ConcentrationCheck {
  readonly castingId: string;
  readonly spell: string;
  readonly ability: 'con';
  readonly dc: number;
  /** The damage the DC came from, for the audit trail. */
  readonly damage: number;
}
