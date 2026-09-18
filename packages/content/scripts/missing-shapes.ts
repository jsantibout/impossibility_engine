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
import { SPELL_DEFINITIONS } from '@ie/content';
import type { MagicItem } from '@ie/srd';
import { fileURLToPath } from 'node:url';
// The join between a catalogue record and the SRD entry it was read from,
// which the item half of this file needs for exactly the reason the report
// does: an entry is transcribed when a record resolves to it, and a second
// spelling of that join would be the second place to get it wrong.
import { magicItemEntries, transcribedItems } from './magic-items.js';

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
    'a third outcome axis, after the saving throw and after the damage: the target reaching 0 Hit Points **because of this spell**. The audit that asked for outcome riders separates it from them by name — a rider rides the roll its host made, and this rides a number the engine went on to compute — and `docs/design/event-log.md`’s "Transitions Are Engine-Owned Batches" is where dropping to 0 is already an engine-owned consequence with nowhere for a spell to hang one.',
  'a-repeat-save-on-the-clock':
    'a repeat save raised by elapsed time rather than by a turn boundary. `RepeatSave` names `start-of-turn` or `end-of-turn` and nothing else, and `Deadline` can already express the span — `docs/design/time-and-turns.md`, "Durations Are Two Different Things", has both halves and no way to put them together. One of the four mechanisms the audit found bundled under `a-repeat-save-beyond-the-turn-hook`.',
  'a-repeat-save-counted-to-a-tally':
    'a repeat save carrying a running count of successes and failures — the death-save shape rather than the repeat-save one, and CLAUDE.md records that `rollDeathSave` is its own thing for exactly that reason. `RepeatSave` holds no tally. The second of the four mechanisms the audit found bundled under `a-repeat-save-beyond-the-turn-hook`.',
  'a-repeat-save-that-does-something-on-a-failure':
    'a repeat save whose **failure** branch acts. `RepeatSave.onSuccess` releases an effect and the failure does nothing at all, so a boundary save that deals damage or deepens a condition has nowhere to put it. The audit names the damage half — "damage on a failure (Phantasmal Killer, Weird)" — as the third of the four mechanisms bundled under `a-repeat-save-beyond-the-turn-hook`; PROGRESS.md names it for Ensnaring Strike.',
  'a-repeat-save-raised-by-a-trigger':
    'a repeat save raised by something that happened — taking damage, having moved, coming within a distance, another effect trying to cure it. The turn hook is the only thing that raises one, which `docs/design/time-and-turns.md` states outright: "Raising is derived; rolling is commanded ... `turn-advanced` *raises* the saves the boundary owes". The fourth of the four mechanisms the audit found bundled under `a-repeat-save-beyond-the-turn-hook`.',
  'a-casting-ended-by-a-trigger':
    'a casting ends by its deadline, by Concentration, by a dispel or by a recast — `docs/design/casting.md`, "Lifecycle, and the one place it ends". IE-032 built the fifth way for **five** transcribed causes: the target attacks, deals damage or casts, the target dons armour, and the caster or an ally damages the target. What is left is every cause whose fact no consequence event holds and every consequence the two scopes cannot express — **any** damage from anybody (Modify Memory, Sleep, Sequester, Phantom Steed, Project Image, Eyebite), a distance two creatures drift apart (Faithful Hound, Warding Bond, Antilife Shell), a running total dealt (Guardian of Faith), a condition the caster chooses at the casting (Sequester), letting go of an object (Shillelagh), leaving an area (Tiny Hut), dropping to 0 Hit Points (Gaseous Form, Warding Bond), another spell ending this one (Geas, Contact Other Plane), a Temporary Hit Point total running out (Polymorph), the target dying (True Polymorph), and ending **one effect** of a casting rather than the casting (Mislead, whose double outlives its invisibility).',
  'a-mode-on-the-save-a-spell-forces':
    '`docs/design/rolls-and-damage.md`: "nothing records what a save was against" — the sentence that already blocks Countercharm. A `RollModifier` selects a roll by family, ability and skill, so there is no way to select the saving throws an effect from a Fiend forces. **Re-described rather than kept**: the audit found this id claimed by six clauses whose real blockers were three different things, and that the description misstated its own. What is left is the clause that genuinely needs a save to remember its provenance.',
  'a-fact-only-the-table-can-declare':
    'a fact the engine does not hold and cannot derive, which a rule then reads — how well you know a creature, whether you are outdoors in a storm, whether you are fighting it. Declared cover, declared sight and declared allegiance are the discipline CLAUDE.md already draws for this; the audit (§4) is where these clauses were found filed as a selector problem when what they want is the fact. **IE-030 built the fought fact and this is what it left**: `CastSpellRequest.fought` carries it and the five spells that read it as Advantage are finished, while SRD Enthrall reads the same fact as "Any creature you or your companions are fighting automatically succeeds on this save" — an outcome `checks.ts` has no `autoSucceed` for, beside `autoFail`, and which no definition could write until it does.',
  'a-bonus-narrowed-to-a-skill':
    'a bonus or penalty that reaches one **skill** rather than the whole family, and reaches Passive Perception. `docs/design/rolls-and-damage.md` names the axis and its whole membership — "covers attacks, saves and ability checks — all rolls" and now an Armour Class — and a skill is not a member, so SRD Enthrall’s "a −10 penalty to Wisdom (Perception) checks and Passive Perception" would land on every ability check the target ever makes. `passivePerception` reads the sheet and no stored bonus at all, so the second half has no reader whatever. The narrower residue of the fought fact IE-030 built, and the reason Enthrall is not finished by it.',
  'an-automatic-success-by-creature-type':
    'IE-019 built `TypedSaveOutcome`, and spell-definitions.ts says exactly how far: "Two consumers, and they are the two shapes the SRD prints — Blight’s automatic failure and Shatter’s Disadvantage." The book prints a third, and one spell writes it: an automatic **success**. A two-member union missing its third member is a narrower gap than the family it came out of, and is what is left of it on this axis.',
  'a-filter-on-the-attackers-creature-type':
    '`docs/design/rolls-and-damage.md` names it verbatim, with its consumers: "A filter on the *attacker’s* creature type | Protection from Evil and Good, Dispel Evil and Good, Magic Circle", in the table of what the roll-modifier vocabulary deliberately does not reach. IE-019 gave a **saving throw** an outcome that varies by the target’s type; a `RollSelector` still has no type axis at either end.',
  'a-creature-type-predicate-an-area-reads':
    'an area or a trigger that catches only named creature types. `designatesUnaffected` is the one filter an area has and it is explicit ids chosen once — `docs/design/space-and-areas.md`: "Designating creatures unaffected is a choice, and never allegiance ... it is **explicit**, because a cleric may spare an enemy and may decline to spare an ally." A predicate over a *type* is a different question, and IE-019 answered it for an outcome rather than for who is caught.',
  'a-condition-immunity-narrowed-to-its-source':
    'an Immunity to a condition that holds against **some** of its causes and not others. IE-042 built the unconditional grant — the seventh sourced family, folded into the one gatherer — and this is the sentence that grant will not carry: SRD Protection from Evil and Good protects against gaining the Charmed or Frightened conditions "from them", SRD Freedom of Movement says "spells and other magical effects can neither reduce the target’s Speed nor cause the target to have the Paralyzed or Restrained conditions", and Magic Circle and Hallow narrow theirs to a creature type chosen at the casting. `docs/design/characters-and-equipment.md` draws the identical line on the printed side — "A qualified defence is not an unconditional one." — and keeps such entries out of the automatic table, where `conditionApplicability` answers `needs-adjudication` rather than guessing. `conditionImmunitiesOf` answers yes or no about a *condition* and is told nothing whatever about what is trying to cause it, so there is no second argument for the qualification to arrive in. The honest residue of the shape IE-042 retired, and four spells claim it.',
  'a-condition-a-spell-suppresses':
    'a condition switched off while it stays on the creature, by a **spell**. The reading exists and only a feature can write it: `StandingGrant`’s `condition-immunity` member is SRD Aura of Courage, and `docs/design/characters-and-equipment.md` states the distinction this needs — "An immunity refuses the condition outright; a suppression lets it land and does nothing with it, and merging them would get both wrong." `suppressedConditions` and `effectiveConditions` derive the answer from a feature’s standing effects and from nothing else; no spell effect kind writes a `StandingEffect`, so SRD Calm Emotions’ "If the creature was already Charmed or Frightened, those conditions are suppressed for the duration" has the storage it needs and no way whatever to reach it. The second residue IE-042 left: the Immunity in the first half of that bullet is built, and the suppression in the second half is a different rule.',
  'an-outcome-that-reads-the-targets-defences':
    'a defence the target already has, read as an input to something other than damage. `docs/design/spell-definitions.md`: "**A creature’s defences are state, and damage reads them**" — `applyDamage` is the only reader, so a save a creature automatically makes because it is immune to a condition has nothing to consult.',
  'an-outcome-that-reads-the-targets-hit-points':
    'a threshold on the target’s current Hit Points, read before anything is rolled. PROGRESS.md ranks it: "Reads the target’s current Hit Points | 0 / 4 | vitals". The vitals are there and no effect asks them a question.',
  'a-target-rule-the-format-cannot-state':
    '`TargetRule` in spell-definitions.ts selects by creature type and by whether armour is worn, and by nothing else. The SRD also selects by **size**, by **Challenge Rating** and by an **ability score**, and shapes outcomes by the same three facts. Size is held and CLAUDE.md records the only rules that read it — sharing a space, passing through, and the volume a template tests; an ability score is held and read by nothing here; a Challenge Rating is not held at all. One missing reader, three facts, and the description says which is which.',
  'a-creature-fact-an-effect-overrides':
    'an effect that changes what **other** rules believe about a creature. PROGRESS.md names it: "Arcanist’s Magic Aura changes what other spells believe a creature’s type to be, which `mustBeType` reads on every casting." Type and size are facts the engine holds authoritatively, and nothing may write over them for the duration of a spell. IE-044 read a third fact of the same shape off SRD Gaseous Form — "The target can enter and occupy the space of another creature", where what the other rule believes is that a creature holds its space against a willing mover.',
  'an-ability-score-a-spell-changes':
    '`docs/design/time-and-turns.md`, on what a rest does not restore: "**Reduced ability scores and a reduced hit point maximum are not restored**, because neither is modelled in the first place." A score is set at creation and by advancement; no effect moves one, and nothing puts one back.',
  'a-stat-block-created-mid-fight':
    'summons. `docs/design/casting.md`, "Which spells this reaches": "A stat block created mid-fight | Unseen Servant, Arcane Hand, Phantom Steed, Summon Dragon, Giant Insect ...". That row lost three entries to this reading — "the four Conjures", Guardian of Faith and Faithful Hound — because SRD 5.2.1 rewrote the Conjure family as spirits and none of the eight prints an Armour Class, Hit Points or a turn.',
  'movement-modes':
    'the Fly, Climb and Swim Speeds the engine does not distinguish, and the per-foot costs that ride with them. `docs/design/spell-definitions.md` refuses the vocabulary by name: "**Movement modes are refused outright.** Fly, Climb and Swim have no reader — no rule in the engine asks about one — so a vocabulary for them would be shape built ahead of every mechanic that could use it", and Roving’s own note says the same of its Climb and Swim Speeds. What is left of `speed-and-movement-modes` once IE-033 built the modifier half.',
  'a-speed-an-effect-multiplies':
    'a Speed **doubled**. `docs/design/spell-definitions.md` fixes both the operations a Speed is composed from and the order they compose in: "Halving is presence rather than count — the reading Resistance and Advantage already take. Zero is last and **wins**". SRD Haste prints the one operation that is neither — "the target’s Speed is doubled" — and is the only sentence in the book that does; the book gives no order for a doubling against a halving, so the member arrives with the rule that settles it. A two-member union missing its third is the shape `an-automatic-success-by-creature-type` already takes, on the other axis.',
  'a-standing-effect-derived-from-where-a-creature-stands':
    'a value derived from current state *and* current geometry rather than from a pair of enter-and-leave events that have to stay matched. `docs/design/casting.md`: "A standing effect derived from where a creature is standing | Spirit Guardians’ halved Speed, every Paladin aura"; PROGRESS.md ranks it above automatic drift.',
  'healing-modified-by-an-effect':
    '`healCreature` rolls its dice and caps at the maximum, and nothing stands beside it to forbid the healing or to maximise it. The audit (§3.5) reads Chill Touch’s "can’t regain Hit Points" as a rule the engine owns; Beacon of Hope is the same sentence pushing the other way.',
  'a-flat-amount-with-no-dice':
    '`DiceScaling.dice` **was** required, so a spell that healed or harmed by a printed number — or by the whole of the target’s maximum — rather than by a notation could not say so. The audit names it while re-scoping condition removal: "Heal (needs flat-only healing — `DiceScaling.dice` is required, one-line format question)". **The printed half is built**: the notation is optional, an amount may carry a `flat` alone, and `flatPerSlotLevelAbove` grows it — which is Heal’s seventy and its ten per slot level exactly, so Heal is a content tranche away rather than an engine one. What is still missing under this name is an amount **derived** rather than printed: the whole of a target’s maximum, and a number computed from the feet a creature was moved.',
  'an-exhaustion-level-a-spell-changes':
    'Exhaustion is a level rather than a condition that is simply on or off — `docs/rules/srd-policy.md`: "**Exhaustion is a flat -2 per level, not Disadvantage**" — and `end-condition` takes a list of condition names, so it removes the condition and cannot remove *one level* of it. `setExhaustionLevel` is a DM-declared command, among the nine `docs/rules/srd-policy.md` records as reachable from a command and from no spell effect.',
  'healing-that-raises-the-dead':
    'PROGRESS.md ranks "Healing that lifts a condition, **raises the dead**, or raises the maximum"; `docs/design/spell-definitions.md` states the refusal it has to get past — "hit points alone will not raise the dead — `healCreature` refuses a corpse, and the refusal costs no slot".',
  'a-hit-point-maximum-a-spell-moves':
    'the maximum is set when a creature is added and by advancement, and no effect moves it. PROGRESS.md ranks "Healing that lifts a condition, raises the dead, or raises the maximum"; the audit names Harm’s reduction as debt.',
  'difficult-terrain-an-area-creates':
    'Difficult Terrain is charged exactly and **declared by the foot** on the move that crosses it (`MoveCommand.difficultFeet`). Deriving it from a spell’s area needs the path a move does not record — CLAUDE.md’s own named gap — so five executed areas are invisible to the ruler. The audit counts "three Difficult Terrain areas" among the clauses that are rules rather than fiction.',
  'an-area-that-moves-by-itself':
    '`docs/design/casting.md`: "Cloudkill and Incendiary Cloud, blocked on automatic turn-start drift". PROGRESS.md says why it is not transcription: the move has to land before the start-of-turn clauses are determined, the direction is derived for one spell and chosen for the other, and a caster with no position has no "away from you" at all.',
  'an-area-trigger-on-the-casters-turn':
    '`AreaTrigger.at` in spell-definitions.ts transcribes the SRD’s two boundary clauses — "starts its turn there" and "ends its turn there" — and both are the **caught creature’s** turn. A storm that acts at the end of each of the *caster’s* turns is a third boundary, and the queue that raises area debt is keyed to the creature whose turn it is.',
  'a-one-shot-roll-modifier':
    '`docs/design/rolls-and-damage.md`: "A one-shot mode is a different mechanic, not a short-lived one." Guiding Bolt’s "the **next** attack roll against it" and Vicious Mockery’s "the next attack roll it makes" need a modifier **consumed** by the roll it changes, and a durable grant applies until its casting ends.',
  'a-selector-for-every-d20-test':
    '`docs/design/rolls-and-damage.md`: "**There is deliberately no member for “D20 Tests”.** Three SRD spells write the phrase — Foresight, Resurrection, Ray of Enfeeblement — and every one is blocked on something else". The absence is a decision rather than an oversight, and it is still what stands between these spells and a definition once their other blockers go.',
  'a-roll-result-an-effect-replaces':
    'a die whose result an effect overrides or throws again. `docs/design/rolls-and-damage.md` has both halves for damage dice — "Substitute a value | Great Weapon Fighting: 1 or 2 counts as 3 | `treatLowRollsAs`" — and for a D20 Test only `rerollTest`, which is a Reaction a feature takes. No spell effect reaches either.',
  'a-die-behaviour-a-spell-asks-for':
    '`docs/design/rolls-and-damage.md`’s "Dice Are Individually Addressable" table: `treatLowRollsAs`, `explodeOnMax` and `rerollDice` are built, tested, and named for the SRD sentences that want them — and no `SpellEffect` passes any of them, which is the recurring finding that a pure function nothing calls is a rule nothing enforces.',
  'a-reduction-an-effect-applies-to-damage':
    '`docs/design/rolls-and-damage.md`: "`reduceDamage` takes its amount off the **total**, never off a component", and it is reachable only from `takeDamageReaction` — a Reaction a class feature spends. A standing effect that takes a rolled amount off every hit of a chosen type has no path to it.',
  'a-damage-penalty-a-spell-grants':
    '`docs/design/rolls-and-damage.md`: "`BonusApplies` covers attacks, saves and ability checks — all rolls — and now `ac`". Damage is not a member, and a spell that makes a creature subtract from **its own** damage rolls has nowhere to say so; `damageBonuses` is the feature-side twin that exists.',
  'an-action-a-spell-compels-or-forbids':
    'the action economy is the engine’s and `mayAct` guards every spender, and the only lever a spell has on it is a condition the engine names. Forbidding one action, compelling another, granting an extra one, or spending somebody else’s Reaction is a rider nothing expresses — which Befuddlement already says in its own words in `spell-definitions.ts`: "which is not a condition the engine names".',
  'a-turn-a-spell-inserts-into-the-order':
    '`docs/design/time-and-turns.md`: "**In combat the clock is derived.** A round ends when the Initiative order wraps, and six seconds have passed; nobody decides that." A spell that hands its caster several turns in a row has no way to say so without a decision somebody makes, which is the one thing the derived clock refuses.',
  'a-choice-made-at-the-casting':
    '`docs/design/rolls-and-damage.md` names it for the roll-modifier vocabulary — "An ability **chosen at the casting** | Hex, Enhance Ability, Bestow Curse" — and Guidance’s own clause in spell-definitions.ts says it plainly: "a per-casting choice has nowhere to be recorded". **A damage type is the one choice that is not here**, and it stopped being here when IE-017 gave `damageTypeStated` a second user: spell-definitions.ts records that the mechanism generalised while the reason did not — "what generalises is the field and what stays the spell’s own is the reason". An ability, a condition, one of six wonders, which of five effects to remove: none of those has a field.',
  'several-attack-rolls-from-one-casting':
    'one casting rolls one attack per target. Eldritch Blast’s beams are separate attack rolls that may take different targets, which `spell-definitions.ts` already records in the clause itself — "which is a shape the engine does not have" — and which is the spell-side twin of the class-feature gap `docs/design/characters-and-equipment.md` names: "Extra attacks inside the Attack action. The economy counts one Attack action, not the attacks in it".',
  'a-second-roll-sequenced-after-the-first':
    '`OutcomeRiders` in spell-definitions.ts rejects this by name: "the two that look as though they do — Ice Knife’s explosion and Chromatic Orb’s leap — are different mechanisms (**a second sequenced roll with an area at a target**, and a chained attack on a dice-face trigger). A child that rolls is a parent".',
  'a-success-branch-that-does-something':
    '`OutcomeRiders` in spell-definitions.ts again: "**Which branch a rider rides is the host’s, never the author’s.** There is no miss-branch slot and no success-branch slot ... A spell whose success clause does something — Flesh to Stone’s “its Speed is 0” — is one consumer and a different shape."',
  'a-spells-effects-applied-to-different-targets':
    '`docs/design/spell-definitions.md`: "**A spell has one effect list applied to every target**, so nothing yet expresses “each creature takes damage *and* is knocked Prone” with different outcomes per target beyond the save each one rolls." A casting that chooses per creature, or divides a pool among them, is the same gap.',
  'a-rider-on-a-later-weapon-attack':
    '`PROGRESS.md`, on what the drained shapes left: "a rider on every weapon attack (Divine Favor, Hex, Hunter’s Mark)"; PROGRESS.md ranks it as "Extra damage on the target’s later attacks | 3 / 10 | `damageBonuses` / `extraDamage`, Rage Damage, Radiant Strikes". **IE-035 built the extra-damage half** — the `attack-rider` grant hangs a notation and a damage type on the caster, optionally narrowed to weapon attacks or to a marked target, and Divine Favor, Hunter’s Mark and Hex’s first sentence are all expressible by it. What is left is every rider that is not that: a **substituted ability** (Shillelagh, True Strike, Alter Self), a **replaced damage die** (the same three), a damage type **chosen at the moment of the attack** (Conjure Minor Elementals), a **flat** bonus of the weapon’s own type reaching the attack roll as well (Magic Weapon), extra damage with **no type** and so the weapon’s own (Enlarge/Reduce), and a rider that fires on damage from **a spell** rather than an attack roll (Bestow Curse).',
  'a-range-that-scales-with-caster-level':
    '`SpellDefinition.range` in spell-definitions.ts is one fixed `SpellRange`, and `ranged(definition.range)` is checked on every casting — tracked or executed, before a target is looked at. `docs/design/spell-definitions.md` keeps the two scaling axes apart on purpose — "**Cantrips scale by caster level and levelled spells by slot**, and they are separate fields rather than one overloaded number" — and both of them reach *dice*. Exactly one spell in the book prints a range that grows with the caster, and the engine would refuse the casting the SRD allows.',
  'a-cap-on-how-many-castings-run-at-once':
    '`replacesPriorCasting` in spell-definitions.ts is the cap the SRD writes twice — "The hand vanishes ... if you cast this spell again" — and it is a cap of **one**, applied by ending the prior casting. A spell that lets three of its own castings run at a time and no more is the same field with a number, and `state.ongoing` already holds everything needed to count them.',
  'a-duration-the-slot-changes':
    'PROGRESS.md, on Major Image: "Concentration and duration that **change with the slot level** ... which `SpellDefinition` cannot express". **IE-035 built the half that is a longer span**: `durationAtSlot` is a per-definition table of slot level to seconds, read where the deadline is scheduled, and the six spells printing the SRD’s "Your Concentration can last longer with a spell slot of…" — Hex, Hunter’s Mark, the three Dominates — and SRD Mass Suggestion’s "The duration is longer with…" all read their own table. What is left is the *other* half of the sentence PROGRESS.md quotes: a slot that changes **what kind** of duration the spell has. SRD Major Image is the one spell in the book that prints it — "The spell lasts until dispelled, **without requiring Concentration**, if cast with a level 4+ spell slot" — so a table of seconds cannot say it, and a member with one writer is what the format’s own unused-member sweep exists to refuse.',
  'a-deadline-anchored-to-a-rest':
    '`docs/design/time-and-turns.md`: "`duration.ts` has two types" — "A span of time" and "A moment in the turn order". A rest is neither, and the SRD anchors effects to one constantly. The clock records `lastShortRestAt` and a rest is a span the engine measures, so the fact is there and no deadline can name it.',
  'an-effect-that-fires-when-the-casting-ends':
    '`docs/design/time-and-turns.md`: "**Expiry is derived, like Concentration breaking** ... The log records the effect being scheduled, not expiring." Nothing hangs a consequence on the moment a casting runs out, so a spell that punishes its target when it lapses, or rewards a caster who held Concentration to the end, has no hook.',
  'a-long-casting-time':
    '`docs/design/casting.md`: "In combat the obligation is a state machine on the caster’s own turns, and it is built." **The mechanism is whole.** IE-034 built the clock half — a casting of a minute or more is declared, runs on the clock and settles, and a Ritual is cast the same way — and IE-041 built the obligation: `continueCasting` spends the Magic action SRD asks for on each of the caster’s turns, and a turn that ends without it fails the rite derived, through `releaseCasting`, with the slot never spent. **IE-036 then read the twelve paragraphs this was the only blocker for and wrote all twelve as tracked definitions**, so what it now blocks is the forty-two spells that name it *and something else*; not one of them is blocked on this shape alone, which is why the second number below is zero rather than the shape being retired. Those forty-two are **not** re-filed: each is blocked by a shape this map already names, and re-reading them belongs with whichever task is briefed from the shape they are waiting on.',
  'senses-beyond-declared-sight':
    'sight is a pairwise declaration and there is nothing else — `docs/design/rolls-and-damage.md` names the missing piece as "A sight clause read from the **attacker’s** side | Faerie Fire". Blindsight and Truesight are the attacker’s senses, so a spell that excuses them cannot be written.',
  'what-a-creature-is-holding':
    '`inventory` and `equipped` are real and only armour and weapons have a slot; `docs/design/characters-and-equipment.md`: "Nothing checks that two hands are free, either." So a spell that makes a creature drop what it holds, or that hands one a globe to throw later, has nothing authoritative to call.',
  'targeting-rules-that-differ-within-one-casting':
    'one range and one sight requirement are checked against every named target. The SRD sometimes measures a later target from an earlier one, requires sight of only the first, or prints a reach for the attack that is not the spell’s Range — a third measurement beside the caster and the area point `docs/design/spell-definitions.md` added for Mass Cure Wounds ("The range then belongs to the point rather than to each target"). `spell-definitions.ts` records the reach half on Vampiric Touch, whose clause says the initial attack’s "within reach" goes unchecked.',
  'a-condition-that-ends-when-its-holder-leaves-an-area':
    '`docs/design/space-and-areas.md` says it outright: Web’s Restrained lasts "while in the webs", and "a condition that ends when its holder walks out of an area has no shape here at all".',
  'an-area-that-filters-its-catch':
    'an area catches every creature in it. PROGRESS.md names the gap for Entangle — "its area excludes the caster ... and exactly one SRD spell says that, so the field waits for a second user" — and Hypnotic Pattern is the second, whose SRD text affects only a creature that can see the pattern.',
  'a-wall-or-several-templates-in-one-area':
    '`docs/design/spell-definitions.md`: "**No wall or multi-area spells.** All six SRD shapes are castable, but a spell whose area is *several* of them — Meteor Swarm’s four Spheres, Fire Storm’s ten Cubes — or a wall with a length, a height and a thickness, has no way to say so. One area per spell."',
  'a-barrier-that-blocks-passage':
    '`docs/design/casting.md`: "Walls and barriers as obstacles | Arcane Eye, Passwall, Wall of Stone, Prismatic Wall", and `docs/design/space-and-areas.md` gives the reason it stays out — "Cover and line of sight stay declared, not ray-cast ... that is where a rules engine becomes a VTT." A shape that stops a creature crossing it is the geometry’s missing half, distinct from the template that describes it.',
  'an-effect-that-suppresses-other-magic':
    'PROGRESS.md files it among the rows "gone because the shape was built" — "an effect that ends another casting (Dispel Magic)" — and `spell-ended` is what built it. **Suppression is the half that is not**: an ongoing spell that does not function while its time goes on running has no state to sit in, and an area that stops a spell being cast into it reads a casting the engine resolves elsewhere. IE-044 read a third sentence of the same shape from the *target*’s side — SRD Freedom of Movement’s "spells and other magical effects can neither reduce the target’s Speed" — where what refuses the effect is a creature rather than an area; `speedOf` reads every grant a source hung and has no notion of one being refused, which is the same missing state arriving at a different holder.',
  'a-casting-that-casts-another-spell':
    '`docs/design/casting.md`, on the interrupted casting: "It is not a general interruption framework — there is **no stack**, and a Counterspell answering a Counterspell is refused rather than nested." A spell that casts another as part of itself, stores one to go off later, or duplicates one of a lower level needs exactly the stack that was declined. Several castings may be open at once now, keyed by casting id — but that is several *independent* castings rather than one nested inside another, and the two relationship rules that refuse the nesting still stand.',
  'a-spell-that-answers-a-later-attack':
    '`docs/design/rolls-and-damage.md`’s reaction-window table: `hit-by-attack` and `damaged-by-creature` are real instants, and both are answered by a **Reaction somebody takes** — "Two windows open on the actor’s opt-in ... `hit-by-attack` and `casting-a-spell` open only when the *attacker* holds the attack". An ongoing spell that answers a blow automatically, with no Reaction and nobody deciding, is not that mechanism.',
  'an-effect-that-intercepts-dropping-to-0':
    '`docs/design/event-log.md`, "Transitions Are Engine-Owned Batches": "Dropping to 0 hit points makes a character Unconscious ... The command layer produces these as coherent batches". The engine owns the transition end to end, and nothing may stand in front of it and change the answer — which is why `docs/design/spell-definitions.md` already files Death Ward as debt: "Death Ward, because the engine drops creatures to 0 itself".',
  'a-second-place-to-put-a-creature':
    'there is one scene, so a creature sent elsewhere has nowhere to be. `docs/design/spell-definitions.md`: "A destination *outside* the scene is different in kind ... there is one scene, so Plane Shift and Word of Recall have no position to move anybody to", and `docs/design/casting.md`: "the real fix is the doctrine’s multiple-scenes seam".',
  falling:
    '`docs/design/casting.md` lists the one Reaction trigger left after Counterspell: "Feather Fall | a creature falling | **falling, which is not modelled at all**". Nothing drops, nothing takes fall damage, and no rate of descent has anything to be measured against.',
  jumping:
    'jumping, which nothing models, so a jump distance has nothing to be measured against. Jump’s own clause in spell-definitions.ts says it: "the 30-foot jump for 10 feet of movement is not applied; jumping is not modelled, and the once-per-turn limit has nothing to count".',
  'forced-movement-a-spell-causes':
    '`moveCreature` takes `forced: true` and reports who is being shared with, and no `SpellEffect` reaches it — `docs/design/space-and-areas.md` records both halves: "forced movement passes `forced: true`", and its recurring finding that a pure function nothing calls is a rule nothing enforces.',
  'an-activation-that-resolves-an-area':
    '`docs/design/casting.md`: "An activation that resolves an area at a point chosen now | Call Lightning, Storm of Vengeance". `activateSpell` resolves an attack at a named target and moves an area along a stated route; resolving a **fresh** area in a direction chosen now is neither.',
  'an-activation-that-forces-a-saving-throw':
    '`SpellActivation` in spell-definitions.ts carries effects "run with the level and route pinned at the casting", and every registered one resolves an attack or moves an area. A later action that makes somebody save — pushing, grappling or probing a mind — has the machinery beside it and no consumer, which is the state a shape is named in rather than assumed out of.',
  'an-activation-taken-by-somebody-other-than-the-caster':
    '`docs/design/casting.md`, on acting through a spell on a later turn: "Pinned at the casting | ... **the caster — nobody else may act through it**". A spell that hands its *target* the later action inverts exactly that rule, and the pinned numbers are still the caster’s.',
  'a-casting-dismissed-early':
    'the **exceptions** to the general dismissal, which is built: `endOngoingSpell` ends a casting of the caster’s own by id and spends nothing, which is what SRD prints for a **Time Span** duration. What is left is what each claimant prints instead — `docs/design/casting.md`: "every one of those three prints an exception to it". Animal Shapes and Gaseous Form are ended by the **target** rather than by the caster; all three cost an action the book names where a dismissal costs none; and a casting that runs "Until dispelled" is refused outright, because the book gives its caster no ending at all.',
  'a-dc-the-caster-does-not-set':
    'every saving throw a spell forces is measured against the casting’s pinned `saveDc`. The audit names the asymmetry from the other side — "**Three members of the definition format have zero catalogue users**, not one: `roll-mode.save` ..., `SpellCheck.dc` ..., and `’end-casting’` as a `save.repeats.onSuccess` value" — so an *ability check* may already name a printed DC and a *saving throw* may not.',
  'a-save-keyed-to-a-condition':
    'a save selected by what it is *against* rather than by the ability that rolls it. `docs/design/rolls-and-damage.md` names it and names this spell: "A save keyed to a named **condition** rather than an ability | Protection from Poison", in the table of what the roll-modifier vocabulary deliberately does not reach. Distinct from `a-mode-on-the-save-a-spell-forces`, which is the caster’s own save seen from the other end — this one modifies a save some *other* effect will call for.',
  'a-condition-benefit-an-effect-takes-away':
    'a benefit the condition layer derives, switched off while the condition itself stays. Three SRD spells print the sentence — Faerie Fire, Starry Wisp, and Mind Spike’s "against you" — and PROGRESS.md already lists Faerie Fire among the clauses the roll vocabulary cannot reach. Invisible’s *attack* halves read declared sight, so the table can answer those; `initiativeConditionModes` grants its Initiative Advantage from the condition’s presence alone, and nothing reaches that at all.',
  'a-random-outcome-that-is-not-a-d20':
    'PROGRESS.md ranks it: "A random outcome that is not a d20 | 1 / 19 | the generator, `parseNotation`". A percentage chance, a 1d10 behaviour table or a 1d100 mishap roll is a die the engine can throw and no `SpellEffect` asks for.',
  'a-rest-an-effect-gives-or-denies':
    'a rest is a span the engine measures and its payout is `endRest`’s — `docs/design/time-and-turns.md`, "**A rest is a span, not a button**". No effect confers the benefits of one without the hours, and none takes them away from a rest that was completed.',
  'damage-with-neither-an-attack-roll-nor-a-save':
    'PROGRESS.md ranks it at 19 open spells, and Magic Missile is the one this clause names: while that spell cannot be cast, Shield’s second trigger has nothing to fire on.',
  'an-armor-class-a-spell-floors':
    'PROGRESS.md ranks it: "An Armour Class a spell **sets** (**built** — Mage Armor) or **floors** (~3 left: Barkskin’s “if its AC is lower”)". `docs/design/spell-definitions.md` says why the built half does not cover it: "Barkskin is deliberately *not* included: “an Armor Class of 17 if its AC is lower than that” is a floor on the **total**, a different rule, and one spell is not evidence for building it."',
  'the-effects-source-as-a-participant':
    '`docs/design/rolls-and-damage.md` lists it among what the roll-modifier vocabulary deliberately does not reach: "The effect’s *source* as a participant — “against **you**”, meaning the caster | Bestow Curse". `relation` is one bit wide — `roller` or `against-holder` — and the caster of the spell is a third participant no selector can name.',
  'an-area-moved-by-the-casters-own-movement':
    'spell-definitions.ts keeps two allowances apart because the SRD does — `CastingOrigin.movableBy`, a rider on an action that also strikes, and `SpellActivation.movesArea`, where "the move *is* the action". A pack or a pillar that comes along when the caster walks, costing no action at all, is a third sentence and neither field says it.',
  'an-outcome-that-breaks-concentration':
    '`PROGRESS.md` names it among the mechanics the drained shapes left behind: "an outcome-scoped child effect (Ice Knife’s explosion, Hideous Laughter’s two conditions, **Sleet Storm’s broken Concentration**)". `OutcomeRiders` landed with conditions, modifiers and delayed damage; ending the target’s Concentration is the one consequence in that sentence that got no slot.',
  'a-check-another-creature-may-attempt':
    '`docs/design/spell-definitions.md`, on the check a spell offers: "**Who may attempt it is derived from what the timer sits on** — an effect on a creature is that creature’s to shake off, a casting with no victim is anybody’s to see through." An ally reaching in to cut somebody free, or shaking a sleeper awake, is neither, and the derivation has no third branch.',
  'an-area-trigger-measured-from-a-point':
    '`docs/design/casting.md` names it spell by spell: "Ending a turn within 5 feet of a point, and a point rolled into a creature’s space | Flaming Sphere". `AreaTrigger` hangs off a template, and a reach measured from the casting’s own origin is what `CastingOrigin.reach` answers for an attack and for nothing that fires on its own.',
  'an-effect-that-stabilises-a-dying-creature':
    '`PROGRESS.md`: "**Every one of the event types the union declares is now emitted by a command**", and `stabilised` is one of the nine a DM declares. The command exists, the event exists, and no `SpellEffect` reaches either — the recurring finding in this repository that a pure function nothing calls is a rule nothing enforces, arriving on the cantrip whose whole content is that one word.',
  'a-distance-a-creature-travels-inside-an-area':
    '`docs/design/space-and-areas.md`, on what a persistent area cannot see: "**The path.** Movement records where a move started and where it ended and nothing in between", and `docs/design/casting.md`: "Distance travelled inside an area, which no move records | Spike Growth". Inferring the crossing from a straight line would be the engine inventing a route nobody took.',
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
  // The spell this map predicted IE-017 would finish and which IE-042 actually
  // did, arriving in the executed population with **one** clause left — and it
  // is the table's rather than a shape's, which is the honest end of a
  // prediction that was wrong for two tranches.
  'mind-blank': [
    {
      clause: 'the second sentence is the table’s',
      why: 'table',
      note: 'SRD: "The target is also unaffected by anything that would sense its emotions or alignment, read its thoughts, or magically detect its location, and no spell—not even _Wish_—can gather information about the target, observe it remotely, or control its mind." The mind-control half is answered by the Charmed Immunity the definition already grants: every spell in this catalogue that controls a mind does it by imposing that condition. The rest reaches nothing — no emotion, alignment, thought, remote sense or scrying result is a fact this engine holds, and no definition asks for one — so the clause is narration the DM owns rather than debt.',
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
 *
 * ### What the reading keeps costing, measured over five families
 *
 * IE-044 read one family of ten and found five blockers nobody had recorded.
 * IE-056 read the next four — the ones ranked highest by what a read count would
 * unblock — and found **forty-three across twenty-five spells**, again without
 * inventing a single shape id. The rate does not fall off, which is the
 * argument for reading a family before briefing from it rather than after.
 *
 * Two of those findings are about this file rather than about a spell, and both
 * are pinned by name in `blocked-on.test.ts`:
 *
 * - **A unit the book repeats verbatim can carry no clause.** SRD prints a
 *   summon's stat block inside the spell's own entry as an HTML table, and that
 *   table repeats `SAVE` three times. Every copy trips the saving-throw marker,
 *   so the coverage guard demands an adjudication that the anchoring guard
 *   forbids anybody to write. Five spells are caught by it — Find Steed, Giant
 *   Insect, Summon Dragon, Prismatic Spray and Prismatic Wall — and the first
 *   three are the **whole** of what `a-stat-block-created-mid-fight` finishes.
 *   So the book's largest summon family cannot be briefed from a read count
 *   until somebody decides which of the two guards gives way, and that decision
 *   is an architecture question rather than a reading.
 * - **A slot that scales an area has no id here**, and SRD prints it twice —
 *   Confusion's Sphere and Fog Cloud's fog. `SpellArea` is one fixed size and a
 *   slot reaches damage dice and a target count, so the engine would resolve a
 *   level 6 Confusion over the level 4 Sphere. Confusion's clause is filed as
 *   `table` **under protest**, with the note saying so in its first sentence,
 *   because inventing a shape is a decision and a wrong adjudication is worse
 *   than a declared placeholder.
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
  'animate-dead': [
    {
      clause: 'Casting Time: 1 minute',
      why: 'a-long-casting-time',
      note: 'A casting of a minute or more is a field the book prints above the paragraph rather than a sentence inside it, so the clause is anchored to the field. IE-034 and IE-041 built the mechanism; what this entry records is that the rite is still one of the things standing between this spell and a definition.',
    },
    {
      clause: 'a corpse of a Medium or Small Humanoid',
      why: 'a-target-rule-the-format-cannot-state',
      note: 'SRD: "Choose a pile of bones or a corpse of a Medium or Small Humanoid within range." Two facts a `TargetRule` cannot state in one clause: the target is selected by **size**, which is the first of the three facts this shape names, and it is a corpse rather than a creature, which `mustBeType` has no way to ask for.',
    },
    {
      clause: 'The target becomes an Undead creature',
      why: 'a-stat-block-created-mid-fight',
      note: 'The whole of what the spell produces is a Skeleton or a Zombie the book keeps in its monster list, and the engine has no way to bring a stat block into a fight. Everything downstream of this sentence presupposes the creature.',
    },
    {
      clause: 'mentally command any creature you made with this spell',
      why: 'a-stat-block-created-mid-fight',
      note: 'A Bonus Action spent directing a creature this spell created. `SpellActivation` already carries `action: "bonus-action"`, so the economy half is built; what the action has to reach is the animated creature, which does not exist, so the activation would have nothing to do.',
    },
    {
      clause: 'You decide what action the creature will take',
      why: 'table',
      note: 'What an allied creature does on its own turn is the table\'s, exactly as allegiance is declared rather than derived here. Once the stat block existed the engine would hold its economy and its movement, and still would not be the thing choosing between them.',
    },
    {
      clause: 'If you issue no commands',
      why: 'table',
      note: 'The default behaviour of an uncommanded creature — the Dodge action and movement that avoids harm — is the same declaration seen from the other side, and it decides nothing the engine would have to record beyond the action it names.',
    },
    {
      clause: 'two additional Undead creatures for each spell slot level above 3',
      why: 'expressible',
      note: '`TargetRule.extraPerSlotLevelAbove` takes a number rather than a flag, so two more per level above the third is the field as it stands. The count is not what keeps this spell undefined; the creature being counted is.',
    },
  ],
  'animate-objects': [
    {
      clause: "aren't fixed to a surface, and aren't Gargantuan",
      why: 'a-target-rule-the-format-cannot-state',
      note: 'SRD: "Choose a number of nonmagical objects within range that aren\'t being worn or carried, aren\'t fixed to a surface, and aren\'t Gargantuan." A size bound and an object that is not a creature at all, neither of which `TargetRule` can say.',
    },
    {
      clause: 'sprouts legs, and becomes a Construct',
      why: 'a-stat-block-created-mid-fight',
      note: 'The Animated Object stat block, brought into the fight mid-combat and under the caster\'s control. The engine adds creatures to a scene and has no way for a spell to be the thing that adds one.',
    },
    {
      clause: 'you can take a Bonus Action to mentally command any creature',
      why: 'a-stat-block-created-mid-fight',
      note: 'The same later Bonus Action Animate Dead prints, reaching five hundred feet rather than sixty. The economy is built and the creature it commands is what is missing, so the activation has no subject.',
    },
    {
      clause: 'If you issue no commands',
      why: 'table',
      note: 'An uncommanded creature taking the Dodge action and moving only to avoid harm is a declaration about how an ally behaves, which this repository leaves to the table wherever allegiance is involved.',
    },
    {
      clause: 'it reverts to its object form, and any remaining damage carries over',
      why: 'a-stat-block-created-mid-fight',
      note: 'Damage surviving a creature\'s death and landing on the object it becomes needs both halves of a thing the engine cannot hold: the created creature\'s vitals, and an object with vitals of its own for the overflow to arrive at.',
    },
    {
      clause: 'Slam damage increases by 1d4',
      why: 'a-stat-block-created-mid-fight',
      note: 'An upcast that scales an attack printed in a stat block rather than in the spell. `DiceScaling` scales a notation a definition writes down, and this notation belongs to a creature the definition cannot create.',
    },
  ],
  'antilife-shell': ['a-barrier-that-blocks-passage', 'a-casting-ended-by-a-trigger'],
  // **Eight sentences and one marker between them.** Every mechanical clause
  // this spell prints is invisible to `CLAUSE_MARKERS` except the teleport one,
  // which is the floor under-firing exactly as it was designed to — a clause
  // may be written for any sentence, and here nearly all of them had to be.
  'antimagic-field': [
    {
      clause: 'An aura of antimagic surrounds you in 10-foot Emanation',
      why: 'expressible',
      note: 'An Emanation of ten feet on the caster, which Spirit Guardians already writes. The geometry is the one part of this spell that needs nothing new.',
    },
    {
      clause: 'No one can cast spells, take Magic actions',
      why: 'an-action-a-spell-compels-or-forbids',
      note: 'Forbidding the Magic action outright, to everybody standing in the area rather than to a named target. `mayAct` guards every spender and the only lever a spell has on it is a condition the engine names.',
    },
    {
      clause: "those things can't target or otherwise affect anything inside it",
      why: 'an-effect-that-suppresses-other-magic',
      note: 'An area that refuses a casting resolved elsewhere, which is the half of this shape `spell-ended` did not build — ending another casting is a command and refusing one has no state to sit in.',
    },
    {
      clause: "Magical properties of magic items don't work inside the aura",
      why: 'an-effect-that-suppresses-other-magic',
      note: 'The same suppression reaching what a creature is wearing rather than a casting. An item\'s magical properties have no switch, and the time they spend switched off would have to be remembered.',
    },
    {
      clause: "Areas of effect created by spells or other magic can't extend into the aura",
      why: 'an-effect-that-suppresses-other-magic',
      note: 'A template that stops at a boundary another casting drew. Areas here catch every creature inside them and nothing clips one against a second spell\'s geometry.',
    },
    {
      clause: 'no one can teleport into or out of it',
      why: 'a-standing-effect-derived-from-where-a-creature-stands',
      note: '`teleportCreature` is real and the refusal would have to be derived from where the mover is standing and where it is going, afresh on every move — which is the standing-effect shape rather than a pair of enter-and-leave events.',
    },
    {
      clause: 'Portals close temporarily while in the aura',
      why: 'table',
      note: 'A portal is not a thing the engine holds, so closing one changes no authoritative state. This is the world the DM is describing rather than the state the engine is keeping.',
    },
    {
      clause: 'Ongoing spells, except those cast by an Artifact or a deity, are suppressed',
      why: 'an-effect-that-suppresses-other-magic',
      note: 'The canonical sentence for this shape: an ongoing casting that does not function while its clock keeps running. `state.ongoing` holds the casting and there is no third state between running and ended.',
    },
    {
      clause: "it doesn't function, but the time it spends suppressed counts against its duration",
      why: 'an-effect-that-suppresses-other-magic',
      note: 'And the sentence that says why suppression is not `spell-ended` in disguise: the deadline keeps its own time while the effect does nothing, so ending and rescheduling would be a different rule.',
    },
    {
      clause: "_Dispel Magic_ has no effect on the aura",
      why: 'an-effect-that-suppresses-other-magic',
      note: 'A casting that refuses to be dispelled, and two of these auras that decline to cancel each other. Both are the same missing state read from the other end — nothing marks a casting as exempt from the command that ends one.',
    },
  ],
  'antipathy-sympathy': [
    {
      clause: 'Casting Time: 1 hour',
      why: 'a-long-casting-time',
      note: 'An hour, printed as a field rather than stated in the paragraph, which is the only reason a clause may name a field at all. IE-034 and IE-041 built the rite; the rest of this entry is what is left.',
    },
    {
      clause: 'choose whether it creates antipathy or sympathy',
      why: 'a-choice-made-at-the-casting',
      note: 'One of two whole effect sets, decided when the slot is spent and read by every clause below. A per-casting choice has nowhere to be recorded, and a damage type is the only choice that does.',
    },
    {
      clause: 'target one creature or object that is Huge or smaller',
      why: 'a-target-rule-the-format-cannot-state',
      note: 'A size bound, and a target that may be an object rather than a creature. `TargetRule` selects by creature type and by whether armour is worn and by nothing else, so neither half can be stated.',
    },
    {
      clause: 'Then specify a kind of creature, such as red dragons, goblins, or vampires',
      why: 'a-creature-type-predicate-an-area-reads',
      note: 'Not one of the book\'s creature types but a **kind**, finer than `mustBeType` can ask about, deciding who the effect reaches. `designatesUnaffected` is explicit ids chosen once and is the only filter there is.',
    },
    {
      clause: 'makes a Wisdom saving throw when it comes within 120 feet of the target',
      why: 'a-repeat-save-raised-by-a-trigger',
      note: 'Coming within a distance is named in this shape\'s own description as one of the things that raises a save, and the turn hook is the only thing that raises one today.',
    },
    {
      clause: 'determines what happens to a creature when it fails that save',
      why: 'a-choice-made-at-the-casting',
      note: 'The sentence that makes the choice above load-bearing: the failure branch is one of two effect sets, and which one is a fact about the casting that nothing records.',
    },
    {
      clause: '**Antipathy.** The creature has the Frightened condition',
      why: 'expressible',
      note: 'A `condition` effect naming Frightened, on the failure branch of a save the definition format already writes.',
    },
    {
      clause: 'must use its movement on its turns to get as far away as possible',
      why: 'an-action-a-spell-compels-or-forbids',
      note: 'Compelling how a creature spends its movement, which is the economy the engine owns. The Frightened condition the engine names does not carry this, so it would have to be a rider and there is none.',
    },
    {
      clause: '**Sympathy.** The creature has the Charmed condition',
      why: 'expressible',
      note: 'The other branch\'s condition, and the same ordinary shape — one effect naming Charmed on a failed Wisdom save.',
    },
    {
      clause: 'must use its movement on its turns to get as close as possible',
      why: 'an-action-a-spell-compels-or-forbids',
      note: 'The mirrored compulsion, pushing the creature toward the target instead of away. Two sentences of one shape are two entries, because each is a sentence somebody has to have read.',
    },
    {
      clause: "the creature can't willingly move away",
      why: 'an-action-a-spell-compels-or-forbids',
      note: 'A prohibition on one direction of movement, gated on a distance. `moveCreature` charges a budget and asks nothing about which way the mover is heading relative to anybody.',
    },
    {
      clause: 'If the target damages the Charmed creature, that creature can make a',
      why: 'a-repeat-save-raised-by-a-trigger',
      note: 'Taking damage is the first thing this shape\'s description names, and the sentence is split across a line break in the book so the clause is anchored to the half that carries the trigger.',
    },
    {
      clause: 'Wisdom saving throw to end the effect, as described below',
      why: 'a-repeat-save-raised-by-a-trigger',
      note: 'The other half of the same split sentence, carrying the save itself. It is recorded separately because the splitter divides on the line break and a clause may not straddle two of the book\'s units.',
    },
    {
      clause: 'ends its turn more than 120 feet away from the target, the creature makes a Wisdom saving throw',
      why: 'a-repeat-save-raised-by-a-trigger',
      note: 'A turn-boundary save that only happens at a distance. `RepeatSave.at` fires at the boundary unconditionally, so the gate has nowhere to live even though the boundary itself is built.',
    },
    {
      clause: 'the creature is no longer affected by the target',
      why: 'expressible',
      note: '`RepeatSave.onSuccess` releasing the effect from the creature that saved, which is the branch the field was built for.',
    },
    {
      clause: 'is immune to it for 1 minute, after which it can be affected again',
      why: 'an-effect-that-suppresses-other-magic',
      note: 'A creature that refuses this effect for a minute, which is IE-044\'s reading of Freedom of Movement arriving with a clock on it — the same missing state at a different holder. Filed to the nearest honest existing shape rather than a new one, and said so here.',
    },
  ],
  'arcane-eye': ['a-barrier-that-blocks-passage'],
  // The longest paragraph in this family and the one the bare list understated
  // worst: six shapes were recorded and reading it finds four more, every one
  // of them a shape this map already names. Two of the four trip no marker.
  'arcane-hand': [
    {
      clause: 'You create a Large hand of shimmering magical energy',
      why: 'a-stat-block-created-mid-fight',
      note: 'The hand is given an Armour Class and a Hit Point total of its own two sentences later, which is a stat block however the book lays it out. Nothing in the engine lets a casting put a new thing with vitals into the scene.',
    },
    {
      clause: 'mimicking the movements of your own hand',
      why: 'table',
      note: 'How the hand looks while it moves is narration, and the movement that matters is the sixty feet the later Bonus Action buys, which this entry files under the choice that action offers.',
    },
    {
      clause: 'an object that has AC 20 and Hit Points equal to your Hit Point maximum',
      why: 'a-stat-block-created-mid-fight',
      note: 'An Armour Class and a Hit Point maximum derived from the caster\'s own, held by something the engine cannot create. `armorClassOf` and the vitals both read a creature that was added to the scene, and no effect adds one.',
    },
    {
      clause: 'If it drops to 0 Hit Points, the spell ends',
      why: 'a-casting-ended-by-a-trigger',
      note: 'Dropping to 0 Hit Points is named in this shape\'s own description as a cause `CastingEndTrigger` has no member for, with Gaseous Form and Warding Bond beside it. This spell prints the third instance, and it was not recorded.',
    },
    {
      clause: "The hand doesn't occupy its space",
      why: 'a-creature-fact-an-effect-overrides',
      note: 'Occupancy is a rule the engine owns outright, and this is the override IE-044 read off Gaseous Form arriving on a created thing rather than on a transformed creature. **Recorded although the sentence trips no marker**, which is what the floor being a floor means.',
    },
    {
      clause: 'cause one of the following effects',
      why: 'a-choice-made-at-the-casting',
      note: 'Four alternatives, chosen afresh on every later Bonus Action rather than once when the slot is spent — so it is the same missing field seen later still, and a per-casting choice already has nowhere to be recorded.',
    },
    {
      clause: 'The hand strikes a target within 5 feet of it',
      why: 'expressible',
      note: '`CastingOrigin.reach` is exactly this measurement: a reach belonging to the spell\'s own point rather than to the caster, which Spiritual Weapon already writes.',
    },
    {
      clause: 'Make a melee spell attack',
      why: 'expressible',
      note: 'An `attack` effect resolved through `resolveAttack` from the casting\'s origin, which is the shape the catalogue already carries for a striking point of force.',
    },
    {
      clause: 'the target takes 5d8 Force damage',
      why: 'expressible',
      note: 'A typed damage notation on the hit branch, which is the most ordinary thing the definition format expresses and the one part of this paragraph that needs nothing new.',
    },
    {
      clause: 'The hand attempts to push a Huge or smaller creature',
      why: 'a-target-rule-the-format-cannot-state',
      note: 'A size bound on who may be pushed. Size is held and the rules that read it are sharing a space, passing through, and the volume a template tests; an effect that refuses a Gargantuan target is not among them.',
    },
    {
      clause: 'the hand pushes the target up to 5 feet plus a number of feet',
      why: 'forced-movement-a-spell-causes',
      note: '`moveCreature` takes `forced: true` and no `SpellEffect` reaches it, so a push a failed save earns has no path to the one function that would charge it correctly.',
    },
    {
      clause: 'The hand moves with the target',
      why: 'an-area-that-moves-by-itself',
      note: 'The spell\'s own point follows a creature with no action spent and nobody choosing a direction, which is the nearest honest shape this vocabulary has — the automatic drift Cloudkill and Incendiary Cloud are blocked on, arriving on an origin rather than on an area. **No shape is invented for it**; the fit is stated here rather than assumed.',
    },
    {
      clause: 'The hand attempts to grapple a Huge or smaller creature',
      why: 'a-target-rule-the-format-cannot-state',
      note: 'The same size bound as the Forceful Hand, printed again for the Grasping Hand. One shape a spell needs twice is not two shapes, and both sentences are recorded because both are sentences.',
    },
    {
      clause: 'the target has the Grappled condition, with an escape DC',
      why: 'an-activation-that-forces-a-saving-throw',
      note: 'Every registered activation resolves an attack or moves an area, and a later action that makes somebody save has the machinery beside it and no consumer. This is that sentence: a Bonus Action on a later turn whose whole content is a Dexterity save and a condition.',
    },
    {
      clause: 'dealing Bludgeoning damage to the target equal to 4d6',
      why: 'damage-with-neither-an-attack-roll-nor-a-save',
      note: 'The crush lands automatically — no attack roll and no save — and it is additionally gated on the spell\'s own Grappled condition still holding, which no field expresses either. Filed under the first of the two, because that is the one this vocabulary already names.',
    },
    {
      clause: 'The hand grants you Half Cover against attacks',
      why: 'table',
      note: 'Cover is declared here rather than ray-cast, which is the line this repository drew deliberately to keep a rules engine from becoming a VTT. A spell that grants cover is answered by the same declaration, and nothing new is owed.',
    },
    {
      clause: 'its space counts as Difficult Terrain for your enemies',
      why: 'difficult-terrain-an-area-creates',
      note: 'Difficult Terrain is charged by the foot on the move that crosses it, declared by the mover. Deriving it from where this spell put its hand needs the path a move does not record.',
    },
    {
      clause: 'increases by 2d8 and the damage of the Grasping Hand increases by 2d6',
      why: 'expressible',
      note: 'Two different upcast scalings for two different effects, which is what `DiceScaling` being per-effect already buys — nothing here needs a second field.',
    },
  ],
  'arcanists-magic-aura': ['a-creature-fact-an-effect-overrides'],
  'astral-projection': [
    {
      clause: 'Casting Time: 1 hour',
      why: 'a-long-casting-time',
      note: 'An hour, printed as a field rather than stated in the paragraph, which is why a clause may name a field at all. The rite runs on the clock since IE-034 and IE-041.',
    },
    {
      clause: 'Duration: Until dispelled',
      why: 'a-casting-dismissed-early',
      note: 'A casting that runs "Until dispelled" is refused outright, because the book gives its caster no ending at all — and this spell then prints one anyway, three sentences from the bottom.',
    },
    {
      clause: 'project your astral bodies into the Astral Plane',
      why: 'a-second-place-to-put-a-creature',
      note: 'There is one scene, so nine creatures standing somewhere else have nowhere to be — and this spell needs the scene twice over, because the bodies stay behind in the first one.',
    },
    {
      clause: "Each target's body is left behind in a state of suspended animation",
      why: 'a-second-place-to-put-a-creature',
      note: 'The Unconscious condition is an ordinary effect; a creature being in two places, one of them with its own vitals, is the thing the one-scene model has no room for.',
    },
    {
      clause: 'the target\'s body and astral form both die',
      why: 'table',
      note: 'The cord is cut only when some other effect states that it does, so which effects those are is the DM\'s to declare — the same discipline this repository draws for cover, for sight and for who you are fighting.',
    },
    {
      clause: "Any damage or other effects that apply to an astral form have no effect on the target's body",
      why: 'a-second-place-to-put-a-creature',
      note: 'Two sets of vitals for one creature, each sealed off from the other. `applyDamage` reaches the creature, and there is no second creature for it to miss.',
    },
    {
      clause: "If a target's body or astral form drops to 0 Hit Points, the spell ends for that target",
      why: 'a-casting-ended-by-a-trigger',
      note: 'Dropping to 0 Hit Points is named in that shape\'s own description as a cause with no member, and this one ends the casting **for one target of several** — a scope the two IE-032 built cannot express either.',
    },
    {
      clause: 'The spell ends for all the targets if you take a Magic action to dismiss it',
      why: 'a-casting-dismissed-early',
      note: '`endOngoingSpell` ends a casting by id and spends nothing, which is what the book prints for a Time Span duration. This one charges the Magic action the exception always charges.',
    },
    {
      clause: 'the target reappears in its body and exits the state of suspended animation',
      why: 'a-second-place-to-put-a-creature',
      note: 'The return, per target, from the place the model does not have. The death marker fires on the clause that excludes a dead target rather than on anything this spell kills.',
    },
  ],
  augury: ['a-long-casting-time', 'a-random-outcome-that-is-not-a-d20'],
  'aura-of-life': [
    'a-hit-point-maximum-a-spell-moves',
    'a-standing-effect-derived-from-where-a-creature-stands',
    'an-outcome-that-reads-the-targets-hit-points',
  ],
  awaken: [
    {
      clause: 'Casting Time: 8 hours',
      why: 'a-long-casting-time',
      note: 'Eight hours is the longest casting in the book and it is printed as a field rather than as a sentence, which is why a clause may name a field at all. The rite runs on the clock now, and this spell still needs three other things.',
    },
    {
      clause: 'with an Intelligence of 3 or less',
      why: 'a-target-rule-the-format-cannot-state',
      note: 'SRD: "The target must be either a Beast or Plant creature with an Intelligence of 3 or less or a natural plant that isn\'t a creature." An **ability score** as a target rule, which is the third of the three facts this shape names — the score is held and nothing reads it.',
    },
    {
      clause: 'an Intelligence of 10',
      why: 'an-ability-score-a-spell-changes',
      note: 'A score is set at creation and by advancement, no effect moves one, and nothing puts one back — so a spell that raises a Beast\'s Intelligence to ten has no writer. Recorded although the sentence trips no marker, because the sentence is the whole of what the spell does.',
    },
    {
      clause: 'it becomes a Plant creature and gains the ability to move its limbs',
      why: 'a-stat-block-created-mid-fight',
      note: 'A natural plant is not a creature and this sentence makes it one, which is a stat block arriving mid-scene by a different door than a summons. There is no creature in the engine\'s scene for the spell to have been cast on.',
    },
    {
      clause: 'The GM chooses statistics appropriate for the awakened Plant',
      why: 'a-stat-block-created-mid-fight',
      note: 'The book names two monster entries and leaves the choice open, so what the spell produces is a stat block the definition would have to reach for. Reading it as the table\'s would be wrong: the statistics are mechanical and the engine has nowhere to put them.',
    },
    {
      clause: 'has the Charmed condition for 30 days or until you or your allies deal damage to it',
      why: 'expressible',
      note: 'A `condition` effect with a thirty-day `Deadline`, ended early by one of the five causes IE-032 transcribed — the caster or an ally damaging the target is the fifth of them, word for word.',
    },
    {
      clause: 'the awakened creature chooses its attitude toward you',
      why: 'table',
      note: 'An attitude is not a fact the engine holds and should never be one it decides. The condition ending is mechanical and is already answered above; what follows it is the table\'s.',
    },
  ],
  barkskin: ['an-armor-class-a-spell-floors'],
  'bestow-curse': [
    {
      clause: 'must succeed on a Wisdom saving throw or become cursed for the duration',
      why: 'expressible',
      note: 'A touch-range save with a duration, which is the ordinary shape. What the curse *does* is four alternatives below, and that is where every blocker on this entry lives.',
    },
    {
      clause: 'the target suffers one of the following effects of your choice',
      why: 'a-choice-made-at-the-casting',
      note: 'Four alternatives chosen when the slot is spent, and a casting has nowhere to record a choice made when it was made. Every clause below reads this one.',
    },
    {
      clause: 'Choose one ability',
      why: 'a-choice-made-at-the-casting',
      note: 'An ability chosen at the casting, which is named with this spell beside Hex and Enhance Ability in the roll-modifier vocabulary\'s own table of what it does not reach. A nested choice inside the first one.',
    },
    {
      clause: 'Disadvantage on ability checks and saving throws made with that ability',
      why: 'a-choice-made-at-the-casting',
      note: 'A `RollModifier` selecting by ability is built; **which** ability is the thing that has no field, so the modifier could be written for every ability or for none of them.',
    },
    {
      clause: 'The target has Disadvantage on attack rolls against you',
      why: 'the-effects-source-as-a-participant',
      note: '`relation` is one bit wide — `roller` or `against-holder` — and the caster of the spell is a third participant no selector can name. This is the sentence that shape was named for.',
    },
    {
      clause: 'must succeed on a Wisdom saving throw at the start of each of its turns',
      why: 'a-repeat-save-that-does-something-on-a-failure',
      note: '`RepeatSave.onSuccess` releases an effect and the failure branch does nothing at all, so a boundary save whose failure acts has nowhere to put what it does.',
    },
    {
      clause: 'be forced to take the Dodge action on that turn',
      why: 'an-action-a-spell-compels-or-forbids',
      note: 'And this is what that failure does: it spends the target\'s action for it. The economy is the engine\'s, `mayAct` guards every spender, and no rider reaches either.',
    },
    {
      clause: 'the target takes an extra 1d8 Necrotic damage',
      why: 'a-rider-on-a-later-weapon-attack',
      note: 'IE-035 built `attack-rider` for extra damage hung on the caster, and this one fires on damage from **a spell** as well as from an attack roll — which that shape\'s own description names as one of the riders the build did not reach, with this spell beside it.',
    },
    {
      clause: 'you can maintain Concentration on it for up to 10 minutes',
      why: 'expressible',
      note: '`durationAtSlot` is a per-definition table of slot level to seconds, which IE-035 built for exactly this sentence shape — Hex, Hunter\'s Mark and the three Dominates all read their own table.',
    },
    {
      clause: "the spell doesn't require Concentration, and the duration becomes 8 hours",
      why: 'a-duration-the-slot-changes',
      note: 'A slot that changes what **kind** of duration the spell has rather than how long it is, which a table of seconds cannot say. Major Image prints the same sentence and was the shape\'s one writer until this reading.',
    },
    {
      clause: 'the spell lasts until dispelled',
      why: 'a-duration-the-slot-changes',
      note: 'The third rung of the same table, and the one that changes the kind twice over: a level 9 slot buys a duration with no end at all, which is a third thing `durationAtSlot` cannot hold.',
    },
  ],
  'blade-barrier': [
    {
      clause: 'The wall appears within range and lasts for the duration',
      why: 'a-wall-or-several-templates-in-one-area',
      note: 'A wall placed at a point and held for ten minutes. `SpellArea` has six shapes and none of them is a wall, so there is nothing for the duration to be attached to.',
    },
    {
      clause: 'a straight wall up to 100 feet long, 20 feet high, and 5 feet thick',
      why: 'a-wall-or-several-templates-in-one-area',
      note: 'A length, a height and a thickness — the three numbers this shape\'s description names — and a ringed alternative beside them. **Recorded although the sentence trips no marker.**',
    },
    {
      clause: 'The wall provides Three-Quarters Cover',
      why: 'table',
      note: 'Cover is declared here rather than ray-cast, which is the line this repository drew deliberately to keep a rules engine from becoming a VTT.',
    },
    {
      clause: 'its space is Difficult Terrain',
      why: 'difficult-terrain-an-area-creates',
      note: 'Difficult Terrain is charged by the foot on the move that crosses it and declared by the mover. Deriving it from a spell\'s area needs the path a move does not record.',
    },
    {
      clause: "Any creature in the wall's space makes a Dexterity saving throw, taking 6d10 Force damage",
      why: 'expressible',
      note: 'A typed `save-damage` effect with the ordinary half-on-a-success branch, resolved over whatever area the spell turns out to have.',
    },
    {
      clause: "A creature also makes that save if it enters the wall's space or ends it turn there",
      why: 'expressible',
      note: '`AreaTrigger.onEntry` and `at: "end-of-turn"` are the book\'s two boundary clauses transcribed, and this sentence is both of them.',
    },
    {
      clause: 'A creature makes that save only once per turn',
      why: 'expressible',
      note: '`AreaTrigger.oncePerTurn`, which caps the creature across every clause above rather than capping one of them.',
    },
  ],
  blink: [
    {
      clause: 'Roll 1d6 at the end of each of your turns',
      why: 'a-random-outcome-that-is-not-a-d20',
      note: 'The generator throws any notation `parseNotation` reads and no `SpellEffect` asks it for one, so a d6 rolled at a turn boundary to decide what happens next has nothing to ask.',
    },
    {
      clause: 'you vanish from your current plane of existence and appear in the Ethereal Plane',
      why: 'a-second-place-to-put-a-creature',
      note: 'There is one scene, so a creature that has stepped off it has nowhere to be — and the parenthesis beside it ends the spell instantly for a caster already there, which is the same absence read as a refusal.',
    },
    {
      clause: "perceive the plane you left, which is cast in shades of gray, but you can't see anything there more than 60 feet away",
      why: 'a-second-place-to-put-a-creature',
      note: 'Sight reaching from one plane into another, bounded at sixty feet. Sight here is a pairwise declaration between two creatures in one scene, and the second scene the declaration would have to cross does not exist.',
    },
    {
      clause: 'You return to an unoccupied space of your choice that you can see within 10 feet',
      why: 'a-second-place-to-put-a-creature',
      note: 'The return, chosen within ten feet of where the caster left. Placing a creature is ordinary and the thing being placed has spent a turn somewhere the model has no room for.',
    },
    {
      clause: 'you appear in the nearest unoccupied space',
      why: 'a-second-place-to-put-a-creature',
      note: 'The fallback when the chosen space is taken, which is the same arrival with the choice removed — and it still arrives from nowhere.',
    },
  ],
  'call-lightning': ['a-fact-only-the-table-can-declare', 'an-activation-that-resolves-an-area'],
  // — read sentence by sentence, with the eight below it: IE-044 backfilled the
  // ten spells the retired `a-condition-immunity-a-spell-grants` blocked,
  // because that is the shape the next tranche was briefed from and a bare list
  // of ids says nothing about which sentences anybody read. **IE-042 then built
  // it and re-read all ten, one at a time**: Mind Blank is defined and out of
  // this map, five clauses became `expressible`, one moved to the shape its own
  // sibling clause already named, and the rest are the two narrower residues.
  'calm-emotions': [
    {
      clause: 'choose for each creature',
      why: 'a-spells-effects-applied-to-different-targets',
      note: 'SRD: "must succeed on a Charisma saving throw or be affected by one of the following effects (choose for each creature)". A casting applies one effect list to every target it caught, so a spell picking a different one per creature has nowhere to record which.',
    },
    {
      clause: 'Immunity to the Charmed and Frightened conditions',
      why: 'expressible',
      note: 'IE-042\'s `condition-immunity` effect, which Mind Blank already writes: the sentence is unconditional — "The creature has Immunity to the Charmed and Frightened conditions until the spell ends" — and two names in one clause is the plural list the kind carries. The area, the Charisma save and the duration were always expressible; what is left of this spell is the per-creature choice above and the suppression below.',
    },
    {
      clause: 'those conditions are suppressed for the duration',
      why: 'a-condition-a-spell-suppresses',
      note: 'SRD: "If the creature was already Charmed or Frightened, those conditions are suppressed for the duration." **Re-read against the built shape and it is not that shape.** Suppression hands the condition back when the spell ends, so it is not `end-condition` however much it reads like one — and it is not the Immunity in the clause above it either, which refuses a condition rather than silencing one that has already landed. The engine derives suppression from a feature\'s standing effects and no spell can write one.',
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
    {
      clause: 'You speak a one-word command to a creature you can see within range',
      why: 'expressible',
      note: 'A single named target at sixty feet with a sight requirement, which `targets` and `requiresSight` write between them and which half the catalogue already does.',
    },
    {
      clause: 'follow the command on its next turn',
      why: 'an-action-a-spell-compels-or-forbids',
      note: 'The whole spell in five words: a creature\'s next turn is spent doing what somebody else said. The economy is the engine\'s and the only lever a spell has on it is a condition the engine names.',
    },
    {
      clause: 'Choose the command from these options',
      why: 'a-choice-made-at-the-casting',
      note: 'Five alternatives decided when the slot is spent, and a per-casting choice has nowhere to be recorded — a damage type is the one choice that does, and that field generalised while the reason did not.',
    },
    {
      clause: 'The target moves toward you by the shortest and most direct route',
      why: 'an-action-a-spell-compels-or-forbids',
      note: 'Compelled movement along a route nobody chose, ending the turn early if it arrives. `moveCreature` charges a budget for a move somebody commanded and has no notion of a move the rules require.',
    },
    {
      clause: 'The target drops whatever it is holding',
      why: 'what-a-creature-is-holding',
      note: '`inventory` and `equipped` are real and only armour and weapons have a slot, so what is in a creature\'s hands is not a fact the engine holds and a rule that makes it let go has nothing to call.',
    },
    {
      clause: 'The target spends its turn moving away from you by the fastest available means',
      why: 'an-action-a-spell-compels-or-forbids',
      note: 'The mirror of Approach, spending the whole turn instead of ending it. Two sentences of one shape are two entries here, because each is a sentence somebody has to have read.',
    },
    {
      clause: '**Grovel.** The target has the Prone condition',
      why: 'an-action-a-spell-compels-or-forbids',
      note: 'The Prone is an ordinary `condition` effect; what is not is the clause beside it that ends the creature\'s turn, and a definition that wrote only the condition would be half the sentence.',
    },
    {
      clause: "the target doesn't move and takes no action or Bonus Action",
      why: 'an-action-a-spell-compels-or-forbids',
      note: 'Forbidding every action and the movement with it, which is the Incapacitated condition\'s effect without the condition. Nothing lets a spell reach `mayAct` except by naming a condition the engine already knows.',
    },
    {
      clause: 'You can affect one additional creature for each spell slot level above 1',
      why: 'expressible',
      note: '`TargetRule.extraPerSlotLevelAbove`, which is what Bless and every other upcast target count in the catalogue already writes.',
    },
  ],
  commune: ['a-long-casting-time', 'a-random-outcome-that-is-not-a-d20'],
  // **The one place in this reading where the vocabulary ran out.** The upcast
  // line grows the Sphere with the slot, `SpellArea` is a fixed size, and the
  // slot reaches damage dice and a target count and nothing else. No shape id
  // names it; inventing one is an architecture decision, so the clause is filed
  // as the table's under protest and reported. `blocked-on.test.ts` pins it by
  // name so it cannot go quiet, and Fog Cloud prints the same sentence while
  // this map records it as blocked on nothing at all.
  confusion: [
    {
      clause: "that target can't take Bonus Actions or Reactions",
      why: 'an-action-a-spell-compels-or-forbids',
      note: 'Two whole categories of action forbidden for the duration. `mayAct` guards every spender and a spell reaches it only through a condition the engine names, and no condition in the book forbids exactly these two.',
    },
    {
      clause: 'must roll 1d10 at the start of each of its turns to determine its behavior',
      why: 'a-random-outcome-that-is-not-a-d20',
      note: 'The generator throws any notation `parseNotation` reads and no `SpellEffect` asks it for one. A behaviour table rolled at a turn boundary needs both the die and somewhere for its result to be consulted.',
    },
    {
      clause: '<th>1d10</th>',
      why: 'a-random-outcome-that-is-not-a-d20',
      note: 'The book prints the behaviour table as a table, and the parser keeps it, so the header cell is a unit of this spell\'s printed entry that names a die. It is the same missing mechanism as the sentence above, read off the column it indexes.',
    },
    {
      clause: "The target doesn't take an action, and it uses all its movement to move",
      why: 'an-action-a-spell-compels-or-forbids',
      note: 'The first row of the table, spending the creature\'s whole movement and denying its action. Every row of this table is the same shape, and each is its own unit of the printed entry.',
    },
    {
      clause: 'Roll 1d4 for the direction',
      why: 'a-random-outcome-that-is-not-a-d20',
      note: 'A second die inside the first die\'s outcome, choosing a compass direction the engine has no notion of — positions are coordinates and nothing names north.',
    },
    {
      clause: "The target doesn't move or take actions",
      why: 'an-action-a-spell-compels-or-forbids',
      note: 'The second row, forbidding both. It is the Incapacitated condition\'s effect arriving without the condition, which is exactly the lever a spell does not have.',
    },
    {
      clause: "The target doesn't move, and it takes the Attack action",
      why: 'an-action-a-spell-compels-or-forbids',
      note: 'The third row compels an action rather than forbidding one, which this shape names beside forbidding in its own description. Compelling the Attack action also means choosing its target, below.',
    },
    {
      clause: 'one melee attack against a random creature within reach',
      why: 'a-random-outcome-that-is-not-a-d20',
      note: 'A target chosen at random from whoever is in reach. The ruler can find the candidates and nothing picks among them, because no effect asks the generator for anything but a d20 and its damage.',
    },
    {
      clause: 'If none are within reach, the target takes no action',
      why: 'an-action-a-spell-compels-or-forbids',
      note: 'The fallback when the compelled attack has nobody to hit, which is a third state of the same missing rider — the turn is spent and nothing happens.',
    },
    {
      clause: 'an affected target repeats the save, ending the spell on itself on a success',
      why: 'expressible',
      note: '`RepeatSave` at `end-of-turn` with `onSuccess: "end-on-target"`, which is the pair Hold Person already writes and the scenario test already exercises.',
    },
    {
      clause: "The Sphere's radius increases by 5 feet for each spell slot level above 4",
      why: 'table',
      note: '**This adjudication is a placeholder and is wrong on purpose.** The sentence is mechanical debt: `SpellArea` holds one fixed size, a levelled spell\'s slot reaches its damage dice and its target count and nothing else, and the engine would resolve a level 6 casting over a 10-foot Sphere and catch too few creatures. No shape in this vocabulary names an **area a slot scales**, inventing one is an architecture decision rather than a reading, and `table` is the honest placeholder the brief allows — recorded here so a reviewer decides rather than a builder. SRD Fog Cloud prints the second instance.',
    },
  ],
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
  // **The one Conjure spell whose area is an Emanation on its caster**, which
  // is Spirit Guardians' shape and is defined. Conjure Animals and Conjure
  // Celestial put a pack or a pillar at a *point* and move it when the caster
  // moves, which is why they carry `an-area-moved-by-the-casters-own-movement`
  // and this one does not — a difference the bare lists could not show.
  'conjure-woodland-beings': [
    {
      clause: 'nature spirits that flit around you in a 10-foot Emanation',
      why: 'expressible',
      note: 'An Emanation of ten feet originating on the caster, which is what Spirit Guardians already writes — the area comes along because that is what an Emanation on `self` does, with no action spent and no field needed.',
    },
    {
      clause: 'Whenever the Emanation enters the space of a creature',
      why: 'expressible',
      note: '`AreaTrigger.onAreaEntry` is exactly this clause: the area arrives and the creature has not moved. Spirit Guardians is one of the four spells the field was transcribed for.',
    },
    {
      clause: 'enters the Emanation or ends its turn there, you can force that creature to make a Wisdom saving throw',
      why: 'expressible',
      note: '`AreaTrigger.onEntry` and `at: "end-of-turn"` are the book\'s two boundary clauses transcribed. The caster being *able* to force the save rather than obliged to costs the engine nothing: declining is a command nobody sends.',
    },
    {
      clause: 'The creature takes 5d8 Force damage on a failed save',
      why: 'expressible',
      note: 'A typed save-damage effect with the ordinary half-on-a-success branch, which is the most common shape in the catalogue.',
    },
    {
      clause: 'A creature makes this save only once per turn',
      why: 'expressible',
      note: '`AreaTrigger.oncePerTurn`, which caps the creature across every clause above rather than capping one of them — transcribed from Moonbeam, which prints the same sentence after naming three triggers.',
    },
    {
      clause: "you can take the Disengage action as a Bonus Action for the spell's duration",
      why: 'an-action-a-spell-compels-or-forbids',
      note: 'A standing grant of an extra way to Disengage, for the duration. The action economy is the engine\'s and `mayAct` guards every spender; the only lever a spell has on it is a condition the engine names, and this is not one.',
    },
    {
      clause: 'The damage increases by 1d8 for each spell slot level above 4',
      why: 'expressible',
      note: '`DiceScaling` by slot, which is one of the two axes the format keeps deliberately apart and the one a levelled spell reads.',
    },
  ],
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
  'create-undead': [
    {
      clause: 'Casting Time: 1 minute',
      why: 'a-long-casting-time',
      note: 'The minute is a printed field rather than a sentence, and it is still one of the things standing between this spell and a definition even though IE-034 and IE-041 built the rite that runs it.',
    },
    {
      clause: 'You can cast this spell only at night',
      why: 'table',
      note: 'Whether it is night is a fact the engine does not hold and cannot derive, and declaring it is the discipline this repository already draws for cover, for sight and for who you are fighting. Recorded although the sentence trips no marker.',
    },
    {
      clause: 'three corpses of Medium or Small Humanoids',
      why: 'a-target-rule-the-format-cannot-state',
      note: 'SRD: "Choose up to three corpses of Medium or Small Humanoids within range." Selection by **size**, and of corpses rather than creatures — the same pair Animate Dead prints, and neither was recorded on this entry before.',
    },
    {
      clause: 'Each one becomes a **Ghoul** under your control',
      why: 'a-stat-block-created-mid-fight',
      note: 'The spell\'s whole product is a monster-list stat block, up to three of them, standing in the fight under the caster\'s control. Nothing in the engine lets a casting add a creature to the scene.',
    },
    {
      clause: 'mentally command any creature you animated with this spell',
      why: 'a-stat-block-created-mid-fight',
      note: 'The later Bonus Action Animate Dead prints, reaching a hundred and twenty feet. `SpellActivation` holds the economy and the creature it would command is the part that does not exist.',
    },
    {
      clause: 'You decide what action the creature will take',
      why: 'table',
      note: 'What a controlled ally does on its turn is declared here rather than derived, exactly as allegiance is. The engine would hold the economy and the movement and still not be the thing choosing between them.',
    },
    {
      clause: 'If you issue no commands',
      why: 'table',
      note: 'The Dodge action and movement that avoids harm are the default behaviour of an uncommanded creature, which is the same declaration from the other side and decides nothing the engine records.',
    },
    {
      clause: 'If you use a level 7 spell slot',
      why: 'a-stat-block-created-mid-fight',
      note: 'An upcast that changes how many stat blocks arrive. `TargetRule.extraPerSlotLevelAbove` is linear and this is a table of three separate slot levels, but the count is not the blocker: what is counted is.',
    },
    {
      clause: 'If you use a level 8 spell slot',
      why: 'a-stat-block-created-mid-fight',
      note: 'And this line changes **which** stat block arrives as well as how many — five Ghouls, or two Ghasts or Wights. A definition would have to name three different monster entries and choose between them by slot.',
    },
    {
      clause: 'If you use a level 9 spell slot',
      why: 'a-stat-block-created-mid-fight',
      note: 'The third rung of the same table, naming a fourth monster entry. Three sentences of one shape are three entries here, because each is a sentence somebody has to have read.',
    },
    {
      clause: 'See "Monsters" for these stat blocks',
      why: 'a-stat-block-created-mid-fight',
      note: 'The book saying outright that the content of this spell lives in a stat block the spell does not print. There is no clearer statement of what this shape is, anywhere in the catalogue.',
    },
  ],
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
    {
      clause: 'Celestials, Elementals, Fey, Fiends, and Undead have Disadvantage on attack rolls against you',
      why: 'a-filter-on-the-attackers-creature-type',
      note: 'The sentence this shape is named for, with this spell in its own list of consumers: a `RollSelector` has no creature-type axis at either end, so the attacker\'s type cannot narrow a roll mode.',
    },
    {
      clause: 'You can end the spell early by using either of the following special functions',
      why: 'a-casting-dismissed-early',
      note: 'An activation that consumes its own casting. `SpellActivation` carries an action, a reach and effects and no way to say the casting is over afterwards, and the ending costs the Magic action the book names where a dismissal costs none.',
    },
    {
      clause: 'you touch a creature that is possessed by or has the Charmed or Frightened condition from one or more creatures of the types above',
      why: 'a-filter-on-the-attackers-creature-type',
      note: '`condition-applied` records a `source` string — a cause label, not a creature whose type could be read — so a condition selected by what **kind of thing imposed it** has nothing to consult. The same missing type axis, at a third position; filed to the nearest honest existing shape and said so.',
    },
    {
      clause: 'The target is no longer possessed, Charmed, or Frightened by such creatures',
      why: 'a-filter-on-the-attackers-creature-type',
      note: '`end-condition` takes a list of condition names and ends them all, so a spell that lifts only the Frightened a Fiend caused and leaves the one a dragon caused cannot be written. Possession is not modelled at all.',
    },
    {
      clause: 'you target one creature you can see within 5 feet of you that has one of the creature types above',
      why: 'an-activation-that-forces-a-saving-throw',
      note: 'Every registered activation resolves an attack or moves an area, and a later Magic action whose whole content is making somebody save has the machinery beside it and no consumer.',
    },
    {
      clause: 'be sent back to its home plane if it isn\'t there already',
      why: 'a-second-place-to-put-a-creature',
      note: 'There is one scene, so a creature sent home has nowhere to be. `teleportCreature` places a creature at a position and a plane is not a position.',
    },
    {
      clause: 'Undead are sent to the Shadowfell, and Fey are sent to the Feywild',
      why: 'a-second-place-to-put-a-creature',
      note: 'And the destination varies by creature type, which is a second question the first cannot be asked without: three places the model does not have, chosen between.',
    },
  ],
  divination: ['a-random-outcome-that-is-not-a-d20'],
  'divine-word': [
    {
      clause: 'Each creature of your choice in range',
      why: 'a-spells-effects-applied-to-different-targets',
      note: 'A spell has one effect list applied to every target, and this one chooses a **different** effect per creature from the table below. The book also caps the list at nobody, where a `TargetRule.count` is a number.',
    },
    {
      clause: 'a target that has 50 Hit Points or fewer suffers an effect based on its current Hit Points',
      why: 'an-outcome-that-reads-the-targets-hit-points',
      note: 'A threshold on the target\'s current Hit Points read before anything else happens, and then a second reading to index a table. The vitals are there and no effect asks them a question.',
    },
    {
      clause: 'is forced back to its plane of origin',
      why: 'a-second-place-to-put-a-creature',
      note: 'There is one scene, so a creature sent to its plane of origin has nowhere to be — and the twenty-four hours it may not return for is that absence with a clock on it.',
    },
    {
      clause: '<th>Hit Points</th>',
      why: 'an-outcome-that-reads-the-targets-hit-points',
      note: 'The book prints the outcome table as a table and the parser keeps it, so the column the target\'s vitals index is a unit of this spell\'s printed entry. It is the same missing reader, read off the index.',
    },
    {
      clause: '<td>The target dies.</td>',
      why: 'an-outcome-that-reads-the-targets-hit-points',
      note: 'The first row, and the harshest. It is not `damage-with-neither-an-attack-roll-nor-a-save`: nothing is dealt at all, and what selects it is the Hit Point band this shape names.',
    },
    {
      clause: '<td>The target has the Blinded, Deafened, and Stunned conditions for 1 hour.</td>',
      why: 'an-outcome-that-reads-the-targets-hit-points',
      note: 'Three conditions with a duration, which the format writes directly; what it cannot write is the row of a table the target\'s current Hit Points chose.',
    },
    {
      clause: '<td>The target has the Blinded and Deafened conditions for 10 minutes.</td>',
      why: 'an-outcome-that-reads-the-targets-hit-points',
      note: 'The third row, two conditions and a shorter span. Each row is its own unit of the printed entry, so each is its own clause.',
    },
    {
      clause: '<td>The target has the Deafened condition for 1 minute.</td>',
      why: 'an-outcome-that-reads-the-targets-hit-points',
      note: 'The last row, and the mildest. Four bands and one reader missing between them.',
    },
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
  etherealness: [
    {
      clause: 'You step into the border regions of the Ethereal Plane',
      why: 'a-second-place-to-put-a-creature',
      note: 'There is one scene, so a creature that has stepped half out of it has nowhere to be — and this one keeps its position while being unreachable, which is the same absence in its most awkward form.',
    },
    {
      clause: 'you can move in any direction',
      why: 'movement-modes',
      note: 'Movement here is a budget spent between positions on one surface, and moving freely up and down is the Fly Speed the engine deliberately does not distinguish.',
    },
    {
      clause: 'every foot of movement costs an extra foot',
      why: 'movement-modes',
      note: 'The per-foot costs that ride with a movement mode, which is the second half of what that shape names. `MoveCommand.difficultFeet` charges exactly, and nothing charges by direction.',
    },
    {
      clause: "you can't see anything there more than 60 feet away",
      why: 'a-second-place-to-put-a-creature',
      note: 'Sight reaching from one plane into another, bounded at sixty feet. Sight here is a pairwise declaration between two creatures in one scene.',
    },
    {
      clause: 'you return to the plane you left in the spot that corresponds to your space',
      why: 'a-second-place-to-put-a-creature',
      note: 'The return, to a position that had to be kept for eight hours while the creature was somewhere the model has no room for.',
    },
    {
      clause: 'you are shunted to the nearest unoccupied space',
      why: 'forced-movement-a-spell-causes',
      note: '`moveCreature` takes `forced: true` and reports who is being shared with, and no `SpellEffect` reaches it — so a shunt the rules perform has no path to the one function that would charge it correctly.',
    },
    {
      clause: 'take Force damage equal to twice the number of feet you are moved',
      why: 'a-flat-amount-with-no-dice',
      note: 'An amount may now carry a `flat` and no notation, which is the printed half of this shape. This number is not printed: it is twice the feet the creature was moved, derived at the moment it is dealt, and nothing in the format computes an amount from anything. The audit names the same question for Heal, arriving there on a maximum instead of a distance.',
    },
    {
      clause: "This spell ends instantly if you cast it while you are on the Ethereal Plane",
      why: 'a-second-place-to-put-a-creature',
      note: 'A refusal that reads which plane the caster is already on, which is the one-scene absence seen as a precondition rather than as a destination.',
    },
    {
      clause: 'You can target up to three willing creatures (including yourself) for each spell slot level above 7',
      why: 'expressible',
      note: '`TargetRule.extraPerSlotLevelAbove` takes a number rather than a flag, so three more per level above the seventh is the field as it stands, and `self` covers the parenthesis.',
    },
    {
      clause: 'The creatures must be within 10 feet of you when you cast the spell',
      why: 'expressible',
      note: 'A range checked at the casting against every named target, which `ranged()` already does before a target is looked at.',
    },
  ],
  // One sentence, one shape, and both halves of the sentence are that shape:
  // the spell **takes** an action for you and then **grants** you a second way
  // to take it. The shortest paragraph in the book that is still debt.
  'expeditious-retreat': [
    {
      clause: 'You take the Dash action',
      why: 'an-action-a-spell-compels-or-forbids',
      note: 'The casting spends an action on the caster\'s behalf. `mayAct` guards every spender and the only lever a spell has on the economy is a condition the engine names, so a spell that takes an action *for* you has nothing to call.',
    },
    {
      clause: 'you can take that action again as a Bonus Action',
      why: 'an-action-a-spell-compels-or-forbids',
      note: 'And the other half: a standing grant of an extra way to Dash, for the duration. Granting an action is named in this shape\'s own description beside forbidding one, and no rider expresses either.',
    },
  ],
  eyebite: [
    {
      clause: 'your eyes become an inky void',
      why: 'table',
      note: 'What the caster looks like for the duration is narration, and the engine\'s resolution path never arrives at it. The spell\'s whole mechanical content starts with the next sentence.',
    },
    {
      clause: 'be affected by one of the following effects of your choice',
      why: 'a-choice-made-at-the-casting',
      note: 'One of three effect sets, decided by the caster rather than by the die, and a casting has nowhere to record a choice made when it was made — a damage type is the one choice that has a field.',
    },
    {
      clause: 'you can take a Magic action to target another creature',
      why: 'an-activation-that-forces-a-saving-throw',
      note: 'Every registered activation resolves an attack or moves an area, and a later action whose whole content is making somebody save has the machinery beside it and no consumer.',
    },
    {
      clause: "can't target a creature again if it has succeeded on a save against this casting",
      why: 'an-activation-that-forces-a-saving-throw',
      note: 'The activation would also have to remember who has already saved against this casting, for the whole duration. That is per-casting state beside the pinned level and route, and the same field would have to carry it.',
    },
    {
      clause: '_Asleep._ The target has the Unconscious condition',
      why: 'expressible',
      note: 'A `condition` effect naming Unconscious on the failure branch of a Wisdom save, which the definition format writes directly.',
    },
    {
      clause: 'It wakes up if it takes any damage',
      why: 'a-casting-ended-by-a-trigger',
      note: '**Any** damage from anybody is the largest of the causes IE-032\'s two built scopes cannot express, and this shape\'s description names this spell in the list. It ends one effect rather than the casting, which is a second thing the trigger cannot say.',
    },
    {
      clause: 'another creature takes an action to shake it awake',
      why: 'a-check-another-creature-may-attempt',
      note: 'Who may attempt a check is derived from what the timer sits on — the creature it is on, or anybody when there is no victim — and shaking a sleeper awake is named in this shape\'s own description as the third branch that derivation has not got.',
    },
    {
      clause: '_Panicked._ The target has the Frightened condition',
      why: 'expressible',
      note: 'The second branch\'s condition, and the same ordinary shape: one effect naming Frightened on a failed Wisdom save.',
    },
    {
      clause: 'the Frightened target must take the Dash action and move away from you',
      why: 'an-action-a-spell-compels-or-forbids',
      note: 'An action compelled on every one of the target\'s turns, and a route it must take. The Frightened condition the engine names carries neither, so this would have to be a rider and there is none.',
    },
    {
      clause: "60 feet away from you where it can't see you, this effect ends",
      why: 'a-casting-ended-by-a-trigger',
      note: 'A distance two creatures drift apart, gated on sight, ending **one effect** of the casting rather than the casting — both of which this shape\'s description names, the second for Mislead.',
    },
    {
      clause: '_Sickened._ The target has the Poisoned condition',
      why: 'expressible',
      note: 'The third branch, and the plainest of the three: a `condition` effect naming Poisoned with nothing riding on it.',
    },
  ],
  'faerie-fire': ['a-condition-benefit-an-effect-takes-away', 'senses-beyond-declared-sight'],
  'faithful-hound': ['a-casting-ended-by-a-trigger', 'an-area-trigger-on-the-casters-turn'],
  'feather-fall': ['falling'],
  'find-familiar': [
    {
      clause: 'Casting Time: 1 hour or Ritual',
      why: 'a-long-casting-time',
      note: 'An hour, or the Ritual that IE-034 made a long casting of the same kind. The field is where the blocker is printed, because no sentence of the paragraph mentions it.',
    },
    {
      clause: 'another Beast that has a Challenge Rating of 0',
      why: 'a-stat-block-created-mid-fight',
      note: 'The familiar **is** a stat block chosen from a list of eleven, or any other Beast at the same Challenge Rating. The rating is a fact the engine does not hold at all, and here it selects a form rather than a target — so it is the stat block that is missing rather than a target rule.',
    },
    {
      clause: 'the familiar has the statistics of the chosen form',
      why: 'a-stat-block-created-mid-fight',
      note: 'The sentence that says the spell\'s content is a monster entry with its creature type overwritten. The engine adds creatures to a scene and nothing a casting does adds one.',
    },
    {
      clause: 'you can communicate with it telepathically',
      why: 'table',
      note: 'The hundred feet is measurable and what it gates is conversation, which the engine\'s resolution path never arrives at. The range marker fires on the distance and nothing mechanical hangs off it.',
    },
    {
      clause: "you can see through the familiar's eyes and hear what it hears",
      why: 'senses-beyond-declared-sight',
      note: 'Sight here is a pairwise declaration and there is nothing else, so one creature borrowing another\'s senses — including any special senses it has — has no state to sit in. Filed under the nearest honest shape rather than a new one; the shape\'s named consumer is an attacker\'s Blindsight, and this is the same absence at the other end.',
    },
    {
      clause: 'your familiar can deliver the touch',
      why: 'an-activation-taken-by-somebody-other-than-the-caster',
      note: 'A second casting measured from the familiar rather than from its caster. The rule that a casting is acted through by the caster and nobody else is exactly what this inverts, and the reach half has no field of its own either.',
    },
    {
      clause: 'it must take a Reaction to deliver the touch',
      why: 'an-activation-taken-by-somebody-other-than-the-caster',
      note: 'The other half of the same inversion, and the mechanical one: the Reaction spent belongs to the familiar while the spell being delivered belongs to the caster. Two sentences, so two entries.',
    },
    {
      clause: "A familiar can't attack",
      why: 'a-stat-block-created-mid-fight',
      note: 'A created creature that cannot attack is a stat block printing no attack, which is different from Gaseous Form forbidding an **existing** creature to attack — that one is a rider on an economy the engine already runs, and this one is a property of a creature the engine cannot make.',
    },
    {
      clause: 'When the familiar drops to 0 Hit Points, it disappears',
      why: 'a-stat-block-created-mid-fight',
      note: 'The creature has vitals and leaves the scene when they run out, and the spell does **not** end with it — so this is the summon\'s own lifecycle rather than a casting-end trigger, and it needs the creature to exist before it needs anything else.',
    },
    {
      clause: 'you can temporarily dismiss the familiar to a pocket dimension',
      why: 'a-second-place-to-put-a-creature',
      note: 'There is one scene, so a creature that is stored rather than destroyed has nowhere to be. It is not `end-condition` and not a death: the familiar keeps existing somewhere the engine has no representation for, and comes back on a later action.',
    },
    {
      clause: 'you can cause it to reappear in an unoccupied space within 30 feet of you',
      why: 'a-stat-block-created-mid-fight',
      note: 'The return half. Placing a creature in an unoccupied space is something the engine does well; the creature being placed is what it cannot produce.',
    },
    {
      clause: 'it leaves behind in its space anything it was wearing or carrying',
      why: 'table',
      note: 'Nothing mechanical follows from the gear staying behind, which is the reading IE-044 already gave Gaseous Form\'s identical clause: an inventory and an equipped set are held, and there is no object on the ground for them to become.',
    },
  ],
  'find-steed': ['a-stat-block-created-mid-fight'],
  'fire-shield': ['a-spell-that-answers-a-later-attack'],
  // One of the two spells this family still finishes once its paragraphs are
  // read, and the shape's own description names it: "Meteor Swarm's four
  // Spheres, Fire Storm's ten Cubes". Everything else it prints is ordinary.
  'fire-storm': [
    {
      clause: 'A storm of fire appears within range',
      why: 'expressible',
      note: 'A point chosen within a hundred and fifty feet, which `ranged()` checks on every casting before a target is looked at.',
    },
    {
      clause: 'up to ten 10-foot Cubes, which you arrange as you like',
      why: 'a-wall-or-several-templates-in-one-area',
      note: 'One area per spell, and this one is ten of them arranged by the caster. The shape\'s own description names this spell\'s ten Cubes. **Recorded although the sentence trips no marker.**',
    },
    {
      clause: 'Each Cube must be contiguous with at least one other Cube',
      why: 'a-wall-or-several-templates-in-one-area',
      note: 'And a rule about how the ten relate to each other, which needs the ten to exist before it can be checked at all.',
    },
    {
      clause: 'taking 7d10 Fire damage on a failed save or half as much damage on a successful one',
      why: 'expressible',
      note: 'A typed `save-damage` effect with the ordinary half-on-a-success branch, which is the most common shape in the catalogue.',
    },
    {
      clause: "Flammable objects in the area that aren't being worn or carried start burning",
      why: 'table',
      note: 'The engine holds an inventory and an equipped set and no objects standing in a scene, so nothing catches fire and nothing follows from it mechanically.',
    },
  ],
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
      why: 'a-condition-immunity-narrowed-to-its-source',
      note: 'The condition half of the same sentence, and **the clause that says IE-042\'s grant is not enough for it**: the subject is "spells and other magical effects", so a Paralyzed from a Ghoul\'s claws still lands and a Hold Person\'s does not. `conditionImmunitiesOf` answers about a condition and knows nothing of what is causing it, which is the narrower residue rather than the shape that was built.',
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
      note: 'ending the casting is a command now — `endOngoingSpell` names it by id — and this sentence prints both of the exceptions that command does not carry: the creature ending it is the **target** rather than the caster, and the SRD charges a Magic action where a dismissal costs none.',
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
      why: 'expressible',
      note: 'IE-042\'s `condition-immunity` effect. SRD prints it unconditionally — "it has Immunity to the Prone condition" — beside the Resistance IE-017 already built, so the run this spell prints in one line is now expressible in both halves. Gaseous Form stays undefined on the six other blockers its entry names.',
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
  // **The one spell this family still finishes once its paragraphs are read.**
  // Everything Gate prints is the portal, and a portal is the one-scene model's
  // absence rather than a mechanism beside it — so the whole entry files under
  // one shape and nothing else is owed.
  gate: [
    {
      clause: 'a precise location on a different plane of existence',
      why: 'a-second-place-to-put-a-creature',
      note: 'There is one scene, so the far end of this portal has nowhere to be. The near end is an ordinary unoccupied space within range and needs nothing; the destination is the whole of the debt.',
    },
    {
      clause: 'you can make 5 to 20 feet in diameter',
      why: 'a-second-place-to-put-a-creature',
      note: 'The diameter and the facing below it are the portal\'s own geometry, and there is no portal for them to be geometry of. **Not a choice made at the casting**: that shape is for a choice which changes what the engine computes, and nothing here is computed until the second place exists.',
    },
    {
      clause: 'You can orient the portal in any direction you choose',
      why: 'a-second-place-to-put-a-creature',
      note: 'A facing, which matters only because travel is possible through one side. The engine holds positions and no orientation for anything, and again the thing being oriented is what is missing.',
    },
    {
      clause: 'Travel through the portal is possible only by moving through its front',
      why: 'a-second-place-to-put-a-creature',
      note: 'A move whose destination is off the scene entirely. `moveCreature` charges a budget between two positions in one scene, and there is no second scene for the far side to be in.',
    },
    {
      clause: 'Anything that does so is instantly transported to the other plane',
      why: 'a-second-place-to-put-a-creature',
      note: '`teleportCreature` places a creature at a position, and a plane is not a position. The arrival space — "the unoccupied space nearest to the portal" — is ordinary and the plane it is on is not.',
    },
    {
      clause: 'Deities and other planar rulers can prevent portals',
      why: 'table',
      note: 'Whether a deity objects is not a fact the engine holds and should never be one it decides, which is the line this repository already draws for cover, for sight and for who you are fighting.',
    },
    {
      clause: 'the portal opens next to the named creature and transports it',
      why: 'a-second-place-to-put-a-creature',
      note: 'The traffic running the other way: a creature that is **not** in the scene is brought into it. Adding a creature to a scene is something the engine does; finding one that was somewhere the model has no room for is not.',
    },
    {
      clause: 'It might leave, attack you, or help you',
      why: 'table',
      note: 'What the summoned being does next is the GM\'s, which the sentence before it says outright. The attack marker fires on the word rather than on any roll this spell causes.',
    },
  ],
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
      why: 'a-condition-immunity-narrowed-to-its-source',
      note: 'An Immunity narrowed twice over: "by them" is the chosen creature types, and "while in the area" is the geometry the two Extra Effects below already name. IE-042 built the unconditional grant and neither narrowing survived it. Possession is not modelled at all, and the two conditions beside it are what makes this sentence debt rather than fiction.',
    },
    {
      clause: "can't gain the Frightened condition while in the area",
      why: 'a-standing-effect-derived-from-where-a-creature-stands',
      note: 'Courage, **re-read against the built shape and re-filed**: the Immunity itself is unconditional in its cause and IE-042 expresses that, but "while in the area" is not — a grant is keyed by source and nothing re-derives one from where the creature now is. It is the Fear clause below it read the other way round, and it is filed where Fear already was.',
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
    {
      clause: 'Choose a willing creature that you can see within range',
      why: 'expressible',
      note: 'One named target at thirty feet with a sight requirement, which `targets` and `requiresSight` write between them.',
    },
    {
      clause: "the target's Speed is doubled",
      why: 'a-speed-an-effect-multiplies',
      note: 'The one sentence in the book that multiplies a Speed. A Speed is composed from halving, which is presence rather than count, and zero, which is last and wins; a doubling is neither, so the member arrives with the rule that settles it against a halving.',
    },
    {
      clause: 'it gains a +2 bonus to Armor Class',
      why: 'expressible',
      note: '`BonusApplies` covers attacks, saves and ability checks and now an Armour Class, so a flat bonus to AC for the duration is a `roll-modifier` effect as it stands.',
    },
    {
      clause: 'it has Advantage on Dexterity saving throws',
      why: 'expressible',
      note: 'A `roll-mode` effect narrowed to saving throws and to one ability, which Beacon of Hope already writes twice in one definition.',
    },
    {
      clause: 'it gains an additional action on each of its turns',
      why: 'an-action-a-spell-compels-or-forbids',
      note: 'Granting an extra action is named in this shape\'s own description beside forbidding one. The economy is the engine\'s and counts what a turn holds; nothing lets an effect add to that count.',
    },
    {
      clause: 'That action can be used to take only the Attack',
      why: 'an-action-a-spell-compels-or-forbids',
      note: 'And the granted action is narrowed to five named actions, with the Attack action limited to one attack — a second rider on a thing the first rider cannot create.',
    },
    {
      clause: 'the target is Incapacitated and has a Speed of 0 until the end of its next turn',
      why: 'an-effect-that-fires-when-the-casting-ends',
      note: 'Expiry is derived here, like Concentration breaking, and the log records an effect being scheduled rather than expiring — so a spell that punishes its target when it lapses has no hook to hang the lethargy on.',
    },
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
      why: 'expressible',
      note: 'One sentence, two tables, and IE-042 built the second: the Resistance beside it is a `damage-defense` and this is a `condition-immunity` naming two conditions in one clause, which is the plural list that kind carries. Heroes\' Feast stays undefined on the 10-minute casting time and the Hit Point maximum it raises.',
    },
    {
      clause: 'Its Hit Point maximum also increases by 2d10',
      why: 'a-hit-point-maximum-a-spell-moves',
      note: 'The maximum is set when a creature is added and by advancement, and no effect moves one — so the Hit Points gained with it would be capped at a maximum the spell was supposed to have raised.',
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
    {
      clause: 'Casting Time: 1 minute',
      why: 'a-long-casting-time',
      note: 'A minute, printed as a field rather than stated in the paragraph. The rite is built and the prison is the rest of the problem.',
    },
    {
      clause: 'Duration: Until dispelled',
      why: 'a-casting-dismissed-early',
      note: 'A casting that runs "Until dispelled" is refused outright, because the book gives its caster no ending at all — and the ending this spell does print is a trigger the GM has to agree to.',
    },
    {
      clause: 'You create a magical restraint to hold a creature that you can see within range',
      why: 'expressible',
      note: 'One named target at thirty feet with a sight requirement, which `targets` and `requiresSight` write between them and which needs nothing new.',
    },
    {
      clause: 'The target must make a Wisdom saving throw',
      why: 'expressible',
      note: 'A Wisdom save with everything on the failure branch, which is the plainest thing the definition format does.',
    },
    {
      clause: 'it is immune to this spell for the next 24 hours',
      why: 'an-effect-that-suppresses-other-magic',
      note: 'A creature that refuses this casting for a stated span, which is IE-044\'s reading of Freedom of Movement with a clock on it — the same missing state arriving at a holder rather than an area.',
    },
    {
      clause: 'On a failed save, the target is imprisoned',
      why: 'a-second-place-to-put-a-creature',
      note: 'There is one scene, and four of the five prisons below take the creature out of it. What "imprisoned" means is the rest of the paragraph and none of it is a position.',
    },
    {
      clause: "Divination spells can't locate or perceive the imprisoned target, and the target can't teleport",
      why: 'an-effect-that-suppresses-other-magic',
      note: 'An ongoing state that refuses other castings aimed at its holder, and refuses one the holder would cast. `teleportCreature` is real and nothing marks a creature as unable to use it.',
    },
    {
      clause: 'the target is also affected by one of the following effects of your choice',
      why: 'a-choice-made-at-the-casting',
      note: 'One of five whole prisons, decided when the slot is spent and read for as long as the spell runs. A per-casting choice has nowhere to be recorded.',
    },
    {
      clause: "The target has the Restrained condition and can't be moved by any means",
      why: 'an-effect-that-suppresses-other-magic',
      note: 'The Restrained is an ordinary `condition` effect; a creature that refuses every force that would move it is the other half, and `moveCreature` reads no such refusal — the same absence Freedom of Movement prints from the other side.',
    },
    {
      clause: 'The target is trapped in a demiplane that is warded against teleportation',
      why: 'a-second-place-to-put-a-creature',
      note: 'A demiplane of the caster\'s describing, which the one-scene model has no room for. The ward against teleportation is the suppression above, read inside a place that does not exist.',
    },
    {
      clause: 'The target becomes 1 inch tall',
      why: 'a-creature-fact-an-effect-overrides',
      note: 'Size is a fact the engine holds authoritatively and nothing may write over it for the duration of a spell — the row this shape names beside creature type. **Recorded although the sentence trips no marker.**',
    },
    {
      clause: 'Light can pass through the gemstone',
      why: 'table',
      note: 'Sight is a pairwise declaration here, so who can see whom through a gemstone is exactly what a DM declares. Nothing else passing through is the prison, which is already recorded.',
    },
    {
      clause: "The target has the Unconscious condition and can't be awoken",
      why: 'an-effect-that-suppresses-other-magic',
      note: 'The condition is ordinary and the refusal is not: a sleeper nothing can wake is a creature declining every effect that would end the condition, which has no state to sit in.',
    },
    {
      clause: 'specify a trigger that will end it',
      why: 'table',
      note: 'An observable action the GM must agree has a high likelihood of happening within the decade — someone making an offering, saving a love, defeating a monster. There is no more purely narrative trigger in the book.',
    },
    {
      clause: 'can end the spell only if it is cast with a level 9 spell slot',
      why: 'an-effect-that-suppresses-other-magic',
      note: 'A casting that refuses Dispel Magic below a stated slot level. `spell-ended` is the command that ends one and nothing marks a casting as exempt from it, which is this shape read from the defending end.',
    },
  ],
  'irresistible-dance': [
    {
      clause: 'One creature that you can see within range must make a Wisdom saving throw',
      why: 'expressible',
      note: 'One named target, a sight requirement and a Wisdom save, which is the shape the definition format was built around.',
    },
    {
      clause: 'the target dances comically until the end of its next turn',
      why: 'a-success-branch-that-does-something',
      note: 'Which branch a rider rides is the host\'s, never the author\'s: there is no success-branch slot, so a spell whose **successful** save still costs the target a turn has nowhere to say it.',
    },
    {
      clause: 'On a failed save, the target has the Charmed condition for the duration',
      why: 'expressible',
      note: 'A `condition` effect naming Charmed on the failure branch, with the casting\'s own duration — the ordinary half of this spell.',
    },
    {
      clause: 'must use all its movement to dance in place',
      why: 'an-action-a-spell-compels-or-forbids',
      note: 'The target\'s whole movement spent on something the rules chose. `moveCreature` charges a budget for a move somebody commanded and has no notion of a budget the rules have already spent.',
    },
    {
      clause: 'has Disadvantage on Dexterity saving throws and attack rolls',
      why: 'expressible',
      note: 'Two `roll-mode` effects, one narrowed to saves and one ability and one narrowed to attack rolls, both of which the roll-modifier vocabulary reaches today.',
    },
    {
      clause: 'other creatures have Advantage on attack rolls against it',
      why: 'expressible',
      note: '`relation: "against-holder"` is one of the two the selector carries, and attack rolls against the creature holding the effect is exactly what it selects.',
    },
    {
      clause: 'the target can take an action to collect itself and repeat the save',
      why: 'a-repeat-save-raised-by-a-trigger',
      note: 'A repeat save raised by the target **spending an action** rather than by a turn boundary, and the turn hook is the only thing that raises one. Filed to the nearest honest existing shape — the trigger list names damage, movement and distance and not this — and said so here.',
    },
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
      why: 'a-condition-immunity-narrowed-to-its-source',
      note: 'An Immunity narrowed to a source — "from the creature", meaning a creature of the type chosen at the casting — which is narrower than the grant IE-042 built and is what that build left behind. `conditionApplicability` holds a stat block\'s qualified entries for the same reason and no effect may add one.',
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
    {
      clause: 'Casting Time: 1 minute',
      why: 'a-long-casting-time',
      note: 'A minute, printed as a field rather than stated in the paragraph. The rite is built and everything the spell does afterwards happens to a soul.',
    },
    {
      clause: 'Duration: Until dispelled',
      why: 'a-casting-dismissed-early',
      note: 'A casting that runs "Until dispelled" is refused outright, because the book gives its caster no ending at all — and this one gives the caster three different endings in the paragraph.',
    },
    {
      clause: "You can't move or take Reactions",
      why: 'an-action-a-spell-compels-or-forbids',
      note: 'The caster\'s own movement and Reaction forbidden while the body lies catatonic. `mayAct` guards every spender and a spell reaches it only through a condition the engine names.',
    },
    {
      clause: 'The only action you can take is to project your soul up to 100 feet out of the container',
      why: 'an-action-a-spell-compels-or-forbids',
      note: 'Every action narrowed to exactly one, which is a stronger rider than any condition in the book prints and has nowhere at all to be written.',
    },
    {
      clause: 'You can attempt to possess any Humanoid within 100 feet of you that you can see',
      why: 'a-second-place-to-put-a-creature',
      note: 'A creature whose soul is in a jar and whose body is on the floor is in two places, and there is one scene. Everything downstream of this sentence needs the second one.',
    },
    {
      clause: "creatures warded by a _Protection from Evil and Good_ or _Magic Circle_ spell can't be possessed",
      why: 'an-effect-that-suppresses-other-magic',
      note: 'A creature refusing this casting because another one is running on it. `state.ongoing` holds both castings and nothing lets one refuse the other.',
    },
    {
      clause: 'The target makes a Charisma saving throw',
      why: 'expressible',
      note: 'A Charisma save against the casting\'s pinned DC, which is the most ordinary thing the format writes.',
    },
    {
      clause: "your soul enters the target's body, and the target's soul becomes trapped in the container",
      why: 'a-second-place-to-put-a-creature',
      note: 'Two souls swapped between a body and a jar, neither of which is a position the engine holds. This is the shape at its most literal.',
    },
    {
      clause: "you can't attempt to possess it again for 24 hours",
      why: 'an-effect-that-suppresses-other-magic',
      note: 'A creature that refuses this casting for a stated span after it saves — the same sentence Imprisonment and Sending both print, filed the same way rather than three ways.',
    },
    {
      clause: 'Your Hit Points, Hit Point Dice, Strength, Dexterity, Constitution, Speed, and senses are replaced',
      why: 'an-ability-score-a-spell-changes',
      note: 'A score is set at creation and by advancement, no effect moves one, and nothing puts one back — and this sentence moves three of them, plus the vitals and the Speed, and then moves them back.',
    },
    {
      clause: "the possessed creature's soul can perceive from the container using its own senses",
      why: 'a-second-place-to-put-a-creature',
      note: 'The displaced soul perceiving from the jar while its body walks around. Sight is a pairwise declaration between creatures in one scene, and this needs a second place for one of them to be.',
    },
    {
      clause: 'you can take a Magic action to return from the host body to the container',
      why: 'a-second-place-to-put-a-creature',
      note: 'A later action whose whole content is moving a soul between two things that are not positions. `SpellActivation` holds the Magic action and there is nothing for it to reach.',
    },
    {
      clause: "If the host body dies while you're in it, the creature dies",
      why: 'a-second-place-to-put-a-creature',
      note: 'A death that kills one creature and puts another to a saving throw, because two creatures were sharing one body. Neither half is a thing the scene can hold.',
    },
    {
      clause: 'On a success, you return to the container if it is within 100 feet of you',
      why: 'a-second-place-to-put-a-creature',
      note: 'The escape, gated on a distance the ruler measures exactly between the caster and an object. The measurement needs nothing; what is measured to does not exist.',
    },
    {
      clause: 'If your body is more than 100 feet away from you or if your body is dead, you die',
      why: 'a-second-place-to-put-a-creature',
      note: 'A distance measured between a creature and its **own** body, which presumes the two have separate positions. The engine gives a creature one.',
    },
    {
      clause: "the creature's soul returns to its body if the body is alive and within 100 feet",
      why: 'a-second-place-to-put-a-creature',
      note: 'The other soul\'s escape when the jar breaks, on the same two conditions. Every sentence of this paragraph is the same absence in a different arrangement.',
    },
    {
      clause: 'Otherwise, that creature dies',
      why: 'a-second-place-to-put-a-creature',
      note: 'And the failure branch of it. Death is a transition the engine owns end to end, and what would trigger this one is a soul with nowhere to go.',
    },
  ],
  'magic-missile': [
    'a-spells-effects-applied-to-different-targets',
    'damage-with-neither-an-attack-roll-nor-a-save',
  ],
  'magic-weapon': ['a-rider-on-a-later-weapon-attack'],
  'magnificent-mansion': [
    {
      clause: 'Casting Time: 1 minute',
      why: 'a-long-casting-time',
      note: 'A minute, printed as a field rather than stated in the paragraph. The rite runs on the clock since IE-034 and IE-041, and the dwelling behind the door is the rest.',
    },
    {
      clause: 'You conjure a shimmering door in range',
      why: 'a-second-place-to-put-a-creature',
      note: 'The door stands in the scene and what is behind it does not. There is one scene, so an extradimensional dwelling has nowhere to be and nobody can be inside it.',
    },
    {
      clause: 'You can open or close it (no action required) if you are within 30 feet of it',
      why: 'a-second-place-to-put-a-creature',
      note: 'A state the door holds, gated on a distance the ruler measures exactly. The distance needs nothing; the door and the place it opens onto are what the model has no room for.',
    },
    {
      clause: "they can't attack or take any action that would directly harm another creature",
      why: 'table',
      note: 'A hundred invulnerable servants inside a place the engine cannot hold, doing tasks it never resolves. Nothing here is a number the engine would compute, and the attack marker fires on a word rather than on a roll.',
    },
    {
      clause: 'any creatures or objects left inside the extradimensional space are expelled',
      why: 'a-second-place-to-put-a-creature',
      note: 'Creatures coming back out when the day runs out, from the place they could not have been in. Placement into the nearest unoccupied spaces is ordinary and never gets to run.',
    },
  ],
  'major-image': ['a-duration-the-slot-changes'],
  'mass-heal': [
    'a-flat-amount-with-no-dice',
    'a-spells-effects-applied-to-different-targets',
  ],
  // **The second blocker the design document had already written down.**
  // `SpellCheck.onSuccess` says outright that there is deliberately no
  // `end-casting` value and names Maze as one of the three spells that print
  // it — so the spell this map said a second place would finish needs a second
  // thing, and it was recorded in `spell-definitions.ts` all along.
  maze: [
    {
      clause: 'banish a creature that you can see within range into a labyrinthine demiplane',
      why: 'a-second-place-to-put-a-creature',
      note: 'There is one scene, so a creature banished out of it has nowhere to be. Everything the spell does for the next ten minutes happens somewhere the model has no room for.',
    },
    {
      clause: 'The target can take a Study action to try to escape',
      why: 'a-second-place-to-put-a-creature',
      note: '`ConditionRider.check` is a check the affected creature may attempt, and it hangs off a **condition** — Black Tentacles\' Restrained is the pattern. This spell imposes no condition at all, so the escape has nothing to be attached to.',
    },
    {
      clause: 'it makes a DC 20 Intelligence (Investigation) check',
      why: 'expressible',
      note: '`SpellCheck` carries an ability, a skill and a printed `dc`, and the field is one of the three the audit found with zero catalogue users. The check itself needs nothing new.',
    },
    {
      clause: 'If it succeeds, it escapes, and the spell ends',
      why: 'a-casting-ended-by-a-trigger',
      note: '`SpellCheck.onSuccess` is `none` or `end-on-target` and says in its own words that `end-casting` is deliberately absent, naming this spell. Ending the effect on the only target is not ending the casting — the caster would still be concentrating. Filed to the nearest honest existing shape, and said so; **the sentence trips no marker**.',
    },
    {
      clause: 'the target reappears in the space it left',
      why: 'a-second-place-to-put-a-creature',
      note: 'The return, and the space it left has to have been remembered for the whole duration while the creature was nowhere. Placement into the nearest unoccupied space is ordinary; coming back from nowhere is not.',
    },
  ],
  'meld-into-stone': ['a-world-fact-nothing-can-represent'],
  'meteor-swarm': [
    {
      clause: 'four different points you can see within range',
      why: 'a-wall-or-several-templates-in-one-area',
      note: 'One area per spell, and this one is four Spheres at four chosen points. The shape\'s own description names this spell\'s four Spheres beside Fire Storm\'s ten Cubes.',
    },
    {
      clause: 'a 40-foot-radius Sphere centered on each of those points',
      why: 'a-wall-or-several-templates-in-one-area',
      note: 'The geometry of the four, each a perfectly ordinary Sphere that the format could write once and cannot write four times.',
    },
    {
      clause: '20d6 Fire damage and 20d6 Bludgeoning damage on a failed save',
      why: 'expressible',
      note: '`save-damage.plus` carries further damage of other types under the **same** saving throw, which is what Flame Strike already writes — two effects would roll two saves and a target could fail one and make the other.',
    },
    {
      clause: 'A creature in the area of more than one fiery Sphere is affected only once',
      why: 'a-wall-or-several-templates-in-one-area',
      note: 'A rule about how the four overlap, which cannot be stated before there are four. It is not `AreaTrigger.oncePerTurn`: that caps a creature across a turn, and this caps it across one resolution.',
    },
    {
      clause: "A nonmagical object that isn't being worn or carried also takes the damage",
      why: 'table',
      note: 'The engine holds an inventory and an equipped set and no objects standing in a scene, so there is nothing for the damage to arrive at and nothing to catch fire.',
    },
  ],
  // The spell the query predicted IE-017 would finish and did not — the
  // sharpest correction this map has made, and the reason its entry is the
  // first anybody should be able to read back.
  // **Mind Blank is defined and is no longer in this population.** Its entry
  // read two clauses — the Psychic Immunity IE-017 built and the Charmed
  // Immunity it deliberately did not — and IE-042 built the second, so both
  // halves of the one sentence execute and the spell leaves the map by the
  // route `coverageGaps().stale` names. It was this map's sharpest correction
  // and is now its first `finishes` collected: the query predicted IE-017 would
  // finish it, the build proved the storage was different, and the debt it left
  // was paid by the task the prediction's failure was what briefed.
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
  mislead: [
    {
      clause: 'You gain the Invisible condition',
      why: 'expressible',
      note: 'A `condition` effect naming Invisible on its own caster, which Greater Invisibility already writes as the whole of a spell.',
    },
    {
      clause: 'an illusory double of you appears where you are standing',
      why: 'a-second-place-to-put-a-creature',
      note: 'A caster who is in two places, one of which the scene has no room for: the double holds a position, is moved and is perceived through, and is not a creature the engine could add.',
    },
    {
      clause: 'the invisibility ends immediately after you make an attack roll',
      why: 'a-casting-ended-by-a-trigger',
      note: 'Three of IE-032\'s five transcribed causes, ending **one effect** of the casting rather than the casting — the double outlives the invisibility, and this shape\'s description names this spell for exactly that.',
    },
    {
      clause: 'you can move the illusory double up to twice your Speed',
      why: 'a-second-place-to-put-a-creature',
      note: 'A later Magic action whose content is moving the double. `SpellActivation.movesArea` moves the spell\'s own **area** and this is not one; what moves is the caster\'s second position, which does not exist.',
    },
    {
      clause: 'You can see through its eyes and hear through its ears',
      why: 'senses-beyond-declared-sight',
      note: 'Sight here is a pairwise declaration and there is nothing else, so one creature borrowing another\'s senses has no state to sit in — the same clause Find Familiar prints, filed the same way rather than two ways.',
    },
  ],
  'modify-memory': ['a-casting-ended-by-a-trigger'],
  'pass-without-trace': ['a-standing-effect-derived-from-where-a-creature-stands'],
  // **The payout entry was mis-filed, and the printed sentence is what says
  // so.** "**On each of your turns**, such a phantasm can deal 2d8 Psychic
  // damage to the target if it is in the phantasm's area or within 5 feet of
  // the phantasm" is the *caster's* boundary rather than the target's — the
  // shape filed separately as `an-area-trigger-on-the-casters-turn` — and the
  // damage is owed only while the target stands near a point. So a payout at
  // the recipient's own boundary reaches none of this clause, and the honest
  // correction is the two shapes that do.
  'phantasmal-force': [
    'an-area-trigger-measured-from-a-point',
    'an-area-trigger-on-the-casters-turn',
  ],
  // **The bare list had missed the field.** A minute is a long casting and this
  // entry never said so, which is the kind of omission only reading the printed
  // entry rather than the paragraph finds.
  'phantom-steed': [
    {
      clause: 'Casting Time: 1 minute or Ritual',
      why: 'a-long-casting-time',
      note: 'A minute, or the Ritual IE-034 made a long casting of the same kind — and this entry had recorded neither. Find Familiar prints the same field shape and did record it, so the two entries disagreed about one field until this reading.',
    },
    {
      clause: 'A Large, quasi-real, horselike creature appears on the ground',
      why: 'a-stat-block-created-mid-fight',
      note: 'The steed is a creature with a stat block borrowed from the monster list, placed in an unoccupied space at the casting. The engine has no way for a spell to add a creature to the scene.',
    },
    {
      clause: 'it is equipped with a saddle, bit, and bridle',
      why: 'table',
      note: 'The tack is created and nothing mechanical follows from it: the engine holds an inventory and an equipped set, and neither a saddle nor a bridle has a slot or a rule that reads one.',
    },
    {
      clause: 'The steed uses the Riding Horse stat block',
      why: 'a-stat-block-created-mid-fight',
      note: 'The book saying outright that the content of this spell is a monster entry, with one number overridden. A Speed of a hundred feet has a reader; the creature holding it does not exist.',
    },
    {
      clause: 'The spell ends early if the steed takes any damage',
      why: 'a-casting-ended-by-a-trigger',
      note: 'Damage from **anybody**, which this shape\'s description already names as the largest of the causes IE-032\'s five transcribed scopes cannot express — the two scopes it built are the target acting and the caster or an ally striking, and neither is "any damage at all".',
    },
  ],
  'planar-ally': [
    {
      clause: 'Casting Time: 10 minutes',
      why: 'a-long-casting-time',
      note: 'Ten minutes, printed as a field rather than stated in the paragraph. The rite runs on the clock since IE-034 and IE-041, and it is still one of the two things this entry records.',
    },
    {
      clause: 'That entity sends a Celestial, an Elemental, or a Fiend',
      why: 'a-stat-block-created-mid-fight',
      note: 'A creature of the caster\'s rough choosing appears in an unoccupied space within range, and the GM decides which. Whatever it turns out to be, it is a stat block the engine has no way to add to a fight.',
    },
    {
      clause: 'The requested task could range from simple',
      why: 'table',
      note: 'The whole of the bargaining, the payment and the service is fiction the engine never arrives at. The range marker fires here on the phrase "range from" rather than on any distance, which is the floor over-firing in the direction that costs a written sentence.',
    },
    {
      clause: 'A Celestial might require a sizable donation',
      why: 'table',
      note: 'What a summoned being asks for in exchange for its help is the table\'s, and the creature-type marker fires because the book names the type rather than because a rule reads it.',
    },
  ],
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
    {
      clause: 'washes over one creature you can see within range',
      why: 'expressible',
      note: 'One named target at sixty feet with a sight requirement, which `targets` and `requiresSight` write between them and which needs nothing new.',
    },
    {
      clause: 'The target regains all its Hit Points',
      why: 'a-flat-amount-with-no-dice',
      note: 'An amount may now carry a `flat` and no notation, which is the printed half of this shape and is all this spell\'s sibling Heal needs. This is the other half: the whole of the target\'s maximum is a number read off the creature at the moment of healing rather than one the spell prints, and nothing in the format derives an amount from a target. The audit names the two together.',
    },
    {
      clause: 'the condition ends',
      why: 'expressible',
      note: '`end-condition` takes a list of condition names, and five of them named in one clause is one effect rather than five.',
    },
    {
      clause: 'it can use its Reaction to stand up',
      why: 'an-action-a-spell-compels-or-forbids',
      note: 'The spell hands the **target** a use of its own Reaction. Spending somebody else\'s Reaction is named in this shape\'s own description, and `mayAct` guards the Reaction like every other spender.',
    },
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
  'project-image': [
    {
      clause: 'The copy can appear at any location within range that you have seen before',
      why: 'a-second-place-to-put-a-creature',
      note: 'Five hundred miles, regardless of intervening obstacles. Whatever the copy is, it stands somewhere the one scene does not reach, and the caster is in two places for a day.',
    },
    {
      clause: 'If the illusion takes any damage, it disappears, and the spell ends',
      why: 'a-casting-ended-by-a-trigger',
      note: '**Any** damage from anybody is the largest of the causes IE-032\'s two built scopes cannot express, and it is arriving here on the spell\'s own creation rather than on a creature.',
    },
    {
      clause: "You can see through the illusion's eyes and hear through its ears",
      why: 'senses-beyond-declared-sight',
      note: 'Sight here is a pairwise declaration and there is nothing else, so borrowing another thing\'s senses has no state to sit in — the sentence Mislead and Find Familiar both print, filed the same way rather than three ways.',
    },
    {
      clause: 'you can move it up to 60 feet and make it gesture, speak, and behave',
      why: 'a-second-place-to-put-a-creature',
      note: 'A later Magic action whose content is moving the copy. `SpellActivation.movesArea` moves the spell\'s own **area** and this is not one; what moves is the caster\'s second position.',
    },
    {
      clause: 'Physical interaction with the image reveals it to be illusory',
      why: 'table',
      note: 'What happens when somebody reaches through an illusion is narration the engine\'s resolution path never arrives at; the arithmetic half of disbelieving it is the sentence below.',
    },
    {
      clause: 'can determine that it is an illusion with a successful Intelligence (Investigation) check',
      why: 'expressible',
      note: '`SpellDefinition.check` is a check attempted against the casting itself, which is the illusion case the field was built for — and this casting has a duration, so there is something standing there to examine.',
    },
    {
      clause: 'the creature can see through the image, and any noise it makes sounds hollow',
      why: 'table',
      note: 'What a creature who has disbelieved perceives is narration, and `SpellCheck.onSuccess: "none"` says so in the format itself — the examiner now knows and nothing the engine holds has changed.',
    },
  ],
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
      why: 'a-condition-immunity-narrowed-to-its-source',
      note: 'An Immunity to two named conditions, narrowed to a source — "them" is the six creature types the first sentence protects against. IE-042 built the unconditional grant and this is the narrowing it deliberately does not carry: `conditionImmunitiesOf` answers about a condition and has no second argument for who is causing it.',
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
  // **The payout half is built and this entry is re-read rather than edited.**
  // "For the duration, the target regains 1 Hit Point at the start of each of
  // its turns" is a `turn-payout` of healing carrying a printed number, word
  // for word, so what is left of the spell is the minute it takes to cast.
  regenerate: ['a-long-casting-time'],
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
  'secret-chest': [
    {
      clause: 'Duration: Until dispelled',
      why: 'a-casting-dismissed-early',
      note: 'A casting that runs "Until dispelled" is refused outright, because the book gives its caster no ending at all. The blocker is printed in the field and stated in no sentence, which is why the clause is anchored to the field.',
    },
    {
      clause: 'You hide a chest and all its contents on the Ethereal Plane',
      why: 'a-second-place-to-put-a-creature',
      note: 'There is one scene, so a thing put somewhere else has nowhere to be — and here what is put there is an object rather than a creature, which the scene has even less room for.',
    },
    {
      clause: 'you can take a Magic action and touch the replica to recall the chest',
      why: 'a-second-place-to-put-a-creature',
      note: 'A later action whose whole content is fetching something back from the place the model does not have. `SpellActivation` holds the Magic action and there is nothing for it to reach.',
    },
    {
      clause: 'It appears in an unoccupied space on the ground within 5 feet of you',
      why: 'a-second-place-to-put-a-creature',
      note: 'The arrival is an ordinary placement and the thing arriving has spent the interval nowhere, which is the half that cannot be written.',
    },
    {
      clause: 'You can send the chest back to the Ethereal Plane',
      why: 'a-second-place-to-put-a-creature',
      note: 'The same traffic running the other way, on a second Magic action. Two sentences of one shape are two entries, because each is a sentence somebody has to have read.',
    },
    {
      clause: 'there is a cumulative 5 percent chance at the end of each day that the spell ends',
      why: 'a-random-outcome-that-is-not-a-d20',
      note: 'A percentage the generator could throw and no `SpellEffect` asks for, **rising each day**, deciding whether the casting survives. Recorded although the sentence trips no marker.',
    },
    {
      clause: 'if the Tiny replica chest is destroyed',
      why: 'a-casting-ended-by-a-trigger',
      note: 'An object being destroyed is a fact no consequence event holds — the two scopes IE-032 built are the target acting and the caster or an ally striking, and the engine has no objects for either to reach. The recast half of the same sentence is `replacesPriorCasting` and needs nothing.',
    },
  ],
  seeming: ['a-spells-effects-applied-to-different-targets'],
  sending: [
    {
      clause: 'a creature you have met or a creature described to you by someone who has met it',
      why: 'table',
      note: 'How well the caster knows the target is a fact the engine does not hold and cannot derive, and declaring it is the discipline this repository already draws for cover, sight and who you are fighting.',
    },
    {
      clause: 'even to other planes of existence',
      why: 'a-second-place-to-put-a-creature',
      note: 'There is one scene, so a target on another plane is not a creature the engine can find at all — this spell is the shape read from the other end, reaching somebody who is nowhere rather than sending them there.',
    },
    {
      clause: "there is a 5 percent chance that the message doesn't arrive",
      why: 'a-random-outcome-that-is-not-a-d20',
      note: 'A percentage the generator could throw and no `SpellEffect` asks for. Recorded although the sentence trips no marker, because it is one of the two mechanical things this spell does.',
    },
    {
      clause: 'a creature can block your ability to reach it again with this spell for 8 hours',
      why: 'an-effect-that-suppresses-other-magic',
      note: 'A creature that refuses a casting aimed at it, for a stated span. That is IE-044\'s reading of Freedom of Movement with a clock on it — the same missing state arriving at a holder rather than an area — and it is filed to the nearest honest existing shape rather than a new one.',
    },
  ],
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
  // Three sentences, three shapes, and the third trips no marker at all — the
  // one that forbids casting is the family shape and `CLAUSE_MARKERS` cannot
  // see it, because the book writes "Verbal component" where the list looks
  // for an action it names.
  silence: [
    {
      clause: 'no sound can be created within or pass through a 20-foot-radius Sphere',
      why: 'table',
      note: 'Sound is not a fact the engine holds, and the two mechanical consequences the spell draws from it are the sentences below. The Sphere itself is an ordinary `area` at a chosen point.',
    },
    {
      clause: 'has Immunity to Thunder damage',
      why: 'a-standing-effect-derived-from-where-a-creature-stands',
      note: 'IE-017 built the granted damage defence, so the Immunity itself is a `damage-defense` effect; what has no shape is it being **derived from standing inside the area**, afresh, rather than granted once and ended once.',
    },
    {
      clause: 'creatures have the Deafened condition while entirely inside it',
      why: 'a-condition-that-ends-when-its-holder-leaves-an-area',
      note: 'A condition that ends when its holder walks out of an area has no shape here at all, which `docs/design/space-and-areas.md` says outright for Web\'s Restrained: "a condition that ends when its holder walks out of an area has no shape here at all".',
    },
    {
      clause: 'Casting a spell that includes a Verbal component is impossible there',
      why: 'an-action-a-spell-compels-or-forbids',
      note: 'A casting forbidden by where the caster is standing, which is the action economy read through geometry. **The sentence trips no marker**: the list looks for the Magic action by name and the book writes a component instead.',
    },
  ],
  simulacrum: [
    {
      clause: 'Casting Time: 12 hours',
      why: 'a-long-casting-time',
      note: 'Twelve hours, the second longest casting the book prints, and a field rather than a sentence. The rite is built; what it produces is not.',
    },
    {
      clause: 'Duration: Until dispelled',
      why: 'a-casting-dismissed-early',
      note: 'A casting that runs "Until dispelled" is refused outright, because the book gives its caster no ending at all and every ongoing casting here needs one. The blocker is printed in the field and named in no sentence, which is why the clause is anchored to the field.',
    },
    {
      clause: 'You create a simulacrum of one Beast or Humanoid',
      why: 'a-stat-block-created-mid-fight',
      note: 'A second creature standing in the scene, built from a copy of an existing one. Whatever its statistics turn out to be, nothing a casting does adds a creature to the engine\'s scene.',
    },
    {
      clause: 'its Hit Point maximum is half as much',
      why: 'a-stat-block-created-mid-fight',
      note: 'A whole stat block derived from another creature\'s, with its type overwritten and its maximum halved. It is not `a-hit-point-maximum-a-spell-moves`: no existing creature\'s maximum changes, and the halved number belongs to a creature that does not exist.',
    },
    {
      clause: 'the only way to restore its Hit Points',
      why: 'healing-modified-by-an-effect',
      note: '`healCreature` rolls its dice and caps at the maximum, and nothing stands beside it to forbid a heal. A creature that cannot be healed by any ordinary means is the same missing reader the audit read off Chill Touch, pushed one step further.',
    },
    {
      clause: 'repair it as you take a Long Rest',
      why: 'a-deadline-anchored-to-a-rest',
      note: 'A rest is a span the engine measures and is neither of the two things a `Deadline` may be, so an effect that happens **during** one has nothing to be anchored to. The hundred gold per Hit Point is the table\'s, and the anchor is not.',
    },
    {
      clause: 'The simulacrum must stay within 5 feet of you for the repair',
      why: 'a-deadline-anchored-to-a-rest',
      note: 'A distance the ruler measures exactly, gating the rest-anchored repair above. The measurement needs nothing new; the thing it gates is what has no anchor, so the two sentences file together.',
    },
    {
      clause: 'The simulacrum lasts until it drops to 0 Hit Points',
      why: 'a-casting-ended-by-a-trigger',
      note: 'Dropping to 0 Hit Points is named in that shape\'s own description as a cause `CastingEndTrigger` has no member for. Here it is the spell\'s own creation whose vitals run out, and the casting — an "Until dispelled" one — is what ends.',
    },
  ],
  sleep: [
    'a-casting-ended-by-a-trigger',
    'a-check-another-creature-may-attempt',
    'a-repeat-save-that-does-something-on-a-failure',
    'an-outcome-that-reads-the-targets-defences',
  ],
  'sleet-storm': ['an-outcome-that-breaks-concentration', 'difficult-terrain-an-area-creates'],
  slow: [
    {
      clause: 'up to six creatures of your choice in a 40-foot Cube within range',
      why: 'expressible',
      note: '`targetsWithin` is a target list bounded by a template rather than an area that picks its own targets, which is exactly what Mass Cure Wounds already writes: the point is held to the spell\'s range and every name is held to the shape.',
    },
    {
      clause: 'Each target must succeed on a Wisdom saving throw or be affected',
      why: 'expressible',
      note: 'A Wisdom save per target with the effects on the failure branch, which is the plainest thing the definition format does.',
    },
    {
      clause: "An affected target's Speed is halved",
      why: 'expressible',
      note: 'Halving is presence rather than count — the reading Resistance and Advantage already take — so a halved Speed is a `speed-modifier` effect ended by the casting.',
    },
    {
      clause: 'it takes a −2 penalty to AC and Dexterity saving throws',
      why: 'expressible',
      note: '`BonusApplies` covers an Armour Class and saving throws, and a negative bonus is the same field; two effects in one clause rather than one effect with two homes.',
    },
    {
      clause: "it can't take Reactions",
      why: 'an-action-a-spell-compels-or-forbids',
      note: 'One category of action forbidden while the rest stay. `mayAct` guards the Reaction and a spell reaches it only through a condition the engine names, and no condition forbids exactly this.',
    },
    {
      clause: 'it can take either an action or a Bonus Action, not both',
      why: 'an-action-a-spell-compels-or-forbids',
      note: 'A rule that spends one of the turn\'s two slots when the other is used, and a cap of one attack inside the Attack action. The economy counts what a turn holds and nothing lets an effect change the counting.',
    },
    {
      clause: 'there is a 25 percent chance the spell fails',
      why: 'a-random-outcome-that-is-not-a-d20',
      note: 'A percentage the generator could throw and no `SpellEffect` asks for, deciding whether another casting happens at all. Recorded although the sentence trips no marker.',
    },
    {
      clause: 'repeats the save at the end of each of its turns, ending the spell on itself',
      why: 'expressible',
      note: '`RepeatSave` at `end-of-turn` with `onSuccess: "end-on-target"`, which Hold Person already writes and the scenario test already exercises.',
    },
  ],
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
    {
      clause: 'Casting Time: 1 minute',
      why: 'a-long-casting-time',
      note: 'A minute, printed as a field rather than stated in the paragraph. The rite runs on the clock since IE-034 and IE-041, and it is one of several things this entry records.',
    },
    {
      clause: 'Duration: Until dispelled or triggered',
      why: 'a-casting-dismissed-early',
      note: 'A casting that runs "Until dispelled" is refused outright, because the book gives its caster no ending at all. Here it is refused twice over: the second way out is the glyph firing, which is a trigger rather than a dismissal.',
    },
    {
      clause: 'the glyph is broken, and the spell ends without being triggered',
      why: 'a-casting-ended-by-a-trigger',
      note: 'The casting ends because an object moved ten feet, which is a fact no consequence event holds — the two scopes IE-032 built are the target acting and the caster or an ally striking, and neither is a thing being carried away.',
    },
    {
      clause: 'requires a successful Wisdom (Perception) check against your spell save DC',
      why: 'expressible',
      note: 'Who may attempt a check is derived from what the timer sits on, and a casting with no victim is anybody\'s to see through — which is this glyph exactly, and the DC is the casting\'s own pinned save DC.',
    },
    {
      clause: 'you set its trigger and choose which effect the symbol bears',
      why: 'a-choice-made-at-the-casting',
      note: 'One of six whole effect sets, decided when the slot is spent, and a casting has nowhere to record a choice made when it was made. A damage type is the one choice that has a field.',
    },
    {
      clause: 'You decide what triggers the glyph when you cast the spell',
      why: 'a-choice-made-at-the-casting',
      note: 'A second choice made at the same moment, and an open-ended one — touching, stepping, opening, seeing, approaching. There is no field for it and no vocabulary the choice would be drawn from.',
    },
    {
      clause: 'only creatures of certain types activate it',
      why: 'a-creature-type-predicate-an-area-reads',
      note: '`designatesUnaffected` is the one filter an area has and it is explicit ids chosen once; a predicate over a creature **type** deciding who trips a trigger is a different question, and IE-019 answered it for an outcome rather than for who is caught.',
    },
    {
      clause: 'Each target makes a Constitution saving throw, taking 10d10 Necrotic damage',
      why: 'expressible',
      note: 'A typed save-damage effect with the ordinary half-on-a-success branch — the first of the six, and the plainest.',
    },
    {
      clause: '_Discord._ Each target makes a Wisdom saving throw',
      why: 'expressible',
      note: 'The second effect\'s save, which the definition format writes directly; what the failure does is the two sentences below it.',
    },
    {
      clause: 'a target argues with other creatures for 1 minute',
      why: 'table',
      note: 'Arguing is fiction and the engine\'s resolution path never arrives at it; the mechanical half of the same branch is the sentence that follows, and it needs nothing new.',
    },
    {
      clause: 'has Disadvantage on attack rolls and ability checks',
      why: 'expressible',
      note: 'Two `roll-mode` effects, one on attack rolls and one on ability checks, both of which the roll-modifier vocabulary reaches as it stands.',
    },
    {
      clause: '_Fear._ Each target must succeed on a Wisdom saving throw or have the Frightened condition',
      why: 'expressible',
      note: 'A `condition` effect naming Frightened on the failure branch of a save, with a duration of its own rather than the casting\'s.',
    },
    {
      clause: 'the target must move at least 30 feet away from the glyph on each of its turns',
      why: 'an-action-a-spell-compels-or-forbids',
      note: 'Compelled movement, measured from the glyph rather than from a creature, on every one of the target\'s turns. The Frightened condition the engine names carries no such rider.',
    },
    {
      clause: '_Pain._ Each target must succeed on a Constitution saving throw',
      why: 'expressible',
      note: 'The fourth effect: a Constitution save and the Incapacitated condition for a minute, which the format writes without help.',
    },
    {
      clause: '_Sleep._ Each target must succeed on a Wisdom saving throw',
      why: 'expressible',
      note: 'The fifth: a Wisdom save and the Unconscious condition for ten minutes. What is not ordinary is how it ends, below.',
    },
    {
      clause: 'A creature awakens if it takes damage',
      why: 'a-casting-ended-by-a-trigger',
      note: '**Any** damage from anybody, which is the largest of the causes IE-032\'s two built scopes cannot express, ending one effect of the casting rather than the casting itself.',
    },
    {
      clause: 'someone takes an action to shake it awake',
      why: 'a-check-another-creature-may-attempt',
      note: 'An ally reaching in to wake a sleeper is named in this shape\'s own description, and the derivation of who may attempt a check has no third branch for it.',
    },
    {
      clause: '_Stunning._ Each target must succeed on a Wisdom saving throw or have the Stunned condition',
      why: 'expressible',
      note: 'The sixth and last effect, and the simplest: a Wisdom save and the Stunned condition for a minute with nothing riding on it.',
    },
  ],
  telekinesis: [
    'a-target-rule-the-format-cannot-state',
    'an-activation-that-forces-a-saving-throw',
    'forced-movement-a-spell-causes',
    'what-a-creature-is-holding',
  ],
  // **Seventy-seven printed units and two blockers**, because most of the
  // paragraph is the GM's familiarity table and the book says outright whose
  // roll it is. Filing the familiarity rows under `a-fact-only-the-table-can-
  // declare` was considered and refused: the SRD hands the whole mechanism to
  // the GM — "The GM rolls 1d100" — so it is the table's rather than a fact the
  // engine is missing a reader for.
  teleport: [
    {
      clause: 'transports you and up to eight willing creatures that you can see within range, or a single object',
      why: 'a-second-place-to-put-a-creature',
      note: 'There is one scene, so a destination the caster "selects" out of the world at large has nowhere to be — and the thing transported may be an object, which the scene holds none of either.',
    },
    {
      clause: 'The GM rolls 1d100 and consults the Teleportation Outcome table',
      why: 'a-random-outcome-that-is-not-a-d20',
      note: 'The generator throws any notation `parseNotation` reads and no `SpellEffect` asks it for one, so a d100 indexing a table has nothing to ask and nowhere for the answer to be consulted.',
    },
    {
      clause: '**Teleportation Outcome**',
      why: 'a-random-outcome-that-is-not-a-d20',
      note: 'The table\'s own heading, which the splitter returns as a unit because it ends a line. It names the mechanism above rather than adding one, and it is here because every unit that trips a marker is answered.',
    },
    {
      clause: '<td>Seen casually</td>',
      why: 'table',
      note: 'A cell of the familiarity table, and the book hands the whole roll to the GM two sentences earlier. How well a caster knows a place is exactly the kind of fact declared cover and declared sight are.',
    },
    {
      clause: '"Permanent circle" means a permanent teleportation circle whose sigil sequence you know',
      why: 'table',
      note: 'Which sigil sequences a caster has memorised is a fact about the campaign the engine does not hold and should never decide, which Teleportation Circle\'s own entry records the same way.',
    },
    {
      clause: '"Very familiar" is a place you have visited often',
      why: 'table',
      note: 'The definition of a familiarity band, read by a roll the GM makes. Nothing in it is a number the engine would compute.',
    },
    {
      clause: '"Seen casually" is a place you have seen more than once',
      why: 'table',
      note: 'The second band\'s definition, and the same answer: the GM knows where the party has been and the engine does not.',
    },
    {
      clause: '"Viewed once or described" is a place you have seen once',
      why: 'table',
      note: 'The third band, reaching a place known only from somebody else\'s description or a map. The senses marker fires on the word rather than on declared sight.',
    },
    {
      clause: 'Perhaps you tried to scry an enemy\'s sanctum but instead viewed an illusion',
      why: 'table',
      note: 'The book explaining what a false destination is, which is a story the GM tells rather than a state the engine keeps.',
    },
    {
      clause: 'takes 3d10 Force damage, and the GM rerolls on the table',
      why: 'a-random-outcome-that-is-not-a-d20',
      note: 'Typed damage the format writes easily, delivered by a roll it cannot ask for — and then the same roll again, possibly repeatedly, which is the mechanism rather than the damage.',
    },
    {
      clause: 'appear 2d12 miles away from the destination in a random direction',
      why: 'a-random-outcome-that-is-not-a-d20',
      note: 'A distance rolled rather than printed, landing somewhere the scene has no room for. The generator could throw the 2d12 and no effect asks it to.',
    },
    {
      clause: 'Roll 1d8 for the direction',
      why: 'a-random-outcome-that-is-not-a-d20',
      note: 'A third die inside the second, choosing a compass direction the engine has no notion of — positions are coordinates and nothing names east.',
    },
  ],
  'teleportation-circle': [
    {
      clause: 'Casting Time: 1 minute',
      why: 'a-long-casting-time',
      note: 'A minute, printed as a field rather than stated in the paragraph. The rite runs on the clock since IE-034 and IE-041, and the destination is the rest of the problem.',
    },
    {
      clause: 'link your location to a permanent teleportation circle of your choice',
      why: 'a-second-place-to-put-a-creature',
      note: 'The far end is a place the caster has memorised rather than a position in this scene, and there is one scene — so the link has nothing at the other end of it to point at.',
    },
    {
      clause: 'Any creature that enters the portal instantly appears within 5 feet of the destination circle',
      why: 'a-second-place-to-put-a-creature',
      note: '`teleportCreature` places a creature at a position, and the destination here is somewhere the model has no room for. The fallback into the nearest unoccupied space is ordinary and never gets to run.',
    },
    {
      clause: 'Many major temples, guildhalls, and other important places have permanent teleportation circles',
      why: 'table',
      note: 'Where the permanent circles are, and which sigil sequences a caster knows, are facts about the world the engine does not hold and should never decide — the discipline this repository already draws for declared cover and declared sight.',
    },
    {
      clause: 'You can create a permanent teleportation circle by casting this spell in the same location every day for 365 days',
      why: 'table',
      note: 'A year of downtime producing a fixture of the setting. Nothing about it is a number the engine would compute, and the clock measures a campaign rather than a year of repeated castings.',
    },
  ],
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
    {
      clause: 'Choose one creature or nonmagical object that you can see within range',
      why: 'a-target-rule-the-format-cannot-state',
      note: 'The creature half is `targets` and `requiresSight` exactly; the **object** half is a fourth fact beside the size, the Challenge Rating and the ability score this shape already names. Filed to the nearest honest existing shape rather than a new one, and said so here.',
    },
    {
      clause: 'until the target dies or is destroyed',
      why: 'a-casting-ended-by-a-trigger',
      note: 'The target dying is named in that shape\'s own description with this spell beside it, and it is one of the causes whose fact no consequence event the two built scopes can see holds.',
    },
    {
      clause: 'the spell lasts until dispelled',
      why: 'a-casting-dismissed-early',
      note: 'A casting that runs "Until dispelled" is refused outright, and this one arrives there **conditionally** — only if Concentration is held for the whole hour. So the duration changes kind partway through, which is a second thing no field says.',
    },
    {
      clause: 'An unwilling creature can make a Wisdom saving throw',
      why: 'expressible',
      note: 'A `save` effect naming Wisdom, with nothing happening on a success, which is the most ordinary shape the definition format carries.',
    },
    {
      clause: "a Challenge Rating equal to or less than the target's Challenge Rating",
      why: 'a-target-rule-the-format-cannot-state',
      note: 'A Challenge Rating is not held at all, so a bound that compares one creature\'s to another\'s has nothing on either side to read. Recorded although the sentence trips no marker, because it is the shape\'s own named fact printed plainly.',
    },
    {
      clause: "The target's game statistics are replaced by the stat block of the new form",
      why: 'a-stat-block-created-mid-fight',
      note: 'A stat block arriving mid-fight by replacement rather than by summons, keeping the old creature\'s Hit Points and personality. The engine has one set of statistics per creature and no way to swap it.',
    },
    {
      clause: 'a number of Temporary Hit Points equal to the Hit Points of the new form',
      why: 'a-stat-block-created-mid-fight',
      note: '`grantTemporaryHpTo` exists and the number it would be given is read off a stat block the engine cannot produce. The blocker is the source of the number rather than the absence of dice.',
    },
    {
      clause: 'These Temporary Hit Points vanish if any remain when the spell ends',
      why: 'an-effect-that-fires-when-the-casting-ends',
      note: 'Expiry is derived here, like Concentration breaking, and the log records an effect being scheduled rather than expiring — so nothing hangs a consequence on the moment this casting runs out.',
    },
    {
      clause: "it can't speak or cast spells",
      why: 'an-action-a-spell-compels-or-forbids',
      note: 'Gaseous Form\'s sentence, arriving on a transformed creature that already exists rather than on one the spell made — so it is a rider on an economy the engine runs, and `mayAct` has no lever a spell can pull short of a condition the engine names. **The sentence trips no marker**, because the book writes "cast spells" rather than "attack".',
    },
    {
      clause: 'it transforms along with whatever it is wearing and carrying',
      why: 'table',
      note: 'The gear coming along is the reading IE-044 gave Gaseous Form\'s identical clause: an inventory and an equipped set are held and there is no transformed state for either to be in, so nothing mechanical follows.',
    },
    {
      clause: "as long as the object's size is no larger than the creature's size",
      why: 'a-target-rule-the-format-cannot-state',
      note: 'A size comparison deciding whether the spell may be cast at all. Size is held and the only rules that read it are sharing a space, passing through, and the volume a template tests.',
    },
  ],
  'true-resurrection': [
    'a-flat-amount-with-no-dice',
    'a-long-casting-time',
    'healing-that-raises-the-dead',
  ],
  'true-strike': ['a-rider-on-a-later-weapon-attack'],
  // The heaviest paragraph in this family: four shapes were recorded and reading
  // it finds four more, every one of them a shape this map already names.
  tsunami: [
    {
      clause: 'Casting Time: 1 minute',
      why: 'a-long-casting-time',
      note: 'A minute, printed as a field rather than stated in the paragraph. The rite runs on the clock since IE-034 and IE-041, and the wave is the rest.',
    },
    {
      clause: 'A wall of water springs into existence at a point you choose within range',
      why: 'a-wall-or-several-templates-in-one-area',
      note: 'Three hundred feet long, three hundred high and fifty thick, and `SpellArea` has six shapes and none of them is a wall.',
    },
    {
      clause: 'taking 6d10 Bludgeoning damage on a failed save',
      why: 'expressible',
      note: 'A typed `save-damage` effect with the ordinary half-on-a-success branch, resolved when the area appears.',
    },
    {
      clause: 'At the start of each of your turns after the wall appears',
      why: 'an-area-trigger-on-the-casters-turn',
      note: '`AreaTrigger.at` transcribes the book\'s two boundary clauses and both are the **caught creature\'s** turn. A wall that acts at the start of each of the *caster\'s* is a third boundary, and the queue that raises area debt is keyed to the creature whose turn it is.',
    },
    {
      clause: 'the wall, along with any creatures in it, moves 50 feet away from you',
      why: 'an-area-that-moves-by-itself',
      note: 'Automatic drift with no action spent, carrying the creatures inside it — and "away from you" has no meaning for a caster with no position, which is why this is not transcription.',
    },
    {
      clause: 'Any Huge or smaller creature inside the wall',
      why: 'an-area-that-filters-its-catch',
      note: 'An area catches every creature in it, and this one catches only the Huge or smaller. A size predicate deciding who an area reaches is not `designatesUnaffected`, which is explicit ids chosen once. This entry had not recorded it.',
    },
    {
      clause: 'A creature can take this damage only once per round',
      why: 'an-area-trigger-on-the-casters-turn',
      note: '`AreaTrigger.oncePerTurn` caps the creature per **turn** and this caps it per **round** — which differ precisely because the wall moves on the caster\'s turn and the creature may also walk into it on its own.',
    },
    {
      clause: "the wall's height is reduced by 50 feet, and the damage the wall deals on later rounds is reduced by 1d10",
      why: 'a-wall-or-several-templates-in-one-area',
      note: 'A template whose dimensions shrink round by round, and damage that decays with them. Neither the area vocabulary nor `DiceScaling` has a time axis at all — the two scaling axes reach a caster level and a slot.',
    },
    {
      clause: 'When the wall reaches 0 feet in height, the spell ends',
      why: 'expressible',
      note: 'Six rounds at fifty feet a round is the three hundred the spell started with, so this sentence restates the printed duration — a `Deadline` of thirty-six seconds says it already.',
    },
    {
      clause: 'A creature caught in the wall can move by swimming',
      why: 'movement-modes',
      note: 'The Fly, Climb and Swim Speeds the engine deliberately does not distinguish. A creature whose only available movement is a Swim has no way to say that walking is gone.',
    },
    {
      clause: 'the creature must succeed on a Strength (Athletics) check against your spell save DC to move at all',
      why: 'an-action-a-spell-compels-or-forbids',
      note: 'Movement forbidden unless a check succeeds, every turn. `ConditionRider.check` hangs off a condition and this spell imposes none, and the failure branch takes the whole move rather than ending anything.',
    },
    {
      clause: "If it fails the check, it can't move",
      why: 'an-action-a-spell-compels-or-forbids',
      note: 'The failure branch stated outright, which is the economy the engine owns being spent by the rules rather than by the mover.',
    },
    {
      clause: 'A creature that moves out of the wall falls to the ground',
      why: 'falling',
      note: 'Nothing drops, nothing takes fall damage, and no rate of descent has anything to be measured against — a creature three hundred feet up has nowhere to fall from.',
    },
  ],
  // **The one spell in this family the guard can read that the bare list said a
  // stat block would finish.** It does not: the servant's death ends the
  // *casting*, which is a trigger `CastingEndTrigger` has no member for, so
  // reading the paragraph moved this spell out of the shape's `unblocks`
  // entirely. That is the second `finishes` number doing its job.
  'unseen-servant': [
    {
      clause: 'an Invisible, mindless, shapeless, Medium force',
      why: 'a-stat-block-created-mid-fight',
      note: 'The servant is a thing in the scene with a size, a condition and statistics of its own, printed inline rather than in the monster list. Nothing a casting does adds one to the engine\'s scene.',
    },
    {
      clause: 'The servant springs into existence',
      why: 'a-stat-block-created-mid-fight',
      note: 'Placed in an unoccupied space on the ground within range. The placement is something the engine does well and the thing being placed is what it cannot produce.',
    },
    {
      clause: 'It has AC 10, 1 Hit Point, and a Strength of 2',
      why: 'a-stat-block-created-mid-fight',
      note: 'An Armour Class, a Hit Point total and an ability score — a stat block in one sentence, and the inability to attack that closes it is the same stat block printing no attack rather than a rider on the action economy.',
    },
    {
      clause: 'If it drops to 0 Hit Points, the spell ends',
      why: 'a-casting-ended-by-a-trigger',
      note: 'Dropping to 0 Hit Points is named in that shape\'s own description as a cause with no member, and here it ends the **casting** rather than merely removing the creature — which is exactly what Giant Insect and Summon Dragon do *not* say, and the difference is why this spell has two blockers and they have one.',
    },
    {
      clause: 'you can mentally command the servant to move up to 15 feet',
      why: 'a-stat-block-created-mid-fight',
      note: 'A later Bonus Action whose whole content is moving a creature this spell made and having it handle an object. The economy is built and the subject of the action is not.',
    },
    {
      clause: 'would move it more than 60 feet away from you, the spell ends',
      why: 'a-casting-ended-by-a-trigger',
      note: 'A distance two creatures drift apart, which that shape\'s description already names for Faithful Hound, Warding Bond and Antilife Shell. One shape a spell needs twice is still one shape, and both sentences are recorded because both are sentences.',
    },
  ],
  'wall-of-fire': [
    {
      clause: 'You create a wall of fire on a solid surface within range',
      why: 'a-wall-or-several-templates-in-one-area',
      note: 'A wall placed at a point and held for a minute. `SpellArea` has six shapes and none of them is a wall.',
    },
    {
      clause: 'up to 60 feet long, 20 feet high, and 1 foot thick',
      why: 'a-wall-or-several-templates-in-one-area',
      note: 'The three numbers this shape\'s description names, with a ringed alternative beside them. **Recorded although the sentence trips no marker.**',
    },
    {
      clause: 'each creature in its area makes a Dexterity saving throw, taking 5d8 Fire damage',
      why: 'expressible',
      note: 'A typed `save-damage` effect with the ordinary half-on-a-success branch, resolved when the area appears.',
    },
    {
      clause: 'One side of the wall, selected by you when you cast this spell',
      why: 'an-area-that-filters-its-catch',
      note: 'An area catches every creature in it, and this one catches only what is on one of its two faces. A wall with sides is geometry the vocabulary does not have, and which side is a choice that cannot be recorded until it does.',
    },
    {
      clause: 'deals 5d8 Fire damage to each creature that ends its turn within 10 feet of that side',
      why: 'damage-with-neither-an-attack-roll-nor-a-save',
      note: 'Damage that lands with no attack roll and no saving throw at all. Every damage-bearing effect kind the format has — `attack`, `attack-damage`, `save-damage` — hangs off a roll, so automatic damage on a turn boundary has no effect to be written as.',
    },
    {
      clause: 'when it enters the wall for the first time on a turn or ends its turn there',
      why: 'expressible',
      note: '`AreaTrigger.onEntry: "first-per-turn"` and `at: "end-of-turn"` are the book\'s clauses transcribed, and this sentence is both of them.',
    },
    {
      clause: 'The other side of the wall deals no damage',
      why: 'an-area-that-filters-its-catch',
      note: 'The sentence that makes the side selection load-bearing rather than decorative: half the area does nothing, and an area here reaches everybody inside it.',
    },
    {
      clause: 'The damage increases by 1d8 for each spell slot level above 4',
      why: 'expressible',
      note: '`DiceScaling` by slot, which is one of the two axes the format keeps deliberately apart and the one a levelled spell reads.',
    },
  ],
  // **Both of these walls carry an Armour Class and a Hit Point total**, and
  // neither entry had recorded it. A thing with vitals that a casting puts into
  // a fight is `a-stat-block-created-mid-fight` — the same shape Arcane Hand's
  // "object that has AC 20" already files under — so the wall family and the
  // summons family meet here, which is a connection the bare lists could not
  // show.
  'wall-of-ice': [
    {
      clause: 'You create a wall of ice on a solid surface within range',
      why: 'a-wall-or-several-templates-in-one-area',
      note: 'A wall placed at a point and held for ten minutes, and `SpellArea` has six shapes and none of them is a wall.',
    },
    {
      clause: 'a hemispherical dome or a globe with a radius of up to 10 feet, or you can shape a flat surface made up of ten 10-foot-square panels',
      why: 'a-wall-or-several-templates-in-one-area',
      note: 'Three alternative geometries, one of which is ten separate panels — so this spell is both halves of what the shape names, a wall with dimensions and several templates in one area.',
    },
    {
      clause: "If the wall cuts through a creature's space when it appears, the creature is pushed to one side",
      why: 'forced-movement-a-spell-causes',
      note: '`moveCreature` takes `forced: true` and reports who is being shared with, and no `SpellEffect` reaches it — so a push the geometry causes has no path to the one function that would charge it correctly.',
    },
    {
      clause: 'The wall is an object that can be damaged and thus breached',
      why: 'a-barrier-that-blocks-passage',
      note: 'Breaching only means something if the wall stopped a creature crossing it, and a shape that stops a creature crossing is the geometry\'s missing half — distinct from the template that describes it.',
    },
    {
      clause: 'It has AC 12 and 30 Hit Points per 10-foot section',
      why: 'a-stat-block-created-mid-fight',
      note: 'An Armour Class, a Hit Point total **per section**, three Immunities and a Vulnerability: a stat block, laid out as a sentence. `armorClassOf` and the vitals both read a creature that was added to the scene, and no effect adds one. This entry had not recorded it.',
    },
    {
      clause: 'Reducing a 10-foot section of wall to 0 Hit Points destroys it and leaves behind a sheet of frigid air',
      why: 'a-wall-or-several-templates-in-one-area',
      note: 'Part of one template being destroyed and replaced by a **second** template in the same place. One area per spell is exactly what this sentence needs two of.',
    },
    {
      clause: 'A creature moving through the sheet of frigid air for the first time on a turn',
      why: 'a-wall-or-several-templates-in-one-area',
      note: 'An entry trigger on that second template, which `AreaTrigger.onEntry` would express if there were anywhere for the second area to be recorded.',
    },
    {
      clause: "The damage the wall deals when it appears increases by 2d6 and the damage from passing through the sheet of frigid air increases by 1d6",
      why: 'expressible',
      note: '`DiceScaling` is per-effect, so two effects scaling at different rates by slot is two ordinary tables rather than one overloaded number.',
    },
  ],
  'wall-of-stone': [
    {
      clause: 'A nonmagical wall of solid stone springs into existence at a point you choose within range',
      why: 'a-wall-or-several-templates-in-one-area',
      note: 'A wall placed at a point, and `SpellArea` has six shapes and none of them is a wall.',
    },
    {
      clause: 'composed of ten 10-foot-by-10-foot panels',
      why: 'a-wall-or-several-templates-in-one-area',
      note: 'Ten panels with a thickness, or five larger ones that are thinner — several templates in one area, which is the other half of what this shape names. **The sentence trips no marker.**',
    },
    {
      clause: "the creature is pushed to one side of the wall (you choose which side)",
      why: 'forced-movement-a-spell-causes',
      note: '`moveCreature` takes `forced: true` and no `SpellEffect` reaches it, so a push the geometry causes has nothing to call.',
    },
    {
      clause: 'If a creature would be surrounded on all sides by the wall',
      why: 'a-barrier-that-blocks-passage',
      note: 'Enclosure is the strongest form of the geometry that stops a creature crossing — `docs/design/space-and-areas.md` keeps cover and line of sight declared rather than ray-cast, and nothing here can answer whether a creature is boxed in.',
    },
    {
      clause: 'it can use its Reaction to move up to its Speed',
      why: 'an-action-a-spell-compels-or-forbids',
      note: 'The spell hands the **target** a use of its own Reaction. Spending somebody else\'s Reaction is named in this shape\'s own description, and `mayAct` guards the Reaction like every other spender. This entry had not recorded it.',
    },
    {
      clause: 'The wall is an object made of stone that can be damaged and thus breached',
      why: 'a-barrier-that-blocks-passage',
      note: 'Breaching only means something if the wall stopped a creature crossing it, which is the geometry\'s missing half stated a second time.',
    },
    {
      clause: 'Each panel has AC 15 and 30 Hit Points per inch of thickness',
      why: 'a-stat-block-created-mid-fight',
      note: 'An Armour Class, a Hit Point total **per inch** and two Immunities: a stat block, laid out as a sentence, and one that a casting would have to put into the fight ten times over.',
    },
    {
      clause: 'Reducing a panel to 0 Hit Points destroys it',
      why: 'a-wall-or-several-templates-in-one-area',
      note: 'One of ten templates removed while the rest stay, and connected panels possibly collapsing after it at the GM\'s discretion. One area per spell cannot lose a tenth of itself.',
    },
    {
      clause: "the wall becomes permanent and can't be dispelled",
      why: 'an-effect-that-fires-when-the-casting-ends',
      note: 'Expiry is derived here, like Concentration breaking, and the log records an effect being scheduled rather than expiring — so a spell that rewards a caster who held Concentration to the end has no hook.',
    },
  ],
  'wall-of-thorns': [
    {
      clause: 'The wall appears within range on a solid surface and lasts for the duration',
      why: 'a-wall-or-several-templates-in-one-area',
      note: 'A wall placed at a point and held for ten minutes, and `SpellArea` has six shapes and none of them is a wall.',
    },
    {
      clause: 'up to 60 feet long, 10 feet high, and 5 feet thick',
      why: 'a-wall-or-several-templates-in-one-area',
      note: 'The three numbers this shape\'s description names, with a circular alternative beside them. **Recorded although the sentence trips no marker.**',
    },
    {
      clause: 'The wall blocks line of sight',
      why: 'table',
      note: 'Line of sight is declared here rather than ray-cast, which is the line this repository drew deliberately — so a DM who says the wall blocks it has said everything the engine needs.',
    },
    {
      clause: 'taking 7d8 Piercing damage on a failed save',
      why: 'expressible',
      note: 'A typed `save-damage` effect with the ordinary half-on-a-success branch, resolved when the area appears.',
    },
    {
      clause: 'A creature can move through the wall, albeit slowly and painfully',
      why: 'table',
      note: 'What moving through a thorn wall feels like is narration; the cost of doing it is the sentence below, and that one is arithmetic.',
    },
    {
      clause: 'For every 1 foot a creature moves through the wall, it must spend 4 feet of movement',
      why: 'difficult-terrain-an-area-creates',
      note: 'Difficult Terrain is charged exactly and declared by the foot on the move that crosses it, and this is a **quadrupled** rate rather than a doubled one. Deriving either from a spell\'s area needs the path a move does not record.',
    },
    {
      clause: 'the first time a creature enters a space in the wall on a turn or ends its turn there',
      why: 'expressible',
      note: '`AreaTrigger.onEntry: "first-per-turn"` and `at: "end-of-turn"`, the two boundary clauses transcribed, carrying a second damage type of their own.',
    },
    {
      clause: 'A creature makes this save only once per turn',
      why: 'expressible',
      note: '`AreaTrigger.oncePerTurn`, which caps the creature across every clause above rather than capping one of them.',
    },
    {
      clause: 'Both types of damage increase by 1d8 for each spell slot level above 6',
      why: 'expressible',
      note: '`DiceScaling` is per-effect, so two effects scaling together by slot is two ordinary tables rather than a shared one.',
    },
  ],
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
      why: 'expressible',
      note: 'Gaseous Form prints the same clause and both are expressible now: the damage defence beside it was IE-017\'s and the condition Immunity is IE-042\'s. Wind Walk stays undefined on the five other blockers its entry names, every one of them about the cloud form rather than the Immunity.',
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
  'wind-wall': [
    {
      clause: 'A wall of strong wind rises from the ground at a point you choose within range',
      why: 'a-wall-or-several-templates-in-one-area',
      note: 'A wall placed at a point and held for a minute, and `SpellArea` has six shapes and none of them is a wall.',
    },
    {
      clause: 'up to 50 feet long, 15 feet high, and 1 foot thick',
      why: 'a-wall-or-several-templates-in-one-area',
      note: 'The three numbers this shape\'s description names, shaped into any continuous path along the ground. **The sentence trips no marker.**',
    },
    {
      clause: 'taking 4d8 Bludgeoning damage on a failed save',
      why: 'expressible',
      note: 'A typed `save-damage` effect with the ordinary half-on-a-success branch, resolved when the area appears.',
    },
    {
      clause: 'The strong wind keeps fog, smoke, and other gases at bay',
      why: 'table',
      note: 'Fog and smoke are not things the engine holds, so nothing follows mechanically from their being pushed aside.',
    },
    {
      clause: "Small or smaller flying creatures or objects can't pass through the wall",
      why: 'a-barrier-that-blocks-passage',
      note: 'A shape that stops a creature crossing it is the geometry\'s missing half, and this one stops only the small ones — a size bound on a barrier that does not exist yet.',
    },
    {
      clause: 'ordinary projectiles launched at targets behind the wall are deflected upward and miss automatically',
      why: 'table',
      note: 'An attack that misses because of what stands between attacker and target is cover, and cover is declared here rather than ray-cast — the line this repository drew to keep a rules engine from becoming a VTT.',
    },
    {
      clause: 'Boulders hurled by Giants or siege engines, and similar projectiles, are unaffected',
      why: 'table',
      note: 'The exception to the declared cover above, and the creature-type marker fires because the book names Giants rather than because a rule reads the type.',
    },
    {
      clause: "Creatures in gaseous form can't pass through it",
      why: 'a-barrier-that-blocks-passage',
      note: 'The barrier again, refusing a creature whose form is itself a spell this map records as blocked. Two sentences of one shape are two entries, because each is a sentence somebody has to have read.',
    },
  ],
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
): readonly UnanchoredClause[] => unanchoredWithin(spellId, printedUnitsOf(spellId), phrases);

/**
 * The same question asked of units somebody else assembled.
 *
 * Split out when the item population arrived, because "this phrase occurs
 * exactly once in what the book prints under this heading" is one question and
 * the two corpora differ only in what the heading is. A second implementation
 * that normalised differently, or counted overlaps differently, would be the
 * drifting copy this file keeps a record of.
 */
export const unanchoredWithin = (
  where: string,
  units: readonly string[],
  phrases: readonly string[],
): readonly UnanchoredClause[] =>
  phrases.flatMap((clause) => {
    const phrase = flatten(clause);
    const matches = units.reduce((total, unit) => total + occurrences(unit, phrase), 0);
    return matches === 1 ? [] : [{ spell: where, clause, matches }];
  });

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

// — the untranscribed item population —————————————————————————————————————————

/**
 * The mechanical shapes that stand between an SRD magic item and a record.
 *
 * The item half of {@link MISSING_SHAPES}, and it is **short on purpose**: an
 * item entry may name any shape in that vocabulary as well, and most of them
 * do. A Belt of Giant Strength is blocked on the same missing reader SRD
 * Feeblemind is — `an-ability-score-a-spell-changes` — and giving that gap a
 * second id because the sentence this time is printed on a belt is the "second
 * spelling of a derivation" failure this file already keeps a record of. So
 * what lives here is only what is true of an **item** and false of a casting:
 * a benefit with no casting to hang on, a charge, an attunement, an instance.
 *
 * The rule the spell vocabulary sets applies unchanged: every id names a gap
 * this repository has already described, and the description says **which**,
 * because a shape invented here would be an architecture decision smuggled in
 * as a note. Most of these point at `packages/engine/src/content.ts`, where
 * `checkContent` refuses an item's grant **by name** — a refusal message is a
 * gap somebody wrote down and a reviewer read, which is what that rule asks
 * for.
 */
export const ITEM_SHAPES = {
  'a-spell-an-item-casts-that-nothing-executes':
    'the item’s line says it casts a named spell and the catalogue has **no definition of that spell at all**. `checkContent` refuses the pairing in as many words — packages/engine/src/content.ts, "which this content has no executable definition of" — so an item that casts Scrying, Levitate or Gate cannot be written until the spell is, and the blocker is the spell’s own. It is the largest single blocker in the book’s magic items and it is not item work at all, which is the finding: a tranche aimed at wands buys nothing until the spells under them exist. **The word that decides an entry is *definition*, not *executable*, and this description said otherwise for a batch.** The predicate `checkContent` hands an item is `spells.some(s => s.id === id)` — packages/engine/src/content.ts, the call site of `itemGrantProblems` — and `castFromItem` reads `content.spell(id)`, so a **tracked** definition answers both. That is SRD’s own sentence about what a casting from an item is: "The spell uses its normal casting time, range, and duration, and the user of the item must concentrate if the spell requires Concentration", every word of which a tracked definition already carries. A Wand of Magic Detection and a Ring of Animal Influence came off this shape without a line of spell work, and `item-casts-a-tracked-spell.test.ts` drives both directions so the distinction cannot be lost again. What *should* name this shape is an entry whose spell nothing defines — and, for a **potion**, a spell whose definition resolves nothing, because a `confers` grant carries the definition’s `SpellEffect[]` and "an item that confers an empty list confers nothing". **Two entries still name it and should not**, and they are written down rather than quietly left, because the `Blocks` column is derived from this map and is wrong by them: `amulet-of-the-planes` casts a defined Plane Shift but gates it behind "make a DC 15 Intelligence (Arcana) check", which is a check gating an item’s casting and has no id here; and `chime-of-opening` casts a defined Knock out of a use count that never comes back, which is neither a `dawn` pool nor nothing. Both need their paragraph read before they can be re-pointed, and inventing a shape to move them would be the architecture decision this vocabulary refuses to smuggle in as a note.',
  'a-save-an-item-forces':
    'a saving throw an item makes somebody roll — **half built, and the half that is missing is not the DC**. The roll and the number are there: packages/engine/src/content.ts admits the first, "A saving throw is not on that list any more.", and says where the second comes from, "`saveDc` on the grant is a number the item printed and `save-damage` resolves against it through the resolver a casting uses". So a save whose failure is **damage** is writable today, which is why Dust of Dryness’s 10d6 and Javelin of Lightning’s 4d6 no longer name this shape. What is not built is every *other* thing a failed save can do, and the same file gives the reason: "`save` is still refused, and not for want of a DC" — "Its `condition` is a required field and its `repeats` is the repeat save that goes with one, and a repeat save is a `PendingSave` that names a casting id" — which is docs/design/content.md’s own rule that an item conferring an effect is "refused an effect kind a conferral cannot resolve", reaching the one kind every remaining save would need. What still names this shape is therefore a save whose outcome is neither damage nor anything a shape already covers: a wielder who goes berserk, a creature trapped in a flask or a mirror, an Undead simply destroyed. A save that imposes a **condition** is that same weld seen from the other end and names `a-condition-an-item-imposes` instead, which is the id the vocabulary already had for it.',
  'a-charge-spent-on-something-other-than-a-casting':
    'a charge the item’s line spends on something that is not a spell. A `casts` grant takes its price out of the pool and nothing else does: packages/engine/src/content.ts refuses a conferral that names one — "nothing spends a charge for a conferral yet" — so a staff that spends a charge for extra damage on a hit, or a periapt that spends its one daily use to heal, would declare a pool nothing can draw on.',
  'a-condition-an-item-imposes':
    'a condition an item puts on a creature, **and what is left is every way of imposing one that is not simply handing it over**. A conferral may now hang a condition outright: packages/engine/src/content.ts admits the kind — "Nor is a condition any more." — and says why that admits no casting with it, "The rider fields that would need a casting are refused one by one below", so Potion of Invisibility is transcribed and no longer names this shape. What is **not** built is a condition a saving throw imposes, which the same file still refuses — "`save` is still refused, and not for want of a DC" — and a condition whose duration the item **rolls** for, which no conferral can state. A condition the holder switches off by decision is `a-benefit-an-item-switches-on-and-off` seen from the condition’s end, and one a printed sentence suspends is `a-benefit-an-item-suspends-on-a-trigger`.',
  'a-damage-roll-an-item-makes':
    'damage an item deals without a casting, and **what is left of it is damage no saving throw decides**. A conferral may now carry one damaging kind: packages/engine/src/content.ts admits the saving throw — "A saving throw is not on that list any more." — so a horn that blasts and a javelin that forks into lightning have somewhere to write their dice, and every entry whose damage a save decides has come off this shape. Two residues do not move, and the same file refuses the kind each would need: "`attack` is refused by name, and so is `attack-damage`, which rides on an attack this is not". So damage that simply lands has nowhere to go — a talisman that burns whoever touches it, a staff’s explosion on its own wielder, Potion of Poison’s 4d6, which arrives whether the save is made or not — and neither does damage an item rolls its **own** attack for, which is Ring of the Ram’s spectral head and its printed +7. **The first residue is the gap the spell vocabulary calls `damage-with-neither-an-attack-roll-nor-a-save`**, which Magic Missile is blocked on; whether an item still needs an id of its own for it, now that the save-gated half is built, is a question this map owes an answer to and a re-derivation may not settle by itself.',
  'a-speed-an-item-grants':
    'a Speed a worn item gives its wearer. `ITEM_EFFECT_KINDS` omits `speed` on purpose and packages/engine/src/content.ts records the omission as a gap rather than as a decision — "An item granting a Swim Speed is a real SRD item and a real gap; refusing it by name is how the gap stays visible instead of becoming a transcribed item whose benefit silently never applies." Boots, gloves, rings, horseshoes and slippers all print one.',
  'a-reaction-an-item-grants':
    'a Reaction the item gives its holder. packages/engine/src/content.ts names the four grant kinds an item’s readers execute — "only a standing grant, a charge pool, a spell it casts and the effects it confers are read from one" — and a `reaction` grant is not among them, so a glove that snatches a missile and a ring that turns a failed save into a success have nothing to hang on.',
  'a-benefit-an-item-switches-on-and-off':
    'a benefit the holder turns on and later turns off, with no spell cast and no duration running. The same enumeration refuses it — packages/engine/src/content.ts, "only a standing grant, a charge pool, a spell it casts and the effects it confers are read from one" — and the two kinds that come closest each say the wrong thing: a standing grant is on whenever the item is worn, and a conferral is a moment with a lifetime the item states. A flaming blade one Bonus Action lights and another puts out is neither.',
  'a-casting-an-item-stores-or-gives-back':
    'a spell slot an item returns, or a casting it holds for later on somebody else’s numbers. packages/engine/src/content.ts admits four grants from an item and says of the rest: "The rest are real and are coming, but a grant nothing executes is an item whose line in the book quietly does nothing." A `recovery` grant is one of those, and a stored casting that keeps the original caster’s save DC is not a grant kind at all.',
  'a-bonus-to-spell-attack-rolls':
    'the id is packages/engine/src/content.ts’s own and so is the sentence: a standing `flat-bonus` reaches a weapon attack roll and not a spell one, and "the member that says that is `a-bonus-to-spell-attack-rolls` and it does not exist yet". Every staff, talisman, wand and robe in the book that improves a caster prints exactly this line, and writing it as `applies: [attack]` would quietly improve the wrong roll.',
  'a-language-or-a-proficiency-an-item-grants':
    'training an item confers — a language you know while you wear it, a weapon you are suddenly proficient with. Both are `FeatureGrant` kinds a class already uses and neither is read from an item: packages/engine/src/content.ts, "only a standing grant, a charge pool, a spell it casts and the effects it confers are read from one". One shape rather than two, because one line of the reader admits both and each entry’s own note says which the item wanted.',
  'an-item-instance-with-a-state-of-its-own':
    'a fact about **this** copy of an item rather than about the catalogue row. docs/design/characters-and-equipment.md names it as a decision a brief still owes — "an item instance identity (charges keyed on a catalogue id cannot tell two wands apart, and a wand given away carries its charges while pools are per creature)" — and packages/content/src/items.ts already carries the consequence on the one potion that forced it: the other rows of the healing table are left out as "which the SRD files under one entry and which would need four ids, or an item instance record, to sit on one inventory line". An arrow that stops being magical when it hits, a bag with 3d4 beans left in it and a wand that crumbles on its last charge are all that same fact.',
  'a-version-of-an-item-the-book-leaves-to-the-gm':
    'one printed entry that is several items, where **the GM chooses which**. Not the `+1, +2, or +3` template, whose versions the book names and rates one by one and which the catalogue expands into records; this is "The GM chooses the type or determines it randomly by rolling on the following table", printed over damage types, giants, dragons, planes and elementals. packages/content/src/items.ts says what it would cost on the entry that already forced the question — the other healing potions "would need four ids, or an item instance record, to sit on one inventory line" — and a record that picked one version for everybody would be a catalogue asserting what the book leaves open.',
  'a-container-with-a-space-of-its-own':
    'an item that holds other items. docs/archive/design/characters-and-equipment.md states the absence outright — "No containers." and "Items are a flat list per creature" — so a bag whose capacity, weight and contents are the whole of its rules has nothing to be written against. Several of the book’s wondrous items are containers and nothing else.',
  'an-object-with-statistics-of-its-own':
    'a thing with an Armour Class, Hit Points and a position that is not a creature. docs/archive/design/casting.md settled the spell side by refusing exactly this — a casting may hold a point, and "No entity, no object record, no second identity, nothing in the scene’s `positions` table" — while filing "A thing with statistics" under the summons seam, which is still open. A tower, a boat, an animated rope and a sword that hovers and attacks are all on the far side of it.',
  'an-area-an-item-creates':
    'a Cone, a Sphere or an Emanation an item puts on the battlefield. docs/archive/design/space-and-areas.md ties an area to the casting that made it — "So a casting’s area sits at a point *or* on a creature, and which it is was decided at the casting by the definition" — and an item that confers effects has no casting, no definition and no area field, so a horn that blasts a 30-foot Cone reaches its targets by hand or not at all.',
  'what-ends-attunement-besides-a-command':
    'an attunement that ends, or refuses to end, for a reason no command gives. docs/design/characters-and-equipment.md names it as the second thing a brief still owes — "what ends attunement besides a command — death, losing the item, another creature attuning to it" — and the book’s cursed items are the other half of that missing rule: armour that cannot be doffed until a Remove Curse lands is an attunement its holder may not release.',
  'a-concentration-with-no-casting-behind-it':
    'Concentration on something that was never cast. docs/archive/design/casting.md makes the casting the unit throughout — "a second Concentration casting breaks the first at its declaration" — and `releaseCasting` is the single door out, so an item whose effect lasts as long as its user maintains Concentration has nothing for that door to close.',
  'a-benefit-an-item-suspends-on-a-trigger':
    'a standing benefit switched off by something that happens, and switched back on later. The nearest built mechanism ends a **casting**, and docs/archive/design/casting.md keeps that door narrow on purpose — "`releaseCasting`, the single door" — while an item’s benefit is derived on every read from what is worn and attuned, and nothing in that derivation can see that its wearer took damage two seconds ago.',
  'a-rider-on-the-face-the-die-showed':
    'an effect that fires because the d20 came up a particular number. packages/engine/src/spell-definitions.ts names the mechanism while refusing it for a spell — Chromatic Orb is "a chained attack on a dice-face trigger" — and every magic weapon in SRD that acts "when you roll a 20 on the d20 for the attack roll", and every staff destroyed on a 1, wants that same reader.',
  'a-critical-hit-an-effect-downgrades':
    'a Critical Hit turned back into an ordinary hit. docs/archive/PROGRESS.md records the only thing that moves a critical today — "The die face that scores a Critical Hit, off the sheet; the Champion" — which widens the range rather than narrowing it, and nothing anywhere takes a critical away once the die has shown the face.',
} as const;

/** The item vocabulary’s own ids. */
export type ItemShapeId = keyof typeof ITEM_SHAPES;

/** Every shape an item entry may name: the spell vocabulary, and the item one. */
export type ItemBlockerId = ShapeId | ItemShapeId;

/**
 * One sentence of an untranscribed item's printed entry, and what stands in
 * its way.
 *
 * {@link BlockedClause}'s shape, over the other book. The three values mean
 * what they mean there, with one difference that decides a whole pile below:
 *
 * | | |
 * |---|---|
 * | `'table'` | fiction, or a rule the engine's resolution path never reaches |
 * | `'expressible'` | the grant vocabulary already says it; this clause blocks nothing |
 * | a shape id | mechanical, and this names the shape that blocks it |
 *
 * **An entry of nothing but `'table'` is not a transcribable item.**
 * `packages/content/src/items.ts` rule 1 says why — "A record carrying nothing
 * but notes would be an item that arrives in a pack, grants nothing and looks
 * transcribed" — so `'expressible'` is not decoration here: it is the evidence
 * that there is something to write down, and {@link itemPileOf} sorts on it.
 */
export interface ItemClause {
  /**
   * A distinctive phrase from this entry's printed text.
   *
   * The same rule {@link BlockedClause.clause} follows and for the same reason:
   * it must occur **exactly once** across the entry's printed fields and the
   * sentences of its prose, so a reworded entry has to be read again rather
   * than keeping an adjudication written about the old one.
   */
  readonly clause: string;
  readonly why: 'table' | 'expressible' | ItemBlockerId;
  readonly note: string;
}

/**
 * A blocker on an item, anchored or not.
 *
 * A bare shape id is the **grandfathered** form the spell map already has: it
 * says which shape blocks the entry and nothing about which sentence. Two
 * hundred entries cannot be read sentence by sentence in one commit, and a map
 * that pretended otherwise would be worth less than one that says which of its
 * entries somebody has actually read — so the report prints the two columns
 * apart, exactly as `COVERAGE.md` prints *finishes (read)* against *(unread)*.
 */
export type ItemBlocker = ItemBlockerId | ItemClause;

/**
 * An entry nobody can place — **the honest default**.
 *
 * Two things arrive here and the note says which: an entry nobody has read,
 * and an entry somebody read and could not name a blocker for without
 * inventing a shape. They are one claim — *this entry is not ready to be
 * briefed from* — and the alternative to having the pile is worse in both
 * directions, because an entry silently filed as blocked invents a rule and an
 * entry silently filed as ready costs a builder an afternoon.
 */
export interface UnreadItemEntry {
  readonly unread: string;
}

/** What an entry of {@link ITEM_BLOCKED_ON} may be. */
export type ItemEntry = readonly ItemBlocker[] | UnreadItemEntry;

const isUnread = (entry: ItemEntry): entry is UnreadItemEntry => !Array.isArray(entry);

/**
 * What stands between every **untranscribed** SRD magic item and a record.
 *
 * `BLOCKED_ON` for the other book. 42 of the 258 entries of "Magic Items A–Z"
 * have at least one catalogue record; nothing in this repository said why the
 * rest do not, so the question a batch turns on — *how many are blocked by a
 * missing shape and how many are simply not yet written* — had no answer but
 * somebody's impression. `packages/content/src/items.ts` states the three
 * rules that **decide** an omission; the decision itself lived only in the
 * absence of a record. This is the decision.
 *
 * ### Four piles, and the default is the honest one
 *
 * {@link itemPileOf} sorts every parsed entry into exactly one of five states —
 * transcribed, blocked, ready, fiction, unread — and the two that a brief may
 * be planned from are the ones that cost something to claim:
 *
 * - **ready** is an entry every clause of which the engine can already say,
 *   with at least one clause that is genuinely `'expressible'`. It is the
 *   output the next brief transcribes from, so it is deliberately the hardest
 *   pile to land in: an entry must have been read **sentence by sentence**,
 *   with a written clause against every sentence tripping one of
 *   {@link CLAUSE_MARKERS}. An entry nobody read cannot be ready however quiet
 *   its prose, because "no sentence names a mechanic" is a conclusion somebody
 *   has to have reached.
 * - **fiction** is the same reading arriving at nothing to write down. It is a
 *   pile of its own rather than part of *ready* because of rule 1 in
 *   packages/content/src/items.ts: a record carrying only notes "would be an
 *   item that arrives in a pack, grants nothing and looks transcribed". A Bead
 *   of Nourishment is not waiting on the engine and is not a record either.
 * - **blocked** names at least one shape, read or grandfathered.
 * - **unread** is everything else, and it is where an entry goes by default
 *   rather than by decision.
 *
 * A false positive in *ready* costs a builder an afternoon and a false
 * negative costs the catalogue an item, so the classifier is arranged so that
 * every way of failing to do the work lands in *unread*.
 *
 * ### Most entries are grandfathered, and the report says how many
 *
 * Two hundred and sixteen paragraphs read sentence by sentence in one commit
 * is how a reviewer stops reading — the lesson `BLOCKED_ON` records for its own
 * backfill. So a blocked entry may name its shapes as bare ids, and
 * {@link itemConsumersOf} reports what a shape finishes **twice**: among the
 * entries somebody has read, and among the rest. The difference is the finding,
 * exactly as it is for spells.
 *
 * ### What the reading found that a shape-level guess would not have
 *
 * The largest blocker in the book's magic items is not an item mechanism at
 * all: it is `a-spell-an-item-casts-that-nothing-executes`, and every entry
 * under it is waiting on a **spell** definition. A wand tranche planned without
 * reading would have bought wands and found the spells underneath them
 * missing. Second is a version of an item the book leaves to the GM, which is
 * a catalogue-shape question rather than an engine one. Both numbers are
 * `COVERAGE.md`'s to print.
 */
export const ITEM_BLOCKED_ON: Readonly<Record<string, ItemEntry>> = {
  'adamantine-armor': ['a-critical-hit-an-effect-downgrades'],
  'ammunition-1-2-or-3': ['an-item-instance-with-a-state-of-its-own'],
  'ammunition-of-slaying': [
    'a-rider-on-a-later-weapon-attack',
    'a-version-of-an-item-the-book-leaves-to-the-gm',
    'an-item-instance-with-a-state-of-its-own',
  ],
  'amulet-of-health': ['an-ability-score-a-spell-changes'],
  'amulet-of-proof-against-detection-and-location': {
    unread:
      'read, and the blocker cannot be named from anything this repository has written down. "you can’t be targeted by Divination spells or perceived through magical scrying sensors" is a filter on the *school* of a spell reaching the targeting check, and no document here describes a school axis as a gap. Filing it as the table’s would put an entry with nothing to record on the ready list; naming a shape for it would be an architecture decision smuggled in as a note.',
  },
  'amulet-of-the-planes': [
    'a-spell-an-item-casts-that-nothing-executes',
    'a-version-of-an-item-the-book-leaves-to-the-gm',
  ],
  'animated-shield': ['a-benefit-an-item-switches-on-and-off', 'what-a-creature-is-holding'],
  'apparatus-of-the-crab': ['an-object-with-statistics-of-its-own'],
  'armor-of-resistance': ['a-version-of-an-item-the-book-leaves-to-the-gm'],
  'armor-of-vulnerability': [
    'a-version-of-an-item-the-book-leaves-to-the-gm',
    'what-ends-attunement-besides-a-command',
  ],
  'arrow-catching-shield': ['a-reaction-an-item-grants'],
  'bag-of-beans': [
    'a-save-an-item-forces',
    'a-condition-an-item-imposes',
    'an-area-an-item-creates',
    'a-version-of-an-item-the-book-leaves-to-the-gm',
    'an-item-instance-with-a-state-of-its-own',
  ],
  'bag-of-devouring': ['a-container-with-a-space-of-its-own'],
  'bag-of-holding': ['a-container-with-a-space-of-its-own'],
  'bag-of-tricks': [
    'a-stat-block-created-mid-fight',
    'a-version-of-an-item-the-book-leaves-to-the-gm',
    'an-item-instance-with-a-state-of-its-own',
  ],
  'bead-of-force': [
    'an-area-an-item-creates',
    'a-save-an-item-forces',
    'an-item-instance-with-a-state-of-its-own',
  ],
  'bead-of-nourishment': [
    {
      clause: 'provides as much nourishment as 1 day of Rations',
      why: 'table',
      note: 'the whole of the entry. Rations feed a character in fiction and the engine has no hunger, no day and no nourishment, so there is nothing here the grant vocabulary is short of — and nothing for a record to carry either, which is rule 1 in packages/content/src/items.ts rather than a blocker.',
    },
  ],
  'belt-of-dwarvenkind': [
    'a-language-or-a-proficiency-an-item-grants',
    'a-bonus-narrowed-to-a-skill',
    'an-ability-score-a-spell-changes',
    'senses-beyond-declared-sight',
    'a-save-keyed-to-a-condition',
  ],
  'belt-of-giant-strength': [
    'an-ability-score-a-spell-changes',
    'a-version-of-an-item-the-book-leaves-to-the-gm',
  ],
  'berserker-axe': [
    'a-hit-point-maximum-a-spell-moves',
    'what-ends-attunement-besides-a-command',
    'a-save-an-item-forces',
  ],
  'boots-of-levitation': ['a-spell-an-item-casts-that-nothing-executes'],
  'boots-of-speed': [
    'a-speed-an-effect-multiplies',
    'a-benefit-an-item-switches-on-and-off',
    'a-deadline-anchored-to-a-rest',
  ],
  'boots-of-striding-and-springing': ['a-speed-an-item-grants'],
  'bowl-of-commanding-water-elementals': ['a-stat-block-created-mid-fight'],
  'bracers-of-archery': ['a-language-or-a-proficiency-an-item-grants'],
  'brazier-of-commanding-fire-elementals': ['a-stat-block-created-mid-fight'],
  'broom-of-flying': ['movement-modes', 'a-speed-an-item-grants'],
  'candle-of-invocation': [
    'a-selector-for-every-d20-test',
    'a-spell-an-item-casts-that-nothing-executes',
    'an-item-instance-with-a-state-of-its-own',
  ],
  'carpet-of-flying': ['movement-modes', 'a-version-of-an-item-the-book-leaves-to-the-gm'],
  'censer-of-controlling-air-elementals': ['a-stat-block-created-mid-fight'],
  'chime-of-opening': [
    'a-spell-an-item-casts-that-nothing-executes',
    'an-item-instance-with-a-state-of-its-own',
  ],
  'circlet-of-blasting': ['a-spell-an-item-casts-that-nothing-executes'],
  'cloak-of-arachnida': ['movement-modes', 'a-speed-an-item-grants'],
  'cloak-of-displacement': ['a-benefit-an-item-suspends-on-a-trigger'],
  'cloak-of-invisibility': [
    'a-condition-an-item-imposes',
    'a-benefit-an-item-suspends-on-a-trigger',
  ],
  'cloak-of-the-bat': [
    'a-bonus-narrowed-to-a-skill',
    'movement-modes',
    'a-spell-an-item-casts-that-nothing-executes',
  ],
  'cloak-of-the-manta-ray': ['a-speed-an-item-grants', 'movement-modes'],
  'crystal-ball': ['a-spell-an-item-casts-that-nothing-executes'],
  'crystal-ball-of-mind-reading': ['a-spell-an-item-casts-that-nothing-executes'],
  'crystal-ball-of-telepathy': ['a-spell-an-item-casts-that-nothing-executes'],
  'crystal-ball-of-true-seeing': [
    'a-spell-an-item-casts-that-nothing-executes',
    'senses-beyond-declared-sight',
  ],
  'cube-of-force': ['a-spell-an-item-casts-that-nothing-executes'],
  'cubic-gate': ['a-spell-an-item-casts-that-nothing-executes'],
  'dagger-of-venom': ['a-condition-an-item-imposes', 'a-benefit-an-item-switches-on-and-off'],
  'dancing-sword': ['an-object-with-statistics-of-its-own'],
  'decanter-of-endless-water': ['a-condition-an-item-imposes'],
  'deck-of-illusions': [
    'a-stat-block-created-mid-fight',
    'a-version-of-an-item-the-book-leaves-to-the-gm',
    'an-item-instance-with-a-state-of-its-own',
  ],
  'demon-armor': [
    'a-language-or-a-proficiency-an-item-grants',
    'what-ends-attunement-besides-a-command',
    'a-rider-on-a-later-weapon-attack',
  ],
  'dimensional-shackles': ['a-condition-an-item-imposes', 'a-fact-only-the-table-can-declare'],
  'dragon-orb': [
    'a-spell-an-item-casts-that-nothing-executes',
    'a-condition-an-item-imposes',
    'a-version-of-an-item-the-book-leaves-to-the-gm',
    'an-object-with-statistics-of-its-own',
  ],
  'dragon-scale-mail': [
    'a-version-of-an-item-the-book-leaves-to-the-gm',
    'a-mode-on-the-save-a-spell-forces',
  ],
  'dust-of-disappearance': [
    'a-condition-an-item-imposes',
    'a-benefit-an-item-suspends-on-a-trigger',
    'an-item-instance-with-a-state-of-its-own',
  ],
  'dust-of-dryness': ['an-item-instance-with-a-state-of-its-own'],
  'dust-of-sneezing-and-choking': [
    'a-condition-an-item-imposes',
    'an-area-an-item-creates',
    'an-item-instance-with-a-state-of-its-own',
  ],
  'dwarven-thrower': ['a-rider-on-a-later-weapon-attack'],
  'efficient-quiver': ['a-container-with-a-space-of-its-own'],
  'efreeti-bottle': [
    'a-stat-block-created-mid-fight',
    'a-version-of-an-item-the-book-leaves-to-the-gm',
    'an-item-instance-with-a-state-of-its-own',
  ],
  'elemental-gem': [
    'a-stat-block-created-mid-fight',
    'a-version-of-an-item-the-book-leaves-to-the-gm',
    'an-item-instance-with-a-state-of-its-own',
  ],
  'elixir-of-health': [
    {
      clause: 'you are cured of all magical contagions',
      why: 'table',
      note: 'a disease is not a condition the engine names and not a state it holds, so there is nothing here for a conferral to end. The table decides what a contagion was and that it is gone.',
    },
    {
      clause: 'the following conditions end on you: Blinded, Deafened, Paralyzed, and Poisoned',
      why: 'expressible',
      note: 'an `end-condition` effect on a `confers` grant, which is exactly the kind packages/engine/src/content.ts admits for an item: it needs no casting id, no D20 Test and no save DC, and it outlasts nothing so the grant states no lifetime. Four condition names, printed in the book’s own order.',
    },
  ],
  'energy-bow': ['a-condition-an-item-imposes', 'a-spell-an-item-casts-that-nothing-executes'],
  'eversmoking-bottle': ['an-area-an-item-creates', 'a-benefit-an-item-switches-on-and-off'],
  'eyes-of-minute-seeing': ['senses-beyond-declared-sight', 'a-bonus-narrowed-to-a-skill'],
  'eyes-of-the-eagle': ['a-fact-only-the-table-can-declare'],
  'feather-token': [
    'a-version-of-an-item-the-book-leaves-to-the-gm',
    'a-stat-block-created-mid-fight',
    'an-object-with-statistics-of-its-own',
    'an-item-instance-with-a-state-of-its-own',
  ],
  'figurine-of-wondrous-power': [
    'a-stat-block-created-mid-fight',
    'a-version-of-an-item-the-book-leaves-to-the-gm',
    'an-item-instance-with-a-state-of-its-own',
  ],
  'flame-tongue': ['a-benefit-an-item-switches-on-and-off'],
  'folding-boat': ['an-object-with-statistics-of-its-own', 'a-container-with-a-space-of-its-own'],
  'gauntlets-of-ogre-power': ['an-ability-score-a-spell-changes'],
  'gem-of-brightness': [
    'a-condition-an-item-imposes',
    'an-area-an-item-creates',
    'a-charge-spent-on-something-other-than-a-casting',
    'an-item-instance-with-a-state-of-its-own',
  ],
  'gem-of-seeing': [
    'senses-beyond-declared-sight',
    'a-charge-spent-on-something-other-than-a-casting',
  ],
  'gloves-of-missile-snaring': ['a-reaction-an-item-grants'],
  'gloves-of-swimming-and-climbing': [
    'a-speed-an-item-grants',
    'movement-modes',
    'a-bonus-narrowed-to-a-skill',
  ],
  'gloves-of-thievery': [
    {
      clause: 'a +5 bonus to Dexterity (Sleight of Hand) checks',
      why: 'a-bonus-narrowed-to-a-skill',
      note: 'a `flat-bonus` reaches `ability-check` and that is the whole family, so this five would land on every Intelligence, Wisdom and Strength check the wearer ever makes. The narrowing to one skill is the shape the spell map already names for SRD Enthrall’s Perception penalty, and a pair of gloves prints it the other way up.',
    },
  ],
  'goggles-of-night': [
    {
      clause: 'you have Darkvision out to 60 feet',
      why: 'senses-beyond-declared-sight',
      note: 'sight is a pairwise declaration and there is nothing else, so Darkvision has no reader: no rule asks whether the goggles’ wearer can see in the dark, and a standing grant has no member that would say so.',
    },
    {
      clause: 'increases its range by 60 feet',
      why: 'senses-beyond-declared-sight',
      note: 'and the second sentence needs the first sentence’s answer to be a **number** rather than a fact, which is a second thing the missing reader has to hold.',
    },
  ],
  'handy-haversack': ['a-container-with-a-space-of-its-own'],
  'hat-of-disguise': ['a-casting-ended-by-a-trigger'],
  'hat-of-many-spells': [
    'a-spell-an-item-casts-that-nothing-executes',
    'a-version-of-an-item-the-book-leaves-to-the-gm',
  ],
  'headband-of-intellect': ['an-ability-score-a-spell-changes'],
  'helm-of-brilliance': [
    'an-area-an-item-creates',
    'a-rider-on-a-later-weapon-attack',
    'a-damage-roll-an-item-makes',
    'a-spell-an-item-casts-that-nothing-executes',
    'a-rider-on-the-face-the-die-showed',
    'an-item-instance-with-a-state-of-its-own',
  ],
  'helm-of-telepathy': [
    'a-spell-an-item-casts-that-nothing-executes',
    'a-fact-only-the-table-can-declare',
  ],
  'helm-of-teleportation': ['a-spell-an-item-casts-that-nothing-executes'],
  'horn-of-blasting': [
    'an-area-an-item-creates',
    'a-damage-roll-an-item-makes',
    'a-condition-an-item-imposes',
    'an-item-instance-with-a-state-of-its-own',
  ],
  'horn-of-valhalla': [
    'a-stat-block-created-mid-fight',
    'a-version-of-an-item-the-book-leaves-to-the-gm',
  ],
  'horseshoes-of-a-zephyr': [
    'a-speed-an-item-grants',
    'difficult-terrain-an-area-creates',
    'an-exhaustion-level-a-spell-changes',
  ],
  'horseshoes-of-speed': ['a-speed-an-item-grants'],
  'immovable-rod': ['an-object-with-statistics-of-its-own', 'a-fact-only-the-table-can-declare'],
  'instant-fortress': ['an-object-with-statistics-of-its-own'],
  'ioun-stone': [
    'a-version-of-an-item-the-book-leaves-to-the-gm',
    'an-ability-score-a-spell-changes',
    'a-reaction-an-item-grants',
    'healing-modified-by-an-effect',
  ],
  'iron-bands': ['a-condition-an-item-imposes', 'an-item-instance-with-a-state-of-its-own'],
  'iron-flask': [
    'a-save-an-item-forces',
    'a-stat-block-created-mid-fight',
    'an-item-instance-with-a-state-of-its-own',
  ],
  'javelin-of-lightning': ['an-area-an-item-creates'],
  'lantern-of-revealing': [
    'senses-beyond-declared-sight',
    'a-benefit-an-item-switches-on-and-off',
  ],
  'luck-blade': [
    'a-roll-result-an-effect-replaces',
    'a-spell-an-item-casts-that-nothing-executes',
    'a-charge-spent-on-something-other-than-a-casting',
  ],
  'mace-of-disruption': [
    'a-rider-on-a-later-weapon-attack',
    'a-save-an-item-forces',
    'a-condition-an-item-imposes',
  ],
  'mace-of-terror': [
    'a-condition-an-item-imposes',
    'a-charge-spent-on-something-other-than-a-casting',
    'an-action-a-spell-compels-or-forbids',
  ],
  'mantle-of-spell-resistance': [
    {
      clause: 'Advantage on saving throws against spells',
      why: 'a-mode-on-the-save-a-spell-forces',
      note: 'the whole of the entry, and the whole of its blocker: a `RollSelector` picks a saving throw by ability and by nothing else, so there is no way to select *the ones a spell forced*. The cloak would otherwise be four lines of `roll-mode` with `while-worn` and `while-attuned` on it.',
    },
  ],
  'manual-of-bodily-health': [
    'an-ability-score-a-spell-changes',
    'an-item-instance-with-a-state-of-its-own',
  ],
  'manual-of-gainful-exercise': [
    'an-ability-score-a-spell-changes',
    'an-item-instance-with-a-state-of-its-own',
  ],
  'manual-of-golems': [
    'a-stat-block-created-mid-fight',
    'a-damage-roll-an-item-makes',
    'a-version-of-an-item-the-book-leaves-to-the-gm',
  ],
  'manual-of-quickness-of-action': [
    'an-ability-score-a-spell-changes',
    'an-item-instance-with-a-state-of-its-own',
  ],
  'marvelous-pigments': [
    'a-concentration-with-no-casting-behind-it',
    'an-object-with-statistics-of-its-own',
    'an-item-instance-with-a-state-of-its-own',
  ],
  'medallion-of-thoughts': ['a-spell-an-item-casts-that-nothing-executes'],
  'mirror-of-life-trapping': [
    'an-object-with-statistics-of-its-own',
    'a-save-an-item-forces',
    'a-benefit-an-item-switches-on-and-off',
  ],
  'mysterious-deck': [
    'a-version-of-an-item-the-book-leaves-to-the-gm',
    'an-ability-score-a-spell-changes',
    'a-stat-block-created-mid-fight',
    'a-selector-for-every-d20-test',
  ],
  'necklace-of-adaptation': ['a-save-keyed-to-a-condition'],
  'necklace-of-fireballs': ['an-item-instance-with-a-state-of-its-own'],
  'necklace-of-prayer-beads': [
    'a-spell-an-item-casts-that-nothing-executes',
    'a-version-of-an-item-the-book-leaves-to-the-gm',
    'an-item-instance-with-a-state-of-its-own',
  ],
  oathbow: [
    'a-rider-on-a-later-weapon-attack',
    'a-fact-only-the-table-can-declare',
    'a-benefit-an-item-suspends-on-a-trigger',
  ],
  'oil-of-etherealness': [
    'a-spell-an-item-casts-that-nothing-executes',
    'an-item-instance-with-a-state-of-its-own',
  ],
  'oil-of-sharpness': ['an-item-instance-with-a-state-of-its-own'],
  'oil-of-slipperiness': [
    'a-spell-an-item-casts-that-nothing-executes',
    'an-area-an-item-creates',
    'an-item-instance-with-a-state-of-its-own',
  ],
  'pearl-of-power': ['a-casting-an-item-stores-or-gives-back'],
  'periapt-of-health': [
    'a-charge-spent-on-something-other-than-a-casting',
    'a-save-keyed-to-a-condition',
  ],
  'periapt-of-wound-closure': [
    'a-roll-result-an-effect-replaces',
    'healing-modified-by-an-effect',
  ],
  'philter-of-love': ['a-condition-an-item-imposes'],
  'pipes-of-haunting': ['a-condition-an-item-imposes'],
  'pipes-of-the-sewers': [
    'a-stat-block-created-mid-fight',
    'a-save-an-item-forces',
    'a-fact-only-the-table-can-declare',
  ],
  'plate-armor-of-etherealness': ['a-spell-an-item-casts-that-nothing-executes'],
  'portable-hole': ['a-container-with-a-space-of-its-own'],
  'potion-of-animal-friendship': {
    unread:
      'read, and the blocker cannot be named without inventing a shape. "you can cast the level 3 version of the _Animal Friendship_ spell (save DC 13)" is a **consumable whose one use is a casting**, and neither door fits: a `confers` grant is refused the `save` kind that spell is written in, while a `casts` grant is the shape Cape of the Mountebank already uses and `checkContent` accepts it here — a one-charge pool and the spell, DC and level the line prints. What it accepts is not the potion, because that pool recovers at dawn and nothing spends the flask itself: `useItem` is the only command that uses an item **up** as part of using it, and it refuses anything whose grant is not a conferral. Filing it under the condition weld would name a blocker the engine does not give; naming the missing one would be an architecture decision smuggled in as a note.',
  },
  'potion-of-clairvoyance': ['a-spell-an-item-casts-that-nothing-executes'],
  'potion-of-climbing': [
    'a-speed-an-item-grants',
    'movement-modes',
    'a-bonus-narrowed-to-a-skill',
  ],
  'potion-of-diminution': ['a-spell-an-item-casts-that-nothing-executes'],
  'potion-of-flying': ['a-speed-an-item-grants', 'movement-modes'],
  'potion-of-gaseous-form': ['a-spell-an-item-casts-that-nothing-executes'],
  'potion-of-giant-strength': [
    'an-ability-score-a-spell-changes',
    'a-version-of-an-item-the-book-leaves-to-the-gm',
  ],
  'potion-of-growth': ['a-spell-an-item-casts-that-nothing-executes'],
  'potion-of-invulnerability': [
    {
      clause: 'you have Resistance to all damage',
      why: 'expressible',
      note: 'a `damage-defense` effect on a `confers` grant, with the minute the sentence prints as the grant’s `durationSeconds` — which packages/engine/src/content.ts requires of exactly this kind, because a conferral hangs a sourced grant and there is no casting for `releaseCasting` to end. SRD’s "all damage" is the type list written out, the way Protection from Energy already writes one.',
    },
  ],
  'potion-of-longevity': [
    {
      clause: 'your physical age is reduced by 1d6 + 6 years',
      why: 'table',
      note: 'age is not a fact the engine holds, so the dice roll here changes nothing it could record. The table ages the character.',
    },
    {
      clause: '10 percent cumulative chance that you instead age',
      why: 'table',
      note: 'and the cumulative chance counts how many of these a *character* has drunk, which is a fact about the drinker rather than about the potion — the table’s to keep, and nothing a catalogue record could carry even with item instances.',
    },
  ],
  'potion-of-mind-reading': ['a-spell-an-item-casts-that-nothing-executes'],
  'potion-of-poison': ['a-damage-roll-an-item-makes', 'a-condition-an-item-imposes'],
  'potion-of-resistance': ['a-version-of-an-item-the-book-leaves-to-the-gm'],
  'potion-of-speed': ['a-spell-an-item-casts-that-nothing-executes'],
  'potion-of-vitality': ['an-exhaustion-level-a-spell-changes', 'healing-modified-by-an-effect'],
  'potion-of-water-breathing': [
    {
      clause: 'You can breathe underwater for 24 hours',
      why: 'table',
      note: 'breathing is not modelled — nothing drowns, nothing suffocates and no rule asks — so this is a fact the table keeps, and a record carrying it would carry nothing else.',
    },
  ],
  'ring-of-djinni-summoning': [
    'a-stat-block-created-mid-fight',
    'a-concentration-with-no-casting-behind-it',
  ],
  'ring-of-elemental-command': [
    'a-version-of-an-item-the-book-leaves-to-the-gm',
    'a-language-or-a-proficiency-an-item-grants',
    'a-spell-an-item-casts-that-nothing-executes',
    'a-condition-an-item-imposes',
    'movement-modes',
    'a-speed-an-item-grants',
  ],
  'ring-of-evasion': [
    'a-reaction-an-item-grants',
    'a-charge-spent-on-something-other-than-a-casting',
  ],
  'ring-of-feather-falling': [
    {
      clause: 'take no damage from falling',
      why: 'table',
      note: 'falling is not modelled: no rule drops a creature, computes a distance or deals the damage, so a ring that cancels it cancels nothing the engine would have done. The descent rate is the same answer.',
    },
  ],
  'ring-of-free-action': [
    'difficult-terrain-an-area-creates',
    'a-condition-immunity-narrowed-to-its-source',
  ],
  'ring-of-invisibility': [
    'a-condition-an-item-imposes',
    'a-benefit-an-item-switches-on-and-off',
  ],
  'ring-of-mind-shielding': [
    'a-fact-only-the-table-can-declare',
    'an-object-with-statistics-of-its-own',
  ],
  'ring-of-regeneration': ['healing-modified-by-an-effect'],
  'ring-of-resistance': ['a-version-of-an-item-the-book-leaves-to-the-gm'],
  'ring-of-shooting-stars': [
    'a-spell-an-item-casts-that-nothing-executes',
    'an-area-an-item-creates',
    'a-concentration-with-no-casting-behind-it',
  ],
  'ring-of-spell-storing': ['a-casting-an-item-stores-or-gives-back'],
  'ring-of-spell-turning': ['a-mode-on-the-save-a-spell-forces', 'a-reaction-an-item-grants'],
  'ring-of-swimming': ['a-speed-an-item-grants', 'movement-modes'],
  'ring-of-telekinesis': ['a-spell-an-item-casts-that-nothing-executes'],
  'ring-of-the-ram': [
    'a-damage-roll-an-item-makes',
    'a-charge-spent-on-something-other-than-a-casting',
  ],
  'ring-of-three-wishes': [
    'a-spell-an-item-casts-that-nothing-executes',
    'an-item-instance-with-a-state-of-its-own',
  ],
  'ring-of-warmth': ['a-reduction-an-effect-applies-to-damage'],
  'ring-of-x-ray-vision': [
    'senses-beyond-declared-sight',
    'a-benefit-an-item-switches-on-and-off',
    'an-exhaustion-level-a-spell-changes',
  ],
  'robe-of-eyes': [
    'a-fact-only-the-table-can-declare',
    'senses-beyond-declared-sight',
    'a-condition-an-item-imposes',
  ],
  'robe-of-scintillating-colors': [
    'a-condition-an-item-imposes',
    'a-charge-spent-on-something-other-than-a-casting',
    'an-area-an-item-creates',
  ],
  'robe-of-the-archmagi': ['a-bonus-to-spell-attack-rolls', 'a-mode-on-the-save-a-spell-forces'],
  'robe-of-useful-items': [
    'an-object-with-statistics-of-its-own',
    'a-version-of-an-item-the-book-leaves-to-the-gm',
    'an-item-instance-with-a-state-of-its-own',
  ],
  'rod-of-absorption': ['a-casting-an-item-stores-or-gives-back', 'a-reaction-an-item-grants'],
  // Its four spells are all defined, so the spell shape never belonged here;
  // and what its `_Spells._` property had no way to say — "While holding the
  // rod, you can cast the following spells from it", naming no charge and no
  // dawn — is now `atWill`. What is left is the aura it plants and the
  // Advantage on Initiative it hands whoever is near it.
  'rod-of-alertness': ['an-area-an-item-creates', 'senses-beyond-declared-sight'],
  'rod-of-lordly-might': [
    'a-benefit-an-item-switches-on-and-off',
    'a-condition-an-item-imposes',
    'a-save-an-item-forces',
    'a-rider-on-a-later-weapon-attack',
  ],
  'rod-of-resurrection': ['a-spell-an-item-casts-that-nothing-executes'],
  'rod-of-rulership': ['a-condition-an-item-imposes'],
  'rod-of-security': ['a-fact-only-the-table-can-declare', 'healing-modified-by-an-effect'],
  'rope-of-climbing': ['an-object-with-statistics-of-its-own', 'a-bonus-narrowed-to-a-skill'],
  'rope-of-entanglement': ['an-object-with-statistics-of-its-own', 'a-condition-an-item-imposes'],
  'scarab-of-protection': [
    'a-reaction-an-item-grants',
    'a-mode-on-the-save-a-spell-forces',
    'a-charge-spent-on-something-other-than-a-casting',
  ],
  'sending-stones': [
    'a-spell-an-item-casts-that-nothing-executes',
    'an-item-instance-with-a-state-of-its-own',
  ],
  'shield-of-missile-attraction': ['what-ends-attunement-besides-a-command'],
  'slippers-of-spider-climbing': ['a-speed-an-item-grants', 'movement-modes'],
  'sovereign-glue': [
    {
      clause: 'can form a permanent adhesive bond between any two objects',
      why: 'table',
      note: 'an adhesive bond is not a mechanical state: nothing in the engine holds two objects together, and no rule would ask.',
    },
    {
      clause: 'a container contains 1d6 + 1 ounces',
      why: 'an-item-instance-with-a-state-of-its-own',
      note: 'the ounces are a count on **this** jar, rolled when it is found and spent an ounce at a time. A catalogue row is the same for everybody, so there is nowhere to put them — which is the identity docs/design/characters-and-equipment.md still owes, arriving on an item with no other rules at all.',
    },
  ],
  'spell-scroll': [
    'a-spell-an-item-casts-that-nothing-executes',
    'a-version-of-an-item-the-book-leaves-to-the-gm',
    'an-item-instance-with-a-state-of-its-own',
  ],
  'spellguard-shield': ['a-mode-on-the-save-a-spell-forces'],
  'sphere-of-annihilation': ['an-object-with-statistics-of-its-own', 'a-damage-roll-an-item-makes'],
  'staff-of-charming': [
    'a-spell-an-item-casts-that-nothing-executes',
    'a-reaction-an-item-grants',
    'a-charge-spent-on-something-other-than-a-casting',
    'a-rider-on-the-face-the-die-showed',
  ],
  'staff-of-frost': [
    'a-spell-an-item-casts-that-nothing-executes',
    'a-rider-on-the-face-the-die-showed',
  ],
  'staff-of-healing': [
    'a-charge-spent-on-something-other-than-a-casting',
    'a-rider-on-the-face-the-die-showed',
  ],
  'staff-of-power': [
    'a-spell-an-item-casts-that-nothing-executes',
    'a-bonus-to-spell-attack-rolls',
    'a-rider-on-the-face-the-die-showed',
    'an-area-an-item-creates',
    'a-damage-roll-an-item-makes',
  ],
  'staff-of-striking': ['a-charge-spent-on-something-other-than-a-casting'],
  'staff-of-swarming-insects': [
    'a-spell-an-item-casts-that-nothing-executes',
    'an-area-an-item-creates',
    'a-charge-spent-on-something-other-than-a-casting',
    'a-rider-on-the-face-the-die-showed',
  ],
  'staff-of-the-magi': [
    'a-spell-an-item-casts-that-nothing-executes',
    'a-bonus-to-spell-attack-rolls',
    'a-casting-an-item-stores-or-gives-back',
    'an-area-an-item-creates',
    'a-damage-roll-an-item-makes',
  ],
  'staff-of-the-python': [
    'a-stat-block-created-mid-fight',
    'an-object-with-statistics-of-its-own',
  ],
  'staff-of-the-woodlands': [
    'a-spell-an-item-casts-that-nothing-executes',
    'a-bonus-to-spell-attack-rolls',
    'an-object-with-statistics-of-its-own',
    'a-rider-on-the-face-the-die-showed',
  ],
  'staff-of-thunder-and-lightning': [
    'a-rider-on-a-later-weapon-attack',
    'a-condition-an-item-imposes',
    'an-area-an-item-creates',
  ],
  'staff-of-withering': [
    'a-charge-spent-on-something-other-than-a-casting',
    'a-save-an-item-forces',
    'a-rider-on-a-later-weapon-attack',
  ],
  'stone-of-controlling-earth-elementals': ['a-stat-block-created-mid-fight'],
  'sun-blade': [
    'a-benefit-an-item-switches-on-and-off',
    'a-rider-on-a-later-weapon-attack',
    'a-language-or-a-proficiency-an-item-grants',
  ],
  'sword-of-life-stealing': ['a-rider-on-the-face-the-die-showed'],
  'sword-of-sharpness': [
    'a-rider-on-the-face-the-die-showed',
    'an-exhaustion-level-a-spell-changes',
  ],
  'talisman-of-pure-good': [
    'a-bonus-to-spell-attack-rolls',
    'a-damage-roll-an-item-makes',
    'a-save-an-item-forces',
    'a-charge-spent-on-something-other-than-a-casting',
    'a-filter-on-the-attackers-creature-type',
    'an-item-instance-with-a-state-of-its-own',
  ],
  'talisman-of-the-sphere': [
    'a-fact-only-the-table-can-declare',
    'an-object-with-statistics-of-its-own',
  ],
  'talisman-of-ultimate-evil': [
    'a-bonus-to-spell-attack-rolls',
    'a-damage-roll-an-item-makes',
    'a-save-an-item-forces',
    'a-charge-spent-on-something-other-than-a-casting',
    'a-filter-on-the-attackers-creature-type',
    'an-item-instance-with-a-state-of-its-own',
  ],
  'thunderous-greatclub': [
    'an-ability-score-a-spell-changes',
    'an-area-an-item-creates',
    'a-save-an-item-forces',
    'a-condition-an-item-imposes',
    'a-rider-on-a-later-weapon-attack',
    'a-damage-roll-an-item-makes',
  ],
  'tome-of-clear-thought': [
    'an-ability-score-a-spell-changes',
    'an-item-instance-with-a-state-of-its-own',
  ],
  'tome-of-leadership-and-influence': [
    'an-ability-score-a-spell-changes',
    'an-item-instance-with-a-state-of-its-own',
  ],
  'tome-of-understanding': [
    'an-ability-score-a-spell-changes',
    'an-item-instance-with-a-state-of-its-own',
  ],
  'trident-of-fish-command': ['a-target-rule-the-format-cannot-state'],
  'universal-solvent': [
    {
      clause: 'a tube contains 1d6 + 1 ounces',
      why: 'an-item-instance-with-a-state-of-its-own',
      note: 'the same count Sovereign Glue’s jar carries, and the same absent identity: an ounce spent is a fact about this tube, and a catalogue row is the same for everybody.',
    },
    {
      clause: 'onto a surface within reach',
      why: 'table',
      note: 'reach here is the arm’s, not a weapon’s: nothing is targeted, no roll is made, and the engine’s ruler is never asked. Dissolving an adhesive is the table’s.',
    },
  ],
  'wand-of-binding': ['a-rider-on-the-face-the-die-showed'],
  'wand-of-enemy-detection': [
    'senses-beyond-declared-sight',
    'a-rider-on-the-face-the-die-showed',
    'a-charge-spent-on-something-other-than-a-casting',
  ],
  'wand-of-fear': [
    'a-spell-an-item-casts-that-nothing-executes',
    'a-rider-on-the-face-the-die-showed',
  ],
  'wand-of-lightning-bolts': ['a-rider-on-the-face-the-die-showed'],
  'wand-of-magic-missiles': [
    'a-spell-an-item-casts-that-nothing-executes',
    'a-rider-on-the-face-the-die-showed',
  ],
  'wand-of-paralysis': ['a-condition-an-item-imposes', 'a-rider-on-the-face-the-die-showed'],
  'wand-of-polymorph': [
    'a-spell-an-item-casts-that-nothing-executes',
    'a-rider-on-the-face-the-die-showed',
  ],
  'wand-of-the-war-mage-1-2-or-3': [
    'a-bonus-to-spell-attack-rolls',
    'a-fact-only-the-table-can-declare',
  ],
  'wand-of-wonder': [
    'a-spell-an-item-casts-that-nothing-executes',
    'a-version-of-an-item-the-book-leaves-to-the-gm',
    'a-condition-an-item-imposes',
    'a-rider-on-the-face-the-die-showed',
  ],
  'well-of-many-worlds': {
    unread:
      'read, and the blocker cannot be named without inventing a shape. A two-way portal between planes is neither an area, nor an object with statistics, nor a teleport destination stated at a casting, and nothing in this repository has described a planar portal as a gap. It is not fiction either — creatures pass through it — so it may not be filed as the table’s.',
  },
  'wind-fan': [
    'a-spell-an-item-casts-that-nothing-executes',
    'an-item-instance-with-a-state-of-its-own',
  ],
  'winged-boots': [
    'a-speed-an-item-grants',
    'movement-modes',
    'a-charge-spent-on-something-other-than-a-casting',
  ],
  'wings-of-flying': [
    'a-speed-an-item-grants',
    'movement-modes',
    'a-benefit-an-item-switches-on-and-off',
  ],
};

// — the item query ————————————————————————————————————————————————————————————

/** Every entry of "Magic Items A–Z", by id. */
export const parsedItemIds = (): readonly string[] => magicItemEntries().map((entry) => entry.id);

/** Every entry at least one catalogue record was read from, by id. */
export const transcribedItemIds = (): ReadonlySet<string> =>
  new Set(transcribedItems().map(([, entry]) => entry.id));

/**
 * The entry's printed fields, which no sentence of its prose states.
 *
 * `printedFieldsOf`'s counterpart: the type line and the charge line are
 * printed *above* the paragraph, and a clause about an attunement bracket or a
 * charge count has nothing in the prose to anchor to. Kept apart from the
 * sentences for that function's own reason — only a sentence is a **claim**.
 */
export const itemPrintedFieldsOf = (entryId: string): readonly string[] => {
  const entry = itemEntryOrThrow(entryId);
  const charges =
    entry.charges === null
      ? 'Charges: none'
      : `Charges: ${entry.charges.maximum ?? entry.charges.formula ?? ''}`;
  return [
    `Rarity: ${entry.rarity.text}`,
    `Attunement: ${entry.requiresAttunement ? (entry.attunementPrerequisite ?? 'Requires Attunement') : 'none'}`,
    charges,
  ];
};

/**
 * An entry's prose, as sentences.
 *
 * **The markup is dropped and the wording is not**, which is the one thing
 * this does that `sentencesOf` does not have to: the magic-item parser keeps
 * each entry's prose "verbatim, tables included", and the tables are HTML. A
 * tag is typesetting by the same argument that makes emphasis wording, so the
 * tags go and every word between them stays.
 *
 * It can still throw {@link SentenceSplitError}, and the loudness is the point:
 * a few of the book's tables hold a cell longer than any sentence, so the first
 * person to read one of those entries sentence by sentence finds out rather
 * than getting one adjudication covering a page. That is the same trade the
 * spell side made, arriving for a different reason.
 */
export const itemSentencesOf = (entryId: string): readonly string[] =>
  splitSentences(itemEntryOrThrow(entryId).description.replace(/<[^>]*>/g, ' '));

/** Everything a clause may be anchored to: the printed fields, then the prose. */
export const itemPrintedUnitsOf = (entryId: string): readonly string[] => [
  ...itemPrintedFieldsOf(entryId),
  ...itemSentencesOf(entryId),
];

let itemsById: Map<string, MagicItem> | undefined;

const itemEntryOrThrow = (entryId: string): MagicItem => {
  itemsById ??= new Map(magicItemEntries().map((entry) => [entry.id, entry]));
  const found = itemsById.get(entryId);
  if (found === undefined) throw new Error(`${entryId} is not a parsed SRD magic item`);
  return found;
};

/** The clauses an entry names, which for a grandfathered or unread entry is none. */
export const itemClausesIn = (entry: ItemEntry): readonly ItemClause[] =>
  isUnread(entry) ? [] : entry.filter((blocker): blocker is ItemClause => typeof blocker !== 'string');

/** The shapes an entry names, however it names them — deduplicated and sorted. */
export const itemBlockersIn = (entry: ItemEntry): readonly ItemBlockerId[] =>
  isUnread(entry)
    ? []
    : [
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

/** The shapes blocking one entry, by id. */
export const itemBlockersOf = (entryId: string): readonly ItemBlockerId[] =>
  itemBlockersIn(ITEM_BLOCKED_ON[entryId] ?? []);

/** The phrases an entry's printed text does not say exactly once. */
export const unanchoredItemClauses = (
  entryId: string,
  entry: ItemEntry = ITEM_BLOCKED_ON[entryId] ?? [],
): readonly UnanchoredClause[] =>
  unanchoredWithin(
    entryId,
    itemPrintedUnitsOf(entryId),
    itemClausesIn(entry).map((clause) => clause.clause),
  );

/**
 * The sentences of an entry's prose that name a mechanic and carry no clause.
 *
 * `sentenceGaps` over the other book, reading the **same** marker list. A
 * second list spelled alike would be a second answer to one question, which is
 * the failure this whole file is a correction of.
 */
export const itemSentenceGaps = (
  entryId: string,
  entry: ItemEntry = ITEM_BLOCKED_ON[entryId] ?? [],
): readonly SentenceGap[] => {
  const phrases = itemClausesIn(entry).map((clause) => flatten(clause.clause));
  return itemSentencesOf(entryId)
    .filter((sentence) => markersIn(sentence).length > 0)
    .filter((sentence) => !phrases.some((phrase) => sentence.includes(phrase)))
    .map((sentence) => ({ spell: entryId, sentence, markers: markersIn(sentence) }));
};

/** Has somebody read this entry sentence by sentence? */
export const isItemRead = (
  entryId: string,
  entry: ItemEntry = ITEM_BLOCKED_ON[entryId] ?? [],
): boolean => itemClausesIn(entry).length > 0 && itemSentenceGaps(entryId, entry).length === 0;

/**
 * Where one parsed entry stands, in exactly one word.
 *
 * **Total, and arranged so that every way of failing to do the work lands in
 * `unread`.** An entry with no line at all, an entry that says it is unread, and
 * an entry claiming no blocker without a recorded reading all arrive at the same
 * honest answer. `ready` is the only state a brief transcribes from, and the
 * three conditions on it are the three ways the previous sentence could have
 * been got wrong: somebody read it, no clause names a shape, and at least one
 * clause is something the vocabulary can actually write down.
 */
export type ItemPile = 'transcribed' | 'blocked' | 'ready' | 'fiction' | 'unread';

export const itemPileOf = (
  entryId: string,
  transcribed: ReadonlySet<string>,
  blockedOn: Readonly<Record<string, ItemEntry>> = ITEM_BLOCKED_ON,
): ItemPile => {
  if (transcribed.has(entryId)) return 'transcribed';
  const entry = blockedOn[entryId];
  if (entry === undefined || isUnread(entry)) return 'unread';
  if (itemBlockersIn(entry).length > 0) return 'blocked';
  if (!isItemRead(entryId, entry)) return 'unread';
  return itemClausesIn(entry).some((clause) => clause.why === 'expressible') ? 'ready' : 'fiction';
};

/** Every parsed entry, sorted into its one pile. */
export const itemPiles = (
  parsed: readonly string[],
  transcribed: ReadonlySet<string>,
  blockedOn: Readonly<Record<string, ItemEntry>> = ITEM_BLOCKED_ON,
): Readonly<Record<ItemPile, readonly string[]>> => {
  const piles: Record<ItemPile, string[]> = {
    transcribed: [],
    blocked: [],
    ready: [],
    fiction: [],
    unread: [],
  };
  for (const id of [...parsed].sort()) piles[itemPileOf(id, transcribed, blockedOn)].push(id);
  return piles;
};

/**
 * The two ways `ITEM_BLOCKED_ON` can fail to cover its population.
 *
 * {@link coverageGaps} for items, parameterised for its reason: a guard that
 * can only be run against the data it already agrees with is not a guard, so
 * the tests drive this with a synthetic catalogue holding an entry nobody has
 * read, and with a synthetic transcription that must make a line stale.
 */
export const itemCoverageGaps = (
  parsed: readonly string[],
  transcribed: ReadonlySet<string>,
  blockedOn: Readonly<Record<string, unknown>> = ITEM_BLOCKED_ON,
): { readonly unrecorded: readonly string[]; readonly stale: readonly string[] } => {
  const open = new Set(parsed.filter((id) => !transcribed.has(id)));
  return {
    unrecorded: [...open].filter((id) => blockedOn[id] === undefined).sort(),
    stale: Object.keys(blockedOn)
      .filter((id) => !open.has(id))
      .sort(),
  };
};

export interface ItemShapeConsumers {
  readonly shape: ItemBlockerId;
  /** Untranscribed entries this shape blocks. */
  readonly blocks: readonly string[];
  /** The entries it is the **only** blocker for: building it finishes exactly these. */
  readonly finishes: readonly string[];
  /** Of those, the ones somebody has read sentence by sentence. */
  readonly finishesRead: readonly string[];
  /** And the ones still grandfathered, which is most of them. */
  readonly finishesUnread: readonly string[];
}

/** How many untranscribed entries a shape blocks, and which. */
export function itemConsumersOf(shape: ItemBlockerId): ItemShapeConsumers {
  const blocks = sorted(
    Object.entries(ITEM_BLOCKED_ON)
      .filter(([, entry]) => itemBlockersIn(entry).includes(shape))
      .map(([id]) => id),
  );
  const finishes = blocks.filter((id) => itemBlockersOf(id).length === 1);
  return {
    shape,
    blocks,
    finishes,
    finishesRead: finishes.filter((id) => isItemRead(id)),
    finishesUnread: finishes.filter((id) => !isItemRead(id)),
  };
}

/** Every shape any item entry claims, which is what keeps the map from rotting. */
export function claimedItemShapes(): ReadonlySet<string> {
  return new Set(Object.values(ITEM_BLOCKED_ON).flatMap((entry) => itemBlockersIn(entry)));
}

/**
 * Every shape an item is blocked on, heaviest first.
 *
 * Over the shapes items **claim**, which is the item vocabulary and whichever
 * of the spell vocabulary the book's items also want — because a shape is worth
 * building for what it unblocks everywhere, and an item map that printed only
 * its own ids would hide that the largest item blocker is a missing *spell*.
 */
export function allItemShapeConsumers(): readonly ItemShapeConsumers[] {
  return [...claimedItemShapes()]
    .map((shape) => itemConsumersOf(shape as ItemBlockerId))
    .sort(
      (a, b) =>
        b.finishes.length - a.finishes.length ||
        b.blocks.length - a.blocks.length ||
        a.shape.localeCompare(b.shape),
    );
}
