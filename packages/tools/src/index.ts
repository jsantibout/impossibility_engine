/**
 * `@ie/tools` — the only door above the engine.
 *
 * The engine is pure, deterministic and headless; this package is the first
 * layer that is not. It may use Zod, a clock and id generation, and it does
 * exactly three things: validate what a caller sent, hand it to an engine
 * command, and hand back one of four outcomes.
 *
 * **Nothing in `packages/engine` knows this package exists**, and nothing
 * here writes an event an engine command did not produce. Read
 * `docs/design/claude-integration.md` before changing the session boundary;
 * it is decided rather than open.
 */

export * from './campaign.js';
export * from './definitions.js';
export * from './holdings.js';
export * from './observe.js';
export * from './outcome.js';
export * from './schemas.js';
export * from './surface.js';

/**
 * And the other surface, which is the one a human DM holds.
 *
 * Published beside the model's rather than behind it, because "separately
 * obtainable" is what the separation is *for*: a session builds one factory
 * or the other, and the one it built is the whole of the authority it has.
 * Publishing both from one barrel is not a hole — what a caller holds is a
 * `Surface` value, and neither factory can be talked into the other's list.
 *
 * `dispatch.js` is deliberately absent. It is the mechanism both surfaces
 * share, and a published builder over an arbitrary list of tools would be
 * exactly the flag this design exists instead of.
 */
export * from './dm/definitions.js';
export * from './dm/surface.js';
