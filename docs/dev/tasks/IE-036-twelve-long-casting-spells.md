# IE-036 — The twelve spells a long casting time alone blocked

state: OWNER_APPROVAL_REQUIRED
lane: content
tranche: 5
parallel-safe: CONDITIONAL — content only; collides with IE-035 on registry lines alone
depends-on: IE-034
worker: none
approved: none
merge-approved: none

## Brief

### Objective

Write the twelve spells whose **only** blocker was a casting time of a minute
or more, now that IE-034 has built it.

### Why now

The derived map names them, and the list is a query rather than a claim:
`consumersOf('a-long-casting-time').unblocks` returns exactly

> alarm, clairvoyance, commune-with-nature, fabricate, find-the-path,
> hallucinatory-terrain, identify, illusory-script, instant-summons,
> legend-lore, magic-mouth, mending

— twelve spells, each of which the engine could cast the moment the casting
time exists. This is the content half of the largest blocker in the book, and
it is the cheapest coverage in the tranche because the mechanism is already
paid for.

### Current relevant architecture

- `packages/engine/scripts/missing-shapes.ts:1175` — `BLOCKED_ON`, where each
  of the twelve currently names `a-long-casting-time`.
- `packages/engine/src/spell-definitions.ts` — the catalogue and the registry.
- `spell-tracking.test.ts` — the adjudication map for a tracked spell, with its
  three values and the marker scan over the spell's **own SRD prose**.
- `COVERAGE.md` — regenerated, never hand-edited.

### Required behaviour

1. Each of the twelve is **read against its own SRD paragraph** and given a
   definition: tracked where what it does is not arithmetic, executed where the
   existing effect kinds fit the whole of it.
2. Every tracked spell carries adjudications for every clause the honesty
   guard's markers catch, and each is `table` or names an **enumerated missing
   shape**. A shape invented in a note is an architecture decision smuggled
   past review.
3. **The ten "Ritual casting option is not modelled" clauses are removed**,
   because IE-034 modelled it. Check each rather than deleting the phrase
   wholesale.
4. The map entries move: a spell that is now defined leaves `BLOCKED_ON` and,
   if it is tracked with clauses, enters `TRACKED_ADJUDICATED`.

### Architecture constraints

- **`unmodelled` means "this belongs to the fiction", never "nobody has built
  it yet".** That line is drawn by `spell-tracking.test.ts` rather than by
  review, and a clause the engine's own resolution path would reach is debt,
  not narration.
- A definition **may not assert a rules fact without quoting the SRD line**.
  Every duration is quoted in the docstring; the oracle checks name, level,
  school, casting time, Concentration, range and duration.
- **Check the registry before adding a spell.** Two parallel sessions once both
  wrote Vitriolic Sphere and only a duplicate-symbol error caught it.
- Do not extend the marker set. It is a stated floor.
- Alarm prints "you can designate creatures to be unaffected by it" — the same
  clause Spirit Guardians carries. If it is expressible, express it; if its
  *trigger* is not, adjudicate that half and say so.

### Acceptance criteria

1. All twelve have definitions; `consumersOf('a-long-casting-time').unblocks`
   no longer names any of them.
2. At least one is driven **past its casting time** end to end — declared, the
   clock advanced, settled — so the twelve are not merely data.
3. Every removed ritual clause is removed because the spell carries the parsed
   Ritual tag and IE-034 now handles it, not because the phrase was found.
4. `spell-tracking.test.ts` and `spell-honesty.test.ts` pass in both
   directions; no shape is left unclaimed and none is invented.
5. `npm run coverage` run and committed; the tracked and executed counts move.

### Tests and conformance

The guards are the conformance. Add a driven case per executed spell; a tracked
spell needs its cost driven — action, slot, Concentration, duration — which is
what tracked *means*.

### Dependencies

**IE-034.** Runs beside **IE-035**; the only shared lines are in the registry,
which is mechanical to resolve.

### Likely file surface

`spell-definitions.ts` (definitions and registry),
`scripts/missing-shapes.ts`, `COVERAGE.md`, test files.

### Out of scope

The other 42 spells a long casting time touches; each is blocked on something
else besides. Any change to the casting machinery — that is IE-034's, and if
one of the twelve needs more, report it rather than widening the mechanism.

### Known risks

Twelve spells is twelve chances to file a real rule as narration. The guard
catches a clause whose words it knows; it reads English and is a floor, not a
proof. Where a clause is genuinely the table's, say **why** the engine's
resolution path never arrives at it.

## Completion digest

## Risk gate

## Architecture decision

## Merge record
