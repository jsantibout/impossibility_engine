# IE-032 — A casting ended by a trigger

state: DONE
lane: mechanism
tranche: 5
parallel-safe: NO — a union task touching `events.ts` and `spell-resolution.ts`; runs alone
depends-on: IE-027, IE-028, IE-030
worker: none
approved: 2026-09-14 — "APPROVE TRANCHE 5"
merge-approved: 2026-09-14 — "APPROVE TRANCHE 5" (tranche 5 authority; 13/13 conditions green)

## Brief

### Objective

Let a definition say that its casting ends early when something happens, and
end it — derived, in the reducer, the way expiry and a lost Concentration
already are.

### Why now

`a-casting-ended-by-a-trigger` blocks **29 spells, eight of them executed
definitions the engine drives today and leaves unfinished** — the largest
executed-spell debt in the map. Four of those eight carry it as their **only**
clause: Invisibility, Mage Armor, Animal Friendship and Suggestion. Two more —
Charm Person and Charm Monster — carry it plus IE-030's fact, so with IE-030
merged this finishes both. Mislead is finished outright.

### Current relevant architecture

- `packages/engine/src/events.ts` — `expireEffects` (`:3351`) and the derived
  Concentration pass are the precedent: nobody decides either, so neither
  writes an event.
- `releaseCasting` (`:1999`) is the single door a casting leaves by;
  `releaseOnTarget` (`:2230`) releases it on one creature.
- `OngoingSpell` in `spells.ts` — where the trigger list is pinned at the cast,
  exactly as `area` and `areaTrigger` are: *pinned for the casting, read live
  for the creature it is happening to.*
- `CreatureState.lastDamage` — already records who dealt the most recent
  damage, built for Hellish Rebuke's "in response to".
- IE-028's `grantSourcesOf` / `withoutGrants` — the enumerator this cleanup
  routes through.

### Required behaviour

A closed `endsEarly` list on the definition, each member transcribed from a
printed sentence:

| Member | SRD |
|---|---|
| `target-attacks`, `target-deals-damage`, `target-casts` | Invisibility: "The spell ends early immediately after the target makes an attack roll, deals damage, or casts a spell." |
| `target-dons-armor` | Mage Armor: "The spell ends early if the target dons armor." |
| `caster-or-ally-damages-target` | Animal Friendship: "If you or one of your allies deals damage to the target, the spells ends." (transcribed as the raw file prints it). Charm Person: the Charmed condition lasts "until the spell ends or until you or your allies damage it." Suggestion: "or until you or your allies deal damage to the target." |

Pinned on the ongoing record, and a **derived pass in the reducer after each
event** that releases the casting — or releases it **on that target** for a
multi-target charm, which is the distinction `releaseOnTarget` exists for.

Two constraints, both decided:

1. **Hang a trigger on the consequence event, never on `roll-recorded`.**
   `roll-recorded` changes no state by rule; a trigger there would fire on a
   roll whose outcome had not happened.
2. **Where "ally" needs a `side` nobody has declared, the ending is withheld,
   not invented** — the same three-valued reading Sneak Attack takes. A derived
   pass has no `unverified` line to write, so expose it as a **query** a caller
   can ask instead.

### Architecture constraints

- **Derived, so no event.** Nobody decides that a target attacked; the reducer
  finds it. This is the audit trade `CLAUDE.md` already records for expiry and
  Concentration, and it is deliberate.
- Pinned on the record at the cast. A correction to a definition must not reach
  a casting made before it — the rule IE-007 established for the area.
- Route the cleanup through IE-028's enumerator. Do not add a sixth hand-walk.
- A trigger that would need a fact the log does not hold is **filed in
  `missing-shapes.ts`, not modelled**. Do not widen the list to make a spell
  fit.

### Acceptance criteria

1. Invisibility ends when its target attacks, deals damage, or casts — three
   cases, each driven end to end.
2. Mage Armor ends when the target dons armour, through `equipItem`. Its
   granted Armour Class goes with it, through the enumerator.
3. Animal Friendship and Suggestion end when the caster or a declared ally
   damages the target; with **no side declared**, the casting stands and the
   query says why.
4. Charm Person and Charm Monster leave `PARTIAL_SPELLS` — with IE-030 merged,
   both clauses are closed. Mislead is finished.
5. A multi-target charm releases **on the damaged target only**; the casting
   runs for everyone else.
6. Both frozen logs fold unchanged; `npm run coverage` run and committed.

### Tests and conformance

`spell-honesty.test.ts` must agree in both directions: every clause closed here
leaves the adjudication map, and no shape is left claiming nothing. The derived
count of `PARTIAL_SPELLS` moves; it is not edited by hand.

### Dependencies

**IE-027** (the resolver split), **IE-028** (the enumerator), **IE-030** (the
fact that finishes the two charms alongside this).

### Likely file surface

`spell-definitions.ts` (types and eight definitions), `events.ts` (record field
and the derived pass), `spell-schema.ts` (one rule),
`commands/spell-resolution.ts` (the record write), `scripts/missing-shapes.ts`,
`COVERAGE.md`.

### Out of scope

Any trigger whose fact the log does not hold. Hypnotic Pattern's "someone else
uses an action to shake the creature out of its stupor" — an action a spell
grants, which is a different named shape.

### Known risks

The derived pass runs after **every** event. It must be cheap and it must not
re-enter: releasing a casting emits nothing, but it does change state that the
same pass then reads. Establish termination explicitly, the way `expireEffects`
does.


## Completion digest

Builder **COMPLETE**, reviewer **PASS at high confidence**, two rounds. Branch
`worktree-agent-a8c3683dd1f652c5b`, commit `6f6fe08`, rebased to `db62430`.
Tests **7233 → 7276 on `main`**, 43 new. Gauntlet green; `COVERAGE.md`
byte-clean, with **`PARTIAL_SPELLS` 52 → 47 derived rather than edited** and
the shape row falling from 29 blocks / 2 finishes / 8 executed to **21 / 1 / 2**.

Eight mutations, each failing for its own reason. Three are worth keeping:

- **dropping the `record.on.includes(subject)` check hung the fold** before
  `settled` existed — which is why termination was made **structural** rather
  than argued. The loop is bounded by a set keyed on (casting, subject), so it
  can only run as many times as there are distinct pairs.
- adding an unused sixth `CastingEndCause` member failed the format sweep —
  but **only after `LITERAL_UNION` was fixed**; see below.
- the empty-list validator rule first passed **for the wrong reason** and was
  re-based onto a definition nothing else refuses, so
  `end_trigger_without_casting` does not answer first.

### One declared deviation: "Mislead is finished" is refused on the SRD

`spells.md:3928`: *"The double lasts for the duration, but the **invisibility**
ends immediately after you make an attack roll, deal damage, or cast a spell."*
That ends **one effect of a casting**, which `CastingEndTrigger.ends`
(`casting` | `target`) cannot express — and the `BLOCKED_ON` entry had never
recorded the **illusory double** at all, which prints Project Image's sentence
word for word ("intangible and invulnerable", moved up to twice your Speed,
seen and heard through).

So Mislead keeps `a-casting-ended-by-a-trigger` and gains
`a-second-place-to-put-a-creature`. **I read the paragraph myself before
accepting**, as did the reviewer independently, and the builder is right.

**This is the second time tonight a "finishes X outright" claim in one of my
briefs, taken from the derived map, has been falsified by a builder reading the
book** — Enthrall was the first. The pattern is now a finding about the
instrument rather than about two spells, and it is recorded in `QUEUE.md`.

### An instrument was blind, and this found it

`spell-schema.test.ts`'s unused-member sweep — IE-013's zero-user-member guard
— **could not read a literal union written across several lines**, so it would
have swept this task's new type with nothing and passed. `LITERAL_UNION` now
accepts a leading `|`. Found because the builder's own type needed it; other
format types may now be readable that were not, and none proved unused.

Second out-of-scope finding: `releaseOnTarget` leaves an `ongoing` record with
an empty `on` when a single-target `ends: 'target'` spell is released. That is
pre-existing Hold Person semantics and the test **asserts it rather than
inventing an "ends when `on` empties" rule** — the right instinct.

## Risk gate

**Inspected** — a new derived pass in the reducer pipeline is as foundational as
this tranche gets, and there is a declared deviation.

- **Termination is structural, not argued.** `endTriggeredCastings` keeps a
  `settled` set keyed on (casting, subject) and `nextEnding` skips what is in
  it, so the loop is bounded by the number of distinct pairs. `endingFactsOf`
  returns early for all but four event types, so the common path is cheap. The
  brief named this risk and the mutation that hung the fold is what made the
  answer structural.
- **The deviation is the brief's error, verified against the book by three
  readers.**
- **Both frozen logs and `scenario.test.ts` were run explicitly** — 53 tests,
  passing — rather than trusted inside the full suite, because this changes the
  fold.

Classification: **GREEN**.

## Architecture decision

None. No Fable involvement — the one judgement call, refusing to widen
`ends` to reach Mislead, was the builder declining to invent a member for one
spell, which is the rule rather than a decision.

## Merge record

Merged to `main` as `db62430`, fast-forward, pushed. Rebased by the foreman;
clean.

`main` verified after the merge: typecheck ✓, lint ✓, **7276 tests across 112
files** ✓, both frozen logs and the scenario determinism explicitly ✓,
`COVERAGE.md` byte-clean ✓, tree clean.

Thirteen conditions: **1** inside the brief; **2** `COMPLETE`; **3** `PASS` at
high confidence; **4** defects resolved; **5** gauntlet green; **6**
conformance — the partial count moved **derived**, not edited; **7** no
blocker; **8** one deviation, declared, and it is the brief's own claim being
wrong rather than the work departing from it; **9** the primitives are the
brief's, and the new derived pass is what it asked for; **10** eight files
outside the likely surface, each tied to a stated brief constraint or to a
guard that failed correctly; **11** clean rebase; **12** re-verified on `main`;
**13** risk gate inspected, GREEN.

**Wave 4 complete.** Four executed spells lose their only clause — Invisibility,
Mage Armor, Animal Friendship, Suggestion — and **Charm Person and Charm
Monster are finished by this together with IE-030**.
