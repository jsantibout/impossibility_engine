# IE-048 — End a casting by its id, and retire the two zero-caller commands

state: OWNER_APPROVAL_REQUIRED
lane: mechanism
tranche: 6
parallel-safe: CONDITIONAL — `commands/casting.ts`, `commands/ongoing.ts`, the barrel; not beside IE-041, IE-042, IE-046 or IE-047
depends-on: IE-038, IE-041
worker: none
approved: none
merge-approved: none

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
