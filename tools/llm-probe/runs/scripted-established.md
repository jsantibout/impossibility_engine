# LLM probe — scripted, established fixture

Model: `scripted`. 73 events written to the authoritative log.

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
| 1 | kessa | 3 | 3 | 0 | 0 | 1 | 0 | 0 | yes |
| 2 | goblin-b | 3 | 3 | 0 | 0 | 0 | 0 | 0 | yes |
| 3 | goblin-a | 3 | 3 | 0 | 0 | 0 | 0 | 0 | yes |
| 4 | kessa | 2 | 2 | 0 | 0 | 0 | 0 | 0 | yes |
| 5 | goblin-b | 2 | 2 | 0 | 0 | 0 | 0 | 0 | yes |
| 6 | goblin-a | 1 | 1 | 0 | 0 | 0 | 0 | 0 | yes |
| 7 | kessa | 2 | 2 | 0 | 0 | 0 | 0 | 0 | yes |
| 8 | goblin-b | 2 | 2 | 0 | 0 | 0 | 0 | 0 | yes |
| 9 | goblin-a | 1 | 1 | 0 | 0 | 0 | 0 | 0 | yes |
| 10 | kessa | 2 | 2 | 0 | 0 | 0 | 0 | 0 | yes |

Total 21 calls — 21 mutating, 0 query. Median 2 per beat, mean 2.1, max 3.

## Refusals

| Code | Count |
|---|---|
| `wrong_creature_type` | 1 |

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
| model turns | 21 |
| model wall-clock | 0.0 s |
| engine wall-clock | 13 ms |
| prompt tokens | 0 |
| of which cached | 0 |
| completion tokens | 0 |

## What was called, and what the players were told

**Beat 1 (kessa)** — `cast_spell` → refusal: wrong_creature_type · `cast_spell` · `end_turn`

**Beat 2 (goblin-b)** — `move` · `attack` · `end_turn`

**Beat 3 (goblin-a)** — `move` · `attack` · `end_turn`

**Beat 4 (kessa)** — `cast_spell` · `end_turn`

**Beat 5 (goblin-b)** — `attack` · `end_turn`

**Beat 6 (goblin-a)** — `end_turn`

**Beat 7 (kessa)** — `cast_spell` · `end_turn`

**Beat 8 (goblin-b)** — `attack` · `end_turn`

**Beat 9 (goblin-a)** — `end_turn`

**Beat 10 (kessa)** — `cast_spell` · `end_turn`

## Harness interventions

0 turn(s) had to be ended by the harness because the model did not.
