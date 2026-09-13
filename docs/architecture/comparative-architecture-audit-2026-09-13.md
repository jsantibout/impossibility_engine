# Comparative Architecture Audit: Impossibility Engine vs Avrae / d20 / Foundry dnd5e

## Context

The workspace holds four repositories. `ImpossibilityEngine` (IE) is the architecture under audit: a headless, deterministic, event-sourced SRD 5.2.1 rules runtime meant to be driven by an AI DM (Maestro), a human DM tool (Nimbus Quill), a VTT, or a game client. `avrae` (GPL-3, Python, Discord) and `dnd5e` (MIT code, CC-BY content, Foundry VTT) are mature reference implementations; `d20` (MIT, Python) is Avrae's dice library.

The question is not "which has more code" but "does either project hold a primitive, a design, or a data set that IE is about to rebuild, and does anything in their architecture warn IE off a path". Everything below was read from source in this session (file:line citations), not recalled. Nothing in any repository was modified.

**Provenance.** Produced 13 September 2026 from a read-only review of the four repositories in this workspace plus five public Friends & Fables / Craft posts (see the addendum). No repository file was modified.

---

## 0. One-paragraph verdict

IE is not rebuilding Avrae and is only partially converging on Foundry's *data vocabulary*. Neither project has a reusable headless rules core: Avrae's automation engine is a Discord-bound imperative JSON interpreter with human override flags as its only adjudication model, and dnd5e's execution is inseparable from Foundry's client, documents and chat log. The reusable material is (a) Foundry's declarative activity/effect/consumption/uses schema, which IE is re-deriving one spell at a time, (b) dnd5e's CC-BY structured SRD content as a validation oracle for IE's hand-transcribed definitions, and (c) a handful of shapes IE's backlog names that both projects have already designed (summons, recharge, damage properties, walls/multi-template areas, per-target resolution ledgers). Two IE decisions should be reversed before the next SRD family: spell definitions as TypeScript constants, and the refusal to split a 9,917-line `commands.ts`.

---

## 1. Executable mechanic representation

### Avrae: an imperative JSON effect tree

- The unit is an *automation tree*: a list of effect nodes, each possibly holding child lists. Dispatch table `EFFECT_MAP` in `avrae/cogs5e/models/automation/effects/__init__.py:141-157` has 15 node types: `target, attack, save, damage, temphp, ieffect, ieffect2, remove_ieffect, roll, text, variable, condition, counter, spell, check`. Deserialisation is `[EFFECT_MAP[e["type"]].from_data(e) for e in data]` (line 39-40); the JSON keys are literally constructor kwargs (line 64-66).
- Nesting is outcome-scoped child lists: `Attack.hit/miss` (`effects/attack.py:12`), `Save.fail/success` (`effects/save.py:13`), `Check.success/fail` (`effects/check.py:19-29`), `Condition.onTrue/onFalse` (`effects/condition.py:7`), `Target.effects` (`effects/target.py:17`), and `CastSpell` inlining another spell's tree.
- Runtime: `AutomationContext` (`cogs5e/models/automation/runtime.py:24-111`) carries the caster, the `-t` target list, parsed command args, a Draconic evaluator, a `metavars` dict, node flags `in_crit`/`in_save`, and five Discord embed queues. `AutomationTarget` (`runtime.py:264-268`) wraps one target; `is_simple` is true for a string or `None` target.
- Conditions and buffs are `IEffect` nodes producing an `InitiativeEffect` whose mechanical content is `InitPassiveEffect` (`cogs5e/initiative/effects/passive.py:141-223`): 20 fields (`attack_advantage, to_hit_bonus, damage_bonus, magical_damage, silvered_damage, resistances, immunities, vulnerabilities, ignored_resistances, ac_value, ac_bonus, max_hp_value, max_hp_bonus, save_bonus, save_adv, save_dis, check_bonus, check_adv, check_dis, dc_bonus`). Rolls read them by map/reduce over the combatant's effects (`combatant.py:371-385`, used at `attack.py:76-93`, `save.py:101-114`, `runtime.py:301-308`).
- Resource consumption is split: a `counter` node inside the tree (`effects/usecounter.py:110-144` for slots, `146-163` for custom counters) *or* the spell slot spent outside the tree by `cast_spell` (`cogs5e/utils/actionutils.py:239`).
- Targeting is a human-supplied list (`cogs5e/utils/targetutils.py:42-101`); there is no geometry anywhere in the codebase.
- Everything numeric is a string evaluated at runtime (`AnnotatedString`/`IntExpression`, `runtime.py:221-261`; docs `avrae/docs/automation_ref.rst:1120-1153`).

### Foundry dnd5e: typed activity data models plus active-effect changes

- Executable mechanics are *Activities* attached to Items. Registry `CONFIG.DND5E.activityTypes` (`dnd5e/module/config.mjs:4489-4530`): `attack, cast, check, damage, enchant, forward, heal, order, save, summon, teleport, transform, utility`.
- Every activity shares `BaseActivityData.defineSchema` (`dnd5e/module/data/activity/base-activity.mjs:50-100`): `activation`, `behaviors`, `consumption {scaling, spellSlot, targets[]}`, `duration` (+`concentration`), `effects[]` (applied Active Effects), `range`, `target {template, affects}`, `uses`, `visibility`. Per-type data adds `damage.parts`, `save.ability/dc.calculation`, `attack.ability/bonus/type`, etc.
- Content is data: `dnd5e/packs/_source/spells/3rd-level/fireball.yml` declares a `save` activity with `damage.onSave: half`, `parts: [{number: 8, denomination: 6, types: [fire], scaling: {mode: whole, number: 1}}]`, `save.ability: dex`, `dc.calculation: spellcasting`, and `target.template {type: sphere, size: 20, units: ft}`, range 150 ft, `source.license: CC-BY-4.0`.
- Ongoing effects are Foundry Active Effects: `changes[{key, mode, value}]`, `statuses`, `duration`, `origin`, plus dnd5e's `flags.dnd5e.dependents` cascade (`dnd5e/module/documents/active-effect.mjs:1073-1085`, deletion cascade `803-830`). Conditions are status effects with optional levels (`dnd5e/module/data/active-effect/condition.mjs:8-83`; exhaustion `levels: 6, reduction {rolls: 2, speed: 5}` at `config.mjs:3690-3697`).
- A second, newer modifier bus exists: `AppliedRules` (`dnd5e/module/documents/applied-rules.mjs:12-86`), a map keyed `"attack:bonus"`, `"d20:advantage"` etc., filtered by per-change conditions against roll data (`123-132`) and folded into advantage counts with override semantics `=1`, `>=0` (`141-165`). Attack rolls read it through `D20RollModificationField.combineFields(actor.system, ["abilities.dex.attack.roll", "rolls.attack", ...])` (`dnd5e/module/documents/activity/attack.mjs:121-124`).

### IE: closed typed unions, numbers derived, effects resolved by commands into events

- `SpellDefinition` (`ImpossibilityEngine/packages/engine/src/spell-definitions.ts:676-858`) with `effects: SpellEffect[]` (union at `190-455`: `attack, save-damage, temp-hp, buff, heal, attack-damage, save, dispel, interrupt-casting`), `area: SpellArea` (`471-488`), `areaTrigger` (`526-583`), `targetsWithin`, `origin: CastingOrigin` (`614-631`), `activation: SpellActivation` (`861-904`), `trigger`, `check: SpellCheck` (`114-136`), `durationSeconds`/`durationUntil`, `unmodelled`. 125 definitions registered (`SPELL_DEFINITIONS`, line 5329); `COVERAGE.md` counts 79 executed, 46 tracked, 54 verified of 339 parsed.
- Class features are typed grants on the sheet: `StandingGrant`/`StandingRequirement` (`standing.ts:55-262`), `ReactionFeature` (`reactions.ts:230-249`), `ActivatedFeature`, `RecoveryFeature`, `SelfHealFeature`, `HealingTouch` (`character.ts:55-140`).
- Resolution is a command (`commands.ts`, 9,917 lines) returning `Result<GameEvent[]>`; state is `fold(events)` (`events.ts:4174-4176`).

### Comparison and what is materially better elsewhere

| Concern | Avrae | dnd5e | IE | Better elsewhere? |
|---|---|---|---|---|
| Outcome branching (hit/miss, fail/success) | child effect lists per branch | activity-level `onSave`, `hit/miss` per target descriptor on the attack card | one effect kind per shape with optional rider fields (`condition`, `delayed`, `plus`, `healsCasterForHalf`, `addSpellcastingModifier`) | **Yes, Avrae's branch lists.** IE has accreted five rider fields on `attack`/`save-damage` to say "on hit/fail also X"; each new SRD family adds another. |
| Cost declaration | `counter` node + out-of-tree slot spend | `consumption.targets[]` typed (`activityUses, itemUses, material, hitDice, spellSlots, attribute`, `config.mjs:1141-1183`) + activation type spends `attributes.<action>.spent` (`mixin.mjs:565-590`) | hard-coded per command (`castSpell` spends a slot or a feat pool; features name a `pool`) | **Yes, Foundry's declarative cost list.** |
| Recovery | counters `reset_on/reset_to/reset_by` (`sheet/player.py:79-135`) | `uses.recovery[{period, type, formula}]` with periods `lr, sr, day, dawn, dusk, initiative, turnStart, turnEnd, turn` + `recharge` (`uses-field.mjs:17-31`, `config.mjs:1472-1516`) | `recovers: Recovery` + `regainsOnShortRest?` (`resources.ts:20-55`) | **Yes, Foundry's list of rules and recharge.** |
| Modifiers "against the holder" (Blur, Dodge) | none for attacks (caster-side only) | keyed rule targets (`rolls.attack`, `abilities.x.save.roll`) + AE changes | one grant kind `attacked-with-disadvantage` for Dodge (`actions.ts`) | **Yes, the keying idea**; IE's backlog item #2 needs it. |
| Damage math | tree rewrite per annotated node (`resistance.py:247-311`) | per-type multiplier with `dm.amount`, `bypasses`, threshold (`actor.mjs:854-969`) | typed components, sum per type, adjustments → resistance → vulnerability (`CLAUDE.md`, `attack.ts`) | No. IE's order matches the SRD worked example; Avrae's per-node order does not (see §12 warnings). |
| Numbers | supplied by the author as expressions | derived by formulas in roll data | derived from the sheet, refused if supplied | No. IE's invariant is the product. |

---

## 2. Action execution model: Fireball traced through each

### Avrae

`!cast fireball -t goblin1 -t goblin2 -l 4`

1. `cast_spell` (`avrae/cogs5e/utils/actionutils.py:134`): `cast_level` from `-l` (154), `InvalidSpellLevel` guard (160-161), per-spellbook DC/attack overrides (168-173), `can_cast` gate that returns a "Cannot cast spell!" embed rather than raising (193-218), unprepared confirm prompt (221-236), **slot spent** by `caster.spellbook.cast` (239) → `Spellbook.use_slot` (`sheet/spellcasting.py:157-172`, raises `CounterOutOfBounds`).
2. Concentration effect created if the spell concentrates and the caster is a combatant (280-288); `Combatant.add_effect` drops any other concentration effect (`initiative/combatant.py:315-329`).
3. `run_automation` (351-396) → `Automation.run` (`automation/__init__.py:36-131`): `preflight` pass, then each node's `run`.
4. Fireball's tree (`avrae/tests/static/compendium/spells.json`, doc example `automation_ref.rst:1192-1239`): a `meta` `Roll` binds `{damage}` = `8d6[fire]` with `higher` upcast dice; `Target all` iterates the human-chosen `-t` list (`target.py:75-83`); per target `Save dex` computes DC as `-dc` arg > node `dc` > cast override > `spellbook.dc`, plus ieffect `dc_bonus` (`save.py:63-80`), rolls the target's save dice with ieffect save bonuses/advantage (`runtime.py:290-321`), then `fail: Damage {damage}` or `success: Damage ({damage})/2`.
5. `Damage.run` (`damage.py:44-191`): resistances from the target (73-75) plus `-resist/-immune/-vuln` args, crit handling, `d20.roll`, `do_resistances` rewrites the expression tree (169), `AutomationTarget.damage` → `modify_hp` (temp HP first, `sheet/statblock.py:165-181`), then a **display-only** concentration hint `**Concentration**: DC N` (`runtime.py:361-362`).
6. A `Text` node prints the 20-foot-radius prose; the engine never knows who was in the sphere.
7. `combat.final` commits the whole `Combat` to MongoDB (`initiative/combat.py:607-627`).

### Foundry dnd5e

Player clicks Fireball on the sheet.

1. `SaveActivity.use()` via `ActivityMixin.use` (`dnd5e/module/documents/activity/mixin.mjs:217-318`): refuses without ownership through `ui.notifications.error` (219-226), clones the item, `_prepareUsageConfig` picks the slot key and scaling (445-518), opens the usage dialog, `consume()` → `_prepareUsageUpdates` (560-677) spends the action attribute (565-590), decrements `system.spells.spell4.value` (638-656), checks the concentration limit (658-673); consumption deltas are stored on the chat card and are **refundable** (`refund`, 385-412).
2. A "usage" chat message is created with `system.targets` from `game.user.targets` (`TargetsField.getDescriptors`, `dnd5e/module/data/chat-message/fields/targets-field.mjs:30-48`; AC captured, nulled under `coverTotal`).
3. `_finalizeUsage` places the template: `TemplatePlacement.fromActivity` creates a Foundry **Region** with a 20 ft circle (`dnd5e/module/canvas/template-placement.mjs:87-189`; `restriction.type: "move"` with the TODO "What about templates like Fireball that flow around walls?" at 142-143).
4. The save card offers `rollSave` per ability and `rollDamage` (`save.mjs:51-79`). `#rollSave` targets `message.system.evaluatedTargets ?? getSceneTargets()` and calls `actor.rollSavingThrow` per token (117-136) → `D20Roll.build` → dialog → `roll.evaluate()` (Foundry core RNG) → a save message with `type`, `outcome`, `resisted` (`save-message-data.mjs:22-33`).
5. `rollDamage` merges `onSave: half` into the message (`save.mjs:86-91`); `DamageRoll.build` (`damage-roll.mjs:60-65`) doubles dice on crits via `term.alter` (209-211).
6. Application is manual: the damage tray picks a multiplier per target ("Determine a multiplier based on the save outcome", `applications/components/damage-application.mjs:245`) and `applyChatCardDamage` applies to `canvas.tokens.controlled` (`chat-message.mjs:495-504`) → `Actor5e.applyDamage` (`actor.mjs:784-843`) → `calculateDamage` (854-969: immunity → 0, per-type modification with `bypasses`, resistance `Math.trunc(x/2)`, vulnerability ×2, threshold) → `this.update(...)`.
7. Nothing enforces that every target rolled before damage was applied.

### IE

`resolveSpell(state, caster, { spellId: 'fireball', at: point, slotLevel: 4, commandId })`

1. `castOrRelease` (`commands.ts:7657-7712`): duplicate check first, then `unsettledRefusal` (pending saves/damage/tests), definition lookup, trigger refusal, pending-casting refusal.
2. Targets come from geometry: `FIREBALL` (`spell-definitions.ts:1525-1545`) declares `area: { kind: 'sphere', radius: 20, origin: 'point' }`; `creaturesInArea` (`positioning.ts:1060-1105`) selects everyone whose footprint intersects the sphere on the 5-ft lattice; an unplaced creature is absent from the area, an absent scene or unplaced origin returns `needs-context`.
3. Range to the point, cover, sight are checked; the Magic action, the `spell-slot:4` pool and the one-slot-per-turn rule are spent (`resolveCast` family, `commands.ts:6128`).
4. Per target, `save-damage dex`: DC pinned in `CastingNumbers` (`spells.ts:285-290`), save rolled through `rollSavingThrow` with condition, standing and bonus sources, `8d6 + 1d6` per slot level above 3, halved on success **before** defences, then `resolveDamage` (`commands.ts:6024-6098`) applies typed damage, temp HP, massive damage, death, and rolls the target's Concentration save in the same batch.
5. Every die is a `roll-recorded` event with provenance (`events.ts:1635`), the generator snapshot is a `rolls-issued` event (1662), and the command stamp lands on the events. Replay folds the recorded numbers; nothing is rerolled.

### Responsibility matrix

| Responsibility | Avrae | dnd5e | IE |
|---|---|---|---|
| Attack roll | `Attack.run` node (`attack.py:133-223`); DM args `hit/miss/crit/-ac/-b` override | `AttackActivity.rollAttack` (`attack.mjs:83-240`), target AC from the first targeted token (98) | `resolveAttack` (`commands.ts:2195`), natural 20/1 rules, held attack window (`PendingAttack`, `events.ts:315-347`) |
| Saving throw | `Save.run`; auto-fail if no target (`save.py:150-152`) | `Actor5e.rollSavingThrow` via chat button (`actor.mjs:1566-1659`) | `rollSavingThrow` inside `resolveEffects`; `resolveTest` for DM-called saves (`commands.ts:3368`) |
| Resistance/immunity | `Resistance(dtype, unless, only)` + tree rewrite (`resistance.py:135-311`) | `calculateDamage` (`actor.mjs:854-969`) | `applyDamage` per type, defences in `CreatureState.defenses` (`events.ts:182`), qualified entries excluded (`monster.ts:27-60`) |
| Concentration | flag + conflict drop (`combatant.py:315-329`); DC shown as text only (`runtime.py:361-362`) | AE with CONCENTRATING status (`active-effect.mjs:889-925`), prompt card (`actor.mjs:1183-1196`), human clicks "break" (`save-message-data.mjs:162-167`), dependents cascade (803-830) | derived break in the fold (`breakLostConcentration`, `events.ts:2014`), save rolled inside `resolveDamage`, `concentration-ended` event, `releaseCasting` (1741) |
| Reaction | display category only | activation type `reaction` spends an attribute (`config.mjs:998`, `mixin.mjs:565-590`); no trigger detection | five named windows with offers in state (`reactions.ts:45-76`, `260-268`), settlement commands (`takeDamageReaction` 3078, `settleDamage` 3240) |
| Forced movement | none (no positions) | none found (grep of `documents/activity`, `rules/`, `token.mjs`); falling only (`rules/falling.mjs:21-82`) | `moveCreature(..., forced: true)` in `positioning.ts`; shove riders still `unmodelled` |
| Duration/expiry | round-tick counter, `end_round` precomputed (`effect.py:118-150`), expiry in `on_turn` (373-402) called for every combatant on every advance (`combat.py:466-467`) | AE `duration {value, units, expiry}`; pseudo-expiries `sourceStart/sourceEnd/targetStart/targetEnd` (`active-effect.mjs:113`), `isExpiryEvent` (848-877), deletion when leaving combat (`combat.mjs:155-195`) | `Duration` → `Deadline` conversion that can refuse (`duration.ts:76-114`), `expireEffects` derived after every event (`events.ts:2900-2959`) |
| Resource consumption | `counter` node / `spellbook.cast` | `consumption.targets` + slot decrement + refund | pools (`resources.ts`), `resource-spent` events, retry-safe by command id (`commands.ts:301-320`) |

---

## 3. State model

### Avrae

`Combat` (`avrae/cogs5e/initiative/combat.py:37-73`, serialised `159-171`): channel, summary message id, DM id, options, `combatants[]`, `turn`, `round`, `current`, metadata. `Combatant` (`combatant.py:30-118`) = `StatBlock` (`sheet/statblock.py:20-87`: stats, levels, attacks, skills, saves, resistances, spellbook, ac, max_hp, hp, temp_hp, creature_type) + `init`, `index`, `notes`, `effects[]`, `group_id`, `private`. `PlayerCombatant` proxies live stats to the `Character` document and strips them on save (`combatant.py:753-758`). Spell slots: `Spellbook.slots{level: n}` plus pact slot fields (`spellcasting.py:6-35`). Counters: `CustomCounter` (`sheet/player.py:79-135`). Positions: none. Durations: integer ticks. Temporary state beyond effects: none. Persistence: MongoDB document snapshots with a 10-second TTL cache (`combat.py:43`).

### Foundry dnd5e

Actor document: `system.attributes.hp {value, max, temp, tempmax}` (`data/actor/templates/attributes.mjs:76`), `system.spells.spellN {value, max}`, `attributes.exhaustion`, `attributes.concentration {limit, ability}` (163), `traits.di/dr/dv/ci {value: Set, bypasses}`, `attributes.death`, movement, senses. Embedded Items carry activities and `uses {spent, max, recovery[]}`; embedded Active Effects carry conditions, buffs and concentration (`origin`, `duration`, `statuses`, `flags.dnd5e.dependents`). Combat/Combatant documents hold initiative and turn (`combat.mjs`, `combatant.mjs`). Scene/Token/Region documents hold position, elevation, size, disposition, template shapes. ChatMessage documents hold rolls, `targets`, `deltas`, `outcome`, and request results (`request-message-data.mjs:23-37`): a large share of the *workflow* state lives in the chat log.

### IE

`GameState` (`events.ts:613-767`): `creatures`, `combat` (`TurnBudget` with `attacksRemaining`, `spellSlotSpentOnTurn`, `featureUsedOnTurn`; `turnsTaken`; per-creature `TurnCount`, `combat.ts:118-203`), `scene` (`PositionState` with declared `cover` and three-valued `sight`, `positioning.ts:39-59`), `timers`, `pendingSaves`, `scheduledDamage`, `pendingAttack`, `pendingMove`, `pendingCasting`, `pendingDamage`, `pendingTest`, `ongoing` (`OngoingSpell`, `spells.ts:120-258`), `owedAreaEffects`, `areaTriggers`, `pendingTurnStart`, `appliedCommands`, `rng`, `rollsIssued`, `castingsBegun`, `elapsed`. `CreatureState` (133-266): sheet, vitals, conditions as reasons (`ConditionInstance`, `conditions.ts:80-99`), resources, concentration, resting, spellcasting, creatureType, defenses, side, activeFeatures, readied, lastDamage, bonuses, inventory/equipped/coins, character record.

### Missing state primitives IE is likely to reinvent

| Primitive | Mature form | IE today | Classification |
|---|---|---|---|
| Effect instance identity for non-condition effects (bonuses, resistances, AC overrides, auras) with an origin link and independent lifetime | Foundry AE `_id` + `origin` + `dependents` cascade; Avrae `InitEffectReference{combatant_id, effect_id}` + parent/children (`effect.py:17-32`, `227-231`) | conditions have instance ids; bonuses are linked by a `Spell#cast:N` source string (`spells.ts:29-40`); PROGRESS names `on` not shrinking and "until dispelled" leaving no record | ADAPT, Medium |
| Damage properties (magical, silvered, adamantine) and defence bypasses | Avrae `Resistance.unless/only` (`resistance.py:144-223`), `always` token set (`damage.py:143-151`); Foundry `d.properties` + `traits.dr.bypasses` (`actor.mjs:906-912`, `1006-1007`) | `DamageComponent` has type only; qualified stat-block defences are excluded entirely (`monster.ts:27-60`) | ADAPT, Medium |
| Multiple recovery rules and recharge | Foundry `uses.recovery[]`, `recharge` with a d6 formula (`uses-field.mjs:47-64`) | one `recovers` tag + `regainsOnShortRest` (`resources.ts:34-55`) | ADAPT, Medium |
| Summoned creature tied to its origin | Foundry `SummonActivity` (`documents/activity/summon.mjs`, `data/activity/summon-data.mjs`), `dnd5e.registry.summons`, cleanup via dependents | none; `unknown_combatant` has no provider (`PROGRESS.md:1067-1071`) | ADAPT, Medium |
| Inventory: quantity, containers, weight, attunement, ammunition spend | Foundry item models (`data/item/container.mjs`, `equipment.mjs`), ammo consumption in `attack.mjs:182-227` | flat inventory lines, listed gaps in `CLAUDE.md` "What equipment does not model yet" | ADAPT (data shapes only), Low |
| Per-target resolution ledger for a multi-target action | Foundry `RequestMessageData.targets[{actor, result, user}]` (`request-message-data.mjs:31-36`, `164-176`) | a casting resolves every target in one breath; PROGRESS names this as the blocker for Uncanny Dodge vs spell attacks and Indomitable vs spell saves | ADAPT, Medium |
| Levelled condition (exhaustion) | Foundry `ConditionData.level` (`condition.mjs:14-83`) | `ConditionState.exhaustion: number` | VALIDATION |
| Action economy ledger | Foundry 6.0 `attributes.<action>.spent` with combat recovery periods | `TurnBudget` | VALIDATION |
| Declared cover | Foundry cover **statuses** with `coverBonus` (`config.mjs:3837-3855`), i.e. also declared, not computed | directional declared cover per pair | VALIDATION |

---

## 4. Effect/composition system

**Avrae has a reusable effect DSL and interpreter.** It is data-driven, documented (`automation_ref.rst`), branch-nested, supports variables, counters, nested spells, and effects that grant later attacks/buttons. It is not adoptable: GPL-3 (`avrae/LICENSE`), Python, Discord types inside the model (`disnake.ButtonStyle` in `ButtonInteraction`, `interaction.py:108-136`), presentation built inside execution (`AutomationContext` embed queues), in-place mutation with no rollback (`errors.py:20-26`: "This does not revert any side effects"), no determinism, and free-form expression strings everywhere.

**Foundry has a reusable declarative schema and a UI-bound interpreter.** The schema (`base-activity.mjs`, `target-field.mjs`, `duration-field.mjs`, `uses-field.mjs`, `consumption-targets-field.mjs`, `applied-effect-field.mjs`) is the clearest statement in the space of "what parameters a mechanic has". Execution (`mixin.mjs`, dice classes, chat message models) depends on `foundry.*`, `game`, `ui`, `canvas`, `ChatMessage`, `Dialog` and cannot run headless.

**Recommendation: B, adapt the concepts; adopt neither.** Concretely:

1. **Outcome-scoped child effects with a closed vocabulary** (from Avrae's branch lists). Replace the accreting rider fields on `attack` and `save-damage` (`condition`, `delayed`, `plus`, `healsCasterForHalf`) with `onHit`/`onMiss`/`onFail`/`onSuccess` lists whose members are the *same* typed effect union. Keep IE's rule that the branch shares one roll (a nested list under the save preserves single-save semantics; a sibling effect would roll twice, which is the argument `spell-definitions.ts:253-299` already makes).
2. **Declarative cost and recovery** (from Foundry): a `costs[]` on definitions and features (`action`, `spell-slot`, `pool`, `material`, `ammunition`, `hit-dice`) and a `recovery[]` list with `recharge`.
3. **Definitions as data**, validated by the existing zod stack (`packages/srd/src/schemas.ts:1-120` already validates content this way). The TypeScript unions become the schema; content leaves `spell-definitions.ts` (5,511 lines, two owners, `merge=binary` hazards per `CONTRIBUTING.md`).
4. **Ignore** the expression language. Avrae's `IntExpression` lets the author supply a number; IE's product rule is that numbers are derived (`CLAUDE.md`, "Everything mechanical is derived, not supplied").

Two things IE already does that the others reach for by other means, i.e. VALIDATION: a roll bound once and reused (Avrae's `meta` `Roll` node; IE rolls damage once per casting), and an ongoing effect granting a later action (Avrae `AttackInteraction`/`ButtonInteraction`; IE `SpellActivation` with pinned numbers, `spells.ts:285-290`).

---

## 5. Pending and deferred mechanics

| Mechanic | Avrae | dnd5e | IE |
|---|---|---|---|
| Pending saves (repeat at a boundary) | none; a human clicks an effect button on the turn message (`initiative/buttons.py`) | none structural; save cards and `RequestMessageData` track who answered but nothing blocks | `pendingSaves` raised by `turn-advanced`, settled by `resolvePendingSaves`/`resolveTurn`; the turn refuses to advance (`duration.ts:259-270`, `CLAUDE.md` "Turn Boundaries Collect What They Are Owed") |
| Start/end-of-turn effects | expiry only (`effect.py:373-402`) | AE expiry (`isExpiryEvent`), `_recoverUses` per period (`combat.mjs:131-150`), a turn message listing activations | `pendingTurnStart` ordering end before start (`events.ts:746-766`), `raiseTurnEnd`/`reachStartOfTurn` (2451, 2481), area boundary debts |
| Delayed damage | human button | none | `scheduledDamage` with `isDue` distinct from `hasExpired` (`duration.ts:292-348`) |
| Reactions | none | attribute spend only | five windows, offers as (reactor, feature) pairs, settlement commands |
| Concentration checks | text hint only (`runtime.py:361-362`) | prompt card + button, DC computed at `actor.mjs:552` (cap 30 in modern rules) | rolled inside `resolveDamage`; break derived in the fold |
| "Until X" durations | ticks + `end` + `tick_on_caster` + parent link | `duration.expiry` special values, deleted on leaving combat | `Deadline` anchored to a creature's turn count; combat-scoped policy stated in `CLAUDE.md` "Durations Are Two Different Things" |
| Triggered effects / interrupts | none | Region behaviours on token enter/exit (`region-behavior/apply-active-effect.mjs:58-95`) | area triggers (entry, boundary, area-moved, carried), `pendingCasting` for Counterspell, no nesting |

**Finding.** Both reference projects push every deferred obligation to a human. That is fine for their products and fatal for an AI DM, which is exactly the failure IE's `pendingSaves` design note names ("If forgotten: the next turn is refused"). Strong VALIDATION of IE's debt architecture; neither project offers a design to import here.

**Two gaps where a reference shape helps.** (1) IE cannot suspend a casting per target, which blocks `damage-rolled` on spell attacks and `test-rolled` on spell saves (`PROGRESS.md:996-999`). Foundry's `targets[{actor, result}]` ledger is the right *shape* for a `PendingCasting.targets[]` with per-target settled/unsettled outcomes: ADAPT, Medium. (2) Foundry's `_onExit` deletes special-duration effects when a combatant leaves combat (`combat.mjs:155-195`), the same policy IE chose; VALIDATION.

---

## 6. Targeting and geometry

- **Avrae**: no geometry, no positions, no ranges. Targets are the `-t` list, groups expanded (`targetutils.py:69-101`). Engine-owned: nothing. Reusable: nothing.
- **dnd5e**: geometry belongs to the Foundry client. dnd5e maps SRD shapes to template types with size vocabularies (`areaTargetTypes`: circle, cone, cube, cylinder, line, radius/emanation, ring, sphere, square, wall; sizes `radius/length/width/height/thickness`; `config.mjs:2860-2932`), creates Regions (`template-placement.mjs:21-73`), attaches emanations to the token (`146-148`), and hangs behaviours on regions (`apply-active-effect.mjs`, filters by disposition/size/type only, TODO for arbitrary conditions at line 30). Targets for rolls come from the user's targeting, with AC captured and total cover nulling it (`targets-field.mjs:30-48`). Range is a label (`RangeField`); no range refusal was found in `attack.mjs` or `mixin.mjs`. Cover is a manually toggled status. Walls are a known open problem (`template-placement.mjs:142-143`).
- **IE**: engine-owned exact geometry on a 5-ft cube lattice with Chebyshev distance, footprints and declared heights, six SRD shapes tested against boxes (`positioning.ts:915-925`, `1060-1105`), declared directional cover and three-valued sight (39-59), occupancy and mounting rules, and area-trigger detection driven by authoritative position changes. Routes longer than one space are adjudicated (`needs-context` `route`).

**Reusable primitives:** the `wall {length, thickness, height}` and `template.count/contiguous/stationary` fields are exactly the two shapes IE's `CLAUDE.md` lists as missing ("No wall or multi-area spells": Meteor Swarm's four spheres, Wind Wall). ADAPT the vocabulary, Medium. Everything else in IE's geometry is ahead of both projects; VALIDATION. One WARNING: total cover from an *area origin point* (a pillar between the Fireball's point and a creature) is not expressible; IE's declared cover is keyed attacker→target. Extending declared cover to `point→target` keeps the "declared, not ray-cast" boundary. Low.

---

## 7. Rules data vs rules execution vs state vs presentation

| Layer | Avrae | dnd5e | IE |
|---|---|---|---|
| Static content | D&D Beyond compendium JSON (entitlement-gated, `RequiresLicense`, `effects/text.py` preflight) | `packs/_source/**/*.yml`, SRD 5.1/5.2 under CC-BY-4.0 (`README.md:14-20`), activities inside content | `packages/srd/raw` parsed by `@ie/srd` with zod schemas; SRD 5.2.1 CC-BY-4.0 (`ATTRIBUTION.md`) |
| Executable mechanics | automation JSON per spell/action (content *is* the program) | activity classes parameterised by activity data; AE changes | `spell-definitions.ts` constants + class feature modules (`fighter.ts`, `cleric.ts`, ...) |
| State mutation | in-place on sheet objects, Mongo commit (`combat.py:607-616`) | Foundry document updates (`actor.mjs:830`) | events folded by a pure reducer |
| Presentation | built inside execution: `Automation.run` takes a `disnake.Embed` and `ctx` (`automation/__init__.py:36-57`), embed queues in `AutomationContext`, PMs to players | chat cards, dialogs, canvas; execution returns early without a UI (`mixin.mjs:219-226`, `675`) | none in the engine; `roll-recorded` and `unverified` are the narration inputs |

**Tight couplings that make the reference code a bad fit for a headless runtime:**

- Avrae: `AutomationContext.__init__` requires a Discord context and embed (`runtime.py:25-31`); `Text.preflight` performs licence checks; `ButtonInteraction` stores a Discord button style; `Combat` stores a channel id and summary message id and edits Discord messages in `final()` (`combat.py:618-627`).
- dnd5e: `use()` → `ui.notifications`, `ChatMessage.create` (`mixin.mjs:800`), `canvas.regions.placeRegions` (`template-placement.mjs:24`); `applyChatCardDamage` reads `canvas.tokens.controlled` (`chat-message.mjs:501`); `TargetsField.getDescriptors` defaults to `game.user.targets`; `rollSavingThrow` opens a dialog and posts a message (`actor.mjs:1636-1638`); `challengeConcentration` is a chat prompt (1190-1195); RNG is Foundry core `Roll.evaluate` (`basic-roll.mjs:154-158`; no `randomUniform`/`MersenneTwister` in this repo, only cosmetic `Math.random` for token art at `actor.mjs:519, 3095`).

**IE's own coupling to fix:** executable content lives in code. `spell-definitions.ts` is 5,511 lines of constants owned by one contributor while the types at its top are owned by the other (`CLAUDE.md` "Two people work on this repo"). This is the one place IE mirrors Avrae's "content is the program" without Avrae's authoring tooling. ADAPT: definitions as data. High.

---

## 8. Error and uncertainty handling

| Situation | Avrae | dnd5e | IE |
|---|---|---|---|
| Rules say no | exception → embed text; `can_cast` returns a "Cannot cast spell!" embed (`actionutils.py:193-218`); per-node `AutomationException` swallowed into `**Error**` (`effects/__init__.py:47-60`) | `ConsumptionError` list → `ui.notifications.error` (`mixin.mjs:675`), or silent `return` | `Err{kind: 'refusal', code, reason}` (`result.ts:71-102`), nothing spent |
| Missing information | run against `None`: `Save` auto-fails (`save.py:150-152`), `Check` auto-succeeds (`check.py:221-223`), damage may be skipped (`damage.py:78-79`); missing DC → `NoSpellDC` "Use the -dc argument" (`save.py:73-74`); missing attack bonus → `NoAttackBonus` (`attack.py:110-113`) | warn "no token" and proceed (`save.mjs:120`); missing data → `return null` | `Err{kind: 'needs-context', requests: ContextRequest[]}` with `kind ∈ {creature, position, visibility, creature-type, scene, route}` and `satisfyWith` naming the command (`result.ts:28-69`, `commands.ts:240-249`, `eligibleTargets` 9600-9699) |
| DM discretion | argument overrides: `hit, miss, crit, nocrit, pass, fail, -dc, -ac, -b, -d, -resist, -immune, -vuln, -i, -dur, -amt` (`help_constants.py`, used throughout the nodes) | multipliers, refund buttons, `resistSave`, `breakConcentration`, editable dialogs, direct document edits | `unmodelled`/tracked spells, `unverified` reports, `recordExternalD20`/`recordExternalDamage` with `dm-override` provenance kept **off** the AI surface (`rolls.ts:97-143`) |

**Finding.** Neither reference distinguishes invalid from unknown from discretionary in a machine-readable way, because in both the human *is* the adjudicator. Avrae's asymmetric defaults for a missing target (a save fails, a check succeeds) are the "silent default" IE's doctrine forbids (`IMPOSSIBILITY_ENGINE_DOCTRINE.md:130-142`). VALIDATION of IE's three-valued result, and a WARNING: Avrae's flag vocabulary is a good design source for Nimbus Quill's *human* option set, and must never reach Maestro's tool schema.

---

## 9. Extensibility

- **Avrae** is the most extensible for humans: any mechanic is JSON (`!a import`), homebrew spells carry identical automation (`gamedata/spell.py:88-93`), aliases run Draconic (`aliasing/evaluators.py:147`), `SimpleCombatant.add_effect/damage/save` expose the state to scripts (`aliasing/api/combat.py:262-525`), and `Condition` nodes read a `-choice` arg. Environmental interaction is the DM typing commands. The cost: the engine has no rules of its own to refuse with; an AI driving it can `-i` past any constraint.
- **dnd5e** is extensible by hooks on every step (`dnd5e.preUseActivity`, `preRoll*`, `preCalculateDamage`, `preApplyDamage`, `combatRecovery`, ... `mixin.mjs:257, 307, 338, 354, 374`, `basic-roll.mjs:99-141`, `actor.mjs:818, 840, 869, 966`) and mutable `CONFIG` tables (add an activity type, a condition, a damage type). Homebrew is authored as items/activities/effects in the UI. Environment is Regions with behaviours (`region-behavior/*`: apply effect, difficult terrain, rotate area) and the falling rule. New mechanics beyond the activity vocabulary need a JavaScript module.
- **IE** has a closed vocabulary; a new mechanic is code. Its tolerance for creative play comes from elsewhere: `needs-context` lets the table *declare a fact* (a chandelier as a creature-shaped record, per the doctrine's seams section) instead of hearing "invalid"; tracked spells spend the real cost and hand the effect to the DM; 142 of 230 class features say exactly what the DM applies by hand through generic commands (`applyConditionTo`, `damageCreature`, `grantTemporaryHpTo`).

**Which is most tolerant of creative tabletop play while staying authoritative?** IE, on the evidence: Avrae is tolerant but not authoritative, dnd5e is authoritative only about bookkeeping and leaves outcomes to clicks. IE's weakness is authoring cost. ADAPT the *idea* of a validated, user-authorable definition format (Avrae's dashboard export, Foundry's item sheet) by moving definitions to data with schema validation; IGNORE the scripting language.

---

## 10. Determinism and replay

| | Avrae / d20 | dnd5e | IE |
|---|---|---|---|
| RNG | global `random.randrange` inside `Die._add_roll` (`d20/d20/expression.py:424-426`); `Roller(context)` injects only a roll-count limit (`dice.py:43-68`); seeding possible only via global `random.seed` (`avrae/tests/conftest.py:9`, `d20/tests/...`) | Foundry core (`Roll.evaluate`), not injectable from the system | seeded sfc32 with a four-integer snapshot (`dice.ts:13-19, 47-102`), snapshot written to the log (`rolls-issued`) |
| Die-level provenance | excellent in memory: `Die.values` history, `kept`, `exploded`, annotations (`expression.py:140-176, 384-441`); lost at serialisation: `roll_result_to_dict` keeps `{total, result}` (`results.py:300-301`) | rolls persisted in ChatMessage documents with terms, results, options (`target`, `ability`, `advantageMode`, `originatingMessage`, `basic-roll.mjs:169-188`) | `DieRoll {rolled, value, origin, disposition}` in `roll-recorded`; `RollSource` engine/physical/override with sequential ids (`rolls.ts:32-65`) |
| Event log / replay | none; Mongo snapshots; `rewind_turn` only | none; document snapshots; `deltas` allow refund (an inverse, not a replay) | `fold(seed, events)`; golden log frozen (`persistence.test.ts:1-55`); scripted fight replays byte-identically (`scenario.test.ts`) |
| Causal provenance | none | `origin` on effects, `originatingMessage` on rolls, `dependents` | command stamp on events; **no** cause link; derived changes write nothing (`PROGRESS.md:951-956`) |

**Findings.** d20's tree is the best in-memory die representation of the three and is not reusable (Python, global RNG); IE's `DieRoll` is its serialised equivalent, so VALIDATION. dnd5e's per-roll `originatingMessage`/`origin` chain is the one provenance feature IE lacks; ADAPT as a `cause` reference on events plus a "what changed" projection between folds for narration, keeping the fold pure. Medium.

---

## 11. Licensing and reuse

| Component | Licence (verified) | Ideas | Code | Content |
|---|---|---|---|---|
| Avrae (`avrae/LICENSE`) | GPL-3.0 | free to reproduce (architecture, JSON schema shape, arg vocabulary) | **not reusable** in a non-GPL codebase; a port or translation is a derivative work | compendium data is D&D Beyond material behind entitlements (`RequiresLicense`, `effects/text.py`); `tests/static/compendium/*.json` carries 2014 and 2024 spell text: do not copy |
| d20 (`d20/LICENSE`) | MIT | free | reusable, but Python with a global RNG; nothing to take into TypeScript | n/a |
| Avrae deps `draconic`, `automation-common` (`avrae/requirements.txt` git URLs) | **not verified in this workspace** | | | flag for legal review before referencing their schemas |
| dnd5e software (`dnd5e/LICENSE.txt`, `README.md:24`) | MIT | free | reusable in principle; every execution path depends on proprietary Foundry core APIs, so practically only schema/data-model code is portable | |
| dnd5e content (`README.md:14-20`, `system.json` packs `sourceBook: SRD 5.1` / `SRD 5.2`, `fireball.yml` `source.license: CC-BY-4.0`) | CC-BY-4.0 | | | reusable with WotC attribution; IE already ships the SRD 5.2.1 notice. Verify a spell's `source.rules` (2014 vs 2024) before using it as an oracle; only the 5.2 packs match IE's basis |
| dnd5e icons/assets (`README.md:22`) | "various terms, see LICENSE files" | | | do not copy |
| IE (`ATTRIBUTION.md`) | SRD 5.2.1 CC-BY-4.0 | | | attribution must stay visible; Product Identity excluded |

**Requires legal review:** (1) confirmation that re-implementing Avrae's automation JSON *format* from its documentation is not a derivative work (interface vs expression); (2) licences of `draconic` and `automation-common`; (3) using dnd5e YAML as a parsed oracle: CC-BY-4.0 is permissive, but confirm attribution wording covers derived data files; (4) any Foundry-derived code must not pull in Foundry core.

---

## 12. Recommendations, classified and prioritised

| # | Finding | Class | Priority |
|---|---|---|---|
| 1 | Event-sourced state with engine-owned pending debts and refusal-to-advance has no counterpart in either project; keep it as the product's core. | VALIDATION | Critical |
| 2 | Both references resolve outcomes through human clicks and override flags. Keep every such control (forced hit/miss, `-i`, multipliers, `recordExternal*`) off Maestro's surface; expose them only on Nimbus Quill with `dm-override` provenance. | WARNING | Critical |
| 3 | Move spell and feature definitions out of TypeScript into validated data files; the current unions become the zod schema. Fixes the two-owner file collision, enables homebrew and an authoring path, and makes the dnd5e oracle (#6) mechanical. | ADAPT | High |
| 4 | Restructure riders into outcome-scoped child effect lists (`onHit/onMiss/onFail/onSuccess`) over the same closed union, before the next families (target-anchored riders, condition-with-no-save, damage-with-no-roll) add more optional fields. | ADAPT (Avrae) | High |
| 5 | Add a roll-modification target key that distinguishes rolls *by* the holder from rolls *against* the holder (Foundry's `rolls.attack` vs actor-side keys). IE already has one "against" grant (Dodge); Blur/Haste/Hex are the second users the generalisation rule waits for. | ADAPT (Foundry) | High |
| 6 | Use dnd5e's SRD 5.2 YAML activities as a **test oracle** for IE definitions: save ability, damage dice/type, scaling mode, template shape/size, range, duration, concentration. IE's own history (Fire Bolt 2d10, Finger of Death's flat 30) is exactly what this catches. | ADAPT (data) | High |
| 7 | Split `commands.ts` (9,917 lines, 13 domains) before the next family; PROGRESS already names spell resolution as the first cut. | WARNING | Medium |
| 8 | Declarative cost list on definitions and features (action, slot, pool, material, ammunition, hit dice) modelled on `consumption.targets`. | ADAPT (Foundry) | Medium |
| 9 | Recovery as a list of rules with `recharge` (d6 formula) modelled on `uses.recovery[]`; needed for monsters and items. | ADAPT (Foundry) | Medium |
| 10 | Damage properties on components plus defence `bypasses`; reclassify "nonmagical" stat-block defences from `QualifiedDefense` (dropped) to property-conditioned defences. | ADAPT (both) | Medium |
| 11 | Per-target resolution ledger on a pending casting, shaped like `RequestMessageData.targets[]`, to unblock reaction windows inside spells and later a Counterspell stack. | ADAPT (Foundry) | Medium |
| 12 | Summons: creature created mid-fight from `adaptMonster`, joined to initiative, life tied to the casting via the existing `releaseCasting` convergence; Foundry's `SummonActivity` profiles and `dependents` cleanup are the reference. | ADAPT (Foundry) | Medium |
| 13 | Multi-template (`count`, `contiguous`) and `wall {length, thickness, height}` shapes from `areaTargetTypes`. | ADAPT (Foundry) | Medium |
| 14 | `cause` reference on events and a change projection for narration; Foundry's `origin`/`originatingMessage`. | ADAPT (Foundry) | Medium |
| 15 | Avrae's per-node resistance tree rewrite doubles before it halves (`resistance.py:289-298`); the SRD 2024 worked example (28 fire, −5, resistant and vulnerable → 22) requires adjustments → resistance → vulnerability. Do not port; IE's order is right. | WARNING | Medium |
| 16 | Avrae's arg vocabulary (`-t`, `-rr`, `adv/dis`, `-b/-d/-dc/-ac`, `hit/miss/crit`, `pass/fail`, `-resist`, `-l`, `-phrase`) is a mature human-DM option set; adopt it as the design source for Nimbus Quill's tool options. | ADAPT (Avrae) | Medium |
| 17 | Falling: `CONFIG.DND5E.falling` formula and `applyFallProne` (`rules/falling.mjs`) is the whole rule; transcribe from the SRD, unblocks Feather Fall/Slow Fall. | ADAPT | Low |
| 18 | Point-origin cover for areas (pillar between Fireball's point and a creature) via declared `point→target` cover; stays inside the "declared, not ray-cast" boundary. | ADAPT | Low |
| 19 | Avrae's tick-based durations and Foundry's AE `duration` are both weaker than IE's `Duration`/`Deadline` split with combat-scoped policy; Foundry independently chose the same "delete on leaving combat" rule. | VALIDATION | Low |
| 20 | Declared cover (Foundry also declares it as statuses), pools declared not derived, conditions with reasons (Foundry `origin`, Avrae parent links), one casting identity (Foundry concentration effect + `dependents`, Avrae conc effect + parent). | VALIDATION | Low |
| 21 | Draconic/AnnotatedString expressions; d20 code; Avrae Discord interactions; Foundry execution layer and dice classes; Foundry hooks as an extension model. | IGNORE | n/a |

---

## 13. Duplication audit: backlog items that already exist in mature form

Backlog taken from `PROGRESS.md:1106-1176` (ranked shapes), `1211-1270`, `1358-1531` (next actions), `935-1071` (doctrine debts), and `CLAUDE.md` gap lists.

| Backlog item | Mature form | Work saved | Integration difficulty | Compatibility | Maintenance risk |
|---|---|---|---|---|---|
| Standing advantage/disadvantage a spell grants, incl. against the holder (25 spells) | Foundry `AppliedRules` + `D20RollModificationField` keys; Avrae passives (`attack_advantage`, `save_adv`) | design only, ~1 week | none (pattern only) | high: key on `ModeSource` targets | none |
| Condition with no save (9), resistance/immunity a spell grants (17), AC a spell sets (~4) | Foundry AE `changes` on `traits.dr`, `attributes.ac`; Avrae `ac_value/resistances` passives | small; IE's `StandingGrant` already has `damage-resistance`, `condition-immunity`, and `ArmorClassCalculation` exists | trivial | high | none |
| Healing that lifts conditions / raises max / revives (10) | Foundry `HealActivity`, `hp.tempmax` | small | trivial | high | none |
| Teleportation (13) | Foundry `TeleportActivity` + core region teleport | design of `teleportCreature` (range, unoccupied space, sight) | low | high | none |
| Summons (9) | Foundry `SummonActivity`/`summon-data.mjs` (profiles, level ranges, proficiency/attack/save matching), `registry.summons`, `dependents` cleanup | design, ~1–2 weeks of shape work avoided | medium (needs `combatant-joined` event and initiative insertion) | high | low |
| Recharge, multiple recovery periods (monsters, items) | Foundry `uses.recovery[]` | small | low | high | none |
| Damage properties / bypasses | Avrae `Resistance.unless/only`; Foundry `properties`+`bypasses` | small; also unlocks dropped stat-block defences | low | high | none |
| Walls and multi-area spells (Meteor Swarm, Wind Wall) | Foundry `areaTargetTypes.wall`, `template.count/contiguous` | vocabulary only | low | high | none |
| Ammunition spend, containers, weight, attunement | Foundry item models, `attack.mjs:182-227` | data-shape design | low | medium (IE's catalogue is id-keyed already) | low |
| Casting resolution suspended per target | Foundry `RequestMessageData.targets[{actor, result}]` | shape only | medium (touches `pendingCasting` and the reducer) | high | low |
| Falling | `rules/falling.mjs` | trivial | trivial | high | none |
| Tool surface (M2) option vocabulary for a human DM | Avrae `VALID_AUTOMATION_ARGS` | design | none | high (as Nimbus Quill options only) | none |
| Mechanical spell/monster data transcription (remaining ~214 spells, monster actions) | dnd5e SRD 5.2 YAML activities and monster action activities | as an oracle: catches transcription errors; as a source: could seed definitions, subject to §11 review | low (a script over `packs/_source`) | high | low (pack format changes per dnd5e release; pin a version) |
| Long casting times (43), area drift, path/distance travelled, light, multiple scenes, reaction nesting | none in either reference | none | | | |
| Persistence (M3), replay, provenance | none comparable (snapshots only) | none | | | |

Everything IE has already built in areas, reaction windows, pending debts, casting identity, positioning and provenance has no mature equivalent to reuse; the duplication risk runs the other way.

---

## 14. Final verdict

**A. Are we accidentally rebuilding Avrae?** No. The shared surface is the mechanical vocabulary (attack, save, damage, counter, effect) that any 5e engine has. Avrae's actual architecture, a Discord-bound JSON interpreter with human override flags and no rules of its own, is the thing IE must not build. Estimated conceptual overlap: about a tenth, all of it the vocabulary.

**B. Are we accidentally rebuilding Foundry's D&D system?** Partly, in the data model only. IE is re-deriving Foundry's activity schema (activation, consumption, duration, range, target, uses, applied effects) one SRD family at a time; the execution, state and provenance models are different by design and should stay so. Estimated overlap of IE's *definition* surface with Foundry's schema: a quarter to a third, growing with every family unless #3/#8/#9 above are done deliberately.

**C. What percentage of the engine could be replaced by mature components?**

| Replacement route | Estimate |
|---|---|
| By code | ~0%: Avrae is GPL-3 and Discord/Python-bound; d20 is Python with a global RNG; dnd5e runs only inside Foundry |
| By data (SRD 5.2 YAML as oracle or seed for definitions and monster actions) | 10–15% of the remaining transcription effort, and a large share of its *risk* |
| By design (shapes with a mature reference to copy) | roughly a third of the named backlog (rows in §13) |

**D. What is genuinely novel or differentiated in IE?** (1) The three-valued `Result` with structured `ContextRequest`s and named providers (`result.ts`, `eligibleTargets`); (2) a pure fold over recorded outcomes with derived passes (`applyEvent`, `events.ts:2961-2978`) and engine-owned debts that stop the game rather than forget a rule; (3) roll provenance policy with a forged-provenance guard (`rolls.ts:97-106`); (4) exact engine-owned geometry with declared cover/sight and authoritative area-trigger detection (entry, boundary, area-moved, carried); (5) reaction windows as named resolution points with (reactor, feature) offers; (6) casting identity with pinned numbers and a single release convergence; (7) the tracked/executed/unmodelled honesty model enforced by tests (`spell-tracking.test.ts`, `coverage.ts`); (8) idempotent commands with fingerprinted identities. None of these exists in either reference.

**E. What to change before the next major SRD mechanic family?** In order: (1) definitions as validated data (#3); (2) outcome-scoped child effects (#4); (3) split `commands.ts` (#7); (4) roll-modification keys for "against the holder" (#5), since the next family is standing advantage/disadvantage; (5) the dnd5e oracle script (#6); (6) `cause` on events (#14).

**F. Any decision to reverse?** Two. First, executable content as TypeScript constants: reverse to data, keeping the unions as the schema. Second, the stance that `commands.ts` must not be reorganised without a behavioural reason: at 9,917 lines it is the runtime, and the reason has arrived. One partial reversal: keep derived changes out of the fold, but add a recorded change projection so narration and migration checks can see them. Decisions that survive the audit unchanged: event sourcing, the Chebyshev lattice, declared cover and sight, refusal-as-value, pools declared not derived, one scene until a second is needed.

---

---
---

# Addendum: Friends & Fables / Craft as a production case study

This addendum does not modify the conclusions above. It tests them against the only public account of a shipped AI-RPG that has run at scale and been rewritten. Friends & Fables (F&F) is not available as source, so nothing here is a code-level comparison.

**Sources and tags.** [X] "How is Friends & Fables different from ChatGPT, AI Dungeon or NovelAI" (undated, pre-ACE-1); [F] "How Franz works"; [A] "Introducing ACE-1" (28 Dec 2024); [D] Development Log 26.01 (25 Feb 2026); [C] "Craft: a new approach to AI RPGs" (21 May 2026). A statement carrying a tag is documented in that source. A statement marked *(inference)* is this audit's reading and is not stated by the team. Two things the sources verifiably do **not** say: who rolls dice, and how attack, save or damage outcomes are computed [X, F, A]; the summariser's first pass asserted otherwise and a verbatim re-check refuted it.

## 1. What authority does deterministic software own in F&F?

Documented:

- A purpose-built database of structured game state: character and monster stats, coordinates, locations, quests, inventory with carrying capacity, character equipment [X].
- State checks that read the character's class and remaining spell slots and feed them into the model's context to ground narration [X]. This is grounding, not refusal: the sources describe constraints as information the model is given, not as an engine that rejects a cast.
- A combat mode that tracks turn order and the results of each turn, and displays outcomes [X].
- Memory management after ACE-1: atomic fact memories, retention ranked by memory type, recency and a ranking algorithm, per-tier caps, user locks [A].
- Context assembly and its limits: which information is sent per turn, character limits on sheet fields, token limits [C]; a research step assembles a "Working Context" that the player can see and edit [F].
- Entity linking of mentioned characters/items/spells in message text, @-mention context guarantees, relationship scores, coordinate-based reveal of unknown NPCs and locations, a validator for custom instructions, a trope-reduction filter [A].

*(inference)* Dice are surfaced as a mechanical moment ("asking you to roll for a skill check" [X]) but nothing documents that outcomes are computed outside the model.

## 2. What authority do LLMs own?

Documented:

- Narration (Franz) [F, X].
- Retrieval decisions: a research step searches long-term memories, lore and entities and chooses what enters working context; it can miss things [F].
- **State mutation decisions.** Post-processing LLMs read the current state, the player's message and Franz's response and decide actions such as moving the player to a location or adding items to inventory [F]. Mechanics and action outcomes are described as probabilistic, decided by the AI on the fly, and the team states the AI can make mistakes and will likely never be perfect [F].
- Before ACE-1 the order was narrate first, then update state from the narration as best as possible; ACE-1 changed this to agents deciding when and how to read and update state [A].
- Entity generation (new NPCs, locations) with a user-configurable hook, and NPC agency such as asking to join the party [A].
- In Craft, rule application within builder-defined structures, with dozens of user-selectable models [C].

*(inference)* Because the sources never describe a rules engine that computes outcomes, and do describe outcomes as probabilistic, combat resolution in F&F was model-decided within a tracked turn structure.

## 3. How are narration, retrieval, game state, rules adjudication and state mutation divided?

| Concern | F&F (documented) | Where it sits |
|---|---|---|
| Narration | one model (Franz), its own context per request [F] | LLM |
| Retrieval | research step over memories, lore, entities → editable Working Context [F]; atomic memories ranked by type and recency [A] | LLM decides, software ranks and caps |
| Game state | structured DB, editable by players and AI [X] | software stores; both write |
| Rules adjudication | constraints enforced by feeding state into context [X]; outcomes probabilistic [F] | LLM, grounded |
| State mutation | post-processing models decide actions from (state, message, response) [F]; ACE-1 agents decide when/how [A] | LLM |
| Combat | a mode tracking turn order and per-turn results [X]; untouched by ACE-1, off by default [A]; five rewrites by Jan 2026 [C] | structure in software, outcomes unspecified |

## 4. Architectural problems the team has explicitly acknowledged

- Hierarchical memory summarisation compressed important details away; replaced by atomic facts [A].
- Most model failures come from the needed information not being in context, less often from the model ignoring it [A].
- State updates were imperfect: wrong moments, duplicate entities; improved by ACE-1 but "not perfect yet" [A]. Character-sheet corrections limited to basic fields; quests and interactions disabled pending another approach; memories not backward compatible [A].
- Players wrote custom instructions the system could not honour, which degraded output [A].
- The architecture was built for weaker models that needed rigid structure; that rigidity now limits situations not specifically designed for, slows updates and caps the emergent capability of stronger models [D]. Scaffolding filled gaps in reasoning, memory, structure, rules and decision-making with code, and the same scaffolding created invisible walls [C].
- Unlimited-play economics forced context control (field character limits, per-turn budgets), and players hit those walls [C]. In their words, "we had to control context" [C].
- The codebase became a container ship, slow to steer; patches were rejected in favour of a rewrite of the narration engine and the state update system, on which combat depends [D].
- One fixed system (D&D 5e, fixed sheets, one managed model) could not serve both the deep-D&D audience and the custom-ruleset audience [D, C].

## 5. Why did combat require repeated rewrites?

Documented: combat is one of the hardest problems in a system like F&F; by January 2026 they were on the fifth rewrite, each improving some things and worsening others [C]; the team concluded combat could not be built right until the narration engine and state update system beneath it were rewritten [D].

*(inference)* Combat is where the "narrate, then extract state" design fails most visibly: it has the densest verifiable facts per message (hit points, positions, turn order, resources, conditions), the strictest ordering, and immediate player feedback when a number is wrong. A rewrite that changes the combat layer without changing who owns mutation moves the errors rather than removing them, which matches the team's description of each rewrite trading problems. Their own diagnosis (foundation first) supports this reading; the sources do not state it in these terms.

## 6. What was problematic about the older scaffolding and state-update architecture?

Documented: built for models needing hand-holding and rigid structure [D]; response generated first, state derived afterwards as best as possible [A]; mutation decisions probabilistic [F]; hierarchical summaries [A]; context cut for cost [C]; rigid structure limiting unanticipated situations and the capability of newer models [D]; a monolith slow to change [D].

*(inference)* "Scaffolding" in these posts means prompt flow, decision structure and compensating logic around the model, not a rules engine. The team says it filled gaps in rules and decision-making with code, yet the state changes themselves stayed model-decided. The scaffolding constrained the model without ever making the outcome authoritative, which is the worst of both: rigidity without truth.

## 7. What changed philosophically with Craft?

Documented: from making decisions for the player to giving builders tools [C]; from one fixed system to builder-defined files of any shape, custom rules, scripts, hierarchical maps, an AI worldbuilding assistant (Orbit), an import/export data format [C]; from a single managed model to dozens of user-chosen models [C]; from unlimited play with context control to daily allowances plus credits [C]; from a container-ship codebase to standalone prototypes validated fast and fed back [D]; a "very different model harness" and a different way for the AI to interact with game state, not further specified [C].

*(inference)* Craft moves in two directions at once: less deterministic compensation for reasoning (trust stronger models more) and more user-authored structure for entities and rules. On the authority axis that is the opposite of IE; on the "state must be structured and visible" axis it is the same.

## 8. Comparison against Impossibility Engine

### Does IE's boundary address problems F&F has described?

| F&F problem (documented) | IE mechanism | Addressed? | Counterargument |
|---|---|---|---|
| Narrate first, then extract state "to the best of our ability" [A]; probabilistic mutations that can be wrong [F] | events are the only route to state; the model calls a tool, the engine resolves, the model narrates the log (`CLAUDE.md` "The Inviolable Rule"; `events.ts:4174`) | **Yes, directly.** The mutation is never inferred from prose. | F&F's users noticed narrative and memory failures more than arithmetic ones (their #1 feedback was tropes [A]); IE's exactness is invisible unless the tool surface makes it felt. |
| Constraints are grounding, not enforcement: the model is told its slots and may still be manipulated [X] | refusal as a value: no slot, no cast, nothing spent (`resources.ts:158-169`, `result.ts:71-102`) | **Yes.** | Enforcement without grounding leaves the model narrating blind; IE's tool results must carry the state the model needs, or IE recreates "information not in context" [A] on its own side. |
| Most failures: needed information was not in context [A] | `needs-context` names the missing fact and its provider (`result.ts:28-69`); `unverified` names what could not be checked | **Partly.** Only for facts the engine reads. Narrative context assembly is Maestro's job and is unbuilt (M2). | Every request is a round trip; F&F treats latency and per-message cost as first-order [F, C]. A tactical scene with unplaced creatures and undeclared sight lines can cost several calls before a Fireball resolves. |
| Duplicate entity creation, updates at the wrong moment [A] | command identity with fingerprints (`commands.ts:301-320`); derived passes decide timing (`events.ts:2961-2978`) | **Yes for mechanical state.** | IE has no entity-generation layer yet; NPC and location creation will need its own dedup and provenance. |
| Hierarchical summaries lost important facts [A] | none: the event log is history, not narrative memory | **No.** | The log answers "why did the goblin die", not "what did Neela promise". IE's planned pgvector memory has no design yet; ACE-1's atomic-fact, typed, lockable, inspectable memory is the direct lesson. |
| Rigid scaffolding limits situations not designed for; invisible walls [D, C] | closed vocabulary but honest edges: tracked spells spend the cost and hand the effect to the DM, manual features name what the DM applies, generic commands (`applyConditionTo`, `damageCreature`, `resolveTest`) resolve improvised actions, `needs-context` lets a fact be declared | **Conditionally.** IE's walls are explicit refusals with reasons, not silent truncation. | A refusal is still a wall from the player's seat unless the layer above narrates around it. IE refuses casting times of a minute or more, two casting classes, Counterspell on Counterspell, `no_definition` for 214 spells, and routes without waypoints. Maestro has no `dm-override`; where the engine cannot execute a clause, the only paths are fiction or hand-applied generic commands. |
| Combat rewritten five times; foundation must be rewritten first [C, D] | the engine *is* the state-update system, built before any product, with a replayable four-round fight (`scenario.test.ts`) and a frozen golden log (`persistence.test.ts`) | **Yes in ordering.** | IE has never been driven by a model. F&F's rewrites came from integration and scale problems (context cost, latency, model quality), none of which IE has met. |
| Scaffolding built for weak models became a constraint as models improved [D, C] | | | **This is the sharpest counterargument to IE.** Rules arithmetic, legality, resolution order and replay do not get less true as models improve, so a rules engine is not that kind of scaffold. But parts of IE are reasoning-scaffolds in disguise and will need retuning: `eligibleTargets` shortlists, the `route` protocol, the tracked/unmodelled taxonomy, the "engine cannot judge preparation" and "components are the DM's" splits. Keep those at the tool surface, not in the reducer. |
| One fixed schema and one model for every audience [D, C] | doctrine: D&D-specific is fine, generalise from evidence; one `CreatureState` | **Same fork, deferred.** | Craft's answer to fixed sheets was user-defined file types. IE's "declare the chandelier as a creature" is the F&F-style workaround the doctrine itself flags as a seam. |

### Where the harder boundary can make the product worse

- **Reduced emergent behaviour.** A model that cannot fudge cannot "yes, and" a delightful impossible action. F&F's probabilistic design says yes to everything and is wrong sometimes; IE says no precisely and is right. For a solo player the second is a better game only if the surface offers a graceful "the DM rules that…" path with provenance. For Maestro that path does not exist by design; that is a product decision that should be explicit, not incidental.
- **Rigidity.** Listed refusals above. Each is honest; together they shape an uneven level-5 experience where Fireball resolves and Sleep does not. F&F handles all 339 spells "roughly" on day one. IE's tracked-spell path (46 spells) narrows this; the `unmodelled` clauses with a named missing shape do not.
- **Excessive context requests.** Real and unmeasured. Mitigations already in the code: batched `requests[]`, `eligibleTargets`, `reactionOpportunities`, `availableChecks`. Missing: a per-turn call budget and a scene-start placement discipline so facts are declared before they are needed.
- **Arbitrary actions.** IE's generality is by primitive (tests, damage, conditions, positions, pools), not by named action, which is the right shape. The gap is authoring effort for anything with a printed rule.
- **Architectural complexity.** F&F's container ship is already here: 9,917-line `commands.ts`, a ~100-member event union, nine derived passes, 80k lines of engine and tests, no product. The audit's #7 gets stronger.
- **Slower development.** 79/339 spells and 88/230 features executed after 143 commits. F&F shipped with everything "working" probabilistically. The honest gap will be visible to the first user.
- **Rules-engine maintenance.** A rules change is a reducer change and possibly a migration (`persistence.test.ts` says so). F&F's 2014/2024 problem is a prompt and data switch. IE's cost is structural and permanent.
- **Impedance between model reasoning and deterministic execution.** The model must speak in ids, slot levels, feature ids and waypoints; every mismatch is a refusal or a round trip. F&F's design has zero impedance and maximal error. IE's pre-flight queries are the lever; the M2 surface must make "what can I do now" as cheap as "do it".

### A. Are we repeating any architectural mistake F&F has already made?

Not the central one. IE never lets narration precede state. Three F&F mistakes are at risk of repetition: (1) a monolith that is slow to steer, already present in `commands.ts`; (2) deep infrastructure built on untested assumptions about model behaviour, since no model has yet driven the engine; (3) making decisions for the table inside the engine (which Reactions are offered, one metric, route rules) that belong at the tool surface, where F&F's "decisions for the player" became walls.

### B. Are we solving a problem they have publicly struggled with?

Yes: authoritative state mutation and combat consistency. Their own log says the state update system had to be rewritten before combat could be built properly [D]; IE built that system first, deterministic and replayable. IE is not solving their other publicly named problems (memory summarisation, context assembly, entity generation, tropes), and has not started on them.

### C. Is our architecture meaningfully different, or another implementation of the same design?

Different on the authority axis: F&F is LLM-decided mutation grounded by structured state; ACE-1 is agents deciding when to read and write state; IE is engine-decided mutation with the model reduced to proposing commands and narrating results. Same on the outer shape (structured state, retrieval, narration), and on that half IE is behind F&F rather than different, because the retrieval and narration half does not exist yet.

### D. What lessons should change IE today?

1. Design narrative memory as atomic, typed, ranked, lockable facts with an inspectable working context (the ACE-1 lesson), not hierarchical summaries; the event log is not this.
2. Make "what was in context" and "what was unverified" visible in Maestro's loop from the first integration; IE's `unverified` and `needs-context` already supply the engine half.
3. Set a per-turn tool-call budget and measure it in the scripted scenario driven by a model; treat round trips as a cost like tokens, because F&F's users feel latency and cost before they feel arithmetic.
4. Define the fallback for unmodelled clauses on the AI surface: tracked cost plus narrated effect plus a generic command carrying the spell as `source`, so a gap is a ruling with provenance rather than a wall.
5. Put an LLM in the loop before M2 is "done": drive `scenario.test.ts` through a real tool surface to find impedance now; F&F's rewrites came from meeting integration late.
6. Keep reasoning-scaffolds (shortlists, route protocol, policy about who is offered a Reaction) at the tool surface, expecting to loosen them as models improve; keep the reducer to rules and truth.
7. Proceed with the audit's #3 (definitions as data) and #7 (split `commands.ts`): Craft's file-system direction and the container-ship warning both point the same way.

### E. Does their fifth combat rewrite increase or decrease confidence in our direction?

Both, on different axes. It **increases** confidence in the boundary: the team's own conclusion is that combat cannot be built on a foundation where state is inferred from narration, and IE's foundation is the alternative, built first and replayable. It **decreases** confidence in the schedule and the scope: five rewrites with a product in market also say that the first version of any combat model is wrong in ways only players reveal, and IE has written combat once with no players. IE's replayability makes the next rewrite safer (a golden-log migration rather than a lost campaign), not unnecessary.

## Effect on the audit's conclusions

| Conclusion | Effect | Why |
|---|---|---|
| §12 #1 event-sourced, engine-owned state | **Stronger** | F&F's dev log names the state update system as the thing that had to be rewritten before combat |
| §12 #2 keep overrides off the AI surface | **Stronger** | F&F documents that grounded-but-unenforced constraints can be manipulated [X] |
| §12 #3 definitions as data; #7 split `commands.ts` | **Stronger** | Craft's files-as-data direction; the container-ship warning |
| §12 #14 causal provenance | **Stronger** | ACE-1's "view context" and its two failure causes make provenance a product feature, not a debugging nicety |
| §9 "most tolerant of creative play while authoritative" | **Weaker, now conditional** | Holds only with a tool-surface fallback for unmodelled clauses and a round-trip budget; without them IE's honest refusals are F&F's invisible walls with better error messages |
| §13 "duplication risk runs the other way" | **Weaker** | True for rules; false for the retrieval, memory, working-context and entity-generation half, where F&F is years ahead and IE has nothing |
| §14.D novelty claims | **Unchanged** | None of the F&F sources describes an engine-owned deterministic resolution layer |
| §14.E "change before the next family" | **Needs revision** | Add, ahead of the next SRD family: an LLM-driven run of the scenario harness, a call budget, the unmodelled-clause fallback, and a narrative-memory design. The next family is worth less than knowing the boundary survives a model. |
| §14.F reversals | **Unchanged** | No F&F evidence argues for reversing event sourcing, exact geometry, declared cover or refusal-as-value; Craft's move toward model freedom is a move on the reasoning axis, not the truth axis |
| §11 licensing, §6 geometry, §10 determinism | **Unchanged** | F&F publishes nothing that bears on them; note only that determinism is unmentioned as a user need in every source |

**New Critical item for §12:** budget and measure tool-call round trips per player turn before building further engine depth; F&F's economics show that context, latency and cost, not rules fidelity, set the ceiling of an AI-RPG product.
