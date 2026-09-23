# The event log and the fold

Read before changing `events.ts`, `state.ts`, anything under `fold/`, or
`conditions.ts`.

## The contract

`GameState` is `fold(seed, events)`: a reduce over the `GameEvent` union from
`initialState(seed)`. Nothing else writes state. The same seed and log fold
to a byte-identical state, which is what makes a campaign replayable and
testable; `scenario.test.ts` and the two frozen fixtures hold it.

Events record **resolved history**, never intent: the number rolled, the
damage dealt, the casting settled. Replay never rerolls. A command validates
first, rolls second, and emits last; a refused command emits nothing.

## The fold

`fold/apply.ts` routes each event to the seam that owns the region of state
it writes (`roster`, `vitals`, `casting`, `ongoing`, `timers`, `combat`,
`scene`, `features`, `holds`, `inventory`, `grants`, `rolls`, `upkeep`),
then runs the derived passes: Concentration lost to Incapacitation, features
whose conditions stop holding, effects expiring, readied actions lapsing,
orphaned debts dropping, castings ended by a trigger. Those passes are rules,
deliberately eventless: nobody decides that a stunned wizard's spell ends.

A malformed or contradicting log throws `CorruptLogError`. Every seam
exhausts its own narrowed union; `fold-partition.test.ts` proves each event
type is claimed exactly once.

**The fold opens no catalogue.** Facts a seam needs from content are pinned
on the event or the record (a casting's area and clauses, an equip event's
armour). `Applying.legacy` carries content only for a log written before
pinning; the two frozen fixtures are the only such logs.

## Commands

A command is `(state, …inputs, supply?) → Result<GameEvent[]>`. Every one is
wrapped by `once(state, key, command, …)`: a retry with the same command id
returns the empty batch, a reused id for different work is refused, and the
stamp lands on the emitted events (`appliedCommands` in state). Rolling
commands take a `Supply` (`issuer`, `rng`, `content`); read-only ones take
`content` directly.

Refusals are values: `err(code, reason)` for a rule, `needsContext(code,
reason, requests)` when a fact is merely unknown. Every `needs-context` from a
command names the command that would supply the fact; `invariants.test.ts`
sweeps for both properties.

## Debts the turn owes

Interruptible resolutions live in state so a reload cannot lose them:
`pendingAttack`, `pendingDamage`, `pendingTest`, `pendingMove`,
`pendingCastings`, `pendingSaves`, `scheduledDamage`, `owedAreaEffects`,
`readied`. The turn refuses to advance past one it cannot settle.

A creature summoned by a casting that has since ended is the same kind of
debt and is **not** state: who is standing on a casting that is over is a
question about the world as it stands, which `strandedSummons` answers from
the roster and the ongoing records, where an owed area effect records a
moment that has passed and could not be recomputed. A creature its summoner
*keeps* (`SummonBond.kept`) is asked the same way of different facts: its own
hit points, and its summoner's death where the spell says so. `resolveTurn`
refuses on the answer either way.

## Conditions

A creature's conditions are a set of *reasons* with sources; implication
closure (Paralyzed implies Incapacitated) is derived, never stored. A
condition's source names the casting or feature that caused it, so ending
that source lifts exactly its conditions. Immunities are the creature's own
(`conditionImmunities`, from a stat block) or granted by an effect with a
source that can end.
