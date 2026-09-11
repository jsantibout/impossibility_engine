/**
 * Branded ids. These are structurally strings, but the brand stops a ZoneId
 * being passed where a CharacterId belongs — a mistake that is otherwise very
 * easy to make in an engine where nearly every argument is an identifier.
 */
declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

/**
 * The three the event log will be keyed by from M3, and unused until then.
 *
 * Kept deliberately: they are the vocabulary persistence is already designed
 * around, not leftovers. `ZoneId` sat here beside them and was neither — see
 * the note in CLAUDE.md's Combat Model section, which described a zone graph
 * this engine never built and replaced with a 5-foot lattice.
 */
export type CampaignId = Brand<string, 'CampaignId'>;
export type SessionId = Brand<string, 'SessionId'>;
export type EventId = Brand<string, 'EventId'>;

export type CharacterId = Brand<string, 'CharacterId'>;

/**
 * Identifies a single die roll produced by the engine. This is the mechanism
 * that keeps the DM honest: a tool that applies damage will only accept an
 * amount accompanied by the RollId that produced it, so the model cannot
 * invent numbers.
 */
export type RollId = Brand<string, 'RollId'>;

export const asCampaignId = (v: string): CampaignId => v as CampaignId;
export const asSessionId = (v: string): SessionId => v as SessionId;
export const asCharacterId = (v: string): CharacterId => v as CharacterId;
export const asEventId = (v: string): EventId => v as EventId;
export const asRollId = (v: string): RollId => v as RollId;
