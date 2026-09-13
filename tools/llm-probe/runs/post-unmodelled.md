# LLM probe — gpt-5.5, established fixture

Model: `gpt-5.5`. 73 events written to the authoritative log.

## Pre-registered criteria

| Criterion | Result | Detail |
|---|---|---|
| every beat completed | PASS | every turn the model was given ended through the engine |
| median calls per beat <= 6 | PASS | median 3.5, max 6 |
| no beat over 10 calls | PASS | max 6 |
| no needs-context loop | PASS | no fact was asked for three times |
| state folds deterministically | PASS | fold true, seed-independent true, json true |
| transcript replays byte-identically | PASS | replaying the recorded calls rebuilt the same log |

## Calls per player turn

| Beat | Turn of | Calls | Mutating | Queries | Narration | Refusals | needs-context | Invalid | Turn ended |
|---|---|---|---|---|---|---|---|---|---|
| 1 | kessa | 6 | 6 | 0 | 0 | 0 | 0 | 0 | yes |
| 2 | goblin-b | 3 | 3 | 0 | 0 | 0 | 0 | 0 | yes |
| 3 | goblin-a | 4 | 4 | 0 | 0 | 1 | 0 | 0 | yes |
| 4 | kessa | 6 | 6 | 0 | 0 | 0 | 0 | 0 | yes |
| 5 | goblin-b | 3 | 2 | 1 | 0 | 0 | 0 | 0 | yes |
| 6 | goblin-a | 2 | 2 | 0 | 0 | 0 | 0 | 0 | yes |

Total 24 calls — 23 mutating, 1 query. Median 3.5 per beat, mean 4.0, max 6.

## Refusals

| Code | Count |
|---|---|
| `no_action` | 1 |

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

- nobody has said whether goblin-a can see kessa, and an Opportunity Attack needs that; the offer was made rather than withheld

## Cost

| Measure | Value |
|---|---|
| model turns | 23 |
| model wall-clock | 85.3 s |
| engine wall-clock | 20 ms |
| prompt tokens | 311977 |
| of which cached | 276864 |
| completion tokens | 5609 |

## What was called, and what the players were told

**Beat 1 (kessa)** — `add_landmark` · `move` · `ability_check` · `move` · `improvised_damage` · `end_turn`

**Beat 2 (goblin-b)** — `move` · `attack` · `end_turn`

**Beat 3 (goblin-a)** — `move` · `attack` · `take_action` → refusal: no_action · `end_turn`

**Beat 4 (kessa)** — `add_landmark` · `move` · `take_opportunity_attack` · `ability_check` · `apply_ruled_condition` · `end_turn`

**Beat 5 (goblin-b)** — `options` · `attack` · `end_turn`

**Beat 6 (goblin-a)** — `attack` · `end_turn`

## Harness interventions

0 turn(s) had to be ended by the harness because the model did not.
