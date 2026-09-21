# Infinite Realms against the engine, 2026-09-21

> A read-only assessment taken for `docs/ROADMAP.md` §7 (tracks I-A0 to I-A12 and milestones I-1 to I-3). Line numbers are as of the app's working tree and engine `f163717` on that day. A copy sits in the app's own `docs/design/`.

# Infinite Realms against the Impossibility Engine

A read-only assessment, 2026-09-21. Nothing in either repository was modified by this pass:
scratch scripts were written only under the two gitignored `node_modules/.audit/` directories,
and no network script was run. (`ImpossibilityEngine` showed `CLAUDE.md`, `STATUS.md` and three
new `docs/` files as modified partway through — **a concurrent session's work, not this one's**;
Infinite Realms stayed clean throughout.)

**Everything below is measured unless the line says "inferred".**

---

## 0. Two corrections to the brief, before anything else

1. **"Luna" is not the DM.** `gpt-5.6-luna` is an OpenAI *model id*
   (`src/narration/model-names.ts:7`, `.env.example:34`, default at `src/server/env.ts:80`). The
   Dungeon Master persona is **Maestro**, named 373 times in `src/**/*.ts{,x}`. There is no
   character called Luna anywhere in the app.

2. **The model already holds tools, and they already roll.** `src/narration/tools.ts:64-127`
   defines four function tools in the OpenAI Responses shape — `createNPC`, `createQuest`,
   `findTreasure`, `lookup` — always on the table
   (`src/narration/openai/openai-narration-provider.ts:250-251`), executed by the app at
   `src/narration/tools.ts:201-245`, capped at two tool rounds per turn
   (`openai-narration-provider.ts:94`). So the "model calls a tool, the app rolls, the model
   narrates the answer" loop the engine wants **already exists in this codebase** and has been
   through several design iterations. That is the single most important asset in the port.

---

## 1. What Infinite Realms is today

### 1.1 Size and health

| Measure | Value |
|---|---|
| Tracked files | 323 (209 `.ts`, 66 `.tsx`, 21 `.md`, 12 `.mjs`) |
| `src/` lines | **60,253** |
| Test files / tests | **84 files, 1,056 tests — all passing** (38.2 s, `vitest run`) |
| `tsc --noEmit` | **exit 0** |
| Node | v24.18.0 installed; README requires 22.13+ or 24 (`README.md:22`) |

Lines by directory (tracked files, `wc -l`):

| Directory | Files | Lines | What |
|---|---|---|---|
| `src/content` | 14 | 17,581 | the catalogue: 4 pregens, 30 stat blocks, 365 items, spell actions — **all engine-derived** |
| `src/ui` | 78 | 9,678 | React: shell, adventure feed, dice plaques, character, inventory, quests, settings, dev |
| `src/runtime` | 30 | 9,102 | `GameRuntime` contract + `MockGameRuntime` + the development referee |
| `src/domain` | 40 | 8,201 | pure types and functions: campaign, encounter, resolution, quest, treasure, sheet |
| `src/narration` | 37 | 7,914 | `NarrationProvider`, the OpenAI provider, the brief/packet/editor, the narrator's tools |
| `src/application` | 22 | 4,235 | turn pipeline, opening pipeline, turn stream, campaign service |
| `src/app` | 28 | 1,354 | Next.js routes — thin |
| `src/server` | 6 | 1,147 | composition root, env, body parsing |
| `src/llm` | 4 | 606 | OpenAI-compatible chat-completions client, SSE reader |
| `src/persistence` | 5 | 435 | `CampaignRepository`, file and memory stores |
| `scripts` | 21 | 3,724 | generation (engine-backed), probes, one-off repairs |
| `docs` | 18 | 3,865 | 13 ADRs + 4 design notes + the narration contract |

This is not a juvenile codebase. It is a careful one: dependency-inverted, clock- and
randomness-injected, with structural defences rather than prompt instructions
(`docs/narration/README.md:133`). What is juvenile is the *game* it adjudicates — and that is
exactly what the engine fixes.

### 1.2 Structure

**Routes** (16 handlers, all under `src/app/api/`, all calling `getContainer()` at
`src/server/container.ts:220`):

| Route | Method | Purpose |
|---|---|---|
| `/api/campaigns` | GET/POST/PUT | list + active pointer / create / switch |
| `/api/campaigns/[id]` | GET/PATCH/DELETE | load (seeds dev campaign) / set gender or style / dev-only delete |
| `/api/campaigns/[id]/turns` | POST | **submit an action** → `runTurn`, NDJSON stream (`turns/route.ts:24,34`) |
| `/api/campaigns/[id]/turns/[turnId]/narration` | POST | re-narrate a stored turn, mechanics untouched |
| `/api/campaigns/[id]/opening` | POST | author + narrate session one |
| `/api/campaigns/[id]/ideas` | POST | three "what could I do" chips |
| `/api/campaigns/[id]/inventory` | POST | equip / unequip / attune / unattune |
| `/api/campaigns/[id]/quest` | POST | `{action:"abandon"}` |
| `/api/campaigns/[id]/reset` | POST | dev-only reseed |
| `/api/dev/narration/{compare,adopt}` | POST | dev-only narrator comparison |
| `/api/maestro/status` | GET | provider ids, dev telemetry |

**Screens** (`src/app/(shell)/`): adventure, character, inventory, quests, world, party
(placeholder, `party/page.tsx:6`), settings, `dev/maestro`.

**Composition**: `src/server/container.ts:134-139` is the seam. `createRuntime` switches on
`config.runtimeId`, and `src/server/env.ts:24` types it as the literal `'mock'`;
`env.ts:97-100` rejects `GAME_RUNTIME=impossibility-engine` with
*"is not available in this build … arrives with the adapter"*. `.env.example:3-5` reserves the
name. **The adapter's socket is already cut and labelled.**

### 1.3 The `GameRuntime` mock

**Interface** (`src/runtime/game-runtime.ts:63-87`) — two methods:

```ts
resolveTurn(request: TurnRequest): Promise<TurnResolution>   // :71
openEncounter(request: OpenEncounterRequest): Promise<OpenedEncounter>  // :86
```

`TurnRequest` (`:17-43`) carries `turnId` (the idempotency key, `:18-22`), `campaignId`,
`actorId`, the player's raw `intent`, an optional `declaration` for a tapped combat chip
(`:37`), and a whole `Campaign` snapshot the comment already says *"The engine adapter will
ignore it and load its own authoritative state instead"* (`:39-42`).

**What it fakes.** `src/runtime/mock/**` is **8,238 lines** (tests included) and implements, in
its own arithmetic:

- **Dice**: `TurnDice` (`src/runtime/mock/combat/dice.ts:62`) — FNV-1a hash per die plus a
  splitmix32 finalizer (`dice.ts:27-41`), seeded from the turn id. Its own header concedes it:
  *"It is a hash, not a generator. The engine has a real seeded `Rng` … this is scaffolding"*
  (`dice.ts:10-12`). A second, different RNG for out-of-combat checks at
  `src/runtime/mock/mock-game-runtime.ts:48-56`.
- **Initiative** (`combat/start.ts:96-239`), with **assigned tiebreaks** — hero 100, allies
  `90-i`, foes `50-i` (`start.ts:114,142,173`) — and *"The player wins a tie"* as a stated
  product call (`start.ts:112-114`). Surprise is modelled as acting last, not disadvantage
  (`start.ts:195-198`); "ambush on a successful Stealth" is invented (`start.ts:199-201`).
- **Attack / damage / critical**: `strike` (`combat/run.ts:259-326`), `applyDamage`
  (`run.ts:339-378`), crit doubles dice not flat (`dice.ts:114-120`).
- **Saving throws**: exactly one site — player save-spells (`run.ts:657-694`), DC defaulting to
  a made-up **13** (`run.ts:657`) and spell attack bonus to **0** (`run.ts:649`). Monsters never
  force saves; `StatBlock.saveAttacks` (`src/domain/bestiary.ts:59-70`) is populated and never read.
- **Death saves** rolled all at once as aftermath, with resurrection at a temple rather than
  death — a documented departure (`run.ts:936-947,981-996`).
- **Ability checks**: `adjudicate` (`mock-game-runtime.ts:395-432`). The **DC comes from a model**
  (the referee), clamped 5–30 (`development/validate-ruling.ts:168`). The modifier is found by
  *substring-matching the referee's label against the printed sheet* (`mock-game-runtime.ts:456-465`),
  and a label naming no skill gets **flat +0** — `check.ability` is carried into the result and
  never used to compute the modifier (`mock-game-runtime.ts:399` vs `:421`).
- **Space**: three bands `reach|near|far` (`src/domain/encounter.ts:43`), `BAND_FEET =
  {5,30,60}` (`encounter.ts:161`). No grid, no facing, no shapes — *"Space is three bands, not
  feet … The engine has a cube lattice and will bring it"* (`encounter.ts:20-27`).
- **Conditions**: names only. Two strings are ever written — `'dodging'` and `'aiming'`
  (`run.ts:451-455,498-503`). Stat-block riders are carried as prose and never applied
  (`bestiary.ts:46-51`). *"Conditions are names, not rules"* (`encounter.ts:28-30`).
- **Cover**: half cover only, `+2` (`encounter.ts:416-429`); a ranged foe grants itself cover
  for free every turn (`combat/tactics.ts:167`).
- **Rests, Hit Dice, spell slots, Arcane Recovery** (`combat/rest.ts:75-194`,
  `src/domain/resources.ts`): one Hit Die per short rest by fiat (`rest.ts:52-57`), Arcane
  Recovery all-or-nothing with slots chosen for you (`rest.ts:158-168`).
- **Monster tactics** in code, not a model: `decideMove` (`tactics.ts:147-173`), target the
  lowest HP fraction (`tactics.ts:76-81`), an invented morale rule (`tactics.ts:97-116`).
- **Trade and item use**: `applyInventoryRuling` (`development/inventory-ruling.ts:30-117`).
- **Surrender** as a fourth outcome (`run.ts:762-792`) — not SRD.
- **Action Surge and Channel Divinity are absent** — Channel Divinity exists only as a pool
  label (`resources.ts:29`); Action Surge appears nowhere in `src/runtime` or `src/domain`.
- **Features are found by regex over printed sheet text** — attack lines (`options.ts:61`), heal
  lines (`:101`), Arcane Recovery (`:92`), Cunning Action (`:275`), Sneak Attack
  (`run.ts:394`). A wording change silently loses a feature.

**Vocabulary** (definition sites): `Combatant`/`Side`/`Band`/`Vitality`/`TurnBudget`/
`PendingDecision`/`EncounterOutcome`/`CombatOption` (`src/domain/encounter.ts:56,35,43,46,117,210,230,315`);
`MechanicalResult` as a 8-way union (`src/domain/resolution.ts:220`); `Resources`/`ResourcePool`
(`src/domain/resources.ts:58,26`); `DerivedSheet`/`RollEdge` (`src/domain/sheet.ts:42,33`);
`Ruling`/`ProposedCheck` (`src/runtime/mock/development/scene-author.ts:49,35`).

**Determinism**: a mock turn is reproducible from its turn id — asserted by
`combat/run.test.ts:147`, `rest.test.ts:85`, `mock-game-runtime.test.ts:163`. Caveats: replay is
order-dependent (`dice.ts:53-60`), and the LLM referee is called at `temperature: 0.5`
(`llm-scene-author.ts:220`), so the *DC* is not deterministic even though the die is. `Math.random`
appears exactly once in `src/` — an id fallback at `src/domain/ids.ts:40`, not in any
adjudication path. `Date.now()` in `src/application` is timing only (`turn-pipeline.ts:149`).

### 1.4 The `NarrationProvider`

**Interface** (`src/narration/narration-provider.ts:173-191`): `narrate(request, options)`
returns `AsyncIterable<string>` — *only* the prose. Three side channels on `NarrationOptions`
(`:155-171`): `onRecord(block)` (the hidden `<state>` record), `onTools(results)` (what the
narrator's dice produced), `onTelemetry`.

**How OpenAI is called** (`src/narration/openai/openai-narration-provider.ts`):

- **Endpoint**: `POST {baseUrl}/v1/responses` — the **Responses API**, not chat completions
  (`:320`); default origin `https://api.openai.com` (`:205`). Reason given at `:29-33`:
  reasoning effort is first-class, usage reports cached tokens, and `prompt_cache_key` isolates
  campaigns.
- **Model**: configured, never assumed (`:36`); default `gpt-5.6-luna` (`src/server/env.ts:80`).
- **Tools**: yes — `tools: NARRATOR_TOOLS, tool_choice: 'auto'` on every narrator request
  (`:250-251`), with the tool-call loop at `:384-423` and the continuation assembled as
  `function_call` + `function_call_output` input items (`:417-421`). Up to `TOOL_ROUNDS = 2`
  (`:94`).
- **Prompt**: `buildMaestroBrief` (`:354`) → `renderFreeTurn(brief.packet)` (`:358`).
  `instructions` carries the system message; the user message is the turn. `store: false`,
  `prompt_cache_key: infinite-realms:${campaignId}` (`:247-248`).
- **Two calls a turn**: the narrator with `reasoning: 'none'` (`:199`), then an **editor** with
  `reasoning: 'low'` (`:202`) that is handed the whole packet beside the draft and writes the
  record (`:430-468`), plus a third call only when the edit hit the ceiling mid-record
  (`:453-467`).
- **Reveal pacing**: 25 ms/word (`:64`), because the edit means the whole turn exists before any
  of it is shown.
- **Robustness**: a 400 naming one optional parameter drops it and retries (`:192-196,315-335`);
  the API key is redacted out of every error (`:534-536`).

### 1.5 The feed model — mechanical truth, then narration

`AdventureFeed` (`src/ui/adventure/AdventureFeed.tsx:36,52`) → `TurnBlock`
(`src/ui/adventure/TurnBlock.tsx:30`). The fork is `TurnBlock.tsx:34`:
`results.some(isCombatResult)` renders one `CombatPlaque` (`:53`), otherwise one
`MechanicalResultCard` per result (`:59-66`). Order is enforced: player's words (`:46`), then
the plaque, then narration (`:74`) — narration is **withheld until the dice settle** via
`onDiceSettled` (`:37-40`).

Provenance actually shown:

- Ability check (`src/ui/dice/MechanicalResultCard.tsx:120-180`): label + ability + **DC**
  (`:146`), advantage mode + *both* dice + what gave the edge (`:149-155`), the d20 face
  (`:158`), `natural + modifier = total` (`:167-170`), and the verdict read off `result.outcome`
  — **never recomputed** (`:132`). A screen-reader sentence at `:134`.
- Combat (`src/ui/dice/CombatPlaque.tsx`): both d20s **in throw order** with the kept one lit and
  the dropped one faded (`:51,117-145`) — the rationale at `:39-50` is that drawing the kept die
  first made players disbelieve the second die existed. Damage face-by-face
  (`:228-252`), with `dealtOf` (`:222`) summing dice so the shown number matches the arithmetic
  even when the amount was capped, and the reason at `:201-221` (a 6d6+3 critical that read as 9).

The header comment at `MechanicalResultCard.tsx:17-18` is the doctrine in one line:
*"Everything shown comes from the resolution as given; nothing is computed here."*

### 1.6 Campaign persistence

`CampaignRepository` (`src/persistence/campaign-repository.ts:14-32`): `get`, `save`, `list`,
`remove`, `activeId`, `setActiveId`. Two implementations — file
(`file-campaign-repository.ts`, temp-file + rename) and memory. The contract comment at `:11`
and `:28` already names **Supabase** as *"the same handful of methods over a table and a row per
player"*.

**Shape of a document** (measured on `.data/campaigns/the-arena-0fb521.json`): top-level keys
`id, title, premise, createdAt, updatedAt, lastPlayedAt, protagonist, scene, chronicle, hooks,
history, suggestions` — and, when present, `quest`, `quests`, `encounter`, `treasure`
(`src/domain/campaign.ts:65-151`). A `Turn` in `history` holds
`id, at, actorId, intent, resolution, narration, canon` (`src/domain/turn.ts:53-67`).

**There is no event log.** The document is a *folded snapshot* plus a narrative history.
`applyWorldOf` (`campaign.ts:174`) and `applyCanonOf` (`:365`) are deliberately idempotent folds,
and `withTurn` (`:581`) retracts a retold turn's canon and treasure before re-applying — the same
shape as an event fold, but over whole assignments rather than events. Sizes measured:
19 KB to **889 KB** per campaign, with `CHRONICLE_LIMIT = 200` and `HOOK_LIMIT = 20`
(`campaign.ts:58-59`) dropping the oldest first — the comment calls that *"the crudest possible
policy and the reason this is a stand-in"* (`:53-57`).

### 1.7 The turn pipeline

`src/application/turn-pipeline.ts`, in order:

1. load (`:475`) → 2. **idempotency check on `turnId`** (`:484`) → 3. context prepared *in
parallel* with the runtime (`:505-506`) → 4. `runtime.resolveTurn` (`:513`) +
`validateTurnResolution` + `deepFreeze` (`:521`) → 5. build the `Turn` with
`narration: {status:'pending'}` (`:546-553`) → 6. orchestrator (`:560`) → 7. **save #1** (`:569`)
→ 8. yield `resolved` (`:576`) → 9. `narrator.narrate` (`:260`), streaming `narration` deltas
(`:276`) → 10. `canonFrom` (`:300`), implied treasure (`:341`), quest dice (`:313`) →
11. re-read + optional `runtime.openEncounter` (`:429-433`) → 12. **save #2** (`:434`) →
13. `committed` (`:443`) + `telemetry` (`:465`).

Idempotency: the key is **`turnId`**, minted client-side (`src/ui/adventure/useAdventureSession.ts:63`,
`src/domain/ids.ts:33`) and validated server-side by `/^[A-Za-z0-9_-]{8,64}$/`
(`src/server/parse-body.ts:11`). A repeat re-yields the stored resolution with **no second roll
and no second model call** (`turn-pipeline.ts:484-490`).

Stream events (`src/application/turn-stream.ts:18-35`): `resolved` → `narration*` → `committed`
→ `telemetry`, or `error {stage: runtime|narration|persistence}`. NDJSON over a streamed POST
(SSE rejected because `EventSource` cannot POST, `:8-11`). The stream is push-driven: a dropped
connection still commits the turn (`:141-156`).

### 1.8 The scripts

| Script | Network | What |
|---|---|---|
| `combat:smoke` | **none** | plays a whole fight offline, prints every roll; cap 40 decisions (`scripts/combat-smoke.ts:70`), default 3 goblins, seed `'smoke'` (`:36-37`) |
| `combat:probe` | OpenAI (conditionally) | asks the referee to rule on 6 situations (`scripts/combat-referee-probe.ts:52-66`) and the narrator on 2 scenes; prints `${right}/${PROBES.length}` (`:98`). **Does not load `.env.local`** (`:69,117`), so via npm it can silently degrade to the offline referee |
| `narration:probe-openai` | OpenAI `/v1/responses` | one real request on a fixture turn; prints tokens, first-token latency, cost (`:70`) |
| `narration:smoke` | OpenAI ×2/turn | the production pipeline on an in-memory copy; prints the document diff |
| `narration:openings` | OpenAI ×4 | two premises opened end to end |
| `narration:session` | OpenAI ×4/turn | the big harness: N turns with a simulated player, writes a report + transcripts under `src/narration/eval/results/` |
| `scripts/memory-audit.ts` | none | measures every brief's word budget and the chronicle's fixation, per campaign on disk |
| `scripts/{forget-fact,mark-dead,repair-*}.ts` | none | one-off repairs that **write** `.data/campaigns` |
| `scripts/{pregens,bestiary,catalogue}/generate.mjs` | none | **generate content from the sibling engine** — see §3 |

The referee's contract (`src/runtime/mock/development/llm-scene-author.ts:73-129`) is worth
naming because it is already the engine's discipline in miniature: a JSON grammar with
*"no field for a die, a total or a verdict — and no way to write fiction"* (`:66-72`), DC clamped
5–30 (`validate-ruling.ts:168`), any fact claiming hit points silently dropped (`:72-81`, after a
model wrote *"regains 1 hit point"* and the player's sheet stayed at zero, `:59-71`), any price
the referee wrote discarded because *"the price is the book's"* (`:299-302`).

### 1.9 Users and auth

**None.** No user, auth, session, cookie or middleware exists anywhere in `src/`. `supabase`
appears only in two comments (`campaign-repository.ts:11,28`). `playerId`/`ownerId`/`userId`:
zero matches. The nearest thing to identity is `ActorId`, a plain string alias
(`src/domain/ids.ts:6`) that identifies a *character*.

**Worth flagging now, because it becomes a security bug the moment this is hosted:**
"which campaign is open" is a **server-global** pointer — one `.active.json` file
(`file-campaign-repository.ts:16,111,133`) — and the contract comment says so outright
(`campaign-repository.ts:26-28`). Every browser hitting the server shares one active campaign and
can read, write and (in dev) delete every campaign.

---

## 2. The seam, side by side

The engine's surface, **measured** by enumerating it (`node_modules/.audit/surface.ts`):

| | Player door (`createSurface`) | DM door (`createDmSurface`) |
|---|---|---|
| Tools | **69** | **82** |
| Descriptions | 26,418 chars | 31,659 chars |
| Zod → JSON Schema (`z.toJSONSchema`) | 54,037 chars | 63,248 chars |
| **Combined ≈ tokens** | **~20,100** | **~23,700** |

14 tools are DM-only: `ability_check`, `saving_throw`, `settle_test`, `rule_condition`,
`end_condition`, `improvised_damage`, `roll_improvised_damage`, `award_coin`, `take_coin`,
`award_items`, `lose_items`, `declare_heads`, `take_printed_action`, `take_printed_bonus_action`.
One is player-only: `apply_condition`.

`doorsFor` on the player surface (measured):
`creature → add_creature|create_character|summon_creature`; `position → place_creature`;
`visibility → declare_sight`; `creature-type → declare_creature_type`; `side → declare_side`;
`scene → add_landmark|set_scene`; `route → activate_spell|move`; `turn-order → roll_initiative`.
Every kind has a door.

Shapes: `ToolCall {tool, input, commandId}` (`packages/tools/src/dispatch.ts:29-43`);
`Surface {tools, doorsFor, call, observe}` (`:45-54`);
`ToolDefinition {name, description, mutates, establishes, selfAnswers, schema, invoke}`
(`packages/tools/src/definitions.ts:278-298`);
`ToolOutcome = ok | refused | needs-context | invalid` (`packages/tools/src/outcome.ts:81-111`).

### 2.1 Mock operations → engine

Legend: **D** direct fit · **A** needs an adapter · **N** no equivalent · **C** contradicts the engine.

| Mock operation (file:line) | Engine equivalent | |
|---|---|---|
| `TurnDice` hash RNG (`combat/dice.ts:62`) | `Campaign.supply()` rebuilds `Rng`+`RollIssuer` from `state.rng`/`state.rollsIssued` (`packages/tools/src/campaign.ts:87-93`) | **C** — delete; the app must never hold a die |
| `d20FromTurnId` (`mock-game-runtime.ts:48`) | same | **C** — delete |
| `resolveTurn(request)` (`game-runtime.ts:71`) | *no single call*: N × `surface.call(ToolCall)` | **A** — this is the whole adapter |
| `openEncounter` (`game-runtime.ts:86`) | `roll_initiative` (establishes `turn-order`) | **D** |
| Initiative + roll (`combat/start.ts:96`) | `roll_initiative`; measured: emits `roll-recorded` per combatant with `natural`, `total`, `contributions` (e.g. `Alert +2`), then `rolls-issued`, then `combat-started` | **D** |
| Assigned tiebreaks, player wins ties (`start.ts:112-114,142,173`) | engine ranks its own rolls | **C** |
| Surprise = acts last (`start.ts:195-198`) | `roll_initiative.combatants[].surprised` → disadvantage, per SRD | **C** (engine is correct) |
| "Ambush on a Stealth success" (`mock-game-runtime.ts:200-204`) | nothing; Hide is an engine verb | **C** |
| Attack roll (`run.ts:259`) | `attack {attacker,target,weapon?,action?,thrown,twoHanded,finesseAbility,hold,mastery,onHit}` | **D** |
| Damage + critical (`run.ts:339`, `dice.ts:114`) | folded into `attack`; measured events `damage-dice-recorded` (every die, its `sides`, `rolled`, `value`, `disposition`) + `damage-taken` | **D** — strictly richer |
| Held hit for Shield (`n/a`) | `attack.hold` + `settle_attack` | **N→new** |
| Spell save DC default 13 / attack bonus 0 (`run.ts:649,657`) | `cast_spell` derives both from the sheet | **C** |
| Blast rolled once, halved on save (`run.ts:662-684`) | `cast_spell` + `settle_area_effects` | **D** |
| Death saves as aftermath, resurrection at a temple (`run.ts:936-996`) | engine rolls them at turn start; `stabilise_creature` | **C** (a product decision the engine will refuse) |
| **Ability check + DC** (`mock-game-runtime.ts:395`) | **`ability_check` — DM door only** | **A, and decisive — see §4c** |
| DC chosen by a model, clamped 5–30 (`validate-ruling.ts:168`) | `ability_check.dc` is the DM's to state; the engine supplies modifier, proficiency, Expertise | **D** (same shape, different door) |
| `+0` when the label names no skill (`mock-game-runtime.ts:447`) | engine reads the sheet; an unknown skill is refused | **C** |
| `dodging` / `aiming` strings (`run.ts:451,498`) | `take_action` (Dodge); `apply_condition` / DM `rule_condition` / `end_condition` | **A** |
| Riders carried as prose (`bestiary.ts:46-51`) | engine applies them (`hit-riders.test.ts`) | **D** — deletion |
| Bands `reach|near|far` (`encounter.ts:43,161`) | feet: `set_scene {width,depth,height}`, `add_landmark {name,at:{x,y,z}}`, `place_creature {who,fromLandmark|fromCreature,feet,bearing,elevation}`, `move` | **C** — the UI must learn feet or render feet as bands |
| Half cover as a free boolean (`encounter.ts:416`, `tactics.ts:167`) | `declare_cover` | **C** |
| Opportunity attacks (`run.ts:1101`) | `take_opportunity_attack` / `decline_opportunity` | **D** |
| Reaction windows (`encounter.ts:213`) | `options` reports every open Reaction; `confer_reaction`, `take_damage_reaction`/`decline_damage_reaction`/`settle_damage`, `take_test_reaction`/`decline_test_reaction`, DM `settle_test` | **D** — strictly richer |
| Rests (`combat/rest.ts:75`) | `begin_rest` / `end_rest`, plus `advance_time {rounds,minutes,hours}` out of combat | **A** |
| One Hit Die by fiat (`rest.ts:52-57`) | `end_rest` takes the dice to spend by pool key (`["hit-die:d10", …]`) — the choice is the player's | **C** (engine is correct) |
| Arcane Recovery all-or-nothing (`rest.ts:158-168`) | `regain_uses` / `use_pool_option` | **A** |
| Spell slots (`resources.ts:188`) | engine resources; `cast_spell {slotLevel}` spends | **D** |
| Second Wind (`run.ts:698`) | `heal_with_feature` | **D** |
| **Action Surge** (absent in the mock) | **still shut** — `docs/design/claude-integration.md:78` | **N** in both |
| Channel Divinity (label only, `resources.ts:29`) | `use_pool_option` — Cleric's open, Paladin's not (`claude-integration.md:70-78`) | **A** |
| Surrender as a fourth outcome (`run.ts:762`) | `end_combat`; the offer itself is fiction | **N** |
| Companions (`start.ts:135`) | `add_creature` + `declare_side` | **D** |
| Monster tactics in code (`tactics.ts:147`) | **nothing** — the engine has no AI. Either the model decides each monster's turn (cost), or app code does | **N — the biggest open design question** |
| Morale / `breaksAndRuns` (`tactics.ts:110`) | nothing; fiction | **N** |
| Multiattack = best attack × count (`tactics.ts:161`) | `attack {action}` names a printed line; Multiattack needs composition (owner ruling, 2026-09-20) | **A** |
| `bestFit` an invented creature (`start.ts:84`) | `add_creature {monsterId}` only; `unknown_monster` is refused at `monsterId` | **C** |
| Epithet auto-naming (`start.ts:66-80`) | `add_creature {id,name}` — keep app-side | **A** |
| Trade (`inventory-ruling.ts:30`) | `purchase_item`, `trade_resource`; DM `award_coin`/`take_coin` | **D/A** |
| Item use, equip, attune (`run.ts:175`, `inventory-ruling.ts:158`) | `use_item`, `equip_item`/`unequip_item`, `attune_item`/`end_attunement` | **D** |
| `bestFit`/`parseAttackLine` regex over sheet text (`options.ts:61`) | `sheet` / `observe().creatures[].printed.attacks` report the real lines | **C** — deletion |
| Option chips from the sheet (`options.ts:413`) | `options {who}` + `sheet` | **D** |
| `deriveSheet` (365-item catalogue copy, `src/domain/sheet.ts:219`) | `sheet` tool + `holdings.ts` | **C** — 17,581 lines of `src/content` largely becomes engine content |

### 2.2 Feed and narration concepts → engine

| App concept (file:line) | Engine equivalent | |
|---|---|---|
| `MechanicalResult[]` (`src/domain/resolution.ts:220`) | `OkOutcome.events: GameEvent[]` (`outcome.ts:84`). Measured kinds from one fight: `creature-added`, `character-created`, `items-gained`, `coins-changed`, `item-equipped`, `resource-pool-declared`, `scene-set`, `landmark-added`, `creature-placed`, `creature-side-declared`, `roll-recorded`, `rolls-issued`, `combat-started`, `attack-made`, `damage-dice-recorded`, `damage-taken` | **A** — a projection, as `resolution.ts:19-21` already predicted |
| `AbilityCheckResult {natural, modifier, total, dc, outcome}` | `roll-recorded {who,label,natural,total,contributions[],outcome}` — `contributions` is *sourced*, so the plaque can say **why** (`Alert +2`) instead of one flat `modifier` | **A** — upgrade |
| `AttackRollResult.rolls` (both d20s) | `roll-recorded` + `rolls-issued`; `damage-dice-recorded.components[].dice[].disposition` says which die counted and why it was replaced | **A** — upgrade |
| `DamageResult.targetState: Vitality` | derive from `observe().creatures[].hp/hpMax` | **A** |
| `establishedFacts: string[]` (`resolution.ts:362`) | **nothing** — the engine has no prose facts | **N** — stays app-side |
| `WorldUpdate.encounter/hitPoints/resources/items/goldPieces` (`resolution.ts:286-334`) | `observe()` — measured keys `round, turnOf, initiativeOrder, elapsedSeconds, scene, creatures, owed`; plus `sheet` | **A** — read, never stored |
| `WorldUpdate.scene/entities/hooks` | **nothing** — fiction | **N** — stays app-side |
| `continues` (bonus action handed back, `resolution.ts:376`) | `observe().creatures[].budget {action,bonusAction,reaction}` | **A** |
| `Turn.canon` (`src/domain/canon.ts:43`) | **nothing** — fiction | **N** — stays app-side, unchanged |
| `NARRATOR_TOOLS` `createNPC`/`createQuest`/`lookup` (`tools.ts:64`) | **nothing** — the engine holds no catalogue of people, jobs or hooks | **N** — keep exactly as they are |
| `findTreasure` (`tools.ts:98`) | partly: DM `award_items {items[]}` + `award_coin` put the result **in the engine**; the *roll* (which item, how many coins) stays app content | **A** — the app rolls the table, the engine records the gain |
| `turnId` as idempotency key (`game-runtime.ts:18-22`) | `ToolCall.commandId`, *"the transport's `tool_use.id`"*, explicitly not a caller-chosen field (`dispatch.ts:33-42`) | **A** — one turn is now N commands, so one key becomes N |
| `Provenance` (`src/domain/provenance.ts:12`) | events carry `command {id, fingerprint}` (measured) | **A** — better |
| `GameRuntimeError` thrown (`game-runtime.ts:89`) | **never thrown** — four outcomes as values (`outcome.ts:1-24`) | **C** — the adapter must stop throwing |
| `validateTurnResolution` (`src/runtime/validate-resolution.ts:640`) | unnecessary: `ok` carries events the engine wrote | **N** — delete |
| The referee's `Ruling` JSON (`scene-author.ts:49`) | the model calling `ability_check {who, ability, skill, dc}` directly | **A** — the referee *becomes* one tool call |

### 2.3 The four outcomes, measured

From `node_modules/.audit/fight3.ts`, all four occur naturally in ten calls:

- `ok` — `attack → +5 events, {"hit":true,"natural":10,"total":15,"critical":false,"damageDealt":12}`
- `refused` — `out_of_reach: "Greatsword reaches 5 feet; gob is 25 away"`;
  `spell_not_available`; `dead: "gob is dead and swings at nothing"`
- `needs-context` — `unknown_creature`, carrying
  `establish: [{kind:"creature", subject:"hero", need:"a record for hero",
  because:"the command names a creature the engine has never been told about",
  satisfyWith:"an addCreature command for hero", tools:["add_creature","create_character","summon_creature"]}]`
- `invalid` — `malformed_arguments: "move was sent arguments it cannot read: a placement needs
  exactly one of fromLandmark or fromCreature"`

---

## 3. Importability

### 3.1 What is already true

**Infinite Realms already imports the engine** — in three generator scripts, by deep relative
path into `dist`:

- `scripts/pregens/generate.mjs:29,46,47` — `../../../ImpossibilityEngine/packages/{content,engine,shared}/dist/index.js`
- `scripts/bestiary/generate.mjs:107` — `pathToFileURL(join(ENGINE,'packages','content','dist','index.js'))`
- `scripts/catalogue/generate.mjs:29` — same for `content` and `srd`

These are build-time only; nothing the product ships imports them (`pregens/generate.mjs:11`).
Their output is committed, so a clone without the engine builds and plays
(`README.md:74-76`, ADR 0004).

**I verified that the runtime import works too.** From
`InfiniteRealms/node_modules/.audit/import-probe.mts`:

```
OK: deep relative import of @ie/tools dist works from InfiniteRealms
player tools: 69 · dm tools: 82 · exports on the barrel: 41
bare @ie/tools -> FAILS: Cannot find package '@ie/tools'
```

It works because the engine's own `node_modules/@ie/*` symlinks exist
(`npm install` at the engine root, workspaces `packages/*`), so Node resolves `@ie/engine` and
`zod` from the *imported file's* directory upward — never from Infinite Realms' tree.

### 3.2 Constraints, measured

| Constraint | Reality |
|---|---|
| `main` points at `dist` | Yes, all five packages; `dist/` is gitignored (`.gitignore:2`) and built by `tsc -b` (each package's `build` script) |
| No `prepare` script | Correct — `npm install` in Infinite Realms would **not** build them |
| `private: true` | All five. `file:` deps ignore `private`, so this is not a blocker for a local path dep; it *is* a blocker for ever publishing |
| ESM | `"type": "module"`, `module: NodeNext`, `target: ES2023`, `lib: ["ES2023"]`, `types:["node"]` (root `tsconfig.json`). Server-only by construction — no DOM |
| Node | Engine requires `^22.13.0 \|\| >=24`; Infinite Realms' README requires the same (`README.md:22`); installed v24.18.0. **Aligned** |
| Next 16.3.5 | Both `transpilePackages` (`config-shared.d.ts:1503`) and `serverExternalPackages` (`:1588`) exist. Since `dist` is already plain ESM JS, `transpilePackages` is unnecessary; `serverExternalPackages` is the right knob if the bundler misbehaves |
| tsconfig `paths` | Infinite Realms has only `@/* → ./src/*` (`tsconfig.json:22-24`) and `moduleResolution: "bundler"` — so a `paths` entry could point `@ie/*` at the sibling `dist` for types |

### 3.3 The options

**(a) `file:../ImpossibilityEngine/packages/tools` dependency.** npm creates a symlink. Node
resolves the target's own `@ie/*` and `zod` from the *real* path, so it works — but only while
the engine's `node_modules` exists and `dist` is current. Next's bundler follows symlinks by
default and would try to trace `@ie/engine` out of the symlink target; `serverExternalPackages:
['@ie/tools','@ie/engine','@ie/content','@ie/shared']` makes that a non-question by leaving them
as runtime `require`s. **Cost: a stale-`dist` failure mode with no error message that says so, and
a deployment that has to ship a second repo.** (The Vercel/serverless story is genuinely bad:
`serverExternalPackages` means the files must exist at runtime, and they live outside the project
root.)

**(b) Move Infinite Realms into the engine repo as `apps/infinite-realms`.** The workspace glob
`apps/*` is **already declared** (`ImpossibilityEngine/package.json:12`) and currently matches
nothing. Then `@ie/tools` is an ordinary workspace dependency, `npm install` links it, `tsc -b`
builds it, one `npm test` covers both, and there is one Node version, one lockfile, one CI.

**(c) Publish the packages to a registry.** They are `private: true` and versioned `0.0.0`. This
is real work (versioning policy, a release process, five packages) for a two-repo, one-owner
project, and it buys nothing until there is a second consumer.

### 3.4 Recommendation: **(b), move Infinite Realms into `apps/infinite-realms`**

The `apps/*` glob exists and is empty; someone already decided this. The concrete cost is the
one thing that makes it non-trivial, and it is worth naming precisely:

**Steps.**

1. `git subtree add --prefix=apps/infinite-realms <path-to-IR> main` (or a plain move plus a
   preserved history import) — Infinite Realms' 300-odd commits are worth keeping.
2. Delete `apps/infinite-realms/package-lock.json`; add `zod` and `next`/`react` to that
   package's own deps; run `npm install` at the engine root once.
3. Add `{ "path": "../../packages/tools" }` to `apps/infinite-realms/tsconfig.json` `references`,
   and keep `noEmit` — but note the engine's base tsconfig sets `exactOptionalPropertyTypes` and
   `verbatimModuleSyntax`, which Infinite Realms' does not. **Do not** extend the engine's base;
   keep the app's own tsconfig and let project references handle the types.
4. Rewrite the three generator scripts' deep `dist` paths to bare `@ie/content` / `@ie/engine` /
   `@ie/shared` — they get simpler, not harder.
5. Root `npm test` must not run Infinite Realms' jsdom suite by default (its 84 environments cost
   38 s). Give Infinite Realms its own `vitest.config.mts` project and a separate script.
6. Keep `apps/*` out of the engine's ESLint purity rules — the app is allowed `Math.random` and
   `Date.now`; the engine is not.

**What it costs.**

- **CLAUDE.md's dependency rule needs one sentence added.** Today it says content depends on
  engine and engine imports nothing; it does not describe `apps/*`. The rule to write is:
  *apps depend on `@ie/tools` and on nothing under `packages/engine/src`*, with a sweep to hold it.
- **The engine's `npm run coverage` / `COVERAGE.md` discipline** (CLAUDE.md, "Numbers live in
  COVERAGE.md") now has a second source of diffs in the tree. Exclude `apps/**` from it explicitly.
- **Two release cadences in one repo.** A rules change and a UI change land in the same history.
  For one owner this is a feature; say so out loud so it is not rediscovered as a problem.
- **Node 22.13 floor becomes binding on the app**, which currently has no `engines` field.

The alternative (a) is cheaper this week and more expensive every week after. Given that the
generator scripts have *already* been living with the "build the sibling first" failure mode and
the README has to explain it twice (`README.md:73-76`, `:377-378`), I would not choose to have a
third instance of it in the hot path.

---

## 4. The adapter design, concretely

Sizes are estimates, marked as such. Everything else is measured.

### 4a. The campaign store

**`src/persistence/engine-campaign.ts`** (~150 lines, est.) — the seed + content-ref + log record,
and its fold.

```ts
interface EngineCampaignRecord {
  readonly seed: string;            // Campaign.seed
  readonly contentRef: 'srd-5.2.1'; // which book; homebrew later
  readonly log: readonly GameEvent[];
  readonly cast: Record<string, CharacterId>;  // app name -> engine id
}
function openEngineCampaign(record): Campaign   // createCampaign + append(log)
function recordOf(campaign: Campaign): EngineCampaignRecord
```

**This works today, and I verified it.** From `node_modules/.audit/restore.ts`:

```
log JSON bytes: 1755 · round-trip identical: true
restore via createCampaign+append -> state identical: true
fold(seed, log) === live state: true
same next roll after restore: true
```

Three facts that make it work and one that needs a decision:

- `GameEvent`s are plain JSON. `JSON.parse(JSON.stringify(log))` is byte-identical.
- `Campaign.append(events)` folds with `applyEvent` (`packages/tools/src/campaign.ts:94-99`), and
  `fold(seed, log)` gives the same state (`packages/engine/src/fold/apply.ts:554-560`).
- `supply()` rebuilds the RNG from `state.rng` (`campaign.ts:87-93`), so a restored campaign
  throws the next die the live one would have.
- **The decision**: `campaign.append` documents *"exactly two call sites, both in
  definitions.ts"*, and `boundary.test.ts:819-830` counts them — but the sweep is
  package-internal (`expect(text).not.toContain('.append(')` over files in `@ie/tools`), so an
  app calling `append` is not a breach of that test. It *is* a third caller of a method whose
  comment says there are two. **Ask the engine for `restoreCampaign({content, seed, log})`** —
  a five-line addition to `campaign.ts` that closes the question and matches the design note's
  own open item: *"Out of scope until decided: persisting the log"*
  (`docs/design/claude-integration.md:174-175`). Until then, `createCampaign` + `append` is
  correct but undocumented.

**`src/persistence/campaign-repository.ts`** gains the record; the Supabase implementation becomes
two columns (`seed text`, `log jsonb`) plus the narrative document. Measured: 21 events for one
character, one goblin, one scene, one round = **8,618 JSON bytes**. A four-round fight is on the
order of 150 events (the engine's own probe wrote 151 for four actors over three rounds,
`tools/llm-probe/runs/tier2-ogre.md:3`). A long campaign's log will outgrow a single `jsonb`
column; plan an append-only `events` table with a sequence, and keep the fold in the app. *Inferred.*

### 4b. The OpenAI tool loop

**`src/engine/tool-schemas.ts`** (~60 lines, est.). There is no JSON-Schema emitter in
`@ie/tools` — `ToolDefinition.schema` is a raw `z.ZodType`
(`packages/tools/src/definitions.ts:294-295`) with the comment *"for a caller that wants to
publish it as JSON Schema"*. **`z.toJSONSchema` works** — I converted all 69 and all 82 without a
single failure. Two gotchas measured:

- It emits `"$schema": "https://json-schema.org/draft/2020-12/schema"` on every tool. Strip it.
- `z.int()` becomes `{"type":"integer","minimum":-9007199254740991,"maximum":9007199254740991}`.
  Harmless but it costs tokens; consider stripping the safe-integer bounds.
- Use `{ io: 'input', unrepresentable: 'any' }`. Emit the list **in the surface's own order**
  (`Surface.tools` is *"the stable sorted order the prompt cache depends on"*,
  `dispatch.ts:46`) — reordering it on any turn throws away the cache.

**`src/engine/engine-session.ts`** (~250 lines, est.) — the loop.

```
player types → one model request with:
  system: frozen persona + DM directives  (cached prefix)
  messages: [...history, {role:'system', content: JSON.stringify(observe())}, {role:'user', ...}]
  tools:   the 69 (or 82) function definitions, stable order
→ model emits function_call(s)
→ for each: surface.call({ tool, input, commandId: call.call_id })
→ send back function_call_output with the outcome
→ repeat until the model writes prose instead of calling
```

Handling the four outcomes:

- **`ok`** — send back `{status:'ok', resolution, events, unverified}`. The **resolution** is what
  the model narrates from; the **events** go to the feed. Do not paraphrase.
- **`needs-context`** — send back `{status:'needs-context', reason, establish:[...]}` verbatim.
  `establish[].tools` already names the doors on *this* surface (`outcome.ts:64-72`,
  derived from the definitions, never written twice). The protocol is: the model calls the named
  tool, then **re-sends its original call with the same `commandId`** — because a
  `needs-context` spent nothing and threw no die (`claude-integration.md:52-57`). Do **not**
  retry it in the adapter; the transcript must show the decision. The engine's own probe reports
  a model doing this correctly unprompted, three times across two requests
  (`tools/llm-probe/README.md`, "Smaller findings").
- **`refused`** — send back `{status:'refused', code, reason}` and show it in the feed as a
  mechanical line ("Greatsword reaches 5 feet; gob is 25 away"). A refusal is information the
  player should see, not an error to swallow. **Never** convert it to prose the model invents.
- **`invalid`** — send back `{status:'invalid', reason, issues:[{path,message}]}`. This is the
  outcome a three-valued surface loses, and the reason it exists is exactly this loop
  (`outcome.ts:14-20`): a model told "the rules said no" to a typo goes looking for a rule to
  work around. Do **not** show `invalid` in the player's feed; log it and let the model fix it.

**Idempotency**: `commandId = call.call_id`, per `dispatch.ts:33-42`. Verified: two calls with
`commandId: 'toolu_ABC'` returned **byte-identical outcomes** and appended events once
(log length unchanged on the replay).

**Narration**: unchanged in shape from today. The model narrates in the same turn, after its
tool calls, from `resolution` and `events` and nothing else. The one rule to carry over verbatim
is the app's own: *"Everything shown comes from the resolution as given; nothing is computed
here"* (`MechanicalResultCard.tsx:17`) — applied now to the model's prose as well as the UI's
pixels.

**`src/engine/turn-transcript.ts`** (~80 lines, est.) — the per-turn record of
`{call, outcome}[]`, persisted beside the events. This is what makes a turn replayable and a bug
answerable; the engine's probe calls transcript re-dispatch *"the determinism criterion"*
(`claude-integration.md:57`).

### 4c. Which surface the model holds — **the DM's**

This is the question with a measured answer, and it is not close.

**The player's door has no `ability_check` and no `saving_throw`.** Both are DM-only. The whole
core loop of Infinite Realms — the player types something, the referee picks a skill and a DC,
the game rolls it — **cannot be expressed on `createSurface` at all**. Today that loop is
`mock-game-runtime.adjudicate` (`mock-game-runtime.ts:395-432`) driven by a model-chosen DC
(`scene-author.ts:35-40`), and it is the single most-used path in the app.

Six more DM-only tools the app needs by the end of its first month:
`rule_condition` and `end_condition` (Prone after a fall — the app already carries riders it
cannot apply, `bestiary.ts:46-51`); `improvised_damage` / `roll_improvised_damage` (the falling
chandelier — the app's improvised-action path, `run.ts:1226`); `award_coin` / `award_items` /
`take_coin` (the treasure the narrator's dice already roll, `tools.ts:98`);
`take_printed_action` / `take_printed_bonus_action` (the goblin's Nimble Escape — measured as
present on the Goblin Warrior's block via `observe()`).

So: **`createDmSurface`, and the model holds it.** The engine's own note anticipates this exactly
— *"a model running the table holds the DM's door as a human does"* (CLAUDE.md, `@ie/tools` row),
and *"What must never happen is one caller holding both"* (`dm/surface.ts:16-19`). One caller,
one door, and it is the DM's.

**What replaces the human's judgement.** The DM's door is defined by what the *rules leave open*
— a DC, a span, a head count, an amount of improvised damage — and a human's restraint is what
normally keeps those honest. Four guards, in the order they are worth building:

1. **A DC band, enforced in the adapter, not the prompt.** The app already has one: the referee's
   brief says 10/12/14/16/18 (`authoring-brief.ts:42`) and `validate-ruling.ts:168` **clamps to
   5–30**. Keep the clamp; it now sits in front of `ability_check.dc`. A clamp survives a model
   that ignores a sentence; a sentence does not.
2. **A budget on the open-ended tools, per turn.** At most one `improvised_damage` /
   `roll_improvised_damage` per turn, and a hard cap on its dice. A model that can deal arbitrary
   damage with no attack roll can kill a player by narration, which is the failure the whole
   product exists to prevent — and the app has already been bitten once by exactly this class of
   bug (`validate-ruling.ts:59-71`: a model wrote "regains 1 hit point" and the player's sheet
   stayed at zero).
3. **Coin and items behind the existing table.** `award_coin` / `award_items` should only ever be
   called by the adapter, downstream of `findTreasure`'s roll (`tools.ts:174`) — never exposed to
   the model directly. Partition the DM surface by *who calls it*, since the engine cannot
   partition it further: the model gets the list minus those; the adapter calls them.
4. **The transcript is the audit.** Every DM-authority call recorded with its arguments, visible
   on `/dev/maestro`. The app already shows per-turn telemetry there (`README.md:322-326`); this
   is one more table.

Guards 2 and 3 mean the app holds a **filtered** DM surface. The engine does not offer a filtered
factory (`createDispatch` is deliberately unpublished, `dispatch.ts:6-13`, and
`index.ts:32-34` says a published builder over an arbitrary list *"would be exactly the flag this
design exists instead of"*). So the filter is the app's: build the DM surface, and emit function
definitions for a subset. That is honest — the model is never *told about* the tools the adapter
reserves, but it holds a surface that can reach them, and the transcript is what proves it did
not. **If that is not good enough, the ask on the engine is a third door.** I would not ask yet:
one door and an audited transcript is the cheaper correct answer for a single-player app.

### 4d. The feed

**`src/engine/event-view.ts`** (~200 lines, est.) — `GameEvent[] → FeedLine[]`. This is the one
module where the mock's best work survives wholesale. Measured mapping:

| Event | Feed line |
|---|---|
| `roll-recorded {who,label,natural,total,contributions[],outcome}` | the d20 plaque. **`contributions` is sourced** — `[{source:'modifier',amount:1},{source:'Alert',amount:2}]` — so the line can read `16 + 1 + 2 (Alert) = 19` where today it reads `16 + 3 = 19` (`MechanicalResultCard.tsx:167-170`) |
| `rolls-issued {count,rng}` | nothing visible; the provenance anchor |
| `damage-dice-recorded {components[].dice[]}` | the damage line, face by face. Each die carries `sides`, `rolled`, `value`, `disposition` ('counted'), `origin`, `cause`, `replaces` — which is exactly what `CombatPlaque.tsx:228-252` renders, plus the *reason* a die was replaced (Great Weapon Fighting's `treatLowRollsAs` shows as `rolled:1, value:3`, measured) |
| `damage-taken {id,amount,source,by}` | the "takes 12" line |
| `attack-made`, `combat-started`, `creature-placed`, `scene-set`, `item-equipped`, `coins-changed`, `resource-pool-declared` | bookkeeping; mostly silent, some become chips |

`Vitality` buckets (`encounter.ts:46`) are derived from `observe().creatures[].hp/hpMax` — keep
the bucket, keep the rule that only the protagonist sees a number
(`resolution.ts:166-170`), which is a genuinely good product decision the engine has no opinion
about.

**Withhold-until-settled stays.** `TurnBlock.tsx:37-40` already gates narration on the dice
animation; with the engine the gate becomes "all of this turn's events have been rendered".

### 4e. The mock's remaining role

**A test double for the pipeline, and then deletion.** Concretely:

- `src/runtime/mock/` — **delete**, as ADR 0005 already promises (`0005-combat.md:405-416`,
  `README.md:288-290`: *"this folder and the mock are deleted together and the ruling becomes
  arithmetic"*). **8,238 lines.**
- `src/runtime/mock/development/` (the referee — **2,577 lines**, 1,711 of them not tests) —
  **delete**. It becomes `ability_check`. Its *validator* does not: `claimsHitPoints`
  (`validate-ruling.ts:79`) and the DC clamp (`:168`) move in front of the DM tools (§4c).
- `src/runtime/validate-resolution.ts` (**661 lines**) — **delete**. It exists to police a
  runtime that could lie; `ok` carries the events the engine wrote.
- `src/domain/sheet.ts` (**277 lines**, `deriveSheet`, an engine-copy) and most of
  `src/domain/encounter.ts` (**615 lines**) — **delete**; replaced by `sheet` and `observe`.
- **Keep, as a fixture**: a hand-written `Surface`-shaped stub returning canned `ToolOutcome`s,
  so `turn-pipeline.test.ts` and the UI tests do not need the engine. ~150 lines, est. That is a
  test double, not a second rules implementation, and the difference is that it holds no
  arithmetic.

---

## 5. Suggestions, ranked

### Keep

1. **The four narrator tools and the tool loop** (`src/narration/tools.ts`,
   `openai-narration-provider.ts:384-423`). They are the engine's own `createNPC`-shaped world:
   things the engine deliberately does not hold. CLAUDE.md invariant 4 — *"The engine holds no
   catalogue"* — means the engine will **never** name an NPC or roll a job. Keep them; they are
   the half of the product the engine does not touch.
2. **The mechanical-truth-then-narration ordering and the plaque.** `TurnBlock.tsx:34-74` and
   `CombatPlaque.tsx` are better than what the engine's probe produced, because they were built
   from bug reports (`CombatPlaque.tsx:201-221` and `:39-50` both cite the specific misreading
   that motivated them). The engine's events make them *more* accurate, not less needed.
3. **`Turn.canon` and the editor.** `src/domain/canon.ts:9-25` draws the same line the engine
   draws: *"he staggers back"* is canon, *"he is prone"* is a ruling. With the engine that line
   becomes checkable rather than argued: anything mechanical in the record is a bug, because the
   engine wrote the mechanics.
4. **The turn stream, the two-save pipeline, and `turnId` idempotency.** They already implement
   the discipline the engine's `commandId` needs, one level up.
5. **`src/content/pregens.generated.ts`** as *choices*. The four builds in
   `scripts/pregens/builds.mjs:38-73` are already exactly the shape `create_character.choices`
   wants — I confirmed by feeding the Fighter build straight to the engine: `ok, +9 events,
   {"created":"hero","name":"Bram"}`. The derived *sheet* becomes surplus; the *choices* become
   the creation call.

### Replace

6. **`MockGameRuntime` with the engine.** Everything in §2.1 marked **C** is a rule the engine
   will compute differently, and every one of them is currently visible to a player.
7. **The referee with `ability_check`.** One model call per turn at `temperature: 0.5`
   (`llm-scene-author.ts:220`) that picks a DC and a skill, with a JSON grammar and a validator,
   becomes one tool call the engine answers. This is the single largest simplification available:
   `authoring-brief.ts` (442 lines, mostly prompt), `llm-scene-author.ts` (348),
   `validate-ruling.ts` (367) and the rest of `src/runtime/mock/development/` — **2,577 lines**
   — plus `scenarios.ts` (338) and five `DEV_SCENE_AUTHOR*` / `LM_STUDIO_*` environment
   variables, all collapse into a tool name.
8. **Bands with feet.** `BAND_FEET = {reach:5, near:30, far:60}` (`encounter.ts:161`) becomes
   `set_scene` + `place_creature` + `move`. The UI can keep rendering bands — derive them from
   `observe().creatures[].feetTo` — but the *truth* must be feet, or `out_of_reach` will refuse
   things the chips offered. That refusal is the first thing a player will meet, and the app's
   own doctrine is that a chip *"can never ask for something the game will refuse"*
   (`README.md:118-120`).
9. **Spell slots and resources.** `src/domain/resources.ts` (heuristics standing in for player
   choice, admitted at `:178-187`, `:210-217`, `:266-274`) becomes `sheet` + `cast_spell` +
   `end_rest`'s hit-dice list. The engine gives the choice back to the player, which is what those
   three comments all wish they could do.

### Delete

10. `src/runtime/mock/**` (**8,238 lines**), `src/runtime/validate-resolution.ts` (**661**),
    `src/domain/sheet.ts`'s engine-copy (**277**; `:144`, `:219`, `:269` are the engine's
    `proficientWith` / `armorClassCalculation` / edge logic, copied per ADR 0007), and the
    band/cover/vitality arithmetic in `src/domain/encounter.ts`. Net: **on the order of 10,000
    lines deleted** (8,238 + 661 + 277 + most of 615). *The exact figure depends on how much of
    `encounter.ts` the UI still needs for rendering.*
11. **The `bestFit` unknown-creature path** (`src/content/bestiary.ts:131-161`,
    `start.ts:84`). `add_creature` takes a `monsterId` and nothing else, and refuses
    `unknown_monster` at that field, *on purpose*: *"an entry point that accepts a stat block is
    the door a model-authored Armour Class walks through"* (`claude-integration.md:126-131`).
    The app's own README says the same thing better (*"The DM invents the world; it does not
    invent an armour class"*, `README.md:190`) — but `bestFit` is how it currently cheats. With
    the engine, a bog-ratter must be *named* as a goblin, in the fiction, by the model; the engine
    will not be told a made-up name.

### Risks

12. **Mock vocabulary leaking into the UI — already happening.** `Band`, `Vitality`,
    `CombatOption`, `PendingDecision`, `TurnBudget` are imported directly by the React tree
    (`CombatPlaque.tsx`, `src/ui/adventure/*`). None survives the port unchanged. **Mitigation:
    define a `FeedLine` / `SceneView` type in `src/engine/event-view.ts` that the UI reads, and
    let nothing in `src/ui` import from `src/domain/encounter.ts` again.** Do this *before* the
    adapter, on the mock, as a refactor with the tests green — it is the one piece of work that
    is cheaper now than later.
13. **Mechanics the engine will contradict, in front of a player.** Ranked by how visible:
    the player no longer wins initiative ties; death is death rather than a temple resurrection;
    a short rest asks which Hit Dice; Arcane Recovery asks which slots; a `+0` check becomes a
    real ability modifier; conditions actually apply, so a Prone goblin is now at disadvantage.
    Each is an improvement and each is a change to a saved campaign's meaning. **The eight
    `.data/campaigns/*.json` documents will not migrate** — they hold no event log, and the
    engine cannot derive one. Decide now whether release one starts everyone fresh. *I recommend
    yes, and saying so.*
14. **Prompt size.** Measured: **~20,100 tokens** of tool definitions on the player's door,
    **~23,700** on the DM's — sent on every model request. With OpenAI's `prompt_cache_key`
    (already wired, `openai-narration-provider.ts:248`) and the stable tool order
    (`dispatch.ts:46`), the engine's probe measured **~90% cached**
    (`tools/llm-probe/README.md:262`). The risk is not the number; it is the two ways to lose the
    cache: reordering the tools, or putting per-turn state in the top-level `system`. The design
    note names both (`claude-integration.md:17-23`) and says an integration test should assert
    `cache_read_input_tokens > 0` on turn 2+ *"because that failure is silent and expensive"*.
    **Write that test.** A second lever, if it is still too large: the DM surface's 82 tools
    include a long tail nothing in a solo alpha needs (`mount`, `dismount`, `declare_heads`,
    `summon_creature`, `advance_character`, `multiclass` inside `create_character`); filtering to
    ~45 tools would cut roughly a third of the definition tokens. Measure before cutting.
15. **Cost per turn.** The engine's probe measured **$0.0309 per completed actor turn** and
    **$0.1160 per combat round** on `gpt-5.5` at $1.25 / $0.13 / $10.00 per M tokens
    (`tools/llm-probe/runs/tier2-ogre.md:53-63`) — and the file itself says *"That rate is an
    input to this report, not a fact it discovered"*. Infinite Realms' own price list for
    `gpt-5.6-luna` is **$0.20 / $0.02 / $1.20** (`src/narration/pricing.ts:23`), i.e. 0.16× input,
    0.154× cached, 0.12× output. **Rescaled: ~$0.005 per actor turn, ~$0.018 per combat round.**
    *That is arithmetic on the probe's token counts, not a new measurement.* The real risk is the
    shape, not the level: prompt tokens grew **linearly at ~9,542 per beat**
    (`tier2-ogre.md:50-56`), from 10.5k on beat 1 to 226k on beat 14, because the whole transcript
    is resent. A solo app with one player and one monster halves the actor count immediately; a
    context-window policy is still owed, and **`observe()` replacing transcript history is the
    lever** — the engine's state is authoritative, so old tool results are redundant.
16. **A second implementation creeping back.** The strongest single guard is the one the engine
    already uses: a sweep test. Add `src/engine/boundary.test.ts` asserting that no file under
    `src/ui/**` or `src/application/**` imports from `src/domain/encounter.ts` or names a die,
    a DC, an AC or a hit-point arithmetic. The engine's own `spell-schema.test.ts` sweep is the
    pattern; its breach record is empty and the machinery stays (CLAUDE.md).
17. **No auth, and a server-global active campaign** (§1.9). One player per campaign for release
    one does not mean one player per *server*. This must be fixed with Supabase, not after it.

---

## 6. A first integration milestone

**The slice: one character, one goblin, one room, one round, through the real engine, with the
model narrating the events.** No campaign document, no canon, no quests, no treasure, no UI —
a script plus one route. **I have already run the engine half of it**
(`ImpossibilityEngine/node_modules/.audit/fight3.ts`), and it works:

```
[c1]  create_character  -> ok  +9ev  {"created":"hero","name":"Bram"}
[c2]  add_creature      -> ok  +2ev  {"added":"gob","monsterId":"goblin-warrior",
                                      "armed":["leather-armor","scimitar","shield","shortbow"]}
[c3]  set_scene         -> ok  +1ev
[c4]  add_landmark      -> ok  +1ev
[c5]  place_creature    -> ok  +1ev   (hero, 5 ft from the door)
[c6]  place_creature    -> ok  +1ev   (gob, 25 ft from hero, bearing 90)
[c7]  declare_side      -> ok  +1ev   (party)
[c8]  declare_side      -> ok  +1ev   (goblins)
[c9]  roll_initiative   -> ok  +4ev  {"began":true}   observe: round 1, turnOf hero, order [hero,gob]
[c15] move              -> ok  +2ev
[SWING] attack          -> ok  +5ev  {"hit":true,"natural":10,"total":15,"damageDealt":12}
[c17] end_turn          -> ok  +1ev   observe: turnOf gob
[GOB] attack            -> refused  dead: "gob is dead and swings at nothing"
```

21 events, 8,618 JSON bytes, and replaying the identical calls under the same seed produced a
**byte-identical log**. Three things it also proved: `create_character` on the player's door
**refuses** a level-3 character without an explicit `dmGrants` (`missing_dm_grants`) — the
`ALPHA_GRANT` in `scripts/pregens/builds.mjs:25-28` is already exactly the right value; a replayed
`commandId` returns an identical outcome and writes nothing; and `attack` emits
`roll-recorded` + `damage-dice-recorded` with per-die `rolled`/`value`/`disposition`, which is
everything `CombatPlaque` draws.

### The ordered steps

1. **Decide the repo layout** (§3.4) and move Infinite Realms to `apps/infinite-realms`. Nothing
   else can start until `import { createDmSurface } from '@ie/tools'` resolves in a Next server
   file. *Half a day.*
2. **Refactor the UI off mock vocabulary, on the mock, with the tests green.** Introduce
   `FeedLine` and make `src/ui/**` stop importing `src/domain/encounter.ts`. This is risk 12, it
   is the only step that is cheaper before the adapter than after, and it ships nothing.
   *One to two days.*
3. **`src/engine/tool-schemas.ts`**: emit the DM surface's definitions via `z.toJSONSchema`,
   strip `$schema` and the safe-integer bounds, preserve order. Add a test asserting the count
   and the byte-length so a change to the engine's surface shows up as a diff, not a surprise.
   *Half a day.*
4. **`src/engine/engine-session.ts`**: the loop of §4b, with all four outcomes and
   `commandId = call.call_id`. Test it against the scripted-outcome double first — no network.
   *One to two days.*
5. **`src/engine/scene-setup.ts`**: `create_character` from a `builds.mjs` entry (with
   `ALPHA_GRANT`), `add_creature`, `set_scene`, `add_landmark`, `place_creature ×2`,
   `declare_side ×2` — in code, not by the model. This is exactly steps c1–c8 above, and it is
   what makes the *model's* first turn cheap: the engine's probe measured a thin fixture costing
   **11 calls on the first beat against 3**, all four `needs-context` requests being for facts
   *"a scene-setup discipline could have established before anybody acted"*
   (`tools/llm-probe/README.md:189-203`). **Do the setup in code.** *Half a day.*
6. **`src/engine/event-view.ts`**: render `roll-recorded`, `damage-dice-recorded` and
   `damage-taken` into the existing `CombatPlaque`. *One day.*
7. **A script, `npm run engine:smoke`** — the analogue of `combat:smoke`
   (`scripts/combat-smoke.ts`), offline, no model: run steps 5 + a scripted attack + `end_turn`,
   print every event and every outcome. This is the regression test for everything above and it
   costs nothing to run. *Half a day.*
8. **One live turn.** `GAME_RUNTIME=impossibility-engine` (`src/server/env.ts:97-100` already
   reserves the name) on one hard-coded campaign: the player types *"I swing at the goblin"*, the
   model calls `move` and `attack`, the feed shows the plaque, the model narrates the 12 slashing
   damage. Assert `cache_read_input_tokens > 0` on the second turn (risk 14). *One day.*

**Not in the milestone, deliberately**: persistence of the log, Supabase, auth, the campaign
document, canon, quests, treasure, the opening pipeline, the editor, monster turns taken by the
model, and every screen but Adventure. Each is a separate slice, and every one of them is easier
once a single die has been thrown by the real engine and drawn on the real plaque.

### The one thing to ask the engine for

`restoreCampaign({ content, seed, log })` in `packages/tools/src/campaign.ts` — five lines beside
`createCampaign`, closing the open item the design note already lists
(`claude-integration.md:174-175`). It costs the engine nothing, it removes the app's only
undocumented reach into `Campaign.append`, and without it the *next* milestone — persistence —
starts with a discussion instead of a call.
