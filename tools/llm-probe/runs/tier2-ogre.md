# LLM probe — gpt-5.5, ogre

Model: `gpt-5.5`. 151 events written to the authoritative log.

## Pre-registered criteria

| Criterion | Result | Detail |
|---|---|---|
| every beat completed | FAIL | unfinished: beat 5 (thessaly) |
| median calls per beat <= 6 | PASS | median 3, max 8 |
| no beat over 10 calls | PASS | max 8 |
| no needs-context loop | PASS | no fact was asked for three times |
| state folds deterministically | PASS | fold true, seed-independent true, json true |
| transcript replays byte-identically | PASS | replaying the recorded calls rebuilt the same log |

## Calls per actor turn

| Beat | Round | Turn of | Calls | Mutating | Queries | Narration | Refusals | needs-context | Invalid | Prompt tok | Cached | Out tok | Model s | Turn ended |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 1 | thessaly | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 10546 | 9472 | 191 | 4.2 | yes |
| 2 | 1 | ilda | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 15752 | 11520 | 171 | 4.0 | yes |
| 3 | 1 | brannis | 3 | 3 | 0 | 0 | 0 | 0 | 0 | 32582 | 27520 | 551 | 9.1 | yes |
| 4 | 1 | ogre | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 27528 | 23808 | 153 | 3.9 | yes |
| 5 | 2 | thessaly | 8 | 7 | 1 | 0 | 6 | 0 | 1 | 173494 | 160384 | 4289 | 57.5 | **no** |
| 6 | 2 | ilda | 5 | 5 | 0 | 0 | 0 | 1 | 0 | 127603 | 120960 | 1125 | 20.0 | yes |
| 7 | 2 | brannis | 6 | 6 | 0 | 0 | 1 | 0 | 0 | 186449 | 176896 | 1158 | 21.5 | yes |
| 8 | 2 | ogre | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 70565 | 66816 | 149 | 4.0 | yes |
| 9 | 3 | thessaly | 4 | 4 | 0 | 0 | 1 | 0 | 0 | 154648 | 147968 | 598 | 10.6 | yes |
| 10 | 3 | ilda | 5 | 5 | 0 | 0 | 0 | 0 | 0 | 216970 | 209024 | 1545 | 22.7 | yes |
| 11 | 3 | brannis | 3 | 3 | 0 | 0 | 0 | 0 | 0 | 143046 | 138112 | 1229 | 18.9 | yes |
| 12 | 3 | ogre | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 101237 | 97536 | 217 | 4.8 | yes |
| 13 | 4 | thessaly | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 106326 | 102656 | 144 | 4.1 | yes |
| 14 | 4 | ilda | 4 | 4 | 0 | 0 | 0 | 1 | 0 | 226485 | 220672 | 389 | 8.5 | yes |
| 15 | 4 | brannis | 3 | 3 | 0 | 0 | 0 | 0 | 0 | 181520 | 176000 | 485 | 14.5 | yes |
| 16 | 4 | ogre | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 126856 | 123136 | 212 | 15.4 | yes |

Total 55 calls — 54 mutating, 1 query. Median 3 per beat, mean 3.4, max 8.

## Per combat round

| Round | Actor turns | Calls | Calls/turn | Prompt tok | Out tok | Model s |
|---|---|---|---|---|---|---|
| 1 | 4 | 9 | 2.3 | 86408 | 1066 | 21.3 |
| 2 | 4 | 21 | 5.3 | 558111 | 6721 | 103.0 |
| 3 | 4 | 14 | 3.5 | 615901 | 3589 | 57.1 |
| 4 | 4 | 11 | 2.8 | 641187 | 1230 | 42.5 |

## Does the per-turn bill grow?

| Measure | Value |
|---|---|
| prompt tokens per beat | 10546, 15752, 32582, 27528, 173494, 127603, 186449, 70565, 154648, 216970, 143046, 101237, 106326, 226485, 181520, 126856 |
| mean over the first half | 80565 |
| mean over the second half | 157136 |
| least-squares tokens added per beat | 9542 |
| shape | **linear** |

## Cost in money

| Measure | Value |
|---|---|
| total | $0.4640 |
| per completed actor turn (15) | $0.0309 |
| per combat round (4) | $0.1160 |

At $1.25 / $0.13 / $10.00 per million input / cached input / output tokens. That rate is an input to this report, not a fact it discovered — rescale from the token counts above if it is wrong.

## Refusals

| Code | Count |
|---|---|
| `no_direction` | 4 |
| `area_picks_its_own_targets` | 1 |
| `no_origin` | 1 |
| `out_of_reach` | 1 |
| `outside_scene` | 1 |

## needs-context

| Kind | Count | Could have been pre-declared |
|---|---|---|
| `visibility` | 2 | yes |

2 of 2 requests were for facts a scene-setup discipline could have established before play.

## Malformed and repeated calls

| Measure | Count |
|---|---|
| malformed or unknown-tool calls | 1 |
| identical calls repeated | 0 |
| redundant state queries | 1 |

| Reason | Count |
|---|---|
| `malformed_input` | 1 |

## Unmodelled mechanics

0 call(s) hit a mechanic the engine does not model; 0 beat(s) became a dead end.

## What the engine could not check

- Guiding Bolt: the next attack roll against the target before the end of your next turn has Advantage
- nobody has said whether ogre can see brannis, and an Opportunity Attack needs that; the offer was made rather than withheld

## Cost

| Measure | Value |
|---|---|
| model turns | 56 |
| model wall-clock | 223.9 s |
| engine wall-clock | 38 ms |
| prompt tokens | 1901607 |
| of which cached | 1812480 |
| completion tokens | 12606 |

## What was called, and what the players were told

**Beat 1 (thessaly)** — `cast_spell` · `end_turn`

**Beat 2 (ilda)** — `cast_spell` · `end_turn`

**Beat 3 (brannis)** — `move` · `attack` · `end_turn`

**Beat 4 (ogre)** — `attack` · `end_turn`

**Beat 5 (thessaly)** — `look` · `cast_spell` → refusal: no_origin · `cast_spell` → invalid: malformed_input · `cast_spell` → refusal: area_picks_its_own_targets · `cast_spell` → refusal: no_direction · `cast_spell` → refusal: no_direction · `cast_spell` → refusal: no_direction · `cast_spell` → refusal: no_direction

**Beat 6 (ilda)** — `move` · `cast_spell` → needs-context: needs_context · `declare_sight` · `cast_spell` · `end_turn`

**Beat 7 (brannis)** — `move` · `take_opportunity_attack` · `attack` → refusal: out_of_reach · `move` · `attack` · `end_turn`

**Beat 8 (ogre)** — `attack` · `end_turn`

**Beat 9 (thessaly)** — `move` → refusal: outside_scene · `move` · `cast_spell` · `end_turn`

**Beat 10 (ilda)** — `move` · `ability_check` · `move` · `improvised_damage` · `end_turn`

**Beat 11 (brannis)** — `ability_check` · `improvised_damage` · `end_turn`

**Beat 12 (ogre)** — `attack` · `end_turn`

**Beat 13 (thessaly)** — `cast_spell` · `end_turn`

**Beat 14 (ilda)** — `cast_spell` → needs-context: needs_context · `declare_sight` · `cast_spell` · `end_turn`

**Beat 15 (brannis)** — `attack` · `ability_check` · `end_turn`

**Beat 16 (ogre)** — `attack` · `end_turn`

## Harness interventions

1 turn(s) had to be ended by the harness because the model did not.
