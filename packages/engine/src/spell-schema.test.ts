import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isErr } from '@ie/shared';
import { SPELL_DEFINITIONS, type SpellDefinition } from './spell-definitions.js';
import {
  checkSpellDefinition,
  checkSpellDefinitionValue,
  parseSpellDefinition,
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
        condition: { name: 'poisoned' },
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
        effects: [{ kind: 'armor-class', base: 0, plusAbility: 'dex', shieldAllowed: true }],
      }),
    ).toEqual(['bad_armor_class']);
  });
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
  const problems = (effect: unknown): readonly SpellDefinitionProblem[] =>
    checkSpellDefinition({ ...FIRE_DART, effects: [effect] } as SpellDefinition);

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
        condition: { name: 'bewildered' },
      },
      'effects[0].condition.name',
    ],
    [
      'save-damage',
      {
        kind: 'save-damage',
        ability: 'dex',
        damage: { dice: '2d6' },
        damageType: 'fire',
        onSuccess: 'none',
        condition: { name: 'bewildered' },
      },
      'effects[0].condition.name',
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
   */
  it('reports a condition effect whose rider is missing', () => {
    const parsed = parseSpellDefinition({ ...FIRE_DART, effects: [{ kind: 'condition' }] });
    expect(isErr(parsed)).toBe(true);
    if (isErr(parsed)) expect(parsed.code).toBe('unknown_condition');
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

/**
 * The rule the whole architecture rests on, asserted rather than assumed.
 *
 * A spell's mechanics are read out of its definition and nowhere else. The
 * moment the runtime grows `if (spellId === 'fireball')` the definitions stop
 * being the description of the spell and become a hint, which is the failure
 * mode the comparative audit found in one reference implementation and warned
 * against in the other.
 */
describe('no spell is special-cased in the runtime', () => {
  const here = fileURLToPath(new URL('.', import.meta.url));

  /**
   * Every file a special case could be written in, named one at a time so a
   * failure says which.
   *
   * **The command layer is a directory listing, not `commands.ts`.** That file
   * is a re-export barrel now: naming it would scan a hundred-odd lines of
   * `export { … } from` and pass over the ten thousand where
   * `if (spellId === 'fireball')` would actually be written — a sweep still
   * green over an empty population, which is the `animals.md` failure mode
   * arriving in the sweep that names it. A listing also means a module added
   * tomorrow is scanned without anybody remembering to add it.
   */
  const RUNTIME = [
    ...readdirSync(`${here}commands`)
      .filter((file) => file.endsWith('.ts'))
      .map((file) => `commands/${file}`),
    'events.ts',
    'spells.ts',
    'spellcasting.ts',
    'standing.ts',
  ];
  const source = (file: string): string => readFileSync(`${here}${file}`, 'utf8');

  /**
   * Ids that are also ordinary engine vocabulary.
   *
   * `shield` is a spell and an armour category, and `category === 'shield'`
   * is equipment code that has nothing to do with the spell. Named rather than
   * matched loosely, so the exclusion is one reviewed word instead of a
   * heuristic that quietly stops catching things.
   */
  const ALSO_VOCABULARY: ReadonlySet<string> = new Set(['shield']);

  it.each(RUNTIME.map((file) => [file] as const))(
    '%s branches on no spell id',
    (file) => {
      // The direct shape: a spell id compared against a **literal**. Two
      // spell ids compared with each other is ordinary lookup and is not this.
      const compared = /(spellId|definition\.id|record\.spellId|spell\.id)\s*[=!]==\s*['"]/.exec(
        source(file),
      );
      expect(compared?.[0] ?? null, file).toBeNull();
    },
  );

  it.each(RUNTIME.map((file) => [file] as const))(
    '%s names no spell of the catalogue',
    (file) => {
      const text = source(file);
      const named = SPELL_DEFINITIONS.map((d) => d.id)
        .filter((id) => !ALSO_VOCABULARY.has(id))
        .filter((id) => text.includes(`'${id}'`) || text.includes(`"${id}"`));
      expect(named, file).toEqual([]);
    },
  );

  it('would find one if there were one, so the sweep is not vacuous', () => {
    const ids = SPELL_DEFINITIONS.map((d) => d.id);
    expect(ids).toContain('fireball');
    expect(ids).toContain('mage-armor');
    // Driven rather than trusted: the same predicate, over a line that does
    // exactly what the rule forbids.
    const smuggled = "if (request.spellId === 'fireball') return err('no');";
    expect(/(spellId|definition\.id|record\.spellId|spell\.id)\s*[=!]==\s*['"]/.test(smuggled)).toBe(
      true,
    );
    expect(ids.filter((id) => smuggled.includes(`'${id}'`))).toEqual(['fireball']);
  });

  /** And the exclusion is real rather than a blanket: `shield` is equipment. */
  it('excludes only a word the engine uses for something else', () => {
    expect([...ALSO_VOCABULARY]).toEqual(['shield']);
    expect(source('events.ts')).toContain("category === 'shield'");
  });
});
