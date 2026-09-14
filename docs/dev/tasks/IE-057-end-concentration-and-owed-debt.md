# IE-057 — Ending Concentration while the world owes a saving throw

state: IMPLEMENTING
lane: mechanism
tranche: 7
parallel-safe: CONDITIONAL — `commands/casting.ts`; not beside IE-053
depends-on: none
worker: qb-builder, launched 2026-09-14 from `ce20eba` (wave 3)
approved: 2026-09-14 — "APPROVE TRANCHE 7."
merge-approved: none

## Brief

### Objective

Decide and implement whether `endConcentration` may run while a mandatory area
effect is outstanding — the one door out of a casting that is not guarded by
`mayAct`.

### Why now

IE-048 found it and reported rather than fixed, correctly, because the brief did
not name that command: **`endConcentration` is not `mayAct`-guarded, and it ends
a casting through the same `releaseCasting` door every guarded command uses.**
So it forgives exactly the outstanding `OwedAreaEffect`s that IE-048's own new
guard exists to protect.

It is invisible to the derived action-economy sweep, and that is the interesting
part: that sweep finds commands by the transitive closure of the **six
action-economy primitives and the two spending events**, and `endConcentration`
spends nothing — so it is never classified as a spender and never asked for an
exemption. A command that ends a casting without spending anything is a shape
the sweep cannot see.

### The rules question, which is real and is why this is a task rather than a line

SRD's Concentration entry: *"The creator can end Concentration at any time (no
action required)."* So it is genuinely **not an action**, and `mayAct` is named
for actions.

But `mayAct` is not only about actions. `relocateCreature` is guarded and
**spends nothing** — `docs/design/casting.md` states the precedent in as many
words ("It spends nothing and is guarded anyway"): it is guarded because it
*raises* area debts, and because two operations that both move a creature must
not disagree about whether the world has to be settled first. And the
repository's own argument for the global debt is three moves long and ends:
*settle the mandatory mechanical fact first.* `docs/design/space-and-areas.md`
carries the one `mayAct` policy and its allowlist.

The candidate readings, and the foreman's position:

1. **Guard it.** An outstanding area effect may drop the caster, which would end
   the Concentration anyway — so acting into an unsettled world is exactly the
   case the debt exists for. Consistent with `relocateCreature`.
2. **Leave it unguarded**, on the grounds that the SRD gives this away for free
   and at any time, including in the middle of somebody else's turn.

The foreman's reading is **(1)**, on `relocateCreature`'s precedent, and the
brief is written for it. **If the builder's reading of the SRD or of the debt
machinery says otherwise, that is a YELLOW rather than a deviation** — do not
implement (2) silently, and do not implement (1) if you come to believe it
invents a restriction the book does not contain.

### Required behaviour

1. `endConcentration` consults `mayAct`, inside the `once` callback and **after
   the duplicate check** — the trap this file records eight times over.
2. Its refusal is the existing `area_effect_owed` code; no new code enters the
   sweep's population.
3. The written exemption list in `invariants.test.ts` gains or loses whatever
   the change requires, in both directions, so a future reader sees the decision
   rather than an absence.
4. **Record the shape the sweep cannot see.** A command that ends a casting and
   spends nothing is invisible to the action-economy closure; say so where the
   next person will meet it, and say whether any *other* command has that shape
   (sweep for it — `endOngoingSpell` is the obvious candidate, and IE-048 chose
   deliberately for it).

### Architecture constraints

- the duplicate check comes first, always;
- no new refusal code;
- if the answer turns out to be "leave it unguarded", the task still delivers
  the written record and the sweep — a decision recorded is the deliverable
  either way.

### Acceptance criteria

1. With an area effect outstanding, `endConcentration` is refused
   `area_effect_owed`; with it settled, it succeeds. Both asserted.
2. A retried command id is a no-op **and is not refused** by the guard — the
   retry arrives at the debt its own first run may have raised.
3. The sweep for other unguarded casting-enders is in the digest with what it
   found.
4. `refusal-sweep.test.ts` green in both directions; both frozen logs fold
   unchanged.

### Tests and conformance

The `mayAct` paragraph gains the decision **where it now lives** —
`docs/design/space-and-areas.md`, which carries the one policy and the
allowlist, with `docs/design/casting.md` authoritative for what ending a casting
does. Read both first; `CLAUDE.md` is the constitution and the router only. If
the answer is to guard, the allowlist's written reasons stay as they are.

### Dependencies

None. Not beside IE-053, which owns `commands/casting.ts` as a reader.

### Out of scope

`endRest`, whose exemption `docs/design/space-and-areas.md` records as an open
question rather than a decision. Any change to what `releaseCasting` does.

### Known risks

Low in code, real in rules. The risk is implementing a restriction the SRD does
not contain because it is tidy — which is why the brief names the counter-reading
and makes disagreement a YELLOW rather than something to resolve quietly.
