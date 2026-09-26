/**
 * SRD Gaseous Form: "The target can't talk or **manipulate objects**, and any
 * objects it was carrying or holding can't be dropped, used, or otherwise
 * interacted with."
 *
 * **One sentence over six spenders, only one of which has a name.** `utilize` is
 * one of `NAMED_ACTIONS` and a `forbids` naming it says a sixth of this clause;
 * the rest — a drop, an equip, an unequip, a purchase, a free object
 * interaction, something picked up off the floor — cost nothing, or nothing a
 * rule could name. So `forbids.objects` is a field of its own, exactly as
 * `forbids.casting` is, and every command that puts a hand on a thing reads it
 * through `refuseObjectHandling` and refuses `cannot_manipulate_objects`.
 *
 * Talking is the one the engine has no spender for and never will. It was kept
 * a debt on the reading that a handover is a verbatim printed sentence and the
 * SRD prints talking inside the same sentence as the object clauses the engine
 * enforces; the owner overruled that on 2026-09-26, and the whole sentence is
 * handed over under the DM mark while the object clauses stay enforced here.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap, type CharacterId, type Result } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, restoreRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { spellSlotKey } from './resources.js';
import { declaredCasting } from './spellcasting.js';
import { dmDecisionsIn } from './spell-definitions.js';
import {
  dropItem,
  equipItem,
  purchaseItem,
  resolveSpell,
  takeItemUp,
  takeUtilize,
  unequipItem,
  useFreeObjectInteraction,
} from './commands.js';

const id = (s: string) => asCharacterId(s);
const WIZ = id('wiz');
/** The one who stays solid, so every refusal has a control beside it. */
const SOLID = id('solid');

const sheet = (): CharacterSheet => ({
  level: 9,
  abilities: { str: 12, dex: 14, con: 14, int: 18, wis: 12, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
  weaponProficiencies: ['simple', 'martial'],
});

const added = (who: CharacterId): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 60,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side: 'party',
});

const SETUP: readonly GameEvent[] = [
  added(WIZ),
  added(SOLID),
  {
    type: 'spellcasting-declared',
    id: WIZ,
    spellcasting: declaredCasting({ ability: 'int', prepared: ['gaseous-form'] }),
  },
  ...[1, 2, 3].map(
    (level): GameEvent => ({
      type: 'resource-pool-declared',
      id: WIZ,
      pool: { key: spellSlotKey(level), label: `level ${level}`, max: 4, recovers: 'long-rest' },
    }),
  ),
  ...[WIZ, SOLID].flatMap((who): readonly GameEvent[] => [
    { type: 'items-gained', id: who, items: [{ id: 'dagger', quantity: 1 }], source: 'the kit' },
    { type: 'items-gained', id: who, items: [{ id: 'mace', quantity: 1 }], source: 'the kit' },
    { type: 'item-equipped', id: who, item: 'dagger', armor: null },
    { type: 'coins-changed', id: who, copper: 10000, source: 'the purse' },
  ]),
  { type: 'scene-set', extent: { width: 300, depth: 300, height: 40 } },
  { type: 'landmark-added', name: 'the vault', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: WIZ, placement: { from: { landmark: 'the vault' }, feet: 0 } },
  { type: 'creature-placed', id: SOLID, placement: { from: { creature: WIZ }, feet: 5, bearing: 0 } },
  {
    type: 'combat-started',
    combatants: [
      { id: WIZ, initiative: 20, speed: 30 },
      { id: SOLID, initiative: 10, speed: 30 },
    ],
  },
];

const supply = (state: GameState) => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: (state.rng === null ? createRng('mist') : restoreRng(state.rng)) as Rng,
  content: SRD_CONTENT,
});

/** The wizard turns themselves to mist; the other one stays solid. */
const misted = (): readonly GameEvent[] => {
  const state = fold('seed', SETUP);
  return [
    ...SETUP,
    ...unwrap(
      resolveSpell(
        state,
        WIZ,
        { spellId: 'gaseous-form', targets: [WIZ], willing: [WIZ] } as never,
        supply(state),
      ),
      'gaseous form',
    ).events,
  ];
};

/** A pile on the floor for the ground-pile door to reach for. */
const withAPileNearby = (log: readonly GameEvent[]): readonly GameEvent[] => [
  ...log,
  ...unwrap(
    dropItem(fold('seed', log), SRD_CONTENT, SOLID, { item: 'mace' }),
    'the mace on the floor',
  ),
];

const codeOf = (result: Result<unknown>): string | null => (isErr(result) ? result.code : null);

describe('SRD Gaseous Form: a cloud may not handle a thing', () => {
  const doors = (log: readonly GameEvent[], who: CharacterId): Record<string, Result<unknown>> => {
    const state = fold('seed', log);
    return {
      drop: dropItem(state, SRD_CONTENT, who, { item: 'dagger' }),
      equip: equipItem(state, SRD_CONTENT, who, 'mace'),
      unequip: unequipItem(state, SRD_CONTENT, who, 'dagger'),
      purchase: purchaseItem(state, SRD_CONTENT, who, 'torch'),
      interaction: useFreeObjectInteraction(state, who),
      utilize: takeUtilize(state, who, { object: 'the lever' }),
      pickUp: takeItemUp(state, SRD_CONTENT, who, { item: 'mace' }),
    };
  };

  it('refuses every door that puts a hand on something', () => {
    const log = withAPileNearby(misted());
    for (const [door, out] of Object.entries(doors(log, WIZ))) {
      expect(codeOf(out), door).toBe('cannot_manipulate_objects');
    }
  });

  it('names the spell and how long it lasts', () => {
    const refused = dropItem(fold('seed', misted()), SRD_CONTENT, WIZ, { item: 'dagger' });
    expect(isErr(refused) && refused.reason).toContain('Gaseous Form');
  });

  it('leaves a solid creature every one of those doors', () => {
    const log = withAPileNearby(misted());
    for (const [door, out] of Object.entries(doors(log, SOLID))) {
      // The mace is on the floor, so the solid one's own equip has nothing to
      // put on — every *other* door is open, and that one is refused for a
      // reason about the mace rather than about the mist.
      expect(codeOf(out), door).not.toBe('cannot_manipulate_objects');
    }
  });

  it('leaves the same doors open before anybody is a cloud', () => {
    const log = withAPileNearby(SETUP);
    for (const [door, out] of Object.entries(doors(log, WIZ))) {
      expect(codeOf(out), door).not.toBe('cannot_manipulate_objects');
    }
  });

  /**
   * **The one of the four the engine does not forbid, handed over.** Talking
   * is not an action anything spends. It stood here as a debt, on the reading
   * that handing over the sentence it is printed in would ask the table to
   * adjudicate three quarters of a rule; the owner overruled that on
   * 2026-09-26, so the sentence goes to the table whole under the DM mark —
   * and the object clauses in it are still refused above, whatever the table
   * reads.
   */
  it('hands the one thing it does not forbid to the table', () => {
    const state = fold('seed', SETUP);
    const out = unwrap(
      resolveSpell(
        state,
        WIZ,
        { spellId: 'gaseous-form', targets: [WIZ], willing: [WIZ] } as never,
        supply(state),
      ),
      'gaseous form',
    );
    expect(dmDecisionsIn(out.unverified)).toEqual([
      "The target can't talk or manipulate objects, and any objects it was carrying or holding can't be dropped, used, or otherwise interacted with.",
    ]);
    // And nothing unmarked speaks of talking: the debt line is gone.
    const unmarked = out.unverified.filter((line) => dmDecisionsIn([line]).length === 0);
    expect(unmarked.join('\n')).not.toMatch(/\btalk/i);
  });
});
