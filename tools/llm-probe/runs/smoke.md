# LLM probe — gpt-5.5, established fixture

Model: `gpt-5.5`. 38 events written to the authoritative log.

## Pre-registered criteria

| Criterion | Result | Detail |
|---|---|---|
| every beat completed | PASS | every turn the model was given ended through the engine |
| median calls per beat <= 6 | PASS | median 4, max 4 |
| no beat over 10 calls | PASS | max 4 |
| no needs-context loop | PASS | no fact was asked for three times |
| state folds deterministically | PASS | fold true, seed-independent true, json true |
| transcript replays byte-identically | PASS | replaying the recorded calls rebuilt the same log |

## Calls per player turn

| Beat | Turn of | Calls | Mutating | Queries | Refusals | needs-context | Invalid | Turn ended |
|---|---|---|---|---|---|---|---|---|
| 1 | kessa | 4 | 3 | 1 | 1 | 1 | 0 | yes |
| 2 | goblin-b | 4 | 3 | 1 | 0 | 0 | 0 | yes |
| 3 | goblin-a | 4 | 3 | 1 | 0 | 0 | 0 | yes |

Total 12 calls — 9 mutating, 3 query. Median 4 per beat, mean 4.0, max 4.

## Refusals

| Code | Count |
|---|---|
| `wrong_creature_type` | 1 |

## needs-context

| Kind | Count | Could have been pre-declared |
|---|---|---|
| `creature` | 1 | no |

0 of 1 requests were for facts a scene-setup discipline could have established before play.

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
| model turns | 12 |
| model wall-clock | 29.3 s |
| engine wall-clock | 46 ms |
| prompt tokens | 58535 |
| of which cached | 43904 |
| completion tokens | 1484 |

## What the model told the players

> Kessa raises her hand and starts the binding magic, but the spell finds no valid humanoid target in the goblin before her; the magic fails to take hold.

> The goblin rushes in and slashes Kessa with its scimitar, drawing blood.

> The second goblin closes from the other side and cuts into Kessa with its scimitar.

## Harness interventions

0 turn(s) had to be ended by the harness because the model did not.
