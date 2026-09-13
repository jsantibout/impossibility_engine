# Working on this together

Two people, two branches, one `main` that is always the thing you can both
branch from.

The short version: **the graceful merge is the one that never happens.** Land
small pull requests daily and there is no integration event at the end of the
week, because everything is already in. Everything below exists to keep that
true.

## Before you push

```bash
npm run typecheck && npm run lint && npm test && npm run coverage
git diff --exit-code COVERAGE.md
```

CI runs the same thing plus a forced clean build, on Node 22 and 24. It also
regenerates the SRD indexes and fails on any difference, so a stale generated
file is caught before review rather than after.

## Who owns what

The split is by **file**, not by feature, because files are what git resolves.

### A — content

Pours spells into the shapes that already execute. Owns:

| Path | Notes |
|---|---|
| `packages/engine/src/spell-definitions.ts` | Definitions and the registry — everything from the first definition down |
| `packages/engine/scripts/coverage.ts` | The `VERIFIED_SPELLS` list |
| `spell-catalogue.test.ts`, `spell-effects.test.ts`, `spell-areas.test.ts`, `coverage.test.ts` | |
| `COVERAGE.md` | Regenerated, never hand-edited |

### B — mechanism

Builds the shapes and the engine underneath them. Owns:

| Path | Notes |
|---|---|
| `packages/engine/src/commands.ts` | |
| `packages/engine/src/events.ts` | The union, the reducer, `GameState` |
| `duration.ts`, `standing.ts`, `positioning.ts`, `combat.ts`, `conditions.ts` | |
| `spell-definitions.ts` — **the type declarations only** | `SpellEffect`, `SpellDefinition`, `ReactionTrigger`, `DiceScaling`, at the top of the file |
| `persistence.test.ts`, `invariants.test.ts`, `delayed-damage.test.ts`, `reaction-triggers.test.ts` | |

`spell-definitions.ts` is the one genuinely shared file, split down the middle:
**B owns the types at the top, A owns the definitions and registry below.** They
are about three thousand lines apart, so git merges them independently.

### The queue already divides this way

`PROGRESS.md`'s "Next actions" list is the work, and it splits cleanly:

| Item | Owner |
|---|---|
| 1–2. Pour spells into the tracked and working shapes (~100 spells) | **A** |
| 3. Target-anchored riders | **B** |
| 4. Ongoing effects a later turn acts through | **B** |
| 5. Counterspell and Feather Fall | **B** |
| 6. Summons | **B** |
| 7. Long casting times | **B** |
| 8. Classes — `creation.ts` and the twelve class files, isolated from both columns | *either*, as overflow |

A has roughly a hundred spells of independent work queued. That is the point:
**the content lane never waits on the mechanism lane.**

### Announce before touching these

`packages/shared/src/dnd.ts`, `packages/shared/src/result.ts`,
`packages/engine/src/character.ts`, and the `GameEvent` union. There are no
shared test fixtures — about forty test files each declare their own `SETUP`,
`sheet()` and `added()` — so a change to any of these is a forty-file mechanical
diff, and two of those overlap everywhere. Say so first, and land it alone.

## The daily loop

```bash
git checkout main && git pull
git checkout -b <a|b>/short-description
# … work, test-first, as CLAUDE.md requires …
git push -u origin <branch>

# At least once a day, even mid-branch
git fetch origin && git rebase origin/main
```

Five rules, each here because it has already gone wrong:

1. **Never regenerate either frozen log** — `packages/engine/fixtures/golden-log.json`
   or `packages/engine/fixtures/golden-log-2.json`. Their whole value is that
   nothing regenerates them. Re-running a generator to make
   `persistence.test.ts` or `persistence-2.test.ts` pass turns a compatibility
   test into a rubber stamp. The second fixture exists because the first
   predates most of the engine: between them they cover every event type the
   reducer declares, and `persistence-2.test.ts` names anything they do not.
2. **Always regenerate `COVERAGE.md`** before pushing. CI fails otherwise.
3. **Claim the item before you start.** One GitHub issue per item from
   `PROGRESS.md`, assigned. Two parallel sessions once wrote Vitriolic Sphere
   twice, and only a duplicate-symbol error caught it.
4. **One logical change per PR.** A pull request that adds a spell *and*
   refactors the reducer can be neither reviewed nor reverted.
5. **Open the PR as a draft on day one**, so the other person can see which
   files you are in before they collide with you.

## When something conflicts

The right resolution differs per file. Five of them will not auto-merge at all —
`.gitattributes` marks them `merge=binary` deliberately, so that git stops
rather than producing a plausible wrong answer.

| Conflicted | Resolution |
|---|---|
| `COVERAGE.md` | Take either side, then `npm run coverage`. Never hand-merge the numbers — a text merge of the totals produces arithmetic nobody computed. |
| `package-lock.json` | `git checkout --ours package-lock.json && npm install` |
| `packages/srd/src/*-index.ts` | Take either side, then `npm run srd:ingest && npm run srd:index` |
| `golden-log.json`, `golden-log-2.json` | Take `main`'s copy untouched. Never regenerate. |
| `SPELL_DEFINITIONS` | Keep both lines, in id order. Tests catch duplicates, mis-sorting, and an entry dropped while its definition stays. |
| `KNOWN_EVENT_TYPES` | Keep both, sorted. `persistence.test.ts` compares it against the union both directions. |
| `GameEvent` union / reducer switch | Keep both members **and both `case` arms**. A missing arm is a compile error. |
| `resolveEffects` if-chain | Keep both branches. A lost branch is a compile error. |
| `GUARDED` in `invariants.test.ts` | Keep both entries — a command missing from that list is an unguarded command. |
| `CLAUDE.md`, `PROGRESS.md` | Keep both sides' prose. Append-mostly; conflicts are cosmetic. |

**After any non-trivial resolution**, re-run the full gauntlet — and if the
conflict was in logic rather than a list, mutate the merged code and confirm a
test still fails. That is the discipline the rest of this repo already uses, and
a merge is exactly where it is easiest to skip.

## What the guards actually cover

Worth knowing, so you trust them the right amount:

- A **dropped registry entry** — the failure that compiles, lints and passes
  everything else — is caught by a test that reads the source and compares
  declared spells against registered ones.
- A **dropped effect-kind branch** is caught by `tsc`, not at runtime.
- A **stale generated file** is caught by CI, not by review.
- A **scrambled list** is caught, because the tests either side of those lists
  compare sets and would not have noticed.

## AI builders

AI implementation runs the same way, with the roles split by authority rather
than by lane: an Opus **foreman** session prepares briefs, holds the risk gate
and integrates, Opus **builders** implement one approved task each in a
worktree under `.claude/worktrees/`, an independent Opus **reviewer** checks
each result and returns ordinary defects to the builder, and Fable is the
**architect on call** for a bounded architectural question or the periodic
audit. The owner approves a **tranche** of roughly 3–5 tasks; inside it, work
that satisfies the thirteen conditions in `docs/dev/WORKFLOW.md` is merged by
the foreman without a further gate. Builders and reviewers obey every rule on
this page — the lanes, the five daily rules, the playbook — and one more: they
never merge, push, or edit `PROGRESS.md` or `docs/dev/`. The procedure is
`docs/dev/WORKFLOW.md`; the live state is `docs/dev/QUEUE.md`.
