/**
 * The fold, in seven seams, and what it publishes.
 *
 * `events.ts` was one 5,400-line module holding the state types, the event
 * union and every one of these functions, and it is the file that serialised a
 * whole tranche: seven of ten mechanism tasks touched it, and read by domain
 * those seven touched four different regions. The seams here are where the
 * fold's own declaration graph already cut — `scripts/fold-graph.ts` computes
 * it and reports the module DAG, which is the evidence for this layout rather
 * than a taste for smaller files.
 *
 * Bottom to top, and it is a chain rather than a web:
 *
 * | | |
 * |---|---|
 * | `common.ts` | the corrupt-log backstop, the accessors that throw it, the two sort helpers that keep a fold byte-identical |
 * | `release.ts` | what a casting is on and what it hung there — the single door every ending converges on |
 * | `areas.ts` | who a persistent area catches, at each of the three moments the SRD writes |
 * | `turns.ts` | what a turn boundary owes, and why its two moments are a round apart |
 * | `expiry.ts` | what runs out, and what a creature who leaves takes with them |
 * | `endings.ts` | a casting ended by something that happens |
 * | `apply.ts` | the switch, the derived passes and the reduce |
 *
 * **This barrel publishes the fold's public names and nothing else.** A
 * function is exported from its own module so a sibling seam may call it —
 * `releaseCasting`, `expireEffects`, `raiseAreaBoundary` — and that is not the
 * same thing as being part of `@ie/engine`. `commands.ts` draws exactly this
 * line for exactly this reason: before the split there was one file, so
 * "exported" and "public" were the same word, and a star re-export would have
 * made every internal helper part of the engine's surface.
 *
 * Ten names, which with `state.ts`'s fourteen and the union make the
 * twenty-five `events.ts` has always exported.
 */
export { castingIdFor } from './common.js';
export { grantSourcesOf, withoutGrants } from './release.js';
export { allyOfCaster, type AllyVerdict } from './endings.js';
export { applyEvent, fold, historyOf, mergeItems, wearsHeavyArmor } from './apply.js';
