import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { NO_ABILITY_SCORES } from './checks.js';
import { createRng, restoreRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { lightAt } from './positioning.js';
import { declaredCasting } from './spellcasting.js';
import { rollModesFor } from './standing.js';
import { declareObject, resolveSpell } from './commands.js';

/**
 * SRD Faerie Fire: "**Objects** in a 20-foot Cube within range are outlined in
 * blue, green, or violet light (your choice). … For the duration, objects and
 * affected creatures shed Dim Light in a 10-foot radius … Attack rolls against
 * an affected creature **or object** have Advantage if the attacker can see
 * it."
 *
 * The definition filed the objects as "not modelled". A declared object is a
 * `creature-added` with `creatureType: 'Object'` and no ability scores, placed
 * on the lattice as a monster is, so the Cube catches it, its Dexterity save
 * fails automatically — SRD: an object "fails all saving throws" — and the
 * riders the failure carries land on it exactly as they land on a creature.
 * This file is the evidence that the clause's reason was false.
 */

const id = (s: string) => asCharacterId(s);
const DRUID = id('druid');
const FIGHTER = id('fighter');
const CHEST = id('the chest');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 3,
  abilities: { str: 14, dex: 10, con: 10, int: 10, wis: 18, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'wis',
  weaponProficiencies: ['simple', 'martial'],
  ...over,
});

const added = (who: CharacterId): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 30,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side: 'party',
});

const supply = (state: GameState) => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: (state.rng === null ? createRng('outline') : restoreRng(state.rng)) as Rng,
  content: SRD_CONTENT,
});

const BASE: readonly GameEvent[] = [
  added(DRUID),
  added(FIGHTER),
  {
    type: 'spellcasting-declared',
    id: DRUID,
    spellcasting: declaredCasting({ ability: 'wis', classId: 'druid', prepared: ['faerie-fire'] }),
  },
  {
    type: 'resource-pool-declared',
    id: DRUID,
    pool: { key: 'spell-slot:1', label: 'level 1', max: 2, recovers: 'long-rest' },
  },
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
  { type: 'creature-placed', id: DRUID, placement: { from: { point: { x: 100, y: 100, z: 0 } }, feet: 0 } },
  { type: 'creature-placed', id: FIGHTER, placement: { from: { point: { x: 110, y: 100, z: 0 } }, feet: 0 } },
];

/** The chest, declared as the fiction it is and put fifteen feet up the line. */
const withChest = (): readonly GameEvent[] => {
  const declared = unwrap(
    declareObject(fold('outline', BASE), SRD_CONTENT, CHEST, {
      name: 'the chest',
      material: 'wood',
      size: 'small',
      build: 'resilient',
    }),
    'the chest',
  );
  return [
    ...BASE,
    ...declared,
    { type: 'creature-placed', id: CHEST, placement: { from: { point: { x: 100, y: 115, z: 0 } }, feet: 0 } },
    { type: 'sight-declared', from: FIGHTER, to: CHEST, seen: true },
  ];
};

const outlined = () => {
  const log = withChest();
  const out = unwrap(
    resolveSpell(
      fold('outline', log),
      DRUID,
      {
        spellId: 'faerie-fire',
        targets: [],
        at: { x: 100, y: 100, z: 0 },
        towards: { x: 100, y: 200, z: 0 },
        slotLevel: 1,
      },
      supply(fold('outline', log)),
    ),
    'faerie fire',
  );
  return { out, state: fold('outline', [...log, ...out.events]) };
};

describe('SRD Faerie Fire and a declared object in the Cube', () => {
  it('catches the chest, whose Dexterity save fails because it has no ability scores', () => {
    const { out } = outlined();
    const chest = out.outcomes.find((outcome) => outcome.target === CHEST);

    expect(chest?.save?.autoFailed).toBe(NO_ABILITY_SCORES);
    expect(chest?.save?.success).toBe(false);
  });

  it('outlines the chest: it sheds Dim Light in a 10-foot radius', () => {
    const { state } = outlined();

    expect(lightAt(state, { x: 100, y: 115, z: 0 })).toMatchObject({ level: 'dim', magical: true });
    expect(lightAt(state, { x: 100, y: 125, z: 0 }).level).toBe('dim');
  });

  it('gives an attacker who can see the chest Advantage against it', () => {
    const { state } = outlined();

    const modes = rollModesFor(state, { roller: FIGHTER, against: CHEST, family: 'attack' }).modes;
    expect(modes.map((mode) => `${mode.mode} from ${mode.source}`)).toContain(
      'advantage from Faerie Fire#cast:1',
    );
  });
});
