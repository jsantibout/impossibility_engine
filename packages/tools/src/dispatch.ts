/**
 * One name, some arguments, one of four outcomes — the mechanism, with no
 * opinion about which tools it is over.
 *
 * This was the body of `createSurface` until there were two surfaces to
 * build. Hoisting it is what keeps the two factories honest: **neither takes
 * a tool list**, so a caller cannot make a model's surface that holds a DM's
 * tool by passing one, and the choice between the two doors is the door you
 * import rather than an argument you fill in. `createDispatch` is deliberately
 * not on the package's barrel — `dm/boundary.test.ts` asserts that — because a
 * published builder over an arbitrary list is the flag this design exists
 * instead of.
 *
 * It never throws for anything a caller could have sent: an unknown tool,
 * malformed arguments, a rules refusal and a missing fact are all *values*,
 * which is invariant 6 carried up one layer. An exception escaping here is a
 * programmer error in this package and should be read as one.
 *
 * It holds no state of its own. The {@link Campaign} holds the log; this is a
 * dispatch table over it, so two surfaces over one campaign are one campaign.
 */

import type { Campaign } from './campaign.js';
import type { ToolDefinition } from './definitions.js';
import type { ContextRequestKind, ToolOutcome } from './outcome.js';
import { invalid } from './outcome.js';
import { observe, type Observation } from './observe.js';

export interface ToolCall {
  /** Which tool. */
  readonly tool: string;
  /** Its arguments, exactly as they arrived. Validated, never trusted. */
  readonly input: unknown;
  /**
   * The transport's `tool_use.id`.
   *
   * Required, and deliberately not something the caller's arguments may
   * carry: it is the idempotency key, and a caller that chose its own could
   * choose a fresh one on a retry — which is precisely the failure the key
   * exists to absorb.
   */
  readonly commandId: string;
}

export interface Surface {
  /** Every tool, in the stable sorted order the prompt cache depends on. */
  readonly tools: readonly ToolDefinition[];
  /** Which tools declare that they establish a given `ContextRequest.kind`. */
  doorsFor(kind: ContextRequestKind): readonly string[];
  /** Run one call. Four outcomes; no exceptions for anything a caller sent. */
  call(request: ToolCall): ToolOutcome;
  /** The authoritative state, for a caller between calls. */
  observe(): Observation;
}

export function createDispatch(campaign: Campaign, tools: readonly ToolDefinition[]): Surface {
  const byName = new Map(tools.map((definition) => [definition.name, definition]));

  const doors = new Map<ContextRequestKind, string[]>();
  for (const definition of tools) {
    for (const kind of definition.establishes) {
      const found = doors.get(kind);
      if (found === undefined) doors.set(kind, [definition.name]);
      else found.push(definition.name);
    }
  }

  const doorsFor = (kind: ContextRequestKind): readonly string[] => doors.get(kind) ?? [];

  return {
    tools,
    doorsFor,
    observe: () => observe(campaign.state()),
    call(request: ToolCall): ToolOutcome {
      const definition = byName.get(request.tool);
      if (definition === undefined) {
        return invalid(
          'unknown_tool',
          `${request.tool} is not a tool on this surface; the tools are ${[...byName.keys()].join(', ')}`,
        );
      }
      return definition.invoke(
        { campaign, commandId: request.commandId, doorsFor },
        request.input,
      );
    },
  };
}
