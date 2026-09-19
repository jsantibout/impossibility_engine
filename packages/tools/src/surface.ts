/**
 * The model's door: every tool a model-driven session may call, and not one of
 * them takes a number the caller produced.
 *
 * That rule is `definitions.ts`'s to argue and this file's to *hold to*, by
 * being the one place the model's list is turned into something callable.
 * There is no second argument: a caller cannot hand this factory a different
 * list, and it can see no list but `TOOLS` — `dm/boundary.test.ts` walks the
 * imports out of this file and asserts that nothing under `dm/` is reachable
 * from any of them.
 *
 * The other door is {@link createDmSurface}, one directory down. Both are
 * published, because "separately obtainable" is the point: a model-driven
 * session builds this one and never holds a tool that takes a DC, an amount
 * or a span of time. Neither surface can reach the external-roll functions,
 * which is the line beneath both.
 *
 * The mechanism they share is {@link createDispatch}, which is not published.
 */

import type { Campaign } from './campaign.js';
import { createDispatch, type Surface } from './dispatch.js';
import { TOOLS } from './definitions.js';

export type { Surface, ToolCall } from './dispatch.js';

export function createSurface(campaign: Campaign): Surface {
  return createDispatch(campaign, TOOLS);
}
