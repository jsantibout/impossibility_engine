/**
 * A surface's tools as JSON Schema, and as an OpenAI function-calling list.
 *
 * `ToolDefinition.schema` has always carried the Zod schema "for a caller that
 * wants to publish it as JSON Schema". Every caller that wanted to wrote the
 * conversion itself — the probe's OpenAI driver hand-writes its `parameters`,
 * field for field — and a hand-written copy of a schema is a copy that goes
 * stale the first time the schema moves. This is the conversion, done once and
 * derived from the surface, so an app publishes what the surface really
 * validates rather than what somebody transcribed.
 *
 * It holds no rules and no list: the tools come from the `Surface` handed in,
 * in the surface's own order, which is the stable sorted order the prompt
 * cache rests on. A surface this package will not build cannot be published
 * through here, because there is no way to hand one in.
 *
 * **Two deliberate departures from what `z.toJSONSchema` emits**, both in
 * {@link publishable}:
 *
 * - `$schema` is dropped. It declares a dialect, and an API reading a
 *   `parameters` object is not choosing one.
 * - `Number.MAX_SAFE_INTEGER` bounds are dropped. Zod writes them for every
 *   `.int()`, which is dozens of fields across these two surfaces; they say
 *   nothing a caller could act on and some APIs reject them outright. A bound
 *   somebody actually wrote — a level between 1 and 20 — is not this number
 *   and survives.
 *
 * **And these are not strict-mode schemas.** OpenAI's strict function calling
 * requires every object to be closed and every property required; three
 * `z.record()` fields inside `create_character`'s choices cannot satisfy that
 * without rewriting the schema they validate, and rewriting a validator to
 * suit a transport is a decision this file is not the place for. A caller
 * that wants strict mode asks for the rewrite first.
 */

import { z } from 'zod';
import type { Surface } from './dispatch.js';

/** One tool, in the shape an API's function list wants its members. */
export interface ToolSchema {
  readonly name: string;
  readonly description: string;
  /** JSON Schema for the tool's arguments. Always an object schema. */
  readonly parameters: Record<string, unknown>;
}

/** The envelope OpenAI's chat-completions API wraps each function in. */
export interface OpenAiTool {
  readonly type: 'function';
  readonly function: ToolSchema;
}

/**
 * The smallest thing this can be handed, so a test may hand it a list.
 *
 * Not `Surface` itself: nothing here calls, observes or looks for a door, and
 * a parameter that asks for more than it reads invites a caller to believe it
 * does more than it does.
 */
export type Published = Pick<Surface, 'tools'>;

/** What Zod writes for `.int()`, and what nothing else should be writing. */
const UNBOUNDED = Number.MAX_SAFE_INTEGER;

/**
 * The emitted schema, minus what an API would reject or a model would read as
 * a fact about the game.
 */
function publishable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(publishable);
  if (value === null || typeof value !== 'object') return value;
  const kept: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    if (key === '$schema') continue;
    if ((key === 'maximum' || key === 'exclusiveMaximum') && inner === UNBOUNDED) continue;
    if ((key === 'minimum' || key === 'exclusiveMinimum') && inner === -UNBOUNDED) continue;
    kept[key] = publishable(inner);
  }
  return kept;
}

/**
 * Every tool on a surface, as JSON Schema.
 *
 * `io: 'input'` is the side that matters: these schemas describe what a caller
 * sends, and a schema with defaults applied describes what the validator hands
 * on instead.
 */
export function toolSchemas(surface: Published): readonly ToolSchema[] {
  return surface.tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: publishable(z.toJSONSchema(tool.schema, { io: 'input' })) as Record<
      string,
      unknown
    >,
  }));
}

/** The same list, each member wrapped in the function-calling envelope. */
export function openAiTools(surface: Published): readonly OpenAiTool[] {
  return toolSchemas(surface).map((schema) => ({ type: 'function', function: schema }));
}
