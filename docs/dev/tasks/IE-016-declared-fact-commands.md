# IE-016 — The other nine facts a DM declares

state: IMPLEMENTING
lane: mechanism
tranche: 4
parallel-safe: YES beside union and conformance work — it is commands over existing pure functions and existing events; NO beside IE-012, which establishes the module and the pattern
depends-on: IE-012
worker: qb-builder · C:/Users/justi/Code/QuestBarrel/ImpossibilityEngine/.claude/worktrees/agent-a47b4e98980d2a158 · worktree-agent-a47b4e98980d2a158
approved: 2026-09-13 — "APPROVE TRANCHE 4"
merge-approved: none

## Brief

### Objective

Finish what IE-012 starts: give the remaining nine event types that no command
emits their commands, so that **every one of the 91 declared event types is
reachable from the command layer.**

### Why now

IE-009 derived that 17 of 91 declared event types are emitted by no command,
and its reviewer reproduced it independently. IE-012 takes the eight that are
scene setup, because without them nothing above the engine can start an
encounter. **These are the other nine**: `creature-side-declared`, `mounted`,
`dismounted`, `free-interaction-used`, `initiative-swapped`, `stabilised`,
`creature-died`, `items-lost`, `bonus-removed`.

They are a second family with the same shape and a weaker claim, which is why
they are a separate task rather than a widening of IE-012: each is a fact a DM
declares rather than an outcome the engine computes, each is hand-written
throughout the existing suite, and none of them blocks starting a fight. What
they do block is **a tool surface reaching them at all** — and the fourth audit
settled the boundary argument IE-012 carries: a tool surface calls commands and
never folds events itself.

### Current relevant architecture

- **IE-012's `commands/scene.ts` is the pattern**, and this task follows it
  rather than inventing a second one. Read what it did about validation reuse,
  `once`, `mayAct`, the barrel and the two derived sweeps, and do the same.
- The pure functions behind each event, where one exists — `mount`, `dismount`,
  `stabilise`, and the reducer arms for the rest. Some of these nine have no
  pure function at all, only a reducer arm; for those the command validates and
  emits directly, and the digest says which were which.
- `CLAUDE.md` records several of these rules already: a Reaction refreshes at
  the start of your next turn; Alert's Initiative swap is not modelled;
  **death that is not hit-point loss gets its own event** because damage is the
  wrong instrument. Read those before writing a refusal.

### Required behaviour

1. One command per event, in the module IE-012 established or a sibling beside
   it, each taking a `CommandIdentity`, each going through `once`, each
   emitting an event the reducer already folds.
2. **`mayAct` is applied where the fact is an action and not where it is a
   declaration.** `free-interaction-used` is a turn-economy fact and
   `mounted`/`dismounted` cost movement; `creature-side-declared`,
   `creature-died`, `items-lost` and `bonus-removed` are declarations. Decide
   each on the rule rather than on the family, say so per command, and put the
   declarations on the action-economy allowlist with their reason.
3. **`initiative-swapped` is Alert's swap**, which `CLAUDE.md` records as not
   modelled. The command emits the event a DM declares; it does not implement
   the feat's offer. Say that in the note.
4. Where a fact is durable and a contradicting re-declaration would corrupt the
   log, the refusal is the existing one — `declareCreatureType`'s
   `type_established` is the model.
5. Both derived sweeps in `invariants.test.ts` enumerate whatever module these
   land in, and their samples must still bite.

### Architecture constraints

- No new event type, no change to `events.ts` or the reducer, no change to any
  existing pure function's behaviour.
- Both frozen logs must fold unchanged — they hand-write several of these
  events today and must keep working.
- Do not implement Alert's Initiative swap, mounted-combat rules beyond what
  `mount`/`dismount` already do, or death saves. This task is the command
  surface, not new mechanics.

### Acceptance criteria

1. Each command has a test that emits and folds, and a retry test under one id
   that emits nothing.
2. **A sweep asserts that every one of the 91 declared event types is now
   emitted by some command**, with a written exemption for any that is not —
   and the digest names the exemptions. That assertion is the task's real
   deliverable: it closes the class rather than the instances.
3. Both `invariants.test.ts` sweeps see the module; both allowlists come out
   with the intended additions and their reasons.
4. Both frozen logs fold unchanged; the whole gauntlet passes.

### Dependencies

**IE-012**, for the module and the pattern. This task rebases over it.

### Likely file surface

`packages/engine/src/commands/scene.ts` or a sibling, `commands.ts` (the
barrel), `invariants.test.ts`, a test file, `CLAUDE.md` (the event-log section
records how many types have no command; after this it should record zero, or
name the exemptions).

### Out of scope

Alert's Initiative swap as a feature; falling; mounted combat beyond the
existing functions; the tool surface itself, which is M2.

### Known risks

- Item 2's sweep is the part that could quietly pass. It must fail if a new
  event type is declared with no command and no exemption — drive that with a
  synthetic type, the way the other derived sweeps drive theirs.
