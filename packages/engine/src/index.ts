export * from './dice.js';
export * from './rolls.js';
export * from './bonuses.js';
export * from './conditions.js';
export * from './time.js';
export * from './timers.js';
export * from './catalogue.js';
export * from './resources.js';
export * from './rest.js';
export * from './progression.js';
export * from './multiclass.js';
export * from './origins.js';
export * from './spellbook.js';
export * from './spellcasting.js';
export * from './spell-definitions.js';
// The definition validator. Exported because the point of it is that a
// definition does not have to have come through the compiler: whatever layer
// supplies one — a loader, a tool surface, a future authoring path — validates
// it here rather than writing its own checks, the way `author_creature`'s
// hand-written accessors had to.
export * from './spell-schema.js';
// The feature validator, exported for the same reason and beside its
// precedent: a class file is declarative data the compiler was the only guard
// on, and a validator nothing outside its own test can reach is a rule nothing
// enforces.
export * from './feature-schema.js';
// The content registry: what a campaign's world holds, validated through the
// two validators above. The engine ships no catalogue of its own — the SRD's
// is `@ie/content`, and it goes through this door like any homebrew.
export * from './content.js';
export * from './creation.js';
export * from './spells.js';
export * from './character.js';
export * from './checks.js';
export * from './attack.js';
export * from './combat.js';
export * from './vitals.js';
export * from './positioning.js';
export * from './reactions.js';
export * from './monster.js';
// A thing you can attack and break: the vocabulary an object's two tables are
// written in, and the rule that stands over both of them.
export * from './objects.js';
// The glossary's hazards — a fire a creature is standing in, which is not one
// of the fifteen conditions and is not a grant either. Exported whole because
// a door above the engine has to be able to say a creature is burning, and the
// mark is the only place that fact lives.
export * from './hazards.js';
export * from './events.js';
export * from './idempotency.js';
export * from './commands.js';
// The effective Armour Class — the one an attack is actually measured against,
// with a Shield of Faith or a Mage Armor folded in. `standing.ts` is otherwise
// internal, so a caller outside the engine could read `armorClass(sheet)` and
// get the *base* number while the engine attacked against a different one.
export { armorClassOf } from './standing.js';
// The effective Speed, and what is left of it this turn — the numbers the
// rules are actually measured against, with conditions, Exhaustion and every
// feature grant folded in. Exported for the same reason `armorClassOf` is: a
// caller outside the engine reading `sheet.baseSpeed` or a budget field would
// get a number the engine itself never uses.
export { movementLeftFor, speedOf } from './standing.js';
// A creature's senses, and the sight question that reads them. Exported for
// the same reason again: `sightBetween` on the scene alone answers the
// pairwise question and nothing else, so a caller outside the engine would
// be asked to establish a sight line the looker's own Darkvision already
// settles.
export { canSee, canSeePoint, sensesOf } from './standing.js';
// And the other question a creature's awareness answers, which is not sight:
// SRD Divine Sense's "you know the location of any creature of those types
// within 60 feet of yourself, and you know its creature type". Derived on
// every read, so a door publishing it can never show an awareness running on
// a Paladin who has just been Stunned.
export {
  awarenessesOn,
  detectedBy,
  type DetectedCreature,
  type RunningAwareness,
} from './standing.js';
// SRD Hunter's Lore — the other fact the engine holds that only the table
// reads, and exported for the reason `detectedBy` is: it is derived on every
// read, so a door publishing it can never show a ranger what a lapsed mark
// used to tell them.
export { knownDefencesAmong, knownDefencesOf, type KnownDefences } from './knowledge.js';
// The scores as they stand, and the sheet a reader should be handed. Exported
// for the third time for the same reason: an item that *sets* a score means
// `creature.sheet.abilities` is the score the character had rather than the
// one they have, and a caller reading it would get a Strength the engine
// disagrees with. `sheetAsItStands` hands back the same object when nothing
// is setting anything, so asking costs nothing.
export { abilityScoresOf, sheetAsItStands } from './standing.js';
