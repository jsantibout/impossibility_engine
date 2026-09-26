/**
 * What the engine actually does, measured against the SRD rather than recalled.
 *
 * Three states, kept apart on purpose, because conflating them is how a
 * project believes it is finished:
 *
 * | State | Means |
 * |---|---|
 * | **parsed** | `@ie/srd` has the record: id, level, school, class list, prose |
 * | **tracked** | the engine casts it — action, slot, Concentration, duration — and says what the DM does |
 * | **executed** | a `SpellDefinition` with effects the engine resolves: dice, saves, targets |
 * | **verified** | an integration test drives it end to end through `resolveSpell` |
 *
 * A catalogue entry is not an implementation, and neither is a refusal that
 * says the spell is unsupported. **Tracked and executed are not the same
 * claim** and are never added together: a tracked spell spends everything the
 * casting costs and leaves the effect to the table, which is the right answer
 * for Disguise Self and would be a lie about Fireball.
 *
 * **What shape a spell needs is not measured here, and used to be.** Thirteen
 * prose regexes filed every parsed spell under "the hardest thing its text
 * needs" and the report printed the buckets beside a hand-written blocker
 * column — which put two answers to one question in one file: the classifier
 * filed 43 spells under a casting time of a minute or more and called them
 * blocked on machinery IE-034 had built, while the derived table two sections
 * down counted 54 touched and 12 finished. That is the three-documents-three-
 * answers failure `missing-shapes.ts` was written to end, arriving inside one
 * report, and nothing asserted the classifier's output, which is both how it
 * drifted and why deleting it cost nothing. The shape question is a query over
 * that map now, and `COVERAGE.md`'s "What blocks the rest" is where it prints.
 *
 * Classes are measured the same way and the three states mean the same things,
 * with one difference worth stating: a class *feature* declares its own
 * automation, `engine` or `manual`, so the middle column is not inferred. A
 * manual feature is not a failure — several of them are judgement the engine
 * should never take from a DM — but a project that does not count them will
 * believe it has twelve working classes when it has twelve validated ones.
 *
 * **Species and backgrounds declare automation exactly as a class does**, and
 * were counted nowhere until they were, which is how a week of honest
 * transcription came to be invisible in the one file that holds this
 * project's numbers. `auditOrigins` reads them with the class column's own
 * predicate. Feats are not counted, because a `FeatDefinition` declares no
 * automation and there is nothing to read.
 *
 * **Magic items have two populations rather than one**, and the difference is
 * the whole of what `auditMagicItems` is careful about: the SRD writes
 * _Weapon, +1, +2, or +3_ once, as a template over the weapon table, and the
 * catalogue holds a record per version because an inventory holds a sword.
 * Entries transcribed and records held are different claims about different
 * things and are never divided by each other.
 *
 * **This module is the measurement; `coverage.ts` is the report.** The split is
 * not tidiness. The two claims live here because tests want them —
 * `coverage.test.ts` and `spell-honesty.test.ts` both hold this file's lists
 * against what the suite actually drives — and a module a test imports must do
 * nothing when it is imported. The renderer used to be the same module, and it
 * wrote `COVERAGE.md` at top level, so the suite regenerated the very file the
 * gauntlet then diffed: `git diff --exit-code COVERAGE.md` was asserting that
 * the suite had run rather than that the report was right. Nothing here has a
 * top-level effect, and `coverage-script.test.ts` holds the whole directory to
 * that.
 *
 * Run the report with `npm run coverage`.
 */

import { readFileSync } from 'node:fs';
import { SPELL_DEFINITIONS, SRD_CONTENT, SRD_MAGIC_ITEMS } from '@ie/content';
import {
  adaptMonster,
  readPrintedRiders,
  type ClassDefinition,
  type FeatureDefinition,
  type SpellDefinition,
  type SubclassDefinition,
} from '@ie/engine';
import { asCharacterId } from '@ie/shared';
import { ADJUDICATED } from './missing-shapes.js';
import {
  MAGIC_ITEM_CATEGORIES,
  entryFor,
  isCompleteItem,
  magicItemEntries,
} from './magic-items.js';

export interface ParsedSpell {
  readonly id: string;
  readonly name: string;
  readonly level: number;
  readonly school: string;
  readonly classes: readonly string[];
  readonly castingTime: string;
  readonly ritual: boolean;
  readonly range: string;
  readonly duration: string;
  readonly concentration: boolean;
  readonly description: string;
  readonly higherLevel?: string;
}

/**
 * Executed spells that still carry an engine-owned clause nobody has built.
 *
 * **The third state, and it exists because two could not tell the truth.**
 * `verified` claims a spell is driven end to end; `untested` says nothing
 * drives it. Spirit Guardians was neither: its Emanation, its three trigger
 * clauses, its cap, its save and its damage all run under a suite of their
 * own, and the halved Speed inside the Emanation is a rule the engine owns and
 * has not written.
 *
 * **It is derived, and the copy it replaces existed only because the map lived
 * in a test file.** A spell is partial because one of its `unmodelled` clauses
 * is adjudicated to a named missing shape rather than to the table — a
 * consequence of the debts rather than of somebody's memory — and while those
 * adjudications were `spell-honesty.test.ts`'s, a report generator that
 * imported the test suite would have had the dependency backwards, so the
 * consequence was written out here and asserted against the derivation in both
 * directions. IE-015 moved the map to `missing-shapes.ts`, which is not a test
 * file for the reason this is not: `npm run coverage` runs outside vitest. With
 * the map on this side of that line the reason to keep a copy is gone, and the
 * assertion that held the two in step goes with it — a second spelling of one
 * derivation is the second place to get it wrong rather than a guard against
 * the first.
 *
 * **It came out equal to the hand list it replaced, entry for entry**, which is
 * what says this was a deletion and not a measurement.
 *
 * **Partial and verified are different axes.** Banishment is driven end to end
 * *and* leaves the demiplane its target was meant to spend the minute in
 * unbuilt, and saying only the first would be the green tick this state was
 * invented to prevent. Web was the example until "while in the webs" was
 * built; what it has left is the table's, so it is executed whole and is no
 * longer in this list at all.
 *
 * A spell derived into this list **must** say in `unmodelled` what it is
 * missing, which `coverage.test.ts` asserts — otherwise this becomes the place
 * claims come to be quietly parked.
 *
 * Sorted, because the map it reads is one two branches both append to.
 */
export const PARTIAL_SPELLS: readonly string[] = Object.entries(ADJUDICATED)
  .filter(([, entries]) => entries.some((entry) => entry.why !== 'table'))
  .map(([spellId]) => spellId)
  .sort();

/**
 * Spells an integration test drives end to end.
 *
 * **This one stays written out, and the asymmetry with `PARTIAL_SPELLS` above
 * is the point rather than an oversight.** Partial is a consequence of the
 * adjudication map, so it can be derived from it; *verified* is a claim about
 * which tests drive which spell, and nothing in the engine, the catalogue or
 * that map says so. There is no second place this could be read from, which is
 * exactly why it is here: a generated claim about test coverage that nothing
 * checks would be the failure this file exists to prevent.
 *
 * `coverage.test.ts` checks what can be checked — every entry is a spell the
 * catalogue can execute, named once, in an order two branches can both append
 * to. That a test really drives it is the reviewer's, because no derivation can
 * say so; the entry belongs in the commit that writes the test.
 */
export const VERIFIED_SPELLS: readonly string[] = [
  'acid-splash',
  // `alter-self.test.ts` (engine): the claws dealing 1d6 Slashing with
  // Charisma on a punch, the growth's type asked for, the Magic action
  // swapping claws for gills — the swim come, the rider gone, the word
  // re-pinned, the Action spent — and the same word, an unprinted one and
  // none refused; Change Appearance handed over whole.
  'alter-self',
  'animal-friendship',
  'arcane-sword',
  // `creature-type-override.test.ts`: the Mask laid on a Fey goblin, the
  // goblin's own type standing untouched underneath it, Hold Person catching
  // it masked and refusing it unmasked, the type the book forbids choosing,
  // and the mask gone the moment the casting is dispelled.
  'arcanists-magic-aura',
  // `spell-chance.test.ts`: the rite is declared, the minute passes and it
  // settles, twice over — the first casting throwing no die and the second
  // one d100 against 25, with a seeded failure withholding the omen.
  'augury',
  'bane',
  'banishment',
  // `armor-class-floor.test.ts` (engine): a scout at 12 read 17, a knight in
  // plate left at 18, a +2 swallowed by the floor and a +6 clearing it.
  'barkskin',
  'beacon-of-hope',
  // `later-blows.test.ts` (engine): each of the four faces cast off a level
  // 3 slot with the save forced to fail — the chosen ability over checks and
  // saves and over no other ability, the attack Disadvantage narrowed to the
  // caster and not to the fighter beside them, the extra 1d8 on a mace hit
  // and on a Magic Missile and on nobody else — a made save curses nothing,
  // and the slot table buys ten minutes at level 4 and eight hours with no
  // Concentration at level 5.
  'bestow-curse',
  'black-tentacles',
  'bless',
  'blight',
  'blindness-deafness',
  // `blink.test.ts`: the d6 thrown and recorded at the end of the caster's
  // turn, both faces reached, the Ethereal Plane with the space left pinned,
  // an attack and a Fireball reaching nothing of the caster, and the return
  // at the start of the next turn asked for, refused at fifteen feet and into
  // an occupied space, and taken where stated — and the same return when the
  // spell ends first.
  'blink',
  'blur',
  'burning-hands',
  // `calm-emotions.test.ts` (engine): one goblin chosen for the Immunity and
  // one for indifference off one Sphere, the Frightened already on the first
  // silenced and back when the Concentration is let go, the second's sentence
  // handed over, a saved creature granted nothing, the map pinned on the
  // record, and the six refusals a per-creature choice is held to.
  'calm-emotions',
  'charm-monster',
  'charm-person',
  'chill-touch',
  'chromatic-orb',
  'circle-of-death',
  // Driven end to end by `spell-options.test.ts` (engine): the word refused
  // when none was spoken and when a sixth was, Halt forbidding the move, the
  // action and the Bonus Action to the end of the target's next turn, Drop
  // emptying both hands, Grovel knocking it Prone, a made save doing none of
  // the three, Approach handing its sentence over and moving nobody, and no
  // word running another word's branch. Partial as well as verified: every
  // one of the five is obeyed inside a turn the engine does not direct.
  'command',
  'compulsion',
  'cone-of-cold',
  'conjure-fey',
  'conjure-woodland-beings',
  // `sight.test.ts` (engine): cast on its bearer, its light read back and
  // standing until dispelled.
  'continual-flame',
  'counterspell',
  'cure-wounds',
  // `sight.test.ts` (engine): a dim patch re-laid where its Bonus Action moves it.
  'dancing-lights',
  // The three P3-S finished, each driven end to end through `resolveSpell` in
  // `light-and-sight.test.ts`: the Sphere Darkness pins and the Darkvision it
  // defeats, the bright core and dim ring Daylight lays, the bank Fog Cloud
  // grows with the slot, and the dispel the first two owe each other.
  'darkness',
  // `sight.test.ts` (engine): the sense conferred and read by `sensesOf`.
  'darkvision',
  'daylight',
  'dimension-door',
  'dispel-magic',
  'dissonant-whispers',
  'divine-favor',
  'divine-smite',
  // `dragons-breath.test.ts` (engine): the sorcerer's touch with Fire stated
  // and pinned, the fighter's Magic action exhaling a 15-foot Cone east, both
  // goblins asked for a Dexterity save and scorched for 3d6 Fire with the
  // fighter named as the dealer, the sorcerer refused their own spell's action,
  // an exhalation with no direction refused, a target list refused, and the
  // exhaler's own Action spent rather than the caster's.
  'dragons-breath',
  'eldritch-blast',
  'enhance-ability',
  // `enlarge-reduce.test.ts` (engine): the fighter Large to every reader and
  // to the map and Medium again when the Concentration is let go, Advantage
  // on a Strength save and check and not on a Dexterity save, a longsword hit
  // a die heavier off one seed; Reduced, the reverse and a hit a die lighter
  // and never below one; a goblin that makes the Constitution save left as it
  // was and one that fails it shrunk; a willing target offered no die.
  'enlarge-reduce',
  // `ensnaring-strike.test.ts` (engine): a Ranger's held hit settled with the
  // strike, the goblin's Strength save and the Restrained under the casting,
  // the Ogre's Advantage read off its size, the resisted ending, the d6 at the
  // goblin's turn start at two slot levels, and the fighter beside it tearing
  // it free on an Athletics success that ends the spell.
  'ensnaring-strike',
  // `filtered-catch.test.ts`: the 20-foot square, the caster left standing in
  // their own plants, the Strength save, the Athletics escape freeing one
  // creature and not the rest, the Concentration ending releasing everybody,
  // and the ground charging double until it does.
  'entangle',
  // `enthrall.test.ts` (engine): the bandit the party is fighting spared
  // before the die is read, the bystander's Perception check ten lower than
  // its Insight check off one die, and its Passive Perception ten lower
  // through the same stored bonus.
  'enthrall',
  'faerie-fire',
  'false-life',
  'fear',
  'finger-of-death',
  'fire-bolt',
  'fire-shield',
  'fireball',
  'flame-blade',
  'flame-strike',
  'fog-cloud',
  // `dismissals-and-the-cloud.test.ts` (engine): the Fly Speed of 10 that is
  // the whole of how the cloud moves, the walking and swimming Speeds it
  // takes away, the hovering that keeps a stopped cloud up, the Attack
  // action and the casting it refuses, and the Magic action its target
  // spends to end it — which its caster's ally may not spend at all.
  'gaseous-form',
  // `gentle-repose.test.ts` (engine): a corpse ninety seconds dead raised
  // because eighty of them were under the repose, the same corpse refused
  // without it, a repose laid seventy seconds late taking back only what it
  // ran for, a living target refused, and the record on the body.
  'gentle-repose',
  // `glyph-of-warding.test.ts` (engine): an hour's inscription pinning the
  // rune and its stated type on a record with no deadline, the DM's decision
  // erupting on the thief ten feet from the glyph and not the one forty feet
  // off, the casting ended by the firing, the slot carried into the dice, one
  // command id firing it once, and a spent glyph or a spell with no trigger
  // refused.
  'glyph-of-warding',
  'goodberry',
  'grease',
  'greater-invisibility',
  'guidance',
  'guiding-bolt',
  // `movement-rider.test.ts` (engine): the Strength save, the fifteen feet
  // down the Line for a creature that fails it and nothing for one that makes
  // it, and no damage to anybody either way. `metamagic.test.ts` spares a
  // named ally the save with Careful Spell.
  'gust-of-wind',
  'harm',
  // `haste-and-slow.test.ts`: the doubled Speed against SRD Slow's halving in
  // the order `combineSpeed` fixes, and the lethargy the ending lays — laid by
  // a Concentration let go and by the minute running out, and lifted at the end
  // of the target's next turn and not before.
  'haste',
  'healing-word',
  // `heat-metal.test.ts`: the breastplate's wearer burned, a failed save
  // dropping a held mace, the same failure leaving the armoured knight holding
  // his breastplate with Disadvantage instead, a made save leaving both alone,
  // and the Bonus Action dealing the damage again on a later turn.
  'heat-metal',
  'heroism',
  // `later-blows.test.ts` (engine): the 1d6 Necrotic on a mace swing and on a
  // Fire Bolt at the cursed creature and on neither aimed at anybody else,
  // the chosen ability's Disadvantage over checks and not saves, eight hours
  // out of a level 3 slot, and the Bonus Action that curses a new creature —
  // refused while the first stands, refused on one out of sight, refused on
  // the creature it already marks. Hunter's Mark's own Bonus Action is
  // driven in the same file.
  'hex',
  'hideous-laughter',
  'hold-monster',
  'hold-person',
  'hunters-mark',
  'hypnotic-pattern',
  // `sequenced-roll.test.ts` (engine): the shard, then the burst — on a hit,
  // on a miss, on the neighbour five feet away and not the one fifteen.
  'ice-knife',
  'ice-storm',
  'inflict-wounds',
  'insect-plague',
  'invisibility',
  // `spell-tracking.test.ts`: cast, spent, and the four printed sentences —
  // every one about an object — handed to the table whole.
  'knock',
  'lesser-restoration',
  // `movement-rider.test.ts` (engine): the Constitution save, twenty feet of
  // air for a creature that fails it, the hold recorded under the casting's
  // own source, and the gentle landing the fold performs when the casting
  // ends. `metamagic.test.ts` rolls the save at Disadvantage with Heightened
  // Spell.
  'levitate',
  // `sight.test.ts` (engine): carried by its bearer and moving with them, out
  // with the hour and put out by a Darkness cast over it.
  'light',
  'lightning-bolt',
  'longstrider',
  'mage-armor',
  // `magic-circle.test.ts`: the stated types refused three ways and pinned
  // into the clauses, a Fiend barred a step in, its Misty Step saving on
  // Charisma and held back on a failure, Disadvantage on its shot at the cleric
  // inside and none on a Humanoid's, its Frightened refused, and the reverse
  // holding a Fiend inside.
  'magic-circle',
  'magic-jar',
  // `auto-damage.test.ts`: three darts round the list, five out of a level 3
  // slot, the caster's own uneven split, a Sanctuary ward turning them away
  // and a Resistance halving each dart rather than the pool.
  'magic-missile',
  // `dismissals-and-the-cloud.test.ts` (engine): the rite of a minute
  // declared with the ending its caster chose, settled, and then ended by
  // that caster — and the same rite with nothing said refused
  // `not_dismissible`, because the book prints a casting that runs until
  // dispelled no ending at all.
  'magic-mouth',
  // `slot-changes-the-ending.test.ts` (engine): the illusion cast at a level 3
  // slot with a Concentration and a deadline, the same illusion at a level 4
  // slot with neither and still findable, and the Investigation check it could
  // not offer said out loud on the casting that has no timer to hang it on.
  'major-image',
  'mass-cure-wounds',
  'mind-blank',
  'mind-spike',
  'misty-step',
  'moonbeam',
  // `area-standing.test.ts`: the Ranger's aura, the Rogue on the list taking
  // the +10 on a Stealth check and nothing on a Perception one, the Fighter
  // inside it and off the list taking nothing, the Rogue five feet too far
  // taking nothing, and the pair walking forty feet with the bonus travelling
  // and no grant hung on anybody.
  'pass-without-trace',
  // Driven end to end by `casting-terrain.test.ts`: the Overgrowth cast at a
  // point, the four feet per foot its own paragraph prints charged over the
  // Sphere, and the patch left standing because the casting is Instantaneous
  // and SRD gives the plants no ending.
  'plant-growth',
  'poison-spray',
  // Driven end to end by `executed-second-pass.test.ts`: the ten-minute rite
  // declared and settled, the 2d8 and its per-slot die measured over sixty
  // seeds by the gap between two means, and the Short Rest it does not confer
  // named in its own clause.
  'prayer-of-healing',
  // `castings-running-at-once.test.ts`: three tricks running beside each
  // other, a fourth ending the oldest, and another caster's three untouched.
  'prestidigitation',
  'produce-flame',
  'protection-from-energy',
  // `protection-from-evil-and-good.test.ts`: the Ghoul swinging at Disadvantage
  // and the bandit swinging normally, the Ghoul unable to frighten the cleric
  // and the bandit able to, and the two clauses the spell still owes reported
  // on every casting.
  'protection-from-evil-and-good',
  'protection-from-poison',
  // `ray-of-enfeeblement.test.ts`: the Constitution save, the Disadvantage a
  // failure hangs on every Strength-based D20 Test and on no other, the 1d8 it
  // takes off the target's own longsword and off its own spell, the one attack
  // roll a success costs it, and the repeat at the end of its turn ending the
  // spell and the penalty with it.
  'ray-of-enfeeblement',
  'ray-of-frost',
  'ray-of-sickness',
  // Driven end to end by `executed-second-pass.test.ts`: the minute on the
  // clock, the slot spent only when the rite finishes, 4d8 + 15 held to its
  // bounds and to its mean over sixty seeds, and the hit point a turn read
  // off the target's vitals after the turn was advanced rather than off the
  // dice — a payout the casting rolls nothing of would otherwise pass every
  // assertion in the file while being wrong.
  'regenerate',
  // `breaking-an-attunement.test.ts`: the Attunement to the named cloak
  // broken while the cloak stays worn, an item the target is not attuned to
  // refused, a casting naming no object refused, and no slot spent on either.
  'remove-curse',
  // Driven end to end by `damage-reduction.test.ts`: the d4 off a blow of the
  // type the caster named, the order that takes it before the halving rather
  // than after, the once-per-turn limit measured across three rays of one
  // Scorching Ray, the held road a Reaction opened, the grant going back when
  // the Concentration does, and the refusal for a casting that names no type.
  'resistance',
  // `revive.test.ts`: a corpse thirty seconds old back at one hit point with
  // its death saves afresh, one ninety seconds old refused, a living creature
  // refused, and the slot neither refusal spends.
  'revivify',
  // `rope-trick-and-familiar.test.ts`: the rope kept as a point, a climber
  // within five feet, the Large creature and the ninth refused, a Fire Bolt
  // at a climber refusing `not_here`, the climb down, and the drop at the
  // spell's end to spaces the caller names.
  'rope-trick',
  'sacred-flame',
  // Driven end to end by `several-attack-rolls.test.ts`, and partial as well,
  // which is the pairing `sorcerous-burst` already stands for: three rays
  // counted in the log out of one casting, a fourth bought with a level 3
  // slot, each ray's damage held to its own 2d6, the deal over one, two and
  // three creatures, an all-miss casting that still throws every ray, and a
  // byte-identical replay from the seed.
  'scorching-ray',
  // Driven end to end by `burning-smite.test.ts` (engine): settled onto a held
  // greatsword hit, the extra die measured against the same swing without it,
  // the casting it leaves running and its minute, and then the burning — the
  // fire dealt at the start of the target's turns and the Constitution save
  // after it, a seeded failure keeping it alight for another turn, a seeded
  // success ending the casting and the burning with it, and a level 2 slot
  // paying double each time. Divine Smite beside it is asserted to leave no
  // record at all.
  'searing-smite',
  'shatter',
  // `shield.test.ts` (engine): both triggers. The Armour Class raised against
  // a held hit, and the second clause the spell waited on a window for — the
  // wizard answering a declared Magic Missile and taking none of its darts
  // while the fighter beside them takes theirs, with the negation pinned by
  // casting id so a second caster's volley still lands.
  'shield',
  // Driven end to end by `executed-second-pass.test.ts`: refused by the
  // ordinary casting command, then settled onto a held greatsword hit, with
  // the 2d6 Radiant and its per-slot die measured as the gap between two
  // populations of sixty swings rather than pair by pair — naming the smite
  // advances the generator, so the same seed no longer rolls the same sword.
  'shining-smite',
  'shocking-grasp',
  // `area-standing.test.ts`: the Sphere placed at a point, a goblin entirely
  // inside it Deafened and immune to Thunder with no event written, an ogre
  // straddling its edge neither, a Thunderwave that deals the goblin nothing,
  // the goblin walking out and losing both, and a Verbal casting refused there
  // where one with no Verbal component is not.
  'silence',
  // Driven end to end by `repeat-save-deepens.test.ts`: the 5-foot Sphere
  // catching two sleepers and not a third, the Incapacitated, the repeat at
  // the end of the sleeper's own next turn, a seeded second failure deepening
  // to Unconscious with no further save raised, a seeded success freeing that
  // one and leaving the other asleep, and a blow ending the spell on the
  // creature it landed on and on nobody else.
  'sleep',
  // `sleet-storm.test.ts` (engine): the Cylinder's terrain and obscurement
  // read back, and a wizard's Bless taken by a failed Dexterity save.
  'sleet-storm',
  // Driven end to end by `bare-save.test.ts`, with Faerie Fire above it: both
  // are cast through `resolveSpell` at a placed target, and the grants their
  // failed saves hand out are read back off the folded state — a halved
  // Speed, an Armour Class two lower, a Reaction taken away, an Invisible
  // condition its holder no longer benefits from. Both are partial as well,
  // which is the other axis.
  'slow',
  // Driven end to end by `carrier-areas.test.ts`, and partial as well: the two
  // are different axes, and while they were one state this spell could only be
  // recorded as the second. Saying "untested" of a spell with its own suite
  // would be the same report telling a different lie.
  'sorcerous-burst',
  // `spare-the-dying.test.ts` (engine): the dying ally made Stable, the hale
  // one and the corpse refused, the shortlist offering the first and excluding
  // the other two, thirty feet reached by a level 5 cleric and refused to a
  // level 4 one, and the shortlist bounded by the same band.
  'spare-the-dying',
  // `speak-with-plants.test.ts` (engine): the mouther's carried ground
  // ordinary inside thirty feet of the druid's square and still double beyond
  // it, the Emanation pinned to the square rather than the druid, the ground
  // back when the ten minutes are up, and the other branch overgrowing open
  // ground.
  'speak-with-plants',
  // Driven end to end by `casting-terrain.test.ts`: the Sphere conjured at a
  // point through `resolveSpell`, and the glossary's rate charged over it.
  // The move that costs twice the ground it crosses is Grease's in the same
  // file — one walk proves the ruler, and what this entry claims is that this
  // spell's own casting lays a patch.
  'spike-growth',
  'spirit-guardians',
  'spiritual-weapon',
  // Driven end to end by `denied-benefits.test.ts`: cast through `resolveSpell`
  // at a creature made Invisible by something else, the three readers that
  // hand that condition its benefits asked before and after the hit, the
  // condition still standing on the creature underneath, and the benefit
  // handed back at the rider's own deadline a round later.
  'starry-wisp',
  // Driven end to end in `area-triggers.test.ts`: conjured at a point, a
  // creature starting its turn in the Sphere, the Constitution save rolled at
  // the boundary, the Poisoned landing, and the condition gone when that same
  // turn ends. Partial as well as verified, which is the pair Spirit Guardians
  // above already records — the gas runs and the sentence after it does not.
  'stinking-cloud',
  'stoneskin',
  'sunburst',
  // Driven end to end by `spell-options.test.ts` (engine): the wonder named
  // at the casting, its own sentence handed to the table and the other five
  // withheld, and a fourth casting ending the first of the three the book
  // lets run at once. Partial as well as verified: Booming Voice's Advantage
  // is a mode with no creature to land on.
  'thaumaturgy',
  'thunderwave',
  // `tiny-hut.test.ts`: the dome pinned where it rose with who was inside, a
  // goblin barred a step in and a Fire Bolt at the wizard, a Fireball out
  // refused at level 3 and a Cone of Cold passed at level 5, a Fireball from
  // outside catching nobody inside, the fighter walking out and back, and the
  // wizard's step out ending the casting.
  'tiny-hut',
  // Driven end to end by `cantrip-with-the-swing.test.ts` (engine): the cantrip
  // named on the attack command, the Action spent as the casting's and no
  // Attack action taken, `spell-cast` ahead of the roll, both rolls made with
  // the caster's spellcasting ability, the Radiant die added at level 5 and
  // not at 4, the type choice landing in place of the weapon's own, and
  // nothing granted or left standing afterwards.
  'true-strike',
  // `unseen-servant.test.ts` (engine): the servant adapted from the sentence
  // the spell prints — AC 10, 1 Hit Point, Strength 2, Medium, Invisible under
  // the casting, forbidden the Attack action, held for the hour — and the
  // spell ending when a dagger drops it to 0, with the departure then owed.
  'unseen-servant',
  'vampiric-touch',
  'vicious-mockery',
  'vitriolic-sphere',
  'web',
  'wind-walk',
  // `barriers.test.ts` and `wall-template.test.ts`: the path pinned on the
  // record, a goblin's arrow deflected with the die on the record and a Fire
  // Bolt left to its roll, a Small flier barred the crossing and a Medium one
  // through, and a creature in gaseous form turned back.
  'wind-wall',
];

export interface SpellCoverage {
  readonly total: number;
  /** Definitions whose effects the engine resolves. */
  readonly executed: number;
  /** Definitions the engine casts but whose effect is the DM's. */
  readonly tracked: number;
  /** Executed definitions carrying a clause adjudicated to a missing shape. */
  readonly partial: number;
  readonly verified: number;
  readonly spells: readonly ParsedSpell[];
}

/**
 * A definition the engine resolves nothing of is tracked; one it resolves
 * something of is executed.
 *
 * "Something" is the spell's own effects **or its activation or its area
 * trigger or what it conjures**: Flame Blade evokes a blade and does nothing
 * else at the moment of casting, and every blow it ever strikes is machinery
 * the engine owns. Counting it as tracked would understate the engine in
 * exactly the direction this file exists to prevent.
 *
 * **The fourth arm is Goodberry's**, and it is the same argument: ten berries
 * appear in a hand, are held for a day, are eaten one at a time for a hit
 * point each and disappear when the spell ends — all of it the engine's, and
 * the spell's own effect list empty because the berries are what it does.
 *
 * **The fifth arm is the ground an area makes expensive**, and it is the
 * fourth's argument about a different noun: SRD Spike Growth's casting rolls
 * nothing and catches nobody, and the whole of what it does — "The area
 * becomes Difficult Terrain for the duration" — is a patch the engine lays on
 * the lattice, keeps alive against the casting and charges the ruler for at
 * every space a move crosses. Counting that as tracked would say the engine
 * resolves nothing of the spell while it is doing the only thing the spell
 * does.
 *
 * **The sixth and seventh arms are the light an area sheds and the fog it
 * fills**, and they are the fifth's argument about the two nouns P3-S added.
 * SRD Darkness rolls nothing and catches nobody, and the whole of what it
 * does — fifteen feet of magical darkness that Darkvision cannot see through
 * — is a patch the engine lays on the lattice, keeps alive against the
 * casting, and reads at every question about who can see whom. SRD Fog Cloud
 * is the same spell with obscurement in place of a level. Counting either as
 * tracked would say the engine resolves nothing of the spell while it is
 * doing the only thing the spell does.
 *
 * **The eighth arm is a cap the engine applies at the cast**, and it is the
 * fifth's argument about a spell with no noun at all. SRD Prestidigitation
 * rolls nothing, catches nobody and lays nothing on the lattice: every one of
 * its six wonders is fiction, and the single mechanical sentence it prints —
 * "you can have up to three of its non-instantaneous effects active at a
 * time" — is a rule the engine now obeys, ending the oldest casting when a
 * fourth is made. Counting that as tracked would say the engine resolves
 * nothing of the spell while it is doing the only thing about the spell that
 * is not narration. `replacesPriorCasting` is the same sentence with the
 * number one in it and is deliberately **not** here: every spell that prints
 * it — Mage Hand, Minor Illusion, Spiritual Weapon — is already executed by
 * one of the seven arms above, so an arm for it would be a claim about a
 * population that does not exist.
 *
 * **The ninth arm is a branch that resolves something**, and it is the first
 * arm about a list that is not `effects`. `SpellDefinition.options` is a
 * choice of which effects run — SRD Command's five words — so a definition
 * whose own list is empty may still knock a creature Prone, empty its hands
 * or forbid its next turn the moment a caster speaks the word. Reading
 * `effects` alone would call that spell tracked while it was doing three of
 * the five things it prints.
 *
 * **The tenth arm is what an area does to whoever is standing in it**, and it
 * is the sixth and seventh's argument about a value rather than a patch. SRD
 * Pass without Trace rolls nothing, catches nobody and lays nothing on the
 * lattice: its whole content is a +10 on the Stealth checks of whoever is in
 * a 30-foot Emanation, derived from the scene on every read. SRD Silence is
 * three such sentences about one Sphere, one of which refuses a casting
 * outright. Counting either as tracked would say the engine resolves nothing
 * of the spell while it is doing the only thing the spell does — which is
 * exactly what it did say until the vocabulary grew past a halved Speed, and
 * was harmless only because the one spell writing that sentence also printed
 * a trigger.
 *
 * **Exported because three other places had written it out**, and one of the
 * copies had already lost the `areaTrigger` arm. The honesty guard's whole
 * population is this predicate, so a drifting copy would silently stop
 * covering Web, Grease and Insect Plague with nothing going red.
 */
export const isExecuted = (definition: SpellDefinition): boolean =>
  definition.effects.length > 0 ||
  definition.activation !== undefined ||
  definition.areaTrigger !== undefined ||
  // What a DM's decision fires is resolved by the engine — SRD Glyph of Warding's rune.
  definition.triggered !== undefined ||
  definition.areaStanding !== undefined ||
  definition.areaTerrain !== undefined ||
  definition.areaLight !== undefined ||
  definition.areaObscurement !== undefined ||
  definition.conjures !== undefined ||
  definition.maxRunning !== undefined ||
  Object.values(definition.options ?? {}).some(
    // A branch's own standing clauses count for the reason the common list's
    // do: SRD Magic Circle's two directions are two lists of clauses the
    // Cylinder imposes, and nothing else the spell does.
    // A branch that lays ground executes as surely as one that rolls — SRD
    // Speak with Plants' two directions carry no effects and change the map.
    (branch) =>
      (branch.effects ?? []).length > 0 ||
      (branch.areaStanding ?? []).length > 0 ||
      branch.areaTerrain !== undefined,
  );

/** Every definition the engine resolves something of, by id. */
export const EXECUTED_SPELL_IDS: ReadonlySet<string> = new Set(
  SPELL_DEFINITIONS.filter(isExecuted).map((d) => d.id),
);

export const TRACKED_IDS: ReadonlySet<string> = new Set(
  SPELL_DEFINITIONS.filter((d) => !isExecuted(d)).map((d) => d.id),
);

export function auditSpells(): SpellCoverage {
  const spells = JSON.parse(
    readFileSync('packages/srd/src/generated/spells.json', 'utf8'),
  ) as ParsedSpell[];
  const defined = new Set(SPELL_DEFINITIONS.map((d) => d.id));

  return {
    total: spells.length,
    executed: defined.size - TRACKED_IDS.size,
    tracked: TRACKED_IDS.size,
    partial: PARTIAL_SPELLS.length,
    verified: VERIFIED_SPELLS.length,
    spells,
  };
}

/**
 * A feature the engine applies, rather than one it records and hands to a DM.
 *
 * **A feature declares its own automation**, which is why this column is read
 * rather than inferred the way a spell's is. It is one line, and it is
 * exported for the reason `isExecuted` above is: the class table, the origins
 * table and the guard that holds them honest must ask one question. A species
 * trait and a class feature are the same `FeatureDefinition` and the same
 * claim is being made about both, so a second spelling of this would be a
 * second answer to one question — the failure this file keeps a record of.
 */
export const isExecutedFeature = (feature: FeatureDefinition): boolean =>
  feature.automation === 'engine';

export interface ClassCoverage {
  readonly classes: number;
  readonly subclasses: number;
  readonly features: number;
  readonly executed: number;
  readonly rows: readonly {
    readonly name: string;
    readonly style: string;
    readonly features: number;
    readonly executed: number;
  }[];
}

export function auditClasses(): ClassCoverage {
  const rows = SRD_CONTENT.classes.map((definition) => {
    const own = [
      ...definition.features,
      ...SRD_CONTENT.subclasses
        .filter((s) => s.classId === definition.id)
        .flatMap((s) => s.features),
    ];
    return {
      name: definition.name,
      style: definition.spellcasting?.style ?? 'none',
      features: own.length,
      executed: own.filter(isExecutedFeature).length,
    };
  });

  return {
    classes: SRD_CONTENT.classes.length,
    subclasses: SRD_CONTENT.subclasses.length,
    features: rows.reduce((sum, r) => sum + r.features, 0),
    executed: rows.reduce((sum, r) => sum + r.executed, 0),
    rows,
  };
}

export interface OriginCoverage {
  readonly species: number;
  readonly backgrounds: number;
  readonly features: number;
  readonly executed: number;
  readonly rows: readonly {
    readonly name: string;
    readonly kind: 'species' | 'background';
    readonly features: number;
    readonly executed: number;
  }[];
}

/**
 * Species and backgrounds, measured exactly as classes are.
 *
 * **They were transcribed honestly and counted nowhere.** Every trait the
 * engine cannot execute is marked `manual` and carries a note saying what a DM
 * is left holding — the standard the class corpus set — and `auditClasses`
 * audits classes, so the whole of that work was invisible in the report. A
 * population that is not counted is a population a reader concludes does not
 * exist.
 *
 * **A separate audit rather than extra rows in the class table**, because the
 * class table's totals answer "how much of a class does the engine run". A
 * species is not a class, it has no casting style and no subclasses, and
 * folding its traits into that total would change what the existing numbers
 * mean without changing their names. Same predicate, different denominator,
 * so: same column, different table.
 *
 * Feats are **not** here. A `FeatDefinition` declares no automation — it
 * carries a note about what a DM applies and nothing the engine reads — so
 * there is no predicate to read one with, and a count of executed feats would
 * be somebody's opinion in a column that claims to be derived. The report says
 * so in prose instead.
 */
export function auditOrigins(): OriginCoverage {
  const row = (
    kind: 'species' | 'background',
    definition: { readonly name: string; readonly features: readonly FeatureDefinition[] },
  ) => ({
    name: definition.name,
    kind,
    features: definition.features.length,
    executed: definition.features.filter(isExecutedFeature).length,
  });

  const rows = [
    ...SRD_CONTENT.species.map((one) => row('species', one)),
    ...SRD_CONTENT.backgrounds.map((one) => row('background', one)),
  ];

  return {
    species: SRD_CONTENT.species.length,
    backgrounds: SRD_CONTENT.backgrounds.length,
    features: rows.reduce((sum, r) => sum + r.features, 0),
    executed: rows.reduce((sum, r) => sum + r.executed, 0),
    rows,
  };
}

/** The levels a character has, which is what the class tables are twenty of. */
export const MAX_LEVEL = 20;

/** One class, followed through one of its subclasses: what a character is. */
export interface LevelPath {
  readonly classId: string;
  /** `Cleric (Life Domain)`, or the class alone where it has no subclass. */
  readonly name: string;
  readonly levels: readonly PathLevel[];
}

export interface PathLevel {
  readonly level: number;
  /** Features this path has been granted by this level, class and subclass. */
  readonly features: number;
  /** Of those, the ones the engine applies rather than records. */
  readonly executed: number;
  /** The highest spell level the class table gives a slot of here. */
  readonly highestSpellLevel: number;
  /** Spells the book prints on this class's list that the path can reach. */
  readonly reachable: number;
  /** Of those, the ones the engine casts and hands the effect to the DM. */
  readonly tracked: number;
  /** Of those, the ones whose effects the engine resolves. */
  readonly executedSpells: number;
}

/** The same six counts, added across every path a character could be on. */
export interface LevelRow {
  readonly level: number;
  readonly features: number;
  readonly executed: number;
  readonly reachable: number;
  readonly tracked: number;
  readonly executedSpells: number;
}

export interface PlayableCoverage {
  readonly rows: readonly LevelRow[];
  readonly paths: readonly LevelPath[];
}

/** One row of a class table, which is where the reach rule reads from. */
type ClassTableRow = ClassDefinition['table'][number] | undefined;

/** What a class table row lets a character of that level cast. */
export interface SpellReach {
  /** The highest spell level the row has a slot of, or 0. */
  readonly highestSpellLevel: number;
  /** Whether the row gives cantrips at all. */
  readonly cantrips: boolean;
}

/**
 * The reach rule, in one place, because two readers ask it.
 *
 * `playableLevels` asks it per class per level to count a row; `LEDGER.md`
 * asks it over the twelve classes at the fifth to name the spells a level 5
 * party can reach. Those are one rule and were written out twice — once here
 * and once in the audit's throwaway script — which is the "second spelling of
 * one derivation" failure this file keeps a record of. A ledger that drifted
 * from the report about which spells a Cleric reaches would put a spell on
 * somebody's brief that nobody can cast.
 *
 * The highest slot is the **last column with a number in it** rather than the
 * width of the run: a Warlock's row reads `[0, 0, 2]` at the fifth level and
 * casts at the third. Nothing here says "half caster" — the rule about full
 * and half progressions lives in `spellcasting.progression` and in the twenty
 * rows the book prints.
 */
export const reachOf = (row: ClassTableRow): SpellReach => ({
  highestSpellLevel: (row?.spellSlots ?? []).reduce(
    (highest, count, index) => (count > 0 ? index + 1 : highest),
    0,
  ),
  cantrips: (row?.cantripsKnown ?? 0) > 0,
});

/** Whether a reach takes in one spell: a cantrip, or a slot of its level. */
export const withinReach = (spell: { readonly level: number }, reach: SpellReach): boolean =>
  spell.level === 0 ? reach.cantrips : spell.level <= reach.highestSpellLevel;

/**
 * Every spell **any** class can reach at a level, deduplicated, by id.
 *
 * The union the level-5 ledger is over. A spell is on a class's list when the
 * book's own index says so, which is the `classes` run `@ie/srd` parses off
 * the entry — the same filter `playableLevels` applies, through the same two
 * functions above, so the two cannot disagree about what a party can cast.
 *
 * Subclasses are not walked: a spell list belongs to the class, and a path is
 * a class through a subclass, so the union over paths and the union over
 * classes are the same set with one of them counted twelve times over.
 */
export function spellsInReach(
  classes: readonly ClassDefinition[],
  spells: readonly ParsedSpell[],
  level: number,
): readonly ParsedSpell[] {
  const found = new Map<string, ParsedSpell>();
  for (const definition of classes) {
    const reach = reachOf(definition.table[level - 1]);
    for (const spell of spells) {
      if (!spell.classes.includes(definition.id)) continue;
      if (!withinReach(spell, reach)) continue;
      found.set(spell.id, spell);
    }
  }
  return [...found.values()].sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
}

/** What the derivation needs, so that a test can hand it something else. */
export interface PlayableInput {
  readonly classes: readonly ClassDefinition[];
  readonly subclasses: readonly SubclassDefinition[];
  readonly spells: readonly ParsedSpell[];
  readonly executed: ReadonlySet<string>;
  readonly tracked: ReadonlySet<string>;
}

/**
 * What a character of level N holds, and how much of it the engine runs.
 *
 * **Every other number in this file counts a population over the whole book.**
 * That is the right answer to "how much of the SRD is built" and the wrong one
 * to "can a level 5 party play", which is the question that actually gets
 * asked — and which has been answered by hand, in prose, twice. A hand answer
 * in a document is the thing rule 8 exists to forbid, so it is derived here
 * and printed as rows.
 *
 * Three things this report already knows are respected rather than restated:
 *
 * - **Parsed is not implemented**, so a level's spells are three counts and
 *   never one. *Reachable* is what the book prints on the class's list that
 *   the level can cast at all; *tracked* and *executed* are the two claims the
 *   sections above keep apart, read from the same two sets they are read from
 *   there. A row that added them would be the report's oldest mistake, one
 *   level down.
 * - **A feature arrives at a level.** `FeatureDefinition.level` is what the
 *   class table prints, so "what does a level 5 Barbarian have" is a filter
 *   and not an opinion, and `isExecutedFeature` — the predicate the class and
 *   origin tables already use — is what says how much of it runs.
 * - **A character is a class *and* a subclass**, so the unit here is a path
 *   rather than a class: a level 5 Cleric has the Life Domain's third-level
 *   features and not some average of the domains. One path per subclass, and a
 *   class with no subclass is one path of its own, which is a rule about
 *   shapes rather than a count of the twelve the SRD happens to print.
 *
 * **What it cannot see is whether a session can reach any of it**, which is
 * where the truth currently is: the engine executes things no tool can ask
 * for — a Cleric could turn undead a week before anything could be told to.
 * That axis is `@ie/tools`' to answer, and `@ie/tools` depends on
 * `@ie/content`, so a script in this package importing it would be a
 * dependency cycle and an inversion of the direction the packages are built
 * in. The alternative — a hand map from a grant kind to a tool name — is
 * exactly the prose classifier this file records the deletion of. So the
 * report measures the two axes it can and says plainly, in the section it
 * prints, which third one it is missing and where the measurement would have
 * to live.
 *
 * Taking its inputs rather than reading the catalogue is what lets the guard
 * drive it in both directions, the way `inconsistencies` is driven: a
 * catalogue where nothing is executed must report nothing executed, whatever
 * the book has printed.
 */
export function playableLevels(input: PlayableInput): PlayableCoverage {
  const paths: LevelPath[] = [];

  for (const definition of input.classes) {
    const mine = input.subclasses.filter((one) => one.classId === definition.id);
    // A spell is on a class's list when the book's own index says so, which is
    // the `classes` run `@ie/srd` parses off the spell's entry.
    const list = input.spells.filter((one) => one.classes.includes(definition.id));

    for (const subclass of mine.length === 0 ? [null] : mine) {
      const features = [...definition.features, ...(subclass?.features ?? [])];
      const levels: PathLevel[] = [];

      for (let level = 1; level <= MAX_LEVEL; level += 1) {
        // The one reach rule, shared with the ledger rather than spelled a
        // second time here: a cantrip where the row gives cantrips, and a
        // spell whose level the row has a slot of.
        const reach = reachOf(definition.table[level - 1]);
        const reachable = list.filter((one) => withinReach(one, reach));
        const held = features.filter((one) => one.level <= level);

        levels.push({
          level,
          features: held.length,
          executed: held.filter(isExecutedFeature).length,
          highestSpellLevel: reach.highestSpellLevel,
          reachable: reachable.length,
          tracked: reachable.filter((one) => input.tracked.has(one.id)).length,
          executedSpells: reachable.filter((one) => input.executed.has(one.id)).length,
        });
      }

      paths.push({
        classId: definition.id,
        name: subclass === null ? definition.name : `${definition.name} (${subclass.name})`,
        // **No casting style here**, though it is one property access away.
        // The Classes table already prints it, and the only thing this
        // measurement would use it for — which paths get a row in the spells
        // table — is answered by whether the path reaches a spell at any
        // level. A second rule for one question is the second place to get it
        // wrong, and a field nothing reads is where that starts.
        levels,
      });
    }
  }

  const rows = Array.from({ length: MAX_LEVEL }, (_unused, index) => {
    const at = paths.map((path) => path.levels[index]!);
    const total = (read: (one: PathLevel) => number) => at.reduce((sum, one) => sum + read(one), 0);
    return {
      level: index + 1,
      features: total((one) => one.features),
      executed: total((one) => one.executed),
      reachable: total((one) => one.reachable),
      tracked: total((one) => one.tracked),
      executedSpells: total((one) => one.executedSpells),
    };
  });

  return { rows, paths };
}

/** The same question, of the catalogue and the book as they stand. */
export function auditPlayableLevels(): PlayableCoverage {
  return playableLevels({
    classes: SRD_CONTENT.classes,
    subclasses: SRD_CONTENT.subclasses,
    spells: JSON.parse(
      readFileSync('packages/srd/src/generated/spells.json', 'utf8'),
    ) as ParsedSpell[],
    executed: EXECUTED_SPELL_IDS,
    tracked: TRACKED_IDS,
  });
}

export interface MagicItemCoverage {
  /** Entries `@ie/srd` reads out of "Magic Items A–Z". */
  readonly parsed: number;
  /** Entries at least one catalogue record was read from. */
  readonly transcribed: number;
  /** Catalogue records those entries expand to. */
  readonly instances: number;
  /** Records carrying no `unmodelled` note. */
  readonly complete: number;
  /** Records carrying at least one, in the book's own words. */
  readonly partial: number;
  readonly rows: readonly {
    readonly category: string;
    readonly parsed: number;
    readonly transcribed: number;
    readonly instances: number;
    readonly complete: number;
    readonly partial: number;
  }[];
  readonly entries: readonly {
    readonly name: string;
    readonly category: string;
    readonly instances: number;
    readonly partial: number;
  }[];
}

/**
 * Magic items, in the two populations they actually have.
 *
 * **One entry is not one item.** The SRD writes _Weapon, +1, +2, or +3_ once,
 * as a template over the weapon table, and an inventory holds a +2 Longsword
 * rather than a template — so four entries become most of the catalogue's
 * magic items. `transcribed / parsed` and `instances` are therefore different
 * claims about different things, kept apart here for the same reason tracked
 * and executed are kept apart above: added together, or divided by each other,
 * they would report the Weapons chapter as covered several times over.
 *
 * **Complete and partial are per record, not per entry**, because
 * `unmodelled` is per record: a +1 Longsword finishes everything its entry
 * says and a Sun Blade does not, and those are two answers the entry count
 * cannot hold. The two together are the instances and nothing else.
 *
 * Whether a test drives an item end to end is **not** measured. That is the
 * spells table's `verified`, and it is a hand list precisely because no
 * derivation can say it — the claim belongs to the commit that writes the
 * test. There is no such list for items, so the report says nothing rather
 * than inventing a column.
 */
export function auditMagicItems(): MagicItemCoverage {
  const entries = magicItemEntries();
  const transcribed = new Map<
    string,
    { name: string; category: string; instances: number; partial: number }
  >();

  for (const item of SRD_MAGIC_ITEMS) {
    const entry = entryFor(item);
    const seen = transcribed.get(entry.id) ?? {
      name: entry.name,
      category: entry.category,
      instances: 0,
      partial: 0,
    };
    seen.instances += 1;
    if (!isCompleteItem(item)) seen.partial += 1;
    transcribed.set(entry.id, seen);
  }

  // Code-unit order, which is what `[...names].sort()` in the guard means.
  // `localeCompare` agrees with it for the names the book happens to print
  // today and disagrees about punctuation in general, and a list ordered one
  // way and checked another is a guard that passes by coincidence.
  const covered = [...transcribed.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const rows = MAGIC_ITEM_CATEGORIES.map((category) => {
    const mine = covered.filter((one) => one.category === category);
    const instances = mine.reduce((sum, one) => sum + one.instances, 0);
    const partial = mine.reduce((sum, one) => sum + one.partial, 0);
    return {
      category,
      parsed: entries.filter((entry) => entry.category === category).length,
      transcribed: mine.length,
      instances,
      complete: instances - partial,
      partial,
    };
  });

  const instances = SRD_MAGIC_ITEMS.length;
  const partial = SRD_MAGIC_ITEMS.filter((item) => !isCompleteItem(item)).length;

  return {
    parsed: entries.length,
    transcribed: covered.length,
    instances,
    complete: instances - partial,
    partial,
    rows,
    entries: covered,
  };
}

export interface BestiaryCoverage {
  /** Stat blocks `@ie/srd` read out of the book. */
  readonly parsed: number;
  /** Blocks `SRD_CONTENT` holds, validated, reachable by id. */
  readonly carried: number;
  /**
   * Of those, the ones the parser produced — the Monsters chapter, carried.
   *
   * `carried` over `parsed` is not a fraction and printing it as one said
   * `332/330`. The catalogue is two piles: the chapter the parser reads, and
   * the blocks the book prints inside a *spell's* entry. This is the first,
   * and it is the only one `parsed` is the whole of.
   */
  readonly fromParsed: number;
  /**
   * The other pile: blocks the catalogue holds that the parser never produced.
   *
   * The Otherworldly Steed and the Phantom Steed, printed in Find Steed's and
   * Phantom Steed's own entries rather than in the Monsters chapter, and
   * transcribed by hand in `packages/content/src/bestiary.ts` on the owner's
   * ruling of 2026-09-21. Counted by asking whether the parser produced the id
   * rather than by subtracting one length from another, so a block that
   * arrived from a third place is counted here and caught by the id test in
   * `coverage.test.ts` instead of vanishing into a difference.
   */
  readonly transcribed: number;
  /** Entries in the printed vulnerability, resistance and immunity runs. */
  readonly defences: number;
  /** Of those, entries recognised and left to the DM because they are qualified. */
  readonly qualified: number;
  /** Of those, entries in neither vocabulary, kept verbatim and enforced by nobody. */
  readonly unread: number;
  /** Traits, actions, bonus actions, reactions and legendary actions, in total. */
  readonly printed: number;
  /**
   * Of those, lines the parser turned into something the engine executes.
   *
   * The column this table did not have and could not have: a printed line used
   * to be a name and a sentence, so no fraction of it was claimed. Some lines
   * now carry an `attack` or a `trait` the engine reads, and the honest report
   * is the one that counts which rather than restating the whole pile as
   * unread.
   */
  readonly read: number;
  /**
   * Blocks that can make an attack of their own.
   *
   * Not a restatement of `read`: a block is counted here when `adaptMonster`
   * gives it at least one attack the engine can roll, which is the question a
   * DM asks — can this creature fight with what its own block prints, or does
   * somebody have to hand it a catalogue weapon first.
   */
  readonly acting: number;
  readonly rows: readonly {
    readonly kind: string;
    readonly printed: number;
    /** Of those, the ones carrying structure the engine reads. */
    readonly read: number;
  }[];
  /**
   * What the lines the engine does not read would need, ranked by how many
   * blocks each would free.
   *
   * **Every row is a mechanical predicate over a line, stated in the report**,
   * not somebody's reading of the English: a line *named* Multiattack, a name
   * carrying "(Recharge", an unread line whose text prints a saving throw, a
   * read line that came with a rider. That is the difference between this and
   * an opinion in a derived column's clothes — a reader can check every row
   * against the catalogue, and a shape that stopped matching shrinks here
   * rather than going quiet.
   *
   * **One row is checkable against the catalogue *and* against a list**, and
   * it is worth saying which: {@link UNEXECUTED_TRAIT_SHAPE} asks the line for
   * its trait kind and then asks {@link TRAIT_KINDS_WITH_A_READER} whether
   * anything spends it. The second half is written down rather than derived,
   * because there is nothing to derive it from, so the row goes stale in a way
   * no other row can — in both directions, and `coverage.test.ts` holds both.
   *
   * The piles **overlap**: one block prints a Multiattack and a breath weapon
   * and a bite whose hit buys a save, so the column does not sum to anything.
   */
  readonly shapes: readonly {
    readonly shape: string;
    /** Blocks printing at least one line of this shape. */
    readonly blocks: number;
    /** Lines of this shape, across every block. */
    readonly lines: number;
  }[];
}

/**
 * The bestiary, counted for what it is rather than for what a reader would
 * like it to be.
 *
 * **Every parsed block is carried, and that is the whole of what the two big
 * columns claim.** There is no *tracked* and no *executed* here, because a
 * stat block has nothing to declare them with: `traits`, `actions`,
 * `bonusActions`, `reactions` and `legendaryActions` are `{ name, text }` —
 * the book's sentence, kept verbatim. A spell says what it does in a
 * vocabulary the engine executes and a feature declares its own automation, so
 * both can be read by a predicate; a monster's Multiattack is English, and a
 * predicate over English would be somebody's opinion wearing a derived
 * column's clothes. So the report counts the prose instead. *Printed* is the
 * size of what a stat block says and nothing here divides by it.
 *
 * **The defence columns are the adapter's answer, not a second reading of the
 * same strings.** `adaptMonster` is what the engine actually runs a stat block
 * through, and it sorts a printed defence run into three piles: the entries it
 * enforces, the entries it recognises but cannot evaluate — "Piercing (from
 * weapons wielded by creatures under a *Bless* spell)" — and the entries in
 * neither vocabulary. The last two are the only places a block loses anything,
 * and they are counted here by asking the adapter rather than by re-deriving
 * its rule.
 */
/** One printed line of a stat block, as the catalogue carries it. */
export interface StatBlockLine {
  readonly name: string;
  readonly text: string;
  readonly attack?: unknown;
  readonly trait?: unknown;
  readonly save?: unknown;
  readonly multiattack?: unknown;
  /** The spells a Spellcasting line declares, where the parser read them. */
  readonly spellcasting?: unknown;
  /** The spells a line **casts**, which is the book's other opening about spells. */
  readonly casts?: unknown;
  /** Where a line teleports its creature. */
  readonly teleports?: unknown;
  /** The forms a line puts its creature into — SRD Shape-Shift. */
  readonly forms?: unknown;
  /** What a line drags toward its creature — SRD Roper's Reel. */
  readonly pulls?: unknown;
  /** Whom a line takes inside its creature — SRD Giant Frog's Swallow. */
  readonly swallows?: unknown;
  /** The plane a line steps to and back from — SRD Phase Spider's Ethereal Jaunt. */
  readonly shiftsPlane?: unknown;
  /** The flat addend a Reaction line puts on somebody's D20 Test. */
  readonly addsToRoll?: { readonly tests: readonly string[] } | undefined;
  /** What a Reaction line adds to its own Armour Class against one attack. */
  readonly addsToAc?: unknown;
  /** The printed line a Reaction's whole response performs, by its heading. */
  readonly usesLine?: string | undefined;
  /** What a legendary action line does — SRD Unicorn's Charging Horn and Shimmering Shield. */
  readonly legendary?: unknown;
}

/** Every line of every section of one block, which is what the shapes count over. */
export const statBlockLines = (
  monster: (typeof SRD_CONTENT.monsters)[number],
): readonly StatBlockLine[] => [
  ...monster.traits,
  ...monster.actions,
  ...monster.bonusActions,
  ...monster.reactions,
  ...monster.legendaryActions,
];

/**
 * A line the parser got structure out of: an attack's numbers, a trait's
 * mechanic, the DC and dice of a save a line forces, the spells a line casts,
 * where a line teleports, the addend a Reaction puts on a roll or on its own
 * Armour Class, the printed line a Reaction's response performs.
 */
export const isReadLine = (line: StatBlockLine): boolean =>
  line.attack !== undefined ||
  line.trait !== undefined ||
  line.save !== undefined ||
  line.multiattack !== undefined ||
  line.spellcasting !== undefined ||
  line.casts !== undefined ||
  line.teleports !== undefined ||
  line.forms !== undefined ||
  line.pulls !== undefined ||
  line.swallows !== undefined ||
  line.shiftsPlane !== undefined ||
  line.addsToRoll !== undefined ||
  line.addsToAc !== undefined ||
  line.usesLine !== undefined ||
  line.legendary !== undefined;

/**
 * A read attack line whose printed rider nothing applies.
 *
 * **Asked of the engine's own reader**, never of the string. `readPrintedRiders`
 * is what the swing itself calls, so a sentence it can turn into an effect list
 * is one the hit now executes and is not a debt — and a sentence it refuses is
 * still handed to the DM and still counted here. A predicate that only asked
 * whether a rider was printed would have gone on counting the Wolf's Prone
 * after the engine started applying it, which is the one failure a generated
 * report exists to make impossible.
 *
 * **It measures the reader and not the swing**, which is the one thing it
 * claims less than it looks like. A rider anchored on a turn boundary is
 * handed back to the DM on a swing taken outside combat, because there is no
 * turn order for its deadline to end at — and this counts it as applied
 * anyway. A stat-block line is measured against the fight it was printed for.
 */
export const hasUnappliedRider = (line: StatBlockLine): boolean => {
  const rider =
    line.attack === undefined ? null : (line.attack as { rider: string | null }).rider;
  // **Nothing at all was read**, which is what this row has always meant and
  // is the narrower of the two questions a sequence reader can be asked. A
  // line the engine reads three quarters of is counted by
  // {@link RIDER_HANDOVER_SHAPE} instead, and both rows are unpaid.
  return rider !== null && readPrintedRiders(rider).riders.length === 0;
};

/**
 * A read attack line whose rider says more than the engine applies.
 *
 * `SAVE_HANDOVER_SHAPE`'s twin on the other half of the sheet, and it arrived
 * with the reader that made it possible. `readPrintedRiders` goes clause by
 * clause and carries the rest back verbatim, so SRD Gibbering Mouther's Prone
 * is applied and the sentence about its victim being absorbed is not; the
 * swing reports that residue at the hit, exactly as `forcePrintedSave` reports
 * a save's.
 *
 * **A line with a residue is still unpaid**, and that is the whole reason the
 * row exists beside the other. Without it, learning to recognise three
 * quarters of a sentence would retire a debt on its own — the one failure a
 * generated report is here to make impossible — because the line would drop
 * out of {@link RIDER_SHAPE} and land nowhere.
 *
 * The two rows **overlap**, like every other pair in the table: SRD
 * Salamander's whole rider is one handed-over sentence, so nothing was read
 * *and* something was handed back, and both rows count it once.
 *
 * ### What is left on this row at CR ≤ 5, and the one seam each waits on
 *
 * Written out family by family for `HANDOVER_TRAIT_KINDS`' reason: a line with
 * no note beside it looks like a line nobody read. None of these is fiction —
 * each states a mechanic the engine would execute the day it had one seam — so
 * calling any of them a handover would retire a debt by renaming it.
 *
 * | Lines | The one seam each waits on |
 * |---|---|
 * | Bearded Devil's Infernal Glaive | a check a **neighbour** may attempt. `availableChecks` and `resolveEffectCheck` are self-only twins, and the wound's DC 12 Wisdom (Medicine) is rolled by the target *or a creature within 5 feet of it*. The start-of-turn 1d10 is `ScheduledDamage`, which the boundary already settles, and the minute is an ordinary deadline; what is missing is the reach on the check and the once-per-target gate ("doesn't already have an infernal wound") |
 * | Death Dog's Bite, Mummy's Rotting Fist, Otyugh's Bite, Incubus's Restless Touch | a clock that runs for days. Three mechanisms under one sentence each: a Hit Point maximum that does **not** come back at a Long Rest (a mark that withholds `hit-point-maximum-restored`), a deadline that re-arms every 24 hours, and a rest whose benefit is denied to the creature that finished it. `a-clock-that-runs-for-days` |
 * | Shadow's Draining Swipe | **the drain and the death are executed** — `ability-score-lowered` is the record the sheet's scores are derived through, either rest gives it back, and a score at 0 is a `creature-died`. What is left is "If a Humanoid is slain by this attack, a Shadow rises from the corpse 1d4 hours later": a stat block created from a corpse hours after the fight, which the doctrine puts at the table |
 * | Werebear, Wereboar, Wererat, Weretiger, Werewolf | `a-creature-somebody-else-is-playing`. "If the cursed target drops to 0 Hit Points, it instead becomes a **Werewolf** under the GM's control" is one stat block swapped for another *and* a player's character handed to the DM, and the second half is the one nothing here can do |
 * | Salamander's Flame Spear | fiction. "The spear magically returns to the salamander's hand" — nothing tracks where a thrown weapon went, and nothing would read the answer |
 * | Barbed Devil's Hurl Flame | a flammable object. The creature half of the glossary's Burning is executed on the two lines that print one; this line catches **only** "a flammable object that isn't being worn or carried", and a declared object is a substance and a size with nothing on it that takes light |
 * | Black Pudding's Dissolving Pseudopod, Gray Ooze's Pseudopod | a spell that repairs an item. The penalty and the destruction are executed; "The penalty can be removed by casting the _Mending_ spell on the armor" is the spells side's, and no casting reaches an item's record |
 */
export const RIDER_HANDOVER_SHAPE = 'A hit whose line says more than the engine applies';
export const hasHandedOverRider = (line: StatBlockLine): boolean => {
  const rider =
    line.attack === undefined ? null : (line.attack as { rider: string | null }).rider;
  return rider !== null && readPrintedRiders(rider).handedOver.length > 0;
};

/**
 * The trait kinds something in the engine actually spends.
 *
 * **A list rather than a derivation, because there is nothing to derive it
 * from.** `hasPrintedTrait` answers "does this block state that kind" and not
 * "does anybody ask" — the asking is a call site — so the honest form is a
 * name written down the day a reader lands, beside the name of what reads it.
 * It grows and the row below shrinks; a kind that is never on it is a kind
 * the ledger goes on naming as a debt.
 *
 * **It can go stale in both directions and the dangerous one is the second.**
 * A name the schema no longer admits is loud the moment anybody looks; a name
 * whose *reader* has been deleted is silent, and it would drop real debt off
 * the ledger with every test green. So `coverage.test.ts` asks both: that
 * every name here is a kind the schema still has, and that every name here is
 * still written somewhere in `packages/engine/src`. The second is the same
 * question `spell-schema.test.ts` asks of the engine's sources, pointed the
 * other way round.
 *
 * Today, and beside each the thing that spends it:
 *
 * | Kind | Reader |
 * |---|---|
 * | SRD Pack Tactics | `resolveAttack`'s roll-mode gathering |
 * | the two sunlight sentences | `adaptMonster`, as standing effects the `in-sunlight` requirement gates |
 * | SRD Bloodied Fury | the same, gated on `while-bloodied` |
 * | SRD Flyby | `provokedBy`, which reads the mover's mode |
 * | SRD Standing Leap | `checkJump`, through `printedLeap` |
 * | SRD Spider Climb | `climbCheck`, which is the handover its holder does not get |
 * | SRD Shadow Stealth, SRD Nimble Escape and its siblings | `adaptMonster`, as the `allows` action rules Cunning Action is written as |
 * | SRD Undead Fortitude | `resolveDamage`, which throws the save and pins the floor on `damage-taken` |
 * | SRD Magic Resistance | `adaptMonster`, as a `roll-mode` narrowed to saves a spell forced |
 * | SRD Illumination | `lightAt`, which derives a carried patch on every read |
 * | SRD Agile | `provokedBy`, the same reader SRD Flyby goes through |
 * | SRD Running Leap | `checkJump`, as a second bound on a running Long Jump |
 * | SRD Aura of Authority | `adaptMonster`, as a `roll-mode` on an aura reach |
 * | SRD Blood Frenzy | the same, narrowed by `RollSelector.targetMissingHitPoints` |
 * | SRD Siege Monster | `dealSpellDamage`, as SRD's first-applied multiplier |
 * | SRD Aberrant Ground | `terrainAt`, which derives a carried patch the way `lightAt` does |
 * | SRD Lightning Absorption | `dealSpellDamage`, which heals what the blow rolled before Immunity |
 * | SRD Aversion to Fire | the same, hanging a `roll-mode` on a turn-order deadline |
 * | SRD Freeze | the same again, with a Speed on the end of it |
 * | SRD Blurred Form | `adaptMonster`, as the first printed `against-holder` mode |
 * | SRD Beast of Burden | `capacitySizeOf`, which reads SRD Powerful Build's own grant |
 * | SRD Fire Aura | `resolveTurn`, at the end of the holder's turn, on the creatures the DM named |
 * | SRD Barbed Hide | the same, at the start, caught by the hold rather than by feet |
 * | SRD Swarm's healing sentence | `healCreature` and `grantTemporaryHpTo`, the two doors hit points come back through |
 *
 * **Every parsed kind is now on this list or on the handover one below it.**
 * `sheds-light` was the last exception, and the reason it was one was a shape
 * rather than an oversight: a `LightPatch` is *declared* and never derived, so
 * a creature that sheds Bright Light lit nothing until a patch could be
 * anchored to a creature and move with it. `carriedLight` is that patch.
 */
export const TRAIT_KINDS_WITH_A_READER: readonly string[] = [
  'absorbs-a-damage-type',
  'advantage-against-a-wounded-target',
  'advantage-when-ally-is-within-5-feet-of-the-target',
  'advantage-while-bloodied',
  'allies-in-emanation-have-advantage',
  'carries-as-a-larger-creature',
  'climbs-without-a-check',
  'damages-creatures-in-an-emanation',
  'damages-creatures-it-is-holding',
  'deals-double-damage-to-objects',
  'disadvantage-in-sunlight',
  'disadvantage-on-attacks-against-it',
  'does-not-provoke-when-flying-out-of-reach',
  'does-not-provoke-when-leaving-reach',
  'emanation-is-difficult-terrain',
  'hides-in-dim-light-or-darkness',
  'jumps-without-a-running-start',
  'long-jump-with-a-running-start',
  'magic-resistance',
  'penalised-after-taking-a-damage-type',
  'regains-no-hit-points',
  'sheds-light',
  'speed-cut-after-taking-a-damage-type',
  'takes-a-named-action-as-a-bonus-action',
  'undead-fortitude',
];

/**
 * The trait kinds the engine reads, hands to the table, and will never build.
 *
 * **A handover is not a debt, and the difference is the point.**
 * `docs/design/content.md` settles the test — "a table fact that a rule then
 * reads is a debt; a table fact nothing reads afterwards is a handover" — and
 * `docs/ROADMAP.md` §6 P3-B applies it to these three in as many words:
 * "Amphibious and breathing are handovers by the fiction rule unless drowning
 * is ever modelled."
 *
 * Nothing in this engine drowns, suffocates or holds a breath. There is no
 * rule that would read "can breathe water", no clock that counts the four
 * hours a Limited Amphibiousness gives, and no consequence for a creature
 * outside its element — so these sentences say something true about the world
 * and nothing a rule consults. Filing them as debt would put work on a list
 * nobody should do; filing them as unspent would keep twelve CR ≤ 5 blocks off
 * the clean list forever.
 *
 * **Not the same claim the reader roster makes, and pinned the opposite way.**
 * A kind on the roster must still be named in `packages/engine/src`; a kind
 * here must be named **nowhere** in it, because a handover with a reader is a
 * mislabelled debt. `coverage.test.ts` asks both.
 *
 * The reason is per kind rather than one sentence for the list, because the
 * day one of them stops being a handover it will be one of them and not all
 * three.
 *
 * **The breathing traits were the first three and are no longer alone.** The
 * test that admitted them admits every sentence below: each names planes,
 * minds, sounds, a narrated substance or a GM's choice, and not one of them
 * names a thing a rule consults.
 *
 * **And the world family joined them**, which is the same test pointed at the
 * ground instead of at the air. A gap an inch wide, solid rock, a web, a sheet
 * of ice, another creature's own space and a vampire's heart are all facts
 * about the *place* rather than about the creature, and this scene holds
 * creatures, landmarks, declared objects and declared regions and nothing that
 * anything is made of. They share one reason, written once at the head of
 * their group below and again per kind in the sentence's own terms, and the
 * day the lattice holds materials it is false — which is not left to be
 * noticed, because the inverted pin fails the moment one of them grows a
 * reader.
 *
 * **What is deliberately *not* here is the other half of the residue**, and it
 * is worth naming family by family, because a line with no note beside it
 * looks like a line nobody read. Each of these states a mechanic the engine
 * would execute the day it had one seam, so calling any of them fiction would
 * retire a debt by renaming it. They stay unread and stay on the ledger's
 * residue list:
 *
 * | Lines | The one seam each waits on |
 * |---|---|
 * | Ooze Cube | `a-second-place-to-put-a-creature`: the cube holds a Large creature or four Medium ones **inside itself**, they have Total Cover there, and a neighbour pulls one out on a check. The narrow-gap half of its paragraph is the movement family below; the rest is not, and reading the whole as fiction would lose four rules |
 * | Regeneration ×2 | a marker on a creature saying a trait does not function on its next turn — a grant with a turn-order deadline that a boundary reads |
 * | Corrosive Form | a hit that knows it was melee, which only the attack path can answer |
 * | Coven Magic ×3 | a cast line gated on two allies within thirty feet; the cast line is read and the gate is not |
 * | Berserk ×2 | a creature somebody else is playing: a d6 at the start of a turn and a compulsion that picks the golem's target for it. `a-creature-somebody-else-is-playing` |
 * | Abduct ×2 | the price of dragging a creature you have Grappled. "Needn't spend extra movement to move a creature it is grappling" is a rule about a cost the engine charges, so it is a debt rather than a fact about the world |
 * | Vampire Spawn's Sunlight | a start-of-turn read against a light level. The light model states sunlight; what is missing is the boundary reader, and its second sentence is already `disadvantage-in-sunlight` |
 * | Succubus Form, Incubus Form, Troll Spawn | one stat block replaced by another, at a Long Rest or on a 24-hour timer. `assumeStatBlock` is the mechanism and Wild Shape is its one caller; what is missing is the door a *creature's own printed line* comes through, and the Troll Limb's d12 besides |
 * | Soul Bag | an object a block is born holding. `declareObject` holds a thing with an Armour Class, Hit Points and a Resistance that can be broken; nothing gives one to a creature when its stat block arrives, and the hag's Nightmare Haunting is gated on carrying it |
 * | Spider Climb (the Swarm's) | a **gate** on a kind that already has a reader: "If the swarm has a Climb Speed, the swarm can climb…". `climbs-without-a-check` is spent by `climbCheck`, so this is a field on that kind rather than a third answer — and a gate read away would be a rule nobody printed |
 * | Split ×2 | a stat block created mid-fight — two creatures in the Initiative order that did not exist a moment ago, sharing the original's Hit Points. The catalogue names the same shape for the summoning spells |
 * | Redirect Attack | a Reaction window on **being attacked**, before the roll is decided, whose response retargets the attack at somebody else. Every window the engine holds opens on a hit, and nothing can re-aim an attack that has been declared |
 *
 * **Those last two are read as *kinds* and still unspent**, which is the one
 * thing that makes them look different from the rest of this paragraph: a
 * sentence with a kind is off the residue list below and onto
 * {@link UNEXECUTED_TRAIT_SHAPE}, where it is counted as the debt it is. The
 * table above is the reason each waits, whichever list the line is on.
 */
export const HANDOVER_TRAIT_KINDS: Readonly<Record<string, string>> = {
  'a-heading-over-the-lines-that-follow':
    'SRD Vampire Weakness: "The vampire has these weaknesses:". A heading the book prints over the three lines that follow it, each of which is counted on its own. It states no rule, so there is nothing to build and nothing to wait for.',
  'breathes-air-and-water':
    'SRD Amphibious. The engine models no drowning and no suffocation, so "can breathe air and water" — and the four hours a Limited Amphibiousness gives before it must submerge — say what the fiction is and name nothing a rule reads afterwards.',
  'breathes-only-water':
    'SRD Water Breathing, the same sentence the other way round. A creature that can breathe only underwater is a fact about where the DM may put it; nothing in the engine happens when it is put somewhere else.',
  'cannot-enter-a-home-uninvited':
    'SRD Forbiddance: "The vampire can\'t enter a residence without an invitation from an occupant." Whose home a place is, and who has spoken from inside it, are facts about the story rather than about anything the engine could be told: there is no rule that would read them and no move that would be refused, because a vampire under this sentence is simply not sent in. It tells a DM what their vampire will not do.',
  'cannot-shape-shift':
    'SRD Immutable Form: "The golem can\'t shape-shift." A creature shape-shifts here by holding a feature that says so, and the golem holds none; the sentence forbids a thing nothing was going to offer it, which is a promise to the table rather than a rule the engine enforces.',
  'controls-a-kind-of-creature':
    'SRD Shark Telepathy: "can magically control sharks within 120 feet of itself". The engine has nothing that makes one creature act at another\'s word — a compulsion is a creature somebody else is playing — and no notion of what kind of animal a stat block is beyond its own type. Who the sharks obey is the table\'s.',
  'goes-unnoticed-until-it-moves':
    'SRD Transparent: a DC 15 Wisdom (Perception) check to notice the cube at all. Whether anybody has looked, and what they were looking for, is the table\'s to say; the engine rolls the check when a DM asks for one and nothing in it waits on the answer.',
  'has-a-damage-type-the-gm-chooses':
    'SRD Draconic Origin: "a type of dragon associated with one of the following damage types (GM\'s choice)". The block states no type, so there is nothing to pin; the attack lines that read it already ask for the ruling and refuse to roll until somebody has answered.',
  'has-a-skill-the-gm-chooses':
    'SRD Training: "proficiency in one skill of the GM\'s choice and Advantage whenever it makes an ability check using that skill." Both halves are mechanics the engine holds, and the block names no skill for either to be about — so the sentence is a slot the DM fills rather than a rule the sheet can carry.',
  'holds-its-breath':
    'SRD Hold Breath. A span with nothing at the end of it: the clock could count the hour, but there is no rule waiting for it to run out, so the number is the table\'s to narrate.',
  'is-hurt-by-water':
    'SRD Water Susceptibility and SRD Running Water. A gallon thrown and a river waded are things a DM narrates rather than rules anything sets off, and the damage that follows a ruling already has a door built for it: the DM states the amount and the engine applies it. So the sentence is the number to use through a door that exists, which is what a handover is.',
  'makes-a-noise':
    'SRD Shrieker Fungus, Shriek: "The shrieker emits a shriek audible within 300 feet of itself for 1 minute or until the shrieker dies." Nothing in this engine hears anything — there is no sound in state, nothing that reads one, and no check or Reaction waiting on one — so what the sentence does is tell a DM that everything nearby now knows where the party is. It is the same family as SRD Mimicry, which is already here: a noise made, and nobody to hear it but the table.',
  'is-perceived-through-by-its-master':
    'SRD Vampiric Connection: a master who sees through the familiar\'s senses. Sight is asked of the creature rolling, and there is nothing that could borrow one creature\'s senses for another; what the vampire knows is narration.',
  'mimics-sounds':
    'SRD Mimicry, on the Green Hag and the Raven. What a sound is, who heard it and whether they believed it are all the table\'s; the Insight check is one a DM calls for and nothing afterwards reads the answer.',
  'pinpoints-a-substance':
    'SRD Iron Scent and SRD Treasure Sense: "can pinpoint the location of ferrous metal within 30 feet of itself." The scene holds creatures, landmarks and declared objects, and none of them has a substance the sense could find — so what is in the room is the DM\'s to say and the trait tells them the creature already knows.',
  'revives-on-another-plane':
    'SRD Diabolical Restoration and SRD Hellish Restoration: a body that comes back in the Nine Hells. There is one plane here and no map of any other, so a death that moves a creature somewhere the engine cannot address is a thing that happens to the story.',
  'sees-into-another-plane':
    'SRD Ethereal Sight: "can see 60 feet into the Ethereal Plane." There is nothing on the Ethereal Plane to see, because the engine holds one scene and no second place for anybody to stand in.',
  'senses-magic-nearby':
    'SRD Sense Magic: "works like the Detect Magic spell but isn\'t itself magical." What is magical in the room is a fact about the fiction the engine keeps no register of, and the spell it points at is itself a handover for the same reason.',
  'speaks-telepathically-with-its-master':
    'SRD Telepathic Bond. The engine holds no conversation, no language and no distance a thought has to cross; who can speak to whom is the whole of what this says and nothing reads it.',
  'speaks-with-a-kind-of-creature':
    'SRD Speak with Beasts and Plants: "can communicate with Beasts and Plants as if they shared a language." A language is a fact on the sheet that nothing consults, and what a Beast says back is the DM\'s.',
  'thoughts-cannot-be-read':
    'SRD Shielded Mind: "The couatl\'s thoughts can\'t be read by any means." Nothing here reads a thought, so the defence guards a door that was never there; it is a fact about the couatl for whoever is narrating.',

  // ------------------------------------------------------------------
  // **The world family**, and the movement half of it shares one reason.
  //
  // The scene holds creatures, landmarks, declared objects and declared
  // regions. It does not hold what anything is *made of*, how wide a gap
  // between two things is, or whether a creature's own space may be stood in
  // — so squeezing through an inch, gliding through rock, walking a web and
  // stepping inside another creature each name a fact nobody can state and no
  // rule would read afterwards. That is the same test the breathing traits
  // pass, pointed at the ground instead of at the air.
  //
  // **The day the lattice holds materials the shared reason is false**, and
  // the guards say so rather than leaving it to be noticed: the moment one of
  // these grows a reader in `packages/engine/src`, `coverage.test.ts` fails on
  // the inverted pin, and whoever built the reader moves the kind to the
  // roster in the same commit.
  // ------------------------------------------------------------------
  'moves-through-a-one-inch-gap':
    'SRD Amorphous and SRD Compression: "can move through a space as narrow as 1 inch without expending extra movement to do so." The lattice\'s smallest unit is a five-foot space and nothing in the scene has a width, so there is no gap for the ooze to be refused and none for it to be let through; what the sentence does is tell a DM that the grating is not an obstacle.',
  'enters-a-creature-space-and-a-one-inch-gap':
    'SRD Air Form and SRD Water Form: "can enter a creature\'s space and stop there", beside the inch above. A creature\'s own space is not a place anything can be put — `positioning.ts` holds one occupant per space and a shared space has no meaning for reach, cover or a Grapple — so the permission is one the engine has nothing to grant.',
  'burns-a-creature-whose-space-it-enters':
    'SRD Fire Form: the two clauses above with "The first time it enters a creature\'s space on a turn, that creature takes 5 (1d10) Fire damage" after them. The damage is real and its trigger is the standing-inside clause the lattice cannot hold, so the whole sentence goes to the table together — a DM who narrates the elemental walking through somebody states the damage through the door that already takes one.',
  'moves-through-creatures-and-objects':
    'SRD Incorporeal Movement: "can move through other creatures and objects as if they were Difficult Terrain. It takes 5 (1d10) Force damage if it ends its turn inside an object." Difficult Terrain is a declared region rather than a property of what is standing there, and *inside an object* is a position with no address, so neither the licence nor the damage has anything to read.',
  'burrows-through-earth-and-stone':
    'SRD Earth Glide: "can burrow through nonmagical, unworked earth and stone." Ground and walls are narration here — the scene knows where a creature is and not what is between two of them — so there is no material for the elemental to be told apart from, and no move that would have been refused.',
  'burrows-through-solid-rock':
    'SRD Tunneler: "can burrow through solid rock at half its Burrow Speed and leaves a 10-foot-diameter tunnel in its wake." The same absent material as Earth Glide, and the tunnel besides: a hole left in the world is a change to the map the DM is drawing, and the engine draws none.',
  'ignores-a-webs-restrictions':
    'SRD Web Walker: "ignores movement restrictions caused by webs, and the spider knows the location of any other creature in contact with the same web." A web **is** a thing in the scene now — the Giant Spider\'s own Web line raises one — and the sentence is a handover for a reason the object does not change: what a web does to a creature is the Restrained condition the save imposed, so this would have to be an exemption from a *condition* rather than from a movement cost, and a Restrained creature some rule quietly let walk is a condition read away. The second clause names knowledge about a place, which the vocabulary does not hold.',
  'walks-on-ice':
    'SRD Ice Walk: "can move across and climb icy surfaces without needing to make an ability check. Additionally, Difficult Terrain composed of ice or snow doesn\'t cost it extra movement." A patch of Difficult Terrain is declared and has no composition, and an icy surface is a description of a place rather than a fact about it, so the exemption names nothing the mover reads.',
  'cannot-wear-or-carry-anything':
    'SRD Ephemeral, on the will-o\'-wisp: "can\'t wear or carry anything." A stat block\'s inventory is whatever its printed Gear line gives it and nothing hands a monster anything else, so the sentence forbids something nobody was going to do — a promise to the table about what the wisp is, in the family of SRD Immutable Form.',
  'adheres-to-what-touches-it':
    'SRD Adhesive, on the mimic in object form: "adheres to anything that touches it", and then a Grappled condition at escape DC 13 with Disadvantage on the escape. The grapple, the DC and the Disadvantage are all rules the engine holds and a DM applies through doors that exist; what it has no notion of is one thing *touching* another, which is the clause the rest of the sentence hangs on. So the ruling is the table\'s and the mechanics are already built.',
  'confers-a-resistance-to-a-rider':
    'SRD Confer Fire Resistance, on the nightmare: "can grant Resistance to Fire damage to a rider while it is on the nightmare." Nothing here is ridden — there is no mount, no rider and no relation between two creatures that would end when one gets off — so the beneficiary of the Resistance is somebody only the fiction knows about.',
  'destroyed-by-a-stake-through-the-heart':
    'SRD Stake to the Heart, on the vampire spawn: "is destroyed if a weapon that deals Piercing damage is driven into the vampire\'s heart while the vampire has the Incapacitated condition." A heart is not a place, and driving a weapon into one is not an attack the engine could be asked for; it is the coup de grâce a DM adjudicates, and the death it ends in already has a door.',
  'paralyzed-by-a-stake-through-the-heart':
    'SRD Stake to the Heart, on the vampire, which is the other rule under that heading: the vampire "has the Paralyzed condition until the weapon is removed" rather than being destroyed. The condition is one the engine applies and the trigger is the same absent heart, so the sentence tells a DM which condition to state and the engine takes it through the door it already has.',
};

/** Whether this line's trait is one the engine reads and hands over. */
export const isHandoverTrait = (line: StatBlockLine): boolean =>
  line.trait !== undefined &&
  Object.hasOwn(HANDOVER_TRAIT_KINDS, (line.trait as { readonly kind: string }).kind);

/**
 * A trait line the parser read a mechanic out of that nothing spends.
 *
 * **The same claim {@link hasUnappliedRider} makes, about the other half of
 * the sheet.** A read line is not a paid debt: a rider parsed and unapplied
 * keeps its block out of *clean*, and a trait kind that reaches
 * `CharacterSheet.stated.traits` with no reader asking for it is in exactly
 * that position — a Spider Climb that costs no check still costs a check,
 * an Amphibious that says the creature breathes water is read by nobody.
 * Without this the parser could retire a whole column of the ledger by
 * learning to recognise sentences, which is the one thing a generated report
 * exists to make impossible.
 */
export const hasUnexecutedTrait = (line: StatBlockLine): boolean => {
  if (line.trait === undefined) return false;
  const { kind } = line.trait as { readonly kind: string };
  // A handed-over kind is neither spent nor waiting: it is read, given to the
  // table, and finished. See {@link HANDOVER_TRAIT_KINDS} for why that is a
  // third answer and not a softer version of this one.
  if (Object.hasOwn(HANDOVER_TRAIT_KINDS, kind)) return false;
  return !TRAIT_KINDS_WITH_A_READER.includes(kind);
};

/** What that row is called, so the ledger names it rather than matching a string. */
export const UNEXECUTED_TRAIT_SHAPE = 'A trait shape nothing spends';

/**
 * A read trait whose heading says more than the engine spends.
 *
 * {@link SAVE_HANDOVER_SHAPE} and {@link RIDER_HANDOVER_SHAPE} on the third
 * half of the sheet, and the same claim: `parseTraitShape` reads a heading's
 * regular sentence and carries the rest verbatim in `MonsterTrait.handedOver`,
 * `addCreature` hands the residue to the table the moment the block arrives,
 * and the heading is **read** and still **unpaid**.
 *
 * SRD Swarm is the sentence that made the field necessary and is the whole of
 * this row today: "can occupy another creature's space", "can move through any
 * opening large enough for a Tiny rat" and "can't regain Hit Points or gain
 * Temporary Hit Points" are one heading, of which the engine holds the last.
 * Counted apart from {@link UNEXECUTED_TRAIT_SHAPE} for that row's own reason —
 * learning to recognise two thirds of a heading must never be able to retire a
 * debt on its own.
 */
export const TRAIT_HANDOVER_SHAPE = 'A trait whose heading says more than the engine spends';
export const hasHandedOverTrait = (line: StatBlockLine): boolean =>
  ((line.trait as { handedOver?: readonly string[] } | undefined)?.handedOver?.length ?? 0) > 0;

/**
 * The shapes that run over a line the parser **read**.
 *
 * Named, because the ledger gates the others on a line nothing was read from
 * and needs to say which are the exceptions rather than match a string.
 */
export const RIDER_SHAPE = 'An effect a hit buys';

/**
 * A read save whose line says more than the engine spends.
 *
 * `parsePrintedSave` reads a failure's regular clauses and carries the rest of
 * the line verbatim in `handedOver`; `forcePrintedSave` applies what was read
 * and hands the rest to the table at the moment of use. The line is *read*,
 * so `isReadLine` says so — and it is not *paid*, because a Wight's zombie or
 * a Couatl's Restrained is still a sentence nothing executes. Counted apart
 * from the unread saves for the reason the unapplied riders are counted apart
 * from the unread attacks: learning to recognise a sentence can never retire
 * a debt on its own.
 */
export const SAVE_HANDOVER_SHAPE = 'A save whose line says more than the engine spends';
export const hasHandedOverSave = (line: StatBlockLine): boolean =>
  ((line.save as { handedOver?: readonly string[] } | undefined)?.handedOver?.length ?? 0) > 0;

/**
 * A line whose sentence a command **executes**, rather than one the parser
 * merely read.
 *
 * The two economy rows below count a notation the engine has always spent
 * correctly — `LEDGER.md` says so in as many words — so what is actually
 * waiting on such a line is what the line *does*. This is the list of shapes
 * that no longer are: `teleportTo` moves the Blink Dog through
 * `takePrintedTeleport`, and the Sphinx of Wonder's Burst of Ingenuity answers
 * the `test-rolled` window off its own sheet.
 *
 * **`casts` is in it now**, and the row it used to have its own entry for is
 * gone. What stood between reading a cast line and spending one was one fact
 * the casting pipeline could not be told — which slot the *heading* prices the
 * use at, since SRD Divine Aid is printed under Bonus Actions and offers
 * *Bless*, whose own casting time is an Action. `GrantedSpell.castingTime` is
 * that fact, read in `castingOf`; `adaptMonster` compiles the line into the
 * route it is, and `castPrintedLine` spends the heading's recharge or day's
 * use and hands the casting to the ordinary pipeline.
 */
export const isExecutedLine = (line: StatBlockLine): boolean =>
  line.teleports !== undefined ||
  // **A line that takes a form is spent** — `takePrintedForm` changes the
  // size, the Speeds and the word the block's own gated headings read, at the
  // heading's own price. What the sentence promises besides is honoured by
  // the engine doing nothing: "Its game statistics, other than its size, are
  // the same in each form", and the equipment untransformed.
  line.forms !== undefined ||
  // **A line that pulls is spent** — `takePrintedPull` drags every creature
  // the Roper is holding toward it, through the primitive a Merrow's rider
  // already goes through, at the heading's price.
  line.pulls !== undefined ||
  // **A line that swallows is spent** — `takePrintedSwallow` ends the grapple,
  // takes the target inside, hangs the conditions the line prints, and the
  // host's turn boundary rolls the damage; the exit is a return checked
  // against the corpse. The one clause about another line is handed over,
  // and the row below counts it.
  line.swallows !== undefined ||
  // **A line that steps onto another plane is spent** — `takePrintedPlaneShift`
  // takes the creature (and the Nightmare's companions) out of the scene and
  // brings them back to the spot they left, by the same line.
  line.shiftsPlane !== undefined ||
  // **SRD Parry, executed at the window SRD *Shield* already answered.** The
  // number goes onto the Armour Class the held attack was measured against and
  // the hit is re-decided, which is the whole of what the sentence says — so
  // unlike the line below it there is nothing left over, and unlike
  // `usesLine` beside it there is no second line to perform.
  line.addsToAc !== undefined ||
  // **A line that casts is spent** — `castPrintedLine` hands one of its spells
  // to the casting pipeline at the heading's price.
  line.casts !== undefined ||
  // **A legendary line is spent** — `takeLegendaryAction` spends a use out of
  // the block's pool at the moment the book names and performs the line: the
  // Horn's swing through the attack command, the Shield's points and bonus.
  line.legendary !== undefined ||
  // **The addend, narrowed the way the adapter narrows it.** `test-rolled` is
  // the instant a check or a save has landed and an attack roll is not one of
  // them, so `triggeringTests` in `monster.ts` compiles nothing for a trigger
  // that names one — and a row that counted such a line as executed would be
  // claiming a Reaction no sheet carries. No SRD line reaches it today, which
  // is exactly why the two readings have to be written down together rather
  // than left to agree by luck.
  (line.addsToRoll !== undefined && !line.addsToRoll.tests.includes('attack-roll'));

/**
 * **The row a cast line used to have is gone**, and this is where it was.
 *
 * "A line that casts, read and not spent" counted fourteen lines the parser
 * understood and nothing performed, and its own note said what stood between
 * the two: which slot the *heading* prices the use at. `GrantedSpell.castingTime`
 * is that fact, `adaptMonster` compiles the line into the route it is, and
 * `castPrintedLine` spends the heading's price and hands the casting to the
 * ordinary pipeline — so the debt is retired rather than shrunk, exactly as
 * the Multiattack and Spellcasting rows shrank when their sentences became
 * structure the engine runs. {@link isExecutedLine} counts `casts` now, which
 * is what takes those lines out of the two economy rows as well.
 *
 * Written down rather than deleted, because a row that leaves a report is a
 * claim somebody may want to check.
 */

/**
 * A Reaction whose **response** is another line of the same block.
 *
 * SRD Rust Monster, Reflexive Antennae: "_Trigger:_ An attack roll hits the
 * rust monster. _Response:_ The rust monster uses Antennae."
 *
 * {@link SAVE_HANDOVER_SHAPE}'s sibling and on the ledger's over-read list for
 * its reason: the line **is** read — the trigger is `hit-by-attack`, the
 * window the engine holds, and the name of the response is structure on the
 * sheet — and it is not **paid**, because the engine performs no printed line
 * as a Reaction's response. What it does instead is offer the Reaction and
 * hand the response to the table by name, which is a handover with a debt
 * behind it rather than a finished sentence. **The response is a line the
 * engine spends now**: the rust monster's Antennae is read — the object the
 * prelude names, the penalty, the two ceilings — and `force_printed_save`
 * rolls it with the weapon that hit named as the object. What is left is the
 * Reaction's own road performing it in place of handing the name over, which
 * is a seam in `commands/reactions.ts` and not in the line.
 *
 * It retires when a response is performed rather than named — the same way the
 * Multiattack and Spellcasting rows shrank when their sentences became
 * something the engine runs.
 */
export const REACTION_USE_SHAPE = 'A Reaction whose printed response is handed over';
export const hasHandedOverResponse = (line: StatBlockLine): boolean => line.usesLine !== undefined;

/**
 * The shapes a printed stat-block line waits on, over the whole bestiary and
 * over the CR ≤ 5 tail alike.
 *
 * **Exported so `LEDGER.md` asks the same question of a smaller population.**
 * The report answers "how much of the book is read"; the ledger answers "what
 * stands between a level 5 party and a fight that runs", which is these
 * predicates restricted to CR ≤ 5. The audit that first asked it wrote them
 * out a second time in a throwaway script, so a predicate tightened here
 * would have left the ledger measuring the old one.
 *
 * The piles overlap and do not sum: one line can force a save and recharge.
 */
export const MONSTER_LINE_SHAPES: readonly (readonly [
  string,
  (line: StatBlockLine) => boolean,
])[] = [
  // Still the predicate it was, with the half that is now read taken out of
  // it: a Multiattack whose sentence states a named sequence is structure
  // the engine spends, so what is left here is the sentences that say
  // something else — an alternative, a free choice from a menu, a use that
  // is not an attack. The row shrinks rather than going quiet, which is what
  // this table was built to do.
  [
    'How many attacks the Attack action holds',
    (line) => line.name === 'Multiattack' && line.multiattack === undefined,
  ],
  /**
   * A line that forces a save and that the reader got nothing structured out
   * of. Eleven at CR ≤ 5, and each is named here with the one seam it waits
   * on, for the reason `RIDER_HANDOVER_SHAPE`'s own table is written out: a
   * line with no note beside it looks like a line nobody read.
   *
   * | Lines | The kind, and the seam |
   * |---|---|
   * | Bulette's Deadly Leap, Centaur Trooper's Trampling Charge | a move **through** other creatures' spaces with a save per creature entered — the same seam Amorphous, Compression and Ooze Cube wait on, which is a creature's space entered and stopped in |
   * | Gelatinous Cube's Engulf, Shambling Mound's Engulf | a creature inside another one — a position the lattice has a word for now, `inside`, which the Giant Frog's and Giant Toad's Swallow are executed on. What these two wait on is the **save reader**: each is a saving throw whose failure puts the target inside, the cube's per space entered during a move and the mound's under a grapple, and the printed-save reader has no arm that hands its failure to the second place |
   * | Ghost's Possession, Harpy's Luring Song | `a-creature-somebody-else-is-playing`. A body somebody else drives and a compulsion that walks a creature toward a cliff are the same want, and the doctrine puts both at the table |
   *
   * The table is pinned to the catalogue by {@link UNREAD_SAVE_SEAMS}, so a
   * row that has been built comes out in the same commit.
   *
   * **Three rows left this table on one night**, and are written down rather
   * than deleted because a row that leaves a report is a claim somebody may
   * want to check. The Sprite's Heart Sight is read: a `reveals` clause whose
   * alignment the engine holds — pinned on the creature from the block or the
   * character's choices — and whose emotions are named as the table's, with
   * the types that fail automatically read off the targeting clause and no die
   * thrown for them. The Gold Dragon Wyrmling's Weakening Breath is read whole:
   * the reader grew the two arms the row said it lacked — a mode over the
   * `d20-test` family narrowed by an ability, and a penalty on the target's
   * own damage rolls — and a third lifetime for them, the repeat save the
   * failure prints where it imposes no condition to carry one. The Rust
   * Monster's Antennae is read too: the prelude that names an object, the
   * penalty, and the two ceilings the executor keeps; it sits on
   * {@link SAVE_HANDOVER_SHAPE} now rather than here, because the Mending
   * sentence is the spells side's and is still handed over.
   */
  ['A save a line forces', (line) => line.attack === undefined && /Saving Throw:_/.test(line.text)],
  // The rows above are held to the catalogue by {@link UNREAD_SAVE_SEAMS}.
  [SAVE_HANDOVER_SHAPE, hasHandedOverSave],
  [REACTION_USE_SHAPE, hasHandedOverResponse],
  [RIDER_SHAPE, hasUnappliedRider],
  [RIDER_HANDOVER_SHAPE, hasHandedOverRider],
  [UNEXECUTED_TRAIT_SHAPE, hasUnexecutedTrait],
  [TRAIT_HANDOVER_SHAPE, hasHandedOverTrait],
  // The two economy rows, each with the half that is now executed taken out of
  // it — exactly as the Multiattack and Spellcasting rows above were narrowed.
  // The economy on these lines was always right; what waited was the sentence,
  // and a line the engine now performs is no longer waiting on anything. See
  // {@link isExecutedLine}, which counts a cast line among them now.
  ['A recharge', (line) => /\(Recharge/.test(line.name) && !isExecutedLine(line)],
  [
    'A use the block limits per day',
    (line) => /\(\d+\/Day/.test(line.name) && !isExecutedLine(line),
  ],
  // The same predicate it was, with the half that is now read taken out of
  // it — exactly as the Multiattack row above was narrowed. A Spellcasting
  // line whose list the parser read is a spell list `addCreature` declares and
  // the casting pipeline spends: the ability, the printed numbers, and one
  // price per spell.
  //
  // **What is left is one line**: the Storm Giant's, whose spell names the book
  // italicised none of, so a bare word in that position is not something the
  // grammar can tell from prose. The Pit Fiend's Hellfire Spellcasting — one
  // spell cast twice, on a recharge — is refused by the parser too, but it was
  // never in this row either: the heading anchor above has always passed over
  // a line named `Hellfire Spellcasting (Recharge 4–6)`.
  [
    'A creature that casts',
    (line) => /^Spellcasting/.test(line.name) && line.spellcasting === undefined,
  ],
];

/**
 * The Action and Bonus Action lines at CR ≤ 5 that no enumerated shape names,
 * with the one seam each waits on.
 *
 * **The ledger lists them and cannot say why**, because a residue line is by
 * definition one no predicate reaches: `LEDGER.md`'s "Handed-over lines
 * matching no enumerated shape" is a list of headings with nothing beside
 * them, and a heading with nothing beside it looks like a heading nobody read.
 * `HANDOVER_TRAIT_KINDS` and `RIDER_HANDOVER_SHAPE` each solved that for their
 * own half by writing the reason out family by family; this is the same thing
 * for the third half, and `coverage.test.ts` holds it to the catalogue so an
 * entry that has been built, renamed or retired fails rather than rotting.
 *
 * **Read against the book, not against a summary.** Four of the entries below
 * correct a claim that had been made about them from a heading alone: the
 * Ettercap's Reel pulls by a **web** and not by a grapple, the Magmin's block
 * prints no `sheds-light` trait for its Bonus Action to toggle, the Wisp's
 * Vanish is Concentration on something that is not a spell, and the Succubus's
 * Charm is a **cast** line at a fixed level rather than a save.
 *
 * Keyed `<block id>/<heading>`, because two blocks print one heading over two
 * rules and the pair is what a reader needs.
 *
 * **Lines only.** A trait's residue is the table in {@link HANDOVER_TRAIT_KINDS}'
 * own note — Coven Magic, Regeneration, Berserk and
 * the rest — and keeping the two apart is what stops one sentence being
 * answered for twice in two places that could come to disagree.
 */
export const LINE_RESIDUE_SEAMS: Readonly<Record<string, string>> = {
  'ettercap/Reel':
    'a pull whose **gate** is a hold. The web is a thing the engine keeps a record of now — the Web Strand save raises an object and files the Restrained under `held-by:<it>` — and the Roper\'s Reel under the same heading is executed. What is left is the clause between the two: "one creature within 30 feet of itself **that is Restrained by its Web Strand**" is a printed pull narrowed to whoever this creature\'s own web is holding, and `takePrintedPull` drags whoever it is holding by a *grapple*. It lands the day a printed pull may say which hold it reads.',
  'magmin/Ignited Illumination':
    'a light a use turns on and off. `sheds-light` exists and `carriedLight` derives a patch that moves with its holder — but the magmin\'s block prints no such trait: the radii are printed on this Bonus Action and nowhere else, so what is missing is a *toggle*, a light patch a use hangs and a second use takes away, rather than a reader for a trait the block does not have.',
  'will-o-wisp/Vanish':
    'Concentration on something that is not a casting. "The wisp and its light have the Invisible condition until the wisp\'s Concentration ends on this effect, which ends early immediately after the wisp makes an attack roll or uses Consume Life." Every clause but the first is machinery the engine holds — the condition, the trigger that ends it, the light — and all of it hangs off `CreatureState.concentration`, which only a casting may occupy.',
  'succubus/Charm':
    'a cast line at a **fixed level**. "The succubus casts Dominate Person (level 8 version), requiring no spell components and using Charisma as the spellcasting ability (spell save DC 15)" is the book\'s cast template with one clause the reader has no field for, and `parseCastLine` refuses it whole rather than casting the spell at its own level. `a-duration-the-slot-changes` is the shape beside it; what this needs is a slot level a printed route states.',
  'wraith/Create Specter':
    'a-stat-block-created-mid-fight, at a door the summoning spells do not use. The raising itself is `summonCreature`, `Vitals.diedAt` answers the minute, and a cap of seven is a count a sheet can hold; what is missing is a *printed line* reaching the road a casting reaches, and a corpse being a thing the scene holds — the line targets "a Humanoid corpse within 10 feet", and a dead creature is a creature here rather than an object with a space.',
  'bulette/Leap':
    'a jump allowance with a lifetime. "Jumps up to 30 feet by spending 10 feet of movement" is SRD *Jump*\'s sentence word for word, and `GrantedJump` already carries both numbers — but a spell\'s allowance ends when its casting does, and a Bonus Action that buys one has no casting to end it. A grant a printed line hangs needs the deadline the mastery riders file, or the jump is free on every later turn. The Half-Dragon\'s and the Lamia\'s print the same sentence.',
  'troll/Charge':
    'nothing, and that is the answer. "The troll moves up to half its Speed straight toward an enemy it can see" is a move the DM makes with the move command, and the engine already refuses one that is too far or blocked; what the line adds over `move_creature` is a *restriction* on the DM rather than a rule the engine owes. The Xorn\'s and the Sahuagin\'s Aquatic Charge are the same sentence over a different Speed.',
  'seahorse/Bubble Dash':
    'a move that provokes nothing. "While underwater, the seahorse moves up to its Swim Speed without provoking Opportunity Attacks" — one field on a move, and `provokedBy` already reads the mover\'s mode for SRD Flyby and SRD Agile. What it waits on is a *declared* exemption on one move rather than a standing one on a creature, which is a field `MoveCommand` does not have. The Giant Seahorse prints it too.',
  'roper/Tentacle':
    'the same second place, reached the other way: the tendril the Reel pulls on is an object with its own Armour Class and Hit Points that a creature may attack, which is `declareObject` given to a creature as part of its body.',
  'dryad/Tree Stride':
    'a teleport between two trees the scene does not hold. The second place is built now — the Ghost\'s Etherealness, the Nightmare\'s Ethereal Stride and the Phase Spider\'s Ethereal Jaunt are executed on it — and this is its cousin with a tree in place of a plane: "within 5 feet of a Large or bigger tree … within 5 feet of a second Large or bigger tree that is within 60 feet" is a teleport whose two ends are objects, and the lattice holds no trees.',
  'sea-hag/Illusory Appearance':
    'fiction. "The hag covers herself and anything she is wearing or carrying with a magical illusion" — what somebody looks like is the table\'s, and the Investigation check to see through it is one a DM calls for.',
};

/**
 * The CR ≤ 5 lines that force a save and that the reader got nothing out of,
 * each with the one seam it waits on.
 *
 * {@link LINE_RESIDUE_SEAMS}' twin for the saves, and pinned the same way by
 * `coverage.test.ts`: every key names a line some CR ≤ 5 block really prints
 * with `Saving Throw:_` in it, and every one of them is really still unread —
 * so a line somebody builds fails the guard and the entry comes out in the
 * same commit. Written down because a line with no note beside it looks like
 * a line nobody read, and because the table in the docblock above was prose
 * and rotted twice on one night.
 *
 * **None of these is one field.** Each was checked against the code before it
 * was filed here: a move through other creatures' spaces is a position the
 * lattice has no word for, a creature inside another is the same, and a
 * compulsion is a creature somebody else is playing — the seam the doctrine
 * puts at the table.
 */
export const UNREAD_SAVE_SEAMS: Readonly<Record<string, string>> = {
  'bulette/Deadly Leap':
    'a move **through** other creatures\' spaces with a save per creature entered, and a movement spent before the save — "The bulette spends 5 feet of movement to jump to a space within 15 feet that contains one or more Large or smaller creatures." The lattice holds one occupant per space, so the space entered is a position nothing can be put in; the same seam Amorphous, Compression and Ooze Cube wait on.',
  'centaur-trooper/Trampling Charge (Recharge 5–6)':
    'the same move through Medium or smaller creatures\' spaces, with a save for each whose space was entered — "can move through the spaces of Medium or smaller creatures. Each creature whose space the centaur enters…". The movement half is the world\'s, and a save read without it would be a Trample a creature forces standing still.',
  'gelatinous-cube/Engulf':
    '`a-second-place-to-put-a-creature`: a creature inside another one, with its own escape, its own damage at the swallower\'s boundary and a way out when the cube dies. The Shambling Mound\'s Engulf, the Giant Frog\'s Swallow and the Giant Toad\'s are the same want.',
  'shambling-mound/Engulf':
    'the same second place — a creature inside the mound, Blinded and Restrained there, damaged at the mound\'s turn boundary and free when the mound dies. One seam for the four lines that print it.',
  'ghost/Possession (Recharge 6)':
    '`a-creature-somebody-else-is-playing`: "the ghost disappears, and the target is possessed by the ghost" — a body one creature drives and another owns, which the doctrine puts at the table rather than in a record the engine would have to invent a driver for.',
  'harpy/Luring Song':
    'a compulsion: "the target has the Charmed condition until the song ends … it must move on its turn toward the harpy by the most direct route". Which way a creature walks is a decision the engine takes as an input, and a rule that made it for a player is the same seam as Possession.',
};

/** Whether this line prints the save template and the reader got nothing out of it. */
export const isUnreadSave = (line: StatBlockLine): boolean =>
  line.attack === undefined && line.save === undefined && /Saving Throw:_/.test(line.text);

export function auditBestiary(): BestiaryCoverage {
  const parsed = JSON.parse(
    readFileSync('packages/srd/src/generated/monsters.json', 'utf8'),
  ) as readonly { readonly id: string }[];
  const parsedIds = new Set(parsed.map((monster) => monster.id));

  const kinds = [
    ['Traits', 'traits'],
    ['Actions', 'actions'],
    ['Bonus actions', 'bonusActions'],
    ['Reactions', 'reactions'],
    ['Legendary actions', 'legendaryActions'],
  ] as const;

  const rows = kinds.map(([kind, field]) => ({
    kind,
    printed: SRD_CONTENT.monsters.reduce((sum, monster) => sum + monster[field].length, 0),
    // A line is *read* when the parser got structure out of its sentence, and
    // {@link isReadLine} is the one place that says so — a second copy of the
    // rule here was a second answer to one question, and the two came to
    // disagree the day a save's DC and dice joined the fields a line can
    // carry. Counted off the catalogue's own lines rather than off a list of
    // names, so a shape that stopped matching shows up as a smaller number
    // rather than as nothing at all.
    read: SRD_CONTENT.monsters.reduce(
      (sum, monster) => sum + monster[field].filter(isReadLine).length,
      0,
    ),
  }));

  const shapes = MONSTER_LINE_SHAPES.map(([shape, matches]) => {
    let blocks = 0;
    let lines = 0;
    for (const monster of SRD_CONTENT.monsters) {
      const hits = statBlockLines(monster).filter(matches).length;
      if (hits > 0) blocks += 1;
      lines += hits;
    }
    return { shape, blocks, lines };
  });

  // **The legendary economy's row is gone**, and this is where it was. It
  // counted every legendary block as owing an action economy nothing spent;
  // `takeLegendaryAction` spends one now — a pool of uses regained at the
  // start of the holder's turn, spent immediately after another creature's
  // turn — so what a legendary *line* still owes is the line's own, and the
  // line predicates above count it exactly as they count any other line.
  shapes.sort((a, b) => b.blocks - a.blocks || a.shape.localeCompare(b.shape));

  let defences = 0;
  let qualified = 0;
  let unread = 0;
  let acting = 0;
  for (const monster of SRD_CONTENT.monsters) {
    defences += monster.vulnerabilities.length + monster.resistances.length + monster.immunities.length;
    // The id is inert: nothing below reads it, and the adapter is asked here
    // only for how it sorted the defence run — and now for whether the block
    // reached the game able to attack with what it prints.
    const adapted = adaptMonster(monster, asCharacterId(monster.id));
    qualified += adapted.defenses.qualified.length;
    unread += adapted.caveats.length;
    if ((adapted.sheet.stated?.attacks ?? []).length > 0) acting += 1;
  }

  return {
    parsed: parsed.length,
    carried: SRD_CONTENT.monsters.length,
    // Membership rather than arithmetic: the two piles are counted by asking
    // the parser whether it produced each id, so they cannot both be right
    // about a block that came from neither place.
    fromParsed: SRD_CONTENT.monsters.filter((monster) => parsedIds.has(monster.id)).length,
    transcribed: SRD_CONTENT.monsters.filter((monster) => !parsedIds.has(monster.id)).length,
    defences,
    qualified,
    unread,
    printed: rows.reduce((sum, row) => sum + row.printed, 0),
    read: rows.reduce((sum, row) => sum + row.read, 0),
    acting,
    rows,
    shapes,
  };
}

/**
 * What the report found that it cannot honestly print.
 *
 * **This existed as a line of prose and it should always have been a
 * failure.** The old renderer computed the verified spells the catalogue
 * cannot execute and, if it found any, wrote "**Inconsistent:** verified but
 * not executable: …" into `COVERAGE.md` — a report describing its own
 * brokenness and shipping anyway. It really fired, because `npm run coverage`
 * measured a stale `dist` against a `VERIFIED_SPELLS` read from source; the
 * two lists were a day apart and the contradiction was the symptom.
 *
 * Taking the arguments rather than reading the module's own data is what lets
 * the guard drive it in both directions. `coverageInconsistencies` is the real
 * question.
 */
export function inconsistencies(
  verified: readonly string[],
  executable: ReadonlySet<string>,
): readonly string[] {
  return verified
    .filter((id) => !executable.has(id))
    .map(
      (id) =>
        `${id} is listed as verified and the catalogue cannot execute it: either a test drives a spell that is not defined, or the definitions being measured are older than the list`,
    );
}

/** The same question, of the catalogue and the list the report would print. */
export function coverageInconsistencies(): readonly string[] {
  return inconsistencies(VERIFIED_SPELLS, new Set(SPELL_DEFINITIONS.map((d) => d.id)));
}
