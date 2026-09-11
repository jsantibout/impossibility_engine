import type { ActivatedFeature, StandingEffect } from './standing.js';

/**
 * Actions any creature can take, and what taking them leaves behind.
 *
 * Most SRD actions resolve and are over: an Attack rolls, a Dash adds to a
 * budget, a Disengage sets a flag the turn clears. **Dodge is the one whose
 * benefit outlives the turn it was taken on** — "until the start of your next
 * turn" — which means it needs somewhere to live that a turn budget cannot
 * offer, and somewhere that is not a class feature either, because every
 * creature can take it.
 *
 * So it is exactly the shape `activateFeature` already has: something switched
 * on, with a deadline and requirements, granting standing effects while it
 * runs. The only thing it lacks is a sheet to be declared on, and that is what
 * this table supplies — one entry rather than a copy on every creature ever
 * made.
 *
 * Kept in its own module so both `standing.ts` and the reducer can read it
 * without either importing the other.
 */

/** The feature id an action's lasting benefit hangs on. */
export const DODGE = 'action:dodge';

/**
 * SRD Dodge: "until the start of your next turn... You lose these benefits if
 * you have the Incapacitated condition or if your Speed is 0."
 *
 * The duration is turn-anchored, so it is scheduled rather than declared here;
 * what this carries is what ends it early and what it costs to take.
 */
export const DODGE_ACTION: ActivatedFeature = {
  feature: DODGE,
  name: 'Dodge',
  action: 'action',
  pool: null,
  lasts: 'start-of-next-turn',
  endsOn: ['incapacitated'],
};

/**
 * SRD Dodge: "any attack roll made against you has Disadvantage if you can see
 * the attacker, and you make Dexterity saving throws with Advantage."
 *
 * Two effects rather than one, because they are read at two different moments
 * by two different rules — and the first carries the sight clause, which the
 * second does not.
 */
export const DODGE_EFFECTS: readonly StandingEffect[] = [
  {
    feature: DODGE,
    name: 'Dodge',
    reach: { kind: 'self' },
    grant: { kind: 'attacked-with-disadvantage', ifSeen: true },
    requires: [
      { kind: 'feature-active', feature: DODGE },
      { kind: 'not-incapacitated' },
      { kind: 'has-speed' },
    ],
  },
  {
    feature: DODGE,
    name: 'Dodge',
    reach: { kind: 'self' },
    grant: { kind: 'advantage', on: 'save', ability: 'dex' },
    requires: [
      { kind: 'feature-active', feature: DODGE },
      { kind: 'not-incapacitated' },
      { kind: 'has-speed' },
    ],
  },
];

/** Every action a creature can take that leaves something behind. */
export const UNIVERSAL_ACTIONS: readonly ActivatedFeature[] = [DODGE_ACTION];

/** The standing effects those actions grant while they run. */
export const UNIVERSAL_ACTION_EFFECTS: readonly StandingEffect[] = [...DODGE_EFFECTS];

/** The definition for an action a creature took, or null if it is not one. */
export function universalAction(feature: string): ActivatedFeature | null {
  return UNIVERSAL_ACTIONS.find((a) => a.feature === feature) ?? null;
}
