# LLM probe — gpt-5.5, established fixture

Model: `gpt-5.5`. 67 events written to the authoritative log.

## Pre-registered criteria

| Criterion | Result | Detail |
|---|---|---|
| every beat completed | PASS | every turn the model was given ended through the engine |
| median calls per beat <= 6 | PASS | median 3, max 4 |
| no beat over 10 calls | PASS | max 4 |
| no needs-context loop | PASS | no fact was asked for three times |
| state folds deterministically | PASS | fold true, seed-independent true, json true |
| transcript replays byte-identically | PASS | replaying the recorded calls rebuilt the same log |

## Calls per player turn

| Beat | Turn of | Calls | Mutating | Queries | Narration | Refusals | needs-context | Invalid | Turn ended |
|---|---|---|---|---|---|---|---|---|---|
| 1 | kessa | 3 | 2 | 0 | 1 | 1 | 0 | 0 | yes |
| 2 | goblin-b | 3 | 2 | 0 | 1 | 0 | 0 | 0 | yes |
| 3 | goblin-a | 3 | 2 | 0 | 1 | 0 | 0 | 0 | yes |
| 4 | kessa | 3 | 2 | 0 | 1 | 0 | 0 | 0 | yes |
| 5 | goblin-b | 3 | 2 | 0 | 1 | 0 | 0 | 0 | yes |
| 6 | goblin-a | 3 | 2 | 0 | 1 | 0 | 0 | 0 | yes |
| 7 | kessa | 4 | 3 | 0 | 1 | 0 | 0 | 0 | yes |
| 8 | goblin-b | 3 | 1 | 1 | 1 | 0 | 0 | 0 | yes |
| 9 | goblin-a | 3 | 2 | 0 | 1 | 0 | 0 | 0 | yes |

Total 28 calls — 18 mutating, 10 query. Median 3 per beat, mean 3.1, max 4.

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
| model turns | 28 |
| model wall-clock | 66.3 s |
| engine wall-clock | 84 ms |
| prompt tokens | 361985 |
| of which cached | 320128 |
| completion tokens | 3286 |

## What the model told the players

> Kessa’s magic reaches for the goblin, but the spell cannot bind this creature; it remains free.

> The goblin snaps off an arrow at Kessa, and it strikes true.

> The other goblin looses an arrow as well, and Kessa is hit again.

> Kessa hurls a mote of flame at one of the nearest goblins. It connects, scorching the creature, but the goblin stays on its feet.

> The scorched goblin steadies its bow and fires back. The arrow hits Kessa hard, leaving her badly wounded.

> The second goblin keeps up the pressure with another arrow. It hits, and Kessa is barely still standing.

> Kessa keeps her ground by the bar and hurls another mote of flame at the wounded goblin. The fire strikes, and the goblin drops.

> The fallen goblin lies motionless and takes no action.

> The remaining goblin fires at Kessa. The arrow hits, and she collapses unconscious.

## Harness interventions

0 turn(s) had to be ended by the harness because the model did not.
