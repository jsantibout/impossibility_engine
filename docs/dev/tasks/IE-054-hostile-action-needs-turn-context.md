# IE-054 — A consequence that needs a turn timeline asks for one, before anything is spent

state: APPROVED_FOR_IMPLEMENTATION
lane: mechanism
tranche: 7
parallel-safe: CONDITIONAL — the `castOrRelease` pre-flight and `riderDurations`; not beside IE-042, IE-051 or IE-053
depends-on: IE-051
worker: none
approved: 2026-09-14 — "APPROVE TRANCHE 7."
merge-approved: none

## Brief

### Objective

Extend IE-046's pre-flight so that a casting whose **printed later
consequence** needs a turn timeline asks for turn context before the slot, the
action and the first die — instead of resolving in part and forgiving the
consequence.

### Why now

**This is the owner's decision of 2026-09-14, and it is deliberately general.**
Acid Arrow is the case that exposed it and must not be the rule:

> when resolution of a hostile action requires turn-relative mechanics and no
> turn order exists, request turn context; do not convert printed turn timing
> into seconds; do not forgive later consequences; do not invent a fake
> deadline; do not silently create combat inside the rules engine.

Today, outside combat, Acid Arrow resolves: the slot goes, the attack rolls, the
first 4d4 lands, and the second hit is dropped with a line in `unverified`. IE-046
deliberately left it alone and reported it for the owner, because converting it
*after* the fact would be a lie — a `needs-context` promises nothing was spent.
Asking **before** anything is spent is the honest version, and it is the door
IE-046 already built.

**The engine says "I need turn context to adjudicate this." Maestro decides the
fiction — "this hostile action starts combat" — and satisfies the request.** No
hostility rule, no combat-starting, and no spell name anywhere in the engine.

### Verified: this is reuse, not new architecture

The foreman checked before briefing, because the owner made a YELLOW conditional
on the answer:

- `turnContextFor` in `commands/command.ts` already converts a refusal into the
  request, and already reads `'of' in duration ? duration.of : holder` — so a
  **target-anchored** duration produces a request naming the target, with no
  change to that function.
- `castOrRelease`'s pre-flight already runs with the targets settled, already
  iterates them for `creatureTypeNeeds` and `teleportTo`, and already returns
  `needs-context` before anything is spent.
- **The one thing missing is that the moment is not declared.** `DelayedDamage`
  is `{ damage, damageType }` with no `lasts`; the moment is hard-coded as
  `endOfNextTurn(target)` inside `scheduleDelayed`. `riderDurations` cannot see
  it, and it anchors everything it does find on the **caster**.

So the work is one extraction and one loop, and no foundational change. **YELLOW
not raised.**

### Required behaviour

1. **One spelling of the moment.** Extract `endOfNextTurn(target)` into a single
   named reader that both the pre-flight and `scheduleDelayed` call. Two
   spellings of one sentence is the failure this repository records about every
   duplicated rule — `teleportOf`'s docstring states the pattern: one reader,
   one question, asked in the places that must agree.
2. The pre-flight gathers **delayed** riders as well as the ones
   `riderDurations` already yields, and resolves each **per target**, anchored
   on that target. A refusal becomes `turnContextFor`'s request, unchanged.
3. **Nothing is spent** — assert it on folded state, not on the `Result`.
4. Once turn context exists, the same casting resolves normally: the attack
   rolls, the first damage lands, and on a hit the later damage is scheduled for
   the end of the target's next turn. Drive that whole flow.
5. **No spell name anywhere**, and no hostility rule: the trigger is that a
   printed consequence needs a turn timeline, which is a property of the
   definition and reaches Vitriolic Sphere identically.
6. **Fix `riderDurations`' second gap while you are in it**, which IE-043's
   merge recorded and IE-046 confirmed: it walks `definition.effects` only and
   not `areaTrigger.effects`, so an area trigger's rider never passes the
   pre-flight. Currently unreachable — a `start-of-turn` debt needs
   `turn-advanced`, which needs combat — and reachable the day an area trigger
   carries an **entry** clause with a turn-anchored rider, since an entry fires
   outside combat.

### Architecture constraints

Settled by the owner; a deviation is `ARCHITECTURE_BLOCKED`:

- **no conversion of printed turn timing into seconds, anywhere**;
- no invented deadline, no forgiven consequence, no combat begun inside the
  engine;
- the request goes through the ordinary command boundary, and the policy that
  answers it stays above the engine;
- consistent with the Ray of Frost decision, of which this is the same rule
  reaching a later consequence rather than a rider.

### Acceptance criteria

1. Acid Arrow cast outside combat returns `needs-context` with a `turn-order`
   request naming the **target**, with no slot spent, no die thrown and no state
   change — asserted on the folded state.
2. `beginCombat` is then called and the same casting resolves: attack, first
   damage, and on a hit the delayed damage scheduled at the end of the target's
   next turn. Assert the schedule, not just the absence of a refusal.
3. **Vitriolic Sphere behaves identically**, which is what says this is a
   mechanism and not an Acid Arrow rule.
4. A casting whose delayed rider is not reached — a **miss** — still owes
   nothing later, in combat, unchanged.
5. The moment has one spelling: a mutation changing it in the extracted reader
   moves **both** the pre-flight and the schedule.
6. The `areaTrigger.effects` gap is closed, with a test that would have failed
   before; if you find it genuinely cannot be reached even in principle, say so
   rather than writing a fixture that pretends otherwise.
7. `refusal-sweep.test.ts` green in both directions; `COVERAGE.md` regenerated.

### Tests and conformance

**`docs/design/time-and-turns.md`** is the authoritative document for durations,
turn boundaries and the clock — read it first; `CLAUDE.md` is now only the
constitution and the router. The paragraph to rewrite is the `turn-context`
exemption list, whose `scheduleDelayed` clause currently reads that SRD Acid
Arrow's later 2d4 "is reported in `unverified` and not scheduled rather than
refused". It gains the rule that a printed later consequence asks for the
timeline it needs.

**Brief correction, recorded rather than hidden.** This section previously told
the builder to remove the sentence "outside combat there are no turns for it to
be the end of, so nothing is scheduled and the caller is told" from `CLAUDE.md`.
**That sentence is not in the repository** — IE-046 rewrote the paragraph, and
the brief was quoting a superseded run. The instruction is re-pointed above to
the paragraph that actually exists. This is precisely the class of error IE-052
is being built to catch, and it is the second confirmed instance.

### Dependencies

IE-051 (the pre-flight's file is reorganised by it).

### Out of scope

Any rule about hostility, and any engine-side decision that combat has begun —
that authority is Maestro's and must not move into a resolver. `joinCombat`
(IE-057) is a sibling, not a dependency.

### Known risks

Low in mechanism. The one thing to get right is that the refusal arrives
**before** the attack roll, because refusing afterwards is the validate-before-
rolling violation this whole discipline exists to prevent.
