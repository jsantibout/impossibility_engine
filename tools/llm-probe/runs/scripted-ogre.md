# LLM probe — scripted, ogre

Model: `scripted`. 130 events written to the authoritative log.

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
| 1 | 1 | thessaly | 3 | 3 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0.0 | yes |
| 2 | 1 | ilda | 3 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.0 | yes |
| 3 | 1 | brannis | 3 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.0 | yes |
| 4 | 1 | ogre | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.0 | yes |
| 5 | 2 | thessaly | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.0 | yes |
| 6 | 2 | ilda | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.0 | yes |
| 7 | 2 | brannis | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.0 | yes |
| 8 | 2 | ogre | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.0 | yes |
| 9 | 3 | thessaly | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.0 | yes |
| 10 | 3 | ilda | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.0 | yes |
| 11 | 3 | brannis | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.0 | yes |
| 12 | 3 | ogre | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.0 | yes |
| 13 | 4 | thessaly | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.0 | yes |
| 14 | 4 | ilda | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.0 | yes |
| 15 | 4 | brannis | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.0 | yes |
| 16 | 4 | ogre | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.0 | yes |

Total 34 calls — 34 mutating, 0 query. Median 2 per beat, mean 2.1, max 3.

## Per combat round

| Round | Actor turns | Calls | Calls/turn | Prompt tok | Out tok | Model s |
|---|---|---|---|---|---|---|
| 1 | 4 | 11 | 2.8 | 0 | 0 | 0.0 |
| 2 | 4 | 8 | 2.0 | 0 | 0 | 0.0 |
| 3 | 4 | 8 | 2.0 | 0 | 0 | 0.0 |
| 4 | 4 | 7 | 1.8 | 0 | 0 | 0.0 |

## Does the per-turn bill grow?

| Measure | Value |
|---|---|
| prompt tokens per beat | 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 |
| mean over the first half | 0 |
| mean over the second half | 0 |
| least-squares tokens added per beat | 0 |
| shape | **insufficient-data** |

## Cost in money

| Measure | Value |
|---|---|
| total | $0.0000 |
| per completed actor turn (16) | $0.0000 |
| per combat round (4) | $0.0000 |

At $1.25 / $0.13 / $10.00 per million input / cached input / output tokens. That rate is an input to this report, not a fact it discovered — rescale from the token counts above if it is wrong.

## Refusals

| Code | Count |
|---|---|
| `spell_not_available` | 1 |

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
| model turns | 34 |
| model wall-clock | 0.0 s |
| engine wall-clock | 19 ms |
| prompt tokens | 0 |
| of which cached | 0 |
| completion tokens | 0 |

## What was called, and what the players were told

**Beat 1 (thessaly)** — `cast_spell` → refusal: spell_not_available · `cast_spell` · `end_turn`

**Beat 2 (ilda)** — `move` · `attack` · `end_turn`

**Beat 3 (brannis)** — `move` · `attack` · `end_turn`

**Beat 4 (ogre)** — `attack` · `end_turn`

**Beat 5 (thessaly)** — `cast_spell` · `end_turn`

**Beat 6 (ilda)** — `attack` · `end_turn`

**Beat 7 (brannis)** — `attack` · `end_turn`

**Beat 8 (ogre)** — `attack` · `end_turn`

**Beat 9 (thessaly)** — `cast_spell` · `end_turn`

**Beat 10 (ilda)** — `attack` · `end_turn`

**Beat 11 (brannis)** — `attack` · `end_turn`

**Beat 12 (ogre)** — `attack` · `end_turn`

**Beat 13 (thessaly)** — `cast_spell` · `end_turn`

**Beat 14 (ilda)** — `attack` · `end_turn`

**Beat 15 (brannis)** — `end_turn`

**Beat 16 (ogre)** — `attack` · `end_turn`

## Harness interventions

0 turn(s) had to be ended by the harness because the model did not.
