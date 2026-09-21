# Level 5 reach ledger, snapshot of 2026-09-21

> A snapshot taken at `f163717` by the audit of 2026-09-21, for the foreman to brief from until `docs/ROADMAP.md` P0-T1 makes it a generated file (`npm run ledger` writing `LEDGER.md`). Line numbers were true on that day; re-read them before writing a brief. Do not edit by hand; regenerate.

# The level 5 reach ledger

Read-only. Every number below is derived by a script under `node_modules/.audit/`
(gitignored) against the working tree at `f163717`. No tracked file was
modified, and no generator was run.

Scripts written for this ledger, all runnable as `npx tsx node_modules/.audit/<name>.ts`
from the repo root:

| Script | Output | What it derives |
|---|---|---|
| `ledger-spells.ts` | `ledger-spells.txt` | the 141 non-executed spells in reach, by shape; the no-shape set; the 7 undefined with every clause |
| `ledger-features.ts` | `ledger-features.txt` | the 31 ledger features, their clauses and the shape ranking over them |
| `ledger-monsters.ts` | `ledger-monsters.txt` | the 330 handed-over lines and 104 riders, by the `coverage-data` predicates and then by a regex taxonomy |
| `ledger-freed.ts` | `ledger-freed.txt` | per monster bucket, the CR ≤ 5 blocks it **alone** frees |
| `ledger-project.ts` | `ledger-project.txt` | what the two proposed batches finish and what is left |
| `sections.ts`, `shapedesc.ts`, `spellnotes.ts`, `probe2.ts` | stdout | section counts, shape prose, per-spell clauses, what the monster parser reads |

Reused as given: `node_modules/.audit/level5.json` (parts 0 and 1),
`node_modules/.audit/monsters.ts`, `node_modules/.audit/extra.ts`.

---

## 0. Totals

**Reach.** Union over all twelve paths at level 5 (`level5.json` part 0):
183 spells — 42 executed, 29 executed-partial, 105 tracked, 7 with no
definition. 120 distinct features at level ≤ 5, of which 27 declare
`automation: 'manual'`. 242 of the 330 carried stat blocks are CR ≤ 5.

**The ledger.**

| | Size | Of which needs engine work | Of which needs nothing |
|---|---|---|---|
| Spells (non-executed, in reach) | **141** | **89** name at least one shape | **52** name none |
| Features (27 manual + 4 pool-only) | **31** | **21** name at least one shape | **10** name none |
| Monster items, CR ≤ 5 | **434** (330 handed-over lines + 104 riders) | on **198** of 242 blocks | **44** blocks already carry nothing unapplied |

The 52 no-shape spells are the finding that most changes the size of the job:
**37 % of the non-executed spells in level-5 reach are finished business**
— a tracked definition whose every printed mechanic is either already rolled
or is a handover the doctrine says nobody will ever pay. They are named in
§1(b). The 10 no-shape features are §2's languages, Fighting Styles and pools.

**After the two proposed batches (§4).**

| | Now | After batch 1 | After batches 1+2 |
|---|---|---|---|
| Spells finished (of the 89) | 0 | **20** | **40**; 49 left |
| New definitions written (of the 7 undefined) | 0 | 1 (Darkness) | 3 (+ Entangle, Magic Missile) |
| Features finished (of the 21) | 0 | **3** | **9**; 12 left |
| Features reachable that were not | — | +2 (Action Surge, Flurry of Blows) | +2 |
| CR ≤ 5 blocks with nothing unapplied | **44** / 242 | **77** | **166** |

Everything below is measured. Where a count comes from a regex over English
rather than from parsed structure it says so, in §3.

---

## 1. Spells by shape

### How the map works

`packages/content/scripts/missing-shapes.ts` holds one shape vocabulary
(`MISSING_SHAPES`, line 95) and three populations over it:

- `ADJUDICATED` (line 472) — executed definitions, one entry per clause the
  engine does not finish. `why` is `'table'` (a handover) or a shape id.
- `TRACKED_ADJUDICATED` (line 1282) — tracked definitions read sentence by
  sentence. `why` adds `'engine'`, meaning the clause *is* executed.
- `BLOCKED_ON` (line 3775) — parsed spells with no definition at all. An entry
  is a bare shape id (grandfathered) or a `BlockedClause` whose `why` may also
  be `'expressible'`.

`blockersIn` (line 4441) drops `table` / `expressible` and dedupes, `blockersOf`
(line 4455) is the per-spell answer, and `consumersOf` (line 4774) unions the
three populations into `blocks` (every spell a shape touches) and `unblocks`
(the spells it is the **only** blocker for). `allShapeConsumers` (line 4818)
sorts by `unblocks` then `blocks`. `packages/content/scripts/coverage.ts:735`
prints that as *Blocks / Finishes (read) / Finishes (unread) / Executed /
Tracked / of which unseen / Undefined*; `coverage.ts:693` is the call.
`PARTIAL_SPELLS` (`coverage-data.ts:137`) is itself derived — a definition is
partial exactly when `ADJUDICATED` gives it a clause whose `why` is not
`'table'`.

This ledger re-runs that query **restricted to the 141**, so a shape's
*Finishes* here means "of the spells a level-5 character can reach". It is a
different, smaller number than `COVERAGE.md`'s.

### The table, over the 141

`Blocks` = spells of the 141 naming this shape. `Finishes` = spells of the 141
for which it is the **only** shape. Last column: partial / tracked / undefined
split of the Blocks column.

| Shape | Blocks | Finishes | p/t/u |
|---|---|---|---|
| `a-choice-made-at-the-casting` | 8 | 5 | 3/5/0 |
| `an-action-a-spell-compels-or-forbids` | 7 | 3 | 5/1/1 |
| `a-condition-benefit-an-effect-takes-away` | 4 | 3 | 3/1/0 |
| `a-rider-on-a-later-weapon-attack` | 6 | 2 | 0/6/0 |
| `a-random-outcome-that-is-not-a-d20` | 5 | 2 | 0/3/2 |
| `a-standing-effect-derived-from-where-a-creature-stands` | 5 | 2 | 1/4/0 |
| `difficult-terrain-an-area-creates` | 5 | 2 | 2/2/1 |
| `a-stat-block-created-mid-fight` | 4 | 2 | 0/3/1 |
| `movement-modes` | 4 | 2 | 1/3/0 |
| `what-a-creature-is-holding` | 4 | 2 | 2/2/0 |
| `forced-movement-a-spell-causes` | 3 | 2 | 1/2/0 |
| `senses-beyond-declared-sight` | 3 | 2 | 1/1/1 |
| `several-attack-rolls-from-one-casting` | 3 | 2 | 2/1/0 |
| `healing-modified-by-an-effect` | 2 | 2 | 2/0/0 |
| `a-casting-ended-by-a-trigger` | 6 | 1 | 3/2/1 |
| `a-repeat-save-that-does-something-on-a-failure` | 4 | 1 | 1/3/0 |
| `damage-with-neither-an-attack-roll-nor-a-save` | 3 | 1 | 1/1/1 |
| `a-target-rule-the-format-cannot-state` | 2 | 1 | 0/2/0 |
| `an-area-trigger-measured-from-a-point` | 2 | 1 | 0/1/1 |
| `a-hit-point-maximum-a-spell-moves` | 1 | 1 | 0/1/0 |
| `a-reduction-an-effect-applies-to-damage` | 1 | 1 | 0/1/0 |
| `a-save-keyed-to-a-condition` | 1 | 1 | 1/0/0 |
| `a-second-roll-sequenced-after-the-first` | 1 | 1 | 0/1/0 |
| `a-spell-that-answers-a-later-attack` | 1 | 1 | 0/1/0 |
| `a-wall-or-several-templates-in-one-area` | 1 | 1 | 0/1/0 |
| `a-world-fact-nothing-can-represent` | 1 | 1 | 0/1/0 |
| `an-armor-class-a-spell-floors` | 1 | 1 | 0/1/0 |
| `an-outcome-that-breaks-concentration` | 1 | 1 | 0/1/0 |
| `falling` | 1 | 1 | 0/1/0 |
| `healing-that-raises-the-dead` | 1 | 1 | 0/1/0 |
| `jumping` | 1 | 1 | 0/1/0 |
| `targeting-rules-that-differ-within-one-casting` | 1 | 1 | 1/0/0 |

Thirty-seven further shapes block between one and three of the 141 and finish
none; they are in `ledger-spells.txt`. The heaviest of those by Blocks are
`a-check-another-creature-may-attempt` (3), `a-fact-only-the-table-can-declare`
(3), `a-spells-effects-applied-to-different-targets` (3).

**Read the Finishes column, not Blocks** — WORKFLOW.md rule 1. The two largest
Blocks numbers in the whole restricted table are 8 and 7, so the seduction is
mild here; the real trap is the long tail of 1-blocks-1-finishes shapes, which
are the *cheapest* entries in the ledger and are invisible in a ranking by
Blocks.

### Who each shape finishes

- `a-choice-made-at-the-casting` (5): **Blindness/Deafness** (L2, partial),
  **Enhance Ability** (L2, tracked), **Lesser Restoration** (L2, partial),
  **Guidance** (L0, partial), **Thaumaturgy** (L0, tracked).
  Also blocks Enlarge/Reduce, Glyph of Warding, Hex, each with 2–4 more.
- `an-action-a-spell-compels-or-forbids` (3): **Command** (L1, tracked),
  **Dissonant Whispers** (L1, partial), **Shocking Grasp** (L0, partial).
- `a-condition-benefit-an-effect-takes-away` (3): **Starry Wisp** (L0),
  **Faerie Fire** (L1), **Mind Spike** (L2).
- `a-rider-on-a-later-weapon-attack` (2): **True Strike** (L0), **Shillelagh** (L0).
- `a-random-outcome-that-is-not-a-d20` (2): **Augury** (L2), **Blink** (L3).
- `a-standing-effect-derived-from-where-a-creature-stands` (2): **Zone of Truth**
  (L2), **Spirit Guardians** (L3).
- `difficult-terrain-an-area-creates` (2): **Plant Growth** (L3), **Grease** (L1).
- `a-stat-block-created-mid-fight` (2): **Find Steed** (L2), **Phantom Steed** (L3).
- `movement-modes` (2): **Spider Climb** (L2), **Fly** (L3).
- `what-a-creature-is-holding` (2): **Goodberry** (L1), **Flame Blade** (L2).
- `forced-movement-a-spell-causes` (2): **Thunderwave** (L1), **Levitate** (L2).
- `senses-beyond-declared-sight` (2): **Mirror Image** (L2), **Blur** (L2).
- `several-attack-rolls-from-one-casting` (2): **Scorching Ray** (L2),
  **Eldritch Blast** (L0).
- `healing-modified-by-an-effect` (2): **Beacon of Hope** (L3), **Chill Touch** (L0).
- The one-apiece shapes: `a-casting-ended-by-a-trigger` → Invisibility;
  `a-repeat-save-that-does-something-on-a-failure` → Searing Smite;
  `damage-with-neither-an-attack-roll-nor-a-save` → Shield;
  `a-target-rule-the-format-cannot-state` → Animal Messenger;
  `an-area-trigger-measured-from-a-point` → Flaming Sphere;
  `a-hit-point-maximum-a-spell-moves` → Aid;
  `a-reduction-an-effect-applies-to-damage` → Resistance;
  `a-save-keyed-to-a-condition` → Protection from Poison;
  `a-second-roll-sequenced-after-the-first` → Ice Knife;
  `a-spell-that-answers-a-later-attack` → Sanctuary;
  `a-wall-or-several-templates-in-one-area` → Wind Wall;
  `a-world-fact-nothing-can-represent` → Meld into Stone;
  `an-armor-class-a-spell-floors` → Barkskin;
  `an-outcome-that-breaks-concentration` → Sleet Storm;
  `falling` → Feather Fall;
  `healing-that-raises-the-dead` → Revivify;
  `jumping` → Jump;
  `targeting-rules-that-differ-within-one-casting` → Vampiric Touch.

### (a) Spells in reach whose every noted clause is a handover

Six tracked definitions carry an adjudication entry in which **no** clause is a
debt. Three are `'table'`-only and three are `'engine'`-only, which is the
stronger statement — the clause is already rolled.

| Spell | Level | Every `why` |
|---|---|---|
| Minor Illusion | 0 | `engine` (the Investigation check is rolled by `resolveEffectCheck`) |
| Disguise Self | 1 | `engine` |
| Silent Image | 1 | `engine` |
| Magic Mouth | 2 | `table` |
| See Invisibility | 2 | `table` |
| Major Image | 3 | `engine` |

A further **45** tracked spells in reach carry **no adjudication entry at all**,
which under `TRACKED_ADJUDICATED`'s own discipline means somebody read the
paragraph and it tripped no mechanical marker: Dancing Lights, Light, Mage Hand,
Mending, Message, Prestidigitation, Druidcraft, Elementalism, Comprehend
Languages, Detect Magic, Identify, Illusory Script, Speak with Animals, Create
or Destroy Water, Detect Evil and Good, Detect Poison and Disease, Purify Food
and Drink, Fog Cloud, Alarm, Expeditious Retreat, Floating Disk, Knock, Locate
Animals or Plants, Locate Object, Continual Flame, Find Traps, Gentle Repose,
Darkvision, Pass without Trace, Magic Weapon, Arcane Lock, Arcanist's Magic
Aura, Rope Trick, Clairvoyance, Nondetection, Speak with Dead, Speak with
Plants, Tiny Hut, Tongues, Animate Dead, Create Food and Water, Daylight,
Remove Curse, Water Walk, Water Breathing.

### (b) Spells in reach whose clauses map to no shape at all

**52 of the 141.** That is the six of (a) plus the 45 above plus one undefined
spell, **Darkness** (L2), whose `BLOCKED_ON` entry is five clauses, four
`'table'` and one `'expressible'` — a 15-foot-radius Sphere at a point within
range, which `SpellArea` states verbatim
(`packages/engine/src/spell-definitions.ts:1558`). `isSentenceComplete` is true
for it.

These 52 need **no engine work**. Forty-five of them need no work of any kind;
Darkness needs a definition written, and that is data.

### (c) The 7 undefined spells, against the `SpellEffect` union

The union is `packages/engine/src/spell-definitions.ts:750` and has twenty
members: `attack`, `save-damage`, `temp-hp`, `buff`, `roll-mode`, `heal`,
`turn-payout`, `attack-damage`, `condition`, `end-condition`, `save`, `dispel`,
`armor-class`, `damage-defense`, `condition-immunity`, `speed`, `action-rule`,
`attack-rider`, `interrupt-casting`, `teleport`. Beside it: `SpellCheck` (line
341), `ConditionRider` (line 440), `OutcomeRiders` (line 661), `AreaTrigger`
(line 1612), `TargetRule` (line 1772), `SpellActivation` (line 2341), and
`RepeatSave` in `packages/engine/src/timers.ts:147`. The exhaustive resolver
dispatch is `resolveOneEffect`, `packages/engine/src/commands/spell-resolution.ts:1747`;
the validator is `checkEffect`, `packages/engine/src/spell-schema.ts:1254`.

**Darkness (L2)** — writable **today**. The Sphere is `SpellArea`
`{ kind: 'sphere', radius: 15, origin: 'point' }`; the four sight, Emanation,
covering and dispel clauses are all `'table'` and belong in `dmDecides`. No new
shape. One caveat: the definition would be **tracked**, not executed, because
nothing it states resolves — which is exactly what a definition whose whole
mechanic is obscurement should be while the engine holds no light
(`sightBetween`, `packages/engine/src/positioning.ts:1875`, says so in its own
comment: "no Bright, Dim or Darkness to condition the sense on").

**Entangle (L1)** — four of six clauses expressible, two blocked.
Expressible: the 20-foot Cube (`SpellArea` `cube`/`origin: 'point'`); the
Strength save whose failure applies Restrained until the casting ends (`save`,
line 1098, which takes `ability` + `condition`); the Strength (Athletics) check
the Restrained creature may attempt against the pinned DC
(`ConditionRider.check`, line 440); and the success releasing the condition on
that creature alone (`onSuccess: 'end-on-target'`). Blocked:
`difficult-terrain-an-area-creates` and `an-area-that-filters-its-catch` (the
area excludes its own caster by rule, and `designatesUnaffected` is an explicit
caller-named list, a different sentence).

**Magic Missile (L1)** — the target list is an ordinary `TargetRule` held to
range and declared sight. Two clauses have no host: the dart's
`1d4 + 1` Force damage needs `damage-with-neither-an-attack-roll-nor-a-save`
(every damaging member — `attack`, `save-damage`, `attack-damage` — hangs off a
roll), and dividing three darts among targets needs
`a-spells-effects-applied-to-different-targets` (one effect list reaches every
target the same number of times; `TargetRule.extraPerSlotLevelAbove` grows the
*targets*, and the slot here buys a *dart*).

**Phantasmal Force (L2)** — two clauses expressible: the Intelligence save with
the whole spell on the failure branch (`save`), and the Study action's
Intelligence (Investigation) check against the pinned DC (`SpellCheck`, which
carries ability, skill and DC). Three `'table'`. Three blocked:
`a-casting-ended-by-a-trigger` (`SpellCheck.onSuccess` is `none` or
`end-on-target` and deliberately has no `end-casting`),
`an-area-trigger-on-the-casters-turn` (`AreaTrigger`'s two boundaries are the
caught creature's), and `an-area-trigger-measured-from-a-point`
(`CastingOrigin.reach`, line 1700, answers only for an attack the caster makes).

**Sending (L3)** — no clause fits an existing kind. One `'table'`; three
blocked on `a-second-place-to-put-a-creature` (one scene, so a target on another
plane cannot be found at all), `a-random-outcome-that-is-not-a-d20` (a 5 %
chance; no `SpellEffect` asks for a non-d20 throw), and
`an-effect-that-suppresses-other-magic`.

**Slow (L3)** — the most instructive of the seven. The 40-foot-Cube target list
is expressible (`targetsWithin`, as Mass Cure Wounds writes it). Four separate
clauses — the halved Speed (`speed-change` exists), the −2 AC (`BonusApplies`
covers `ac` and a negative bonus is the same field), "it can't take Reactions"
(`ActionRule.forbids`, `packages/engine/src/combat.ts:284`, and Slow is one of
the three SRD sentences that member was derived from), and the end-of-turn
repeat save (`RepeatSave` with `onSuccess: 'end-on-target'`) — are each
**individually built** and each have **nowhere to hang**, because the `save`
kind (line 1098) *requires* a `condition` out of the SRD's fifteen and this
failure imposes none. That one absence, `a-save-whose-failure-imposes-no-condition`,
is four of Slow's blockers. The remaining two are
`a-bonus-narrowed-to-a-skill` (the −2 is on Dexterity saves alone;
`BonusApplies` at `packages/engine/src/bonuses.ts:54` is
`'attack' | 'save' | 'ability-check' | 'ac'` and cannot narrow) and
`an-action-a-spell-compels-or-forbids` (an action **or** a Bonus Action, not
both — a rule coupling two slots, which neither `forbids` nor `permits-only`
can state), plus `a-random-outcome-that-is-not-a-d20` for the 25 % failure.

**Find Familiar (L1)** — the Casting Time (1 hour or Ritual) is expressible now
that long castings are built; one clause is `'table'` (telepathy) and one more
is the dropped gear. Everything else is one absence, five times over:
`a-stat-block-created-mid-fight` for the chosen form's statistics, the CR-0
selector, "a familiar can't attack", dropping to 0 Hit Points, and reappearing
in an unoccupied space. Plus `senses-beyond-declared-sight` (seeing through the
familiar's eyes), `an-activation-taken-by-somebody-other-than-the-caster` twice
(delivering a touch spell, and the familiar's own Reaction), and
`a-second-place-to-put-a-creature` (the pocket dimension).

**Verified against the code, and it changes the brief.** The entries say "a
casting adds no creature to a scene", which is literally true — but the
*summoning machinery already exists*: `summonCreature`
(`packages/engine/src/commands/creatures.ts:269`) puts a bestiary block into
play bound to a casting, `creature-summoned` is an event
(`packages/engine/src/events.ts:593`), `SummonBond` is state
(`packages/engine/src/state.ts:281`), and `summon_creature` /
`dismiss_stranded_summons` are published tools
(`packages/tools/src/definitions.ts:979`, `:1044`). What is missing is only a
**`SpellEffect` member that summons from the definition's own words**, so the
casting names the block instead of a caller naming it. That is a much smaller
brief than "build summons", and a brief written from the map's prose alone
would have got it wrong.

---

## 2. Features by shape

`packages/content/scripts/missing-feature-shapes.ts` holds `FEATURE_SHAPES`
(line 88) and `FEATURE_BLOCKED_ON` (line 222). Its population is read off the
catalogue rather than listed: a feature is in the map exactly when it declares
`automation: 'manual'` (`isExecutedFeature`, `coverage-data.ts:340`), and
`featureCoverageGaps` (line 1573) refuses both a manual feature with no line
and a line for a feature since executed. `featureBlockersOf` is line 1536,
`featureConsumersOf` line 1597, and `coverage.ts:141` prints
*Shape / Blocks / Finishes*. Clause values are `'table'`, `'expressible'` or a
shape id drawn from **all three** vocabularies (spell, item and feature).

### The ranking over the 31

| Shape | Blocks | Finishes |
|---|---|---|
| `a-feature-that-changes-what-a-casting-costs` | 4 | 2 |
| `an-option-re-chosen-on-a-rest` | 2 | 2 |
| `a-move-a-feature-hands-its-holder` | 2 | 1 |
| `a-bonus-an-ability-modifier-sizes` | 1 | 1 |
| `a-bonus-narrowed-to-a-skill` | 1 | 1 |
| `a-feature-that-rewrites-another-features-rule` | 1 | 1 |
| `a-hit-point-maximum-a-spell-moves` | 1 | 1 |
| `an-action-the-engine-has-no-spender-for` | 1 | 1 |
| `falling` | 1 | 1 |
| `a-casting-paid-for-out-of-a-feature-pool` | 2 | 0 |
| `a-grant-gated-on-one-option-of-a-choice` | 2 | 0 |
| `a-language-or-a-proficiency-an-item-grants` | 2 | 0 |
| fourteen further shapes | 1 | 0 |

Finishers by name:

- `a-feature-that-changes-what-a-casting-costs` → **warlock:eldritch-invocations**,
  **wizard:ritual-adept**. Both are *one-clause* finishes and neither is
  satisfying: Eldritch Invocations' other clause is `'table'` ("each is its own
  small rule" — the invocations are not content yet), and Ritual Adept's is a
  refusal the casting layer owns. Building this shape would mark both executed
  while an SRD reader still sees nothing happen for an invocation. **Flag: this
  is the highest Finishes number in the feature table and the least real.**
- `an-option-re-chosen-on-a-rest` → **circle-of-the-land:spells**,
  **wizard:memorize-spell**. Both genuine and both whole; the design note names
  Circle of the Land by name as the shape's first consumer.
- `a-move-a-feature-hands-its-holder` → **fighter:tactical-shift** (also blocks
  rogue:cunning-strike).
- `a-bonus-an-ability-modifier-sizes` → **oath-of-devotion:sacred-weapon**
  (Charisma to attack rolls; `save-bonus` and `check-bonus` in
  `packages/engine/src/standing.ts:326`, `:345` are the two built families and
  the attack family has no member).
- `a-bonus-narrowed-to-a-skill` → **bard:jack-of-all-trades**.
- `a-feature-that-rewrites-another-features-rule` → **cleric:sear-undead**
  (Turn Undead itself is executed; the Radiant half is a later feature adding to
  an earlier one's use).
- `a-hit-point-maximum-a-spell-moves` → **draconic-sorcery:draconic-resilience**.
- `an-action-the-engine-has-no-spender-for` → **thief:fast-hands**. Note that
  `NAMED_ACTIONS` (`packages/engine/src/combat.ts:161`) says in its own comment
  that Utilize is absent because no command spends it; the shape's own text says
  a grant vocabulary would not help.
- `falling` → **monk:slow-fall**.

### The three recorded-only features — agreed, with one correction

- **druid:druidic** — "A secret language and the hidden messages it leaves are
  narration; recorded as a proficiency and read by nobody." Clause `'table'`.
  **Agree.** Nothing downstream reads it, so it is a handover by the
  `content.md` test ("a table fact nothing reads afterwards is a handover").
- **rogue:thieves-cant** — same shape, same clause, same conclusion. **Agree.**
- **hunter:hunters-lore** — "Learning a marked creature's immunities,
  resistances and vulnerabilities is narration the engine could answer but is
  not asked." Clause `'table'`; the map's own note calls it "the one entry in
  this map whose feature is finished business". **Agree that no rule reads it**
  — but the note's parenthetical is the interesting half. The engine *does*
  hold the answer: `adaptMonster` sorts printed defences into enforced,
  qualified and unread (`packages/engine/src/monster.ts:805`), and `look` /
  `sheet` could report them. So this is not a debt in the blocker sense, but it
  *is* a one-line door in `packages/tools` if the owner ever wants the Ranger's
  knowledge to be a thing the surface can ask for. I would leave it filed where
  it is and note the door, not open a shape for it.

### Features already half-built, and what the other half needs

Seven notes say so in as many words.

| Feature | Applied | The other half |
|---|---|---|
| `cleric:divine-order` (L1) | Thaumaturge's `check-bonus` over Arcana and Religion, sized by Wisdom | Protector's Martial + Heavy armour training (`a-language-or-a-proficiency-an-item-grants`) and Thaumaturge's extra cantrip, which a `spells` grant could state but only a `standing` grant carries `onlyIfChoice` (`a-grant-gated-on-one-option-of-a-choice`) |
| `druid:primal-order` (L1) | Magician's `check-bonus` over Arcana and Nature | Warden's training, and Magician's cantrip — the identical pair, which is what makes both a shape rather than one feature's problem |
| `sorcerer:innate-sorcery` (L1) | the pool of two uses, counted and recovered on a Long Rest | +1 to spell save DC and Advantage on spell attacks (`a-bonus-to-spell-attack-rolls`); a one-minute **printed span** rather than a turn boundary (`a-benefit-that-runs-for-a-printed-span`); and the activation itself, which needs `a-feature-that-carries-a-second-grant` because the pool already occupies the one grant slot |
| `paladin:smite` (L2) | the fixed `spells` grant — Divine Smite is on the sheet without spending a prepared slot | the free casting (`a-casting-paid-for-out-of-a-feature-pool`: the `casts` grant is item-only and `checkContent` refuses it on a feature) and the Bonus-Action-after-a-hit trigger (`a-feature-that-changes-what-a-casting-costs`) |
| `draconic-sorcery:draconic-resilience` (L3) | the unarmoured AC of 10 + Dex + Cha | +3 HP maximum rising 1 a level (`a-hit-point-maximum-a-spell-moves`) |
| `sorcerer:metamagic` (L2) | four of ten options — Distant, Extended, Quickened, Twinned — plus the one-option-per-spell limit | six options on five distinct shapes; the clause stopping a level 1+ spell later in a Quickened turn is unenforced and the engine's own one-slot-per-turn rule stands in for it |
| `fighter:fighting-style` / `paladin:` / `ranger:` (L1, L2) | Archery and Great Weapon Fighting, each a standing grant compiled at creation and read at the swing | the other two feats are *their own feats'* debt, not this feature's — which is why all three Fighting Styles carry `'table'` and appear in the no-shape list |

### The four pools with nothing to spend on — and a hole in the map

`druid:wild-shape`, `sorcerer:font-of-magic`, `wizard:arcane-recovery` and
`paladin:channel-divinity` all declare `automation: 'engine'` and carry a
`pool` grant. Because `FEATURE_BLOCKED_ON`'s population is *manual features
only*, **none of them has an entry, so none of their debt is ranked anywhere**.
Their own notes carry it:

- Wild Shape — "Becoming a Beast — the form's statistics, the hours it lasts,
  and the Bonus Action either way — is not modelled." The owner ruled all four
  open questions on 2026-09-20 (`STATUS.md:771`): gear merges, AC is always the
  block's, an oversized form is the forced-movement rule, forms are chosen at
  the start of a Long Rest. So this is briefable.
- Font of Magic — "Converting them into spell slots and back is not modelled:
  it would mint a slot the class table never printed." The `trade` grant's own
  rule ("a trade can never mint a use above a pool's maximum") is what refuses it.
- Arcane Recovery — "Choosing which slots to recover, and the half-level cap on
  their total, are the caller's."
- Channel Divinity — "What each use buys is not executed." (Turn Undead *is* a
  pool option now, per `cleric:sear-undead`'s note, so this line is narrower
  than it reads.)

This is worth saying to the owner plainly: **the map that ranks feature debt
cannot see four features whose entire point is unbuilt**, because the predicate
that selects its population is `automation === 'manual'` and these four
truthfully declare `engine` for the half they do execute.

---

## 3. Monster lines by shape, CR ≤ 5

242 of 330 carried blocks are CR ≤ 5. They print **737** lines, of which the
parser reads **407** and hands over **330**. The 407 read lines are 299 attacks,
90 Multiattacks and **18 Pack Tactics traits** — Pack Tactics is the *only*
trait kind the parser recognises (`MonsterTraitSchema`,
`packages/srd/src/schemas.ts:343`, one enum member). A further **104** of the
read attack lines carry a `rider` string nothing applies.

| Section | Printed | Read | Handed over |
|---|---|---|---|
| Traits | 194 | 18 | **176** |
| Actions | 481 | 389 | 92 |
| Bonus actions | 47 | 0 | **47** |
| Reactions | 13 | 0 | **13** |
| Legendary actions | 2 | 0 | 2 |

### The `coverage-data` predicates, restricted to CR ≤ 5

These are the six predicates at `packages/content/scripts/coverage-data.ts:862–882`
plus the legendary row at `:899`, run over handed-over lines only (the rider row
runs over read attack lines). The piles overlap and do not sum.

| Shape | Lines | Blocks | Three example blocks |
|---|---|---|---|
| An effect a hit buys (rider) | **104** | **93** | Ghoul, Hill Giant, Grick |
| A save a line forces | **73** | **60** | Basilisk (Petrifying Gaze), Hell Hound (Fire Breath), Harpy |
| A recharge | 32 | 32 | Air Elemental, Winter Wolf, Red Dragon Wyrmling |
| A use the block limits per day | 18 | 17 | Couatl (Divine Aid 2/Day), Troll, Night Hag |
| A creature that casts | 12 | 12 | Druid, Priest, Dryad |
| How many attacks the Attack action holds | 1 | 1 | Roper |
| A legendary action's own economy | 2 | 1 | Unicorn |

**Two of those rows are not debts, and the report's own prose already says so.**
`A recharge` and `A use the block limits per day` are predicates over a line's
*heading*; the accounting behind both is built. `recharge` and `perDay` are
parsed fields on every line (`FeatureSchema`, `packages/srd/src/schemas.ts:379`,
`:409`), carried onto the sheet as `StatedAttack.recharge`
(`packages/engine/src/character.ts:84`), `StatedBonusAction`
(`:121`) and `StatedAction` (`:154`); `rechargeOfLine` is asked at the turn
boundary (`packages/engine/src/commands/turns.ts:385`), `perDayTallyKey`
(`packages/engine/src/monster.ts:682`) is the dawn tally, and `takeStatedAction`
(`packages/engine/src/commands/actions.ts:464`) spends the line and refuses past
the limit. The owner ruled recharge enforced on 2026-09-20 (`STATUS.md:686`).
So 50 of the 330 handed-over lines are lines whose *effect* is unapplied while
their *economy* is already correct. That distinction should be in the brief for
any track that quotes those rows.

### The residue: 227 handed-over lines matching none of the above

**Approximation, stated.** These lines carry no parsed structure at all, so the
buckets below come from **regexes over the printed name and text** in
`node_modules/.audit/ledger-monsters.ts` (`bucketOf`), matched name-first. They
are a reading of English, not a derived column, and a reader should treat the
counts as ±1 at the boundaries. The `other` bucket is dumped in full in
`ledger-monsters.txt` so the classification can be checked by hand.

`Blocks freed` is from `ledger-freed.ts`: blocks whose *only* remaining
unapplied thing is this bucket.

| Bucket | Lines | Blocks touched | Blocks it alone frees | Three example blocks | The engine shape it needs |
|---|---|---|---|---|---|
| Movement modes and space rules | 71 | 57 | **17** | Blink Dog, Gargoyle, Xorn | `movement-modes`; `Speed` is one number and `MoveCommand` has no mode. Amorphous ("a space as narrow as 1 inch"), Air/Fire/Water Form ("enter a creature's space and stop there") and Flyby are *space* rules the lattice in `positioning.ts` does not carry |
| Amphibious / breathing | 30 | 30 | **9** | Chuul, Giant Shark, Merrow | nothing mechanical reads it today; it is the cheapest **handover** candidate in the bestiary — a fact no later rule consults, per `content.md`'s test |
| Magic Resistance / printed immunities | 17 | 13 | 0 | Barbed Devil, Dryad, Vampire Spawn | `StandingGrant` `roll-mode` (`packages/engine/src/standing.ts:304`) narrowed by `RollSelector` to saves against magic; the "against spells" narrowing is the missing half, and the Vampire's weaknesses are `a-rule-the-engine-fixes-for-everybody` |
| Shape-Shift / form change | 14 | 13 | 0 | Doppelganger, Imp, Werewolf | the same shape Wild Shape wants — a creature swapped for another block, per the 2026-09-20 ruling |
| Damage-back, object destruction, one-off casts | 13 | 13 | 0 | Black Pudding (Corrosive Form), Barbed Devil (Barbed Hide), Doppelganger (Read Thoughts) | two mechanisms: damage a hit costs the *attacker* (a reaction-shaped standing rule), and a line that simply casts a named spell (`SpellActivation`-shaped) |
| Illumination / light | 11 | 9 | 2 | Azer Sentinel, Fire Elemental, Giant Fire Beetle | Illumination is light, which the engine deliberately does not hold; **Fire Aura is not** — it is `a-standing-effect-derived-from-where-a-creature-stands` with a turn-end payout, and the `aura` scope already exists (`standing.ts:96`) |
| Parry and other Reactions | 10 | 13 (incl. rider overlap) | **5** | Bandit Captain, Knight, Warrior Veteran | `adaptMonster` carries no Reactions onto the sheet at all, and there is no spend for a printed Reaction line. `STATUS.md:496`'s "Next" item 1 names exactly this |
| Jumping | 9 | 9 | 1 | Bulette (Leap), Lion (Running Leap), Cat | `jumping` — the same shape the Jump spell and `thief:second-story-work` wait on |
| Off-combat lifecycle / GM choice | 8 | 8 | 2 | Lemure (Hellish Restoration), Commoner (Training), Flesh Golem (Berserk) | mostly handovers; Berserk's `1d6` and Draconic Origin's damage-type choice are not |
| Mimicry / speech / telepathy | 7 | 7 | 1 | Green Hag (Mimicry), Dryad, Raven | handover, except Mimicry's DC 14 Insight check, which `dm/ability_check` already takes |
| Nimble Escape (Bonus Action Disengage / Hide) | 5 | 5 | 1 | Spy (Cunning Action), Shadow (Shadow Stealth), Vampire Spawn | `ActionRule`'s `allows` member (`packages/engine/src/combat.ts:284`), which is exactly what a Rogue's Cunning Action is written through today — `hide` is a `NAMED_ACTIONS` member with a spender (`combat.ts:161`) |
| Pack-Tactics-like Advantage (unread) | 4 | 4 | 1 | Berserker (Bloodied Frenzy), Sahuagin Warrior (Blood Frenzy), Giant Boar | a second `MonsterTraitSchema` enum member plus a `StandingGrant` `roll-mode` with a `not-incapacitated`-style requirement — the machinery Pack Tactics already runs on |
| Keen Senses / perception | 4 | 4 | 0 | Gelatinous Cube (Transparent), Rust Monster (Iron Scent), Shadow (Sunlight Weakness) | `sense` StandingGrant (`standing.ts:582`) covers blindsight/darkvision/tremorsense/truesight; a *scent* and a Perception DC to notice are not senses |
| Sunlight Sensitivity | 4 | 4 | 1 | Kobold Warrior, Wight, Specter | `StandingGrant` `roll-mode` with Disadvantage, gated on a declared fact ("while in sunlight") the scene does not hold — so the grant exists and the **requirement** does not (`StandingRequirement`, `standing.ts:828–890`) |
| Grapple-on-hit / Engulf | 4 | 4 | 0 | Gelatinous Cube (Engulf), Roper, Giant Octopus | the effect-list-a-hit-buys, plus an escape DC and an ongoing hold — `HitOption` (`standing.ts:1364`) is the built half |
| Stench / aura saves | 2–3 | 3 | 1 | Hobgoblin Captain, Troglodyte, Ghast | `aura` scope plus a save raised at a turn boundary |
| Regeneration | 2 | 2 | 0 | Troll, Troll Limb | a turn-boundary payout a **creature** owes (the queue is a casting's; `turn-payout` is a `SpellEffect` and nothing hangs one off a stat block) |
| Undead Fortitude | 2 | 2 | **2** | Zombie, Ogre Zombie | a save on dropping to 0 that leaves the creature at 1 — `an-outcome-of-a-spells-own-damage` from the other end |
| other | 10 | 18 | 2 | Chuul (Sense Magic), Imp (Invisibility), Unicorn (Shimmering Shield) | mostly "the block casts a named spell on itself"; the Unicorn's two legendary actions are the legendary economy |

**Where the leverage is.** 44 of 242 blocks already carry nothing unapplied.
The riders bucket alone frees **31** more. The best pairs:

```
57  Movement modes + riders
51  A save a line forces + riders
45  riders + Amphibious
36  riders + Parry/Reactions
35  Movement modes + A save a line forces
```

Debts per block: 44 blocks carry none, 91 carry one, 55 carry two, 29 three, 19
four, 3 five, 1 six.

---

## 4. A proposed partition into builder tracks

Per WORKFLOW.md §"Choosing what goes in a batch": ranked by what a shape
*finishes* **in this ledger**, each claim checked against the code and the SRD
sentence, each track a disjoint file set, and distinct anchors where two tracks
must add to one union.

### The three unions every spell track touches, and how they are kept apart

Three files cannot be owned by one builder in a batch of ten:

1. `packages/engine/src/spell-definitions.ts:750` — the `SpellEffect` union.
2. `packages/engine/src/commands/spell-resolution.ts:1747` — `resolveOneEffect`,
   an exhaustive `switch` whose `never` default makes a missing branch a compile
   error. Cases run lines 1754–1791.
3. `packages/engine/src/spell-schema.ts:1254` — `checkEffect`, cases 1263–1684.

Plus `packages/content/src/spells.ts`, a single 13,218-line file with 329
exported definitions and one alphabetical `SPELL_DEFINITIONS` array at the end.

Every track below is given **a distinct insertion anchor in each** — a different
existing member to insert after — so the hunks are never adjacent. The anchors
are assigned in the track tables. In `spells.ts` a track's anchor is the named
export it inserts after, chosen so the tracks land in different thousand-line
neighbourhoods (section markers are at lines 1030, 1934, 2605, 3051, 3696,
5202, 5604, 6167). The chosen anchors and their current lines: `GUIDANCE`
2690, `THUNDERWAVE` 630, `FEATHER_FALL` 2231, `ELDRITCH_BLAST` 896,
`BEACON_OF_HOPE` 5270, `AID` 7982, `GOODBERRY` 7777, `SPIRIT_GUARDIANS` 4364,
`FAERIE_FIRE` 7268, `DAYLIGHT` 6900, `PLANT_GROWTH` 9594, `FLY` 3185, `JUMP`
3651, `TRUE_STRIKE` 7662, `MIRROR_IMAGE` 8163, `BLINK` 9524, `FIND_STEED`
11208 — no two adjacent.

### Batch 1 — ten tracks

**T1. The `use_budget_purchase` door.** *Files:* `packages/tools/src/definitions.ts`,
`packages/tools/src/holdings.ts`, new `packages/tools/src/budget-purchase.test.ts`.
**Verified:** `useBudgetPurchase` exists and is complete —
`packages/engine/src/commands/budget.ts:52`, exported at
`packages/engine/src/commands.ts:130`, with `budgetPurchaseSlot` (`:34`),
`BudgetPurchase` on the sheet (`packages/engine/src/character.ts:334`) and
`BudgetPurchaseGrant` in progression (`packages/engine/src/progression.ts:453`).
`fighter:action-surge` and `monk:focus` are both `automation: 'engine'` with a
`pool` grant. **No tool on either surface calls it**: `SPENT_BY`
(`packages/tools/src/holdings.ts:49`) has ten members and none is a budget
purchase, and neither `definitions.ts` nor `dm/definitions.ts` publishes one.
*Anchors:* `SPENT_BY` — insert after `'action-price'` (holdings.ts:97);
`definitions.ts` — insert after `use_pool_option` (line 2688).
`HeldFeatureKind` is `holdings.ts:135`. *The number it moves:* 2 SRD features
reachable from the surface that were not, and one more room closed in the
`rooms-with-no-door.test.ts` / `doors.test.ts` family. Justified by WORKFLOW
rule 3's exception (a guard the repository has no test for), not by a ledger
count.

**T2. Darkness, and the no-shape audit.** *Files:* `packages/content/src/spells.ts`
(insert after `DAYLIGHT`), `packages/content/scripts/missing-shapes.ts`
(delete the `BLOCKED_ON` entry; `coverageGaps().stale` will name it),
`packages/content/src/blocked-on.test.ts`. **Verified:** Darkness's entry is
four `'table'` clauses and one `'expressible'`; `blockersOf('darkness')` is
empty and `isSentenceComplete` is true. The Sphere is `SpellArea`
(`spell-definitions.ts:1558`) verbatim. *The number it moves:* 1 spell from
*no-definition* to *tracked*; 6 of the 7 undefined spells remain.
**This is the honest version of the brief's "definitions for the 7 undefined
spells": only one of the seven can be written without new engine shape.** The
other six are T11 (Find Familiar), T13 (Entangle), T14 (Magic Missile), and
Phantasmal Force / Sending / Slow, none of whose blockers appear in either
batch — Slow alone needs four shapes.

**T3. A choice made at the casting, and a bonus narrowed to a skill.**
*Files:* `packages/engine/src/spell-definitions.ts` (a `chosen*` field beside
`damageTypeStated`), `packages/engine/src/bonuses.ts`,
`packages/engine/src/commands/casting.ts`,
`packages/engine/src/commands/spell-effect-grants.ts`,
`packages/engine/src/spell-schema.ts`, `packages/content/src/spells.ts`
(anchor: after `GUIDANCE`, line 2690). **Verified:** the shape's own text names
`damageTypeStated` as the mechanism that generalised, and `SpellDefinition`
already carries it — so the pattern exists and this is a second field of the
same kind, not a new architecture. `BonusApplies` at
`packages/engine/src/bonuses.ts:54` is `'attack' | 'save' | 'ability-check' | 'ac'`,
with no skill; `RollSelector` (`packages/engine/src/roll-modifiers.ts:116–192`)
*does* carry `ability?` and `skill?`, so a **mode** can already be narrowed to a
skill and a **bonus** cannot.
**Correction to the map, found by reading Guidance's definition:** the map gives
Guidance one blocker, `a-choice-made-at-the-casting`. Its definition
(`packages/content/src/spells.ts:2690`) writes `applies: ['ability-check']`, so
even with the choice recorded the 1d4 would land on every ability check.
Guidance needs **both** shapes. That is why they are one track: splitting them
would give one builder a spell it cannot finish.
*The number it moves:* **5 spells** (Blindness/Deafness, Enhance Ability, Lesser
Restoration, Guidance, Thaumaturgy) and **1 feature** (bard:jack-of-all-trades).
Unblocks a clause each on Enlarge/Reduce, Glyph of Warding, Hex, Enthrall, Slow.

**T4. A condition benefit an effect takes away.** *Files:*
`packages/engine/src/conditions.ts`, `packages/engine/src/commands/spell-effect-conditions.ts`,
`packages/content/src/spells.ts` (anchor: after `FAERIE_FIRE`). *Union anchor:*
insert after `end-condition` (`spell-definitions.ts:1081`); dispatch anchor:
after `case 'end-condition'` (`spell-resolution.ts:1785`); validator anchor:
after `case 'end-condition'` (`spell-schema.ts:1387`).
**Verify before briefing — the map's anchor is in the wrong file.** The Faerie
Fire note says "`conditionApplicability` grants the Invisible condition its
effects wholesale". `conditionApplicability` is
`packages/engine/src/monster.ts:946` and answers whether a condition may be
applied *given a stat block's printed immunities* — nothing to do with the
Invisible condition's benefits. The real readers are in `conditions.ts`:
`initiativeConditionModes` (line 505) is the one the three notes actually
describe, and the attack-side halves are lines 275–360. A builder sent to
`monster.ts` would find nothing and stop, which is precisely the failure
WORKFLOW rule 1's corollary records. *The number it moves:* **3 spells**
(Starry Wisp, Faerie Fire, Mind Spike); leaves Shining Smite one blocker short.

**T5. Forced movement, and falling.** *Files:* new
`packages/engine/src/commands/spell-effect-movement.ts`,
`packages/engine/src/commands/movement.ts` (read), `packages/content/src/spells.ts`
(anchors: after `THUNDERWAVE`, line 630, and after `FEATHER_FALL`). *Union
anchor:* insert after `teleport` (`spell-definitions.ts:1522`, the last member);
dispatch after `case 'teleport'` (`spell-resolution.ts:1791`); validator after
`case 'teleport'` (`spell-schema.ts:1537`). **Verified:** `MoveCommand.forced`
is `packages/engine/src/commands/movement.ts:58`, read at lines 269, 308, 321
and 379 (a forced move provokes nothing); `moveCreature` is the function.
`declareFalling` already reaches a tool (`declare_falling`,
`packages/tools/src/definitions.ts:1615`) and `packages/engine/src/falling.test.ts`
exists, so falling is *partly* built — **check what `falling` still means before
briefing it.** *The number it moves:* **3 spells** (Thunderwave, Levitate,
Feather Fall) and **1 feature** (monk:slow-fall); unblocks Open Hand
Technique's Push and a share of the monster push riders.

**T6. Several attack rolls from one casting.** *Files:*
`packages/engine/src/commands/spell-effect-rolls.ts`,
`packages/engine/src/spell-definitions.ts` (a count on the existing `attack`
member, line 761 — **not** a new union member), `packages/content/src/spells.ts`
(anchor: after `ELDRITCH_BLAST`, line 896). *Validator anchor:* inside
`case 'attack'` (`spell-schema.ts:1263`). *The number it moves:* **2 spells**
(Scorching Ray, Eldritch Blast); leaves Chromatic Orb one blocker short.

**T7. Healing modified by an effect, and a hit point maximum that moves.**
*Files:* `packages/engine/src/vitals.ts`,
`packages/engine/src/commands/spell-effect-hit-points.ts`,
`packages/engine/src/commands/creatures.ts`, `packages/content/src/spells.ts`
(anchors: after `BEACON_OF_HOPE` and after `AID`). *Union anchor:* insert after
`turn-payout` (`spell-definitions.ts:964`); dispatch after
`case 'turn-payout'` (`spell-resolution.ts:1777`); validator after
`case 'turn-payout'` (`spell-schema.ts:1447`). **Verified:** `heal` is
`packages/engine/src/vitals.ts:210` and `healCreature` is
`packages/engine/src/commands/creatures.ts:557`; nothing stands beside either to
forbid or maximise. The shape's prose names `healCreature`, which exists — good
anchor. *The number it moves:* **3 spells** (Beacon of Hope, Chill Touch, Aid)
and **1 feature** (draconic-sorcery:draconic-resilience).

**T8. What a creature is holding.** *Files:*
`packages/engine/src/commands/inventory.ts`, `packages/engine/src/character.ts`
(the equipped set), `packages/content/src/spells.ts` (anchor: after
`GOODBERRY`). **Verified:** `docs/design/characters-and-equipment.md` says
"Nothing checks that two hands are free, either." *The number it moves:*
**2 spells** (Goodberry, Flame Blade); leaves Heat Metal and Fear one blocker
short each.

**T9. A standing effect derived from where a creature stands.** *Files:*
`packages/engine/src/standing.ts`, `packages/engine/src/commands/spell-effect-grants.ts`,
`packages/content/src/spells.ts` (anchor: after `SPIRIT_GUARDIANS`).
**Verify before briefing — this may be half-built.** `StandingScope` already
has `{ kind: 'aura'; feet: number }` at `packages/engine/src/standing.ts:96`,
which is the geometry half the shape's prose describes as missing ("every
Paladin aura"). The brief should start by establishing what `aura` does *not*
reach today. *The number it moves:* **2 spells** (Zone of Truth, Spirit
Guardians); overlaps the monster Fire Aura / Stench buckets (3 blocks).

**T10. An effect a hit buys — the monster rider vocabulary.** *Files:*
`packages/srd/src/schemas.ts` (a structured rider beside `MonsterAttackSchema`),
the rider parser under `packages/srd/`, `packages/engine/src/monster.ts`,
`packages/engine/src/character.ts` (`StatedAttack`, line 84),
`packages/engine/src/commands/attacks.ts`. **Verified:** the rider is already
carried as a verbatim string (`attack.rider`), so the corpus is in hand and
nothing needs re-ingesting; `HitOption` (`packages/engine/src/standing.ts:1364`)
and `packages/engine/src/commands/hit-riders.ts` are the built mechanism on the
character side ("a feature's effect list can be bought by a hit now, which is
how Stunning Strike rides on one"). *The number it moves:* **31 CR ≤ 5 blocks
freed outright** (44 → 75 before T9's auras), across 104 lines on 93 blocks —
the single largest mover anywhere in this ledger. Ghoul, Hill Giant, Grick,
Ettin, Griffon, Dire Wolf, Worg, Stirge and 23 more become blocks with nothing
unapplied.

**Batch 1 totals:** 20 of the 89 spells finished; 1 new definition; 3 of the 21
features finished; 2 features made reachable; CR ≤ 5 clean blocks 44 → **77**.

### Batch 2 — ten tracks

**T11. A stat block created mid-fight — the `summon` effect.** *Ruling needed.*
*Files:* `packages/engine/src/spell-definitions.ts`,
`packages/engine/src/commands/spell-effect-*.ts` (new module),
`packages/engine/src/commands/creatures.ts` (read), `packages/content/src/spells.ts`
(anchor: after `FIND_STEED`). *Union anchor:* insert after `dispel`
(`spell-definitions.ts:1241`). **Verified, and smaller than the map implies:**
`summonCreature` (`commands/creatures.ts:269`), `creature-summoned`
(`events.ts:593`), `SummonBond` (`state.ts:281`), `summon_creature` and
`dismiss_stranded_summons` tools all exist. Missing: a definition-side member.
*Ruling:* (a) Find Familiar's familiar — is it a bestiary block chosen at the
casting, or a new content kind (the SRD prints eleven forms and "any Beast of
CR 0", and the engine holds no CR predicate)? (b) Find Steed's Otherworldly
Steed and Phantom Steed's mount are printed **inside the spell entry**, not in
the bestiary — does a spell definition get to carry a block, or does the
catalogue gain those entries? *The number it moves:* **2 spells** (Find Steed,
Phantom Steed); unblocks Unseen Servant, Find Familiar and
`druid:wild-companion`.

**T12. Difficult terrain an area creates, and an area that filters its catch.**
*Files:* `packages/engine/src/commands/movement.ts`,
`packages/engine/src/positioning.ts`, `packages/engine/src/fold/areas.ts`,
`packages/content/src/spells.ts` (anchors: after `PLANT_GROWTH` and after
`ENTANGLE`'s alphabetical slot). **Verified:** `MoveCommand.difficultFeet` is
`packages/engine/src/commands/movement.ts:74`, charged at line 238 — declared by
the foot, with no path for an area to be consulted against. CLAUDE.md names the
same gap. *The number it moves:* **3 spells** (Plant Growth, Grease, and
**Entangle**, which becomes writable once both halves land) plus Gust of Wind
with T17; also frees the Gibbering Mouther's Aberrant Ground line.

**T13. Movement modes and jumping.** *Ruling needed.* *Files:*
`packages/engine/src/positioning.ts`, `packages/engine/src/character.ts` (Speed),
`packages/engine/src/commands/movement.ts`, `packages/engine/src/monster.ts`,
`packages/content/src/spells.ts` (anchors: after `FLY` and after `JUMP`).
*Ruling:* the shape's stated authority is
`docs/design/spell-definitions.md` — **that file no longer exists**; it is
`docs/archive/design/spell-definitions.md:1799`, and CLAUDE.md says archive is
never cited as current. The refusal ("Movement modes are refused outright…a
vocabulary for them would be shape built ahead of every mechanic that could use
it") was written when nothing asked. This ledger is the thing that asks: **2
spells, 1 feature and 26 CR ≤ 5 blocks**. The owner should re-affirm or reverse
it. *The number it moves:* **3 spells** (Spider Climb, Fly, Jump), **1 feature**
(thief:second-story-work, which needs both halves), and **26 CR ≤ 5 blocks
freed** (17 movement + 9 amphibious) — second only to T10.

**T14. Damage with no roll, and one effect list divided among targets.**
*Files:* `packages/engine/src/spell-definitions.ts`,
`packages/engine/src/commands/spell-effect-rolls.ts`,
`packages/content/src/spells.ts` (anchor: after `MAGIC_MISSILE`'s slot).
*Union anchor:* insert after `save-damage` (`spell-definitions.ts:816`);
dispatch after `case 'save-damage'` (`spell-resolution.ts:1779`); validator
after `case 'save-damage'` (`spell-schema.ts:1270`). *The number it moves:*
**2 spells** — Shield finishes on the first shape alone, Magic Missile needs
both and becomes the second new definition.

**T15. A rider on a later weapon attack, and a bonus an ability modifier sizes.**
*Files:* `packages/engine/src/standing.ts` (the `attack-rider` grant and a
`flat-bonus` sibling), `packages/engine/src/attack.ts`,
`packages/content/src/spells.ts` (anchor: after `TRUE_STRIKE`).
**Verified:** the extra-damage half is built (`attack-rider`,
`spell-definitions.ts:1473`); what is left per the shape's own text is a
substituted ability and a replaced damage die, which is exactly what True Strike
and Shillelagh print. *The number it moves:* **2 spells** (True Strike,
Shillelagh) + Alter Self with T13, and **1 feature**
(oath-of-devotion:sacred-weapon).

**T16. Senses beyond declared sight.** *Files:*
`packages/engine/src/standing.ts` (`SENSES_THAT_SOMEHOW_SEE`, line 2360),
`packages/engine/src/positioning.ts` (`SENSE_NAMES`, line 1782),
`packages/engine/src/attack.ts`, `packages/content/src/spells.ts` (anchor: after
`MIRROR_IMAGE`). **Verified and already ruled:** the owner settled the
governing question on 2026-09-20 (`STATUS.md:754`) — "Truesight and Blindsight
satisfy 'if a creature can somehow see you'; Darkvision does not", and "the set
belongs beside `canSee`, not inside the attack route". `sensesOf`
(`standing.ts:2284`) and `canSee` are exported. What is missing is reading the
**attacker's** senses at the moment a spell's protection is applied. *The number
it moves:* **2 spells** (Mirror Image, Blur); unblocks a Find Familiar clause.

**T17. A random outcome that is not a d20.** *Files:*
`packages/engine/src/dice.ts`, `packages/engine/src/commands/spell-effect-rolls.ts`,
`packages/content/src/spells.ts` (anchor: after `BLINK`). *Union anchor:*
insert after `interrupt-casting` (`spell-definitions.ts:1497`). **Verified:**
the generator and `parseNotation` exist; no `SpellEffect` asks for a non-d20
throw. *The number it moves:* **2 spells** (Augury, Blink) + Gust of Wind with
T12; unblocks a clause each on Sending and Slow.

**T18. A save a line forces — monster breath weapons and gazes.** *Files:*
the monster parser under `packages/srd/`, `packages/srd/src/schemas.ts`,
`packages/engine/src/monster.ts`, `packages/engine/src/commands/actions.ts`
(`takeStatedAction`, line 464). **Verified:** the SRD's form is highly regular —
`_Dexterity Saving Throw:_ DC 12, each creature in a 15-foot Cone. _Failure:_
17 (5d6) Fire damage. _Success:_ Half damage.` — and the *economy* around these
lines is already built (recharge, per-day, the spend). Only the effect is
missing. *The number it moves:* **14 CR ≤ 5 blocks freed**, 73 lines on 60
blocks, including every dragon wyrmling in reach, the Basilisk, the Hell Hound
and the Harpy.

**T19. Printed Reactions on a stat block.** *Files:*
`packages/engine/src/monster.ts` (`adaptMonster`, line 805),
`packages/engine/src/character.ts` (a `StatedReaction` beside `StatedAction`,
line 154), `packages/engine/src/commands/reactions.ts`,
`packages/tools/src/dm/definitions.ts` (a `take_printed_reaction` beside
`take_printed_bonus_action`, line 1021). **Verified:** `adaptMonster` carries no
Reactions onto the sheet at all — the Reactions column is 13 printed, 0 read —
and `STATUS.md:496` item 1 names this as an open carrier. *The number it moves:*
**5 CR ≤ 5 blocks freed** (Bandit Captain, Knight, Noble, Warrior Veteran,
Shrieker Fungus); 13 lines.

**T20. An option re-chosen on a rest, and a feature that rewrites another's
rule.** *Files:* `packages/engine/src/rest.ts`,
`packages/engine/src/progression.ts`, `packages/engine/src/commands/features.ts`,
`packages/content/src/classes/druid.ts`, `packages/content/src/classes/wizard.ts`,
`packages/content/src/classes/cleric.ts`. **Verified:** a `FeatureChoice` is
answered once at creation and frozen into the sheet; the design note names
Circle of the Land as the shape's first consumer and every "swap a prepared
spell on a rest" rule as its second. *The number it moves:* **3 features**
(circle-of-the-land:spells, wizard:memorize-spell, cleric:sear-undead).

**Batch 2 totals:** 20 more spells finished (40 of 89), 2 more new definitions
(3 of 7), 6 more features finished (9 of 21), CR ≤ 5 clean blocks 77 → **166**.

### Tracks flagged for an owner ruling before they can be briefed

| Track | The question |
|---|---|
| **T13 movement modes** | The refusal's authority is a frozen archive file. Does "Fly, Climb and Swim have no reader" still hold when 2 spells, 1 feature and 26 stat blocks ask? |
| **T11 summons** | How is Find Familiar's familiar represented — a bestiary id chosen at the casting, or a new content kind with a CR predicate? And do Find Steed / Phantom Steed's spell-internal stat blocks become catalogue entries? |
| **T2 Darkness (soft)** | Darkness lands as *tracked* with its obscurement handed over. If the owner wants obscurement to mean something to the sight model, that is a different and much larger track — `sightBetween` is explicit that the engine holds no Bright, Dim or Darkness. |
| **Wild Shape** | **Already ruled** (`STATUS.md:771`, 2026-09-20): gear merges, AC is always the block's, an oversized form is the forced-movement rule, forms are chosen at the start of a Long Rest, and Wild Companion's familiar goes away when a Long Rest completes. No ruling outstanding; it needs a *track*, and T11 plus T13's Shape-Shift work are its prerequisites. It is not in either batch. |
| **The four unranked pools** | `FEATURE_BLOCKED_ON`'s population predicate hides Wild Shape, Font of Magic, Arcane Recovery and Channel Divinity from the feature blocker map. Does the owner want the map widened to cover a feature that executes its pool and nothing else? |

### What is left after both batches

**Spells — 49 of the 89 still name a shape.** Heaviest, by spells in reach
touched: `an-action-a-spell-compels-or-forbids` (7),
`a-casting-ended-by-a-trigger` (6), `a-repeat-save-that-does-something-on-a-failure`
(4), `a-check-another-creature-may-attempt` (3),
`a-fact-only-the-table-can-declare` (3).

**`an-action-a-spell-compels-or-forbids` is not one shape and must not be
briefed as one.** Its own description in `missing-shapes.ts` says the catalogue
already writes three of the four things the id was named for, and reading its
three finishers confirms they are three different mechanisms: Shocking Grasp
wants a `RiderDuration` member for "the start of the **target's** next turn"
(`Duration` underneath already has `start-of-next-turn`, so this is content
vocabulary plus readers); Dissonant Whispers wants a spell to spend **somebody
else's** budget, which `packages/engine/src/combat.ts` refuses by name on
purpose; and Command wants a rule that spends a creature's whole next turn.
Whoever briefs this should split it first, exactly as `SPLIT_BUNDLES`
(`missing-shapes.ts:323`) records was done for two earlier bundles.

**Features — 12 of the 21 still name a shape**, concentrated in
`sorcerer:metamagic` (5 shapes), `open-hand:technique` (4),
`rogue:cunning-strike` (3), `cleric:divine-order` / `druid:primal-order` (the
same 2 apiece), `sorcerer:innate-sorcery` (3), `paladin:smite` (2),
`fiend-patron:dark-ones-blessing` (2), `druid:wild-companion` (2),
`thief:fast-hands`, `warlock:eldritch-invocations`, `wizard:ritual-adept`.

**Monsters — 76 of 242 CR ≤ 5 blocks still carry something unapplied**, in this
order: `other` (18), damage-back (13), Magic Resistance / printed immunities
(13), Shape-Shift (13), Spellcasting (12), light (9), lifecycle (8), mimicry
(7), Nimble Escape (5), Advantage (4), senses (4), Sunlight Sensitivity (4),
grapple (4), Regeneration (2), Undead Fortitude (2), Multiattack (1). Of those,
Nimble Escape, Sunlight Sensitivity and the unread Advantage traits are the
cheapest — all three are `StandingGrant` members that exist (`action-rule` at
`standing.ts:527`, `roll-mode` at `:304`) waiting on a second
`MonsterTraitSchema` enum member and, for Sunlight Sensitivity, a
`StandingRequirement` the scene cannot yet declare.

---

## Appendix — anchors cited

| Anchor | Where |
|---|---|
| `MISSING_SHAPES` / `ADJUDICATED` / `TRACKED_ADJUDICATED` / `BLOCKED_ON` | `packages/content/scripts/missing-shapes.ts:95`, `:472`, `:1282`, `:3775` |
| `blockersIn` / `blockersOf` / `consumersOf` / `allShapeConsumers` | same file `:4441`, `:4455`, `:4774`, `:4818` |
| `FEATURE_SHAPES` / `FEATURE_BLOCKED_ON` / `featureBlockersOf` / `featureConsumersOf` | `packages/content/scripts/missing-feature-shapes.ts:88`, `:222`, `:1536`, `:1597` |
| `PARTIAL_SPELLS` / `EXECUTED_SPELL_IDS` / `TRACKED_IDS` / `isExecutedFeature` | `packages/content/scripts/coverage-data.ts:137`, `:305`, `:309`, `:340` |
| monster shape predicates / legendary row | `packages/content/scripts/coverage-data.ts:862–882`, `:899` |
| report tables (spells / features / items / monsters) | `packages/content/scripts/coverage.ts:735`, `:141`, `:398`, `:547` |
| `SpellEffect` union | `packages/engine/src/spell-definitions.ts:750` |
| `resolveOneEffect` dispatch | `packages/engine/src/commands/spell-resolution.ts:1747` |
| `checkEffect` validator | `packages/engine/src/spell-schema.ts:1254` |
| `BonusApplies` / `StandingBonusApplies` | `packages/engine/src/bonuses.ts:54`, `:86` |
| `RollSelector` (`ability`, `skill`, `counterpart`, `oneShot`) | `packages/engine/src/roll-modifiers.ts:116`, `:146`, `:154`, `:186`, `:225` |
| `ActionRule` / `NAMED_ACTIONS` | `packages/engine/src/combat.ts:284`, `:161` |
| `StandingGrant` (aura scope, roll-mode, action-rule, sense, speed) | `packages/engine/src/standing.ts:96`, `:304`, `:527`, `:582`, `:561` |
| `ActivatedFeature` / `PoolOption` / `HitOption` | `packages/engine/src/standing.ts:1034`, `:1144`, `:1364` |
| `MoveCommand.forced` / `.difficultFeet` | `packages/engine/src/commands/movement.ts:58`, `:74` |
| `heal` / `healCreature` | `packages/engine/src/vitals.ts:210`, `packages/engine/src/commands/creatures.ts:557` |
| `summonCreature` / `creature-summoned` / `SummonBond` | `packages/engine/src/commands/creatures.ts:269`, `packages/engine/src/events.ts:593`, `packages/engine/src/state.ts:281` |
| `useBudgetPurchase` / `BudgetPurchase` / `BudgetPurchaseGrant` | `packages/engine/src/commands/budget.ts:52`, `packages/engine/src/character.ts:334`, `packages/engine/src/progression.ts:453` |
| `StatedAttack` / `StatedBonusAction` / `StatedAction` / `StatedValues` | `packages/engine/src/character.ts:84`, `:121`, `:154`, `:207` |
| `adaptMonster` / `conditionApplicability` / `statedBonusActionOf` / `perDayTallyKey` | `packages/engine/src/monster.ts:805`, `:946`, `:607`, `:682` |
| `takeStatedAction` / `rechargeOfLine` | `packages/engine/src/commands/actions.ts:464`, `packages/engine/src/commands/turns.ts:385` |
| `MonsterTraitSchema` / `FeatureSchema` (`recharge`, `perDay`) | `packages/srd/src/schemas.ts:343`, `:361`, `:379`, `:409` |
| `sightBetween` / `SENSE_NAMES` / `sensesOf` / `SENSES_THAT_SOMEHOW_SEE` | `packages/engine/src/positioning.ts:1875`, `:1782`, `packages/engine/src/standing.ts:2284`, `:2360` |
| `SPENT_BY` / `HeldFeatureKind` / `holdingsOf` | `packages/tools/src/holdings.ts:49`, `:135`, `:563` |
| `summon_creature` / `use_pool_option` / `take_printed_bonus_action` | `packages/tools/src/definitions.ts:979`, `:2688`, `packages/tools/src/dm/definitions.ts:1021` |
| the owner's rulings of 2026-09-20 | `STATUS.md:630`, `:686`, `:753`, `:771` |
| the open carriers "Next" list | `STATUS.md:496` |
| "Text the DM decides, and how to tell it from a debt" | `docs/design/content.md:88` |
