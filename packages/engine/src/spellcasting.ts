import type { Ability } from '@ie/shared';
import type { SlotKind } from './resources.js';

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
}): SpellcastingState {
  return {
    classes: [
      {
        classId: spec.classId ?? 'innate',
        ability: spec.ability,
        cantrips: spec.cantrips ?? [],
        prepared: spec.prepared ?? [],
        slotKind: spec.slotKind ?? 'spell',
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

/** Every cantrip the creature has from any class, deduplicated, in order. */
export function allCantrips(spellcasting: SpellcastingState): readonly string[] {
  return unique(spellcasting.classes.flatMap((entry) => entry.cantrips));
}

/** Every level 1+ spell prepared or known through any class. */
export function allPrepared(spellcasting: SpellcastingState): readonly string[] {
  return unique(spellcasting.classes.flatMap((entry) => entry.prepared));
}

const unique = (ids: readonly string[]): readonly string[] => [...new Set(ids)];

/** How a creature comes to be able to cast a particular spell. */
export type CastingRoute =
  | { readonly kind: 'cantrip'; readonly ability: Ability; readonly classId: string }
  | { readonly kind: 'prepared'; readonly ability: Ability; readonly classId: string }
  | { readonly kind: 'granted'; readonly ability: Ability; readonly grant: GrantedSpell };

/**
 * Every route this creature has to this spell.
 *
 * Class routes first, in the order the classes were taken, then grants. More
 * than one is a real state rather than a bug: a Ranger/Sorcerer may have
 * prepared Cure Wounds twice, once through each class, and the two cast
 * against different save DCs.
 */
export function routesFor(
  spellcasting: SpellcastingState,
  spellId: string,
): readonly CastingRoute[] {
  const routes: CastingRoute[] = [];

  for (const entry of spellcasting.classes) {
    if (entry.cantrips.includes(spellId)) {
      routes.push({ kind: 'cantrip', ability: entry.ability, classId: entry.classId });
    } else if (entry.prepared.includes(spellId)) {
      routes.push({ kind: 'prepared', ability: entry.ability, classId: entry.classId });
    }
  }
  for (const grant of spellcasting.granted) {
    if (grant.spellId === spellId) {
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
 * automatically right — see `chooseRoute` in `commands.ts`, which refuses
 * rather than picking.
 */
export function routeFor(
  spellcasting: SpellcastingState,
  spellId: string,
): CastingRoute | null {
  return routesFor(spellcasting, spellId)[0] ?? null;
}

/** Every spell id this creature could name, for a caller listing options. */
export function castableSpells(spellcasting: SpellcastingState): readonly string[] {
  return unique([
    ...allCantrips(spellcasting),
    ...allPrepared(spellcasting),
    ...spellcasting.granted.map((g) => g.spellId),
  ]);
}
