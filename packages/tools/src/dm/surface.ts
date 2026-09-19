/**
 * The DM's door.
 *
 * The same mechanism as the model's — one dispatch table over one campaign,
 * four outcomes, no exceptions for anything a caller sent — over a different
 * list. The difference is entirely in the list, and the list is the whole of
 * the design: a DM may state a Difficulty Class, an amount of damage and a
 * span of time, and may still never state what a die showed.
 *
 * **Two factories, and neither takes a list.** Which surface a session holds
 * is decided by which factory it calls, and a session that calls
 * `createSurface` cannot reach a tool from here — not by an argument, not by
 * a flag, and not by an import, which `boundary.test.ts` beside this file
 * asserts by walking the model surface's imports.
 *
 * One campaign may have both, and that is not a hole: a table with a human DM
 * and an AI narrator is two callers over one log, each holding the authority
 * its own door carries. What must never happen is one caller holding both,
 * and that is a choice made where the surface is built.
 */

import type { Campaign } from '../campaign.js';
import { createDispatch, type Surface } from '../dispatch.js';
import { DM_TOOLS } from './definitions.js';

export function createDmSurface(campaign: Campaign): Surface {
  return createDispatch(campaign, DM_TOOLS);
}
