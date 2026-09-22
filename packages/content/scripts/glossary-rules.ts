/**
 * The rules glossary's own general rules, and which of them anything executes.
 *
 * **The fourth population, and gate G1 found it had no home at all.** Spells
 * have `BLOCKED_ON` and `ADJUDICATED`, features have `FEATURE_BLOCKED_ON`,
 * items have `ITEM_BLOCKED_ON` — and the rules everybody at the table uses
 * whatever they are playing had nothing: not a map, not a row, not a guard.
 * The consequence is a debt nobody can see. A level 1 Rogue with a Scimitar
 * reaches the `nick` mastery property, and `nick` occurs in **no engine
 * source file**; the Search, Study, Influence and Utilize actions are named
 * in `combat.ts` as the book's and left to the table; Two-Weapon Fighting's
 * Light-property swing is a second attack the economy cannot tell from the
 * first. None of that was on any list.
 *
 * ### Why this one is hand-listed and the others are not
 *
 * The three maps select their populations from the catalogue: a spell is a
 * record, a feature is a record, an item is a record. **A glossary rule is
 * not a record anywhere** — it is a heading in `packages/srd/raw/rules.md`,
 * and nothing parses it, so there is no derivation to run and a regex over
 * prose would be a classifier wearing a derivation's clothes. So it is a
 * list, and the list is held down at both ends by `glossary-rules.test.ts`:
 * a row claiming to be built must name something the engine really exports
 * or a `NAMED_ACTIONS` member, and a row claiming to be missing must be
 * **quoted as a value in no engine source file** — no switch arm, no union
 * member, no lookup. Neither half can be satisfied by writing a sentence.
 *
 * The guard asks for a quoted literal rather than for the word, and the
 * difference is the whole of what it is worth. Five of the seven unbuilt rows
 * are *named* in the engine's prose and say so in their own notes: `combat.ts`
 * lists Search, Study, Influence and Utilize as the book's and leaves them to
 * the table, three definitions quote the Study action before the check the
 * engine then rolls, and two comments in `mastery.ts` say Nick is unbuilt. A
 * word-level sweep would read every one of those as coverage.
 *
 * ### What is in it and what is not
 *
 * The **named actions** of the glossary's Actions table and the **eight
 * weapon mastery properties**, which are the two closed lists the book prints
 * in full, plus the general rules a level 1–5 character uses that neither
 * covers. Conditions are not here: the fifteen are `conditions.ts`'s and are
 * executed, measured and swept already. Nor are the D20 Test rules, which the
 * whole of `rolls.ts` is.
 */

/** Which of the glossary's lists a row comes from. */
export type GlossaryKind = 'action' | 'mastery' | 'rule';

export interface GlossaryRule {
  /** The glossary's own name, as an id: lower case, hyphenated. */
  readonly id: string;
  /** The name the book prints, which is what a reader looks it up by. */
  readonly name: string;
  readonly kind: GlossaryKind;
  /**
   * What executes it, or **null** where nothing does.
   *
   * A command exported from `@ie/engine`, or a {@link NAMED_ACTIONS} member —
   * the two things a caller can actually reach. Both are checked: a name that
   * is neither fails, so a row cannot claim to be built by naming a function
   * that was renamed or deleted.
   */
  readonly built: string | null;
  /** Why, in a sentence somebody has to write. */
  readonly note: string;
}

/**
 * Every general rule this population answers for, in the book's own order.
 *
 * A row joining or leaving it is somebody's reading and should have to say so
 * here, which is the discipline every other list in this package is under.
 */
export const GLOSSARY_RULES: readonly GlossaryRule[] = [
  // — the Actions table ——————————————————————————————————————————————————
  {
    id: 'attack',
    name: 'Attack',
    kind: 'action',
    built: 'resolveAttack',
    note: 'the action, its roll, its damage and the Extra Attack that buys a second swing out of one action.',
  },
  {
    id: 'dash',
    name: 'Dash',
    kind: 'action',
    built: 'takeDash',
    note: 'the extra movement is granted and the price is stateable, which is what `allows` in `STATABLE_PRICES` buys Cunning Action and Expeditious Retreat.',
  },
  {
    id: 'disengage',
    name: 'Disengage',
    kind: 'action',
    built: 'takeDisengage',
    note: 'the Opportunity Attack it prevents is the one reaction window the engine answers by itself.',
  },
  {
    id: 'dodge',
    name: 'Dodge',
    kind: 'action',
    built: 'takeDodge',
    note: 'Disadvantage on attacks against the dodger and Advantage on their Dexterity saves, both until their next turn.',
  },
  {
    id: 'help',
    name: 'Help',
    kind: 'action',
    built: null,
    note: 'the action is not a command. Its stabilisation half is reachable — `declarations.ts` names the Help action as what a stabilisation is the payout of — but the two things the book prints first, Advantage on an ally’s next ability check and Advantage on their next attack against a creature within 5 feet of you, have no door and no standing grant that says who gave them.',
  },
  {
    id: 'hide',
    name: 'Hide',
    kind: 'action',
    built: 'takeHide',
    note: 'the Stealth check, the Invisible condition it confers and the four things that end it, all owner-ruled on 2026-09-20 as an engine verb.',
  },
  {
    id: 'influence',
    name: 'Influence',
    kind: 'action',
    built: null,
    note: 'one of the four `combat.ts` names as the book’s and leaves to the table: a Charisma check against a DC the DM sets, with the attitude of the creature deciding which skill and whether it is possible at all. Nothing spends the action and nothing records the attitude.',
  },
  {
    id: 'magic',
    name: 'Magic',
    kind: 'action',
    built: 'magic',
    note: 'a `NAMED_ACTIONS` member rather than a command of its own, because what a Magic action buys is a casting, an activation or a spell’s own later step, and each of those is its own door.',
  },
  {
    id: 'opportunity-attack',
    name: 'Opportunity Attack',
    kind: 'action',
    built: 'takeOpportunityAttack',
    note: 'the reaction, its window, and the `forbids` rule four definitions take it away with.',
  },
  {
    id: 'ready',
    name: 'Ready',
    kind: 'action',
    built: 'takeReady',
    note: 'the trigger is declared, the reaction is held and the release is a second command — the one of the five `combat.ts` lists that turned out to exist.',
  },
  {
    id: 'search',
    name: 'Search',
    kind: 'action',
    built: null,
    note: 'a Wisdom check — Insight, Medicine, Perception or Survival — to find something. `combat.ts` names it as the book’s and `permits-only` can narrow a slot down to it, which is the one place the engine says the word; no command spends it and nothing reads what was found.',
  },
  {
    id: 'study',
    name: 'Study',
    kind: 'action',
    built: null,
    note: 'an Intelligence check to recall or work something out. Three definitions print it — Minor Illusion, Disguise Self and Hallucinatory Terrain all say a creature must take the Study action before the Investigation check the engine then rolls — so the check is executed and the action that buys it is not, which is the gap in the middle of a rule that otherwise runs.',
  },
  {
    id: 'utilize',
    name: 'Utilize',
    kind: 'action',
    built: null,
    note: 'the second object interaction of a turn. The **first** is built — `combat.ts` counts one free interaction per turn and `actions.ts` quotes the sentence — and the action that buys any after it is not, so the count is enforced and the way past it is missing.',
  },

  // — weapon mastery, the eight the 2024 rules print ————————————————————
  {
    id: 'cleave',
    name: 'Cleave',
    kind: 'mastery',
    built: 'resolveAttack',
    note: 'the second creature within 5 feet, once per turn, at no ability modifier.',
  },
  {
    id: 'graze',
    name: 'Graze',
    kind: 'mastery',
    built: 'resolveAttack',
    note: 'the ability modifier as damage on a miss, which is a floor under a miss rather than a second roll.',
  },
  {
    id: 'nick',
    name: 'Nick',
    kind: 'mastery',
    built: null,
    note: 'the mastery that makes the Light property’s extra attack part of the Attack action instead of a Bonus Action. **It is quoted as a value in no engine source file** — the word is written twice, in two comments of `mastery.ts` saying it is unbuilt, and nowhere a switch arm or a union member could read it — and a level 1 Rogue with a Scimitar reaches it — as does any level 1 character with a Dagger, a Light Hammer or a Sickle. It waits on the same thing Two-Weapon Fighting does: nothing records which hand an attack came from.',
  },
  {
    id: 'push',
    name: 'Push',
    kind: 'mastery',
    built: 'resolveAttackDamage',
    note: 'ten feet of forced movement straight back, which `forced` carries.',
  },
  {
    id: 'sap',
    name: 'Sap',
    kind: 'mastery',
    built: 'resolveAttackDamage',
    note: 'Disadvantage on the target’s next attack roll before the end of its next turn.',
  },
  {
    id: 'slow',
    name: 'Slow',
    kind: 'mastery',
    built: 'resolveAttackDamage',
    note: 'ten feet off the target’s Speed until the start of the attacker’s next turn.',
  },
  {
    id: 'topple',
    name: 'Topple',
    kind: 'mastery',
    built: 'resolveAttackDamage',
    note: 'a Constitution save against the attacker’s spell-less mastery DC, and Prone on a failure.',
  },
  {
    id: 'vex',
    name: 'Vex',
    kind: 'mastery',
    built: 'resolveAttackDamage',
    note: 'Advantage on the attacker’s next attack against the same target before the end of their next turn.',
  },

  // — the general rules neither list covers ——————————————————————————————
  {
    id: 'two-weapon-fighting',
    name: 'Two-Weapon Fighting',
    kind: 'rule',
    built: null,
    note: 'the extra attack a Light weapon in the other hand buys as a Bonus Action, with no ability modifier on the damage unless the Fighting Style feat is held. The Two-Weapon Fighting feat’s own note says it outright: the engine does not model which hand an attack came from, so neither half of this rule has anywhere to read the fact it turns on.',
  },
];
