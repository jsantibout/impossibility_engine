/**
 * The form a creature is wearing, and what reads it.
 *
 * SRD Shape-Shift, printed on thirteen stat blocks: "The werewolf shape-shifts
 * into a Large wolf-humanoid hybrid or a Medium wolf, or it returns to its
 * true humanoid form. Its game statistics, **other than its size**, are the
 * same in each form."
 *
 * So a form is not a second stat block — that is Wild Shape, and
 * `assumeStatBlock` is where it lives. A form is three facts and no more: the
 * **word** the block's own headings gate on, the **size** the line prints for
 * it, and the **Speeds** the two fiendish blocks print per form. Everything
 * else the sentence promises is honoured by the engine doing nothing, which is
 * why the equipment rule needs no code: nothing was going to transform an
 * inventory.
 *
 * **A creature that has never shifted is in its true form**, which is the last
 * form the line prints and not an absence. Reading it as "no form" would let a
 * werewolf that had not moved bite with jaws it only has as a wolf, so
 * {@link formWornBy} answers with the printed default rather than with null.
 *
 * Kept apart from `monster.ts` because the readers here take a `CreatureState`
 * and that file takes a stat block; kept apart from `size.ts` because a form
 * is a size only sometimes.
 */
import type { MonsterForm, MonsterForms } from '@ie/srd';
import type { CharacterSheet, StatedAction, StatedBonusAction } from './character.js';
import type { CreatureState } from './state.js';

/**
 * The line this sheet prints its forms on, or null where it prints none.
 *
 * Both sections are searched and Actions first, exactly as the printed-line
 * doors search them: the book puts Shape-Shift under Actions on the Imp and
 * the Quasit and under Bonus Actions on the other eleven, and a heading says
 * what a use *costs* rather than what it is.
 */
export function formLineOf(sheet: CharacterSheet): StatedAction | StatedBonusAction | null {
  const action = sheet.stated?.unreadActions?.find((line) => line.forms !== undefined);
  if (action !== undefined) return action;
  return sheet.stated?.bonusActions?.find((line) => line.forms !== undefined) ?? null;
}

/** The forms this sheet's own line offers, or null where it offers none. */
export function printedFormsOf(sheet: CharacterSheet): MonsterForms | null {
  return formLineOf(sheet)?.forms ?? null;
}

/**
 * The form a printed line offers under this name, or null where it offers
 * none by that name.
 *
 * Case-insensitive, for the reason every other lookup by a printed name is:
 * the caller typed it.
 */
export function formNamed(forms: MonsterForms, name: string): MonsterForm | null {
  const wanted = name.trim().toLowerCase();
  return forms.forms.find((form) => form.name === wanted) ?? null;
}

/**
 * The name of the form this creature is in, or null where its block offers
 * none at all.
 *
 * **The printed default rather than null**, which is the whole reason this is
 * a function: a creature that has not shifted is in the form the line returns
 * to, and every printing of the sentence puts that one last.
 */
export function formWornBy(creature: CreatureState): string | null {
  if (creature.form !== null) return creature.form.name;
  const printed = printedFormsOf(creature.sheet);
  if (printed === null) return null;
  return printed.forms[printed.forms.length - 1]!.name;
}

/**
 * Why this creature may not use a line its heading gates on a form, or null
 * where it may.
 *
 * A line that names no form is never refused, and neither is one on a creature
 * whose block prints no forms: the gate is the *block's* own vocabulary, so a
 * homebrew line naming a form nothing offers is a line nobody can take, and
 * saying so is more use than silently allowing it.
 */
export function wrongFormFor(
  creature: CreatureState,
  line: { readonly name: string; readonly onlyInForms?: readonly string[] },
): string | null {
  const gate = line.onlyInForms;
  if (gate === undefined || gate.length === 0) return null;
  const worn = formWornBy(creature);
  if (worn !== null && gate.includes(worn)) return null;
  return (
    `${line.name} is printed for ${gate.join(' or ')} form only, and ` +
    (worn === null
      ? 'this creature takes no form its block prints'
      : `${creature.id} is in ${worn} form`)
  );
}
