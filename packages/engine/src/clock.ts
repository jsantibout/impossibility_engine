/**
 * Elapsed time, in seconds.
 *
 * The game measures duration in four units and they nest exactly: SRD, "A
 * round represents about 6 seconds in the game world", ten rounds to the
 * minute, sixty minutes to the hour. Seconds is the finest of them, so every
 * duration the rules name is a whole number of them and nothing ever lands
 * between two rounds.
 *
 * One clock, counting up from the start of the campaign. There is no calendar
 * and no time of day: those are fiction, and the DM owns them. What the engine
 * needs is the ability to answer "how long since", which is subtraction — the
 * sixteen hours between Long Rests, the hour that turns a broken Long Rest
 * into a Short one.
 */

/** SRD: "A round represents about 6 seconds in the game world." */
export const ROUND = 6;
export const MINUTE = 60;
export const HOUR = 3600;
export const DAY = 86_400;

function whole(n: number, unit: string): number {
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`a duration in ${unit} must be a non-negative integer, got ${n}`);
  }
  return n;
}

export const rounds = (n: number): number => whole(n, 'rounds') * ROUND;
export const minutes = (n: number): number => whole(n, 'minutes') * MINUTE;
export const hours = (n: number): number => whole(n, 'hours') * HOUR;
export const days = (n: number): number => whole(n, 'days') * DAY;

const plural = (n: number, unit: string): string => `${n} ${unit}${n === 1 ? '' : 's'}`;

/**
 * Say a span in the largest unit it fills exactly, for the log.
 *
 * Deliberately coarse: a DM says "about an hour", never "3,600 seconds", and
 * a span that does not divide evenly reports the unit below it rather than
 * inventing a fraction the game has no notion of.
 */
export function describeElapsed(seconds: number): string {
  if (seconds <= 0) return 'no time';
  if (seconds % DAY === 0) return plural(seconds / DAY, 'day');
  if (seconds % HOUR === 0) return plural(seconds / HOUR, 'hour');
  if (seconds % MINUTE === 0) return plural(seconds / MINUTE, 'minute');
  if (seconds % ROUND === 0) return plural(seconds / ROUND, 'round');
  return plural(seconds, 'second');
}
