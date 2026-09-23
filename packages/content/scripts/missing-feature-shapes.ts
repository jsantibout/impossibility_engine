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
import { featureGrants, type FeatureDefinition, type GatedFeatureGrant } from '@ie/engine';
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
  'an-effect-that-ends-when-its-target-is-hurt':
    'an effect the SRD ends early "if it takes any damage". What an option may print as an early end is held to what a timer can see happen to the creature it sits on, and packages/engine/src/content.ts refuses anything else by name — a cause is "not something the engine can see happen to the creature a timer sits on" — while every cause that list does hold is keyed on what that creature itself does. Damage dealt to it by somebody else is not among them, so Turn Undead\'s and Abjure Foes\'s escape clause is transcribed and inert: the conditions stand until the minute is up.',
  'a-target-list-an-ability-modifier-sizes':
    'a feature aimed at **a chosen number of creatures**, where the number is a modifier on the holder\'s sheet. An option reaches one named creature or fills an area, and packages/engine/src/content.ts holds it to exactly that — "an option does one or the other" — because those are the two sentences the SRD prints on the features this vocabulary was built from. SRD Abjure Foes\'s "you can target a number of creatures equal to your Charisma modifier (minimum of one creature) that you can see within 60 feet of yourself" is a third: a subset of an area, chosen at the moment of use and counted off a sheet.',
  'a-condition-a-feature-ends':
    'a condition a feature takes **off**. One grant removes conditions and it is welded to a healing pool — `lifts-conditions` in packages/engine/src/progression.ts is Restoring Touch, and the file says what it is: "It widens a feature it does not own, which is the shape Improved Critical already has — a second feature restating the first rather than a second mechanism." A feature that ends a condition on its own holder, with no pool and no touch, has nothing to restate.',
  'a-pool-refilled-to-a-floor':
    'a recovery that tops a pool up to a number rather than giving back a share of it. `Recovery`\'s `upTo` in packages/engine/src/progression.ts is half the class level, half the maximum, or all, and the SRD prints a fourth shape twice — "until you have two", "until you have 4 if you have 3 or fewer" — where what is regained depends on what is left rather than on the pool\'s size.',
  'a-resource-traded-for-another':
    'one resource spent to buy another. The conversion between two **pools** is built: the `trade` grant in packages/engine/src/progression.ts is "One resource spent to buy another", a list because "the SRD prints two directions in one feature", and Wild Resurgence spends a Wild Shape use for a level 1 slot and a slot for a use. Spell slots on the **bought** end are built too, in both shapes the book prints: a slot whose level the caller names off a printed price table, and several inside a budget on their combined level, which are Font of Magic\'s Created Spell Slots and Arcane Recovery. What is still unsaid is everything either end of which is not a pool or a slot — Sneak Attack dice forgone to buy an effect, a mode given up for a harder hit, a cheaper action bought with a Focus Point — and the one trade the grant\'s own closed vocabulary still refuses: "a trade can never mint a use above a pool\'s maximum", so a slot a class table never printed is refused rather than given, which is the half of Font of Magic\'s create that waits on a ruling. The limit is no longer one of them: `ResourceTradeGrant.limit` carries an `unlimited` member, and Font of Inspiration, Sorcery Incarnate and Holy Nimbus each spend through it.',
  'a-casting-paid-for-out-of-a-feature-pool':
    'a spell a feature lets you cast without a slot. The route exists for an **item** and is refused to a feature by name: packages/engine/src/progression.ts says of the `casts` grant "An item-only member. Nothing executes it from a class feature and `checkContent` refuses it there", because the charges it spends are an item\'s pool looked up by the granting item\'s id. Every SRD sentence of the shape "cast it without expending a spell slot" wants exactly that grant with a feature\'s pool behind it.',
  'an-option-whose-span-is-a-turn-boundary':
    'a feature\'s conferred effect that runs to a **moment in the Initiative order** rather than for a printed span. What an option hangs is ended by a deadline it files itself, and `PoolOptionGrant` in packages/engine/src/progression.ts admits exactly one kind of it — "How long what it hangs lasts, in seconds" — because Channel Divinity\'s minute is what it was built from. An `activated` grant one member along carries a `TurnAnchor` instead and a `standing` grant needs none, so the vocabulary holds both spellings of a lifetime and this host holds one: SRD Nature\'s Veil gives the Invisible condition "until the end of your next turn", and there is no field to write that in. It is the mirror of the entry below rather than the same gap — that one is a switched-on feature wanting a span, and this is a conferred effect wanting a boundary.',
  'a-dc-a-feature-derives-from-its-own-abilities':
    'a saving throw DC a feature computes for itself. A feature\'s option rolls against its holder\'s spell save DC, and `PoolOption` in packages/engine/src/standing.ts says whose: "The **granting class\'s** ability, resolved at creation, because a multiclassed holder has more than one and the feature belongs to exactly one of them." A species trait belongs to no class and casts nothing — the same declaration goes on, "Null where the granting class casts nothing at all" — so SRD Breath Weapon\'s "DC 8 plus your Constitution modifier and Proficiency Bonus" is a formula the vocabulary cannot name, and what it would fall back to is an item\'s.',
  'a-second-question-one-feature-asks':
    'a feature that asks the player **two** things. packages/engine/src/progression.ts gives a feature one question — “What the player must decide when they gain it” — and the answer is stored under the feature’s own id, so one feature holds one answer list and every grant written in terms of a choice reads that one. SRD Divine Order and Primal Order each print two under one heading: which order, and — for one of the two orders — which extra cantrip from the class list. The gate that hangs a grant on the order chosen is built; the cantrip still cannot be granted, because the feature has already spent its question and a spells grant with no fixed list is compiled from the answer to it.',
  'a-feature-that-rewrites-another-features-rule':
    'a later feature that changes an earlier one. The engine allows exactly five restatements and each arrived with its sentence — a `critical-range` threshold restated, a `lifts-conditions` list lengthened, `widens-reaction` which packages/engine/src/progression.ts calls "A second feature restating the first rather than a second mechanism", `executedBy` for a step in another feature\'s table, and the pool field the same file calls "A **later feature** that rewrites this pool\'s recovery", declared on the pool and gated on the feature whose sentence moves it. A feature that changes another one\'s **duration**, or what its uses buy, is a sixth and has no member.',
  'an-option-re-chosen-on-a-rest':
    'a choice the book lets you take again after a rest. `docs/design/characters-and-equipment.md` names it and its first consumer — "**A grant that can be re-chosen on a rest.** Circle of the Land\'s spells" — and files every rule about swapping a prepared spell on a rest beside it. A `FeatureChoice` is answered once, at creation, and frozen into the sheet.',
  'an-attack-the-class-redefines':
    'a class that changes what an attack **is**. Two of the four ways it does so are built: a `strike-style` grant redefines the die and the ability of a class\'s Unarmed Strike and of the weapons that class names, and the Bonus Action strike it hands out is paid for out of the Bonus Action the economy already holds. What is left is the other two, and they are the ones that touch the action economy or the damage itself — a damage **type** the holder chooses on each hit, and an attack traded for something else: two more Unarmed Strikes bought with a Focus Point, the swing the Light property gives that nothing pays for, a breath weapon put in an Attack action\'s place. `docs/design/characters-and-equipment.md` files the neighbouring half of the same gap — "**Extra attacks inside the Attack action.** The economy counts one Attack action, not the attacks in it".',
  'a-move-a-feature-hands-its-holder':
    'a move a feature gives away, outside the turn\'s allowance and outside anybody\'s command. `docs/design/space-and-areas.md` records the neighbouring half — "forced movement passes `forced: true`" — and that is a move somebody makes to somebody else. **The counter is built now and the vocabulary is still one sentence wide**: `TurnBudget.grantedMoves` holds feet a feature handed the turn, spent out of no Speed, provoking nobody, and refused where nothing handed them over, and SRD Tactical Shift is the sentence that walks through it — declared on the `heals` block of the use it rides on, which is `recoversSooner`\'s shape one field along. What is left is every sentence that block cannot carry: a move that is not a rider on a pool use at all, one that provokes nothing *for the rest of the turn* rather than for the move it pays for, and one that carries somebody **else** — a Step of the Wind\'s ally is a second creature moving, which no grant on one holder can say.',
  'a-speed-a-feature-reduces':
    'a Speed taken **away** from another creature. packages/engine/src/standing.ts draws the line on the member that adds one — "Speed *reductions* are not this member\'s business" — and files what does reduce a Speed under the condition layer, where nothing but Exhaustion writes one. A Hamstring Blow that takes fifteen feet off a target until your next turn has the arithmetic and no writer.',
  'a-modifier-a-feature-puts-on-another-creature':
    'a mode or a number a feature hangs on **somebody else**, raised by something that happened. A standing grant is derived from its holder\'s own state on every read, and `against-holder` in packages/engine/src/roll-modifiers.ts is the furthest one reaches — "Attack rolls against the affected creature have Advantage" — which is still a fact about the holder. A Disadvantage that starts when a creature hits you and lasts the rest of their turn, and a bonus the next attacker against your target gets, are durable grants on a third party no feature can write.',
  'a-one-shot-roll-modifier':
    'a mode a feature hangs on somebody at a **moment**, spent by the first roll that reaches it. The mechanic itself is built and is a casting’s: packages/engine/src/roll-modifiers.ts carries `RollModifier.oneShot` — "Spent by the first roll it reaches, rather than running to a deadline." — with `RollSelector.counterpart` beside it for the sentences that narrow one to a named creature, and SRD Guiding Bolt and Vicious Mockery write both ends of it through a spell’s rider. What no **feature** has is the door: a `FeatureGrant` of kind `roll-mode` is a standing grant, derived from its holder’s own state on every read, and packages/engine/src/progression.ts says what the list is for — "Deliberately few. A feature whose effect does not fit one of these is" — so a feature’s own `roll-mode` grant reaches none of it. **One of the two moments is built now**, and it is the declared one: `ActivatedFeature.hangs` in packages/engine/src/standing.ts is the stored half of a standing grant, emitted by `activateFeature` where the action is paid for, with `onlyIfUnmoved` beside it for the condition a use is gated on — SRD Steady Aim spends a Bonus Action it may take only before moving, and hangs both of its clauses through it. What is still missing is the moment nobody declares: a grant **fired** by something that happened to an attack, which is Studied Attacks’ miss and Improved Brutal Strike’s landed hit. Sap and Vex reach theirs through the weapon-mastery record and `masteryAfterHit`, which is one hit’s rider rather than a door a feature can write.',
  'an-action-rule-a-feature-holds':
    'a rule about the action economy that a **feature** states about **somebody else**. The holder half is built and the catalogue writes it: `StandingGrant` in packages/engine/src/standing.ts carries an `action-rule` member, and `actionRulesOn` merges what a feature says with what a casting hung at every site a spend is checked — derived on every read rather than compiled onto the creature, because a stored copy "would put a permanent unconditional row into every Rogue’s state" and would reach no character already written into a log. SRD Cunning Action and SRD Adrenaline Rush are written through it. **What is left is the other direction**, and the SRD writes it on a *hit*: a rule hung on the creature you have just struck — Improved Brutal Strike stopping its Opportunity Attacks — which a casting does through an effect on its target and a feature through nothing, because a standing grant is a fact about its own holder. packages/engine/src/combat.ts used to refuse the neighbouring question about spending somebody else’s budget and no longer does — the owner’s ruling of 2026-09-22 settled it, and the module now records that "a spell may spend another creature’s budget" — so this is the narrower one left beside it, waiting on the moment that would hang the rule as much as on the reach.',
  'a-requirement-on-the-armour-its-holder-is-wearing':
    'a standing grant conditioned on the armour its holder **is** wearing. The axis exists and both of its members are the other polarity: packages/engine/src/standing.ts carries `not-wearing-heavy-armor` — "while you aren\'t wearing **Heavy** armor." — and `unarmored` — "while you aren\'t wearing armor **or wielding a Shield**." — each read off the sheet\'s two slots on every read. SRD Defense asks the opposite question, "While you\'re wearing armor, you gain a +1 bonus to Armor Class", and the Fighting Style feat that prints it says so in its own note: the arithmetic is a standing flat bonus applying to `ac` that magic armour already uses, and what is missing is the clause that would gate it. Gate G1 is where it was found, because the feats were in no population and nothing read that note.',
  'a-roll-mode-a-feature-takes-away':
    'a mode **cancelled** rather than granted. packages/engine/src/roll-modifiers.ts builds the axis as presence — "The mode is not part of the identity" — and `combineRollModes` weighs Advantage against Disadvantage — and SRD Elusive says something else again: no attack roll may **have** Advantage against you at all, which is neither a grant of Disadvantage nor a cancellation the vocabulary can express.',
  'a-turn-boundary-payout-a-feature-owes':
    'a feature that pays out at the start or the end of a turn. The queue is real and it is a casting\'s: `docs/design/time-and-turns.md` says "Raising is derived; rolling is commanded ... `turn-advanced` *raises* the saves the boundary owes", and every debt it raises belongs to an ongoing spell. A Champion who regenerates at the start of each of their turns and a Monk who sheds a condition at the end of theirs have nothing in that queue.',
  'temporary-hit-points-a-feature-grants':
    'Temporary Hit Points a feature pays at a *moment*. The state is real — `Vitals.temporaryHp` — and a feature writes it now: an allowance carries `temporaryHitPoints` in packages/engine/src/standing.ts and pays it the moment its price is taken, which is SRD Adrenaline Rush. What SRD Dark One’s Blessing prints is the same number at a moment no feature route opens — "when you reduce an enemy to 0 Hit Points" — and a kill is an outcome of damage rather than a price anybody takes.',
  'heroic-inspiration':
    'Heroic Inspiration regained by a feature mid-fight. The resource itself exists now: a pool of one on the sheet, `human:heroic-inspiration`, which a `reaction` grant declares, a Long Rest refills and the `test-rolled` window spends on a failed ability check or saving throw. What a feature that grants it in combat still has nothing for is the **grant**: SRD Heroic Warrior refills it at the start of each of the holder’s turns, and `recovers` — the field on a pool in packages/engine/src/progression.ts — knows a Short Rest and a Long Rest and no turn boundary.',
  'a-rule-the-engine-fixes-for-everybody':
    'a constant the engine applies to every creature, which one feature is meant to bend. A Long Rest is eight hours, an attunement limit is a number inside a command, and the concealment a Hide asks for is a test inside `takeHide`. `docs/design/characters-and-equipment.md` keeps the list of what the attunement rules still owe — "what ends attunement besides a command — death, losing the item, another creature attuning to it" — and every one of these is that same shape: a rule the engine holds rather than the sheet, so a trait bending it for its holder alone has nothing to bend. **Two of these used to be named here and are not any more**, in both directions. The objects batch built the Carrying Capacity table, and a `carrying-capacity` grant now moves which row of it a creature reads, which is what SRD Powerful Build walks through. And moving through an occupied space, which wanted two sizes of difference for everybody, is now read off the route a move states: a `passage` grant lowers the two sizes for its holder alone, which is what SRD Halfling Nimbleness walks through.',
  'a-spell-list-that-is-not-your-class-list':
    'a spell known or prepared from **another class\'s** list. `checkContent` refuses a fixed grant naming nothing and creation checks every chosen spell against the list of the class that is choosing it, which is right for eleven classes and wrong for the two features the SRD writes the exception on. `docs/design/content.md` states what a class list is for — "`spellEntry(id)` — the spell\'s identity and class lists (the SRD index shape)" — and there is no second list a feature may widen it to.',
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
 * could write today and nobody has: Open Hand Technique's Topple, Steady Aim's
 * Speed of 0, the mark Precise Hunter reads. Both are
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
  'barbarian:instinctive-pounce': [
    {
      clause: 'no feature hands its holder a move that costs nothing out of the turn’s allowance',
      why: 'a-move-a-feature-hands-its-holder',
      note: 'the whole of it, now that Rage is an activated feature a requirement can read.',
    },
  ],
  'barbarian:brutal-strike': [
    {
      clause: 'Reckless Attack is a stance a requirement can read now',
      why: 'expressible',
      note: 'recorded because the note used to claim the opposite: the feature this one is written on top of is built, so what is left is the three clauses below.',
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
      why: 'a-second-question-one-feature-asks',
      note: 'the gate landed and this did not: a spells grant gated on Thaumaturge is expressible now, and which cantrip is a second question this feature has no room for — it has already asked which order.',
    },
    {
      clause: 'That is a standing check bonus gated on the option chosen',
      why: 'expressible',
      note: 'the half that is applied: `check-bonus` sizes a bonus by a modifier on the holder’s own sheet, over the skills the feature names.',
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
  'life-domain:blessed-healer': [
    {
      clause: 'The caster healing themselves when they heal somebody else',
      why: 'healing-modified-by-an-effect',
      note: 'healing that fires because other healing happened, which is untouched by the rules a running effect may now state about healing: those change what a heal restores, and this one is a second heal with a different recipient.',
    },
  ],
  'life-domain:supreme-healing': [
    {
      clause: 'Maximising healing dice rather than rolling them',
      why: 'healing-modified-by-an-effect',
      note: 'the reader is built and the door is not. `maximised` is a `HealingRule` the healing path reads on every roll, and SRD Beacon of Hope hangs one — but the only things that can hang one are a spell effect and a rider on a settled outcome, and this is a feature. What it needs is a `FeatureGrant` that states the rule, which is the same absence the two hit point maximum features below carry one axis over.',
    },
  ],

  // — Druid —
  /**
   * The first of the four bare pools, and the reason the population widened.
   *
   * It declares `engine` truthfully — the uses are counted, sized off the Wild
   * Shape column and refilled by both rests — and the feature is *becoming a
   * Beast*, which nothing does.
   */
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
      why: 'a-second-question-one-feature-asks',
      note: 'as Thaumaturge, and for the same reason on a second class: the gate exists and the second question does not.',
    },
    {
      clause: 'That is a standing check bonus gated on the option chosen',
      why: 'expressible',
      note: 'the half that is applied, off the same `check-bonus` Thaumaturge’s reads — two writers, which is what made it a member.',
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

  // — Fighter —
  'fighter:fighting-style': [
    {
      clause: 'Defense is the one left',
      why: 'table',
      note: 'three of the four feats are executed now and the fourth is its own feat’s debt; recording and validating the choice is all this feature ever claimed, and that has not changed.',
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
      note: 'whatever the first one does, exactly as the Fighter’s own is.',
    },
  ],
  'champion:heroic-warrior': [
    {
      clause: 'regaining it at the start of each of your turns in combat is not modelled',
      why: 'heroic-inspiration',
      note: 'the pool exists and a Long Rest refills it; a turn boundary refilling it is the half nothing runs.',
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
  /**
   * The pool that buys one of the three things its page prints.
   *
   * Not a bare pool — Focus Points really do buy Flurry of Blows — which is
   * why it is declared in {@link POOLS_ONLY_PARTLY_BOUGHT} rather than
   * derived: how many options the book offers is a fact about the page and
   * the grant says only what it holds.
   */
  'monk:focus': [
    {
      clause: 'each is an action taken out of a cheaper slot, which the vocabulary can say',
      why: 'expressible',
      note: 'the same `action-rule` a Rogue’s Cunning Action is written through; Disengage, Dodge and Dash out of a Bonus Action is a sentence the catalogue can already write.',
    },
    {
      clause: 'at a price in points, which it cannot',
      why: 'a-resource-traded-for-another',
      note: 'a purchase buys an extra action or extra attacks and there is no member for buying an action rule, so a Focus Point cannot be charged for the cheaper slot the vocabulary can otherwise state.',
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
      note: 'three Unarmed Strikes instead of two. The two are bought now — a Focus Point and a Bonus Action buy attacks the Attack action does not hold — and what is left is the count: a later feature rewriting an earlier one’s printed number, which is `recoversSooner`’s sentence asked of a purchase rather than of a recovery.',
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
      why: 'expressible',
      note: 'a flat minute is an activation’s `lastsSeconds` now, scheduled on the clock; what this feature still lacks is the activation to hang it on, because it costs three Focus Points at once where an activation spends exactly one use.',
    },
    {
      clause: 'defences are declared once and do not change',
      why: 'a-resource-traded-for-another',
      note: 'and it costs three Focus Points at once, where an activation spends exactly one use.',
    },
  ],
  'open-hand:technique': [
    {
      clause: 'Flurry of Blows is not modelled',
      why: 'an-attack-the-class-redefines',
      note: 'the attack the three effects ride on, and the whole of what is left of the trigger: a hit buys an effect list now, and nothing can tell a Flurry’s hit from any other punch.',
    },
    {
      clause: 'Topple is a Dexterity save with Prone on a failure and would be data',
      why: 'expressible',
      note: 'one of the three effects, and the one the rider host would execute today.',
    },
    {
      clause: 'Push moves the target fifteen feet',
      why: 'forced-movement-a-spell-causes',
      note: 'the same `moveCreature` with `forced: true` that no spell effect reaches either.',
    },
    {
      clause: 'Addle stops its Opportunity Attacks',
      why: 'an-action-a-spell-compels-or-forbids',
      note: 'an action forbidden to somebody else, which is the action economy answering to a feature.',
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
  /**
   * A bare pool, and the one of the four whose debt is smallest.
   *
   * SRD gives this pool exactly one effect at level 3 — Divine Sense — and
   * the subclass options that join it are features of their own with entries
   * of their own.
   */
  'paladin:channel-divinity': [
    {
      clause: 'What each use buys is not executed',
      why: 'a-declared-fact-a-feature-sets',
      note: 'SRD Divine Sense: "you know the location of any creature of those types within 60 feet of yourself" — awareness of a filtered set of creatures for ten minutes, which is the declared fact a DM writes today and a feature cannot.',
    },
  ],
  'paladin:fighting-style': [
    {
      clause: 'The other two of the four are still a note rather than a grant',
      why: 'table',
      note: 'the two unbuilt feats’ own debt, exactly as the Fighter’s Fighting Style is.',
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
      clause: 'reaches every Melee weapon the Paladin swings for the ten minutes rather than the one object they imbued',
      why: 'a-rider-on-a-later-weapon-attack',
      note: 'SRD: "imbue **one** Melee weapon that you are holding". The ability-sized number lands now and lands more widely than the book prints it: a standing grant is hung on a creature and narrows by a *kind* of weapon, and the one record in the engine keyed to a particular object is `GrantedWeaponRider` — which only a casting writes. The same gap that shape is named for, arriving at a feature instead of at a spell.',
    },
    {
      clause: 'The Attack action the SRD attaches the imbuing to is not a cost this vocabulary can name',
      why: 'an-attack-the-class-redefines',
      note: 'SRD: "**When you take the Attack action**, you can expend one use of your Channel Divinity." An activation costs an action, a Bonus Action or nothing, and this one is attached to an action its holder is already taking — the action-economy half of that shape, beside the breath weapon put in an Attack action’s place. `none` is the nearest of the three and it lets the Paladin imbue at a moment the book does not.',
    },
    {
      clause: 'needs a fact about whose hand an object is in',
      why: 'a-casting-ended-by-a-trigger',
      note: 'SRD: "This effect also ends if you aren’t carrying the weapon." That shape’s own description names letting go of an object among the causes with no member, and names Shillelagh for it; this is the same sentence on a feature’s activation, where the vocabulary is `ActivationEnd` rather than `endsEarly` and is just as short of it.',
    },
    {
      clause: 'a damage type the holder chooses on each hit',
      why: 'an-attack-the-class-redefines',
      note: 'SRD: "each time you hit with it, you cause it to deal its normal damage type or Radiant damage." That shape’s own description names a damage type chosen on each hit as one of the two halves of it still unbuilt, and this is the feature that prints it; Shillelagh prints the same sentence from the spell side.',
    },
    {
      clause: 'The Bright Light in a 20-foot radius is fiction',
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
      why: 'expressible',
      note: 'a printed span is an activation’s `lastsSeconds` now; what this feature still lacks is the activation to hang it on, whose use a trade buys back and whose benefits are the three clauses above.',
    },
  ],

  // — Ranger —
  'ranger:fighting-style': [
    {
      clause: 'The other two of the four are still a note rather than a grant',
      why: 'table',
      note: 'the two unbuilt feats’ own debt, exactly as the Fighter’s Fighting Style is.',
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
  'rogue:cunning-strike': [
    {
      clause: 'spending some of those dice as a price',
      why: 'a-resource-traded-for-another',
      note: 'Sneak Attack dice as currency, which is the trade shape on something that is not a pool.',
    },
    {
      clause: 'a saving throw the feature forces',
      why: 'expressible',
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
      why: 'expressible',
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
  'thief:supreme-sneak': [
    {
      clause: 'which needs the same trade of Sneak Attack dice every Cunning Strike option needs',
      why: 'a-resource-traded-for-another',
      note: 'inherited from Cunning Strike, and the whole of what is left now that the Hide action is taken: the option is bought with a die this feature has no way to spend.',
    },
    {
      clause: 'the engine ends that condition on no attack at all',
      why: 'table',
      note: 'the exception has nothing to except. SRD ends a Hide when its holder attacks, makes a sound, casts or is found, and all four are moments the table narrates — so the condition is lifted by whoever narrates one, and an exception to an ending nobody automates is the table\u2019s too.',
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
      clause: 'the +1 to spell save DC and Advantage on spell attacks',
      why: 'a-bonus-to-spell-attack-rolls',
      note: 'the item map’s own id, whose description already names the save DC beside the attack roll.',
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
      note: 'the other: the shape’s own line is that "nothing stands between the caster’s sheet and that pinning", and the type a casting pins is one of the things nothing stands between — the built member rewrites the range, the duration, the action and the level. A feature may print the choice over **its own option’s** effects, which `PoolOption.damageTypeStated` does and `statedTypeFor` reads; what none may do is hand the caster one over a spell whose definition printed none. The arm that would say it belongs to `CastingDamageAlteration`, beside the four that alter what a casting deals — this shape is where the clause is blocked, not where the member would go.',
    },
  ],
  'sorcerer:sorcery-incarnate': [
    {
      clause: 'Using two Metamagic options on one spell',
      why: 'a-feature-that-rewrites-another-features-rule',
      note: 'a later feature lifting an earlier one’s limit.',
    },
  ],
  'sorcerer:arcane-apotheosis': [
    {
      clause: 'The free Metamagic option during Innate Sorcery',
      why: 'a-feature-that-rewrites-another-features-rule',
      note: 'a capstone changing what an earlier feature costs while a third is running.',
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
      why: 'a-second-question-one-feature-asks',
      note: 'four grants on one feature is expressible now, and four questions is not: the spell is the player’s at each of the four levels, and a feature asks one thing when it is gained.',
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
  ],
  'elf:elven-lineage': [
    {
      clause: 'is an option re-chosen on a rest',
      why: 'an-option-re-chosen-on-a-rest',
      note: 'the High Elf alone: every other clause of every lineage is applied, and what is left is a cantrip swapped for another one whenever the Elf finishes a Long Rest, which nothing rewires a compiled grant for.',
    },
  ],
  'gnome:gnomish-lineage': [
    {
      clause: 'an object with its own Armour Class, hit point and Bonus Action that nothing in the engine creates',
      why: 'an-object-with-statistics-of-its-own',
      note: 'the Rock Gnome’s clockwork device, which is the spell map’s own id: a thing with an Armour Class and a Hit Point that is not a creature.',
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
      why: 'expressible',
      note: 'the clause names the trigger, which is the half with no shape: hanging Prone is what a pool option already does.',
    },
    {
      clause: 'Storm\'s Thunder, which deals damage back rather than reducing it',
      why: 'a-reaction-effect-the-vocabulary-lacks',
      note: 'Superior Hunter’s Defense wants a fifth member and this wants a sixth, which is what makes it a shape.',
    },
  ],
  // — the feats, which no population had until gate G1 ————————————————————
  //
  // `allFeatures` walked classes, subclasses, species and backgrounds and
  // never `SRD_CONTENT.feats`, so sixteen feats — nine of them in a level 1–5
  // character's reach — were in no map, no row and no guard. A `FeatDefinition`
  // has no `automation` flag to select on, which is why the three below are
  // declared in {@link FEATS_ANSWERED_FOR} rather than derived; what is *not*
  // declared is whether each is a debt, because each says so in its own note
  // and the clauses here are anchored in it exactly as a feature's are.
  defense: [
    {
      clause: 'The +1 to Armour Class is not applied',
      why: 'a-requirement-on-the-armour-its-holder-is-wearing',
      note: 'one clause short: the arithmetic is a standing flat bonus applying to `ac` that magic armour already uses, and a feat carries a standing grant now — Archery and Great Weapon Fighting beside it are declared that way and are applied.',
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

/** The first population: every feature that declares it is not executed. */
export const manualFeatureIds = (): readonly string[] =>
  allFeatures()
    .filter((feature) => feature.automation === 'manual')
    .map((feature) => feature.id)
    .sort();

/**
 * Every member of a `pool` grant that says what a use **buys**.
 *
 * Read off `progression.ts`'s pool member, where the rest of the fields say
 * how big the pool is (`usesByLevel`, `fromAbilityModifier`, `perClassLevel`,
 * `uses`, `usesRolled`, `minimum`) and when it comes back (`recovers`,
 * `regainsOnShortRest`, `regainsAtDawn`, `recoversSooner`). A pool declaring
 * none of these five is a resource the engine counts and nothing spends.
 *
 * Exported so the guard can drive {@link isBarePool} with each of them in
 * turn: a member added to the grant and not added here would silently make a
 * new pool read as bare.
 */
export const POOL_SPENDING_MEMBERS = [
  'buysBudget',
  'confersReaction',
  'heals',
  'options',
  'touchHeals',
] as const;

/**
 * A pool grant with nothing to spend a use on.
 *
 * The derived half of the second population. It is a **shape** rather than an
 * opinion — the grant either says what a use buys or it does not — which is
 * what lets four features join the map with no list to keep.
 */
export const isBarePool = (feature: FeatureDefinition): boolean => {
  const grants = featureGrants(feature);
  const pools = grants.filter((grant) => grant.kind === 'pool');
  if (pools.length === 0) return false;
  return pools.every(
    (grant) =>
      POOL_SPENDING_MEMBERS.every(
        (member) => (grant as unknown as Record<string, unknown>)[member] === undefined,
      ) && !allowanceSpends(grants, grant.key),
  );
};

/**
 * Whether a sibling grant's allowance spends the pool — SRD Adrenaline Rush,
 * whose `pool` grant says nothing a use buys because the buying is on the
 * `action-rule` beside it: a Dash bought out of a Bonus Action spends one.
 * The second way a pool grant is not bare, and the one that is not a member
 * of the grant itself.
 */
const allowanceSpends = (grants: readonly GatedFeatureGrant[], key: string): boolean =>
  grants.some((grant) => {
    const effects =
      grant.kind === 'standing'
        ? (grant.effects ?? [])
        : grant.kind === 'activated'
          ? (grant.whileActive ?? [])
          : [];
    return effects.some((effect) => effect.kind === 'action-rule' && effect.spends === key);
  });

/**
 * The second population: `engine` features whose pool buys nothing.
 *
 * **The map could not see these and their whole point is unbuilt.** Each
 * declares `engine` truthfully — the uses are counted, sized off the class
 * table and refilled by the right rest — and each is a feature whose *effect*
 * nobody has written: Wild Shape's Beast form, a Paladin's Divine Sense.
 * Selecting the map by `automation === 'manual'` hid all four, because the
 * flag answers "does the engine apply what this declares" and these declare
 * only a pool.
 *
 * **Two of the original four have left, and the way they left is the check
 * working.** Font of Magic's conversion and Arcane Recovery's chosen slots
 * were built as `trade` grants, and a trade is not a `pool` grant — so the
 * derivation drops them with nothing to delete here, which is what a derived
 * population is for. The blocked-on entries they carried had to go by hand,
 * and {@link featureCoverageGaps} named both as `stale` until they did.
 *
 * Manual features are excluded: one of those is already in the first
 * population, and a feature counted twice would be a second answer to one
 * question.
 */
export const barePoolFeatureIds = (): readonly string[] =>
  allFeatures()
    .filter((feature) => feature.automation === 'engine' && isBarePool(feature))
    .map((feature) => feature.id)
    .sort();

/**
 * The third population, declared: pools that buy **some** of what the book
 * prints.
 *
 * **This one cannot be derived and saying why is the point.** A grant states
 * what it offers and never what its page left out, so nothing in the
 * catalogue knows SRD spends a Focus Point three ways and that the engine
 * executes one of them. The only query available would be a regex over the
 * note — over the 194 engine features it catches 22, most of them features
 * whose note merely mentions the table — which is a classifier wearing a
 * derivation's clothes, the failure `missing-shapes.ts` keeps a record of.
 *
 * So it is a list, and it is held down at both ends: every id must be an
 * engine pool that {@link isBarePool} does **not** already find, and must
 * carry an entry whose clauses anchor in its own note, which is the same
 * discipline every other line in this map is written under.
 */
export const POOLS_ONLY_PARTLY_BOUGHT: readonly string[] = ['monk:focus'];

/**
 * The fourth arm: **feats**, which had no population at all until gate G1.
 *
 * {@link allFeatures} walks classes, subclasses, species and backgrounds and
 * never `SRD_CONTENT.feats`, so sixteen feats — nine of them a level 1–5
 * character can take — were in no map, no ledger row and no guard. It cost
 * nothing the day it was written and would have cost silently the first time
 * a feat printed something the engine did not do. It does now: three of the
 * nine say in their own notes that a printed half is unapplied.
 *
 * **This one cannot be derived either, and the reason is different from the
 * pools'.** A `FeatDefinition` carries no `automation` flag — the field does
 * not exist on the type — so there is nothing to select on, and the only
 * available query would be a regex over the note, which is the classifier
 * wearing a derivation's clothes that this file keeps a record of. So it is a
 * list, held down at both ends in **two** places, exactly as
 * {@link POOLS_ONLY_PARTLY_BOUGHT} is. `pool-blockers.test.ts` owns the arm:
 * every id must be a feat the catalogue holds, in a level 1–5 character's
 * reach, whose clauses anchor in its own note — and the complement, the six
 * feats in reach this list does **not** answer for, is pinned by name so a
 * feat joining or leaving has to be somebody's reading.
 * `blocked-on-features.test.ts` owns the map-wide half, which every entry is
 * held to whatever population it came from: a line for something outside the
 * population is `stale`, a member with no line is `unrecorded`, and every
 * clause anchors in its own note exactly once.
 */
export const FEATS_ANSWERED_FOR: readonly string[] = ['defense'];

/**
 * The whole population this map answers for: the three arms together.
 *
 * {@link featureCoverageGaps} reads this rather than the manual list alone,
 * which is what makes an entry for an `engine` pool possible at all — before
 * the widening, a line for one was `stale` by definition and the four could
 * not have been recorded even by somebody who had read them.
 */
export const ledgerFeatureIds = (): readonly string[] =>
  [
    ...new Set([
      ...manualFeatureIds(),
      ...barePoolFeatureIds(),
      ...POOLS_ONLY_PARTLY_BOUGHT,
      ...FEATS_ANSWERED_FOR,
    ]),
  ].sort();

let notes: Map<string, string> | undefined;

/**
 * The note a feature carries, which is the document its clauses are held to.
 *
 * **Feats are read here too**, and they are the only thing in this file that
 * is not a `FeatureDefinition`. A feat has no `automation` flag and no level
 * of its own, so it cannot join {@link allFeatures} — but it carries the same
 * field for the same purpose, "What a DM still has to apply", and an entry
 * about a feat has to anchor in something. One map, so a clause cannot be
 * written about a note the catalogue does not print.
 */
export const featureNoteOf = (featureId: string): string => {
  notes ??= new Map([
    ...allFeatures().map((feature) => [feature.id, feature.note] as const),
    ...SRD_CONTENT.feats.map((feat) => [feat.id, feat.note] as const),
  ]);
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
 * `unrecorded` is a member of the population with no line — a feature
 * somebody wrote a note for and nobody adjudicated. `stale` is a line for a
 * feature that has left the population, which after a conversion lands is the
 * other half of the same drift.
 *
 * The population is {@link ledgerFeatureIds} rather than the manual list: a
 * bare pool declares `engine` and is still a debt, and while the default was
 * the manual list alone a line for one of those four read as `stale`, so the
 * map could not have recorded them even if somebody had read them.
 *
 * Parameterised over the population for {@link itemCoverageGaps}'s reason: a
 * guard that can only be run against the data it already agrees with is not a
 * guard, so the tests drive it with a synthetic feature nobody has read and a
 * synthetic conversion that must make a line stale.
 */
export const featureCoverageGaps = (
  population: readonly string[] = ledgerFeatureIds(),
  blockedOn: Readonly<Record<string, unknown>> = FEATURE_BLOCKED_ON,
): { readonly unrecorded: readonly string[]; readonly stale: readonly string[] } => {
  const open = new Set(population);
  return {
    unrecorded: [...open].filter((id) => blockedOn[id] === undefined).sort(),
    stale: Object.keys(blockedOn)
      .filter((id) => !open.has(id))
      .sort(),
  };
};

export interface FeatureShapeConsumers {
  readonly shape: FeatureBlockerId;
  /** Features of the population this shape blocks. */
  readonly blocks: readonly string[];
  /** The features it is the **only** blocker for: building it finishes exactly these. */
  readonly finishes: readonly string[];
}

const sorted = (ids: Iterable<string>): readonly string[] => [...new Set(ids)].sort();

/** How many features of the population a shape blocks, and which. */
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
 * Features of the population that name no missing mechanic at all.
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
 * Features whose every clause is the table's — finished business.
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
