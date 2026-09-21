import { err, ok, type Result } from '@ie/shared';
import type { TurnMoment } from './time.js';
import type { Point, PointAnchoring } from './positioning.js';
import type { AreaTrigger, CastingEndTrigger, SpellArea } from './spell-definitions.js';

/**
 * Casting: what a spell costs, who is concentrating on what, and which effects
 * belong to which casting.
 *
 * The load-bearing idea here is the **casting instance**. "Hold Person" is not
 * a thing that is running; *this* casting of Hold Person, by this caster, at
 * this level, is. Two Clerics can have Hold Person on the same goblin, and one
 * of them losing Concentration must end exactly one of the two paralyses.
 *
 * So every casting gets an id, and every effect it creates carries that id in
 * its source. Breaking a casting is then an exact match rather than a search
 * for a spell name — which would catch the other Cleric's spell as well.
 */

/**
 * The separator between a spell's name and the casting that produced it.
 *
 * A condition's source is free-form text, and keeping it readable matters —
 * the log should say "Hold Person", not an opaque id. Appending the casting id
 * keeps both properties: legible to a DM, exact to the engine.
 */
export const CASTING_MARK = '#';

const CASTING_ID = /^cast:\d+$/;

/** What every casting id begins with. One spelling, read and written here. */
const CASTING_PREFIX = 'cast:';

/**
 * The number inside a casting id, for putting castings back in the order they
 * happened.
 *
 * **Numerically, not lexically:** `cast:2` runs before `cast:10`, and a string
 * sort would put ten first — which would silently reorder the checks Dispel
 * Magic rolls and make a replay of the same log produce different dice. It was
 * written out twice in `commands.ts`, byte for byte, which is one copy too
 * many for a comparison the determinism guarantee rests on.
 */
export const castingNumber = (castingId: string): number =>
  Number(castingId.slice(CASTING_PREFIX.length)) || 0;

/** The source string an effect created by a casting carries. */
export function castingSource(spell: string, castingId: string): string {
  return `${spell}${CASTING_MARK}${castingId}`;
}

/** The casting an effect came from, or null if it did not come from one. */
export function castingIdOf(source: string): string | null {
  const at = source.lastIndexOf(CASTING_MARK);
  if (at < 0) return null;
  const candidate = source.slice(at + CASTING_MARK.length);
  return CASTING_ID.test(candidate) ? candidate : null;
}

/** The readable half of a source: the spell name, or the source unchanged. */
export function spellOfSource(source: string): string {
  return castingIdOf(source) === null ? source : source.slice(0, source.lastIndexOf(CASTING_MARK));
}

/**
 * A spell name has to be usable and must not forge a casting link.
 *
 * Validated before anything is spent, so a bad name costs no slot — the same
 * "validate before rolling" discipline the rest of the engine follows.
 */
export function validateSpellName(name: string): Result<string> {
  const trimmed = name.trim();
  if (trimmed === '') return err('bad_spell', 'a spell needs a name');
  if (trimmed.includes(CASTING_MARK)) {
    return err('bad_spell', `a spell name may not contain ${CASTING_MARK}`);
  }
  return ok(trimmed);
}

/**
 * SRD: "A level 1 spell fits into a slot of any size, but a level 2 spell fits
 * only into a slot that's at least level 2."
 */
export function slotFits(spellLevel: number, slotLevel: number): boolean {
  return slotLevel >= spellLevel;
}

/** SRD "Casting without Slots", plus the innate casting monsters do. */
export type SlotlessReason = 'cantrip' | 'ritual' | 'special-ability' | 'magic-item' | 'innate';

export type CastingTime = 'action' | 'bonus-action' | 'reaction' | 'long';

/**
 * The floor of SRD's `long` bucket, in seconds.
 *
 * "Certain spells—including a spell cast as a Ritual—require more time to
 * cast: **minutes or even hours**." A minute is what the bucket *means*, so a
 * `long` casting shorter than one is incoherent rather than merely unusual.
 *
 * **One number, one place**, read by the definition validator and by the
 * casting command alike. Two constants would be two floors, and the low-level
 * half accepting a six-second `long` casting that no definition could declare
 * is exactly the second answer to one question this engine keeps finding.
 */
export const LONG_CASTING_SECONDS = 60;

/** What a creature is currently concentrating on. */
export interface Concentration {
  readonly castingId: string;
  readonly spell: string;
  /** The level it was cast at — the slot's level when it was upcast. */
  readonly level: number;
}

/**
 * A casting that is still mechanically running.
 *
 * **This is not the casting; it is what the casting left behind.** The casting
 * is history and the event log has it — which slot went, which action, at what
 * moment. This is the live half: the handful of facts a *later* mechanic has
 * to be able to ask about, and which nothing else holds.
 *
 * The SRD decides every field, and Dispel Magic decides most of them: "Any
 * ongoing spell of level 3 or lower on the target ends. For each ongoing spell
 * of level 4 or higher on the target, make an ability check ... (DC 10 plus
 * that spell's level)." To obey that sentence an engine must be able to say,
 * of one creature, **which spells are on it and at what level** — and before
 * this record the level lived only in the log and on a concentrating caster.
 *
 * | Field | The mechanic that needs it |
 * |---|---|
 * | `castingId` | the handle everything already uses to link an effect to its cause |
 * | `level` | Dispel Magic's threshold and its DC |
 * | `caster` | "**you** can take a Magic action" — nobody else may act through it |
 * | `spellId` | finding the definition again, a minute later |
 * | `numbers` | the save DC, the attack modifier and the rest, as they were |
 * | `area`, `areaTrigger` | who a persistent area catches, and at which moment |
 * | `on` | "on the target": which creatures this spell is currently affecting |
 * | `origin` | "within 5 feet of the force": where a spell that holds a point is |
 *
 * **Two fields it used to carry and nobody read.** `concentration` restated a
 * fact the creature holds — whoever is concentrating names the casting — and
 * `route` was a *name*, which has to be resolved against a sheet before it is
 * a number and therefore answers nothing a minute later; `numbers` is what a
 * later use actually reads. Two answers to one question is the failure this
 * record exists to avoid, so both are gone. See {@link version}.
 *
 * **No second identity.** One casting can affect several creatures — Hold
 * Person at level 3 holds two — and each is released independently, but each
 * is addressed as *(casting, creature)*, which the engine has always done.
 * The spells that create a *thing* with a position of its own do not need one
 * either: SRD addresses that thing only through the caster's own action on
 * this casting, so `origin` below is a field rather than an entity.
 *
 * **What is deliberately absent**: the slot, the casting time, the targets as
 * they were named, anything a narrator would like. Those are history, the log
 * has them, and duplicating them here would make two answers to one question.
 */
export interface OngoingSpell {
  /** The casting that created it — the same id every effect already carries. */
  readonly castingId: string;
  readonly caster: string;
  /** The SRD slug, so a later activation finds the same definition. */
  readonly spellId: string;
  /** The display name, so a log needs no lookup. */
  readonly spell: string;
  /**
   * The level it was cast at, which is the slot's level when upcast.
   *
   * The reason this record exists at all: Dispel Magic reads it, and nothing
   * live held it for a spell whose caster is not concentrating.
   */
  readonly level: number;
  /**
   * Which shape of this record the log was written with.
   *
   * **Absent means what it always meant.** A record written before the fold
   * stopped consulting the catalogue carries no `area` and no `areaTrigger`,
   * and there is no other place those facts could have been written down — so
   * a record with no version is read by looking the definition up **once**, as
   * it always was. See `ongoing-compatibility.ts`, which is the only thing
   * left in the fold's path that opens the catalogue, and does it for a
   * pre-versioned record and nothing else.
   *
   * A version rather than "is `area` absent", because absence is ambiguous:
   * most spells have no area at all, and reading every one of them as a legacy
   * record would leave the fold consulting the catalogue for ever.
   *
   * **Version 3 is the shape that stores {@link aimed} rather than "on".** The
   * older shapes are read by {@link WrittenOngoing}; what this engine holds in
   * `state.ongoing` has always been through `upgradeOngoing`, so it is this
   * version and no other.
   */
  readonly version: 3;
  /**
   * The area this casting filled, and the clauses that fire in it — **as
   * cast**.
   *
   * Pinned for the same reason {@link numbers} is, and against a sharper
   * hazard: an area's shape and its trigger clauses are *catalogue data*, so
   * before this the fold asked `definitionFor` on every read and a replay of
   * last week's log consulted this week's catalogue. Correct a transcribed
   * Cube size and a historical fold raises different debts than the live
   * session raised — which is "every future rules fix silently rewrote
   * history" arriving through data rather than through rules.
   *
   * Absent on a version 2 record means the spell has no persistent area, which
   * is all but a handful of them.
   */
  readonly area?: SpellArea;
  /**
   * The clauses that fire in {@link area}, as cast. Absent means none.
   *
   * **The fold reads four of its fields** — `at`, `onEntry`, `onAreaEntry` and
   * `oncePerTurn`, which between them decide who a persistent area catches and
   * at which of the SRD's moments. Those are the ones that had to stop coming
   * out of the catalogue.
   *
   * `effects` and `label` are recorded and **not** read here: settlement
   * resolves them through `definitionFor`, as it always has, so a correction
   * to Web's saving throw does reach a debt raised before it. That is stated
   * rather than fixed, because moving settlement onto the record is a second
   * change with its own compatibility question — a pre-versioned record has no
   * effects to read — and this one is about the fold. The clause is stored
   * whole anyway, because `AreaTrigger` is one value the SRD writes as one
   * sentence, and storing four of its fields would be a second shape for it.
   */
  readonly areaTrigger?: AreaTrigger;
  /**
   * What stops this casting before its time is up — **as cast**.
   *
   * Pinned for the reason {@link area} and {@link numbers} are, and the rule
   * is the same one IE-007 set: *pinned for the casting, read live for the
   * creature it is happening to.* A trigger list is catalogue data, so a fold
   * that looked it up would let a corrected transcription reach a casting made
   * before the correction — a Mage Armor cast last week ending on a sentence
   * nobody had written when it was cast.
   *
   * **Absent means none**, on a version 2 record. A pre-versioned record never
   * wrote the fact down at all, so `upgradeOngoing` fills it from the
   * catalogue exactly as it fills the area — see `ongoing-compatibility.ts`,
   * which is the one place left on the fold's path that opens the book.
   *
   * Read by the derived pass in `events.ts`, which is where the members are
   * matched to the events that raise them. Nothing else reads it.
   */
  readonly endsEarly?: readonly CastingEndTrigger[];
  /**
   * The numbers this casting was made with — see {@link CastingNumbers}.
   *
   * Pinned rather than re-derived, which is the difference between a Web whose
   * DC is the one it was conjured at and a Web that gets harder every time its
   * caster levels.
   */
  readonly numbers: CastingNumbers;
  /**
   * The creatures the **cast** put this spell on and the world cannot say so,
   * sorted. **Not "who it is on now"** — `spellOn` in `fold/release.ts` is.
   *
   * SRD Dispel Magic ends "any ongoing spell ... **on the target**", and that
   * question has two halves of different provenance:
   *
   * | Bucket | Where the answer lives |
   * |---|---|
   * | the caster of a Range: Self spell — Vampiric Touch is on the wizard and hangs nothing there | **here**: a cast-time declaration, and nothing in state records it |
   * | a target the casting reported nothing about, which the geometry did not choose — the tracked spells, Darkvision and its ten siblings | **here**: same, and it is how Darkvision stays dispellable |
   * | whoever the casting hung a live effect on | **the world**: `holdsNothingOf` answers it at every read, so it is not stored |
   *
   * So what is stored is the whole of `on` **minus** what the casting is
   * holding, computed once at the cast, and the reader unions the two back
   * together. That is why it is named for the *aiming* rather than for the
   * state: a name here is a decision somebody took, not a fact about now.
   *
   * **The name a target sheds still leaves this list** — `withoutTarget` takes
   * it off when a creature shakes the spell off, is dispelled on, or leaves
   * the game. A dispelled Darkvision has nothing in the world to lose, so
   * without that the casting would still be aimed at them for ever.
   *
   * Empty is the common state rather than an error: every spell that hung
   * something on everyone it caught stores nothing at all, and Minor Illusion
   * is on nobody, which is why Dispel Magic calls that case "a magical effect"
   * rather than a creature.
   */
  readonly aimed: readonly string[];
  /**
   * Where this casting is, for a spell that holds a point in the scene.
   *
   * SRD Spiritual Weapon: "The force appears within range **in a space of your
   * choice**", and every later sentence measures from it — "one creature
   * within 5 feet of the force", "move the force up to 20 feet". Nothing else
   * in the engine could answer where the force is: a creature's position is in
   * the scene, and the force is not a creature.
   *
   * **It is a point, and the SRD is why it is only a point.** Read Spiritual
   * Weapon against the two spells that look like it and print more:
   *
   * | | Spiritual Weapon | Unseen Servant / Arcane Hand |
   * |---|---|---|
   * | Armour Class, Hit Points | none printed | "AC 10, 1 Hit Point"; "AC 20 and Hit Points equal to your Hit Point maximum" |
   * | Can be attacked | nothing addresses it | dropping to 0 Hit Points ends the spell |
   * | Occupies its space | nothing says so | Arcane Hand says explicitly that it does *not*, because it otherwise would |
   * | Acts | the caster spends a Bonus Action | the caster commands it, and it has a Strength score |
   *
   * So a creature record here would be inventing an Armour Class the book
   * declines to print. The second column is the **summons** seam and waits
   * there.
   *
   * Absent means this casting holds no point — which is most of them. Not
   * null: "nobody has said where it is" is not a state a spell with an origin
   * can be in, because the space is chosen at the cast or the cast is refused.
   *
   * **An area spell's point lives here too**, and for the same reason: Web's
   * 20-foot Cube is somewhere, and a rule that asks an hour later who is
   * standing in it has nothing else to read. The two readers differ —
   * `CastingOrigin.reach` for a spell that acts *from* the point, `SpellArea`
   * for one that fills a shape around it — and the fact is one fact.
   */
  readonly origin?: Point;
  /**
   * Which way a directional area was laid, for a Cone, Cube or Line.
   *
   * The one fact about a persistent area that **cannot be reconstructed**. The
   * shape and its dimensions come off the definition and the origin is
   * recorded above, but where the caster pointed a 20-foot Cube was a decision
   * taken once, at the casting, and nothing else remembers it. `placeArea`
   * resolved it and threw it away, so every later membership question would
   * have had to guess — which is the shape of every bug this engine exists to
   * refuse.
   *
   * Absent for a Sphere, a Cylinder or an Emanation, which have no direction
   * to be wrong about.
   */
  readonly towards?: Point;
  /**
   * Which convention `origin` and `towards` are read under.
   *
   * A coordinate cannot say whether it names a space or the intersection
   * four spaces meet at, and that bit decides whether the footprint comes out
   * odd or even — nine spaces across for a 20-foot radius on a space, eight
   * for the same radius on an intersection. The caster chose it at the casting and
   * every later membership question has to read the same one, or a Web would
   * catch a different set of creatures an hour later than it caught at the
   * cast.
   *
   * **Absent means `space`**, which is what every casting written before
   * intersections existed meant, so an old log folds to exactly the same state.
   */
  readonly anchoring?: PointAnchoring;
  /**
   * Creatures the caster declared unaffected when the spell was cast.
   *
   * SRD Spirit Guardians: "**When you cast this spell, you can designate
   * creatures to be unaffected by it.**" Alarm prints the same shape — "you
   * can designate creatures that won't set off the alarm" — which is what
   * makes this a transcribed clause rather than a generic filter somebody
   * invented: two spells, one sentence, and no third use imagined.
   *
   * **Chosen once and kept**, because the SRD chooses once: the sentence is
   * about the casting, not about a moment, so a creature designated at the
   * cast stays unaffected however far the aura later travels.
   *
   * **Explicit, never allegiance.** `side` is a declared fact about who is
   * fighting whom and the SRD asks for neither side nor alliance here; a
   * cleric may spare an enemy and may decline to spare an ally. Substituting
   * allegiance would be the engine answering a question the caster was asked.
   *
   * Absent for every spell that prints no such clause, which is all but one of
   * the ones the engine executes.
   */
  readonly unaffected?: readonly string[];
  /**
   * The damage type this casting was declared with, for a spell that prints
   * two and chooses between them on a fact about the caster.
   *
   * SRD Spirit Guardians: "3d8 Radiant damage (**if you are good or neutral**)
   * or 3d8 Necrotic damage (**if you are evil**)." Alignment is a fact about a
   * character that the engine holds only for characters it built, and never
   * for a monster or a declared NPC — so the engine does not infer it. The
   * layer that reads the fiction states it at the casting, the engine refuses
   * anything but the two the spell prints, and the answer is pinned here for
   * the same reason {@link CastingNumbers} is: a spell already cast does not
   * change when its caster does.
   *
   * The same three-valued discipline cover and sight already follow — stated,
   * or asked for, never guessed.
   */
  readonly damageType?: string;
}

/**
 * An ongoing record **as some log wrote it**, which may be older than this
 * engine reads.
 *
 * `OngoingSpell` is what the fold *holds*: every record in `state.ongoing` has
 * been through `upgradeOngoing`, so it is version 3 and it carries `aimed`. A
 * `spell-ongoing` event is the other thing — a line in a log that may have
 * been written years of commits ago — and the two were one type only while
 * they happened to agree.
 *
 * So the shapes older than version 3 are declared here and nowhere else: a
 * pre-versioned record, which wrote neither the area nor the version, and a
 * version 2 record, which wrote the whole of "on" where `aimed` now is. Both
 * are read in `ongoing-compatibility.ts` and both stop existing there.
 *
 * It is a supertype rather than a union, so `OngoingSpell` is assignable to it
 * and the resolvers that write a record need no cast.
 */
export interface WrittenOngoing extends Omit<OngoingSpell, 'version' | 'aimed'> {
  /** Absent before the field existed; 2 before `aimed` did. */
  readonly version?: 2 | 3;
  /** Present from version 3 on. */
  readonly aimed?: readonly string[];
  /** What version 2 and every earlier shape wrote where `aimed` now is. */
  readonly on?: readonly string[];
}

/**
 * The numbers a casting was made with, fixed at the moment it was made.
 *
 * **A spell already cast does not change when its caster does.** Before this,
 * a later use — an activation, an area catching somebody a minute on — asked
 * `chooseRoute` against the caster's *current* sheet and derived the DC again.
 * A Cleric who levelled between conjuring a Web and somebody walking into it
 * moved the save DC; so did an Ability Score Improvement, a new proficiency
 * bonus, or preparing the same spell through a second class.
 *
 * The four are what later resolution genuinely reads, audited rather than
 * guessed:
 *
 * | | Read by |
 * |---|---|
 * | `saveDc` | every saving throw the spell calls for, and every escape check it offers |
 * | `attackModifier` | a later spell attack — Spiritual Weapon, Vampiric Touch, Flame Blade |
 * | `spellcastingModifier` | "plus your spellcasting ability modifier" on damage, healing and Temporary Hit Points |
 * | `casterLevel` | a cantrip's upgrade steps, which are read off the caster's level rather than the slot |
 *
 * **Not a snapshot of the sheet**, deliberately. What a spell's later use needs
 * is these numbers; what it must go on reading live is everything about the
 * creature it is happening *to*, and everything about the caster that is
 * genuinely current — a Bless on them now applies now.
 */
export interface CastingNumbers {
  readonly saveDc: number;
  readonly attackModifier: number;
  readonly spellcastingModifier: number;
  readonly casterLevel: number;
}

/**
 * The moment at which a persistent area caught a creature.
 *
 * Carried on the debt because settlement has to **order by it** — the creature
 * finishing its turn and the creature beginning the next one are not
 * simultaneous, and the debts they raise arrive in one fold of one event. An
 * implementation that let the key order decide would settle whichever sorted
 * first, which is a coin toss dressed as a rule.
 *
 * `entry` is one value rather than three because the *cause* of a creature's
 * position change is not a rule: a creature that walked in, was shoved in, or
 * was carried in by its mount has entered, and the SRD writes one clause for
 * all three.
 *
 * **`area-moved` is a fourth value and not a fourth cause of `entry`**, and
 * the SRD is why. Moonbeam: "A creature also makes this save **when the
 * spell's area moves into its space** and when it enters the spell's area or
 * ends its turn there." Two clauses in one sentence, and Cloudkill, Incendiary
 * Cloud and Spirit Guardians all print the same pair. A creature that has not
 * moved has not entered anything — the beam arrived — and two consequences
 * follow that a shared value would have got wrong:
 *
 * - **The entry cap must not be spent by it.** `onEntry: 'first-per-turn'` is
 *   Web's cap on *entering*; an area sliding onto a creature is not that
 *   creature's first entry of the turn and must not consume it. No registered
 *   spell prints both clauses today, which is exactly when the distinction is
 *   cheap to keep and impossible to reconstruct later.
 * - **The history must say which happened.** `area-effect-settled` carries the
 *   moment, and "the beam swept over you" and "you walked into the beam" are
 *   different answers to why a creature took radiant damage.
 *
 * What the two share is the *consequence*: one debt, one queue, one
 * settlement. The cause is distinguished; the machinery is not duplicated.
 *
 * **The two boundaries are {@link TurnMoment} and not this module's own
 * words.** A creature ending its turn in a Web and a creature ending its turn
 * Poisoned are the same moment reached by two mechanisms, and an area that
 * spelled out its own copy of the pair would be a second place to rename.
 * What is left here is what is genuinely the area's: how a creature came to be
 * in one.
 */
export type AreaMoment = TurnMoment | 'entry' | 'area-moved';

/**
 * An effect a persistent spell area owes a creature, and has not yet dealt.
 *
 * The fourth debt of this shape in the engine — after `pendingSaves`,
 * `scheduledDamage` and the Reaction windows — and it is deliberately **not**
 * a `PendingSave`, which means something else entirely:
 *
 * | | `PendingSave` | This |
 * |---|---|---|
 * | Presupposes | a condition or timer already on the target | nothing; the target may be untouched |
 * | What the roll does | releases an effect that is already running | applies the spell for the first time |
 * | On success | the effect ends on that creature | whatever the spell says, which is often half damage |
 * | Keyed by | the timer it belongs to | the casting and the creature |
 *
 * Forcing Web's "make a save or be Restrained" into a shape that exists to let
 * a Restrained creature *stop* being Restrained would have inverted the rule.
 *
 * **It holds facts, never behaviour.** No predicate, no callback, no copy of
 * the spell: settlement looks the definition up through the casting's own
 * `spellId` and runs it at the level and route the casting was made with. What
 * is authoritative here is that the moment *happened* — settlement never
 * recomputes whether the creature was inside, because by then it may not be.
 *
 * **The turn it was raised on is not here**, and used not to be read either.
 * The once-per-turn caps are `state.areaTriggers`' business and are stamped
 * when the debt is raised; settlement orders by the moment, then the casting,
 * then the target. A number carried on a debt and read by nothing is a second
 * place for the cap to be got wrong.
 */
export interface OwedAreaEffect {
  /** The casting whose area caught them. Never the spell's name. */
  readonly castingId: string;
  readonly target: string;
  readonly moment: AreaMoment;
}

/**
 * When a casting's area last caught a creature, and how.
 *
 * The whole of the frequency machinery. Keyed by casting and creature —
 * **never by spell name**, because two Insect Plagues over one square are two
 * castings and each owes its own save.
 *
 * Deliberately not `featureUsedOnTurn`, which records what a creature spent on
 * its own turn budget. This is not the caught creature's budget and not the
 * caster's: it is a fact about one casting reaching one creature during one
 * turn of the fight. Same technique — a `turnsTaken` stamp — and different
 * storage, because a turn budget is refreshed at the start of a turn and this
 * must not be.
 */
export interface AreaTriggerStamp {
  /** The global turn, from `turnsTaken`. */
  readonly turn: number;
  /**
   * Whether a **creature-side entry** was among what fired this turn.
   *
   * Named for the cause rather than for the membership change, because one
   * cap in the book reads exactly that narrowly: Web's "**The first time a
   * creature enters** the webs on a turn". An area that slides onto a
   * standing creature has not been entered by it, so `area-moved` never sets
   * this and is never barred by it — see {@link AreaMoment}. The shorter name
   * `byEntry` was the same field before an area could move, and it would have
   * read as true of both.
   */
  readonly byCreatureEntry: boolean;
}

/** The key a stamp is filed under: one casting, one creature. */
export const areaStampKey = (castingId: string, target: string): string =>
  `${castingId}|${target}`;

/**
 * Why an ongoing spell stopped, when somebody *decided* it.
 *
 * Deliberately short. Concentration breaking and a deadline passing are
 * derived — nobody decides either — so they end the record through the same
 * reducer pass that already ends the conditions, with no event of their own.
 * That is the audit trade `CLAUDE.md` records for expiry, unchanged.
 */
export type OngoingEndReason =
  /** SRD Dispel Magic, and anything else that ends a spell by naming it. */
  | 'dispelled'
  /** SRD Mage Hand: "The hand vanishes ... if you cast this spell again." */
  | 'recast'
  /**
   * SRD, on a spell with a duration: "you can dismiss it (no action required)
   * if you don't have the Incapacitated condition."
   *
   * `ConcentrationEndReason.voluntary`'s sentence, arriving on the other half
   * of the same idea — and a separate member for the same reason those two
   * unions keep `dispelled` apart from it: a dispel is somebody else's magic
   * defeating yours, and this is the creator letting go of their own.
   */
  | 'dismissed';

/**
 * Why a Concentration ended. Every one of these is in the SRD except
 * `dispelled`, which stands in for the effects that end a spell by name.
 */
export type ConcentrationEndReason =
  | 'voluntary'
  /**
   * SRD Ready: a held spell's magic let go on purpose, at its trigger.
   *
   * Distinct from `voluntary`, which is a caster dropping a spell that was
   * doing something. This one is a spell that had not started yet: the
   * Concentration existed only to hold it, and releasing it is the spell
   * finally happening rather than the caster giving up on it.
   */
  | 'released'
  /**
   * SRD "Longer Casting Times": a casting of a minute or more is sustained by
   * Concentration while it is being cast, and that Concentration has nothing
   * left to hold once the spell takes effect.
   *
   * Distinct from `released` in the same way `released` is distinct from
   * `voluntary`: nobody gave anything up. The Concentration existed only to
   * carry the casting to its completion, and completing it is the spell
   * happening rather than the caster stopping. A spell that *itself* takes
   * Concentration writes nothing at all here — there is one Concentration and
   * it simply carries on under the same casting id.
   */
  | 'completed'
  | 'another-concentration-effect'
  | 'failed-save'
  | 'incapacitated'
  | 'died'
  | 'removed'
  | 'dispelled';

/** What a damaged concentrator has to roll, and against what. */
export interface ConcentrationCheck {
  readonly castingId: string;
  readonly spell: string;
  readonly ability: 'con';
  readonly dc: number;
  /** The damage the DC came from, for the audit trail. */
  readonly damage: number;
}
