/**
 * The vocabulary a call is written in, validated before the engine sees it.
 *
 * Every enum here is built from the engine's own exported list rather than
 * retyped — `ABILITIES`, `SKILLS`, `CONDITIONS` — so a vocabulary that grows
 * grows here for free and one that shrinks fails loudly. The three that are
 * spelled out are spelled out for a reason given at each.
 *
 * **There is no `command_id` field anywhere in this file, and that is the
 * point.** The design note decided it: "The command id is the transport's
 * `tool_use.id`, never a field the model fills." A model that chooses its own
 * idempotency key can choose a fresh one on a retry, which is the failure the
 * key exists to prevent; the transport's id is the same on a retry because
 * the retry *is* the same call.
 */

import { ABILITIES, CONDITIONS, DAMAGE_TYPES, SKILLS } from '@ie/shared';
import { z } from 'zod';

/** A creature id, as the caller types it. Branded by the handler, not here. */
export const creatureId = z
  .string()
  .min(1, 'a creature id cannot be empty')
  .describe('Creature id.');

export const abilitySchema = z.enum(ABILITIES);
export const skillSchema = z.enum(SKILLS);
export const conditionSchema = z.enum(CONDITIONS);

/**
 * The thirteen kinds of damage, and the reason a caller must name one.
 *
 * Resistance, Vulnerability and Immunity are all *per type*, so damage with
 * no type is damage no defence can meet. A DM who wants the fire-immune
 * creature to burn anyway has a tool for that — `improvised_damage`, which
 * takes a number already adjudicated — and this is the other one, where the
 * engine is being asked to measure.
 */
export const damageTypeSchema = z.enum(DAMAGE_TYPES);

/**
 * SRD "Creature Size and Space", spelled out rather than imported.
 *
 * `CREATURE_SIZES` lives in `@ie/srd`, which this package does not depend on:
 * the tool surface sits above the engine and beside content, and reaching
 * past the engine for a six-word list would buy a dependency for nothing.
 * The list is fixed by the rules, and the engine's own type is structurally
 * this union, so a divergence is a compile error at the call site.
 *
 * **It is asked for in one place, and it used to be asked for in three.** A
 * size is a fact the book prints — a stat block says Large in its first line —
 * so a surface that took one from the caller was asking a model to state
 * something the Engine owes it. `creature-added` pins the size now and
 * `placeCreatureInScene` reads the pinned one, which left `move` and
 * `cast_spell.teleportTo` asking about a creature whose size is already in
 * state, and `place_creature` asking about one whose record usually answers.
 * The two that could never have a reason lost the field; the one that can
 * kept it, narrowed to the case where nothing has pinned an answer. See
 * {@link placementSchema}.
 */
export const sizeSchema = z.enum(['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan']);

/**
 * A point in the room, in feet.
 *
 * The only place a caller types raw coordinates, and it is for laying out the
 * map: a landmark has to anchor the room before anything can be placed
 * relative to it. Creatures are never placed at a coordinate.
 */
export const pointSchema = z.object({
  x: z.number().finite().describe('Feet from the west wall.'),
  y: z.number().finite().describe('Feet from the south wall.'),
  z: z.number().finite().optional().describe('Feet above the floor. Defaults to 0.'),
});

/**
 * The 5-foot spaces something crossed on the way, in order, ending where it
 * ends — the field that answers a `route_required`.
 *
 * **A route is a statement of fact, not a number the caller produced**, and
 * the engine is what makes that true rather than this schema. `checkRoute`
 * refuses anything that is not a walk of single spaces between the two
 * endpoints the engine worked out for itself: the wrong number of spaces, a
 * step longer than one, a space outside the scene, or an end that is not where
 * the move ends. What it accepts it then reads against ground it already
 * holds, patch by patch, and charges what that ground says. The caller says
 * which way they went; every number that follows is the engine's.
 *
 * **Raw coordinates, where a creature's destination is always a placement.**
 * That rule is about *where somebody ends up* — "creatures are never placed at
 * a coordinate" — and a route decides nothing of the kind: both its ends are
 * already fixed by the call it rides on, and the request that asks for it
 * names them both in feet. A waypoint measured from a landmark would be a
 * sentence nobody can write about the middle of a walk.
 */
export const routeSchema = z
  .array(pointSchema)
  .min(1, 'a route is at least one space')
  .describe('The 5-foot spaces crossed, in order, ending where the move or the area ends.');

/**
 * Where a creature goes, which is always relative to something established.
 *
 * Exactly one anchor, enforced here rather than left to the engine, because
 * "you gave me both" is an argument mistake and not a rules refusal — the two
 * belong in different outcomes.
 *
 * **No size.** It was here, described as "only when it is not the default,
 * Medium", which is a fact the book prints being asked of the caller on every
 * placement, every move and every teleport. A creature that is already in the
 * scene has a size in state, so `move` and `cast_spell.teleportTo` could never
 * have had a reason to carry one at all; `place_creature` declares the field
 * itself, for the one creature whose record pins nothing. See
 * {@link sizeSchema}.
 */
export const placementSchema = z
  .object({
    fromLandmark: z.string().min(1).optional().describe('Landmark to measure from.'),
    fromCreature: creatureId.optional().describe('Creature to measure from.'),
    feet: z.number().finite().nonnegative().describe('How far from it to end up.'),
    bearing: z
      .number()
      .finite()
      .optional()
      .describe('Degrees clockwise from north. 0 is north, 90 is east. Swept for if omitted.'),
    elevation: z.number().finite().optional().describe('Feet above the anchor, for a flier.'),
  })
  .refine(
    (value) => (value.fromLandmark === undefined) !== (value.fromCreature === undefined),
    { error: 'a placement needs exactly one of fromLandmark or fromCreature' },
  );

export type PlacementInput = z.infer<typeof placementSchema>;

/**
 * What the attempt leans on, for the two conditions that read it.
 *
 * Absent means nobody has said, which is the honest third value: a Blinded
 * creature automatically fails a check that requires sight, and nothing but
 * the caller can say that reading an inscription does and shoving a door does
 * not.
 */
export const sensesFields = {
  requiresSight: z.boolean().optional().describe('True when the attempt cannot be made without seeing.'),
  requiresHearing: z.boolean().optional().describe('True when it cannot be made without hearing.'),
};

/**
 * How long a ruled condition lasts, said as a moment and never as a number.
 *
 * SRD writes the ends of things as moments in the turn order — "until the
 * start of your next turn", "until the end of the current turn" — and those
 * are the three offered here. `seconds` is the engine's fourth and is left
 * off: invariant 7 lists durations among the quantities the engine
 * calculates, and "ten minutes" through this door would be the caller
 * producing one. A moment in the order is not a number.
 *
 * Absent means indefinite, which is the honest default for a ruling with no
 * stated end — and the reason this field exists at all: a DM-ruled condition
 * with no way to say when it stops is a condition nothing on this surface
 * can lift, because no engine command lifts one. Giving it an end is how a
 * ruling ends.
 */
export const conditionDurationSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('start-of-next-turn'),
    of: creatureId.describe('Whose next turn starting ends it.'),
  }),
  z.object({
    kind: z.literal('end-of-next-turn'),
    of: creatureId.describe('Whose next turn ending ends it.'),
  }),
  z.object({ kind: z.literal('end-of-current-turn') }),
]);

// — creation ————————————————————————————————————————————————————————————————

const spellbookEntry = z.object({
  spellId: z.string().min(1),
  acquiredAt: z.int().min(1).describe('The class level at which it was written into the book.'),
  origin: z.enum(['level', 'copied', 'feature']),
});

/**
 * Ability scores, and the one method this surface does not offer.
 *
 * `manual` is the engine's third method and it means "the DM said so" — the
 * scores are taken as written and nothing checks them against an array or a
 * point budget. That is authorship a human DM has and a model does not, and
 * offering it here would be the one hole through which a caller could give
 * itself an 18 in everything. Left off deliberately; a human-DM surface is a
 * later batch's problem and can pass `manual` to the engine directly.
 */
const abilityChoice = z.object({
  method: z.enum(['standard-array', 'point-buy']),
  assignment: z.object({
    str: z.int(),
    dex: z.int(),
    con: z.int(),
    int: z.int(),
    wis: z.int(),
    cha: z.int(),
  }),
});

/**
 * Hit points, and the one method this surface does not offer.
 *
 * `rolled` takes the numbers the dice showed — which is the caller producing
 * mechanically authoritative numbers, the first inviolable rule, wearing a
 * creation form. `fixed` is the SRD average and the engine computes it. When
 * a later batch wants rolled hit points, the engine should roll them.
 */
const hitPointChoice = z.object({ method: z.literal('fixed') });

const featChoice = z.object({
  featId: z.string().min(1),
  spellList: z.string().optional(),
  spellcastingAbility: abilitySchema.optional(),
  cantrips: z.array(z.string().min(1)).optional(),
  levelOneSpell: z.string().optional(),
  proficiencies: z.array(z.string().min(1)).optional(),
  /**
   * The Ability Score Improvement's answer, and every Epic Boon's: which
   * scores the points go into, **one entry per point**. `['str','str']` is
   * "one ability score by 2" and `['str','dex']` is "two ability scores by
   * 1"; the spread is counted out of this rather than declared beside it.
   *
   * Plain strings rather than {@link abilitySchema}, which is the one place
   * on this surface a looser type is the faithful one: `FeatChoice.abilities`
   * is `readonly string[]` in the engine *so that* `checkFeats` can answer
   * `unknown_ability` naming the word the caller wrote. An enum here would
   * turn that named refusal into a validation issue about a key, and this
   * file's job is the shape — whether the spread is one the feat prints is
   * `planCharacter`'s, as it is for every other choice here.
   */
  abilities: z.array(z.string().min(1)).optional(),
});

/**
 * What the GM handed out beyond the standard package — and, here, nothing.
 *
 * SRD "Starting at Higher Levels" makes this a real decision, and the engine
 * requires it to be *stated* above level 1 rather than guessed: an empty
 * grant with a note saying so is a fine answer, an absent one is not. So the
 * field cannot be dropped.
 *
 * It can be narrowed, and is. `magicItems` goes straight onto the sheet, and
 * a granted wand is mechanically live — charges, attunement, a Fireball at a
 * DC the item sets. That is strictly more authorship than the `manual`
 * ability scores excluded thirty lines up, for the same reason and with more
 * consequence. The note stays free, because *why the party has nothing* is
 * exactly the judgement the engine wanted written down.
 */
const dmGrants = z.object({
  items: z.tuple([]).describe('Empty. This surface grants no equipment beyond the package.'),
  goldPieces: z.literal(0),
  magicItems: z.tuple([]).describe('Empty. A magic item is authorship, and a live mechanic.'),
  note: z.string().describe('Why, in the GM’s words. Recorded so the decision is visible later.'),
});

const classSpellChoices = z.object({
  cantrips: z.array(z.string().min(1)).optional(),
  spellbook: z.array(spellbookEntry).optional(),
  preparedSpells: z.array(z.string().min(1)).optional(),
});

/**
 * Everything creation asks for, shaped but not adjudicated.
 *
 * Zod's job here is the *shape*: the strings are strings, the enums are the
 * engine's own, the numbers are integers. Whether `wizard` is a class, whether
 * the standard array was assigned honestly, whether six cantrips is too many —
 * all of that is `planCharacter`'s, and it answers with a refusal naming the
 * field at fault. Duplicating those checks here would be a second rules engine
 * that could disagree with the first.
 */
export const characterChoicesSchema = z.object({
  name: z.string().min(1),
  classId: z.string().min(1),
  level: z.int().min(1).max(20),
  speciesId: z.string().min(1),
  backgroundId: z.string().min(1),
  abilities: abilityChoice,
  abilityIncreases: z.partialRecord(abilitySchema, z.int()),
  classSkills: z.array(skillSchema),
  languages: z.array(z.string().min(1)),
  alignment: z.string().min(1),
  subclassId: z.string().min(1).optional(),
  cantrips: z.array(z.string().min(1)),
  spellbook: z.array(spellbookEntry),
  multiclass: z
    .array(z.object({ classId: z.string().min(1), level: z.int().min(1), subclassId: z.string().optional() }))
    .optional(),
  preparedSpells: z.array(z.string().min(1)),
  spellsByClass: z.record(z.string().min(1), classSpellChoices).optional(),
  classEquipment: z.string().min(1),
  backgroundEquipment: z.string().min(1),
  equipped: z.array(z.string().min(1)),
  hitPoints: hitPointChoice,
  featureChoices: z.record(z.string().min(1), z.array(z.string())),
  feats: z.record(z.string().min(1), featChoice),
  dmGrants: dmGrants.optional(),
});
