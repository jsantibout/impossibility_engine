# IE-024 — The validator judges untyped input instead of throwing on it

state: OWNER_APPROVAL_REQUIRED
lane: conformance
tranche: 5
parallel-safe: CONDITIONAL — owns `spell-schema.ts`; every later union task adds a rule to that file, so it lands first and alone
depends-on: none
worker: none
approved: none
merge-approved: none

## Brief

### Objective

`parseSpellDefinition(unknown)` must **report** a malformed definition rather
than throw on it, in every branch — which is the whole contract of the
function.

### Why now

**A validator that throws is not validating.** IE-017's builder found that
`checkEffect`'s branches dereference an effect's fields unguarded, matching the
precedent rather than making one kind defensive and its neighbour not — and
IE-010's re-review caught the same class as a real regression in
`grantCarried`, where a loop conversion dropped a null guard and
`parseSpellDefinition` began throwing where it used to return
`err('unknown_condition')`. **Three instances is a class, not a slip.**

It lands in wave 1 because five later tasks each add a rule to this file; a
defensive pass is cheapest before them and worth nothing after.

### Current relevant architecture

- `packages/engine/src/spell-schema.ts:589` — `checkEffect`, the branch table.
  `:690` `end-condition` and `:747` `damage-defense` are the two IE-017 named;
  read all of them.
- `:864` `grantCarried` — the array-rider cosmetic: an array satisfies
  `typeof === 'object'` and non-null, so it still draws a spurious second
  `grant_without_lifetime`. The first and returned problem is the correct one,
  so nothing a caller reads is wrong today.
- The throw-safety sweep in `packages/engine/src/spell-schema.test.ts` asserts
  only that nothing throws — so it would also pass if the validator ever began
  *accepting* malformed input.
- `TargetRule.mustBeType` is an unvalidated string, so `mustBeType: 'Goblinoid'`
  validates while `againstType.types: ['Goblinoid']` does not. `CREATURE_TYPES`
  is the glossary's closed fourteen and already backs the second.

### Required behaviour

1. Every `checkEffect` branch guards its dereferences, so an arbitrary unknown
   reaches a reported problem rather than a throw. Follow the existing
   reporting shape: every problem carries a path, and the function returns all
   of them rather than the first.
2. The throw-safety sweep additionally asserts the result **is** an error —
   closing the "began accepting" direction without naming a code or freezing
   collection order. IE-010's reviewer raised this and accepted the builder's
   reasoning against pinning codes; keep that reasoning.
3. `mustBeType` is validated against `CREATURE_TYPES`, closing the asymmetry
   with `againstType.types`.
4. The `grantCarried` array case no longer draws the spurious second problem.

### Required behaviour — the SRD line behind rule 3

SRD 5.2.1 prints a Goblin Warrior as "Small Fey (Goblinoid)". The glossary
gives the fourteen creature types rules and gives a subtype tag none, so a
definition naming a tag matches nobody and must be refused at authoring — the
reading `isCreatureType` already takes for `againstType`.

### Architecture constraints

- **A field the engine does not know is not an error.** `checkShape`'s
  denylist reading is deliberate and stays: this task makes malformed input
  *reportable*, it does not make unknown input rejected.
- Do not change any existing refusal code's spelling. A code is observable
  behaviour and `refusals.test.ts` pins them.
- No new validation rules beyond `mustBeType`. Five later tasks each add one.

### Acceptance criteria

1. A table-driven case feeding each branch a wrong-typed payload: none throws,
   every one reports.
2. `mustBeType: 'Goblinoid'` is refused; `mustBeType: 'Fey'` is accepted.
3. The whole catalogue still validates: it is driven through
   `parseSpellDefinition` wholesale, so a new refusal that catches a real
   definition is a defect in the rule.
4. Reversing the "is an error" addition leaves a test red.
5. `npm test`, `npm run typecheck`, `npm run lint` green; `COVERAGE.md`
   unchanged.

### Tests and conformance

`packages/engine/src/spell-schema.test.ts`. The sweep is the load-bearing
part: drive it over a synthetic malformed definition per branch rather than
over one example.

### Dependencies

None, and nothing else in wave 1 may edit `spell-schema.ts`.

### Likely file surface

`packages/engine/src/spell-schema.ts`,
`packages/engine/src/spell-schema.test.ts`.

### Out of scope

The feature-definition validator (IE-025) — a different file and a different
population. Any change to `checkShape`'s denylist.

### Known risks

A guard added in the wrong place turns a reported problem into a *missing*
one. Every branch that gains a guard needs a case proving the problem is still
reported for the input that used to reach it legitimately.

## Completion digest

## Risk gate

## Architecture decision

## Merge record
