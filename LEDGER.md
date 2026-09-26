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

**And a fourth, which takes items out of a size rather than out of a**
**column.** A spell that has been read to the end and handed over whole is
finished: every sentence it prints is the table’s or the engine’s, nobody
will ever build it, and counting it in the size of the population the
roadmap ranks by put the road to zero through work nobody may do. So it
leaves the size and is counted in the last column, and §1 lists every one of
them by name — the bestiary’s row already counts a handed-over trait apart
for exactly this reason.

## The five populations

| Ledger | Size | Waits on an engine shape | Waits on a definition | Waits on none | Read to the end, handed over whole |
|---|---|---|---|---|---|
| Spells in reach, not executed | 39 spells | 39 | 0 | 0 | 35 |
| Features manual, or a pool with nothing to buy | 0 features | 0 | 0 | 0 | 0 |
| Items a level 1–5 party can buy | 157 items | 0 | 0 | 157 | 0 |
| Glossary general rules nothing executes | 23 rules | 0 | 0 | 23 | 0 |
| CR ≤ 5 stat-block items handed over or unapplied | 80 items | on 73 of 244 blocks | 0 | 171 blocks already clean | 0 |

## 1. Spells in reach the engine does not resolve

Four states, kept apart because conflating them is how a project believes
it is finished. `executed-partial` is a spell the engine resolves that
still carries a clause nobody has built; `tracked` is one it casts and
hands the effect over; `no-definition` is a spell the catalogue does not
hold at all. An executed spell with nothing left is not here.

**The size above is what this population still owes, and a spell read to**
**the end is not owed.** The last column counts the spells whose every
printed sentence somebody has read and found to be the table’s or the
engine’s: they are finished business by the definition of *waits on none*
above, they will never be built, and while they counted in the size the
road to zero ran through work nobody may do. The bestiary’s row had
already drawn that line for a trait the engine hands to the table, and
this is the same line drawn for a spell. They are **listed** below under a
heading of their own, because a count subtracted with no list behind it is
exactly the silently-missing entry this report’s header refuses.

| Shape | Blocks | Finishes |
|---|---|---|
| `a-fact-only-the-table-can-declare` | 4 | 2 |
| `an-action-a-spell-compels-or-forbids` | 2 | 2 |
| `difficult-terrain-an-area-creates` | 2 | 2 |
| `a-casting-ended-by-a-trigger` | 4 | 1 |
| `a-choice-made-at-the-casting` | 2 | 1 |
| `a-creature-somebody-else-is-playing` | 2 | 1 |
| `a-duration-the-slot-changes` | 2 | 1 |
| `a-stat-block-created-mid-fight` | 2 | 1 |
| `a-target-rule-the-format-cannot-state` | 2 | 1 |
| `an-effect-that-suppresses-other-magic` | 2 | 1 |
| `movement-modes` | 2 | 1 |
| `a-mode-on-the-save-a-spell-forces` | 1 | 1 |
| `a-self-cure-a-spell-forbids` | 1 | 1 |
| `an-action-the-engine-has-no-spender-for` | 1 | 1 |
| `an-object-with-statistics-of-its-own` | 1 | 1 |
| `healing-that-raises-the-dead` | 1 | 1 |
| `a-second-place-to-put-a-creature` | 3 | 0 |
| `a-check-another-creature-may-attempt` | 2 | 0 |
| `a-random-outcome-that-is-not-a-d20` | 2 | 0 |
| `a-rider-on-a-later-weapon-attack` | 2 | 0 |
| `a-spells-effects-applied-to-different-targets` | 2 | 0 |
| `a-standing-effect-derived-from-where-a-creature-stands` | 2 | 0 |
| `an-activation-taken-by-somebody-other-than-the-caster` | 2 | 0 |
| `an-activation-that-resolves-an-area` | 2 | 0 |
| `a-bonus-narrowed-to-a-skill` | 1 | 0 |
| `a-condition-a-spell-suppresses` | 1 | 0 |
| `a-condition-benefit-an-effect-takes-away` | 1 | 0 |
| `a-creature-fact-an-effect-overrides` | 1 | 0 |
| `a-creature-type-predicate-an-area-reads` | 1 | 0 |
| `a-damage-penalty-a-spell-grants` | 1 | 0 |
| `a-distance-a-creature-travels-inside-an-area` | 1 | 0 |
| `a-repeat-save-raised-by-a-trigger` | 1 | 0 |
| `a-repeat-save-that-does-something-on-a-failure` | 1 | 0 |
| `a-selector-for-every-d20-test` | 1 | 0 |
| `an-activation-that-forces-a-saving-throw` | 1 | 0 |
| `an-area-moved-by-the-casters-own-movement` | 1 | 0 |
| `an-area-trigger-measured-from-a-point` | 1 | 0 |
| `an-area-trigger-on-the-casters-turn` | 1 | 0 |
| `senses-beyond-declared-sight` | 1 | 0 |
| `what-a-creature-is-holding` | 1 | 0 |

**Blocks** is every spell of this population the shape touches;
**finishes** is what it is the *only* blocker for — the column a tranche
is planned from. A spell can need more than one shape, so neither column
sums to the population.

#### `a-fact-only-the-table-can-declare` — blocks 4, finishes 2

- **Hunter's Mark** (level 1) — executed-partial
- **Sleep** (level 1) — executed-partial
- **Enthrall** (level 2) — tracked — also waits on 1
- **Call Lightning** (level 3) — tracked — also waits on 1

#### `an-action-a-spell-compels-or-forbids` — blocks 2, finishes 2

- **Haste** (level 3) — executed-partial
- **Slow** (level 3) — executed-partial

#### `difficult-terrain-an-area-creates` — blocks 2, finishes 2

- **Gust of Wind** (level 2) — executed-partial
- **Speak with Plants** (level 3) — tracked

#### `a-casting-ended-by-a-trigger` — blocks 4, finishes 1

- **Unseen Servant** (level 1) — executed-partial — also waits on 1
- **Invisibility** (level 2) — executed-partial
- **Phantasmal Force** (level 2) — no-definition — also waits on 2
- **Warding Bond** (level 2) — tracked — also waits on 1

#### `a-choice-made-at-the-casting` — blocks 2, finishes 1

- **Glyph of Warding** (level 3) — tracked — also waits on 1
- **Plant Growth** (level 3) — executed-partial

#### `a-creature-somebody-else-is-playing` — blocks 2, finishes 1

- **Command** (level 1) — executed-partial
- **Unseen Servant** (level 1) — executed-partial — also waits on 1

#### `a-duration-the-slot-changes` — blocks 2, finishes 1

- **Bestow Curse** (level 3) — executed-partial — also waits on 1
- **Magic Circle** (level 3) — executed-partial

#### `a-stat-block-created-mid-fight` — blocks 2, finishes 1

- **Find Steed** (level 2) — executed-partial
- **Animate Dead** (level 3) — tracked — also waits on 1

#### `a-target-rule-the-format-cannot-state` — blocks 2, finishes 1

- **Thaumaturgy** (level 0) — executed-partial
- **Animate Dead** (level 3) — tracked — also waits on 1

#### `an-effect-that-suppresses-other-magic` — blocks 2, finishes 1

- **Nondetection** (level 3) — tracked
- **Sending** (level 3) — no-definition — also waits on 2

#### `movement-modes` — blocks 2, finishes 1

- **Alter Self** (level 2) — tracked — also waits on 1
- **Levitate** (level 2) — executed-partial

#### `a-mode-on-the-save-a-spell-forces` — blocks 1, finishes 1

- **Protection from Evil and Good** (level 1) — executed-partial

#### `a-self-cure-a-spell-forbids` — blocks 1, finishes 1

- **Hideous Laughter** (level 1) — executed-partial

#### `an-action-the-engine-has-no-spender-for` — blocks 1, finishes 1

- **Gaseous Form** (level 3) — executed-partial

#### `an-object-with-statistics-of-its-own` — blocks 1, finishes 1

- **Silence** (level 2) — executed-partial

#### `healing-that-raises-the-dead` — blocks 1, finishes 1

- **Gentle Repose** (level 2) — executed-partial

#### `a-second-place-to-put-a-creature` — blocks 3, finishes 0

- **Find Familiar** (level 1) — executed-partial — also waits on 2
- **Blink** (level 3) — tracked — also waits on 1
- **Sending** (level 3) — no-definition — also waits on 2

#### `a-check-another-creature-may-attempt` — blocks 2, finishes 0

- **Detect Thoughts** (level 2) — tracked — also waits on 1
- **Spike Growth** (level 2) — executed-partial — also waits on 1

#### `a-random-outcome-that-is-not-a-d20` — blocks 2, finishes 0

- **Blink** (level 3) — tracked — also waits on 1
- **Sending** (level 3) — no-definition — also waits on 2

#### `a-rider-on-a-later-weapon-attack` — blocks 2, finishes 0

- **Alter Self** (level 2) — tracked — also waits on 1
- **Enlarge/Reduce** (level 2) — tracked — also waits on 3

#### `a-spells-effects-applied-to-different-targets` — blocks 2, finishes 0

- **Calm Emotions** (level 2) — tracked — also waits on 1
- **Shining Smite** (level 2) — executed-partial — also waits on 1

#### `a-standing-effect-derived-from-where-a-creature-stands` — blocks 2, finishes 0

- **Warding Bond** (level 2) — tracked — also waits on 1
- **Conjure Animals** (level 3) — tracked — also waits on 1

#### `an-activation-taken-by-somebody-other-than-the-caster` — blocks 2, finishes 0

- **Find Familiar** (level 1) — executed-partial — also waits on 2
- **Dragon's Breath** (level 2) — tracked — also waits on 1

#### `an-activation-that-resolves-an-area` — blocks 2, finishes 0

- **Dragon's Breath** (level 2) — tracked — also waits on 1
- **Call Lightning** (level 3) — tracked — also waits on 1

#### `a-bonus-narrowed-to-a-skill` — blocks 1, finishes 0

- **Enthrall** (level 2) — tracked — also waits on 1

#### `a-condition-a-spell-suppresses` — blocks 1, finishes 0

- **Calm Emotions** (level 2) — tracked — also waits on 1

#### `a-condition-benefit-an-effect-takes-away` — blocks 1, finishes 0

- **Shining Smite** (level 2) — executed-partial — also waits on 1

#### `a-creature-fact-an-effect-overrides` — blocks 1, finishes 0

- **Enlarge/Reduce** (level 2) — tracked — also waits on 3

#### `a-creature-type-predicate-an-area-reads` — blocks 1, finishes 0

- **Glyph of Warding** (level 3) — tracked — also waits on 1

#### `a-damage-penalty-a-spell-grants` — blocks 1, finishes 0

- **Enlarge/Reduce** (level 2) — tracked — also waits on 3

#### `a-distance-a-creature-travels-inside-an-area` — blocks 1, finishes 0

- **Spike Growth** (level 2) — executed-partial — also waits on 1

#### `a-repeat-save-raised-by-a-trigger` — blocks 1, finishes 0

- **Fear** (level 3) — executed-partial — also waits on 1

#### `a-repeat-save-that-does-something-on-a-failure` — blocks 1, finishes 0

- **Bestow Curse** (level 3) — executed-partial — also waits on 1

#### `a-selector-for-every-d20-test` — blocks 1, finishes 0

- **Enlarge/Reduce** (level 2) — tracked — also waits on 3

#### `an-activation-that-forces-a-saving-throw` — blocks 1, finishes 0

- **Detect Thoughts** (level 2) — tracked — also waits on 1

#### `an-area-moved-by-the-casters-own-movement` — blocks 1, finishes 0

- **Conjure Animals** (level 3) — tracked — also waits on 1

#### `an-area-trigger-measured-from-a-point` — blocks 1, finishes 0

- **Phantasmal Force** (level 2) — no-definition — also waits on 2

#### `an-area-trigger-on-the-casters-turn` — blocks 1, finishes 0

- **Phantasmal Force** (level 2) — no-definition — also waits on 2

#### `senses-beyond-declared-sight` — blocks 1, finishes 0

- **Find Familiar** (level 1) — executed-partial — also waits on 2

#### `what-a-creature-is-holding` — blocks 1, finishes 0

- **Fear** (level 3) — executed-partial — also waits on 1

#### Waiting on a definition — 0

Nothing here is blocked. Each is either a paragraph nobody has recorded
reading, or one the existing kinds already say and nobody has written — and
both are work, which is why they are no longer printed as finished business.


#### Read to the end, handed over whole — 35

Somebody read every printed sentence of each of these against the
definition and the blocker map, and every clause left is the table’s to
narrate or the engine’s to roll. **Nothing here is work.** It is out of
the size above and is listed here so a reader can see what the table is
being asked for — which is the whole of what these spells are.

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
- **Knock** (level 2) — tracked
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

Of the 0, 0 are class or subclass features printed at level 5 or below, 0 are species or background traits and 0 are feats.
The snapshot of 2026-09-21 in `docs/dev/roadmap-ledger-2026-09-21.md`
counted the first group only, and did not see the pools; the traits are in
reach of a level 5 character too, which is where the difference in the size
comes from.

| Shape | Blocks | Finishes |
|---|---|---|

**Blocks** is every feature of this population the shape touches;
**finishes** is what it is the *only* blocker for — the column a tranche
is planned from. A feature can need more than one shape, so neither column
sums to the population.

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

244 of the 332 carried stat blocks are CR ≤ 5. They print 738 lines, of which the parser reads 674 and hands over 64. Reading is not spending: a further 13 of the read attack lines carry a printed rider nothing applies, and 3 read trait lines state a mechanic no engine reader asks for. So the population is 80 items over 244 blocks — 171 of which already carry none of them.

**A third answer, counted apart from both:** 77 of the read trait lines are sentences the engine reads and **hands to the table**, and will never execute — the breathing traits, the telepathies, the other planes, the substances this world holds none of, and the GM's own choices: sentences that say what a creature is and name nothing any rule consults. What is **not** among them is the other half of the residue below, where a sentence states a mechanic the engine has no seam for — an Amorphous squeezing through an inch, a Web Walker ignoring a web — because calling one of those fiction would retire a debt by renaming it. They are neither spent nor waiting, so they are not among the 80 above and do not keep a block off the clean list. `HANDOVER_TRAIT_KINDS` holds the reason per kind, and `coverage.test.ts` pins that none of them has a reader after all.

**A block is the unit that matters and a line is the unit that is counted.**
A block with four unapplied lines is one fight that does not run, not four,
so the split above is per block while the size is per line. The piles below
overlap: one sentence can force a save and recharge.

| Shape | Lines | Blocks | Three example blocks |
|---|---|---|---|
| A hit whose line says more than the engine applies | 23 | 23 | Animated Rug of Smothering (CR 2) / Smother; Barbed Devil (CR 5) / Hurl Flame; Bearded Devil (CR 3) / Infernal Glaive |
| An effect a hit buys | 13 | 13 | Barbed Devil (CR 5) / Hurl Flame; Bearded Devil (CR 3) / Infernal Glaive; Death Dog (CR 1) / Bite |
| A save a line forces | 9 | 9 | Bulette (CR 5) / Deadly Leap; Centaur Trooper (CR 2) / Trampling Charge (Recharge 5–6); Gelatinous Cube (CR 2) / Engulf |
| A use the block limits per day | 9 | 8 | Darkmantle (CR 0.5) / Darkness Aura (1/Day); Gnoll Warrior (CR 0.5) / Rampage (1/Day); Night Hag (CR 5) / Nightmare Haunting (1/Day; Requires Soul Bag) |
| A trait whose heading says more than the engine spends | 7 | 7 | Swarm of Crawling Claws (CR 3) / Swarm; Swarm of Bats (CR 0.25) / Swarm; Swarm of Insects (CR 0.5) / Swarm |
| A save whose line says more than the engine spends | 5 | 5 | Basilisk (CR 3) / Petrifying Gaze (Recharge 4–6); Gibbering Mouther (CR 2) / Gibbering; Steam Mephit (CR 0.25) / Steam Breath (Recharge 6) |
| A trait shape nothing spends | 3 | 3 | Black Pudding (CR 4) / Split; Goblin Boss (CR 1) / Redirect Attack; Ochre Jelly (CR 2) / Split |
| A recharge | 2 | 2 | Centaur Trooper (CR 2) / Trampling Charge (Recharge 5–6); Ghost (CR 4) / Possession (Recharge 6) |
| A legendary action’s own economy | 2 | 1 | Unicorn (CR 5) / Charging Horn |
| A Reaction whose printed response is handed over | 1 | 1 | Rust Monster (CR 0.5) / Reflexive Antennae |
| How many attacks the Attack action holds | 1 | 1 | Roper (CR 5) / Multiattack |
| A creature that casts | 0 | 0 | — |

**Two of those rows are an effect nobody applies and an economy that is
already correct.** A recharge and a per-day limit are parsed onto every
line, carried onto the sheet, asked at the turn boundary and spent by
`takeStatedAction`; what is unapplied on such a line is what it *does*.
A brief quoting those rows should say so.

### Handed-over lines matching no enumerated shape — 45

A debt nobody has given an id to is still a debt, so these are named here
rather than dropped. They carry no parsed structure at all, which is why no
predicate reaches them and why classifying them is a reading of English
rather than a derivation — the roadmap keeps that reading in prose, and the
ledger keeps the list.

A legendary action is in both this list and the economy row above, because
they are two debts: that nothing spends a legendary action, and that
nothing applies what the line says. Leaving it out of one would take half
of it off the ledger.

- Black Pudding (CR 4) [trait] Corrosive Form
- Bugbear Stalker (CR 3) [trait] Abduct
- Bugbear Warrior (CR 1) [trait] Abduct
- Bulette (CR 5) [bonus action] Leap
- Cat (CR 0) [trait] Jumper
- Dryad (CR 1) [bonus action] Tree Stride
- Ettercap (CR 2) [bonus action] Reel
- Fire Elemental (CR 5) [trait] Fire Aura
- Flesh Golem (CR 5) [trait] Berserk
- Gelatinous Cube (CR 2) [trait] Ooze Cube
- Ghost (CR 4) [action] Etherealness
- Giant Boar (CR 2) [trait] Bloodied Fury
- Giant Frog (CR 0.25) [action] Swallow
- Giant Seahorse (CR 0.5) [bonus action] Bubble Dash
- Giant Toad (CR 1) [action] Swallow
- Gray Ooze (CR 0.5) [trait] Corrosive Form
- Green Hag (CR 3) [trait] Coven Magic
- Half-Dragon (CR 5) [bonus action] Leap
- Incubus (CR 4) [trait] Succubus Form
- Lamia (CR 4) [bonus action] Leap
- Magmin (CR 0.5) [bonus action] Ignited Illumination
- Night Hag (CR 5) [trait] Coven Magic
- Night Hag (CR 5) [trait] Soul Bag
- Nightmare (CR 3) [action] Ethereal Stride
- Phase Spider (CR 3) [bonus action] Ethereal Jaunt
- Roper (CR 5) [action] Tentacle
- Rust Monster (CR 0.5) [action] Destroy Metal
- Sahuagin Warrior (CR 0.5) [bonus action] Aquatic Charge
- Sea Hag (CR 2) [trait] Coven Magic
- Sea Hag (CR 2) [action] Illusory Appearance
- Seahorse (CR 0) [action] Bubble Dash
- Succubus (CR 4) [action] Charm
- Succubus (CR 4) [trait] Incubus Form
- Swarm of Insects (CR 0.5) [trait] Spider Climb
- Troll (CR 5) [bonus action] Charge
- Troll (CR 5) [trait] Regeneration
- Troll Limb (CR 0.5) [trait] Regeneration
- Troll Limb (CR 0.5) [trait] Troll Spawn
- Unicorn (CR 5) [legendary action] Charging Horn
- Unicorn (CR 5) [legendary action] Shimmering Shield
- Vampire Spawn (CR 5) [trait] Sunlight
- Weretiger (CR 4) [bonus action] Prowl (Tiger or Hybrid Form Only)
- Will-o'-Wisp (CR 2) [bonus action] Vanish
- Wraith (CR 5) [action] Create Specter
- Xorn (CR 5) [bonus action] Charge
