import type { Ability } from '@ie/shared';
import type { SlotKind } from './resources.js';
import type { CastingNumbers, CastingTime } from './spells.js';
import type { StandingRequirement } from './standing.js';

/**
 * What a creature can actually cast, and by what route.
 *
 * Creation records *choices*; this is what those choices came to. A Wizard's
 * prepared list and cantrips are one route, and a feat's spells are quite
 * another: Magic Initiate brings its own spellcasting ability, its own free
 * daily casting, and a level 1 spell that is "always prepared" without
 * counting against the class's prepared list.
 *
 * Keeping them apart matters because the numbers differ. A Sage Wizard casting
 * Magic Initiate's spell with Intelligence gets the same DC by coincidence; a
 * Sage Fighter would not, and the engine should not have to care which.
 *
 * **A prepared spell belongs to a class, not to a creature.** SRD
 * Multiclassing: "Each spell you prepare is associated with one of your
 * classes, and you use the spellcasting ability of that class when you cast
 * the spell." A Ranger/Sorcerer's Cure Wounds is a *Ranger* spell cast off
 * Wisdom even though the same creature has a Charisma save DC for everything
 * it learned as a Sorcerer. One list and one ability per creature cannot say
 * that, which is why the list is per class.
 */

/** A spell a feature or feat grants, outside the class's own spellcasting. */
export interface GrantedSpell {
  readonly spellId: string;
  /** The feature that granted it, e.g. `sage:magic-initiate-wizard`. */
  readonly source: string;
  /** SRD Magic Initiate: the ability chosen when the feat was taken. */
  readonly ability: Ability;
  /**
   * A pool for the free casting, or null when the grant has none.
   *
   * SRD Magic Initiate: "You can cast it once without a spell slot, and you
   * regain the ability to cast it in that way when you finish a Long Rest."
   */
  readonly freeCastPool: string | null;
  /** SRD: "You can also cast the spell using any spell slots you have." */
  readonly slotCasting: boolean;
  /**
   * The grant pays **nothing** and runs out of nothing.
   *
   * A stat block's "**At Will:** _Etherealness_" is neither of the two prices
   * this shape already held: there is no slot (the creature has none and the
   * line names none) and no pool (there is no count to run out). Absent is
   * every grant written before this one, which is the reading `freeCastPool`
   * and `slotCasting` between them have always given — a free casting, a slot,
   * or both.
   *
   * A cantrip needs no flag: it already costs nothing on any route.
   */
  readonly atWill?: true;
  /**
   * Every die this casting would throw takes its **highest face**.
   *
   * SRD Fiendish Vigor: "When you cast the spell with this feature, you don't
   * roll the die for the Temporary Hit Points; you automatically get the
   * highest number on the die." A rule about a casting made through *this*
   * grant and not about the spell, which is why it rides here: the same
   * Warlock casting False Life off a slot rolls it.
   *
   * The reading is `maximisedHealing`'s — SRD Beacon of Hope's "regains the
   * maximum number of Hit Points possible" — so the die is still thrown, still
   * recorded, and still says what it showed, and nothing is added to the dice
   * layer. Its one SRD writer is a Temporary Hit Point roll and that is the
   * roll it reaches; `checkContent` refuses the flag on a grant whose spell
   * rolls none rather than letting a feature promise what no resolver honours.
   */
  readonly maximisedDice?: true;
  /**
   * The save DC a **printed** line states, in place of the one the ability
   * derives.
   *
   * `HitRider.saveDc` and `ItemCastsGrant.saveDc` exactly, on the third host
   * that has a number of its own. A printed number and a derived one are not
   * distinguishable after the fact — SRD Adult Bronze Dragon prints DC 17 over
   * abilities that derive 18 — so a stated number is carried and a line that
   * prints none is left to derive.
   */
  readonly saveDc?: number;
  /** "+4 to hit with spell attacks", the same way and for the same reason. */
  readonly attackBonus?: number;
  /**
   * What the line printed about **this** spell that nothing here applies.
   *
   * "(self only)", "(level 4 version)", "(lasts 24 hours; ends early if the
   * dryad casts the spell again)" — a rider on one casting of one spell, and
   * the grant has no field for any of them. Carried so that casting the spell
   * hands it to the table, exactly as a definition's own `unmodelled` is
   * handed over.
   */
  readonly handOver?: string;
  /**
   * SRD Wild Companion: "When you cast the spell in this way, the familiar is
   * Fey" — the one value a `choiceStated` spell leaves to its caster, fixed by
   * the feature the casting comes through. Another answer is refused
   * `choice_fixed`; none is supplied.
   */
  readonly fixesChoice?: string;
  /**
   * Stat blocks this route adds to the forms a summoning spell offers.
   *
   * SRD Pact of the Chain: "you choose one of the normal forms for your
   * familiar **or one of the following special forms**: Imp, Pseudodragon,
   * Quasit, Skeleton, Sphinx of Wonder, Sprite, or Venomous Snake."
   *
   * {@link fixesChoice} narrows a stated choice to one value; this widens a
   * *list* the spell prints, and the two are different questions on different
   * fields — Find Familiar asks its caster both, and Wild Companion answers
   * only the first. The ids are joined to `SummonedForm.among` where the form
   * is checked, so the spell's own "or another Beast of Challenge Rating 0"
   * clause still admits whatever it always admitted.
   *
   * Absent offers exactly what the spell prints, which is every granted route
   * in the book but one.
   */
  readonly widensForm?: readonly string[];
  /**
   * SRD Wild Companion: "and disappears when you finish a Long Rest" — a
   * lifetime the grant puts on a kept summons over what the spell prints,
   * written onto the bond at the arrival.
   */
  readonly keptUntilSummonerLongRests?: true;
  /**
   * What must be true of the caster for this route to be open — SRD One with
   * Shadows: "While you're in an area of Dim Light or Darkness."
   *
   * The `spells` grant's own field, compiled: a standing requirement checked
   * against the world where the route is settled, because a clause about where
   * the caster is standing cannot be answered when the sheet is written.
   * Absent asks nothing, which is every granted route in the book but one.
   */
  readonly requires?: readonly StandingRequirement[];
  /**
   * How long a casting made through **this route** takes, over what the spell
   * prints.
   *
   * SRD Priest, Divine Aid (3/Day), printed under **Bonus Actions**: "The
   * priest casts _Bless, Dispel Magic, Healing Word,_ or _Lesser
   * Restoration_…" — and *Bless*'s own casting time is an Action. What a stat
   * block's heading prices is the *use*, not the spell, so the price belongs
   * on the route the use opens rather than on the definition every other
   * caster reads.
   *
   * **A route may state a casting time; it is not a pipeline of its own.** The
   * one place a casting's slot is decided is `castingOf`, so this is read
   * there and nowhere else, and everything downstream — the action economy,
   * the event, the settlement — sees one answer. A feature's free casting is
   * the same shape one host along.
   *
   * Absent is every route written before this and every route that has nothing
   * to say, which is the ordinary case: the spell's own casting time stands.
   *
   * **A Ritual still wins**, because a Ritual is not a use of this route at
   * all: SRD's "takes 10 minutes longer" is a rule about the *spell*, and
   * `castingOf` settles it first.
   *
   * **Two writers, built in the same batch by two tracks.** A stat block's
   * cast line ("Divine Aid" under Bonus Actions, offering *Bless*), and SRD
   * Pact of the Chain: "You learn the _Find Familiar_ spell and can cast it
   * **as a Magic action**" — a clause about this Warlock's route and not about
   * the spell, so a Wizard who prepared the same spell still takes the hour.
   * A stated time carries no span of seconds: the only casting time that
   * takes one is `long`, which no route states.
   */
  readonly castingTime?: CastingTime;
  /**
   * This route is open **only through the printed line that granted it**, by
   * the heading the block prints.
   *
   * A stat block's cast line is a route whose price is not the route's: SRD
   * Priest's Divine Aid rations three uses a day and SRD Drider's Magic of the
   * Spider Queen comes back on a d6, and those two ledgers are the *heading's*
   * — checked and spent by `castPrintedLine`, which is also where the
   * hand-over door reads them, so two doors on one heading cannot disagree
   * about what is left of it.
   *
   * A route like that must not be castable **around** the line, or the price
   * would simply not be paid: a Priest would cast Bless all day.
   *
   * **Two roads lead to a route and both are closed.** {@link routesFor}
   * leaves one of these out of what a casting *searches*, which closes the
   * road a caller takes when it names no source. `chooseRoute`'s named branch
   * does not come through here — it looks a source up on `granted` directly,
   * and the source is published (`look` reports it, `routeLabel` writes it
   * into every `spell-cast`) — so that road is closed by a **licence**: it
   * refuses `route_through_line_only` unless the printed line's own door says
   * it is the one calling. The licence is an argument between engine
   * functions and is on no request and no tool schema, because a licence a
   * caller could set is a caller granting itself the licence.
   *
   * And a casting like this is not **readied**: `releaseReady` settles without
   * ever asking `castingOf`, so the heading's price would go nowhere —
   * `readied_printed_line`, refused before the slot.
   *
   * Absent is every other grant in the book — a feat's, a feature's, an
   * item's — each of which carries its own price and is cast wherever its
   * holder likes.
   */
  readonly throughLine?: string;
}

/** One class's half of a creature's spellcasting, on that class's terms. */
export interface SpellcastingClass {
  readonly classId: string;
  /** SRD: "you use the spellcasting ability of that class". */
  readonly ability: Ability;
  /** Cantrips known from this class. Always castable, never prepared. */
  readonly cantrips: readonly string[];
  /** Level 1+ spells prepared or known through this class. */
  readonly prepared: readonly string[];
  /**
   * Which pool this class's own slots live in.
   *
   * SRD keeps Pact Magic out of the combined table, so a Warlock's slots are
   * their own pool that recovers on a Short Rest. It is *not* a restriction on
   * what the slots may pay for — either kind casts either class's spells —
   * which is why this says where the slots came from rather than what they buy.
   */
  readonly slotKind: SlotKind;
  /**
   * The spells in this class's book, prepared or not — SRD Ritual Adept reads
   * it: "any spell ... in your spellbook". Only a class that keeps a book
   * carries one; a prepared caster's list is `prepared`.
   */
  readonly book?: readonly string[];
  /**
   * The save DC this source **states**, in place of the one the ability
   * derives — {@link GrantedSpell.saveDc} exactly, on the other half of the
   * declaration.
   *
   * A class's is derived, always: "your spell save DC" is what the book says
   * and what a level says. This is here because the other thing a
   * `SpellcastingState` can describe is a creature with no class table at all,
   * whose numbers are printed on its block, and `declaredCasting` is the door
   * both come through.
   */
  readonly saveDc?: number;
  /** "+4 to hit with spell attacks", the same way and for the same reason. */
  readonly attackBonus?: number;
}

export interface SpellcastingState {
  /** One entry per class that casts, in the order the character took them. */
  readonly classes: readonly SpellcastingClass[];
  /** Spells a feat or feature granted, each on its own terms. */
  readonly granted: readonly GrantedSpell[];
}

export const noSpellcasting = (): SpellcastingState => ({ classes: [], granted: [] });

/**
 * Spellcasting from a single source, for a creature with no class table.
 *
 * A stat block prints "Spellcasting ... using Wisdom as the spellcasting
 * ability" and names no class at all, so the entry is labelled `innate` unless
 * the caller says which class it stands in for. Characters never come through
 * here — `creation.ts` builds one entry per casting class out of the
 * character's own choices, which is the only way a Ranger/Sorcerer's two
 * abilities both survive.
 */
export function declaredCasting(spec: {
  readonly ability: Ability;
  readonly classId?: string;
  readonly cantrips?: readonly string[];
  readonly prepared?: readonly string[];
  readonly granted?: readonly GrantedSpell[];
  readonly slotKind?: SlotKind;
  /** The numbers the declaration states, where it states them. */
  readonly saveDc?: number;
  readonly attackBonus?: number;
}): SpellcastingState {
  return {
    classes: [
      {
        classId: spec.classId ?? 'innate',
        ability: spec.ability,
        cantrips: spec.cantrips ?? [],
        prepared: spec.prepared ?? [],
        slotKind: spec.slotKind ?? 'spell',
        ...(spec.saveDc === undefined ? {} : { saveDc: spec.saveDc }),
        ...(spec.attackBonus === undefined ? {} : { attackBonus: spec.attackBonus }),
      },
    ],
    granted: spec.granted ?? [],
  };
}

/** This class's spellcasting, or null if the creature has no levels in it. */
export function classCasting(
  spellcasting: SpellcastingState,
  classId: string,
): SpellcastingClass | null {
  return spellcasting.classes.find((entry) => entry.classId === classId) ?? null;
}

/** How a creature comes to be able to cast a particular spell. */
export type CastingRoute =
  /**
   * The two class routes, each carrying whatever numbers its source
   * **stated** — see {@link SpellcastingClass.saveDc}. Absent is the ordinary
   * case and derives from the sheet; present is a printed line, and wins.
   */
  | {
      readonly kind: 'cantrip';
      readonly ability: Ability;
      readonly classId: string;
      readonly saveDc?: number;
      readonly attackBonus?: number;
    }
  | {
      readonly kind: 'prepared';
      readonly ability: Ability;
      readonly classId: string;
      readonly saveDc?: number;
      readonly attackBonus?: number;
    }
  | { readonly kind: 'granted'; readonly ability: Ability; readonly grant: GrantedSpell }
  /**
   * The item's route, and the one that is not a fact about the sheet.
   *
   * SRD "Spells Cast from Items" makes a wand's Fireball a casting like any
   * other, so it needs a route like any other — but the three above are
   * derived from `SpellcastingState` and this is derived from an object the
   * wielder happens to be holding. `routesFor` therefore never produces one;
   * `itemRoute` in `commands/item-casting.ts` does, from the state, the
   * catalogue and the request together.
   *
   * **It carries its numbers rather than an ability to re-derive them from.**
   * A printed DC is the item's and no sheet has it; and even where the item
   * defers to the wielder, a casting declared with a wand and settled after
   * the wand was dropped cannot ask the item again. So the numbers are fixed
   * here, at the one moment everything needed to work them out is in hand.
   */
  | {
      readonly kind: 'item';
      /**
       * The wielder's own spellcasting ability, where the item's line defers
       * to it. Null where the item prints its numbers, and null for a wielder
       * who has no spellcasting ability at all.
       */
      readonly ability: Ability | null;
      /** The catalogue id of the item doing the casting. */
      readonly item: string;
      /**
       * The pool the charges come out of — the item's own.
       *
       * Absent where the item's line prices the casting at nothing, which is
       * the one case there is no pool to name: SRD Helm of Comprehending
       * Languages prints no charge count and no per-dawn sentence, so there
       * is nothing to spend and nothing to spend it from.
       */
      readonly pool?: string;
      /** How many charges this casting spends. Absent for an at-will casting. */
      readonly charges?: number;
      /**
       * SRD Ring of Jumping: "can target only yourself when you do so."
       *
       * Read off the grant at the route, like every other thing the item
       * says, so the narrowing is settled from the catalogue once and checked
       * against the targets the spell's own rule has already accepted.
       */
      readonly targetsSelfOnly?: true;
      /** The level the item casts it at, which the charges may decide. */
      readonly castLevel: number;
      /** Fixed here, because nothing later can ask an item that is not in hand. */
      readonly numbers: CastingNumbers;
    };

/**
 * Every route this creature has to this spell.
 *
 * Class routes first, in the order the classes were taken, then grants. More
 * than one is a real state rather than a bug: a Ranger/Sorcerer may have
 * prepared Cure Wounds twice, once through each class, and the two cast
 * against different save DCs.
 *
 * **Except a route a printed line holds open** — see
 * {@link GrantedSpell.throughLine}. Those are not routes a casting finds for
 * itself, because the price is the heading's rather than the route's: a
 * creature that could reach one from here would cast it without the day's use
 * or the recharge going anywhere. `castPrintedLine` names the source, which
 * `chooseRoute` looks up directly.
 *
 * **This closes the road a casting takes when it names nothing, and only that
 * one.** `chooseRoute`'s named-source branch does not come through here, and
 * closes its own road with a licence — see {@link GrantedSpell.throughLine},
 * which says what the licence is and why it is internal.
 */
export function routesFor(
  spellcasting: SpellcastingState,
  spellId: string,
): readonly CastingRoute[] {
  const routes: CastingRoute[] = [];

  for (const entry of spellcasting.classes) {
    // Whatever this source stated about its own numbers, carried onto the
    // route so that one reader — `numbersFor` — answers for every way a
    // casting can be paid for.
    const stated = {
      ...(entry.saveDc === undefined ? {} : { saveDc: entry.saveDc }),
      ...(entry.attackBonus === undefined ? {} : { attackBonus: entry.attackBonus }),
    };
    if (entry.cantrips.includes(spellId)) {
      routes.push({ kind: 'cantrip', ability: entry.ability, classId: entry.classId, ...stated });
    } else if (entry.prepared.includes(spellId)) {
      routes.push({ kind: 'prepared', ability: entry.ability, classId: entry.classId, ...stated });
    }
  }
  for (const grant of spellcasting.granted) {
    if (grant.spellId === spellId && grant.throughLine === undefined) {
      routes.push({ kind: 'granted', ability: grant.ability, grant });
    }
  }

  return routes;
}

/**
 * The first route that works, preferring a class's own over a feat's.
 *
 * A Wizard who has Fire Bolt both as a class cantrip and from Magic Initiate
 * casts it as a Wizard. Where two *classes* both supply it the first is not
 * automatically right — see `chooseRoute` in `commands/casting.ts`, which
 * refuses rather than picking.
 */
export function routeFor(
  spellcasting: SpellcastingState,
  spellId: string,
): CastingRoute | null {
  return routesFor(spellcasting, spellId)[0] ?? null;
}

/**
 * Whether this route casts the spell for **nothing** — see
 * {@link GrantedSpell.atWill}.
 *
 * Asked where the log records how a casting was paid for, because "At Will"
 * is the one price that leaves nothing behind: no slot to name, no pool to
 * spend, and — for a spell above level 0 — no cantrip to call it.
 */
export const castsAtWill = (route: CastingRoute): boolean =>
  route.kind === 'granted' && route.grant.atWill === true;

/**
 * The class this route casts **through**, or null where it is none.
 *
 * SRD Innate Sorcery: "Sorcerer spells you cast". A feature belongs to exactly
 * one class and the sentences that narrow by one ask this — the save DC a
 * casting is settled with, and the mode its attack roll is thrown under — so
 * there is one reader rather than the branch written out at each site.
 *
 * **Null is three different things and they answer alike.** A feat's granted
 * route brings its own ability and no class, a stat block's declaration calls
 * itself `innate`, and an item belongs to nobody — none of the three is a
 * Sorcerer spell, which is what a class-narrowed benefit needs to know.
 */
export const classOfRoute = (route: CastingRoute): string | null =>
  route.kind === 'cantrip' || route.kind === 'prepared' ? route.classId : null;

/**
 * The numbers this route **states**, if it states any.
 *
 * One reader for the two hosts that can carry a printed pair — a declared
 * source's own entry and a granted spell — so `numbersFor` asks once rather
 * than branching on the route kind twice.
 */
export const statedNumbersOf = (
  route: CastingRoute,
): { readonly saveDc?: number; readonly attackBonus?: number } =>
  route.kind === 'granted' ? route.grant : route.kind === 'item' ? {} : route;

