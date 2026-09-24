import { z } from 'zod';

/**
 * Schemas for SRD 5.2.1 content.
 *
 * `packages/srd/raw/` is a third-party transcription (see its PROVENANCE.md),
 * so nothing reaches the engine unvalidated. A malformed save DC or damage die
 * that slipped through would surface much later as a rules bug, which is the
 * hardest kind to trace.
 *
 * **This module is published on its own, as `@ie/srd/schemas`, and must stay
 * a leaf.** The engine validates a supplied monster against `MonsterSchema`
 * and reads `WEAPON_PROPERTIES`, and it may not buy those through the barrel:
 * `index.ts` re-exports `monster-index.ts` and the rest of the parsed book, so
 * an engine that imported `@ie/srd` held the whole catalogue in every process,
 * given one or not. A shape is not a catalogue, which is the whole of why the
 * subpath is honest — so nothing here may import an index or the generated
 * data. `packages/engine/src/srd-barrel.test.ts` walks this file's imports and
 * holds both halves of that.
 */

export const SPELL_SCHOOLS = [
  'abjuration',
  'conjuration',
  'divination',
  'enchantment',
  'evocation',
  'illusion',
  'necromancy',
  'transmutation',
] as const;

export const SpellSchoolSchema = z.enum(SPELL_SCHOOLS);
export type SpellSchool = z.infer<typeof SpellSchoolSchema>;

export const SpellComponentsSchema = z.object({
  verbal: z.boolean(),
  somatic: z.boolean(),
  material: z.boolean(),
  /** The parenthesised material list, when the spell has one. */
  materialDescription: z.string().nullable(),
});
export type SpellComponents = z.infer<typeof SpellComponentsSchema>;

export const SpellSchema = z.object({
  /** Slug derived from the name, e.g. `fireball`. Stable across re-ingests. */
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  /** 0 for a cantrip. */
  level: z.number().int().min(0).max(9),
  school: SpellSchoolSchema,
  /** Lower-cased class slugs, e.g. `['sorcerer', 'wizard']`. */
  classes: z.array(z.string().regex(/^[a-z-]+$/)),
  castingTime: z.string().min(1),
  /** True when the casting time offers a Ritual option. */
  ritual: z.boolean(),
  range: z.string().min(1),
  components: SpellComponentsSchema,
  duration: z.string().min(1),
  /** True when the duration requires Concentration. */
  concentration: z.boolean(),
  description: z.string().min(1),
  /** Text of the "Using a Higher-Level Spell Slot" clause, when present. */
  higherLevel: z.string().nullable(),
});
export type Spell = z.infer<typeof SpellSchema>;

export const CREATURE_SIZES = [
  'tiny',
  'small',
  'medium',
  'large',
  'huge',
  'gargantuan',
] as const;
export const CreatureSizeSchema = z.enum(CREATURE_SIZES);
export type CreatureSize = z.infer<typeof CreatureSizeSchema>;

/** One ability's score, derived modifier, and saving throw bonus. */
export const AbilityBlockSchema = z.object({
  score: z.number().int().min(1).max(30),
  modifier: z.number().int(),
  save: z.number().int(),
});

export const AbilityBlockMapSchema = z.object({
  str: AbilityBlockSchema,
  dex: AbilityBlockSchema,
  con: AbilityBlockSchema,
  int: AbilityBlockSchema,
  wis: AbilityBlockSchema,
  cha: AbilityBlockSchema,
});

export const SpeedSchema = z.object({
  walk: z.number().int().min(0),
  burrow: z.number().int().min(0).nullable(),
  climb: z.number().int().min(0).nullable(),
  fly: z.number().int().min(0).nullable(),
  swim: z.number().int().min(0).nullable(),
  /** Fly speeds annotated "(hover)". */
  hover: z.boolean(),
});

export const HitPointsSchema = z.object({
  average: z.number().int().min(1),
  /** e.g. `2d6` or `13d8 + 13`. Null when the source gives only a flat value. */
  formula: z.string().nullable(),
});

/**
 * One typed slice of an attack's damage, as a stat block prints it.
 *
 * `5 (1d6 + 2) Piercing damage` is all four fields: the average the book
 * states, the dice, the modifier already folded into the parenthesis, and the
 * type. The average is carried rather than recomputed because it is the
 * book's own arithmetic and therefore the check on the other three — every
 * expression in the SRD bestiary agrees with its dice, so one that does not
 * is a misread line rather than a rounding argument.
 */
/**
 * The word that stands where a damage type would, when the block does not
 * print one.
 *
 * SRD Half-Dragon: "28 (8d6) damage of the type chosen for the **Draconic
 * Origin** trait", and that trait ends "(GM's choice)". So the type is a fact
 * only the table holds, and this is the reader saying so out loud rather than
 * guessing a type or refusing the line.
 *
 * **It is not a damage type and nothing may treat it as one.** Every engine
 * reader that meets it asks the table for the real one — `declareDamageType`
 * records a ruling on the creature — and refuses to roll until somebody has
 * answered. A sentinel rather than an absent field because
 * {@link MonsterDamageSchema.type} is what every reader of a printed amount
 * already looks at: a reader that forgot an optional flag would deal the
 * damage typeless, and a reader that meets this word cannot go on by accident.
 */
export const DECLARED_DAMAGE_TYPE = 'declared';

export const MonsterDamageSchema = z.object({
  /** `1d6`, or null where the block prints a flat number and no dice. */
  dice: z.string().regex(/^\d+d\d+$/).nullable(),
  /** The modifier inside the parenthesis; 0 where there is none. */
  flat: z.number().int(),
  /**
   * Lower-cased, in the engine's own vocabulary: `piercing`, `necrotic`.
   *
   * Or {@link DECLARED_DAMAGE_TYPE}, where the block prints no type at all
   * and names a trait the table fills in.
   */
  type: z.string().min(1),
  /** The average the block prints outside the parenthesis. */
  average: z.number().int().min(0),
});
export type MonsterDamage = z.infer<typeof MonsterDamageSchema>;

/**
 * What has to happen before a line that is not available every round is
 * available again.
 *
 * The book prints it **inside the line's name** — "Whirlwind (Recharge 4–6)",
 * "Rock (Recharge 6)", "(Recharge after a Short or Long Rest)" — and a name is
 * exactly what nothing downstream may branch on. So it is read here, once, and
 * whatever has to tell a Bite from a breath weapon reads a field.
 *
 * **The two arms are not "a die" against "a rest".** SRD *Monsters*: "Recharge
 * X–Y ... at the start of each of the monster's turns, roll 1d6. If the roll is
 * within the number range given ... the monster regains the use of that part,
 * **which also recharges when the monster finishes a Short or Long Rest**." So
 * the die arm has two ways back and the rest is one of them. The other notation
 * is the rest *alone*: "Recharge after a Short or Long Rest. This notation means
 * the monster can use the stat block part once and must then finish a Short or
 * Long Rest to use it again" — no die, and no turn-start roll.
 *
 * `low` is the lowest face of the d6 that brings it back: 4 for "4–6", 6 for
 * "6".
 */
export const MonsterRechargeSchema = z.union([
  z.object({ kind: z.literal('die'), low: z.number().int().min(1).max(6) }),
  z.object({ kind: z.literal('rest') }),
]);
export type MonsterRecharge = z.infer<typeof MonsterRechargeSchema>;

/**
 * One clause of a Multiattack sentence: a count, and the printed name or names
 * it attaches to.
 *
 * **Two fields because the book writes two things.** "two Thunderous Slam
 * attacks" names one line; "two attacks, using Scimitar and Pistol in any
 * combination" names a *menu* — several printed lines sharing one count, from
 * which the creature picks swing by swing. A menu written as two entries of
 * one each would be a rule nobody printed (a Bandit Captain owing exactly one
 * Scimitar), and a menu collapsed to a bare count would be the fabrication the
 * named sequence exists to prevent.
 *
 * Exactly one of the two is present. `attack` stays because it is what the
 * book writes in the ordinary case and what every sequence pinned before the
 * menu existed carries — an old value is still a value this reads.
 */
export const MonsterMultiattackEntrySchema = z
  .object({
    count: z.number().int().min(1),
    /** The printed name of the action this clause names — `Thunderous Slam`. */
    attack: z.string().min(1).optional(),
    /** The printed names this clause offers a choice of — `[Scimitar, Pistol]`. */
    attacks: z.array(z.string().min(1)).min(1).optional(),
  })
  .refine(
    (entry) => (entry.attack === undefined) !== (entry.attacks === undefined),
    'a Multiattack entry names one attack or a menu of them, never both and never neither',
  );
export type MonsterMultiattackEntry = z.infer<typeof MonsterMultiattackEntrySchema>;

/**
 * What must already have happened this turn for a branch to be offered.
 *
 * One member, and it is the only gate the SRD prints: the Clay Golem's "three
 * Slam attacks **if it used Hasten this turn**". `usedBonusAction` is the
 * heading of a line the same block prints under Bonus Actions, bound before it
 * reaches this shape — a name, and never a mechanism read out of what that
 * line says.
 */
export const MonsterMultiattackGateSchema = z.object({
  usedBonusAction: z.string().min(1),
});
export type MonsterMultiattackGate = z.infer<typeof MonsterMultiattackGateSchema>;

/**
 * One branch of an alternation: a bare sequence, or one the sentence gates.
 *
 * **A union rather than a field, so that every sequence pinned before the gate
 * existed is still a branch this reads.** An alternation is a list of branches
 * and it always was; what is new is that a branch may say what it requires, and
 * the ungated form is the array it has always been.
 */
export const MonsterMultiattackBranchSchema = z.union([
  z.array(MonsterMultiattackEntrySchema).min(1),
  z.object({
    entries: z.array(MonsterMultiattackEntrySchema).min(1),
    requires: MonsterMultiattackGateSchema,
  }),
]);
export type MonsterMultiattackBranch = z.infer<typeof MonsterMultiattackBranchSchema>;

/** The clauses one branch holds, whichever of the two shapes it is written in. */
export const entriesOfBranch = (
  branch: MonsterMultiattackBranch,
): readonly MonsterMultiattackEntry[] => (Array.isArray(branch) ? branch : branch.entries);

/** What that branch requires, or null where it requires nothing. */
export const gateOfBranch = (
  branch: MonsterMultiattackBranch,
): MonsterMultiattackGate | null => (Array.isArray(branch) ? null : branch.requires);

/**
 * The sequence a Multiattack prints, where the sentence states one.
 *
 * SRD Air Elemental: "The elemental makes two Thunderous Slam attacks." A
 * stat block's Multiattack is not a number of attacks — it is a *named
 * sequence*, and a count carried without its names would let a Ghoul whose
 * book prints two Bites make two Claws instead.
 *
 * **Three fields, added one at a time as a wording of the book was read, and
 * every one of them optional** — so a sequence pinned onto a creature before
 * any of them existed is still a sequence this reads.
 *
 * - `entries` is the one sequence, where the sentence prints one.
 * - `alternatives` is two whole sequences of which the creature is doing one.
 *   SRD Barbed Devil: "one Claws attack and one Tail attack, **or** it makes
 *   two Hurl Flame attacks", and the Dragon Turtle's "It can replace one
 *   attack with a Tail attack" is the same mechanism in the book's other
 *   wording. Nothing chooses: the branch is settled by the swings already
 *   made, because after one Hurl Flame the other branch admits no assignment.
 * - `handOver` is the part of the line the engine cannot execute, carried
 *   verbatim. "It can replace one attack with a use of Spellcasting" is a
 *   permission whose subject is a save or a prose action, and the book is
 *   consistent about the difference: "a *Tail attack*" is a printed line, "a
 *   *use of* X" is not. There is nothing to enforce — making fewer swings than
 *   a sequence prints has always been legal — so this is reported rather than
 *   spent, and a DM applies it.
 *
 * A branch of an alternation may be **gated**, which is the Clay Golem's "or
 * it makes three Slam attacks if it used Hasten this turn": a sequence the
 * creature is offered only on a turn it took the line the gate names. The gate
 * and the branch are one value because they have to arrive together — a branch
 * read without a gate anything could evaluate is three Slams given away free,
 * which is the whole reason the sentence went unread until the spend existed.
 *
 * Absent for the sentences that still say something else: a use in the middle
 * of the sequence rather than trailing it (the Roper's Reel) and a count that
 * reads off a fact nobody has declared (the Hydra's heads). Each of those is a
 * mechanism of its own, and half of one read into this shape would be a rule
 * nobody printed.
 */
export const MonsterMultiattackSchema = z
  .object({
    entries: z.array(MonsterMultiattackEntrySchema).min(1).optional(),
    alternatives: z.array(MonsterMultiattackBranchSchema).min(2).optional(),
    handOver: z.string().min(1).optional(),
  })
  .refine(
    (m) => (m.entries === undefined) !== (m.alternatives === undefined),
    'a Multiattack states one sequence or a choice of them, never both and never neither',
  )
  .refine(
    (m) => m.alternatives === undefined || m.alternatives.some((b) => gateOfBranch(b) === null),
    // A creature whose every branch is gated has no Attack action on an
    // ordinary turn, which is not a thing the book prints — and reading one
    // would leave `sequenceTotal` taking a maximum over nothing.
    'an alternation offers at least one sequence nothing gates',
  );
export type MonsterMultiattack = z.infer<typeof MonsterMultiattackSchema>;

/**
 * The saving throw a printed line forces, read out of the book's other
 * template.
 *
 * `_Dexterity Saving Throw:_ DC 12, each creature in a 15-foot Cone.
 * _Failure:_ 17 (5d6) Fire damage. _Success:_ Half damage.` is as regular a
 * sentence as `_Melee Attack Roll:_` is — every dragon wyrmling's breath, the
 * Hell Hound's, the Winter Wolf's — and it carries the two numbers the Engine
 * must supply itself rather than ask a caller for: the DC and the dice.
 *
 * How many lines that is, is `COVERAGE.md`'s to say, and the gap between the
 * lines that force *a* save and the lines that write *this sentence* is wide:
 * most of the book's saves say something this shape cannot hold.
 *
 * **Who it catches is not read.** "Each creature in a 15-foot Cone" needs an
 * origin and a facing nobody has declared, and a Cone measured out of a
 * sentence would be the engine inventing a fact. So the clause is carried
 * verbatim, the table says who is in it, and the engine does the part a table
 * may not: the save, the dice, and the half.
 *
 * **Only the template.** Anything the sentence says besides damage — a
 * condition after it, a second rung of failure, a trigger before it, a type
 * another trait chooses — leaves this absent and the line prose, which is
 * where it already was. A save read down to the part that fits is a rule
 * nobody printed.
 */
/**
 * How long a clause a printed save imposes lasts.
 *
 * Two spellings and the corpus prints both: a turn anchor — "until the start of
 * its next turn" is the target's, "until the end of the mephit's next turn" is
 * the source's — and a span in hours or minutes. Kept as words rather than as
 * the engine's `Duration`, because this package knows no creature ids; the
 * executor resolves `target` and `source` to the two creatures in the save.
 */
/**
 * The half of a span that is a reading of the clock.
 *
 * Split out because one slot takes this and not the turn anchor beside it: a
 * **deepened** condition's lifetime — see `repeats.onFailure` below — is a
 * span in minutes wherever the book prints one, and a turn anchor there would
 * be the very moment the repeat fires on, which is the race the first rung is
 * already held away from.
 */
export const PrintedSecondsSchema = z.object({
  kind: z.literal('seconds'),
  seconds: z.number().int().min(1),
});
export type PrintedSeconds = z.infer<typeof PrintedSecondsSchema>;

export const PrintedSpanSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('turn'),
    moment: z.enum(['start', 'end']),
    of: z.enum(['target', 'source']),
  }),
  PrintedSecondsSchema,
]);
export type PrintedSpan = z.infer<typeof PrintedSpanSchema>;

/**
 * One thing a printed save's failure (or its "Failure or Success" coda) does
 * besides damage — the small vocabulary `parsePrintedSave` reads the book's
 * regular clauses into, each a primitive the engine already has.
 *
 * - `condition`: "the target has the Frightened condition until the start of
 *   the lion's next turn"; with `escapeDc` it is a grapple; `ifNoLargerThan`
 *   is the size gate "If the target is a Medium or smaller creature";
 *   `repeats` is "repeats the save at the end of each of its turns, ending the
 *   effect on itself on a success", capped where "After 1 minute, it succeeds
 *   automatically".
 * - `push`: "pushed up to 20 feet straight away from the elemental".
 * - `speed-decrease`: "the target's Speed decreases by 10 feet until…".
 * - `hit-point-maximum-decrease`: "the target's Hit Point maximum decreases
 *   by an amount equal to the damage taken".
 * - `roll-mode`: "While Deafened, the target also has Disadvantage on ability
 *   checks and attack rolls" — a mode whose lifetime is the condition instance
 *   the same failure imposed.
 * - `action-rule`: "it can take either an action or a Bonus Action on its
 *   turn, not both", "it can't take Reactions" — a rule about what the
 *   target's own turn may hold.
 * - `speed-halved`: "its Speed is halved".
 */
/** The conditions a printed clause may name, by the engine's own keys. */
export const PrintedConditionSchema = z.enum([
  'blinded',
  'charmed',
  'deafened',
  'exhaustion',
  'frightened',
  'grappled',
  'incapacitated',
  'invisible',
  'paralyzed',
  'petrified',
  'poisoned',
  'prone',
  'restrained',
  'stunned',
  'unconscious',
]);

/**
 * The slots of a turn a printed rule may name, by the engine's own keys.
 *
 * The same two-vocabulary seam {@link PrintedConditionSchema} is: this package
 * knows nothing of the engine's `ActionSlot` and may not import it, so the
 * four words are written out here and the executor is where the two meet. A
 * word added on one side and not the other is a compile error at that seam,
 * which is the guard — see `printed-save-clauses.ts`.
 */
export const PrintedSlotSchema = z.enum(['action', 'bonus-action', 'reaction', 'movement']);

/**
 * A rule a printed line puts on the target's turn.
 *
 * **Two members, because the corpus prints two sentences here.** The engine's
 * own `ActionRule` says five things — a slot or a named action taken away, one
 * slot narrowed to a named few, a named action re-priced, an extra action
 * handed over, and slots coupled to one another — and a stat block's failure
 * clause prints only the first and the last. The other three arrive with the
 * line that prints one, which is the rule `NAMED_ACTIONS` in the engine is kept
 * by: a member here is a promise that some sentence in the book asks for it.
 *
 * - `forbids`: SRD Dretch, SRD Copper Dragon Wyrmling — "it can't take
 *   Reactions".
 * - `one-of`: SRD Dretch, SRD Copper Dragon Wyrmling — "it can take either an
 *   action or a Bonus Action on its turn, not both". The list is the slots
 *   coupled to each other, and it is a list rather than a pair because SRD Ice
 *   Devil prints the same rule over movement and the action: "it can move or
 *   take one action on its turn, not both".
 *
 * No named actions, for the same reason: no printed save names one. A block
 * that did would say so in a member with a vocabulary of its own.
 */
export const PrintedActionRuleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('forbids'), slots: z.array(PrintedSlotSchema).min(1) }),
  z.object({ kind: z.literal('one-of'), slots: z.array(PrintedSlotSchema).min(2) }),
]);
export type PrintedActionRule = z.infer<typeof PrintedActionRuleSchema>;

/**
 * Every clause but the branch, which is the one member that holds others.
 *
 * Split out rather than made recursive, and the split *is* the rule: a branch
 * may hold clauses and a clause may not hold a branch. No SRD line prints a
 * ceiling under a ceiling, and `z.lazy` would buy a shape nobody wrote at the
 * cost of the inference every reader of this union depends on.
 */
/**
 * The save a clause retakes at a turn boundary, without what a failure buys.
 *
 * The book prints this sentence twice in one line where it grades a failure —
 * once on the condition the first rung imposed and once on the deeper
 * condition the second rung replaces it with — so it is written once and
 * spread into both. The failure branch belongs to the **outer** one alone:
 * there is no third rung anywhere in the corpus.
 */
const PRINTED_REPEAT = {
  at: z.literal('end'),
  of: z.literal('target'),
  /** "After 1 minute, it succeeds automatically." */
  capSeconds: z.number().int().min(1).optional(),
} as const;

/**
 * What a hold hands over at every one of somebody's turn boundaries, as a
 * printed save states it.
 *
 * SRD Water Elemental's Whelm: "Until the grapple ends, the target … takes 9
 * (2d8) Bludgeoning damage **at the start of each of the elemental's turns**."
 *
 * The same record the hit side's `PrintedHoldPayout` keeps, because it is the
 * same sentence: the Stirge's attach writes it after an attack roll and the
 * elemental's whelm writes it after a saving throw, and the only thing that
 * differs is which door the hold came through. **`onTurnOf` is the
 * load-bearing field** — the elemental collects at its *own* boundary and the
 * damage lands on the creature it is holding, and the two are a round apart.
 *
 * The dice are a notation rather than a total, as everywhere else in this
 * file: a payment that repeats throws a new die at each boundary.
 */
export const PrintedSavePayoutSchema = z.object({
  damage: MonsterDamageSchema,
  /** "at the **start** of each of …'s turns". */
  at: z.enum(['start', 'end']),
  /** Whose boundary collects it — "the elemental's" is the source's, "its" the target's. */
  onTurnOf: z.enum(['target', 'source']),
});
export type PrintedSavePayout = z.infer<typeof PrintedSavePayoutSchema>;

const PRINTED_SAVE_CLAUSES = [
  z.object({
    kind: z.literal('condition'),
    condition: PrintedConditionSchema,
    lasts: PrintedSpanSchema.optional(),
    escapeDc: z.number().int().min(1).optional(),
    ifNoLargerThan: CreatureSizeSchema.optional(),
    /**
     * What the **hold** this clause makes costs at a turn boundary.
     *
     * SRD Water Elemental's Whelm, read only onto a grapple — the sentence
     * says "until the grapple ends", so a payout with no hold would be a debt
     * nothing could ever settle. {@link PrintedSavePayout} is the record, and
     * `applyPrintedClauses` files it under the grapple's own source so
     * `holdStillStands` stops reading it the moment the escape succeeds.
     */
    payout: PrintedSavePayoutSchema.optional(),
    /**
     * Which of the conditions **this clause imposes** end the moment the
     * creature takes damage.
     *
     * SRD Incubus' Nightmare: "it has the Unconscious condition for 1 hour,
     * **until it takes damage**, or until a creature within 5 feet of it takes
     * an action to wake it." SRD Pseudodragon's Sting says the same of the
     * Unconscious its Poisoned carries.
     *
     * **A list of names rather than a flag**, because the clause may impose
     * more than one condition and the book ends only one of them: the
     * Pseudodragon's hour of Poison runs on and the sleep it carries is what
     * a blow lifts. Every name here is this clause's own condition or one of
     * its {@link implies}; the executor marks the instances it landed and
     * ignores a name it did not.
     */
    endsOnDamage: z.array(PrintedConditionSchema).min(1).optional(),
    /**
     * Which of the conditions **this clause imposes** a neighbour's action
     * ends — "until a creature within 5 feet of it takes an action to wake
     * it".
     *
     * {@link endsOnDamage}'s twin: the book prints the two halves in one
     * sentence and the engine spends them through two doors, a blow and
     * `wakeCreature`.
     */
    endsWhenWoken: z.array(PrintedConditionSchema).min(1).optional(),
    /**
     * The **thing the line creates** that this condition lasts as long as.
     *
     * SRD Giant Spider's Web: "The target has the Restrained condition until
     * the web is destroyed (AC 10; HP 5; Vulnerability to Fire damage;
     * Immunity to Poison and Psychic damage)." SRD Ettercap's Web Strand
     * prints the same sentence with one more immunity.
     *
     * **A lifetime that is a thing rather than a clock**, which is what makes
     * it a field of its own rather than a span: the web has an Armour Class,
     * Hit Points and defences of its own, somebody may burn it, and the
     * Restrained ends the moment they do — and never otherwise, because the
     * sentence prints no repeat.
     *
     * Every number here is the line's; nothing is read off the Object Hit
     * Points table, because the book printed them rather than pointing at it.
     */
    heldByObject: z
      .object({
        /** The book's own noun for the thing — SRD's "web". */
        noun: z.string().min(1),
        /** SRD's "AC 10". */
        armorClass: z.number().int().min(1),
        /** SRD's "HP 5". */
        hitPoints: z.number().int().min(1),
        /** SRD's "Vulnerability to Fire damage", by the engine's own keys. */
        vulnerabilities: z.array(z.string().min(1)).min(1).optional(),
        /** SRD's "Resistance to …", where a line prints one. */
        resistances: z.array(z.string().min(1)).min(1).optional(),
        /** SRD's "Immunity to Bludgeoning, Poison, and Psychic damage". */
        immunities: z.array(z.string().min(1)).min(1).optional(),
      })
      .optional(),
    /**
     * Conditions **this** cause carries for exactly as long as it lasts.
     *
     * SRD Couatl: "The target has the Grappled condition (escape DC 13), and
     * it has the Restrained condition until the grapple ends." SRD Chuul:
     * "While Poisoned, the target has the Paralyzed condition." One sentence
     * naming a lifetime that is another condition's, which is the lifetime
     * `ConditionInstance.impliedBy` already has — so the executor hands it to
     * `applyConditionTo` and the implied condition lifts with the cause that
     * carried it, through the doors that already exist.
     *
     * **Per source rather than a fact about the condition.** A Wolf's grapple
     * carries nothing and a Couatl's carries Restrained, so this cannot live
     * in the engine's static `IMPLIES` table; it is the printed half of the
     * same sentence a hit's `whileHeld` reads.
     */
    implies: z.array(PrintedConditionSchema).min(1).optional(),
    repeats: z
      .object({
        ...PRINTED_REPEAT,
        /**
         * What a **failed** repeat leaves behind, where the line grades its
         * failures.
         *
         * SRD Gorgon: "_First Failure:_ The target has the Restrained
         * condition and repeats the save at the end of its next turn…
         * _Second Failure:_ The target has the Petrified condition instead of
         * the Restrained condition." The engine's `RepeatSave.onFailure` is
         * this field word for word: the deeper condition lands under the same
         * source, the shallow one goes, and the timer that raised the save
         * goes with it — so the save is repeated once, which is the book's
         * "second" failure.
         *
         * **And a deepening may carry a lifetime of its own**, which the two
         * dragon families are why. SRD Brass Dragon Wyrmling deepens to an
         * Unconscious *for 1 minute* — {@link lasts}, a span on the clock, the
         * one the book ever prints here — and SRD Silver Dragon Wyrmling to a
         * Paralyzed that *repeats the save at the end of each of its turns*,
         * which is {@link repeats}: a standing obligation on the deeper
         * condition, capped where the line says it succeeds automatically
         * after a minute. The deepened condition is applied fresh and
         * scheduled fresh, which is what makes either sayable here where the
         * first rung may say neither beside its own repeat.
         *
         * **No third rung**, because the book prints none at any tier: the
         * nested repeat has the shape of the one above it with the failure
         * branch taken off.
         */
        onFailure: z
          .object({
            condition: PrintedConditionSchema,
            lasts: PrintedSecondsSchema.optional(),
            repeats: z.object(PRINTED_REPEAT).optional(),
            /**
             * SRD Brass Dragon Wyrmling: "The target has the Unconscious
             * condition for 1 minute. **This effect ends for the target if it
             * takes damage** or a creature within 5 feet of it takes an action
             * to wake it."
             *
             * A flag rather than the list the first rung carries, because a
             * deepening is exactly one condition: there is nothing else here
             * for a name to pick out.
             */
            endsOnDamage: z.literal(true).optional(),
            /** The other half of the same sentence — see `wakeCreature`. */
            endsWhenWoken: z.literal(true).optional(),
          })
          .optional(),
      })
      .optional(),
  }),
  z.object({ kind: z.literal('push'), feet: z.number().int().min(5) }),
  z.object({
    kind: z.literal('speed-decrease'),
    feet: z.number().int().min(5),
    lasts: PrintedSpanSchema,
  }),
  /**
   * SRD Wight: "The target's Hit Point maximum decreases by an amount equal to
   * the damage taken." SRD Vampire Spawn writes the same clause over one
   * component of the blow and hands the amount to the biter: "equal to the
   * **Necrotic** damage taken, and the vampire regains Hit Points equal to
   * that amount."
   */
  z.object({
    kind: z.literal('hit-point-maximum-decrease'),
    by: z.literal('damage-taken'),
    /**
     * The one component of the blow the sentence names, where it names one.
     *
     * SRD Vampire Spawn's Bite deals "5 (1d4 + 3) Piercing damage plus 10
     * (3d6) Necrotic damage" and lowers the maximum by the Necrotic alone.
     * Absent is the Wight's reading and the older one: the whole of what the
     * line dealt.
     */
    ofType: z.string().min(1).optional(),
    /**
     * SRD Vampire Spawn: "and the vampire regains Hit Points equal to that
     * amount."
     *
     * A literal rather than a number or dice, because the sentence names no
     * amount of its own: what the biter regains **is** what the target lost,
     * which is the number this clause has just computed. The Will-o'-Wisp's
     * `dies.sourceRegains` is the neighbouring shape and rolls its own dice,
     * which is why the two are spelled differently rather than shared.
     */
    sourceRegains: z.literal('the-amount').optional(),
  }),
  /**
   * SRD Swarm of Ravens: "The target has the Deafened condition until the
   * start of the swarm's next turn. **While Deafened, the target also has
   * Disadvantage on ability checks and attack rolls.**"
   *
   * A mode hung on the creature, and the one thing about it that is not the
   * mode every other door grants is **how long it lasts**: the sentence names
   * no span at all. What it names is a condition, and not the condition in
   * general — the one *this failure* just imposed. So the lifetime is that
   * condition instance's, and {@link whileCondition} is how the clause says
   * which: the executor sources the grant to the instance id, and the instance
   * lifting takes it, whether the printed span ran out or a cure lifted it
   * early.
   *
   * **And now a lifetime of its own, where the line prints one.** SRD Gold
   * Dragon Wyrmling's Weakening Breath: "The target has Disadvantage on
   * Strength-based D20 Tests and subtracts 2 (1d4) from its damage rolls. It
   * repeats the save at the end of each of its turns, ending the effect on
   * itself on a success. After 1 minute, it succeeds automatically." The
   * failure imposes no condition, so there is no instance for the mode to
   * live on; what it prints instead is a repeat save and a cap, which is the
   * same pair a `condition` clause carries in {@link repeats}. So a mode may
   * carry {@link whileCondition}, {@link lasts} or {@link repeats}, and the
   * reader insists on exactly one — a mode with none would be a Disadvantage
   * nothing ever lifts, which is the refusal it has always made.
   */
  z.object({
    kind: z.literal('roll-mode'),
    /**
     * Advantage or Disadvantage, as the sentence prints it.
     *
     * Both, although the corpus prints only Disadvantage in this position:
     * the two words are one grammar and {@link PrintedConditionSchema} sets
     * the precedent of typing the closed vocabulary rather than only the
     * members some line happens to use.
     */
    mode: z.enum(['advantage', 'disadvantage']),
    /**
     * Which of the holder's own rolls the sentence names, in the order it
     * prints them.
     *
     * The book's three nouns, exactly as `disadvantage-in-sunlight` above
     * spells them and for the same reason: this package knows nothing of the
     * engine's `RollFamily`, and the executor is where the two vocabularies
     * meet.
     *
     * **The holder's rolls and not rolls against them.** Every sentence the
     * corpus prints here says what the *target* has Disadvantage on; a line
     * that gave attackers Advantage against it would be the other relation and
     * would need a field to say so.
     *
     * **`d20-test` is the glossary's own union of the other three** — "D20
     * Tests encompass the three main d20 rolls of the game" — and it arrives
     * with the sentence that needs it: SRD Gold Dragon Wyrmling's
     * "Disadvantage on Strength-based D20 Tests". It is one word in the book
     * and one member here, and the engine's `RollFamily` has the same member
     * for the same reason. A `d20-test` must be narrowed by {@link ability},
     * which the reader enforces: a bare one would reach every roll its holder
     * ever made, and the engine's own selector validator refuses exactly that.
     */
    rolls: z.array(z.enum(['ability-check', 'attack-roll', 'saving-throw', 'd20-test'])).min(1),
    /**
     * The ability the family is narrowed by — SRD's "**Strength**-based D20
     * Tests". Present exactly where `rolls` names `d20-test`, and the reader is
     * what insists on the pairing.
     */
    ability: z.enum(['str', 'dex', 'con', 'int', 'wis', 'cha']).optional(),
    /**
     * The condition in the **same failure** whose instance this lives on.
     *
     * One of the three lifetimes, and the one every line before the Weakening
     * Breath printed. The reader refuses the sentence where the clause names a
     * condition this failure did not impose, and so does the executor where
     * the condition did not land — an immune target has no instance to hang it
     * on.
     */
    whileCondition: PrintedConditionSchema.optional(),
    /** The span the line prints, where it prints one — the second lifetime. */
    lasts: PrintedSpanSchema.optional(),
    /**
     * The save the target repeats to end the effect, with its cap — the third
     * lifetime, and the Weakening Breath's. The same record a `condition`
     * clause carries, because it is the same sentence: "It repeats the save at
     * the end of each of its turns, ending the effect on itself on a success.
     * After 1 minute, it succeeds automatically."
     */
    repeats: z.object(PRINTED_REPEAT).optional(),
  }),
  /**
   * SRD Gold Dragon Wyrmling's Weakening Breath: "subtracts 2 (1d4) from its
   * damage rolls."
   *
   * **A penalty on the target's own damage rolls**, which is the engine's
   * `damage-penalty` grant — the mirror of a damage reduction, standing on
   * whoever *swung* rather than on whoever was hit, built for SRD Ray of
   * Enfeeblement's "subtracts 1d8 from all its damage rolls". The dice are the
   * block's and are thrown where the damage is rolled, never here.
   *
   * Its lifetime reads exactly as `roll-mode`'s: one of the three, and the
   * reader is what insists on it. The Weakening Breath prints the mode and
   * the penalty under one repeat save, so the executor files both under one
   * source and one timer — one save ends both, which is what "ending the
   * effect on itself" says.
   */
  z.object({
    kind: z.literal('damage-penalty'),
    /** The notation the book prints inside the parenthesis — "1d4". */
    dice: z.string().regex(/^\d+d\d+$/),
    /** A flat addend beside the dice, where the book prints one; 0 otherwise. */
    flat: z.number().int(),
    /** The average the book prints beside the dice, for narration. */
    average: z.number().int().min(1),
    whileCondition: PrintedConditionSchema.optional(),
    lasts: PrintedSpanSchema.optional(),
    repeats: z.object(PRINTED_REPEAT).optional(),
  }),
  /**
   * SRD Dretch: "While Poisoned, the creature can take either an action or a
   * Bonus Action on its turn, not both, and it can't take Reactions." SRD
   * Copper Dragon Wyrmling: "The target can't take Reactions; its Speed is
   * halved; and it can take either an action or a Bonus Action on its turn,
   * not both. This effect lasts until the end of its next turn."
   *
   * **A rule about a turn, with a lifetime that may be either kind.** The two
   * blocks print one rule in two dressings, and it is the dressing rather than
   * the rule that differs: the Dretch hangs it on the condition the same
   * failure imposed, exactly as the Ravens' `roll-mode` above is hung, and the
   * Copper Dragon prints a span once underneath a list of clauses. So this
   * carries both fields where `roll-mode` carries only the host and
   * `speed-decrease` only the span — not because a clause may say both, but
   * because the corpus prints one of each.
   *
   * **Exactly one of them, which `parsePrintedSave` enforces and this schema
   * does not.** The `dies` clause below sets the precedent and gives the
   * reason: a discriminated union's member may not carry a refinement, so the
   * field is optional here and required by the reader. A clause reaching the
   * executor with neither is a rule nothing would ever lift, and the executor
   * hands it to the table rather than hanging it.
   */
  z.object({
    kind: z.literal('action-rule'),
    rule: PrintedActionRuleSchema,
    /** The span the line prints, where it prints one. */
    lasts: PrintedSpanSchema.optional(),
    /** The condition in the **same failure** whose instance this lives on. */
    whileCondition: PrintedConditionSchema.optional(),
  }),
  /**
   * SRD Copper Dragon Wyrmling: "its Speed is halved". SRD Adult Brass
   * Dragon's Scorching Sands prints the same clause with a span of its own.
   *
   * **Not `speed-decrease` with a number**, and the difference is the whole of
   * why it is a member: a decrease takes printed feet away and a halving is an
   * operation on whatever the Speed turns out to be. The engine has had both
   * since Slow was written — `SpeedChange` names `add`, `halve` and `zero` —
   * and `halve` is presence rather than count, so two halvings are one.
   *
   * Its lifetime reads exactly as the clause above it: one of the two, and the
   * reader is what insists on it.
   */
  z.object({
    kind: z.literal('speed-halved'),
    lasts: PrintedSpanSchema.optional(),
    whileCondition: PrintedConditionSchema.optional(),
  }),
  /**
   * SRD Will-o'-Wisp: "_Failure:_ The target dies, and the wisp regains 10
   * (3d6) Hit Points."
   *
   * **Death that is not damage**, which is the engine's own distinction:
   * `creature-died` exists because "a healthy creature taking exactly its
   * maximum in damage drops to 0, it does not die".
   *
   * **The restriction the line prints on who it may be forced on is read, not
   * handed over**, and it is the one part of a targeting clause that is. Who
   * stands in a Cone needs an origin and a facing nobody declared, so that
   * stays the table's — but "that has 0 Hit Points" is a number the engine
   * already holds about a creature somebody named, and a sentence that kills
   * outright is the last one to take on trust. A `dies` with no gate on it is
   * a clause the reader refuses, which is why the field is optional in the
   * schema and required by `parsePrintedSave`.
   *
   * **One effect rather than two**, because the book joins them with "and" and
   * the second half has no other sentence in the corpus: a `source-heals`
   * clause standing alone would be a shape with no line asking for it.
   */
  z.object({
    kind: z.literal('dies'),
    /**
     * SRD Will-o'-Wisp's "that has 0 Hit Points", read off the targeting
     * clause: above it the line kills nobody and says so.
     */
    ifHitPointsAtMost: z.number().int().min(0).optional(),
    /** What the creature that forced the save regains by it, where it does. */
    sourceRegains: z
      .object({
        dice: z.string().regex(/^\d+d\d+$/),
        flat: z.number().int(),
        /** The average the book prints beside the dice, for narration. */
        average: z.number().int().min(1),
      })
      .optional(),
  }),
  /**
   * SRD Sea Hag: "_Failure:_ If the target has 20 Hit Points or fewer, **it
   * drops to 0 Hit Points**."
   *
   * **A creature reaching 0 that was not hurt to get there.** Damage is the
   * wrong instrument and the difference is observable four ways: Temporary Hit
   * Points would soak it, a Concentration save would answer it, SRD Relentless
   * Endurance and SRD Undead Fortitude would each stand in front of it, and
   * none of that is in the sentence. The engine's `hit-points-dropped-to-zero`
   * is the instrument, and it is not `dies` either — a character that drops is
   * Unconscious and dying, and may still be healed back up.
   *
   * **Read only inside a {@link PrintedSaveEffectSchema} branch**, which is
   * the same gate a `dies` has for the same reason: a sentence that takes a
   * creature to 0 with no ceiling on who it may reach would be a rule nobody
   * printed.
   */
  z.object({ kind: z.literal('drops-to-zero') }),
  /**
   * SRD Ghost: "_Success:_ The target is immune to this ghost's Horrific
   * Visage for 24 hours." SRD Mummy's Dreadful Glare prints the same sentence.
   *
   * **An immunity to one printed line, which is not an immunity to a
   * condition.** A creature that shrugs off the visage is still Frightenable
   * by everything else in the room — by a second ghost's visage, by a Lion's
   * Roar, by Fear — and what it has bought is a day's grace from *this*
   * creature's *this* line. So the engine hangs it on the line's own source
   * (`printed:<who>:<heading>`) with a `grants` deadline over it, and
   * `forcePrintedSave` reads it when it gathers who the line caught.
   *
   * **The heading is carried and checked**, because the sentence names it —
   * "this ghost's **Horrific Visage**" — and the reader is handed the line's
   * text without its heading. The executor compares the two and hands the
   * sentence over where they disagree, rather than granting an immunity to a
   * line the book did not name.
   */
  z.object({
    kind: z.literal('line-immunity'),
    /** The heading the sentence names — SRD's "Horrific Visage". */
    line: z.string().min(1),
    /** SRD's "for 24 hours", in seconds. */
    seconds: z.number().int().min(1),
  }),
] as const;

const PrintedSaveClauseSchema = z.discriminatedUnion('kind', PRINTED_SAVE_CLAUSES);

export const PrintedSaveEffectSchema = z.discriminatedUnion('kind', [
  ...PRINTED_SAVE_CLAUSES,
  /**
   * SRD Sea Hag: "_Failure:_ If the target has 20 Hit Points or fewer, it
   * drops to 0 Hit Points. **Otherwise**, the target takes 13 (3d8) Psychic
   * damage." SRD Incubus prints the same shape over an Unconscious and 4d8.
   *
   * **Two sentences that are one rule**, and which of them happens is decided
   * by a number the engine already holds: the target's *current* Hit Points,
   * Temporary Hit Points excluded, read before anything is rolled. So the
   * reader keeps the pair together rather than letting half of it stand — a
   * ceiling with no arm under it decides nothing, and an arm with no ceiling
   * always fires.
   *
   * **The damage lives on the `otherwise` arm rather than on
   * {@link MonsterSaveSchema.damage}**, because it is not the line's damage:
   * it is what happens *instead*, and a total sitting in the line's own field
   * would be rolled on both arms. It is the only thing the corpus prints
   * there — SRD prints no "Otherwise" that is a condition — so that is the
   * whole of the arm.
   */
  z.object({
    kind: z.literal('branch'),
    /** SRD's "If the target has 20 Hit Points or fewer". */
    ifHitPointsAtMost: z.number().int().min(0),
    /** What happens at or below the ceiling. */
    then: z.array(PrintedSaveClauseSchema).min(1),
    /** SRD's "Otherwise, the target takes …", with its `plus` where one is printed. */
    otherwise: z.object({
      damage: MonsterDamageSchema,
      plus: MonsterDamageSchema.optional(),
    }),
  }),
]);
export type PrintedSaveEffect = z.infer<typeof PrintedSaveEffectSchema>;
/** Everything a branch's `then` arm may hold — see {@link PRINTED_SAVE_CLAUSES}. */
export type PrintedSaveClause = z.infer<typeof PrintedSaveClauseSchema>;

/**
 * The further thing a start-of-turn aura asks before it catches anybody.
 *
 * Two sentences and two words, both of them about the creature the aura
 * belongs to rather than about who walked into it:
 *
 * - `holder-not-incapacitated` — SRD Gibbering Mouther: "The mouther babbles
 *   incoherently **while it doesn't have the Incapacitated condition**", and
 *   then "any creature that starts its turn within 20 feet of the mouther
 *   **while it is babbling**." The second sentence names the first, so the two
 *   are read together or neither is; the babbling *is* the Incapacitated
 *   check, which is why there is no third word for it.
 * - `can-see-holder` — SRD Sea Hag: "any Beast or Humanoid that starts its
 *   turn within 30 feet of the hag **and can see the hag's true form**." A
 *   question about sight, which the engine already answers.
 *
 * A closed list rather than the book's own words, because a string nobody can
 * branch on is prose: a sentence this does not hold refuses the trigger and
 * the line stays where it was.
 */
export const PrintedAuraConditionSchema = z.enum(['holder-not-incapacitated', 'can-see-holder']);
export type PrintedAuraCondition = z.infer<typeof PrintedAuraConditionSchema>;

/**
 * The **moment** that forces a line's save, where a moment forces it rather
 * than a creature spending something.
 *
 * Eight CR ≤ 5 lines print one, and the reason they were refused whole for two
 * batches is in `printed-save.ts`'s own docstring: "a trigger or a movement
 * printed before the save … half of each is a rule nobody printed." A save
 * that a caller could set off on purpose is a Death Burst a creature detonates
 * at will, and an aura with no moment is a save nobody ever rolls.
 *
 * So the moment is read, and the engine's own split does the rest:
 * **raising is derived; rolling is commanded.** The fold raises the save the
 * moment settles — a death, a turn beginning inside the aura — and the command
 * that already rolls the saves a boundary owes rolls this one too.
 *
 * - `dies` — SRD Magmin: "The magmin explodes when it dies." The five Death
 *   Bursts at this tier print it word for word, each with its own DC, its own
 *   Emanation and its own damage type.
 * - `starts-turn-within` — SRD Ghast: "any creature that starts its turn in a
 *   5-foot Emanation originating from the ghast."
 *
 * Absent on every line whose save a creature *spends*, which is most of them:
 * a breath weapon, a gaze, a Trample. Those are `forcePrintedSave`'s and
 * always were.
 */
export const PrintedSaveTriggerSchema = z.discriminatedUnion('kind', [
  /** SRD's "The X explodes when it dies", read off the sentence before the opening. */
  z.object({ kind: z.literal('dies') }),
  z.object({
    kind: z.literal('starts-turn-within'),
    /** How far the aura reaches, in feet, off the targeting clause. */
    feet: z.number().int().min(5),
    /**
     * Whether the book wrote it as an Emanation rather than as a plain radius.
     *
     * Carried because the two are not the same measurement: an Emanation is
     * measured from the creature's **space** outward and so takes its size
     * into account, and "within 20 feet of the mouther" is a ruler between two
     * creatures. The engine holds both and picks by this flag.
     */
    emanation: z.literal(true).optional(),
    /** The further question the sentence asks — see {@link PrintedAuraConditionSchema}. */
    onlyIf: PrintedAuraConditionSchema.optional(),
  }),
]);
export type PrintedSaveTrigger = z.infer<typeof PrintedSaveTriggerSchema>;

export const MonsterSaveSchema = z.object({
  /** Which save, by the engine's own key: `con` for "Constitution". */
  ability: z.enum(['str', 'dex', 'con', 'int', 'wis', 'cha']),
  /** The DC the block prints, used whole, exactly as a printed AC is. */
  dc: z.number().int().min(1),
  /** Who the line catches, verbatim: "each creature in a 15-foot Cone". */
  targets: z.string().min(1),
  /**
   * The moment that forces this save, where a moment forces it rather than a
   * creature spending an Action — see {@link PrintedSaveTriggerSchema}.
   *
   * Absent is what every line read before this batch had, and it means the
   * line is spent: `forcePrintedSave` takes it, the heading says what it
   * costs, and the caller names who it caught.
   */
  trigger: PrintedSaveTriggerSchema.optional(),
  /**
   * The creature **types** the targeting clause narrows the line to.
   *
   * SRD Sea Hag's Vile Appearance: "any **Beast or Humanoid** that starts its
   * turn within 30 feet of the hag". The book's own capitalised words, because
   * a creature's type is a string the engine carries rather than an enum it
   * owns — `creature-type-declared` writes exactly this vocabulary.
   *
   * Beside {@link onlyIfTargetHas} rather than inside it, and for the same
   * reason that field sits where it does: both are facts about **who the line
   * may be forced on** rather than about what a failure does, and this one is
   * a fact the engine may not know — a creature nobody has typed is asked
   * about rather than spared.
   */
  onlyIfTargetType: z.array(z.string().min(1)).min(1).optional(),
  /**
   * SRD Gold Dragon Wyrmling's Weakening Breath: "each creature **that isn't
   * currently affected by this breath** in a 15-foot Cone."
   *
   * A third fact a targeting clause gives up, beside the Hit Point ceiling
   * and the conditions, and for the same reason: it is about **who the line
   * may be forced on** and the engine already holds the answer — whether this
   * line's own source is still hung on the creature. A creature under the
   * breath is not asked to save again; it is named to the caller as one the
   * line did not reach, exactly as an immune target is.
   */
  onlyIfNotAffected: z.literal(true).optional(),
  /**
   * What a failure costs in damage, where the line prints damage at all. The
   * same four fields a printed attack's damage has. Absent on a line whose
   * failure is a condition alone — a Lion's Roar.
   */
  damage: MonsterDamageSchema.optional(),
  /** A second component the line prints after `plus`: a Vampire Spawn's Necrotic. */
  plus: MonsterDamageSchema.optional(),
  /**
   * What a success buys — "Half damage", or nothing where the line prints no
   * `_Success:_` clause at all, or where there is no damage to halve.
   *
   * Two members rather than an optional boolean, because the absent case is a
   * rule and not a gap: SRD Satyr's Mockery gives a success nothing, and a
   * success that bought half anyway would be a line the book did not print.
   */
  onSuccess: z.enum(['half', 'none']),
  /**
   * What a **success** does besides halving the damage, where the line prints
   * something it does.
   *
   * SRD Ghost: "_Success:_ The target is immune to this ghost's Horrific
   * Visage for 24 hours." Two blocks print it and both print exactly this
   * clause, which is why the field exists at all: every other `_Success:_` in
   * the corpus is "Half damage" or nothing, and {@link onSuccess} is what says
   * so. A clause here is read the same way a failure's is and executed through
   * the same door.
   */
  onSuccessEffects: z.array(PrintedSaveEffectSchema).min(1).optional(),
  /**
   * The restriction the targeting clause puts on **who the line may be forced
   * on**, where the engine already holds the fact.
   *
   * SRD Vampire Spawn's Bite: "one creature within 5 feet that is willing or
   * that has the Grappled, Incapacitated, or Restrained condition." The
   * conditions are the engine's own to check; willingness is the table's, so
   * the caller says it and the command asks when nobody has.
   *
   * **The second part of a targeting clause this reader takes**, after the Hit
   * Point ceiling a `dies` is gated by, and for the same reason: who stands in
   * a Cone needs an origin and a facing nobody declared, and this is a fact
   * about one creature somebody has already named.
   */
  onlyIfTargetHas: z
    .object({
      /** The conditions the clause lists, in the order it prints them. */
      conditions: z.array(PrintedConditionSchema).min(1),
      /** SRD's "that is willing or …" — the half only a table can answer. */
      orWilling: z.literal(true).optional(),
    })
    .optional(),
  /** What a failure does besides the damage, in the order the line prints it. */
  onFailure: z.array(PrintedSaveEffectSchema).optional(),
  /**
   * What the failure does instead, where the save missed by a margin the line
   * grades.
   *
   * SRD Pseudodragon: "_Failure:_ … the target has the Poisoned condition for
   * 1 hour. _Failure by 5 or More:_ While Poisoned, the target also has the
   * Unconscious condition…" The margin is a fact the engine already has — it
   * rolled the save and the block printed the DC — so this needs nothing from
   * a caller.
   *
   * **The whole list rather than a delta.** `effects` replaces
   * {@link MonsterSave.onFailure} when the margin is reached, so the executor
   * chooses one list and applies it; a delta would need a rule for merging
   * two clauses about one condition, which is a rule nobody printed. The
   * damage is the failure's either way: no SRD line prints a second amount
   * under this heading, and one that did would leave this absent.
   */
  onFailureBy: z
    .object({
      /** SRD's "Failure by 5 or More": the margin at or beyond which it bites. */
      by: z.number().int().min(1),
      effects: z.array(PrintedSaveEffectSchema).min(1),
    })
    .optional(),
  /** What happens whichever way the save went — the `_Failure or Success:_` coda. */
  either: z.array(PrintedSaveEffectSchema).optional(),
  /**
   * The sentences the reader carried and did not read, verbatim.
   *
   * Handed to the table at the moment of use and reported by the ledger as a
   * debt the block still carries: a line with one of these is executed in
   * part, and says so, rather than silently in full.
   */
  handedOver: z.array(z.string().min(1)).optional(),
});
export type MonsterSave = z.infer<typeof MonsterSaveSchema>;

/**
 * The numbers a printed attack line states, read out of the book's template.
 *
 * A 2024 stat block does not describe its attacks in free English: it writes
 * `_Melee Attack Roll:_ +4, reach 5 ft. _Hit:_ 5 (1d6 + 2) Piercing damage`,
 * the same sentence in four hundred blocks. Everything before the rider is a
 * number, and a number the engine must supply itself rather than ask a caller
 * for — the same argument `adaptMonster` makes about a printed Armour Class.
 *
 * **What is deliberately not read are the two English fields.** `rider` is the
 * clause after the damage — "If the target is a Medium or smaller creature, it
 * has the Prone condition", "_Constitution Saving Throw:_ DC 10" — and
 * `qualification` is a condition on the roll itself. Both are effects, and
 * structuring an effect is a vocabulary rather than a template. Dropping
 * either would quietly make the creature weaker than the book prints it, so
 * both travel with the numbers and the command that rolls the attack reports
 * them — each at the moment it would have mattered.
 */
export const MonsterAttackSchema = z.object({
  kind: z.enum(['melee', 'ranged', 'melee-or-ranged']),
  /** The printed bonus to the attack roll, used whole. */
  modifier: z.number().int(),
  /** Feet of reach, for the melee half. Null for a purely ranged attack. */
  reach: z.number().int().min(0).nullable(),
  /** Normal and long range in feet. Null for a purely melee attack. */
  range: z
    .object({ normal: z.number().int().min(0), long: z.number().int().min(0) })
    .nullable(),
  damage: z.array(MonsterDamageSchema).min(1),
  /**
   * A condition the book puts on the **roll**, kept as printed and evaluated
   * by nobody: "with Advantage if the target is Grappled by the ankheg".
   *
   * Its own field rather than part of `rider` because the two are read at
   * different moments. A rider is what a *hit* does, so it is reported when
   * one lands; this could have changed whether the attack landed at all, and
   * the outcome it matters most to is the miss.
   */
  qualification: z.string().min(1).nullable(),
  /** Everything the line says after the damage, verbatim. Null where it says nothing. */
  rider: z.string().min(1).nullable(),
  /**
   * The saving throw the **rider** forces, where the rider is the book's save
   * template printed inside a hit.
   *
   * SRD Cockatrice's Petrifying Bite: "_Hit:_ 3 (1d4 + 1) Piercing damage. If
   * the target is a creature, it is subjected to the following effect.
   * _Constitution Saving Throw:_ DC 11. _First Failure:_ … _Second Failure:_
   * …" SRD Homunculus prints the same shape with a margin rung.
   *
   * **Here rather than in `rider`, and the reason is which reader spends it.**
   * A hit's rider compiles to one effect list against one DC — `HitOption` —
   * and this shape is two lists off one save, which the *printed-save* reader
   * has held since the Gorgon's Petrifying Breath was read. So the sentences
   * are lifted out of the rider at ingest and handed to the reader that
   * already grades a failure, rather than teaching the rider reader to grade a
   * second time. What is left in `rider` is whatever the line said besides.
   *
   * **Beside `save` on the line rather than in it**, because they are two
   * different openings at two different moments: `Feature.save` is a line a
   * creature *spends* and is rolled by whoever forces it, and this one is
   * rolled because a blow landed. A line printing both would be two saves, and
   * the book prints none such.
   */
  riderSave: MonsterSaveSchema.optional(),
});
export type MonsterAttack = z.infer<typeof MonsterAttackSchema>;

/**
 * One spell a printed Spellcasting line offers, and what the line prices it
 * at.
 *
 * `usesPerDay` absent is the book's **At Will**: the line names no limit at
 * all, which is a different sentence from "1/Day" and not a large number.
 */
export const MonsterSpellSchema = z.object({
  /** The SRD spell's own id, looked up rather than slugified off the name. */
  spellId: z.string().regex(/^[a-z0-9-]+$/),
  /** The name exactly as the line prints it, for narration and refusals. */
  name: z.string().min(1),
  /** "2/Day Each" is 2. Absent for an At Will spell, which has no limit. */
  usesPerDay: z.number().int().min(1).optional(),
  /**
   * The parenthetical the line prints after this spell's name, verbatim.
   *
   * "(self only)", "(level 4 version)", "(lasts 24 hours; ends early if the
   * dryad casts the spell again)" — riders on one casting of one spell, and
   * every one of them is a rule this structure has no field for. Carried
   * rather than dropped, and handed to the table when that spell is cast,
   * exactly as an attack line's unread clause is.
   */
  handOver: z.string().min(1).optional(),
});
export type MonsterSpell = z.infer<typeof MonsterSpellSchema>;

/**
 * The Spellcasting line a stat block prints, read whole.
 *
 * "The cultist casts one of the following spells, using Wisdom as the
 * spellcasting ability (spell save DC 12, +4 to hit with spell attacks): **At
 * Will:** _Light_, _Thaumaturgy_ **2/Day:** _Command_ **1/Day:** _Hold
 * Person_" — one regular template with small variations, printed by thirty-odd
 * blocks and by twelve at CR 5 or below.
 *
 * **The numbers are the block's and not a derivation.** All but one of the
 * blocks that print a pair print what their own abilities derive; the Adult
 * Bronze Dragon prints "spell save DC 17" over a Charisma and a Proficiency
 * Bonus that give 18. A printed number and a derived one are not
 * distinguishable after the fact — the lesson a Death Dog's printed rider DC
 * taught — so a printed DC is carried, and a block that prints none (SRD
 * Priest Acolyte) is left to derive.
 *
 * **Read whole or not at all**, which is the discipline every shape in this
 * file keeps: a category this cannot price, a spell name the SRD's own index
 * does not hold, or a scrap of the line left unconsumed leaves the whole line
 * prose. Half a spell list read is a creature casting spells nobody gave it.
 */
export const MonsterSpellcastingSchema = z.object({
  /** "using Wisdom as the spellcasting ability", by the engine's own key. */
  ability: z.enum(['str', 'dex', 'con', 'int', 'wis', 'cha']),
  /** The save DC the line prints, where it prints one. */
  saveDc: z.number().int().min(1).optional(),
  /** "+4 to hit with spell attacks", where the line prints it. */
  attackBonus: z.number().int().optional(),
  spells: z.array(MonsterSpellSchema).min(1),
});
export type MonsterSpellcasting = z.infer<typeof MonsterSpellcastingSchema>;

/**
 * One line that casts named spells, at the price the **line** prints.
 *
 * SRD Priest, Divine Aid (3/Day): "The priest casts _Bless, Dispel Magic,
 * Healing Word,_ or _Lesser Restoration,_ using the same spellcasting ability
 * as Spellcasting." SRD Dust Mephit, Sleep (1/Day): "The mephit casts the
 * _Sleep_ spell, requiring no spell components and using Charisma as the
 * spellcasting ability (spell save DC 10)."
 *
 * **The book's fourth opening, and it is not {@link MonsterSpellcastingSchema}.**
 * That line declares a list with a price against each entry and is a property
 * of the creature; this one is a *use of a heading*, whose economy is the
 * heading's own — an N/Day count or a recharge over the whole menu, spent
 * whichever spell is chosen. So the shape carries no per-spell budget at all:
 * the number of uses is `Feature.perDay`, where the book prints it.
 *
 * **The ability is a reference as often as it is a value.** "using the same
 * spellcasting ability as Spellcasting" names the block's own Spellcasting
 * line rather than an ability, and a block that prints no such line has not
 * said which — so `spellcasting` is carried as the reference it is and
 * resolving it (or refusing to) is the engine's, not this reader's. A line
 * that states an ability outright states it here.
 *
 * **"Requiring no spell components" is dropped on purpose.** The engine models
 * no components, so the clause changes nothing it could check; it is fiction
 * the narrating layer already has in the sentence it is handed.
 */
export const MonsterCastLineSchema = z.object({
  /**
   * The spells the line offers, in the order it prints them, by SRD id.
   *
   * A menu rather than one spell because four of the six SRD lines print one:
   * "casts _Bless, Dispel Magic, Healing Word,_ or _Lesser Restoration_". One
   * of them is chosen per use, which is a decision the *caller* makes and this
   * shape only has to hold the list of legal answers.
   */
  spells: z.array(z.string().regex(/^[a-z0-9-]+$/)).min(1),
  /**
   * Whose ability the casting uses: the block's Spellcasting line, or one the
   * line names outright.
   */
  ability: z.union([
    z.literal('spellcasting'),
    z.enum(['str', 'dex', 'con', 'int', 'wis', 'cha']),
  ]),
  /**
   * The save DC the line prints, where it prints one — the Dust Mephit's 10.
   *
   * Carried rather than derived for {@link MonsterSpellcastingSchema}'s
   * reason: a printed number and a derived one are not distinguishable after
   * the fact, and a line that prints none is left to derive.
   */
  saveDc: z.number().int().min(1).optional(),
  /**
   * The line casts **on the creature itself**, and on nothing else.
   *
   * SRD Imp, Quasit and Sprite: "The imp casts _Invisibility_ **on itself**,
   * requiring no spell components and using Charisma as the spellcasting
   * ability"; SRD Oni prints it under Bonus Actions. A target the sentence
   * fixes rather than one the caller chooses — the one clause of those four
   * lines that the menu above cannot say, and the reason they were prose.
   *
   * Absent is every other line in the book, where whom the spell reaches is
   * the spell's own rule and the caller's answer.
   */
  selfOnly: z.literal(true).optional(),
});
export type MonsterCastLine = z.infer<typeof MonsterCastLineSchema>;

/**
 * One line that teleports the creature whose block it is.
 *
 * SRD Blink Dog, Teleport (Recharge 4–6): "The dog teleports up to 40 feet to
 * an unoccupied space it can see." SRD Marilith and SRD Nalfeshnee print the
 * same sentence at 120 feet.
 *
 * **Both clauses are the engine's own rules**, which is why this is three
 * fields and not prose: `teleportTo` already measures a distance, refuses an
 * occupied space and reads a declared sight line, because SRD Misty Step
 * prints the same sentence about a caster. So the line is the same mechanism
 * at a different price.
 *
 * **Read whole or not at all.** SRD Lich's Deathly Teleport deals damage
 * around the space it left and SRD Solar's Radiant Teleport forces a save at
 * the destination; SRD Balor's moves a second creature. Each says more than
 * this shape holds, so each stays prose — the discipline every reader in this
 * file keeps.
 */
export const MonsterTeleportSchema = z.object({
  /** "up to 40 feet", measured from where the creature is standing. */
  feet: z.number().int().min(5),
  /**
   * "to an unoccupied space **it can see**" — always, on every line the SRD
   * prints in this shape.
   *
   * A literal rather than a boolean because no printed line says otherwise: a
   * field that is always the same value is still the clause the sentence
   * states, and writing it down is what keeps a homebrew line that *omits* the
   * clause from being read as though it said it.
   */
  mustSee: z.literal(true),
});
export type MonsterTeleport = z.infer<typeof MonsterTeleportSchema>;

/**
 * One shape a creature's own line offers it.
 *
 * SRD Shape-Shift: "The werewolf shape-shifts into a Large wolf-humanoid
 * hybrid or a Medium wolf, or it returns to its true humanoid form."
 *
 * **The name is a word, because the block's other headings gate on it.** "Bite
 * (Wolf or Hybrid Form Only)" names one of these, so the last noun of each
 * alternative is what is read — `hybrid`, `wolf`, `humanoid` — and a line that
 * returns to a form the book gives no noun is `true`.
 */
export const MonsterFormSchema = z.object({
  /** The word the block's qualified headings name this form by. */
  name: z.string().regex(/^[a-z][a-z-]*$/),
  /**
   * The sizes the line prints for this form, in the order it prints them.
   *
   * A list because the book offers a choice — "a Medium or Small Humanoid" —
   * and empty where the line prints none, which is every true form: the
   * sentence says the statistics are the same *other than* the size, so a form
   * with no printed size is the creature's own.
   */
  sizes: z.array(CreatureSizeSchema),
  /**
   * The Speeds this form prints, or null where it prints none.
   *
   * SRD Imp: "a rat (Speed 20 ft.), a raven (20 ft., Fly 60 ft.), or a spider
   * (20 ft., Climb 20 ft.)" — the one thing those two blocks say changes
   * between forms, against the size every other printing names.
   */
  speed: SpeedSchema.nullable(),
});
export type MonsterForm = z.infer<typeof MonsterFormSchema>;

/**
 * The forms one printed line offers, and whatever else the line said.
 *
 * `handedOver` is `MonsterSave`'s field by the same argument: the reader goes
 * sentence by sentence, the promises the book repeats on every printing are
 * inert and swallowed — the statistics unchanged, the equipment untransformed
 * — and anything else comes back verbatim so the table gets it. SRD Succubus
 * prints one such clause ("its Fly Speed is available only in its true form")
 * and reading it away would give the succubus a Speed the book withheld.
 */
export const MonsterFormsSchema = z.object({
  /**
   * The forms, in printed order, and **the last is the one the line returns
   * to**.
   *
   * At least two, because a line that offers one form offers no choice. The
   * order is a contract rather than a convenience: a creature that has not
   * used the line is in its own form already, and the reader that answers
   * "which form is it in" reads this last entry when nothing has been stated.
   * A list written any other way would silently give a homebrew creature the
   * wrong default — which is why the rule is here, on the vocabulary, rather
   * than only beside the reader.
   */
  forms: z.array(MonsterFormSchema).min(2),
  /** Every sentence of the line this reader did not read, verbatim. */
  handedOver: z.array(z.string().min(1)),
});
export type MonsterForms = z.infer<typeof MonsterFormsSchema>;

/**
 * A line that drags toward itself whatever it is already holding.
 *
 * SRD Roper, Reel: "The roper pulls each creature Grappled by it up to 30 feet
 * straight toward it."
 *
 * **`of` is a field rather than an assumption**, because the book prints the
 * same heading over a different hold: the Ettercap's Reel pulls a creature
 * "Restrained by its Web Strand", which is a condition held by an object the
 * engine has no record of. A shape that read only the distance would have
 * turned that web into a grapple.
 */
export const MonsterPullSchema = z.object({
  /** "up to 30 feet", measured toward the puller and capped at the gap. */
  feet: z.number().int().min(5),
  /** What the line pulls. One member today, and the field exists to keep it one. */
  of: z.literal('grappled'),
});
export type MonsterPull = z.infer<typeof MonsterPullSchema>;

/**
 * One Reaction line that adds a flat number to somebody's D20 Test.
 *
 * SRD Sphinx of Wonder, Burst of Ingenuity (2/Day): "_Trigger:_ The sphinx or
 * another creature within 30 feet makes an ability check or a saving throw.
 * _Response:_ The sphinx adds 2 to the roll."
 *
 * **The first Reaction line this parser reads at all**, and it is read because
 * the engine already holds the window it names: `test-rolled` is the instant
 * Dark One's Own Luck and Indomitable answer, and "adds 2 to the roll" is the
 * `intervene` effect with a flat addend. It is one of twenty `_Trigger:_`
 * lines the SRD prints and the only one of that shape: nine add to an **Armour
 * Class** against one attack (SRD Parry, SRD Riposte, the Mummy's Whirlwind of
 * Sand), and the other ten are ten different sentences — an ooze that splits,
 * an octopus's ink, a goblin redirecting a swing onto an ally, a rust monster
 * that eats the weapon that hit it. Every one of them wants a window or a rule
 * the engine does not have, so all nineteen stay prose and stay on the
 * ledger.
 *
 * **The trigger's reach is part of the shape**, for {@link MonsterTraitSchema}'s
 * stated reason: a feet-less kind would give every holder whatever range the
 * first one printed, and "the sphinx **or** another creature" is a different
 * sentence from "another creature" — the holder's own roll is in it.
 */
export const MonsterRollAddendSchema = z.object({
  /** "adds 2 to the roll". */
  addend: z.number().int().min(1),
  /** "another creature within 30 feet", measured from the reacting creature. */
  withinFeet: z.number().int().min(0),
  /** "The sphinx **or** another creature": the holder's own roll is answered. */
  includesSelf: z.boolean(),
  /**
   * "makes an ability check or a saving throw", in the order the glossary
   * lists them.
   *
   * The same vocabulary and the same argument as `disadvantage-in-sunlight`'s
   * `rolls`: a homebrew line naming one of the three must be expressible, and
   * a kind per breadth would put one rule in two places.
   */
  tests: z.array(z.enum(['ability-check', 'attack-roll', 'saving-throw'])).min(1),
});
export type MonsterRollAddend = z.infer<typeof MonsterRollAddendSchema>;

/**
 * One Reaction line that raises its creature's Armour Class against the attack
 * that triggered it.
 *
 * SRD Parry, on five CR ≤ 5 blocks and seven in all: "_Trigger:_ The knight is
 * hit by a melee attack roll while holding a weapon. _Response:_ The knight
 * adds 2 to its AC against that attack, possibly causing it to miss."
 *
 * **The same instant SRD *Shield* answers**, which is why it can be read at
 * all: `hit-by-attack` is a window the engine holds, the roll is known and the
 * damage is not, and a number added to an Armour Class re-decides a hit that
 * has not been settled. What is different from *Shield* is the span — "against
 * that attack" and no longer — so nothing here is a standing bonus.
 *
 * **Both clauses of the trigger are literals**, for {@link MonsterTeleportSchema}'s
 * stated reason: every line in the book prints both, and a homebrew line that
 * omitted one must not be read as though it had said it.
 *
 * **The three lines this shape refuses are the point of anchoring it.** The
 * Pirate Captain's Riposte adds the same number and then swings back; the
 * Mummy Lord's Whirlwind of Sand adds it against *any* attack roll and then
 * teleports and blinds; the Shield Guardian's Protection raises somebody
 * else's Armour Class and holds it there until its next turn. Each says
 * something this shape has no field for.
 */
export const MonsterAcAddendSchema = z.object({
  /** "adds 2 to its AC". */
  addend: z.number().int().min(1),
  /** "hit by a **melee** attack roll". */
  meleeOnly: z.literal(true),
  /** "**while holding a weapon**". */
  requiresWeapon: z.literal(true),
});
export type MonsterAcAddend = z.infer<typeof MonsterAcAddendSchema>;

/**
 * A trait whose sentence the parser recognised as a mechanic the engine has.
 *
 * Every member is named for what it *does* rather than for the trait that
 * prints it: the engine may not branch on a catalogue's names, and a second
 * block printing the same rule under another name would then reach the same
 * mechanic for free. The kinds grow one at a time, each one a sentence
 * somebody read and matched — there is no interpreter here.
 *
 * **A union rather than an enum, because two of the sentences carry numbers.**
 * A leap of "up to 20 feet" and a breath held "for 1 hour" are not the same
 * rule at different creatures; a kind that dropped the feet would be a jump of
 * nothing and a limit dropped at the door is a limit that silently becomes
 * none. The members that state a bare rule are still objects of one field, so
 * a trait pinned before any of this — `{ kind: 'advantage-when-…' }` — is
 * still a trait this reads.
 *
 * **Reading a sentence is not executing it**, and the ledger counts the two
 * separately. What a kind buys is a place for `hasPrintedTrait` to find the
 * rule; the readers that spend one are elsewhere.
 */
const MonsterTraitMechanicSchema = z.discriminatedUnion('kind', [
  z.object({
    /**
     * SRD Pack Tactics: "has Advantage on an attack roll against a creature if
     * at least one of its allies is within 5 feet of the creature and the ally
     * doesn't have the Incapacitated condition."
     */
    kind: z.literal('advantage-when-ally-is-within-5-feet-of-the-target'),
  }),
  z.object({
    /**
     * SRD Spider Climb: "can climb difficult surfaces, including along
     * ceilings, without needing to make an ability check."
     */
    kind: z.literal('climbs-without-a-check'),
  }),
  z.object({
    /**
     * SRD Flyby: "doesn't provoke an Opportunity Attack when it flies out of
     * an enemy's reach."
     */
    kind: z.literal('does-not-provoke-when-flying-out-of-reach'),
  }),
  z.object({
    /**
     * SRD Standing Leap: "the frog's Long Jump is up to 10 feet and its High
     * Jump is up to 5 feet with or without a running start."
     */
    kind: z.literal('jumps-without-a-running-start'),
    longJumpFeet: z.number().int().min(0),
    highJumpFeet: z.number().int().min(0),
  }),
  z.object({
    /** SRD Amphibious: "can breathe air and water." */
    kind: z.literal('breathes-air-and-water'),
    /**
     * SRD Limited Amphibiousness: "but it must be submerged at least once
     * every 4 hours to avoid suffocating outside water."
     *
     * A field on the same kind rather than a kind of its own, because the
     * first clause is the same sentence and the second is a *limit* on it —
     * absent is the unlimited case the book prints everywhere else.
     */
    mustSubmergeWithinHours: z.number().int().min(1).optional(),
  }),
  z.object({
    /** SRD Water Breathing: "can breathe only underwater." */
    kind: z.literal('breathes-only-water'),
    /** SRD Giant Octopus: "It can hold its breath for 1 hour outside water." */
    holdsBreathMinutes: z.number().int().min(1).optional(),
  }),
  z.object({
    /**
     * SRD Hold Breath: "can hold its breath for 1 hour" — a creature that
     * breathes air and can stop, which is the other half of the pair above.
     */
    kind: z.literal('holds-its-breath'),
    /** Always in minutes, whichever unit the block prints. */
    minutes: z.number().int().min(1),
  }),
  z.object({
    /**
     * SRD Sunlight Sensitivity, on five blocks in one sentence: "While in
     * sunlight, the kobold has Disadvantage on ability checks and attack
     * rolls." SRD Sunlight Weakness is the same rule over a wider list.
     *
     * **The holder, not the target.** The sentence says what happens to the
     * creature whose block it is, so the rolls named are the ones *it* makes
     * and the light read is the light where *it* stands.
     */
    kind: z.literal('disadvantage-in-sunlight'),
    /**
     * Which of its rolls the sentence names, in the order the glossary lists
     * them.
     *
     * **A list rather than two kinds**, because the two sentences differ only
     * in breadth and one is a subset of the other: Sunlight Sensitivity names
     * two rolls and Sunlight Weakness says "D20 Tests", which the rules
     * glossary settles — "D20 Tests encompass the three main d20 rolls of the
     * game: ability checks, attack rolls, and saving throws." A kind per
     * breadth would make a homebrew block that names one roll inexpressible
     * and would put the same rule in two places.
     */
    rolls: z
      .array(z.enum(['ability-check', 'attack-roll', 'saving-throw']))
      .min(1),
  }),
  z.object({
    /**
     * SRD Illumination, on five blocks: "The azer sheds Bright Light in a
     * 10-foot radius and Dim Light for an additional 10 feet."
     *
     * The radii differ between blocks — the azer's 10, the will-o'-wisp's 20,
     * the Fire Elemental's 30 — so they are part of the shape rather than
     * prose beside it, for {@link MonsterTraitSchema}'s stated reason.
     */
    kind: z.literal('sheds-light'),
    /** The radius of Bright Light, in feet. */
    brightRadiusFeet: z.number().int().min(0),
    /** The Dim Light **beyond** that radius, in feet, as the book adds it. */
    dimBeyondFeet: z.number().int().min(0),
  }),
  z.object({
    /**
     * SRD Shadow Stealth, printed under **Bonus Actions**: "While in Dim Light
     * or Darkness, the shadow takes the Hide action."
     *
     * Read off the sentence like every other kind, and the heading it is
     * printed under says what it *costs* rather than what it is — which is why
     * this reaches the same field a trait does.
     */
    kind: z.literal('hides-in-dim-light-or-darkness'),
  }),
  z.object({
    /**
     * SRD Nimble Escape, printed under **Bonus Actions**: "The goblin takes
     * the Disengage or Hide action." SRD Cunning Action on the Spy and the
     * Assassin, and SRD Deathless Agility on the two vampiric servants, are
     * the same sentence over a different menu.
     *
     * Named for the rule and not for any of those three headings, which is
     * what lets one kind carry all four: what the sentence says is that a
     * named action may be paid for out of a Bonus Action, which is the
     * `allows` action rule the Rogue's own Cunning Action is already written
     * as.
     *
     * **The menu is part of the shape**, for {@link MonsterTraitSchema}'s
     * stated reason: a goblin that could Dash as a Bonus Action is a rule
     * nobody printed, and a kind that dropped the list would give every
     * holder the widest menu any of them prints.
     */
    kind: z.literal('takes-a-named-action-as-a-bonus-action'),
    /**
     * Which actions, in the order the line prints them.
     *
     * The engine's `NamedAction` vocabulary is wider than this and the two
     * packages may not import each other's, so these are the three the book
     * actually prints in this sentence — the same reason `disadvantage-in-
     * sunlight` names three rolls rather than five families.
     */
    actions: z.array(z.enum(['dash', 'disengage', 'hide'])).min(1),
  }),
  z.object({
    /**
     * SRD Bloodied Fury: "While Bloodied, the boar has Advantage on attack
     * rolls." SRD Bloodied Frenzy is the same sentence over a wider list.
     *
     * The rules glossary settles what Bloodied is — "A creature is Bloodied
     * while it has half its Hit Points or fewer remaining" — so this is a
     * condition of the holder's own and not a fact about its target.
     *
     * `rolls` for the reason `disadvantage-in-sunlight` carries one: the two
     * printed sentences differ only in breadth, and a kind per breadth would
     * put one rule in two places.
     */
    kind: z.literal('advantage-while-bloodied'),
    rolls: z
      .array(z.enum(['ability-check', 'attack-roll', 'saving-throw']))
      .min(1),
  }),
  z.object({
    /**
     * SRD Undead Fortitude, printed word for word on the Zombie and the Ogre
     * Zombie: "If damage reduces the zombie to 0 Hit Points, it makes a
     * Constitution saving throw (DC 5 plus the damage taken) unless the damage
     * is Radiant or from a Critical Hit. On a successful save, the zombie drops
     * to 1 Hit Point instead."
     *
     * **A bare kind, because nothing in the sentence varies.** The two blocks
     * that print it print the same ability, the same DC formula, the same two
     * exceptions and the same 1 Hit Point — so there is nothing to carry, and
     * the shape is `advantage-when-ally-is-within-5-feet-of-the-target`'s
     * rather than `jumps-without-a-running-start`'s. A homebrew block wanting
     * a different DC prints a different sentence, and this refuses it.
     */
    kind: z.literal('undead-fortitude'),
  }),
  z.object({
    /**
     * SRD Magic Resistance, printed word for word on twenty-seven stat blocks
     * and on eleven at CR 5 or below: "The devil has Advantage on saving
     * throws against spells and other magical effects."
     *
     * **A bare kind, for the reason `undead-fortitude` is one.** Nothing in
     * the sentence varies: one mode, one family, one narrowing. The Rakshasa's
     * Greater Magic Resistance is a different rule in three clauses —
     * automatic successes, spell attacks that miss, and a divination it
     * forbids — and is refused whole rather than read down to the part that
     * fits.
     */
    kind: z.literal('magic-resistance'),
  }),
  z.object({
    /**
     * SRD Blood Frenzy: "The sahuagin has Advantage on attack rolls against
     * any creature that doesn't have all its Hit Points."
     *
     * **A bare kind, because the sentence carries no number and no menu.** One
     * mode, one family, one narrowing — and the narrowing is a fact about the
     * creature being swung at rather than about the holder, which is what
     * tells it from `advantage-while-bloodied` one member up. The book's
     * "doesn't have all its Hit Points" is the same predicate SRD Colossus
     * Slayer writes as "if it's missing any of its Hit Points"; a creature at
     * full Hit Points is not it.
     */
    kind: z.literal('advantage-against-a-wounded-target'),
  }),
  z.object({
    /**
     * SRD Aura of Authority: "While in a 10-foot Emanation originating from
     * the hobgoblin, the hobgoblin and its allies have Advantage on attack
     * rolls and saving throws, provided the hobgoblin doesn't have the
     * Incapacitated condition."
     *
     * A printed aura, which is the shape SRD Aura of Protection is already
     * written in — a reach in feet, the holder and its allies inside it, and a
     * gate on the holder. The radius is part of the shape for
     * {@link MonsterTraitSchema}'s stated reason, and `rolls` for
     * `disadvantage-in-sunlight`'s: the sentence names a list and a kind per
     * breadth would put one rule in two places.
     *
     * **The Incapacitated clause is not carried**, because every printed
     * emanation the book gates gates it the same way and the engine's
     * `not-incapacitated` requirement is that clause exactly. A sentence
     * without it is a different sentence and this refuses it.
     */
    kind: z.literal('allies-in-emanation-have-advantage'),
    /** "a 10-foot Emanation", measured from the holder. */
    feet: z.number().int().min(0),
    rolls: z
      .array(z.enum(['ability-check', 'attack-roll', 'saving-throw']))
      .min(1),
  }),
  z.object({
    /**
     * SRD Agile, on the Deer and the Rat: "The deer doesn't provoke an
     * Opportunity Attack when it moves out of an enemy's reach."
     *
     * SRD Flyby without the flying, and its own kind rather than a field on
     * it: a gargoyle keeps its Opportunity Attack when it walks away and a
     * deer never does, so folding the two together would hand every flier the
     * wider rule. The wider one implies the narrower and nothing in the
     * bestiary prints both.
     */
    kind: z.literal('does-not-provoke-when-leaving-reach'),
  }),
  z.object({
    /**
     * SRD Running Leap, on the Lion and the Saber-Toothed Tiger: "With a
     * 10-foot running start, the lion can Long Jump up to 25 feet."
     *
     * `jumps-without-a-running-start`'s opposite number, and its own kind for
     * that reason: SRD Standing Leap *removes* the running start and prints
     * both jumps, and this one *requires* it and prints one. A creature
     * holding this still needs the ten feet, which is why they are carried
     * rather than assumed — the Minotaur's charge prints thirty and a homebrew
     * line may print any number.
     */
    kind: z.literal('long-jump-with-a-running-start'),
    /** "With a 10-foot running start" — what the jump has to be bought with. */
    runningStartFeet: z.number().int().min(0),
    /** "can Long Jump up to 25 feet" — the distance it then reaches. */
    longJumpFeet: z.number().int().min(0),
  }),
  z.object({
    /**
     * SRD Siege Monster: "The elemental deals double damage to objects and
     * structures."
     *
     * A bare kind for `magic-resistance`'s reason: nothing in the sentence
     * varies across the four blocks that print it. "Structures" names nothing
     * this engine holds — a declared object is the whole of what can be broken
     * — so the multiplier lands on an object and the word is the table's.
     */
    kind: z.literal('deals-double-damage-to-objects'),
  }),
  z.object({
    /**
     * SRD Aberrant Ground: "The ground in a 10-foot Emanation originating from
     * the mouther is Difficult Terrain."
     *
     * Difficult Terrain that is **derived from where the creature stands**
     * rather than declared over a region, because an Emanation moves when its
     * creature does. The radius is part of the shape for
     * {@link MonsterTraitSchema}'s stated reason.
     */
    kind: z.literal('emanation-is-difficult-terrain'),
    feet: z.number().int().min(0),
  }),
  z.object({
    /**
     * SRD Lightning Absorption, on the Flesh Golem and the Shambling Mound:
     * "Whenever the golem is subjected to Lightning damage, it regains a
     * number of Hit Points equal to the Lightning damage dealt."
     *
     * **The type is the shape and the amount is the blow's**, so there is one
     * field: the sentence names one type and reads the amount off the damage,
     * and a kind carrying a number would be a heal the book never printed.
     *
     * Both blocks that print it are **immune** to the type they absorb, which
     * is what makes the ruling load-bearing rather than pedantic: "dealt" read
     * after Immunity is always nought and the trait is dead text. So the
     * amount is what was rolled at the creature before its own defences, and
     * the reader says so where it applies it.
     */
    kind: z.literal('absorbs-a-damage-type'),
    /** Lower-cased, in the engine's own vocabulary — `lightning`. */
    damageType: z.string().min(1),
  }),
  z.object({
    /**
     * SRD Aversion to Fire, on the Flesh Golem: "If the golem takes Fire
     * damage, it has Disadvantage on attack rolls and ability checks until the
     * end of its next turn."
     *
     * {@link kind}`: 'absorbs-a-damage-type'`'s opposite number — the same
     * trigger with a penalty on the other end of it — and `rolls` for
     * `disadvantage-in-sunlight`'s reason.
     *
     * **The span is anchored and not carried.** One block in the book prints
     * this sentence and it prints one span; a line naming another would be a
     * different sentence, and a field that could hold any of them would invite
     * a reader to guess at the one the anchor refused.
     */
    kind: z.literal('penalised-after-taking-a-damage-type'),
    damageType: z.string().min(1),
    rolls: z
      .array(z.enum(['ability-check', 'attack-roll', 'saving-throw']))
      .min(1),
  }),
  z.object({
    /**
     * SRD Freeze, on the Water Elemental: "If the elemental takes Cold damage,
     * its Speed decreases by 20 feet until the end of its next turn."
     *
     * `penalised-after-taking-a-damage-type`'s sibling — the same trigger and
     * the same span with a Speed on the end of it instead of a roll mode — and
     * its own kind because the two grant different things and a union member
     * that carried either would be a shape nothing could read without asking
     * which half it was.
     */
    kind: z.literal('speed-cut-after-taking-a-damage-type'),
    damageType: z.string().min(1),
    feet: z.number().int().min(1),
  }),
  z.object({
    /**
     * SRD Fire Aura, on the Azer Sentinel and the Salamander: "At the end of
     * each of the azer's turns, each creature of the azer's choice in a 5-foot
     * Emanation originating from the azer takes 5 (1d10) Fire damage unless the
     * azer has the Incapacitated condition."
     *
     * **The sibling of the start-of-turn saves the boundary already settles**,
     * and a damage roll rather than a save: nobody rolls anything but the dice.
     *
     * Every part of the sentence that varies between the blocks that print it
     * is carried, which is the rule {@link MonsterTraitSchema} states:
     *
     * - the **moment**, because the book writes both and they are a round
     *   apart;
     * - the **radius**, which is five feet on three blocks and ten on another;
     * - the **dice**, which are 1d10, 2d6 and 3d8 across the blocks that print
     *   it, and the **type**, which a homebrew line may vary;
     * - **whose choice it is**, because the Azer burns whom it likes and the
     *   Balor burns everybody, and a reader that assumed either would be
     *   playing somebody's creature for them;
     * - the **Incapacitated clause**, which the Azer alone prints — so a
     *   reader that assumed it would keep a Stunned Balor from burning, and one
     *   that dropped it would have a Stunned Azer burning.
     *
     * The Fire Elemental's is refused whole, which is the anchoring rule doing
     * its work: its sentence ends "Creatures and flammable objects in the
     * Emanation start burning", and there is no burning here.
     */
    kind: z.literal('damages-creatures-in-an-emanation'),
    /** "At the **end** of each of the azer's turns". */
    moment: z.enum(['start', 'end']),
    /** "a 5-foot Emanation originating from the azer". */
    feet: z.number().int().min(0),
    /** "5 (**1d10**) Fire damage" — the notation, which is what is rolled. */
    dice: z.string().regex(/^\d+d\d+$/),
    /** Lower-cased, in the engine's own vocabulary. */
    damageType: z.string().min(1),
    /**
     * "each creature **of the azer's choice**".
     *
     * A choice the engine has nobody to make, so the command that ends the
     * turn takes the creatures the table names and an empty answer burns
     * nobody. False is the Balor's sentence: everybody inside, no choice.
     */
    chosen: z.boolean(),
    /** "unless the azer has the Incapacitated condition". */
    unlessIncapacitated: z.boolean(),
  }),
  z.object({
    /**
     * SRD Barbed Hide, on the Barbed Devil: "At the start of each of its turns,
     * the devil deals 5 (1d10) Piercing damage to any creature it is grappling
     * or any creature grappling it."
     *
     * The same moment read the same way, caught by the grapple relation rather
     * than by feet — so there is no radius and no choice, and both directions
     * of the hold are in the sentence.
     */
    kind: z.literal('damages-creatures-it-is-holding'),
    moment: z.enum(['start', 'end']),
    dice: z.string().regex(/^\d+d\d+$/),
    damageType: z.string().min(1),
  }),
  z.object({
    /**
     * SRD Blurred Form, on the Steam Mephit: "Attack rolls against the mephit
     * are made with Disadvantage unless the mephit has the Incapacitated
     * condition."
     *
     * A bare kind for `magic-resistance`'s reason — one mode, one family, one
     * gate — and it is the first printed trait whose mode sits on the rolls
     * made **against** its holder rather than on the holder's own.
     */
    kind: z.literal('disadvantage-on-attacks-against-it'),
  }),
  z.object({
    /**
     * SRD Beast of Burden, on the Mule: "The mule counts as one size larger
     * for the purpose of determining its carrying capacity."
     *
     * SRD Powerful Build's sentence on a stat block, which is the grant the
     * engine already reads: a *step* rather than a named size, because the
     * book writes it as a relation and a named one would be wrong the moment
     * the holder were enlarged.
     */
    kind: z.literal('carries-as-a-larger-creature'),
    sizesLarger: z.number().int().min(1),
  }),

  // ---------------------------------------------------------------------
  // What follows is the **third answer**: sentences the parser reads so that
  // the table gets them, and that no rule will ever consult. See
  // `HANDOVER_TRAIT_KINDS` in `packages/content/scripts/coverage-data.ts`,
  // which carries the reason per kind and is pinned the opposite way round
  // from the reader roster — a kind named there must be named *nowhere* in
  // `packages/engine/src`, because a handover with a reader is a mislabelled
  // debt.
  //
  // **Bare, every one of them.** The other members carry numbers because a
  // rule reads them; nothing reads these, and the block's own sentence is on
  // the line beside the shape for whoever is narrating. A field here would be
  // a number kept for nobody.
  // ---------------------------------------------------------------------

  z.object({
    /**
     * SRD Mimicry, on the Green Hag and the Raven: "The hag can mimic animal
     * sounds and humanoid voices. A creature that hears the sounds can tell
     * they are imitations only with a successful DC 14 Wisdom (Insight)
     * check."
     *
     * Two sentences at two DCs and one kind, because what a mimic *is* is the
     * same either way and the DC is the table's to call for.
     */
    kind: z.literal('mimics-sounds'),
  }),
  z.object({
    /** SRD Telepathic Bond, on the Homunculus: two creatures on one plane. */
    kind: z.literal('speaks-telepathically-with-its-master'),
  }),
  z.object({
    /**
     * SRD Vampiric Connection: the bond above, and a master who sees through
     * the familiar's eyes.
     */
    kind: z.literal('is-perceived-through-by-its-master'),
  }),
  z.object({
    /** SRD Shark Telepathy: "can magically control sharks within 120 feet". */
    kind: z.literal('controls-a-kind-of-creature'),
  }),
  z.object({
    /**
     * SRD Iron Scent and SRD Treasure Sense: "can pinpoint the location of
     * ferrous metal within 30 feet of itself."
     */
    kind: z.literal('pinpoints-a-substance'),
  }),
  z.object({
    /** SRD Speak with Beasts and Plants, on the Dryad. */
    kind: z.literal('speaks-with-a-kind-of-creature'),
  }),
  z.object({
    /** SRD Ethereal Sight, on the Ghost and the Phase Spider. */
    kind: z.literal('sees-into-another-plane'),
  }),
  z.object({
    /** SRD Transparent, on the Gelatinous Cube: a check to notice it at all. */
    kind: z.literal('goes-unnoticed-until-it-moves'),
  }),
  z.object({
    /** SRD Shielded Mind, on the Couatl. */
    kind: z.literal('thoughts-cannot-be-read'),
  }),
  z.object({
    /** SRD Immutable Form, on the Flesh Golem: "The golem can't shape-shift." */
    kind: z.literal('cannot-shape-shift'),
  }),
  z.object({
    /**
     * SRD Diabolical Restoration and SRD Hellish Restoration: a body that
     * comes back somewhere the engine has no map of.
     */
    kind: z.literal('revives-on-another-plane'),
  }),
  z.object({
    /** SRD Sense Magic, on the Chuul: *Detect Magic* that is not magical. */
    kind: z.literal('senses-magic-nearby'),
  }),
  z.object({
    /** SRD Training, on the Commoner: a skill the GM chooses. */
    kind: z.literal('has-a-skill-the-gm-chooses'),
  }),
  z.object({
    /** SRD Draconic Origin, on the Half-Dragon: a damage type the GM chooses. */
    kind: z.literal('has-a-damage-type-the-gm-chooses'),
  }),
  z.object({
    /**
     * SRD Water Susceptibility and SRD Running Water: damage from water, which
     * is a substance this world does not hold.
     */
    kind: z.literal('is-hurt-by-water'),
  }),
  z.object({
    /** SRD Forbiddance, on the Vampire Spawn: a threshold and an invitation. */
    kind: z.literal('cannot-enter-a-home-uninvited'),
  }),
  z.object({
    /**
     * SRD Vampire Weakness: "The vampire has these weaknesses:" — a heading
     * the book prints over the three lines that follow it, and a rule of
     * nothing on its own.
     */
    kind: z.literal('a-heading-over-the-lines-that-follow'),
  }),
  z.object({
    /**
     * SRD Goblin Boss, Redirect Attack: "_Trigger:_ A creature the goblin can
     * see makes an attack roll against it. _Response:_ The goblin chooses a
     * Small or Medium ally within 5 feet of itself. The goblin and that ally
     * swap places, and the ally becomes the target of the attack instead."
     *
     * **Read into a kind and no further**, because two of the three things it
     * says are rules the engine does not have. The window is *before* the roll
     * is decided — every other Reaction to a swing answers a hit — and the
     * response retargets an attack that has already been aimed, which nothing
     * in the attack path can be told to do. The swap of two creatures' spaces
     * is the one third of it that is built.
     */
    kind: z.literal('swaps-places-with-an-ally-to-take-an-attack'),
  }),
  z.object({
    /**
     * SRD Black Pudding and SRD Ochre Jelly, Split: "The pudding splits into
     * two new **Black Puddings**. Each new pudding is one size smaller than
     * the original pudding and acts on its Initiative."
     *
     * A stat block created mid-fight, which is the shape the catalogue already
     * names for the summoning spells: two creatures that did not exist a
     * moment ago, in the Initiative order, with the original's Hit Points
     * divided between them. Read into a kind so the sentence is on the record;
     * nothing spends it.
     */
    kind: z.literal('splits-into-two-creatures'),
  }),
  z.object({
    /**
     * SRD Shrieker Fungus, Shriek: "The shrieker emits a shriek audible within
     * 300 feet of itself for 1 minute or until the shrieker dies."
     *
     * A noise. Nothing in the engine hears anything — there is no sound in
     * state, nothing that reads one and no check waiting on it — so what the
     * sentence says is what the table narrates, and it is a handover for the
     * reason the breathing traits are.
     */
    kind: z.literal('makes-a-noise'),
  }),

  // ---------------------------------------------------------------------
  // The sentences that describe a **world** rather than a creature.
  //
  // Each names a material, a gap, a web, a sheet of ice or a heart, and the
  // scene holds creatures, landmarks, declared objects and declared regions
  // and no substance at all — so there is no fact for a rule to read and no
  // move that would be refused. They are handovers by the test
  // `docs/design/content.md` sets, and `HANDOVER_TRAIT_KINDS` carries the
  // reason for each in the sentence's own terms.
  //
  // **They stop being handovers the day the lattice holds materials**, and
  // that is written down rather than left to be noticed: the reason on each
  // says what would have to be true for it to be false.
  // ---------------------------------------------------------------------
  z.object({
    /**
     * SRD Amorphous, on four oozes and shadows, and SRD Compression on the
     * octopus: "can move through a space as narrow as 1 inch without
     * expending extra movement to do so."
     *
     * One kind over two headings, because the two print one sentence — the
     * rule this file follows everywhere: the sentence is matched and the
     * heading is not.
     */
    kind: z.literal('moves-through-a-one-inch-gap'),
  }),
  z.object({
    /**
     * SRD Air Form and SRD Water Form: "The elemental can enter a creature's
     * space and stop there. It can move through a space as narrow as 1 inch
     * without expending extra movement to do so."
     *
     * A kind of its own rather than the one above with a flag, because the
     * first clause is the larger of the two claims and a flag on the narrow
     * gap would have buried it.
     */
    kind: z.literal('enters-a-creature-space-and-a-one-inch-gap'),
  }),
  z.object({
    /**
     * SRD Fire Form: the sentence above with damage on the end of it — "The
     * first time it enters a creature's space on a turn, that creature takes
     * 5 (1d10) Fire damage."
     *
     * **Its own kind, and the damage is deliberately not carried.** The
     * trigger is the clause the lattice cannot hold, so a die read out of
     * this sentence would be a die nothing could ever throw; what the kind
     * claims is that the sentence was recognised whole, damage included, and
     * that the whole of it went to the table.
     */
    kind: z.literal('burns-a-creature-whose-space-it-enters'),
  }),
  z.object({
    /**
     * SRD Incorporeal Movement, on the ghost, the specter, the wisp and the
     * wraith: "can move through other creatures and objects as if they were
     * Difficult Terrain. It takes 5 (1d10) Force damage if it ends its turn
     * inside an object."
     *
     * The damage is not carried for the reason above: *inside an object* is a
     * position this lattice has no word for, so the condition on the damage
     * can never be evaluated.
     */
    kind: z.literal('moves-through-creatures-and-objects'),
  }),
  z.object({
    /**
     * SRD Earth Glide: "can burrow through nonmagical, unworked earth and
     * stone. While doing so, the elemental doesn't disturb the material it
     * moves through."
     */
    kind: z.literal('burrows-through-earth-and-stone'),
  }),
  z.object({
    /**
     * SRD Tunneler: "can burrow through solid rock at half its Burrow Speed
     * and leaves a 10-foot-diameter tunnel in its wake."
     */
    kind: z.literal('burrows-through-solid-rock'),
  }),
  z.object({
    /**
     * SRD Web Walker: "ignores movement restrictions caused by webs, and the
     * spider knows the location of any other creature in contact with the
     * same web."
     */
    kind: z.literal('ignores-a-webs-restrictions'),
  }),
  z.object({
    /**
     * SRD Ice Walk: "can move across and climb icy surfaces without needing
     * to make an ability check. Additionally, Difficult Terrain composed of
     * ice or snow doesn't cost it extra movement."
     *
     * Not the same sentence as SRD Spider Climb, which is why it is not that
     * kind: the surfaces are named by what they are made of, and a patch of
     * Difficult Terrain here is a declared region with no composition.
     */
    kind: z.literal('walks-on-ice'),
  }),
  z.object({
    /** SRD Ephemeral, on the will-o'-wisp: "can't wear or carry anything." */
    kind: z.literal('cannot-wear-or-carry-anything'),
  }),
  z.object({
    /**
     * SRD Adhesive, on the mimic in object form: "adheres to anything that
     * touches it. A Huge or smaller creature adhered to the mimic has the
     * Grappled condition (escape DC 13). Ability checks made to escape this
     * grapple have Disadvantage."
     *
     * The grapple and its escape DC are rules the engine holds and there is a
     * door a DM applies them through; what it has no notion of is one thing
     * *touching* another, which is the clause the rest hangs on.
     */
    kind: z.literal('adheres-to-what-touches-it'),
  }),
  z.object({
    /**
     * SRD Confer Fire Resistance, on the nightmare: "can grant Resistance to
     * Fire damage to a rider while it is on the nightmare." Nothing here is
     * ridden.
     */
    kind: z.literal('confers-a-resistance-to-a-rider'),
  }),
  z.object({
    /**
     * SRD Stake to the Heart, on the vampire spawn: "is destroyed if a weapon
     * that deals Piercing damage is driven into the vampire's heart while the
     * vampire has the Incapacitated condition."
     */
    kind: z.literal('destroyed-by-a-stake-through-the-heart'),
  }),
  z.object({
    /**
     * SRD Stake to the Heart, on the vampire, which is a different rule under
     * the same heading: the vampire "has the Paralyzed condition until the
     * weapon is removed" rather than being destroyed.
     *
     * Two kinds because the book prints two rules, and one kind over both
     * would have claimed the weaker of them about the stronger creature.
     */
    kind: z.literal('paralyzed-by-a-stake-through-the-heart'),
  }),
  z.object({
    /**
     * SRD Swarm, on the seven swarms: "The swarm can occupy another creature's
     * space and vice versa, and the swarm can move through any opening large
     * enough for a Tiny rat. **The swarm can't regain Hit Points or gain
     * Temporary Hit Points.**"
     *
     * Three sentences under one heading and only the last is a rule the engine
     * holds, which is the reason {@link MonsterTraitSchema} carries a
     * `handedOver` at all: read whole, the trait would have claimed the two
     * space sentences as well; read not at all, a swarm would go on being
     * healed by a Cure Wounds the book forbids.
     *
     * **The name is the half that is executed.** `healCreature` is the one
     * door hit points come back through and it asks this; the Temporary Hit
     * Points half is asked at `grantTemporaryHpTo`, which is the one door
     * those come through. Both are facts about the creature's anatomy rather
     * than a running effect, which is why neither is a `GrantedHealingRule`:
     * that record is ended by its source, and a swarm's is ended by nothing.
     */
    kind: z.literal('regains-no-hit-points'),
  }),
]);

/**
 * A trait's mechanic, with the sentences under the same heading that the
 * reader could not turn into one.
 *
 * `MonsterSave.handedOver` on the other half of the sheet, and the same
 * reading: a heading may print three sentences and the engine may hold one of
 * them, and a reader with nowhere to put the other two must either claim them
 * or refuse the heading whole. SRD Swarm is the sentence that made the choice
 * unavoidable — "can occupy another creature's space", "can move through any
 * opening large enough for a Tiny rat", "can't regain Hit Points" — where the
 * first two name a lattice this engine does not have and the third is a rule
 * it does.
 *
 * **A residue means the heading is still unpaid**, exactly as it does for a
 * save and for a hit's rider: `coverage-data.ts` counts a trait with one on a
 * row of its own, so learning to recognise a third of a heading can never
 * retire a debt.
 *
 * An intersection rather than a field repeated on twenty-odd members: every
 * mechanic may carry one, and the discriminator still narrows.
 */
export const MonsterTraitSchema = MonsterTraitMechanicSchema.and(
  z.object({
    /**
     * The clauses under this heading the reader carried and did not read.
     *
     * **In the book's own words, with its punctuation made whole.** Where a
     * heading joins two facts with "and", each is given back the full stop
     * that joiner stood in for — SRD Swarm's "the swarm can move through any
     * opening large enough for a Tiny rat." keeps the book's lower case,
     * because changing a word is what a verbatim channel exists to prevent and
     * a fragment with no full stop is one a table cannot read out. That is
     * `readPrintedRiders`' own rule for a clause it splits, applied here.
     */
    handedOver: z.array(z.string().min(1)).min(1).optional(),
  }),
);
export type MonsterTrait = z.infer<typeof MonsterTraitSchema>;

/**
 * Every trait kind this schema admits, in the order the union declares them.
 *
 * Published because the census guards ask the schema what it knows — "is every
 * name on the reader roster still a kind" — and an intersection has no
 * `options` for them to walk. Derived from the union rather than written out,
 * so a member added and not listed is impossible rather than merely unlikely.
 */
export const MONSTER_TRAIT_KINDS: readonly string[] = MonsterTraitMechanicSchema.options.map(
  (option) => option.shape.kind.value,
);

/**
 * A named trait, action, bonus action, reaction, or legendary action.
 *
 * The name and the book's sentence are the whole of what this was, and they
 * are still what a line *is*: `attack` and `trait` are what the parser could
 * read out of that sentence, present only where it read something. A line
 * carrying neither is prose, exactly as every line was.
 */
export const FeatureSchema = z.object({
  name: z.string().min(1),
  text: z.string().min(1),
  /** The numbers of a printed attack line, where this line is one. */
  attack: MonsterAttackSchema.optional(),
  /**
   * What brings this line back once it has been used, where the name prints
   * one — see {@link MonsterRechargeSchema}.
   *
   * **Here rather than on the attack, because here is where the book prints
   * it.** It sat on `attack` while its only reader was the one that leaves a
   * breath weapon out of an Opportunity Attack, and that reader holds an
   * attack; but the book writes the notation on eighty-seven lines and only
   * two of them print an attack roll. The other eighty-five are a saving
   * throw, a spell, a teleport or a shape-shift, and on the old shape they
   * carried no recharge at all — including the one line in the SRD that prints
   * the rest form, which is why nothing had ever produced that arm.
   */
  recharge: MonsterRechargeSchema.optional(),
  /**
   * How many times between dawns the line may be used, where the name prints
   * a limit: "Dominate Mind (2/Day)", "Divine Aid (3/Day)".
   *
   * **Here for the reason `recharge` is here — and it is not a recharge.** The
   * book writes both notations inside the heading and nowhere else, so both are
   * read once, here, and nothing downstream tells a breath weapon from a
   * once-a-day spell by looking at a string. But the two say different things
   * about different clocks: a recharge is a d6 at the start of a turn (and a
   * rest), and this is a count that comes back at **dawn**, which the engine's
   * `Recovery` vocabulary has always kept apart from a rest. No heading in the
   * SRD prints both, which is asserted over the corpus rather than assumed.
   *
   * **The lair number is not carried.** Twenty-seven of the sixty headings
   * print a second one — "Legendary Resistance (3/Day, or 4/Day in Lair)" —
   * and every one of those twenty-seven is a Legendary Resistance trait. The
   * engine has no lair, nothing that could say a creature is standing in one,
   * and no rule that reads a failed saving throw, so a second field here would
   * have no reader in any of those senses; and it is the answer `CR_LINE`
   * already gives to the same construction, swallowing "or 7,200 in lair" and
   * taking the XP printed outside it. What is carried is the number that holds
   * wherever the engine can put the creature.
   *
   * **A qualification the parser cannot evaluate does not suppress the
   * number.** SRD Night Hag prints "Nightmare Haunting (1/Day; Requires Soul
   * Bag)"; the soul bag is not checkable and the 1 is, and a limit enforced is
   * never more permissive than the book — whereas dropping it would make the
   * line unlimited, which is the direction that matters.
   */
  perDay: z.number().int().min(1).optional(),
  /** The mechanic this trait's sentence states, where the parser knows it. */
  trait: MonsterTraitSchema.optional(),
  /**
   * The saving throw this line forces, where its sentence is the template —
   * see {@link MonsterSaveSchema}.
   *
   * **Beside `attack` rather than inside it**, because the two are the book's
   * two openings and a line writes one or the other: `_Melee Attack Roll:_`
   * or `_Dexterity Saving Throw:_`. A save printed *after* a hit is the
   * attack's rider and belongs to it — SRD Ghoul's Bite — and is read there,
   * once, by the reader the swing already calls.
   *
   * Read on every section, because what a line says is not a property of the
   * heading it is printed under: the Gorgon's Trample is a Bonus Action and
   * the Magma Mephit's Death Burst is a trait, and both write the template.
   */
  save: MonsterSaveSchema.optional(),
  /** The sequence this line's sentence states, where it states one. */
  multiattack: MonsterMultiattackSchema.optional(),
  /**
   * The spells this line declares, where its sentence is the Spellcasting
   * template — see {@link MonsterSpellcastingSchema}.
   *
   * Beside `save` and `attack` rather than inside either, because it is the
   * book's third opening: a line writes `_Melee Attack Roll:_`, or
   * `_Dexterity Saving Throw:_`, or "casts one of the following spells".
   *
   * Read on every section for the reason `save` is: what a line says is not a
   * property of the heading it is printed under. Every SRD block prints this
   * one under **Actions**, and a homebrew block that printed it elsewhere
   * would still be saying what it says.
   */
  spellcasting: MonsterSpellcastingSchema.optional(),
  /**
   * The spells this line casts, where its sentence is the cast template — see
   * {@link MonsterCastLineSchema}.
   *
   * Beside `spellcasting` rather than inside it, because the two are different
   * sentences about different economies: that one declares what the creature
   * *can cast* and prices each spell; this one is a heading whose single use
   * buys any one of a short menu. A block prints both — SRD Priest prints
   * Spellcasting under Actions and Divine Aid under Bonus Actions — and the
   * second reads the first for its ability.
   *
   * Read on every section for the reason `save` is: what a line says is not a
   * property of the heading it is printed under. What the heading *does* say
   * is what the use costs, which is why it is not carried here.
   */
  casts: MonsterCastLineSchema.optional(),
  /** Where this line teleports its creature — see {@link MonsterTeleportSchema}. */
  teleports: MonsterTeleportSchema.optional(),
  /**
   * The forms this line puts its creature into — see {@link MonsterFormsSchema}.
   *
   * Read on every section like everything else here. The book prints
   * Shape-Shift as an Action on two blocks and as a Bonus Action on eleven,
   * which is a heading saying what the use *costs*.
   */
  forms: MonsterFormsSchema.optional(),
  /**
   * What this line drags toward its creature — see {@link MonsterPullSchema}.
   *
   * Read on every section like everything else here; SRD prints the one line
   * that reaches this shape under Actions.
   */
  pulls: MonsterPullSchema.optional(),
  /**
   * The forms this line may be used in, where its **heading** says so.
   *
   * SRD Werewolf: "Bite (Wolf or Hybrid Form Only)", "Longbow (Humanoid or
   * Hybrid Form Only)"; SRD Weretiger's Prowl and SRD Mimic's Adhesive print
   * the same clause. The words are lowercased into the names the block's own
   * Shape-Shift prints its forms under, so the gate and the form are one
   * vocabulary rather than two strings that happen to agree.
   *
   * Read off the *name* for {@link MonsterRechargeSchema}'s reason: the book
   * prints it inside the heading, and a heading is exactly what nothing
   * downstream may branch on.
   */
  onlyInForms: z.array(z.string().regex(/^[a-z][a-z-]*$/)).min(1).optional(),
  /**
   * The flat addend this Reaction line puts on somebody's D20 Test — see
   * {@link MonsterRollAddendSchema}.
   *
   * Read on every section like everything else here, though only the Reactions
   * section prints it: a line answering a trigger costs a Reaction because of
   * the heading it is under, and the heading is read where every other cost is.
   */
  addsToRoll: MonsterRollAddendSchema.optional(),
  /**
   * What this Reaction line adds to its creature's Armour Class against the
   * attack that triggered it — see {@link MonsterAcAddendSchema}.
   *
   * Read on every section for `addsToRoll`'s reason, and the heading is what
   * says a Reaction is spent on it.
   */
  addsToAc: MonsterAcAddendSchema.optional(),
  /**
   * The printed line this Reaction's response performs, by its heading.
   *
   * SRD Rust Monster, Reflexive Antennae: "_Trigger:_ An attack roll hits the
   * rust monster. _Response:_ The rust monster uses Antennae." The whole of
   * the response is a *second line of the same block*, which is a thing no
   * other reader here has had to say: the trigger is a window the engine
   * holds and the response is whatever that other line turns out to be.
   *
   * **A name and not a resolved line**, on the rule `AttackCommand.action`
   * already keeps: the line is read back off the creature's own sheet when it
   * is used, so a block whose Antennae is still prose hands its response to
   * the table rather than performing half of it.
   *
   * **No field says which window**, because the shape is anchored to one
   * sentence: "an attack roll hits the *creature*" is the trigger every line
   * of this shape prints, and the Nalfeshnee's Pursuit — "The nalfeshnee uses
   * Teleport, but its destination space must be within 10 feet" — writes a
   * different trigger *and* a clause about the response, so it is refused
   * whole rather than read down to the name.
   */
  usesLine: z.string().min(1).optional(),
});
export type Feature = z.infer<typeof FeatureSchema>;

export const MonsterSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  size: CreatureSizeSchema,
  /**
   * Further sizes the stat block offers, for the 30-odd entries printed as
   * "Medium or Small". `size` holds the first listed.
   */
  alternateSizes: z.array(CreatureSizeSchema),
  /** e.g. `Fey`, `Humanoid`, `Dragon`. */
  type: z.string().min(1),
  /** The parenthesised tag, e.g. `Goblinoid`. */
  subtype: z.string().nullable(),
  /**
   * Set for entries printed as "Medium Swarm of Tiny Undead": `size` is the
   * swarm's own size, `type` the member type, and this the member size.
   */
  swarmMemberSize: CreatureSizeSchema.nullable(),
  alignment: z.string().min(1),

  ac: z.number().int().min(1),
  initiative: z.number().int(),
  hp: HitPointsSchema,
  speed: SpeedSchema,
  abilities: AbilityBlockMapSchema,

  /** Skill slug to bonus, e.g. `{ stealth: 6 }`. */
  skills: z.record(z.string(), z.number().int()),
  vulnerabilities: z.array(z.string()),
  resistances: z.array(z.string()),
  immunities: z.array(z.string()),
  gear: z.array(z.string()),

  senses: z.array(z.string()),
  passivePerception: z.number().int().min(0),
  languages: z.array(z.string()),

  /** Numeric challenge rating; `1/8` becomes `0.125`. */
  cr: z.number().min(0),
  /** The rating as printed, e.g. `1/8`. */
  crLabel: z.string().min(1),
  xp: z.number().int().min(0),
  proficiencyBonus: z.number().int().min(0),

  traits: z.array(FeatureSchema),
  actions: z.array(FeatureSchema),
  bonusActions: z.array(FeatureSchema),
  reactions: z.array(FeatureSchema),
  legendaryActions: z.array(FeatureSchema),
});
export type Monster = z.infer<typeof MonsterSchema>;

export const CURRENCIES = ['cp', 'sp', 'ep', 'gp', 'pp'] as const;
export const CurrencySchema = z.enum(CURRENCIES);
export type Currency = z.infer<typeof CurrencySchema>;

export const CostSchema = z.object({
  amount: z.number().min(0),
  currency: CurrencySchema,
});
export type Cost = z.infer<typeof CostSchema>;

/** Normal and long range in feet, as printed `80/320`. */
export const RangeSchema = z.object({
  normal: z.number().int().min(0),
  long: z.number().int().min(0),
});

export const WEAPON_PROPERTIES = [
  'ammunition',
  'finesse',
  'heavy',
  'light',
  'loading',
  'reach',
  'thrown',
  'two-handed',
  'versatile',
] as const;
export const WeaponPropertySchema = z.enum(WEAPON_PROPERTIES);
export type WeaponProperty = z.infer<typeof WeaponPropertySchema>;

/** Weapon mastery properties, new in the 2024 rules. */
export const WEAPON_MASTERIES = [
  'cleave',
  'graze',
  'nick',
  'push',
  'sap',
  'slow',
  'topple',
  'vex',
] as const;
export const WeaponMasterySchema = z.enum(WEAPON_MASTERIES);
export type WeaponMastery = z.infer<typeof WeaponMasterySchema>;

export const WeaponDamageSchema = z.object({
  /** Dice notation, e.g. `1d8`. Null when the weapon deals a flat amount. */
  dice: z.string().nullable(),
  /** Flat damage — only the Blowgun, which deals exactly 1. */
  fixed: z.number().int().nullable(),
  type: z.string().min(1),
});

export const WeaponSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  category: z.enum(['simple', 'martial']),
  kind: z.enum(['melee', 'ranged']),
  damage: WeaponDamageSchema,
  properties: z.array(WeaponPropertySchema),
  /** Damage when wielded two-handed, for Versatile weapons. */
  versatileDamage: z.string().nullable(),
  /** Range for Thrown weapons. */
  thrownRange: RangeSchema.nullable(),
  /** Range for Ammunition weapons. */
  ammunitionRange: RangeSchema.nullable(),
  /** `Bolt`, `Arrow`, `Bullet`, `Needle`. */
  ammunitionType: z.string().nullable(),
  /** Parenthetical caveats, e.g. the Lance's `unless mounted`. */
  propertyNotes: z.string().nullable(),
  mastery: WeaponMasterySchema,
  weightLb: z.number().min(0).nullable(),
  cost: CostSchema,
});
export type Weapon = z.infer<typeof WeaponSchema>;

export const ArmorSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  category: z.enum(['light', 'medium', 'heavy', 'shield']),
  /** Base AC the armour sets. Null for a Shield, which adds instead. */
  baseAc: z.number().int().min(0).nullable(),
  /** What a Shield adds to AC. Null for body armour. */
  acBonus: z.number().int().nullable(),
  addsDexModifier: z.boolean(),
  /** The `(max 2)` cap on medium armour. */
  maxDexBonus: z.number().int().nullable(),
  /** Minimum Strength score, or null when there is no requirement. */
  strengthRequirement: z.number().int().nullable(),
  stealthDisadvantage: z.boolean(),
  weightLb: z.number().min(0).nullable(),
  cost: CostSchema,
});
export type Armor = z.infer<typeof ArmorSchema>;

/**
 * A problem found while parsing. Collected rather than thrown so one bad entry
 * does not hide the other forty.
 */
export interface ParseProblem {
  /** Source file the entry came from, e.g. `spells.md`. */
  readonly source: string;
  /** Name or heading of the entry, when it got far enough to have one. */
  readonly entry: string;
  readonly message: string;
}

export interface ParseOutput<T> {
  readonly items: readonly T[];
  readonly problems: readonly ParseProblem[];
}

/**
 * Slugify a name into a stable id: `Acid Splash` -> `acid-splash`.
 *
 * An apostrophe is dropped rather than replaced, so `Alchemist's Supplies`
 * becomes `alchemists-supplies` and not `alchemist-s-supplies`.
 *
 * This did move three existing ids, which an earlier note here said it would
 * not: Arcanist's Magic Aura, Dragon's Breath and Hunter's Mark. The generated
 * `spell-index.ts` simply had not been regenerated yet, so the claim looked
 * true. Nothing referenced them, and the three new ids are the ones anybody
 * would guess — but the lesson is that a generated file left stale hides
 * exactly this, so regenerate before asserting what a change does not touch.
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * A weight the SRD prints in the Adventuring Gear or Tools tables.
 *
 * Three states, not two, which is why this is a union rather than the
 * `weightLb: number | null` that Weapon and Armor use. Those tables print
 * either a number or `—`; the gear table also prints `Varies`, and the two
 * non-numeric cells mean opposite things. A Bell weighs nothing worth
 * tracking; Ammunition's weight is simply stated elsewhere, on the variant.
 * Collapsing both to null would let an encumbrance calculation treat a
 * Musical Instrument as weightless.
 */
export const GearWeightSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('lb'), value: z.number().min(0) }),
  /** The table printed `—`. */
  z.object({ kind: z.literal('negligible') }),
  /** The table printed `Varies`; the weight lives on each variant. */
  z.object({ kind: z.literal('varies') }),
]);
export type GearWeight = z.infer<typeof GearWeightSchema>;

/** As `GearWeight`, but the cost column never prints `—`. */
export const GearCostSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('cost'), value: CostSchema }),
  z.object({ kind: z.literal('varies') }),
]);
export type GearCost = z.infer<typeof GearCostSchema>;

/**
 * One priced form of an entry whose own cost is `Varies` — an Arcane Focus's
 * Rod, a Musical Instrument's lute. Each is bought separately, so each carries
 * its own weight and cost.
 */
export const GearVariantSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  weight: GearWeightSchema,
  cost: GearCostSchema,
});
export type GearVariant = z.infer<typeof GearVariantSchema>;

/**
 * One line of a pack's contents: which catalogue row, and how many.
 *
 * SRD prints these as prose — "10 flasks of Oil, 10 sheets of Parchment" — so
 * the parser resolves each phrase back to the row it names. A phrase that
 * resolves to nothing is a parse problem rather than a silently short pack.
 */
export const PackContentSchema = z.object({
  gearId: z.string().regex(/^[a-z0-9-]+$/),
  /** How the SRD wrote it, kept so a log can quote the book. */
  printed: z.string().min(1),
  quantity: z.number().int().min(1),
});
export type PackContent = z.infer<typeof PackContentSchema>;

export const GearSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  weight: GearWeightSchema,
  cost: GearCostSchema,
  /** The prose under the item's own heading, tables stripped out. */
  description: z.string().min(1),
  variants: z.array(GearVariantSchema),
  /** What a pack holds. Empty for everything that is not a pack. */
  contents: z.array(PackContentSchema),
});
export type Gear = z.infer<typeof GearSchema>;

/**
 * Gear as the engine sees it: everything but the prose.
 *
 * The engine is pure and ships its data as TypeScript, so the index is kept
 * compact. A description is narration and belongs to the DM layer, which can
 * read the generated JSON.
 */
export type GearIndexEntry = Omit<Gear, 'description'>;

/**
 * A row of the Ammunition table.
 *
 * Kept apart from `GearVariant` because it has columns nothing else has: how
 * many you get for the price, and what you store them in. Folding it into the
 * shared variant shape would put two permanently-null fields on every focus.
 */
export const AmmunitionSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  /** How many the listed cost buys. */
  amount: z.number().int().min(1),
  /** The item it is typically stored in. Bought separately. */
  storage: z.string().min(1),
  weight: GearWeightSchema,
  cost: GearCostSchema,
});
export type Ammunition = z.infer<typeof AmmunitionSchema>;

/** One thing a tool lets you do with the Utilize action, and its DC. */
export const ToolUseSchema = z.object({
  description: z.string().min(1),
  dc: z.number().int().min(0).nullable(),
});
export type ToolUse = z.infer<typeof ToolUseSchema>;

export const ToolSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  /** Artisan's Tools each need a separate proficiency; Other Tools stand alone. */
  category: z.enum(['artisan', 'other']),
  ability: z.enum(['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma']),
  utilize: z.array(ToolUseSchema).min(1),
  /** What the tool can craft. Empty for the five that craft nothing. */
  craft: z.array(z.string()),
  variants: z.array(GearVariantSchema),
  weight: GearWeightSchema,
  cost: GearCostSchema,
});
export type Tool = z.infer<typeof ToolSchema>;

/**
 * The nine categories the SRD files every magic item under, spelled as the
 * Magic Item Categories table spells them. The italic type line under an
 * entry's heading uses the singular — `_Potion, Common_`, `_Ring, Legendary_`
 * — so the parser maps one onto the other rather than storing two spellings.
 */
export const MAGIC_ITEM_CATEGORIES = [
  'Armor',
  'Potions',
  'Rings',
  'Rods',
  'Scrolls',
  'Staffs',
  'Wands',
  'Weapons',
  'Wondrous Items',
] as const;
export const MagicItemCategorySchema = z.enum(MAGIC_ITEM_CATEGORIES);
export type MagicItemCategory = z.infer<typeof MagicItemCategorySchema>;

export const MAGIC_ITEM_RARITIES = [
  'Common',
  'Uncommon',
  'Rare',
  'Very Rare',
  'Legendary',
  'Artifact',
] as const;
export const MagicItemRaritySchema = z.enum(MAGIC_ITEM_RARITIES);
export type MagicItemRarity = z.infer<typeof MagicItemRaritySchema>;

/** One rarity a type line names, with the parenthesis that distinguishes it. */
export const MagicItemRarityOptionSchema = z.object({
  rarity: MagicItemRaritySchema,
  /**
   * What the book prints beside the rarity to say which version it is: `+2`
   * for _Ammunition, +1, +2, or +3_, `Bronze` for the Horn of Valhalla. Null
   * when the entry names a single unqualified rarity.
   */
  qualifier: z.string().min(1).nullable(),
});
export type MagicItemRarityOption = z.infer<typeof MagicItemRarityOptionSchema>;

/**
 * The rarity clause of a type line.
 *
 * Three shapes, and — as with the gear table's `—` versus `Varies` — two of
 * them are opposites that must not collapse into one absence. `_Potion,
 * Common_` names one rarity; `_Armor, +1, +2, or +3_` names three, one per
 * version; `_Scroll, Rarity Varies_` names none, because a Spell Scroll's
 * rarity is read off a table by spell level. Letting "Rarity Varies" fall
 * through to an empty list would make those seven entries indistinguishable
 * from an entry whose rarity the parser simply failed to read.
 */
export const MagicItemRarityLineSchema = z
  .object({
    /** The clause as printed, e.g. `Uncommon (+1), Rare (+2), or Very Rare (+3)`. */
    text: z.string().min(1),
    /** The book printed "Rarity Varies". */
    varies: z.boolean(),
    /** Every rarity named, in print order. Empty only when `varies`. */
    options: z.array(MagicItemRarityOptionSchema),
  })
  .refine((rarity) => rarity.varies === (rarity.options.length === 0), {
    message: 'rarity must either vary or name at least one rarity, never both and never neither',
  });
export type MagicItemRarityLine = z.infer<typeof MagicItemRarityLineSchema>;

/**
 * How many charges an entry says the item holds.
 *
 * Printed either as a number ("This wand has 7 charges") or as a die roll
 * ("The weapon has 1d8 + 1 charges"), never as both, so exactly one field is
 * set. The clause that says how they come back is prose and stays in the
 * description.
 */
export const MagicItemChargesSchema = z
  .object({
    maximum: z.number().int().min(1).nullable(),
    /** Dice notation, e.g. `1d8 + 1`. */
    formula: z.string().min(1).nullable(),
  })
  .refine((charges) => (charges.maximum === null) !== (charges.formula === null), {
    message: 'charges are printed as a number or as dice, never both and never neither',
  });
export type MagicItemCharges = z.infer<typeof MagicItemChargesSchema>;

/**
 * One entry of "Magic Items A–Z", transcribed rather than interpreted.
 *
 * Every field is something the page prints under the entry's heading. What a
 * magic item *is* to the engine — which of these it can execute, and how — is
 * not decided here, and no field anticipates it.
 */
export const MagicItemSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    name: z.string().min(1),
    category: MagicItemCategorySchema,
    /**
     * The parenthesised restriction on the type line: `Shield`, `Longsword`,
     * `Any Medium or Heavy, Except Hide Armor`. Null when none is printed,
     * which is every entry outside Armor and Weapons.
     */
    subtype: z.string().min(1).nullable(),
    rarity: MagicItemRarityLineSchema,
    requiresAttunement: z.boolean(),
    /**
     * The prerequisite as printed, minus the words "Requires Attunement":
     * `by a Druid`, `by a Spellcaster`, `by a Dwarf or a Creature Attuned to
     * a Belt of Dwarvenkind`. Null when attunement is unconditional.
     */
    attunementPrerequisite: z.string().min(1).nullable(),
    charges: MagicItemChargesSchema.nullable(),
    /** The entry's prose, verbatim, tables included. */
    description: z.string().min(1),
  })
  .refine((item) => item.requiresAttunement || item.attunementPrerequisite === null, {
    message: 'an item that needs no attunement cannot carry an attunement prerequisite',
  });
export type MagicItem = z.infer<typeof MagicItemSchema>;
