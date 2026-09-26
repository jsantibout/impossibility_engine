/**
 * The saving throw a printed line forces, read as an effect list.
 *
 * `_Dexterity Saving Throw:_ DC 12, each creature in a 15-foot Cone.
 * _Failure:_ 17 (5d6) Fire damage. _Success:_ Half damage.` was the whole of
 * what this reader took for one batch: the ability, the DC, the dice and what
 * a success bought, with every other clause refused whole. Sixty-seven CR ≤ 5
 * lines on sixty blocks print a `_Failure:_` that says something else, and
 * most of them say it in one of six regular ways — a condition to a turn
 * anchor, damage *and* a condition, a push straight away and Prone, a grapple
 * with its escape DC, a Speed cut for a turn, a Hit Point maximum lowered by
 * the damage taken. Each of those is a primitive the casting path already has,
 * so this reads them into a small vocabulary ({@link MonsterSaveSchema}) and
 * `forcePrintedSave` executes it.
 *
 * **What is read is read whole, and what is not read is carried.** A failure
 * clause the grammar cannot start on refuses the whole line — a save the
 * engine rolls and then does nothing with is a die thrown for no reason, which
 * is the defect this repository calls its worst. A *trailing* sentence the
 * grammar does not know (a Ghost's "immune for 24 hours", a Wight's zombie
 * paragraph, a Couatl's "Restrained until the grapple ends") is kept verbatim
 * in `handedOver` and handed to the table at the moment of use, exactly as a
 * spell's `unmodelled` lines are: the engine applies what it read and says
 * what it did not, and the ledger keeps the block in its population until the
 * last sentence is spent.
 *
 * A sentence is read **transactionally**: one whose second half the grammar
 * does not know is carried whole, never half-applied. A movement printed
 * before the save ("The bulette spends 5 feet of movement") still refuses the
 * line for that reason, because half of it is a rule nobody printed.
 *
 * **Two families that were refused whole are now read, and each was refused
 * for want of somewhere to put an answer rather than for want of a grammar.**
 *
 * A **trigger** printed before the save — "The magmin explodes when it dies" —
 * was refused because a line read without it is a Death Burst a creature sets
 * off on purpose. The answer was never to drop the sentence; it was to have a
 * field for the moment. So `MonsterSave.trigger` says *when*, the fold raises
 * the save the moment settles, and the command that already rolls the saves a
 * boundary owes rolls this one. The same field holds the aura the book writes
 * into a targeting clause — "any creature that starts its turn in a 5-foot
 * Emanation originating from the ghast" — and a clause that says a turn is
 * beginning in words this cannot measure refuses the line, because an aura
 * without its moment would be an aura a caller *spends*.
 *
 * A **damage type the block leaves to another trait** — SRD Half-Dragon's
 * "damage of the type chosen for the Draconic Origin trait" — was refused
 * because a type nobody has stated is not a type. It still is not: the amount
 * is read and the type comes back as `declared`, which is a word and not a
 * damage type, and every engine reader that meets it asks the table before it
 * rolls anything.
 *
 * **Transactionally, with one seam, and it is declared rather than discovered.**
 * A clause may be read *and* carry words it did not model — `Scratch.carried`
 * — and exactly one shape uses it: "While Poisoned, the target also has the
 * Unconscious condition**, which ends early if…**", where the condition is a
 * primitive the engine has and the early ending is not. What separates that
 * from half-applying a sentence is that the residue goes into `handedOver`
 * under its own heading and the ledger goes on counting the line: the rule the
 * engine will not keep is said out loud at the moment of use, and recognising
 * part of a sentence does not retire its debt. Nothing is dropped anywhere in
 * this file, which is the property, rather than a sentence boundary, that the
 * transaction is about.
 *
 * **A graded failure is read, and refused whole where its second rung is a
 * rule this cannot hold.** `_First Failure:_` opens a line exactly as
 * `_Failure:_` does; `_Second Failure:_` is a sentence about the clause above
 * it, read onto the repeat the first rung scheduled — which is the engine's
 * `RepeatSave.onFailure` word for word. Where the second rung says anything
 * the vocabulary has no field for, the whole line stays prose, because a first
 * rung standing alone is a Restrained nothing ever lifts.
 *
 * **A rung is a heading and not a word**, which is the other half of that: the
 * two Brass Dragon families print their first rung under a plain `_Failure:_`
 * and then grade it, so what makes a section graded is that the line has a
 * second rung at all. Read any other way, "until the end of its next turn, at
 * which point it repeats the save" would be a save the boundary raised for
 * ever — the rule {@link REPEATS_NEXT_TURN} already keeps for the wording the
 * Gorgon prints.
 *
 * **And a deepening may carry a lifetime of its own.** SRD Brass Dragon
 * Wyrmling deepens into an Unconscious "for 1 minute" and SRD Silver Dragon
 * Wyrmling into a Paralyzed that repeats its own save until it succeeds or the
 * minute is up; `RepeatSave.onFailure` carries a span and a repeat now, so
 * both are read where before the deeper rung would have stood for ever and the
 * lines stayed prose. The Brass line's "This effect ends … if it takes damage
 * or a creature within 5 feet of it takes an action to wake it" is not a
 * vocabulary this side has, so it is carried under its own heading: the
 * condition ends *later* than the book says and the difference is handed to
 * the table. SRD Pseudodragon's `_Failure by 5 or More:_` is the same failure
 * with one more thing riding on the condition it already imposed, so its
 * Unconscious lifts with the Poisoned that carries it, at the printed hour;
 * what is missing there is only the *early* endings, and those are carried in
 * the same way. An effect that would never end is refused; one that ends later
 * than the book says is applied and the difference is handed over.
 *
 * **A sentence may name a lifetime that is another clause's**, and two of them
 * do. "While Poisoned, the target has the Paralyzed condition" is read onto
 * the clause it is about, because a condition carried by a cause is exactly
 * what `ConditionInstance.impliedBy` means. "While Deafened, the target also
 * has Disadvantage on ability checks and attack rolls" cannot be — a mode is
 * not something a condition implies — so it is a clause of its own that
 * *names* its host, and the executor sources the grant to that condition's
 * instance. Either way the host must be a condition **this failure imposed**:
 * one that is not there is a lifetime that is not there, and the sentence is
 * handed over whole.
 *
 * **A failure may also branch on the target's Hit Points**, which is the one
 * shape here whose two sentences are one rule: "If the target has 20 Hit
 * Points or fewer, it drops to 0 Hit Points. Otherwise, the target takes 13
 * (3d8) Psychic damage." Both halves are read together or neither is —
 * a ceiling with nothing under it decides nothing, and the `Otherwise` damage
 * standing alone is a line that deals it to the creature the book took to 0
 * instead. It is the second two-sentence rule in this file, after the curse,
 * and the reason the `then` arm is read against its own scratch. SRD Sea Hag
 * and SRD Incubus are read by it; SRD Solar's Slaying Bow prints the same
 * shape over "it dies" and stays prose, because a kill's ceiling is the last
 * thing to read on a widened word.
 */

import { DECLARED_DAMAGE_TYPE } from '../schemas.js';
import type {
  MonsterDamage,
  MonsterSave,
  PrintedAuraCondition,
  PrintedSaveClause,
  PrintedSaveEffect,
  PrintedSaveTrigger,
  PrintedSeconds,
  PrintedSpan,
} from '../schemas.js';

type ConditionEffect = Extract<PrintedSaveEffect, { kind: 'condition' }>;
type RollModeEffect = Extract<PrintedSaveEffect, { kind: 'roll-mode' }>;
/**
 * The clauses that carry a lifetime of **some** kind, and must carry one.
 *
 * A span the line printed, the condition instance the same failure created,
 * or — for the two clauses a save may hang on the target's own rolls — a save
 * the target repeats to end it. Every other clause here answers the question
 * in its own shape: a `condition` with no span is a condition for the
 * encounter, a push and a death are over the moment they happen. These four
 * are the ones the book prints more than one way — the Dretch's rule on a
 * condition, the Copper Dragon's under a span, the Gold Dragon Wyrmling's mode
 * and penalty under a repeat save — and a clause that ended up with none would
 * be a rule nothing could ever lift, which the reader refuses whole.
 */
type LastingEffect = Extract<
  PrintedSaveEffect,
  { kind: 'action-rule' | 'speed-halved' | 'roll-mode' | 'damage-penalty' }
>;
const isLasting = (effect: PrintedSaveEffect): effect is LastingEffect =>
  effect.kind === 'action-rule' ||
  effect.kind === 'speed-halved' ||
  effect.kind === 'roll-mode' ||
  effect.kind === 'damage-penalty';
/** Whether a clause that must name a lifetime has named one. */
const lifetimed = (effect: LastingEffect): boolean =>
  effect.lasts !== undefined ||
  effect.whileCondition !== undefined ||
  ('repeats' in effect && effect.repeats !== undefined);
/**
 * The two clauses a repeat save may end where the failure imposed no
 * condition to carry it — see {@link amendRepeatable}.
 */
type RepeatableEffect = Extract<PrintedSaveEffect, { kind: 'roll-mode' | 'damage-penalty' }>;
const isRepeatable = (effect: PrintedSaveEffect): effect is RepeatableEffect =>
  effect.kind === 'roll-mode' || effect.kind === 'damage-penalty';

/** The engine's damage types, so a word in the damage slot that is not one refuses the line. */
const DAMAGE_TYPES: ReadonlySet<string> = new Set([
  'acid',
  'bludgeoning',
  'cold',
  'fire',
  'force',
  'lightning',
  'necrotic',
  'piercing',
  'poison',
  'psychic',
  'radiant',
  'slashing',
  'thunder',
]);

/** The book writes the ability out; the engine keys it in three letters. */
const ABILITY_KEYS: Readonly<Record<string, MonsterSave['ability']>> = {
  Strength: 'str',
  Dexterity: 'dex',
  Constitution: 'con',
  Intelligence: 'int',
  Wisdom: 'wis',
  Charisma: 'cha',
};

/** The conditions a line may impose, by the capitalised word the book prints. */
const CONDITIONS: Readonly<Record<string, ConditionEffect['condition']>> = {
  Blinded: 'blinded',
  Charmed: 'charmed',
  Deafened: 'deafened',
  Frightened: 'frightened',
  Grappled: 'grappled',
  Incapacitated: 'incapacitated',
  Invisible: 'invisible',
  Paralyzed: 'paralyzed',
  Petrified: 'petrified',
  Poisoned: 'poisoned',
  Prone: 'prone',
  Restrained: 'restrained',
  Stunned: 'stunned',
  Unconscious: 'unconscious',
};

/**
 * The rolls a mode clause may name, by the book's own nouns.
 *
 * The glossary's three, which is what `disadvantage-in-sunlight` reads out of
 * the same words one section up — "D20 Tests encompass the three main d20
 * rolls of the game: ability checks, attack rolls, and saving throws."
 */
const ROLLS: Readonly<Record<string, RollModeEffect['rolls'][number]>> = {
  'ability checks': 'ability-check',
  'attack rolls': 'attack-roll',
  'saving throws': 'saving-throw',
};

/** The alternation {@link WHILE_CONDITION_MODE} matches one roll noun with. */
const ROLL_WORDS = `(?:${Object.keys(ROLLS).join('|')})`;

/** The book's six ability words, captured, as {@link HAS_MODE_ON_FAMILY} reads one. */
const ABILITY_WORD = `(${Object.keys(ABILITY_KEYS).join('|')})`;

const SIZES: Readonly<Record<string, NonNullable<ConditionEffect['ifNoLargerThan']>>> = {
  Tiny: 'tiny',
  Small: 'small',
  Medium: 'medium',
  Large: 'large',
  Huge: 'huge',
  Gargantuan: 'gargantuan',
};

/**
 * The opening every line this reads begins with: the ability, the DC and who
 * it catches — and, where the book prints one, a sentence in between.
 *
 * `_First Failure:_` opens a graded line exactly as `_Failure:_` opens a plain
 * one, so both are the head of the tail. What sits *before* either is the
 * targeting clause and, for the Basilisk and the Medusa, one more sentence of
 * their own: "If the basilisk sees its reflection in the Cone, the basilisk
 * must make this save."
 * The capture is lazy and therefore swallows it, which is why {@link headOf}
 * splits the two apart rather than filing a rule about the source under who
 * the line catches. No SRD targeting clause contains a full stop, which is
 * what makes that split safe and is asserted over the corpus.
 *
 * **And what sits before the opening is the first capture**, which is the
 * change that let eight lines be read at all. It was anchored at `^_`, so any
 * sentence in front of the template refused the line whole — which was right
 * while the reader had nowhere to put a trigger, and is now {@link readPrelude}'s
 * question rather than the anchor's. The capture is lazy, so it takes the
 * shortest run up to the first `_<Ability> Saving Throw:_` in the line, and it
 * is empty for every line the reader took before this.
 */
const OPENING =
  /^(.*?)_([A-Za-z]+) Saving Throw:_ DC (\d+), (.+?)\. (_(?:First )?Failure:_ .*)$/;

/**
 * SRD Magmin: "The magmin explodes when it dies."
 *
 * The five Death Bursts at CR ≤ 5 print this sentence with their own noun in
 * it, and it is the whole of the sentence: a trigger the reader could only
 * half-read would be a Death Burst a creature sets off on purpose.
 */
const EXPLODES_ON_DEATH = /^The [a-z' -]+ explodes when it dies\.$/;

/**
 * SRD Gibbering Mouther: "The mouther babbles incoherently while it doesn't
 * have the Incapacitated condition."
 *
 * Not a trigger of its own — it is the **definition** the targeting clause
 * below leans on when it says "while it is babbling", which is why the two are
 * read together or neither is. Nothing else in the corpus prints it.
 */
const BABBLES_WHILE_NOT_INCAPACITATED =
  /^The [a-z' -]+ babbles incoherently while it doesn't have the Incapacitated condition\.$/;

/**
 * SRD Rust Monster's Antennae: "The rust monster targets one nonmagical metal
 * object—armor or a weapon—worn or carried by a creature within 5 feet of
 * itself."
 *
 * The third prelude, and the first that is a **targeting** sentence: what the
 * save is aimed at is a thing somebody is wearing or holding, and the template
 * after it names the holder. The reach is the table's, as every reach is; what
 * the sentence adds is that the line wants an object named, which is the fact
 * `MonsterSave.targetsObject` carries to the door.
 */
const TARGETS_AN_OBJECT =
  /^The [a-z' -]+ targets one nonmagical metal object—armor or a weapon—worn or carried by a creature within \d+ feet of itself\.$/;

/**
 * SRD Rust Monster's Antennae: "The object takes a −1 penalty to the AC it
 * offers (armor) or to its attack rolls (weapon)."
 *
 * Both the hyphen-minus and the book's own minus sign, because a transcription
 * may carry either and they are the same number.
 */
const OBJECT_PENALTY =
  /^The object takes a [-−](\d+) penalty to the AC it offers \(armor\) or to its attack rolls \(weapon\)$/;

/**
 * SRD's second sentence: "Armor is destroyed if the penalty reduces its AC to
 * 10, and a weapon is destroyed if its penalty reaches −5."
 *
 * **Read and consumed rather than stored**, exactly as the pudding's "The
 * armor is destroyed if the penalty reduces its AC to 10" is on the hit side:
 * it states the two ceilings the executor already applies to every object
 * penalty, so fields for them would be a second copy of two numbers free to
 * disagree. A line printing other ceilings would not match and the sentence
 * would be carried, while its penalty went on being destroyed at the engine's
 * — which is the wrong rule the pudding's reader records too, and the day a
 * second pair is printed the numbers join the clause.
 */
const OBJECT_DESTROYED_RULE =
  /^Armor is destroyed if the penalty reduces its AC to 10, and a weapon is destroyed if its penalty reaches [-−]5$/;

/** SRD Sea Hag: "… and can see the hag's true form", the tail of a targeting clause. */
const AURA_SIGHT = /^(.*) and can see the [a-z' -]+'s true form$/;

/** SRD Gibbering Mouther: "… while it is babbling", the same slot. */
const AURA_BABBLING = /^(.*) while it is babbling$/;

/** SRD Ghast: "any creature that starts its turn in a 5-foot Emanation originating from the ghast". */
const AURA_EMANATION =
  /^any (.+?) that starts its turn in a (\d+)-foot Emanation originating from the [a-z' -]+$/;

/** SRD Gibbering Mouther and SRD Sea Hag: the same moment measured with a ruler. */
const AURA_RADIUS = /^any (.+?) that starts its turn within (\d+) feet of the [a-z' -]+$/;

/**
 * The words that say a clause is about a turn **beginning**, whatever else it
 * says.
 *
 * The guard rather than the reader: a targeting clause with these words in it
 * that {@link readAuraTrigger} could not read is a moment this cannot raise,
 * and a line kept without its moment would be an aura a caller *spends* — SRD
 * Pit Fiend's Fear Aura, whose radius is in a sentence of its own, read as a
 * Wisdom save the pit fiend takes an Action to force.
 */
const STARTS_ITS_TURN = /starts its turn/;

/**
 * The section markers the book prints after the opening.
 *
 * Longest first, because `Failure` is a prefix of neither `Failure or Success`
 * nor `Failure by 5 or More` as a *word* but is as an alternation: a leading
 * `Failure` alternative would match and then fail on `:_`, and the engine
 * would go on to the next alternative — so the order is a tidiness that makes
 * the intent readable rather than a correctness rule. `Third Failure` is in
 * the list because refusing it by omission would read a three-rung line as a
 * two-rung one; the SRD prints none at this tier and one would refuse the
 * line at {@link deepenBy}.
 */
const SECTION =
  /_(Failure or Success|Failure by \d+ or More|First Failure|Second Failure|Third Failure|Failure|Success):_\s*/g;

/** "Failure by 5 or More": the margin at or beyond which the deeper list bites. */
const BY_MARGIN = /^Failure by (\d+) or More$/;

/**
 * SRD Gorgon, SRD Basilisk and SRD Medusa: "The target has the Petrified
 * condition instead of the Restrained condition."
 *
 * The one spelling of a second rung that names **which** condition it
 * replaces, and therefore the one this reads on its own rather than through
 * {@link readSection}: "instead of the Restrained condition" is a phrase no
 * clause in the grammar below can start on, and naming the shallow condition
 * is the only thing it adds. Every other rung the book prints is an ordinary
 * sentence about a condition — see {@link deepenBy}, which reads those the way
 * a failure clause is read anywhere else.
 *
 * **Two punctuations and a span**, because SRD Cockatrice prints the same
 * sentence with the phrase set off by commas and a lifetime on the end of it:
 * "The target has the Petrified condition, instead of the Restrained
 * condition, for 24 hours." The span is the deepened condition's own —
 * `RepeatSave.onFailure.lasts` — and it is the one field that heading may add,
 * so it is read here rather than left to a clause that would have had nothing
 * to attach to.
 */
const SECOND_FAILURE =
  /^The target has the ([A-Z][a-z]+) condition,? instead of the ([A-Z][a-z]+) condition(?:,? (for \d+ (?:hour|minute)s?))?$/;

/**
 * The type slot of a printed amount, which the book writes two ways.
 *
 * `Fire damage` is the ordinary one and is captured. `damage of the type
 * chosen for the Draconic Origin trait` is SRD Half-Dragon's, and it captures
 * **nothing** — there is no word there to capture, which is the whole of what
 * the sentence says. {@link damageOf} reads an absent capture as
 * {@link DECLARED_DAMAGE_TYPE}, so the alternation still contributes exactly
 * one group and the offsets either side of it are the ones they always were.
 */
const TYPE_SLOT = `(?:([A-Za-z]+) damage|damage of the type chosen for the [A-Za-z][A-Za-z' -]* trait)`;

/** `17 (5d6) Fire damage`, `16 (2d10 + 5) Bludgeoning damage`, with an optional second component after `plus`. */
const DAMAGE = new RegExp(
  `^(\\d+) \\((\\d+)d(\\d+)(?:\\s*([+−–-])\\s*(\\d+))?\\) ${TYPE_SLOT}` +
    `(?: plus (\\d+) \\((\\d+)d(\\d+)(?:\\s*([+−–-])\\s*(\\d+))?\\) ${TYPE_SLOT})?`,
);

/** "until the start of its next turn", "until the end of the mephit's next turn". */
const UNTIL_TURN = /^until the (start|end) of (its|the [a-z'-]+(?: [a-z'-]+)*'s) next turn$/;
/** "for 1 hour", "for 10 minutes". */
const FOR_SPAN = /^for (\d+) (hour|minute)s?$/;
const SPAN_SECONDS: Readonly<Record<string, number>> = { hour: 3600, minute: 60 };

/**
 * Both apostrophes, because a transcription may carry either.
 *
 * The vendored SRD text uses the straight one throughout, and a reader that
 * insisted on it would stop reading the day somebody pasted a line through a
 * word processor. `monster.ts` in the engine keeps the same constant for the
 * same reason; neither package may import the other's.
 */
const APOSTROPHE = "['’]";

const SUBJECT = '(?:(?:[Tt]he target|[Ii]t) )?';
const HAS_CONDITION = new RegExp(
  `^${SUBJECT}has the ([A-Z][a-z]+) condition(?: \\(escape DC (\\d+)\\))?(?: (until [^,]+?|for \\d+ (?:hour|minute)s?))?(?:,? and (.+))?$`,
);
/**
 * SRD Couatl and SRD Salamander: "…, and it has the Restrained condition until
 * the grapple ends."
 *
 * Tried **before** {@link HAS_CONDITION}, which would take "until the grapple
 * ends" for a span it does not know and refuse the sentence. The lifetime is
 * the hold's, so it is read onto the grapple as something that hold implies.
 */
const UNTIL_GRAPPLE_ENDS = new RegExp(
  `^${SUBJECT}has the ([A-Z][a-z]+) condition until the grapple ends$`,
);
/**
 * SRD Chuul: "While Poisoned, the target has the Paralyzed condition." SRD
 * Pseudodragon: "While Poisoned, the target also has the Unconscious
 * condition, which ends early if…"
 *
 * A sentence about a condition **this line already imposed**, so it amends
 * that clause rather than standing as one of its own — and a line that says it
 * about a condition it did not impose names a lifetime that is not there and
 * is handed over. What rides after the condition is carried verbatim: the
 * Pseudodragon's early ending is a rule nothing here executes, and carrying it
 * keeps the line's debt on the books while the part that *was* read is
 * applied.
 */
const WHILE_CONDITION =
  /^While ([A-Z][a-z]+), (?:the target|the creature|it) (?:also )?has the ([A-Z][a-z]+) condition(?:, (.+))?$/;
/**
 * SRD Swarm of Ravens: "While Deafened, the target also has Disadvantage on
 * ability checks and attack rolls."
 *
 * The same sentence as {@link WHILE_CONDITION} over a **mode** instead of a
 * condition, and it names its lifetime the same way — the condition this
 * failure already imposed. So it is read the same way too: the host must be
 * found among the clauses read so far, and a sentence about a condition the
 * line did not impose is handed over rather than left hanging on nothing.
 *
 * It does not amend the host clause, because a mode is not something a
 * condition *implies*: `ConditionInstance.impliedBy` carries conditions, and
 * what this needs is a grant sourced to the instance. That is a clause of its
 * own, naming its host.
 */
const WHILE_CONDITION_MODE = new RegExp(
  `^While ([A-Z][a-z]+), (?:the target|the creature|it) (?:also )?has (Advantage|Disadvantage) on (${ROLL_WORDS}(?:,? and ${ROLL_WORDS})*)$`,
);
/**
 * The subject the three turn-rule clauses below accept.
 *
 * Wider than {@link SUBJECT} by one noun, because the Dretch writes "the
 * creature" where every clause that predates it writes "the target" or "it" —
 * and widening the shared constant would widen five older clauses at the same
 * time, which is a change to sentences nobody is reading.
 */
const WHO = '(?:(?:[Tt]he target|[Tt]he creature|[Ii]t) )?';
/**
 * SRD Gold Dragon Wyrmling's Weakening Breath: "The target has Disadvantage on
 * Strength-based D20 Tests".
 *
 * The glossary's own union of the three rolls {@link ROLLS} names, narrowed by
 * an ability — one sentence over three families, which the engine's
 * `d20-test` family was built to hold for SRD Ray of Enfeeblement. The ability
 * is required by the shape of the sentence: "D20 Tests" with no ability in
 * front of it is a mode on every roll the target ever makes, and the corpus
 * prints no such clause on a save.
 *
 * What may ride after it is a second clause, which is how the same line's
 * "and subtracts 2 (1d4) from its damage rolls" is read — the tail
 * {@link HAS_CONDITION} and {@link PUSHED} already carry.
 */
const HAS_MODE_ON_FAMILY = new RegExp(
  `^${WHO}has (Advantage|Disadvantage) on ${ABILITY_WORD}-based D20 Tests(?:,? and (.+))?$`,
);
/**
 * SRD Gold Dragon Wyrmling's Weakening Breath: "subtracts 2 (1d4) from its
 * damage rolls". SRD Adult Gold Dragon prints the same clause over 1d6.
 *
 * The engine's `damage-penalty` grant, read the way its damage is read
 * everywhere in this file: the average outside the parenthesis, the notation
 * inside it, and an addend where the book prints one.
 */
const SUBTRACTS_FROM_DAMAGE = new RegExp(
  `^${WHO}subtracts (\\d+) \\((\\d+)d(\\d+)(?:\\s*([+−–-])\\s*(\\d+))?\\) from (?:all )?its damage rolls(?:,? and (.+))?$`,
);
/**
 * SRD Dretch, SRD Copper Dragon Wyrmling: "it can't take Reactions".
 *
 * One slot taken away and everything the sentence does not name left alone,
 * which is the engine's `forbids` word for word.
 */
const NO_REACTIONS = new RegExp(`^${WHO}can't take Reactions$`);
/**
 * SRD Dretch, SRD Copper Dragon Wyrmling: "it can take either an action or a
 * Bonus Action on its turn, not both".
 *
 * The engine's `one-of`: spending either of the named slots forecloses the
 * rest of them for that turn. What may ride after it is a second clause, which
 * is how the Dretch's "and it can't take Reactions" is read — the tail
 * {@link HAS_CONDITION} and {@link PUSHED} already carry.
 */
const COUPLED_SLOTS = new RegExp(
  `^${WHO}can take either an action or a Bonus Action on its turn, not both(?:,? and (.+))?$`,
);
/**
 * SRD Copper Dragon Wyrmling: "its Speed is halved". SRD Adult Brass Dragon's
 * Scorching Sands prints the same clause with its own span on the end.
 *
 * Not {@link SPEED_CUT}, which takes printed feet away: a halving is an
 * operation on whatever the Speed turns out to be, and the engine has had the
 * two apart since SRD Slow was written.
 */
const SPEED_HALVED = new RegExp(
  `^(?:[Tt]he target's|[Ii]ts) Speed is halved(?: (until .+|for \\d+ (?:hour|minute)s?))?$`,
);
/**
 * SRD Copper Dragon Wyrmling: "This effect lasts until the end of its next
 * turn."
 *
 * A span printed **once, underneath a list**, which is the shape the four
 * Copper Dragons are the only blocks in the corpus to write. It says nothing
 * of its own: it finishes the clauses above it that named no lifetime, and a
 * sentence that finishes none of them is one this reader has misread — so it
 * refuses rather than standing as a clause that does nothing.
 *
 * **Only the two clauses whose lifetime may be left unsaid.** A condition with
 * no span is already a condition for the encounter and reads as one; the rule
 * about a turn and the halving are the pair that must say when they end, and
 * they are therefore the pair this can answer for.
 */
const LASTS_FOR = /^This effect lasts (until .+|for \d+ (?:hour|minute)s?)$/;
/**
 * SRD Dretch: "While Poisoned, the creature can take either an action or a
 * Bonus Action on its turn, not both, and it can't take Reactions."
 *
 * {@link WHILE_CONDITION_MODE}'s sentence over a **rule about a turn**, and
 * read the same way: the host must be a condition this failure imposed, and
 * the clause carries that condition's instance as its whole lifetime.
 *
 * **Tried after its two narrower siblings and read by recursion**, which is
 * {@link SIZE_GATED}'s shape: whatever the rest of the sentence turns out to
 * be is read first, and the host is then stamped onto it. A rest that reads as
 * anything but a clause which can carry a host — a push, a condition, a
 * sentence about a clause already read — refuses the sentence, so the
 * generality of the opening buys nothing it should not.
 */
const WHILE_CONDITION_RULE = /^While ([A-Z][a-z]+), (?:the target|the creature|it) (.+)$/;
/** SRD Lamia: "the target is cursed for 1 hour." */
const CURSED = /^[Tt]he target is cursed (for \d+ (?:hour|minute)s?)$/;
/**
 * SRD Lamia: "Until the curse ends, the target has the Charmed and Poisoned
 * conditions."
 *
 * The other half of {@link CURSED}, and read only with it: a curse that is
 * *only* conditions is those conditions for the curse's span, and a curse that
 * carries anything else — a Mummy's rot, an Incubus's kiss — says so in a
 * sentence this does not match, so neither half is read.
 */
const UNTIL_CURSE_ENDS =
  /^Until the curse ends, the target has the ([A-Z][a-z]+)(?: and (?:the )?([A-Z][a-z]+))? conditions?\.?$/;
const SIZE_GATED =
  /^If the target is a (Tiny|Small|Medium|Large|Huge|Gargantuan) or smaller creature, (.+)$/;
const PUSHED = new RegExp(
  `^${SUBJECT}is pushed up to (\\d+) feet straight away from the [a-z' -]+?(?: and (.+))?$`,
);
const SPEED_CUT = /^[Tt]he target's Speed decreases by (\d+) feet (until .+)$/;
/**
 * SRD Wight: "The target's Hit Point maximum decreases by an amount equal to
 * the damage taken." SRD Vampire Spawn: "…equal to the **Necrotic** damage
 * taken, **and the vampire regains Hit Points equal to that amount**."
 *
 * One sentence in two dressings, and both halves of the second are fields the
 * clause now carries: the component the sentence names, and the fact that what
 * the target lost the biter gains. Neither is a number — the amount is the one
 * this clause has already computed — which is why the regain is read here
 * rather than as a clause of its own.
 */
const HP_MAX_CUT =
  /^[Tt]he target's Hit Point maximum decreases by an amount equal to the ([A-Z][a-z]+ )?damage taken(, and the [a-z' -]+ regains Hit Points equal to that amount)?$/;
/**
 * SRD Water Elemental's Whelm: "Until the grapple ends, the target has the
 * Restrained condition, is suffocating unless it can breathe water, and takes
 * 9 (2d8) Bludgeoning damage at the start of each of the elemental's turns."
 *
 * {@link UNTIL_GRAPPLE_ENDS}'s sentence with two more things in it, and the
 * one place in this reader where a clause is read **around** words of its own
 * rather than beside them: the Restrained and the payout are primitives the
 * engine has, the suffocation is not, and the residue goes into
 * `Scratch.carried` under the book's own opening so a table reads a whole
 * sentence rather than a fragment. The ledger goes on counting the line.
 *
 * The middle is optional because a homebrew hold might print only the two
 * halves this reads, and the whole is anchored, so anything else between them
 * refuses the sentence and it is carried entire.
 */
const HELD_AND_PAID = new RegExp(
  `^Until the grapple ends, the target has the ([A-Z][a-z]+) condition(?:, (.+?))?,? and takes (\\d+) \\((\\d+)d(\\d+)(?:\\s*([+−–-])\\s*(\\d+))?\\) ([A-Za-z]+) damage at the (start|end) of each of (its|the [a-z'-]+(?: [a-z'-]+)*'s) turns$`,
);
/**
 * SRD Brass Dragon Wyrmling's second rung: "This effect ends for the target if
 * it takes damage or a creature within 5 feet of it takes an action to wake
 * it."
 *
 * One of the three spellings the book gives the sleeper's pair of endings, and
 * the only one that is a sentence of its own: it is read onto the condition
 * above it, exactly as "After 1 minute, it succeeds automatically" is.
 */
const EFFECT_ENDS_ON_WAKING =
  /^This effect ends for the target if it takes damage or a creature within 5 feet of it takes an action to wake it$/;
/**
 * SRD Incubus' Nightmare: "for 1 hour, **until it takes damage, or until a
 * creature within 5 feet of it takes an action to wake it**."
 *
 * The tail {@link CONDITION_WITH_EARLY_ENDINGS} used to carry whole. Read only
 * when it is exactly this pair: SRD Nalfeshnee's Horror Nimbus prints "until
 * it takes damage, or until it ends its turn with the nalfeshnee out of line
 * of sight" in the same position, and the second of those is an ending nothing
 * here can spend — so that line goes on carrying both.
 */
const EARLY_ENDINGS_ON_WAKING =
  /^until it takes damage, or until a creature within 5 feet of it takes an action to wake it$/;
/**
 * SRD Pseudodragon's Sting: "the target also has the Unconscious condition,
 * **which ends early if the target takes damage or a creature within 5 feet of
 * it takes an action to wake it**."
 *
 * The same pair again, riding on a condition another one carries — so the
 * marks go on the *carried* condition and not on the Poisoned hour that holds
 * it, which is what the book's "which" names.
 */
const ENDS_EARLY_ON_WAKING =
  /^which ends early if the target takes damage or a creature within 5 feet of it takes an action to wake it$/;
/**
 * SRD Homunculus: "While Poisoned, the target has the Unconscious condition,
 * **which ends early if the target takes any damage**."
 *
 * {@link ENDS_EARLY_ON_WAKING} with the waking half absent, which is the book
 * printing one of the pair rather than both — the case the two fields were
 * kept apart for. The "any" is the homunculus's own wording and buys nothing:
 * damage is damage.
 */
const ENDS_EARLY_ON_DAMAGE = /^which ends early if the target takes (?:any )?damage$/;
/**
 * SRD Giant Spider's Web: "The target has the Restrained condition until the
 * web is destroyed (AC 10; HP 5; Vulnerability to Fire damage; Immunity to
 * Poison and Psychic damage)." SRD Ettercap's Web Strand prints it with
 * Bludgeoning in the immunity run.
 *
 * **A lifetime that is a *thing*.** Every other span this file reads is a
 * clock or another condition; this one is an object the line brings into
 * being, with numbers of its own and somebody free to burn it. Matched whole
 * rather than as a `until …` tail on {@link HAS_CONDITION}, because the
 * parenthesis is where the object's whole record is and a tail that swallowed
 * it would have read a span out of a stat line.
 *
 * The noun is captured, because the thing has to be called something and the
 * book is the only place that says what.
 */
const HELD_BY_OBJECT = new RegExp(
  `^${SUBJECT}has the ([A-Z][a-z]+) condition until the ([a-z][a-z ]*) is destroyed ` +
    `\\(AC (\\d+); HP (\\d+)((?:; [^)]+?)*)\\)$`,
);

/** One run of the object's defence line: "Immunity to Bludgeoning, Poison, and Psychic damage". */
const DEFENCE_RUN = /^(Vulnerability|Resistance|Immunity) to (.+) damage$/;

/**
 * The defences a printed object's parenthesis states, or null where it states
 * one this reader cannot key.
 *
 * Null rather than a partial answer, for the rule the whole file keeps: an
 * object whose Vulnerability to Fire went unread is a web nobody can burn, and
 * that is worse than a line the table applies by hand.
 */
function objectDefencesOf(
  run: string,
): {
  readonly vulnerabilities?: string[];
  readonly resistances?: string[];
  readonly immunities?: string[];
} | null {
  const found: Record<'Vulnerability' | 'Resistance' | 'Immunity', string[]> = {
    Vulnerability: [],
    Resistance: [],
    Immunity: [],
  };
  for (const clause of run.split(';').map((part) => part.trim()).filter((part) => part !== '')) {
    const match = DEFENCE_RUN.exec(clause);
    if (match === null) return null;
    const types = match[2]!
      .split(/, and |,? and |, /)
      .map((word) => word.trim().toLowerCase())
      .filter((word) => word !== '');
    if (types.length === 0 || types.some((type) => !DAMAGE_TYPES.has(type))) return null;
    found[match[1] as 'Vulnerability' | 'Resistance' | 'Immunity'].push(...types);
  }
  return {
    ...(found.Vulnerability.length === 0 ? {} : { vulnerabilities: found.Vulnerability }),
    ...(found.Resistance.length === 0 ? {} : { resistances: found.Resistance }),
    ...(found.Immunity.length === 0 ? {} : { immunities: found.Immunity }),
  };
}
/**
 * SRD Ghost: "The target is immune to this ghost's Horrific Visage for 24
 * hours." SRD Mummy's Dreadful Glare prints it word for word.
 *
 * The one sentence the corpus prints under `_Success:_` that is not "Half
 * damage", and it names the heading it is about — which is carried, because
 * this reader is handed a line's text without its heading and the executor is
 * where the two meet.
 */
const IMMUNE_TO_THIS_LINE =
  /^The target is immune to this [a-z' -]+'s (.+) (for \d+ (?:hour|minute)s?)$/;
/**
 * SRD Vampire Spawn's Bite: "one creature within 5 feet **that is willing or
 * that has the Grappled, Incapacitated, or Restrained condition**."
 *
 * The second part of a targeting clause this reader takes, after
 * {@link TARGET_HIT_POINTS}, and for the same reason: it is a fact about one
 * creature somebody has already named rather than an area nobody has measured.
 * The willingness half is the table's and is carried as the flag the command
 * asks for.
 */
const TARGET_CONDITIONS =
  /\bthat (is willing or that )?has the ((?:[A-Z][a-z]+, )*[A-Z][a-z]+(?:,? or [A-Z][a-z]+)?) conditions?\b/;
/**
 * "repeats the save at the end of each of its turns, ending the effect on
 * itself on a success" — a standing obligation, wherever the condition it is
 * about was printed.
 *
 * The subject is optional twice over, because the book writes this clause both
 * as a continuation of the sentence before it ("…, and repeats the save…") and
 * with its own pronoun: SRD Silver Dragon Wyrmling's second rung is "The
 * target has the Paralyzed condition, **and it** repeats the save at the end
 * of each of its turns" — and SRD Gold Dragon Wyrmling's Weakening Breath
 * starts a sentence with it: "**It** repeats the save at the end of each of
 * its turns".
 */
const REPEATS_AFTER =
  /^(?:and )?(?:[Ii]t )?repeats the save at the end of each of its turns, ending the effect on itself on a success$/;
/**
 * SRD Gorgon: "and repeats the save at the end of **its next** turn if it is
 * still Restrained, ending the effect on itself on a success."
 *
 * One repeat rather than a standing obligation, and read **only inside a
 * graded failure** — which is the whole of what makes the two the same shape
 * for the engine. A graded line's timer dies at the first resolution either
 * way: a success ends the condition on its target and a failure deepens it,
 * and `condition-removed` takes the deadline off with the instance. Outside
 * one, "at the end of its next turn" would be a save the boundary went on
 * raising every turn, which is a rule nobody printed — so the clause refuses
 * the sentence there.
 *
 * "if it is still Restrained" needs no field: an instance that is gone has no
 * timer, so the save is not owed.
 *
 * **And the subject is optional**, because the book prints the clause both
 * ways: the Gorgon continues its own sentence with "and repeats the save…"
 * and SRD Cockatrice starts a new one — "The target repeats the save at the
 * end of its next turn if it is still Restrained…". One rule in two dressings,
 * which is the reading {@link REPEATS_AFTER} already takes of its own pair.
 */
const REPEATS_NEXT_TURN = new RegExp(
  `^(?:and )?${SUBJECT}repeats the save at the end of its next turn` +
    `(?: if it is still [A-Z][a-z]+)?, ending the effect on itself on a success$`,
);
/**
 * SRD Brass Dragon Wyrmling: "The target has the Incapacitated condition until
 * the end of its next turn, **at which point it repeats the save**." SRD
 * Silver Dragon Wyrmling writes "…, **when** it repeats the save".
 *
 * **One moment said twice, and it is the repeat's rather than a span of its
 * own.** What arrives at the end of that turn is the save, and what the save
 * does is end the condition on a success or deepen it on a failure — so a
 * `lasts` beside the repeat would be a second, silent ending for the same
 * moment, which is the race the engine refuses a first rung outright (see
 * `RepeatSave.onFailure`). The span is therefore consumed by the repeat and
 * the clause carries none.
 *
 * A whole sentence rather than a tail, because the connector is neither of the
 * two {@link HAS_CONDITION} knows and the span in front of it has to be read
 * and dropped in the same breath. Read **only inside a graded failure**, which
 * is {@link REPEATS_NEXT_TURN}'s rule and for its reason: the repeat is
 * one-shot, and a line with no second rung would leave a condition a failure
 * never lifts.
 */
const CONDITION_UNTIL_REPEAT = new RegExp(
  `^${SUBJECT}has the ([A-Z][a-z]+) condition until the end of its next turn, (?:at which point|when) it repeats the save$`,
);
const REPEATS_BEFORE =
  /^At the end of each of its turns, the target repeats the save, ending the effect on itself on a success$/;
const CAPPED = /^After (\d+) minutes?, it succeeds automatically$/;
/**
 * SRD Will-o'-Wisp: "The target dies, and the wisp regains 10 (3d6) Hit
 * Points."
 *
 * One of the two failures in the corpus that kill outright, and the only one
 * this reads. SRD Solar's Slaying Bow is the other — "If the creature has 100
 * Hit Points or fewer, it dies. It otherwise takes 24 (4d8 + 6) Piercing
 * damage plus 36 (8d8) Radiant damage" — and its threshold is a *branch* with
 * a damage arm rather than a restriction on who the line may be forced on,
 * which is a shape this vocabulary has no field for and which SRD Sea Hag and
 * SRD Incubus print too. The regain is part of the same sentence rather than a
 * clause of its own — see `PrintedSaveEffectSchema`'s `dies`.
 */
const DIES =
  /^The target dies(?:, and the [a-z' -]+ regains (\d+) \((\d+)d(\d+)(?:\s*([+−–-])\s*(\d+))?\) Hit Points)?$/;
/**
 * SRD Will-o'-Wisp's targeting clause: "one living creature the wisp can see
 * within 5 feet **that has 0 Hit Points**."
 *
 * The one part of a targeting clause this reader takes, and it is taken only
 * for {@link DIES}. Everything else in that slot needs an origin and a facing
 * nobody declared and stays the table's; a hit-point ceiling is a number the
 * engine already holds about a creature somebody has named, and a sentence
 * that kills outright is the last one to take on trust.
 */
const TARGET_HIT_POINTS = /\bthat has (\d+) Hit Points?\b(?! or more)/;

/**
 * SRD Gold Dragon Wyrmling's targeting clause: "each creature **that isn't
 * currently affected by this breath** in a 15-foot Cone."
 *
 * The third fact a targeting clause gives up, and taken for the reason the
 * other two are: it is about one creature somebody has already named, and the
 * engine holds the answer — whether this line's own source is still hung on
 * them. The noun is the block's own word for the line and is not read.
 */
const NOT_ALREADY_AFFECTED = /\bthat isn't currently affected by this [a-z][a-z -]*\b/;

/**
 * SRD Sprite's Heart Sight: "(Celestials, Fiends, and Undead automatically
 * fail the save)".
 *
 * A parenthesis on the targeting clause naming the creature types for which no
 * die is thrown. The list is the book's plural nouns; `typesOf` below keys them
 * singular, because a creature's type is printed singular on its block.
 */
const AUTO_FAIL_TYPES = /\(((?:[A-Z][a-z]+, )*[A-Z][a-z]+,? and [A-Z][a-z]+) automatically fail the save\)/;

/**
 * SRD Sprite's Heart Sight: "The sprite knows the target's emotions and
 * alignment."
 *
 * A failure that is knowledge rather than an effect on the target. The two
 * facts are the sentence's own and are read in the order it prints them.
 */
const KNOWS = /^The [a-z' -]+ knows the target's (emotions|alignment)(?: and (emotions|alignment))?$/;

/**
 * SRD Sea Hag: "If the target has 20 Hit Points or fewer, it drops to 0 Hit
 * Points." SRD Incubus prints the same opening over an Unconscious.
 *
 * The first half of a two-sentence rule; {@link OTHERWISE_TAKES} is the other,
 * and neither is read without the other — see {@link readBranch}.
 */
const IF_HIT_POINTS_AT_MOST =
  /^If the (?:target|creature) has (\d+) Hit Points or fewer, (.+)$/;
/**
 * SRD Sea Hag: "Otherwise, the target takes 13 (3d8) Psychic damage."
 *
 * Both spellings the corpus prints, because SRD Solar writes the same sentence
 * as "It otherwise takes …". What follows is damage and only damage: no
 * "Otherwise" in the book carries a condition.
 */
const OTHERWISE_TAKES =
  /^(?:Otherwise, (?:the target|the creature|it) takes|It otherwise takes) (.+)$/;
/**
 * SRD Sea Hag: "it drops to 0 Hit Points".
 *
 * Read **only under a ceiling**, which is the gate {@link DIES} has and for
 * the same reason: a save that empties a healthy creature's Hit Points with no
 * restriction on who it may reach is a rule nobody printed. See
 * `PrintedSaveEffectSchema`'s `drops-to-zero`.
 */
const DROPS_TO_ZERO = new RegExp(`^${SUBJECT}drops to 0 Hit Points$`);
/**
 * SRD Incubus: "it has the Unconscious condition **for 1 hour, until it takes
 * damage, or until a creature within 5 feet of it takes an action to wake
 * it**."
 *
 * A span the reader knows followed by early endings it does not. Tried before
 * {@link HAS_CONDITION}, which reads the whole tail as one span, fails to make
 * a span of it and refuses the sentence. The printed hour is applied and the
 * early endings are carried, which is the `Scratch.carried` seam: an effect
 * that ends *later* than the book says is applied with the difference handed
 * over, where one that would never end is refused.
 */
const CONDITION_WITH_EARLY_ENDINGS = new RegExp(
  `^${SUBJECT}has the ([A-Z][a-z]+) condition (for \\d+ (?:hour|minute)s?), (until .+)$`,
);

/**
 * Read one span, or null where the words are not a span this reader knows.
 *
 * "its" is the target's turn; a possessive naming the block's own creature —
 * "the mephit's", "the swarm's" — is the source's. Nothing the corpus prints in
 * this slot names a third creature.
 */
function spanOf(words: string): PrintedSpan | null {
  const turn = UNTIL_TURN.exec(words);
  if (turn !== null) {
    return {
      kind: 'turn',
      moment: turn[1] as 'start' | 'end',
      of: turn[2] === 'its' ? 'target' : 'source',
    };
  }
  const span = FOR_SPAN.exec(words);
  if (span !== null) {
    return { kind: 'seconds', seconds: Number(span[1]) * (SPAN_SECONDS[span[2]!] ?? 0) };
  }
  return null;
}

function damageOf(match: RegExpExecArray, offset: number): MonsterDamage | null {
  // **An absent capture is the book declining to name a type**, not a misread
  // line: {@link TYPE_SLOT}'s second alternative matches the whole phrase and
  // captures nothing, so the amount is read and the type is the table's.
  const word = match[offset + 5];
  const type = word === undefined ? DECLARED_DAMAGE_TYPE : word.toLowerCase();
  if (type !== DECLARED_DAMAGE_TYPE && !DAMAGE_TYPES.has(type)) return null;
  const sign = match[offset + 3] === undefined ? 1 : match[offset + 3] === '+' ? 1 : -1;
  return {
    dice: `${match[offset + 1]}d${match[offset + 2]}`,
    flat: match[offset + 4] === undefined ? 0 : sign * Number(match[offset + 4]),
    type,
    average: Number(match[offset]),
  };
}

/**
 * What one section is being read into: the effects so far, and the words a
 * clause was read *around*.
 *
 * `carried` is how a clause can be read and still leave a debt. SRD
 * Pseudodragon's "While Poisoned, the target also has the Unconscious
 * condition, **which ends early if the target takes damage**…" is one clause
 * saying two things, and only the first is a primitive the engine has — so the
 * Unconscious is read and the early ending is carried, ending up in
 * `handedOver` beside every sentence that was not read at all. The ledger goes
 * on counting the line, which is the rule: recognising part of a sentence may
 * never retire a debt.
 *
 * Both halves are the caller's **scratch copy**: a sentence is read against a
 * copy and committed only when every clause in it was read, so nothing is
 * half-applied and nothing is half-carried.
 */
interface Scratch {
  readonly effects: PrintedSaveEffect[];
  readonly carried: string[];
}

/** Replace the last condition in the list with a re-reading of it, or fail where there is none. */
function amendLastCondition(
  into: PrintedSaveEffect[],
  amend: (last: ConditionEffect) => ConditionEffect | null,
): boolean {
  return amendCondition(into, () => true, amend);
}

/**
 * Amend what a repeat save is **about**: the last condition where the failure
 * imposed one, and otherwise every mode and penalty the failure hung with no
 * lifetime yet.
 *
 * SRD Gold Dragon Wyrmling's Weakening Breath: "The target has Disadvantage on
 * Strength-based D20 Tests and subtracts 2 (1d4) from its damage rolls. It
 * repeats the save at the end of each of its turns, ending the effect on
 * itself on a success." No condition is imposed, so "the effect" the save ends
 * is the pair of clauses above it — **both of them**, because the book prints
 * one save and "ending the effect" is one ending. The executor files them
 * under one source for the same reason.
 *
 * The condition wins where there is one, which is every line the reader took
 * before this: a repeat printed after "the target has the Restrained condition"
 * is about the Restrained, and a mode riding beside it on the same instance
 * already has that instance as its lifetime.
 *
 * `accepts` narrows which of the two clauses the sentence may amend — a repeat
 * lands on one with no lifetime yet, a cap on one that already repeats — so a
 * cap printed under a mode that never repeats is refused rather than pinned on
 * nothing.
 */
function amendRepeatable(
  into: PrintedSaveEffect[],
  amendCondition: (last: ConditionEffect) => ConditionEffect | null,
  accepts: (effect: RepeatableEffect) => boolean,
  amendLasting: (effect: RepeatableEffect) => RepeatableEffect,
): boolean {
  if (into.some((effect) => effect.kind === 'condition')) {
    return amendLastCondition(into, amendCondition);
  }
  let amended = 0;
  for (let i = 0; i < into.length; i += 1) {
    const effect = into[i]!;
    if (!isRepeatable(effect) || !accepts(effect)) continue;
    into[i] = amendLasting(effect);
    amended += 1;
  }
  return amended > 0;
}

/** Whether a mode or a penalty has named no lifetime at all yet. */
const unlifetimed = (effect: RepeatableEffect): boolean =>
  effect.whileCondition === undefined && effect.lasts === undefined && effect.repeats === undefined;

/**
 * Replace the last condition the predicate accepts, or fail where there is
 * none.
 *
 * "While Poisoned, …" names the clause it is about rather than sitting behind
 * it, so the search is by condition and not by position — and a sentence about
 * a condition this line did not impose finds nothing and is handed over, which
 * is the same answer {@link amendLastCondition} gives an empty list.
 */
function amendCondition(
  into: PrintedSaveEffect[],
  matches: (effect: ConditionEffect) => boolean,
  amend: (last: ConditionEffect) => ConditionEffect | null,
): boolean {
  for (let i = into.length - 1; i >= 0; i -= 1) {
    const effect = into[i]!;
    if (effect.kind !== 'condition' || !matches(effect)) continue;
    const amended = amend(effect);
    if (amended === null) return false;
    into[i] = amended;
    return true;
  }
  return false;
}

/** Add to what a cause carries, keeping the book's order and saying nothing twice. */
const alsoImplies = (
  last: ConditionEffect,
  condition: ConditionEffect['condition'],
): ConditionEffect =>
  last.implies?.includes(condition) === true
    ? last
    : { ...last, implies: [...(last.implies ?? []), condition] };

/**
 * Mark one of a clause's conditions with the sleeper's pair of endings.
 *
 * The book prints them together in all five places it prints them at all —
 * "if it takes damage **or** a creature within 5 feet of it takes an action to
 * wake it" — so they are set together and the two fields are what lets a
 * homebrew line say one without the other.
 *
 * **The name matters**, which is why this takes one: the Pseudodragon ends the
 * Unconscious its Poisoned carries and not the Poisoned, and a flag on the
 * clause could not tell the two apart.
 */
const alsoEndsOnWaking = (
  last: ConditionEffect,
  condition: ConditionEffect['condition'],
): ConditionEffect => ({
  ...alsoEndsOnDamage(last, condition),
  endsWhenWoken: last.endsWhenWoken?.includes(condition) === true
    ? last.endsWhenWoken
    : [...(last.endsWhenWoken ?? []), condition],
});

/**
 * The first half of that pair on its own — SRD Homunculus, whose sleep a blow
 * ends and nobody may shake off.
 *
 * Split out of {@link alsoEndsOnWaking} rather than written beside it, so the
 * two spellings cannot drift: the pair is this and the waking mark, and a
 * homebrew line saying only the second would be the mirror image.
 */
const alsoEndsOnDamage = (
  last: ConditionEffect,
  condition: ConditionEffect['condition'],
): ConditionEffect => ({
  ...last,
  endsOnDamage: last.endsOnDamage?.includes(condition) === true
    ? last.endsOnDamage
    : [...(last.endsOnDamage ?? []), condition],
});

/**
 * Where a clause is being read, which is the only thing that changes what it
 * may say.
 *
 * Two flags rather than two parameters, because both travel together down
 * every recursive call in {@link readClause} and a third would be a third
 * place to forget one.
 */
interface Reading {
  /**
   * Whether this section is one rung of a graded failure: see
   * {@link REPEATS_NEXT_TURN}.
   */
  readonly graded: boolean;
  /**
   * Whether this clause sits under a branch's Hit Point ceiling: see
   * {@link DROPS_TO_ZERO}.
   */
  readonly underACeiling: boolean;
}

/** Nothing said about where it is: the plain `_Failure:_` of an ungraded line. */
const PLAINLY: Reading = { graded: false, underACeiling: false };

/**
 * Read one clause **into** the scratch, or return false where the words are
 * not a clause this knows.
 *
 * Several sentences say something about a clause already read — "and repeats
 * the save…", "After 1 minute, it succeeds automatically.", "While Poisoned,
 * the target has the Paralyzed condition." — and amend it in place.
 */
function readClause(clause: string, into: Scratch, where: Reading): boolean {
  const { graded } = where;
  const words = clause.replace(/\.$/, '').trim();
  if (words === '') return true;

  // **Before the semicolon list below**, whose own note names this sentence as
  // the thing it comes apart on: SRD Giant Spider's "(AC 10; HP 5; …)" is one
  // stat line written with the book's list punctuation, not a list of clauses.
  // And before {@link HAS_CONDITION}, whose `until …` tail would otherwise
  // swallow the whole parenthesis as a span and read nothing out of it. The
  // narrower sentence goes first, which is the order every pair here is tried
  // in.
  const web = HELD_BY_OBJECT.exec(words);
  if (web !== null) {
    const name = CONDITIONS[web[1]!];
    const defences = objectDefencesOf(web[5] ?? '');
    if (name === undefined || defences === null) return false;
    into.effects.push({
      kind: 'condition',
      condition: name,
      heldByObject: {
        noun: web[2]!,
        armorClass: Number(web[3]),
        hitPoints: Number(web[4]),
        ...defences,
      },
    });
    return true;
  }

  /**
   * A semicolon list, read one clause at a time.
   *
   * SRD Copper Dragon Wyrmling: "The target can't take Reactions; its Speed is
   * halved; and it can take either an action or a Bonus Action on its turn,
   * not both." The book uses the semicolon here for the reason it uses "and"
   * everywhere else — the clauses already contain commas — so it is the same
   * conjunction and reads the same way.
   *
   * **Safe because the reading is transactional.** A semicolon inside a
   * parenthesis splits too: SRD Giant Spider's "until the web is destroyed (AC
   * 10; HP 5; …)" comes apart into three fragments, none of which is a clause,
   * so the whole sentence is refused and handed over exactly as it was before
   * this existed. That is the property rather than a lucky escape — a piece
   * this cannot read refuses the list, and `readSection` throws the scratch
   * away.
   */
  if (words.includes(';')) {
    for (const piece of words.split(';')) {
      const part = piece.trim().replace(/^and\s+/, '');
      if (part === '') continue;
      if (!readClause(part, into, where)) return false;
    }
    return true;
  }

  const gated = SIZE_GATED.exec(words);
  if (gated !== null) {
    const size = SIZES[gated[1]!];
    if (size === undefined) return false;
    const before = into.effects.length;
    if (!readClause(gated[2]!, into, where)) return false;
    for (let i = before; i < into.effects.length; i += 1) {
      const effect = into.effects[i]!;
      if (effect.kind === 'condition') into.effects[i] = { ...effect, ifNoLargerThan: size };
    }
    return true;
  }

  // Before `HAS_CONDITION`, which would take "until the grapple ends" for a
  // span and refuse the sentence it rides on.
  const held = UNTIL_GRAPPLE_ENDS.exec(words);
  if (held !== null) {
    const name = CONDITIONS[held[1]!];
    if (name === undefined) return false;
    // Only onto a grapple: the lifetime the sentence names is the hold's, and
    // a clause that named no hold would be a condition nothing could end.
    return amendCondition(
      into.effects,
      (effect) => effect.escapeDc !== undefined,
      (last) => alsoImplies(last, name),
    );
  }

  // Before `WHILE_CONDITION`, which would fail to find "the … condition" in
  // this sentence and refuse it. Two readings of one opening, told apart by
  // what follows the verb.
  const whileMode = WHILE_CONDITION_MODE.exec(words);
  if (whileMode !== null) {
    const host = CONDITIONS[whileMode[1]!];
    if (host === undefined) return false;
    // The host must be a condition **this failure imposed**: the instance is
    // the whole of the mode's lifetime, so one named on a condition that is
    // not there would be a Disadvantage nothing ever lifts. The same answer
    // `WHILE_CONDITION` gives, one clause down.
    if (!into.effects.some((effect) => effect.kind === 'condition' && effect.condition === host)) {
      return false;
    }
    const rolls: RollModeEffect['rolls'][number][] = [];
    for (const word of whileMode[3]!.split(/,? and /)) {
      const roll = ROLLS[word];
      if (roll === undefined) return false;
      if (!rolls.includes(roll)) rolls.push(roll);
    }
    into.effects.push({
      kind: 'roll-mode',
      mode: whileMode[2] === 'Advantage' ? 'advantage' : 'disadvantage',
      rolls,
      whileCondition: host,
    });
    return true;
  }

  const whileSo = WHILE_CONDITION.exec(words);
  if (whileSo !== null) {
    const host = CONDITIONS[whileSo[1]!];
    const name = CONDITIONS[whileSo[2]!];
    if (host === undefined || name === undefined) return false;
    // **The sleeper's pair, where the tail is that and nothing else.** SRD
    // Pseudodragon: "…, which ends early if the target takes damage or a
    // creature within 5 feet of it takes an action to wake it." Both endings
    // are verbs the engine spends now, so the clause carries them instead of
    // handing the relative clause to a table — and it carries them under the
    // condition the book's "which" names, which is the one this sentence
    // added rather than the one carrying it.
    const woken = whileSo[3] !== undefined && ENDS_EARLY_ON_WAKING.test(whileSo[3]);
    // **And the half of that pair the homunculus prints alone**: a sleep a blow
    // ends and nobody may shake off. Read here rather than carried for
    // `ENDS_EARLY_ON_WAKING`'s reason — the verb is one the engine spends —
    // and onto the condition the book's "which" names, which is the one this
    // sentence added.
    const struck = !woken && whileSo[3] !== undefined && ENDS_EARLY_ON_DAMAGE.test(whileSo[3]);
    const amended = amendCondition(
      into.effects,
      (effect) => effect.condition === host,
      (last) =>
        woken
          ? alsoEndsOnWaking(alsoImplies(last, name), name)
          : struck
            ? alsoEndsOnDamage(alsoImplies(last, name), name)
            : alsoImplies(last, name),
    );
    if (!amended) return false;
    if (woken || struck) return true;
    // **Carried with the noun it is about.** The book's words are "which ends
    // early if…", and which condition that "which" names is the whole of the
    // ruling: SRD Pseudodragon ends the *Unconscious* early and not the
    // Poisoned that carries it, and a table handed the relative clause alone
    // could lift either. So the condition is put back in front of the book's
    // own words rather than the fragment being handed over bare.
    if (whileSo[3] !== undefined) {
      into.carried.push(`The ${whileSo[2]} condition, ${whileSo[3]}.`);
    }
    return true;
  }

  // After both of its narrower siblings, which is what keeps its generality
  // honest: "While Deafened, … Disadvantage on ability checks" and "While
  // Poisoned, … the Paralyzed condition" have already had their turn, and what
  // is left is read by recursion and then stamped with the host it names.
  const whileRule = WHILE_CONDITION_RULE.exec(words);
  if (whileRule !== null) {
    const host = CONDITIONS[whileRule[1]!];
    if (host === undefined) return false;
    // The host must be a condition **this failure imposed** — the instance is
    // the whole of the lifetime, so one named on a condition that is not there
    // would be a rule nothing ever lifts. `WHILE_CONDITION_MODE`'s answer.
    if (!into.effects.some((effect) => effect.kind === 'condition' && effect.condition === host)) {
      return false;
    }
    const before = into.effects.length;
    if (!readClause(whileRule[2]!, into, where)) return false;
    // A rest that amended a clause already read rather than adding one, or
    // that added a clause with no room for a host, is a sentence this has
    // misread: the "While" would be silently dropped. Refused instead.
    if (into.effects.length === before) return false;
    for (let i = before; i < into.effects.length; i += 1) {
      const effect = into.effects[i]!;
      if (!isLasting(effect) || lifetimed(effect)) return false;
      into.effects[i] = { ...effect, whileCondition: host };
    }
    return true;
  }

  // Before `HAS_CONDITION`, which would read the span and then refuse the
  // sentence on a connector it does not know. The span is the repeat's moment
  // rather than the condition's ending — see {@link CONDITION_UNTIL_REPEAT} —
  // so the clause keeps no `lasts` of its own.
  if (graded) {
    const untilRepeat = CONDITION_UNTIL_REPEAT.exec(words);
    if (untilRepeat !== null) {
      const name = CONDITIONS[untilRepeat[1]!];
      if (name === undefined) return false;
      into.effects.push({
        kind: 'condition',
        condition: name,
        repeats: { at: 'end', of: 'target' },
      });
      return true;
    }
  }

  // Before `HAS_CONDITION`, which reads "for 1 hour, until it takes damage, …"
  // as one span, cannot make a span of it and refuses the sentence.
  const ending = CONDITION_WITH_EARLY_ENDINGS.exec(words);
  if (ending !== null) {
    const name = CONDITIONS[ending[1]!];
    if (name === undefined) return false;
    const span = spanOf(ending[2]!);
    if (span === null) return false;
    // **The sleeper's pair, where the tail is exactly that.** SRD Incubus'
    // Nightmare ends its hour on damage and on a neighbour's action, and both
    // are verbs the engine spends. SRD Nalfeshnee's second ending is a line of
    // sight nothing here holds, so that tail is carried whole as it always was.
    const woken = EARLY_ENDINGS_ON_WAKING.test(ending[3]!);
    into.effects.push({
      kind: 'condition',
      condition: name,
      lasts: span,
      ...(woken ? { endsOnDamage: [name], endsWhenWoken: [name] } : {}),
    });
    // Carried with the noun the book's own clause hangs on, which is the rule
    // `WHILE_CONDITION` follows above: a table handed "until it takes damage"
    // bare could not tell which condition it ends.
    if (!woken) into.carried.push(`The ${ending[1]} condition ends early: ${ending[3]}.`);
    return true;
  }

  // Before `UNTIL_GRAPPLE_ENDS`, whose sentence this is with two more things
  // in it — see {@link HELD_AND_PAID}.
  const heldAndPaid = HELD_AND_PAID.exec(words);
  if (heldAndPaid !== null) {
    const name = CONDITIONS[heldAndPaid[1]!];
    const type = heldAndPaid[8]!.toLowerCase();
    if (name === undefined || !DAMAGE_TYPES.has(type)) return false;
    const sign = heldAndPaid[6] === undefined ? 1 : heldAndPaid[6] === '+' ? 1 : -1;
    const hung = amendCondition(
      into.effects,
      (effect) => effect.escapeDc !== undefined,
      (last) => ({
        ...alsoImplies(last, name),
        payout: {
          damage: {
            dice: `${heldAndPaid[4]}d${heldAndPaid[5]}`,
            flat: heldAndPaid[7] === undefined ? 0 : sign * Number(heldAndPaid[7]),
            type,
            average: Number(heldAndPaid[3]),
          },
          at: heldAndPaid[9] as 'start' | 'end',
          onTurnOf: heldAndPaid[10] === 'its' ? ('target' as const) : ('source' as const),
        },
      }),
    );
    if (!hung) return false;
    // What the sentence said between its two halves and this reader cannot
    // spend — SRD's "is suffocating unless it can breathe water", which is a
    // rule about breathing nothing in the engine holds. Carried under the
    // book's own opening, so a table reads a sentence rather than a fragment.
    if (heldAndPaid[2] !== undefined) {
      into.carried.push(`Until the grapple ends, the target ${heldAndPaid[2]}.`);
    }
    return true;
  }

  const condition = HAS_CONDITION.exec(words);
  if (condition !== null) {
    const name = CONDITIONS[condition[1]!];
    if (name === undefined) return false;
    const span = condition[3] === undefined ? null : spanOf(condition[3]);
    if (condition[3] !== undefined && span === null) return false;
    into.effects.push({
      kind: 'condition',
      condition: name,
      ...(span === null ? {} : { lasts: span }),
      ...(condition[2] === undefined ? {} : { escapeDc: Number(condition[2]) }),
    });
    return condition[4] === undefined ? true : readClause(condition[4], into, where);
  }

  const pushed = PUSHED.exec(words);
  if (pushed !== null) {
    into.effects.push({ kind: 'push', feet: Number(pushed[1]) });
    return pushed[2] === undefined ? true : readClause(pushed[2], into, where);
  }

  const speed = SPEED_CUT.exec(words);
  if (speed !== null) {
    const span = spanOf(speed[2]!);
    if (span === null) return false;
    into.effects.push({ kind: 'speed-decrease', feet: Number(speed[1]), lasts: span });
    return true;
  }

  // SRD Gold Dragon Wyrmling: "The target has Disadvantage on Strength-based
  // D20 Tests and subtracts 2 (1d4) from its damage rolls." The family the
  // glossary names, narrowed by the ability the sentence prints; its lifetime
  // is whatever the sentences after it say — a repeat save, a span, or a host
  // condition stamped on by `WHILE_CONDITION_RULE` — and a clause left with
  // none refuses the line at the end, as every lasting clause does.
  const family = HAS_MODE_ON_FAMILY.exec(words);
  if (family !== null) {
    const ability = ABILITY_KEYS[family[2]!];
    if (ability === undefined) return false;
    into.effects.push({
      kind: 'roll-mode',
      mode: family[1] === 'Advantage' ? 'advantage' : 'disadvantage',
      rolls: ['d20-test'],
      ability,
    });
    return family[3] === undefined ? true : readClause(family[3], into, where);
  }

  // The same line's second half: a penalty on the target's own damage rolls,
  // read as damage is read everywhere here and thrown where the damage is.
  const subtracts = SUBTRACTS_FROM_DAMAGE.exec(words);
  if (subtracts !== null) {
    const sign = subtracts[4] === undefined ? 1 : subtracts[4] === '+' ? 1 : -1;
    into.effects.push({
      kind: 'damage-penalty',
      dice: `${subtracts[2]}d${subtracts[3]}`,
      flat: subtracts[5] === undefined ? 0 : sign * Number(subtracts[5]),
      average: Number(subtracts[1]),
    });
    return subtracts[6] === undefined ? true : readClause(subtracts[6], into, where);
  }

  // The halving, which is a different operation from the cut above rather than
  // a cut whose feet somebody would have to compute. Its span is optional here
  // and required by the time the line is finished: the Brass Dragon prints one
  // inline and the Copper Dragon prints one underneath the list.
  const halved = SPEED_HALVED.exec(words);
  if (halved !== null) {
    if (halved[1] === undefined) {
      into.effects.push({ kind: 'speed-halved' });
      return true;
    }
    const span = spanOf(halved[1]);
    if (span === null) return false;
    into.effects.push({ kind: 'speed-halved', lasts: span });
    return true;
  }

  if (NO_REACTIONS.test(words)) {
    into.effects.push({ kind: 'action-rule', rule: { kind: 'forbids', slots: ['reaction'] } });
    return true;
  }

  const coupled = COUPLED_SLOTS.exec(words);
  if (coupled !== null) {
    into.effects.push({
      kind: 'action-rule',
      rule: { kind: 'one-of', slots: ['action', 'bonus-action'] },
    });
    return coupled[1] === undefined ? true : readClause(coupled[1], into, where);
  }

  // SRD Sprite's Heart Sight: a failure that is knowledge.
  const knows = KNOWS.exec(words);
  if (knows !== null) {
    const facts = [knows[1]!, knows[2]].filter(
      (fact): fact is 'emotions' | 'alignment' => fact !== undefined,
    );
    // The same word twice is a sentence nobody printed.
    if (new Set(facts).size !== facts.length) return false;
    into.effects.push({ kind: 'reveals', facts });
    return true;
  }

  // SRD Rust Monster's Antennae: the penalty, and the sentence after it that
  // states the two ceilings the executor keeps.
  const corroded = OBJECT_PENALTY.exec(words);
  if (corroded !== null) {
    into.effects.push({ kind: 'object-penalty', points: Number(corroded[1]) });
    return true;
  }
  if (OBJECT_DESTROYED_RULE.test(words)) {
    // A rule about the penalty above it; with none there it is a rule about
    // nothing, and goes back to the table.
    return into.effects.some((effect) => effect.kind === 'object-penalty');
  }

  const maximum = HP_MAX_CUT.exec(words);
  if (maximum !== null) {
    const ofType = maximum[1] === undefined ? undefined : maximum[1].trim().toLowerCase();
    if (ofType !== undefined && !DAMAGE_TYPES.has(ofType)) return false;
    into.effects.push({
      kind: 'hit-point-maximum-decrease',
      by: 'damage-taken',
      ...(ofType === undefined ? {} : { ofType }),
      ...(maximum[2] === undefined ? {} : { sourceRegains: 'the-amount' as const }),
    });
    return true;
  }

  // A sentence about the condition above it, exactly as "After 1 minute, it
  // succeeds automatically" is — see {@link EFFECT_ENDS_ON_WAKING}.
  if (EFFECT_ENDS_ON_WAKING.test(words)) {
    return amendLastCondition(into.effects, (last) => alsoEndsOnWaking(last, last.condition));
  }

  const immune = IMMUNE_TO_THIS_LINE.exec(words);
  if (immune !== null) {
    const span = spanOf(immune[2]!);
    if (span === null || span.kind !== 'seconds') return false;
    into.effects.push({ kind: 'line-immunity', line: immune[1]!, seconds: span.seconds });
    return true;
  }

  // Under a ceiling and nowhere else — see {@link DROPS_TO_ZERO}.
  if (where.underACeiling && DROPS_TO_ZERO.test(words)) {
    into.effects.push({ kind: 'drops-to-zero' });
    return true;
  }

  const dies = DIES.exec(words);
  if (dies !== null) {
    const sign = dies[4] === undefined ? 1 : dies[4] === '+' ? 1 : -1;
    into.effects.push({
      kind: 'dies',
      ...(dies[1] === undefined
        ? {}
        : {
            sourceRegains: {
              dice: `${dies[2]}d${dies[3]}`,
              flat: dies[5] === undefined ? 0 : sign * Number(dies[5]),
              average: Number(dies[1]),
            },
          }),
    });
    return true;
  }

  if (REPEATS_AFTER.test(words) || REPEATS_BEFORE.test(words)) {
    // Onto the condition where there is one, and otherwise onto every mode and
    // penalty the failure hung with no lifetime yet — see `amendRepeatable`.
    return amendRepeatable(
      into.effects,
      (last) => ({ ...last, repeats: { at: 'end', of: 'target' } }),
      unlifetimed,
      (effect) => ({ ...effect, repeats: { at: 'end', of: 'target' } }),
    );
  }
  if (graded && REPEATS_NEXT_TURN.test(words)) {
    return amendLastCondition(into.effects, (last) => ({
      ...last,
      repeats: { at: 'end', of: 'target' },
    }));
  }
  // A span printed once underneath the clauses it is about, which amends them
  // rather than standing as a clause of its own — the shape "and repeats the
  // save…" and "After 1 minute…" below already have. A sentence that finishes
  // nothing finished nothing, and is refused.
  const lasting = LASTS_FOR.exec(words);
  if (lasting !== null) {
    const span = spanOf(lasting[1]!);
    if (span === null) return false;
    let finished = 0;
    for (let i = 0; i < into.effects.length; i += 1) {
      const effect = into.effects[i]!;
      if (!isLasting(effect) || lifetimed(effect)) continue;
      into.effects[i] = { ...effect, lasts: span };
      finished += 1;
    }
    return finished > 0;
  }

  const capped = CAPPED.exec(words);
  if (capped !== null) {
    const seconds = Number(capped[1]) * 60;
    return amendRepeatable(
      into.effects,
      (last) =>
        last.repeats === undefined
          ? null
          : { ...last, repeats: { ...last.repeats, capSeconds: seconds } },
      (effect) => effect.repeats !== undefined && effect.repeats.capSeconds === undefined,
      (effect) => ({ ...effect, repeats: { ...effect.repeats!, capSeconds: seconds } }),
    );
  }

  return false;
}

interface ReadSection {
  readonly damage: MonsterDamage | null;
  readonly plus: MonsterDamage | null;
  readonly effects: readonly PrintedSaveEffect[];
  readonly handedOver: readonly string[];
  /** Whether anything at all was read: a section that read nothing is one the engine cannot spend. */
  readonly readSomething: boolean;
}

/**
 * The two sentences a curse that is **only conditions** is printed in, read
 * together or not at all.
 *
 * SRD Lamia: "the target is cursed for 1 hour. Until the curse ends, the
 * target has the Charmed and Poisoned conditions." The curse is a name for a
 * span, and what it carries is two conditions — so it is those conditions for
 * that span and there is nothing else to model. Half of it is worse than
 * none: a span nothing hangs on is a rule with no effect, and conditions with
 * no span are a curse that never lifts.
 *
 * Null where the pair is not both there, which is what keeps a Mummy's rot and
 * an Incubus's kiss prose: their second sentence says something else, so the
 * first is carried whole.
 */
function readCurse(cursed: string, next: string | undefined): PrintedSaveEffect[] | null {
  const span = CURSED.exec(cursed);
  if (span === null || next === undefined) return null;
  const carries = UNTIL_CURSE_ENDS.exec(next.trim());
  if (carries === null) return null;
  const lasts = spanOf(span[1]!);
  if (lasts === null) return null;
  const effects: PrintedSaveEffect[] = [];
  for (const word of [carries[1], carries[2]]) {
    if (word === undefined) continue;
    const name = CONDITIONS[word];
    if (name === undefined) return null;
    effects.push({ kind: 'condition', condition: name, lasts });
  }
  return effects;
}

/**
 * SRD Bearded Devil's Infernal Glaive, sentence one: "The target receives an
 * infernal wound." SRD Horned Devil's Infernal Tail prints the gate here
 * instead of in the opening: "the target receives an infernal wound **if it
 * doesn't have one**."
 *
 * The gate is matched and dropped, because it is not a fact about this
 * sentence that a reader could vary: every line printing a wound prints it,
 * and what keeps it is the executor, which gives no creature a second wound.
 */
const RECEIVES_A_WOUND = new RegExp(
  `^[Tt]he target receives an infernal wound(?: if it doesn${APOSTROPHE}t have one)?$`,
);

/**
 * Sentence two: "While wounded, the target loses 5 (1d10) Hit Points at the
 * start of each of its turns."
 *
 * The amount is read like any other printed amount and the **type is not**,
 * because there is none: the book takes Hit Points away here without naming a
 * kind of damage, which is the one sentence in the corpus that does.
 */
const WOUND_LOSS =
  /^While wounded, the target loses (\d+) \((\d+d\d+)(?: \+ (\d+))?\) Hit Points at the start of each of its turns$/;

/**
 * Sentence three: "The wound closes after 1 minute, after a spell restores Hit
 * Points to the target, or after the target or a creature within 5 feet of it
 * takes an action to stanch the wound, doing so by succeeding on a DC 12
 * Wisdom (Medicine) check."
 *
 * Three endings in one sentence and all three are read, which is why the
 * pattern is long: a wound that closed on only two of them would run longer
 * than the book says, and one that dropped the check would be a rule a table
 * could not use.
 */
const WOUND_CLOSES = new RegExp(
  '^The wound closes after (\\d+) (minute|hour)s?, after a spell restores Hit Points to the target, ' +
    'or after the target or a creature within 5 feet of it takes an action to stanch the wound, ' +
    `doing so by succeeding on a DC (\\d+) ${ABILITY_WORD} \\(([A-Z][a-z]+)\\) check$`,
);

/**
 * The three sentences a wound is printed in, read together or not at all.
 *
 * {@link readCurse}'s shape over one more sentence, and for its reason: each
 * of the three is useless without the others. A wound with no loss costs
 * nothing, a loss with no ending runs for ever, and an ending with nothing to
 * end is a check against nothing. So all three are read or all three are
 * carried, and a homebrew line that prints two of them stays prose.
 */
function readWound(
  first: string,
  second: string | undefined,
  third: string | undefined,
): PrintedSaveEffect | null {
  if (!RECEIVES_A_WOUND.test(first)) return null;
  if (second === undefined || third === undefined) return null;
  const loss = WOUND_LOSS.exec(second.trim().replace(/\.$/, ''));
  if (loss === null) return null;
  const closes = WOUND_CLOSES.exec(third.trim().replace(/\.$/, ''));
  if (closes === null) return null;
  // Five captures: the span and its unit, then the DC, the ability and the
  // skill the parenthesis names.
  const ability = ABILITY_KEYS[closes[4]!];
  const seconds = Number(closes[1]) * (SPAN_SECONDS[closes[2]!] ?? 0);
  if (ability === undefined || seconds <= 0) return null;
  return {
    kind: 'wound',
    loss: {
      average: Number(loss[1]),
      dice: loss[2]!,
      flat: loss[3] === undefined ? 0 : Number(loss[3]),
    },
    closesAfterSeconds: seconds,
    stanch: { ability, skill: closes[5]!.toLowerCase(), dc: Number(closes[3]) },
  };
}

/**
 * The two sentences a Hit Point ceiling is printed in, read together or not at
 * all.
 *
 * SRD Sea Hag: "If the target has 20 Hit Points or fewer, it drops to 0 Hit
 * Points. Otherwise, the target takes 13 (3d8) Psychic damage." SRD Incubus
 * prints the same over an Unconscious and 4d8.
 *
 * Null where either half is missing or either half is a clause the grammar
 * does not know, and both halves are then carried as the sentences they are.
 * Half of it is worse than none in both directions: a ceiling with nothing
 * under it decides nothing, and the `Otherwise` damage standing alone is a
 * line that deals it to a creature the book took to 0 instead.
 *
 * **The `then` arm is read as its own scratch**, so a clause it does not know
 * refuses the branch rather than leaving a half-built one behind — the same
 * transaction every sentence in this reader is read under. Anything the arm
 * *carries* comes back with it, which is how the Incubus' early endings reach
 * `handedOver` while its printed hour is applied.
 */
function readBranch(
  first: string,
  next: string | undefined,
): { readonly effect: PrintedSaveEffect; readonly carried: readonly string[] } | null {
  const ceiling = IF_HIT_POINTS_AT_MOST.exec(first);
  if (ceiling === null || next === undefined) return null;
  const otherwise = OTHERWISE_TAKES.exec(next.trim().replace(/\.$/, ''));
  if (otherwise === null) return null;

  const hit = DAMAGE.exec(otherwise[1]!);
  if (hit === null) return null;
  // The whole of the `Otherwise` sentence is its damage: a tail after it would
  // be a rule this has no field for, so the pair is refused rather than read
  // down to the part that fits.
  if (hit[0].length !== otherwise[1]!.length) return null;
  const damage = damageOf(hit, 1);
  const plus = hit[7] === undefined ? undefined : damageOf(hit, 7);
  if (damage === null || plus === null) return null;

  const scratch: Scratch = { effects: [], carried: [] };
  if (!readClause(ceiling[2]!, scratch, { graded: false, underACeiling: true })) return null;
  // Typed back down to what a branch may hold, which is every clause but
  // another branch — `readClause` cannot produce one, and the schema is where
  // that is stated.
  const then = scratch.effects.filter((effect): effect is PrintedSaveClause => effect.kind !== 'branch');
  if (then.length !== scratch.effects.length || then.length === 0) return null;

  return {
    effect: {
      kind: 'branch',
      ifHitPointsAtMost: Number(ceiling[1]),
      then,
      otherwise: { damage, ...(plus === undefined ? {} : { plus }) },
    },
    carried: scratch.carried,
  };
}

/**
 * The clauses one section prints, read one sentence at a time.
 *
 * The first sentence may be damage, with an optional ", and <clause>" riding
 * on it; every later sentence is a clause on its own. A clause the grammar
 * does not know is carried in `handedOver` — the *unread* words only, so a
 * sentence whose damage was read hands over the rest of itself and not the
 * damage the engine dealt.
 *
 * @param seed the effects this section is read *against*, which is how the
 * margin rung of a graded failure says one more thing about the clause the
 * first rung imposed.
 */
function readSection(
  text: string,
  options: { readonly graded?: boolean; readonly seed?: readonly PrintedSaveEffect[] } = {},
): ReadSection {
  const graded = options.graded ?? false;
  const effects: PrintedSaveEffect[] = [...(options.seed ?? [])];
  const handedOver: string[] = [];
  let damage: MonsterDamage | null = null;
  let plus: MonsterDamage | null = null;
  let readSomething = false;

  const sentences = text
    .split(/(?<=\.)\s+(?=[A-Z])/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence !== '');

  // Indexed rather than `forEach`, because one rule spans two sentences: see
  // {@link readCurse}, which consumes the sentence after the one it is on.
  for (let index = 0; index < sentences.length; index += 1) {
    const sentence = sentences[index]!;
    let rest = sentence.replace(/\.$/, '');
    if (index === 0) {
      const hit = DAMAGE.exec(rest);
      if (hit !== null) {
        const first = damageOf(hit, 1);
        const second = hit[7] === undefined ? undefined : damageOf(hit, 7);
        if (first === null || second === null) {
          handedOver.push(sentence);
          continue;
        }
        damage = first;
        plus = second ?? null;
        readSomething = true;
        rest = rest.slice(hit[0].length).replace(/^,?\s*and\s+/, '').trim();
        if (rest === '') continue;
      }
    }

    // Before the curse and before the clause, because a branch is the one
    // sentence whose *first* word is a condition on the rest of it.
    const branched = readBranch(rest, sentences[index + 1]);
    if (branched !== null) {
      effects.push(branched.effect);
      handedOver.push(...branched.carried);
      readSomething = true;
      index += 1;
      continue;
    }

    const cursed = readCurse(rest, sentences[index + 1]);
    if (cursed !== null) {
      effects.push(...cursed);
      readSomething = true;
      index += 1;
      continue;
    }

    // The curse's shape over one more sentence: the wound, what it costs, and
    // the three ways it closes. Two sentences are eaten rather than one.
    const wound = readWound(rest, sentences[index + 1], sentences[index + 2]);
    if (wound !== null) {
      effects.push(wound);
      readSomething = true;
      index += 2;
      continue;
    }

    const scratch: Scratch = { effects: [...effects], carried: [] };
    if (readClause(rest, scratch, { ...PLAINLY, graded })) {
      effects.splice(0, effects.length, ...scratch.effects);
      handedOver.push(...scratch.carried);
      readSomething = true;
    } else {
      handedOver.push(`${rest}.`);
    }
  }

  return { damage, plus, effects, handedOver, readSomething };
}

/** Which of the book's headings a section was printed under. */
type SectionKind = 'failure' | 'first-failure' | 'second-failure' | 'by-margin' | 'success' | 'either';

const KINDS: Readonly<Record<string, SectionKind>> = {
  Failure: 'failure',
  'First Failure': 'first-failure',
  'Second Failure': 'second-failure',
  'Third Failure': 'second-failure',
  'Failure or Success': 'either',
  Success: 'success',
};

/**
 * Who the line catches, and the sentence the book prints after them.
 *
 * The opening's third capture is lazy, so where a block prints prose between
 * the targeting clause and its first rung the prose ends up inside it — SRD
 * Basilisk and SRD Medusa are the two blocks that do. No SRD targeting clause
 * contains a full stop, so the first sentence is the targets and everything
 * after it is a
 * sentence the reader carries: nothing here makes a creature save against its
 * own reflection.
 */
function headOf(head: string): { readonly targets: string; readonly carried: readonly string[] } {
  const split = /^(.+?)\.\s+(\S.*)$/.exec(head);
  if (split === null) return { targets: head, carried: [] };
  // The opening's own `\. ` ate the last full stop, so it is given back — the
  // rule every carried sentence in this reader follows.
  const carried = split[2]!.trim();
  return { targets: split[1]!, carried: [carried.endsWith('.') ? carried : `${carried}.`] };
}

/**
 * What the sentence before the opening said.
 *
 * Three answers and no fourth. A prelude the reader cannot place refuses the
 * line, exactly as it did when the opening's anchor refused it: half a rule is
 * nobody's, and "The bulette spends 5 feet of movement" is a cost the engine
 * would otherwise skip straight past.
 */
type Prelude =
  /** Nothing before the opening, which is every line the reader took before this. */
  | { readonly kind: 'none' }
  /** SRD's "The X explodes when it dies". */
  | { readonly kind: 'dies' }
  /** SRD Gibbering Mouther's definition of what it is to be babbling. */
  | { readonly kind: 'babbling' }
  /** SRD Rust Monster's "targets one nonmagical metal object … worn or carried by a creature". */
  | { readonly kind: 'names-an-object' };

function readPrelude(before: string): Prelude | null {
  const text = before.trim();
  if (text === '') return { kind: 'none' };
  if (EXPLODES_ON_DEATH.test(text)) return { kind: 'dies' };
  if (BABBLES_WHILE_NOT_INCAPACITATED.test(text)) return { kind: 'babbling' };
  if (TARGETS_AN_OBJECT.test(text)) return { kind: 'names-an-object' };
  return null;
}

/**
 * The **types** a targeting clause narrows itself to, where it narrows itself
 * to any.
 *
 * SRD Sea Hag: "any **Beast or Humanoid** that starts its turn…". The book's
 * own capitalised words, because `creature-type-declared` writes exactly that
 * vocabulary. "creature" is the ungated case and comes back empty; a word that
 * is neither is a gate this cannot evaluate, and a gate dropped in silence
 * would make the hag's aura catch a Construct.
 */
function typesOf(who: string): readonly string[] | null {
  if (who === 'creature') return [];
  const words = who.split(/ or |, /).map((word) => word.trim());
  if (words.some((word) => !/^[A-Z][a-z]+$/.test(word))) return null;
  return words;
}

/**
 * The aura a targeting clause describes, or null where it describes one this
 * cannot measure.
 *
 * The two riders the book prints are peeled off the end first, because each
 * ends in the creature's own noun and a single pattern would have had to guess
 * where the noun stopped. What is left is the clause proper, in the book's two
 * measurements: an Emanation from the creature's space, or a ruler between two
 * creatures.
 */
function readAuraTrigger(
  targets: string,
  prelude: Prelude,
): { readonly trigger: PrintedSaveTrigger; readonly types: readonly string[] } | null {
  let rest = targets;
  let onlyIf: PrintedAuraCondition | undefined;

  const sight = AURA_SIGHT.exec(rest);
  if (sight !== null) {
    onlyIf = 'can-see-holder';
    rest = sight[1]!;
  } else {
    const babbling = AURA_BABBLING.exec(rest);
    if (babbling !== null) {
      // "While it is babbling" is a reference, and a reference with no
      // antecedent names a gate that is not there.
      if (prelude.kind !== 'babbling') return null;
      onlyIf = 'holder-not-incapacitated';
      rest = babbling[1]!;
    }
  }

  const emanation = AURA_EMANATION.exec(rest);
  const radius = emanation === null ? AURA_RADIUS.exec(rest) : null;
  const match = emanation ?? radius;
  if (match === null) return null;

  const types = typesOf(match[1]!.trim());
  if (types === null) return null;

  return {
    trigger: {
      kind: 'starts-turn-within',
      feet: Number(match[2]),
      ...(emanation === null ? {} : { emanation: true as const }),
      ...(onlyIf === undefined ? {} : { onlyIf }),
    },
    types,
  };
}

/** What a `_Second Failure:_` turned out to say, before it is hung. */
interface Rung {
  /** The deepening itself, in the words `RepeatSave.onFailure` is written in. */
  readonly deepening: Deepening;
  /** The condition the rung named as the one replaced, where it named one. */
  readonly instead?: ConditionEffect['condition'];
  /** Sentences of the rung this reader does not model — carried, never dropped. */
  readonly carried: readonly string[];
}

type Deepening = NonNullable<NonNullable<ConditionEffect['repeats']>['onFailure']>;

/**
 * What one `_Second Failure:_` says, or null where it says something this
 * cannot hold.
 *
 * **Two spellings and the book prints both.** SRD Gorgon names the condition
 * it replaces — "The target has the Petrified condition **instead of** the
 * Restrained condition" — and nothing else; that phrase is one no clause in
 * the grammar can start on, so it is matched whole. Everything else the book
 * prints here is an ordinary sentence about a condition, so it is read the way
 * a failure clause is read anywhere else, against a scratch of its own: SRD
 * Brass Dragon Wyrmling's "The target has the Unconscious condition for 1
 * minute" and SRD Silver Dragon Wyrmling's "The target has the Paralyzed
 * condition, and it repeats the save at the end of each of its turns…" are
 * {@link HAS_CONDITION} and the two clauses that amend it.
 *
 * Held to exactly one condition and nothing else, because that is the whole of
 * what a deepening is: a second clause here would be a rule riding on the
 * deeper condition with nowhere to be written, and a turn-anchored span would
 * be the moment the repeat already fires on.
 */
function readRung(second: string): Rung | null {
  const text = second.trim();
  const named = SECOND_FAILURE.exec(text.replace(/\.$/, ''));
  if (named !== null) {
    const deeper = CONDITIONS[named[1]!];
    const shallow = CONDITIONS[named[2]!];
    if (deeper === undefined || shallow === undefined) return null;
    // SRD Cockatrice's "for 24 hours", which is the deepened condition's own
    // lifetime and the one field this heading may add. A span the reader
    // cannot measure refuses the rung rather than dropping it: a Petrified
    // that outlived its sentence is worse than a line left to the table.
    let lasts: PrintedSeconds | undefined;
    if (named[3] !== undefined) {
      const span = spanOf(named[3]);
      if (span === null || span.kind !== 'seconds') return null;
      lasts = span;
    }
    return {
      deepening: { condition: deeper, ...(lasts === undefined ? {} : { lasts }) },
      instead: shallow,
      carried: [],
    };
  }

  const read = readSection(text, { graded: true });
  if (!read.readSomething || read.damage !== null) return null;
  const [only] = read.effects;
  if (read.effects.length !== 1 || only === undefined || only.kind !== 'condition') return null;
  // Every field a `condition` clause can carry that a deepening has no room
  // for — a grapple's escape DC, a size gate, a condition it carries — is a
  // rule that would be dropped in silence, so its presence refuses the rung.
  if (
    only.escapeDc !== undefined ||
    only.ifNoLargerThan !== undefined ||
    only.implies !== undefined ||
    only.payout !== undefined
  ) {
    return null;
  }
  if (only.lasts !== undefined && only.lasts.kind !== 'seconds') return null;
  // **The pair of endings, narrowed to a flag.** A deepening is exactly one
  // condition, so a list naming any other is a sentence this has misread —
  // which no route here can produce, and refusing it costs nothing.
  const names = [...(only.endsOnDamage ?? []), ...(only.endsWhenWoken ?? [])];
  if (names.some((name) => name !== only.condition)) return null;
  return {
    deepening: {
      condition: only.condition,
      ...(only.lasts === undefined ? {} : { lasts: only.lasts }),
      ...(only.repeats === undefined ? {} : { repeats: only.repeats }),
      ...(only.endsOnDamage === undefined ? {} : { endsOnDamage: true as const }),
      ...(only.endsWhenWoken === undefined ? {} : { endsWhenWoken: true as const }),
    },
    carried: read.handedOver,
  };
}

/**
 * Hang the second rung of a graded failure on the first, or refuse the line.
 *
 * The rung is read onto the clause it replaces, which must be the one the
 * first rung told to repeat: the deeper condition lands under the same source,
 * the shallow one goes, and the timer that raised the save goes with it. A
 * rung that finds no such clause is a rule this vocabulary cannot hold, and a
 * graded failure read down to its first rung is a creature Restrained forever
 * — so it refuses the line rather than keeping half of it.
 */
function deepenBy(
  second: string,
  effects: readonly PrintedSaveEffect[],
): { readonly effects: PrintedSaveEffect[]; readonly carried: readonly string[] } | null {
  const rung = readRung(second);
  if (rung === null) return null;
  const amended = [...effects];
  const hung = amendCondition(
    amended,
    (effect) =>
      effect.repeats !== undefined &&
      (rung.instead === undefined || effect.condition === rung.instead),
    (last) => ({ ...last, repeats: { ...last.repeats!, onFailure: rung.deepening } }),
  );
  return hung ? { effects: amended, carried: rung.carried } : null;
}

/**
 * The save a line forces, or **null for everything else**.
 *
 * Null for a line that does not begin with the template, and for one whose
 * failure clause this reader cannot start on. A line read carries everything
 * it read and, in `handedOver`, everything it did not.
 *
 * **A graded failure is read or refused whole.** `_First Failure:_` is the
 * head of the tail exactly as `_Failure:_` is, and `_Second Failure:_` is a
 * sentence about the clause above it — so a second rung this cannot hang
 * refuses the line rather than leaving the first rung standing alone, which
 * would be a Restrained nothing ever lifts. The same for the margin rung:
 * `_Failure by 5 or More:_` is the same failure with one more thing riding on
 * it, and a rung that read nothing new is a rung nobody printed.
 */
export function parsePrintedSave(text: string): MonsterSave | null {
  const flat = text
    .replace(/\s*<br>\s*/g, ' ')
    .replace(/&emsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const opening = OPENING.exec(flat);
  if (opening === null) return null;
  const prelude = readPrelude(opening[1]!);
  if (prelude === null) return null;
  const ability = ABILITY_KEYS[opening[2]!];
  if (ability === undefined) return null;
  const tail = opening[5]!;

  const starts: { kind: SectionKind; margin: number; at: number; end: number }[] = [];
  SECTION.lastIndex = 0;
  for (let match = SECTION.exec(tail); match !== null; match = SECTION.exec(tail)) {
    const word = match[1]!;
    const byMargin = BY_MARGIN.exec(word);
    starts.push({
      kind: byMargin === null ? (KINDS[word] ?? 'failure') : 'by-margin',
      margin: byMargin === null ? 0 : Number(byMargin[1]),
      at: match.index,
      end: match.index + match[0].length,
    });
  }
  const sections = starts.map((start, index) => {
    const next = starts[index + 1];
    return { kind: start.kind, margin: start.margin, text: tail.slice(start.end, next?.at).trim() };
  });

  const failure = sections.find(
    (section) => section.kind === 'failure' || section.kind === 'first-failure',
  );
  if (failure === undefined) return null;
  // **A line is graded when it has a second rung**, whatever its first one is
  // printed under: the two Brass Dragon families write `_Failure:_` and then
  // `_Second Failure:_`, so reading the heading alone would leave their first
  // rung's one-shot repeat as a save the boundary raised for ever.
  const graded =
    failure.kind === 'first-failure' ||
    sections.some((section) => section.kind === 'second-failure');
  const read = readSection(failure.text, { graded });

  const head = headOf(opening[4]!);

  // **The moment, where a moment forces the save rather than a use.** The
  // trigger is a fact about *when* — the sentence before the opening, or the
  // targeting clause — so it is settled here, before the failure is judged:
  // whether a failure this reader can read nothing out of refuses the line
  // depends on the answer.
  const aura = STARTS_ITS_TURN.test(head.targets) ? readAuraTrigger(head.targets, prelude) : null;
  // A clause that says a turn is beginning and says it in words this cannot
  // measure is a moment the engine could never raise, and the line kept
  // without it would be an aura a caller *spends*.
  if (STARTS_ITS_TURN.test(head.targets) && aura === null) return null;
  // The two are never both printed, and one line saying both would be a
  // creature that explodes and haunts at once — refused rather than told
  // apart by which pattern ran first.
  if (aura !== null && prelude.kind === 'dies') return null;
  const trigger: PrintedSaveTrigger | null =
    aura !== null ? aura.trigger : prelude.kind === 'dies' ? { kind: 'dies' } : null;
  // A prelude that defined what babbling is, on a line whose targeting clause
  // never said "while it is babbling", is a sentence read and then dropped.
  if (
    prelude.kind === 'babbling' &&
    !(aura !== null && aura.trigger.kind === 'starts-turn-within' && aura.trigger.onlyIf === 'holder-not-incapacitated')
  ) {
    return null;
  }

  // **A failure the grammar reads nothing out of, kept only where a moment
  // forces the line.** The rule everywhere else in this file is that such a
  // line stays prose, because "a save the engine rolls and then does nothing
  // with is a die thrown for no reason" — and that rule holds exactly because
  // a *spendable* line has another door: `takeStatedAction` hands the sentence
  // to the table and a DM adjudicates it. A trait nobody spends has no such
  // door, so refusing it is not "the table does it by hand" but "the moment
  // never arrives at all". SRD Gibbering Mouther's d8 table is the one line
  // this admits: the save is rolled at the moment the book says it is, and the
  // table it cannot hold is handed over at the instant the save fails.
  if (!read.readSomething && trigger === null) return null;

  const handedOver = [...head.carried, ...read.handedOver];
  const either: PrintedSaveEffect[] = [];
  let onSuccessEffects: readonly PrintedSaveEffect[] = [];
  let onSuccess: 'half' | 'none' = 'none';
  let onFailure: readonly PrintedSaveEffect[] = read.effects;
  let onFailureBy: { readonly by: number; readonly effects: readonly PrintedSaveEffect[] } | null =
    null;

  for (const section of sections) {
    if (section.kind === 'success') {
      if (/^Half damage(?: only)?\.?$/.test(section.text)) onSuccess = 'half';
      else {
        // **A success may buy something, and exactly one sentence in the
        // corpus does.** SRD Ghost and SRD Mummy each print "The target is
        // immune to this <creature>'s <line> for 24 hours"; everything else
        // under this heading is "Half damage" or a rule this cannot hold, and
        // a section read in part is carried whole, which is the rule every
        // section in this file is read under.
        const bought = readSection(section.text);
        if (
          bought.readSomething &&
          bought.damage === null &&
          bought.handedOver.length === 0 &&
          bought.effects.length > 0
        ) {
          onSuccessEffects = bought.effects;
        } else handedOver.push(`_Success:_ ${section.text}`);
      }
    } else if (section.kind === 'either') {
      const more = readSection(section.text);
      // Damage in a "Failure or Success" section is a sentence nobody prints.
      if (more.damage !== null) handedOver.push(`_Failure or Success:_ ${section.text}`);
      else {
        either.push(...more.effects);
        handedOver.push(...more.handedOver.map((sentence) => `_Failure or Success:_ ${sentence}`));
      }
    } else if (section.kind === 'second-failure') {
      const deepened = deepenBy(section.text, onFailure);
      if (deepened === null) return null;
      onFailure = deepened.effects;
      // Under its own heading, as the margin rung's residue is: the Brass
      // Dragon's "This effect ends for the target if it takes damage…" reaching
      // a table with no antecedent names neither the condition it ends nor the
      // rung it was printed under.
      handedOver.push(...deepened.carried.map((sentence) => `_Second Failure:_ ${sentence}`));
    } else if (section.kind === 'by-margin') {
      // **A rung that imposes states the whole failure; a rung that names one
      // states an addition.** SRD Homunculus writes its deeper rung out in
      // full — "The target has the Poisoned condition **for 1 minute**" — and
      // SRD Pseudodragon writes only what is added to the rung above: "While
      // Poisoned, the target **also** has the Unconscious condition." Read
      // against the first rung's clauses, the homunculus's Poisoned lands
      // twice under one source with two different spans, which is a rule
      // nobody printed; read on its own, the pseudodragon's "While Poisoned"
      // has no host and reads nothing at all.
      //
      // So the rung is tried alone first and seeded only where that failed,
      // and the answer is the sentence's own grammar rather than a flag.
      // `MonsterSave.onFailureBy.effects` replaces the failure's list either
      // way, which is what makes the two readings interchangeable here.
      const alone = readSection(section.text);
      const deeper = alone.readSomething
        ? alone
        : readSection(section.text, { seed: read.effects });
      if (!deeper.readSomething || deeper.damage !== null) return null;
      onFailureBy = { by: section.margin, effects: deeper.effects };
      // Under its own heading, as the `_Failure or Success:_` branch does:
      // "which ends early if…" reaching a table with no antecedent names
      // neither the condition it is about nor the rung it was printed under.
      handedOver.push(
        ...deeper.handedOver.map(
          (sentence) => `_Failure by ${section.margin} or More:_ ${sentence}`,
        ),
      );
    }
  }

  // A first rung with no second is a graded failure half-read: the condition
  // would repeat its save and a failure would leave it exactly where it was.
  if (graded && onFailure === read.effects) return null;

  // **A clause that kills is gated or it is not read.** The ceiling is the
  // targeting clause's — "one living creature … that has 0 Hit Points" — and
  // a `dies` reaching a caller without it would be a DC 10 save that kills a
  // creature at full health, which is a rule nobody printed.
  const ceiling = TARGET_HIT_POINTS.exec(head.targets);
  const gate = (effects: readonly PrintedSaveEffect[]): readonly PrintedSaveEffect[] | null => {
    if (!effects.some((effect) => effect.kind === 'dies')) return effects;
    if (ceiling === null) return null;
    return effects.map((effect) =>
      effect.kind === 'dies'
        ? { ...effect, ifHitPointsAtMost: Number(ceiling[1]) }
        : effect,
    );
  };
  const gated = gate(onFailure);
  const gatedEither = gate(either);
  const gatedByMargin = onFailureBy === null ? [] : gate(onFailureBy.effects);
  if (gated === null || gatedEither === null || gatedByMargin === null) return null;
  onFailure = gated;
  if (onFailureBy !== null) onFailureBy = { by: onFailureBy.by, effects: gatedByMargin };

  // **A rule about a turn ends, or it is not read.** The two clauses that may
  // name either kind of lifetime must have ended up with one: a span the line
  // printed, or the condition instance the same failure created. One with
  // neither is a Reaction taken away for ever, which is the answer the mode
  // clause already refuses and the graded failure's second rung refuses too.
  const ends = (effects: readonly PrintedSaveEffect[]): boolean =>
    effects.every((effect) =>
      effect.kind === 'branch'
        ? ends(effect.then)
        : !isLasting(effect) || lifetimed(effect),
    );
  if (!ends(onFailure) || !ends(gatedEither) || !ends(gatedByMargin)) return null;

  // Half of no damage is nothing: a success clause that halves what the line
  // never dealt buys nothing, and saying `half` would be a rule nobody printed.
  if (read.damage === null) onSuccess = 'none';

  // **The second fact a targeting clause gives up**, after the Hit Point
  // ceiling above: SRD Vampire Spawn's "one creature within 5 feet that is
  // willing or that has the Grappled, Incapacitated, or Restrained condition".
  // Read here rather than in a clause because it is about who the line may be
  // forced on rather than about what the failure does. A word in the list this
  // reader does not know leaves the whole restriction unread and the clause
  // verbatim in `targets`, where it already was.
  // **And the third**: SRD Sprite's "(Celestials, Fiends, and Undead
  // automatically fail the save)" — the types for which no die is thrown. A
  // word in the list that is not a capitalised type leaves the whole
  // parenthesis unread and in `targets`, where it already was.
  const failing = AUTO_FAIL_TYPES.exec(head.targets);
  const autoFail =
    failing === null
      ? null
      : typesOf(
          failing[1]!
            .split(/,? and |, /)
            .map((word) => word.trim().replace(/s$/, ''))
            .join(' or '),
        );

  const restriction = TARGET_CONDITIONS.exec(head.targets);
  const restrictedTo: ConditionEffect['condition'][] = [];
  if (restriction !== null) {
    for (const word of restriction[2]!.split(/,? (?:or|and) |, /)) {
      const name = CONDITIONS[word.trim()];
      if (name === undefined) {
        restrictedTo.length = 0;
        break;
      }
      if (!restrictedTo.includes(name)) restrictedTo.push(name);
    }
  }

  return {
    ability,
    dc: Number(opening[3]),
    targets: head.targets,
    ...(trigger === null ? {} : { trigger }),
    ...(aura === null || aura.types.length === 0 ? {} : { onlyIfTargetType: [...aura.types] }),
    ...(NOT_ALREADY_AFFECTED.test(head.targets) ? { onlyIfNotAffected: true as const } : {}),
    ...(prelude.kind === 'names-an-object' ? { targetsObject: true as const } : {}),
    ...(autoFail === null ? {} : { autoFailTypes: [...autoFail] }),
    ...(read.damage === null ? {} : { damage: read.damage }),
    ...(read.plus === null ? {} : { plus: read.plus }),
    onSuccess,
    ...(onSuccessEffects.length === 0 ? {} : { onSuccessEffects: [...onSuccessEffects] }),
    ...(restrictedTo.length === 0
      ? {}
      : {
          onlyIfTargetHas: {
            conditions: restrictedTo,
            ...(restriction![1] === undefined ? {} : { orWilling: true as const }),
          },
        }),
    ...(onFailure.length === 0 ? {} : { onFailure: [...onFailure] }),
    ...(onFailureBy === null ? {} : { onFailureBy: { by: onFailureBy.by, effects: [...onFailureBy.effects] } }),
    ...(gatedEither.length === 0 ? {} : { either: [...gatedEither] }),
    ...(handedOver.length === 0 ? {} : { handedOver }),
  };
}

/**
 * SRD Cockatrice's Petrifying Bite: "_Hit:_ 3 (1d4 + 1) Piercing damage. **If
 * the target is a creature, it is subjected to the following effect.
 * _Constitution Saving Throw:_ DC 11. _First Failure:_ …**" SRD Homunculus
 * writes the opening as "and the target is subjected to the following effect."
 *
 * The book's own way of printing a saving throw **inside a hit's rider**, and
 * the whole of what is different about it is where the targeting clause sits:
 * a line that forces a save states who it catches inside the template — "DC
 * 13, one creature the spider can see within 60 feet" — and a rider states it
 * in front, because the creature the save catches is the one the attack just
 * hit.
 */
const RIDER_SAVE = new RegExp(
  `^(?:If the target is (a creature)(?: and doesn${APOSTROPHE}t already have an infernal wound)?, it` +
    '|[Aa]nd the target) is subjected to the following effect\\. ' +
    '_([A-Za-z]+) Saving Throw:_ DC (\\d+)\\. (_(?:First )?Failure:_ .*)$',
);

/**
 * The save a **hit's rider** forces, or null where the rider forces none.
 *
 * **One reader and not two.** Everything after the opening is the same grammar
 * `parsePrintedSave` reads — the failure's clauses, a graded second rung, a
 * margin rung, a `_Failure or Success:_` coda — so the rider's opening is
 * rewritten into the template's and handed to that function whole. A second
 * copy of the grammar here would be a second answer to "what does a Restrained
 * that repeats its save mean", free to disagree with the first.
 *
 * **The gate is read or the rider is not**, and there are two of them now. The
 * plain one is the book's "If the target is a creature", which is the clause
 * every printing of this shape uses — a creature and not an object. The second
 * is SRD Bearded Devil's "and doesn't already have an infernal wound", which
 * stayed prose for as long as nothing could keep it: it is the one-wound-per-
 * target rule, and a `wound` clause **is** that rule, so the gate is read only
 * where the failure it opens really imposes one. A rider whose gate says
 * anything else still comes back null and stays prose, because a gate dropped
 * in silence is a rule nobody printed.
 *
 * `targets` on the result is the plain gate in the book's own words, which is
 * what the field has always held: who the line catches. The wound's gate is
 * not there because it is not about who the line catches — it is about what
 * they already have, and the clause keeps it.
 */
export function parseRiderSave(rider: string): MonsterSave | null {
  const flat = rider.replace(/\s+/g, ' ').trim();
  const match = RIDER_SAVE.exec(flat);
  if (match === null) return null;
  const who = match[1] ?? 'the target';
  const save = parsePrintedSave(`_${match[2]!} Saving Throw:_ DC ${match[3]!}, ${who}. ${match[4]!}`);
  // The wound's gate was matched; if the failure beneath it turned out not to
  // impose a wound, the gate has nothing keeping it and the whole rider stays
  // prose rather than being read with a sentence of the book's silently gone.
  if (save !== null && WOUND_GATE.test(flat)) {
    const wounds = (save.onFailure ?? []).some((effect) => effect.kind === 'wound');
    if (!wounds) return null;
  }
  return save;
}

/** The half of {@link RIDER_SAVE}'s opening that only a wound may keep. */
const WOUND_GATE = new RegExp(`and doesn${APOSTROPHE}t already have an infernal wound`);
