import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap, type CharacterId, type Result } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { declaredCasting } from './spellcasting.js';
import { extendContent } from './content.js';
import type { SpellDefinition } from './spell-definitions.js';
import { checkSpellDefinitionValue } from './spell-schema.js';
import { declareObject, eligibleTargets, resolveSpell } from './commands.js';

/**
 * SRD Light: "You touch one Large or smaller object that **isn't being worn
 * or carried by someone else**." (W9-S4)
 *
 * `TargetRule.objectOrSelf`: the caster — the object is theirs to carry — or a
 * record whose **own** type is the Object type a declared object arrives with.
 * Anybody else is carrying the thing for themselves and is refused
 * `carried_by_someone_else`, in the cast and in the shortlist alike. A Mask
 * that makes a goblin read as an Object to spells does not make it one.
 *
 * Written over a homebrew cantrip, because SRD Light's own record is W9-S1's
 * to edit first and takes the field after that track merges.
 */

const id = (s: string) => asCharacterId(s);
const CASTER = id('caster');
const ALLY = id('ally');
const SCONCE = id('sconce');
const MASKED = id('masked');

const GLOWSTONE: SpellDefinition = {
  id: 'homebrew-glowstone',
  name: 'Glowstone',
  level: 0,
  school: 'evocation',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'touch' },
  targets: { count: 1, self: true, objectOrSelf: true, mustBeSize: ['tiny', 'small', 'medium', 'large'] },
  effects: [{ kind: 'light', level: 'bright', radius: 20, dimBeyond: 20 }],
  durationSeconds: 3600,
  replacesPriorCasting: true,
};

const CONTENT = unwrap(extendContent(SRD_CONTENT, { spells: [GLOWSTONE] }), 'the homebrew cantrip');

const sheet = (): CharacterSheet => ({
  level: 3,
  abilities: { str: 10, dex: 10, con: 10, int: 16, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
});

const added = (who: CharacterId): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 30,
  diesAtZero: false,
  creatureType: 'Humanoid',
  size: 'medium',
});

const beside = (who: CharacterId, bearing: number): GameEvent => ({
  type: 'creature-placed',
  id: who,
  placement: { from: { creature: CASTER }, feet: 5, bearing },
});

const setup = (): readonly GameEvent[] => {
  const base: GameEvent[] = [
    added(CASTER),
    added(ALLY),
    added(MASKED),
    {
      type: 'spellcasting-declared',
      id: CASTER,
      spellcasting: declaredCasting({ ability: 'int', cantrips: [GLOWSTONE.id] }),
    },
    // SRD Arcanist's Magic Aura's Mask, as far as a spell is concerned: the
    // goblin reads as an Object to anything that asks what magic sees.
    {
      type: 'creature-type-masked',
      id: MASKED,
      mask: { source: 'Arcanist’s Magic Aura#cast:99', creatureType: 'Object' },
    },
    { type: 'scene-set', extent: { width: 100, depth: 100, height: 40 } },
    { type: 'landmark-added', name: 'the hall', at: { x: 50, y: 50, z: 0 } },
    { type: 'creature-placed', id: CASTER, placement: { from: { landmark: 'the hall' }, feet: 0 } },
    beside(ALLY, 0),
    beside(MASKED, 180),
  ];
  const sconce = unwrap(
    declareObject(fold('seed', base), CONTENT, SCONCE, {
      name: 'sconce',
      material: 'iron',
      size: 'small',
      build: 'resilient',
    }),
    'the sconce',
  );
  return [...base, ...sconce, beside(SCONCE, 90)];
};

const state = (): GameState => fold('seed', setup());
const supply = () => ({ issuer: createRollIssuer('r'), rng: createRng('glow') as Rng, content: CONTENT });

const glow = (on: CharacterId): Result<unknown> =>
  resolveSpell(state(), CASTER, { spellId: GLOWSTONE.id, targets: [on] }, supply());

const code = (out: Result<unknown>): string => (isErr(out) ? out.code : 'cast');

describe('an object that is not carried by someone else', () => {
  it('lights a declared sconce', () => {
    expect(state().creatures[MASKED]!.creatureType).toBe('Humanoid');
    expect(code(glow(SCONCE))).toBe('cast');
  });

  it('lights the caster’s own object', () => {
    expect(code(glow(CASTER))).toBe('cast');
  });

  it('refuses an ally, who carries the thing for themselves', () => {
    const out = glow(ALLY);
    expect(code(out)).toBe('carried_by_someone_else');
    expect(isErr(out) && out.reason).toContain(ALLY);
  });

  it('refuses a goblin a Mask makes read as an Object: the record’s own type is read', () => {
    expect(code(glow(MASKED))).toBe('carried_by_someone_else');
  });

  it('offers the shortlist the same answer', () => {
    const offered = eligibleTargets(state(), CONTENT, CASTER, GLOWSTONE.id, 0);
    expect([...offered.eligible].sort()).toEqual([CASTER, SCONCE].sort());
    expect(offered.excluded.map((one) => one.target).sort()).toEqual([ALLY, MASKED].sort());
    expect(offered.excluded.every((one) => one.reason.includes('someone else'))).toBe(true);
  });
});

describe('the rule', () => {
  const codes = (targets: Record<string, unknown>): readonly string[] =>
    checkSpellDefinitionValue({ ...GLOWSTONE, targets }).map((one) => one.code);

  it('validates as written', () => {
    expect(checkSpellDefinitionValue(GLOWSTONE)).toEqual([]);
  });

  it('is true or absent, admits the caster, and names one thing', () => {
    expect(codes({ count: 1, self: true, objectOrSelf: 'yes' })).toContain('malformed_field');
    expect(codes({ count: 1, objectOrSelf: true })).toContain('object_or_self_without_self');
    expect(codes({ count: 2, self: true, objectOrSelf: true })).toContain('object_or_self_count');
  });
});

/**
 * "One **Large or smaller** object": the size is the object's. Named as the
 * caster, the object is the thing in the caster's hand, so the caster's own
 * size is not asked — a caster nothing has sized still lights their torch. A
 * declared object is asked its own size. (Every declared object is Large or
 * smaller already — the Object Hit Points table stops there — so SRD Light's
 * size never refuses one; a homebrew "Tiny object" shows the reading bites.)
 */
describe('the size objectOrSelf asks is the object’s', () => {
  const SIZELESS = id('sizeless');
  const PEBBLE_GLOW: SpellDefinition = { ...GLOWSTONE, id: 'homebrew-pebble-glow', name: 'Pebble Glow', targets: { ...GLOWSTONE.targets, mustBeSize: 'tiny' } };
  const PEBBLE_CONTENT = unwrap(extendContent(CONTENT, { spells: [PEBBLE_GLOW] }), 'the tiny homebrew');

  const sizedState = (): GameState => {
    const base: GameEvent[] = [
      { ...added(SIZELESS), size: undefined } as GameEvent,
      {
        type: 'spellcasting-declared',
        id: SIZELESS,
        spellcasting: declaredCasting({ ability: 'int', cantrips: [PEBBLE_GLOW.id] }),
      },
      { type: 'scene-set', extent: { width: 100, depth: 100, height: 40 } },
      { type: 'landmark-added', name: 'the hall', at: { x: 50, y: 50, z: 0 } },
      { type: 'creature-placed', id: SIZELESS, placement: { from: { landmark: 'the hall' }, feet: 0 } },
    ];
    const sconce = unwrap(
      declareObject(fold('seed', base), PEBBLE_CONTENT, SCONCE, {
        name: 'sconce',
        material: 'iron',
        size: 'small',
        build: 'resilient',
      }),
      'the sconce',
    );
    return fold('seed', [
      ...base,
      ...sconce,
      { type: 'creature-placed', id: SCONCE, placement: { from: { creature: SIZELESS }, feet: 5, bearing: 90 } },
    ]);
  };

  const cast = (on: CharacterId): Result<unknown> =>
    resolveSpell(sizedState(), SIZELESS, { spellId: PEBBLE_GLOW.id, targets: [on] }, {
      ...supply(),
      content: PEBBLE_CONTENT,
    });

  it('lets a caster nothing has sized light the thing in their own hand', () => {
    expect(code(cast(SIZELESS))).toBe('cast');
    const shortlist = eligibleTargets(sizedState(), PEBBLE_CONTENT, SIZELESS, PEBBLE_GLOW.id, 0);
    expect(shortlist.eligible).toContain(SIZELESS);
  });

  it('asks a declared object its own size', () => {
    expect(code(cast(SCONCE))).toBe('wrong_creature_size');
  });
});
