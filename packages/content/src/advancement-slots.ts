import { SRD_CONTENT } from './index.js';

/**
 * The Ability Score Improvement slots a class table has printed by a level,
 * after the first — for the fixtures that have to answer them.
 *
 * Not catalogue data and not a rule: a helper four test files needed the same
 * day, when the twelve classes stopped holding one Improvement each and
 * started holding as many as the SRD's tables print. Every fixture that
 * builds a character at level 8 or above now owes a feat per repeat, and a
 * fixture that misses one is a `missing_feat_choice` rather than a silence.
 *
 * It lives here rather than four times over because it was four times over
 * for one review cycle and that is exactly the duplication a shared module is
 * for. It is deliberately **not** exported from `index.ts`: nothing outside
 * this package's own tests has any use for it, and the catalogue's public
 * surface is the catalogue.
 *
 * Read off the catalogue, which is safe for an *answer* and would not be for
 * an assertion — `advancement-repeats.test.ts` writes the levels out of
 * `packages/srd/raw/classes.md` by hand and holds the catalogue to them, so
 * a wrong table fails there rather than being quietly agreed with here.
 */
export const repeatImprovements = (
  classId: string,
  level: number,
): Readonly<Record<string, { readonly featId: string; readonly abilities: readonly string[] }>> =>
  Object.fromEntries(
    (SRD_CONTENT.classById(classId)?.features ?? [])
      .filter(
        (one) => one.id.startsWith(`${classId}:ability-score-improvement-`) && one.level <= level,
      )
      // SRD's own Ability Score Improvement, because it is the only feat that
      // may be taken more than once and a repeat is a whole second grant. Its
      // points go into Charisma and Intelligence, which no fixture using this
      // helper reads — the scores under test are named in the test itself.
      .map((one) => [one.id, { featId: 'ability-score-improvement', abilities: ['cha', 'int'] }]),
  );
