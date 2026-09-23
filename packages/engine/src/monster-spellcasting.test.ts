/**
 * A creature that casts, out of the line its own block prints.
 *
 * `declaredCasting` and the `spellcasting-declared` event were built for this
 * case and had nothing to declare: the Spellcasting line was untyped SRD text,
 * so a Cultist Fanatic walked into a fight with a spell list nobody could
 * read. The parser reads it now, `adaptMonster` compiles it, and `addCreature`
 * declares it — so the creature arrives casting, and no door had to open.
 *
 * **The numbers are the block's.** Every block in the SRD but one prints the
 * pair its own abilities derive, which is precisely why the exception has to
 * be named rather than trusted to arithmetic: the Adult Bronze Dragon prints
 * DC 17 where its Charisma and Proficiency Bonus give 18. A printed number and
 * a derived one are not distinguishable after the fact, which is the Death
 * Dog's lesson one subsystem along.
 *
 * **Three prices, and the book prints all three.** An At Will spell is a grant
 * that pays nothing — `slotless: 'innate'`, the value `SlotlessReason` has
 * carried since it was written and nothing had ever meant. An N/Day spell is a
 * grant whose free casting comes out of a pool that recovers at **dawn**,
 * which is the clock the block's other per-day lines are already on. And a
 * cantrip is a cantrip.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap } from '@ie/shared';
import { addCreature } from './commands.js';
import { resolveSpell } from './commands/spell-resolution.js';
import { createRng, restoreRng } from './dice.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { adaptMonster, printedSpellPoolKey } from './monster.js';
import { remaining } from './resources.js';
import { createRollIssuer } from './rolls.js';
import { spellSaveDcWith } from './character.js';

const id = (s: string) => asCharacterId(s);
const SEED = 'monster-casting';
const CULTIST = id('cultist');
const HAG = id('hag');
const TARGET = id('villager');

/** A Humanoid to hold, twenty feet off, so Hold Person has somebody to catch. */
const villager = (): GameEvent => ({
  type: 'creature-added',
  id: TARGET,
  name: 'Villager',
  maxHp: 4,
  creatureType: 'Humanoid',
  sheet: {
    level: 1,
    abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    skills: {},
    saveProficiencies: [],
    armor: null,
    shield: null,
    armorTraining: { light: true, medium: true, heavy: false, shields: true },
    baseSpeed: 30,
    spellcastingAbility: null,
    stated: { armorClass: 10, proficiencyBonus: 2, initiative: 0 },
  },
});

/**
 * The block, a villager twenty feet off, and no fight — so nothing here is
 * about the action economy.
 */
const table = (monsterId: string, who: typeof CULTIST): GameEvent[] => {
  const log: GameEvent[] = [];
  const state = (): GameState => fold(SEED, log);
  log.push(...unwrap(addCreature(state(), SRD_CONTENT, who, monsterId), 'the caster').events);
  log.push(
    villager(),
    { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
    { type: 'landmark-added', name: 'the well', at: { x: 20, y: 20, z: 0 } },
    { type: 'creature-placed', id: who, placement: { from: { landmark: 'the well' }, feet: 0 } },
    {
      type: 'creature-placed',
      id: TARGET,
      placement: { from: { creature: who }, feet: 20, bearing: 0 },
    },
    { type: 'sight-declared', from: who, to: TARGET, seen: true },
  );
  return log;
};

const at = (log: readonly GameEvent[]): GameState => fold(SEED, log);

const supply = (state: GameState) => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: state.rng === null ? createRng(SEED) : restoreRng(state.rng),
  content: SRD_CONTENT,
});

const cast = (
  state: GameState,
  who: typeof CULTIST,
  request: Parameters<typeof resolveSpell>[2],
) => resolveSpell(state, who, request, supply(state));

const castOf = (events: readonly GameEvent[]) => events.find((e) => e.type === 'spell-cast');

describe('what the adapter compiles out of the printed line', () => {
  const cultist = adaptMonster(SRD_CONTENT.monsterById('cultist-fanatic')!, CULTIST);

  it('declares one innate source with the ability the block names', () => {
    expect(cultist.spellcasting?.classes).toEqual([
      {
        classId: 'innate',
        ability: 'wis',
        cantrips: [],
        prepared: [],
        slotKind: 'spell',
        saveDc: 12,
        attackBonus: 4,
      },
    ]);
  });

  it('grants an At Will spell that pays nothing at all', () => {
    expect(cultist.spellcasting?.granted).toContainEqual({
      spellId: 'light',
      source: 'cultist-fanatic:spellcasting',
      ability: 'wis',
      freeCastPool: null,
      slotCasting: false,
      atWill: true,
      saveDc: 12,
      attackBonus: 4,
    });
  });

  it('grants an N/Day spell a pool of N, and declares it', () => {
    expect(cultist.spellcasting?.granted).toContainEqual({
      spellId: 'hold-person',
      source: 'cultist-fanatic:spellcasting',
      ability: 'wis',
      freeCastPool: printedSpellPoolKey('hold-person'),
      slotCasting: false,
      saveDc: 12,
      attackBonus: 4,
    });
    expect(cultist.spellPools).toEqual([
      { key: printedSpellPoolKey('command'), label: 'Command (2/Day)', max: 2, recovers: 'dawn' },
      {
        key: printedSpellPoolKey('hold-person'),
        label: 'Hold Person (1/Day)',
        max: 1,
        recovers: 'dawn',
      },
    ]);
  });

  /** SRD Priest Acolyte prints no parenthesis, so there is nothing to pin. */
  it('pins no numbers where the block prints none', () => {
    const acolyte = adaptMonster(SRD_CONTENT.monsterById('priest-acolyte')!, CULTIST);
    expect(acolyte.spellcasting?.classes[0]).toMatchObject({ ability: 'wis' });
    expect(acolyte.spellcasting?.classes[0]).not.toHaveProperty('saveDc');
    expect(acolyte.spellPools).toEqual([]);
  });

  it('carries a rider it has no field for, on the spell it was printed after', () => {
    const hag = adaptMonster(SRD_CONTENT.monsterById('night-hag')!, HAG);
    expect(hag.spellcasting?.granted.find((g) => g.spellId === 'plane-shift')).toMatchObject({
      handOver: 'self only',
      freeCastPool: printedSpellPoolKey('plane-shift'),
    });
  });

  /** A block that prints no such line declares nothing, and gains no field. */
  it('leaves a block that casts nothing alone', () => {
    const goblin = adaptMonster(SRD_CONTENT.monsterById('goblin-warrior')!, CULTIST);
    expect(goblin.spellcasting).toBeNull();
    expect(goblin.spellPools).toEqual([]);
  });
});

describe('adding the creature declares what it casts', () => {
  const log = table('cultist-fanatic', CULTIST);

  it('writes the declaration and the pools beside the arrival', () => {
    const added = unwrap(
      addCreature(fold(SEED, []), SRD_CONTENT, CULTIST, 'cultist-fanatic'),
      'the cultist',
    );
    expect(added.events.map((e) => e.type)).toEqual([
      'creature-added',
      'spellcasting-declared',
      'resource-pool-declared',
      'resource-pool-declared',
    ]);
  });

  it('leaves the creature holding the spells and the uses', () => {
    const state = at(log);
    const creature = state.creatures[CULTIST]!;
    expect(creature.spellcasting.granted.map((g) => g.spellId)).toEqual([
      'light',
      'thaumaturgy',
      'command',
      'hold-person',
    ]);
    expect(remaining(creature.resources, printedSpellPoolKey('hold-person'))).toBe(1);
    expect(remaining(creature.resources, printedSpellPoolKey('command'))).toBe(2);
  });

  it('folds to the same state twice from the same log', () => {
    expect(JSON.stringify(at(log))).toBe(JSON.stringify(at(log)));
  });
});

describe('the DC is the block’s and not a derivation', () => {
  const log = table('cultist-fanatic', CULTIST);

  it('casts Hold Person at the printed 12', () => {
    const out = unwrap(
      cast(at(log), CULTIST, { spellId: 'hold-person', targets: [TARGET] }),
      'hold person',
    );
    const after = at([...log, ...out.events]);
    expect(after.ongoing[out.castingId!]?.numbers).toMatchObject({ saveDc: 12, attackModifier: 4 });
  });

  /**
   * **The one block in the SRD whose printed pair the sheet does not derive**,
   * and the whole reason the pair is pinned rather than recomputed: the Adult
   * Bronze Dragon prints "spell save DC 17" over a Charisma 25 and a
   * Proficiency Bonus of 5, which derive 18. Every other block in the book
   * agrees with its own arithmetic, so a reader that dropped the printed
   * number would pass every test but this one — which is exactly the Death
   * Dog's lesson, one subsystem along, and exactly why the counter-example has
   * to be named.
   */
  it('pins a printed DC the sheet would not have derived', () => {
    const dragon = adaptMonster(SRD_CONTENT.monsterById('adult-bronze-dragon')!, CULTIST);
    expect(spellSaveDcWith(dragon.sheet, 'cha')).toBe(18);
    expect(dragon.spellcasting?.classes[0]?.saveDc).toBe(17);
    expect(dragon.spellcasting?.granted.every((g) => g.saveDc === 17)).toBe(true);
  });

  it('derives the DC for a block that prints none', () => {
    const acolyteLog = table('priest-acolyte', CULTIST);
    const out = unwrap(
      cast(at(acolyteLog), CULTIST, { spellId: 'light', targets: [] }),
      'light',
    );
    const acolyte = adaptMonster(SRD_CONTENT.monsterById('priest-acolyte')!, CULTIST);
    const spell = castOf(out.events);
    expect(spell).toMatchObject({ spell: 'Light' });
    // Nothing was pinned, so what a save would be rolled against is whatever
    // the sheet says — which for this block happens to be what the SRD's other
    // priest prints.
    expect(acolyte.spellcasting?.classes[0]).not.toHaveProperty('saveDc');
    expect(spellSaveDcWith(acolyte.sheet, 'wis')).toBe(12);
  });
});

describe('what each price buys', () => {
  const log = table('cultist-fanatic', CULTIST);

  it('spends the 1/Day use and refuses the second casting', () => {
    const first = unwrap(
      cast(at(log), CULTIST, { spellId: 'hold-person', targets: [TARGET] }),
      'the first',
    );
    const after = [...log, ...first.events];
    expect(remaining(at(after).creatures[CULTIST]!.resources, printedSpellPoolKey('hold-person'))).toBe(
      0,
    );

    const second = cast(at(after), CULTIST, {
      spellId: 'hold-person',
      targets: [TARGET],
      commandId: 'again',
    });
    expect(isErr(second) && second.code).toBe('no_free_casting');
  });

  it('casts an At Will cantrip twice, spending nothing', () => {
    let events: readonly GameEvent[] = log;
    for (const round of ['one', 'two']) {
      const out = unwrap(
        cast(at(events), CULTIST, { spellId: 'light', targets: [], commandId: `light-${round}` }),
        `Light ${round}`,
      );
      expect(castOf(out.events)).toMatchObject({ slotless: 'cantrip' });
      events = [...events, ...out.events];
    }
    const creature = at(events).creatures[CULTIST]!;
    expect(remaining(creature.resources, printedSpellPoolKey('command'))).toBe(2);
  });

  /**
   * The Night Hag's Detect Magic is level 1 and At Will: no slot, no pool, no
   * cantrip. `innate` is the reason the log gives, and the hag has no spell
   * slots at all for a fallback to reach for.
   */
  it('casts an At Will levelled spell off no slot, and says why', () => {
    const hagLog = table('night-hag', HAG);
    const out = unwrap(cast(at(hagLog), HAG, { spellId: 'detect-magic', targets: [] }), 'detect magic');
    const spell = castOf(out.events);
    expect(spell).toMatchObject({ spell: 'Detect Magic', level: 1, slotless: 'innate' });
    expect(spell).not.toHaveProperty('slotLevel');

    const twice = unwrap(
      cast(at([...hagLog, ...out.events]), HAG, { spellId: 'detect-magic', targets: [], commandId: 'again' }),
      'again',
    );
    expect(castOf(twice.events)).toMatchObject({ slotless: 'innate' });
  });

  it('hands the printed rider to the table when that spell is cast', () => {
    const hagLog = table('night-hag', HAG);
    const out = unwrap(cast(at(hagLog), HAG, { spellId: 'magic-missile', targets: [TARGET] }), 'mm');
    expect(out.unverified.join(' ')).toContain('level 4 version');
  });

  /**
   * A printed spell the catalogue holds no definition for is declared all the
   * same, and casting it refuses for the honest reason.
   */
  it('declares a spell nothing defines, and refuses to cast it', () => {
    const druidLog = table('druid', CULTIST);
    expect(at(druidLog).creatures[CULTIST]!.spellcasting.granted.map((g) => g.spellId)).toContain(
      'entangle',
    );
    const out = cast(at(druidLog), CULTIST, { spellId: 'entangle', targets: [] });
    expect(isErr(out) && out.code).toBe('no_definition');
  });
});
