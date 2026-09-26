import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, isErr, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, restoreRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { declaredCasting } from './spellcasting.js';
import { positionOf } from './positioning.js';
import { elsewhereOf } from './elsewhere.js';
import {
  dismissKeptSummons,
  endOngoingSpell,
  enterElsewhere,
  recallKeptSummons,
  resolveSpell,
  resolveTurn,
  returnFromElsewhere,
  summonCreature,
} from './commands.js';

/**
 * The two spells whose second place has a **door**.
 *
 * SRD Rope Trick: "Up to eight Medium or smaller creatures can climb into the
 * extradimensional space by moving up the rope … Attacks, spells, and other
 * effects can't pass into or out of the space … Anything inside the space
 * drops out when the spell ends." SRD Find Familiar: "As a Magic action, you
 * can temporarily dismiss the familiar to a pocket dimension … As a Magic
 * action while it is temporarily dismissed, you can cause it to reappear in
 * an unoccupied space within 30 feet of you."
 */

const id = (s: string) => asCharacterId(s);
const WIZARD = id('wizard');
const GOBLIN = id('goblin');
const FIGHTERS = Array.from({ length: 9 }, (_, n) => id(`fighter-${n}`));
const OGRE = id('ogre');
const OWL = id('owl');

const sheet = (): CharacterSheet => ({
  level: 9,
  abilities: { str: 16, dex: 14, con: 12, int: 18, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
  weaponProficiencies: ['simple', 'martial'],
});

const added = (who: CharacterId, side: string, size?: 'large'): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 100,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side,
  ...(size === undefined ? {} : { size }),
});

const slots = (who: CharacterId): readonly GameEvent[] =>
  [1, 2, 3].map((level) => ({
    type: 'resource-pool-declared',
    id: who,
    pool: { key: `spell-slot:${level}`, label: `level ${level}`, max: 4, recovers: 'long-rest' },
  }));

const DOOR = { x: 100, y: 100, z: 0 };

/** The wizard by the door, nine fighters in a row north of it, an ogre, and a goblin with a bow forty feet east. */
const FIELD: readonly GameEvent[] = [
  added(WIZARD, 'party'),
  added(GOBLIN, 'foes'),
  added(OGRE, 'party', 'large'),
  ...FIGHTERS.map((who) => added(who, 'party')),
  {
    type: 'spellcasting-declared',
    id: WIZARD,
    spellcasting: declaredCasting({ ability: 'int', classId: 'wizard', prepared: ['rope-trick', 'fire-bolt', 'mage-armor'] }),
  },
  {
    type: 'spellcasting-declared',
    id: GOBLIN,
    spellcasting: declaredCasting({ ability: 'int', classId: 'wizard', prepared: ['fire-bolt'] }),
  },
  ...slots(WIZARD),
  { type: 'scene-set', extent: { width: 300, depth: 300, height: 40 } },
  { type: 'landmark-added', name: 'the door', at: DOOR },
  { type: 'creature-placed', id: WIZARD, placement: { from: { landmark: 'the door' }, feet: 0 } },
  // Eight in the eight cubes around the door; the ninth ten feet north, to be
  // brought adjacent once the eight have climbed and freed a cube.
  ...FIGHTERS.map(
    (who, n): GameEvent => ({
      type: 'creature-placed',
      id: who,
      placement:
        n < 8
          ? { from: { landmark: 'the door' }, feet: 5, bearing: n * 45 }
          : { from: { landmark: 'the door' }, feet: 10, bearing: 0 },
    }),
  ),
  // Large, its near edge five feet from the rope's point and clear of the eight: within reach and too big for the space.
  { type: 'creature-placed', id: OGRE, placement: { from: { point: { x: 85, y: 95, z: 0 } }, feet: 0, size: 'large' } },
  { type: 'creature-placed', id: GOBLIN, placement: { from: { landmark: 'the door' }, feet: 40, bearing: 90 } },
  ...[WIZARD, ...FIGHTERS].flatMap((who): readonly GameEvent[] => [
    { type: 'sight-declared', from: GOBLIN, to: who, seen: true },
    { type: 'sight-declared', from: who, to: GOBLIN, seen: true },
  ]),
];

const supply = (state: GameState, seed = 'rope') => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: (state.rng === null ? createRng(seed) : restoreRng(state.rng)) as Rng,
  content: SRD_CONTENT,
});

/** The rope hung by the door, and the log that follows. */
const ropeHung = () => {
  const log: GameEvent[] = [...FIELD];
  const cast = unwrap(
    resolveSpell(
      fold('s', log),
      WIZARD,
      { spellId: 'rope-trick', targets: [], at: DOOR, slotLevel: 2 },
      supply(fold('s', log)),
    ),
    'the rope',
  );
  log.push(...cast.events);
  return { log, castingId: cast.castingId! };
};

const climb = (log: GameEvent[], castingId: string, who: CharacterId, commandId?: string) =>
  enterElsewhere(fold('s', log), who, SRD_CONTENT, { castingId, ...(commandId === undefined ? {} : { commandId }) });

describe('Rope Trick', () => {
  it('keeps the rope as a point, and a fighter within five feet climbs in', () => {
    const { log, castingId } = ropeHung();
    expect(fold('s', log).ongoing[castingId]?.origin).toEqual(DOOR);
    const up = unwrap(climb(log, castingId, FIGHTERS[0]!), 'the climb');
    log.push(...up.events);
    const state = fold('s', log);
    expect(positionOf(state.scene!, FIGHTERS[0]!)).toBeNull();
    const record = elsewhereOf(state, FIGHTERS[0]!);
    expect(record?.kind).toBe('extradimensional');
    expect(record?.returns).toEqual({ within: 5 });
    expect(up.unverified.join(' ')).toContain('movement');
  });

  it('refuses a creature the space does not admit, and a climber out of reach', () => {
    const { log, castingId } = ropeHung();
    // Fighter 1 steps aside and the ogre takes the corner it left, its box touching the rope's cube.
    log.push(
      { type: 'creature-moved', id: FIGHTERS[1]!, placement: { from: { landmark: 'the door' }, feet: 20, bearing: 45 } },
      { type: 'creature-moved', id: OGRE, placement: { from: { point: { x: 105, y: 105, z: 0 } }, feet: 0 } },
    );
    const large = climb(log, castingId, OGRE);
    expect(large).toMatchObject({ ok: false, code: 'too_large' });
    const far = climb(log, castingId, GOBLIN);
    expect(far).toMatchObject({ ok: false, code: 'out_of_reach' });
    const noRope = climb(log, 'cast:99', FIGHTERS[0]!);
    expect(noRope).toMatchObject({ ok: false, code: 'not_ongoing' });
    // A running casting that opens no place at all.
    const armour = unwrap(
      resolveSpell(fold('s', log), WIZARD, { spellId: 'mage-armor', targets: [WIZARD], slotLevel: 1 }, supply(fold('s', log))),
      'mage armour',
    );
    const noDoor = climb([...log, ...armour.events], armour.castingId!, FIGHTERS[0]!);
    expect(noDoor).toMatchObject({ ok: false, code: 'no_way_in' });
  });

  it('holds eight, and refuses the ninth', () => {
    const { log, castingId } = ropeHung();
    for (const who of FIGHTERS.slice(0, 8)) {
      log.push(...unwrap(climb(log, castingId, who), `${who} climbs`).events);
    }
    // The ninth steps into the cube the first left.
    log.push({
      type: 'creature-moved',
      id: FIGHTERS[8]!,
      placement: { from: { landmark: 'the door' }, feet: 5, bearing: 0 },
    });
    const ninth = climb(log, castingId, FIGHTERS[8]!);
    expect(isErr(ninth) && ninth.code === 'no_room_inside').toBe(true);
    const twice = climb(log, castingId, FIGHTERS[0]!);
    expect(isErr(twice) && twice.code === 'already_elsewhere').toBe(true);
  });

  it('is reached by nothing: a goblin’s Fire Bolt at a climber refuses not_here', () => {
    const { log, castingId } = ropeHung();
    log.push(...unwrap(climb(log, castingId, FIGHTERS[0]!), 'the climb').events);
    const state = fold('s', log);
    const bolt = resolveSpell(state, GOBLIN, { spellId: 'fire-bolt', targets: [FIGHTERS[0]!] }, supply(state));
    expect(isErr(bolt) && bolt.code === 'not_here').toBe(true);
  });

  it('lets a climber down again while the rope hangs, within five feet of where they climbed', () => {
    const { log, castingId } = ropeHung();
    log.push(...unwrap(climb(log, castingId, FIGHTERS[0]!), 'the climb').events);
    const down = unwrap(
      returnFromElsewhere(fold('s', log), FIGHTERS[0]!, { to: { from: { landmark: 'the door' }, feet: 5, bearing: 0 } }),
      'the climb down',
    );
    const state = fold('s', [...log, ...down.events]);
    expect(positionOf(state.scene!, FIGHTERS[0]!)).toEqual({ x: 100, y: 105, z: 0 });
    expect(elsewhereOf(state, FIGHTERS[0]!)).toBeNull();
  });

  it('drops everybody out when the spell ends, at spaces the caller names', () => {
    const { log, castingId } = ropeHung();
    for (const who of FIGHTERS.slice(0, 2)) {
      log.push(...unwrap(climb(log, castingId, who), `${who} climbs`).events);
    }
    log.push(...unwrap(endOngoingSpell(fold('s', log), WIZARD, castingId, null), 'the rope goes'));
    // Both are stranded, and a fight that began now cannot move past them.
    const fight: GameEvent = {
      type: 'combat-started',
      combatants: [
        { id: WIZARD, initiative: 20, speed: 30 },
        { id: GOBLIN, initiative: 10, speed: 30 },
      ],
    };
    const stuck = resolveTurn(fold('s', [...log, fight]), supply(fold('s', [...log, fight])));
    expect(isErr(stuck) && stuck.code === 'elsewhere_stranded').toBe(true);

    const tooFar = returnFromElsewhere(fold('s', log), FIGHTERS[0]!, {
      to: { from: { landmark: 'the door' }, feet: 15, bearing: 180 },
    });
    expect(isErr(tooFar) && tooFar.code === 'return_too_far').toBe(true);

    for (const [n, who] of FIGHTERS.slice(0, 2).entries()) {
      const out = unwrap(
        returnFromElsewhere(fold('s', log), who, {
          to: { from: { landmark: 'the door' }, feet: 5, bearing: n === 0 ? 0 : 45 },
        }),
        `${who} drops out`,
      );
      log.push(...out.events);
    }
    const state = fold('s', log);
    expect(positionOf(state.scene!, FIGHTERS[0]!)).toEqual({ x: 100, y: 105, z: 0 });
    expect(positionOf(state.scene!, FIGHTERS[1]!)).toEqual({ x: 105, y: 105, z: 0 });
    expect(resolveTurn(fold('s', [...log, fight]), supply(fold('s', [...log, fight]))).ok).toBe(true);
  });
});

describe('a familiar’s pocket dimension', () => {
  /** The owl the wizard keeps, bound on Find Familiar's own terms. */
  const withOwl = (): GameEvent[] => {
    const log: GameEvent[] = [...FIELD];
    const arrived = unwrap(
      summonCreature(fold('s', log), SRD_CONTENT, {
        id: OWL,
        monsterId: 'owl',
        by: WIZARD,
        kept: { spell: 'find-familiar', untilSummonerDies: false, pocket: { within: 30 } },
        placement: { from: { creature: WIZARD }, feet: 10, bearing: 180 },
      }),
      'the owl',
    );
    log.push(...arrived.events);
    return log;
  };

  it('pins the pocket the book prints onto the bond', () => {
    const familiar = SRD_CONTENT.spell('find-familiar')!;
    const summon = familiar.effects.find((effect) => effect.kind === 'summon');
    expect(summon?.kind === 'summon' && summon.kept?.pocket).toEqual({ within: 30 });
    // And the steed's spell prints no pocket, so its bond carries none.
    const steed = SRD_CONTENT.spell('find-steed')!.effects.find((effect) => effect.kind === 'summon');
    expect(steed?.kind === 'summon' && steed.kept?.pocket).toBeUndefined();
  });

  it('is dismissed by its summoner and untargetable while away', () => {
    const log = withOwl();
    const gone = unwrap(dismissKeptSummons(fold('s', log), WIZARD, { who: OWL }), 'the dismissal');
    log.push(...gone.events);
    const state = fold('s', log);
    expect(elsewhereOf(state, OWL)?.kind).toBe('extradimensional');
    expect(positionOf(state.scene!, OWL)).toBeNull();
    const bolt = resolveSpell(state, GOBLIN, { spellId: 'fire-bolt', targets: [OWL] }, supply(state));
    expect(isErr(bolt) && bolt.code === 'not_here').toBe(true);
    // Twice is refused; so is a stranger's hand.
    const again = dismissKeptSummons(state, WIZARD, { who: OWL });
    expect(isErr(again) && again.code === 'already_elsewhere').toBe(true);
    const stranger = dismissKeptSummons(fold('s', withOwl()), GOBLIN, { who: OWL });
    expect(isErr(stranger) && stranger.code === 'not_your_summons').toBe(true);
  });

  it('reappears within 30 feet of its summoner as a Magic action, refused at 35', () => {
    const log = withOwl();
    log.push(...unwrap(dismissKeptSummons(fold('s', log), WIZARD, { who: OWL }), 'the dismissal').events);
    const far = recallKeptSummons(fold('s', log), WIZARD, {
      who: OWL,
      to: { from: { creature: WIZARD }, feet: 35, bearing: 180 },
    });
    expect(isErr(far) && far.code === 'return_too_far').toBe(true);
    const back = unwrap(
      recallKeptSummons(fold('s', log), WIZARD, { who: OWL, to: { from: { creature: WIZARD }, feet: 30, bearing: 180 } }),
      'the recall',
    );
    const state = fold('s', [...log, ...back.events]);
    expect(positionOf(state.scene!, OWL)).toEqual({ x: 100, y: 70, z: 0 });
    expect(elsewhereOf(state, OWL)).toBeNull();
    // And a recall of a familiar that is here is refused.
    const here = recallKeptSummons(state, WIZARD, { who: OWL, to: { from: { creature: WIZARD }, feet: 5 } });
    expect(isErr(here) && here.code === 'not_dismissed').toBe(true);
  });

  it('cannot bring itself back: the recall is the summoner’s', () => {
    const log = withOwl();
    log.push(...unwrap(dismissKeptSummons(fold('s', log), WIZARD, { who: OWL }), 'the dismissal').events);
    const alone = returnFromElsewhere(fold('s', log), OWL, { to: { from: { creature: WIZARD }, feet: 5 } });
    expect(isErr(alone) && alone.code === 'no_way_back').toBe(true);
  });

  it('spends the summoner’s Action in a fight', () => {
    const log = withOwl();
    log.push({
      type: 'combat-started',
      combatants: [
        { id: WIZARD, initiative: 20, speed: 30 },
        { id: GOBLIN, initiative: 10, speed: 30 },
      ],
    });
    const gone = unwrap(dismissKeptSummons(fold('s', log), WIZARD, { who: OWL }), 'the dismissal');
    expect(gone.events.some((event) => event.type === 'action-spent')).toBe(true);
    log.push(...gone.events);
    // The Action is gone, so the recall waits for the next turn.
    const now = recallKeptSummons(fold('s', log), WIZARD, { who: OWL, to: { from: { creature: WIZARD }, feet: 5, bearing: 180 } });
    expect(now.ok).toBe(false);
    // A steed's spell offers no pocket at all.
    const steedLog = [
      ...FIELD,
      ...unwrap(
        summonCreature(fold('s', FIELD), SRD_CONTENT, {
          id: id('steed'),
          monsterId: 'otherworldly-steed',
          by: WIZARD,
          kept: { spell: 'find-steed', untilSummonerDies: true },
          placement: { from: { point: { x: 80, y: 80, z: 0 } }, feet: 0 },
        }),
        'the steed',
      ).events,
    ];
    const noPocket = dismissKeptSummons(fold('s', steedLog), WIZARD, { who: id('steed') });
    expect(isErr(noPocket) && noPocket.code === 'no_pocket').toBe(true);
  });
});
