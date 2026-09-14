# IE-056 — Sentence-complete the families the next cycle will be briefed from

state: APPROVED_FOR_IMPLEMENTATION
lane: content
tranche: 7
parallel-safe: YES — `scripts/missing-shapes.ts` and `blocked-on.test.ts` only
depends-on: none
worker: none
approved: 2026-09-14 — "APPROVE TRANCHE 7."
merge-approved: none

## Brief

### Objective

Read the SRD paragraphs of the spells in the three or four highest-leverage
blocker families and give each a clause-anchored entry, so that the next cycle
can be briefed from a **read** `finishes` count rather than an unread one.

### Why now

**This is the binding constraint on tranche 7's capability content, measured.**
IE-044 split `finishes` into read and unread and recorded the workflow rule that
a shape is briefed only from a sentence-complete list. On `main` today, the
entire blocker table reads **`Finishes (read) = 0`** for every family except
`a-condition-immunity-a-spell-grants`, which IE-044 backfilled and which is
exactly the one capability task this tranche can honestly carry (IE-042).

So capability is not deferred by preference in tranche 7 — it is **gated by
evidence**, and this task is what ungates it. The instrument exists; what is
missing is the reading.

It is also where the instrument earns out. Every wrong prediction the map has
made — Mind Blank, Protection from Energy, Enthrall, Magic Weapon, True Strike,
and Hex's third sentence — was a sentence nobody had read, and IE-036 found two
more in its own twelve (Instant Summons and Magic Mouth print a dismissal clause
the markers cannot see).

### Which families, and why those

Ranked by what a read count would unblock, from `COVERAGE.md`:

| Family | Blocks | Finishes (unread) |
|---|---|---|
| `a-stat-block-created-mid-fight` | 15 | **4** |
| `an-action-a-spell-compels-or-forbids` | 26 | 2 |
| `a-second-place-to-put-a-creature` | 19 | 2 |
| `a-wall-or-several-templates-in-one-area` | 10 | 2 |

Take them in that order and stop when the task is full rather than rushing the
last — **an unread entry is better than a hastily read one**, and the count is
the point.

### Required behaviour

1. For each spell in a chosen family, read its **own** SRD paragraph in
   `packages/srd/raw/spells.md` and give it clause-anchored entries in
   `BLOCKED_ON`: a distinctive phrase from that paragraph, matched exactly once,
   with `why` a shape id, `'table'`, or `'expressible'`.
2. Every sentence that trips one of the honesty guard's markers gets an
   adjudication — that is what sentence-complete means, and the guard enforces
   it.
3. **A second blocker nobody had recorded is the finding, not a failure.**
   Record it prominently in the digest with the SRD sentence, exactly as IE-036
   did for its two.
4. **Do not invent a shape id.** If a clause needs one that does not exist, that
   is an architecture decision and belongs in front of a reviewer — report it
   and adjudicate to the nearest honest existing shape or `'table'`, saying so.
5. **Do not extend the marker set.** It is a stated floor; if a real clause
   trips no marker, say so in the digest as IE-036 did.
6. `COVERAGE.md` regenerated; the chosen families' `Finishes (read)` moves off
   zero and the digest states the before and after.

### Architecture constraints

- no new hand list, no invented shape, no widened marker set;
- a phrase must occur **exactly once** in that spell's own paragraph, both
  directions, which is the existing guard.

### Acceptance criteria

1. Every spell in each chosen family is sentence-complete, asserted by the
   existing guard rather than by claim.
2. `consumersOf` reports a non-zero `finishes (read)` for those families, and
   the digest quotes the numbers before and after.
3. Every newly found blocker is named in the digest with the SRD sentence that
   forced it.
4. No shape id is invented; the id set before and after is identical unless the
   digest argues otherwise and names a reviewer who agreed.
5. `COVERAGE.md` byte-clean after regeneration; the full suite green.

### Tests and conformance

`blocked-on.test.ts` is the conformance. No engine code is touched.

### Dependencies

None, and it collides with nothing — wave 2 beside the mechanism spine.

### Out of scope

Building any of the shapes. Writing any spell definition. Re-filing the ~180
entries outside the chosen families.

### Known risks

The risk is rushing: a family marked read that was skimmed is worse than one
left unread, because the next tranche is planned from it. Fewer families read
properly is the better outcome, and the brief says so.
