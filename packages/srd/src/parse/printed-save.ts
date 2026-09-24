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
 * rung standing alone is a Restrained nothing ever lifts. **That is the test
 * the two dragon wyrmlings fail and the Pseudodragon passes**, and the
 * difference is an ending rather than a wording: SRD Brass Dragon Wyrmling
 * deepens into an Unconscious "for 1 minute" and SRD Silver Dragon Wyrmling
 * into a Paralyzed that repeats its own save, and `RepeatSave.onFailure` is a
 * bare condition name — so the deeper rung would stand for ever. SRD
 * Pseudodragon's `_Failure by 5 or More:_` is the same failure with one more
 * thing riding on the condition it already imposed, so its Unconscious lifts
 * with the Poisoned that carries it, at the printed hour; what is missing is
 * only the *early* endings, and those are carried rather than dropped. An
 * effect that would never end is refused; one that ends later than the book
 * says is applied and the difference is handed to the table.
 */

import type { MonsterDamage, MonsterSave, PrintedSaveEffect, PrintedSpan } from '../schemas.js';

type ConditionEffect = Extract<PrintedSaveEffect, { kind: 'condition' }>;

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
 * The whole of what a `_Second Failure:_` may say. A rung that says anything
 * else — a span, a repeat of its own, a second effect — refuses the line, and
 * the two dragon wyrmlings that print one are why: see
 * `PrintedSaveEffectSchema`'s `repeats.onFailure`.
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
const REPEATS_AFTER =
  /^(?:and )?repeats the save at the end of each of its turns, ending the effect on itself on a success$/;
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
const TARGET_HIT_POINTS = /\bthat has (\d+) Hit Points?\b/;

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
 * Read one clause **into** the scratch, or return false where the words are
 * not a clause this knows.
 *
 * Several sentences say something about a clause already read — "and repeats
 * the save…", "After 1 minute, it succeeds automatically.", "While Poisoned,
 * the target has the Paralyzed condition." — and amend it in place.
 *
 * @param graded whether this section is one rung of a graded failure, which is
 * the one thing that changes what a clause may say: see
 * {@link REPEATS_NEXT_TURN}.
 */
function readClause(clause: string, into: Scratch, graded: boolean): boolean {
  const words = clause.replace(/\.$/, '').trim();
  if (words === '') return true;

  const gated = SIZE_GATED.exec(words);
  if (gated !== null) {
    const size = SIZES[gated[1]!];
    if (size === undefined) return false;
    const before = into.effects.length;
    if (!readClause(gated[2]!, into, graded)) return false;
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
    if (whileSo[3] !== undefined) into.carried.push(`${whileSo[3]}.`);
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
    return condition[4] === undefined ? true : readClause(condition[4], into, graded);
  }

  const pushed = PUSHED.exec(words);
  if (pushed !== null) {
    into.effects.push({ kind: 'push', feet: Number(pushed[1]) });
    return pushed[2] === undefined ? true : readClause(pushed[2], into, graded);
  }

  const speed = SPEED_CUT.exec(words);
  if (speed !== null) {
    const span = spanOf(speed[2]!);
    if (span === null) return false;
    into.effects.push({ kind: 'speed-decrease', feet: Number(speed[1]), lasts: span });
    return true;
  }

  if (HP_MAX_CUT.test(words)) {
    into.effects.push({ kind: 'hit-point-maximum-decrease', by: 'damage-taken' });
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

    const cursed = readCurse(rest, sentences[index + 1]);
    if (cursed !== null) {
      effects.push(...cursed);
      readSomething = true;
      index += 1;
      continue;
    }

    const scratch: Scratch = { effects: [...effects], carried: [] };
    if (readClause(rest, scratch, graded)) {
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
 * Hang the second rung of a graded failure on the first, or refuse the line.
 *
 * SRD Gorgon's `_Second Failure:_` says exactly one thing — "The target has
 * the Petrified condition **instead of** the Restrained condition" — and the
 * engine's `RepeatSave.onFailure` says exactly that: the deeper condition
 * lands under the same source and the shallow one goes. So the rung is read
 * onto the clause it replaces, which must be the one the first rung told to
 * repeat; anything else is a rule this vocabulary cannot hold, and a graded
 * failure read down to its first rung is a creature Restrained forever.
 */
function deepenBy(second: string, effects: readonly PrintedSaveEffect[]): PrintedSaveEffect[] | null {
  const rung = SECOND_FAILURE.exec(second.replace(/\.$/, '').trim());
  if (rung === null) return null;
  const deeper = CONDITIONS[rung[1]!];
  const shallow = CONDITIONS[rung[2]!];
  if (deeper === undefined || shallow === undefined) return null;
  const amended = [...effects];
  const hung = amendCondition(
    amended,
    (effect) => effect.condition === shallow && effect.repeats !== undefined,
    (last) => ({ ...last, repeats: { ...last.repeats!, onFailure: { condition: deeper } } }),
  );
  return hung ? amended : null;
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
  const graded = failure.kind === 'first-failure';
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
      onFailure = deepened;
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
