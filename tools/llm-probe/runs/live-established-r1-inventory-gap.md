# LLM probe — gpt-5.5, established fixture

Model: `gpt-5.5`. 71 events written to the authoritative log.

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
| 1 | kessa | 3 | 2 | 0 | 1 | 1 | 0 | 0 | yes |
| 2 | goblin-b | 5 | 4 | 0 | 1 | 1 | 0 | 0 | yes |
| 3 | goblin-a | 4 | 3 | 0 | 1 | 0 | 0 | 0 | yes |
| 4 | kessa | 3 | 2 | 0 | 1 | 0 | 0 | 0 | yes |
| 5 | goblin-b | 3 | 2 | 0 | 1 | 0 | 0 | 0 | yes |
| 6 | goblin-a | 3 | 2 | 0 | 1 | 0 | 0 | 0 | yes |
| 7 | kessa | 4 | 3 | 0 | 1 | 0 | 0 | 0 | yes |
| 8 | goblin-b | 3 | 1 | 1 | 1 | 0 | 0 | 0 | yes |
| 9 | goblin-a | 3 | 2 | 0 | 1 | 0 | 0 | 0 | yes |

Total 31 calls — 21 mutating, 10 query. Median 3 per beat, mean 3.4, max 5.

## Refusals

| Code | Count |
|---|---|
| `not_owned` | 1 |
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
| model turns | 31 |
| model wall-clock | 71.8 s |
| engine wall-clock | 95 ms |
| prompt tokens | 379141 |
| of which cached | 333952 |
| completion tokens | 3242 |

## What the model told the players

> Kessa reaches out with paralyzing magic, but the spell finds no valid hold on the goblin’s fey nature.

> The goblin rushes in and slashes Kessa with its scimitar.

> The second goblin darts in from the other side and cuts Kessa with its scimitar.

> Kessa hurls a mote of flame at the goblin beside her, and it strikes home.

> The wounded goblin presses the attack and lands another scimitar slash on Kessa.

> The other goblin slashes Kessa as well, leaving her barely standing.

> Kessa backs toward the bar, then flings another mote of flame into the wounded goblin. It drops.

> The fallen goblin does not rise or act.

> The remaining goblin cuts Kessa down. She collapses unconscious.

## Harness interventions

0 turn(s) had to be ended by the harness because the model did not.
