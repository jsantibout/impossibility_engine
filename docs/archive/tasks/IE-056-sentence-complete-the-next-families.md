# IE-056 — Sentence-complete the families the next cycle will be briefed from

state: DONE
lane: content
tranche: 7
parallel-safe: YES — `scripts/missing-shapes.ts` and `blocked-on.test.ts` only
depends-on: none
worker: none
approved: 2026-09-14 — "APPROVE TRANCHE 7."
merge-approved: 2026-09-14 — "APPROVE TRANCHE 7."

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

## Completion digest — re-scoped by the foreman, merged, two questions escalated

**Merged `e435867`** under tranche authority, **re-scoped to what the reading could
honestly deliver**. `main` green at **8,646 tests across 125 files**, +69 in
`blocked-on.test.ts` (106 → 175).

The builder returned `ARCHITECTURE_BLOCKED` and the reviewer returned `ESCALATE`
**with no defects**, writing: *"it is safe to merge as it stands and the
escalation is about the two decisions, not about the code."* That is the
IE-047 shape and it is handled the same way — the delivered work merges, the
architecture question goes to Fable, and the re-scope is recorded as the
foreman's declaration rather than implied.

### What it delivered, read off the derived report rather than the digest

| Family | Finishes (read) |
|---|---|
| `an-action-a-spell-compels-or-forbids` | 0 → **2** |
| `a-wall-or-several-templates-in-one-area` | 0 → **2** |
| `a-second-place-to-put-a-creature` | 0 → **1** |
| `a-stat-block-created-mid-fight` | **0**, and honestly so — see below |

Three of four families are off zero, so three families become briefable from a
**read** count. That was the task's purpose and it is achieved. One family's
`unblocksRead` gained a second blocker on being read, which is the instrument
working rather than failing.

**Five spells in total are not sentence-complete, and all five are proven
unreachable rather than skipped** — the reviewer verified that independently.
The builder took the zero and pinned why instead of bending a guard, which is
the behaviour this repository asks for and rarely gets to record.

### The escalation, and the foreman verified its premise before paying for Fable

**A printed unit the SRD repeats verbatim can carry no clause.** `sentenceGaps`
demands an adjudication for every sentence that trips a marker;
`unanchoredPhrases` forbids any phrase not occurring exactly once in the spell's
own printed units. **Both cannot be satisfied**, and the foreman confirmed the
premise in the source rather than taking the report: `packages/srd/raw/spells.md`
prints Find Steed's summon stat block as an HTML table carrying **three
identical `<td>SAVE</td>` cells in a single row**. Each is its own unit, each
trips the `saving-throw` marker, and every substring of one occurs three times.

**The cost is exact and it is the top of the book.** Find Steed, Giant Insect and
Summon Dragon are the *entire* `unblocksUnread` list of
`a-stat-block-created-mid-fight`, the highest-ranked family. Prismatic Spray and
Prismatic Wall are caught the same way by a repeated "Successful Save" row. And
every available escape — teaching the splitter about table markup, counting units
rather than occurrences, or letting a clause name a unit index — **redefines what
"read" means for all sixty read entries and the ~145 still grandfathered**.

That is why it is **YELLOW and not the foreman's**: the read/unread rule is what
gates which shapes may be briefed at all, so changing its semantics changes how
every future roster is planned.

**The second question travels with it.** No shape id names *an area a slot
scales*. SRD Confusion prints "The Sphere's radius increases by 5 feet for each
spell slot level above 4" and `SpellArea` holds one fixed size, so the engine
would resolve a level 6 casting over the level 4 Sphere and catch too few
creatures. The brief forbade inventing a shape id and offered "the nearest
honest existing shape or `'table'`" — and there is no nearest honest shape, so
the clause is filed `'table'` **under protest**, with the note's first sentence
saying it is wrong on purpose and a test pinning that. Debt recorded as fiction,
declared rather than hidden.

### Reported, not acted on

- **SRD Fog Cloud prints the second slot-scaled area** — "The fog's radius
  increases by 20 feet for each spell slot level above 1" — and `BLOCKED_ON`
  still records that spell as **blocked on nothing at all**. So the shape, if it
  is added, lands with two consumers and corrects a false claim on arrival.
- `SpellCheck.onSuccess` names Phantasmal Force and Detect Thoughts beside Maze
  as spells printing `end-casting`; only Maze was in scope and only Maze was
  re-filed.
- SRD Divine Word's "Each creature of your choice in range" caps the target list
  at nobody, where `TargetRule.count` is a number.

### Nothing was bent to make this pass

No shape id invented — a test proves the id set is unchanged. No marker widened,
no hand list added, no guard relaxed. `MISSING_SHAPES`, `ADJUDICATED`,
`TRACKED_ADJUDICATED`, `MECHANICAL_MARKERS` and every exported function are
**byte-identical to `main`**; every hunk is inside the `BLOCKED_ON` literal and
its docstring. No engine code, no fold, no replay surface, both frozen logs
untouched.

**The impossibility is proven rather than asserted**: the test at
`blocked-on.test.ts` measures 3/3/3/5/5 matches for the longest phrase available,
and its discriminating counterexample is Confusion and Divine Word, which print
tables whose marker cells **differ** and which are read successfully. That test
is also the gate for whatever Fable decides — a fix must **flip** it, exactly as
IE-053 flipped IE-047's.
