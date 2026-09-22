import { describe, expect, it } from 'vitest';
import { checkContent } from './content.js';
import type { CatalogueItem } from './catalogue.js';
import type { ClassDefinition, FeatureGrant, PoolOptionGrant } from './progression.js';

/**
 * What a feature's pool options have to say, and what they may not.
 *
 * The rules are one consequence each of the casting's absence, and they are
 * the conferral's rules asked of the other host: a feature has no casting id
 * to weld a condition to, no slot level and no caster level for a `DiceScaling`
 * to read, and no `releaseCasting` to end what it hangs. What it does have and
 * an item does not is a **caster** — which is why "your spellcasting ability
 * modifier" is admitted here and refused on a bottle.
 *
 * Every case drives `checkContent` over untyped JSON, because that is the door
 * homebrew comes through and the compiler is not there for half of it.
 */

const OPTION: PoolOptionGrant = {
  id: 'rebuke',
  name: 'A Rebuke',
  action: 'action',
  reach: 30,
  effects: [{ kind: 'save', ability: 'wis', condition: 'frightened' }],
  durationSeconds: 60,
};

const TABLE = Array.from({ length: 20 }, (_, i) => ({
  level: i + 1,
  proficiencyBonus: 2 + Math.floor(i / 4),
}));

const clazz = (options: readonly unknown[]): unknown => ({
  id: 'warden',
  name: 'Warden',
  primaryAbility: 'wis',
  hitDie: 8,
  saveProficiencies: ['wis', 'cha'],
  skillChoices: { choose: 2, from: ['insight', 'perception'] },
  weaponProficiencies: ['simple'],
  armorTraining: { light: true, medium: false, heavy: false, shields: false },
  subclassLevel: 3,
  table: TABLE,
  startingEquipment: [{ option: 'A', items: [], goldPieces: 50 }],
  multiclass: {
    weapons: ['simple'],
    armorTraining: { light: true, medium: false, heavy: false, shields: false },
    tools: [],
  },
  features: [
    {
      id: 'warden:rebuke',
      name: 'Warden’s Rebuke',
      level: 1,
      automation: 'engine',
      note: 'A pool whose use confers an effect list.',
      grants: {
        kind: 'pool',
        key: 'rebuke',
        label: 'Warden’s Rebuke',
        usesByLevel: Array.from({ length: 20 }, () => 3),
        recovers: 'long-rest',
        options,
      },
    },
  ],
});

/** Every code, at every path, so a repair is told which field it broke. */
const codesFor = (options: readonly unknown[]): readonly string[] =>
  checkContent({ classes: [clazz(options) as ClassDefinition] }).map(
    (problem) => `${problem.code} @ ${problem.field}`,
  );

const withOption = (over: Record<string, unknown>): readonly unknown[] => [{ ...OPTION, ...over }];

describe('a feature’s pool options are judged before anything is built', () => {
  /** Non-vacuous: the shape the Cleric's own menu takes is admitted whole. */
  it('admits a well-formed option', () => {
    expect(codesFor([OPTION])).toEqual([]);
  });

  it('admits an area option that filters by creature type', () => {
    expect(
      codesFor(
        withOption({
          reach: undefined,
          area: { kind: 'emanation', distance: 30, origin: 'self' },
          mustBeType: 'Undead',
        }),
      ),
    ).toEqual([]);
  });

  /**
   * "Your spellcasting ability modifier" is the **holder's**, and a feature
   * has one where an item has none — `conferral_has_no_caster` refuses this
   * on a bottle for exactly the reason it is admitted here.
   */
  it('admits the spellcasting modifier an item is refused', () => {
    expect(
      codesFor(
        withOption({
          durationSeconds: undefined,
          effects: [{ kind: 'heal', healing: { dice: '1d8' }, addSpellcastingModifier: true }],
        }),
      ),
    ).toEqual([]);
  });

  /** And the plural sentence SRD Turn Undead prints, which an item may not. */
  it('admits the several conditions one saving throw imposes', () => {
    expect(
      codesFor(
        withOption({
          effects: [
            {
              kind: 'save',
              ability: 'wis',
              condition: 'frightened',
              conditions: [{ name: 'incapacitated' }],
            },
          ],
        }),
      ),
    ).toEqual([]);
  });
});

describe('what a feature’s option may not say', () => {
  it('refuses an effect kind that needs the casting a feature has not got', () => {
    expect(
      codesFor(
        withOption({
          durationSeconds: undefined,
          effects: [{ kind: 'attack', attack: 'ranged', damage: { dice: '1d8' }, damageType: 'fire' }],
        }),
      ),
    ).toContain('feature_effect_not_read @ classes[warden].features[0].grants.options[0].effects[0].kind');
  });

  it('refuses a rider lifetime, which the casting owns', () => {
    expect(
      codesFor(
        withOption({
          effects: [
            {
              kind: 'save',
              ability: 'wis',
              condition: 'frightened',
              lasts: 'end-of-casters-next-turn',
            },
          ],
        }),
      ),
    ).toContain(
      'feature_condition_needs_a_casting @ classes[warden].features[0].grants.options[0].effects[0].lasts',
    );
  });

  it('refuses the same field inside one of the further conditions', () => {
    expect(
      codesFor(
        withOption({
          effects: [
            {
              kind: 'save',
              ability: 'wis',
              condition: 'frightened',
              conditions: [{ name: 'incapacitated', outlivesCasting: true }],
            },
          ],
        }),
      ),
    ).toContain(
      'feature_condition_needs_a_casting @ classes[warden].features[0].grants.options[0].effects[0].conditions[0].outlivesCasting',
    );
  });

  it('refuses a repeat whose success would end a casting', () => {
    expect(
      codesFor(
        withOption({
          effects: [
            {
              kind: 'save',
              ability: 'wis',
              condition: 'frightened',
              repeats: { at: 'end-of-turn', onSuccess: 'end-casting' },
            },
          ],
        }),
      ),
    ).toContain(
      'feature_repeat_needs_a_casting @ classes[warden].features[0].grants.options[0].effects[0].repeats.onSuccess',
    );
  });

  /**
   * **And at the second door, which is the one a feature opened.** A conferral
   * hangs one condition and its repeat is the host's own flat field; a feature
   * hangs the several SRD Turn Undead prints, so a *further* rider may carry a
   * repeat of its own and reach `repeatSaveFrom` through `conditionRiderOf`.
   * A rule enforced at one of two doors is a rule with a hole in it.
   */
  it('refuses the same repeat written on one of the further conditions', () => {
    expect(
      codesFor(
        withOption({
          effects: [
            {
              kind: 'save',
              ability: 'wis',
              condition: 'frightened',
              conditions: [
                {
                  name: 'incapacitated',
                  repeats: { at: 'end-of-turn', onSuccess: 'end-casting' },
                },
              ],
            },
          ],
        }),
      ),
    ).toContain(
      'feature_repeat_needs_a_casting @ classes[warden].features[0].grants.options[0].effects[0].conditions[0].repeats.onSuccess',
    );
  });

  /** And admits the spelling a feature *can* mean: a success ends it there. */
  it('admits a repeat whose success ends the condition on its target', () => {
    expect(
      codesFor(
        withOption({
          effects: [
            {
              kind: 'save',
              ability: 'wis',
              condition: 'frightened',
              conditions: [
                {
                  name: 'incapacitated',
                  repeats: { at: 'end-of-turn', onSuccess: 'end-on-target' },
                },
              ],
            },
          ],
        }),
      ),
    ).toEqual([]);
  });

  it('refuses a granted modifier, which is welded to the casting that hung it', () => {
    expect(
      codesFor(
        withOption({
          effects: [
            {
              kind: 'save',
              ability: 'wis',
              condition: 'frightened',
              modifiers: [
                {
                  kind: 'speed-change',
                  change: 'add',
                  feet: -10,
                  lasts: 'start-of-casters-next-turn',
                },
              ],
            },
          ],
        }),
      ).filter((code) => code.startsWith('feature_rider_needs_a_casting')),
    ).toEqual([
      'feature_rider_needs_a_casting @ classes[warden].features[0].grants.options[0].effects[0].modifiers',
    ]);
  });

  /**
   * A verdict is written onto the casting that threw the save, and a pool use
   * casts nothing.
   *
   * `save.recordsOutcome` is the third thing a save may do beside imposing a
   * condition and hanging a rider — SRD Zone of Truth's "You know whether a
   * creature succeeds or fails on this save" — and what it writes is
   * `OngoingSpell.saves`, the record of a *running casting*. A feature's use
   * has no casting id and no ongoing record, so the field would be set and
   * read by nobody: the quiet wrong answer this file exists to refuse.
   */
  it('refuses a recorded verdict, because a feature keeps one on nothing', () => {
    expect(
      codesFor(
        withOption({
          effects: [{ kind: 'save', ability: 'cha', condition: 'frightened', recordsOutcome: true }],
        }),
      ).filter((code) => code.startsWith('feature_verdict_needs_a_casting')),
    ).toEqual([
      'feature_verdict_needs_a_casting @ classes[warden].features[0].grants.options[0].effects[0].recordsOutcome',
    ]);
  });

  /** A slot level and a caster level are both things a feature has none of. */
  it('refuses scaling that reads a level nothing here has', () => {
    expect(
      codesFor(
        withOption({
          durationSeconds: undefined,
          effects: [
            {
              kind: 'heal',
              healing: { dice: '1d8', perSlotLevelAbove: '1d8' },
              addSpellcastingModifier: false,
            },
          ],
        }),
      ),
    ).toContain(
      'feature_scales_with_a_casting @ classes[warden].features[0].grants.options[0].effects[0].healing.perSlotLevelAbove',
    );
  });

  /** And admits the one that reads a class table instead, which is the point. */
  it('admits the class-table scaling that replaces it', () => {
    expect(
      codesFor(
        withOption({
          durationSeconds: undefined,
          effects: [{ kind: 'heal', healing: { dice: '1d8' }, addSpellcastingModifier: true }],
          diceCountByLevel: Array.from({ length: 20 }, () => 2),
        }),
      ),
    ).toEqual([]);
  });

  it('refuses a class-table column of the wrong length', () => {
    expect(
      codesFor(
        withOption({
          durationSeconds: undefined,
          effects: [{ kind: 'heal', healing: { dice: '1d8' }, addSpellcastingModifier: true }],
          diceCountByLevel: [1, 2],
        }),
      ),
    ).toContain(
      'bad_option_dice_column @ classes[warden].features[0].grants.options[0].diceCountByLevel',
    );
  });

  it('refuses a condition hung with no span to end it', () => {
    expect(codesFor(withOption({ durationSeconds: undefined }))).toContain(
      'feature_option_without_lifetime @ classes[warden].features[0].grants.options[0].durationSeconds',
    );
  });

  it('refuses a span over an option that leaves nothing behind', () => {
    expect(
      codesFor(
        withOption({
          effects: [{ kind: 'heal', healing: { dice: '1d8' }, addSpellcastingModifier: false }],
        }),
      ),
    ).toContain(
      'feature_option_lifetime_ends_nothing @ classes[warden].features[0].grants.options[0].durationSeconds',
    );
  });

  it('refuses an option that both fills an area and reaches a target', () => {
    expect(
      codesFor(withOption({ area: { kind: 'emanation', distance: 30, origin: 'self' } })),
    ).toContain(
      'feature_option_reaches_twice @ classes[warden].features[0].grants.options[0].area',
    );
  });

  it('refuses a creature-type filter with no area to filter', () => {
    expect(codesFor(withOption({ mustBeType: 'Undead' }))).toContain(
      'feature_option_type_without_area @ classes[warden].features[0].grants.options[0].mustBeType',
    );
  });

  it('refuses two options of one feature sharing an id', () => {
    expect(codesFor([OPTION, { ...OPTION, name: 'Another' }])).toContain(
      'duplicate_feature_option @ classes[warden].features[0].grants.options[1].id',
    );
  });

  it('refuses a damage-type choice nothing on the list would answer to', () => {
    expect(
      codesFor(
        withOption({
          durationSeconds: undefined,
          effects: [{ kind: 'heal', healing: { dice: '1d8' }, addSpellcastingModifier: false }],
          damageTypeStated: ['necrotic', 'radiant'],
        }),
      ),
    ).toContain(
      'feature_option_type_choice_reaches_nothing @ classes[warden].features[0].grants.options[0].damageTypeStated',
    );
  });

  it('refuses an option that confers an empty list', () => {
    expect(codesFor(withOption({ durationSeconds: undefined, effects: [] }))).toContain(
      'empty_feature_option @ classes[warden].features[0].grants.options[0].effects',
    );
  });
});

/**
 * And the mirror of `item_sizing_on_a_feature`: a menu belongs to a feature,
 * because what pays for it is a feature's pool use and what its numbers come
 * from is a sheet. An item's charges are spent by `expendCharges` and what a
 * charge buys is its own `casts` or `confers` grant.
 */
describe('an item may not carry a feature’s options', () => {
  const ITEM: unknown = {
    id: 'rod-of-menus',
    name: 'Rod of Menus',
    kind: 'wondrous',
    weightLb: 2,
    costCp: null,
    armor: null,
    weapon: null,
    contents: [],
    grants: [
      {
        kind: 'pool',
        key: 'rod-of-menus',
        label: 'charges',
        uses: 3,
        recovers: 'dawn',
        options: [OPTION as unknown as FeatureGrant],
      },
    ],
  };

  it('refuses the menu, by name and at its own path', () => {
    expect(
      checkContent({ items: [ITEM as CatalogueItem] }).map(
        (problem) => `${problem.code} @ ${problem.field}`,
      ),
    ).toContain('feature_options_on_an_item @ items[rod-of-menus].grants[0].options');
  });
});
