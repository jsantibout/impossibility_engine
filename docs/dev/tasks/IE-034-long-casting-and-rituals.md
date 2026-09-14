# IE-034 — A long casting time outside combat, and rituals

state: ARCHITECTURE_BLOCKED
lane: mechanism
tranche: 5
parallel-safe: NO — owns `commands/casting.ts`, `spells.ts` and `events.ts`; runs alone
depends-on: IE-033
worker: qb-builder · .claude/worktrees/agent-a633d308db72c66e4 · worktree-agent-a633d308db72c66e4
approved: 2026-09-14 — "APPROVE TRANCHE 5"
merge-approved: none

## Brief

### Objective

Let a spell whose casting time is a minute or more be cast **outside combat**,
as a declared casting that completes on the clock, and let a Ritual be cast as
one.

### Why now

**A casting time of a minute or more is the largest blocker in the book — 54
spells touched, 12 finished — and it was in none of the three rankings.** It is
the finding IE-015 existed to produce, on its first run. Twelve spells become
castable on this alone (IE-036 writes them), and `CLAUDE.md` has recorded the
refusal as a limitation since casting landed.

**The two-event casting is the state machine's skeleton and already exists.**
That is what makes this a bounded task rather than a milestone.

### Current relevant architecture

- `packages/engine/src/spells.ts:90` — the `CastingTime` union already carries
  a `long` member.
- `packages/engine/src/commands/casting.ts:413` — the refusal:
  `unsupported_casting_time` for a long casting, unconditionally.
- `PendingCasting` (`events.ts:486`) — the declared casting: the id allocated,
  the action spent, prior Concentration dropped, the slot **not** spent. SRD
  Counterspell is why: "the slot isn't expended".
- `spells.ts:88` — `SlotlessReason`, which already carries a ritual member.
- `clock.ts` and `advanceTime` — one clock counting seconds.
- The range and duration oracle — the precedent for holding a definition's
  number against the parsed printed field.

### A premise correction, verified on `main`

The audit said this task would be the ritual slotless reason's **first
writer**. That is **false**: `commands/casting.ts:446` already accepts
`slotless` from the command, and `casting.test.ts:191` already casts Detect
Magic as a ritual and asserts the `spell-cast` event carries it; `:183`
already refuses a slot level with it.

So the value has a writer and means almost nothing: **nothing checks that the
spell carries the Ritual tag, and nothing adds the ten minutes.** This task
does not introduce the value; it makes it mean what the book says. Say so in
the commit rather than claiming a first writer.

### Required behaviour

SRD, "Longer Casting Times": "Certain spells—including a spell cast as a
Ritual—require more time to cast: minutes or even hours. While you cast a spell
with a casting time of 1 minute or more, you must take the Magic action on each
of your turns, and you must maintain Concentration while you do so. If your
Concentration is broken, the spell fails, but you don't expend a spell slot. To
cast the spell again, you must start over."

SRD, Ritual: "The Ritual version of a spell takes 10 minutes longer to cast
than normal. It also doesn't expend a spell slot, **which means the ritual
version of a spell can't be cast at a higher level.**"

1. A long casting time gains a required `castingSeconds`, oracled against the
   parsed casting time by the range and duration precedent.
2. **Outside combat**, such a casting is a **declared** casting — action spent,
   prior Concentration dropped, id allocated — whose pending record carries
   `completesAt`.
3. The caster concentrates **on the casting itself** from declaration, through
   a `concentration-started` naming the pending id, so the existing damage save
   fires; a lost Concentration on a pending casting clears it derived-ly —
   spell failed, slot never spent, nothing to refund.
4. Settlement is refused (`still_casting`) until the clock reaches
   `completesAt`. `advanceTime` is how it gets there.
5. On settlement, a non-Concentration spell's casting-Concentration ends with
   reason `completed` in the same batch; a Concentration spell's simply
   continues under the same id.
6. A ritual flag on the request: legal only for a definition carrying the
   parsed Ritual tag, adds 600 seconds, takes the ritual slotless reason, and
   **refuses a slot level above the spell's own**.
7. **In combat the refusal stands**, and its reason names the per-turn
   Magic-action obligation as the machinery that is still missing.

### The one plausible YELLOW — route it, do not decide it

**Whether a creature's Concentration may name a *pending* casting id without
breaking a reader that assumes the id is in `ongoing`** — `holdsNothingOf`,
`ongoingSpellsBy`, and the Dispel readers.

The architect's design says it can, because a pending casting owns nothing yet.
**If any reader disagrees, stop and escalate `ARCHITECTURE_BLOCKED` rather than
special-casing it.** Do not add a branch to a reader to make this work; do not
invent a second concentration field. This is the named escalation of the whole
tranche, and it goes to Fable.

### Architecture constraints

- **Preparation stays unjudged**, as it is for every casting. The engine
  declines to judge whether a caster knows or has prepared a spell, and a
  Ritual is not the place to start.
- The slot is spent **at settlement**, never at declaration. That asymmetry is
  the SRD's and is already the two-event casting's rule.
- **This task owns the two casting-path refusal items IE-029 leaves**:
  `no_trigger` carries five distinct rules across three modules, and
  `nothing_to_interrupt` is unreachable behind a written exemption. Resolve or
  re-exempt both, asserted in `refusals.test.ts`.
- Never invent a number of seconds. `castingSeconds` is oracled against the
  book or the definition is refused.

### Acceptance criteria

1. A one-minute casting outside combat: declared, the action spent, the slot
   **not** spent; settlement refused before `completesAt` and accepted after;
   the slot spent then.
2. Concentration broken mid-cast by damage: the pending casting is cleared, the
   spell failed, **no slot expended** — the SRD's own sentence, driven.
3. A ritual adds 600 seconds, expends no slot, and is refused at a higher
   level; a non-ritual spell is refused for asking.
4. In combat, the refusal stands and its reason names the missing obligation.
5. Both frozen logs fold unchanged.
6. `npm run coverage` run and committed; `refusals.test.ts` covers every code
   this task adds or resolves.

### Tests and conformance

The oracle holds `castingSeconds` against the parsed casting time for every
definition that declares it, in both directions — the shape the range and
duration oracle already has.

### Dependencies

**IE-033.** The last of the serial union chain before IE-035.

### Likely file surface

`spells.ts`, `events.ts` (record and the Concentration branch),
`commands/casting.ts`, `commands/spell-resolution.ts`, `spell-schema.ts`, the
oracle, `scripts/coverage.ts`, `refusals.test.ts`.

### Out of scope

**The in-combat long casting** — the per-turn Magic-action obligation — which
is a `continueCasting` command plus a derived failure at the caster's turn
boundary, and is the second half of this work, deliberately deferred to the
next cycle. Writing the twelve spells: **IE-036** does that, after this.

### Known risks

Beyond the YELLOW above: a pending casting that persists across `advanceTime`
is the first engine debt with a *clock* deadline rather than a turn one.
`hasExpired` and `isDue` read a deadline in opposite directions on purpose —
use the right one, and say which in the digest.

## Completion digest

## Risk gate

## Architecture decision

## Merge record
