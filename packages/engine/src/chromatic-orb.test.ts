import { describe, expect, it } from 'vitest';
import { SPELL_DEFINITIONS, SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap, type CharacterId, type Result } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import type { Rng, RngState } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { createCharacter, type CharacterChoices } from './creation.js';
import { levelGrantedSpells, type SpellbookEntry } from './spellbook.js';
import { checkSpellDefinition } from './spell-schema.js';
import type { SpellDefinition, SpellEffect } from './spell-definitions.js';
import { resolveDeclaredCast, resolveSpell, type CastSpellRequest } from './commands.js';

/**
 * An orb that leaps — SRD Chromatic Orb.
 *
 * > "You hurl an orb of energy at a target within range. Choose Acid, Cold,
 * > Fire, Lightning, Poison, or Thunder for the type of orb you create, and
 * > then make a ranged spell attack against the target. On a hit, the target
 * > takes 3d8 damage of the chosen type. If you roll the same number on two or
 * > more of the d8s, the orb leaps to a different target of your choice within
 * > 30 feet of the target. Make an attack roll against the new target, and
 * > make a new damage roll. The orb can't leap again unless you cast the spell
 * > with a level 2+ spell slot."
 * > _Using a Higher-Level Spell Slot._ "The damage increases by 1d8 for each
 * > spell slot level above 1. The orb can leap a maximum number of times equal
 * > to the level of the slot expended, and a creature can be targeted only
 * > once by each casting of this spell."
 *
 * Two readings the format could not make before this: a predicate over a
 * **whole** damage roll — a pair among the spell's own dice, where `DieRule`
 * judges one die at a time — and an attack roll aimed at a creature the
 * casting never named, chained off the face the dice showed. The leap is
 * **elected** in the Resourceful ruling's shape: the request states `leapTo`
 * in order, and when a pair shows the orb goes to the next stated creature
 * within thirty feet of the one it just struck that this casting has not yet
 * targeted, with a new attack roll and a new damage roll. No window opens; a
 * leap with nobody stated simply does not happen. The cap is the slot's level
 * — one leap at level 1, which is what "can't leap **again** unless" means.
 */

const id = (s: string) => asCharacterId(s);
const KESSA = id('kessa');
const A = id('goblin-a');
const B = id('goblin-b');
const C = id('goblin-c');
const FAR = id('goblin-far');

const book = (level: number): SpellbookEntry[] =>
  [
    'chromatic-orb',
    'magic-missile',
    'shield',
    'mage-armor',
    'burning-hands',
    'detect-magic',
    'feather-fall',
    'hold-person',
    'misty-step',
    'web',
  ]
    .slice(0, levelGrantedSpells(level))
    .map((spellId, index) => ({
      spellId,
      acquiredAt: index < 6 ? 1 : Math.ceil((index - 5) / 2) + 1,
      origin: 'level' as const,
    }));

const kessa = (): CharacterChoices => ({
  name: 'Kessa',
  classId: 'wizard',
  level: 3,
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 },
  },
  abilityIncreases: { int: 2, con: 1 },
  classSkills: ['investigation', 'insight'],
  languages: ['Draconic', 'Elvish'],
  alignment: 'Chaotic Good',
  subclassId: 'evoker',
  cantrips: ['fire-bolt', 'light', 'prestidigitation'],
  spellbook: book(3),
  preparedSpells: ['chromatic-orb', 'magic-missile', 'shield', 'mage-armor', 'hold-person', 'burning-hands'],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: {
    'wizard:scholar': ['arcana'],
    'human:skillful': ['perception'],
    'evoker:evocation-savant': ['thunderwave', 'scorching-ray'],
  },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int',
      cantrips: ['mage-hand', 'ray-of-frost'],
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId: 'skilled', proficiencies: ['stealth', 'nature', 'survival'] },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
});

const plain = (): CharacterSheet => ({
  level: 1,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: null,
});

const goblin = (who: CharacterId): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: plain(),
  maxHp: 200,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side: 'goblins',
});

/**
 * Kessa at the gate; A thirty feet north of her; B twenty feet on from A; C
 * twenty feet on from B (forty from A, so the orb reaches C only off B); and a
 * fourth goblin fifty feet from everybody.
 */
const SETUP: readonly GameEvent[] = [
  ...(unwrap(createCharacter(SRD_CONTENT, kessa(), KESSA), 'create') as GameEvent[]),
  { type: 'creature-side-declared', id: KESSA, side: 'party' },
  goblin(A),
  goblin(B),
  goblin(C),
  goblin(FAR),
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
  { type: 'landmark-added', name: 'the gate', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: KESSA, placement: { from: { landmark: 'the gate' }, feet: 0 } },
  { type: 'creature-placed', id: A, placement: { from: { creature: KESSA }, feet: 30, bearing: 0 } },
  { type: 'creature-placed', id: B, placement: { from: { creature: A }, feet: 20, bearing: 0 } },
  { type: 'creature-placed', id: C, placement: { from: { creature: B }, feet: 20, bearing: 0 } },
  { type: 'creature-placed', id: FAR, placement: { from: { creature: A }, feet: 50, bearing: 90 } },
  ...[A, B, C, FAR].map(
    (who): GameEvent => ({ type: 'sight-declared', from: KESSA, to: who, seen: true }),
  ),
];

/** A chosen face on every d20 and the maximum on everything else — so every d8 pairs. */
const pairing = (d20: number): Rng => ({
  int: (sides: number) => (sides === 20 ? d20 : sides),
  snapshot: (): RngState => [0, 0, 0, 0],
});

/** The same d20, and d8s that count up so no two of a roll ever match. */
const distinct = (d20: number): Rng => {
  let face = 0;
  return {
    int: (sides: number) => {
      if (sides === 20) return d20;
      face = (face % sides) + 1;
      return face;
    },
    snapshot: (): RngState => [0, 0, 0, 0],
  };
};

const supply = (rng: Rng = pairing(15)) => ({
  issuer: createRollIssuer('r'),
  rng,
  content: SRD_CONTENT,
});

const must = <T,>(result: Result<T>): T => unwrap(result, 'the orb');

const state = (log: readonly GameEvent[]): GameState => fold('seed', log);

const hurl = (
  request: Partial<CastSpellRequest>,
  rng: Rng = pairing(15),
  log: readonly GameEvent[] = SETUP,
): readonly GameEvent[] =>
  must(
    resolveSpell(
      state(log),
      KESSA,
      { spellId: 'chromatic-orb', targets: [A], slotLevel: 1, damageType: 'fire', ...request },
      supply(rng),
    ),
  ).events;

/** Who the orb struck, in the order the log says it struck them. */
const struck = (events: readonly GameEvent[]): readonly CharacterId[] =>
  events.flatMap((event) =>
    event.type === 'damage-taken' && event.source === 'Chromatic Orb' ? [event.id] : [],
  );

const attackRolls = (events: readonly GameEvent[]): number =>
  events.filter((event) => event.type === 'roll-recorded' && event.label === 'Chromatic Orb attack')
    .length;

describe('the definition is written to the book', () => {
  const orb = (): SpellDefinition => SPELL_DEFINITIONS.find((one) => one.id === 'chromatic-orb')!;

  it('prints the leap on the attack: a pair, thirty feet, and a cap that is the slot', () => {
    const attack = orb().effects[0] as Extract<SpellEffect, { kind: 'attack' }>;
    expect(attack.kind).toBe('attack');
    expect(attack.leaps).toEqual({ onPair: true, withinFeet: 30, maximum: 'slot-level' });
  });

  it('leaves nothing for the table to adjudicate', () => {
    expect(orb().unmodelled).toBeUndefined();
    expect(checkSpellDefinition(orb())).toEqual([]);
  });
});

describe('the orb leaps when its dice pair', () => {
  it('leaps once at a level 1 slot, to the stated creature, with a new attack roll and new dice', () => {
    const events = hurl({ leapTo: [B, C] });
    expect(struck(events)).toEqual([A, B]);
    expect(attackRolls(events)).toBe(2);
    // Two damage rolls, one each; the leap is a fresh 3d8 and not a share of
    // the first.
    const dealt = events.flatMap((event) =>
      event.type === 'damage-taken' && event.source === 'Chromatic Orb' ? [event.amount] : [],
    );
    expect(dealt).toEqual([24, 24]);
  });

  it('leaps as many times as the slot’s level, and no further', () => {
    const events = hurl({ leapTo: [B, C], slotLevel: 2 });
    expect(struck(events)).toEqual([A, B, C]);
    expect(attackRolls(events)).toBe(3);
  });

  it('never leaps to a creature this casting has already targeted', () => {
    // A level 2 slot allows two leaps and B is the only creature stated: the
    // orb goes to B once, and with B struck the list holds nobody it may take.
    const events = hurl({ leapTo: [B], slotLevel: 2 });
    expect(struck(events)).toEqual([A, B]);
    expect(attackRolls(events)).toBe(2);
  });

  it('does not leap when nobody was stated', () => {
    const events = hurl({});
    expect(struck(events)).toEqual([A]);
    expect(attackRolls(events)).toBe(1);
  });

  it('does not leap to a creature more than thirty feet from the one it struck', () => {
    // C is forty feet from A and reachable only off B; with B unstated the orb
    // has nowhere within reach and stops.
    expect(struck(hurl({ leapTo: [C], slotLevel: 2 }))).toEqual([A]);
    expect(struck(hurl({ leapTo: [FAR], slotLevel: 2 }))).toEqual([A]);
  });

  it('does not leap when no two of the d8s match', () => {
    const events = hurl({ leapTo: [B, C], slotLevel: 2 }, distinct(15));
    expect(struck(events)).toEqual([A]);
    expect(attackRolls(events)).toBe(1);
  });

  it('does not leap off a miss, because no damage was rolled', () => {
    const events = hurl({ leapTo: [B] }, pairing(1));
    expect(struck(events)).toEqual([]);
    expect(attackRolls(events)).toBe(1);
  });

  it('keeps the stated list across a held casting', () => {
    const declared = must(
      resolveSpell(
        state(SETUP),
        KESSA,
        { spellId: 'chromatic-orb', targets: [A], slotLevel: 1, damageType: 'fire', leapTo: [B], hold: true },
        supply(),
      ),
    );
    const open = [...SETUP, ...declared.events];
    expect(struck(declared.events)).toEqual([]);
    const settled = must(resolveDeclaredCast(state(open), declared.castingId!, supply()));
    expect(struck(settled.events)).toEqual([A, B]);
  });
});

describe('the stated list is checked before anything is spent', () => {
  const refused = (request: CastSpellRequest): string => {
    const out = resolveSpell(state(SETUP), KESSA, request, supply());
    if (!isErr(out)) throw new Error('expected a refusal');
    return out.code;
  };
  const orbAt = (request: Partial<CastSpellRequest>): CastSpellRequest => ({
    spellId: 'chromatic-orb',
    targets: [A],
    slotLevel: 1,
    damageType: 'fire',
    ...request,
  });

  it('refuses a leap list on a spell that prints no leap', () => {
    expect(refused({ spellId: 'fire-bolt', targets: [A], leapTo: [B] })).toBe('no_leap_clause');
  });

  it('refuses a leap to a creature the casting already names', () => {
    expect(refused(orbAt({ leapTo: [A] }))).toBe('leap_to_a_target');
  });

  it('refuses the same creature stated twice', () => {
    expect(refused(orbAt({ leapTo: [B, B] }))).toBe('duplicate_leap_target');
  });

  it('refuses a creature nobody has added', () => {
    expect(refused(orbAt({ leapTo: [id('nobody')] }))).toBe('unknown_creature');
  });
});
