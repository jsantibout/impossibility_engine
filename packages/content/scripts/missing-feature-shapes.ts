/**
 * The missing-shape vocabulary, and every manual class feature blocked on it —
 * derived.
 *
 * `missing-shapes.ts` for the third book. The spell side of this repository
 * was counted three times by hand and came out 17, 4 and 2; the item side was
 * never counted at all until it was read entry by entry. The **feature** side
 * has been honest all along and unreadable: every feature the engine does not
 * execute carries an `automation: 'manual'` note saying what is missing — "the
 * attack layer reads a weapon or the fixed Unarmed Strike, and has no notion
 * of a class changing either", "falling is not modelled", "a roll selector
 * names a family, an ability and a skill and has no condition axis" — and
 * nothing read them. They are the best evidence in the repository about where
 * the engine's next mechanics should go, and they were scattered across twelve
 * class files and `origins.ts` in whatever words fitted.
 *
 * This is that evidence as data over one vocabulary, so *what would unlock the
 * most features* is a query — {@link featureConsumersOf} — rather than
 * somebody's impression of twelve files.
 *
 * ### One vocabulary, three books
 *
 * A feature entry may name a {@link FEATURE_SHAPES} id, and it may name any id
 * in {@link MISSING_SHAPES} or {@link ITEM_SHAPES}, because the gap is often
 * *the same gap* arriving at a different door. SRD Slow Fall is blocked on
 * `falling` exactly as Feather Fall is; a Dragon Companion is blocked on the
 * same missing summons Arcane Hand is; four species traits want the save keyed
 * to a condition that Protection from Poison wants. Giving any of those a
 * second id because the sentence this time is printed on a class table would
 * be the "second spelling of a derivation" failure `missing-shapes.ts` keeps a
 * record of. So what lives in {@link FEATURE_SHAPES} is only what is true of a
 * **feature** and false of a casting and of an item: a class rewriting an
 * attack, a pool the Proficiency Bonus sizes, a grant gated on one option of a
 * choice, a feature restating another feature's rule.
 *
 * ### The unit is the note, not the SRD paragraph
 *
 * The item map anchors a clause in the entry the **book** prints, because the
 * question there is whether anybody has read the paragraph. Here the
 * population is already read: a manual feature is one somebody transcribed,
 * ran against the grant vocabulary, and wrote a sentence about. So a clause is
 * anchored in the feature's own `note` — {@link unanchoredFeatureClauses}
 * holds it to occurring exactly once there — which makes the map fail loudly
 * the day somebody rewords a note without re-deriving what it says. That is
 * also why there is no *read* and *unread* split: every entry below carries a
 * clause, and {@link featureCoverageGaps} refuses a manual feature that has no
 * line at all.
 *
 * ### Blocks and finishes, and why both
 *
 * **Blocks** is every manual feature a shape touches. **Finishes** is the
 * features it is the *only* blocker for — the ones building it would take off
 * this list. They are different numbers, and reporting only the first is how
 * one spell family came to be ranked three ways in three documents. A feature
 * whose every clause is the table's blocks nothing and is kept rather than
 * omitted, because "there is nothing here for the engine to do" is a
 * conclusion somebody reached.
 *
 * Not a test file, for `missing-shapes.ts`'s own reason: `npm run coverage`
 * runs outside vitest, and a report generator that imported the test suite
 * would have the dependency backwards.
 */

import { SRD_CONTENT } from '@ie/content';
import type { FeatureDefinition } from '@ie/engine';
import {
  ITEM_SHAPES,
  MISSING_SHAPES,
  flatten,
  unanchoredWithin,
  type ItemShapeId,
  type ShapeId,
  type UnanchoredClause,
} from './missing-shapes.js';

/**
 * The mechanical shapes that stand between an SRD class feature and an
 * executed one.
 *
 * Every id names a gap this repository has already described — in a design
 * note, in the engine's own vocabulary file, or in the validator that refuses
 * the grant by name — and the description says **which**, because a shape
 * invented here would be an architecture decision smuggled in as a note. A
 * test holds that in both directions: a description naming no source fails, a
 * quotation the named document does not contain fails, and a shape nothing
 * claims is removed.
 */
export const FEATURE_SHAPES = {
  'a-weapon-mastery-property':
    'Cleave, Graze, Nick, Push, Sap, Slow, Topple and Vex are parsed onto the weapons that print them and executed by nothing, and no feature records **which** weapons a character has mastery with. Five classes print the feature and a sixth swaps one property for another. `FeatureGrant` in packages/engine/src/progression.ts is the list of what a feature may do — "Deliberately few. A feature whose effect does not fit one of these is `automation: \'manual\'` with a note saying what a DM still has to do" — and a mastery is not on it, at either end: neither the choice of weapons nor the property\'s own rule.',
  'a-saving-throw-a-feature-forces':
    'a feature that makes **somebody else** roll. A casting forces a save through its definition and an item through a `save` conferral; packages/engine/src/content.ts enumerates what an item\'s readers run — "only a standing grant, a charge pool, a spell it casts and the effects it confers are read from one" — and a class feature reaches none of those, so a Breath Weapon, a Stunning Strike and a Channel Divinity that Frightens have a printed DC and nothing to roll it against.',
  'a-condition-a-feature-imposes':
    'a condition a feature puts **on** a creature. The condition layer is whole and a feature may only refuse one: `StandingGrant` in packages/engine/src/standing.ts carries `condition-immunity`, which is "Suppression, not prevention and not removal", and carries no member that applies a condition at all. So a Monk who Stuns, a Ranger who turns Invisible and a Rogue who Dazes have the condition they want and no route to it.',
  'a-condition-a-feature-ends':
    'a condition a feature takes **off**. One grant removes conditions and it is welded to a healing pool — `lifts-conditions` in packages/engine/src/progression.ts is Restoring Touch, and the file says what it is: "It widens a feature it does not own, which is the shape Improved Critical already has — a second feature restating the first rather than a second mechanism." A feature that ends a condition on its own holder, with no pool and no touch, has nothing to restate.',
  'a-pool-the-proficiency-bonus-sizes':
    'a resource counted in Proficiency Bonuses. packages/engine/src/progression.ts names the sizings and the reason there are three — "The SRD sizes a pool three ways and each is here because a feature uses it" — a column of the class table, an ability modifier with a floor, and a multiple of the class level. "A number of times equal to your Proficiency Bonus" is a fourth, most of the origin traits with a limit print it, and no species has a class table for the first sizing to read.',
  'a-pool-refilled-to-a-floor':
    'a recovery that tops a pool up to a number rather than giving back a share of it. `Recovery`\'s `upTo` in packages/engine/src/progression.ts is half the class level, half the maximum, or all, and the SRD prints a fourth shape twice — "until you have two", "until you have 4 if you have 3 or fewer" — where what is regained depends on what is left rather than on the pool\'s size.',
  'a-resource-traded-for-another':
    'one resource spent to buy another. Every pool the engine has is spent on what its own feature does; nothing converts. The SRD writes the trade constantly — a spell slot for a Bardic Inspiration, a Wild Shape use for a level 1 slot and back, a Rage use to restore a Channel Divinity, Sneak Attack dice forgone to buy an effect — and `FeatureGrant` in packages/engine/src/progression.ts has no member whose cost is another feature\'s resource.',
  'a-casting-paid-for-out-of-a-feature-pool':
    'a spell a feature lets you cast without a slot. The route exists for an **item** and is refused to a feature by name: packages/engine/src/progression.ts says of the `casts` grant "An item-only member. Nothing executes it from a class feature and `checkContent` refuses it there", because the charges it spends are an item\'s pool looked up by the granting item\'s id. Every SRD sentence of the shape "cast it without expending a spell slot" wants exactly that grant with a feature\'s pool behind it.',
  'a-benefit-that-runs-for-a-printed-span':
    'a feature switched on for a minute or ten, rather than to a turn boundary it has to keep extending. `ActivatedFeature` in packages/engine/src/standing.ts is SRD Rage down to the field — "a Bonus Action, a pool sized by the class table, a deadline that can be pushed, a cap it cannot be pushed past, and two ways out that nobody commands" — and a Rage that is not extended ends at the boundary. A feature the book simply gives a duration has no deadline of its own to file.',
  'a-bonus-an-ability-modifier-sizes':
    'a number added to a roll that is read off the holder\'s own sheet. Exactly one grant does it and only for one family: `save-bonus` in packages/engine/src/standing.ts is Aura of Protection, "the *holder\'s* modifier, read off their sheet rather than the beneficiary\'s". `flat-bonus` beside it is "Flat, and only flat", so a Charisma bonus to attack rolls and a Wisdom bonus to two named checks have no shape.',
  'a-feature-that-carries-a-second-grant':
    'one feature that must do two mechanical things at once. `FeatureDefinition.grants` is a single `FeatureGrant`, and `docs/design/characters-and-equipment.md` already names a victim — "Disciplined Survivor\'s reroll needs a feature to carry two grants". A species trait that grants a Speed to one lineage and a sense to another, and a class feature that is both a prepared spell and a pool of free castings, are the same absence.',
  'a-grant-gated-on-one-option-of-a-choice':
    'a grant that applies only when the player picked a particular option. `onlyIfChoice` in packages/engine/src/progression.ts is that gate and it lives on the `standing` grant alone, written for the three features SRD prints "You gain one of the following options of your choice" on — "only one of the options is this grant. A feature whose chosen option is the other one grants nothing" — so an option whose benefit is a pool, a Reaction, a proficiency or a spell has nowhere to hang.',
  'a-feature-that-rewrites-another-features-rule':
    'a later feature that changes an earlier one. The engine allows exactly four restatements and each arrived with its sentence — a `critical-range` threshold restated, a `lifts-conditions` list lengthened, `widens-reaction` which packages/engine/src/progression.ts calls "A second feature restating the first rather than a second mechanism", and `executedBy` for a step in another feature\'s table. A feature that changes another one\'s **duration**, its **recovery**, or what its uses buy is a fifth and has no member.',
  'an-option-re-chosen-on-a-rest':
    'a choice the book lets you take again after a rest. `docs/design/characters-and-equipment.md` names it and its first consumer — "**A grant that can be re-chosen on a rest.** Circle of the Land\'s spells" — and files every rule about swapping a prepared spell on a rest beside it. A `FeatureChoice` is answered once, at creation, and frozen into the sheet.',
  'an-attack-the-class-redefines':
    'a class that changes what an attack **is**. The Monk\'s own note says it: the attack layer reads a weapon or the fixed Unarmed Strike and has no notion of a class changing either, so a growing unarmed die, a Dexterity-based fist, a Flurry of Blows and a chosen damage type all sit outside it. `docs/design/characters-and-equipment.md` files the neighbouring half of the same gap — "**Extra attacks inside the Attack action.** The economy counts one Attack action, not the attacks in it".',
  'an-attack-roll-selected-by-the-ability-it-uses':
    'an attack-roll modifier narrowed to the ability the swing was made with. `RollSelector` in packages/engine/src/roll-modifiers.ts allows an ability on a check and a save and refuses one on an attack, and says why: they "are filters and both narrow rather than widen: absent means the whole family". SRD Reckless Attack buys Advantage "on attack rolls using Strength" and would otherwise buy it on every attack the Barbarian makes.',
  'a-move-a-feature-hands-its-holder':
    'a move a feature gives away, outside the turn\'s allowance and outside anybody\'s command. `docs/design/space-and-areas.md` records the neighbouring half — "forced movement passes `forced: true`" — and that is a move somebody makes to somebody else. Half your Speed as part of a Bonus Action, a Withdraw that provokes nothing, a Step of the Wind that carries an ally: each is movement no grant kind can offer.',
  'a-speed-a-feature-reduces':
    'a Speed taken **away** from another creature. packages/engine/src/standing.ts draws the line on the member that adds one — "Speed *reductions* are not this member\'s business" — and files what does reduce a Speed under the condition layer, where nothing but Exhaustion writes one. A Hamstring Blow that takes fifteen feet off a target until your next turn has the arithmetic and no writer.',
  'a-modifier-a-feature-puts-on-another-creature':
    'a mode or a number a feature hangs on **somebody else**, raised by something that happened. A standing grant is derived from its holder\'s own state on every read, and `against-holder` in packages/engine/src/roll-modifiers.ts is the furthest one reaches — "Attack rolls against the affected creature have Advantage" — which is still a fact about the holder. A Disadvantage that starts when a creature hits you and lasts the rest of their turn, and a bonus the next attacker against your target gets, are durable grants on a third party no feature can write.',
  'a-roll-mode-a-feature-takes-away':
    'a mode **cancelled** rather than granted. packages/engine/src/roll-modifiers.ts builds the axis as presence — "The mode is not part of the identity" — and `combineRollModes` weighs Advantage against Disadvantage — and SRD Elusive says something else again: no attack roll may **have** Advantage against you at all, which is neither a grant of Disadvantage nor a cancellation the vocabulary can express.',
  'a-turn-boundary-payout-a-feature-owes':
    'a feature that pays out at the start or the end of a turn. The queue is real and it is a casting\'s: `docs/design/time-and-turns.md` says "Raising is derived; rolling is commanded ... `turn-advanced` *raises* the saves the boundary owes", and every debt it raises belongs to an ongoing spell. A Champion who regenerates at the start of each of their turns and a Monk who sheds a condition at the end of theirs have nothing in that queue.',
  'temporary-hit-points-a-feature-grants':
    'Temporary Hit Points from a feature. The state is real — `Vitals.temporaryHp`, which a spell writes and a rest clears — and the only healing a feature reaches is `HealGrant` in packages/engine/src/progression.ts, "Hit points a feature gives its holder, as the class text writes the sum", which restores Hit Points rather than laying temporary ones over them. A class feature, a subclass feature and a species trait each print the sentence and none of them can say it.',
  'heroic-inspiration':
    'Heroic Inspiration, which the engine holds nothing for at all: no field, no event and no command. It is not even a pool: packages/engine/src/progression.ts describes that member as "A named resource the feature *is*, rather than one it spends", and this is a resource no feature **is** — it arrives from a rest or from a fight and is spent on any D20 Test. A class feature grants it during combat and a species trait grants it on a Long Rest, so what both record is the permission and nothing that could ever be spent.',
  'a-rule-the-engine-fixes-for-everybody':
    'a constant the engine applies to every creature, which one feature is meant to bend. A Long Rest is eight hours, an attunement limit is a number inside a command, moving through an occupied space wants two sizes of difference, and carrying capacity is summed nowhere. `docs/design/characters-and-equipment.md` keeps the list of what the attunement rules still owe — "what ends attunement besides a command — death, losing the item, another creature attuning to it" — and every one of these is that same shape: a rule the engine holds rather than the sheet, so a trait bending it for its holder alone has nothing to bend.',
  'a-spell-list-that-is-not-your-class-list':
    'a spell known or prepared from **another class\'s** list. `checkContent` refuses a fixed grant naming nothing and creation checks every chosen spell against the list of the class that is choosing it, which is right for eleven classes and wrong for the two features the SRD writes the exception on. `docs/design/content.md` states what a class list is for — "`spellEntry(id)` — the spell\'s identity and class lists (the SRD index shape)" — and there is no second list a feature may widen it to.',
  'a-spell-a-source-that-does-not-cast-grants':
    'a spell granted by something with no spellcasting of its own. The engine gathers a `spells` grant from the features of a class that casts, so a species trait offering a cantrip, a lineage with two levelled spells and a background\'s free daily casting all reach no route. `docs/design/content.md` draws the boundary the grant sits on — "A definition with no entry still exists and can be cast; it is on nobody\'s class list until an entry says whose" — and what is missing here is the other end: a caster with no class to hang the casting on.',
  'a-concentration-rule-that-names-its-casting':
    'a rule about Concentration that is true of **one** spell. The Concentration save reads the damage that threatened it and knows nothing about which casting is at risk, which is the same absence `docs/design/rolls-and-damage.md` records for a saving throw — "nothing records what a save was against". A Ranger who keeps Concentration on Hunter\'s Mark and on nothing else cannot be told apart from one who keeps it on everything.',
  'a-feature-that-changes-what-a-casting-costs':
    'a feature that changes the price of a casting the character makes — its components, its action, its slot, or how many of the caster\'s own tricks ride on it. A casting pins what it read at the casting, which `docs/design/content.md` states as the rule the whole fold depends on: "A command pins what it read into its events (a casting\'s area and numbers, an equip event\'s armour record), so a stored log folds the same under any catalogue." Nothing stands between the caster\'s sheet and that pinning.',
  'a-feature-that-changes-a-castings-damage':
    'a feature that changes the dice a spell rolls. The same pinning: the notation, the die and the type are the definition\'s and are fixed when the casting is written. So a modifier added to one Evocation\'s damage, a d6 that becomes a d10, a cantrip that deals half on a miss and a maximised Necrotic backlash are all a caster\'s feature reaching into arithmetic `docs/design/content.md` keeps deliberately out of its reach.',
  'a-feature-that-changes-who-a-casting-catches':
    'a feature that changes a spell\'s targets or its area\'s catch. `docs/design/space-and-areas.md` keeps the one filter an area has narrow on purpose — "Designating creatures unaffected is a choice, and never allegiance ... it is **explicit**, because a cleric may spare an enemy and may decline to spare an ally" — and that choice belongs to the casting rather than to a feature of the caster. Doubling a spell\'s targets, sparing creatures from your own Evocation and spreading a rider to a second creature all want the same missing reader.',
  'a-declared-fact-a-feature-sets':
    'a feature that **writes** one of the facts the table declares. `docs/design/space-and-areas.md` keeps the geometry declared rather than derived — "Cover and line of sight stay declared, not ray-cast ... that is where a rules engine becomes a VTT" — which is a rule about who may say so, and today the answer is a DM and nobody else. A feature that gives its allies Half Cover has the fact, the scope and no writer.',
  'a-reaction-effect-the-vocabulary-lacks':
    '`ReactionGrantEffect` in packages/engine/src/progression.ts has four members and the SRD writes more. `docs/design/characters-and-equipment.md` names the fifth and the rule a new member has to meet — "A fifth `ReactionEffect` member | the union\'s own rule is that a member exists because **at least two** features write it" — so a Reaction that grants its taker a Resistance, and one that deals damage back to whoever struck, each wait on a member and on a second writer for it.',
  'an-effect-that-waits-for-a-later-trigger':
    'an effect filed now that fires on something that may never happen. `docs/design/time-and-turns.md` gives the deadline vocabulary two types — "A span of time" and "A moment in the turn order" — and a trigger is neither, so vibrations that kill a creature days later when their maker wills it have nowhere to be recorded between the touch and the death.',
} as const;

/** The feature vocabulary's own ids. */
export type FeatureShapeId = keyof typeof FEATURE_SHAPES;

/** Every shape a feature entry may name: all three vocabularies. */
export type FeatureBlockerId = ShapeId | ItemShapeId | FeatureShapeId;

/**
 * One clause of a manual feature's own note, and what stands in its way.
 *
 * `ItemClause`'s shape over the third corpus, with the same three values:
 *
 * | | |
 * |---|---|
 * | `'table'` | fiction, or judgement the engine should never take from a DM |
 * | `'expressible'` | the engine can already say it; this clause blocks nothing |
 * | a shape id | mechanical, and this names the shape that blocks it |
 *
 * `'expressible'` is not decoration, and it is **wider than "the feature
 * carries a grant"** on purpose. Some of the features below are `manual` and
 * carry one — a Barbarian's Rage immunity, a Dwarf's Poison Resistance, a
 * Champion's Advantage on Death Saving Throws — because the engine does half
 * of what the book prints. Others carry none and have a half the vocabulary
 * could write today and nobody has: Reckless Attack's Advantage for the
 * attacker, Steady Aim's Speed of 0, the mark Precise Hunter reads. Both are
 * the same claim — *this sentence is not what is standing in the way* — and
 * recording both is what keeps a shape's *finishes* column counting what is
 * genuinely left rather than what somebody has not got round to.
 */
export interface FeatureClause {
  /**
   * A distinctive phrase from this feature's own `note`.
   *
   * Held to occurring **exactly once** in that note, for `BlockedClause`'s
   * reason on the other book: a reworded note has to be read again rather than
   * keeping an adjudication written about the old one.
   */
  readonly clause: string;
  readonly why: 'table' | 'expressible' | FeatureBlockerId;
  readonly note: string;
}

/** What an entry of {@link FEATURE_BLOCKED_ON} is. */
export type FeatureEntry = readonly FeatureClause[];

/**
 * What stands between every **manual** class, species and background feature
 * and an executed one.
 *
 * `BLOCKED_ON` for the third book, and the population is read off the
 * catalogue rather than listed: a feature is here exactly when it declares
 * `automation: 'manual'`, which is the predicate `COVERAGE.md`'s *executed*
 * column already counts with. {@link featureCoverageGaps} refuses a manual
 * feature with no line and a line for a feature that has since been executed,
 * so the map cannot drift from the corpus in either direction.
 *
 * Every entry carries at least one clause and every clause is a phrase from
 * that feature's own note. There is no grandfathered form here and no *read*
 * against *unread* column, because the notes are a hundred and sixty short
 * paragraphs this repository wrote about itself rather than two hundred SRD
 * entries nobody has opened.
 */
export const FEATURE_BLOCKED_ON: Readonly<Record<string, FeatureEntry>> = {
  // — Barbarian —
  'barbarian:weapon-mastery': [
    {
      clause: 'Mastery properties are parsed onto weapons but not executed',
      why: 'a-weapon-mastery-property',
      note: 'the properties and the record of which weapons the Barbarian chose, which are the two halves of one shape.',
    },
  ],
  'barbarian:reckless-attack': [
    {
      clause: 'a `RollSelector` allows an ability only on an ability check and a saving throw',
      why: 'an-attack-roll-selected-by-the-ability-it-uses',
      note: 'the whole of what is left: the stance itself is an activated feature with no cost and a start-of-next-turn deadline.',
    },
    {
      clause: 'is `against-holder` and is expressible today',
      why: 'expressible',
      note: 'the half a standing roll-mode already says, and the reason this feature is one shape away rather than two.',
    },
  ],
  'barbarian:instinctive-pounce': [
    {
      clause: 'no feature hands its holder a move that costs nothing out of the turn’s allowance',
      why: 'a-move-a-feature-hands-its-holder',
      note: 'the whole of it, now that Rage is an activated feature a requirement can read.',
    },
  ],
  'barbarian:brutal-strike': [
    {
      clause: 'it needs Reckless Attack before anything else',
      why: 'an-attack-roll-selected-by-the-ability-it-uses',
      note: 'inherited: the feature it is written on top of cannot be built, so this one cannot be either.',
    },
    {
      clause: 'Forgoing a mode you were granted is a price no feature can pay',
      why: 'a-resource-traded-for-another',
      note: 'a mode spent as currency, which is the trade shape arriving on something that is not a pool.',
    },
    {
      clause: 'Forceful Blow pushes the target fifteen feet',
      why: 'forced-movement-a-spell-causes',
      note: 'the same `moveCreature` with `forced: true` that no spell effect reaches either.',
    },
    {
      clause: 'moves the Barbarian half their Speed toward it',
      why: 'a-move-a-feature-hands-its-holder',
      note: 'the second half of Forceful Blow, and a different absence from the push.',
    },
    {
      clause: 'Hamstring Blow reduces a Speed',
      why: 'a-speed-a-feature-reduces',
      note: 'the member the Speed grant deliberately does not have.',
    },
  ],
  'barbarian:relentless-rage': [
    {
      clause: 'the vitals layer has no hook between damage and unconsciousness',
      why: 'an-effect-that-intercepts-dropping-to-0',
      note: 'the spell map’s Death Ward gap, arriving on a class feature.',
    },
  ],
  'barbarian:improved-brutal-strike': [
    {
      clause: 'lengthening another feature’s list is itself a restatement the engine has no member for',
      why: 'a-feature-that-rewrites-another-features-rule',
      note: 'the fifth restatement, beside a critical threshold, a lifted-condition list, a widened Reaction and a stepped table.',
    },
    {
      clause: 'Disadvantage on its next saving throw',
      why: 'a-one-shot-roll-modifier',
      note: 'a mode consumed by the roll it changes, which the spell map already names for Guiding Bolt.',
    },
    {
      clause: 'stops its Opportunity Attacks until the start of your next turn',
      why: 'an-action-a-spell-compels-or-forbids',
      note: 'an action forbidden to somebody else, which is the action economy answering to a feature.',
    },
    {
      clause: 'the next attack roll another creature makes against the target a bonus of five',
      why: 'a-modifier-a-feature-puts-on-another-creature',
      note: 'a number hung on a third party by something that happened.',
    },
  ],
  'barbarian:persistent-rage': [
    {
      clause: 'it is a recovery grant with a pool of one behind it',
      why: 'expressible',
      note: 'the half that is applied: the Rages come back at the first turn of a fight, once per Long Rest.',
    },
    {
      clause: 'a feature rewriting another feature’s activation',
      why: 'a-feature-that-rewrites-another-features-rule',
      note: 'the ten-minute Rage and the ending on Unconscious, both of which are the level 1 feature’s own fields.',
    },
  ],
  'barbarian:improved-brutal-strike-2': [
    {
      clause: 'both of which are this feature rewriting the level 9 one',
      why: 'a-feature-that-rewrites-another-features-rule',
      note: 'the whole feature, and the one case where `executedBy` would have fitted had the earlier feature declared anything.',
    },
  ],
  'barbarian:indomitable-might': [
    {
      clause: 'the check machinery substitutes nothing',
      why: 'a-roll-result-an-effect-replaces',
      note: 'the D20 Test half of the substitution the damage dice already have.',
    },
  ],
  'berserker:frenzy': [
    {
      clause: 'a standing effect may require a named feature to be active',
      why: 'expressible',
      note: 'recorded because the note used to claim otherwise: Mindless Rage reads the Barbarian’s Rage through exactly this.',
    },
    {
      clause: 'no selector can narrow an attack roll to the ability it was made with',
      why: 'an-attack-roll-selected-by-the-ability-it-uses',
      note: 'inherited from Reckless Attack, which this feature is written in terms of.',
    },
  ],
  'berserker:mindless-rage': [
    {
      clause: 'as suppression while the Rage runs',
      why: 'expressible',
      note: 'the Immunity, applied as a standing grant conditioned on the Rage being active.',
    },
    {
      clause: 'removes the condition outright',
      why: 'a-condition-a-feature-ends',
      note: 'the second sentence, which needs a feature to take a condition off rather than switch it off.',
    },
  ],
  'berserker:intimidating-presence': [
    {
      clause: 'an aura that follows a creature is an area nothing keeps running',
      why: 'an-area-an-item-creates',
      note: 'the item vocabulary’s own id for a Cone or an Emanation with no casting behind it; a Bonus Action that throws one is the same gap.',
    },
  ],

  // — Bard —
  'bard:jack-of-all-trades': [
    {
      clause: 'Half the Proficiency Bonus on a check using no skill proficiency',
      why: 'a-bonus-narrowed-to-a-skill',
      note: 'the spell map’s own id: a bonus that reaches some checks and not others, selected by which skill they use.',
    },
    {
      clause: '2024 excludes Initiative from it',
      why: 'table',
      note: 'a rules reading rather than a gap, written down so the 2014 answer does not creep back.',
    },
  ],
  'bard:font-of-inspiration': [
    {
      clause: 'Regaining Bardic Inspiration on a Short Rest',
      why: 'a-feature-that-rewrites-another-features-rule',
      note: 'a later feature changing an earlier pool’s recovery, which is fixed when the sheet is built.',
    },
    {
      clause: 'spending a slot to regain a use',
      why: 'a-resource-traded-for-another',
      note: 'a spell slot bought into a pool, with no action and no limit.',
    },
  ],
  'bard:countercharm': [
    {
      clause: 'a spell rolls its targets’ saves inside one atomic resolution',
      why: 'a-feature-that-changes-what-a-casting-costs',
      note: 'a casting resolves in one breath, so there is no save held open for a Reaction to answer.',
    },
    {
      clause: 'nothing records **what a save was against**',
      why: 'a-mode-on-the-save-a-spell-forces',
      note: 'the spell map’s own id, and the whole of the Charmed-or-Frightened clause.',
    },
    {
      clause: 'The `test-rolled` window and the reroll both exist',
      why: 'expressible',
      note: 'recorded so the ranking does not count the Reaction machinery as missing: Indomitable uses both.',
    },
  ],
  'bard:magical-secrets': [
    {
      clause: 'a known spell is checked against one class list',
      why: 'a-spell-list-that-is-not-your-class-list',
      note: 'the whole of it: no second list exists for a feature to widen a known spell against.',
    },
  ],
  'bard:superior-inspiration': [
    {
      clause: 'Regaining Bardic Inspiration uses on Initiative is not modelled',
      why: 'a-pool-refilled-to-a-floor',
      note: 'the moment is built — a recovery may fire at Initiative — and "until you have two" is the sizing that is not.',
    },
  ],
  'bard:words-of-creation': [
    {
      clause: 'Power Word Heal and Power Word Kill always prepared',
      why: 'a-spell-an-item-casts-that-nothing-executes',
      note: 'the item map’s own id: a fixed spell grant is refused a spell the catalogue does not define, and neither of these is defined.',
    },
    {
      clause: 'their doubled targets',
      why: 'a-feature-that-changes-who-a-casting-catches',
      note: 'a feature widening a casting’s target rule after the definition pinned it.',
    },
  ],
  'college-of-lore:magical-discoveries': [
    {
      clause: 'Two spells from the Cleric, Druid or Wizard lists',
      why: 'a-spell-list-that-is-not-your-class-list',
      note: 'Magical Secrets’ blocker on a second feature, which is what makes it a shape.',
    },
  ],

  // — Cleric —
  'cleric:divine-order': [
    {
      clause: 'Protector grants Martial weapon proficiency and Heavy armor training',
      why: 'a-language-or-a-proficiency-an-item-grants',
      note: 'the item vocabulary’s own id for training a grant confers; a class feature reaches the same missing reader.',
    },
    {
      clause: 'Thaumaturge grants an extra cantrip',
      why: 'a-grant-gated-on-one-option-of-a-choice',
      note: 'a spells grant is expressible and gating it on the option chosen is not: only a standing grant carries `onlyIfChoice`.',
    },
    {
      clause: 'a Wisdom-modifier bonus to Arcana and Religion checks',
      why: 'a-bonus-an-ability-modifier-sizes',
      note: 'a number read off the holder’s own sheet, which only a save bonus does.',
    },
  ],
  'cleric:sear-undead': [
    {
      clause: 'Turn Undead itself is a Channel Divinity option the engine does not execute',
      why: 'a-saving-throw-a-feature-forces',
      note: 'Turn Undead makes every Undead nearby roll, which is the shape underneath this one.',
    },
    {
      clause: 'Turn Undead dealing Radiant damage',
      why: 'a-feature-that-rewrites-another-features-rule',
      note: 'a later feature adding an effect to an earlier one’s use.',
    },
  ],
  'cleric:divine-intervention': [
    {
      clause: 'Casting any Cleric spell without components',
      why: 'a-feature-that-changes-what-a-casting-costs',
      note: 'the components and the slot are the casting’s, pinned when it is written.',
    },
    {
      clause: 'the once-per-long-rest limit is not tracked',
      why: 'a-casting-paid-for-out-of-a-feature-pool',
      note: 'a pool of one behind a free casting, which only an item’s `casts` grant has.',
    },
  ],
  'cleric:greater-divine-intervention': [
    {
      clause: 'The Wish effect is not modelled',
      why: 'a-spell-an-item-casts-that-nothing-executes',
      note: 'the catalogue defines no Wish, so the feature waits on a spell rather than on a feature mechanic.',
    },
  ],
  'life-domain:disciple-of-life': [
    {
      clause: 'healing effects do not yet read the caster’s features',
      why: 'healing-modified-by-an-effect',
      note: 'the spell map’s own id: nothing stands beside `healCreature` to add to what it restores.',
    },
  ],
  'life-domain:preserve-life': [
    {
      clause: 'Dividing five times your Cleric level in hit points among Bloodied creatures',
      why: 'a-resource-traded-for-another',
      note: 'a Channel Divinity use spent to mint a pool of hit points, which no grant converts.',
    },
    {
      clause: 'capped at half their maximum',
      why: 'healing-modified-by-an-effect',
      note: 'a cap on healing that is not the target’s maximum, which is the only cap `healCreature` knows.',
    },
  ],
  'life-domain:blessed-healer': [
    {
      clause: 'The caster healing themselves when they heal somebody else',
      why: 'healing-modified-by-an-effect',
      note: 'healing that fires because other healing happened.',
    },
  ],
  'life-domain:supreme-healing': [
    {
      clause: 'Maximising healing dice rather than rolling them',
      why: 'healing-modified-by-an-effect',
      note: 'the maximising half of the same missing reader.',
    },
  ],

  // — Druid —
  'druid:druidic': [
    {
      clause: 'recorded as a proficiency and read by nobody',
      why: 'table',
      note: 'a language and the messages it hides are narration; there is no rule here for the engine to own.',
    },
  ],
  'druid:primal-order': [
    {
      clause: 'Warden grants Martial weapon proficiency and Medium armour training',
      why: 'a-language-or-a-proficiency-an-item-grants',
      note: 'Divine Order’s blocker on a second class, which is what makes it a shape.',
    },
    {
      clause: 'Magician grants a cantrip',
      why: 'a-grant-gated-on-one-option-of-a-choice',
      note: 'as Thaumaturge: the spells grant exists and the gate does not.',
    },
    {
      clause: 'a Wisdom bonus to Arcana and Nature checks',
      why: 'a-bonus-an-ability-modifier-sizes',
      note: 'the same ability-sized bonus Thaumaturge wants.',
    },
  ],
  'druid:wild-companion': [
    {
      clause: 'summons are a shape the engine does not have',
      why: 'a-stat-block-created-mid-fight',
      note: 'the spell map’s own id, which Unseen Servant and Arcane Hand wait on.',
    },
    {
      clause: 'Spending a Wild Shape use to cast Find Familiar',
      why: 'a-casting-paid-for-out-of-a-feature-pool',
      note: 'and the catalogue defines no Find Familiar either, so the casting would have nothing to run.',
    },
  ],
  'druid:wild-resurgence': [
    {
      clause: 'Trading a Wild Shape use for a level 1 slot, and the reverse',
      why: 'a-resource-traded-for-another',
      note: 'the trade in both directions, and the note already says what makes it dangerous to fake.',
    },
  ],
  'druid:beast-spells': [
    {
      clause: 'Casting while Wild Shaped is not modelled, because Wild Shape is not',
      why: 'a-creature-fact-an-effect-overrides',
      note: 'Wild Shape writes over what the engine holds authoritatively about a creature, which is the spell map’s own id for Arcanist’s Magic Aura.',
    },
  ],
  'druid:archdruid': [
    {
      clause: 'Unlimited Wild Shape',
      why: 'a-feature-that-rewrites-another-features-rule',
      note: 'a capstone changing an earlier feature’s pool, on top of Wild Shape not being built.',
    },
    {
      clause: 'the slot recovery',
      why: 'a-resource-traded-for-another',
      note: 'Wild Shape uses converted into a slot of a level the table never printed.',
    },
    {
      clause: 'the extended lifespan',
      why: 'table',
      note: 'ageing, which no rule here reads.',
    },
  ],
  'circle-of-the-land:spells': [
    {
      clause: 'It needs a grant that can be re-chosen on a rest',
      why: 'an-option-re-chosen-on-a-rest',
      note: 'the design note names this feature by name as the shape’s first consumer.',
    },
  ],

  // — Fighter —
  'fighter:fighting-style': [
    {
      clause: 'every one is a modifier the caller passes to a roll',
      why: 'table',
      note: 'a Fighting Style feat that does nothing is that feat’s debt; recording and validating the choice is all this feature claims.',
    },
  ],
  'fighter:weapon-mastery': [
    {
      clause: 'are parsed onto weapons but not executed',
      why: 'a-weapon-mastery-property',
      note: 'the same shape the other four classes want, with the properties spelled out.',
    },
  ],
  'fighter:tactical-shift': [
    {
      clause: 'The free half-Speed move on a Second Wind',
      why: 'a-move-a-feature-hands-its-holder',
      note: 'Instinctive Pounce’s shape on a second class.',
    },
  ],
  'fighter:tactical-master': [
    {
      clause: 'because mastery properties are not executed',
      why: 'a-weapon-mastery-property',
      note: 'inherited whole: swapping a property for another is nothing until the properties run.',
    },
  ],
  'fighter:studied-attacks': [
    {
      clause: 'Advantage on the next attack after a miss is not tracked between attacks',
      why: 'a-one-shot-roll-modifier',
      note: 'the spell map’s own id: a mode consumed by the roll it changes.',
    },
  ],
  'champion:additional-fighting-style': [
    {
      clause: 'A second Fighting Style feat is recorded like the first',
      why: 'table',
      note: 'the feat’s debt, exactly as the Fighter’s own is.',
    },
  ],
  'champion:heroic-warrior': [
    {
      clause: 'Heroic Inspiration itself is not modelled',
      why: 'heroic-inspiration',
      note: 'nothing holds it, so the feature that grants it has nothing to grant.',
    },
  ],
  'champion:survivor': [
    {
      clause: 'so the Advantage is real',
      why: 'expressible',
      note: 'Defy Death’s first sentence, applied as a standing mode on the death-save family.',
    },
    {
      clause: 'widens the face that counts as a natural 20',
      why: 'a-roll-result-an-effect-replaces',
      note: 'a die face read as something other than what it shows, which only a Critical Hit has a threshold for.',
    },
    {
      clause: 'is healing at a turn boundary that nothing pays out',
      why: 'a-turn-boundary-payout-a-feature-owes',
      note: 'Heroic Rally, and the queue that raises a turn’s debts belongs to castings.',
    },
  ],

  // — Monk —
  'monk:martial-arts': [
    {
      clause: 'the attack layer reads a weapon or the fixed Unarmed Strike, and has no notion of a class changing either',
      why: 'an-attack-the-class-redefines',
      note: 'the growing die, the Dexterity fist and the Bonus Action strike are three sentences of one absence.',
    },
  ],
  'monk:slow-fall': [
    {
      clause: 'falling is not modelled',
      why: 'falling',
      note: 'the spell map’s own id, which Feather Fall waits on.',
    },
  ],
  'monk:stunning-strike': [
    {
      clause: 'Spending a Focus Point to force a Constitution save',
      why: 'a-saving-throw-a-feature-forces',
      note: 'a feature that makes somebody else roll, which no grant kind does.',
    },
    {
      clause: 'the Stunned condition exists and applying it is the caller’s',
      why: 'a-condition-a-feature-imposes',
      note: 'the failure branch, and a standing grant may only refuse a condition.',
    },
  ],
  'monk:empowered-strikes': [
    {
      clause: 'because unarmed strikes are not a class-modified attack here',
      why: 'an-attack-the-class-redefines',
      note: 'Martial Arts’ blocker on a second Monk feature.',
    },
  ],
  'monk:acrobatic-movement': [
    {
      clause: 'movement has one speed and no modes',
      why: 'movement-modes',
      note: 'the spell map’s own id: Climb and Swim Speeds refused outright because no rule asks about one.',
    },
  ],
  'monk:heightened-focus': [
    {
      clause: 'Improved Flurry of Blows',
      why: 'an-attack-the-class-redefines',
      note: 'three Unarmed Strikes instead of two, which is the attack the Monk class redefines.',
    },
    {
      clause: 'Patient Defense',
      why: 'temporary-hit-points-a-feature-grants',
      note: 'two rolls of the Martial Arts die as Temporary Hit Points, which no feature grant reaches.',
    },
    {
      clause: 'Step of the Wind',
      why: 'a-move-a-feature-hands-its-holder',
      note: 'a willing creature moved with you, provoking nothing.',
    },
  ],
  'monk:self-restoration': [
    {
      clause: 'the turn boundary raises saves, not condition removals',
      why: 'a-turn-boundary-payout-a-feature-owes',
      note: 'the moment, which belongs to castings and to nothing a feature owes.',
    },
    {
      clause: 'Ending the Charmed, Frightened or Poisoned condition at the end of your turn',
      why: 'a-condition-a-feature-ends',
      note: 'and the removal itself, which only a healing pool’s list reaches.',
    },
  ],
  'monk:perfect-focus': [
    {
      clause: 'Regaining Focus Points on Initiative when low is not modelled',
      why: 'a-pool-refilled-to-a-floor',
      note: '"until you have 4 if you have 3 or fewer" is the sizing `Recovery.upTo` has no member for; the Initiative moment is built.',
    },
  ],
  'monk:superior-defense': [
    {
      clause: 'Resistance to all damage but Force for a minute',
      why: 'a-benefit-that-runs-for-a-printed-span',
      note: 'an activated feature runs to a turn boundary and is extended; a flat minute is a deadline it cannot file.',
    },
    {
      clause: 'defences are declared once and do not change',
      why: 'a-resource-traded-for-another',
      note: 'and it costs three Focus Points at once, where an activation spends exactly one use.',
    },
  ],
  'open-hand:technique': [
    {
      clause: 'because Flurry of Blows is not',
      why: 'an-attack-the-class-redefines',
      note: 'the attack the three effects ride on.',
    },
    {
      clause: 'Addle, Push and Topple on a Flurry of Blows hit',
      why: 'a-saving-throw-a-feature-forces',
      note: 'Push and Topple each ask for a Strength saving throw, and Addle forbids a Reaction outright.',
    },
  ],
  'open-hand:fleet-step': [
    {
      clause: 'A free Step of the Wind alongside another Bonus Action',
      why: 'an-action-a-spell-compels-or-forbids',
      note: 'a second Bonus Action in one turn, which the economy counts and no feature adds to.',
    },
  ],
  'open-hand:quivering-palm': [
    {
      clause: 'an effect that waits days for a trigger has no home in the duration system',
      why: 'an-effect-that-waits-for-a-later-trigger',
      note: 'the whole feature: the vibrations are filed now and fire on a decision that may never come.',
    },
  ],

  // — Paladin —
  'paladin:weapon-mastery': [
    {
      clause: 'Mastery properties are parsed onto weapons but not executed',
      why: 'a-weapon-mastery-property',
      note: 'the same shape the other four classes want.',
    },
  ],
  'paladin:fighting-style': [
    {
      clause: 'each is a modifier the caller passes to a roll',
      why: 'table',
      note: 'the feat’s own debt, exactly as the Fighter’s Fighting Style is.',
    },
  ],
  'paladin:smite': [
    {
      clause: 'a fixed spells grant, the move Favored Enemy already makes',
      why: 'expressible',
      note: 'Divine Smite is on the sheet from Paladin 2 without spending one of the prepared count.',
    },
    {
      clause: 'needs a pool a casting can be paid out of',
      why: 'a-casting-paid-for-out-of-a-feature-pool',
      note: 'the free casting, which is the `casts` grant an item has and a feature is refused.',
    },
    {
      clause: 'a reaction-shaped trigger the engine does not have',
      why: 'a-feature-that-changes-what-a-casting-costs',
      note: 'and casting it as a Bonus Action after a hit, which changes what the casting costs and when.',
    },
  ],
  'paladin:faithful-steed': [
    {
      clause: 'Find Steed always prepared',
      why: 'a-spell-an-item-casts-that-nothing-executes',
      note: 'the catalogue defines no Find Steed, so a fixed grant naming it would be refused.',
    },
    {
      clause: 'the free casting per Long Rest',
      why: 'a-casting-paid-for-out-of-a-feature-pool',
      note: 'Paladin’s Smite’s blocker on a second feature of the same class.',
    },
    {
      clause: 'summons are a shape the engine does not have',
      why: 'a-stat-block-created-mid-fight',
      note: 'and the steed itself, once the spell exists.',
    },
  ],
  'paladin:abjure-foes': [
    {
      clause: 'succeed on a Wisdom saving throw',
      why: 'a-saving-throw-a-feature-forces',
      note: 'a Channel Divinity that makes several creatures roll at once.',
    },
    {
      clause: 'a failure hangs the Frightened condition on them for a minute',
      why: 'a-condition-a-feature-imposes',
      note: 'and hangs it with a duration, which the condition layer takes from a casting and from nothing else.',
    },
    {
      clause: 'which is the action economy answering to somebody other than the engine',
      why: 'an-action-a-spell-compels-or-forbids',
      note: 'the restriction on what a Frightened target may do on its turns.',
    },
  ],
  'oath-of-devotion:sacred-weapon': [
    {
      clause: 'The Charisma bonus to attack rolls',
      why: 'a-bonus-an-ability-modifier-sizes',
      note: 'a number read off the holder’s sheet, which only Aura of Protection’s save bonus does.',
    },
    {
      clause: 'the emitted light',
      why: 'table',
      note: 'the engine holds no Bright, Dim or Darkness, which `sightBetween` says outright.',
    },
  ],
  'oath-of-devotion:smite-of-protection': [
    {
      clause: 'cover is declared rather than derived, and nothing declares it from a spell',
      why: 'a-declared-fact-a-feature-sets',
      note: 'the fact is held and the writer is a DM, which is the whole of what this feature would need to be.',
    },
  ],
  'oath-of-devotion:holy-nimbus': [
    {
      clause: 'The bright light is fiction',
      why: 'table',
      note: 'no light model, and nothing reads one.',
    },
    {
      clause: 'damage a feature deals with no attack roll and no save',
      why: 'damage-with-neither-an-attack-roll-nor-a-save',
      note: 'the spell map’s own id, which Magic Missile waits on.',
    },
    {
      clause: 'a mode selected by who is on the other end of the save',
      why: 'a-mode-on-the-save-a-spell-forces',
      note: 'Advantage against a Fiend’s or an Undead’s saving throw, which no selector can name.',
    },
    {
      clause: 'the ten minutes it runs for',
      why: 'a-benefit-that-runs-for-a-printed-span',
      note: 'a printed span rather than an extended turn boundary.',
    },
    {
      clause: 'the level 5 slot that buys the use back',
      why: 'a-resource-traded-for-another',
      note: 'a slot spent on a feature’s own pool.',
    },
  ],

  // — Ranger —
  'ranger:favored-enemy': [
    {
      clause: 'the rider really does fire at the marked creature',
      why: 'expressible',
      note: 'the fixed spells grant, and the executed spell underneath it.',
    },
    {
      clause: 'needs a pool a casting can be paid out of',
      why: 'a-casting-paid-for-out-of-a-feature-pool',
      note: 'Paladin’s Smite’s blocker on a second half-caster, which is what makes it a shape.',
    },
  ],
  'ranger:weapon-mastery': [
    {
      clause: 'Mastery properties are parsed onto weapons but not executed',
      why: 'a-weapon-mastery-property',
      note: 'the same shape the other four classes want.',
    },
  ],
  'ranger:fighting-style': [
    {
      clause: 'each is a modifier the caller passes to a roll',
      why: 'table',
      note: 'the feat’s own debt, exactly as the Fighter’s Fighting Style is.',
    },
  ],
  'ranger:tireless': [
    {
      clause: 'Temporary Hit Points as a Magic action',
      why: 'temporary-hit-points-a-feature-grants',
      note: 'the state is real and no feature route reaches it.',
    },
    {
      clause: 'reducing Exhaustion on a Short Rest',
      why: 'an-exhaustion-level-a-spell-changes',
      note: 'the spell map’s own id: Exhaustion is a level and nothing takes one off.',
    },
    {
      clause: 'are not modelled as their own pool',
      why: 'a-pool-the-proficiency-bonus-sizes',
      note: 'the uses, which SRD sizes by the Wisdom modifier with a floor — a sizing the pool grant does have, so what is missing is only what a use buys.',
    },
  ],
  'ranger:relentless-hunter': [
    {
      clause: 'the Concentration save reads the damage and knows nothing about which spell it threatens',
      why: 'a-concentration-rule-that-names-its-casting',
      note: 'the whole of it: no second list exists for a feature to widen a known spell against.',
    },
  ],
  'ranger:natures-veil': [
    {
      clause: 'the condition exists and nothing spends a Ranger’s uses to impose it',
      why: 'a-condition-a-feature-imposes',
      note: 'the pool is sizeable and the action is spendable; the Invisible condition is the half with no route.',
    },
  ],
  'ranger:precise-hunter': [
    {
      clause: 'has no way to pick out the attack rolls made against **one named creature**',
      why: 'a-modifier-a-feature-puts-on-another-creature',
      note: 'a mode narrowed to one creature at the other end of the roll, which the selector has no axis for.',
    },
    {
      clause: 'The mark itself is tracked',
      why: 'expressible',
      note: 'recorded because the note used to claim otherwise: Hunter’s Mark is executed and the rider fires only at its target.',
    },
  ],
  'ranger:foe-slayer': [
    {
      clause: 'changing the notation the definition pinned',
      why: 'a-feature-that-changes-a-castings-damage',
      note: 'the whole feature in 5.2.1: a d6 that becomes a d10 on a casting already written.',
    },
  ],
  'hunter:hunters-lore': [
    {
      clause: 'narration the engine could answer but is not asked',
      why: 'table',
      note: 'knowledge rather than a rule, and the one entry in this map whose feature is finished business.',
    },
  ],
  'hunter:defensive-tactics': [
    {
      clause: 'both impose Disadvantage on somebody else’s attack, which nothing carries between rolls',
      why: 'a-modifier-a-feature-puts-on-another-creature',
      note: 'both options at once, and Multiattack Defense’s is raised by a hit rather than derived.',
    },
    {
      clause: 'Escape the Horde and Multiattack Defense',
      why: 'an-option-re-chosen-on-a-rest',
      note: 'and SRD lets the option be swapped on any rest, which a creation-time choice freezes.',
    },
  ],
  'hunter:superior-hunters-prey': [
    {
      clause: 'giving its rider a second creature to fire at',
      why: 'a-feature-that-changes-who-a-casting-catches',
      note: 'a feature reaching into a casting the character already made.',
    },
  ],
  'hunter:superior-hunters-defense': [
    {
      clause: 'What is left is a fifth `ReactionEffect` member',
      why: 'a-reaction-effect-the-vocabulary-lacks',
      note: 'named by the design note, with the rule a new member has to meet.',
    },
    {
      clause: 'Three of the four pieces are built',
      why: 'expressible',
      note: 'the window, the granted Resistance and the end-of-current-turn deadline all exist.',
    },
  ],

  // — Rogue —
  'rogue:thieves-cant': [
    {
      clause: 'A language with no mechanics attached',
      why: 'table',
      note: 'narration, like Druidic: a language the sheet records and no rule reads.',
    },
  ],
  'rogue:weapon-mastery': [
    {
      clause: 'Mastery properties are parsed onto weapons but not executed',
      why: 'a-weapon-mastery-property',
      note: 'the same shape the other four classes want.',
    },
  ],
  'rogue:cunning-action': [
    {
      clause: 'not which actions a class may spend it on',
      why: 'an-action-a-spell-compels-or-forbids',
      note: 'the economy counts the Bonus Action and nothing says what a class may buy with one.',
    },
  ],
  'rogue:steady-aim': [
    {
      clause: 'a one-shot Advantage that is consumed by the roll it changes, which nothing here consumes',
      why: 'a-one-shot-roll-modifier',
      note: 'the clause the feature is actually for.',
    },
    {
      clause: 'the "haven’t moved during this turn" condition on spending the Bonus Action',
      why: 'an-action-a-spell-compels-or-forbids',
      note: 'a condition on whether an action may be spent at all, which `mayAct` does not read.',
    },
    {
      clause: '`speedOf` reads a grant like any other',
      why: 'expressible',
      note: 'both halves of the Speed sentence are built, which is why they are recorded rather than counted as missing.',
    },
  ],
  'rogue:cunning-strike': [
    {
      clause: 'spending some of those dice as a price',
      why: 'a-resource-traded-for-another',
      note: 'Sneak Attack dice as currency, which is the trade shape on something that is not a pool.',
    },
    {
      clause: 'a saving throw the feature forces',
      why: 'a-saving-throw-a-feature-forces',
      note: 'Poison and Trip each ask for one.',
    },
    {
      clause: 'a condition it imposes',
      why: 'a-condition-a-feature-imposes',
      note: 'Poisoned and Prone on a failure.',
    },
    {
      clause: 'a move it hands its holder',
      why: 'a-move-a-feature-hands-its-holder',
      note: 'Withdraw’s half Speed, provoking nothing.',
    },
    {
      clause: 'Sneak Attack itself is executed',
      why: 'expressible',
      note: 'recorded because the note used to claim otherwise.',
    },
  ],
  'rogue:reliable-talent': [
    {
      clause: 'the dice layer substitutes values on damage dice, not on a D20 Test',
      why: 'a-roll-result-an-effect-replaces',
      note: 'the spell map’s own id, and `treatLowRollsAs` is the reader it is missing at the other end.',
    },
  ],
  'rogue:improved-cunning-strike': [
    {
      clause: 'this feature rewriting the level 5 one',
      why: 'a-feature-that-rewrites-another-features-rule',
      note: 'two options on one hit where the earlier feature allows one.',
    },
    {
      clause: 'paying for an effect in Sneak Attack dice is a trade nothing expresses',
      why: 'a-resource-traded-for-another',
      note: 'inherited from Cunning Strike.',
    },
  ],
  'rogue:devious-strikes': [
    {
      clause: 'this feature lengthening the level 5 feature’s list',
      why: 'a-feature-that-rewrites-another-features-rule',
      note: 'three more options on a feature it does not own.',
    },
    {
      clause: 'each is bought with Sneak Attack dice',
      why: 'a-resource-traded-for-another',
      note: 'inherited from Cunning Strike.',
    },
    {
      clause: 'each forces a Constitution or Dexterity saving throw',
      why: 'a-saving-throw-a-feature-forces',
      note: 'all three options ask for one, and none of them has anything to roll it against.',
    },
    {
      clause: 'hang the Unconscious and Blinded conditions on the target',
      why: 'a-condition-a-feature-imposes',
      note: 'two of the three, each with a duration and a repeat.',
    },
    {
      clause: 'Daze forbids all but one of its actions on its next turn',
      why: 'an-action-a-spell-compels-or-forbids',
      note: 'the third, which is the action economy answering to a feature.',
    },
  ],
  'rogue:elusive': [
    {
      clause: 'No attack roll having Advantage against you while you are not Incapacitated',
      why: 'a-roll-mode-a-feature-takes-away',
      note: 'a mode cancelled rather than opposed, which the presence model has no member for.',
    },
  ],
  'rogue:stroke-of-luck': [
    {
      clause: 'Turning a miss into a hit or a failed check into a 20',
      why: 'a-roll-result-an-effect-replaces',
      note: 'a die told to read 20, which nothing on a D20 Test does.',
    },
  ],
  'thief:fast-hands': [
    {
      clause: 'for the same reason as Cunning Action',
      why: 'an-action-a-spell-compels-or-forbids',
      note: 'inherited whole: which actions a Bonus Action may buy is not a thing a class says.',
    },
  ],
  'thief:second-story-work': [
    {
      clause: 'movement has one speed and no modes',
      why: 'movement-modes',
      note: 'the Climb Speed half, refused outright because no rule asks about a mode.',
    },
    {
      clause: 'the longer running jump',
      why: 'jumping',
      note: 'the spell map’s own id: jumping is not modelled, so a distance has nothing to be measured against.',
    },
  ],
  'thief:supreme-sneak': [
    {
      clause: 'which needs the same trade of Sneak Attack dice every Cunning Strike option needs',
      why: 'a-resource-traded-for-another',
      note: 'inherited from Cunning Strike.',
    },
    {
      clause: 'the engine takes no Hide action for the exception to widen',
      why: 'an-action-a-spell-compels-or-forbids',
      note: 'the Hide action itself, which the economy does not offer.',
    },
  ],
  'thief:use-magic-device': [
    {
      clause: 'The attunement cap is a constant every creature shares and no feature raises it',
      why: 'a-rule-the-engine-fixes-for-everybody',
      note: 'the limit is a number in a command, not a fact on a sheet.',
    },
    {
      clause: 'is a die the engine can throw that nothing asks it to',
      why: 'a-random-outcome-that-is-not-a-d20',
      note: 'the spell map’s own id, arriving on a charge that is sometimes not spent.',
    },
    {
      clause: 'a casting made with the Thief’s Intelligence rather than the item’s or the wielder’s',
      why: 'a-feature-that-changes-what-a-casting-costs',
      note: 'the feature’s own half. The Spell Scroll record the benefit needs is the item map’s line rather than this one’s, and naming a shape for it here would file an item’s gap under a feature.',
    },
  ],
  'thief:thiefs-reflexes': [
    {
      clause: 'the Initiative order takes one entry per creature',
      why: 'a-turn-a-spell-inserts-into-the-order',
      note: 'the spell map’s own id, and the derived clock refuses exactly this.',
    },
  ],

  // — Sorcerer —
  'sorcerer:innate-sorcery': [
    {
      clause: 'The +1 to spell save DC and Advantage on spell attacks',
      why: 'a-bonus-to-spell-attack-rolls',
      note: 'the item map’s own id, whose description already names the save DC beside the attack roll.',
    },
    {
      clause: 'for one minute',
      why: 'a-benefit-that-runs-for-a-printed-span',
      note: 'a printed span rather than an extended turn boundary.',
    },
    {
      clause: 'the twice-per-long-rest limit is not tracked',
      why: 'a-feature-that-carries-a-second-grant',
      note: 'the pool and the activation are each expressible and a feature carries one grant.',
    },
  ],
  'sorcerer:metamagic': [
    {
      clause: 'Empowered Spell is `rerollDice` in the dice layer, which a caller opts into per roll',
      why: 'a-die-behaviour-a-spell-asks-for',
      note: 'the spell map’s own id: the behaviours are built and nothing passes them.',
    },
    {
      clause: 'Two options are chosen and recorded',
      why: 'a-feature-that-changes-what-a-casting-costs',
      note: 'every other option changes the casting — its range, its targets, its components, its action — for Sorcery Points.',
    },
  ],
  'sorcerer:sorcery-incarnate': [
    {
      clause: 'Using two Metamagic options on one spell',
      why: 'a-feature-that-rewrites-another-features-rule',
      note: 'a later feature lifting an earlier one’s limit.',
    },
    {
      clause: 'spending Sorcery Points to use Innate Sorcery again',
      why: 'a-resource-traded-for-another',
      note: 'one pool spent to refill another.',
    },
  ],
  'sorcerer:arcane-apotheosis': [
    {
      clause: 'The free Metamagic option during Innate Sorcery',
      why: 'a-feature-that-rewrites-another-features-rule',
      note: 'a capstone changing what an earlier feature costs while a third is running.',
    },
  ],
  'draconic-sorcery:draconic-resilience': [
    {
      clause: 'The Armour Class half is applied',
      why: 'expressible',
      note: 'an unarmoured-defense grant, the third feature to want that shape.',
    },
    {
      clause: 'needs a feature that raises the hit point maximum',
      why: 'a-hit-point-maximum-a-spell-moves',
      note: 'the spell map’s own id: the maximum is set at creation and by advancement, and nothing else moves it.',
    },
  ],
  'draconic-sorcery:elemental-affinity': [
    {
      clause: 'The Resistance is applied',
      why: 'expressible',
      note: 'a standing damage-resistance read off the option chosen.',
    },
    {
      clause: 'needs a hook into a spell’s own damage roll',
      why: 'a-feature-that-changes-a-castings-damage',
      note: 'the Charisma modifier added to one damage roll of a spell the Sorcerer cast.',
    },
  ],
  'draconic-sorcery:dragon-wings': [
    {
      clause: 'A Fly Speed is not modelled',
      why: 'movement-modes',
      note: 'the spell map’s own id, refused outright because no rule asks about a mode.',
    },
  ],
  'draconic-sorcery:dragon-companion': [
    {
      clause: 'summons are a shape the engine does not have',
      why: 'a-stat-block-created-mid-fight',
      note: 'the spell map’s own id, which Unseen Servant and Arcane Hand wait on too.',
    },
  ],

  // — Warlock —
  'warlock:eldritch-invocations': [
    {
      clause: 'each is its own small rule',
      why: 'table',
      note: 'an invocation that does nothing is that invocation’s debt, and none of them is content here yet.',
    },
    {
      clause: 'several of them grant spells or change how a spell is cast',
      why: 'a-feature-that-changes-what-a-casting-costs',
      note: 'the half of the list that names a mechanic rather than a catalogue entry.',
    },
  ],
  'warlock:contact-patron': [
    {
      clause: 'Contact Other Plane always prepared',
      why: 'a-spell-an-item-casts-that-nothing-executes',
      note: 'the catalogue defines no Contact Other Plane, so a fixed grant naming it would be refused.',
    },
    {
      clause: 'the free casting per Long Rest',
      why: 'a-casting-paid-for-out-of-a-feature-pool',
      note: 'the same missing grant Paladin’s Smite wants.',
    },
  ],
  'warlock:mystic-arcanum': [
    {
      clause: 'Four one-use pools attached to spells chosen at those levels',
      why: 'a-casting-paid-for-out-of-a-feature-pool',
      note: 'four of the same grant at once, and the reason a Warlock here has no high-level slots.',
    },
    {
      clause: 'One free casting each of a level 6, 7, 8 and 9 spell',
      why: 'a-feature-that-carries-a-second-grant',
      note: 'and the spells are chosen at four different levels on one feature, which one grant cannot hold.',
    },
  ],
  'warlock:eldritch-master': [
    {
      clause: 'Regaining all Mystic Arcanum castings on a Long Rest',
      why: 'a-casting-paid-for-out-of-a-feature-pool',
      note: 'inherited whole: there are no Arcanum pools for a recovery to refill.',
    },
  ],
  'fiend-patron:dark-ones-blessing': [
    {
      clause: 'nothing watches for a creature dropping and attributes it to a killer',
      why: 'an-outcome-of-a-spells-own-damage',
      note: 'the spell map’s own id: a target reaching 0 Hit Points because of you is an outcome nothing may hang on.',
    },
    {
      clause: 'Temporary Hit Points when you reduce an enemy to 0 are not granted',
      why: 'temporary-hit-points-a-feature-grants',
      note: 'and the payout, which no feature grant reaches.',
    },
  ],
  'fiend-patron:fiendish-resilience': [
    {
      clause: 'Choosing a damage type to resist after each rest',
      why: 'an-option-re-chosen-on-a-rest',
      note: 'the standing Resistance is expressible; choosing it again after every rest is not.',
    },
  ],
  'fiend-patron:hurl-through-hell': [
    {
      clause: 'it needs a creature removed from and returned to the battlefield',
      why: 'a-second-place-to-put-a-creature',
      note: 'the spell map’s own id: there is one scene, so a creature sent elsewhere has nowhere to be.',
    },
    {
      clause: 'the 8d10 Psychic damage on its return',
      why: 'damage-with-neither-an-attack-roll-nor-a-save',
      note: 'damage a feature deals with neither roll behind it.',
    },
  ],

  // — Wizard —
  'wizard:ritual-adept': [
    {
      clause: 'the engine does not check that the spell has the Ritual tag or that the book is in hand',
      why: 'a-feature-that-changes-what-a-casting-costs',
      note: 'the licence is the feature’s and the casting is checked against the class, not against what this feature allows.',
    },
    {
      clause: 'long casting times are refused',
      why: 'table',
      note: 'a refusal the casting layer owns, recorded so the feature’s note stays true to it.',
    },
  ],
  'wizard:memorize-spell': [
    {
      clause: 'Swapping a prepared spell on a Short Rest',
      why: 'an-option-re-chosen-on-a-rest',
      note: 'the design note names "every \\"swap a prepared spell on a Long Rest\\" rule" as this shape’s second consumer.',
    },
  ],
  'wizard:spell-mastery': [
    {
      clause: 'Casting the chosen spells at will',
      why: 'a-casting-paid-for-out-of-a-feature-pool',
      note: 'the at-will end of the same grant: an item may cast for nothing and a feature may not.',
    },
  ],
  'wizard:signature-spells': [
    {
      clause: 'The free level 3 castings are not modelled',
      why: 'a-casting-paid-for-out-of-a-feature-pool',
      note: 'two castings out of a pool that refills on a Short Rest.',
    },
  ],
  'evoker:potent-cantrip': [
    {
      clause: 'the damage pipeline has no notion of a cantrip',
      why: 'a-feature-that-changes-a-castings-damage',
      note: 'half damage where the definition offers none, decided by the caster’s feature.',
    },
  ],
  'evoker:sculpt-spells': [
    {
      clause: 'Choosing creatures to automatically succeed is not modelled',
      why: 'a-feature-that-changes-who-a-casting-catches',
      note: 'an area’s catch narrowed by a feature rather than by the casting’s own designation.',
    },
  ],
  'evoker:empowered-evocation': [
    {
      clause: 'Adding the Intelligence modifier to an Evocation damage roll',
      why: 'a-feature-that-changes-a-castings-damage',
      note: 'Elemental Affinity’s blocker on a second class, which is what makes it a shape.',
    },
  ],
  'evoker:overchannel': [
    {
      clause: 'Maximised damage and the escalating Necrotic backlash',
      why: 'a-feature-that-changes-a-castings-damage',
      note: 'a spell’s dice maximised, and then a cost paid in damage for having done it.',
    },
  ],

  // — Species and backgrounds. Read here; `origins.ts` is somebody else's file. —
  'dragonborn:draconic-ancestry': [
    {
      clause: 'The Damage Resistance trait reads this choice',
      why: 'expressible',
      note: 'the Resistance the chosen dragon names, applied through the option table.',
    },
    {
      clause: 'the appearance the trait also decides is fiction the DM narrates',
      why: 'table',
      note: 'what a Dragonborn looks like.',
    },
    {
      clause: 'The Breath Weapon is written in terms of the same choice and none of it is applied',
      why: 'a-grant-gated-on-one-option-of-a-choice',
      note: 'the second reader of this one choice, which would need its own gated grant on its own feature.',
    },
  ],
  'dragonborn:breath-weapon': [
    {
      clause: 'Replacing one of the Attack action attacks',
      why: 'an-attack-the-class-redefines',
      note: 'an attack swapped for something that is not an attack, which the economy does not offer.',
    },
    {
      clause: 'a 15-foot Cone or a 30-foot Line',
      why: 'an-area-an-item-creates',
      note: 'the item vocabulary’s own id: an area with no casting and no definition behind it.',
    },
    {
      clause: 'the Dexterity save against DC 8 plus Constitution modifier and Proficiency Bonus',
      why: 'a-saving-throw-a-feature-forces',
      note: 'a feature that makes everybody caught roll.',
    },
    {
      clause: '"a number of times equal to your Proficiency Bonus" is none of the three',
      why: 'a-pool-the-proficiency-bonus-sizes',
      note: 'the fourth sizing, and the one every species trait with a limit prints.',
    },
  ],
  'dragonborn:draconic-flight': [
    {
      clause: 'there is no Fly Speed beside it',
      why: 'movement-modes',
      note: 'the spell map’s own id, which Unseen Servant and Arcane Hand wait on too.',
    },
    {
      clause: 'the 10 minutes of spectral wings',
      why: 'a-benefit-that-runs-for-a-printed-span',
      note: 'a printed span rather than an extended turn boundary.',
    },
  ],
  'dwarf:dwarven-resilience': [
    {
      clause: 'is a standing grant that every hit is measured against',
      why: 'expressible',
      note: 'the Poison Resistance, a standing grant every hit is measured against.',
    },
    {
      clause: 'has no way to say which condition a save is about',
      why: 'a-save-keyed-to-a-condition',
      note: 'the spell map’s own id, which Protection from Poison waits on; four origin traits want it here.',
    },
  ],
  'dwarf:dwarven-toughness': [
    {
      clause: 'needs a feature that raises the hit point maximum',
      why: 'a-hit-point-maximum-a-spell-moves',
      note: 'Draconic Resilience wants the same thing, which is what makes it a shape.',
    },
  ],
  'dwarf:stonecunning': [
    {
      clause: 'The sense is switched on for 10 minutes by a Bonus Action rather than had',
      why: 'a-benefit-that-runs-for-a-printed-span',
      note: 'the sense grant exists and a standing effect is had rather than switched on for a span.',
    },
    {
      clause: 'the engine has no notion of a stone surface for it to be in contact with',
      why: 'a-world-fact-nothing-can-represent',
      note: 'the spell map’s own id: a fact the world model has no room for.',
    },
    {
      clause: 'is not one of the three ways the engine sizes a pool',
      why: 'a-pool-the-proficiency-bonus-sizes',
      note: 'the uses, sized in Proficiency Bonuses like every other origin trait with a limit.',
    },
  ],
  'elf:elven-lineage': [
    {
      clause: 'read by speedOf like any other',
      why: 'expressible',
      note: 'the Wood Elf’s five feet, gated on the lineage chosen.',
    },
    {
      clause: 'a feature carries at most one grant',
      why: 'a-feature-that-carries-a-second-grant',
      note: 'the Drow Darkvision, which is a sense the engine reads and has nowhere on this feature to sit.',
    },
    {
      clause: 'the engine gathers a spells grant only from the features of a class that casts',
      why: 'a-spell-a-source-that-does-not-cast-grants',
      note: 'the cantrip and the two levelled spells each lineage knows.',
    },
  ],
  'elf:fey-ancestry': [
    {
      clause: 'a roll selector names a family, an ability and a skill and has no condition axis',
      why: 'a-save-keyed-to-a-condition',
      note: 'Advantage on saves against the Charmed condition, on the axis a selector has no room for.',
    },
  ],
  'elf:trance': [
    {
      clause: 'a Long Rest is eight hours for everybody in this engine, one constant with no per-creature answer',
      why: 'a-rule-the-engine-fixes-for-everybody',
      note: 'a rest length a trait shortens for its holder alone.',
    },
    {
      clause: 'nothing models sleep',
      why: 'a-world-fact-nothing-can-represent',
      note: 'and the immunity to magical sleep with it.',
    },
  ],
  'gnome:gnomish-lineage': [
    {
      clause: 'a species feature cannot grant a spell',
      why: 'a-spell-a-source-that-does-not-cast-grants',
      note: 'both options are spells, so this is the whole trait.',
    },
    {
      clause: 'free a Proficiency Bonus of times a day',
      why: 'a-pool-the-proficiency-bonus-sizes',
      note: 'and the Forest Gnome’s limit, sized the way no species can be.',
    },
  ],
  'goliath:giant-ancestry': [
    {
      clause: 'a teleport on a Bonus Action',
      why: 'a-move-a-feature-hands-its-holder',
      note: 'a placement a feature gives away, which is the move shape with the distance removed.',
    },
    {
      clause: 'a Speed reduction until the start of your next turn',
      why: 'a-speed-a-feature-reduces',
      note: 'Hamstring Blow’s shape on a species trait.',
    },
    {
      clause: 'the Prone condition given on a hit',
      why: 'a-condition-a-feature-imposes',
      note: 'a condition a feature hangs, which the standing vocabulary may only refuse.',
    },
    {
      clause: 'a Reaction grant has no way to say it belongs to one option of six',
      why: 'a-grant-gated-on-one-option-of-a-choice',
      note: 'Stone’s Endurance, whose Reaction is otherwise the shape Uncanny Dodge already answers with.',
    },
    {
      clause: 'is not one of the three ways the engine sizes a pool',
      why: 'a-pool-the-proficiency-bonus-sizes',
      note: 'the uses each boon is limited to, counted in Proficiency Bonuses.',
    },
    {
      clause: 'Storm\'s Thunder, which deals damage back rather than reducing it',
      why: 'a-reaction-effect-the-vocabulary-lacks',
      note: 'Superior Hunter’s Defense wants a fifth member and this wants a sixth, which is what makes it a shape.',
    },
  ],
  'goliath:large-form': [
    {
      clause: 'a creature size in this engine belongs to the scene rather than to the sheet, and nothing changes one mid-fight',
      why: 'a-creature-fact-an-effect-overrides',
      note: 'the spell map’s own id: type and size are facts nothing may write over.',
    },
    {
      clause: 'the 10 minutes',
      why: 'a-benefit-that-runs-for-a-printed-span',
      note: 'a printed span rather than a turn boundary the holder has to keep extending.',
    },
  ],
  'goliath:powerful-build': [
    {
      clause: 'names a condition, and a roll selector names a family, an ability and a skill and has no condition axis',
      why: 'a-save-keyed-to-a-condition',
      note: 'Advantage on a check to end the Grappled condition, which is the same missing axis on a check rather than a save.',
    },
    {
      clause: 'the catalogue records a weight for every item and nothing adds them up',
      why: 'a-rule-the-engine-fixes-for-everybody',
      note: 'carrying capacity, which no rule computes and so none can widen.',
    },
  ],
  'halfling:brave': [
    {
      clause: 'a roll selector names a family, an ability and a skill and has no condition axis',
      why: 'a-save-keyed-to-a-condition',
      note: 'Advantage on saves against the Frightened condition, on the axis a selector has no room for.',
    },
  ],
  'halfling:halfling-nimbleness': [
    {
      clause: 'a rule the engine writes for a two-size difference and for nothing else, and it is not read off a feature',
      why: 'a-rule-the-engine-fixes-for-everybody',
      note: 'a constant in the positioning rules that one trait bends for its holder.',
    },
  ],
  'halfling:luck': [
    {
      clause: 'fires on the die rather than on the outcome',
      why: 'a-roll-result-an-effect-replaces',
      note: 'the spell map’s own id: a reroll offered by nothing and triggered by the face shown.',
    },
  ],
  'halfling:naturally-stealthy': [
    {
      clause: 'the engine takes no Hide action at all',
      why: 'an-action-a-spell-compels-or-forbids',
      note: 'the ordinary case this trait is an exception to.',
    },
  ],
  'human:resourceful': [
    {
      clause: 'Heroic Inspiration is not modelled',
      why: 'heroic-inspiration',
      note: 'the second feature in the catalogue that grants it, which is what makes it a shape.',
    },
  ],
  'orc:adrenaline-rush': [
    {
      clause: 'nothing lets a feature say that an action anybody can take becomes one',
      why: 'an-action-a-spell-compels-or-forbids',
      note: 'the Dash taken as a Bonus Action.',
    },
    {
      clause: 'no feature route reaches them',
      why: 'temporary-hit-points-a-feature-grants',
      note: 'the Temporary Hit Points, which are real state with no writer.',
    },
    {
      clause: 'is not one of the three ways the engine sizes a pool',
      why: 'a-pool-the-proficiency-bonus-sizes',
      note: 'the uses, sized in Proficiency Bonuses like every other origin trait with a limit.',
    },
  ],
  'orc:relentless-endurance': [
    {
      clause: 'dropping to 1 Hit Point instead of 0 is a decision taken at the moment damage lands',
      why: 'an-effect-that-intercepts-dropping-to-0',
      note: 'Relentless Rage wants the same hook, which is what makes it a shape.',
    },
  ],
  'tiefling:fiendish-legacy': [
    {
      clause: 'the grant reads the type out of that table',
      why: 'expressible',
      note: 'the Resistance each legacy names, through the option-meaning table.',
    },
    {
      clause: 'The cantrip beside it, and the level 3 and level 5 spells, reach nothing',
      why: 'a-spell-a-source-that-does-not-cast-grants',
      note: 'and the spellcasting ability the trait chooses, which has nowhere to be recorded.',
    },
  ],
  'tiefling:otherworldly-presence': [
    {
      clause: 'a species feature granting one reaches no spellcasting route',
      why: 'a-spell-a-source-that-does-not-cast-grants',
      note: 'Fiendish Legacy’s blocker on a second trait.',
    },
  ],
  'soldier:savage-attacker': [
    {
      clause: 'The feat is granted and its being the right one is checked',
      why: 'expressible',
      note: 'the background’s Origin feat, named by the background and validated.',
    },
    {
      clause: 'Rolling the weapon damage dice twice once per turn and using either roll',
      why: 'a-die-behaviour-a-spell-asks-for',
      note: 'the spell map’s own id: `rerollDice` is built, tested, and reached by no definition and no feature.',
    },
  ],
};

/**
 * Every feature the catalogue declares and where it came from.
 *
 * Classes, subclasses, species and backgrounds in one list, because the map's
 * population is *manual features* and a species trait is the same
 * `FeatureDefinition` a class feature is — the reading `isExecutedFeature` in
 * `coverage-data.ts` already takes of both.
 */
const allFeatures = (): readonly FeatureDefinition[] => [
  ...SRD_CONTENT.classes.flatMap((one) => one.features),
  ...SRD_CONTENT.subclasses.flatMap((one) => one.features),
  ...SRD_CONTENT.species.flatMap((one) => one.features),
  ...SRD_CONTENT.backgrounds.flatMap((one) => one.features),
];

/** The population: every feature that declares it is not executed. */
export const manualFeatureIds = (): readonly string[] =>
  allFeatures()
    .filter((feature) => feature.automation === 'manual')
    .map((feature) => feature.id)
    .sort();

let notes: Map<string, string> | undefined;

/** The note a feature carries, which is the document its clauses are held to. */
export const featureNoteOf = (featureId: string): string => {
  notes ??= new Map(allFeatures().map((feature) => [feature.id, feature.note]));
  const found = notes.get(featureId);
  if (found === undefined) throw new Error(`${featureId} is not a feature of this catalogue`);
  return found;
};

/** The clauses an entry names. */
export const featureClausesIn = (entry: FeatureEntry): readonly FeatureClause[] => [...entry];

/**
 * The shapes an entry names, deduplicated and sorted.
 *
 * `blockersIn`'s reading on the third corpus: two clauses of one note may want
 * one shape — Cunning Strike's three options each force a save — and a feature
 * that needs a shape twice is not a feature that needs two shapes.
 */
export const featureBlockersIn = (entry: FeatureEntry): readonly FeatureBlockerId[] =>
  [
    ...new Set(
      entry.flatMap((clause) =>
        clause.why === 'table' || clause.why === 'expressible' ? [] : [clause.why],
      ),
    ),
  ].sort();

/** The shapes blocking one feature, by id. */
export const featureBlockersOf = (featureId: string): readonly FeatureBlockerId[] =>
  featureBlockersIn(FEATURE_BLOCKED_ON[featureId] ?? []);

/**
 * The phrases a feature's own note does not say exactly once.
 *
 * Through the shared {@link unanchoredWithin}, over one unit — the note — so a
 * guard here cannot normalise or count differently from the guard over the
 * book. Zero matches is a clause that was reworded or invented; more than one
 * is a clause that would silently take a neighbouring sentence's licence.
 */
export const unanchoredFeatureClauses = (
  featureId: string,
  entry: FeatureEntry = FEATURE_BLOCKED_ON[featureId] ?? [],
): readonly UnanchoredClause[] =>
  unanchoredWithin(
    featureId,
    // Flattened, because the other book's units arrive through the sentence
    // splitter and this one does not: `unanchoredWithin` normalises the phrase
    // and trusts the unit, so a note typeset with a curly apostrophe would
    // match nothing at all.
    [flatten(featureNoteOf(featureId))],
    featureClausesIn(entry).map((clause) => clause.clause),
  );

/**
 * The two ways {@link FEATURE_BLOCKED_ON} can fail to cover its population.
 *
 * `unrecorded` is a manual feature with no line — a feature somebody wrote a
 * note for and nobody adjudicated. `stale` is a line for a feature that is not
 * manual, which after a conversion lands is the other half of the same drift.
 *
 * Parameterised over the population for {@link itemCoverageGaps}'s reason: a
 * guard that can only be run against the data it already agrees with is not a
 * guard, so the tests drive it with a synthetic feature nobody has read and a
 * synthetic conversion that must make a line stale.
 */
export const featureCoverageGaps = (
  manual: readonly string[] = manualFeatureIds(),
  blockedOn: Readonly<Record<string, unknown>> = FEATURE_BLOCKED_ON,
): { readonly unrecorded: readonly string[]; readonly stale: readonly string[] } => {
  const open = new Set(manual);
  return {
    unrecorded: [...open].filter((id) => blockedOn[id] === undefined).sort(),
    stale: Object.keys(blockedOn)
      .filter((id) => !open.has(id))
      .sort(),
  };
};

export interface FeatureShapeConsumers {
  readonly shape: FeatureBlockerId;
  /** Manual features this shape blocks. */
  readonly blocks: readonly string[];
  /** The features it is the **only** blocker for: building it finishes exactly these. */
  readonly finishes: readonly string[];
}

const sorted = (ids: Iterable<string>): readonly string[] => [...new Set(ids)].sort();

/** How many manual features a shape blocks, and which. */
export function featureConsumersOf(shape: FeatureBlockerId): FeatureShapeConsumers {
  const blocks = sorted(
    Object.entries(FEATURE_BLOCKED_ON)
      .filter(([, entry]) => featureBlockersIn(entry).includes(shape))
      .map(([id]) => id),
  );
  return {
    shape,
    blocks,
    finishes: blocks.filter((id) => featureBlockersOf(id).length === 1),
  };
}

/** Every shape any feature claims, which is what keeps the map from rotting. */
export function claimedFeatureShapes(): ReadonlySet<string> {
  return new Set(Object.values(FEATURE_BLOCKED_ON).flatMap((entry) => featureBlockersIn(entry)));
}

/**
 * Every shape a feature is blocked on, heaviest first.
 *
 * Over the shapes features **claim**, which is this vocabulary and whichever
 * of the other two the class tables also want — because a shape is worth
 * building for what it unblocks everywhere, and a feature map that printed
 * only its own ids would hide that a Dragon Companion and Arcane Hand are
 * waiting on one thing.
 *
 * Sorted by *finishes* first, because that is the column a tranche is planned
 * from; *blocks* breaks the tie, and the id breaks that.
 */
export function allFeatureShapeConsumers(): readonly FeatureShapeConsumers[] {
  return [...claimedFeatureShapes()]
    .map((shape) => featureConsumersOf(shape as FeatureBlockerId))
    .sort(
      (a, b) =>
        b.finishes.length - a.finishes.length ||
        b.blocks.length - a.blocks.length ||
        a.shape.localeCompare(b.shape),
    );
}

/** Every id any of the three vocabularies knows. */
export const knownFeatureBlockers = (): ReadonlySet<string> =>
  new Set<string>([
    ...Object.keys(MISSING_SHAPES),
    ...Object.keys(ITEM_SHAPES),
    ...Object.keys(FEATURE_SHAPES),
  ]);

/**
 * Manual features that name no missing mechanic at all.
 *
 * Two kinds, and they were one kind until the advancement shape retired: a
 * feature the **table** owns, which is fiction and will never be executed,
 * and a feature whose every mechanic now exists and whose entry is waiting on
 * transcription rather than on the engine. {@link featuresTheTableOwns}
 * separates them.
 */
export const featuresBlockedByNothing = (): readonly string[] =>
  Object.entries(FEATURE_BLOCKED_ON)
    .filter(([, entry]) => featureBlockersIn(entry).length === 0)
    .map(([id]) => id)
    .sort();

/**
 * Manual features whose every clause is the table's — finished business.
 *
 * The *fiction* pile on the other book, and it is reported rather than
 * omitted for the same reason: "there is nothing here for the engine to do" is
 * a conclusion somebody reached about Thieves' Cant and about Hunter's Lore,
 * and an entry silently missing from the ranking looks exactly like an entry
 * nobody read.
 *
 * **Every clause, not merely no blocker.** The two used to coincide and no
 * longer do: the twenty-four advancement features name no missing mechanic
 * now and are not the table's — their clauses read `expressible`, which
 * says the engine does this and the entry is waiting on a line of
 * transcription. Filing those under fiction would tell a builder to stop
 * reading them.
 */
export const featuresTheTableOwns = (): readonly string[] =>
  Object.entries(FEATURE_BLOCKED_ON)
    .filter(([, entry]) => featureClausesIn(entry).every((clause) => clause.why === 'table'))
    .map(([id]) => id)
    .sort();
