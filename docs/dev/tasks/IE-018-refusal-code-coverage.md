# IE-018 — A sweep for refusal codes nothing asserts

state: DONE
lane: conformance
tranche: 4
parallel-safe: YES — a sweep and the tests it demands; no engine semantic change
depends-on: none
worker: none
approved: 2026-09-13 — "APPROVE TRANCHE 4"
merge-approved: 2026-09-13 — "APPROVE TRANCHE 4" (tranche 4 authority; 13/13 conditions green)

## Brief

### Objective

Derive the list of refusal codes no test asserts, and close the gap for the
ones that are reachable — so that a refusal the engine can return is a refusal
something has actually seen.

### Why now

**41 of 112 `err(` and `needsContext(` literals in non-test source are asserted
by no test** — 37%, measured by the fourth whole-engine audit (§3.5). The third
audit measured 46 of 162 on a wider net; **the proportion has not moved across
two audits and three tranches**, which is what makes it a standing gap rather
than a backlog.

A refusal code is the engine's answer to "why not", and an unasserted one is a
sentence nobody has read. Among them are `cantrip_takes_no_slot`,
`conflicting_slot`, `no_scene` and the mount family — refusals a tool surface
will meet early, because they are what a caller gets wrong first.

### Current relevant architecture

- `err(code, reason)` and `needsContext(code, …)` in the `Result` vocabulary —
  rules-legal refusals are values, not exceptions, which is why they are worth
  asserting at all.
- The derived sweeps in `invariants.test.ts` are the model: they read the
  module, compute a set, and hold an allowlist in both directions so a stale
  exemption fails. This sweep is the same shape over a different population.
- `CLAUDE.md` records the discipline these codes enforce — validate before
  rolling, a refusal costs nothing, the duplicate check comes first — and some
  of the unasserted codes are the only evidence those rules hold at their site.

### Required behaviour

1. **A derived sweep**: every `err('…')` and `needsContext('…')` literal in
   non-test engine source, against every code quoted in any test. Asserted in
   both directions, so a code that disappears from the source and stays in the
   allowlist fails too.
2. **An allowlist with a written reason per entry**, for a code that is
   genuinely unreachable from any test — a defensive branch, a case only a
   corrupt log produces. "Not got round to it" is not a reason and the sweep
   should not accept a bare entry.
3. **Tests for the reachable ones.** The point is not the sweep; it is the
   refusals. Assert each reachable code at its own site, with the rule it
   enforces named — `cantrip_takes_no_slot`, `conflicting_slot`, `no_scene` and
   the mount family first, because those are the ones a caller meets.
4. **A finding is a finding.** If asserting a code reveals it is unreachable,
   misspelled, duplicated across two different rules, or returned where a
   different code belongs, that goes in the digest — it does **not** get fixed
   in this diff, because a refusal code is observable behaviour.

### Architecture constraints

- **No engine source change**, except a code that turns out to be dead and is
  removed with its reason stated — and if that is more than one or two, stop
  and report instead.
- Do not rename a refusal code. A caller may be branching on it.
- Do not weaken a refusal to make it easier to assert.

### Acceptance criteria

1. The sweep exists, is derived from the source rather than hand-listed, and
   fails in both directions — driven by a synthetic added code and a synthetic
   stale allowlist entry.
2. The unasserted count is reported before and after, and the remainder is the
   allowlist with its reasons.
3. Every newly asserted code has a test that reaches it through the public API,
   not by calling an internal helper.
4. The whole gauntlet passes; both frozen logs untouched; `COVERAGE.md`
   regenerated with no diff.

### Dependencies

None. It reads the source as it stands and does not change it.

### Likely file surface

A new sweep beside `invariants.test.ts` or in it; several existing test files
gaining cases; `CLAUDE.md` only if a rule turns out to be recorded wrongly.

### Out of scope

Renaming or restructuring refusal codes; the feature-definition validator;
per-event field schemas; fixing any behaviour a new assertion reveals — that is
a finding for the digest.

### Known risks

- The temptation is to assert a code by calling the function that returns it
  directly. That proves the string exists, not that the rule holds. Acceptance
  criterion 3 is the guard, and the reviewer should check it hardest.


## Merge record

Merged to `main` as `ad4f0a6`, fast-forward, pushed. First-round PASS at high
confidence. **36 unasserted refusal codes before, 1 after.** 6,434 tests.

**The audits' own number was wrong in both directions, and that is the finding
that outlives the task.** Both the third audit (46 of 162) and the fourth
(41 of 112) counted with a line-based grep, which cannot see an `err(` whose
code sits on the next line: **113 codes seen where the source has 170.** And
`no_scene` and the mount family — which this brief named as unasserted,
quoting the fourth audit — **were already asserted**: IE-016 closed them
through table-driven and helper-parameter assertions the audit's tighter net
could not see.

So a measured figure, carried across two audits and into a brief, was wrong in
both directions at once. The lesson is the one this repository keeps
re-learning and has now written into `WORKFLOW.md` twice: **derive it, do not
quote it.** The builder re-derived rather than taking the brief's number, which
is what the task asked for and is why the error surfaced at all.

**Seven unreachable or shadowed codes were found and correctly not fixed**, as
the brief required — `nothing_to_interrupt` is answered by `no_trigger` first;
`not_a_combatant` at `dash` is shadowed by `unknown_combatant`; `bad_key`
cannot be returned by `declareResourcePool` at all, because an empty key
reaches the reducer and throws a corrupt log instead of returning a value; and
`no_trigger` carries **five distinct rules across three modules**, which is the
brief's "duplicated across two rules" case inverted. Each is a finding rather
than a diff, because a refusal code is observable behaviour and a caller may
branch on it.

**One deviation, ratified.** The brief attached a narrow condition to
`CLAUDE.md` — "only if a rule turns out to be recorded wrongly" — and the
builder added a 67-line section describing the new sweep, which is not a rule
correction. **That condition contradicted the standing builder instruction to
record what was built and why**, which is the sixth self-contradicting brief of
this tranche and the first between a brief and the agent definition rather than
within one document. Every sweep in this repository carries a paragraph in that
file; this one should too. The reviewer independently verified every checkable
claim in the section.

The thirteen conditions: 1 inside the brief · 2 COMPLETE · 3 PASS at high,
first round · 4 no defects · 5 gauntlet ✓ · 6 `COVERAGE.md` byte-clean, no
definition touched · 7 no blocker · 8 one deviation, ratified above · 9 **zero
engine source lines changed** · 10 no scope expansion · 11 no conflict ·
12 gauntlet re-run on `main`: typecheck ✓ lint ✓ **6434/6434** ✓ coverage
byte-clean ✓ · 13 GREEN.
