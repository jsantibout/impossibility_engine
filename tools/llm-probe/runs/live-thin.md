# LLM probe — gpt-5.5, thin fixture

Model: `gpt-5.5`. 103 events written to the authoritative log.

## Pre-registered criteria

| Criterion | Result | Detail |
|---|---|---|
| every beat completed | PASS | every turn the model was given ended through the engine |
| median calls per beat <= 6 | PASS | median 4, max 11 |
| no beat over 10 calls | FAIL | max 11 |
| no needs-context loop | PASS | no fact was asked for three times |
| state folds deterministically | PASS | fold true, seed-independent true, json true |
| transcript replays byte-identically | PASS | replaying the recorded calls rebuilt the same log |

## Calls per player turn

| Beat | Turn of | Calls | Mutating | Queries | Narration | Refusals | needs-context | Invalid | Turn ended |
|---|---|---|---|---|---|---|---|---|---|
| 1 | kessa | 11 | 10 | 0 | 1 | 0 | 2 | 0 | yes |
| 2 | goblin-b | 5 | 4 | 0 | 1 | 1 | 0 | 0 | yes |
| 3 | goblin-a | 5 | 4 | 0 | 1 | 0 | 0 | 0 | yes |
| 4 | kessa | 3 | 2 | 0 | 1 | 0 | 0 | 0 | yes |
| 5 | goblin-b | 3 | 2 | 0 | 1 | 0 | 0 | 0 | yes |
| 6 | goblin-a | 3 | 2 | 0 | 1 | 0 | 0 | 0 | yes |
| 7 | kessa | 7 | 6 | 0 | 1 | 0 | 0 | 0 | yes |
| 8 | goblin-b | 4 | 3 | 0 | 1 | 0 | 0 | 0 | yes |
| 9 | goblin-a | 4 | 3 | 0 | 1 | 0 | 0 | 0 | yes |
| 10 | kessa | 5 | 4 | 0 | 1 | 1 | 0 | 0 | yes |
| 11 | goblin-b | 3 | 2 | 0 | 1 | 0 | 0 | 0 | yes |
| 12 | goblin-a | 3 | 2 | 0 | 1 | 0 | 0 | 0 | yes |

Total 56 calls — 44 mutating, 12 query. Median 4 per beat, mean 4.7, max 11.

## Refusals

| Code | Count |
|---|---|
| `not_enough_movement` | 1 |
| `not_owned` | 1 |

## needs-context

| Kind | Count | Could have been pre-declared |
|---|---|---|
| `creature-type` | 1 | yes |
| `position` | 1 | yes |
| `scene` | 1 | yes |
| `visibility` | 1 | yes |

4 of 4 requests were for facts a scene-setup discipline could have established before play.

## Malformed and repeated calls

| Measure | Count |
|---|---|
| malformed or unknown-tool calls | 0 |
| identical calls repeated | 2 |
| redundant state queries | 0 |

## Unmodelled mechanics

0 call(s) hit a mechanic the engine does not model; 0 beat(s) became a dead end.

## What the engine could not check

- nobody has said whether goblin-a can see kessa, and an Opportunity Attack needs that; the offer was made rather than withheld
- nobody has said whether goblin-b can see kessa, and an Opportunity Attack needs that; the offer was made rather than withheld

## Cost

| Measure | Value |
|---|---|
| model turns | 52 |
| model wall-clock | 153.5 s |
| engine wall-clock | 169 ms |
| prompt tokens | 1192877 |
| of which cached | 1104128 |
| completion tokens | 8542 |

## What the model told the players

> Kessa raises her hand and the binding magic reaches for the goblin, but it shakes off the spell and remains free to move.

> The goblin rushes up to Kessa and lashes out with a desperate blow, but it misses.

> The second goblin closes in beside its ally and swings at Kessa, but the blow fails to connect.

> Both goblins are equally close, so Kessa hurls the mote of flame at the one she tried to bind. The fire streaks past without striking it.

> The goblin jabs at Kessa and catches her, but the blow fails to do any harm.

> The other goblin presses the attack, but Kessa avoids the strike.

> Kessa retreats toward the bar. Both goblins slash at her as she pulls away, but neither blow harms her. She then hurls another mote of flame at the nearer goblin, and this one scorches it.

> The scorched goblin sprints back into Kessa’s face and lands another glancing strike, but it still fails to hurt her.

> The second goblin rushes back in as well, but its attack goes wide.

> Kessa slams her shoulder into the nearer goblin and wins the shove attempt toward the hearth, but the goblin’s position does not change.

> The scorched goblin strikes again, but Kessa fends it off.

> The other goblin lunges at Kessa, but she keeps clear of the attack.

## Harness interventions

0 turn(s) had to be ended by the harness because the model did not.
