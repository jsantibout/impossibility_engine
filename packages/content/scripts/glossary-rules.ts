/**
 * The rules glossary's own general rules, and which of them anything executes.
 *
 * **The fourth population, and gate G1 found it had no home at all.** Spells
 * have `BLOCKED_ON` and `ADJUDICATED`, features have `FEATURE_BLOCKED_ON`,
 * items have `ITEM_BLOCKED_ON` — and the rules everybody at the table uses
 * whatever they are playing had nothing: not a map, not a row, not a guard.
 * The consequence is a debt nobody can see. A level 1 Rogue with a Scimitar
 * reaches the `nick` mastery property, and `nick` occurs in **no engine
 * source file**; the Search, Study, Influence and Utilize actions were named
 * in `combat.ts` as the book's and left to the table; Two-Weapon Fighting's
 * Light-property swing is a second attack the economy cannot tell from the
 * first. None of that was on any list. The four actions and Help have left
 * the list since, each with its own spender.
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
 * difference is the whole of what it is worth. Both remaining unbuilt rows
 * are *named* in the engine's prose and say so in their own notes: two
 * comments in `mastery.ts` say Nick is unbuilt, and the hand an attack came
 * from is written about in several places without being recorded anywhere. A
 * word-level sweep would read either of those as coverage. It was five rows
 * of seven when the list was written, and the four glossary actions that made
 * up the difference left it by building their spenders rather than by
 * rewording their notes, which is the only way out this list offers.
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
    built: 'takeHelp',
    note: 'both halves the book prints first, as the one-shot grant SRD Guiding Bolt and SRD Vicious Mockery already use: Advantage on the ally’s next ability check with the chosen skill, or on their next attack roll against an enemy within 5 feet of the helper, hung on the ally under the helper’s own source and ended by whichever arrives first — the roll that spends it or the start of the helper’s next turn. The helper’s proficiency is checked and the five feet are measured where anybody has been placed. Its stabilisation half was already reachable through `declarations.ts`. One check roller still does not spend a one-shot — `takeHide` — so a Help offered on Stealth reaches a Hide without being used up by it, and `oneShotProblem` says so.',
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
    built: 'takeInfluence',
    note: 'the action is spent and the Charisma check is rolled — Deception, Intimidation, Performance or Persuasion, refused where the skill is none of those — against a DC the DM sets, which is why the door is the DM’s rather than the player’s. The attitude is still nobody’s but the DM’s and comes back flagged: the book hands them Indifferent, Friendly and Hostile, a Hostile monster’s answer is no whatever the die said, and the engine decides none of it.',
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
    built: 'takeSearch',
    note: 'the action is spent and the Wisdom check is rolled — Insight, Medicine, Perception or Survival, refused where the skill is none of those — against a DC the DM sets. What was *found* is still the table’s and cannot be otherwise: the engine holds no hidden door and no bloodstain, so it owns the number exactly as `resolveTest` owns a DM’s check and the discovery is narrated from it.',
  },
  {
    id: 'study',
    name: 'Study',
    kind: 'action',
    built: 'takeStudy',
    note: 'the action is spent and the Intelligence check is rolled — Arcana, History, Investigation, Nature or Religion — against a DC the DM sets. It closes a gap in the middle of a rule that otherwise ran: **six** definitions print the sentence "a creature must take the Study action" in front of the Investigation check `resolveEffectCheck` then rolls — Disguise Self, Minor Illusion, Silent Image, Hallucinatory Terrain, Major Image and Seeming — so the check was executed and the action that buys it was not.',
  },
  {
    id: 'utilize',
    name: 'Utilize',
    kind: 'action',
    built: 'takeUtilize',
    note: 'the second object interaction of a turn, and the first thing a turn spends an Action on that leaves nothing behind. The **first** interaction was already built — `combat.ts` counts one free per turn — so the count was enforced and the way past it was missing. What the object does is still the table’s: the book’s own examples are a lever, a lock and a bowstring, none of which the engine holds. What it buys the engine is the spend SRD Fast Hands needed to exist: `STATABLE_PRICES` prices a Utilize out of a Bonus Action, and `thief:fast-hands` states it.'
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
    built: 'resolveAttack',
    note: 'the mastery that makes the Light property’s extra attack part of the Attack action instead of a Bonus Action, which is the second price `lightAttack` takes. It is refused to a weapon that does not print the property and to a character who has not unlocked it, and it is the same one extra attack either way — one ledger key, so a Nick cannot be followed by a Bonus Action swing. It was the mastery quoted as a value in no engine source file while a level 1 Rogue with a Scimitar reached it, which is the finding this population was opened for.',
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
    id: 'burning',
    name: 'Burning',
    kind: 'rule',
    built: 'extinguishFire',
    note: 'the hazard, not a sixteenth condition: a mark on the creature beside its conditions, so a stat block’s condition Immunities reach it not at all. The 1d4 Fire is collected at the start of each of its turns by the same boundary that settles a payout, so a creature with Immunity to Fire burns and takes nothing. The action that puts it out spends an Action and gives the creature the Prone condition, which is the method the sentence prints rather than a price the fire charges — a creature that cannot be given Prone still puts the fire out. SRD Fire Elemental’s Burn and SRD Magmin’s Touch light it; the object half of both sentences and the book’s “doused, submerged, or suffocated” are the table’s, because nothing here holds flammability or water.',
  },
  {
    id: 'two-weapon-fighting',
    name: 'Two-Weapon Fighting',
    kind: 'rule',
    built: 'resolveAttack',
    note: 'the extra attack a second Light weapon buys as a Bonus Action, with no ability modifier on the damage unless the Fighting Style feat is held — and the feat is executed too, as a standing grant that puts the modifier back. **The fact it turns on was never a hand**: the book asks which Light weapon this turn’s Attack action already swung, which is a fact about the turn, and `TurnBudget.lightWeaponSwung` records it. "A different Light weapon" is a different *copy*, so two daggers are two weapons and one dagger is not; a negative modifier is added whatever, which is the clause `withoutAbilityModifier` has always kept for Cleave.'
  },
];
