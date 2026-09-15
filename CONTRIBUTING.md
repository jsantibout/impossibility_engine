# Working on this together

Two people, two branches, one `main` that is always the thing you can both
branch from. Land small pull requests daily and there is no integration
event at the end of the week.

## Before you push

```bash
npm run typecheck && npm run lint && npm test && npm run coverage
git diff --exit-code COVERAGE.md
```

CI runs the same plus a forced clean build and an SRD re-ingest, on Node 22
and 24, and fails on any generated file that differs from its source.

## Who owns what

The split is by **package**, because packages are what the dependency
direction protects.

| | Owns |
|---|---|
| **A — content** | `packages/content/`: the spell definitions, the twelve class files, species, backgrounds, feats, items, and the content tests and scripts beside them (`coverage`, the SRD oracle, the missing-shape map, `COVERAGE.md`) |
| **B — mechanism** | `packages/engine/`: the commands, the fold, the event union and state, the vocabularies at the top of `spell-definitions.ts` and `progression.ts`, the validators, the registry |

Content never edits the engine; a spell or feature that needs a mechanic the
engine lacks is a request to B, stated as the SRD sentence that needs it.
The engine never names content: the sweep in `spell-schema.test.ts` fails on
a class name, a spell id or a fixed grant anywhere under `packages/engine`.

Announce before touching `packages/shared/src/dnd.ts`,
`packages/shared/src/result.ts`, `character.ts`, or the `GameEvent` union:
each is a forty-file mechanical diff.

## Five rules, each learned the hard way

1. **Never regenerate a frozen log** — `packages/engine/fixtures/golden-log.json`
   or `golden-log-2.json`. Their value is that nothing regenerates them. A
   rules change that moves what they fold to is a migration: change the
   expectation in the same commit and say which stored campaigns move.
2. **Always regenerate `COVERAGE.md`** before pushing. CI fails otherwise.
3. **Grep before adding content.** Two parallel sessions once both wrote
   Vitriolic Sphere; `createContent` now refuses a duplicate id loudly, but
   the merge conflict is still yours.
4. **One logical change per PR.** A PR that adds a spell *and* changes the
   reducer can be neither reviewed nor reverted.
5. **Rebase on `main` at least daily**, even mid-branch.

## When something conflicts

Five paths are `merge=binary` in `.gitattributes` and will not auto-merge:
`COVERAGE.md`, `package-lock.json`, `packages/srd/src/*-index.ts`, and the
two golden logs. Each is regenerated rather than merged:

| Conflicted | Resolution |
|---|---|
| `COVERAGE.md` | take either side, then `npm run coverage` |
| `package-lock.json` | `git checkout --ours package-lock.json && npm install` |
| `packages/srd/src/*-index.ts` | take either side, then `npm run srd:ingest && npm run srd:index` |
| the golden logs | take `main`'s copy untouched |
| `SPELL_DEFINITIONS`, `SRD_CLASSES` | keep both lines in id order; the tests catch a dropped or duplicated entry |
| the `GameEvent` union and a fold seam | keep both members and both `case` arms; a missing arm is a compile error |

After a non-trivial resolution, run the full gauntlet, and if the conflict
was in logic rather than a list, mutate the merged code and confirm a test
still fails.

## Agents

An agent session follows this file and `CLAUDE.md`. The workflow for
delegated work is `docs/dev/WORKFLOW.md`: an owner-approved brief, a builder
in its own worktree, an independent review, and a merge by the coordinating
session only.
