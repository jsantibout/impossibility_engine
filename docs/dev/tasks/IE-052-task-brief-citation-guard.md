# IE-052 — A citation guard over task briefs

state: APPROVED_FOR_IMPLEMENTATION
lane: tooling
tranche: 7
parallel-safe: YES — `docs/dev/` is read, never written; the guard and its test are new files
depends-on: none
worker: none
approved: 2026-09-14 — "APPROVE TRANCHE 7."
merge-approved: none

## Brief

### Objective

Point IE-022's citation mechanism at `docs/dev/tasks/*.md`, so that a brief
naming a source that does not exist, or quoting a run that is not in the file it
names, fails **before** a builder is launched.

### Why now

Tranche 6 shipped eight foreman brief errors. Every one was caught by a builder
or reviewer reading the source — defence in depth working — but the rate is
evidence that the mechanically detectable subset should fail earlier.

**Size the claim honestly, because the foreman has already checked it and the
honest answer is smaller than the headline.** Classified against the eight:

| Class | Count | Catchable here? |
|---|---|---|
| A named module path that does not exist (`fold/casting`, `fold/creatures`) | 2 | **yes** |
| Stale `file:line` references after `main` moved | several | **yes**, weakly — the line, not the meaning |
| An SRD run quoted **accurately** but with scoping words elided (IE-048's dismissal clause) | 1 | **no** — the run is verbatim in the file |
| A claim about engine state that had gone stale | 2 | no |
| A design imprecision (an anchor presupposed; a spell that cannot be readied) | 3 | no |

So this guard catches **stale and fabricated references**, which cost a builder a
round of confusion each time, and it does **not** catch the class that did the
real damage. Build it for what it is; do not let the docstring imply otherwise.

### Current relevant architecture

- `packages/engine/src/blocked-on.test.ts` — `CITED_SOURCES` (a small alias
  table, deliberately not "any file in the repository"), `citationsIn(where,
  prose)`, the elision handling, and the eight-character floor with its written
  reason. The mechanism is already parameterised over a corpus and a prose
  string, which is why this is reuse rather than new machinery.
- **`SRD` is in that table carrying no files, deliberately** — a note that names
  a repository design document and quotes the book must not have the book's
  sentence looked up in that document, and spell quotations already have their
  own guard in `spell-honesty.test.ts` against that spell's own paragraph.
- **`CITED_SOURCES` no longer carries `claude.md`.** The architecture moved out
  of `CLAUDE.md` into `docs/design/` and `docs/rules/`, which are registered
  individually; `claude.md` was removed because nothing cites it any more, with
  the restore condition recorded in the file. A brief citing `CLAUDE.md` for a
  subsystem paragraph is therefore now itself a brief error this guard should
  catch — which is the strongest available argument for building it.
- `packages/srd/raw/*.md` — the rules text a brief actually quotes. Six of the
  eight errors quoted *rules sections* (Longer Casting Times, the Duration
  forms, Ready's casting time), not spell paragraphs, so
  `spell-honesty.test.ts`'s instrument does not cover them.

### Required behaviour

1. A guard over `docs/dev/tasks/*.md` that, for each brief:
   - resolves every **source it names** and fails if the source does not exist;
   - holds every **quoted run of eight characters or more** against the file
     that brief named, and fails if the run is not there.
2. **Resolution is by naming, never by search.** The owner's constraint: the
   guard validates the source the brief actually names, not "similar wording
   somewhere in the repository". Reuse `CITED_SOURCES`' shape.
3. **The SRD raw files become resolvable for this corpus**, which is the one
   genuine extension. `spells.md`, `rules-glossary.md` and their siblings under
   `packages/srd/raw/` resolve to those files. The existing empty-`files` entry
   for `SRD` in the *notes* corpus is correct for that corpus and stays as it
   is — say in a comment why the two corpora differ, so the next reader does not
   "fix" one to match the other.
4. **Repository paths a brief names are checked for existence** — a backticked
   path ending in a known source extension, and a `path:line` reference whose
   line is out of range. That is the class that cost tranche 6 two launches.
5. **No new manually maintained inventory.** Nothing in this task may introduce
   a hand-kept list of rules, sources or spells; the alias table is a small
   resolution table, and the corpus is a directory listing.
6. The guard runs in the suite, so it fails in the gauntlet before a launch.

### Architecture constraints

- resolve by naming, never by corpus-wide search;
- one marker/floor convention shared with the existing guards rather than a
  second;
- a brief that cites nothing passes — this is a guard on claims made, not a
  requirement to make claims.

### Acceptance criteria

1. Driven over **synthetic** briefs in both directions: one naming a file that
   does not exist; one quoting a run absent from the file it names; one whose
   quoted run is present in a *different* repository file but not the named one
   (this is the case that proves resolution is by naming); one citing nothing;
   and one wholly correct brief that must pass.
2. Run against the **real** `docs/dev/tasks/` corpus. Every failure it reports
   is either fixed in that brief or is a true finding recorded in the digest —
   do not weaken the guard to make the corpus pass.
3. A `path:line` reference out of range fails; a correct one passes.
4. The eight-character floor and the elision handling behave as the existing
   guard's do, and the digest says whether any shared helper was extracted or
   duplicated — if duplicated, why.
5. `npm run typecheck`, `npm run lint`, the full suite, `COVERAGE.md`
   byte-clean.

### Tests and conformance

The guard is the conformance. `docs/dev/WORKFLOW.md` gains a line saying briefs
are checked this way — **the foreman writes that**, not the builder.

### Dependencies

None. Wave 1; it touches no engine code and collides with nothing.

### Out of scope

Anything that would stop a builder independently reading the SRD — the defence
in depth is foreman-cites, guard-checks-mechanically, builder-verifies,
reviewer-verifies, and this task is the second link only. Checking that a quote
*means* what the brief claims. Rewriting the eight tranche-6 briefs.

### Known risks

The real risk is overreach: a guard that tries to judge meaning will produce
false positives, and a guard with false positives gets disabled. Keep it to
existence and verbatim presence.
