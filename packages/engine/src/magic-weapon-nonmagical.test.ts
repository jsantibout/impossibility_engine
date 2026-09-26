import { describe, expect, it } from 'vitest';
import { SPELL_DEFINITIONS, SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap, type CharacterId, type Result } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { spellSlotKey } from './resources.js';
import { declaredCasting } from './spellcasting.js';
import { isMagicalItem } from './catalogue.js';
import { checkSpellDefinitionValue } from './spell-schema.js';
import { resolveSpell } from './commands.js';

/**
 * SRD Magic Weapon: "You touch a **nonmagical** weapon. Until the spell ends,
 * that weapon **becomes a magic weapon** with a +1 bonus to attack rolls and
 * damage rolls." (W9-S4)
 *
 * Two readings of one fact. A weapon is magical when its record says so —
 * `isMagicalItem`, derived from what a magic item has grown (grants,
 * attunement) rather than from a field nobody writes — or when a running
 * casting's rider says the spell made it one (`weapon-rider.makesMagical`).
 * Either way the pre-flight refuses `weapon_already_magical` before anything
 * is spent, and a recast the spell's own "ends early if you cast it again"
 * takes away is not in the way of itself.
 */

const id = (s: string) => asCharacterId(s);
const PALADIN = id('paladin');
const WIZARD = id('wizard');
const FIGHTER = id('fighter');

const sheet = (): CharacterSheet => ({
  level: 5,
  abilities: { str: 16, dex: 10, con: 10, int: 16, wis: 16, cha: 16 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'wis',
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

const caster = (who: CharacterId, cantrips: readonly string[] = []): readonly GameEvent[] => [
  added(who),
  {
    type: 'spellcasting-declared',
    id: who,
    spellcasting: declaredCasting({ ability: 'wis', cantrips: [...cantrips], prepared: ['magic-weapon'] }),
  },
  {
    type: 'resource-pool-declared',
    id: who,
    pool: { key: spellSlotKey(2), label: 'level 2', max: 4, recovers: 'long-rest' },
  },
];

const SETUP: readonly GameEvent[] = [
  ...caster(PALADIN, ['shillelagh']),
  ...caster(WIZARD),
  added(FIGHTER),
  {
    type: 'items-gained',
    id: FIGHTER,
    items: [
      { id: 'longsword', quantity: 1 },
      { id: 'longsword-plus-1', quantity: 1 },
    ],
    source: 'kit',
  },
  { type: 'items-gained', id: PALADIN, items: [{ id: 'club', quantity: 1 }], source: 'kit' },
  { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
  { type: 'landmark-added', name: 'the yard', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: FIGHTER, placement: { from: { landmark: 'the yard' }, feet: 0 } },
  { type: 'creature-placed', id: PALADIN, placement: { from: { creature: FIGHTER }, feet: 5, bearing: 0 } },
  // Beside the fighter and diagonally beside the paladin, so either may be touched.
  { type: 'creature-placed', id: WIZARD, placement: { from: { creature: FIGHTER }, feet: 5, bearing: 90 } },
];

const state = (log: readonly GameEvent[]): GameState => fold('seed', log);
const supply = () => ({ issuer: createRollIssuer('r'), rng: createRng('weapon') as Rng, content: SRD_CONTENT });

const magicWeapon = (log: readonly GameEvent[], by: CharacterId, on: CharacterId, weapon: string) =>
  resolveSpell(state(log), by, { spellId: 'magic-weapon', targets: [on], slotLevel: 2, weapon }, supply());

const after = (log: readonly GameEvent[], out: Result<{ readonly events: readonly GameEvent[] }>) => [
  ...log,
  ...unwrap(out, 'the casting').events,
];

const code = (out: Result<unknown>): string => (isErr(out) ? out.code : 'cast');

describe('is this weapon magical', () => {
  it('reads it off the record: a Longsword is not, a +1 Longsword is', () => {
    expect(isMagicalItem(SRD_CONTENT.item('longsword')!)).toBe(false);
    expect(isMagicalItem(SRD_CONTENT.item('longsword-plus-1')!)).toBe(true);
  });
});

describe('the definition', () => {
  const definition = () => SPELL_DEFINITIONS.find((d) => d.id === 'magic-weapon')!;

  it('writes that the weapon becomes magic, and owes nothing for "nonmagical"', () => {
    expect(definition().effects[0]).toMatchObject({ kind: 'weapon-rider', makesMagical: true });
    expect(definition().unmodelled ?? []).toEqual([]);
    expect(checkSpellDefinitionValue(definition())).toEqual([]);
  });

  it('refuses a clause that is not true, and one on a fist', () => {
    const codes = (effect: Record<string, unknown>): readonly string[] =>
      checkSpellDefinitionValue({ ...definition(), effects: [effect] }).map((one) => one.code);
    expect(codes({ kind: 'weapon-rider', bonus: 1, makesMagical: 'yes' })).toContain('malformed_field');
    expect(codes({ kind: 'weapon-rider', bonus: 1, unarmed: true, makesMagical: true })).toContain(
      'magical_fist',
    );
  });
});

describe('a nonmagical weapon', () => {
  it('imbues a Longsword', () => {
    expect(code(magicWeapon(SETUP, PALADIN, FIGHTER, 'longsword'))).toBe('cast');
  });

  it('refuses a +1 Longsword, which is magic already, with nothing spent', () => {
    const out = magicWeapon(SETUP, PALADIN, FIGHTER, 'longsword-plus-1');
    expect(code(out)).toBe('weapon_already_magical');
    expect(isErr(out) && out.reason).toContain('+1 Longsword');
  });

  it('refuses a second caster’s Magic Weapon on the Longsword the first made magic', () => {
    const log = after(SETUP, magicWeapon(SETUP, PALADIN, FIGHTER, 'longsword'));
    const out = magicWeapon(log, WIZARD, FIGHTER, 'longsword');
    expect(code(out)).toBe('weapon_already_magical');
    expect(isErr(out) && out.reason).toContain('Magic Weapon');
  });

  it('lets the first caster cast it again, which ends the first casting and replaces its rider', () => {
    const first = after(SETUP, magicWeapon(SETUP, PALADIN, FIGHTER, 'longsword'));
    const firstSource = state(first).creatures[FIGHTER]!.weaponRiders[0]!.source;
    const second = after(first, magicWeapon(first, PALADIN, FIGHTER, 'longsword'));
    const riders = state(second).creatures[FIGHTER]!.weaponRiders;
    expect(riders).toHaveLength(1);
    expect(riders[0]!.source).not.toBe(firstSource);
  });

  it('does not count a rider whose spell does not make the weapon magic: Shillelagh’s club', () => {
    const log = after(
      SETUP,
      resolveSpell(state(SETUP), PALADIN, { spellId: 'shillelagh', targets: [PALADIN], weapon: 'club' }, supply()),
    );
    expect(state(log).creatures[PALADIN]!.weaponRiders).toHaveLength(1);
    expect(code(magicWeapon(log, WIZARD, PALADIN, 'club'))).toBe('cast');
  });
});
