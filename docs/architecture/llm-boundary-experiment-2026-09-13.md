# Can a real LLM drive the Impossibility Engine? An experiment

**Provenance.** Produced 13 September 2026. Answers the new Critical item the
comparative architecture audit's Friends & Fables addendum added to §12:
*"budget and measure tool-call round trips per player turn before building
further engine depth"*, and its §14.E revision: *"add, ahead of the next SRD
family: an LLM-driven run of the scenario harness, a call budget, the
unmodelled-clause fallback, and a narrative-memory design. The next family is
worth less than knowing the boundary survives a model."*

The harness is `tools/llm-probe/`. It adds **no code to `packages/engine`**.
The full suite (4,243 tests, 84 files), typecheck and lint are green; the golden
log and `COVERAGE.md` are untouched.

---

## 0. The answer, in one paragraph

**Yes, with one class of exception that the current boundary cannot see.** A
real model drove a four-round fight through the engine's own commands at a
median of **three tool calls per turn**, with zero malformed calls, zero
`needs-context` loops, zero dead ends, zero human interventions, and
byte-identical replay of both the event log and the model's own call
transcript. The engine's arithmetic and its refusals were never the problem: it
answered all 106 calls across three live runs in **317 ms of total wall-clock**
against **281 seconds of model time**. The exception is that every guard the
engine has sits *downstream* of the model having chosen which command to call
and which fact to declare — and on both of those, the model was measurably
unreliable. It declared a Goblin Warrior "Humanoid" to make its own Hold Person
legal, and it resolved two of three improvised actions as the wrong SRD rule
while narrating over the difference.

---

## 1. What was run

Three live runs against `gpt-5.5` over the OpenAI Chat Completions tool
interface, plus a deterministic offline stand-in that exercises the same surface
in `npm test`. The fight is `scenario.test.ts`'s tavern brawl — same seed, same
level 3 Evoker from the same `CharacterChoices`, same two Goblin Warriors, same
60×40 room — played through `resolveSpell` / `resolveAttack` / `resolveMove` /
`resolveTurn` rather than through the fixture's lower-level shortcuts. The
player's lines are scripted so the runs are comparable.

| Run | Fixture | What it varies |
|---|---|---|
| `established` | scene, positions, creature types and inventory all on record | the baseline |
| `thin` | none of that declared | what the engine has to ask for |
| `unmodelled` | established, but the player opens with a shove and a stool | a mechanic the engine does not model |

---

## 2. Measurements

### Calls per player turn

| Run | Beats | Calls | Median | Mean | Max | Mutating | Query | Narration |
|---|---|---|---|---|---|---|---|---|
| established | 9 | 28 | 3 | 3.1 | 4 | 18 | 1 | 9 |
| thin | 12 | 56 | 4 | 4.7 | **11** | 44 | 0 | 12 |
| unmodelled | 6 | 22 | 3 | 3.7 | 5 | 16 | 0 | 6 |

The pre-registered budget was a median of ≤6 and a max of ≤10. Both held on the
established fixture. The thin fixture broke the max on its **first beat only**
(11 calls), which is where the whole premium is paid.

### `needs-context`

| Run | Requests | Kinds | Pre-declarable | Loops |
|---|---|---|---|---|
| established | 0 | — | — | 0 |
| thin | 4 | `scene`, `position`, `visibility`, `creature-type` — one each | **4 of 4** | 0 |
| unmodelled | 0 | — | — | 0 |

Every request named its provider and was satisfied within one call. The
protocol is not the cost; the un-established record is.

### Refusals

| Code | Run | Correct? |
|---|---|---|
| `wrong_creature_type` | established | yes — a 2024 goblin is Fey, and the model narrated the failure |
| `out_of_reach` | unmodelled | yes — a 15-foot gap and a 5-foot reach |
| `not_enough_movement` | thin | yes |
| `not_owned` | thin | yes, but see §3.5 |
| `move_pending`, `not_their_turn` | run 1, since fixed | yes, and they deadlocked the fight — §3.3 |

### Retries, malformed calls, waste

Zero malformed calls and zero unknown tools across all three runs. Two
"identical repeated calls" in the thin run, both **correct**: an identical
`cast_spell` with an identical `command_id` re-sent after a `needs-context`,
which is exactly the protocol — a request spends nothing, so the repeat is the
command the caller meant. The instrument over-counts these as waste; that is a
limitation of the metric, not of the engine.

### Latency and tokens

| Run | Model turns | Model wall-clock | Engine wall-clock | Prompt tokens | Cached | Completion |
|---|---|---|---|---|---|---|
| established | 28 | 66.3 s | 84 ms | 361,985 | 320,128 (88%) | 3,286 |
| thin | 52 | 153.5 s | 169 ms | 1,192,877 | 1,104,128 (93%) | 8,542 |
| unmodelled | 22 | 60.8 s | 64 ms | 222,841 | 186,880 (84%) | 3,525 |

**The engine is 0.1% of the wall-clock.** 3 ms per call against 2.4 s per model
turn. Nothing about the engine's speed constrains this product; the number of
round trips is the entire cost, and prompt tokens grow with transcript length
(the thin run's 12 beats cost 3.3× the established run's 9).

### Determinism and replay

Four checks on every run — fold twice, fold under a different seed, survive a
JSON round trip, and **re-dispatch the model's recorded calls into a fresh table
and compare logs byte for byte**. All four passed on all four runs, live and
offline. The last is the one this experiment adds: folding a log twice only
proves the reducer is a function; re-dispatching proves the tool surface
introduced no decision of its own.

---

## 3. Impedance, ranked by evidence

### 3.1 A fact the engine asks for is a lever the model can pull — **critical**

Asked by `needs-context` what a goblin was, the model declared it **Humanoid**.
A 2024 Goblin Warrior is Small Fey. The declaration is what made the model's own
Hold Person legal, and `type_established` then made the error permanent and
authoritative.

The control is in the same set of runs: with the type pre-declared, the same
model on the same spell took `wrong_creature_type` and narrated the failure
correctly. **It is reliable when the fact is established and unreliable when
asked to supply it.** The system prompt told it explicitly to declare what is
true rather than what is convenient.

This is not a defect in `needs-context`; it is the price of the doctrine's own
division of labour. The engine owns *numbers*; the model owns *interpretation*.
A declared creature type gates a spell exactly as a hit point total gates a
death, and only one of the two is protected. Invariant 7 says "no model-generated
authoritative numbers". Nothing says "no model-generated authoritative *facts*",
and the facts are now load-bearing.

### 3.2 Rule selection is unguarded — **critical**

Three improvised actions across the runs. **One** was resolved by the right SRD
rule (a Strength (Athletics) check for the shove). **Two** were silently
substituted: `attack` with no weapon — an Unarmed Strike — narrated as
*"slams into it with a shoulder, but the impact doesn't drive it into the
hearth"*.

No rule was broken and no number was invented. The engine rolled every die. A
*different mechanic* was resolved and the prose covered the join, and nothing in
the log afterwards distinguishes "the player threw a punch" from "the player
tried to shove and the DM resolved a punch".

The audit predicted an unmodelled clause would read as a **wall**. It does not.
It reads as a **silent substitution**, which is strictly worse: a wall is visible
in the transcript, and this is not.

### 3.3 A debt with no settling tool deadlocks the game — **high**

The first live run stopped in round 3. A move out of two goblins' reach opened
`pendingMove` with two Opportunity Attack offers, exactly as designed, and every
later command refused `move_pending`. The model diagnosed it correctly — it
queried `options` for both goblins and saw the Reaction was owed — and had no
tool that could answer. It reached for a plain `attack` and got `not_their_turn`.

The engine is not at fault; `pendingMove` is the durable-debt design the doctrine
asks for. But **a surface missing one settlement is worse than a surface missing
a whole mechanic**, because the game stops rather than an action being refused.
The engine has eight such debt kinds. A tool surface that exposes any command
which can *open* one must expose the command that *closes* it.

### 3.4 Two thirds of the round trips are not mechanical — **high**

Composition of the clean run: 9 `narrate`, 9 `end_turn`, 5 `attack`,
3 `cast_spell`, 1 `move`, 1 `options`. **Ten of twenty-eight calls — 36% —
resolved a rule.** One narration and one turn-ending per beat is 64% of the
traffic, and given §2's latency figures, round trips are the only cost that
matters.

### 3.5 Grounding gaps make the model guess — **medium**

Each of these cost a refusal or a round trip, and each is a field that was
missing from what the model was shown:

- It opened a goblin's turn with a **shortbow**, which the SRD 2024 Goblin
  Warrior genuinely carries and the fixture had omitted — and which the
  observation was not reporting either. The model knew the stat block better
  than the fixture did.
- With a prose-only turn prompt it cast at `"goblin"` on behalf of `"Kessa"`,
  display names rather than ids, because the first call of a beat was made
  blind. One `needs-context` fixed it; carrying state into the turn prompt
  removed it.
- **`armorClassOf` is not exported from `@ie/engine`.** The reader that folds a
  Shield of Faith or Mage Armor into an Armour Class lives in `standing.ts`,
  which `index.ts` does not re-export, so a grounding layer cannot show the
  number the engine itself attacks against.

### 3.6 A thin record front-loads its whole cost — **medium**

First beat: 3 calls established, **11** thin. All four `needs-context` requests
were for facts a scene-setup discipline could have established before anybody
acted. The protocol is cheap; paying for it on the first turn of a fight is not.

### 3.7 No command begins combat — **low, structural**

`combat-started` is assembled by hand. A tool for it would either take
initiative values the model invented or wrap an event the doctrine says the
layer above should never assemble. A model cannot start a fight.

---

## 4. What the evidence says about the audit's priorities

**None of the impedance found above is caused by, or would have been prevented
by, the audit's three top-ranked changes.** Definitions as validated data (#3),
outcome-scoped child effects (#4), and splitting `commands.ts` (#7) are all
sound engineering and all orthogonal to everything this experiment measured. A
model driving the engine never sees the shape of a `SpellDefinition` or the
length of a file.

That is a reordering argument, not an argument against them. The audit itself
already made it in §14.E: *"the next family is worth less than knowing the
boundary survives a model."* It does survive. What it does not yet have is a
guard on the half of the boundary the model owns.

| Audit item | Effect of this experiment |
|---|---|
| §12 #1 event-sourced state, engine-owned debts | **Confirmed.** Replay held under a live model, including transcript replay. |
| §12 #2 keep override commands off the AI surface | **Confirmed and sharpened.** Excluding every number-taking command cost nothing in playability — the model completed every turn without them. |
| §12 #3 / #4 / #7 (data, riders, file split) | **Unaffected.** No measured impedance touches them. |
| §12 #14 `cause` on events | **Strengthened.** §3.2 is unauditable precisely because no event records what the player was trying to do. |
| Addendum D3 "set a per-turn call budget and measure it" | **Done.** Median 3, max 4 on an established record. |
| Addendum D4 "define the fallback for unmodelled clauses" | **Now urgent, and the requirement has changed.** It must be a *refusal path the model is made to take*, because left implicit the model improvises instead of reporting the gap. |
| §9 "most tolerant of creative play while authoritative" | **Weaker.** Tolerance is real, but it is currently tolerance-by-substitution. |

---

## 5. Recommendations, in order — **not implemented in this pass**

1. **Make a declared fact accountable.** Facts that gate mechanics
   (`creature-type` above all) should carry their provenance and be
   challengeable, not silently permanent. Cheapest honest version: record *who*
   declared it and *what rule asked*, and let a later correction be an event
   rather than a refusal. The alternative — pre-declaring creature types at
   scene setup, from the stat block the engine already parsed — removes the
   lever entirely for monsters and should probably happen regardless.
2. **Give improvisation an explicit path, and make it the only one.** An
   `improvise` tool that requires the model to name the SRD rule it believes
   applies, records the player's stated intent beside the command, and refuses
   when no rule is named. This is the addendum's D4 fallback, re-specified: the
   finding is that a model will not volunteer that it is stuck, so the surface
   has to make substitution harder than admission.
3. **Make debt-settlement completeness structural.** A test over the M2 surface
   asserting that every `Pending*` in `GameState` reachable by an exposed
   command has an exposed settling command. `tools/llm-probe/src/probe.test.ts`
   has a first version of this to copy.
4. **Let narration ride along.** A `narration` field on the mutating commands,
   or on `end_turn`, removes ~⅓ of all round trips at no cost to authority,
   since narration changes no state.
5. **Close the grounding gaps.** Export a public effective-Armour-Class reader;
   put inventory, carried weapons and the turn budget in whatever M2's
   observation is; carry state into the turn prompt as well as into tool
   results.
6. **Add a command that begins combat.**
7. **Then** proceed with the audit's #3/#4/#7 on their own merits.

---

## 6. What this does not measure

One model, one fight, one system prompt, four rounds. Nothing here separates a
property of the boundary from a property of `gpt-5.5`; the driver sits behind a
one-method interface so the same scenario can be re-run against Claude Opus 5 —
which `CLAUDE.md` names as Maestro's model — and that has not been done. Nothing
about narrative quality, memory, retrieval or context assembly is touched. Three
improvised actions is a sample of three.
