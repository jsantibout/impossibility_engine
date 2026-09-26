/**
 * SRD Sleep: "Creatures that don't sleep, such as elves, or that have Immunity
 * to the Exhaustion condition automatically succeed on saves against this
 * spell."
 *
 * **One sentence, two facts, and only one of them was a thing the engine held.**
 * The Immunity half has been executed since `save.autoSucceedIf` was written —
 * `conditionImmunitiesOf` answers for a Zombie's printed Immunity and for a
 * granted one alike. The other half was filed as a fact only the table could
 * declare, and it is not: the SRD prints it of no creature type and the 2024 Elf
 * states it as a species trait, Trance — "You don't need to sleep, and magic
 * can't put you to sleep."
 *
 * So it is a `FeatureGrant` of its own, `does-not-sleep`, granted by Trance
 * beside the four hours it already granted, compiled onto
 * `CharacterSheet.doesNotSleep` and read by `autoSucceedIf` in the same clause
 * as the Immunity — because the book joins the two with "or" and either spares
 * the creature.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, type CharacterId } from '@ie/shared';
import { createRng, restoreRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { createCharacter, planCharacter, type CharacterChoices } from './creation.js';
import { declaredCasting } from './spellcasting.js';
import { effectiveConditions } from './standing.js';
import { addCreature, resolveSpell } from './commands.js';

const id = (s: string) => asCharacterId(s);
const WIZ = id('wiz');
const ELF = id('nuala');
const HUMAN = id('bran');
/** SRD Zombie prints Immunity to the Exhaustion condition. */
const ZOMBIE = id('zombie');

/**
 * A level 1 Rogue of the given species, with every choice the plan asks for
 * answered — the same fixture `trance.test.ts` builds, because the trait under
 * test is the same one and an Elf is the only creature in the book that has it.
 */
const rogue = (speciesId: string, name: string): CharacterChoices => ({
  name,
  classId: 'rogue',
  level: 1,
  speciesId,
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 10, dex: 15, con: 14, int: 13, wis: 12, cha: 8 },
  },
  abilityIncreases: { con: 2, int: 1 },
  classSkills: ['stealth', 'perception', 'acrobatics', 'investigation'],
  languages: ['Dwarvish', 'Orc'],
  alignment: 'Neutral',
  cantrips: [],
  spellbook: [],
  preparedSpells: [],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: {
    'rogue:expertise': ['stealth', 'perception'],
    ...(speciesId === 'elf'
      ? { 'elf:elven-lineage': ['Wood Elf'], 'elf:keen-senses': ['perception'] }
      : { 'human:skillful': ['perception'] }),
  },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int' as const,
      cantrips: ['mage-hand', 'light'],
      levelOneSpell: 'find-familiar',
    },
    ...(speciesId === 'human' ? { 'human:versatile': { featId: 'alert' } } : {}),
  },
  ...(speciesId === 'elf' ? { featureSpellcasting: { 'elf:elven-lineage': 'wis' as const } } : {}),
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
});

const born = (speciesId: string, who: CharacterId, name: string) =>
  unwrap(createCharacter(SRD_CONTENT, rogue(speciesId, name), who), 'create') as GameEvent[];

const supply = (state: GameState) => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: (state.rng === null ? createRng('sleep') : restoreRng(state.rng)) as Rng,
  content: SRD_CONTENT,
  // A Wisdom save nobody makes, so the fixture is about who is spared rather
  // than about who was lucky.
  bonuses: [{ source: 'the test insists', flat: -40 }],
});

/** The three sleepers, in one five-foot Sphere with the wizard beside them. */
const field = (): GameEvent[] => {
  const log: GameEvent[] = [
    {
      type: 'creature-added',
      id: WIZ,
      name: 'the wizard',
      sheet: {
        level: 9,
        abilities: { str: 10, dex: 10, con: 12, int: 18, wis: 10, cha: 10 },
        skills: {},
        saveProficiencies: [],
        armor: null,
        shield: null,
        armorTraining: { light: true, medium: true, heavy: true, shields: true },
        baseSpeed: 30,
        spellcastingAbility: 'int',
        weaponProficiencies: ['simple'],
      },
      maxHp: 60,
      diesAtZero: false,
      creatureType: 'Humanoid',
      side: 'party',
    },
    ...born('elf', ELF, 'Nuala'),
    ...born('human', HUMAN, 'Bran'),
    {
      type: 'spellcasting-declared',
      id: WIZ,
      spellcasting: declaredCasting({ ability: 'int', prepared: ['sleep'] }),
    },
    {
      type: 'resource-pool-declared',
      id: WIZ,
      pool: { key: 'spell-slot:1', label: 'level 1', max: 4, recovers: 'long-rest' },
    },
  ];
  log.push(...unwrap(addCreature(fold('seed', log), SRD_CONTENT, ZOMBIE, 'zombie'), 'zombie').events);
  log.push(
    { type: 'scene-set', extent: { width: 300, depth: 300, height: 40 } },
    { type: 'landmark-added', name: 'the camp', at: { x: 100, y: 100, z: 0 } },
    { type: 'landmark-added', name: 'the fire', at: { x: 120, y: 100, z: 0 } },
    { type: 'creature-placed', id: WIZ, placement: { from: { landmark: 'the camp' }, feet: 0 } },
    { type: 'creature-placed', id: ELF, placement: { from: { landmark: 'the fire' }, feet: 0 } },
    { type: 'creature-placed', id: HUMAN, placement: { from: { creature: ELF }, feet: 5, bearing: 0 } },
    { type: 'creature-placed', id: ZOMBIE, placement: { from: { creature: ELF }, feet: 5, bearing: 180 } },
  );
  for (const who of [ELF, HUMAN, ZOMBIE]) {
    log.push({ type: 'sight-declared', from: WIZ, to: who, seen: true });
  }
  return log;
};

const cast = (log: readonly GameEvent[]) => {
  const state = fold('seed', log);
  return unwrap(
    resolveSpell(
      state,
      WIZ,
      // "each creature of your choice in a 5-foot-radius Sphere": the Sphere is
      // laid on the elf's own square and the three of them are named.
      {
        spellId: 'sleep',
        targets: [ELF, HUMAN, ZOMBIE],
        at: { x: 120, y: 100, z: 0 },
      } as never,
      supply(state),
    ),
    'sleep',
  );
};

describe('SRD Sleep: creatures that do not sleep', () => {
  it('writes the fact onto an Elf’s sheet and onto nobody else’s', () => {
    const elf = unwrap(planCharacter(SRD_CONTENT, rogue('elf', 'Nuala')), 'elf');
    const human = unwrap(planCharacter(SRD_CONTENT, rogue('human', 'Bran')), 'human');

    expect(elf.sheet.doesNotSleep).toBe(true);
    expect(human.sheet.doesNotSleep).toBeUndefined();
  });

  it('spares the Elf and the Exhaustion-immune, and catches the human', () => {
    const log = field();
    const out = cast(log);
    const after = fold('seed', [...log, ...out.events]);

    expect(effectiveConditions(after, HUMAN).conditions).toContain('incapacitated');
    expect(effectiveConditions(after, ELF).conditions).not.toContain('incapacitated');
    expect(effectiveConditions(after, ZOMBIE).conditions).not.toContain('incapacitated');
  });

  it('throws the die for all three and overrides the total rather than skipping it', () => {
    const out = cast(field());
    const rolls = out.events.flatMap((event) =>
      event.type === 'roll-recorded' ? [event] : [],
    );

    // The die is thrown and recorded for all three: an automatic success
    // overrides the total, which is the automatic failure's reading with the
    // sign turned round rather than a roll nobody made.
    expect(rolls.map((roll) => roll.who)).toEqual([HUMAN, ELF, ZOMBIE]);
    // And the elf's own total is nowhere near the DC — the save was made for
    // her by what she is, not by the number.
    const elf = rolls.find((roll) => roll.who === ELF)!;
    expect(elf.total).toBeLessThan(0);
    expect(elf.outcome).toBe('resisted');
    // The clause is no longer reported as unspoken.
    expect(out.unverified.join('\n')).not.toContain('such as elves');
  });
});
