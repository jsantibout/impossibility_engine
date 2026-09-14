/**
 * Who is playing the DM, behind one small interface.
 *
 * Two implementations, and the second is not a convenience: a scripted driver
 * is what lets the harness itself be tested offline and in CI, and it is what
 * proves the instrumentation and the replay guarantee without a network call.
 * An experiment whose apparatus is only exercised by the experiment has not
 * been calibrated.
 *
 * The interface is deliberately provider-shaped rather than OpenAI-shaped —
 * hand it a beat, get back some tool calls; hand it the results, get back the
 * next ones — so the same scenario can be run against a different model family
 * later without touching the surface, the fixture or the metrics. That is an
 * experimental control, not speculative architecture: two drivers exist today.
 */

import { readFileSync } from 'node:fs';
import type { CharacterId } from '@ie/shared';
import {
  carrying,
  distanceBetween,
  footprintOf,
  itemFor,
  movementLeftFor,
  type GameState,
} from '@ie/engine';
import type { Encounter } from './encounter.js';
import type { ToolSpec } from './surface.js';

export interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
}

export interface DriverTurn {
  readonly calls: readonly ToolCall[];
  readonly text: string;
  readonly ms: number;
  readonly promptTokens: number | null;
  readonly completionTokens: number | null;
  readonly cachedTokens: number | null;
  readonly stopReason: string | null;
}

export interface ToolReply {
  readonly id: string;
  readonly content: string;
}

export interface ModelDriver {
  readonly name: string;
  /** A new beat: the player says something, or a monster's turn comes round. */
  beat(prompt: string, state: GameState): Promise<DriverTurn>;
  /**
   * The results of the calls it just made.
   *
   * `resume` is false when the beat is over — the turn ended — and the results
   * are being handed over for the record rather than for another response.
   * **Every call must be answered even then.** A tool call left unanswered is
   * a malformed conversation, and the provider rejects the *next* request with
   * an error about a message eleven turns back. That is a harness bug this
   * experiment hit on its first live run, and the shape of the interface is
   * what prevents it recurring: there is no way to dispatch a call and forget
   * to deliver its result.
   */
  replies(
    replies: readonly ToolReply[],
    state: GameState,
    resume: boolean,
  ): Promise<DriverTurn>;
}

/** Nothing was asked of the model, so nothing came back. */
const silence = (): DriverTurn => ({
  calls: [],
  text: '',
  ms: 0,
  promptTokens: null,
  completionTokens: null,
  cachedTokens: null,
  stopReason: null,
});

// — the system prompt ————————————————————————————————————————————————————————

/**
 * The authority boundary, stated to the model in the fewest words that say it.
 *
 * Frozen: no date, no session id, no player name, nothing that would change
 * between runs. That is a caching requirement and, more importantly here, an
 * experimental one — two runs must differ only in what the model does.
 */
export const SYSTEM_PROMPT = `You are the Dungeon Master of a D&D 2024 (SRD 5.2.1) encounter, running it through a rules engine.

You own the world and the judgement. The engine owns the mechanics.

WHAT THE ENGINE OWNS — never guess at any of it, and never try to talk it out of one:
Dice, hit points, Armour Class, modifiers, resources, positions, conditions, timing, and what the SRD prints. If the engine already knows a fact, it is in the state you are given. You do not supply it and you cannot change it by saying otherwise.

WHAT YOU OWN — do this freely, it is the job:
- The world. Invent creatures, name landmarks, decide what is in the room. author_creature lets you define something the SRD has never heard of, and once you have defined it the engine treats your definition as truth.
- Judgement. When a player does something the rules do not cover, RULE ON IT. Do not refuse a player because no specific command exists.

HOW TO RULE ON SOMETHING NOVEL. A player says "I swing from the chandelier and kick the cultist off the balcony." There is no chandelier rule. So you decide: that is Acrobatics, DC 14. Then you compose it from primitives:
- ability_check — you choose the ability, the skill and the DC; the engine supplies the character's real modifier and rolls.
- improvised_damage — you choose the DICE and the damage type ("1d4 bludgeoning" for a bar stool); the engine rolls them and applies them. Say 1d4, never say 4.
- apply_ruled_condition — you decide that a failed swing means falling Prone; the engine works out what Prone implies.
- move with forced: true — you decide the cultist is flung backwards; the engine works out where a body can actually end up.
Combine these however the situation needs. There is no command for chandeliers and there does not need to be one.

THE ONE THING YOU MAY NOT DO: produce a number that decides an outcome. You may set a DC, author a monster's hit points, and rule that something deals 2d6 — those are a DM's calls. You may not say how much damage was dealt, what a die showed, or whether a save succeeded. The engine decides those and tells you.

THE ENGINE ANSWERS IN THREE WAYS:
- "ok" — it happened. The result says what.
- "refused" — the rules say no under facts already established. Find another way or narrate the failure. Do not retry it unchanged.
- "needs-context" — the engine has not been told some fact about the world. It names what is missing and which tool establishes it. Establish it and repeat your original call. This costs nothing and is not an error.

PRACTICALITIES:
- Every mutating tool takes a command_id you choose. Fresh for each distinct action; reuse the same one only when retrying an identical action after a transport problem.
- Every mutating tool takes an optional "narration" field. Use it: put what the players hear in the same call as the action instead of making a separate narrate call.
- Every result carries the current authoritative state, so you rarely need to ask for it.
- Work turn by turn. Take the creature's action, then end_turn. Describe only what the engine actually reported.`;

// — a driver that plays without a model ————————————————————————————————————

/**
 * A deterministic stand-in that plays the fight competently and makes exactly
 * one mistake on purpose.
 *
 * It is **not** a model simulator and no measurement taken from it says
 * anything about a real model. Its job is to drive every branch of the surface
 * — a cast, an attack, a refusal, a turn boundary — so the harness, the
 * recorder and the replay guarantee are exercised by `npm test` on a machine
 * with no API key. The deliberate mistake is the round-1 Hold Person, which
 * the engine refuses because a 2024 Goblin Warrior is Fey.
 */
export function createScriptedDriver(
  encounter: Encounter,
  casters: ReadonlySet<CharacterId>,
): ModelDriver {
  let step = 0;
  let triedHoldPerson = false;

  /** Whoever is on a side this creature is not on. Apparatus, not tactics. */
  const opponentsOf = (who: CharacterId): readonly CharacterId[] =>
    encounter.sides.filter((side) => !side.includes(who)).flat();

  const living = (state: GameState, who: CharacterId): CharacterId[] =>
    opponentsOf(who).filter((g) => {
      const c = state.creatures[g];
      return c !== undefined && !c.vitals.dead && c.vitals.hp > 0;
    });

  /**
   * The first thing in a creature's pack that is actually a weapon.
   *
   * `resolveAttack` refuses a weapon its wielder does not own, so the stand-in
   * reads the inventory rather than naming one. That is also what lets the same
   * eight lines drive a goblin with a scimitar, a Fighter with a greatsword and
   * an Ogre with a greatclub without learning any of their names.
   */
  const weaponOf = (state: GameState, who: CharacterId): string | null =>
    carrying(state, who)
      .map((line) => line.id)
      .find((id) => {
        const item = itemFor(id);
        return item !== null && item.weapon !== null && item.weapon !== undefined;
      }) ?? null;

  const turn = (calls: readonly ToolCall[]): DriverTurn => ({
    calls,
    text: '',
    ms: 0,
    promptTokens: null,
    completionTokens: null,
    cachedTokens: null,
    stopReason: calls.length === 0 ? 'stop' : 'tool_calls',
  });

  /**
   * One call, decided from the state as it now stands.
   *
   * Reactive rather than planned, because the refusal it is here to exercise —
   * Hold Person on a Fey goblin — has to be *recovered from*, and a plan
   * computed before the refusal cannot recover from it.
   */
  const decide = (state: GameState): readonly ToolCall[] => {
    const combat = state.combat;
    const active = combat?.order[combat.turnIndex]?.id ?? null;
    if (active === null) return [];

    const call = (name: string, input: Record<string, unknown>): ToolCall => {
      step += 1;
      return { id: `call-${step}`, name, input: { ...input, command_id: `c${step}` } };
    };
    const endTurn = () => [call('end_turn', {})];

    const me = state.creatures[active];
    if (me === undefined || me.vitals.dead) return endTurn();
    if (me.conditions.conditions.includes('incapacitated')) return endTurn();

    const budget = combat?.budgets[active];
    if (budget === undefined || !budget.action) return endTurn();

    const target = living(state, active)[0];
    if (target === undefined) return endTurn();

    if (casters.has(active)) {
      // The deliberate mistake, made once: a 2024 Goblin Warrior is Fey, so
      // the engine refuses, and the next exchange has to find another action.
      if (!triedHoldPerson) {
        triedHoldPerson = true;
        return [
          call('cast_spell', {
            caster: active,
            spell_id: 'hold-person',
            targets: [target],
            slot_level: 2,
          }),
        ];
      }
      return [call('cast_spell', { caster: active, spell_id: 'fire-bolt', targets: [target] })];
    }

    // Five feet of reach and further away than that, so it closes first.
    // Without this the stand-in would never exercise `move` and would collect
    // nothing but `out_of_reach`.
    const scene = state.scene;
    const apart = scene === null ? null : distanceBetween(scene, active, target);
    const feetAway = apart !== null && apart.ok ? apart.value : null;
    const movement = movementLeftFor(state, active) ?? 0;
    if (feetAway !== null && feetAway > 5 && movement >= feetAway - 5) {
      const side = encounter.sides.find((s) => s.includes(active)) ?? [];
      // A placement is measured from the target's *anchor*, and a creature
      // occupies volume from that anchor outward — so standing five feet from
      // a Large creature's anchor is standing inside it, and the engine says
      // `occupied`. The Tier 1 goblins never found this out because everything
      // in that fight was Medium and a Medium footprint is five feet.
      const width = footprintOf(scene?.sizes[target] ?? 'medium');
      return [
        call('move', {
          who: active,
          from_creature: target,
          feet: width,
          bearing: side.indexOf(active) === 0 ? 0 : 90,
        }),
      ];
    }
    const weapon = weaponOf(state, active);
    if (weapon === null) return endTurn();
    return [call('attack', { attacker: active, target, weapon })];
  };

  return {
    name: 'scripted',
    async beat(_prompt, state) {
      return turn(decide(state));
    },
    async replies(_replies, state, resume) {
      return resume ? turn(decide(state)) : silence();
    },
  };
}

// — the OpenAI driver ————————————————————————————————————————————————————————

/**
 * Read `OPENAI_API_KEY` from the environment, or from the repo's gitignored
 * `.env`.
 *
 * The file is the practical path on Windows: a variable exported into one
 * terminal does not reach a process that was started from another, and this
 * probe is usually started by something else.
 */
export function readApiKey(envPath: string): string | null {
  const fromEnv = process.env['OPENAI_API_KEY'];
  if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv;
  try {
    for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const match = /^\s*(?:export\s+)?OPENAI_API_KEY\s*=\s*(.*)$/.exec(line);
      if (match) return match[1]!.trim().replace(/^["']|["']$/g, '');
    }
  } catch {
    // No .env is an ordinary state, not a failure.
  }
  return null;
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

/**
 * Drive the fight with a real model over the Chat Completions tool interface.
 *
 * A manual loop rather than a framework: the experiment needs per-call
 * latency, per-turn token counts and a transcript it can replay, and the
 * cheapest way to have all three is to own the loop. Nothing here is an
 * orchestration layer and none of it should become one.
 */
export function createOpenAiDriver(options: {
  readonly apiKey: string;
  readonly model: string;
  readonly tools: readonly ToolSpec[];
  readonly baseUrl?: string;
}): ModelDriver {
  // Imported lazily so the probe runs offline with the scripted driver even if
  // the package is absent.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let client: any = null;

  const messages: ChatMessage[] = [{ role: 'system', content: SYSTEM_PROMPT }];
  const tools = options.tools.map((t) => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));

  async function send(): Promise<DriverTurn> {
    if (client === null) {
      const { default: OpenAI } = await import('openai');
      client = new OpenAI({
        apiKey: options.apiKey,
        ...(options.baseUrl === undefined ? {} : { baseURL: options.baseUrl }),
      });
    }
    const started = Date.now();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response: any = await client.chat.completions.create({
      model: options.model,
      messages,
      tools,
      tool_choice: 'auto',
    });
    const ms = Date.now() - started;

    const choice = response.choices?.[0];
    const message = choice?.message ?? {};
    const rawCalls: { id: string; function: { name: string; arguments: string } }[] =
      message.tool_calls ?? [];

    messages.push({
      role: 'assistant',
      content: message.content ?? null,
      ...(rawCalls.length === 0
        ? {}
        : {
            tool_calls: rawCalls.map((c) => ({
              id: c.id,
              type: 'function' as const,
              function: { name: c.function.name, arguments: c.function.arguments },
            })),
          }),
    });

    const calls: ToolCall[] = rawCalls.map((c) => ({
      id: c.id,
      name: c.function.name,
      // A model's arguments are JSON text and may not parse. That is a
      // malformed call, which is a measurement, not a crash.
      input: parseArguments(c.function.arguments),
    }));

    return {
      calls,
      text: typeof message.content === 'string' ? message.content : '',
      ms,
      promptTokens: response.usage?.prompt_tokens ?? null,
      completionTokens: response.usage?.completion_tokens ?? null,
      cachedTokens: response.usage?.prompt_tokens_details?.cached_tokens ?? null,
      stopReason: choice?.finish_reason ?? null,
    };
  }

  return {
    name: options.model,
    async beat(prompt) {
      messages.push({ role: 'user', content: prompt });
      return send();
    },
    async replies(replies, _state, resume) {
      // Recorded whether or not another response is wanted: an unanswered
      // tool call poisons every later request in the conversation.
      for (const reply of replies) {
        messages.push({ role: 'tool', tool_call_id: reply.id, content: reply.content });
      }
      return resume ? send() : silence();
    },
  };
}

function parseArguments(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return { __unparseable: raw };
  }
}
