# Tier 2: three level 2 characters and one Ogre

**Date:** 2026-09-13
**Model:** `gpt-5.5`, same configuration as the post-hardening Tier 1 runs
**Artifacts:** `tools/llm-probe/runs/tier2-ogre.{md,json}`
**Engine changes made for this tier:** none

Tier 1 asked whether a model could operate the Impossibility Engine's boundary
at all. Tier 2 asks a different question:

> Can an LLM operate a realistic multi-actor D&D combat involving mechanically
> distinct player characters without exploding tool calls, context size, or
> adjudication errors?

The short answer is **yes, with one surface gap that cost exactly one turn**.

---

## 1. What was run

A mill floor 50 by 40 feet, four named landmarks, four actors:

| | | |
|---|---|---|
| Brannis | Fighter 2 | chain mail, greatsword, 8 javelins. AC 16, 22 hp |
| Sister Ilda | Cleric 2 | chain shirt and shield. AC 16, 17 hp. Guiding Bolt, Cure Wounds, Healing Word, Bless, Shield of Faith |
| Thessaly | Wizard 2 | AC 12, 14 hp. Fire Bolt, Burning Hands, Thunderwave, Grease, Shield |
| The Ogre | SRD stat block | Large Giant, AC 11, 68 hp, Speed 40, Greatclub and Javelins |

All three characters are Human Sages because the engine currently defines one
species and one background. That is content coverage rather than a design
choice, and it had one useful side effect: the Sage's Magic Initiate gives
every character a *second* spellcasting route with its own ability and its own
free daily casting, which is a rule (`routeFor`) no Tier 1 run ever reached.

Each character got its own scripted four-line intent script. Two of the twelve
lines cannot be served by picking a command off the surface — Brannis swinging
the hoist rope, Ilda driving the Ogre into the millstone — and they sit on
different characters in different rounds, so the ruling collaboration is
exercised twice without the benchmark becoming a test about improvisation.

The fight went the distance: after four rounds the Ogre was on **3 of 68**,
Ilda on 8 of 17, Brannis on 13 of 22, Thessaly untouched. Nobody dropped, so
unconsciousness, death saves and healing off the floor were **not reached** —
an honest "the fight did not go there", not a capability claim either way.

---

## 2. Headline measurements

| | Tier 1 (post, established) | Tier 2 (ogre) |
|---|---|---|
| Actors | 3 | **4** |
| Actor turns completed | 9 | **15 of 16** |
| Total calls | 18 | 55 |
| Calls per actor turn — median / mean / max | 2 / 2.0 / 3 | **3 / 3.4 / 8** |
| Calls per combat round | — | 9, 21, 14, 11 |
| Refusals | 0 | 8 |
| `needs-context` | 0 | 2 (both `visibility`) |
| Malformed calls | 0 | 1 |
| Dead ends (unmodelled mechanic, never recovered) | 0 | **0** |
| Harness interventions | 0 | 1 |
| Prompt tokens | 217,974 | 1,901,607 |
| — of which cached | 179,200 (82%) | **1,812,480 (95.3%)** |
| Completion tokens | 2,450 | 12,606 |
| Model wall-clock | 50.5 s | 223.9 s |
| **Engine wall-clock** | — | **38 ms** |
| Deterministic fold / seed-independent / JSON / transcript replay | PASS ×4 | **PASS ×4** |

Five of the six pre-registered criteria passed. The one that failed —
"every beat completed" — failed on exactly one beat, and §4 is about that beat.

---

## 3. Does the per-turn bill stay stable as initiative grows?

This was the question the tier existed to answer, and the honest answer needs
two numbers rather than one.

**Raw prompt tokens per actor turn grew about fivefold** — 24,200 in Tier 1
against 118,900 in Tier 2. Read alone, that is alarming.

**Billable prompt tokens per actor turn grew about 1.3×** — 4,300 against
5,570 — because the cache rate *rose* with the fight, from 82% to 95.3%. The
frozen system prefix plus a conversation that only ever appends is exactly the
shape a prompt cache is good at, and adding actors lengthens the cached prefix
rather than the fresh suffix.

Per round, the deceleration is visible directly:

| Round | Prompt tokens | Per actor turn | Change |
|---|---|---|---|
| 1 | 86,408 | 21,602 | — |
| 2 | 558,111 | 139,528 | ×6.5 |
| 3 | 615,901 | 153,975 | +10.4% |
| 4 | 641,187 | 160,297 | **+4.1%** |

The automatic classifier reports `linear` with a slope of 9,542 tokens per
beat, and that classification is **dominated by the round-1 ramp**: the first
round is cheap because the conversation is short, and everything after it is
close to flat. Rounds 3 → 4 grew 4%. That is sublinear per turn, and it is the
answer to the question:

> **Per-turn model cost does not run away as initiative and state complexity
> grow.** The growth is in cached input, which is the cheap kind, and it is
> decelerating by round 3.

**Total cost: $0.4640** — $0.0309 per completed actor turn, $0.1160 per combat
round, at an assumed $1.25 / $0.125 / $10.00 per million input / cached input /
output tokens. That rate is an input to the report, not something it measured;
the token counts are in the artifact and rescale cleanly. Tier 1's established
run costs $0.0954 at the same rate, or $0.0106 per actor turn — so cost per
turn rose **2.9×** going from three actors to four, and roughly a third of the
increase is the single failed beat in §4.

Engine execution time across the whole benchmark was **38 milliseconds**. The
engine is not the cost.

---

## 4. The one failure: a directional area has no way to be pointed

**Beat 5, Thessaly, round 2.** The player said *"I slick the floor out from
under it — grease, right where it is standing."* Grease is a 10-foot Cube, and
a Cube is directional.

Seven calls, in this order:

| # | Call | Answer |
|---|---|---|
| 1 | `cast_spell grease`, no targets, no point | `no_origin` — "needs a point to centre its area on" |
| 2 | `at: { z: 0 }` | `malformed_input` |
| 3 | `at: { x: 25, y: 20, z: 0 }`, `targets: ["ogre"]` | `area_picks_its_own_targets` |
| 4 | `at: { x: 25, y: 20, z: 0 }`, no targets | **`no_direction`** — "forms a cube and needs a direction to point it in" |
| 5 | the same, `bearing` inside `at` | `no_direction` |
| 6 | the same again | `no_direction` |
| 7 | the same, `direction: { bearing: 0 }` alongside | `no_direction` |

The turn was lost. The harness ended it and counted the intervention.

**Every one of those refusals is correct**, and the last four even name the
missing fact in plain English. The model read the message, understood it,
and tried four different places to put a bearing — because **the `cast_spell`
tool schema has no field for one**.

### Classification: missing surface exposure

Not an engine gap and not a model error.

- `resolveCast` already takes `request.towards`. `commands.ts:7958` refuses
  precisely when a `DIRECTIONAL_AREAS` spell arrives without it.
- `tools/llm-probe/src/surface.ts` exposes `caster`, `spell_id`, `targets`,
  `slot_level`, `at` and `command_id`. There is no `towards`.

This is the **same shape as the Tier 1 shove failure**, where the model made
the right ruling and `resolveMove`'s `forced: true` had existed since
Thunderwave but was never on the surface. Twice now, the boundary's worst
failure mode has been an engine capability that the tool layer forgot to
publish — which is the failure mode the North Star ranks worst, because it
looks from the outside exactly like a rule saying no.

A second, smaller instance sits inside the same beat: `at`'s schema declares
`x`, `y` and `z` as properties and marks **none of them required**, which is
what let call #2 be `{ z: 0 }`. One malformed call, cheap, same root.

**Not fixed in this pass**, per the brief. The trace is preserved in
`runs/tier2-ogre.json` (transcript entries 10–16).

---

## 5. The improvised-attack-roll gap did not surface

Tier 1's report flagged that the surface has `improvised_damage` (damage) and
`ability_check` (a check) with nothing between them for a genuinely improvised
**attack roll**, and asked that Tier 2 preserve the failure as evidence if it
appeared.

**It did not appear.** Both creative beats were composed out of the existing
primitives, and both read naturally:

**Ilda drives the Ogre into the millstone** (beat 10, 5 calls):
`move` → `ability_check` Str (Athletics) **DC 17** → `move forced: true` →
`improvised_damage` **2d6 bludgeoning**, ruling *"shoved into the turning
millstone"* → `end_turn`.

**Brannis swings the hoist rope** (beat 11, 3 calls):
`ability_check` Str (Athletics) **DC 14** → `improvised_damage` **2d6
bludgeoning**, ruling *"swinging hoisted grain sack"* → `end_turn`.

The model reached for an ability check both times, not an attack roll — which
is also what most DMs do with a swing from a rope. And it invented a third
shape unprompted in beat 15: after an ordinary greatsword attack, it called for
the **Ogre** to make a Strength saving throw at DC 13 *"to keep its feet after
Brannis cuts into its knee"*, and narrated the Ogre catching itself when the
engine said the save held.

**The authority boundary held in all three.** The engine rolled; the model read
the answer; the consequence followed the verdict rather than preceding it. Both
Athletics checks succeeded (17 against DC 17, 16 against DC 14) *before* any
damage was applied, and the engine — not the model — supplied the modifiers
(+3 and +4). No number that decided an outcome came from the model.

**Recommendation: do not build an improvised-attack-roll primitive yet.** One
benchmark that did not want it is weak evidence, but it is the only evidence
there is, and the alternative is a primitive built ahead of a user.

---

## 6. Everything else the run turned up

| What | Count | Classification | Cost |
|---|---|---|---|
| `visibility` needs-context | 2 | **missing grounding** — the fixture declared positions but no sight lines | 1 round trip each, both recovered next call |
| `out_of_reach` | 1 | correct refusal; Brannis moved then swung from too far | 1 call, recovered |
| `outside_scene` | 1 | correct refusal; Thessaly backed away through the east wall | 1 call, recovered |
| Guiding Bolt's Advantage rider | — | **known engine gap, honestly reported** via `unverified` rather than silently skipped | none |
| Redundant `look` | 1 | model error; every result already carries state | 1 call |

The two `visibility` requests are the interesting ones, because both arose at
moments a scene-setup discipline would have pre-empted: an Opportunity Attack
needs to know whether the reactor can see the mover, and Healing Word needs to
know whether the Cleric can see the target. The Tier 1 report already
classified `visibility` as pre-declarable. Tier 2 confirms it and puts a
number on it — 2 of 55 calls, ~4%.

**Zero silent substitutions, zero invented facts, zero deadlocks, zero dead
ends.** The model never claimed a mechanical fact the engine owns, never
resolved a different mechanic and covered the join with prose, and was never
stuck in a way it could not get out of.

---

## 7. What was built, and what was found building it

The brief asked for the minimum generalisation of test apparatus, not
architecture. `packages/engine` is byte-for-byte unchanged.

Five things in `tools/llm-probe` were hard-coded to "three combatants, one
scripted player", and each would have produced a plausible-looking Tier 2 run:

| Hard-coded | Now |
|---|---|
| `beginCombat(session, [WIZARD, GOBLIN_A, GOBLIN_B])` | the encounter's roster |
| **`speed: 30` for every combatant** | `speed(sheet)` — an Ogre walks at **40** |
| `rounds * 3` | `rounds * roster.length` |
| Two literal `alive()` side checks | any side with nobody standing |
| One intent cursor, `who === WIZARD`, `"Kessa"` | one cursor per scripted player, names from state |

The vehicle is one new type, `Encounter { id, seed, prelude, roster, sides,
intents }`. **Tier 1's offline run is byte-identical after the refactor** —
`runs/scripted-established.json` did not change a byte — which is the strongest
available evidence the generalisation preserved it.

Three defects were found by building this, all in apparatus:

1. **The flat 30-foot Speed.** True of everyone in the tavern, wrong for the
   first creature that is not a person. Would have given the Ogre a third of
   its stride back and quietly biased every movement measurement.
2. **A harness bug that killed the first live run.** `maxExchangesPerBeat`
   bounds a beat; when the loop hit the bound with a batch still in hand, the
   batch was dropped — and an assistant message carrying unanswered
   `tool_calls` makes every *later* request malformed, so the provider rejected
   the next beat with an error naming a message thirty turns back. Tier 1 never
   used all eight exchanges, which is why four recorded runs went past it.
   Outstanding calls are now answered and deliberately **not** executed: the
   harness has already decided the beat is over, and running one more mutation
   after deciding that would be the apparatus taking a turn. Pinned by a test
   that fails for the right reason when the fix is removed.
3. **The offline stand-in walked into a Large creature.** A placement is
   measured from the target's *anchor*, and standing five feet from a Large
   creature's anchor is standing inside it. Every creature in the tavern was
   Medium and a Medium footprint is five feet, so the tavern never found out.

14 new tests, all of `npm test` (4,277), typecheck and lint green.

---

## 8. Recommendations — reported, not implemented

1. **Expose `towards` on `cast_spell`, and mark `at`'s coordinates required.**
   This is the whole of §4 and it is a tool-schema change, not an engine one.
   It is the second time a published-capability gap has been the worst failure
   in a benchmark, which starts to look like a class rather than an incident —
   **an audit of engine command parameters against what the surface actually
   publishes** is probably worth more than the individual fix.
2. **Declare sight lines in the scene prelude**, or decide deliberately that
   `visibility` requests are the intended cost of three-valued sight. 4% of
   calls, always recovered, so this is a tuning decision rather than a defect.
3. **Do not build an improvised attack-roll primitive** (§5).
4. **Do not optimise token growth.** It is cached and decelerating (§3).

## 9. What Tier 2 does not tell us

- **Nobody dropped**, so unconsciousness, death saves and healing a downed
  character are still unmeasured at any tier.
- **One model, one run, one seed.** Every number here is a single sample.
- **Four actors, not eight.** The growth curve is decelerating over four
  rounds of four; nothing here says where it stops.
- **The Ogre prints no Multiattack**, so the stat-block-action gap Tier 1 left
  open is still open and still untested.
