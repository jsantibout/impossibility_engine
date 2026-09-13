# Tier 2: three level 2 characters and one Ogre

**Date:** 2026-09-13
**Model:** `gpt-5.5`, same configuration as the post-hardening Tier 1 runs
**Artifacts:** `tools/llm-probe/runs/tier2-ogre.{md,json}`
**Engine changes made for this tier:** none

> **Status: the LLM-boundary checkpoint is validated for continued engine
> development.** Sections 1–9 are the Tier 2 run as it happened; §10 is the
> parity audit its findings prompted, and §11 is the checkpoint verdict and the
> gaps it deliberately leaves open.

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

---

## 10. The parity audit, and the deadlock it found before a fight did

Added after the run above, on the evidence of §4. `packages/engine` is still
untouched.

§4 recommended auditing engine command parameters against what the surface
actually publishes, on the grounds that two benchmarks had now lost their worst
turn to the same class of gap. The audit found four things the benchmarks
needed and two more that nothing could reach — and one of the four was worse
than a lost turn.

### The two gaps that were hiding each other

`owedAreaEffects` is global engine debt. `mayAct` refuses every action while one
stands, and `resolveTurn`'s own guard refuses **before** it reaches the
settlement it would otherwise perform internally. So a creature that walks into
a Grease can neither act nor end its turn, and the only command that settles it
— `settleAreaEffects` — was not on the surface.

The surface knew, and had written down a reason that had gone stale:

> `owed_area_effects: 'no spell on this surface makes a persistent area'`

True when written. False from the moment a Wizard with Grease prepared joined
Tier 2 — and the only thing still hiding it was that `cast_spell` could not
point a Cube, so the area could not be made in the first place.

**Fixing `towards` alone would have wedged the Tier 2 rerun.** The two gaps
masked each other exactly, which is the argument for auditing a surface rather
than patching the case in front of you.

### What is now published

| Field or tool | Why it was required | Evidence |
|---|---|---|
| `cast_spell.towards` (+ `towards_creature`, `towards_landmark`) | a Cone, Cube or Line has to be pointed somewhere | §4, the lost turn |
| `cast_spell.at` coordinates now required | a `{ z: 0 }` reached the engine as malformed input | §4 |
| `attack.thrown` | a Javelin is "Melee or Ranged"; without it the engine measured melee reach | §6, the silent substitution |
| `settle_area_effects` | the deadlock above | this section |
| `declare_cover` | the model's job since positioning landed, with no tool at all | audit |
| `ability_check.senses` | a fact about the attempt, which the engine cannot derive | audit |

`declare_cover` is the one worth dwelling on: `CLAUDE.md` has said since
positioning landed that "the model says 'behind the bar, three-quarters cover';
the engine applies exactly +5 AC", and there was no tool. **Every attack in both
benchmarks resolved as though the tavern bar and the mill machinery were not
there.** Nothing failed, nobody noticed, and the fights were quietly easier than
the fiction described — which is the failure mode a refusal at least makes
visible.

### What is deliberately withheld

Every remaining parameter is named with its reason in `parity.test.ts`. Three
reasons recur:

- **A number that would decide an outcome** — `attackBonuses`, `damageBonuses`,
  `bonuses`. The Inviolable Rule; these can never be published.
- **A debt with no settlement** — `hold` on an attack or a casting opens
  `pendingAttack` / `pendingCasting`, and nothing here closes either window.
  Publishing one without the other is how a fight wedges, which is the mistake
  this section exists to have stopped repeating. They are a *paired* change.
- **No reachable user** — `slotKind`, `slotless`, `unaffected`, `damageType`,
  `twoHanded`, `finesseAbility`, `extraDamage`, `featureDamageTypes`.

Two were **measured rather than assumed**, and the measurement changed the
answer. `payment` and `source` both looked reachable: all three Tier 2
characters carry a Magic Initiate free daily casting *and* spell slots, which
is exactly the ambiguity `payment_required` exists for. Driven through the
engine, neither fires — Shield refuses on its Reaction trigger first, and Mage
Armor has no executable definition. They stay withheld with that written down,
and go in the moment a route actually collides.

`modes` — a DM granting Advantage by fiat — is the one judgement call left open
on purpose. It is a real DM power and the engine already derives every
conditional source itself, so what is left changes an outcome and deserves its
own evidence rather than a parity tidy-up.

### The test that makes this durable

`tools/llm-probe/src/parity.test.ts` reads `packages/engine/src/commands.ts`
and extracts the fields of every request type the surface wraps, then holds each
against a decision: the tool property that carries it, or a written reason. A
parameter added to the engine is in neither list, so the test fails the day it
is added and somebody decides.

The same technique `spell-tracking.test.ts` uses on SRD prose and `bestiary.ts`
uses on stat blocks: **the authority is the artefact, not a list maintained
beside it.** Both halves are mutation-checked — removing `towards` from the map
fails, and claiming a tool property that does not exist fails.

A second block covers whole commands rather than parameters, and asserts the
engine functions it names are really exported, so the map cannot drift into
guarding nothing.

### Live reruns

Same model, same configuration, same seeds.

| | Tier 2 before parity | Tier 2 after |
|---|---|---|
| Pre-registered criteria | 5 of 6 | **6 of 6** |
| Actor turns completed | 15 of 16 | **16 of 16** |
| Harness interventions | 1 | **0** |
| Total calls | 55 | 53 |
| Refusals | 8 | **2** |
| Malformed calls | 1 | **0** |
| Cost | $0.4640 | **$0.4295** |
| Deterministic replay | PASS | PASS |

The Grease turn, which had been eight calls and six refusals ending in a lost
turn, became four calls: `look` → `cast_spell` refused `no_direction` once →
`cast_spell` with the direction → `end_turn`. The model read the refusal and
answered it in one round trip, which is what that refusal was always trying to
ask for.

**Every new field was used unprompted**, and the shape of the use is the
evidence that the design was right:

- `towards_creature: "ogre"` — it aimed the Cube at a *creature*, not at
  coordinates. That vocabulary is what the engine's own docstring asks for.
- `thrown: true` — Brannis threw the javelin instead of closing to melee, and
  the narration reads "snaps a javelin overhand at the fallen ogre", the Ogre
  being Prone because the Grease had landed.
- `settle_area_effects` — at beat 15 a Fighter stepped into the slick and the
  model settled the debt in the same turn, with no prompting and no wedge.

Tier 1 was rerun as a regression check and is **unchanged**: 18 calls, median 2,
zero refusals, zero `needs-context`, 49.6 s against 50.5 s. The larger surface —
three more tools and six more fields — cost it nothing.

---

## 11. Checkpoint: the boundary is validated for continued engine development

Three live experiments and a parity audit are enough. The boundary is not the
risk any more, and engine work should not wait on it.

What that does **not** mean, stated so nobody reads it as more than it is:

- **Unconsciousness, death saves and healing a downed character remain
  unmeasured at every tier.** The engine executes all three; no benchmark fight
  has gone there. Tier 1's goblins died and Tier 2's Ogre finished on 3 of 68
  with the party bruised and upright. Forcing it would mean choosing the fight
  to suit the answer. **Recorded as a future benchmark gap, not a blocker** —
  the honest close is a Tier 3 built around a longer encounter that is then
  allowed to happen.
- `pendingAttack`, `pendingDamage`, `pendingTest` and `pendingCasting` are
  reachable only through `hold`, which stays unpublished until something
  settles those windows.
- A stat block's printed Multiattack is still unread, and the Ogre does not
  print one.
- No benchmark has wanted an improvised **attack roll**, so no primitive exists
  for one. Two creative beats and a third invented ruling all composed out of
  `ability_check`, `improvised_damage`, `apply_ruled_condition` and
  `move forced`.

### One engine finding, reported and not fixed

Raised while building the parity fixtures, and outside this pass's remit.

**A radius centred on a space is one cube wider than the tabletop convention.**
The engine models a point as a *space* — deliberately, and `CLAUDE.md` explains
why: "a stored coordinate is always one the engine could have produced itself".
But a radius measured from a space is symmetric about that space, so it covers
an odd number of cubes. Measured: **a 20-foot-radius Sphere catches 9 cubes
across — 45 feet, not 40.**

`CLAUDE.md` states the other number: "every cube within 20 feet of a point forms
a 40-foot square". The code and the document disagree, and the document is the
one describing the tabletop convention, where a blast is aimed at an
*intersection* and a 20-foot radius covers an even 8×8.

This decides whether a Fireball catches two goblins or three, which is the call
`CLAUDE.md` itself names as the most consequential positional judgement in the
game — so it wants a deliberate answer rather than a silent one. Nothing here
changed it.

A second, smaller oddity in the same area: a directional shape's axis is
computed as `unit(subtract(cubeCentre(shape.towards), origin))` — `cubeCentre`
applied to the target but not to the origin, which bakes a fixed half-cube skew
into the direction. It is negligible when the aiming point is far away and
tilts the axis noticeably (including into `+z`) when it is close. That is the
practical reason `towards_creature` and `towards_landmark` are the vocabulary
this surface encourages: both name something a useful distance off.
