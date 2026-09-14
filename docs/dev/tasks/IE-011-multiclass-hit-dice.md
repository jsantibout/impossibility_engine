# IE-011 — Multiclass Hit Dice: call the function that is already right

state: OWNER_APPROVAL_REQUIRED
lane: mechanism
tranche: 4
parallel-safe: YES — `creation.ts` and `multiclass.ts`, touching no spell, no event type, no fold and no command module
depends-on: none
worker: none
approved: none
merge-approved: none

## Brief

### Objective

Make `poolsFor` declare the Hit Dice pools a multiclassed character actually
has, by calling `hitDicePools` — which is correct, tested against both SRD
worked examples, and called by nothing.

### Why now

**A wrong number, shipped and reachable.** `poolsFor` (`creation.ts:2439`)
declares exactly one Hit Die pool, from the *starting* class, sized at the
character's total level. So a Paladin 4 / Fighter 1 has four d10 and **no d8
at all**, and a Cleric/Paladin gets no d8 either.

This is the foreman's own rule from IE-008 applied to a finding IE-008 made:
*a silently wrong number outranks a new capability.* It was queued to `LATER`
at the time because IE-008's brief forbade touching pool sizing and no task
joins an approved roster. The fourth whole-engine audit (§3.6) re-confirmed it
and puts it in tranche 4.

**It is also the eleventh recorded instance of this repository's most
persistent finding** — a pure function that is correct, tested and unreachable.
`hitDicePools` (`multiclass.ts:142`) has been right since it was written;
`multiclass.test.ts:203` drives it against both of the SRD's worked examples.
Nothing calls it.

### Current relevant architecture

- `hitDicePools` (`multiclass.ts:142`) — the correct derivation, "Hit Dice pool
  by die type", with its tests at `multiclass.test.ts:203`.
- `poolsFor` (`creation.ts:2439`) — the shared derivation IE-008 extracted, and
  the single place both creation and advancement now get their pools. Its first
  entry is the single Hit Die pool this task replaces.
- `hitDieKey`, and `CLAUDE.md`'s Multiclassing section, which **claims the
  implemented behaviour** and must be corrected: "Hit Dice pool by die type" is
  described there as though it were reached.
- `resource-pool-declared` and `resource-pool-resized` already carry
  everything needed; IE-008's declare-or-resize loop at advancement reads
  whatever `poolsFor` returns, so advancement follows for free.

### Required behaviour

1. `poolsFor` returns one Hit Die pool **per die type** the character's classes
   grant, each sized by the number of levels in classes using that die.
2. Advancement follows with no change of its own: a character who levels into
   a second class with a different die gains that pool through IE-008's
   existing declare-or-resize loop, and one who levels in a class they already
   have grows the existing pool. Spent is untouched, as now.
3. A single-class character's pools are **byte-identical** to today's — same
   key, same label, same maximum, same `recovers`. This is the whole
   compatibility story and both frozen logs depend on it.

### Architecture constraints

- Do not reimplement the derivation. `hitDicePools` is the function; call it.
  If its signature does not fit `poolsFor`'s caller, adapt at the call site.
- No new event type, no change to `events.ts`, the reducer or the fold.
- Both frozen logs must fold unchanged. Their characters are single-class, so
  item 3 is what protects them — assert it directly rather than relying on it.
- Do not change any class table or `poolSizeOf`.

### Acceptance criteria

1. A failing test first: a Paladin 4 / Fighter 1 has a d10 pool of 4 and a d8
   pool of 1. It must fail on `main` for the right reason — one pool, wrong
   size.
2. Advancement into a second class with a different die declares the new pool;
   advancement within an existing class resizes it; spent is preserved across
   both, asserted.
3. A single-class character's declared pools are asserted byte-identical to
   the current output.
4. Both frozen logs fold to the state they have always folded to.
5. `CLAUDE.md`'s Multiclassing section says what the code now does.
6. The whole gauntlet passes; `COVERAGE.md` regenerated.

### Tests and conformance

`class-pools.test.ts` and the advancement tests beside it; `multiclass.test.ts`
keeps its existing assertions on `hitDicePools` unchanged — they are what makes
this a call rather than a rewrite.

### Dependencies

None. IE-008 (`601774c`) built the shared derivation this edits, and is merged.

### Likely file surface

`packages/engine/src/creation.ts`, `packages/engine/src/multiclass.ts` (only if
the signature needs adapting), `class-pools.test.ts`, `CLAUDE.md`.

### Out of scope

Per-class spell preparation; anything else in the multiclass rules; the other
dead functions the audit lists (`spellOfSource`, `pendingDamageOf`,
`pendingTestOf`) — each needs its own evidence.

### Known risks

- A character with two classes sharing a die type must get **one** pool of the
  combined level, not two pools or one of the wrong size. That is the case
  `hitDicePools` already handles and the fixture should pin.
