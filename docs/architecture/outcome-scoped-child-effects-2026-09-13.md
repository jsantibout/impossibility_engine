# Outcome-scoped child effects — design record

**2026-09-13.** Fable, principal architect, on the whole-engine gate the owner
chartered and scoped to this one question. Measured against `main` at
`7d01158`. **Design only; nothing implemented.**

> **Filed by the foreman, verbatim.** The charter asked Fable to write this
> file; `qb-architect` has Read, Glob, Grep and Bash and no Write, and Fable
> declined the instruction on the grounds that its role writes nothing to the
> tree. It is right on both counts and the charter was wrong to ask. The
> record below is Fable's, unedited; everything after the horizontal rule at
> the end is the foreman's.

## The finding first

**There are no child effects in the SRD sentences this question is about, and
there should be none in the engine.** What the book writes after "On a failed
save," or "On a hit," is a *conjunction of consequences that share one roll* —
one target, one DC, one casting link, one lifetime — and every consequence in
that position is a **leaf**: it rolls no d20, names no target of its own,
opens no window, spends nothing. The engine already has three such leaves and
calls them riders: `ConditionRider` (`spell-definitions.ts:213`),
`DelayedDamage` (`:188`), and the `plus` part on `save-damage` (`:313`).
IE-001's unification of `ConditionRider` is the precedent, and the thing it
proves is not "riders can be shared" but "**a rider is a leaf**": nothing in
`riderOptions` (`spell-resolution.ts:725`) rolls, targets or branches.

So the answer to "what is the restricted child vocabulary" is: **the set of
rider leaf types, hosted in fixed named slots on the three kinds that produce
an outcome, with the branch fixed by the host rather than chosen by the
author.** `onFail: SpellEffect[]` is rejected on evidence, not taste: no SRD
consumer in either population needs a consequence that itself rolls, and the
two that look as if they do (Ice Knife, Chromatic Orb) turn out to be
different mechanisms (§C).

The evidence supports a narrower thing than the leverage audit counted. C4's
"8+ consumers, ~12 newly expressible, ~5 made whole" bundled four unrelated
shapes; the corrected numbers are in §I.

## A. Proposed vocabulary

No new list type, no `kind`-dispatched child list. Three changes to types that
exist, one new leaf, and one outcome selector:

```ts
// spell-definitions.ts — B's lane (types at the top of the file)

/** A consequence that rides the affirmative outcome of the roll its host made. */
export interface OutcomeRiders {
  /** Was `condition?: ConditionRider`. Plural: Hideous Laughter, Hypnotic Pattern. */
  readonly conditions?: readonly ConditionRider[];
  /** A grant the same roll imposes: Phantasmal Killer, Enthrall, Slow. */
  readonly modifiers?: readonly ModifierRider[];
  /** Unchanged. */
  readonly delayed?: DelayedDamage;
}

/** `buff` and `roll-mode` with their own saving throw removed — the host made it. */
export type ModifierRider =
  | { readonly kind: 'bonus'; readonly bonus: Bonus; readonly applies: readonly BonusApplies[]; readonly direction: 'add' | 'subtract' }
  | { readonly kind: 'mode'; readonly modifier: RollModifier };

export interface ConditionRider {
  readonly name: ConditionName;
  readonly lasts?: RiderDuration;
  readonly check?: SpellCheck;
  readonly outlivesCasting?: true;
  /** Moved in from `save`; legal only where the host rolled a saving throw. Sunburst. */
  readonly repeats?: { readonly at: 'start-of-turn' | 'end-of-turn'; readonly onSuccess: 'end-on-target' | 'end-casting' };
}
```

Hosts, by composition rather than by a host field on the rider:

| Host | Slots | Outcome selector |
|---|---|---|
| `attack` | `conditions`, `modifiers`, `delayed` | `onMiss?: 'half'` (new; Acid Arrow) — the host's damage only |
| `save-damage` | `conditions`, `modifiers`, `delayed`, `plus` (existing) | `onSuccess: 'half' \| 'none'` (existing) — the host's damage only |
| `save` | `conditions` via the flat layout and `conditionRiderOf`, `modifiers` | — |

`save` keeps its flat spelling and its flat `repeats`, exactly as IE-001 kept
`lasts` and `check` flat; `conditionRiderOf` folds `repeats` into the view.
`condition` hosts nothing new: it has no outcome, so its rider *is* the
effect.

**Deliberately not a `riders: Rider[]` list.** Named slots let the type system
say which host may carry which rider — `plus` and `delayed` on `save` are
impossible rather than validated — and they keep the house style of one field
per SRD sentence shape. The cost of named slots is one `applyRiders` function
with three loops, which is smaller than a dispatch.

## B. Members and their consumers

Measured from `packages/srd/raw/spells.md` by clause, and from the catalogue.

| Member | Consumers | Bar met |
|---|---|---|
| `conditions` (plural) | Hideous Laughter "Prone and Incapacitated conditions"; Hypnotic Pattern "Charmed ... While Charmed, ... Incapacitated"; Divine Word "Blinded and Deafened" (blocked elsewhere on an outcome by Hit Points) | two clean, one partial — a cardinality change to an existing member, not a new primitive |
| `modifiers` | Phantasmal Killer "Disadvantage on ability checks and attack rolls for the duration" (executed, partial on exactly this); Enthrall "−10 penalty to Wisdom (Perception) checks" (a `bonus` rider; Passive Perception stays out); Slow "−2 penalty to AC and Dexterity saving throws" (a `bonus` rider on a `save` host; Slow's other clauses stay out); Ray of Enfeeblement (a `mode` rider, blocked on the "Strength-based D20 Tests" selector); Contagion (a `mode` rider, blocked on the ability chosen at the casting) | one clean, two whose *rider half* fits today, two blocked on other shapes. Resolution is the existing `buff`/`roll-mode` branch minus its roll (`spell-resolution.ts:1035-1136`) |
| `repeats` on the rider | Sunburst (on a `save-damage` host); Hold Person, Hold Monster, Blindness/Deafness already use it flat on `save` | four — a move, not an addition. The `save` docstring's reason for keeping it there ("no kind without a save can carry it", `:1384-1386`) is right and `save-damage` has a save |
| `onMiss: 'half'` on `attack` | Acid Arrow "On a miss ... half as much of the initial damage only" | **one**. A transcribed field mirroring `onSuccess`, in the tradition of `healsCasterForHalf` and `outlivesCasting`; not a shared primitive. Owner may drop it |
| `lasts: { seconds }` as a third `RiderDuration` member | Sunburst "Blinded for 1 minute" on an Instantaneous spell | **one**. Without it Sunburst stays partial on that clause. Rejected alternative: `durationSeconds: 60` on Sunburst makes an Instantaneous spell dispellable, which SRD forbids. Owner may drop it |

Everything else asked about has one consumer or fewer, or needs a primitive
first (§C, §J).

## C. Forbidden members, each with its reason

| Family | Consumers that look like children | Why not a rider |
|---|---|---|
| Any `SpellEffect` as a child | none needed | **A child that rolls is a parent.** Recursion enters the format the moment a rider carries `ability` rolled at resolution or `attack`. The invariant in §E is exactly "a rider never rolls a d20" |
| A rider that names targets or an area | Ice Knife ("Hit or miss, the shard then explodes. The target and each creature within 5 feet"), Chromatic Orb ("leaps to a different target ... Make an attack roll against the new target") | New targeting. Ice Knife is *two sequenced rolls from one casting* with an area centred on a target — a sibling mechanism (`several-rolls-from-one-casting` plus area-at-target), not a consequence. Chromatic Orb is a chained attack on a dice-face trigger, blocked besides on `a-damage-type-chosen-at-the-casting`. Both were mis-filed to this shape by IE-002 |
| A rider on the outcome of the host's **damage** | Disintegrate ("If this damage reduces it to 0 Hit Points ... gray dust ... revived only by") | A third outcome axis (save → damage → 0 HP) with one consumer, whose consequences are inventory destruction and a revival rule the engine does not hold. Not a consumer of this design; re-adjudicate (§I) |
| Action economy | Shocking Grasp ("can't make Opportunity Attacks"), Slow ("can't take Reactions", one action or Bonus Action) | `mayAct` authority; the audit's bespoke RED family |
| Ending another casting or breaking Concentration | Sleet Storm ("or have the Prone condition and lose Concentration") | one consumer. `endConcentration` exists, so it is "not built", not "forbidden" — but a rider that reaches into a *different* casting's lifecycle is the first rider that would touch state it did not create, and one user does not buy that |
| Success- or miss-branch riders | Flesh to Stone ("On a successful save, its Speed is 0"), Ray of Enfeeblement's success clause | one consumer each, and both need a primitive (Speed; one-shot modifier). **No slot.** The affirmative branch is the only one that carries riders, which is why the slot name *is* the branch |
| Summons, entity construction, a second scene, compelled actions | — | Authority-bound; outside, as the owner's constraints say and as `spell-leverage-audit` §E already argued |
| A predicate, expression or callback | — | Never |

## D. Hosts

`attack`, `save-damage`, `save`. Not `condition` (no outcome), not
`heal`/`temp-hp`/`buff`/`roll-mode`/`armor-class`/`dispel`/`interrupt-casting`
(no consumer writes a rider after any of them; `dispel`'s per-spell check is
its own loop). `AreaTrigger.effects` and `SpellActivation.effects` host the
same three kinds and get riders for free — Web's and Spirit Guardians' area
effects are `save`/`save-damage` already.

## E. Invariants, and where each is enforced

| Invariant | Type system | `checkSpellDefinition` / `checkShape` | Test |
|---|---|---|---|
| A rider is a leaf: no rider type references `SpellEffect`, another rider, `targets`, `area`, or an `ability` rolled at resolution (`check.ability` is a later, table-triggered check with a closed `onSuccess`; `repeats` reads the **host's** ability and DC) | yes — `ConditionRider`, `ModifierRider`, `DelayedDamage` are closed interfaces over primitives | `checkShape` refuses a rider object carrying `effects`, `targets`, `area`, or a `kind` in `EFFECT_KINDS` (a denylist, consistent with "a field the engine does not know is not an error") | a sweep walks every catalogue definition's `effects` as JSON and asserts no nested object below an effect has `kind ∈ EFFECT_KINDS`, and nesting depth is bounded |
| `RIDER_KINDS ∩ EFFECT_KINDS = ∅` | — | — | one-line assertion |
| Slots exist only on hosts that produce the outcome | yes, by composition | — | — |
| `repeats` only where the host rolled a save | no (`ConditionRider` is shared with `attack` and `condition`) | **yes**: refuse `repeats` on a rider hosted by `attack` or `condition` | driven by `spell-schema.test.ts` |
| A casting-owned rider on a definition with no lifetime must say `lasts` | no | **yes**, new: if the definition has no `durationSeconds`, `durationUntil` or `concentration`, every `conditions` entry without `outlivesCasting` and every `modifiers` entry must carry `lasts` — otherwise the grant is linked to a casting that never becomes ongoing and never ends | — |
| `mode` rider with `against-holder` only on `attack` selectors | — | already refused by the `RollSelector` validator | existing |
| `onMiss` affects the host's damage only; riders never ride a miss | yes — there is no miss-branch slot | — | — |
| Rider order is fixed: conditions, then modifiers, then delayed | — | — | observable only in the log; pinned by the Phantasmal Killer fixture's event order |

The last-but-two row is a rule the catalogue may already obey implicitly
(Contagion has `durationSeconds`, Ray of Sickness and Sunbeam have `lasts`,
Black Tentacles and Weird are Concentration) and nothing enforces; the foreman
should check whether a latent never-released condition exists today.

## F. Resolution and event flow

One function, `applyRiders(current, target, riders, ctx)`, called from the
three host branches at the point each already handles `effect.condition`
(`spell-resolution.ts:963`, `:1292`, `:1376`). It emits **only events that
exist**: `condition-applied` (with timer, `repeatSave`, `check` through
`riderOptions`), `bonus-applied` / `roll-modifier-granted` with
`source: castingSource(spell, castingId)` (the exact payloads at `:1065-1074`
and `:1121-1128`), and `damage-scheduled`. No new event type, no new state
field, no new `SpellTargetOutcome` shape beyond `condition` becoming a list.
Riders read `numbers` (pinned) for `repeats.dc` and `check.dc`, never the
sheet.

`held.add(target)` when any condition rider is casting-owned or any modifier
rider lands — a modifier is always casting-owned, so `OngoingSpell.on` grows
exactly as the `buff` branch already grows it (`:1064`). `delayed` still does
not hold, as today.

Provenance: every rider's source is `Spell#cast:N`;
`spellOfSource`/`castingIdOf` read it unchanged. Persistence and replay:
nothing new is stored; every log written before this folds unchanged, because
no existing definition changes meaning (§H).

## G. Cleanup, duration, Concentration

Riders die through the one door. `releaseCasting` and `releaseOnTarget`
already drop conditions, bonuses, roll modifiers, armour classes, timers and
scheduled damage by casting id (`events.ts:1873-1893`, `:2067-2077`); a
rider's grant is indistinguishable from a top-level grant there. A
Concentration break, a deadline, a dispel and the caster leaving all reach it.

**One structural limit, stated:** `EffectTarget` ends a condition instance, a
casting or a feature (`duration.ts:139-143`) and **nothing ends a grant before
its casting does**. So a `modifiers` rider lives exactly as long as the
casting; a `lasts` on a modifier rider is not expressible and the type does
not offer one. Phantasmal Killer ("for the duration") and Slow ("for the
duration") fit; a future consumer with "for 1 minute" on an Instantaneous host
would need a fourth `EffectTarget` member — the same gap CLAUDE.md already
names for Superior Hunter's Defense ("a Resistance with a deadline") and that
C1 will meet. Named, not built.

## H. Migration impact on the twelve kinds

- `condition?: ConditionRider` → `conditions?: readonly ConditionRider[]` on
  `attack` and `save-damage`: **five definitions** (Ray of Sickness, Contagion,
  Black Tentacles, Weird, Sunbeam), `conditionRiderOf` → returns a list (`save`
  and `condition` yield one), `riderDurations`, `checkEffect`, the honesty
  test's readers, `coverage.ts`. Mechanical; A's lane for the definitions, B's
  for the types.
- `save.repeats` stays flat; the view gains one line.
- `roll-mode.save` has **zero users** in the catalogue (Blur and Beacon of Hope
  are the only `roll-mode` effects and neither saves) and `buff.ability` has
  one (Bane). A `modifiers` rider on a `save` host is the same sentence with
  the roll shared, so `roll-mode.save` is a speculative field this design makes
  redundant: remove it. Leave `buff.ability` for Bane; folding Bane into `save`
  + rider would require `save` to permit an empty condition, which is a change
  with no rules gain.
- Nothing else moves. Every definition in the catalogue means what it meant.

## I. What becomes expressible, honestly counted

| Spell | Today | After | Still missing |
|---|---|---|---|
| Acid Arrow | executed, partial | **whole** (with `onMiss`) | — |
| Sunburst | executed, partial | **whole** (with `repeats` and `lasts: { seconds }`); dispelling Darkness is table | without the seconds member: partial on the minute |
| Phantasmal Killer | executed, partial ×3 | one clause closes | repeat save that deals damage; "spell ends" on the initial success (one consumer of an `end-casting` outcome on an initial save — named, not built) |
| Hypnotic Pattern | executed, partial ×3 | Incapacitated lands | sight filter; Speed 0 (C3); ended by damage (C6) |
| Disintegrate | filed here | **re-file**: dust and gear to a named "outcome of this spell's own damage" shape or to `table`; revival is table | — |
| Hideous Laughter | undefined | definable, partial | save on taking damage with Advantage (`a-repeat-save-beyond-the-turn-hook`) |
| Enthrall | undefined | definable, partial | Passive Perception |
| Slow | undefined | definable, partial | Speed, Reactions, one-action, 25% — most of the spell |
| Sleet Storm | undefined | definable, partial | Concentration break; Heavily Obscured; Difficult Terrain |
| Ice Knife, Chromatic Orb | undefined | **not this shape** | §C |

Corrected leverage: **two partial spells made whole, three improved, four
newly definable-but-partial**, against the audit's "~12 newly expressible, ~5
made whole". The gain that does not appear in the count is the invariant:
every future grant primitive (Speed, Resistance, a push) gets its rider form
for one validator line, *if* it is built as a source-linked leaf.

## J. What remains bespoke, and the rule for admitting a future rider

A future primitive may become a rider member **iff** it is a leaf — rolls no
d20, names no target, spends nothing, opens no window, touches no state it did
not create — and its lifetime is the casting's or a `lasts`. That admits, when
each exists: a granted Speed (Ray of Frost, Hypnotic Pattern; Flesh to Stone's
is on the success branch and stays out), a push with a fixed direction away
from the caster or origin (Thunderwave — one consumer), a granted Resistance
(no rider consumer in the SRD today; do not reserve). It excludes for good:
summons, compelled actions, a second scene, breaking another creature's
Concentration, one-shot modifiers until consumption exists (C2's second half),
and any rider on the outcome of damage.

**A closed union reserves nothing.** Do not add a member ahead of its
primitive; add it with the primitive and its validator line. Of the foreman's
"needs its own primitive first" group, this design reserves a slot for none
and leaves out none — it states the admission rule instead.

## K. Risks and rejected alternatives

- **`onFail: SpellEffect[]`** — rejected: recursion by construction, and no
  consumer needs it.
- **A `riders: Rider[]` closed union with `kind`** — rejected in favour of
  named slots: host legality would move from the type to the validator, and
  the SRD writes one slot per sentence shape.
- **Keeping `condition` singular and adding `conditions`** — rejected: two
  spellings of one rider is the drift IE-001 just removed.
- **`durationSeconds: 60` on Sunburst** — rejected: makes an Instantaneous
  spell an ongoing, dispellable record.
- **Grant timers now** — rejected: no member in this design needs one; it is
  C1's problem and is named there.
- **Risk:** the builder collides with IE-007, which touches
  `spell-resolution.ts` and the ongoing record. Sequence after IE-007 merges.
- **Risk:** the "made whole" count is small and the owner may judge it not
  worth a task. That is a fair reading; the record then stands as the decision
  that closes the DSL question.

## L. Recommendation

**APPROVE, narrower than asked.** Not "outcome-scoped child effects" —
**outcome riders**: three leaf types in fixed slots on three hosts, one moved
field, one plural, one new leaf (`ModifierRider`), two one-consumer
transcriptions the owner may drop (`onMiss`, `lasts: { seconds }`), and the
invariant that a rider never rolls. One builder task, sequenced after IE-007,
tranche 5 as the leverage audit proposed. **Tranche 4 is not reordered.**

---

## Architecture decision

```
IE-C4 — Architecture decision
Question: What restricted vocabulary lets a saving throw, attack or check express bounded consequences without the definition format becoming a recursive rules DSL?
Level: YELLOW
Decision: Build outcome riders, not child effects — a fixed set of named leaf slots (`conditions`, `modifiers`, `delayed`; `plus` stays) on `attack`, `save-damage` and `save`, with the branch fixed by the host, `repeats` moved into `ConditionRider` under a host rule, and the invariant that a rider never rolls a d20, names no target, spends nothing and opens no window. Reject `onFail: SpellEffect[]`. Reserve no slots for unbuilt primitives; admit each by the leaf rule when it lands.
Because: Every SRD consequence in this position is a leaf sharing the host's roll; the engine's three existing riders already are, and `riderOptions` proves the pattern. The consumers that appear to need a rolling child (Ice Knife, Chromatic Orb) are different mechanisms; `roll-mode.save` has zero users and shows what a speculative branch field looks like.
Options considered: `onFail: SpellEffect[]` (recursion, no consumer); `riders: Rider[]` list (host legality leaves the type); singular-plus-plural condition fields (re-introduces drift); `durationSeconds` on Sunburst (Instantaneous becomes dispellable); grant timers now (no member needs one).
Blast radius: types at the top of spell-definitions.ts (B); five definitions renamed `condition`→`conditions` (A); `conditionRiderOf`, `riderDurations`, `checkEffect`, `checkShape`, honesty-test readers, coverage.ts; one `applyRiders` in spell-resolution.ts replacing three inline blocks; `roll-mode.save` removed. Must not change: events.ts, the reducer, `EffectTarget`, `OngoingSpell`, any existing definition's meaning, golden-log.json. Sequence after IE-007.
Debt this accepts: (1) no grant timer — a bonus, roll-modifier or armour-class grant ends only with its casting; `EffectTarget` has no member for it, so a modifier rider cannot carry `lasts`. (2) Sunburst stays partial on its minute unless `lasts: { seconds }` is taken with one consumer. (3) Sleet Storm's "lose Concentration", Thunderwave's push, Phantasmal Killer's end-on-initial-success and repeat-save damage, Flesh to Stone's success branch — each one consumer.
Confidence: high on the structure and the invariant; medium on whether the owner takes the two one-consumer transcriptions.
```

---

## Foreman's note

Filed 2026-09-13 against `main` at `4d34f94`, after tranche 3 completed.

**The record corrects the foreman's own leverage audit**, and the correction
is the part to carry forward: `spell-leverage-audit-2026-09-13.md` §F ranked
C4 at "8+ consumers, ~12 newly expressible, ~5 made whole" and **bundled four
unrelated shapes to get there**. The honest figures are §I's — two made whole,
three improved, four newly definable-but-partial. The audit's ranking of C4 as
highest-leverage does not survive its own correction; what survives is the
decision, which closes the DSL question for good.

**One second-order finding was checked immediately** because it could have
been a live bug. Fable asked whether a latent never-released condition exists
today — a casting-owned rider on a definition with no lifetime, linked to a
casting that never becomes ongoing and never ends. Driven over all 132
definitions: **none**. So the invariant in §E is a missing *guard* rather than
an unreported defect, and the guard is cheap because nothing has to be fixed
first.

The other three second-order findings are in `docs/dev/QUEUE.md` under
`LATER`, with the one that touches tranche 4 marked as a re-brief rather than
a reorder.
