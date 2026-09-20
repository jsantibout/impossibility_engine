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
 * **Two pools the engine holds have no door and are not given one.** Channel
 * Divinity and Bardic Inspiration are declared, sized off their class tables
 * and refilled on the right rest, and nothing spends them: what a use *buys*
 * — Turn Undead, Divine Spark, an inspiration die somebody else adds to a
 * roll — is not executed by the engine, so a tool here would be a door onto a
 * room that does not exist. The same holds for Action Surge, whose extra
 * action nothing grants. A pool a caller could spend for no effect is worse
 * than a pool it cannot spend, because the use would be gone.
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
 */

import type { CharacterId, ConditionName, Result } from '@ie/shared';
import { asCharacterId, needsContext, ok } from '@ie/shared';
import type {
  CharacterChoices,
  CastSpellRequest,
  Duration,
  CombatantInput,
  GameEvent,
  GameState,
  InitiativeEntrant,
  Placement,
  Point,
} from '@ie/engine';
import {
  activateFeature,
  activateSpell,
  addCreature,
  addSceneLandmark,
  advanceTime,
  applyConditionTo,
  applyEvent,
  areaPointAt,
  availableChecks,
  awardItems,
  beginRest,
  createCharacter,
  declareCoverBetween,
  declareCreatureSide,
  declareCreatureType,
  declareDifficultTerrain,
  declareFalling,
  declareSightBetween,
  declineDamageReaction,
  declineOpportunity,
  declineTestReaction,
  eligibleTargets,
  endConcentration,
  endFeature,
  endOngoingSpell,
  endRest,
  extendFeature,
  INITIATIVE_LABEL,
  joinCombat,
  mayAct,
  placeCreatureInScene,
  positionOf,
  reactionOpportunities,
  recordInitiativeRolls,
  releaseReady,
  resolveAttack,
  resolveAttackDamage,
  resolveDeclaredCast,
  resolveEffectCheck,
  resolveMove,
  resolveSpell,
  resolveTurn,
  rollInitiativeAndBeginCombat,
  setScene,
  settleAreaEffects,
  settleDamage,
  speedOf,
  takeDamageReaction,
  takeDash,
  takeDisengage,
  takeDodge,
  takeReady,
  takeOpportunityAttack,
  takeTestReaction,
  useHealingTouch,
  useItem,
  usePoolOption,
  useRecovery,
  useSelfHeal,
} from '@ie/engine';
import { z } from 'zod';
import type { Campaign } from './campaign.js';
import { resolveGear } from './bestiary.js';
import { holdingsOf } from './holdings.js';
import { observe } from './observe.js';
import type { ArgumentIssue, ContextRequestKind, ToolOutcome } from './outcome.js';
import { fromErr, invalid, okOutcome, refused } from './outcome.js';
import {
  characterChoicesSchema,
  conditionDurationSchema,
  conditionSchema,
  creatureId,
  damageTypeSchema,
  placementSchema,
  pointSchema,
  routeSchema,
  sensesFields,
  sizeSchema,
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
  return {
    name: spec.name,
    description: spec.description,
    mutates: spec.mutates,
    establishes: spec.establishes ?? [],
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
      return spec.run(context, parsed.data as z.infer<S>);
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
  const { subclassId, multiclass, spellsByClass, dmGrants, ...rest } = input;
  return {
    ...rest,
    ...(subclassId === undefined ? {} : { subclassId }),
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
  }),
  run: (context, args) => {
    const shortlist = eligibleTargets(
      context.campaign.state(),
      context.campaign.content,
      who(args.caster),
      args.spellId,
      args.slotLevel ?? 0,
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
 * **It declares no side and no spellcasting**, which is the engine's division
 * rather than a gap: allegiance changes in play (`declare_side`) and a stat
 * block writes its spellcasting as English prose that nothing has parsed. An
 * NPC who casts takes two calls.
 */
const ADD_CREATURE = tool({
  name: 'add_creature',
  description:
    'Put a monster into the game from the bestiary, by the id of its stat block. The engine reads every number off the block — Armour Class, hit points, saves, defences, size — and hands the creature the gear the block prints so that it can use it. You say only what to call it and which monster it is. Declare its side separately; allegiance changes in play.',
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
 */
function bringIn(
  context: ToolContext,
  id: CharacterId,
  monsterId: string,
): Result<MonsterArrival> {
  const { campaign } = context;
  const state = campaign.state();

  const arrival = addCreature(state, campaign.content, id, monsterId, identity(context));
  if (!arrival.ok) return arrival;
  if (arrival.value.duplicate) {
    // A retry. The award was made under its own derived id the first time and
    // is a no-op too, so there is nothing left to re-run.
    return ok({
      events: [],
      resolution: { added: id, monsterId, duplicate: true },
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
      added: id,
      monsterId,
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

const DECLARE_SIDE = tool({
  name: 'declare_side',
  description:
    'Say which side a creature fights on. Allegiance changes in play, so it is declared rather than being a property of arriving.',
  mutates: true,
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
    'Declare the room the fight happens in, in feet. Nobody can be placed until there is one. Setting a scene again is the party walking into the next room, and unplaces everybody.',
  mutates: true,
  establishes: ['scene'],
  input: z.object({
    width: z.number().positive().describe('Feet.'),
    depth: z.number().positive().describe('Feet.'),
    height: z.number().positive().describe('Feet.'),
  }),
  run: (context, args) =>
    settleEvents(
      context,
      setScene(
        context.campaign.state(),
        { width: args.width, depth: args.depth, height: args.height },
        identity(context),
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
    'State whether one creature can see another. Directional, and three-valued: nobody having said is not the same as "no", which is why a spell that needs sight asks rather than refusing.',
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
    'Declare how much cover one creature has from another — the bar it is crouched behind, the millstone between them. The engine applies exactly what the SRD prints (+2 to Armour Class and Dexterity saves for Half, +5 for Three-Quarters, no targeting at all through Total) and never works cover out from geometry, because that means modelling every wall. Use "none" to say the line is clear again.',
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

const MOVE = tool({
  name: 'move',
  description:
    'Move a creature, spending its Speed. Always relative to a landmark or another creature — never a raw coordinate. Leaving an enemy’s reach offers them an Opportunity Attack, and the move is held until every creature offered one has answered.',
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

const ATTACK = tool({
  name: 'attack',
  description:
    'Attack with a weapon. The engine derives everything: the target’s Armour Class, reach and range, advantage and disadvantage, proficiency, the damage dice, and the target’s defences. You name who swings at whom and with what.',
  mutates: true,
  input: z.object({
    attacker: creatureId,
    target: creatureId,
    weapon: z
      .string()
      .min(1)
      .optional()
      .describe('Catalogue id, e.g. quarterstaff, dagger. Omit for an Unarmed Strike.'),
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
          ...(args.thrown === true ? { thrown: true } : {}),
          ...(args.twoHanded === true ? { twoHanded: true } : {}),
          ...(args.finesseAbility === undefined ? {} : { finesseAbility: args.finesseAbility }),
          ...(args.hold === true ? { hold: true } : {}),
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
    'Cast a spell. The engine derives everything mechanical: the save DC, the attack modifier, the damage dice, the condition, the duration, the range. You name the spell, the targets and the slot. An area spell takes no targets and picks its own — give it `at` for where it is centred, and, for a Cone, Cube or Line, a `towardsCreature`, `towardsLandmark` or `towards` saying which way it points.',
  mutates: true,
  input: z.object({
    caster: creatureId,
    spellId: z.string().min(1).describe('SRD spell id, e.g. fire-bolt, hold-person, magic-missile.'),
    targets: z.array(creatureId).describe('Creature ids. Empty for an area spell.'),
    slotLevel: z.int().min(1).max(9).optional().describe('Which slot to spend. Omit for a cantrip.'),
    at: pointSchema.optional().describe('Where an area spell is centred, for a spell that asks for a point.'),
    towards: pointSchema.optional().describe('Point a Cone, Cube or Line at this exact spot.'),
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
      ...(args.at === undefined ? {} : { at: point(args.at) }),
      ...(towards.value === undefined ? {} : { towards: towards.value }),
      ...(args.anchoring === undefined ? {} : { anchoring: args.anchoring }),
      ...(args.slotLevel === undefined ? {} : { slotLevel: args.slotLevel }),
      ...(args.damageType === undefined ? {} : { damageType: args.damageType }),
      // **An empty `fought` is an answer and is never elided.** "We are
      // fighting none of them" is a fact the caster stated; absence is a
      // caller who has not read the spell, and the engine tells the two
      // apart. Every other stated fact here is absent-or-present.
      ...(args.fought === undefined ? {} : { fought: args.fought.map(who) }),
      ...(args.teleportTo === undefined ? {} : { teleportTo: placementOf(args.teleportTo) }),
      ...(args.slotKind === undefined ? {} : { slotKind: args.slotKind }),
      ...(args.payment === undefined ? {} : { payment: args.payment }),
      ...(args.source === undefined ? {} : { source: args.source }),
      ...(args.usingFeatures === undefined ? {} : { usingFeatures: args.usingFeatures }),
      ...(args.hold === true ? { hold: true } : {}),
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
    'What one character holds and what is left of it: hit points, conditions, spell slots by level, Pact Magic slots as their own pool, every feature pool with what refills it, the spells this character can actually cast and by which route, and the features themselves — which can be switched on, which spends a pool, which is only ever passive, and the name of the tool that spends each one. Read this before spending anything; a feature you have not been told about is one you cannot elect. Free, and changes nothing.',
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
 * **And the extension has no ceiling, which the description says out loud.**
 * SRD Rage prints one — "You can maintain a Rage for up to 10 minutes" — and
 * `ActivatedFeature.capSeconds` carries it onto the sheet at creation, where
 * no engine command reads it: `extendFeature` replaces the timer and checks
 * nothing else. A description claiming the cap was guarded would be this layer
 * asserting a rule the engine does not have, which is worse than a comment
 * that claims too much because a model would act on it. So the tool says the
 * bound is the table's to keep and `sheet` reports the number to keep it by.
 * That the engine could enforce it is a finding for whoever owns `timers.ts`,
 * not a thing to paper over here.
 */
const ACTIVATE_FEATURE = tool({
  name: 'activate_feature',
  description:
    'Switch on a feature the character can enter — Rage is the one the SRD writes this way. The engine charges whatever the feature’s own record says it costs: the Action or Bonus Action it names, where a fight is running and there is an economy to spend from, a use out of its pool, and the deadline it runs to. What it does while it runs is applied by itself for as long as it runs. Use `sheet` to see which features can be switched on, what each one costs and what is left of its pool.',
  mutates: true,
  input: z.object({
    who: creatureId,
    feature: z.string().min(1).describe('The feature id, from `sheet`, e.g. barbarian:rage.'),
  }),
  run: (context, args) =>
    settleEvents(
      context,
      activateFeature(context.campaign.state(), who(args.who), {
        feature: args.feature,
        ...identity(context),
      }),
      { activated: args.feature },
    ),
});

const EXTEND_FEATURE = tool({
  name: 'extend_feature',
  description:
    'Keep a running feature going for another round. SRD Rage offers three ways to do it and only one of them costs anything, so say which happened: `attack` if the character attacked an enemy, `forced-save` if it made one save, `bonus-action` to spend the Bonus Action on it. In a fight the engine replaces the feature’s deadline with a fresh one; outside a fight there are no turns, so there is no deadline to replace and the feature simply runs until something ends it. It does **not** enforce the longest the feature may be maintained — `sheet` reports that as `capSeconds` and nothing stops an extension past it, so a table that wants the bound kept keeps it.',
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
 * Neither field is a number. `target` is who the option is aimed at, checked
 * against the reach the option prints; `damageType` is which of the types the
 * option prints this use deals, refused unless the option prints a choice and
 * refused when it prints one and the call names none. That is `cast_spell`'s
 * own rule, asked of a feature — and `damage_type_required` is answerable
 * here as well as there.
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
  }),
  run: (context, args) =>
    settle(
      context,
      usePoolOption(
        context.campaign.state(),
        who(args.who),
        {
          feature: args.feature,
          option: args.option,
          ...(args.target === undefined ? {} : { target: who(args.target) }),
          ...(args.damageType === undefined ? {} : { damageType: args.damageType }),
          ...identity(context),
        },
        context.campaign.supply(),
      ),
      (value) => value.events,
      (value) => ({ feature: args.feature, used: args.option, outcomes: value.outcomes }),
      (value) => value.unverified,
    ),
});

const TAKE_ACTION = tool({
  name: 'take_action',
  description: 'Take Dodge, Dash or Disengage.',
  mutates: true,
  input: z.object({ who: creatureId, kind: z.enum(['dodge', 'dash', 'disengage']) }),
  run: (context, args) => {
    const state = context.campaign.state();
    const id = who(args.who);
    const command =
      args.kind === 'dodge'
        ? takeDodge(state, id, identity(context))
        : args.kind === 'dash'
          ? takeDash(state, id, identity(context))
          : takeDisengage(state, id, identity(context));
    return settleEvents(context, command, { took: args.kind });
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
  }),
  run: (context, args) =>
    settle(
      context,
      resolveAttackDamage(
        context.campaign.state(),
        who(args.attacker),
        { ...identity(context) },
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
 * **`endRest` takes no command id**, which is the one place this surface
 * cannot give a call the idempotency every other one has: a retry of a
 * settlement that landed is answered `not_resting` rather than as a duplicate.
 * That is an engine signature and a finding rather than something to paper
 * over here.
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
    'End a rest and take what it earned. The engine reads the benefit off the clock and off the interruptions it recorded: a completed rest pays in full, a Long Rest broken after an hour pays as a Short Rest, and a Short Rest broken at all pays nothing. A rest that has simply not finished yet is refused, and the answer is to let more time pass. Name Hit Dice to spend them — a Short Rest is the only rest that offers it, the engine rolls each one and adds the Constitution it finds on the sheet, and asking for more than are left is refused before any is rolled.',
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
  }),
  run: (context, args) =>
    settle(
      context,
      endRest(
        context.campaign.state(),
        who(args.who),
        {
          ...(args.hitDice === undefined ? {} : { hitDice: args.hitDice }),
          ...(args.interruptedBy === undefined ? {} : { interrupted: args.interruptedBy }),
        },
        context.campaign.supply(),
      ),
      (value) => value.events,
      (value) => ({
        benefit: value.benefit,
        hitDiceSpent: value.hitDice.map((die) => die.key),
        hitPointsRegained: value.hitPointsRegained,
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
        fought: z.array(creatureId).optional(),
        unaffected: z.array(creatureId).optional(),
        teleportTo: placementSchema.optional(),
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
                  ...(response.fought === undefined ? {} : { fought: response.fought.map(who) }),
                  ...(response.unaffected === undefined
                    ? {}
                    : { unaffected: response.unaffected.map(who) }),
                  ...(response.teleportTo === undefined
                    ? {}
                    : { teleportTo: placementOf(response.teleportTo) }),
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
  input: z.object({}),
  run: (context) =>
    settle(
      context,
      resolveTurn(context.campaign.state(), context.campaign.supply(), identity(context)),
      (value) => value.events,
      (value) => ({
        savesRolled: value.saves.map((save) => ({ label: save.label, success: save.success })),
        savesOutstanding: value.pending.length,
        duplicate: value.duplicate ?? false,
      }),
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
  ATTACK,
  ATTEMPT_EFFECT_CHECK,
  BEGIN_REST,
  CAST_SPELL,
  CREATE_CHARACTER,
  DECLARE_COVER,
  DECLARE_CREATURE_TYPE,
  DECLARE_DIFFICULT_TERRAIN,
  DECLARE_FALLING,
  DECLARE_SIDE,
  DECLARE_SIGHT,
  DECLINE_DAMAGE_REACTION,
  DECLINE_OPPORTUNITY,
  DECLINE_TEST_REACTION,
  DRAW_ON_HEALING_POOL,
  ELIGIBLE_TARGETS,
  END_CONCENTRATION,
  END_FEATURE,
  END_ONGOING_SPELL,
  END_REST,
  END_TURN,
  EXTEND_FEATURE,
  HEAL_WITH_FEATURE,
  LOOK,
  MOVE,
  OPTIONS,
  PLACE_CREATURE,
  REGAIN_USES,
  RELEASE_READY,
  RESOLVE_DECLARED_CAST,
  ROLL_INITIATIVE,
  SET_SCENE,
  SETTLE_AREA_EFFECTS,
  SETTLE_ATTACK,
  SETTLE_DAMAGE,
  SHEET,
  TAKE_ACTION,
  TAKE_DAMAGE_REACTION,
  TAKE_OPPORTUNITY_ATTACK,
  TAKE_READY,
  TAKE_TEST_REACTION,
  USE_ITEM,
  USE_POOL_OPTION,
].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

export const TOOL_NAMES: readonly string[] = TOOLS.map((definition) => definition.name);
