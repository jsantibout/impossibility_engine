# IE-024 — The validator judges untyped input instead of throwing on it

state: DONE
lane: conformance
tranche: 5
parallel-safe: CONDITIONAL — owns `spell-schema.ts`; every later union task adds a rule to that file, so it lands first and alone
depends-on: none
worker: none
approved: 2026-09-14 — "APPROVE TRANCHE 5"
merge-approved: 2026-09-14 — "APPROVE TRANCHE 5" (tranche 5 authority; 13/13 conditions green)

## Brief

### Objective

`parseSpellDefinition(unknown)` must **report** a malformed definition rather
than throw on it, in every branch — which is the whole contract of the
function.

### Why now

**A validator that throws is not validating.** IE-017's builder found that
`checkEffect`'s branches dereference an effect's fields unguarded, matching the
precedent rather than making one kind defensive and its neighbour not — and
IE-010's re-review caught the same class as a real regression in
`grantCarried`, where a loop conversion dropped a null guard and
`parseSpellDefinition` began throwing where it used to return
`err('unknown_condition')`. **Three instances is a class, not a slip.**

It lands in wave 1 because five later tasks each add a rule to this file; a
defensive pass is cheapest before them and worth nothing after.

### Current relevant architecture

- `packages/engine/src/spell-schema.ts:589` — `checkEffect`, the branch table.
  `:690` `end-condition` and `:747` `damage-defense` are the two IE-017 named;
  read all of them.
- `:864` `grantCarried` — the array-rider cosmetic: an array satisfies
  `typeof === 'object'` and non-null, so it still draws a spurious second
  `grant_without_lifetime`. The first and returned problem is the correct one,
  so nothing a caller reads is wrong today.
- The throw-safety sweep in `packages/engine/src/spell-schema.test.ts` asserts
  only that nothing throws — so it would also pass if the validator ever began
  *accepting* malformed input.
- `TargetRule.mustBeType` is an unvalidated string, so `mustBeType: 'Goblinoid'`
  validates while `againstType.types: ['Goblinoid']` does not. `CREATURE_TYPES`
  is the glossary's closed fourteen and already backs the second.

### Required behaviour

1. Every `checkEffect` branch guards its dereferences, so an arbitrary unknown
   reaches a reported problem rather than a throw. Follow the existing
   reporting shape: every problem carries a path, and the function returns all
   of them rather than the first.
2. The throw-safety sweep additionally asserts the result **is** an error —
   closing the "began accepting" direction without naming a code or freezing
   collection order. IE-010's reviewer raised this and accepted the builder's
   reasoning against pinning codes; keep that reasoning.
3. `mustBeType` is validated against `CREATURE_TYPES`, closing the asymmetry
   with `againstType.types`.
4. The `grantCarried` array case no longer draws the spurious second problem.

### Required behaviour — the SRD line behind rule 3

SRD 5.2.1 prints a Goblin Warrior as "Small Fey (Goblinoid)". The glossary
gives the fourteen creature types rules and gives a subtype tag none, so a
definition naming a tag matches nobody and must be refused at authoring — the
reading `isCreatureType` already takes for `againstType`.

### Architecture constraints

> **Two of these three were superseded on 2026-09-14 by a recorded YELLOW
> decision — see "Architecture decision" below, which is authority and not
> commentary.** They are struck rather than deleted, because a brief that
> quietly changes shape is worse than one that shows its history. A reviewer
> reads this section before that one, which is exactly how the first review of
> the rework came back `ESCALATE` on authority with no defect to report.

- ~~**A field the engine does not know is not an error.** `checkShape`'s
  denylist reading is deliberate and stays: this task makes malformed input
  *reportable*, it does not make unknown input rejected.~~ **Superseded.** The
  denylist's *contents* are unchanged; what changed is the **population** it
  reaches — `checkNoNestedEffect` was entered only from the top-level walk, so
  `CLAUDE.md`'s "three places enforce that a rider is a leaf" was two places
  and a test. Extending the walk to all three effect lists is the decision.
- Do not change any existing refusal code's spelling. A code is observable
  behaviour and `refusals.test.ts` pins them. **Still binding.**
- ~~No new validation rules beyond `mustBeType`.~~ **Superseded**, and narrowly:
  no new *rule* is added. Two existing rules — `unknown_effect` and
  `checkNoNestedEffect` — reach lists `CLAUDE.md` already claimed they covered,
  and `unmodelled: null` is brought under the one `??` rule the decision
  states. Five later tasks still each add their own rule, and that is unchanged.

### Acceptance criteria

1. A table-driven case feeding each branch a wrong-typed payload: none throws,
   every one reports.
2. `mustBeType: 'Goblinoid'` is refused; `mustBeType: 'Fey'` is accepted.
3. The whole catalogue still validates: it is driven through
   `parseSpellDefinition` wholesale, so a new refusal that catches a real
   definition is a defect in the rule.
4. Reversing the "is an error" addition leaves a test red.
5. `npm test`, `npm run typecheck`, `npm run lint` green; `COVERAGE.md`
   unchanged.

### Tests and conformance

`packages/engine/src/spell-schema.test.ts`. The sweep is the load-bearing
part: drive it over a synthetic malformed definition per branch rather than
over one example.

### Dependencies

None, and nothing else in wave 1 may edit `spell-schema.ts`.

### Likely file surface

`packages/engine/src/spell-schema.ts`,
`packages/engine/src/spell-schema.test.ts`.

### Out of scope

The feature-definition validator (IE-025) — a different file and a different
population. ~~Any change to `checkShape`'s denylist.~~ **Superseded on
2026-09-14 by the recorded decision below**: the denylist's contents stay
fixed, and the lists it is applied to are what the decision changes.

### Known risks

A guard added in the wrong place turns a reported problem into a *missing*
one. Every branch that gains a guard needs a case proving the problem is still
reported for the input that used to reach it legitimately.

## Completion digest

Builder **COMPLETE**, reviewer **PASS at high confidence**. Branch
`worktree-agent-a4be1fee7f60504ad`, commit `b084b13`, rebased by the foreman to
`d53ae63`. Tests **6808 → 7017 on `main`**, **212 new**. Gauntlet green,
`COVERAGE.md` byte-identical, the whole catalogue still validating unchanged.

**Five rounds in total, and only the last two were about the code**: three were
the question Fable answered, and the fourth was an `ESCALATE` on *authority*
caused by the foreman's own process defect — the decision reached the builder
by message and never reached the brief the reviewer reads. Neither cost is the
builder's.

Nine mutations, each failing only the case that pins it. Two worth naming:
reverting `checkScaling`'s guard to a silent skip fails **26 rows, every one on
`isErr` and none on a throw** — which is the "began accepting" direction the
brief asked for rather than the throw-safety one; and **adding a fifteenth kind
to `EFFECT_KINDS` fails the new coverage assertion, while removing one fails it
from the other side**.

**It removes a second source of truth rather than adding one.**
`checkGrantLifetimes` had its own hand-written copy of the three effect lists
and dereferenced two of their holders directly, so a string `areaTrigger` threw
there one call after the rules that report what is wrong with it. `effectLists`
is the single enumeration now, read by both `checkShape` and
`checkGrantLifetimes` — the optional GREEN half of Fable's decision, taken. The
mutation that says it is one enumeration and not two spelled alike: removing
the nested walk reddens the nested-entry cases, the leaf cases **and** the
lifetime sweep together.

**The one ordinary defect this round found is worth recording because of where
it was.** `BRANCHES` enumerated what the runtime derives, with two exclusions in
prose and nothing holding either against `EFFECT_KINDS` — **a hand-kept list, in
the file five queued tasks each edit**. It is the exact shape `CLAUDE.md`
records going wrong repeatedly, and the builder's own note is that it wrote the
list while writing about that shape. The reviewer caught it; the fix is the
both-directions assertion above.

Out-of-scope findings, neither acted on: a `DiceScaling` with no `dice` becomes
`NaNd6` in `scaledDiceFor` and the spell silently rolls nothing, and
`origin: {}` validates for the same reason — both required-field rules the
brief reserves. And the pre-existing code asymmetry Fable instructed be written
down rather than fixed: a top-level `effects` that is not a list is
`missing_field` (phase 1), a nested one `malformed_field` (phase 2).

## Risk gate

**Inspected** — a new observable refusal code (`malformed_field`), a recorded
architecture decision, and the validator five later tasks each add a rule to.

I read the enumeration, which is the heart of Fable's option (a), and it is
what was specified: `effectLists` answers the one question — which effect lists
does this definition carry — and **a list nobody can walk simply does not
appear**, so the report stays at the container, which is the division of labour
`grantCarried` already followed for a rider it cannot read. No entry guard was
added to `checkEffect`, the call sites or `grantCarried`; no `malformed_field`
per entry.

Three classes of authored input that validated before now refuse: an unknown
effect `kind` inside a nested list, a rider carrying `effects`/`targets`/`area`
inside a nested list, and `unmodelled: null`. **None occurs in the catalogue**,
which is driven through `parseSpellDefinition` wholesale, so no real content is
caught.

Classification: **GREEN**, under the recorded decision.

## Architecture decision

**YELLOW, escalated by the builder at the three-round cap and by the foreman to
Fable. Answered: option (a).** Recorded here as the decision the rework rests
on; the rework itself follows below when it lands.

> **Question.** Where does the guard for entries of the two nested effect lists
> live — the shape phase, the semantic phase, or a helper shared by both — and
> is `null` absent or malformed?

**Decision.** `checkShape` walks **every** effect list a definition carries
through **one enumeration** — `effects`, `areaTrigger.effects`,
`activation.effects` — applying the existing per-entry rules (`not_an_effect`,
`unknown_effect`, `checkNoNestedEffect`) to each. It walks a nested list only
when the parent is a non-array object and its `effects` is an array; otherwise
it says nothing and the semantic pass reports the container as it already does.
**No entry guard in `checkEffect`, `grantCarried` or the two call sites, and no
`malformed_field` per entry.** One rule for `??`: `undefined` is absent; any
other value, `null` included, is read against the declared type and reported
`malformed_field` — so `unmodelled: null` follows the rider slots rather than
the other way round.

**Because.** `checkShape`'s own contract is "enough of the shape that the
semantic rules can read it without throwing", and the semantic rules read three
lists through one `checkEffect` — which has **no `default` arm** — so the
guarantee belongs where the sentence is already written, once. The file's own
rule, "two codes for one defect would be the second place to get one sentence
wrong", rules out (b). **(c) reports the same defect in a different phase
depending on which list it sits in** — the same failure by phase rather than by
code — and `checkNoNestedEffect` would still reach one list of three unless
duplicated too. `null` is a member of none of the declared types, and the
catalogue carries none anywhere, so nothing anybody depends on changes.

**The phase change is not a change.** `effects: [null]` already returns shape
problems only and masks the semantic ones; that has been the two-phase contract
since the validator was written. Extending it to the nested lists makes the
contract uniform, and neither caller cares — `parseSpellDefinition` returns the
first problem regardless, and `checkSpellDefinitionValue`'s "everything"
already means "everything in the phase that failed".

**Inside the approved brief: YES**, and this is the important procedural half.
The brief's out-of-scope line names the denylist's *contents*, and no rule is
added — two existing rules simply reach the lists `CLAUDE.md` already says they
cover. **Recorded as a clarification rather than a deviation**, in one sentence
the five later tasks on this file need: *entry-level guards for every effect
list are `checkShape`'s; `checkEffect` assumes a known kind.*

**The finding that came with the answer, and it is worth more than the
decision.** The **rider-is-a-leaf denylist has the same hole**:
`checkNoNestedEffect` is entered only from the top-level walk, so a nested-list
entry carrying `effects`, `targets` or `area`, or an effect `kind` below a
rider, **validates clean today**. `CLAUDE.md` says "three places enforce that a
rider is a leaf" and names the validator as one — the validator enforces it on
**one list of three**. The test sweep in `spell-schema.test.ts` walks all three,
which is why the catalogue is clean and why nobody noticed. Option (a) closes it
for free, and the `CLAUDE.md` sentence is corrected with the change.

**Debt accepted: none new.** One pre-existing asymmetry stays and is written
down rather than fixed: a top-level `effects` that is not a list is
`missing_field` (phase 1) while a nested `effects` that is not a list is
`malformed_field` (phase 2) — different codes for one shape of defect. It is a
code change and belongs to its own task, and Fable is explicit that it must not
be discovered by IE-030.

Fable's confidence: **high**. Blast radius: `spell-schema.ts` only.

## Merge record

Merged to `main` as `d53ae63`, fast-forward, pushed. Rebased by the foreman
twice — once to carry Fable's decision into the worktree, once after the
superseded lines were struck — and again before the merge.

`main` verified after the merge: typecheck ✓, lint ✓, **7017 tests across 108
files** ✓, `COVERAGE.md` byte-clean ✓, tree clean.

Thirteen conditions: **1** inside the brief **as clarified by the recorded
decision**, which is the condition this task spent a round failing for a reason
that was the foreman's; **2** `COMPLETE`; **3** `PASS` at high confidence;
**4** the one ordinary defect resolved; **5** gauntlet green; **6**
conformance; **7** the architecture blocker is answered and recorded; **8** no
outstanding deviation — the two that were deviations against the old brief are
the decision itself; **9** `spell-schema.ts` is the brief's own exclusive
surface and the definition types are untouched; **10** `CLAUDE.md` outside the
named surface, authorised by the decision, which required the leaf-denylist
sentence corrected with the change; **11** clean rebase; **12** re-verified on
`main`; **13** risk gate inspected, GREEN.

**Unblocks IE-030**, and clears `spell-schema.ts` for the four union tasks
behind it.
