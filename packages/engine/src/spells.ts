import { err, ok, type Result } from '@ie/shared';

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
 * Why a Concentration ended. Every one of these is in the SRD except
 * `dispelled`, which stands in for the effects that end a spell by name.
 */
export type ConcentrationEndReason =
  | 'voluntary'
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
