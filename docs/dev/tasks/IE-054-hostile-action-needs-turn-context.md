# IE-054 — A consequence that needs a turn timeline asks for one, before anything is spent

state: DONE
lane: mechanism
tranche: 7
parallel-safe: CONDITIONAL — the `castOrRelease` pre-flight and `riderDurations`; not beside IE-042, IE-051 or IE-053
depends-on: IE-051
worker: none
approved: 2026-09-14 — "APPROVE TRANCHE 7."
merge-approved: 2026-09-14 — "APPROVE TRANCHE 7."

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

**Brief correction, twice — and the second correction is of the first.** This
section originally told the builder to delete a sentence about turns outside
combat from the constitutional file, which at the time still held the
architecture. The foreman re-pointed the instruction and wrote that **that
sentence is not in the repository**.

**That was wrong, and IE-052's guard caught it.** The sentence is in the
repository, verbatim. It is the docstring on `scheduleDelayed`, which IE-051
moved to `packages/engine/src/commands/spell-effect-riders.ts` — the very
function this task is about, and it opens:

> "Outside combat there are no turns for it to be the end of, so nothing is
> scheduled and the caller is told. Refusing the whole casting would be worse —
> Acid Arrow is perfectly legal at a fleeing target nobody has rolled Initiative
> against, and its first 4d4 lands either way."

What the original brief got wrong was not the sentence but **the source**: it
attributed that docstring to a document which did not contain it.

That distinction is the whole argument for resolving a citation **by naming**
rather than by searching the repository. A corpus-search guard passes this
citation, because the run is present *somewhere*. IE-022's rule — resolve
against the document the citation actually names — is what fails it. This is a
better example of why that instrument exists than the one the foreman wrote.

**So the builder rewrites two places, not one**: the `turn-context` exemption
list in `docs/design/time-and-turns.md`, and the `scheduleDelayed` docstring
itself, which states the old rule in the file whose behaviour this task
changes.

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

## Completion digest — criterion 6 ruled by the foreman, merged

**Merged `26141e0`**. `main` green at **8,728 tests across 127 files**; frozen logs
untouched. Builder `ARCHITECTURE_BLOCKED`, reviewer `ESCALATE` with **no defects
for the builder** — *"the one issue is not the builder's to re-decide"*.

**Criteria 1–5 and 7 are met and driven**, at the reviewer's high confidence. The
owner's decision is built: a printed later consequence asks for the turn timeline
it needs **before the slot, the action and the first die**, per target and
anchored on the target, and the engine begins no fight, rolls no Initiative and
holds no rule about which actions are hostile. That boundary was the point.

### The ruling on criterion 6

Criterion 6 asked the builder to close `riderDurations`' `areaTrigger.effects`
gap, with one escape: *"if you find it genuinely cannot be reached even in
principle, say so."* The builder found a **third** outcome the brief did not
anticipate, and **the faulty premise was the foreman's**: the brief asserted the
fix would be inert. It is not.

**Gathering an area trigger's riders at the casting pre-flight asks the question
at the wrong moment.** SRD Stinking Cloud's Poisoned lasts *"until the end of
the current turn"* on a trigger whose casting does nothing at all — so the
pre-flight would refuse the cloud to anybody who had not rolled Initiative, and
the only command satisfying that request **begins a fight**. The engine would
require combat before a gas trap may be laid.

**The foreman verified all three load-bearing facts independently rather than
taking the digest:**

1. **Stinking Cloud is the only `areaTrigger` in the catalogue carrying a
   turn-anchored rider** — measured over every definition — and it has no
   `onEntry`.
2. `area-triggers.test.ts` conjures its areas **before** Initiative *by design*,
   with a docstring defending it: *"a wizard who set a trap before the door
   opened is the commoner table situation anyway."*
3. `commands/conditions.ts:198` **does** convert the late refusal into the same
   `turn-order` request — so the question is **not lost, it is asked later**.

Fact 3 is the decisive one. The "gap" is not a hole where the engine forgives
something; it is a difference in *when* the honest request is raised.

**Ruling: accept the recorded rejection. GREEN, and the foreman's.**

What the design document records is **not new architecture**, which is what
would have made this Fable's. It applies a distinction the engine already draws
— *"the distinction `creatureTypeNeeds` already draws by asking twice, once at
the pre-flight and once at resolution for whichever effect list is running"* —
records the decision in this repository's standard debt idiom with **the fact
that would end it** (an area trigger carrying an *entry* clause with a
turn-anchored rider), states the residual honestly (*"honest, and one roll too
late"*), and is **pinned by a test in both directions, premise included**.

The two alternatives both lose on recorded principle. The briefed fix refuses a
legal casting. The narrower variant — gather nested riders only where the trigger
carries an entry clause — buys **a runtime branch no SRD spell can reach**, which
is the class this repository deletes; `roll-mode.save` is the recorded example.

**Option (c) is the right answer for the day it matters**: ask at the trigger's
own resolution, beside `creatureTypeNeeds`' second ask. It is a new ask site the
brief did not approve, so it is recorded for a later tranche rather than
improvised here — which is what the owner's approval required.

### Conditions 3 and 7 waived, on recorded rationale

The verdict is `ESCALATE`, not `PASS`, and the reviewer's confidence is **medium
overall and high everywhere outside criterion 6**. Both are waived deliberately:
the reviewer's residual uncertainty is **scoped precisely to the decision the
foreman has now made** — its own words are *"Accept the recorded rejection, or
require the narrow fix — one decision, with the evidence above."* There is **no
unreviewed code delta**; the reviewer read the exact merged commit, found no
defects, and asked one question. A confirming round would add nothing, which is
what distinguishes this from IE-040, where an unreviewed fix existed and a
confirming round was launched.

### A closed loop worth recording

IE-052's citation guard pinned the `scheduleDelayed` docstring, and **its own
comment predicted that rewording it would be "a change worth a red test"**.
IE-054 is that change. The fixture now asserts **both** that the old sentence is
gone from the entire tree **and** that the sentence replacing it is present —
because, in the builder's words, *"a case that had merely stopped finding the run
would be indistinguishable from a search that had quietly broken."*

**And the verdict on the citation does not move**, which is the point of the
case: the guard resolves against the document the brief *named*, and that
document never contained the sentence. Where else it lived, or whether it lives
anywhere still, was never what made the citation false.

### Reported

The new `not_in_combat` arm changes behaviour **inside** a running fight too:
Acid Arrow or Vitriolic Sphere aimed at a creature with no place in the order now
asks for `rollInitiativeFor` then `joinCombat` where it previously resolved with
an `unverified` line. That is the same rule reaching a second world, it is
tested, and **it is only satisfiable because IE-055 built `joinCombat` earlier in
this tranche**.
