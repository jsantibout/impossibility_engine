/**
 * The tools themselves: one definition per command a DM or a model may call.
 *
 * ## The rule that decided what is here
 *
 * **A tool is on this surface only if the caller supplies no mechanically
 * authoritative number through it.** That rule excluded more than it let in,
 * and the exclusions are the load-bearing half:
 *
 * | Not exposed | Why |
 * |---|---|
 * | `recordExternalD20`, `recordExternalDamage` | the human-DM override path. `CLAUDE.md` rule 1: "never exposed to an AI one". `boundary.test.ts` sweeps every way of importing them, and asserts neither is on this package's own exports. |
 * | `resolveDamage`, `damageCreature`, `healCreature`, `grantTemporaryHpTo` | take an `amount` |
 * | `setExhaustionLevel`, `recordD20Test` | assert an outcome the rules decide |
 * | `resolveTest` (an ability check against a DC) | the DM sets a DC, which is a number. Genuinely the DM's under SRD — and therefore a *human-DM* surface, which step one is not. |
 * | `AttackCommand.modes` / `.attackBonuses` / `.damageBonuses` / `.extraDamage` | modifiers a caller states. Every one the engine can see it reads for itself. |
 * | `CharacterChoices.hitPoints: 'rolled'`, `abilities: 'manual'`, and any non-empty `dmGrants` | dice results, unchecked scores, and a live magic item. See `schemas.ts`. |
 * | `applyConditionTo`'s `duration: seconds` | invariant 7 lists durations among the quantities the engine calculates. A *moment in the turn order* is not a number, and those three are offered. |
 *
 * And the numbers a caller **does** supply, because the line is worth
 * drawing in both directions. Each is a decision the rules leave open, and
 * every one is validated by the engine against something authoritative:
 *
 * | Supplied | Checked against |
 * |---|---|
 * | `slotLevel` | a resource *choice*, not a quantity: the caster's remaining slots |
 * | `feet`, `bearing`, `elevation` on a placement | the scene's extent, the lattice, occupancy — and, for a move, the Speed left |
 * | `x`, `y`, `z` on a landmark, an area's origin or a patch of rough ground, and that patch's `radius` | the scene's extent. This is map-making, and something has to anchor the room |
 * | `width`, `depth`, `height` on a scene | nothing. A room's size is fiction, and the engine holds it only so a 60-foot tavern cannot contain a 1000-foot gap |
 * | `difficultFeet` on a move | the move's own distance. Declared terrain, on the same grounds as cover: five of SRD's six cases are fiction, and working them out means modelling the room. Its only direction of abuse is self-harm |
 * | `route` on a move, `via` on an activation | `checkRoute`, which takes only a walk of single spaces between two endpoints the engine worked out itself — and then charges what its own ground says. A route is which way somebody went, and the cost of going that way is never the caller's |
 * | `damageType` on a casting | the list the spell prints. A handful print one — Chromatic Orb, Sorcerous Burst, Protection from Energy, Fire Shield, Spirit Guardians — and the SRD leaves which lands to the caster or to what the caster is; the engine refuses to choose, and refused to hear an answer until this field existed |
 * | `fought` on a casting | the roster. Which creatures you are already fighting is a fact about the fiction — the Charms roll *the target's* save with Advantage for it, so naming one is against the caster's own interest — and an empty list is the answer "none of them" |
 * | `teleportTo` on a casting | the distance the spell prints, the space being unoccupied, the scene's extent and declared sight. A placement like every other, measured from a landmark or a creature |
 * | `slotKind`, `payment`, `source` on a casting | resource *choices* of the same kind as `slotLevel`: which of two pools a Warlock multiclass spends, whether a grant's free casting or a slot pays, which class or feature casts it. Each is refused unless the caster actually has it |
 * | `usingFeatures` on a casting | the caster's own sheet. It carries no number at all: it says the caster is using a feature they hold, and the engine reads the feature, decides whether it reaches this casting and does the arithmetic. SRD writes these as "you can", so silence declines them |
 * | `hitPoints` on a drawing from a healing pool | the pool itself. SRD Lay On Hands: "restore a number of Hit Points to that creature, **up to the maximum amount remaining in the pool**" — how much of your *own* pool to spend is a decision the rules hand the player, which is `slotLevel`'s case exactly. The engine refuses a drawing the pool cannot cover before anything is spent, caps what arrives at the target's maximum, and charges the feature's own price for each condition lifted |
 * | `by` on an extension | nothing, and it is a fact rather than a price. SRD Rage offers three ways to extend and only one costs anything; the engine can see neither of the other two, so the caller says which happened and the log records it, as `fought` records who is already in melee |
 * | `burns` on ending a turn | the emanation. SRD Fire Aura burns "each creature of the azer's choice" and the engine has nobody to ask, so the caller names them and the engine measures — a creature named outside the radius is simply not caught, and a list naming nobody burns nobody. `fought`'s case exactly: a list of creature ids carrying no number, checked against the scene |
 *
 * The consequence is deliberate: an action the engine does not model has no
 * legal path through this surface at step one. It finds a rule the engine
 * owns, or it is refused.
 *
 * ## What the slice covers
 *
 * Enough to run a fight end to end, and nothing beyond it. Initiative, the
 * scene and the facts a fight needs declared — sides, types, sight, cover,
 * where the ground is rough and who is falling — movement, attacks, casting,
 * acting again through a spell already running, conditions applied and ended,
 * the two engine debts that can wedge a fight (a held move, an owed area
 * effect), the turn boundary, and the three queries a caller needs to choose
 * among them. Rests, advancement, inventory, equipment, items, readied
 * actions and mounts are all left for later batches; none of them is needed
 * to fight.
 *
 * And, since a fight is fought by a character rather than by a spell list:
 * what that character holds and the four ways of spending it. `sheet` is the
 * read — slots, pools, features, and for each feature the tool that spends it
 * — and the four are an activation with its extension and its dismissal, a
 * self-heal, a healing touch and a recovery. `sheet` carries the spell list
 * too, because a caster that cannot see its own prepared spells types ids
 * from memory, and because the routes it reports are what `source` and
 * `payment` choose between. They are here because a model
 * that cannot see its own Rages cannot spend one, and one that has not been
 * told it holds Empowered Evocation cannot elect it.
 *
 * **The three pools the engine held with no door are open, and the rule that
 * shut them is why they opened one at a time.** "A pool a caller could spend
 * for no effect is worse than a pool it cannot spend, because the use would
 * be gone" — so Channel Divinity, Bardic Inspiration and Action Surge were
 * all left shut while nothing executed what a use bought. A pool use became
 * the third host of an effect list, so `use_pool_option` spends a Cleric's; a
 * conferred Reaction became a real Reaction with an hour on it and a door
 * that takes it, so `confer_reaction` spends a Bard's; and a use became able
 * to buy room in the turn's own budget, so `use_budget_purchase` spends a
 * Fighter's Action Surge and a Monk's Flurry of Blows. Each door landed the
 * week its mechanism did, which is the rule rather than an accident of order.
 * **Paladin's Channel Divinity is still shut**, and by the original sentence
 * — it prints no option the engine executes, so `sheet` reports no feature
 * line for it and there is nothing here to call. `reachability.test.ts` holds
 * the whole of that claim: every feature the engine executes at level 5 is
 * reachable from here, or is one of the four pools recorded as still shut.
 *
 * **And `spendFor` is not a command, so it is not a door either.** It is the
 * helper in `commands/command.ts` that the four feature commands costing an
 * action call to pay for themselves — an activation, its extension, a
 * self-heal and a healing touch — along with an item's activation. A recovery
 * calls it not at all, because a recovery costs no action. It is reached here
 * exactly as they reach it: through the tools above, each of which spends what
 * its own feature costs. A tool over it would let a caller burn an Action or a
 * Bonus Action for nothing at all, which is the Channel Divinity argument
 * again with the action economy in place of a pool.
 *
 * A spell's *own* teleport is here, since `cast_spell.teleportTo` is the
 * field Misty Step's refusal names; a `teleport` tool moving a creature for
 * reasons of its own is not, and is still a later batch's.
 *
 * ## Why each tool declares what it establishes
 *
 * `docs/design/claude-integration.md`: "Every `ContextRequest.kind` must map
 * to a tool that declares it — a kind with no door is the failure to test
 * for." So the mapping is a field on the definition rather than a paragraph,
 * and `boundary.test.ts` asserts that every kind the engine has is covered.
 *
 * ## And why a few of them answer their own questions
 *
 * That mapping is global — a kind goes in and the tools that declare it come
 * out — which is the right shape for a fact one call establishes and another
 * call then uses. It is the wrong shape for the other kind of question: the
 * one a caller answers by **re-sending the very call that asked**, with a
 * field filled in. `route` is already that kind by convention, which
 * `doors.test.ts` says in as many words beside `move.route` and
 * `activate_spell.via`: "established by re-sending the *same* call with a
 * field filled in rather than by a declaration of its own".
 *
 * `swap_initiative` raises one, and the global mapping answered it with
 * `activate_spell` and `move` — a caller asked whether its friend agreed to
 * trade Initiative, and told to cast a spell. So a tool may name the kinds it
 * answers *on itself*, and for those the door it is handed the answer through
 * is the tool the caller is already holding. It is a narrowing and never a
 * widening: nothing else's `doorsFor` changes, so a `route_required` from
 * `move` still names `move`.
 */

import type { CharacterId, ConditionName, Result } from '@ie/shared';
import { asCharacterId, needsContext, ok } from '@ie/shared';
import type {
  AddCreatureOutcome,
  AdvanceChoices,
  CharacterChoices,
  CastSpellRequest,
  CombatEnding,
  Duration,
  CombatantInput,
  FeatChoice,
  GameEvent,
  GameState,
  InitiativeEntrant,
  MasteryUse,
  Placement,
  Point,
} from '@ie/engine';
import {
  activateDevice,
  activateFeature,
  activateSpell,
  addCreature,
  advanceCharacter,
  addSceneLandmark,
  advanceTime,
  applyConditionTo,
  assumeShape,
  revertShape,
  applyEvent,
  areaPointAt,
  attuneItem,
  availableChecks,
  awardItems,
  conferReaction,
  continueCasting,
  beginRest,
  createCharacter,
  createDevice,
  dismantleDevice,
  declareCoverBetween,
  declareCreatureSide,
  declareCreatureType,
  declareDawn,
  declareDifficultTerrain,
  declareLight,
  declareObscurement,
  declareFalling,
  declareSightBetween,
  declineDamageReaction,
  declineOpportunity,
  declineTestReaction,
  dismissStrandedSummons,
  dismountRider,
  eligibleTargets,
  endAttunement,
  endCombat,
  endConcentration,
  endFeature,
  endOngoingSpell,
  endRest,
  equipItem,
  extendFeature,
  INITIATIVE_LABEL,
  joinCombat,
  MAX_LEVEL,
  mayAct,
  mountCreature,
  placeCreatureInScene,
  positionOf,
  purchaseItem,
  reactionOpportunities,
  recordInitiativeRolls,
  releaseReady,
  resolveAttack,
  resolveAttackDamage,
  resolveDeclaredCast,
  resolveEffectCheck,
  resolveMove,
  resolveSpell,
  resolvePendingSaves,
  resolveTurn,
  rollInitiativeAndBeginCombat,
  setScene,
  settleAreaEffects,
  settleDamage,
  speedOf,
  stabiliseCreature,
  strandedSummons,
  summonCreature,
  swapInitiativeBetween,
  takeAttackReaction,
  takeDamageReaction,
  takeDamageResponse,
  takeDash,
  takeDisengage,
  takeDodge,
  takeHelp,
  takeHide,
  takeUtilize,
  takeItemUp,
  takeReady,
  takeOpportunityAttack,
  takeTestReaction,
  tradeResource,
  transferItem,
  dropConjured,
  dropItem,
  evokeConjured,
  unequipItem,
  useBudgetPurchase,
  useFreeObjectInteraction,
  useHealingTouch,
  useItem,
  usePoolOption,
  useRecovery,
  useSelfHeal,
  wakeCreature,
} from '@ie/engine';
import { z } from 'zod';
import type { Campaign } from './campaign.js';
import { resolveGear } from './bestiary.js';
import { holdingsOf } from './holdings.js';
import { observe } from './observe.js';
import type { ArgumentIssue, ContextRequestKind, ToolOutcome } from './outcome.js';
import { fromErr, invalid, okOutcome, refused } from './outcome.js';
import {
  abilitySchema,
  cantripSwingSchema,
  characterChoicesSchema,
  conditionDurationSchema,
  conditionSchema,
  creatureId,
  damageTypeSchema,
  hitRiderSchema,
  masterySchema,
  placementSchema,
  pointSchema,
  routeSchema,
  sensesFields,
  sizeSchema,
  skillSchema,
} from './schemas.js';

// — the shape of a definition —————————————————————————————————————————————

/**
 * **Several of the declarations below are exported for the DM's surface**,
 * which lives under `dm/` and is built out of exactly the same plumbing: the
 * `tool` factory, the `settle` protocol and its `settleEvents` shorthand, the
 * `identity` that carries the transport's id, and the two converters that
 * turn a caller's strings into the engine's vocabulary. A second copy of any
 * of them would be a second answer to "what is an outcome", and the outcome
 * is the contract both surfaces publish.
 *
 * The direction is one-way and structural. `dm/` imports this file; nothing
 * here may import `dm/`, and `dm/boundary.test.ts` walks the imports out of
 * `surface.ts` to prove it. `settle` in particular stays *here*, beside the
 * only two `campaign.append` call sites in the package, because where the log
 * is written is a fact worth being able to count.
 */

export interface ToolContext {
  readonly campaign: Campaign;
  /**
   * The transport's `tool_use.id`, never a field the caller filled.
   *
   * It is the idempotency key the engine fingerprints, so a retry of a call
   * the transport already made is a no-op rather than a second casting.
   */
  readonly commandId: string;
  /** Which tools declare a given `ContextRequest.kind`. */
  readonly doorsFor: (kind: ContextRequestKind) => readonly string[];
}

export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  /** Whether a call can write to the log. Queries are free. */
  readonly mutates: boolean;
  /** Which `ContextRequest.kind`s a successful call establishes. */
  readonly establishes: readonly ContextRequestKind[];
  /**
   * Which kinds this tool answers **on itself** — a field of its own schema,
   * filled in and the same call re-sent.
   *
   * A request of one of these kinds raised by this tool names *this* tool as
   * its door, in place of whatever the surface-wide mapping would have said.
   * `doors.test.ts` holds each one to having a field that really carries it.
   */
  readonly selfAnswers: readonly ContextRequestKind[];
  /** The Zod schema, for a caller that wants to publish it as JSON Schema. */
  readonly schema: z.ZodType;
  /** Validate, then run. Never throws for anything a caller could have sent. */
  invoke(context: ToolContext, raw: unknown): ToolOutcome;
}

export interface ToolSpec<S extends z.ZodType> {
  readonly name: string;
  readonly description: string;
  readonly mutates: boolean;
  readonly establishes?: readonly ContextRequestKind[];
  readonly selfAnswers?: readonly ContextRequestKind[];
  readonly input: S;
  readonly run: (context: ToolContext, args: z.infer<S>) => ToolOutcome;
}

/**
 * Zod's complaint, addressed to whoever sent the call.
 *
 * The path is what makes it actionable — "targets.0 must be a string" is a
 * thing a caller can fix, and "invalid input" is not.
 */
const issuesOf = (error: z.ZodError): readonly ArgumentIssue[] =>
  error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }));

export function tool<S extends z.ZodType>(spec: ToolSpec<S>): ToolDefinition {
  const selfAnswers = spec.selfAnswers ?? [];
  return {
    name: spec.name,
    description: spec.description,
    mutates: spec.mutates,
    establishes: spec.establishes ?? [],
    selfAnswers,
    schema: spec.input,
    invoke(context, raw): ToolOutcome {
      const parsed = spec.input.safeParse(raw);
      if (!parsed.success) {
        const issues = issuesOf(parsed.error);
        return invalid(
          'malformed_arguments',
          `${spec.name} was sent arguments it cannot read: ` +
            issues.map((i) => (i.path === '' ? i.message : `${i.path}: ${i.message}`)).join('; '),
          issues,
        );
      }
      // The one place a tool's own name gets into the answer: a kind it says
      // it answers on itself is answered *here*, and every other kind is the
      // surface's to route. Wrapped once, around `run`, so that every path out
      // of this tool — `settle`, a hand-built `establish`, a second command —
      // gets the same door without each remembering to.
      return spec.run(
        selfAnswers.length === 0
          ? context
          : {
              ...context,
              doorsFor: (kind) =>
                selfAnswers.includes(kind) ? [spec.name] : context.doorsFor(kind),
            },
        parsed.data as z.infer<S>,
      );
    },
  };
}

// — turning an engine result into an outcome ————————————————————————————————

/**
 * The whole protocol, in one function: append on success, translate on
 * refusal, and never throw either way.
 *
 * Events are appended **only** here, and only from what a command returned.
 * There is no path from a tool to the log that does not pass through an
 * engine command, which is invariant 1 kept by construction.
 */
export function settle<T>(
  context: ToolContext,
  result: Result<T>,
  eventsOf: (value: T) => readonly GameEvent[],
  resolutionOf: (value: T) => Readonly<Record<string, unknown>>,
  unverifiedOf: (value: T) => readonly string[] = () => [],
): ToolOutcome {
  if (!result.ok) return fromErr(result, context.doorsFor);
  const events = eventsOf(result.value);
  context.campaign.append(events);
  return okOutcome(events, resolutionOf(result.value), unverifiedOf(result.value));
}

/** The common case: a command that answers with nothing but its events. */
export const settleEvents = (
  context: ToolContext,
  result: Result<readonly GameEvent[]>,
  resolution: Readonly<Record<string, unknown>> = {},
): ToolOutcome => settle(context, result, (events) => events, () => resolution);

/**
 * The transport's id, or a derivation of it for a tool that runs two
 * commands.
 *
 * `identify` fingerprints `kind` alongside the id, and the kind already
 * carries the operation, so `X:roll` and `X:join:orin` cannot collide with
 * each other or with a bare `X` — the suffix is there so that two `once`
 * wrappers under one call do not fingerprint the same id twice, which is the
 * mistake `commands/initiative.ts` documents. Two caveats, both benign and
 * both worth knowing: a transport id that itself ended in `:roll` would
 * collide with a derived one, and a retry of `roll_initiative` after the
 * creature's Speed changed is answered `command_id_reused` rather than as a
 * duplicate, because the Speed is pinned into the fingerprint.
 */
export const identity = (context: ToolContext, suffix = ''): { commandId: string } => ({
  commandId: suffix === '' ? context.commandId : `${context.commandId}:${suffix}`,
});

/**
 * Zod's choices, in the engine's creation vocabulary.
 *
 * Nothing is translated and nothing is defaulted; the only work here is
 * **dropping keys whose value is `undefined`**. `exactOptionalPropertyTypes`
 * makes "absent" and "present and undefined" different types, the engine's
 * vocabulary asks for the first, and an optional Zod field produces the
 * second. Written out field by field rather than stripped generically,
 * because a generic strip would need a cast and a cast is exactly where a
 * schema drifting from the vocabulary would stop being a compile error.
 */
function choicesOf(input: z.infer<typeof characterChoicesSchema>): CharacterChoices {
  const {
    subclassId,
    multiclass,
    spellsByClass,
    featureSpellcasting,
    knownForms,
    dmGrants,
    ...rest
  } = input;
  return {
    ...rest,
    ...(subclassId === undefined ? {} : { subclassId }),
    // The ability an origin trait asks for, keyed by the trait — absent on
    // every character whose species grants no spell, which is most of them.
    ...(featureSpellcasting === undefined ? {} : { featureSpellcasting }),
    // The forms a shape-shifting feature has learned — absent on every
    // character but a Druid's, and on a Druid who has not chosen yet.
    ...(knownForms === undefined ? {} : { knownForms }),
    ...(multiclass === undefined
      ? {}
      : {
          multiclass: multiclass.map((entry) => ({
            classId: entry.classId,
            level: entry.level,
            ...(entry.subclassId === undefined ? {} : { subclassId: entry.subclassId }),
          })),
        }),
    ...(spellsByClass === undefined
      ? {}
      : {
          spellsByClass: Object.fromEntries(
            Object.entries(spellsByClass).map(([classId, chosen]) => [
              classId,
              {
                ...(chosen.cantrips === undefined ? {} : { cantrips: chosen.cantrips }),
                ...(chosen.spellbook === undefined ? {} : { spellbook: chosen.spellbook }),
                ...(chosen.preparedSpells === undefined
                  ? {}
                  : { preparedSpells: chosen.preparedSpells }),
              },
            ]),
          ),
        }),
    // The two lists are empty tuples in the schema, so there is nothing to
    // map: this surface grants no equipment and no magic item. The note is
    // the whole of what a caller says here.
    ...(dmGrants === undefined
      ? {}
      : { dmGrants: { items: [], goldPieces: 0, magicItems: [], note: dmGrants.note } }),
  };
}

export const who = (id: string): CharacterId => asCharacterId(id);

/**
 * A caller's phrase for why, turned into the source the log will carry.
 *
 * **One function because two surfaces write it.** The model's
 * `apply_condition` imposes a ruled condition and the DM's `end_condition`
 * lifts one *by naming its source*, so the two have to spell the prefix
 * identically or a condition applied through one door cannot be lifted
 * through the other. One campaign may have both surfaces over it, which makes
 * that a live crossing rather than a hypothetical one — and two string
 * literals agreeing is not a thing a reader can check.
 */
export const ruled = (why: string): string => `DM ruling: ${why}`;

const point = (input: z.infer<typeof pointSchema>): Point => ({
  x: input.x,
  y: input.y,
  z: input.z ?? 0,
});

/**
 * A caller's placement, in the engine's vocabulary.
 *
 * The size is taken as a *separate* optional field rather than out of
 * {@link placementSchema}, because only one of the three tools that build a
 * placement declares one. A caller that sends none leaves the key off
 * entirely, and `placeCreatureInScene` fills it from the size the creature's
 * own `creature-added` pinned.
 */
const placementOf = (
  input: z.infer<typeof placementSchema> & { readonly size?: Placement['size'] },
): Placement => ({
  from:
    input.fromLandmark !== undefined
      ? { landmark: input.fromLandmark }
      : { creature: who(input.fromCreature!) },
  feet: input.feet,
  ...(input.bearing === undefined ? {} : { bearing: input.bearing }),
  ...(input.elevation === undefined ? {} : { elevation: input.elevation }),
  ...(input.size === undefined ? {} : { size: input.size }),
});

/**
 * A caller's mastery, in the engine's vocabulary.
 *
 * Three optional fields dropped when absent, for {@link choicesOf}'s reason:
 * `exactOptionalPropertyTypes` makes "absent" and "present and undefined"
 * different types and the engine's vocabulary asks for the first.
 *
 * **No cast anywhere in it**, which is the point of writing it out: the enum
 * in {@link masterySchema} is the same eight strings as the engine's
 * `WeaponMastery`, so the assignment is checked. A schema that drifted from
 * the rules' vocabulary would fail here rather than be waved through, which is
 * exactly what {@link sizeSchema}'s note promises of a spelled-out list.
 */
const masteryOf = (input: z.infer<typeof masterySchema>): MasteryUse => ({
  ...(input.property === undefined ? {} : { property: input.property }),
  ...(input.feet === undefined ? {} : { feet: input.feet }),
  ...(input.cleaving === undefined ? {} : { cleaving: who(input.cleaving) }),
});

export const senses = (input: {
  readonly requiresSight?: boolean | undefined;
  readonly requiresHearing?: boolean | undefined;
}): { senses?: { requiresSight?: boolean; requiresHearing?: boolean } } => {
  if (input.requiresSight !== true && input.requiresHearing !== true) return {};
  return {
    senses: {
      ...(input.requiresSight === true ? { requiresSight: true } : {}),
      ...(input.requiresHearing === true ? { requiresHearing: true } : {}),
    },
  };
};

/**
 * Which way a directional area points, said the way a DM speaks.
 *
 * A creature, a landmark, or an explicit point — never an angle, because an
 * angle is the caller typing raw geometry.
 *
 * **A creature or landmark nobody has placed is homework, not a verdict.**
 * The first draft of this made it a refusal, which is the mistake
 * `result.ts` names in so many words: "sorry, that creature has no position"
 * is the engine's problem leaking out as the game's. Nothing is wrong with
 * the call — a fact it needs has not been supplied — so it asks, and names
 * the command that would supply it.
 */
function towardsOf(
  state: GameState,
  input: {
    readonly towardsCreature?: string | undefined;
    readonly towardsLandmark?: string | undefined;
    readonly towards?: z.infer<typeof pointSchema> | undefined;
  },
): Result<Point | undefined> {
  // The scene first, or an unplaced creature and an unset room come back as
  // the same request — and only one of them is repaired by placing anybody.
  // `sceneFor` is the engine's own wording for this and is not reachable
  // from here, so the request is written out in the same shape.
  if (input.towardsCreature !== undefined || input.towardsLandmark !== undefined) {
    const subject = input.towardsCreature ?? input.towardsLandmark!;
    if (state.scene === null) {
      return needsContext('no_scene', `there is no scene for ${subject} to be aimed at in`, [
        {
          kind: 'scene',
          subject,
          need: 'a scene, so that a place in it means something',
          because: `${subject} to be aimed at`,
          satisfyWith: 'a setScene command',
        },
      ]);
    }
  }

  if (input.towardsCreature !== undefined) {
    const at = positionOf(state.scene!, who(input.towardsCreature));
    if (at === null) {
      const subject = input.towardsCreature;
      return needsContext(
        'no_such_position',
        `nobody has said where ${subject} is standing, and the area is being aimed at them`,
        [
          {
            kind: 'position',
            subject,
            need: `where ${subject} is standing`,
            because: 'a Cone, Cube or Line is aimed at a point, and this one is aimed at a creature',
            satisfyWith: `a placeCreatureInScene command for ${subject}`,
          },
        ],
      );
    }
    return ok({ x: at.x, y: at.y, z: at.z });
  }
  if (input.towardsLandmark !== undefined) {
    const at = state.scene!.landmarks[input.towardsLandmark];
    if (at === undefined) {
      const subject = input.towardsLandmark;
      return needsContext(
        'no_such_landmark',
        `nobody has put a landmark called ${subject} in this room, and the area is being aimed at it`,
        [
          {
            kind: 'scene',
            subject,
            need: `a landmark called ${subject}, and where it stands`,
            because: 'a Cone, Cube or Line is aimed at a point, and this one is aimed at a landmark',
            satisfyWith: `an addSceneLandmark command for ${subject}`,
          },
        ],
      );
    }
    return ok({ x: at.x, y: at.y, z: at.z });
  }
  return ok(input.towards === undefined ? undefined : point(input.towards));
}

// — the definitions ————————————————————————————————————————————————————————

const LOOK = tool({
  name: 'look',
  description:
    'Read the authoritative state: who is here, what they can take, whose turn it is, and what the engine is owed. Free, and changes nothing.',
  mutates: false,
  input: z.object({}),
  run: (context) => okOutcome([], { ...observe(context.campaign.state()) }),
});

/**
 * What is open to a creature right now — and one field named carefully.
 *
 * `blockedByDebt` is `mayAct` and nothing more, which is narrower than "may
 * act" sounds: the engine's `mayAct` answers about **debts the world owes** —
 * an unsettled area effect, a turn start nobody resolved — and says nothing
 * whatever about Paralyzed, dead, or whose turn it is. Publishing that as
 * `mayAct: true` for a Paralyzed creature would be this layer's error rather
 * than the engine's, because a caller would act on it. What the engine calls
 * its own function is the engine's business; what goes on the wire is this
 * package's.
 */
const OPTIONS = tool({
  name: 'options',
  description:
    'What is open to one creature right now: any engine debt standing in its way, which Reactions are offered to it, and which checks an ongoing effect lets it attempt. Free, and changes nothing. This does not answer whether the creature is Paralyzed or whether it is their turn — `look` reports conditions and whose turn it is, and the command itself refuses if it is neither.',
  mutates: false,
  input: z.object({ who: creatureId }),
  run: (context, args) => {
    const state = context.campaign.state();
    const id = who(args.who);
    const blocked = mayAct(state, id);
    return okOutcome([], {
      blockedByDebt: blocked === null ? null : { code: blocked.code, reason: blocked.reason },
      reactions: reactionOpportunities(state, context.campaign.content)
        .filter((offer) => offer.reactor === id)
        .map((offer) => ({
          id: offer.id,
          name: offer.name,
          window: offer.window,
          costsReaction: offer.costsReaction,
          ...(offer.casting === undefined ? {} : { casting: offer.casting }),
        })),
      checksAvailable: availableChecks(state, id).map((check) => ({
        effectKey: check.effectKey,
        label: check.label,
        dc: check.dc,
      })),
    });
  },
});

const ELIGIBLE_TARGETS = tool({
  name: 'eligible_targets',
  description:
    'The shortlist of creatures a spell could legally be aimed at, with a reason for everyone left off it, and the facts that would have to be established before the rest could be judged. Free, and changes nothing. A shortlist, not a choice: you still name the target you meant.',
  mutates: false,
  input: z.object({
    caster: creatureId,
    spellId: z.string().min(1).describe('SRD spell id, e.g. hold-person.'),
    slotLevel: z.int().min(0).max(9).optional().describe('Slot level, if a levelled spell.'),
    at: pointSchema
      .optional()
      .describe(
        'Where an area spell would be centred. An area catches whoever is standing in it, so without this the answer for one is a request for the point rather than a list.',
      ),
    towards: pointSchema
      .optional()
      .describe('Point a Cone, Cube or Line at this exact spot, for an area spell that needs one.'),
  }),
  run: (context, args) => {
    const shortlist = eligibleTargets(
      context.campaign.state(),
      context.campaign.content,
      who(args.caster),
      args.spellId,
      args.slotLevel ?? 0,
      {
        ...(args.at === undefined ? {} : { at: point(args.at) }),
        ...(args.towards === undefined ? {} : { towards: point(args.towards) }),
      },
    );
    return okOutcome([], {
      eligible: shortlist.eligible,
      excluded: shortlist.excluded.map((entry) => ({ target: entry.target, reason: entry.reason })),
      establish: shortlist.needsContext.map((request) => ({
        kind: request.kind,
        subject: request.subject,
        need: request.need,
        because: request.because,
        satisfyWith: request.satisfyWith,
        tools: context.doorsFor(request.kind),
      })),
    });
  },
});

/**
 * Create a player character, which is the surface's door for a missing
 * creature.
 *
 * `createCharacter` takes no `CommandIdentity`, so the creature id is the
 * idempotency key instead — the same answer `addCreature` reaches by its own
 * route. A retry that would create the same character again is a no-op; one
 * that would create a *different* character under a taken id is a refusal,
 * because a second `creature-added` for a live id is what the reducer calls a
 * corrupt log.
 *
 * **"The same character" is decided by building it and comparing**, rather
 * than by the name. Creation is pure and cheap, so the honest comparison is
 * available: a second Kessa who is a level 5 Barbarian is a different
 * character wearing a taken name, and answering that with `duplicate: true`
 * would be swallowing a mistake — which `idempotency.ts` calls the worst of
 * both worlds. The plan is thrown away unless it is used.
 */
const CREATE_CHARACTER = tool({
  name: 'create_character',
  description:
    'Create a player character from its choices, and put it in the game. The engine derives every number from the choices — hit points, Armour Class, proficiency, slots, starting equipment — and refuses a combination the rules do not allow, naming the choice at fault. Hit points are the SRD fixed average; this surface does not take rolled ones.',
  mutates: true,
  establishes: ['creature'],
  input: z.object({
    id: creatureId.describe('The id this character will have in play, e.g. kessa.'),
    choices: characterChoicesSchema,
  }),
  run: (context, args) => {
    const state = context.campaign.state();
    const id = who(args.id);
    const planned = createCharacter(context.campaign.content, choicesOf(args.choices), id);
    const existing = state.creatures[id];
    if (existing !== undefined) {
      if (planned.ok && alreadyWritten(context.campaign.log(), id, planned.value)) {
        return okOutcome([], { created: id, duplicate: true });
      }
      return refused(
        'id_taken',
        `${id} is already ${existing.name}, and this is not the same character; choose another id`,
      );
    }
    return settleEvents(context, planned, { created: id, name: args.choices.name });
  },
});

/**
 * Whether these are, event for event, the events that already created this
 * creature.
 *
 * **The whole batch, not the creature record.** Comparing the folded
 * `CreatureState` was the first attempt and it compares too little: the
 * sheet carries abilities, armour, Speed and level, and carries neither the
 * prepared list, the spellbook, the starting equipment nor the class. A
 * second Kessa with a different equipment pack folded to a byte-identical
 * creature and was answered `duplicate: true`, which is the mistake being
 * swallowed rather than refused.
 *
 * Creation is deterministic and reads no state, so the events it would write
 * now are exactly the events it wrote then — and `settle` appends a
 * command's events in one block, so they are contiguous from the
 * `creature-added` that opens them. Comparing that slice is comparing the
 * character, all of it, with nothing left to remember.
 */
function alreadyWritten(
  log: readonly GameEvent[],
  id: CharacterId,
  planned: readonly GameEvent[],
): boolean {
  const opens = log.findIndex((event) => event.type === 'creature-added' && event.id === id);
  if (opens === -1) return false;
  return JSON.stringify(log.slice(opens, opens + planned.length)) === JSON.stringify(planned);
}

/**
 * A monster out of the bestiary, on the board and holding what it prints.
 *
 * **The id, never the block.** `addCreature` takes a stat block's id and reads
 * the block out of content for exactly the reason this surface exists: an
 * entry point that accepts a stat block is the door a model-authored Armour
 * Class walks through, and nothing guards it. A tool over it that took
 * `{ armorClass: 15 }` would reopen that door one layer up, so this one takes
 * two strings — what to call the creature, and which block it is — and every
 * number in the event is the engine's reading of the book. `unknown_monster`
 * is the refusal that makes the id mean something, and `monsterId` is where a
 * caller puts a better one.
 *
 * **Two commands, because a monster that cannot swing is not on the board.**
 * `resolveAttack` refuses a weapon its wielder does not own, so a Goblin
 * Warrior added and not armed is a goblin that cannot make the Scimitar attack
 * its own stat block prints — present, and unable to do the single thing it
 * was added to do. So the arrival is composed with `awardItems` for the gear
 * the catalogue resolves, under a derived command id exactly as
 * `roll_initiative` composes its two, and appended once through `settle` when
 * both have succeeded.
 *
 * It arms and does not *equip*. A stat block's Armour Class is printed and
 * carried as stated, so the Leather Armor in a goblin's hands is a record of
 * what it has rather than a second opinion about what it is worth — and
 * equipping it would be this layer volunteering an arithmetic the book already
 * did.
 *
 * **What the catalogue cannot find is reported, not refused.** See
 * `bestiary.ts`: a Mage prints `Wand` and the equipment tables have no wand,
 * and a missing line of flavour is not a reason there is no Mage. The names
 * come back through `unverified`, beside the qualified defences `addCreature`
 * withholds for the same reason.
 *
 * **It declares no side**, which is the engine's division rather than a gap:
 * allegiance changes in play, so `declare_side` is its own call. It **does**
 * declare what the block casts, and that sentence used to sit beside this one
 * saying the opposite — a stat block's Spellcasting line was English prose
 * nothing had parsed, so an NPC who cast took a second call nobody on this
 * surface could make. The line is structure now, so the spells, the printed
 * numbers and the per-day pools arrive with the creature.
 */
const ADD_CREATURE = tool({
  name: 'add_creature',
  description:
    'Put a monster into the game from the bestiary, by the id of its stat block. The engine reads every number off the block — Armour Class, hit points, saves, defences, size — and hands the creature the gear the block prints so that it can use it. Where the block prints a Spellcasting line it arrives able to cast those spells, at the numbers the block prints and with the At Will and N/Day prices it names: `look` reports them and `cast_spell` spends them. You say only what to call it and which monster it is. Declare its side separately; allegiance changes in play.',
  mutates: true,
  establishes: ['creature'],
  input: z.object({
    id: creatureId.describe('The id this creature will have in play, e.g. grish.'),
    monsterId: z
      .string()
      .min(1)
      .describe('Which stat block, by its id in the bestiary, e.g. goblin-warrior or ogre.'),
  }),
  run: (context, args) =>
    settle(
      context,
      bringIn(context, who(args.id), args.monsterId),
      (arrival) => arrival.events,
      (arrival) => arrival.resolution,
      (arrival) => arrival.unverified,
    ),
});

/** What the two commands behind {@link ADD_CREATURE} answered, put together. */
interface MonsterArrival {
  readonly events: readonly GameEvent[];
  readonly resolution: Readonly<Record<string, unknown>>;
  readonly unverified: readonly string[];
}

/**
 * The arrival and the arming, as one result.
 *
 * Built rather than settled twice, so that `settle` stays the only writer: a
 * refusal from either command returns before anything is appended, which is
 * what makes a half-armed monster impossible rather than merely unlikely. The
 * award runs against a *working* state stepped by the engine's own reducer,
 * because the creature it hands items to is one this call has just written.
 *
 * **Written over the arrival rather than over `addCreature`**, because there
 * are two ways a stat block comes into a game and both need the gear: a DM
 * walking a monster through the door, and a casting summoning one. The
 * argument for arming is the same in both — `resolveAttack` refuses a weapon
 * its wielder does not own, so a hound summoned and not armed cannot make the
 * attack its own block prints — and `summonCreature` composes `addCreature`
 * and hands out nothing, because the engine holds no catalogue and reads no
 * name. `describing` is the caller's half of the answer: which call this was,
 * said in that call's own words.
 */
function armFor(
  context: ToolContext,
  id: CharacterId,
  monsterId: string,
  arrival: Result<AddCreatureOutcome>,
  describing: Readonly<Record<string, unknown>>,
): Result<MonsterArrival> {
  const { campaign } = context;
  const state = campaign.state();

  if (!arrival.ok) return arrival;
  if (arrival.value.duplicate) {
    // A retry. The award was made under its own derived id the first time and
    // is a no-op too, so there is nothing left to re-run.
    return ok({
      events: [],
      resolution: { ...describing, duplicate: true },
      unverified: [],
    });
  }

  let working = state;
  for (const event of arrival.value.events) working = applyEvent(working, event);

  // Non-null: `addCreature` looked this block up and did not refuse it.
  const printed = campaign.content.monsterById(monsterId)!;
  const gear = resolveGear(campaign.content, printed.gear);

  const events: GameEvent[] = [...arrival.value.events];
  if (gear.items.length > 0) {
    // `supply()` is resumed from the campaign's cache rather than from
    // `working`, which is right because `creature-added` moves neither `rng`
    // nor `rollsIssued`: the arrival throws no dice. `roll_initiative` draws
    // its supply once in the same place for the same reason. A command that
    // rolled *before* this point would need the supply taken after it.
    const armed = awardItems(
      working,
      campaign.supply(),
      id,
      gear.items,
      `${printed.name}’s printed gear`,
      identity(context, 'gear'),
    );
    if (!armed.ok) return armed;
    events.push(...armed.value);
  }

  return ok({
    events,
    resolution: {
      ...describing,
      name: printed.name,
      armed: gear.items.map((line) => line.id),
      duplicate: false,
    },
    unverified: [
      ...arrival.value.unverified,
      ...gear.unresolved.map(
        (name) =>
          `${id}: ${name} — the stat block prints it and the catalogue has nothing under that name, so it was not handed over`,
      ),
    ],
  });
}

/** {@link ADD_CREATURE}'s two commands: the monster, and what its block prints. */
const bringIn = (
  context: ToolContext,
  id: CharacterId,
  monsterId: string,
): Result<MonsterArrival> =>
  armFor(
    context,
    id,
    monsterId,
    addCreature(context.campaign.state(), context.campaign.content, id, monsterId, identity(context)),
    { added: id, monsterId },
  );

/**
 * A creature a spell put there, and the sweep that takes it away again.
 *
 * **The door `add_creature` is, with the sentence a summoning spell prints.**
 * Everything the creature *is* is still read out of the book by the engine and
 * pinned into the arrival — the sheet, the Armour Class, the hit points, the
 * size, the defences — so the call is four ids: what to call it, which stat
 * block it is, who summoned it, and which of that caster's running spells is
 * holding it here. A tool that took a stat block would be the door a
 * model-authored Armour Class walks through, which is `add_creature`'s own
 * rule and is not weakened by the spell.
 *
 * **What `Summons` offers and this does not take.** A *stated* Initiative
 * total, which the engine accepts from a human DM who gives one and which is
 * exactly the number this surface exists not to take: the creature arrives
 * with no rung in the order and `roll_initiative` seats it, which is the same
 * pair of calls a monster already makes. A placement and a side, because
 * `place_creature` and `declare_side` are doors of their own and the engine's
 * default — a summons is on its summoner's side — is what a summons *means*.
 *
 * **`castingId` is optional, and its absence is an answer.** SRD Animate Dead
 * is Instantaneous and its Skeleton is still standing next week; a creature
 * bound to no casting outlives every spell and is swept by nothing. A creature
 * bound to one goes when the spell goes, which is the other half of this pair.
 *
 * **And the sweep lands beside it, because a door that only summons wedges the
 * fight it summoned into.** A casting ends four ways nobody commands — a
 * deadline, a Concentration broken by unconsciousness, a trigger, the caster
 * leaving — the fold finds the ending and emits nothing, and `resolveTurn`
 * then refuses `summons_stranded` until somebody takes the creature away.
 * Nothing above the engine could, so the refusal named a command no caller
 * could reach. {@link DISMISS_STRANDED_SUMMONS} is that caller, `look` reports
 * the debt beside the others, and the two ship together.
 */
const SUMMON_CREATURE = tool({
  name: 'summon_creature',
  description:
    'Summon a creature: a casting puts a stat block from the bestiary into the game on the summoner’s side. You say what to call it, which monster it is, who summoned it and — where a spell is holding it here rather than simply making it — which casting. The engine reads every number off the block and hands the creature the gear the block prints. It arrives with no place and no rung in the Initiative order: `place_creature` puts it down and `roll_initiative` seats it. When the casting that holds it ends, the creature is owed a departure — `look` reports it under `strandedSummons` and `dismiss_stranded_summons` performs it.',
  mutates: true,
  establishes: ['creature'],
  input: z.object({
    id: creatureId.describe('The id this creature will have in play, e.g. hound.'),
    monsterId: z
      .string()
      .min(1)
      .describe('Which stat block, by its id in the bestiary, e.g. wolf or skeleton.'),
    by: creatureId.describe('The summoner. The creature is on this creature’s side.'),
    castingId: z
      .string()
      .min(1)
      .optional()
      .describe(
        'The casting that holds it here, from the cast_spell that started it. Leave it out for a creature a spell *made* rather than sustains — an Animate Dead Skeleton is still standing next week — and the creature is then bound to nothing and swept by nothing. A casting that is not running, or one that is somebody else’s, is refused.',
      ),
  }),
  run: (context, args) =>
    settle(
      context,
      armFor(
        context,
        who(args.id),
        args.monsterId,
        summonCreature(
          context.campaign.state(),
          context.campaign.content,
          {
            id: who(args.id),
            monsterId: args.monsterId,
            by: who(args.by),
            ...(args.castingId === undefined ? {} : { castingId: args.castingId }),
          },
          identity(context),
        ),
        {
          summoned: args.id,
          monsterId: args.monsterId,
          by: args.by,
          ...(args.castingId === undefined ? {} : { castingId: args.castingId }),
        },
      ),
      (arrival) => arrival.events,
      (arrival) => arrival.resolution,
      (arrival) => arrival.unverified,
    ),
});

/**
 * The other half: every creature whose spell is over, taken away.
 *
 * `settle_area_effects`' twin, and it takes no arguments for the same reason —
 * the engine knows which creatures are owed a departure and the caller is
 * instructing it to settle what it is owed, not naming one. The debt is
 * **derived** rather than filed, so `strandedSummons` answers it from the
 * roster and the running castings alone, and this reports who left in the
 * words the state gave before the batch ran.
 *
 * **An empty sweep is an answer and not a refusal.** A caller sweeping after
 * every ending must not have to tell "nothing to do" from a rule it broke.
 */
const DISMISS_STRANDED_SUMMONS = tool({
  name: 'dismiss_stranded_summons',
  description:
    'Take away every creature whose summoning spell has ended. A summons goes when its spell does, and the engine will not do it unasked: until this is called, ending a turn refuses, naming whoever is still standing on a casting that is over. `look` reports them under `strandedSummons`. You supply nothing but the instruction to do it now, and sweeping when nothing is owed is an empty answer rather than a refusal.',
  mutates: true,
  input: z.object({}),
  run: (context) => {
    // Read before the batch, because the batch is what makes the answer
    // empty: after it, nobody is stranded by construction.
    const dismissed = strandedSummons(context.campaign.state()).map(String);
    return settleEvents(
      context,
      dismissStrandedSummons(context.campaign.state(), identity(context)),
      { dismissed },
    );
  },
});

/**
 * Stop a dying creature from dying.
 *
 * SRD gives two routes to it and the engine records the end of both: "You can
 * take the Help action to try to stabilize a creature with 0 Hit Points, which
 * requires a successful DC 10 Wisdom (Medicine) check", and a Healer's Kit,
 * which does it with no check at all. `stabiliseCreature` has been in the
 * engine since death saves were and reached no tool on either surface, so a
 * party could kneel over somebody and do nothing the engine would record.
 *
 * **It states no number and decides no check.** The DC 10 Medicine check is a
 * Difficulty Class, which is the DM's and goes through `ability_check`; what
 * arrives here is the outcome, which is a fact about the creature on the
 * floor. That is the line `apply_condition` already draws — a ruling somebody
 * made, recorded — and the two refusals are the book's: a creature with hit
 * points has nothing to be stabilised from, and a corpse is Raise Dead's
 * business.
 *
 * On the model's surface, and therefore on both, because the DM's is a
 * superset of it. Putting it on the DM's alone would have left a model-driven
 * session exactly where it was.
 */
const STABILISE_CREATURE = tool({
  name: 'stabilise_creature',
  description:
    'Record that a creature at 0 Hit Points has been stabilised, so it stops making death saving throws. SRD stabilises with a successful DC 10 Wisdom (Medicine) check or a use of a Healer’s Kit — the check is the DM’s, and this is what says it worked. A creature that still has hit points has nothing to be stabilised from, and a dead one is past it.',
  mutates: true,
  input: z.object({ who: creatureId.describe('Who is on the floor.') }),
  run: (context, args) =>
    settleEvents(
      context,
      stabiliseCreature(context.campaign.state(), who(args.who), identity(context)),
      { stabilised: args.who },
    ),
});

/**
 * Four rooms the engine finished and nothing above it could reach.
 *
 * `stabilise_creature` above was the first of a set found by counting the
 * other way — from the engine's own exports towards this surface, rather than
 * from a refusal towards the field that answers it. Each of these commands has
 * been correct, tested and exported since its subsystem landed, with the
 * *reducer* as its only caller: an event no command wrote, folded by a state
 * machine that could never be asked to write it.
 *
 * None of the four takes a number the caller produced, which is why they could
 * all be opened at once. A mount is a creature and a placement measured on the
 * lattice; an object interaction is a budget field the engine flips; a swap is
 * two ids over the engine's own order; and a morning is a word.
 */

/**
 * The one free object interaction a turn.
 *
 * SRD: "You can also interact with one object or feature of the environment
 * for free, during either your Move or your Action." One, and the engine has
 * counted it since the action economy landed — it is the sixth field of the
 * turn budget and the only one with no door, so a session could open a door,
 * draw a sword and sheathe another inside six seconds with the engine
 * recording none of it and the second Ready or Utilise costing nothing.
 *
 * **What the interaction *is* stays in the fiction**, exactly as a Ready's
 * trigger does: a lever, a lid, a corpse's belt. The engine holds no doors and
 * no belts, so it counts the allowance and narrates nothing. There is
 * therefore no field to carry the object, and inventing one would be this
 * surface asking for a fact nothing reads.
 *
 * **Outside a fight it refuses rather than quietly succeeding**, which is the
 * engine's own ruling passed through: the allowance is per *turn*, and outside
 * combat there are no turns to spend one on.
 */
const USE_FREE_INTERACTION = tool({
  name: 'use_free_interaction',
  description:
    'Spend the one free object interaction a turn — open the door, draw the sword, pull the lever, yank the tapestry down. SRD gives exactly one of these a turn on top of your Action and your Move, and this is what counts it: the second one in the same turn is refused, and anything else you want to do with an object costs an Action instead. What the object is stays in the narration; the engine holds the allowance, not the door. Outside a fight there is no turn to spend one on, so it is refused there.',
  mutates: true,
  input: z.object({
    who: creatureId.describe('Whose turn it is, and who is reaching for the thing.'),
  }),
  run: (context, args) =>
    settleEvents(
      context,
      useFreeObjectInteraction(context.campaign.state(), who(args.who), identity(context)),
      { interacted: args.who },
    ),
});

/**
 * Getting on, and getting off again.
 *
 * SRD Mounted Combat: "you can mount a creature that is within 5 feet of you"
 * and "mounting or dismounting costs an amount of movement equal to half your
 * Speed". Both halves have been in `positioning.ts` since positions were, with
 * the reducer as their only caller — which is why a Paladin's Faithful Steed
 * had nowhere at all to go: the engine could seat a rider, and nothing could
 * ask it to.
 *
 * **`willing` is a fact the caller states, and it is not a rules refusal.**
 * SRD covers "a willing creature that is at least one size larger than a
 * rider" and says nothing about leaping onto a hostile dragon, which is among
 * the most-attempted moves at any table. So the engine records `willing:
 * false` rather than refusing it, and whether the character got up there is a
 * check the DM calls for — the reading `declare_cover` and `fought` already
 * take of a fact only the table can see. It carries no number either way.
 *
 * **Everything else is the engine's.** Half a Speed is read off the rider's
 * own sheet, so a Barbarian's Fast Movement and a level of Exhaustion both
 * count; the five feet is measured on the lattice; the size rule is the
 * book's; and where a rider lands is an ordinary `Placement` like every other,
 * refused if it does not work. What a caller supplies is who, onto what, and
 * — getting down — where relative to something already established.
 */
const MOUNT = tool({
  name: 'mount',
  description:
    'Climb onto another creature. SRD asks for a willing creature at least one size larger than the rider and within five feet, and charges half the rider’s Speed for the climb — all of which the engine works out for itself. Say who is getting up, onto what, and whether the mount is willing: an unwilling one is recorded rather than refused, because leaping onto something that would rather you did not is a check the table calls for and not a thing the rules forbid.',
  mutates: true,
  input: z.object({
    rider: creatureId.describe('Who is climbing up.'),
    mount: creatureId.describe('What they are climbing onto.'),
    willing: z
      .boolean()
      .describe(
        'Whether the mount wants to be ridden. True is SRD’s case; false records clinging to something that would rather you did not, which the engine writes down rather than refusing.',
      ),
  }),
  run: (context, args) =>
    settleEvents(
      context,
      mountCreature(
        context.campaign.state(),
        who(args.rider),
        who(args.mount),
        { willing: args.willing },
        identity(context),
      ),
      { rider: args.rider, mounted: args.mount, willing: args.willing },
    ),
});

const DISMOUNT = tool({
  name: 'dismount',
  description:
    'Get down off a mount, into a space beside it. The other half of the same SRD sentence and the same price — half the rider’s Speed — and where they land is an ordinary placement, measured from a landmark or a creature and refused if the space does not work.',
  mutates: true,
  input: z
    .object({ rider: creatureId.describe('Who is getting down.') })
    .and(placementSchema),
  run: (context, args) =>
    settleEvents(
      context,
      dismountRider(
        context.campaign.state(),
        who(args.rider),
        placementOf(args),
        identity(context),
      ),
      { dismounted: args.rider },
    ),
});

/**
 * Two combatants trade places in the order.
 *
 * SRD Alert: "Immediately after you roll Initiative, you can swap your
 * Initiative with the Initiative of one willing ally in the same combat."
 *
 * **Three of the sentence's clauses are the engine's now** — the feat, the
 * moment and the ally's consent — and the arithmetic and the Incapacitated
 * clause have been since `swapInitiative` was written. What is left to the
 * table is `willing` itself, which is fiction the engine cannot see: whether
 * the ally agreed is something only a caller watching the scene knows.
 *
 * **So consent is three answers and not two.** `true` swaps, `false` is an
 * ordinary refusal, and *leaving the field out* is a question — the engine
 * answers `consent_not_stated` rather than assuming either way, because "the
 * ally refused" and "nobody has said" are different facts and a default here
 * would be this surface deciding one of them on the table's behalf. That is
 * why the field is optional: a required one would turn the question into
 * `invalid`, which is Zod's verdict on malformed arguments and not a thing
 * the rules ever say. `selfAnswers` is the other half — the request is the
 * re-send kind, so the door it names is this tool.
 *
 * It carries no number: the two Initiative totals are the ones the engine
 * rolled, and this says only which pair to exchange, and whether they agreed.
 */
const SWAP_INITIATIVE = tool({
  name: 'swap_initiative',
  description:
    'Swap two combatants’ places in the Initiative order. SRD Alert lets a character trade Initiative with one willing ally in the same fight immediately after rolling, and the engine checks all three: the feat, the moment, and that you have said whether the ally agreed. Neither number is yours — the engine rolled both and simply exchanges them. A creature that is Incapacitated cannot be swapped, and one who is not in the order is refused rather than added to it.',
  mutates: true,
  // The consent question is answered by sending this same call again with
  // `willing` on it, so this tool is its own door. Without this the surface's
  // kind-wide mapping would send a caller to `move` and `activate_spell`.
  selfAnswers: ['route'],
  input: z.object({
    combatant: creatureId.describe('One of the two, usually the one making the offer.'),
    ally: creatureId.describe('The other, who is trading places with them.'),
    willing: z
      .boolean()
      .optional()
      .describe(
        'Whether the ally agreed to trade places. SRD swaps with “one willing ally”, and only you can see whether they did. Leave it out and the swap is not refused but asked about: say so and send the same call again. False is a refusal, and is not the same answer as saying nothing.',
      ),
  }),
  run: (context, args) =>
    settle(
      context,
      swapInitiativeBetween(
        context.campaign.state(),
        who(args.combatant),
        who(args.ally),
        {
          ...(args.willing === undefined ? {} : { willing: args.willing }),
          ...identity(context),
        },
      ),
      (events) => events,
      // Read after the append, so it is the order the swap left behind rather
      // than the one it found.
      () => ({
        swapped: [args.combatant, args.ally],
        order: (context.campaign.state().combat?.order ?? []).map((entry) => String(entry.id)),
      }),
    ),
});

/**
 * The sun comes up.
 *
 * **Dawn is declared, never derived**, and `time.ts` says why in as many
 * words: there is no calendar and no time of day, because those are fiction
 * and the DM owns them. The clock counts seconds since the campaign began and
 * no number of them is a sunrise — a party that rests eight hours underground
 * has not seen one, and a party that walks out at noon will.
 *
 * **This door was recorded as deliberately withheld, and the reason it gave
 * has stopped being true.** `doors.test.ts` had it as "the rest slice
 * `definitions.ts` says is left for a later batch. It also rolls recovery" —
 * and the rest slice landed with `begin_rest`, `end_rest` and `advance_time`,
 * while a command that rolls is what almost every door here already is. What
 * was left was a world in which nothing could say the morning had come, so
 * every line the book gives back "daily at dawn" was given back never. A pool
 * nothing refills is the mirror of the pool a caller can spend for no effect,
 * which is the rule that kept Action Surge shut.
 *
 * **It is a moment, not a duration.** No time passes, nothing expires and no
 * turn ends; declaring dawn during a fight is legal and changes nothing about
 * the fight, because sunrise is not a thing anybody spends a turn on. Whoever
 * wants the night to have gone by advances the clock or rests, which are the
 * two doors that own elapsed time — and neither of them is this one: a rest
 * gives back what a rest gives back, and a morning gives back what a morning
 * does.
 *
 * **The call carries nothing at all**, which is the narrowest form invariant 1
 * takes on this surface. Not who, not which pools, not how many charges. The
 * engine walks every creature in sorted key order, reads each pool's own
 * recovery tag, and throws the dice the line prints — "regains 1d3 expended
 * charges daily at dawn" is a die, and a caller supplying that number would be
 * the model producing one. Three kinds of morning come back out: a refill, a
 * rolled recovery recorded with its roll and its generator, and a stated
 * number handed back with no die thrown at all.
 */
const DECLARE_DAWN = tool({
  name: 'declare_dawn',
  description:
    'Say that the sun has come up. There is no calendar and no time of day in the engine — a night that passed underground is not a sunrise, and walking out into the light is — so dawn is yours to declare and this is the whole of the call: no arguments, nobody named. Everything a morning gives back comes back at once, to everybody: wands and rods regain their charges, and where the item’s line prints dice the engine throws them. It is a moment rather than a duration, so no time passes and nothing expires; use advance_time or a rest for that. A rest does not do this and this does not do a rest.',
  mutates: true,
  input: z.object({}),
  run: (context) =>
    settle(
      context,
      declareDawn(context.campaign.state(), context.campaign.supply(), identity(context)),
      (events) => events,
      (events) => ({
        restored: events.flatMap((event) =>
          event.type === 'resources-restored' ? [String(event.id)] : [],
        ),
        regained: events.flatMap((event) =>
          event.type === 'resource-regained'
            ? [{ who: String(event.id), key: event.key, amount: event.amount }]
            : [],
        ),
      }),
    ),
});

const DECLARE_SIDE = tool({
  name: 'declare_side',
  description:
    'Say which side a creature fights on. Allegiance changes in play, so it is declared rather than being a property of arriving. Until somebody has said, a creature is on nobody’s side — which is not the same as neutral, and is what stops a fight being closed over it.',
  mutates: true,
  establishes: ['side'],
  input: z.object({ who: creatureId, side: z.string().min(1).describe('e.g. party, or goblins.') }),
  run: (context, args) =>
    settleEvents(
      context,
      declareCreatureSide(context.campaign.state(), who(args.who), args.side, identity(context)),
      { side: args.side },
    ),
});

const DECLARE_CREATURE_TYPE = tool({
  name: 'declare_creature_type',
  description:
    'State what kind of creature something is — Humanoid, Fey, Undead. Some spells only touch one type. A type can be declared once and cannot be changed afterwards, so declare what the creature actually is and not what would be convenient.',
  mutates: true,
  establishes: ['creature-type'],
  input: z.object({
    who: creatureId,
    creatureType: z.string().min(1).describe('e.g. Humanoid, Fey, Beast, Undead.'),
  }),
  run: (context, args) =>
    settleEvents(
      context,
      declareCreatureType(
        context.campaign.state(),
        who(args.who),
        args.creatureType,
        identity(context),
      ),
      { creatureType: args.creatureType },
    ),
});

const SET_SCENE = tool({
  name: 'set_scene',
  description:
    'Declare the room the fight happens in, in feet. Nobody can be placed until there is one. Setting a scene again is the party walking into the next room, and unplaces everybody. Say how bright it is if you know: leaving the light out leaves it unsaid rather than bright, which is honest and is why a dwarf’s Darkvision will then answer nothing about the room.',
  mutates: true,
  establishes: ['scene'],
  input: z.object({
    width: z.number().positive().describe('Feet.'),
    depth: z.number().positive().describe('Feet.'),
    height: z.number().positive().describe('Feet.'),
    light: z
      .enum(['bright', 'dim', 'darkness'])
      .optional()
      .describe(
        'How bright the room is where no patch of light says otherwise. Omit it and the light is undeclared, not bright — declare_light then covers the parts that differ.',
      ),
  }),
  run: (context, args) =>
    settleEvents(
      context,
      setScene(
        context.campaign.state(),
        { width: args.width, depth: args.depth, height: args.height },
        { ...identity(context), ...(args.light === undefined ? {} : { light: args.light }) },
      ),
      { established: 'scene' },
    ),
});

const ADD_LANDMARK = tool({
  name: 'add_landmark',
  description:
    'Name a fixed feature of the room and where it is. Landmarks are what creatures are placed relative to, so a scene needs at least one. This is the only place a coordinate is typed; everything afterwards is measured from it.',
  mutates: true,
  establishes: ['scene'],
  input: z.object({ name: z.string().min(1).describe('What it is called, e.g. "the bar".'), at: pointSchema }),
  run: (context, args) =>
    settleEvents(
      context,
      addSceneLandmark(context.campaign.state(), args.name, point(args.at), identity(context)),
      { established: 'landmark', name: args.name },
    ),
});

/**
 * And the one field on this surface that still names a size.
 *
 * A creature out of the bestiary carries the size its stat block prints:
 * `addCreature` pins it into `creature-added` and `placeCreatureInScene`
 * reads the pinned one when a caller states none. So the ordinary call — a
 * Goblin Warrior, an Ogre — says nothing about size and gets Small and Large
 * for free, which is the fact being answered by the book rather than asked of
 * the model.
 *
 * It is kept because one creature's record genuinely pins nothing:
 * `createCharacter` writes no size, and the engine's default is Medium. Every
 * SRD species is Small or Medium and the two share a 5-foot space, so what
 * would be lost is the size *category* — which decides who may move through
 * whose space and who ends up Prone for trying. That is a real rule, and a
 * Halfling with no way to say it is Small is a rule with no door. The honest
 * fix is one layer down (creation pinning the species' size), and the engine
 * is not this batch's to change; until it is, this field is where a caller
 * answers a question nothing else has answered.
 */
const PLACE_CREATURE = tool({
  name: 'place_creature',
  description:
    'Put a creature into the scene, relative to a landmark or another creature. Use this the first time a creature needs a position; one that already has a position moves instead, spending its Speed. A creature out of the bestiary is already the size its stat block prints, so leave the size alone unless nothing has said.',
  mutates: true,
  establishes: ['position'],
  input: z
    .object({
      who: creatureId,
      size: sizeSchema
        .optional()
        .describe(
          'Almost never. A creature added from the bestiary already carries the size its stat block prints. State one only where nothing has — a character of a Small species — or where the table has changed it.',
        ),
    })
    .and(placementSchema),
  run: (context, args) =>
    settleEvents(
      context,
      placeCreatureInScene(
        context.campaign.state(),
        who(args.who),
        placementOf(args),
        identity(context),
      ),
      { placed: args.who },
    ),
});

const DECLARE_SIGHT = tool({
  name: 'declare_sight',
  description:
    'State whether one creature can see another. Directional, and three-valued: nobody having said is not the same as "no", which is why a spell that needs sight asks rather than refusing — and so does a Hide, which is asked of every enemy who might catch the hider.',
  mutates: true,
  establishes: ['visibility'],
  input: z.object({ from: creatureId, to: creatureId, seen: z.boolean() }),
  run: (context, args) =>
    settleEvents(
      context,
      declareSightBetween(
        context.campaign.state(),
        who(args.from),
        who(args.to),
        args.seen,
        identity(context),
      ),
      { established: 'sight' },
    ),
});

const DECLARE_COVER = tool({
  name: 'declare_cover',
  description:
    'Declare how much cover one creature has from another — the bar it is crouched behind, the millstone between them. The engine applies exactly what the SRD prints (+2 to Armour Class and Dexterity saves for Half, +5 for Three-Quarters, no targeting at all through Total) and never works cover out from geometry, because that means modelling every wall. It is also what a Hide asks for: SRD wants Three-Quarters or Total, Half is not enough, and a creature nobody has declared cover for is refused unless it is stated Heavily Obscured instead. Use "none" to say the line is clear again.',
  mutates: true,
  input: z.object({
    from: creatureId.describe('The attacker — whose line to the target this is about.'),
    to: creatureId.describe('The creature taking cover.'),
    degree: z.enum(['none', 'half', 'three-quarters', 'total']),
  }),
  run: (context, args) =>
    settleEvents(
      context,
      declareCoverBetween(
        context.campaign.state(),
        who(args.from),
        who(args.to),
        args.degree,
        identity(context),
      ),
      { established: 'cover', degree: args.degree },
    ),
});

/**
 * Where the ground is rough — the declaration `route_required` presupposes.
 *
 * **Without it the question could not be asked on this surface at all.** A
 * move is only asked which spaces it crossed where the ground disagrees with
 * itself along the way, and the only thing that makes ground expensive is a
 * declared patch: no SRD spell in the catalogue emits one, so a model-driven
 * session had no way to put a mire in a room, and therefore no way to reach
 * the refusal `move.route` answers. A field for an answer to a question
 * nothing could ask is half a door.
 *
 * It is the third of the declared facts, beside cover and sight, and it is
 * declared for exactly their reason: five of the SRD's six examples of
 * Difficult Terrain — rubble, undergrowth, furniture, a slope, a narrow
 * opening — are fiction the engine holds no record of, and deducing them
 * means modelling the room.
 *
 * **Two of the engine's fields are deliberately left off.** `costPerFoot` is
 * not offered, so every patch declared here costs the glossary's rate: the
 * larger rate the book prints belongs to two *spells*, which will print it
 * themselves when they are executed, and a caller free to name any rate is a
 * caller naming a mechanically authoritative number. The shape is a radius
 * from a point rather than the whole area vocabulary, because a patch of
 * rubble is a blob and a Cone of mud is not a thing the table says; a patch
 * that needs another shape is a decision for whoever needs one.
 */
const DECLARE_DIFFICULT_TERRAIN = tool({
  name: 'declare_difficult_terrain',
  description:
    'Say where the ground is rough — rubble, undergrowth, mud, a scree slope, the ice. Every foot of movement through it costs one extra foot, and the engine works out which spaces the patch covers, what crossing them costs, and what happens where two overlap. Declared rather than deduced, exactly like cover: the room is fiction and the engine holds no record of it. Naming a patch that already exists replaces it, because ground changes.',
  mutates: true,
  input: z.object({
    patch: z
      .string()
      .min(1)
      .describe('The table’s name for it, e.g. the mire. A refusal about a move quotes it back.'),
    at: pointSchema.describe('The middle of the patch.'),
    radius: z
      .number()
      .finite()
      .nonnegative()
      .describe('How far it reaches from there, in feet. 0 is the one space.'),
    source: z
      .string()
      .min(1)
      .optional()
      .describe(
        'The castingId of a running spell that made this ground expensive, if one did. The patch stops charging the moment that casting stops running.',
      ),
  }),
  run: (context, args) =>
    settleEvents(
      context,
      declareDifficultTerrain(context.campaign.state(), args.patch, {
        region: {
          origin: areaPointAt(point(args.at)),
          shape: { kind: 'sphere', radius: args.radius },
        },
        ...(args.source === undefined ? {} : { source: args.source }),
        ...identity(context),
      }),
      { established: 'difficult terrain', patch: args.patch },
    ),
});

/**
 * How bright a patch of the room is — the fourth declared fact, and the one
 * Darkvision has been a rule about with nothing to read.
 *
 * `docs/design/light-and-sight.md` is the design and the owner ruled it:
 * **light is declared on the lattice**, exactly as the ground is, because
 * deriving it needs walls and light sources and that is the line
 * `space-and-areas.md` draws. This is the table's half; everything after the
 * declaration is the engine's, and there is a lot of it — which spaces the
 * patch covers, whether Darkvision gets through it, whether a Rogue standing
 * in it may Hide, whether two patches put each other out.
 *
 * **No default ambient, so saying nothing says nothing.** A room nobody has
 * described is not Bright Light; it is undescribed, and every answer the
 * engine gives about it is the answer it gave before light existed. A DM who
 * wants the room lit says so, here or on `set_scene`.
 *
 * **The fields, and the one that is not a number.** `level` is a word out of
 * the glossary's three. `magical` is the one distinction the book attaches a
 * rule to — "Darkvision can't see through it, and nonmagical light can't
 * illuminate it" — and it takes a spell level because SRD Darkness and SRD
 * Daylight dispel each other by comparing one; a DM naming it is reporting
 * which spell made the dark, not deciding a mechanic. `sunlight` is the flag
 * four stat blocks read, refused on anything but bright. The radius is the
 * room's, which is the class of number `declare_difficult_terrain` already
 * takes on this door.
 */
const DECLARE_LIGHT = tool({
  name: 'declare_light',
  description:
    'Say how bright a patch of the room is — the torchlight, the shaft of sun through the grating, the dark beyond the lantern. The engine works out which spaces it covers, what a creature with Darkvision makes of it, whether somebody can Hide there, and what two overlapping patches do to each other. Declared rather than deduced, exactly like cover: the room is fiction and the engine holds no record of it. Saying nothing leaves the light unsaid rather than bright. Naming a patch that already exists replaces it, because light changes.',
  mutates: true,
  input: z.object({
    patch: z
      .string()
      .min(1)
      .describe('The table’s name for it, e.g. the brazier. A report quotes it back.'),
    at: pointSchema.describe('The middle of the patch.'),
    radius: z
      .number()
      .finite()
      .nonnegative()
      .describe('How far it reaches from there, in feet. 0 is the one space.'),
    level: z
      .enum(['bright', 'dim', 'darkness'])
      .describe('The glossary’s three levels of light, and no fourth.'),
    sunlight: z
      .boolean()
      .optional()
      .describe(
        'True where this bright light is the sun. Only Sunlight Sensitivity and the vampires ask, and only bright light may carry it.',
      ),
    magicalSpellLevel: z
      .number()
      .int()
      .min(0)
      .max(9)
      .optional()
      .describe(
        'The level of the spell that made this light or this darkness, where a spell did. Magical darkness defeats Darkvision and nonmagical light; two magical patches of opposite kind put each other out.',
      ),
    source: z
      .string()
      .min(1)
      .optional()
      .describe(
        'The castingId of a running spell that made this light, if one did. The patch stops lighting anything the moment that casting stops running.',
      ),
  }),
  run: (context, args) =>
    settleEvents(
      context,
      declareLight(context.campaign.state(), args.patch, {
        region: {
          origin: areaPointAt(point(args.at)),
          shape: { kind: 'sphere', radius: args.radius },
        },
        level: args.level,
        ...(args.sunlight === undefined ? {} : { sunlight: args.sunlight }),
        ...(args.magicalSpellLevel === undefined
          ? {}
          : { magical: { spellLevel: args.magicalSpellLevel } }),
        ...(args.source === undefined ? {} : { source: args.source }),
        ...identity(context),
      }),
      { established: 'light', patch: args.patch },
    ),
});

/**
 * And the half of obscurement that is not about the light at all.
 *
 * A record of its own beside the light because SRD Fog Cloud makes its Sphere
 * Heavily Obscured and says nothing whatever about how bright it is, and a
 * degree derived wholly from a level could not have written that spell. What
 * a level *does* imply — Dim Light is Lightly Obscured, Darkness is Heavily
 * Obscured — the engine adds at read time, so a DM declaring a dark room does
 * not also have to declare it obscured.
 */
const DECLARE_OBSCUREMENT = tool({
  name: 'declare_obscurement',
  description:
    'Say where the air is hard to see through for a reason that is not the light — fog, thick foliage, smoke, a dust cloud. Heavily Obscured blocks sight outright unless a creature has Blindsight or Truesight, and is what a Hide asks for; Lightly Obscured gives Disadvantage on Perception that relies on sight. Darkness and dim light already imply their own degree and do not need declaring here. Naming a patch that already exists replaces it.',
  mutates: true,
  input: z.object({
    patch: z
      .string()
      .min(1)
      .describe('The table’s name for it, e.g. the fog bank. A report quotes it back.'),
    at: pointSchema.describe('The middle of the patch.'),
    radius: z
      .number()
      .finite()
      .nonnegative()
      .describe('How far it reaches from there, in feet. 0 is the one space.'),
    degree: z
      .enum(['lightly', 'heavily'])
      .describe('The glossary’s two degrees of obscurement, and no third.'),
    source: z
      .string()
      .min(1)
      .optional()
      .describe(
        'The castingId of a running spell that made it, if one did. The patch clears the moment that casting stops running.',
      ),
  }),
  run: (context, args) =>
    settleEvents(
      context,
      declareObscurement(context.campaign.state(), args.patch, {
        region: {
          origin: areaPointAt(point(args.at)),
          shape: { kind: 'sphere', radius: args.radius },
        },
        degree: args.degree,
        ...(args.source === undefined ? {} : { source: args.source }),
        ...identity(context),
      }),
      { established: 'obscurement', patch: args.patch },
    ),
});

/**
 * Say that a creature is falling — the fourth declared fact, and the one
 * *Feather Fall* waits for.
 *
 * `declareFalling` landed in the engine with a Reaction window, a trigger
 * rule and a target rule, and reached no tool. The consequence was the shape
 * this whole sweep is about: SRD Feather Fall is a spell the engine casts for
 * real — a level 1 slot, a Reaction, a minute on the clock, five targets each
 * checked for being within range and actually falling — and a model-driven
 * session could not cast it, because nothing it could say made anybody
 * falling. Every attempt was `no_trigger`, which is a true answer to a
 * question the caller had no way to change.
 *
 * It is declared for the reason cover, sight and rough ground are: the engine
 * drops nobody off anything. A ledge gives way, a rope parts, a Reverse
 * Gravity ends — all of it is fiction, and deducing a fall would mean
 * modelling the room.
 *
 * **What it does not take is the point.** No height, no rate, no landing: the
 * SRD gives the rate as "60 feet per round" against a distance it leaves to
 * the DM, so a field for either would be this surface asking a caller to
 * produce the one number the engine exists not to invent. The fall is a
 * moment, worth exactly one Reaction window, and the engine closes it on the
 * turn or the clock with nothing to take back and nothing to call afterwards.
 *
 * Re-declaring under a fresh call is a second fall rather than a
 * contradiction — somebody pushed off a second ledge a minute later is
 * falling again — and a transport's retry is told apart from that by the
 * command id, as everywhere else.
 */
const DECLARE_FALLING = tool({
  name: 'declare_falling',
  description:
    'Say that a creature is falling, right now — the ledge gave way, the rope parted, they were thrown off the bridge. It opens the moment a Reaction can answer: Feather Fall is cast on a creature somebody has said is falling, and nothing else makes that true. Say it as the fall happens; the moment closes when the turn or the clock moves on. Give no height and no distance — how far they fall and what the landing costs are yours to narrate and the engine never asks.',
  mutates: true,
  input: z.object({ who: creatureId.describe('The creature coming off whatever they were on.') }),
  run: (context, args) =>
    settleEvents(
      context,
      declareFalling(context.campaign.state(), who(args.who), identity(context)),
      { established: 'falling', who: args.who },
    ),
});

/**
 * Roll Initiative, and put the rolls where they belong.
 *
 * **Nobody supplies a number.** The Initiative total is the engine's, and so
 * is the Speed the order pins — `speedOf` already answers that question, and
 * making the caller restate it would be asking for a fact the engine holds.
 *
 * Two doors behind one tool, because the caller's intent is the same either
 * way: with no fight running this is `rollInitiativeAndBeginCombat`; with one
 * running it is `recordInitiativeRolls` and then a `joinCombat` per entrant,
 * which is exactly what a `turn-order` request's `satisfyWith` prescribes.
 * The joining branch steps a *working* state with the engine's own reducer
 * and appends nothing until every command has succeeded, so a refusal
 * half-way leaves the log untouched and the dice undiscarded.
 */
const ROLL_INITIATIVE = tool({
  name: 'roll_initiative',
  description:
    'Roll Initiative for these creatures and put them in the order — starting the fight if there is not one yet, or slotting them into a fight already running. The engine throws the dice, applies whatever each creature adds, and ranks them. You decide only that there is a fight and who is in it.',
  mutates: true,
  establishes: ['turn-order'],
  input: z.object({
    combatants: z
      .array(
        z.object({
          who: creatureId,
          surprised: z
            .boolean()
            .optional()
            .describe('SRD: a combatant surprised by combat starting rolls with Disadvantage.'),
        }),
      )
      .min(1, 'name at least one creature to roll Initiative for'),
  }),
  run: (context, args) => {
    const state = context.campaign.state();
    const entrants: InitiativeEntrant[] = args.combatants.map((entry) => {
      const id = who(entry.who);
      return {
        id,
        speed: speedOf(state, id),
        ...(entry.surprised === true ? { options: { surprised: true } } : {}),
      };
    });

    if (state.combat === null) {
      return settleEvents(
        context,
        rollInitiativeAndBeginCombat(state, entrants, context.campaign.supply(), identity(context)),
        { began: true, combatants: entrants.map((e) => e.id) },
      );
    }

    const rolled = recordInitiativeRolls(
      state,
      entrants,
      context.campaign.supply(),
      identity(context, 'roll'),
    );
    if (!rolled.ok) return fromErr(rolled, context.doorsFor);

    const written: GameEvent[] = [...rolled.value];
    let working = state;
    for (const event of rolled.value) working = applyEvent(working, event);

    for (const entrant of entrants) {
      const total = initiativeRolledFor(rolled.value, entrant.id);
      if (total === null) {
        // A retried call: `recordInitiativeRolls` reported the duplicate and
        // wrote nothing, so there is no number to join with — and the join
        // was made under its own id the first time and is a no-op too.
        continue;
      }
      const combatant: CombatantInput = { id: entrant.id, speed: entrant.speed, initiative: total };
      const joined = joinCombat(working, combatant, identity(context, `join:${entrant.id}`));
      if (!joined.ok) return fromErr(joined, context.doorsFor);
      for (const event of joined.value) {
        written.push(event);
        working = applyEvent(working, event);
      }
    }

    context.campaign.append(written);
    return okOutcome(written, { began: false, combatants: entrants.map((e) => e.id) });
  },
});

/** The total the engine rolled for one entrant, read off its own event. */
function initiativeRolledFor(events: readonly GameEvent[], id: CharacterId): number | null {
  for (const event of events) {
    if (event.type === 'roll-recorded' && event.who === id && event.label === INITIATIVE_LABEL) {
      return event.total;
    }
  }
  return null;
}

/**
 * The other bookend, and the reason {@link ADVANCE_TIME} below is reachable
 * at all.
 *
 * `roll_initiative` had no counterpart. The engine's only producer of
 * `combat-ended` was the branch in `removeCreatureEverywhere` that fires when
 * a removal takes the *last* combatant out of the order, and no tool removes
 * a creature — so a session that rolled Initiative once was in a fight
 * forever, and with the clock refusing to move inside one it could then never
 * rest. Three doors were already shut behind that: `advance_time`,
 * `begin_rest`, `end_rest`. This is the key, and it ships with them rather
 * than after them.
 *
 * **It carries no number and asserts no outcome.** Which of the three endings
 * happened is a fact about the room — they were beaten, they gave up, they
 * ran — and every check on it is the engine's: who is still standing, whether
 * the side named is a side anybody standing is on, whether anybody is on
 * nobody's side at all. A caller cannot close a fight by saying it is closed.
 *
 * **Four refusals reach the caller as what they are.** Three are verdicts on
 * established facts — there is no fight, two sides are still up, or a flight
 * has not been elected — and the fourth is homework: a combatant nobody has
 * put on a side comes back as `needs-context` carrying a `side` request per
 * creature, and `declare_side` is the door for each. That is the loop this
 * surface exists to run, and `fight.test.ts` walks it.
 *
 * **`letThemGo` is the one field that is a decision rather than an
 * observation**, and it is the table's. SRD has nothing to say about whether
 * the party chases the fleeing goblins; the engine refuses the flight until
 * somebody answers, and the same call carries the answer back.
 */
const END_COMBAT = tool({
  name: 'end_combat',
  description:
    'Close the fight. Say how it ended — the enemy was beaten, they surrendered, or they fled — and the engine checks it against who is still on their feet: a fight with two opposed sides still standing is refused, and so is one holding somebody nobody has put on a side. A flight is a prompt rather than an end, because many tables want to finish them: send it again with letThemGo once the players have said. Nothing else moves the clock while a fight is running, so this is what a rest waits for.',
  mutates: true,
  input: z.object({
    ending: z
      .discriminatedUnion('kind', [
        z.object({
          kind: z.literal('defeated').describe('Nobody opposed is left standing.'),
        }),
        z.object({
          kind: z.literal('surrender'),
          side: z
            .string()
            .min(1)
            .describe('The side that yielded, as it was declared to `declare_side`.'),
        }),
        z.object({
          kind: z.literal('flight'),
          side: z
            .string()
            .min(1)
            .describe('The side that ran, as it was declared to `declare_side`.'),
          letThemGo: z
            .boolean()
            .optional()
            .describe(
              'True once the players have said they are letting them go. Without it the fight stays open, because chasing them is the table’s call and not the engine’s.',
            ),
        }),
      ])
      .describe('How the fight ended. A side that nobody standing is on is refused.'),
  }),
  run: (context, args) => {
    const ending: CombatEnding =
      args.ending.kind === 'defeated'
        ? { kind: 'defeated' }
        : args.ending.kind === 'surrender'
          ? { kind: 'surrender', side: args.ending.side }
          : {
              kind: 'flight',
              side: args.ending.side,
              ...(args.ending.letThemGo === undefined ? {} : { letThemGo: args.ending.letThemGo }),
            };
    return settleEvents(
      context,
      endCombat(context.campaign.state(), ending, identity(context)),
      { ended: ending.kind, ...(ending.kind === 'defeated' ? {} : { side: ending.side }) },
    );
  },
});

const MOVE = tool({
  name: 'move',
  description:
    'Move a creature, spending its Speed. Always relative to a landmark or another creature — never a raw coordinate. Say which Speed it is using when it is not walking, and say when the move is a jump. Leaving an enemy’s reach offers them an Opportunity Attack, and the move is held until every creature offered one has answered.',
  mutates: true,
  establishes: ['route'],
  input: z
    .object({
      who: creatureId,
      forced: z
        .boolean()
        .optional()
        .describe(
          'True when somebody is moving them rather than them walking — a shove, a gust, a trap. Costs no Speed and provokes nobody.',
        ),
      mode: z
        .enum(['walk', 'climb', 'fly', 'swim', 'burrow'])
        .optional()
        .describe(
          'Which Speed this move uses. Leave it out for walking. Climbing and swimming cost double for a creature without the matching Speed, and Difficult Terrain doubles again; flying or burrowing without one is refused, because there is no unaided version. Going up at all needs a flight, a climb or a High Jump.',
        ),
      jump: z
        .object({
          kind: z
            .enum(['long', 'high'])
            .describe('Long is across, High is up. A Long Jump may not rise at all.'),
          running: z
            .boolean()
            .optional()
            .describe(
              'True if they moved at least 10 feet immediately before jumping; a standing jump covers half as far. In a fight the engine checks it against the movement already spent this turn and refuses a run nobody made; outside one there is no budget to check it against, so it is taken as declared and reported back as unverified.',
            ),
        })
        .optional()
        .describe(
          'That this move is a jump. The engine works out how far this creature can jump from its Strength and refuses a longer one; the feet it clears cost movement like any other.',
        ),
      difficultFeet: z
        .number()
        .finite()
        .nonnegative()
        .optional()
        .describe('How many feet of this move are through Difficult Terrain. Each costs one extra foot.'),
      route: routeSchema
        .optional()
        .describe(
          'The 5-foot spaces this move passed through, in order, ending where it ends. Send it when a move came back `route_required`: the same call again with this filled in is the whole of the answer. Not the answer to `single_steps_required`, which wants the walk re-sent as several calls of one space each.',
        ),
      using_grant: z
        .string()
        .min(1)
        .optional()
        .describe(
          'Spend feet a feature handed this turn instead of the creature\u2019s own Speed \u2014 SRD Tactical Shift is "whenever you activate your Second Wind with a Bonus Action, you can move up to half your Speed without provoking Opportunity Attacks". `sheet` reports what a creature holds and the feature that handed the feet over is the name to send here. The move spends none of the turn\u2019s own movement and provokes nobody, and it may still not end in a space somebody is standing in: that part is what `forced` allows and this is not forced. A grant nothing handed this creature is refused rather than quietly charged to their Speed.',
        ),
    })
    .and(placementSchema),
  run: (context, args) =>
    settle(
      context,
      resolveMove(
        context.campaign.state(),
        who(args.who),
        {
          placement: placementOf(args),
          ...(args.forced === true ? { forced: true } : {}),
          ...(args.using_grant === undefined ? {} : { usingGrant: args.using_grant }),
          ...(args.mode === undefined ? {} : { mode: args.mode }),
          ...(args.jump === undefined
            ? {}
            : {
                jump: {
                  kind: args.jump.kind,
                  ...(args.jump.running === undefined ? {} : { running: args.jump.running }),
                },
              }),
          ...(args.difficultFeet === undefined ? {} : { difficultFeet: args.difficultFeet }),
          ...(args.route === undefined ? {} : { route: args.route.map(point) }),
          ...identity(context),
        },
        context.campaign.supply(),
      ),
      (value) => value.events,
      // `terrain` is the patches that charged for this move, by the table's own
      // name for them. Reported because the difference between `feetMoved` and
      // `movementCost` is otherwise an unexplained number: a caller told a
      // 15-foot walk cost 20 and not which ground took the other five has to
      // narrate a slog it cannot see. The name is the caller's own, from
      // `declare_difficult_terrain`, so this closes that loop too — the ground
      // somebody declared comes back as the ground that charged. The
      // `route_required` request itself names no patch; it names coordinates.
      (value) => ({
        feetMoved: value.feet,
        movementCost: value.cost,
        terrain: value.terrain,
        duplicate: value.duplicate,
      }),
      (value) => value.unverified,
    ),
});

/**
 * Swing at somebody — and `action` is the third source of an attack's numbers.
 *
 * A swing's numbers come from a catalogue weapon, a spell, or **the line the
 * creature's own stat block prints**, and until now only the first two reached
 * this surface. A Wolf's `Bite` is not an item, so no `weapon` names one; the
 * Wolf carries nothing at all, so the only swing a model could ask it for was
 * an Unarmed Strike, which is not what the book printed. `add_creature` made
 * the bestiary a door and left every monster in it punching.
 *
 * **It is a name and never a line**, which is `addCreature`'s own rule one
 * layer up: an entry point that accepted an attack bonus would be the door a
 * model-authored +12 walked through, and nothing would guard it. The `+4`, the
 * reach and the `1d6 + 2` are read off the line pinned onto the creature when
 * it entered the game, and a name the block does not print is `unknown_action`
 * rather than a swing at a number nobody can see.
 *
 * Exclusive with `weapon`, and the engine refuses the pair rather than picking
 * one: a swing whose numbers come from two places is a question with two
 * answers.
 */
const ATTACK = tool({
  name: 'attack',
  description:
    'Attack with a weapon, or with an attack the creature’s own stat block prints. The engine derives everything: the target’s Armour Class, reach and range, advantage and disadvantage, proficiency, the damage dice, and the target’s defences. You name who swings at whom and with what — a catalogue `weapon`, or an `action` by its printed name, never both.',
  mutates: true,
  input: z.object({
    attacker: creatureId,
    target: creatureId,
    weapon: z
      .string()
      .min(1)
      .optional()
      .describe('Catalogue id, e.g. quarterstaff, dagger. Omit for an Unarmed Strike.'),
    action: z
      .string()
      .min(1)
      .optional()
      .describe(
        'An attack this creature’s own stat block prints, by its printed name — a Wolf’s "Bite". Use it instead of `weapon`, never beside it: a Bite is not an item, so no catalogue id names one and an Unarmed Strike is not what the book printed. `look` reports what a creature is; the attack bonus, the reach and the damage dice are read off the line the engine pinned when the creature entered the game, and a name the block does not print is refused.',
      ),
    thrown: z
      .boolean()
      .optional()
      .describe('True when a Melee-or-Ranged weapon is thrown rather than swung — a Javelin, a Dagger.'),
    twoHanded: z.boolean().optional().describe('True when a Versatile weapon is wielded in two hands.'),
    finesseAbility: z
      .enum(['str', 'dex'])
      .optional()
      .describe('Which ability a Finesse weapon uses. Defaults to the better one.'),
    hold: z
      .boolean()
      .optional()
      .describe(
        'Roll the attack and stop on the hit, leaving the damage to `settle_attack`. Ask for it when the target may want the moment the rules give them — SRD Shield is "a Reaction you take when you are hit by an attack roll", and that instant exists only in an attack that has not rolled its damage yet. It costs nothing and decides nothing; a miss is over either way.',
      ),
    mastery: masterySchema
      .optional()
      .describe(
        'Use the mastery property of the weapon in hand — Cleave, Graze, Push, Slow and Topple are written "you can", so silence declines them. An empty object uses whatever the weapon prints. A property this character has not unlocked is refused rather than quietly skipped. Nick is not asked for here: it changes what **pays** for the Light property’s extra attack rather than what a blow does, so it is `light_attack: "attack-action"` below.',
      ),
    light_attack: z
      .enum(['bonus-action', 'attack-action'])
      .optional()
      .describe(
        'Make this swing the extra attack the **Light** property buys. SRD: "When you take the Attack action on your turn and attack with a Light weapon, you can make one extra attack as a Bonus Action later on the same turn. That extra attack must be made with a different Light weapon, and you don’t add your ability modifier to the extra attack’s damage unless that modifier is negative." So take the Attack action first, then send this with the **other** Light weapon — a different catalogue id, or the same one where the character really has two copies of it. `"attack-action"` is SRD Nick, which pays for the same extra attack out of the Attack action instead and leaves the Bonus Action free; it is refused unless the weapon prints that property and the character has unlocked it. One extra attack a turn either way, and the ability modifier comes back only for a character with the Two-Weapon Fighting fighting style.',
      ),
    damageTypes: z
      .record(z.string().min(1), z.string().min(1))
      .optional()
      .describe(
        'Name a damage type where something gives this blow a choice of one — SRD Divine Strike is "Necrotic or Radiant damage (your choice)" and SRD Shillelagh’s staff "can be Force damage or the weapon’s normal damage type". A map from what offers the choice to the type chosen: a feature by its id, and a spell that imbued the weapon by the spell’s name. Written "your choice" in the book, so leaving one out declines it and the blow deals what it would otherwise deal. A type the offer does not print, and an offerer this creature has nothing from, are each refused before anything is rolled.',
      ),
    hold_instead_of_damage: z
      .literal(true)
      .optional()
      .describe(
        'Take the hold this line offers **in place of** its damage — SRD Animated Rug of Smothering: "the rug **can** give it the Grappled condition (escape DC 13) instead of dealing damage." Written "can", so silence takes the damage; sending this deals none and makes the hold, with everything the line says goes with it. A line that offers no such choice refuses this before the Action is spent and before a die is thrown.',
      ),
    onHit: hitRiderSchema
      .optional()
      .describe(
        'Buy a feature of the attacker’s with this blow — SRD Stunning Strike is "once per turn when you hit a creature ... you can expend 1 Focus Point". Written "you can", so silence declines it and a swing that names none buys nothing. Name the feature and the option; the price, the save, the DC and how long what it leaves behind lasts are all the engine’s. A feature the attacker has not got, an option it does not offer, a weapon its sentence does not cover and a pool with nothing left are each refused before the attack is rolled, so nothing is spent. `sheet` lists what this character can elect.',
      ),
    cantrip: cantripSwingSchema
      .optional()
      .describe(
        'Cast a cantrip **with** this swing — SRD True Strike, whose whole text is one attack made through a casting: "you make one attack with the weapon used in the spell’s casting. The attack uses your spellcasting ability for the attack and damage rolls instead of using Strength or Dexterity." Name the spell by its catalogue id, and `damageType` where its sentence offers the blow a choice of one — True Strike’s is Radiant, and naming none deals the weapon’s own type. The **Action** it costs is the casting’s, so this is not the Attack action and it cannot be sent beside anything that says something else paid for the swing. A spell this creature cannot cast, a spell that is not cast this way, a weapon they have no proficiency with, and an Unarmed Strike are each refused before the Action is spent and before a die is thrown.',
      ),
  }),
  run: (context, args) =>
    settle(
      context,
      resolveAttack(
        context.campaign.state(),
        who(args.attacker),
        {
          target: who(args.target),
          weapon: args.weapon ?? null,
          ...(args.action === undefined ? {} : { action: args.action }),
          ...(args.thrown === true ? { thrown: true } : {}),
          ...(args.twoHanded === true ? { twoHanded: true } : {}),
          ...(args.finesseAbility === undefined ? {} : { finesseAbility: args.finesseAbility }),
          ...(args.hold === true ? { hold: true } : {}),
          ...(args.mastery === undefined ? {} : { mastery: masteryOf(args.mastery) }),
          ...(args.light_attack === undefined ? {} : { lightAttack: args.light_attack }),
          ...(args.onHit === undefined ? {} : { onHit: args.onHit }),
          ...(args.hold_instead_of_damage === true ? { holdInsteadOfDamage: true as const } : {}),
          ...(args.cantrip === undefined
            ? {}
            : {
                cantrip: {
                  spellId: args.cantrip.spell,
                  ...(args.cantrip.damageType === undefined
                    ? {}
                    : { damageType: args.cantrip.damageType }),
                },
              }),
          ...(args.damageTypes === undefined ? {} : { featureDamageTypes: args.damageTypes }),
          ...identity(context),
        },
        context.campaign.supply(),
      ),
      (value) => value.events,
      (value) => ({
        hit: value.attack?.hit ?? null,
        natural: value.attack?.roll.natural ?? null,
        total: value.attack?.total ?? null,
        critical: value.attack?.critical ?? null,
        // Whether the damage is still to come, so a caller knows a debt is
        // open without having to infer it from an absent field.
        held: args.hold === true && value.attack?.hit === true,
        ...(value.damage === undefined ? {} : { damageDealt: value.damage }),
        ...(value.reactions === undefined
          ? {}
          : { mayAnswer: value.reactions.map((offer) => offer.reactor) }),
        duplicate: value.duplicate,
      }),
      (value) => value.unverified,
    ),
});

/**
 * Cast a spell — and state the facts a casting states rather than derives.
 *
 * **Five of the fields below exist because the engine refuses without them.**
 * `resolveSpell` answers `fought_fact_required`, `destination_required`,
 * `slot_kind_required`, `payment_required` and `class_required` naming
 * exactly what it wants, before a slot is spent; each names a field of
 * `CastSpellRequest`, and until now this tool had none of them. A refusal a
 * caller cannot act on is the defect `routes.test.ts` was written about
 * standing one layer up, and the cost was concrete: Charm Person, Charm
 * Monster and the Dominates all print the fighting clause, Misty Step and
 * Dimension Door both teleport, and none of the five was castable from the
 * surface that exists to cast spells. `doors.test.ts` derives that list from
 * the engine's own refusal codes so the next one cannot land quietly.
 *
 * **None of them is a number the caller produced**, which is the rule that
 * decided they could be here at all. `fought` and `teleportTo` are facts —
 * who is already in melee with whom, which space somebody blinks to — and the
 * engine validates both against what it holds: an unknown creature is
 * refused, a duplicate is refused, and a destination is checked for distance,
 * occupancy, the scene's extent and declared sight. `slotKind`, `payment` and
 * `source` are resource *choices* exactly as `slotLevel` already is: which of
 * two pools, whether the day's free casting or a slot, which of two classes
 * prepared it. Each changes which resource is spent and which spellcasting
 * ability applies; none states what anything costs, and the engine refuses
 * any of them that the caster does not actually have.
 */
const CAST_SPELL = tool({
  name: 'cast_spell',
  description:
    'Cast a spell. The engine derives everything mechanical: the save DC, the attack modifier, the damage dice, the condition, the duration, the range. You name the spell, the targets and the slot. An area spell takes no targets and picks its own — give it `at` for where it is centred, and, for a Cone, Cube or Line, a `towardsCreature`, `towardsLandmark` or `towards` saying which way it points. A wall is the one template you draw instead: give it `path`, the 5-foot spaces it runs through in order. The exception is an area the spell says is "each creature of your choice": there `targets` names which of the creatures standing in it are caught, and the engine says who those are when you leave it out.',
  mutates: true,
  input: z.object({
    caster: creatureId,
    spellId: z.string().min(1).describe('SRD spell id, e.g. fire-bolt, hold-person, magic-missile.'),
    targets: z
      .array(creatureId)
      .describe(
        'Creature ids. Empty for an area spell, which catches whoever is standing in it — except where the spell says "each creature of your choice" in its area, and then this names the subset of them you choose. Naming somebody outside the area is refused, and naming nobody comes back listing who is in it.',
      ),
    rollsAt: z
      .array(
        z.strictObject({
          target: creatureId,
          count: z
            .int()
            .min(1)
            .describe('How many of the casting’s rolls — rays, beams, darts — go at this creature.'),
        }),
      )
      .optional()
      .describe(
        'How to divide a casting that aims several rolls — Scorching Ray’s rays, Eldritch Blast’s beams, Magic Missile’s darts. Name every creature in `targets` exactly once, with a share each, adding up to exactly the rolls the casting makes; the engine says how many that is and refuses anything else. Leave it out and the rolls are dealt round the creatures you named, one each and round again for the rest. This is a targeting decision and never a result: the engine still rolls every one of them, and an attack hits, misses and crits on its own while a dart simply lands.',
      ),
    slotLevel: z.int().min(1).max(9).optional().describe('Which slot to spend. Omit for a cantrip.'),
    at: pointSchema.optional().describe('Where an area spell is centred, for a spell that asks for a point.'),
    towards: pointSchema.optional().describe('Point a Cone, Cube or Line at this exact spot.'),
    path: z
      .array(pointSchema)
      .optional()
      .describe(
        'The 5-foot spaces a **wall** runs through, in order along the ground — SRD Wind Wall’s "you can shape the wall in any way you choose so long as it makes one continuous path along the ground". The only template the caster draws rather than aims: the engine checks the total length the spell allows, that each space touches the one before it, that the whole path is on one ground and crosses no space twice, and that the first space is in range. Leave `at` out; the wall rises at the first space of its own path.',
      ),
    towardsCreature: creatureId.optional().describe('Point a Cone, Cube or Line at this creature.'),
    towardsLandmark: z.string().min(1).optional().describe('Point it at this landmark instead.'),
    anchoring: z
      .enum(['space', 'intersection'])
      .optional()
      .describe('Whether `at` and `towards` name a space or the intersection four spaces meet at.'),
    damageType: damageTypeSchema
      .optional()
      .describe(
        'Which of the types a spell prints this casting uses, for the few that print a list and leave the choice to the caster or to what the caster is — Spirit Guardians’ Radiant or Necrotic, Chromatic Orb’s whole list, Protection from Energy’s. Leaving it out for one of those is refused, and so is naming one for a spell that prints a single type.',
      ),
    choice: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Which of the values a spell prints this casting chose, for the spells that print a list and leave the pick to the caster — Blindness/Deafness’ "the Blinded or Deafened condition (your choice)", Lesser Restoration’s one condition of four, Enhance Ability’s five abilities, Guidance’s "choose a skill". Leaving it out for one of those is refused, and so is naming one for a spell that prints no choice.',
      ),
    fought: z
      .array(creatureId)
      .optional()
      .describe(
        'Which of the targets you or your allies are already fighting, for a spell that prints the clause — Charm Person and Charm Monster roll that creature’s save with Advantage. A list, because an upcast Charm names several and the answer differs per creature. Send an empty list to say you are fighting none of them; leaving it out entirely is refused, because silence is not an answer the engine may fill in.',
      ),
    teleportTo: placementSchema
      .optional()
      .describe(
        'Where a teleporting spell puts its target — Misty Step’s "unoccupied space you can see", Dimension Door’s "the spot desired". Measured from a landmark or a creature like every other destination, never as a raw coordinate. The engine checks the distance, the space and the sight; which space is yours.',
      ),
    weapon: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Which weapon a spell that imbues one was aimed at, by the item id `sheet` lists — Shillelagh’s "A Club or Quarterstaff you are holding", Magic Weapon’s "You touch a nonmagical weapon". One object out of whatever the target is carrying, and the engine will not pick it. Leaving it out for one of those is refused, and so is naming one for a spell that does nothing to a weapon.',
      ),
    object: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Which object a spell aimed at a thing rather than at its holder was pointed at, by the item id `sheet` lists — Remove Curse’s "the spell breaks its owner’s Attunement to the object", Heat Metal’s "Choose a manufactured metal object". One thing out of whatever the target is wearing or wielding, and the engine will not pick it: a creature carrying three things has three answers. Leaving it out for such a spell is refused, and so is naming one for a spell that does nothing to an object, or one the target does not have. Not the wand doing the casting, which is `item`, and not a weapon a spell imbues, which is `weapon`.',
      ),
    form: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Which stat block a summoning spell that leaves the form to its caster raises, by its id in the bestiary — Find Familiar’s "Bat, Cat, Frog, Hawk, Lizard, Octopus, Owl, Rat, Raven, Spider, Weasel, or another Beast that has a Challenge Rating of 0". The engine refuses a block the spell does not admit and will not pick one. Leaving it out for such a spell is refused, and so is naming one for a spell that names its own block.',
      ),
    slotKind: z
      .enum(['spell', 'pact'])
      .optional()
      .describe(
        'Which pool the slot comes out of, for a Warlock multiclassed into another caster: Pact Magic and Spellcasting are different resources at the same level, and the engine will not choose between them.',
      ),
    payment: z
      .enum(['slot', 'free-casting'])
      .optional()
      .describe(
        'How to pay, when a feature grants a free casting and a slot would also serve — Magic Initiate’s once-a-day spell is the common one. Spending the day’s free casting instead of a slot is a decision, so the engine refuses to default it.',
      ),
    source: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Which route casts it, when more than one would serve: `class:<classId>` for one of a multiclass caster’s classes, or a granting feature’s id. Each brings its own spellcasting ability and therefore its own save DC, which is why the engine asks rather than picking.',
      ),
    usingFeatures: z
      .array(z.string().min(1))
      .optional()
      .describe(
        'Features of the caster’s that this casting uses — the ones the SRD writes as “you can”, which do nothing unless the casting names them. `sheet` lists them; a feature the caster has not got is refused, and one they have that does not reach this spell is not, because casting outside a feature’s narrowing is legal. This carries no number: the engine reads the feature off the sheet and does the arithmetic itself.',
      ),
    usingOptions: z
      .array(z.string().min(1))
      .optional()
      .describe(
        'Options of the caster’s that this casting buys, by id — SRD Metamagic’s Distant Spell, Subtle Spell and the rest. `sheet` lists the ones this character took and what each costs; an option they did not take is refused, and so is one that cannot reach this spell, because the book writes every one of them as a condition on the spending. The price comes out of the pool inside this casting’s own batch, so a refused casting costs nothing. Only as many as the feature allows on one casting — the SRD allows one. This carries no number: the engine reads the price and the rule off the sheet.',
      ),
    unaffected: z
      .array(creatureId)
      .optional()
      .describe(
        'Creatures this casting leaves alone, for a spell that offers the choice — Spirit Guardians’ "you can designate creatures to be unaffected by it" — or for a casting that buys it, which is what Careful Spell does. They roll no saving throw and take no damage. Naming somebody through a spell that offers neither is refused, and so is naming more than the option pays for.',
      ),
    saveModes: z
      .array(
        z.strictObject({
          target: creatureId,
          mode: z
            .enum(['advantage', 'disadvantage'])
            .describe('How that creature rolls its saves against this casting.'),
        }),
      )
      .optional()
      .describe(
        'How a named creature rolls the saving throws this casting forces on it, for a casting that has bought the right to say so — SRD Heightened Spell’s "give one target of the spell Disadvantage on saves against the spell". Refused outright unless an option in `usingOptions` offers it, refused for a mode that option does not offer, and refused for more creatures than it reaches. This is not a roll and never could be: the engine still throws every die.',
      ),
    ritual: z
      .literal(true)
      .optional()
      .describe(
        'Cast it as a Ritual. SRD: ten minutes longer than the spell’s printed casting time and no spell slot expended, so it is declared now and settled with `resolve_declared_cast` once `advance_time` has passed the time, exactly as `hold` works; a slot level above the spell’s own is refused, and so is a spell without the Ritual tag. A Wizard with Ritual Adept reaches any Ritual in the spellbook this way, prepared or not.',
      ),
    hold: z
      .boolean()
      .optional()
      .describe(
        'Declare the casting and stop, leaving it open for somebody to interrupt. SRD Counterspell answers "a creature in the process of casting a spell", and a casting that resolves in one call is never in the process of anything. The action goes and any Concentration is dropped, exactly as they would be whatever happens next; the slot is not spent until the casting is finished, because a countered spell keeps it. Finish it with `resolve_declared_cast`, whose id this call reports as `castingId`. A casting that takes a minute or more is declared this way whether or not you ask.',
      ),
    answers: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Which declared casting this Reaction interrupts, by the `castingId` `options` reports beside the offer. Only for a spell whose trigger is a casting — Counterspell — and refused for any other. Leave it out when the creature you named has exactly one casting open; where they have several, leaving it out is refused naming them, and the answer is the same call with the id in.',
      ),
  }),
  run: (context, args) => {
    const state = context.campaign.state();
    const towards = towardsOf(state, args);
    if (!towards.ok) return fromErr(towards, context.doorsFor);
    const request: CastSpellRequest = {
      spellId: args.spellId,
      targets: args.targets.map(who),
      ...(args.rollsAt === undefined
        ? {}
        : { rollsAt: args.rollsAt.map((aim) => ({ target: who(aim.target), count: aim.count })) }),
      ...(args.at === undefined ? {} : { at: point(args.at) }),
      ...(args.path === undefined ? {} : { path: args.path.map(point) }),
      ...(towards.value === undefined ? {} : { towards: towards.value }),
      ...(args.anchoring === undefined ? {} : { anchoring: args.anchoring }),
      ...(args.slotLevel === undefined ? {} : { slotLevel: args.slotLevel }),
      ...(args.damageType === undefined ? {} : { damageType: args.damageType }),
      ...(args.choice === undefined ? {} : { choice: args.choice }),
      // **An empty `fought` is an answer and is never elided.** "We are
      // fighting none of them" is a fact the caster stated; absence is a
      // caller who has not read the spell, and the engine tells the two
      // apart. Every other stated fact here is absent-or-present.
      ...(args.fought === undefined ? {} : { fought: args.fought.map(who) }),
      ...(args.teleportTo === undefined ? {} : { teleportTo: placementOf(args.teleportTo) }),
      ...(args.weapon === undefined ? {} : { weapon: args.weapon }),
      ...(args.object === undefined ? {} : { object: args.object }),
      ...(args.form === undefined ? {} : { form: args.form }),
      ...(args.slotKind === undefined ? {} : { slotKind: args.slotKind }),
      ...(args.payment === undefined ? {} : { payment: args.payment }),
      ...(args.source === undefined ? {} : { source: args.source }),
      ...(args.usingFeatures === undefined ? {} : { usingFeatures: args.usingFeatures }),
      ...(args.usingOptions === undefined ? {} : { usingOptions: args.usingOptions }),
      ...(args.unaffected === undefined ? {} : { unaffected: args.unaffected.map(who) }),
      // A list of pairs on the wire and a map in the engine: a schema that
      // took an object keyed by creature id could not name the key, so the
      // description a model reads would have had nowhere to say what a key is.
      ...(args.saveModes === undefined
        ? {}
        : {
            saveModes: Object.fromEntries(
              args.saveModes.map((one) => [who(one.target), one.mode]),
            ),
          }),
      ...(args.hold === true ? { hold: true } : {}),
      ...(args.ritual === true ? { ritual: true as const } : {}),
      ...(args.answers === undefined ? {} : { answers: args.answers }),
      ...identity(context),
    };
    return settle(
      context,
      resolveSpell(state, who(args.caster), request, context.campaign.supply()),
      (value) => value.events,
      (value) => ({ castingId: value.castingId, outcomes: value.outcomes }),
      (value) => value.unverified,
    );
  },
});

/**
 * Finish a casting that was declared and left open.
 *
 * **The other half of `cast_spell.hold`, and it has to be a tool of its own.**
 * A declaration is a spell nobody has cast and a slot nobody has spent, held
 * open until something finishes it: without this door a caller that asked for
 * the window could never close it, and every command that refuses on a pending
 * casting would refuse for the rest of the session. One field was not enough.
 *
 * **It restates nothing.** Who the casting was aimed at, what level it was made
 * at and which route supplied it were settled and written down at the
 * declaration, so the whole of the call is which casting — a settlement that
 * took a fresh request could declare a Fireball at the goblins and settle it at
 * the party. The id is the one `cast_spell` reported and `look` lists under
 * `owed.pendingCastings`.
 */
const RESOLVE_DECLARED_CAST = tool({
  name: 'resolve_declared_cast',
  description:
    'Let a casting that was declared take effect: the slot goes now, and the spell does what it does. Name only the casting — everything else was decided when it was declared. Use it for a casting you held open for a Counterspell nobody cast, and for a spell whose casting time is a minute or more once the time has passed. A casting that was countered is gone and there is nothing left to resolve.',
  mutates: true,
  input: z.object({
    castingId: z
      .string()
      .min(1)
      .describe('From the cast_spell that declared it, or from `look`’s `owed.pendingCastings`.'),
  }),
  run: (context, args) =>
    settle(
      context,
      resolveDeclaredCast(
        context.campaign.state(),
        args.castingId,
        context.campaign.supply(),
        identity(context),
      ),
      (value) => value.events,
      (value) => ({ castingId: value.castingId, outcomes: value.outcomes }),
      (value) => value.unverified,
    ),
});

/**
 * Keep at a rite that takes a minute — the half of "Longer Casting Times"
 * somebody decides.
 *
 * SRD: "While you cast a spell with a casting time of 1 minute or more, you
 * must take the Magic action on **each of your turns**, and you must maintain
 * Concentration while you do so." The other half — a turn that ends without it
 * — is derived at the boundary and writes no event, because nobody decides
 * that a turn ended. This is the half that is a decision, and it had no door:
 * a casting of a minute declared in a fight could not survive its own caster's
 * next turn whatever the caller did, which made every long casting in the
 * catalogue uncastable in combat from the surface that exists to cast spells.
 *
 * **It restates nothing and carries no number**, which is `resolve_declared_
 * cast`'s rule and for its reason: the spell, the level and the targets were
 * settled at the declaration, and what this call says is that the caster spent
 * this turn on the rite. The slot is still untouched — SRD: "If your
 * Concentration is broken, the spell fails, but you don't expend a spell slot"
 * — and `resolve_declared_cast` is still what finishes it once the clock has
 * run.
 *
 * **The turn it was declared on needs no call.** That turn's Magic action
 * *was* the declaration, so asking for a second is refused `no_action` by the
 * economy, which is the honest refusal because it is the economy that says so.
 */
const CONTINUE_CASTING = tool({
  name: 'continue_casting',
  description:
    'Spend this turn’s Magic action keeping at a spell whose casting time is a minute or more. SRD requires it on each of the caster’s turns while the rite runs: a turn that ends without it fails the spell, and no slot is spent when it does. Name only whose casting it is and which one — everything else was settled when it was declared, and `look` lists the open ones under `owed.pendingCastings`. When the time has passed, `resolve_declared_cast` is what finishes it.',
  mutates: true,
  input: z.object({
    caster: creatureId.describe('Whose rite it is. Nobody else may keep at it.'),
    castingId: z
      .string()
      .min(1)
      .describe('From the cast_spell that declared it, or from `look`’s `owed.pendingCastings`.'),
  }),
  run: (context, args) =>
    settleEvents(
      context,
      continueCasting(
        context.campaign.state(),
        who(args.caster),
        args.castingId,
        identity(context),
      ),
      { castingId: args.castingId },
    ),
});

/**
 * Acting through a spell that is still running — and the only door `via` has.
 *
 * **It is here because `route_required` is otherwise unanswerable.** The
 * engine asks a moving area which spaces it crossed, names `via` as the field
 * that answers, and until this tool existed there was no call on this surface
 * carrying that field or any other part of an activation: a model that cast
 * Moonbeam could never move the beam, and one that was asked the route
 * question by anything but a move had nowhere to put the answer. That is the
 * same defect the engine closed for itself — a refusal naming a field the
 * command does not have — standing one layer up.
 *
 * It takes no number. `to` and `via` are spaces on the lattice, the same
 * map-making `at` on a casting already is; the allowance the area may travel,
 * the sum of the legs, what the beam does to whoever it arrives on and whether
 * the caster can spend the action are all the engine's, read off the record
 * the casting pinned.
 *
 * **One call, not two**, because SRD writes Spiritual Weapon's move and swing
 * as one Bonus Action: a second command would charge a second action or none.
 * So the move, the route and the target ride together, exactly as
 * `ActivateSpellCommand` has them.
 */
const ACTIVATE_SPELL = tool({
  name: 'activate_spell',
  description:
    'Use a spell that is still running, on a later turn — Vampiric Touch striking again, Spiritual Weapon moving and then striking, Moonbeam’s beam walked across the room. The engine spends the action the spell asks for, reads the numbers the casting was made with, and rolls what it does. Name `to` for where the area ends up, and `via` for the spaces it crossed getting there.',
  mutates: true,
  establishes: ['route'],
  input: z.object({
    caster: creatureId.describe('Whose casting it is. Nobody else may act through it.'),
    castingId: z.string().min(1).describe('From the cast_spell that started it.'),
    targets: z
      .array(creatureId)
      .describe('Who it is aimed at this time. Empty for an activation whose whole content is moving the area.'),
    to: pointSchema
      .optional()
      .describe('Where the area ends up. Required when the action’s whole content is moving it, and left out by a spell that only strikes again.'),
    via: routeSchema
      .optional()
      .describe(
        'The 5-foot spaces the area crossed on the way, in order. Send it when an activation came back `route_required`: the same call again with this filled in is the whole of the answer. Each leg is settled where it happens, so a beam walked over three creatures is asked about all three.',
      ),
  }),
  run: (context, args) =>
    settle(
      context,
      activateSpell(
        context.campaign.state(),
        who(args.caster),
        {
          castingId: args.castingId,
          targets: args.targets.map(who),
          ...(args.to === undefined ? {} : { to: point(args.to) }),
          ...(args.via === undefined ? {} : { via: args.via.map(point) }),
          ...identity(context),
        },
        context.campaign.supply(),
      ),
      (value) => value.events,
      (value) => ({ castingId: value.castingId, outcomes: value.outcomes }),
      (value) => value.unverified,
    ),
});

const APPLY_CONDITION = tool({
  name: 'apply_condition',
  description:
    'Apply an SRD condition as the consequence of a ruling you have made — Prone after a fall, Frightened at a horror. The engine handles what the condition implies, what it interacts with, and whether the creature is immune. The ruling is recorded as the source, so a later reader can tell an adjudicated condition from one a spell imposed. Say when it ends with `until` wherever you can: nothing on this surface lifts a ruled condition early.',
  mutates: true,
  input: z.object({
    who: creatureId,
    condition: conditionSchema,
    ruling: z.string().min(1).describe('Why, in one phrase. Recorded in the log as the source.'),
    until: conditionDurationSchema
      .optional()
      .describe(
        'When it stops. Omit only for a condition that is meant to last until something in the fiction ends it — no command on this surface lifts one early.',
      ),
  }),
  run: (context, args) => {
    const until: Duration | undefined =
      args.until === undefined
        ? undefined
        : args.until.kind === 'end-of-current-turn'
          ? { kind: 'end-of-current-turn' }
          : { kind: args.until.kind, of: who(args.until.of) };
    return settleEvents(
      context,
      applyConditionTo(
        context.campaign.state(),
        who(args.who),
        args.condition as ConditionName,
        ruled(args.ruling),
        [],
        until,
        undefined,
        identity(context),
      ),
      { applied: args.condition, because: args.ruling, until: args.until ?? null },
    );
  },
});

const END_CONCENTRATION = tool({
  name: 'end_concentration',
  description:
    'Let go of a spell a creature is concentrating on. Everything the spell was holding up ends with it — the Paralyzed a Hold Person imposed, the area a Web filled. Voluntary; the engine ends Concentration by itself when the rules say it breaks.',
  mutates: true,
  input: z.object({ who: creatureId }),
  run: (context, args) =>
    settleEvents(
      context,
      endConcentration(context.campaign.state(), who(args.who), 'voluntary', identity(context)),
      { ended: 'concentration' },
    ),
});

/**
 * SRD Sleep: "The spell ends on a target if it takes damage or **someone
 * within 5 feet of it takes an action to shake it out of the spell's
 * effect**."
 *
 * The one thing in the book a creature spends its own Action on to end an
 * effect on **somebody else**, which is why it is a tool of its own rather
 * than a `kind` under `take_action`: every action there is something the
 * creature does to or for itself, and this one names a second creature.
 *
 * **It carries no number and no die**, which is what keeps it on this surface:
 * the Action is the engine's to charge, the five feet the engine's to measure,
 * and which effects end is the engine's to find. The caller states an intent
 * and nothing else.
 *
 * A creature holding nothing a shake would end is refused rather than charged,
 * because an Action spent on nothing is the one thing the book does not let a
 * table do by accident.
 */
const WAKE_CREATURE = tool({
  name: 'wake_creature',
  description:
    'Spend an Action shaking a creature within 5 feet out of a magical sleep or stupor — SRD Sleep’s "someone within 5 feet of it takes an action to shake it out of the spell’s effect", SRD Hypnotic Pattern’s stupor, a dragon’s sleep breath, a pseudodragon’s sting. It ends every one of those on that creature at once; nothing else, and nothing on anybody standing beside them. A creature holding nothing a shake would end is refused rather than charged, and so is one more than 5 feet away. A creature merely Unconscious at 0 Hit Points is not woken this way: what ends that is hit points.',
  mutates: true,
  input: z.object({
    who: creatureId.describe('The creature spending the Action.'),
    target: creatureId.describe('The sleeper being shaken — within 5 feet, and not themselves.'),
  }),
  run: (context, args) =>
    settleEvents(
      context,
      wakeCreature(context.campaign.state(), who(args.who), { target: who(args.target) }, identity(context)),
      { woke: args.target },
    ),
});

const END_ONGOING_SPELL = tool({
  name: 'end_ongoing_spell',
  description:
    'End a spell that is still running, by the casting id the cast reported. Everything it imposed ends with it. Name `on` to end it for one target only, where the spell works that way.',
  mutates: true,
  input: z.object({
    caster: creatureId,
    castingId: z.string().min(1).describe('From the cast_spell that started it.'),
    on: creatureId.optional().describe('End it for this target only.'),
  }),
  run: (context, args) =>
    settleEvents(
      context,
      endOngoingSpell(
        context.campaign.state(),
        who(args.caster),
        args.castingId,
        args.on === undefined ? null : who(args.on),
        identity(context),
      ),
      { ended: args.castingId },
    ),
});

// — what a character holds, and the four ways of spending it ———————————————

/**
 * The read a session needs before it can spend anything.
 *
 * **On a tool of its own rather than on `look` or on `options`**, and the
 * choice is between three questions rather than three shapes. `look` answers
 * *what is going on* — everybody in the room, where they are, what the engine
 * is owed — and is the largest read on the surface already; folding a feature
 * inventory into it would multiply that by the size of the roster on every
 * turn, for a caller that usually wants none of it. `options` answers *what
 * is open to this creature at this instant* — a debt in its way, a Reaction
 * window standing open, a check an ongoing effect offers — all of which go
 * away by themselves. What a character *holds* is neither: it is the sheet
 * and what is left of it, it changes only when something is spent, and it is
 * the thing a caller reads once and then reasons from.
 *
 * It exists because a model could not see its own spell slots. `look` carried
 * the levels of the ordinary pool that still had a use left, which is the
 * smaller half of the question: it said nothing about Pact Magic, nothing
 * about what had been spent, nothing about any feature pool, and nothing
 * about the features themselves. A caster with an empty fourth level and a
 * Warlock with two Pact slots looked exactly alike, and both found out by
 * being refused.
 */
const SHEET = tool({
  name: 'sheet',
  description:
    'What one character holds and what is left of it: hit points, conditions, spell slots by level, Pact Magic slots as their own pool, every feature pool with what refills it, the spells this character can actually cast and by which route, and the features themselves — which can be switched on, which spends a pool, which buys a named action at a cheaper price, which is only ever passive, and the name of the tool that spends each one. Read this before spending anything; a feature you have not been told about is one you cannot elect. Free, and changes nothing.',
  mutates: false,
  input: z.object({ who: creatureId }),
  run: (context, args) => {
    const held = holdingsOf(context.campaign.state(), who(args.who));
    if (held === null) {
      // A creature nobody has created is a thin record, not a mistake: the
      // engine's own `unknownCreature` says exactly this and is not reachable
      // from here, so the request is written out in the same shape.
      return fromErr(
        needsContext('unknown_creature', `${args.who} is not in this game`, [
          {
            kind: 'creature',
            subject: args.who,
            need: `a record for ${args.who}`,
            because: 'the call asks what a creature the engine has never been told about holds',
            satisfyWith: `a createCharacter command for ${args.who}`,
          },
        ]),
        context.doorsFor,
      );
    }
    return okOutcome([], { ...held });
  },
});

/**
 * Switch a feature on, and the three tools around it.
 *
 * SRD Rage is the shape all four are built to, and it needs the whole
 * lifecycle: it is entered as a Bonus Action out of a pool, it lasts until
 * the end of the holder's next turn, it is extended a round at a time, and it
 * can be dropped. `activate_feature` alone would be a door into a room with
 * no exit — a Rage that expired at the first turn boundary with nothing the
 * caller could say to keep it — so `extend_feature` and `end_feature` come
 * with it. All three are one engine command each and carry no number.
 *
 * **`by` is a fact, not a choice of price.** SRD offers three ways to extend
 * a Rage — "make an attack roll against an enemy, force an enemy to make a
 * saving throw, or take a Bonus Action" — and only the third costs anything.
 * The engine cannot see the first two for itself, so the caller says which
 * happened and the log records it, exactly as `fought` records who is already
 * in melee with whom.
 *
 * **And the extension has a ceiling, which the engine now keeps.**
 * SRD Rage prints one — "You can maintain a Rage for up to 10 minutes" — and
 * `ActivatedFeature.capSeconds` carries it onto the sheet at creation. This
 * comment used to say no command read it and that the bound was the table's;
 * `extendFeature` now refuses `cap_reached` before anything is spent, and the
 * ceiling is pinned at the activation and carried rather than re-derived, so
 * approaching it does not push it away. The description below says so, because
 * a description claiming less than the engine enforces is the same defect as
 * one claiming more: a model acts on it either way.
 */
const ACTIVATE_FEATURE = tool({
  name: 'activate_feature',
  description:
    'Switch on a feature the character can enter — Rage is the one the SRD writes this way. The engine charges whatever the feature’s own record says it costs: the Action or Bonus Action it names, where a fight is running and there is an economy to spend from, a use out of its pool, and the deadline it runs to. What it does while it runs is applied by itself for as long as it runs. A feature that imbues a weapon — Sacred Weapon is the one the SRD writes this way — needs `weapon` as well: name the one it is aimed at, and the engine refuses one the character is not carrying or one of a kind the feature does not reach, before anything is spent. The imbuing ends if that weapon is put down, and using the feature again moves it to a new one. Use `sheet` to see which features can be switched on, what each one costs and what is left of its pool.',
  mutates: true,
  input: z.object({
    who: creatureId,
    feature: z.string().min(1).describe('The feature id, from `sheet`, e.g. barbarian:rage.'),
    weapon: z
      .string()
      .min(1)
      .optional()
      .describe(
        'The weapon this use imbues, by item id — required for a feature that imbues one, such as oath-of-devotion:sacred-weapon, and refused for one that does not.',
      ),
  }),
  run: (context, args) =>
    settleEvents(
      context,
      activateFeature(
        context.campaign.state(),
        who(args.who),
        {
          feature: args.feature,
          ...(args.weapon === undefined ? {} : { weapon: args.weapon }),
          ...identity(context),
        },
        context.campaign.content,
      ),
      { activated: args.feature },
    ),
});

const EXTEND_FEATURE = tool({
  name: 'extend_feature',
  description:
    'Keep a running feature going for another round. SRD Rage offers three ways to do it and only one of them costs anything, so say which happened: `attack` if the character attacked an enemy, `forced-save` if it made one save, `bonus-action` to spend the Bonus Action on it. In a fight the engine replaces the feature’s deadline with a fresh one; outside a fight there are no turns, so there is no deadline to replace and the feature simply runs until something ends it. It **does** enforce the longest the feature may be maintained: `sheet` reports that as `capSeconds`, and an extension past it is refused `cap_reached` with nothing spent. The ceiling is fixed when the feature is activated, so maintaining it does not push it further away. A feature whose sheet prints no cap is not bounded by this. A feature the book gives a span to — `sheet` reports its `lasts` as a length of time, such as Innate Sorcery’s 1 minute or Large Form’s 10 — is not maintained at all and is refused `not_extendable`.',
  mutates: true,
  input: z.object({
    who: creatureId,
    feature: z.string().min(1).describe('The feature id, from `sheet`.'),
    by: z
      .enum(['attack', 'forced-save', 'bonus-action'])
      .describe('Which of the SRD’s three ways of extending it happened. Only the third costs anything.'),
  }),
  run: (context, args) =>
    settleEvents(
      context,
      extendFeature(context.campaign.state(), who(args.who), {
        feature: args.feature,
        by: args.by,
        ...identity(context),
      }),
      { extended: args.feature, by: args.by },
    ),
});

const END_FEATURE = tool({
  name: 'end_feature',
  description:
    'Switch a running feature off deliberately. It costs nothing and refunds nothing — the use that started it is spent. The engine ends one by itself when the feature’s own sentence says it ends.',
  mutates: true,
  input: z.object({
    who: creatureId,
    feature: z.string().min(1).describe('The feature id, from `sheet`.'),
  }),
  run: (context, args) =>
    settleEvents(
      context,
      endFeature(context.campaign.state(), who(args.who), {
        feature: args.feature,
        ...identity(context),
      }),
      { ended: args.feature },
    ),
});

/**
 * A thing a feature makes, through the door — SRD Gnomish Lineage's clockwork
 * device.
 *
 * Three tools and no number: the caller says which feature, what to call the
 * thing, which of the effects the feature prints it is being made to do, and
 * where it is put down. Every number is the engine's — the Armour Class, the
 * hit point, the ten minutes of casting, the eight hours it stands and the
 * ceiling on how many may stand at once — and `sheet` reports the menu under
 * the feature, because a caller cannot name what it cannot see.
 *
 * **What the thing does is prose and comes back as prose.** The SRD hands the
 * sentence over and so does this: `activate_device` spends the Bonus Action
 * and reports the effect the making pinned, for the table to narrate. No die
 * is thrown, because there is nothing here to throw one for.
 */
const CREATE_DEVICE = tool({
  name: 'create_device',
  description:
    'Make the thing one of the character’s features makes — SRD Rock Gnome’s clockwork device. Name the feature, give the thing an id and a name, and say which of the effects the feature prints it is being made to do; `sheet` lists them under the feature as `functions`. The engine spends the casting time on the clock, stands the thing in the scene with the Armour Class, hit points and size the feature prints, and refuses one more than the feature allows to exist at a time (`too_many_devices`). It is refused inside a fight, because the casting takes minutes and a fight’s seconds belong to the turn order. From then on it is an ordinary thing in the room: it can be attacked, it breaks, and when it falls apart `look` reports it under `strandedSummons` for `dismiss_stranded_summons` to take away.',
  mutates: true,
  establishes: ['creature'],
  input: z
    .object({
      who: creatureId.describe('The maker.'),
      feature: z.string().min(1).describe('The feature id, from `sheet`, e.g. gnome:gnomish-lineage.'),
      device: creatureId.describe('The id the thing will have in play, e.g. music-box.'),
      name: z.string().min(1).describe('What to call it: "a tin bird", "a music box". Narration.'),
      function: z
        .string()
        .min(1)
        .describe('Which of the effects the feature prints it does, word for word, from `sheet`.'),
      detail: z
        .string()
        .optional()
        .describe(
          'The option inside that effect, where it has one — "it lights, never snuffs". Free prose, recorded and handed back at every use.',
        ),
    })
    .and(placementSchema),
  run: (context, args) =>
    settleEvents(
      context,
      createDevice(context.campaign.state(), who(args.who), {
        feature: args.feature,
        device: who(args.device),
        name: args.name,
        function: args.function,
        ...(args.detail === undefined ? {} : { detail: args.detail }),
        placement: placementOf(args),
        ...identity(context),
      }),
      { made: args.device, does: args.function },
    ),
});

const DISMANTLE_DEVICE = tool({
  name: 'dismantle_device',
  description:
    'Take one of those things apart. Anybody within reach may do it and it costs nothing — the SRD prints no action for it. The thing leaves the game, and the room it takes up under the feature’s "how many at a time" ceiling goes with it.',
  mutates: true,
  input: z.object({
    who: creatureId.describe('Whoever is taking it apart. Reach is checked.'),
    device: creatureId.describe('The thing, by the id it was made with.'),
  }),
  run: (context, args) =>
    settleEvents(
      context,
      dismantleDevice(context.campaign.state(), who(args.who), {
        device: who(args.device),
        ...identity(context),
      }),
      { dismantled: args.device },
    ),
});

const ACTIVATE_DEVICE = tool({
  name: 'activate_device',
  description:
    'Touch one of those things and set it going. Anybody within reach may do it; the engine charges whatever the feature says it costs — a Bonus Action for the SRD’s clockwork device — where a fight is running, and reports the effect the thing was made to do, in the words its maker chose. **That sentence is yours to narrate**: the engine applies no part of it, because nothing in it is a rule. A thing whose maker is dead has stopped working and is refused.',
  mutates: true,
  input: z.object({
    who: creatureId.describe('Whoever is touching it. Reach is checked.'),
    device: creatureId.describe('The thing, by the id it was made with.'),
  }),
  run: (context, args) =>
    settle(
      context,
      activateDevice(context.campaign.state(), who(args.who), {
        device: who(args.device),
        ...identity(context),
      }),
      (use) => use.events,
      (use) => ({
        activated: args.device,
        does: use.function,
        ...(use.detail === null ? {} : { detail: use.detail }),
      }),
    ),
});

/**
 * A creature becoming another creature — SRD Wild Shape, through the door.
 *
 * Two tools and no number: the caller names the feature and a form the
 * character has learned, and the engine reads everything else off the sheet
 * and the bestiary — the Bonus Action, the use, the merged statistics, the
 * Temporary Hit Points and the hours. `sheet` lists the learned forms under
 * the feature as `forms`, because a caller cannot name what it cannot see and
 * the engine refuses a form that is not on the list. Leaving early is its own
 * tool because the SRD prices it separately ("as a Bonus Action") and a
 * caller should not have to know that `end_feature` would not take it.
 */
const ASSUME_SHAPE = tool({
  name: 'assume_shape',
  description:
    'Take one of the forms a character has learned — SRD Wild Shape. Name the feature and the form’s stat-block id from the `forms` the sheet lists under it. The engine charges the Bonus Action where a fight is running, spends one use of the feature’s pool, lays the form’s stat block over the character with the SRD’s retained half kept (creature type, Hit Points, Intelligence, Wisdom and Charisma, class features, proficiencies at the character’s own bonus), grants the Temporary Hit Points, and files the hours the form lasts. The form ends by itself when the hours run out, when the character takes another form, on the Incapacitated condition, or at death; `revert_shape` leaves it early. Nothing can be cast from inside a form, and worn gear is merged and silent until the form ends.',
  mutates: true,
  input: z.object({
    who: creatureId,
    feature: z.string().min(1).describe('The feature id, from `sheet`, e.g. druid:wild-shape.'),
    form: z
      .string()
      .min(1)
      .describe('The stat-block id of the form, one of the `forms` the sheet lists under the feature, e.g. wolf.'),
  }),
  run: (context, args) =>
    settleEvents(
      context,
      assumeShape(
        context.campaign.state(),
        who(args.who),
        { feature: args.feature, form: args.form, ...identity(context) },
        context.campaign.content,
      ),
      { assumed: args.form, feature: args.feature },
    ),
});

const REVERT_SHAPE = tool({
  name: 'revert_shape',
  description:
    'Leave a form early and stand in the character’s own shape again — SRD Wild Shape’s "You can also leave the form early as a Bonus Action." The engine charges the Bonus Action where a fight is running and refunds nothing: the use that took the form stays spent. The character’s own sheet comes back wearing whatever it is wearing now, and any Temporary Hit Points the form granted stay until spent or a Long Rest.',
  mutates: true,
  input: z.object({ who: creatureId }),
  run: (context, args) =>
    settleEvents(
      context,
      revertShape(context.campaign.state(), who(args.who), identity(context)),
      { reverted: true },
    ),
});

/** What a batch of events says was healed, for the caller's summary. */
const healedIn = (events: readonly GameEvent[]): number =>
  events.reduce((sum, event) => sum + (event.type === 'healed' ? event.amount : 0), 0);

/** What a batch of events says came out of a pool. */
const spentIn = (events: readonly GameEvent[]): number =>
  events.reduce((sum, event) => sum + (event.type === 'resource-spent' ? event.amount : 0), 0);

/**
 * Spend a use of a feature to heal its own holder.
 *
 * SRD Second Wind — "you can use it to regain Hit Points equal to 1d10 plus
 * your Fighter level" — and Wholeness of Body, which is the same sentence
 * with the Monk's die. **The caller names the feature and nothing else**: the
 * die, what is added to it, the floor and the cap at the hit point maximum
 * are every one of them the engine's, read off the sheet at the moment the
 * die is thrown.
 */
const HEAL_WITH_FEATURE = tool({
  name: 'heal_with_feature',
  description:
    'Spend a use of a feature that restores the character’s own hit points — the SRD writes this as “you can use it to regain Hit Points equal to” a die plus something. The engine spends the use, spends the Bonus Action if there is a fight running, throws the die, adds whatever the feature adds and caps the result at the hit point maximum. You name the feature; every number is the engine’s.',
  mutates: true,
  input: z.object({
    who: creatureId,
    feature: z.string().min(1).describe('The feature id, from `sheet`, e.g. fighter:second-wind.'),
  }),
  run: (context, args) =>
    settle(
      context,
      useSelfHeal(
        context.campaign.state(),
        who(args.who),
        { feature: args.feature, ...identity(context) },
        context.campaign.supply(),
      ),
      (events) => events,
      (events) => ({ used: args.feature, restored: healedIn(events) }),
    ),
});

/**
 * Draw on a pool of hit points by touching somebody — and the one quantity on
 * this surface that a caller really does choose.
 *
 * SRD Lay On Hands: "you can touch a creature (which could be yourself) and
 * draw power from the pool of healing to restore a number of Hit Points to
 * that creature, **up to the maximum amount remaining in the pool**." How
 * many of the Paladin's own points to spend is a decision the rules hand the
 * player, and it is the same kind of decision `slotLevel` already is: which
 * of your own resources to spend, checked against what you actually have. It
 * decides nothing the rules otherwise decide — the engine refuses a drawing
 * larger than the pool before anything is spent, caps the healing at the
 * target's maximum, and charges the feature's own price for every condition
 * lifted.
 *
 * `hitPoints` may be zero, because SRD's five points for the Poisoned
 * condition "don't also restore Hit Points to the creature": a touch whose
 * whole content is lifting is a legal touch.
 */
const DRAW_ON_HEALING_POOL = tool({
  name: 'draw_on_healing_pool',
  description:
    'Touch a creature — which may be the character themselves — and spend a feature’s pool of hit points on them, and on lifting the conditions that feature lifts. The SRD lets the user decide how much of their own pool to draw, so `hitPoints` is yours; everything else is the engine’s, including the five-foot reach, the price of each condition, and the refusal when the pool does not hold what was asked for. `sheet` reports the pool, what is left of it and which conditions the feature lifts.',
  mutates: true,
  input: z.object({
    who: creatureId.describe('Whose pool is being drawn on.'),
    feature: z.string().min(1).describe('The feature id, from `sheet`, e.g. paladin:lay-on-hands.'),
    target: creatureId.describe('Who is touched. May be the same creature.'),
    hitPoints: z
      .int()
      .min(0)
      .optional()
      .describe(
        'How many hit points to draw out of the pool. Zero, or left out, for a touch whose whole content is lifting a condition — the SRD’s points for that buy the lifting and heal nothing.',
      ),
    lift: z
      .array(conditionSchema)
      .optional()
      .describe(
        'Conditions to end, each at the feature’s own price out of the same pool. The engine refuses one this feature does not lift.',
      ),
  }),
  run: (context, args) =>
    settle(
      context,
      useHealingTouch(context.campaign.state(), who(args.who), {
        feature: args.feature,
        target: who(args.target),
        ...(args.hitPoints === undefined ? {} : { hitPoints: args.hitPoints }),
        ...(args.lift === undefined ? {} : { lift: args.lift as readonly ConditionName[] }),
        ...identity(context),
      }),
      (events) => events,
      (events) => ({
        used: args.feature,
        drawn: spentIn(events),
        restored: healedIn(events),
        lifted: args.lift ?? [],
      }),
    ),
});

/**
 * Spend a feature that gives a *different* pool's uses back.
 *
 * SRD Sorcerous Restoration, Magical Cunning, Uncanny Metabolism, Persistent
 * Rage. **How much comes back is derived and there is no field for it**: the
 * cap is the feature's own sentence, what is actually expended is the pool's,
 * and the smaller of the two is what is given — the same reason an effect
 * check has no field for a result.
 *
 * Each of them names a moment, and two of the three moments the engine can
 * see it refuses outside of. That refusal is the one a caller acts on: it
 * says when the feature happens, and the answer is to call it then.
 */
const REGAIN_USES = tool({
  name: 'regain_uses',
  description:
    'Spend a feature whose whole content is giving another pool’s uses back — the SRD writes these as “you can regain expended” something, at a moment the feature names. The engine works out how much comes back from the feature’s own sentence and what is actually expended; there is no amount to send. It refuses when the moment has passed, when the feature’s own use is gone, and when there is nothing expended to give back.',
  mutates: true,
  input: z.object({
    who: creatureId,
    feature: z
      .string()
      .min(1)
      .describe('The feature id, from `sheet`, e.g. warlock:magical-cunning.'),
  }),
  run: (context, args) =>
    settle(
      context,
      useRecovery(
        context.campaign.state(),
        who(args.who),
        { feature: args.feature, ...identity(context) },
        context.campaign.supply(),
      ),
      (events) => events,
      (events) => ({
        used: args.feature,
        regained: events.reduce(
          (sum, event) => sum + (event.type === 'resource-regained' ? event.amount : 0),
          0,
        ),
        restored: healedIn(events),
      }),
    ),
});

/**
 * Spend a use of a pool on one of the things that use buys.
 *
 * SRD Channel Divinity: one pool, a named menu, and every item on it at the
 * same price of one use. **The note above says two pools were left shut
 * because nothing executed what a use bought, and for this one that has
 * stopped being true**: a feature's pool use is the third host of an effect
 * list, so Turn Undead rolls its Wisdom saves against the Cleric's own spell
 * save DC and Divine Spark heals or harms with the die the Cleric table
 * gives. A door onto a room that now exists.
 *
 * **Paladin's Channel Divinity is still shut, and by the same rule.** It
 * declares the pool and prints no options the engine executes, so `sheet`
 * reports no feature line for it and there is nothing here to call — which is
 * the argument working rather than an omission.
 *
 * `target` is who the option is aimed at, checked against the reach the option
 * prints; `damageType` is which of the types the option prints this use deals,
 * refused unless the option prints a choice and refused when it prints one and
 * the call names none. That is `cast_spell`'s own rule, asked of a feature —
 * and `damage_type_required` is answerable here as well as there.
 *
 * **`among` is the one field on this surface that carries numbers, and it is
 * not the rule bending.** SRD Preserve Life ends "divide those Hit Points
 * among them", and a division is a decision the book hands the Cleric that
 * nothing here could make for them — the same kind of thing `slotKind` and
 * `payment` are, with an amount attached. Three things keep it inside the
 * line. No die is thrown by this option at all, so there is no roll for a
 * caller to have produced; the *budget* is five times the Cleric level, read
 * off the sheet by the engine and stated in the refusal that asks for the
 * shares; and every share is refused rather than trusted — against that
 * budget, against the thirty feet the option prints, against half each
 * creature's Hit Point maximum, and against the kinds of creature the option
 * will not touch. A caller who sends twenty-six of twenty-five gets
 * `too_much_divided` and spends nothing.
 *
 * **Every question about whether a division is legal is left to the engine**,
 * including the two a schema could easily have answered. The floor — a whole
 * number of at least one — is `bad_share`, and an empty list is
 * `division_required`, which is the same answer the field's *absence* gets. A
 * bound in the schema would have made `among: []` and a missing `among` two
 * different outcomes for one mistake, and turned a rule about what a share is
 * into a caller reading `invalid` and going to look for a typo. What Zod asks
 * is only that a share is an integer aimed at a creature.
 */
const USE_POOL_OPTION = tool({
  name: 'use_pool_option',
  description:
    'Spend one use of a feature whose pool buys a menu of things — SRD Channel Divinity is the one the book writes this way, with Turn Undead and Divine Spark on it. Name the feature and which item off its menu; `sheet` lists both, what each costs in the action economy and what is left of the pool. The engine charges the action, spends the use, works out who the option reaches, derives the save DC and the dice from the character’s own sheet and rolls them.',
  mutates: true,
  input: z.object({
    who: creatureId,
    feature: z
      .string()
      .min(1)
      .describe('The feature id, from `sheet`, e.g. cleric:channel-divinity.'),
    option: z
      .string()
      .min(1)
      .describe('Which of the things a use buys, from that feature’s `options`, e.g. turn-undead.'),
    shape: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Which of the shapes an option offers this use takes — SRD Breath Weapon’s "a 15-foot Cone or a 30-foot Line that is 5 feet wide (choose the shape each time)". Named by the shape itself: `cone` or `line`. Leaving it out for an option that offers a choice is refused, and naming one for an option that prints a single area is refused too.',
      ),
    towards: pointSchema
      .optional()
      .describe('Point a Cone or a Line at this exact spot. Every area an option prints starts at its holder, so this is the whole of where it goes.'),
    towardsCreature: creatureId
      .optional()
      .describe('Point a Cone or a Line at this creature instead.'),
    towardsLandmark: z
      .string()
      .min(1)
      .optional()
      .describe('Point it at this landmark instead.'),
    target: creatureId
      .optional()
      .describe(
        'Who it is aimed at, for an option that names one creature. Left out for an option that fills an area and catches whoever is in it, and left out for one aimed at the user themselves.',
      ),
    damageType: damageTypeSchema
      .optional()
      .describe(
        'Which of the damage types the option prints this use deals — SRD Divine Spark’s "Necrotic or Radiant damage (your choice)". Leaving it out for an option that prints a choice is refused, and naming one for an option that prints a single type is refused too.',
      ),
    teleportTo: placementSchema
      .optional()
      .describe(
        'Where an option that teleports puts its holder — SRD Cloud’s Jaunt’s "up to 30 feet to an unoccupied space you can see". Measured from a landmark or a creature like every other destination, never as a raw coordinate. The engine checks the distance, the space and the sight; which space is yours. Leaving it out for an option that teleports is refused, and naming one for an option that does not is refused too.',
      ),
    among: z
      .array(
        z.strictObject({
          target: creatureId.describe('Who this share goes to.'),
          hitPoints: z
            .int()
            .describe('How much of the pot this creature gets. Yours to divide; the engine checks every one of them.'),
        }),
      )
      .optional()
      .describe(
        'How to divide the hit points a distributing option mints — SRD Preserve Life’s "divide those Hit Points among them". How many there are to divide is the engine’s and is in the refusal that asks for this; which creature gets how much is yours, and the book gives that choice to nobody else. Every share is checked before a single hit point is paid: against the total minted, against the reach the option prints, against half each creature’s maximum, and against the kinds of creature the option will not touch. Left out for an option that is aimed at a creature rather than divided.',
      ),
  }),
  run: (context, args) => {
    const state = context.campaign.state();
    // A Cone or a Line has to be pointed somewhere, and the three ways of
    // saying where are the casting door's own — a point, a creature, a
    // landmark — resolved by the one function that knows what to ask for when
    // nobody has been placed.
    const towards = towardsOf(state, args);
    if (!towards.ok) return fromErr(towards, context.doorsFor);
    return settle(
      context,
      usePoolOption(
        state,
        who(args.who),
        {
          feature: args.feature,
          option: args.option,
          ...(args.shape === undefined ? {} : { shape: args.shape }),
          ...(towards.value === undefined ? {} : { towards: towards.value }),
          ...(args.target === undefined ? {} : { target: who(args.target) }),
          ...(args.damageType === undefined ? {} : { damageType: args.damageType }),
          ...(args.teleportTo === undefined
            ? {}
            : { teleportTo: placementOf(args.teleportTo) }),
          ...(args.among === undefined
            ? {}
            : {
                among: args.among.map((share) => ({
                  target: who(share.target),
                  hitPoints: share.hitPoints,
                })),
              }),
          ...identity(context),
        },
        context.campaign.supply(),
      ),
      (value) => value.events,
      (value) => ({ feature: args.feature, used: args.option, outcomes: value.outcomes }),
      (value) => value.unverified,
    );
  },
});

/**
 * Spend a use of a pool on room in the turn's own budget.
 *
 * `use_pool_option` one kind of purchase along, and the difference is what
 * the use buys: an effect list is aimed at somebody, and this is aimed at the
 * turn. SRD Action Surge — "you can take one additional action, except the
 * Magic action" — and SRD Flurry of Blows — "expend 1 Focus Point to make two
 * Unarmed Strikes as a Bonus Action" — are the two the book writes this way.
 *
 * **This is the last of the pools the note above says were left shut, and the
 * sentence that shut it has stopped being true.** "A pool a caller can spend
 * for no effect is worse than one it cannot spend, because the use would be
 * gone" — and nothing granted the extra action, so Action Surge stayed shut
 * while Channel Divinity and Bardic Inspiration opened. `useBudgetPurchase`
 * grants it: an extra action and extra attacks are written into the
 * `TurnBudget` by a combat event, which is the only thing that may write one.
 * The engine executed both purchases for a week and no tool called the
 * command, which is the gap `sheet`'s `spentBy` exists to make visible.
 *
 * **It carries no number and states no outcome.** The whole of the call is
 * whose turn it is, which feature sells the purchase and which purchase — the
 * price in the action economy, the use out of the pool, the once-a-turn
 * clause and what the budget gains are all read off the sheet the character
 * was created with. `sheet` lists the feature, what is left of its pool and
 * every purchase it sells.
 *
 * **It refuses outside a fight**, which is the engine's own ruling passed
 * through and the one place this differs from its neighbours: a self-heal out
 * of combat heals and simply spends no action, while an additional action
 * does not exist where there is no turn order at all — so buying one there
 * would spend the use on nothing and report success.
 */
const USE_BUDGET_PURCHASE = tool({
  name: 'use_budget_purchase',
  description:
    'Spend one use of a feature whose pool buys room in this turn — SRD Action Surge’s additional action and SRD Flurry of Blows’ two Unarmed Strikes are the two the book writes this way. Name the feature and which of the things its uses buy; `sheet` lists both, what each costs in the action economy and what is left of the pool. The engine charges the price the purchase prints, spends the use, and adds what it buys to this turn’s budget — the extra action is then taken through the ordinary tools, and the extra attacks through `attack`. It refuses outside a fight, where there is no turn to add to, and it refuses a second use on a turn where the feature says once.',
  mutates: true,
  input: z.object({
    who: creatureId.describe('Whose turn it is, and whose pool pays for it.'),
    feature: z
      .string()
      .min(1)
      .describe('The feature id, from `sheet`, e.g. fighter:action-surge or monk:focus.'),
    purchase: z
      .string()
      .min(1)
      .describe('Which of the things a use buys, from that feature’s `buys`, e.g. flurry-of-blows.'),
  }),
  run: (context, args) =>
    settleEvents(
      context,
      useBudgetPurchase(context.campaign.state(), who(args.who), {
        feature: args.feature,
        purchase: args.purchase,
        ...identity(context),
      }),
      { feature: args.feature, bought: args.purchase },
    ),
});

/**
 * Pay for one resource with another, and gain a level — the two doors a
 * character needs to go on being one.
 *
 * ## `trade_resource`
 *
 * `regain_uses` one door along, and the pair is the SRD's own split: that one
 * gives a pool's uses **back**, free, at a moment the feature names; this one
 * *buys* them out of something else. "You can expend a spell slot to regain
 * one expended use of Bardic Inspiration"; "you can expend one use of Wild
 * Shape to give yourself a level 1 spell slot". `tradeResource` has run both
 * ends of that since it landed — the two refusals, the once-a-turn ledger key
 * and the once-a-day pool of one — and **nothing above it could ask**, so two
 * level 5 features were stopped at a door that did not exist and `sheet`
 * reported neither.
 *
 * **The caller names the feature, which of its trades, and at most one number
 * that is not a number.** SRD Wild Resurgence prints two trades in one
 * sentence running in opposite directions with different limits, so the trade
 * is named as well as the feature; `sheet` lists both under the feature, with
 * the two pool keys each one runs between. `slotLevel` is `cast_spell`'s own
 * field with the same justification: "expend **a spell slot**" leaves the
 * level to the caster, the engine picks between candidates nowhere, and
 * `slot_level_required` is the refusal that asks for it — the one refusal
 * `doors.test.ts` recorded as answerable through no field on either surface.
 *
 * **How much comes back is derived and there is no field for it**, which is
 * `regain_uses`'s rule and is load-bearing here: `restore` never takes a pool
 * above its maximum, so a trade gives back what was spent rather than minting
 * what no class table printed, and a caster holding all of theirs is refused
 * `nothing_to_regain` with nothing spent at either end.
 *
 * **`gainedSlotLevels` is `slotLevel`'s mirror and arrived for the mirror
 * reason.** SRD Font of Magic creates "one spell slot" at a level the Sorcerer
 * picks off a printed price table, and SRD Arcane Recovery recovers slots the
 * Wizard names inside a combined-level budget: which slot is *bought* is no
 * more this engine's to guess than which slot is burnt. It is a list because
 * one of those two sentences names several at once; a trade that buys one
 * refuses a list of two rather than reading its first entry. What each costs
 * is still not here — `sheet` publishes the table and the budget, and the
 * engine charges off them.
 *
 * ## `advance_character`
 *
 * **Levels, not experience points.** Owner ruling, 2026-09-20: XP is not state
 * in this engine and is not to become state. So the door takes the level the
 * character is arriving at, and everything that level gives — the hit points,
 * the pools that grew, the slots that opened, the features — is the class
 * table's and is the engine's to derive. There is no number here a caller
 * produced: a level is which rung, exactly as `slotLevel` is which slot.
 *
 * **Why the level is declared rather than implied.** `advanceCharacter` takes
 * no `CommandIdentity`, so the engine cannot fingerprint the call, and a door
 * that simply meant "one more" would advance a character twice the first time
 * a transport re-sent its call. A call naming the rung it is arriving at
 * cannot: the retry is arriving at a level the character is already at, and is
 * refused with nothing written. It is also the one thing a caller can state
 * that an orchestrator can check against the sheet it was just shown.
 *
 * **`hitPointRoll` and `dmGrants` are not here**, for the two reasons
 * `create_character` already excludes their equivalents: a rolled hit die is a
 * number the caller produced, and what the party found on the way up is the
 * DM's to award. Neither is lost by their absence — the engine keeps the
 * character's own hit point method and whatever grants the record already
 * carries.
 */
const TRADE_RESOURCE = tool({
  name: 'trade_resource',
  description:
    'Spend one of a character’s resources to buy back another — the SRD writes these as “you can expend X to regain Y”, and SRD Font of Inspiration and Wild Resurgence are the two in the book. Name the feature and which of its trades; `sheet` lists both under the feature, with the pools each end runs between, what limits it and whether you have to choose a slot level. How much comes back is the engine’s: a trade gives back what was spent and never mints a use a class table did not print, so it refuses when there is nothing expended to give back, when the clause the trade prints does not hold, and when the limit is already used — spending nothing at either end.',
  mutates: true,
  input: z.object({
    who: creatureId.describe('Whose feature it is. Both ends are spent and gained here.'),
    feature: z
      .string()
      .min(1)
      .describe('The feature id, from `sheet`, e.g. bard:font-of-inspiration.'),
    trade: z
      .string()
      .min(1)
      .describe(
        'Which of that feature’s trades, from its `trades` on `sheet`, e.g. slot-for-inspiration. A feature prints more than one — SRD Wild Resurgence runs in both directions — so naming the feature is not enough.',
      ),
    slotLevel: z
      .int()
      .min(1)
      .max(9)
      .optional()
      .describe(
        'Which slot to expend, for a trade that spends one and leaves the level to the caster — SRD’s "expending a spell slot". The trade’s `slotLevelRequired` on `sheet` says whether this one does; sending it for a trade that spends a named pool instead is simply ignored, and leaving it out where it is wanted is refused rather than guessed at.',
      ),
    gainedSlotLevels: z
      .array(z.int().min(1).max(9))
      .optional()
      .describe(
        'Which spell slots to buy back, for a trade that leaves that to the caster — SRD Font of Magic creates one slot at a level you pick, and SRD Arcane Recovery recovers several inside a combined-level budget. The trade’s `gainedSlotLevelsRequired` on `sheet` says whether this one wants it, and `priceBySlotLevel`, `combinedSlotLevels` and `maxSlotLevel` beside it say what you may ask for. This is which rung, never how much: the price is the engine’s, off the printed table, and a slot you have not expended is refused rather than minted.',
      ),
  }),
  run: (context, args) =>
    settle(
      context,
      tradeResource(context.campaign.state(), who(args.who), {
        feature: args.feature,
        trade: args.trade,
        ...(args.slotLevel === undefined ? {} : { slotLevel: args.slotLevel }),
        ...(args.gainedSlotLevels === undefined ? {} : { gainedSlotLevels: args.gainedSlotLevels }),
        ...identity(context),
      }),
      (events) => events,
      (events) => ({
        feature: args.feature,
        traded: args.trade,
        // Both halves, read off the events the engine wrote rather than off
        // the call: a trade that spends a daily use as well as its price
        // writes two, and what is actually given back is capped at what was
        // expended. Neither number was ever the caller's.
        spent: events
          .filter((event) => event.type === 'resource-spent')
          .map((event) => ({ pool: event.key, uses: event.amount })),
        regained: events
          .filter((event) => event.type === 'resource-regained')
          .map((event) => ({ pool: event.key, uses: event.amount })),
      }),
    ),
});

/**
 * One feat, as a level-up states it.
 *
 * Named rather than written inline because it is the type the converter takes,
 * so {@link featChoiceOf} and the schema cannot drift apart. `abilitySchema`
 * is shared with `create_character` rather than restated: an ability is a
 * closed list of six, and a second copy of a closed list is how a seventh gets
 * accepted at one door and refused at the other.
 */
const advanceFeatSchema = z.strictObject({
  featId: z.string().min(1),
  spellList: z.string().min(1).optional(),
  spellcastingAbility: abilitySchema.optional(),
  cantrips: z.array(z.string().min(1)).optional(),
  levelOneSpell: z.string().min(1).optional(),
  proficiencies: z.array(z.string().min(1)).optional(),
  abilities: z
    .array(z.string().min(1))
    .optional()
    .describe(
      'Which scores the points go into, one entry per point: ["str","str"] is one score by 2 and ["str","dex"] is two by 1.',
    ),
});

const advanceSchema = z.object({
  who: creatureId.describe('The character going up, e.g. lyra.'),
  toLevel: z
    .int()
    .min(2)
    .max(20)
    .describe(
      'The character level they are arriving at: one more than the `level` on their `sheet`. Total character level, so a Fighter 3 / Wizard 2 taking a third Wizard level is arriving at 6.',
    ),
  classId: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Which class the level is taken in. Left out for the character’s starting class, which is the ordinary case; naming another deepens an existing multiclass or begins a new one at its level 1.',
    ),
  subclassId: z
    .string()
    .min(1)
    .optional()
    .describe('The subclass, for the level whose class table asks for one.'),
  cantrips: z
    .array(z.string().min(1))
    .optional()
    .describe('The whole cantrip list as it now stands, for a level that adds one.'),
  newSpells: z
    .array(z.string().min(1))
    .optional()
    .describe(
      'Spells this level grants — two, for a Wizard. Added to the book as the subset a class table’s count is measured against.',
    ),
  copiedSpells: z
    .array(z.string().min(1))
    .optional()
    .describe(
      'Spells copied from scrolls or other books since the last level. Added to the book and deliberately *not* counted, so a Wizard who looted a scroll is not told their book is the wrong size.',
    ),
  preparedSpells: z
    .array(z.string().min(1))
    .optional()
    .describe('The whole prepared list as it now stands, for a single-class caster.'),
  spellsByClass: z
    .record(
      z.string().min(1),
      z.strictObject({
        cantrips: z.array(z.string().min(1)).optional(),
        preparedSpells: z.array(z.string().min(1)).optional(),
      }),
    )
    .optional()
    .describe(
      'The same lists for a character with more than one casting class, keyed by class id, because preparation is per class and each count comes from that class’s own table. A Wizard/Cleric taking a Cleric level restates the Cleric’s list here.',
    ),
  featureChoices: z
    .record(z.string().min(1), z.array(z.string().min(1)))
    .optional()
    .describe(
      'The choices the new level’s features ask for, keyed by feature id — a skill, an option off a printed list, a spell a feature grants. A level that asks for one and is not given it is refused by name.',
    ),
  featureSpellcasting: z
    .record(z.string().min(1), abilitySchema)
    .optional()
    .describe(
      'The spellcasting ability a trait that grants spells asks for, keyed by the trait — an origin trait may print a choice of three. Also how a character made before such a trait was executed answers it for the first time.',
    ),
  feats: z
    .record(z.string().min(1), advanceFeatSchema)
    .optional()
    .describe(
      'The feat the level’s Ability Score Improvement takes, keyed by the feature id offering the slot, with whatever that feat itself asks for.',
    ),
  /**
   * The GM's decision, narrowed to the note exactly as `create_character`
   * narrows it — and it is here because without it a level 1 party cannot
   * reach level 2 at all.
   *
   * SRD "Starting at Higher Levels" makes a character above level 1 state what
   * the GM handed out beyond the standard package, and the plan asks for it at
   * every level above the first. A character *created* at level 1 has none on
   * its record, so its first level-up is the first time anything asks — and
   * `missing_dm_grants` was then a refusal this door could not answer, which is
   * the failure `doors.test.ts`'s fourth guard exists for.
   *
   * **Nothing is granted through it.** The items, the gold and the magic items
   * are empty here as they are at creation: what the party found is
   * `award_items`, and that is the DM's door. The note is the whole of what a
   * caller says, and "nothing beyond the standard package" is a fine answer.
   */
  dmGrants: z
    .strictObject({
      note: z
        .string()
        .min(1)
        .describe(
          'Why, in the GM’s own words — "nothing beyond the standard package" will do.',
        ),
    })
    .optional()
    .describe(
      'What the GM handed out with this level beyond the standard package, in the GM’s own words. The rules ask for it from level 2 up, so a character created at level 1 states it on its first level-up and a character created higher already has one on its record. It grants nothing by itself — items and gold are the DM’s `award_items`.',
    ),
});

const ADVANCE_CHARACTER = tool({
  name: 'advance_character',
  description:
    'Take a character up one level. Say which level they are arriving at — this engine keeps no experience points, so a level is declared the way any other fact about the fiction is — along with any choices that level asks for. Everything the level gives is derived from the class tables: the hit points, the spell slots, the pools that grow and the features that arrive. It is not a rebuild: wounds, conditions and slots already spent are kept exactly as they are. A level that is not the next one is refused, which is also what makes re-sending this call safe.',
  mutates: true,
  input: advanceSchema,
  run: (context, args) => {
    const state = context.campaign.state();
    const id = who(args.who);
    const creature = state.creatures[id];
    if (creature === undefined) {
      // A creature nobody has created is homework, and homework names the door
      // that does it. `advanceCharacter` hand-writes `needsContext` with no
      // `ContextRequest` at all, so a caller following the answer would be
      // told a fact was missing and given nothing to establish it with — which
      // is the failure `docs/design/claude-integration.md` calls "a kind with
      // no door". `sheet` hits the same engine gap and closes it here in the
      // same shape; this is that, one door along.
      return fromErr(
        needsContext('unknown_creature', `${args.who} is not in this game`, [
          {
            kind: 'creature',
            subject: args.who,
            need: `a record for ${args.who}`,
            because: 'the call takes a creature the engine has never been told about up a level',
            satisfyWith: `a createCharacter command for ${args.who}`,
          },
        ]),
        context.doorsFor,
      );
    }
    // Only a character has a level to be the next one after, so a monster falls
    // through to the engine's own `not_a_character` rather than being told
    // about a rung it was never on. So does a character at the ceiling, where
    // there is no next level to name and `bad_level` is the honest answer.
    const at = creature.character == null ? null : creature.sheet.level;
    if (at !== null && at < MAX_LEVEL && args.toLevel !== at + 1) {
      return refused(
        'not_the_next_level',
        `${id} is level ${at} and this door takes one level at a time, so the next one is ${at + 1}, not ${args.toLevel}`,
      );
    }
    return settle(
      context,
      advanceCharacter(state, context.campaign.content, id, advanceOf(args)),
      (events) => events,
      () => ({ who: args.who, level: args.toLevel }),
    );
  },
});

/**
 * Zod's level-up choices, in the engine's advancement vocabulary.
 *
 * `choicesOf`'s job one door along, and written out field by field for the
 * same reason: `exactOptionalPropertyTypes` makes "absent" and "present and
 * undefined" different types, the engine asks for the first and an optional
 * Zod field produces the second.
 *
 * **Its argument is the schema's own inferred type**, not a structural one
 * written out beside it. A hand-written parameter compiles after a field is
 * renamed in the schema and hands the engine `undefined` in silence, which is
 * exactly the drift the paragraph above is about.
 *
 * `who` and `toLevel` are not passed on at all. The level is this surface's
 * guard — the engine takes the next level as read — and two fields carrying
 * one fact are a pair that can disagree.
 */
function advanceOf(input: z.infer<typeof advanceSchema>): AdvanceChoices {
  return {
    ...(input.classId === undefined ? {} : { classId: input.classId }),
    ...(input.subclassId === undefined ? {} : { subclassId: input.subclassId }),
    ...(input.cantrips === undefined ? {} : { cantrips: input.cantrips }),
    ...(input.newSpells === undefined ? {} : { newSpells: input.newSpells }),
    ...(input.copiedSpells === undefined ? {} : { copiedSpells: input.copiedSpells }),
    ...(input.preparedSpells === undefined ? {} : { preparedSpells: input.preparedSpells }),
    ...(input.spellsByClass === undefined
      ? {}
      : {
          spellsByClass: Object.fromEntries(
            Object.entries(input.spellsByClass).map(([classId, chosen]) => [
              classId,
              {
                ...(chosen.cantrips === undefined ? {} : { cantrips: chosen.cantrips }),
                ...(chosen.preparedSpells === undefined
                  ? {}
                  : { preparedSpells: chosen.preparedSpells }),
              },
            ]),
          ),
        }),
    ...(input.featureChoices === undefined ? {} : { featureChoices: input.featureChoices }),
    ...(input.featureSpellcasting === undefined
      ? {}
      : { featureSpellcasting: input.featureSpellcasting }),
    ...(input.feats === undefined
      ? {}
      : {
          feats: Object.fromEntries(
            Object.entries(input.feats).map(([slot, choice]) => [slot, featChoiceOf(choice)]),
          ),
        }),
    // The two lists and the purse are empty, as they are at creation: this
    // surface grants no equipment and no magic item, and the note is the whole
    // of what a caller says.
    ...(input.dmGrants === undefined
      ? {}
      : { dmGrants: { items: [], goldPieces: 0, magicItems: [], note: input.dmGrants.note } }),
  };
}

/** One feat choice, with the keys Zod left undefined dropped. See {@link advanceOf}. */
function featChoiceOf(choice: z.infer<typeof advanceFeatSchema>): FeatChoice {
  return {
    featId: choice.featId,
    ...(choice.spellList === undefined ? {} : { spellList: choice.spellList }),
    ...(choice.spellcastingAbility === undefined
      ? {}
      : { spellcastingAbility: choice.spellcastingAbility }),
    ...(choice.cantrips === undefined ? {} : { cantrips: choice.cantrips }),
    ...(choice.levelOneSpell === undefined ? {} : { levelOneSpell: choice.levelOneSpell }),
    ...(choice.proficiencies === undefined ? {} : { proficiencies: choice.proficiencies }),
    ...(choice.abilities === undefined ? {} : { abilities: choice.abilities }),
  };
}

/**
 * Put a Reaction in somebody else's hands — and the second of the two pools
 * that were deliberately left shut.
 *
 * The rule that shut them is the right one and it has stopped applying here,
 * exactly as it stopped applying to Channel Divinity: "a pool a caller can
 * spend for no effect is worse than one it cannot spend". What a use of
 * Bardic Inspiration buys is executed — the recipient holds a real Reaction
 * with an hour on it, and `take_test_reaction` spends it on a D20 Test that
 * came back a failure — so the room this door opens onto exists, and the only
 * thing missing was the door.
 *
 * **Nothing is handed over and no number is stated.** The use is spent on the
 * giver; which die the recipient ends up holding is read off the giver's own
 * class table, pinned at the moment of conferral. The whole of the call is
 * whose feature it is and who is being inspired, and every question about
 * whether they may be — another creature, within the range the feature
 * prints, with a use left, on a turn that can afford the Bonus Action — is the
 * engine's, asked before the use is spent.
 *
 * **"Who can see or hear you" comes back in `unverified`.** Sight is declared
 * and hearing is modelled nowhere, so the conferral is made rather than
 * withheld and the half nobody can check is reported, which is the rule every
 * other offer on this surface already keeps.
 */
const CONFER_REACTION = tool({
  name: 'confer_reaction',
  description:
    'Spend a use of a feature that gives somebody else a Reaction — SRD Bardic Inspiration is the one the book writes this way. Name the feature and who is being inspired; `sheet` lists the feature, what it costs in the action economy and what is left of its pool. The die, the range and how long it lasts are the feature’s own and read off the giver’s class table. The creature who receives it holds it until it is used or the hour runs out, and spends it through `take_test_reaction` when a d20 comes back a failure.',
  mutates: true,
  input: z.object({
    who: creatureId.describe('Whose feature it is. The use is spent here.'),
    feature: z
      .string()
      .min(1)
      .describe('The feature id, from `sheet`, e.g. bard:bardic-inspiration.'),
    target: creatureId.describe('Who is being given the Reaction.'),
  }),
  run: (context, args) =>
    settle(
      context,
      conferReaction(context.campaign.state(), who(args.who), {
        feature: args.feature,
        target: who(args.target),
        ...identity(context),
      }),
      (value) => value.events,
      () => ({ conferred: args.feature, to: args.target }),
      (value) => value.unverified,
    ),
});

/**
 * Dodge, Dash, Disengage or Hide — and which slot pays for the three of them
 * that take one.
 *
 * **`from` is here because the engine already takes it and nothing could say
 * it.** `takeDisengage` has taken a slot since SRD Conjure Woodland Beings
 * gave the engine a sentence to model — "you can take the Disengage action as
 * a Bonus Action for the spell's duration" — and `STATABLE_PRICES` records
 * which named action may come out of which. With two fields on this tool the
 * allowance was unreachable from any caller at all: whatever granted it, the
 * only call that could invoke it spent an Action every time.
 *
 * It states no price. The caller names which slot it is asking to pay from and
 * the engine rules on whether this creature may — a slot nothing granted is
 * refused rather than quietly charged at the ordinary price, which is the
 * substitution `DisengageOptions` promises never to make. Two different
 * refusals, and both are the engine's: `action_not_allowed` for a price the
 * engine *can* charge and nothing has granted, `no_such_price` for one no
 * command charges at all.
 *
 * **A Dash takes one too, and this comment used to say it could not.** It said
 * that a Dash "cannot be paid for out of a Bonus Action *at all* — `takeDash`
 * has no `from` — is an engine gap", and the schema refused the field on that
 * reading. `takeDash` takes a slot now, `STATABLE_PRICES` holds `dash`, and
 * the schema admits it. That was not a cosmetic gap while it lasted: SRD
 * Cunning Action's Dash and SRD Adrenaline Rush's — "You can take the Dash
 * action as a Bonus Action" — were both executed underneath and reachable from
 * nobody. A description that asserts a gap the engine has closed is the same
 * defect as one that claims a rule the engine lacks, because a model acts on
 * it either way.
 *
 * **Hide is a kind here now, and it was not one at all.** `takeHide` joined
 * `NAMED_ACTIONS` with its own spender: the DC 15 Dexterity (Stealth) check,
 * the Invisible condition a success buys, the watchers and the cover. Until it
 * was offered here, `rogue:cunning-action` could be invoked for one of the
 * three verbs the sentence prints.
 *
 * **Hide is the named action whose legality turns on facts only the table
 * holds, and each way it can refuse arrives as itself.** Who can see the hider
 * is the table's fact and the check
 * is the engine's, so a sight line nobody has settled is *homework* —
 * `needs-context`, one request per watcher, tagged `visibility` and therefore
 * carrying `declare_sight` as the door that settles it — where a settled line
 * saying the enemy is looking is `seen` and closes the question. `not_concealed`
 * is the cover the sentence asks for and does not have, and `immune` is a
 * creature the Invisible condition would buy nothing for. Nothing is rolled
 * until the whole attempt is known to be legal, so a refused Hide costs
 * neither the slot nor a turn of the dice.
 *
 * **What grants a cheaper price is content, and the SRD hands out four of
 * them.** `rogue:cunning-action` holds three — Dash, Disengage and Hide, the
 * three clauses of one sentence — and `orc:adrenaline-rush` holds the Dash.
 * Conjure Woodland Beings' own entry still records its allowance as
 * adjudicated, because the spell's other half is a creature the engine does
 * not summon, so the homebrew path `disengage.test.ts` drives is still the
 * only way to reach that one. Nothing in this file names any of them: a
 * definition granting `{ kind: 'allows', action: 'hide', from: 'bonus-action' }`
 * reaches this field with no change here or in the engine.
 *
 * **`from` is still refused for a Dodge, and `obscured` for everything but a
 * Hide**, on {@link placementSchema}'s rule rather than as a rules judgement:
 * `takeDodge` has no slot parameter and the other three commands have no
 * obscurement, so either key sent to the wrong kind would be one Zod strips in
 * silence and a caller acting on an answer it never got.
 */
const TAKE_ACTION = tool({
  name: 'take_action',
  description:
    'Take Dodge, Dash, Disengage, Hide, Utilize or Help. Each costs what the book charges unless something running on the creature says otherwise — SRD Cunning Action, SRD Adrenaline Rush and SRD Fast Hands are the three the book writes this way — and where something does, `from` is how it is invoked. A slot nothing has granted this creature is refused rather than charged at the usual price. A Hide is the one that can be refused for reasons other than the price: it needs cover or darkness and needs to be out of every enemy’s sight, and where nobody has said whether an enemy can see the hider you are asked rather than refused. A Utilize is what an object that takes an action costs, and what buys the second object interaction of a turn. A Help gives one ally Advantage on their next ability check with a skill you are proficient with, or on their next attack roll against an enemy within 5 feet of you, until they use it or the start of your next turn. Search, Study and Influence are the DM’s door rather than this one, because each of them needs a DC.',
  mutates: true,
  input: z
    .object({
      who: creatureId,
      kind: z.enum(['dodge', 'dash', 'disengage', 'hide', 'utilize', 'help']),
      from: z
        .enum(['action', 'bonus-action', 'reaction'])
        .optional()
        .describe(
          'Which slot to pay a Dash, a Disengage, a Hide or a Utilize out of, where something running on the creature has made a cheaper one available — SRD Cunning Action’s "Dash, Disengage, or Hide" as a Bonus Action, SRD Adrenaline Rush’s Dash, SRD Fast Hands’ Utilize. `sheet` lists the features a character holds. Omit for what the book charges, which is an Action. A slot nothing has granted this creature is refused, and so is one no command charges at all. A Dodge and a Help take none.',
        ),
      using_feature: z
        .string()
        .min(1)
        .optional()
        .describe(
          'Which of this creature’s allowances is paying, by the feature’s id — for the case where more than one reaches the same action and slot. An Orc Rogue holds SRD Adrenaline Rush and SRD Cunning Action, both of which offer a Dash as a Bonus Action; omit this and the free one is taken, name the trait to spend a use of it for the Temporary Hit Points it pays. It is also how the second half of a bought pair is taken: a Monk who spent a Focus Point on `also_taking` names `monk:focus` on the second action, which then costs nothing. A feature this creature does not hold is refused.',
        ),
      also_taking: z
        .array(z.enum(['dodge', 'dash', 'disengage', 'hide', 'utilize']))
        .min(1)
        .optional()
        .describe(
          'The other actions this one spend is buying together — SRD Patient Defense’s "expend 1 Focus Point to take both the Disengage and the Dodge actions as a Bonus Action", and SRD Step of the Wind’s Dash and Disengage. Naming them is what asks for the priced pair rather than the free single sentence beside it. They are handed to the turn and each is then taken by its own call with `using_feature` naming the feature that bought it, at no further cost. Nothing that allows the whole set is refused.',
        ),
      obscured: z
        .boolean()
        .optional()
        .describe(
          'True when the hider is Heavily Obscured — in fog, in darkness, in a cloud of the stuff. SRD Hide asks for that *or* Three-Quarters or Total Cover, and the engine models no light, so this is yours to state and cover is declared through `declare_cover`. Half Cover is not enough and never stands in for it. Only a Hide takes it.',
        ),
      object: z
        .string()
        .min(1)
        .optional()
        .describe(
          'What is being used, in your own words: "the lever", "the winch". Recorded in the log and nothing else — what the object does is the table’s. Only a Utilize takes it.',
        ),
      ally: creatureId
        .optional()
        .describe('The ally a Help is for. Required for a Help and taken by nothing else.'),
      skill: skillSchema
        .optional()
        .describe(
          'The skill a Help is offered on, for the ability-check half. SRD asks you to choose one of your **own** proficiencies, so a skill this creature is not proficient with is refused. Exclusive with `enemy`.',
        ),
      enemy: creatureId
        .optional()
        .describe(
          'The enemy a Help distracts, for the attack half — the book asks for one within 5 feet of the helper, and the engine measures it where anybody has been placed. Exclusive with `skill`.',
        ),
    })
    .refine((value) => value.from === undefined || !['dodge', 'help'].includes(value.kind), {
      error: 'a Dodge and a Help cost an Action and cannot be paid for out of a named slot',
      path: ['from'],
    })
    .refine((value) => value.also_taking === undefined || value.from !== undefined, {
      error:
        'a pair bought with one spend names the slot that spend comes out of; `from` is how the cheaper price is asked for',
      path: ['also_taking'],
    })
    .refine((value) => value.also_taking === undefined || !(value.also_taking as readonly string[]).includes(value.kind), {
      error: 'the action being taken is `kind`; name only the *other* actions the spend buys',
      path: ['also_taking'],
    })
    .refine((value) => value.using_feature === undefined || value.kind !== 'help', {
      error: 'a Help costs an Action and no feature allowance moves it',
      path: ['using_feature'],
    })
    .refine((value) => value.obscured === undefined || value.kind === 'hide', {
      error: 'only a Hide asks whether the creature is Heavily Obscured',
      path: ['obscured'],
    })
    .refine((value) => value.object === undefined || value.kind === 'utilize', {
      error: 'only a Utilize names the object being used',
      path: ['object'],
    })
    .refine((value) => value.kind !== 'help' || value.ally !== undefined, {
      error: 'a Help is for an ally; name which one',
      path: ['ally'],
    })
    .refine((value) => value.ally === undefined || value.kind === 'help', {
      error: 'only a Help names an ally',
      path: ['ally'],
    })
    .refine(
      (value) =>
        value.kind !== 'help' || (value.skill === undefined) !== (value.enemy === undefined),
      {
        error:
          'SRD Help prints two halves and this names one of them: a skill for the ability-check half, or an enemy for the attack half, and never both or neither',
        path: ['skill'],
      },
    )
    .refine((value) => value.skill === undefined || value.kind === 'help', {
      error: 'only a Help names a skill here; a DM’s `ability_check` is where a check is asked for',
      path: ['skill'],
    })
    .refine((value) => value.enemy === undefined || value.kind === 'help', {
      error: 'only a Help names an enemy',
      path: ['enemy'],
    }),
  run: (context, args) => {
    const state = context.campaign.state();
    const id = who(args.who);
    // Which allowance is paying and what else the one spend buys — see
    // `AllowanceChoice` in the engine. Both travel with the slot, because
    // between them they answer one question: which of this creature's
    // allowances the command should take.
    const slot = {
      ...(args.from === undefined ? {} : { from: args.from }),
      ...(args.using_feature === undefined ? {} : { usingFeature: args.using_feature }),
      ...(args.also_taking === undefined ? {} : { alsoTaking: args.also_taking }),
    };
    const took = {
      took: args.kind,
      ...(args.from === undefined ? {} : { paidFrom: args.from }),
      ...(args.using_feature === undefined ? {} : { paidBy: args.using_feature }),
      ...(args.also_taking === undefined ? {} : { alsoBought: args.also_taking }),
    };
    // Hide is the one of the four that answers with more than its events — the
    // engine's own check — so it settles through `settle` rather than the
    // shorthand. `hidden` is whether *this attempt* hid them, which is not the
    // same question as whether the creature is hiding: a replay under the same
    // command id is told `duplicate` and answers `false` to both.
    if (args.kind === 'hide') {
      return settle(
        context,
        takeHide(
          state,
          id,
          {
            ...slot,
            ...(args.obscured === undefined ? {} : { obscured: args.obscured }),
            ...identity(context),
          },
          context.campaign.supply(),
        ),
        (value) => value.events,
        (value) => ({
          ...took,
          natural: value.check?.natural ?? null,
          total: value.check?.total ?? null,
          hidden: value.hidden,
          duplicate: value.duplicate ?? false,
        }),
        (value) => value.unverified ?? [],
      );
    }
    // Help is the other one that answers with more than its events: the five
    // feet SRD asks for go unchecked where nobody has been placed, and an
    // unverified clause is how this surface says so rather than refusing.
    if (args.kind === 'help') {
      return settle(
        context,
        takeHelp(
          state,
          id,
          args.skill === undefined
            ? {
                kind: 'attack',
                ally: who(args.ally!),
                enemy: who(args.enemy!),
                ...identity(context),
              }
            : { kind: 'check', ally: who(args.ally!), skill: args.skill, ...identity(context) },
        ),
        (value) => value.events,
        (value) => ({ ...took, helped: args.ally, duplicate: value.duplicate }),
        (value) => value.unverified,
      );
    }
    const command =
      args.kind === 'dodge'
        ? takeDodge(
            state,
            id,
            identity(context),
            args.using_feature === undefined ? {} : { usingFeature: args.using_feature },
          )
        : args.kind === 'utilize'
          ? takeUtilize(state, id, {
              ...slot,
              ...(args.object === undefined ? {} : { object: args.object }),
              ...identity(context),
            })
          : args.kind === 'dash'
            ? takeDash(state, id, identity(context), slot)
            : takeDisengage(state, id, identity(context), slot);
    return settleEvents(context, command, took);
  },
});

const TAKE_OPPORTUNITY_ATTACK = tool({
  name: 'take_opportunity_attack',
  description:
    'Take the Opportunity Attack a creature’s move offered you. The mover is held where it was until every creature offered one has answered, and nothing else can happen until then.',
  mutates: true,
  input: z.object({
    attacker: creatureId.describe('Creature taking the Reaction.'),
    weapon: z.string().min(1).optional().describe('Catalogue id. Omit for an Unarmed Strike.'),
  }),
  run: (context, args) =>
    settle(
      context,
      takeOpportunityAttack(
        context.campaign.state(),
        who(args.attacker),
        { weapon: args.weapon ?? null, ...identity(context) },
        context.campaign.supply(),
      ),
      (value) => value.events,
      (value) => ({
        hit: value.attack?.hit ?? null,
        natural: value.attack?.roll.natural ?? null,
        total: value.attack?.total ?? null,
        ...(value.damage === undefined ? {} : { damageDealt: value.damage }),
      }),
      (value) => value.unverified,
    ),
});

const DECLINE_OPPORTUNITY = tool({
  name: 'decline_opportunity',
  description:
    'Decline the Opportunity Attack a move offered you. The move completes once every creature offered one has answered, so declining is how a held move gets unstuck.',
  mutates: true,
  input: z.object({ attacker: creatureId }),
  run: (context, args) =>
    settleEvents(
      context,
      declineOpportunity(context.campaign.state(), who(args.attacker), identity(context)),
      { declined: true },
    ),
});

/**
 * The four doors onto a window that is open, and the two that close one.
 *
 * `reactionOpportunities` has reported every offer since it was written and
 * `options` has published them since this surface had an `options` — so a
 * caller could *see* that a Shield, an Uncanny Dodge or a Tactical Mind was
 * available and had no call to make. Three of the six windows were shut on
 * this side: a hit that is held, a damage roll that has not landed, and a D20
 * Test whose effects have not occurred.
 *
 * **None of these carries a number.** A window names a (creature, feature)
 * pair and the whole of the call is which pair; how much a reduction takes off,
 * what a reroll comes back as, what is finally dealt and whether a use is
 * refunded are the engine's, read off the feature's own sentence.
 *
 * **Each window that holds something has a door that closes it**, because a
 * window nothing closes wedges the fight it was opened in: `end_turn` refuses
 * while a hit is held or damage is waiting, which is the engine keeping a debt
 * rather than a bug. A held hit is settled by its attacker; held damage is
 * settled by `settle_damage` whether or not anybody answered. The D20 Test's
 * settlement is the **DM's**, beside the check that opened it — the engine
 * opens one only for a check or a save somebody set a DC for, and a DC is a
 * number this surface does not carry.
 */
const SETTLE_ATTACK = tool({
  name: 'settle_attack',
  description:
    'Roll the damage of a hit that was held, and deal it. Everything the roll needs was written down when the hit landed, so this takes nothing but whose hit it is. Call it when the target has answered the window or is not going to: nothing else can happen while a hit is held, including ending the turn. A Shield that turned the blow aside closes the hold by itself, and there is then nothing to settle.',
  mutates: true,
  input: z.object({
    attacker: creatureId.describe('Whose held hit it is. Only the attacker may settle it.'),
    damageTypes: z
      .record(z.string().min(1), z.string().min(1))
      .optional()
      .describe(
        'Name a damage type where something gives this blow a choice of one — SRD Divine Strike is "Necrotic or Radiant damage (your choice)" and SRD Shillelagh’s staff "can be Force damage or the weapon’s normal damage type". A map from what offers the choice to the type chosen: a feature by its id, and a spell that imbued the weapon by the spell’s name. Written "your choice" in the book, so leaving one out declines it and the blow deals what it would otherwise deal. A type the offer does not print, and an offerer this creature has nothing from, are each refused before anything is rolled.',
      ),
  }),
  run: (context, args) =>
    settle(
      context,
      resolveAttackDamage(
        context.campaign.state(),
        who(args.attacker),
        {
          ...(args.damageTypes === undefined ? {} : { featureDamageTypes: args.damageTypes }),
          ...identity(context),
        },
        context.campaign.supply(),
      ),
      (value) => value.events,
      (value) => ({
        ...(value.damage === undefined ? {} : { damageDealt: value.damage }),
        ...(value.reactions === undefined
          ? {}
          : { mayAnswer: value.reactions.map((offer) => offer.reactor) }),
        duplicate: value.duplicate,
      }),
      (value) => value.unverified,
    ),
});

const TAKE_DAMAGE_REACTION = tool({
  name: 'take_damage_reaction',
  description:
    'Answer a damage roll that has not landed with a feature that reduces it — SRD Uncanny Dodge, Deflect Attacks, Cutting Words. `options` lists what this creature is offered and whether the feature costs its Reaction; you name the feature and the engine rolls or halves whatever the feature says. The damage is still waiting afterwards: `settle_damage` deals what is left.',
  mutates: true,
  input: z.object({
    who: creatureId.describe('Who is answering.'),
    feature: z.string().min(1).describe('The feature id, from `options`, e.g. rogue:uncanny-dodge.'),
  }),
  run: (context, args) =>
    settle(
      context,
      takeDamageReaction(
        context.campaign.state(),
        who(args.who),
        { feature: args.feature, ...identity(context) },
        context.campaign.supply(),
      ),
      (value) => value.events,
      (value) => ({
        took: args.feature,
        prevented: value.reduction?.amount ?? 0,
        duplicate: value.duplicate,
      }),
    ),
});

const DECLINE_DAMAGE_REACTION = tool({
  name: 'decline_damage_reaction',
  description:
    'Let a damage roll pass without answering it. SRD is explicit that ignoring a trigger costs nothing and keeps the Reaction — but the offer is gone, so it cannot be taken afterwards. Name a feature to pass on one offer and leave the others; name none to pass on every offer this creature holds against this roll.',
  mutates: true,
  input: z.object({
    who: creatureId,
    feature: z
      .string()
      .min(1)
      .optional()
      .describe('Pass on this one offer. Omit to pass on all of them.'),
  }),
  run: (context, args) =>
    settleEvents(
      context,
      declineDamageReaction(context.campaign.state(), who(args.who), {
        ...(args.feature === undefined ? {} : { feature: args.feature }),
        ...identity(context),
      }),
      { declined: args.feature ?? 'every offer' },
    ),
});

/**
 * Swing back at whatever just hurt you — the third window's feature half.
 *
 * SRD Retaliation: "When you take damage from a creature that is within 5 feet
 * of you, you can take a Reaction to make one melee attack against that
 * creature, using a weapon or an Unarmed Strike."
 *
 * **Two halves, and only the spell one had a door.** *Hellish Rebuke* is cast
 * into this moment through `cast_spell` and always could be; the feature half
 * is `takeDamageResponse`, which landed with the third timing family and
 * reached no tool — so `options` reported the offer and nothing could answer
 * it, which is the failure the note names: "a window a caller can see and
 * cannot answer is worse than one it is never shown."
 *
 * **There is no `decline` beside it, and that is not an omission.** This
 * window holds nothing open: the damage is applied, the hit points have moved,
 * and nothing the reactor does can change any of it. An offer nobody takes
 * wedges nothing, so there is nothing for a declining call to close — which is
 * exactly why the other two windows have one and this one does not.
 *
 * The only field beside the feature is which weapon, and it names a thing
 * rather than a number: who is swung at is forced by the trigger, and the
 * reach, the roll and the damage are the ordinary attack's.
 */
const TAKE_DAMAGE_RESPONSE = tool({
  name: 'take_damage_response',
  description:
    'Answer damage that has already landed by swinging back — SRD Retaliation. `options` lists it when something within reach has just hurt this creature. You name the feature and, if you like, the weapon; who it is aimed at is forced by whoever did the hurting, and the engine spends the Reaction and rolls the attack. Nothing is being held open here: the damage is done either way, so an offer nobody takes needs no call to close it.',
  mutates: true,
  input: z.object({
    who: creatureId.describe('Who is swinging back.'),
    feature: z
      .string()
      .min(1)
      .describe('The feature id, from `options`, e.g. berserker:retaliation.'),
    weapon: z
      .string()
      .min(1)
      .optional()
      .describe('Catalogue id of the weapon swung. Omit for an Unarmed Strike.'),
  }),
  run: (context, args) =>
    settle(
      context,
      takeDamageResponse(
        context.campaign.state(),
        who(args.who),
        {
          feature: args.feature,
          ...(args.weapon === undefined ? {} : { weapon: args.weapon }),
          ...identity(context),
        },
        context.campaign.supply(),
      ),
      (value) => value.events,
      (value) => ({
        took: args.feature,
        // Who the trigger forced the swing onto, so a caller narrating it does
        // not have to work out who hit them from the log.
        against:
          value.events.find((event) => event.type === 'reaction-taken')?.against ?? null,
        hit: value.attack?.hit ?? null,
        natural: value.attack?.roll.natural ?? null,
        total: value.attack?.total ?? null,
        ...(value.damage === undefined ? {} : { damageDealt: value.damage }),
        duplicate: value.duplicate,
      }),
      (value) => value.unverified,
    ),
});

/**
 * Answer the blow itself, before its damage is rolled — the fourth window's
 * feature half.
 *
 * SRD Parry: "_Trigger:_ The knight is hit by a melee attack roll while
 * holding a weapon. _Response:_ The knight adds 2 to its AC against that
 * attack, possibly causing it to miss."
 *
 * **The spell half has had a door since Shield landed** — *Shield* is cast
 * into this instant through `cast_spell` — and the feature half reached no
 * tool at all, so seven stat blocks carried a Reaction nobody could take.
 *
 * **There is no `decline` beside it**, for `take_damage_response`'s reason
 * turned the other way: the hold here is the *attacker's*, opened by asking
 * for it, and `settle_attack` is what closes it. An offer nobody takes wedges
 * nothing, because the attacker rolls the damage either way.
 */
const TAKE_ATTACK_REACTION = tool({
  name: 'take_attack_reaction',
  description:
    'Answer a hit whose damage has not been rolled — SRD Parry adds to the Armour Class against that one attack, possibly turning it into a miss. `options` lists it when a hit is being held against this creature. You name the feature; the engine checks the clauses the line prints (a melee swing, a weapon in hand), spends the Reaction and re-decides the hit against the raised number. A blow that still lands is still held, and the attacker rolls its damage as usual.',
  mutates: true,
  input: z.object({
    who: creatureId.describe('Who is answering. Always the creature that was hit.'),
    feature: z.string().min(1).describe('The feature id, from `options`, e.g. knight:parry.'),
  }),
  run: (context, args) =>
    settle(
      context,
      takeAttackReaction(
        context.campaign.state(),
        who(args.who),
        { feature: args.feature, ...identity(context) },
        context.campaign.supply(),
      ),
      (value) => value.events,
      (value) => ({
        took: args.feature,
        // Whether the blow was turned aside, which is the whole question a
        // caller took the Reaction to ask.
        missed: value.missed,
        duplicate: value.duplicate,
      }),
      (value) => value.unverified,
    ),
});

const SETTLE_DAMAGE = tool({
  name: 'settle_damage',
  description:
    'Deal a damage roll that was held open for Reactions, minus whatever they took off it. Anybody still to answer is recorded as passing, which is how a caller says nobody is going to. The engine applies Resistance, Vulnerability and Immunity to what is left and asks for the Concentration save if one is owed; you supply nothing at all. Until this is called every other action refuses, including ending the turn.',
  mutates: true,
  input: z.object({}),
  run: (context) =>
    settle(
      context,
      settleDamage(context.campaign.state(), context.campaign.supply(), identity(context)),
      (value) => value.events,
      (value) => ({
        amount: value.amount,
        concentration: value.concentration.kind,
        duplicate: value.duplicate,
      }),
    ),
});

const TAKE_TEST_REACTION = tool({
  name: 'take_test_reaction',
  description:
    'Push a d20 roll that has come back and whose effects have not happened yet — SRD Indomitable rerolls it, Dark One’s Own Luck and Tactical Mind add a die, Cutting Words subtracts one. `options` lists what this creature is offered and whether it costs a Reaction; most of these cost none. You name the feature and the engine rolls, adds or rerolls what the feature prints, and reports the new total.',
  mutates: true,
  input: z.object({
    who: creatureId.describe('Who is answering. Not necessarily whoever rolled.'),
    feature: z.string().min(1).describe('The feature id, from `options`, e.g. fighter:indomitable.'),
  }),
  run: (context, args) =>
    settle(
      context,
      takeTestReaction(
        context.campaign.state(),
        who(args.who),
        { feature: args.feature, ...identity(context) },
        context.campaign.supply(),
      ),
      (value) => value.events,
      (value) => ({
        took: args.feature,
        total: value.test?.total ?? null,
        success: value.test?.success ?? null,
        duplicate: value.duplicate,
      }),
    ),
});

const DECLINE_TEST_REACTION = tool({
  name: 'decline_test_reaction',
  description:
    'Let a d20 roll stand without pushing it. It costs nothing and keeps the Reaction, and the offer is spent. Name a feature to pass on one offer; name none to pass on every offer this creature holds against this roll.',
  mutates: true,
  input: z.object({
    who: creatureId,
    feature: z
      .string()
      .min(1)
      .optional()
      .describe('Pass on this one offer. Omit to pass on all of them.'),
  }),
  run: (context, args) =>
    settleEvents(
      context,
      declineTestReaction(context.campaign.state(), who(args.who), {
        ...(args.feature === undefined ? {} : { feature: args.feature }),
        ...identity(context),
      }),
      { declined: args.feature ?? 'every offer' },
    ),
});

/**
 * Roll the saves the world already owes, whenever they were raised.
 *
 * **`end_turn` used to be the only door to them, and that stopped being
 * enough the moment a save could be raised by something other than a
 * boundary.** SRD Magmin: "The magmin explodes when it dies" — a fighter drops
 * it on their own turn, the fold raises a Dexterity save on everybody in the
 * ten-foot Emanation, and `end_turn` then *refuses* with `saves_pending`
 * because a debt is outstanding. Without this there was nothing that could
 * clear it, and the fight would stop on a rule the engine had correctly
 * noticed.
 *
 * `settle_area_effects`' twin, and it takes no arguments for the same reason:
 * the debt is in state, the engine knows what is owed and at what DC, and the
 * caller is instructing it to settle what it is owed rather than naming one.
 * **No number crosses this door in either direction** — the DC was pinned when
 * the moment was raised, and the dice are the engine's.
 *
 * **An empty sweep is an answer and not a refusal**, which is the rule every
 * settlement door on this surface keeps: a caller sweeping after every blow
 * must not have to tell "nothing to do" from a rule it broke.
 */
const SETTLE_SAVES = tool({
  name: 'settle_saves',
  description:
    'Roll every saving throw the world owes and nobody has rolled — the repeats a turn boundary raised, and the ones a moment forced: a Death Burst going off when a creature dies, an aura catching somebody whose turn has just begun. The engine reads the DC off whatever raised the save and applies what a failure costs; you supply nothing but the instruction to do it now. `look` reports them as outstanding, and ending the turn refuses while any stand, so call it as soon as the state shows one. Sweeping when nothing is owed is an empty answer rather than a refusal.',
  mutates: true,
  input: z.object({}),
  run: (context) =>
    settle(
      context,
      resolvePendingSaves(context.campaign.state(), context.campaign.supply(), identity(context)),
      (value) => value.events,
      (value) => ({
        savesRolled: value.saves.map((save) => ({ label: save.label, success: save.success })),
        savesOutstanding: value.pending.length,
        duplicate: value.duplicate ?? false,
      }),
      (value) => value.unverified,
    ),
});

const SETTLE_AREA_EFFECTS = tool({
  name: 'settle_area_effects',
  description:
    'Settle what a persistent area — a Grease, a Web — has caught somebody doing. The engine rolls the save, reads the DC off the casting and applies whatever the spell says; you supply nothing but the instruction to do it now. Until this is called every other action refuses, including ending the turn, so call it as soon as the state shows any owed.',
  mutates: true,
  input: z.object({}),
  run: (context) =>
    settle(
      context,
      settleAreaEffects(context.campaign.state(), context.campaign.supply(), identity(context)),
      (value) => value.events,
      (value) => ({
        settled: value.settled.map((owed) => ({
          castingId: owed.castingId,
          target: owed.target,
          moment: owed.moment,
        })),
        outcomes: value.outcomes,
      }),
      (value) => value.unverified,
    ),
});

const ATTEMPT_EFFECT_CHECK = tool({
  name: 'attempt_effect_check',
  description:
    'Attempt a check a running spell offers against its own effect — the Investigation that sees through an illusion, the Athletics that tears free of Black Tentacles. `options` lists what is available and gives each one its effectKey. The Difficulty Class was written down when the effect was created and is not yours to set.',
  mutates: true,
  input: z.object({
    who: creatureId,
    effectKey: z.string().min(1).describe('From `options`, which reports checksAvailable.'),
    ...sensesFields,
  }),
  run: (context, args) =>
    settle(
      context,
      resolveEffectCheck(
        context.campaign.state(),
        who(args.who),
        { effectKey: args.effectKey, ...senses(args), ...identity(context) },
        context.campaign.supply(),
      ),
      (value) => value.events,
      (value) => ({
        natural: value.check?.natural ?? null,
        total: value.check?.total ?? null,
        success: value.success,
        onSuccess: value.onSuccess,
        duplicate: value.duplicate ?? false,
      }),
    ),
});

/**
 * The clock, the rest it measures, and the potion somebody drank.
 *
 * **A rest is a span and not a button**, which is why three doors arrive
 * together and none of them is enough alone. `begin_rest` starts it,
 * `advance_time` moves the clock the rest is measured against — no command on
 * this surface moved it at all, so a rest begun could never have run its
 * course — and `end_rest` grants exactly what the span earned. A Short Rest is
 * what makes a Warlock and a Fighter work across two fights rather than one,
 * and until these existed a session could spend a Second Wind and never get it
 * back.
 *
 * **Time out of combat is narration, which is why it is a door here at all.**
 * In a fight the clock is derived and nobody decides it; outside one, how long
 * the party spent walking is the same kind of fact as how wide the room is and
 * where the cover stands, and the engine has always taken it as declared
 * (`advanceTime`: "how long the party spent searching the vault is narration,
 * so it arrives as an event"). It is stated in the game's own units rather
 * than in seconds, because a caller that types 3600 has done arithmetic the
 * layer can do for it.
 *
 * **What the rest gives back is never stated.** The benefit is read off the
 * clock and off the interruptions the engine recorded as they happened — a
 * completed Long Rest, a Long Rest broken after an hour (a Short Rest), a
 * Short Rest broken at all (nothing). The one thing a caller chooses is which
 * Hit Dice to spend, which is `slotLevel`'s kind of choice and not a quantity:
 * the die is rolled by the engine and what Constitution adds to it is read off
 * the sheet as it stands.
 *
 * **A settled rest is idempotent under its command id**, like every other
 * call here. It was not, and the reason was an engine signature rather than
 * anything this layer could paper over: `endRest` took no identity, so a
 * retry of a settlement that landed was answered `not_resting` instead of as
 * a duplicate. The signature changed; this passes the id.
 */
const ADVANCE_TIME = tool({
  name: 'advance_time',
  description:
    'Say that time passed, outside a fight. In a fight the clock is the engine’s — a round is six seconds and nobody decides that — but how long the party spent walking, searching or resting is narration, and this is how the narration reaches the clock. Durations that were running expire on it, and a rest is measured by it. Say how long in rounds, minutes or hours, and say what the party was doing.',
  mutates: true,
  input: z
    .object({
      rounds: z.int().min(0).optional().describe('Six seconds apiece.'),
      minutes: z.int().min(0).optional(),
      hours: z.int().min(0).optional(),
      because: z
        .string()
        .min(1)
        .describe('What the party was doing, in one phrase. Recorded in the log.'),
    })
    .refine(
      (args) => (args.rounds ?? 0) + (args.minutes ?? 0) + (args.hours ?? 0) > 0,
      'time has to move by something: give rounds, minutes or hours',
    ),
  run: (context, args) => {
    const seconds = (args.rounds ?? 0) * 6 + (args.minutes ?? 0) * 60 + (args.hours ?? 0) * 3600;
    return settleEvents(
      context,
      advanceTime(context.campaign.state(), seconds, args.because, identity(context)),
      { seconds, because: args.because },
    );
  },
});

const BEGIN_REST = tool({
  name: 'begin_rest',
  description:
    'Start a Short or Long Rest for one creature. It is a span rather than a moment: let the clock run with `advance_time` and then call `end_rest`, which grants whatever the span earned. The engine notices the interruptions it can see — Initiative rolled, a spell cast, damage taken — as they happen, so nobody has to report them. A creature at 0 hit points is making death saves rather than resting, and is refused.',
  mutates: true,
  input: z.object({
    who: creatureId,
    kind: z.enum(['short', 'long']).describe('SRD: a Short Rest is an hour, a Long Rest is eight.'),
  }),
  run: (context, args) =>
    settleEvents(
      context,
      beginRest(context.campaign.state(), who(args.who), args.kind, context.commandId),
      { resting: args.kind },
    ),
});

const END_REST = tool({
  name: 'end_rest',
  description:
    'End a rest and take what it earned. The engine reads the benefit off the clock and off the interruptions it recorded: a completed rest pays in full, a Long Rest broken after an hour pays as a Short Rest, and a Short Rest broken at all pays nothing. A rest that has simply not finished yet is refused, and the answer is to let more time pass. Name Hit Dice to spend them — a Short Rest is the only rest that offers it, the engine rolls each one and adds the Constitution it finds on the sheet, and asking for more than are left is refused before any is rolled. A rest a character finishes also re-asks whatever their features re-ask — the type of land a Circle of the Land Druid wakes up in, the one prepared spell a Wizard studies out of their book — and saying nothing keeps yesterday’s answer.',
  mutates: true,
  input: z.object({
    who: creatureId,
    hitDice: z
      .array(z.string().min(1))
      .optional()
      .describe(
        'Hit Dice to spend, by the pool key `sheet` reports — one entry per die, e.g. ["hit-die:d10", "hit-die:d10"]. Which of your own dice to spend is the choice the rules give you; what each one restores is the engine’s.',
      ),
    interruptedBy: z
      .string()
      .min(1)
      .optional()
      .describe(
        'An interruption the engine cannot see, such as an hour of walking or other hard exertion. The three it can see — Initiative, a spell cast, damage taken — it records for itself and you should not report.',
      ),
    choosesAgain: z
      .record(z.string().min(1), z.array(z.string().min(1)))
      .optional()
      .describe(
        'A choice this rest re-asks, answered again, keyed by the feature that asks it — e.g. {"circle-of-the-land:spells": ["Arid"]}. Only a rest the character actually finished re-asks anything, and only the kind of rest the feature names; leave it out to keep the answer they already gave.',
      ),
    studies: z
      .array(
        z.object({
          replaces: z.string().min(1).describe('The prepared spell being put down.'),
          prepares: z.string().min(1).describe('The one taken up in its place, from the book.'),
        }),
      )
      .optional()
      .describe(
        'Prepared spells studied out and in over this rest — SRD Memorize Spell swaps one on a finished Short Rest. How many a feature offers is the feature’s; asking for more is refused.',
      ),
  }),
  run: (context, args) =>
    settle(
      context,
      endRest(
        context.campaign.state(),
        who(args.who),
        {
          ...identity(context),
          ...(args.hitDice === undefined ? {} : { hitDice: args.hitDice }),
          ...(args.interruptedBy === undefined ? {} : { interrupted: args.interruptedBy }),
          ...(args.choosesAgain === undefined ? {} : { choosesAgain: args.choosesAgain }),
          ...(args.studies === undefined ? {} : { studies: args.studies }),
        },
        context.campaign.supply(),
      ),
      (value) => value.events,
      (value) => ({
        benefit: value.benefit,
        hitDiceSpent: value.hitDice.map((die) => die.key),
        hitPointsRegained: value.hitPointsRegained,
        duplicate: value.duplicate,
      }),
    ),
});

/**
 * Drink the potion, or administer it.
 *
 * **Everything mechanical is the item's.** SRD fixes what an item confers at
 * the lowest possible level: a Potion of Healing heals the same 2d4 + 2
 * whoever drinks it and a flask saves against its own printed number in any
 * hand, so the call names a creature, a bottle and at most who it is being
 * poured into.
 *
 * **What it needed was an inventory with something in it**, and until
 * `award_items` landed on the DM's door there was no way to put anything in
 * one: `create_character` on this surface grants no item and no magic item by
 * rule. Handing out what a party found is the DM's call and stays on the DM's
 * side; using what a character holds is the character's.
 */
const USE_ITEM = tool({
  name: 'use_item',
  description:
    'Use an item a creature is carrying for the benefit it confers — a potion drunk or administered, a flask thrown back, a staff’s charge spent. The dice, the save DC and how long it lasts are the item’s own and printed on it; you name the item and, where somebody else is getting it, the target within five feet. An item that confers nothing by being used is refused rather than quietly consumed: a benefit had by wearing it is had by equipping it, and a spell it casts is cast.',
  mutates: true,
  input: z.object({
    who: creatureId.describe('Whose item it is, and who is using it.'),
    item: z.string().min(1).describe('Catalogue id, e.g. potion-of-healing.'),
    target: creatureId
      .optional()
      .describe('Who gets the benefit, within five feet. Omit for the user themselves.'),
    charges: z
      .int()
      .min(1)
      .optional()
      .describe(
        'How many charges to spend, for an item whose line lets the user choose — SRD Staff of Striking’s "up to 3 charges". Omit for the price the line prints. Naming one over an item that costs nothing is refused.',
      ),
  }),
  run: (context, args) =>
    settle(
      context,
      useItem(
        context.campaign.state(),
        who(args.who),
        {
          item: args.item,
          ...(args.target === undefined ? {} : { target: who(args.target) }),
          ...(args.charges === undefined ? {} : { charges: args.charges }),
          ...identity(context),
        },
        context.campaign.supply(),
      ),
      (value) => value.events,
      (value) => ({ used: args.item, outcomes: value.outcomes }),
      (value) => value.unverified,
    ),
});

/**
 * What a character does with what it holds: wear it, attune to it, buy it,
 * hand it over.
 *
 * Six engine commands that reached no tool, and the cost was the same shape
 * every time: `award_items` could put chain mail in a backpack and nothing
 * could put it on, so **owning and wearing are two facts** and only one of
 * them had a door. Armour Class reads the equipped set, so armour a party
 * found protected nobody; a magic item could be carried and never attuned,
 * which is the sentence that switches its benefit on; and coins were a number
 * the engine tracked, priced things against and let nobody spend.
 *
 * **They are the model's and `lose_items` is the DM's**, which is
 * `award_items`' line drawn once more rather than a new one: handing out what
 * a party found — and taking away what a thief took — is the table
 * adjudicating the world, and what a character does with what it holds is the
 * character's. `use_item` has been on this side since it existed, and these
 * are its neighbours.
 *
 * **No mechanical number passes through any of them.** A quantity is a count
 * of things, as `award_items`' already is. A price is the SRD's, and one the
 * book leaves as "Varies" is refused rather than guessed. Which copy, where
 * copies are told apart, is a label the engine issued and this surface reports
 * on `sheet`. Everything an item is worth — its Armour Class, its charges,
 * what it confers, what attuning to it grants — is read out of the catalogue
 * by the command and pinned into the event.
 */
const PURCHASE_ITEM = tool({
  name: 'purchase_item',
  description:
    'Buy something at the price the book prints, out of this character’s own coin. You name the item and how many; the price, what is in a pack, and whether the purse covers it are the engine’s. A price the SRD leaves as "Varies" is refused rather than guessed. `sheet` reports the coins and what is already carried.',
  mutates: true,
  input: z.object({
    who: creatureId.describe('Who is buying, and whose coin it comes out of.'),
    item: z.string().min(1).describe('Catalogue id, e.g. shield, torch, healers-kit.'),
    quantity: z.int().min(1).optional().describe('How many. One where it is left out.'),
  }),
  run: (context, args) =>
    settleEvents(
      context,
      purchaseItem(
        context.campaign.state(),
        context.campaign.content,
        who(args.who),
        args.item,
        args.quantity ?? 1,
        context.commandId,
      ),
      { bought: args.item, quantity: args.quantity ?? 1 },
    ),
});

const EQUIP_ITEM = tool({
  name: 'equip_item',
  description:
    'Wear or wield something this character already owns. Chain mail in a backpack protects nobody: Armour Class is read off what is worn, and this is the only call that moves it. A second suit of body armour or a second shield is refused rather than silently replacing the first, because taking armour off is a decision. Something carried rather than worn — a rope, a sack of rations — is refused too.',
  mutates: true,
  input: z.object({
    who: creatureId,
    item: z
      .string()
      .min(1)
      .describe('Catalogue id, or the id of one copy where `sheet` tells the copies apart.'),
  }),
  run: (context, args) =>
    settleEvents(
      context,
      equipItem(
        context.campaign.state(),
        context.campaign.content,
        who(args.who),
        args.item,
        context.commandId,
      ),
      { equipped: args.item, by: args.who },
    ),
});

const UNEQUIP_ITEM = tool({
  name: 'unequip_item',
  description:
    'Put something away. It stays owned — taking armour off is not selling it — and whatever it was adding stops being added.',
  mutates: true,
  input: z.object({ who: creatureId, item: z.string().min(1).describe('Catalogue id, or a copy’s id.') }),
  run: (context, args) =>
    settleEvents(
      context,
      unequipItem(
        context.campaign.state(),
        context.campaign.content,
        who(args.who),
        args.item,
        context.commandId,
      ),
      { unequipped: args.item, by: args.who },
    ),
});

/**
 * The two halves of one printed sentence, and the only door either has.
 *
 * SRD Flame Blade: "If you let go of the blade, it disappears, but you can
 * evoke the blade again as a Bonus Action." A conjured thing is not equipped —
 * it is held by the casting that made it — so `unequip_item` does not reach
 * it, and a spell cast again would spend a second slot.
 */
const LET_GO_OF_CONJURED = tool({
  name: 'let_go_of_conjured',
  description:
    'Let go of something a spell put in this creature’s hand — Flame Blade’s blade, Goodberry’s berries. It disappears and the hand is free; the spell itself keeps running, and where the spell says so the thing can be evoked again with `evoke_conjured`. Costs nothing. Anything a spell did not conjure is refused: a weapon put down is on the floor, which is not a place this engine keeps.',
  mutates: true,
  input: z.object({ who: creatureId, item: z.string().min(1).describe('Catalogue id of the conjured thing.') }),
  run: (context, args) =>
    settleEvents(
      context,
      dropConjured(
        context.campaign.state(),
        context.campaign.content,
        who(args.who),
        args.item,
        context.commandId,
      ),
      { letGo: args.item, by: args.who },
    ),
});

/**
 * The two halves of a thing that is on the floor.
 *
 * `let_go_of_conjured` above says what it is not: a conjured thing disappears,
 * and "anything a spell did not conjure is refused: a weapon put down is on the
 * floor, which is not a place this engine keeps." It is a place this engine
 * keeps now — a pile with a placement of its own, anchored to a landmark or a
 * creature exactly as a creature is, so **the model never types coordinates**
 * here either.
 *
 * Which pile is the part a caller has to be able to say, and the engine has an
 * answer: a dropped thing carries a record of its own, minted at the drop if it
 * did not already have one, so "my sword on the floor" is tellable from the
 * identical sword still in the pack. A caller that has only the catalogue id
 * sends that and is answered, unless two piles of one kind are within reach —
 * which is a question rather than a guess.
 */
const DROP_ITEM = tool({
  name: 'drop_item',
  description:
    'Put something down. It leaves the pack and lies in the room, where anyone standing over it can pick it up with `take_item_up` — and it keeps whatever it had: a wand put down has exactly the charges it had left. Costs nothing. It lands at the dropper’s feet unless a placement says otherwise. Anything worn or wielded is refused until it is taken off with `unequip_item`, and anything a spell conjured is `let_go_of_conjured` instead, because a conjured thing disappears rather than landing.',
  mutates: true,
  input: z.object({
    who: creatureId,
    item: z.string().min(1).describe('Catalogue id, or a copy’s id.'),
    quantity: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('How many to put down. The whole line if it is left out.'),
    where: placementSchema
      .optional()
      .describe('Where it lands. The dropper’s own square if it is left out.'),
  }),
  run: (context, args) =>
    settleEvents(
      context,
      dropItem(context.campaign.state(), context.campaign.content, who(args.who), {
        item: args.item,
        ...(args.quantity === undefined ? {} : { quantity: args.quantity }),
        ...(args.where === undefined ? {} : { placement: placementOf(args.where) }),
        ...identity(context),
      }),
      { dropped: args.item, by: args.who },
    ),
});

const TAKE_ITEM_UP = tool({
  name: 'take_item_up',
  description:
    'Pick up a pile lying on the floor, whole. The creature has to be within 5 feet of it; walk over first if they are not. Name the pile by its own id, or by the catalogue id where one pile of that kind is within reach. It goes into the pack rather than into a hand — `equip_item` is what puts something in a hand.',
  mutates: true,
  input: z.object({
    who: creatureId,
    item: z.string().min(1).describe('The pile’s own id, or the catalogue id of what it is.'),
  }),
  run: (context, args) =>
    settleEvents(
      context,
      takeItemUp(context.campaign.state(), context.campaign.content, who(args.who), {
        item: args.item,
        ...identity(context),
      }),
      { pickedUp: args.item, by: args.who },
    ),
});

const EVOKE_CONJURED = tool({
  name: 'evoke_conjured',
  description:
    'Evoke again something this creature’s own spell conjured and then let go of — SRD Flame Blade’s "you can evoke the blade again as a Bonus Action". It costs whichever action the spell prints, needs the casting to still be running and needs a free hand. A spell that prints no such clause is refused rather than granted one.',
  mutates: true,
  input: z.object({ who: creatureId, item: z.string().min(1).describe('Catalogue id of the conjured thing.') }),
  run: (context, args) =>
    settleEvents(
      context,
      evokeConjured(
        context.campaign.state(),
        who(args.who),
        { item: args.item, ...identity(context) },
        context.campaign.supply(),
      ),
      { evoked: args.item, by: args.who },
    ),
});

const ATTUNE_ITEM = tool({
  name: 'attune_item',
  description:
    'Attune to a magic item, which is what switches its benefit on. SRD: "Attuning to an item requires a creature to spend a Short Rest focused on only that item while being in physical contact with it" — so the character has to be resting, and a rest already interrupted is refused. An item that works for anybody holding it has nothing to attune, and nobody attunes to more than three at a time. Begin the rest with `begin_rest`.',
  mutates: true,
  input: z.object({ who: creatureId, item: z.string().min(1).describe('Catalogue id, or a copy’s id.') }),
  run: (context, args) =>
    settleEvents(
      context,
      attuneItem(
        context.campaign.state(),
        context.campaign.content,
        who(args.who),
        args.item,
        context.commandId,
      ),
      { attuned: args.item, by: args.who },
    ),
});

const END_ATTUNEMENT = tool({
  name: 'end_attunement',
  description:
    'Give up an attunement, which SRD lists among the ways one ends. No rest is needed. The other two ways — dying, and no longer having the item — are the engine’s and happen without anybody saying so.',
  mutates: true,
  input: z.object({ who: creatureId, item: z.string().min(1).describe('Catalogue id, or a copy’s id.') }),
  run: (context, args) =>
    settleEvents(
      context,
      endAttunement(
        context.campaign.state(),
        context.campaign.content,
        who(args.who),
        args.item,
        context.commandId,
      ),
      { ended: args.item, by: args.who },
    ),
});

/**
 * Hand something to somebody else — one event, because the world has one fact.
 *
 * A loss and a gain written back to back would be two, and the second would be
 * wrong: a gain declares a pool full, so a wand handed over that way would
 * arrive with three charges however spent it left. The engine moves the line
 * and its charges whole, and this tool says who, what and why.
 *
 * Worn or wielded is refused, on the engine's own rule and for its reason:
 * giving away what is in your hand would leave the armour still adding its
 * Armour Class on somebody who no longer owns it. Taking it off first is
 * `unequip_item`.
 */
const TRANSFER_ITEM = tool({
  name: 'transfer_item',
  description:
    'Hand something from one character to another — a potion passed to whoever is getting hit, a rope handed across a gap. What moves is what the giver had, charges and all. Something worn or wielded is refused until it is taken off, and more than is carried is refused rather than conjured.',
  mutates: true,
  input: z.object({
    from: creatureId.describe('Who is handing it over.'),
    to: creatureId.describe('Who is taking it.'),
    item: z.string().min(1).describe('Catalogue id, or a copy’s id where `sheet` tells them apart.'),
    quantity: z.int().min(1).optional().describe('How many. One where it is left out.'),
    because: z
      .string()
      .min(1)
      .describe('Why it changed hands, in one phrase: "Orin is the one who gets hit".'),
  }),
  run: (context, args) =>
    settleEvents(
      context,
      transferItem(
        context.campaign.state(),
        who(args.from),
        who(args.to),
        args.item,
        args.quantity ?? 1,
        args.because,
        identity(context),
      ),
      { gave: args.item, from: args.from, to: args.to, quantity: args.quantity ?? 1 },
    ),
});

/**
 * Wait for something, and then act — the two halves of SRD Ready.
 *
 * The action goes at the Ready and the Reaction goes when the trigger fires,
 * which is two moments and therefore two calls. **The trigger is free text and
 * stays that way**: SRD asks for "a perceivable circumstance", and the
 * circumstances a table readies against live in fiction the engine has never
 * been told about — a trapdoor, a chant, a door. An engine that judged the
 * trigger would be refusing readied actions on the strength of its own
 * ignorance, so the caller says when it fired and everything around it is the
 * engine's.
 *
 * A readied **spell** is the SRD's own special case: the slot goes at the
 * Ready and the effects do not, so the facts a casting states are stated
 * there — which is why `response` carries the same `damageType` and `fought` a
 * casting does, and refuses the same way without them.
 *
 * **A readied `action` has no second half here, and both descriptions say
 * so.** The engine resolves a readied spell and a readied move and answers an
 * `action` response with the hold closed and the Reaction spent, leaving the
 * swing itself to `resolveAttack({ free: true })` — a flag no tool on this
 * surface sets, and one a caller setting it would be asserting an attack costs
 * nothing. So every attack tool here refuses on somebody else's turn, and a
 * description promising the follow-up would be promising a door that is shut.
 * That a readied attack needs a paid door of its own is a finding for whoever
 * owns `commands/actions.ts`, not something to paper over in a schema.
 */
const TAKE_READY = tool({
  name: 'take_ready',
  description:
    'Ready an action: spend your action now to take a Reaction when something happens. Say what you are waiting for in your own words — the engine does not judge the trigger, because the circumstance lives in the fiction — and say what you will do: an action, a move, or a spell. A readied spell is cast now and held, so its slot goes now and its Concentration is held until it is released. Let it go with `release_ready` when the trigger comes, or ignore the trigger there. It lapses at the start of your next turn.',
  mutates: true,
  input: z.object({
    who: creatureId,
    trigger: z
      .string()
      .min(1)
      .describe('The circumstance being waited for: "the goblin steps out from behind the barrels".'),
    response: z.discriminatedUnion('kind', [
      z.object({
        kind: z.literal('action'),
        note: z
          .string()
          .min(1)
          .optional()
          .describe('What the action will be, in one phrase, recorded on the hold. **Its content is not resolved by anything on this surface**: releasing it spends the Reaction and closes the hold, and the swing a readied attack describes is refused by every attack tool here, because those are a creature’s own turn’s. Ready a spell or a move for the two the engine carries out.'),
      }),
      z.object({ kind: z.literal('move') }),
      z.object({
        kind: z.literal('spell'),
        spellId: z.string().min(1),
        slotLevel: z.int().min(1).max(9).optional().describe('Spent now. Omit for a cantrip.'),
        slotKind: z.enum(['spell', 'pact']).optional(),
        source: z.string().min(1).optional(),
        damageType: damageTypeSchema.optional(),
        choice: z.string().min(1).optional(),
        fought: z.array(creatureId).optional(),
        unaffected: z.array(creatureId).optional(),
        teleportTo: placementSchema.optional(),
        weapon: z.string().min(1).optional(),
      }),
    ]),
  }),
  run: (context, args) => {
    const response = args.response;
    return settleEvents(
      context,
      takeReady(
        context.campaign.state(),
        who(args.who),
        {
          trigger: args.trigger,
          response:
            response.kind === 'spell'
              ? {
                  kind: 'spell',
                  spellId: response.spellId,
                  ...(response.slotLevel === undefined ? {} : { slotLevel: response.slotLevel }),
                  ...(response.slotKind === undefined ? {} : { slotKind: response.slotKind }),
                  ...(response.source === undefined ? {} : { source: response.source }),
                  ...(response.damageType === undefined ? {} : { damageType: response.damageType }),
                  ...(response.choice === undefined ? {} : { choice: response.choice }),
                  ...(response.fought === undefined ? {} : { fought: response.fought.map(who) }),
                  ...(response.unaffected === undefined
                    ? {}
                    : { unaffected: response.unaffected.map(who) }),
                  ...(response.teleportTo === undefined
                    ? {}
                    : { teleportTo: placementOf(response.teleportTo) }),
                  ...(response.weapon === undefined ? {} : { weapon: response.weapon }),
                }
              : response.kind === 'move'
                ? { kind: 'move' }
                : {
                    kind: 'action',
                    ...(response.note === undefined ? {} : { note: response.note }),
                  },
          ...identity(context),
        },
        context.campaign.content,
      ),
      { readied: args.response.kind, waitingFor: args.trigger },
    );
  },
});

const RELEASE_READY = tool({
  name: 'release_ready',
  description:
    'Let a readied action go, because the thing it was waiting for happened — or ignore the trigger, which costs nothing and keeps the Reaction. The Reaction is spent here; a readied spell lands here and a readied move is made here. A readied **action** is the one with no second half: the hold closes and the Reaction goes, and its content is resolved by nothing on this surface, because every tool that takes an action is a creature’s own turn’s. Either way the hold is over: the trigger has been and gone.',
  mutates: true,
  input: z.object({
    who: creatureId,
    ignore: z
      .boolean()
      .optional()
      .describe('True to let the trigger pass. Nothing is spent and the hold ends; a held spell dissipates with it.'),
    targets: z
      .array(creatureId)
      .optional()
      .describe('Who a readied spell lands on. Empty for an area spell, which picks its own.'),
    rollsAt: z
      .array(z.strictObject({ target: creatureId, count: z.int().min(1) }))
      .optional()
      .describe(
        'How to divide a readied casting that makes several attack rolls, exactly as `cast_spell.rollsAt` does. Said here rather than at the Ready, because the creatures it divides between are chosen here too.',
      ),
    at: pointSchema.optional().describe('Where a readied area spell’s origin goes.'),
    placement: placementSchema
      .optional()
      .describe('Where a readied move goes, measured from a landmark or a creature.'),
    difficultFeet: z
      .int()
      .min(0)
      .optional()
      .describe('How many feet of that move are through Difficult Terrain.'),
    route: routeSchema
      .optional()
      .describe('The 5-foot spaces a readied move crossed, in order. Send it when a release comes back `route_required`.'),
  }),
  run: (context, args) =>
    settle(
      context,
      releaseReady(
        context.campaign.state(),
        who(args.who),
        {
          ...(args.ignore === true ? { ignore: true } : {}),
          ...(args.targets === undefined ? {} : { targets: args.targets.map(who) }),
          ...(args.rollsAt === undefined
            ? {}
            : {
                rollsAt: args.rollsAt.map((aim) => ({ target: who(aim.target), count: aim.count })),
              }),
          ...(args.at === undefined ? {} : { at: point(args.at) }),
          ...(args.placement === undefined ? {} : { placement: placementOf(args.placement) }),
          ...(args.difficultFeet === undefined ? {} : { difficultFeet: args.difficultFeet }),
          ...(args.route === undefined ? {} : { route: args.route.map(point) }),
          ...identity(context),
        },
        context.campaign.supply(),
      ),
      (value) => value.events,
      (value) => ({
        took: value.took,
        ...(value.spell === undefined
          ? {}
          : { castingId: value.spell.castingId, outcomes: value.spell.outcomes }),
        ...(value.move === undefined ? {} : { feetMoved: value.move.feet }),
      }),
      (value) => [...(value.spell?.unverified ?? []), ...(value.move?.unverified ?? [])],
    ),
});

const END_TURN = tool({
  name: 'end_turn',
  description:
    'End the current creature’s turn and advance the order. The engine raises and rolls whatever the boundary owes — repeated saves, scheduled damage, effects expiring. It refuses while a debt is outstanding, and the refusal says which.',
  mutates: true,
  input: z.object({
    /**
     * SRD Fire Aura: "each creature of the azer's choice in a 5-foot Emanation
     * originating from the azer takes 5 (1d10) Fire damage."
     *
     * **A decision the rules leave open, which is what a DM's door is for.**
     * The engine rolls the dice and measures the emanation; whom an azer picks
     * out of the creatures standing in it is not a fact the engine holds, and
     * inventing one would be the engine playing somebody's creature. Naming
     * nobody burns nobody, which is a legal way to play an azer; naming
     * somebody the emanation does not reach simply catches nobody.
     */
    burns: z
      .array(z.string())
      .optional()
      .describe(
        'Whom the creature whose turn is ending chooses to catch with a printed aura that says "of its choice". Omit it and nobody is caught.',
      ),
  }),
  run: (context, args) =>
    settle(
      context,
      resolveTurn(context.campaign.state(), context.campaign.supply(), {
        ...identity(context),
        ...(args.burns === undefined ? {} : { burns: args.burns.map(who) }),
      }),
      (value) => value.events,
      (value) => ({
        savesRolled: value.saves.map((save) => ({ label: save.label, success: save.success })),
        savesOutstanding: value.pending.length,
        duplicate: value.duplicate ?? false,
      }),
      // **And what the boundary applied without being able to check it.** A
      // boundary settles a scheduled hit, every persistent area that owes
      // something, the payouts a running spell hands over and the repeat
      // saves, and each of those can drop a creature — so it is the one
      // command that can hand back four rules' worth of missing facts at
      // once. `TurnResolution.unverified` gathers them; this is the door
      // saying them out loud.
      (value) => value.unverified,
    ),
});

/**
 * The surface, in one list and in a stable order.
 *
 * Sorted by name, because the design note makes tool serialisation part of
 * the prompt cache: "tools are serialised in stable sorted order". A list
 * whose order depended on where a definition happened to be written would
 * invalidate the cache the first time somebody moved one.
 */
export const TOOLS: readonly ToolDefinition[] = [
  ACTIVATE_FEATURE,
  ACTIVATE_SPELL,
  ADVANCE_TIME,
  ADD_CREATURE,
  ADD_LANDMARK,
  APPLY_CONDITION,
  ASSUME_SHAPE,
  ATTACK,
  ATTEMPT_EFFECT_CHECK,
  ATTUNE_ITEM,
  BEGIN_REST,
  CAST_SPELL,
  CONFER_REACTION,
  CONTINUE_CASTING,
  CREATE_CHARACTER,
  DECLARE_COVER,
  DECLARE_CREATURE_TYPE,
  DECLARE_DIFFICULT_TERRAIN,
  DECLARE_FALLING,
  DECLARE_LIGHT,
  DECLARE_OBSCUREMENT,
  DECLARE_SIDE,
  DECLARE_SIGHT,
  DECLINE_DAMAGE_REACTION,
  DECLINE_OPPORTUNITY,
  DECLINE_TEST_REACTION,
  DISMISS_STRANDED_SUMMONS,
  DRAW_ON_HEALING_POOL,
  DROP_ITEM,
  ELIGIBLE_TARGETS,
  END_COMBAT,
  END_CONCENTRATION,
  END_FEATURE,
  END_ATTUNEMENT,
  END_ONGOING_SPELL,
  END_REST,
  END_TURN,
  EQUIP_ITEM,
  EVOKE_CONJURED,
  EXTEND_FEATURE,
  HEAL_WITH_FEATURE,
  LET_GO_OF_CONJURED,
  LOOK,
  MOVE,
  OPTIONS,
  PLACE_CREATURE,
  PURCHASE_ITEM,
  REGAIN_USES,
  RELEASE_READY,
  REVERT_SHAPE,
  RESOLVE_DECLARED_CAST,
  ROLL_INITIATIVE,
  SET_SCENE,
  SETTLE_AREA_EFFECTS,
  SETTLE_ATTACK,
  SETTLE_SAVES,
  SETTLE_DAMAGE,
  SHEET,
  STABILISE_CREATURE,
  // The four rooms the engine had finished and nothing could reach, opened as
  // one block. The list is sorted at run time, so where they sit here is only
  // where they were written.
  DECLARE_DAWN,
  DISMOUNT,
  MOUNT,
  SWAP_INITIATIVE,
  TAKE_ITEM_UP,
  USE_FREE_INTERACTION,
  SUMMON_CREATURE,
  TAKE_ACTION,
  TAKE_ATTACK_REACTION,
  TAKE_DAMAGE_REACTION,
  TAKE_DAMAGE_RESPONSE,
  TAKE_OPPORTUNITY_ATTACK,
  TAKE_READY,
  TAKE_TEST_REACTION,
  TRANSFER_ITEM,
  UNEQUIP_ITEM,
  USE_ITEM,
  USE_BUDGET_PURCHASE,
  USE_POOL_OPTION,
  TRADE_RESOURCE,
  ADVANCE_CHARACTER,
  WAKE_CREATURE,
  // A thing a feature makes, and the two halves of what happens to it after.
  CREATE_DEVICE,
  DISMANTLE_DEVICE,
  ACTIVATE_DEVICE,
].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

export const TOOL_NAMES: readonly string[] = TOOLS.map((definition) => definition.name);
