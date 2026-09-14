/**
 * The missing-shape vocabulary, and every spell blocked on it — derived.
 *
 * **Three documents ranked the same family and disagreed by four times.**
 * `PROGRESS.md`'s map said a granted Resistance was 17 open spells, the
 * leverage audit said 4, and the SRD text supports 2 whole and 1 partial. None
 * of the three was derived, so every tranche planned from them inherited the
 * error — which is the fourth whole-engine audit's fourth finding and the
 * reason this file exists.
 *
 * `PARTIAL_SPELLS` stopped being a hand list when it became a consequence of
 * the adjudication map. This is the other half of that derivation: the
 * **undefined** population's blockers, which IE-002 wrote out spell by spell in
 * prose, as data over the same vocabulary. A shape's consumer count is then a
 * query — {@link consumersOf} — rather than somebody's estimate.
 *
 * ### What lives here, and what does not
 *
 * The rule is **what the query reads**. `ADJUDICATED` and `BLOCKED_ON` are both
 * populations the query counts, so both are here; `MECHANICAL_MARKERS` is here
 * only because it types the tracked map's keys. {@link CLAUSE_MARKERS} was
 * `spell-honesty.test.ts`'s, on the stated grounds that nothing but that guard
 * read it — and that stopped being true the day the query needed to know
 * whether a spell's paragraph had been read sentence by sentence. It is the
 * same rule pointed at a second population, so it is one list rather than two
 * spelled alike, and that guard imports it.
 *
 * This is not a test file, for the same reason `PARTIAL_SPELLS` is not:
 * `npm run coverage` runs outside vitest, and a report generator that imported
 * the test suite would have the dependency backwards.
 *
 * ### Three populations, three maps, and why they are three
 *
 * | | Map | What an entry means |
 * |---|---|---|
 * | executed | {@link ADJUDICATED} | a definition the engine drives, carrying a clause it does not finish |
 * | tracked | {@link TRACKED_ADJUDICATED} | a definition the engine casts and resolves nothing of |
 * | undefined | {@link BLOCKED_ON} | a parsed spell with no definition at all |
 *
 * Each keeps its own "no shape sits here unclaimed" guard, in its own test.
 * Merging them would mean one population's guard passing on another's claim,
 * which is how a shape stays in a map after the last spell needing it has
 * moved. The **query** unions them, because a shape is worth building for what
 * it unblocks everywhere.
 *
 * ### Two numbers, not one, and the difference is the whole finding
 *
 * `blocks` counts every spell whose entry names a shape; `unblocks` counts the
 * spells for which it is the **only** blocker — the ones building it would
 * finish. A granted defence *finishes* exactly two, Stoneskin and Mind Blank,
 * and *touches* several times that many; reporting only the second number is
 * how 17, 4 and 2 came to be three answers to one question.
 *
 * **Both numbers are the table's to print, not this docstring's.** Neither is
 * written down here, because a per-shape count in prose that nothing
 * regenerates is precisely the thing this file exists to end —
 * `COVERAGE.md`'s "What blocks the rest" prints both for every shape, and
 * `blocked-on.test.ts` pins the pair the audit re-derived.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SPELL_DEFINITIONS } from '../src/spell-definitions.js';

/**
 * The mechanical shapes that stand between an SRD spell and a finished one.
 *
 * Every id names a gap this repository has already described — in `CLAUDE.md`,
 * in `PROGRESS.md`'s ranked maps, in the audit that asked for this map, or in
 * the definition's own clause in `spell-definitions.ts` — and the description
 * says **which**, because a shape invented here would be an architecture
 * decision smuggled in as a note. A test holds that in both directions: a
 * description naming no source fails, and a shape nothing claims is removed.
 *
 * **Three bundle ids are gone and their consumers re-filed.** The fourth audit
 * found that `outcome-scoped-child-effects`, `a-mode-on-the-save-a-spell-forces`
 * and `a-repeat-save-beyond-the-turn-hook` were not shapes but bundles — the
 * last "four mechanisms with consumer counts of one to three each, not a shape
 * with eight". IE-010 removed the first when the rider vocabulary it named was
 * built. The other two are split here, and {@link SPLIT_BUNDLES} records what
 * each bundle claimed so the arithmetic can be checked.
 *
 * **One id was deliberately the same string `spell-tracking.test.ts` used for
 * the same gap** — `speed-and-movement-modes` — and that is no longer a
 * duplication: the tracked vocabulary below names it by importing this one,
 * so the three populations share one description and the query can add them up.
 * That id is gone; {@link SPLIT_BUNDLES} records what it held.
 */
export const MISSING_SHAPES = {
  'an-outcome-of-a-spells-own-damage':
    'a third outcome axis, after the saving throw and after the damage: the target reaching 0 Hit Points **because of this spell**. The audit that asked for outcome riders separates it from them by name — a rider rides the roll its host made, and this rides a number the engine went on to compute — and CLAUDE.md’s "Transitions Are Engine-Owned Batches" is where dropping to 0 is already an engine-owned consequence with nowhere for a spell to hang one.',
  'a-repeat-save-on-the-clock':
    'a repeat save raised by elapsed time rather than by a turn boundary. `RepeatSave` names `start-of-turn` or `end-of-turn` and nothing else, and `Deadline` can already express the span — CLAUDE.md, "Durations Are Two Different Things", has both halves and no way to put them together. One of the four mechanisms the audit found bundled under `a-repeat-save-beyond-the-turn-hook`.',
  'a-repeat-save-counted-to-a-tally':
    'a repeat save carrying a running count of successes and failures — the death-save shape rather than the repeat-save one, and CLAUDE.md records that `rollDeathSave` is its own thing for exactly that reason. `RepeatSave` holds no tally. The second of the four mechanisms the audit found bundled under `a-repeat-save-beyond-the-turn-hook`.',
  'a-repeat-save-that-does-something-on-a-failure':
    'a repeat save whose **failure** branch acts. `RepeatSave.onSuccess` releases an effect and the failure does nothing at all, so a boundary save that deals damage or deepens a condition has nowhere to put it. The audit names the damage half — "damage on a failure (Phantasmal Killer, Weird)" — as the third of the four mechanisms bundled under `a-repeat-save-beyond-the-turn-hook`; PROGRESS.md names it for Ensnaring Strike.',
  'a-repeat-save-raised-by-a-trigger':
    'a repeat save raised by something that happened — taking damage, having moved, coming within a distance, another effect trying to cure it. The turn hook is the only thing that raises one, which CLAUDE.md states outright: "Raising is derived; rolling is commanded ... `turn-advanced` *raises* the saves the boundary owes". The fourth of the four mechanisms the audit found bundled under `a-repeat-save-beyond-the-turn-hook`.',
  'a-casting-ended-by-a-trigger':
    'a casting ends by its deadline, by Concentration, by a dispel or by a recast — CLAUDE.md, "Lifecycle, and the one place it ends". IE-032 built the fifth way for **five** transcribed causes: the target attacks, deals damage or casts, the target dons armour, and the caster or an ally damages the target. What is left is every cause whose fact no consequence event holds and every consequence the two scopes cannot express — **any** damage from anybody (Modify Memory, Sleep, Sequester, Phantom Steed, Project Image, Eyebite), a distance two creatures drift apart (Faithful Hound, Warding Bond, Antilife Shell), a running total dealt (Guardian of Faith), a condition the caster chooses at the casting (Sequester), letting go of an object (Shillelagh), leaving an area (Tiny Hut), dropping to 0 Hit Points (Gaseous Form, Warding Bond), another spell ending this one (Geas, Contact Other Plane), a Temporary Hit Point total running out (Polymorph), the target dying (True Polymorph), and ending **one effect** of a casting rather than the casting (Mislead, whose double outlives its invisibility).',
  'a-mode-on-the-save-a-spell-forces':
    'CLAUDE.md: "nothing records what a save was against" — the sentence that already blocks Countercharm. A `RollModifier` selects a roll by family, ability and skill, so there is no way to select the saving throws an effect from a Fiend forces. **Re-described rather than kept**: the audit found this id claimed by six clauses whose real blockers were three different things, and that the description misstated its own. What is left is the clause that genuinely needs a save to remember its provenance.',
  'a-fact-only-the-table-can-declare':
    'a fact the engine does not hold and cannot derive, which a rule then reads — how well you know a creature, whether you are outdoors in a storm, whether you are fighting it. Declared cover, declared sight and declared allegiance are the discipline CLAUDE.md already draws for this; the audit (§4) is where these clauses were found filed as a selector problem when what they want is the fact. **IE-030 built the fought fact and this is what it left**: `CastSpellRequest.fought` carries it and the five spells that read it as Advantage are finished, while SRD Enthrall reads the same fact as "Any creature you or your companions are fighting automatically succeeds on this save" — an outcome `checks.ts` has no `autoSucceed` for, beside `autoFail`, and which no definition could write until it does.',
  'a-bonus-narrowed-to-a-skill':
    'a bonus or penalty that reaches one **skill** rather than the whole family, and reaches Passive Perception. CLAUDE.md names the axis and its whole membership — "covers attacks, saves and ability checks — all rolls" and now an Armour Class — and a skill is not a member, so SRD Enthrall’s "a −10 penalty to Wisdom (Perception) checks and Passive Perception" would land on every ability check the target ever makes. `passivePerception` reads the sheet and no stored bonus at all, so the second half has no reader whatever. The narrower residue of the fought fact IE-030 built, and the reason Enthrall is not finished by it.',
  'an-automatic-success-by-creature-type':
    'IE-019 built `TypedSaveOutcome`, and spell-definitions.ts says exactly how far: "Two consumers, and they are the two shapes the SRD prints — Blight’s automatic failure and Shatter’s Disadvantage." The book prints a third, and one spell writes it: an automatic **success**. A two-member union missing its third member is a narrower gap than the family it came out of, and is what is left of it on this axis.',
  'a-filter-on-the-attackers-creature-type':
    'CLAUDE.md names it verbatim, with its consumers: "A filter on the *attacker’s* creature type | Protection from Evil and Good, Dispel Evil and Good, Magic Circle", in the table of what the roll-modifier vocabulary deliberately does not reach. IE-019 gave a **saving throw** an outcome that varies by the target’s type; a `RollSelector` still has no type axis at either end.',
  'a-creature-type-predicate-an-area-reads':
    'an area or a trigger that catches only named creature types. `designatesUnaffected` is the one filter an area has and it is explicit ids chosen once — CLAUDE.md: "Designating creatures unaffected is a choice, and never allegiance ... it is **explicit**, because a cleric may spare an enemy and may decline to spare an ally." A predicate over a *type* is a different question, and IE-019 answered it for an outcome rather than for who is caught.',
  'a-condition-immunity-a-spell-grants':
    'IE-017 built the damage half of a granted defence and not this one. CLAUDE.md keeps the two apart everywhere else — "A stat block prints damage types and conditions in one run ... one damage type and two conditions, **which the engine treats completely differently**" — and the build followed that line: `CreatureState.defenses` gained a third input and `conditionApplicability` gained none, so an Immunity to the Charmed condition has nowhere to live. That split is also why this file’s own prediction missed Mind Blank, because the retired description claimed condition immunity was "the same storage and the same sentence shape". The storage was different, and the build proved it.',
  'an-outcome-that-reads-the-targets-defences':
    'a defence the target already has, read as an input to something other than damage. CLAUDE.md: "**A creature’s defences are state, and damage reads them**" — `applyDamage` is the only reader, so a save a creature automatically makes because it is immune to a condition has nothing to consult.',
  'an-outcome-that-reads-the-targets-hit-points':
    'a threshold on the target’s current Hit Points, read before anything is rolled. PROGRESS.md ranks it: "Reads the target’s current Hit Points | 0 / 4 | vitals". The vitals are there and no effect asks them a question.',
  'a-target-rule-the-format-cannot-state':
    '`TargetRule` in spell-definitions.ts selects by creature type and by whether armour is worn, and by nothing else. The SRD also selects by **size**, by **Challenge Rating** and by an **ability score**, and shapes outcomes by the same three facts. Size is held and CLAUDE.md records the only rules that read it — sharing a space, passing through, and the volume a template tests; an ability score is held and read by nothing here; a Challenge Rating is not held at all. One missing reader, three facts, and the description says which is which.',
  'a-creature-fact-an-effect-overrides':
    'an effect that changes what **other** rules believe about a creature. PROGRESS.md names it: "Arcanist’s Magic Aura changes what other spells believe a creature’s type to be, which `mustBeType` reads on every casting." Type and size are facts the engine holds authoritatively, and nothing may write over them for the duration of a spell. IE-044 read a third fact of the same shape off SRD Gaseous Form — "The target can enter and occupy the space of another creature", where what the other rule believes is that a creature holds its space against a willing mover.',
  'an-ability-score-a-spell-changes':
    'CLAUDE.md, on what a rest does not restore: "**Reduced ability scores and a reduced hit point maximum are not restored**, because neither is modelled in the first place." A score is set at creation and by advancement; no effect moves one, and nothing puts one back.',
  'a-stat-block-created-mid-fight':
    'summons. CLAUDE.md, "Which spells this reaches": "A stat block created mid-fight | Unseen Servant, Arcane Hand, Phantom Steed, Summon Dragon, Giant Insect ...". That row lost three entries to this reading — "the four Conjures", Guardian of Faith and Faithful Hound — because SRD 5.2.1 rewrote the Conjure family as spirits and none of the eight prints an Armour Class, Hit Points or a turn.',
  'movement-modes':
    'the Fly, Climb and Swim Speeds the engine does not distinguish, and the per-foot costs that ride with them. CLAUDE.md refuses the vocabulary by name: "**Movement modes are refused outright.** Fly, Climb and Swim have no reader — no rule in the engine asks about one — so a vocabulary for them would be shape built ahead of every mechanic that could use it", and Roving’s own note says the same of its Climb and Swim Speeds. What is left of `speed-and-movement-modes` once IE-033 built the modifier half.',
  'a-speed-an-effect-multiplies':
    'a Speed **doubled**. CLAUDE.md fixes both the operations a Speed is composed from and the order they compose in: "Halving is presence rather than count — the reading Resistance and Advantage already take. Zero is last and **wins**". SRD Haste prints the one operation that is neither — "the target’s Speed is doubled" — and is the only sentence in the book that does; the book gives no order for a doubling against a halving, so the member arrives with the rule that settles it. A two-member union missing its third is the shape `an-automatic-success-by-creature-type` already takes, on the other axis.',
  'a-standing-effect-derived-from-where-a-creature-stands':
    'a value derived from current state *and* current geometry rather than from a pair of enter-and-leave events that have to stay matched. CLAUDE.md: "A standing effect derived from where a creature is standing | Spirit Guardians’ halved Speed, every Paladin aura"; PROGRESS.md ranks it above automatic drift.',
  'healing-modified-by-an-effect':
    '`healCreature` rolls its dice and caps at the maximum, and nothing stands beside it to forbid the healing or to maximise it. The audit (§3.5) reads Chill Touch’s "can’t regain Hit Points" as a rule the engine owns; Beacon of Hope is the same sentence pushing the other way.',
  'a-flat-amount-with-no-dice':
    '`DiceScaling.dice` is required, so a spell that heals or harms by a printed number — or by the whole of the target’s maximum — rather than by a notation cannot say so. The audit names it while re-scoping condition removal: "Heal (needs flat-only healing — `DiceScaling.dice` is required, one-line format question)".',
  'an-exhaustion-level-a-spell-changes':
    'Exhaustion is a level rather than a condition that is simply on or off — CLAUDE.md: "**Exhaustion is a flat -2 per level, not Disadvantage**" — and `end-condition` takes a list of condition names, so it removes the condition and cannot remove *one level* of it. `setExhaustionLevel` is a DM-declared command, among the nine CLAUDE.md records as reachable from a command and from no spell effect.',
  'healing-that-raises-the-dead':
    'PROGRESS.md ranks "Healing that lifts a condition, **raises the dead**, or raises the maximum"; CLAUDE.md states the refusal it has to get past — "hit points alone will not raise the dead — `healCreature` refuses a corpse, and the refusal costs no slot".',
  'a-hit-point-maximum-a-spell-moves':
    'the maximum is set when a creature is added and by advancement, and no effect moves it. PROGRESS.md ranks "Healing that lifts a condition, raises the dead, or raises the maximum"; the audit names Harm’s reduction as debt.',
  'a-payout-at-a-turn-boundary':
    'damage, healing or Temporary Hit Points delivered at every turn boundary for the duration, with no save and no area to be standing in. CLAUDE.md names it among the mechanics the drained shapes left behind: "a Temporary Hit Point payout that repeats each turn (Heroism)". `pendingSaves` is raised at a boundary and pays nothing out.',
  'difficult-terrain-an-area-creates':
    'Difficult Terrain is charged exactly and **declared by the foot** on the move that crosses it (`MoveCommand.difficultFeet`). Deriving it from a spell’s area needs the path a move does not record — CLAUDE.md’s own named gap — so five executed areas are invisible to the ruler. The audit counts "three Difficult Terrain areas" among the clauses that are rules rather than fiction.',
  'an-area-that-moves-by-itself':
    'CLAUDE.md: "Cloudkill and Incendiary Cloud, blocked on automatic turn-start drift". PROGRESS.md says why it is not transcription: the move has to land before the start-of-turn clauses are determined, the direction is derived for one spell and chosen for the other, and a caster with no position has no "away from you" at all.',
  'an-area-trigger-on-the-casters-turn':
    '`AreaTrigger.at` in spell-definitions.ts transcribes the SRD’s two boundary clauses — "starts its turn there" and "ends its turn there" — and both are the **caught creature’s** turn. A storm that acts at the end of each of the *caster’s* turns is a third boundary, and the queue that raises area debt is keyed to the creature whose turn it is.',
  'a-one-shot-roll-modifier':
    'CLAUDE.md: "A one-shot mode is a different mechanic, not a short-lived one." Guiding Bolt’s "the **next** attack roll against it" and Vicious Mockery’s "the next attack roll it makes" need a modifier **consumed** by the roll it changes, and a durable grant applies until its casting ends.',
  'a-selector-for-every-d20-test':
    'CLAUDE.md: "**There is deliberately no member for “D20 Tests”.** Three SRD spells write the phrase — Foresight, Resurrection, Ray of Enfeeblement — and every one is blocked on something else". The absence is a decision rather than an oversight, and it is still what stands between these spells and a definition once their other blockers go.',
  'a-roll-result-an-effect-replaces':
    'a die whose result an effect overrides or throws again. CLAUDE.md has both halves for damage dice — "Substitute a value | Great Weapon Fighting: 1 or 2 counts as 3 | `treatLowRollsAs`" — and for a D20 Test only `rerollTest`, which is a Reaction a feature takes. No spell effect reaches either.',
  'a-die-behaviour-a-spell-asks-for':
    'CLAUDE.md’s "Dice Are Individually Addressable" table: `treatLowRollsAs`, `explodeOnMax` and `rerollDice` are built, tested, and named for the SRD sentences that want them — and no `SpellEffect` passes any of them, which is the recurring finding that a pure function nothing calls is a rule nothing enforces.',
  'a-reduction-an-effect-applies-to-damage':
    'CLAUDE.md: "`reduceDamage` takes its amount off the **total**, never off a component", and it is reachable only from `takeDamageReaction` — a Reaction a class feature spends. A standing effect that takes a rolled amount off every hit of a chosen type has no path to it.',
  'a-damage-penalty-a-spell-grants':
    'CLAUDE.md: "`BonusApplies` covers attacks, saves and ability checks — all rolls — and now `ac`". Damage is not a member, and a spell that makes a creature subtract from **its own** damage rolls has nowhere to say so; `damageBonuses` is the feature-side twin that exists.',
  'an-action-a-spell-compels-or-forbids':
    'the action economy is the engine’s and `mayAct` guards every spender, and the only lever a spell has on it is a condition the engine names. Forbidding one action, compelling another, granting an extra one, or spending somebody else’s Reaction is a rider nothing expresses — which Befuddlement already says in its own words in `spell-definitions.ts`: "which is not a condition the engine names".',
  'a-turn-a-spell-inserts-into-the-order':
    'CLAUDE.md: "**In combat the clock is derived.** A round ends when the Initiative order wraps, and six seconds have passed; nobody decides that." A spell that hands its caster several turns in a row has no way to say so without a decision somebody makes, which is the one thing the derived clock refuses.',
  'a-choice-made-at-the-casting':
    'CLAUDE.md names it for the roll-modifier vocabulary — "An ability **chosen at the casting** | Hex, Enhance Ability, Bestow Curse" — and Guidance’s own clause in spell-definitions.ts says it plainly: "a per-casting choice has nowhere to be recorded". **A damage type is the one choice that is not here**, and it stopped being here when IE-017 gave `damageTypeStated` a second user: spell-definitions.ts records that the mechanism generalised while the reason did not — "what generalises is the field and what stays the spell’s own is the reason". An ability, a condition, one of six wonders, which of five effects to remove: none of those has a field.',
  'several-attack-rolls-from-one-casting':
    'one casting rolls one attack per target. Eldritch Blast’s beams are separate attack rolls that may take different targets, which `spell-definitions.ts` already records in the clause itself — "which is a shape the engine does not have" — and which is the spell-side twin of the class-feature gap CLAUDE.md names: "Extra attacks inside the Attack action. The economy counts one Attack action, not the attacks in it".',
  'a-second-roll-sequenced-after-the-first':
    '`OutcomeRiders` in spell-definitions.ts rejects this by name: "the two that look as though they do — Ice Knife’s explosion and Chromatic Orb’s leap — are different mechanisms (**a second sequenced roll with an area at a target**, and a chained attack on a dice-face trigger). A child that rolls is a parent".',
  'a-success-branch-that-does-something':
    '`OutcomeRiders` in spell-definitions.ts again: "**Which branch a rider rides is the host’s, never the author’s.** There is no miss-branch slot and no success-branch slot ... A spell whose success clause does something — Flesh to Stone’s “its Speed is 0” — is one consumer and a different shape."',
  'a-spells-effects-applied-to-different-targets':
    'CLAUDE.md: "**A spell has one effect list applied to every target**, so nothing yet expresses “each creature takes damage *and* is knocked Prone” with different outcomes per target beyond the save each one rolls." A casting that chooses per creature, or divides a pool among them, is the same gap.',
  'a-rider-on-a-later-weapon-attack':
    'CLAUDE.md, on what the drained shapes left: "a rider on every weapon attack (Divine Favor, Hex, Hunter’s Mark)"; PROGRESS.md ranks it as "Extra damage on the target’s later attacks | 3 / 10 | `damageBonuses` / `extraDamage`, Rage Damage, Radiant Strikes". **IE-035 built the extra-damage half** — the `attack-rider` grant hangs a notation and a damage type on the caster, optionally narrowed to weapon attacks or to a marked target, and Divine Favor, Hunter’s Mark and Hex’s first sentence are all expressible by it. What is left is every rider that is not that: a **substituted ability** (Shillelagh, True Strike, Alter Self), a **replaced damage die** (the same three), a damage type **chosen at the moment of the attack** (Conjure Minor Elementals), a **flat** bonus of the weapon’s own type reaching the attack roll as well (Magic Weapon), extra damage with **no type** and so the weapon’s own (Enlarge/Reduce), and a rider that fires on damage from **a spell** rather than an attack roll (Bestow Curse).',
  'a-range-that-scales-with-caster-level':
    '`SpellDefinition.range` in spell-definitions.ts is one fixed `SpellRange`, and `ranged(definition.range)` is checked on every casting — tracked or executed, before a target is looked at. CLAUDE.md keeps the two scaling axes apart on purpose — "**Cantrips scale by caster level and levelled spells by slot**, and they are separate fields rather than one overloaded number" — and both of them reach *dice*. Exactly one spell in the book prints a range that grows with the caster, and the engine would refuse the casting the SRD allows.',
  'a-cap-on-how-many-castings-run-at-once':
    '`replacesPriorCasting` in spell-definitions.ts is the cap the SRD writes twice — "The hand vanishes ... if you cast this spell again" — and it is a cap of **one**, applied by ending the prior casting. A spell that lets three of its own castings run at a time and no more is the same field with a number, and `state.ongoing` already holds everything needed to count them.',
  'a-duration-the-slot-changes':
    'PROGRESS.md, on Major Image: "Concentration and duration that **change with the slot level** ... which `SpellDefinition` cannot express". **IE-035 built the half that is a longer span**: `durationAtSlot` is a per-definition table of slot level to seconds, read where the deadline is scheduled, and the six spells printing the SRD’s "Your Concentration can last longer with a spell slot of…" — Hex, Hunter’s Mark, the three Dominates — and SRD Mass Suggestion’s "The duration is longer with…" all read their own table. What is left is the *other* half of the sentence PROGRESS.md quotes: a slot that changes **what kind** of duration the spell has. SRD Major Image is the one spell in the book that prints it — "The spell lasts until dispelled, **without requiring Concentration**, if cast with a level 4+ spell slot" — so a table of seconds cannot say it, and a member with one writer is what the format’s own unused-member sweep exists to refuse.',
  'a-deadline-anchored-to-a-rest':
    'CLAUDE.md: "`duration.ts` has two types" — "A span of time" and "A moment in the turn order". A rest is neither, and the SRD anchors effects to one constantly. The clock records `lastShortRestAt` and a rest is a span the engine measures, so the fact is there and no deadline can name it.',
  'an-effect-that-fires-when-the-casting-ends':
    'CLAUDE.md: "**Expiry is derived, like Concentration breaking** ... The log records the effect being scheduled, not expiring." Nothing hangs a consequence on the moment a casting runs out, so a spell that punishes its target when it lapses, or rewards a caster who held Concentration to the end, has no hook.',
  'a-long-casting-time':
    'CLAUDE.md: "**In combat a casting time of 1 minute or more is still refused**, and the reason names what is missing: SRD requires the caster to take the Magic action on each turn of the casting, which is a per-turn obligation rather than a deadline." Outside combat IE-034 built it — the casting is declared, runs on the clock and settles, and a Ritual is cast the same way — so what is left of this shape is the in-combat half. **IE-036 read the twelve paragraphs this was the only blocker for and wrote all twelve as tracked definitions**, so what it now blocks is the forty-two spells that name it *and something else*; not one of them is blocked on the in-combat half alone, which is why the second number below is zero rather than the shape being retired. Those forty-two are **not** re-filed: each is blocked by a shape this map already names, and re-reading them belongs with whichever task is briefed from the shape they are waiting on.',
  'senses-beyond-declared-sight':
    'sight is a pairwise declaration and there is nothing else — CLAUDE.md names the missing piece as "A sight clause read from the **attacker’s** side | Faerie Fire". Blindsight and Truesight are the attacker’s senses, so a spell that excuses them cannot be written.',
  'what-a-creature-is-holding':
    '`inventory` and `equipped` are real and only armour and weapons have a slot; CLAUDE.md: "Nothing checks that two hands are free, either." So a spell that makes a creature drop what it holds, or that hands one a globe to throw later, has nothing authoritative to call.',
  'targeting-rules-that-differ-within-one-casting':
    'one range and one sight requirement are checked against every named target. The SRD sometimes measures a later target from an earlier one, requires sight of only the first, or prints a reach for the attack that is not the spell’s Range — a third measurement beside the caster and the area point CLAUDE.md added for Mass Cure Wounds ("The range then belongs to the point rather than to each target"). `spell-definitions.ts` records the reach half on Vampiric Touch, whose clause says the initial attack’s "within reach" goes unchecked.',
  'a-condition-that-ends-when-its-holder-leaves-an-area':
    'CLAUDE.md says it outright: Web’s Restrained lasts "while in the webs", and "a condition that ends when its holder walks out of an area has no shape here at all".',
  'an-area-that-filters-its-catch':
    'an area catches every creature in it. PROGRESS.md names the gap for Entangle — "its area excludes the caster ... and exactly one SRD spell says that, so the field waits for a second user" — and Hypnotic Pattern is the second, whose SRD text affects only a creature that can see the pattern.',
  'a-wall-or-several-templates-in-one-area':
    'CLAUDE.md: "**No wall or multi-area spells.** All six SRD shapes are castable, but a spell whose area is *several* of them — Meteor Swarm’s four Spheres, Fire Storm’s ten Cubes — or a wall with a length, a height and a thickness, has no way to say so. One area per spell."',
  'a-barrier-that-blocks-passage':
    'CLAUDE.md: "Walls and barriers as obstacles | Arcane Eye, Passwall, Wall of Stone, Prismatic Wall", and the reason it stays out — "Cover and line of sight stay declared, not ray-cast ... that is where a rules engine becomes a VTT." A shape that stops a creature crossing it is the geometry’s missing half, distinct from the template that describes it.',
  'an-effect-that-suppresses-other-magic':
    'PROGRESS.md files it among the rows "gone because the shape was built" — "an effect that ends another casting (Dispel Magic)" — and `spell-ended` is what built it. **Suppression is the half that is not**: an ongoing spell that does not function while its time goes on running has no state to sit in, and an area that stops a spell being cast into it reads a casting the engine resolves elsewhere. IE-044 read a third sentence of the same shape from the *target*’s side — SRD Freedom of Movement’s "spells and other magical effects can neither reduce the target’s Speed" — where what refuses the effect is a creature rather than an area; `speedOf` reads every grant a source hung and has no notion of one being refused, which is the same missing state arriving at a different holder.',
  'a-casting-that-casts-another-spell':
    'CLAUDE.md, on the interrupted casting: "It is not a general interruption framework — there is **no stack**, and a Counterspell answering a Counterspell is refused rather than nested." A spell that casts another as part of itself, stores one to go off later, or duplicates one of a lower level needs exactly the stack that was declined. Several castings may be open at once now, keyed by casting id — but that is several *independent* castings rather than one nested inside another, and the two relationship rules that refuse the nesting still stand.',
  'a-spell-that-answers-a-later-attack':
    'CLAUDE.md’s reaction-window table: `hit-by-attack` and `damaged-by-creature` are real instants, and both are answered by a **Reaction somebody takes** — "Two windows open on the actor’s opt-in ... `hit-by-attack` and `casting-a-spell` open only when the *attacker* holds the attack". An ongoing spell that answers a blow automatically, with no Reaction and nobody deciding, is not that mechanism.',
  'an-effect-that-intercepts-dropping-to-0':
    'CLAUDE.md, "Transitions Are Engine-Owned Batches": "Dropping to 0 hit points makes a character Unconscious ... The command layer produces these as coherent batches". The engine owns the transition end to end, and nothing may stand in front of it and change the answer — which is why that file already files Death Ward as debt: "Death Ward, because the engine drops creatures to 0 itself".',
  'a-second-place-to-put-a-creature':
    'there is one scene, so a creature sent elsewhere has nowhere to be. CLAUDE.md: "A destination *outside* the scene is different in kind ... there is one scene, so Plane Shift and Word of Recall have no position to move anybody to", and "the real fix is the doctrine’s multiple-scenes seam".',
  falling:
    'CLAUDE.md lists the one Reaction trigger left after Counterspell: "Feather Fall | a creature falling | **falling, which is not modelled at all**". Nothing drops, nothing takes fall damage, and no rate of descent has anything to be measured against.',
  jumping:
    'jumping, which nothing models, so a jump distance has nothing to be measured against. Jump’s own clause in spell-definitions.ts says it: "the 30-foot jump for 10 feet of movement is not applied; jumping is not modelled, and the once-per-turn limit has nothing to count".',
  'forced-movement-a-spell-causes':
    '`moveCreature` takes `forced: true` and reports who is being shared with, and no `SpellEffect` reaches it — CLAUDE.md records both halves: "forced movement passes `forced: true`", and its recurring finding that a pure function nothing calls is a rule nothing enforces.',
  'an-activation-that-resolves-an-area':
    'CLAUDE.md: "An activation that resolves an area at a point chosen now | Call Lightning, Storm of Vengeance". `activateSpell` resolves an attack at a named target and moves an area along a stated route; resolving a **fresh** area in a direction chosen now is neither.',
  'an-activation-that-forces-a-saving-throw':
    '`SpellActivation` in spell-definitions.ts carries effects "run with the level and route pinned at the casting", and every registered one resolves an attack or moves an area. A later action that makes somebody save — pushing, grappling or probing a mind — has the machinery beside it and no consumer, which is the state a shape is named in rather than assumed out of.',
  'an-activation-taken-by-somebody-other-than-the-caster':
    'CLAUDE.md, on acting through a spell on a later turn: "Pinned at the casting | ... **the caster — nobody else may act through it**". A spell that hands its *target* the later action inverts exactly that rule, and the pinned numbers are still the caster’s.',
  'a-casting-dismissed-early':
    'CLAUDE.md: "**A non-Concentration ongoing spell cannot be dismissed early.** SRD: “you can dismiss it (no action required) if you don’t have the Incapacitated condition.” ... ending it ahead of time has no command, because `endConcentration` is about Concentration."',
  'a-dc-the-caster-does-not-set':
    'every saving throw a spell forces is measured against the casting’s pinned `saveDc`. The audit names the asymmetry from the other side — "**Three members of the definition format have zero catalogue users**, not one: `roll-mode.save` ..., `SpellCheck.dc` ..., and `’end-casting’` as a `save.repeats.onSuccess` value" — so an *ability check* may already name a printed DC and a *saving throw* may not.',
  'a-save-keyed-to-a-condition':
    'a save selected by what it is *against* rather than by the ability that rolls it. CLAUDE.md names it and names this spell: "A save keyed to a named **condition** rather than an ability | Protection from Poison", in the table of what the roll-modifier vocabulary deliberately does not reach. Distinct from `a-mode-on-the-save-a-spell-forces`, which is the caster’s own save seen from the other end — this one modifies a save some *other* effect will call for.',
  'a-condition-benefit-an-effect-takes-away':
    'a benefit the condition layer derives, switched off while the condition itself stays. Three SRD spells print the sentence — Faerie Fire, Starry Wisp, and Mind Spike’s "against you" — and PROGRESS.md already lists Faerie Fire among the clauses the roll vocabulary cannot reach. Invisible’s *attack* halves read declared sight, so the table can answer those; `initiativeConditionModes` grants its Initiative Advantage from the condition’s presence alone, and nothing reaches that at all.',
  'a-random-outcome-that-is-not-a-d20':
    'PROGRESS.md ranks it: "A random outcome that is not a d20 | 1 / 19 | the generator, `parseNotation`". A percentage chance, a 1d10 behaviour table or a 1d100 mishap roll is a die the engine can throw and no `SpellEffect` asks for.',
  'a-rest-an-effect-gives-or-denies':
    'a rest is a span the engine measures and its payout is `endRest`’s — CLAUDE.md, "**A rest is a span, not a button**". No effect confers the benefits of one without the hours, and none takes them away from a rest that was completed.',
  'damage-with-neither-an-attack-roll-nor-a-save':
    'PROGRESS.md ranks it at 19 open spells, and Magic Missile is the one this clause names: while that spell cannot be cast, Shield’s second trigger has nothing to fire on.',
  'an-armor-class-a-spell-floors':
    'PROGRESS.md ranks it: "An Armour Class a spell **sets** (**built** — Mage Armor) or **floors** (~3 left: Barkskin’s “if its AC is lower”)". CLAUDE.md says why the built half does not cover it: "Barkskin is deliberately *not* included: “an Armor Class of 17 if its AC is lower than that” is a floor on the **total**, a different rule, and one spell is not evidence for building it."',
  'the-effects-source-as-a-participant':
    'CLAUDE.md lists it among what the roll-modifier vocabulary deliberately does not reach: "The effect’s *source* as a participant — “against **you**”, meaning the caster | Bestow Curse". `relation` is one bit wide — `roller` or `against-holder` — and the caster of the spell is a third participant no selector can name.',
  'an-area-moved-by-the-casters-own-movement':
    'spell-definitions.ts keeps two allowances apart because the SRD does — `CastingOrigin.movableBy`, a rider on an action that also strikes, and `SpellActivation.movesArea`, where "the move *is* the action". A pack or a pillar that comes along when the caster walks, costing no action at all, is a third sentence and neither field says it.',
  'an-outcome-that-breaks-concentration':
    'CLAUDE.md names it among the mechanics the drained shapes left behind: "an outcome-scoped child effect (Ice Knife’s explosion, Hideous Laughter’s two conditions, **Sleet Storm’s broken Concentration**)". `OutcomeRiders` landed with conditions, modifiers and delayed damage; ending the target’s Concentration is the one consequence in that sentence that got no slot.',
  'a-check-another-creature-may-attempt':
    'CLAUDE.md, on the check a spell offers: "**Who may attempt it is derived from what the timer sits on** — an effect on a creature is that creature’s to shake off, a casting with no victim is anybody’s to see through." An ally reaching in to cut somebody free, or shaking a sleeper awake, is neither, and the derivation has no third branch.',
  'an-area-trigger-measured-from-a-point':
    'CLAUDE.md names it spell by spell: "Ending a turn within 5 feet of a point, and a point rolled into a creature’s space | Flaming Sphere". `AreaTrigger` hangs off a template, and a reach measured from the casting’s own origin is what `CastingOrigin.reach` answers for an attack and for nothing that fires on its own.',
  'an-effect-that-stabilises-a-dying-creature':
    'CLAUDE.md: "**Every one of the event types the union declares is now emitted by a command**", and `stabilised` is one of the nine a DM declares. The command exists, the event exists, and no `SpellEffect` reaches either — the recurring finding in this repository that a pure function nothing calls is a rule nothing enforces, arriving on the cantrip whose whole content is that one word.',
  'a-distance-a-creature-travels-inside-an-area':
    'CLAUDE.md, on what a persistent area cannot see: "**The path.** Movement records where a move started and where it ended and nothing in between", and "Distance travelled inside an area, which no move records | Spike Growth". Inferring the crossing from a straight line would be the engine inventing a route nobody took.',
  'a-world-fact-nothing-can-represent':
    'PROGRESS.md’s category C, named spell by spell: "**Meld into Stone** (every mechanical clause it has — 6d6 Force, 50 Force, Disadvantage on Perception, Prone on expulsion — hangs off “you are inside a rock”, which is a state nothing can hold)". Not a mechanism that is missing; a fact the world model has no room for, and inventing one is not on.',
} as const;

export type ShapeId = keyof typeof MISSING_SHAPES;

/**
 * What each bundle id claimed, so the split can be checked rather than trusted.
 *
 * The audit’s complaint was arithmetic — "every per-shape count derived from
 * that map inherits the bundle" — so the repair has to be arithmetic too. Each
 * entry records the adjudications and the spells the bundle held in the
 * **executed** population on `main` at `9847661`, and where each one went, so
 * a test can assert they add back up to exactly that.
 *
 * **The ids it was split into are derived from `held` rather than listed
 * beside it.** A second list is a second place for the same fact to be wrong,
 * which is the whole complaint this record answers.
 *
 * `outcome-scoped-child-effects` is not here. IE-010 built the rider
 * vocabulary it named, re-filed its last claimant to
 * `an-outcome-of-a-spells-own-damage` and **removed** the id rather than
 * renaming it, because a shape nothing is blocked on is one the honesty guard
 * deletes. Its arithmetic is recorded in that task’s digest, not here, and
 * this file must not resurrect it.
 */
export interface SplitBundle {
  /** How many adjudications the bundle claimed, and over how many spells. */
  readonly adjudications: number;
  readonly spells: number;
  /**
   * Exactly which adjudications it held, as `[spellId, clause, wentTo]`.
   *
   * Recorded rather than counted, because a count proves nothing: the test
   * looks each pair up in the map as it stands now and asserts it is still
   * filed where the split put it. A re-filing that lost one, or quietly
   * re-worded a clause to duck the question, fails.
   *
   * **The middle slot is what the entry was filed under in its own map**, and
   * that is three different things because the three maps are keyed three
   * different ways: an {@link Adjudication}'s `clause` phrase in the executed
   * population, a marker key in the tracked one, and — where there is no
   * clause at all — the **bundle id itself** in the undefined one, which is
   * the whole of what a `BLOCKED_ON` entry says. A record that could only
   * reach the executed population would count a bundle spanning all three
   * short, which is the error this file exists to end.
   *
   * **A clause may leave the map, and there is exactly one honest reason.**
   * IE-019 executed Shatter, so `['shatter', 'a Construct has Disadvantage']`
   * is no longer an adjudication at all — and that is not a lost fact, it is
   * the shape it went to having been *built*. So the test takes the second
   * branch only when `wentTo` is no longer in {@link MISSING_SHAPES}: a clause
   * that vanished while its shape still stands is a silent loss and fails.
   *
   * `wentTo` is a bare string rather than a `ShapeId` for the same reason.
   * A retired id is not a member of the live vocabulary and this record is
   * history, not a claim about what is missing now.
   */
  readonly held: readonly (readonly [string, string, string])[];
}

export const SPLIT_BUNDLES: Readonly<Record<string, SplitBundle>> = {
  // The audit called this "a shape with eight". Reading the map it is **nine**
  // spells and eleven adjudications, and the one-off is itself the finding in
  // miniature: a hand count of a bundle is wrong in the same direction as the
  // rankings built on it. The derived numbers are the ones recorded here.
  'a-repeat-save-beyond-the-turn-hook': {
    adjudications: 11,
    spells: 9,
    held: [
      ['befuddlement', 'end of every 30 days', 'a-repeat-save-on-the-clock'],
      ['compulsion', 'repeats after moving', 'a-repeat-save-raised-by-a-trigger'],
      ['contagion', 'until three successes', 'a-repeat-save-counted-to-a-tally'],
      [
        'contagion',
        'before any effect can end the Poisoned',
        'a-repeat-save-raised-by-a-trigger',
      ],
      ['dominate-beast', 'whenever it takes damage', 'a-repeat-save-raised-by-a-trigger'],
      ['dominate-monster', 'whenever it takes damage', 'a-repeat-save-raised-by-a-trigger'],
      ['dominate-person', 'whenever it takes damage', 'a-repeat-save-raised-by-a-trigger'],
      [
        'hideous-laughter',
        'the second Wisdom save each time the target takes damage',
        'a-repeat-save-raised-by-a-trigger',
      ],
      [
        'phantasmal-killer',
        'the Wisdom save at the end of each',
        'a-repeat-save-that-does-something-on-a-failure',
      ],
      [
        'phantasmal-killer',
        'a successful save ends the spell',
        'a-repeat-save-that-does-something-on-a-failure',
      ],
      [
        'weird',
        'deals 5d10 Psychic damage again',
        'a-repeat-save-that-does-something-on-a-failure',
      ],
    ],
  },
  'a-mode-on-the-save-a-spell-forces': {
    adjudications: 6,
    spells: 6,
    held: [
      ['charm-monster', 'the save has Advantage', 'a-fact-only-the-table-can-declare'],
      ['charm-person', 'the save has Advantage', 'a-fact-only-the-table-can-declare'],
      ['dominate-beast', 'the save has Advantage', 'a-fact-only-the-table-can-declare'],
      ['dominate-monster', 'the save has Advantage', 'a-fact-only-the-table-can-declare'],
      ['dominate-person', 'the save has Advantage', 'a-fact-only-the-table-can-declare'],
      // IE-019 built the shape this one went to and executed the spell with it,
      // so the clause is gone from the map — the second branch, and the only
      // honest reason a held clause may be missing.
      ['shatter', 'a Construct has Disadvantage', 'an-outcome-that-varies-by-creature-type'],
    ],
  },
  // The one bundle that spanned all three populations, and the one whose
  // description said so in its own words: "a Speed a spell changes, **and**
  // the Fly, Climb and Swim modes the engine does not distinguish". Two
  // sentences joined by an "and" is what a bundle looks like from the inside.
  //
  // IE-033 built the first half and it retires; `movement-modes` keeps the
  // second, which CLAUDE.md refuses by name. What the re-reading found is that
  // neither half covered three of the sixteen: Gust of Wind prints a *movement
  // cost* rather than a Speed or a mode, and Haste prints an operation the
  // built vocabulary deliberately does not carry.
  'speed-and-movement-modes': {
    adjudications: 16,
    spells: 16,
    held: [
      // — built, so these clauses leave the map altogether ——————————————
      // The shape `a-speed-an-effect-changes` never appears in
      // {@link MISSING_SHAPES}: it was built in the same task that split this
      // bundle, and a shape nothing is blocked on is one the guard deletes.
      ['hypnotic-pattern', 'Speed of 0 that rides along', 'a-speed-an-effect-changes'],
      ['ray-of-frost', 'Speed is reduced by 10 feet', 'a-speed-an-effect-changes'],
      // Tracked no longer: Longstrider's whole printed content is the grant,
      // so it is an executed definition now and has no tracked entry at all.
      ['longstrider', 'speed', 'a-speed-an-effect-changes'],
      // "On a successful save, its Speed is 0 until the start of your next
      // turn" — expressible now, and what blocks it is the *success branch*
      // this spell's own entry already names.
      ['flesh-to-stone', 'speed-and-movement-modes', 'a-speed-an-effect-changes'],
      // "Otherwise, its Speed is 0", on the other side of a Hit Point
      // threshold the entry already names.
      ['power-word-stun', 'speed-and-movement-modes', 'a-speed-an-effect-changes'],
      // "An affected target's Speed is halved" — `SpeedChange` carries it, and
      // Slow stays undefined on the two other shapes its entry names.
      ['slow', 'speed-and-movement-modes', 'a-speed-an-effect-changes'],

      // — the modes, which the audit refused twice ————————————————————
      ['fly', 'speed', 'movement-modes'],
      ['spider-climb', 'speed', 'movement-modes'],
      // "a Swim Speed equal to your Speed".
      ['alter-self', 'speed-and-movement-modes', 'movement-modes'],
      // "you can move in any direction", which is flight by another name.
      ['etherealness', 'speed-and-movement-modes', 'movement-modes'],
      // "The target also has a Swim Speed equal to its Speed."
      ['freedom-of-movement', 'speed-and-movement-modes', 'movement-modes'],
      // "the target's only method of movement is a Fly Speed of 10 feet".
      ['gaseous-form', 'speed-and-movement-modes', 'movement-modes'],
      // "it can move as if it were climbing", vertically and by pushing off.
      ['levitate', 'speed-and-movement-modes', 'movement-modes'],
      // "a Fly Speed of 300 feet and can hover".
      ['wind-walk', 'speed-and-movement-modes', 'movement-modes'],

      // — neither half, which is the finding —————————————————————————
      // "must spend 2 feet of movement for every 1 foot it moves when moving
      // closer to you" is a movement **cost** an area imposes, which is the
      // SRD's own arithmetic for Difficult Terrain and is blocked on the path
      // a move does not record.
      ['gust-of-wind', 'speed-and-movement-modes', 'difficult-terrain-an-area-creates'],
      // "the target's Speed is doubled" — the one operation on a Speed the
      // built vocabulary deliberately does not carry.
      ['haste', 'speed-and-movement-modes', 'a-speed-an-effect-multiplies'],
    ],
  },
};

// — the executed population ——————————————————————————————————————————————————
//
// Moved here verbatim from `spell-honesty.test.ts`, which still owns every
// guard over it. What changed is the filing of the seventeen adjudications the
// fourth audit found bundled — eleven under one bundle id and six under the
// other; the clauses and the notes are the ones that were reviewed.

export interface Adjudication {
  /**
   * A distinctive phrase from the clause this answers.
   *
   * Not an index: a clause that is reordered would silently take its
   * neighbour's licence, and a clause that is **reworded** should have to be
   * read again rather than keep an adjudication written about the old
   * sentence. The phrase must match exactly one of the spell's clauses, which
   * the test asserts in both directions.
   */
  readonly clause: string;
  /** Fiction the engine should never decide, or the shape that blocks it. */
  readonly why: 'table' | ShapeId;
  readonly note: string;
}

/**
 * Why each mechanical clause in an executed spell is not executed.
 *
 * Keyed by spell id and sorted, because this is a list two branches both
 * append to — the same reason `VERIFIED_SPELLS` and the catalogue are sorted.
 */
export const ADJUDICATED: Readonly<Record<string, readonly Adjudication[]>> = {
  'arcane-sword': [
    {
      clause: 'to a spot you can see',
      why: 'table',
      note: 'SRD: "move the sword up to 30 feet to a spot you can see". Sight here is a declared fact from one creature to another — `sight-declared` names a `from` and a `to`, both creatures — and a destination is a coordinate. There is no pairwise declaration for the relocation to read and nothing it could read instead, so this is the line declared cover and declared sight already draw: the DM says what the caster can see, and the engine measures the thirty feet.',
    },
  ],
  banishment: [
    {
      clause: 'leaving the battlefield for a demiplane',
      why: 'a-second-place-to-put-a-creature',
      note: 'SRD: "be transported to a harmless demiplane for the duration", and "While there, the target has the Incapacitated condition." There is one scene, so the target is left Incapacitated where it stands — a position the spell does not give it, and one every area of effect and every ruler goes on reading.',
    },
    {
      clause: 'not returning if the spell runs',
      why: 'a-second-place-to-put-a-creature',
      note: 'SRD: "If the target is an Aberration, a Celestial, an Elemental, a Fey, or a Fiend, the target doesn’t return if the spell lasts for 1 minute. The target is instead transported to a random location on a plane (GM’s choice) associated with its creature type." The creature type is no longer the blocker — an effect reads one now — and neither half of what is left is about it: nobody was transported to a demiplane, so there is nothing to fail to return from, and the plane it would go to instead is a second place the engine has nowhere to put anybody.',
    },
  ],
  'beacon-of-hope': [
    {
      clause: 'the maximum number of Hit Points',
      why: 'healing-modified-by-an-effect',
      note: 'SRD: "regains the maximum number of Hit Points possible from any healing." That is an instruction to the *next* healing roll, and `healCreature` rolls its dice with nothing standing beside it to maximise them.',
    },
  ],
  befuddlement: [
    {
      clause: 'stops the target casting spells',
      why: 'an-action-a-spell-compels-or-forbids',
      note: 'SRD: the target "can’t cast spells or take the Magic action". The action economy is the engine’s, and the only lever a spell has on it is a condition the engine names; forbidding one action and leaving the rest is a rider nothing expresses.',
    },
    {
      clause: 'end of every 30 days',
      why: 'a-repeat-save-on-the-clock',
      note: 'A repeat save is raised by a turn boundary. This one runs on elapsed time, which `Deadline` can express and `RepeatSave` cannot, and the Greater Restoration that ends it sooner is the same missing hook from the other side.',
    },
  ],
  'black-tentacles': [
    {
      clause: 'the area is Difficult Terrain',
      why: 'difficult-terrain-an-area-creates',
      note: 'The engine charges Difficult Terrain exactly and takes it as declared feet on the move that crosses it, so an area that makes the ground difficult is invisible to the ruler and every move through the tentacles is charged as open floor.',
    },
  ],
  'blindness-deafness': [
    {
      clause: 'Deafened instead of Blinded',
      why: 'a-choice-made-at-the-casting',
      note: 'SRD: "it has the Blinded or Deafened condition (your choice) for the duration". The condition is a field on the effect, fixed when the definition was written, and a casting has nowhere to record which of the two this one chose.',
    },
  ],
  blur: [
    {
      clause: 'Blindsight or Truesight',
      why: 'senses-beyond-declared-sight',
      note: 'SRD: "An attacker is immune to this effect if it perceives you with Blindsight or Truesight." Sight is a pairwise declaration and there is nothing else, so every attacker takes the Disadvantage and a Truesight attacker takes it wrongly.',
    },
  ],
  'chain-lightning': [
    {
      clause: 'within 30 feet of the first target',
      why: 'targeting-rules-that-differ-within-one-casting',
      note: 'SRD: the later bolts leap to creatures "within 30 feet of the first target". The engine measures every named target from the caster against the spell’s own Range, so a bolt is allowed at 150 feet from the first target and refused at 35 from the caster.',
    },
    {
      clause: 'only the first target must be seen',
      why: 'targeting-rules-that-differ-within-one-casting',
      note: 'SRD requires sight of the first target only. One sight requirement is checked against every target named, so this casting demands four declared sight lines where the book demands one.',
    },
  ],
  'chill-touch': [
    {
      clause: 'cannot regain Hit Points',
      why: 'healing-modified-by-an-effect',
      note: 'SRD: "it can’t regain Hit Points until the end of your next turn." Healing is the engine’s arithmetic from end to end, and nothing can stand in front of it and refuse — so a Cure Wounds lands that the spell had forbidden.',
    },
  ],
  cloudkill: [
    {
      clause: 'the same save again when the Sphere moves',
      why: 'an-area-that-moves-by-itself',
      note: 'The three trigger clauses are exactly what `AreaTrigger` transcribes for Web and Moonbeam, and they are not written here because this Sphere is in the wrong place: writing the triggers on an area that does not drift would catch creatures where the cloud has already left.',
    },
    {
      clause: 'the Sphere moving 10 feet away',
      why: 'an-area-that-moves-by-itself',
      note: 'SRD: the Sphere "moves 10 feet away from you" at the start of each of your turns. An area moves today only because a caster spends an action on it or carries it; nothing moves one on the clock.',
    },
  ],
  compulsion: [
    {
      clause: 'the Bonus Action that designates a direction',
      why: 'an-action-a-spell-compels-or-forbids',
      note: 'SRD: "you can take a Bonus Action to designate a direction", and "Each Charmed target must use as much of its movement as possible to move in that direction on its next turn". Movement is spent through a command the mover sends, and no effect makes somebody else spend it.',
    },
    {
      clause: 'repeats after moving',
      why: 'a-repeat-save-raised-by-a-trigger',
      note: 'The save is raised by the target having moved rather than by a turn boundary, and `RepeatSave` names a boundary and nothing else.',
    },
  ],
  'cone-of-cold': [
    {
      clause: 'a frozen statue',
      why: 'table',
      note: 'The engine owns the death and records it; what the corpse then looks like, and whether it ever thaws, is narration with no mechanical consequence the engine could read back. There is nothing here for a rule to decide.',
    },
  ],
  contagion: [
    {
      clause: 'the ability chosen at the cast',
      why: 'a-choice-made-at-the-casting',
      note: 'SRD: "choose one ability when you cast the spell", and "While Poisoned, the target has Disadvantage on saving throws made with the chosen ability." A `RollModifier` can already name Disadvantage on saves of a stated ability; what it cannot name is the ability this casting chose, because a casting has nowhere to record one.',
    },
    {
      clause: 'until three successes',
      why: 'a-repeat-save-counted-to-a-tally',
      note: 'Three successes end it and three failures fix it, so the save carries a running count — the death-save shape rather than the repeat-save one, and `RepeatSave` holds no tally.',
    },
    {
      clause: 'before any effect can end the Poisoned',
      why: 'a-repeat-save-raised-by-a-trigger',
      note: 'SRD gates the *removal* of the condition behind a save, and a save is raised here only by a turn boundary; nothing puts one in front of another effect’s cure.',
    },
  ],
  'dimension-door': [
    {
      clause: 'the willing creature who comes along',
      why: 'a-spells-effects-applied-to-different-targets',
      note: 'SRD: "You can also teleport one willing creature. The creature must be within 5 feet of you when you teleport, and it teleports to a space within 5 feet of your destination space." One casting, two creatures and **two different destinations**, where a casting applies one effect list to every target it names.',
    },
    {
      clause: 'the 4d6 Force damage on a failed arrival',
      why: 'damage-with-neither-an-attack-roll-nor-a-save',
      note: 'SRD: "If you, the other creature, or both would arrive in a space occupied by a creature or completely filled by one or more objects, you and any creature traveling with you each take 4d6 Force damage, and the teleportation fails." The engine refuses the occupied destination before a slot is spent, which is the validate-before-rolling discipline and **not** what the book does: SRD spends the slot and hurts everybody travelling. What the damage needs is a hit with no roll to make it, which is the shape Magic Missile is blocked on.',
    },
  ],
  disintegrate: [
    {
      clause: 'disintegrated to dust',
      why: 'an-outcome-of-a-spells-own-damage',
      note: 'Not an outcome rider, and the distinction is the whole reason this has a shape of its own: a rider rides the roll its host made, and this fires on a number the engine went on to compute from it — the target reaching 0 Hit Points. The gear turned to dust and the restriction on reviving it ride on the same missing branch.',
    },
  ],
  'dissonant-whispers': [
    {
      clause: 'spends its Reaction fleeing',
      why: 'an-action-a-spell-compels-or-forbids',
      note: 'SRD: it "must immediately use its Reaction, if available, to move as far away from you as it can, using the safest route". The Reaction and the movement are both real budgets, and nothing lets a spell spend somebody else’s.',
    },
  ],
  'dominate-beast': [
    {
      clause: 'whenever it takes damage',
      why: 'a-repeat-save-raised-by-a-trigger',
      note: 'SRD: "Whenever the target takes damage, it repeats the save, ending the spell on itself on a success." The save is raised by a damage event rather than by a boundary, and the turn hook is the only thing that raises one.',
    },
    {
      clause: 'the telepathic link',
      why: 'an-action-a-spell-compels-or-forbids',
      note: 'Issuing commands and spending your Reaction to make the dominated creature act are both somebody else’s action economy, which no effect can spend.',
    },
  ],
  'dominate-monster': [
    {
      clause: 'whenever it takes damage',
      why: 'a-repeat-save-raised-by-a-trigger',
      note: 'SRD raises another Wisdom save each time the target takes damage; the engine raises repeat saves at turn boundaries and nowhere else.',
    },
    {
      clause: 'the telepathic link',
      why: 'an-action-a-spell-compels-or-forbids',
      note: 'Commanding the target, and spending your own Reaction to make it take one of its Reactions, are both somebody else’s budget to spend.',
    },
  ],
  'dominate-person': [
    {
      clause: 'whenever it takes damage',
      why: 'a-repeat-save-raised-by-a-trigger',
      note: 'A save raised by damage rather than by a boundary; the damage is recorded and nothing reads it as a moment a spell is owed something.',
    },
    {
      clause: 'the telepathic link',
      why: 'an-action-a-spell-compels-or-forbids',
      note: 'The commands the link carries are the target’s actions, and no effect spends another creature’s action economy.',
    },
  ],
  'eldritch-blast': [
    {
      clause: 'the extra beams',
      why: 'several-attack-rolls-from-one-casting',
      note: 'SRD adds a beam at levels 5, 11 and 17, each its own attack roll and each able to take a different target. One casting rolls one attack per target here, so the cantrip is a third of itself at level 17.',
    },
  ],
  fear: [
    {
      clause: 'drops whatever it is holding',
      why: 'what-a-creature-is-holding',
      note: 'SRD: a creature that fails must "drop whatever it is holding". What a creature owns and what it has equipped are both real state, and nothing takes a weapon out of a hand.',
    },
    {
      clause: 'Dashes away from you',
      why: 'an-action-a-spell-compels-or-forbids',
      note: 'SRD compels the Dash action away from the caster each turn, and ends the Frightened condition on a save made when the target ends its turn out of line of sight. The Dash is a budget nothing else may spend; the sight-conditioned save is the turn hook’s missing half.',
    },
  ],
  'finger-of-death': [
    {
      clause: 'rises as a Zombie',
      why: 'a-stat-block-created-mid-fight',
      note: 'SRD: "A Humanoid killed by this spell rises at the start of your next turn as a **Zombie**", one "that follows your verbal orders". Nothing creates a creature from a stat block during play, which is the summons seam every Conjure waits on.',
    },
  ],
  'flame-blade': [
    {
      clause: 'letting go of the blade',
      why: 'what-a-creature-is-holding',
      note: 'SRD lets the caster drop the blade and evoke it again as a Bonus Action. Whether a hand is free, and what is in it, is not tracked — so there is no state the dropping and re-evoking could change.',
    },
  ],
  'freezing-sphere': [
    {
      clause: 'freezing a body of water',
      why: 'table',
      note: 'The Restrained applies to creatures swimming on water this spell froze, and there is no water: terrain and its state are the world the DM authors, not arithmetic the engine could get right or wrong. The condition is the DM’s to apply through `applyConditionTo`.',
    },
    {
      clause: 'holding the globe back',
      why: 'what-a-creature-is-holding',
      note: 'SRD lets the caster keep the globe in hand to be thrown or slung later, or left to detonate on its own. Nothing tracks what a creature is holding, so there is nowhere for an undetonated globe to sit.',
    },
  ],
  grease: [
    {
      clause: 'becoming Difficult Terrain',
      why: 'difficult-terrain-an-area-creates',
      note: 'The ruler charges Difficult Terrain by the declared foot and reads no area, so a creature walks across the grease at open-floor cost while the spell’s save is resolved exactly.',
    },
  ],
  guidance: [
    {
      clause: 'rather than only the one chosen skill',
      why: 'a-choice-made-at-the-casting',
      note: 'SRD: "You touch a willing creature and choose a skill", and the creature "adds 1d4 to any ability check using the chosen skill". The bonus is granted to the whole ability-check family instead, which is broader than the spell, and the clause says why: a per-casting choice has nowhere to be recorded.',
    },
  ],
  'guiding-bolt': [
    {
      clause: 'the next attack roll against the target',
      why: 'a-one-shot-roll-modifier',
      note: 'SRD: "the next attack roll made against it before the end of your next turn has Advantage." A durable grant applies until its casting ends; nothing is consumed by the roll it changes.',
    },
  ],
  harm: [
    {
      clause: 'Hit Point maximum reduction',
      why: 'a-hit-point-maximum-a-spell-moves',
      note: 'SRD: "its Hit Point maximum is reduced by an amount equal to the Necrotic damage it took", and "This spell can’t reduce a target’s Hit Point maximum below 1." The maximum is the engine’s own number, read by healing, by Massive Damage and by every threshold, and no effect moves it.',
    },
  ],
  'hideous-laughter': [
    {
      clause: 'the second Wisdom save each time the target takes damage',
      why: 'a-repeat-save-raised-by-a-trigger',
      note: 'SRD: "At the end of each of its turns and each time it takes damage, it makes another Wisdom saving throw." The turn boundary is exactly what `RepeatSave` names and is rolled; a save raised by a **trigger** is not, and nor is the Advantage that one carries.',
    },
    {
      clause: 'unable to end the Prone condition on itself',
      why: 'an-action-a-spell-compels-or-forbids',
      note: 'SRD: "it can\u2019t end the Prone condition on itself." Standing up is something a creature does and the engine does not model it as an action a spell can forbid, so the Prone is lifted by the spell ending and by nothing this clause could stop.',
    },
  ],
  'hunters-mark': [
    {
      clause: 'Advantage on a Wisdom (Perception or Survival) check made to find the quarry',
      why: 'a-fact-only-the-table-can-declare',
      note: 'SRD: "You also have Advantage on any Wisdom (Perception or Survival) check you make to find it." A `RollModifier` selects a check by ability and by skill, so Wisdom (Perception) and Wisdom (Survival) are each perfectly expressible — two grants, one sentence. What no selector can say is which of those checks is the one being made *to find the quarry*, and that is a fact about the attempt rather than about the roll. Granted unconditionally it would hand the ranger Advantage on every Perception check they roll for the hour the spell runs, which is the silent wrong answer this discipline exists to refuse.',
    },
    {
      clause: 'moving the mark to a new creature when the quarry drops to 0 Hit Points',
      why: 'an-outcome-that-reads-the-targets-hit-points',
      note: 'SRD: "If the target drops to 0 Hit Points before this spell ends, you can take a Bonus Action to move the mark to a new creature you can see within range." The vitals are there and nothing reads a threshold on them, which is the whole of this shape; and the second half is a later action that re-aims what the casting already granted, where every registered `SpellActivation` resolves effects at a target instead.',
    },
  ],
  'hypnotic-pattern': [
    {
      clause: 'only a creature that can see the pattern',
      why: 'an-area-that-filters-its-catch',
      note: 'An area catches every creature standing in it. SRD affects only those that can see the pattern, so a blindfolded creature in the Cube is Charmed here and is not Charmed in the book.',
    },
    {
      clause: 'ending for a creature that takes damage',
      why: 'a-casting-ended-by-a-trigger',
      note: 'SRD ends the effect on a creature that takes damage or is shaken awake. The damage is recorded and no casting can be told to release that creature when it lands.',
    },
  ],
  'ice-storm': [
    {
      clause: 'becomes Difficult Terrain',
      why: 'difficult-terrain-an-area-creates',
      note: 'SRD leaves the ground difficult "until the end of your next turn" — a deadline the engine can express over an area it cannot, because terrain reaches the ruler only as declared feet on a move.',
    },
  ],
  'incendiary-cloud': [
    {
      clause: 'the same save again when the Sphere moves',
      why: 'an-area-that-moves-by-itself',
      note: 'The trigger clauses are the ones `AreaTrigger` already transcribes, and writing them on a cloud that never drifts would raise saves at a place the cloud should have left. The drift is what blocks them.',
    },
    {
      clause: 'the cloud moving 10 feet away',
      why: 'an-area-that-moves-by-itself',
      note: 'SRD moves the cloud 10 feet in a direction the caster chooses at the start of each of their turns — a chosen direction where Cloudkill’s is derived, which is why the two do not even share a command.',
    },
  ],
  'insect-plague': [
    {
      clause: 'Lightly Obscured and Difficult Terrain',
      why: 'difficult-terrain-an-area-creates',
      note: 'The swarm’s saves and damage all run; the ground it stands on costs nothing extra to cross, because Difficult Terrain reaches the ruler only as feet a move declares.',
    },
  ],
  invisibility: [
    {
      clause: 'an attack roll that costs no Attack action',
      why: 'a-casting-ended-by-a-trigger',
      note: 'SRD: "The spell ends early immediately after the target makes an attack roll, deals damage, or casts a spell." All three are built; the residue is which *event* records an attack roll. `target-attacks` reads `attack-made`, which is the Attack action, and the only thing naming the roller of a free swing — an Opportunity Attack, or any attack outside combat — is `roll-recorded`, which changes no state by rule. A free swing that lands still ends the spell through the damage it deals, so what is left is a free swing that misses.',
    },
  ],
  'lesser-restoration': [
    {
      clause: 'a condition chosen at the casting has nowhere to be recorded',
      why: 'a-choice-made-at-the-casting',
      note: 'SRD: "end one condition on it: Blinded, Deafened, Paralyzed, or Poisoned." One of four, and the caster picks — so a creature both Blinded and Poisoned is fully cured of both, where the book cures one. It is the same gap Blindness/Deafness carries from the other side, where the choice is between imposing two rather than lifting one.',
    },
  ],
  'mind-spike': [
    {
      clause: 'knowing the target',
      why: 'a-condition-benefit-an-effect-takes-away',
      note: 'Knowing where the target is stays the table’s: the engine holds no knowledge model and sight is a declaration, so a DM who declares the sight has said the whole of that half. The rest is not. Invisible’s attack halves read declared sight, but `initiativeConditionModes` grants its Initiative Advantage from the condition’s presence alone, so for an hour a target the spike has found goes on rolling Initiative with an Advantage the SRD took away from it, decided by the engine and reachable by no declaration.',
    },
  ],
  moonbeam: [
    {
      clause: 'shape-shifted creature reverting',
      why: 'table',
      note: 'A creature’s form is not held anywhere: Wild Shape and every other shape-change is a `manual` feature a DM applies, so there is no form for a failed save to revert and nothing the engine resolves arrives at one.',
    },
  ],
  'phantasmal-killer': [
    {
      clause: 'the Wisdom save at the end of each',
      why: 'a-repeat-save-that-does-something-on-a-failure',
      note: 'The boundary is one `RepeatSave` already names; what it cannot do is deal damage on the failure, because a repeat save releases effects and rolls nothing else.',
    },
    {
      clause: 'a successful save ends the spell',
      why: 'a-repeat-save-that-does-something-on-a-failure',
      note: 'The ending itself is expressible — `onSuccess: end-casting` exists — and it has no save to ride on, because the repeat save that would carry it deals damage the hook cannot roll.',
    },
  ],
  'protection-from-poison': [
    {
      clause: 'Advantage on saving throws to avoid or end the Poisoned condition',
      why: 'a-save-keyed-to-a-condition',
      note: 'SRD: "the target has Advantage on saving throws to avoid or end the Poisoned condition". A `RollModifier` selects a save by ability and by nothing else, so the nearest sayable thing is Advantage on every Constitution save the target ever makes — which is a different and much larger spell. The engine rolls those saves without it.',
    },
  ],
  shield: [
    {
      clause: 'Magic Missile',
      why: 'damage-with-neither-an-attack-roll-nor-a-save',
      note: 'Being targeted by Magic Missile is the spell’s second trigger and taking no damage from it is its second benefit, and neither can exist while the spell they name cannot be cast: its darts hit with no attack roll and no save.',
    },
  ],
  'shocking-grasp': [
    {
      clause: 'cannot make Opportunity Attacks',
      why: 'an-action-a-spell-compels-or-forbids',
      note: 'SRD: the target "can’t make Opportunity Attacks until the start of its next turn". The engine offers and spends that Reaction itself, and nothing forbids one action while leaving the rest of the budget alone.',
    },
  ],
  'spirit-guardians': [
    {
      clause: 'halved Speed',
      why: 'a-standing-effect-derived-from-where-a-creature-stands',
      note: 'SRD halves the Speed of every affected creature inside the Emanation. Mutating a base Speed as creatures enter and leave is correct only while every pair of events stays matched, and nothing derives a value from where a creature is standing.',
    },
  ],
  'starry-wisp': [
    {
      clause: 'cannot benefit from the Invisible',
      why: 'a-condition-benefit-an-effect-takes-away',
      note: 'The Dim Light is the table’s, because light is not modelled. Taking the benefit away is not: the attack halves of Invisible read declared sight and a DM can answer those, while `initiativeConditionModes` grants its Initiative Advantage from the condition’s presence alone — so a creature the wisp has lit still rolls Initiative with Advantage, and no declaration exists that would stop it.',
    },
  ],
  'stinking-cloud': [
    {
      clause: "can't take an action or a Bonus Action",
      why: 'an-action-a-spell-compels-or-forbids',
      note: 'SRD: "While Poisoned in this way, the creature can’t take an action or a Bonus Action." The gas, the Constitution save and the Poisoned all run; what does not is the sentence after them. The action economy is the engine’s and `mayAct` guards every spender, and the only lever a spell has on it is a condition the engine names — Poisoned is not that condition, so a creature the cloud has poisoned may still take its Action.',
    },
  ],
  sunbeam: [
    {
      clause: 'creates a new Line on a later turn',
      why: 'an-activation-that-resolves-an-area',
      note: 'SRD lets the caster take a Magic action on a later turn to launch the beam again. An activation resolves an attack at a named target and moves an area along a stated route; resolving a fresh area in a direction chosen now is the shape Call Lightning waits on too.',
    },
  ],
  sunburst: [
    {
      clause: 'dispelling magical Darkness',
      why: 'table',
      note: 'Ending a casting is a real operation — `spell-ended` and Dispel Magic both use it — and there is no Darkness casting for it to reach, because light is not modelled and the spell compiles into no definition. A clause with no reachable case is documented rather than modelled, exactly as Counterspell’s components qualifier is — and, like that one, the fact that makes it safe is pinned by a test below rather than trusted.',
    },
  ],
  thunderwave: [
    {
      clause: 'pushed 10 feet away',
      why: 'forced-movement-a-spell-causes',
      note: 'SRD: "is pushed 10 feet away from you" on a failed save. `moveCreature` already takes `forced: true` and reports whose space is being shared; no spell effect reaches it, so the wave deals its damage and moves nobody.',
    },
  ],
  'vampiric-touch': [
    {
      clause: 'goes unchecked',
      why: 'targeting-rules-that-differ-within-one-casting',
      note: 'The spell’s printed Range is Self, which is what the targeting rules read, and the five feet belong to the attack rather than to the spell. Every later use of the casting checks the reach; the attack made at the moment of casting does not.',
    },
  ],
  'vicious-mockery': [
    {
      clause: 'next attack roll before the end of its next turn',
      why: 'a-one-shot-roll-modifier',
      note: 'SRD: the target must succeed on the save or "have Disadvantage on the next attack roll it makes before the end of its next turn". Nothing here is consumed by the roll it changes — a durable grant runs until its casting ends — so the Disadvantage is not granted at all.',
    },
  ],
  web: [
    {
      clause: 'while in the webs',
      why: 'a-condition-that-ends-when-its-holder-leaves-an-area',
      note: 'SRD Restrains a creature "while in the webs". A condition ends with its casting, on a deadline, or on a save; ending because its holder walked out of an area is a lifetime nothing expresses, so it runs until the casting ends or the creature breaks free.',
    },
    {
      clause: 'the webs are Difficult Terrain',
      why: 'difficult-terrain-an-area-creates',
      note: 'Every save the webs call for is raised and resolved; crossing them costs the same as crossing an empty floor, because Difficult Terrain reaches the ruler only as declared feet on a move.',
    },
    {
      clause: 'flammable',
      why: 'table',
      note: 'Whether anybody sets the webs alight is a decision the fiction makes and the engine has no path to: nothing in it starts a fire, and the 2d4 the burning cube deals is damage a DM applies through `resolveDamage` like any other consequence they narrate.',
    },
  ],
  weird: [
    {
      clause: 'deals 5d10 Psychic damage again',
      why: 'a-repeat-save-that-does-something-on-a-failure',
      note: 'SRD repeats the Wisdom save at the end of each of the target’s turns, dealing 5d10 Psychic damage again on a failure and ending the spell on that target on a success. The boundary and the ending are expressible; the damage at a boundary is not.',
    },
  ],
};

// — the tracked population ———————————————————————————————————————————————————
//
// Moved here from `spell-tracking.test.ts` for one reason: without it a shape
// both populations name counts spells short, which is exactly the class of
// wrong number this file exists to end. `speed-and-movement-modes` was the
// example, and its split is what proved the point — it turned out to span all
// **three** populations, sixteen spells over the two sentences its own
// description joined with an "and". That guard still owns every assertion over
// this map.

/**
 * The guard that keeps `unmodelled` from becoming a dumping ground.
 *
 * `unmodelled` means exactly one thing: **this part of the spell belongs to
 * the fiction, and the engine should never decide it**. It must never come to
 * mean "the engine ought to enforce this and nobody has built it yet", because
 * those two read identically at the table and only one of them is honest. A
 * tracked spell is the easiest place in the codebase to blur them: its
 * `effects` list is empty by design, so any rule at all can be dropped into a
 * sentence and the suite stays green.
 *
 * So the line is drawn mechanically rather than by review. Each tracked spell
 * is read back out of the **parsed SRD** — its own printed prose, not a
 * summary anyone wrote here — and scanned for clauses that name something the
 * engine demonstrably owns: dice, a saving throw, an ability check, an Armour
 * Class, Hit Points, a Resistance or Immunity, a condition, Advantage or
 * Disadvantage, a Speed, a percentage chance, a cost in feet of movement, or
 * extra damage. A spell whose text contains one of those may still be tracked,
 * but somebody has to write down *why* — and the why is one of two kinds:
 *
 * | | |
 * |---|---|
 * | `'table'` | the clause fires on a fictional trigger the engine cannot see, and the DM raises it through commands that already exist |
 * | a shape id | the clause is genuinely mechanical and a named, enumerated shape is missing |
 *
 * The second kind must name an entry in {@link MISSING_SHAPES}, which is the
 * architecture map as data. That is the part that bites: adding Barkskin to
 * the tracked list means writing `armor-class` against a shape id, and either
 * the shape is already named — in which case the debt was already public — or
 * a new one has to be added to a list somebody reviews.
 *
 * **What this does not do.** It is a floor, not a proof. It reads prose, so a
 * rule the SRD phrases without any of these words slips through: Gate and
 * Etherealness both move creatures between planes and trip nothing, and
 * Arcanist's Magic Aura changes what other spells think a creature *is*
 * without using the word "condition". Those are caught by reading the spell,
 * which is what the audit in `PROGRESS.md` is. This catches the ones that are
 * easy to wave through, which is most of them: of the forty-five utility
 * spells this batch rejected, it fires on forty.
 */
export const MECHANICAL_MARKERS = [
  ['dice', /\b\d+d\d+\b/],
  ['saving-throw', /saving throw/i],
  [
    'ability-check',
    /\b(ability|Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)\b[^.]{0,40}\bcheck\b/,
  ],
  ['armor-class', /\bArmor Class\b|\bAC\b/],
  ['hit-points', /\bHit Points?\b/],
  ['defence', /\b(Resistance|Immunity|Vulnerability) to\b/],
  ['condition', /\bcondition\b/i],
  ['roll-mode', /\b(Advantage|Disadvantage) on\b/],
  ['speed', /\bSpeed\b/],
  ['chance', /\bpercent chance\b/i],
  ['movement-cost', /\b\d+ (feet|foot) of movement\b/i],
  ['teleport', /\bteleport/i],
  ['extra-damage', /\bextra\b[^.]{0,30}\bdamage\b/i],
] as const satisfies readonly (readonly [string, RegExp])[];

export type MarkerId = (typeof MECHANICAL_MARKERS)[number][0];

export interface TrackedAdjudication {
  /**
   * Which mechanic in the spell's prose this answers.
   *
   * It was the **key** of a record until IE-044, which capped a spell at one
   * adjudication per marker — and the SRD does not: Tree Stride spends 5 feet
   * of movement in three different sentences and Plane Shift teleports two
   * different ways. Keeping it as a field lifts the cap and keeps the lookup
   * `SPLIT_BUNDLES` records for this population, whose middle slot is a marker
   * key and whose whole value is that it is history nobody may rewrite.
   */
  readonly marker: MarkerId;
  /**
   * A distinctive phrase from the spell's printed SRD entry.
   *
   * {@link Adjudication.clause} and {@link BlockedClause.clause}'s rule, and
   * one implementation: the phrase must occur **exactly once**, and it must sit
   * in a sentence that trips the marker above it — so an adjudication cannot
   * drift onto a neighbouring sentence and cannot be written about a rule the
   * spell states somewhere else.
   */
  readonly clause: string;
  /**
   * Which of three things this clause is.
   *
   * | | |
   * |---|---|
   * | `'table'` | fiction; the engine should never decide it |
   * | `'engine'` | the engine **does** execute it, and nothing is delegated |
   * | a shape id | mechanical, and this names the shape that blocks it |
   *
   * `'engine'` arrived when ability checks became reachable from a spell, and
   * it is the half that keeps this honest in the other direction. A tracked
   * spell is not "a spell the engine does nothing about": Disguise Self is
   * tracked because a disguise is not arithmetic, and the Investigation check
   * that sees through it *is*, and is rolled. Without this value the only way
   * to record a solved clause would be to go on calling it missing.
   */
  readonly why: 'table' | 'engine' | ShapeId;
  readonly note: string;
}

/**
 * Why each mechanical clause in a tracked spell's own SRD text is not executed.
 *
 * Every entry was written by reading that spell's paragraph in
 * `packages/srd/raw/spells.md`, and most of the tracked bucket needs none at
 * all, which is the measure of how well it was chosen.
 *
 * **A list rather than a record keyed by marker**, which is IE-044 pointing the
 * clause-anchored entry type at this population too. The record capped a spell
 * at one adjudication per marker and the SRD does not — Tree Stride spends 5
 * feet of movement in three sentences, Plane Shift teleports two different ways
 * — so the cap was a property of the storage rather than of the book. The
 * marker is a field now and the clause says **which sentence**, which is the
 * rule {@link Adjudication} has always obeyed and {@link BlockedClause} now
 * does: the phrase occurs exactly once in the spell's printed entry, and it
 * sits in a sentence that trips the marker beside it.
 */
export const TRACKED_ADJUDICATED: Readonly<Record<string, readonly TrackedAdjudication[]>> = {
  'disguise-self': [
    {
      marker: 'ability-check',
      clause: 'succeed on an Intelligence (Investigation) check against your spell save DC',
      why: 'engine',
      note: 'the Intelligence (Investigation) check against the spell save DC is rolled by resolveEffectCheck against the casting own timer; the table decides only that somebody looked closely.',
    },
  ],
  'minor-illusion': [
    {
      marker: 'ability-check',
      clause: 'determine that it is an illusion with a successful Intelligence (Investigation) check',
      why: 'engine',
      note: 'the Intelligence (Investigation) check against the spell save DC is rolled by resolveEffectCheck; a cantrip, so the DC comes off the caster sheet rather than off any slot.',
    },
  ],
  'silent-image': [
    {
      marker: 'ability-check',
      clause: 'determine that it is an illusion with a successful Intelligence (Investigation) check',
      why: 'engine',
      note: 'the Intelligence (Investigation) check against the spell save DC is rolled by resolveEffectCheck, against a Concentration casting timer that ends with the Concentration.',
    },
  ],
  demiplane: [
    {
      marker: 'condition',
      clause: 'landing with the Prone condition',
      why: 'table',
      note: 'a creature shunted out as the door vanishes lands Prone — but who is inside an unmodelled demiplane is a fiction the engine cannot see, and the DM applies the condition with applyConditionTo.',
    },
  ],
  'hallucinatory-terrain': [
    {
      marker: 'ability-check',
      clause:
        'make an Intelligence (Investigation) check against your spell save DC to disbelieve it',
      why: 'engine',
      note: 'the Intelligence (Investigation) check against the spell save DC is rolled by resolveEffectCheck against the casting own timer, which the twenty-four hours give it; the table decides only that somebody put a hand out and then looked closely.',
    },
  ],
  'magic-mouth': [
    {
      marker: 'condition',
      clause: 'a message that is uttered when a trigger condition is met',
      why: 'table',
      note: 'condition here means circumstance rather than any of the fifteen the engine applies: "it must be based on visual or audible conditions that occur within 30 feet of the object" is something the DM watches for, and whether a silver bell has rung is not a fact the engine holds.',
    },
  ],
  fly: [
    {
      marker: 'speed',
      clause: 'a Fly Speed of 60 feet and can hover',
      why: 'movement-modes',
      note: 'a Fly Speed of 60 feet and hovering: the engine tracks one Speed and no movement modes.',
    },
  ],
  jump: [
    {
      marker: 'movement-cost',
      clause: 'jump up to 30 feet by spending 10 feet of movement',
      why: 'jumping',
      note: '"jump up to 30 feet by spending 10 feet of movement" — the movement is spendable, the jump is not, so charging the 10 feet alone would be half a rule.',
    },
  ],
  'see-invisibility': [
    {
      marker: 'condition',
      clause: 'creatures and objects that have the Invisible condition as if they were visible',
      why: 'table',
      note: 'seeing through the Invisible condition is declared, not derived: sight is a pairwise declaration and the condition’s own effects already read it, so the table declares the sight this spell grants.',
    },
  ],
  'spider-climb': [
    {
      marker: 'speed',
      clause: 'a Climb Speed equal to its Speed',
      why: 'movement-modes',
      note: 'a Climb Speed equal to its Speed, and walls and ceilings: the engine tracks one Speed and no movement modes.',
    },
  ],
  'plane-shift': [
    {
      marker: 'teleport',
      clause: 'the sigil sequence of a teleportation circle on another plane of existence',
      why: 'table',
      note: 'the destination is a different plane of existence and the engine holds one scene, so there is no position to move anybody to: where the party arrives is the DM’s.',
    },
  ],
  'word-of-recall': [
    {
      marker: 'teleport',
      clause: 'instantly teleport to a previously designated sanctuary',
      why: 'table',
      note: 'the sanctuary is a second place and the engine holds one scene, so the arrival is the DM’s — unlike Misty Step, no coordinate in this scene would be the right answer.',
    },
  ],
  'tree-stride': [
    {
      marker: 'movement-cost',
      clause: 'You must use 5 feet of movement to enter a tree',
      why: 'a-world-fact-nothing-can-represent',
      note: 'the 5 feet spent entering a tree is not charged, because there is no tree: every clause of the ability hangs on being *inside* one, which is a state the world model has no room for — the same place Meld into Stone’s whole paragraph hangs from — so the step it pays for has no representation to cost anything.',
    },
  ],
  'transport-via-plants': [
    {
      marker: 'movement-cost',
      clause: 'exit from the destination plant by using 5 feet of movement',
      why: 'table',
      note: 'the 5 feet a creature spends stepping through is charged by the DM, because the far plant is at any distance — off the scene entirely — and there is no destination to move anybody to.',
    },
  ],
};

// — the undefined population —————————————————————————————————————————————————

/**
 * One sentence of an undefined spell's printed entry, and what stands in its
 * way.
 *
 * {@link Adjudication}'s shape, with one value more. An executed definition's
 * clause is a sentence somebody here wrote about a gap, so it is either the
 * table's or a named shape; an undefined spell's clause is the **book's** own
 * sentence, and the third thing it may be is a rule the existing effect kinds
 * already say — which is why nobody has written the definition rather than why
 * they cannot.
 *
 * | | |
 * |---|---|
 * | `'table'` | fiction; the engine's resolution path never arrives at it |
 * | `'expressible'` | the existing kinds already express it; it blocks nothing |
 * | a shape id | mechanical, and this names the shape that blocks it |
 *
 * `'expressible'` is `TRACKED_ADJUDICATED`'s `'engine'` under the name that
 * fits a spell with no definition: that value says the engine *does* resolve
 * the clause, and here there is nothing to resolve it with yet. Both exist for
 * the same reason — without them the only way to record a sentence that is not
 * a blocker would be to leave it unrecorded, and an unrecorded sentence is
 * indistinguishable from one nobody read.
 */
export interface BlockedClause {
  /**
   * A distinctive phrase from this spell's printed SRD entry.
   *
   * Not an index and not a summary: it must occur **exactly once** across the
   * spell's printed fields and the sentences of its prose, which is what makes
   * a reworded sentence something somebody has to read again. A phrase that
   * straddles two sentences occurs nowhere and is reported, because a clause
   * assembled out of two of the book's sentences is not one of them.
   */
  readonly clause: string;
  readonly why: 'table' | 'expressible' | ShapeId;
  readonly note: string;
}

/**
 * A blocker, anchored or not.
 *
 * A bare shape id is the **grandfathered** form: it says which shape blocks the
 * spell and nothing about which sentence, which is the form every entry had
 * before clauses existed and the form most of them still have. Mixing the two
 * within one entry is refused by the guard rather than by the type — half a
 * reading is what the second `finishes` number exists to keep out of the first.
 */
export type BlockedEntry = ShapeId | BlockedClause;

/**
 * What stands between every **undefined** SRD spell and a definition.
 *
 * Two hundred and six spells, each read against its own SRD paragraph rather
 * than filed by shape — the discipline IE-002 proved was necessary when a
 * shape-level estimate of "roughly ninety spells fit the working kinds" turned
 * out to be **two**.
 *
 * ### What an entry lists, and what it leaves out
 *
 * The same line `ADJUDICATED` draws, applied to a spell the engine has not
 * written yet: **only debt**. A clause the existing kinds already express is
 * not a blocker, and neither is fiction — the engine's resolution path never
 * arrives at what a disguise looks like, at whether a suggestion sounds
 * achievable, or at light and obscurement, which `CLAUSE_MARKERS` already
 * leaves alone by name.
 *
 * So an **empty list is a real answer**, not an omission: it says the engine
 * could take this spell today, tracked or executed, and nobody has written it
 * down. `blocked-on.test.ts` pins that set by name rather than by size — a
 * count in a docstring is the claim this whole file replaces, and the set is
 * small enough to write out and interesting enough to read.
 *
 * ### When a definition lands, this file is content work
 *
 * A spell leaving the undefined population is not a merge conflict. Three
 * things move together and the guards name every one of them: the entry comes
 * out of this map, whatever debt the new definition carries goes into
 * `ADJUDICATED` instead, and any shape that was the spell's alone is either
 * claimed by somebody else or **removed**, as IE-010 removed
 * `outcome-scoped-child-effects` when the rider vocabulary it named was built.
 *
 * And a shape that gets *built* is the same work from the other side: every
 * entry naming it has to be read again, because "blocked on condition removal"
 * stops being true the day an `end-condition` effect exists, and what is left
 * of those spells is usually a smaller, different blocker rather than none.
 *
 * `coverageGaps().stale` names the entries to delete and the unclaimed-shape
 * guard names the shape to retire, so none of it can go quietly — but none of
 * it is mechanical either, and a rebase that only resolves the text leaves the
 * map saying something false about spells the engine now casts.
 *
 * ### Where this disagrees with the prose it replaces
 *
 * Three claims do not survive reading the paragraph, and the SRD text wins.
 * Each is corrected at its source as well as recorded here, because a
 * correction only in the new file leaves the old sentence to be read again.
 *
 * - **No 2024 Conjure spell prints a stat block**, and `CLAUDE.md`'s "A stat
 *   block created mid-fight" row said "the four Conjures" — of six. SRD 5.2.1
 *   rewrote the family as *spirits*: a pack, a pillar of light, an Emanation,
 *   a point you strike from. Not one prints an Armour Class, Hit Points or a
 *   turn. **Conjure Fey is blocked on nothing at all** — it appears at a
 *   point, makes one melee spell attack from it, and moves thirty feet on a
 *   later Bonus Action, which is Spiritual Weapon's shape exactly. The other
 *   five are blocked, and never on a stat block.
 * - **Guardian of Faith and Faithful Hound were in that row too**, and both
 *   are points: "invulnerable", "intangible and invulnerable", each dealing
 *   its damage through a save rather than an attack. What blocks them is a
 *   trigger on the *caster's* turn boundary, which `AreaTrigger` does not have.
 * - **"Reads the target's current Hit Points | 3" is four.** `PROGRESS.md`'s
 *   ranked map names the three Power Words; Aura of Life — "If an ally with 0
 *   Hit Points starts its turn in the aura" — is the fourth, and is in that
 *   map's own population. A three-spell family counted by hand was still
 *   wrong, which is the argument for deriving even the small ones.
 *
 * ### An entry is a bare shape id, or a clause that says which sentence
 *
 * Every wrong prediction this map has made was an **omission** — Mind Blank,
 * Protection from Energy, Enthrall, Magic Weapon, True Strike, and the two
 * sentences found only by reading, Hex's third and Mislead's double. Not one
 * was a wrong entry. A list of shape ids is anchored to nothing, so an entry
 * naming one blocker for a spell that prints three passes every guard here,
 * and a tranche is planned from what that entry says a shape **finishes**.
 *
 * So an entry may be a {@link BlockedClause} instead: the entry type
 * {@link ADJUDICATED} has always had, pointed at the text an undefined spell
 * actually has. The phrase must occur **exactly once** in that spell's printed
 * entry, so a reworded sentence has to be read again rather than keeping an
 * adjudication written about the old one; and every sentence of the prose that
 * names a mechanic the engine owns must have one, which is the four-state claim
 * per sentence — modelled, the table's, deliberately unsupported, or blocked on
 * a named shape — derived from the book rather than from a list.
 *
 * **Backfilling is family by family, and the rest are grandfathered.** Reading
 * two hundred paragraphs in one commit is how a reviewer stops reading; so a
 * shape's consumers are backfilled by the task briefed from them, and
 * {@link consumersOf} reports what a shape finishes **twice** — among the
 * entries somebody has read, and among the rest. The difference is the finding,
 * exactly as `blocks` against `unblocks` was.
 */
export const BLOCKED_ON: Readonly<Record<string, readonly BlockedEntry[]>> = {
  aid: ['a-hit-point-maximum-a-spell-moves'],
  'alter-self': [
    'a-choice-made-at-the-casting',
    'a-rider-on-a-later-weapon-attack',
    'movement-modes',
  ],
  'animal-messenger': ['a-target-rule-the-format-cannot-state'],
  'animal-shapes': [
    'a-casting-dismissed-early',
    'a-spells-effects-applied-to-different-targets',
    'a-target-rule-the-format-cannot-state',
  ],
  'animate-dead': ['a-long-casting-time', 'a-stat-block-created-mid-fight'],
  'animate-objects': ['a-stat-block-created-mid-fight', 'a-target-rule-the-format-cannot-state'],
  'antilife-shell': ['a-barrier-that-blocks-passage', 'a-casting-ended-by-a-trigger'],
  'antimagic-field': [
    'a-standing-effect-derived-from-where-a-creature-stands',
    'an-action-a-spell-compels-or-forbids',
    'an-effect-that-suppresses-other-magic',
  ],
  'antipathy-sympathy': [
    'a-choice-made-at-the-casting',
    'a-creature-type-predicate-an-area-reads',
    'a-long-casting-time',
    'a-repeat-save-raised-by-a-trigger',
    'an-action-a-spell-compels-or-forbids',
  ],
  'arcane-eye': ['a-barrier-that-blocks-passage'],
  'arcane-hand': [
    'a-choice-made-at-the-casting',
    'a-stat-block-created-mid-fight',
    'a-target-rule-the-format-cannot-state',
    'an-activation-that-forces-a-saving-throw',
    'difficult-terrain-an-area-creates',
    'forced-movement-a-spell-causes',
  ],
  'arcanists-magic-aura': ['a-creature-fact-an-effect-overrides'],
  'astral-projection': [
    'a-casting-dismissed-early',
    'a-long-casting-time',
    'a-second-place-to-put-a-creature',
  ],
  augury: ['a-long-casting-time', 'a-random-outcome-that-is-not-a-d20'],
  'aura-of-life': [
    'a-hit-point-maximum-a-spell-moves',
    'a-standing-effect-derived-from-where-a-creature-stands',
    'an-outcome-that-reads-the-targets-hit-points',
  ],
  awaken: [
    'a-long-casting-time',
    'a-stat-block-created-mid-fight',
    'a-target-rule-the-format-cannot-state',
    'an-ability-score-a-spell-changes',
  ],
  barkskin: ['an-armor-class-a-spell-floors'],
  'bestow-curse': [
    'a-choice-made-at-the-casting',
    'a-duration-the-slot-changes',
    'a-repeat-save-that-does-something-on-a-failure',
    'a-rider-on-a-later-weapon-attack',
    'an-action-a-spell-compels-or-forbids',
    'the-effects-source-as-a-participant',
  ],
  'blade-barrier': ['a-wall-or-several-templates-in-one-area', 'difficult-terrain-an-area-creates'],
  blink: ['a-random-outcome-that-is-not-a-d20', 'a-second-place-to-put-a-creature'],
  'call-lightning': ['a-fact-only-the-table-can-declare', 'an-activation-that-resolves-an-area'],
  // — read sentence by sentence, with the nine below it: IE-044 backfilled the
  // ten spells `a-condition-immunity-a-spell-grants` blocks, because that is
  // the shape the next tranche is briefed from and a bare list of ids says
  // nothing about which sentences anybody read.
  'calm-emotions': [
    {
      clause: 'choose for each creature',
      why: 'a-spells-effects-applied-to-different-targets',
      note: 'SRD: "must succeed on a Charisma saving throw or be affected by one of the following effects (choose for each creature)". A casting applies one effect list to every target it caught, so a spell picking a different one per creature has nowhere to record which.',
    },
    {
      clause: 'Immunity to the Charmed and Frightened conditions',
      why: 'a-condition-immunity-a-spell-grants',
      note: 'IE-017 gave `CreatureState.defenses` a third input and touched `conditionApplicability` not at all, so an Immunity to a condition has nowhere to live. The area, the Charisma save and the duration are all expressible; this sentence is the whole of what is not.',
    },
    {
      clause: 'those conditions are suppressed for the duration',
      why: 'a-condition-immunity-a-spell-grants',
      note: 'SRD: "If the creature was already Charmed or Frightened, those conditions are suppressed for the duration." Suppression hands the condition back when the spell ends, so it is not `end-condition` however much it reads like one — it is the same missing storage read over a condition that is already there.',
    },
    {
      clause: 'This indifference ends if the target takes damage',
      why: 'table',
      note: 'The indifference is an attitude, which the engine does not hold and should never decide; a trigger that ends a fact the engine is not keeping belongs to the table for the same reason, and the damage marker fires on the trigger rather than on any damage the spell deals.',
    },
  ],
  'chromatic-orb': ['a-die-behaviour-a-spell-asks-for', 'several-attack-rolls-from-one-casting'],
  clone: ['a-long-casting-time', 'healing-that-raises-the-dead'],
  command: [
    'a-choice-made-at-the-casting',
    'an-action-a-spell-compels-or-forbids',
    'what-a-creature-is-holding',
  ],
  commune: ['a-long-casting-time', 'a-random-outcome-that-is-not-a-d20'],
  confusion: ['a-random-outcome-that-is-not-a-d20', 'an-action-a-spell-compels-or-forbids'],
  'conjure-animals': [
    'a-standing-effect-derived-from-where-a-creature-stands',
    'an-area-moved-by-the-casters-own-movement',
  ],
  'conjure-celestial': [
    'a-spells-effects-applied-to-different-targets',
    'an-area-moved-by-the-casters-own-movement',
  ],
  'conjure-elemental': [
    'a-repeat-save-that-does-something-on-a-failure',
    'an-area-that-filters-its-catch',
  ],
  'conjure-fey': [],
  'conjure-minor-elementals': [
    'a-choice-made-at-the-casting',
    'a-rider-on-a-later-weapon-attack',
    'a-standing-effect-derived-from-where-a-creature-stands',
    'an-area-that-filters-its-catch',
    'difficult-terrain-an-area-creates',
  ],
  'conjure-woodland-beings': ['an-action-a-spell-compels-or-forbids'],
  'contact-other-plane': [
    'a-casting-ended-by-a-trigger',
    'a-dc-the-caster-does-not-set',
    'a-deadline-anchored-to-a-rest',
    'a-long-casting-time',
  ],
  contingency: ['a-casting-that-casts-another-spell', 'a-long-casting-time'],
  'control-water': [
    'a-choice-made-at-the-casting',
    'a-random-outcome-that-is-not-a-d20',
    'an-activation-that-resolves-an-area',
    'forced-movement-a-spell-causes',
  ],
  'control-weather': ['a-long-casting-time', 'a-random-outcome-that-is-not-a-d20'],
  'create-or-destroy-water': [],
  'create-undead': ['a-long-casting-time', 'a-stat-block-created-mid-fight'],
  creation: ['a-choice-made-at-the-casting', 'a-long-casting-time'],
  'dancing-lights': [],
  darkness: [],
  daylight: [],
  'death-ward': ['an-effect-that-intercepts-dropping-to-0'],
  'delayed-blast-fireball': [
    'an-area-trigger-on-the-casters-turn',
    'an-effect-that-fires-when-the-casting-ends',
    'what-a-creature-is-holding',
  ],
  'detect-thoughts': ['an-activation-that-forces-a-saving-throw'],
  'dispel-evil-and-good': [
    'a-filter-on-the-attackers-creature-type',
    'a-second-place-to-put-a-creature',
    'an-activation-that-forces-a-saving-throw',
  ],
  divination: ['a-random-outcome-that-is-not-a-d20'],
  'divine-word': [
    'a-second-place-to-put-a-creature',
    'a-spells-effects-applied-to-different-targets',
    'an-outcome-that-reads-the-targets-hit-points',
  ],
  'dragons-breath': [
    'an-activation-taken-by-somebody-other-than-the-caster',
    'an-activation-that-resolves-an-area',
  ],
  dream: ['a-long-casting-time', 'a-rest-an-effect-gives-or-denies'],
  druidcraft: [],
  earthquake: [
    'a-random-outcome-that-is-not-a-d20',
    'an-area-trigger-on-the-casters-turn',
    'an-outcome-that-breaks-concentration',
    'difficult-terrain-an-area-creates',
    'forced-movement-a-spell-causes',
  ],
  elementalism: [],
  'enhance-ability': [
    'a-choice-made-at-the-casting',
    'a-spells-effects-applied-to-different-targets',
  ],
  'enlarge-reduce': [
    'a-choice-made-at-the-casting',
    'a-creature-fact-an-effect-overrides',
    'a-rider-on-a-later-weapon-attack',
  ],
  'ensnaring-strike': [
    'a-check-another-creature-may-attempt',
    'a-repeat-save-that-does-something-on-a-failure',
    'a-target-rule-the-format-cannot-state',
  ],
  entangle: ['an-area-that-filters-its-catch', 'difficult-terrain-an-area-creates'],
  enthrall: ['a-bonus-narrowed-to-a-skill', 'a-fact-only-the-table-can-declare'],
  etherealness: ['a-second-place-to-put-a-creature', 'movement-modes'],
  'expeditious-retreat': ['an-action-a-spell-compels-or-forbids'],
  eyebite: [
    'a-casting-ended-by-a-trigger',
    'a-check-another-creature-may-attempt',
    'a-choice-made-at-the-casting',
    'an-action-a-spell-compels-or-forbids',
    'an-activation-that-forces-a-saving-throw',
  ],
  'faerie-fire': ['a-condition-benefit-an-effect-takes-away', 'senses-beyond-declared-sight'],
  'faithful-hound': ['a-casting-ended-by-a-trigger', 'an-area-trigger-on-the-casters-turn'],
  'feather-fall': ['falling'],
  'find-familiar': ['a-long-casting-time', 'a-stat-block-created-mid-fight'],
  'find-steed': ['a-stat-block-created-mid-fight'],
  'fire-shield': ['a-spell-that-answers-a-later-attack'],
  'fire-storm': ['a-wall-or-several-templates-in-one-area'],
  'flaming-sphere': ['an-area-trigger-measured-from-a-point'],
  'flesh-to-stone': [
    'a-repeat-save-counted-to-a-tally',
    'a-success-branch-that-does-something',
    'an-automatic-success-by-creature-type',
    'an-effect-that-fires-when-the-casting-ends',
  ],
  'fog-cloud': [],
  forbiddance: [
    'a-creature-type-predicate-an-area-reads',
    'a-long-casting-time',
    'an-effect-that-suppresses-other-magic',
  ],
  forcecage: [
    'a-barrier-that-blocks-passage',
    'a-target-rule-the-format-cannot-state',
    'an-effect-that-suppresses-other-magic',
    'forced-movement-a-spell-causes',
  ],
  foresight: ['a-long-casting-time', 'a-selector-for-every-d20-test'],
  'freedom-of-movement': [
    {
      clause: 'unaffected by Difficult Terrain',
      why: 'difficult-terrain-an-area-creates',
      note: 'Difficult Terrain is charged exactly and declared by the foot on the move that crosses it, so a creature excused from it has nothing to be excused from: `MoveCommand.difficultFeet` is the caller\'s statement and the engine has no record of which ground was difficult.',
    },
    {
      clause: "can neither reduce the target's Speed",
      why: 'an-effect-that-suppresses-other-magic',
      note: 'A blocker the bare list had missed. `speedOf` reads every grant a source hung and has no notion of a creature that refuses one, so this half is an effect stopping another effect from landing — the suppression shape read from the target\'s side rather than from an area\'s.',
    },
    {
      clause: 'nor cause the target to have the Paralyzed or Restrained conditions',
      why: 'a-condition-immunity-a-spell-grants',
      note: 'The condition half of the same sentence, and the half this entry already named: an Immunity to a named condition has nowhere to live, and applying Paralyzed to this creature would simply work.',
    },
    {
      clause: 'a Swim Speed equal to its Speed',
      why: 'movement-modes',
      note: 'Fly, Climb and Swim have no reader — no rule in the engine asks about one — so a vocabulary for them would be shape built ahead of every mechanic that could use it, which is the refusal CLAUDE.md makes by name.',
    },
    {
      clause: 'spend 5 feet of movement to automatically escape from nonmagical restraints',
      why: 'an-activation-taken-by-somebody-other-than-the-caster',
      note: 'A later action through the spell, taken by the target rather than by the caster — and `SpellActivation` pins the caster because nobody else may act through a casting, which is exactly the rule this sentence inverts.',
    },
    {
      clause: 'one additional creature for each spell slot level above 4',
      why: 'expressible',
      note: '`TargetRule.extraPerSlotLevelAbove` is this sentence, and thirty definitions already write it. Recorded rather than left out, because a sentence nobody wrote down is indistinguishable from a sentence nobody read.',
    },
  ],
  'gaseous-form': [
    {
      clause: "along with everything it's wearing and carrying",
      why: 'table',
      note: 'What a creature looks like after it turns into mist is narration, and nothing mechanical follows from the gear coming along: the engine holds an inventory and an equipped set and has no transformed state for either to be in.',
    },
    {
      clause: 'if it drops to 0 Hit Points',
      why: 'a-casting-ended-by-a-trigger',
      note: 'IE-032 built five transcribed causes and each hangs on a consequence event; dropping to 0 Hit Points is not one of the five, and `CastingEndTrigger` has no member for it.',
    },
    {
      clause: 'takes a Magic action to end the spell on itself',
      why: 'a-casting-dismissed-early',
      note: 'A non-Concentration ongoing spell cannot be dismissed early: `endConcentration` is about Concentration, and there is no command for a target ending a casting that is on it.',
    },
    {
      clause: 'a Fly Speed of 10 feet',
      why: 'movement-modes',
      note: 'The engine tracks one Speed and no movement modes, so a form whose only movement is flight has no way to say that walking is gone and flying is not.',
    },
    {
      clause: 'The target can enter and occupy the space of another creature',
      why: 'a-creature-fact-an-effect-overrides',
      note: 'Occupancy is a rule the engine owns outright — a willing move may not end in an occupied space, and whether one creature may pass through another reads size and allegiance — so the resolution path arrives here and answers wrongly. Nothing lets an effect say "this one may share", which is what other rules believing something different about a creature means. Recorded although the sentence trips no marker.',
    },
    {
      clause: 'Resistance to Bludgeoning, Piercing, and Slashing damage',
      why: 'expressible',
      note: 'IE-017 built the granted damage defence, and this is Stoneskin\'s sentence word for word — a `damage-defense` effect naming three types and one answer, ended by the casting through the door every other grant leaves by.',
    },
    {
      clause: 'Immunity to the Prone condition',
      why: 'a-condition-immunity-a-spell-grants',
      note: 'The condition half of the same sentence, and the one the damage half\'s build deliberately did not reach: `conditionApplicability` answers from a stat block and nothing an effect hangs reaches it.',
    },
    {
      clause: 'Advantage on Strength, Dexterity, and Constitution saving throws',
      why: 'expressible',
      note: 'Three `roll-mode` effects, each a saving throw narrowed by ability — which is what Beacon of Hope already writes twice in one definition, so a sentence naming three abilities is three entries in one effect list.',
    },
    {
      clause: "any objects it was carrying or holding can't be dropped",
      why: 'what-a-creature-is-holding',
      note: '`inventory` and `equipped` are real and only armour and weapons have a slot, so what a creature has in its hands is not a fact the engine holds and a rule forbidding it to let go has nothing to read.',
    },
    {
      clause: "the target can't attack or cast spells",
      why: 'an-action-a-spell-compels-or-forbids',
      note: 'The action economy is the engine\'s and the only lever a spell has on it is a condition the engine names; forbidding two actions and leaving the rest is a rider nothing expresses.',
    },
    {
      clause: 'one additional creature for each spell slot level above 3',
      why: 'expressible',
      note: '`TargetRule.extraPerSlotLevelAbove`, which is what every upcast target count in the catalogue already writes.',
    },
  ],
  gate: ['a-second-place-to-put-a-creature'],
  geas: ['a-casting-ended-by-a-trigger', 'a-duration-the-slot-changes', 'a-long-casting-time'],
  'giant-insect': ['a-stat-block-created-mid-fight'],
  glibness: ['a-roll-result-an-effect-replaces'],
  'globe-of-invulnerability': [
    'a-standing-effect-derived-from-where-a-creature-stands',
    'an-effect-that-suppresses-other-magic',
  ],
  'glyph-of-warding': [
    'a-casting-that-casts-another-spell',
    'a-choice-made-at-the-casting',
    'a-creature-type-predicate-an-area-reads',
    'a-long-casting-time',
  ],
  goodberry: ['what-a-creature-is-holding'],
  'greater-restoration': [
    'a-choice-made-at-the-casting',
    'a-hit-point-maximum-a-spell-moves',
    'an-ability-score-a-spell-changes',
    'an-exhaustion-level-a-spell-changes',
  ],
  'guardian-of-faith': [
    'a-casting-ended-by-a-trigger',
    'a-flat-amount-with-no-dice',
    'an-area-trigger-measured-from-a-point',
  ],
  'guards-and-wards': [
    'a-casting-that-casts-another-spell',
    'a-long-casting-time',
    'a-random-outcome-that-is-not-a-d20',
  ],
  'gust-of-wind': [
    'a-random-outcome-that-is-not-a-d20',
    'an-activation-that-resolves-an-area',
    'difficult-terrain-an-area-creates',
    'forced-movement-a-spell-causes',
  ],
  hallow: [
    {
      clause: 'Casting Time: 24 hours',
      why: 'a-long-casting-time',
      note: 'A printed field rather than a sentence, which is why a clause may name one: the largest blocker in the book appears in no paragraph. IE-034 built the out-of-combat half and the per-turn Magic action SRD requires in combat is what is left.',
    },
    {
      clause: 'the spell fails if the radius includes an area already under the effect of',
      why: 'a-cap-on-how-many-castings-run-at-once',
      note: 'A cap of one, read over ground rather than over a caster: `replacesPriorCasting` ends a prior casting and nothing refuses a new one, and `state.ongoing` holds every area a casting keeps without anything asking whether two of them overlap. Recorded although the sentence trips no marker, because the refusal is one the engine would have to make at the cast.',
    },
    {
      clause: 'Choose any of these creature types',
      why: 'a-choice-made-at-the-casting',
      note: 'A casting has nowhere to record a choice made when it was made — the gap Blindness/Deafness carries from the other side — and this one is read by every clause below it.',
    },
    {
      clause: 'Creatures of the chosen types',
      why: 'a-creature-type-predicate-an-area-reads',
      note: '`designatesUnaffected` is the one filter an area has and it is explicit ids chosen once; a predicate over a creature *type* is a different question, and IE-019 answered it for an outcome rather than for who is caught.',
    },
    {
      clause: "can't willingly enter the area",
      why: 'a-barrier-that-blocks-passage',
      note: 'Cover and line of sight stay declared rather than ray-cast, and a shape that stops a creature crossing it is the geometry\'s missing half — nothing in the mover\'s path may refuse it.',
    },
    {
      clause: "isn't possessed, Charmed, or Frightened by them while in the area",
      why: 'a-condition-immunity-a-spell-grants',
      note: 'An Immunity to a named condition, which `conditionApplicability` answers from a stat block and no effect may hang. Possession is not modelled at all, and the two conditions beside it are what makes this sentence debt rather than fiction.',
    },
    {
      clause: "can't gain the Frightened condition while in the area",
      why: 'a-condition-immunity-a-spell-grants',
      note: 'Courage, which is the same missing storage as the Hallowed Ward above it — an Immunity granted by a running effect rather than printed on a stat block.',
    },
    {
      clause: "Dead bodies interred in the area can't be turned into Undead",
      why: 'table',
      note: 'Nothing is interred and no corpse becomes a creature: Animate Dead is undefined and a body in the ground is not a record the engine holds, so a prohibition on raising one reaches nothing it could refuse.',
    },
    {
      clause: "can't enter or exit the area using teleportation",
      why: 'an-effect-that-suppresses-other-magic',
      note: 'IE-037 built the teleport and this is the ward against arriving — an area that stops a spell working inside it, which reads a casting the engine resolves elsewhere and has no state to sit in.',
    },
    {
      clause: 'have the Frightened condition while in the area',
      why: 'a-standing-effect-derived-from-where-a-creature-stands',
      note: 'Fear, and it is a value derived from current geometry rather than from a pair of enter-and-leave events that have to stay matched — the shape Spirit Guardians\' halved Speed already names.',
    },
    {
      clause: 'have Resistance to one damage type of your choice',
      why: 'a-standing-effect-derived-from-where-a-creature-stands',
      note: 'A granted Resistance is built and a Resistance that holds only while a creature stands somewhere is not: `defensesOf` reads a grant keyed by source, and nothing re-derives one from where the creature now is.',
    },
    {
      clause: 'No sound can emanate from within the area',
      why: 'table',
      note: 'Sound is not modelled, and the range marker fires here on "reach into it" rather than on any distance the engine measures — which is the marker list being a floor and the written sentence being what the floor is for.',
    },
    {
      clause: 'have Vulnerability to one damage type of your choice',
      why: 'a-standing-effect-derived-from-where-a-creature-stands',
      note: 'The same standing spatial effect as Resistance above it, on the other end of `applyDefenses`, and blocked on the same missing derivation rather than on the defence.',
    },
  ],
  haste: [
    'a-speed-an-effect-multiplies',
    'an-action-a-spell-compels-or-forbids',
    'an-effect-that-fires-when-the-casting-ends',
  ],
  heal: ['a-flat-amount-with-no-dice'],
  'heat-metal': ['damage-with-neither-an-attack-roll-nor-a-save', 'what-a-creature-is-holding'],
  'heroes-feast': [
    {
      clause: 'Casting Time: 10 minutes',
      why: 'a-long-casting-time',
      note: 'The printed field, not a sentence: the hour the feast takes to consume is the spell\'s own prose and this is the casting, which in combat is still refused on the per-turn Magic action IE-034 deferred.',
    },
    {
      clause: 'Resistance to Poison damage',
      why: 'expressible',
      note: 'IE-017\'s `damage-defense` effect, which Protection from Energy and Stoneskin already write; the 24 hours it lasts is an ordinary `durationSeconds`.',
    },
    {
      clause: 'Immunity to the Frightened and Poisoned conditions',
      why: 'a-condition-immunity-a-spell-grants',
      note: 'One sentence, two tables: the Resistance beside it is built and the condition Immunity is the half `conditionApplicability` never gained, which is exactly the bundle IE-017 left behind.',
    },
    {
      clause: 'Its Hit Point maximum also increases by 2d10',
      why: 'a-hit-point-maximum-a-spell-moves',
      note: 'The maximum is set when a creature is added and by advancement, and no effect moves one — so the Hit Points gained with it would be capped at a maximum the spell was supposed to have raised.',
    },
  ],
  heroism: [
    {
      clause: 'immune to the Frightened condition',
      why: 'a-condition-immunity-a-spell-grants',
      note: 'The spell\'s whole first half, and the shape this entry is filed under: an Immunity a running effect grants has nowhere to live, so a Frightened applied to this creature would simply land.',
    },
    {
      clause:
        'gains Temporary Hit Points equal to your spellcasting ability modifier at the start of each of its turns',
      why: 'a-payout-at-a-turn-boundary',
      note: 'A turn boundary raises saves and pays nothing out: `grantTemporaryHpTo` exists and no effect reaches it on a schedule, so Temporary Hit Points every turn for the duration have no hook.',
    },
    {
      clause: 'one additional creature for each spell slot level above 1',
      why: 'expressible',
      note: '`TargetRule.extraPerSlotLevelAbove`, which is what Bless and every other upcast target count already writes.',
    },
  ],
  // **Both of IE-035's shapes reached it**, which is what that task was for:
  // the extra 1d6 Necrotic "to the target whenever you hit it with an attack
  // roll" is `attack-rider` word for word, and "level 2 (up to 4 hours), 3–4
  // (up to 8 hours), or 5+ (24 hours)" is a `durationAtSlot` table — a
  // different table from Hunter's Mark's, which is why the field is
  // per-definition.
  //
  // **Two blockers are left, and the second is the one the brief missed.**
  // IE-035's own acceptance criterion said Hex would be blocked on its chosen
  // ability *alone*; SRD prints a third sentence — "If the target drops to 0
  // Hit Points before this spell ends, you can take a Bonus Action on a later
  // turn to curse a new creature" — which is Hunter's Mark's word for word and
  // is filed for that spell under the same shape. One sentence in two spells
  // must not have two answers, and the number it moves is a leverage count a
  // tranche gets planned from.
  hex: ['a-choice-made-at-the-casting', 'an-outcome-that-reads-the-targets-hit-points'],
  'holy-aura': [
    'a-spell-that-answers-a-later-attack',
    'a-standing-effect-derived-from-where-a-creature-stands',
  ],
  'ice-knife': ['a-second-roll-sequenced-after-the-first'],
  imprisonment: [
    'a-choice-made-at-the-casting',
    'a-long-casting-time',
    'a-second-place-to-put-a-creature',
    'an-effect-that-suppresses-other-magic',
  ],
  'irresistible-dance': [
    'a-success-branch-that-does-something',
    'an-action-a-spell-compels-or-forbids',
  ],
  levitate: [
    'a-target-rule-the-format-cannot-state',
    'forced-movement-a-spell-causes',
    'movement-modes',
  ],
  'magic-circle': [
    {
      clause: 'Casting Time: 1 minute',
      why: 'a-long-casting-time',
      note: 'The printed field. The prose says "1 minute" nowhere, which is why the phrase carries the field\'s own label: a bare "1 minute" would be unique here and is not in Wind Walk, and one convention that works for both is the one worth having.',
    },
    {
      clause: 'a 10-foot-radius, 20-foot-tall Cylinder of magical energy',
      why: 'expressible',
      note: 'A `cylinder` area with a radius and a height, anchored at a point — which Sleet Storm and Moonbeam already write, and which the geometry tests exactly rather than by sampling.',
    },
    {
      clause: 'Choose one or more of the following types of creatures',
      why: 'a-choice-made-at-the-casting',
      note: 'A blocker the bare list had missed. Hallow states the same rule in different words — "Choose any of these creature types" — and had recorded it, which is the re-file-both-ends-of-a-shared-rule discipline arriving between two spells rather than inside one, and the reason the id is a shape rather than a sentence.',
    },
    {
      clause: "can't willingly enter the Cylinder by nonmagical means",
      why: 'a-barrier-that-blocks-passage',
      note: 'Nothing in a mover\'s path may refuse it: cover and line of sight stay declared rather than ray-cast, and a shape that stops a creature crossing it is the geometry\'s missing half.',
    },
    {
      clause: 'use teleportation or interplanar travel',
      why: 'an-effect-that-suppresses-other-magic',
      note: 'The ward against arriving, which IE-037 did not build when it built the teleport: an area that stops a spell working inside it reads a casting the engine resolves elsewhere.',
    },
    {
      clause: 'Disadvantage on attack rolls against targets within the Cylinder',
      why: 'a-filter-on-the-attackers-creature-type',
      note: 'A `RollSelector` narrows by roll family, relation, ability and skill and has no type axis at either end, so "creatures of the chosen types have Disadvantage" cannot be said even in principle.',
    },
    {
      clause: "can't be possessed by or gain the Charmed or Frightened condition from the creature",
      why: 'a-condition-immunity-a-spell-grants',
      note: 'An Immunity narrowed to a source, which is narrower still than the one this shape names: `conditionApplicability` holds a stat block\'s qualified entries and no effect may add one.',
    },
    {
      clause: 'cause its magic to operate in the reverse direction',
      why: 'a-choice-made-at-the-casting',
      note: 'A second choice made at the casting, beside the creature types: the same Cylinder read outwards, keeping the chosen types in rather than out. The barrier it inverts is this entry\'s own first blocker, so no count moves — what was missing was the sentence, which trips no marker and had nothing written for it.',
    },
    {
      clause: 'The duration increases by 1 hour for each spell slot level above 3',
      why: 'expressible',
      note: 'IE-035\'s `durationAtSlot` is a table of slot level to whole seconds and the SRD\'s arithmetic transcribes into one: a band per level from 4 upward, each longer than the one below it, which is what the validator asks of it.',
    },
  ],
  'magic-jar': [
    'a-long-casting-time',
    'a-second-place-to-put-a-creature',
    'an-ability-score-a-spell-changes',
  ],
  'magic-missile': [
    'a-spells-effects-applied-to-different-targets',
    'damage-with-neither-an-attack-roll-nor-a-save',
  ],
  'magic-weapon': ['a-rider-on-a-later-weapon-attack'],
  'magnificent-mansion': ['a-long-casting-time', 'a-second-place-to-put-a-creature'],
  'major-image': ['a-duration-the-slot-changes'],
  'mass-heal': [
    'a-flat-amount-with-no-dice',
    'a-spells-effects-applied-to-different-targets',
  ],
  maze: ['a-second-place-to-put-a-creature'],
  'meld-into-stone': ['a-world-fact-nothing-can-represent'],
  'meteor-swarm': ['a-wall-or-several-templates-in-one-area'],
  // The spell the query predicted IE-017 would finish and did not — the
  // sharpest correction this map has made, and the reason its entry is the
  // first anybody should be able to read back.
  'mind-blank': [
    {
      clause: 'Immunity to Psychic damage',
      why: 'expressible',
      note: 'IE-017 built exactly this half: a `damage-defense` effect naming a type and an answer, ended by the casting through the door every other grant leaves by.',
    },
    {
      clause: 'the Charmed condition',
      why: 'a-condition-immunity-a-spell-grants',
      note: 'And this is the half it did not, which the retired bundle had claimed was "the same storage and the same sentence shape". The storage is different — a stat block prints damage types and conditions in one run and the engine treats them completely differently — and one sentence of one spell is the whole of what is left.',
    },
  ],
  'mirage-arcane': ['a-long-casting-time', 'difficult-terrain-an-area-creates'],
  'mirror-image': [
    'a-random-outcome-that-is-not-a-d20',
    'a-spell-that-answers-a-later-attack',
    'senses-beyond-declared-sight',
  ],
  // SRD ends the **invisibility** here and not the casting — "The double lasts
  // for the duration, but the invisibility ends immediately after you make an
  // attack roll, deal damage, or cast a spell" — so IE-032's three causes name
  // the moment and nothing can say that it takes one effect rather than the
  // whole spell. And the double is Project Image's sentence word for word:
  // "You can see through its eyes and hear through its ears as if you were
  // located where it is."
  mislead: ['a-casting-ended-by-a-trigger', 'a-second-place-to-put-a-creature'],
  'modify-memory': ['a-casting-ended-by-a-trigger'],
  'pass-without-trace': ['a-standing-effect-derived-from-where-a-creature-stands'],
  'phantasmal-force': ['a-payout-at-a-turn-boundary', 'an-area-trigger-measured-from-a-point'],
  'phantom-steed': ['a-casting-ended-by-a-trigger', 'a-stat-block-created-mid-fight'],
  'planar-ally': ['a-long-casting-time', 'a-stat-block-created-mid-fight'],
  'planar-binding': [
    'a-duration-the-slot-changes',
    'a-long-casting-time',
    'an-effect-that-suppresses-other-magic',
  ],
  'plant-growth': [
    'a-choice-made-at-the-casting',
    'an-area-that-filters-its-catch',
    'difficult-terrain-an-area-creates',
  ],
  polymorph: ['a-casting-ended-by-a-trigger', 'a-target-rule-the-format-cannot-state'],
  'power-word-heal': [
    'a-flat-amount-with-no-dice',
    'an-action-a-spell-compels-or-forbids',
  ],
  'power-word-kill': [
    'an-outcome-that-reads-the-targets-hit-points',
    'damage-with-neither-an-attack-roll-nor-a-save',
  ],
  'power-word-stun': ['an-outcome-that-reads-the-targets-hit-points'],
  'prayer-of-healing': [
    'a-deadline-anchored-to-a-rest',
    'a-long-casting-time',
    'a-rest-an-effect-gives-or-denies',
  ],
  'prismatic-spray': [
    'a-random-outcome-that-is-not-a-d20',
    'a-repeat-save-counted-to-a-tally',
    'a-repeat-save-that-does-something-on-a-failure',
    'a-second-place-to-put-a-creature',
    'a-spells-effects-applied-to-different-targets',
  ],
  'prismatic-wall': [
    'a-barrier-that-blocks-passage',
    'a-repeat-save-counted-to-a-tally',
    'a-second-place-to-put-a-creature',
    'a-wall-or-several-templates-in-one-area',
    'an-effect-that-suppresses-other-magic',
  ],
  'private-sanctum': [
    'a-barrier-that-blocks-passage',
    'a-long-casting-time',
    'an-effect-that-suppresses-other-magic',
  ],
  'programmed-illusion': [],
  'project-image': ['a-casting-ended-by-a-trigger', 'a-second-place-to-put-a-creature'],
  'protection-from-evil-and-good': [
    {
      clause: 'protected against creatures that are Aberrations, Celestials, Elementals, Fey, Fiends, or Undead',
      why: 'a-filter-on-the-attackers-creature-type',
      note: 'The clause CLAUDE.md names verbatim with this spell among its consumers: every other creature-type rule in the book is about the target, and IE-019 built that one. A type read off the *attacker* has no axis on any selector.',
    },
    {
      clause: 'Creatures of those types have Disadvantage on attack rolls',
      why: 'a-filter-on-the-attackers-creature-type',
      note: 'The same filter, arriving as a mode rather than as a targeting rule: `rollModesFor` asks both ends of an attack and neither end may ask what the attacker is.',
    },
    {
      clause: 'gain the Charmed or Frightened conditions from them',
      why: 'a-condition-immunity-a-spell-grants',
      note: 'An Immunity to two named conditions, narrowed to a source, which is the storage `conditionApplicability` holds for a stat block and no effect may add to.',
    },
    {
      clause: 'Advantage on any new saving throw against the relevant effect',
      why: 'a-mode-on-the-save-a-spell-forces',
      note: 'The one clause that genuinely needs a save to remember what it was against — the sentence that has blocked Countercharm since it was written, and the only claimant keeping this shape in the vocabulary after IE-030 took the other five.',
    },
  ],
  'purify-food-and-drink': [],
  'raise-dead': [
    'a-deadline-anchored-to-a-rest',
    'a-long-casting-time',
    'a-selector-for-every-d20-test',
    'healing-that-raises-the-dead',
  ],
  'ray-of-enfeeblement': [
    'a-damage-penalty-a-spell-grants',
    'a-one-shot-roll-modifier',
    'a-selector-for-every-d20-test',
    'a-success-branch-that-does-something',
  ],
  regenerate: ['a-long-casting-time', 'a-payout-at-a-turn-boundary'],
  reincarnate: [
    'a-long-casting-time',
    'a-random-outcome-that-is-not-a-d20',
    'healing-that-raises-the-dead',
  ],
  'resilient-sphere': [
    'a-barrier-that-blocks-passage',
    'a-target-rule-the-format-cannot-state',
    'forced-movement-a-spell-causes',
  ],
  resistance: ['a-reduction-an-effect-applies-to-damage'],
  resurrection: [
    'a-deadline-anchored-to-a-rest',
    'a-long-casting-time',
    'a-selector-for-every-d20-test',
    'healing-that-raises-the-dead',
  ],
  'reverse-gravity': ['falling', 'forced-movement-a-spell-causes'],
  revivify: ['healing-that-raises-the-dead'],
  sanctuary: ['a-spell-that-answers-a-later-attack'],
  'scorching-ray': ['several-attack-rolls-from-one-casting'],
  scrying: ['a-fact-only-the-table-can-declare', 'a-long-casting-time'],
  'searing-smite': ['a-repeat-save-that-does-something-on-a-failure'],
  'secret-chest': ['a-random-outcome-that-is-not-a-d20', 'a-second-place-to-put-a-creature'],
  seeming: ['a-spells-effects-applied-to-different-targets'],
  sending: ['a-random-outcome-that-is-not-a-d20', 'a-second-place-to-put-a-creature'],
  sequester: ['a-casting-ended-by-a-trigger', 'an-effect-that-suppresses-other-magic'],
  shapechange: ['a-target-rule-the-format-cannot-state'],
  shillelagh: [
    'a-casting-ended-by-a-trigger',
    'a-choice-made-at-the-casting',
    'a-rider-on-a-later-weapon-attack',
  ],
  'shining-smite': [
    'a-condition-benefit-an-effect-takes-away',
    'a-spells-effects-applied-to-different-targets',
  ],
  silence: [
    'a-condition-that-ends-when-its-holder-leaves-an-area',
    'a-standing-effect-derived-from-where-a-creature-stands',
    'an-action-a-spell-compels-or-forbids',
  ],
  simulacrum: [
    'a-deadline-anchored-to-a-rest',
    'a-long-casting-time',
    'a-stat-block-created-mid-fight',
  ],
  sleep: [
    'a-casting-ended-by-a-trigger',
    'a-check-another-creature-may-attempt',
    'a-repeat-save-that-does-something-on-a-failure',
    'an-outcome-that-reads-the-targets-defences',
  ],
  'sleet-storm': ['an-outcome-that-breaks-concentration', 'difficult-terrain-an-area-creates'],
  slow: ['a-random-outcome-that-is-not-a-d20', 'an-action-a-spell-compels-or-forbids'],
  'sorcerous-burst': ['a-die-behaviour-a-spell-asks-for'],
  'spare-the-dying': [
    'a-range-that-scales-with-caster-level',
    'an-effect-that-stabilises-a-dying-creature',
  ],
  'speak-with-plants': ['difficult-terrain-an-area-creates'],
  'spike-growth': [
    'a-distance-a-creature-travels-inside-an-area',
    'difficult-terrain-an-area-creates',
  ],
  'storm-of-vengeance': [
    'an-activation-that-resolves-an-area',
    'an-area-trigger-on-the-casters-turn',
    'damage-with-neither-an-attack-roll-nor-a-save',
    'difficult-terrain-an-area-creates',
  ],
  'summon-dragon': ['a-stat-block-created-mid-fight'],
  symbol: [
    'a-check-another-creature-may-attempt',
    'a-choice-made-at-the-casting',
    'a-creature-type-predicate-an-area-reads',
    'a-long-casting-time',
    'an-action-a-spell-compels-or-forbids',
  ],
  telekinesis: [
    'a-target-rule-the-format-cannot-state',
    'an-activation-that-forces-a-saving-throw',
    'forced-movement-a-spell-causes',
    'what-a-creature-is-holding',
  ],
  teleport: ['a-random-outcome-that-is-not-a-d20', 'a-second-place-to-put-a-creature'],
  'teleportation-circle': ['a-long-casting-time', 'a-second-place-to-put-a-creature'],
  thaumaturgy: ['a-cap-on-how-many-castings-run-at-once', 'a-choice-made-at-the-casting'],
  'time-stop': [
    'a-casting-ended-by-a-trigger',
    'a-random-outcome-that-is-not-a-d20',
    'a-turn-a-spell-inserts-into-the-order',
  ],
  'tiny-hut': [
    'a-barrier-that-blocks-passage',
    'a-casting-ended-by-a-trigger',
    'a-long-casting-time',
    'an-effect-that-suppresses-other-magic',
  ],
  'true-polymorph': [
    'a-casting-ended-by-a-trigger',
    'a-stat-block-created-mid-fight',
    'a-target-rule-the-format-cannot-state',
    'an-effect-that-fires-when-the-casting-ends',
  ],
  'true-resurrection': [
    'a-flat-amount-with-no-dice',
    'a-long-casting-time',
    'healing-that-raises-the-dead',
  ],
  'true-strike': ['a-rider-on-a-later-weapon-attack'],
  tsunami: [
    'a-long-casting-time',
    'a-wall-or-several-templates-in-one-area',
    'an-area-that-moves-by-itself',
    'an-area-trigger-on-the-casters-turn',
  ],
  'unseen-servant': ['a-stat-block-created-mid-fight'],
  'wall-of-fire': ['a-wall-or-several-templates-in-one-area', 'an-area-that-filters-its-catch'],
  'wall-of-ice': [
    'a-barrier-that-blocks-passage',
    'a-wall-or-several-templates-in-one-area',
    'forced-movement-a-spell-causes',
  ],
  'wall-of-stone': [
    'a-barrier-that-blocks-passage',
    'a-wall-or-several-templates-in-one-area',
    'an-effect-that-fires-when-the-casting-ends',
    'forced-movement-a-spell-causes',
  ],
  'wall-of-thorns': ['a-wall-or-several-templates-in-one-area', 'difficult-terrain-an-area-creates'],
  'warding-bond': [
    'a-casting-ended-by-a-trigger',
    'a-spell-that-answers-a-later-attack',
    'a-standing-effect-derived-from-where-a-creature-stands',
  ],
  'wind-walk': [
    {
      clause: 'Casting Time: 1 minute',
      why: 'a-long-casting-time',
      note: 'The printed field, and the spell that made the label part of the convention: this paragraph says "1 minute" three times and none of them is the casting.',
    },
    {
      clause: 'up to ten willing creatures of your choice within range',
      why: 'expressible',
      note: 'A `targets` rule with a count and a range, checked against every id the caller names before a slot is spent.',
    },
    {
      clause: 'a Fly Speed of 300 feet',
      why: 'movement-modes',
      note: 'The engine tracks one Speed and no movement modes, so a form that flies and cannot walk has no way to say which of the two it has.',
    },
    {
      clause: 'Immunity to the Prone condition',
      why: 'a-condition-immunity-a-spell-grants',
      note: 'Gaseous Form prints the same clause and both are blocked on the same half of the same bundle: the damage defence beside it is built and the condition Immunity is not.',
    },
    {
      clause: 'Resistance to Bludgeoning, Piercing, and Slashing damage',
      why: 'expressible',
      note: 'IE-017\'s `damage-defense` effect, one clause naming three types and one answer, which is Stoneskin\'s sentence word for word.',
    },
    {
      clause: 'The only actions a target can take in this form',
      why: 'an-action-a-spell-compels-or-forbids',
      note: 'The action economy is the engine\'s and the only lever a spell has on it is a condition the engine names; permitting exactly two actions and forbidding the rest is a rider nothing expresses.',
    },
    {
      clause: 'Reverting takes 1 minute, during which the target has the Stunned condition',
      why: 'an-activation-taken-by-somebody-other-than-the-caster',
      note: 'A blocker the bare list had missed. The Stunned is an ordinary condition with a deadline; what has no shape is the moment that starts it — a later action the *target* takes through the casting, where `SpellActivation` pins the caster.',
    },
    {
      clause: 'the target can revert to cloud form',
      why: 'an-activation-taken-by-somebody-other-than-the-caster',
      note: 'The same action in the other direction, and the reason the spell needs two of them: each is a Magic action spent by a creature who is not the caster.',
    },
    {
      clause: 'the target descends 60 feet per round',
      why: 'falling',
      note: 'Nothing drops, nothing takes fall damage, and no rate of descent has anything to be measured against — the one Reaction trigger CLAUDE.md names as left after Counterspell.',
    },
    {
      clause: 'it falls the remaining distance',
      why: 'falling',
      note: 'The other half of the same paragraph, and the half that would deal damage: a fall is not modelled at all, so the distance is a number with nothing to convert it.',
    },
  ],
  'wind-wall': ['a-barrier-that-blocks-passage', 'a-wall-or-several-templates-in-one-area'],
  wish: [
    'a-casting-that-casts-another-spell',
    'a-deadline-anchored-to-a-rest',
    'a-flat-amount-with-no-dice',
    'a-random-outcome-that-is-not-a-d20',
    'a-roll-result-an-effect-replaces',
    'an-ability-score-a-spell-changes',
    'an-exhaustion-level-a-spell-changes',
  ],
  'zone-of-truth': [],
};

// — the query ————————————————————————————————————————————————————————————————

/** Every definition the engine resolves something of, by id. */
const DEFINED: ReadonlySet<string> = new Set(SPELL_DEFINITIONS.map((d) => d.id));

/** As much of a parsed spell as a blocker may be anchored to. */
interface ParsedSpell {
  readonly id: string;
  readonly castingTime: string;
  readonly range: string;
  readonly duration: string;
  readonly description: string;
  readonly higherLevel?: string;
}

let parsed: readonly ParsedSpell[] | undefined;

/**
 * The book, read off disk once.
 *
 * The same reader the guards use, for the same reason: `SPELL_INDEX` carries a
 * spell's id, level, school and class list and deliberately not its
 * description, because the engine is pure and cannot read a file at runtime.
 * This is not the engine.
 */
const parsedSpells = (): readonly ParsedSpell[] => {
  parsed ??= JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../../srd/src/generated/spells.json', import.meta.url)),
      'utf8',
    ),
  ) as readonly ParsedSpell[];
  return parsed;
};

export const parsedSpellIds = (): readonly string[] => parsedSpells().map((spell) => spell.id);

/** The SRD condition names, which a sentence names directly far more often than it says "condition". */
const CONDITIONS =
  'Blinded|Charmed|Deafened|Exhaustion|Frightened|Grappled|Incapacitated|Invisible|Paralyzed|Petrified|Poisoned|Prone|Restrained|Stunned|Unconscious';

/**
 * The mechanics the engine demonstrably owns, as patterns over one sentence.
 *
 * `spell-honesty.test.ts` wrote these to read a sentence **somebody here wrote
 * about a gap**, which is why they are wider than {@link MECHANICAL_MARKERS}:
 * a gap is described in whatever words fit, so "the save has Advantage if you
 * or your allies are fighting the target" carries no "Advantage on" and the
 * pattern is the word rather than the book's phrase. Pointed at the book's own
 * sentences they are wider still, and that is the right way round for a floor —
 * an over-firing marker costs a written sentence, and an under-firing one costs
 * a blocker nobody records.
 *
 * Every entry names something the engine resolves today: the generator and
 * typed damage, vitals, `rollSavingThrow` and `rollAbilityCheck`,
 * `resolveAttack`, `armorClassOf`, `applyConditionTo`, `defensesOf`,
 * `combineRollModes`, Speed and the movement budget, declared Difficult
 * Terrain, forced movement, positions, the action economy and `mayAct`,
 * `mustBeType`, the ruler, declared sight, resource pools, Concentration,
 * `releaseCasting`, death, and what a creature owns and wears. A sentence
 * naming none of them is left alone.
 */
export const CLAUSE_MARKERS = [
  ['dice', /\b\d+d\d+\b/],
  ['damage', /\bdamage(d|s)?\b/i],
  ['hit-points', /\bHit Points?\b/],
  ['saving-throw', /\bsav(e|es|ing throw)s?\b/i],
  ['ability-check', /\bcheck\b/i],
  ['attack-roll', /\battack(s|ed|ing)?\b/i],
  ['armor-class', /\bArmou?r Class\b|\bAC\b/],
  ['condition', new RegExp(`\\bcondition\\b|\\b(${CONDITIONS})\\b`, 'i')],
  ['defence', /\b(Resistance|Immunity|Vulnerability|immune)\b/i],
  ['roll-mode', /\b(Advantage|Disadvantage)\b/],
  ['speed', /\bSpeed\b/],
  ['difficult-terrain', /\bDifficult Terrain\b/i],
  ['forced-movement', /\bpush(ed|es)?\b/i],
  ['teleport', /\bteleport/i],
  [
    'action-economy',
    /\b(Reaction|Bonus Action|Magic action|Study action|Opportunity Attacks?|Dash(es)?)\b/,
  ],
  [
    'creature-type',
    /\b(Aberration|Beast|Celestial|Construct|Dragon|Elemental|Fey|Fiend|Giant|Humanoid|Monstrosity|Ooze|Plant|Undead|Zombie)s?\b/,
  ],
  ['range', /\bwithin \d+ (feet|foot)\b|\breach\b|\brange\b/i],
  ['senses', /\b(see|sees|seen|sight|perceives|Blindsight|Truesight|hidden)\b/i],
  ['spell-slot', /\bslot\b/i],
  ['concentration', /\bConcentration\b/],
  ['movement', /\bmovement\b|\bmoves?\b|\bmoving\b/i],
  ['death', /\b(kill(ed|s)?|dies|died|dead)\b/i],
  ['dispel', /\bdispel/i],
  ['equipment', /\b(holding|carries|carrying|wearing|dons|equipped)\b/i],
] as const satisfies readonly (readonly [string, RegExp])[];

export type ClauseMarkerId = (typeof CLAUSE_MARKERS)[number][0];

/** The mechanics this sentence names. */
export const markersIn = (text: string): readonly ClauseMarkerId[] =>
  CLAUSE_MARKERS.filter(([, pattern]) => pattern.test(text)).map(([marker]) => marker);

/**
 * Emphasis is kept and smart quotes and wrapping are not: the wording is the
 * claim and the typesetting is not, so both sides of every comparison here go
 * through this.
 *
 * Exported because a guard that normalised a phrase differently from the
 * anchoring check would be two spellings of one question — which is what
 * `printedOrder` in `blocked-on.test.ts` was, harmlessly, until it asked for
 * this one.
 */
export const flatten = (text: string): string =>
  text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * The longest sentence the splitter may return before it has plainly failed.
 *
 * The whole book's longest is Confusion's 298 characters, so this is generous
 * on purpose: it does not measure prose style, it catches a paragraph whose
 * punctuation the splitter does not know. **That is the one failure mode a
 * quiet splitter has** — under-splitting returns a run of text whole, one
 * adjudication covers all of it, and the coverage guard reports nothing while
 * checking nothing. Over-splitting reports itself, because a phrase that
 * straddles the seam then matches no unit.
 */
export const MAX_SENTENCE = 400;

/** A paragraph the splitter could not divide, which is loud rather than quiet. */
export class SentenceSplitError extends Error {}

/** A run of bold or italic on its own is a label the book prints, not a sentence. */
const HEADING = /^[*_]{1,3}[^*_]+[*_]{1,3}$/;

/**
 * SRD prose, divided into sentences.
 *
 * Approximate, and it says so by failing rather than by shrugging. Three rules
 * and no more, each transcribed from what the book does: a line break ends a
 * sentence, because the book's bullets and headed paragraphs are lines; a
 * terminator followed by whitespace ends one, with a closing quotation mark
 * allowed between them, which is the only place in the corpus a terminator is
 * not the last character; and a **label** — `**Fear.**`, `**Resistance.**` —
 * joins the sentence after it rather than standing as one, because it is
 * typography and because `**Resistance.**` alone trips a marker and names no
 * rule.
 *
 * Representing these boundaries in the parser was considered and refused: it
 * would be a data model with one consumer. This is a test-time read over prose
 * the repository already parses.
 */
export function splitSentences(text: string): readonly string[] {
  const sentences: string[] = [];
  for (const line of text.split(/\n+/)) {
    let label = '';
    for (const piece of line
      .split(/(?<=[.!?]["'”’)]?)\s+/)
      .map(flatten)
      .filter((part) => part.length > 0)) {
      if (HEADING.test(piece)) {
        label = label === '' ? piece : `${label} ${piece}`;
        continue;
      }
      sentences.push(label === '' ? piece : `${label} ${piece}`);
      label = '';
    }
    if (label !== '') sentences.push(label);
  }
  for (const sentence of sentences) {
    if (sentence.length > MAX_SENTENCE) {
      throw new SentenceSplitError(
        `a sentence of ${sentence.length} characters is a paragraph the splitter could not divide: "${sentence.slice(0, 80)}…"`,
      );
    }
  }
  return sentences;
}

const spellByIdOrThrow = (spellId: string): ParsedSpell => {
  const spell = parsedSpells().find((entry) => entry.id === spellId);
  if (spell === undefined) throw new Error(`${spellId} is not a parsed SRD spell`);
  return spell;
};

/**
 * The printed facts no sentence of a spell's prose states.
 *
 * A casting time of a minute or more is the largest blocker in the book and it
 * appears nowhere in any paragraph — it is a field the SRD prints above one. So
 * a clause may name a field as well as a sentence, and the two are kept apart
 * because only the sentences are a **claim**: `Range: Touch` would otherwise
 * trip the range marker for every spell in the book and demand an adjudication
 * of every entry for saying where it reaches.
 */
export const printedFieldsOf = (spellId: string): readonly string[] => {
  const spell = spellByIdOrThrow(spellId);
  return [
    `Casting Time: ${spell.castingTime}`,
    `Range: ${spell.range}`,
    `Duration: ${spell.duration}`,
  ];
};

/** A spell's own prose, as sentences — the text that carries its claims. */
export const sentencesOf = (spellId: string): readonly string[] => {
  const spell = spellByIdOrThrow(spellId);
  return splitSentences(`${spell.description}\n${spell.higherLevel ?? ''}`);
};

/** Everything a clause may be anchored to: the printed fields, then the prose. */
export const printedUnitsOf = (spellId: string): readonly string[] => [
  ...printedFieldsOf(spellId),
  ...sentencesOf(spellId),
];

/** The clauses an entry names, which for a grandfathered entry is none. */
export const clausesIn = (entry: readonly BlockedEntry[]): readonly BlockedClause[] =>
  entry.filter((blocker): blocker is BlockedClause => typeof blocker !== 'string');

/**
 * The shapes an entry names, however it names them.
 *
 * Deduplicated and sorted, because two sentences of one spell may be blocked on
 * one shape — Hallow prints three standing effects — and a shape a spell needs
 * twice is not a spell that needs two shapes.
 */
export const blockersIn = (entry: readonly BlockedEntry[]): readonly ShapeId[] =>
  [
    ...new Set(
      entry.flatMap((blocker) =>
        typeof blocker === 'string'
          ? [blocker]
          : blocker.why === 'table' || blocker.why === 'expressible'
            ? []
            : [blocker.why],
      ),
    ),
  ].sort();

/** The shapes blocking one spell, by id. */
export const blockersOf = (spellId: string): readonly ShapeId[] =>
  blockersIn(BLOCKED_ON[spellId] ?? []);

/** A sentence naming a mechanic the engine owns that no clause answers. */
export interface SentenceGap {
  readonly spell: string;
  readonly sentence: string;
  readonly markers: readonly ClauseMarkerId[];
}

/**
 * The sentences of a spell's prose that name a mechanic and carry no clause.
 *
 * Parameterised over the entry for the reason {@link coverageGaps} is: a guard
 * that can only be run against the data it already agrees with is not a guard,
 * so the tests drive this with an entry built to be caught before running it on
 * the real map.
 */
export const sentenceGaps = (
  spellId: string,
  entry: readonly BlockedEntry[] = BLOCKED_ON[spellId] ?? [],
): readonly SentenceGap[] => {
  const phrases = clausesIn(entry).map((blocker) => flatten(blocker.clause));
  return sentencesOf(spellId)
    .filter((sentence) => markersIn(sentence).length > 0)
    .filter((sentence) => !phrases.some((phrase) => sentence.includes(phrase)))
    .map((sentence) => ({ spell: spellId, sentence, markers: markersIn(sentence) }));
};

/** A clause phrase the spell's printed entry does not say exactly once. */
export interface UnanchoredClause {
  readonly spell: string;
  readonly clause: string;
  /** How many times the phrase occurs across the printed units. */
  readonly matches: number;
}

const occurrences = (text: string, phrase: string): number => {
  let count = 0;
  for (let at = text.indexOf(phrase); at >= 0; at = text.indexOf(phrase, at + phrase.length)) {
    count += 1;
  }
  return count;
};

/**
 * The phrases the spell's printed entry does not say exactly once.
 *
 * Zero matches is a phrase that was reworded, mistyped, or assembled across two
 * of the book's sentences; more than one is a phrase that would silently take a
 * neighbouring sentence's licence. Both are the same defect — *this clause does
 * not name one thing the spell prints* — so both are reported here with the
 * count, which is what tells the reader which of the two it is.
 *
 * Over bare phrases rather than over one map's entries, because two of the
 * three populations anchor a clause this way and the third always did: one
 * question, one implementation.
 */
export const unanchoredPhrases = (
  spellId: string,
  phrases: readonly string[],
): readonly UnanchoredClause[] => {
  const units = printedUnitsOf(spellId);
  return phrases.flatMap((clause) => {
    const phrase = flatten(clause);
    const matches = units.reduce((total, unit) => total + occurrences(unit, phrase), 0);
    return matches === 1 ? [] : [{ spell: spellId, clause, matches }];
  });
};

/** The same, asked of a {@link BLOCKED_ON} entry. */
export const unanchoredClauses = (
  spellId: string,
  entry: readonly BlockedEntry[] = BLOCKED_ON[spellId] ?? [],
): readonly UnanchoredClause[] =>
  unanchoredPhrases(
    spellId,
    clausesIn(entry).map((blocker) => blocker.clause),
  );

/**
 * Has somebody read this spell's paragraph sentence by sentence?
 *
 * Two things, and the first is why an entry that names no clause can never be
 * complete however quiet its prose: an entry with no clause records no reading,
 * and "no sentence names a mechanic" is a *conclusion* somebody has to have
 * reached rather than the absence of one. So a clause is required, and then
 * every sentence that names a mechanic must carry one.
 */
export const isSentenceComplete = (spellId: string): boolean => {
  const entry = BLOCKED_ON[spellId] ?? [];
  return clausesIn(entry).length > 0 && sentenceGaps(spellId, entry).length === 0;
};

/**
 * Parsed spells with no definition at all — the population {@link BLOCKED_ON}
 * covers.
 *
 * Parameterised over both lists rather than reading them, so the completeness
 * guard can be driven with a **synthetic** catalogue it must catch. A guard
 * that can only be run against the data it already agrees with is not a guard.
 */
export const undefinedSpells = (
  parsed: readonly string[],
  defined: ReadonlySet<string>,
): readonly string[] => parsed.filter((id) => !defined.has(id)).sort();

/**
 * The two ways `BLOCKED_ON` can fail to cover its population, both reported.
 *
 * `unrecorded` is an undefined spell with no entry — a spell added to the
 * catalogue that nobody has read. `stale` is an entry for a spell that is not
 * undefined, which after a definition lands is the other half of the same
 * drift.
 */
export const coverageGaps = (
  parsed: readonly string[],
  defined: ReadonlySet<string>,
  blockedOn: Readonly<Record<string, readonly unknown[]>> = BLOCKED_ON,
): { readonly unrecorded: readonly string[]; readonly stale: readonly string[] } => {
  const open = new Set(undefinedSpells(parsed, defined));
  return {
    unrecorded: [...open].filter((id) => blockedOn[id] === undefined).sort(),
    stale: Object.keys(blockedOn)
      .filter((id) => !open.has(id))
      .sort(),
  };
};

export interface ShapeConsumers {
  readonly shape: ShapeId;
  /** Executed definitions carrying a clause adjudicated to this shape. */
  readonly executed: readonly string[];
  /** Tracked definitions whose SRD prose was adjudicated to it. */
  readonly tracked: readonly string[];
  /** Parsed spells with no definition that this shape blocks. */
  readonly undefined: readonly string[];
  /** Every spell it touches, across all three populations. */
  readonly blocks: readonly string[];
  /**
   * The spells it is the **only** blocker for.
   *
   * This is the number a leverage ranking wants and the one nobody had:
   * building the shape finishes exactly these. An executed spell is never here
   * — it carries at least the debt this shape names, and finishing it finishes
   * a definition that already runs — so `unblocks` is drawn from the undefined
   * population, where "one blocker" means "write the definition".
   */
  readonly unblocks: readonly string[];
  /**
   * Of those, the ones whose paragraph somebody has read sentence by sentence.
   *
   * **The two halves of `unblocks` are a different claim each, and that is the
   * whole of why they are reported apart.** A sentence-complete entry says: I
   * read every sentence this spell prints, and this shape is the only one it
   * needs. An entry that is not says: nobody has recorded reading it, and every
   * wrong prediction this map has made was a sentence nobody had read — Mind
   * Blank's condition half, Enthrall's automatic success, Hex's third
   * paragraph. The first number is what a tranche may be planned from; the
   * second is what a tranche may be planned from *after somebody reads it*.
   */
  readonly unblocksRead: readonly string[];
  /** And the ones still grandfathered, which is most of them. */
  readonly unblocksUnread: readonly string[];
}

const sorted = (ids: Iterable<string>): readonly string[] => [...new Set(ids)].sort();

/** How many spells a shape blocks, and which — over all three populations. */
export function consumersOf(shape: ShapeId): ShapeConsumers {
  const executed = sorted(
    Object.entries(ADJUDICATED)
      .filter(([, entries]) => entries.some((entry) => entry.why === shape))
      .map(([id]) => id),
  );
  const tracked = sorted(
    Object.entries(TRACKED_ADJUDICATED)
      .filter(([, entries]) => entries.some((entry) => entry.why === shape))
      .map(([id]) => id),
  );
  const open = sorted(
    Object.entries(BLOCKED_ON)
      .filter(([, entry]) => blockersIn(entry).includes(shape))
      .map(([id]) => id),
  );
  const unblocks = open.filter((id) => blockersOf(id).length === 1);
  return {
    shape,
    executed,
    tracked,
    undefined: open,
    blocks: sorted([...executed, ...tracked, ...open]),
    unblocks,
    unblocksRead: unblocks.filter(isSentenceComplete),
    unblocksUnread: unblocks.filter((id) => !isSentenceComplete(id)),
  };
}

/**
 * Every shape with its consumers, heaviest first.
 *
 * Ordered by what building it **finishes** and then by what it touches, which
 * is the ranking `PROGRESS.md` was writing by hand. Ties break on the id so the
 * report is stable.
 */
export function allShapeConsumers(): readonly ShapeConsumers[] {
  return (Object.keys(MISSING_SHAPES) as ShapeId[])
    .map(consumersOf)
    .sort(
      (a, b) =>
        b.unblocks.length - a.unblocks.length ||
        b.blocks.length - a.blocks.length ||
        a.shape.localeCompare(b.shape),
    );
}

/** Every shape any population claims, which is what keeps the map from rotting. */
export function claimedShapes(): ReadonlySet<string> {
  const claims: readonly (string | undefined)[] = [
    ...Object.values(ADJUDICATED).flatMap((entries) => entries.map((entry) => entry.why)),
    ...Object.values(TRACKED_ADJUDICATED).flatMap((entries) => entries.map((entry) => entry.why)),
    ...Object.values(BLOCKED_ON).flatMap((entry) => blockersIn(entry)),
  ];
  return new Set(
    claims.filter(
      (why): why is string =>
        why !== undefined && why !== 'table' && why !== 'engine' && why !== 'expressible',
    ),
  );
}

export { DEFINED as DEFINED_SPELL_IDS };
