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
 * Using the mastery property of the weapon in hand — the decision SRD writes
 * as "you can".
 *
 * Present at all means use it; what is inside says which property, how far and
 * whose neighbour the extra swing is against. **Every one of the eight is
 * listed and none is filtered here**, for the reason {@link sizeSchema} is
 * spelled out rather than imported and for one more: which properties a
 * character may put in place of a weapon's own is a *rule* — SRD Tactical
 * Master offers Push, Sap and Slow, and a feature has to have granted it — so
 * a schema that published a shorter list would be answering a rules question
 * a level too early, and answering it the same way for a character who holds
 * the feature and one who does not. The engine refuses what nothing unlocked,
 * by name, before a die is thrown.
 *
 * **One of the eight runs nothing, and the description says so.** The engine
 * executes seven — Cleave, Graze, Push, Sap, Slow, Topple, Vex — and Nick
 * "redirects the extra attack the Light property gives, and nothing pays for
 * one" (`commands/mastery.ts`), so a swing that asks for it is answered `ok`
 * and no property happens. Listing it and saying nothing would be the quiet
 * skip this field exists to prevent; listing it is still right, because the
 * day the extra attack is paid for the door is already open and a schema that
 * had edited the book would have to be found first.
 *
 * **`feet` is a choice out of a bound the rules print, not a distance the
 * caller measured** — SRD Push's "up to 10 feet", which is `slotLevel`'s kind
 * of decision. The ceiling is deliberately not repeated here: `PUSH_FEET`
 * lives in the engine beside the property that spends it, and a Zod maximum
 * would be a second copy of a rule, phrased differently, that could drift.
 * What this checks is that the value is a whole number of feet at all; the
 * engine answers `bad_amount` naming its own number, and this field is what
 * that refusal is answerable through.
 */
export const masterySchema = z.object({
  property: z
    .enum(['cleave', 'graze', 'nick', 'push', 'sap', 'slow', 'topple', 'vex'])
    .optional()
    .describe(
      'Use this property in place of the weapon’s own — SRD Tactical Master. Refused unless a feature granted the substitution. Omit to use whatever the weapon prints. Nick is accepted and carries out nothing: the extra attack it redirects is not paid for by anything the engine has.',
    ),
  feet: z
    .int()
    .nonnegative()
    .optional()
    .describe('How far a Push shoves the target. Omit to shove the whole distance the property gives.'),
  cleaving: creatureId
    .optional()
    .describe(
      'The creature already hit this turn, whose neighbour this swing is against — SRD Cleave’s extra attack. Naming it is what makes this attack the extra one.',
    ),
});

/**
 * What a blow buys, where the feature that sells it is bought by a hit.
 *
 * SRD Stunning Strike: "Once per turn when you hit a creature with a Monk
 * weapon or an Unarmed Strike, **you can** expend 1 Focus Point to attempt a
 * stunning strike." {@link masterySchema}'s sentence about a decision written
 * "you can", one trigger along — so the field is present or the rider does not
 * happen, and a swing that names nothing buys nothing.
 *
 * **Two ids and nothing else.** The save DC, the ability it is read from, the
 * pool the price comes out of, the condition, the deadline and whether the
 * once-a-turn allowance is spent are every one of them the engine's, derived
 * at the moment of the hit from the holder's own sheet — which is why this is
 * the whole of the field. A caller cannot name a feature it does not hold, an
 * option it does not offer or a weapon the sentence does not cover: the engine
 * refuses all three by name **before** the attack is rolled, so a refusal here
 * costs neither the action nor the point.
 *
 * **Neither id is enumerated here**, for {@link masterySchema}'s reason and
 * more sharply: which features a character holds is content, and a schema that
 * listed today's would be the engine holding a catalogue one layer up. `sheet`
 * is where a caller reads its own, and `spentBy` on each line names this tool.
 */
export const hitRiderSchema = z.object({
  feature: z
    .string()
    .min(1)
    .describe(
      'The feature this hit is buying, by its id — SRD’s Stunning Strike is `monk:stunning-strike`. Read it off `sheet`, where every feature of this kind names `attack` as the tool that spends it.',
    ),
  option: z
    .string()
    .min(1)
    .describe(
      'Which of the things that feature offers, by its id. A feature that prints one still names it; a refusal lists the ones there are.',
    ),
});

/**
 * The cantrip a swing is cast with, and the one choice such a spell offers.
 *
 * SRD True Strike: "you make one attack with the weapon used in the spell's
 * casting." The casting and the swing are one moment — one Action, one roll,
 * nothing left standing — so it is named on the attack rather than on
 * `cast_spell`, which has no attack to make and refuses the spell outright.
 *
 * **Two fields and nothing else.** Which ability is substituted, the
 * Proficiency Bonus, the Cantrip Upgrade's dice at this character's level,
 * whether the Action is there to spend and whether the caster has proficiency
 * with the thing in their hand are every one of them the engine's, derived at
 * the swing from the caster's own sheet. A caller cannot name a spell it
 * cannot cast, a spell that is not cast this way, or a type the spell does not
 * offer: all three are refused by name **before** the Action is spent and
 * before a die is thrown.
 *
 * The spell is not enumerated here, for {@link hitRiderSchema}'s reason: which
 * spells exist is content, and a schema listing today's would be a catalogue
 * one layer up.
 */
export const cantripSwingSchema = z.object({
  spell: z
    .string()
    .min(1)
    .describe(
      'The cantrip cast with this swing, by its catalogue id — `true-strike`. Refused unless this creature can cast it and unless it is a spell cast this way; `sheet` lists the cantrips they know.',
    ),
  damageType: z
    .string()
    .min(1)
    .optional()
    .describe(
      'The type the blow deals in place of the weapon’s own, where the spell offers a choice — SRD True Strike’s "it can be Radiant damage or the weapon’s normal damage type (your choice)". Written "your choice", so leaving it out deals what the weapon deals. A type the spell does not offer is refused before anything is spent.',
    ),
});

/**
 * A reroll stated **before** the die, and the condition it fires on.
 *
 * SRD Heroic Inspiration: "you can expend it to reroll any die immediately
 * after rolling it, and you must use the new roll." The window a failed check
 * or save opens answers half of that sentence and could never answer the rest
 * — a roll that succeeded, an attack roll and a damage die land in no window —
 * and a window on every die would make a table settle one before every next
 * roll. So this is an **election**: the condition travels on the command that
 * rolls, and the engine reads it against the die it threw.
 *
 * **It carries no number the caller produced.** A face here is the *threshold*
 * a reroll is bought at and never a result: what the die showed is the
 * engine's to say, and the pool is spent only where what it showed met the
 * condition.
 *
 * `which_die` is a position in a damage roll and is meaningless on a D20 Test,
 * where the die thrown again is the one Advantage or Disadvantage counted and
 * no caller may name another.
 */
export const rollElectionSchema = z
  .strictObject({
    pool: z
      .string()
      .min(1)
      .describe(
        'The pool one reroll comes out of, by its key — `human:heroic-inspiration`. It must belong to a feature of this creature’s that rerolls, and that feature’s own sentence decides which rolls it reaches; `sheet` lists what they hold. A pool they have not got, one with nothing left, and one whose sentence does not reach this roll are each refused before a die is thrown.',
      ),
    when: z
      .union([
        z.enum(['fails', 'misses']),
        z.strictObject({ faceAtOrBelow: z.number().int().min(1) }),
      ])
      .describe(
        'What would make the reroll happen. `fails` on an ability check or a saving throw, `misses` on an attack roll, or `{ "faceAtOrBelow": 5 }` on any of them — and the face is the only thing a damage die can be elected on, because damage has no outcome to read. The wrong word for the roll is refused rather than guessed at.',
      ),
    which_die: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe(
        'Which of the damage dice, by its position among the dice that **counted** — 0 is the first. Only on a damage election; leaving it out rerolls the lowest of them, which is the one a single reroll is worth spending on. How many a swing throws depends on the Critical Hit and on whatever doubled the notation, so a position past the end is not refused: it names no die of that roll, the reroll does not happen and nothing is spent.',
      ),
  })
  .describe(
    'A reroll elected before the die and read against it — SRD Heroic Inspiration’s "reroll any die immediately after rolling it, and you must use the new roll". Nothing is spent unless the condition was met, and the first face stays in the log beside the second.',
  );

/** What the engine takes, from what a caller sent. */
export const electionOf = (
  election: z.infer<typeof rollElectionSchema>,
): { pool: string; when: 'fails' | 'misses' | { faceAtOrBelow: number }; die?: number } => ({
  pool: election.pool,
  when: election.when,
  ...(election.which_die === undefined ? {} : { die: election.which_die }),
});

/**
 * The heading a stat block prints a line under, as the caller types it.
 *
 * **A name and never a line**, which is `add_creature`'s rule and `attack`'s
 * `action` one section along: the sentence under the heading, the save DC in
 * it, the dice and the recharge are all the block's, pinned into the creature
 * when it arrived, and a field that carried any of them would be the caller
 * writing the monster. What this field carries is which of the headings the
 * creature already holds is meant.
 *
 * **No list, and there could not be one.** Which headings there are is the
 * stat block's answer and differs per creature, so an enum here would be the
 * engine's catalogue rule broken one layer up. The engine matches the name
 * against the lines it pinned — trimmed, and without regard to case, because
 * the heading is something a person types — and refuses `no_such_line` naming
 * what was sent, which is what makes this field answerable.
 */
export const printedLineName = z
  .string()
  .min(1, 'a printed line is named by its heading')
  .describe('The heading the stat block prints the line under, exactly as it is printed.');

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
  /**
   * Which of the sizes its species prints this character is.
   *
   * SRD prints a size on every species and lets some of them print more than
   * one, which is the whole of why this is a choice: where a species offers a
   * single size there is nothing to answer, and where it offers several the
   * pick is the player's and the engine will not make it for them. Silence is
   * a legal answer — creation pins the first printed size and says so — so the
   * field is optional, and stating one is the only way a character ends up as
   * the other size its species offers.
   *
   * **A string and not {@link sizeSchema}**, which is the same judgement
   * `featChoice.abilities` makes a few lines above: the engine matches this
   * against the word the *species* prints, case-insensitively, exactly as a
   * language and an alignment are matched by name — so `bad_size` can name the
   * word the caller wrote back to them. An enum here would be a second,
   * narrower vocabulary that answered a caller writing the printed word with a
   * complaint about a key, and it would be this file adjudicating a choice
   * against a species it has not read. {@link sizeSchema} is this file's own
   * spelled-out list, and it is right where a caller is placing a creature
   * nothing has pinned a size for; this is a word off a species entry, and the
   * species decides which words there are.
   */
  size: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Which of the sizes this species prints, as the species prints it — matched without regard to case, the way a language or an alignment is matched by name. Most species print one size and there is nothing to say; where one prints several, the choice is the player’s. Omit it and creation pins the first size the species prints.',
    ),
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
  // The spellcasting ability an origin trait asks for, keyed by the trait that
  // asked — SRD's lineages and legacies grant spells to a character who may
  // have no class to cast them with, and print a choice of three abilities.
  featureSpellcasting: z.record(z.string().min(1), abilitySchema).optional(),
  feats: z.record(z.string().min(1), featChoice),
  // The forms a shape-shifting feature has learned, as stat-block ids — SRD
  // Wild Shape's "You know four Beast forms". Checked against the feature's
  // own table at the class level; refused on a character with no such feature.
  knownForms: z
    .array(z.string().min(1))
    .optional()
    .describe(
      'Stat-block ids of the forms a shape-shifting feature has learned — SRD Wild Shape’s four Beasts of CR 1/4 or lower with no Fly Speed at level 2. Only for a character with such a feature; the engine refuses a form the level does not allow, and `assume_shape` takes only a form on this list.',
    ),
  dmGrants: dmGrants.optional(),
});
