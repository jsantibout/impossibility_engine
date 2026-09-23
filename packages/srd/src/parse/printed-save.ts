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
 * Three families are refused whole rather than read down to the part that
 * fits, because half of each is a rule nobody printed: a graded or repeated
 * failure (`_First Failure:_`, `_Failure by 5 or More:_`), a trigger or a
 * movement printed before the save ("The mephit explodes when it dies", "The
 * bulette spends 5 feet of movement"), and a damage type the block leaves to
 * another trait. Each sentence is read **transactionally**: one whose second
 * half the grammar does not know is carried whole, never half-applied.
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

/** The opening every line this reads begins with: the ability, the DC and who it catches. */
const OPENING = /^_([A-Za-z]+) Saving Throw:_ DC (\d+), (.+?)\. (_Failure:_ .*)$/;

/** The section markers the book prints after the opening. */
const SECTION = /_(Failure|Success|Failure or Success):_\s*/g;

/** A marker this reader refuses whole: a graded or repeated failure is another shape. */
const REFUSED_MARKER = /_(?:First|Second|Third) Failure:_|_Failure by \d+ or More:_/;

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
const REPEATS_BEFORE =
  /^At the end of each of its turns, the target repeats the save, ending the effect on itself on a success$/;
const CAPPED = /^After (\d+) minutes?, it succeeds automatically$/;

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

/** Replace the last condition in the list with a re-reading of it, or fail where there is none. */
function amendLastCondition(
  into: PrintedSaveEffect[],
  amend: (last: ConditionEffect) => ConditionEffect | null,
): boolean {
  for (let i = into.length - 1; i >= 0; i -= 1) {
    const effect = into[i]!;
    if (effect.kind !== 'condition') continue;
    const amended = amend(effect);
    if (amended === null) return false;
    into[i] = amended;
    return true;
  }
  return false;
}

/**
 * Read one clause **into** the list, or return false where the words are not
 * a clause this knows.
 *
 * The list is the caller's scratch copy: a sentence is read against a copy and
 * committed only when every clause in it was read, so nothing is half-applied.
 * Two sentences say something about the condition before them — "and repeats
 * the save…", "After 1 minute, it succeeds automatically." — and amend it in
 * place.
 */
function readClause(clause: string, into: PrintedSaveEffect[]): boolean {
  const words = clause.replace(/\.$/, '').trim();
  if (words === '') return true;

  const gated = SIZE_GATED.exec(words);
  if (gated !== null) {
    const size = SIZES[gated[1]!];
    if (size === undefined) return false;
    const before = into.length;
    if (!readClause(gated[2]!, into)) return false;
    for (let i = before; i < into.length; i += 1) {
      const effect = into[i]!;
      if (effect.kind === 'condition') into[i] = { ...effect, ifNoLargerThan: size };
    }
    return true;
  }

  const condition = HAS_CONDITION.exec(words);
  if (condition !== null) {
    const name = CONDITIONS[condition[1]!];
    if (name === undefined) return false;
    const span = condition[3] === undefined ? null : spanOf(condition[3]);
    if (condition[3] !== undefined && span === null) return false;
    into.push({
      kind: 'condition',
      condition: name,
      ...(span === null ? {} : { lasts: span }),
      ...(condition[2] === undefined ? {} : { escapeDc: Number(condition[2]) }),
    });
    return condition[4] === undefined ? true : readClause(condition[4], into);
  }

  const pushed = PUSHED.exec(words);
  if (pushed !== null) {
    into.push({ kind: 'push', feet: Number(pushed[1]) });
    return pushed[2] === undefined ? true : readClause(pushed[2], into);
  }

  const speed = SPEED_CUT.exec(words);
  if (speed !== null) {
    const span = spanOf(speed[2]!);
    if (span === null) return false;
    into.push({ kind: 'speed-decrease', feet: Number(speed[1]), lasts: span });
    return true;
  }

  if (HP_MAX_CUT.test(words)) {
    into.push({ kind: 'hit-point-maximum-decrease', by: 'damage-taken' });
    return true;
  }

  if (REPEATS_AFTER.test(words) || REPEATS_BEFORE.test(words)) {
    return amendLastCondition(into, (last) => ({ ...last, repeats: { at: 'end', of: 'target' } }));
  }
  const capped = CAPPED.exec(words);
  if (capped !== null) {
    return amendLastCondition(into, (last) =>
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
 * The clauses one section prints, read one sentence at a time.
 *
 * The first sentence may be damage, with an optional ", and <clause>" riding
 * on it; every later sentence is a clause on its own. A clause the grammar
 * does not know is carried in `handedOver` — the *unread* words only, so a
 * sentence whose damage was read hands over the rest of itself and not the
 * damage the engine dealt.
 */
function readSection(text: string): ReadSection {
  const effects: PrintedSaveEffect[] = [];
  const handedOver: string[] = [];
  let damage: MonsterDamage | null = null;
  let plus: MonsterDamage | null = null;
  let readSomething = false;

  const sentences = text
    .split(/(?<=\.)\s+(?=[A-Z])/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence !== '');

  sentences.forEach((sentence, index) => {
    let rest = sentence.replace(/\.$/, '');
    if (index === 0) {
      const hit = DAMAGE.exec(rest);
      if (hit !== null) {
        const first = damageOf(hit, 1);
        const second = hit[7] === undefined ? undefined : damageOf(hit, 7);
        if (first === null || second === null) {
          handedOver.push(sentence);
          return;
        }
        damage = first;
        plus = second ?? null;
        readSomething = true;
        rest = rest.slice(hit[0].length).replace(/^,?\s*and\s+/, '').trim();
        if (rest === '') return;
      }
    }
    const scratch = [...effects];
    if (readClause(rest, scratch)) {
      effects.splice(0, effects.length, ...scratch);
      readSomething = true;
    } else {
      handedOver.push(`${rest}.`);
    }
  });

  return { damage, plus, effects, handedOver, readSomething };
}

/**
 * The save a line forces, or **null for everything else**.
 *
 * Null for a line that does not begin with the template, for one that prints a
 * graded or repeated failure, and for one whose failure clause this reader
 * cannot start on. A line read carries everything it read and, in
 * `handedOver`, everything it did not.
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
  if (REFUSED_MARKER.test(tail)) return null;

  const starts: { kind: 'failure' | 'success' | 'either'; at: number; end: number }[] = [];
  SECTION.lastIndex = 0;
  for (let match = SECTION.exec(tail); match !== null; match = SECTION.exec(tail)) {
    const word = match[1]!;
    starts.push({
      kind: word === 'Failure' ? 'failure' : word === 'Success' ? 'success' : 'either',
      at: match.index,
      end: match.index + match[0].length,
    });
  }
  const sections = starts.map((start, index) => {
    const next = starts[index + 1];
    return { kind: start.kind, text: tail.slice(start.end, next?.at).trim() };
  });

  const failure = sections.find((section) => section.kind === 'failure');
  if (failure === undefined) return null;
  const read = readSection(failure.text);
  if (!read.readSomething) return null;

  const handedOver = [...read.handedOver];
  const either: PrintedSaveEffect[] = [];
  let onSuccess: 'half' | 'none' = 'none';

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
    }
  }

  // Half of no damage is nothing: a success clause that halves what the line
  // never dealt buys nothing, and saying `half` would be a rule nobody printed.
  if (read.damage === null) onSuccess = 'none';

  return {
    ability,
    dc: Number(opening[2]),
    targets: opening[3]!,
    ...(read.damage === null ? {} : { damage: read.damage }),
    ...(read.plus === null ? {} : { plus: read.plus }),
    onSuccess,
    ...(read.effects.length === 0 ? {} : { onFailure: [...read.effects] }),
    ...(either.length === 0 ? {} : { either }),
    ...(handedOver.length === 0 ? {} : { handedOver }),
  };
}
