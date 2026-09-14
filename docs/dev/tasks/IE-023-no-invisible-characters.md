# IE-023 — No invisible characters, and a validator that is itself tested

state: DONE
lane: tooling
tranche: 5
parallel-safe: YES — a new guard, `CLAUDE.md`'s prose, and `docs/dev/check-queue.mjs`; no engine module
depends-on: none
worker: none
approved: 2026-09-14 — "APPROVE TRANCHE 5"
merge-approved: 2026-09-14 — "APPROVE TRANCHE 5" (tranche 5 authority; 13/13 conditions green)

## Brief

### Objective

Refuse C0 control characters in tracked text, fix the one that is left, and
give `check-queue.mjs` a self-test so the signal it prints is exercised rather
than assumed.

### Why now

A stray `U+0008` in the validator's regex meant `WHOLE_ENGINE_AUDIT_RECOMMENDED`
matched nothing, so **the one signal the manual-audit design leaves the foreman
was invisible to every fresh session** from the moment it was written. The
regex is fixed. The same invisible character is still sitting in `CLAUDE.md`,
where it makes the file misquote the very guard it is describing.

`CLAUDE.md:5894` prints the emitted-event-type regex with a literal backspace
where a backslash-b belongs. The real regex, at
`packages/engine/src/invariants.test.ts:2570`, is built from the string
`\btype: '` plus the type plus `'`.

The class of failure is "a guard nobody has seen fire", which this tranche has
now met twice. A character nobody can see, in a file whose whole subject is
claims that are checked, is the cheapest possible instance.

### Current relevant architecture

- `docs/dev/check-queue.mjs` — 313 lines, no test of its own. It is the first
  thing a fresh session reads.
- `CLAUDE.md:5894` — the one remaining occurrence in the repository's tracked
  text, confirmed by a scan for C0 controls other than tab, LF and CR.
- `packages/engine/src/invariants.test.ts:2570` — the regex `CLAUDE.md` is
  quoting.

### Required behaviour

1. A check in the gauntlet refusing C0 control characters other than tab, LF
   and CR in tracked `*.md`, `*.ts`, `*.mjs` and `*.json`. It names the file,
   the line, and the code point. Driven by a synthetic case it must catch.
2. Fix `CLAUDE.md:5894` so it quotes the real regex.
3. A fixture-driven self-test of `check-queue.mjs`: given a queue whose audit
   section carries the flag, the summary prints it; given one without, it does
   not; and a malformed task file is reported rather than skipped. The
   validator must stay runnable with no arguments against the real queue.

### Architecture constraints

- **`docs/dev/QUEUE.md` is the foreman's file and is not yours.** Its own copy
  of the character is removed by the foreman before this task launches, so the
  guard will pass on `main`. Do not edit `QUEUE.md`, `PROGRESS.md`, or any task
  file under `docs/dev/tasks/`.
- `check-queue.mjs` **is** in scope: it is an instrument rather than queue
  state, and the foreman does not edit it during a tranche.
- The guard must not read `node_modules`, `.git`, or untracked files. Use the
  tracked set.
- Do not "fix" a control character by deleting the sentence around it.

### Acceptance criteria

1. The guard fails against a synthetic file containing a backspace character
   and passes on the repository as it stands after the `CLAUDE.md` fix.
2. `CLAUDE.md`'s quoted regex matches the one `invariants.test.ts` builds,
   character for character.
3. The validator self-test fails if the flag's regex is broken again — restore
   the stray character in a fixture and watch it fail.
4. `node docs/dev/check-queue.mjs` still exits 0 against the real queue.
5. `npm test`, `npm run typecheck`, `npm run lint` green.

### Tests and conformance

The control-character check may be a test or a script, whichever the gauntlet
runs; say which and why in the digest. The validator self-test needs fixture
queue and task text, not the real files.

### Dependencies

None.

### Likely file surface

A new guard (test or script), `CLAUDE.md` (one line),
`docs/dev/check-queue.mjs` (only if a test needs it to be importable), and a
new test for the validator.

### Out of scope

`docs/dev/QUEUE.md` and every task file. Any change to what the validator
validates — this gives it a test, it does not give it rules.

### Known risks

Making `check-queue.mjs` importable may tempt a refactor of it. Keep the change
to whatever a test needs in order to call it; the CLI behaviour is what a fresh
session depends on.


## Completion digest

Builder **COMPLETE**, reviewer **PASS at high confidence on round one**, no
defects, no deviations, no foundational primitives. Branch
`worktree-agent-a9d196d2b8ae373da`, commit `f146d81`, rebased by the foreman to
`024c8fd`. Tests **6786 → 6796 on `main`**, 10 new across two files.

Four files, all inside the brief's stated surface: the C0 guard
(`control-characters.test.ts`, reading the tracked set through `git ls-files -z`
and reporting `file:line: U+XXXX`), the validator's self-test
(`check-queue.test.ts`, driving the **real CLI** with `spawnSync` over throwaway
fixtures so the exit code is asserted too), one expression in
`check-queue.mjs` so a test can point it at a fixture directory, and the one
`CLAUDE.md` line.

Four mutations, each watched failing — and the fourth is not a mutation at all:

- Reverting the `CLAUDE.md` fix makes the sweep report the character by name.
  That was the **reproduction, written before the fix**.
- Narrowing the refused range fails the synthetic case.
- **Restoring the stray character after `RECOMMENDED` in the validator's regex
  — the original defect, exactly — silences the `Audit:` line while the exit
  code stays 0**, and fails the flag case and nothing else. That is the guard
  finally seeing the failure it was written for, a day after the failure.
- **The guard caught the task that built it.** The tool that wrote its source
  decoded the `\uXXXX` escapes into six *real* control characters. The sweep
  could not see them while the file was untracked, and failed naming all eight
  the instant it was staged. Fixed by writing the escapes through a script that
  cannot decode them; the committed file is clean, and I verified independently
  that no tracked file in the worktree carries one.

## Risk gate

**Lightweight.** No architectural deviation, no foundational primitive, no new
runtime special case, no file outside the brief's surface, and a reviewer
`PASS` at high confidence on the first round. No engine source file is in the
diff at all.

One thing checked by hand rather than taken on trust, because the reviewer
flagged that `main` had moved and `CLAUDE.md` had shifted: **the one-character
edit survived the rebase and landed on the right line** — the quoted regex now
reads what `invariants.test.ts` builds — and a scan of the whole rebased
worktree finds no C0 control character anywhere. `node docs/dev/check-queue.mjs`
was run against the real queue after the merge and exits 0.

Classification: **GREEN**.

### Three declared concerns, and what the foreman decided

1. **No `CLAUDE.md` prose, and that is deliberate rather than an omission.**
   The builder followed the brief and the launch message, both of which scoped
   `CLAUDE.md` to the single line, and then flagged the departure from the
   standing rule rather than deciding for itself — the right instinct, and the
   second builder tonight to make that call. **The foreman's decision is to add
   none.** `CLAUDE.md` earns its length on rules that are easy to get wrong;
   "do not put control characters in tracked files" is not one, it is now
   enforced mechanically, and the guard's own docstring carries the reasoning
   and the incident. Three integration prose additions by the foreman in one
   night is itself a pattern, and the delta audit's warning about accretion in
   that file is recent enough to take seriously.
2. **The self-test asserts the summary's shape and deliberately not exit 0 for
   the no-argument case**, because pinning the foreman's live queue to be
   problem-free would redden the engine suite for reasons no builder controls.
   That reasoning is exactly right and is endorsed: a test that fails because
   somebody else's bookkeeping is mid-edit teaches people to ignore it.
   Criterion 4 is verified by hand instead — by the builder, by the reviewer,
   and again by the foreman on `main` after the merge.
3. The guard shells out to `git ls-files`, argued in its docstring as the only
   non-rotting way to get the tracked set. Accepted; CI runs on a git checkout.

## Architecture decision

None. No Fable involvement.

## Merge record

Merged to `main` as `024c8fd`, fast-forward, pushed. Rebased by the foreman
over five merges; `CLAUDE.md` had moved and the edit landed correctly, verified
character by character.

`main` verified after the merge: typecheck ✓, lint ✓, **6796 tests across 108
files** ✓, `COVERAGE.md` byte-clean ✓, validator exits 0 ✓, tree clean.

Thirteen conditions: **1** inside the brief; **2** `COMPLETE`; **3** `PASS`,
high, round one; **4** no defects; **5** gauntlet green; **6** conformance;
**7** no blocker; **8** no deviation; **9** no foundational primitive; **10**
no file outside the surface — and `docs/dev/check-queue.mjs`, the one
`docs/dev/` path touched, is in scope by the brief, with `QUEUE.md`,
`PROGRESS.md` and every task file untouched; **11** clean rebase; **12**
re-verified on `main`; **13** risk gate lightweight, GREEN.
