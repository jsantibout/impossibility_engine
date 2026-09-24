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
  'black-tentacles',
  'bless',
  'blight',
  'blindness-deafness',
  'blur',
  'burning-hands',
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
  'eldritch-blast',
  'enhance-ability',
  // `filtered-catch.test.ts`: the 20-foot square, the caster left standing in
  // their own plants, the Strength save, the Athletics escape freeing one
  // creature and not the rest, the Concentration ending releasing everybody,
  // and the ground charging double until it does.
  'entangle',
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
  'healing-word',
  // `heat-metal.test.ts`: the breastplate's wearer burned, a failed save
  // dropping a held mace, the same failure leaving the armoured knight holding
  // his breastplate with Disadvantage instead, a made save leaving both alone,
  // and the Bonus Action dealing the damage again on a later turn.
  'heat-metal',
  'heroism',
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
  'magic-jar',
  // `auto-damage.test.ts`: three darts round the list, five out of a level 3
  // slot, the caster's own uneven split, a Sanctuary ward turning them away
  // and a Resistance halving each dart rather than the pool.
  'magic-missile',
  'mass-cure-wounds',
  'mind-blank',
  'mind-spike',
  'misty-step',
  'moonbeam',
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
  // Driven end to end by `cantrip-with-the-swing.test.ts` (engine): the cantrip
  // named on the attack command, the Action spent as the casting's and no
  // Attack action taken, `spell-cast` ahead of the roll, both rolls made with
  // the caster's spellcasting ability, the Radiant die added at level 5 and
  // not at 4, the type choice landing in place of the weapon's own, and
  // nothing granted or left standing afterwards.
  'true-strike',
  'vampiric-touch',
  'vicious-mockery',
  'vitriolic-sphere',
  'web',
  'wind-walk',
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
 * **Exported because three other places had written it out**, and one of the
 * copies had already lost the `areaTrigger` arm. The honesty guard's whole
 * population is this predicate, so a drifting copy would silently stop
 * covering Web, Grease and Insect Plague with nothing going red.
 */
export const isExecuted = (definition: SpellDefinition): boolean =>
  definition.effects.length > 0 ||
  definition.activation !== undefined ||
  definition.areaTrigger !== undefined ||
  definition.areaTerrain !== undefined ||
  definition.areaLight !== undefined ||
  definition.areaObscurement !== undefined ||
  definition.conjures !== undefined ||
  definition.maxRunning !== undefined ||
  Object.values(definition.options ?? {}).some(
    (branch) => (branch.effects ?? []).length > 0,
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
  /** The flat addend a Reaction line puts on somebody's D20 Test. */
  readonly addsToRoll?: { readonly tests: readonly string[] } | undefined;
  /** What a Reaction line adds to its own Armour Class against one attack. */
  readonly addsToAc?: unknown;
  /** The printed line a Reaction's whole response performs, by its heading. */
  readonly usesLine?: string | undefined;
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
  line.addsToRoll !== undefined ||
  line.addsToAc !== undefined ||
  line.usesLine !== undefined;

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
 * **What is deliberately *not* here is the other half of the residue**, and it
 * is worth naming family by family, because a line with no note beside it
 * looks like a line nobody read. Each of these states a mechanic the engine
 * would execute the day it had one seam, so calling any of them fiction would
 * retire a debt by renaming it. They stay unread and stay on the ledger's
 * residue list:
 *
 * | Lines | The one seam each waits on |
 * |---|---|
 * | Amorphous ×4, Compression, Air Form, Fire Form, Water Form, Ooze Cube | a space narrower than the lattice's five feet, and a creature's space entered and stopped in |
 * | Earth Glide ×2, Tunneler, Incorporeal Movement ×4, Ephemeral, Ice Walk | ground and walls as material rather than as declared regions |
 * | Web Walker ×4, Adhesive, Spider Climb (the Swarm's) | a restriction with a *source*, so a web's Restrained can be told from a rope's |
 * | Swarm ×7 | a healing rule a stat block states. `HealingRule` exists and `healingRuleOf` reads granted state; nothing writes one when a block arrives, so "can't regain Hit Points" has no door |
 * | Regeneration ×2 | a marker on a creature saying a trait does not function on its next turn — a grant with a turn-order deadline that a boundary reads |
 * | Corrosive Form | a hit that knows it was melee, which only the attack path can answer |
 * | Coven Magic ×3 | a cast line gated on two allies within thirty feet; the cast line is read and the gate is not |
 * | Berserk, Vampire Spawn's Stake to the Heart | a creature somebody else is playing: a d6 and a compulsion, a coup de grâce a DM adjudicates |
 * | Vampire Spawn's Sunlight | a start-of-turn read against a light level. The light model states sunlight; what is missing is the boundary reader, and its second sentence is already `disadvantage-in-sunlight` |
 * | Succubus Form, Incubus Form, Troll Spawn, Soul Bag | one stat block becoming another, at a rest or on a 24-hour timer |
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
 * **`casts` is deliberately not in it.** A cast line is *read* — `isReadLine`
 * says so — and no door spends one yet: the block's own heading may price the
 * casting at a Bonus Action where the spell prints an Action, and nothing in
 * the casting path can yet be told so. Reading a sentence never retires the
 * debt of executing it, which is the discipline this whole table keeps.
 */
export const isExecutedLine = (line: StatBlockLine): boolean =>
  line.teleports !== undefined ||
  // **SRD Parry, executed at the window SRD *Shield* already answered.** The
  // number goes onto the Armour Class the held attack was measured against and
  // the hit is re-decided, which is the whole of what the sentence says — so
  // unlike the line below it there is nothing left over, and unlike
  // `usesLine` beside it there is no second line to perform.
  line.addsToAc !== undefined ||
  // **The addend, narrowed the way the adapter narrows it.** `test-rolled` is
  // the instant a check or a save has landed and an attack roll is not one of
  // them, so `triggeringTests` in `monster.ts` compiles nothing for a trigger
  // that names one — and a row that counted such a line as executed would be
  // claiming a Reaction no sheet carries. No SRD line reaches it today, which
  // is exactly why the two readings have to be written down together rather
  // than left to agree by luck.
  (line.addsToRoll !== undefined && !line.addsToRoll.tests.includes('attack-roll'));

/**
 * A line that casts, read and with nothing yet spending it.
 *
 * `hasHandedOverSave`'s sibling and on the ledger's over-read list for exactly
 * its reason: the line **is** read — the ability, the printed DC and the menu
 * of spells are structure on the sheet — and it is not **paid**, because no
 * door hands one of those spells to the casting pipeline.
 *
 * What stands between the two is one fact the pipeline cannot yet be told:
 * which slot the *heading* prices the casting at. SRD Divine Aid is printed
 * under **Bonus Actions** and offers *Bless*, whose own casting time is an
 * Action, and `castingOf` derives that time from the definition alone. A door
 * built without it would spend an Action where the book prints a Bonus
 * Action, which is the engine getting a rule wrong on its own — worse than a
 * line read and not yet executed, and the reason this row exists rather than
 * that door.
 *
 * It retires the moment something spends one, exactly as the Multiattack and
 * Spellcasting rows shrank when their sentences became structure the engine
 * runs.
 */
export const CAST_LINE_SHAPE = 'A line that casts, read and not spent';
export const hasUnspentCastLine = (line: StatBlockLine): boolean => line.casts !== undefined;

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
 * behind it rather than a finished sentence: the rust monster's Antennae is a
 * save line nothing has read, and eating the weapon that hit it is a rule
 * somebody will build.
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
  ['A save a line forces', (line) => line.attack === undefined && /Saving Throw:_/.test(line.text)],
  [SAVE_HANDOVER_SHAPE, hasHandedOverSave],
  [CAST_LINE_SHAPE, hasUnspentCastLine],
  [REACTION_USE_SHAPE, hasHandedOverResponse],
  [RIDER_SHAPE, hasUnappliedRider],
  [RIDER_HANDOVER_SHAPE, hasHandedOverRider],
  [UNEXECUTED_TRAIT_SHAPE, hasUnexecutedTrait],
  // The two economy rows, each with the half that is now executed taken out of
  // it — exactly as the Multiattack and Spellcasting rows above were narrowed.
  // The economy on these lines was always right; what waited was the sentence,
  // and a line the engine now performs is no longer waiting on anything. See
  // {@link isExecutedLine}, which is also why a cast line stays in both.
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

/** The economy a legendary block owes, which is the block's rather than a line's. */
export const LEGENDARY_ECONOMY = 'A legendary action’s own economy';

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

  // The legendary economy is a property of the block rather than of any one
  // line, so it is counted as the block it belongs to.
  shapes.push({
    shape: LEGENDARY_ECONOMY,
    blocks: SRD_CONTENT.monsters.filter((monster) => monster.legendaryActions.length > 0).length,
    lines: SRD_CONTENT.monsters.reduce((sum, monster) => sum + monster.legendaryActions.length, 0),
  });
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
