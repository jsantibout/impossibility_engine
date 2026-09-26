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
// **Type-only, and that is load-bearing.** `missing-feature-shapes.ts` imports
// values from this file, so a value import back would close a runtime cycle;
// a type import is erased under `verbatimModuleSyntax` and closes nothing.
import type { FeatureShapeId } from './missing-feature-shapes.js';

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
    'a repeat save whose **failure** branch acts. `RepeatSave.onSuccess` released an effect and the failure did nothing at all, so a boundary save that deals damage or deepens a condition had nowhere to put it. **Two of the three arms are built now.** `RepeatSave.onFailure` is the deepening — SRD Sleep’s second save applies the Unconscious under the same source and ends the timer with it, which is what finished that spell. And `RepeatSave.beforeTheSave` is the damage a boundary deals **before** the die: SRD Searing Smite’s "the target takes 1d6 Fire damage and then makes a Constitution saving throw", collected through `dealSpellDamage` so defences, Concentration and the log’s dice all apply, on a repeat the **casting** hosts rather than a condition — which is what finished that one. What is left is damage keyed to the *failure itself* — "damage on a failure (Phantasmal Killer, Weird)", the third of the four mechanisms the audit bundled under `a-repeat-save-beyond-the-turn-hook` — and any of it on a repeat raised from a condition rider, where the payout would have to travel with the condition rather than with the casting. PROGRESS.md names the id for Ensnaring Strike.',
  'a-repeat-save-raised-by-a-trigger':
    'a repeat save raised by something that happened — taking damage, having moved, coming within a distance, another effect trying to cure it. The turn hook is the only thing that raises one, which `docs/design/time-and-turns.md` states outright: "Raising is derived; rolling is commanded ... `turn-advanced` *raises* the saves the boundary owes". The fourth of the four mechanisms the audit found bundled under `a-repeat-save-beyond-the-turn-hook`.',
  'a-casting-ended-by-a-trigger':
    'a casting ends by its deadline, by Concentration, by a dispel or by a recast — `docs/design/casting.md`, "Lifecycle, and the one place it ends". IE-032 built the fifth way for **five** transcribed causes: the target attacks, deals damage or casts, the target dons armour, and the caster or an ally damages the target. What is left is every cause whose fact no consequence event holds and every consequence the two scopes cannot express — **any** damage from anybody (Modify Memory, Sleep, Sequester, Phantom Steed, Project Image, Eyebite), a distance two creatures drift apart (Faithful Hound, Warding Bond, Antilife Shell), a running total dealt (Guardian of Faith), a condition the caster chooses at the casting (Sequester), leaving an area (Tiny Hut), dropping to 0 Hit Points (Gaseous Form, Warding Bond), another spell ending this one (Geas, Contact Other Plane), a Temporary Hit Point total running out (Polymorph), the target dying (True Polymorph), and ending **one effect** of a casting rather than the casting (Mislead, whose double outlives its invisibility). Letting go of an object stood in that list and does not now: `GrantedWeaponRider.endsWhenLetGo` in packages/engine/src/standing.ts is the sixth cause, and `settleWeaponRiders` ends the casting when the weapon the rider pinned is no longer among the ids in its holder’s inventory. What Shillelagh still waits on is not the cause but the **declaration** — a `weapon-rider` effect has no field to print the clause with, and it may not be assumed of every rider, because Magic Weapon imbues a weapon for an hour and prints no such sentence.',
  'a-mode-on-the-save-a-spell-forces':
    '`docs/design/rolls-and-damage.md`: "nothing records what a save was against" — the sentence that already blocks Countercharm. A `RollModifier` selects a roll by family, ability and skill, so there is no way to select the saving throws an effect from a Fiend forces. **Re-described rather than kept**: the audit found this id claimed by six clauses whose real blockers were three different things, and that the description misstated its own. What is left is the clause that genuinely needs a save to remember its provenance.',
  'a-fact-only-the-table-can-declare':
    'a fact the engine does not hold and cannot derive, which a rule then reads — how well you know a creature, whether you are outdoors in a storm, whether you are fighting it. Declared cover, declared sight and declared allegiance are the discipline CLAUDE.md already draws for this; the audit (§4) is where these clauses were found filed as a selector problem when what they want is the fact. **IE-030 built the fought fact**: `CastSpellRequest.fought` carries it, the five spells that read it as Advantage are finished, and SRD Enthrall reads the same fact as an automatic success through `autoSucceedIf: { fought: true }`. What is left under this id is every other fact of the kind — how well you know a creature, whether you are outdoors — that no request yet states.',
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
  'an-outcome-that-reads-the-targets-hit-points':
    'a threshold on the target’s current Hit Points, read before anything is rolled. PROGRESS.md ranks it: "Reads the target’s current Hit Points | 0 / 4 | vitals". The vitals are there and no effect asks them a question.',
  'a-target-rule-the-format-cannot-state':
    '`TargetRule` in spell-definitions.ts selected by creature type and by whether armour is worn, and by nothing else. The SRD also selects by **size**, by **Challenge Rating** and by an **ability score**, and shapes outcomes by the same three facts. **The first of the three is built**: `mustBeSize` reads `effectiveSizeOf` — the size an active feature prints, then the size somebody stated, then the map’s — refuses a named target of the wrong one and filters the shortlist, and SRD Animal Messenger’s "a Tiny Beast" is written off it. **The second is built too**: a Challenge Rating is pinned at the arrival now — `creature-added.cr`, `CreatureState.cr`, off the block `adaptMonster` reads — and `save.autoSucceedIf.challengeRatingAbove` reads it, sparing a Beast the book rates above nothing and asking about a creature nobody has rated rather than calling it a 0. What is left under this name is the **ability score**, which is held and read by nothing here. Three facts, one missing reader, and the description says which is which. **Animal Messenger is written now** (2026-09-24) and this shape no longer holds it: the two facts it wanted were the size and the rating, both above, and the last thing in its way was where the verdict went. `save.verdictOnly` is that — a die whose whole content is its answer, rolled by the casting and reported in the casting’s own outcomes with no record written — so the spell is executed and the errand goes to the table as the handover it always was. **And a fourth claimant, which is not a fact about the target at all**: SRD Thaumaturgy’s Booming Voice grants Advantage on Charisma (Intimidation) checks to *the caster*, on a spell whose Range is 30 feet and whose target count is zero, so the mode has no creature to land on. The rule it needs is "the caster and nobody else", and `notTheCaster` is the only sentence of that family `TargetRule` has — it is the other one. `{ count: 1, self: true }` would let a caster boom an ally’s voice, which is a rule the book does not grant.',
  'a-creature-fact-an-effect-overrides':
    'an effect that changes what **other** rules believe about a creature. **The type is built and the name now means the other two facts.** PROGRESS.md named it — "Arcanist’s Magic Aura changes what other spells believe a creature’s type to be, which `mustBeType` reads on every casting" — and `creature-type-override` is that sentence: a sourced grant beside `CreatureState.creatureType` rather than a write over it, read by `typeMagicSees`, whose docstring draws the line the SRD sentence draws between a spell asking and a creature asking. The fact itself is untouched, and every door that ends a grant gives the goblin its own type back. What is left is **size** — held, read by sharing a space, passing through and the volume a template tests, and written over by nothing — and the third fact IE-044 read off SRD Gaseous Form: "The target can enter and occupy the space of another creature", where what the other rule believes is that a creature holds its space against a willing mover. One reader built, two facts left.',
  'an-ability-score-a-spell-changes':
    'a score an effect **moves**, in any of the five ways the book moves one. `docs/design/time-and-turns.md`, on what a rest does not restore: "**Reduced ability scores and a reduced hit point maximum are not restored**, because neither is modelled in the first place." One of the five is built: an item may now *set* a score — an **absolute** held while it is worn, derived on every read by `abilityScoresOf` — and the three entries that printed only that sentence are transcribed. Four have no writer. A score an effect **lowers**. A **bounded delta with a lifetime**, which SRD prints on six Ioun Stones: "Your Dexterity increases by 2, to a maximum of 20, while this deep-red sphere orbits your head" is `ability-score-increase`’s arithmetic on a standing grant’s lifetime, and the member that holds the arithmetic is answered at creation while the one that holds the lifetime writes absolutes — the Belt of Dwarvenkind prints it too, and the Hammer of Thunderbolts adds 4 to whatever score a belt or a pair of gauntlets already bestowed. A set with a **deadline** rather than a garment, which a conferral would carry and `CONFERRED_EFFECT_KINDS` does not admit. And a **permanent** raise: the manuals’ and the tomes’ +2 after forty-eight hours of study, which outlives every rest and is a folded number rather than a derived one.',
  'a-stat-block-created-mid-fight':
    'summons. `docs/design/casting.md`, "Which spells this reaches": "A stat block created mid-fight | Unseen Servant, Arcane Hand, Phantom Steed, Summon Dragon, Giant Insect ...". That row lost three entries to this reading — "the four Conjures", Guardian of Faith and Faithful Hound — because SRD 5.2.1 rewrote the Conjure family as spirits and none of the eight prints an Armour Class, Hit Points or a turn. **The creation half is built.** `summonCreature` and `dismissStrandedSummons` were the door; P2-T11 added the level above them — a `summon` effect kind, so a casting derives its creature from the spell instead of a caller reading the casting id back and summoning by hand. It names a stat block by its id in content, or leaves the form to the caster out of a printed list (SRD Find Familiar’s eleven, or any Beast of Challenge Rating 0), pins every number the block prints into `creature-added`, works out the numbers a spell prints over its own block (SRD Find Steed’s "AC 10 + 1 per spell level", its Fly Speed gated on a level 4 slot, the creature type the caster states), reads the caster’s Initiative count where the spell shares it and seats the creature immediately after them, and binds the creature either to the casting **after** the ongoing record or — where the spell prints "disappears if it drops to 0 Hit Points" — to its summoner, as a creature the caster *keeps*, replaced by a second casting. The owner’s ruling of 2026-09-21 settled where a spell-internal block goes: into the bestiary, transcribed in `packages/content/src/bestiary.ts`, not into a second kind of content. What is left under this name is two things and neither is the creation: **a stat block that is in neither chapter** — Unseen Servant’s servant, which the book prints nowhere as a block — and **a line the block prints with the summoner’s numbers**, SRD Find Steed’s Otherworldly Slam ("Bonus equals your spell attack modifier", "1d8 plus the spell’s level") and its three Bonus Actions ("DC equals your spell save DC"), which no stat block field can name and which the transcribed block therefore omits.',
  'movement-modes':
    'the Fly, Climb and Swim Speeds the engine does not distinguish, and the per-foot costs that ride with them. `docs/design/spell-definitions.md` refuses the vocabulary by name: "**Movement modes are refused outright.** Fly, Climb and Swim have no reader — no rule in the engine asks about one — so a vocabulary for them would be shape built ahead of every mechanic that could use it", and Roving’s own note says the same of its Climb and Swim Speeds. What is left of `speed-and-movement-modes` once IE-033 built the modifier half.',
  // **`a-speed-an-effect-multiplies` was here and has moved to the item
  // vocabulary**, which is `a-reduction-an-effect-applies-to-damage`'s
  // precedent and the same reason: the spell half is built and what is left
  // is true of an item and false of a casting. The id asked for a Speed
  // **doubled** and said in as many words what it was waiting for — the book
  // gives no order for a doubling against a halving, "so the member arrives
  // with the rule that settles it". `SpeedChange` has a `double` member now
  // and `combineSpeed` carries the rule; SRD Haste is executed off it and no
  // spell claims the id any more.
  'a-standing-effect-derived-from-where-a-creature-stands':
    'a value derived from current state *and* current geometry rather than from a pair of enter-and-leave events that have to stay matched. `docs/design/casting.md`: "A standing effect derived from where a creature is standing | Spirit Guardians’ halved Speed, every Paladin aura"; PROGRESS.md ranks it above automatic drift. **The derivation is built and the vocabulary is one member wide.** P1-T9 added `AreaStanding`: a casting pins what its area does to whoever stands in it, `creaturesStandingInCastingArea` answers who that is from the scene on every read, and `speedOf` folds the answer in beside a condition’s — which is Spirit Guardians’ halved Emanation, whole. The member it holds is a Speed. Every claimant below wants a different one — Advantage on a save, Resistance, an Immunity, a flat bonus, a condition a creature cannot gain while in the area — and each of those is a second reader rather than a second geometry: the thing still missing is `standingFor`’s grant vocabulary reachable from a casting’s area, not the area. **A second geometry landed with SRD Aberrant Ground and it is not this one**, which is worth saying so the row is not read as narrower than it is: `carriedDifficultGround` derives a *terrain patch* from where a creature stands, on the same reading — nothing stored, re-derived on every read, so the patch moves when the creature does — and it is read by `terrainAt` rather than by `standingFor`. It changes what the ground costs and grants nothing, so a spell writing "the ground within 10 feet of the target is Difficult Terrain" is now a sentence the engine can carry, and none of the claimants below is unblocked by it: every one of them still wants a grant.',
  'healing-modified-by-an-effect':
    'the audit (§3.5) read Chill Touch’s "can’t regain Hit Points" as a rule the engine owns, and Beacon of Hope as the same sentence pushing the other way: `healCreature` rolled its dice and capped at the maximum with nothing standing beside it to forbid the healing or to maximise it. **Both halves of that are built**: `HealingRule` is an eleventh sourced grant with two members, `prevented` makes the healing door emit nothing at all, `maximised` reaches the dice through the same substitution Great Weapon Fighting uses, and a casting, a rider’s own deadline and a dispel all end one — which is Beacon of Hope and Chill Touch whole. The phrase **any** healing is read literally rather than narrowed to a spell: `healCreature` is the one door every restoration but a rest goes through, and all three places the engine throws healing dice consult the rule — a `heal` effect, a turn boundary’s payout and a feature’s own self-heal. The one path that does not is `rest.ts`, which writes its `healed` events itself; no sentence of this shape can reach it, because Beacon of Hope runs for a minute and Chill Touch for a turn while the shortest rest is an hour. What is still missing under this name is a rule the engine has no *door* for rather than no vocabulary: an item or a stat block that says what may restore hit points to a thing at all (the Homunculus repaired over a Long Rest), and the item grants that would hang one, since only a spell effect and a rider can write the rule today.',
  'a-flat-amount-with-no-dice':
    '`DiceScaling.dice` **was** required, so a spell that healed or harmed by a printed number — or by the whole of the target’s maximum — rather than by a notation could not say so. The audit names it while re-scoping condition removal: "Heal (needs flat-only healing — `DiceScaling.dice` is required, one-line format question)". **The printed half is built**: the notation is optional, an amount may carry a `flat` alone, and `flatPerSlotLevelAbove` grows it — which is Heal’s seventy and its ten per slot level exactly, so Heal is a content tranche away rather than an engine one. What is still missing under this name is an amount **derived** rather than printed: the whole of a target’s maximum, and a number computed from the feet a creature was moved.',
  'an-exhaustion-level-a-spell-changes':
    'Exhaustion is a level rather than a condition that is simply on or off — `docs/rules/srd-policy.md`: "**Exhaustion is a flat -2 per level, not Disadvantage**" — and `end-condition` takes a list of condition names, so it removes the condition and cannot remove *one level* of it. `setExhaustionLevel` is a DM-declared command, among the nine `docs/rules/srd-policy.md` records as reachable from a command and from no spell effect.',
  'healing-that-raises-the-dead':
    '**Built.** PROGRESS.md ranked "Healing that lifts a condition, **raises the dead**, or raises the maximum", and `docs/design/spell-definitions.md` stated the refusal it had to get past — "hit points alone will not raise the dead — `healCreature` refuses a corpse, and the refusal costs no slot". The refusal stands and the shape goes round it: a `revive` effect and a `creature-revived` event of their own, because lifting death is not hit points with a small number in them, and `Vitals.diedAt` — stamped by the vitals seam on the transition rather than by any one of the four events that can kill somebody — is what makes the minute a spell reaches back into subtraction. SRD Revivify is executed off it. **Four undefined claimants are left**, and each prints a longer window, a bigger price or a body the engine has no shape for; the id stays because they are still owed and the mechanism they would reuse is now here. **And the fifth claimant is paid.** P3-S6 found it by reading Gentle Repose to the end: that spell widens the window rather than reaching through one — “days spent under the influence of this spell don’t count against the time limit of spells such as _Raise Dead_” — so what it wanted was a *second casting* altering the arithmetic `revive` does over `Vitals.diedAt`. The `preserves` effect is that, and it carries no field at all: its whole content is the moment the casting began keeping the body, pinned on the ongoing record as `preserving`, and `preservedSpan` takes the union of what the running castings covered back out of the difference. It was filed here because the window is this shape’s own mechanism, and it is finished here for the same reason — Gentle Repose is executed, and the decay, the Undead and remains that are not a creature are the table’s.',
  'a-hit-point-maximum-a-spell-moves':
    'PROGRESS.md ranked "Healing that lifts a condition, raises the dead, or raises the maximum" and the audit named Harm’s reduction as debt: the maximum was set when a creature is added and by advancement, and no effect moved it. **The raise is built**: `hit-point-maximum` is a twelfth sourced grant, `settleHitPointMaximum` reconciles `Vitals.hpMax` in the fold’s derived pass so every ending gives it back, and `advanceCharacter` subtracts the *unadjusted* maximum so a level taken mid-spell is worth the whole of its level — which is Aid and its slot scaling whole. Three things are still missing under this name and each is its own sentence. **A reduction**: Harm’s, the Berserker Axe’s, and Greater Restoration ending one — every SRD sentence that lowers a maximum is fastened to damage already taken, so the clause that makes it mean something is the half that is absent. **A maximum that cannot be reduced**, which is Aura of Life and is a refusal rather than an amount. **And a rolled one**: Heroes’ Feast’s 2d10, refused at authoring (`rolled_hit_point_maximum`) because a die thrown once and then carried for hours is a number the log cannot account for. A *feature* that raises a maximum is a different absence again — see the feature ledger.',
  'difficult-terrain-an-area-creates':
    '**Built for the ordinary case, and what is left is three sentences that are not it.** `AreaTerrain` in spell-definitions.ts says a spell’s area makes the ground expensive — "a fact about the **ground**, asked per space by the ruler as a move crosses it, and true of spaces nobody is standing in" — and `docs/design/light-and-sight.md` is where the patch it writes is named as the precedent the sight model generalises from; the casting pins the region it resolved into the `difficult-terrain-declared` event the table’s own declaration already writes, the patch lapses when the casting leaves `state.ongoing`, and the ruler charges for it at every space a move crosses — Grease, Web, Spike Growth and Plant Growth are written on it, at the glossary’s rate and at Plant Growth’s own four. The description before this one said the mechanism was missing outright and named five executed areas as invisible to the ruler; that is no longer the gap. What still names this shape is the ground a patch **cannot** describe: terrain charged only in one **direction**, which is Gust of Wind spending two feet per foot only while moving closer to the caster and is a fact about the mover rather than about the square; ground a spell **removes** rather than makes, which is Speak with Plants turning plant-grown Difficult Terrain back into ordinary ground and Mirage Arcane in both directions; and a patch whose lifetime is a **turn boundary** rather than a casting or forever, which is Ice Storm ending at the end of the caster’s next turn (out of level-5 reach and is recorded here rather than left for somebody to rediscover). Three executed spells past level-5 reach — Black Tentacles, Ice Storm and Insect Plague — still carry an `unmodelled` line saying their area is not Difficult Terrain, which is now true only of the third clause above; writing the field on the first two is a reading somebody owes and moves no number in reach.',
  'an-area-that-moves-by-itself':
    '`docs/design/casting.md`: "Cloudkill and Incendiary Cloud, blocked on automatic turn-start drift". PROGRESS.md says why it is not transcription: the move has to land before the start-of-turn clauses are determined, the direction is derived for one spell and chosen for the other, and a caster with no position has no "away from you" at all.',
  'an-area-trigger-on-the-casters-turn':
    '`AreaTrigger.at` in spell-definitions.ts transcribes the SRD’s two boundary clauses — "starts its turn there" and "ends its turn there" — and both are the **caught creature’s** turn. A storm that acts at the end of each of the *caster’s* turns is a third boundary, and the queue that raises area debt is keyed to the creature whose turn it is.',
  'a-selector-for-every-d20-test':
    '**Built.** `docs/design/rolls-and-damage.md` says it now: "A selector may name a family of D20 Tests, and it must then name the ability behind them". `RollFamily` gained the glossary’s own union of the other three, and `rollSelectorProblems` refuses it with no ability on it, because every consumer in reach prints the narrowing and a bare selector would reach every roll its holder ever made. SRD Ray of Enfeeblement is executed off it. **Three claimants are left**: Enlarge/Reduce, which prints the phrase as two families and waits on the choice made at the casting; and Foresight and Resurrection, which print it **bare** at levels this engine does not reach. The id stays because the bare phrase is still a widening nobody has asked for, and it arrives with the spell that writes it exactly as this member did.',
  'a-roll-result-an-effect-replaces':
    'a die whose result an effect overrides or throws again. `docs/design/rolls-and-damage.md` has both halves for damage dice — "Substitute a value | Great Weapon Fighting: 1 or 2 counts as 3 | `treatLowRollsAs`" — and for a D20 Test it had only `rerollTest`, which is a Reaction a feature takes. **The half that is retired is the pipeline reroll**: a `reroll-test-die` grant names a face, `sheetAsItStands` derives it onto the sheet every roller already asks for, and `rollD20Recorded` throws the counted die again and keeps the first throw on `roll-recorded.supersedes` — which reaches every ability check, saving throw, attack roll, Initiative and death save without a roll site having to know, and is SRD Luck whole. What is left under this name is a **spell effect** reaching either half: nothing a definition can write replaces a die or a result, so the reroll above is a feature’s sentence and only a feature’s.',
  'a-die-behaviour-a-spell-asks-for':
    '`docs/design/rolls-and-damage.md`’s "Dice Are Individually Addressable" table: `treatLowRollsAs`, `explodeOnMax` and `rerollDice` are built and tested, and the claim this description used to make — that no definition passes any of them — is **half retired**. `SpellDefinition.dieRule` is the door a spell asks through, `explodeOnMax` is behind its one arm, and Sorcerous Burst is the SRD sentence that walks through it, capped at a modifier the engine derives rather than one the catalogue states. What is left under this id is two different things, and neither of them is the plumbing. **A predicate over a whole roll**: `DieEffect` judges one die at a time — `substitute` and `bonusOn` both take `(rolled, sides)` — and Chromatic Orb’s "If you roll the same number on two or more of the d8s" asks about a pair, which no signature here can be handed; its consequence is a second attack out of one casting in any case, so the trigger alone would fire at nothing. **A reroll the roller chooses**: `rerollDice` takes indices because SRD Empowered Spell lets a player pick which damage dice to throw again, and nothing in the command layer asks a caller which, so the one feature that prints it stays filed here. Savage Attacker used to be filed beside it and never belonged there — it throws the **whole** weapon component a second time and keeps one of two totals rather than naming dice — and it is retired: `RollRule` and `rollUnder` are the roll-level scope `DieEffect` could not be handed, an `attack-roll-rule` grant is how a feature asks for one, and `standingWeaponRollRule` supplies `AttackOptions.weaponRollRule` once a turn. **An attack’s scope rather than a spell’s** is the third thing that used to be filed here, and it is retired: `AttackOptions.damageEffects` is supplied now, by `standingDamageEffects`, off an `attack-die-rule` grant a feat may carry and a `WeaponNarrowing` that says "a Melee weapon that you are holding with two hands". SRD Great Weapon Fighting is the sentence that walks through it. Defense was filed beside it under the same weapon clause and never belonged there — its own is about **armour** — and is blocked on a `StandingRequirement` instead.',
  'an-action-a-spell-compels-or-forbids':
    '**Gate G1 read this id as five mechanisms and it is a bundle no longer: four of the five have left it, two of them built by the batch that read them apart.** The action-rule vocabulary says four things now, and the catalogue writes all four: a slot or a named action **taken away** (`forbids`), one slot **narrowed** to a named few and failing closed (`permits-only`), a named action **paid for out of a cheaper slot** (`allows`), and — the member that creates rather than governs — an **extra action** handed to a turn (`grants`), once as a casting resolves or at the start of every turn the casting sees. SRD Expeditious Retreat’s "You take the Dash action" is the first of those and SRD Haste’s "it gains an additional action on each of its turns" the second, and both spells are executed. **Spending somebody else’s budget left on the owner’s ruling of 2026-09-22**: a spell may and a caller may not, `OutcomeRiders.spends` in packages/engine/src/spell-definitions.ts is the vocabulary that charges a slot and performs nothing, and SRD Dissonant Whispers is executed off it. The self-cure went to `a-self-cure-a-spell-forbids` and the rule coupling two slots to an id of its own, which has since been **built and retired**: `ActionRule`’s fifth member is `one-of`, the spenders ask the turn’s own budget whether a coupled slot has gone, and SRD Slow, the Dretch and the Copper Dragons all execute it; the sentences that need somebody to **play** the creature went to `a-creature-somebody-else-is-playing`; and the two mis-filings G1 found went to `an-action-the-engine-has-no-spender-for` before any of it. **Seven spells and two magic items are left under it, and they are four things.** A **lifetime** rather than a rule: SRD Befuddlement’s clause never ends at all, which an Instantaneous casting may not hang, and `RiderDuration` offers four named moments and a span in seconds with no member for a grant that simply does not end. The **attacks counted inside** one Attack action rather than the actions in a turn — SRD Slow’s "it can make only one attack if it takes the Attack action" — which is the spell-side face of the gap docs/archive/design/characters-and-equipment.md names from the feature side, "Extra attacks inside the Attack action. The economy counts one Attack action, not the attacks in it". A Reaction the spell **hands over** for an errand no spender is told apart by — SRD Wall of Stone’s "it can use its Reaction to move up to its Speed", SRD Power Word Heal’s standing up, and SRD Wind Walk’s Magic action "to begin reverting" — which is `allows` polarity over a name that is not one of the engine’s, and is the same want that sent Speak with Animals to the feature book. And two spells whose definitions execute nothing — SRD Confusion and SRD Tsunami, both tracked, both carrying an empty effect list because the sentence that blocks them is the economy whole — which is where the Mace of Terror and the Ring of Elemental Command sit too, each naming the id as a bare blocker for what a creature it has caught must then do with its turns. Narrowed rather than retired, which is `a-mode-on-the-save-a-spell-forces`’ precedent — and a reader should note the four are still four, so nobody should brief this id as a unit either.',
  'an-action-the-engine-has-no-spender-for':
    'an action the book prints that no command takes, so no rule could name it. `NAMED_ACTIONS` in packages/engine/src/combat.ts **names its own absences and the price of leaving one**: a member arrives with its spender, which is why the file says "`hide` was the member that arrived with its spender" and, of the four that stood beside it, "And the last five arrived the same way, in one commit with their five spenders." **It is a spell shape now and was a feature shape**, and the move is the vocabulary rule working rather than a re-filing: the last feature under it was SRD Fast Hands, which wanted a Utilize priced out of a Bonus Action and had nothing to be priced, and `takeUtilize` gave it one. What is left is a **spell** asking for an errand no spender is told apart by — SRD Gaseous Form’s forbidden talking, SRD Haste’s five narrowed actions, and the Reaction SRD Wall of Stone hands over "to move up to its Speed" — together with SRD Ready, which the book prints as an action and the list still leaves out because `takeReady` spends the Action without naming itself.',
  'a-self-cure-a-spell-forbids':
    'a spell that closes **one** way out of a condition and leaves the condition standing. SRD Hideous Laughter: the target drops with the Prone and Incapacitated conditions and "it can’t end the Prone condition on itself". Three vocabularies sit next to this and none of them says it. A rule about a turn governs a **spend**, and standing up is not one of the named actions a spender can be told apart by — it is movement the ruler charges — so nothing forbids it by name. `condition-immunity` refuses a condition **arriving**, where this one has already arrived and is meant to stay. And `DeniedBenefit` in packages/engine/src/spell-definitions.ts switches off what a condition *confers*, where the Prone confers nothing here and what is denied is the exit. Gate G1 read this as the fifth arm of the bundle above, and it is a different verb from all four members of that vocabulary: three of them govern a spend, the fourth creates one, and this one shuts a door the condition layer holds open for everybody.',
  'a-creature-somebody-else-is-playing':
    'a sentence that needs somebody to **decide** what another creature does, rather than to charge it for doing something. The owner ruled on 2026-09-22 that a spell may spend another creature’s budget, and `OutcomeRiders.spends` in packages/engine/src/spell-definitions.ts is that ruling built: a slot goes, the phrase the book prints goes into the log beside it, and the table narrates from that. **This is what the ruling did not reach**, and the distinction is one word. SRD Dissonant Whispers says the Reaction is *used*, which is arithmetic; SRD Command says the target must "follow the command on its next turn", the three Dominates hand the caster a telepathic link that issues orders, SRD Compulsion gives the caster a Bonus Action to "designate a direction" for somebody else to walk in, and SRD Irresistible Dance makes a creature "use all its movement to dance in place". Every one of those is a **choice** made for a creature by somebody who is not playing it — which way it runs, which of five commands it obeys, what a whole turn is spent on — and the doctrine that the engine adjudicates reality and does not play creatures is why no vocabulary here answers it. It is a shape rather than a refusal because two people at a table settle it in a sentence: what is missing is somewhere for the engine to record that a turn is being directed by somebody else, and what a turn so directed may legally contain.',
  // **`a-repeat-save-with-no-condition-to-hang-it-on` was here and is
  // retired**, and it is the fifth of the repeat-save family to go. It asked
  // for a repeat on a failure that imposed **no condition** — there is no
  // instance for the hook to be filed on — and named the host as the gap
  // rather than the trigger. The casting is that host: SRD Ray of
  // Enfeeblement's repeat rides on the casting's own timer and ends the
  // casting, and SRD Slow's rides on the `grants` timer the casting's source
  // keys on one creature and ends the spell on that creature alone, which is
  // what lets a spell catching six carry six of them.
  // `checkSaveCastingRepeat` admits both endings and `repeat_without_condition`
  // now refuses only a third word. Slow is executed.
  'a-turn-a-spell-inserts-into-the-order':
    '`docs/design/time-and-turns.md`: "**In combat the clock is derived.** A round ends when the Initiative order wraps, and six seconds have passed; nobody decides that." A spell that hands its caster several turns in a row has no way to say so without a decision somebody makes, which is the one thing the derived clock refuses. **The second member this id used to carry is built**: a turn placed at a named *position* rather than at a number — SRD Find Steed’s "the steed takes its turn immediately after yours" — is `Combatant.after`, a seat straight after its anchor at the anchor’s own count and tiebreak, with no tiebreak invented. What remains is Time Stop’s: the order is "a list of creatures rather than something a spell adds to", and several turns in a row for one creature is an insertion the derived clock has no member for.',
  'a-choice-made-at-the-casting':
    '**The field exists now, and the id is narrower than it was — kept because an id is a key two branches append to.** `SpellDefinition.choiceStated` is `damageTypeStated` generalised along the axis that field’s own docstring predicted: a printed list, one value named at the casting, anything off the list refused, the answer pinned onto the events and the ongoing record. It carries a **condition**, an **ability** or a **skill**, and `statedChoice` substitutes the caster’s answer into the effect that holds one — which finished Blindness/Deafness’ "(your choice)", Lesser Restoration’s "end **one** condition", Enhance Ability’s five abilities and Guidance’s "choose a skill". **The second arm is built too, and what is left under the id is one spell.** `SpellDefinition.options` is a choice of **which effects run** instead of which value one of them carries: a record of named branches, of which a casting runs exactly one, named on the request as the tenth stated fact, refused off the list and pinned onto the events and the ongoing record beside `choice`. The common `effects` list runs for every branch and the branch’s list runs after it — and where the shared thing is a *saving throw that gates the branch*, the save belongs to the branch, because an effect appended after a save does not know how the save went. SRD Command left by that door (three of its five words run, hung as riders on their own Wisdom save) and so did Thaumaturgy (six branches, one handed over per casting, and `maxRunning` for the three the book lets run at once); Enlarge/Reduce has the shell, with each half’s three clauses filed under shapes of their own. **Glyph of Warding is what is left**, and it is a different mechanism again: its two glyphs are a *stored casting* — a spell held in a rune until somebody steps on it — rather than a branch of this one, and it stays filed until that shape exists. **Hex is the fourth entry and is none of that**: its sentence is Enhance Ability’s with the mode reversed and is writable today, and it stays counted here because `TrackedAdjudication.why` has no value for "nothing blocks this and nobody has written the definition" — see the note on the entry itself. The original description follows: `docs/design/rolls-and-damage.md` names it for the roll-modifier vocabulary — "An ability **chosen at the casting** | Hex, Enhance Ability, Bestow Curse" — and a damage type was always the one choice that was not here.',
  'several-attack-rolls-from-one-casting':
    '**The count and the split are both written now, and what is left of this id is one spell.** `spell-definitions.ts` gives the `attack` member an `AttackRollCount`, scaled by slot level or by Cantrip Upgrade exactly as its dice are, and the resolver throws each roll on its own — its own attack, its own line in the log, its own Critical Hit, its own damage. Scorching Ray hurls three rays and Eldritch Blast throws its beams, and **both have left**. The thing that finished them was the second half the description before this one was still owed: *where* the rolls go when the caster wants them uneven. `CastSpellRequest.rollsAt` states a count beside each creature named, `rollsAimedAt` checks it against the rolls the casting actually makes, and a declaration pins it — so four rays at two creatures go three and one when the caster says so, and two and two when they say nothing. **A count beside the list rather than a repeat inside it**, because a spell has one effect list applied to every target and a duplicate in that list would be a creature every other effect kind ran on twice. What is left is the harder thing and is the whole of Chromatic Orb: a roll aimed at **a creature the casting never named**, chained off a face the dice showed, with a cap counting the leaps and a rule that no creature may be hit twice. That is still the spell-side twin of the class-feature gap `docs/design/characters-and-equipment.md` names: "Extra attacks inside the Attack action. The economy counts one Attack action, not the attacks in it".',

  'a-success-branch-that-does-something':
    '**Built.** spell-definitions.ts says it now: "A success has its own slot and not a member here". `save.onSuccessRiders` is a second `OutcomeRiders` written under a name that says which branch it rides, so the invariant the rider design rests on stands — a settled outcome’s riders are handed over and never asked which one. The validator narrows the slot to the four a printed success writes, a mode, a condition, a movement and a spend, and refuses damage on the book’s authority: no saving throw in it rewards a success with a hit. SRD Ray of Enfeeblement is executed off it. **Two claimants are left** and neither is blocked on this: Flesh to Stone waits on an automatic success, a repeat counted to three and a Petrified that outlives the count; Irresistible Dance waits on a creature somebody else is playing.',
  'a-spells-effects-applied-to-different-targets':
    '`docs/design/spell-definitions.md`: "**A spell has one effect list applied to every target**, so nothing yet expresses “each creature takes damage *and* is knocked Prone” with different outcomes per target beyond the save each one rolls." A casting that chooses per creature, or divides a pool among them, is the same gap.',
  'a-rider-on-a-later-weapon-attack':
    '`PROGRESS.md`, on what the drained shapes left: "a rider on every weapon attack (Divine Favor, Hex, Hunter’s Mark)"; PROGRESS.md ranks it as "Extra damage on the target’s later attacks | 3 / 10 | `damageBonuses` / `extraDamage`, Rage Damage, Radiant Strikes". **IE-035 built the extra-damage half** — the `attack-rider` grant hangs a notation and a damage type on the caster, optionally narrowed to weapon attacks or to a marked target, and Divine Favor, Hunter’s Mark and Hex’s first sentence are all expressible by it. **And the weapon half is built too**: a casting now names the particular weapon it was aimed at (`CastSpellRequest.weapon`), the `weapon-rider` grant hangs on whoever holds it keyed by that weapon’s id, and what it may change is the **substituted ability**, the **replaced damage die** and a **flat** plus of the weapon’s own type reaching the attack roll and the damage roll alike — with a band table apiece, off the slot and off the caster’s level. Shillelagh and Magic Weapon are what that finished. **And the type a swing chooses is built too**: `weapon-rider.damageTypes` is the offer Shillelagh’s second sentence makes, answered on the attack command under the spell’s own name rather than pinned at the casting, and it replaces the weapon’s own type where it is taken. What is left is every rider that is neither of those builds: a damage type chosen at the moment of the attack on a rider that is **not** keyed to one weapon (Conjure Minor Elementals), extra damage with **no type** and so the weapon’s own (Enlarge/Reduce), a rider that fires on damage from **a spell** rather than an attack roll (Bestow Curse), and a substitution on an **Unarmed Strike**, which is not a weapon and so is not a thing a casting can name (Alter Self). **And the casting that *makes* the attack it rides is built**: `weapon-attack` is the door no effect kind opened — the attack command takes the cantrip beside the weapon, spends the Action as the casting’s, substitutes the spellcasting ability into the attack and damage rolls, adds the Cantrip Upgrade’s dice off a band table keyed by character level and offers the type the sentence prints, with nothing granted and nothing left standing. True Strike is what that finished.',
  'a-cap-on-how-many-castings-run-at-once':
    '**Built, and the id is empty.** `replacesPriorCasting` in spell-definitions.ts is the cap the SRD writes twice — "The hand vanishes ... if you cast this spell again" — and it is a cap of **one**, applied by ending the prior casting. `maxRunning` is the same field with a number in it and `replacedCastings` is one arithmetic for both sentences: the oldest castings by this caster of this spell end until the new one is the last that fits. SRD Prestidigitation’s three is the only spell in the book that writes it and is executed off it. Kept rather than deleted because an id is a key two branches append to, and because the reading it records — ending the oldest rather than refusing the fourth — is the one a later homebrew spell will meet.',
  'a-duration-the-slot-changes':
    'PROGRESS.md, on Major Image: "Concentration and duration that **change with the slot level** ... which `SpellDefinition` cannot express". **IE-035 built the half that is a longer span**: `durationAtSlot` is a per-definition table of slot level to seconds, read where the deadline is scheduled, and the six spells printing the SRD’s "Your Concentration can last longer with a spell slot of…" — Hex, Hunter’s Mark, the three Dominates — and SRD Mass Suggestion’s "The duration is longer with…" all read their own table. **And the Concentration half is built too**: `concentrationEndsAtSlot` is the slot from which a spell stops requiring Concentration, which SRD Bestow Curse prints at level 5 and SRD Major Image prints at level 4, beside its other clause. **And the ending half is built now too**: `untilDispelledAtSlot` is the slot from which a casting stops having a deadline at all, which SRD Major Image prints at level 4 beside its Concentration clause — so that spell is executed and the field it wanted is the third of the family, read by `untilDispelledAt` where the deadline would have been scheduled. SRD Bestow Curse’s level 9 slot prints the same "lasts until dispelled" and reads the same field. What is left under this id is an ending that is **not** the absence of one: SRD Geas’s level 9 slot makes the spell last "until it is ended by one of the spells mentioned above" — one spell naming another as its ending, which no field here says and a table of seconds could not.',
  'a-deadline-anchored-to-a-rest':
    '`docs/design/time-and-turns.md`: "`duration.ts` has two types" — "A span of time" and "A moment in the turn order". A rest is neither, and the SRD anchors effects to one constantly. The clock records `lastShortRestAt` and a rest is a span the engine measures, so the fact is there and no deadline can name it.',
  'an-effect-that-fires-when-the-casting-ends':
    '**The hook exists now and the two clauses left want different things through it.** `docs/design/time-and-turns.md` states the difficulty — "**Expiry is derived, like Concentration breaking** ... The log records the effect being scheduled, not expiring" — and `SpellDefinition.onEnd` is the answer: a list of riders pinned onto the ongoing record at the cast and laid by `releaseCasting`, in the fold, wherever the ending came from, under the spell’s bare name so the release that lays them does not lift them. SRD Haste is executed off it, lethargy and all. What it carries is what Haste prints and no more — conditions, a Speed of 0, and the one span the book writes here — and the two claimants below each need a different member. SRD Delayed Blast Fireball wants the ending to **resolve an effect**: a Sphere, a saving throw and damage, which is a whole resolution rather than a rider a reducer can hang, and the fold rolls nothing. SRD Flesh to Stone wants the ending to make a condition **permanent** where the caster held Concentration to the last second, which is a rider whose span is "for ever" and whose condition is one that is already standing.',
  'senses-beyond-declared-sight':
    '**the attacker-side half is built and this is what is left.** `docs/design/light-and-sight.md` draws the line where it now falls: "the attacker-side sense reading (P2-T16), not this". A creature has held senses since `sensesOf` and `SENSES_THAT_SOMEHOW_SEE` landed; what a `RollSelector` had no room for was the *exception* — `unlessPerceivedWith` is that axis, `sensesPerceiving` is the reader, and Blur’s sentence excusing an attacker who perceives you with Blindsight or Truesight is finished by them. What is left is every sense clause that is not a modifier on a roll: a casting that **confers** a sense on a creature (the Darkvision spell, Gem of Seeing), one creature **borrowing** another’s (Find Familiar), and a sense that excuses its holder from an illusion or an area rather than from a die (Mirage Arcane). None of those is an attacker reading a sense off a roll, and none has state to sit in.',
  'what-a-creature-is-holding':
    '**Half of this is built, and the name now means the other half.** What `docs/design/characters-and-equipment.md` recorded — "Nothing checks that two hands are free, either." — is checked now: hands are a count on the sheet, what an item takes up is read off its printed record, a third thing in two hands is refused, and a casting may put a thing *into* a hand and hold it there for as long as it runs, which is what Goodberry’s ten berries and Flame Blade’s blade were waiting on. **The verb that takes something out of a hand is built too, and what is left is whose hand.** `OutcomeRiders.drops` is a rider on a settled outcome: the object the casting named leaves the creature, the *if it can* the sentence prints is `handsFor` off the item’s printed record, `orElse` is what the outcome does instead where it cannot be, and `forcedDrop` performs it through `unequipItem` and `dropItem` so the thing lands on the floor the engine does keep now. SRD Heat Metal is executed off it. What is left is SRD Fear’s "drop whatever it is holding", which names **no object at all**: this rider drops the one thing the caster stated, and a clause that empties both hands of whatever happens to be in them is a second sentence with a second shape. `dropConjured` is still the door for a conjured thing, which simply ceases to exist, and it refuses everything else by name.',
  'targeting-rules-that-differ-within-one-casting':
    'one range and one sight requirement are checked against every named target. The SRD sometimes measures a later target from an earlier one, requires sight of only the first, or prints a reach for the attack that is not the spell’s Range — a third measurement beside the caster and the area point `docs/design/spell-definitions.md` added for Mass Cure Wounds ("The range then belongs to the point rather than to each target"). **The reach half is built and what is left is the other two.** `attack.reach` is the distance a swing goes where the spell’s own Range does not say it — SRD Vampiric Touch’s "within reach" on a Range of Self — checked with the targets settled and before anything is spent, and that spell has left this id. A later target measured from an earlier one, and sight required of the first target only, are the two SRD Chain Lightning still prints and neither is a distance from the caster.',
  // **`a-condition-that-ends-when-its-holder-leaves-an-area` was here and is
  // retired**, which is worth a line because the id read as a gap for as long
  // as it existed and the thing it named turned out to be the wrong shape.
  // SRD Silence was its sole claimant — "creatures have the Deafened condition
  // while entirely inside it" — and a condition imposed by *presence* needs no
  // ending at all: it is derived from where the creature is standing on every
  // read, nothing is applied and nothing is removed, so there is no pair of
  // events for a lifetime rule to keep matched. `AreaStanding`'s `condition`
  // member is what that sentence wanted, and Web's Restrained is a different
  // sentence — applied by a save somebody failed, and ended by a rule that
  // does have a moment to hang on.
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
    '`docs/design/event-log.md`, "Transitions Are Engine-Owned Batches": "Dropping to 0 hit points makes a character Unconscious ... The command layer produces these as coherent batches". The engine owns the transition end to end, and nothing may stand in front of it and change the answer — which is why `docs/design/spell-definitions.md` already files Death Ward as debt: "Death Ward, because the engine drops creatures to 0 itself". **The hook is built and the first sentence walks through it**: `DamageOptions.floor` is a number this blow may not drive a creature below, read after Massive Damage and a monster’s death at 0 have already been settled, so the SRD clause about not being killed outright needs no field of its own; `damageCreature` asks whether the trait is held and still unspent, pins the answer onto `damage-taken.floor`, and the fold hands the same number back — which is what makes a replay byte-identical when the command’s own decision would otherwise be undone. SRD Relentless Endurance is executed off it. What is still missing under this name is **a second reader of the same moment**: Undead Fortitude asks for a saving throw before the floor rather than a use of a limit, and Death Ward ends itself and wants a source that can be dispelled. Dark One’s Blessing stood here too and no longer does: it is the same instant read from the **dealer’s** side, `damage-taken` carries `by` beside the floor for it, and `rewardsForDropping` is the reader that gathers there — which leaves this name for the rules that would stand *in front of* the drop rather than watch it.',
  'a-second-place-to-put-a-creature':
    'there is one scene, so a creature sent elsewhere has nowhere to be. `docs/design/spell-definitions.md`: "A destination *outside* the scene is different in kind ... there is one scene, so Plane Shift and Word of Recall have no position to move anybody to", and `docs/design/casting.md`: "the real fix is the doctrine’s multiple-scenes seam".',
  falling:
    '`docs/design/casting.md` lists the one Reaction trigger left after Counterspell: "Feather Fall | a creature falling | **falling, which is not modelled at all**". **Two of its three halves are built now.** The trigger is a declared fact, `fall-declared` beside `lastDamage`, and the Reaction window derived from it is what let Feather Fall be written; and the landing is a rule — `resolveFall` throws 1d6 Bludgeoning per ten feet to a maximum of 20d6 against a height the table states, and lands the faller Prone unless the drop cost nothing, through the same damage path a Fire Bolt takes. What is still missing is the half both claimants here actually need, which is **a reduction**: Feather Fall takes the fall damage away outright and Slow Fall subtracts five times the Monk level from it, and a number hung on a creature that one damage roll reads is a grant the format does not have. `FeatureReactionWindow` still excludes `creature-falling` for exactly that reason, and the descent rate is a separate absence — nothing measures a descent, so the sixty feet a round has nothing to be measured against.',
  'forced-movement-a-spell-causes':
    '**The rider is built on all three hosts now, and one claimant is left.** `OutcomeRiders.movement` began as a shove a settled outcome carries — ten feet straight away from the caster, spending no Speed and provoking nobody, which SRD Thunderwave writes and which closed the recurring finding `docs/design/space-and-areas.md` recorded, that `moveCreature` took `forced: true` and no `SpellEffect` reached it — and it has since grown the two things the rest of the book asked for: a `kind`, so that SRD Levitate’s "rises **vertically** up to 20 feet" is performed on the one axis a bearing cannot name and the casting holds the creature there until it ends, and a **third host**, because `save` keeps its flat spelling and SRD Gust of Wind’s failure deals no damage at all. Both of those spells are executed. What is left is the Forceful Hand’s "the hand pushes the target up to 5 feet", and it is not this arm: the distance is "5 feet plus five times your spellcasting ability modifier", and `ForcedMovement.feet` is a printed number with no scaling beside it — the same `DiceScaling` question one field along, on a rider that rolls nothing. It is blocked on `a-stat-block-created-mid-fight` besides.',
  'an-activation-that-resolves-an-area':
    '`docs/design/casting.md`: "An activation that resolves an area at a point chosen now | Call Lightning, Storm of Vengeance". `activateSpell` resolves an attack at a named target and moves an area along a stated route; resolving a **fresh** area in a direction chosen now is neither.',
  'an-activation-that-forces-a-saving-throw':
    '`SpellActivation` in spell-definitions.ts carries effects "run with the level and route pinned at the casting", and every registered one resolves an attack or moves an area. A later action that makes somebody save — pushing, grappling or probing a mind — has the machinery beside it and no consumer, which is the state a shape is named in rather than assumed out of.',
  'an-activation-taken-by-somebody-other-than-the-caster':
    '`docs/design/casting.md`, on acting through a spell on a later turn: "Pinned at the casting | ... **the caster — nobody else may act through it**". A spell that hands its *target* the later action inverts exactly that rule, and the pinned numbers are still the caster’s.',
  'a-casting-dismissed-early':
    'the **exceptions** to the general dismissal, which is built: `endOngoingSpell` ends a casting of the caster’s own by id and spends nothing, which is what SRD prints for a **Time Span** duration, and `docs/design/casting.md` is where the three exceptions to it are described — “every one of those three prints an exception to it”. Two of them are built now, and by this id’s own claimants: SRD Gaseous Form’s **target** ends the casting on itself and pays the Magic action the book charges (`dismissibleBy`, `endOngoingSpellOnSelf`), and SRD Magic Mouth’s caster may choose at the casting that a spell running “until dispelled” can be ended at all (`offersEndAfterTrigger`). What the three spells still filed here want is the same ending at a **price the built fields do not carry**: SRD Dream’s messenger “can emerge from the trance at any time, ending the spell” — a creature the casting is on, which `dismissibleBy` says, and for nothing, where that field charges the Magic action both its printings charge; SRD Magic Jar’s caster ends a casting that runs until dispelled by returning to their living body, which no fact stated at the casting unlocks because the book offers its caster no choice to state; and SRD Dispel Evil and Good’s Break Enchantment is the casting spending **itself** to end, which is a cause rather than a door.',
  'a-dc-the-caster-does-not-set':
    'every saving throw a spell forces is measured against the casting’s pinned `saveDc`. The audit names the asymmetry from the other side — "**Three members of the definition format have zero catalogue users**, not one: `roll-mode.save` ..., `SpellCheck.dc` ..., and `’end-casting’` as a `save.repeats.onSuccess` value" — so an *ability check* may already name a printed DC and a *saving throw* may not.',
  'a-condition-benefit-an-effect-takes-away':
    'a benefit the condition layer derives, switched off while the condition itself stays. Three SRD spells print the sentence — Faerie Fire, Starry Wisp, and Mind Spike’s "against you" — and PROGRESS.md already lists Faerie Fire among the clauses the roll vocabulary cannot reach. **The shape itself is built now**: the `benefit` rider hangs a denial off a settled outcome, and `benefitsFrom` is what all three readers of the Invisible condition’s benefits ask — including the Initiative Advantage, which nothing used to reach. What is left is one further shape each. Faerie Fire is finished — `save.condition` is optional, so its Dexterity save hangs this rider, and its 20-foot Cube is an ordinary `area` picking its own targets. **And Mind Spike is finished too**: the further shape it needed was the denial narrowed to the caster alone — what used to be filed as a second shape, the effect’s source as a participant, since retired because `RollSelector.counterpart` and `DeniedBenefit.against` had both answered it — and `DeniedBenefit.against` is it — an id bound from a role at the cast, read by `deniedBenefitsOf` off the creature on the other side of the question, and absent for a roll with no second participant, so the Initiative Advantage the spell does not take away goes on standing. A blanket denial would have been wrong for it rather than merely coarse. What is left is Shining Smite, which hangs the same sentence on an ongoing casting whose beneficiaries are everybody the casting did not target — and needs `attack-damage`, the cast-on-hit host, to carry riders at all.',
  'a-random-outcome-that-is-not-a-d20':
    '**Half built, and the half that is names itself.** PROGRESS.md ranked it "A random outcome that is not a d20 | 1 / 19 | the generator, `parseNotation`", over three different dice: a percentage chance, a 1d10 behaviour table and a 1d100 mishap roll. The **percentage** is built — the `chance` effect throws a d100 against a number the book printed, flat or grown by the castings that have gone before, and the count is the `Tally` a Wind Fan’s uses were already kept in. Augury is executed off it and Gust of Wind’s 50 and Sending’s 5 are writable by it. What is left is every other die in this family, and they are not the same shape twice: a **table** the face indexes into, which needs somewhere for the rows to live, and a die thrown **at a turn boundary** whose face branches — SRD Blink’s 1d6 — which is a payout that can hand over hit points and cannot ask a question. **Two consumers have now left the count without the gap closing, and both are recorded here rather than lost.** Slow prints a 25 percent chance that a casting with a Somatic component fails, and was filed under this id while it had no definition; the spell is executed now, and the executed map has no marker-less entry form — `Adjudication` carries a clause, a shape and a note and `CLAUSE_MARKERS` knows dice, saves, checks and twenty other words but not a percentage, so the reading has nowhere to sit. It is in that spell’s own `unmodelled` list, where `spell-catalogue.test.ts` hands it to the table on every casting, and the day `Adjudication` gains the null marker `TrackedAdjudication` already has is the day it comes back to this count. **Gust of Wind left the same way and for the same reason**: it was tracked and filed here for the 50 percent chance of snuffing a lantern, the push and both saving throws are executed now, and the clause went with it into that spell’s own `unmodelled` list. So the census fell by one on a day nothing was built, which is what this paragraph exists to say out loud.',
  'a-rest-an-effect-gives-or-denies':
    'a rest is a span the engine measures and its payout is `endRest`’s — `docs/design/time-and-turns.md`, "**A rest is a span, not a button**". No effect confers the benefits of one without the hours, and none takes them away from a rest that was completed.',
  'damage-with-neither-an-attack-roll-nor-a-save':
    '**built for the spell vocabulary, and this is what is left of it.** PROGRESS.md ranked it at 19 open spells and Magic Missile was the one it named; the `auto-damage` effect is that sentence — typed damage with a flat addend and nothing rolled to decide whether it lands, dealt as a pool of separate hits among the creatures the caster named, with the count and the split an `attack` already carried. Magic Missile is executed off it, Heat Metal’s opening 2d8 is expressible by it and waits on the two clauses beside it, and Shield’s clause has left this id for the shape that actually blocks it. What is left is the **item** half, which is a different door: `packages/engine/src/content.ts` admits fourteen effect kinds to a conferral and this is not one of them, so a Potion of Poison’s 4d6, a talisman that burns whoever touches it and a manual that scorches whoever cannot read it are still filed here. A conferral has no casting, no slot and no caster level for a `DiceScaling` to read, which is what admitting the kind has to answer for rather than assume.',
  'an-area-moved-by-the-casters-own-movement':
    'spell-definitions.ts keeps two allowances apart because the SRD does — `CastingOrigin.movableBy`, a rider on an action that also strikes, and `SpellActivation.movesArea`, where "the move *is* the action". A pack or a pillar that comes along when the caster walks, costing no action at all, is a third sentence and neither field says it.',
  'an-outcome-that-breaks-concentration':
    '**Built, and what is left of the id is two readings rather than a gap.** `PROGRESS.md` named it among the mechanics the drained shapes left behind: "an outcome-scoped child effect (Ice Knife’s explosion, Hideous Laughter’s two conditions, **Sleet Storm’s broken Concentration**)" — `OutcomeRiders` landed with conditions, modifiers and delayed damage, and ending the target’s Concentration was the one consequence in that sentence that got no slot. `OutcomeRiders.breaksConcentration` is that slot now: read off the creature at the moment the outcome settles, landed as the `concentration-ended` every other ending writes, and silent where the target was holding nothing. Sleet Storm is executed off it. The two claimants left are each blocked on something else — SRD Earthquake is level 8 and nobody has re-read its paragraph since, and the Thunderous Greatclub’s tremor waits on an item being able to force a save at all.',
  'a-check-another-creature-may-attempt':
    '`docs/design/spell-definitions.md`, on the check a spell offers: "**Who may attempt it is derived from what the timer sits on** — an effect on a creature is that creature’s to shake off, a casting with no victim is anybody’s to see through." An ally reaching in to cut somebody free, or shaking a sleeper awake, is neither, and the derivation has no third branch.',
  'an-area-trigger-measured-from-a-point':
    '`docs/design/casting.md` names it spell by spell: "Ending a turn within 5 feet of a point, and a point rolled into a creature’s space | Flaming Sphere". `AreaTrigger` hangs off a template, and a reach measured from the casting’s own origin is what `CastingOrigin.reach` answers for an attack and for nothing that fires on its own.',
  'a-distance-a-creature-travels-inside-an-area':
    '`docs/design/space-and-areas.md`, on what a persistent area cannot see: "**The path.** Movement records where a move started and where it ended and nothing in between", and `docs/design/casting.md`: "Distance travelled inside an area, which no move records | Spike Growth". Inferring the crossing from a straight line would be the engine inventing a route nobody took.',
  'light-and-obscurement-the-scene-holds':
    '**built as P3-S, and this is what is left of it.** The description before this one said light and obscurement were facts nothing in state held — "no square is lit or unlit, and so Darkvision has never had the rule it is a rule about and no casting can shed, quench or obscure anything" — and `docs/design/light-and-sight.md` is the design the owner ruled on, all five decisions, on 2026-09-21. Every one of them is executed: light and obscurement are records of patches on the lattice beside `terrain`, each carrying a region and the `source` casting that lapses it; `lightAt` takes the strongest of the ambient and the patches with the book’s own exception, that nonmagical light does not lift magical darkness; `obscurementAt` takes the greater of what was declared and what the level implies; the sight question gained one step between the declaration and the sense, where Blindsight and Truesight defeat anything, Darkvision turns nonmagical darkness into dim and Devil’s Sight defeats the magical kind; sunlight is Bright Light with a flag, which a `StandingRequirement` reads; and an undeclared scene is undeclared rather than bright. Darkness, Daylight, Fog Cloud and Web’s obscurement half are written on it, and Hide no longer needs the table to state a fog it can see. **And a sixth thing left by the same build**: a glow hung off a settled outcome rather than off a casting, which is SRD Faerie Fire’s "objects and **affected** creatures shed Dim Light in a 10-foot radius" — `OutcomeRiders.light`, landed through the same `lightShedOn` the effect kind takes, so that spell has left this id. **What is left is not about light at all: it is the object.** SRD Light, Continual Flame and Dancing Lights shed from *a thing* — a touched object, four floating motes — and Darkness and Daylight each print an alternative form originating from one, with a bowl that can be put over it; the note’s own vocabulary is "a point, or carried by a creature", because the engine holds no objects for a patch to hang on and inventing a position for one would be the table’s job done badly. The second residue is the **trigger**: the mutual dispel runs "on pinning a patch", so a spell that puts darkness out without laying any light of its own — Sunburst’s flash — can reach `lightDispelledBy` by no route. Beyond the spells the same note listed what waited on a stat block rather than on this shape, and **that half is built**: the parser types the sunlight sentences, the five unconditional Illuminations and Shadow Stealth, and `adaptMonster` compiles Sunlight Sensitivity and Sunlight Weakness onto the sheet as the standing effects the `in-sunlight` requirement gates — so a kobold read out of the catalogue by id has its Disadvantage, and Daylight is sunlight (the owner, 2026-09-22, on the book’s own word against the 2014 errata). Three residues are left and each is a rule rather than a sentence. **The shed light has nowhere to go**: a patch is declared and never derived, so the five Illuminations and the magmin’s gated sixth are read and spent by nobody, and lighting a creature’s own space from its sheet is a derivation `lightAt` does not make. **Shadow Stealth is an economy**: the Hide is built and the Bonus Action that buys it in Dim Light or Darkness needs a light-gated grant no `StandingRequirement` states. And **the vampires burn**: their Sunlight prints Sunlight Sensitivity behind "takes 20 Radiant damage if it starts its turn in sunlight", which is damage dealt at a turn boundary, so the line is refused whole rather than read down to the half that fits.',
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
   * **A tracked entry with no marker is found by its clause instead**, which
   * is the marker-less form arriving here: `marker` is the key a tracked
   * entry is looked up by and `null` is not a key. Without that the lookup
   * would miss the entry entirely and fall through to the branch that
   * forgives a clause whose *spell* has since been written — which would be a
   * silent pass on a re-filing that had quietly not happened.
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
  /**
   * The bundle gate G1 read as five mechanisms, recorded once it had somewhere
   * to send more than one of them.
   *
   * **P2-T0 could not write this and said so in as many words**: the split
   * needed a second destination and the only one it had was
   * `a-rider-that-lasts-until-the-start-of-the-targets-next-turn`, where
   * Shocking Grasp had already gone. The second is a **feature** shape, and
   * filing a spell against one is the widening of `TrackedAdjudication.why`
   * the owner took rather than enumerate the field a fourth time — so the
   * record and the type landed together, which is why they are one commit.
   *
   * **Thirteen adjudications over twelve spells, and the id survives.** That
   * is `a-mode-on-the-save-a-spell-forces`' precedent rather than
   * `speed-and-movement-modes`': what the reading found is that the
   * description claimed arms the vocabulary had grown into, not that the
   * mechanism was imaginary.
   *
   * **The batch that read the arms apart then paid two of them and split the
   * rest.** An extra action **created** is built — `grants` is the fourth
   * member, Expeditious Retreat and Haste are executed, and neither clause
   * is an adjudication any more, so neither appears below: nothing moved,
   * something was finished. The same of Dissonant Whispers, on the owner's
   * ruling of 2026-09-22 that a spell may spend another creature's budget.
   * What the ruling did **not** reach is a sentence that needs somebody to
   * decide what a creature does, and that is six adjudications across six
   * spells with an id of their own now; the self-cure and the coupled slots
   * are one apiece.
   *
   * What is left under the id is enumerated in the id's own description, and
   * nowhere else: a second count written here would be a second thing to keep
   * true, which is exactly how the sentence this one replaces went stale. The
   * `held` list below holds only what moved, which is what the guard over
   * these records demands and the only arithmetic this record is answerable
   * for.
   */
  'an-action-a-spell-compels-or-forbids': {
    adjudications: 13,
    spells: 12,
    held: [
      // The arm that left first, at gate G1: what Shocking Grasp lacks is one
      // word of a duration vocabulary and not a rule about the economy.
      [
        'shocking-grasp',
        'cannot make Opportunity Attacks',
        'a-rider-that-lasts-until-the-start-of-the-targets-next-turn',
      ],
      // And the three the widening released, all to one destination: an
      // action the book prints that no command takes.
      [
        'gaseous-form',
        'the things the cloud cannot do are not forbidden',
        'an-action-the-engine-has-no-spender-for',
      ],
      [
        'haste',
        'the five that extra action may be spent on',
        'an-action-the-engine-has-no-spender-for',
      ],
      // The tracked population's slot is a **marker** key — except where the
      // entry has no marker, which is this one and is why the lookup takes
      // the clause as well. See `SplitBundle.held`.
      ['speak-with-animals', 'skill options with them', 'an-action-the-engine-has-no-spender-for'],
      // Arm five, filed rather than built: a cure closed while the condition
      // it belongs to stands, which is neither a spend governed nor an
      // arrival refused.
      [
        'hideous-laughter',
        'unable to end the Prone condition on itself',
        'a-self-cure-a-spell-forbids',
      ],
      // And its neighbour, which the same reading said to file rather than
      // force: a rule about two slots at once, where every member of the
      // vocabulary is about one slot considered alone.
      [
        'slow',
        'it can take either an action or a Bonus Action, not both',
        'a-rule-that-couples-two-slots-of-a-turn',
      ],
      // The six that outlived the ruling. A spell may spend another
      // creature's budget; none of these is a budget, and all six are
      // somebody deciding what a creature does with a turn.
      [
        'compulsion',
        'the Bonus Action that designates a direction',
        'a-creature-somebody-else-is-playing',
      ],
      ['dominate-beast', 'the telepathic link', 'a-creature-somebody-else-is-playing'],
      ['dominate-monster', 'the telepathic link', 'a-creature-somebody-else-is-playing'],
      ['dominate-person', 'the telepathic link', 'a-creature-somebody-else-is-playing'],
      // The tracked population's slot is a **marker** key — see
      // `SplitBundle.held`, and the two Command entries, which are why the
      // key has to tell one clause of a spell from another.
      ['command', 'saving-throw', 'a-creature-somebody-else-is-playing'],
      ['command', 'condition', 'a-creature-somebody-else-is-playing'],
      ['irresistible-dance', 'roll-mode', 'a-creature-somebody-else-is-playing'],
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
  /**
   * Fiction the engine should never decide, or the shape that blocks it.
   *
   * The shape may belong to any of the three books — see {@link BlockerId}.
   * Two executed spells need it and both are gate G1's re-filings: Gaseous
   * Form's forbidden talking and Haste's five narrowed actions are blocked on
   * `an-action-the-engine-has-no-spender-for`, which was a feature shape and
   * is a spell shape now — the last feature under it, SRD Fast Hands, left
   * when `takeUtilize` gave the Utilize a spender to be priced against.
   */
  readonly why: 'table' | BlockerId;
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
  befuddlement: [
    {
      clause: 'stops the target casting spells',
      why: 'an-action-a-spell-compels-or-forbids',
      note: 'SRD: the target "can’t cast spells or take the Magic action". **The rule is writable and the lifetime is not.** `forbids` names the Magic action and leaves the rest of the Action slot alone, which is the sentence `NAMED_ACTIONS` cites this spell for. What refuses it is `checkGrantLifetimes`: the casting is Instantaneous, so a grant must carry a deadline of its own, and the book gives this one none — the effect runs until a save thirty days off succeeds, which is the clause below. `RiderDuration` offers four named moments and a span in seconds, and no member for a grant that simply does not end.',
    },
    {
      clause: 'end of every 30 days',
      why: 'a-repeat-save-on-the-clock',
      note: 'A repeat save is raised by a turn boundary. This one runs on elapsed time, which `Deadline` can express and `RepeatSave` cannot, and the Greater Restoration that ends it sooner is the same missing hook from the other side.',
    },
  ],
  'bestow-curse': [
    {
      clause: 'the opening Wisdom save the other three roll',
      why: 'a-repeat-save-that-does-something-on-a-failure',
      note: 'the same debt seen from the branch rather than from the clause. Each of this spell’s four faces carries the save that gates it, because a save in the common list would be one roll no branch could read — so a branch that can resolve nothing rolls nothing, and the third face resolves nothing because the sentence after its save is the shape below. The two entries are one gap and are filed apart because the honesty guard reads a clause at a time.',
    },
    {
      clause: 'at the start of each of the target’s turns is not raised',
      why: 'a-repeat-save-that-does-something-on-a-failure',
      note: 'the third of the four faces, and the one branch of the spell that is still a debt. A repeat save hung on a casting ends the casting on a success and this one ends nothing — a third value the vocabulary does not carry — and its failure compels the Dodge action for that turn, where a failure branch applies a condition. Both halves are the shape’s own sentence.',
    },
  ],
  'black-tentacles': [
    {
      clause: 'the area is Difficult Terrain',
      why: 'difficult-terrain-an-area-creates',
      note: 'SRD: "these tentacles turn the ground in that area into Difficult Terrain". The writer exists — `areaTerrain` on the definition pins the region the casting resolved and the ruler charges for it — and this definition does not carry it: the spell is level 4 and out of level-5 reach, so nobody has read it since. A reading, not a gap, and the shape’s own description says so.',
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
  'chromatic-orb': [
    {
      clause: 'reads the individual dice of a damage roll',
      why: 'a-die-behaviour-a-spell-asks-for',
      note: 'the leap fires on "If you roll the same number on two or more of the d8s", which asks about a **pair** of faces. A definition can ask about a face now — `dieRule`, which Sorcerous Burst writes — and this is the reading it cannot make: a `DieEffect` judges one die at a time, `substitute` and `bonusOn` are both `(rolled, sides)`, and neither is handed the roll its die is part of. A predicate over a whole roll is a fourth kind, and it would fire at nothing on its own — the leap beneath it is the blocker below.',
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
  // **Executed by the second arm of a choice made at the casting**, and the
  // entry it leaves behind is what that arm does not reach. Three of the five
  // words run — Halt's rule, Drop's empty hands, Grovel's Prone, each hung on
  // the Wisdom save inside its own branch — and what is left of all five is
  // one sentence: "follow the command **on its next turn**". Every word is
  // obeyed inside a turn somebody else is directing, which is the id these
  // entries already named before any of it was built.
  command: [
    {
      clause: 'the Wisdom saving throw is not rolled for Approach',
      why: 'a-creature-somebody-else-is-playing',
      note: 'SRD: "The target moves toward you by the shortest and most direct route, ending its turn if it moves within 5 feet of you." The whole of what a failure buys is a route and a turn spent walking it, and a failure that imposes nothing is a die thrown for nothing — which the definition validator refuses rather than accepts. So this word has no effects at all, and the save goes to the table with the sentence.',
    },
    {
      clause: 'the Wisdom saving throw is not rolled for Flee',
      why: 'a-creature-somebody-else-is-playing',
      note: 'SRD: "The target spends its turn moving away from you by the fastest available means." Approach’s reading with the direction reversed: a whole turn spent running is a creature being played, the engine adjudicates legality and walks nobody anywhere, and a save with nothing to gate is not rolled.',
    },
    {
      clause: 'the hands are emptied at the casting rather than on the target’s next turn',
      why: 'a-creature-somebody-else-is-playing',
      note: 'Two clauses of one sentence. SRD defers every word to the target’s next turn and a rider settles with the save that raised it, so the mace is on the floor a round before the book puts it there; and "and then ends its turn" is the rest of that same directed turn, which `OutcomeRiders.spends` cannot say — the one slot a spell may not spend is the movement, and a turn ended is the movement gone with the rest.',
    },
    {
      clause: 'the Prone lands at the casting rather than on the target’s next turn',
      why: 'a-creature-somebody-else-is-playing',
      note: 'Drop’s reading on the other word: the Prone is an ordinary condition hung on an ordinary failed save, and what is early is *when* — the book has the creature grovel on its own turn, inside the turn the caster is directing. The turn it then ends is the same missing thing, for the same reason.',
    },
  ],
  compulsion: [
    {
      clause: 'the Bonus Action that designates a direction',
      why: 'a-creature-somebody-else-is-playing',
      note: 'SRD: "you can take a Bonus Action to designate a direction", and "Each Charmed target must use as much of its movement as possible to move in that direction on its next turn". A spell may spend another creature’s budget now, and this is not that: which way somebody walks is a **decision** made for them by the caster, and the engine adjudicates reality rather than playing creatures.',
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
  // **The last spell in the book whose effects the engine could execute, now
  // executed** — and the entry it left behind is a re-filing rather than a
  // transcription. `BLOCKED_ON` had its Disengage under
  // `an-action-a-spell-compels-or-forbids`, and `ActionRule`'s `allows` was
  // derived from this very sentence: the mechanism is built. What is actually
  // missing is somewhere to put a grant that lands on the **caster** while an
  // Emanation catches everybody else, which is one effect list applied to
  // every target.
  'conjure-woodland-beings': [
    {
      clause: 'take the Disengage action as a Bonus Action',
      why: 'a-spells-effects-applied-to-different-targets',
      note: 'The allowance itself is an `action-rule` the engine has and `STATABLE_PRICES` prices; what it has no home in is this spell. A definition with an `area` has its targets picked by the area, an Emanation excludes the creature it originates from, and `effects` reaches whoever the area caught — so a grant on the caster and an Emanation on everybody else cannot both be written, which is the shape named here rather than the economy the bare entry blamed.',
    },
    {
      clause: 'declines to force a save on',
      why: 'table',
      note: 'SRD writes "you can force that creature to make a Wisdom saving throw" rather than "must", so whether the spirits strike a given creature at all is the caster’s word. The engine resolves every save the trigger raises and declining is a command nobody sends, which is the same reading Conjure Fey’s optional attack already has.',
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
  // One of the three spells P3-S moved out of the tracked bucket, and the only
  // one whose leftover sentence still trips a marker. Darkness's twin of it
  // does not, so it carries no entry at all.
  'continual-flame': [
    {
      clause: 'the flame springs from an object, and objects are not modelled',
      why: 'table',
      note: 'SRD: "A flame springs from an object that you touch." The light is executed — a `light` effect carried by the creature the casting names as the bearer, laid on a region whose origin is that creature and gone only when the casting is dispelled — and the object itself is the table’s: which thing was touched, and whether it is set down for good, in which case the DM lights the point with `declare_light`. "The flame can be covered or hidden but not smothered or quenched", and covering it is a fact about an object.',
    },
  ],
  'dancing-lights': [
    {
      clause: 'You create up to four torch-size lights within range',
      why: 'table',
      note: 'SRD: "You create up to four torch-size lights within range, making them appear as torches, lanterns, or glowing orbs that hover for the duration." The engine lays one dim patch for all four at the point the caster names and moves it with the spell’s Bonus Action (`activation.movesArea`) — "As a Bonus Action, you can move the lights up to 60 feet to a space within range." Where the four motes are relative to each other is the table’s, and so is the sentence "A light must be within 20 feet of another light created by this spell, and a light vanishes if it exceeds the spell\'s range."',
    },
  ],
  daylight: [
    {
      clause: 'the 60-foot Emanation it carries',
      why: 'table',
      note: 'the object half, as Darkness prints it and for its reason: an Emanation originating from a thing state does not hold, and a bowl or a helm over it. The sixty feet of Bright Light, the sixty more of Dim and the dispel against a Darkness of level 3 or lower are all executed.',
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
  'dominate-beast': [
    {
      clause: 'whenever it takes damage',
      why: 'a-repeat-save-raised-by-a-trigger',
      note: 'SRD: "Whenever the target takes damage, it repeats the save, ending the spell on itself on a success." The save is raised by a damage event rather than by a boundary, and the turn hook is the only thing that raises one.',
    },
    {
      clause: 'the telepathic link',
      why: 'a-creature-somebody-else-is-playing',
      note: 'SRD hands the caster a telepathic link that issues orders, and a Reaction the caster spends to make the dominated creature act. The budget is reachable now — a spell may spend one — and what is not is the order itself: what the beast then does with its turn is a choice made for it by somebody who is not playing it.',
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
      why: 'a-creature-somebody-else-is-playing',
      note: 'Commanding the target, and spending your own Reaction to make it take one of its Reactions. The second half is a budget and a spell may spend one now; the first is the caster deciding what the target does, which is the half no vocabulary here answers.',
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
      why: 'a-creature-somebody-else-is-playing',
      note: 'The commands the link carries are the target’s actions — not the slots they come out of, which a spell may now spend, but which action is taken and at what. That is a decision, and it is made by somebody who is not playing the creature.',
    },
  ],
  'feather-fall': [
    {
      clause: 'a creature you can see',
      why: 'table',
      note: 'the Reaction’s printed trigger names a falling creature its caster can see within 60 feet, and the engine checks both halves it can count: the range against every target, and that each of them is falling. What it does not check is that the caster perceived **this** fall — the same condition Counterspell’s trigger carries, on the same window machinery. A fall is a fact the table declares, and who saw it happen is declared with it.',
    },
  ],
  'find-familiar': [
    {
      clause: 'seeing through the familiar’s eyes and hearing what it hears',
      why: 'senses-beyond-declared-sight',
      note: 'Sight here is a pairwise declaration and there is nothing else, so one creature borrowing another’s senses — including any special senses it has — has no state to sit in. Filed under the nearest honest shape rather than a new one; the shape’s named consumer is an attacker’s Blindsight, and this is the same absence at the other end.',
    },
    {
      clause: 'your familiar can deliver the touch',
      why: 'an-activation-taken-by-somebody-other-than-the-caster',
      note: 'A second casting measured from the familiar rather than from its caster, and a Reaction spent by the familiar for a spell that belongs to the caster. The rule that a casting is acted through by the caster and nobody else is exactly what this inverts, and the reach half has no field of its own either.',
    },
    {
      clause: 'you can temporarily dismiss the familiar to a pocket dimension',
      why: 'a-second-place-to-put-a-creature',
      note: 'There is one scene, so a creature that is stored rather than destroyed has nowhere to be. It is not `end-condition` and not a death: the familiar keeps existing somewhere the engine has no representation for, and comes back on a later action. Dismissing it forever is the departure the engine already performs and is not the gap.',
    },
    {
      clause: 'the telepathic connection within 100 feet',
      why: 'table',
      note: 'The hundred feet is measurable and what it gates is conversation, which the engine’s resolution path never arrives at.',
    },
  ],
  'find-steed': [
    {
      clause: 'the block’s own lines are not on the steed',
      why: 'a-stat-block-created-mid-fight',
      note: 'The block the book prints beneath the spell carries Life Bond, Otherworldly Slam and three Bonus Actions gated on the type, and every number in them is the summoner’s — the spell attack modifier, the spell’s level, the spell save DC. A stat block holds no field that names its rider, so the transcribed block carries none of them and the steed arrives with no attack. The creation, the kept lifetime, the type, the Fly Speed and the seat after the rider are all built; a printed line whose numbers are the summoner’s is what the shape still means here. The parser never sees these lines either: the spell’s parsed entry stops where the table begins.',
    },
    {
      clause: 'acts independently, focusing on protecting you',
      why: 'table',
      note: 'What a creature in the scene chooses to do on its turn is nobody’s arithmetic. The engine declines to decide it for a summoned steed on exactly the reading it declines to decide it for every monster — `declareSpellcasting` states what an NPC casts and `declareCreatureSide` states whose side it is on, and what either of them does with a turn is the table’s.',
    },
  ],
  'finger-of-death': [
    {
      clause: 'rises as a Zombie',
      why: 'a-stat-block-created-mid-fight',
      note: 'SRD: "A Humanoid killed by this spell rises at the start of your next turn as a **Zombie**", one "that follows your verbal orders". Nothing creates a creature from a stat block during play, which is the summons seam every Conjure waits on.',
    },
  ],
  'fog-cloud': [
    {
      clause: '"until a strong wind (such as one created by Gust of Wind) disperses it"',
      why: 'table',
      note: 'the wind is fiction here: nothing in the engine makes one, Gust of Wind itself is not executed, and a casting the engine ends is one it can see ending. The fog is on the lattice now, twenty feet of Heavily Obscured and twenty more for every slot level above the first, so this is the one sentence of the paragraph left to a person.',
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
      note: 'SRD lets the caster keep the globe in hand to be thrown or slung later, or left to detonate on its own. A hand is a fact now and a casting may put a thing in one, but what sits there is an ordinary catalogue item with no state of its own \u2014 and this globe is a held *casting*, which detonates on a later action, may be thrown, and goes off by itself if it is not. Holding it is the half that is built; the rest of the sentence is not.',
    },
  ],
  // One clause lighter: "The spell ends on the target if it drops to 0 Hit
  // Points" is `target-drops-to-0`, read off a `damage-taken` that leaves the
  // creature at 0, and the release is on that target rather than on the
  // casting — which a level 4 slot is what makes visible.
  'gaseous-form': [
    {
      clause: 'the things the cloud cannot do are not forbidden',
      why: 'an-action-the-engine-has-no-spender-for',
      note: 'two of the four, and the other two are built: "Finally, the target can\u2019t attack or cast spells" is one `forbids` rule naming the Attack action and, through the field this track gave that arm, the casting. What is left is "The target can\u2019t talk or manipulate objects" and "any objects it was carrying or holding can\u2019t be dropped, used, or otherwise interacted with" \u2014 talking is not an action anything spends, and what is in a creature\u2019s hands is a fact the engine does not hold. The Magic action its target takes to end the spell is no longer here either: `endOngoingSpellOnSelf` is that door and it charges that price.',
    },
  ],
  'gentle-repose': [
    {
      clause: 'the days are taken back only while this casting is still running',
      why: 'healing-that-raises-the-dead',
      note: 'the sentence is executed while the casting runs — `preserves` marks the body, the record pins the moment, and `preservedSpan` takes the span back out of the time since `Vitals.diedAt`. What is left is the word **spent**: the span is read off the castings running on the body now, so a repose that has ended hands the window back, and a corpse ten days under one and then dispelled is refused a resurrection the book allows. Carrying that needs a span accumulated on the creature and written by an event, which is a primitive the vocabulary has not got — and the window is this shape\u2019s own mechanism, which is why the residue is filed here rather than anywhere new.',
    },
  ],
  'gust-of-wind': [
    {
      clause: 'must spend 2 feet of movement for every 1 foot it moves when moving closer to you',
      why: 'difficult-terrain-an-area-creates',
      note: 'a doubled cost is Difficult Terrain by another name and an area may write one — what this sentence adds is **which way the creature is walking**. A patch is a property of the square: it charges whoever crosses it, and no field on it can say "only while moving closer to you", which is a fact about the mover. That is the directional arm of this shape and `areaTerrain` does not reach it.',
    },
  ],
  harm: [
    {
      clause: 'Hit Point maximum reduction',
      why: 'a-hit-point-maximum-a-spell-moves',
      note: 'SRD: "its Hit Point maximum is reduced by an amount equal to the Necrotic damage it took", and "This spell can’t reduce a target’s Hit Point maximum below 1." The maximum is the engine’s own number, read by healing, by Massive Damage and by every threshold, and no effect moves it.',
    },
  ],
  // **Two of Haste's three left on the day the third did**, and both were
  // built rather than re-filed: `SpeedChange` gained `double` with the rule
  // that settles how it meets a halving, and the five actions the extra one
  // may be spent on are `GrantedAction.only` — all five of them, because
  // `NAMED_ACTIONS` holds Utilize and `takeUtilize` is a spender that names
  // itself as one. The note that said otherwise was written before that
  // spender existed.
  haste: [
    {
      clause: '(one attack only)',
      why: 'an-action-a-spell-compels-or-forbids',
      note: 'SRD: "That action can be used to take only the Attack (one attack only), Dash, Disengage, Hide, or Utilize action." The list is written; the parenthesis is not, and it is the sentence SRD Slow prints from the other end about the attacks inside one Attack action. What both want is a **count** of those, and the economy counts one Attack action and not the swings in it.',
    },
  ],
  'heat-metal': [
    {
      clause: 'an object nobody is wearing or wielding',
      why: 'table',
      note: 'SRD: "Any creature in physical contact with the object takes 2d8 Fire damage when you cast the spell." **What the engine keeps is what a creature has equipped** — armour on a body, a weapon in a hand — and that is the whole of the contact it can see. A metal gate, a chain across a door and a coin in a pouch are all objects nothing here is holding, so who is touching one is the DM’s and always will be. What follows from the contact is the engine’s and is executed: the wearer takes the dice, fails the save, and lets go of the thing if it can.',
    },
  ],
  // **The damage trigger is built and this spell is what built it.**
  // `RepeatSave.alsoWhenDamaged` is a second moment beside the turn boundary,
  // carrying the mode the sentence prints, and `repeatsRaisedByDamage` rolls
  // it where the blow lands rather than owing it as a debt — because a debt is
  // keyed by the turn and a creature struck twice in one turn owes two saves.
  'hideous-laughter': [
    {
      clause: 'unable to end the Prone condition on itself',
      why: 'a-self-cure-a-spell-forbids',
      note: 'SRD: "it can’t end the Prone condition on itself." Standing up is something a creature does and no rule about a turn can forbid it: it is movement the ruler charges rather than one of the named actions a spender is told apart by. Gate G1 read this as the fifth arm of the bundle it used to sit in, and it is filed under its own id now — a **cure** closed while the condition stands, which is neither a spend governed nor an arrival refused.',
    },
  ],
  'hunters-mark': [
    {
      clause: 'Advantage on a Wisdom (Perception or Survival) check made to find the quarry',
      why: 'a-fact-only-the-table-can-declare',
      note: 'SRD: "You also have Advantage on any Wisdom (Perception or Survival) check you make to find it." A `RollModifier` selects a check by ability and by skill, so Wisdom (Perception) and Wisdom (Survival) are each perfectly expressible — two grants, one sentence. What no selector can say is which of those checks is the one being made *to find the quarry*, and that is a fact about the attempt rather than about the roll. Granted unconditionally it would hand the ranger Advantage on every Perception check they roll for the hour the spell runs, which is the silent wrong answer this discipline exists to refuse.',
    },
  ],
  // **Hypnotic Pattern is off this map entirely**, and both of the clauses it
  // used to carry left by different doors. "Only a creature that can see the
  // pattern" is `mustSeeTheOrigin`: the pattern is at the casting's origin and
  // the catch asks each creature whether it can see that point, with a blind
  // one passed over, a fog bank over the pattern hiding it, and a silence
  // caught and reported rather than read as a no. The other half of its last
  // sentence — "someone else uses an action to shake the creature out of its
  // stupor" — is `wakeCreature` now: an onlooker's Action, five feet measured
  // from them, and the `shaken-awake` cause the casting's record names. So the
  // spell leaves nothing unmodelled at all, which is the whole of why it is
  // not on this map.
  'ice-storm': [
    {
      clause: 'becomes Difficult Terrain',
      why: 'difficult-terrain-an-area-creates',
      note: 'SRD leaves the ground difficult "until the end of your next turn", and **that** is what is missing rather than the terrain: a patch lapses with the casting that made it or not at all, and this casting is Instantaneous, so there is no record for the end of anybody’s next turn to end. The one arm of this shape a patch genuinely cannot describe.',
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
      note: 'SRD: "its area is Lightly Obscured and Difficult Terrain". The swarm’s saves and damage all run, and the ground is writable now — `areaTerrain` says it — on a definition nobody has re-read: the spell is level 5 and out of level-5 reach. The obscurement half waits on `light-and-obscurement-the-scene-holds` whatever happens to the first.',
    },
  ],
  // The spell this map predicted IE-017 would finish and which IE-042 actually
  // did, arriving in the executed population with **one** clause left — and it
  // is the table's rather than a shape's, which is the honest end of a
  // prediction that was wrong for two tranches.
  //
  // **And that last clause is gone.** "An unwilling creature that succeeds on
  // a Constitution saving throw is unaffected" was filed under
  // `a-fact-only-the-table-can-declare` and named exactly what was missing:
  // "the word on the request that names who consents". `CastSpellRequest.willing`
  // is that word, `save.unlessWilling` is the clause that reads it, and the
  // table declares consent by naming it — which is the shape working as
  // described rather than a shape being removed.
  levitate: [
    {
      clause: 'what the levitating creature may do with its own Speed',
      why: 'movement-modes',
      note: 'SRD: "The target can move only by pushing or pulling against a fixed object or surface within reach" — "which allows it to move as if it were climbing". The climbing is the shape: the engine distinguishes no Climb Speed and charges no surcharge for one, so there is nothing to narrow a levitating creature’s movement **to**. What the lift itself opened is the other side of the same absence — `checkRise` refuses a creature ending a move higher than it began and asks nothing of one already off the ground, so a creature the spell is holding may walk sideways through the air on its ordinary Speed and descend for free. **And the clause that used to sit beside this one has joined it.** "You can change the target’s altitude by up to 20 feet in either direction on your turn" was filed under an activation shape and half of it is built: `change-altitude` is the Magic action, refused past the cap, past the Range and on a creature the casting is not holding. What is left is the sentence that follows it — "If you are the target, you can move up or down as part of your move" — which is the *creature’s own* movement and needs the feet it has already risen this turn counted against the twenty. A `GrantedLift` records whose magic is holding the creature and nothing else, so widening `checkRise` for that holder would allow a rise nobody could cap. One missing distinction, now with three sentences waiting on it rather than two.',
    },
  ],
  light: [
    {
      clause: 'the spell targets an object, and objects are not modelled',
      why: 'table',
      note: 'SRD: "You touch one Large or smaller object that isn\'t being worn or carried by someone else." The light is executed — a `light` effect carried by the creature the casting names as the bearer, bright to 20 feet and dim to 40, moving with them and gone with the hour — and the object is the table’s: which thing was touched, whether somebody else is carrying it, and whether it was set down, in which case the DM lights the point with `declare_light`. "Covering the object with something opaque blocks the light" is a fact about an object too.',
    },
  ],
  'magic-jar': [
    {
      clause: 'Charisma save to possess a Humanoid',
      why: 'a-second-place-to-put-a-creature',
      note: 'SRD: "The target makes a Charisma saving throw. On a failed save, your soul enters the target’s body, and the target’s soul becomes trapped in the container." The save answers an attempt made by a soul sitting in a container, and a creature is in the scene or it is not — there is nowhere for the caster to be while the body lies catatonic, so nothing ever raises it.',
    },
    {
      clause: 'possession itself is unwritable twice over',
      why: 'an-ability-score-a-spell-changes',
      note: 'SRD: "Your Hit Points, Hit Point Dice, Strength, Dexterity, Constitution, Speed, and senses are replaced by the creature’s." One creature reads its vitals and three ability scores off another for as long as the possession lasts, and an ability score is a fact of the sheet that nothing written by a casting may overwrite; the Speed in the same list is the same overwrite wearing a different field.',
    },
    {
      clause: 'lasts until dispelled',
      why: 'a-casting-dismissed-early',
      note: 'SRD gives the caster a way back — "either returning to your living body (and ending the spell)" — and the engine gives none: `endOngoingSpell` refuses a casting that runs until dispelled, because the book prints its caster no ending that costs nothing. So the two rules this definition hangs stand until a Dispel Magic reaches them, which is the exception this shape is about rather than the dismissal that is built.',
    },
    {
      clause: 'the container, its hundred feet',
      why: 'table',
      note: 'the container is an object with a place and a fate of its own, the hundred feet are measured to it, and the soul inside "can perceive from the container using its own senses" — all of it fiction the DM keeps, and a record carrying it would carry nothing the engine reads.',
    },
  ],
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
      why: 'table',
      note: 'SRD: "the target can’t become hidden from you", and the knowledge of its location the sentence before that one grants. Both are the same fact and the fact is the table’s: the engine holds no knowledge model, and sight is a declaration, so a DM who declares the sight has said the whole of it. **The rest of the paragraph is executed now** — "it gains no benefit from that condition against you" is a `benefit` rider narrowed by an `against` naming the caster, which denies the Invisible condition’s benefits to the caster alone and leaves the Initiative Advantage standing, because that roll is against nobody. A blanket denial would have been wrong for this spell rather than merely coarse, which is what that narrowing was built for.',
    },
  ],
  'mirror-image': [
    {
      clause: 'the duplicates are not in the world',
      why: 'table',
      note: 'three duplicates appearing in the caster’s space, moving with them and shifting position so it is impossible to track which image is real, is scenery: nothing can be aimed at one, so what the engine holds is the only part any rule reads — how many are left. The deflection itself is executed: each time a creature hits the caster, one d6 per remaining duplicate, a 3 or higher sends the blow to one of them, and the spell ends when the last is destroyed.',
    },
    {
      clause: 'ignore all other damage and effects',
      why: 'table',
      note: 'a rule about a thing nothing can aim at. No command targets a duplicate — they are not creatures on the roster — so there is nothing for damage or an effect to bounce off, and the sentence is true for free.',
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
  // **Gone, and it is the spell that shape was named for.** "The spell ends if
  // the steed takes any damage" is `summon-takes-damage`: the creature a
  // casting is *sustaining* is neither a target nor an ally, so `isOn` answers
  // no about it and `summonedBy` — the link `strandedSummons` already reads —
  // is what says which casting a bleeding steed belongs to. Everything else
  // this spell prints is the table's.
  'plant-growth': [
    {
      clause: 'the Enrichment branch is not castable at all',
      why: 'a-choice-made-at-the-casting',
      note: 'SRD prints one spell with two effects and lets the **casting time** choose between them, Action for the Overgrowth and eight hours for the Enrichment — "This spell channels vitality into plants. The casting time you use determines whether the spell has the Overgrowth or the Enrichment effect below." That is the second arm of this shape exactly as its description states it — a choice of which effects run rather than which value one of them carries, which is Enlarge/Reduce’s two halves and Glyph of Warding’s two glyphs — with the extra turn of the screw that the two branches do not even share a casting time, and a definition carries one. The Overgrowth is what is written, and its four feet per foot are charged.',
    },
  ],
  'prayer-of-healing': [
    {
      clause: 'remain within range for the spell',
      why: 'table',
      note: 'SRD: "Up to five creatures of your choice who remain within range for the spell\'s entire casting gain the benefits of a Short Rest". Range is measured against where the five stand when the rite settles, and nothing records where anybody stood for the ten minutes before it; a position history kept only so that one spell could read it would be a rule nothing else asks for, so whether they stayed is the DM\'s.',
    },
  ],
  'protection-from-evil-and-good': [
    {
      clause: 'Advantage on any new saving throw against the relevant effect',
      why: 'a-mode-on-the-save-a-spell-forces',
      note: 'nothing records what a save was against, so "the relevant effect" cannot be selected for. The same sentence that blocks Countercharm, arriving on the save rather than on the attack — and the one benefit of the three this spell prints that its two new axes did not reach: the Disadvantage is a roll mode narrowed by the attacker’s creature type, and the Charmed and Frightened Immunity is a grant narrowed by the type of whatever is causing them.',
    },
  ],
  revivify: [
    {
      clause: 'died of old age',
      why: 'table',
      note: 'SRD refuses it by name: "a creature that has died of old age". **The engine holds no cause of death**, and the field that would have to hold one is not missing by oversight: `creature-died.cause` is prose for the audit trail, and three of the four ways a creature dies write no such event at all. So the corpse this spell may not touch is one the table declines to hand it, exactly as the body parts it does not restore are an anatomy nothing here has. What the engine does own — whether the creature is dead, and how long it has been — it checks before a slot is spent.',
    },
  ],
  sanctuary: [
    {
      clause: 'choose a new target',
      why: 'table',
      note: 'the branch is the **attacker’s** and the engine aims nothing on a caller’s behalf, which is `eligibleTargets`’ own rule. So the book’s two branches are two commands rather than one: a failed ward loses the swing and spends nothing, and redirecting is a second swing at a creature nobody warded. Declining to make one is the other branch, which is what losing the attack looks like at a table.',
    },
    {
      clause: 'one save per ward per turn',
      why: 'table',
      note: 'owner’s ruling, 2026-09-22, and a limit the book does not print: it gives a save each time a creature targets the warded one. A failure here costs nothing, so without the limit an attacker re-declares until the save passes and the spell is undone. The ledger records both outcomes, so an attacker who cleared the ward is through for the turn and one who did not is barred for it.',
    },
    {
      clause: 'costs no Attack action',
      why: 'table',
      note: 'SRD ends this spell "if the warded creature makes an attack roll", and an attack roll changes no state by rule — `roll-recorded` is an audit line — so the ending hangs on the swing that spends something or on the blow that lands. An Opportunity Attack that misses, or any swing outside combat, leaves the ward standing where the book would end it.',
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
      note: 'SRD: "it can\'t benefit from the Invisible condition". The condition stays on the creature and one of the things it confers stops working. **The rider that does this exists** — `benefit`, which Starry Wisp, Faerie Fire and Mind Spike all hang — and what this spell cannot reach it with is the *host*: a smite is cast on a hit, its one effect kind is `attack-damage`, and that kind carries no `OutcomeRiders` at all. The blocker is a host without riders rather than a missing rider, and giving it some is a decision about what the settled outcome of a cast-on-hit is.',
    },
  ],
  // **The shaking has left this map**, and it left by being built: "someone
  // within 5 feet of it takes an action to shake it out of the spell's effect"
  // is `wakeCreature`, a command that spends the onlooker's Action, measures
  // the five feet and writes `creature-woken` — and the casting ends on that
  // sleeper through `shaken-awake`, the cause a definition names beside
  // `target-takes-damage`. Hypnotic Pattern prints the same clause and reaches
  // the same door; SRD Incubus, SRD Brass Dragon Wyrmling and SRD Pseudodragon
  // print it on conditions no spell ever cast, and those carry the mark
  // instead.
  // **One of the two spells that made `areaStanding` a list**, moved out of
  // `BLOCKED_ON` in the commit that wrote them: the line comes out of the
  // undefined map, the debt arrives here, and the three shapes the pair
  // claimed — a standing effect derived from where a creature stands, a
  // condition that ends when its holder leaves an area, and a bonus narrowed
  // to a skill — go with them, because the vocabulary now says all three.
  // Pass without Trace is the other and carries no entry at all: what is left
  // of it prints no mechanic, so its `unmodelled` line names nothing for an
  // adjudication to be written about.
  silence: [
    {
      clause: 'a declared object has no position on the lattice',
      why: 'an-object-with-statistics-of-its-own',
      note: 'the creature half is executed — a defence derived from the spaces a creature occupies, and the Deafened beside it — and the object half is the shape this spell shares with the tower and the boat: a declared object has no position on the lattice, so the Sphere has nothing to measure it against and cannot tell whether it is entirely inside.',
    },
  ],
  sleep: [
    {
      clause: 'such as elves',
      why: 'a-fact-only-the-table-can-declare',
      note: 'SRD: "Creatures that don’t sleep, such as elves, or that have Immunity to the Exhaustion condition automatically succeed on saves against this spell." **The Immunity half is executed** — `save.autoSucceedIf` reads it off the target through `conditionImmunitiesOf`, and `checks.ts` carries the automatic success the automatic failure was the only half of. What is left is whether a creature sleeps at all, and it is a fact rather than a mechanism: the SRD prints it of no creature type, and the 2024 Elf states it as a species trait — Trance, which says a creature of that species neither needs sleep nor can be put to sleep by magic — that no `FeatureGrant` member carries.',
    },
  ],
  // **Two of Slow's four are gone and both were built.** The −2 on Dexterity
  // saving throws is a `bonus` rider carrying a `BonusNarrowing`, which is the
  // half of `a-bonus-narrowed-to-a-skill` the ongoing side had already grown —
  // and a second grant of one casting, because an Armour Class takes no
  // narrowing and `bonusKey` is what stops the second evicting the first. The
  // repeat save is hosted by the casting on one creature at a time, filed on
  // the `grants` timer the casting's own source already keys, so "ending the
  // spell on itself" reaches the goblin that made its save and nobody else.
  slow: [
    {
      clause: 'it can make only one attack if it takes the Attack action',
      why: 'an-action-a-spell-compels-or-forbids',
      note: 'the second half of the same sentence, and a different absence: the economy counts one Attack action and not the attacks inside it, which `docs/design/characters-and-equipment.md` states from the feature side — "Extra attacks inside the Attack action. The economy counts one Attack action, not the attacks in it".',
    },
  ],
  'spider-climb': [
    {
      clause: 'across vertical surfaces and along ceilings',
      why: 'table',
      note: 'SRD: "gains the ability to move up, down, and across vertical surfaces and along ceilings, while leaving its hands free". **The Climb Speed in the next sentence is executed and this is what is left.** A scene is a lattice of 5-foot cubes with landmarks and elevation, and no surfaces at all — there is no wall for the engine to say a creature may walk on, and inventing one would be the engine deciding where the room’s walls are. So the same line declared cover and declared sight already draw: the DM says which surface the spider took, and the engine charges the climb at the Climb Speed the spell gave it.',
    },
  ],
  'spike-growth': [
    {
      clause: 'the spikes deal nothing',
      why: 'a-distance-a-creature-travels-inside-an-area',
      note: 'SRD: "it takes 2d4 Piercing damage for every 5 feet it travels". The dice are multiplied by a distance travelled **inside** the area, and a move is charged by the foot without anybody asking which of those feet were where — so there is no number for the dice to be multiplied by. The sentence before it is executed now: the ground is Difficult Terrain, laid as a patch the casting keeps.',
    },
    {
      clause: 'the Wisdom (Perception or Survival) check that spots the hazard is not offered',
      why: 'a-check-another-creature-may-attempt',
      note: 'the check belongs to a creature that is about to walk in rather than to one the casting caught, and who may attempt a check is derived from what its timer sits on — an effect on a creature is that creature’s, a casting with no victim is anybody’s, and this is neither.',
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
      why: 'light-and-obscurement-the-scene-holds',
      note: 'the clause this shape’s own test was built to hand back. It was filed `table` on the strength of one field — "the definition is tracked and carries no `SpellArea`, because a template no effect resolves over is a radius with no place attached" — and `spell-honesty.test.ts` pinned both halves so that the day Darkness grew an area the reading would fail rather than go quietly on calling a rule fiction. That day is P3-S: Darkness holds a Sphere, the Sphere holds magical darkness, and Sunburst’s own 60-foot Sphere overlaps it perfectly well. What is missing is the **trigger**, and `docs/design/light-and-sight.md` says exactly where its edge is: the mutual dispel runs "on pinning a patch", and Sunburst pins none — it is a flash, Instantaneous, leaving no light behind. So `lightDispelledBy` is built and reachable from every casting that lays light, and a casting that lays none has no way to call it.',
    },
  ],
  // **Executed by `maxRunning` and by the branches**, and the entry that
  // outlived both is the one clause of the six wonders that is not narration.
  // The other five were always fiction; this one is an ordinary roll modifier
  // with nowhere to stand.
  thaumaturgy: [
    {
      clause: 'the Advantage on Charisma (Intimidation) checks is not granted',
      why: 'a-target-rule-the-format-cannot-state',
      note: 'The mode itself is ordinary — a `RollModifier` naming a Charisma ability check narrowed to the Intimidation skill, which is the pair `RollSelector` already carries. What it has nowhere to land is a creature: Thaumaturgy prints Range 30 feet and `targets: { count: 0 }`, because the wonder happens within range rather than on somebody, so the per-target loop runs no times at all. The target rule that would hand the mode its creature is "the caster and nobody else", and `TargetRule` cannot state it — `notTheCaster` is the only sentence of that family it has, and it is the other one. Writing `{ count: 1, self: true }` instead would let a caster boom an ally’s voice, which is a rule the book does not grant.',
    },
  ],
  web: [
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
  'wind-walk': [
    {
      clause: 'Fly Speed of 300 feet',
      why: 'movement-modes',
      note: 'SRD: "a target has a Fly Speed of 300 feet and can hover". A Fly Speed is a mode rather than a number added to the one Speed a creature has, and hovering is a second fact beside it that nothing holds.',
    },
    {
      clause: 'Immunity to the Prone condition',
      why: 'movement-modes',
      note: 'SRD: "it has Immunity to the Prone condition; and it has Resistance to Bludgeoning, Piercing, and Slashing damage". Both ride in the same sentence as the Fly Speed and are conferred by the same cloud form, so they are left out with the form rather than for any want of an Immunity or a Resistance the engine cannot grant.',
    },
    {
      clause: 'is any Magic action',
      why: 'an-action-a-spell-compels-or-forbids',
      note: 'SRD: "The only actions a target can take in this form are the Dash action or a Magic action to begin reverting to its normal form." The narrowing is executed and fails closed; what is left is the errand inside the Magic action, and `NAMED_ACTIONS` holds only the names a spender can be told apart by — a Magic action taken to begin reverting is not one of them, so the rule permits every Magic action and the table says which was taken.',
    },
    {
      clause: 'the minute of reverting',
      why: 'an-activation-taken-by-somebody-other-than-the-caster',
      note: 'SRD: "Reverting takes 1 minute, during which the target has the Stunned condition." The Magic action that begins it is taken by the target rather than by the caster, so the minute of Stunned hangs off an activation belonging to somebody the casting reached rather than to whoever cast it.',
    },
  ],
  'wind-wall': [
    {
      clause: 'deflected upward',
      why: 'a-barrier-that-blocks-passage',
      note: 'the geometry is built and the obstacle is not: the wall is a template the casting resolves over, and stopping a Small flying creature, an arrow or a creature in gaseous form is the half `docs/design/space-and-areas.md` keeps out — a shape that refuses a crossing is where a rules engine becomes a VTT.',
    },
  ],
  'zone-of-truth': [
    {
      clause: 'the engine holds no speech',
      why: 'table',
      note: 'SRD: "On a failed save, a creature can’t speak a deliberate lie while in the radius." The save is rolled — both moments the sentence names are `AreaTrigger` members and the Charisma save is ordinary — and the *verdict* is kept, which is the other thing the spell prints: "You know whether a creature succeeds or fails on this save." What is not executed is the silence itself, and it is the table’s rather than a shape’s: the engine has no speech, so there is nothing for a condition to forbid and no sentence for it to inspect. A DM reads the verdict off `look` and decides whether what was said was a deliberate lie. This is the one clause here, because the spell stopped being tracked: the publication it was blocked on — an event that records the outcome on the casting and a field on the door that reports it — is built.',
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

/**
 * The mechanics this text names, by the tracked bucket's marker list.
 *
 * {@link markersIn} asks the same question of {@link CLAUSE_MARKERS}, which is
 * a different list for a different population, and the two were never going to
 * be one. This is the other list, and it has three callers that must agree:
 * {@link unansweredMarkers}, which demands an adjudication for every marker a
 * spell's prose trips; {@link misanchoredAdjudications}, which refuses a
 * marker-less entry over a sentence the markers can see; and
 * `spell-tracking.test.ts`, which measures how much of the book they fire on.
 * A copy that drifted would let an entry be filed marker-less against a
 * sentence another copy could see, which is exactly the hole the marker-less
 * form would then be.
 */
export const mechanicalMarkersIn = (text: string): readonly MarkerId[] =>
  MECHANICAL_MARKERS.filter(([, pattern]) => pattern.test(text)).map(([marker]) => marker);

export interface TrackedAdjudication {
  /**
   * Which mechanic in the spell's prose this answers, or **null** for a
   * sentence no mechanical marker can see.
   *
   * It was the **key** of a record until IE-044, which capped a spell at one
   * adjudication per marker — and the SRD does not: Tree Stride spends 5 feet
   * of movement in three different sentences and Plane Shift teleports two
   * different ways. Keeping it as a field lifts the cap and keeps the lookup
   * `SPLIT_BUNDLES` records for this population, whose middle slot is a marker
   * key and whose whole value is that it is history nobody may rewrite.
   *
   * ### Null is the entry form for a blocker the guard cannot ask for
   *
   * The markers read English, so a rule the SRD phrases in none of their words
   * trips nothing and is demanded of nobody. While every entry here had to
   * carry one, a spell moving out of {@link BLOCKED_ON} could only bring the
   * blockers the markers happened to see, and each of the others was **dropped
   * on the way** — after which "no shape sits unclaimed" demanded the shape be
   * retired, deleting the record of a gap that is still real. Three finished
   * definitions were reverted over that rather than shipped.
   *
   * So `null` says the thing a marker cannot: *the markers see nothing in this
   * sentence, and somebody read the paragraph.* It is not a way out of the
   * anchoring rule, and two rules keep it from becoming one — the unit it
   * names must trip **no** marker at all, and its {@link why} may not be a
   * claim about the engine that nothing can check: `'engine'` and
   * `'expressible'` are both refused, because each says the resolution path
   * reaches a sentence no marker can see and neither is a reading anybody can
   * re-run. Both are enforced by {@link misanchoredAdjudications}.
   *
   * ### `'table'` was refused here too, and gate G1 is why it is not
   *
   * The refusal read: *a sentence the markers cannot see that blocks nobody is
   * narration, and a tracked definition's own `unmodelled` is where narration
   * already goes.* `docs/design/content.md` says the opposite and says it as
   * the distinction the two lists exist for — "A handover is not `unmodelled`,
   * and the difference is the point. An `unmodelled` line is a **debt**" —
   * and `dmDecides` is where a handover goes. So the second half of that
   * justification was false, and it was load-bearing: while it stood, a
   * tracked spell whose paragraph trips no marker at all and whose every line
   * is fiction had **no legal way to record that somebody had read it**, and
   * thirty-four such spells sat in `LEDGER.md`'s *waits on none* column
   * looking exactly like finished business.
   *
   * {@link trackedAdjudicationGaps} now demands an entry from every tracked
   * definition that prints an `unmodelled` line, so the refusal would make
   * that demand unanswerable. And a `'table'` entry claims no shape, so it
   * cannot do the thing the marker-less rule was written against: keep a shape
   * alive in the vocabulary that nothing is blocked on.
   */
  readonly marker: MarkerId | null;
  /**
   * A distinctive phrase from the spell's printed SRD entry.
   *
   * {@link Adjudication.clause} and {@link BlockedClause.clause}'s rule, and
   * one implementation: the phrase must occur **exactly once**, and it must sit
   * in a sentence that trips the marker above it — so an adjudication cannot
   * drift onto a neighbouring sentence and cannot be written about a rule the
   * spell states somewhere else. Where the marker is null the second half is
   * inverted rather than waived: the sentence must trip none.
   */
  readonly clause: string;
  /**
   * Which of five things this clause is.
   *
   * | | |
   * |---|---|
   * | `'table'` | fiction; the engine should never decide it |
   * | `'engine'` | the engine **does** execute it, and nothing is delegated |
   * | `'expressible'` | the existing kinds already say it and nobody wrote it |
   * | a {@link ShapeId} | mechanical, and this names the shape that blocks it |
   * | an {@link ItemShapeId} | the same, where the shape belongs to the item vocabulary |
   *
   * `'engine'` arrived when ability checks became reachable from a spell, and
   * it is the half that keeps this honest in the other direction. A tracked
   * spell is not "a spell the engine does nothing about": Disguise Self is
   * tracked because a disguise is not arithmetic, and the Investigation check
   * that sees through it *is*, and is rolled. Without this value the only way
   * to record a solved clause would be to go on calling it missing.
   *
   * ### The two gate G1 added, and why each is a different claim
   *
   * `'expressible'` is {@link BlockedClause}'s value under the same name, and
   * it is **not** `'engine'`: that one says the resolution path arrives and
   * this one says it could and nobody has written the definition. Conflating
   * them is what made `LEDGER.md`'s *waits on none* column three claims in one
   * cell, and it is the column {@link ledgerTotals} now splits out — a
   * measurement over adjudications must rise when somebody reads the book,
   * and the fault was displaying the unread state as zero. Hex is the spell
   * that needs it: nothing blocks it and nobody wrote the definition.
   *
   * `ItemShapeId` is the widening the last pass wrote down and left. Remove
   * Curse's "the spell breaks its owner's Attunement to the object" is a debt
   * — `CreatureState.attuned` holds it and `attuneItem` writes it — and the
   * shape that names it, `what-ends-attunement-besides-a-command`, is in the
   * **item** vocabulary and finishes on the very sentence. Minting a second id
   * over here for one gap is the duplication that vocabulary was split out to
   * avoid, so the field takes the union that {@link ItemBlockerId} already is.
   *
   * ### And the third, which is why the field stopped being enumerated
   *
   * `FeatureShapeId` is the same argument from the third book, and the point
   * at which the owner took the general form instead of a fourth list: Speak
   * with Animals widens the Influence action, Gaseous Form forbids talking
   * and handling objects, and Haste's extra action may be spent on a Utilize
   * — and every one of those is `an-action-the-engine-has-no-spender-for`,
   * which `NAMED_ACTIONS` describes from the feature side because no spender
   * could be told apart as having taken one. So the field is
   * {@link BlockerId}, which is a shape in any of the three maps, and the
   * disjointness that makes that unambiguous is asserted rather than assumed.
   */
  readonly why: 'table' | 'engine' | 'expressible' | BlockerId;
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
      note: 'the Intelligence (Investigation) check against the spell save DC is rolled by resolveEffectCheck against the casting own timer; the table decides only that somebody looked closely. **P3-S6 read this spell to the end**: every printed sentence is the table’s or the engine’s, so what the table is left with is in the definition’s `dmDecides` rather than in `unmodelled` — handed over whole, and no clause of it is expressible with the kinds the engine has today.',
    },
  ],
  'minor-illusion': [
    {
      marker: 'ability-check',
      clause: 'determine that it is an illusion with a successful Intelligence (Investigation) check',
      why: 'engine',
      note: 'the Intelligence (Investigation) check against the spell save DC is rolled by resolveEffectCheck; a cantrip, so the DC comes off the caster sheet rather than off any slot. **P3-S6 read this spell to the end**: every printed sentence is the table’s or the engine’s, so what the table is left with is in the definition’s `dmDecides` rather than in `unmodelled` — handed over whole, and no clause of it is expressible with the kinds the engine has today.',
    },
  ],
  'silent-image': [
    {
      marker: 'ability-check',
      clause: 'determine that it is an illusion with a successful Intelligence (Investigation) check',
      why: 'engine',
      note: 'the Intelligence (Investigation) check against the spell save DC is rolled by resolveEffectCheck, against a Concentration casting timer that ends with the Concentration. **P3-S6 read this spell to the end**: every printed sentence is the table’s or the engine’s, so what the table is left with is in the definition’s `dmDecides` rather than in `unmodelled` — handed over whole, and no clause of it is expressible with the kinds the engine has today.',
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
      note: 'condition here means circumstance rather than any of the fifteen the engine applies: "it must be based on visual or audible conditions that occur within 30 feet of the object" is something the DM watches for, and whether a silver bell has rung is not a fact the engine holds. **P3-S6 read this spell to the end**: eight of its nine sentences are in the definition’s `dmDecides` now, and the ninth is the entry beside this one.',
    },
  ],
  'see-invisibility': [
    {
      marker: 'condition',
      clause: 'creatures and objects that have the Invisible condition as if they were visible',
      why: 'table',
      note: 'seeing through the Invisible condition is declared, not derived: sight is a pairwise declaration and the condition’s own effects already read it, so the table declares the sight this spell grants. **P3-S6 read this spell to the end**: every printed sentence is the table’s or the engine’s, so what the table is left with is in the definition’s `dmDecides` rather than in `unmodelled` — handed over whole, and no clause of it is expressible with the kinds the engine has today.',
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
  'death-ward': [
    {
      marker: 'hit-points',
      clause: 'the target instead drops to 1 Hit Point',
      why: 'an-effect-that-intercepts-dropping-to-0',
      note: 'the hit point is nothing and the interception is the whole spell: dropping to 0 is an engine-owned batch performed inside the operation that applies the damage, and there is no seam in it for an effect to say "stop at 1 instead".',
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
      note: 'Silent Image’s sentence two levels up, and the same answer: the Intelligence (Investigation) check against the spell save DC is rolled by resolveEffectCheck against a Concentration casting timer that ends with the Concentration. **P3-S6 read this spell to the end**: eight sentences went to the definition’s `dmDecides`, and the debt beside this one — the level 4+ slot — is paid, so this is the whole of what is left. A casting made at a level 4+ slot has no timer for the check to ride and says so in its own `unverified` line rather than in the definition, because it is a fact about that casting and not about the spell.',
    },
  ],
  'meld-into-stone': [
    {
      marker: 'movement-cost',
      clause: 'You can use 5 feet of movement to leave the stone where you entered it',
      why: 'table',
      note: 'the five feet are spendable and what they buy is stepping out of a stone. **The ruling of 2026-09-24: this is a handover and not a debt**, because the fact underneath every clause of this spell — a creature inside a rock — is a place, and the engine holds one scene of spaces creatures stand in. A second kind of place is not a mechanism somebody forgot to build; it is a world model nobody has asked for, and inventing one for a single level 3 spell is the direction `docs/design/content.md` names as the way a catalogue starts writing the engine. Nothing reads the fact afterwards, which is the test that makes this the table’s. The owner may reopen it — ROADMAP §10 says so — and the day a second place exists this row and Rope Trick’s come back together. **P3-S6 read this spell to the end**: every printed sentence is the table’s or the engine’s, so what the table is left with is in the definition’s `dmDecides` rather than in `unmodelled` — handed over whole, and no clause of it is expressible with the kinds the engine has today.',
    },
    {
      marker: 'dice',
      clause: 'expels you and deals 6d6 Force damage to you',
      why: 'table',
      note: 'the dice are ordinary and being expelled is not: the damage is a consequence of having been inside the stone, and the sentence after it deals a flat 50 for the same reason. The DM says the stone was broken and the DM says the damage lands; there is no state the engine could have held that would have made either of those its own. **P3-S6 read this spell to the end**: every printed sentence is the table’s or the engine’s, so what the table is left with is in the definition’s `dmDecides` rather than in `unmodelled` — handed over whole, and no clause of it is expressible with the kinds the engine has today.',
    },
    {
      marker: 'condition',
      clause: 'you move into an unoccupied space closest to where you first entered and have the Prone condition',
      why: 'table',
      note: 'placing a creature in the nearest unoccupied space and applying Prone are both ordinary, and both are reachable through commands a DM already has. What is missing is the expulsion they follow from, which is the place this whole paragraph hangs on — so the engine stands ready to execute the consequence and owns none of the cause. **P3-S6 read this spell to the end**: every printed sentence is the table’s or the engine’s, so what the table is left with is in the definition’s `dmDecides` rather than in `unmodelled` — handed over whole, and no clause of it is expressible with the kinds the engine has today.',
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
  // **The spell that actually prints an Exhaustion level, claiming the shape
  // that names one.** The reading was in the definition's own `unmodelled`
  // because the line trips no mechanical marker and no entry could be written
  // without one; `marker: null` is the form that ended that, and the shape was
  // meanwhile claimed by Wish, whose SRD 5.2.1 paragraph prints no Exhaustion
  // at all. One sentence in the book, one entry, and the claim is on the spell
  // that makes it.
  'greater-restoration': [
    {
      marker: null,
      clause: '- 1 Exhaustion level',
      why: 'an-exhaustion-level-a-spell-changes',
      note: 'Exhaustion is a level rather than a condition that is on or off, and `end-condition` takes a list of condition names — so it removes the condition whole and cannot take one level off. `setExhaustionLevel` is a command a DM sends and no spell effect reaches it.',
    },
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
      note: 'the save is ordinary and what it avoids is a fall upward. A fall is a fact the table can now declare, which is the half Feather Fall needed — but nothing lets an effect *produce* one, so a failed save here has no way to say the creature fell, and the fall upward still ends against a ceiling nothing models.',
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
  // **Protection from Evil and Good has left the tracked map**: two of its
  // three benefits are executed off the two axes this batch built — a roll
  // mode narrowed by the attacker's creature type, and a condition Immunity
  // narrowed by the type of whatever is causing the condition — so the spell
  // is executed-partial and what is left of it is filed in `ADJUDICATED`.
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
  // **Three sentences and one entry, which was one reading short.** The
  // definition's own `unmodelled` names three clauses and this map recorded
  // the first; the other two were paid for by nobody and the shapes they claim
  // went uncounted. Recorded now rather than argued about, which is the rule
  // the marker-less entry form exists for.
  blink: [
    {
      marker: 'dice',
      clause: 'Roll 1d6 at the end of each of your turns',
      why: 'a-random-outcome-that-is-not-a-d20',
      note: 'the generator throws any notation parseNotation reads and no SpellEffect asks it for one; a payout at a turn boundary hands over hit points and cannot branch on the face a die showed. **The `chance` effect is not this**: it throws a percentage at the moment of the casting, and this is a die thrown at every turn boundary for the duration, whose two faces put the caster in two different places.',
    },
    {
      marker: null,
      clause: 'you vanish from your current plane of existence and appear in the Ethereal Plane',
      why: 'a-second-place-to-put-a-creature',
      note: 'there is one scene, so a creature who has left it has nowhere to be — and the return "at the start of your next turn" is the same absence read from the other end. The definition says so in its own second line and this is where the shape was owed the claim. **The markers see nothing in this sentence**: the SRD writes a plane change without writing the word teleport, without a distance and without anything moving, which is exactly the shape of sentence the marker-less entry form exists for.',
    },
    {
      marker: null,
      clause: 'which is cast in shades of gray',
      why: 'table',
      note: 'what the caster can perceive of the plane they left is narration end to end, and the clause the markers can see in that sentence is the sixty feet — a distance between two places the engine does not hold, so there is nothing here to measure even in principle. This unit names no mechanic at all and somebody read the paragraph.',
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
      note: 'the four feet per foot are sayable — the rate is a number on the patch and Plant Growth writes exactly this one. What is not is the wall: SRD shapes it "up to 60 feet long, 10 feet high, and 5 feet thick" along a path of the caster’s choosing, which is the shape named on this spell’s other entry, and a patch has to lie somewhere before it can charge for anything.',
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
      note: 'time.ts has a span of time and a moment in the turn order, and a rest is neither; the clock records when the last one was and no deadline can name it.',
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
      why: 'a-creature-somebody-else-is-playing',
      note: 'the two modes are ordinary riders; they share a sentence with "must use all its movement to dance in place", and that is a creature being danced rather than a slot being charged — where the movement goes is a decision, and the engine plays nobody.',
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
      note: 'one failure pairs an ordinary condition with a broken Concentration. Sleet Storm printed the same pairing and is executed off `breaksConcentration` now, so this clause is writable and the definition does not carry it: the spell is level 8, out of level-5 reach, and nobody has re-read its paragraph since. A reading, not a gap, and the shape’s own description says so.',
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
  // — the marker-keyed entry form could not carry these ———————————————————————
  //
  // Each of these spells was written, run and reverted, and each for the same
  // reason: the blocker that matters is printed in words no mechanical marker
  // knows, so the definition could not bring it out of `BLOCKED_ON` and the
  // unclaimed-shape guard then demanded the shape be retired. The entry
  // carrying `marker: null` is the one that was missing. (Enthrall stood here
  // first and is executed now: the fought fact read as a success, and one
  // stored bonus read by the check and by the passive score.)
  'flesh-to-stone': [
    {
      marker: 'saving-throw',
      clause: 'A Restrained target makes another Constitution saving throw at the end of each of its turns',
      why: 'a-repeat-save-counted-to-a-tally',
      note: 'the death-save shape wearing a spell: three successes end the casting and three failures Petrify, in any order, and a repeat save keeps no running count of either.',
    },
    {
      marker: 'speed',
      clause: 'On a successful save, its Speed is 0 until the start of your next turn',
      why: 'a-success-branch-that-does-something',
      note: 'a rider rides the branch its host made, and a success releases the effect rather than acting — so a success clause that sets a Speed for a turn has no slot to sit in.',
    },
    {
      marker: 'condition',
      clause: 'If you maintain your Concentration on this spell for the entire possible duration',
      why: 'an-effect-that-fires-when-the-casting-ends',
      note: 'holding Concentration to the last second makes the Petrified permanent, which is a consequence hung on the moment a casting runs out, and expiry is derived rather than raised.',
    },
    {
      marker: null,
      clause: 'Constructs automatically succeed on the save',
      why: 'an-automatic-success-by-creature-type',
      note: 'the third outcome by creature type the book prints and the union does not have, beside the automatic failure and the Disadvantage it does — and the sentence is eight words with no mechanical marker in any of them.',
    },
  ],
  // — the two the same derivation named ——————————————————————————————————————
  //
  // The pass above derived its three from the **shapes** — hold this map to the
  // old rule and exactly three lose their last claimant — and named no spell.
  // Run the derivation over the undefined population instead and it names five:
  // a spell was unwritable exactly when one of its blockers sat in a sentence no
  // marker can see *and* nothing else in the book claimed that shape. These are
  // the other two, and each carries one reading of that kind — Calm Emotions'
  // suppression, Hallow's refusal to overlap another Hallow.
  //
  // Hallow is also where the lifted cap is spent: three of its entries answer
  // one sentence, because the Hallowed Ward is one sentence with three
  // different gaps in it and all three trip the same `condition` marker.
  'calm-emotions': [
    {
      marker: 'saving-throw',
      clause: 'choose for each creature',
      why: 'a-spells-effects-applied-to-different-targets',
      note: 'SRD: "must succeed on a Charisma saving throw or be affected by one of the following effects (choose for each creature)". A casting applies one effect list to every target it caught, so a spell picking a different one per creature has nowhere to record which — which is why the save is not raised at all: neither branch of it could be settled.',
    },
    {
      marker: 'defence',
      clause: 'Immunity to the Charmed and Frightened conditions',
      why: 'a-spells-effects-applied-to-different-targets',
      note: 'the effect itself is expressible — IE-042\'s `condition-immunity`, which Mind Blank writes unconditionally, and two names in one clause is the plural list the kind carries. What blocks it is the sentence above rather than anything about the Immunity: it is one of two outcomes chosen creature by creature, and the casting has nowhere to record which creature got which.',
    },
    {
      marker: null,
      clause: 'those conditions are suppressed for the duration',
      why: 'a-condition-a-spell-suppresses',
      note: 'the sole claimant of its shape and the reason this spell went unwritten: suppression hands the condition back when the spell ends, so it is not `end-condition`, and it is not the Immunity beside it either — that refuses a condition and this silences one that has already landed. The markers see nothing here because `\\bcondition\\b` does not match "conditions".',
    },
  ],
  hallow: [
    {
      marker: null,
      clause: 'the spell fails if the radius includes an area already under the effect of',
      why: 'a-cap-on-how-many-castings-run-at-once',
      note: 'the other sole claimant, and the other reason a spell went unwritten: a cap of one read over ground rather than over a caster. `replacesPriorCasting` ends a prior casting and nothing refuses a new one, and `state.ongoing` holds every area a casting keeps without anything asking whether two of them overlap.',
    },
    {
      marker: null,
      clause: 'Choose any of these creature types',
      why: 'a-choice-made-at-the-casting',
      note: 'a casting has nowhere to record a choice made when it was made — the gap Blindness/Deafness carries from the other side — and this one is read by every clause below it. Filed marker-less because the sentence names no mechanic the guard knows, and the shape keeps a dozen claimants it can see, so the form carries the reading rather than the shape.',
    },
    {
      marker: 'condition',
      clause: 'Creatures of the chosen types',
      why: 'a-creature-type-predicate-an-area-reads',
      note: '`designatesUnaffected` is the one filter an area has and it is explicit ids chosen once; a predicate over a creature *type* is a different question, and IE-019 answered it for an outcome rather than for who is caught.',
    },
    {
      marker: 'condition',
      clause: "can't willingly enter the area",
      why: 'a-barrier-that-blocks-passage',
      note: 'the second of three readings of the Hallowed Ward sentence. Cover and line of sight stay declared rather than ray-cast, and a shape that stops a creature crossing it is the geometry\'s missing half — nothing in the mover\'s path may refuse it.',
    },
    {
      marker: 'condition',
      clause: "isn't possessed, Charmed, or Frightened by them while in the area",
      why: 'a-condition-immunity-narrowed-to-its-source',
      note: 'the third, and an Immunity narrowed twice over: "by them" is the chosen creature types, and "while in the area" is the geometry the Extra Effects below already name. IE-042 built the unconditional grant and neither narrowing survived it; possession is not modelled at all.',
    },
    {
      marker: 'condition',
      clause: "can't gain the Frightened condition while in the area",
      why: 'a-standing-effect-derived-from-where-a-creature-stands',
      note: 'Courage. The Immunity itself is unconditional in its cause and IE-042 expresses that, but "while in the area" is not — a grant is keyed by source and nothing re-derives one from where the creature now is. It is the Fear clause below read the other way round.',
    },
    {
      marker: 'teleport',
      clause: "can't enter or exit the area using teleportation",
      why: 'an-effect-that-suppresses-other-magic',
      note: 'IE-037 built the teleport and this is the ward against arriving — an area that stops a spell working inside it, which reads a casting the engine resolves elsewhere and has no state to sit in.',
    },
    {
      marker: 'condition',
      clause: 'have the Frightened condition while in the area',
      why: 'a-standing-effect-derived-from-where-a-creature-stands',
      note: 'Fear, and it is a value derived from current geometry rather than from a pair of enter-and-leave events that have to stay matched — the shape Spirit Guardians\' halved Speed already names.',
    },
    {
      marker: 'defence',
      clause: 'have Resistance to one damage type of your choice',
      why: 'a-standing-effect-derived-from-where-a-creature-stands',
      note: 'a granted Resistance is built and a Resistance that holds only while a creature stands somewhere is not: `defensesOf` reads a grant keyed by source, and nothing re-derives one from where the creature now is.',
    },
    {
      marker: 'defence',
      clause: 'have Vulnerability to one damage type of your choice',
      why: 'a-standing-effect-derived-from-where-a-creature-stands',
      note: 'the same standing spatial effect as Resistance above it, on the other end of `applyDefenses`, and blocked on the same missing derivation rather than on the defence.',
    },
  ],
  // **Two spells whose blocker was never a shape.** Both entries said so in
  // the undefined map, in as many words and under protest: "No shape id names
  // it, and inventing one is an architecture decision rather than a reading."
  // The owner's reading is that there is nothing to invent — a Range printed
  // `Special` or `Sight` is the book asking a question about the world, and
  // such text is the DM's. The definitions say so with `dmDecides`, and what
  // stays here is what stayed blocked: the ordinary shapes underneath.
  dream: [
    {
      marker: 'speed',
      clause: 'the messenger is Incapacitated and has a Speed of 0',
      why: 'a-spells-effects-applied-to-different-targets',
      note: 'the condition and the zeroed Speed are both ordinary effects. What no definition can say is that they land on the messenger while everything else lands on the creature the spell targets, because one effect list reaches every target.',
    },
    {
      marker: null,
      clause: 'The messenger can emerge from the trance at any time, ending the spell',
      why: 'a-casting-dismissed-early',
      note: 'the general dismissal is built and ends a casting of the caster’s own by id. This one is ended by the messenger, who may be "a willing creature you touch" and so need not be the caster at all — the exception SRD Gaseous Form prints, and that one is built (`dismissibleBy: \'target\'`). What is left is the **price**: that field charges the Magic action both its printings charge, and the messenger emerges for nothing. The sentence trips no marker, so no guard could have asked for it.',
    },
    {
      marker: null,
      clause: 'can either end the trance (and the spell) or wait for the target to sleep',
      why: 'a-casting-dismissed-early',
      note: 'the same ending offered at a second moment, and the messenger is again the one who takes it. Written as its own clause rather than folded into the one above, because the book writes two sentences and an entry that answered one of them would leave the other unread.',
    },
    {
      marker: 'saving-throw',
      clause: 'the messenger can deliver a message of no more than ten words',
      why: 'a-choice-made-at-the-casting',
      note: 'the whole terrifying branch hangs on "You can make the messenger terrifying to the target", which is a choice taken when the spell is cast and a casting has nowhere to record one. The Wisdom save itself is the plainest thing the format does; what it is gated by is not.',
    },
    {
      marker: 'dice',
      clause: 'the target gains no benefit from its rest',
      why: 'a-rest-an-effect-gives-or-denies',
      note: 'a rest is a span the engine measures and its payout is `endRest`’s; nothing stands beside that to take the benefits away from a rest the sleeper actually completed.',
    },
    {
      marker: 'dice',
      clause: 'it takes 3d6 Psychic damage when it wakes up',
      why: 'a-deadline-anchored-to-a-rest',
      note: 'the dice and the type are ordinary and the moment is not: the damage is owed when the rest finishes, and a deadline is a span of seconds or a moment in the turn order, neither of which a waking is.',
    },
  ],
  'mirage-arcane': [
    {
      marker: null,
      clause: 'in an area up to 1 mile square',
      why: 'a-choice-made-at-the-casting',
      note: 'the area’s size is chosen when the spell is cast, up to a printed maximum. A `SpellArea` is one fixed size belonging to the definition, and a per-casting choice has nowhere to be recorded — so the mile is never drawn at all.',
    },
    {
      marker: null,
      clause: 'into Difficult Terrain (or vice versa) or otherwise impede movement through the area',
      why: 'difficult-terrain-an-area-creates',
      note: 'the half that makes ground difficult is writable now; the half this sentence leads with is not. Turning Difficult Terrain **into** ordinary ground is a patch that cancels the patches under it, and nothing in the lattice subtracts — `terrainAt` takes the dearest rate lying over a space, because the book’s own rule is that a space thick with thorns is thorny whatever else grows there.',
    },
    {
      marker: null,
      clause: 'Creatures with Truesight can see through the illusion',
      why: 'senses-beyond-declared-sight',
      note: 'sight is a pairwise declaration between two creatures and there is nothing else, so a sense that excuses its holder from an illusion has no state to sit in and nothing to be read off.',
    },
  ],

  // — the forty-five the ledger called finished ————————————————————————————
  //
  // `LEDGER.md`'s *waits on none* column reads a spell with no entry in this
  // map as finished business, and a spell with no entry in this map is also a
  // spell **nobody has read**. Forty-five tracked spells inside level 1–5 reach
  // were in that state and the audit of 2026-09-21 counted every one of them as
  // done. `unadjudicated-triage.test.ts` is the reading; the eleven spells below
  // are the debts it found, thirty-three more are handovers with no reader in
  // this engine — objects, light, languages, corpses, and things somebody learns
  // — and the forty-fifth named a shape that had since been built and is
  // executed now.
  //
  // Every clause here is marker-less, because every one of them is: the
  // mechanical markers read English and not one of these sentences is phrased
  // in their words, which is the hole the `null` form exists to fill.
  'speak-with-animals': [
    {
      marker: null,
      clause: 'skill options with them',
      why: 'table',
      note: 'the reading that filed this was written before the Influence action had a spender, and it is stale twice over. `NAMED_ACTIONS` holds `influence` now and `takeInfluence` takes it — the Charisma check against a DC the DM set, over `INFLUENCE_SKILLS` — and that command **never narrowed by the target’s creature type**, so an Influence attempt on a Beast was already legal and already rolled. There is nothing here for an `allows` to widen. What the spell actually buys is comprehension: that the Beast understands what was said and that the caster understands the answer, which is speech, and the engine holds no speech. The attitude a check argues against is the DM’s by the Influence entry’s own handover, and what a Beast has to say is the paragraph after it. A handover, and no rule reads it afterwards. **P3-S6 read this spell to the end**: every printed sentence is the table’s or the engine’s, so what the table is left with is in the definition’s `dmDecides` rather than in `unmodelled` — handed over whole, and no clause of it is expressible with the kinds the engine has today.',
    },
  ],
  knock: [
    {
      marker: null,
      clause: 'that spell is suppressed for 10 minutes',
      why: 'an-effect-that-suppresses-other-magic',
      note: 'Arcane Lock is a casting this engine really holds — it runs until dispelled and sits in `state.ongoing`. **Two things are missing and they are not the same thing.** The first is this shape: the state a suppressed casting sits in, a spell that does not function while its time goes on running, which is the half `spell-ended` did not build. The second is that nothing can name this particular casting anyway — Arcane Lock’s own definition records it for Dispel Magic, which ends an ongoing spell on a target where this casting is on a door. The debt is the first; the second is why building it would still leave a lock nobody can reach.',
    },
  ],
  'speak-with-plants': [
    {
      marker: null,
      clause: 'turn Difficult Terrain caused by plant growth',
      why: 'difficult-terrain-an-area-creates',
      note: 'the clause after it — turning ordinary ground into Difficult Terrain — is writable now, and this one is the direction that is not: **removing** it. Nothing in the lattice subtracts, because `terrainAt` takes the dearest rate lying over a space and a patch cancelling its neighbours is the one thing a rate cannot say.'
    },
  ],
  'tiny-hut': [
    {
      marker: null,
      clause: 'All other creatures and objects are barred from passing through it',
      why: 'a-barrier-that-blocks-passage',
      note: 'the dome stops a creature crossing it, and movement consults no walls — which `docs/design/space-and-areas.md` keeps out on purpose, because ray-casting a barrier is where a rules engine becomes a VTT. The template that describes the Emanation is a different thing from a surface that refuses a mover.',
    },
    {
      marker: null,
      clause: "Spells of level 3 or lower can't be cast through it",
      why: 'an-effect-that-suppresses-other-magic',
      note: 'an area that refuses another casting rather than ending one. `spell-ended` built the ending half and this is the half it did not: no state says a casting is being refused, and a level cap read off the dome has nowhere to be checked.',
    },
    {
      marker: null,
      clause: 'The spell ends early if you leave the Emanation',
      why: 'a-casting-ended-by-a-trigger',
      note: 'this spell is the shape’s own example of leaving an area, named in its description. The other half of the same sentence — casting it again — is `replacesPriorCasting` and is applied; what has no cause the log holds is the caster stepping out of their own dome.',
    },
  ],
  'animate-dead': [
    {
      marker: null,
      clause: 'a corpse of a Medium or Small Humanoid within range',
      why: 'a-target-rule-the-format-cannot-state',
      note: '`TargetRule` selects by creature type and by whether armour is worn. A pile of bones is neither a creature nor a type, and the size band beside it is a fact the format cannot state about a target at all — so there is nothing for the casting to be aimed at before the question of what appears even arises.',
    },
    {
      marker: null,
      clause: 'The target becomes an Undead creature',
      why: 'a-stat-block-created-mid-fight',
      note: 'a Skeleton or a Zombie out of the bestiary is still a creature added to the scene in the middle of a fight, which no casting does. Everything the spell prints afterwards — the Bonus Action that commands them, the 24 hours of control, the two more per slot level — hangs on a creature that never arrived.',
    },
  ],
  nondetection: [
    {
      marker: null,
      clause: 'targeted by any Divination spell',
      why: 'an-effect-that-suppresses-other-magic',
      note: 'a creature that refuses a casting rather than an area that does, which is the same missing state arriving at a different holder — the reading this shape already records for Freedom of Movement’s refusal of a Speed reduction. **The second half of this note was wrong and is corrected here**: it said every Divination this catalogue defines is cast at Self or at no creature, so the rule would have no reachable case. Two executed Divinations take a creature as their target — Mind Spike (level 2, `targets: { count: 1 }`, Range 120 feet) and Hunter’s Mark (level 1, the same) — and both are inside level-5 reach, so a Nondetection on a quarry is a case a table reaches this year. What is missing is only the state and its reader, and the reader is the one place a casting checks its targets.',
    },
  ],

  // — the thirty-four the ledger called finished business ————————————————————
  //
  // **Gate G1's serious finding, recorded where the report can count it.**
  // `spellShapesOf` reads this map and never opens a definition's own
  // `unmodelled`, and of the forty spells `LEDGER.md` filed under *waits on no
  // shape*, thirty-four had no entry here at all — so the report read a
  // missing entry as no debt. Every paragraph below had in fact been read, in
  // `unadjudicated-triage.test.ts`; what it had not been is **written
  // anywhere a generator reads**, which is the difference between a reading
  // and a measurement.
  //
  // Three things about the shape of the block. Every entry is marker-less,
  // because these thirty-four are exactly the tracked spells in level-5 reach
  // whose prose trips no `MECHANICAL_MARKERS` pattern anywhere — that is why
  // no guard had ever demanded one of them, and it is the hole
  // {@link trackedAdjudicationGaps} closes. Most say `'table'`, which is the
  // change {@link TrackedAdjudication.marker} argues for and the reason the
  // number below rises by six rather than by thirty-four. And six of them —
  // Dancing Lights, Darkness, Daylight, Continual Flame, Light and Fog Cloud
  // — name `light-and-obscurement-the-scene-holds`, which did not exist when
  // they were read: a case-insensitive search of this file for *light* or
  // *obscur* returned notes and no id, so the debt could not be filed.
  alarm: [
    {
      marker: null,
      clause: 'an alarm alerts you whenever a creature touches or enters the warded area',
      why: 'table',
      note: 'nothing mechanically authoritative changes when the alarm fires — no roll, no resource, no condition, nothing about any creature — so the warning is the DM’s to give and the exemption the caster designates is an exemption from it. The Cube the ward fills is a ceiling the caster picks rather than a spell’s one fixed area, which is why the definition quotes it instead of pinning it. **P3-S6 read this spell to the end**: every printed sentence is the table’s or the engine’s, so what the table is left with is in the definition’s `dmDecides` rather than in `unmodelled` — handed over whole, and no clause of it is expressible with the kinds the engine has today.',
    },
  ],
  'arcane-lock': [
    {
      marker: null,
      clause: 'You touch a closed door, window, gate, container, or hatch and magically lock it',
      why: 'table',
      note: 'the whole spell is about an object, and objects are not modelled: which door was touched, who may open it despite the lock and what the password is have nowhere in state to live. Dispel Magic executes and cannot reach this casting, because it ends an ongoing spell **on a target** and this one is on a door. **P3-S6 read this spell to the end**: every printed sentence is the table’s or the engine’s, so what the table is left with is in the definition’s `dmDecides` rather than in `unmodelled` — handed over whole, and no clause of it is expressible with the kinds the engine has today.',
    },
  ],
  clairvoyance: [
    {
      marker: null,
      clause: 'The intangible, invulnerable sensor remains in place for the duration',
      why: 'table',
      note: 'nothing is measured from the sensor and nothing is resolved at it: what it buys is that the caster perceives a place, and sight in this engine is a declared pairwise fact between two creatures rather than a derived one. The Bonus Action that switches seeing for hearing is a cost of operating a thing the engine does not hold. **P3-S6 read this spell to the end**: every printed sentence is the table’s or the engine’s, so what the table is left with is in the definition’s `dmDecides` rather than in `unmodelled` — handed over whole, and no clause of it is expressible with the kinds the engine has today.',
    },
  ],
  'comprehend-languages': [
    {
      marker: null,
      clause: 'you understand the literal meaning of any language that you hear or see signed',
      why: 'table',
      note: 'the sheet records which languages a character knows and nothing in play reads them, so understanding one more is a fact with no reader — the test `docs/design/content.md` draws, applied: a table fact that a rule then reads is a debt, and this one nothing reads afterwards. **P3-S6 read this spell to the end**: every printed sentence is the table’s or the engine’s, so what the table is left with is in the definition’s `dmDecides` rather than in `unmodelled` — handed over whole, and no clause of it is expressible with the kinds the engine has today.',
    },
  ],
  'create-food-and-water': [
    {
      marker: null,
      clause: 'You create 45 pounds of food and 30 gallons of fresh water',
      why: 'table',
      note: 'the food and the water are objects, and objects are not modelled; malnutrition, dehydration and the 24 hours after which the food spoils have no reader either. **P3-S6 read this spell to the end**: every printed sentence is the table’s or the engine’s, so what the table is left with is in the definition’s `dmDecides` rather than in `unmodelled` — handed over whole, and no clause of it is expressible with the kinds the engine has today.',
    },
  ],
  'create-or-destroy-water': [
    {
      marker: null,
      clause: 'You create up to 10 gallons of clean water within range in an open container',
      why: 'table',
      note: 'ten gallons in a container, rain in a Cube, exposed flames put out and fog destroyed are four facts about a world the engine holds none of — fog is not a state it keeps even where another spell made it. The higher slot buys gallons and feet, and neither is a number any effect of this definition reads. **P3-S6 read this spell to the end**: every printed sentence is the table’s or the engine’s, so what the table is left with is in the definition’s `dmDecides` rather than in `unmodelled` — handed over whole, and no clause of it is expressible with the kinds the engine has today.',
    },
  ],
  'detect-evil-and-good': [
    {
      marker: null,
      clause: 'you sense the location of any Aberration, Celestial, Elemental, Fey, Fiend, or Undead',
      why: 'table',
      note: 'the engine knows a creature’s type and reports nothing, and a creature nobody has typed has nothing to report; sensing whether Hallow is active, and the foot of stone or inch of metal that blocks the sense, are facts about a world that is declared rather than modelled. **P3-S6 read this spell to the end**: every printed sentence is the table’s or the engine’s, so what the table is left with is in the definition’s `dmDecides` rather than in `unmodelled` — handed over whole, and no clause of it is expressible with the kinds the engine has today.',
    },
  ],
  'detect-magic': [
    {
      marker: null,
      clause: 'you sense the presence of magical effects within 30 feet of yourself',
      why: 'table',
      note: 'knowing something changes no authoritative state, which is the line this spell and Identify are both on: the Magic action that sees an aura and the school it reports are narration, and the blocking rule is a wall nobody has modelled. **P3-S6 read this spell to the end**: every printed sentence is the table’s or the engine’s, so what the table is left with is in the definition’s `dmDecides` rather than in `unmodelled` — handed over whole, and no clause of it is expressible with the kinds the engine has today.',
    },
  ],
  'detect-poison-and-disease': [
    {
      marker: null,
      clause: 'you sense the location of poisons, poisonous or venomous creatures, and magical contagions',
      why: 'table',
      note: 'poisons, venomous creatures and magical contagions are not modelled, so what the caster senses is narration and the blocking rule is the same declared wall the other two Detects print. **P3-S6 read this spell to the end**: every printed sentence is the table’s or the engine’s, so what the table is left with is in the definition’s `dmDecides` rather than in `unmodelled` — handed over whole, and no clause of it is expressible with the kinds the engine has today.',
    },
  ],
  druidcraft: [
    {
      marker: null,
      clause: 'you create one of the following effects within range',
      why: 'table',
      note: 'not one of the four branches is arithmetic, which is why the choice needs nowhere to be recorded — the line `blocked-on.test.ts` draws against Thaumaturgy, whose sixth branch grants Advantage on a check and so does decide something. **P3-S6 read this spell to the end**: every printed sentence is the table’s or the engine’s, so what the table is left with is in the definition’s `dmDecides` rather than in `unmodelled` — handed over whole, and no clause of it is expressible with the kinds the engine has today.',
    },
  ],
  elementalism: [
    {
      marker: null,
      clause: 'You exert control over the elements',
      why: 'table',
      note: 'five branches and no arithmetic in any of them; the 5-foot Cube each fits in is quoted rather than pinned because nothing is resolved over it, and the minute of scent, the minute of evaporation and the hour a sculpted shape holds run no clock on an Instantaneous casting. **P3-S6 read this spell to the end**: every printed sentence is the table’s or the engine’s, so what the table is left with is in the definition’s `dmDecides` rather than in `unmodelled` — handed over whole, and no clause of it is expressible with the kinds the engine has today.',
    },
  ],
  'find-traps': [
    {
      marker: null,
      clause: 'You sense any trap within range that is within line of sight',
      why: 'table',
      note: 'neither a mechanism nor a Glyph of Warding is a thing in state, so whether one is in range and the general nature of the danger are the DM’s to answer. **P3-S6 read this spell to the end**: every printed sentence is the table’s or the engine’s, so what the table is left with is in the definition’s `dmDecides` rather than in `unmodelled` — handed over whole, and no clause of it is expressible with the kinds the engine has today.',
    },
  ],
  'floating-disk': [
    {
      marker: null,
      clause: 'This spell creates a circular, horizontal plane of force',
      why: 'table',
      note: 'the disk is an object: where it is, the 500 pounds it holds, what rides on it, the 20 feet it follows within, the elevation change it refuses and the 100 feet that end the spell are all measured against a thing that is not in the scene. **P3-S6 read this spell to the end**: every printed sentence is the table’s or the engine’s, so what the table is left with is in the definition’s `dmDecides` rather than in `unmodelled` — handed over whole, and no clause of it is expressible with the kinds the engine has today.',
    },
  ],
  identify: [
    {
      marker: null,
      clause: 'you learn its properties and how to use them, whether it requires Attunement',
      why: 'table',
      note: 'what is learned about an object is a fact about a magic item, and what is learned about a creature the engine already answers as a query; no effect kind reports knowledge, because knowing something changes no authoritative state. **P3-S6 read this spell to the end**: every printed sentence is the table’s or the engine’s, so what the table is left with is in the definition’s `dmDecides` rather than in `unmodelled` — handed over whole, and no clause of it is expressible with the kinds the engine has today.',
    },
  ],
  'illusory-script': [
    {
      marker: null,
      clause: 'imbue it with an illusion that lasts for the duration',
      why: 'table',
      note: 'what the text says, what the illusion makes it say and the altered meaning, handwriting and language are fiction, and so is the parchment; what being designated buys is the ability to read, and reading is the DM’s. **P3-S6 read this spell to the end**: every printed sentence is the table’s or the engine’s, so what the table is left with is in the definition’s `dmDecides` rather than in `unmodelled` — handed over whole, and no clause of it is expressible with the kinds the engine has today.',
    },
  ],
  'locate-animals-or-plants': [
    {
      marker: null,
      clause: 'You learn the direction and distance to the closest creature or plant of that kind',
      why: 'table',
      note: 'the engine holds one scene, and a creature five miles off it is not a creature at a distance — there is nothing to measure a direction to. **P3-S6 read this spell to the end**: every printed sentence is the table’s or the engine’s, so what the table is left with is in the definition’s `dmDecides` rather than in `unmodelled` — handed over whole, and no clause of it is expressible with the kinds the engine has today.',
    },
  ],
  'locate-object': [
    {
      marker: null,
      clause: "You sense the direction to the object's location",
      why: 'table',
      note: 'objects have no position, so where the object is and whether it is moving have nothing to read; the thickness of lead that blocks it is the same declared wall the Detect spells print. **P3-S6 read this spell to the end**: every printed sentence is the table’s or the engine’s, so what the table is left with is in the definition’s `dmDecides` rather than in `unmodelled` — handed over whole, and no clause of it is expressible with the kinds the engine has today.',
    },
  ],
  'mage-hand': [
    {
      marker: null,
      clause: 'A spectral, floating hand appears at a point you choose within range',
      why: 'table',
      note: 'the hand is not a thing in the world: manipulating an object, the 30 feet it moves, the 10-pound limit and the ban on attacking or activating magic items are all about a hand with no position. **The recast is the exception and it is executed** — `replacesPriorCasting` is on the definition, which is why no clause here names it. **P3-S6 read this spell to the end**: every printed sentence is the table’s or the engine’s, so what the table is left with is in the definition’s `dmDecides` rather than in `unmodelled` — handed over whole, and no clause of it is expressible with the kinds the engine has today.',
    },
  ],
  mending: [
    {
      marker: null,
      clause: 'This spell repairs a single break or tear in an object you touch',
      why: 'table',
      note: 'which break was mended and the 1 foot it may not exceed are facts about an object’s condition, and the engine tracks what a creature owns and wears and nothing about the state of it; the ban on restoring magic forbids undoing something it never did. **P3-S6 read this spell to the end**: every printed sentence is the table’s or the engine’s, so what the table is left with is in the definition’s `dmDecides` rather than in `unmodelled` — handed over whole, and no clause of it is expressible with the kinds the engine has today.',
    },
  ],
  message: [
    {
      marker: null,
      clause: 'The target (and only the target) hears the message',
      why: 'table',
      note: 'what is said and what is whispered back are the DM’s. The one clause that is not — SRD lets this spell alone be cast through a solid object at a familiar target — is a refusal the engine makes for every spell and an exception the format cannot state, and it is fiction on both sides of the wall. **P3-S6 read this spell to the end**: every printed sentence is the table’s or the engine’s, so what the table is left with is in the definition’s `dmDecides` rather than in `unmodelled` — handed over whole, and no clause of it is expressible with the kinds the engine has today.',
    },
  ],
  'purify-food-and-drink': [
    {
      marker: null,
      clause: 'You remove poison and rot from nonmagical food and drink',
      why: 'table',
      note: 'the food and drink are objects; the Poisoned condition belongs to a creature and is untouched by this spell, and a definition that cured one would be inventing a rule the sentence does not print. **P3-S6 read this spell to the end**: every printed sentence is the table’s or the engine’s, so what the table is left with is in the definition’s `dmDecides` rather than in `unmodelled` — handed over whole, and no clause of it is expressible with the kinds the engine has today.',
    },
  ],
  'rope-trick': [
    {
      marker: null,
      clause: 'an Invisible 3-foot-by-5-foot portal opens to an extradimensional space',
      why: 'table',
      note: 'the engine holds one scene, so a second place is not somewhere a creature can be: who has climbed in, the eight Medium creatures it holds and the rule that attacks and spells cannot cross are all about a space that does not exist in state. **P3-S6 read this spell to the end**: every printed sentence is the table’s or the engine’s, so what the table is left with is in the definition’s `dmDecides` rather than in `unmodelled` — handed over whole, and no clause of it is expressible with the kinds the engine has today.',
    },
  ],
  'speak-with-dead': [
    {
      marker: null,
      clause: 'you can ask the corpse up to five questions',
      why: 'table',
      note: 'the corpse is an object rather than a creature in state, so the mouth it must have, the Undead it must not have been and the 10 days since the last casting have nothing to read; the five answers and their truthfulness are the DM’s. **P3-S6 read this spell to the end**: every printed sentence is the table’s or the engine’s, so what the table is left with is in the definition’s `dmDecides` rather than in `unmodelled` — handed over whole, and no clause of it is expressible with the kinds the engine has today.',
    },
  ],
  tongues: [
    {
      marker: null,
      clause: 'the ability to understand any spoken or signed language that it hears or sees',
      why: 'table',
      note: 'the same reading as Comprehend Languages: the sheet records the languages a character knows and nothing in play reads them, so understanding and being understood have no reader. **P3-S6 read this spell to the end**: every printed sentence is the table’s or the engine’s, so what the table is left with is in the definition’s `dmDecides` rather than in `unmodelled` — handed over whole, and no clause of it is expressible with the kinds the engine has today.',
    },
  ],
  'water-breathing': [
    {
      marker: null,
      clause: 'the ability to breathe underwater until the spell ends',
      why: 'table',
      note: 'suffocation is not modelled, so breathing underwater lifts a rule the engine does not apply. **P3-S6 read this spell to the end**: every printed sentence is the table’s or the engine’s, so what the table is left with is in the definition’s `dmDecides` rather than in `unmodelled` — handed over whole, and no clause of it is expressible with the kinds the engine has today.',
    },
  ],
  'water-walk': [
    {
      marker: null,
      clause: 'This spell grants the ability to move across any liquid surface',
      why: 'table',
      note: 'nothing in state says there is water, acid, mud or lava under the party, so what the surface is and what the heat of lava does are the DM’s — and the Bonus Action a target spends to drop through it is charged by the DM for the same reason. **P3-S6 read this spell to the end**: every printed sentence is the table’s or the engine’s, so what the table is left with is in the definition’s `dmDecides` rather than in `unmodelled` — handed over whole, and no clause of it is expressible with the kinds the engine has today.',
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
  // **Entangle is off this map**, and every one of its five clauses left by a
  // different door than the one that had been holding them. Four were
  // `expressible` and always had been — a Cube on a point, a Strength save, a
  // Restrained condition ended by the casting, Black Tentacles' Athletics
  // escape word for word — and the fifth, "Each creature (other than you) in
  // the area", is `notTheCaster`. The Difficult Terrain is `areaTerrain` at
  // the glossary's rate, on a patch that lapses with the Concentration,
  // which is "they disappear when the spell ends" said in the vocabulary
  // Grease, Web and Spike Growth already use. Nothing of it is unmodelled.
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
  // **The one unread `finishes` in the map, read.** The bare list named one
  // shape and the paragraph really does print exactly one mechanical blocker:
  // the save, the Advantage the fought fact buys, and both conditions are
  // written elsewhere in this catalogue already, and what is left is the
  // sentence that ends the casting on damage from anybody at all.
  'modify-memory': [
    {
      clause: 'One creature that you can see within range makes a Wisdom saving throw',
      why: 'expressible',
      note: 'One named target held to the spell’s range and to declared sight, rolling a Wisdom save against the casting’s pinned DC. Charm Person writes the same first sentence.',
    },
    {
      clause: 'If you are fighting the creature, it has Advantage on the save',
      why: 'expressible',
      note: '`SpellEffect`’s `advantageIfFought` is this sentence transcribed: the definition prints the question and `CastSpellRequest.fought` answers it, reaching the roll as a named mode rather than as a number. Charm Person, Charm Monster and the three Dominates already write it.',
    },
    {
      clause: 'the target has the Charmed condition for the duration',
      why: 'expressible',
      note: 'A named condition on the failure branch, ended by the casting through the source every grant ends through. This is the commonest shape in the catalogue.',
    },
    {
      clause: 'the target also has the Incapacitated condition and is unaware of its surroundings',
      why: 'expressible',
      note: 'A second condition from the same failure, which an effect list applies beside the first; being unaware of its surroundings is narration the engine never arrives at.',
    },
    {
      clause: 'If it takes any damage or is targeted by another spell, this spell ends',
      why: 'a-casting-ended-by-a-trigger',
      note: 'Two causes and neither is one of the five transcribed: damage from **anybody**, where the two built scopes are the caster and the caster’s allies, and being targeted by another spell at all, which no consequence event records.',
    },
    {
      clause: 'You can alter the target’s memories of an event that took place up to 7 days ago',
      why: 'table',
      note: 'The slot buys how far back the altered memory may reach, which is a fact about fiction: no state the engine holds changes when the answer is seven days rather than thirty.',
    },
  ],
  // The bare list had two shapes and the paragraph prints three. The check that
  // sees through the phantasm ends the casting, which is Maze's sentence in
  // different words and is filed to the same shape it is.
  'phantasmal-force': [
    {
      clause: 'craft an illusion in the mind of a creature you can see within range',
      why: 'table',
      note: 'What the illusion is, and that only one creature perceives it, is narration; the range and the sight are checked before anything is spent and are the only mechanical words in the sentence.',
    },
    {
      clause: 'The target makes an Intelligence saving throw',
      why: 'expressible',
      note: 'An Intelligence save against the casting’s pinned DC, with the whole of the spell on the failure branch — the plainest thing the definition format does.',
    },
    {
      clause: 'no larger than a 10-foot Cube and that is perceivable only to the target',
      why: 'table',
      note: 'The Cube bounds a thing nobody but the target perceives and carries no effect of its own; what the size is later used for is the damage clause below, which is filed where its own blocker is.',
    },
    {
      clause: 'The target can take a Study action to examine the phantasm with an Intelligence (Investigation) check',
      why: 'expressible',
      note: '`SpellCheck` carries an ability, a skill and the casting’s own DC, and a casting with no victim is anybody’s to see through — which here is the one creature the phantasm is on.',
    },
    {
      clause: 'the target realizes that the phantasm is an illusion, and the spell ends',
      why: 'a-casting-ended-by-a-trigger',
      note: '`SpellCheck.onSuccess` is `none` or `end-on-target` and says in its own words that `end-casting` is deliberately absent. Ending the effect on the only target is not ending the casting, and the caster would still be concentrating — Maze prints the identical sentence and is filed the same way.',
    },
    {
      clause: 'An affected target can even take damage from the illusion',
      why: 'table',
      note: 'Whether the phantasm is a dangerous creature or a hazard at all is the DM’s to decide, and this sentence decides nothing else; the damage it introduces is the clause below.',
    },
    {
      clause: 'On each of your turns, such a phantasm can deal 2d8 Psychic damage to the target',
      why: 'an-area-trigger-on-the-casters-turn',
      note: 'The two boundaries an `AreaTrigger` knows are the caught creature’s, and the queue that raises area debt is keyed to the creature whose turn it is. A payout owed at the **caster’s** boundary is a third moment nothing schedules.',
    },
    {
      clause: 'if it is in the phantasm’s area or within 5 feet of the phantasm',
      why: 'an-area-trigger-measured-from-a-point',
      note: 'A reach measured from the casting’s own origin rather than from a template. `CastingOrigin.reach` answers that for an attack the caster makes and for nothing that fires on its own.',
    },
    {
      clause: 'The target perceives the damage as a type appropriate to the illusion',
      why: 'table',
      note: 'The damage type is whatever the fiction says it is, which is the DM’s sentence; the engine would need a type to roll against a defence and the book declines to print one.',
    },
  ],
  // **Blocked on nothing, and now read.** Every trigger it has is fiction and
  // the one mechanical clause is a check the vocabulary states exactly. What
  // stops the definition being written is neither: `check_without_duration`
  // reads `durationSeconds` and `durationUntil` and not `untilDispelled`, so
  // the validator refuses a check on a casting that runs until dispelled. That
  // is a rule to widen rather than a shape to build, so it is reported instead
  // of being filed as a blocker.
  'programmed-illusion': [
    {
      clause: 'an illusion of an object, a creature, or some other visible phenomenon within range that activates when a specific trigger occurs',
      why: 'table',
      note: 'The range is checked before anything is spent and the trigger is a fiction the DM raises, which is the line declared cover and declared sight already draw for every fact the engine cannot see.',
    },
    {
      clause: 'it must be based on visual or audible phenomena that occur within 30 feet of the area',
      why: 'table',
      note: 'The thirty feet bounds a trigger nothing in the engine can observe, so the distance gates narration rather than arithmetic and the ruler is never asked.',
    },
    {
      clause: 'can determine that it is an illusion with a successful Intelligence (Investigation) check against your spell save DC',
      why: 'expressible',
      note: '`SpellCheck` carries the ability, the skill and the printed DC, and a casting with no victim is anybody’s to see through — which is this sentence exactly. Nothing about it is missing from the vocabulary.',
    },
    {
      clause: 'the creature can see through the image',
      why: 'table',
      note: 'What a creature that has seen through the illusion then perceives is narration: no state the engine holds differs, because the image was never a thing it held.',
    },
  ],
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
  // **One shape came off this list because the book does not print it.** SRD
  // 5.2.1 rewrote what the stress of a Wish costs: a Strength score of 3 for
  // 2d4 days, where the previous edition gave an Exhaustion level. Nothing in
  // this paragraph mentions Exhaustion, so the claim was inherited from a book
  // this repository does not implement — and `an-exhaustion-level-a-spell-changes`
  // is claimed instead by Greater Restoration, which prints it.
  //
  // The entry is still grandfathered, and deliberately: one of its sentences is
  // a Resistance the book calls **permanent**, and a grant that outlives every
  // deadline the engine has has no shape id here. Naming one is a decision
  // rather than a reading, so the paragraph stays unread and the reason is
  // written down instead of being filed as something it is not.
  wish: [
    'a-casting-that-casts-another-spell',
    'a-deadline-anchored-to-a-rest',
    'a-flat-amount-with-no-dice',
    'a-random-outcome-that-is-not-a-d20',
    'a-roll-result-an-effect-replaces',
    'an-ability-score-a-spell-changes',
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
 * one shape — Find Familiar wants a stat block in three of them — and a shape a
 * spell needs twice is not a spell that needs two shapes. Hallow was the
 * example here until it was written, where the same three sentences of standing
 * effect now name one shape three times in {@link TRACKED_ADJUDICATED}.
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

/** A tracked adjudication its own anchoring rule refuses, and what is wrong with it. */
export interface MisanchoredAdjudication {
  readonly spell: string;
  readonly clause: string;
  readonly complaint: string;
}

/**
 * Every tracked adjudication of this spell the anchoring rule refuses.
 *
 * One function for both entry forms, because they are one rule read two ways:
 * an entry names one **sentence** of the spell's prose, and it says truthfully
 * whether the markers can see that sentence. A marker entry must sit in a
 * sentence tripping its own marker; a marker-less one must sit in a sentence
 * tripping none, and must claim either a missing shape or the table —
 * `'engine'` and `'expressible'` are both refused there, because each asserts
 * that the resolution path reaches a sentence no marker can see, which is the
 * one claim nobody can re-run. {@link TrackedAdjudication.marker} records what
 * gate G1 changed about `'table'` and why the change is not a hole.
 *
 * ### A printed field is not an anchor here, and that is the whole of why
 *
 * `Casting Time: Action` trips no `MECHANICAL_MARKERS` pattern and never will,
 * so a field is a **permanently marker-free anchor on every spell in the
 * book** — and a marker-less entry written against one would keep any shape
 * claimed forever without anybody reading a paragraph. That is the unclaimed
 * rule rotting from the other end. So the phrase must occur exactly once
 * across the printed units, which is one question asked of every population
 * and where a field is a legitimate place for a *blocker* to be printed, and
 * then the unit the marker rule reads must be a sentence.
 * {@link BlockedClause} is the entry form for a blocker a field prints —
 * Find Familiar's hour, and Hallow's twenty-four hours until that spell was
 * written — and it needs no marker to begin with. A blocker a field prints
 * therefore cannot survive a spell being written, and does not have to: a
 * definition holds its own casting time.
 *
 * Parameterised over the entries for the reason {@link sentenceGaps} is: a
 * guard that can only be run against the data it already agrees with is not a
 * guard, so the tests drive this with entries built to be caught before running
 * it on the real map.
 */
export const misanchoredAdjudications = (
  spellId: string,
  entries: readonly TrackedAdjudication[] = TRACKED_ADJUDICATED[spellId] ?? [],
): readonly MisanchoredAdjudication[] => {
  const units = printedUnitsOf(spellId);
  const sentences = sentencesOf(spellId);
  const found: MisanchoredAdjudication[] = [];
  const complain = (clause: string, complaint: string) =>
    found.push({ spell: spellId, clause, complaint });

  for (const entry of entries) {
    const phrase = flatten(entry.clause);
    const unanchored = unanchoredWithin(spellId, units, [entry.clause]);
    if (unanchored.length > 0) {
      complain(
        entry.clause,
        `the spell's printed entry does not say it exactly once (${unanchored[0]!.matches} matches)`,
      );
      continue;
    }
    const unit = sentences.find((text) => text.includes(phrase));
    if (unit === undefined) {
      complain(
        entry.clause,
        'it is in no sentence of the prose: a printed field trips no marker, so an entry anchored to one says nothing either rule can read',
      );
      continue;
    }
    const named = mechanicalMarkersIn(unit);
    if (entry.marker === null) {
      if (named.length > 0) {
        complain(
          entry.clause,
          `it is filed with no marker and the markers see ${named.join(', ')} in the unit it names`,
        );
      }
      if (entry.why === 'engine' || entry.why === 'expressible') {
        complain(
          entry.clause,
          `a marker-less entry may not claim the engine reaches a sentence no marker can see, so it must name a missing shape or the table rather than "${entry.why}"`,
        );
      }
    } else if (!named.includes(entry.marker)) {
      complain(
        entry.clause,
        `it is filed under ${entry.marker} and the unit it names trips ${
          named.length === 0 ? 'no marker' : named.join(', ')
        }`,
      );
    }
  }
  return found;
};

/**
 * The markers this spell's prose trips that no written entry answers.
 *
 * The coverage half of the same rule, and the half a marker-less entry must not
 * be able to satisfy: `marker === null` matches no marker, so writing one
 * leaves every demand exactly where it was.
 */
export const unansweredMarkers = (
  spellId: string,
  entries: readonly TrackedAdjudication[] = TRACKED_ADJUDICATED[spellId] ?? [],
): readonly MarkerId[] => {
  const spell = spellByIdOrThrow(spellId);
  const prose = `${spell.description}\n${spell.higherLevel ?? ''}`;
  return mechanicalMarkersIn(prose).filter(
    (marker) => !entries.some((entry) => entry.marker === marker),
  );
};

/**
 * The tracked map with every marker-less entry taken out.
 *
 * The counterfactual the entry form exists for, as a value: hold this map to
 * the rule it had before — every entry carries a marker — and
 * {@link claimedShapes} loses the readings only a reader could have written,
 * which is what "the shape gets retired" means arithmetically.
 */
export const withoutMarkerLessEntries = (
  tracked: Readonly<Record<string, readonly TrackedAdjudication[]>>,
): Readonly<Record<string, readonly TrackedAdjudication[]>> =>
  Object.fromEntries(
    Object.entries(tracked).map(([spellId, entries]) => [
      spellId,
      entries.filter((entry) => entry.marker !== null),
    ]),
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

/** A tracked definition, as much of one as the gap below needs to read. */
export interface TrackedDefinition {
  readonly id: string;
  /** The definition's own `unmodelled` list, which is a list of **debts**. */
  readonly unmodelled: readonly string[];
}

/**
 * The tracked definitions whose own `unmodelled` nobody has read.
 *
 * {@link coverageGaps}' rule pointed at the second population, and it is the
 * same rule: **an entry missing from a map says nothing**, and a report that
 * reads a missing entry as "no debt" is reporting the unread state as zero.
 * `docs/design/content.md` is where the difference is drawn — "An `unmodelled`
 * line is a **debt**: the blocker map ranks it, and one day somebody pays it by
 * building the shape" — so a tracked definition that prints one and carries no
 * {@link TRACKED_ADJUDICATED} entry is a debt no map ranks.
 *
 * `stale` has no counterpart here: a tracked spell whose entry outlived it is
 * already caught by `blocked-on.test.ts`, which asserts every key of the map is
 * a definition the catalogue holds.
 *
 * Parameterised over the population for the reason {@link coverageGaps} is —
 * the caller restricts it, and only the caller knows to what. The ledger asks
 * it of the tracked spells in level-5 reach; a test drives it with a synthetic
 * definition built to be caught.
 */
export const trackedAdjudicationGaps = (
  tracked: readonly TrackedDefinition[],
  adjudicated: Readonly<Record<string, readonly unknown[]>> = TRACKED_ADJUDICATED,
): { readonly unrecorded: readonly string[] } => ({
  unrecorded: tracked
    .filter((one) => one.unmodelled.length > 0 && adjudicated[one.id] === undefined)
    .map((one) => one.id)
    .sort(),
});

export interface ShapeConsumers {
  readonly shape: ShapeId;
  /** Executed definitions carrying a clause adjudicated to this shape. */
  readonly executed: readonly string[];
  /** Tracked definitions whose SRD prose was adjudicated to it. */
  readonly tracked: readonly string[];
  /**
   * Of those, the ones whose claim no mechanical marker could have demanded.
   *
   * The *Read* column's floor, reported rather than described: each of these is
   * a sentence somebody read in words the guard does not know, and each would
   * have been dropped — and the shape retired — under the entry form that
   * required a marker. A reader of the table can tell the two apart, which is
   * the difference between a floor and a proof.
   */
  readonly unseen: readonly string[];
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
  const unseen = sorted(
    Object.entries(TRACKED_ADJUDICATED)
      .filter(([, entries]) =>
        entries.some((entry) => entry.why === shape && entry.marker === null),
      )
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
    unseen,
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

/**
 * Every shape any population claims, which is what keeps the map from rotting.
 *
 * Parameterised over the tracked map alone, because that is the population
 * whose entry form changed: a caller may ask what would still be claimed if
 * every marker-less entry were dropped, which is the counterfactual
 * {@link withoutMarkerLessEntries} builds and the reason the form exists.
 */
export function claimedShapes(
  tracked: Readonly<Record<string, readonly TrackedAdjudication[]>> = TRACKED_ADJUDICATED,
): ReadonlySet<string> {
  const claims: readonly (string | undefined)[] = [
    ...Object.values(ADJUDICATED).flatMap((entries) => entries.map((entry) => entry.why)),
    ...Object.values(tracked).flatMap((entries) => entries.map((entry) => entry.why)),
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
  'a-bonus-narrowed-to-a-skill':
    '**A standing bonus that reaches one skill.** This id stood in the spell vocabulary while SRD Enthrall claimed it, and Enthrall is executed now: the *ongoing* side is whole — `BonusNarrowing` is the axis, the `buff` effect and the `bonus` rider in `spell-definitions.ts` carry it as `only`, an `ActiveBonus` carries an optional ability and skill beside its `BonusApplies` list, `bonusesFor` withholds a narrowed bonus from a roll that does not match, `checkBonuses` and `savingSupport` pass what the roll knows about itself, and `passivePerceptionOf` in packages/engine/src/standing.ts derives the passive score from the same stored bonus — which is what finished Guidance, Pass without Trace, Slow’s Dexterity saves and Enthrall’s −10. What is left is true of an item and false of a casting, which is the rule this vocabulary keeps: a **standing** grant has no such field. `standingBonuses` reads `StandingBonusApplies` and `standingCheckBonuses` is a sibling gatherer keyed by a feature’s own named skills, so a `flat-bonus` an item grants reaches `ability-check` as a whole family — Gloves of Thievery’s SRD line, "+5 bonus to Dexterity (Sleight of Hand) checks", would land on every Intelligence, Wisdom and Strength check the wearer ever makes — and `bard:jack-of-all-trades`, whose SRD narrowing is "a skill proficiency you **lack**" rather than a named skill, has nowhere to go either. The field is the same one the ongoing side grew; the reader that has not grown it is the standing one.',
  'a-spell-an-item-casts-that-nothing-executes':
    'the item’s line says it casts a named spell and the catalogue has **no definition of that spell at all**. `checkContent` refuses the pairing in as many words — packages/engine/src/content.ts, "which this content has no executable definition of" — so an item that casts Scrying, Levitate or Gate cannot be written until the spell is, and the blocker is the spell’s own. It is the largest single blocker in the book’s magic items and it is not item work at all, which is the finding: a tranche aimed at wands buys nothing until the spells under them exist. **The word that decides an entry is *definition*, not *executable*, and this description said otherwise for a batch.** The predicate `checkContent` hands an item is `spells.some(s => s.id === id)` — packages/engine/src/content.ts, the call site of `itemGrantProblems` — and `castFromItem` reads `content.spell(id)`, so a **tracked** definition answers both. That is SRD’s own sentence about what a casting from an item is: "The spell uses its normal casting time, range, and duration, and the user of the item must concentrate if the spell requires Concentration", every word of which a tracked definition already carries. A Wand of Magic Detection and a Ring of Animal Influence came off this shape without a line of spell work, and `item-casts-a-tracked-spell.test.ts` drives both directions so the distinction cannot be lost again. What *should* name this shape is an entry whose spell nothing defines — and, for a **potion**, a spell whose definition resolves nothing, because a `confers` grant carries the definition’s `SpellEffect[]` and "an item that confers an empty list confers nothing". **Sixty definitions later, every entry here has been read against the catalogue again**, entry by entry and spell by spell rather than against this line: thirteen named the shape with every spell they print already defined and have been re-pointed or transcribed, which is why this is no longer the heaviest blocker in the book. The two the last reading wrote down as wrong are both settled — `chime-of-opening` is transcribed, because a use count that never comes back is `recovers: \'special\'` on a pool keyed to the copy; and `amulet-of-the-planes` is **unread**, because what gates its defined Plane Shift is "make a DC 15 Intelligence (Arcana) check" and a check gating a casting still has no id, which is a shape this vocabulary will not invent in a note.',
  'a-save-an-item-forces':
    'a saving throw an item makes somebody roll — **half built, and the half that is missing is not the DC**. The roll and the number are there: packages/engine/src/content.ts admits the first, "A saving throw is not on that list any more.", and says where the second comes from, "`saveDc` on the grant is a number the item printed and `save-damage` resolves against it through the resolver a casting uses". So a save whose failure is **damage** is writable today, which is why Dust of Dryness’s 10d6 and Javelin of Lightning’s 4d6 no longer name this shape. A save whose failure imposes a **condition** is writable too, and was the last of the weld to go: the same file admits the kind — "Nor is `save`, which was the last of that weld." — and says what a conferral’s repeat ends, "so a condition a flask’s saving throw imposes repeats its save at the boundary like a spell’s, and a success ends it on the timer the conferral’s own hour filed". What is not built is every *other* thing a failed save can do, which the rule in docs/design/content.md still leaves out — an item is "refused an effect kind a conferral cannot resolve", and there is no kind for most of them. What still names this shape is therefore a save whose outcome is neither damage nor a condition: a wielder who goes berserk, a creature trapped in a flask or a mirror, an Undead simply destroyed. **That re-derivation has been given.** Every entry that named this shape for a condition a save imposes, or for damage a save halves, has been re-pointed — a bag of beans to its area and its table, a greatclub to its Cone — and what is left under it is the outcome the rule in docs/design/content.md has no kind for.',
  'a-charge-spent-on-something-other-than-a-casting':
    'a charge the item’s line spends on something that is not a spell — **half built, and the half that is missing is what the charge buys**. A conferral may now be priced, and may offer a range to choose within: packages/engine/src/content.ts reads the cost the way a casting’s is read, "and a pool on the same item for the charges to come out of", and refuses one with nothing behind it, "confers for charges and declares no charge pool for them to come out of" — so a staff is spent where a potion is used up, out of the item’s own pool and through the one spender. What is **not** built is a benefit that grows with the count spent, which is the rest of SRD Staff of Striking’s sentence: "For each charge you expend, the target takes an extra 1d6 Force damage". Nothing in the effect vocabulary scales dice by a charge count — an `attack-rider` carries a bare notation, and packages/engine/src/content.ts refuses every scaling field a conferral could reach for, "reads a slot level or a caster level, and an item’s printed line is the same whoever uses it" — so a priced conferral today pays a chosen price for a fixed benefit, and the staff waits on a field this vocabulary has not invented. The other residue is a charge spent on something no grant kind executes at all — a Reaction, a trigger, a rider on a later weapon attack — which the same file’s enumeration of what an item’s readers run already names: "only a standing grant, a charge pool, a spell it casts and the effects it confers are read from one". **And the entries have been read against that split rather than left where the price put them.** Every one that named this shape only because a charge bought a conferral has been re-pointed to whatever the conferral itself cannot say — a Truesight, a Fly Speed, an Emanation, a range — and SRD Periapt of Health, whose charge buys nothing but the Potion of Healing’s own dice, came off it into the catalogue. A charge that buys a **casting** was never this shape at all, except where the price itself is unsayable: Staff of Healing’s "1 charge per spell level (maximum 4 for a level 4 spell)" is a cost that reads the slot, and `ItemCastsGrant.charges` is one number.',
  'a-condition-an-item-imposes':
    'a condition an item puts on a creature, **and what is left is every way of imposing one that is neither handing it over nor rolling the item’s own saving throw for it**. Both of those are built. packages/engine/src/content.ts admits the kind — "Nor is a condition any more." — and the save that imposes one, "Nor is `save`, which was the last of that weld.", refusing with it only the repeat whose success would end a casting. **And the residue this description named for two batches was already untrue when it was written**: a conferral *can* state a span it rolls for. `durationRolled` sits beside `durationSeconds` on the grant, `useItem` throws it once at the use and pins the deadline it decided, and SRD Dust of Disappearance — "for 2d4 minutes" — is transcribed on it and driven in packages/content/src/item-re-derivation.test.ts. What actually stands in the way is three things, and each entry below says which of them it has: a condition **welded to the same saving throw that deals the damage** ("or take 1d4 Bludgeoning damage and have the Prone condition"), which is `save-damage`’s `conditions` rider and refused by name — packages/engine/src/content.ts, "rider is welded to the casting that hung it"; a condition whose **escape is a check**, or whose span is not a number of seconds — a `ConditionRider`’s `check` and `lasts` are refused for the same reason, and `durationSeconds` is seconds, so SRD Mace of Disruption’s "until the end of your next turn" and SRD Dragon Orb’s "for as long as you remain attuned to it" have nowhere to go; and a condition **ended by something done to its holder** — SRD Rod of Rulership’s "If harmed by you or your allies" — which is the one end cause that names a dealer, and the one `EFFECT_END_CAUSES` leaves out because a conferral has no caster. A condition the holder switches off by decision is `a-benefit-an-item-switches-on-and-off` seen from the condition’s end, one a printed sentence suspends is `a-benefit-an-item-suspends-on-a-trigger`, and one that lands further away than an arm is `a-range-an-item-names`. **One thing the reading nearly recorded as a defect and which is a decision, written down so the next reader does not make the same mistake**, the way the Helm of Telepathy’s entry records the two economies an item cannot declare. The rider refusal above reads differently on a feature and on an item — a feature’s exempts the `save` kind, packages/engine/src/content.ts, "kind === \'save\' || CONDITIONS_IS_THE_KINDS_OWN.has(kind)", where an item’s reads only the set — and that is **deliberate and stated in the same file**, which calls it "the one rule a conferral does not share" and says what it buys: "a feature hangs the two SRD Turn Undead prints". The difference is real and reaches real input, because `save` carries a `conditions` list beside its flat first rider. So the shape an item is short of is **a saving throw that imposes more than one condition at once**, not a predicate somebody forgot to share; no entry below prints that sentence, which is why it has no id here rather than a place in the residue list.',
  'a-damage-roll-an-item-makes':
    'damage an item deals without a casting — and the question the last description left open has an answer now: **no, the first residue does not need an id of its own.** Damage that simply lands, with neither an attack roll nor a saving throw to decide it, is one gap wherever it is written, and the spell vocabulary already names it `damage-with-neither-an-attack-roll-nor-a-save`. So Potion of Poison’s 4d6, a talisman that burns whoever touches it, a staff’s explosion on its own wielder and a manual that scorches whoever cannot read it are filed under that id below, and this shape has stopped claiming them. What is left under this name is the **other** residue, which is an item that rolls an **attack of its own**: packages/engine/src/content.ts refuses the kind by name — "`attack` is refused by name, and so is `attack-damage`, which rides on an attack this is not" — and a conferral has no attacker, no printed modifier and no target past arm’s length to point one at. SRD Ring of the Ram writes the whole shape in one sentence, "The ring produces a spectral ram’s head and makes its attack roll with a +7 bonus", and Iron Bands of Binding writes the same roll with no damage on the end of it — which makes the id a slightly narrower thing than its name says, and it is kept rather than renamed so the two entries under it stay findable by it. The save-gated half is built and stays built: a conferral prints its own DC and `save-damage` resolves against it, which is why a horn that blasts and a javelin that forks into lightning left this shape and never came back.',
  'a-range-an-item-names':
    'a distance the item’s own line prints between its user and whatever its use lands on. **A conferral reaches its user, or one creature within five feet.** SRD’s sentence about administering a potion is the whole of that reach — "administer it to another creature within 5 feet of yourself" — and `useItem` asks it through `reachedBy(state, id, target, item.name)` at that function’s own default of five; the grant has no field for a range, and `UseItemCommand` has one target and no second. So a wand whose ray streaks 60 feet, a rope that darts 20 and a talisman that opens a fissure at 120 each have a condition, a saving throw, a DC and a span the vocabulary can write down, and nowhere at all to write down how far any of it goes. **This is the blocker the re-derivation found underneath the two it was sent to check.** Entry after entry named `a-condition-an-item-imposes` for a condition that had been sayable for two batches, and what was actually in the way was the thirty feet between the pipes and the creature that hears them. **Sized here, so that a brief need not re-derive it — and it is two fields rather than one.** All but one of the entries below point at exactly *one creature* the user can see, at a distance their own line prints: a rope at 20 feet; a gem’s beam, a wand’s ray, a ring’s spectral head, an iron sphere and a compelled Elemental at 60; either talisman at 120. That is a reach on a `confers` grant, and **whether more than one creature is caught is a separate gap already filed apart** — an item whose line catches several at once names `an-area-an-item-creates`, which the 2024 rules’ Emanation covers — so a single distance beside the conferral closes that half whole. The **other** half is a `casts` grant, and SRD Necklace of Fireballs is the whole of it: "detach a bead and throw it up to 60 feet away" *narrows* Fireball’s printed Range of 150 at a **point** rather than a creature, and `resolveTargets` enforces the spell’s own Range. So an item may neither reach further than five feet under its own power nor reach less far than the spell it casts, and a brief that sized only the first would leave the necklace exactly where it is. What such a field would *finish* is derived into the report rather than asserted here, and it is the column to read before the blocking one: an entry this shape is the only blocker for is a record somebody writes the day the field lands. The first entry transcribed under this reach writes the same thing down as a note, in packages/content/src/items.ts: "a conferral reaches its user or one creature within 5 feet and has no field for an area".',
  'a-reduction-an-effect-applies-to-damage':
    'a rolled amount a worn item takes off a hit before the defences meet it — SRD Ring of Warmth: "If you take Cold damage while wearing this ring, the ring reduces the damage you take by 2d8." **The spell half of this shape is built and the id moved here with what was left**, which is the rule this vocabulary states: what lives over here is only what is true of an **item** and false of a casting. A casting hangs one through the `damage-reduction` effect and SRD Resistance walks through it; an item has no such door. docs/design/content.md is where the refusal is written — an item that confers an effect without casting one is "refused an effect kind a conferral cannot resolve" — and this is one of those kinds: the ring is not concentrating, has no casting to be released with, and its 2d8 is the same arithmetic under a source nothing would ever end.',
  'a-speed-an-effect-multiplies':
    'a Speed **doubled** by an item. **The spell half of this shape is built and the id moved here with what was left**, which is the rule this vocabulary states: what lives over here is only what is true of an item and false of a casting. `SpeedChange` carries `double` now and `combineSpeed` carries the order the SRD does not print — base, plus the flat changes, doubled once, halved once, then zeroed, so SRD Slow cast over SRD Haste brings a creature back to the Speed it walked at — and SRD Haste is executed off it. SRD Boots of Speed print the same operation through a door that does not exist: an item confers effects without casting anything, and `ITEM_EFFECT_KINDS` omits `speed` for the reason its neighbour below records, so the boots have nothing to hang a doubling on whatever the vocabulary can now express. `docs/design/spell-definitions.md` is where the composition rule is fixed: "Halving is presence rather than count — the reading Resistance and Advantage already take. Zero is last and **wins**".',
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
    'training an item confers — a language you know while you wear it, a weapon you are suddenly proficient with. **Half of it is a `FeatureGrant` kind now and an item still cannot carry it**: `weapon-and-armor-training` was built for SRD Divine Order and Primal Order, which grant Martial weapons and Heavy or Medium armour on a class feature, and an item reaches none of it — packages/engine/src/content.ts, "only a standing grant, a charge pool, a spell it casts and the effects it confers are read from one". A language is not a grant kind at all: a language is a `ClassDefinition` field, so there is no member to read from an item and none to refuse. One shape rather than two, because one line of the reader admits both and each entry’s own note says which the item wanted.',
  'an-item-instance-with-a-state-of-its-own':
    'a fact about **this** copy of an item rather than about the catalogue row — and **the line that decides an entry has moved twice**, so it is drawn here rather than left to a reader’s sense of it. The identity exists (docs/design/characters-and-equipment.md: "An item copy **has** an identity now"), and so does the one kind of per-copy state the engine holds: a **charge pool keyed to the copy**, whose maximum the book may roll at the copy’s birth (`CatalogueItem.chargesRolled`, thrown by `awardItems`), which travels whole when the copy is handed over, and which `recovers: \'special\'` leaves exactly where it lands. So a per-copy fact that is a **spendable count** is no longer a gap: a bag with 3d4 beans in it, a prism with fifty charges, a manual a reader has used up, a talisman spent to nothing. What is left under this name is every *other* fact a copy carries, and each of the entries below says which of its own: **which kind** this one is out of several (a necklace’s beads, a robe’s patches, a scroll’s spell), **which parts** are left rather than how many (a deck’s thirty-four cards, a helm’s four counts of gems against one pool), **how long it has burned** (a candle’s minutes, a timer the clock moves and no command spends), **what was rolled for it once** (an efreeti bottle’s course), **what is inside it** (an iron flask’s prisoner), **which other copy it is paired with** (a sending stone), and **a change it makes to another item** (an oil that turns a sword into a +3 Weapon). And the one the shape was first written for: an arrow that stops being magical the moment it hits, which is a state a use changes and not a use it spends. packages/content/src/items.ts carries the same distinction on the potion that forced it — the other rows of the healing table "would need four ids, or an item instance record, to sit on one inventory line", which is *which kind*, the first entry in the list above.',
  'a-version-of-an-item-the-book-leaves-to-the-gm':
    'one printed entry that is several items, where **the GM chooses which**. Not the `+1, +2, or +3` template, whose versions the book names and rates one by one and which the catalogue expands into records; this is "The GM chooses the type or determines it randomly by rolling on the following table", printed over damage types, giants, dragons, planes and elementals. packages/content/src/items.ts says what it would cost on the entry that already forced the question — the other healing potions "would need four ids, or an item instance record, to sit on one inventory line" — and a record that picked one version for everybody would be a catalogue asserting what the book leaves open.',
  'a-container-with-a-space-of-its-own':
    'an item that holds other items. docs/archive/design/characters-and-equipment.md states the absence outright — "No containers." and "Items are a flat list per creature" — so a bag whose capacity, weight and contents are the whole of its rules has nothing to be written against. Several of the book’s wondrous items are containers and nothing else.',
  'an-object-with-statistics-of-its-own':
    'a thing with an Armour Class, Hit Points and a position that is not a creature. docs/archive/design/casting.md settled the spell side by refusing exactly this — a casting may hold a point, and "No entity, no object record, no second identity, nothing in the scene’s `positions` table" — while filing "A thing with statistics" under the summons seam, which is still open. A tower, a boat, an animated rope and a sword that hovers and attacks are all on the far side of it.',
  'an-area-an-item-creates':
    'a Cone, a Sphere or an Emanation an item puts on the battlefield. docs/archive/design/space-and-areas.md ties an area to the casting that made it — "So a casting’s area sits at a point *or* on a creature, and which it is was decided at the casting by the definition" — and an item that confers effects has no casting, no definition and no area field, so a horn that blasts a 30-foot Cone reaches its targets by hand or not at all. **And the clause SRD Mace of Terror writes, "each creature of your choice within 30 feet of you", is one of these** — which the re-derivation had to settle to file the pipes, the mace and the rod. The 2024 rules write that sentence as an Emanation; a conferral lands on one creature however far it reaches; so an item that catches several at once wants this shape and not `a-range-an-item-names` alone.',
  'what-ends-attunement-besides-a-command':
    'an attunement that ends, or refuses to end, for a reason no command gives. docs/design/characters-and-equipment.md names it as the second thing a brief still owes — "what ends attunement besides a command — death, losing the item, another creature attuning to it" — and the book’s cursed items are the other half of that missing rule: armour that cannot be doffed until a Remove Curse lands is an attunement its holder may not release. **The spell half is built**: an `end-attunement` effect breaks the Attunement to the object the caster names, SRD Remove Curse is executed off it, and the death and the item gone were already derived by the fold. What is left is the **refusal** — an attunement a curse will not let go of until that spell lands — which is a state no item record holds, and the four cursed items still sit on it.',
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
 * Every shape **any** entry, in any of the three books, may name.
 *
 * The owner's disposition of 2026-09-21, taken after the third time
 * `TrackedAdjudication.why` was too narrow: rather than a fourth enumeration,
 * `why` names a shape in any of the three maps. The three widenings it
 * replaces were all the same discovery arriving from a different book —
 * Remove Curse's attunement is an item's gap finished on a spell's sentence,
 * Hex is a definition nobody wrote, and the action nobody can spend is a
 * **feature** shape three spells are blocked on.
 *
 * **It rests on the three id spaces being disjoint**, which is asserted
 * rather than left to the naming convention: a string that named a shape in
 * two maps would make every `why` ambiguous, and each consumer would resolve
 * it by whichever map it looked in first. See `why-names-any-shape.test.ts`.
 *
 * `FeatureBlockerId` in `missing-feature-shapes.ts` is this same union and
 * predates it by one book; the declaration lives there because that is the
 * file that can see all three. The type import here is erased, so the value
 * cycle between the two files stays one-way.
 */
export type BlockerId = ShapeId | ItemShapeId | FeatureShapeId;

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
  // Re-derived. The explosion is a `save-damage` with half on a success and
  // the toadstool's Poisoned is a condition a save imposes, and both of those
  // are built — what keeps the bag out is the 10-foot Sphere it goes off in,
  // and the 1d100 table of effects the GM rolls or chooses from underneath it.
  // The condition the shape would still be right about is on the toadstool,
  // welded to the same save as the 5d6, and it is inside that table.
  'bag-of-beans': [
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
  // One id lighter: the Advantage on saves to avoid or end the Poisoned
  // condition is writable now, on the same axis three species traits and
  // Protection from Poison took. Four blockers stand, so the entry stays
  // blocked and nothing about its pile changes.
  'belt-of-dwarvenkind': [
    'a-language-or-a-proficiency-an-item-grants',
    'a-bonus-narrowed-to-a-skill',
    'an-ability-score-a-spell-changes',
    'senses-beyond-declared-sight',
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
  // Re-pointed, and the condition was never the blocker: three charges
  // regaining 1d3 at dawn is a pool, a Magic action that spends one is a
  // priced conferral, and "the Invisible condition for 1 hour" is the Potion
  // of Invisibility's own grant. What has no reader is the sentence that ends
  // it — "if you pull the hood down (no action required) or cease wearing the
  // cloak" — which is a decision and a doffing, and `EFFECT_END_CAUSES` holds
  // neither. Granting the hour without them would be a cloak nobody can take
  // off, which is rule 3 in packages/content/src/items.ts.
  'cloak-of-invisibility': ['a-benefit-an-item-switches-on-and-off'],
  // Polymorph is defined and tracked, and "on yourself" is `targetsSelfOnly`,
  // so the casting the cloak prints is writable and the per-dawn limit is a
  // pool of one. What is left is the Stealth Advantage and the Fly Speed.
  'cloak-of-the-bat': ['a-bonus-narrowed-to-a-skill', 'movement-modes'],
  'cloak-of-the-manta-ray': ['a-speed-an-item-grants', 'movement-modes'],
  // Re-pointed. "DC 15 Constitution saving throw or take 2d10 Poison damage
  // and have the Poisoned condition for 1 minute" is a save the vocabulary
  // can write; what it hangs off is a hit with this weapon, and the coating
  // is a Bonus Action that arms it and a minute that disarms it.
  'dagger-of-venom': ['a-rider-on-a-later-weapon-attack', 'a-benefit-an-item-switches-on-and-off'],
  'dancing-sword': ['an-object-with-statistics-of-its-own'],
  // The shape keeps this one, and for the reason the rewritten description
  // gives: "must succeed on a DC 13 Strength saving throw or take 1d4
  // Bludgeoning damage and have the Prone condition" is one save with two
  // consequences, which is `save-damage`'s `conditions` rider — refused on a
  // conferral because a rider is welded to the casting that hung it. The
  // geyser's Line is the other half.
  'decanter-of-endless-water': ['a-condition-an-item-imposes', 'an-area-an-item-creates'],
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
  // Re-pointed: the shackles impose no condition at all. What they do is
  // refuse a creature "any method of extradimensional movement, including
  // teleportation or travel to a different plane of existence", which is the
  // half of the suppression shape read from the target's side rather than an
  // area's — the same reading that shape already records for SRD Freedom of
  // Movement. Not the action rule: `ActionRule` narrows the six named actions
  // and their slots, and a plane is not one of them.
  'dimensional-shackles': [
    'a-fact-only-the-table-can-declare',
    'an-effect-that-suppresses-other-magic',
  ],
  // Every spell on the orb's table is defined — Cure Wounds and Suggestion
  // execute, Daylight, Death Ward, Detect Magic and Scrying are tracked — so
  // the five castings and their 1d4 + 3 dawn are writable. The Charmed
  // condition its own save imposes keeps the condition shape, and the
  // re-derivation says which of the three residues it has: its span is "for
  // as long as you remain attuned to it", which is not a number of seconds.
  'dragon-orb': [
    'a-condition-an-item-imposes',
    'a-version-of-an-item-the-book-leaves-to-the-gm',
    'an-object-with-statistics-of-its-own',
  ],
  'dragon-scale-mail': [
    'a-version-of-an-item-the-book-leaves-to-the-gm',
    'a-mode-on-the-save-a-spell-forces',
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
  'dust-of-sneezing-and-choking': [
    'an-area-an-item-creates',
    'an-automatic-success-by-creature-type',
  ],
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
  // The condition shape is kept, for the second of the three residues rather
  // than the first: "a creature Restrained by an arrow can make a DC 20
  // Strength (Athletics) check to try to break the restraint" is a
  // `ConditionRider`'s `check`, which a conferral is refused because the
  // escape releases the casting the instance names.
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
  // Re-derived, and only one of its three blockers survived. The Blinded
  // condition its DC 15 save imposes, the minute it lasts and the repeat that
  // ends it are all built, and a charge spent on a conferral is built too —
  // what is left is "at one creature you can see within 60 feet of yourself"
  // for the second command word, the 30-foot Cone for the third, and a light
  // that lasts "until you take a Bonus Action to repeat the command word".
  'gem-of-brightness': [
    'a-benefit-an-item-switches-on-and-off',
    'a-range-an-item-names',
    'an-area-an-item-creates',
  ],
  // Re-pointed: a charge buying ten minutes of something is a priced
  // conferral, which is built. What a conferral may not carry is the
  // something — `CONFERRED_EFFECT_KINDS` has no `sense` member, so the
  // Truesight is the whole of what keeps the gem out.
  'gem-of-seeing': ['senses-beyond-declared-sight'],
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
      note: 'a `flat-bonus` reaches `ability-check` and that is the whole family, so this five would land on every Intelligence, Wisdom and Strength check the wearer ever makes. The narrowing to one skill is the field a casting’s stored bonus already carries — SRD Enthrall’s Perception penalty reads it — and a pair of gloves prints the same sentence the other way up, on a standing grant that has no such field.',
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
  // Re-derived a second time. The Cone stays and the percentage stays; the
  // condition stays for the first residue — "a creature takes 5d8 Thunder
  // damage **and** has the Deafened condition", one save with two
  // consequences, which is `save-damage`'s refused `conditions` rider — and
  // the explosion's 10d6 on the user comes off the item damage shape onto the
  // spell vocabulary's, because it lands with nothing rolled to decide it.
  'horn-of-blasting': [
    'an-area-an-item-creates',
    'a-condition-an-item-imposes',
    'a-random-outcome-that-is-not-a-d20',
    'damage-with-neither-an-attack-roll-nor-a-save',
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
  'iron-bands': [
    'a-condition-an-item-imposes',
    'a-damage-roll-an-item-makes',
    'a-range-an-item-names',
  ],
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
  // Re-pointed off the charge shape: the blade's charge buys a **casting**
  // — "you can expend 1 charge and cast _Wish_ from it" — which is the
  // `casts` grant's own price, and 1d3 of them at the copy's birth is
  // `usesRolled`. Wish is undefined and the reroll replaces a result.
  'luck-blade': [
    'a-roll-result-an-effect-replaces',
    'a-spell-an-item-casts-that-nothing-executes',
  ],
  // All three kept, and the condition for the second residue: "the creature
  // has the Frightened condition **until the end of your next turn**" is a
  // span measured in turns, and a conferral's `durationSeconds` is seconds.
  'mace-of-disruption': [
    'a-rider-on-a-later-weapon-attack',
    'a-save-an-item-forces',
    'a-condition-an-item-imposes',
  ],
  // Re-derived, and two of its three went. A charge spent on a conferral is
  // built, and so is a save that imposes Frightened for a minute with a
  // repeat at the end of each turn. What is left is "each creature of your
  // choice within 30 feet of you", which catches more than one, and what the
  // Frightened creature must then do with its turns.
  'mace-of-terror': ['an-action-a-spell-compels-or-forbids', 'an-area-an-item-creates'],
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
    'a-version-of-an-item-the-book-leaves-to-the-gm',
    'damage-with-neither-an-attack-roll-nor-a-save',
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
  // **Back to unread, which is the honest pile rather than a demotion.**
  'necklace-of-adaptation': {
    unread:
      'its one grandfathered blocker was the condition-keyed save, and that axis is built: "Advantage on saving throws made to avoid or end the Poisoned condition" is now a standing roll mode an item grant can carry, on the same axis Fey Ancestry and Protection from Poison took. So nothing mechanical stands between this paragraph and a record — and a bare list of ids was never the reading that would say so. What is left is the other half of the sentence, "you can breathe normally in any environment", which somebody has to weigh against rule 1 in packages/content/src/items.ts before this becomes a record or a piece of fiction. Unread is the honest pile for that, and it is where an entry goes by default rather than by decision.',
  },
  // **Placed, by the shape the re-derivation had to name anyway** — and then
  // read to the end of the paragraph, which is where the second blocker was.
  // The last reading left this unread because "the blocker it named is gone
  // without another to take its place", and the one it wanted is the missing
  // range field seen from the other end: "you can take a Magic action to
  // detach a bead and **throw it up to 60 feet away**" is a distance the
  // item's own line prints, and no grant an item carries has anywhere to put
  // one. Fireball's own Range is 150 feet and `resolveTargets` enforces it,
  // so a record written today would hand out a necklace with two and a half
  // times the reach the book gives it — the unsayable clause *limiting* the
  // benefit, which is rule 3 in packages/content/src/items.ts.
  //
  // The **second** paragraph is the Ring of the Ram's residue wearing beads:
  // "increase the damage of the _Fireball_ by 1d6 for each bead after the
  // first (maximum 12d6)" is a benefit that grows with the count spent, and
  // nothing in the effect vocabulary scales dice by one. Recording it here
  // rather than leaving the entry on the range alone, because the *finishes*
  // column is what a tranche is planned from and an entry that needs two
  // fields must not sit in it.
  //
  // What is writable: 1d6 + 3 beads is `chargesRolled`, Fireball executes,
  // and "the bead detonates as a level 3 _Fireball_ (save DC 15)" is a
  // `casts` grant priced at one bead.
  'necklace-of-fireballs': [
    'a-charge-spent-on-something-other-than-a-casting',
    'a-range-an-item-names',
  ],
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
  'periapt-of-wound-closure': [
    'a-roll-result-an-effect-replaces',
    'healing-modified-by-an-effect',
  ],
  // Re-pointed, and the condition was never it: "have the Charmed condition
  // for 1 hour" is a conferral's own grant, hour and all. What the engine
  // cannot see is when it starts and who it is about — "The next time you
  // see a creature within 10 minutes after drinking this philter, you are
  // charmed **by that creature**" — which is a sighting the table declares
  // and a charmer no `ConditionRider` names.
  'philter-of-love': ['a-fact-only-the-table-can-declare'],
  // Re-pointed. Three charges regaining 1d3 at dawn is a pool, a charge
  // spent on a conferral is a price, and Frightened for a minute with a
  // repeat at the end of each turn is the save kind. What is left is "each
  // creature of your choice within 30 feet of you", which is more than one
  // creature, and the memory the tune leaves behind — "a creature that
  // succeeds on its save is immune to the effect of these pipes for 24
  // hours", an immunity narrowed to the thing that caused it.
  'pipes-of-haunting': [
    'a-condition-immunity-narrowed-to-its-source',
    'an-area-an-item-creates',
  ],
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
  // **Re-pointed, and it is the entry that answered the damage shape's own
  // question.** The middle clause is built — "must succeed on a DC 13
  // Constitution saving throw or have the Poisoned condition for 1 hour" is
  // a `save` effect against the bottle's printed DC, with its hour on the
  // conferral — so the condition shape has nothing to do here. What is left
  // is the 4d6, which arrives whether the save is made or not: a hit with no
  // roll to decide it, which is the spell vocabulary's own id and not a
  // second gap because an item printed it. packages/content/src/items.ts
  // says the same about this potion in the POTIONS docstring.
  'potion-of-poison': ['damage-with-neither-an-attack-roll-nor-a-save'],
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
  // Re-pointed off the condition shape. Its Charmed is imposed by the ring's
  // own DC 18 save, which is built; what the same sentence then says is not
  // — "you determine what it does with its move and action on its next
  // turn" — and the sixty feet it reaches is the other half.
  'ring-of-elemental-command': [
    'a-version-of-an-item-the-book-leaves-to-the-gm',
    'a-language-or-a-proficiency-an-item-grants',
    'a-range-an-item-names',
    'a-spell-an-item-casts-that-nothing-executes',
    'an-action-a-spell-compels-or-forbids',
    'movement-modes',
    'a-speed-an-item-grants',
  ],
  // The charge shape is kept, and for the residue the rewritten description
  // names rather than for the price: what this charge buys is a Reaction
  // taken on a failed save, which is not a conferral at all.
  'ring-of-evasion': [
    'a-reaction-an-item-grants',
    'a-charge-spent-on-something-other-than-a-casting',
  ],
  'ring-of-feather-falling': [
    {
      clause: 'take no damage from falling',
      why: 'table',
      note: 'the damage is a rule now and the cancelling is not: `resolveFall` deals a die per ten feet against a stated height, and nothing reduces or refuses it on behalf of one creature, so a ring that takes none of it has no grant to be. The descent rate is still nobody’s — no rule drops a creature or measures how fast.',
    },
  ],
  'ring-of-free-action': [
    'difficult-terrain-an-area-creates',
    'a-condition-immunity-narrowed-to-its-source',
  ],
  // Re-pointed: the Invisible condition is handed over outright, which is
  // the Potion of Invisibility's own grant. What the ring prints instead of a
  // duration is "until the ring is removed or until you take a Bonus Action
  // to become visible again" — no span at all, and a conferral that hangs a
  // condition must say how long it lasts or hang nothing.
  'ring-of-invisibility': ['a-benefit-an-item-switches-on-and-off'],
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
  // **The one entry the damage shape is still about**, and it keeps both:
  // "The ring produces a spectral ram's head and makes its attack roll with a
  // +7 bonus" is an attack an item rolls itself, and "for each charge you
  // spend, the target takes 2d10 Force damage" is a benefit that grows with
  // the count spent, which is the charge shape's own surviving residue. The
  // sixty feet is the third.
  'ring-of-the-ram': [
    'a-charge-spent-on-something-other-than-a-casting',
    'a-damage-roll-an-item-makes',
    'a-range-an-item-names',
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
  // Re-pointed off the condition shape: Blinded for a minute with a repeat
  // Constitution save at the end of each turn is the save kind, whole. What
  // no rule can see is the trigger — "A _Light_ spell cast on the robe or a
  // _Daylight_ spell cast within 5 feet of the robe" targets the garment.
  'robe-of-eyes': ['a-fact-only-the-table-can-declare', 'senses-beyond-declared-sight'],
  // The condition shape is kept for the second residue and the charge shape
  // goes: a charge spent on a conferral is built, and what is not is the span
  // — "the Stunned condition **until the effect ends**", where the effect
  // itself runs "until the end of your next turn". Neither is a number of
  // seconds. The Bright Light that decides who is caught is the other half.
  'robe-of-scintillating-colors': [
    'a-condition-an-item-imposes',
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
  // Re-pointed off the condition shape. Both conditions the rod imposes are
  // built — Paralyzed for a minute on a hit, Frightened for a minute on a
  // Magic action, each with a repeat that ends on its own target. What is
  // left is the six buttons, the two properties that ride a melee hit, the
  // Drain Life whose failure feeds the wielder, and the thirty feet
  // _Terrify_ reaches round the holder.
  'rod-of-lordly-might': [
    'a-benefit-an-item-switches-on-and-off',
    'a-rider-on-a-later-weapon-attack',
    'a-save-an-item-forces',
    'an-area-an-item-creates',
  ],
  // The condition shape is kept, and this is the entry the **third** residue
  // was written for: "If harmed by you or your allies ... a target ceases to
  // be Charmed in this way" names the creature that dealt the harm, and
  // `EFFECT_END_CAUSES` holds the four causes that are a fact about the
  // creature the timer sits on and not that one — it needs a caster, and a
  // conferral has none. The 120 feet and the several targets are the rest.
  'rod-of-rulership': ['a-condition-an-item-imposes', 'an-area-an-item-creates'],
  'rod-of-security': ['a-fact-only-the-table-can-declare', 'healing-modified-by-an-effect'],
  'rope-of-climbing': ['an-object-with-statistics-of-its-own', 'a-bonus-narrowed-to-a-skill'],
  // The condition shape is kept for the second residue: the Restrained it
  // imposes has no span at all — it ends when the holder lets go — and the
  // way out is "a DC 15 Strength (Athletics) or Dexterity (Acrobatics)
  // check", which is a `ConditionRider`'s refused `check`. Twenty feet is the
  // third thing, and the rope's own AC 20 and 20 Hit Points the fourth.
  'rope-of-entanglement': [
    'a-condition-an-item-imposes',
    'a-range-an-item-names',
    'an-object-with-statistics-of-its-own',
  ],
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
  'sphere-of-annihilation': [
    'an-object-with-statistics-of-its-own',
    'damage-with-neither-an-attack-roll-nor-a-save',
  ],
  // Charm Person executes and Command and Comprehend Languages are tracked,
  // so all three of the staff's castings are writable. The Reaction that
  // reflects an Enchantment and the failed save it turns into a success are
  // what is left.
  // The charge shape is kept, and for the surviving residue rather than the
  // price: the staff's second charge buys a Reaction — "you can take a
  // Reaction to expend 1 charge from the staff and turn the spell back on its
  // caster" — which is not a conferral and not a casting either.
  'staff-of-charming': [
    'a-reaction-an-item-grants',
    'a-charge-spent-on-something-other-than-a-casting',
    'a-rider-on-the-face-the-die-showed',
  ],
  'staff-of-frost': [
    'a-spell-an-item-casts-that-nothing-executes',
    'a-rider-on-the-face-the-die-showed',
  ],
  // The charge shape is kept, for the one way a **casting's** price can be
  // unsayable: "1 charge per spell level (maximum 4 for a level 4 spell)" is
  // a cost that reads the slot, and `ItemCastsGrant.charges` is one number.
  // Cure Wounds, Lesser Restoration and Mass Cure Wounds are all defined.
  'staff-of-healing': [
    'a-charge-spent-on-something-other-than-a-casting',
    'a-rider-on-the-face-the-die-showed',
  ],
  'staff-of-power': [
    'a-spell-an-item-casts-that-nothing-executes',
    'a-bonus-to-spell-attack-rolls',
    'a-rider-on-the-face-the-die-showed',
    'an-area-an-item-creates',
    'damage-with-neither-an-attack-roll-nor-a-save',
  ],
  'staff-of-striking': ['a-charge-spent-on-something-other-than-a-casting'],
  // The charge shape is kept: an Emanation of insects that obscures an area
  // for ten minutes is a charge spent on something no grant kind executes at
  // all, which is the residue the shape's description names.
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
    'damage-with-neither-an-attack-roll-nor-a-save',
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
  // The condition shape is kept, and this staff has two of the three
  // residues at once: _Thunder_ hangs its Stunned "until the end of your next
  // turn", which is not a number of seconds, and _Thunderclap_ writes "a
  // creature takes 2d6 Thunder damage **and** has the Deafened condition for
  // 1 minute" — one save with two consequences, which is the refused rider.
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
    'a-filter-on-the-attackers-creature-type',
    'a-range-an-item-names',
    'a-save-an-item-forces',
    'damage-with-neither-an-attack-roll-nor-a-save',
  ],
  'talisman-of-the-sphere': [
    'a-fact-only-the-table-can-declare',
    'an-object-with-statistics-of-its-own',
  ],
  // Both talismans re-point the same way: the 8d6 a Fiend or an Undead takes
  // for touching one lands with nothing rolled to decide it, and the charge
  // buys a conferral, which is built. What is left is the +2 to spell attack
  // rolls, the creature-type filter, the 120 feet, and a failed save whose
  // outcome is destruction rather than damage or a condition.
  'talisman-of-ultimate-evil': [
    'a-bonus-to-spell-attack-rolls',
    'a-filter-on-the-attackers-creature-type',
    'a-range-an-item-names',
    'a-save-an-item-forces',
    'damage-with-neither-an-attack-roll-nor-a-save',
  ],
  // Re-read against the grant that landed, and its first clause is no longer
  // a blocker: "While you are attuned to this magic weapon, your Strength is
  // 20 unless your Strength is already equal to or greater than that score"
  // is an `ability-score-set` behind `while-attuned`, which the Gauntlets of
  // Ogre Power now write. Five clauses keep the entry out.
  // Re-derived again, and three more clauses stopped being blockers. The
  // Prone its Cone imposes is a condition a save hands over. The extra
  // Thunder it deals to objects is damage to a thing with statistics rather
  // than damage an item rolls an attack for. And **the rider was never
  // needed**: "The weapon deals an extra 1d8 Thunder damage to any creature
  // it hits" is an `attack-damage` effect narrowed by `onlyWithItem`, which
  // packages/content/src/items.ts already writes on a Frost Brand — a
  // *rider on a later weapon attack* is the shape for a die a **separate**
  // sentence hangs on a later hit, and this die belongs to the object
  // unconditionally. What is left is the Cone, the fissure a failed save
  // drops a creature into, the Concentration the tremor breaks, and the 50
  // Bludgeoning its earthquake deals to structures.
  'thunderous-greatclub': [
    'a-save-an-item-forces',
    'an-area-an-item-creates',
    'an-object-with-statistics-of-its-own',
    'an-outcome-that-breaks-concentration',
  ],
  // The three tomes print the three manuals' sentence again; read them there.
  'tome-of-clear-thought': ['an-ability-score-a-spell-changes'],
  'tome-of-leadership-and-influence': ['an-ability-score-a-spell-changes'],
  'tome-of-understanding': ['an-ability-score-a-spell-changes'],
  'trident-of-fish-command': ['a-target-rule-the-format-cannot-state'],
  // Re-pointed off the charge shape: a charge buying a minute of something
  // is a priced conferral, which is built. Knowing "the direction of the
  // nearest creature Hostile to you within 60 feet" is a sense, and
  // `CONFERRED_EFFECT_KINDS` has no member for one.
  'wand-of-enemy-detection': [
    'senses-beyond-declared-sight',
    'a-rider-on-the-face-the-die-showed',
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
  // **The clearest case the re-derivation turned up, and the entry the range
  // shape finishes.** Every other clause of this wand is built: seven charges
  // regaining 1d6 + 1 at dawn is a pool, a charge spent on a conferral is a
  // price, and "must succeed on a DC 15 Constitution saving throw or have the
  // Paralyzed condition for 1 minute. At the end of each of the target's
  // turns, it repeats the save, ending the effect on itself on a success" is
  // the `save` kind in the book's own words.
  //
  // **The die face came off by the rule stated above rather than by
  // judgement.** This wand's last sentence is the crumble clause *verbatim* as
  // the Wand of Fireballs, the Wand of Web, the Wand of Fear, the Wand of
  // Binding, the Wand of Polymorph and the Wand of Lightning Bolts print it,
  // and every one of those is transcribed carrying it in `unmodelled`: a
  // record without it is a wand that lasts longer than the book's, not one
  // that does more. It was listed here only because the condition blocked the
  // entry anyway, and the condition no longer does. So what stands between
  // this wand and a record is one field: "a creature you can see within 60
  // feet of yourself".
  'wand-of-paralysis': ['a-range-an-item-names'],
  'wand-of-the-war-mage-1-2-or-3': [
    'a-bonus-to-spell-attack-rolls',
    'a-fact-only-the-table-can-declare',
  ],
  // Re-pointed off the condition shape: what this wand does is rolled on a
  // 1d100 table of its own, so the conditions on that table arrive through
  // the roll and never through a conferral.
  'wand-of-wonder': [
    'a-random-outcome-that-is-not-a-d20',
    'a-rider-on-the-face-the-die-showed',
    'a-spell-an-item-casts-that-nothing-executes',
    'a-version-of-an-item-the-book-leaves-to-the-gm',
  ],
  'well-of-many-worlds': {
    unread:
      'read, and the blocker cannot be named without inventing a shape. A two-way portal between planes is neither an area, nor an object with statistics, nor a teleport destination stated at a casting, and nothing in this repository has described a planar portal as a gap. It is not fiction either — creatures pass through it — so it may not be filed as the table’s.',
  },
  // The Wind Fan is transcribed. It was re-pointed twice before it was built:
  // Gust of Wind is defined and tracked, so the casting was always writable,
  // and what was left was the die behind "a cumulative 20 percent chance of
  // not working" and the count of uses it is rolled against. The count is a
  // tally — a pool with no size, which is what let the sixth use roll at a
  // hundred instead of being refused — and the die is a `1d100` the engine
  // throws before the spell is cast at all.
  // Re-pointed off the charge shape: "expend 1 charge, gaining a Fly Speed of
  // 30 feet for 1 hour" is a priced conferral with a printed span, and
  // `CONFERRED_EFFECT_KINDS` even admits `speed`. What it does not admit is a
  // *mode*: `SpeedChange` adds, halves or zeroes the one Speed the engine
  // holds, so a Fly Speed has nowhere to land.
  'winged-boots': ['a-speed-an-item-grants', 'movement-modes'],
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
