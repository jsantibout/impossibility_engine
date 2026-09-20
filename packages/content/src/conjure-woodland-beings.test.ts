import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from '@ie/engine';
import {
  createRng,
  createRollIssuer,
  declaredCasting,
  fold,
  resolveSpell,
  resolveTurn,
  spellSlotKey,
  type GameEvent,
  type GameState,
  type Rng,
} from '@ie/engine';
import { ADJUDICATED, BLOCKED_ON, consumersOf } from '../scripts/missing-shapes.js';

/**
 * The last spell in the book whose effects the engine could execute today,
 * executed.
 *
 * `blocked-on.test.ts` had said so for two tranches in those words — an
 * Emanation, a trigger, a save and 5d8 Force is Spirit Guardians' shape — and
 * what kept it in the undefined population was one sentence filed under
 * `an-action-a-spell-compels-or-forbids`. That shape turned out to be built:
 * `ActionRule`'s `allows` was derived from **this spell's** Disengage and
 * `STATABLE_PRICES` holds the one price it moves.
 *
 * So the reading was wrong about which gap it was, and right that there was
 * one. A spell with an `area` has its targets picked by the area, the caster
 * is excluded from an Emanation they cast, and `effects` reaches the creatures
 * the area caught — so there is nowhere for a grant that lands on the **caster**
 * to go while everything else lands on everybody near them. That is
 * `a-spells-effects-applied-to-different-targets` in the map's own words: one
 * effect list applied to every target.
 *
 * The rest of the spell is arithmetic the engine does, so it is written and the
 * one sentence is debt — which is exactly what Spirit Guardians already does
 * with its halved Speed, in the same shape, one clause along.
 */

const id = (s: string) => asCharacterId(s);
const DRUID = id('druid');
/** Stands inside the Emanation and ends turns there. */
const BOAR = id('boar');
/** Stands well outside it, so the geometry is doing something. */
const DISTANT = id('distant');

const sheet = (): CharacterSheet => ({
  level: 13,
  abilities: { str: 10, dex: 12, con: 14, int: 10, wis: 18, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'wis',
});

/** Far enough from full that 5d8 cannot be clipped by a floor at zero. */
const MAX_HP = 400;

const added = (who: CharacterId): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: MAX_HP,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side: who === DRUID ? 'party' : 'foes',
});

const SETUP: readonly GameEvent[] = [
  added(DRUID),
  added(BOAR),
  added(DISTANT),
  {
    type: 'spellcasting-declared',
    id: DRUID,
    spellcasting: declaredCasting({
      ability: 'wis',
      classId: 'druid',
      cantrips: [],
      prepared: ['conjure-woodland-beings'],
    }),
  },
  ...[4, 5, 6].map(
    (level): GameEvent => ({
      type: 'resource-pool-declared',
      id: DRUID,
      pool: {
        key: spellSlotKey(level),
        label: `level ${level} spell slot`,
        max: 4,
        recovers: 'long-rest',
      },
    }),
  ),
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
  { type: 'creature-placed', id: DRUID, placement: { from: { sceneCenter: true }, feet: 0 } },
  // Five feet away: inside a ten-foot Emanation by any reading.
  {
    type: 'creature-placed',
    id: BOAR,
    placement: { from: { creature: DRUID }, feet: 5, bearing: 0 },
  },
  // A hundred feet away: outside it by any reading.
  {
    type: 'creature-placed',
    id: DISTANT,
    placement: { from: { creature: DRUID }, feet: 100, bearing: 180 },
  },
  {
    type: 'combat-started',
    combatants: [
      { id: DRUID, initiative: 30, speed: 30 },
      { id: BOAR, initiative: 20, speed: 30 },
      { id: DISTANT, initiative: 10, speed: 30 },
    ],
  },
];

const supply = (seed: string) => ({
  issuer: createRollIssuer(`r-${seed}`),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
  // A floor under every d20 the boar rolls, so the save fails and the full
  // damage lands: what is being measured is the notation, not the save.
  bonuses: [{ source: 'the fixture', flat: -40 }],
});

/**
 * Cast it, then run turns until the boar has ended one inside the Emanation
 * and the area debt that raised has been settled.
 *
 * The whole log is kept, because the second claim this file makes is that it
 * replays: a spell that resolves correctly once and folds differently the
 * second time is not a definition, it is a coincidence.
 */
const conjure = (
  seed: string,
  slotLevel = 4,
): { readonly log: readonly GameEvent[]; readonly state: GameState } => {
  const events: GameEvent[] = [...SETUP];
  const at = (): GameState => fold('seed', events);

  const cast = unwrap(
    resolveSpell(
      at(),
      DRUID,
      { spellId: 'conjure-woodland-beings', targets: [], slotLevel },
      supply(seed),
    ),
    'the conjuring',
  );
  events.push(...cast.events);

  // Round the order to the end of the boar's turn, which is the trigger this
  // spell prints and the one a creature that stays put ever meets. `resolveTurn`
  // raises the debt and settles it in the same batch, so what is waited for is
  // the damage rather than an owed entry — and the loop stops at the **first**
  // one, because the spirits go on striking every round and this file is
  // measuring one trigger's notation.
  for (let n = 0; n < 6; n += 1) {
    events.push(
      ...unwrap(resolveTurn(at(), supply(`${seed}-turn-${n}`)), 'advancing the turn').events,
    );
    if (at().creatures[BOAR]!.vitals.hp < MAX_HP) break;
  }
  return { log: events, state: at() };
};

const dealtTo = (who: CharacterId, seed: string, slotLevel = 4): number =>
  MAX_HP - conjure(seed, slotLevel).state.creatures[who]!.vitals.hp;

const SEEDS = Array.from({ length: 40 }, (_, n) => `woodland-${n}`);
const mean = (values: readonly number[]): number =>
  values.reduce((total, one) => total + one, 0) / values.length;

describe('Conjure Woodland Beings is transcribed, not approximated', () => {
  const definition = SRD_CONTENT.spell('conjure-woodland-beings')!;

  it('is the spell the book prints, field by field', () => {
    expect(definition.level).toBe(4);
    expect(definition.school).toBe('conjuration');
    expect(definition.castingTime).toBe('action');
    expect(definition.concentration).toBe(true);
    expect(definition.durationSeconds).toBe(600);
    expect(definition.range).toEqual({ kind: 'self' });
  });

  /** "nature spirits that flit around you in a 10-foot Emanation". */
  it('is a 10-foot Emanation originating from the caster', () => {
    expect(definition.area).toEqual({ kind: 'emanation', distance: 10, origin: 'self' });
  });

  /**
   * Three trigger clauses and the cap that spans them, which is Moonbeam's
   * sentence rather than Spirit Guardians' — "A creature makes this save only
   * once per turn" is printed after all three, so it caps the creature and not
   * one clause.
   */
  it('prints all three trigger clauses and the cap across them', () => {
    expect(definition.areaTrigger).toMatchObject({
      onAreaEntry: true,
      onEntry: 'every-entry',
      at: 'end-of-turn',
      oncePerTurn: true,
    });
  });

  /**
   * **Nothing resolves at the casting**, which is the text rather than a
   * simplification: the spirits appear and the paragraph names three moments,
   * none of which is the conjuring. Spirit Guardians is written the same way
   * and for the same reason.
   */
  it('resolves nothing when the spirits appear', () => {
    expect(definition.effects).toEqual([]);
  });

  /** "5d8 Force damage on a failed save or half as much damage on a successful one." */
  it('deals 5d8 Force through the trigger, halved on a success', () => {
    expect(definition.areaTrigger?.effects).toEqual([
      {
        kind: 'save-damage',
        ability: 'wis',
        damage: { dice: '5d8', perSlotLevelAbove: '1d8' },
        damageType: 'force',
        onSuccess: 'half',
      },
    ]);
  });
});

describe('Conjure Woodland Beings is driven', () => {
  it('catches a creature that ends its turn in the Emanation, and nobody else', () => {
    const { state } = conjure('driven');
    expect(state.creatures[BOAR]!.vitals.hp).toBeLessThan(MAX_HP);
    expect(state.creatures[DISTANT]!.vitals.hp).toBe(MAX_HP);
  });

  /**
   * **A single seeded casting cannot tell 5d8 from 1d8**, which is the lesson
   * `executed-second-pass.test.ts` wrote down: the bounds catch a missing
   * addend and the mean catches a missing die. Forty seeds, and the save is
   * floored into failure so what is measured is the notation.
   */
  it('rolls five eight-sided dice and not some other number of them', () => {
    const dealt = SEEDS.map((seed) => dealtTo(BOAR, seed));
    expect(Math.min(...dealt)).toBeGreaterThanOrEqual(5);
    expect(Math.max(...dealt)).toBeLessThanOrEqual(40);
    expect(mean(dealt)).toBeGreaterThan(17);
    expect(mean(dealt)).toBeLessThan(28);
  });

  /** "The damage increases by 1d8 for each spell slot level above 4." */
  it('grows by one die for each slot level above the fourth', () => {
    const base = mean(SEEDS.map((seed) => dealtTo(BOAR, seed)));
    const higher = mean(SEEDS.map((seed) => dealtTo(BOAR, seed, 6)));
    expect(higher).toBeGreaterThan(base + 6);
  });

  /**
   * And it replays: the log folds at every prefix and the whole of it folds to
   * the same bytes twice, which is the claim a definition has to survive rather
   * than the one a single casting makes.
   */
  it('folds at every prefix and replays byte-identically', () => {
    const { log, state } = conjure('replay');
    for (let n = 0; n <= log.length; n += 1) {
      expect(() => fold('seed', log.slice(0, n))).not.toThrow();
    }
    expect(JSON.stringify(fold('seed', log))).toEqual(JSON.stringify(state));
  });
});

describe('the one sentence it does not execute is recorded where debt goes', () => {
  /** Out of the undefined population, and in the catalogue. */
  it('has left the blocked map for a definition', () => {
    expect(BLOCKED_ON['conjure-woodland-beings']).toBeUndefined();
    expect(SRD_CONTENT.spell('conjure-woodland-beings')).not.toBeNull();
  });

  /**
   * **The re-filing, which is the finding this definition carries.** The
   * reading had said the Disengage was blocked on the action economy, and the
   * action economy is built: `ActionRule`'s `allows` names this spell in its
   * own docstring and `STATABLE_PRICES` holds `disengage` out of a Bonus
   * Action. What has no home is putting that grant on the **caster** while the
   * Emanation catches everybody else, because a spell has one effect list and
   * an Emanation excludes the creature it originates from.
   */
  it('files the Disengage under the shape that really blocks it', () => {
    expect(ADJUDICATED['conjure-woodland-beings']?.map((entry) => entry.why)).toEqual([
      'a-spells-effects-applied-to-different-targets',
      // And the second clause is the one the book makes optional: "you **can**
      // force that creature to make a Wisdom saving throw". The engine raises
      // every save the trigger owes and declining is a command nobody sends,
      // which is Conjure Fey's optional attack read the same way.
      'table',
    ]);
    expect(
      (SRD_CONTENT.spell('conjure-woodland-beings')?.unmodelled ?? []).filter((note) =>
        note.includes('Disengage'),
      ),
    ).toHaveLength(1);
  });

  /**
   * And the shape it left is emptied of read finishes, which is the number a
   * tranche gets planned from: what `an-action-a-spell-compels-or-forbids`
   * finishes among the paragraphs somebody has read is now nothing at all.
   */
  it('empties the read column of the shape it used to stand in', () => {
    expect(consumersOf('an-action-a-spell-compels-or-forbids').unblocksRead).toEqual([]);
    expect(consumersOf('an-action-a-spell-compels-or-forbids').unblocksUnread).toEqual([]);
  });
});
