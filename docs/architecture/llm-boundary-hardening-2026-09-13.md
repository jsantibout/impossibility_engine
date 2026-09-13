# Hardening the LLM ↔ Engine boundary: what changed and what it measured

**Provenance.** Produced 13 September 2026, immediately after
`llm-boundary-experiment-2026-09-13.md`. Same harness, same model
(`gpt-5.5`), same scenario, same seed, same scripted player. Every number
below is from a run in `tools/llm-probe/runs/`; the pre-hardening artifacts are
preserved beside the post-hardening ones.

Governed by the doctrine's new **North Star: Authority Without Rigidity** —
added in `3e4c0f4` before any code was written, precisely so this pass could
not quietly optimise for safety at the cost of play.

---

## 0. The answer, in one paragraph

**Both failures closed, and the boundary got *less* rigid rather than more.**
The model can no longer supply a fact the SRD already prints — asked for Hold
Person on a goblin it is now refused on the truth and narrates the refusal
correctly, where before it declared the goblin "Humanoid" and the spell went
off. At the same time every improvised action in the probe is now resolved by a
DM ruling composed from primitives — the shove that previously became a silent
Unarmed Strike is now *invent the hearth → Athletics DC 13 → forced move into
the fire → 1d6 fire the DM authored* — and **silent rule substitutions went
from 11 to 0**. Round trips fell by a third on the established fixture and by
half on the thin one. Nothing got more rigid: refusals fell, `needs-context`
fell to zero, and there were no dead ends, no deadlocks and no harness
interventions in any run.

---

## 1. What the experiment actually found, at the root

Neither headline failure was a design flaw in `needs-context` or in the
Inviolable Rule. Both were something smaller and more embarrassing.

| Failure | Root cause found by inspection |
|---|---|
| The model declared a Goblin Warrior "Humanoid" | `parseMonsters` reads `type: "Fey"`, `subtype: "Goblinoid"` off the stat block. **`adaptMonster` dropped both fields.** Every creature built from an SRD stat block reached the game with no type, so the engine had to ask for a fact it had parsed and thrown away. |
| The model resolved a shove as an Unarmed Strike | It made the *correct* ruling — Athletics DC 12 — and then had nothing to apply it with. `resolveMove` has supported `forced: true` since Thunderwave. **The surface never exposed it.** The model tried `move`, was refused for lack of Speed, and narrated "the goblin's position does not change". |
| Both goblins fought an entire fight with their fists | `resolveAttack` refuses a weapon its wielder does not own, and there was no way for the DM to arm its own creatures. |

The second of those is the one the North Star ranks worse, and it is worth
stating plainly: **the engine was never wrong. The interface was.**

---

## 2. What changed

Two engine changes, both bug-shaped and additive. No event-vocabulary change,
no reducer change, no `commands.ts` restructuring, no SRD coverage.

| # | Change |
|---|---|
| E1 | `AdaptedMonster` carries `creatureType` and `subtype`. Asserted across the whole bestiary in `monster.test.ts`. |
| E2 | `armorClassOf` exported, so a grounding layer can read the Armour Class the engine actually attacks against rather than the base one. |

Nine surface changes, each mapped to a finding:

| # | Change | Closes |
|---|---|---|
| S1 | `spawn_srd_creature` — type, AC, HP, Initiative, abilities, defences **and the stat block's weapons** all from content | the Goblin failure; the unarmed goblins |
| S2 | `author_creature` — the DM invents a creature and **must** define its type, HP, AC, abilities, size and Speed | world authorship |
| S3 | `give_item` — the DM arms what it creates | the unarmed goblins |
| S4 | `move` gains `forced` | the shove that could not land |
| S5 | `improvised_damage` — the DM authors **dice**, the engine rolls them | the bar stool |
| S6 | `apply_ruled_condition` — a condition as the consequence of a ruling, with the ruling recorded as its source | "on a failure you fall Prone" |
| S7 | narration rides on any mutating call | 64% of round trips were narration and `end_turn` |
| S8 | creature size comes from the stat block; inventory and stat-block actions in the observation | grounding gaps |
| S9 | `ability_check`'s description corrected — it never spent an action, and claimed to | an untrue description |

**The rule that decided the surface changed, and this is the important part.**
It was "the model supplies no numbers". That is wrong: it would forbid a DM
from giving an invented monster hit points, which the North Star explicitly
protects. The rule is now **no number the model supplies may decide or
overwrite an outcome the engine owns**, and `probe.test.ts` classifies every
numeric field on the surface as `authorship`, `ruling` or `selection`,
exhaustively, so adding one is a visible act. Damage is the line: the DM says
`1d4`, which is a rule; `4` is refused as `bad_notation`.

---

## 3. Measurements, pre versus post

Identical model, scenario, seed and scripted player.

### Established fixture — the Tier 1 benchmark

| | Pre | Post | |
|---|---|---|---|
| Beats | 9 | 9 | |
| **Total calls** | 28 | **18** | **−36%** |
| Median calls/beat | 3 | **2** | |
| Max calls/beat | 4 | **3** | |
| Refusals | 1 | **0** | |
| `needs-context` | 0 | 0 | |
| Separate `narrate` calls | 9 | **0** | |
| Malformed | 0 | 0 | |
| Dead ends / deadlocks / interventions | 0 | 0 | |
| Model wall-clock | 66.3 s | **50.5 s** | −24% |
| Engine wall-clock | 84 ms | **18 ms** | |
| Prompt tokens | 361,985 | **217,974** | −40% |
| Completion tokens | 3,286 | **2,450** | −25% |

**The refusal did not become a wall; it became a question.** The model opened
by calling `eligible_targets` for Hold Person, read *"goblin-a is Fey, not
Humanoid"*, and never made the illegal call. One query replaced one failed
cast, and the narration it produced contains correct D&D reasoning: *"the
magic finds no humanoid mind to seize — the goblin before her is Fey."*

### Thin fixture — nothing declared but what content knows

| | Pre | Post | |
|---|---|---|---|
| Beats | 12 | 9 | |
| **Total calls** | 56 | **28** | **−50%** |
| First-beat calls | **11** | **8** | |
| Median calls/beat | 4 | **2** | |
| **`needs-context`** | **4** (scene, position, visibility, creature-type) | **0** | |
| Incorrect fact declarations | **1** (goblin → Humanoid) | **0** | |
| Refusals | 2 | 1 (`wrong_creature_type`, correct) | |
| Prompt tokens | 1,192,877 | **403,718** | −66% |
| Model wall-clock | 153.5 s | **83.0 s** | −46% |

**Zero `needs-context` in the thin fixture is the result, not an absence of
one.** The observation says `scene: null` and `placed: null`, and the model
read that and *built the room before acting*: a forty-foot root-cellar with a
green lantern hanging from the rafters, three creatures placed relative to it,
a sight line declared. That is legitimate world authorship, done proactively,
and it replaced four refusal-driven round trips.

Then it cast Hold Person and took `wrong_creature_type` — **refused on a fact
it could no longer supply**. Pre-hardening, the same model at the same moment
answered "Humanoid" and the spell went off. That is the single clearest
before/after in the pass.

### Improvised-action probe — the rigidity check

| | Pre | Post |
|---|---|---|
| Total calls | 22 | 24 |
| **Silent rule substitutions** | **2 of 3** improvised actions became Unarmed Strikes | **0** |
| **DM ruling calls** | 0 | **4** (`ability_check` ×2, `improvised_damage`, `apply_ruled_condition`) |
| Forced movement | not expressible | **1** |
| Dead ends | 0 | 0 |

Calls went *up* by two, and that is the right direction: the extra calls are
mechanical work that previously did not happen. The shove is now

> `add_landmark` "the hearth" → `move` to close → `ability_check` Str
> (Athletics) DC 13 → `move forced: true` into the fire →
> `improvised_damage` **1d6 fire**, *"shoved into the hot hearth"* → `end_turn`

and the bar stool is `add_landmark` → `move` (provoking, and the model settled
the Opportunity Attack itself) → `ability_check` DC 14 →
`apply_ruled_condition` **prone**. No bespoke command exists for either, and
none is needed.

### Across all six runs

| Measure | Pre (3 runs) | Post (3 runs) |
|---|---|---|
| Unarmed-Strike substitutions for a ruled action | **11** | **0** |
| Separate narration calls | 27 | **0** |
| Incorrect authoritative fact declarations | **1** | **0** |
| `needs-context` requests | 4 | **0** |
| Deadlocks / harness interventions | 1 (pre-fix) | **0** |
| Deterministic fold + transcript replay | PASS | **PASS** |

Determinism held on every run. The recorded call transcript re-dispatched into
a fresh table rebuilds the same log byte for byte, live and offline.

**Cost.** Prompt tokens fell 40% on the established fixture and 66% on the thin
one, at ~85–91% cache hit rates throughout. Absolute cost depends on the
account's rate for `gpt-5.5`, which this document does not assume; the ratios
are the measurement.

---

## 4. Did we make the model more rigid?

**No, and this was the thing most at risk.** Every rigidity indicator moved the
right way:

- Refusals: 1 → 0 (established), 2 → 1 (thin, and the remaining one is
  correct).
- `needs-context`: 4 → 0.
- Dead ends: 0 → 0.
- Actions the model wanted to take and could not express: 3 → 0.
- New refusal codes added: `unknown_monster`, `id_taken`, `unknown_condition`,
  `bad_notation`. Each refuses only an *impossible* thing, and each names the
  tool that does work — `unknown_monster` points at `author_creature`.

The one place the surface got stricter is the one the brief asked for: a
creature's established type cannot be relabelled. That is protection of truth,
not compensation for an inflexible interface, which is the test the North Star
sets.

---

## 5. What is still open

- **One model, one fight.** Nothing separates a property of the boundary from a
  property of `gpt-5.5`. The driver is behind a one-method interface so the
  same scenario can be run against Claude Opus 5, which `CLAUDE.md` names as
  Maestro's model. Not done.
- **Improvised attacks have no attack roll.** `improvised_damage` is damage,
  and `ability_check` is a check. A DM wanting *"a Strength-based attack roll
  against its AC, 1d4 bludgeoning"* currently composes a check against a DC it
  reads off the observation. A synthetic-weapon path through `resolveAttack`
  was considered and rejected: it would bypass reach, cover and the action
  economy, which is the hole this pass exists to close. If the Ogre benchmark
  shows the DM reaching for this repeatedly, it is the next primitive.
- **Stat-block actions are names, not mechanics.** `spawn_srd_creature` arms a
  creature with catalogue weapons whose slug matches an action name. A breath
  weapon, a Multiattack or a spellcasting block is surfaced to the DM as a name
  to rule on, not executed.
- **`creature-added` carries no command stamp**, so the creation tools use the
  creature id as their idempotency key. Adding a stamp would need an event
  change; the id is sufficient and the retry semantics are tested.
- **The `improvised_damage` roll is recorded but not causally linked** to the
  check that justified it. The ruling string is in the event source, which is
  the minimal version of the audit's `cause` recommendation (#14); the real one
  is still open.

---

## 6. Is the boundary ready for three level-2 characters versus an Ogre?

**Yes, with two things to watch and one to check first.**

What the Tier 2 benchmark adds over Tier 1, and where each stands:

| New demand | Status |
|---|---|
| A Large creature | `spawn_srd_creature` + stat-block size; `place_creature` takes it from the bestiary. The Ogre parses as `Giant`, Large, AC 11, HP 68. **Tested for goblins (Small); untested for Large.** |
| Three PCs instead of one | `createCharacter` is exercised for one Wizard. Three level-2 characters of different classes is new fixture work, not new boundary work. |
| More creatures in the initiative order | The harness's beat loop is hard-coded to three combatants and one scripted player. **This needs generalising before Tier 2.** |
| Reach and a bigger footprint | Engine-owned and long tested; nothing on the surface changes. |
| Multiattack | The Ogre has none — it prints a single Greatclub attack — so Tier 2 does not force the stat-block-action gap. |
| Party tactics, several actors per round | More beats, therefore more round trips. At 2 calls/beat the budget holds; at 12 beats/round it is 4× Tier 1's token growth. |

**The one to check first:** the harness assumes one player character and three
combatants. That is fixture and loop work in `tools/llm-probe`, not boundary
work, and it should be done before the benchmark rather than during it.

**The two to watch:** whether per-turn cost stays flat as the initiative order
grows (the token curve is the thing to measure, not the call count), and
whether the DM reaches for an improvised *attack roll* often enough to justify
the primitive named in §5.

Nothing in this pass suggests the boundary itself is the limiting factor. The
engine answered 70 calls across three post-hardening runs in 51 ms.
