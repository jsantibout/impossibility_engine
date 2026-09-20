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
  'an-effect-list-a-hit-buys':
    'a feature whose effects are bought by an **attack that has already landed**, rather than by an action its holder takes. The two entries this replaces — a saving throw a feature forces, and a condition a feature imposes — were symptoms of one cause, and the cause is built: a feature\'s pool use confers an effect list through `PoolOptionGrant` in packages/engine/src/progression.ts, whose own declaration reads "SRD Channel Divinity is the shape this is built to: one feature, one pool, and a named menu the holder picks from at the moment of use". Every option on such a menu is a purchase somebody makes; nothing hangs one on a hit an attack roll has already settled, which is the sentence the SRD writes on a Stunning Strike, a Cunning Strike, an Open Hand Technique and two species traits. The save and the condition are expressible now; what has no shape is the *trigger*.',
  'an-effect-that-ends-when-its-target-is-hurt':
    'an effect the SRD ends early "if it takes any damage". What an option may print as an early end is held to what a timer can see happen to the creature it sits on, and packages/engine/src/content.ts refuses anything else by name — a cause is "not something the engine can see happen to the creature a timer sits on" — while every cause that list does hold is keyed on what that creature itself does. Damage dealt to it by somebody else is not among them, so Turn Undead\'s and Abjure Foes\'s escape clause is transcribed and inert: the conditions stand until the minute is up.',
  'a-target-list-an-ability-modifier-sizes':
    'a feature aimed at **a chosen number of creatures**, where the number is a modifier on the holder\'s sheet. An option reaches one named creature or fills an area, and packages/engine/src/content.ts holds it to exactly that — "an option does one or the other" — because those are the two sentences the SRD prints on the features this vocabulary was built from. SRD Abjure Foes\'s "you can target a number of creatures equal to your Charisma modifier (minimum of one creature) that you can see within 60 feet of yourself" is a third: a subset of an area, chosen at the moment of use and counted off a sheet.',
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
  'an-option-whose-span-is-a-turn-boundary':
    'a feature\'s conferred effect that runs to a **moment in the Initiative order** rather than for a printed span. What an option hangs is ended by a deadline it files itself, and `PoolOptionGrant` in packages/engine/src/progression.ts admits exactly one kind of it — "How long what it hangs lasts, in seconds" — because Channel Divinity\'s minute is what it was built from. An `activated` grant one member along carries a `TurnAnchor` instead and a `standing` grant needs none, so the vocabulary holds both spellings of a lifetime and this host holds one: SRD Nature\'s Veil gives the Invisible condition "until the end of your next turn", and there is no field to write that in. It is the mirror of the entry below rather than the same gap — that one is a switched-on feature wanting a span, and this is a conferred effect wanting a boundary.',
  'a-benefit-that-runs-for-a-printed-span':
    'a feature switched on for a minute or ten, rather than to a turn boundary it has to keep extending. `ActivatedFeature` in packages/engine/src/standing.ts is SRD Rage down to the field — "a Bonus Action, a pool sized by the class table, a deadline that can be pushed, a cap it cannot be pushed past, and two ways out that nobody commands" — and a Rage that is not extended ends at the boundary. A feature the book simply gives a duration has no deadline of its own to file.',
  'a-dc-a-feature-derives-from-its-own-abilities':
    'a saving throw DC a feature computes for itself. A feature\'s option rolls against its holder\'s spell save DC, and `PoolOption` in packages/engine/src/standing.ts says whose: "The **granting class\'s** ability, resolved at creation, because a multiclassed holder has more than one and the feature belongs to exactly one of them." A species trait belongs to no class and casts nothing — the same declaration goes on, "Null where the granting class casts nothing at all" — so SRD Breath Weapon\'s "DC 8 plus your Constitution modifier and Proficiency Bonus" is a formula the vocabulary cannot name, and what it would fall back to is an item\'s.',
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
    'a class that changes what an attack **is**. Two of the four ways it does so are built: a `strike-style` grant redefines the die and the ability of a class\'s Unarmed Strike and of the weapons that class names, and the Bonus Action strike it hands out is paid for out of the Bonus Action the economy already holds. What is left is the other two, and they are the ones that touch the action economy or the damage itself — a damage **type** the holder chooses on each hit, and an attack traded for something else: two more Unarmed Strikes bought with a Focus Point, the swing the Light property gives that nothing pays for, a breath weapon put in an Attack action\'s place. `docs/design/characters-and-equipment.md` files the neighbouring half of the same gap — "**Extra attacks inside the Attack action.** The economy counts one Attack action, not the attacks in it".',
  'an-attack-roll-selected-by-the-ability-it-uses':
    'an attack-roll modifier narrowed to the ability the swing was made with. `RollSelector` in packages/engine/src/roll-modifiers.ts allows an ability on a check and a save and refuses one on an attack, and says why: they "are filters and both narrow rather than widen: absent means the whole family". SRD Reckless Attack buys Advantage "on attack rolls using Strength" and would otherwise buy it on every attack the Barbarian makes.',
  'a-move-a-feature-hands-its-holder':
    'a move a feature gives away, outside the turn\'s allowance and outside anybody\'s command. `docs/design/space-and-areas.md` records the neighbouring half — "forced movement passes `forced: true`" — and that is a move somebody makes to somebody else. Half your Speed as part of a Bonus Action, a Withdraw that provokes nothing, a Step of the Wind that carries an ally: each is movement no grant kind can offer.',
  'a-speed-a-feature-reduces':
    'a Speed taken **away** from another creature. packages/engine/src/standing.ts draws the line on the member that adds one — "Speed *reductions* are not this member\'s business" — and files what does reduce a Speed under the condition layer, where nothing but Exhaustion writes one. A Hamstring Blow that takes fifteen feet off a target until your next turn has the arithmetic and no writer.',
  'a-modifier-a-feature-puts-on-another-creature':
    'a mode or a number a feature hangs on **somebody else**, raised by something that happened. A standing grant is derived from its holder\'s own state on every read, and `against-holder` in packages/engine/src/roll-modifiers.ts is the furthest one reaches — "Attack rolls against the affected creature have Advantage" — which is still a fact about the holder. A Disadvantage that starts when a creature hits you and lasts the rest of their turn, and a bonus the next attacker against your target gets, are durable grants on a third party no feature can write.',
  'a-one-shot-roll-modifier':
    'a mode a feature hangs on somebody at a **moment**, spent by the first roll that reaches it. The mechanic itself is built and is a casting’s: packages/engine/src/roll-modifiers.ts carries `RollModifier.oneShot` — "Spent by the first roll it reaches, rather than running to a deadline." — with `RollSelector.counterpart` beside it for the sentences that narrow one to a named creature, and SRD Guiding Bolt and Vicious Mockery write both ends of it through a spell’s rider. What no **feature** has is the door: a `FeatureGrant` of kind `roll-mode` is a standing grant, derived from its holder’s own state on every read, and packages/engine/src/progression.ts says what the list is for — "Deliberately few. A feature whose effect does not fit one of these is" — so nothing lets a feature *emit* a grant when something happens. Sap and Vex wait on the weapon-mastery record before they could be hung at all; Steady Aim’s Bonus Action, Studied Attacks’ miss and Improved Brutal Strike’s landed hit are three more moments with nothing to fire at them. **A moment is declared and not only fired**, which is the half this description owed its `finishes` column: SRD Steady Aim spends a Bonus Action — gated on not having moved, a fact `TurnBudget.movementSpent` already holds — so whatever declares a moment says what it costs and what must be true to pay it, or a feature built from this shape emits its grant and leaves its own condition unenforced.',
  'an-action-rule-a-feature-holds':
    'a rule about the action economy that a **feature** states — about its own holder, or about somebody it reaches. **The mechanism is whole and its catalogue is empty on this side.** `ActionRule` in packages/engine/src/combat.ts is "the ninth sourced grant, hung on the creature", it says three of the four things a sentence about a turn can say, and **it is reachable from a casting and from nothing else**: the two emitters of `action-rule-granted` are a spell’s effect and a spell’s attack rider, and both take a casting id as the grant’s source. `FeatureGrant` carries no member that holds one, so nothing compiles one off a class table. `StandingGrant` has none either and could not usefully, because packages/engine/src/standing.ts draws the lifetime itself — "a feature’s grant is derived from the world on every read and stored nowhere, while a spell’s is durable state linked to its casting" — where `creature.actionRules` is stored state every spender reads. And the one feature-side effect list, a pool’s `options`, is refused this kind by its **absence from `CONFERRED_EFFECT_KINDS`** in packages/engine/src/content.ts rather than by an argument about it: the refusal names the arriving kind back and says it "needs the casting a feature has none of". So this is the surviving instance of the sentence that field was built to answer, which packages/engine/src/progression.ts still prints beside it: "an effect list was reachable from a spell and from a bottle and from nothing a class prints". **What the door alone finishes is nothing**, and the reason is worth reading in the column’s own terms: with a price on `takeDash` in the same brief it would reach two clauses of Cunning Action and one of Adrenaline Rush, and Cunning Action would still declare `manual`, because its Hide is refused somewhere else entirely — the reading `barbarian:persistent-rage` already records, where half of a feature being applied is exactly why it is not marked as executed.',
  'an-action-the-engine-has-no-spender-for':
    'an action the book prints that no command takes, so no rule could name it even if a feature could write one. `NAMED_ACTIONS` in packages/engine/src/combat.ts is a closed list of six that **names its own absences and why they are absent**: "Hide, Search, Study, Influence, Ready and Utilize are the book’s too and are absent: the engine has no spender that could be told one of them apart", so a rule naming one would read as enforced and would not be. The engine had written this down before the shape was coined, which is most of the argument for coining it. **Hide** is the one three features want — a Rogue’s Cunning Action, the Cunning Strike option a Thief’s Supreme Sneak widens, and a Halfling whose trait is an *exception* to an ordinary Hide — and **Utilize** is the second, bought with a Bonus Action by a Thief while nothing charges for a Utilize at all. It is deliberately **not** the grant shape beside it: no vocabulary a feature could be written in would help here, because there is nothing for a rule to be about until some command takes the action. Each member of that list was admitted with a spender that names it and an SRD sentence that asks for it, which is the price a new member pays.',
  'a-cheaper-price-only-one-command-offers':
    'a named action paid for out of a cheaper slot, where the command that would charge for it cannot be asked. The permission is built — `ActionRule`’s `allows` — and `STATABLE_PRICES` in packages/engine/src/combat.ts is the map of which commands honour one, because "an allowance nobody can ask for is data no code reads". It holds one entry, a Disengage out of a Bonus Action, and the file leaves the door open in as many words: "A second arrives with its own command and its own paragraph, and this map is where it is admitted." So `takeDisengage` takes a `from` and refuses a price the map does not hold, while `takeDash` takes no `from` at all and charges an Action unconditionally. Every feature that buys a Dash with a Bonus Action wants the second entry **and** the parameter beside it, and neither is a grant vocabulary’s business: the permission could be granted today and the command would still spend the wrong slot.',
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
      note: 'a mode consumed by the roll it changes, built for Guiding Bolt and Vicious Mockery — and on a *saving throw* here, which the mechanic does not reach: only the two attack rollers spend a one-shot, so `oneShotProblem` in packages/engine/src/roll-modifiers.ts refuses one on any other family until a save roller spends one. The moment that would hang it, a Brutal Strike landing, is missing as well.',
    },
    {
      clause: 'stops its Opportunity Attacks until the start of your next turn',
      why: 'an-action-rule-a-feature-holds',
      note: 'the rule is writable — `opportunity-attack` is one of the six named actions and `forbids` takes a list of them — and it is hung on somebody else, which a casting does through an effect and a feature through nothing. The moment that would hang it, a Brutal Strike landing, is the clause above.',
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
  'fighter:tactical-shift': [
    {
      clause: 'The free half-Speed move on a Second Wind',
      why: 'a-move-a-feature-hands-its-holder',
      note: 'Instinctive Pounce’s shape on a second class.',
    },
  ],
  'fighter:studied-attacks': [
    {
      clause: 'Advantage on the next attack after a miss is not tracked between attacks',
      why: 'a-one-shot-roll-modifier',
      note: 'the spell map’s own id: a mode consumed by the roll it changes, which is now built — what this feature still has no door for is the *moment*, which is a miss rather than a casting or a deadline.',
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
      why: 'an-effect-list-a-hit-buys',
      note: 'the save and the condition are both expressible on a pool option now; what is not is that this one is bought by a hit rather than by an action.',
    },
  ],
  'monk:empowered-strikes': [
    {
      clause: 'carries no damage type for a second feature to change',
      why: 'an-attack-the-class-redefines',
      note: 'what Martial Arts left behind: the style redefines which die is thrown and which ability is added, and the type the die deals is still the weapon’s own.',
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
      why: 'an-effect-list-a-hit-buys',
      note: 'the clause names which hit buys them, and that is the half with no shape: Push and Topple are ordinary Strength saves once something hangs them on a landed strike.',
    },
  ],
  'open-hand:fleet-step': [
    {
      clause: 'A free Step of the Wind alongside another Bonus Action',
      why: 'an-action-a-spell-compels-or-forbids',
      note: 'a second Bonus Action in one turn. It keeps the spell id through the re-filing, because it is one of the two things that description names as genuinely left — an extra action granted rather than an existing one governed, which is Haste’s sentence. No member of the union creates a slot, so opening the grant to a feature would leave nothing writable in it.',
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
  'paladin:abjure-foes': [
    {
      clause: 'succeed on a Wisdom saving throw',
      why: 'a-target-list-an-ability-modifier-sizes',
      note: 'a Channel Divinity option rolls this save now; whom it rolls against is a number of creatures equal to the Paladin\'s Charisma modifier, which is neither one named target nor a whole area.',
    },
    {
      clause: 'a failure hangs the Frightened condition on them for a minute',
      why: 'an-effect-that-ends-when-its-target-is-hurt',
      note: 'the minute is a timer an option files; the SRD\'s "or until it takes any damage" beside it is the half no end cause can say.',
    },
    {
      clause: 'which is the action economy answering to somebody other than the engine',
      why: 'an-action-a-spell-compels-or-forbids',
      note: 'one of move, an action, or a Bonus Action is a rule that couples three slots, and `forbids` and `permits-only` between them cannot state it — the other thing that description names as left, derived there from Slow. It keeps the spell id for that reason rather than for the door: a Channel Divinity option is the one feature-side effect list there is, and there would be nothing writable to put in it.',
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
      why: 'an-option-whose-span-is-a-turn-boundary',
      note: 'imposing it is a pool option now and the uses are an ability modifier with a floor, which the pool grant already sizes; what is left is "until the end of your next turn", which an option cannot say.',
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
  // **The feature the re-filing was found on**, and the one that wants every
  // coined id at once. It carried a single clause naming a single shape, and
  // the three actions the SRD prints on it are refused in three different
  // places — which is why a track briefed to transcribe it landed nothing.
  'rogue:cunning-action': [
    {
      clause: 'a rule the engine can already state and a feature has nowhere to hold',
      why: 'an-action-rule-a-feature-holds',
      note: 'the Disengage, and the only one of the three whose rule is writable today: `allows` was derived from Conjure Woodland Beings and says exactly this sentence. What it has no home in is a class table.',
    },
    {
      clause: '`takeDash` charges an Action unconditionally',
      why: 'a-cheaper-price-only-one-command-offers',
      note: 'the Dash, refused a step past the grant. Even holding the permission, the command that spends the slot takes no price and would charge an Action — so this clause survives the door being opened and is filed apart from it.',
    },
    {
      clause: 'it is not one of the six named actions, no command takes it',
      why: 'an-action-the-engine-has-no-spender-for',
      note: 'the Hide, which is refused earliest of all: there is no spend for a rule to be about, so neither a grant nor a price would reach it. It is why the two clauses above being built would not make this feature executed — the reading `barbarian:persistent-rage` prints: "Half of it is applied, which is why this is not marked as executed."',
    },
  ],
  'rogue:steady-aim': [
    {
      clause: 'a one-shot Advantage that is consumed by the roll it changes, which nothing here consumes',
      why: 'a-one-shot-roll-modifier',
      note: 'the clause the feature is actually for, re-read against the mechanic rather than against the note. `RollModifier.oneShot` is built, and `oneShot` is a field a feature’s own `roll-mode` grant can already carry — writing it there would do nothing, because `consumedRollModifiers` spends what it finds in `creature.rollModifiers`, which is stored state, while a feature’s standing grant is derived afresh on every read and reaches none of it. So what is missing is still the moment: a Bonus Action a feature spends to *emit* one.',
    },
    {
      clause: 'the "haven’t moved during this turn" condition on spending the Bonus Action',
      why: 'a-one-shot-roll-modifier',
      note: 'a field on the unbuilt moment above rather than a rule about the economy, which is the correction that took this feature off the action-rule list altogether: what Steady Aim needs is a Bonus Action a feature spends to emit a grant, and a gate is part of declaring that Bonus Action. The fact it gates on is already on the budget — `TurnBudget.movementSpent` stores the feet rather than what is left of them, which is what lets a question be asked of it.',
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
      why: 'an-effect-list-a-hit-buys',
      note: 'Poison and Trip each ask for one, and each is bought by the hit the Sneak Attack rode rather than by an action.',
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
      why: 'an-effect-list-a-hit-buys',
      note: 'all three ask for one against the Rogue\'s own DC, which a pool option rolls; what buys them is the hit the Sneak Attack rode.',
    },
    {
      clause: 'Daze forbids all but one of its actions on its next turn',
      why: 'an-action-a-spell-compels-or-forbids',
      note: 'all but one is a *count* rather than a list, and `permits-only` narrows a slot to the actions it names. Abjure Foes prints the same shape of sentence, so this keeps the spell id beside it: what is missing is a member neither polarity of the union has, rather than the feature-side door the rest of this batch was re-filed onto.',
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
      clause: 'the engine charges for no Utilize action anywhere',
      why: 'an-action-the-engine-has-no-spender-for',
      note: 'not inherited whole after all, which is what re-reading the mechanism changed. Cunning Action fails in three places and this fails in the earliest of them alone: Utilize is not a named action and no command spends a slot on it, so there is no price for a cheaper one to be offered against.',
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
      why: 'an-action-the-engine-has-no-spender-for',
      note: 'the Hide action itself, which is a spender the engine does not have rather than a rule a feature cannot write. Every grant vocabulary here could be opened to a feature tomorrow and this clause would be exactly where it is.',
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
      clause: 'Empowered Spell and Seeking Spell are `rerollDice` in the dice layer',
      why: 'a-die-behaviour-a-spell-asks-for',
      note: 'the spell map’s own id: the behaviours are built and nothing passes them.',
    },
    {
      clause: 'Careful Spell needs creatures that automatically succeed on a save the casting is about to roll',
      why: 'a-feature-that-changes-who-a-casting-catches',
      note: 'the shape’s own sentence — "sparing creatures from your own Evocation" — with the number counted off a Charisma modifier.',
    },
    {
      clause: 'Heightened Spell needs Disadvantage hung on one target’s saves against this casting',
      why: 'a-mode-on-the-save-a-spell-forces',
      note: 'the spell map’s own id: "nothing records what a save was against", so a mode cannot be narrowed to the saves one casting forces.',
    },
    {
      clause: 'Subtle Spell has nothing to remove, because a spell definition carries no components',
      why: 'a-feature-that-changes-what-a-casting-costs',
      note: 'one of the two parts of this shape the built member does not reach: the shape names "its components" and a SpellDefinition has none to name.',
    },
    {
      clause: 'Transmuted Spell needs the caster to restate a damage type the spell printed',
      why: 'a-feature-that-changes-what-a-casting-costs',
      note: 'the other: the shape’s own line is that "nothing stands between the caster’s sheet and that pinning", and the type a casting pins is one of the things nothing stands between — the built member rewrites the range, the duration, the action and the level, and `damageTypeStated` is a licence the definition prints rather than one a feature may hand out.',
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
  'evoker:sculpt-spells': [
    {
      clause: 'Choosing creatures to automatically succeed is not modelled',
      why: 'a-feature-that-changes-who-a-casting-catches',
      note: 'an area’s catch narrowed by a feature rather than by the casting’s own designation.',
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
      why: 'a-dc-a-feature-derives-from-its-own-abilities',
      note: 'an area option rolls this save now; the number it would roll against is a species trait\'s own formula, and a species casts nothing for a spell save DC to be read from.',
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
      why: 'an-effect-list-a-hit-buys',
      note: 'the clause names the trigger, which is the half with no shape: hanging Prone is what a pool option already does.',
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
      why: 'an-action-the-engine-has-no-spender-for',
      note: 'the ordinary case this trait is an exception to, and the plainest statement of the coined shape: the trait widens a Hide and there is no Hide. `NAMED_ACTIONS` admits a member only where some command could be told it apart, and nothing takes this one.',
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
      why: 'a-cheaper-price-only-one-command-offers',
      note: 'the Dash taken as a Bonus Action, filed on the blocker that outlives the other one. A feature that could hold an `allows` would still not get this Dash: `STATABLE_PRICES` holds Disengage alone and `takeDash` takes no price at all, so the permission would land and the command would spend an Action anyway.',
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
