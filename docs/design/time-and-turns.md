# Time: durations, turn boundaries, rests

Read before changing `duration.ts`, `clock.ts`, `rest.ts`,
`commands/turns.ts`, `fold/timers.ts`, `fold/expiry.ts` or
`fold/upkeep.ts`.

## Two kinds of "how long"

The clock counts seconds since the campaign began; a combat round costs six.
A `Duration` is one of two different things and the engine never folds one
into the other:

- **a span** — `forSeconds(n)`: expires when the clock passes a deadline;
- **a moment in the turn order** — start or end of somebody's next turn, or
  the end of the current turn: has a meaning only inside an Initiative order,
  and depends on whose turn the effect began.

`resolveDuration` converts a relative duration to an absolute `Deadline` and
**refuses** a turn-anchored one it cannot pin; a command turns that refusal
into a `needs-context` request naming `beginCombat` (no order) or
`rollInitiativeFor` then `joinCombat` (the anchor has no place in the order).
Quietly calling "until the end of your next turn" six seconds is the one
mistake this split exists to prevent.

## Timers and expiry

Every timed effect is a `TimedEffect` in `state.timers`, keyed by effect
instance and targeting a condition, a bonus, a grant or a casting. Expiry is
a derived pass in the fold: when the clock or the turn order passes a
deadline, the effect is released through the same door a spell ending uses.
A repeat save is a debt the turn boundary raises (`pendingSaves`) and the
engine rolls (`resolvePendingSaves`); a scheduled later hit
(`scheduledDamage`) is collected the same way. Nothing waits on a caller
remembering.

## Turn boundaries

`resolveTurn` refuses to advance while any debt is open, then moves the
order and raises whatever the new boundary owes: repeat saves, area
triggers, delayed damage, casting completions. Once-per-turn caps and
"first time each turn" clauses are stamped on the record they belong to.

## Rests

A Short Rest is an hour; a Long Rest eight, with a sixteen-hour cooldown.
`beginRest` and `endRest` bracket one, so an interruption the engine can see
(damage, a fight starting) collapses a Long Rest into a Short one honestly.
Pools restore by their `Recovery` tag; a pool may regain a stated number on a
Short Rest without refilling (`regainsOnShortRest`). Hit Dice are pools keyed
by die type, so multiclassed characters track theirs separately.
