# IE-053 — `OngoingSpell.on`: store what the cast knows, derive what the world holds

state: IMPLEMENTING
lane: mechanism
tranche: 7
parallel-safe: NO — `events.ts`, `spells.ts`, the fold and four readers
depends-on: IE-050, IE-051
worker: qb-builder, launched 2026-09-14 from `04a5353` (wave 2)
approved: 2026-09-14 — "APPROVE TRANCHE 7."
merge-approved: none

## Brief

### Objective

Build the replacement Fable designed after IE-047's gate falsified the
"derive the whole field" premise: `on` is **two facts of different provenance**,
so store the half only the cast knows and derive the half the world already
holds.

### Why now

IE-047 measured it and the owner has decided to proceed. This is correctness and
simplification at once: it removes three hand-maintained passes over a derivable
fact, and it **fixes a live-by-construction defect** — `fold/expiry.ts`'s
`grants` branch releases a grant and never removes the creature from `on`, where
the condition branch does, so a `grants` deadline leaves a stale name in the
list `ongoingSpellsOn` reads.

**Do not resurrect the falsified premise.** Deriving the entire field is
measured wrong: a tracked spell owns nothing on its target ever, so the rule
alone answers *nobody* and Darkvision stops being dispellable; and a target the
casting was released on forbids the cast-time seed that would rescue it.

### The design, transcribed from Fable's decision of 2026-09-14

`on` is three buckets in one list, written at the cast by `landedOn`:

| Bucket | Provenance | Disposition |
|---|---|---|
| the caster of a Range: Self spell | a cast-time declaration | **stored** |
| targets the casting reported nothing about, and the geometry did not choose | a cast-time declaration — the tracked-spell case | **stored** |
| whoever the casting hung a live effect on (`held`) | a world fact `holdsNothingOf` already answers at every read | **derived** |

So the stored subset is `on \ held` at the cast, under a **new name** — `aimed`
or similar, **so no reader can mistake the stored subset for "on now"** — and
"on now" is that subset ∪ {creatures for which `holdsNothingOf` is false},
behind one new reader in `fold/release.ts`.

**All four readers want "on now"**, which IE-047's sweep confirmed:
`commands/ongoing.ts` (`ongoingSpellsOn`), the Dispel branch in the spell
resolvers, `endOngoingSpell`'s `no_effect_there` in `commands/casting.ts`, and
`fold/endings.ts`'s `endsEarly` pass.

### Required behaviour

1. `OngoingSpell` stores the aimed subset under a new name; the `spell-ongoing`
   payload carries it; one new reader (`spellOn(state, record)` /
   `isOn(state, record, who)`) in `fold/release.ts` is the single answer to "on
   now", and all four readers ask it.
2. `alsoOn` is **deleted** — its growth is now derived, which also closes its
   own latent gap: it was hand-wired to `condition-applied` alone, so none of
   the five grant events grew `on`.
3. The **condition branch's shrink** in `fold/expiry.ts` is deleted; the
   `grants` branch's missing shrink is fixed **by construction** rather than by
   a hand fix. `withoutTarget` is **kept** — a dispelled Darkvision must still
   leave the stored list.
4. **Compatibility is two steps and the order matters.** First: key
   `upgradeOngoing`'s catalogue fill on `version === undefined` **and nothing
   else** — it is keyed `!== ONGOING_RECORD_VERSION` today, so *any* bump routes
   every version 2 record through the catalogue fill and overwrites a pinned
   area, which is the hazard that file's own docstring names and which is one
   constant edit away regardless of this task. Then bump
   `ONGOING_RECORD_VERSION` 2 → 3 and, for a record below 3, compute the stored
   subset **in the `spell-ongoing` reducer case**, because it reads state — and
   it is correct there because the record is written last in every resolution
   path, so everything held is already on the creatures.
5. `holdsNothingOf`'s reading does **not** change: scheduled damage stays out,
   which is what keeps a creature merely damaged by Insect Plague off the list.
6. Two one-line clearances in `commands/casting.ts`, which this task already
   owns as a reader: delete `SpellEffectOptions.immuneTo` (**zero writers**,
   verified by IE-040 and left only because that file was held), and say in the
   digest whether anything else in that file still refers to it.

### Architecture constraints

Settled by Fable; a deviation is `ARCHITECTURE_BLOCKED`:

- store the cast-time half, derive the world half — **not** the whole field,
  and **not** a second field beside a still-stored `on`;
- the stored field is renamed so no reader can mistake it for "on now";
- one reader for "on now", asked by all four sites;
- `holdsNothingOf` is unchanged;
- neither frozen log is regenerated.

### Acceptance criteria

1. **IE-047's gate, with the engine's own function substituted for the
   test-local `derivedOn`**, passes at its 869 checkpoints over
   `golden-log-2.json`, and its `golden-log.json` zero-checkpoint assertion is
   kept so two ticks are not read as two proofs.
2. **The gate's third case is flipped, not deleted.** It currently asserts the
   *disagreement* the `grants` branch produces; this task makes all three
   readings agree, and the case must assert that instead. Its docstring already
   says a fix is expected to redden it — that is the test doing its job.
3. Its tracked-spell case and its released-target case both now agree, which is
   the whole point: Darkvision stays dispellable and a released target stays
   released.
4. A hand-built **version 2** record carrying a **pinned area** is folded
   through the bumped constant and asserted **untouched** — the hazard in
   requirement 4.
5. Both frozen logs fold to byte-identical readers' answers, run explicitly.
6. `npm run typecheck`, `npm run lint`, the full suite, `COVERAGE.md`
   byte-clean, `fold-graph.ts` acyclic with `fold-layout.json` updated.

### Tests and conformance

The `OngoingSpell.on` paragraphs are rewritten **where they now live**: the
three-pass description at `docs/design/space-and-areas.md` ("`on` is a stored
derivation kept in step by three passes") goes, and the two-provenance rule and
the derivation arrive there and in `docs/design/casting.md`, which is
authoritative for casting and ongoing spells. The `grants` finding is recorded
as closed by construction. `CLAUDE.md` is the constitution and the router only —
do not write subsystem architecture back into it.

### Dependencies

IE-050 (it edits a reducer case, which that task moves) and IE-051 (it edits the
Dispel reader, which that task moves). Runs alone among mechanism tasks.

### Out of scope

Any change to what Dispel Magic *does*. The command-stamp envelope. Making
`holdsNothingOf` count "ever touched" — Fable rejected that explicitly as
inventing a rule.

### Known risks

Medium, and concentrated in requirement 4: the two compatibility steps in the
wrong order silently overwrite a pinned area in a version 2 record, and the
frozen logs would still fold. Criterion 4 is the only thing that catches it, so
write that test first.
