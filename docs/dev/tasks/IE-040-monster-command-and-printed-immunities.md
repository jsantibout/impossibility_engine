# IE-040 — A monster enters through a command, with its printed condition immunities

state: DONE
lane: mechanism
tranche: 6
parallel-safe: CONDITIONAL — `commands/creatures.ts`, `commands/conditions.ts`, `monster.ts`, `fold/creatures`; not beside IE-042
depends-on: IE-039
worker: none
approved: 2026-09-14 — "APPROVE TRANCHE 6."
merge-approved: 2026-09-14 — "APPROVE TRANCHE 6."

## Brief

### Objective

Add the command that puts a monster into a game, and make a stat block's
**printed condition immunities** reach state and be honoured.

### Why now

Two halves of one correctness gap, and the second is a shipped wrong number
with no symptom.

`adaptMonster` produces `defenses.conditionImmunities` and
`conditionApplicability` answers three ways — and **nothing outside
`monster.ts` calls either**. Verified on `main`: every caller is a test file.
`creature-added` carries `sheet`, `maxHp`, `creatureType`, `defenses` (damage
types only) and `side`, and `applyConditionTo` consults an `immuneTo` list its
caller supplies. So **a Zombie is Poisoned by Ray of Sickness like anybody**,
and M2's tool surface has no way to add a monster without folding an event
itself — the one thing the layer above the engine must never do. This is the
fourteenth recorded instance of a pure function nothing calls, and the largest
since the scene commands.

It is also the storage a **granted** condition immunity joins as the seventh
sourced family (IE-042), and the first half of summons. Printed first, granted
second, not the reverse.

### Current relevant architecture

- `monster.ts:31` `conditionImmunities` on the adapted defences; `:186`
  `adaptMonster` fills them; `:270` `conditionApplicability` reads them and
  answers `allowed` / `immune` / `needs-adjudication` with the qualification
  attached.
- `events.ts:1065` (after IE-039, `state.ts` / the union) — `creature-added`.
- `commands/conditions.ts:34` — `applyConditionTo`, whose `immuneTo` comes
  from its caller.
- `commands/creatures.ts` — where the command belongs.
- `commands/facts.ts` — `unknownCreature`'s written exemption, which says in
  its own words that it names an event because **adding a creature has no
  command**. This task ends it.

### Required behaviour

1. `addCreature` — a barrel command, through `once`, emitting `creature-added`
   (and `spellcasting-declared` where the stat block casts), wrapping
   `adaptMonster`. It refuses a creature already in the game and refuses an
   unknown stat block; it spends nothing and is therefore **not** guarded by
   `mayAct` — record it in `DECLARED_NOT_ACTED` with the sentence that exempts
   it, exactly as the scene commands are.
2. `creature-added` gains an **optional** `conditionImmunities`. Absent means
   none, so both frozen logs fold unchanged and no fixture is regenerated.
3. `CreatureState.conditionImmunities`, written from the event.
4. `conditionImmunitiesOf(state, who)` is the **one gatherer** — the
   `defensesOf` shape — and `applyConditionTo` reads it, so a caller's
   `immuneTo` argument becomes unnecessary. Removing that parameter is
   preferred; if a caller genuinely still needs to add one, the gatherer
   unions rather than the caller overriding.
5. **Qualified entries stay out of the automatic table.** "Charmed (except
   from its vampire master)" is `needs-adjudication` and comes back in
   `unverified`; it must not become an unconditional immunity, which is the
   documented wrong answer.
6. The `unknownCreature` context-request exemption in `invariants.test.ts`
   falls: the request now names `addCreature`, and the exemption is deleted
   rather than reworded.

### Architecture constraints

Settled; a deviation is `ARCHITECTURE_BLOCKED`:

- `addCreature` wraps `adaptMonster`; it does not reimplement any of it;
- one gatherer, read at `applyConditionTo`, not a second table;
- three-valued applicability preserved — an immunity the engine cannot
  evaluate is withheld and reported, never applied;
- the event field is optional, so no log is regenerated.

### Acceptance criteria

1. A Zombie added through `addCreature` **cannot be made Poisoned** by a spell
   that would otherwise impose it, and the refusal or no-op is asserted through
   the public resolution path rather than against the gatherer.
2. A Vampire Spawn's qualified Charmed immunity leaves the condition
   `allowed` and returns an `unverified` line naming the qualification.
3. `addCreature` is idempotent under one command id, and refuses a duplicate
   creature.
4. A scenario adds a monster, places it, rolls Initiative and fights it, with
   **no hand-written event anywhere in the test** — read off the test's own
   source, the way `scene-commands.test.ts` reads its own.
5. Both frozen logs fold unchanged.
6. The `unknownCreature` exemption is gone and `invariants.test.ts`'s
   `satisfyWith` sweep passes without it.

### Tests and conformance

The gauntlet. CLAUDE.md: the "Monsters State Their Numbers" section gains the
command and the immunity path; "Known Pending Work"'s claim that every declared
event type is emitted by a command keeps its derived sweep green.

### Dependencies

After IE-039 (it touches the state types and the union, which IE-039 moves).
IE-042 depends on this.

### Out of scope

Summons and a creature whose presence a casting ends. Granted condition
immunity (IE-042). Anything about `monsterCanReceive` beyond calling it.

### Known risks

Low. The one judgement call is whether `applyConditionTo` loses its `immuneTo`
parameter; if a caller is found that legitimately needs to add an immunity the
state does not hold, union rather than replace and say so in the digest.

## Completion digest

```
IE-040 — Completion digest
Builder: COMPLETE
Commit: cb39903 (replayed onto main as beda2e7)   Branch: worktree-agent-a3d44e2c201680b3a
Opus review: rounds 1–3 by the builder's reviewer (4 defects, then 1, then 1 — converging, all
  ordinary, none architectural); round 3 returned DEFECTS and the builder's fix was
  post-review. **A fourth, confirming round was launched by the foreman and returned PASS at
  high confidence on cb39903.**
Tests: 8382 / 8382 on the branch (baseline 8354); new: 20 in monster-command.test.ts plus
  addCreature in the idempotency sweep and six DECLARED_NOT_ACTED entries driven
  behaviourally. On main after the replay: 8403 across 119 files.
Mutations, each failing for the right reason: dropping conditionImmunitiesOf from
  applyConditionTo's guard (2 red); admitting a qualified entry as absolute (1); deleting the
  immune skip in imposeCondition (1 — the whole casting refused); `?? []` → `[]` in the
  reducer (4); reporting the condition kind's immune target as affected (1); and raising the
  Zombie's AC so the attack misses — caught by the acceptance test's `attack.hit` assertion,
  and **with that assertion removed the same mutation passed vacuously**, which is the third
  reviewer's defect demonstrated rather than argued.
Gauntlet: typecheck ✓ lint ✓ test ✓ coverage diff ✓; both frozen logs run explicitly, 29
  tests, neither fixture touched; fold-graph.ts re-run, 90 declarations, ACYCLIC and
  byte-identical to baseline — no declaration added or moved under fold/.
Conformance: PASS — every SRD line quoted checked against packages/srd/raw/.
Architectural deviations: four, all declared — see the risk gate.
Foundational primitives touched: the GameEvent union (creature-added gains an optional
  conditionImmunities and an optional command stamp); state.ts (CreatureState.conditionImmunities);
  fold/apply.ts (the creature-added case only); standing.ts (new conditionImmunitiesOf);
  commands/conditions.ts; commands/spell-resolution.ts (both condition sites, via one shared
  imposeCondition); commands/command.ts (unknownCreature's satisfyWith); the barrel.
New runtime special cases: none. Nothing branches on a creature, spell or feature name.
Out-of-scope findings: SpellEffectOptions.immuneTo has zero writers and is a one-line deletion
  now that commands/casting.ts is free.
Unresolved concerns: (1) the post-review fix — resolved by the confirming round. (2) an
  *implied* condition is not checked against the immunity, so a creature immune to Prone and
  Incapacitated but not Unconscious acquires both; the book does not settle it, so the witness
  is pinned and the answer is not. (3) conditionApplicability and monsterCanReceive still have
  no runtime caller, because both take an AdaptedMonster which state does not hold.
Reviewer confidence: high
Recommendation: READY FOR MERGE
```

## Risk gate

**Inspected, and this is the one task in the tranche I held rather than merged.**

**Condition 3 was not met when the digest arrived.** The third review round
returned `DEFECTS`; the builder fixed the single defect and stopped, correctly
flagging that the fix was post-review and unseen. A `DEFECTS` verdict with an
unreviewed fix is precisely the case the condition exists for, and "the delta is
only a test deletion" is the judgement an independent reviewer is there to make
instead of me. I launched one narrow confirming round on `cb39903`, scoped to
whether the defect was resolved, whether the deletion weakened anything else,
and the gauntlet. **PASS at high confidence**, and it verified the three places
now tell one story, that the `immune` code is still asserted elsewhere so
`refusal-sweep.test.ts` stays satisfied, and that nothing outside that one test
file moved.

**Four declared deviations, every one the source overruling my brief:**

- **`addCreature` takes the parsed `Monster` rather than an id**, with no
  "unknown stat block" refusal. `@ie/srd` exports no monster index and the
  generated directory is gitignored, so there is nothing a lookup could refuse —
  and *a guard nothing can reach is not a rule* is this repository's own
  principle, applied to my brief.
- **No `spellcasting-declared`.** A stat block prints its spells as prose in a
  trait and the schema carries no ability, list or slots, so reading one out
  would be the engine deciding a fact the book wrote for a person.
  `declareSpellcasting` is the second command, exactly as it already is for an
  NPC cleric. This is the doctrine correctly applied against my instruction.
- **An immune target inside a casting is skipped, not aborted.** Propagating the
  refusal out of `resolveEffects` would refuse Ray of Sickness at a Zombie
  *entirely*, with the generator already advanced and no events emitted — a
  rules bug and a validate-before-rolling violation. This is why
  `commands/spell-resolution.ts` is in the diff, and both reviewers judged the
  edit necessary rather than optional.
- **`applyConditionTo` keeps `immuneTo`, unioned rather than overridden.** My
  brief preferred removal; the builder could not, because removal requires
  editing `commands/casting.ts`, which IE-048 held at the time. The reviewer
  correctly noted the reason is file ownership rather than a caller needing it.
  `SpellEffectOptions.immuneTo` still has **zero writers** and the file is free
  now — recorded as debt below.

**I confirmed the reviewer's open question** before merging: no concurrent task
held `commands/spell-resolution.ts`. IE-041 and IE-048 were merged and their
worktrees retired; the `IMPLEMENTING` the builder saw on IE-041's task file was
that task genuinely mid-flight when it looked.

Classification: **GREEN**, after the confirming round.

## Architecture decision

None. No Fable involvement. The four deviations are all transcription of the
source over the brief, which is established practice rather than new
architecture.

## Merge record

Replayed onto `main` as `beda2e7`; `commands.ts` and `invariants.test.ts`
auto-merged over IE-048's changes to the same files.

`main` verified **after** the merge: typecheck ✓, lint ✓, **8,403 tests across
119 files** ✓, both frozen logs and the scenario determinism explicitly ✓,
`COVERAGE.md` regenerated and byte-clean ✓, tree clean.

Thirteen conditions: **1** inside the brief; **2** `COMPLETE`; **3** `PASS` at
high confidence — **on the fourth, confirming round, which is why this task was
held**; **4** the single outstanding defect resolved and independently seen;
**5** gauntlet green; **6** conformance green; **7** no blocker; **8** four
deviations, all declared and all accepted as the source overruling the brief;
**9** the primitives are the brief's, plus `commands/spell-resolution.ts`, which
acceptance criterion 1 compels; **10** the files outside the surface are each
forced by a required behaviour or a derived sweep; **11** integration valid, two
auto-merges; **12** re-verified on `main`; **13** risk gate inspected, GREEN.

**What it closes.** The fourteenth recorded instance of a pure function nothing
calls, and the largest since the scene commands: `adaptMonster` had no caller
outside its own tests, so nothing above the engine could put a monster into a
game without folding an event itself. And a shipped wrong number with no
symptom — a Zombie was Poisoned like anybody — is gone, with the three-valued
applicability preserved by *where each entry goes*: unconditional into state,
qualified into `unverified`, nothing invented.
