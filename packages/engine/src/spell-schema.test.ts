import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isErr } from '@ie/shared';
import { SPELL_DEFINITIONS, type SpellDefinition } from './spell-definitions.js';
import {
  checkSpellDefinition,
  checkSpellDefinitionValue,
  EFFECT_KINDS,
  parseSpellDefinition,
  RIDER_KINDS,
  type SpellDefinitionProblem,
} from './spell-schema.js';

/**
 * The validator, driven from both ends.
 *
 * Two obligations, and the second is the one that makes the first mean
 * anything:
 *
 * - **every definition in the catalogue passes**, so the rules are the ones
 *   the content already obeys rather than an opinion imposed on it;
 * - **each rule refuses something**, driven one at a time, so a rule that
 *   stopped firing is a failure rather than a quiet exemption.
 *
 * And a third that is the point of the whole layer: **a spell the SRD never
 * printed validates exactly as well.** Schema validity is not SRD conformance
 * — `spell-oracle.test.ts` is the other question — and a definition format
 * that could only express official content would be an authorship dead end.
 */

const codes = (problems: readonly SpellDefinitionProblem[]): readonly string[] =>
  problems.map((p) => p.code);

/** A minimal definition that passes, to mutate one field of at a time. */
const FIRE_DART: SpellDefinition = {
  id: 'fire-dart',
  name: 'Fire Dart',
  level: 1,
  school: 'evocation',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 1 },
  effects: [
    {
      kind: 'attack',
      attack: 'ranged',
      damage: { dice: '2d6', perSlotLevelAbove: '1d6' },
      damageType: 'fire',
    },
  ],
};

describe('every definition the engine ships is coherent', () => {
  it.each(SPELL_DEFINITIONS.map((d) => [d.id, d] as const))(
    'accepts %s',
    (id, definition) => {
      expect(checkSpellDefinition(definition), id).toEqual([]);
    },
  );

  it('has a catalogue worth sweeping', () => {
    expect(SPELL_DEFINITIONS.length).toBeGreaterThan(100);
  });

  /**
   * Every effect kind the catalogue uses survives the untyped path too.
   *
   * `checkShape` is the one place a runtime value restates the union, and the
   * way it rots is a new member being added to the type and not to the set —
   * at which point every definition using it is rejected as unknown by a
   * loader while compiling perfectly. Driving the whole catalogue through
   * `parseSpellDefinition` is what catches that.
   */
  it.each(SPELL_DEFINITIONS.map((d) => [d.id, d] as const))(
    'parses %s as untyped data',
    (id, definition) => {
      const parsed = parseSpellDefinition(JSON.parse(JSON.stringify(definition)));
      expect(isErr(parsed) ? parsed.reason : 'ok', id).toBe('ok');
    },
  );
});

describe('a definition that is not in the SRD is still valid engine data', () => {
  /**
   * The homebrew case, stated as a test rather than as an intention.
   *
   * Nothing about `checkSpellDefinition` consults the parsed book, and this is
   * what that buys: a DM's invented spell — a name the SRD has never heard of,
   * a shape it never printed — is coherent engine data. The oracle would
   * refuse it, correctly, because it is not a spell the book prints. Those are
   * different answers to different questions and both of them are right.
   */
  const WITCH_BOLT_OF_THE_NINE: SpellDefinition = {
    id: 'ninefold-hex',
    name: 'Ninefold Hex',
    level: 4,
    school: 'necromancy',
    castingTime: 'action',
    concentration: true,
    range: { kind: 'ranged', feet: 90 },
    targets: { count: 3, extraPerSlotLevelAbove: 1 },
    effects: [
      {
        kind: 'save-damage',
        ability: 'con',
        damage: { dice: '4d10', perSlotLevelAbove: '1d10' },
        damageType: 'necrotic',
        onSuccess: 'half',
        conditions: [{ name: 'poisoned' }],
      },
    ],
    durationSeconds: 60,
  };

  it('validates a spell the book never printed', () => {
    expect(checkSpellDefinition(WITCH_BOLT_OF_THE_NINE)).toEqual([]);
    expect(isErr(parseSpellDefinition(WITCH_BOLT_OF_THE_NINE))).toBe(false);
  });

  it('is not in the parsed SRD, so the oracle is a separate question', () => {
    const book = JSON.parse(
      readFileSync(
        fileURLToPath(new URL('../../srd/src/generated/spells.json', import.meta.url)),
        'utf8',
      ),
    ) as readonly { id: string }[];
    expect(book.some((spell) => spell.id === WITCH_BOLT_OF_THE_NINE.id)).toBe(false);
  });

  /** An authored area may state the footprint convention it wants. */
  it('lets an authored area declare its anchoring', () => {
    const glacial: SpellDefinition = {
      ...WITCH_BOLT_OF_THE_NINE,
      id: 'glacial-bloom',
      name: 'Glacial Bloom',
      targets: { count: 0 },
      area: { kind: 'sphere', radius: 20, origin: 'point' },
      anchoring: 'intersection',
      effects: [
        {
          kind: 'save-damage',
          ability: 'dex',
          damage: { dice: '6d6' },
          damageType: 'cold',
          onSuccess: 'half',
        },
      ],
    };
    expect(checkSpellDefinition(glacial)).toEqual([]);
  });
});

describe('the shape is checked before the semantics', () => {
  it('refuses something that is not a definition at all', () => {
    for (const value of [null, 42, 'fireball', ['fireball']]) {
      const out = parseSpellDefinition(value);
      expect(isErr(out)).toBe(true);
      if (isErr(out)) expect(out.code).toBe('not_a_definition');
    }
  });

  it('names every missing field, not just the first', () => {
    expect(codes(checkSpellDefinitionValue({}))).toEqual([
      'missing_field',
      'missing_field',
      'missing_field',
      'missing_field',
      'missing_field',
      'missing_field',
      'missing_field',
      'missing_field',
      'missing_field',
    ]);
  });

  it('refuses an effect kind the engine does not resolve', () => {
    const out = checkSpellDefinitionValue({
      ...FIRE_DART,
      effects: [{ kind: 'summon-dragon' }],
    });
    expect(codes(out)).toEqual(['unknown_effect']);
  });

  /**
   * A field this engine has never heard of is **not** an error. A definition
   * written against a later version is data this one does not understand
   * rather than data that is wrong, and refusing it would make every schema
   * addition a breaking change for stored content.
   */
  it('ignores a field it does not know', () => {
    expect(checkSpellDefinitionValue({ ...FIRE_DART, ritualVariant: true })).toEqual([]);
  });
});

describe('each rule refuses something', () => {
  const only = (over: Partial<Record<string, unknown>>): readonly string[] =>
    codes(checkSpellDefinition({ ...FIRE_DART, ...over } as SpellDefinition));

  it('refuses an id that is not a slug', () => {
    expect(only({ id: 'Fire Dart' })).toEqual(['bad_id']);
  });

  /**
   * The forged casting link, and it is the one rule here that is a security
   * property rather than a tidiness one: `castingSource` writes
   * `Hold Person#cast:3` and `castingIdOf` reads it back, so a `#` in a name
   * lets a definition attach its effects to somebody else's casting — or
   * detach its own from cleanup.
   */
  it('refuses a name that would forge a casting link', () => {
    expect(only({ name: 'Fire Dart#cast:1' })).toEqual(['forged_casting_link']);
  });

  it('refuses a level the game does not have', () => {
    expect(only({ level: 10 })).toEqual(['bad_level']);
    expect(only({ level: -1 })).toEqual(['bad_level']);
  });

  it('refuses a school of magic that is not one', () => {
    expect(only({ school: 'chronomancy' })).toEqual(['unknown_school']);
  });

  it('refuses a damage type outside the SRD thirteen', () => {
    expect(
      only({
        effects: [
          { kind: 'attack', attack: 'ranged', damage: { dice: '2d6' }, damageType: 'sonic' },
        ],
      }),
    ).toEqual(['unknown_damage_type']);
  });

  it('refuses dice that are not notation', () => {
    expect(
      only({
        effects: [
          { kind: 'attack', attack: 'ranged', damage: { dice: 'two d six' }, damageType: 'fire' },
        ],
      }),
    ).toEqual(['bad_dice']);
  });

  /**
   * The mistake this repository has actually made, in both directions. A
   * cantrip scales with the caster and a levelled spell with its slot;
   * `scaledDiceFor` takes one branch or the other and silently ignores the
   * field belonging to the one it did not take.
   */
  it('refuses slot scaling on a cantrip', () => {
    expect(
      only({
        level: 0,
        effects: [
          {
            kind: 'attack',
            attack: 'ranged',
            damage: { dice: '1d10', perSlotLevelAbove: '1d10' },
            damageType: 'fire',
          },
        ],
      }),
    ).toEqual(['slot_scaling_on_cantrip']);
  });

  it('refuses a Cantrip Upgrade on a levelled spell', () => {
    expect(
      only({
        effects: [
          {
            kind: 'attack',
            attack: 'ranged',
            damage: { dice: '2d6', cantripUpgradesAt: [5, 11, 17] },
            damageType: 'fire',
          },
        ],
      }),
    ).toEqual(['cantrip_scaling_on_spell']);
  });

  it('refuses an area and a bounded target list at once', () => {
    expect(
      only({
        area: { kind: 'sphere', radius: 20, origin: 'point' },
        targetsWithin: { kind: 'sphere', radius: 30, origin: 'point' },
      }),
    ).toEqual(['area_and_targets_within']);
  });

  it('refuses a persistent trigger with no area to be persistent in', () => {
    expect(
      only({
        areaTrigger: { at: 'end-of-turn', effects: FIRE_DART.effects, label: 'Fire Dart' },
      }),
    ).toEqual(['trigger_without_area']);
  });

  it('refuses a trigger that resolves nothing', () => {
    expect(
      only({
        targets: { count: 0 },
        area: { kind: 'sphere', radius: 20, origin: 'point' },
        areaTrigger: { at: 'end-of-turn', effects: [], label: 'Fire Dart' },
      }),
    ).toEqual(['trigger_does_nothing']);
  });

  // — the geometry carried forward ————————————————————————————————————————

  it('refuses anchoring on a spell with no template', () => {
    expect(only({ anchoring: 'intersection' })).toEqual(['anchoring_without_area']);
  });

  /**
   * A `self` origin is a creature's own space, and a creature does not stand
   * on a grid intersection. The same refusal `placeArea` makes on the request,
   * moved to where a definition meets it.
   */
  it('refuses anchoring on an area that starts at the caster', () => {
    expect(
      only({
        targets: { count: 0 },
        area: { kind: 'cone', length: 15, origin: 'self' },
        anchoring: 'intersection',
      }),
    ).toEqual(['anchoring_on_self_area']);
  });

  it('accepts anchoring on a point-origin template', () => {
    expect(
      only({
        targets: { count: 0 },
        area: { kind: 'sphere', radius: 20, origin: 'point' },
        anchoring: 'intersection',
      }),
    ).toEqual([]);
    expect(
      only({
        area: { kind: 'sphere', radius: 20, origin: 'point' },
        anchoring: 'space',
      }),
    ).toEqual([]);
  });

  it('refuses designating creatures unaffected by nothing', () => {
    expect(only({ designatesUnaffected: true })).toEqual(['unaffected_without_area']);
  });

  it('refuses a stated damage type that offers no choice', () => {
    expect(only({ damageTypeStated: ['fire'] })).toEqual(['stated_damage_type_needs_choice']);
    expect(only({ damageTypeStated: ['fire', 'quantum'] })).toEqual(['unknown_damage_type']);
  });

  // — duration ————————————————————————————————————————————————————————————

  it('refuses a spell that lasts two ways at once', () => {
    expect(only({ durationSeconds: 60, durationUntil: 'end-of-casters-next-turn' })).toEqual([
      'two_durations',
    ]);
  });

  it('refuses Concentration with nothing to concentrate on', () => {
    expect(only({ concentration: true })).toEqual(['concentration_without_duration']);
  });

  it('refuses a check against a casting that leaves nothing standing', () => {
    expect(only({ check: { ability: 'int', onSuccess: 'none' } })).toEqual([
      'check_without_duration',
    ]);
  });

  // — the Reaction clause —————————————————————————————————————————————————

  it('refuses a trigger on a spell that is not a Reaction', () => {
    expect(only({ trigger: 'hit-by-attack' })).toEqual(['trigger_without_reaction']);
  });

  it('refuses a Reaction whose moment nobody named', () => {
    expect(only({ castingTime: 'reaction' })).toEqual(['reaction_without_trigger']);
  });

  // — what it does ————————————————————————————————————————————————————————

  it('refuses a spell that resolves nothing and explains nothing', () => {
    expect(only({ effects: [] })).toEqual(['silent_gap']);
  });

  it('accepts a tracked spell that says what the DM does', () => {
    expect(only({ effects: [], unmodelled: ['the illusion is the DM’s'] })).toEqual([]);
  });

  it('refuses a bonus that applies to no roll', () => {
    expect(
      only({
        durationSeconds: 60,
        effects: [
          {
            kind: 'buff',
            bonus: { source: 'Fire Dart', flat: 1 },
            applies: [],
            direction: 'add',
          },
        ],
      }),
    ).toEqual(['bonus_applies_to_nothing']);
  });

  /**
   * An Armour Class is a standing number rather than an event, so there is no
   * moment at which a die could be thrown for one — `armorClassOf` reads the
   * flat half and nothing else. A rolled bonus aimed at `ac` is data nothing
   * can apply, silently, which is the whole reason it is refused rather than
   * ignored.
   */
  it('refuses a rolled bonus to an Armour Class', () => {
    expect(
      only({
        durationSeconds: 60,
        effects: [
          {
            kind: 'buff',
            bonus: { source: 'Fire Dart', dice: '1d4' },
            applies: ['ac'],
            direction: 'add',
          },
        ],
      }),
    ).toEqual(['rolled_armor_class']);
  });

  it('refuses an unlimited target rule that also states a number', () => {
    expect(only({ targets: { count: 3, unlimited: true } })).toEqual(['unlimited_with_count']);
  });

  it('refuses an activation that measures from two places', () => {
    expect(
      only({
        durationSeconds: 60,
        origin: { reach: 5 },
        activation: {
          action: 'action',
          range: { kind: 'touch' },
          label: 'Fire Dart (again)',
          effects: FIRE_DART.effects,
        },
      }),
    ).toEqual(['activation_range_and_origin']);
  });

  it('refuses an activation that spends an action on nothing', () => {
    expect(
      only({
        durationSeconds: 60,
        origin: { reach: 5 },
        activation: { action: 'action', label: 'Fire Dart (again)', effects: [] },
      }),
    ).toEqual(['activation_does_nothing']);
  });

  it('refuses an action that moves an area the spell does not have', () => {
    expect(
      only({
        durationSeconds: 60,
        activation: {
          action: 'action',
          movesArea: 60,
          label: 'Fire Dart (again)',
          effects: [],
        },
      }),
    ).toEqual(['moves_area_without_area']);
  });

  it('refuses a later action through a casting that does not last', () => {
    expect(
      only({
        origin: { reach: 5 },
        activation: {
          action: 'action',
          label: 'Fire Dart (again)',
          effects: FIRE_DART.effects,
        },
      }),
    ).toEqual(['activation_without_duration']);
  });

  it('refuses a point the casting keeps alongside a template it fills', () => {
    expect(
      only({
        targets: { count: 0 },
        area: { kind: 'sphere', radius: 20, origin: 'point' },
        origin: { reach: 5 },
      }),
    ).toEqual(['origin_and_area']);
  });

  it('refuses a base Armour Class that is not a number a creature could have', () => {
    expect(
      only({
        durationSeconds: 60,
        effects: [{ kind: 'armor-class', base: 0, plusAbility: 'dex', shieldAllowed: true }],
      }),
    ).toEqual(['bad_armor_class']);
  });

  // — a grant with no lifetime ————————————————————————————————————————————
  //
  // See the `describe` below: driven one carrier at a time, because the rule
  // is about four different things a definition can hang on a casting.

  // — what a check may say ————————————————————————————————————————————————

  /**
   * Each of these names the field it belongs to, not merely the spell.
   *
   * A `SpellCheck` is four fields two and three deep, and a code with no path
   * points an author at a definition rather than at a line — the reason
   * `SpellDefinitionProblem` carries one at all. Which *carrier's* path is a
   * separate rule and is driven in its own block below.
   */
  const checkProblem = (check: unknown): readonly [string, string] => {
    const found = checkSpellDefinition({
      ...FIRE_DART,
      durationSeconds: 60,
      check,
    } as SpellDefinition);
    expect(found).toHaveLength(1);
    return [found[0]!.code, found[0]!.field];
  };

  it('refuses a check keyed to something that is not an ability', () => {
    expect(checkProblem({ ability: 'luck', onSuccess: 'none' })).toEqual([
      'bad_ability',
      'check.ability',
    ]);
  });

  it('refuses a check naming a skill the game does not have', () => {
    expect(checkProblem({ ability: 'int', skill: 'lockpicking', onSuccess: 'none' })).toEqual([
      'bad_skill',
      'check.skill',
    ]);
  });

  /**
   * The one that could be written and could not be right.
   *
   * SRD always prints a check as "Intelligence (Investigation)" — the ability
   * the skill belongs to, in front of the skill. A pair that disagrees rolls
   * one ability's modifier against the other's proficiency, which is not a
   * check the book has, and nothing downstream would notice: `rollAbilityCheck`
   * reads `ability` for the modifier and `skill` for proficiency and is right
   * to trust both.
   */
  it('refuses a skill that does not belong to the ability beside it', () => {
    expect(checkProblem({ ability: 'int', skill: 'athletics', onSuccess: 'none' })).toEqual([
      'skill_ability_mismatch',
      'check.skill',
    ]);
  });

  it('refuses a check whose success does something the engine cannot do', () => {
    expect(checkProblem({ ability: 'int', onSuccess: 'end-casting' })).toEqual([
      'bad_check_outcome',
      'check.onSuccess',
    ]);
  });

  /**
   * A printed DC is a number a creature could roll against. Zero is not one,
   * and a fraction is not one either — `EffectCheck.dc` is compared against a
   * total, so a DC of 12.5 is a threshold no die can land on.
   */
  it('refuses a printed DC that is not a whole number worth beating', () => {
    expect(checkProblem({ ability: 'int', dc: 0, onSuccess: 'none' })).toEqual([
      'bad_check_dc',
      'check.dc',
    ]);
    expect(checkProblem({ ability: 'int', dc: 12.5, onSuccess: 'none' })).toEqual([
      'bad_check_dc',
      'check.dc',
    ]);
  });

  /** And SRD Maze's own numbers pass, which is what the rule has to allow. */
  it('accepts the check SRD Maze prints', () => {
    expect(
      only({
        durationSeconds: 600,
        check: { ability: 'int', skill: 'investigation', dc: 20, onSuccess: 'none' },
      }),
    ).toEqual([]);
  });
});

/**
 * A check is checked wherever it sits, and **the path says which spelling**.
 *
 * Three places carry a {@link SpellCheck} and the definition's own is the
 * *rarest*: every check in the catalogue today is a rider's — Web's and Black
 * Tentacles' escape, Disguise Self's Investigation. Driving only
 * `definition.check` would leave the reader that matters untested, and
 * deleting the rider's call would pass a whole suite.
 *
 * And the path is half the rule. `save` writes its rider flat, so its check is
 * at `effects[0].check`; every other carrier nests it at
 * `effects[0].condition.check`. A problem reported at the wrong one points an
 * author at a field their definition does not have, which is the exact reason
 * `checkConditionRider` takes both paths from its caller rather than appending
 * a suffix of its own.
 */
describe('a check is checked wherever a definition writes one', () => {
  const problems = (effect: unknown): readonly SpellDefinitionProblem[] =>
    checkSpellDefinition({
      ...FIRE_DART,
      durationSeconds: 60,
      effects: [effect],
    } as SpellDefinition);

  // One bad check, written into every layout a rider has: the two hosts that
  // nest one, the kind whose rider *is* the effect, the flat spelling `save`
  // keeps, and the extra riders a `save` carries beside it. The path differs
  // in every one of them, which is what proves it is one rule rather than
  // five spelled alike.
  const BAD = { ability: 'int', skill: 'athletics', onSuccess: 'none' } as const;

  it.each([
    [
      'a condition rider',
      { kind: 'condition', condition: { name: 'restrained', check: BAD } },
      'effects[0].condition.check.skill',
    ],
    [
      "an attack's rider",
      {
        kind: 'attack',
        attack: 'ranged',
        damage: { dice: '2d6' },
        damageType: 'fire',
        conditions: [{ name: 'restrained', check: BAD }],
      },
      'effects[0].conditions[0].check.skill',
    ],
    [
      "a save-damage's rider",
      {
        kind: 'save-damage',
        ability: 'dex',
        damage: { dice: '2d6' },
        damageType: 'fire',
        onSuccess: 'none',
        conditions: [{ name: 'restrained', check: BAD }],
      },
      'effects[0].conditions[0].check.skill',
    ],
    [
      "a save's second rider",
      {
        kind: 'save',
        ability: 'dex',
        condition: 'prone',
        conditions: [{ name: 'restrained', check: BAD }],
      },
      'effects[0].conditions[0].check.skill',
    ],
    [
      "a save's flat check",
      { kind: 'save', ability: 'dex', condition: 'restrained', check: BAD },
      'effects[0].check.skill',
    ],
  ] as const)('refuses a mismatched skill on %s, at the path that carrier wrote', (
    _where,
    effect,
    field,
  ) => {
    expect(problems(effect)).toEqual([
      {
        field,
        code: 'skill_ability_mismatch',
        reason:
          'SRD writes a check as "Intelligence (Investigation)"; athletics is a str skill and this names int',
      },
    ]);
  });

  /** And every field of the rule reaches a rider, not merely the mismatch. */
  it.each([
    ['an ability the game does not have', { ability: 'luck', onSuccess: 'none' }, 'bad_ability'],
    ['a skill it does not have', { ability: 'int', skill: 'lockpicking', onSuccess: 'none' }, 'bad_skill'],
    ['a DC nothing could beat', { ability: 'int', dc: 0, onSuccess: 'none' }, 'bad_check_dc'],
    ['an outcome it cannot do', { ability: 'int', onSuccess: 'end-casting' }, 'bad_check_outcome'],
  ] as const)('refuses %s on a rider’s check', (_what, check, code) => {
    expect(
      codes(problems({ kind: 'condition', condition: { name: 'restrained', check } })),
    ).toEqual([code]);
  });

  /** The definition's own check reports at its own path too. */
  it('points at the definition’s own check when that is where it sits', () => {
    const found = checkSpellDefinition({
      ...FIRE_DART,
      durationSeconds: 60,
      check: { ability: 'int', skill: 'athletics', onSuccess: 'none' },
    } as SpellDefinition);
    expect(found.map((p) => p.field)).toEqual(['check.skill']);
  });

  /** And the rider checks the catalogue really writes are all still fine. */
  it('accepts every check the catalogue writes', () => {
    for (const definition of SPELL_DEFINITIONS) {
      expect(
        checkSpellDefinition(definition).filter((p) => p.field.includes('check')),
        definition.id,
      ).toEqual([]);
    }
  });
});

/**
 * A removal that removes nothing, which is the same rule with no fix attached.
 *
 * Both catalogue definitions that end a condition name a list the SRD prints,
 * so neither rule fires and **the only way to know either is a guard at all is
 * to build something that fails it by hand** — the sentence the section below
 * already carries, arriving a second time.
 *
 * They guard two different mistakes and both compile. An **empty** list is the
 * `resolves_nothing` error arriving one level down: a definition that claims to
 * end a condition and ends none. A **repeated** one writes two sourceless
 * `condition-removed` events for one name, and the second has nothing left to
 * take away — the log recording something that did not happen, which is the
 * same thing `duplicate_condition` refuses a Paladin who names one twice and
 * would otherwise be charged five hit points for it twice.
 */
describe('a spell that ends a condition ends a real one, once', () => {
  const only = (effect: unknown): readonly string[] =>
    codes(checkSpellDefinition({ ...FIRE_DART, effects: [effect] } as SpellDefinition));

  it('refuses a removal that names no condition', () => {
    expect(only({ kind: 'end-condition', conditions: [] })).toEqual(['ends_nothing']);
  });

  it('refuses the same condition twice', () => {
    expect(only({ kind: 'end-condition', conditions: ['poisoned', 'poisoned'] })).toEqual([
      'duplicate_condition',
    ]);
  });

  /** And it says *which* entry is the repeat, so an author can find it. */
  it('names the repeated entry rather than the list', () => {
    const problems = checkSpellDefinition({
      ...FIRE_DART,
      effects: [{ kind: 'end-condition', conditions: ['blinded', 'poisoned', 'blinded'] }],
    } as unknown as SpellDefinition);
    expect(problems.map((p) => p.field)).toEqual(['effects[0].conditions[2]']);
  });

  /** A name the SRD does not print is not a condition, wherever it is written. */
  it('refuses a condition the SRD does not have', () => {
    expect(only({ kind: 'end-condition', conditions: ['cursed'] })).toEqual(['unknown_condition']);
  });

  /** Several distinct conditions are Heal's own sentence, and are accepted. */
  it('accepts the plural sentence the SRD writes', () => {
    expect(only({ kind: 'end-condition', conditions: ['blinded', 'deafened', 'poisoned'] })).toEqual(
      [],
    );
  });

  /**
   * **A removal needs no lifetime**, so an Instantaneous spell may carry one.
   *
   * It grants nothing and leaves nothing standing, which is why
   * `grant_without_lifetime` has nothing to say about it — and `FIRE_DART` is
   * Instantaneous, so this assertion is the one that says so.
   */
  it('needs no casting to outlast it', () => {
    expect(only({ kind: 'end-condition', conditions: ['poisoned'] })).toEqual([]);
  });

  /** Every definition the engine ships already obeys it. */
  it.each(SPELL_DEFINITIONS.map((d) => [d.id, d] as const))(
    'is already true of %s',
    (id, definition) => {
      expect(
        checkSpellDefinition(definition).filter(
          (p) => p.code === 'ends_nothing' || p.code === 'duplicate_condition',
        ),
        id,
      ).toEqual([]);
    },
  );
});

/**
 * A granted defence names real damage types, once, and says one thing.
 *
 * The same two mistakes an `end-condition` list can make, on the list a
 * `damage-defense` names — and both compile. An **empty** list is
 * `resolves_nothing` one level down: a definition claiming to grant a defence
 * and granting none. A **repeated** type is the SRD answering itself, since
 * "multiple instances of Resistance to the same damage type count as only
 * one", so the second copy is a second place for one sentence to be written
 * rather than a second grant.
 *
 * The third rule is the one the type cannot make: `defense` is a named
 * vocabulary type shared with `DamageDefenses`, so untyped input needs it as
 * data, which is the reading `checkShape` takes everywhere else.
 */
describe('a spell that grants a defence grants a real one, once', () => {
  const only = (effect: unknown): readonly string[] =>
    codes(checkSpellDefinition({ ...FIRE_DART, durationSeconds: 60, effects: [effect] } as SpellDefinition));

  it('refuses a grant that names no damage type', () => {
    expect(only({ kind: 'damage-defense', damageTypes: [], defense: 'resistant' })).toEqual([
      'defends_nothing',
    ]);
  });

  it('refuses the same damage type twice, because Resistance is not a tally', () => {
    expect(
      only({ kind: 'damage-defense', damageTypes: ['fire', 'fire'], defense: 'resistant' }),
    ).toEqual(['duplicate_damage_type']);
  });

  it('names the repeated entry rather than the list', () => {
    const problems = checkSpellDefinition({
      ...FIRE_DART,
      durationSeconds: 60,
      effects: [
        { kind: 'damage-defense', damageTypes: ['cold', 'fire', 'cold'], defense: 'resistant' },
      ],
    } as unknown as SpellDefinition);
    expect(problems.map((p) => p.field)).toEqual(['effects[0].damageTypes[2]']);
  });

  it('refuses a damage type the SRD does not print', () => {
    expect(
      only({ kind: 'damage-defense', damageTypes: ['sonic'], defense: 'resistant' }),
    ).toEqual(['unknown_damage_type']);
  });

  it('refuses an answer that is not one of the three', () => {
    expect(only({ kind: 'damage-defense', damageTypes: ['fire'], defense: 'halved' })).toEqual([
      'unknown_defense',
    ]);
  });

  /** Stoneskin's own sentence: three types, one answer. */
  it('accepts the plural sentence the SRD writes', () => {
    expect(
      only({
        kind: 'damage-defense',
        damageTypes: ['bludgeoning', 'piercing', 'slashing'],
        defense: 'resistant',
      }),
    ).toEqual([]);
  });

  /**
   * **A grant needs a casting to end it.** `FIRE_DART` is Instantaneous, so
   * without the `durationSeconds` every other case here supplies, the same
   * effect is a Resistance no moment could ever take away.
   */
  it('is refused outright on an Instantaneous spell', () => {
    expect(
      codes(
        checkSpellDefinition({
          ...FIRE_DART,
          effects: [{ kind: 'damage-defense', damageTypes: ['fire'], defense: 'resistant' }],
        } as SpellDefinition),
      ),
    ).toEqual(['grant_without_lifetime']);
  });

  /** Every definition the engine ships already obeys it. */
  it.each(SPELL_DEFINITIONS.map((d) => [d.id, d] as const))(
    'is already true of %s',
    (id, definition) => {
      expect(
        checkSpellDefinition(definition).filter(
          (p) => p.code === 'defends_nothing' || p.code === 'duplicate_damage_type',
        ),
        id,
      ).toEqual([]);
    },
  );
});

/**
 * A grant the casting cannot hold up, which is the rule with no fix attached.
 *
 * **No definition in the catalogue violates it** — every one was driven
 * through before the rule was written, exactly as the rules above it were. So
 * it is a guard against the *next* definition rather than a bug being fixed,
 * and the only way to know it is a guard at all is to build something that
 * fails it by hand.
 *
 * What it protects is the link every durable effect hangs on. A `buff`, a
 * `roll-mode` and an `armor-class` are all removed by `releaseCasting` or
 * `releaseOnTarget` when the casting ends, and a condition rider with neither
 * `lasts` nor `outlivesCasting` "lasts as long as the casting does". An
 * Instantaneous spell's casting is over the moment it resolves, so each of
 * those is a grant with nothing to end it — a Bless that adds its d4 for ever,
 * or a condition the rules have no moment for lifting.
 */
describe('a grant needs a casting that outlasts it', () => {
  const only = (over: Partial<Record<string, unknown>>): readonly string[] =>
    codes(checkSpellDefinition({ ...FIRE_DART, ...over } as SpellDefinition));

  const BUFF = {
    kind: 'buff',
    bonus: { source: 'Fire Dart', flat: 1 },
    applies: ['attack'],
    direction: 'add',
  } as const;
  const MODE = {
    kind: 'roll-mode',
    modifier: {
      source: 'Fire Dart',
      mode: 'advantage',
      selector: { roll: 'attack', relation: 'roller' },
    },
  } as const;
  const AC = { kind: 'armor-class', base: 13, plusAbility: null, shieldAllowed: true } as const;
  const HELD = { kind: 'save', ability: 'wis', condition: 'paralyzed' } as const;

  it.each([
    ['a bonus', BUFF],
    ['a granted mode', MODE],
    ['a base Armour Class', AC],
    ['a condition that lasts as long as the casting', HELD],
  ] as const)('refuses %s on a spell that is over as soon as it resolves', (_what, effect) => {
    const problems = checkSpellDefinition({
      ...FIRE_DART,
      effects: [effect],
    } as unknown as SpellDefinition);
    expect(codes(problems)).toEqual(['grant_without_lifetime']);
    expect(problems.map((p) => p.field)).toEqual(['effects[0]']);
  });

  /** Any of the four ways a casting can go on running is enough. */
  it.each([
    ['a span of seconds', { durationSeconds: 60 }],
    ['a moment in the turn order', { durationUntil: 'start-of-casters-next-turn' }],
    ['no deadline at all', { untilDispelled: true }],
    ['Concentration on a span', { concentration: true, durationSeconds: 60 }],
  ] as const)('accepts one on a casting that lasts %s', (_what, lifetime) => {
    expect(only({ ...lifetime, effects: [BUFF] })).toEqual([]);
  });

  /**
   * And a rider that carries its **own** deadline needs no casting to hang on.
   *
   * SRD Color Spray is Instantaneous and blinds "until the end of your next
   * turn"; SRD Grease's Prone outlives the Grease, because Prone ends when the
   * creature stands up. Both are the reason the rule reads the rider rather
   * than the effect kind.
   */
  it.each([
    ['a deadline of its own', { lasts: 'end-of-casters-next-turn' }],
    ['a life beyond the casting', { outlivesCasting: true }],
  ] as const)('accepts a condition with %s on an Instantaneous spell', (_what, rider) => {
    expect(only({ effects: [{ ...HELD, ...rider }] })).toEqual([]);
  });

  /** The trigger's effects and the activation's are held to the same rule. */
  it('reaches an effect wherever a definition hangs one', () => {
    const problems = checkSpellDefinition({
      ...FIRE_DART,
      targets: { count: 0 },
      area: { kind: 'cube', size: 20, origin: 'point' },
      areaTrigger: { at: 'end-of-turn', label: 'Fire Dart (the embers)', effects: [BUFF] },
      effects: [],
    } as unknown as SpellDefinition);
    expect(codes(problems)).toEqual(['grant_without_lifetime']);
    expect(problems.map((p) => p.field)).toEqual(['areaTrigger.effects[0]']);
  });

  /** Every definition the engine ships already obeys it. */
  it.each(SPELL_DEFINITIONS.map((d) => [d.id, d] as const))(
    'is already true of %s',
    (id, definition) => {
      expect(
        checkSpellDefinition(definition).filter((p) => p.code === 'grant_without_lifetime'),
        id,
      ).toEqual([]);
    },
  );
});

/**
 * One rider, four kinds, one rule — and the *path* is what proves it is one
 * rule rather than four spelled alike.
 *
 * `attack`, `save-damage` and `condition` nest the rider and `save` writes it
 * flat, so a problem has to be reported against the field the author actually
 * wrote. A single reader that appended `.name` to every path would point a
 * `save` author at `effects[0].condition.name`, which their definition does
 * not have.
 */
describe('a condition rider is checked the same way wherever it sits', () => {
  // A minute on the clock, because a condition that lasts as long as the
  // casting needs the casting to last — see "a grant needs a casting that
  // outlasts it" above. That rule is real and has its own tests; here it would
  // be a second problem reported about a definition written to test the first.
  // What is under test here is the rider's own fields.
  const problems = (effect: unknown): readonly SpellDefinitionProblem[] =>
    checkSpellDefinition({
      ...FIRE_DART,
      durationSeconds: 60,
      effects: [effect],
    } as SpellDefinition);

  it.each([
    [
      'condition',
      { kind: 'condition', condition: { name: 'bewildered' } },
      'effects[0].condition.name',
    ],
    [
      'save',
      { kind: 'save', ability: 'wis', condition: 'bewildered' },
      'effects[0].condition',
    ],
    [
      'attack',
      {
        kind: 'attack',
        attack: 'ranged',
        damage: { dice: '2d6' },
        damageType: 'fire',
        conditions: [{ name: 'bewildered' }],
      },
      'effects[0].conditions[0].name',
    ],
    [
      'save-damage',
      {
        kind: 'save-damage',
        ability: 'dex',
        damage: { dice: '2d6' },
        damageType: 'fire',
        onSuccess: 'none',
        conditions: [{ name: 'bewildered' }],
      },
      'effects[0].conditions[0].name',
    ],
    [
      'save with a second condition',
      {
        kind: 'save',
        ability: 'wis',
        condition: 'charmed',
        conditions: [{ name: 'bewildered' }],
      },
      'effects[0].conditions[0].name',
    ],
  ] as const)('refuses an unknown condition on a %s, pointing at the field', (_kind, effect, field) => {
    expect(problems(effect)).toEqual([
      {
        field,
        code: 'unknown_condition',
        reason: '"bewildered" is not one of the SRD\'s fifteen conditions',
      },
    ]);
  });

  /** And the new kind survives the untyped path, which is the loader's. */
  it('accepts a condition applied with no saving throw', () => {
    const spell = {
      ...FIRE_DART,
      durationSeconds: 60,
      effects: [{ kind: 'condition', condition: { name: 'invisible' } }],
    };
    expect(checkSpellDefinition(spell as SpellDefinition)).toEqual([]);
    const parsed = parseSpellDefinition(JSON.parse(JSON.stringify(spell)));
    expect(isErr(parsed) ? parsed.reason : 'ok').toBe('ok');
  });

  /**
   * A rider that is missing outright is *reported*, not thrown at. `checkShape`
   * establishes the effect's `kind` and nothing below it, so untyped input can
   * reach this reader with no rider at all — and a validator that crashes on
   * the input it exists to judge has judged nothing.
   *
   * **Both lifetimes, because the rule that reads a rider second is guarded by
   * a duration.** This case carried `durationSeconds: 60` and therefore drove
   * only `checkConditionRider`, which reads the rider through `?.` and is
   * safe. `checkGrantLifetimes` returns early the moment a casting persists,
   * so the minute on the clock was the exact thing keeping a second unguarded
   * reader out of reach — and `grantCarried` was that reader, walking the list
   * and dereferencing every entry. The same input one field shorter threw a
   * `TypeError` out of the `Result` half of the validator.
   */
  it.each([
    ['a casting that persists', { durationSeconds: 60 }],
    ['an Instantaneous one, where the lifetime rule runs', {}],
  ] as const)('reports a condition effect whose rider is missing, on %s', (_when, lifetime) => {
    const parsed = parseSpellDefinition({
      ...FIRE_DART,
      ...lifetime,
      effects: [{ kind: 'condition' }],
    });
    expect(isErr(parsed)).toBe(true);
    if (isErr(parsed)) expect(parsed.code).toBe('unknown_condition');
  });

  /**
   * And a rider that is present and **null**, which is the other half of the
   * same reading.
   *
   * `undefined` is what a missing field gives; `null` is what JSON gives, and
   * this validator exists for input that came out of a file. Every other
   * reader in this file meets both through `?.`; the check for a
   * {@link ModifierRider} was written as `=== undefined`, so a null entry sat
   * one dereference past the guard.
   */
  it('reports a grant rider that is null rather than throwing on it', () => {
    const parsed = parseSpellDefinition({
      ...FIRE_DART,
      effects: [
        {
          kind: 'save',
          ability: 'wis',
          condition: 'prone',
          outlivesCasting: true,
          modifiers: [null],
        },
      ],
    });
    expect(isErr(parsed)).toBe(true);
    if (isErr(parsed)) expect(parsed.code).toBe('unknown_modifier_rider');
  });

  /**
   * The general form, driven rather than argued: **no shape of rider makes the
   * validator throw.** `parseSpellDefinition` takes `unknown` and returns a
   * `Result`; a throw is not a worse answer than a problem, it is no answer.
   *
   * **And the answer is a refusal**, which is the half this was missing. A
   * sweep that says only "nothing threw" passes exactly as happily if the
   * validator ever begins *accepting* the input it exists to judge — the same
   * hole from the other side, and demonstrably a live one elsewhere in this
   * file: a `heal` whose `healing` was the string `'nonsense'` validated
   * clean, because the one reader of a scaling asked for `.dice`, got
   * `undefined` and said nothing.
   *
   * **No code and no order is pinned.** Which problem a given malformed rider
   * reports is the implementation's business, and the two cases above are
   * where the codes that matter are held; freezing them here would make every
   * future rule in this file a breaking change to a sweep that is not about
   * any particular rule.
   */
  it.each([
    ['missing', undefined],
    ['null', null],
    ['not an object', 'restrained'],
    ['an object with no name', {}],
  ] as const)('refuses rather than throws for a rider that is %s', (_what, rider) => {
    for (const lifetime of [{ durationSeconds: 60 }, {}]) {
      for (const effect of [
        { kind: 'condition', condition: rider },
        { kind: 'save', ability: 'wis', condition: 'prone', conditions: [rider] },
        { kind: 'save', ability: 'wis', condition: 'prone', modifiers: [rider] },
        {
          kind: 'attack',
          attack: 'ranged',
          damage: { dice: '2d6' },
          damageType: 'fire',
          conditions: [rider],
        },
      ]) {
        const definition = { ...FIRE_DART, ...lifetime, effects: [effect] };
        let parsed: ReturnType<typeof parseSpellDefinition> | undefined;
        expect(() => {
          parsed = parseSpellDefinition(definition);
        }).not.toThrow();
        expect(isErr(parsed!)).toBe(true);
      }
    }
  });
});

describe('a definition is told everything that is wrong with it at once', () => {
  it('reports every problem, with the field each belongs to', () => {
    const problems = checkSpellDefinition({
      ...FIRE_DART,
      id: 'Fire Dart',
      school: 'chronomancy',
      concentration: true,
    } as SpellDefinition);

    expect(codes(problems)).toEqual([
      'bad_id',
      'unknown_school',
      'concentration_without_duration',
    ]);
    expect(problems.map((p) => p.field)).toEqual(['id', 'school', 'concentration']);
  });

  /** And a nested problem is pointed at rather than reported on the spell. */
  it('points at the effect that is wrong', () => {
    const problems = checkSpellDefinition({
      ...FIRE_DART,
      effects: [
        {
          kind: 'save-damage',
          ability: 'dex',
          damage: { dice: '4d6' },
          damageType: 'fire',
          onSuccess: 'half',
          plus: [{ damage: { dice: '4d6' }, damageType: 'holy' }],
        },
      ],
    } as SpellDefinition);
    expect(problems.map((p) => p.field)).toEqual(['effects[0].plus[0].damageType']);
  });

  it('gives back the definition when nothing is wrong', () => {
    const out = parseSpellDefinition(FIRE_DART);
    expect(isErr(out)).toBe(false);
    if (!isErr(out)) expect(out.value.id).toBe('fire-dart');
  });
});

// — the format, held against the content that is supposed to use it ————————
//
// Everything from here to the special-case sweep is one question the
// repository could not previously ask.

/**
 * A member of the definition format, derived from the declarations.
 *
 * `label` is what a person reads — `SpellCheck.dc?`, `AreaTrigger.at=…` — and
 * `probe` is the key it is looked up by in the catalogue's usage. They differ
 * because the probe is deliberately **coarser**; see the collision guard below
 * for what that costs and why it is the sound choice.
 */
interface FormatMember {
  readonly label: string;
  readonly probe: string;
}

const withoutComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

/**
 * The source text of one exported declaration, comments stripped.
 *
 * Stripped because a docstring in this catalogue routinely *names* the values
 * it is talking about — `SpellCheck`'s says "There is deliberately no
 * `end-casting`" — and a scan that read those would derive members out of
 * prose explaining that they do not exist.
 *
 * **Throws for a name it cannot find**, which is the `animals.md` lesson: a
 * reader that silently returns nothing for a declaration that has been renamed
 * reports no problems and checks nothing.
 */
const regionOf = (source: string, name: string): string => {
  const lines = source.split('\n');
  const start = lines.findIndex(
    (line) =>
      line.startsWith(`export interface ${name} `) || line.startsWith(`export type ${name} =`),
  );
  if (start < 0) throw new Error(`the definition format declares no ${name}`);
  const isInterface = lines[start]!.startsWith('export interface');
  const out: string[] = [];
  for (let i = start; i < lines.length; i += 1) {
    out.push(lines[i]!);
    if (isInterface) {
      if (i > start && lines[i] === '}') break;
      continue;
    }
    // A union ends at the first `;` that is not inside a nested object type.
    if (!/;\s*$/.test(lines[i]!) || lines[i]!.trim().startsWith('*')) continue;
    const stripped = withoutComments(out.join('\n'));
    const depth = [...stripped].reduce(
      (d, ch) => (ch === '{' ? d + 1 : ch === '}' ? d - 1 : d),
      0,
    );
    if (depth === 0) break;
  }
  return withoutComments(out.join('\n'));
};

/**
 * A type whose whole right-hand side is string literals, or one field's.
 *
 * **The leading `|` is optional, and that was a blind spot rather than a
 * nicety.** TypeScript writes a union across several lines with a pipe in
 * front of every arm, which is what every union long enough to carry a
 * docstring per member looks like — and this pattern read none of them. It
 * reported no problems and checked nothing, which is the `animals.md` failure
 * arriving inside the guard that exists to catch it. `CastingEndCause` is the
 * first multi-line one in `FORMAT_TYPES` and is the case that found it; the
 * mutation is a sixth cause no definition writes, which is reported now and
 * was silently accepted before.
 */
const LITERAL_UNION = /^\|?\s*(?:'[a-z0-9-]+'\s*\|\s*)*'[a-z0-9-]+'$/;

/**
 * Every optional field and every closed-union value one declaration writes.
 *
 * Derived from the source rather than listed, for the reason every sweep in
 * this repository is: a hand-kept list is a second place to record the format,
 * and the way it rots is a member added to the type and not to the list.
 */
const membersOf = (source: string, name: string): readonly FormatMember[] => {
  const region = regionOf(source, name);
  const found = new Map<string, FormatMember>();
  const add = (label: string, probe: string): void => {
    found.set(label, { label, probe });
  };

  // `export type RiderDuration = 'a' | 'b';` — the union *is* the members, and
  // they are written as somebody's field value rather than under a name of
  // their own, so the probe matches a value wherever it was written.
  const top = /^export type \w+ =([\s\S]*);\s*$/.exec(region.trim());
  if (top !== null) {
    const rhs = top[1]!.replace(/\s+/g, ' ').trim();
    if (LITERAL_UNION.test(rhs)) {
      // A leading `|` splits to an empty fragment, which would be reported as
      // a member spelled `''` that no definition could ever write.
      for (const literal of rhs.split('|').filter((part) => part.trim() !== '')) {
        const value = literal.trim().slice(1, -1);
        add(`${name}='${value}'`, `*='${value}'`);
      }
      return [...found.values()];
    }
  }

  const field = /readonly (\w+)(\?)?:\s*([^;}\n]*)/g;
  let match: RegExpExecArray | null;
  while ((match = field.exec(region)) !== null) {
    const [, key, optional, raw] = match;
    const type = raw!.replace(/\s+/g, ' ').trim();
    if (optional === '?') add(`${name}.${key}?`, `${key}?`);
    if (LITERAL_UNION.test(type)) {
      for (const literal of type.split('|')) {
        const value = literal.trim().slice(1, -1);
        add(`${name}.${key}='${value}'`, `${key}='${value}'`);
      }
    }
  }
  return [...found.values()];
};

/** Every field written, and every string value written to it, by any definition. */
const written = (definitions: readonly SpellDefinition[]): ReadonlySet<string> => {
  const keys = new Set<string>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (typeof node !== 'object' || node === null) return;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (value === undefined) continue;
      keys.add(`${key}?`);
      if (typeof value === 'string') {
        keys.add(`${key}='${value}'`);
        keys.add(`*='${value}'`);
      }
      walk(value);
    }
  };
  definitions.forEach(walk);
  return keys;
};

/**
 * The whole definition format, by name.
 *
 * The brief for this sweep named seven; the other six are here because they
 * are the same format, the rule over them is the same rule, and leaving them
 * out would reinstate the blind spot on a smaller surface. `DelayedDamage`
 * contributes nothing — it declares two required fields and no closed union —
 * which is a measured fact rather than a gap, and the vacuity guard below is
 * what says so.
 */
const FORMAT_TYPES = [
  'SpellEffect',
  'SpellDefinition',
  'TargetRule',
  'SpellArea',
  'AreaTrigger',
  'RiderDuration',
  'SpellCheck',
  'ConditionRider',
  'DelayedDamage',
  // Both halves of the creature-type clause, so a third outcome added with no
  // SRD sentence behind it fails here rather than accumulating quietly. The
  // two it declares are Blight's automatic failure and Shatter's Disadvantage.
  'TypedSaveOutcome',
  'TypedExtraDamage',
  // What ends a casting early, both halves: the closed list of causes, and the
  // scope each sentence names. A sixth cause added to the union with no SRD
  // sentence behind it fails here rather than sitting unwritten, and so does a
  // third scope.
  'CastingEndCause',
  'CastingEndTrigger',
  'DiceScaling',
  'CastingOrigin',
  'SpellActivation',
  'SpellRange',
] as const;

/**
 * A member no definition writes, and the written reason it stays anyway.
 *
 * The shape `MISSING_SHAPES` takes in `spell-honesty.test.ts` and that
 * `definition.anchoring` already took in `spatial-model.test.ts` — and it is
 * held to the same two rules: **an exemption must be needed**, so one whose
 * member has acquired a user fails, and one whose member no longer exists
 * fails too. Each also has a test of its own below that pins the fact making
 * it true, because a written reason is only as honest as its author.
 *
 * **An exemption is never a user.** The fourth whole-engine audit (2026-09-13,
 * §3.1) is what this sweep exists to answer, and its finding is that
 * speculative shape accumulates silently. Inventing a definition to give a
 * member a user would be the loudest possible way of not answering it.
 */
const FORMAT_EXEMPTIONS: Readonly<Record<string, string>> = {
  'SpellDefinition.anchoring?':
    'SRD 5.2.1 mandates no footprint convention for an area of effect — its "Playing on a Grid" sidebar covers squares, Speed, entering a square, corners and ranges and says nothing about areas, and the intersection convention comes from a 2014 optional rule. Declaring one per spell would be the engine choosing a rule the book declined to give. The field exists so a deliberate geometry pass, or an author of content the SRD never printed, says it in data rather than in runtime logic, and `spatial-model.test.ts` drives both precedence branches through `anchoringFor`.',
  'SpellCheck.dc?':
    'SRD Maze prints "a DC 20 Intelligence (Investigation) check", which is exactly this field, and Maze has no definition because it is blocked on a demiplane the engine does not model. The reader is live on every executed check — `effectCheckFrom` writes `check.dc ?? saveDc` — so what is absent is a definition, not a use. The pin below is the one Sunburst\'s dispel clause already takes: the day Maze gets a definition it must write the number the book prints, and this fails rather than going on excusing a field that now has a user.',
};

/**
 * **Nothing in this repository could see a member that nobody uses.**
 *
 * `checkSpellDefinition` asks whether one definition is coherent. Nothing
 * asked the other direction — whether every member of the format is written by
 * at least one definition — and the fourth whole-engine audit (2026-09-13,
 * §3.1) measured what that cost: three members existed with no user at all,
 * each written for a spell blocked on something else. That is exactly the
 * accumulation the doctrine's generalization rule exists to prevent, and the
 * guard for it already existed one vocabulary over: `spell-honesty.test.ts`
 * asserts that no entry in `MISSING_SHAPES` sits unclaimed.
 *
 * This is the same sweep, over the format.
 */
describe('every member of the definition format has a user or a written exemption', () => {
  const source = readFileSync(
    fileURLToPath(new URL('./spell-definitions.ts', import.meta.url)),
    'utf8',
  );

  const members = FORMAT_TYPES.flatMap((type) => membersOf(source, type));
  const used = written(SPELL_DEFINITIONS);
  const unused = members.filter((member) => !used.has(member.probe));

  /**
   * The finding itself, and it **reports what it finds** rather than counting.
   *
   * A count would have to be maintained by whichever task next adds or removes
   * a member, and would pass for the wrong reason the moment two changes
   * cancelled. The names are the evidence.
   */
  it('writes every member from some definition, or says why not', () => {
    expect(unused.map((member) => member.label).filter((label) => !(label in FORMAT_EXEMPTIONS)))
      .toEqual([]);
  });

  /** And an exemption for a member that has since found a user is a stale licence. */
  it('keeps no exemption for a member something now writes', () => {
    const zero = new Set(unused.map((member) => member.label));
    expect(Object.keys(FORMAT_EXEMPTIONS).filter((label) => !zero.has(label))).toEqual([]);
  });

  /**
   * And one for a member that no longer exists is worse: it is a claim about
   * a format that has moved on. This is what will fail the day IE-010 removes
   * `roll-mode.save`, which is the intended way to find out.
   */
  it('names a member the format still declares', () => {
    const declared = new Set(members.map((member) => member.label));
    expect(Object.keys(FORMAT_EXEMPTIONS).filter((label) => !declared.has(label))).toEqual([]);
  });

  /** A reason that says nothing is a licence, so each must be a real sentence. */
  it('writes a real sentence for every exemption', () => {
    for (const [label, reason] of Object.entries(FORMAT_EXEMPTIONS)) {
      expect(reason.length, label).toBeGreaterThan(120);
    }
  });

  /**
   * The sweep is not vacuous, driven rather than trusted.
   *
   * Two halves, because the sweep has two. The reader really does derive
   * members from a declaration — asserted over synthetic source, so no
   * catalogue number is pinned here — and the usage walk really does find a
   * member unwritten when nothing writes it.
   */
  it('derives an optional field and a closed union from a declaration', () => {
    const synthetic = [
      'export interface Widget {',
      '  readonly kind: string;',
      "  /** A docstring naming 'a-value-that-is-only-prose'. */",
      "  readonly mood?: 'sullen' | 'merry';",
      '  readonly size: number;',
      '}',
    ].join('\n');
    expect(membersOf(synthetic, 'Widget').map((m) => m.label)).toEqual([
      'Widget.mood?',
      "Widget.mood='sullen'",
      "Widget.mood='merry'",
    ]);
  });

  it('throws rather than reporting nothing for a declaration it cannot find', () => {
    expect(() => membersOf(source, 'NoSuchMember')).toThrow(/declares no NoSuchMember/);
  });

  /**
   * And the violation: hold the real format against a catalogue of one
   * minimal spell, and members the whole catalogue does write come back
   * unwritten. A sweep that could not report a member is a sweep that reports
   * nothing.
   */
  it('reports a member as unwritten when the content stops writing it', () => {
    const thin = written([FIRE_DART]);
    const missing = members
      .filter((member) => !thin.has(member.probe))
      .map((member) => member.label);

    // Real members, written by the catalogue and not by Fire Dart alone.
    expect(missing).toContain("SpellEffect.kind='heal'");
    expect(missing).toContain('SpellDefinition.areaTrigger?');
    expect(missing).toContain('TargetRule.mustBeType?');
    expect(missing).toContain("SpellArea.kind='emanation'");
    // And the sweep over the real catalogue does not report them.
    expect(unused.map((member) => member.label)).not.toContain("SpellEffect.kind='heal'");
  });

  /**
   * **The probe is coarser than the label, and that is the sound choice.**
   *
   * A member is looked up by field name and value, not by which type declared
   * it, because the usage walk reads *values* and values carry no types. The
   * arm-aware alternative was written and measured and is worse: a
   * `DiceScaling` nested inside an `attack` effect inherits the effect's arm,
   * so `DiceScaling.flat?` comes back unwritten when False Life writes it —
   * four false positives, which is the failure mode a guard must not have.
   *
   * What the coarseness costs is stated rather than hidden: where two members
   * share a probe, one can be reported as written because the other is. The
   * list is pinned so that a new collision is a reviewed change, and the one
   * that actually masks something is named.
   */
  it('names every place two members share a probe', () => {
    const byProbe = new Map<string, string[]>();
    for (const member of members) {
      byProbe.set(member.probe, [...(byProbe.get(member.probe) ?? []), member.label]);
    }
    const shared = [...byProbe.values()]
      .filter((labels) => labels.length > 1)
      .map((labels) => labels.join(' + '))
      .sort();

    expect(shared).toEqual([
      // **The pair that masks.** `AreaTrigger.at` and a repeat save's `at` are
      // different clauses with the same two values, and Web writes
      // `start-of-turn` as an area boundary while no definition repeats a save
      // at the start of a turn. So `save.repeats.at: 'start-of-turn'` is
      // unwritten and this sweep cannot see it. Recorded here rather than
      // exempted, because it is a limit of the instrument and not a decision
      // about the format.
      "SpellEffect.at='end-of-turn' + AreaTrigger.at='end-of-turn' + ConditionRider.at='end-of-turn'",
      "SpellEffect.at='start-of-turn' + AreaTrigger.at='start-of-turn' + ConditionRider.at='start-of-turn'",
      // `save` spells its first rider flat and every other carrier nests it —
      // `conditionRiderOf` is the view that makes them one vocabulary. These
      // collisions are two spellings of one field and mask nothing, and
      // `repeats` moving onto the rider made three of them longer rather than
      // adding a new kind of masking: the flat field and the rider field are
      // the same clause read two ways.
      'SpellEffect.check? + SpellDefinition.check? + ConditionRider.check?',
      'SpellEffect.lasts? + ConditionRider.lasts?',
      // A save-damage's success and a check's success are different fields
      // that happen to share two words; both values are written by both.
      "SpellEffect.onSuccess='end-casting' + ConditionRider.onSuccess='end-casting'",
      "SpellEffect.onSuccess='end-on-target' + SpellCheck.onSuccess='end-on-target' + ConditionRider.onSuccess='end-on-target'",
      "SpellEffect.onSuccess='none' + SpellCheck.onSuccess='none'",
      'SpellEffect.outlivesCasting? + ConditionRider.outlivesCasting?',
      'SpellEffect.repeats? + ConditionRider.repeats?',
    ]);
  });
});

/**
 * What makes an exemption more than prose: a fact that can stop being true.
 *
 * `spell-honesty.test.ts` pins the fact that makes Sunburst's dispel clause
 * the table's — "no Darkness definition compiles in" — so that the day it
 * stops being true the claim fails rather than going quietly on. Each of these
 * is the same move.
 *
 * **Two of the three that were here are gone, and both went the way the sweep
 * intended.** `roll-mode.save` was a handover and was removed; the
 * `'end-casting'` outcome acquired a user the moment Hideous Laughter was
 * written. What is left below is their other side — the assertion that the
 * first is gone rather than merely unused, and that the second is written
 * rather than merely resolvable. No count is stated, because the list is the
 * thing that changes.
 */
describe('a format exemption says something that can stop being true', () => {
  const here = fileURLToPath(new URL('.', import.meta.url));
  const read = (file: string): string => readFileSync(`${here}${file}`, 'utf8');

  /**
   * `SpellCheck.dc` is a field SRD Maze writes and this catalogue cannot.
   *
   * Maze is blocked on a labyrinthine demiplane, which is not a place the
   * engine has. The day it gets a definition — tracked or executed — it must
   * carry the number the book prints, the field has a user, and the exemption
   * above fails as a stale licence.
   */
  it('pins that the spell printing a DC has no definition', () => {
    expect(SPELL_DEFINITIONS.filter((d) => d.id === 'maze')).toEqual([]);

    const book = JSON.parse(
      readFileSync(
        fileURLToPath(new URL('../../srd/src/generated/spells.json', import.meta.url)),
        'utf8',
      ),
    ) as readonly { id: string; description: string }[];
    const maze = book.find((spell) => spell.id === 'maze');
    expect(maze?.description).toContain('DC 20 Intelligence (Investigation) check');
  });

  /**
   * **`'end-casting'` stopped needing an exemption, which is the sweep working
   * rather than the sweep being wrong.**
   *
   * It was exempted as "built and driven, but no definition writes it" — the
   * engine resolved it, `duration.ts` declared it, the reducer branched on it,
   * and `turn-hooks.test.ts` drove that branch with a hand-built hook. What it
   * lacked was a spell. SRD Hideous Laughter is that spell: "On a successful
   * save, **the spell ends**", which is the value exactly, and the day it got
   * a definition the exemption became a stale licence and the sweep said so.
   *
   * So this pins the other side. The member has a user *and* the engine still
   * resolves it — because an exemption removed for the wrong reason would look
   * identical to one removed for this one.
   */
  it('pins that a definition now writes the value the exemption used to cover', () => {
    const writers = SPELL_DEFINITIONS.filter((definition) =>
      definition.effects.some(
        (effect) => effect.kind === 'save' && effect.repeats?.onSuccess === 'end-casting',
      ),
    );
    expect(writers.map((d) => d.id)).toContain('hideous-laughter');

    expect(read('duration.ts')).toContain("readonly onSuccess: 'end-on-target' | 'end-casting'");
    expect(read('events.ts')).toContain("pending.onSuccess === 'end-casting'");
  });

  /**
   * **The handover, discharged.** `roll-mode.save` was the one exemption that
   * was a handover rather than a decision: IE-013 could not remove it without
   * changing the format, so it recorded the field and pinned that it was still
   * there to be removed. IE-010 removed it, both entries went with it, and
   * what is left is this — the other side of the same claim, which is that
   * nothing brought it back.
   *
   * A resurrected field would be a zero-user member with no exemption at all,
   * so the sweep above would catch it anyway. This says *why* it is gone,
   * where the next reader of that sweep will meet the question: a spell whose
   * mode is imposed by a failed save writes the save as its host and hangs the
   * mode as a `modifiers` rider, which is one roll shared rather than two
   * spellings of one sentence.
   */
  it('pins that the member IE-013 handed over is gone rather than unused', () => {
    expect(read('spell-definitions.ts')).not.toContain('readonly save?: Ability;');
    expect(read('spell-definitions.ts')).toContain('readonly modifiers?: readonly ModifierRider[]');
  });
});

/**
 * The rule the whole architecture rests on, asserted rather than assumed.
 *
 * A spell's mechanics are read out of its definition and nowhere else. The
 * moment the runtime grows `if (spellId === 'fireball')` the definitions stop
 * being the description of the spell and become a hint, which is the failure
 * mode the comparative audit found in one reference implementation and warned
 * against in the other.
 *
 * **It reads every source file in the engine now**, which is the correction
 * the fourth whole-engine audit (2026-09-13, §3.5) asked for. The list used to
 * name `commands/`, `events.ts`, `spells.ts`, `spellcasting.ts` and
 * `standing.ts` — and IE-005 moved seven readers of definitions out of that
 * population into `spell-definitions.ts` itself, while `spell-schema.ts`,
 * `duration.ts`, `attack.ts`, `positioning.ts` and `checks.ts` had never been
 * in it at all. No special case was found in any of them; this is a hole
 * closed rather than a breach.
 *
 * A file listing rather than an array, for the reason the command layer's
 * already was: a hand-kept list of modules is the thing these sweeps exist to
 * replace, arriving one level up.
 */
describe('no spell is special-cased in the runtime', () => {
  const here = fileURLToPath(new URL('.', import.meta.url));

  /** Every non-test source file under `src`, at any depth. */
  const sourcesUnder = (dir: string, prefix = ''): readonly string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? sourcesUnder(`${dir}${entry.name}/`, `${prefix}${entry.name}/`)
        : entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')
          ? [`${prefix}${entry.name}`]
          : [],
    );

  const RUNTIME = sourcesUnder(here);
  const source = (file: string): string => readFileSync(`${here}${file}`, 'utf8');
  const IDS = SPELL_DEFINITIONS.map((d) => d.id);

  /**
   * Ids that are also ordinary engine vocabulary.
   *
   * `shield` is a spell and an armour category; `light` is a spell and a
   * weapon property, and `weapon.properties.includes('light')` in `attack.ts`
   * has nothing to do with the cantrip. Named one word at a time rather than
   * matched loosely, so each exclusion is reviewed instead of being a
   * heuristic that quietly stops catching things.
   */
  const ALSO_VOCABULARY: ReadonlySet<string> = new Set(['shield', 'light']);

  /**
   * Where naming a spell is **data** rather than a branch.
   *
   * Two constructs, and they are excused as *constructs* rather than as lines
   * or as files. That distinction earned itself immediately: written as a line
   * shape, this named `cleric.ts`, `paladin.ts` and `warlock.ts` and silently
   * did not cover `ranger.ts`, which writes the same grant inline on one line,
   * nor `sorcerer.ts`, which was simply left out of the sentence. Both were
   * excused anyway — by the accident that none of their ids has a definition
   * yet — so the enumeration was a claim waiting to stop being true.
   *
   * - `ID_LINE`: a definition's own `id:`, in the catalogue. A file of
   *   definitions names every spell it defines, which is true at any size and
   *   is the reason this half of the sweep could not simply be pointed at
   *   `spell-definitions.ts`.
   * - `SPELL_GRANT`: `fixed: ['bless', …]` — a subclass's fixed spell grant,
   *   wherever it is written. A Life Domain granting Bless is the class table
   *   saying which spells it grants, and nothing about a list of ids can
   *   branch on one. Matched only as an array of bare slugs, so any other use
   *   of the word `fixed` is untouched.
   *
   * Everything else on every line of every file still counts, which is what
   * keeps this from being a handful of files waved through.
   */
  const ID_LINE = /^\s*id: '[a-z0-9-]+',\s*$/;
  const SPELL_GRANT = /fixed: \['[a-z0-9-]+'(?:,\s*'[a-z0-9-]+')*\]/g;

  const COMPARISON =
    /(spellId|definition\.id|record\.spellId|spell\.id)\s*[=!]==\s*['"]([a-z0-9-]+)['"]/g;

  /** Every `<something>.id === '<literal>'` a file writes, as written. */
  const comparedIn = (text: string): readonly string[] =>
    [...text.matchAll(COMPARISON)].map((match) => match[0]);

  /** A file's text with the two data constructs removed. */
  const proseOf = (text: string): string =>
    text
      .split('\n')
      .filter((line) => !ID_LINE.test(line))
      .join('\n')
      .replace(SPELL_GRANT, 'fixed: []');

  /** Every catalogue id a file names outside those constructs. */
  const namedIn = (text: string): readonly string[] => {
    const prose = proseOf(text);
    return IDS.filter((id) => !ALSO_VOCABULARY.has(id)).filter(
      (id) => prose.includes(`'${id}'`) || prose.includes(`"${id}"`),
    );
  };

  /**
   * The one comparison in the engine that matches the shape and is not one.
   *
   * `creation.ts` asks which of a character's classes is the Wizard, because
   * the Evoker's free spells go in the Wizard's book and nowhere else — a
   * **class** definition's id, in a file that holds no spell definitions at
   * all. It is unchanged since the third whole-engine audit and is recorded
   * rather than removed, because removing it belongs to the feature-definition
   * validator and not to this sweep.
   *
   * Allowlisted as the exact text in the exact file, so a genuine
   * `definition.id === 'fireball'` in `creation.ts` still fails.
   */
  const ALLOWED_COMPARISONS: Readonly<Record<string, readonly string[]>> = {
    'creation.ts': ["definition.id === 'wizard'"],
  };

  it.each(RUNTIME.map((file) => [file] as const))('%s branches on no spell id', (file) => {
    // The direct shape: an id compared against a **literal**. Two ids compared
    // with each other is ordinary lookup and is not this.
    const allowed = ALLOWED_COMPARISONS[file] ?? [];
    expect(comparedIn(source(file)).filter((match) => !allowed.includes(match)), file).toEqual([]);
  });

  it.each(RUNTIME.map((file) => [file] as const))('%s names no spell of the catalogue', (file) => {
    expect(namedIn(source(file)), file).toEqual([]);
  });

  /**
   * The sweep is not vacuous, and the mutation is driven against **every**
   * file it covers rather than against a string written in this test.
   *
   * That is the half the widening turns on: a file newly brought into the
   * population must be one that a smuggled special case actually fails, by
   * name. A file whose real text somehow excused the smuggled line would be a
   * file the widening did not really cover.
   */
  it.each(RUNTIME.map((file) => [file] as const))(
    '%s would fail if a special case were smuggled into it',
    (file) => {
      const smuggled = `${source(file)}\nif (request.spellId === 'fireball') return err('no');\n`;
      expect(comparedIn(smuggled), file).toContain("spellId === 'fireball'");
      expect(namedIn(smuggled), file).toContain('fireball');
    },
  );

  it('has a population and a catalogue worth sweeping', () => {
    expect(RUNTIME).toContain('spell-schema.ts');
    expect(RUNTIME).toContain('spell-definitions.ts');
    expect(RUNTIME).toContain('commands/turns.ts');
    expect(RUNTIME.filter((file) => file.endsWith('.test.ts'))).toEqual([]);
    expect(IDS).toContain('fireball');
    expect(IDS).toContain('mage-armor');
  });

  /**
   * And the allowances are real rather than blankets.
   *
   * Each is asserted to be *needed* — the construct it excuses is really
   * there — and to be *narrow*: a spell id written anywhere but that construct
   * still fails, in the same file as readily as anywhere else.
   */
  it('excludes only words the engine uses for something else', () => {
    expect([...ALSO_VOCABULARY].sort()).toEqual(['light', 'shield']);
    expect(source('events.ts')).toContain("category === 'shield'");
    expect(source('attack.ts')).toContain("weapon.properties.includes('light')");
  });

  it('allows the two data constructs and nothing around them', () => {
    // Each is needed: the catalogue really writes its ids that way, and the
    // class tables really write their grants that way, or it excuses nothing.
    expect(source('spell-definitions.ts').split('\n').filter((line) => ID_LINE.test(line)).length)
      .toBeGreaterThan(100);
    expect([...source('cleric.ts').matchAll(SPELL_GRANT)]).not.toEqual([]);

    // Each is narrow: a spell named anywhere else on the same line, or in a
    // construct that merely looks like one, still counts.
    expect(namedIn("const x = 'bless';")).toEqual(['bless']);
    expect(ID_LINE.test("  if (x) id: 'fire-bolt',")).toBe(false);
    expect(namedIn("fixed: ['bless'] as const; const y = 'bless';")).toEqual(['bless']);
    expect(namedIn("const fixed: string[] = ['bless'];")).toEqual(['bless']);
  });

  /**
   * **Every spell grant in the engine is one the allowance reaches**, derived
   * rather than enumerated.
   *
   * The first version of this named three files in prose and covered neither
   * `ranger.ts`, which writes the same grant inline on one line, nor
   * `sorcerer.ts`, which was left out of the sentence. Both passed anyway,
   * because none of their ids has a definition yet — so the sweep would have
   * gone green until a content task defined Hunter's Mark or Chromatic Orb and
   * then failed for a reason with nothing to do with that task.
   *
   * So the claim is checked instead of written down: whatever `grants: { kind:
   * 'spells' }` a class file holds, the ids inside it are excused, and a grant
   * written in a shape the allowance cannot see fails **here** — where the
   * message is about the allowance — rather than in the sweep.
   */
  it('reaches every fixed spell grant the class tables write', () => {
    const grants = RUNTIME.flatMap((file) =>
      [...source(file).matchAll(/fixed: \[[^\]]*\]/g)].map((match) => [file, match[0]] as const),
    );
    // Not vacuous: the class tables really do grant spells this way.
    expect(grants.length).toBeGreaterThan(3);
    for (const [file, grant] of grants) {
      expect(proseOf(grant), `${file}: ${grant}`).toBe('fixed: []');
    }
  });

  it('allowlists a comparison that is needed and no wider', () => {
    for (const [file, matches] of Object.entries(ALLOWED_COMPARISONS)) {
      for (const match of matches) {
        expect(comparedIn(source(file)), file).toContain(match);
        // Not a spell id, which is the whole reason it is allowed.
        const literal = /'([a-z0-9-]+)'$/.exec(match)?.[1];
        expect(IDS, match).not.toContain(literal);
      }
    }
  });
});

/**
 * **A rider is a leaf, and this is the invariant the whole design rests on.**
 *
 * The question Fable's record answered was "what restricted vocabulary lets a
 * saving throw express bounded consequences without the definition format
 * becoming a recursive rules DSL", and the answer was that there is no child
 * vocabulary at all: what the SRD writes after "On a failed save," is a
 * conjunction of consequences sharing one roll, and every one of them rolls no
 * d20, names no target, opens no window and spends nothing.
 *
 * `onFail: SpellEffect[]` was rejected for that reason and not for taste — a
 * child that rolls is a parent, and the format would have become a small
 * untyped program with a saving throw nested inside a saving throw. The type
 * system refuses it for anything compiled here. These are the other two
 * places it is refused: over untyped input, and over the catalogue, so that a
 * definition arriving from a file cannot smuggle in what a definition written
 * here cannot express.
 */
describe('a rider never rolls, and nothing below an effect is an effect', () => {
  /**
   * The name collision that would let recursion in through the back door.
   *
   * `checkShape`'s denylist reads a nested `kind` and refuses it if it is an
   * effect kind. A rider kind that were *also* an effect kind would therefore
   * be refused wherever it legitimately appears — or, read the other way, an
   * effect kind reused as a rider kind would sail past the guard. One
   * assertion keeps the two vocabularies disjoint.
   */
  it('shares no kind between a rider and an effect', () => {
    expect([...RIDER_KINDS].filter((kind) => EFFECT_KINDS.has(kind))).toEqual([]);
    // And neither set is empty, or the intersection above is vacuous.
    expect(RIDER_KINDS.size).toBeGreaterThan(0);
    expect(EFFECT_KINDS.size).toBeGreaterThan(0);
  });

  /**
   * The catalogue sweep. Every effect, wherever it is found — the spell's own
   * list, an area trigger's, an activation's — walked as JSON, with every
   * object below the effect asked whether it is secretly an effect.
   *
   * Read as data rather than by switching on the kind, because a reader that
   * switched would only see the slots it had been told about, and the whole
   * point is to catch a slot nobody told it about.
   */
  const EVERY_EFFECT = SPELL_DEFINITIONS.flatMap((definition) => [
    ...definition.effects.map((effect, i) => [`${definition.id}.effects[${i}]`, effect] as const),
    ...(definition.areaTrigger?.effects ?? []).map(
      (effect, i) => [`${definition.id}.areaTrigger.effects[${i}]`, effect] as const,
    ),
    ...(definition.activation?.effects ?? []).map(
      (effect, i) => [`${definition.id}.activation.effects[${i}]`, effect] as const,
    ),
  ]);

  /** Every object strictly below `value`, with the path it was found at. */
  const below = (value: unknown, path: string): readonly (readonly [string, unknown])[] => {
    if (typeof value !== 'object' || value === null) return [];
    const entries: (readonly [string, unknown])[] = Array.isArray(value)
      ? value.map((entry, i) => [`${path}[${i}]`, entry] as const)
      : Object.entries(value as Record<string, unknown>).map(
          ([key, entry]) => [`${path}.${key}`, entry] as const,
        );
    return entries.flatMap(([at, entry]) => [[at, entry] as const, ...below(entry, at)]);
  };

  it('has some, so the sweep below is not vacuous', () => {
    expect(EVERY_EFFECT.length).toBeGreaterThan(50);
    expect(EVERY_EFFECT.flatMap(([path, effect]) => below(effect, path)).length).toBeGreaterThan(50);
  });

  it('nests no effect below an effect, anywhere in the catalogue', () => {
    for (const [path, effect] of EVERY_EFFECT) {
      for (const [at, nested] of below(effect, path)) {
        if (typeof nested !== 'object' || nested === null || Array.isArray(nested)) continue;
        const kind = (nested as { kind?: unknown }).kind;
        expect(
          typeof kind === 'string' && EFFECT_KINDS.has(kind) ? kind : null,
          `${at} carries an effect kind, so a rider has become a parent`,
        ).toBeNull();
      }
    }
  });

  /** And nothing below an effect brings its own targets, area or effect list. */
  it('gives nothing below an effect its own targets, area or effects', () => {
    for (const [path, effect] of EVERY_EFFECT) {
      for (const [at, nested] of below(effect, path)) {
        if (typeof nested !== 'object' || nested === null || Array.isArray(nested)) continue;
        expect(
          Object.keys(nested as Record<string, unknown>).filter((key) =>
            ['effects', 'targets', 'targetsWithin', 'area'].includes(key),
          ),
          at,
        ).toEqual([]);
      }
    }
  });

  /** A rider is one object deep, and the deepest legal nesting is its selector. */
  it('keeps every effect shallow enough to read at a glance', () => {
    const depthOf = (value: unknown): number =>
      typeof value !== 'object' || value === null
        ? 0
        : 1 +
          Math.max(
            0,
            ...(Array.isArray(value)
              ? value
              : Object.values(value as Record<string, unknown>)
            ).map(depthOf),
          );
    for (const [path, effect] of EVERY_EFFECT) {
      expect(depthOf(effect), path).toBeLessThanOrEqual(6);
    }
  });

  // — and the validator refuses what the catalogue does not do ——————————————

  const problems = (effect: unknown): readonly string[] =>
    codes(checkSpellDefinitionValue({ ...FIRE_DART, durationSeconds: 60, effects: [effect] }));

  /**
   * The mutation the sweep exists for: an effect nested inside a rider.
   *
   * This is `onFail: SpellEffect[]` arriving through a loader rather than
   * through the compiler, and it is the exact shape the design record rejected
   * — a saving throw inside a saving throw's consequence.
   */
  it('refuses an effect nested inside a rider', () => {
    expect(
      problems({
        kind: 'save-damage',
        ability: 'dex',
        damage: { dice: '2d6' },
        damageType: 'fire',
        onSuccess: 'none',
        conditions: [
          {
            name: 'prone',
            then: { kind: 'save', ability: 'str', condition: 'restrained' },
          },
        ],
      }),
    ).toContain('nested_effect');
  });

  it('refuses a rider that brings its own effect list', () => {
    expect(
      problems({
        kind: 'save',
        ability: 'wis',
        condition: 'charmed',
        conditions: [{ name: 'prone', effects: [] }],
      }),
    ).toContain('nested_effect');
  });

  it('refuses a rider that names its own targets or area', () => {
    expect(
      problems({
        kind: 'save',
        ability: 'wis',
        condition: 'charmed',
        conditions: [{ name: 'prone', targets: { count: 2 } }],
      }),
    ).toContain('nested_effect');
    expect(
      problems({
        kind: 'save',
        ability: 'wis',
        condition: 'charmed',
        conditions: [{ name: 'prone', area: { kind: 'sphere', radius: 10, origin: 'point' } }],
      }),
    ).toContain('nested_effect');
  });

  /**
   * And the denylist really is a denylist: a field the engine has never heard
   * of is data written against a later version, not data that is wrong. That
   * is the reading `checkShape` takes everywhere else and this rule does not
   * get to be the exception.
   */
  it('accepts a rider carrying a field this engine does not know', () => {
    expect(
      problems({
        kind: 'save',
        ability: 'wis',
        condition: 'charmed',
        conditions: [{ name: 'prone', tasteOfTheSpell: 'copper' }],
      }),
    ).toEqual([]);
  });

  /** A modifier rider's own `kind` is not an effect kind, so it passes. */
  it('accepts a modifier rider, whose kind is a rider kind', () => {
    expect(
      problems({
        kind: 'save',
        ability: 'wis',
        condition: 'charmed',
        modifiers: [
          { kind: 'mode', modifier: { mode: 'disadvantage', selector: { roll: 'attack', relation: 'roller' } } },
        ],
      }),
    ).toEqual([]);
  });
});

/**
 * The two rules a rider carries that the type system cannot state, because one
 * `ConditionRider` is shared by all four hosts — which is the whole point of
 * it, and therefore the whole reason these live here.
 */
describe('a rider is held to what its host can support', () => {
  const problems = (
    effect: unknown,
    over: Partial<SpellDefinition> = { durationSeconds: 60 },
  ): readonly string[] => codes(checkSpellDefinition({ ...FIRE_DART, ...over, effects: [effect] } as SpellDefinition));

  /**
   * SRD writes "the target repeats **the** save" — the one the spell already
   * asked for. An attack rolls an attack and a bare condition rolls nothing,
   * so neither has one to repeat.
   */
  it('refuses a repeat save on a host that rolled none', () => {
    const repeats = { at: 'end-of-turn', onSuccess: 'end-on-target' } as const;
    expect(
      problems({
        kind: 'attack',
        attack: 'ranged',
        damage: { dice: '2d6' },
        damageType: 'fire',
        conditions: [{ name: 'poisoned', repeats }],
      }),
    ).toContain('repeats_without_save');
    expect(
      problems({ kind: 'condition', condition: { name: 'poisoned', repeats } }),
    ).toContain('repeats_without_save');
  });

  /** And allows it on the two hosts that did roll one, or the rule is vacuous. */
  it('allows a repeat save on a host that rolled one', () => {
    const repeats = { at: 'end-of-turn', onSuccess: 'end-on-target' } as const;
    expect(
      problems({
        kind: 'save-damage',
        ability: 'con',
        damage: { dice: '2d6' },
        damageType: 'fire',
        onSuccess: 'half',
        conditions: [{ name: 'blinded', repeats }],
      }),
    ).toEqual([]);
    expect(
      problems({
        kind: 'save',
        ability: 'wis',
        condition: 'charmed',
        conditions: [{ name: 'prone', repeats }],
      }),
    ).toEqual([]);
  });

  /**
   * **The gap a rider can fall through**, and the reason Sunburst needed a
   * span of seconds rather than a duration on the spell.
   *
   * A rider the casting owns is cleaned up by `releaseCasting`, which runs
   * when the casting ends — and an Instantaneous spell never becomes an
   * ongoing casting at all, so nothing would ever end it. Fable asked whether
   * the catalogue already held one of these; it did not, which is what makes
   * this a guard rather than a fix.
   *
   * **The rule is `checkGrantLifetimes`, and it is one rule.** IE-013 and
   * IE-010 wrote it independently — once over the three standalone grant kinds
   * and once over the riders — and the one that survived is the broader:
   * `grantCarried` now reads every condition rider *and* the `modifiers` slot,
   * so a `buff`, a `roll-mode`, an `armor-class` and a rider are all one
   * `grant_without_lifetime`. Two codes for one defect would be the second
   * place to get one sentence wrong.
   */
  it('refuses a casting-owned rider on a spell that never becomes a casting', () => {
    expect(
      problems(
        {
          kind: 'save-damage',
          ability: 'con',
          damage: { dice: '2d6' },
          damageType: 'fire',
          onSuccess: 'half',
          conditions: [{ name: 'blinded' }],
        },
        {},
      ),
    ).toContain('grant_without_lifetime');
  });

  /**
   * **The second rider, not only the first.** A host carries several, and a
   * definition whose *second* condition had no deadline would have gone
   * unreported behind a first one that did — which is exactly the failure the
   * plural slot creates and the reason `grantCarried` walks the whole list.
   */
  it('refuses the rider with no lifetime even when an earlier one has one', () => {
    expect(
      problems(
        {
          kind: 'save-damage',
          ability: 'con',
          damage: { dice: '2d6' },
          damageType: 'fire',
          onSuccess: 'half',
          conditions: [{ name: 'blinded', lasts: { seconds: 60 } }, { name: 'prone' }],
        },
        {},
      ),
    ).toContain('grant_without_lifetime');
  });

  /**
   * And a `bonus` or `mode` rider on such a spell is refused outright, because
   * it can take neither escape: those two members carry no `lasts` and no
   * `outlivesCasting`, so there is no way to write one correctly on a casting
   * that is over the moment it resolves. Only `speed-change` has a deadline of
   * its own — `speed-grants.test.ts` drives both sides of that — so this is a
   * rule about the member rather than about the slot.
   */
  it('refuses a grant rider on a spell that never becomes a casting', () => {
    expect(
      problems(
        {
          kind: 'save',
          ability: 'wis',
          condition: 'charmed',
          outlivesCasting: true,
          modifiers: [
            {
              kind: 'mode',
              modifier: { mode: 'disadvantage', selector: { roll: 'attack', relation: 'roller' } },
            },
          ],
        },
        {},
      ),
    ).toContain('grant_without_lifetime');
  });

  it('accepts the same rider once it says how long it lasts', () => {
    for (const lasts of [{ seconds: 60 }, 'end-of-casters-next-turn'] as const) {
      expect(
        problems(
          {
            kind: 'save-damage',
            ability: 'con',
            damage: { dice: '2d6' },
            damageType: 'fire',
            onSuccess: 'half',
            conditions: [{ name: 'blinded', lasts }],
          },
          {},
        ),
      ).toEqual([]);
    }
  });

  /** Or that the casting never owned it in the first place: SRD Grease's Prone. */
  it('accepts a rider the casting causes and does not keep', () => {
    expect(
      problems(
        {
          kind: 'save',
          ability: 'dex',
          condition: 'prone',
          outlivesCasting: true,
        },
        {},
      ),
    ).toEqual([]);
  });

  /** A span of no seconds is the absence of a duration, not a short one. */
  it('refuses a rider that lasts no time at all', () => {
    expect(
      problems({
        kind: 'save',
        ability: 'wis',
        condition: 'charmed',
        conditions: [{ name: 'prone', lasts: { seconds: 0 } }],
      }),
    ).toContain('bad_rider_duration');
  });

  /** A modifier rider is `buff` and `roll-mode` minus their save, so it is held to their rules. */
  it('holds a modifier rider to the rules its standalone kind obeys', () => {
    expect(
      problems({
        kind: 'save',
        ability: 'wis',
        condition: 'charmed',
        modifiers: [{ kind: 'bonus', bonus: { source: 'x', dice: '1d4' }, applies: ['ac'], direction: 'add' }],
      }),
    ).toContain('rolled_armor_class');
    expect(
      problems({
        kind: 'save',
        ability: 'wis',
        condition: 'charmed',
        modifiers: [{ kind: 'bonus', bonus: { source: 'x', flat: 2 }, applies: [], direction: 'add' }],
      }),
    ).toContain('bonus_applies_to_nothing');
    expect(
      problems({
        kind: 'save',
        ability: 'wis',
        condition: 'charmed',
        modifiers: [
          { kind: 'mode', modifier: { mode: 'advantage', selector: { roll: 'saving-throw', relation: 'against-holder' } } },
        ],
      }).length,
    ).toBeGreaterThan(0);
  });

  /** And a grant that is neither is refused rather than silently applied as nothing. */
  it('refuses a rider that is neither a bonus nor a mode', () => {
    expect(
      codes(
        checkSpellDefinitionValue({
          ...FIRE_DART,
          durationSeconds: 60,
          effects: [
            {
              kind: 'save',
              ability: 'wis',
              condition: 'charmed',
              modifiers: [{ kind: 'resistance', to: 'fire' }],
            },
          ],
        }),
      ),
    ).toContain('unknown_modifier_rider');
  });
});

/**
 * A clause that varies an outcome by the target's creature type.
 *
 * SRD's glossary closes the list of types — "These are the game's creature
 * types", fourteen of them — and says the thing that makes this checkable:
 * "The types don't have rules themselves, but some rules in the game affect
 * creatures of certain types in different ways." So a clause naming
 * `Goblinoid` is naming a **subtype tag**, which has no rules at all, and one
 * naming `Plant` is naming a type the engine can compare a creature against.
 *
 * Nothing in the catalogue violates any of these — all three consumers were
 * driven through before the rules were written, as every rule here was — so
 * the only way to know they are guards is to build something that fails each,
 * which is what this does.
 */
describe('a clause that varies by creature type names a real one', () => {
  const save = (againstType: unknown): readonly string[] =>
    codes(
      checkSpellDefinitionValue({
        ...FIRE_DART,
        effects: [
          {
            kind: 'save-damage',
            ability: 'con',
            damage: { dice: '2d6' },
            damageType: 'fire',
            onSuccess: 'half',
            againstType,
          },
        ],
      }),
    );

  const smite = (againstType: unknown): readonly string[] =>
    codes(
      checkSpellDefinitionValue({
        ...FIRE_DART,
        effects: [
          { kind: 'attack-damage', damage: { dice: '2d8' }, damageType: 'radiant', againstType },
        ],
      }),
    );

  it('accepts the three clauses the SRD actually prints', () => {
    expect(save({ types: ['Plant'], outcome: 'automatic-failure' })).toEqual([]);
    expect(save({ types: ['Construct'], outcome: 'disadvantage' })).toEqual([]);
    expect(smite({ types: ['Fiend', 'Undead'], extraDice: '1d8' })).toEqual([]);
  });

  /** A subtype tag is not a type, which is the whole of the Goblin Warrior lesson. */
  it('refuses a subtype tag, and anything else off the glossary’s list', () => {
    expect(save({ types: ['Goblinoid'], outcome: 'disadvantage' })).toEqual([
      'unknown_creature_type',
    ]);
    expect(smite({ types: ['Humanoids'], extraDice: '1d8' })).toEqual(['unknown_creature_type']);
  });

  /**
   * A clause naming nobody varies nothing — the `ends_nothing` mistake
   * arriving on a third field, and it compiles just as readily.
   */
  it('refuses a clause that singles nobody out', () => {
    expect(save({ types: [], outcome: 'disadvantage' })).toEqual(['varies_by_nobody']);
    expect(smite({ types: [], extraDice: '1d8' })).toEqual(['varies_by_nobody']);
  });

  /** And a type named twice, which would apply one sentence twice over. */
  it('refuses the same type twice', () => {
    expect(save({ types: ['Plant', 'Plant'], outcome: 'automatic-failure' })).toEqual([
      'duplicate_creature_type',
    ]);
  });

  it('refuses an outcome the vocabulary does not have', () => {
    // Nothing in the book gives a *named type* Advantage on a save: the spells
    // that hand a save Advantage key it on "if you or your allies are fighting
    // it", which is a fact about the casting rather than about the creature.
    expect(save({ types: ['Construct'], outcome: 'advantage' })).toEqual(['bad_typed_outcome']);
  });

  /**
   * The extra die goes through `parseNotation` exactly as every other notation
   * does. `scaledDiceFor` never sees it — it does not scale — but
   * `rollAttackDamage` still throws it, and a malformed one silently rolls
   * nothing.
   */
  it('refuses an extra die that is not dice notation', () => {
    expect(smite({ types: ['Undead'], extraDice: 'a lot' })).toEqual(['bad_dice']);
  });

  /**
   * **It reports rather than throwing**, which is the rule a validator lives
   * or dies by: `parseSpellDefinition` takes `unknown`, so a clause that is a
   * string, or one missing the field its branch would read, has to come back
   * as a problem rather than as a `TypeError`. The re-review of the first
   * union task caught exactly that shape in a neighbouring branch.
   */
  it('reports a malformed clause instead of throwing on it', () => {
    expect(() => save('Plant')).not.toThrow();
    expect(save('Plant')).toEqual(['bad_typed_clause']);
    expect(() => smite({ extraDice: '1d8' })).not.toThrow();
    expect(smite({ extraDice: '1d8' })).toEqual(['bad_typed_clause']);
  });
});

/**
 * **A validator that throws on the input it exists to judge has judged
 * nothing**, driven over the whole branch table rather than argued one kind at
 * a time.
 *
 * `parseSpellDefinition` takes `unknown` and returns a `Result`. `checkShape`
 * establishes that an effect is an object naming a `kind` the engine knows —
 * and **nothing below that**, deliberately, because a field the engine does
 * not know is not an error. So every field a branch goes on to dereference can
 * arrive missing, null, or some other type entirely, and each one is a place
 * the semantic pass can crash instead of answering.
 *
 * Three instances of that were found one at a time — two branches in the
 * granted-defence task, and a real regression in `grantCarried`, where a loop
 * conversion dropped a null guard and the validator began throwing where it
 * had reported `unknown_condition`. Three is a class, so this sweeps the class
 * rather than waiting for the next instance.
 *
 * **It asserts the answer is a refusal, not merely that there was one.** A
 * sweep that only says "nothing threw" passes just as happily if the validator
 * ever starts *accepting* malformed input — the same hole from the other side,
 * and it was a live one: a `heal` whose `healing` was the string `'nonsense'`
 * validated clean, because the only reader of a scaling asked for `.dice`, got
 * `undefined` and skipped.
 *
 * **It pins no code and no collection order.** Which problem a malformed field
 * reports is the implementation's business, and the order problems collect in
 * is not a rule. What is load-bearing is that an answer comes back and that it
 * refuses. The cases that *do* pin codes are the ones below, where the point
 * is that a guard did not swallow the problem it was put there to guard.
 */
describe('every branch judges untyped input rather than throwing on it', () => {
  /**
   * Junk is **per field**, because a value that is wrong for one is right for
   * another: `7` is malformed as a `damage` and perfectly good as an
   * `armor-class` base. And `undefined` is junk only for a field its branch
   * requires — for an optional one it means absent, which is legal, and a row
   * asserting a refusal for it would assert the opposite of the rule.
   */
  const OBJECT_JUNK = [null, 'nonsense', 7, true] as const;
  const ARRAY_JUNK = [null, 'nonsense', 7, {}] as const;
  const STRING_JUNK = [null, 7, {}, []] as const;
  const NUMBER_JUNK = [null, 'nonsense', {}, []] as const;

  /**
   * **`{}` is junk for no object field here, and that is a scope line rather
   * than an oversight.**
   *
   * An empty object is perfectly *readable*, so the guard this task is about
   * has nothing to say about it. Refusing one takes a rule that a scaling
   * names its dice, or that an origin names its reach, or that a bonus names
   * its source — required-field rules, every one, and this pass adds none.
   * They are worth having: a scaling with no `dice` reaches `scaledDiceFor`,
   * which splits the notation and does arithmetic on the halves, so it becomes
   * `NaNd6` and the spell silently rolls nothing. That is reported as a
   * finding rather than fixed here.
   */

  const required = (junk: readonly unknown[]): readonly unknown[] => [undefined, ...junk];

  const BRANCHES: readonly {
    readonly kind: string;
    readonly base: Record<string, unknown>;
    readonly fields: Readonly<Record<string, readonly unknown[]>>;
  }[] = [
    {
      kind: 'attack',
      base: { kind: 'attack', attack: 'ranged', damage: { dice: '2d6' }, damageType: 'fire' },
      fields: {
        damage: required(OBJECT_JUNK),
        damageType: required(STRING_JUNK),
        conditions: ARRAY_JUNK,
        modifiers: ARRAY_JUNK,
        delayed: OBJECT_JUNK,
      },
    },
    {
      kind: 'save-damage',
      base: {
        kind: 'save-damage',
        ability: 'con',
        damage: { dice: '2d6' },
        damageType: 'fire',
        onSuccess: 'half',
      },
      fields: {
        damage: required(OBJECT_JUNK),
        damageType: required(STRING_JUNK),
        againstType: OBJECT_JUNK,
        plus: ARRAY_JUNK,
        conditions: ARRAY_JUNK,
        modifiers: ARRAY_JUNK,
        delayed: OBJECT_JUNK,
      },
    },
    {
      kind: 'attack-damage',
      base: { kind: 'attack-damage', damage: { dice: '2d8' }, damageType: 'radiant' },
      fields: {
        damage: required(OBJECT_JUNK),
        damageType: required(STRING_JUNK),
        againstType: OBJECT_JUNK,
      },
    },
    {
      kind: 'save',
      base: { kind: 'save', ability: 'wis', condition: 'prone', outlivesCasting: true },
      fields: {
        condition: required(STRING_JUNK),
        check: OBJECT_JUNK,
        lasts: OBJECT_JUNK,
        conditions: ARRAY_JUNK,
        modifiers: ARRAY_JUNK,
        delayed: OBJECT_JUNK,
      },
    },
    {
      kind: 'condition',
      base: { kind: 'condition', condition: { name: 'invisible', outlivesCasting: true } },
      fields: { condition: required(OBJECT_JUNK) },
    },
    {
      kind: 'end-condition',
      base: { kind: 'end-condition', conditions: ['poisoned'] },
      fields: { conditions: required(ARRAY_JUNK) },
    },
    {
      kind: 'heal',
      base: { kind: 'heal', healing: { dice: '1d8' } },
      fields: { healing: required(OBJECT_JUNK) },
    },
    {
      kind: 'temp-hp',
      base: { kind: 'temp-hp', amount: { dice: '1d4' } },
      fields: { amount: required(OBJECT_JUNK) },
    },
    {
      kind: 'buff',
      base: { kind: 'buff', bonus: { source: 'Fire Dart', flat: 1 }, applies: ['attack'] },
      fields: { bonus: required(OBJECT_JUNK), applies: required(ARRAY_JUNK) },
    },
    {
      kind: 'roll-mode',
      base: {
        kind: 'roll-mode',
        modifier: {
          mode: 'advantage',
          selector: { roll: 'saving-throw', relation: 'roller', ability: 'wis' },
        },
      },
      fields: { modifier: required(OBJECT_JUNK) },
    },
    {
      kind: 'armor-class',
      base: { kind: 'armor-class', base: 13, plusAbility: 'dex' },
      fields: { base: required(NUMBER_JUNK) },
    },
    {
      kind: 'damage-defense',
      base: { kind: 'damage-defense', damageTypes: ['fire'], defense: 'resistant' },
      fields: { damageTypes: required(ARRAY_JUNK), defense: required(STRING_JUNK) },
    },
    {
      kind: 'speed',
      base: { kind: 'speed', change: 'add', feet: 10 },
      // `feet` is `NUMBER_JUNK` rather than `required(NUMBER_JUNK)` where the
      // change is `add`: absent is exactly the case the pairing rule refuses,
      // and it is asserted by name below rather than swept as junk.
      fields: { change: required(STRING_JUNK), feet: NUMBER_JUNK },
    },
  ];

  /**
   * The fixtures are real, which is what makes every row below mean anything.
   *
   * A base that was itself malformed would make the sweep pass for the wrong
   * reason: every row would refuse, and none of them because of the junk.
   */
  it.each(BRANCHES.map((b) => [b.kind, b.base] as const))(
    'starts from a %s the validator accepts',
    (_kind, base) => {
      expect(
        checkSpellDefinitionValue({ ...FIRE_DART, durationSeconds: 60, effects: [base] }),
      ).toEqual([]);
    },
  );

  /**
   * `dispel` and `interrupt-casting` contribute no rows, and that is the
   * honest entry rather than an omission: their branches read no field at all,
   * so the `kind` `checkShape` has already established is the whole effect and
   * there is nothing below it to be malformed.
   */
  const READ_NO_FIELD: ReadonlySet<string> = new Set(['dispel', 'interrupt-casting']);

  /**
   * **The table is held against the union, in both directions.**
   *
   * `BRANCHES` is an enumeration of what the runtime derives, and every one of
   * those this repository has written down has eventually disagreed with its
   * source — which is the subject of the change this test belongs to. It is
   * exact today; what makes that worth anything is that a *fifteenth* kind
   * cannot arrive without a row. Five tasks are queued behind this one on this
   * very file, and each adds to `checkEffect`: without this, such a kind gets
   * a branch, no sweep row, no base-validity row — because that one is
   * generated from the same table — and no failure anywhere.
   *
   * The two exclusions are named rather than subtracted silently, so the prose
   * above is an exemption the test checks rather than one a reader has to
   * believe, which is the form every other exemption list here takes. Reading
   * it in reverse is what catches a kind *removed* from the union while its
   * row stayed.
   */
  it('covers every effect kind the engine declares, or names why not', () => {
    const covered = new Set(BRANCHES.map((b) => b.kind));
    expect([...covered, ...READ_NO_FIELD].sort()).toEqual([...EFFECT_KINDS].sort());
    // And the exclusions are real rather than a way of shrinking the table:
    // neither names a field, so neither could contribute a row.
    for (const kind of READ_NO_FIELD) expect(covered.has(kind)).toBe(false);
  });

  const rows = BRANCHES.flatMap(({ kind, base, fields }) =>
    Object.entries(fields).flatMap(([field, junk]) =>
      junk.map(
        (value) =>
          [`${kind}.${field} = ${JSON.stringify(value) ?? 'undefined'}`, base, field, value] as const,
      ),
    ),
  );

  it.each(rows)('answers with a refusal for %s', (_label, base, field, value) => {
    // Both lifetimes, because the rule that reads a rider a second time
    // returns early the moment a casting persists — which is exactly what kept
    // `grantCarried`'s unguarded walk out of reach of the case that found it.
    for (const lifetime of [{ durationSeconds: 60 }, {}]) {
      const definition = { ...FIRE_DART, ...lifetime, effects: [{ ...base, [field]: value }] };
      let parsed: ReturnType<typeof parseSpellDefinition> | undefined;
      expect(() => {
        parsed = parseSpellDefinition(definition);
      }).not.toThrow();
      expect(isErr(parsed!)).toBe(true);
    }
  });

  /**
   * **The same class, one level up**, because the contract is
   * `parseSpellDefinition(unknown)` rather than `checkEffect(unknown)`.
   *
   * `checkShape` establishes six primitives, a `range`, a `targets` and the
   * effect list — and nothing else the semantic pass goes on to read. So an
   * `areaTrigger` that is a string reached `.effects.length`, an `activation`
   * that is a number reached the same, and a `damageTypeStated` that is an
   * object reached `.forEach`. Each is the branch table's defect at the
   * definition's own fields, and each threw out of the `Result` half exactly
   * as the branches did.
   *
   * `durationUntil` and a **null** `unmodelled` are deliberately absent from
   * this table. Nothing dereferences the first, and the second has been read
   * as *absent* through `??` since it was written — a reading this task has no
   * business changing, because making it a refusal would be a new rule rather
   * than a guard.
   */
  const TOP_LEVEL: readonly (readonly [string, unknown])[] = [
    ['area', null],
    ['targetsWithin', null],
    ...([null, 'nonsense', 7, [], {}] as const).map(
      (junk) => ['areaTrigger', junk] as readonly [string, unknown],
    ),
    ...([null, 'nonsense', 7, [], {}] as const).map(
      (junk) => ['activation', junk] as readonly [string, unknown],
    ),
    // `{}` is deliberately not among the origin's junk. An empty object is
    // *readable* — the guard's question is whether fields can be taken off a
    // value, and they can — and refusing it would take a rule saying an origin
    // names a reach, which is a required-field rule rather than a guard
    // against a throw. That is a different task's to add.
    ...([null, 'nonsense', 7, []] as const).map(
      (junk) => ['origin', junk] as readonly [string, unknown],
    ),
    ...([null, 'nonsense', 7, {}] as const).map(
      (junk) => ['damageTypeStated', junk] as readonly [string, unknown],
    ),
    ...(['nonsense', 7, {}] as const).map(
      (junk) => ['unmodelled', junk] as readonly [string, unknown],
    ),
    // IE-032's trigger list, which `checkEndsEarly` walks: a value that is not
    // a list reaches `.forEach`, and an entry that is not an object is
    // destructured for `on` and `ends`. Both restore a throw out of the
    // `Result` half if their guard goes, which is the class this table exists
    // to close and the reason a new list-valued field joins it.
    ...([null, 'nonsense', 7, {}] as const).map(
      (junk) => ['endsEarly', junk] as readonly [string, unknown],
    ),
  ];

  it.each(TOP_LEVEL)('answers with a refusal for a definition whose %s is %s', (field, value) => {
    const definition = { ...FIRE_DART, [field]: value };
    let parsed: ReturnType<typeof parseSpellDefinition> | undefined;
    expect(() => {
      parsed = parseSpellDefinition(definition);
    }).not.toThrow();
    expect(isErr(parsed!)).toBe(true);
  });

  /**
   * **One level down, which is where the table above stops.**
   *
   * Every row above replaces the *top* field of an effect, so a guard that
   * only fires on a malformed value **inside** one is never executed by any of
   * them — and four were: the notation inside a scaling, the notation inside a
   * bonus, a selector that is not an object, and a note inside `unmodelled`.
   * Each replaces a real throw, because the reader underneath is a string
   * operation: `parseNotation` calls `.replace`, `ROLL_FAMILIES.has` reads
   * `selector.roll`, and a note is `.trim()`ed. Branch coverage is what found
   * them; deleting any one of them left the whole suite green.
   *
   * They are separate rows rather than a deeper generator because there is no
   * general "one level down" — each is a specific field a specific reader
   * dereferences, and naming them is what makes a fifth one an addition
   * somebody has to write rather than a case a loop silently covers.
   */
  it.each([
    ['a notation inside a scaling', { kind: 'heal', healing: { dice: 7 } }],
    [
      'a growth notation inside a scaling',
      { kind: 'heal', healing: { dice: '1d8', perSlotLevelAbove: 7 } },
    ],
    [
      'a notation inside a bonus',
      { kind: 'buff', bonus: { source: 'Fire Dart', dice: 7 }, applies: ['attack'] },
    ],
    [
      'a selector that is not an object',
      { kind: 'roll-mode', modifier: { mode: 'advantage', selector: null } },
    ],
    [
      'a notation inside a delayed hit',
      {
        kind: 'save-damage',
        ability: 'con',
        damage: { dice: '2d6' },
        damageType: 'fire',
        onSuccess: 'half',
        delayed: { damage: { dice: 7 }, damageType: 'acid' },
      },
    ],
    [
      'an extra damage component that is not an object',
      {
        kind: 'save-damage',
        ability: 'con',
        damage: { dice: '2d6' },
        damageType: 'fire',
        onSuccess: 'half',
        plus: [null],
      },
    ],
  ] as const)('answers with a refusal for %s', (_what, effect) => {
    let parsed: ReturnType<typeof parseSpellDefinition> | undefined;
    expect(() => {
      parsed = parseSpellDefinition({ ...FIRE_DART, durationSeconds: 60, effects: [effect] });
    }).not.toThrow();
    expect(isErr(parsed!)).toBe(true);
  });

  /**
   * And the same, one level down inside the definition's own fields.
   *
   * `unmodelled` is a list of notes and the walk `.trim()`s each one, so a
   * list whose *entry* is not a string threw where a list that was not a list
   * at all is caught by the row above.
   */
  it('answers with a refusal for a note that is not a string', () => {
    let parsed: ReturnType<typeof parseSpellDefinition> | undefined;
    expect(() => {
      parsed = parseSpellDefinition({ ...FIRE_DART, unmodelled: [7] });
    }).not.toThrow();
    expect(isErr(parsed!)).toBe(true);
  });

  /**
   * And the same for a trigger list, whose entries are destructured for `on`
   * and `ends`. `readsAsObject` is what stops a `null` there being read for
   * two fields, and the row above — which replaces the list itself — never
   * reaches it. Same shape as the note, and the same reason for a row of its
   * own.
   */
  it.each([[null], ['nonsense'], [7], [[]]])(
    'answers with a refusal for a trigger that is %s',
    (junk) => {
      let parsed: ReturnType<typeof parseSpellDefinition> | undefined;
      expect(() => {
        parsed = parseSpellDefinition({ ...FIRE_DART, durationSeconds: 60, endsEarly: [junk] });
      }).not.toThrow();
      expect(isErr(parsed!)).toBe(true);
    },
  );

  /**
   * **`undefined` is absent; everything else is read against the declared
   * type**, and `null` is the case where that had two answers.
   *
   * A rider slot that was null reported, and `unmodelled` read it as absent
   * through `??` — one question, two answers, decided here in favour of
   * reporting. `null` is not a member of `readonly string[] | undefined`, and
   * a value the compiler would refuse is what a validator over untyped input
   * exists to name. No definition carries a null anywhere, so nothing that
   * existed depends on the reading that changed.
   */
  it('reports a null where an optional list belongs, rather than reading it as absent', () => {
    expect(codes(checkSpellDefinitionValue({ ...FIRE_DART, unmodelled: null }))).toEqual([
      'malformed_field',
    ]);
  });

  /**
   * **Every effect list's entries, not just the definition's own.**
   *
   * `checkEffect` is one function reached from three lists, so the guarantee
   * its branches rest on — an entry is an object naming a `kind` this engine
   * knows — has to hold for all three or for none. It held for one:
   * `checkShape` walked `effects` and nothing walked `areaTrigger.effects` or
   * `activation.effects`, whose entries went straight to a `switch` on
   * `effect.kind`. A `null` there threw; a string, a number, a list or an
   * unknown kind was accepted with no problem at all, which is the same defect
   * seen from the other side.
   *
   * The codes asserted are the **shape phase's**, because that is where the
   * rule now lives and `parseSpellDefinition` returns on it — the same answer
   * the definition's own list has always given for the same input.
   */
  const AREA = { kind: 'cube', size: 20, origin: 'point' } as const;
  const TRIGGER = { at: 'end-of-turn', label: 'Fire Dart (the embers)' } as const;
  const nestedIn = (where: 'areaTrigger' | 'activation', effects: unknown): unknown =>
    where === 'areaTrigger'
      ? { ...FIRE_DART, durationSeconds: 60, area: AREA, areaTrigger: { ...TRIGGER, effects } }
      : {
          ...FIRE_DART,
          durationSeconds: 60,
          activation: {
            action: 'action',
            range: { kind: 'touch' },
            label: 'Fire Dart (again)',
            effects,
          },
        };

  it.each(['areaTrigger', 'activation'] as const)(
    'establishes the entries of %s.effects as it does its own',
    (where) => {
      // The list is real, so nothing here is the container being malformed.
      expect(checkSpellDefinitionValue(nestedIn(where, FIRE_DART.effects))).toEqual([]);

      for (const entry of [null, 'nonsense', 7, [], { kind: 'not-a-kind' }] as const) {
        const what = `${where} holding ${JSON.stringify(entry) ?? 'undefined'}`;

        let parsed: ReturnType<typeof parseSpellDefinition> | undefined;
        expect(() => {
          parsed = parseSpellDefinition(nestedIn(where, [entry]));
        }, what).not.toThrow();
        expect(isErr(parsed!), what).toBe(true);

        // **The same answer the definition's own list gives**, asserted
        // against it rather than transcribed — which is what "as it does its
        // own" actually claims, and the only form of it that cannot drift if
        // the entry rules are ever changed. Writing the codes out by hand got
        // `[]` wrong: an array is an object, so it reaches the `kind` check
        // and comes back `unknown_effect` rather than `not_an_effect`.
        expect(codes(checkSpellDefinitionValue(nestedIn(where, [entry]))), what).toEqual(
          codes(checkSpellDefinitionValue({ ...FIRE_DART, effects: [entry] })),
        );
      }
    },
  );

  /**
   * **A rider is a leaf in all three lists, which is the larger half of what
   * that walk was missing.**
   *
   * `checkNoNestedEffect` is entered only from the list walk, so a rider
   * carrying `effects`, `targets`, `targetsWithin` or `area` — the fields that
   * would make it a parent — validated clean whenever it sat in a nested list.
   * CLAUDE.md named the validator as one of the three places that enforce the
   * invariant, and the validator enforced it on one list of three; the sweep
   * further down this file walks all three, which is why the catalogue is
   * clean and why nothing caught it.
   */
  it.each(['areaTrigger', 'activation'] as const)(
    'enforces that a rider is a leaf inside %s.effects',
    (where) => {
      const parented = {
        kind: 'save',
        ability: 'wis',
        condition: 'prone',
        outlivesCasting: true,
        conditions: [{ name: 'blinded', outlivesCasting: true, targets: ['someone-else'] }],
      };
      expect(codes(checkSpellDefinitionValue(nestedIn(where, [parented])))).toContain(
        'nested_effect',
      );
    },
  );

  /**
   * The mode is read once, whatever the selector is.
   *
   * It used to be two copies — one in the readable path and one inside the
   * guard — and branch coverage showed nothing reached the second, which is
   * the copy that would have drifted. This is the case that reaches it: a
   * modifier that is wrong about *both*, whose two problems come back
   * together.
   */
  it('reports a bad mode beside an unreadable selector', () => {
    const problems = checkSpellDefinitionValue({
      ...FIRE_DART,
      durationSeconds: 60,
      effects: [{ kind: 'roll-mode', modifier: { mode: 'normal', selector: null } }],
    });
    expect(codes(problems)).toContain('malformed_field');
    expect(codes(problems)).toContain('bad_roll_mode');
  });

  /**
   * **A guard that swallowed the problem it guards would be worse than the
   * throw**, and nothing above could tell: every row asserts a refusal, and a
   * guard that reported `malformed_field` and then skipped the real rule would
   * go on refusing for a reason that had stopped being true.
   *
   * So each rule that now sits behind a guard is driven with input the guard
   * lets *through* — the shape the rule was always about — and the code it has
   * always reported is asserted by name.
   */
  it.each([
    [
      'dice that do not parse, behind the scaling guard',
      { kind: 'heal', healing: { dice: 'a lot' } },
      'bad_dice',
    ],
    [
      'a rolled Armour Class, behind the bonus guard',
      {
        kind: 'buff',
        bonus: { source: 'Fire Dart', dice: '1d4' },
        applies: ['ac'],
      },
      'rolled_armor_class',
    ],
    [
      'a bonus that applies to nothing, behind the applies guard',
      { kind: 'buff', bonus: { source: 'Fire Dart', flat: 1 }, applies: [] },
      'bonus_applies_to_nothing',
    ],
    [
      'a selector naming no roll the engine makes, behind the modifier guard',
      {
        kind: 'roll-mode',
        modifier: { mode: 'advantage', selector: { roll: 'd20-test', relation: 'roller' } },
      },
      'bad_roll_family',
    ],
    [
      'a removal that ends nothing, behind the condition-list guard',
      { kind: 'end-condition', conditions: [] },
      'ends_nothing',
    ],
    [
      'a removal naming a condition twice, behind the same guard',
      { kind: 'end-condition', conditions: ['poisoned', 'poisoned'] },
      'duplicate_condition',
    ],
    [
      'a defence that defends nothing, behind the damage-type guard',
      { kind: 'damage-defense', damageTypes: [], defense: 'resistant' },
      'defends_nothing',
    ],
    [
      'a defence that is not one of the three, beside an unreadable list',
      { kind: 'damage-defense', damageTypes: 7, defense: 'tough' },
      'unknown_defense',
    ],
    [
      'a rider lasting no seconds, behind the duration guard',
      {
        kind: 'save',
        ability: 'wis',
        condition: 'prone',
        lasts: { seconds: 0 },
      },
      'bad_rider_duration',
    ],
    [
      'a check whose skill belongs to another ability, behind the check guard',
      {
        kind: 'save',
        ability: 'wis',
        condition: 'restrained',
        outlivesCasting: true,
        check: { ability: 'str', skill: 'investigation', onSuccess: 'end-on-target' },
      },
      'skill_ability_mismatch',
    ],
    [
      'an extra damage component with an unknown type, behind the plus guard',
      {
        kind: 'save-damage',
        ability: 'con',
        damage: { dice: '2d6' },
        damageType: 'fire',
        onSuccess: 'half',
        plus: [{ damage: { dice: '1d6' }, damageType: 'sonic' }],
      },
      'unknown_damage_type',
    ],
    [
      'a later hit with dice that do not parse, behind the delayed guard',
      {
        kind: 'save-damage',
        ability: 'con',
        damage: { dice: '2d6' },
        damageType: 'fire',
        onSuccess: 'half',
        delayed: { damage: { dice: 'later' }, damageType: 'acid' },
      },
      'bad_dice',
    ],
  ] as const)('still reports %s', (_what, effect, code) => {
    const problems = checkSpellDefinitionValue({
      ...FIRE_DART,
      durationSeconds: 60,
      effects: [effect],
    });
    expect(codes(problems)).toContain(code);
  });

  /**
   * A rider slot that is unreadable is reported **once**, and the lifetime
   * rule keeps quiet about it.
   *
   * `typeof [] === 'object'` and an array is not null, so a rider that was a
   * list walked straight past `grantCarried`'s readability guard, found no
   * `lasts` and no `outlivesCasting`, and drew a second problem about "the
   * undefined condition" — a grant it never carried, reported beside the real
   * complaint. Cosmetic, because the first problem is the one a caller reads;
   * worth closing, because the next reader of that list has no way to tell a
   * real grant from this.
   */
  it('reports a rider that is a list once, not twice', () => {
    const problems = checkSpellDefinitionValue({
      ...FIRE_DART,
      effects: [
        {
          kind: 'condition',
          condition: [],
        },
      ],
    });
    // Both halves, because the absence on its own would be satisfied by an
    // effect that reported nothing at all.
    expect(codes(problems)).toContain('unknown_condition');
    expect(codes(problems)).not.toContain('grant_without_lifetime');
  });

  /**
   * The code a malformed field reports, named once.
   *
   * The sweep above deliberately pins none, which leaves the *spelling* of
   * `malformed_field` held by nothing — and `refusal-sweep.test.ts` cannot see
   * it either, because it is never an `err(` literal: `parseSpellDefinition`
   * passes `first.code` through as a variable. A code is observable behaviour
   * a tool surface branches on, so one representative case names it, and the
   * path is asserted beside it because the path is what tells an author which
   * field was unreadable.
   */
  it('names the code and the field a malformed value reports', () => {
    const problems = checkSpellDefinitionValue({
      ...FIRE_DART,
      effects: [{ kind: 'heal', healing: 'nonsense' }],
    });
    expect(problems).toEqual([
      expect.objectContaining({ field: 'effects[0].healing', code: 'malformed_field' }),
    ]);
  });
});

/**
 * The creature type a spell demands is one of the SRD's fourteen.
 *
 * SRD 5.2.1 prints a Goblin Warrior as "Small Fey (Goblinoid)". The glossary
 * gives the fourteen types rules and gives a subtype tag none at all, so a
 * spell demanding a tag names nobody — `isCreatureType` compares the type and
 * never a substring of it, which is what makes a tag unmatchable rather than
 * loosely matchable.
 *
 * The asymmetry this closes was one field wide: `againstType.types` had been
 * held to the glossary since it arrived, and `mustBeType` was a bare string
 * beside it, so `mustBeType: 'Goblinoid'` validated while
 * `againstType.types: ['Goblinoid']` did not. One question, two answers.
 */
describe('the creature type a spell demands is one the glossary gives rules to', () => {
  const targeting = (mustBeType: unknown): readonly string[] =>
    codes(checkSpellDefinitionValue({ ...FIRE_DART, targets: { count: 1, mustBeType } }));

  it('accepts a type the SRD prints', () => {
    expect(targeting('Fey')).toEqual([]);
    expect(targeting('Humanoid')).toEqual([]);
  });

  it('refuses a subtype tag, as the outcome clause already does', () => {
    expect(targeting('Goblinoid')).toEqual(['unknown_creature_type']);
  });

  /** Case is the SRD's, and a plural is not a type either. */
  it('refuses anything else off the glossary’s list', () => {
    expect(targeting('humanoid')).toEqual(['unknown_creature_type']);
    expect(targeting('Humanoids')).toEqual(['unknown_creature_type']);
  });

  /** And it judges untyped input here too, rather than waving it through. */
  it('refuses a demand that is not a name at all', () => {
    expect(targeting(7)).toEqual(['unknown_creature_type']);
    expect(targeting(null)).toEqual(['unknown_creature_type']);
  });

  /** Absent is the ordinary case: most spells demand no type at all. */
  it('accepts a spell that demands no type', () => {
    expect(targeting(undefined)).toEqual([]);
  });
});

describe('the fought clause is refused everywhere it could not be read', () => {
  /**
   * SRD Charm Person: "It does so with Advantage if you or your allies are
   * fighting it." The fact is stated at the casting, so the clause has exactly
   * one home — the casting's own saving throw — and the validator refuses the
   * two ways it could sit somewhere nothing would read it.
   *
   * The second rule guards a silent wrong number rather than tidiness: an area
   * trigger settles a minute later off an `OngoingSpell` that carries no
   * stated fact, so a clause written there would simply never apply, and no
   * test of that spell would say so.
   */
  const inList = (where: 'effects' | 'areaTrigger' | 'activation', effect: unknown) =>
    codes(
      checkSpellDefinitionValue(
        where === 'effects'
          ? { ...FIRE_DART, effects: [effect] }
          : { ...FIRE_DART, [where]: { effects: [effect] } },
      ),
    );

  /**
   * `outlivesCasting`, because `FIRE_DART` is Instantaneous and a condition the
   * casting owned would have nothing to end it — `grant_without_lifetime`,
   * which is a different rule and would drown out this one.
   */
  const SAVE = { kind: 'save', ability: 'wis', condition: 'charmed', outlivesCasting: true };

  it('accepts it on the casting’s own saving throw', () => {
    expect(inList('effects', { ...SAVE, advantageIfFought: true })).toEqual([]);
  });

  it('refuses it on a host that rolls no saving throw', () => {
    expect(
      inList('effects', {
        kind: 'attack',
        damage: { dice: '1d10' },
        damageType: 'fire',
        advantageIfFought: true,
      }),
    ).toEqual(['fought_without_save']);
  });

  it('refuses it inside an area trigger, where no stated fact reaches it', () => {
    expect(inList('areaTrigger', { ...SAVE, advantageIfFought: true })).toEqual([
      'fought_outside_the_casting',
    ]);
  });

  it('refuses it inside an activation, for the same reason', () => {
    expect(inList('activation', { ...SAVE, advantageIfFought: true })).toEqual([
      'fought_outside_the_casting',
    ]);
  });

  /**
   * Absence is how a spell says it does not print the clause, so `false` would
   * be a second way to say it — and a definition that wrote one would read as
   * though it had answered the question a *casting* answers.
   */
  it('refuses any value but true', () => {
    expect(inList('effects', { ...SAVE, advantageIfFought: false })).toEqual(['malformed_field']);
    expect(inList('effects', { ...SAVE, advantageIfFought: 'yes' })).toEqual(['malformed_field']);
  });

  /** And a save that says nothing is the ordinary case. */
  it('accepts a saving throw that does not print it', () => {
    expect(inList('effects', SAVE)).toEqual([]);
  });
});
