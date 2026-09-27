import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, isErr, type CharacterId, type Result } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, restoreRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { applyEvent, fold, type GameEvent, type GameState } from './events.js';
import { declaredCasting } from './spellcasting.js';
import { groundItems, positionOf, type Point } from './positioning.js';
import { elsewhereOf } from './elsewhere.js';
import type { KeptBond } from './state.js';
import {
  damageCreature,
  dismissKeptSummons,
  dismissStrandedSummons,
  resolveSpell,
  summonCreature,
} from './commands.js';

/**
 * What a kept creature leaves behind, on its own spell's sentence.
 *
 * > SRD Find Familiar: "Whenever the familiar drops to 0 Hit Points or
 * > disappears into the pocket dimension, it leaves behind in its space
 * > anything it was wearing or carrying."
 * > SRD Find Steed: "When it disappears, it leaves behind anything it was
 * > wearing or carrying."
 *
 * **Per bond, not per departure** (the owner, 2026-09-27): the spell prints the
 * sentence, the summons pins it on the bond, and the departure reads the pin.
 * A creature whose spell prints nothing takes what it held with it, as every
 * creature leaving the game always has.
 */

const id = (s: string) => asCharacterId(s);
const WIZARD = id('wizard');
const OWL = id('owl');
const HOUND = id('hound');

const sheet = (): CharacterSheet => ({
  level: 9,
  abilities: { str: 10, dex: 14, con: 12, int: 18, wis: 10, cha: 16 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'cha',
  weaponProficiencies: ['simple', 'martial'],
});

const HALL = { x: 100, y: 100, z: 0 };

const FIELD: readonly GameEvent[] = [
  {
    type: 'creature-added',
    id: WIZARD,
    name: 'wizard',
    sheet: sheet(),
    maxHp: 60,
    diesAtZero: false,
    creatureType: 'Humanoid',
    side: 'party',
  },
  {
    type: 'spellcasting-declared',
    id: WIZARD,
    spellcasting: declaredCasting({ ability: 'cha', classId: 'paladin', prepared: ['find-steed'] }),
  },
  ...[1, 2].map(
    (level): GameEvent => ({
      type: 'resource-pool-declared',
      id: WIZARD,
      pool: { key: `spell-slot:${level}`, label: `level ${level}`, max: 4, recovers: 'long-rest' },
    }),
  ),
  { type: 'scene-set', extent: { width: 300, depth: 300, height: 40 } },
  { type: 'landmark-added', name: 'the hall', at: HALL },
  { type: 'creature-placed', id: WIZARD, placement: { from: { landmark: 'the hall' }, feet: 0 } },
];

const supply = (state: GameState) => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: (state.rng === null ? createRng('left') : restoreRng(state.rng)) as Rng,
  content: SRD_CONTENT,
});

const unwrapped = <T,>(result: Result<T>, step: string): T => unwrap(result, step);
const after = (state: GameState, events: readonly GameEvent[]): GameState => events.reduce(applyEvent, state);

/** A creature the wizard keeps, ten feet south of the hall, carrying a bell. */
const kept = (who: CharacterId, bond: KeptBond, monsterId = 'owl'): GameState => {
  const start = fold('left', FIELD);
  const arrived = unwrapped(
    summonCreature(start, SRD_CONTENT, {
      id: who,
      monsterId,
      by: WIZARD,
      kept: bond,
      placement: { from: { landmark: 'the hall' }, feet: 10, bearing: 180 },
    }),
    'the arrival',
  );
  return after(after(start, arrived.events), [
    { type: 'items-gained', id: who, items: [{ id: 'bell', quantity: 1 }], source: 'tied to its leg' },
  ]);
};

const FAMILIAR: KeptBond = { spell: 'find-familiar', untilSummonerDies: false, pocket: { within: 30 }, leavesBehind: true };

/** Drops to 0, and the sweep takes it away. */
const felled = (state: GameState, who: CharacterId, content = true) => {
  const hurt = after(state, unwrapped(damageCreature(state, who, { amount: 500 }), 'the blow'));
  return { hurt, swept: dismissStrandedSummons(hurt, {}, content ? SRD_CONTENT : undefined) };
};

const pilesAt = (state: GameState, at: Point) =>
  groundItems(state.scene!).filter((pile) => pile.at.x === at.x && pile.at.y === at.y && pile.at.z === at.z);

describe('SRD Find Familiar: "it leaves behind in its space anything it was wearing or carrying"', () => {
  it('puts the bell on the floor where the owl was when it drops to 0, and the owl is gone', () => {
    const state = kept(OWL, FAMILIAR);
    const space = positionOf(state.scene!, OWL)!;
    const { hurt, swept } = felled(state, OWL);
    const gone = after(hurt, unwrapped(swept, 'the sweep'));
    expect(gone.creatures[OWL]).toBeUndefined();
    expect(pilesAt(gone, space).map((pile) => pile.item)).toEqual(['bell']);
  });

  it('does the same when it is dismissed to its pocket, and carries nothing there', () => {
    const state = kept(OWL, FAMILIAR);
    const space = positionOf(state.scene!, OWL)!;
    const out = unwrapped(dismissKeptSummons(state, WIZARD, { who: OWL }, SRD_CONTENT), 'the dismissal');
    const away = after(state, out.events);
    expect(elsewhereOf(away, OWL)?.kind).toBe('extradimensional');
    expect(away.creatures[OWL]?.inventory).toEqual([]);
    expect(pilesAt(away, space).map((pile) => pile.item)).toEqual(['bell']);
  });

  it('asks for the catalogue where there is something to leave and none was handed over', () => {
    const state = kept(OWL, FAMILIAR);
    const { swept } = felled(state, OWL, false);
    expect(isErr(swept) && swept.code).toBe('left_behind_owed');
    const pocket = dismissKeptSummons(state, WIZARD, { who: OWL });
    expect(isErr(pocket) && pocket.code).toBe('left_behind_owed');
  });
});

describe('SRD Find Steed: "When it disappears, it leaves behind anything it was wearing or carrying"', () => {
  /** The paladin's own casting, so the pin is the summons' and not the test's. */
  const steedCast = (): { state: GameState; steed: CharacterId } => {
    const start = fold('left', FIELD);
    const cast = unwrapped(
      resolveSpell(start, WIZARD, { spellId: 'find-steed', targets: [WIZARD], choice: 'Celestial', slotLevel: 2 }, supply(start)),
      'Find Steed',
    );
    const cast1 = after(start, cast.events);
    const steed = Object.keys(cast1.creatures).find(
      (who) => cast1.creatures[who as CharacterId]?.summonedBy?.by === WIZARD,
    ) as CharacterId;
    const placed = cast1.scene!.positions[steed] === undefined
      ? after(cast1, [{ type: 'creature-placed', id: steed, placement: { from: { landmark: 'the hall' }, feet: 10, bearing: 90 } }])
      : cast1;
    return {
      steed,
      state: after(placed, [
        { type: 'items-gained', id: steed, items: [{ id: 'bedroll', quantity: 1 }, { id: 'dagger', quantity: 1 }], source: 'packed' },
        { type: 'item-equipped', id: steed, item: 'dagger', armor: null },
      ]),
    };
  };

  it('pins the sentence on the bond the casting writes', () => {
    const { state, steed } = steedCast();
    expect(state.creatures[steed]?.summonedBy?.kept?.leavesBehind).toBe(true);
  });

  it('leaves what it wore and carried in its space when it drops to 0', () => {
    const { state, steed } = steedCast();
    const space = positionOf(state.scene!, steed)!;
    const { hurt, swept } = felled(state, steed);
    const gone = after(hurt, unwrapped(swept, 'the sweep'));
    expect(gone.creatures[steed]).toBeUndefined();
    expect(pilesAt(gone, space).map((pile) => pile.item).sort()).toEqual(['bedroll', 'dagger']);
  });

  it('leaves it too when a second casting replaces the steed', () => {
    const { state, steed } = steedCast();
    const space = positionOf(state.scene!, steed)!;
    const again = unwrapped(
      resolveSpell(state, WIZARD, { spellId: 'find-steed', targets: [WIZARD], choice: 'Fey', slotLevel: 2 }, supply(state)),
      'the second Find Steed',
    );
    const replaced = after(state, again.events);
    expect(replaced.creatures[steed]).toBeUndefined();
    expect(pilesAt(replaced, space).map((pile) => pile.item).sort()).toEqual(['bedroll', 'dagger']);
  });
});

describe('a kept creature whose spell prints no such sentence', () => {
  it('takes what it carried with it', () => {
    const state = kept(HOUND, { spell: 'some-other-spell', untilSummonerDies: false });
    const { hurt, swept } = felled(state, HOUND, false);
    const gone = after(hurt, unwrapped(swept, 'the sweep'));
    expect(gone.creatures[HOUND]).toBeUndefined();
    expect(groundItems(gone.scene!)).toEqual([]);
  });
});
