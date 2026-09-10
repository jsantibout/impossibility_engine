/**
 * Branded ids. These are structurally strings, but the brand stops a ZoneId
 * being passed where a CharacterId belongs — a mistake that is otherwise very
 * easy to make in an engine where nearly every argument is an identifier.
 */
declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

export type CampaignId = Brand<string, 'CampaignId'>;
export type SessionId = Brand<string, 'SessionId'>;
export type CharacterId = Brand<string, 'CharacterId'>;
export type ZoneId = Brand<string, 'ZoneId'>;
export type EventId = Brand<string, 'EventId'>;

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
export const asZoneId = (v: string): ZoneId => v as ZoneId;
export const asEventId = (v: string): EventId => v as EventId;
export const asRollId = (v: string): RollId => v as RollId;
