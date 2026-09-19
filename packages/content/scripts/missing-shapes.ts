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
    'a score an effect **moves**, in any of the five ways the book moves one. `docs/design/time-and-turns.md`, on what a rest does not restore: "**Reduced ability scores and a reduced hit point maximum are not restored**, because neither is modelled in the first place." One of the five is built: an item may now *set* a score — an **absolute** held while it is worn, derived on every read by `abilityScoresOf` — and the three entries that printed only that sentence are transcribed. Four have no writer. A score an effect **lowers**. A **bounded delta with a lifetime**, which SRD prints on six Ioun Stones: "Your Dexterity increases by 2, to a maximum of 20, while this deep-red sphere orbits your head" is `ability-score-increase`’s arithmetic on a standing grant’s lifetime, and the member that holds the arithmetic is answered at creation while the one that holds the lifetime writes absolutes — the Belt of Dwarvenkind and the Thunderous Greatclub print it too. A set with a **deadline** rather than a garment, which a conferral would carry and `CONFERRED_EFFECT_KINDS` does not admit. And a **permanent** raise: the manuals’ and the tomes’ +2 after forty-eight hours of study, which outlives every rest and is a folded number rather than a derived one.',
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
  'chromatic-orb': [
    {
      clause: 'reads the individual dice of a damage roll',
      why: 'a-die-behaviour-a-spell-asks-for',
      note: 'the leap fires on "If you roll the same number on two or more of the d8s", which asks which faces a damage roll showed. A damage roll comes back as a total, and no effect kind asks the generator about the dice inside one.',
    },
    {
      clause: 'a second attack roll and a second damage roll out of one casting',
      why: 'several-attack-rolls-from-one-casting',
      note: 'an effect rolls one attack per target, and the leap is a further attack at a creature the casting never named — the shape Scorching Ray and Eldritch Blast are both blocked on, arriving here on a spell whose first orb is executed.',
    },
    {
      clause: 'a maximum number of times equal to the level of the slot expended',
      why: 'several-attack-rolls-from-one-casting',
      note: 'the cap counts leaps, and so does the rule that a creature may be targeted only once by a casting; both are bookkeeping over a sequence of attacks that is not produced, so they come with the shape rather than before it.',
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
  'conjure-fey': [
    {
      clause: 'a Fey creature of your choice',
      why: 'table',
      note: 'the creature-type word is the marker firing on a costume: the spirit is a point on the casting rather than a creature, so nothing asks what type it is and no rule reads the answer. What it looks like is narration in the same way the weapon Spiritual Weapon resembles is.',
    },
    {
      clause: 'both you and the spirit as the source of the fear',
      why: 'table',
      note: 'the Frightened condition itself is applied, by the rider on the attack, and what is left over is the second source: a condition carries the casting that imposed it, and the spirit is not a creature anything could be frightened of separately. Which of the two a later ruling reads is the table’s.',
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
  'fire-shield': [
    {
      clause: 'the shield erupts with flame',
      why: 'a-spell-that-answers-a-later-attack',
      note: 'the eruption fires on somebody else\u2019s melee attack after it has hit, and a casting is offered no window on another creature\u2019s attack \u2014 the same absence Sanctuary, Shield and Mirror Image all wait on.',
    },
    {
      clause: 'the 2d8 the attacker takes is not dealt',
      why: 'a-spell-that-answers-a-later-attack',
      note: 'the dice are ordinary and so is the rule that picks their type \u2014 Fire from a warm shield, Cold from a chill one \u2014 and both hang on the eruption above, which has no moment to happen at.',
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
  'gaseous-form': [
    {
      clause: 'if it drops to 0 Hit Points',
      why: 'a-casting-ended-by-a-trigger',
      note: 'SRD: "The spell ends on the target if it drops to 0 Hit Points or if it takes a Magic action to end the spell on itself." IE-032 built five transcribed causes and every one hangs on a consequence event; dropping to 0 Hit Points is not among them, so the cloud goes on being a cloud after its occupant falls.',
    },
    {
      clause: 'the target ending it "as a Magic action" is not offered',
      why: 'a-casting-dismissed-early',
      note: 'SRD: "or if it takes a Magic action to end the spell on itself." The general dismissal is built — `endOngoingSpell` ends a casting by id — and this sentence prints both of the exceptions it does not carry: the creature ending it is the **target** rather than the caster, and the book charges a Magic action where a dismissal costs none.',
    },
    {
      clause: 'a Fly Speed of 10 feet',
      why: 'movement-modes',
      note: 'SRD: "the target’s only method of movement is a Fly Speed of 10 feet, and it can hover." The engine tracks one Speed and no modes, so there is no way to say that walking is gone and flying is not — the target simply keeps the Speed it had.',
    },
    {
      clause: 'the things the cloud cannot do are not forbidden',
      why: 'an-action-a-spell-compels-or-forbids',
      note: 'SRD: "The target can’t talk or manipulate objects, and any objects it was carrying or holding can’t be dropped, used, or otherwise interacted with." The action economy is the engine’s and the only lever a spell has on it is a condition the engine names; forbidding two actions and leaving the rest is a rider nothing expresses, and what is in a creature’s hands is not a fact the engine holds either.',
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
  haste: [
    {
      clause: 'the doubled Speed',
      why: 'a-speed-an-effect-multiplies',
      note: 'SRD: "the target’s Speed is doubled, it gains a +2 bonus to Armor Class". A Speed is composed from a halving, which is presence rather than count, and a zero, which is last and wins; a doubling is neither, and the book gives no order for one against a halving — so the member arrives with the rule that settles it or not at all.',
    },
    {
      clause: 'the extra action and the five it may be spent on',
      why: 'an-action-a-spell-compels-or-forbids',
      note: 'SRD: "it gains an additional action on each of its turns. That action can be used to take only the Attack (one attack only), Dash, Disengage, Hide, or Utilize action." Granting an extra action is named in that shape’s own description beside forbidding one, and the narrowing is a second rider on a thing the first cannot create.',
    },
    {
      clause: 'the lethargy',
      why: 'an-effect-that-fires-when-the-casting-ends',
      note: 'SRD: "When the spell ends, the target is Incapacitated and has a Speed of 0 until the end of its next turn, as a wave of lethargy washes over it." Expiry is derived here, like Concentration breaking, and the log records an effect being scheduled rather than expiring — so a spell that punishes its target when it lapses has no hook to hang the lethargy on.',
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
      note: 'SRD: "it can’t end the Prone condition on itself." Standing up is something a creature does and the engine does not model it as an action a spell can forbid, so the Prone is lifted by the spell ending and by nothing this clause could stop.',
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
  'prayer-of-healing': [
    {
      clause: 'remain within range for the spell',
      why: 'table',
      note: 'SRD: "Up to five creatures of your choice who remain within range for the spell\'s entire casting gain the benefits of a Short Rest". Range is measured against where the five stand when the rite settles, and nothing records where anybody stood for the ten minutes before it; a position history kept only so that one spell could read it would be a rule nothing else asks for, so whether they stayed is the DM\'s.',
    },
  ],
  'protection-from-poison': [
    {
      clause: 'Advantage on saving throws to avoid or end the Poisoned condition',
      why: 'a-save-keyed-to-a-condition',
      note: 'SRD: "the target has Advantage on saving throws to avoid or end the Poisoned condition". A `RollModifier` selects a save by ability and by nothing else, so the nearest sayable thing is Advantage on every Constitution save the target ever makes — which is a different and much larger spell. The engine rolls those saves without it.',
    },
  ],
  'searing-smite': [
    {
      clause: 'a repeat save whose failure branch acts',
      why: 'a-repeat-save-that-does-something-on-a-failure',
      note: 'the burning deals 1d6 Fire damage at the start of each of the target’s turns and then asks for a Constitution save. `RepeatSave.onSuccess` releases an effect and the failure branch does nothing at all, which is the wrong way round for every sentence of this paragraph.',
    },
    {
      clause: 'the spell continuing on a failed save, and ending on a successful one',
      why: 'a-repeat-save-that-does-something-on-a-failure',
      note: 'the two branches the save chooses between, and the second is the one the existing mechanism could express. Recorded separately because the damage above it is the half that has no branch to sit in, and a single entry would have hidden which of the two is missing.',
    },
  ],
  shield: [
    {
      clause: 'Magic Missile',
      why: 'damage-with-neither-an-attack-roll-nor-a-save',
      note: 'Being targeted by Magic Missile is the spell’s second trigger and taking no damage from it is its second benefit, and neither can exist while the spell they name cannot be cast: its darts hit with no attack roll and no save.',
    },
  ],
  'shining-smite': [
    {
      clause: 'the Advantage on attack rolls against the target is not granted',
      why: 'a-spells-effects-applied-to-different-targets',
      note: 'SRD: "attack rolls against it have Advantage". The mode is ordinary and who holds it is not — it belongs to every other creature in the fight, where this casting reached one, and a spell applies its effects to the targets it was given.',
    },
    {
      clause: 'switches off a benefit the condition layer derives',
      why: 'a-condition-benefit-an-effect-takes-away',
      note: 'SRD: "it can\'t benefit from the Invisible condition". The condition stays on the creature and one of the things it confers stops working, which the condition layer derives from the condition\'s presence alone and no spell effect reaches.',
    },
  ],
  'shocking-grasp': [
    {
      clause: 'cannot make Opportunity Attacks',
      why: 'an-action-a-spell-compels-or-forbids',
      note: 'SRD: the target "can’t make Opportunity Attacks until the start of its next turn". The engine offers and spends that Reaction itself, and nothing forbids one action while leaving the rest of the budget alone.',
    },
  ],
  'sorcerous-burst': [
    {
      clause: 'reads the face of one die out of a roll that comes back as a total',
      why: 'a-die-behaviour-a-spell-asks-for',
      note: 'the exploding die asks whether an 8 came up on a d8 and adds another on the strength of it, up to the caster’s spellcasting ability modifier. The generator throws a notation and returns a total; nothing asks it which faces it showed.',
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
  levitate: [
    {
      marker: 'saving-throw',
      clause: 'An unwilling creature that succeeds on a Constitution saving throw is unaffected',
      why: 'forced-movement-a-spell-causes',
      note: 'the save is written as the gate on an outcome, and the whole outcome here is the lift: rising 20 feet and hanging there is forced movement, and no SpellEffect reaches the one function that performs it. A save gating nothing would be a die thrown for no reason.',
    },
  ],
  'scorching-ray': [
    {
      marker: 'dice',
      clause: 'the target takes 2d6 Fire damage',
      why: 'several-attack-rolls-from-one-casting',
      note: 'the dice are ordinary and the three rolls are not: an effect rolls one attack per target and this casting hurls three rays that may all go at one creature, which is the shape Eldritch Blast is blocked on and the definition vocabulary already names.',
    },
  ],
  scrying: [
    {
      marker: 'saving-throw',
      clause: 'The target makes a Wisdom saving throw, which is modified',
      why: 'a-fact-only-the-table-can-declare',
      note: 'the DC is modified by two printed tables of facts the engine does not hold and must not guess: how well the caster knows the target, and whether they are holding a possession, a likeness or a lock of its hair. Declared cover and declared sight are the line this follows.',
    },
  ],
  'detect-thoughts': [
    {
      marker: 'saving-throw',
      clause: 'If you probe deeper, the target makes a Wisdom saving throw',
      why: 'an-activation-that-forces-a-saving-throw',
      note: 'the probe is a Magic action on a later turn and the save is what it forces; every registered SpellActivation resolves an attack or moves an area instead, which is the machinery standing beside this with no consumer.',
    },
    {
      marker: 'ability-check',
      clause: 'make an Intelligence (Arcana) check against your spell save DC, ending the spell on a success',
      why: 'a-check-another-creature-may-attempt',
      note: 'who may attempt a check is derived from what its timer sits on, and this one sits on neither branch: the casting is on the caster and holds nothing on the creature being probed. SpellCheck.onSuccess has deliberately no end-casting either, and names this spell while refusing it.',
    },
  ],
  'enlarge-reduce': [
    {
      marker: 'saving-throw',
      clause: 'If the target is an unwilling creature, it can make a Constitution saving throw',
      why: 'a-creature-fact-an-effect-overrides',
      note: 'what the save gates is a size category, and size is a fact the engine holds authoritatively and reads for sharing a space, passing through and what a template catches. Nothing lets an effect write over one for a duration.',
    },
    {
      marker: 'roll-mode',
      clause: 'The target also has Advantage on Strength checks and Strength saving throws',
      why: 'a-choice-made-at-the-casting',
      note: 'the mode itself is ordinary and the branch is not: the reduce half prints Disadvantage on the same two rolls, so writing either would be a spell that always enlarges. Which of the two the caster chose has nowhere to be recorded.',
    },
    {
      marker: 'extra-damage',
      clause: 'deal an extra 1d4 damage on a hit',
      why: 'a-rider-on-a-later-weapon-attack',
      note: 'extra damage with no type, and so of the weapon’s own: the attack-rider grant hangs a notation and a damage type together, and that shape’s own description names this spell among what is left.',
    },
    {
      marker: 'dice',
      clause: 'deal 1d4 less damage on a hit',
      why: 'a-damage-penalty-a-spell-grants',
      note: 'the reduce half subtracts from a later damage roll and floors the result at 1; a rider that takes dice away from an attack is the shape this names, and no grant applies one.',
    },
  ],
  'private-sanctum': [
    {
      marker: 'teleport',
      clause: 'Nothing can teleport into or out of the warded area',
      why: 'an-effect-that-suppresses-other-magic',
      note: 'the ward is an area that refuses other magic — a teleport, a Divination sensor, a targeting, a planar step — and there is no state in which a casting is being refused by a place, which is the half of that shape Dispel Magic did not build.',
    },
  ],
  'resilient-sphere': [
    {
      marker: 'saving-throw',
      clause: 'An unwilling creature must succeed on a Dexterity saving throw or be enclosed for the duration',
      why: 'a-barrier-that-blocks-passage',
      note: 'being enclosed is not one of the fifteen conditions and is not a state at all: it is a barrier standing between one creature and everything else, and movement consults no walls. So the save gates nothing and is not rolled.',
    },
    {
      marker: 'speed',
      clause: 'An enclosed creature can take an action to push against the sphere',
      why: 'a-barrier-that-blocks-passage',
      note: 'the halved Speed is arithmetic the engine already does; what it would move is the sphere, and the sphere is the barrier that has nowhere to be. The same is true of the sentence after it, where somebody outside picks the globe up.',
    },
  ],
  telekinesis: [
    {
      marker: 'saving-throw',
      clause: 'The target must succeed on a Strength saving throw, or you move it up to 30 feet',
      why: 'an-activation-that-forces-a-saving-throw',
      note: 'every exertion this spell makes, at the casting and on each later turn, is a Magic action that forces a save; a registered SpellActivation resolves an attack or moves an area, and neither is this. The object half prints the same sentence again.',
    },
    {
      marker: 'condition',
      clause: 'the creature has the Restrained condition',
      why: 'an-activation-that-forces-a-saving-throw',
      note: 'Restrained until the end of the caster’s next turn is a condition and a caster-anchored deadline the engine writes easily; what it hangs on is the failed save of an exertion that cannot be run, so there is nothing to impose it.',
    },
  ],
  resurrection: [
    {
      marker: 'hit-points',
      clause: 'The creature returns to life with all its Hit Points',
      why: 'healing-that-raises-the-dead',
      note: 'the hit points are ordinary and the raising is not: healCreature refuses a creature that is dead, and the refusal costs no slot, so hit points alone will not bring anybody back however many of them there are.',
    },
    {
      marker: 'roll-mode',
      clause: 'you have Disadvantage on D20 Tests',
      why: 'a-selector-for-every-d20-test',
      note: 'there is deliberately no RollModifier member for D20 Tests as a family, and three SRD spells write the phrase; the toll on the caster and the target’s own minus four both need it, and the second needs a deadline anchored to a rest as well.',
    },
  ],
  command: [
    {
      marker: 'saving-throw',
      clause: 'follow the command on its next turn',
      why: 'an-action-a-spell-compels-or-forbids',
      note: 'the Wisdom save is ordinary and what it gates is a creature’s whole next turn spent doing what somebody else said. The action economy is the engine’s and the only lever a spell has on it is a condition the engine names, so the save would decide nothing that could be applied.',
    },
    {
      marker: 'condition',
      clause: 'The target has the Prone condition and then ends its turn',
      why: 'an-action-a-spell-compels-or-forbids',
      note: 'the Prone half is an ordinary `condition` effect; the clause beside it that ends the creature’s turn is not, and a definition that wrote only the condition would be half a sentence — which is the whole reason all five options are the table’s together.',
    },
  ],
  'gust-of-wind': [
    {
      marker: 'saving-throw',
      clause: 'be pushed 15 feet away from you in a direction following the Line',
      why: 'forced-movement-a-spell-causes',
      note: 'the Strength save is ordinary and the shove is not: `moveCreature` already takes `forced: true` and reports whose space is being shared, and no spell effect reaches it — so the save would gate a push nothing can perform.',
    },
    {
      marker: 'movement-cost',
      clause: 'must spend 2 feet of movement for every 1 foot it moves when moving closer to you',
      why: 'difficult-terrain-an-area-creates',
      note: 'a doubled cost to walk into the wind is Difficult Terrain by another name, and Difficult Terrain is charged exactly — declared by the foot on the move that crosses it. No area declares any, so there is nowhere for the wind to make the ground cost double.',
    },
    {
      marker: 'chance',
      clause: 'has a 50 percent chance to extinguish them',
      why: 'a-random-outcome-that-is-not-a-d20',
      note: 'the generator throws any notation `parseNotation` reads and no spell effect asks it for one that is not a D20 Test, so a coin flip over a lantern has nothing to ask and nowhere for the answer to be read.',
    },
  ],
  'freedom-of-movement': [
    {
      marker: 'speed',
      clause: "can neither reduce the target's Speed",
      why: 'an-effect-that-suppresses-other-magic',
      note: '`speedOf` reads every grant a source hung and has no notion of a creature that refuses one, so this half is an effect stopping another effect from landing — the suppression shape read from the target’s side rather than from an area’s.',
    },
    {
      // The same sentence again, and **the marker is the sentence's rather
      // than the clause's**: SRD writes the Speed and the two conditions in
      // one breath, and `condition` does not fire on "conditions" — the
      // pattern needs a word boundary the plural does not give it. So the
      // second half of a sentence the Speed made a claim is filed under the
      // marker that made it one.
      marker: 'speed',
      clause: 'nor cause the target to have the Paralyzed or Restrained conditions',
      why: 'a-condition-immunity-narrowed-to-its-source',
      note: 'the subject is "spells and other magical effects", so a Ghoul’s Paralyzed still lands and a Hold Person’s does not. `conditionImmunitiesOf` answers about a condition and knows nothing of what is causing it, which is the narrower residue rather than the grant that was built.',
    },
    {
      marker: 'speed',
      clause: 'a Swim Speed equal to its Speed',
      why: 'movement-modes',
      note: 'Fly, Climb and Swim have no reader — no rule in the engine asks about one — so a vocabulary for them would be shape built ahead of every mechanic that could use it.',
    },
    {
      marker: 'movement-cost',
      clause: 'spend 5 feet of movement to automatically escape from nonmagical restraints',
      why: 'an-activation-taken-by-somebody-other-than-the-caster',
      note: 'a later action through the spell, taken by the target rather than by the caster — and `SpellActivation` pins the caster because nobody else may act through a casting, which is exactly the rule this sentence inverts.',
    },
    {
      marker: 'condition',
      clause: 'a creature imposing the Grappled condition on it',
      why: 'an-activation-taken-by-somebody-other-than-the-caster',
      note: 'the Grappled condition is what the escape is *from*, and the engine ends one readily; what it cannot do is let the target spend its own movement through somebody else’s casting to do it. Same sentence as the five feet above, and the marker the other half of it trips.',
    },
  ],
  'wall-of-fire': [
    {
      marker: 'saving-throw',
      clause: 'each creature in its area makes a Dexterity saving throw, taking 5d8 Fire damage',
      why: 'a-wall-or-several-templates-in-one-area',
      note: 'a typed `save-damage` effect with the ordinary half-on-a-success branch, and nowhere for it to happen: `SpellArea` has six shapes and none of them is a wall, so the save is blocked on the geometry rather than on anything about saving throws.',
    },
    {
      marker: 'dice',
      clause: 'deals 5d8 Fire damage to each creature that ends its turn within 10 feet of that side',
      why: 'damage-with-neither-an-attack-roll-nor-a-save',
      note: 'damage that lands with no attack roll and no saving throw at all, on a turn boundary `AreaTrigger` can already name. Every damage-bearing effect kind the format has hangs off a roll, so this one has nothing to be written as even once the wall exists.',
    },
  ],
  aid: [
    {
      marker: 'hit-points',
      clause: "Each target's Hit Point maximum and current Hit Points increase by 5",
      why: 'a-hit-point-maximum-a-spell-moves',
      note: 'the five hit points are ordinary and the maximum is not: `vitals.ts` raises a current total and caps it at the maximum, and nothing moves the maximum itself for a span and then moves it back when the span runs out.',
    },
  ],
  barkskin: [
    {
      marker: 'armor-class',
      clause: 'the target has an Armor Class of 17 if its AC is lower than that',
      why: 'an-armor-class-a-spell-floors',
      note: 'a floor rather than a calculation: the `armor-class` effect supplies a base the engine then picks between, and 17 written that way would either beat a plate-armoured 18 down or be discarded, depending which way the comparison ran. Neither is the sentence.',
    },
  ],
  'death-ward': [
    {
      marker: 'hit-points',
      clause: 'the target instead drops to 1 Hit Point',
      why: 'an-effect-that-intercepts-dropping-to-0',
      note: 'the hit point is nothing and the interception is the whole spell: dropping to 0 is an engine-owned batch performed inside the operation that applies the damage, and there is no seam in it for an effect to say "stop at 1 instead".',
    },
  ],
  'enhance-ability': [
    {
      marker: 'roll-mode',
      clause: 'the target has Advantage on ability checks using the chosen ability',
      why: 'a-choice-made-at-the-casting',
      note: 'a `RollModifier` names Advantage on ability checks of a stated ability perfectly well — Contagion’s adjudication says exactly that from the other side — and which of the five this casting chose has nowhere to be recorded.',
    },
  ],
  foresight: [
    {
      marker: 'roll-mode',
      clause: 'the target has Advantage on D20 Tests, and other creatures have Disadvantage on attack rolls against it',
      why: 'a-selector-for-every-d20-test',
      note: 'there is deliberately no `RollModifier` member for D20 Tests as a family, and the second half of the sentence needs something else again — a mode the *attacker* rolls with, granted by a spell cast on the defender.',
    },
  ],
  glibness: [
    {
      marker: 'ability-check',
      clause: 'when you make a Charisma check, you can replace the number you roll with a 15',
      why: 'a-roll-result-an-effect-replaces',
      note: 'a substitution rather than a modifier, taken after the die is seen: `interveneAfterRoll` reaches a roll that has happened and adds to it, and nothing throws the result away in favour of a printed number.',
    },
  ],
  'major-image': [
    {
      marker: 'ability-check',
      clause: 'determine that it is an illusion with a successful Intelligence (Investigation) check',
      why: 'engine',
      note: 'Silent Image’s sentence two levels up, and the same answer: the Intelligence (Investigation) check against the spell save DC is rolled by resolveEffectCheck against a Concentration casting timer that ends with the Concentration.',
    },
  ],
  'meld-into-stone': [
    {
      marker: 'movement-cost',
      clause: 'You can use 5 feet of movement to leave the stone where you entered it',
      why: 'a-world-fact-nothing-can-represent',
      note: 'the five feet are spendable and what they buy is stepping out of a stone, which is a state the world model has no room for — the same place Tree Stride’s five feet hang from, so the step they pay for has no representation to cost anything.',
    },
    {
      marker: 'dice',
      clause: 'expels you and deals 6d6 Force damage to you',
      why: 'a-world-fact-nothing-can-represent',
      note: 'the dice are ordinary and being expelled is not: the damage is a consequence of having been inside the stone, and the sentence after it deals a flat 50 for the same reason.',
    },
    {
      marker: 'condition',
      clause: 'you move into an unoccupied space closest to where you first entered and have the Prone condition',
      why: 'a-world-fact-nothing-can-represent',
      note: 'placing a creature in the nearest unoccupied space and applying Prone are both ordinary; what is missing is the expulsion they follow from, which is the state this whole paragraph hangs on.',
    },
  ],
  'mirror-image': [
    {
      marker: 'condition',
      clause: 'if it has the Blinded condition, Blindsight, or Truesight',
      why: 'senses-beyond-declared-sight',
      note: 'whether the spell applies at all is decided by what the *attacker* can perceive. Sight here is a pairwise declaration and Blindsight and Truesight are senses no rule reads off an attacker, so the exception has nothing to consult.',
    },
  ],
  seeming: [
    {
      marker: 'saving-throw',
      clause: 'An unwilling target can make a Charisma saving throw',
      why: 'table',
      note: 'what the save refuses is an appearance, and nothing mechanical follows from being disguised — the engine’s resolution path never arrives at what a creature looks like, which is Disguise Self’s reading over a crowd.',
    },
    {
      marker: 'ability-check',
      clause: 'make an Intelligence (Investigation) check against your spell save DC',
      why: 'engine',
      note: 'the Intelligence (Investigation) check against the spell save DC is rolled by resolveEffectCheck against the casting’s own timer, which the eight hours give it; the table decides only that somebody looked closely.',
    },
  ],
  shapechange: [
    {
      marker: 'hit-points',
      clause: 'you gain a number of Temporary Hit Points equal to the Hit Points of the first form',
      why: 'a-creature-fact-an-effect-overrides',
      note: 'the amount is read off a second creature’s sheet, and the engine holds one sheet per creature with no way to lend another. Their vanishing at the end of the spell is the same absence read from the other end.',
    },
    {
      marker: 'hit-points',
      clause: 'Your game statistics are replaced by the stat block of the chosen form',
      why: 'a-creature-fact-an-effect-overrides',
      note: 'the sentence that says so outright, with the long list of what survives it. A sheet is a fact the engine holds authoritatively and reads for every roll it makes, and nothing writes over one for a duration.',
    },
  ],
  'sleet-storm': [
    {
      marker: 'saving-throw',
      clause: 'it must succeed on a Dexterity saving throw or have the Prone condition and lose Concentration',
      why: 'an-outcome-that-breaks-concentration',
      note: 'the Cylinder is a shape the engine has and both trigger moments are `AreaTrigger` members by name, so all of this is expressible except the last three words — and writing the save without them would drop half of what a failure costs.',
    },
    {
      marker: 'condition',
      clause: 'have the Prone condition and lose Concentration',
      why: 'an-outcome-that-breaks-concentration',
      note: 'the Prone half is an ordinary condition rider and is welded to the half that is not: one failed save imposes both, and no outcome of a saving throw asks for somebody’s Concentration to break.',
    },
  ],
  'spike-growth': [
    {
      marker: 'dice',
      clause: 'it takes 2d4 Piercing damage for every 5 feet it travels',
      why: 'a-distance-a-creature-travels-inside-an-area',
      note: 'the dice are multiplied by a distance travelled **inside** the area, and a move is charged by the foot without anybody asking which of those feet were where — so there is no number for the dice to be multiplied by.',
    },
    {
      marker: 'ability-check',
      clause: 'succeed on a Wisdom (Perception or Survival) check against your spell save DC',
      why: 'a-check-another-creature-may-attempt',
      note: 'the check belongs to a creature that is about to walk in rather than to one the casting caught, and who may attempt a check is derived from what its timer sits on — an effect on a creature is that creature’s, a casting with no victim is anybody’s, and this is neither.',
    },
  ],
  'warding-bond': [
    {
      marker: 'armor-class',
      clause: 'a +1 bonus to AC',
      why: 'a-standing-effect-derived-from-where-a-creature-stands',
      note: 'the bonus is ordinary and the fence around it is not: it holds only "While the target is within 60 feet of you", which is a distance between two creatures that changes on every move and that nothing re-reads a grant against.',
    },
    {
      marker: 'saving-throw',
      clause: 'bonus to AC and saving throws',
      why: 'a-standing-effect-derived-from-where-a-creature-stands',
      note: 'the same grant reaching the other family of rolls, inside the same sixty feet — one sentence, three benefits, and one absence underneath all of them.',
    },
    {
      marker: 'defence',
      clause: 'it has Resistance to all damage',
      why: 'a-standing-effect-derived-from-where-a-creature-stands',
      note: 'Resistance to every damage type is a defence `defensesOf` applies readily; what it cannot do is hold it only while the two creatures are close enough, and drop it the moment either of them walks away.',
    },
    {
      marker: 'hit-points',
      clause: 'The spell ends if you drop to 0 Hit Points',
      why: 'a-casting-ended-by-a-trigger',
      note: 'dropping to 0 Hit Points is one of the causes that shape names as still missing, and the clause beside it — the two creatures drifting more than sixty feet apart — is another of them in the same sentence.',
    },
  ],
  'heat-metal': [
    {
      marker: 'dice',
      clause: 'takes 2d8 Fire damage when you cast the spell',
      why: 'damage-with-neither-an-attack-roll-nor-a-save',
      note: 'the dice land on whoever is in physical contact with a glowing object, with neither an attack roll nor a saving throw between them \u2014 and every damage-bearing effect kind the format has hangs off one of the two.',
    },
    {
      marker: 'saving-throw',
      clause: 'the creature must succeed on a Constitution saving throw or drop the object if it can',
      why: 'what-a-creature-is-holding',
      note: '`inventory` and `equipped` are real and only armour and weapons have a slot, so what is in a creature\u2019s hands is not a fact the engine keeps and a rule that makes it let go has nothing to call.',
    },
    {
      marker: 'roll-mode',
      clause: 'it has Disadvantage on attack rolls and ability checks until the start of your next turn',
      why: 'what-a-creature-is-holding',
      note: 'the mode and the deadline are both ordinary; what they hang on is a creature choosing to keep hold of an object the engine does not know it is holding.',
    },
  ],
  'flaming-sphere': [
    {
      marker: 'saving-throw',
      clause: 'Any creature that ends its turn within 5 feet of the sphere makes a Dexterity saving throw',
      why: 'an-area-trigger-measured-from-a-point',
      note: 'the turn boundary is one `AreaTrigger` already names and the geometry is not: five feet measured from a point the casting holds, rather than an area the casting placed \u2014 and the point moves on a Bonus Action besides.',
    },
    {
      marker: 'dice',
      clause: 'taking 2d6 Fire damage on a failed save',
      why: 'an-area-trigger-measured-from-a-point',
      note: 'an ordinary save for half with ordinary slot scaling, waiting on the trigger above it to have somewhere to fire from.',
    },
  ],
  'ray-of-enfeeblement': [
    {
      marker: 'saving-throw',
      clause: 'The target must make a Constitution saving throw',
      why: 'a-success-branch-that-does-something',
      note: 'the save is a fork rather than a gate: succeeding at it costs the target something, and `onSuccess` releases an effect or does nothing at all \u2014 there is nowhere to put an outcome on the branch that normally buys a creature its freedom.',
    },
    {
      marker: 'roll-mode',
      clause: 'the target has Disadvantage on the next attack roll it makes until the start of your next turn',
      why: 'a-one-shot-roll-modifier',
      note: 'the modifier is consumed by the one roll it changes rather than running to a deadline, and a durable grant runs until its casting ends \u2014 Vicious Mockery prints the same sentence and is adjudicated the same way.',
    },
    {
      marker: 'roll-mode',
      clause: 'Disadvantage on Strength-based D20 Tests for the duration',
      why: 'a-selector-for-every-d20-test',
      note: 'a family of D20 Tests picked out by the ability behind them, and `RollModifier` deliberately carries no selector for D20 Tests as a family.',
    },
    {
      marker: 'dice',
      clause: 'it also subtracts 1d8 from all its damage rolls',
      why: 'a-damage-penalty-a-spell-grants',
      note: 'a rider that takes dice away from a later damage roll; every rider the format has adds, and nothing subtracts from one.',
    },
  ],
  'guardian-of-faith': [
    {
      marker: 'saving-throw',
      clause: 'makes a Dexterity saving throw, taking 20 Radiant damage on a failed save',
      why: 'an-area-trigger-measured-from-a-point',
      note: 'the two moments are `AreaTrigger`\u2019s by name and the flat 20 with half on a success is expressible; the ten feet are measured from a point the casting holds rather than over an area the casting placed.',
    },
  ],
  'faithful-hound': [
    {
      marker: 'saving-throw',
      clause: 'That enemy must succeed on a Dexterity saving throw or take 4d8 Force damage',
      why: 'an-area-trigger-on-the-casters-turn',
      note: 'the bite fires at the start of the **caster\u2019s** turn, and an area trigger reads the turn boundaries of whoever is standing in the area rather than those of the creature who made it.',
    },
    {
      marker: 'dice',
      clause: 'take 4d8 Force damage',
      why: 'an-area-trigger-on-the-casters-turn',
      note: 'the dice are ordinary and wait on the trigger above them; the same sentence, and the other mechanic in it.',
    },
  ],
  'greater-restoration': [
    {
      marker: 'condition',
      clause: '- The Charmed or Petrified condition',
      why: 'a-choice-made-at-the-casting',
      note: '`end-condition` takes a printed list of condition names and would do this line whole; what it cannot be told is that this line is the one of five the casting chose, so writing it would be a spell that always ends those two.',
    },
    {
      marker: 'hit-points',
      clause: "- Any reduction to the target's Hit Point maximum",
      why: 'a-hit-point-maximum-a-spell-moves',
      note: 'nothing reduces a Hit Point maximum for an effect to undo, which is the same absence Aid has from the other direction \u2014 one spell wants to raise a maximum and this one wants to restore one.',
    },
  ],
  'antilife-shell': [],
  forcecage: [
    {
      marker: 'saving-throw',
      clause: 'it must first make a Charisma saving throw',
      why: 'an-effect-that-suppresses-other-magic',
      note: 'the save stands in front of a teleport somebody else is casting, and a casting is not offered another creature\u2019s magic to refuse \u2014 which is the half of the suppression shape Dispel Magic did not build.',
    },
    {
      marker: 'teleport',
      clause: 'If the creature tries to use teleportation or interplanar travel to leave',
      why: 'an-effect-that-suppresses-other-magic',
      note: 'the teleport the cage is refusing, named in the same sentence. `teleportOf` moves a creature a casting names; nothing reads a casting somebody else is making in order to stop it.',
    },
  ],
  'reverse-gravity': [
    {
      marker: 'saving-throw',
      clause: 'A creature can make a Dexterity saving throw to grab a fixed object it can reach',
      why: 'falling',
      note: 'the save is ordinary and what it avoids is a fall upward; falling is not a rule the engine has at all, so there is nothing for a success to prevent.',
    },
  ],
  sequester: [
    {
      marker: 'condition',
      clause: 'the target has the Invisible condition',
      why: 'an-effect-that-suppresses-other-magic',
      note: 'the Invisible is an ordinary condition welded in one sentence to a refusal of Divination magic and of being detected or viewed remotely, and there is no state in which a casting is being refused by its target.',
    },
    {
      marker: 'condition',
      clause: 'You can set a condition for the spell to end early',
      why: 'a-casting-ended-by-a-trigger',
      note: 'condition here means circumstance rather than any of the fifteen: a cause the caster invents when the slot is spent, which no `CastingEndTrigger` member expresses and no casting records.',
    },
  ],
  'holy-aura': [
    {
      marker: 'saving-throw',
      clause: 'creatures of your choice have Advantage on all saving throws',
      why: 'a-standing-effect-derived-from-where-a-creature-stands',
      note: 'the Advantage is ordinary and the fence is not: it holds only "While in the aura", a 30-foot Emanation that travels with the caster, and no effect derives a modifier from where a creature is standing.',
    },
    {
      marker: 'roll-mode',
      clause: 'other creatures have Disadvantage on attack rolls against them',
      why: 'a-standing-effect-derived-from-where-a-creature-stands',
      note: 'the other half of the same sentence and the same fence, over a mode the attacker rolls with rather than the protected creature.',
    },
    {
      marker: 'condition',
      clause: 'the attacker must succeed on a Constitution saving throw or have the Blinded condition',
      why: 'a-spell-that-answers-a-later-attack',
      note: 'the Blinded and its deadline are both written easily; what they hang on is a Fiend or an Undead having just hit somebody, which is an attack the casting is offered no window on.',
    },
  ],
  'mass-heal': [
    {
      marker: 'hit-points',
      clause: 'You restore up to 700 Hit Points, divided as you choose',
      why: 'a-spells-effects-applied-to-different-targets',
      note: 'a flat amount with no dice is expressible now; splitting it across the creatures one casting caught is not, and a casting applies its effects to all of its targets alike \u2014 so writing it would heal everybody in range for seven hundred.',
    },
  ],
  resistance: [
    {
      marker: 'dice',
      clause: 'the creature reduces the total damage taken by 1d4',
      why: 'a-reduction-an-effect-applies-to-damage',
      note: 'the die is ordinary and the subtraction is not: the damage pipeline adjusts a total, halves it for Resistance and doubles it for Vulnerability, and has no step that takes a roll off one. Not the defence of the same name — this cantrip and `defensesOf` are different arithmetic wearing one word.',
    },
  ],
  shillelagh: [
    {
      marker: 'dice',
      clause: 'The damage die changes when you reach levels 5 (d10)',
      why: 'a-rider-on-a-later-weapon-attack',
      note: 'the die being changed belongs to a weapon rather than to the spell, and every later swing with that weapon would have to read it. A casting hangs no notation on a weapon, which is the same absence the substituted ability in the sentence above has.',
    },
  ],
  'true-strike': [
    {
      marker: 'dice',
      clause: 'when you reach levels 5 (1d6), 11 (2d6), and 17 (3d6)',
      why: 'a-rider-on-a-later-weapon-attack',
      note: 'the cantrip upgrade adds dice to a weapon attack the casting itself is supposed to make, and a casting reaches `resolveAttack` through no door at all — an attack command is how a swing happens.',
    },
    {
      marker: 'extra-damage',
      clause: 'the attack deals extra Radiant damage',
      why: 'a-rider-on-a-later-weapon-attack',
      note: 'extra damage of a stated type on somebody’s weapon swing is the attack-rider grant, which hangs a notation and a damage type together and which no spell definition can write. The same sentence, and the other mechanic in it.',
    },
  ],
  goodberry: [
    {
      marker: 'hit-points',
      clause: 'Eating a berry restores 1 Hit Point',
      why: 'what-a-creature-is-holding',
      note: 'the hit point is arithmetic `healCreature` does all day; what has no representation is the berry. An inventory and an equipped set are held and only armour and weapons have a slot, so ten berries in a hand are nowhere and nothing can be eaten out of them.',
    },
  ],
  'ice-knife': [
    {
      marker: 'dice',
      clause: 'the target takes 1d10 Piercing damage',
      why: 'a-second-roll-sequenced-after-the-first',
      note: 'an ordinary ranged spell attack, and the smaller half of the spell: writing it alone would deal under half the printed damage at every slot level, which is the reading Scorching Ray got for the same reason from the other side.',
    },
    {
      marker: 'saving-throw',
      clause: 'must succeed on a Dexterity saving throw or take 2d6 Cold damage',
      why: 'a-second-roll-sequenced-after-the-first',
      note: 'the burst follows the attack hit or miss, over a Sphere centred on wherever the shard arrived — a second roll sequenced after the first, against a point the casting does not hold.',
    },
  ],
  sanctuary: [
    {
      marker: 'saving-throw',
      clause: 'must succeed on a Wisdom saving throw or either choose a new target or lose the attack or spell',
      why: 'a-spell-that-answers-a-later-attack',
      note: 'the save belongs to whoever attacks the warded creature, so the spell has to be offered a window on somebody else’s attack. There is none: the reaction windows a casting answers are the caster’s own, and Shield and Mirror Image wait on the same absence.',
    },
  ],
  sleep: [
    {
      marker: 'saving-throw',
      clause: 'must succeed on a Wisdom saving throw or have the Incapacitated condition',
      why: 'a-repeat-save-that-does-something-on-a-failure',
      note: 'the first save is ordinary and the repeat it schedules is not: the condition lasts until the end of the target’s next turn "at which point it must repeat the save", and a failure there deepens the effect where `RepeatSave` only ever releases one on a success.',
    },
    {
      marker: 'condition',
      clause: 'the target has the Unconscious condition for the duration',
      why: 'a-repeat-save-that-does-something-on-a-failure',
      note: 'the Unconscious is an ordinary condition with an ordinary duration, and what puts it there is the failure branch of the repeat above. Nothing writes that branch, so there is no moment at which this sentence could fire.',
    },
    {
      marker: 'defence',
      clause: 'have Immunity to the Exhaustion condition automatically succeed on saves against this spell',
      why: 'an-outcome-that-reads-the-targets-defences',
      note: 'creatures that do not sleep, and creatures immune to Exhaustion, succeed without rolling. `checks.ts` carries an automatic **failure** and no automatic success, and the condition immunity that decides it is read off the target rather than stated by the spell.',
    },
  ],
  'faerie-fire': [
    {
      marker: 'saving-throw',
      clause: 'Each creature in the Cube is also outlined if it fails a Dexterity saving throw',
      why: 'a-condition-benefit-an-effect-takes-away',
      note: 'the save is ordinary and what failing it buys is a subtraction rather than a condition: the creature loses the benefit of one it may already have. A `save` effect with no condition to impose would be a die thrown to record nothing.',
    },
    {
      marker: 'condition',
      clause: "can't benefit from the Invisible condition",
      why: 'a-condition-benefit-an-effect-takes-away',
      note: 'the other end of the same sentence. `conditionApplicability` grants the Invisible condition its effects wholesale and nothing narrows them for one creature, so there is no state in which a creature has the condition and not its benefit.',
    },
  ],
  'animal-messenger': [
    {
      marker: 'saving-throw',
      clause: 'must succeed on a Charisma saving throw',
      why: 'a-target-rule-the-format-cannot-state',
      note: 'the save is decided before it is rolled by the parenthesis beside it — "if the target’s Challenge Rating isn’t 0, it automatically succeeds" — and a Challenge Rating is not a fact any target rule can ask for, any more than the Tiny that picks the Beast is. What a failure buys is an errand across the countryside, which is the DM’s.',
    },
  ],
  polymorph: [
    {
      marker: 'saving-throw',
      clause: 'shape-shift into a Beast form for the duration',
      why: 'a-creature-fact-an-effect-overrides',
      note: 'the Wisdom save is ordinary and what it gates is a creature’s whole sheet. A sheet is a fact the engine holds authoritatively and reads for every roll it makes, and nothing lets an effect write over one for a duration.',
    },
    {
      marker: 'hit-points',
      clause: "The target's game statistics are replaced by the stat block of the chosen Beast",
      why: 'a-creature-fact-an-effect-overrides',
      note: 'the sentence that says so outright, with the list of what survives it — alignment, personality, creature type, Hit Points and Hit Point Dice. Every number this spell needs comes off a second creature’s sheet, and a creature has one.',
    },
    {
      marker: 'hit-points',
      clause: 'The spell ends early on the target if it has no Temporary Hit Points left',
      why: 'a-casting-ended-by-a-trigger',
      note: 'a Temporary Hit Point total running out is one of the causes that shape names this spell for by name: the five transcribed causes are the target attacking, dealing damage, casting, donning armour, and the caster or an ally damaging it, and this is none of them.',
    },
  ],
  'zone-of-truth': [
    {
      marker: 'saving-throw',
      clause:
        "a creature that enters the spell's area for the first time on a turn or starts its turn there makes a Charisma saving throw",
      why: 'a-standing-effect-derived-from-where-a-creature-stands',
      note: 'both moments are `AreaTrigger` members and the save itself is ordinary; what a failure buys is not. "On a failed save, a creature can’t speak a deliberate lie while in the radius" is a silence that holds for as long as the creature is in the Sphere and lifts when it steps out — a standing effect derived from where it is standing, with no condition and no state to carry it. A trigger that rolled the save and imposed nothing would be dice thrown for no reason.',
    },
  ],
  teleport: [
    {
      marker: 'dice',
      clause: 'The GM rolls 1d100 and consults the Teleportation Outcome table',
      why: 'a-random-outcome-that-is-not-a-d20',
      note: 'the generator throws any notation parseNotation reads and no SpellEffect asks it for one, so a d100 indexing a table of familiarity bands has nothing to ask and nowhere for the answer to be consulted — and the three mishaps below it are outcomes of that same roll.',
    },
    {
      marker: 'teleport',
      clause: '**Teleportation Outcome**',
      why: 'a-random-outcome-that-is-not-a-d20',
      note: 'the table’s own heading, which the splitter returns as a unit because it ends a line. It names the mechanism above rather than adding one, and it is here because every unit that trips a marker is answered.',
    },
  ],
  // — the second pass over the undefined population ———————————————————————
  //
  // Every entry below was a `BLOCKED_ON` entry until its definition landed,
  // which is the three-part move that file describes: the line comes out of
  // the undefined map, the debt arrives here, and the shape stays claimed by
  // whoever still needs it. Where the undefined entry already anchored a
  // clause, the phrase and the reasoning are the same phrase and the same
  // reasoning — a re-worded note would be a second reading of a paragraph
  // somebody had already read.
  thaumaturgy: [
    {
      marker: 'roll-mode',
      clause: 'Advantage on Charisma (Intimidation) checks',
      why: 'a-choice-made-at-the-casting',
      note: 'the mode is ordinary — a RollModifier selects a Charisma check and grants Advantage — and it belongs to one of six branches picked at the table. A definition’s effects run on every casting, so granting it here would intimidate every time the caster flickered a candle.',
    },
  ],
  'protection-from-evil-and-good': [
    {
      marker: 'roll-mode',
      clause: 'Creatures of those types have Disadvantage on attack rolls',
      why: 'a-filter-on-the-attackers-creature-type',
      note: 'the clause docs/design/rolls-and-damage.md names verbatim with this spell among its consumers: every other creature-type rule in the book is about the target, and a RollSelector has no axis for the type at the attacking end.',
    },
    {
      marker: 'saving-throw',
      clause: 'Advantage on any new saving throw against the relevant effect',
      why: 'a-mode-on-the-save-a-spell-forces',
      note: 'nothing records what a save was against, so "the relevant effect" cannot be selected for. The same sentence that blocks Countercharm, arriving on the save rather than on the attack.',
    },
  ],
  'unseen-servant': [
    {
      marker: 'armor-class',
      clause: 'It has AC 10, 1 Hit Point, and a Strength of 2',
      why: 'a-stat-block-created-mid-fight',
      note: 'an Armour Class, a Hit Point total and an ability score — a stat block in one sentence, and the inability to attack that closes it is that same stat block printing no attack rather than a rider on the action economy.',
    },
    {
      marker: 'hit-points',
      clause: 'If it drops to 0 Hit Points, the spell ends',
      why: 'a-casting-ended-by-a-trigger',
      note: 'dropping to 0 Hit Points is named in that shape’s own description as a cause with no member, and here it ends the casting rather than merely removing the creature — which is what the two summons that print the same sentence do not say.',
    },
  ],
  'alter-self': [
    {
      marker: 'dice',
      clause: 'it deals 1d6 damage of the type in parentheses',
      why: 'a-rider-on-a-later-weapon-attack',
      note: 'the notation is ordinary and what it rides is not: an Unarmed Strike made on some later turn, whose damage this replaces rather than adds to, and whose attack and damage rolls change ability besides.',
    },
    {
      marker: 'speed',
      clause: 'gain a Swim Speed equal to your Speed',
      why: 'movement-modes',
      note: 'Fly, Climb and Swim have no reader — no rule in the engine asks about one — so a Swim Speed would be a number nothing consults, and the spell-definition vocabulary refuses the field by name for exactly that reason.',
    },
  ],
  augury: [
    {
      marker: 'chance',
      clause: 'cumulative 25 percent chance for each casting after the first',
      why: 'a-random-outcome-that-is-not-a-d20',
      note: 'a percentage is a die the generator can throw and no SpellEffect asks for one; and the count it is cumulative over runs back to a Long Rest, which nothing counts castings against either.',
    },
  ],
  'dragons-breath': [
    {
      marker: 'saving-throw',
      clause: 'Each creature in that area makes a Dexterity saving throw',
      why: 'an-activation-that-resolves-an-area',
      note: 'every registered SpellActivation resolves an attack at a named target or moves an area along a stated route, and this one evokes a fresh 15-foot Cone in a direction chosen when the action is taken.',
    },
    {
      marker: 'dice',
      clause: 'taking 3d6 damage of the chosen type on a failed save',
      why: 'an-activation-taken-by-somebody-other-than-the-caster',
      note: 'the dice and the halving are ordinary; who throws them is not. A spell’s later action is the caster’s and nobody else may act through a casting, and this one hands the action to the creature that was touched.',
    },
  ],
  silence: [
    {
      marker: 'defence',
      clause: 'has Immunity to Thunder damage',
      why: 'a-standing-effect-derived-from-where-a-creature-stands',
      note: 'an Immunity is a standing grant hung on a creature, and this one belongs to whoever is entirely inside the Sphere at the instant the Thunder lands — a value derived from current state and current geometry rather than from a pair of enter-and-leave events.',
    },
    {
      marker: 'condition',
      clause: 'creatures have the Deafened condition while entirely inside it',
      why: 'a-condition-that-ends-when-its-holder-leaves-an-area',
      note: 'docs/design/space-and-areas.md says it outright of Web’s Restrained: a condition that ends when its holder walks out of an area has no shape here at all, and this is the second spell printing it.',
    },
  ],
  blink: [
    {
      marker: 'dice',
      clause: 'Roll 1d6 at the end of each of your turns',
      why: 'a-random-outcome-that-is-not-a-d20',
      note: 'the generator throws any notation parseNotation reads and no SpellEffect asks it for one; a payout at a turn boundary hands over hit points and cannot branch on the face a die showed.',
    },
  ],
  'phantom-steed': [
    {
      marker: 'speed',
      clause: 'it has a Speed of 100 feet',
      why: 'a-stat-block-created-mid-fight',
      note: 'the Speed is an override on a stat block out of the monster list, and the thing it overrides is a creature no casting can put in the scene — so the number has nobody to belong to.',
    },
  ],
  'plant-growth': [
    {
      marker: 'movement-cost',
      clause: 'must spend 4 feet of movement for every 1 foot it moves',
      why: 'difficult-terrain-an-area-creates',
      note: 'Difficult Terrain is charged exactly and declared by the foot on the move that crosses it, and deriving it from a spell’s area needs the path a move does not record. Four feet per foot is twice the printed rate besides, which nothing expresses either.',
    },
  ],
  revivify: [
    {
      marker: 'hit-points',
      clause: 'That creature revives with 1 Hit Point',
      why: 'healing-that-raises-the-dead',
      note: 'not a heal of one: healCreature refuses a corpse and the refusal costs no slot, which is the rule docs/design/spell-definitions.md states this shape has to get past. Lifting death is not hit points with a small number in them.',
    },
  ],
  'wind-wall': [
    {
      marker: 'saving-throw',
      clause: 'each creature in its area makes a Strength saving throw',
      why: 'a-wall-or-several-templates-in-one-area',
      note: 'the save is ordinary and the area is not: "up to 50 feet long, 15 feet high, and 1 foot thick" shaped along a continuous path is a wall, and a casting holds one of six templates.',
    },
    {
      marker: 'dice',
      clause: 'taking 4d8 Bludgeoning damage on a failed save',
      why: 'a-wall-or-several-templates-in-one-area',
      note: 'half as much on a success is the save-damage kind exactly, and it has nowhere to be resolved until the wall it is resolved over can be described.',
    },
  ],
  divination: [
    {
      marker: 'chance',
      clause: 'there is a cumulative 25 percent chance for each casting after the first',
      why: 'a-random-outcome-that-is-not-a-d20',
      note: 'Augury’s sentence on a bigger slot: a percentage is a die the generator can throw and no effect asks for one, and what it is cumulative over is a count of castings back to a Long Rest that nothing keeps.',
    },
  ],
  'secret-chest': [
    {
      marker: 'chance',
      clause: 'there is a cumulative 5 percent chance at the end of each day',
      why: 'a-random-outcome-that-is-not-a-d20',
      note: 'the only way this casting ends on its own, thrown once a day after the sixtieth — so the die that is not a d20 is also the deadline, which is why the spell prints "Until dispelled" and schedules nothing.',
    },
  ],
  'aura-of-life': [
    {
      marker: 'defence',
      clause: 'you and your allies have Resistance to Necrotic damage',
      why: 'a-standing-effect-derived-from-where-a-creature-stands',
      note: 'the Resistance belongs to whoever is inside the Emanation at the instant the Necrotic lands, which is current state and current geometry rather than a pair of enter-and-leave events that have to stay matched.',
    },
    {
      marker: 'hit-points',
      clause: "your Hit Point maximums can't be reduced",
      why: 'a-hit-point-maximum-a-spell-moves',
      note: 'a maximum is set when a creature is added and by advancement and no effect moves one, so there is nothing for a rule forbidding the reduction to stand in front of.',
    },
    {
      marker: 'hit-points',
      clause: 'If an ally with 0 Hit Points starts its turn in the aura, that ally regains 1 Hit Point',
      why: 'an-outcome-that-reads-the-targets-hit-points',
      note: 'the fourth spell in that shape’s own reading, and the one the hand count had missed: a payout at a turn boundary hands over what it was told to and cannot first ask what the recipient’s Hit Points are.',
    },
  ],
  'wall-of-stone': [
    {
      marker: 'saving-throw',
      clause: 'that creature can make a Dexterity saving throw',
      why: 'a-wall-or-several-templates-in-one-area',
      note: 'the save is against being enclosed by the wall, so it is asked of a geometry that does not exist: ten contiguous panels shaped as the caster likes is not one of the six templates a casting may hold.',
    },
    {
      marker: 'speed',
      clause: 'it can use its Reaction to move up to its Speed',
      why: 'an-action-a-spell-compels-or-forbids',
      note: 'a Reaction the spell hands the creature it caught, which is the action economy and which no spell effect reaches; what it would be spent escaping is the enclosure above, and there is nothing to be enclosed by either.',
    },
    {
      marker: 'armor-class',
      clause: 'Each panel has AC 15 and 30 Hit Points per inch of thickness',
      why: 'a-stat-block-created-mid-fight',
      note: 'an Armour Class and a Hit Point total on an object rather than a creature — the thing-with-statistics half of that shape, which docs/design/casting.md files under the same seam.',
    },
    {
      marker: 'defence',
      clause: 'it has Immunity to Poison and Psychic damage',
      why: 'a-stat-block-created-mid-fight',
      note: 'the third line of the same stat block: defences belong to a creature the engine holds, and a panel of stone is not one.',
    },
    {
      marker: 'hit-points',
      clause: 'Reducing a panel to 0 Hit Points destroys it',
      why: 'a-stat-block-created-mid-fight',
      note: 'dropping to 0 is an engine-owned transition for a creature, and this one happens to an object nothing put in the scene; the GM’s discretion about connected panels is the table’s beside it.',
    },
  ],
  'wall-of-ice': [
    {
      marker: 'saving-throw',
      clause: 'makes a Dexterity saving throw, taking 10d6 Cold damage',
      why: 'a-wall-or-several-templates-in-one-area',
      note: 'a dome, a globe, or ten contiguous panels: a choice of walls where a casting holds one fixed template, so the save has no area to be raised over.',
    },
    {
      marker: 'dice',
      clause: 'taking 5d6 Cold damage on a failed save',
      why: 'a-wall-or-several-templates-in-one-area',
      note: 'the sheet of frigid air left where a section was destroyed is a second area created by the first one breaking, and the first one cannot be described.',
    },
    {
      marker: 'armor-class',
      clause: 'It has AC 12 and 30 Hit Points per 10-foot section',
      why: 'a-stat-block-created-mid-fight',
      note: 'an Armour Class and Hit Points on an object rather than a creature, which is the thing-with-statistics half of that shape.',
    },
    {
      marker: 'defence',
      clause: 'Immunity to Cold, Poison, and Psychic damage and Vulnerability to Fire damage',
      why: 'a-stat-block-created-mid-fight',
      note: 'the same stat block’s defences, and the only Vulnerability in the wall family; both belong to a creature the engine holds and this is a sheet of ice.',
    },
    {
      marker: 'hit-points',
      clause: 'Reducing a 10-foot section of wall to 0 Hit Points destroys it',
      why: 'a-stat-block-created-mid-fight',
      note: 'the object dropping to 0 is what creates the sheet of frigid air above, so the second area waits on a transition that happens to a thing nothing put in the scene.',
    },
  ],
  'wall-of-thorns': [
    {
      marker: 'saving-throw',
      clause: 'each creature in its area makes a Dexterity saving throw',
      why: 'a-wall-or-several-templates-in-one-area',
      note: 'sixty feet long by ten high by five thick, or a ring twenty across: a wall and a choice of walls, where a casting holds one fixed template.',
    },
    {
      marker: 'dice',
      clause: 'taking 7d8 Slashing damage on a failed save',
      why: 'a-wall-or-several-templates-in-one-area',
      note: 'the trigger beneath it is Web’s exactly — the first entry on a turn, or ending a turn inside — so what is missing is only the shape it would hang on.',
    },
    {
      marker: 'movement-cost',
      clause: 'it must spend 4 feet of movement',
      why: 'difficult-terrain-an-area-creates',
      note: 'Difficult Terrain is charged exactly and declared by the foot on the move that crosses it; deriving it from an area needs the path a move does not record, and four feet per foot is twice the printed rate besides.',
    },
  ],
  'blade-barrier': [
    {
      marker: 'saving-throw',
      clause: "Any creature in the wall's space makes a Dexterity saving throw",
      why: 'a-wall-or-several-templates-in-one-area',
      note: 'a hundred feet long by twenty high by five thick, or a ring sixty across: a wall and a choice of walls, and a casting holds one template.',
    },
    {
      marker: 'dice',
      clause: 'taking 6d10 Force damage on a failed save',
      why: 'a-wall-or-several-templates-in-one-area',
      note: 'half as much on a success is the save-damage kind exactly, waiting only on an area for it to be resolved over.',
    },
  ],
  'fire-storm': [
    {
      marker: 'saving-throw',
      clause: 'Each creature in the area makes a Dexterity saving throw',
      why: 'a-wall-or-several-templates-in-one-area',
      note: 'the whole of what blocks this spell: "up to ten 10-foot Cubes, which you arrange as you like" is ten templates in one area, and docs/design/spell-definitions.md names this spell while refusing them.',
    },
    {
      marker: 'dice',
      clause: 'taking 7d10 Fire damage on a failed save',
      why: 'a-wall-or-several-templates-in-one-area',
      note: 'save-damage with a halved success, which the engine has resolved since Fireball; the ten Cubes are the only thing between this sentence and being executed.',
    },
  ],
  'meteor-swarm': [
    {
      marker: 'saving-throw',
      clause: 'centered on each of those points makes a Dexterity saving throw',
      why: 'a-wall-or-several-templates-in-one-area',
      note: 'four 40-foot Spheres at four chosen points is four areas in one casting, which docs/design/spell-definitions.md names this spell while refusing.',
    },
    {
      marker: 'dice',
      clause: 'A creature takes 20d6 Fire damage and 20d6 Bludgeoning damage',
      why: 'a-wall-or-several-templates-in-one-area',
      note: 'two damage types from one save is ordinary; what is not is the sentence after it, where a creature caught by two Spheres is affected once — a rule about areas overlapping, with no second area to overlap.',
    },
  ],
  awaken: [
    {
      marker: 'condition',
      clause: 'The awakened target has the Charmed condition for 30 days',
      why: 'a-target-rule-the-format-cannot-state',
      note: 'the condition itself is writable and so is its ending — the caster or an ally dealing damage is one of the five causes IE-032 transcribed — and there is nothing for it to land on, because the target rule selects by an ability score and by being a plant that is not a creature.',
    },
    {
      marker: 'condition',
      clause: 'When that condition ends, the awakened creature chooses its attitude toward you',
      why: 'table',
      note: 'an attitude is not a fact the engine holds and should never be one; what the awakened thing thinks of the caster afterwards is the DM’s, and the sentence trips the marker only by naming the condition above it.',
    },
  ],
  'animate-objects': [
    {
      marker: 'hit-points',
      clause: 'until it is reduced to 0 Hit Points',
      why: 'a-stat-block-created-mid-fight',
      note: 'the Animated Object is a stat block, so the creature whose Hit Points this reads is one no casting can put in the scene; control ending with it is a consequence of a transition that never happens.',
    },
    {
      marker: 'hit-points',
      clause: 'it reverts to its object form, and any remaining damage carries over',
      why: 'a-stat-block-created-mid-fight',
      note: 'damage carrying over from a creature to the object it was is a second statistics-bearing thing behind the first, and neither of them exists here.',
    },
    {
      marker: 'dice',
      clause: 'Slam damage increases by 1d4 (Medium or smaller), 1d6 (Large), or 1d12 (Huge)',
      why: 'a-stat-block-created-mid-fight',
      note: 'an upcast that scales an attack printed in a stat block rather than in the spell, by the size of the object animated — two facts the engine holds for nobody here.',
    },
  ],
  commune: [
    {
      marker: 'chance',
      clause: 'there is a cumulative 25 percent chance for each casting after the first',
      why: 'a-random-outcome-that-is-not-a-d20',
      note: 'Augury and Divination print the identical sentence, and all three want the same two things: a die that is not a d20, and a count of castings running back to a Long Rest that nothing keeps.',
    },
  ],
  'contact-other-plane': [
    {
      marker: 'saving-throw',
      clause: 'make a DC 15 Intelligence saving throw',
      why: 'a-dc-the-caster-does-not-set',
      note: 'every saving throw a spell forces is measured against the casting’s pinned spell save DC, and the asymmetry the audit names is exactly this: SpellCheck.dc may state a printed number and a saving throw has no field for one.',
    },
    {
      marker: 'dice',
      clause: 'you take 6d6 Psychic damage',
      why: 'a-dc-the-caster-does-not-set',
      note: 'ordinary damage on a failed save, waiting on the number the save is made against; the caster is the target besides, which is the one thing here that is not a problem.',
    },
    {
      marker: 'condition',
      clause: 'have the Incapacitated condition until you finish a Long Rest',
      why: 'a-deadline-anchored-to-a-rest',
      note: 'duration.ts has a span of time and a moment in the turn order, and a rest is neither; the clock records when the last one was and no deadline can name it.',
    },
  ],
  'conjure-elemental': [
    {
      marker: 'saving-throw',
      clause: 'you can force that creature to make a Dexterity saving throw',
      why: 'an-area-that-filters-its-catch',
      note: 'the catch is filtered twice — a creature the caster can see, and only while the spirit has nobody Restrained — and an area catches every creature standing in it.',
    },
    {
      marker: 'condition',
      clause: 'the target has the Restrained condition until the spell ends',
      why: 'an-area-that-filters-its-catch',
      note: 'the condition and its lifetime are the most ordinary pair the format carries; what cannot be written is which creatures the trigger above it reaches.',
    },
    {
      marker: 'dice',
      clause: "the target takes 4d8 damage of the spirit's type",
      why: 'a-repeat-save-that-does-something-on-a-failure',
      note: 'the boundary save’s **failure** deals damage, and RepeatSave.onSuccess releases an effect while the failure branch does nothing at all — the clearest printing of that gap in the book.',
    },
  ],
  geas: [
    {
      marker: 'saving-throw',
      clause: 'The target must succeed on a Wisdom saving throw',
      why: 'a-duration-the-slot-changes',
      note: 'the save and the Charmed it imposes are ordinary, and the duration they run for is not: a level 9 slot makes this spell last "until it is ended by one of the spells mentioned above", which is a slot changing what kind of duration the spell has rather than how long it is.',
    },
    {
      marker: 'condition',
      clause: 'or have the Charmed condition for the duration',
      why: 'a-casting-ended-by-a-trigger',
      note: 'the condition is written the way Hold Person writes one, and what makes it worth having is the damage for disobedience below it; Remove Curse, Greater Restoration and Wish ending this spell are one spell ending another, which no cause names.',
    },
    {
      marker: 'dice',
      clause: 'the creature takes 5d10 Psychic damage if it acts in a manner directly counter to your command',
      why: 'a-casting-ended-by-a-trigger',
      note: 'damage fired by a judgement about behaviour, no more than once a day — a trigger the engine cannot see and a tally it does not keep, on the shape that already collects every cause no consequence event holds.',
    },
  ],
  mislead: [
    {
      marker: 'condition',
      clause: 'You gain the Invisible condition',
      why: 'a-casting-ended-by-a-trigger',
      note: 'Invisibility’s three transcribed causes, ending **one effect** of the casting rather than the casting: the double outlives the invisibility, and that shape’s own description names this spell for exactly that residue.',
    },
    {
      marker: 'speed',
      clause: 'you can move the illusory double up to twice your Speed',
      why: 'a-stat-block-created-mid-fight',
      note: 'twice a Speed is arithmetic and the thing being moved is an intangible, invulnerable copy of the caster standing in the scene, which is a thing with a position and no record to hold it.',
    },
  ],
  'planar-binding': [
    {
      marker: 'saving-throw',
      clause: 'the target must succeed on a Charisma saving throw',
      why: 'an-effect-that-suppresses-other-magic',
      note: 'what the save buys is service, which is no state the engine holds, and the sentence beside it reaches into a second casting to extend its duration — one ongoing spell rewriting another’s deadline, which is the same missing state read from the other end.',
    },
  ],
  'raise-dead': [
    {
      marker: 'hit-points',
      clause: 'The creature returns to life with 1 Hit Point',
      why: 'healing-that-raises-the-dead',
      note: 'healCreature refuses a corpse and the refusal costs no slot, which is the rule this shape has to get past; one Hit Point is the number, and coming back is not a heal with a small number in it.',
    },
  ],
  reincarnate: [
    {
      marker: 'dice',
      clause: "Roll 1d10 and consult the table below to determine the body's species",
      why: 'a-random-outcome-that-is-not-a-d20',
      note: 'a die the generator can throw, asked for by nothing, indexing a table of ten species with nowhere for the face to be looked up — and what it selects is a species, which is chosen at creation and rewritten by advancement rather than by a spell.',
    },
  ],
  'teleportation-circle': [
    {
      marker: 'teleport',
      clause: 'sigils that link your location to a permanent teleportation circle of your choice',
      why: 'a-second-place-to-put-a-creature',
      note: 'the teleport effect is built and the far end of this one is a circle somewhere else on the plane; there is one scene, so a spell that moves a creature there has no position to move it to.',
    },
  ],
  forbiddance: [
    {
      marker: 'teleport',
      clause: "creatures can't teleport into the area or use portals",
      why: 'an-effect-that-suppresses-other-magic',
      note: 'an area that refuses a casting aimed into it reads a spell the engine resolves elsewhere, which is the half of that shape PROGRESS.md records as not built: ending a casting exists and suppressing one does not.',
    },
    {
      marker: 'dice',
      clause: 'the creature takes 5d10 Radiant or Necrotic damage',
      why: 'a-creature-type-predicate-an-area-reads',
      note: 'the trigger is Web’s exactly and the damage is ordinary; what the area must do is catch only the creature types chosen at the casting, where designating creatures unaffected is explicit ids rather than a predicate over a type.',
    },
  ],
  'guards-and-wards': [
    {
      marker: 'chance',
      clause: 'there is a 50 percent chance that a creature other than you believes it is going in the opposite direction',
      why: 'a-random-outcome-that-is-not-a-d20',
      note: 'the one number in a building’s worth of fiction, and it is a coin: a die the generator can throw and no effect asks for, deciding something the engine holds no state for either.',
    },
  ],
  'heroes-feast': [
    {
      marker: 'defence',
      clause: 'Resistance to Poison damage',
      why: 'table',
      note: 'the Resistance and the two condition Immunities beside it are grants the engine writes, so no shape blocks them — **who they land on** is what is missing, and it is the table\'s: "Up to twelve creatures can partake of the feast" over the hour it takes to consume, where a casting applies its effects to the targets it was given at the instant it resolved. Filing it under the maximum beside it would tell a reader that building that maximum unblocks a Resistance grant, which it does not.',
    },
    {
      marker: 'hit-points',
      clause: 'it gains the same number of Hit Points',
      why: 'a-hit-point-maximum-a-spell-moves',
      note: 'the hit points follow the maximum, so they have nowhere to go: a maximum is set when a creature is added and by advancement and no effect moves one.',
    },
    {
      marker: 'dice',
      clause: 'Its Hit Point maximum also increases by 2d10',
      why: 'a-hit-point-maximum-a-spell-moves',
      note: 'PROGRESS.md ranks healing that raises the maximum and the audit names Harm’s reduction as the debt from the other direction; this is the same missing writer with the sign reversed.',
    },
  ],
  'irresistible-dance': [
    {
      marker: 'saving-throw',
      clause: 'One creature that you can see within range must make a Wisdom saving throw',
      why: 'a-success-branch-that-does-something',
      note: 'which branch a rider rides is the host’s and never the author’s, and this save costs the target a turn even when it **succeeds** — there is no success-branch slot for that to sit in.',
    },
    {
      marker: 'condition',
      clause: 'the target has the Charmed condition for the duration',
      why: 'a-repeat-save-raised-by-a-trigger',
      note: 'the Charmed is ordinary and the way out of it is not: the target repeats the save by **taking an action**, and the turn hook is the only thing that raises a repeat.',
    },
    {
      marker: 'roll-mode',
      clause: 'has Disadvantage on Dexterity saving throws and attack rolls',
      why: 'an-action-a-spell-compels-or-forbids',
      note: 'the two modes are ordinary riders; they share a sentence with "must use all its movement to dance in place", which is the action economy and which no spell effect reaches.',
    },
  ],
  'control-weather': [
    {
      marker: 'dice',
      clause: 'It takes 1d4 × 10 minutes for the new',
      why: 'a-random-outcome-that-is-not-a-d20',
      note: 'a die outside the D20 pipeline deciding a delay, and the splitter returns this half-sentence as its own unit because the book breaks the line there — the phrase is anchored to what the book actually prints rather than to a tidier version of it.',
    },
    {
      marker: 'condition',
      clause: 'find a current condition on the following tables and change its stage by one',
      why: 'a-random-outcome-that-is-not-a-d20',
      note: 'the word is the weather’s rather than a creature’s, and the stage tables are the DM’s; what the sentence shares with the one above it is the delay nothing schedules, which is why both sit on the same shape.',
    },
  ],
  'power-word-stun': [
    {
      marker: 'hit-points',
      clause: 'If the target has 150 Hit Points or fewer',
      why: 'an-outcome-that-reads-the-targets-hit-points',
      note: 'a threshold on current Hit Points read before anything is rolled; the vitals are there and no effect asks them a question, which is the whole of what stops this spell.',
    },
    {
      marker: 'condition',
      clause: 'it has the Stunned condition',
      why: 'an-outcome-that-reads-the-targets-hit-points',
      note: 'the condition is ordinary and it is one of two branches the threshold above chooses between, so applying it would stun a creature the book leaves standing.',
    },
    {
      marker: 'speed',
      clause: 'its Speed is 0 until the start of your next turn',
      why: 'an-outcome-that-reads-the-targets-hit-points',
      note: 'a Speed set to zero with a rider duration is built exactly; it is the other branch of the same unreadable threshold.',
    },
    {
      marker: 'saving-throw',
      clause: 'The Stunned target makes a Constitution saving throw at the end of each of its turns',
      why: 'an-outcome-that-reads-the-targets-hit-points',
      note: 'a repeat save releasing the condition on a success is Hold Person’s shape, and it waits on the condition above it, which waits on the threshold above that.',
    },
  ],
  'power-word-kill': [
    {
      marker: 'hit-points',
      clause: 'If the target has 100 Hit Points or fewer, it dies',
      why: 'an-outcome-that-reads-the-targets-hit-points',
      note: 'PROGRESS.md ranks the three Power Words under this shape and the reading added a fourth spell to it; the vitals are held and no effect reads one as an input.',
    },
    {
      marker: 'dice',
      clause: 'Otherwise, it takes 12d12 Psychic damage',
      why: 'damage-with-neither-an-attack-roll-nor-a-save',
      note: 'damage a spell simply applies, with no attack roll and no saving throw in front of it — the gap that shape is named for, and the one Magic Missile is blocked on.',
    },
  ],
  'power-word-heal': [
    {
      marker: 'hit-points',
      clause: 'The target regains all its Hit Points',
      why: 'a-flat-amount-with-no-dice',
      note: 'the printed half of that shape is built — Heal’s seventy and its ten per slot level — and this is the residue it named: an amount **derived** rather than printed, here the whole of the target’s maximum.',
    },
    {
      marker: 'condition',
      clause: 'the condition ends',
      why: 'a-flat-amount-with-no-dice',
      note: 'end-condition takes exactly the printed list of five and hangs on the healing above it, so the removal waits on an amount that cannot be stated.',
    },
    {
      marker: 'condition',
      clause: 'If the creature has the Prone condition, it can use its Reaction to stand up',
      why: 'an-action-a-spell-compels-or-forbids',
      note: 'a Reaction the spell hands its target, which is the action economy: no spell effect grants one, and standing up is a move the engine charges rather than an effect it applies.',
    },
  ],
  'time-stop': [
    {
      marker: 'dice',
      clause: 'you take 1d4 + 1 turns in a row',
      why: 'a-turn-a-spell-inserts-into-the-order',
      note: 'two gaps in one clause: a die outside the D20 pipeline, and what it counts — extra turns inserted into an initiative order that is a list of creatures rather than something a spell adds to.',
    },
  ],
  'true-resurrection': [
    {
      marker: 'hit-points',
      clause: 'The creature is revived with all its Hit Points',
      why: 'healing-that-raises-the-dead',
      note: 'healCreature refuses a corpse and the refusal costs no slot; and the amount is derived from the target’s own maximum besides, which is the other residue this spell names.',
    },
  ],
  'ensnaring-strike': [
    {
      marker: 'saving-throw',
      clause: 'grasping vines appear on it, and it makes a Strength saving throw',
      why: 'a-target-rule-the-format-cannot-state',
      note: 'the save is raised against "the target", which is the creature the weapon just hit — a Range of Self with no target list, and the smites reach the same creature only by riding the attack damage rather than by naming it.',
    },
    {
      marker: 'roll-mode',
      clause: 'A Large or larger creature has Advantage on this save',
      why: 'a-target-rule-the-format-cannot-state',
      note: 'an outcome shaped by the target size, which is the second of the three facts that shape names: size is held authoritatively and no effect reads it, so the Advantage a Large creature has cannot be granted.',
    },
    {
      marker: 'condition',
      clause: 'the target has the Restrained condition until the spell ends',
      why: 'a-target-rule-the-format-cannot-state',
      note: 'the condition and its lifetime are both ordinary and land on nobody, because the casting never reached the creature the weapon hit; the blocker is who rather than what.',
    },
    {
      marker: 'dice',
      clause: '1d6 Piercing damage at the start of each of its turns',
      why: 'a-repeat-save-that-does-something-on-a-failure',
      note: 'damage on a turn boundary for as long as a condition holds, which is the shape PROGRESS.md names this very spell for: a repeat save releases an effect on a success and its failure branch does nothing at all.',
    },
    {
      marker: 'ability-check',
      clause: 'Strength (Athletics) check against your spell save DC',
      why: 'a-check-another-creature-may-attempt',
      note: 'the check may be made by the target "or a creature within reach of it", and a casting check is rolled by somebody the casting touched — so the second half of that list has no one to be.',
    },
  ],
  hex: [
    {
      marker: 'dice',
      clause: 'extra 1d6 Necrotic damage',
      why: 'a-rider-on-a-later-weapon-attack',
      note: 'the die joins every attack the caster lands on this target for the hour, where the extra dice a spell hangs belong to the one attack its casting was declared on — Divine Smite settles at the hit and this waits for the next one.',
    },
    {
      marker: 'extra-damage',
      clause: 'whenever you hit it with an attack roll',
      why: 'a-rider-on-a-later-weapon-attack',
      note: 'the trigger half of the same sentence, and the half that makes it a standing rider rather than a settlement: there is no later attack for a finished casting to read.',
    },
    {
      marker: 'roll-mode',
      clause: 'The target has Disadvantage on ability checks made with the chosen ability',
      why: 'a-choice-made-at-the-casting',
      note: 'the ability is chosen when the spell is cast and the modifier selects by it, so the modifier cannot be written until a per-casting choice has somewhere to be recorded — the clause the roll-modifier vocabulary names Hex for by name.',
    },
    {
      marker: 'hit-points',
      clause: 'If the target drops to 0 Hit Points before this spell ends',
      why: 'an-outcome-that-reads-the-targets-hit-points',
      note: 'the curse moves to a new creature when this one falls, and no outcome asks the vitals a question — so the Bonus Action on a later turn that re-curses is never offered.',
    },
  ],
  'find-steed': [
    {
      marker: 'armor-class',
      clause: '10 + 1 per spell level',
      why: 'a-stat-block-created-mid-fight',
      note: 'the SRD prints the Otherworldly Steed stat block inside the spell entry, so the Armour Class is the summoned creature own and scales with the slot that summoned it; a casting adds no creature to a scene.',
    },
    {
      marker: 'hit-points',
      clause: 'The steed disappears if it drops to 0 Hit Points',
      why: 'a-stat-block-created-mid-fight',
      note: 'vitals on a creature the engine cannot make, and a lifecycle hanging off them: the steed leaves when they run out or when its summoner dies, and neither is a casting ending.',
    },
    {
      marker: 'condition',
      clause: 'If you have the Incapacitated condition',
      why: 'a-stat-block-created-mid-fight',
      note: 'the condition is read off the caster and what it changes is the summoned creature place in the initiative order, which is a turn belonging to a creature that is not in the scene.',
    },
    {
      marker: 'speed',
      clause: '60 ft., Fly 60 ft.',
      why: 'a-stat-block-created-mid-fight',
      note: 'a walking Speed and a flying Speed printed in the stat block the spell contains, on the creature that stat block describes and that no casting produces.',
    },
  ],
  'bestow-curse': [
    {
      marker: 'saving-throw',
      clause: 'at the start of each of its turns or be forced to take the Dodge action',
      why: 'a-repeat-save-that-does-something-on-a-failure',
      note: 'a boundary save whose failure spends the action for its holder: the repeat save releases an effect on a success and its failure branch does nothing at all, and the economy is guarded by the conditions the engine names.',
    },
    {
      marker: 'roll-mode',
      clause: 'Disadvantage on attack rolls against you',
      why: 'the-effects-source-as-a-participant',
      note: 'the selector says whether a modifier reaches the roller or the creature rolled against, and the caster of the spell is a third participant it cannot name — the sentence that shape was named for.',
    },
    {
      marker: 'dice',
      clause: 'the target takes an extra 1d8 Necrotic damage',
      why: 'a-rider-on-a-later-weapon-attack',
      note: 'the die is hung on damage the caster deals later rather than on the casting, which is the rider shape; and this one fires on damage from a spell as well as from an attack roll, which is the half the build did not reach.',
    },
    {
      marker: 'extra-damage',
      clause: 'If you deal damage to the target with an attack roll or a spell',
      why: 'a-rider-on-a-later-weapon-attack',
      note: 'the trigger half of the same sentence, and the half that widens it past an attack: a rider selects the attack its casting settled, and there is no selector for damage of any origin.',
    },
  ],
  'call-lightning': [
    {
      marker: 'saving-throw',
      clause: 'Each creature within 5 feet of that point makes a Dexterity saving throw',
      why: 'an-activation-that-resolves-an-area',
      note: 'the save is raised by an activation taken on a later turn that lays a five-foot area at a point chosen then; an activation calls a save on a target and never on a fresh template, so the bolt at the casting cannot be written apart from the ones after it.',
    },
    {
      marker: 'dice',
      clause: 'Under such conditions',
      why: 'a-fact-only-the-table-can-declare',
      note: 'the extra 1d10 is conditioned on the caster being outdoors in a storm, which is a fact about the weather that the engine does not hold and cannot derive from anything it does hold.',
    },
  ],
  'conjure-animals': [
    {
      marker: 'roll-mode',
      clause: 'You have Advantage on Strength saving throws',
      why: 'a-standing-effect-derived-from-where-a-creature-stands',
      note: 'the Advantage holds while the caster is within five feet of the pack, so whether it applies is recomputed from a position every time a roll is made, and only a feature derives a standing effect that way.',
    },
    {
      marker: 'saving-throw',
      clause: 'you can force that creature to make a Dexterity saving throw',
      why: 'an-area-moved-by-the-casters-own-movement',
      note: 'the save is forced on whoever the pack reaches, and the pack may be moved thirty feet whenever the caster moves — a casting pins its template where it was put and has no way to carry one along.',
    },
    {
      marker: 'dice',
      clause: 'the creature takes 3d10 Slashing damage',
      why: 'an-area-moved-by-the-casters-own-movement',
      note: 'the damage hangs off the save above it and goes wherever that goes; the extra 1d10 a slot above 3 buys would scale a number nothing rolls.',
    },
  ],
  'conjure-minor-elementals': [
    {
      marker: 'dice',
      clause: 'an extra 2d8 damage when you hit a creature in the Emanation',
      why: 'a-rider-on-a-later-weapon-attack',
      note: 'the dice ride every attack the caster makes for ten minutes rather than the one attack the casting settled, and whether they apply is decided by where the creature hit was standing at the time.',
    },
    {
      marker: 'extra-damage',
      clause: 'Until the spell ends, any attack you make deals',
      why: 'a-rider-on-a-later-weapon-attack',
      note: 'the standing half of the same sentence: a rider is welded to the casting that wrote it, and this one waits ten minutes for an attack nobody has made yet.',
    },
  ],
  'control-water': [
    {
      marker: 'saving-throw',
      clause: 'it makes a Strength saving throw',
      why: 'an-activation-that-resolves-an-area',
      note: 'the save belongs to the whirlpool, which is one of four effects the caster switches between as a Magic action on later turns; an activation calls a save on a target rather than standing up a template that then catches people.',
    },
    {
      marker: 'dice',
      clause: 'the creature takes 2d8 Bludgeoning damage',
      why: 'an-activation-that-resolves-an-area',
      note: 'the damage hangs off that save and goes with it, and half as much on a success goes with both.',
    },
    {
      marker: 'ability-check',
      clause: 'succeeds on a Strength (Athletics) check against your spell save DC',
      why: 'an-activation-that-resolves-an-area',
      note: 'a check against the spell save DC is executed elsewhere in this catalogue; here it releases a creature from a whirlpool that the switching activation never created.',
    },
    {
      marker: 'chance',
      clause: '25 percent chance of capsizing',
      why: 'a-random-outcome-that-is-not-a-d20',
      note: 'a flat percentage decided by the generator, which no effect asks for: every roll a spell makes goes through the D20 pipeline or through a damage notation, and this is neither.',
    },
  ],
  'giant-insect': [
    {
      marker: 'armor-class',
      clause: '11 + the spell',
      why: 'a-stat-block-created-mid-fight',
      note: 'the SRD prints the insect stat block inside the spell entry, so the Armour Class belongs to a summoned creature and scales with the slot that summoned it; a casting adds no creature to a scene.',
    },
    {
      marker: 'hit-points',
      clause: 'The creature disappears when it drops to 0 Hit Points',
      why: 'a-stat-block-created-mid-fight',
      note: 'vitals on a creature the engine cannot make, and a lifecycle hanging off them — the summon leaves when they run out, which is the creature ending rather than the casting.',
    },
    {
      marker: 'speed',
      clause: '40 ft., Climb 40 ft., Fly 40 ft.',
      why: 'a-stat-block-created-mid-fight',
      note: 'three Speeds printed in the stat block the spell contains, on the creature that stat block describes and that no casting produces.',
    },
  ],
  'glyph-of-warding': [
    {
      marker: 'saving-throw',
      clause: 'Each creature in the area makes a Dexterity saving throw',
      why: 'a-creature-type-predicate-an-area-reads',
      note: 'the rune catches whoever set it off, and the caster may refine the trigger so that only named creature types do — an area catches whoever is in it, and its one filter is an explicit list chosen at the casting.',
    },
    {
      marker: 'dice',
      clause: '5d8 Acid, Cold, Fire, Lightning, or Thunder damage',
      why: 'a-choice-made-at-the-casting',
      note: 'the damage type is one of five chosen when the glyph is created, and a casting has nowhere to record a choice made at the moment it was made — so the dice cannot be typed and are not rolled.',
    },
    {
      marker: 'ability-check',
      clause: 'requires a successful Wisdom (Perception) check against your spell save DC to notice',
      why: 'a-choice-made-at-the-casting',
      note: 'the check is against a glyph whose whole configuration — explosive rune or spell glyph, trigger, damage type, stored spell — is chosen when it is inscribed, so there is nothing inscribed for anybody to notice.',
    },
  ],
  'magic-circle': [
    {
      marker: 'teleport',
      clause: 'If the creature tries to use teleportation or interplanar travel',
      why: 'an-effect-that-suppresses-other-magic',
      note: 'the ward stops a teleport arriving rather than performing one, which is how this clause was re-filed when the teleportation shape was retired: an area that refuses a casting resolved somewhere else has no state to sit in.',
    },
    {
      marker: 'saving-throw',
      clause: 'it must first succeed on a Charisma saving throw',
      why: 'a-barrier-that-blocks-passage',
      note: 'the save exists only to answer the attempt to cross, so it is raised by the boundary rather than by the casting, and there is no boundary.',
    },
    {
      marker: 'roll-mode',
      clause: 'Disadvantage on attack rolls against targets within the Cylinder',
      why: 'a-filter-on-the-attackers-creature-type',
      note: 'the penalty falls on one creature type attacking whoever is inside, and a selector reaches a roll by family, ability and skill — the roll-and-damage note names this spell in the table of what the vocabulary does not reach.',
    },
    {
      marker: 'condition',
      clause: 'be possessed by or gain the Charmed or Frightened condition from the creature',
      why: 'a-condition-immunity-narrowed-to-its-source',
      note: 'the immunity holds against that one creature and against nobody else, and a condition immunity is refused to everybody or to nobody rather than narrowed to who is trying to apply it.',
    },
  ],
  confusion: [
    {
      marker: 'saving-throw',
      clause: 'must succeed on a Wisdom saving throw',
      why: 'an-action-a-spell-compels-or-forbids',
      note: 'what a failure costs is two named spenders — Bonus Actions and Reactions — and the economy is guarded by the conditions the engine names, with no lever for a spell to forbid one directly.',
    },
    {
      marker: 'dice',
      clause: 'must roll 1d10 at the start of each of its turns to determine its behavior',
      why: 'a-random-outcome-that-is-not-a-d20',
      note: 'a d10 on a behaviour table every turn, and a d4 for a direction on one of its rows: no effect asks the generator for a die outside the D20 pipeline and outside a damage notation.',
    },
  ],
  'arcane-hand': [
    {
      marker: 'armor-class',
      clause: 'The hand is an object that has AC 20',
      why: 'a-stat-block-created-mid-fight',
      note: 'an Armour Class and a hit point total on a thing that is not a creature and does not occupy its space; a casting adds nothing to a scene that can be attacked, and this one has to be attackable for the sentence after it to mean anything.',
    },
    {
      marker: 'hit-points',
      clause: 'If it drops to 0 Hit Points, the spell ends',
      why: 'a-casting-ended-by-a-trigger',
      note: 'the casting ends on a fact about the hand rather than on a deadline, a broken Concentration, a dispel or a recast — and the fact is the vitals of a thing that is not in the scene at all.',
    },
    {
      marker: 'dice',
      clause: 'the target takes 5d8 Force damage',
      why: 'a-stat-block-created-mid-fight',
      note: 'the Clenched Fist makes a melee spell attack from the hand rather than from the caster, so the roll is the summoned thing making it and the dice go wherever the thing goes.',
    },
    {
      marker: 'saving-throw',
      clause: 'or the hand pushes the target up to 5 feet',
      why: 'forced-movement-a-spell-causes',
      note: 'the Forceful Hand shoves a failed saver five feet plus five times the spellcasting ability modifier, and no effect moves a creature — position is changed by a move command and by a teleport, and never as the consequence of a save.',
    },
    {
      marker: 'condition',
      clause: 'the target has the Grappled condition, with an escape DC equal to your spell save DC',
      why: 'an-activation-that-forces-a-saving-throw',
      note: 'the Grasping Hand raises its Dexterity save on a later turn out of a Bonus Action, and an activation resolves against a target the caster names then rather than against the list the casting caught.',
    },
  ],
  'dispel-evil-and-good': [
    {
      marker: 'roll-mode',
      clause: 'Celestials, Elementals, Fey, Fiends, and Undead have Disadvantage on attack rolls against you',
      why: 'a-filter-on-the-attackers-creature-type',
      note: 'the penalty is selected by the creature type of whoever is attacking, and a selector reaches a roll by family, ability and skill — the roll-and-damage note names this spell in the table of what the vocabulary deliberately does not reach.',
    },
    {
      marker: 'condition',
      clause: 'you touch a creature that is possessed by or has the Charmed or Frightened condition',
      why: 'a-casting-dismissed-early',
      note: 'Break Enchantment is one of two special functions that end this casting when the caster chooses, and a casting ends on its deadline, on Concentration, on a dispel or on a recast — never because the caster spent it.',
    },
    {
      marker: 'saving-throw',
      clause: 'or be sent back to its home plane if it isn',
      why: 'a-second-place-to-put-a-creature',
      note: 'the Dismissal save decides whether a creature leaves for the Shadowfell, the Feywild or wherever it came from, and the scene is one place: a creature that is elsewhere has nowhere to be.',
    },
  ],
  eyebite: [
    {
      marker: 'saving-throw',
      clause: 'must succeed on a Wisdom saving throw or be affected by one of the following effects of your choice',
      why: 'a-choice-made-at-the-casting',
      note: 'which of Asleep, Panicked and Sickened a failure buys is picked when the spell is cast, and a casting has nowhere to record a choice made at the moment it was made.',
    },
    {
      marker: 'condition',
      clause: 'The target has the Unconscious condition',
      why: 'an-activation-that-forces-a-saving-throw',
      note: 'the condition lands on whoever the Magic action names on a later turn, and an activation calls a saving throw on a target the caster chooses then rather than on the list the casting caught.',
    },
  ],
  'magic-jar': [
    {
      marker: 'saving-throw',
      clause: 'The target makes a Charisma saving throw',
      why: 'a-second-place-to-put-a-creature',
      note: 'the save answers an attempt to possess made by a soul sitting in a container, and a creature is in the scene or it is not — there is nowhere for the caster to be while the body lies catatonic.',
    },
    {
      marker: 'hit-points',
      clause: 'Hit Point Dice, Strength, Dexterity, Constitution, Speed, and senses are replaced',
      why: 'an-ability-score-a-spell-changes',
      note: 'one creature reads its vitals and three ability scores off another for as long as the possession lasts, and an ability score is a fact of the sheet that nothing written by a casting may overwrite.',
    },
    {
      marker: 'speed',
      clause: 'Your Hit Points',
      why: 'an-ability-score-a-spell-changes',
      note: 'the Speed in the same list is the same overwrite wearing a different field, and it is recorded apart because the Speed is derived where the scores are stored.',
    },
  ],
  'summon-dragon': [
    {
      marker: 'armor-class',
      clause: '14 + the spell',
      why: 'a-stat-block-created-mid-fight',
      note: 'the SRD prints the Draconic Spirit stat block inside the spell entry, so the Armour Class belongs to a summoned creature and scales with the slot that summoned it; a casting adds no creature to a scene.',
    },
    {
      marker: 'hit-points',
      clause: 'The creature disappears when it drops to 0 Hit Points',
      why: 'a-stat-block-created-mid-fight',
      note: 'vitals on a creature the engine cannot make, and a lifecycle hanging off them — the summon leaves when they run out, which is the creature ending rather than the casting.',
    },
    {
      marker: 'speed',
      clause: '30 ft., Fly 60 ft., Swim 30 ft.',
      why: 'a-stat-block-created-mid-fight',
      note: 'three Speeds printed in the stat block the spell contains, on the creature that stat block describes and that no casting produces.',
    },
  ],
  'wind-walk': [
    {
      marker: 'speed',
      clause: 'a target has a Fly Speed of 300 feet and can hover',
      why: 'movement-modes',
      note: 'a Fly Speed is a mode rather than a number added to the one Speed a creature has, and hovering is a second fact beside it that nothing holds.',
    },
    {
      marker: 'defence',
      clause: 'Resistance to Bludgeoning, Piercing, and Slashing damage',
      why: 'movement-modes',
      note: 'the Resistance rides in the same sentence as the Fly Speed and is conferred by the same cloud form, so it is left out with the form rather than for any want of a Resistance the engine cannot grant.',
    },
    {
      marker: 'condition',
      clause: 'Reverting takes 1 minute, during which the target has the Stunned condition',
      why: 'an-activation-taken-by-somebody-other-than-the-caster',
      note: 'the Magic action that begins reverting is taken by the target rather than by the caster, so the minute of Stunned hangs off an activation belonging to somebody the casting reached rather than to whoever cast it.',
    },
  ],
  'animal-shapes': [
    {
      marker: 'hit-points',
      clause: 'but the target retains its creature type',
      why: 'a-target-rule-the-format-cannot-state',
      note: 'the statistics written over the target are a Beast selected by size and by a Challenge Rating of 4 or lower, and a rating is a fact the engine does not hold at all — the third of the three facts that shape names.',
    },
  ],
  'antimagic-field': [
    {
      marker: 'teleport',
      clause: 'no one can teleport into or out of it or use planar travel there',
      why: 'an-effect-that-suppresses-other-magic',
      note: 'the aura refuses a teleport resolved somewhere else rather than ending one, which is the half of this shape that ending a casting does not build: there is no state for declining to let magic arrive.',
    },
  ],
  'antipathy-sympathy': [
    {
      marker: 'saving-throw',
      clause: 'makes a Wisdom saving throw when it comes within 120 feet of the target',
      why: 'a-repeat-save-raised-by-a-trigger',
      note: 'the save is owed because something happened — a creature came within a hundred and twenty feet — and the turn boundary is the only thing that raises a repeat save, which the time-and-turns note states outright.',
    },
    {
      marker: 'condition',
      clause: 'The creature has the Frightened condition',
      why: 'a-choice-made-at-the-casting',
      note: 'whether a failure buys Frightened or Charmed is settled when the spell is cast, along with the kind of creature it answers to, and a casting has nowhere to record a choice made at the moment it was made.',
    },
  ],
  'astral-projection': [
    {
      marker: 'condition',
      clause: 'left behind in a state of suspended animation',
      why: 'a-second-place-to-put-a-creature',
      note: 'the Unconscious condition lands on a body the projecting creature is no longer in, and one creature in two places has nowhere to be: the scene holds each creature once.',
    },
    {
      marker: 'hit-points',
      clause: 'astral form drops to 0 Hit Points, the spell ends for that target',
      why: 'a-casting-ended-by-a-trigger',
      note: 'the casting ends per target on the vitals of one of two bodies, where a casting ends whole and on its deadline, on Concentration, on a dispel or on a recast.',
    },
  ],
  'conjure-celestial': [
    {
      marker: 'saving-throw',
      clause: 'The target makes a Dexterity saving throw',
      why: 'an-area-moved-by-the-casters-own-movement',
      note: 'the save belongs to the pillar of light, and the pillar may be moved up to thirty feet whenever the caster moves — a casting pins its template where it was put and has no way to carry one along.',
    },
    {
      marker: 'hit-points',
      clause: 'The target regains Hit Points equal to 4d12 plus your spellcasting ability modifier',
      why: 'a-spells-effects-applied-to-different-targets',
      note: 'the caster chooses per creature in the Cylinder whether the light heals or burns, and a casting carries one effect list applied to everybody it caught.',
    },
    {
      marker: 'dice',
      clause: '6d12 Radiant damage on a failed save',
      why: 'a-spells-effects-applied-to-different-targets',
      note: 'the burning half of the same per-creature choice; the extra 1d12 a slot above 7 buys scales both and so goes with both.',
    },
  ],
  'delayed-blast-fireball': [
    {
      marker: 'saving-throw',
      clause: 'each creature in a 20-foot-radius Sphere centered on that point makes a Dexterity saving throw',
      why: 'an-effect-that-fires-when-the-casting-ends',
      note: 'the Sphere resolves when the casting ends rather than when it is made, and an effect fires at the casting or on a trigger — a deadline ends things and starts nothing.',
    },
    {
      marker: 'dice',
      clause: 'base damage is 12d6, and the damage increases by 1d6 whenever your turn ends',
      why: 'an-area-trigger-on-the-casters-turn',
      note: 'the total the bead will deal grows by a die at the end of every one of the caster turns, and an area trigger watches the turns of creatures standing in it rather than the caster own.',
    },
  ],
  'divine-word': [
    {
      marker: 'saving-throw',
      clause: 'Each creature of your choice in range makes a Charisma saving throw',
      why: 'a-spells-effects-applied-to-different-targets',
      note: 'one save and two different failure branches — a band read off the Hit Points, and a second effect for four creature types regardless of them — where a casting carries one effect list.',
    },
    {
      marker: 'hit-points',
      clause: 'a target that has 50 Hit Points or fewer suffers an effect based on its current Hit Points',
      why: 'an-outcome-that-reads-the-targets-hit-points',
      note: 'a threshold on the vitals read after the save and before anything else, and then a table of four bands read off the same number; no outcome asks the vitals a question.',
    },
    {
      marker: 'condition',
      clause: 'The target has the Deafened condition for 1 minute',
      why: 'an-outcome-that-reads-the-targets-hit-points',
      note: 'the mildest of the four rows, and the only one whose cell says condition in the singular: three conditions with a duration is a thing the format writes directly, and which row applies is read off the target current Hit Points.',
    },
  ],
  earthquake: [
    {
      marker: 'saving-throw',
      clause: 'at the end of each of your turns for the duration, each creature on the ground in the area makes a Dexterity saving throw',
      why: 'an-area-trigger-on-the-casters-turn',
      note: 'the area fires again at the end of every one of the caster turns, and an area trigger watches the turns of the creatures standing in it rather than the caster own.',
    },
    {
      marker: 'condition',
      clause: 'a creature has the Prone condition, and its Concentration is broken',
      why: 'an-outcome-that-breaks-concentration',
      note: 'one failure pairs an ordinary condition with a broken Concentration, and no outcome of a saving throw asks for one — Sleet Storm prints the same pairing and is tracked for the same reason.',
    },
    {
      marker: 'dice',
      clause: 'A total of 1d6 fissures open in the spell',
      why: 'a-random-outcome-that-is-not-a-d20',
      note: 'a d6 counting how many fissures open and a d10 for how deep each is: no effect asks the generator for a die outside the D20 pipeline and outside a damage notation.',
    },
    {
      marker: 'hit-points',
      clause: 'If a structure drops to 0 Hit Points, it collapses',
      why: 'a-world-fact-nothing-can-represent',
      note: 'a building with Hit Points that can be reduced to nothing is not a creature and not a template, and the world model holds creatures, landmarks and templates — inventing a third is not on.',
    },
    {
      marker: 'ability-check',
      clause: 'requiring a DC 20 Strength (Athletics) check as an action to escape',
      why: 'a-dc-the-caster-does-not-set',
      note: 'the DC is printed as 20 rather than derived from the caster spell save DC, so a check a spell calls for has nowhere to carry a number the caster did not set.',
    },
  ],
  imprisonment: [
    {
      marker: 'saving-throw',
      clause: 'The target must make a Wisdom saving throw',
      why: 'a-choice-made-at-the-casting',
      note: 'which of the six prisons a failure buys is settled when the spell is cast, and a casting has nowhere to record a choice made at the moment it was made.',
    },
    {
      marker: 'condition',
      clause: 'The target has the Restrained condition',
      why: 'a-creature-fact-an-effect-overrides',
      note: 'the Restrained comes with "and cannot be moved by any means", which writes over what every other rule believes about moving a creature rather than adding a condition beside them.',
    },
    {
      marker: 'teleport',
      clause: 'The target is trapped in a demiplane that is warded against teleportation',
      why: 'a-second-place-to-put-a-creature',
      note: 'a demiplane is somewhere other than the scene, and the scene is one place: a creature that is stored rather than destroyed has nowhere to be.',
    },
  ],
  'prismatic-spray': [
    {
      marker: 'dice',
      clause: 'roll 1d8 to determine which color ray affects it',
      why: 'a-random-outcome-that-is-not-a-d20',
      note: 'a d8 per target choosing which of eight effects reaches it, and no effect asks the generator for a die outside the D20 pipeline and outside a damage notation.',
    },
    {
      marker: 'saving-throw',
      clause: 'Each creature in the Cone makes a Dexterity saving throw',
      why: 'a-spells-effects-applied-to-different-targets',
      note: 'one save and eight different failure branches, a different one per creature, where a casting carries one effect list applied to everybody it caught.',
    },
    {
      marker: 'condition',
      clause: 'If it fails three times, it has the Petrified condition',
      why: 'a-repeat-save-counted-to-a-tally',
      note: 'the Indigo ray counts successes and failures until one side reaches three, which is the death-save shape rather than the repeat-save one; a repeat save holds no tally.',
    },
    {
      marker: 'teleport',
      clause: 'the creature teleports to another plane of existence',
      why: 'a-second-place-to-put-a-creature',
      note: 'the Violet ray sends a failure off the plane entirely, and the scene is one place with nowhere else for a creature to arrive.',
    },
  ],
  'prismatic-wall': [
    {
      marker: 'armor-class',
      clause: 'The wall, which has AC 10',
      why: 'a-wall-or-several-templates-in-one-area',
      note: 'an Armour Class on the wall itself, destroyed one layer at a time in order, which needs the seven layers to be seven things before it needs anything else.',
    },
    {
      marker: 'saving-throw',
      clause: 'Each layer forces the creature to make a Dexterity saving throw',
      why: 'a-wall-or-several-templates-in-one-area',
      note: 'a save per layer for one creature passing through, and a casting holds one template with one effect list rather than seven stacked in the same place.',
    },
    {
      marker: 'dice',
      clause: '12d6 Fire damage',
      why: 'a-wall-or-several-templates-in-one-area',
      note: 'the first of five damage layers, each with its own type behind its own save; the dice go with the layers they belong to.',
    },
    {
      marker: 'condition',
      clause: 'or have the Blinded condition for 1 minute',
      why: 'a-barrier-that-blocks-passage',
      note: 'the Blinded is owed by a creature that came within twenty feet of a wall that also refuses passage, and a barrier stopping movement is a rule about who may enter a space that the ruler does not have.',
    },
    {
      marker: 'teleport',
      clause: 'the creature teleports to another plane of existence',
      why: 'a-second-place-to-put-a-creature',
      note: 'the Violet layer sends a failure off the plane entirely, and the scene is one place with nowhere else for a creature to arrive.',
    },
  ],
  'project-image': [
    {
      marker: 'ability-check',
      clause: 'can determine that it is an illusion with a successful Intelligence (Investigation) check',
      why: 'a-second-place-to-put-a-creature',
      note: 'the check examines an illusory copy of the caster standing up to five hundred miles away, and there is one scene — so there is nothing standing anywhere for anybody to study.',
    },
  ],
  simulacrum: [
    {
      marker: 'hit-points',
      clause: 'its Hit Point maximum is half as much',
      why: 'a-stat-block-created-mid-fight',
      note: 'a creature copied from another creature at the moment of casting, typed Construct and given half the maximum, is a stat block built by the spell; a casting adds no creature to a scene.',
    },
    {
      marker: 'hit-points',
      clause: 'the only way to restore its Hit Points is to repair it as you take a Long Rest',
      why: 'healing-modified-by-an-effect',
      note: 'healing narrowed to one route and priced at 100 GP a point: an effect that changes how a creature may be healed at all, rather than how much a heal restores.',
    },
    {
      marker: 'hit-points',
      clause: 'The simulacrum lasts until it drops to 0 Hit Points',
      why: 'a-casting-ended-by-a-trigger',
      note: 'the casting ends on the vitals of the creature it made, where a casting ends on its deadline, on Concentration, on a dispel or on a recast.',
    },
  ],
  'storm-of-vengeance': [
    {
      marker: 'saving-throw',
      clause: 'must succeed on a Constitution saving throw or take 2d6 Thunder damage',
      why: 'an-area-trigger-on-the-casters-turn',
      note: 'the first of six rounds of weather, each resolved at the end of one of the caster turns, and an area trigger watches the turns of the creatures standing in it rather than the caster own.',
    },
    {
      marker: 'condition',
      clause: 'have the Deafened condition for the duration',
      why: 'an-area-trigger-on-the-casters-turn',
      note: 'the condition hangs off that first round save and goes with the round it belongs to.',
    },
    {
      marker: 'dice',
      clause: 'Each creature and object under the cloud takes 4d6 Acid damage',
      why: 'damage-with-neither-an-attack-roll-nor-a-save',
      note: 'the plainest instance in the book: damage a spell simply applies, with neither an attack roll nor a saving throw in front of it, which has no effect kind — the same gap Magic Missile is blocked on.',
    },
  ],
  symbol: [
    {
      marker: 'saving-throw',
      clause: 'Each target makes a Constitution saving throw, taking 10d10 Necrotic damage',
      why: 'a-choice-made-at-the-casting',
      note: 'which of Death, Discord, Fear, Pain, Sleep and Stunning the glyph holds is settled when it is inscribed, and a casting has nowhere to record a choice made at the moment it was made.',
    },
    {
      marker: 'dice',
      clause: '10d10 Necrotic damage on a failed save',
      why: 'a-choice-made-at-the-casting',
      note: 'the dice belong to the one of six effects that was chosen at the inscribing, so they are unrollable for the same reason the save is unraisable.',
    },
    {
      marker: 'roll-mode',
      clause: 'has Disadvantage on attack rolls and ability checks',
      why: 'a-choice-made-at-the-casting',
      note: 'Discord is another of the six, and the modifier it grants is ordinary — what is missing is any record that Discord rather than Fear is what this glyph was drawn as.',
    },
    {
      marker: 'condition',
      clause: 'or have the Frightened condition for 1 minute',
      why: 'a-creature-type-predicate-an-area-reads',
      note: 'who the glyph catches may be refined so that only named creature types set it off, and an area catches whoever is in it — its one filter is an explicit list of creatures chosen at the casting.',
    },
    {
      marker: 'ability-check',
      clause: 'requires a successful Wisdom (Perception) check against your spell save DC to notice',
      why: 'a-check-another-creature-may-attempt',
      note: 'the check may be made by anybody who looks rather than by a creature the casting reached, and a casting check is rolled by somebody the casting touched.',
    },
  ],
  'true-polymorph': [
    {
      marker: 'saving-throw',
      clause: 'An unwilling creature can make a Wisdom saving throw',
      why: 'a-target-rule-the-format-cannot-state',
      note: 'the save is offered to an unwilling target and to nobody else, so who rolls is decided by a fact about consent that a target rule selecting by creature type and by armour worn cannot state.',
    },
    {
      marker: 'hit-points',
      clause: 'replaced by the stat block of the new form',
      why: 'a-stat-block-created-mid-fight',
      note: 'the new form is any creature in the book or any object, written over the target for the hour, which is a stat block built at the casting and laid on somebody who is already in the scene.',
    },
  ],
  tsunami: [
    {
      marker: 'saving-throw',
      clause: 'each creature in its area makes a Strength saving throw, taking 6d10 Bludgeoning damage',
      why: 'a-wall-or-several-templates-in-one-area',
      note: 'three hundred feet of wall by fifty thick is a wall rather than a template, and the save belongs to whoever the wall covers when it appears.',
    },
    {
      marker: 'dice',
      clause: 'the damage the wall deals on later rounds is reduced by 1d10',
      why: 'an-area-that-moves-by-itself',
      note: 'the wall moves fifty feet and loses fifty feet of height at the end of every turn, and its damage drops a die with it: an area that changes between one firing and the next has nowhere to record either.',
    },
    {
      marker: 'ability-check',
      clause: 'the creature must succeed on a Strength (Athletics) check against your spell save DC to move at all',
      why: 'an-action-a-spell-compels-or-forbids',
      note: 'failing the check costs the creature its movement entirely, and the economy is guarded by the conditions the engine names with no lever for a spell to take a move away directly.',
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
  // **The one place in this reading where the vocabulary ran out.** The upcast
  // line grows the Sphere with the slot, `SpellArea` is a fixed size, and the
  // slot reaches damage dice and a target count and nothing else. No shape id
  // names it; inventing one is an architecture decision, so the clause is filed
  // as the table's under protest and reported. `blocked-on.test.ts` pins it by
  // name so it cannot go quiet, and Fog Cloud prints the same sentence while
  // this map records it as blocked on nothing at all.
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
  darkness: [],
  dream: ['a-long-casting-time', 'a-rest-an-effect-gives-or-denies'],
  entangle: ['an-area-that-filters-its-catch', 'difficult-terrain-an-area-creates'],
  enthrall: ['a-bonus-narrowed-to-a-skill', 'a-fact-only-the-table-can-declare'],
  // One sentence, one shape, and both halves of the sentence are that shape:
  // the spell **takes** an action for you and then **grants** you a second way
  // to take it. The shortest paragraph in the book that is still debt.
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
  'flesh-to-stone': [
    'a-repeat-save-counted-to-a-tally',
    'a-success-branch-that-does-something',
    'an-automatic-success-by-creature-type',
    'an-effect-that-fires-when-the-casting-ends',
  ],
  // **The one spell this family still finishes once its paragraphs are read.**
  // Everything Gate prints is the portal, and a portal is the one-scene model's
  // absence rather than a mechanism beside it — so the whole entry files under
  // one shape and nothing else is owed.
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
  'magic-missile': [
    'a-spells-effects-applied-to-different-targets',
    'damage-with-neither-an-attack-roll-nor-a-save',
  ],
  // **The second blocker the design document had already written down.**
  // `SpellCheck.onSuccess` says outright that there is deliberately no
  // `end-casting` value and names Maze as one of the three spells that print
  // it — so the spell this map said a second place would finish needs a second
  // thing, and it was recorded in `spell-definitions.ts` all along.
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
  'mirage-arcane': ['a-long-casting-time', 'difficult-terrain-an-area-creates'],
  // SRD ends the **invisibility** here and not the casting — "The double lasts
  // for the duration, but the invisibility ends immediately after you make an
  // attack roll, deal damage, or cast a spell" — so IE-032's three causes name
  // the moment and nothing can say that it takes one effect rather than the
  // whole spell. And the double is Project Image's sentence word for word:
  // "You can see through its eyes and hear through its ears as if you were
  // located where it is."
  // **The payout entry was mis-filed, and the printed sentence is what says
  // so.** "**On each of your turns**, such a phantasm can deal 2d8 Psychic
  // damage to the target if it is in the phantasm's area or within 5 feet of
  // the phantasm" is the *caster's* boundary rather than the target's — the
  // shape filed separately as `an-area-trigger-on-the-casters-turn` — and the
  // damage is owed only while the target stands near a point. So a payout at
  // the recipient's own boundary reaches none of this clause, and the honest
  // correction is the two shapes that do.
  // **The bare list had missed the field.** A minute is a long casting and this
  // entry never said so, which is the kind of omission only reading the printed
  // entry rather than the paragraph finds.
  'modify-memory': ['a-casting-ended-by-a-trigger'],
  'phantasmal-force': [
    'an-area-trigger-measured-from-a-point',
    'an-area-trigger-on-the-casters-turn',
  ],
  'programmed-illusion': [],
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
  // Three sentences, three shapes, and the third trips no marker at all — the
  // one that forbids casting is the family shape and `CLAUSE_MARKERS` cannot
  // see it, because the book writes "Verbal component" where the list looks
  // for an action it names.
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
  'spare-the-dying': [
    'a-range-that-scales-with-caster-level',
    'an-effect-that-stabilises-a-dying-creature',
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
    'the item’s line says it casts a named spell and the catalogue has **no definition of that spell at all**. `checkContent` refuses the pairing in as many words — packages/engine/src/content.ts, "which this content has no executable definition of" — so an item that casts Scrying, Levitate or Gate cannot be written until the spell is, and the blocker is the spell’s own. It is the largest single blocker in the book’s magic items and it is not item work at all, which is the finding: a tranche aimed at wands buys nothing until the spells under them exist. **The word that decides an entry is *definition*, not *executable*, and this description said otherwise for a batch.** The predicate `checkContent` hands an item is `spells.some(s => s.id === id)` — packages/engine/src/content.ts, the call site of `itemGrantProblems` — and `castFromItem` reads `content.spell(id)`, so a **tracked** definition answers both. That is SRD’s own sentence about what a casting from an item is: "The spell uses its normal casting time, range, and duration, and the user of the item must concentrate if the spell requires Concentration", every word of which a tracked definition already carries. A Wand of Magic Detection and a Ring of Animal Influence came off this shape without a line of spell work, and `item-casts-a-tracked-spell.test.ts` drives both directions so the distinction cannot be lost again. What *should* name this shape is an entry whose spell nothing defines — and, for a **potion**, a spell whose definition resolves nothing, because a `confers` grant carries the definition’s `SpellEffect[]` and "an item that confers an empty list confers nothing". **Sixty definitions later, every entry here has been read against the catalogue again**, entry by entry and spell by spell rather than against this line: thirteen named the shape with every spell they print already defined and have been re-pointed or transcribed, which is why this is no longer the heaviest blocker in the book. The two the last reading wrote down as wrong are both settled — `chime-of-opening` is transcribed, because a use count that never comes back is `recovers: \'special\'` on a pool keyed to the copy; and `amulet-of-the-planes` is **unread**, because what gates its defined Plane Shift is "make a DC 15 Intelligence (Arcana) check" and a check gating a casting still has no id, which is a shape this vocabulary will not invent in a note.',
  'a-save-an-item-forces':
    'a saving throw an item makes somebody roll — **half built, and the half that is missing is not the DC**. The roll and the number are there: packages/engine/src/content.ts admits the first, "A saving throw is not on that list any more.", and says where the second comes from, "`saveDc` on the grant is a number the item printed and `save-damage` resolves against it through the resolver a casting uses". So a save whose failure is **damage** is writable today, which is why Dust of Dryness’s 10d6 and Javelin of Lightning’s 4d6 no longer name this shape. A save whose failure imposes a **condition** is writable too, and was the last of the weld to go: the same file admits the kind — "Nor is `save`, which was the last of that weld." — and says what a conferral’s repeat ends, "so a condition a flask’s saving throw imposes repeats its save at the boundary like a spell’s, and a success ends it on the timer the conferral’s own hour filed". What is not built is every *other* thing a failed save can do, which the rule in docs/design/content.md still leaves out — an item is "refused an effect kind a conferral cannot resolve", and there is no kind for most of them. What still names this shape is therefore a save whose outcome is neither damage nor a condition: a wielder who goes berserk, a creature trapped in a flask or a mirror, an Undead simply destroyed. Which entries below still name it for a condition rather than for one of those is a re-derivation this map owes and has not been given.',
  'a-charge-spent-on-something-other-than-a-casting':
    'a charge the item’s line spends on something that is not a spell — **half built, and the half that is missing is what the charge buys**. A conferral may now be priced, and may offer a range to choose within: packages/engine/src/content.ts reads the cost the way a casting’s is read, "and a pool on the same item for the charges to come out of", and refuses one with nothing behind it, "confers for charges and declares no charge pool for them to come out of" — so a staff is spent where a potion is used up, out of the item’s own pool and through the one spender. What is **not** built is a benefit that grows with the count spent, which is the rest of SRD Staff of Striking’s sentence: "For each charge you expend, the target takes an extra 1d6 Force damage". Nothing in the effect vocabulary scales dice by a charge count — an `attack-rider` carries a bare notation, and packages/engine/src/content.ts refuses every scaling field a conferral could reach for, "reads a slot level or a caster level, and an item’s printed line is the same whoever uses it" — so a priced conferral today pays a chosen price for a fixed benefit, and the staff waits on a field this vocabulary has not invented. The other residue is a charge spent on something no grant kind executes at all — a Reaction, a trigger, a rider on a later weapon attack — which the same file’s enumeration of what an item’s readers run already names: "only a standing grant, a charge pool, a spell it casts and the effects it confers are read from one".',
  'a-condition-an-item-imposes':
    'a condition an item puts on a creature, **and what is left is every way of imposing one that is not simply handing it over**. A conferral may now hang a condition outright: packages/engine/src/content.ts admits the kind — "Nor is a condition any more." — and says why that admits no casting with it, "The rider fields that would need a casting are refused one by one below", so Potion of Invisibility is transcribed and no longer names this shape. A condition a **saving throw** imposes is built too, and was the last of that weld: the same file admits the kind — "Nor is `save`, which was the last of that weld." — and refuses with it only the repeat whose success would end a casting, "a repeat save that ends the casting on a success needs one". What is **not** built is a condition whose duration the item **rolls** for, which no conferral can state; which entries below still name this shape for a save rather than for that is a re-derivation this map owes and has not been given. A condition the holder switches off by decision is `a-benefit-an-item-switches-on-and-off` seen from the condition’s end, and one a printed sentence suspends is `a-benefit-an-item-suspends-on-a-trigger`.',
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
    'training an item confers — a language you know while you wear it, a weapon you are suddenly proficient with. Neither is a `FeatureGrant` kind at all — a language and weapon or armour training are `ClassDefinition` fields, so there is no member to read from an item and none to refuse: packages/engine/src/content.ts, "only a standing grant, a charge pool, a spell it casts and the effects it confers are read from one". One shape rather than two, because one line of the reader admits both and each entry’s own note says which the item wanted.',
  'an-item-instance-with-a-state-of-its-own':
    'a fact about **this** copy of an item rather than about the catalogue row — and **the line that decides an entry has moved twice**, so it is drawn here rather than left to a reader’s sense of it. The identity exists (docs/design/characters-and-equipment.md: "An item copy **has** an identity now"), and so does the one kind of per-copy state the engine holds: a **charge pool keyed to the copy**, whose maximum the book may roll at the copy’s birth (`CatalogueItem.chargesRolled`, thrown by `awardItems`), which travels whole when the copy is handed over, and which `recovers: \'special\'` leaves exactly where it lands. So a per-copy fact that is a **spendable count** is no longer a gap: a bag with 3d4 beans in it, a prism with fifty charges, a manual a reader has used up, a talisman spent to nothing. What is left under this name is every *other* fact a copy carries, and each of the entries below says which of its own: **which kind** this one is out of several (a necklace’s beads, a robe’s patches, a scroll’s spell), **which parts** are left rather than how many (a deck’s thirty-four cards, a helm’s four counts of gems against one pool), **how long it has burned** (a candle’s minutes, a timer the clock moves and no command spends), **what was rolled for it once** (an efreeti bottle’s course), **what is inside it** (an iron flask’s prisoner), **which other copy it is paired with** (a sending stone), and **a change it makes to another item** (an oil that turns a sword into a +3 Weapon). And the one the shape was first written for: an arrow that stops being magical the moment it hits, which is a state a use changes and not a use it spends. packages/content/src/items.ts carries the same distinction on the potion that forced it — the other rows of the healing table "would need four ids, or an item instance record, to sit on one inventory line", which is *which kind*, the first entry in the list above.',
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
 * The largest blocker in the book's magic items was not an item mechanism at
 * all: it was `a-spell-an-item-casts-that-nothing-executes`, and every entry
 * under it was waiting on a **spell** definition. A wand tranche planned
 * without reading would have bought wands and found the spells underneath
 * them missing.
 *
 * **Both of the top two have since been spent, and the ranking is the
 * finding's receipt rather than a fact about the book.** The spells were
 * written and the entries came off; the instance shape that replaced it was
 * built and a second reading took two thirds of *its* entries away. So the
 * heaviest blocker is an item mechanism now, which is what the reading was
 * for. **Every number in that ranking is `COVERAGE.md`'s to print**, and a
 * count here would be the prose these maps replaced — what this paragraph
 * says is which id sits where, which is a claim a guard can hold.
 *
 * ### A map is a claim about the engine, so it goes stale when the engine moves
 *
 * The second reading found that the commonest way for an entry to be wrong is
 * not a misread paragraph but a **true sentence about a world that changed**,
 * and both of the top two shapes were carrying a batch of those. So an entry
 * re-read against a landing says so in a comment above it, in the book's own
 * words, and an entry whose blocker went without another to take its place
 * goes to {@link UnreadItemEntry} rather than quietly to *ready* — because
 * "nothing blocks this" and "nothing nameable blocks this" are different
 * claims and only the first is a brief.
 */
export const ITEM_BLOCKED_ON: Readonly<Record<string, ItemEntry>> = {
  'adamantine-armor': ['a-critical-hit-an-effect-downgrades'],
  // Both keep the instance shape, and both are the shape's own example:
  // "Once it hits a target, the ammunition is no longer magical" is a fact
  // about one arrow that changes on an event, not a count anything spends.
  'ammunition-1-2-or-3': ['an-item-instance-with-a-state-of-its-own'],
  'ammunition-of-slaying': [
    'a-rider-on-a-later-weapon-attack',
    'a-version-of-an-item-the-book-leaves-to-the-gm',
    'an-item-instance-with-a-state-of-its-own',
  ],
  'amulet-of-proof-against-detection-and-location': {
    unread:
      'read, and the blocker cannot be named from anything this repository has written down. "you can’t be targeted by Divination spells or perceived through magical scrying sensors" is a filter on the *school* of a spell reaching the targeting check, and no document here describes a school axis as a gap. Filing it as the table’s would put an entry with nothing to record on the ready list; naming a shape for it would be an architecture decision smuggled in as a note.',
  },
  // Re-pointed, and the spell shape was never the blocker: Plane Shift is a
  // tracked definition, which is what `checkContent` asks a `casts` grant
  // for. What stays is the amulet's failure branch — "travel to a random
  // destination determined by rolling 1d100 and consulting the following
  // table" — which is the spell map's own 1d100 mishap roll, and the GM's
  // table underneath it. The clause with **no** id in either vocabulary is
  // the gate on the success branch, "Then make a DC 15 Intelligence (Arcana)
  // check": an ability check that decides whether an item's casting happens
  // at all, which no grant kind has a field for. It is written down here
  // rather than given a shape, because inventing one would be the
  // architecture decision this vocabulary refuses to smuggle into a note.
  'amulet-of-the-planes': [
    'a-random-outcome-that-is-not-a-d20',
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
  // "This heavy cloth bag contains 3d4 dry beans when found", spent a bean at
  // a time: a count the book rolls at the copy's birth, which is
  // `chargesRolled` and a pool keyed to the instance. The identity is not what
  // stands in the way of this bag any more; the explosion is.
  'bag-of-beans': [
    'a-save-an-item-forces',
    'a-condition-an-item-imposes',
    'an-area-an-item-creates',
    'a-version-of-an-item-the-book-leaves-to-the-gm',
  ],
  'bag-of-devouring': ['a-container-with-a-space-of-its-own'],
  'bag-of-holding': ['a-container-with-a-space-of-its-own'],
  // "Once three fuzzy objects have been pulled from the bag, the bag can't be
  // used again until the next dawn" is a pool of three recovering at dawn, and
  // a pool is keyed to the copy now — two bags are two counts without either
  // of them being told the other exists. Which colour this bag is stays the
  // GM's.
  'bag-of-tricks': [
    'a-stat-block-created-mid-fight',
    'a-version-of-an-item-the-book-leaves-to-the-gm',
  ],
  // "Typically, 1d4 + 4 _Beads of Force_ are found together" counts the beads
  // in a hoard rather than a state inside one: a bead is thrown once and
  // destroyed, which is the counted stack an inventory has always held and the
  // consumable `useItem` already spends.
  'bead-of-force': ['an-area-an-item-creates', 'a-save-an-item-forces'],
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
  // Gate is defined and tracked, so the casting is not the blocker. The
  // instance shape stays, and the line between it and a charge pool is what
  // this entry draws: "Deduct the time it burned in increments of 1 minute
  // from its total burn time" is a **timer** on this copy, counted down by the
  // clock rather than by anything a command spends, and a pool is a count of
  // uses.
  'candle-of-invocation': [
    'a-selector-for-every-d20-test',
    'an-item-instance-with-a-state-of-its-own',
  ],
  'carpet-of-flying': ['movement-modes', 'a-version-of-an-item-the-book-leaves-to-the-gm'],
  'censer-of-controlling-air-elementals': ['a-stat-block-created-mid-fight'],
  'cloak-of-arachnida': ['movement-modes', 'a-speed-an-item-grants'],
  'cloak-of-displacement': ['a-benefit-an-item-suspends-on-a-trigger'],
  'cloak-of-invisibility': [
    'a-condition-an-item-imposes',
    'a-benefit-an-item-suspends-on-a-trigger',
  ],
  // Polymorph is defined and tracked, and "on yourself" is `targetsSelfOnly`,
  // so the casting the cloak prints is writable and the per-dawn limit is a
  // pool of one. What is left is the Stealth Advantage and the Fly Speed.
  'cloak-of-the-bat': ['a-bonus-narrowed-to-a-skill', 'movement-modes'],
  'cloak-of-the-manta-ray': ['a-speed-an-item-grants', 'movement-modes'],
  'dagger-of-venom': ['a-condition-an-item-imposes', 'a-benefit-an-item-switches-on-and-off'],
  'dancing-sword': ['an-object-with-statistics-of-its-own'],
  'decanter-of-endless-water': ['a-condition-an-item-imposes'],
  // The instance shape stays, and the count is the smaller half of it: "A
  // deck found as treasure is usually missing 1d20 − 1 cards" is a rolled
  // number, but "that card can't be used again" makes the state *which*
  // thirty-four cards are left, which a pool cannot say.
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
  // Every spell on the orb's table is defined — Cure Wounds and Suggestion
  // execute, Daylight, Death Ward, Detect Magic and Scrying are tracked — so
  // the five castings and their 1d4 + 3 dawn are writable. The Charmed
  // condition its own save imposes, and the orb's AC and Hit Points, are not.
  'dragon-orb': [
    'a-condition-an-item-imposes',
    'a-version-of-an-item-the-book-leaves-to-the-gm',
    'an-object-with-statistics-of-its-own',
  ],
  'dragon-scale-mail': [
    'a-version-of-an-item-the-book-leaves-to-the-gm',
    'a-mode-on-the-save-a-spell-forces',
  ],
  // Re-pointed. "There is enough of it for one use" is the consumable
  // `useItem` already spends, and carries no state at all; what this packet
  // really asks for is the **duration** it throws — "the Invisible condition
  // for 2d4 minutes" — which is a conferral's `durationSeconds`, a whole
  // number, against dice nothing asks the generator for. The same field
  // Potion of Diminution's 1d4 hours is re-pointed to.
  'dust-of-disappearance': [
    'a-condition-an-item-imposes',
    'a-benefit-an-item-suspends-on-a-trigger',
    'a-random-outcome-that-is-not-a-d20',
  ],
  'dust-of-dryness': [
    {
      clause: 'contains 1d6 + 4 pinches of dust',
      why: 'expressible',
      note: 'a count the book rolls at the copy’s birth and spends a pinch at a time, which is `CatalogueItem.chargesRolled` beside a pool keyed to the instance — the same pair Sovereign Glue’s ounces are written with. This is the clause that came off `an-item-instance-with-a-state-of-its-own` when a copy got a pool of its own.',
    },
    {
      clause: 'turning up to a 15-foot Cube of water into one marble-sized pellet',
      why: 'table',
      note: 'water is not a thing the engine holds — there is no terrain, no volume of liquid and no rule that would ask — so a Cube of it becoming a pellet changes nothing the engine could record. The pellet, its weight and the smashing of it are the same answer: an object with no statistics, handled by the table.',
    },
    {
      clause: 'on an Elemental within 5 feet of yourself that is composed mostly of water',
      why: 'a-target-rule-the-format-cannot-state',
      note: 'the clause that keeps this entry out, and it is the Trident of Fish Command’s shape rather than a new one: a type the format **can** state ("an Elemental", as the trident says "a Beast") narrowed by a fact it cannot ("composed mostly of water", as the trident says "that has a Swim Speed"). A `confers` grant carries an effect list and no `TargetRule` at all, so a packet written today would wither whatever its user pointed it at — which is the unsayable clause *limiting* the benefit, rule 3 in packages/content/src/items.ts, and the reason the record waits rather than shipping narrowed by nothing.',
    },
    {
      clause: 'taking 10d6 Necrotic damage on a failed save',
      why: 'expressible',
      note: 'a `save-damage` effect on a priced `confers` grant, against the packet’s own printed DC — packages/engine/src/content.ts: "A saving throw is not on that list any more." This is the clause that came off `a-save-an-item-forces`, and it is what makes the entry a transcription waiting on one narrowing rather than an entry with nothing to write down.',
    },
  ],
  // "There is enough of it for one use" is the consumable a bottle already is;
  // the sneezing and the Emanation are what is left.
  'dust-of-sneezing-and-choking': ['a-condition-an-item-imposes', 'an-area-an-item-creates'],
  'dwarven-thrower': ['a-rider-on-a-later-weapon-attack'],
  'efficient-quiver': ['a-container-with-a-space-of-its-own'],
  // The instance shape stays, and what it holds is not a count: "The first
  // time the bottle is opened, the GM rolls on the following table", and the
  // table sets this bottle on one of three courses for the rest of its life.
  // A pool counts uses; this remembers an outcome.
  'efreeti-bottle': [
    'a-stat-block-created-mid-fight',
    'a-version-of-an-item-the-book-leaves-to-the-gm',
    'an-item-instance-with-a-state-of-its-own',
  ],
  // "the gem ceases to be magical" is the single-use consumable `useItem`
  // already spends, and needs no record of its own; which gem this is stays
  // the GM's.
  'elemental-gem': [
    'a-stat-block-created-mid-fight',
    'a-version-of-an-item-the-book-leaves-to-the-gm',
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
  // **The bow names no spell at all**, which is the plainest stale entry in
  // this map: the shape was recorded against a line the paragraph does not
  // contain. Its Restrained condition rides on a ranged attack made with the
  // weapon — "Whenever you use this weapon to make a ranged attack" — which
  // is where the blocker really sits.
  'energy-bow': ['a-condition-an-item-imposes', 'a-rider-on-a-later-weapon-attack'],
  'eversmoking-bottle': ['an-area-an-item-creates', 'a-benefit-an-item-switches-on-and-off'],
  'eyes-of-minute-seeing': ['senses-beyond-declared-sight', 'a-bonus-narrowed-to-a-skill'],
  'eyes-of-the-eagle': ['a-fact-only-the-table-can-declare'],
  // Which token this is is the GM's, which is a shape of its own; each is
  // then a single-use consumable and carries no other state.
  'feather-token': [
    'a-version-of-an-item-the-book-leaves-to-the-gm',
    'a-stat-block-created-mid-fight',
    'an-object-with-statistics-of-its-own',
  ],
  // Which figurine this is is the GM's; its cooldown — "it can't be used
  // again until 5 days have passed" — is a pool of one and a `Recovery` the
  // vocabulary has no member for, neither of which is an identity.
  'figurine-of-wondrous-power': [
    'a-stat-block-created-mid-fight',
    'a-version-of-an-item-the-book-leaves-to-the-gm',
  ],
  'flame-tongue': ['a-benefit-an-item-switches-on-and-off'],
  'folding-boat': ['an-object-with-statistics-of-its-own', 'a-container-with-a-space-of-its-own'],
  // "This prism has 50 charges ... When all of the gem's charges are expended,
  // the gem becomes a nonmagical jewel": a count spent down to nothing, keyed
  // to the copy, which `countedUses` writes and `recovers: 'special'` leaves
  // where it lands.
  'gem-of-brightness': [
    'a-condition-an-item-imposes',
    'an-area-an-item-creates',
    'a-charge-spent-on-something-other-than-a-casting',
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
  'handy-haversack': ['a-container-with-a-space-of-its-own'],
  'hat-of-disguise': ['a-casting-ended-by-a-trigger'],
  'hat-of-many-spells': [
    'a-spell-an-item-casts-that-nothing-executes',
    'a-version-of-an-item-the-book-leaves-to-the-gm',
  ],
  // The instance shape stays, and this is the entry that shows why a pool is
  // not enough of one: "set with 1d10 diamonds, 2d10 rubies, 3d10 fire opals,
  // and 4d10 opals" is **four** rolled counts spent separately, and an item
  // declares one pool. Prismatic Spray is still undefined, so the spell shape
  // stays too.
  'helm-of-brilliance': [
    'an-area-an-item-creates',
    'a-rider-on-a-later-weapon-attack',
    'a-damage-roll-an-item-makes',
    'a-spell-an-item-casts-that-nothing-executes',
    'a-rider-on-the-face-the-die-showed',
    'an-item-instance-with-a-state-of-its-own',
  ],
  // Detect Thoughts is tracked and Suggestion executes, so both castings are
  // writable; the telepathy is the table's fact and is what is left. One
  // thing the reading found and no shape holds: the helm limits **each spell
  // separately** — "Once either spell is cast from the helm, that spell can't
  // be cast from it again until the next dawn" — and `itemChargePool` returns
  // the first pool an item declares, so two economies on one object cannot be
  // written. It changes nothing here, because the telepathy blocks the entry
  // anyway, and it is written down so the next reader does not rediscover it.
  'helm-of-telepathy': ['a-fact-only-the-table-can-declare'],
  // Re-pointed. Nothing about the horn is per copy: "Each use of the horn's
  // magic has a 20 percent chance of causing the horn to explode" is a die
  // thrown at every use, and the shape for one is the spell map's own.
  'horn-of-blasting': [
    'an-area-an-item-creates',
    'a-damage-roll-an-item-makes',
    'a-condition-an-item-imposes',
    'a-random-outcome-that-is-not-a-d20',
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
  // "Once the bands are used, they can't be used again until the next dawn"
  // is a pool of one on this copy, which is what keying a pool to the
  // instance bought. The Restrained condition is what is left.
  'iron-bands': ['a-condition-an-item-imposes'],
  // The instance shape stays: "The flask can hold only one creature at a
  // time" and "A newly discovered _Iron Flask_ might already contain a
  // creature chosen by the GM" are a **creature** kept on this copy, which
  // no count of uses can hold.
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
  // **The six books are one sentence six times**, and the reading is the
  // same for all of them: "The manual then loses its magic but regains it in
  // a century" is one use spent on this copy, which is a pool of one keyed to
  // the instance, and a century is a `Recovery` the vocabulary has no member
  // for — under-granting rather than over-granting it, which is the safe
  // side of rule 3. What blocks all six is the +2 to an ability score.
  'manual-of-bodily-health': ['an-ability-score-a-spell-changes'],
  'manual-of-gainful-exercise': ['an-ability-score-a-spell-changes'],
  'manual-of-golems': [
    'a-stat-block-created-mid-fight',
    'a-damage-roll-an-item-makes',
    'a-version-of-an-item-the-book-leaves-to-the-gm',
  ],
  'manual-of-quickness-of-action': ['an-ability-score-a-spell-changes'],
  // "This fine wooden box contains 1d4 pots of pigment", one spent per
  // painting: a count the book rolls at the copy's birth, which is
  // `chargesRolled` and a pool keyed to the instance.
  'marvelous-pigments': [
    'a-concentration-with-no-casting-behind-it',
    'an-object-with-statistics-of-its-own',
  ],
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
  'necklace-of-fireballs': {
    unread:
      're-read, and the blocker it named is gone without another to take its place — which is the more surprising because this necklace is the example `CatalogueItem.chargesRolled`’s own docstring is written around. "This necklace has 1d6 + 3 beads" is a count rolled at the copy’s birth and pinned, and Fireball executes, so "the bead detonates as a level 3 _Fireball_ (save DC 15)" is a `casts` grant priced at one bead. What has no id is the clause before it: "you can take a Magic action to detach a bead and **throw it up to 60 feet away**" — Fireball’s own Range is 150 feet, `resolveTargets` enforces that Range, and a `casts` grant has no field that narrows one. The clause *limits* the benefit, so rule 3 in packages/content/src/items.ts leaves the record out rather than handing out a necklace with two and a half times the reach the book gives it. Every other item in the catalogue that casts prints no range of its own, which is why this is the first entry to want the field.',
  },
  // The instance shape stays, and it is not the count: the 1d4 + 2 beads are
  // rolled at the copy's birth, but **which type** each bead is is the GM's
  // and each keeps a dawn of its own, so this copy carries a list rather than
  // a number. Shining Smite and Wind Walk are still undefined.
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
  // A vial is the single-use consumable `useItem` already spends and carries
  // no state of its own. Etherealness is defined and **tracked**, which is
  // the second half of the spell shape rather than the first: an oil confers
  // rather than casts, and an item that confers an empty list confers nothing.
  'oil-of-etherealness': ['a-spell-an-item-casts-that-nothing-executes'],
  // The instance shape stays, and this is the one entry where the copy the
  // state belongs to is a **different** item: "turning the coated weapon into
  // a _+3 Weapon_" is a fact about that sword, not about this vial.
  'oil-of-sharpness': ['an-item-instance-with-a-state-of-its-own'],
  // The same vial and the same reading: Freedom of Movement is tracked, so
  // what the oil would confer is an empty list, and the Grease is an area.
  'oil-of-slipperiness': [
    'a-spell-an-item-casts-that-nothing-executes',
    'an-area-an-item-creates',
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
  'portable-hole': ['a-container-with-a-space-of-its-own'],
  'potion-of-animal-friendship': {
    unread:
      'read, and the blocker cannot be named without inventing a shape. "you can cast the level 3 version of the _Animal Friendship_ spell (save DC 13)" is a **consumable whose one use is a casting**, and neither door fits: a `confers` grant is refused the `save` kind that spell is written in, while a `casts` grant is the shape Cape of the Mountebank already uses and `checkContent` accepts it here — a one-charge pool and the spell, DC and level the line prints. What it accepts is not the potion, because that pool recovers at dawn and nothing spends the flask itself: `useItem` is the only command that uses an item **up** as part of using it, and it refuses anything whose grant is not a conferral. Filing it under the condition weld would name a blocker the engine does not give; naming the missing one would be an architecture decision smuggled in as a note.',
  },
  'potion-of-clairvoyance': [
    {
      clause: 'you gain the effect of the _Clairvoyance_ spell (no Concentration required)',
      why: 'a-spell-an-item-casts-that-nothing-executes',
      note: 'read, and it keeps the shape for the second reason that shape names: a potion confers rather than casts, so what it needs is a definition whose `SpellEffect[]` it can copy — and Clairvoyance is defined and **tracked**, with an empty list. "An item that confers an empty list confers nothing." Unlike Enlarge/Reduce, nothing here waits on a choice a bottle could make: a sensor in a place you know, seen or heard through, is fiction all the way down, so this entry is waiting on a mechanic rather than on an afternoon.',
    },
  ],
  'potion-of-climbing': [
    'a-speed-an-item-grants',
    'movement-modes',
    'a-bonus-narrowed-to-a-skill',
  ],
  'potion-of-diminution': [
    {
      clause: 'for 1d4 hours (no Concentration required)',
      why: 'a-random-outcome-that-is-not-a-d20',
      note: 're-pointed, and the spell is no longer the blocker. Its sibling the Potion of Growth is transcribed on the same sentence — a bottle **makes** the choice Enlarge/Reduce cannot record, so the reduce branch is two `roll-mode` effects the same way the enlarge branch is. What stops this one is the duration: a conferral lasts `durationSeconds`, a whole number the item prints, and this item prints a die. The generator could throw the 1d4 and no field asks it to, which is this shape exactly.',
    },
  ],
  'potion-of-flying': ['a-speed-an-item-grants', 'movement-modes'],
  'potion-of-giant-strength': [
    'an-ability-score-a-spell-changes',
    'a-version-of-an-item-the-book-leaves-to-the-gm',
  ],
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
  'potion-of-mind-reading': [
    {
      clause: 'you gain the effect of the _Detect Thoughts_ spell (save DC 13)',
      why: 'a-spell-an-item-casts-that-nothing-executes',
      note: 'read, and it keeps the shape for the potion reason: Detect Thoughts is defined and **tracked**, so there is no `SpellEffect[]` for a conferral to carry and an empty list confers nothing. The printed DC cannot rescue it either — a conferral may print one only where something rolls against it, and what this spell rolls against a DC is the save of a probe taken as a Magic action on a later turn, which no conferral has a turn to take.',
    },
  ],
  'potion-of-poison': ['a-damage-roll-an-item-makes', 'a-condition-an-item-imposes'],
  'potion-of-resistance': ['a-version-of-an-item-the-book-leaves-to-the-gm'],
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
  // Dancing Lights, Light and Faerie Fire are all defined and tracked, so the
  // three castings and the ring's 1d6 dawn are writable. The lightning
  // spheres are what is left.
  'ring-of-shooting-stars': [
    'an-area-an-item-creates',
    'a-concentration-with-no-casting-behind-it',
  ],
  'ring-of-spell-storing': ['a-casting-an-item-stores-or-gives-back'],
  'ring-of-spell-turning': ['a-mode-on-the-save-a-spell-forces', 'a-reaction-an-item-grants'],
  'ring-of-swimming': ['a-speed-an-item-grants', 'movement-modes'],
  'ring-of-the-ram': [
    'a-damage-roll-an-item-makes',
    'a-charge-spent-on-something-other-than-a-casting',
  ],
  // "you can expend 1 of its 3 charges ... The ring becomes nonmagical when
  // you use the last charge" is a pool of three keyed to the copy, spent to
  // nothing and never given back. Wish is still undefined.
  'ring-of-three-wishes': ['a-spell-an-item-casts-that-nothing-executes'],
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
  // The instance shape stays: "the robe has 4d4 other patches", each of a
  // kind rolled on a table and each removable once. A copy carries a list of
  // kinds, and a pool counts.
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
  'rod-of-rulership': ['a-condition-an-item-imposes'],
  'rod-of-security': ['a-fact-only-the-table-can-declare', 'healing-modified-by-an-effect'],
  'rope-of-climbing': ['an-object-with-statistics-of-its-own', 'a-bonus-narrowed-to-a-skill'],
  'rope-of-entanglement': ['an-object-with-statistics-of-its-own', 'a-condition-an-item-imposes'],
  'scarab-of-protection': [
    'a-reaction-an-item-grants',
    'a-mode-on-the-save-a-spell-forces',
    'a-charge-spent-on-something-other-than-a-casting',
  ],
  // The instance shape stays, and it is the plainest case of one: "The target
  // is the bearer of the other stone" makes each stone's identity a *pair*,
  // and "If one of the stones in a pair is destroyed, the other one becomes
  // nonmagical" makes one copy's state read another's. Sending is undefined.
  'sending-stones': [
    'a-spell-an-item-casts-that-nothing-executes',
    'an-item-instance-with-a-state-of-its-own',
  ],
  'shield-of-missile-attraction': ['what-ends-attunement-besides-a-command'],
  'slippers-of-spider-climbing': ['a-speed-an-item-grants', 'movement-modes'],
  // Both shapes stay, and both for the same word: the scroll "bears the words
  // of a single spell" and never says which, so *which spell this copy holds*
  // is a fact about the copy that no count can carry, and the entry is a
  // template over every spell in the book rather than one item.
  'spell-scroll': [
    'a-spell-an-item-casts-that-nothing-executes',
    'a-version-of-an-item-the-book-leaves-to-the-gm',
    'an-item-instance-with-a-state-of-its-own',
  ],
  'spellguard-shield': ['a-mode-on-the-save-a-spell-forces'],
  'sphere-of-annihilation': ['an-object-with-statistics-of-its-own', 'a-damage-roll-an-item-makes'],
  // Charm Person executes and Command and Comprehend Languages are tracked,
  // so all three of the staff's castings are writable. The Reaction that
  // reflects an Enchantment and the failed save it turns into a success are
  // what is left.
  'staff-of-charming': [
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
  // "The talisman has 7 charges ... When you expend the last charge, the
  // talisman disperses" is a pool spent to nothing on this copy, which a pool
  // keyed to the instance holds. Its twin below reads the same.
  'talisman-of-pure-good': [
    'a-bonus-to-spell-attack-rolls',
    'a-damage-roll-an-item-makes',
    'a-save-an-item-forces',
    'a-charge-spent-on-something-other-than-a-casting',
    'a-filter-on-the-attackers-creature-type',
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
  ],
  'thunderous-greatclub': [
    'an-ability-score-a-spell-changes',
    'an-area-an-item-creates',
    'a-save-an-item-forces',
    'a-condition-an-item-imposes',
    'a-rider-on-a-later-weapon-attack',
    'a-damage-roll-an-item-makes',
  ],
  // The three tomes print the three manuals' sentence again; read them there.
  'tome-of-clear-thought': ['an-ability-score-a-spell-changes'],
  'tome-of-leadership-and-influence': ['an-ability-score-a-spell-changes'],
  'tome-of-understanding': ['an-ability-score-a-spell-changes'],
  'trident-of-fish-command': ['a-target-rule-the-format-cannot-state'],
  'wand-of-enemy-detection': [
    'senses-beyond-declared-sight',
    'a-rider-on-the-face-the-die-showed',
    'a-charge-spent-on-something-other-than-a-casting',
  ],
  'wand-of-magic-missiles': [
    'a-spell-an-item-casts-that-nothing-executes',
    'a-rider-on-the-face-the-die-showed',
  ],
  // **What `a-rider-on-the-face-the-die-showed` blocks and what it merely
  // annotates**, settled here because four wands were filed under it for a
  // clause three transcribed items already carry as a note. "If you expend
  // the wand's last charge, roll 1d20. On a 1, the wand crumbles into ashes
  // and is destroyed" is `unmodelled` on the Wand of Fireballs and the Wand
  // of Web, and on the Rod of Resurrection: nothing removes a line from an
  // inventory, so the clause is an *addition* the record leaves out and a
  // record without it is a wand that lasts longer than the book's, not one
  // that does more. The four whose whole remainder was that sentence are
  // transcribed. It stays a blocker on the entries below, where the die face
  // buys something — a Fire Opal's beams, a staff regaining charges on a 20,
  // a sword's extra damage — and on the wands whose spell or condition
  // blocks them anyway.
  'wand-of-paralysis': ['a-condition-an-item-imposes', 'a-rider-on-the-face-the-die-showed'],
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
  // Re-pointed twice over. Gust of Wind is defined and tracked, so the
  // casting is writable; and what the fan really keeps is not an identity
  // but a die — "a cumulative 20 percent chance of not working" — which the
  // spell map already names. The count of uses since dawn behind that
  // percentage is a pool; the percentage is not.
  'wind-fan': ['a-random-outcome-that-is-not-a-d20'],
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
