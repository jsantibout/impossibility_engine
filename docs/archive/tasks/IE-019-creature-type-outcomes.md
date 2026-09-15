# IE-019 — An outcome that varies by creature type

state: DONE
lane: mechanism
tranche: 4
parallel-safe: NO beside another union task; YES beside conformance and command-surface work
depends-on: IE-017
worker: none
approved: 2026-09-13 — "APPROVE TRANCHE 4"
merge-approved: 2026-09-13 — "APPROVE TRANCHE 4" (tranche 4 authority; 13/13 conditions green)

## Brief

### Objective

Let an effect's outcome vary by the target's creature type — a fact the engine
already holds authoritatively and that currently reaches targeting and nothing
else.

### Why now

Wave 4's union task, and **it exists because the task it replaces did not
survive re-derivation.** The leverage audit ranked C2, "a selector for the save
a casting forces", at six spells and one feature. The fourth whole-engine audit
(§4) read them and found **zero consumers made whole**: the six have three
different blockers, and five of them need a *declared* fact rather than a
selector axis. C2 is dropped. This is half of what replaces it.

The audit also found that `an-outcome-that-varies-by-creature-type` is where
one of the mis-filed adjudications belongs: **Shatter's "A Construct has
Disadvantage"** is filed under the save-mode shape, and its own note admits the
type is the blocker.

Consumers, all four already **executed and partial on exactly this clause**:

- **Blight** — "a Plant creature... automatically fails the save"
- **Shatter** — "A Construct has Disadvantage on this save"
- **Divine Smite** — an extra 1d8 against Undead and Fiends
- **Banishment** — a creature native to another plane does not return

### Current relevant architecture

- **Creature type is authoritative.** `declareCreatureType` establishes it,
  re-declaring the same type emits nothing, and a *different* one is refused
  with `type_established`; a character takes its type from its species and a
  stat block prints one. A creature nobody has typed produces a
  `creature-type` `ContextRequest` rather than a silent pass.
- `TargetRule.mustBeType` (`spell-definitions.ts:791`) — the **only** current
  reader, and it gates targeting. This task gives the same fact a second
  reader, at the outcome.
- The `SpellEffect` union and `resolveEffects`, as the earlier union tasks
  leave them; and `spell-honesty.test.ts`'s adjudication for Shatter, which
  moves.

### Required behaviour

1. A way for an effect to vary by the target's creature type, covering the
   three shapes the four consumers actually print: **an automatic failure**
   (Blight), **a mode on the save** (Shatter), and **extra damage dice**
   (Divine Smite). Banishment's is a fourth — an outcome that changes what the
   casting's *end* does — and the builder decides whether it fits here or is
   named as still blocked. Either answer is acceptable; an honest "not this
   shape" is better than a field with one user.
2. **The unknown case is a request, not a pass.** A creature whose type nobody
   has declared must produce the existing `creature-type` `ContextRequest`,
   exactly as targeting does — not silently take the default branch. This is
   the rule the whole three-valued discipline rests on and it is the easiest
   thing in the task to get wrong.
3. **Type matching is the SRD's, not a substring.** `CLAUDE.md` records that a
   Goblin Warrior is Fey with a Goblinoid *subtype tag*, and that every 2014
   instinct about who is a Humanoid is worth re-reading. Match the type, not
   the printed string.
4. Shatter's adjudication moves from `a-mode-on-the-save-a-spell-forces` to
   this shape, and the spells that close move out of `PARTIAL_SPELLS`.
5. Divine Smite is a **class feature**, not a spell. If its rider cannot reach
   this vocabulary without widening the task, say so and leave it — three
   consumers is enough.

### Architecture constraints

- Do not add a creature-type *system*. The fact is held; this is a second
  reader of it.
- Do not make an undeclared type default to anything.
- No change to `declareCreatureType`, to `type_established`, or to the
  `ContextRequest` vocabulary.
- Both frozen logs fold unchanged.

### Acceptance criteria

1. A failing test first for Blight against a Plant: the save is not rolled and
   the failure is automatic, with the SRD line quoted.
2. Shatter against a Construct rolls with Disadvantage, and against anything
   else rolls normally — the fixture must have both.
3. A target whose type is undeclared produces a `creature-type` context
   request and **spends nothing** — no slot, no action, no die.
4. A subtype tag does not match a type: a Goblin Warrior is Fey, and a rule
   naming Humanoid does not reach it.
5. `COVERAGE.md` regenerated; the spells that close leave `PARTIAL_SPELLS`;
   the whole gauntlet passes.

### Dependencies

**IE-017**, which precedes it in the union chain. The foreman rebases.

### Likely file surface

`packages/engine/src/spell-definitions.ts`, `commands/spell-resolution.ts`,
`spell-schema.ts`, `spell-honesty.test.ts` (Shatter's re-filing), a spell test
file, `coverage.ts`, `COVERAGE.md`, `CLAUDE.md`.

### Out of scope

The declared "being fought" fact — the other half of C2's replacement, for the
five Charm and Dominate spells. It is a fact declared on a casting rather than
a property of a creature, and it is a separate task with its own evidence.
A creature-type filter on the *attacker's* side (Protection from Evil and
Good), which `CLAUDE.md` names as a different missing piece.

### Known risks

- Item 2 is the one that will pass by accident if the branch defaults. Drive
  the undeclared case explicitly and assert nothing was spent.


## Merge record

Merged to `main` as `54e8b54`, fast-forward, pushed. PASS at high confidence,
round two. Partial 55 → **52**, verified 68 → **69**. 6,656 tests.

Three spells left `PARTIAL_SPELLS` and `an-outcome-that-varies-by-creature-type`
left `MISSING_SHAPES`, because it is no longer missing.

**Two corrections to the brief, both checked against the book rather than
arbitrated, and both mine.**

1. **Acceptance criterion 1 said "the save is not rolled and the failure is
   automatic". It is rolled.** `CLAUDE.md:5275` has said since conditions
   landed what this engine means by an automatic failure: *"The roll is still
   recorded — other effects can care what it showed — but `autoFailed`
   overrides the total, and no after-the-fact bonus rescues it."* The builder
   matched that mechanism rather than building a second one for the same SRD
   phrase, and its supporting argument is the decisive one: a mechanism that
   skipped the roll would have had to explain why Shatter's Construct — the
   same clause, the same slot — still rolls. **I wrote an implementation
   detail where the requirement was an outcome, and the engine already had a
   meaning for it.**
2. **Divine Smite is an SRD spell, not a class feature** — `spells.md:1873`,
   "Level 1 Evocation (Paladin)". The brief said otherwise and offered an
   escape hatch that was not needed.

**The builder mutation-tested its own tests, and two of them failed that
test.** Two assertions were rewritten because they *survived* the mutation
they were written against: the Radiant-immunity bound needed a target with
nothing left to resist, and "full, not half" was a floor a halved 8d8 also
clears. Finding that a passing assertion proves nothing is the hardest kind of
self-check, and it was volunteered.

**Banishment was honestly declined.** The brief left the fourth shape open —
"an honest 'not this shape' is better than a field with one user" — and it is
re-filed to `a-second-place-to-put-a-creature` with the reason written, rather
than bent into a union that did not fit it.

The thirteen conditions: 1 inside the brief · 2 COMPLETE · 3 PASS at high,
round two · 4 no defects · 5 gauntlet ✓ · 6 `COVERAGE.md` byte-identical;
`PARTIAL_SPELLS` derived and agreeing both ways; the removed `unmodelled`
clauses are the ones now executed · 7 no blocker · 8 one deviation, ratified
above · 9 roll resolution gains an additive optional `autoFail` and one `??`;
the `SpellEffect` union gains two optional clauses — all authorised, and the
union task for this wave is where they belong · 10 three files beyond the
likely surface, each required by a stated criterion · 11 no conflict ·
12 gauntlet re-run on `main`: typecheck ✓ lint ✓ **6656/6656** ✓ coverage
byte-clean ✓, both fixtures untouched · 13 GREEN.

### Behaviour change worth naming

An area casting that catches an **untyped bystander now asks instead of
resolving.** That is precisely the three-valued discipline the brief mandated,
and nothing in the suite depended on the old silence — but it is a real change
to what a caller sees, and it is the kind that would be easy to discover in
play rather than here.
