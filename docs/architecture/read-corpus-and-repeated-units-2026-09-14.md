# The read corpus, repeated units, and an area a slot scales — 2026-09-14

**A bounded YELLOW escalation, raised by IE-056's builder, endorsed by its
independent reviewer, answered by Fable, recorded by the foreman.** Two
questions went out. Fable answered the first and returned the second as GREEN;
the foreman decided that one and its reasoning is at the bottom.

**Nothing here was implemented.** IE-056 is merged and tranche 7's roster is
closed, so both answers are tranche 8's work. The decision is recorded now,
while the evidence is fresh, so the next cycle is briefed from it rather than
re-deriving it.

---

## Question 1 — which conformance guard gives way?

### What was asked

To be *sentence-complete*, a spell needs a clause-anchored entry for every
printed sentence that trips a mechanical marker. Two guards enforce it:

- **`sentenceGaps`** — every marker-tripping sentence must carry an adjudication.
- **`unanchoredPhrases`** — a clause's anchor phrase must occur **exactly once**
  across that spell's own printed units.

The SRD prints a summon's stat block as an HTML table containing **three
identical `<td>SAVE</td>` cells in one row**. Each is its own unit, each trips
the `saving-throw` marker, and every substring of one occurs three times. No
reading satisfies both guards.

The foreman verified that much in `packages/srd/raw/spells.md` before spending
Fable on it, and escalated it as YELLOW because every apparent escape would
change what "read" means for all sixty read entries and the ~145 grandfathered.

### The answer: **neither guard gives way — the corpus is wrong**

Fable rejected all four options the escalation offered, including the one the
builder recommended and the foreman leaned toward. The finding underneath them
is better than the question that was asked.

**The stat block is in the corpus by parser accident, and only half of it is.**

- `packages/srd/src/parse/spells.ts:52` bounds a spell entry at `####` **only**.
- The three `## <Stat Block>` headings are the *only* `##`/`###` headings after
  `## Spell Descriptions` — **verified by the foreman**: `Otherworldly Steed`
  (`spells.md:2320`), `Giant Insect` (`:2749`), `Draconic Spirit` (`:5275`), and
  nothing else.
- So each is swept into the preceding spell, and because it follows the upcast
  line, into `higherLevel` (`spells.ts:158–166`).
- Meanwhile the stat block's own `#### Traits / #### Actions / #### Bonus Actions`
  (`spells.md:2376–2384`) form `####` blocks with no school line and are
  **silently dropped** (`spells.ts:101–103`).

**Measured in the generated corpus**, which is the part that makes this a defect
rather than a curiosity:

| Spell | `higherLevel` today |
|---|---|
| `find-steed` | **1,191 characters** |
| `giant-insect` | **1,149 characters** |
| `summon-dragon` | **1,221 characters** |

Each begins with the one sentence the book actually prints there — *"Use the
spell slot's level for the spell's level in the stat block."* — and then
swallows the stat block. **The corpus holds the top half of a stat block filed
as upcast text and none of the bottom half.** Nobody decided that. It is a
parser seam, and it leaks into two other readers: `coverage-data.ts:70` and
`spell-tracking.test.ts:369` concatenate `higherLevel` the same way.

### The two corrections

1. **The spell parser bounds an entry at any markdown heading** (`#{1,6}`), not
   only `####`. `_Large Celestial, Fey, or Fiend (Your Choice), Neutral_` does
   not match `SCHOOL_LINE` (`spells.ts:36–37`), so the `##` block is skipped
   exactly as prose sections already are. Spell count and problem count are
   unchanged; **exactly three `higherLevel` values change**, each to the one
   sentence the book prints there.
2. **`unanchoredPhrases` counts occurrences over the spell's *distinct* printed
   units** — a one-line change at `missing-shapes.ts:4656`
   (`[...new Set(printedUnitsOf(spellId))]`) plus its doc comment.

**Why that preserves the rule rather than weakening it.** The anchoring rule's
stated purpose, in its own words at `missing-shapes.ts:4642–4644`, is to refuse
*"a phrase that would silently take a neighbouring sentence's licence"*. A
sentence the book prints verbatim five times is **one claim printed five times**;
reading one copy cannot take a *different* sentence's licence, because there is
no different sentence. Identical text has no neighbouring licence to take.

### The question the escalation asked third, answered definitively

*Do the sixty existing read entries stay valid without re-reading?* **Yes, and
provably.** Fable measured every parsed spell: **13 print a verbatim-duplicate
unit; 9 print a marker-tripping one; none of the nine is read.** That is not
luck — a marker-tripping duplicate makes an entry unreadable under the current
guard, so no read entry can contain one. The sixty are structurally untouched.

### The problem was wider than the five that were escalated

The five pinned in `blocked-on.test.ts` are not the whole set. Three more are
caught by the same defect and **pinned by nothing today**:

| Spell | The duplicate |
|---|---|
| `control-weather` | `<th>Condition</th>` ×3 |
| `reincarnate` | `<th>1d10</th>` ×2 |
| `scrying` | `<th>Save Modifier</th>` ×2 |

### Why each offered option lost

- **(a) strip table markup in `splitSentences`** — it would **un-anchor existing
  read entries**: Confusion and Divine Word are read *through* their table cells
  (`blocked-on.test.ts:841–845`). It would also delete Prismatic Spray's
  `12d6 Fire damage` rows, which are the spell's mechanics, and it does nothing
  for the three `<th>` cases.
- **(b) alone** — half right. Without the parser fix it invites someone to write
  a "reading" of `<td>SAVE</td>`, a column header.
- **(c) a unit index** — a positional pointer that breaks on re-vendor, and
  unnecessary once distinct units are counted.
- **(d) leave it** — leaves a parser defect in `spells.json` that two other
  readers consume, and reports three summons unread for a reason that is not
  "nobody read them".

### The coverage decision, taken deliberately

Removing the stat-block lines from the corpus **is** a coverage decision, and it
is the right one. The instrument reads *the spell's entry as the SRD bounds it
by headings*. The stat block is printed under its own heading, exactly as the
monster chapter prints its stat blocks — `monsters.ts:15–20` already reads this
identical structure at `###`. The spell's own sentence *"This creature uses the
**Otherworldly Steed** stat block"* (`spells.md:2310`) is the clause that anchors
to `a-stat-block-created-mid-fight`, and the stat block's contents — AC, Hit
Points, the Fly speed at level 4+, the actions the parser already drops — are
that shape's **payload**, to be parsed by the shape's builder.

**Do not add a `statBlock` field now.** It would be a member nothing consumes,
which is the class of speculative field this repository keeps deleting.

### Debt this accepts, to be pinned rather than assumed

> The three summon stat blocks the spell chapter prints under `##` headings —
> Otherworldly Steed (`spells.md:2320`), Giant Insect (`:2749`), Draconic Spirit
> (`:5275`) — are parsed by nothing. The spell parser stops at their heading on
> purpose, and `a-stat-block-created-mid-fight` cannot be built until its brief
> names the parser that reads them. The monster parser already reads this
> structure at `###`.

### Blast radius, for the task that implements this

**CHANGES** — `spells.ts`'s `HEADING` regex and its doc comment; regenerate
`packages/srd/src/generated/spells.json` and `COVERAGE.md` (both regenerated,
never merged); `missing-shapes.ts:4656` plus the doc comment at `:4639–4651` and
the mirror at `blocked-on.test.ts:303–313`.

**`blocked-on.test.ts:787–846` is FLIPPED, not deleted** — this repository's
convention, and the third time it has been applied. After the change the three
summons' units contain no `<t`, their `higherLevel` is exactly *"Use the spell
slot's level for the spell's level in the stat block."*, the five remaining
repeated units anchor (`unanchoredPhrases` → `[]`), and the table extends to
`control-weather`, `reincarnate` and `scrying`. **The `calm-emotions` "the
creature" counterexample at `:316–323` stays and must still report >1** — that is
what proves the dedupe did not gut the guard.

A parser test asserts spell count and problem count unchanged and exactly three
`higherLevel` values changed.

**MUST NOT CHANGE** — `splitSentences`, `CLAUSE_MARKERS`, `sentenceGaps`,
`isSentenceComplete`, the read/unread workflow rule, any `BLOCKED_ON` entry, and
no `statBlock` field, no new shape id, no unit index.

**Acceptance** — the full anchoring guard (`blocked-on.test.ts:352`) and the
coverage guard stay green over the real map **with no entry edited**.
`isSentenceComplete` stays false for all eight until a *content* task reads them:
this task makes them readable, it does not read them.

### Second-order findings

1. `control-weather`, `reincarnate` and `scrying` are caught by the same defect
   and pinned by nothing; the same task fixes and pins them.
2. `coverage-data.ts:70` and `spell-tracking.test.ts:369` read the half stat
   block today. **Both change output on regeneration** — expected, and the brief
   must say so rather than letting it look like a regression.
3. The `condition` marker fires on Control Weather's weather "Condition" header.
   An over-firing marker is the instrument's stated policy
   (`missing-shapes.ts:4400–4402`), so this is noted, not a fault.

---

## Question 2 — an area a slot scales. **GREEN; the foreman decided it**

Fable returned this one rather than deciding it: *"Two consumers asking for one
primitive is this repository's recorded bar, and a false 'blocked on nothing'
for Fog Cloud is corrected on arrival."* It added one measurement the escalation
did not have — the SRD prints **four** slot-scaled sizes, not two — and left the
membership question to the foreman.

**The foreman's decision, made by reading the four entries rather than counting
them:**

| Spell | What the slot scales | In the shape? |
|---|---|---|
| **Confusion** `:1188` | *"The Sphere's radius increases by 5 feet"* — the Sphere **is** the spell's area of effect | **yes** |
| **Fog Cloud** `:2588` | *"The fog's radius increases by 20 feet"* — the Sphere of fog is the area | **yes** |
| **Create or Destroy Water** `:1525` | *"the size of the Cube increases by 5 feet"* — the Cube is the region within which fog is destroyed | **yes**, verify the entry when briefing |
| **Creation** `:1590` | *"The Cube increases by 5 feet"* — the Cube is the **size of the matter created**, not a region of effect | **no** |

**The distinction is region-of-effect versus created object**, and it is the
same distinction the format already draws elsewhere. Creation's Cube is the
thing the spell makes; Confusion's, Fog Cloud's and Create or Destroy Water's
are regions the spell acts within. Creation is therefore a *different* shape —
a created object's size the slot scales — with **one consumer**, which is below
the two-writer bar. **It is not filed here and no id is invented for it**; it
goes on the record as the instance to watch for a second.

`SpellArea` (`spell-definitions.ts`) holds one fixed size, and
`docs/design/spell-definitions.md` says a slot reaches the damage dice and the
target count. An area is not on that list, so the engine would resolve a level 6
Confusion over the level 4 Sphere and **catch too few creatures** — a wrong
number with no symptom, which is why this is debt rather than a gap.

**The id must be written so a definition could actually name it** — the same
test `durationAtSlot` passed. Until the task lands, Confusion's clause stays
filed `'table'` **under protest**, with its note's first sentence saying it is
wrong on purpose and a test pinning that, exactly as IE-056 left it.
