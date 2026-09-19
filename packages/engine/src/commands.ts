/**
 * Engine-owned state transitions.
 *
 * Some changes are not one event. Dropping to 0 hit points makes a creature
 * Unconscious; healing from 0 lifts that unconsciousness but nothing else;
 * dying ends both. Leaving those follow-ups to whoever called `damage` meant
 * relying on the caller — eventually a language model — to remember bookkeeping
 * the rules already mandate.
 *
 * So a transition that needs several events is produced here as one coherent
 * batch. The caller emits the batch; the reducer applies it. Validation lives
 * here and replay stays in `events.ts`, which is why these return events rather
 * than state.
 *
 * **This file is a barrel, and the commands live in `commands/`.** It was one
 * 10,000-line module with thirteen regions by its own banners, fifteen helpers
 * that crossed them and four filed where nothing called them — and every task
 * that touched a mechanism collided in it, which is what the one-owner-per-
 * primitive rule serialises. The split is by domain along the seams the third
 * whole-engine audit measured, and the modules form a DAG: `commands/command.ts`
 * at the bottom holds what every domain needs, `commands/holds.ts` holds the
 * engine debts every domain has to ask about, and nothing reaches back down.
 *
 * **The re-exports are enumerated rather than starred**, and that is the point
 * of the file: a helper is `export`ed in its own module so a sibling can call
 * it, and is *not* a command. Before the split those two were the same word,
 * because there was one file. This is where they are told apart, so `index.ts`
 * exposes exactly what it exposed before — and `invariants.test.ts` reads this
 * list to know which of the modules’ exports its sweeps are about.
 *
 * **And a name may leave this list, which is the same decision read the other
 * way.** `resolveCast` was published and called by nothing but tests: its one
 * production use, the Divine Smite inside `resolveAttackDamage`, goes through
 * `resolveCastWith`, and CLAUDE.md has said since Counterspell landed that
 * "the operation a tool surface exposes for a spell the engine has a
 * definition for is `resolveSpell`; `resolveCast` is what is left for a spell
 * it has none for." Being the low-level half is a *policy* about who calls it,
 * and a policy that lives only in prose is the thing this file exists to make
 * structural — so it is a module export, its guards are still exercised, and
 * the sweeps that read this list stop asking a non-command a command's
 * questions.
 */

export { ZERO_HIT_POINTS } from './commands/command.js';
export {
  mayAct,
  owedAreaEffectsOf,
  pendingAttackOf,
  pendingCastingsBy,
  pendingCastingsOf,
  pendingDamageOf,
  pendingMoveOf,
  pendingSavesOf,
  pendingTestOf,
} from './commands/holds.js';
export { recordD20Test } from './commands/rolls.js';
export {
  addCreature,
  damageCreature,
  dismissStrandedSummons,
  grantTemporaryHpTo,
  healCreature,
  removeCreatureEverywhere,
  setExhaustionLevel,
  strandedSummons,
  summonCreature,
} from './commands/creatures.js';
export type { AddCreatureOutcome, DamageCommand, Summons } from './commands/creatures.js';
export { applyConditionTo, liftConditionFrom, whyCondition } from './commands/conditions.js';
export { declareCreatureType, declareDifficultTerrain, declareFalling } from './commands/facts.js';
export {
  awardItems,
  declareCreatureDead,
  declareCreatureSide,
  loseItems,
  removeBonusFrom,
  stabiliseCreature,
  swapInitiativeBetween,
  transferItem,
} from './commands/declarations.js';
export type { AwardedItem } from './commands/declarations.js';
export { declareResourcePool, restoreResourcesOn } from './commands/pools.js';
export {
  attuneItem,
  attunedItems,
  carrying,
  chargesLeft,
  coinsOf,
  endAttunement,
  equipItem,
  expendCharges,
  purchaseItem,
  unequipItem,
} from './commands/inventory.js';
export { useItem } from './commands/item-use.js';
export type { ItemUse, UseItemCommand } from './commands/item-use.js';
export {
  ongoingSpellOf,
  ongoingSpellsBy,
  ongoingSpellsOn,
  withheldEndings,
  type WithheldEnding,
} from './commands/ongoing.js';
export {
  applySpellEffect,
  castSpell,
  concentrationSaveAfterDamage,
  continueCasting,
  endConcentration,
  endOngoingSpell,
  nextCastingId,
  resolveDamage,
} from './commands/casting.js';
export type {
  CastCommand,
  CastingPlan,
  ConcentrationConsequence,
  Supply,
  DamageResolution,
  SpellEffectOptions,
} from './commands/casting.js';
export { rollImprovisedDamage } from './commands/damage.js';
export type {
  ImprovisedDamageCommand,
  ImprovisedDamageResolution,
} from './commands/damage.js';
export { resolveAttack, resolveAttackDamage } from './commands/attacks.js';
export type { AttackCommand, AttackDamageCommand, AttackResolution } from './commands/attacks.js';
export {
  declineOpportunity,
  dismountRider,
  mountCreature,
  resolveMove,
  takeOpportunityAttack,
} from './commands/movement.js';
export type { MoveCommand, MoveResolution, OpportunityCommand } from './commands/movement.js';
export { relocateCreature } from './commands/teleport.js';
export type { RelocateCommand, RelocateOutcome } from './commands/teleport.js';
export {
  declineDamageReaction,
  declineTestReaction,
  reactionOpportunities,
  resolveTest,
  settleDamage,
  settleTest,
  takeDamageReaction,
  takeDamageResponse,
  takeTestReaction,
} from './commands/reactions.js';
export type {
  DamageReactionCommand,
  DamageResponseCommand,
  DeclineReactionCommand,
  ReactionResolution,
  SettledDamage,
  SettledTest,
  TestCommand,
  TestReactionCommand,
  TestReactionResolution,
  TestResolution,
} from './commands/reactions.js';
export {
  activateFeature,
  endFeature,
  extendFeature,
  useHealingTouch,
  useRecovery,
  useSelfHeal,
} from './commands/features.js';
export type {
  ActivateFeatureCommand,
  EndFeatureCommand,
  ExtendFeatureCommand,
  HealingTouchCommand,
  UseRecoveryCommand,
  UseSelfHealCommand,
} from './commands/features.js';
export { anchoringFor, eligibleTargets } from './commands/targeting.js';
export type {
  CastSpellRequest,
  EligibleTargets,
  SpellResolution,
  SpellTargetOutcome,
} from './commands/targeting.js';
export { resolveDeclaredCast, resolveSpell } from './commands/spell-resolution.js';
export {
  availableChecks,
  dueDamageOf,
  resolveEffectCheck,
  resolvePendingSaves,
  resolveTurn,
  settleAreaEffects,
} from './commands/turns.js';
export type {
  AreaEffectResolution,
  AvailableCheck,
  EffectCheckCommand,
  EffectCheckResolution,
  ResolvedRepeatSave,
  TurnResolution,
} from './commands/turns.js';
export { activateSpell } from './commands/activation.js';
export type { ActivateSpellCommand } from './commands/activation.js';
export {
  readiedBy,
  releaseReady,
  takeDash,
  takeDisengage,
  takeDodge,
  takeReady,
  useFreeObjectInteraction,
} from './commands/actions.js';
export type {
  DisengageOptions,
  ReadyCommand,
  ReadyRelease,
  ReadyResponse,
  ReleaseCommand,
} from './commands/actions.js';
export {
  joinCombat,
  recordInitiativeRolls,
  rollInitiativeAndBeginCombat,
  rollInitiativeFor,
} from './commands/initiative.js';
export type { InitiativeEntrant } from './commands/initiative.js';
export {
  addSceneLandmark,
  advanceTime,
  beginCombat,
  declareCoverBetween,
  declareDawn,
  declareSightBetween,
  declareSpellcasting,
  placeCreatureInScene,
  setScene,
} from './commands/scene.js';
