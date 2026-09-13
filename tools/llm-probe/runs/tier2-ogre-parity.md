# LLM probe — gpt-5.5, ogre

Model: `gpt-5.5`. 177 events written to the authoritative log.

## Pre-registered criteria

| Criterion | Result | Detail |
|---|---|---|
| every beat completed | PASS | every turn the model was given ended through the engine |
| median calls per beat <= 6 | PASS | median 4, max 5 |
| no beat over 10 calls | PASS | max 5 |
| no needs-context loop | PASS | no fact was asked for three times |
| state folds deterministically | PASS | fold true, seed-independent true, json true |
| transcript replays byte-identically | PASS | replaying the recorded calls rebuilt the same log |

## Calls per actor turn

| Beat | Round | Turn of | Calls | Mutating | Queries | Narration | Refusals | needs-context | Invalid | Prompt tok | Cached | Out tok | Model s | Turn ended |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 1 | thessaly | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 12266 | 4736 | 221 | 6.1 | yes |
| 2 | 1 | ilda | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 17467 | 13568 | 172 | 4.8 | yes |
| 3 | 1 | brannis | 3 | 3 | 0 | 0 | 0 | 0 | 0 | 35138 | 29568 | 386 | 8.2 | yes |
| 4 | 1 | ogre | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 29214 | 25856 | 144 | 3.9 | yes |
| 5 | 2 | thessaly | 4 | 3 | 1 | 0 | 1 | 0 | 0 | 71951 | 66048 | 1489 | 20.2 | yes |
| 6 | 2 | ilda | 5 | 5 | 0 | 0 | 0 | 1 | 0 | 114465 | 105600 | 967 | 17.1 | yes |
| 7 | 2 | brannis | 4 | 4 | 0 | 0 | 0 | 0 | 0 | 110321 | 102912 | 850 | 16.1 | yes |
| 8 | 2 | ogre | 4 | 3 | 1 | 0 | 0 | 0 | 0 | 127024 | 120320 | 944 | 15.7 | yes |
| 9 | 3 | thessaly | 4 | 4 | 0 | 0 | 1 | 0 | 0 | 143930 | 137728 | 528 | 10.9 | yes |
| 10 | 3 | ilda | 4 | 4 | 0 | 0 | 0 | 0 | 0 | 161199 | 155136 | 828 | 14.4 | yes |
| 11 | 3 | brannis | 3 | 3 | 0 | 0 | 0 | 0 | 0 | 132479 | 126848 | 1047 | 15.2 | yes |
| 12 | 3 | ogre | 4 | 3 | 1 | 0 | 0 | 0 | 0 | 191652 | 184832 | 657 | 14.5 | yes |
| 13 | 4 | thessaly | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 102600 | 98560 | 170 | 4.9 | yes |
| 14 | 4 | ilda | 4 | 4 | 0 | 0 | 0 | 1 | 0 | 219100 | 212480 | 312 | 14.4 | yes |
| 15 | 4 | brannis | 4 | 4 | 0 | 0 | 0 | 0 | 0 | 236633 | 229888 | 437 | 10.7 | yes |
| 16 | 4 | ogre | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 125185 | 122112 | 289 | 14.7 | yes |

Total 53 calls — 50 mutating, 3 query. Median 4 per beat, mean 3.3, max 5.

## Per combat round

| Round | Actor turns | Calls | Calls/turn | Prompt tok | Out tok | Model s |
|---|---|---|---|---|---|---|
| 1 | 4 | 9 | 2.3 | 94085 | 923 | 23.1 |
| 2 | 4 | 17 | 4.3 | 423761 | 4250 | 69.1 |
| 3 | 4 | 15 | 3.8 | 629260 | 3060 | 55.1 |
| 4 | 4 | 12 | 3.0 | 683518 | 1208 | 44.6 |

## Does the per-turn bill grow?

| Measure | Value |
|---|---|
| prompt tokens per beat | 12266, 17467, 35138, 29214, 71951, 114465, 110321, 127024, 143930, 161199, 132479, 191652, 102600, 219100, 236633, 125185 |
| mean over the first half | 64731 |
| mean over the second half | 164097 |
| least-squares tokens added per beat | 12242 |
| shape | **linear** |

## Cost in money

| Measure | Value |
|---|---|
| total | $0.4295 |
| per completed actor turn (16) | $0.0268 |
| per combat round (4) | $0.1074 |

At $1.25 / $0.13 / $10.00 per million input / cached input / output tokens. That rate is an input to this report, not a fact it discovered — rescale from the token counts above if it is wrong.

## Refusals

| Code | Count |
|---|---|
| `no_direction` | 1 |
| `outside_scene` | 1 |

## needs-context

| Kind | Count | Could have been pre-declared |
|---|---|---|
| `visibility` | 2 | yes |

2 of 2 requests were for facts a scene-setup discipline could have established before play.

## Malformed and repeated calls

| Measure | Count |
|---|---|
| malformed or unknown-tool calls | 0 |
| identical calls repeated | 3 |
| redundant state queries | 1 |

## Unmodelled mechanics

0 call(s) hit a mechanic the engine does not model; 0 beat(s) became a dead end.

## What the engine could not check

- Guiding Bolt: the next attack roll against the target before the end of your next turn has Advantage
- Grease: the area becoming Difficult Terrain for the duration
- nobody has said whether ogre can see brannis, and an Opportunity Attack needs that; the offer was made rather than withheld

## Cost

| Measure | Value |
|---|---|
| model turns | 53 |
| model wall-clock | 192.0 s |
| engine wall-clock | 50 ms |
| prompt tokens | 1830624 |
| of which cached | 1736192 |
| completion tokens | 9441 |

## What was called, and what the players were told

**Beat 1 (thessaly)** — `cast_spell` · `end_turn`

**Beat 2 (ilda)** — `cast_spell` · `end_turn`

**Beat 3 (brannis)** — `move` · `attack` · `end_turn`

**Beat 4 (ogre)** — `attack` · `end_turn`

**Beat 5 (thessaly)** — `look` · `cast_spell` → refusal: no_direction · `cast_spell` · `end_turn`

**Beat 6 (ilda)** — `move` · `cast_spell` → needs-context: needs_context · `declare_sight` · `cast_spell` · `end_turn`

**Beat 7 (brannis)** — `move` · `take_opportunity_attack` · `attack` · `end_turn`

**Beat 8 (ogre)** — `options` · `move` · `attack` · `end_turn`

**Beat 9 (thessaly)** — `move` → refusal: outside_scene · `move` · `cast_spell` · `end_turn`

**Beat 10 (ilda)** — `ability_check` · `move` · `improvised_damage` · `end_turn`

**Beat 11 (brannis)** — `ability_check` · `improvised_damage` · `end_turn`

**Beat 12 (ogre)** — `options` · `move` · `attack` · `end_turn`

**Beat 13 (thessaly)** — `cast_spell` · `end_turn`

**Beat 14 (ilda)** — `cast_spell` → needs-context: needs_context · `declare_sight` · `cast_spell` · `end_turn`

**Beat 15 (brannis)** — `move` · `settle_area_effects` · `attack` · `end_turn`

**Beat 16 (ogre)** — `attack` · `end_turn`

## Harness interventions

0 turn(s) had to be ended by the harness because the model did not.
