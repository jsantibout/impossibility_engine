# LLM probe — gpt-5.5, established fixture

Model: `gpt-5.5`. 62 events written to the authoritative log.

## Pre-registered criteria

| Criterion | Result | Detail |
|---|---|---|
| every beat completed | PASS | every turn the model was given ended through the engine |
| median calls per beat <= 6 | PASS | median 3, max 5 |
| no beat over 10 calls | PASS | max 5 |
| no needs-context loop | PASS | no fact was asked for three times |
| state folds deterministically | PASS | fold true, seed-independent true, json true |
| transcript replays byte-identically | PASS | replaying the recorded calls rebuilt the same log |

## Calls per player turn

| Beat | Turn of | Calls | Mutating | Queries | Narration | Refusals | needs-context | Invalid | Turn ended |
|---|---|---|---|---|---|---|---|---|---|
| 1 | kessa | 5 | 4 | 0 | 1 | 1 | 0 | 0 | yes |
| 2 | goblin-b | 3 | 2 | 0 | 1 | 0 | 0 | 0 | yes |
| 3 | goblin-a | 3 | 2 | 0 | 1 | 0 | 0 | 0 | yes |
| 4 | kessa | 5 | 4 | 0 | 1 | 0 | 0 | 0 | yes |
| 5 | goblin-b | 3 | 2 | 0 | 1 | 0 | 0 | 0 | yes |
| 6 | goblin-a | 3 | 2 | 0 | 1 | 0 | 0 | 0 | yes |

Total 22 calls — 16 mutating, 6 query. Median 3 per beat, mean 3.7, max 5.

## Refusals

| Code | Count |
|---|---|
| `out_of_reach` | 1 |

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

- nobody has said whether goblin-b can see kessa, and an Opportunity Attack needs that; the offer was made rather than withheld

## Cost

| Measure | Value |
|---|---|
| model turns | 22 |
| model wall-clock | 60.8 s |
| engine wall-clock | 64 ms |
| prompt tokens | 222841 |
| of which cached | 186880 |
| completion tokens | 3525 |

## What the model told the players

> Kessa rushes the nearest goblin and slams into it with a shoulder, but the impact doesn’t drive it into the hearth.

> The goblin whips its scimitar at Kessa, but she avoids the blade.

> The other goblin looses an arrow at Kessa, and it strikes home.

> Kessa darts toward the other goblin. As she breaks away, the first goblin cuts her with its scimitar. She reaches the bow-wielding goblin and sweeps the stool into its legs, but it stays on its feet.

> The goblin draws and fires, and its arrow punches into Kessa.

> The goblin slashes wildly at close range, but its scimitar cuts only air.

## Harness interventions

0 turn(s) had to be ended by the harness because the model did not.
