import type { Ability } from '@ie/shared';

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

export interface SpellcastingState {
  /** The class's spellcasting ability, or null for a creature with no class. */
  readonly ability: Ability | null;
  /** Cantrips known from the class. Always castable, never prepared. */
  readonly cantrips: readonly string[];
  /** Level 1+ spells prepared from the class's list. */
  readonly prepared: readonly string[];
  /** Spells a feat or feature granted, each on its own terms. */
  readonly granted: readonly GrantedSpell[];
}

export const noSpellcasting = (): SpellcastingState => ({
  ability: null,
  cantrips: [],
  prepared: [],
  granted: [],
});

/** How a creature comes to be able to cast a particular spell. */
export type CastingRoute =
  | { readonly kind: 'cantrip'; readonly ability: Ability }
  | { readonly kind: 'prepared'; readonly ability: Ability }
  | { readonly kind: 'granted'; readonly ability: Ability; readonly grant: GrantedSpell };

/**
 * Whether this creature can cast this spell at all, and on whose terms.
 *
 * Returns the *first* route that works, preferring the class's own, because a
 * Wizard who has Fire Bolt both as a class cantrip and from Magic Initiate
 * casts it as a Wizard.
 */
export function routeFor(
  spellcasting: SpellcastingState,
  spellId: string,
): CastingRoute | null {
  const ability = spellcasting.ability;

  if (ability !== null && spellcasting.cantrips.includes(spellId)) {
    return { kind: 'cantrip', ability };
  }
  if (ability !== null && spellcasting.prepared.includes(spellId)) {
    return { kind: 'prepared', ability };
  }

  const grant = spellcasting.granted.find((g) => g.spellId === spellId);
  if (grant !== undefined) return { kind: 'granted', ability: grant.ability, grant };

  return null;
}

/** Every spell id this creature could name, for a caller listing options. */
export function castableSpells(spellcasting: SpellcastingState): readonly string[] {
  return [
    ...spellcasting.cantrips,
    ...spellcasting.prepared,
    ...spellcasting.granted.map((g) => g.spellId),
  ];
}
