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
 * | `x`, `y`, `z` on a landmark or an area's origin | the scene's extent. This is map-making, and something has to anchor the room |
 * | `width`, `depth`, `height` on a scene | nothing. A room's size is fiction, and the engine holds it only so a 60-foot tavern cannot contain a 1000-foot gap |
 * | `difficultFeet` on a move | the move's own distance. Declared terrain, on the same grounds as cover: five of SRD's six cases are fiction, and working them out means modelling the room. Its only direction of abuse is self-harm |
 *
 * The consequence is deliberate: an action the engine does not model has no
 * legal path through this surface at step one. It finds a rule the engine
 * owns, or it is refused.
 *
 * ## What the slice covers
 *
 * Enough to run a fight end to end, and nothing beyond it. Initiative, the
 * scene and the facts a fight needs declared, movement, attacks, casting,
 * conditions applied and ended, the two engine debts that can wedge a fight
 * (a held move, an owed area effect), the turn boundary, and the three
 * queries a caller needs to choose among them. Rests, advancement, inventory,
 * equipment, items, readied actions, teleportation and mounts are all left
 * for later batches; none of them is needed to fight.
 *
 * ## Why each tool declares what it establishes
 *
 * `docs/design/claude-integration.md`: "Every `ContextRequest.kind` must map
 * to a tool that declares it — a kind with no door is the failure to test
 * for." So the mapping is a field on the definition rather than a paragraph,
 * and `boundary.test.ts` asserts the seven kinds are covered.
 */

import type { CharacterId, ConditionName, Result } from '@ie/shared';
import { asCharacterId, needsContext, ok } from '@ie/shared';
import type {
  CharacterChoices,
  CastSpellRequest,
  CreatureState,
  Duration,
  CombatantInput,
  GameEvent,
  GameState,
  InitiativeEntrant,
  Placement,
  Point,
} from '@ie/engine';
import {
  addSceneLandmark,
  applyConditionTo,
  applyEvent,
  availableChecks,
  createCharacter,
  declareCoverBetween,
  declareCreatureSide,
  declareCreatureType,
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
  placementSchema,
  pointSchema,
  sensesFields,
} from './schemas.js';

// — the shape of a definition —————————————————————————————————————————————

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

interface ToolSpec<S extends z.ZodType> {
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

function tool<S extends z.ZodType>(spec: ToolSpec<S>): ToolDefinition {
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
function settle<T>(
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
const settleEvents = (
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
const identity = (context: ToolContext, suffix = ''): { commandId: string } => ({
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

const who = (id: string): CharacterId => asCharacterId(id);

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

const senses = (input: {
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
  if (input.towardsCreature !== undefined) {
    const at = state.scene === null ? null : positionOf(state.scene, who(input.towardsCreature));
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
    const at = state.scene?.landmarks[input.towardsLandmark];
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
      if (planned.ok && sameCharacter(existing, planned.value)) {
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
 * Whether a creature already in the game is the one these events would add.
 *
 * The sheet is the whole of the mechanical character — abilities, armour,
 * proficiency, Speed, spellcasting ability — so comparing it and the two
 * numbers beside it is comparing the character rather than its label.
 */
function sameCharacter(existing: CreatureState, events: readonly GameEvent[]): boolean {
  const added = events.find((event) => event.type === 'creature-added');
  if (added === undefined || added.type !== 'creature-added') return false;
  return (
    added.name === existing.name &&
    added.maxHp === existing.vitals.hpMax &&
    (added.creatureType ?? null) === (existing.creatureType ?? null) &&
    JSON.stringify(added.sheet) === JSON.stringify(existing.sheet)
  );
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
          ...identity(context),
        },
        context.campaign.supply(),
      ),
      (value) => value.events,
      (value) => ({ feetMoved: value.feet, movementCost: value.cost, duplicate: value.duplicate }),
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
        `DM ruling: ${args.ruling}`,
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
  ADD_LANDMARK,
  APPLY_CONDITION,
  ATTACK,
  ATTEMPT_EFFECT_CHECK,
  CAST_SPELL,
  CREATE_CHARACTER,
  DECLARE_COVER,
  DECLARE_CREATURE_TYPE,
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
