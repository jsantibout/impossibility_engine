# IE-035 — A rider on later weapon attacks, and a duration the slot changes

state: DONE
lane: mechanism
tranche: 5
parallel-safe: CONDITIONAL — a union task; safe beside IE-036, which touches only definitions and the registry
depends-on: IE-034
worker: none
approved: 2026-09-14 — "APPROVE TRANCHE 5"
merge-approved: 2026-09-14 — "APPROVE TRANCHE 5" (tranche 5 authority; 13/13 conditions green)

## Brief

### Objective

Two shapes the map ranks together because two spells need both: a sourced rider
on the caster's later weapon attacks, and a duration that changes with the slot.

### Why now

`a-rider-on-a-later-weapon-attack` blocks 10 spells and finishes three on its
own — Divine Favor, Magic Weapon, True Strike.
`a-duration-the-slot-changes` blocks 10 and finishes Major Image. **Hunter's
Mark is blocked on exactly these two and nothing else**, verified against the
derived map, so building them together finishes it as well.

Hex needs both *and* a third — an ability chosen at the casting — so it stays
blocked, and that is the evidence the audit wanted for a "choice at the
casting" bag: a third stated fact, in a later cycle.

### Current relevant architecture

- `resolveAttackDamage` and `featureDamageTypes` — where a class feature's
  extra damage already reaches a hit. The rider is read **beside** it, as a
  sixth member of the enumerated family IE-028 built.
- IE-028's `grantSourcesOf` / `withoutGrants` — the door this grant is ended
  through.
- `persists(definition)` — where the deadline is scheduled from the duration.
- `OngoingSpell` — the record the marked target is pinned on.

### Required behaviour

Two sub-shapes and one grant.

**The rider.** A sourced rider on the **caster's** attacks — dice, damage type,
and an optional **marked target** or none:

- SRD Divine Favor: "Until the spell ends, your attacks with weapons deal an
  extra 1d4 Radiant damage on a hit." No marked target.
- SRD Hunter's Mark: "you deal an extra 1d6 Force damage to the target whenever
  you hit it with an attack roll." A marked target.
- SRD Hex: "you deal an extra 1d6 Necrotic damage to the target whenever you
  hit it with an attack roll." Also marked, and blocked on its chosen ability.

**The duration.** `durationAtSlot: { level: seconds }` on the definition, read
where `persists` schedules the deadline:

- SRD Hunter's Mark: "Your Concentration can last longer with a spell slot of
  level 3–4 (up to 8 hours) or 5+ (up to 24 hours)."
- SRD Hex prints a different set of bands: "level 2 (up to 4 hours), 3–4 (up to
  8 hours), or 5+ (24 hours)." **Two spells, two tables — this is why the field
  is per-definition and not a formula.**
- The three Dominates and Mass Suggestion print the same shape; read each
  against its own paragraph.

### Architecture constraints

- A sixth member of the sourced-grant family, **through IE-028's enumerator**.
  Do not add a sixth hand-walk.
- The extra damage is a second damage **component** with its own source, not a
  bonus folded into the weapon's: it meets the target's defences as its own
  type, and a Critical Hit doubles its dice. The reading `featureDamageTypes`
  already takes.
- Magic Weapon needs `replacesPriorCasting` — the Mage Hand rule, already in
  the vocabulary. Do not invent a second mechanism for it.
- **Hex's chosen ability stays a named gap.** Do not build a choice bag for one
  spell.

### Acceptance criteria

1. Divine Favor, Magic Weapon and True Strike leave the undefined population;
   Hunter's Mark leaves it too, on both shapes at once; Major Image's duration
   clause closes.
2. The rider's damage is typed: a fixture whose target **resists** the rider's
   type but not the weapon's shows the two applied separately. An undefended
   dummy cannot tell the two apart — the lesson `featureDamageTypes` already
   carries.
3. Hunter's Mark at slot level 3 lasts eight hours and at 5 twenty-four, driven
   past the deadline; Hex's own bands differ and are not shared.
4. The grant ends with the casting through the one door: a dispel, a broken
   Concentration and the deadline all take the rider away.
5. Hex stays blocked, on its chosen ability alone, and the map says so.
6. `npm run coverage` run and committed; both frozen logs fold unchanged.

### Tests and conformance

`spell-honesty.test.ts` in both directions. The rider's interaction with a
Critical Hit needs its own case: dice double, flat does not.

### Dependencies

**IE-034.** Runs beside **IE-036**, colliding only on registry lines.

### Likely file surface

`attack.ts`, `commands/attacks.ts`, `events.ts`, `spell-definitions.ts`,
`spell-schema.ts`, `commands/spell-resolution.ts`, `scripts/missing-shapes.ts`,
`COVERAGE.md`.

### Out of scope

Hex's chosen ability. Bestow Curse, Enlarge/Reduce, Alter Self and Shillelagh,
each blocked on something else besides. Any change to how a class feature's
rider works.

### Known risks

"Your attacks with weapons" (Divine Favor) and "whenever you hit it with an
attack roll" (Hunter's Mark) are **not the same clause** — one is weapon
attacks, the other any attack roll. Transcribe each rather than sharing one
predicate, and let the difference be data.


## Completion digest

Builder **COMPLETE**, reviewer **PASS at high confidence**, four rounds
(8 → 2 → 1 → 0 defects). Branch `worktree-agent-a92c5cdd25ca0fb04`, commit
`b8e5b59`, rebased to `fbc7e31`. Tests **7648 → 7736 on `main`**, 88 new.
Gauntlet green; `COVERAGE.md` byte-clean, **executed 92 → 94, verified
70 → 72**, partial steady at 46.

**Delivered:** Divine Favor and Hunter's Mark defined and verified, Hex's two
built blockers dropped, and **Mass Suggestion finished as a side effect**.

Six mutations, all biting. The fixture design is the part worth keeping:
Divine Favor's die is pinned against a target **resisting Radiant and not
Bludgeoning**, and against one resisting Bludgeoning and not Radiant. An
undefended dummy could not tell a typed component from a folded bonus — that
pair is the whole proof the rider is a component.

**IE-028's guard measured a second time.** The sixth grant cost **exactly one
line in `grantsOf`**; `releaseCasting`, `releaseOnTarget`, `releaseGrants`,
`expireEffects` and `holdsNothingOf` are untouched. The derived `GrantFamily`
doing what it was built for, two tranches running.

### Four declared deviations, all accepted

**1. Three acceptance criteria are corrected against the SRD rather than met.**
My brief said Magic Weapon, True Strike and Major Image's duration clause would
close. **I verified all three paragraphs myself before accepting:**

| Spell | SRD | Why it is not this shape |
|---|---|---|
| True Strike | Instantaneous; "you make one attack with the weapon used in the spell's casting" | It **makes** the attack; it is not a rider on a *later* one |
| Magic Weapon | "a +1 bonus to **attack rolls and damage rolls**", banded by slot | A flat bonus of the weapon's own type reaching the **attack roll**, not extra typed damage |
| Major Image | the upcast makes it "until dispelled, **without requiring Concentration**" | A slot changing **what kind** of duration a spell has — one spell in the book |

Both shape ids are **kept with narrowed descriptions naming each residue**
rather than retired — IE-034's precedent for a half-built shape.

**2. Hex keeps a second blocker, and the near-miss is the instructive part.**
SRD Hex prints Hunter's Mark's "If the target drops to 0 Hit Points … curse a
new creature" **word for word**. Filing one end only would have moved that
shape's `unblocks` from 0 to 1 **on the strength of a spell printing the same
rule** — *a leverage number a tranche gets planned from*. Found by the reviewer
in round 2; both ends filed in one pass. **The map was about to acquire a new
wrong number and the review caught it.**

**3. Four review rounds, not three, declared rather than hidden.** Findings
shrank 8 → 2 → 1 → 0, every one ordinary, every round `Escalation reason:
none`. The builder's reasoning is why this is accepted rather than tolerated:
*"No architectural question arose, so `ARCHITECTURE_BLOCKED` had nothing honest
to put in 'why the approved design does not cleanly cover it'."* It took a
fourth round so the foreman would have a `PASS` to gate on — what the foreman
authorised explicitly for IE-026 and IE-033, reached here unaided and declared.

**4. A guard that failed by succeeding.** `blocked-on.test.ts`'s population
floor read `> 200` against a map of exactly **201**, so the next task to define
two spells failed a guard *because it did its job*. Relaxed to `> 150` with the
reason written in the test; it still fails on an emptied map. The alternative
was leaving two built spells recorded as undefined — lying in the map to keep a
guard green.

### Out-of-scope findings

- **A readied spell cannot state a stated fact.** `ReadiedResponse` carries a
  spell id, a casting id and a level and nothing else, so the three Dominates —
  which print the "fighting it" clause — are refused `fought_fact_required` on
  the readied path and **cannot be readied at all**. The same will hold for any
  future spell stating a damage type. This is IE-030's stated facts meeting the
  Ready path, and **neither task could have seen it alone**.
- `resolveAttackEffect` selects the rider's components back out **by readable
  name**; a definition that both had an `attack` effect and sourced a rider on
  its own caster would count that component twice. Unreachable today.

## Risk gate

**Inspected** — a sixth sourced grant, a new event type, and a declared scope
reduction the reviewer explicitly handed to the foreman to clear.

I verified the three SRD corrections against `packages/srd/raw/spells.md`
myself rather than accepting the digest, because **this is the third task
tonight to refuse a "finishes X" claim of mine taken from the derived map**.
All three are right.

`landedOn`'s union is the one behaviour change outside the new kind, and the
reviewer established it is a no-op for the whole prior catalogue **by reading
all nine `held.add` sites** rather than by running the suite. Both frozen logs
and `scenario.test.ts` run explicitly — 53 tests.

Classification: **GREEN**.

## Architecture decision

None. No Fable involvement.

## Merge record

Merged to `main` as `fbc7e31`, fast-forward, pushed. Rebased by the foreman;
clean.

`main` verified after the merge: typecheck ✓, lint ✓, **7736 tests across 115
files** ✓, both frozen logs and the scenario determinism explicitly ✓,
`COVERAGE.md` byte-clean ✓, tree clean.

Thirteen conditions: **1** inside the brief on its two shapes, with three
acceptance criteria corrected against the book; **2** `COMPLETE`; **3** `PASS`
at high confidence; **4** defects resolved; **5** gauntlet green; **6**
conformance — both shape ids narrowed rather than retired, honest for a
half-built shape; **7** no blocker; **8** four deviations, every one declared
and each accepted on its own evidence, three of them the brief being wrong
rather than the work departing from it; **9** the primitives are the brief's,
with `standing.ts` a **narrower** surface than predicted; **10** no scope
expansion — `attack.ts` and `commands/attacks.ts` were on the brief's surface
and proved unnecessary; **11** clean rebase; **12** re-verified on `main`;
**13** risk gate inspected, GREEN.

**Wave 7 complete** — IE-036, its partner in that wave, is deferred to tranche
6. **IE-037 launched**, and it is the tranche's last task.
