# IE-030 — The declared "being fought" fact

state: DONE
lane: mechanism
tranche: 5
parallel-safe: CONDITIONAL — a union task; safe beside IE-031, which touches no file it touches
depends-on: IE-028
worker: none
approved: 2026-09-14 — "APPROVE TRANCHE 5"
merge-approved: 2026-09-14 — "APPROVE TRANCHE 5" (tranche 5 authority; 13/13 conditions green)

## Brief

### Objective

Let a casting state the fact five SRD spells key a save's Advantage on — "if
you or your allies are fighting it" — as a stated fact of the casting, in the
shape `damageType` already is.

### Why now

The fourth whole-engine audit read the six spells the leverage audit's "C2"
claimed and found **zero consumers made whole**: five of them need a *declared
fact*, not a selector axis on the save. C2 was dropped, and this is the half
that replaces it. The derived map agrees:
`a-fact-only-the-table-can-declare` blocks nine spells and finishes Enthrall
outright, and it is **one of exactly two clauses** on Charm Person and Charm
Monster — the other being IE-032's trigger ending. Build both and those two
spells are finished.

### Current relevant architecture

- `packages/engine/src/commands/targeting.ts:327` — `declaredFacts`, which
  already validates one stated fact: `:348` reads
  `definition.damageTypeStated`, `:371` refuses `damage_type_required` when the
  spell prints the clause and nothing was stated, `:377` refuses
  `unknown_damage_type` when the value is not one the spell offers. **This is
  the mirror to build.**
- `packages/engine/src/bonuses.ts:112` — `ModeSource`, which attributes a mode.
  `CLAUDE.md`: "Because advantage cancels rather than stacks, `modeSources`
  records **every** source including ones that cancelled."
- `PendingCasting` — carries the stated facts as of IE-020, which is the
  carrier a held casting rides on.
- `packages/engine/src/spell-schema.ts` — where the definition clause is
  validated. IE-024 has already made every branch there report rather than
  throw.

### Required behaviour

SRD Charm Person, whole sentence: "One Humanoid you can see within range makes
a Wisdom saving throw. **It does so with Advantage if you or your allies are
fighting it.**" Charm Monster prints the identical sentence. Modify Memory
prints the same rule in different words — "If you are fighting the creature, it
has Advantage on the save" — and is a sixth candidate; read it against its own
paragraph rather than assuming it in or out.

1. A definition clause on a host that rolls a saving throw — an
   `advantageIfFought` flag — refused by the validator anywhere else.
2. `CastSpellRequest.fought: boolean`, **required** when the definition prints
   the clause and **refused** when it does not: the exact mirror of
   `damage_type_required` / `unknown_damage_type`.
3. Carried on the pending record through IE-020's carrier, so a held casting
   settles with the fact its caster stated.
4. Applied as a **named `ModeSource`** inside the save, so it cancels rather
   than counts. Three Advantages against one Disadvantage is a normal roll, and
   this goes through `combineRollModes` like every other mode.

### Architecture constraints

- **It is not `side`.** Allegiance is a different question and may be
  undeclared; "are you fighting it" is a fact about *this casting*, stated by
  the caster, exactly as the damage type is. Substituting `side` would be the
  engine answering the question the caster was asked — the error `CLAUDE.md`
  records for Spirit Guardians' designated creatures.
- It is **not** a `RollModifier` selector. `roll-modifiers.ts` selects by roll,
  relation, ability and skill, and none of those can say "in this casting".
- No default. A boolean with a default is the engine inventing a fact; the
  refusal is the honest answer and costs nothing.
- The consumers' *other* clauses stay in the map: Charm Person and Charm
  Monster still carry the trigger ending until IE-032, and the three Dominates
  carry more besides.

### Acceptance criteria

1. Enthrall's clause is closed and the spell leaves `PARTIAL_SPELLS`, derived
   rather than declared.
2. Charm Person cast with `fought: true` rolls the save with Advantage and
   `modeSources` names the source; with `fought: false` it does not; with the
   field absent the casting is refused and **nothing is spent** — no slot, no
   action, no die.
3. A spell that does not print the clause is refused for stating it.
4. A **held** Charm Person settles with the stated fact — the IE-020 path.
5. Each consumer's clause is re-read against its own SRD paragraph and either
   closed or left with an honest note; the map and `COVERAGE.md` move
   accordingly, and `npm run coverage` is run and committed.
6. Both frozen logs fold unchanged.

### Tests and conformance

Drive both refusals through the public API and pin their codes in
`refusals.test.ts` — IE-018's rule, and these are new codes a tool surface will
branch on. `spell-honesty.test.ts` must agree with the new adjudications in
both directions.

### Dependencies

**IE-028** (the enumerator, `events.ts`). Runs beside **IE-031**, which
touches no file this one does.

### Likely file surface

`spell-definitions.ts` (types and the consumers' definitions),
`commands/targeting.ts`, `commands/spell-resolution.ts`, `spell-schema.ts`,
`events.ts` (one record field), `scripts/missing-shapes.ts`, `COVERAGE.md`.

### Out of scope

A general "choice made at the casting" bag. The delta audit is explicit: two
stated facts exist after this, and a **third** — an ability chosen, for Hex,
Enhance Ability and Bestow Curse — is the evidence for a bag. Two is not.

### Known risks

`fought` is about the caster and *their allies*, not about the target's side.
A fixture that declares sides and then asserts the save proves nothing about
which fact was read.


## Completion digest

Builder **COMPLETE**, reviewer **PASS at high confidence**, three rounds — the
second of them an escalation the foreman answered GREEN. Branch
`worktree-agent-afca07523d01f0015`, commit `6fff705`, rebased to `d185bd6`.
Tests **7017 → 7196 on `main`**, 22 named cases plus a **130-case per-definition
prose sweep**. Gauntlet green; both frozen logs fold unchanged.

Six mutations, each failing only its own cases. Three are the ones that matter:

- **the fact read per casting rather than per target → 4 fail, including the
  upcast fixture that discriminates the two.** That is the defect the first
  round shipped and the fixture that could not have caught it;
- **the empty answer elided like a designation → 2 fail** — the one asymmetry
  with `unaffected` that the decision insisted on;
- **the refusal advances the generator → 1 fail**, which the reviewer asked for
  in round 2 and which the earlier fixture could not see.

Conformance moved as predicted: `a-fact-only-the-table-can-declare` falls from
9 blocks / 1 finish to **3 / 0**, `a-casting-ended-by-a-trigger` rises to 2
finishes (Modify Memory), and `a-bonus-narrowed-to-a-skill` enters at 1 / 0.
`spell-honesty.test.ts` and `scripts/coverage.ts` needed **no edit** and agree
in both directions.

**Two declared deviations, both approved.**

1. **`CastSpellRequest.fought` is `readonly CharacterId[]`, not the `boolean`
   required behaviour 2 prescribed** — the foreman's GREEN decision, recorded
   at `b4d2c34`. Implemented as `unaffected`'s shape, with the asymmetry
   written down in `foughtFor` and pinned by a test and a mutation: **an empty
   list is an answer and is never elided.**
2. **Acceptance criterion 1 is falsified by the SRD.** Enthrall prints
   "automatically **succeeds**", not Advantage; `checks.ts` carries `autoFail`
   and no `autoSucceed`, and the failure branch is a −10 narrowed to Wisdom
   (Perception) **and Passive Perception**, which `BonusApplies` cannot say.
   The builder left it blocked rather than minting an `autoSucceed` no
   definition could then write, and minted one narrower id for the penalty
   half.

Out-of-scope findings: **Modify Memory's sentence is narrower than the other
five** — "If **you** are fighting the creature" against "you or your allies" —
so a future definition would answer the wider question under the narrower
clause; no definition exists, so no number is wrong today. And the Windows
line-ending trap again: Python text-mode writes converted six files to CRLF and
broke `spell-schema.test.ts`'s member sweep, which splits on `\n` — caught,
reverted, tree LF.

## Risk gate

**Inspected** — two declared deviations and several foundational primitives.

I read the two things my own decision turned on. The mode is applied
`effect.advantageIfFought === true && fought?.includes(target) === true`,
**inside the per-target loop**, with a `ModeSource` label a log can read; and
`foughtFor` is a separate normalisation from `statedFacts` precisely so the
empty list is not elided, with a comment at both sites saying why the two
neighbouring facts behave differently. That asymmetry is the one thing a later
reader would "tidy" into a bug, and it is pinned by mutation (e).

The clause carriers are held against **each definition's own SRD paragraph**
out of the parsed book rather than a hand-written list — the stronger guard the
reviewer asked for in round 2, and the one that tells the five apart from
Enthrall.

Classification: **GREEN**.

## Architecture decision

**Answered by the foreman as GREEN rather than sent to Fable**, and recorded at
`b4d2c34`. The question was the *arity* of a stated fact: SRD keys the clause
per target, both Charms carry `extraPerSlotLevelAbove: 1`, and a boolean was
therefore silently wrong for one of two targets in an upcast casting — with the
`unmodelled` clause removed, **a wrong number with no symptom in a reachable
path**.

Decided `fought?: readonly CharacterId[]`, because it invents nothing:
`unaffected` is already that shape on the same request and the same pending
record, validated against the world, for the neighbouring clause in the same
paragraph of the same spells. The foreman may decide what follows
already-established architecture, and this follows it exactly.

**The larger finding is about the map, and it outlives this task.** The brief
asserted that this shape "finishes Enthrall outright", quoting `consumersOf` —
the derived query IE-015 built so that nobody would trust a hand-written
number. The query was wrong because an **adjudication beneath it** was wrong.
*A derivation is only as good as the clauses it derives from*, and this is the
first one caught by a builder reading the paragraph.

## Merge record

Merged to `main` as `d185bd6`, fast-forward, pushed. Rebased by the foreman;
clean.

`main` verified after the merge: typecheck ✓, lint ✓, **7196 tests across 110
files** ✓, `COVERAGE.md` regenerated byte-clean ✓, tree clean.

Thirteen conditions: **1** inside the brief, with two declared deviations;
**2** `COMPLETE`; **3** `PASS` at high confidence; **4** defects resolved;
**5** gauntlet green; **6** conformance, and the map moved as predicted; **7**
the escalation is answered and recorded; **8** both deviations approved in
writing before the work — one the foreman's decision, one the SRD overriding
the brief, verified by the reviewer against the parsed book; **9** the
primitives are the brief's, plus `EffectContext` and `resolveSaveEffect`,
declared; **10** four files outside the surface, each **forced by an existing
sweep** rather than chosen; **11** clean rebase; **12** re-verified on `main`;
**13** risk gate inspected, GREEN.

**Releases `events.ts`, which unblocks IE-031's rework.**
