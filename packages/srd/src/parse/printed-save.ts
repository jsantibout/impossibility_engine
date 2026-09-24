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
 * Two families are refused whole rather than read down to the part that fits,
 * because half of each is a rule nobody printed: a trigger or a movement
 * printed before the save ("The mephit explodes when it dies", "The bulette
 * spends 5 feet of movement"), and a damage type the block leaves to another
 * trait. Each sentence is read **transactionally**: one whose second half the
 * grammar does not know is carried whole, never half-applied.
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

import type {
  MonsterDamage,
  MonsterSave,
  PrintedSaveClause,
  PrintedSaveEffect,
  PrintedSpan,
} from '../schemas.js';

type ConditionEffect = Extract<PrintedSaveEffect, { kind: 'condition' }>;
type RollModeEffect = Extract<PrintedSaveEffect, { kind: 'roll-mode' }>;
/**
 * The two clauses that carry a lifetime of **either** kind, and must carry one.
 *
 * A span the line printed, or the condition instance the same failure created.
 * Every other clause here answers the question in its own shape: a `condition`
 * with no span is a condition for the encounter, a `roll-mode` has no span to
 * give, a push and a death are over the moment they happen. These two are the
 * pair the book prints both ways — the Dretch's on a condition, the Copper
 * Dragon's under a span — and a clause that ended up with neither would be a
 * rule nothing could ever lift, which the reader refuses whole.
 */
type LastingEffect = Extract<PrintedSaveEffect, { kind: 'action-rule' | 'speed-halved' }>;
const isLasting = (effect: PrintedSaveEffect): effect is LastingEffect =>
  effect.kind === 'action-rule' || effect.kind === 'speed-halved';
/** Whether a clause that must name a lifetime has named one. */
const lifetimed = (effect: LastingEffect): boolean =>
  effect.lasts !== undefined || effect.whileCondition !== undefined;

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
 */
const OPENING = /^_([A-Za-z]+) Saving Throw:_ DC (\d+), (.+?)\. (_(?:First )?Failure:_ .*)$/;

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
 */
const SECOND_FAILURE =
  /^The target has the ([A-Z][a-z]+) condition instead of the ([A-Z][a-z]+) condition$/;

/** `17 (5d6) Fire damage`, `16 (2d10 + 5) Bludgeoning damage`, with an optional second component after `plus`. */
const DAMAGE =
  /^(\d+) \((\d+)d(\d+)(?:\s*([+−–-])\s*(\d+))?\) ([A-Za-z]+) damage(?: plus (\d+) \((\d+)d(\d+)(?:\s*([+−–-])\s*(\d+))?\) ([A-Za-z]+) damage)?/;

/** "until the start of its next turn", "until the end of the mephit's next turn". */
const UNTIL_TURN = /^until the (start|end) of (its|the [a-z'-]+(?: [a-z'-]+)*'s) next turn$/;
/** "for 1 hour", "for 10 minutes". */
const FOR_SPAN = /^for (\d+) (hour|minute)s?$/;
const SPAN_SECONDS: Readonly<Record<string, number>> = { hour: 3600, minute: 60 };

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
const HP_MAX_CUT =
  /^[Tt]he target's Hit Point maximum decreases by an amount equal to the damage taken$/;
/**
 * "repeats the save at the end of each of its turns, ending the effect on
 * itself on a success" — a standing obligation, wherever the condition it is
 * about was printed.
 *
 * The subject is optional twice over, because the book writes this clause both
 * as a continuation of the sentence before it ("…, and repeats the save…") and
 * with its own pronoun: SRD Silver Dragon Wyrmling's second rung is "The
 * target has the Paralyzed condition, **and it** repeats the save at the end
 * of each of its turns".
 */
const REPEATS_AFTER =
  /^(?:and )?(?:it )?repeats the save at the end of each of its turns, ending the effect on itself on a success$/;
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
 */
const REPEATS_NEXT_TURN =
  /^(?:and )?repeats the save at the end of its next turn(?: if it is still [A-Z][a-z]+)?, ending the effect on itself on a success$/;
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
  const type = match[offset + 5]!.toLowerCase();
  if (!DAMAGE_TYPES.has(type)) return null;
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
    const amended = amendCondition(
      into.effects,
      (effect) => effect.condition === host,
      (last) => alsoImplies(last, name),
    );
    if (!amended) return false;
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
    into.effects.push({ kind: 'condition', condition: name, lasts: span });
    // Carried with the noun the book's own clause hangs on, which is the rule
    // `WHILE_CONDITION` follows above: a table handed "until it takes damage"
    // bare could not tell which condition it ends.
    into.carried.push(`The ${ending[1]} condition ends early: ${ending[3]}.`);
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

  if (HP_MAX_CUT.test(words)) {
    into.effects.push({ kind: 'hit-point-maximum-decrease', by: 'damage-taken' });
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
    return amendLastCondition(into.effects, (last) => ({
      ...last,
      repeats: { at: 'end', of: 'target' },
    }));
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
    return amendLastCondition(into.effects, (last) =>
      last.repeats === undefined
        ? null
        : { ...last, repeats: { ...last.repeats, capSeconds: Number(capped[1]) * 60 } },
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
    return { deepening: { condition: deeper }, instead: shallow, carried: [] };
  }

  const read = readSection(text, { graded: true });
  if (!read.readSomething || read.damage !== null) return null;
  const [only] = read.effects;
  if (read.effects.length !== 1 || only === undefined || only.kind !== 'condition') return null;
  // Every field a `condition` clause can carry that a deepening has no room
  // for — a grapple's escape DC, a size gate, a condition it carries — is a
  // rule that would be dropped in silence, so its presence refuses the rung.
  if (only.escapeDc !== undefined || only.ifNoLargerThan !== undefined || only.implies !== undefined) {
    return null;
  }
  if (only.lasts !== undefined && only.lasts.kind !== 'seconds') return null;
  return {
    deepening: {
      condition: only.condition,
      ...(only.lasts === undefined ? {} : { lasts: only.lasts }),
      ...(only.repeats === undefined ? {} : { repeats: only.repeats }),
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
  const ability = ABILITY_KEYS[opening[1]!];
  if (ability === undefined) return null;
  const tail = opening[4]!;

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
  if (!read.readSomething) return null;

  const head = headOf(opening[3]!);
  const handedOver = [...head.carried, ...read.handedOver];
  const either: PrintedSaveEffect[] = [];
  let onSuccess: 'half' | 'none' = 'none';
  let onFailure: readonly PrintedSaveEffect[] = read.effects;
  let onFailureBy: { readonly by: number; readonly effects: readonly PrintedSaveEffect[] } | null =
    null;

  for (const section of sections) {
    if (section.kind === 'success') {
      if (/^Half damage(?: only)?\.?$/.test(section.text)) onSuccess = 'half';
      else handedOver.push(`_Success:_ ${section.text}`);
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
      // The same failure with one more thing said about it, so the rung is
      // read **against** what the first one imposed: "While Poisoned, the
      // target also has…" names a clause that is already there.
      const deeper = readSection(section.text, { seed: read.effects });
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

  return {
    ability,
    dc: Number(opening[2]),
    targets: head.targets,
    ...(read.damage === null ? {} : { damage: read.damage }),
    ...(read.plus === null ? {} : { plus: read.plus }),
    onSuccess,
    ...(onFailure.length === 0 ? {} : { onFailure: [...onFailure] }),
    ...(onFailureBy === null ? {} : { onFailureBy: { by: onFailureBy.by, effects: [...onFailureBy.effects] } }),
    ...(gatedEither.length === 0 ? {} : { either: [...gatedEither] }),
    ...(handedOver.length === 0 ? {} : { handedOver }),
  };
}
