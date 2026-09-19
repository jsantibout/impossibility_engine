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
export * from './observe.js';
export * from './outcome.js';
export * from './schemas.js';
export * from './surface.js';
