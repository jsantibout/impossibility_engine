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
  activateSpell,
  addSceneLandmark,
  applyConditionTo,
  applyEvent,
  areaPointAt,
  availableChecks,
  createCharacter,
  declareCoverBetween,
  declareCreatureSide,
  declareCreatureType,
  declareDifficultTerrain,
  declareFalling,
  declareSightBetween,
  declineOpportunity,
  eligibleTargets,
  endConcentration,
  endOngoingSpell,
  INITIATIVE_LABEL,
  joinCombat,
  mayAct,
  placeCreatureInScene,
  positionOf,
  reactionOpportunities,
  recordInitiativeRolls,
  resolveAttack,
  resolveEffectCheck,
  resolveMove,
  resolveSpell,
  resolveTurn,
  rollInitiativeAndBeginCombat,
  setScene,
  settleAreaEffects,
  speedOf,
  takeDash,
  takeDisengage,
  takeDodge,
  takeOpportunityAttack,
} from '@ie/engine';
import { z } from 'zod';
import type { Campaign } from './campaign.js';
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

const placementOf = (input: z.infer<typeof placementSchema>): Placement => ({
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

const PLACE_CREATURE = tool({
  name: 'place_creature',
  description:
    'Put a creature into the scene, relative to a landmark or another creature. Use this the first time a creature needs a position; one that already has a position moves instead, spending its Speed.',
  mutates: true,
  establishes: ['position'],
  input: z.object({ who: creatureId }).and(placementSchema),
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
 * Monster and Animal Friendship all print the fighting clause, Misty Step and
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
  ACTIVATE_SPELL,
  ADD_LANDMARK,
  APPLY_CONDITION,
  ATTACK,
  ATTEMPT_EFFECT_CHECK,
  CAST_SPELL,
  CREATE_CHARACTER,
  DECLARE_COVER,
  DECLARE_CREATURE_TYPE,
  DECLARE_DIFFICULT_TERRAIN,
  DECLARE_FALLING,
  DECLARE_SIDE,
  DECLARE_SIGHT,
  DECLINE_OPPORTUNITY,
  ELIGIBLE_TARGETS,
  END_CONCENTRATION,
  END_ONGOING_SPELL,
  END_TURN,
  LOOK,
  MOVE,
  OPTIONS,
  PLACE_CREATURE,
  ROLL_INITIATIVE,
  SET_SCENE,
  SETTLE_AREA_EFFECTS,
  TAKE_ACTION,
  TAKE_OPPORTUNITY_ATTACK,
].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

export const TOOL_NAMES: readonly string[] = TOOLS.map((definition) => definition.name);
