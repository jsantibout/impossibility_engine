import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, isNeedsContext, expect as unwrap } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent } from './events.js';
import { resolveTurn, swapInitiativeBetween } from './commands.js';
import { createCharacter, type CharacterChoices } from './creation.js';

/**
 * SRD Alert's second printed benefit: **Initiative Swap**.
 *
 * "Immediately after you roll Initiative, you can swap your Initiative with
 * the Initiative of one willing ally in the same combat. You can't make this
 * swap if you or the ally has the Incapacitated condition."
 *
 * The arithmetic has been owned by `swapInitiative` since it was written and
 * the Incapacitated clause since `swapInitiativeBetween` was. Three things the
 * sentence says were checked by nothing: that the swapper holds the feat, that
 * the moment is the window the sentence opens, and that the ally consents.
 *
 * The owner ruled on 2026-09-20 that the swap is Alert's and has a window: the
 * holder chooses immediately after the roll and before the first turn is
 * taken. The engine's nearest moment is `turnsTaken === 0`, which is the same
 * reading `moment: 'initiative'` already takes for SRD Uncanny Metabolism —
 * the window is the same for everyone in the order rather than depending on
 * where in it the holder sits.
 */

const id = (s: string) => asCharacterId(s);
const ALERT = id('alert-one');
const ALLY = id('ally');
const STRANGER = id('stranger');

const plain = (): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: null,
});

/** A Fighter who took Alert with their Human origin feat. */
const alert = (): CharacterChoices => ({
  name: 'Bren',
  classId: 'fighter',
  level: 5,
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
  },
  abilityIncreases: { con: 2, wis: 1 },
  classSkills: ['athletics', 'survival'],
  languages: ['Dwarvish', 'Orc'],
  alignment: 'Neutral',
  subclassId: 'champion',
  cantrips: [],
  spellbook: [],
  preparedSpells: [],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: { 'human:skillful': ['perception'], 'fighter:weapon-mastery': [] },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int',
      cantrips: ['mage-hand', 'light'],
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId: 'alert' },
    'fighter:fighting-style': { featId: 'archery' },
    'fighter:ability-score-improvement': { featId: 'savage-attacker' },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
});

const added = (who: ReturnType<typeof id>, side: string): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: plain(),
  maxHp: 40,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side,
});

/** The feat-holder, an ally, and one standing outside the fight. */
const fight = (): readonly GameEvent[] => [
  ...(unwrap(createCharacter(SRD_CONTENT, alert(), ALERT), 'create') as GameEvent[]),
  { type: 'creature-side-declared', id: ALERT, side: 'party' },
  added(ALLY, 'party'),
  added(STRANGER, 'party'),
  {
    type: 'combat-started',
    combatants: [
      { id: ALERT, initiative: 20, speed: 30 },
      { id: ALLY, initiative: 8, speed: 30 },
    ],
  },
];

const supply = () => ({
  issuer: createRollIssuer('r'),
  rng: createRng('alert') as Rng,
  content: SRD_CONTENT,
});

const refusal = (out: { readonly ok: boolean } & Partial<{ readonly code: string }>): string =>
  out.ok ? 'it was allowed' : (out.code ?? '');

const initiativeOf = (log: readonly GameEvent[], who: ReturnType<typeof id>) =>
  fold('seed', log).combat?.order.find((c) => c.id === who)?.initiative;

describe("Alert's Initiative swap", () => {
  it('swaps with a willing ally inside the window', () => {
    const log = fight();
    const swapped = [
      ...log,
      ...unwrap(swapInitiativeBetween(fold('seed', log), ALERT, ALLY, { willing: true }), 'swap'),
    ];
    expect(initiativeOf(swapped, ALERT)).toBe(8);
    expect(initiativeOf(swapped, ALLY)).toBe(20);
  });

  /**
   * "Immediately after you roll Initiative" — and the engine's nearest moment
   * is the first turn of the fight, which is over as soon as one turn has
   * been taken.
   */
  it('refuses once the first turn has been taken', () => {
    const log = fight();
    const later = [
      ...log,
      ...unwrap(resolveTurn(fold('seed', log), supply(), { commandId: 'on' }), 'turn').events,
    ];
    expect(refusal(swapInitiativeBetween(fold('seed', later), ALERT, ALLY, { willing: true }))).toBe(
      'not_the_moment',
    );
    // And nothing moved.
    expect(initiativeOf(later, ALERT)).toBe(20);
  });

  /** "**you** can swap your Initiative" — the holder of the feat, and nobody else. */
  it('refuses a swapper without the feature', () => {
    const log = fight();
    expect(refusal(swapInitiativeBetween(fold('seed', log), ALLY, ALERT, { willing: true }))).toBe(
      'no_such_feature',
    );
  });

  /** "one **willing** ally" — stated, and refused when the answer is no. */
  it('does not swap with an unwilling ally', () => {
    const log = fight();
    expect(refusal(swapInitiativeBetween(fold('seed', log), ALERT, ALLY, { willing: false }))).toBe(
      'ally_unwilling',
    );
  });

  /**
   * And a consent nobody has stated is a fact that is *missing* rather than
   * wrong, so it is asked for rather than refused — the `route` request, which
   * is satisfied by sending the same command with the field filled in.
   */
  it('asks whether the ally is willing when nobody has said', () => {
    const log = fight();
    const out = swapInitiativeBetween(fold('seed', log), ALERT, ALLY);
    expect(isNeedsContext(out)).toBe(true);
    expect(refusal(out)).toBe('consent_not_stated');
  });

  /** The two refusals that were already there, unchanged. */
  it('still refuses an Incapacitated pair and a creature outside the fight', () => {
    const log = fight();
    const stunned: readonly GameEvent[] = [
      ...log,
      { type: 'condition-applied', id: ALLY, condition: 'stunned', source: 'a spell' },
    ];
    expect(
      refusal(swapInitiativeBetween(fold('seed', stunned), ALERT, ALLY, { willing: true })),
    ).toBe('incapacitated');

    expect(
      refusal(swapInitiativeBetween(fold('seed', log), ALERT, STRANGER, { willing: true })),
    ).toBe('unknown_combatant');
  });
});
