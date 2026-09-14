# IE-052 — A citation guard over task briefs

state: CHANGES_REQUIRED
lane: tooling
tranche: 7
parallel-safe: YES — `docs/dev/` is read, never written; the guard and its test are new files
depends-on: none
worker: qb-builder, launched 2026-09-14 from `f00742a` (wave 1)
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
| A named module path that does not exist (tranche 6 named two under the fold that were never there) | 2 | **yes** |
| Stale `file:line` references after `main` moved | several | **yes**, weakly — the line, not the meaning |
| An SRD run quoted **accurately** but with scoping words elided (IE-048's dismissal clause) | 1 | **no** — the run is verbatim in the file |
| A claim about engine state that had gone stale | 2 | no |
| A design imprecision (an anchor presupposed; a spell that cannot be readied) | 3 | no |

So this guard catches **stale and fabricated references**, which cost a builder a
round of confusion each time, and it does **not** catch the class that did the
real damage. Build it for what it is; do not let the docstring imply otherwise.

**Why this table stopped spelling those two paths in backticks.** It used to,
and the guard this task builds then reported its own brief twice — correctly, by
its own rule, because a backticked path is a citation and the guard cannot know
the brief is *illustrating* a bad one rather than making it. The distinction
between mentioning a reference and using one is real, it is older than this
repository, and a guard that reads prose cannot draw it. So the brief stops
using the form it is describing. **That is the cost of this instrument stated
honestly**, and it is one of the two reasons the foreman ruled the guard a
report rather than a gate — see the ruling in the digest below.

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

## Foreman's ruling on required behaviour 6 — 2026-09-14

**The builder stopped correctly and the reviewer classified it correctly.**
Three rounds closed without a PASS on one point: requirement 6 says *"the guard
runs in the suite, so it fails in the gauntlet before a launch"*, and the guard
runs in the suite without failing it. The reviewer's own line is
`Escalation reason: none — the design is sound and follows established
architecture; the open question is a brief-compliance ruling, not an
architectural one.` That makes it **GREEN and the foreman's**, not a Fable
YELLOW and not an owner RED, and it is ruled here rather than carried.

**Ruling: option (b). The guard is a report, not a gate. Requirement 6 is
ratified as unmet, explicitly, rather than left silently unsatisfied.**

### The decisive reason, which is not in the builder's three options

Gating the suite on the brief corpus **couples every builder's baseline to the
prose of every other live brief**. A builder is instructed to verify a green
baseline before changing anything and to stop and report if it is red. So a
mis-worded sentence in an unrelated task's brief would halt a task that has
nothing wrong with it, and the builder would be right to stop.

**This repository has already been burned by exactly that shape.** `LATER`
records it about `persistence-2.test.ts`: *"a builder is told to stop on a red
baseline, so a flake there can halt a task that had nothing wrong with it."*
Three builders met that independently. Requirement 6 was written without this
consequence in view; it asks for a gate in the one test run that is shared by
every worker in the system.

### The two supporting reasons

- **The false-positive classes are structural to what a brief is.** The reviewer
  *demonstrated* two: a brief naming a file the task will **create**, and a brief
  quoting prose it instructs the builder to **add** to a named document. A brief
  describes the future; a citation guard checks the present. IE-050's brief said
  the reducer would gain per-domain modules under `fold/` — backtick those paths
  and a correct brief reds the gauntlet. **A guard with false positives gets
  disabled**, which this task's own Known Risks section names as the real danger.
- **The repository already splits exactly this way, for this directory and this
  owner.** `check-queue.mjs` is a command and `check-queue.test.ts` is the suite
  that tests it; the reasoning is written down at `check-queue.test.ts:15–32`.
  This is that precedent, not a new convention.

### The honest weakness, and what is done about it

Option (b)'s cost is that **a foreman who forgets the command gets nothing** —
and the foreman ruling on it is the same one who read past IE-042 in twelve
consecutive validator summaries. Ratifying a report and trusting attention is
the shape that failed. So the ruling carries two things rather than one:

1. `npm run check:briefs` is written into `docs/dev/WORKFLOW.md` at the step
   where a brief is written, not left to memory.
2. **The real fix is to put the findings in the state a fresh session reads
   first** — `check-queue.mjs`'s summary, which `/qb` injects at session start.
   That cannot be done in this tranche: IE-058 owns that file right now, and one
   owner per primitive is the rule. It is recorded in `LATER` for the next
   cycle. Note what it is *not*: printing it in a longer summary is what failed
   for IE-042, so the follow-up has to make the validator **refuse**, the way
   IE-058 makes closure refuse.

**The switch stays in the code, unflipped and documented**, at
`brief-citations.test.ts` with its reasoning beside it. If a later cycle decides
the gate is worth its cost, it is one line.

### The other two deviations — both accepted

**Corpus scoped to briefs that are not `DONE`.** The brief said "for each
brief"; a closed brief cannot launch a builder, and the state is read off the
field `check-queue.mjs` already owns rather than a new list. Over the 48 closed
briefs the guard reports **188 findings, 184 of them quotations** — and almost
all of those are sentences that were in `CLAUDE.md` until its architecture was
extracted into `docs/design/` on 2026-09-14. **That is a consequence of the
foreman's own refactor**, surfaced by an instrument built the same day: the
historical record now cites a document that no longer contains what it quoted.
It launches nothing and it is not fixed here, but it is recorded rather than
discovered again later.

**Attribution is every document a unit names, not the nearest named before the
run.** A considered departure from IE-022's rule, and **measured rather than
argued**: on the live corpus the two rules cost one finding each and they are
not the same finding — nearest-preceding reports a false positive and misses the
real stale citation. Accepted on the evidence.

### The instrument caught the foreman

The guard's third live finding is `IE-054`, attributing to `CLAUDE.md` the run
*"outside combat there are no turns for it to be the end of, so nothing is
scheduled and the caller is told"*. The foreman had found that citation by hand
this morning and written into IE-054 that **the sentence is not in the
repository**. That was wrong. The sentence is the docstring on `scheduleDelayed`
at `packages/engine/src/commands/spell-effect-riders.ts:49` — verbatim, in the
very function IE-054 is about. The brief cited a **real sentence to the wrong
source**.

**This is a better argument for the task than the one its brief makes.** A
corpus-search guard passes that citation, because the run is present somewhere.
Only resolution *by naming* fails it. The foreman's hand-check produced the
right conclusion from the wrong evidence; the instrument produced the right
evidence. IE-054's brief is corrected.

### What the foreman changed in `docs/dev/`, which the builder may not write

- `IE-054` — the false claim corrected, and the builder now rewrites **two**
  places: the exemption list in `docs/design/time-and-turns.md` and the
  `scheduleDelayed` docstring that states the old rule.
- `IE-052` — the classification table stops spelling its two illustrative paths
  in backticks, with a paragraph saying why: a backticked path is a citation, and
  a guard reading prose cannot tell a reference being *mentioned* from one being
  *used*. The brief stops using the form it describes. That cost is stated rather
  than hidden, and it is one of the two reasons for this ruling.
