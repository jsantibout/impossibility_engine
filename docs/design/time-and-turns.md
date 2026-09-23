# Time: durations, turn boundaries, rests

Read before changing `time.ts`, `timers.ts`, `rest.ts`,
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

A deadline is hung on an `EffectTarget`: a condition, a bonus, a grant, a
casting, or a creature's Temporary Hit Points. A rule about what a creature
may do is a grant like the others, so a spell that forbids an Action expires
through the same machinery and needs none of its own. The last takes no source,
because Temporary Hit Points do not stack and a creature holds exactly one
pool, so the creature is the whole of the identity and two deadlines can
never stand over one pool.

`resolveDuration` converts a relative duration to an absolute `Deadline` and
**refuses** a turn-anchored one it cannot pin; a command turns that refusal
into a `needs-context` request naming `beginCombat` (no order) or
`rollInitiativeFor` then `joinCombat` (the anchor has no place in the order).
Quietly calling "until the end of your next turn" six seconds is the one
mistake this split exists to prevent.

An activated feature hangs one of the two, and its grant says which: SRD Rage
runs to a moment (`lasts`), pushed out round by round; SRD Innate Sorcery,
Stonecunning, Large Form and Draconic Flight run for a span the book prints
(`lastsSeconds`), scheduled on the clock in and out of a fight and never
maintained. `ActivationSpan` in `standing.ts` is the pair.

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

The vocabulary is `time.ts`'s: a `TurnMoment` is the start or the end of a
turn, and `TurnAnchor` is the turn-anchored subset of `Duration`. Nothing
spells either pair inline; `time-vocabulary.test.ts` fails on a file that
does.

### The boundary, in order

One `turn-advanced` carries two moments a round apart, and the end is
finished before the start is raised, because what catches a creature as its
turn begins is a question about the world the previous end left behind.

1. `resolveTurn` refuses while any debt stands: a held move, attack, damage
   or test, a declared casting, an owed repeat save, a stranded summons, an
   owed area effect.
2. It emits `turn-advanced`. The fold (`fold/combat.ts`) advances the order:
   the finisher's `ended` and the next creature's `begun` count up, and a
   round that wraps charges the clock six seconds through `withCombat`.
3. Still in the fold, the end is raised (`fold/turns.ts`): repeat saves owed
   at the finisher's end, its end-of-turn area effects, a long casting the
   finisher did not sustain fails, and the start is marked pending.
4. The derived passes run: deadlines that have passed expire, orphaned debts
   drop. `reachStartOfTurn` waits while the end still owes anything.
5. Back in the command, the end is settled in a fixed order: due scheduled
   damage first, because it can break a Concentration; then area effects;
   then payouts; then the death save, last so a start-of-turn heal can
   matter; then the repeat saves. Each settlement is an event and folds.
6. When the end owes nothing, the fold reaches the start: the next
   creature's start-of-turn area effects are raised, and `mayAct` refuses
   that creature until they are settled.
7. The start is settled too, and **this is the step that throws dice**: a
   printed line the creature expended and whose recharge is a die gets one
   `1d6`, rolled with provenance like any other, and comes back on the printed
   number or better. `recharge_owed` refuses where there is no generator, the
   fourth member of the family `payout_owed`, `damage_owed` and
   `death_save_owed` already belong to.

A fight opening is the same moment by a second door: `combat-started`
marks the first combatant's start pending, step 6 reaches it, and **step 7
runs there too** — so the door that opens a fight throws dice, which it did
not before recharge was enforced.

## Rests

A Short Rest is an hour; a Long Rest eight, with a sixteen-hour cooldown.
`beginRest` and `endRest` bracket one, so an interruption the engine can see
(damage, a fight starting) collapses a Long Rest into a Short one honestly.
Pools restore by their `Recovery` tag; a pool may regain a stated number on a
Short Rest without refilling (`regainsOnShortRest`). **A rest also clears every
expended printed line**, whichever way it recharges: the book recharges a die
line at a rest as well as on the turn roll (`packages/srd/raw/monsters.md:431`),
and a line printed "Recharge after a Short or Long Rest" has no die and comes
back only here. Hit Dice are pools keyed
by die type, so multiclassed characters track theirs separately.
