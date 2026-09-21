# Nimbus Quill against the engine, 2026-09-21

> A read-only assessment taken for `docs/ROADMAP.md` §7 (tracks I-N1 to I-N4 and I-E7). Line numbers are as of nimbus_quill `722ecd9` and engine `f163717`.

# Nimbus Quill, assessed against the Impossibility Engine

Read-only assessment, 2026-09-21. Nothing in either repo was modified. Measurements are
from the working checkouts at `C:\Users\justi\Code\QuestBarrel\nimbus_quill`
(HEAD `722ecd9`, clean) and `C:\Users\justi\Code\QuestBarrel\ImpossibilityEngine`
(HEAD `f163717`, clean). Counts are as of those commits and will drift.

---

## 1. What it is today

### Size and health

| | |
|---|---|
| Source files under `src/` | 173 (112 `.ts`, 60 `.tsx`, 1 `.css`) |
| Non-test TS/TSX lines | 18,755 |
| Test lines | 13,995 across 69 test files |
| `npx tsc --noEmit` | **exit 0**, no diagnostics |
| `npx vitest run` | **exit 0** — 69 files, 1,426 passed, 1 skipped, 23.5 s |

The one skipped test is the paid classifier eval, opted into by `ANTHROPIC_API_KEY`
(`src/utils/intentEval.test.ts:92`). `node_modules` was present; `whisper.cpp/build`
and `whisper.cpp/models` exist locally. `.vite/build/{main,preload}.js` are built.

Largest non-test files: `src/data/monsterStatblocks.ts` (1,315),
`src/hooks/useGameStateReducer.ts` (1,297), `src/utils/phraseDetector.ts` (878),
`src/main.ts` (808), `src/utils/actualization.ts` (745), `src/utils/combatManager.ts` (741),
`src/utils/stateMachine.ts` (725), `src/App.tsx` (711).

### Structure

Electron Forge + the Vite plugin, three build entries (`forge.config.ts:114-131`):
`src/main.ts`, `src/preload.ts`, `index.html` → renderer.

- **Main** (`src/main.ts`, plus `src/main/ipc/*`) owns Whisper, the models directory,
  campaign files, session export and the crash snapshot. IPC handlers were factored
  out into `src/main/ipc/{modelIpc,sessionIpc,campaignDataIpc,llmIpc}.ts`.
  `src/main/windowSecurity.ts` hardens the window; the packaged renderer is served over
  a custom `app://` scheme rather than `file://` so a real CSP origin exists
  (`src/main.ts:44-97`).
- **Preload** (`src/preload.ts`) exposes seven context-bridge namespaces and nothing
  else: `whisper`, `session`, `llm`, `model`, `party`, `npcs`, `campaigns`,
  `voiceAliases`, `encounters`. Every payload is a plain serialisable shape; no renderer
  object crosses.
- **Renderer** (`src/App.tsx`, `src/components/*`, `src/hooks/*`, `src/utils/*`) holds the
  whole game model: phrase detection, the actualization gate, the state machine, the
  combat overlay, the activity log, the pending queue.

The `.vite/build/main.js` artifact is CommonJS (16 `require(` calls; rolldown runtime
prelude). That matters for §3.

### What Whisper.cpp does in it

Local, offline speech-to-text, and nothing else. `src/utils/whisperServer.ts` (356 lines)
keeps one `whisper-server` process alive with the model resident and POSTs 16 kHz WAV to
`http://127.0.0.1:<port>/inference`; `src/main.ts` spawns it, with `whisper-cli` as a
per-chunk fallback when the server will not start. The header records the measurement
that motivated it: the win came from `--audio-ctx 512`, not from killing the per-call
model load (`src/utils/whisperServer.ts:10-24`). Three flags are load-bearing and asserted
in tests via the pure `buildServerArgs` (`:88`): `-l en`, greedy decoding, no timestamps.

A timeout returns `{status:'overloaded'}`, deliberately distinct from `'failed'`, so a slow
pass does not spawn a second model onto the same CPU — the header records a live session
that dropped 19 chunks to exactly that cascade (`:285-296`).

Models are downloaded on first launch into `userData/models` rather than bundled
(`src/config/models.ts`): `base.en`, `small.en` (default), `medium.en`. Audio is chunked at
pauses (`src/utils/audioChunker.ts`), overlap-deduped (`src/utils/transcriptFilter.ts`),
and the roster is fed back to Whisper as an initial-prompt vocabulary hint
(`src/utils/transcriptionPrompt.ts`, `whisper:setVocabulary`).

### What the Anthropic SDK is used for

**Almost nothing, today.** Two separate LLM paths exist and neither is live in the app:

1. **`src/utils/intentClassifier.ts`** — the real, well-built one. `@anthropic-ai/sdk`
   with `zodOutputFormat` from `@anthropic-ai/sdk/helpers/zod`, calling
   `anthropic.messages.parse({ output_config: { effort: 'low', format: … } })`
   (`:105-117`). Model default `claude-opus-5` (`:87`). The schema is a closed
   `{intents: [{line, kind, target?, actor?, amount?, condition?, item?, count?, confidence}]}`
   over the 10-member `INTENT_KINDS` union (`src/types/intents.ts:18-29`). The system
   prompt (`:47-73`) is written entirely around suppressing over-triggering — "Prefer
   `none`". Hallucinated line indices are filtered (`:125`).
   **Its only importer is the opt-in eval test** (`src/utils/intentEval.test.ts:96`).
   Nothing in the running app calls it. Its pure renderer-side counterpart
   `src/utils/intentToEvent.ts` maps a `ClassifiedIntent` to a `GameEvent` and is likewise
   only exercised by tests.
2. **`src/main/ipc/llmIpc.ts`** — an older, hand-rolled `fetch` against three providers
   (Anthropic `claude-haiku-4-5` by default, `src/config/constants.ts:225`) that extracts
   NPCs/items/locations from transcript lines. Its own header says it plainly:
   "Nothing in the app calls `llm:enrich` at present: its results were never applied, so
   every call sent transcript text off the machine for nothing" (`:16-18`). Disabled by
   default; enabled only by an API key in main's environment.

So **the live pipeline is 100 % deterministic and local**: regex phrase rules → a safety
gate → a reducer. That is a much better starting position for an engine integration than
the dependency list suggests.

### The activity-log data model

`src/types/events.ts`:

- `EventType` (`:2-20`) — 18 members: `COMBAT_START`, `COMBAT_END`, `ATTACK_DECLARED`,
  `ATTACK_HIT`, `DAMAGE_APPLIED`, `ENEMY_ADDED`, `QUEST_ACCEPTED`, `LOCATION_ENTERED`,
  `SKILL_CHECK`, `DEATH_SAVE`, `INITIATIVE_ROLLED`, `SPELL_CAST`, `ABILITY_USED`,
  `HEALING_APPLIED`, `CONDITION_APPLIED`, `CONDITION_REMOVED`, `TARGET_SELECTED`, `AC_ROLL`.
- `GameEvent` (`:73-80`) — `{id, type, timestamp: Date, sourceTranscriptId, speaker?, data}`.
- `EventData` (`:35-70`) — one flat optional bag: `target`, `value`, `actors`, `targetId`,
  `targetKind`, `enemyId/Name/MaxHp/Ac/Count`, `damageAmount`, `ignoreTempHp`,
  `matchConfidence`, `location`, `npc`, `spellName`, `spellLevel`, `abilityName`,
  `condition`, `action`, plus `rawText` and optional LLM `extractedEntities`.
- `ActivityLogEntry` (`:83-89`) — `{id, text, timestamp, sourceEventId?, icon?}`, i.e. the
  human-readable row rendered from an event by `src/utils/activityTemplates.ts`.

**Note the architectural difference from the engine.** Nimbus's "event" is a *detection*
— a regex match with a confidence and a raw string — not a fact. The engine's `GameEvent`
is a fact the engine itself emitted and `GameState = fold(events)`. Nimbus's `GameState`
(`src/types/gameState.ts:147-156`) is mutated by `transitionState`
(`src/utils/stateMachine.ts:226`) and by direct reducer actions in
`src/hooks/useGameStateReducer.ts`; it is not a fold.

**The pipeline, end to end:**

```
audio → whisper-server → transcript line
      → detectEvents()            phraseDetector.ts:809, 20 rules at :209
      → decideActualization()     actualization.ts:537  — the safety gate
         ├ auto_apply    → processEvent(authorizedEvent(…), 'auto')
         ├ log_only      → processEvent(…)     (writes a row, changes no state)
         ├ ignore        → dropped
         └ needs_confirmation → pending queue, DM clicks confirm/cancel
      → transitionState()         stateMachine.ts:226
      → eventToActivityLog()      activityTemplates.ts
```

The gate (`src/utils/actualization.ts`) is the most engine-adjacent thing in the app and
is worth reading in full. Its rules:

- Only `DAMAGE_APPLIED` and `HEALING_APPLIED` may ever auto-apply (`:108-111`).
- `ATTACK_DECLARED`, `SKILL_CHECK`, `SPELL_CAST`, `DEATH_SAVE`, `ABILITY_USED` are
  `LOG_ONLY_EVENT_TYPES` (`:154-160`) — a test asserts each leaves state byte-unchanged
  through `transitionState`.
- `ENEMY_ADDED`, `COMBAT_END`, `CONDITION_APPLIED`, `CONDITION_REMOVED` are
  `NEVER_AUTO_APPLY_EVENT_TYPES` (`:192-197`).
- It **never consults parser confidence**. It re-reads the raw utterance for independent
  evidence — a damage type word, creation language, a hedge, a question mark — because
  "nothing in the detector's own output separates" a correct candidate from
  `ENEMY_ADDED {enemyName:"On The", enemyCount:20}` produced from "20 on the attack"
  (`:8-28`).
- It emits a `ResolvedOperation` (`:38-55`), which the header explicitly describes as the
  mutation boundary: "a future authority (the DM confirming, **or the Impossibility
  Engine**) can produce one of these without knowing the detector exists"
  (`src/utils/actualization.ts:35`). **This is the only mention of the engine anywhere in
  the repo**, and it is a deliberately-left seam.

Every hit-point mutation is recorded as a reversible `Transaction`
(`src/utils/transactions.ts`) that stores a *captured prior snapshot*, not an inverse
operation, with `origin: 'auto' | 'confirmed'` and links back to the source transcript line.

### Persistence

Four stores, all JSON/text on disk, all in main:

| What | Where | Written by |
|---|---|---|
| Campaign index + per-campaign `party.json` / `encounters.json` / `npcs.json` | `userData/campaigns.json`, `userData/campaigns/<id>/` | `src/utils/campaignStore.ts`, `src/main/ipc/campaignDataIpc.ts` |
| Crash-recovery snapshot | `userData/…` (`snapshotFile`) | `src/main/ipc/sessionIpc.ts`, shape `SessionSnapshotData` at `src/types/ipc.ts:93-99` |
| Session export (plain text) | `Documents/…/<M-D-YYYY>/transcript_<HH-MM-SS>.txt` and the activity log beside it | `src/main/ipc/sessionIpc.ts:53+` |
| Voice aliases | global, **not** campaign-scoped, keyed by normalised combatant name | `src/utils/voiceAliases.ts` |

The snapshot is deliberately narrower than `GameState`: transcript, activity log,
`activeQuests`, `location`, `savedAt`. Combat is "transient and reconstructible from the
recovered activity log" (`src/types/ipc.ts:88-92`). **There is no durable event log.** The
activity log is human-readable text, not replayable facts. Every id the renderer sends is
validated in main before it reaches `path.join` (`src/main/validation.ts`).

### Dice, rolls and mechanics already in it

No dice are ever thrown: `Math.random` appears nowhere outside test fixtures. What exists
is *reading numbers out of speech*:

- `src/utils/damageExpression.ts` sums damage stated in parts ("8 from the longsword,
  12 sneak attack"), requiring a damage-type word or `from`/`sneak attack` after each
  number so a combatant's index is not summed in. It produces a **total**, never a notation.
- `src/utils/numberWords.ts` converts spoken words to digits.
- `AC_ROLL` is the only rule that adjudicates: `src/utils/stateMachine.ts:479-506` takes
  `value` as the roll, looks up the currently-targeted enemy's `ac ?? statblock.ac`, and
  writes `pendingACResult = {roll, targetName, ac, hit: roll >= ac}`. A bare comparison,
  with no modifier, no advantage, no cover.
- `INITIATIVE_ROLLED` (`:642`) inserts a name and a number into the tracker.
- `DEATH_SAVE` is log-only — the text is literally `'Death saving throw'`
  (`src/utils/activityTemplates.ts:103`); no success/failure is tracked.
- 14 conditions as a string union (`src/types/gameState.ts:6-20`), applied/removed with
  no duration, no save, no concentration.
- 23 hand-written monster stat blocks keyed by lower-case name
  (`src/data/monsterStatblocks.ts:45`, `lookupMonsterStatblock` at `:1252`) — goblin, orc,
  bandit, cultist, guard, kobold, bugbear, zombie, skeleton, ghoul, wolf, ogre, troll,
  owlbear, mimic, gargoyle, deinonychus, withers, beholder, gauth, mindwitness, shadow,
  ulitharid. Attacks are strings (`damage: '1d6 + 2 slashing'`), displayed only.

So: it tracks hit points, temp hit points, conditions-as-labels, initiative order and a
target. It adjudicates one thing (roll ≥ AC) and models no rules at all.

---

## 2. The seam

### Where an utterance would meet the engine

The seam is already cut, in exactly the right place. `decideActualization` produces a
`ResolvedOperation` — *who, what, how much, target resolved to a real id* — and
`useActualization` (`src/hooks/useActualization.ts:79-112`) routes each decision to one of
four fates. **An engine call belongs where `processEvent(…)` is called**, i.e. at
`useActualization.ts:86` (auto) and `:53` (`onConfirm`, the DM's click). Everything
upstream — Whisper, the detector, the evidence tests, the name resolution — stays as it is
and becomes *proposal machinery*. Everything downstream — `transitionState`,
`useGameStateReducer` — becomes either dead or a projection of `surface.observe()`.

Two existing UI affordances map onto engine outcomes with no redesign:

- `PendingQueue.tsx` / `usePendingEvents.ts` — confirm/cancel per proposal → the human
  gesture that makes the *DM*, not the parser, the caller.
- `TargetPromptPanel.tsx` / `PendingTargetPrompt` (`src/types/gameState.ts:73-83`) —
  "damage or healing waiting for the DM to say who it applies to" → the shape a
  `needs-context` outcome wants.

### The engine's DM surface

`createDmSurface(campaign)` (`packages/tools/src/dm/surface.ts:26`) returns a `Surface`
(`packages/tools/src/dispatch.ts:45-54`): `{tools, doorsFor(kind), call(request), observe()}`,
four outcomes and no exceptions (`packages/tools/src/outcome.ts:111` — `ok`, `refused`,
`needs-context`, `invalid`).

`DM_TOOLS` (`packages/tools/src/dm/definitions.ts:1132`) is *every* model tool except
`apply_condition` (widened into `rule_condition`), plus 14 DM-only ones: `ability_check`,
`saving_throw`, `settle_test`, `improvised_damage`, `roll_improvised_damage`,
`rule_condition`, `end_condition`, `award_items`, `lose_items`, `award_coin`, `take_coin`,
`take_printed_action`, `take_printed_bonus_action`, `declare_heads`. That is roughly 82
tools against Nimbus's 18 event types.

The rule that decided the split is stated in the same file (`:1100-1130`) and is exactly
the rule an integration must respect: a tool is on the DM's surface if it states **a
decision the rules leave open** (a DC, an improvised amount, a span). A tool is on
*neither* surface if it states **an outcome the rules decide** — which is why
"No tool takes the number a die showed."

### The physical-dice door, as it stands

Built and unreachable:

| Piece | Where | State |
|---|---|---|
| `RollSource = 'engine' \| 'physical-dice' \| 'dm-override'` | `packages/engine/src/rolls.ts:32` | done |
| `checkExternalSource` — refuses any caller claiming `engine` | `rolls.ts:98` | done, not exported |
| `recordExternalD20` | `rolls.ts:124` | done |
| `recordExternalDamage` — bounds-checks a `physical-dice` total against its notation; **does not** bounds-check a `dm-override` | `rolls.ts:162-193` | done |
| `StatedD20 {faces[], source, note?}` — a **list** of faces, because which of two counts is the engine's to decide, not the table's | `packages/engine/src/checks.ts:174-183` | done |
| `resolveStatedD20` — validates provenance first, then every face, then asks for a missing face as `needsContext` | `checks.ts:206-250` | done |
| `AttackOptions.statedRoll` | `packages/engine/src/attack.ts:538`, consumed at `:800-802` | done |
| `D20TestOptions.statedRoll` | `checks.ts:352`, consumed at `checks.ts:455` | done |
| `TestCommand` (what `ability_check`/`saving_throw` pass) | `packages/engine/src/commands/reactions.ts:398-417` | **no `statedRoll` field** |
| Any command that plumbs a stated face | — | **none exists** |
| A tool directory for the table | — | **none exists** |

Grepping `statedRoll` across `packages/*/src` returns five hits, all in `attack.ts` and
`checks.ts`. STATUS.md:780-789 and :835-855 are the owner's ruling and the four open
questions; the last of those four is the one the seam runs straight into.

### Utterance → tool mapping

`P` = should arrive as `physical-dice` (a human threw a die and read it out; the engine
validates the face and applies mode and modifiers). `O` = `dm-override` (a ruling, recorded
and **not** bounds-checked). `—` = no die involved.

| Utterance | Nimbus event | Engine tool today | What is missing | Prov. |
|---|---|---|---|---|
| "Kira rolls a 17 to hit" | `ATTACK_DECLARED` / `AC_ROLL`, both effectively inert | `attack` (`packages/tools/src/definitions.ts:1893`) — but it **throws its own d20** | a `statedRoll` field on the `attack` tool and on the attack command. `AttackOptions.statedRoll` already exists one layer down | **P** |
| "17, that hits — 8 slashing" | `AC_ROLL` + `DAMAGE_APPLIED` | `attack` with `hold:true`, then `settle_attack` | the stated face above; then a stated **damage total with its notation**, which `recordExternalDamage` needs and `damageExpression.ts` does not extract | **P** |
| "the goblin takes 8 damage" (no attack, DM adjudicating) | `DAMAGE_APPLIED` (auto-appliable) | **`improvised_damage` exists and fits** (`dm/definitions.ts:402`) — `{target, amount, ruling, by?}` | nothing structural. But `improvised_damage` takes an **untyped** amount by design, so Resistance/Vulnerability/Immunity cannot apply (`:429-441`). A typed stated-damage path is what is missing | **O** |
| "4d6 fire from the brazier" | not detected | **`roll_improvised_damage` exists** (`dm/definitions.ts:463`) — engine throws it | nothing | — |
| "Perception 14" / "I got a 14" | `SKILL_CHECK` (log-only) | `ability_check` (`dm/definitions.ts:248`) — throws its own die | a `statedRoll` on `TestCommand`; **and a DC**, which the transcript rarely states and the DM must supply | **P** |
| "16 on the Dex save" | `SKILL_CHECK` | `saving_throw` (`dm/definitions.ts:316`) — throws its own die | same as above | **P** |
| "Lyra rolled 21 for initiative" | `INITIATIVE_ROLLED` | `roll_initiative` (`definitions.ts:1644`) — engine throws for every combatant at once | a per-combatant stated face on a batch tool. One of the four questions STATUS.md:846 leaves open | **P** |
| "that's a failed death save" | `DEATH_SAVE` (log-only, no tracking) | **no tool** — death saves are rolled *inside* `end_turn` (`packages/engine/src/commands/turns.ts:1196-1231`) | a nested-roll door. Explicitly unruled (STATUS.md:846) | **P**, unruled |
| "she loses concentration" | not detected | **no tool** — the Concentration save is rolled inside `resolveDamage` (`commands/damage.ts:326`) | the named-unruled case in the brief. A stated face on a roll the damage command fires is a different shape from a stated face on a command's own roll | **P**, unruled |
| "the goblin is prone" | `CONDITION_APPLIED` (never auto) | **`rule_condition` exists** (`dm/definitions.ts:539`), with a DM-stated span; `end_condition` at `:602` | nothing. Nimbus's conditions carry no duration and would need one | — |
| "three goblins burst in" | `ENEMY_ADDED` (never auto) | **`add_creature` exists** (`definitions.ts:817`) — one call each, `{id, monsterId}` | a name→`monsterId` map. Nimbus has 23 name-keyed blocks; the engine bestiary has 330 slug ids (`goblin-warrior`, `ogre`). Nimbus's numeric `enemyId` must also become a stable engine `creatureId` string | — |
| "roll initiative" / "combat's over" | `COMBAT_START` / `COMBAT_END` | `roll_initiative` / `end_combat` (`definitions.ts:1757`) | nothing | — |
| "Theron is healed 7" | `HEALING_APPLIED` (auto-appliable) | **no DM tool.** Healing is only via `heal_with_feature`, `draw_on_healing_pool`, or a spell | an improvised-healing counterpart to `improvised_damage` does not exist | **O** |
| "I cast fireball" | `SPELL_CAST` (log-only) | `cast_spell` (`definitions.ts:2005`) + `resolve_declared_cast` | Nimbus has no spell model at all; the engine has the full SRD catalogue. This is a gain, not a gap | — |
| "targeting the ogre" | `TARGET_SELECTED` | — | the engine has no "currently targeted" concept; targeting is an argument to `attack`. Nimbus's `targetedEnemyId` becomes purely a UI affordance | — |
| "we enter the crypt" / "quest accepted" | `LOCATION_ENTERED`, `QUEST_ACCEPTED` | `set_scene`, `add_landmark` (`definitions.ts:1388`, `:1411`) — a spatial scene, not a narrative one | the engine has no quest log. Keep these in Nimbus's own activity log | — |
| — (no Nimbus event) | — | `award_items`, `award_coin`, `advance_time`, `begin_rest`/`end_rest`, `move`, `equip_item`, … | Nimbus detects none of these. Each is a door it would gain | — |

### The `physical-dice` vs `dm-override` rule I would recommend

**A transcription must only ever produce `physical-dice`.** The asymmetry is load-bearing:
`recordExternalDamage` bounds-checks a `physical-dice` total against its notation precisely
because "trusting a transcription error corrupts the log" (`rolls.ts:155-160`), and
`recordExternalD20` validates a face. A `dm-override` is deliberately **not** bounds-checked
— it is "a ruling rather than a report of a die" (`rolls.ts:158-159`). Routing a mis-heard
number as `dm-override` launders a Whisper error into an unchallengeable fact, which is the
one failure mode the provenance field exists to prevent.

So: speech → `physical-dice`, always, with the engine's validation as the second line of
defence behind the DM's confirmation. `dm-override` should require an explicit typed or
clicked DM gesture, never a spoken one. Note this means a stated damage total needs its
**notation** ("2d6+3") to be bounds-checkable, and `damageExpression.ts` extracts only a
total — that is a concrete, small piece of work on the Nimbus side.

---

## 3. Importability

### Can the Electron app import `@ie/tools`?

Yes, by bundling, and not by `npm install`. Four obstacles, in order of how much they bite:

1. **Private unpublished workspace packages.** `@ie/tools` is `"private": true` with
   `"dependencies": {"@ie/content":"*","@ie/engine":"*","@ie/shared":"*","zod":"^4.0.0"}`
   (`packages/tools/package.json`). `npm i file:../ImpossibilityEngine/packages/tools` will
   try to resolve `@ie/content@*` from the registry and fail. The workable routes are
   (a) a Vite `resolve.alias` mapping `@ie/*` to the sibling's `dist`, letting rolldown
   bundle everything — `vite.main.config.ts` is currently an empty `defineConfig({})`, so
   this is a three-line change; (b) hoisting both repos under one npm-workspaces root;
   (c) a private registry. **(a) is the right first move**, with a `tsconfig.json`
   `paths` entry beside it for the type checker.
2. **`dist/` and the generated SRD data are gitignored.** `ImpossibilityEngine/.gitignore`
   ignores `dist/` and `packages/srd/src/generated/`. Both are present in the current
   checkout (all five `dist/index.js` exist; `packages/srd/src/generated/` holds 1.9 MB of
   JSON), but a fresh clone needs
   `npm install && npm run srd:ingest && npm run srd:index` then a `tsc -b` before Nimbus
   can build. That is a documented prerequisite, not a blocker — but it makes the sibling a
   **build-order dependency**, which CI would have to honour.
3. **ESM only.** Every `@ie/*` package is `"type": "module"` with an `exports` map carrying
   only `types` and `default` — no `require` condition. Nimbus's main bundle is CJS
   (`.vite/build/main.js`). Bundling sidesteps this entirely: rolldown reads the ESM
   source/dist and emits into whatever format the main entry uses. Only a runtime
   `require('@ie/tools')` would hit it, and there is no reason to do that.
4. **Node version.** The engine declares `"engines": {"node": "^22.13.0 || >=24"}`. The host
   runs Node v24.18.0, so building the sibling is fine. Electron 39.8.10 bundles Node 22.x
   (*inferred* — I did not launch the binary, and the `engines` field in
   `node_modules/electron/package.json` is the installer's, not the runtime's). Because the
   engine code is bundled rather than resolved at runtime, the `engines` field is never
   enforced against Electron; what matters is that the emitted syntax is ES2022-ish, which
   it is.

**Bundle weight** (uncompressed `dist`, pre-tree-shaking): `engine` 5.9 MB, `srd` 2.0 MB,
`content` 1.8 MB, `tools` 622 KB, `shared` 41 KB. Most of `srd` is the generated JSON that
`@ie/content` pulls in to build `SRD_CONTENT` (`packages/content/src/index.ts:106`).

### Which process?

**Main.** Not a close call:

- **A `Campaign` is a single-writer object.** It owns the seed, the validated `Content` and
  the append-only log, with `GameState` as a cache stepped by `applyEvent`
  (`packages/tools/src/campaign.ts:39-101`; the reasoning is
  `docs/design/claude-integration.md` §"The session boundary"). A renderer can be reloaded,
  hot-replaced, or duplicated across windows; a campaign that lives there is a campaign
  that can fork.
- **Persistence is already there.** `campaignStore.ts` and `sessionIpc.ts` own the disk.
  The log is the thing that must be persisted, and it should be written beside
  `campaigns/<id>/`.
- **Bundle size.** ~10 MB of rules and catalogue in the renderer buys nothing; the renderer
  needs the *answers*, not the rules.
- **The IPC boundary already exists and already validates** (`src/main/validation.ts`,
  `src/main/ipc/types.ts`). A new `engine:*` namespace beside `whisper`/`session`/`campaigns`
  is the natural shape: `engine:call(toolName, args)` returning the four-valued `ToolOutcome`
  verbatim, and `engine:observe()` returning `surface.observe()`.

One caveat worth recording: `docs/design/claude-integration.md` lists "persisting the log"
as **out of scope until decided**, because "a `Content` holds closures, so what is stored is
the `ContentInput`". In practice this is easy for Nimbus: CLAUDE.md rule 5 pins into events
everything a command read from content, and `fold(seed, events)` is content-free. So Nimbus
persists `{seed, events}` and rebuilds `SRD_CONTENT` from `@ie/content` on every launch.
Homebrew would be the only case needing a stored `ContentInput`.

---

## 4. Suggestions, ranked

### What an integration needs in this app

1. **A campaign store in main that holds a real `Campaign`, and a durable `{seed, events}`
   file beside `campaigns/<id>/party.json`.** Everything else depends on this. Today the
   app's durable artefacts are prose; the engine's whole determinism guarantee is a log
   that folds. Until the log is stored, an engine integration is a session-lifetime toy.
2. **A stable id map between Nimbus's numeric roster ids and engine `creatureId` strings,
   plus a name→`monsterId` map** for the 23 local stat blocks onto the engine's 330-entry
   bestiary. Nimbus's enemy ids are regenerated per encounter (noted at
   `src/types/gameState.ts:133-144`); engine ids must be stable for the life of the log.
3. **An intent parser that proposes and never calls.** Reuse what exists: the phrase
   detector already produces candidates and the actualization gate already refuses to trust
   them. Extend `ResolvedOperation` (`src/utils/actualization.ts:38-55`) into a
   `ProposedToolCall {tool, args, confidence, sourceTranscriptId, rawText}` and put it in
   the *same* pending queue. **The DM's click is the call.** `intentClassifier.ts` is the
   right thing to promote here when regex runs out — but it must feed the queue, never the
   surface.
4. **A "table rolled" input form as the primary path, with speech as an accelerator.** A
   numeric pad bound to the selected combatant — d20 face, damage total, notation — is
   faster to build than speech, is not wrong 5 % of the time, and is what proves the whole
   chain before any transcription is involved. It is also what the physical-dice door wants
   as its first caller.
5. **A fourth row type in the pending queue for `needs-context`.** The engine refuses far
   more than Nimbus does, and per `claude-integration.md` "nobody holds a partial command":
   the caller establishes the fact through the named tool (`doorsFor(kind)` tells you
   which) and **re-sends the original call**. `TargetPromptPanel` is already this UI for
   one case; generalise it.
6. **Decide authority, and write it down.** Running `stateMachine.ts` and the engine side
   by side means two hit-point totals that will diverge on the first Resistance. Either the
   engine becomes authoritative and `CombatState` becomes a projection of `observe()`, or
   the engine runs in shadow mode and disagreements are logged. Do not ship both as truth.

### Risks

- **The doctrine risk, stated precisely.** The engine's rule 1 is enforced by
  *reachability*: no tool on any surface takes a die face. An LLM that turns speech into
  tool calls does not break that rule by producing a face — it cannot, there is no field —
  but it does something adjacent and worse if it holds the surface directly: it becomes a
  caller with DM authority (`improvised_damage`'s `amount`, `ability_check`'s `dc`) whose
  numbers came out of a probabilistic transcriber. `dm/surface.ts:16-19` draws the line:
  "a table with a human DM and an AI narrator is two callers over one log… What must never
  happen is one caller holding both, and that is a choice made where the surface is built."
  **The mitigation is structural, not procedural**: the parser writes proposals into a
  queue; the queue writes to the surface only from a click handler. Nimbus already has that
  shape, which is the single strongest argument for this pairing.
- **Physical dice keep the human as the source — but only if the app cannot fabricate a
  face.** A transcription confidence score is not a substitute for a human reading a die.
  If a number was not spoken, the app must not invent one; if it was spoken and mis-heard,
  the engine's face validation and notation bounds-check catch the impossible ones and the
  DM's confirmation catches the plausible ones. Both layers are needed; neither alone is.
- **`dm-override` must be unreachable from speech.** It is the one path with no
  bounds-check (`rolls.ts:155-159`).
- **A mis-transcribed name is a corrupted log, not a corrected one.** Nimbus can undo a
  transaction (`transactions.ts`); an engine log is append-only. Whatever the engine
  equivalent of undo is — a compensating event, or simply "don't call until confirmed" —
  it has to be decided before the first write, not after.
- **Four engine questions are genuinely open and block parts of the seam**
  (STATUS.md:835-855): which nested rolls the table throws (Concentration inside
  `resolveDamage`, turn-boundary saves, Initiative, death saves); whether the third door
  offers `dm-override` at all; where that directory lives given `dm/definitions.ts` states
  "No tool takes the number a die showed"; and the doctrine sentences that describe a
  `RollId` handshake no command has. An integration should be scoped to **avoid** all four
  in its first milestone.
- **Build coupling.** Nimbus's CI would need the sibling checked out, its SRD ingested and
  its `dist` built. That is a real cost and should be a deliberate decision.

### First milestone

**"One campaign, three tools, no microphone."**

1. Alias `@ie/*` to the sibling's `dist` in `vite.main.config.ts` and `tsconfig.json`;
   create a `Campaign` with `SRD_CONTENT` in main; expose `engine:call` / `engine:observe`
   through the preload bridge; persist `{seed, events}` next to the active campaign and
   prove a relaunch folds to the same state.
2. Drive exactly three tools from explicit DM clicks — `add_creature`, `roll_initiative`,
   `improvised_damage` — and render `surface.observe()` into a read-only panel beside the
   existing combat overlay. No transcript involvement at all.
3. Add a "table rolled" numeric form that calls `improvised_damage` with a typed ruling,
   and show all four outcomes in the UI, `needs-context` included.

That milestone exercises the build, the ESM boundary, the process split, log persistence,
the four-outcome contract and the id mapping — every hard part — while touching none of the
four open engine questions and never letting a transcription reach a surface. The physical
dice door, the stated face on `attack`/`ability_check`/`saving_throw`, and speech-driven
proposals are the second milestone, and by then the owner's four rulings will have
somewhere concrete to land.
