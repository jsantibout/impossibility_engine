# Roadmap: playable levels 1–5, through Infinite Realms

Written 2026-09-21 by the architect, from the audit of that day, for the Opus
foreman (the `/qb` coordinating session). `STATUS.md` says what runs; this
file says what happens next, in what order, and how we know when it is done.
The foreman works from this file without the architect present. The
architect is called at the gates in §2 and for nothing else.

The audit this comes from, with the measurements: a private artifact at
https://claude.ai/artifact/EAf2QHodm3aPNLaSqja1gc. The ranked ledger with
file:line anchors for every track below: `docs/dev/roadmap-ledger-2026-09-21.md`
(a snapshot; P0-T1 makes it a generated file).

**Update discipline.** The foreman edits this file once per batch: flips a
track's status, records the numbers it moved, appends to §10. Nothing else in
it changes without the owner. A brief cites a track by its id (`P1-T6`).

Status marks: `[ ]` not started · `[~]` in a builder's worktree · `[x]` merged
· `[!]` blocked, with the reason in §10.

## 0. The destination, and how we know we have arrived

The owner's definition (2026-09-21): **"playable to level 5" means everything
a level 1–5 character can reach is executed by the engine.** Not the common
turn executed and the rest narrated. The one reading kept from
`docs/design/content.md`: a printed sentence that is pure fiction no rule
later reads is a handover, never a debt. What an illusion looks like is a
handover; the Investigation check to see through it is a debt until it rolls.

Four criteria, all measured, all four required:

1. **The ledger is at zero.** `LEDGER.md` (P0-T1) reports no spell, feature
   or CR ≤ 5 stat-block line in level-5 reach that waits on an engine shape,
   and every remaining handover is listed with the fiction-only reason.
2. **Everything executed is reachable.** The reachability test (P0-T2) builds
   one level 5 character of every path and proves every engine feature it
   holds is passive, creation-time, a reaction with an answering window, or
   spendable through a named tool.
3. **A level 5 party plays a session with zero handovers.** The session test
   (P0-T3) drives a four-character party through a CR-appropriate fight, a
   Short Rest, a Long Rest and a level-up, entirely through the two surfaces,
   and counts what the engine handed to the DM. The count is zero.
4. **Infinite Realms plays that session.** The same fight runs through the
   app with the model narrating what the log says, on a stored campaign that
   survives a reload (§7, milestone I-3).

The starting numbers, 2026-09-21, unique over all twelve paths at level 5.
**These are now generated**: `npm run ledger` writes `LEDGER.md` and a
freshness test fails on a stale one, so this table is a snapshot of the first
run and the report is the authority.

| Ledger | Size | Waits on an engine shape | Waits on none |
|---|---|---|---|
| Spells in reach, not executed | 141 | 89 | 52 (6 handover-only, Darkness, 45 never adjudicated) |
| Features manual, or a pool with nothing to buy | 55 | 49 | 6 |
| CR ≤ 5 stat-block items: handed-over lines + unapplied hit riders | 434 | on 198 of 242 blocks | 44 blocks already clean |

**The features row was 31/21/10 when this file was written, and the generated
report corrects it to 55/49/6.** Two things were missing. The count was taken
over class and subclass features alone, and a level 5 character also holds a
species and a background — criterion 1 would have been false by omission
without them. And P0-T4 added the five features no automation flag could see:
four pools that count and refill their uses truthfully and buy nothing, plus
Monk's Focus, which buys one of the three things its page prints.

Spells and the bestiary came out of the generated report **entry for entry
equal to the hand-measured snapshot**, which is the evidence that the
promotion was faithful.

**Action Surge and Flurry of Blows are open** (P1-T1, merged): the engine had
been executing what a use buys for a week and no tool reached it.
`use_budget_purchase` is that door, and `reachability.test.ts` now fails on any
engine feature a level 5 character of any path cannot reach. Four pools stay
shut because nothing yet executes what a use buys — Wild Shape, Paladin's
Channel Divinity, Font of Magic, Arcane Recovery — recorded in that test's
`NOTHING_TO_BUY` and checked in both directions.

Seven spells in reach with no definition at all: Magic Missile, Entangle, Find
Familiar, Darkness, Phantasmal Force, Sending, Slow.

## 1. Rules of the road

Everything in `CLAUDE.md` and `docs/dev/WORKFLOW.md` holds. These are added.

1. **Rank by the ledger, never by the book.** A brief is chosen for what it
   finishes *in level-5 reach*. The whole-book blocker tables in
   `COVERAGE.md` stay as they are and stop driving batches. Nothing above
   level 5 is briefed until criterion 1 is met, however cheap it looks.
2. **A door ships with its mechanism.** An engine brief that adds a
   spendable feature, a spell effect a caller elects, or a fact a caller
   declares ships its tool, its `holdingsOf` line and its reachability
   assertion in the same brief, or names in the brief why the door stays
   shut. Action Surge was executed for a week and reachable by nothing.
3. **The shape a brief prescribes is a claim about the code, checked before
   the brief is written.** The audit found the maps wrong four times in one
   ledger: Guidance needs two shapes not one; Faerie Fire's anchor names
   `monster.ts` where the readers are in `conditions.ts`; falling is half
   built behind `declare_falling`; the `aura` scope already exists. Every
   track below carries a *verify first* line. Read it, then the code, then
   the SRD sentence, then write the brief.
4. **Fable is called at gates, not between them.** The architect reviews at
   the five gates in §2 and writes one design note (P2-T22). An `ESCALATE`
   from a reviewer that is a rules question goes to the owner as a short
   list; one that is an architecture question waits for the next gate
   unless it blocks more than one track.
5. **Prose is capped.** `STATUS.md` stays under two thousand words: what
   runs as a short list, what does not, the rulings, and a pointer here.
   Its history moves to `docs/archive/`. A commit body says why in under
   sixty words unless the commit is a migration. Digests are for the
   foreman, not the repository.
6. **Every batch regenerates the two derived files once**, `COVERAGE.md`
   and `LEDGER.md`, by the foreman at merge, exactly as `WORKFLOW.md` says
   for the first.
8. **A reader ships with its first writer** — the mirror of rule 2, added at
   G1 after movement modes built a complete mechanism and moved no number.
   No track is briefed whose ledger delta is zero by construction. If the
   owner wants a mechanism, the brief pairs it with the cheapest writer that
   moves a number: `GrantedSpeed.mode` plus Fly would have done it. This is a
   rule of its own, not an exception to rule 1.
9. **Fence by reader, and print the grep.** The three fences drawn wrong in
   Phase 1 all listed the *writers* — definition, schema, resolver — and
   omitted the *readers*. The one brief fenced right (P1-T5) listed where
   `forced` is read, with line numbers. So before writing a brief, grep the
   read sites of the shape's nearest built sibling (`forced`, `speed-change`,
   `DifficultPatch`, `sense`) and put the grep **and its result** in the
   brief; every file it returns is in the fence. A builder that finds a
   reader outside its fence and inside nobody else's claims it in the digest
   and proceeds; one inside another track's fence stops. That licence is what
   P1-T3 took without asking and was right to take.
7. **What not to do.** Do not reorganise the flat engine tree. Do not add a
   generic abstraction ahead of a second concrete consumer. Do not regenerate
   the frozen fixtures. Do not run `srd:index` in a worktree. Do not brief a
   track whose ruling in §9 or §10 is still open. Do not write another
   whole-engine audit before gate G3.

## 2. Gates: where the architect looks

Each gate is one architect session at most. The foreman prepares the gate
packet before calling: the regenerated `LEDGER.md` and `COVERAGE.md` deltas,
one paragraph per track that deviated from its brief, the §10 list of open
questions, and the session-test handover count.

| Gate | When | The architect decides |
|---|---|---|
| **G0** | now | this roadmap; done |
| **G1** — **held 2026-09-21, see §5.0** | Phase 0 and Phase 1 merged | whether the ledger tooling measures what it claims; re-rank Phase 2 from the regenerated ledger; approve the sight-model design note (P2-T22) for the owner's ruling |
| **G2** | Phase 2 merged, integration milestone I-1 reached | re-rank Phase 3; decide whether any Phase 3 group needs a design note; check the Infinite Realms adapter holds the doctrine's lines |
| **G3** | Phase 3 at ledger zero, milestone I-2 reached | criteria 1–3; the last shapes that resisted; whether the tail's handovers are honest |
| **G4** | milestone I-3 | criterion 4; declare levels 1–5 playable; open the level 6+ question |

Between gates the foreman merges clean tracks without asking, exactly as
`WORKFLOW.md` step 4 says.

## 3. Phase 0: instrumentation first

Small, and before any mechanics, because every later batch is chosen and
measured with these. One batch, tracks partitioned by file.

- `[x]` **P0-T1 The ledger becomes a generated file.** Promote the audit's
  scripts (`node_modules/.audit/ledger-*.ts`, copies of their output in
  `docs/dev/roadmap-ledger-2026-09-21.md`) into
  `packages/content/scripts/ledger.ts`, run by `npm run ledger`, writing
  `LEDGER.md` with the three tables of §0 and, under each, every item by
  the shape it waits on, and a freshness test on the pattern of
  `playable-levels.test.ts`. Files: `packages/content/scripts/`,
  `package.json`, root. Moves: the number that goes to zero exists.
  *Verify first:* the restriction to level-5 reach must use the same reach
  rule `playableLevels` uses (cantrip where `cantripsKnown > 0`, a spell
  whose level the class table has a slot of at level 5).
- `[x]` **P0-T2 The reachability test.** In `packages/tools`, build one
  level 5 character per path with `createCharacter`, fold, read
  `holdingsOf`, and assert every `automation: 'engine'` feature is one of:
  passive, creation-time (spellcasting, subclass, ASI, expertise, mastery,
  extra attack, unarmoured defence, strike style, granted spells), a
  reaction whose window `TAKEN_BY` answers, or spendable with a `spentBy`.
  It fails today on Action Surge and Flurry of Blows and passes once P1-T1
  lands; brief the two together. Files: new
  `packages/tools/src/reachability.test.ts`, `holdings.ts`
  (`budgetPurchases` branch). Moves: criterion 2 exists.
- `[x]` **P0-T3 The session test.** In `packages/tools`, a scripted level 5
  party (Fighter, Cleric, Rogue, Wizard is the suggestion; four paths that
  between them touch weapons, slots, Sneak Attack, Channel Divinity and
  concentration) against a CR-appropriate encounter, through
  `createSurface` and `createDmSurface`: place, roll Initiative, four rounds
  using every printed line and every held feature the surfaces expose, end
  the fight, Short Rest, Long Rest, `advance_character` to 6. Count every
  `unverified` clause, every handed-over line and every `manual` feature the
  party held and could not use. Print the count; assert nothing yet. Moves:
  criterion 3 exists and is a number from day one.
- `[x]` **P0-T4 Widen the feature blocker map** (owner ruling 4,
  2026-09-21). `packages/content/scripts/missing-feature-shapes.ts` selects
  its population by `automation === 'manual'`; add a second population of
  `engine` features whose grant is a bare `pool` or whose note says a half is
  unapplied, and entries for `druid:wild-shape`, `sorcerer:font-of-magic`,
  `wizard:arcane-recovery`, `paladin:channel-divinity`, `monk:focus` (Patient
  Defense and Step of the Wind). Moves: five features the map could not see.
- `[!]` **P0-T5 The yard.** All small, one builder, one commit each:
  `.editorconfig` with `end_of_line = lf`; rewrite the six CRLF lines in
  `packages/engine/src/commands/mastery.ts:282–287`; a shared `linesOf`
  splitting on `/\r?\n/` in the fourteen tests that parse source
  (`invariants.test.ts:3370`, `spell-schema.test.ts:1420`,
  `doors.test.ts:677`, `origins.test.ts:53` are the four that break);
  delete the empty `tools/cli`; drop `export` from the 24 dead values listed
  in the audit's structure report (leave `fold/areas.ts:284`); add
  `performance.now`, `process.env`, `globalThis`, `Intl`, `new Date`,
  `structuredClone` to the engine block of `eslint.config.js`; add items,
  languages, alignments and monsters to the sweep in
  `origin-and-feature-sweep.test.ts` with `spellbook` on the vocabulary
  list. **Pushing and pruning are the foreman's, not the owner's** (owner,
  2026-09-21): at batch close the coordinator pushes `main` and removes every
  worktree whose branch is an ancestor of it, without asking.
- `[x]` **P0-T6 STATUS.md to its cap**, by the foreman: "What runs" to a
  dated changelog under `docs/archive/`, "Next" replaced by a pointer here,
  the rulings kept.

## 4. Phase 1: batch 1

Eleven tracks. The union anchors keep the three files every spell track
touches from conflicting: the `SpellEffect` union
(`packages/engine/src/spell-definitions.ts:750`), `resolveOneEffect`
(`packages/engine/src/commands/spell-resolution.ts:1747`) and `checkEffect`
(`packages/engine/src/spell-schema.ts:1254`); and in
`packages/content/src/spells.ts` each track inserts after the named export so
no two hunks are adjacent. Line numbers are as of `f163717`; re-read them.

- `[x]` **P1-T0 Triage the 45 unadjudicated tracked spells in reach.**
  Content only. The list is in the ledger §1(a). For each: read the SRD
  paragraph; write the definition if every mechanical clause fits an existing
  effect kind or grant (Expeditious Retreat's Bonus Action Dash is an
  `action-rule`; Alarm's trigger is a handover); otherwise give it an entry
  in `TRACKED_ADJUDICATED` naming the shape it waits on. Do not invent a
  shape id; if none fits, file it under `a-world-fact-nothing-can-represent`
  with the sentence quoted. Moves: the ledger becomes honest; some spells
  execute on no engine change. *Verify first:* "no entry" means unread, not
  finished; the audit over-read it as finished.
- `[x]` **P1-T1 The `use_budget_purchase` door.** `useBudgetPurchase`
  (`packages/engine/src/commands/budget.ts:52`, on the barrel at
  `commands.ts:130`) is complete and reachable by nothing. Add the tool after
  `use_pool_option` in `packages/tools/src/definitions.ts`, a `SPENT_BY`
  member after `'action-price'` in `holdings.ts`, the `budgetPurchases`
  branch in `holdingsOf`, and the reachability test (P0-T2). Moves: Action
  Surge, Flurry of Blows.
- `[x]` **P1-T2 Darkness, tracked.** Its `BLOCKED_ON` entry is four
  handovers and one expressible clause: a 15-foot Sphere at a point
  (`SpellArea`, `spell-definitions.ts:1558`). Write it after `DAYLIGHT` in
  `spells.ts`, delete the `BLOCKED_ON` entry, let `coverageGaps().stale`
  confirm. It executes only when the sight model lands (P3-S). Moves: 1 of
  7 undefined.
- `[x]` **P1-T3 A choice made at the casting, and a bonus narrowed to a
  skill.** One track because Guidance needs both. The pattern is
  `damageTypeStated`: a second stated field on `SpellDefinition`, carried
  by `cast_spell`, pinned at the cast. `BonusApplies`
  (`packages/engine/src/bonuses.ts:54`) gains a skill narrowing; `RollSelector`
  (`roll-modifiers.ts:116`) already narrows a *mode* by skill and is the
  model. Files: `spell-definitions.ts` (field), `bonuses.ts`,
  `commands/casting.ts`, `commands/spell-effect-grants.ts`,
  `spell-schema.ts`, `spells.ts` after `GUIDANCE`. Moves: Blindness/Deafness,
  Enhance Ability, Lesser Restoration, Guidance, Thaumaturgy;
  `bard:jack-of-all-trades`; a clause each on Enlarge/Reduce, Glyph of
  Warding, Hex, Enthrall, Slow, Pass without Trace.
- `[x]` **P1-T4 A condition benefit an effect takes away.** Union anchor
  after `end-condition` (`spell-definitions.ts:1081`); dispatch after
  `case 'end-condition'` (`spell-resolution.ts:1785`); validator after the
  same case (`spell-schema.ts:1387`). The readers that grant the Invisible
  condition its benefits are in `packages/engine/src/conditions.ts`
  (`initiativeConditionModes:505`, the attack-side halves at 275–360), **not**
  `conditionApplicability` in `monster.ts` as the map says. Files:
  `conditions.ts`, `commands/spell-effect-conditions.ts`, `spells.ts` after
  `FAERIE_FIRE`. Moves: Starry Wisp, Faerie Fire, Mind Spike.
- `[x]` **P1-T5 Forced movement, and what is left of falling.** Union anchor
  after `teleport` (`spell-definitions.ts:1522`, the last member); dispatch
  after `case 'teleport'` (`spell-resolution.ts:1791`); validator after it
  (`spell-schema.ts:1537`). `MoveCommand.forced`
  (`commands/movement.ts:58`, read at 269, 308, 321, 379) is the built half: a
  forced move spends nothing and provokes nothing. Falling has a declaration
  (`declare_falling`, `falling.test.ts`) and no damage rule: 1d6 Bludgeoning
  per 10 feet to 20d6, Prone on landing. Files: new
  `commands/spell-effect-movement.ts`, `commands/movement.ts` (read),
  `vitals.ts` for the fall, `spells.ts` after `THUNDERWAVE` and after
  `FEATHER_FALL`. Moves: Thunderwave, Levitate, Feather Fall;
  `monk:slow-fall`; the push half of Open Hand Technique and the monster
  push riders.
- `[x]` **P1-T6 Several attack rolls from one casting.** A count on the
  existing `attack` member (`spell-definitions.ts:761`), each roll able to
  take its own target, scaled by slot or by cantrip level; validator inside
  `case 'attack'` (`spell-schema.ts:1263`). Files:
  `commands/spell-effect-rolls.ts`, `spell-definitions.ts`, `spell-schema.ts`,
  `spells.ts` after `ELDRITCH_BLAST`. Moves: Eldritch Blast's beams at level
  5, Scorching Ray. Chromatic Orb is left one blocker short.
- `[x]` **P1-T7 Healing modified by an effect, and a hit point maximum a
  spell moves.** Union anchor after `turn-payout` (`spell-definitions.ts:964`);
  dispatch after `case 'turn-payout'` (`spell-resolution.ts:1777`); validator
  after it (`spell-schema.ts:1447`). `heal` (`vitals.ts:210`) and
  `healCreature` (`commands/creatures.ts:557`) are the sites; a maximum that
  moves must survive `advance_character`'s own recomputation. Files:
  `vitals.ts`, `commands/spell-effect-hit-points.ts`, `commands/creatures.ts`,
  `spells.ts` after `BEACON_OF_HOPE` and after `AID`. Moves: Beacon of Hope,
  Chill Touch, Aid; `draconic-sorcery:draconic-resilience`.
- `[x]` **P1-T8 What a creature is holding.** Hands, and a conjured thing
  that occupies one. `docs/design/characters-and-equipment.md` says nothing
  checks two hands are free. Files: `commands/inventory.ts`, `character.ts`
  (the equipped set), `spells.ts` after `GOODBERRY`. Moves: Goodberry, Flame
  Blade; Heat Metal and Fear each one short. *Sequence:* P1-T13 also edits
  `character.ts`; give the file to one of them and queue the other.
- `[x]` **P1-T9 A standing effect derived from where a creature stands.**
  `StandingScope` already has `{ kind: 'aura'; feet }`
  (`packages/engine/src/standing.ts:96`). *Verify first:* establish what an
  aura does not reach today before writing the brief; the shape's prose
  predates the scope. Files: `standing.ts`, `commands/spell-effect-grants.ts`,
  `spells.ts` after `SPIRIT_GUARDIANS`. Moves: Zone of Truth, Spirit
  Guardians; the Fire Aura and Stench stat blocks.
- `[x]` **P1-T10 An effect a hit buys, for stat blocks.** The largest single
  mover in the ledger. The rider is already carried verbatim as a string on
  every parsed attack line; parse it into a structure (a save with DC,
  ability and outcome; a condition; extra damage; a grapple with escape DC)
  and apply it through the effect list a hit buys that Stunning Strike rides
  on (`HitOption`, `standing.ts:1364`; `commands/hit-riders.ts`). Files:
  `packages/srd/src/schemas.ts` and the parser under `packages/srd/src/parse/`,
  `packages/engine/src/monster.ts`, `character.ts` (`StatedAttack:84`),
  `commands/attacks.ts`. *Verify first:* whether to parse at ingest (touches
  the generated JSON and the committed index; CI regenerates and diffs) or at
  `adaptMonster` (engine side, no re-ingest). Moves: 31 CR ≤ 5 blocks freed
  outright, 104 lines on 93 blocks; the Ghoul's paralysis, the Wolf's Prone.
- `[x]` **P1-T13 Movement modes and jumping** (owner ruling 1, 2026-09-21:
  build them). Fly, Climb, Swim, Burrow as speeds on the sheet and on a stat
  block's printed speeds; a move names its mode; climbing or swimming
  without the speed costs double, difficult terrain stacks; a flier that is
  knocked Prone or has Speed 0 falls unless it hovers (P1-T5's fall); the
  long jump and high jump as the glossary prints them. Files:
  `positioning.ts`, `character.ts` (Speed), `commands/movement.ts`,
  `monster.ts`, `spells.ts` after `FLY` and after `JUMP`, the `move` tool's
  schema. Moves: Spider Climb, Fly, Jump; `thief:second-story-work`; 26 CR ≤
  5 blocks (17 movement, 9 amphibious). *Sequence:* shares `character.ts`
  with P1-T8 and `commands/movement.ts` with P1-T5 (read only there).

Expected at G1: 20 or more of the 89 spells finished, 4 of the 21 features,
2 made reachable, 1 definition written, clean CR ≤ 5 blocks from 44 to about
100, P1-T0's triage recorded.

**Actual, after the batch merged (2026-09-21).** Spells executed 113 → 118;
spells in level-5 reach not executed 141 → 130. **Waiting on a shape went 89
→ 90, upward**, and that is the batch's most useful number: P1-T0 read
forty-five spells nobody had ever read and found twelve debts among them,
while eleven spells were finished elsewhere in the same batch. The old 89 was
not a measurement, it was an absence of one. CR ≤ 5: unapplied lines 434 →
416, clean blocks 44 → 50. Two of the eleven tracks did not build: P1-T4 and
P1-T13, both for reasons in §10 rather than for want of trying, and P1-T10
delivered about half of its 31 blocks with the rest behind one field.

## 5.0 G1, held 2026-09-21

### Job 1 — does the ledger measure what it claims?

**The tooling faithfully measures the populations it encodes, and its guards
are sound. The claim that those populations are the complete set between here
and criterion 1 is false in four ways, one serious.**

1. **A tracked spell's `unmodelled` lines are invisible to the ledger.**
   `spellShapesOf` reads `TRACKED_ADJUDICATED[id] ?? []` and never opens the
   definition's `unmodelled`. Of the 40 spells the report files under *waits
   on no shape*, **34 have no `TRACKED_ADJUDICATED` entry at all** — and
   `docs/design/content.md` is explicit that an `unmodelled` line *is* a debt.
   Darkness carries four such lines, Daylight three, Light three. **There is
   no shape id for light or obscurement in `MISSING_SHAPES`**, so a reader who
   wanted to record the debt could not. The report contradicts P3-S.
2. **"Waits on none" conflates three claims** — nobody has read it; it is
   expressible and nobody wrote it; it is handed over. Only the third is
   finished. The 89 → 90 → 89 movement is the instrument *working*: a
   measurement over adjudications must rise when somebody reads. The fault is
   that the unread state is displayed as zero rather than as its own number.
   **The fix is a third column, not a different metric.**
3. **Two populations have no row**: feats (16, 9 in reach, 0 manual today —
   costs nothing now and will cost silently) and items. And the glossary's
   general rules have no population at all: Search, Study, Influence and
   Utilize name their own absence, and the mastery property **`nick` occurs in
   no engine source file**, which a level 1 Rogue with a scimitar reaches.
4. **The bestiary row is honest**, and the criterion-3 reading was right: a
   skeleton refused for being Incapacitated is the engine correct and the
   script miscounting. Reclassify `refused/incapacitated` on a monster.

**Expect the 89 to rise again, by at least six, once this is recorded. That is
the honest number.** The work is content and generators only, no engine file.

### Job 2 — Phase 2 re-ranked

Three claims checked, then the order.

- **The rider finding holds and is already the codebase's own doctrine**
  (`OutcomeRiders`' docstring states it; `spell-schema.test.ts` pins the two
  vocabularies disjoint). Two consequences: **Shocking Grasp is built bar one
  word** — `RiderDuration` has `end-of-targets-next-turn` and no
  `start-of-targets-next-turn`; adding it is three switch arms, one validator
  line and a test, and the `ADJUDICATED` reason is stale. And wave 1.5 spelled
  a target-anchored span **a second way** (`HitOption.lasts`/`lastsOn` through
  `turnAnchored`); the Shocking Grasp track resolves the new member through
  that same `turnAnchored` rather than a fourth `endOfNextTurn` call.
- **The top shape is not three mechanisms; it is five**, and its largest arm
  finishes one spell. Shocking Grasp (built bar a word); an extra action a
  running effect grants each turn (Expeditious Retreat, Haste); a compelled
  action spending another's budget (Dissonant Whispers, Command — owner's);
  actions with no spender, which is the existing id
  `an-action-the-engine-has-no-spender-for`, **mis-filed**; and Hideous
  Laughter's self-cure-forbidden. After the split it reads about 1/1, 2/1,
  2/0, 3/0, 1/0 and **drops out of the top of Phase 2**.
- **The ingest constraint in the G1 packet was overstated, and the foreman's
  brief to P1-T13 was wrong about it.** `packages/srd/raw/*.md` is tracked;
  `srd:ingest` reads it and writes both the gitignored JSON and the committed
  index, and **runs in any worktree**. What is true is the narrower
  `WORKFLOW.md` rule: `srd:index` must not run on copied, stale JSON. So a
  parser track ingests *then* indexes in its own worktree and commits the
  regenerated index, owning `packages/srd/**` alone for the batch; every other
  live worktree re-ingests after rebasing.

| # | Track | Finishes / moves | Fence (by reader) and sequencing |
|---|---|---|---|
| 0 | **P2-T0 The ledger made honest** — `[x]` merged 2026-09-21 | the 89 rises; Shocking Grasp and Speak with Animals re-filed; the light shape id; `SPLIT_BUNDLES` for P3-A; the third column; the feats row; the glossary table | `packages/content/scripts/**`, `spells.ts` notes. **First, alone, before any other brief cites a number** |
| 1 | **P2-T12 A casting writes a lattice patch** — `[x]` | Grease, Plant Growth, Entangle, Web's and Spike Growth's clauses — **and it is the seam the sight model reuses**, so design `LightPatch` as its second consumer | readers of `DifficultPatch`/`livePatches`: `positioning.ts`, `commands/movement.ts`, `fold/scene.ts`; writer in `commands/casting.ts` |
| 2 | **P2-T18+ the ingest track** — `[x]` — a save a printed line forces, plus the movement and amphibious trait kinds | 14 blocks + 73 lines; 26 blocks | `packages/srd/**` alone, `monster.ts`, `commands/actions.ts`; runs ingest then index and commits the index |
| 3 | **P2-T13′ Movement modes' writers** | Spider Climb, Fly, Second-Story Work; Alter Self one short | `GrantedSpeed.mode`: readers of `speedOf`; `climb-speed` `FeatureGrant` |
| 4 | **P2-S1 `save.condition` optional** — `[x]` | Slow's four clauses, Faerie Fire, **Zone of Truth** — three consumers | `spell-schema.ts` `case 'save'`, `spell-effect-conditions.ts`, `spell-effect-riders.ts` |
| 5 | **P2-T15 Rider on a later weapon attack** | Shillelagh, True Strike, Magic Weapon, Sacred Weapon | `standing.ts` attack-rider family, `attack.ts` |
| 6 | **P2-T14 Magic Missile and Shield** | Shield; Magic Missile | **decide `cannot_hold` on stat-block attacks first**, or the Wizard's Shield stays unreachable |
| 7 | **P2-T16 Senses on the attacker's side** | Mirror Image, Blur | `standing.ts`, `attack.ts`, `attacks.ts` |
| 8 | **P2-F1 species-trait cluster** — `[x]` | Dwarven Resilience, Fey Ancestry, Brave, Protection from Poison | `roll-modifiers.ts`, `conditions.ts` |
| 9 | **P2-T11 Summon** | Find Steed, Phantom Steed; needed by P3-W | as written; owner-ruled |
| 10 | **P2-T17 Non-d20 outcome** | Augury. **Blink is not this anchor** — its end-of-turn roll is a turn-boundary payout | split before briefing |
| 11 | P2-T21, then P2-T19, then P2-T20 | 5 blocks; 2 features | as written |
| — | P3-A's compelled arm | 2 | **not briefed until the owner rules** |

### Job 3 — the sight-model note

Written: `docs/design/light-and-sight.md`, cited from `CLAUDE.md`. It carried
five decisions for the owner and **the owner answered yes to all five, as
written, on 2026-09-21**: light declared on the lattice; no default ambient;
magical darkness defeating Darkvision and nonmagical light, with Devil's Sight
defeating it; sunlight as bright light with a flag; the mutual dispel in
scope. The note is now a ruling rather than a proposal, and P3-S builds it.
P2-T12's lattice patch is the seam it reuses, which is why that track is
ranked first among the builders.

### §10 dispositions taken at G1

- **`TrackedAdjudication.why`: widen it** to
  `'table' | 'engine' | 'expressible' | ShapeId | ItemShapeId`. It ships only
  with `spellShapesOf` treating `'expressible'` as the third column,
  `misanchoredAdjudications` refusing a marker-less `'expressible'`, and the
  `unrecorded` guard from job 1 — without the first, Hex's entry prints
  `expressible` as a shape heading. Part of P2-T0.
- **`FeatureDefinition.grants`: make it plural**, with one `grantsOf`
  normaliser and the validator refusing two grants of one kind unless they
  compose. Five consumers clear the bar. **Splitting a printed feature into
  two ids is refused**: the ledger population, the origin sweep and
  `holdingsOf` are keyed by the page's feature, so two ids double-count and
  put a name in the log the book does not print.
- **May the engine hold a fact only the table reads? Yes, under one rule** —
  when the fact is the recorded outcome of a roll the engine made and a door
  publishes it. Zone of Truth's die is thrown for a printed reason ("You know
  whether each creature succeeds or fails"), and `observe()` already publishes
  per-creature conditions. Build it as a save with no condition whose affected
  creatures the ongoing record keeps and `observe()` lists — no new state
  kind. Prerequisite: `save.condition` optional, which is why P2-S1 is ranked
  where it is.
- **The lopsided split of several attack rolls stays the owner's.** For the
  record: the sayable form is `targets: [{ id, count }]`.

### The level-5 batch, wave two — merged 2026-09-22

Five tracks: three Opus builders launched from the closed wave-one main, and
two of the architect's own — the second after the owner's monthly spend limit
ended the Opus fleet mid-batch, so the rests track was merged on its own three
review passes and everything after it is Fable's alone. **Spells in reach not executed 109 → 109 (waiting 76 → 76). Features 40 → 34,
waiting 34 → 28. CR ≤ 5 items 314 → 258, blocks waiting 154 → 145, clean 90 →
99.** `COVERAGE.md`: class features executed 183 → 186, bestiary printed lines
read 849 → 899 (Actions 698 → 744, Bonus Actions 14 → 18).

- **Wild Shape (architect).** A `shape-shift` grant between
  `unarmored-defense` and `hit-point-maximum`: it declares its pool as
  `activated` does, names the creature type a form must print, carries the
  Beast Shapes table as rows read at the class level, and says how the
  hours and the Temporary Hit Points scale and which scores are kept.
  `CharacterChoices.knownForms` is the learned list, checked at creation.
  `assumeShape` lays the block's `adaptMonster` sheet over the character
  through `assumeStatBlock` (the retained half kept line by line; each save
  and printed skill the higher of the two), pins the merged sheet whole on
  `shape-assumed`, and files a `feature` timer in hours;
  `CreatureState.shape` holds what was replaced and the fold's derived
  `settleShapes` puts it back at every ending. Gear merges and is silent,
  the Armour Class is always the block's, nothing is cast from inside a
  form, and the scene's copy of the size follows the form. Two doors:
  `assume_shape`, `revert_shape`. `NOTHING_TO_BUY` is down to one pool.
- **The bestiary's four buckets.** A stat block that casts (the
  Spellcasting line parsed and declared at `addCreature`, with the printed
  DC pinned; 47 of 48 lines, all 12 at CR ≤ 5; At Will as
  `slotless: 'innate'`, N/Day as a dawn pool); Undead Fortitude as a save
  in front of `damage-taken.floor` that now beats `diesAtZero`; Magic
  Resistance as `RollSelector.againstMagic` answered by the roller; a
  creature's own Illumination derived in `lightAt` from where it stands.
  Every trait kind the schema admits is spent or a handover. Clean CR ≤ 5
  blocks 90 → 95. One correction to the brief: the Adult Bronze Dragon is
  the book's only save DC that its own abilities do not derive.
- **Halfling Nimbleness, and the rule it bends.** `canPassThrough` had
  encoded the glossary's "Moving around Other Creatures" and nothing called
  it; `checkPassage` reads every space a stated route crosses, a move
  stating no route is asked `route_required` only when every shortest path
  crosses somebody it may not pass, forced movement is exempt, and an
  undeclared side is reported rather than ruled on. A `passage` standing
  grant widens the size clause.
- **An option re-chosen on a rest, Sear Undead, Trance.** `rechooseCharacter`
  is the level-up's re-plan minus the level: a patch of the fields a rest may
  hand back, merged into the stored choices and emitted as the difference, so
  an identical patch grows no log. `endRest` reads which questions a feature
  re-asks through the `rechosen-on-a-rest` grant, and only for the rest that
  was *finished*. Circle of the Land's four lands are four `spells` grants
  gated on the answer; Memorize Spell re-asks one prepared line. Sear Undead
  is `pool-options`' new `amends` arm: one d8 roll per use, dealt to each
  Undead that failed through `dealSpellDamage`. Trance is
  `CharacterSheet.longRestSeconds`, compiled from a `long-rest-length` grant and
  absent on every sheet ever written, so both frozen fixtures fold unchanged.
  Three review passes closed the defects; the builder's digest was lost to
  the spend limit and this paragraph is read off its commits.
- **A printed saving throw as an effect list (architect).** `parsePrintedSave`
  reads a line's `_Failure:_` into a small vocabulary — damage and a `plus`
  component, a condition to a turn anchor on the source or the target or for
  a span, a grapple with its escape DC, a size gate, a push straight away, a
  Speed cut, a Hit Point maximum lowered by the damage, a save repeated at the
  end of the target's turns with a minute's cap — and carries every sentence
  it did not read in `handedOver`. Only a line a creature spends is read; a
  failure the vocabulary cannot start on refuses the whole line; graded
  failures and preambles are refused whole; each sentence is transactional.
  `forcePrintedSave` executes it through `applyPrintedClauses` and the
  primitives the casting path had — the grapple `escapeGrapple` answers, the
  shove, a `grants` timer, a negative `hit-point-maximum-adjusted` sourced per
  use. The DM's door reports the conditions that landed, the immunities that
  turned one aside, the feet pushed and the sentences handed over. Actions
  read 698 → 744; the ledger keeps a partly read save on its books under
  `SAVE_HANDOVER_SHAPE`.

Follow-ups this wave created:

- **`knownForms` is not yet re-chosen on a Long Rest.** The mechanism P2-T20
  built re-asks a `FeatureChoice`; a Druid's forms are a `CharacterChoices`
  field beside it. Pointing the one at the other is a small brief.
- **A form's limbs decide nothing about what can be held**, and the block's
  senses are not carried into a form — `sensesOf` reads standing grants and
  `adaptMonster` puts a block's senses nowhere a sheet reads.
- **The monster side of the swap** (Doppelganger, Imp, Werewolf) is the same
  mechanism over the block's own alternatives.
- **The feature blocked-on map's population floor came down to 60**: it sat
  at exactly 100 the day two features left it.
- **`docs/design/space-and-areas.md`** was brought up to date with the
  passage rule by the coordinator; the builder could not edit docs.

### The level-5 batch — merged 2026-09-22

Seven tracks: six Opus builders in parallel and the architect's own, chosen
after five research passes verified every shape against the code first (rule 3)
and printed every fence (rule 9). **Spells in reach not executed 111 → 109,
waiting on a shape 78 → 76. Features 53 → 40, waiting 47 → 34. Glossary rules
waiting 7 → 0. CR ≤ 5 items 377 → 314, blocks waiting 181 → 154, clean 63 →
90.** `COVERAGE.md`: executed 134 → 137, verified 98 → 100, class features
executed 180 → 183.

What landed, by track:

- **Kept summons (architect).** `SummonBond.castingId` may be null and `kept`
  binds a creature to its *summoner*: owed a departure at 0 Hit Points, or
  when the summoner dies where the spell prints it, replaced by a second
  casting. A form stated at the casting (`CastSpellRequest.form`,
  `SummonedForm` as an id or a printed list plus a type-and-rating clause), a
  creature type through `choiceStated` `of: 'creature-type'`, Speeds the spell
  prints over the block gated on the slot, `cannotAttack` as a stored action
  rule, and `Combatant.after` seating a follower immediately after its anchor.
  **Find Familiar is written**; Find Steed keeps one honest debt — the
  Otherworldly Steed's block lines whose numbers are the summoner's, which the
  parser never sees. `a-turn-a-spell-inserts-into-the-order` lost its spell
  consumer; `a-stat-block-created-mid-fight` means two things now, both said.
- **Magic Missile and Augury.** `auto-damage` (a pool of hits dealt like
  Scorching Ray's rays; `attackRollsIn` is `aimedRollsIn`; Sanctuary wards a
  dart) and `chance` (a d100 against a flat or cumulative percentage, ported
  from the Wind Fan's `itemFailure`; a failed Augury withholds the omen).
  **Shield's Magic Missile clause is not finished** and was re-filed under
  `a-reduction-an-effect-applies-to-damage` with a widened description.
- **The feature vocabulary.** `hit-point-maximum` grant (Dwarven Toughness,
  Draconic Resilience), `onlyIfChoice` on every grant (Draconic Ancestry),
  `grants` plural through `featureGrants` (the G1 decision, built), and a
  species that grants a spell (`originGrantedSpells`,
  `CharacterChoices.featureSpellcasting`; both Tiefling traits). Four shapes
  retired; `a-second-question-one-feature-asks` minted for Divine and Primal
  Order's cantrip.
- **The integration seam.** `restoreCampaign` / `serializeCampaign` with a
  caller-supplied `contentRef`; `toolSchemas` / `openAiTools` in OpenAI
  function-calling shape, non-strict, with the length pinned;
  `settleTurnPayouts` now emits `rolls-issued` and a homebrew fixture drives
  the sweep down that branch; the session census stopped counting a
  trade-doored pool as door-less (**engine pools with no door: 0**).
- **Bestiary trait readers.** Flyby, Standing Leap, the Nimble Escape family
  (as Cunning Action's `allows`), Shadow Stealth, Bloodied Fury; the three
  breathing kinds recorded as handovers under `HANDOVER_TRAIT_KINDS`. +27
  clean blocks. Spider Climb waives the check, not the cost — RAW, and a test
  pins it.
- **The glossary and the hand.** Help, Influence, Search, Study, Utilize as
  named actions with spenders (DM-only `take_tested_action` for the three
  that need a DC); an ability check now spends a one-shot modifier; the Light
  property's extra attack as `AttackCommand.lightAttack` with Nick and the
  Two-Weapon Fighting feat; Tactical Shift as a granted move. "Which hand" was
  never the fact — which Light weapon this turn's Attack action swung is.
- **Dice and vitals.** Savage Attacker as a whole-roll rule (`RollRule`,
  `rollUnder`); Luck as a reroll inside the D20 pipeline reached through the
  sheet; Relentless Endurance as `damage-taken.floor` with a tally counted off
  the event; Powerful Build through `conditionEndedBy` in both escape rollers
  and a `carrying-capacity` grant.

The research passes corrected the roadmap before a brief was written: every
P2-T14/P2-T17 anchor was stale; "Shield finished" was false; Blink is not the
non-d20 anchor; Augury's cumulative chance already existed for items; the
extra-damage rider mechanism already exists (`ExtraDamage`) and "plus 7 (2d6)
Poison" after the Hit is a parsed second component, not a rider — only the
gated forms are unapplied; the `cannot_hold` refusal was already lifted;
movement-mode grants were fully built; `canPassThrough` was written and
unreachable; carrying capacity was built while three notes said otherwise.

Follow-ups this batch created:

- **Shield's re-filing wants a gate's eye**: `a-defence-narrowed-to-one-source`
  may be the honest id rather than the widened
  `a-reduction-an-effect-applies-to-damage`.
- **Augury's targets became `{ count: 1, self: true }`**, so a Range: Self
  casting asks for a scene (`needsContext` naming `setScene`); narrowing that
  gate for a self-only spell is its own brief.
- **`level-five-session.test.ts`'s Turn Undead moment rests on seed luck**
  (re-seeded `a-level-five-session-13`, measured 2 in 8); script the
  Frightened-then-swing moment or assert the classifier on a constructed call.
- **`takeHide` spends no one-shot**, so a Help on Stealth reaches a Hide and
  is not consumed by it.
- **`checkSummonTargets` is weaker than `checkChanceTargets`**: it still admits
  `extraPerSlotLevelAbove`, `unlimited` and an `area` beside a summons.
- **Heroic Inspiration needs a design note**: "reroll any die immediately after
  rolling it" is a choice made after a settled roll, which no window or
  pipeline reroll models.
- **`cast_spell` has no `ritual` field** although `CastSpellRequest.ritual`
  exists; a Find Familiar through the tool spends a slot for its hour.
- **The `allowance !== null` arm of `usingGrant`'s refusal is unreachable**
  until a readied move can name a grant.
- **Find Familiar keeps three debts** (senses lent to the caster, the touch it
  delivers, the pocket dimension); **Wild Companion** needs a casting paid
  from a sibling's pool and a lifetime ending at the summoner's Long Rest.
- **`sheds-light` had no reader** at merge; wave two builds it.

### The objects batch — merged 2026-09-22

Nine tracks. **Spells in reach not executed 118 → 111, waiting on a shape
85 → 78.** Features 55 → 53. Two of the four dead pools — Font of Magic and
Arcane Recovery — left `NOTHING_TO_BUY`. `a-spell-that-answers-a-later-attack`
**retired entirely**. Objects, dropped items and carrying capacity arrived on
the owner's ask.

**Three defects of one class in one batch, and the guard for them now exists.**
`forcePrintedSave` rolled dice and emitted no `rolls-issued` (found last
batch); `settleTurnPayouts` does the same and is **still open**, reported
rather than fixed because it sat in another track's fence; and a ward's die
went uncounted in `resolveAttack` because `issuedBefore` was marked below it,
which made the *next* command re-issue a `RollId` already in the log. The new
sweeps in `invariants.test.ts` catch the class without an allow-list — a
counting `Rng` per command plus a call graph seeded on `rng.int` and the
`'rolls-issued'` literal. **Neither sweep caught `settleTurnPayouts`**, and
the builder said why: the corpus drives it down a payout with no dice, and the
reachability half is an over-approximation that its own test names. That gap
is the follow-up.

**The `SpellEffect`-versus-rider lesson generalised.** Three shapes this batch
turned out to be mis-described rather than missing: `CastingEndTrigger` had two
readers because the grep searched the *type* and the mechanism's name is the
*field* (`endsEarly`, read in `fold/endings.ts`); `an-effect-that-suppresses-
other-magic` is three mechanisms; and `an-action-a-spell-compels-or-forbids`
was five, now split into three new ids with the bundle narrowed from twenty
spells to seven.

**Mirror Image fires on a hit, not on targeting** — SRD 5.2.1, *"Each time a
creature hits you with an attack roll."* Every prose note on the spell said
targeting, each inheriting it from the last, and **three tracks failed on that
one word** before a builder read the book. Worth remembering when a claim is
repeated in several places: agreement between notes is not evidence, because
notes copy each other.

Follow-ups this batch created:

- **`settleTurnPayouts` emits no `rolls-issued`** (`commands/turns.ts:248`,
  reached from `scene.ts:338` and `turns.ts:1040`). Latent under SRD — no
  catalogue `turn-payout` carries dice — but reachable through `createContent`,
  which rule 4 makes a supported door. One-line fix plus a corpus fixture whose
  payout carries dice; they belong in the same change. **And widen the sweep
  so it would have caught it.**
- **An object cannot make an ability check.** A door asked for a Strength check
  rolls at −5 and can succeed. A *refusal* is a different shape from a
  failure and changes what ten call sites see — a decision, not a defect.
- **Nothing stops an object entering the turn order**, and then `endCombat`
  answers `undeclared_side` and the fight cannot close. Refusing an Object in
  Initiative looks right (an Animated Object is a Construct, not an Object).
- **The tool surface cannot tell a warded swing from a refusal**: a warded
  attack returns `hit: null` and a deflected one `hit: true` with no damage,
  both recoverable from the log but not from the door's own summary.
- **`item-transferred` has the conjured-line hole `item-dropped` closed** — a
  transfer naming a conjured kind removes nothing and gives the taker the
  difference.
- **A `scene-set` clears the floor**, so a sword left in the last room ceases
  to exist. Consistent with the scene unplacing everybody, tested, flagged.
- **Light from an object** still waits: an object can be broken and cannot yet
  carry a light patch. Light, Continual Flame and Dancing Lights.
- **Shatter needs one shape**: an area effect that also damages objects caught
  in it with no save. `CREATURE_TYPES` does not contain `Object`, correctly.
  Its Construct clause is buildable today.
- **The Speed-5 consequence of over-capacity** is unbuilt; `carryingCapacity`
  returns both figures so the rule is one read away. Coins have no weight.
- Confusion's and Tsunami's notes still say the economy has no lever for a
  spell to forbid an action, which `ActionRule` made false two batches ago.

**A process note worth keeping.** Two tracks each rewrote the same ranking
guard in `blocked-on.test.ts` for the ranking *their own branch* produced, and
neither assertion survived the merge of both — the true leader was a third
shape. A guard that names a number from one branch's view is a guard that
breaks when batches land together; assert the measurement, not the name.

### The sight batch — merged 2026-09-21

Six tracks. **Spells in reach not executed 124 → 118, waiting on a shape
91 → 85.** Darkness, Daylight, Fog Cloud, Shocking Grasp, Magic Weapon, Zone
of Truth, Find Steed, Phantom Steed; Shield fires in the scripted session for
the first time. `light-and-obscurement-the-scene-holds` led the ledger at
7 blocks / 6 finishes and reads **3 / 3**.

**The ledger chose this batch, and the roadmap's phase numbering did not.**
The sight model is §6's P3-S, and it ran now because P2-T0's honesty pass gave
light a shape id and the six spells it had been hiding, which put it at the top
of the ranking. Rule 1 says rank by the ledger; this is the first batch where
that overrode the written order, and it was right.

**A determinism defect was found and fixed before it could write a log.**
`forcePrintedSave` rolled four dice per call and emitted no `rolls-issued`, so
two calls drew the identical stream and minted duplicate roll ids. Track E
found it by probing rather than reading, stopped rather than cross a live
fence, and track A fixed it in the file it owned. **No log was ever written
with the hole in it** — nothing under `packages/tools` named the command until
this batch — so it is a fix and not a migration.

Follow-ups this batch created:

- **The sweep cannot catch the next one.** `beginning-a-fight.test.ts` catches
  a non-command that *writes* a `rolls-issued` by hand, and cannot catch a
  command that rolls and *forgets* one — which is exactly the hole above. The
  natural home is `invariants.test.ts`, which already walks every command.
  **This is the highest-value follow-up on the list**: it is the guard the
  engine's first rule rests on.
- **`COVERAGE.md` prints `332/330 stat blocks carried`.** The two hand-written
  spell stat blocks are in the numerator and not the parsed denominator. The
  guard is honest (`SPELL_STAT_BLOCKS` is named rather than equality asserted)
  but the printed fraction reads as a bug.
- **Light from an object** — Light, Continual Flame, Dancing Lights — waits on
  the engine holding objects at all. Named residue of the light shape.
- **The light monster residue** (Sunlight Sensitivity ×4, six Illumination
  traits, Shadow Stealth, Sunlight Weakness) is untyped SRD text and needs
  `packages/srd/src/parse/monsters.ts` plus a re-ingest. The rule is built;
  the creature carrying it is what waits. Same track shape as P2-T18.
- **Find Steed and Phantom Steed execute but neither finishes**: a lifetime
  that is a *summoner's* life rather than a casting's, a Fly Speed gated on a
  slot level, a turn inserted at a named position in the order, and a casting
  ended by damage to the thing it made.
- **Mirror Image and Sanctuary need a shape nobody has built**: an ongoing
  effect on the defender that intervenes in somebody else's attack with nobody
  taking a Reaction. Fire Shield and Holy Aura are the other claimants. This
  is the third batch in which Mirror Image was claimed as a mover and the
  third in which it was not one.
- **Daylight carries `sunlight: true`**, so it gives a Kobold Disadvantage and
  burns a Vampire Spawn. SRD 5.2.1 prints "sunlight" three times in that
  paragraph and `srd-policy.md` ranks printed text above the 2014 errata.
  One word in its docstring overturns it if the owner disagrees.

### Phase 2, first batch — merged 2026-09-21

Five tracks. **Spells in reach not executed 129 → 124, waiting on a shape
96 → 91** (Fly, Spider Climb, Slow, Faerie Fire, Blur, Plant Growth, Spike
Growth). Features manual 58 → 55, origin features executed 14 → 17. CR ≤ 5
lines 400 → 382, clean blocks 56 → 60. Rule 8's debt is discharged: the
movement mechanism built for nothing last batch now pays.

**Rule 9 earned its place on the first day.** Two of G1's own fences were
wrong — `DifficultPatch` has three readers and not the four it named, and
fencing P2-T13′ on `speedOf` (eighteen readers) instead of `GrantedSpeed`
(four) would have swallowed the batch. Every brief printed its grep.

**Three briefs still named movers that were not there**, all from the gate's
list taken at face value: `sacred-weapon` is filed under a different shape
entirely; P2-T18's "40 blocks" was P1-T13's *execution* promise read onto a
parser track; and P2-T16's Mirror Image needs a condition axis a sense axis
cannot express. The lesson is not new, it is rule 3, and it now applies to a
gate's output as much as to a blocker map.

Follow-ups this batch created, in the order I would take them:

- **`forcePrintedSave` reaches no caller.** It is on the engine barrel and in
  no tool, and `ObservedBlock.actions` carries no flag saying the engine could
  roll a line's save, so none of the 18 executable lines is reachable from
  above. Rule 2, and the brief failed to name why the door would stay shut.
- **Zone of Truth needs its own brief, and the gate's premise for it was
  false.** `OngoingSpell.aimed` is written once at the cast and only ever
  shrinks; `aimedAt` returns empty for an area, because standing in an area is
  not being cast on; and `observe()` publishes no ongoing casting at all. The
  doctrine ruling stands — the engine may hold a fact only the table reads
  when it is the outcome of a roll the engine made and a door publishes it —
  but the door does not exist. A new `GameEvent` variant, a fold-seam write
  and a new `Observation` field.
- **Powerful Build is cheaper than its new entry implies.** Two ability-check
  rollers already hold the timer that names the condition instance
  (`resolveEffectCheck`, `escapeGrapple`), and `conditionEndedBy` is the whole
  derivation. One argument in each, plus relaxing `condition_off_a_saving_
  throw`.
- **Entangle** stays blocked on an area that excludes its caster — without it
  the spell Restrains the druid who cast it.
- **P2-T15 lost three of its four movers** to verification; only Magic Weapon
  is real, and it needs "the weapon *this casting* was aimed at", which
  `onlyWithItem` (the granting item's id) and `onlyWithWeapon` (a kind, not a
  copy) cannot say.
- **Dead patches accumulate in `scene.terrain`** — filtered by `livePatchesOf`,
  never swept, now reachable once per area casting.
- **`LEDGER.md`'s `clean` column changed meaning**, and `LedgerMonsters` gained
  a public field: a block is clean when its lines are read *and* spent, not
  merely parsed. Any track quoting the old number is quoting a different
  question.

### P2-T0's result, and the three things it could not do

Merged 2026-09-21. **Spells waiting on a shape 89 → 96**, which is the track
working: six light spells against the new `light-and-obscurement-the-scene-
holds`, plus Remove Curse. Thirty-three more now say `'table'` plainly instead
of reading as no debt. Features 55 → 58 (the feats arm). Two populations get a
first row: **157 items a party can buy** (0 waiting on a shape) and **22
glossary general rules, 7 of them waiting**, among them `nick` — a mastery
property a level 1 Rogue with a scimitar reaches and which occurs in no engine
source file. Criterion 3's incomplete calls 3 → 1, an engine-correct refusal
no longer counted as a session failure.

- **`misanchoredAdjudications` no longer refuses a marker-less `'table'`
  entry** (it still refuses marker-less `'engine'` and `'expressible'`). All
  34 spells trip zero `MECHANICAL_MARKERS` anywhere in their prose — which is
  exactly why no guard had ever demanded an entry of them — so a marker-less
  entry was the only entry any of them could have. The refusal's stated
  justification was that a tracked definition's own `unmodelled` is where
  narration already goes, which `docs/design/content.md` contradicts and G1
  overturned. Accepted by the foreman on the reviewer's reasoning.
- **`why` wants a third id space, and this is now the third time the field has
  been too narrow.** `an-action-the-engine-has-no-spender-for` — where G1 said
  Speak with Animals, Gaseous Form and Haste's Utilize belong — is a
  **feature** shape in `missing-feature-shapes.ts`, not a spell shape, so
  filing a tracked spell against it needs `FeatureShapeId` in the union that
  G1 enumerated without it. Two consequences wait on that one decision: those
  three spells stay mis-filed, and `SPLIT_BUNDLES` for
  `an-action-a-spell-compels-or-forbids` cannot be written because the split
  needs more than one destination. The five arms and their counts are recorded
  in the bundle's own description meanwhile, so nobody briefs it as a unit.
  **Held for G2** under rule 4 — it blocks two entries, not two tracks — but
  it is the same decision taken twice already, and the honest form of it may
  be "`why` names a shape in any of the three maps".
- **Light's recast clause is genuinely expressible and nothing records it.**
  "The spell ends if you cast it again" is `replacesPriorCasting`, which
  exists and which Mage Hand uses; `LIGHT` lacks the field and its own
  `unmodelled` says so. `'expressible'` cannot be written marker-less, so the
  debt is invisible. **One field in `packages/content/src/spells.ts` closes
  it**, and it was outside P2-T0's fence. Cheapest item on this list.

## 5. Phase 2: batch 2

Re-ranked at G1 from the regenerated ledger; this is the expected shape.

- `[x]` **P2-T11 A `summon` effect kind** (owner ruling 2: a bestiary id
  chosen at the casting, with the summons' restrictions enforced; a derived
  content kind is acceptable if simpler; the steeds become catalogue
  entries). Smaller than the map implies: `summonCreature`
  (`commands/creatures.ts:269`), `creature-summoned` (`events.ts:593`),
  `SummonBond` (`state.ts:281`), `summon_creature` and
  `dismiss_stranded_summons` all exist. Missing: the definition naming the
  block, the choice among printed forms, and the restrictions (a familiar
  cannot attack; it acts on the summoner's turn; it delivers a touch spell as
  a Reaction, which is the activation-by-another shape and may wait). Union
  anchor after `dispel` (`spell-definitions.ts:1241`). Content: bestiary
  entries for the Otherworldly Steed and Phantom Steed's mount; Find
  Familiar's forms as ids. Files: `spell-definitions.ts`, new
  `commands/spell-effect-summon.ts`, `creatures.ts` (read),
  `packages/content/src/monsters*`, `spells.ts` after `FIND_STEED`. Moves:
  Find Steed, Phantom Steed, Find Familiar, Animate Dead;
  `druid:wild-companion`; unblocks Unseen Servant.
- `[ ]` **P2-T12 Difficult terrain an area creates, and an area that
  excludes its caster.** `MoveCommand.difficultFeet` (`movement.ts:74`,
  charged at 238) is declared by the foot; the move must consult the areas
  it crosses. Files: `commands/movement.ts`, `positioning.ts`,
  `fold/areas.ts`, `spells.ts` after `PLANT_GROWTH` and at Entangle's slot.
  Moves: Plant Growth, Grease, Entangle written and executed; Web's and
  Spike Growth's terrain clauses.
- `[x]` **P2-T14 Damage with neither an attack roll nor a save, and one
  effect list divided among targets.** Union anchor after `save-damage`
  (`spell-definitions.ts:816`); dispatch after `case 'save-damage'`
  (`spell-resolution.ts:1779`); validator after it (`spell-schema.ts:1270`).
  Files: `spell-definitions.ts`, `commands/spell-effect-rolls.ts`,
  `spell-schema.ts`, `spells.ts` at Magic Missile's slot. Moves: Shield
  finished, Magic Missile written and executed.
- `[ ]` **P2-T15 A rider on a later weapon attack that substitutes the
  ability and the die, and a bonus an ability modifier sizes on attack
  rolls.** `attack-rider` (`spell-definitions.ts:1473`) is the extra-damage
  half; `save-bonus` and `check-bonus` (`standing.ts:326`, `:345`) exist and
  the attack family does not. Files: `standing.ts`, `attack.ts`, `spells.ts`
  after `TRUE_STRIKE`. Moves: True Strike, Shillelagh;
  `oath-of-devotion:sacred-weapon`; Alter Self with P1-T13.
- `[ ]` **P2-T16 Senses beyond declared sight, read on the attacker's
  side.** Ruled 2026-09-20: Truesight and Blindsight see through, Darkvision
  does not, and the set lives beside `canSee`
  (`SENSES_THAT_SOMEHOW_SEE`, `standing.ts:2360`; `sensesOf:2284`;
  `SENSE_NAMES`, `positioning.ts:1782`). Files: `standing.ts`,
  `positioning.ts`, `attack.ts`, `spells.ts` after `MIRROR_IMAGE`. Moves:
  Mirror Image, Blur.
- `[x]` **P2-T17 A random outcome that is not a d20**, as a spell effect
  over the generator that exists, with provenance like any roll. Union
  anchor after `interrupt-casting` (`spell-definitions.ts:1497`). Files:
  `dice.ts`, `commands/spell-effect-rolls.ts`, `spells.ts` after `BLINK`.
  Moves: Augury, Blink; unblocks Gust of Wind, Sending, Slow.
- `[ ]` **P2-T18 A save a printed line forces.** The SRD's form is regular:
  `_Dexterity Saving Throw:_ DC 12, each creature in a 15-foot Cone.
  _Failure:_ 17 (5d6) Fire damage. _Success:_ Half damage.` The economy
  around these lines is built (recharge, per-day, the spend in
  `takeStatedAction`, `commands/actions.ts:464`); only the effect is missing.
  Files: the parser under `packages/srd/src/parse/`, `schemas.ts`,
  `monster.ts`, `commands/actions.ts`. Moves: 14 blocks freed, 73 lines on
  60 blocks; every dragon wyrmling, the Basilisk, the Hell Hound.
- `[ ]` **P2-T19 Printed Reactions on a stat block.** `adaptMonster`
  (`monster.ts:805`) carries none; add `StatedReaction` beside `StatedAction`
  (`character.ts:154`), the answering command in `commands/reactions.ts`,
  and `take_printed_reaction` beside `take_printed_bonus_action`
  (`packages/tools/src/dm/definitions.ts:1021`). Moves: Parry and its kin, 5
  blocks, 13 lines.
- `[x]` **P2-T20 An option re-chosen on a rest, and a later feature that
  rewrites an earlier one's rule.** A `FeatureChoice` is answered once at
  creation and frozen into the sheet; a rest must be able to re-ask one.
  Files: `rest.ts`, `progression.ts`, `commands/features.ts`,
  `packages/content/src/classes/{druid,wizard,cleric}.ts`. Moves:
  `circle-of-the-land:spells`, `wizard:memorize-spell`, `cleric:sear-undead`.
- `[ ]` **P2-T21 The stated-action pair and the scene-placement pair.** Two
  real clones: `takeStatedAction` and `takeStatedBonusAction`
  (`commands/actions.ts:290`, `:464`) become one `takeStatedLine(spec)`;
  `targeting.ts:913` and `:1046` become one `requireScenePlacement`. Pure,
  and it must land before P2-T19 adds a third stated line.
- `[ ]` **P2-T22 The sight-model design note** (owner ruling 3: build it).
  Written by the architect at G1, one page in `docs/design/space-and-areas.md`,
  ruled by the owner, then built in Phase 3 as P3-S. The consumers already in
  the catalogue: Darkness, Fog Cloud, Light, Daylight, Continual Flame,
  Dancing Lights, Produce Flame, Faerie Fire's dim light, Moonbeam's dim
  light, Sunlight Sensitivity, Devil's Sight, Darkvision. The likely shape:
  light and obscurement as declared facts on the lattice and as areas a
  casting or an item creates; the sight question consults them after a
  declaration and before a sense; Heavily Obscured resolves to the Blinded
  rules that exist; Lightly Obscured is Disadvantage on sight-based
  Perception. The one decision worth not making wrongly: the engine holds
  levels of light as *facts*, never as rendering.

Expected at G2: 40 or more of the 89 spells, 3 of 7 definitions, 9 of 21
features, clean CR ≤ 5 blocks past 166 of 242.

## 6. Phase 3: the tail, to zero

Re-ranked at G2 from the regenerated ledger. The groups, in the order the
numbers suggest today. Each group is one or more tracks the foreman cuts by
file ownership.

- `[ ]` **P3-S The sight model**, from the note in P2-T22. Then the spells
  that waited: Darkness executed, Fog Cloud, Light, Daylight, Continual
  Flame, Dancing Lights, Produce Flame's light, Faerie Fire's dim light,
  Sunlight Sensitivity as a `StandingRequirement` the scene can now answer,
  Devil's Sight.
- `[~]` **P3-W Wild Shape**, ruled 2026-09-20 (gear merges; AC is always
  the block's; an oversized form is the forced-movement rule; known forms are
  chosen at the start of a Long Rest; Wild Companion's familiar goes away
  when a Long Rest completes). **The character side is built** (the
  `shape-shift` grant, `assumeShape`, `settleShapes`; 2026-09-22). Left:
  replacing a known form when a Long Rest ends (the P2-T20 mechanism, now
  built, has not been pointed at `knownForms`), Wild Companion, and
  Shape-Shift on the thirteen CR ≤ 5 blocks that print one (Doppelganger,
  Imp, Werewolf) — the same mechanism from the monster side, with the
  block's own alternatives in place of a learned list.
- `[ ]` **P3-I Eldritch Invocations.** First the content shape: a feature
  whose chosen options each carry their own grants (the
  `a-grant-gated-on-one-option-of-a-choice` shape, which Divine Order and
  Primal Order also want). Then the invocations a level 5 Warlock can take,
  as content: Agonizing Blast is a `casting-damage` grant, Armor of Shadows
  and Fiendish Vigor are free castings, Devil's Sight waits on P3-S,
  Repelling Blast on P1-T5, Pact of the Blade on P2-T15's substitution.
- `[ ]` **P3-M The Monk's and Rogue's halves.** A price on an allowance so
  an `ActionRule` can cost a Focus Point (Patient Defense, Step of the Wind);
  an effect list a hit buys that trades Sneak Attack dice (Cunning Strike);
  Open Hand Technique's three riders once P1-T5 and P1-T10 exist.
- `[ ]` **P3-C The casters' halves.** Innate Sorcery (a bonus to spell
  attack rolls, a printed one-minute span, a feature carrying a second
  grant); the six remaining Metamagic options; Paladin's Smite as a casting
  paid from a feature and a Bonus Action after a hit; Divine Order's and
  Primal Order's other halves; Dark One's Blessing (an effect that watches a
  creature drop to 0); Tactical Shift; Ritual Adept; Arcane Recovery's door;
  Font of Magic's slot conversion if the owner rules it may mint a slot
  (today the `trade` grant refuses to mint above a maximum).
- `[ ]` **P3-A Split `an-action-a-spell-compels-or-forbids` before briefing
  it.** It is three mechanisms under one id: a rider duration anchored to
  the *target's* next turn (Shocking Grasp); a compelled Reaction move that
  spends somebody else's budget, which `combat.ts` refuses by name and which
  needs the owner's ruling in the spirit of Fear's (legality, not
  compulsion); and a rule that spends a creature's whole next turn (Command).
  Record the split in `SPLIT_BUNDLES` (`missing-shapes.ts:323`) as was done
  twice before.
- `[ ]` **P3-U The last undefined spells.** Phantasmal Force (a casting
  ended by a trigger; an area trigger on the caster's turn; an area trigger
  measured from a point), Sending (a second place to put a creature; a
  non-d20 outcome from P2-T17; suppression), Slow (a save whose failure
  imposes no condition, which is four of its six blockers; the skill-narrowed
  bonus from P1-T3; a coupled action-or-bonus-action rule).
- `[ ]` **P3-B The bestiary's remaining buckets**, cheapest first: Nimble
  Escape and the unread Advantage traits (a second `MonsterTraitSchema` enum
  member over the `action-rule` and `roll-mode` grants that exist); Magic
  Resistance (a `roll-mode` narrowed to saves against spells); Regeneration
  (a turn-boundary payout a creature owes, where today only a casting does);
  Undead Fortitude (a save on dropping to 0); grapple-on-hit and Engulf (an
  ongoing hold with an escape DC); the twelve CR ≤ 5 casters (open the
  withheld `declareSpellcasting` door and give the blocks their lists as
  content); damage-back traits (Corrosive Form, Barbed Hide); the light
  buckets after P3-S. Amphibious and breathing are handovers by the fiction
  rule unless drowning is ever modelled.
- `[ ]` **P3-R The remaining tracked spells by shape**, from the
  regenerated ledger: `a-casting-ended-by-a-trigger` (Invisibility, Hypnotic
  Pattern's damage clause, Sanctuary), `a-repeat-save-that-does-something-on-a-failure`
  (Searing Smite), Aid-style maximums already covered, `what-a-creature-is-holding`
  leftovers, and the one-spell shapes: a wall or several templates (Wind
  Wall), an AC a spell floors (Barkskin), a reduction applied to damage
  (Resistance), a second roll sequenced after the first (Ice Knife), a spell
  that answers a later attack (Sanctuary), healing that raises the dead
  (Revivify), targeting rules that differ within one casting (Vampiric
  Touch), an area trigger measured from a point (Flaming Sphere), a
  target rule the format cannot state (Animal Messenger), a world fact
  nothing can represent (Meld into Stone: a handover unless the owner says
  otherwise).
- `[ ]` **P3-H The handover list**, written once at the end: every printed
  sentence in level-5 reach the engine still hands over, each with the
  fiction-only reason, in `LEDGER.md`. This is criterion 1's second half.

## 7. Phase I: integration, in parallel from Phase 1

Infinite Realms is a Next.js 16 / React 19 / TypeScript app one folder up
(`../InfiniteRealms`): 60k lines, 1,056 passing tests, a deliberately small
mock runtime, file-based campaigns under `.data/campaigns/`, and a narration
provider on OpenAI's Responses API. **Maestro** is the DM persona;
**`gpt-5.6-luna`** is the OpenAI model id it defaults to. It already runs a
tool loop (four narrator tools for NPCs, quests, treasure and lookups), already
reserves `GAME_RUNTIME=impossibility-engine` as the adapter's socket, and
already imports the engine's `dist` in three generator scripts. Assessed
2026-09-21: `docs/dev/roadmap-infinite-realms-2026-09-21.md`, with a copy in
the app's own `docs/design/`. Nimbus Quill is an Electron app on Whisper.cpp
and the Anthropic SDK. The owner's instruction: **make Infinite Realms fit
the engine, not the other way around.** The engine is the source of truth;
the app renders it and lets a model narrate it.

The engine-side tracks live in this repo; the app-side tracks live in the
app's repo (or under `apps/` once I-E3 is decided) and are listed here so one
roadmap covers the whole road.

### Engine side

- `[ ]` **I-E1 Save and restore a campaign.** `restoreCampaign({ content,
  seed, log })` beside `createCampaign` in `packages/tools/src/campaign.ts`,
  a `serializeCampaign` that returns the record, a content version stamp on
  it; the append door promoted from private convention to public API; a test
  that a restored campaign folds byte-identically and throws the next die the
  live one would have. Verified on 2026-09-21 that `createCampaign` +
  `append(log)` already does this; the track is five lines and a name.
  `SRD_CONTENT_INPUT` round-trips already (1.32 MB, 27 ms to revalidate).
  **First in the integration queue: the app's persistence starts with this
  call or with an argument.**
- `[ ]` **I-E2 Tools as JSON Schema, in OpenAI function-calling format.**
  `toolSchemas(surface)` through Zod 4's `z.toJSONSchema`, sorted, with a
  test that both surfaces convert with zero failures. Decide strict mode
  (every property required, no additional properties) and post-process if
  so. The probe's `drivers.ts` already builds the wire shape and is the
  reference.
- `[ ]` **I-E3 Packaging.** Decide once: Infinite Realms as an `apps/*`
  workspace in this repo (already declared in `package.json`), or a `file:`
  dependency with a `prepare` script that builds `dist`. Fix the `./dm`
  subpath the docs promise or correct the docs.
- `[ ]` **I-E4 The integration note, rewritten for the providers actually
  used.** `docs/design/claude-integration.md` becomes
  `docs/design/llm-integration.md`: OpenAI function calling for Infinite
  Realms, the Anthropic SDK for Nimbus Quill, prefix caching (a byte-stable
  system prompt and the sorted tool list), the four outcomes as tool results,
  the Supabase rule below.
- `[ ]` **I-E5 A session runtime package**, `packages/session`, if I-E3
  puts the app in this repo; otherwise the same code lives in the app as
  I-A2. One implementation, wherever it lives.
- `[ ]` **I-E6 The creation API a wizard needs.** `choicesDue(content,
  choices, level)`, `subclassesOf`, `featsFor`, `spellsFor`; `checkCharacter`
  on both surfaces as `check_character` returning every problem with
  item-level paths and no early return on an unknown species.
- `[ ]` **I-E7 The physical-dice door, for Nimbus Quill.** First the owner's
  ruling on nested rolls (the Concentration save fired inside the damage
  command, turn-boundary saves, Initiative, death saves): the recommendation
  is a hold-and-settle pair on the pattern of `attack.hold` / `settle_attack`.
  Then `statedRoll` on the attack, test, initiative, death-save and damage
  commands, and a third directory under `packages/tools/src` with its own
  sweep, never on a model's surface.
- `[ ]` **I-E8 A controller identity on tool calls.** Deferred by the
  one-player ruling; a design note before any code.

### App side, Infinite Realms

The adapter design, the side-by-side seam table and the ranked suggestions
are in the assessment; these are its tracks, in order. Three decisions it
makes that the foreman should not re-argue: **the model holds the DM's door**
(`createDmSurface`), because `ability_check` and `saving_throw`, the app's
whole core loop, exist on no other surface, with the app filtering the
definitions it exposes and guarding the rest; **saved campaigns do not
migrate**, because they hold no event log the engine can derive, so release
one starts fresh; and **scene setup is done in code, not by the model**,
because the engine's probe measured a thin first beat at eleven calls
against three.

- `[ ]` **I-A0 Move the app to `apps/infinite-realms`** (the I-E3 decision,
  recommended: the workspace glob already exists and matches nothing). Keep
  the app's own tsconfig; add a project reference to `packages/tools`; give
  it its own Vitest project so the engine's `npm test` does not run 84 jsdom
  environments; rewrite the three generator scripts to bare `@ie/*` imports;
  keep `apps/**` out of the engine's purity lint and out of `COVERAGE.md`;
  add one sentence to CLAUDE.md, *apps depend on `@ie/tools` and on nothing
  under `packages/engine/src`*, with a sweep that holds it.
- `[ ]` **I-A1 The UI off the mock's vocabulary, on the mock, tests green.**
  A `FeedLine` / `SceneView` type in `src/engine/event-view.ts` that
  `src/ui/**` reads, and nothing under `src/ui` importing
  `src/domain/encounter.ts` again. The one step cheaper before the adapter
  than after.
- `[ ]` **I-A2 Tool schemas.** `src/engine/tool-schemas.ts`: the DM surface's
  definitions through `z.toJSONSchema` with `{ io: 'input' }`, `$schema` and
  the safe-integer bounds stripped, emitted in the surface's own sorted
  order, filtered to the tools the model may hold; a test pins the count and
  byte length so an engine change shows as a diff. (I-E2 does the same on
  the engine side; one implementation, wherever it lands first.)
- `[ ]` **I-A3 The session loop.** `src/engine/engine-session.ts`: one
  request per player turn with the frozen persona as the cached prefix,
  `observe()` appended as a message and never in the top-level system
  prompt, the model's function calls dispatched through `surface.call` with
  `commandId = call_id`, every outcome returned verbatim as the tool result:
  `ok` narrated from its resolution and events, `needs-context` answered by
  the model through the named door and re-sent under the same id, `refused`
  shown in the feed as a mechanical line, `invalid` logged and never shown.
  Guards in the adapter, not the prompt: the DC clamp the referee already has
  (5–30) in front of `ability_check.dc`; a per-turn budget on
  `improvised_damage` and a cap on its dice; `award_coin` and `award_items`
  called only by the adapter downstream of the treasure table; a per-turn
  transcript of `{call, outcome}` persisted beside the events and shown on
  `/dev/maestro`.
- `[ ]` **I-A4 Scene setup in code.** `src/engine/scene-setup.ts`:
  `create_character` from a `builds.mjs` entry (with the existing
  `ALPHA_GRANT` as `dmGrants`), `add_creature`, `set_scene`, `add_landmark`,
  `place_creature`, `declare_side`, before the model's first turn.
- `[ ]` **I-A5 The feed from events.** `roll-recorded` (with its sourced
  contributions, so a plaque can say `16 + 1 + 2 (Alert) = 19`),
  `damage-dice-recorded` (every die with its disposition and what replaced
  it) and `damage-taken` rendered into the existing `CombatPlaque` and
  `MechanicalResultCard`; vitality buckets derived from `observe()`; the
  withhold-narration-until-settled gate kept.
- `[ ]` **I-A6 `npm run engine:smoke`**, offline, no model: setup plus a
  scripted attack and `end_turn`, every event and outcome printed. The
  regression test for everything above.
- `[ ]` **I-A7 One live turn** under `GAME_RUNTIME=impossibility-engine`:
  "I swing at the goblin" becomes `move` and `attack`, the plaque shows the
  dice, the model narrates the damage the log says; a test asserts cached
  prompt tokens on the second turn. **This is milestone I-1.**
- `[ ]` **I-A8 Persistence.** `src/persistence/engine-campaign.ts`: the
  record is `{ seed, contentRef, log, cast }` restored by folding (uses
  I-E1's `restoreCampaign`); file-backed first, then Supabase as a
  `campaigns` row plus an append-only `events` table unique on campaign and
  index, written only after `ok`; characters stored as `CharacterChoices`
  with the derived plan cached; the narrative document beside it as today.
- `[ ]` **I-A9 Identity and the active campaign.** The active-campaign
  pointer is server-global today and every browser shares it; with Supabase
  it becomes per-user, and one player per campaign becomes one *user* per
  campaign. Not after Supabase; with it.
- `[ ]` **I-A10 Delete the mock.** `src/runtime/mock/**`, the referee under
  `development/`, `validate-resolution.ts`, the engine-copy in
  `src/domain/sheet.ts` and the band, cover and vitality arithmetic in
  `encounter.ts`: on the order of ten thousand lines. Keep one
  `Surface`-shaped stub returning canned outcomes as the pipeline's test
  double. Keep the four narrator tools, the canon and editor, the turn stream
  and `turnId` idempotency, and the pregens as *choices*.
- `[ ]` **I-A11 A boundary sweep in the app**, on the engine's pattern:
  nothing under `src/ui/**` or `src/application/**` imports
  `src/domain/encounter.ts` or names a die, a DC, an AC or hit-point
  arithmetic.
- `[ ]` **I-A12 Monster turns.** The engine has no monster AI. Decide once
  whether the model takes each monster's turn through the same door (cost
  per beat) or app code chooses from `options` and the printed lines. The
  mock's tactics code is the fallback and is not the engine's business.

### App side, Nimbus Quill

Assessed 2026-09-21: `docs/dev/roadmap-nimbus-quill-2026-09-21.md`. The live
pipeline is entirely deterministic and local (Whisper → regex phrase rules →
an actualization gate → a reducer); the Anthropic classifier exists and is
called by nothing but an opt-in eval. No die is ever thrown in the app. The
seam is already cut: `decideActualization` emits a `ResolvedOperation` whose
header names the engine as a future authority, and the pending queue's
confirm click is the gesture that makes the DM, not the parser, the caller.
Not on the path to G4; listed so the third door has a client when I-E7 lands.

- `[ ]` **I-N1 A `Campaign` in the main process.** Alias `@ie/*` to the
  sibling's `dist` in `vite.main.config.ts` and `tsconfig.json`; build
  `SRD_CONTENT` once in main; expose `engine:call` and `engine:observe`
  through the preload bridge returning the four outcomes verbatim; persist
  `{ seed, events }` beside `campaigns/<id>/party.json`; prove a relaunch
  folds to the same state.
- `[ ]` **I-N2 Three tools from clicks, no microphone.** `add_creature`,
  `roll_initiative`, `improvised_damage` driven from explicit DM gestures,
  `observe()` rendered read-only beside the combat overlay, all four
  outcomes shown, `needs-context` generalised from the existing target
  prompt panel. A "table rolled" numeric form (d20 face, damage total with
  its notation) as the primary input.
- `[ ]` **I-N3 Proposals, never calls.** The phrase detector's candidates
  become `ProposedToolCall`s in the same pending queue; only a click reaches
  the surface. Speech produces `physical-dice` provenance and nothing else;
  `dm-override` requires a typed or clicked gesture, because it is the one
  path the engine does not bounds-check. Stable id maps: the app's numeric
  roster ids to engine creature ids, its 23 named stat blocks to bestiary
  ids. Decide authority once: the engine is truth and the app's combat state
  is a projection of `observe()`.
- `[ ]` **I-N4 Physical dice through the door**, after I-E7: stated faces on
  attack, check, save, Initiative, death save and damage; the damage parser
  extracts the notation as well as the total so the engine can bounds-check
  it.

### Milestones

- **I-1** One fight, one character, one goblin, through the real engine,
  with the model narrating; the mock runtime unused on that path. Reached
  before G2.
- **N-1** One campaign, three tools, no microphone (I-N1, I-N2). Off the
  critical path; whenever a builder is free.
- **I-2** A stored campaign survives a reload and a redeploy; a level-up
  through the app; the session test of P0-T3 runnable through the app's
  adapter. Reached before G3.
- **I-3** The level 5 party session of criterion 3 played through the app.
  This is G4.

## 8. Hygiene, opportunistic

From the structure audit, each a pure move and none needing a decision:
split `standing.ts` at line 1538 into `standing-grants.ts` (the vocabulary)
and `standing.ts` (the queries); `positioning.ts` into `positioning/terrain.ts`
and `positioning/sight.ts` (do this with P3-S, which rewrites sight anyway);
`creation.ts` at line 3285 into validation and derivation; `commands/actions.ts`
into `hide.ts` and `ready.ts`; `packages/tools/src/definitions.ts` into
`definitions/<domain>.ts` with the file as barrel, so every door brief touches
one small file; a `packages/engine/src/testing.ts` off the barrel for the
`seed`/`placed` builders that thirty-seven test files re-derive. The
eleven-module value cycle under `commands/` is left alone until a brief
reshapes the casting pipeline, with a design note first.

## 9. Decisions already made: do not reopen

- 2026-09-20, in `STATUS.md` "Decisions the owner has ruled": Hide is an
  engine verb; size is a creation choice with a default; Multiattack needs
  composition; a monster's opportunity attack is its best printed melee
  attack; permanent is a duration; DM-only text is handed over flagged;
  Channel Divinity is one shell with one pool; the defender answers first;
  Shield drops a pinned rider unspent; the Hydra's heads are declared and its
  Bites derived; a fight ends on no hostiles or surrender; recharge is
  enforced and returns on a rest; Truesight and Blindsight see through
  Invisible, Darkvision does not; the Alert swap has a window; Wild Shape's
  four questions; Nimbus Quill's table rolls its own dice.
- 2026-09-18: Temporary Hit Points with no stated lifetime last until spent
  or the end of a Long Rest; an item copy has an engine-issued instance.
- 2026-09-19: the flat engine tree stays; `TurnMoment`; `time.ts` / `timers.ts`.
- 2026-09-21: Infinite Realms is the AI DM on OpenAI; Nimbus Quill is the
  human DM's companion with physical dice; "level 5" means everything
  reachable executed; persistence is Supabase; one player per campaign for
  the first release; **movement modes are built**; Find Familiar chooses a
  bestiary id at the casting with its restrictions enforced, and the steeds
  are catalogue entries; **the sight model is built**; the feature blocker
  map is widened.

## 10. Open questions and blocks

Appended by the foreman; answered by the owner or at a gate.

- Nested rolls for the physical-dice door (I-E7): which of the Concentration
  save, turn-boundary saves, Initiative and death saves the table throws.
- Dissonant Whispers' compelled Reaction (P3-A): legality or compulsion.
- Font of Magic's slot conversion (P3-C): may a trade mint a slot the class
  table did not print, within the SRD's limits.
- Meld into Stone and the other `a-world-fact-nothing-can-represent`
  entries (P3-R): handover, or a fact the scene should hold.

Appended after Phase 0 (2026-09-21):

- **A stat block's handover has no exported mark.** `DM_DECIDES` is exported
  for a casting's; the four stat-block sites (`commands/actions.ts:397,568`,
  `commands/attacks.ts:756,1117`) end their line with a bare copied sentence,
  so the session test's handover count rests on a literal pinned by an
  occurrence test. A one-line engine change, for whichever Phase 1 track opens
  those files.
- **A stat block's attack refuses `hold`** (`commands/attacks.ts:236`,
  `cannot_hold`), so a party fighting monsters is never offered the window SRD
  *Shield* answers, and the Wizard's Shield was unreachable for a whole
  session. Rules question or oversight — decide before P2-T14 writes Shield.
- **Six dead exports are re-exported by name from `commands.ts`** and two more
  are dead code rather than dead exports, so P0-T5's chore stopped at 16 of 24.
  Removing them is a change to `@ie/engine`'s published surface and wants the
  owner's word.
- **Two chores cannot live in a commit**: the six CRLF lines in
  `commands/mastery.ts` are working-tree-only (every tracked file is LF in
  git), and `tools/cli` is two empty untracked directories. Both are hand work
  in the main checkout.
- `ALSO_VOCABULARY` in the origin sweep excuses a word across all eight
  populations rather than the one it was argued for. Tightening it to
  `${Kind} ${string}` is a one-line change nobody has needed yet.

Appended after Phase 1 (2026-09-21):

- **The Phase 1 prescription "add a member to the `SpellEffect` union" is
  wrong for a whole class of clauses, and three tracks found it separately.**
  A clause that is a *consequence of a settled outcome* — "on a hit", "on a
  failed save" — belongs in `ModifierRider`/`OutcomeRiders`, not `SpellEffect`.
  A standalone effect fires on a miss too, and beside Thunderwave's
  `save-damage` it would roll a **second** save, letting a creature take the
  2d8 and stand still. `spell-schema.test.ts:2669` already pins the two
  vocabularies as disjoint, so a kind at the effect anchor cannot be reused as
  a rider even by name. P1-T4 stopped on this, P1-T5 declined its three
  assigned anchors over it, P1-T7 put `healing` in one union and its two
  effects in the other. **Every remaining Phase 2/3 track that names a
  `SpellEffect` anchor must be re-read against this before it is briefed.**
- **P1-T4 is to be reissued**, corrected: the `ModifierRider` union
  (`spell-definitions.ts:519`), `checkModifierRider` (`spell-schema.ts:927`)
  plus `RIDER_KINDS` (`:3129`), the chain in `spell-effect-riders.ts:360`. It
  needs `conditions.ts`, `commands/attacks.ts` and `standing.ts` — the last
  two were P1-T10's and P1-T9's and are now free. **Scope is Starry Wisp
  alone.** Faerie Fire additionally needs `save.condition` made optional and
  its Cube resolved as an area; Mind Spike's denial is narrowed to the caster,
  which is `the-effects-source-as-a-participant`.
- **P1-T13 is to be re-scoped, not re-run.** Every reader a movement mode
  needs lives in a file its brief forbade it: `MoveCommand` and `chargeTerrain`
  (`commands/movement.ts`), `speedOf` (`standing.ts`), the Prone hook
  (`conditions.ts`). What was buildable inside its fence was the dead half.
  The wiring is small: a `mode` field on `MoveCommand` beside `forced`, the
  surcharge at `movement.ts:250`, the mode's speed at `movement.ts:279`.
- **P1-T10's other half** wants three things, all in `standing.ts`, which is
  now free: `HitOption.saveDc?: number` (the derived `8 + PB` equals the
  Ghoul's 10 by coincidence and not the Death Dog's 12), a grapple filed under
  `grapple:<who>` so `escapeGrapple` can see it, and a target-anchored span.
  Extra-damage riders are a fourth and are a damage-roll mechanism, not an
  effect list.
- **`rider_deals_damage` does not cover printed riders.** It is a
  `checkContent` rule over an *authored* grant; a printed rider is minted in
  engine code and never passes through `checkContent`. Harmless only while the
  reader emits one effect kind that rolls nothing. **If the extra-damage
  family is built, the guard must be carried across**, or a rider's damage
  roll will meet a `damage-rolled` the fold is already holding.
- **`TrackedAdjudication.why` is too narrow, found twice in one batch.**
  Remove Curse needs it to name an item shape (`what-ends-attunement-besides-
  a-command` is an `ItemShapeId`); Hex needs it to say "nothing blocks this
  and nobody has written the definition", which `BlockedClause.why` expresses
  as `expressible` and this type cannot. Widening it reaches both generators
  and four guards. One decision, not two.
- **`FeatureDefinition.grants` is singular, and that now blocks printed
  features.** Draconic Resilience needs a hit point maximum grant kind *and*
  already spends its one slot on `unarmored-defense`; `sorcerer.ts` records
  the same wall for Innate Sorcery. The choice is to make `grants` plural or
  composite, or to licence splitting one printed SRD feature into two ids.
  `dwarf:dwarven-toughness` waits on the first half.
- **When falling gets a tool it must be DM-only.** `FallCommand.feet` is a
  fact about the room, the same class as `declare_heads`; a model stating a
  height converts directly into 20d6. `resolveFall` is unreachable from
  `packages/tools` today, which is acceptable debt only until that tool exists.
- **An uneven split of several attack rolls is not sayable.** Four rays at two
  creatures go two and two. Saying otherwise needs duplicates allowed in the
  request's target list, which would apply every other effect kind twice. The
  engine deals round-robin from the caller's own ordered list and the caller
  picks who takes the surplus by naming them first. **If the owner wants the
  lopsided split, it is a request-shape change.** Chromatic Orb still waits on
  the whole shape.
- `missing-shapes.ts` files `animated-shield` under `what-a-creature-is-
  holding`, whose name now means the drop verb; a shield that protects while
  leaving hands free is not that blocker.
Appended after wave 1.5 (2026-09-21), which closed P1-T4, P1-T13 and the rest
of P1-T10. Ledger after it: **129 spells in reach not executed, 89 waiting on
a shape; 400 CR ≤ 5 items, 186 of 242 blocks waiting, 56 clean.**

- **Movement modes are half a mechanism and moved no number**, which is worth
  recording rather than glossing. The reader half is built — four Speeds on
  the sheet and off a stat block's printed line, a move that names its mode,
  the surcharge for going without the Speed, a flier who is stopped falling
  through P1-T5's rule, both jumps, and `cannot_rise` on a move that ends
  higher. **Nothing grants a mode**, so all three spells, the feature and the
  26 blocks still wait. Three separate follow-ups, none of them large:
  `GrantedSpeed` needs a mode (it crosses `standing.ts:2653`,
  `spell-definitions.ts`, `spell-schema.ts`, `commands/spell-effect-grants.ts`);
  Second-Story Work needs a `climb-speed` `FeatureGrant`; and the 26 blocks
  need new `MonsterTraitSchema` kinds, a parser change **and a regeneration of
  `monsters.json`, which cannot happen in a worktree** — that one belongs to a
  track run in the main checkout, or to a deliberate re-ingest.
- **A sentence about movement modes is stale in ten places** and the report
  desyncs if they move apart: `spells.ts:3265, 3349, 7633`, `items.ts:2804`,
  `missing-shapes.ts:1300, 1324`, `classes/monk.ts:316`, `ranger.ts:185`,
  `rogue.ts:388`, `sorcerer.ts:377`, `missing-feature-shapes.ts:642, 1014`.
  Each says the engine tracks one Speed and no modes; each is now false as a
  *reason* even though the entry it justifies is still blocked. One content
  track, with the generators in the same hand.
- **Nothing brings a jumper down.** A High Jump leaves the creature at the
  elevation it reached. Strictly narrower than before — elevation was wholly
  unguarded until this — but a creature can end its turn in the air.
- **The log does not record which Speed a move used.** `fold/combat.ts` now
  validates `movement-spent` against the maximum over every mode, because the
  exact per-mode check is only knowable in the command. Written in the comment
  there; a replay cannot tell a 40-foot flight from a 40-foot walk.
- **Faerie Fire, Mind Spike and Shining Smite** all still want the benefit
  denial that Starry Wisp now has: Faerie Fire needs optional `save.condition`
  and its Cube as an area, Mind Spike and Shining Smite need
  `the-effects-source-as-a-participant`.

- **For the owner: may the engine hold a fact that only the table reads, and
  on which door is it published?** Zone of Truth's failed save buys "can't
  speak a deliberate lie while in the radius". The engine holds no speech, no
  rule would read the flag, and no door publishes one — so building it writes
  a state a save sets and nothing consults, which is the die-thrown-for-no-
  reason defect under another name. The geometry it was thought to need is
  built (P1-T9). This is doctrine rather than rules, and is a good G1 item.

Appended after the level-5 batch (2026-09-22):

- **`FeatureDefinition.grants` is plural now** (`featureGrants`), which retires
  the wave-1.5 entry above that listed it as a blocker; `FeatDefinition.grants`
  stays singular because no SRD feat below level 19 wants a second.
- **Two questions on one feature.** Divine Order and Primal Order spend their
  one `choice` on the order and have nowhere to ask which cantrip; recorded as
  `a-second-question-one-feature-asks`. A second choice per feature is a
  vocabulary decision for G2.
- **Should a one-shot modifier be spent by a Hide?** `takeHide` rolls a
  Stealth check through its own path and spends nothing, so a Help's Advantage
  on Stealth survives the Hide it was given for.
- **Is a stat-block save "magical"?** Wave two narrows Magic Resistance to
  saves the casting pipeline forces; a printed line's save (a Basilisk's gaze,
  a dragon's breath) is not, and `forcePrintedSave` cannot say otherwise.

Appended after wave two (2026-09-22):

- **A stat block's game statistics are a sheet, and a sheet can be worn.**
  `assumeStatBlock` is the first reader that lays one creature's block over
  another's record; the monster-side Shape-Shift, Polymorph and a Druid's
  Circle of the Moon all want the same seam. The rule that came with it:
  what is retained is named on the grant, never inferred from the sheet.
- **Merged gear is silent by one guard**, `itemStandingOf` reading
  `CreatureState.shape`. Attunement survives the form (the SRD says nothing
  ends it) and the items stay in `equipped`; if a form should ever *wear*
  an item (the SRD leaves it to the GM), that is a per-item declaration and
  a new question, not a change to the guard.
- **A printed save line is an effect list now** (P2-T18, the architect's
  second track this wave), and three families are refused whole on purpose:
  a graded failure (`_First Failure:_`, `_Failure by 5 or More:_`) is a
  repeat save whose failure imposes a *different* condition, which
  `RepeatSave` cannot say; a trigger or a movement before the save (a Death
  Burst, a Bulette's leap, a Cube's Engulf) is a moment or a move nothing
  spends; and a lifetime tied to another effect ("Restrained until the
  grapple ends", "While Poisoned, Paralyzed") is one condition ending with
  another, which the condition state's `impliedBy` could carry if a command
  could write it. A trait's save — a Ghast's Stench at the start of a turn in
  its aura — is a fourth: an aura forced by a moment, not a use.
- **The Opus fleet stopped on the owner's monthly spend limit** on
  2026-09-23; the five wave-3 briefs are written, and Fable takes them alone
  in the order small features, feature vocabulary, casting cost, sight,
  attack riders. **Small features merged 2026-09-23**: Resourceful, Naturally
  Stealthy, Jack of All Trades, Slow Fall and Second-Story Work execute, and
  the DM surface gained `resolve_fall`. **Feature vocabulary merged
  2026-09-23**: Adrenaline Rush, Stonecunning, Large Form and Draconic Flight
  execute, Innate Sorcery switches on and off with its bonus clause still the
  table's, and Breath Weapon, Giant Ancestry, Gnomish Lineage and Tireless
  declare the pools their notes claimed. **Casting cost merged 2026-09-23**:
  Wild Companion, Ritual Adept and Paladin's Smite execute, and `cast_spell`
  publishes `ritual`. **Attack riders merged 2026-09-23** (an Opus builder,
  the fleet being back): Sacred Weapon executes, Shillelagh's damage type is
  chosen at the swing, and the printed damage clauses a stat block gates on
  Bloodied or on Advantage are read; True Strike waits on the ruling below.
  **Sight merged 2026-09-23** (the fifth track, Fable's own): Light,
  Continual Flame, Dancing Lights and Darkvision execute, and Faerie Fire's
  Advantage asks whether the attacker sees.

Appended after wave three's first track (2026-09-23):

- **A reroll answers a failure, and only a failure.** Heroic Inspiration's
  "any die" was built as `on: 'any'` and taken out the same day: a
  `test-rolled` window that opened on every check a Human made turned every
  ordinary roll into a two-call negotiation, and both scripted DM sessions
  said so. What that leaves to the DM: rerolling a made roll whose total
  still matters (a Stealth check's total is the DC to find the hider), and
  the attack-roll and damage-die halves, which land in no window a reroll
  can answer in. Champion's Heroic Warrior keeps the `heroic-inspiration`
  shape for the one thing still missing, a pool a turn boundary refills.
- **A Reaction's door is its window's tool.** A holdings line for a Reaction
  names `TAKEN_BY[window]` rather than null, so a pool whose only door is
  `take_test_reaction` is not reported door-less; `reachability.test.ts`
  reads the kind before the door for the same reason.
- **A fall is landed by the table and softened by name.** `resolve_fall` is
  DM-only because the height converts into 20d6; Slow Fall is a
  `fall-damage-reduction` grant the faller elects on the landing, spending
  the Reaction where a fight runs. No `creature-falling` window exists, which
  is what Feather Fall, cast in answer to somebody else's fall, still waits
  on.
- **The Hide behind a larger creature hands one fact over**: the engine
  checks size and the five feet, and names the creature; whether it stands
  between the hider and each watcher is the table's.

Appended after wave three's second track (2026-09-23):

- **A pool the Proficiency Bonus sizes is the character's.** SRD prints "a
  number of times equal to your Proficiency Bonus" on species traits, which
  have no class table; `perProficiencyBonus` is read at the character's total
  level and grown by advancement like a column. A pool declared with nothing
  to buy from it — Breath Weapon, Giant Ancestry, Tireless — is declared
  anyway, so the sheet counts what the book counts and the ledger's "pool with
  nothing to buy" column says the rest.
- **A printed span is never maintained.** An activation runs to a turn anchor
  *or* for `lastsSeconds`, exactly one; a span is scheduled on the clock in
  and out of a fight, and `extend_feature` refuses it `not_extendable`. Rage's
  round-by-round maintenance is the other spelling, not a default.
- **A size an activation prints is derived onto the map, and only for its
  holder.** `settleSizes` brings the scene's copy to the printed size while
  the feature runs and to the creature's own when it ends, by every route out;
  a creature whose sheet prints no size under any activation is not read, so a
  size the table stated when it placed a hound stays the table's. Large Form
  while shape-shifted is a case nobody has asked for and nothing settles.
- **An allowance may carry a price.** `spends` and `temporaryHitPoints` on an
  `action-rule` are charged by the command that takes the cheaper slot, before
  anything is spent, and are refused with the pool empty. The SRD prints
  exactly one such allowance, Adrenaline Rush; the vocabulary is generic so a
  homebrew "Hide as a Bonus Action, Proficiency Bonus times" spends too.
- **Innate Sorcery stays manual by one clause.** The +1 to spell save DC and
  Advantage on spell attacks are `a-bonus-to-spell-attack-rolls`, named in
  `standing.ts` as deliberately absent; the activation, the two uses and the
  minute are the engine's.
- **Dark One's Blessing is a moment, not a price.** The Temporary Hit Points
  it prints arrive "when you reduce an enemy to 0 Hit Points", which no
  feature route opens; the shape stays with that one claimant.

Appended after wave three's third track (2026-09-23):

- **A feature's free casting may say more than its price.** `freeCasting` may
  name a sibling feature's pool (Wild Companion spends Wild Shape's), print
  the slot route beside the free one, fix a `choiceStated` value and put a
  Long Rest lifetime on the summons it calls. The granted route carries all
  four; `choosePayment` still asks which price, and a caster who answers a
  fixed choice otherwise is refused `choice_fixed` rather than corrected.
- **A kept summons has three lifetimes and one bond.** At 0 Hit Points, when
  the summoner dies where the spell says so, and now when the summoner
  completes a Long Rest *later than the binding* (`KeptBond.since`); all three
  are `strandedSummons`' to report and the sweep's to perform, none is a
  second field on the creature.
- **A Ritual from the book is the class's own route, licensed.** `chooseRoute`
  reads `ritual-from-book` off the sheet and `SpellcastingClass.book` off the
  creation-pinned record, and returns the `prepared` kind because that is what
  the route decides — ability, printed numbers — while the casting's own
  `slotless: 'ritual'` says why nothing was spent. The book being in hand is
  the table's. `cast_spell.ritual` is published; the llm-probe keeps it
  excluded beside `hold` until that surface publishes a settlement command.
- **A smite on a hit may be a free casting.** `resolveAttackDamage.smite` takes
  `payment: 'free-casting'` in place of a slot level and spends the granted
  route's pool inside the settlement's batch; no tool publishes a smite yet,
  which is a door the attack surface still owes.
- **Material components are not modelled**, so Wild Companion's "without
  Material components" costs nothing to say and the note says so.

Appended after wave three's fourth track — attack riders (2026-09-23):

- **An ability-sized bonus reaches attack rolls** (`attack-bonus`, beside
  `save-bonus` and `check-bonus`), gathered by `standingBonuses` off the
  holder's scores as they stand, and **withheld from items by name**: no
  `onlyWithItem` gate exists yet, so a blade granting it would reach every
  swing its wearer made with anything.
- **An activation may spend a pool it did not declare.** `activated.spendsOnly`
  is the third spelling of the distinction `reaction.declares` and a free
  casting's `declares` already draw — Sacred Weapon spends Channel Divinity's
  use and declares nothing, and a second declaration of the same pool is
  refused by the fold.
- **A printed damage clause is read by its connective.** "**plus** 2 (1d4)
  Slashing if the attack roll had Advantage" is a component beside the line's
  own; "**or** 2 (1d4) Piercing if the swarm is Bloodied" is the damage rolled
  *instead*, because a swarm at half strength bites for less. `isBloodied` is
  one spelling of "half its Hit Points or fewer", shared by the requirement
  and the reader. The charge gate stays refused: nothing records the shape of
  the move that preceded a swing.
- **Shillelagh's second sentence is a choice at the swing**, not at the
  casting: `weapon-rider.damageTypes` is the offer, `attack.damageTypes` and
  `settle_attack.damageTypes` the answer, and "or" replaces the weapon's type
  rather than adding a component, so a Force-immune target takes nothing.
- **True Strike is ruled, not built.** What blocks it is its lifetime: the
  spell is Instantaneous and "you make one attack with the weapon used in the
  spell's casting", so no grant can hang on it and no effect kind makes a
  weapon attack. The builder offered two routes and the coordinator rules for
  the second, in the shape the engine already has for a spell cast *inside*
  an attack: as `resolveAttackDamage.smite` casts Divine Smite on a hit, the
  **attack command takes a cantrip to cast with the swing** — one Action,
  `spell-cast` beside `attack-made`, the substitution and the Radiant die
  applied to this roll and no other, and no grant left behind. A one-shot
  lifetime on the rider grants was refused because it costs two Actions where
  the book prints one. This is a brief for the next wave, and the owner may
  reopen it.

Appended after wave three's fifth track — sight (2026-09-23):

- **A casting's light is carried by its bearer.** The engine holds no
  objects, so Light and Continual Flame name the creature holding the touched
  thing as their target, and a `light` effect lays the patch on a region whose
  origin is that creature: it moves with them, is sourced to the casting id so
  it lapses with the record, and a darker casting of higher level over it ends
  it. Which object was touched, and an object set down for good, are the
  table's — `declare_light` lights the spot.
- **Four motes are one dim patch.** Dancing Lights lays a dim sphere at the
  point the caster names and its Bonus Action re-lays it after
  `spell-origin-moved` (`activation.movesArea`); the tether between the motes
  and a mote leaving the range are the table's.
- **A casting confers a sense.** Darkvision the spell is a `sense` effect —
  `sense-granted` on the target, `CreatureState.senseModifiers`, read by
  `sensesOf` at the longest range held and released with the casting.
- **The sight gate applies when unsettled, and says so.** Faerie Fire's
  Advantage carries `RollSelector.ifRollerSees`; a roll site passes
  `rollerSees` from `canSee`, a no withholds the grant, and a yes or a silence
  applies it — the silence reported by `rollModesFor` as an unsettled grant
  rather than swallowed, because the sight question stays the table's to
  settle.
- **A creature is always within reach of itself**, so a touch laid on the
  caster's own hand asks for no scene; a light cast with no scene set lays no
  patch and says so in `unverified` rather than corrupting the fold.
- **A debt:** an attack's `roll-recorded` names no `modes`, so an attack's
  granted Advantage is visible only on the swing's own `mode` where a check's
  record names its sources. Recording them beside the check's is a small
  change to `rollAttack` for a later track.

Appended after wave four (2026-09-23), four tracks merged and one in flight:

- **An independent review of the four Fable-built wave-three tracks** found
  three ordinary defects, fixed: every rule that reads a size now reads it
  through `effectiveSizeOf` (printed, then stated, then the map's), so Large
  Form reaches a Grapple; Resourceful is partial again with its residue filed
  under `a-reroll-outside-the-test-window`; the sight track's self-target
  exemption skips only what a creature knows of itself. Light and Darkvision
  moved `targets.count` from 0 to 1, so `cast_spell` with no target now
  refuses for them — a door change. Fable-built work gets an Opus reviewer
  before merge from here on.
- **A feature may ask two questions** (`choices`, each with a `key` and an
  `onlyIfChoice`; answers filed under `feature:key`). A gate reads the primary
  answer of the feature `choiceFrom` names and a grant's content reads the
  keyed one, which is how one pointer keeps two jobs apart. The grant that
  confers weapon proficiency and armour training is spelled
  `weapon-and-armor-training`, because `readableGrantKinds` probes reader
  source for the bare word and `proficiency` already appears there. A cantrip
  a feature grants now joins `cantrips` rather than `prepared` — Circle of the
  Land's Fire Bolt was costing a slot. **Debt:** the tool-surface
  reachability sweep probes only the first-listed option of a gated feature;
  a sheet per option is a brief of its own.
- **What a printed hit buys is read as a sequence** and the residue handed
  back, with a ledger row of its own so a half-read line stays unpaid. **No
  record is no charge**: `movement-spent` carries the segment, the turn keeps
  its segments, and a charge gate reads them back along one bearing at the
  target's space; outside a fight the gate is simply not met and says so. A
  hold may imply a condition per source (`whileHeld`, `implies`), lifting with
  what implied it. Handed back rather than built: Mimic's Disadvantage on the
  escape check (a mode on a check is not in the selector) and the
  Half-Dragon's Claw type (Draconic Origin is bare prose).
- **A lowered Hit Point maximum returns when a Long Rest completes.** SRD's
  Long Rest says so of every reduction, so the rule lives in the rest, not in
  the lines that lower one: every lowering with no lifetime of its own is
  released and a raise keeps its casting's. Mummy's "doesn't return to normal"
  is the printed exception, a mark for a later reader. **Merged** as
  `hit-point-maximum-restored`, released narrowly (a night's sleep is not a
  dispel: a condition the same line hung stays) and folded in the upkeep seam
  beside `resources-restored`, the sentence before it in the same paragraph.
  Two follow-ons it left: **for the owner, a maximum has no floor** — two Life
  Drains on a 13-hit-point creature fold to a maximum of −6 and a living
  creature, and SRD 5.2.1 prints no "dies when its maximum reaches 0" sentence
  (that was 2014's), so the answer is a ruling, not a fix; and Greater
  Restoration's and Aura of Life's `unmodelled` reasons are stale now that a
  maximum can be lowered and restored — Greater Restoration's undo is the new
  event, a cheap content-and-resolver follow-on.
- **A repeat save may deepen.** `onFailure` applies the deeper condition under
  the same source and ends the timer that raised the save, so the boundary
  stops asking — Sleep's second failure, and the Cockatrice's shape for the
  bestiary's second pass. **Searing Smite waits on the attack command**: its
  burn is a casting-hosted repeat save with a payout before the roll, and
  `castOnHit` must pass the casting its duration; both are W4-D's with True
  Strike. Sleep's shake-awake wants `EffectCheck` to name an attempter other
  than the holder. `a-reduction-an-effect-applies-to-damage` is an item shape
  now (Ring of Warmth); Shield's Magic Missile clause is filed under
  `a-reaction-window-that-opens-on-being-targeted`.
- **Two allowances for one pair: the free one by default.** `allowsPrice`
  prefers an unpriced allowance, a caller names the priced one to take its
  benefit (`usingFeature`, `alsoTaking`), and one price may buy two actions
  (`allows.actions`), the second handed to the turn as a narrowed
  `GrantedAction`. Innate Sorcery's two benefits are narrowed to castings
  through the Sorcerer's own route; no over-reach was taken. Step of the
  Wind's jump doubling stays the table's. **Debts:** a bare `action-spent`
  after an `only`-narrowed extra action makes the fold throw (Expeditious
  Retreat can reach it; pre-existing); `coverage.test.ts` does not guard the
  class and level tables the way `ledger.test.ts` guards its own.
- **A printed save's second pass merged** (the parser runs at ingest, so main
  re-ingested): the graded failure (`_First Failure:_` … `_Second Failure:_`
  onto the repeat's `onFailure`), the margin (`_Failure by 5 or More:_`
  replacing the failure list), a condition another implies, a curse that is
  only conditions, and `dies` with the printed ceiling on who it may be
  forced on. An implied condition now meets the same immunity its host does
  (found by the pass's reviewer; fixed at integration). **Four decisions it
  left, each a small brief:** `RepeatSave.onFailure` gaining a `Duration` and
  a nested repeat (the two dragon wyrmlings' breaths); a sourced grant bound
  to a condition instance's lifetime (Dretch's action rule, the Ravens' mode
  "while Deafened"); an event for "drops to 0 Hit Points" that is not damage
  (Sea Hag's glare, then Incubus' threshold branch); and the attach family
  (Water Elemental's Whelm, Darkmantle, Stirge) as a hold with a per-turn
  payout.
- **True Strike and Searing Smite merged.** A `weapon-attack` effect is the
  cantrip cast with the swing, refused at `cast_spell` (`cast_with_a_swing`)
  and taken by `attack.cantrip`; the Cantrip Upgrade is a band table keyed by
  character level because `DiceScaling` cannot say "no dice below 5". A
  Magic-action swing emits no `attack-made`, so `target-attacks` (the Attack
  action) does not fire for it — Invisibility survives a True Strike miss or
  hit alike until the damage lands. A smite with a duration now keeps its
  record and timer (`castOnHit`'s `keptRunning`), which gave Shining Smite the
  Concentration cap it never had; a casting hosts a repeat save with a payout
  before the roll (`beforeTheSave`), raised with the casting's own mark as the
  source. Two defensive paths are undriven by any SRD spell: a payout that
  orphans its own save, and several payouts in one boundary.

Appended after wave five's first two tracks (2026-09-24):

- **An area filters its catch**: `notTheCaster`, `mustSeeTheOrigin` and
  `chosenFromTheArea` on `TargetRule`, read once where a casting settles its
  catch; `canSeePoint` beside `canSee`. An empty `targets` on a choosing area
  is the question, refused `area_choice_required` like every other
  `*_required` — reading silence as "nobody" would have made every Sleep
  written before the clause affect no one. Entangle is whole (its Difficult
  Terrain is `areaTerrain`, as Web's is). **Ruled and merged (W5-B):**
  Blinded answers no to every sight question as the looker, Blindsight in
  range excepted, and the condition outranks a declared line — the one place a
  declaration loses, because a declaration is for what the engine cannot
  know; a creature still sees itself. `eligibleTargets` answers an area
  through the catch itself and, where it cannot place the template, asks for
  the fields that would place *that* one (`eligible_targets` publishes
  `at` / `towards`).
- **At 0 Hit Points**: `hit-points-dropped-to-zero` is a drop that is not
  damage (Temporary Hit Points untouched, no damage reader fires — the Sea
  Hag's glare), a printed failure may **branch** on the target's Hit Points
  ("Otherwise" carries damage only), and `on-dropping-a-hostile` pays SRD Dark
  One's Blessing — hostility read from the **holder's** side, because "an
  enemy" in a second-person feature has no other referent. `temporary-hp-granted`
  gained an optional `source`. **Two follow-ups, one brief:** the DM's
  `improvised_damage` reaches `resolveDamage` directly and pays no watcher
  (a `commands/drop-rewards.ts` imported by `casting.ts` closes the module
  cycle), and ten callers of `dealSpellDamage` drop its `unverified` on the
  floor while holding accumulators of their own. Solar's Slaying Bow ("it
  dies") waits on widening the kill's gate, out of level-5 reach.
- **A creature may attach** — a relation written down, not derived, because
  the Stirge's victim walks off with it on and holds nothing: `creature-attached`
  / `creature-detached`, released at both ends like a grapple. A hold may be
  taken **instead of** a hit's damage (`attack.holdInsteadOfDamage`, refused
  where the line offers none), and a payout may name a payer who is not the
  creature whose boundary collects it (`GrantedPayout.to`), skipped the
  moment the hold no longer stands. A blow that empties the target leaves what
  its line says (Stable, an hour of poison, a death), gated on the drop having
  happened *by this blow* — a creature already at 0 takes a Death Saving Throw
  failure instead. **Handed back, with the line's words:** "the stirge can't
  make Proboscis attacks while attached" (a rule about a stat block's own
  lines, which `ActionRule` cannot name), the Darkmantle's "can attack only
  the target", and both blocks' suffocation. **Debts:** no `lapsedAttachments`
  twin of `lapsedGrapples` (a dead attacher leaves its cover standing), and
  neither detach nor `escapeGrapple` has a tool door — a table through
  `@ie/tools` can be attached and cannot detach.
- **Every road reports, and every road pays the watcher.** `resolveDamage` is
  the one true funnel (`damage-taken` is emitted in one place, called from
  one place) and now asks what the fall owed; `commands/drop-rewards.ts`
  holds the reader so no module cycle forms. Eleven callers of the spell-
  damage road thread its `unverified`; `TurnResolution` carries one;
  `roll_improvised_damage` and `end_turn` publish it. Three reachable roads
  are wired but untested (Sear Undead, Fire Shield, Searing Smite's burn) —
  a coverage brief; `payCastingDamageCost` still drops its report, said
  where it happens.
- **A grant may live as long as one condition instance does**, by being
  sourced to the instance's id and released at both doors a condition leaves
  by — no new event, state or deadline kind. The Ravens' Cacophony reads
  whole. **Ruled, from the track's escalation:** `ActionRule` gains a fifth
  member, `one-of` over a *list* of slots ("spending any one forecloses the
  rest"), because SRD Ice Devil couples movement with the action where the
  Dretch, the Copper Wyrmling and Slow couple the action with the Bonus
  Action; the spender reads the budget it already holds. **Merged (W5-E):**
  the four spenders ask `refuseForeclosed` of their own budget, so no command
  changed; a printed failure may impose a rule about a turn or a halved Speed,
  on a condition instance or under a timer; the Dretch, the four Copper
  Dragons and Slow's coupling read whole, and the shape is retired. Left
  standing, each said in place: the Brass Dragons' Scorching Sands is a
  legendary action and that economy is unbuilt; the Ice Devil's coupling is a
  hit rider the reader does not reach; a granted move (SRD Tactical Shift)
  does not foreclose a later action, because `GrantedMove.feet` records what
  is left rather than what has gone.
- **Breath Weapon and Open Hand Technique execute.** A pool option may cost
  one attack of an Attack action already taken (`action: 'one-attack'`,
  emitting the same `attack-made` a swing does), derive its DC from the
  holder's own ability (`saveAbility`), and offer a choice of areas at the use
  (`areas`, `shape_required` / `shape_fixed` / `no_such_shape` on
  `damage_type_required`'s pattern); a species feature's dice already scaled by
  character level, so no band table was needed. A swing now remembers what
  **sold** it (`GrantedAttacks.from`, `turn-budget-granted.purchase`), which is
  the gate Open Hand's rider needed (`fromGrant`); Prone is the one condition a
  rider hands out with no deadline, said once in `ENDS_ITSELF`. **Giant
  Ancestry is not built, and the reason is filed:** Fire's Burn and Frost's
  Chill add damage to a blow, and `rider_deals_damage` refuses a hit-bought
  rider that deals damage because an attack holds one damage roll at a time.
  The fix is the shape `castOnHit` already uses — a rider's dice folded into
  the blow's own components before the roll — filed as
  `a-rider-that-adds-damage-to-the-blow` and briefed as W5-G.
- **Giant Ancestry executes, all six boons.** A hit rider's dice are a
  **component of the blow** (`extraDamage` beside the effect list, gathered
  where the smite's are, on the held blow too), so a critical doubles them,
  the target's defences meet them by type and one `damage-rolled` carries the
  whole; `rider_deals_damage` keeps refusing damage in the list itself. A
  rider may be gated on the target's size; a pool option may teleport its
  holder to a stated space; a Reaction may deal damage back to the creature
  that dealt it (`damage-back`, Storm's Thunder — Hellish Rebuke is the
  casting twin), through the funnel so the drop watcher sees it. **One hole,
  said in place:** a pool drained inside a Reaction window between the swing's
  gather and the rider's landing would let the dice ride unpaid; no SRD
  content reaches it, and closing it means settling a rider's price at the
  swing.
- **A deepening may carry a lifetime of its own** — a span on the clock or a
  repeat of its own — where the first rung may not, because the first rung's
  deadline and its save are one moment and one pass eats the other, while a
  deepening lands at a moment already arrived. The Brass and Silver
  wyrmlings' breaths read whole (the Brass line's two early endings handed
  over), and the Sphinx of Valor's Second Roar came with them. The content
  side gains the span but not the nested repeat: `castOnHit` spreads a
  definition's `onFailure` into the engine's, and no SRD spell prints a
  deepening that repeats. A nested `end-casting` repeat has no backstop yet;
  nothing can write one today.

Appended after wave six's first two tracks (2026-09-24):

- **Cunning Strike executes.** A hit rider's price may be a sibling feature's
  damage dice (`forgoesDiceOf`; `no_dice_to_forgo`), taken where the Sneak
  Attack dice are gathered so the one loop that knows whether the feature
  fired is the one that charges; a rider may require an item on the holder's
  person (`item_not_carried`) and hand the turn a move (Withdraw, through
  `movement-granted`, which already provokes nobody). Whether a blow was a
  Sneak Attack depends on the die, so the price is not a refusal after the
  roll — a rider that finds no dice is dropped unspent and reported. Improved
  Cunning Strike, Devious Strikes and Supreme Sneak now wait on one shape: a
  later feature lengthening an earlier rider's menu
  (`a-feature-that-rewrites-another-features-rule`).
- **The sleeper's door.** `wakeCreature` is an action a neighbour spends; what
  it ends is **derived**, not commanded — `shaken-awake` joins the casting end
  causes and a printed condition carries `endsOnDamage` / `endsWhenWoken` as
  lists of condition names (the Pseudodragon's Unconscious ends while its
  Poisoned runs on), so a shake and a blow reach one door. An immunity to one
  printed line for a day is its own grant family, not a condition immunity — a
  second ghost's visage still frightens. A printed hold may owe a payout at
  its holder's boundary; the Vampire Spawn's bite lowers by the Necrotic alone
  and feeds the vampire; a line that catches only the willing or the held asks
  for consent (`undeclared_consent`) rather than refusing, and the DM's door
  names the willing by id. The Trample lines now require a Prone target, which
  the book always said.
- **Three features, three small shapes.** A `spells` grant may be re-chosen on
  a rest (`rechosenOn`: the rest, the list, the ceiling — a mark on the grant
  whose fixed spell is re-asked, not a second declaration of it), offered and
  answered through the door a level-up already uses; a feature may **make an
  object** (`creates-object`, the Rock Gnome's device — kept on the summon
  bond, its eight hours a fifth read of `strandedSummons`, its function pinned
  prose the Bonus Action hands back, three doors above it); a feature may
  **detect** (`detects` on an `activated` grant, derived on every read beside
  `sensesOf`, published in `look`'s `senses`) — Divine Sense, whose
  consecrated half is the table's because nothing consecrates a place. **A
  flagged shape:** `advance_character` accepts any `featureChoices` record, so
  a level-up can swap a rest-re-chosen answer without the rest; every
  rest-re-chosen answer already had that door open, and closing it is a rule
  about which keys a level-up may write.
- **Metamagic executes, all ten options.** The six that were prose are six
  arms of one casting alteration bought off one menu under one price and one
  per-casting limit: Careful spares named creatures by leaving them out of
  the catch (what "automatically succeeds" comes to on every success branch
  the SRD prints), Heightened hangs a mode on one target's saves with its
  source on the roll's record, Empowered rerolls the **lowest** dice (a stated
  count is the whole of the player's choice; die indices in a request would be
  a caller reaching into the roll), Seeking is pre-committed and spends its
  point only on a miss, Subtle opens no `casting-a-spell` window, Transmuted
  restates the type through `statedDamageType`. Empowered and Seeking are
  refused on a casting held open for a Counterspell; the other four survive
  one because what they need is pinned. Levels 10 and 17 print more options
  and are out of reach; if wanted, two feature entries and the `option`
  choice's column.
- **Eldritch Invocations, part one.** The feature asks a question sized by the
  class table (`chooseByLevel` on an `option` question, with a `prerequisite`
  per option — a level or another option), and eleven invocations a level-5
  Warlock can take execute as gated grants: Agonizing Blast (an addend on
  **every** damage roll of one named cantrip), Armor of Shadows, Mask of Many
  Faces, Misty Visions, Otherworldly Leap, Ascendant Step and Master of Myriad
  Forms at will, Devil's Sight, Eldritch Mind (a Concentration-save selector,
  the query flag set where `resolveDamage` rolls it), Fiendish Vigor (the
  grant's dice maximised, every die still thrown and recorded — twelve, because
  5.2.1's False Life is 2d4 + 4), Lessons of the First Ones (a keyed feat
  question), Pact of the Tome (three cantrips from any list and two level-1
  Rituals, simply prepared — 5.2.1 prints no spellbook clause). **The feature
  stays `manual`, honestly**: the invocations not yet built are refused rather
  than offered, and each is filed. Part two: Eldritch Spear and Repelling
  Blast (a casting's range and a push rider changed by a feature), Pact of the
  Blade and Pact of the Chain, Gaze of Two Minds, One with Shadows, Gift of the
  Depths, and the four invocations the book lets a Warlock take more than
  once, which an `option` question has no word for.
- **A save forced by a moment.** Raising is derived, rolling is commanded, so a
  death raises the burst (`raiseDeathBursts`, a derived pass over the vitals)
  and the start of a turn inside an aura raises the aura's save
  (`aurasCaughtAtStart` from `reachStartOfTurn`); both land through one body
  extracted from `forcePrintedSave`, and `settle_saves` on the player surface
  rolls a save raised mid-turn (an `end_turn` refusing `saves_pending` had no
  other door). A trait may now carry a save; a save's gate is its trigger
  rather than its heading. Both aura gates fail **open**: an undeclared sight
  or type does not spare a creature, and the roll names the fact nobody
  settled. The Half-Dragon's breath and Claw read a type the DM declares
  (`declare_damage_type`), asking until then. The Gibbering Mouther's save is
  read although its failure yields nothing the engine can land — a trait has
  no second door, so refusing it would mean the moment never arrives. A burst
  by a creature the scene never placed catches nobody, silently — the fold
  has nobody to ask.
- **Sacred Weapon, two clauses of three.** A running feature may shed light —
  derived on every read beside the six Illumination traits rather than laid as
  a patch, because `in-sunlight` requirements ask `lightAt` and a patch
  gathered through the requirement machinery would ask a question of its own
  answer; every door that ends the activation puts the light out for free. A
  feature may offer a weapon's damage type restated on each hit. **Ruled,
  from the track's stop:** the fold cannot tell a Longsword from a torch in
  `equipped` (no weapon record is pinned there, and the fold opens no
  catalogue), so "ends if you aren't carrying the weapon" is built the way a
  casting already keys a benefit to one object — the activation **names the
  weapon** and hangs a feature-sourced weapon rider on its id, and **any weapon
  rider ends when its id leaves `equipped`**, which pays Shillelagh's let-go
  clause with the same rule. In flight as W6-G2.

Appended after wave seven's first spells track (2026-09-24):

- **Six spells finished at the roll, and Sleep half.** `armor-class` has two
  arms — a base the engine competes over (Mage Armor) and a **floor** on the
  finished total read last and through plate (Barkskin) — because 17 written
  as a base is wrong in both directions at once. An `attack` effect may carry
  its own `reach` (Vampiric Touch's first swing) and a **sequenced burst**
  (`then`, Ice Knife: "hit or miss" hangs off no branch, so it is a second
  parent rather than a sixth rider, stepped over at one depth on the `attack`
  host alone — the "a child that rolls is a parent" rule stands). A save may
  auto-succeed off a defence the target already has (`autoSucceedIf`, the
  mirror of Blight's automatic failure). A settled outcome may hang a light
  (Faerie Fire) or break the target's Concentration (Sleet Storm, whose
  Cylinder is 20 feet across and 40 tall — the book's numbers). A denied
  benefit may name the effect's source (`DeniedBenefit.against`, Mind Spike:
  the brief's `relation: 'against-source'` was the wrong mechanism, since a
  `benefit` rider carries no selector). **Sleep's "creatures that don't
  sleep"** is not a list the SRD prints in its creature types, so that half is
  re-filed under `a-fact-only-the-table-can-declare`. **Shining Smite** waits
  on `attack-damage` — the one effect a cast-on-hit carries — taking riders,
  which is a decision about what the settled outcome of a spell cast on a hit
  already landed is.
- **Four spells finished in space and time, one partial, one stopped.** A
  condition may end when its holder leaves the area that imposed it
  (`endsWhenOutsideArea`, legal only under an `AreaTrigger` because the
  trigger is pinned whole and the fold reads the mark and the geometry from
  one value — Web); an area trigger may be measured from the casting's point
  rather than its area and may catch the creature whose space the point is
  rolled into (`within`, `onPointEntry` — Flaming Sphere, whose light is the
  area's and whose burn is the point's); a casting may ward a fall
  (`fall-ward`, read above the dice so a short landing still ends the spell —
  Feather Fall); Jump is the 2024 sentence, a jump the spell bought at a price
  the spell fixed, and the `jumping` shape retires; Wind Wall is the seventh
  template and the only one the caster draws (`path`), executed for its save
  and partial for its barrier. **Levitate stopped, and is ruled:** a save that
  gates a lift is a **movement rider** — `OutcomeRiders` gains `movement`
  (lift, push or pull, with feet), so a save may gate forced movement for
  Levitate, Gust of Wind and any push a failure buys; one shape rather than a
  save path in the movement resolver that Metamagic could not reach.
- **Sacred Weapon executes, and a feature keys a benefit to one object.** An
  `activated` grant may imbue one weapon (`imbuesWeapon`): the activation
  names the item and hangs a feature-sourced weapon rider on its id, so the
  Charisma bonus and the Radiant offer reach that longsword and not the dagger
  beside it; a second use ends the first. The fold's `settleWeaponRiders` ends a
  rider whose weapon has left the holder's inventory — comparing ids the
  creature already holds, no catalogue opened — and takes the activation or
  the casting with it **when the rider says so**: the ruling's "whatever
  sourced it" was wrong for SRD Magic Weapon, which imbues for an hour and
  prints no let-go clause, so `endsWhenLetGo` is declared, not assumed. The
  coordinator added the three lines the track could not: the `weapon-rider`
  effect carries the clause and SRD Shillelagh prints it. Features waiting on
  a shape: two (Eldritch Invocations' second half, Resourceful's window).
- **A save may gate a lift; Levitate and Gust of Wind execute in part.** The
  movement rider landed narrower than ruled and that is right: `ForcedMovement`
  is `push` or `lift` (no kind means push, so every older rider reads
  unchanged), the flat `save` effect is the rider's third host beside `attack`
  and `save-damage`, and `lift()` stands beside `shoveAwayFrom` writing
  `creature-moved` and `creature-lifted`. The lift is held on the creature
  (`GrantedLift`) and `settleToGround` brings it down at release, with no fall
  window, when the last holder lets go. Pull stays unwritten until a spell in
  reach asks for it. **Not built, and filed:** the `willing` word on the cast
  request — Levitate today asks the Constitution save of every target, the
  caster included, which is wrong and is the next spells brief (`fought` is
  the nearest twin, through the casting command and the resolution); the two
  activations (Levitate's altitude change, Gust's redirection); Gust's doubled
  cost toward the caster, which `areaTerrain` cannot state because it has no
  direction; Gust's gas and flames, handed to the table, whose protected-flame
  coin no longer counts as an adjudication once the spell executes — the
  definition still says it is the table's. A lifted creature may walk sideways
  through the air, since `checkRise` refuses only a rise: recorded under
  `movement-modes`. Both spells moved from tracked to executed-partial.
- **Three stat-block sentences read, two spent.** The parser reads a line that
  casts (`casts`: the list, and the ability either "the same as Spellcasting"
  or stated with its DC), a line that teleports (`teleports`) and a Reaction
  that adds to somebody's roll (`addsToRoll`), each anchored end to end. The
  teleport is a third door on one line beside the stated action and the
  printed save — `takePrintedTeleport`, spending the heading's slot, the
  recharge and the day's uses, and settling the destination through the same
  distance, occupancy and sight rules Misty Step uses; every refusal it can
  raise happens before the slot goes. The Sphinx of Wonder's Burst of
  Ingenuity is the first Reactions-section line ever compiled onto a sheet,
  and **the brief's shape for it was wrong**: `intervene` with a bonus already
  is "adds to the roll", so what was missing was a flat addend a stat block
  prints and a reach of "the sphinx or another creature within 30 feet"
  (`self-or-within`), not a new reaction kind. **The cast line is read and
  not spent, on purpose.** The heading prices the use — Divine Aid is a Bonus
  Action that casts Bless, whose own casting time is an Action — and the only
  place a casting's slot is decided is `castingOf`, which the bookkeeping
  spells track owns this batch. A door built without that hook would spend an
  Action where the book prints a Bonus Action. So the debt has a ledger row
  of its own, "A line that casts, read and not spent", and `casts` is not
  pinned onto the stated action until the door exists. **Ruling for the door:**
  a route may state a casting time (`GrantedSpell.castingTime`, one
  call-site change in `castingOf`) — a line is a route the way a feature's
  free casting is, not a pipeline of its own. Main re-ingested.
- **Five spells finished in the bookkeeping, one filed with a name, one
  stopped on a decision.** A definition may cap the castings of it running
  at once (`maxRunning`, Prestidigitation — the SRD 5.2.1 sentence caps
  non-instantaneous effects and prints no dismissal, so counting castings is
  counting that population under the engine's own reading); a `revive` effect
  brings a creature back at one hit point with its death saves afresh, refused
  on the living and on a corpse older than a minute, off `Vitals.diedAt`
  stamped by all four roads into death (Revivify); an `end-attunement` effect
  breaks the attunement to an object the caster states — the eighth stated
  fact, `cast_spell.object` (Remove Curse); a `creature-type-override` grant
  masks a creature's type for every **magical** asker and no mundane one
  (`typeMagicSees`; Arcanist's Magic Aura — one magical asker, Lay on Hands'
  `excludesTypes`, still reads the bare type and is one line for whoever owns
  `commands/features.ts` next); a `drops` rider with an `orElse` empties a hand
  or hangs the Disadvantage on a creature that could not let go (Heat Metal,
  whose second sentence is conditional on its first, so it is one rider and
  not two). Animal Messenger got `TargetRule.mustBeSize` and stays filed on the
  one fact the sheet does not carry — a stat block's Challenge Rating, parsed
  and dropped at `adaptMonster` — which the next bestiary brief carries onto
  the creature. Speak with Animals and Meld into Stone are handed over whole.
  **Command stopped, rightly:** `choiceStated` substitutes a value into an
  effect already in the list, and its docstring names the other arm as
  deliberately absent — a choice of *which effects run*. Halt, Drop and Grovel
  are each writable alone now and none can say "only if this word was spoken";
  that arm is its own brief (Command, Thaumaturgy, Enlarge/Reduce's shell).
- **Six features waiting on nothing, read.** Three Fighting Style features
  were `manual` with notes a batch stale: all four feats execute (Archery's
  narrowed bonus, Great Weapon Fighting's die rule, Defense behind
  `wearing-armor`, Two-Weapon Fighting's extra-attack damage), so the
  features declare `engine` and point at the feats. A feature may now put a
  **language** on the sheet (`language` grant, `known`) and ask for one
  (`language` question, validated against the catalogue and against the word
  *other*) — Druidic also fixes Speak with Animals prepared, Thieves' Cant
  asks its one tongue; an unanswered language question **warns** rather than
  refuses, because refusing broke every Rogue in the corpus and a corpus
  migration is its own brief. A feature may hold **knowledge**: `knowledge`
  grant, `knowledge.ts`, read by the player door's `look` as `knownDefences`
  when a casting of the knower's marks the creature (Hunter's Lore) — the
  gate is mechanical (`marksTarget` is what writes the mark), no spell id
  reaches the engine. Features waiting on a shape: two (Eldritch Invocations'
  second half, in flight; Resourceful's window). Follow-ups:
  `champion:additional-fighting-style` (level 7, out of reach) is one line;
  `STATUS.md` sits at its cap and the coordinator trims it.
- **Eldritch Invocations, part two: three of five built, and the feature stays
  `manual` on purpose.** Two standing grant kinds beside `casting-damage` —
  `casting-range` (feet scaled off the granting class's level, read where a
  reach is settled: Eldritch Spear) and `casting-rider` (an `OutcomeRiders`
  value composed onto one named spell's `attack` effects, filling a slot the
  definition left empty and never overwriting one it printed: Repelling
  Blast, whose size ceiling is `ForcedMovement.targetNoLargerThan`, read by
  `shoveAwayFrom` as the Push mastery reads its own). An option question may
  declare which options are `repeatable`; a repeated copy answers under a
  suffixed key and a copy naming what an earlier one named is refused
  (Agonizing Blast on two cantrips). A `spells` grant may carry `requires`
  (One with Shadows in Dim Light or Darkness); Gift of the Depths is a Swim
  Speed matching walk and a pool of one; Gaze of Two Minds is a filed clause,
  not an offered option, because an option that does nothing is forbidden by
  the note's own rule. **Not built: Pact of the Blade and Pact of the Chain**
  — four primitives the builder rightly declined to build at speed (a feature
  that conjures an inventory line; an ability *imposed* through a weapon
  rider; a granted route that states a casting time; a choice a route
  widens). They are the next features brief, and the feature flips to
  `engine` when they land. One review note overridden and recorded: an unlit
  room **refuses** rather than asks, because `declareLight` settles no context
  kind — the "no default ambient" ruling read from this end; making light a
  kind is the owner's call.
- **Eleven trait sentences spent, and the residue sorted.** Agile is Flyby
  asked of every mode; Running Leap is a second bound on a jump that was run;
  Aura of Authority is Aura of Protection's shape worn by a stat block; Blood
  Frenzy is a roll mode narrowed by a new `RollSelector.targetMissingHitPoints`
  (the brief pointed at the `attack-damage` grant's field, which is not a
  roll-mode axis); Siege Monster doubles beside the ward in `dealSpellDamage`,
  multipliers first as the book orders; Aberrant Ground is `carriedLight`'s
  twin on the ground (`carriedDifficultGround`, read by the terrain arithmetic
  in `positioning.ts` rather than duplicated in `movement.ts`); Lightning and
  Fire Absorption heal what the blow **rolled**, before Immunity, since both
  holders are immune and the trait would otherwise be dead text — the ruling
  is on the kind; Aversion to Fire and Freeze are a damage-type trigger with a
  timer; Blurred Form is the first printed `against-holder` mode; Beast of
  Burden is Powerful Build's grant; Fire Aura and Barbed Hide are settled by
  `resolveTurn`, the finisher's end then the beginner's start, and **the
  aura's "of the azer's choice" is the table's** — `end_turn.burns`, `fought`'s
  twin, an empty answer burning nobody. Nineteen trait kinds are the **third
  answer**, read so the table gets the sentence and never built, each with
  its reason; the rest of the residue is a mechanic with a named seam, row by
  row in `coverage-data.ts`. **Corrections to the brief, from the book:** the
  Troll regains 15 and its Limb 5; the Gray Ooze prints no damage-back; the
  Cat's Jumper substitutes Dexterity for the jump; Bloodied Fury narrows to
  melee. **A gap found and left for the Reactions brief:** a blow held open at
  a Reaction window settles through `applyDamage` directly, so a Bard within
  60 feet costs an Earth Elemental its doubling — one call in `settleDamage`.
  Main re-ingested.
- **A choice of which effects run.** `SpellDefinition.options` is the second
  arm of `a-choice-made-at-the-casting`: named branches, exactly one run per
  casting, named on the request as the tenth stated fact (`option`), required
  where the spell prints branches and refused where it prints none, never
  defaulted, pinned on both records; `optionEffects` is the one reader and
  the identity for every spell without branches. `DropRider.all` is Command's
  "drops whatever it is holding". Command and Thaumaturgy are executed-partial;
  Enlarge/Reduce has its two-branch shell with every clause filed. **Four
  readings against the brief, all on validator evidence:** a save lives in the
  branch, not the common list, because an effect appended after a save does
  not know how it went and only a rider does; Approach and Flee roll no save,
  because a save that imposes nothing is refused at authoring — the die goes
  to the table with the sentence; Enlarge/Reduce's save is unwritten for the
  same reason; Booming Voice's Advantage is filed because the spell targets
  nobody and "the caster and nobody else" is a target rule the format lacks.
  Command's drop and Prone land at the casting rather than on the target's
  next turn, filed honestly. **Owed:** readying a spell with branches is
  refused `option_required` until `ReadyResponse` carries the word (the
  stated-action file, a bestiary track's this batch); an attack-family effect
  inside a branch is refused (`PRESETTLED_EFFECT_KINDS`) because the target
  list is sized off the common list before a branch is read;
  `docs/design/casting.md` owes a line about branches, which the coordinator
  adds. "Spells in reach, not executed" did not move: executed-partial still
  counts, which is the honest reading.
- **`willing`, the ninth stated fact.** A list of target ids on the cast
  request, elided when empty, pinned and read back at settlement, read by two
  clauses: `save.unlessWilling` (Levitate) **withholds** the die from a
  consenting target — no roll, no record, the caster consenting by casting —
  and `TargetRule.willing` (Mage Armor and eighteen more at levels 0–3, the
  population read off the book's own word rather than typed) **asks** for a
  named target nobody has spoken for, `needsContext` tagged on the route the
  way Alert's willing ally already is; the engine holds no rule that an ally
  consents. Levitate's later action is a `change-altitude` effect legal only in
  an activation, refused past its cap, past range, or on a creature the
  casting is not holding aloft, and lowering to the ground leaves the lift
  standing; Gust of Wind's Bonus Action re-aims the Line (`redirects`,
  `spell-aim-changed`), and **a defect nobody had seen fell out**: an ongoing
  record stored its bearing only where the casting named a point, so a Line
  that "blasts from you" folded to a record with no shape and Gust's
  end-of-turn save had never fired — `carriedAim` carries it now, inert on
  Fear and Sunbeam, fixtures unchanged. Handed over: Levitate's "if you are
  the target, you can move up or down as part of your move", which needs the
  feet risen counted per turn on `GrantedLift` — a record the brief said not
  to invent; it sits under `movement-modes`. Longstrider and Death Ward print
  no consent clause and were dropped from the brief's list.
- **A family of D20 Tests, a penalty on the target's own damage, a success
  that costs something.** `RollFamily` gains `d20-test` — the glossary's union
  of check, attack and save — legal only narrowed by an ability, because every
  consumer in reach prints "Strength-based" and the bare phrase is Foresight's
  at level 9; Initiative and the death save are outside it, being made with no
  ability. The twentieth sourced grant is a **damage penalty** on the creature
  that rolls (`GrantedDamagePenalty`, the mirror of the reduction on the other
  side of a blow), read at the two funnels — `dealSpellDamage` and
  `landDamage` seeding the held damage's adjustments — so every weapon attack,
  spell, scheduled hit and smite meets it and damage with no dealer does not,
  which is right. `save.onSuccessRiders` hangs a mode, a condition, a movement
  or a spend on a made save and refuses damage there on the book's authority.
  A repeat save on a failure that imposes no condition rides the **casting's
  own deadline** (`castingHostedRepeat`, Searing Smite's road), which the brief
  did not commission and the spell could not be written without. Ray of
  Enfeeblement executes from the 5.2.1 text, whose success rider ends at the
  start of the caster's next turn and whose repeat ends the spell — the
  brief quoted the 2014 words. `docs/design/rolls-and-damage.md`'s "no member
  for D20 Tests" sentence is amended. Owed: `applyRiders`' docstring said
  "there is no success branch", now false — the coordinator corrects it.
- **The Reactions section reaches the sheet, Shield answers both its
  triggers, and the held-damage road is closed.** Ten more Reaction lines are
  read: Parry's Armour Class (`addsToAc`, seven blocks), a response that is
  another printed line (`usesLine`, the Rust Monster's Antennae — offered,
  spent, the response handed over by name) and three named kinds filed
  (Split, Redirect Attack, the Shrieker's noise as a handover).
  `hit-by-attack` is a feature window now — `raise-ac` is Shield's arithmetic
  with the span taken off, closing on the damage — and `take_attack_reaction`
  is on both surfaces because whoever was hit answers. A seventh window,
  `targeted-by-spell`, is Counterspell's hold answered from the other end;
  Shield's second trigger is a **field** (`targetedBy`, a spell id a string
  union could not carry) and the negation pins the spell read off the
  triggering casting and turns that spell's damage aside **for the whole
  span**, because the book puts both halves inside one duration — the brief
  asked for a narrowing by casting id and the book does not narrow it, so
  Shield leaves the partial list honestly. The gap the traits track found is
  closed: `settleDamage` asks `siegeDoubling` and the printed type triggers at
  the same two points the unheld road does, tested with a Bard in the room.
  Owed: `docs/design/rolls-and-damage.md`'s "Reaction windows" paragraph
  (the coordinator's), and a STATUS.md sentence. Main re-ingested.
- **Read to the end.** A spell whose every clause is the table's is finished
  business and the ledger counts it apart: `LedgerRow.handedOver`, a fourth
  column, and a heading of its own in §1 — "Read to the end, handed over
  whole" — listing each by name, the way a handed-over trait is already
  counted apart from the bestiary's items. Thirty-two of the thirty-five left
  the population that way: their `unmodelled` debts are gone and the book's
  own sentences sit in `dmDecides`, verbatim, which eleven definitions already
  used and a guard file already held. **Three did not survive the reading and
  are filed as debts:** Gentle Repose (its "extends the time limit on raising
  the target from the dead" is arithmetic over `Vitals.diedAt` that
  `revive.within` really reads — a corpse under this casting is refused by a
  Revivify the book allows), Magic Mouth (`a-casting-dismissed-early`) and
  Major Image (`a-duration-the-slot-changes`: at a level 4 slot the engine
  takes a Concentration the book says it does not require). **No clause was
  found expressible** — the five hard candidates each have their reason in
  the definition's comment. **Ruling on the decision the track raised:**
  Gentle Repose's sentence is *a window another casting widens*, not a longer
  window on its own; the id `a-window-another-casting-widens` is minted for it
  and goes into the next odds-and-ends spells brief with Magic Mouth and Major
  Image. "Spells in reach, not executed" is 52 by that count, all of them
  waiting on a shape.
- **A line that casts, spent; a Challenge Rating carried; a road closed
  before it opened.** `GrantedSpell.castingTime` is a casting time the route
  states and `castingOf` prefers, as ruled; `adaptMonster` compiles a block's
  cast line into granted routes — the heading's price, the line's ability and
  DC or the Spellcasting trait's, refused whole into the sheet's caveats when
  the block prints no trait to point at — and `castPrintedLine` is a fourth
  door beside the stated action, the printed save and the printed teleport,
  spending the day's use or the recharge and handing the casting to the
  pipeline (`cast_printed_line`, the DM's). "On itself" and the book's
  line-break hyphen are read (Imp, Quasit, Sprite, Oni); **SRD 5.2.1 prints
  no Coven Magic line**. A creature carries the Challenge Rating its block
  prints (`creature-added.cr`, nullable — a character has none), and
  `autoSucceedIf.challengeRatingAbove` reads it, asking rather than assuming
  about a creature nobody rated. **The reviewer escalated a bypass and it is
  closed:** a compiled route's source string is published, so `cast_spell`
  naming it would have cast Bless as a Bonus Action for ever; `chooseRoute`
  now refuses a `throughLine` grant without the printed line's licence, which
  travels as an internal argument from `castPrintedLine` and sits on no
  request and no schema, and a Ready of such a line is refused before the
  slot. Animal Messenger keeps one clause: a save whose whole content is its
  verdict, ruled for the area-standing brief. Main re-ingested.
