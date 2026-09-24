import { describe, expect, it } from 'vitest';
import { asCharacterId, SKILL_ABILITY } from '@ie/shared';
import { checkContent } from './content.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { standingSpellSaveDcBonus, type StandingGrant } from './standing.js';
import {
  rollSelectorProblems,
  selectorMatches,
  rollModifierKey,
  type RollQuery,
  type RollSelector,
} from './roll-modifiers.js';

/**
 * The two narrowings SRD Innate Sorcery prints, and the one member that says
 * what a casting's saving throw DC is worth.
 *
 * > "The spell save DC of Sorcerer spells you cast increases by 1. You have
 * > Advantage on the attack rolls of Sorcerer spells you cast."
 *
 * Both halves needed a vocabulary the engine did not have. The DC is the far
 * side of a saving throw — `save-bonus` is a number the creature *rolling*
 * adds, and no member added one to the number it has to beat. The Advantage is
 * an attack roll narrowed by something no field on a selector could see: that
 * a **spell** made it, and which class it was cast through. A mode that could
 * not say the first would have been Advantage on every club its holder swung,
 * and one that could not say the second would have improved a Sorcerer/Wizard's
 * Wizard half too — a benefit *misapplied*, which this repository counts as
 * strictly worse than one never applied.
 *
 * The SRD catalogue drives all of this end to end in `sorcerer.test.ts`; what
 * is here is the vocabulary itself — the predicate, the identity and the two
 * validators — which is where a homebrew feature meets it.
 */

const id = (s: string) => asCharacterId(s);
const CASTER = id('caster');
const TARGET = id('target');

const attackQuery = (over: Partial<RollQuery> = {}): RollQuery => ({
  family: 'attack',
  roller: CASTER,
  against: TARGET,
  ...over,
});

const spellAttacks: RollSelector = {
  roll: 'attack',
  relation: 'roller',
  onlySpellAttacks: true,
};

describe('a mode narrowed to the attack rolls of spells', () => {
  it('reaches a roll the spell path classified as a spell attack', () => {
    expect(selectorMatches(spellAttacks, CASTER, attackQuery({ spellAttack: true }))).toBe(true);
  });

  /**
   * A weapon swing says nothing here, which is what makes the narrowing
   * honest: the same reading `againstMagic` takes of a saving throw nobody
   * classified, and the reason `resolveAttack` needed no change at all.
   */
  it('passes over a swing that never said it was a spell', () => {
    expect(selectorMatches(spellAttacks, CASTER, attackQuery())).toBe(false);
  });

  it('is still a rule about its holder’s own rolls', () => {
    expect(
      selectorMatches(spellAttacks, TARGET, attackQuery({ spellAttack: true })),
    ).toBe(false);
  });
});

describe('and narrowed again to the class the casting was made through', () => {
  const throughSorcerer: RollSelector = { ...spellAttacks, onlyThroughClass: 'sorcerer' };

  it('reaches a casting made through that class', () => {
    expect(
      selectorMatches(
        throughSorcerer,
        CASTER,
        attackQuery({ spellAttack: true, castThrough: 'sorcerer' }),
      ),
    ).toBe(true);
  });

  it('passes over the same caster’s other class', () => {
    expect(
      selectorMatches(
        throughSorcerer,
        CASTER,
        attackQuery({ spellAttack: true, castThrough: 'wizard' }),
      ),
    ).toBe(false);
  });

  /**
   * A feat's granted route, a stat block's declaration and an item's route
   * each name no class, and all three answer the same way: not this one.
   */
  it('passes over a casting made through no class at all', () => {
    expect(selectorMatches(throughSorcerer, CASTER, attackQuery({ spellAttack: true }))).toBe(
      false,
    );
  });

  /**
   * **The identity carries both**, for the reason Beacon of Hope's two
   * modifiers put the selector in the key: one source saying "your spell
   * attacks" and "your attacks" is two statements, and a key that could not
   * tell them apart would evict the first.
   */
  it('keys a narrowed modifier apart from an unnarrowed one', () => {
    const bare: RollSelector = { roll: 'attack', relation: 'roller' };
    expect(rollModifierKey('a feature', bare)).not.toBe(
      rollModifierKey('a feature', spellAttacks),
    );
    expect(rollModifierKey('a feature', spellAttacks)).not.toBe(
      rollModifierKey('a feature', throughSorcerer),
    );
    expect(rollModifierKey('a feature', throughSorcerer)).toBe(
      rollModifierKey('a feature', throughSorcerer),
    );
  });

  /**
   * **And every key nothing narrows is byte-identical to what it was**, which
   * is the property that keeps a persisted order still: `fold/grants.ts` sorts
   * `CreatureState.rollModifiers` by this key.
   *
   * A fixed empty tail appended to every key would *not* have that property,
   * and the pair below is why: before such a tail, the key whose last segment
   * is empty ends where the other one carries on and so sorts first; after it,
   * the comparison lands on `'|'` against a letter and the answer flips. So
   * the segment is written only by a selector that has one, and no key any log
   * already holds has moved.
   */
  it('leaves a key that narrows nothing exactly as it was', () => {
    const bare: RollSelector = { roll: 'attack', relation: 'roller' };
    expect(rollModifierKey('Vex', bare)).toBe('Vex|attack|roller||||||');
    const keyed: RollSelector = { roll: 'saving-throw', relation: 'roller', condition: 'charmed' };
    expect(rollModifierKey('Fey Ancestry', keyed)).toBe(
      'Fey Ancestry|saving-throw|roller||||||charmed',
    );
    // The pair whose order a fixed tail would have inverted, in the order the
    // fold has always put them.
    const unkeyed: RollSelector = { roll: 'saving-throw', relation: 'roller' };
    expect(
      [rollModifierKey('x', keyed), rollModifierKey('x', unkeyed)].sort(),
    ).toEqual([rollModifierKey('x', unkeyed), rollModifierKey('x', keyed)]);
  });
});

describe('what a selector may not say', () => {
  const problems = (selector: Parameters<typeof rollSelectorProblems>[0]) =>
    rollSelectorProblems(selector, (skill) => SKILL_ABILITY[skill]).map((one) => one.code);

  it('accepts the pair on an attack roll its holder makes', () => {
    expect(problems({ ...spellAttacks, onlyThroughClass: 'sorcerer' })).toEqual([]);
  });

  it('refuses a spell narrowing on a family that cannot carry it', () => {
    for (const roll of ['saving-throw', 'ability-check', 'initiative', 'death-save'] as const) {
      expect(problems({ roll, relation: 'roller', onlySpellAttacks: true })).toContain(
        'spell_attack_off_an_attack_roll',
      );
    }
  });

  it('refuses it on rolls made against the holder, where the caster is somebody else', () => {
    expect(problems({ roll: 'attack', relation: 'against-holder', onlySpellAttacks: true })).toContain(
      'spell_attack_off_the_roller',
    );
  });

  it('refuses anything but true, which is how every gate here is written', () => {
    expect(
      problems({
        ...spellAttacks,
        onlySpellAttacks: false as unknown as true,
      }),
    ).toContain('bad_spell_attack_gate');
  });

  /** A class is a fact a casting carries, so it cannot travel alone. */
  it('refuses a class narrowing with no spell beside it', () => {
    expect(
      problems({ roll: 'attack', relation: 'roller', onlyThroughClass: 'sorcerer' }),
    ).toContain('class_narrowing_without_a_spell');
  });
});

/**
 * The reader, on the axis the selector's twin is read on: which class a
 * casting was made through, and the three answers that are not one.
 */
describe('what a spell-save-dc-bonus adds, and to whose casting', () => {
  const holding = (grant: StandingGrant): GameState =>
    fold('seed', [
      {
        type: 'creature-added',
        id: CASTER,
        name: 'a caster',
        sheet: {
          level: 5,
          abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 16 },
          skills: {},
          saveProficiencies: [],
          armor: null,
          shield: null,
          armorTraining: { light: false, medium: false, heavy: false, shields: false },
          baseSpeed: 30,
          spellcastingAbility: 'cha',
          standing: [
            {
              feature: 'a-feature',
              name: 'A Feature',
              reach: { kind: 'self' },
              grant,
            },
          ],
        },
        maxHp: 30,
        diesAtZero: false,
        creatureType: 'Humanoid',
      } as GameEvent,
    ]);

  it('adds the flat number to a casting made through the class it names', () => {
    const state = holding({ kind: 'spell-save-dc-bonus', flat: 1, onlyThroughClass: 'sorcerer' });
    expect(standingSpellSaveDcBonus(state, CASTER, 'sorcerer')).toBe(1);
  });

  it('adds nothing to the same caster’s other class', () => {
    const state = holding({ kind: 'spell-save-dc-bonus', flat: 1, onlyThroughClass: 'sorcerer' });
    expect(standingSpellSaveDcBonus(state, CASTER, 'wizard')).toBe(0);
  });

  /**
   * A feat's granted route, a stat block's declaration and an item's are all
   * "through no class", and a narrowed bonus reaches none of them — which the
   * `wizard` case above cannot prove, because a null is not another class.
   */
  it('adds nothing to a casting made through no class at all', () => {
    const state = holding({ kind: 'spell-save-dc-bonus', flat: 1, onlyThroughClass: 'sorcerer' });
    expect(standingSpellSaveDcBonus(state, CASTER, null)).toBe(0);
  });

  /** An unnarrowed grant is the item's sentence, and reaches every casting. */
  it('reaches every route when it names no class', () => {
    const state = holding({ kind: 'spell-save-dc-bonus', flat: 2 });
    expect(standingSpellSaveDcBonus(state, CASTER, 'wizard')).toBe(2);
    expect(standingSpellSaveDcBonus(state, CASTER, null)).toBe(2);
  });

  /**
   * Two sentences on two pages are two bonuses; one **name** held twice is
   * one, at its most potent — the rule `standingCheckBonuses` already follows.
   */
  it('sums two features and keeps the best of one name', () => {
    const state = fold('seed', [
      {
        type: 'creature-added',
        id: CASTER,
        name: 'a caster',
        sheet: {
          level: 5,
          abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 16 },
          skills: {},
          saveProficiencies: [],
          armor: null,
          shield: null,
          armorTraining: { light: false, medium: false, heavy: false, shields: false },
          baseSpeed: 30,
          spellcastingAbility: 'cha',
          standing: [
            {
              feature: 'a-robe',
              name: 'A Robe',
              reach: { kind: 'self' },
              grant: { kind: 'spell-save-dc-bonus', flat: 2 },
            },
            {
              feature: 'a-feature',
              name: 'A Feature',
              reach: { kind: 'self' },
              grant: { kind: 'spell-save-dc-bonus', flat: 1 },
            },
            {
              feature: 'a-feature',
              name: 'A Feature',
              reach: { kind: 'self' },
              grant: { kind: 'spell-save-dc-bonus', flat: 3 },
            },
          ],
        },
        maxHp: 30,
        diesAtZero: false,
        creatureType: 'Humanoid',
      } as GameEvent,
    ]);
    expect(standingSpellSaveDcBonus(state, CASTER, null)).toBe(5);
  });
});

/**
 * The other half of the sentence, at the door a homebrew item or feature comes
 * through: a bonus that moves no DC, and a narrowing that could match nothing.
 */
describe('what a spell-save-dc-bonus grant may not say', () => {
  /** A well-formed magic item, so each case below changes exactly one thing. */
  const staffWith = (effect: Record<string, unknown>): unknown => ({
    id: 'staff-of-the-sharp-word',
    name: 'Staff of the Sharp Word',
    kind: 'wondrous',
    weightLb: 4,
    costCp: null,
    armor: null,
    weapon: null,
    contents: [],
    attunement: {},
    grants: [
      {
        kind: 'standing',
        reach: 'self',
        effects: [effect],
        requires: [{ kind: 'while-worn' }, { kind: 'while-attuned' }],
      },
    ],
  });

  const codesFor = (effect: Record<string, unknown>): readonly string[] =>
    checkContent({ items: [staffWith(effect) as never] }).map((problem) => problem.code);

  it('accepts the shape SRD Robe of the Archmagi prints', () => {
    expect(codesFor({ kind: 'spell-save-dc-bonus', flat: 2 })).toEqual([]);
  });

  it('refuses a bonus of nothing, which moves no saving throw', () => {
    expect(codesFor({ kind: 'spell-save-dc-bonus', flat: 0 })).toContain('bad_spell_save_dc_bonus');
  });

  it('refuses a bonus that is not a whole number of points', () => {
    expect(codesFor({ kind: 'spell-save-dc-bonus', flat: 1.5 })).toContain(
      'bad_spell_save_dc_bonus',
    );
  });

  it('refuses a class narrowing that is not a class id', () => {
    expect(codesFor({ kind: 'spell-save-dc-bonus', flat: 1, onlyThroughClass: '' })).toContain(
      'bad_spell_save_dc_bonus',
    );
  });
});
