# IE-034 — A long casting time outside combat, and rituals

state: DONE
lane: mechanism
tranche: 5
parallel-safe: NO — owns `commands/casting.ts`, `spells.ts` and `events.ts`; runs alone
depends-on: IE-033
worker: none
approved: 2026-09-14 — "APPROVE TRANCHE 5"
merge-approved: 2026-09-14 — "APPROVE TRANCHE 5" (tranche 5 authority; 13/13 conditions green)

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


## Completion digest

Builder **COMPLETE**, reviewer **PASS at high confidence** — after **six
rounds**, of which one was the `ESCALATE` the foreman adjudicated with Fable and
routed to the owner, and four were ordinary defects. Branch
`worktree-agent-a633d308db72c66e4`, commit `8173963`, rebased to `c3fc27e`.
Tests **7318 → 7648 on `main`**, 32 new in a new file plus 22 across four
others. Gauntlet green; `COVERAGE.md` byte-clean, its only deltas the **ten
`unmodelled` clauses saying the Ritual option was not modelled**, removed
because it now is.

**Eighteen mutations.** The load-bearing ones: suppressing the casting's own
Concentration (11 red); removing the `pendingCasting` clear from
`releaseCasting` (3); reverting `spell-interrupted` to clear the record without
the Concentration (4); reverting the forward-read in `removeCreatureEverywhere`
(1, a `CorruptLogError`); restoring the `resolveDuration` bypass (4); an
`unshift` on the settlement's `effect-scheduled` (1, **and only the folded
reading sees it**); replacing the Ritual's sum with the constant (1, **and only
the hand-built Alarm sees it**); and narrowing `casting_pending` to the caster
(2 — the debt tests).

**Two survived and are recorded rather than papered over**: `completesAt` and
`castingTime === 'long'` agree by construction, so no fixture can tell them
apart; and reading the span off the request rather than the resolution is
behaviour-identical once the resolution is what validates.

**The Alarm fixture is the discriminating one and had to be built.** All ten
tagged catalogue spells print "Action or Ritual", so `0 + 600` and `600` are the
same number — a hand-built definition reaching 660 is the only thing that
distinguishes the Ritual's *sum* from a constant, and it is driven through
`checkSpellDefinition` so it is not junk.

**The named YELLOW was answered correctly**: no reader of `concentration` was
branched and no second field invented. The *unforeseen* one became Fable's
decision and the owner's, below.

**The debt ships pinned as behaviour, not as prose.** Three tests assert that a
second caster is refused `casting_pending` for the whole rite, that it costs
them nothing, that it does not relent nine minutes in, and that a creature who
is **not** casting still acts. The queued `pendingCastings` task therefore
**deletes tests** rather than finding a comment — which is the whole point of
pinning a debt.

Two refusal codes change observable value, both assigned by the brief and
asserted by name: `no_trigger` → `forced_target` at the two forced-target
Reaction sites, and `no_trigger` → `no_trigger_stated` for an empty Ready
trigger.

Unresolved concern, cleared by the reviewer as blocking nothing:
`long-casting.test.ts:318` carries `expect(world()).toEqual(before)` where
`before = world()` — two identical pure computations, so **that assertion
cannot fail**. The block's load-bearing `isErr` assertion can, and duplicates
the `it.each` above it. The builder left it rather than edit after a PASS and
make the reviewed commit no longer the commit — the right instinct, and the
foreman agrees: a vacuous assertion **beside** a working one is a tidy, not a
correctness risk. Filed rather than fixed silently.

## Risk gate

**Inspected.** Foundational primitives, two observable refusal-code changes and
a change to the Concentration branch of the fold.

- **Both frozen logs and `scenario.test.ts` run explicitly** — 53 tests — with
  the fixtures untouched.
- **The debt is genuinely pinned**: `casting_pending` is asserted by name at
  three sites in `long-casting.test.ts`, not described in a comment.
- `removeCreatureEverywhere` now reads **forward**, because routing
  `spell-interrupted` through `releaseCasting` made it write two events about
  one fact against two different worlds — which the fold refused. That is a
  correctness fix the Concentration change itself exposed, and it is driven.

Classification: **GREEN**.

## Architecture decision

**Recorded in full in the section the foreman appended at the escalation** —
Fable's answer, the measured fact that `unsettledRefusal` never contained
`pendingCasting`, the decision to key the record by casting id with one open
casting per caster, and the explicit finding that the change **does not stay
inside this brief**.

Because the owner's standing instruction is that a YELLOW may continue only if
the answer stays inside approved scope, the shape change was **not built here**.
It is proposed as tranche 6's first task, with **IE-036 deferred behind it** on
Fable's evidence.

## Merge record

Merged to `main` as `c3fc27e`, fast-forward, pushed. Rebased by the foreman;
clean.

`main` verified after the merge: typecheck ✓, lint ✓, **7648 tests across 114
files** ✓, both frozen logs and the scenario determinism explicitly ✓,
`COVERAGE.md` byte-clean ✓, tree clean.

Thirteen conditions: **1** inside the brief, and the one thing that was not is
deferred rather than smuggled; **2** `COMPLETE`; **3** `PASS` at high
confidence; **4** defects resolved; **5** gauntlet green; **6** conformance —
ten stale clauses removed because the thing they described is built; **7** the
architecture blocker is answered, recorded, and its out-of-scope half routed to
the owner; **8** no deviation; **9** the primitives are the brief's, with the
two refusal-code changes it assigned; **10** files outside the surface are each
forced — one by the `no_trigger` split the brief assigns, one by a fold-breaking
consequence, one by an audit sweep that refuses an unaccounted field; **11**
clean rebase; **12** re-verified on `main`; **13** risk gate inspected, GREEN.

**Wave 6 complete.** The largest blocker in the book is built for the
out-of-combat half: **54 spells touched, 12 finishable** — though IE-036, which
writes them, is deferred to tranche 6 so that it writes them against a record
whose shape has stopped moving.
