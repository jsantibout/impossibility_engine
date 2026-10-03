/**
 * What a creature can say, and what it can understand — derived on every read.
 *
 * SRD Suggestion: "You suggest a course of activity … to one creature you can
 * see within range **that can hear and understand you**." Two facts the engine
 * already holds, read here once: a character's languages off its record
 * (`CreatureState.character`, through the same derivation creation wrote the
 * sheet with), and a stat block's off its Languages line (`StatedValues.speech`,
 * read by the parser). The owner's ruling sent both halves there. (E-L1)
 *
 * **Three answers, because the third is real.** A creature added with a bare
 * sheet has neither a record nor a line, and a block that prints "Common plus
 * one other language" leaves the other to its GM — so where the shared tongue
 * could only be one nobody has named, the answer is `unknown` and says why,
 * and the caller reports it rather than guessing either way.
 */

import type { CharacterId } from '@ie/shared';
import type { Content } from './content.js';
import { languagesOfRecord } from './creation.js';
import type { GameState } from './state.js';
import { hasCondition } from './conditions.js';
import { effectiveConditions } from './standing.js';

/** One creature's tongues, as far as anything the engine holds says. */
interface Tongues {
  /** What it can say, by language name. */
  readonly speaks: ReadonlySet<string>;
  /** What it can understand — everything it speaks, and more. */
  readonly understands: ReadonlySet<string>;
  /** "All". */
  readonly all: boolean;
  /** "plus N other languages" its GM fills in, and whether it speaks them. */
  readonly others: { readonly spoken: boolean } | null;
}

/** A creature's tongues, or null where nothing the engine holds says. */
function tonguesOf(state: GameState, content: Content, who: CharacterId): Tongues | null {
  const creature = state.creatures[who];
  if (creature === undefined) return null;
  if (creature.character !== null) {
    const known = languagesOfRecord(content, creature.character);
    if (known === null) return null;
    return { speaks: new Set(known), understands: new Set(known), all: false, others: null };
  }
  const speech = creature.sheet.stated?.speech;
  if (speech === undefined) return null;
  return {
    speaks: new Set(speech.speaks),
    understands: new Set([...speech.speaks, ...speech.understands]),
    all: speech.all === true,
    others: speech.others === undefined ? null : { spoken: speech.others.spoken },
  };
}

export type Understanding =
  | { readonly answer: 'yes' }
  | { readonly answer: 'no'; readonly code: 'cannot_hear' | 'does_not_understand'; readonly why: string }
  | { readonly answer: 'unknown'; readonly why: string };

/**
 * Whether `listener` can hear and understand `speaker`.
 *
 * Deafened is the hearing — read through `effectiveConditions`, so a Silence
 * the listener stands in is a Deafened listener. Understanding is a tongue
 * the speaker speaks and the listener understands: "All" on either side meets
 * any language at all on the other, and a listener that "doesn't comprehend
 * any language" (SRD "None") understands nothing. A shared tongue that could
 * only be one of the GM's "other languages" is `unknown`.
 */
export function hearsAndUnderstands(
  state: GameState,
  content: Content,
  speaker: CharacterId,
  listener: CharacterId,
): Understanding {
  if (listener === speaker) return { answer: 'yes' };
  if (hasCondition(effectiveConditions(state, listener), 'deafened')) {
    return { answer: 'no', code: 'cannot_hear', why: `${listener} has the Deafened condition and cannot hear ${speaker}` };
  }
  const voice = tonguesOf(state, content, speaker);
  const ear = tonguesOf(state, content, listener);
  if (voice === null || ear === null) {
    return {
      answer: 'unknown',
      why: `nothing the engine holds says what languages ${voice === null ? speaker : listener} knows — no character record and no Languages line`,
    };
  }
  const listens = ear.all || ear.understands.size > 0 || ear.others !== null;
  if (!listens) {
    return { answer: 'no', code: 'does_not_understand', why: `${listener} doesn't comprehend any language` };
  }
  if (ear.all && (voice.all || voice.speaks.size > 0 || voice.others?.spoken === true)) {
    return { answer: 'yes' };
  }
  if (voice.all) return { answer: 'yes' };
  for (const tongue of voice.speaks) if (ear.understands.has(tongue)) return { answer: 'yes' };
  if (voice.others?.spoken === true || ear.others !== null) {
    return {
      answer: 'unknown',
      why: `${speaker} and ${listener} share no language the engine can name, and the "other languages" their GM chooses could be one`,
    };
  }
  return {
    answer: 'no',
    code: 'does_not_understand',
    why: `${listener} understands ${[...ear.understands].join(', ')}, and ${speaker} speaks ${voice.speaks.size === 0 ? 'nothing' : [...voice.speaks].join(', ')}`,
  };
}
