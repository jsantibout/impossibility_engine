# LLM probe — gpt-5.5, tavern-established-standard

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

## Calls per actor turn

| Beat | Round | Turn of | Calls | Mutating | Queries | Narration | Refusals | needs-context | Invalid | Prompt tok | Cached | Out tok | Model s | Turn ended |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 1 | kessa | 2 | 1 | 1 | 0 | 0 | 0 | 0 | 11478 | 9472 | 664 | 10.6 | yes |
| 2 | 1 | goblin-b | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 15068 | 12544 | 242 | 4.6 | yes |
| 3 | 1 | goblin-a | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 18648 | 16640 | 231 | 4.4 | yes |
| 4 | 2 | kessa | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 22347 | 18688 | 188 | 4.0 | yes |
| 5 | 2 | goblin-b | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 26017 | 22784 | 269 | 5.7 | yes |
| 6 | 2 | goblin-a | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 29601 | 26880 | 165 | 5.0 | yes |
| 7 | 3 | kessa | 3 | 3 | 0 | 0 | 0 | 0 | 0 | 50844 | 46976 | 507 | 9.3 | yes |
| 8 | 3 | goblin-b | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 18800 | 17024 | 84 | 2.1 | yes |
| 9 | 3 | goblin-a | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 40553 | 37120 | 182 | 4.0 | yes |

Total 18 calls — 17 mutating, 1 query. Median 2 per beat, mean 2.0, max 3.

## Per combat round

| Round | Actor turns | Calls | Calls/turn | Prompt tok | Out tok | Model s |
|---|---|---|---|---|---|---|
| 1 | 3 | 6 | 2.0 | 45194 | 1137 | 19.6 |
| 2 | 3 | 6 | 2.0 | 77965 | 622 | 14.6 |
| 3 | 3 | 6 | 2.0 | 110197 | 773 | 15.3 |

## Does the per-turn bill grow?

| Measure | Value |
|---|---|
| prompt tokens per beat | 11478, 15068, 18648, 22347, 26017, 29601, 50844, 18800, 40553 |
| mean over the first half | 16885 |
| mean over the second half | 33163 |
| least-squares tokens added per beat | 3319 |
| shape | **linear** |

## Cost in money

| Measure | Value |
|---|---|
| total | $0.0829 |
| per completed actor turn (9) | $0.0092 |
| per combat round (3) | $0.0276 |

At $1.25 / $0.13 / $10.00 per million input / cached input / output tokens. That rate is an input to this report, not a fact it discovered — rescale from the token counts above if it is wrong.

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
| model wall-clock | 49.6 s |
| engine wall-clock | 11 ms |
| prompt tokens | 233356 |
| of which cached | 208128 |
| completion tokens | 2532 |

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
