/**
 * **A form that hits back, and two small widenings** — W7-B12.
 *
 * SRD Black Pudding and SRD Gray Ooze, Corrosive Form: "A creature that hits
 * the pudding with a melee attack roll takes 4 (1d8) Acid damage. … Any
 * nonmagical weapon takes a cumulative −1 penalty to attack rolls immediately
 * after dealing damage to the pudding and coming into contact with it. The
 * weapon is destroyed if the penalty reaches −5."
 *
 * SRD Giant Boar, Bloodied Fury: "The boar has Advantage on melee attack rolls
 * while it is Bloodied." SRD Swarm of Insects, Spider Climb: "If the swarm has
 * a Climb Speed, the swarm can climb difficult surfaces, including along
 * ceilings, without needing to make an ability check."
 *
 * The first is a defence nobody elects, consulted where SRD Fire Shield is; the
 * other two are a narrowing and a gate on kinds that already had readers.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, type CharacterId, expect as unwrap } from '@ie/shared';
import {
  addCreature,
  addSceneLandmark,
  advanceTime,
  beginCombat,
  declareCreatureSide,
  equipItem,
  pendingCastingsOf,
  placeCreatureInScene,
  resolveAttack,
  resolveDeclaredCast,
  resolveMove,
  resolveSpell,
  resolveTurn,
  setScene,
  settleDamage,
} from './commands.js';
import { createCharacter, type CharacterChoices } from './creation.js';
import { spellSlotKey } from './resources.js';
import { declaredCasting } from './spellcasting.js';
import { createRng, type Rng } from './dice.js';
import { applyEvent, fold, type GameEvent, type GameState } from './events.js';
import { createRollIssuer } from './rolls.js';
import { rollModesFor } from './standing.js';

const id = (s: string) => asCharacterId(s);
const SEED = 'corrosive-form';

const supply = (seed = SEED) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

/**
 * Stat blocks in a row five feet apart, the first on the monsters' side and the
 * rest on the party's, in a fight in the order given.
 */
function row(blocks: readonly (readonly [CharacterId, string])[]): GameEvent[] {
  const log: GameEvent[] = [];
  const state = (): GameState => fold(SEED, log);
  const step = (what: string, produce: () => ReturnType<typeof declareCreatureSide>): void => {
    log.push(...unwrap(produce(), what));
  };
  for (const [who, block] of blocks) {
    log.push(...unwrap(addCreature(state(), SRD_CONTENT, who, block), block).events);
  }
  step('the field', () => setScene(state(), { width: 400, depth: 400, height: 200 }));
  step('a stone', () => addSceneLandmark(state(), 'the stone', { x: 100, y: 100, z: 0 }));
  blocks.forEach(([who], at) => {
    step(`${who} takes a side`, () =>
      declareCreatureSide(state(), who, at === 0 ? 'monsters' : 'party'),
    );
    step(`${who} is placed`, () =>
      placeCreatureInScene(state(), who, {
        from: { landmark: 'the stone' },
        feet: at * 10,
        bearing: 90,
      }),
    );
  });
  log.push({
    type: 'combat-started',
    combatants: blocks.map(([who], at) => ({ id: who, initiative: 20 - at, speed: 30 })),
  });
  return log;
}

const at = (log: readonly GameEvent[]): GameState => fold(SEED, log);

describe('SRD Giant Boar, Bloodied Fury: Advantage on melee attack rolls while Bloodied', () => {
  const BOAR = id('boar');
  const GOBLIN = id('goblin');

  /** The boar, one point past half its Hit Points. */
  const bloodiedBoar = (): GameEvent[] => {
    const log = row([
      [BOAR, 'giant-boar'],
      [GOBLIN, 'goblin-warrior'],
    ]);
    const boar = at(log).creatures[BOAR]!;
    log.push({ type: 'damage-taken', id: BOAR, amount: Math.ceil(boar.vitals.hpMax / 2) });
    return log;
  };

  const modes = (state: GameState, melee: boolean | undefined): readonly string[] =>
    rollModesFor(state, {
      family: 'attack',
      roller: BOAR,
      against: GOBLIN,
      ...(melee === undefined ? {} : { melee }),
    }).modes.map((mode) => mode.source);

  it('gives the Bloodied boar Advantage on a melee attack roll', () => {
    expect(modes(at(bloodiedBoar()), true)).toEqual(['Bloodied Fury']);
  });

  it('gives it nothing on a ranged one, and nothing on a roll nobody said was either', () => {
    expect(modes(at(bloodiedBoar()), false)).toEqual([]);
    // Silence is a miss, which is the reading every narrowing axis takes.
    expect(modes(at(bloodiedBoar()), undefined)).toEqual([]);
  });

  it('gives it nothing while it has more than half its Hit Points', () => {
    const log = row([
      [BOAR, 'giant-boar'],
      [GOBLIN, 'goblin-warrior'],
    ]);
    expect(modes(at(log), true)).toEqual([]);
  });

  it('swings its Gore with the Advantage, because the attack path says the swing is melee', () => {
    const log = bloodiedBoar();
    const swung = unwrap(
      resolveAttack(at(log), BOAR, { target: GOBLIN, weapon: null, action: 'Gore' }, supply()),
      'the gore',
    );
    expect(swung.attack?.mode).toBe('advantage');
  });

  it('leaves the boar’s own sentence reaching every attack roll it makes', () => {
    const log = row([
      [id('small'), 'boar'],
      [GOBLIN, 'goblin-warrior'],
    ]);
    const small = at(log).creatures[id('small')]!;
    log.push({ type: 'damage-taken', id: id('small'), amount: Math.ceil(small.vitals.hpMax / 2) });
    expect(
      rollModesFor(at(log), { family: 'attack', roller: id('small'), against: GOBLIN, melee: false })
        .modes.map((mode) => mode.source),
    ).toEqual(['Bloodied Fury']);
  });
});

describe('SRD Swarm of Insects, Spider Climb: a gate on the climb that costs no check', () => {
  const SWARM = id('swarm');

  const climb = (log: readonly GameEvent[]) =>
    unwrap(
      resolveMove(
        at(log),
        SWARM,
        { placement: { from: { landmark: 'the stone' }, feet: 10, bearing: 270 }, mode: 'climb' },
        supply(),
      ),
      'the climb',
    );

  const asked = (log: readonly GameEvent[]): boolean =>
    climb(log).unverified.some((note) => note.includes('Athletics'));

  it('still hands a swarm with no Climb Speed the check its sentence is gated on', () => {
    expect(asked(row([[SWARM, 'swarm-of-insects']]))).toBe(true);
  });

  it('asks nothing of the same swarm once it has a Climb Speed', () => {
    const log = [
      ...row([[SWARM, 'swarm-of-insects']]),
      {
        type: 'speed-modifier-granted' as const,
        id: SWARM,
        modifier: { source: 'the test', change: 'add' as const, feet: 20, mode: 'climb' as const },
      },
    ];
    expect(asked(log)).toBe(false);
  });

  it('leaves an ungated Spider Climb asking nothing, Climb Speed or not', () => {
    // SRD Vampire Spawn prints the trait and no Climb Speed.
    const log = row([[id('spawn'), 'vampire-spawn']]);
    const climbed = unwrap(
      resolveMove(
        at(log),
        id('spawn'),
        { placement: { from: { landmark: 'the stone' }, feet: 10, bearing: 270 }, mode: 'climb' },
        supply(),
      ),
      'the climb',
    );
    expect(climbed.unverified.some((note) => note.includes('Athletics'))).toBe(false);
  });
});

describe('SRD Corrosive Form: the acid back, and the weapon worn down', () => {
  const BREN = id('bren');
  const OOZE = id('ooze');

  const bren = (): CharacterChoices => ({
    name: 'Bren',
    classId: 'fighter',
    level: 1,
    speciesId: 'human',
    backgroundId: 'sage',
    languages: ['Dwarvish', 'Orc'],
    alignment: 'Neutral',
    spellbook: [],
    backgroundEquipment: 'A',
    classEquipment: 'A',
    hitPoints: { method: 'fixed' },
    dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
    cantrips: [],
    preparedSpells: [],
    abilities: {
      method: 'standard-array',
      assignment: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
    },
    abilityIncreases: { con: 2, wis: 1 },
    classSkills: ['athletics', 'survival'],
    equipped: ['chain-mail'],
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
    },
  });

  /** Bren beside an ooze, the named weapon in hand, Bren's turn first. */
  function beside(block: string, weapon: string): GameState {
    let state = fold(SEED, []);
    const step = (events: readonly GameEvent[]): void => {
      state = events.reduce(applyEvent, state);
    };
    step(unwrap(createCharacter(SRD_CONTENT, bren(), BREN), 'Bren'));
    step([{ type: 'items-gained', id: BREN, items: [{ id: weapon, quantity: 1 }], source: 'the test' }]);
    step(unwrap(equipItem(state, SRD_CONTENT, BREN, weapon), `draw the ${weapon}`));
    step(unwrap(addCreature(state, SRD_CONTENT, OOZE, block), block).events);
    step(unwrap(setScene(state, { width: 120, depth: 80, height: 20 }), 'scene'));
    step(unwrap(addSceneLandmark(state, 'the pit', { x: 40, y: 40, z: 0 }), 'landmark'));
    step(unwrap(placeCreatureInScene(state, BREN, { from: { landmark: 'the pit' }, feet: 0 }), 'Bren'));
    step(
      unwrap(
        placeCreatureInScene(state, OOZE, { from: { creature: BREN }, feet: 5, bearing: 90 }),
        'the ooze',
      ),
    );
    step(unwrap(declareCreatureSide(state, BREN, 'party'), 'side'));
    step(unwrap(declareCreatureSide(state, OOZE, 'oozes'), 'side'));
    step(
      unwrap(
        beginCombat(state, [
          { id: BREN, initiative: 20, speed: 30 },
          { id: OOZE, initiative: 1, speed: 20 },
        ]),
        'combat',
      ),
    );
    return state;
  }

  /** A swing that cannot miss, so the question is only what the hit costs. */
  const swing = (state: GameState, weapon: string, commandId = 'swing', seed = SEED) =>
    unwrap(
      resolveAttack(
        state,
        BREN,
        { target: OOZE, weapon, attackBonuses: [{ source: 'certain', flat: 40 }], commandId },
        supply(seed),
      ),
      `the ${weapon}`,
    );

  /** Round the order back to Bren, so the next swing is a new Attack action. */
  const nextRound = (state: GameState): GameState => {
    let now = state;
    for (const what of ['Bren ends', 'the ooze ends']) {
      now = unwrap(resolveTurn(now, supply(what)), what).events.reduce(applyEvent, now);
    }
    return now;
  };

  const acidTo = (events: readonly GameEvent[]): readonly GameEvent[] =>
    events.filter(
      (event) => event.type === 'damage-taken' && event.id === BREN && event.by === OOZE,
    );

  const penaltyOn = (state: GameState, weapon: string): number =>
    state.creatures[BREN]!.equipped.find((held) => held.id === weapon)?.penalty ?? 0;

  it('costs the pudding’s striker 1d8 Acid on a melee hit', () => {
    const state = beside('black-pudding', 'mace');
    const hit = swing(state, 'mace');
    expect(acidTo(hit.events)).toHaveLength(1);
    const before = state.creatures[BREN]!.vitals.hp;
    const after = hit.events.reduce(applyEvent, state).creatures[BREN]!.vitals.hp;
    expect(before - after).toBeGreaterThanOrEqual(1);
    expect(before - after).toBeLessThanOrEqual(8);
  });

  it('wears a nonmagical mace that dealt damage down by 1, cumulatively', () => {
    let state = beside('black-pudding', 'mace');
    state = swing(state, 'mace', 'one').events.reduce(applyEvent, state);
    expect(penaltyOn(state, 'mace')).toBe(1);
    state = nextRound(state);
    state = swing(state, 'mace', 'two').events.reduce(applyEvent, state);
    expect(penaltyOn(state, 'mace')).toBe(2);
  });

  it('destroys the weapon when the penalty reaches −5', () => {
    let state = beside('black-pudding', 'mace');
    for (const n of ['one', 'two', 'three', 'four', 'five']) {
      state = nextRound(swing(state, 'mace', n).events.reduce(applyEvent, state));
    }
    expect(state.creatures[BREN]!.equipped.some((held) => held.id === 'mace')).toBe(false);
    expect(state.creatures[BREN]!.inventory.some((line) => line.id === 'mace')).toBe(false);
  });

  it('leaves a longsword the pudding took no damage from untouched, and still burns its wielder', () => {
    // The pudding is immune to Slashing: "immediately after dealing damage"
    // is never true of this blow, and the acid is about the hit.
    const state = beside('black-pudding', 'longsword');
    const hit = swing(state, 'longsword');
    expect(acidTo(hit.events)).toHaveLength(1);
    expect(penaltyOn(hit.events.reduce(applyEvent, state), 'longsword')).toBe(0);
  });

  it('leaves a magic weapon untouched', () => {
    const state = beside('black-pudding', 'mace-of-smiting');
    const hit = swing(state, 'mace-of-smiting');
    expect(penaltyOn(hit.events.reduce(applyEvent, state), 'mace-of-smiting')).toBe(0);
  });

  it('wears the weapon on the gray ooze too, whose form burns nobody back', () => {
    const state = beside('gray-ooze', 'mace');
    const hit = swing(state, 'mace');
    expect(acidTo(hit.events)).toHaveLength(0);
    expect(penaltyOn(hit.events.reduce(applyEvent, state), 'mace')).toBe(1);
  });

  it('wears the weapon on the road a Reaction held open, once the settlement has dealt the damage', () => {
    // The blow as `landDamage` holds it when somebody may answer: the weapon
    // rides the hold to the one command that knows whether damage was dealt.
    const held = [
      {
        type: 'damage-rolled' as const,
        damage: {
          target: OOZE,
          by: BREN,
          source: 'Mace',
          components: [{ source: 'Mace', type: 'bludgeoning', roll: null, flat: 6, total: 6 }],
          critical: false,
          fromAttack: true,
          reductions: [],
          offers: [],
          contactWeapon: 'mace',
        },
      },
    ].reduce(applyEvent, beside('black-pudding', 'mace'));
    const settled = unwrap(settleDamage(held, supply()), 'the settlement');
    expect(penaltyOn(settled.events.reduce(applyEvent, held), 'mace')).toBe(1);
  });

  /**
   * "Any **nonmagical** weapon", read as SRD Magic Weapon's "You touch a
   * nonmagical weapon" reads it (W9-T): the record is a magic item, or a
   * running casting's rider says the spell made the weapon a magic one
   * (`weapon-rider.makesMagical`). SRD Shillelagh prints no such sentence —
   * the club's die grows and its damage may turn to Force, and it is still a
   * club — so the pudding eats it as it eats any other.
   */
  describe('what the form reads as magical (W9-T)', () => {
    /** Bren, a caster of both spells, before the ooze. */
    const imbuing = (weapon: string): GameState =>
      [
        {
          type: 'spellcasting-declared' as const,
          id: BREN,
          spellcasting: declaredCasting({
            ability: 'wis',
            cantrips: ['shillelagh'],
            prepared: ['magic-weapon'],
          }),
        },
        {
          type: 'resource-pool-declared' as const,
          id: BREN,
          pool: { key: spellSlotKey(2), label: 'level 2', max: 2, recovers: 'long-rest' as const },
        },
      ].reduce(applyEvent, beside('gray-ooze', weapon));

    const cast = (state: GameState, spellId: string, weapon: string, slotLevel?: number): GameState =>
      unwrap(
        resolveSpell(
          state,
          BREN,
          { spellId, targets: [BREN], weapon, ...(slotLevel === undefined ? {} : { slotLevel }) },
          supply('imbue'),
        ),
        spellId,
      ).events.reduce(applyEvent, state);

    it('wears down a Club under Shillelagh, which the spell never made magic', () => {
      const state = cast(imbuing('club'), 'shillelagh', 'club');
      expect(state.creatures[BREN]!.weaponRiders).toHaveLength(1);
      const hit = swing(state, 'club');
      expect(penaltyOn(hit.events.reduce(applyEvent, state), 'club')).toBe(1);
    });

    it('spares a Longsword under Magic Weapon, which "becomes a magic weapon"', () => {
      const state = cast(imbuing('longsword'), 'magic-weapon', 'longsword', 2);
      const hit = swing(state, 'longsword');
      expect(hit.events.some((event) => event.type === 'damage-taken' && event.id === OOZE)).toBe(
        true,
      );
      expect(penaltyOn(hit.events.reduce(applyEvent, state), 'longsword')).toBe(0);
    });

    it('wears the same Longsword down once the Magic Weapon has ended', () => {
      const imbued = cast(imbuing('longsword'), 'magic-weapon', 'longsword', 2);
      const castingId = Object.values(imbued.ongoing).find((one) => one.spellId === 'magic-weapon')!
        .castingId;
      const ended = applyEvent(imbued, {
        type: 'spell-ended',
        castingId,
        on: null,
        reason: 'dismissed',
      });
      const hit = swing(ended, 'longsword');
      expect(penaltyOn(hit.events.reduce(applyEvent, ended), 'longsword')).toBe(1);
    });

    it('spares a +1 Longsword, which is a magic item', () => {
      const state = imbuing('longsword-plus-1');
      const hit = swing(state, 'longsword-plus-1');
      expect(penaltyOn(hit.events.reduce(applyEvent, state), 'longsword-plus-1')).toBe(0);
    });
  });

  it('neither burns the archer nor wears the bow, because the arrow is what touched', () => {
    const state = beside('black-pudding', 'shortbow');
    const hit = swing(state, 'shortbow');
    expect(acidTo(hit.events)).toHaveLength(0);
    expect(penaltyOn(hit.events.reduce(applyEvent, state), 'shortbow')).toBe(0);
  });

  /**
   * **The two sentences W7-B12 left owed** — M-MATTER.
   *
   * "Nonmagical ammunition is destroyed immediately after hitting the pudding
   * and dealing any damage." The engine spends no ammunition on an ordinary
   * shot (STATUS), and that is not this sentence: this one destroys the piece
   * that touched the ooze, out of the archer's own inventory, through the door
   * a corroded weapon already leaves by. Which piece a launcher fires is
   * content's (`CatalogueItem.firesAmmunition`), and "nonmagical" is read off
   * that item's record as the weapon's is.
   *
   * "The penalty can be removed by casting the _Mending_ spell on the weapon."
   * SRD Mending's `repairs` lifts exactly the `weapon-penalised` record this
   * trait writes.
   */
  describe('the ammunition it eats, and the Mending that lifts the wear (M-MATTER)', () => {
    /** Bren beside the ooze, bow drawn, with a quiver of twenty. */
    const quivered = (block: string, arrows = 20): GameState =>
      [
        {
          type: 'items-gained' as const,
          id: BREN,
          items: [{ id: 'arrows', quantity: arrows }],
          source: 'the test',
        },
      ].reduce(applyEvent, beside(block, 'shortbow'));

    const arrowsOn = (state: GameState): number =>
      state.creatures[BREN]!.inventory.find((line) => line.id === 'arrows')?.quantity ?? 0;

    it('destroys the one arrow that hit the pudding and dealt it damage', () => {
      const state = quivered('black-pudding');
      const hit = swing(state, 'shortbow');
      expect(hit.events.some((event) => event.type === 'damage-taken' && event.id === OOZE)).toBe(true);
      expect(arrowsOn(hit.events.reduce(applyEvent, state))).toBe(19);
      expect(
        hit.events.some(
          (event) =>
            event.type === 'items-lost' &&
            event.id === BREN &&
            event.items.some((line) => line.id === 'arrows' && line.quantity === 1),
        ),
      ).toBe(true);
    });

    it('eats the gray ooze’s arrow too', () => {
      const state = quivered('gray-ooze');
      const hit = swing(state, 'shortbow');
      expect(arrowsOn(hit.events.reduce(applyEvent, state))).toBe(19);
    });

    it('destroys nothing where the shot dealt the pudding no damage', () => {
      // "immediately after hitting the pudding **and dealing any damage**".
      const immune = applyEvent(quivered('black-pudding'), {
        type: 'damage-defense-granted',
        id: OOZE,
        defense: { source: 'the test', damageTypes: ['piercing'], defense: 'immune' },
      });
      const hit = swing(immune, 'shortbow');
      expect(arrowsOn(hit.events.reduce(applyEvent, immune))).toBe(20);
    });

    it('says so where the archer carries none of what the bow fires, and destroys nothing', () => {
      const state = beside('black-pudding', 'shortbow');
      const hit = swing(state, 'shortbow');
      expect(hit.events.some((event) => event.type === 'items-lost')).toBe(false);
      expect(hit.unverified.join(' ')).toContain('carries no Arrows');
    });

    it('eats the arrow on the road a Reaction held open, once the settlement has dealt the damage', () => {
      const held = [
        {
          type: 'damage-rolled' as const,
          damage: {
            target: OOZE,
            by: BREN,
            source: 'Shortbow',
            components: [{ source: 'Shortbow', type: 'piercing', roll: null, flat: 4, total: 4 }],
            critical: false,
            fromAttack: true,
            reductions: [],
            offers: [],
            firedFrom: 'shortbow',
          },
        },
      ].reduce(applyEvent, quivered('black-pudding'));
      const settled = unwrap(settleDamage(held, supply()), 'the settlement');
      expect(arrowsOn(settled.events.reduce(applyEvent, held))).toBe(19);
    });

    it('lets Mending lift the wear the pudding left on the mace', () => {
      let state = beside('black-pudding', 'mace');
      state = swing(state, 'mace', 'one').events.reduce(applyEvent, state);
      expect(penaltyOn(state, 'mace')).toBe(1);

      // The fight over, and Bren a caster of the cantrip, so the minute can run.
      state = [
        { type: 'combat-ended' as const, ending: { kind: 'defeated' as const } },
        {
          type: 'spellcasting-declared' as const,
          id: BREN,
          spellcasting: declaredCasting({ ability: 'int', cantrips: ['mending'], prepared: [] }),
        },
      ].reduce(applyEvent, state);
      const declared = unwrap(
        resolveSpell(state, BREN, { spellId: 'mending', targets: [BREN], object: 'mace' }, supply('mend')),
        'Mending',
      );
      state = declared.events.reduce(applyEvent, state);
      state = unwrap(advanceTime(state, 60, 'the minute'), 'the minute').reduce(applyEvent, state);
      const settled = unwrap(
        resolveDeclaredCast(state, pendingCastingsOf(state)[0]!.castingId, supply('mended')),
        'the mending',
      );
      expect(penaltyOn(settled.events.reduce(applyEvent, state), 'mace')).toBe(0);
    });
  });
});
