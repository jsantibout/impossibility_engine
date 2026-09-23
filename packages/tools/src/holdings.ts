/**
 * What one character holds, and what is left of it.
 *
 * `observe.ts` answers "what is going on" for the whole table; this answers
 * "what have I got" for one creature, and the split is deliberate. A caller
 * choosing what to do on its turn needs its slots, its pools and the features
 * it may switch on; a caller narrating the room needs none of them, and folding
 * a feature inventory into every `look` would multiply the largest read on the
 * surface by the size of the roster.
 *
 * **Nothing here decides a rule, and in particular nothing here decides
 * whether a feature may be used right now.** The report says what the
 * character has, what the feature costs, what is left of the pool it draws on
 * and whether it is already running; whether the engine will allow it is the
 * *command's* answer, and asking the question twice in two places is how two
 * answers drift. The one thing this adds beyond the record is `spentBy` — the
 * name of the tool that spends each feature — which is the same closing of a
 * loop `Establish.tools` already does for a fact that must be established: a
 * feature a caller is told it holds and cannot find a door for is half a door.
 *
 * Every number is read off `GameState` through the engine's own readers where
 * one exists — {@link armorClassOf} and {@link speedOf} rather than the sheet,
 * because a caller shown the base number would be reasoning against a number
 * the engine never uses.
 */

import type { CharacterId } from '@ie/shared';
import type { FeatureReactionWindow, GameState, WeaponSelector } from '@ie/engine';
import {
  armorClassOf,
  attunedItems,
  carrying,
  coinsOf,
  movementLeftFor,
  pactSlotKey,
  speedOf,
  spellSlotKey,
} from '@ie/engine';

const SLOT_LEVELS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

/**
 * The tools that spend a feature, by the shape of the feature on the sheet.
 *
 * A record rather than a string beside each branch, because the point of the
 * field is that a caller can dispatch on it: `holdings.test.ts` asserts every
 * name here is a tool this surface really publishes.
 */
export const SPENT_BY = {
  activated: 'activate_feature',
  'self-heal': 'heal_with_feature',
  'healing-touch': 'draw_on_healing_pool',
  recovery: 'regain_uses',
  /**
   * One resource paid for with another: SRD Font of Inspiration, SRD Wild
   * Resurgence.
   *
   * `recovery` one door along, and the pair is the SRD's own split: that one
   * gives a pool's uses **back** for free at a moment the feature names, and
   * this one *buys* them out of something else. The engine has run both ends
   * since `tradeResource` landed — two refusals, a once-a-turn ledger key and
   * a once-a-day pool — and nothing above it could ask, so two level 5
   * features were stopped at a door that was not there.
   */
  trade: 'trade_resource',
  /** A pool with a menu: SRD Channel Divinity's Turn Undead, Divine Spark. */
  'pool-option': 'use_pool_option',
  /** A use spent to put a Reaction in somebody else's hands: Bardic Inspiration. */
  conferral: 'confer_reaction',
  /**
   * Bought by a blow rather than spent on its own: SRD Stunning Strike.
   *
   * The tool is `attack`, and that is the point of listing it. A rider costs
   * no action of its own — it rides on a swing somebody was making anyway —
   * so a caller looking for a door called `use_stunning_strike` would find
   * none and conclude the feature was shut. It is `attack.onHit`.
   */
  'hit-rider': 'attack',
  /** Elected on a casting rather than spent on its own — `usingFeatures`. */
  'casting-election': 'cast_spell',
  /**
   * Invoked as a cheaper price on a named action: SRD Cunning Action, SRD
   * Adrenaline Rush.
   *
   * `casting-election`'s exact shape one door along. The feature is a standing
   * grant holding an `allows` rule, so there is nothing to switch on and no
   * pool to draw down — what it buys is the right to *state* a slot, and the
   * whole of spending it is `take_action.from`. It was filed under `passive`
   * until this entry existed, which told a caller holding the SRD's most
   * famous Bonus Action that nothing spent it.
   *
   * **Only the widening rule is listed.** `forbids` and `permits-only` are the
   * other two members of the same union and they narrow what is legal rather
   * than offering anything, so a creature caught by one holds a fact about its
   * turn and not a door — which is what `passive` has always meant here.
   */
  'action-price': 'take_action',
  /**
   * A use that buys room in the turn's own budget: SRD Action Surge's
   * additional action, SRD Flurry of Blows' two Unarmed Strikes.
   *
   * `pool-option` one purchase along, and the difference is what the use
   * buys: an effect list is aimed at somebody, and this is aimed at the
   * turn. It is the last of the pools that were shut under the rule "a pool
   * a caller can spend for no effect is worse than one it cannot spend" —
   * `useBudgetPurchase` executes what the use buys, so the door is honest.
   */
  'budget-purchase': 'use_budget_purchase',
  /**
   * A use that lays a stat block over the character: SRD Wild Shape.
   *
   * `activated` one door along, and not the same door: an activation switches
   * standing effects on and this swaps the whole sheet, so the call names a
   * form as well as a feature and the engine's `assumeShape` is what takes it.
   * It was the last pool a caller could refill and never spend — the pool
   * counted, recovered on both rests and bought nothing, which
   * `reachability.test.ts` listed under `NOTHING_TO_BUY` until this line.
   */
  shape: 'assume_shape',
} as const;

export type SpendableKind = keyof typeof SPENT_BY;

/**
 * The tool that answers each window a Reaction can sit in.
 *
 * `SPENT_BY`'s counterpart for a Reaction, and keyed by the **window** rather
 * than by the kind of thing, because that is what decides the door: a feature
 * that answers a damage roll and one that answers a D20 Test are the same kind
 * of thing and are taken through different calls.
 *
 * A `Record` over the engine's own union, so the day a fourth window is opened
 * this is a compile error rather than a granted Reaction with no door — which
 * is the shape `outcome.ts` uses for the same reason one layer down. All three
 * of today's are answerable, which was not true until `take_damage_response`
 * arrived: the third window's feature half reached no tool at all.
 */
export const TAKEN_BY: Readonly<Record<FeatureReactionWindow, string>> = {
  'damage-rolled': 'take_damage_reaction',
  'damaged-by-creature': 'take_damage_response',
  'test-rolled': 'take_test_reaction',
};

/**
 * What kind of thing a feature is, from the caller's point of view.
 *
 * `passive` has no door and says so: a passive benefit is never anybody's to
 * spend. A `reaction`'s door is the tool that answers its window,
 * {@link TAKEN_BY}; `options` reports the Reaction when a window opens for it.
 *
 * **`passive` used to swallow a standing grant that *is* spendable.** Every
 * standing effect that was not an optional casting-damage election landed
 * there, which was right while the only other thing on a sheet was a bonus or
 * a mode; a grant holding an `allows` action rule is neither, and SRD Cunning
 * Action is one. It is `action-price` now and names `take_action`.
 */
export type HeldFeatureKind = SpendableKind | 'reaction' | 'passive';

export interface HeldSlots {
  readonly level: number;
  readonly max: number;
  readonly spent: number;
  readonly left: number;
}

export interface HeldPool {
  readonly key: string;
  /** How to say it out loud: "Rage", "Lay On Hands". */
  readonly label: string;
  readonly max: number;
  readonly spent: number;
  readonly left: number;
  /** What refills it: a Short Rest, a Long Rest, a dawn, or something special. */
  readonly recovers: string;
  /** Uses a **Short** Rest gives back without refilling it, where it does. */
  readonly regainsOnShortRest: number | null;
}

/** One item off a pool's menu, named by the call that spends a use on it. */
export interface HeldPoolOption {
  /** The id `use_pool_option.option` takes — SRD's `turn-undead`. */
  readonly option: string;
  /** What the log calls it: SRD's "Turn Undead". */
  readonly name: string;
  readonly action: 'action' | 'bonus-action';
  /**
   * Damage a later feature adds to whoever fails this form's save — SRD Sear
   * Undead on Turn Undead.
   *
   * Reported because it is a fact about what the use *does*, and a menu line
   * that named only the form would tell a level 5 Cleric exactly what a level
   * 3 one is told. Absent for every form nobody amended.
   */
  readonly damagesFailures?: { readonly dice: string; readonly damageType: string };
}

/**
 * One thing a landed blow can buy, named by the swing that buys it.
 *
 * {@link HeldPoolOption} without the price in the action economy, and the
 * absence is the difference between the two: a pool option is a purchase
 * somebody makes *with* an Action or a Bonus Action, and a rider is a purchase
 * made with a hit.
 *
 * **What it carries instead is the qualification**, which is the one thing
 * about a rider a caller cannot work out from anything else it is shown. The
 * engine refuses a swing the feature's own sentence does not cover —
 * `weapon_not_covered`, before the attack is rolled — and SRD Stunning
 * Strike's sentence is "with a Monk weapon or an Unarmed Strike": two clauses,
 * because an Unarmed Strike is in no set of weapons. A caller handed the
 * option id and not the clause would elect it with a longsword and be refused
 * by a rule it was never told.
 *
 * **It is still the record and not a verdict.** Which weapon is in hand is not
 * a fact about the character, so nothing here says whether *this* swing
 * qualifies: that is the command's answer, asked at the moment of the swing.
 * The selectors are the sheet's own, passed through rather than rephrased,
 * because a second phrasing of a rule is a second thing to keep in step.
 */
export interface HeldHitOption {
  /** The id `attack.onHit.option` takes — SRD's `stun`. */
  readonly option: string;
  /** What the log calls it: SRD's "Stunning Strike". */
  readonly name: string;
  /** SRD: "Once per turn when you hit a creature". */
  readonly oncePerTurn: boolean;
  /** The weapons the sentence covers. Absent where it asks for none. */
  readonly weapons?: readonly WeaponSelector[];
  /** Whether an Unarmed Strike counts, which no set of weapons can say. */
  readonly unarmedStrike?: boolean;
}

/**
 * One thing a use buys in the turn's own budget, named by the call that buys
 * it.
 *
 * {@link HeldPoolOption} with the price kept and the target dropped, which is
 * the difference between the two: a pool option is aimed at somebody and this
 * is aimed at the turn. SRD Action Surge and SRD Flurry of Blows are the two
 * the book writes, and they disagree on every field — one costs nothing to
 * say and may be said once a turn, the other costs a Bonus Action and may be
 * said as often as the points last.
 *
 * **What it adds is reported, and it is not a number the caller may send.**
 * The engine writes the budget from the sheet's own record; these two fields
 * are the *description* a caller needs to choose between purchases, in the
 * same way `HeldHitOption.weapons` reports the clause that qualifies a swing.
 */
export interface HeldBudgetPurchase {
  /** The id `use_budget_purchase.purchase` takes — SRD's `flurry-of-blows`. */
  readonly purchase: string;
  /** What the log calls it: SRD's "Action Surge". */
  readonly name: string;
  /** SRD Action Surge costs nothing to invoke, which is `none`. */
  readonly action: 'none' | 'action' | 'bonus-action';
  /** SRD Action Surge at Fighter 17: "only once on a turn". */
  readonly oncePerTurn: boolean;
  /** SRD: "one additional action, except the Magic action". */
  readonly extraAction?: { readonly except?: readonly string[] };
  /** SRD Flurry of Blows: "two Unarmed Strikes". */
  readonly extraAttacks?: { readonly count: number; readonly unarmedOnly: boolean };
}

/**
 * One bargain a feature offers, named by the call that strikes it.
 *
 * {@link HeldPoolOption}'s shape for a feature whose menu is a list of prices
 * rather than a list of effects: `trade_resource` is asked for the feature
 * *and* which of its trades, so a caller shown the feature and not the list
 * has been told half of what it needs to type the call. SRD Wild Resurgence
 * prints two in one sentence, in opposite directions, with different limits.
 *
 * **Both ends are named as pool keys and neither carries a number that is
 * left of them.** What is left of a pool is on `pools`, once, under the same
 * key — and a second copy here is a second answer to drift from. What this
 * adds is the three things a caller cannot work out from a pool line: which
 * two pools the trade runs between, which of them this call has to *choose*,
 * and what limits how often it may be struck.
 *
 * **It is the record and not a verdict**, like every other line in this file.
 * Whether the trade may be struck right now — whether the pool it would fill
 * has anything expended in it, whether the clause it prints holds, whether
 * the day's one use is gone — is `tradeResource`'s answer, asked at the
 * moment of the trade.
 */
export interface HeldTrade {
  /** The id `trade_resource.trade` takes — SRD's `slot-for-inspiration`. */
  readonly trade: string;
  /** What the log calls it: SRD's "Wild Resurgence (a use for a slot)". */
  readonly name: string;
  /** SRD's "(no action required)" is `none`. */
  readonly action: 'none' | 'action' | 'bonus-action';
  /**
   * What it costs, by pool key — **null where the caller chooses**.
   *
   * SRD writes "expend a spell slot" and leaves the level to the caster, so
   * there is no key until they say which. {@link slotLevelRequired} is that
   * same fact stated as the thing a caller acts on, because a null in a field
   * is a thing to reason about and a flag beside it is not.
   */
  readonly spends: { readonly pool: string | null; readonly uses: number | null };
  /** Whether `trade_resource.slotLevel` has to be sent, which nothing else says. */
  readonly slotLevelRequired: boolean;
  /**
   * What it buys, by pool key — **null where the caller chooses**, exactly as
   * {@link spends} is; and how much, **null where that is not a number until
   * they have chosen**.
   *
   * SRD Font of Magic creates a slot at a level the Sorcerer picks and SRD
   * Arcane Recovery recovers slots the Wizard names, so which slot is bought
   * has no key until they say. {@link gainedSlotLevelsRequired} is the same
   * fact as the thing a caller acts on.
   *
   * And `uses` is null for the same class of reason at the other end: SRD
   * gives "a number of Sorcery Points **equal to the slot's level**", which is
   * two for a level 2 slot and five for a level 5 one. Reporting a one there
   * would be this layer inventing an answer, and a model reading it would
   * price the exchange wrong in both directions.
   */
  readonly gains: { readonly pool: string | null; readonly uses: number | null };
  /** Whether `trade_resource.gainedSlotLevels` has to be sent. */
  readonly gainedSlotLevelsRequired: boolean;
  /**
   * SRD Font of Magic's Created Spell Slots table: what a slot of each level
   * costs, index 0 a level 1 slot, in whatever {@link spends} names. Its
   * length is the highest slot this trade creates, and it is what makes
   * {@link spends}`.uses` null — the price is the rung the caller picks.
   */
  readonly priceBySlotLevel?: readonly number[];
  /** SRD Arcane Recovery: the combined level of the slots that may be named. */
  readonly combinedSlotLevels?: number;
  /** SRD Arcane Recovery: "none of them can be level 6+." */
  readonly maxSlotLevel?: number;
  /** SRD Arcane Recovery: "When you finish a Short Rest." */
  readonly moment?: 'short-rest';
  /** The clause that limits it, **including the one that says there is none**. */
  readonly limit: 'once-per-turn' | 'once-per-long-rest' | 'unlimited';
  /**
   * The pool of one the trade declares, where it declares one.
   *
   * Read two ways and `limit` says which: the day's single use where the
   * limit is `once-per-long-rest`, and the feature's own use that an
   * `unlimited` trade exists to buy back. What is left of it is on `pools`.
   */
  readonly limitPool?: string;
  /** SRD Wild Resurgence: "if you have no uses of Wild Shape left". */
  readonly onlyIfEmpty?: string;
}

export interface HeldFeature {
  readonly feature: string;
  readonly name: string;
  readonly kind: HeldFeatureKind;
  /** The tool that spends it, or null where nothing on this surface does. */
  readonly spentBy: string | null;
  /**
   * The other tools that spend it, for a feature that offers more than one
   * menu.
   *
   * A feature is listed once and the first claim on its id decides what it
   * *is* — see {@link holdingsOf} — so a feature holding both a pool's menu
   * and a hit's would otherwise report the pool's door and hand over the
   * other menu with nothing to call. It is absent rather than empty wherever
   * one door is the whole answer, which today is every feature in the book:
   * the SRD prints `on-hit` exactly once and the catalogue cannot yet put two
   * grants on one feature at all. See `two-menus.test.ts`.
   */
  readonly alsoSpentBy?: readonly string[];
  /** What using it costs in the action economy, where it costs anything. */
  readonly action: 'action' | 'bonus-action' | 'none' | null;
  /** The pool it draws on, and what is left of that pool. */
  readonly pool: string | null;
  readonly left: number | null;
  /** Running right now. Only a feature that is switched on is ever true. */
  readonly active: boolean;
  /** An activation's deadline, and the two ways out nobody commands. */
  readonly lasts?: string;
  readonly endsOn?: readonly string[];
  readonly forbidsCasting?: boolean;
  /**
   * The longest the feature's own sentence says it may be maintained, in
   * seconds — SRD Rage's "up to 10 minutes".
   *
   * **Reported because the engine keeps it and a caller should see it coming.**
   * It is pinned onto the sheet at creation, pinned again onto the timer when
   * the feature is activated, and `extendFeature` refuses `cap_reached` past
   * it with nothing spent. This comment used to say no engine command read it,
   * which was true until the ceiling was made load-bearing. All three bounds
   * beside each other are the engine's now: `lasts` is a real deadline,
   * `endsOn` really ends the feature, and this one really refuses.
   */
  readonly capSeconds?: number;
  /**
   * The forms a shape-shifting feature has learned — the ids `assume_shape`
   * takes — and the one being worn, where one is.
   *
   * Reported because a caller cannot name what it cannot see: the list is the
   * character's own answer at creation, and the engine refuses a form that is
   * not on it. `form` is null in the character's own shape.
   */
  readonly forms?: readonly string[];
  readonly form?: string | null;
  /** The ceiling a form may print and whether a flier may be taken, at this level. */
  readonly maxChallengeRating?: number;
  readonly flying?: boolean;
  /**
   * What a use of this feature's pool buys, for a pool with a menu.
   *
   * SRD Channel Divinity is one feature, one pool and several named purchases
   * at one use apiece, and `use_pool_option` is asked for the feature *and*
   * the option — so a caller shown the feature and not the menu has been told
   * half of what it needs to type the call. Each carries its own price in the
   * action economy, because the SRD writes one per option rather than one per
   * feature.
   */
  readonly options?: readonly HeldPoolOption[];
  /**
   * What a landed blow buys, for a feature a swing elects.
   *
   * `options` one trigger along, and kept apart from it because the call is a
   * different one: these are elected through `attack.onHit` and never through
   * `use_pool_option`, and a caller dispatching on `spentBy` would otherwise
   * be handed a menu for the wrong door.
   */
  readonly onHit?: readonly HeldHitOption[];
  /**
   * The bargains a feature offers, for a feature whose use is a purchase.
   *
   * `options` and `onHit` a third trigger along, and kept apart from both for
   * the same reason they are kept apart from each other: the call is a
   * different one. These are struck through `trade_resource`, and a caller
   * dispatching on `spentBy` would otherwise be handed a menu for a door that
   * does not take it.
   */
  readonly trades?: readonly HeldTrade[];
  /**
   * What a use buys in the turn's budget, for a pool that sells room in it.
   *
   * The fourth menu, on the same terms as the other three: `use_budget_purchase`
   * is asked for the feature *and* the purchase, because SRD's Monk's Focus
   * sells more than Flurry of Blows and a caller shown the feature alone has
   * been told half of what it needs to type the call.
   */
  readonly buys?: readonly HeldBudgetPurchase[];
  /** A healing touch's conditions, and what each one costs out of the pool. */
  readonly lifts?: readonly string[];
  readonly costPerCondition?: number;
  /** A recovery's other pool, and the moment its own sentence names. */
  readonly restores?: string;
  readonly moment?: string;
  /** A Reaction's window, and whether the SRD spends a Reaction on it. */
  readonly window?: string;
  readonly costsReaction?: boolean;
  /** A conferral's reach, and how long what it gives away lasts. */
  readonly rangeFeet?: number;
  readonly lastsSeconds?: number;
}

/**
 * A Reaction somebody else put in this creature's hands.
 *
 * Reported **beside** the features rather than among them, and that is not
 * tidiness. A granted Reaction carries the *giver's* feature id — the die an
 * ally holds is `bard:bardic-inspiration`, because that is whose it was — so a
 * list keyed by feature id would have two entries under one key the day a Bard
 * is inspired by another Bard, and the first claim on an id wins. What a
 * character *is* and what has been done to it are two questions, and this is
 * the second.
 *
 * It exists because a caller that cannot see a die it was given cannot spend
 * one. `options` reports the offer at the instant a window opens; this reports
 * the holding, which is the hour in between.
 */
export interface HeldGrantedReaction {
  /** The giver's feature id, which is also what `take_test_reaction` takes. */
  readonly feature: string;
  readonly name: string;
  /** Whose feature it was. Not the holder. */
  readonly from: string;
  /** The moment it answers: a damage roll, a D20 Test, damage already taken. */
  readonly window: FeatureReactionWindow;
  /** The tool that takes it when that moment comes. */
  readonly takenBy: string;
  /** Whether taking it spends the holder's Reaction. Often it does not. */
  readonly costsReaction: boolean;
}

/** One class's half of what a character can cast, on that class's terms. */
export interface HeldCastingClass {
  readonly classId: string;
  /** SRD: "you use the spellcasting ability of that class". */
  readonly ability: string;
  /** Which pool this class's own slots live in — `spellSlots` or `pactSlots`. */
  readonly slotKind: string;
  readonly cantrips: readonly string[];
  readonly prepared: readonly string[];
}

/**
 * A spell a feat or a feature granted, and how it is paid for.
 *
 * `source` is what `cast_spell.source` wants when two routes would serve, and
 * `freeCastPool` with what is left of it is what `cast_spell.payment` chooses
 * between: SRD Magic Initiate's "once without a spell slot" is a pool of one,
 * and spending it instead of a slot is a decision the engine refuses to make.
 */
export interface HeldGrantedSpell {
  readonly spellId: string;
  readonly source: string;
  readonly freeCastPool: string | null;
  /** Free castings left, or null where the grant has no pool of its own. */
  readonly left: number | null;
  readonly slotCasting: boolean;
  /**
   * The grant casts it for nothing, without limit — a stat block's "At Will".
   *
   * Reported because without it the three fields above describe a spell that
   * cannot be cast at all: no pool, nothing left, and no slot. A caller shown
   * that would never try, and the cultist's Thaumaturgy is precisely a spell
   * it may cast every round of the fight.
   */
  readonly atWill: boolean;
}

/**
 * One line of an inventory, as the engine keeps it.
 *
 * `instance` is present exactly where the engine has told this copy apart from
 * the others — a wand whose charges are its own — and it is reported because
 * every inventory call takes it: a caller holding two wands and shown one
 * line cannot say which one the thief took.
 *
 * `conjured` is the casting that put the line in this creature's hand, and it
 * is reported for the same reason: ten Goodberries and ten berries out of a
 * pack look identical, and only one of the two disappears when a spell ends,
 * occupies a hand, or answers `let_go_of_conjured`. A surface that showed a
 * caller a tool it could not tell when to call would be handing it a guess.
 */
export interface HeldItem {
  readonly id: string;
  readonly quantity: number;
  readonly instance?: string;
  /** The casting holding this line, where a spell conjured it. */
  readonly conjured?: string;
}

/** One thing worn or wielded, and which copy of it where that is told apart. */
export interface HeldEquipped {
  readonly id: string;
  readonly instance?: string;
}

export interface HeldBudget {
  readonly action: boolean;
  readonly bonusAction: boolean;
  readonly reaction: boolean;
  readonly movementFeet: number;
  /**
   * Actions something added to this turn beyond the one it came with — SRD
   * Action Surge.
   *
   * **Reported because a purchase a caller cannot see is a purchase it will
   * not spend.** The engine keeps these in a list of their own and spends the
   * turn's own action first, so a Fighter that has surged still reads
   * `action: false` and would conclude it had bought nothing. Each carries
   * the narrowing its own sentence prints, because two of them need not
   * narrow alike and "except the Magic action" is a rule a caller acts on.
   *
   * Empty on every turn nobody has added to, which is nearly all of them.
   */
  readonly extraActions: readonly { readonly source: string; readonly except?: readonly string[] }[];
  /**
   * Attacks bought outside an Attack action — SRD Flurry of Blows' two
   * Unarmed Strikes — or null where none were.
   *
   * `extraActions`' other half and reported for its reason: the strikes are
   * made through `attack` like any other, and a caller that cannot see how
   * many it has left will stop after one or be refused after three.
   */
  readonly grantedAttacks: {
    readonly remaining: number;
    readonly unarmedOnly: boolean;
  } | null;
}

export interface Holdings {
  readonly who: string;
  readonly name: string;
  readonly level: number;
  readonly hp: number;
  readonly hpMax: number;
  readonly temporaryHp: number;
  readonly dead: boolean;
  readonly armorClass: number;
  readonly speed: number;
  readonly conditions: readonly string[];
  readonly concentratingOn: string | null;
  /**
   * What this character owns, wears, is attuned to, and can pay with.
   *
   * **Three separate facts, because the engine keeps them as three.** Owning
   * is not wearing — Armour Class reads the equipped set, so chain mail in a
   * backpack protects nobody — and wearing is not attunement, which is the
   * sentence that switches a magic item's benefit on. A caller shown one list
   * would be guessing at the other two, and each of the six inventory calls
   * refuses by naming something on one of them: `not_owned`, `not_equipped`,
   * `not_attuned`, `cannot_afford`.
   *
   * Coins are in **copper**, which is the unit the engine prices in; the
   * catalogue's gold pieces are converted before anything is compared.
   */
  readonly coins: number;
  readonly carrying: readonly HeldItem[];
  /**
   * Worn or wielded right now — and **which copy**, where the engine tells the
   * copies apart.
   *
   * The same argument `HeldItem` makes about a pack, one hand further in: a
   * caller holding two labelled wands and shown only a kind cannot say which
   * one is in its hand, and `unequip_item`, `attune_item` and `use_item` all
   * take a copy's id. `quantity` is absent because a pair of hands holds one
   * of a kind: `equipItem` refuses the second.
   */
  readonly equipped: readonly HeldEquipped[];
  /**
   * Attuned to, by catalogue id.
   *
   * By **kind** and not by copy, which is the engine's own answer rather than
   * a simplification here: attunement is a yes or no per kind of item, so
   * `attuneItem` reads a copy's id as the kind it is a copy of. SRD allows
   * three at a time.
   */
  readonly attuned: readonly string[];
  /**
   * What this character can cast and by which route.
   *
   * Reported because a caster that cannot see its own list types spell ids
   * from memory — and because the two refusals that ask *which* route casts a
   * spell, `class_required` and `payment_required`, name fields whose answers
   * are on no other read.
   */
  readonly spellcasting: {
    readonly classes: readonly HeldCastingClass[];
    readonly granted: readonly HeldGrantedSpell[];
  };
  /** Null outside a fight, where there is no action economy to report. */
  readonly budget: HeldBudget | null;
  readonly spellSlots: readonly HeldSlots[];
  /** Pact Magic, kept apart because it is a different resource at the same level. */
  readonly pactSlots: readonly HeldSlots[];
  /** Every other limited-use pool, slots excluded: they are the two lists above. */
  readonly pools: readonly HeldPool[];
  readonly features: readonly HeldFeature[];
  /** Reactions somebody else hung on this creature, and whose they were. */
  readonly grantedReactions: readonly HeldGrantedReaction[];
}

/** One pool as a slot line, or null where the creature has no such pool. */
const slotAt = (
  state: GameState,
  who: string,
  key: string,
  level: number,
): HeldSlots | null => {
  const pool = state.creatures[who]?.resources.pools[key];
  if (pool === undefined) return null;
  return { level, max: pool.max, spent: pool.spent, left: pool.max - pool.spent };
};

/**
 * Two claims on one feature id, as one line.
 *
 * The first claim stands — its kind, its pool, its price and the tool that
 * spends it — and what the second brings is the **menu** the first has not
 * got, with the door that spends that menu named beside it. Anything else a
 * second claim carries is dropped exactly as it always was: a feature's kind
 * is decided once, and two kinds under one id would be a caller dispatching
 * on a coin toss.
 *
 * **It is a no-op unless there is a menu to carry**, which is why Rage still
 * reports as an activation with nothing added when its standing effects claim
 * the id again, and why no character the SRD can build gains a field here.
 */
function alsoHolding(first: HeldFeature, second: HeldFeature): HeldFeature {
  const options = first.options ?? second.options;
  const onHit = first.onHit ?? second.onHit;
  // A third menu, carried on the same terms as the other two: a feature whose
  // uses are bought rather than spent states which bargain on the call, so a
  // trade dropped by a merge is a trade nothing could name.
  const trades = first.trades ?? second.trades;
  // And a fourth. SRD's Monk's Focus is the feature that makes this live: it
  // is one pool selling room in the turn's budget, and the day a subclass adds
  // an effect list to the same pool the two claims meet under one id.
  const buys = first.buys ?? second.buys;
  if (
    options === first.options &&
    onHit === first.onHit &&
    trades === first.trades &&
    buys === first.buys
  ) {
    return first;
  }

  const doors = [...(first.alsoSpentBy ?? [])];
  if (second.spentBy !== null && second.spentBy !== first.spentBy && !doors.includes(second.spentBy)) {
    doors.push(second.spentBy);
  }

  return {
    ...first,
    ...(options === undefined ? {} : { options }),
    ...(onHit === undefined ? {} : { onHit }),
    ...(trades === undefined ? {} : { trades }),
    ...(buys === undefined ? {} : { buys }),
    ...(doors.length === 0 ? {} : { alsoSpentBy: doors }),
  };
}

const leftIn = (state: GameState, who: string, key: string | null): number | null => {
  if (key === null) return null;
  const pool = state.creatures[who]?.resources.pools[key];
  return pool === undefined ? null : pool.max - pool.spent;
};

/**
 * Everything one character holds.
 *
 * Null for a creature the engine has never been told about, which the tool
 * turns into the request that would settle it — a thin record is homework
 * rather than a verdict.
 */
export function holdingsOf(state: GameState, id: CharacterId): Holdings | null {
  const who = String(id);
  const creature = state.creatures[who];
  if (creature === undefined) return null;

  const sheet = creature.sheet;
  const budget = state.combat?.budgets[who];
  const active = creature.activeFeatures;

  const slotKeys = new Set<string>();
  const spellSlots: HeldSlots[] = [];
  const pactSlots: HeldSlots[] = [];
  for (const level of SLOT_LEVELS) {
    const spell = spellSlotKey(level);
    const pact = pactSlotKey(level);
    slotKeys.add(spell);
    slotKeys.add(pact);
    const asSpell = slotAt(state, who, spell, level);
    if (asSpell !== null) spellSlots.push(asSpell);
    const asPact = slotAt(state, who, pact, level);
    if (asPact !== null) pactSlots.push(asPact);
  }

  const pools: HeldPool[] = Object.values(creature.resources.pools)
    .filter((pool) => !slotKeys.has(pool.key))
    .map((pool) => ({
      key: pool.key,
      label: pool.label,
      max: pool.max,
      spent: pool.spent,
      left: pool.max - pool.spent,
      recovers: pool.recovers,
      regainsOnShortRest: pool.regainsOnShortRest ?? null,
    }));

  /**
   * One line per feature, and the **first** claim on an id decides what it is.
   *
   * A feature is usually one thing, but Rage is two: it is an activation, and
   * while it runs it is also three standing effects carrying its own id. The
   * order below is therefore spendable kinds first and the standing effects
   * last, so Rage reads as the thing a caller can switch on rather than as a
   * damage resistance it can do nothing with. A feature that grants several
   * standing effects likewise reports once rather than once per grant.
   *
   * **What a later claim still brings with it is its menu**, which is the one
   * thing the rule used to swallow: the `hit-rider` loop runs after
   * `pool-option`, so a feature holding both would have been reported as the
   * pool with its riders silently dropped — and a menu a caller is never shown
   * is a menu it cannot elect from. So a second claim merges rather than
   * disappearing, carrying whichever of the two menus the first has not got
   * and naming the door that spends it. Nothing else of the second claim is
   * taken: the kind, the pool, the price and `spentBy` are the first's, which
   * is the rule above unchanged.
   */
  const features: HeldFeature[] = [];
  const add = (entry: HeldFeature): void => {
    const at = features.findIndex((one) => one.feature === entry.feature);
    if (at === -1) features.push(entry);
    else features[at] = alsoHolding(features[at]!, entry);
  };

  for (const one of sheet.activated ?? []) {
    add({
      feature: one.feature,
      name: one.name,
      kind: 'activated',
      spentBy: SPENT_BY.activated,
      action: one.action,
      pool: one.pool,
      left: leftIn(state, who, one.pool),
      active: active.includes(one.feature),
      lasts: one.lasts,
      ...(one.endsOn === undefined ? {} : { endsOn: one.endsOn }),
      ...(one.forbidsCasting === undefined ? {} : { forbidsCasting: one.forbidsCasting }),
      ...(one.capSeconds === undefined ? {} : { capSeconds: one.capSeconds }),
    });
  }

  // A feature that lays a stat block over the sheet — SRD Wild Shape. Read off
  // the sheet as it stands, which in a form is the merged one and still
  // carries the class features, so the line is there to leave by.
  for (const one of sheet.shapeShifts ?? []) {
    const worn = creature.shape !== null && creature.shape.feature === one.feature;
    add({
      feature: one.feature,
      name: one.name,
      kind: 'shape',
      spentBy: SPENT_BY.shape,
      action: one.action,
      pool: one.pool,
      left: leftIn(state, who, one.pool),
      active: worn,
      lasts: `${one.hours} hours`,
      forbidsCasting: one.forbidsCasting === true,
      forms: one.knownForms,
      form: worn ? creature.shape!.form : null,
      maxChallengeRating: one.maxChallengeRating,
      flying: one.flying,
    });
  }

  for (const one of sheet.selfHeals ?? []) {
    add({
      feature: one.feature,
      name: one.name,
      kind: 'self-heal',
      spentBy: SPENT_BY['self-heal'],
      action: one.action,
      pool: one.pool,
      left: leftIn(state, who, one.pool),
      active: false,
    });
  }

  for (const one of sheet.healingTouch ?? []) {
    add({
      feature: one.feature,
      name: one.name,
      kind: 'healing-touch',
      spentBy: SPENT_BY['healing-touch'],
      action: one.action,
      pool: one.pool,
      left: leftIn(state, who, one.pool),
      active: false,
      lifts: one.lifts,
      costPerCondition: one.costPerCondition,
    });
  }

  for (const one of sheet.recoveries ?? []) {
    add({
      feature: one.feature,
      name: one.name,
      kind: 'recovery',
      spentBy: SPENT_BY.recovery,
      action: null,
      pool: one.pool,
      left: leftIn(state, who, one.pool),
      active: false,
      restores: one.restores,
      moment: one.moment,
    });
  }

  /**
   * A feature that pays for one resource with another, reported once per
   * **feature** with its bargains — the shape a pool's menu takes, one kind of
   * purchase along.
   *
   * SRD Wild Resurgence is one feature printing two trades in opposite
   * directions with different limits, so two lines would tell a Druid it held
   * two features; and `trade_resource` is asked for the feature *and* which of
   * its trades, which is the same argument `use_pool_option` makes about a
   * menu. The trades ride on the single line.
   *
   * **This is `spentBy`'s own gap, and it was the widest one left.** The
   * engine has run both ends of a trade since `tradeResource` landed and this
   * file named no door for either, so a Bard was shown an empty Bardic
   * Inspiration pool and nothing that refills it, and a Druid was shown Wild
   * Shape and Wild Resurgence's pool of one with no way to spend either.
   *
   * **The price is the trade's rather than the feature's**, for the reason a
   * pool option's is: the SRD prints one per clause. The feature reports one
   * only where every trade agrees, which today is both of them at `none`.
   *
   * **The line's name is the first trade's**, which is the feature's own
   * wherever the grant names no trade — the SRD's commoner case, and Font of
   * Inspiration's. A feature printing two differently-named trades has no
   * feature name to report: `TradeFeature` carries the trade's name and not
   * the feature's, unlike the `featureName` a pool option and a hit rider each
   * carry, and inventing one here would be this layer deriving a fact the
   * sheet does not hold.
   */
  const bargains = new Map<string, HeldTrade[]>();
  for (const one of sheet.trades ?? []) {
    // The price, where the SRD prints a table rather than a number: what is
    // spent is a function of the rung bought, so there is no flat `uses` to
    // report and the table is reported instead.
    const priced = typeof one.spends.uses === 'object' ? one.spends.uses.byBoughtSlotLevel : null;
    const entry: HeldTrade = {
      trade: one.trade,
      name: one.name,
      action: one.action,
      spends: {
        pool: one.spends.key,
        // `the-slot-level` is refused on the end that is spent — `checkContent`
        // names it `no_slot_level_to_read` — and a price table is a row per
        // rung rather than one number, which is what {@link priceBySlotLevel}
        // carries.
        uses: typeof one.spends.uses === 'number' ? one.spends.uses : null,
      },
      // The same fact as `spends.pool === null`, said as the thing a caller
      // does about it. SRD leaves "a spell slot" to the caster and the engine
      // refuses `slot_level_required` rather than choosing between candidates.
      slotLevelRequired: one.spends.key === null,
      gains: {
        pool: one.gains.key,
        // "A number of Sorcery Points equal to the slot's level" is not a
        // number until the caller has named the slot, so it is null rather
        // than a figure this layer made up.
        uses: typeof one.gains.uses === 'number' ? one.gains.uses : null,
      },
      gainedSlotLevelsRequired: one.gains.key === null,
      ...(priced === null ? {} : { priceBySlotLevel: priced }),
      ...(one.combinedLevel === undefined ? {} : { combinedSlotLevels: one.combinedLevel }),
      ...(one.maxSlotLevel === undefined ? {} : { maxSlotLevel: one.maxSlotLevel }),
      ...(one.moment === undefined ? {} : { moment: one.moment }),
      limit: one.limit,
      ...(one.pool === undefined ? {} : { limitPool: one.pool }),
      ...(one.onlyIfEmpty === undefined ? {} : { onlyIfEmpty: one.onlyIfEmpty }),
    };
    const found = bargains.get(one.feature);
    if (found === undefined) bargains.set(one.feature, [entry]);
    else found.push(entry);
  }
  for (const [feature, trades] of bargains) {
    add({
      feature,
      name: trades[0]!.name,
      kind: 'trade',
      spentBy: SPENT_BY.trade,
      action: trades.every((one) => one.action === trades[0]!.action) ? trades[0]!.action : null,
      // Two pools and one field: a trade runs *between* them, so neither end
      // is "the pool it draws on" and the menu names both. What is left of
      // each is on `pools`, under the key each entry gives.
      pool: null,
      left: null,
      active: false,
      trades,
    });
  }

  /**
   * A pool with a menu, reported once per **feature** and not once per option.
   *
   * SRD Channel Divinity is one feature whose uses buy any of three things, so
   * three lines would report three pools of two uses where there is one pool of
   * two. The options ride on the single line instead, which is also the shape
   * the call takes: `use_pool_option` is asked for a feature and an option.
   *
   * **This is the gap `spentBy` exists to prevent, and it was open.** A Cleric
   * was told it held Channel Divinity — the pool is on `pools` — and no feature
   * line named a tool for it, because this file enumerated every other host of
   * an effect list and not this one. The engine has executed Turn Undead and
   * Divine Spark since the week a pool use became the third host.
   */
  const menus = new Map<string, HeldPoolOption[]>();
  for (const one of sheet.poolOptions ?? []) {
    const found = menus.get(one.feature);
    const entry = {
      option: one.option,
      name: one.name,
      action: one.action,
      ...(one.damagesFailures === undefined
        ? {}
        : { damagesFailures: one.damagesFailures }),
    };
    if (found === undefined) menus.set(one.feature, [entry]);
    else found.push(entry);
  }
  for (const one of sheet.poolOptions ?? []) {
    const options = menus.get(one.feature) ?? [];
    add({
      feature: one.feature,
      name: one.featureName,
      kind: 'pool-option',
      spentBy: SPENT_BY['pool-option'],
      // The price is the option's rather than the feature's — the SRD prints a
      // casting time per entry on the menu — so the feature reports one only
      // where every option agrees on it, and the options carry their own.
      action: options.every((entry) => entry.action === options[0]!.action)
        ? options[0]!.action
        : null,
      pool: one.pool,
      left: leftIn(state, who, one.pool),
      active: false,
      options,
    });
  }

  /**
   * A pool whose uses buy room in the turn's own budget — the same shape a
   * pool with a menu takes, one kind of purchase along.
   *
   * SRD Action Surge and SRD Flurry of Blows, which are one sentence apart in
   * what they are and disagree on every field: one costs nothing to invoke
   * and may be invoked once a turn, the other costs a Bonus Action and may be
   * invoked while the points last. So the price is the **purchase's** and the
   * feature reports one only where every purchase agrees, which is the rule a
   * pool option's menu already keeps for the same reason.
   *
   * **This was the last pool the surface held and could not spend.** The rule
   * that shut it — "a pool a caller can spend for no effect is worse than one
   * it cannot spend, because the use would be gone" — stopped applying the
   * day `useBudgetPurchase` landed and an extra action found somewhere to
   * live; the engine executed both purchases for a week and no tool called
   * the command. A feature a caller is told it holds and can find no door for
   * is half a door, and this file is where the other half is named.
   */
  const purchases = new Map<string, HeldBudgetPurchase[]>();
  for (const one of sheet.budgetPurchases ?? []) {
    const entry: HeldBudgetPurchase = {
      purchase: one.purchase,
      name: one.name,
      action: one.action,
      oncePerTurn: one.oncePerTurn === true,
      ...(one.extraAction === undefined ? {} : { extraAction: one.extraAction }),
      ...(one.extraAttacks === undefined ? {} : { extraAttacks: one.extraAttacks }),
    };
    const found = purchases.get(one.feature);
    if (found === undefined) purchases.set(one.feature, [entry]);
    else found.push(entry);
  }
  for (const [feature, buys] of purchases) {
    const mine = (sheet.budgetPurchases ?? []).filter((one) => one.feature === feature);
    const first = mine[0]!;
    // **And the pool is the purchases' too, for the price's reason.** A
    // purchase names the pool a use comes out of and the sheet's own comment
    // says it "may be another feature's", so two purchases under one feature
    // need not draw on one pool — and a line reporting the first one's `left`
    // for both would be a number that is wrong about the other. Where they
    // disagree there is no single pool to name, which is the answer a trade
    // already gives to the same question; what is left of each is on `pools`.
    const shared = mine.every((one) => one.pool === first.pool) ? first.pool : null;
    add({
      feature,
      name: first.featureName,
      kind: 'budget-purchase',
      spentBy: SPENT_BY['budget-purchase'],
      action: buys.every((one) => one.action === buys[0]!.action) ? buys[0]!.action : null,
      pool: shared,
      left: leftIn(state, who, shared),
      active: false,
      buys,
    });
  }

  /**
   * A feature a *hit* buys, reported once per feature with its menu — the same
   * shape a pool with a menu takes, one trigger along.
   *
   * **The door is `attack`, which is why this line has to exist.** Every other
   * spendable feature on this list is spent by a tool named after it; a rider
   * is elected on a swing through `attack.onHit`, so a caller reading the list
   * for something to call would find no door for Stunning Strike and conclude
   * the engine had none — and the engine has executed it since a hit became a
   * host of an effect list. SRD writes all of them "you can", so a swing that
   * names nothing buys nothing and the election is the caller's.
   *
   * The action is `null` rather than `'none'`: a rider costs no action because
   * it is not bought with one, which is a recovery's answer to the same field.
   *
   * **A feature is listed once and the first claim on its id decides what it
   * is**, which is this list's rule and not this loop's — and the menu is
   * carried across rather than lost, which is {@link alsoHolding}. A feature
   * granting both a pool menu and a rider reports as the pool, with the
   * riders beside it and `alsoSpentBy` naming this door.
   *
   * **No catalogue can write one today**, and that is a fact about the
   * vocabulary rather than about the book: `FeatureDefinition.grants` is
   * singular and `checkContent` refuses two definitions under one id, so the
   * two menus cannot meet. `two-menus.test.ts` holds both refusals and asks
   * the reader the question anyway, because the seam is one grant's worth of
   * vocabulary away and a report that quietly loses half a feature is not
   * something to discover from a session.
   */
  const riders = new Map<string, HeldHitOption[]>();
  for (const one of sheet.hitOptions ?? []) {
    const entry = {
      option: one.option,
      name: one.name,
      oncePerTurn: one.oncePerTurn === true,
      ...(one.weapons === undefined ? {} : { weapons: one.weapons }),
      ...(one.unarmedStrike === undefined ? {} : { unarmedStrike: one.unarmedStrike }),
    };
    const found = riders.get(one.feature);
    if (found === undefined) riders.set(one.feature, [entry]);
    else found.push(entry);
  }
  for (const [feature, onHit] of riders) {
    const first = (sheet.hitOptions ?? []).find((one) => one.feature === feature)!;
    add({
      feature,
      name: first.featureName,
      kind: 'hit-rider',
      spentBy: SPENT_BY['hit-rider'],
      action: null,
      pool: first.pool,
      left: leftIn(state, who, first.pool),
      active: false,
      onHit,
    });
  }

  /**
   * A use spent on somebody else — the fourth reader of a Reaction on a sheet,
   * and the one this file did not have.
   *
   * `conferredReactions` is its own field on the sheet for the reason the
   * engine gives: a Reaction on it is never taken by this character and one on
   * `reactions` is never given away. It is listed **before** them because a
   * feature that is both — a pool whose uses buy a die *and* Reactions of the
   * holder's own, which is Bardic Inspiration exactly — reads as the thing a
   * caller can spend rather than as a Reaction it cannot ask for, which is the
   * order the whole list is in.
   */
  for (const one of sheet.conferredReactions ?? []) {
    add({
      feature: one.feature,
      name: one.name,
      kind: 'conferral',
      spentBy: SPENT_BY.conferral,
      action: one.action,
      pool: one.pool,
      left: leftIn(state, who, one.pool),
      active: false,
      rangeFeet: one.range,
      lastsSeconds: one.durationSeconds,
    });
  }

  for (const one of sheet.reactions ?? []) {
    add({
      feature: one.feature,
      name: one.name,
      kind: 'reaction',
      // The window's tool: a Reaction is taken through the call that answers
      // the window it sits in, once `options` has reported that window open.
      // The pool it spends — Indomitable's uses, a Human's Heroic Inspiration
      // — has that call for its door and no other, which is what a census of
      // pools with no door reads here.
      spentBy: TAKEN_BY[one.window],
      action: null,
      pool: one.pool,
      left: leftIn(state, who, one.pool),
      active: false,
      window: one.window,
      costsReaction: one.costsReaction,
    });
  }

  /**
   * The standing effects, split three ways by what the holder has to say to
   * get the benefit: name it on a casting, name it as a price, or nothing.
   *
   * **It used to be a split two ways**, and the question it asked was only
   * whether the casting that reaches an effect has to name it. Everything else
   * fell to `passive`, which was right while a standing grant was a bonus, a
   * mode or a sense — and wrong the day one of them became an `allows` action
   * rule, because SRD Cunning Action is elected on `take_action` in precisely
   * the way Elemental Affinity is elected on `cast_spell`.
   *
   * SRD writes an elective feature as "you can" — Elemental Affinity,
   * Empowered Evocation, Overchannel — and the engine adds nothing unless the
   * casting elects it. That is the whole of what `cast_spell.usingFeatures`
   * carries, and a caller that has not been told which features are electable
   * cannot fill it in.
   *
   * **This is the one place in this file that answers a question the engine
   * also answers, and the copy is not exact.** `electableCastingDamage` in
   * `standing.ts` is the engine's own answer and is deliberately disclosed
   * here rather than left to be discovered: it is not on `@ie/engine`'s
   * barrel, so this layer cannot call it, and putting it there is an engine
   * change that was out of scope for the task that wrote this. The copy reads
   * the sheet's own declarations where the engine reads `standingFor`, and
   * `standingFor` does two things more:
   *
   * - it folds in **an item's** grants, so an optional casting-damage grant on
   *   a magic item is electable and would not be listed here;
   * - it drops an effect whose `requires` are not met right now, so one with an
   *   unmet requirement would be listed here and then refused `no_such_feature`
   *   by the casting — a misleading refusal produced by this report.
   *
   * Neither is reachable in the SRD catalogue today: all three optional grants
   * are self-reach class features with no `requires`. Both are reachable by
   * *content alone*, with no engine change, which is what makes exporting
   * `electableCastingDamage` and calling it the fix rather than a tidy-up.
   */
  for (const effect of sheet.standing ?? []) {
    const elective = effect.grant.kind === 'casting-damage' && effect.grant.optional === true;
    // The third shape, and the one this split used to drop into `passive`: a
    // named action offered at a cheaper price, which is invoked through
    // `take_action.from` and is therefore a door rather than a benefit. Only
    // the widening rule counts — `forbids` and `permits-only` narrow what is
    // legal and offer the holder nothing to state.
    const priced = effect.grant.kind === 'action-rule' && effect.grant.rule.kind === 'allows';
    const kind = elective ? 'casting-election' : priced ? 'action-price' : 'passive';
    add({
      feature: effect.feature,
      name: effect.name,
      kind,
      spentBy: kind === 'passive' ? null : SPENT_BY[kind],
      action: null,
      pool: null,
      left: null,
      active: false,
    });
  }

  return {
    who: creature.id,
    name: creature.name,
    level: sheet.level,
    hp: creature.vitals.hp,
    hpMax: creature.vitals.hpMax,
    temporaryHp: creature.vitals.temporaryHp,
    dead: creature.vitals.dead,
    armorClass: armorClassOf(state, creature.id),
    speed: speedOf(state, creature.id),
    conditions: creature.conditions.conditions,
    concentratingOn: creature.concentration?.spell ?? null,
    coins: coinsOf(state, creature.id),
    carrying: carrying(state, creature.id).map((line) => ({
      id: line.id,
      quantity: line.quantity,
      ...(line.instance === undefined ? {} : { instance: line.instance }),
      ...(line.casting === undefined ? {} : { conjured: line.casting }),
    })),
    equipped: creature.equipped.map((worn) => ({
      id: worn.id,
      ...(worn.instance === undefined ? {} : { instance: worn.instance }),
    })),
    attuned: [...attunedItems(state, creature.id)],
    spellcasting: {
      classes: creature.spellcasting.classes.map((entry) => ({
        classId: entry.classId,
        ability: entry.ability,
        slotKind: entry.slotKind,
        cantrips: entry.cantrips,
        prepared: entry.prepared,
      })),
      granted: creature.spellcasting.granted.map((entry) => ({
        spellId: entry.spellId,
        source: entry.source,
        freeCastPool: entry.freeCastPool,
        left: leftIn(state, who, entry.freeCastPool),
        slotCasting: entry.slotCasting,
        atWill: entry.atWill === true,
      })),
    },
    budget:
      budget === undefined
        ? null
        : {
            action: budget.action,
            bonusAction: budget.bonusAction,
            reaction: budget.reaction,
            movementFeet: movementLeftFor(state, creature.id) ?? 0,
            // The engine's own list, passed through: the narrowing is the
            // grant's and rephrasing it here would be a second copy of a rule.
            extraActions: budget.extraActions.map((extra) => ({
              source: extra.source,
              ...(extra.except === undefined ? {} : { except: extra.except }),
            })),
            grantedAttacks:
              budget.grantedAttacks === null
                ? null
                : {
                    remaining: budget.grantedAttacks.remaining,
                    unarmedOnly: budget.grantedAttacks.unarmedOnly,
                  },
          },
    spellSlots,
    pactSlots,
    pools: [...pools].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
    features: [...features].sort((a, b) => (a.feature < b.feature ? -1 : a.feature > b.feature ? 1 : 0)),
    // In the order the fold keeps them, which is sorted by source: two readers
    // of the same state agree, and nothing here re-sorts what the engine has
    // already ordered.
    grantedReactions: creature.grantedReactions.map((held) => ({
      feature: held.reaction.feature,
      name: held.reaction.name,
      from: String(held.from),
      window: held.reaction.window,
      takenBy: TAKEN_BY[held.reaction.window],
      costsReaction: held.reaction.costsReaction,
    })),
  };
}
