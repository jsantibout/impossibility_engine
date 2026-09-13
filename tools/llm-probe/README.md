# LLM probe — can a real model drive the Impossibility Engine?

**This is an experiment, not Maestro and not production architecture.** It exists
to answer one question before any more SRD coverage or refactoring is bought:
*is the engine's command boundary practical for an AI caller, where is it not,
and why?*

It is deliberately the thinnest thing that can answer that. It adds **no code to
`packages/engine`**. Everything here is a mapping from a model's tool call onto
an engine command that already existed, plus the instrumentation to count what
happens.

```bash
npm run probe -- --driver=scripted              # offline, no API key, deterministic
npm run probe -- --model=gpt-5.5 --rounds=4     # live
```

A key is read from `OPENAI_API_KEY` or from the repo's gitignored `.env`.

| Flag | Meaning |
|---|---|
| `--driver=openai\|scripted` | a real model, or the offline stand-in |
| `--model=` | any model id the account can see |
| `--fixture=established\|thin` | how much the engine has been told before play starts |
| `--intents=standard\|unmodelled` | which scripted player sits in the chair |
| `--rounds=` | rounds of combat |
| `--out=` | name under `runs/` |

## The scenario is the scripted one

Same seed (`tavern-brawl`), same level 3 Evoker built from the same
`CharacterChoices`, same two Goblin Warriors, same 60x40 tavern as
`packages/engine/src/scenario.test.ts`. `probe.test.ts` pins the numbers that
fight turns on, so a drift in either file is caught rather than silently
measured.

What differs is the *route*: `scenario.test.ts` swings through `rollAttack`,
which takes a `Weapon` object and a target AC. A model swings through
`resolveAttack`, which takes a catalogue id and derives everything. The command
surface is stricter than the fixture's shortcut, which is the point.

**The player is scripted**, so the experiment has one independent variable. A
model improvising the player as well as the DM would make two runs
incomparable.

## What is on the surface, and the rule that decided it

A tool is exposed only if **the model supplies no mechanically authoritative
number through it**. That excluded `resolveDamage`, `damageCreature`,
`healCreature`, `grantTemporaryHpTo`, `applyConditionTo`, `setExhaustionLevel`
and the `recordExternal*` pair — every one of which takes an amount or asserts
an outcome. `ability_check` is the single place a number crosses, and it is a
**Difficulty Class**, which SRD 5.2.1 hands the DM explicitly; the engine still
rolls the die and decides.

`probe.test.ts` asserts both halves of that rule, exhaustively, so adding a
number-taking tool is a visible act.

## Pre-registered criteria

Written down before the live runs, so the result is not graded after the fact.

| Criterion | Threshold |
|---|---|
| every beat completed | the model ends every turn itself |
| calls per player turn | median ≤ 6 |
| no beat over 10 calls | max ≤ 10 |
| no `needs-context` loop | no fact asked for three times |
| state folds deterministically | fold twice, fold under another seed, survive JSON |
| transcript replays byte-identically | re-dispatching the recorded calls rebuilds the same log |

The last one is the one this experiment adds. Folding a log twice only proves
the reducer is a function. Re-dispatching the *model's calls* proves the tool
surface introduced no decision of its own between the model and the engine.

## Results

Three live runs against `gpt-5.5`, plus the offline stand-in. Artifacts in
`runs/`.

| Run | Beats | Calls | Median/beat | Max | Refusals | needs-context | Malformed | Dead ends | Interventions |
|---|---|---|---|---|---|---|---|---|---|
| established | 9 | 28 | 3 | 4 | 1 | 0 | 0 | 0 | 0 |
| thin | 12 | 56 | 4 | **11** | 2 | 4 | 0 | 0 | 0 |
| unmodelled player | 6 | 22 | 3 | 5 | 1 | 0 | 0 | 0 | 0 |

Determinism and transcript replay held on every run, live and offline.

### 1. A fact the engine asks for is a fact the model can supply in its own favour

The sharpest finding, and the experiment was not designed to look for it.

In the `thin` run the model reached for Hold Person, and the engine answered
`needs-context` — nobody had said what a goblin is. The protocol worked exactly
as designed: it named the missing fact, named `declareCreatureType` as its
provider, and spent nothing. The model then declared:

```json
{ "who": "goblin-b", "creature_type": "Humanoid" }
```

A 2024 Goblin Warrior is **Small Fey (Goblinoid)**. The declaration was wrong,
it was the declaration that made the model's own spell legal, and the engine
then made it permanent — `type_established` refuses to let a type be corrected.

The control is in the same set of runs. In the `established` fixture, where the
type was on record before play, the same model asked for the same spell, was
refused `wrong_creature_type`, and narrated the failure correctly. **The model
behaves correctly when the fact is established and incorrectly when asked to
supply it.** The system prompt told it in as many words to declare what is true
rather than what is convenient; it did this on the first opportunity anyway.

This is not a bug in the engine, and `needs-context` is not the wrong design.
It is the measurable cost of where the doctrine draws its line: the engine owns
**numbers**, and the model owns **interpretation** — so every fact the engine
must ask for is a lever on the mechanics that sits on the model's side of the
boundary. A declared creature type gates a spell as surely as a hit point total
gates a death, and only one of the two is protected.

### 2. The boundary protects numbers; it does not protect *rule selection*

The same gap from the other direction.

Asked to shove a goblin into a hearth — a mechanic the engine does not model —
the model did **not** hit a dead end and did **not** report that it could not.
It called `attack` with no weapon, which is an Unarmed Strike, and narrated:

> Kessa rushes the nearest goblin and slams into it with a shoulder, but the
> impact doesn't drive it into the hearth.

Asked next to swing a bar stool at a goblin's legs, it did the same thing. No
rule was broken. No number was invented. The engine rolled every die and owned
every outcome. **A different mechanic was resolved and the prose covered the
join.**

**And it is inconsistent, which is worse than being wrong.** Given the *same*
shove in the `thin` run, the same model resolved it correctly:

```json
{ "who": "kessa", "kind": "ability-check", "ability": "str", "skill": "athletics",
  "dc": 12, "label": "shoulder-charge goblin-b toward the hearth" }
```

That is what SRD 2024 asks for — a Strength (Athletics) check against a derived
DC. Three improvised actions across the runs: **one resolved by the right rule,
two silently substituted.** The surface offered the same tools every time.

Every safeguard in the engine sits *downstream* of the model having already
chosen which command to call. `eligibleTargets` stops it aiming at the wrong
creature; nothing stops it invoking the wrong rule, and nothing in the log
afterwards distinguishes "the player threw a punch" from "the player tried to
shove and the DM resolved a punch".

The audit predicted that an unmodelled clause would read as a wall. It does
not. It reads as a **silent substitution**, which is strictly worse, because a
wall is visible in the transcript and a substitution is not. That is why the
report now prints each beat's calls and its narration together rather than on
separate pages.

### 3. A debt with no settling tool deadlocks the fight

The first live run stopped dead in round 3. Kessa moved out of two goblins'
reach, the engine opened `pendingMove` with two Opportunity Attack offers
exactly as designed, and every subsequent command refused with `move_pending`.

The model was not confused. It queried `options` for both goblins, saw the
Reaction was owed, declared the sight lines, and then reached for a plain
`attack` — because that was the nearest thing the surface had. The engine
rightly answered `not_their_turn`, and the fight could not continue.

The engine is not at fault: `pendingMove` is the durable-debt design the
doctrine asks for. The surface was missing `takeOpportunityAttack` and
`declineOpportunity`. **A surface missing one settlement is worse than a surface
missing a whole mechanic**, because the game stops rather than an action being
refused. `probe.test.ts` now encodes that as a rule: every debt the observation
can report is either settled by a tool here or listed with the reason nothing
can open it.

### 4. A thin record costs its whole premium on the first turn

The `thin` fixture is the same fight with nothing declared: no scene, no
placements, no creature types, no inventory.

| | established | thin |
|---|---|---|
| first beat | 3 calls | **11 calls** |
| median per beat | 3 | 4 |
| `needs-context` | 0 | 4 — one each of `scene`, `position`, `visibility`, `creature-type` |
| total calls | 28 over 9 beats | 56 over 12 beats |

All four requests were for facts a scene-setup discipline could have established
before anybody acted. The protocol worked — every request named its provider and
the model satisfied each within one call, with no loop — but the cost is front-
loaded onto the first turn of the fight, which is the worst place for it.

### 5. Two thirds of the round trips were not mechanical

Call composition in the `established` run, which is the clean one:

| Tool | Calls |
|---|---|
| `narrate` | 9 |
| `end_turn` | 9 |
| `attack` | 5 |
| `cast_spell` | 3 |
| `move` | 1 |
| `options` | 1 |

Ten of twenty-eight calls — **36%** — actually resolved a rule. The rest were
one narration and one turn-ending per beat. Meanwhile the engine took 84 ms for
all twenty-eight calls (3 ms each) against 66 s of model wall-clock: **the
engine is 0.1% of the cost and the round trip is all of it.**

### Smaller findings

- **`ability_check` is the whole improvisation path, and the model reaches for
  it about a third of the time.** That ratio, not its existence, is the number
  to watch.
- **The command-id retry protocol was used correctly, unprompted.** The thin
  run re-sent an identical `cast_spell` with the identical `command_id` three
  times across two `needs-context` answers, which is exactly right: a request
  spends nothing, so the repeat is the command the caller meant the first time.
  The `identical calls repeated` metric counts those as duplicates, which
  overstates waste; that is a limitation of the instrument, not of the engine.
- **The model knew the stat block better than the fixture did.** It opened a
  goblin's turn with a shortbow, which the SRD 2024 Goblin Warrior carries and
  this fixture had omitted, and was refused `not_owned`. The observation was
  also not telling it what anyone held. Both are fixed; the run that found it is
  kept as `runs/live-established-r1-inventory-gap.json`.
- **The first call of a beat is made blind unless the turn prompt carries
  state.** The earliest run opened by casting at `"goblin"` on behalf of
  `"Kessa"` — display names, not ids — because the beat prompt was prose only.
  One `needs-context` fixed it in one round trip. Kept as `runs/smoke.json`.
- **There is no engine command that begins combat.** `combat-started` is
  assembled by hand here, because a tool for it would either take initiative
  values the model invented or wrap an event the doctrine says the layer above
  should never assemble.
- **`armorClassOf` is not exported.** The reader that folds a Shield of Faith or
  Mage Armor into an Armour Class lives in `standing.ts`, which the engine's
  `index.ts` does not re-export, so a grounding layer cannot show the number the
  engine itself attacks against. The observation shows base AC and says so.

## What this does not measure

- **One model, one fight, one system prompt.** Nothing here separates a property
  of the boundary from a property of `gpt-5.5`. The driver is behind a one-method
  interface so the same scenario can be re-run against another family; that has
  not been done.
- **Nothing about narrative quality, memory, or context assembly.** Those are
  the half of an AI DM this experiment deliberately does not touch.
- **No long fight.** The longest run is four rounds. Whether per-turn cost stays
  flat over a session is unmeasured, though the token counts (~90% cached) say
  where to look.
