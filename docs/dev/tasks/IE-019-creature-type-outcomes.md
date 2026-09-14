# IE-019 — An outcome that varies by creature type

state: OWNER_APPROVAL_REQUIRED
lane: mechanism
tranche: 4
parallel-safe: NO beside another union task; YES beside conformance and command-surface work
depends-on: IE-017
worker: none
approved: none
merge-approved: none

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
