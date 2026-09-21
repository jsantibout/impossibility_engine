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

## The three populations

| Ledger | Size | Waits on an engine shape | Waits on none |
|---|---|---|---|
| Spells in reach, not executed | 141 spells | 89 | 52 |
| Features manual, or a pool with nothing to buy | 55 features | 49 | 6 |
| CR ≤ 5 stat-block items handed over or unapplied | 434 items | on 198 of 242 blocks | 44 blocks already clean |

## 1. Spells in reach the engine does not resolve

Four states, kept apart because conflating them is how a project believes
it is finished. `executed-partial` is a spell the engine resolves that
still carries a clause nobody has built; `tracked` is one it casts and
hands the effect over; `no-definition` is a spell the catalogue does not
hold at all. An executed spell with nothing left is not here.

| Shape | Blocks | Finishes |
|---|---|---|
| `a-choice-made-at-the-casting` | 8 | 5 |
| `an-action-a-spell-compels-or-forbids` | 7 | 3 |
| `a-condition-benefit-an-effect-takes-away` | 4 | 3 |
| `a-rider-on-a-later-weapon-attack` | 6 | 2 |
| `a-random-outcome-that-is-not-a-d20` | 5 | 2 |
| `a-standing-effect-derived-from-where-a-creature-stands` | 5 | 2 |
| `difficult-terrain-an-area-creates` | 5 | 2 |
| `a-stat-block-created-mid-fight` | 4 | 2 |
| `movement-modes` | 4 | 2 |
| `what-a-creature-is-holding` | 4 | 2 |
| `forced-movement-a-spell-causes` | 3 | 2 |
| `senses-beyond-declared-sight` | 3 | 2 |
| `several-attack-rolls-from-one-casting` | 3 | 2 |
| `healing-modified-by-an-effect` | 2 | 2 |
| `a-casting-ended-by-a-trigger` | 6 | 1 |
| `a-repeat-save-that-does-something-on-a-failure` | 4 | 1 |
| `damage-with-neither-an-attack-roll-nor-a-save` | 3 | 1 |
| `a-target-rule-the-format-cannot-state` | 2 | 1 |
| `an-area-trigger-measured-from-a-point` | 2 | 1 |
| `a-hit-point-maximum-a-spell-moves` | 1 | 1 |
| `a-reduction-an-effect-applies-to-damage` | 1 | 1 |
| `a-save-keyed-to-a-condition` | 1 | 1 |
| `a-second-roll-sequenced-after-the-first` | 1 | 1 |
| `a-spell-that-answers-a-later-attack` | 1 | 1 |
| `a-wall-or-several-templates-in-one-area` | 1 | 1 |
| `a-world-fact-nothing-can-represent` | 1 | 1 |
| `an-armor-class-a-spell-floors` | 1 | 1 |
| `an-outcome-that-breaks-concentration` | 1 | 1 |
| `falling` | 1 | 1 |
| `healing-that-raises-the-dead` | 1 | 1 |
| `jumping` | 1 | 1 |
| `targeting-rules-that-differ-within-one-casting` | 1 | 1 |
| `a-check-another-creature-may-attempt` | 3 | 0 |
| `a-fact-only-the-table-can-declare` | 3 | 0 |
| `a-spells-effects-applied-to-different-targets` | 3 | 0 |
| `a-bonus-narrowed-to-a-skill` | 2 | 0 |
| `a-condition-that-ends-when-its-holder-leaves-an-area` | 2 | 0 |
| `a-damage-penalty-a-spell-grants` | 2 | 0 |
| `a-filter-on-the-attackers-creature-type` | 2 | 0 |
| `a-repeat-save-raised-by-a-trigger` | 2 | 0 |
| `a-second-place-to-put-a-creature` | 2 | 0 |
| `an-activation-taken-by-somebody-other-than-the-caster` | 2 | 0 |
| `an-activation-that-resolves-an-area` | 2 | 0 |
| `an-area-that-filters-its-catch` | 2 | 0 |
| `an-effect-that-suppresses-other-magic` | 2 | 0 |
| `an-outcome-that-reads-the-targets-hit-points` | 2 | 0 |
| `a-barrier-that-blocks-passage` | 1 | 0 |
| `a-casting-dismissed-early` | 1 | 0 |
| `a-condition-a-spell-suppresses` | 1 | 0 |
| `a-condition-immunity-narrowed-to-its-source` | 1 | 0 |
| `a-creature-fact-an-effect-overrides` | 1 | 0 |
| `a-creature-type-predicate-an-area-reads` | 1 | 0 |
| `a-die-behaviour-a-spell-asks-for` | 1 | 0 |
| `a-distance-a-creature-travels-inside-an-area` | 1 | 0 |
| `a-mode-on-the-save-a-spell-forces` | 1 | 0 |
| `a-range-that-scales-with-caster-level` | 1 | 0 |
| `a-save-whose-failure-imposes-no-condition` | 1 | 0 |
| `a-selector-for-every-d20-test` | 1 | 0 |
| `a-speed-an-effect-multiplies` | 1 | 0 |
| `a-success-branch-that-does-something` | 1 | 0 |
| `an-activation-that-forces-a-saving-throw` | 1 | 0 |
| `an-area-moved-by-the-casters-own-movement` | 1 | 0 |
| `an-area-trigger-on-the-casters-turn` | 1 | 0 |
| `an-effect-that-fires-when-the-casting-ends` | 1 | 0 |
| `an-effect-that-stabilises-a-dying-creature` | 1 | 0 |
| `an-outcome-that-reads-the-targets-defences` | 1 | 0 |
| `the-effects-source-as-a-participant` | 1 | 0 |

**Blocks** is every spell of this population the shape touches;
**finishes** is what it is the *only* blocker for — the column a tranche
is planned from. A spell can need more than one shape, so neither column
sums to the population.

#### `a-choice-made-at-the-casting` — blocks 8, finishes 5

- **Guidance** (level 0) — executed-partial
- **Thaumaturgy** (level 0) — tracked
- **Hex** (level 1) — tracked — also waits on 2
- **Blindness/Deafness** (level 2) — executed-partial
- **Enhance Ability** (level 2) — tracked
- **Enlarge/Reduce** (level 2) — tracked — also waits on 3
- **Lesser Restoration** (level 2) — executed-partial
- **Glyph of Warding** (level 3) — tracked — also waits on 1

#### `an-action-a-spell-compels-or-forbids` — blocks 7, finishes 3

- **Shocking Grasp** (level 0) — executed-partial
- **Command** (level 1) — tracked
- **Dissonant Whispers** (level 1) — executed-partial
- **Hideous Laughter** (level 1) — executed-partial — also waits on 1
- **Gaseous Form** (level 3) — executed-partial — also waits on 3
- **Haste** (level 3) — executed-partial — also waits on 2
- **Slow** (level 3) — no-definition — also waits on 3

#### `a-condition-benefit-an-effect-takes-away` — blocks 4, finishes 3

- **Starry Wisp** (level 0) — executed-partial
- **Faerie Fire** (level 1) — tracked
- **Mind Spike** (level 2) — executed-partial
- **Shining Smite** (level 2) — executed-partial — also waits on 1

#### `a-rider-on-a-later-weapon-attack` — blocks 6, finishes 2

- **Shillelagh** (level 0) — tracked
- **True Strike** (level 0) — tracked
- **Hex** (level 1) — tracked — also waits on 2
- **Alter Self** (level 2) — tracked — also waits on 1
- **Enlarge/Reduce** (level 2) — tracked — also waits on 3
- **Bestow Curse** (level 3) — tracked — also waits on 2

#### `a-random-outcome-that-is-not-a-d20` — blocks 5, finishes 2

- **Augury** (level 2) — tracked
- **Gust of Wind** (level 2) — tracked — also waits on 2
- **Blink** (level 3) — tracked
- **Sending** (level 3) — no-definition — also waits on 2
- **Slow** (level 3) — no-definition — also waits on 3

#### `a-standing-effect-derived-from-where-a-creature-stands` — blocks 5, finishes 2

- **Silence** (level 2) — tracked — also waits on 1
- **Warding Bond** (level 2) — tracked — also waits on 1
- **Zone of Truth** (level 2) — tracked
- **Conjure Animals** (level 3) — tracked — also waits on 1
- **Spirit Guardians** (level 3) — executed-partial

#### `difficult-terrain-an-area-creates` — blocks 5, finishes 2

- **Entangle** (level 1) — no-definition — also waits on 1
- **Grease** (level 1) — executed-partial
- **Gust of Wind** (level 2) — tracked — also waits on 2
- **Web** (level 2) — executed-partial — also waits on 1
- **Plant Growth** (level 3) — tracked

#### `a-stat-block-created-mid-fight` — blocks 4, finishes 2

- **Find Familiar** (level 1) — no-definition — also waits on 3
- **Unseen Servant** (level 1) — tracked — also waits on 1
- **Find Steed** (level 2) — tracked
- **Phantom Steed** (level 3) — tracked

#### `movement-modes` — blocks 4, finishes 2

- **Alter Self** (level 2) — tracked — also waits on 1
- **Spider Climb** (level 2) — tracked
- **Fly** (level 3) — tracked
- **Gaseous Form** (level 3) — executed-partial — also waits on 3

#### `what-a-creature-is-holding` — blocks 4, finishes 2

- **Goodberry** (level 1) — tracked
- **Flame Blade** (level 2) — executed-partial
- **Heat Metal** (level 2) — tracked — also waits on 1
- **Fear** (level 3) — executed-partial — also waits on 1

#### `forced-movement-a-spell-causes` — blocks 3, finishes 2

- **Thunderwave** (level 1) — executed-partial
- **Gust of Wind** (level 2) — tracked — also waits on 2
- **Levitate** (level 2) — tracked

#### `senses-beyond-declared-sight` — blocks 3, finishes 2

- **Find Familiar** (level 1) — no-definition — also waits on 3
- **Blur** (level 2) — executed-partial
- **Mirror Image** (level 2) — tracked

#### `several-attack-rolls-from-one-casting` — blocks 3, finishes 2

- **Eldritch Blast** (level 0) — executed-partial
- **Chromatic Orb** (level 1) — executed-partial — also waits on 1
- **Scorching Ray** (level 2) — tracked

#### `healing-modified-by-an-effect` — blocks 2, finishes 2

- **Chill Touch** (level 0) — executed-partial
- **Beacon of Hope** (level 3) — executed-partial

#### `a-casting-ended-by-a-trigger` — blocks 6, finishes 1

- **Unseen Servant** (level 1) — tracked — also waits on 1
- **Invisibility** (level 2) — executed-partial
- **Phantasmal Force** (level 2) — no-definition — also waits on 2
- **Warding Bond** (level 2) — tracked — also waits on 1
- **Gaseous Form** (level 3) — executed-partial — also waits on 3
- **Hypnotic Pattern** (level 3) — executed-partial — also waits on 1

#### `a-repeat-save-that-does-something-on-a-failure` — blocks 4, finishes 1

- **Ensnaring Strike** (level 1) — tracked — also waits on 2
- **Searing Smite** (level 1) — executed-partial
- **Sleep** (level 1) — tracked — also waits on 1
- **Bestow Curse** (level 3) — tracked — also waits on 2

#### `damage-with-neither-an-attack-roll-nor-a-save` — blocks 3, finishes 1

- **Magic Missile** (level 1) — no-definition — also waits on 1
- **Shield** (level 1) — executed-partial
- **Heat Metal** (level 2) — tracked — also waits on 1

#### `a-target-rule-the-format-cannot-state` — blocks 2, finishes 1

- **Ensnaring Strike** (level 1) — tracked — also waits on 2
- **Animal Messenger** (level 2) — tracked

#### `an-area-trigger-measured-from-a-point` — blocks 2, finishes 1

- **Flaming Sphere** (level 2) — tracked
- **Phantasmal Force** (level 2) — no-definition — also waits on 2

#### `a-hit-point-maximum-a-spell-moves` — blocks 1, finishes 1

- **Aid** (level 2) — tracked

#### `a-reduction-an-effect-applies-to-damage` — blocks 1, finishes 1

- **Resistance** (level 0) — tracked

#### `a-save-keyed-to-a-condition` — blocks 1, finishes 1

- **Protection from Poison** (level 2) — executed-partial

#### `a-second-roll-sequenced-after-the-first` — blocks 1, finishes 1

- **Ice Knife** (level 1) — tracked

#### `a-spell-that-answers-a-later-attack` — blocks 1, finishes 1

- **Sanctuary** (level 1) — tracked

#### `a-wall-or-several-templates-in-one-area` — blocks 1, finishes 1

- **Wind Wall** (level 3) — tracked

#### `a-world-fact-nothing-can-represent` — blocks 1, finishes 1

- **Meld into Stone** (level 3) — tracked

#### `an-armor-class-a-spell-floors` — blocks 1, finishes 1

- **Barkskin** (level 2) — tracked

#### `an-outcome-that-breaks-concentration` — blocks 1, finishes 1

- **Sleet Storm** (level 3) — tracked

#### `falling` — blocks 1, finishes 1

- **Feather Fall** (level 1) — tracked

#### `healing-that-raises-the-dead` — blocks 1, finishes 1

- **Revivify** (level 3) — tracked

#### `jumping` — blocks 1, finishes 1

- **Jump** (level 1) — tracked

#### `targeting-rules-that-differ-within-one-casting` — blocks 1, finishes 1

- **Vampiric Touch** (level 3) — executed-partial

#### `a-check-another-creature-may-attempt` — blocks 3, finishes 0

- **Ensnaring Strike** (level 1) — tracked — also waits on 2
- **Detect Thoughts** (level 2) — tracked — also waits on 1
- **Spike Growth** (level 2) — tracked — also waits on 1

#### `a-fact-only-the-table-can-declare` — blocks 3, finishes 0

- **Hunter's Mark** (level 1) — executed-partial — also waits on 1
- **Enthrall** (level 2) — tracked — also waits on 1
- **Call Lightning** (level 3) — tracked — also waits on 1

#### `a-spells-effects-applied-to-different-targets` — blocks 3, finishes 0

- **Magic Missile** (level 1) — no-definition — also waits on 1
- **Calm Emotions** (level 2) — tracked — also waits on 1
- **Shining Smite** (level 2) — executed-partial — also waits on 1

#### `a-bonus-narrowed-to-a-skill` — blocks 2, finishes 0

- **Enthrall** (level 2) — tracked — also waits on 1
- **Slow** (level 3) — no-definition — also waits on 3

#### `a-condition-that-ends-when-its-holder-leaves-an-area` — blocks 2, finishes 0

- **Silence** (level 2) — tracked — also waits on 1
- **Web** (level 2) — executed-partial — also waits on 1

#### `a-damage-penalty-a-spell-grants` — blocks 2, finishes 0

- **Enlarge/Reduce** (level 2) — tracked — also waits on 3
- **Ray of Enfeeblement** (level 2) — tracked — also waits on 2

#### `a-filter-on-the-attackers-creature-type` — blocks 2, finishes 0

- **Protection from Evil and Good** (level 1) — tracked — also waits on 1
- **Magic Circle** (level 3) — tracked — also waits on 3

#### `a-repeat-save-raised-by-a-trigger` — blocks 2, finishes 0

- **Hideous Laughter** (level 1) — executed-partial — also waits on 1
- **Fear** (level 3) — executed-partial — also waits on 1

#### `a-second-place-to-put-a-creature` — blocks 2, finishes 0

- **Find Familiar** (level 1) — no-definition — also waits on 3
- **Sending** (level 3) — no-definition — also waits on 2

#### `an-activation-taken-by-somebody-other-than-the-caster` — blocks 2, finishes 0

- **Find Familiar** (level 1) — no-definition — also waits on 3
- **Dragon's Breath** (level 2) — tracked — also waits on 1

#### `an-activation-that-resolves-an-area` — blocks 2, finishes 0

- **Dragon's Breath** (level 2) — tracked — also waits on 1
- **Call Lightning** (level 3) — tracked — also waits on 1

#### `an-area-that-filters-its-catch` — blocks 2, finishes 0

- **Entangle** (level 1) — no-definition — also waits on 1
- **Hypnotic Pattern** (level 3) — executed-partial — also waits on 1

#### `an-effect-that-suppresses-other-magic` — blocks 2, finishes 0

- **Magic Circle** (level 3) — tracked — also waits on 3
- **Sending** (level 3) — no-definition — also waits on 2

#### `an-outcome-that-reads-the-targets-hit-points` — blocks 2, finishes 0

- **Hex** (level 1) — tracked — also waits on 2
- **Hunter's Mark** (level 1) — executed-partial — also waits on 1

#### `a-barrier-that-blocks-passage` — blocks 1, finishes 0

- **Magic Circle** (level 3) — tracked — also waits on 3

#### `a-casting-dismissed-early` — blocks 1, finishes 0

- **Gaseous Form** (level 3) — executed-partial — also waits on 3

#### `a-condition-a-spell-suppresses` — blocks 1, finishes 0

- **Calm Emotions** (level 2) — tracked — also waits on 1

#### `a-condition-immunity-narrowed-to-its-source` — blocks 1, finishes 0

- **Magic Circle** (level 3) — tracked — also waits on 3

#### `a-creature-fact-an-effect-overrides` — blocks 1, finishes 0

- **Enlarge/Reduce** (level 2) — tracked — also waits on 3

#### `a-creature-type-predicate-an-area-reads` — blocks 1, finishes 0

- **Glyph of Warding** (level 3) — tracked — also waits on 1

#### `a-die-behaviour-a-spell-asks-for` — blocks 1, finishes 0

- **Chromatic Orb** (level 1) — executed-partial — also waits on 1

#### `a-distance-a-creature-travels-inside-an-area` — blocks 1, finishes 0

- **Spike Growth** (level 2) — tracked — also waits on 1

#### `a-mode-on-the-save-a-spell-forces` — blocks 1, finishes 0

- **Protection from Evil and Good** (level 1) — tracked — also waits on 1

#### `a-range-that-scales-with-caster-level` — blocks 1, finishes 0

- **Spare the Dying** (level 0) — tracked — also waits on 1

#### `a-save-whose-failure-imposes-no-condition` — blocks 1, finishes 0

- **Slow** (level 3) — no-definition — also waits on 3

#### `a-selector-for-every-d20-test` — blocks 1, finishes 0

- **Ray of Enfeeblement** (level 2) — tracked — also waits on 2

#### `a-speed-an-effect-multiplies` — blocks 1, finishes 0

- **Haste** (level 3) — executed-partial — also waits on 2

#### `a-success-branch-that-does-something` — blocks 1, finishes 0

- **Ray of Enfeeblement** (level 2) — tracked — also waits on 2

#### `an-activation-that-forces-a-saving-throw` — blocks 1, finishes 0

- **Detect Thoughts** (level 2) — tracked — also waits on 1

#### `an-area-moved-by-the-casters-own-movement` — blocks 1, finishes 0

- **Conjure Animals** (level 3) — tracked — also waits on 1

#### `an-area-trigger-on-the-casters-turn` — blocks 1, finishes 0

- **Phantasmal Force** (level 2) — no-definition — also waits on 2

#### `an-effect-that-fires-when-the-casting-ends` — blocks 1, finishes 0

- **Haste** (level 3) — executed-partial — also waits on 2

#### `an-effect-that-stabilises-a-dying-creature` — blocks 1, finishes 0

- **Spare the Dying** (level 0) — tracked — also waits on 1

#### `an-outcome-that-reads-the-targets-defences` — blocks 1, finishes 0

- **Sleep** (level 1) — tracked — also waits on 1

#### `the-effects-source-as-a-participant` — blocks 1, finishes 0

- **Bestow Curse** (level 3) — tracked — also waits on 2

#### Waiting on no shape — 52

- **Dancing Lights** (level 0) — tracked
- **Druidcraft** (level 0) — tracked
- **Elementalism** (level 0) — tracked
- **Light** (level 0) — tracked
- **Mage Hand** (level 0) — tracked
- **Mending** (level 0) — tracked
- **Message** (level 0) — tracked
- **Minor Illusion** (level 0) — tracked
- **Prestidigitation** (level 0) — tracked
- **Alarm** (level 1) — tracked
- **Comprehend Languages** (level 1) — tracked
- **Create or Destroy Water** (level 1) — tracked
- **Detect Evil and Good** (level 1) — tracked
- **Detect Magic** (level 1) — tracked
- **Detect Poison and Disease** (level 1) — tracked
- **Disguise Self** (level 1) — tracked
- **Expeditious Retreat** (level 1) — tracked
- **Floating Disk** (level 1) — tracked
- **Fog Cloud** (level 1) — tracked
- **Identify** (level 1) — tracked
- **Illusory Script** (level 1) — tracked
- **Purify Food and Drink** (level 1) — tracked
- **Silent Image** (level 1) — tracked
- **Speak with Animals** (level 1) — tracked
- **Arcane Lock** (level 2) — tracked
- **Arcanist's Magic Aura** (level 2) — tracked
- **Continual Flame** (level 2) — tracked
- **Darkness** (level 2) — no-definition
- **Darkvision** (level 2) — tracked
- **Find Traps** (level 2) — tracked
- **Gentle Repose** (level 2) — tracked
- **Knock** (level 2) — tracked
- **Locate Animals or Plants** (level 2) — tracked
- **Locate Object** (level 2) — tracked
- **Magic Mouth** (level 2) — tracked
- **Magic Weapon** (level 2) — tracked
- **Pass without Trace** (level 2) — tracked
- **Rope Trick** (level 2) — tracked
- **See Invisibility** (level 2) — tracked
- **Animate Dead** (level 3) — tracked
- **Clairvoyance** (level 3) — tracked
- **Create Food and Water** (level 3) — tracked
- **Daylight** (level 3) — tracked
- **Major Image** (level 3) — tracked
- **Nondetection** (level 3) — tracked
- **Remove Curse** (level 3) — tracked
- **Speak with Dead** (level 3) — tracked
- **Speak with Plants** (level 3) — tracked
- **Tiny Hut** (level 3) — tracked
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

Of the 55, 32 are class or subclass features printed at level 5 or below and 23 are species or background traits.
The snapshot of 2026-09-21 in `docs/dev/roadmap-ledger-2026-09-21.md`
counted the first group only, and did not see the pools; the traits are in
reach of a level 5 character too, which is where the difference in the size
comes from.

| Shape | Blocks | Finishes |
|---|---|---|
| `a-resource-traded-for-another` | 4 | 3 |
| `a-save-keyed-to-a-condition` | 4 | 3 |
| `a-feature-that-changes-what-a-casting-costs` | 4 | 2 |
| `a-rule-the-engine-fixes-for-everybody` | 4 | 2 |
| `a-spell-a-source-that-does-not-cast-grants` | 4 | 2 |
| `a-hit-point-maximum-a-spell-moves` | 2 | 2 |
| `an-option-re-chosen-on-a-rest` | 2 | 2 |
| `a-grant-gated-on-one-option-of-a-choice` | 4 | 1 |
| `a-move-a-feature-hands-its-holder` | 3 | 1 |
| `a-die-behaviour-a-spell-asks-for` | 2 | 1 |
| `a-bonus-an-ability-modifier-sizes` | 1 | 1 |
| `a-bonus-narrowed-to-a-skill` | 1 | 1 |
| `a-declared-fact-a-feature-sets` | 1 | 1 |
| `a-feature-that-rewrites-another-features-rule` | 1 | 1 |
| `a-roll-result-an-effect-replaces` | 1 | 1 |
| `an-action-the-engine-has-no-spender-for` | 1 | 1 |
| `an-effect-that-intercepts-dropping-to-0` | 1 | 1 |
| `falling` | 1 | 1 |
| `heroic-inspiration` | 1 | 1 |
| `a-benefit-that-runs-for-a-printed-span` | 5 | 0 |
| `a-pool-the-proficiency-bonus-sizes` | 5 | 0 |
| `a-casting-paid-for-out-of-a-feature-pool` | 2 | 0 |
| `a-feature-that-carries-a-second-grant` | 2 | 0 |
| `a-language-or-a-proficiency-an-item-grants` | 2 | 0 |
| `a-world-fact-nothing-can-represent` | 2 | 0 |
| `an-attack-the-class-redefines` | 2 | 0 |
| `movement-modes` | 2 | 0 |
| `temporary-hit-points-a-feature-grants` | 2 | 0 |
| `a-bonus-to-spell-attack-rolls` | 1 | 0 |
| `a-creature-fact-an-effect-overrides` | 1 | 0 |
| `a-creature-swapped-for-another-stat-block` | 1 | 0 |
| `a-dc-a-feature-derives-from-its-own-abilities` | 1 | 0 |
| `a-feature-that-changes-who-a-casting-catches` | 1 | 0 |
| `a-mode-on-the-save-a-spell-forces` | 1 | 0 |
| `a-reaction-effect-the-vocabulary-lacks` | 1 | 0 |
| `a-speed-a-feature-reduces` | 1 | 0 |
| `a-stat-block-created-mid-fight` | 1 | 0 |
| `an-action-a-spell-compels-or-forbids` | 1 | 0 |
| `an-area-an-item-creates` | 1 | 0 |
| `an-outcome-of-a-spells-own-damage` | 1 | 0 |
| `forced-movement-a-spell-causes` | 1 | 0 |
| `jumping` | 1 | 0 |

**Blocks** is every feature of this population the shape touches;
**finishes** is what it is the *only* blocker for — the column a tranche
is planned from. A feature can need more than one shape, so neither column
sums to the population.

#### `a-resource-traded-for-another` — blocks 4, finishes 3

- `wizard:arcane-recovery` — Arcane Recovery (level 1, class, engine)
- `monk:focus` — Monk's Focus (level 2, class, engine)
- `sorcerer:font-of-magic` — Font of Magic (level 2, class, engine)
- `rogue:cunning-strike` — Cunning Strike (level 5, class, manual) — also waits on 1

#### `a-save-keyed-to-a-condition` — blocks 4, finishes 3

- `dwarf:dwarven-resilience` — Dwarven Resilience (level 1, species, manual)
- `elf:fey-ancestry` — Fey Ancestry (level 1, species, manual)
- `goliath:powerful-build` — Powerful Build (level 1, species, manual) — also waits on 1
- `halfling:brave` — Brave (level 1, species, manual)

#### `a-feature-that-changes-what-a-casting-costs` — blocks 4, finishes 2

- `warlock:eldritch-invocations` — Eldritch Invocations (level 1, class, manual)
- `wizard:ritual-adept` — Ritual Adept (level 1, class, manual)
- `paladin:smite` — Paladin's Smite (level 2, class, manual) — also waits on 1
- `sorcerer:metamagic` — Metamagic (level 2, class, manual) — also waits on 3

#### `a-rule-the-engine-fixes-for-everybody` — blocks 4, finishes 2

- `elf:trance` — Trance (level 1, species, manual) — also waits on 1
- `goliath:powerful-build` — Powerful Build (level 1, species, manual) — also waits on 1
- `halfling:halfling-nimbleness` — Halfling Nimbleness (level 1, species, manual)
- `halfling:naturally-stealthy` — Naturally Stealthy (level 1, species, manual)

#### `a-spell-a-source-that-does-not-cast-grants` — blocks 4, finishes 2

- `elf:elven-lineage` — Elven Lineage (level 1, species, manual) — also waits on 1
- `gnome:gnomish-lineage` — Gnomish Lineage (level 1, species, manual) — also waits on 1
- `tiefling:fiendish-legacy` — Fiendish Legacy (level 1, species, manual)
- `tiefling:otherworldly-presence` — Otherworldly Presence (level 1, species, manual)

#### `a-hit-point-maximum-a-spell-moves` — blocks 2, finishes 2

- `dwarf:dwarven-toughness` — Dwarven Toughness (level 1, species, manual)
- `draconic-sorcery:draconic-resilience` — Draconic Resilience (level 3, subclass, manual)

#### `an-option-re-chosen-on-a-rest` — blocks 2, finishes 2

- `circle-of-the-land:spells` — Circle of the Land Spells (level 3, subclass, manual)
- `wizard:memorize-spell` — Memorize Spell (level 5, class, manual)

#### `a-grant-gated-on-one-option-of-a-choice` — blocks 4, finishes 1

- `cleric:divine-order` — Divine Order (level 1, class, manual) — also waits on 1
- `dragonborn:draconic-ancestry` — Draconic Ancestry (level 1, species, manual)
- `druid:primal-order` — Primal Order (level 1, class, manual) — also waits on 1
- `goliath:giant-ancestry` — Giant Ancestry (level 1, species, manual) — also waits on 4

#### `a-move-a-feature-hands-its-holder` — blocks 3, finishes 1

- `goliath:giant-ancestry` — Giant Ancestry (level 1, species, manual) — also waits on 4
- `fighter:tactical-shift` — Tactical Shift (level 5, class, manual)
- `rogue:cunning-strike` — Cunning Strike (level 5, class, manual) — also waits on 1

#### `a-die-behaviour-a-spell-asks-for` — blocks 2, finishes 1

- `soldier:savage-attacker` — Savage Attacker (level 1, background, manual)
- `sorcerer:metamagic` — Metamagic (level 2, class, manual) — also waits on 3

#### `a-bonus-an-ability-modifier-sizes` — blocks 1, finishes 1

- `oath-of-devotion:sacred-weapon` — Sacred Weapon (level 3, subclass, manual)

#### `a-bonus-narrowed-to-a-skill` — blocks 1, finishes 1

- `bard:jack-of-all-trades` — Jack of All Trades (level 2, class, manual)

#### `a-declared-fact-a-feature-sets` — blocks 1, finishes 1

- `paladin:channel-divinity` — Channel Divinity (level 3, class, engine)

#### `a-feature-that-rewrites-another-features-rule` — blocks 1, finishes 1

- `cleric:sear-undead` — Sear Undead (level 5, class, manual)

#### `a-roll-result-an-effect-replaces` — blocks 1, finishes 1

- `halfling:luck` — Luck (level 1, species, manual)

#### `an-action-the-engine-has-no-spender-for` — blocks 1, finishes 1

- `thief:fast-hands` — Fast Hands (level 3, subclass, manual)

#### `an-effect-that-intercepts-dropping-to-0` — blocks 1, finishes 1

- `orc:relentless-endurance` — Relentless Endurance (level 1, species, manual)

#### `falling` — blocks 1, finishes 1

- `monk:slow-fall` — Slow Fall (level 4, class, manual)

#### `heroic-inspiration` — blocks 1, finishes 1

- `human:resourceful` — Resourceful (level 1, species, manual)

#### `a-benefit-that-runs-for-a-printed-span` — blocks 5, finishes 0

- `dwarf:stonecunning` — Stonecunning (level 1, species, manual) — also waits on 2
- `sorcerer:innate-sorcery` — Innate Sorcery (level 1, class, manual) — also waits on 2
- `druid:wild-shape` — Wild Shape (level 2, class, engine) — also waits on 1
- `dragonborn:draconic-flight` — Draconic Flight (level 5, species, manual) — also waits on 1
- `goliath:large-form` — Large Form (level 5, species, manual) — also waits on 1

#### `a-pool-the-proficiency-bonus-sizes` — blocks 5, finishes 0

- `dragonborn:breath-weapon` — Breath Weapon (level 1, species, manual) — also waits on 3
- `dwarf:stonecunning` — Stonecunning (level 1, species, manual) — also waits on 2
- `gnome:gnomish-lineage` — Gnomish Lineage (level 1, species, manual) — also waits on 1
- `goliath:giant-ancestry` — Giant Ancestry (level 1, species, manual) — also waits on 4
- `orc:adrenaline-rush` — Adrenaline Rush (level 1, species, manual) — also waits on 1

#### `a-casting-paid-for-out-of-a-feature-pool` — blocks 2, finishes 0

- `druid:wild-companion` — Wild Companion (level 2, class, manual) — also waits on 1
- `paladin:smite` — Paladin's Smite (level 2, class, manual) — also waits on 1

#### `a-feature-that-carries-a-second-grant` — blocks 2, finishes 0

- `elf:elven-lineage` — Elven Lineage (level 1, species, manual) — also waits on 1
- `sorcerer:innate-sorcery` — Innate Sorcery (level 1, class, manual) — also waits on 2

#### `a-language-or-a-proficiency-an-item-grants` — blocks 2, finishes 0

- `cleric:divine-order` — Divine Order (level 1, class, manual) — also waits on 1
- `druid:primal-order` — Primal Order (level 1, class, manual) — also waits on 1

#### `a-world-fact-nothing-can-represent` — blocks 2, finishes 0

- `dwarf:stonecunning` — Stonecunning (level 1, species, manual) — also waits on 2
- `elf:trance` — Trance (level 1, species, manual) — also waits on 1

#### `an-attack-the-class-redefines` — blocks 2, finishes 0

- `dragonborn:breath-weapon` — Breath Weapon (level 1, species, manual) — also waits on 3
- `open-hand:technique` — Open Hand Technique (level 3, subclass, manual) — also waits on 2

#### `movement-modes` — blocks 2, finishes 0

- `thief:second-story-work` — Second-Story Work (level 3, subclass, manual) — also waits on 1
- `dragonborn:draconic-flight` — Draconic Flight (level 5, species, manual) — also waits on 1

#### `temporary-hit-points-a-feature-grants` — blocks 2, finishes 0

- `orc:adrenaline-rush` — Adrenaline Rush (level 1, species, manual) — also waits on 1
- `fiend-patron:dark-ones-blessing` — Dark One's Blessing (level 3, subclass, manual) — also waits on 1

#### `a-bonus-to-spell-attack-rolls` — blocks 1, finishes 0

- `sorcerer:innate-sorcery` — Innate Sorcery (level 1, class, manual) — also waits on 2

#### `a-creature-fact-an-effect-overrides` — blocks 1, finishes 0

- `goliath:large-form` — Large Form (level 5, species, manual) — also waits on 1

#### `a-creature-swapped-for-another-stat-block` — blocks 1, finishes 0

- `druid:wild-shape` — Wild Shape (level 2, class, engine) — also waits on 1

#### `a-dc-a-feature-derives-from-its-own-abilities` — blocks 1, finishes 0

- `dragonborn:breath-weapon` — Breath Weapon (level 1, species, manual) — also waits on 3

#### `a-feature-that-changes-who-a-casting-catches` — blocks 1, finishes 0

- `sorcerer:metamagic` — Metamagic (level 2, class, manual) — also waits on 3

#### `a-mode-on-the-save-a-spell-forces` — blocks 1, finishes 0

- `sorcerer:metamagic` — Metamagic (level 2, class, manual) — also waits on 3

#### `a-reaction-effect-the-vocabulary-lacks` — blocks 1, finishes 0

- `goliath:giant-ancestry` — Giant Ancestry (level 1, species, manual) — also waits on 4

#### `a-speed-a-feature-reduces` — blocks 1, finishes 0

- `goliath:giant-ancestry` — Giant Ancestry (level 1, species, manual) — also waits on 4

#### `a-stat-block-created-mid-fight` — blocks 1, finishes 0

- `druid:wild-companion` — Wild Companion (level 2, class, manual) — also waits on 1

#### `an-action-a-spell-compels-or-forbids` — blocks 1, finishes 0

- `open-hand:technique` — Open Hand Technique (level 3, subclass, manual) — also waits on 2

#### `an-area-an-item-creates` — blocks 1, finishes 0

- `dragonborn:breath-weapon` — Breath Weapon (level 1, species, manual) — also waits on 3

#### `an-outcome-of-a-spells-own-damage` — blocks 1, finishes 0

- `fiend-patron:dark-ones-blessing` — Dark One's Blessing (level 3, subclass, manual) — also waits on 1

#### `forced-movement-a-spell-causes` — blocks 1, finishes 0

- `open-hand:technique` — Open Hand Technique (level 3, subclass, manual) — also waits on 2

#### `jumping` — blocks 1, finishes 0

- `thief:second-story-work` — Second-Story Work (level 3, subclass, manual) — also waits on 1

#### Waiting on no shape — 6

- `druid:druidic` — Druidic (level 1, class, manual)
- `fighter:fighting-style` — Fighting Style (level 1, class, manual)
- `rogue:thieves-cant` — Thieves' Cant (level 1, class, manual)
- `paladin:fighting-style` — Fighting Style (level 2, class, manual)
- `ranger:fighting-style` — Fighting Style (level 2, class, manual)
- `hunter:hunters-lore` — Hunter's Lore (level 3, subclass, manual)

Listed by level, then id.

## 3. CR ≤ 5 stat-block lines handed over or unapplied

242 of the 330 carried stat blocks are CR ≤ 5. They print 737 lines, of which the parser reads 407 and hands over 330. A further 104 of the read attack lines carry a printed rider nothing applies, so the population is 434 items over 242 blocks — 44 of which already carry none of them.

**A block is the unit that matters and a line is the unit that is counted.**
A block with four unapplied lines is one fight that does not run, not four,
so the split above is per block while the size is per line. The piles below
overlap: one sentence can force a save and recharge.

| Shape | Lines | Blocks | Three example blocks |
|---|---|---|---|
| An effect a hit buys | 104 | 93 | Animated Rug of Smothering (CR 2) / Smother; Ankheg (CR 2) / Bite; Barbed Devil (CR 5) / Claws |
| A save a line forces | 73 | 60 | Air Elemental (CR 5) / Whirlwind (Recharge 4–6); Ankheg (CR 2) / Acid Spray (Recharge 6); Basilisk (CR 3) / Petrifying Gaze (Recharge 4–6) |
| A recharge | 32 | 32 | Air Elemental (CR 5) / Whirlwind (Recharge 4–6); Ankheg (CR 2) / Acid Spray (Recharge 6); Basilisk (CR 3) / Petrifying Gaze (Recharge 4–6) |
| A use the block limits per day | 18 | 17 | Couatl (CR 4) / Divine Aid (2/Day); Cultist Fanatic (CR 2) / Spiritual Weapon (2/Day); Darkmantle (CR 0.5) / Darkness Aura (1/Day) |
| A creature that casts | 12 | 12 | Couatl (CR 4) / Spellcasting; Cultist Fanatic (CR 2) / Spellcasting; Druid (CR 2) / Spellcasting |
| A legendary action’s own economy | 2 | 1 | Unicorn (CR 5) / Charging Horn |
| How many attacks the Attack action holds | 1 | 1 | Roper (CR 5) / Multiattack |

**Two of those rows are an effect nobody applies and an economy that is
already correct.** A recharge and a per-day limit are parsed onto every
line, carried onto the sheet, asked at the turn boundary and spent by
`takeStatedAction`; what is unapplied on such a line is what it *does*.
A brief quoting those rows should say so.

### Handed-over lines matching no enumerated shape — 227

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
- Archelon (CR 4) [trait] Amphibious
- Azer Sentinel (CR 2) [trait] Fire Aura
- Azer Sentinel (CR 2) [trait] Illumination
- Bandit Captain (CR 2) [reaction] Parry
- Barbed Devil (CR 5) [trait] Barbed Hide
- Barbed Devil (CR 5) [trait] Diabolical Restoration
- Barbed Devil (CR 5) [trait] Magic Resistance
- Bearded Devil (CR 3) [trait] Magic Resistance
- Berserker (CR 2) [trait] Bloodied Frenzy
- Black Dragon Wyrmling (CR 2) [trait] Amphibious
- Black Pudding (CR 4) [trait] Amorphous
- Black Pudding (CR 4) [trait] Corrosive Form
- Black Pudding (CR 4) [trait] Spider Climb
- Black Pudding (CR 4) [reaction] Split
- Boar (CR 0.25) [trait] Bloodied Fury
- Bronze Dragon Wyrmling (CR 2) [trait] Amphibious
- Bugbear Stalker (CR 3) [trait] Abduct
- Bugbear Warrior (CR 1) [trait] Abduct
- Bulette (CR 5) [bonus action] Leap
- Cat (CR 0) [trait] Jumper
- Chuul (CR 4) [trait] Amphibious
- Chuul (CR 4) [trait] Sense Magic
- Commoner (CR 0) [trait] Training
- Couatl (CR 4) [trait] Shielded Mind
- Crab (CR 0) [trait] Amphibious
- Crocodile (CR 0.5) [trait] Hold Breath
- Deer (CR 0) [trait] Agile
- Doppelganger (CR 3) [action] Read Thoughts
- Doppelganger (CR 3) [bonus action] Shape-Shift
- Dryad (CR 1) [trait] Magic Resistance
- Dryad (CR 1) [trait] Speak with Beasts and Plants
- Dryad (CR 1) [bonus action] Tree Stride
- Earth Elemental (CR 5) [trait] Earth Glide
- Earth Elemental (CR 5) [trait] Siege Monster
- Ettercap (CR 2) [bonus action] Reel
- Ettercap (CR 2) [trait] Spider Climb
- Ettercap (CR 2) [trait] Web Walker
- Fire Elemental (CR 5) [trait] Fire Aura
- Fire Elemental (CR 5) [trait] Fire Form
- Fire Elemental (CR 5) [trait] Illumination
- Fire Elemental (CR 5) [trait] Water Susceptibility
- Flesh Golem (CR 5) [trait] Aversion to Fire
- Flesh Golem (CR 5) [trait] Berserk
- Flesh Golem (CR 5) [trait] Immutable Form
- Flesh Golem (CR 5) [trait] Lightning Absorption
- Flesh Golem (CR 5) [trait] Magic Resistance
- Flying Snake (CR 0.125) [trait] Flyby
- Frog (CR 0) [trait] Amphibious
- Frog (CR 0) [trait] Standing Leap
- Gargoyle (CR 2) [trait] Flyby
- Gelatinous Cube (CR 2) [trait] Ooze Cube
- Gelatinous Cube (CR 2) [trait] Transparent
- Ghost (CR 4) [trait] Ethereal Sight
- Ghost (CR 4) [action] Etherealness
- Ghost (CR 4) [trait] Incorporeal Movement
- Giant Boar (CR 2) [trait] Bloodied Fury
- Giant Crab (CR 0.125) [trait] Amphibious
- Giant Crocodile (CR 5) [trait] Hold Breath
- Giant Fire Beetle (CR 0) [trait] Illumination
- Giant Frog (CR 0.25) [trait] Amphibious
- Giant Frog (CR 0.25) [trait] Standing Leap
- Giant Frog (CR 0.25) [action] Swallow
- Giant Lizard (CR 0.25) [trait] Spider Climb
- Giant Octopus (CR 1) [trait] Water Breathing
- Giant Owl (CR 0.25) [trait] Flyby
- Giant Seahorse (CR 0.5) [bonus action] Bubble Dash
- Giant Seahorse (CR 0.5) [trait] Water Breathing
- Giant Shark (CR 5) [trait] Water Breathing
- Giant Spider (CR 1) [trait] Spider Climb
- Giant Spider (CR 1) [trait] Web Walker
- Giant Toad (CR 1) [trait] Amphibious
- Giant Toad (CR 1) [trait] Standing Leap
- Giant Toad (CR 1) [action] Swallow
- Giant Wasp (CR 0.5) [trait] Flyby
- Giant Wolf Spider (CR 0.25) [trait] Spider Climb
- Gibbering Mouther (CR 2) [trait] Aberrant Ground
- Gladiator (CR 5) [reaction] Parry
- Goblin Boss (CR 1) [bonus action] Nimble Escape
- Goblin Boss (CR 1) [reaction] Redirect Attack
- Goblin Minion (CR 0.125) [bonus action] Nimble Escape
- Goblin Warrior (CR 0.25) [bonus action] Nimble Escape
- Gold Dragon Wyrmling (CR 3) [trait] Amphibious
- Gray Ooze (CR 0.5) [trait] Amorphous
- Gray Ooze (CR 0.5) [trait] Corrosive Form
- Green Dragon Wyrmling (CR 2) [trait] Amphibious
- Green Hag (CR 3) [trait] Amphibious
- Green Hag (CR 3) [trait] Coven Magic
- Green Hag (CR 3) [trait] Mimicry
- Half-Dragon (CR 5) [trait] Draconic Origin
- Half-Dragon (CR 5) [bonus action] Leap
- Hippogriff (CR 1) [trait] Flyby
- Hippopotamus (CR 4) [trait] Hold Breath
- Hobgoblin Captain (CR 3) [trait] Aura of Authority
- Homunculus (CR 0) [trait] Telepathic Bond
- Hunter Shark (CR 2) [trait] Water Breathing
- Imp (CR 1) [action] Invisibility
- Imp (CR 1) [trait] Magic Resistance
- Imp (CR 1) [action] Shape-Shift
- Incubus (CR 4) [trait] Succubus Form
- Killer Whale (CR 3) [trait] Hold Breath
- Knight (CR 3) [reaction] Parry
- Kobold Warrior (CR 0.125) [trait] Sunlight Sensitivity
- Lamia (CR 4) [bonus action] Leap
- Lemure (CR 0) [trait] Hellish Restoration
- Lion (CR 1) [trait] Running Leap
- Lizard (CR 0) [trait] Spider Climb
- Magmin (CR 0.5) [bonus action] Ignited Illumination
- Merfolk Skirmisher (CR 0.125) [trait] Amphibious
- Merrow (CR 2) [trait] Amphibious
- Mimic (CR 2) [trait] Adhesive (Object Form Only)
- Mimic (CR 2) [bonus action] Shape-Shift
- Mule (CR 0.125) [trait] Beast of Burden
- Night Hag (CR 5) [trait] Coven Magic
- Night Hag (CR 5) [trait] Magic Resistance
- Night Hag (CR 5) [bonus action] Shape-Shift
- Night Hag (CR 5) [trait] Soul Bag
- Nightmare (CR 3) [trait] Confer Fire Resistance
- Nightmare (CR 3) [action] Ethereal Stride
- Nightmare (CR 3) [trait] Illumination
- Noble (CR 0.125) [reaction] Parry
- Ochre Jelly (CR 2) [trait] Amorphous
- Ochre Jelly (CR 2) [trait] Spider Climb
- Ochre Jelly (CR 2) [reaction] Split
- Octopus (CR 0) [trait] Compression
- Octopus (CR 0) [trait] Water Breathing
- Ogre Zombie (CR 2) [trait] Undead Fortitude
- Owl (CR 0) [trait] Flyby
- Panther (CR 0.25) [bonus action] Nimble Escape
- Phase Spider (CR 3) [bonus action] Ethereal Jaunt
- Phase Spider (CR 3) [trait] Ethereal Sight
- Phase Spider (CR 3) [trait] Spider Climb
- Phase Spider (CR 3) [trait] Web Walker
- Piranha (CR 0) [trait] Water Breathing
- Plesiosaurus (CR 2) [trait] Hold Breath
- Pseudodragon (CR 0.25) [trait] Magic Resistance
- Pteranodon (CR 0.25) [trait] Flyby
- Quasit (CR 1) [action] Invisibility
- Quasit (CR 1) [trait] Magic Resistance
- Quasit (CR 1) [action] Shape-Shift
- Rat (CR 0) [trait] Agile
- Raven (CR 0) [trait] Mimicry
- Reef Shark (CR 0.5) [trait] Water Breathing
- Roper (CR 5) [action] Reel
- Roper (CR 5) [trait] Spider Climb
- Roper (CR 5) [action] Tentacle
- Rust Monster (CR 0.5) [action] Destroy Metal
- Rust Monster (CR 0.5) [trait] Iron Scent
- Rust Monster (CR 0.5) [reaction] Reflexive Antennae
- Saber-Toothed Tiger (CR 2) [bonus action] Nimble Escape
- Saber-Toothed Tiger (CR 2) [trait] Running Leap
- Sahuagin Warrior (CR 0.5) [bonus action] Aquatic Charge
- Sahuagin Warrior (CR 0.5) [trait] Blood Frenzy
- Sahuagin Warrior (CR 0.5) [trait] Limited Amphibiousness
- Sahuagin Warrior (CR 0.5) [trait] Shark Telepathy
- Salamander (CR 5) [trait] Fire Aura
- Satyr (CR 0.5) [trait] Magic Resistance
- Sea Hag (CR 2) [trait] Amphibious
- Sea Hag (CR 2) [trait] Coven Magic
- Sea Hag (CR 2) [action] Illusory Appearance
- Seahorse (CR 0) [action] Bubble Dash
- Seahorse (CR 0) [trait] Water Breathing
- Shadow (CR 0.5) [trait] Amorphous
- Shadow (CR 0.5) [bonus action] Shadow Stealth
- Shadow (CR 0.5) [trait] Sunlight Weakness
- Shambling Mound (CR 5) [trait] Lightning Absorption
- Shrieker Fungus (CR 0) [reaction] Shriek
- Specter (CR 1) [trait] Incorporeal Movement
- Specter (CR 1) [trait] Sunlight Sensitivity
- Sphinx of Wonder (CR 1) [trait] Magic Resistance
- Spider (CR 0) [trait] Spider Climb
- Spider (CR 0) [trait] Web Walker
- Sprite (CR 0.25) [action] Invisibility
- Spy (CR 1) [bonus action] Cunning Action
- Steam Mephit (CR 0.25) [trait] Blurred Form
- Succubus (CR 4) [action] Charm
- Succubus (CR 4) [trait] Incubus Form
- Succubus (CR 4) [bonus action] Shape-Shift
- Swarm of Bats (CR 0.25) [trait] Swarm
- Swarm of Crawling Claws (CR 3) [trait] Swarm
- Swarm of Insects (CR 0.5) [trait] Spider Climb
- Swarm of Insects (CR 0.5) [trait] Swarm
- Swarm of Piranhas (CR 1) [trait] Swarm
- Swarm of Piranhas (CR 1) [trait] Water Breathing
- Swarm of Rats (CR 0.25) [trait] Swarm
- Swarm of Ravens (CR 0.25) [trait] Swarm
- Swarm of Venomous Snakes (CR 2) [trait] Swarm
- Tiger (CR 1) [bonus action] Nimble Escape
- Troll (CR 5) [bonus action] Charge
- Troll (CR 5) [trait] Regeneration
- Troll Limb (CR 0.5) [trait] Regeneration
- Troll Limb (CR 0.5) [trait] Troll Spawn
- Unicorn (CR 5) [legendary action] Charging Horn
- Unicorn (CR 5) [trait] Magic Resistance
- Unicorn (CR 5) [legendary action] Shimmering Shield
- Vampire Familiar (CR 3) [bonus action] Deathless Agility
- Vampire Familiar (CR 3) [trait] Vampiric Connection
- Vampire Spawn (CR 5) [bonus action] Deathless Agility
- Vampire Spawn (CR 5) [trait] Forbiddance
- Vampire Spawn (CR 5) [trait] Running Water
- Vampire Spawn (CR 5) [trait] Spider Climb
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
- Wight (CR 3) [trait] Sunlight Sensitivity
- Will-o'-Wisp (CR 2) [trait] Ephemeral
- Will-o'-Wisp (CR 2) [trait] Illumination
- Will-o'-Wisp (CR 2) [trait] Incorporeal Movement
- Will-o'-Wisp (CR 2) [bonus action] Vanish
- Wraith (CR 5) [action] Create Specter
- Wraith (CR 5) [trait] Incorporeal Movement
- Wraith (CR 5) [trait] Sunlight Sensitivity
- Xorn (CR 5) [bonus action] Charge
- Xorn (CR 5) [trait] Earth Glide
- Xorn (CR 5) [trait] Treasure Sense
- Zombie (CR 0.25) [trait] Undead Fortitude
