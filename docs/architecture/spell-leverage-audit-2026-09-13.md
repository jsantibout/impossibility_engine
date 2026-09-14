# The SRD surface as a compression problem — a bounded leverage audit

**2026-09-13.** Measured against `main` at `652385a`, with tranche 3 in
flight (IE-001 and IE-009 building, IE-007 held).

The owner's instruction: stop treating the remaining SRD surface as a
spell-by-spell implementation problem and treat it as a leverage problem.
The optimisation target is **verified rules coverage per unit of new engine
complexity**, not raw spell count.

This is a change to the foreman's planning objective. It changes no
authority and no process: the foreman → builder → independent review loop,
the thirteen merge conditions, the bounded extra review pass, the escalation
levels and foreman-owned rebases are all untouched.

## Why this audit was cheap

Almost none of the evidence below was gathered for it. IE-004's honesty
guard (`0536a2b`) forced every executed spell's `unmodelled` clause to be
adjudicated either to *the table* or to a **named missing shape**, and
derived `PARTIAL_SPELLS` from that adjudication. The vocabulary it built —
27 shapes, each with a written description and the prose that cites it — is
a machine-readable record of exactly what this audit asks for. IE-002 then
read all 211 undefined spells one at a time and named the blocker for each.

So the numbers here are **derived, not estimated**. The one thing that is a
judgement rather than a measurement is the ranking in section F, and that is
flagged where it sits.

## A. Recurring effect families found

Counted two ways, because the engine has two populations with different
evidence.

**Spells already executed, whose own clauses name a missing shape** — from
`MISSING_SHAPES` and `ADJUDICATED` in `spell-honesty.test.ts` and
`spell-tracking.test.ts`, counted by distinct spell:

| Consumers | Family |
|---|---|
| 8 | an action a spell compels or forbids |
| 8 | a repeat save beyond the turn hook |
| 7 | a casting ended by a trigger |
| 6 | a mode on the save a spell forces |
| 5 | outcome-scoped child effects |
| 5 | Difficult Terrain an area creates |
| 4 | a duration the slot changes |
| 3 | an outcome that varies by creature type |
| 3 | a choice made at the casting |
| 3 | what a creature is holding |
| 2 | healing modified by an effect |
| 2 | targeting rules that differ within one casting |
| 2 | an area that moves by itself |
| 2 | a one-shot roll modifier |
| 2 | a condition benefit an effect takes away |
| 1 each | twelve more, listed in `MISSING_SHAPES` |

**Class features the engine records and does not execute** — 143 `manual`
notes across twelve classes and the origin feats, bucketed by the mechanic
the note names:

| Notes | Family | Classes |
|---|---|---|
| 12 | a modifier on a named roll | barbarian bard fighter paladin ranger rogue sorcerer |
| 9 | a Speed or movement mode an effect changes | barbarian fighter monk ranger rogue sorcerer |
| 7 | a condition applied or removed | barbarian bard monk ranger sorcerer |
| 5 | a Resistance or Immunity an effect grants | barbarian monk ranger sorcerer |
| 3 | a grant re-chosen on a rest | druid fighter wizard |
| 3 | forced movement | fighter monk |
| 3 | a Reaction or interrupt | bard paladin ranger |
| 2 | an aura / a value derived from position | barbarian bard |
| 2 | Temporary Hit Points | ranger warlock |
| 2 | a damage type chosen when used | druid sorcerer |
| 2 | a one-shot modifier consumed by a roll | fighter rogue |
| 1 | an AC calculation an effect replaces | sorcerer |
| 1 | a Hit Point maximum moved | sorcerer |

**The two lists overlap, and that overlap is the finding.** Four families
appear in both populations with three or more consumers on each side. Those
are the primitives with genuine cross-system reuse, and they are not the
families with the largest spell-only counts.

## B. Existing primitives that already support composition

The engine is further along this path than the spell counts suggest. Eleven
effect kinds — `attack`, `save-damage`, `save`, `heal`, `temp-hp`, `buff`,
`roll-mode`, `armor-class`, `attack-damage`, `dispel`, `interrupt-casting` —
and beneath them a composition vocabulary that is already substantial:

| Piece | Where |
|---|---|
| trigger | `ReactionTrigger`; `AreaTrigger` (`at`, `onEntry`, `oncePerTurn`, `onAreaMove`) |
| targeting / area | `TargetRule`, `SpellArea` (all six SRD shapes), `targetsWithin`, `AreaPoint` anchoring |
| attack / check / save | `resolveAttack`, `rollAbilityCheck`, `rollSavingThrow`, `SpellCheck` |
| success and failure branches | `onSuccess: 'half' \| 'none'` on `save-damage`; `onSuccess` on `RepeatSave` and `SpellCheck` |
| damage | typed `DamageComponent`s, `DiceScaling`, `plus`, crit rules, resistance ordering |
| healing | `healCreature`, capped, modifier-aware |
| conditions | `ConditionInstance` with sources and implication closure |
| movement | `moveCreature` including `forced: true` |
| temporary modifiers | `Bonus` with `source`; `GrantedArmorClass`; `RollModifier` with a four-field `RollSelector` |
| durations / deadlines | `Duration` → `Deadline`, elapsed and turn-anchored, derived expiry |
| repeat saves | `RepeatSave` on a timer, raised by the turn boundary into `pendingSaves` |
| concentration | derived loss, per-casting cleanup, one casting at a time |
| resource consumption | named pools, slots, feature pools, free castings |
| persistent state | `OngoingSpell` with pinned numbers, an origin point or a carrier |
| delayed effects | `DelayedDamage` on `attack` and `save-damage` |
| cleanup / removal | `releaseCasting` / `releaseOnTarget`, one door |
| entity creation | **absent** |
| zones | `OngoingSpell.origin` + `AreaTrigger`; four moments detected |

**The gap is not the vocabulary's size. It is its uniformity.** A condition
rider is spelled three times (on `attack`, on `save-damage`, and as the
`save` kind itself), `delayed` twice, `check` three times. IE-001 is in
flight to make the first of those one shared `ConditionRider` with four
consumers — which is this audit's thesis already being executed, one family
at a time.

## C. Missing primitives blocking composition, and D. their consumers

Ordered by the evidence rather than by appeal.

### C1 — A Resistance, Immunity or Vulnerability an effect grants

**Blocked because:** defences are real and reach damage — `adaptMonster`
produces them, `CreatureState` carries them, `applyDamage` orders them
correctly against adjustments. What does not exist is an **effect that grants
one**, with a source and a deadline.

**Consumers:** spells — Stoneskin, Protection from Energy, Protection from
Poison, Absorb Elements; features — Rage's damage resistance (Barbarian),
Fiendish Resilience (Warlock), Superior Hunter's Defense (Ranger), Monk
defences, Draconic Resilience (Sorcerer). **Five feature notes and four
spells: nine concrete consumers.**

**Why it is cheap:** three precedents already store exactly this shape — a
sourced, casting-linked, expiring grant on `CreatureState`: `bonuses`
(`bonus-applied`), `GrantedArmorClass` (`armor-class-granted`), and
`rollModifiers` (`roll-modifier-granted`). `releaseCasting` and
`releaseOnTarget` already end all three through one door. A fourth is a
transcription of a pattern with three users, not a new idea.

### C2 — A roll modifier that is one-shot, and one that selects the save a casting forces

**Blocked because:** `RollSelector` selects by roll family, relation,
ability and skill — a *durable* grant that lasts until its casting ends.
Two things it cannot say: **"the next roll"** (a modifier consumed by the
roll it changes) and **"the saving throw this casting calls for"**
(`CLAUDE.md`: *"nothing records what a save was against"*).

**Consumers:** one-shot — Guiding Bolt, Vicious Mockery, Ray of Enfeeblement,
plus two feature notes (Fighter, Rogue); the-save-this-casting-forces —
Charm Person, Charm Monster, Dominate Person, Dominate Beast, Dominate
Monster, Shatter, and the class feature Countercharm, which `CLAUDE.md` has
recorded as blocked on this exact sentence since it was written. **Six spells
and one feature for the second; five for the first.**

Add the twelve feature notes in the "modifier on a named roll" family, most
of which want a selector that already exists and an execution path that does
not, and this is the **largest cross-system family in the audit**.

### C3 — A Speed, and movement modes

**Blocked because:** the engine holds one `baseSpeed` and nothing modifies
it. Fly, Climb and Swim are not distinguished at all.

**Consumers:** spells — Longstrider, Expeditious Retreat, Haste, Slow, Fly,
Spider Climb, Water Walk, Ray of Frost (already executed and partial on
exactly this clause), Spirit Guardians' halved Speed; features — nine notes
across six classes. **Fifteen-plus concrete consumers.**

**Cost caveat:** Spirit Guardians' half wants a Speed *derived from where the
creature is standing*, which is a different and harder shape (C7). The flat
grant is the cheap 80%.

### C4 — Outcome-scoped child effects

**Blocked because deliberately deferred**, with the reason recorded: a naive
`onFail: SpellEffect[]` lets an author nest a saving throw inside a saving
throw, which is the definition format becoming an untyped program. It needs
a **restricted child vocabulary**, and the decision record said the evidence
for its members would come from the next two families.

**Consumers:** executed and partial — Acid Arrow, Disintegrate, Hypnotic
Pattern, Phantasmal Killer, Sunburst; undefined — Ice Knife, Hideous
Laughter, Sleet Storm, Chromatic Orb's family. **Eight-plus**, and it is the
one primitive that makes most of the rest *compose* rather than each needing
its own kind.

**This is the highest-leverage item in the audit and the highest-risk**, and
it is the one the workflow says is not the foreman's to design.

### C5 — Condition removal, and healing an effect modifies

**Consumers:** Lesser Restoration, Greater Restoration, Heal, Protection
from Poison, Beacon of Hope (maximised healing), Chill Touch ("can't regain
Hit Points"), plus seven feature notes in the condition family.
`removeConditionInstance` already exists and is called by the reducer.

### C6 — A casting ended by a trigger

**Consumers:** Charm Person, Charm Monster, Animal Friendship, Suggestion,
Mass Suggestion, Hypnotic Pattern, Mage Armor. **Seven.** The facts are
already held — `CreatureState.lastDamage` names the dealer, `side` is
declared — and nothing hangs an ending on them.

### C7 — A standing effect derived from where a creature stands

**Consumers:** Spirit Guardians' halved Speed, every Paladin aura, two
feature notes. Genuinely harder: a value derived from current state *and*
current geometry, rather than a pair of enter/leave events that must stay
matched. `CLAUDE.md` already says why the event-pair version is wrong.

## E. Truly bespoke, and why

Three families where composition would distort the rules rather than
express them.

**An action a spell compels or forbids** (8 consumers — Dominate*, Command,
Compulsion, Fear, Befuddlement, Dissonant Whispers, Shocking Grasp). This
has the largest raw count in the audit and it is **not** a rider. Dominate
Person is one creature spending another creature's action economy, which
means an actor that is not the creature whose turn it is — an authority
question, not an effect question. `mayAct` guards every spender on the
premise that a creature acts for itself. Shocking Grasp's "can't take
Reactions" is a narrower slice of the same thing and is the one piece that
might be a condition-like grant; the rest is a subsystem.

**Summons / a stat block created mid-fight** (9 parsed spells, 0 executed).
Creating a creature is `createCharacter`'s job and a summon has no
`CharacterChoices`; it needs a second construction path, an owner
relationship, an action economy of its own, and cleanup when the casting
ends. Nothing about it composes from the effect vocabulary.

**A second place to put a creature** (Banishment, Plane Shift, Word of
Recall). `state.scene` is a single `PositionState | null`. This is the
doctrine's own multiple-scenes seam and is a world-model change, not an
effect.

## F. Ranked candidates by leverage

`coverage unlocked × gameplay relevance × cross-system reuse ÷ cost`.
**The counts are measured; the ranking is a judgement**, and where it is
YELLOW it says so.

| Rank | Primitive | Consumers (spell + feature) | Cost | Reuse beyond spells | Level |
|---|---|---|---|---|---|
| 1 | **A granted Resistance / Immunity / Vulnerability** | 4 + 5 | **Low** — a fourth instance of a storage pattern with three existing users and one shared cleanup door | monsters, items, traps, hazards, homebrew | GREEN |
| 2 | **One-shot roll modifier, and a selector for the save a casting forces** | 11 + 14 | **Low–medium** — extends `RollSelector`, which already has the relation axis; the consumption half is new | monsters, items, features, traps | GREEN for the selector, **YELLOW for consumption semantics** |
| 3 | **A granted Speed and movement modes** | 9 + 9 | **Medium** — a derived Speed beside the derived AC, same pattern; modes are new vocabulary | monsters, items, environment | GREEN for the flat grant |
| 4 | **Condition removal and modified healing** | 6 + 7 | **Low** — `removeConditionInstance` exists and is reached only by the reducer | features, items, monsters | GREEN |
| 5 | **Outcome-scoped child effects** | 8+ | **High** — needs a restricted child vocabulary, and gets the definition format wrong if rushed | every future effect family | **YELLOW — Fable's** |
| 6 | **A casting ended by a trigger** | 7 + 0 | Medium | monsters, traps | YELLOW |
| 7 | **A standing effect derived from position** | 2 + 2 | High | auras everywhere | YELLOW |
| — | An action compelled or forbidden | 8 | Very high | — | **Bespoke, RED** |
| — | Summons | 9 | Very high | — | **Bespoke, RED** |

## G. Estimated coverage after each candidate

Stated as **verified-capable** spells and features — what becomes
*expressible*, which is not the same as implemented, and the distinction is
the point of the leverage report in section H.

| After | Spells newly expressible | Features newly expressible | Partial spells made whole |
|---|---|---|---|
| C1 Resistance grant | ~4 | ~5 | 0 |
| C2 roll modifier (both halves) | ~5 | ~12 | 8 |
| C3 Speed grant | ~8 | ~9 | 1 |
| C5 condition removal / healing | ~5 | ~7 | 2 |
| C4 child effects | ~12 | — | ~5 |

These are the families' own consumer counts, not a projection. The
partial-spells column matters more than it looks: a partial spell is
**already executed and already wrong in a named way**, so closing one buys
fidelity on a spell players are already casting.

## I. Risks of over-abstraction

- **A universal rules DSL is not justified by this evidence and must not be
  built.** Every family above is a closed union with named members and named
  consumers. The moment a member takes an expression, a predicate or a
  callback, the definition format has become a program and the engine has
  moved rules authority into the data layer. The existing `RollSelector` is
  the model: four fields, all closed unions, no escape hatch, and a
  definition that cannot be said in it is an honest "not built yet".
- **Two consumers justify investigation; three support a primitive.** C1, C2,
  C3 and C5 all clear three on both populations. Nothing below three appears
  in the recommendation.
- **The `origin: 'self' | 'point'` precedent is the shape to copy** — one
  optional field, derived from facts already held, rather than a new identity.
- **The recurring failure here is the opposite of over-abstraction.** This
  repository has now recorded **eleven** instances of a pure function nothing
  calls — a rule implemented, tested and unreachable. C1 and C5 are both
  partly that: the arithmetic exists, the command does not.

## J. Current implementation duplicating what should compose

- **The condition rider is spelled three times** — on `attack`, on
  `save-damage`, and as the `save` kind. **IE-001 is fixing exactly this**,
  with one `ConditionRider` and four consumers.
- **`delayed` is spelled twice** and **`check` three times**, on the same
  members, by the same argument, and nobody has made it. These are IE-001's
  pattern with the work not yet done.
- **`hitDicePools` (`multiclass.ts:142`) is correct, tested against both SRD
  worked examples, and called by nothing**, while `poolsFor` declares one Hit
  Die pool from the starting class. Found by IE-008; in `LATER`.
- **Defences are computed and never granted**; **`moveCreature` takes
  `forced: true` and no effect reaches it**; **`removeConditionInstance` is
  reachable only from the reducer.** Three rules implemented and unreachable
  from the effect vocabulary — which is C1, forced movement, and C5.

## H. Recommended next tranche

**Not this one.** Tranche 3 is in flight and no task joins an approved
roster. The recommendation is for **tranche 4**, and it has a gate in front
of it.

**The whole-engine audit falls due when IE-001 merges** — the counter reaches
4 of 4 — and it is Fable's by the workflow. This audit is the foreman's
measurement; the ranking in section F is a judgement, and items 5, 6 and 7
are explicitly the kind the foreman may not decide. So:

**Tranche 4, recommended roster — three GREEN primitives that follow
established patterns:**

| Role | Task | Family | Evidence |
|---|---|---|---|
| PRIMARY | A granted Resistance / Immunity / Vulnerability | C1 | 9 consumers; fourth user of a three-user storage pattern |
| PARALLEL | Condition removal, and healing an effect modifies | C5 | 13 consumers; `removeConditionInstance` already exists |
| PARALLEL | A selector for the save a casting forces | C2, first half | 7 consumers; extends `RollSelector` by one axis |

Each is a closed-union extension with three or more consumers on both
populations, each reuses an existing storage-and-cleanup pattern rather than
inventing one, and none is foundational architecture. They are mutually
parallel-safe: C1 is `CreatureState` defences and `applyDamage`, C5 is
healing and conditions, C2 is `roll-modifiers.ts` and the save path.

**And one Fable charter, run first:** the whole-engine audit, chartered on
the question this audit cannot answer — **the restricted child vocabulary for
outcome-scoped child effects (C4)**. It is the highest-leverage item, it is
the one the decision record deferred pending evidence, and IE-001 plus this
audit are that evidence. Its output is a design record, not code, and tranche
5 implements it.

## The leverage report

From tranche 4 onward, every builder digest and reviewer verdict carries this
block in addition to the existing digest. It exists because **raw
implementation and capability unlocked are different numbers**, and the
current digest reports only the first.

```
IE-NNN — Leverage report
Reusable primitives added: <name each, with the union or state it extends>
Existing primitives reused: <name each — this is the line that should be long>
Features directly implemented: <spells and class features this task makes work>
Newly expressible without further engine code: <what a definition author can
  now write that they could not, with the concrete SRD consumers — counted
  separately from the line above, because it is the leverage>
Bespoke handlers added: <none, or each one>
Justification for each bespoke handler: <why the generic effect vocabulary is
  insufficient, in terms of rules fidelity rather than convenience>
Test coverage added: <new tests; which are end-to-end; mutations run>
Remaining blockers: <what this family still cannot express, and the named
  shape that blocks it — an entry in MISSING_SHAPES, or a new one proposed>
Architecture / invariant impact: <ownership boundaries, authoritative vs
  derived, the fold, persistence; "none" is an acceptable answer and the
  common one>
```

Two rules about it, both learned from guards this repository already has:

- **"Newly expressible" must name its consumers.** A count with no spell
  names behind it is the same unchecked claim the honesty guard exists to
  refuse, and it is the number most tempting to inflate.
- **A bespoke handler's justification is reviewed as a claim**, not accepted
  as a note. The reviewer's existing "architectural violations" line already
  asks whether a special case was added; this makes the author answer first.
