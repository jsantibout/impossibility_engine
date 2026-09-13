/**
 * The experimental tool surface: the only door the model has to the engine.
 *
 * **This is not `@ie/tools` and must never be mistaken for it.** M2's surface
 * is Zod-validated, lives in `packages/`, and is a product. This is a probe:
 * the thinnest possible mapping from a model's tool call to an engine command,
 * built to find out where the boundary chafes before anybody builds the real
 * one.
 *
 * ## What is exposed, and the one rule that decided it
 *
 * A tool is on this surface only if **the model supplies no mechanically
 * authoritative number through it**. That rule excluded more than it let in,
 * and the exclusions are the interesting half:
 *
 * | Engine command | Why it is not here |
 * |---|---|
 * | `resolveDamage`, `damageCreature` | take `amount` — a number the model would be inventing |
 * | `healCreature`, `grantTemporaryHpTo` | same, in the other direction |
 * | `applyConditionTo`, `setExhaustionLevel` | assert an outcome the rules are supposed to decide |
 * | `recordExternalD20`, `recordExternalDamage` | the DM-override path; `rolls.ts` keeps them off a model's reach by policy, and so does this |
 *
 * The consequence is deliberate and is one of the things being measured: an
 * action the engine does not model has **no legal path at all** through this
 * surface. A shove is not a thing the model can quietly resolve by asserting
 * damage. It either finds a rule the engine owns, or the turn is a dead end,
 * and the probe records which.
 *
 * `ability_check` is the single place the model passes a number, and it is a
 * **Difficulty Class**, not an outcome. SRD 5.2.1 makes setting a DC the DM's
 * job explicitly; the engine still rolls the die, applies the modifiers and
 * decides success. That is a genuine adjudication gap being used as one, not
 * an override.
 *
 * ## What the model is handed back
 *
 * Every result — success, refusal or request — carries the same compact
 * observation of authoritative state. That is the "grounding" half the audit
 * says a hard boundary needs: enforcement without grounding just leaves the
 * model narrating blind. Whether it is *enough* grounding is the experiment.
 */

import {
  asCharacterId,
  contextRequestsOf,
  isNeedsContext,
  CONDITIONS,
  type CharacterId,
  type ConditionName,
  type Result,
} from '@ie/shared';
import {
  adaptMonster,
  applyConditionTo,
  armorClass,
  availableChecks,
  itemFor,
  parseNotation,
  rollRecorded,
  resolveDamage,
  declareCover,
  declareCreatureType,
  declineOpportunity,
  identify,
  declareSight,
  eligibleTargets,
  mayAct,
  placeCreature,
  positionOf,
  resolveEffectCheck,
  reactionOpportunities,
  resolveAttack,
  resolveMove,
  resolveSpell,
  resolveTest,
  resolveTurn,
  settleAreaEffects,
  distanceBetween,
  remaining,
  spellSlotKey,
  takeDash,
  takeDisengage,
  takeDodge,
  takeOpportunityAttack,
  type CoverDegree,
  type GameEvent,
  type GameState,
} from '@ie/engine';
import { carrying } from '@ie/engine';
import type { CreatureSize } from '@ie/srd';
import { actionNamesOf, monsterFor, monsterNamed, weaponsOf } from './bestiary.js';
import type { Session } from './session.js';

const CONDITION_NAMES: ReadonlySet<string> = new Set<string>(CONDITIONS);

/**
 * SRD's three degrees plus "none", which is how a declaration is withdrawn.
 *
 * Transcribed from `CoverDegree` rather than imagined: an unknown degree is
 * malformed input, because the engine applies an exact +2, +5 or a refusal to
 * each of these and there is no fourth thing it knows how to apply.
 */
const COVER_DEGREES: ReadonlySet<string> = new Set(['none', 'half', 'three-quarters', 'total']);

// — the shape of a call, for the model and for the recorder ——————————————————

export type CallOutcome = 'ok' | 'refusal' | 'needs-context' | 'invalid';

export interface CallResult {
  readonly outcome: CallOutcome;
  /** A refusal's code, `malformed_input`, or `unknown_tool`. */
  readonly code: string | null;
  /** The `ContextRequest.kind`s a `needs-context` named. */
  readonly requestKinds: readonly string[];
  /** How many events this call wrote to the authoritative log. */
  readonly events: number;
  /** Checks the rules call for that the engine could not make. */
  readonly unverified: readonly string[];
  /** The JSON the model is shown. */
  readonly body: Record<string, unknown>;
}

export interface ToolSpec {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
  /** Whether a call can write to the log. Queries are free; this is measured. */
  readonly mutating: boolean;
}

// — reading a model's arguments without trusting them ————————————————————————

class BadInput extends Error {
  constructor(readonly field: string, message: string) {
    super(message);
  }
}

const obj = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

function str(input: Record<string, unknown>, field: string): string {
  const v = input[field];
  if (typeof v !== 'string' || v.length === 0) {
    throw new BadInput(field, `${field} must be a non-empty string`);
  }
  return v;
}

function optStr(input: Record<string, unknown>, field: string): string | undefined {
  const v = input[field];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string') throw new BadInput(field, `${field} must be a string`);
  return v;
}

function num(input: Record<string, unknown>, field: string): number {
  const v = input[field];
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new BadInput(field, `${field} must be a finite number`);
  }
  return v;
}

function optNum(input: Record<string, unknown>, field: string): number | undefined {
  const v = input[field];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new BadInput(field, `${field} must be a finite number`);
  }
  return v;
}

function strArray(input: Record<string, unknown>, field: string): readonly string[] {
  const v = input[field];
  if (!Array.isArray(v) || v.some((e) => typeof e !== 'string')) {
    throw new BadInput(field, `${field} must be an array of strings`);
  }
  return v as readonly string[];
}

function who(input: Record<string, unknown>, field: string): CharacterId {
  return asCharacterId(str(input, field));
}

/**
 * A command id the model must supply, so a retry is a no-op rather than a
 * second casting.
 *
 * Optional in the engine, because a scripted fixture has no retry problem.
 * **Mandatory here**, because a model-driven loop retries for reasons that
 * have nothing to do with the game, and `CLAUDE.md` says every mutating tool
 * on a model's surface takes one. A missing one is recorded as malformed
 * input rather than being invented, because inventing it would hide exactly
 * the failure this is here to catch.
 */
function commandId(input: Record<string, unknown>): { commandId: string } {
  return { commandId: str(input, 'command_id') };
}

// — the observation ————————————————————————————————————————————————————————

const feet = (state: GameState, a: CharacterId, b: CharacterId): number | null => {
  if (state.scene === null) return null;
  const apart = distanceBetween(state.scene, a, b);
  return apart.ok ? apart.value : null;
};

/**
 * Everything authoritative the model could reasonably need, in one object.
 *
 * Attached to *every* tool result rather than fetched. A surface that made the
 * model ask for state would measure its curiosity instead of the boundary, and
 * the audit's own recommendation is that "what can I do now" be as cheap as
 * "do it".
 */
export function observe(state: GameState): Record<string, unknown> {
  const ids = Object.keys(state.creatures).sort();
  const combat = state.combat;
  const turnOf = combat?.order[combat.turnIndex]?.id ?? null;

  const creatures = ids.map((key) => {
    const c = state.creatures[key]!;
    const budget = combat?.budgets[key];
    const slots = [1, 2, 3, 4, 5, 6, 7, 8, 9]
      .map((level) => [level, remaining(c.resources, spellSlotKey(level))] as const)
      .filter(([, left]) => left > 0);
    return {
      id: c.id,
      name: c.name,
      side: c.side,
      hp: c.vitals.hp,
      hp_max: c.vitals.hpMax,
      dead: c.vitals.dead,
      temp_hp: c.vitals.temporaryHp,
      // Base Armour Class only. `armorClassOf` — the reader that folds in a
      // Shield of Faith or a Mage Armor — lives in `standing.ts` and is not on
      // the engine's public surface, so a grounding layer cannot see the
      // number the engine itself attacks against. Recorded as a finding rather
      // than patched: this probe does not change the engine. Nothing
      // mechanical reads this field; it is what the model is shown.
      armor_class: armorClass(c.sheet),
      creature_type: c.creatureType,
      conditions: c.conditions.conditions,
      // What it is holding, because `resolveAttack` refuses a weapon the
      // attacker does not own and nothing else told the model what that was.
      // The first live run opened a goblin's turn with a shortbow � which the
      // SRD 2024 Goblin Warrior does carry, and this fixture had omitted. The
      // model knew the stat block better than the fixture did, and was refused
      // `not_owned` for it. A grounding surface has to say what is in hand.
      carrying: carrying(state, c.id).map((line) => line.id),
      concentrating_on: c.concentration?.spell ?? null,
      placed: state.scene === null ? null : positionOf(state.scene, c.id) !== null,
      feet_to: Object.fromEntries(
        ids.filter((o) => o !== key).map((o) => [o, feet(state, c.id, asCharacterId(o))]),
      ),
      ...(slots.length === 0 ? {} : { spell_slots: Object.fromEntries(slots) }),
      ...(budget === undefined
        ? {}
        : {
            budget: {
              action: budget.action,
              bonus_action: budget.bonusAction,
              reaction: budget.reaction,
              movement_feet: budget.movementRemaining,
              spent_a_slot_this_turn: budget.spellSlotSpentOnTurn !== null,
            },
          }),
    };
  });

  // Engine debts. Any of these outstanding and most commands will refuse, so
  // the model is told about them before it tries rather than after.
  const owed = {
    pending_saves: state.pendingSaves === undefined ? 0 : Object.keys(state.pendingSaves).length,
    pending_attack: state.pendingAttack === null ? null : state.pendingAttack.attacker,
    pending_damage: state.pendingDamage === null ? null : state.pendingDamage.target,
    pending_test: state.pendingTest === null ? null : state.pendingTest.who,
    pending_casting: state.pendingCasting === null ? null : state.pendingCasting.castingId,
    // A held move names the mover *and* everyone who must answer before the
    // fight can continue. Reporting only the mover is what left the first live
    // run guessing: it could see something was pending and not who owed what.
    pending_move:
      state.pendingMove === null
        ? null
        : {
            mover: state.pendingMove.mover,
            must_answer_opportunity_attack: state.pendingMove.provoked.map((p) => p.reactor),
          },
    owed_area_effects: state.owedAreaEffects.length,
    turn_start_unsettled: state.pendingTurnStart?.who ?? null,
  };

  return {
    round: combat?.round ?? null,
    turn_of: turnOf,
    initiative_order: combat?.order.map((c) => c.id) ?? null,
    elapsed_seconds: state.elapsed,
    scene: state.scene === null ? null : { extent: state.scene.extent, landmarks: Object.keys(state.scene.landmarks).sort() },
    creatures,
    owed,
  };
}

// — dispatch ———————————————————————————————————————————————————————————————

/**
 * Turn an engine `Result` into the three-valued answer the model branches on.
 *
 * The whole protocol is here: `ok` means it happened, `refusal` means the
 * rules say no under facts that are established, `needs-context` means go and
 * establish a fact and ask again. Collapsing the last two is the thing the
 * doctrine forbids, so nothing in this function may.
 */
function settle<T>(
  session: Session,
  result: Result<T>,
  eventsOf: (value: T) => readonly GameEvent[],
  bodyOf: (value: T) => Record<string, unknown>,
  unverifiedOf: (value: T) => readonly string[] = () => [],
): CallResult {
  if (!result.ok) {
    const kinds = contextRequestsOf(result).map((r) => r.kind);
    return {
      outcome: isNeedsContext(result) ? 'needs-context' : 'refusal',
      code: result.code,
      requestKinds: kinds,
      events: 0,
      unverified: [],
      body: {
        status: isNeedsContext(result) ? 'needs-context' : 'refused',
        code: result.code,
        reason: result.reason,
        ...(contextRequestsOf(result).length === 0
          ? {}
          : {
              establish: contextRequestsOf(result).map((r) => ({
                kind: r.kind,
                subject: r.subject,
                need: r.need,
                because: r.because,
                satisfy_with: r.satisfyWith,
              })),
            }),
      },
    };
  }

  const events = eventsOf(result.value);
  session.push(events);
  const unverified = unverifiedOf(result.value);
  return {
    outcome: 'ok',
    code: null,
    requestKinds: [],
    events: events.length,
    unverified,
    body: {
      status: 'ok',
      ...bodyOf(result.value),
      ...(unverified.length === 0 ? {} : { unverified }),
    },
  };
}

const plain = (body: Record<string, unknown>): CallResult => ({
  outcome: 'ok',
  code: null,
  requestKinds: [],
  events: 0,
  unverified: [],
  body: { status: 'ok', ...body },
});

/**
 * A declaration the engine validates but has no command for.
 *
 * `placeCreature` and `declareSight` are pure functions over `PositionState`,
 * and the reducer calls them again and throws a `CorruptLogError` if they
 * fail. So the check happens here first and a bad declaration comes back as a
 * refusal — which is what the model can act on — rather than as a crash.
 */
function declaring(
  session: Session,
  check: Result<unknown>,
  event: GameEvent,
): CallResult {
  if (!check.ok) {
    return {
      outcome: isNeedsContext(check) ? 'needs-context' : 'refusal',
      code: check.code,
      requestKinds: contextRequestsOf(check).map((r) => r.kind),
      events: 0,
      unverified: [],
      body: { status: 'refused', code: check.code, reason: check.reason },
    };
  }
  session.push([event]);
  return { outcome: 'ok', code: null, requestKinds: [], events: 1, unverified: [], body: { status: 'ok' } };
}

/**
 * A creature nobody has told the engine about is a request, not a verdict.
 *
 * "There is no such creature" would be the engine answering a question about
 * the world; the honest answer is that its record is thin, and both creation
 * tools are named so the caller can fix it in one call.
 */
const unknownCreatureResult = (id: CharacterId): CallResult => ({
  outcome: 'needs-context',
  code: 'unknown_creature',
  requestKinds: ['creature'],
  events: 0,
  unverified: [],
  body: {
    status: 'needs-context',
    code: 'unknown_creature',
    reason: `${id} has no record here yet`,
    establish: [
      {
        kind: 'creature',
        subject: id,
        need: `a record for ${id}`,
        because: 'the engine can only resolve against creatures it knows',
        satisfy_with: 'spawn_srd_creature for an SRD stat block, or author_creature for one you invent',
      },
    ],
  },
});

export interface DispatchOptions {
  /** Collected narration, so the probe can read what the model claimed. */
  readonly narration: string[];
}

export function dispatch(
  session: Session,
  tool: string,
  rawInput: unknown,
  options: DispatchOptions,
): CallResult {
  const input = obj(rawInput);
  try {
    const result = run(session, tool, input, options);
    // **Narration rides along.** The live experiment spent 64% of its round
    // trips on one `narrate` and one `end_turn` per beat, against an engine
    // that answered every call in 3 ms. A separate call to say what happened
    // buys nothing: narration changes no state, so it cannot be wrong about
    // state, and the doctrine's North Star ranks fewer round trips above
    // interface tidiness. Any mutating call may carry the sentence the players
    // hear.
    const alongside = input['narration'];
    if (typeof alongside === 'string' && alongside.length > 0 && tool !== 'narrate') {
      options.narration.push(alongside);
    }
    return result;
  } catch (error) {
    if (error instanceof BadInput) {
      return {
        outcome: 'invalid',
        code: 'malformed_input',
        requestKinds: [],
        events: 0,
        unverified: [],
        body: { status: 'invalid', code: 'malformed_input', field: error.field, reason: error.message },
      };
    }
    throw error;
  }
}

function run(
  session: Session,
  tool: string,
  input: Record<string, unknown>,
  options: DispatchOptions,
): CallResult {
  const state = session.state();

  switch (tool) {
    // — queries, which cost nothing and write nothing ————————————————————————

    case 'look':
      return plain({});

    case 'options': {
      const id = who(input, 'who');
      const blocked = mayAct(state, id);
      return plain({
        may_act: blocked === null,
        ...(blocked === null ? {} : { blocked_because: { code: blocked.code, reason: blocked.reason } }),
        reactions: reactionOpportunities(state)
          .filter((o) => o.reactor === id)
          .map((o) => ({ id: o.id, name: o.name, window: o.window, costs_reaction: o.costsReaction })),
        checks_available: availableChecks(state, id).map((c) => ({
          effect_key: c.effectKey,
          label: c.label,
          dc: c.dc,
        })),
      });
    }

    case 'eligible_targets': {
      const caster = who(input, 'caster');
      const shortlist = eligibleTargets(state, caster, str(input, 'spell_id'), optNum(input, 'slot_level') ?? 0);
      return plain({
        eligible: shortlist.eligible,
        excluded: shortlist.excluded.map((e) => ({ target: e.target, reason: e.reason })),
        needs_context: shortlist.needsContext.map((r) => ({
          kind: r.kind,
          subject: r.subject,
          need: r.need,
          satisfy_with: r.satisfyWith,
        })),
      });
    }

    // — bringing a creature into the world ————————————————————————————————
    //
    // Two tools, and which one you use is the whole truth/authorship
    // distinction. There is deliberately no third path that creates a creature
    // with facts left blank, because that third path is what the live
    // experiment exploited: a goblin existed with no creature type, the engine
    // had to ask for one, and the model supplied the answer that made its own
    // spell legal.
    //
    // | | Facts come from |
    // |---|---|
    // | `spawn_srd_creature` | the parsed stat block. The model names the id and nothing else. |
    // | `author_creature` | the DM, who must state them all at once. |
    //
    // Authorship is broad and creation-time; contradiction afterwards is not.

    case 'spawn_srd_creature': {
      const monsterId = str(input, 'monster_id');
      const monster = monsterFor(monsterId);
      if (monster === null) {
        return {
          outcome: 'refusal',
          code: 'unknown_monster',
          requestKinds: [],
          events: 0,
          unverified: [],
          body: {
            status: 'refused',
            code: 'unknown_monster',
            reason: `the SRD has no stat block with id ${monsterId}; use author_creature to invent a creature of your own`,
          },
        };
      }
      const id = who(input, 'as');
      const adapted = adaptMonster(monster, id);
      // **The creature id is the idempotency key.** `creature-added` declares
      // no command stamp, and stamping it anyway would rely on the
      // excess-property hole `CLAUDE.md` documents twice — so identity comes
      // from the thing being created instead. A retry that would create the
      // same creature again is a no-op; one that would create a *different*
      // creature under a taken id is a refusal.
      const existing = state.creatures[id];
      if (existing !== undefined) {
        if (existing.name === adapted.name) {
          return plain({ spawned: id, name: adapted.name, duplicate: true });
        }
        return {
          outcome: 'refusal',
          code: 'id_taken',
          requestKinds: [],
          events: 0,
          unverified: [],
          body: {
            status: 'refused',
            code: 'id_taken',
            reason: `${id} is already ${existing.name}; choose another id`,
          },
        };
      }
      const side = optStr(input, 'side');
      const events: GameEvent[] = [
        {
          type: 'creature-added',
          id,
          name: adapted.name,
          maxHp: adapted.vitals.hpMax,
          diesAtZero: true,
          // From the stat block, never from the caller. This is the line the
          // experiment crossed.
          creatureType: adapted.creatureType,
          defenses: adapted.defenses.byDamageType,
          sheet: adapted.sheet,
          ...(side === undefined ? {} : { side }),
        },
      ];
      // `resolveAttack` refuses a weapon its wielder does not own, so a stat
      // block that prints a Scimitar has to arrive holding one.
      const weapons = weaponsOf(monster);
      if (weapons.length > 0) {
        events.push({
          type: 'items-gained',
          id,
          items: weapons.map((item) => ({ id: item, quantity: 1 })),
          source: `${adapted.name} stat block`,
        });
      }
      session.push(events);
      return plain({
        spawned: id,
        name: adapted.name,
        creature_type: adapted.creatureType,
        size: adapted.size,
        armor_class: adapted.sheet.stated?.armorClass ?? null,
        hit_points: adapted.vitals.hpMax,
        weapons,
        stat_block_actions: actionNamesOf(monster),
        ...(adapted.caveats.length === 0 ? {} : { caveats: adapted.caveats }),
      });
    }

    case 'author_creature': {
      const id = who(input, 'as');
      const name = str(input, 'name');
      // The creature id is the key here too — see `spawn_srd_creature`.
      const existing = state.creatures[id];
      if (existing !== undefined) {
        if (existing.name === name) return plain({ authored: id, duplicate: true });
        return {
          outcome: 'refusal',
          code: 'id_taken',
          requestKinds: [],
          events: 0,
          unverified: [],
          body: {
            status: 'refused',
            code: 'id_taken',
            reason: `${id} is already ${existing.name}; choose another id`,
          },
        };
      }
      const abilities = obj(input['abilities']);
      const side = optStr(input, 'side');
      const events: GameEvent[] = [
        {
          type: 'creature-added',
          id,
          name,
          maxHp: num(input, 'max_hp'),
          diesAtZero: true,
          // Required, not optional. A creature the DM invents is the DM's to
          // define — and defining it is how it becomes established truth that
          // nothing later gets to contradict.
          creatureType: str(input, 'creature_type'),
          sheet: {
            level: 1,
            abilities: {
              str: num(abilities, 'str'),
              dex: num(abilities, 'dex'),
              con: num(abilities, 'con'),
              int: num(abilities, 'int'),
              wis: num(abilities, 'wis'),
              cha: num(abilities, 'cha'),
            },
            skills: {},
            saveProficiencies: [],
            armor: null,
            shield: null,
            armorTraining: { light: true, medium: true, heavy: true, shields: true },
            baseSpeed: num(input, 'speed'),
            spellcastingAbility: null,
            stated: {
              armorClass: num(input, 'armor_class'),
              proficiencyBonus: optNum(input, 'proficiency_bonus') ?? 2,
            },
          },
          ...(side === undefined ? {} : { side }),
        },
      ];
      session.push(events);
      return plain({ authored: id, creature_type: str(input, 'creature_type') });
    }

    case 'give_item': {
      const id = who(input, 'who');
      const item = str(input, 'item_id');
      if (itemFor(item) === null) {
        return {
          outcome: 'refusal',
          code: 'unknown_item',
          requestKinds: [],
          events: 0,
          unverified: [],
          body: {
            status: 'refused',
            code: 'unknown_item',
            reason: `${item} is not an item the SRD catalogue lists`,
          },
        };
      }
      if (state.creatures[id] === undefined) {
        return {
          outcome: 'needs-context',
          code: 'unknown_creature',
          requestKinds: ['creature'],
          events: 0,
          unverified: [],
          body: {
            status: 'needs-context',
            code: 'unknown_creature',
            reason: `${id} has no record here yet`,
            establish: [
              {
                kind: 'creature',
                subject: id,
                need: `a record for ${id}`,
                because: 'an item has to be given to somebody',
                satisfy_with: 'spawn_srd_creature or author_creature',
              },
            ],
          },
        };
      }
      // `items-gained` declares a command stamp and `recordCommand` is generic
      // over any event that carries one, so a retried grant is a no-op rather
      // than a second scimitar.
      const identity = identify(state, `give-item:${id}`, { ...commandId(input), item });
      if (!identity.ok) {
        return {
          outcome: 'refusal',
          code: identity.code,
          requestKinds: [],
          events: 0,
          unverified: [],
          body: { status: 'refused', code: identity.code, reason: identity.reason },
        };
      }
      if (identity.value.duplicate) return plain({ gave: item, to: id, duplicate: true });
      const stamp = identity.value.stamp;
      session.push([
        {
          type: 'items-gained',
          id,
          items: [{ id: item, quantity: optNum(input, 'quantity') ?? 1 }],
          source: optStr(input, 'ruling') ?? 'the DM',
          ...(stamp === null ? {} : { command: stamp }),
        },
      ]);
      return plain({ gave: item, to: id });
    }

    // — establishing facts the engine has not been told ————————————————————

    case 'set_scene': {
      const event: GameEvent = {
        type: 'scene-set',
        extent: { width: num(input, 'width'), depth: num(input, 'depth'), height: num(input, 'height') },
      };
      session.push([event]);
      return plain({ established: 'scene' });
    }

    case 'add_landmark': {
      const event: GameEvent = {
        type: 'landmark-added',
        name: str(input, 'name'),
        at: { x: num(input, 'x'), y: num(input, 'y'), z: optNum(input, 'z') ?? 0 },
      };
      session.push([event]);
      return plain({ established: 'landmark' });
    }

    case 'place_creature': {
      if (state.scene === null) {
        return {
          outcome: 'refusal',
          code: 'no_scene',
          requestKinds: [],
          events: 0,
          unverified: [],
          body: { status: 'refused', code: 'no_scene', reason: 'no scene has been set; set one first' },
        };
      }
      const id = who(input, 'who');
      const placement = placementFrom(state, input);
      return declaring(session, placeCreature(state.scene, id, placement), {
        type: 'creature-placed',
        id,
        placement,
      });
    }

    case 'declare_sight': {
      if (state.scene === null) {
        return {
          outcome: 'refusal',
          code: 'no_scene',
          requestKinds: [],
          events: 0,
          unverified: [],
          body: { status: 'refused', code: 'no_scene', reason: 'no scene has been set; set one first' },
        };
      }
      const from = who(input, 'from');
      const to = who(input, 'to');
      const seen = input['seen'];
      if (typeof seen !== 'boolean') throw new BadInput('seen', 'seen must be true or false');
      return declaring(session, declareSight(state.scene, from, to, seen), {
        type: 'sight-declared',
        from,
        to,
        seen,
      });
    }

    /**
     * Settle what a persistent area caught somebody doing.
     *
     * **The Opportunity Attack deadlock, a second time, found by an audit
     * rather than by a wedged fight.** `owedAreaEffects` is global engine debt:
     * `mayAct` refuses every action while one stands, and `resolveTurn`'s own
     * guard refuses *before* it reaches the settlement it performs internally —
     * so a creature walking into a Grease with no tool for this can neither act
     * nor end its turn. The surface previously recorded "no spell on this
     * surface makes a persistent area" as the reason nothing settled it. That
     * stopped being true the moment a Wizard with Grease prepared joined the
     * benchmark, and the only thing still hiding it was the missing `towards`
     * on `cast_spell` — the two gaps masked each other exactly.
     *
     * The engine supplies the save, the DC and the damage, as always. This
     * command carries no outcome of any kind; it says *settle it now*.
     */
    case 'settle_area_effects':
      return settle(
        session,
        settleAreaEffects(state, session.supply(), commandId(input)),
        (v) => v.events,
        (v) => ({
          settled: v.settled.map((owed) => ({
            casting_id: owed.castingId,
            target: owed.target,
            moment: owed.moment,
          })),
          outcomes: v.outcomes,
        }),
        (v) => v.unverified,
      );

    /**
     * Declared cover, which is the model's job by design and had no tool.
     *
     * `CLAUDE.md`: "Cover and line of sight stay declared, not ray-cast...
     * The model says 'behind the bar, three-quarters cover'; the engine applies
     * exactly +5 AC and +5 to Dexterity saves." The sight half of that sentence
     * has had `declare_sight` since the first experiment. The cover half had
     * nothing at all, so every attack in both benchmarks was resolved as though
     * the mill machinery and the tavern bar were not there.
     *
     * Exactness where it is cheap, judgement where geometry is expensive — and
     * the judgement needs somewhere to land.
     */
    case 'declare_cover': {
      if (state.scene === null) {
        return {
          outcome: 'refusal',
          code: 'no_scene',
          requestKinds: [],
          events: 0,
          unverified: [],
          body: { status: 'refused', code: 'no_scene', reason: 'no scene has been set; set one first' },
        };
      }
      const from = who(input, 'from');
      const to = who(input, 'to');
      const degree = str(input, 'degree');
      if (!COVER_DEGREES.has(degree)) {
        throw new BadInput('degree', `degree must be one of ${[...COVER_DEGREES].join(', ')}`);
      }
      return declaring(session, declareCover(state.scene, from, to, degree as CoverDegree), {
        type: 'cover-declared',
        from,
        to,
        degree: degree as CoverDegree,
      });
    }

    /**
     * Attempt a check a running spell offers against its own effect.
     *
     * `options` has always reported `checks_available` — the Investigation that
     * sees through an illusion, the Athletics that tears free of Black
     * Tentacles — and nothing on this surface could attempt one. A surface that
     * advertises an action it cannot take is the mild form of the deadlock
     * above: the DM is told the option exists and then finds it does not.
     *
     * The DM supplies which effect and what the attempt leans on; the DC was
     * written down when the effect was created and the engine still owns it.
     */
    case 'attempt_effect_check':
      return settle(
        session,
        resolveEffectCheck(
          state,
          who(input, 'who'),
          { effectKey: str(input, 'effect_key'), ...sensesFrom(input), ...commandId(input) },
          session.supply(),
        ),
        (v) => v.events,
        (v) => ({
          natural: v.check?.natural ?? null,
          total: v.check?.total ?? null,
          success: v.success,
          on_success: v.onSuccess,
          duplicate: v.duplicate ?? false,
        }),
      );

    case 'declare_creature_type':
      return settle(
        session,
        declareCreatureType(state, who(input, 'who'), str(input, 'creature_type'), commandId(input)),
        (events) => events,
        () => ({ established: 'creature-type' }),
      );

    // — acting ——————————————————————————————————————————————————————————————

    case 'cast_spell': {
      const caster = who(input, 'caster');
      const at = input['at'] === undefined ? undefined : pointFrom(obj(input['at']));
      // Which way a Cone, Cube or Line points. A *point to aim at*, never an
      // angle — the engine takes a Point here and `positionOf` turns a creature
      // or a landmark into one, so the DM keeps speaking in the vocabulary it
      // speaks everywhere else.
      //
      // Tier 2 lost a whole turn to this field's absence. Grease is a Cube, the
      // engine refused with `no_direction` and said in plain English that it
      // needed a direction, and the model spent four calls trying to find
      // somewhere to put a bearing because the schema had nowhere.
      const towards = towardsFrom(state, input);
      return settle(
        session,
        resolveSpell(
          state,
          caster,
          {
            spellId: str(input, 'spell_id'),
            targets: strArray(input, 'targets').map(asCharacterId),
            ...(at === undefined ? {} : { at }),
            ...(towards === undefined ? {} : { towards }),
            ...(optNum(input, 'slot_level') === undefined ? {} : { slotLevel: optNum(input, 'slot_level')! }),
            ...commandId(input),
          },
          session.supply(),
        ),
        (v) => v.events,
        (v) => ({
          casting_id: v.castingId,
          outcomes: v.outcomes,
        }),
        (v) => v.unverified,
      );
    }

    case 'attack': {
      const attacker = who(input, 'attacker');
      return settle(
        session,
        resolveAttack(
          state,
          attacker,
          {
            target: who(input, 'target'),
            weapon: optStr(input, 'weapon') ?? null,
            // A Javelin is "Melee or Ranged", and which one it is this time is
            // the attacker's choice rather than a property of the weapon. The
            // engine has always taken it — `reachCheck` reads `thrownRange`
            // instead of reach — and the surface not exposing it is why a Tier
            // 2 javelin thrown from fifteen feet came back `out_of_reach` and
            // the DM closed to melee and narrated a thrust instead. A different
            // mechanic resolved, with prose over the join.
            ...(input['thrown'] === true ? { thrown: true } : {}),
            ...commandId(input),
          },
          session.supply(),
        ),
        (v) => v.events,
        (v) => ({
          hit: v.attack?.hit ?? null,
          natural: v.attack?.roll.natural ?? null,
          total: v.attack?.total ?? null,
          critical: v.attack?.critical ?? null,
          ...(v.damage === undefined ? {} : { damage_dealt: v.damage }),
          duplicate: v.duplicate,
        }),
        (v) => v.unverified,
      );
    }

    case 'move': {
      const id = who(input, 'who');
      // SRD forced movement — a shove, a gust, a trap — is not the creature's
      // own, so it spends no Speed and provokes nobody. The engine has
      // supported it since Thunderwave; the surface not exposing it is what
      // left a correctly-ruled shove with nowhere to land.
      const forced = input['forced'] === true;
      return settle(
        session,
        resolveMove(
          state,
          id,
          { placement: placementFrom(state, input), ...(forced ? { forced: true } : {}), ...commandId(input) },
          session.supply(),
        ),
        (v) => v.events,
        (v) => ({ feet_moved: v.feet, movement_cost: v.cost, duplicate: v.duplicate }),
        (v) => v.unverified,
      );
    }

    // — answering a window the engine opened ————————————————————————————————
    //
    // Not an afterthought: the first live run deadlocked here. A move out of
    // two goblins' reach opened `pendingMove` with two Opportunity Attack
    // offers, every later command refused with `move_pending`, and the model —
    // which had correctly worked out that a Reaction was owed and by whom —
    // had no tool that could say so. It fell back to a plain `attack` and was
    // rightly told `not_their_turn`.
    //
    // **The general rule that came out of it: every debt the engine can raise
    // needs a tool that settles it, or the surface can wedge the fight with no
    // recovery path.** The engine is not at fault — `pendingMove` is exactly
    // the durable-debt design the doctrine asks for — but a surface missing
    // one settlement is worse than a surface missing a whole mechanic, because
    // the game stops rather than the action being refused.

    case 'take_opportunity_attack': {
      const reactor = who(input, 'attacker');
      return settle(
        session,
        takeOpportunityAttack(
          state,
          reactor,
          { weapon: optStr(input, 'weapon') ?? null, ...commandId(input) },
          session.supply(),
        ),
        (v) => v.events,
        (v) => ({
          hit: v.attack?.hit ?? null,
          natural: v.attack?.roll.natural ?? null,
          total: v.attack?.total ?? null,
          ...(v.damage === undefined ? {} : { damage_dealt: v.damage }),
        }),
        (v) => v.unverified,
      );
    }

    case 'decline_opportunity':
      return settle(
        session,
        declineOpportunity(state, who(input, 'attacker'), commandId(input)),
        (events) => events,
        () => ({ declined: true }),
      );

    case 'take_action': {
      const id = who(input, 'who');
      const kind = str(input, 'kind');
      const identity = commandId(input);
      const command =
        kind === 'dodge'
          ? takeDodge(state, id, identity)
          : kind === 'dash'
            ? takeDash(state, id, identity)
            : kind === 'disengage'
              ? takeDisengage(state, id, identity)
              : null;
      if (command === null) throw new BadInput('kind', `kind must be dodge, dash or disengage`);
      return settle(session, command, (events) => events, () => ({ took: kind }));
    }

    case 'ability_check': {
      const id = who(input, 'who');
      const skill = optStr(input, 'skill');
      return settle(
        session,
        resolveTest(
          state,
          id,
          {
            kind: str(input, 'kind') === 'saving-throw' ? 'saving-throw' : 'ability-check',
            ability: str(input, 'ability') as never,
            ...(skill === undefined ? {} : { skill: skill as never }),
            dc: num(input, 'dc'),
            ...(optStr(input, 'label') === undefined ? {} : { label: optStr(input, 'label')! }),
            // Which senses the attempt leans on — a fact about *this* attempt,
            // not about the skill, which is why the engine takes it from the
            // caller and cannot derive it. A Blinded creature automatically
            // fails a check that requires sight, and nothing else can tell the
            // engine that reading the inscription does and shoving the door
            // does not.
            ...sensesFrom(input),
            ...commandId(input),
          },
          session.supply(),
        ),
        (v) => v.events,
        (v) => ({
          natural: v.test?.roll.natural ?? null,
          total: v.test?.total ?? null,
          success: v.test?.success ?? null,
        }),
        (v) => v.unverified,
      );
    }

    // — adjudicating something the rules do not decide ————————————————————
    //
    // The other half of the boundary, and the half a "safer" surface would get
    // wrong. The live experiment asked the model to shove a goblin into a
    // hearth. It made exactly the right ruling — Strength (Athletics), DC 12 —
    // the engine rolled it, and then there was **no primitive that could apply
    // the consequence**. It tried `move`, was refused for lack of movement,
    // and narrated "the goblin's position does not change".
    //
    // That is rigidity, not truth-protection, and the doctrine's North Star
    // says it is the worse failure of the two. These three tools are what a DM
    // needs to finish a ruling they were always allowed to make:
    //
    // | Tool | The DM supplies | The engine supplies |
    // |---|---|---|
    // | `ability_check` | the ability, the skill, the DC | the modifier, the die, the outcome |
    // | `improvised_damage` | **dice notation** and a damage type | the roll, resistances, the hit points |
    // | `apply_ruled_condition` | which condition, and why | implication, timing, immunity |
    // | `move` with `forced` | where the shove puts them | the lattice, the scene, occupancy |
    //
    // Note what is *not* here: no tool takes an amount of damage, a hit point
    // total, or the result of a roll. `improvised_damage` takes `1d4`, which
    // is a rule; `4` would be a number, and the engine produces those.

    case 'improvised_damage': {
      const target = who(input, 'target');
      const notation = str(input, 'dice');
      const damageType = str(input, 'damage_type');
      const ruling = str(input, 'ruling');
      if (state.creatures[target] === undefined) return unknownCreatureResult(target);

      // Parsed before anything is spent, so a malformed ruling costs no die
      // and no generator advance — the engine's own validate-before-rolling
      // discipline, applied to a DM's improvisation.
      const parsed = parseNotation(notation);
      if (!parsed.ok) {
        return {
          outcome: 'refusal',
          code: parsed.code,
          requestKinds: [],
          events: 0,
          unverified: [],
          body: { status: 'refused', code: parsed.code, reason: parsed.reason },
        };
      }

      const supply = session.supply();
      const issuedBefore = supply.issuer.count;
      const rolled = rollRecorded(supply.issuer, supply.rng, notation);
      if (!rolled.ok) {
        return {
          outcome: 'refusal',
          code: rolled.code,
          requestKinds: [],
          events: 0,
          unverified: [],
          body: { status: 'refused', code: rolled.code, reason: rolled.reason },
        };
      }

      // The roll is recorded before the damage it caused, and the generator
      // position with it, exactly as every engine command does — so the log
      // explains the number and a replay reproduces it.
      const dealtBy = optStr(input, 'by');
      const settled = settle(
        session,
        resolveDamage(
          state,
          target,
          {
            amount: rolled.value.total,
            source: `DM ruling: ${ruling}`,
            ...(dealtBy === undefined ? {} : { by: asCharacterId(dealtBy) }),
            ...commandId(input),
          },
          supply,
        ),
        (v) => [
          {
            type: 'rolls-issued',
            count: supply.issuer.count - issuedBefore,
            rng: supply.rng.snapshot(),
          } as GameEvent,
          {
            type: 'roll-recorded',
            who: target,
            label: `${notation} ${damageType} — ${ruling}`,
            natural: rolled.value.dice[0]?.rolled ?? 0,
            total: rolled.value.total,
            contributions: [{ source: `DM ruling: ${ruling}`, amount: rolled.value.total }],
          } as GameEvent,
          ...v.events,
        ],
        (v) => ({
          rolled: rolled.value.total,
          dice: notation,
          damage_type: damageType,
          concentration: v.concentration.kind,
        }),
      );
      return settled;
    }

    case 'apply_ruled_condition': {
      const id = who(input, 'who');
      const condition = str(input, 'condition');
      const ruling = str(input, 'ruling');
      if (!CONDITION_NAMES.has(condition)) {
        return {
          outcome: 'refusal',
          code: 'unknown_condition',
          requestKinds: [],
          events: 0,
          unverified: [],
          body: {
            status: 'refused',
            code: 'unknown_condition',
            reason: `${condition} is not one of the SRD conditions: ${[...CONDITION_NAMES].sort().join(', ')}`,
          },
        };
      }
      return settle(
        session,
        applyConditionTo(
          state,
          id,
          condition as ConditionName,
          // The ruling *is* the source, so the log says why the creature is
          // Prone and a later reader can tell an adjudicated condition from
          // one a spell imposed.
          `DM ruling: ${ruling}`,
          [],
          undefined,
          undefined,
          commandId(input),
        ),
        (events) => events,
        () => ({ applied: condition, because: ruling }),
      );
    }

    case 'end_turn':
      return settle(
        session,
        resolveTurn(session.state(), session.supply(), commandId(input)),
        (v) => v.events,
        (v) => ({
          saves_rolled: v.saves.map((s) => ({ label: s.label, success: s.success })),
          saves_outstanding: v.pending.length,
        }),
      );

    // — saying what happened, which changes nothing ————————————————————————

    case 'narrate': {
      const text = str(input, 'text');
      options.narration.push(text);
      return plain({ narrated: true });
    }

    default:
      return {
        outcome: 'invalid',
        code: 'unknown_tool',
        requestKinds: [],
        events: 0,
        unverified: [],
        body: { status: 'invalid', code: 'unknown_tool', reason: `${tool} is not a tool on this surface` },
      };
  }
}

/**
 * Which way a directional area points, said the way the DM speaks.
 *
 * SRD gives a Cone, a Cube and a Line a direction, and `CastSpellRequest`
 * takes it as **a point to aim at** rather than an angle — deliberately, per
 * its own docstring: "Maestro speaks in landmarks and creatures, and
 * `positionOf` turns either into coordinates. An angle would be the model
 * typing raw geometry, which is the thing that is not allowed."
 *
 * So this accepts the same three vocabularies every other spatial field on
 * this surface accepts — a creature, a landmark, or an explicit point — and
 * resolves the first two against the scene. A creature or landmark nobody has
 * placed is malformed input rather than a guessed coordinate.
 */
function towardsFrom(
  state: GameState,
  input: Record<string, unknown>,
): { x: number; y: number; z: number } | undefined {
  const creature = optStr(input, 'towards_creature');
  if (creature !== undefined) {
    const at = state.scene === null ? null : positionOf(state.scene, asCharacterId(creature));
    if (at === null) {
      throw new BadInput('towards_creature', `${creature} has no position to aim at`);
    }
    return { x: at.x, y: at.y, z: at.z };
  }
  const landmark = optStr(input, 'towards_landmark');
  if (landmark !== undefined) {
    const at = state.scene?.landmarks[landmark];
    if (at === undefined) throw new BadInput('towards_landmark', `no landmark called ${landmark}`);
    return { x: at.x, y: at.y, z: at.z };
  }
  if (input['towards'] === undefined) return undefined;
  return pointFrom(obj(input['towards']));
}

/**
 * What the attempt leans on, for the two conditions that read it.
 *
 * Absent means nobody has said, which is the honest third value: the engine
 * applies no automatic failure rather than deciding for itself that shoving a
 * door is a sight-dependent act.
 */
function sensesFrom(input: Record<string, unknown>): {
  senses?: { requiresSight?: boolean; requiresHearing?: boolean };
} {
  const sight = input['requires_sight'];
  const hearing = input['requires_hearing'];
  if (sight !== true && hearing !== true) return {};
  return {
    senses: {
      ...(sight === true ? { requiresSight: true } : {}),
      ...(hearing === true ? { requiresHearing: true } : {}),
    },
  };
}

function pointFrom(at: Record<string, unknown>): { x: number; y: number; z: number } {
  return { x: num(at, 'x'), y: num(at, 'y'), z: optNum(at, 'z') ?? 0 };
}

/**
 * A placement, which is always relative to something already established.
 *
 * The model never types a raw coordinate for a creature — `CLAUDE.md` is
 * explicit that a position appearing that nobody chose is the failure mode
 * this whole design exists to prevent. A landmark is the one thing that does
 * carry coordinates, because something has to anchor the room.
 */
function placementFrom(
  state: GameState,
  input: Record<string, unknown>,
): {
  from: { landmark: string } | { creature: CharacterId };
  feet: number;
  bearing?: number;
  size?: CreatureSize;
} {
  const landmark = optStr(input, 'from_landmark');
  const creature = optStr(input, 'from_creature');
  if (landmark === undefined && creature === undefined) {
    throw new BadInput('from_landmark', 'a placement needs from_landmark or from_creature');
  }
  const bearing = optNum(input, 'bearing');
  // **Size is looked up, not asked for.** An Ogre is Large and the SRD says so;
  // a surface that made the DM restate it would be asking for a fact content
  // already holds, which is the failure this whole pass exists to close. The
  // caller may still override — an authored creature has no stat block, and a
  // DM may want a particularly enormous goblin.
  const stated = optStr(input, 'size');
  const subject = optStr(input, 'who');
  const known =
    subject === undefined ? null : monsterNamed(state.creatures[subject]?.name ?? '')?.size ?? null;
  const size = (stated ?? known) as CreatureSize | null;
  return {
    from: landmark !== undefined ? { landmark } : { creature: asCharacterId(creature!) },
    feet: num(input, 'feet'),
    ...(bearing === undefined ? {} : { bearing }),
    ...(size === null || size === undefined ? {} : { size }),
  };
}

// — the schemas the model is shown ————————————————————————————————————————

const field = (type: string, description: string) => ({ type, description });
const COMMAND_ID = field(
  'string',
  'A unique id you choose for this command. Reusing it makes a retry a no-op instead of a second action. Never reuse one for different work.',
);

const NARRATION = field(
  'string',
  'What the players hear, said in the same breath as the action. Saves a round trip; changes nothing. Describe only what the engine reported.',
);

const schema = (
  properties: Record<string, unknown>,
  required: readonly string[],
): Record<string, unknown> => ({
  type: 'object',
  properties,
  required: [...required],
  additionalProperties: false,
});

const DEFINED: readonly ToolSpec[] = [
  {
    name: 'look',
    description:
      'Read the authoritative state without changing anything. Free. Every other tool already returns this same state, so you rarely need it.',
    parameters: schema({}, []),
    mutating: false,
  },
  {
    name: 'options',
    description:
      'What a creature may do right now: whether it may act at all, which Reactions are open to it, and which checks an ongoing effect offers it. Free, changes nothing.',
    parameters: schema({ who: field('string', 'Creature id.') }, ['who']),
    mutating: false,
  },
  {
    name: 'eligible_targets',
    description:
      'The shortlist of creatures a spell could legally be aimed at, with a reason for everyone left off it. Free, changes nothing. This is a shortlist, not a choice: you still name the target you meant.',
    parameters: schema(
      {
        caster: field('string', 'Creature id of the caster.'),
        spell_id: field('string', 'SRD spell id, e.g. hold-person.'),
        slot_level: field('number', 'Slot level, if a levelled spell.'),
      },
      ['caster', 'spell_id'],
    ),
    mutating: false,
  },
  {
    name: 'set_scene',
    description: 'Declare the room the fight happens in, in feet. Needed before anybody can be placed.',
    parameters: schema(
      { width: field('number', 'Feet.'), depth: field('number', 'Feet.'), height: field('number', 'Feet.') },
      ['width', 'depth', 'height'],
    ),
    mutating: true,
  },
  {
    name: 'add_landmark',
    description:
      'Name a fixed feature of the room and where it is. Landmarks are what creatures are placed relative to, so a scene needs at least one.',
    parameters: schema(
      {
        name: field('string', 'What it is called, e.g. "the bar".'),
        x: field('number', 'Feet from the west wall.'),
        y: field('number', 'Feet from the south wall.'),
        z: field('number', 'Feet above the floor. Defaults to 0.'),
      },
      ['name', 'x', 'y'],
    ),
    mutating: true,
  },
  {
    name: 'place_creature',
    description:
      'Put a creature into the scene, relative to a landmark or another creature. Use this the first time a creature needs a position. A creature that already has one must move instead.',
    parameters: schema(
      {
        who: field('string', 'Creature id.'),
        from_landmark: field('string', 'Landmark to measure from.'),
        from_creature: field('string', 'Creature to measure from.'),
        feet: field('number', 'How far from it.'),
        bearing: field('number', 'Degrees clockwise from north. 0 is north, 90 is east.'),
        size: field(
          'string',
          'tiny, small, medium, large, huge or gargantuan. Only needed for a creature you authored — an SRD creature’s size comes from its stat block.',
        ),
      },
      ['who', 'feet'],
    ),
    mutating: true,
  },
  {
    name: 'declare_sight',
    description:
      'State whether one creature can see another. Nobody having said is different from "no", and some spells need it said.',
    parameters: schema(
      {
        from: field('string', 'Creature id doing the looking.'),
        to: field('string', 'Creature id being looked at.'),
        seen: field('boolean', 'True if it can be seen.'),
      },
      ['from', 'to', 'seen'],
    ),
    mutating: true,
  },
  {
    name: 'declare_cover',
    description:
      'Declare how much cover one creature has from another — the bar it is crouched behind, the millstone between them. The engine applies exactly what the SRD prints (+2 Armour Class and Dexterity saves for Half, +5 for Three-Quarters, cannot be targeted at all through Total) and never works cover out from geometry, because that would mean modelling every wall. Declaring it is your job; applying it is the engine’s. Use ‘none’ to say the line is clear again.',
    parameters: schema(
      {
        from: field('string', 'The attacker’s creature id — whose line to the target this is about.'),
        to: field('string', 'The creature taking cover.'),
        degree: {
          type: 'string',
          enum: ['none', 'half', 'three-quarters', 'total'],
          description: 'How much of the target is shielded.',
        },
      },
      ['from', 'to', 'degree'],
    ),
    mutating: true,
  },
  {
    name: 'settle_area_effects',
    description:
      'Settle what a persistent area — a Grease, a Web, an Insect Plague — has caught somebody doing. The engine rolls the save, reads the DC off the casting and applies whatever the spell says; you supply nothing but the instruction to do it now. Until this is called, every other action refuses with `area_effect_owed`, including ending the turn, so call it as soon as the state shows any owed.',
    parameters: schema({ command_id: COMMAND_ID }, ['command_id']),
    mutating: true,
  },
  {
    name: 'attempt_effect_check',
    description:
      'Attempt a check a running spell offers against its own effect — the Investigation that sees through an illusion, the Athletics that tears free of Black Tentacles. `options` lists what is available and gives each one its effect_key. Costs the Action in combat. The Difficulty Class was written down when the effect was created and is not yours to set here.',
    parameters: schema(
      {
        who: field('string', 'Creature id making the attempt.'),
        effect_key: field('string', 'From `options`, which reports checks_available.'),
        requires_sight: field(
          'boolean',
          'True when this attempt cannot be made without seeing — Minor Illusion makes a sound *or* an image, so which it is depends on the illusion.',
        ),
        requires_hearing: field('boolean', 'True when the attempt cannot be made without hearing.'),
        command_id: COMMAND_ID,
      },
      ['who', 'effect_key', 'command_id'],
    ),
    mutating: true,
  },
  {
    name: 'declare_creature_type',
    description:
      'State what kind of creature something is — Humanoid, Fey, Undead. Some spells only touch one type. A type can only be declared once and cannot be changed afterwards, so declare what the creature actually is, not what would be convenient.',
    parameters: schema(
      {
        who: field('string', 'Creature id.'),
        creature_type: field('string', 'e.g. Humanoid, Fey, Beast, Undead.'),
        command_id: COMMAND_ID,
      },
      ['who', 'creature_type', 'command_id'],
    ),
    mutating: true,
  },
  {
    name: 'spawn_srd_creature',
    description:
      'Bring an SRD creature into the world from its stat block. Its creature type, Armour Class, hit points, Initiative, abilities, defences and weapons all come from the published stat block — you do not supply them and cannot override them. Use this for anything the SRD prints.',
    parameters: schema(
      {
        monster_id: field('string', 'SRD slug, e.g. goblin-warrior, ogre, wolf.'),
        as: field('string', 'The id this creature will have in play, e.g. goblin-a.'),
        side: field('string', 'Which side it fights on, e.g. party or monsters.'),
        narration: NARRATION,
      },
      ['monster_id', 'as'],
    ),
    mutating: true,
  },
  {
    name: 'author_creature',
    description:
      'Invent a creature the SRD does not contain, and define it. You are the DM: its type, hit points, Armour Class, abilities, size and Speed are yours to choose. Once created they become established truth that later resolution reads and nothing may contradict — so state what the creature actually is.',
    parameters: schema(
      {
        as: field('string', 'The id this creature will have in play.'),
        name: field('string', 'What it is called.'),
        creature_type: field('string', 'Aberration, Beast, Fey, Fiend, Giant, Humanoid, Undead, ...'),
        max_hp: field('number', 'Hit point maximum.'),
        armor_class: field('number', 'Armour Class.'),
        speed: field('number', 'Walking Speed in feet.'),
        proficiency_bonus: field('number', 'Defaults to +2.'),
        abilities: {
          type: 'object',
          description: 'The six ability scores.',
          properties: {
            str: { type: 'number' }, dex: { type: 'number' }, con: { type: 'number' },
            int: { type: 'number' }, wis: { type: 'number' }, cha: { type: 'number' },
          },
          required: ['str', 'dex', 'con', 'int', 'wis', 'cha'],
        },
        side: field('string', 'Which side it fights on.'),
        narration: NARRATION,
      },
      ['as', 'name', 'creature_type', 'max_hp', 'armor_class', 'speed', 'abilities'],
    ),
    mutating: true,
  },
  {
    name: 'give_item',
    description:
      'Give a creature something from the SRD equipment catalogue. A creature cannot attack with a weapon it does not have.',
    parameters: schema(
      {
        who: field('string', 'Creature id.'),
        item_id: field('string', 'Catalogue id, e.g. scimitar, shortbow, dagger.'),
        quantity: field('number', 'Defaults to 1.'),
        ruling: field('string', 'Where it came from, for the log.'),
        command_id: COMMAND_ID,
        narration: NARRATION,
      },
      ['who', 'item_id', 'command_id'],
    ),
    mutating: true,
  },
  {
    name: 'improvised_damage',
    description:
      'Deal damage you have ruled, for something the rules do not model — a falling chandelier, a thrown bar stool, a shove into a hearth. You choose the DICE and the damage type; the engine rolls them and applies resistances and hit points. Never state an amount of damage: say 1d4, not 4.',
    parameters: schema(
      {
        target: field('string', 'Creature id taking the damage.'),
        dice: field('string', 'Dice notation you are ruling, e.g. 1d4, 2d6, 1d8+2.'),
        damage_type: field('string', 'e.g. bludgeoning, fire, piercing.'),
        ruling: field('string', 'Why, in one phrase. Recorded in the log as the source.'),
        by: field('string', 'Creature id that caused it, if one did.'),
        command_id: COMMAND_ID,
        narration: NARRATION,
      },
      ['target', 'dice', 'damage_type', 'ruling', 'command_id'],
    ),
    mutating: true,
  },
  {
    name: 'apply_ruled_condition',
    description:
      'Apply an SRD condition as the consequence of a ruling you have made — Prone after a failed Acrobatics check, Frightened after a failed save. The engine handles what the condition implies and how it interacts with everything else.',
    parameters: schema(
      {
        who: field('string', 'Creature id.'),
        condition: field('string', 'An SRD condition, e.g. prone, frightened, restrained.'),
        ruling: field('string', 'Why, in one phrase. Recorded in the log as the source.'),
        command_id: COMMAND_ID,
        narration: NARRATION,
      },
      ['who', 'condition', 'ruling', 'command_id'],
    ),
    mutating: true,
  },
  {
    name: 'cast_spell',
    description:
      'Cast a spell. The engine derives everything mechanical: the save DC, the attack modifier, the damage dice, the condition, the duration. You name the spell, the targets and the slot. An area spell takes no targets and picks its own: give it `at` for where it is centred, and — for a Cone, Cube or Line — a `towards_creature`, `towards_landmark` or `towards` saying which way it points.',
    parameters: schema(
      {
        caster: field('string', 'Creature id.'),
        spell_id: field('string', 'SRD spell id, e.g. fire-bolt, hold-person, magic-missile.'),
        targets: { type: 'array', items: { type: 'string' }, description: 'Creature ids. Empty for an area spell.' },
        slot_level: field('number', 'Which slot to spend. Omit for a cantrip.'),
        at: {
          type: 'object',
          description:
            'Where an area spell is centred, for a spell that asks for a point. x and y are required; z defaults to the floor.',
          properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } },
          required: ['x', 'y'],
        },
        towards_creature: field(
          'string',
          'Point a Cone, Cube or Line at this creature. Use this, a landmark, or an explicit point — a directional area is refused without one.',
        ),
        towards_landmark: field('string', 'Point a Cone, Cube or Line at this landmark instead.'),
        towards: {
          type: 'object',
          description: 'Point a Cone, Cube or Line at this exact spot, if no creature or landmark says it better.',
          properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } },
          required: ['x', 'y'],
        },
        command_id: COMMAND_ID,
      },
      ['caster', 'spell_id', 'targets', 'command_id'],
    ),
    mutating: true,
  },
  {
    name: 'attack',
    description:
      'Attack with a weapon. The engine derives the target Armour Class, reach, advantage, proficiency, damage and the target’s defences.',
    parameters: schema(
      {
        attacker: field('string', 'Creature id.'),
        target: field('string', 'Creature id.'),
        weapon: field('string', 'Catalogue id, e.g. scimitar, dagger, quarterstaff. Omit for an Unarmed Strike.'),
        thrown: field(
          'boolean',
          'True when a Melee-or-Ranged weapon is being thrown rather than swung — a Javelin, a Dagger, a Handaxe. Changes which range the engine measures against.',
        ),
        command_id: COMMAND_ID,
      },
      ['attacker', 'target', 'command_id'],
    ),
    mutating: true,
  },
  {
    name: 'move',
    description: 'Move a creature, spending its movement. Always relative to a landmark or another creature.',
    parameters: schema(
      {
        who: field('string', 'Creature id.'),
        from_landmark: field('string', 'Landmark to measure from.'),
        from_creature: field('string', 'Creature to measure from.'),
        feet: field('number', 'How far from it to end up.'),
        bearing: field('number', 'Degrees clockwise from north.'),
        forced: field(
          'boolean',
          'True when somebody is moving them rather than them walking — a shove, a gust, a trap. Costs them no Speed and provokes no Opportunity Attacks. This is how you apply a push you have ruled.',
        ),
        size: field('string', 'Creature size, if it is not the one the stat block prints.'),
        command_id: COMMAND_ID,
        narration: NARRATION,
      },
      ['who', 'feet', 'command_id'],
    ),
    mutating: true,
  },
  {
    name: 'take_opportunity_attack',
    description:
      'Take the Opportunity Attack a creature�s move offered you. The mover is held where it was until every creature offered one has answered, and nothing else can happen until then.',
    parameters: schema(
      {
        attacker: field('string', 'Creature id taking the Reaction.'),
        weapon: field('string', 'Catalogue id. Omit for an Unarmed Strike.'),
        command_id: COMMAND_ID,
      },
      ['attacker', 'command_id'],
    ),
    mutating: true,
  },
  {
    name: 'decline_opportunity',
    description:
      'Decline the Opportunity Attack a move offered you. The move completes once every creature offered one has answered, so declining is how a held move gets unstuck.',
    parameters: schema(
      { attacker: field('string', 'Creature id declining.'), command_id: COMMAND_ID },
      ['attacker', 'command_id'],
    ),
    mutating: true,
  },
  {
    name: 'take_action',
    description: 'Take Dodge, Dash or Disengage.',
    parameters: schema(
      {
        who: field('string', 'Creature id.'),
        kind: { type: 'string', enum: ['dodge', 'dash', 'disengage'], description: 'Which action.' },
        command_id: COMMAND_ID,
      },
      ['who', 'kind', 'command_id'],
    ),
    mutating: true,
  },
  {
    name: 'ability_check',
    description:
      'Call for an ability check or a saving throw and let the engine roll it. You set the ability, the skill and the Difficulty Class — that is the DM’s job — and the engine supplies the creature’s real modifier, throws the die and decides whether it succeeded. This is how you adjudicate anything the rules do not cover: swinging from a chandelier is Acrobatics against a DC you choose.',
    parameters: schema(
      {
        who: field('string', 'Creature id.'),
        kind: { type: 'string', enum: ['ability-check', 'saving-throw'], description: 'Which sort of roll.' },
        ability: {
          type: 'string',
          enum: ['str', 'dex', 'con', 'int', 'wis', 'cha'],
          description: 'Which ability.',
        },
        skill: field('string', 'Skill id, e.g. athletics, if one applies.'),
        dc: field('number', 'The Difficulty Class you are setting.'),
        label: field('string', 'What the roll is for, for the log.'),
        requires_sight: field(
          'boolean',
          'True when the attempt cannot be made without seeing — reading an inscription, spotting a seam. A Blinded creature fails one of these outright.',
        ),
        requires_hearing: field('boolean', 'True when the attempt cannot be made without hearing.'),
        command_id: COMMAND_ID,
      },
      ['who', 'kind', 'ability', 'dc', 'command_id'],
    ),
    mutating: true,
  },
  {
    name: 'end_turn',
    description:
      'End the current creature’s turn and advance the order. The engine raises and rolls whatever the boundary owes. It refuses while a debt is outstanding.',
    parameters: schema({ command_id: COMMAND_ID }, ['command_id']),
    mutating: true,
  },
  {
    name: 'narrate',
    description:
      'Say what happened, in prose, for the players. Changes nothing. Describe only what the engine actually reported — never state a number the engine did not give you.',
    parameters: schema({ text: field('string', 'What the players hear.') }, ['text']),
    mutating: false,
  },
];

/**
 * Every mutating tool may carry narration, without each schema saying so.
 *
 * Done once here rather than thirteen times above, so a tool added later
 * cannot forget it and quietly cost the DM an extra round trip.
 */
export const TOOLS: readonly ToolSpec[] = DEFINED.map((tool) => {
  if (!tool.mutating) return tool;
  const params = tool.parameters as { properties: Record<string, unknown>; required: string[] };
  if (params.properties['narration'] !== undefined) return tool;
  return {
    ...tool,
    parameters: { ...params, properties: { ...params.properties, narration: NARRATION } },
  };
});

export const TOOL_NAMES: readonly string[] = TOOLS.map((t) => t.name);
export const MUTATING_TOOLS: ReadonlySet<string> = new Set(
  TOOLS.filter((t) => t.mutating).map((t) => t.name),
);
