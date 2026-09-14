# IE-048 — End a casting by its id, and retire the two zero-caller commands

state: DONE
lane: mechanism
tranche: 6
parallel-safe: CONDITIONAL — `commands/casting.ts`, `commands/ongoing.ts`, the barrel; not beside IE-041, IE-042, IE-046 or IE-047
depends-on: IE-038, IE-041
worker: none
approved: 2026-09-14 — "APPROVE TRANCHE 6."
merge-approved: 2026-09-14 — "APPROVE TRANCHE 6."

## Brief

### Objective

Replace `endSpellEffectOn` — which finds a casting through whoever is
concentrating on it — with `endOngoingSpell(castingId, on)`, and demote
`resolveCast` from the public barrel.

### Why now

`endSpellEffectOn` is **the last place in the command layer a casting is
addressed by its holder rather than by its id**, and the cost is concrete: it
cannot end a non-Concentration ongoing spell at all. CLAUDE.md lists that as a
gap in as many words — "A non-Concentration ongoing spell cannot be dismissed
early … Adding one is small and deliberately not in this milestone" — and
`missing-shapes.ts` files it as `a-casting-dismissed-early`.

Verified on `main`: **both commands are published through `commands.ts` and
called by nothing but tests.** `resolveCast`'s one production use, Divine
Smite, goes through `resolveCastWith`.

**Honest scope:** `a-casting-dismissed-early` blocks 3 spells and **finishes
0** — no spell is completed by this. It is bought for the correctness of the
addressing, not for coverage, and the digest should say so rather than claiming
a number.

### Current relevant architecture

- `commands/casting.ts:1005` `endSpellEffectOn` — reads
  `caster.concentration` to find the casting to release.
- `commands/casting.ts:1309` `resolveCast`, `:1326` `resolveCastWith`.
- `commands.ts:76`, `:78` — both published; `invariants.test.ts:1893` and
  `:817`/`:1445` sweep them as commands.
- `spell-ended` and both its reducer branches already exist — `on: null` ends
  the casting and everything it made; `on: <creature>` releases it there. The
  Dispel resolver already writes it.

### Required behaviour

1. `endOngoingSpell(state, castingId, on: CreatureId | null, …)` — a barrel
   command through `once`, emitting `spell-ended`, guarded by:
   - the caster's identity (only the caster dismisses their own casting);
   - SRD's clause — "you can dismiss it (no action required) **if you don't
     have the Incapacitated condition**";
   - a refusal naming the casting when no such casting is running.
   It takes **no action, Bonus Action or Reaction** — SRD says "no action
   required" — so it is not a spender, and it is recorded in
   `DECLARED_NOT_ACTED` with that sentence.
2. Delete `endSpellEffectOn`, converting its tests to the new command.
3. Demote `resolveCast` from `commands.ts` and `index.ts` to a module export;
   its tests import the module. **A public API change** — say so in the digest,
   because the eventual `index.ts` tiering will read that record.
4. `invariants.test.ts`'s sweeps follow: a demoted export is no longer a
   command, and the new command joins the idempotency and action-economy
   populations.

### Architecture constraints

- `spell-ended`'s two meanings are unchanged; no new event, no reducer change;
- a casting is addressed by **id**, never by whoever holds it;
- deletion before replacement: the old command goes, it is not kept as an
  alias.

### Acceptance criteria

1. A caster dismisses a **non-Concentration** ongoing spell of their own by id
   — the case `endSpellEffectOn` could not express — and it ends, with its
   grants, timers and record gone through `releaseCasting`.
2. `on: <creature>` releases it on one target and leaves the casting running
   for everyone else; `on: null` ends it outright.
3. An Incapacitated caster is refused; a creature who is not the caster is
   refused; an unknown casting id is refused. Each code asserted by name.
4. Idempotent under one command id.
5. `resolveCast` is no longer on the barrel and the suite still exercises it
   through its module.
6. `missing-shapes.ts`: `a-casting-dismissed-early`'s three claimants are
   re-read one at a time; the shape retires only if nothing claims it.

### Tests and conformance

The gauntlet. CLAUDE.md: the "cannot be dismissed early" sentence in the
durations section goes, and the API change is recorded.

### Dependencies

IE-038 and IE-041 — both rewrite `commands/casting.ts`, and this is the
smallest of the three, so it goes last.

### Out of scope

Dismissing somebody else's spell. Any change to Dispel Magic. The rest of the
`index.ts` tiering, which waits for M2's first consumer.

### Known risks

Low. The one judgement is whether "no action required" should still be gated
by `mayAct` for outstanding engine debt; it should **not** be listed as a
spender, but it does read state — follow `relocateCreature`'s precedent
(guarded, not a spender) and justify the choice in the digest.

## Completion digest

```
IE-048 — Completion digest
Builder: COMPLETE
Commit: 45b1201 (replayed onto main as f10cf01)   Branch: worktree-agent-a022b921150874866
Opus review: PASS — rounds: 3, confidence high, no defects
Tests: 8375 / 8375 (baseline 8354); new: 21.
Mutations, three run and reverted: (1) making the command find its casting through
  caster.concentration again — the exact regression the task exists to prevent — reddens 7
  tests, every non-Concentration Mage Armor case; (2) disabling the duration-form guard
  reddens its case; (3) disabling the unknown-`on` guard reddens its case. A fourth, breaking
  the shape description's quoted run, reddens the citation guard.
Gauntlet: typecheck ✓ lint ✓ test ✓ coverage diff ✓
Conformance: PASS — COVERAGE.md byte-clean; the shape row still reads
  `a-casting-dismissed-early | 3 | 0`, which is the honest scope the brief stated.
Architectural deviations, three declared:
  1. A fourth guard the brief did not name — `not_dismissible`, scoping the free dismissal to
     SRD's Time Span duration form. Found by the reviewer in round two.
  2. `DECLARED_NOT_ACTED` was not used and **could not be**: that list is derived from
     DECLARING_MODULES, whose own test asserts those modules never name mayAct, and this
     command does. Measured rather than argued — the entry was added and the sweep's "invents
     none" assertion watched to fail. A bespoke both-direction block was written instead,
     plus an explicit "is not classified as a spender" case that relocateCreature never had.
  3. `no_effect_there` widened rather than deleted: the old command scanned for a condition
     instance, the new one reads OngoingSpell.on, which also covers a tracked spell that is on
     somebody and hangs nothing there. Same code, wider and truer reading.
Foundational primitives touched: the commands.ts barrel — a **public API change**
  (endSpellEffectOn removed, resolveCast demoted to a module export, endOngoingSpell added;
  index.ts needed no edit because it re-exports the barrel wholesale); commands/casting.ts;
  spells.ts (OngoingEndReason gained `dismissed`, additively, not reusing `dispelled` for the
  reason ConcentrationEndReason keeps `voluntary` apart from it four lines away).
  events.ts, state.ts and fold/ untouched.
New runtime special cases: one — not_dismissible, transcribed from the SRD Duration section,
  keyed on no spell name, read off the casting rather than off definitionFor by IE-007's rule.
Files outside the brief's surface: spell-definitions.ts (two unmodelled prose arrays — A's
  content lane, forced by AC6 and the foreman's launch instruction); spells.ts; missing-shapes.ts;
  make-golden-log.ts (one import line forced by the demotion, output unchanged, the frozen log
  untouched and not in the diff); five test files; CLAUDE.md.
Out-of-scope findings: `endConcentration` is **not** mayAct-guarded, and it ends a casting
  through the same releaseCasting door — so it forgives the same outstanding area effects the
  new guard exists to protect. Pre-existing, in a command the brief does not name.
Reviewer confidence: high
Recommendation: READY FOR MERGE
```

## Risk gate

**Inspected, and one claim verified against the book personally**, because it is
the only product-visible narrowing in the tranche.

**`not_dismissible` is correct and my brief was wrong.** SRD `spells.md:210–218`
names three duration forms — Concentration, Instantaneous, **Time Span** — and
prints the dismissal under the third alone: *"While a **time-span spell** that
you cast is ongoing, you can dismiss it (no action required) if you don't have
the Incapacitated condition."* My brief quoted that sentence with the scoping
words cut out. So an **Until dispelled** casting is not dismissible by its
caster: Continual Flame consumes 50 GP of ruby dust and the book prints its
caster no ending at all. Read it myself at the line the digest cites.

**And "product-visible" overstates it, which is worth correcting rather than
repeating.** No shipped behaviour is removed. `endSpellEffectOn` found its
casting through `caster.concentration`, so it could never reach a
non-Concentration casting in the first place — a caster could not dismiss
Continual Flame before this task either. What the guard prevents is the **new**
command granting something the SRD does not, and what changes for a caller is
that the refusal now has an honest code. A Concentration casting is still ended
at will through `endConcentration`, by the Concentration rules. The narrowing is
therefore exactly: *non-Concentration, non-time-span castings*, which is
Continual Flame, Arcane Lock and their kind.

**The cross-lane reach is mine.** Two `unmodelled` arrays in
`spell-definitions.ts` are A's content lane, and the reviewer correctly noted it
was not declared as a cross-lane reach. It was compelled twice over: AC6 requires
re-reading the shape's claimants, and **my own launch message instructed this
builder to read Instant Summons and Magic Mouth**, which IE-036 had just found
print the same clause. Both notes asserted "the only door out is
`endConcentration`" — a claim this change falsifies, in a file whose claims are
tested. Leaving them would have been worse. I read both: they are accurate, and
the Magic Mouth note is *sharper* than what it replaced, identifying the real
unmodelled half as the caster's choice at the casting.

**The unsatisfiable instruction was mine too.** Brief item 1 told the builder to
record the command in `DECLARED_NOT_ACTED`; that list is scoped by
`DECLARING_MODULES`, whose own test asserts those modules never name `mayAct` —
and this command does. The builder added the entry, watched the sweep fail, and
wrote a bespoke both-direction block instead. Measured rather than argued, which
is the right way to answer a brief that cannot be obeyed.

Classification: **GREEN**.

## Architecture decision

None. No Fable involvement.

## Merge record

Replayed onto `main` as `f10cf01`; clean, no conflict.

`main` verified **after** the merge: typecheck ✓, lint ✓, **8,375 tests across
118 files** ✓, both frozen logs and the scenario determinism explicitly ✓,
`COVERAGE.md` regenerated and byte-clean ✓, tree clean.

Thirteen conditions: **1** inside the brief; **2** `COMPLETE`; **3** `PASS` at
high confidence after three rounds, the second of which found the SRD scoping;
**4** no defects; **5** gauntlet green; **6** conformance green, the shape row
unmoved at `3 | 0` as the brief predicted; **7** no blocker; **8** three
deviations, all **declared**, and two of the three are corrections of my own
brief; **9** the primitives are the brief's, plus an additive union member;
**10** files outside the surface include a cross-lane content reach that my
launch message compelled and that I have read and accepted; **11** integration
valid; **12** re-verified on `main`; **13** risk gate inspected, GREEN.

**The scope claim stands as the brief stated it**: `a-casting-dismissed-early`
still blocks 3 and finishes 0, `COVERAGE.md` is byte-identical, and no spell was
completed. It was bought for the correctness of the addressing, and the mutation
that proves the point is the first one — making the command find its casting
through the holder again reddens every non-Concentration case.
