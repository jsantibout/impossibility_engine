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

The starting numbers, 2026-09-21, unique over all twelve paths at level 5:

| Ledger | Size | Waits on an engine shape | Waits on none |
|---|---|---|---|
| Spells in reach, not executed | 141 | 89 | 52 (6 handover-only, Darkness, 45 never adjudicated) |
| Features manual, or a pool with nothing to buy | 31 | 21 | 10 (3 Fighting Styles, 3 languages/knowledge, 4 pools the map cannot see) |
| CR ≤ 5 stat-block items: handed-over lines + unapplied hit riders | 434 | on 198 of 242 blocks | 44 blocks already clean |

Two doors that exist in the engine and reach no tool: Action Surge and Flurry
of Blows (`useBudgetPurchase`). Seven spells in reach with no definition at
all: Magic Missile, Entangle, Find Familiar, Darkness, Phantasmal Force,
Sending, Slow.

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
| **G1** | Phase 0 and Phase 1 merged | whether the ledger tooling measures what it claims; re-rank Phase 2 from the regenerated ledger; approve the sight-model design note (P2-T22) for the owner's ruling |
| **G2** | Phase 2 merged, integration milestone I-1 reached | re-rank Phase 3; decide whether any Phase 3 group needs a design note; check the Infinite Realms adapter holds the doctrine's lines |
| **G3** | Phase 3 at ledger zero, milestone I-2 reached | criteria 1–3; the last shapes that resisted; whether the tail's handovers are honest |
| **G4** | milestone I-3 | criterion 4; declare levels 1–5 playable; open the level 6+ question |

Between gates the foreman merges clean tracks without asking, exactly as
`WORKFLOW.md` step 4 says.

## 3. Phase 0: instrumentation first

Small, and before any mechanics, because every later batch is chosen and
measured with these. One batch, tracks partitioned by file.

- `[ ]` **P0-T1 The ledger becomes a generated file.** Promote the audit's
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
- `[ ]` **P0-T2 The reachability test.** In `packages/tools`, build one
  level 5 character per path with `createCharacter`, fold, read
  `holdingsOf`, and assert every `automation: 'engine'` feature is one of:
  passive, creation-time (spellcasting, subclass, ASI, expertise, mastery,
  extra attack, unarmoured defence, strike style, granted spells), a
  reaction whose window `TAKEN_BY` answers, or spendable with a `spentBy`.
  It fails today on Action Surge and Flurry of Blows and passes once P1-T1
  lands; brief the two together. Files: new
  `packages/tools/src/reachability.test.ts`, `holdings.ts`
  (`budgetPurchases` branch). Moves: criterion 2 exists.
- `[ ]` **P0-T3 The session test.** In `packages/tools`, a scripted level 5
  party (Fighter, Cleric, Rogue, Wizard is the suggestion; four paths that
  between them touch weapons, slots, Sneak Attack, Channel Divinity and
  concentration) against a CR-appropriate encounter, through
  `createSurface` and `createDmSurface`: place, roll Initiative, four rounds
  using every printed line and every held feature the surfaces expose, end
  the fight, Short Rest, Long Rest, `advance_character` to 6. Count every
  `unverified` clause, every handed-over line and every `manual` feature the
  party held and could not use. Print the count; assert nothing yet. Moves:
  criterion 3 exists and is a number from day one.
- `[ ]` **P0-T4 Widen the feature blocker map** (owner ruling 4,
  2026-09-21). `packages/content/scripts/missing-feature-shapes.ts` selects
  its population by `automation === 'manual'`; add a second population of
  `engine` features whose grant is a bare `pool` or whose note says a half is
  unapplied, and entries for `druid:wild-shape`, `sorcerer:font-of-magic`,
  `wizard:arcane-recovery`, `paladin:channel-divinity`, `monk:focus` (Patient
  Defense and Step of the Wind). Moves: five features the map could not see.
- `[ ]` **P0-T5 The yard.** All small, one builder, one commit each:
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
  list. Then, by the owner: prune the eighteen merged worktrees under
  `.claude/worktrees`, push the commits ahead of `origin/main`.
- `[ ]` **P0-T6 STATUS.md to its cap**, by the foreman: "What runs" to a
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

- `[ ]` **P1-T0 Triage the 45 unadjudicated tracked spells in reach.**
  Content only. The list is in the ledger §1(a). For each: read the SRD
  paragraph; write the definition if every mechanical clause fits an existing
  effect kind or grant (Expeditious Retreat's Bonus Action Dash is an
  `action-rule`; Alarm's trigger is a handover); otherwise give it an entry
  in `TRACKED_ADJUDICATED` naming the shape it waits on. Do not invent a
  shape id; if none fits, file it under `a-world-fact-nothing-can-represent`
  with the sentence quoted. Moves: the ledger becomes honest; some spells
  execute on no engine change. *Verify first:* "no entry" means unread, not
  finished; the audit over-read it as finished.
- `[ ]` **P1-T1 The `use_budget_purchase` door.** `useBudgetPurchase`
  (`packages/engine/src/commands/budget.ts:52`, on the barrel at
  `commands.ts:130`) is complete and reachable by nothing. Add the tool after
  `use_pool_option` in `packages/tools/src/definitions.ts`, a `SPENT_BY`
  member after `'action-price'` in `holdings.ts`, the `budgetPurchases`
  branch in `holdingsOf`, and the reachability test (P0-T2). Moves: Action
  Surge, Flurry of Blows.
- `[ ]` **P1-T2 Darkness, tracked.** Its `BLOCKED_ON` entry is four
  handovers and one expressible clause: a 15-foot Sphere at a point
  (`SpellArea`, `spell-definitions.ts:1558`). Write it after `DAYLIGHT` in
  `spells.ts`, delete the `BLOCKED_ON` entry, let `coverageGaps().stale`
  confirm. It executes only when the sight model lands (P3-S). Moves: 1 of
  7 undefined.
- `[ ]` **P1-T3 A choice made at the casting, and a bonus narrowed to a
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
- `[ ]` **P1-T4 A condition benefit an effect takes away.** Union anchor
  after `end-condition` (`spell-definitions.ts:1081`); dispatch after
  `case 'end-condition'` (`spell-resolution.ts:1785`); validator after the
  same case (`spell-schema.ts:1387`). The readers that grant the Invisible
  condition its benefits are in `packages/engine/src/conditions.ts`
  (`initiativeConditionModes:505`, the attack-side halves at 275–360), **not**
  `conditionApplicability` in `monster.ts` as the map says. Files:
  `conditions.ts`, `commands/spell-effect-conditions.ts`, `spells.ts` after
  `FAERIE_FIRE`. Moves: Starry Wisp, Faerie Fire, Mind Spike.
- `[ ]` **P1-T5 Forced movement, and what is left of falling.** Union anchor
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
- `[ ]` **P1-T6 Several attack rolls from one casting.** A count on the
  existing `attack` member (`spell-definitions.ts:761`), each roll able to
  take its own target, scaled by slot or by cantrip level; validator inside
  `case 'attack'` (`spell-schema.ts:1263`). Files:
  `commands/spell-effect-rolls.ts`, `spell-definitions.ts`, `spell-schema.ts`,
  `spells.ts` after `ELDRITCH_BLAST`. Moves: Eldritch Blast's beams at level
  5, Scorching Ray. Chromatic Orb is left one blocker short.
- `[ ]` **P1-T7 Healing modified by an effect, and a hit point maximum a
  spell moves.** Union anchor after `turn-payout` (`spell-definitions.ts:964`);
  dispatch after `case 'turn-payout'` (`spell-resolution.ts:1777`); validator
  after it (`spell-schema.ts:1447`). `heal` (`vitals.ts:210`) and
  `healCreature` (`commands/creatures.ts:557`) are the sites; a maximum that
  moves must survive `advance_character`'s own recomputation. Files:
  `vitals.ts`, `commands/spell-effect-hit-points.ts`, `commands/creatures.ts`,
  `spells.ts` after `BEACON_OF_HOPE` and after `AID`. Moves: Beacon of Hope,
  Chill Touch, Aid; `draconic-sorcery:draconic-resilience`.
- `[ ]` **P1-T8 What a creature is holding.** Hands, and a conjured thing
  that occupies one. `docs/design/characters-and-equipment.md` says nothing
  checks two hands are free. Files: `commands/inventory.ts`, `character.ts`
  (the equipped set), `spells.ts` after `GOODBERRY`. Moves: Goodberry, Flame
  Blade; Heat Metal and Fear each one short. *Sequence:* P1-T13 also edits
  `character.ts`; give the file to one of them and queue the other.
- `[ ]` **P1-T9 A standing effect derived from where a creature stands.**
  `StandingScope` already has `{ kind: 'aura'; feet }`
  (`packages/engine/src/standing.ts:96`). *Verify first:* establish what an
  aura does not reach today before writing the brief; the shape's prose
  predates the scope. Files: `standing.ts`, `commands/spell-effect-grants.ts`,
  `spells.ts` after `SPIRIT_GUARDIANS`. Moves: Zone of Truth, Spirit
  Guardians; the Fire Aura and Stench stat blocks.
- `[ ]` **P1-T10 An effect a hit buys, for stat blocks.** The largest single
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
- `[ ]` **P1-T13 Movement modes and jumping** (owner ruling 1, 2026-09-21:
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

## 5. Phase 2: batch 2

Re-ranked at G1 from the regenerated ledger; this is the expected shape.

- `[ ]` **P2-T11 A `summon` effect kind** (owner ruling 2: a bestiary id
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
- `[ ]` **P2-T14 Damage with neither an attack roll nor a save, and one
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
- `[ ]` **P2-T17 A random outcome that is not a d20**, as a spell effect
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
- `[ ]` **P2-T20 An option re-chosen on a rest, and a later feature that
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
- `[ ]` **P3-W Wild Shape**, ruled 2026-09-20 (gear merges; AC is always
  the block's; an oversized form is the forced-movement rule; known forms are
  chosen at the start of a Long Rest; Wild Companion's familiar goes away
  when a Long Rest completes). Needs P2-T11 and P1-T13. Shape-Shift on the
  thirteen CR ≤ 5 blocks that print one (Doppelganger, Imp, Werewolf) is the
  same mechanism from the monster side.
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
