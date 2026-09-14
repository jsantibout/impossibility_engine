# IE-034 — A long casting time outside combat, and rituals

state: IMPLEMENTING
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

## Architecture decision

**YELLOW, escalated by the builder as `ARCHITECTURE_BLOCKED` and independently
by its reviewer as `ESCALATE`. Answered by Fable, and the answer is larger than
this brief — so the decision is recorded, the *narrow* half is built, and the
shape change goes to the owner.**

> **Question.** Once a pending casting can last ten minutes of game time, is a
> single global `pendingCasting` still the right representation, and what
> constrains the rite's own caster meanwhile?

### The measured fact that reframed it

**`unsettledRefusal` has never contained `pendingCasting`.** While a
Counterspell window is open on `main`, a fighter attacks, a rogue moves,
anybody Dodges — only `castOrRelease`, `activateSpell` and `resolveTurn` read
the record at all.

So the guard was never "a casting in process freezes the world". **Its entire
content is refusing the second declaration the reducer would throw on** — a
structural fact leaking out as a rules refusal, invisible only because its one
user was an instant inside one creature's own Magic action. **IE-034 did not
break the guard; it exposed that the single slot was an accident of its first
user.**

### The decision

Replace the slot with `pendingCastings`, **keyed by casting id** and sorted as
`ongoing` is, with the reducer enforcing **one open casting per caster**. Every
reducer path already addresses the record by casting id — `spell-interrupted`,
`spell-cast`, and this task's own `releaseCasting` addition — and `ongoing` is
already that shape, so this is a **second user of an existing shape rather than
a new one**.

**Option (a) — refuse only castings that would themselves be declared — is
refused outright, under any sequencing.** It keeps the accident and re-issues
it as a rule, so two party members performing rites in the same ruin are still
refused. A structure compensating for itself.

**The rite's own caster.** SRD commits *the Magic action* and Concentration and
nothing else, so the per-caster guard refuses an `action` or `long` casting and
an `action` activation, and **permits a Reaction and a Bonus Action** — a
Counterspell from a wizard mid-rite is the natural fixture. Refusing a Bonus
Action would be an invented rule. A Concentration spell begun mid-rite needs no
guard: `concentration-ended` already routes through `releaseCasting`, which
drops the pending record with no slot spent — the SRD's own "the spell fails,
but you don't expend a spell slot", derived.

**`casting_pending` afterwards** means *the creature named is mid-casting and
what you asked for waits on it*. The Counterspell invariant is restated rather
than lost, and reads better: **a Counterspell is never a pending casting, and a
casting that is an answer is never answered.**

### Why the shape change is not in this task

Fable's own line: **"Stays inside the approved brief: NO."** It changes a
foundational record's shape, a published command's signature, four command
modules this brief never listed, and one file under `tools/`. The owner's
standing instruction for this tranche is that a YELLOW **"may continue only if
the answer stays inside approved scope"**, and this does not — so it is the
owner's to authorise, and it is proposed as tranche 6's first task.

What ships here is the narrow, correct thing plus **a named and pinned debt**,
which Fable sanctioned explicitly as acceptable for one tranche:

> A casting in process is one engine-wide … **This is a limit of the record,
> not a rule of the SRD**, and a queued task replaces the record.

Pinned by a test in which a cleric's Fire Bolt during a wizard's rite is
refused `casting_pending` and **the refusal costs nothing**. A debt that is
asserted is a debt somebody deletes when it stops being true.

**`unsettledRefusal` and `mayAct` must not gain the record** — a fighter
attacking during a rite is legal play, and that is the one thing already right.

### Second-order findings, recorded

1. **A rite open when `startCombat` fires wedges the fight.** `resolveTurn`
   refuses `casting_pending`, settlement refuses `still_casting` until a
   round-derived clock arrives, and the only exits are giving up Concentration
   or leaving the game. What `startCombat` should do to an open casting belongs
   to the deferred in-combat half.
2. `casting_pending` carries three rules — own casting open, turn cannot
   advance, Counterspell nesting — the same shape the builder has just split
   `no_trigger` for. The nesting refusal is the odd one out and is GREEN.
3. The `hold === undefined` refusal means the low-level `castSpellWith` cannot
   begin a rite at all. Fine as policy; its docstring should say so.

Fable's confidence: **high**.
