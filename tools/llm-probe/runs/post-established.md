# LLM probe — gpt-5.5, established fixture

Model: `gpt-5.5`. 67 events written to the authoritative log.

## Pre-registered criteria

| Criterion | Result | Detail |
|---|---|---|
| every beat completed | PASS | every turn the model was given ended through the engine |
| median calls per beat <= 6 | PASS | median 2, max 3 |
| no beat over 10 calls | PASS | max 3 |
| no needs-context loop | PASS | no fact was asked for three times |
| state folds deterministically | PASS | fold true, seed-independent true, json true |
| transcript replays byte-identically | PASS | replaying the recorded calls rebuilt the same log |

## Calls per player turn

| Beat | Turn of | Calls | Mutating | Queries | Narration | Refusals | needs-context | Invalid | Turn ended |
|---|---|---|---|---|---|---|---|---|---|
| 1 | kessa | 2 | 1 | 1 | 0 | 0 | 0 | 0 | yes |
| 2 | goblin-b | 2 | 2 | 0 | 0 | 0 | 0 | 0 | yes |
| 3 | goblin-a | 2 | 2 | 0 | 0 | 0 | 0 | 0 | yes |
| 4 | kessa | 2 | 2 | 0 | 0 | 0 | 0 | 0 | yes |
| 5 | goblin-b | 2 | 2 | 0 | 0 | 0 | 0 | 0 | yes |
| 6 | goblin-a | 2 | 2 | 0 | 0 | 0 | 0 | 0 | yes |
| 7 | kessa | 3 | 3 | 0 | 0 | 0 | 0 | 0 | yes |
| 8 | goblin-b | 1 | 1 | 0 | 0 | 0 | 0 | 0 | yes |
| 9 | goblin-a | 2 | 2 | 0 | 0 | 0 | 0 | 0 | yes |

Total 18 calls — 17 mutating, 1 query. Median 2 per beat, mean 2.0, max 3.

## Refusals

| Code | Count |
|---|---|

## needs-context

| Kind | Count | Could have been pre-declared |
|---|---|---|

0 of 0 requests were for facts a scene-setup discipline could have established before play.

## Malformed and repeated calls

| Measure | Count |
|---|---|
| malformed or unknown-tool calls | 0 |
| identical calls repeated | 0 |
| redundant state queries | 0 |

## Unmodelled mechanics

0 call(s) hit a mechanic the engine does not model; 0 beat(s) became a dead end.

## What the engine could not check

_Nothing: every rule that applied was applied._

## Cost

| Measure | Value |
|---|---|
| model turns | 18 |
| model wall-clock | 50.5 s |
| engine wall-clock | 18 ms |
| prompt tokens | 217974 |
| of which cached | 179200 |
| completion tokens | 2450 |

## What was called, and what the players were told

**Beat 1 (kessa)** — `eligible_targets` · `end_turn`

**Beat 2 (goblin-b)** — `attack` · `end_turn`

**Beat 3 (goblin-a)** — `attack` · `end_turn`

**Beat 4 (kessa)** — `cast_spell` · `end_turn`

**Beat 5 (goblin-b)** — `attack` · `end_turn`

**Beat 6 (goblin-a)** — `attack` · `end_turn`

**Beat 7 (kessa)** — `move` · `cast_spell` · `end_turn`

**Beat 8 (goblin-b)** — `end_turn`

**Beat 9 (goblin-a)** — `attack` · `end_turn`

## Harness interventions

0 turn(s) had to be ended by the harness because the model did not.
