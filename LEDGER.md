# LEDGER.md — what is left before a level 5 party can play

> **Derived. Do not edit by hand.** Regenerate with `npm run ledger` and
> commit the result. `COVERAGE.md` answers how much of the SRD is built;
> this answers what stands between the engine and the destination in
> `docs/ROADMAP.md` §0, which is the first of the four ship criteria:
> **this report at zero**.

Everything below is restricted to what a character of level 1–5 can reach.
A spell is in reach when its class table gives a slot of its level at the
fifth, or gives cantrips at all — the rule `playableLevels` applies, asked
through the same two functions so the two cannot drift. A feature is in
reach when it is printed at level 5 or below. A stat block is in reach when
its Challenge Rating is 5 or less.

**Waiting on a shape is a debt; waiting on nothing is not.** A clause the
table owns is fiction no rule reads afterwards and nobody will ever pay it,
which `docs/design/content.md` states as the test: a table fact that a rule
then reads is a debt, a table fact nothing reads afterwards is a handover.
An item in the *waits on none* column is finished business, and it is listed
rather than omitted because an entry silently missing from a ledger looks
exactly like an entry nobody read.

**And there is a third column, because that last sentence used to be false.**
Gate G1 found *waits on none* holding three different claims — nobody has
read it, it is expressible and nobody wrote the definition, and it is handed
over — of which only the third is finished. *Waits on a definition* is the
first two. The point of splitting them out: a measurement over adjudications
has to **rise** when somebody reads the book, and it cannot while the unread
state is displayed as zero.

## The five populations

| Ledger | Size | Waits on an engine shape | Waits on a definition | Waits on none |
|---|---|---|---|---|
| Spells in reach, not executed | 84 spells | 49 | 0 | 35 |
| Features manual, or a pool with nothing to buy | 2 features | 2 | 0 | 0 |
| Items a level 1–5 party can buy | 157 items | 0 | 0 | 157 |
| Glossary general rules nothing executes | 22 rules | 0 | 0 | 22 |
| CR ≤ 5 stat-block items handed over or unapplied | 180 items | on 115 of 244 blocks | 0 | 129 blocks already clean |

## 1. Spells in reach the engine does not resolve

Four states, kept apart because conflating them is how a project believes
it is finished. `executed-partial` is a spell the engine resolves that
still carries a clause nobody has built; `tracked` is one it casts and
hands the effect over; `no-definition` is a spell the catalogue does not
hold at all. An executed spell with nothing left is not here.

| Shape | Blocks | Finishes |
|---|---|---|
| `an-effect-that-suppresses-other-magic` | 5 | 2 |
| `a-choice-made-at-the-casting` | 4 | 2 |
| `a-casting-ended-by-a-trigger` | 5 | 1 |
| `a-fact-only-the-table-can-declare` | 5 | 1 |
| `a-barrier-that-blocks-passage` | 3 | 1 |
| `a-stat-block-created-mid-fight` | 3 | 1 |
| `a-target-rule-the-format-cannot-state` | 3 | 1 |
| `difficult-terrain-an-area-creates` | 2 | 1 |
| `a-creature-somebody-else-is-playing` | 1 | 1 |
| `a-reaction-window-that-opens-on-being-targeted` | 1 | 1 |
| `a-rider-on-a-later-weapon-attack` | 4 | 0 |
| `a-standing-effect-derived-from-where-a-creature-stands` | 4 | 0 |
| `a-bonus-narrowed-to-a-skill` | 3 | 0 |
| `a-check-another-creature-may-attempt` | 3 | 0 |
| `a-second-place-to-put-a-creature` | 3 | 0 |
| `an-activation-that-resolves-an-area` | 3 | 0 |
| `movement-modes` | 3 | 0 |
| `a-damage-penalty-a-spell-grants` | 2 | 0 |
| `a-filter-on-the-attackers-creature-type` | 2 | 0 |
| `a-random-outcome-that-is-not-a-d20` | 2 | 0 |
| `a-repeat-save-raised-by-a-trigger` | 2 | 0 |
| `a-repeat-save-that-does-something-on-a-failure` | 2 | 0 |
| `a-spells-effects-applied-to-different-targets` | 2 | 0 |
| `an-action-the-engine-has-no-spender-for` | 2 | 0 |
| `an-activation-taken-by-somebody-other-than-the-caster` | 2 | 0 |
| `an-activation-that-forces-a-saving-throw` | 2 | 0 |
| `an-outcome-that-reads-the-targets-hit-points` | 2 | 0 |
| `a-casting-dismissed-early` | 1 | 0 |
| `a-condition-a-spell-suppresses` | 1 | 0 |
| `a-condition-benefit-an-effect-takes-away` | 1 | 0 |
| `a-condition-immunity-narrowed-to-its-source` | 1 | 0 |
| `a-condition-that-ends-when-its-holder-leaves-an-area` | 1 | 0 |
| `a-creature-fact-an-effect-overrides` | 1 | 0 |
| `a-creature-type-predicate-an-area-reads` | 1 | 0 |
| `a-die-behaviour-a-spell-asks-for` | 1 | 0 |
| `a-distance-a-creature-travels-inside-an-area` | 1 | 0 |
| `a-mode-on-the-save-a-spell-forces` | 1 | 0 |
| `a-range-that-scales-with-caster-level` | 1 | 0 |
| `a-repeat-save-with-no-condition-to-hang-it-on` | 1 | 0 |
| `a-selector-for-every-d20-test` | 1 | 0 |
| `a-self-cure-a-spell-forbids` | 1 | 0 |
| `a-speed-an-effect-multiplies` | 1 | 0 |
| `a-success-branch-that-does-something` | 1 | 0 |
| `an-action-a-spell-compels-or-forbids` | 1 | 0 |
| `an-area-moved-by-the-casters-own-movement` | 1 | 0 |
| `an-area-trigger-measured-from-a-point` | 1 | 0 |
| `an-area-trigger-on-the-casters-turn` | 1 | 0 |
| `an-effect-that-fires-when-the-casting-ends` | 1 | 0 |
| `an-effect-that-stabilises-a-dying-creature` | 1 | 0 |
| `senses-beyond-declared-sight` | 1 | 0 |
| `several-attack-rolls-from-one-casting` | 1 | 0 |
| `the-effects-source-as-a-participant` | 1 | 0 |
| `what-a-creature-is-holding` | 1 | 0 |

**Blocks** is every spell of this population the shape touches;
**finishes** is what it is the *only* blocker for — the column a tranche
is planned from. A spell can need more than one shape, so neither column
sums to the population.

#### `an-effect-that-suppresses-other-magic` — blocks 5, finishes 2

- **Knock** (level 2) — tracked
- **Magic Circle** (level 3) — tracked — also waits on 3
- **Nondetection** (level 3) — tracked
- **Sending** (level 3) — no-definition — also waits on 2
- **Tiny Hut** (level 3) — tracked — also waits on 2

#### `a-choice-made-at-the-casting` — blocks 4, finishes 2

- **Thaumaturgy** (level 0) — tracked
- **Enlarge/Reduce** (level 2) — tracked — also waits on 3
- **Glyph of Warding** (level 3) — tracked — also waits on 1
- **Plant Growth** (level 3) — executed-partial

#### `a-casting-ended-by-a-trigger` — blocks 5, finishes 1

- **Unseen Servant** (level 1) — tracked — also waits on 1
- **Invisibility** (level 2) — executed-partial
- **Phantasmal Force** (level 2) — no-definition — also waits on 2
- **Warding Bond** (level 2) — tracked — also waits on 1
- **Tiny Hut** (level 3) — tracked — also waits on 2

#### `a-fact-only-the-table-can-declare` — blocks 5, finishes 1

- **Hunter's Mark** (level 1) — executed-partial — also waits on 1
- **Sleep** (level 1) — executed-partial
- **Enthrall** (level 2) — tracked — also waits on 1
- **Levitate** (level 2) — executed-partial — also waits on 2
- **Call Lightning** (level 3) — tracked — also waits on 1

#### `a-barrier-that-blocks-passage` — blocks 3, finishes 1

- **Magic Circle** (level 3) — tracked — also waits on 3
- **Tiny Hut** (level 3) — tracked — also waits on 2
- **Wind Wall** (level 3) — executed-partial

#### `a-stat-block-created-mid-fight` — blocks 3, finishes 1

- **Unseen Servant** (level 1) — tracked — also waits on 1
- **Find Steed** (level 2) — executed-partial
- **Animate Dead** (level 3) — tracked — also waits on 1

#### `a-target-rule-the-format-cannot-state` — blocks 3, finishes 1

- **Ensnaring Strike** (level 1) — tracked — also waits on 2
- **Animal Messenger** (level 2) — tracked
- **Animate Dead** (level 3) — tracked — also waits on 1

#### `difficult-terrain-an-area-creates` — blocks 2, finishes 1

- **Gust of Wind** (level 2) — executed-partial — also waits on 1
- **Speak with Plants** (level 3) — tracked

#### `a-creature-somebody-else-is-playing` — blocks 1, finishes 1

- **Command** (level 1) — tracked

#### `a-reaction-window-that-opens-on-being-targeted` — blocks 1, finishes 1

- **Shield** (level 1) — executed-partial

#### `a-rider-on-a-later-weapon-attack` — blocks 4, finishes 0

- **Hex** (level 1) — tracked — also waits on 1
- **Alter Self** (level 2) — tracked — also waits on 1
- **Enlarge/Reduce** (level 2) — tracked — also waits on 3
- **Bestow Curse** (level 3) — tracked — also waits on 2

#### `a-standing-effect-derived-from-where-a-creature-stands` — blocks 4, finishes 0

- **Pass without Trace** (level 2) — tracked — also waits on 1
- **Silence** (level 2) — tracked — also waits on 1
- **Warding Bond** (level 2) — tracked — also waits on 1
- **Conjure Animals** (level 3) — tracked — also waits on 1

#### `a-bonus-narrowed-to-a-skill` — blocks 3, finishes 0

- **Enthrall** (level 2) — tracked — also waits on 1
- **Pass without Trace** (level 2) — tracked — also waits on 1
- **Slow** (level 3) — executed-partial — also waits on 2

#### `a-check-another-creature-may-attempt` — blocks 3, finishes 0

- **Ensnaring Strike** (level 1) — tracked — also waits on 2
- **Detect Thoughts** (level 2) — tracked — also waits on 1
- **Spike Growth** (level 2) — executed-partial — also waits on 1

#### `a-second-place-to-put-a-creature` — blocks 3, finishes 0

- **Find Familiar** (level 1) — executed-partial — also waits on 2
- **Blink** (level 3) — tracked — also waits on 1
- **Sending** (level 3) — no-definition — also waits on 2

#### `an-activation-that-resolves-an-area` — blocks 3, finishes 0

- **Dragon's Breath** (level 2) — tracked — also waits on 1
- **Gust of Wind** (level 2) — executed-partial — also waits on 1
- **Call Lightning** (level 3) — tracked — also waits on 1

#### `movement-modes` — blocks 3, finishes 0

- **Alter Self** (level 2) — tracked — also waits on 1
- **Levitate** (level 2) — executed-partial — also waits on 2
- **Gaseous Form** (level 3) — executed-partial — also waits on 2

#### `a-damage-penalty-a-spell-grants` — blocks 2, finishes 0

- **Enlarge/Reduce** (level 2) — tracked — also waits on 3
- **Ray of Enfeeblement** (level 2) — tracked — also waits on 2

#### `a-filter-on-the-attackers-creature-type` — blocks 2, finishes 0

- **Protection from Evil and Good** (level 1) — tracked — also waits on 1
- **Magic Circle** (level 3) — tracked — also waits on 3

#### `a-random-outcome-that-is-not-a-d20` — blocks 2, finishes 0

- **Blink** (level 3) — tracked — also waits on 1
- **Sending** (level 3) — no-definition — also waits on 2

#### `a-repeat-save-raised-by-a-trigger` — blocks 2, finishes 0

- **Hideous Laughter** (level 1) — executed-partial — also waits on 1
- **Fear** (level 3) — executed-partial — also waits on 1

#### `a-repeat-save-that-does-something-on-a-failure` — blocks 2, finishes 0

- **Ensnaring Strike** (level 1) — tracked — also waits on 2
- **Bestow Curse** (level 3) — tracked — also waits on 2

#### `a-spells-effects-applied-to-different-targets` — blocks 2, finishes 0

- **Calm Emotions** (level 2) — tracked — also waits on 1
- **Shining Smite** (level 2) — executed-partial — also waits on 1

#### `an-action-the-engine-has-no-spender-for` — blocks 2, finishes 0

- **Gaseous Form** (level 3) — executed-partial — also waits on 2
- **Haste** (level 3) — executed-partial — also waits on 2

#### `an-activation-taken-by-somebody-other-than-the-caster` — blocks 2, finishes 0

- **Find Familiar** (level 1) — executed-partial — also waits on 2
- **Dragon's Breath** (level 2) — tracked — also waits on 1

#### `an-activation-that-forces-a-saving-throw` — blocks 2, finishes 0

- **Detect Thoughts** (level 2) — tracked — also waits on 1
- **Levitate** (level 2) — executed-partial — also waits on 2

#### `an-outcome-that-reads-the-targets-hit-points` — blocks 2, finishes 0

- **Hex** (level 1) — tracked — also waits on 1
- **Hunter's Mark** (level 1) — executed-partial — also waits on 1

#### `a-casting-dismissed-early` — blocks 1, finishes 0

- **Gaseous Form** (level 3) — executed-partial — also waits on 2

#### `a-condition-a-spell-suppresses` — blocks 1, finishes 0

- **Calm Emotions** (level 2) — tracked — also waits on 1

#### `a-condition-benefit-an-effect-takes-away` — blocks 1, finishes 0

- **Shining Smite** (level 2) — executed-partial — also waits on 1

#### `a-condition-immunity-narrowed-to-its-source` — blocks 1, finishes 0

- **Magic Circle** (level 3) — tracked — also waits on 3

#### `a-condition-that-ends-when-its-holder-leaves-an-area` — blocks 1, finishes 0

- **Silence** (level 2) — tracked — also waits on 1

#### `a-creature-fact-an-effect-overrides` — blocks 1, finishes 0

- **Enlarge/Reduce** (level 2) — tracked — also waits on 3

#### `a-creature-type-predicate-an-area-reads` — blocks 1, finishes 0

- **Glyph of Warding** (level 3) — tracked — also waits on 1

#### `a-die-behaviour-a-spell-asks-for` — blocks 1, finishes 0

- **Chromatic Orb** (level 1) — executed-partial — also waits on 1

#### `a-distance-a-creature-travels-inside-an-area` — blocks 1, finishes 0

- **Spike Growth** (level 2) — executed-partial — also waits on 1

#### `a-mode-on-the-save-a-spell-forces` — blocks 1, finishes 0

- **Protection from Evil and Good** (level 1) — tracked — also waits on 1

#### `a-range-that-scales-with-caster-level` — blocks 1, finishes 0

- **Spare the Dying** (level 0) — tracked — also waits on 1

#### `a-repeat-save-with-no-condition-to-hang-it-on` — blocks 1, finishes 0

- **Slow** (level 3) — executed-partial — also waits on 2

#### `a-selector-for-every-d20-test` — blocks 1, finishes 0

- **Ray of Enfeeblement** (level 2) — tracked — also waits on 2

#### `a-self-cure-a-spell-forbids` — blocks 1, finishes 0

- **Hideous Laughter** (level 1) — executed-partial — also waits on 1

#### `a-speed-an-effect-multiplies` — blocks 1, finishes 0

- **Haste** (level 3) — executed-partial — also waits on 2

#### `a-success-branch-that-does-something` — blocks 1, finishes 0

- **Ray of Enfeeblement** (level 2) — tracked — also waits on 2

#### `an-action-a-spell-compels-or-forbids` — blocks 1, finishes 0

- **Slow** (level 3) — executed-partial — also waits on 2

#### `an-area-moved-by-the-casters-own-movement` — blocks 1, finishes 0

- **Conjure Animals** (level 3) — tracked — also waits on 1

#### `an-area-trigger-measured-from-a-point` — blocks 1, finishes 0

- **Phantasmal Force** (level 2) — no-definition — also waits on 2

#### `an-area-trigger-on-the-casters-turn` — blocks 1, finishes 0

- **Phantasmal Force** (level 2) — no-definition — also waits on 2

#### `an-effect-that-fires-when-the-casting-ends` — blocks 1, finishes 0

- **Haste** (level 3) — executed-partial — also waits on 2

#### `an-effect-that-stabilises-a-dying-creature` — blocks 1, finishes 0

- **Spare the Dying** (level 0) — tracked — also waits on 1

#### `senses-beyond-declared-sight` — blocks 1, finishes 0

- **Find Familiar** (level 1) — executed-partial — also waits on 2

#### `several-attack-rolls-from-one-casting` — blocks 1, finishes 0

- **Chromatic Orb** (level 1) — executed-partial — also waits on 1

#### `the-effects-source-as-a-participant` — blocks 1, finishes 0

- **Bestow Curse** (level 3) — tracked — also waits on 2

#### `what-a-creature-is-holding` — blocks 1, finishes 0

- **Fear** (level 3) — executed-partial — also waits on 1

#### Waiting on a definition — 0

Nothing here is blocked. Each is either a paragraph nobody has recorded
reading, or one the existing kinds already say and nobody has written — and
both are work, which is why they are no longer printed as finished business.


#### Waiting on no shape — 35

- **Druidcraft** (level 0) — tracked
- **Elementalism** (level 0) — tracked
- **Mage Hand** (level 0) — tracked
- **Mending** (level 0) — tracked
- **Message** (level 0) — tracked
- **Minor Illusion** (level 0) — tracked
- **Alarm** (level 1) — tracked
- **Comprehend Languages** (level 1) — tracked
- **Create or Destroy Water** (level 1) — tracked
- **Detect Evil and Good** (level 1) — tracked
- **Detect Magic** (level 1) — tracked
- **Detect Poison and Disease** (level 1) — tracked
- **Disguise Self** (level 1) — tracked
- **Floating Disk** (level 1) — tracked
- **Identify** (level 1) — tracked
- **Illusory Script** (level 1) — tracked
- **Purify Food and Drink** (level 1) — tracked
- **Silent Image** (level 1) — tracked
- **Speak with Animals** (level 1) — tracked
- **Arcane Lock** (level 2) — tracked
- **Find Traps** (level 2) — tracked
- **Gentle Repose** (level 2) — tracked
- **Locate Animals or Plants** (level 2) — tracked
- **Locate Object** (level 2) — tracked
- **Magic Mouth** (level 2) — tracked
- **Rope Trick** (level 2) — tracked
- **See Invisibility** (level 2) — tracked
- **Clairvoyance** (level 3) — tracked
- **Create Food and Water** (level 3) — tracked
- **Major Image** (level 3) — tracked
- **Meld into Stone** (level 3) — tracked
- **Speak with Dead** (level 3) — tracked
- **Tongues** (level 3) — tracked
- **Water Breathing** (level 3) — tracked
- **Water Walk** (level 3) — tracked

Listed by spell level, then name.

## 2. Features a level 1–5 character holds that the engine does not run

The population is `missing-feature-shapes.ts`'s: every feature declaring
`automation: 'manual'`, plus every feature declaring `engine` for a pool
with nothing to spend a use on, plus the one pool whose uses buy some of
what its page prints. Species and background traits are counted, because a
species trait is the same `FeatureDefinition` a class feature is and a
level 5 character holds one.

**Feats are counted too, and until gate G1 they were in no population at**
**all** — not this one, not the blocker map, not a guard. A `FeatDefinition`
carries no `automation` flag to select on, so the arm that answers for them
is `FEATS_ANSWERED_FOR`, a declared list held down at both ends by
`pool-blockers.test.ts` exactly as `POOLS_ONLY_PARTLY_BOUGHT` is — the
entries in it, and the complement pinned by name. Its bracket is the level:
an Origin feat and a Fighting Style print none and are taken at 1, so nine
of the sixteen are in a level 1–5 character's reach.

Of the 2, 1 are class or subclass features printed at level 5 or below, 1 are species or background traits and 0 are feats.
The snapshot of 2026-09-21 in `docs/dev/roadmap-ledger-2026-09-21.md`
counted the first group only, and did not see the pools; the traits are in
reach of a level 5 character too, which is where the difference in the size
comes from.

| Shape | Blocks | Finishes |
|---|---|---|
| `a-reroll-outside-the-test-window` | 1 | 1 |
| `a-feature-that-changes-what-a-casting-costs` | 1 | 0 |
| `a-standing-effect-derived-from-where-a-creature-stands` | 1 | 0 |
| `a-stat-block-created-mid-fight` | 1 | 0 |
| `an-attack-the-class-redefines` | 1 | 0 |
| `an-option-re-chosen-on-a-rest` | 1 | 0 |
| `movement-modes` | 1 | 0 |

**Blocks** is every feature of this population the shape touches;
**finishes** is what it is the *only* blocker for — the column a tranche
is planned from. A feature can need more than one shape, so neither column
sums to the population.

#### `a-reroll-outside-the-test-window` — blocks 1, finishes 1

- `human:resourceful` — Resourceful (level 1, species, manual)

#### `a-feature-that-changes-what-a-casting-costs` — blocks 1, finishes 0

- `warlock:eldritch-invocations` — Eldritch Invocations (level 1, class, manual) — also waits on 5

#### `a-standing-effect-derived-from-where-a-creature-stands` — blocks 1, finishes 0

- `warlock:eldritch-invocations` — Eldritch Invocations (level 1, class, manual) — also waits on 5

#### `a-stat-block-created-mid-fight` — blocks 1, finishes 0

- `warlock:eldritch-invocations` — Eldritch Invocations (level 1, class, manual) — also waits on 5

#### `an-attack-the-class-redefines` — blocks 1, finishes 0

- `warlock:eldritch-invocations` — Eldritch Invocations (level 1, class, manual) — also waits on 5

#### `an-option-re-chosen-on-a-rest` — blocks 1, finishes 0

- `warlock:eldritch-invocations` — Eldritch Invocations (level 1, class, manual) — also waits on 5

#### `movement-modes` — blocks 1, finishes 0

- `warlock:eldritch-invocations` — Eldritch Invocations (level 1, class, manual) — also waits on 5

#### Waiting on a definition — 0

Nothing here is blocked. Each is either a paragraph nobody has recorded
reading, or one the existing kinds already say and nobody has written — and
both are work, which is why they are no longer printed as finished business.


#### Waiting on no shape — 0


Listed by level, then id.

## 3. Items a level 1–5 party can buy

**The reach rule is a price.** The SRD prints one for the equipment tables
and for exactly one magic item — the Potion of Healing, at 50 GP — and
everything else under *Magic Items A–Z* arrives because a DM put it in a
hoard, which is a decision no ledger can predict and no ship criterion can
require. So this row is what a party can walk into a shop and buy.

Of the 157, 0 wait on a shape the engine does not have.
The untranscribed tail of the magic-item book is a real population and it is
`ITEM_BLOCKED_ON`'s, measured by `itemCoverageGaps` and reported in
`COVERAGE.md`; what it is not is something a level 5 party is owed, which is
why the two reports count it in different places.

*Nothing. Every priced item the catalogue holds carries a record.*

## 4. The glossary’s general rules

The population gate G1 found had **no home at all**: not a map, not a row,
not a guard. Spells, features and items each have a blocker map because
each is a record in the catalogue; a glossary rule is a heading in
`packages/srd/raw/rules.md` that nothing parses, so this one is hand-listed
in `packages/content/scripts/glossary-rules.ts` and held down at both ends
by its own test — a row claiming to be built names something `@ie/engine`
really exports or a `NAMED_ACTIONS` member, and a row claiming nothing runs
it is quoted as a value in no engine source file: no switch arm, no union
member, no lookup. Five of the seven are named in the engine’s prose and
are still unbuilt, which is why the guard asks for a literal rather than
for the word.

These are the rules a level 1–5 character reaches whatever they are playing,
so none of them waits on reach: every one is in it.


## 5. CR ≤ 5 stat-block lines handed over or unapplied

244 of the 332 carried stat blocks are CR ≤ 5. They print 738 lines, of which the parser reads 577 and hands over 161. Reading is not spending: a further 19 of the read attack lines carry a printed rider nothing applies, and 0 read trait lines state a mechanic no engine reader asks for. So the population is 180 items over 244 blocks — 129 of which already carry none of them.

**A third answer, counted apart from both:** 30 of the read trait lines are sentences the engine reads and **hands to the table**, and will never execute — the breathing traits, which say what a creature is and name nothing any rule consults, because nothing here drowns. They are neither spent nor waiting, so they are not among the 180 above and do not keep a block off the clean list. `HANDOVER_TRAIT_KINDS` holds the reason per kind, and `coverage.test.ts` pins that none of them has a reader after all.

**A block is the unit that matters and a line is the unit that is counted.**
A block with four unapplied lines is one fight that does not run, not four,
so the split above is per block while the size is per line. The piles below
overlap: one sentence can force a save and recharge.

| Shape | Lines | Blocks | Three example blocks |
|---|---|---|---|
| A hit whose line says more than the engine applies | 27 | 27 | Animated Rug of Smothering (CR 2) / Smother; Barbed Devil (CR 5) / Hurl Flame; Bearded Devil (CR 3) / Infernal Glaive |
| An effect a hit buys | 19 | 19 | Barbed Devil (CR 5) / Hurl Flame; Bearded Devil (CR 3) / Infernal Glaive; Black Pudding (CR 4) / Dissolving Pseudopod |
| A save a line forces | 11 | 11 | Bulette (CR 5) / Deadly Leap; Centaur Trooper (CR 2) / Trampling Charge (Recharge 5–6); Ettercap (CR 2) / Web Strand (Recharge 5–6) |
| A use the block limits per day | 9 | 8 | Darkmantle (CR 0.5) / Darkness Aura (1/Day); Gnoll Warrior (CR 0.5) / Rampage (1/Day); Night Hag (CR 5) / Nightmare Haunting (1/Day; Requires Soul Bag) |
| A line that casts, read and not spent | 7 | 7 | Couatl (CR 4) / Divine Aid (2/Day); Cultist Fanatic (CR 2) / Spiritual Weapon (2/Day); Doppelganger (CR 3) / Read Thoughts |
| A save whose line says more than the engine spends | 5 | 5 | Basilisk (CR 3) / Petrifying Gaze (Recharge 4–6); Gibbering Mouther (CR 2) / Gibbering; Steam Mephit (CR 0.25) / Steam Breath (Recharge 6) |
| A recharge | 4 | 4 | Centaur Trooper (CR 2) / Trampling Charge (Recharge 5–6); Ettercap (CR 2) / Web Strand (Recharge 5–6); Ghost (CR 4) / Possession (Recharge 6) |
| A legendary action’s own economy | 2 | 1 | Unicorn (CR 5) / Charging Horn |
| How many attacks the Attack action holds | 1 | 1 | Roper (CR 5) / Multiattack |
| A creature that casts | 0 | 0 | — |
| A trait shape nothing spends | 0 | 0 | — |

**Two of those rows are an effect nobody applies and an economy that is
already correct.** A recharge and a per-day limit are parsed onto every
line, carried onto the sheet, asked at the turn boundary and spent by
`takeStatedAction`; what is unapplied on such a line is what it *does*.
A brief quoting those rows should say so.

### Handed-over lines matching no enumerated shape — 140

A debt nobody has given an id to is still a debt, so these are named here
rather than dropped. They carry no parsed structure at all, which is why no
predicate reaches them and why classifying them is a reading of English
rather than a derivation — the roadmap keeps that reading in prose, and the
ledger keeps the list.

A legendary action is in both this list and the economy row above, because
they are two debts: that nothing spends a legendary action, and that
nothing applies what the line says. Leaving it out of one would take half
of it off the ledger.

- Air Elemental (CR 5) [trait] Air Form
- Ankheg (CR 2) [trait] Tunneler
- Azer Sentinel (CR 2) [trait] Fire Aura
- Bandit Captain (CR 2) [reaction] Parry
- Barbed Devil (CR 5) [trait] Barbed Hide
- Barbed Devil (CR 5) [trait] Diabolical Restoration
- Black Pudding (CR 4) [trait] Amorphous
- Black Pudding (CR 4) [trait] Corrosive Form
- Black Pudding (CR 4) [reaction] Split
- Bugbear Stalker (CR 3) [trait] Abduct
- Bugbear Warrior (CR 1) [trait] Abduct
- Bulette (CR 5) [bonus action] Leap
- Cat (CR 0) [trait] Jumper
- Chuul (CR 4) [trait] Sense Magic
- Commoner (CR 0) [trait] Training
- Couatl (CR 4) [trait] Shielded Mind
- Deer (CR 0) [trait] Agile
- Doppelganger (CR 3) [bonus action] Shape-Shift
- Dryad (CR 1) [trait] Speak with Beasts and Plants
- Dryad (CR 1) [bonus action] Tree Stride
- Earth Elemental (CR 5) [trait] Earth Glide
- Earth Elemental (CR 5) [trait] Siege Monster
- Ettercap (CR 2) [bonus action] Reel
- Ettercap (CR 2) [trait] Web Walker
- Fire Elemental (CR 5) [trait] Fire Aura
- Fire Elemental (CR 5) [trait] Fire Form
- Fire Elemental (CR 5) [trait] Water Susceptibility
- Flesh Golem (CR 5) [trait] Aversion to Fire
- Flesh Golem (CR 5) [trait] Berserk
- Flesh Golem (CR 5) [trait] Immutable Form
- Flesh Golem (CR 5) [trait] Lightning Absorption
- Gelatinous Cube (CR 2) [trait] Ooze Cube
- Gelatinous Cube (CR 2) [trait] Transparent
- Ghost (CR 4) [trait] Ethereal Sight
- Ghost (CR 4) [action] Etherealness
- Ghost (CR 4) [trait] Incorporeal Movement
- Giant Boar (CR 2) [trait] Bloodied Fury
- Giant Frog (CR 0.25) [action] Swallow
- Giant Seahorse (CR 0.5) [bonus action] Bubble Dash
- Giant Spider (CR 1) [trait] Web Walker
- Giant Toad (CR 1) [action] Swallow
- Gibbering Mouther (CR 2) [trait] Aberrant Ground
- Gladiator (CR 5) [reaction] Parry
- Goblin Boss (CR 1) [reaction] Redirect Attack
- Gray Ooze (CR 0.5) [trait] Amorphous
- Gray Ooze (CR 0.5) [trait] Corrosive Form
- Green Hag (CR 3) [trait] Coven Magic
- Green Hag (CR 3) [trait] Mimicry
- Half-Dragon (CR 5) [trait] Draconic Origin
- Half-Dragon (CR 5) [bonus action] Leap
- Hobgoblin Captain (CR 3) [trait] Aura of Authority
- Homunculus (CR 0) [trait] Telepathic Bond
- Imp (CR 1) [action] Invisibility
- Imp (CR 1) [action] Shape-Shift
- Incubus (CR 4) [trait] Succubus Form
- Knight (CR 3) [reaction] Parry
- Lamia (CR 4) [bonus action] Leap
- Lemure (CR 0) [trait] Hellish Restoration
- Lion (CR 1) [trait] Running Leap
- Magmin (CR 0.5) [bonus action] Ignited Illumination
- Mimic (CR 2) [trait] Adhesive (Object Form Only)
- Mimic (CR 2) [bonus action] Shape-Shift
- Mule (CR 0.125) [trait] Beast of Burden
- Night Hag (CR 5) [trait] Coven Magic
- Night Hag (CR 5) [bonus action] Shape-Shift
- Night Hag (CR 5) [trait] Soul Bag
- Nightmare (CR 3) [trait] Confer Fire Resistance
- Nightmare (CR 3) [action] Ethereal Stride
- Noble (CR 0.125) [reaction] Parry
- Ochre Jelly (CR 2) [trait] Amorphous
- Ochre Jelly (CR 2) [reaction] Split
- Octopus (CR 0) [trait] Compression
- Phase Spider (CR 3) [bonus action] Ethereal Jaunt
- Phase Spider (CR 3) [trait] Ethereal Sight
- Phase Spider (CR 3) [trait] Web Walker
- Quasit (CR 1) [action] Invisibility
- Quasit (CR 1) [action] Shape-Shift
- Rat (CR 0) [trait] Agile
- Raven (CR 0) [trait] Mimicry
- Roper (CR 5) [action] Reel
- Roper (CR 5) [action] Tentacle
- Rust Monster (CR 0.5) [action] Destroy Metal
- Rust Monster (CR 0.5) [trait] Iron Scent
- Rust Monster (CR 0.5) [reaction] Reflexive Antennae
- Saber-Toothed Tiger (CR 2) [trait] Running Leap
- Sahuagin Warrior (CR 0.5) [bonus action] Aquatic Charge
- Sahuagin Warrior (CR 0.5) [trait] Blood Frenzy
- Sahuagin Warrior (CR 0.5) [trait] Shark Telepathy
- Salamander (CR 5) [trait] Fire Aura
- Sea Hag (CR 2) [trait] Coven Magic
- Sea Hag (CR 2) [action] Illusory Appearance
- Seahorse (CR 0) [action] Bubble Dash
- Shadow (CR 0.5) [trait] Amorphous
- Shambling Mound (CR 5) [trait] Lightning Absorption
- Shrieker Fungus (CR 0) [reaction] Shriek
- Specter (CR 1) [trait] Incorporeal Movement
- Spider (CR 0) [trait] Web Walker
- Sprite (CR 0.25) [action] Invisibility
- Steam Mephit (CR 0.25) [trait] Blurred Form
- Succubus (CR 4) [action] Charm
- Succubus (CR 4) [trait] Incubus Form
- Succubus (CR 4) [bonus action] Shape-Shift
- Swarm of Bats (CR 0.25) [trait] Swarm
- Swarm of Crawling Claws (CR 3) [trait] Swarm
- Swarm of Insects (CR 0.5) [trait] Spider Climb
- Swarm of Insects (CR 0.5) [trait] Swarm
- Swarm of Piranhas (CR 1) [trait] Swarm
- Swarm of Rats (CR 0.25) [trait] Swarm
- Swarm of Ravens (CR 0.25) [trait] Swarm
- Swarm of Venomous Snakes (CR 2) [trait] Swarm
- Troll (CR 5) [bonus action] Charge
- Troll (CR 5) [trait] Regeneration
- Troll Limb (CR 0.5) [trait] Regeneration
- Troll Limb (CR 0.5) [trait] Troll Spawn
- Unicorn (CR 5) [legendary action] Charging Horn
- Unicorn (CR 5) [legendary action] Shimmering Shield
- Vampire Familiar (CR 3) [trait] Vampiric Connection
- Vampire Spawn (CR 5) [trait] Forbiddance
- Vampire Spawn (CR 5) [trait] Running Water
- Vampire Spawn (CR 5) [trait] Stake to the Heart
- Vampire Spawn (CR 5) [trait] Sunlight
- Vampire Spawn (CR 5) [trait] Vampire Weakness
- Warrior Veteran (CR 3) [reaction] Parry
- Water Elemental (CR 5) [trait] Freeze
- Water Elemental (CR 5) [trait] Water Form
- Werebear (CR 5) [bonus action] Shape-Shift
- Wereboar (CR 4) [bonus action] Shape-Shift
- Wererat (CR 2) [bonus action] Shape-Shift
- Weretiger (CR 4) [bonus action] Prowl (Tiger or Hybrid Form Only)
- Weretiger (CR 4) [bonus action] Shape-Shift
- Werewolf (CR 3) [bonus action] Shape-Shift
- White Dragon Wyrmling (CR 2) [trait] Ice Walk
- Will-o'-Wisp (CR 2) [trait] Ephemeral
- Will-o'-Wisp (CR 2) [trait] Incorporeal Movement
- Will-o'-Wisp (CR 2) [bonus action] Vanish
- Wraith (CR 5) [action] Create Specter
- Wraith (CR 5) [trait] Incorporeal Movement
- Xorn (CR 5) [bonus action] Charge
- Xorn (CR 5) [trait] Earth Glide
- Xorn (CR 5) [trait] Treasure Sense
