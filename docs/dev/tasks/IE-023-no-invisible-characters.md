# IE-023 — No invisible characters, and a validator that is itself tested

state: APPROVED_FOR_IMPLEMENTATION
lane: tooling
tranche: 5
parallel-safe: YES — a new guard, `CLAUDE.md`'s prose, and `docs/dev/check-queue.mjs`; no engine module
depends-on: none
worker: none
approved: 2026-09-14 — "APPROVE TRANCHE 5"
merge-approved: none

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

## Risk gate

## Architecture decision

## Merge record
