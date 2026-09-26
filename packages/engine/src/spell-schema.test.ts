import { readFileSync, readdirSync } from 'node:fs';
import { SPELL_DEFINITIONS, SRD_CONTENT } from '@ie/content';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { linesOf } from '../../../test-support/lines.js';
import { isErr } from '@ie/shared';
import { WEAPON_MASTERIES } from '@ie/srd';
import { TURN_MOMENTS } from './time.js';
import { type SpellDefinition } from './spell-definitions.js';
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

  /**
   * An amount may say a flat number and no notation — "you gain 10 Temporary
   * Hit Points" — but an amount that says neither is nothing at all, and
   * `scaledDiceFor` plus `scaledFlatFor` would resolve it to a silent zero.
   */
  it('refuses an amount with neither dice nor a flat number', () => {
    expect(
      only({
        effects: [
          { kind: 'attack', attack: 'ranged', damage: {}, damageType: 'fire' },
        ],
      }),
    ).toEqual(['amounts_to_nothing']);
  });

  it('refuses a flat amount whose flat is not a number', () => {
    expect(
      only({
        effects: [
          { kind: 'attack', attack: 'ranged', damage: { flat: '10' }, damageType: 'fire' },
        ],
      }),
    ).toEqual(['amounts_to_nothing']);
  });

  it('accepts an amount that is a flat number and no dice', () => {
    expect(
      only({
        effects: [
          { kind: 'attack', attack: 'ranged', damage: { flat: 10 }, damageType: 'fire' },
        ],
      }),
    ).toEqual([]);
  });

  /**
   * The two *dice* scaling fields add dice to a base notation, and an amount
   * with no notation has none to add them to: `scaledDiceFor` would have to
   * invent the die they are counted in. `flatPerSlotLevelAbove` is the one
   * that survives, because `scaledFlatFor` never looks at the dice.
   */
  it('refuses per-slot dice on an amount that rolls none', () => {
    expect(
      only({
        effects: [
          {
            kind: 'attack',
            attack: 'ranged',
            damage: { flat: 10, perSlotLevelAbove: '1d6' },
            damageType: 'fire',
          },
        ],
      }),
    ).toEqual(['scaling_without_dice']);
  });

  it('refuses a Cantrip Upgrade on an amount that rolls none', () => {
    expect(
      only({
        level: 0,
        effects: [
          {
            kind: 'attack',
            attack: 'ranged',
            damage: { flat: 10, cantripUpgradesAt: [5, 11, 17] },
            damageType: 'fire',
          },
        ],
      }),
    ).toEqual(['scaling_without_dice']);
  });

  it('accepts a flat amount that grows flatly with the slot', () => {
    expect(
      only({
        effects: [
          {
            kind: 'attack',
            attack: 'ranged',
            damage: { flat: 10, flatPerSlotLevelAbove: 5 },
            damageType: 'fire',
          },
        ],
      }),
    ).toEqual([]);
  });

  /**
   * A delayed hit is a debt filed as a notation and rolled at the boundary it
   * falls due — `ScheduledDamage.notation` — so an amount with no dice has
   * nothing for the schedule to carry and nothing to roll when it arrives.
   */
  it('refuses a delayed hit that rolls nothing', () => {
    expect(
      only({
        effects: [
          {
            kind: 'attack',
            attack: 'ranged',
            damage: { dice: '2d6' },
            damageType: 'fire',
            delayed: { damage: { flat: 4 }, damageType: 'fire' },
          },
        ],
      }),
    ).toEqual(['delayed_rolls_nothing']);
  });

  /**
   * A shove moves a creature on the 5-foot lattice everything else in the
   * engine is measured on, so a distance that is not a whole number of spaces
   * is a push the geometry would silently round — and rounding a rules number
   * is the one thing a validator exists to refuse.
   */
  it('refuses a shove that is not a whole number of spaces', () => {
    expect(
      only({
        effects: [
          {
            kind: 'save-damage',
            ability: 'con',
            damage: { dice: '2d8' },
            damageType: 'thunder',
            onSuccess: 'half',
            movement: { feet: 7 },
          },
        ],
      }),
    ).toEqual(['bad_push_distance']);
    expect(
      only({
        effects: [
          {
            kind: 'save-damage',
            ability: 'con',
            damage: { dice: '2d8' },
            damageType: 'thunder',
            onSuccess: 'half',
            movement: { feet: 0 },
          },
        ],
      }),
    ).toEqual(['bad_push_distance']);
  });

  it('accepts a shove of whole spaces', () => {
    expect(
      only({
        effects: [
          {
            kind: 'save-damage',
            ability: 'con',
            damage: { dice: '2d8' },
            damageType: 'thunder',
            onSuccess: 'half',
            movement: { feet: 10 },
          },
        ],
      }),
    ).toEqual([]);
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

  /**
   * The second trigger and the benefit that hangs on it — SRD *Shield*'s "or
   * targeted by the *Magic Missile* spell", and "you take no damage" from it.
   * Neither means anything apart from the other or apart from the Reaction.
   */
  it('refuses a second trigger on a spell that is not a Reaction', () => {
    expect(only({ targetedBy: 'magic-missile' })).toEqual(['trigger_without_reaction']);
  });

  it('refuses a negation with no casting that triggered it', () => {
    expect(only({ negatesTriggeringCasting: true })).toEqual(['negation_without_a_trigger']);
  });

  it('accepts the pair on a Reaction', () => {
    expect(
      only({
        castingTime: 'reaction',
        trigger: 'hit-by-attack',
        targetedBy: 'magic-missile',
        negatesTriggeringCasting: true,
      }),
    ).toEqual([]);
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

  /**
   * The three clauses that narrow what an **area** catches, each held to a
   * definition that has one.
   *
   * They are read at the seam where an area settles its catch and nowhere
   * else, so on a spell cast at named targets every one of them is a field
   * with no reader: written by an author who believed they had said
   * something, applied by nothing, and invisible until the druid's own
   * Entangle Restrains the druid. The other two target clauses
   * (`mustBeType`, `mustBeUnarmored`) need no such guard, because they are
   * checked wherever a caller *names* somebody and every definition does.
   */
  it.each([['notTheCaster'], ['mustSeeTheOrigin'], ['chosenFromTheArea']] as const)(
    'refuses %s on a spell that fills no area',
    (clause) => {
      expect(only({ targets: { count: 1, [clause]: true } })).toEqual(['area_filter_without_area']);
    },
  );

  /**
   * SRD Mage Armor's "a **willing** creature", held to the one rule that
   * matters and to the one that keeps the field from meaning two things.
   *
   * The gate is asked where a caller **names** somebody, so a spell that names
   * nobody at all would carry a clause nothing ever reads — the reason above
   * with the sides swapped. And `true` is the only value, because absence is
   * how a spell says it does not print the word.
   */
  it('refuses a consent gate on a spell that names no target', () => {
    expect(only({ targets: { count: 0, willing: true } })).toEqual(['consent_without_a_target']);
  });

  it('accepts a consent gate on a spell that names one, and on an unlimited list', () => {
    expect(only({ targets: { count: 1, willing: true } })).toEqual([]);
    expect(only({ targets: { count: 0, unlimited: true, willing: true } })).toEqual([]);
  });

  it('refuses any value but true for the consent gate', () => {
    expect(only({ targets: { count: 1, willing: false } })).toEqual(['malformed_field']);
  });

  /**
   * And the second reader that is missing, which is the one worth a guard of
   * its own: a **persistent** area re-derives its catch off the pinned record
   * at every boundary it triggers on, and that seam reads `unaffected` and
   * none of the three. A Web that spared its caster at the cast and
   * Restrained her when she stepped back in is half a rule, applied silently.
   */
  it.each([['notTheCaster'], ['mustSeeTheOrigin'], ['chosenFromTheArea']] as const)(
    'refuses %s on an area that goes on catching creatures',
    (clause) => {
      expect(
        only({
          targets: { count: 0, [clause]: true },
          area: { kind: 'sphere', radius: 20, origin: 'point' },
          durationSeconds: 60,
          effects: [],
          areaTrigger: {
            at: 'start-of-turn',
            label: 'Fire Dart (the flames)',
            effects: [
              {
                kind: 'save-damage',
                ability: 'dex',
                damage: { dice: '2d6' },
                damageType: 'fire',
              },
            ],
          },
        }),
      ).toEqual(['area_filter_and_a_later_catch']);
    },
  );

  /** And each is content the moment there is one catch for it to narrow. */
  it.each([['notTheCaster'], ['mustSeeTheOrigin'], ['chosenFromTheArea']] as const)(
    'accepts %s on a spell that fills one',
    (clause) => {
      expect(
        only({
          targets: { count: 0, [clause]: true },
          area: { kind: 'sphere', radius: 20, origin: 'point' },
          effects: [
            { kind: 'save-damage', ability: 'dex', damage: { dice: '2d6' }, damageType: 'fire' },
          ],
        }),
      ).toEqual([]);
    },
  );

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

  /**
   * SRD Levitate's "change the target's altitude by up to 20 feet in either
   * direction", held to the one list it may be written in and to the lattice
   * its cap is measured on.
   *
   * The placement rule is `checkTeleportPlacement`'s with the sides swapped:
   * that kind reads a fact the casting stated and is refused outside the
   * casting's list; this one reads a fact the **activation** states and is
   * refused outside the activation's. A casting has no such request and an
   * area trigger firing at a boundary has none, so either would move a
   * creature by an amount nobody named.
   */
  it('refuses an altitude changed anywhere but an activation’s own list', () => {
    // Through `checkSpellDefinitionValue`, because a placement rule belongs to
    // the walk that knows **which list** an effect sits in — the seam
    // `checkFoughtClause` is tested at, for the same reason.
    const placed = (over: Record<string, unknown>): readonly string[] =>
      codes(checkSpellDefinitionValue({ ...FIRE_DART, ...over }));

    expect(placed({ effects: [{ kind: 'change-altitude', upTo: 20 }] })).toEqual([
      'altitude_outside_an_activation',
    ]);
    expect(
      placed({
        durationSeconds: 60,
        area: { kind: 'sphere', radius: 20, origin: 'point' },
        areaTrigger: { at: 'start-of-turn', effects: [{ kind: 'change-altitude', upTo: 20 }] },
      }),
    ).toEqual(['altitude_outside_an_activation']);
  });

  it('refuses a cap the 5-foot lattice cannot hold, and takes one it can', () => {
    const climbing = (upTo: unknown) =>
      only({
        durationSeconds: 60,
        activation: {
          action: 'action',
          range: { kind: 'ranged', feet: 60 },
          label: 'Fire Dart (higher)',
          effects: [{ kind: 'change-altitude', upTo }],
        },
      });
    expect(climbing(7)).toEqual(['bad_altitude_cap']);
    expect(climbing(0)).toEqual(['bad_altitude_cap']);
    expect(climbing(20)).toEqual([]);
  });

  /**
   * SRD Gust of Wind's "you can change the direction in which the Line blasts
   * from you", held to what the sentence needs to mean anything: a shape to
   * turn, and one with a direction to be wrong about. A Sphere has no bearing,
   * so a re-aim of one would write a fact the geometry never reads.
   */
  it('refuses a re-aim with no area, and one with no direction to change', () => {
    const turning = (area: unknown) =>
      only({
        durationSeconds: 60,
        ...(area === undefined ? {} : { area }),
        activation: {
          action: 'bonus-action',
          redirects: true,
          label: 'Fire Dart (the other way)',
          effects: [],
        },
      });
    expect(turning(undefined)).toEqual(['redirects_without_area']);
    expect(turning({ kind: 'sphere', radius: 20, origin: 'self' })).toEqual([
      'redirects_without_a_direction',
    ]);
    expect(turning({ kind: 'line', length: 60, width: 10, origin: 'self' })).toEqual([]);
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

  /** SRD Barkskin's floor is held to the same number rule as Mage Armor's base. */
  it('refuses a floor under an Armour Class that is not a number either', () => {
    expect(
      only({ durationSeconds: 60, effects: [{ kind: 'armor-class', minimum: 0 }] }),
    ).toEqual(['bad_armor_class']);
  });

  /**
   * And never both, because the two arms are read at different points of one
   * sum: a base competes to *be* the calculation and a floor refuses the total
   * it came to. An effect claiming both would be two rules in one field.
   */
  it('refuses an Armour Class that is both a base and a floor', () => {
    expect(
      only({
        durationSeconds: 60,
        effects: [
          { kind: 'armor-class', base: 13, plusAbility: null, shieldAllowed: true, minimum: 17 },
        ],
      }),
    ).toEqual(['armor_class_base_and_floor']);
  });

  /**
   * SRD Vampiric Touch's "within reach", which is the caster's arm — so it is
   * a whole number of spaces, and it belongs to the swing rather than to a
   * ranged attack, whose distance is the spell's own Range.
   */
  it('refuses a reach that is not a whole number of spaces', () => {
    expect(
      only({
        effects: [
          { kind: 'attack', attack: 'melee', damage: { dice: '3d6' }, damageType: 'necrotic', reach: 2 },
        ],
      }),
    ).toEqual(['bad_reach']);
  });

  it('refuses a reach on an attack the caster does not make with an arm', () => {
    expect(
      only({
        effects: [
          { kind: 'attack', attack: 'ranged', damage: { dice: '1d10' }, damageType: 'piercing', reach: 5 },
        ],
      }),
    ).toEqual(['reach_without_a_melee_attack']);
  });

  /**
   * SRD Mind Spike's "against you": the caster, and the only role the sentence
   * can name — a benefit denied against the creature it is hung on is a denial
   * against nobody.
   */
  it('refuses a denial narrowed to anybody but the caster', () => {
    expect(
      only({
        durationSeconds: 60,
        effects: [
          {
            kind: 'save-damage',
            ability: 'wis',
            damage: { dice: '3d8' },
            damageType: 'psychic',
            onSuccess: 'half',
            modifiers: [{ kind: 'benefit', denies: 'invisible', against: 'target' }],
          },
        ],
      }),
    ).toEqual(['bad_denial_target']);
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
    expect(checkProblem({ ability: 'int', onSuccess: 'end-world' })).toEqual([
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
    ['an outcome it cannot do', { ability: 'int', onSuccess: 'end-world' }, 'bad_check_outcome'],
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
  /**
   * The sixth sourced grant, and it carries no deadline of its own for the
   * reason `speed` does not: every SRD sentence of this shape says "until the
   * spell ends", so the casting is the only thing that could take the die away
   * — and an Instantaneous one never could. Divine Favor's own shape, on a
   * definition that does not last.
   */
  const RIDER = { kind: 'attack-rider', dice: '1d4', damageType: 'radiant' } as const;

  it.each([
    ['a bonus', BUFF],
    ['a granted mode', MODE],
    ['a base Armour Class', AC],
    ['a condition that lasts as long as the casting', HELD],
    ['extra damage on later attacks', RIDER],
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
  const lines = linesOf(source);
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
 * Vocabularies the format **names** instead of spelling out, and the members
 * behind each name.
 *
 * A field written `at: TurnMoment` has exactly the members it had when it was
 * written `at: 'start-of-turn' | 'end-of-turn'` — the reader is what changed,
 * and a reader that stopped seeing them would be this sweep quietly covering
 * less while reporting the same. Three fields of the format name that type,
 * and the pair they all mean is one thing the engine declares once.
 *
 * Read out of the engine's own exported list rather than transcribed, which is
 * the same discipline the format types get: a third moment added to the
 * vocabulary is a member of every field that names it, here, the day it lands.
 */
const VOCABULARIES: Readonly<Record<string, readonly string[]>> = {
  TurnMoment: TURN_MOMENTS,
};

/**
 * A union's arms, split at the pipes that are actually pipes.
 *
 * `String.split('|')` is right only while no arm contains one, and an object
 * arm may — `{ readonly kind: 'a' | 'b' }` is one arm carrying a pipe, and
 * splitting on it would invent two arms that are neither literals nor objects.
 * So the split is depth-aware over `{}`, which is the only bracket the format's
 * unions use, and an empty fragment from a leading `|` is dropped here rather
 * than at every call site.
 */
const unionArms = (rhs: string): readonly string[] => {
  const arms: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of rhs) {
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (char === '|' && depth === 0) {
      arms.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  arms.push(current);
  return arms.map((arm) => arm.trim()).filter((arm) => arm !== '');
};

/**
 * The field of a discriminated union's arm that says which arm it is.
 *
 * One word, in one place, because both halves of the reading depend on it:
 * the declaration's arms are told apart by it, and an object in a definition
 * is placed under its arm by it.
 */
const DISCRIMINANT = 'kind';

interface FieldDeclaration {
  readonly key: string;
  readonly optional: boolean;
  readonly type: string;
}

/** Every `readonly …` field a fragment of the format declares. */
const fieldsIn = (text: string): readonly FieldDeclaration[] => {
  const field = /readonly (\w+)(\?)?:\s*([^;}\n]*)/g;
  const out: FieldDeclaration[] = [];
  let match: RegExpExecArray | null;
  while ((match = field.exec(text)) !== null) {
    out.push({
      key: match[1]!,
      optional: match[2] === '?',
      type: match[3]!.replace(/\s+/g, ' ').trim(),
    });
  }
  return out;
};

/**
 * An object type split into what it declares itself and what it nests.
 *
 * The two are read differently — an arm's own field belongs to the arm, and a
 * field inside a `{ … }` the arm merely holds belongs to that shape — so they
 * are separated here rather than by a regex that would have to know which
 * braces it was inside.
 */
const splitDepth = (text: string): { readonly own: string; readonly nested: string } => {
  let depth = 0;
  let own = '';
  let nested = '';
  for (const char of text) {
    if (char === '{') {
      depth += 1;
      if (depth === 1) own += char;
      else nested += char;
      continue;
    }
    if (char === '}') {
      if (depth === 1) own += char;
      else nested += char;
      depth -= 1;
      continue;
    }
    if (depth <= 1) own += char;
    else nested += char;
  }
  return { own, nested };
};

/**
 * Every optional field and every closed-union value one declaration writes,
 * **arm by arm where the declaration has arms**.
 *
 * Derived from the source rather than listed, for the reason every sweep in
 * this repository is: a hand-kept list is a second place to record the format,
 * and the way it rots is a member added to the type and not to the list.
 *
 * **A field belongs to the arm that declares it.** Probing by field name over
 * the whole of `SpellEffect` is what let one arm's writer answer for another's
 * member: `addSpellcastingModifier` counted as written because an attack, a
 * heal and a temp-hp all carry one, and `save-damage` — the only
 * damage-carrying kind that did not declare it at all — was invisible here
 * until a Cleric's Divine Spark went looking for it. Nineteen arms are
 * nineteen vocabularies, and each is now asked for its own writer.
 */
const membersOf = (source: string, name: string): readonly FormatMember[] => {
  const region = regionOf(source, name);
  const found = new Map<string, FormatMember>();
  const add = (label: string, probe: string): void => {
    found.set(label, { label, probe });
  };

  /**
   * One field, under whatever label and probe its host gives it.
   *
   * The host is the whole type for a field the union writes nowhere in
   * particular, and one arm of it for a field that arm declares — which is the
   * only difference between the two readings below.
   */
  const addField = (host: string, prefix: string, field: FieldDeclaration): void => {
    if (field.optional) add(`${host}.${field.key}?`, `${prefix}${field.key}?`);
    for (const value of VOCABULARIES[field.type] ?? []) {
      add(`${host}.${field.key}='${value}'`, `${prefix}${field.key}='${value}'`);
    }
    if (LITERAL_UNION.test(field.type)) {
      for (const literal of field.type.split('|')) {
        const value = literal.trim().slice(1, -1);
        add(`${host}.${field.key}='${value}'`, `${prefix}${field.key}='${value}'`);
      }
    }
  };

  // An interface has no arms: every field it declares is its own.
  const top = /^export type \w+ =([\s\S]*);\s*$/.exec(region.trim());
  if (top === null) {
    for (const field of fieldsIn(region)) addField(name, '', field);
    return [...found.values()];
  }

  for (const arm of unionArms(top[1]!.replace(/\s+/g, ' ').trim())) {
    // `export type RiderDuration = 'a' | 'b' | { … };` — a union's bare
    // string-literal arms *are* members, and they are written as somebody's
    // field value rather than under a name of their own, so the probe matches
    // a value wherever it was written.
    //
    // **A union mixing literals with object arms still has literal members**,
    // and requiring the *whole* right-hand side to be literals is what hid
    // them. `RiderDuration` is the one such union in the format and it
    // contributed **nothing at all**: the object arm failed `LITERAL_UNION`,
    // the walk fell through to the field probe, and that found one required
    // non-union field. So the type whose members this sweep's own docstring
    // names as the example was the one type it could not see — the
    // `animals.md` failure arriving inside the guard again. Arms are taken one
    // at a time, and a union with no bare literal arms is unaffected, which is
    // every other union here.
    if (/^'[a-z0-9-]+'$/.test(arm)) {
      const value = arm.slice(1, -1);
      add(`${name}='${value}'`, `*='${value}'`);
      continue;
    }

    const { own, nested } = splitDepth(arm);
    const fields = fieldsIn(own);
    const discriminant = fields.find(
      (field) => field.key === DISCRIMINANT && /^'[a-z0-9-]+'$/.test(field.type),
    );

    // An object arm that names no kind is one shape, and its fields are the
    // union's own — `RiderDuration`'s `{ readonly untilTurns: number }` and
    // the two-field arms of `SpellRange` are all of these.
    if (discriminant === undefined) {
      for (const field of fieldsIn(arm)) addField(name, '', field);
      continue;
    }

    // **The kind itself stays the union's**, rather than becoming a member of
    // the arm that names it. `SpellEffect.kind='action-rule'` is one closed
    // vocabulary with one member per arm, and an arm-scoped spelling of it
    // would be every arm reporting that it is itself.
    addField(name, '', discriminant);

    const tag = discriminant.type.slice(1, -1);
    for (const field of fields) {
      if (field.key === DISCRIMINANT) continue;
      addField(`${name}[${tag}]`, `${tag}:`, field);
    }

    // What the arm nests is not the arm's own vocabulary: a `repeats: { at,
    // onSuccess }` is a shape of its own, written as a value the usage walk
    // meets with no kind on it, so it keeps the plain probe. Reading it as the
    // arm's would report it unwritten wherever the nested object is the thing
    // that carries the field.
    for (const field of fieldsIn(nested)) addField(name, '', field);
  }

  return [...found.values()];
};

/**
 * Every `SpellEffect` the catalogue writes somewhere that is not a spell.
 *
 * **An effect list has three hosts and this sweep knew one of them.** A spell
 * writes effects, an item confers them without casting, and a feature's pool
 * use is the third — and the population here was `SPELL_DEFINITIONS` alone, so
 * a member only a feature or an item writes came back unused. That was
 * invisible while every member was probed by field name across the whole
 * union, because some spell's `addSpellcastingModifier` answered for every
 * arm's; read arm by arm, the Cleric's Divine Spark is the writer of
 * `save-damage`'s and there is no spell that is.
 *
 * Only the effect objects are taken, and everything nested inside them —
 * **not** the class, the item or the feature that hosts one. A catalogue
 * walked whole would put every `name`, `id` and `level` in the repository into
 * the probe space, and a member of the spell format would come back written
 * because something entirely unrelated happened to share a field name.
 */
const effectsHostedElsewhere = (): readonly unknown[] => {
  const found: unknown[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (typeof node !== 'object' || node === null) return;
    const record = node as Record<string, unknown>;
    const kind = record['kind'];
    if (typeof kind === 'string' && EFFECT_KINDS.has(kind)) {
      found.push(record);
      return;
    }
    for (const value of Object.values(record)) walk(value);
  };

  walk([
    SRD_CONTENT.classes,
    SRD_CONTENT.subclasses,
    SRD_CONTENT.species,
    SRD_CONTENT.backgrounds,
    SRD_CONTENT.feats,
    SRD_CONTENT.items,
  ]);
  return found;
};

/**
 * Every field written, and every string value written to it, by any
 * definition — **and the same again under the kind of the object writing it**.
 *
 * Both, because the format is read both ways: an arm's own field is probed
 * under its arm, and a nested shape's field is probed plain. An object gets
 * the arm prefix only from **its own** `kind`, never an enclosing one — a
 * `DiceScaling` inside an `attack` effect is not an attack's shape, and
 * tagging it with the effect's kind is the four-false-positive reading that
 * was measured and rejected the first time this was tried.
 */
const written = (definitions: readonly unknown[]): ReadonlySet<string> => {
  const keys = new Set<string>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (typeof node !== 'object' || node === null) return;
    const record = node as Record<string, unknown>;
    const own = record[DISCRIMINANT];
    const prefix = typeof own === 'string' ? `${own}:` : null;
    for (const [key, value] of Object.entries(record)) {
      if (value === undefined) continue;
      keys.add(`${key}?`);
      if (prefix !== null) keys.add(`${prefix}${key}?`);
      if (typeof value === 'string') {
        keys.add(`${key}='${value}'`);
        keys.add(`*='${value}'`);
        if (prefix !== null) keys.add(`${prefix}${key}='${value}'`);
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
  // The repeat save a definition asks for, which was two identical object
  // literals nested inside `ConditionRider` and the `save` arm until they were
  // named. Nesting is what kept them out of this list: a member the walk can
  // only reach through an enclosing arm keeps the plain probe, and naming the
  // type is what lets the sweep read `onFailure` at all.
  'SpellRepeatSave',
  'ConditionRider',
  'DelayedDamage',
  // The fourth rider slot's payload, here for `DelayedDamage`'s reason and
  // with one thing more to say: it declares a distance and no direction, and
  // the day a pull is written the second member has to arrive with the
  // definition that writes it rather than ahead of one.
  'ForcedMovement',
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
  // Both halves of what a spell says about its own dice: the behaviour and the
  // bound on it. One arm and one cap today, and the sweep is why a second of
  // either arrives with a definition that writes it rather than ahead of one.
  'DieRule',
  'DieRuleCap',
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
  // The three below became sayable on the day the arms were read apart, and
  // they were hidden three different ways — which is worth writing down,
  // because only one of them was on any record. Under the old probe a
  // payout's `dice` collided with `DiceScaling.dice`, and the shared-probe
  // list said so and said it could not be seen. A payout's `at` collided with
  // `AreaTrigger.at`, which Web writes, and that row is still in the list —
  // but its comment names a repeat save's `at` as the member it masks, so
  // this one was hidden behind a record of something else. And a payout's
  // `damageType` collided with nothing at all: `damageType` is a **required**
  // field on the attack and save-damage arms, so every damaging spell wrote
  // the probe and no second member ever appeared in the list to be recorded.
  // It was simply counted as written. They are claims now.
  "SpellEffect[turn-payout].at='end-of-turn'":
    "The catalogue writes two payouts and the book prints both at the start of a turn: Heroism's Temporary Hit Points and Regenerate's one Hit Point a turn. The reader is live and moment-blind — `resolveTurnPayoutEffect` copies `at` into `turn-payout-granted` and the turn-hook machinery hangs a boundary either way, which is the same pair of words every area trigger and every repeated save uses. So what is absent is a spell that pays out when a turn *ends*, not the machinery for one, and the day a definition writes one this fails rather than going on excusing a member that now has a writer.",
  'SpellEffect[turn-payout].dice?':
    "A notation thrown at every boundary rather than once at the cast, which neither payout in the catalogue prints: Heroism hands over the caster's ability modifier and prints no dice at all, and Regenerate prints \"regains 1 Hit Point\", which is the `flat` beside this field. The reader is live — the resolver carries `dice` into the event the boundary reads, so a payout that rolled would roll — and the field's own docstring names Heroism as the reason it is optional. The day a definition prints a per-turn die, this fails rather than going on excusing a field that now has a writer.",
  'SpellEffect[turn-payout].damageType?':
    'The damage type a payout deals, which `checkSpellDefinition` requires when the payout is damage and refuses on any other kind — and both payouts the catalogue writes hand over hit points rather than taking them, so nothing writes it. The kind `payout: \'damage\'` beside it is unwritten too and is **not** reported here, because `PayoutKind` is a named vocabulary this reader does not expand the way it expands `TurnMoment`; that is a gap in the instrument and is recorded rather than exempted. The reader is live: the resolver copies the type into the event, and the day a spell deals damage at a boundary this fails.',
  'ForcedMovement.targetNoLargerThan?':
    'The size ceiling a shove prints, which no SRD *spell* prints: Thunderwave and Gust of Wind push whatever they catch, and the sentence that gates a push on a size is printed on a feature instead — SRD Repelling Blast\'s "when you hit a Large or smaller creature". So the writer is a `casting-rider` standing grant rather than a definition, and the field lives here because the rider it rides on is this one and a second copy of a push would be two vocabularies for one shove. The reader is live and driven: `shoveAwayFrom` asks `effectiveSizeOf`, leaves a creature too big standing and says so on the casting\'s `unverified`, and `eldritch-invocations.test.ts` drives both branches. The day a definition prints the clause, this fails rather than going on excusing a member that now has a writer.',
  "SpellEffect[elsewhere].at='start-of-turn'":
    'The moment a sending is read at, and SRD Blink prints the other one: "Roll 1d6 **at the end** of each of your turns." The reader is live — `settleElsewhereAtBoundary` compares the effect\'s `at` against the moment it is called with, at both moments — and a definition that vanished a creature at the start of its turn would be read exactly as Blink is. No SRD spell prints that sentence; the day one does, this fails rather than going on excusing a member that now has a writer.',
  "SpellArea[cone].origin='point'":
    'Four cones are defined — Burning Hands, Color Spray, Cone of Cold and Fear — and SRD prints "Self (15-foot Cone)" or its like on every one, so every cone this catalogue writes is anchored on the caster. The arm offers a point because the geometry does not care which it is: `resolveArea` reads `origin === \'self\'` once for every area kind, and the cube arm beside it writes both values, so the branch is live and driven. What is absent is a spell or an item that forms a cone somewhere other than where its caster is standing, and the day one is written this fails rather than going on excusing a member that now has a writer.',
};

/**
 * **`SpellEffect.kind='action-rule'` was here, and it fell the same way.**
 *
 * Its written reason ended "the day Conjure Woodland Beings gets one, this
 * fails rather than going on excusing a member that now has a writer", and
 * what happened is the catalogue pass it was waiting for: Wind Walk and Magic
 * Jar write the standalone kind, and Stinking Cloud and Fear write the `action`
 * rider beside it. So the exemption **fell** rather than being rewritten —
 * the third handover discharged by deletion — and nothing replaces it: the
 * sweep's "keeps no exemption for a member something now writes" arm is what
 * removed it, and those four definitions are what keep it removed.
 */

/**
 * **`SpellDefinition.castingSeconds` was here, and the handover worked.**
 *
 * Its written reason ended "the day any definition prints a casting time of a
 * minute or more, this fails rather than going on excusing a field that has a
 * writer", and IE-036 wrote twelve of them. The exemption therefore *fell*
 * rather than being rewritten, which is the second time a handover has been
 * discharged by deletion — `dash`'s `conditionSpeed` exemption was the first,
 * and `roll-mode.save`'s was discharged by the member going instead.
 *
 * Nothing replaces it: the sweep's "keeps no exemption for a member something
 * now writes" arm is what removed it, and Alarm, Mending and the other ten are
 * what keep it removed.
 */

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
  const used = written([...SPELL_DEFINITIONS, ...effectsHostedElsewhere()]);
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
   * And it reads the same declaration when the file on disk ends its lines CRLF.
   *
   * `.gitattributes` normalises to LF on the way into the index, so a working
   * tree that has picked up CRLF is clean in `git status` and invisible in a
   * diff — and this reader finds a declaration's end by `lines[i] === '}'`,
   * which a trailing `\r` makes false for ever. The region then runs to the
   * end of the file and the *next* declaration's fields are reported as this
   * one's: a sweep answering a different question than the one it is asked,
   * because of a byte nobody can see. Both endings are asserted to give the
   * same answer, which is the claim rather than merely that CRLF parses.
   */
  it('reads a declaration whose lines end CRLF', () => {
    const lines = [
      'export interface Widget {',
      "  readonly mood?: 'sullen' | 'merry';",
      '}',
      'export interface Gadget {',
      '  readonly size?: number;',
      '}',
    ];
    const expected = ['Widget.mood?', "Widget.mood='sullen'", "Widget.mood='merry'"];
    expect(membersOf(lines.join('\n'), 'Widget').map((m) => m.label)).toEqual(expected);
    expect(membersOf(lines.join('\r\n'), 'Widget').map((m) => m.label)).toEqual(expected);
  });

  /**
   * **The arms of a union are read one at a time**, which is what lets a union
   * mixing named moments with an object arm be seen at all. Asserted over
   * synthetic source, and asserted to find the literals *and* the object arm's
   * own optional field — because the walk no longer returns early, an arm that
   * is not a literal still reaches the field probe.
   */
  it('derives the literal arms of a union that also has an object arm', () => {
    const synthetic = [
      'export type Mood =',
      "  | 'sullen'",
      "  | 'merry'",
      '  | { readonly degrees: number; readonly since?: string };',
    ].join('\n');
    expect(membersOf(synthetic, 'Mood').map((m) => m.label)).toEqual([
      "Mood='sullen'",
      "Mood='merry'",
      'Mood.since?',
    ]);
  });

  /**
   * And the pipe inside an object arm is not a union pipe. Splitting on it
   * would invent arms that are neither literals nor objects, and the two
   * halves of the nested union would be reported as members of the outer one.
   */
  it('does not split a union at a pipe inside an object arm', () => {
    const synthetic = ["export type Held = 'loose' | { readonly grip: 'firm' | 'slack' };"].join(
      '\n',
    );
    expect(membersOf(synthetic, 'Held').map((m) => m.label)).toEqual([
      "Held='loose'",
      "Held.grip='firm'",
      "Held.grip='slack'",
    ]);
  });

  /**
   * **An arm of a discriminated union owns its own fields**, which is the
   * branch this sweep was missing and paid for.
   *
   * A member was probed by field *name* over the whole of `SpellEffect`, so
   * `addSpellcastingModifier` counted as written the moment any one arm's
   * writer existed — and `save-damage` was the only damage-carrying kind that
   * did not declare it, which nothing here could say and nobody noticed until
   * a Cleric's Divine Spark needed it. Two arms declaring the same field are
   * two members with two writers, and they are labelled and probed apart.
   */
  it('derives the members of each arm of a discriminated union', () => {
    const synthetic = [
      'export type Shot =',
      "  | { readonly kind: 'arrow'; readonly fletched?: boolean }",
      "  | { readonly kind: 'bolt'; readonly fletched?: boolean; readonly heavy?: boolean };",
    ].join('\n');

    expect(membersOf(synthetic, 'Shot').map((m) => m.label)).toEqual([
      "Shot.kind='arrow'",
      'Shot[arrow].fletched?',
      "Shot.kind='bolt'",
      'Shot[bolt].fletched?',
      'Shot[bolt].heavy?',
    ]);
  });

  /**
   * And the probes are apart too, which is the half that bites: content that
   * writes the field on one arm leaves the other arm's member unwritten.
   */
  it('does not let one arm’s writer answer for another arm’s member', () => {
    const synthetic = [
      'export type Shot =',
      "  | { readonly kind: 'arrow'; readonly fletched?: boolean }",
      "  | { readonly kind: 'bolt'; readonly fletched?: boolean };",
    ].join('\n');
    const used = written([{ effects: [{ kind: 'arrow', fletched: true }] } as never]);

    expect(
      membersOf(synthetic, 'Shot')
        .filter((member) => !used.has(member.probe))
        .map((member) => member.label),
    ).toEqual(["Shot.kind='bolt'", 'Shot[bolt].fletched?']);
  });

  /**
   * **A field that names a vocabulary still contributes its members**, which
   * is the branch that keeps this reader honest about `at`.
   *
   * Three fields of the format are written `at: TurnMoment` rather than as the
   * pair spelled out, and a reader that saw only literal unions would report
   * six fewer members than the format has — silently, because an unseen member
   * cannot come back unwritten. That is the narrowing this sweep exists to
   * catch, and it is asserted here rather than trusted: synthetic source, so
   * the branch is driven whatever the format is written like this week, and
   * the real `AreaTrigger` beside it so the wiring is real too.
   */
  it('derives the members of a field that names a vocabulary', () => {
    const synthetic = ['export interface Tick {', '  readonly at: TurnMoment;', '}'].join('\n');
    expect(membersOf(synthetic, 'Tick').map((m) => m.label)).toEqual([
      "Tick.at='start-of-turn'",
      "Tick.at='end-of-turn'",
    ]);
    // And an optional one keeps its own member too, which is `AreaTrigger.at`.
    expect(membersOf(source, 'AreaTrigger').map((m) => m.label)).toEqual(
      expect.arrayContaining([
        'AreaTrigger.at?',
        "AreaTrigger.at='start-of-turn'",
        "AreaTrigger.at='end-of-turn'",
      ]),
    );
  });

  /**
   * The member this task added, named rather than left to the aggregate: its
   * writer is Stinking Cloud's Poisoned, and the sweep can only say so because
   * it can see `RiderDuration` at all. Before the arm-at-a-time read that type
   * contributed no members whatever, so a fourth one could have been added
   * with no writer and nothing would have reported it.
   *
   * The start of the target's next turn is the sixth, and SRD Shocking Grasp
   * is its writer — which is the half this list holds and
   * `rider-duration-readers.test.ts` does not: that sweep asks whether every
   * *reader* answers the member, and this asks whether any definition says it.
   */
  it('sees every named moment a rider may last until', () => {
    expect(membersOf(source, 'RiderDuration').map((m) => m.label)).toEqual([
      "RiderDuration='start-of-casters-next-turn'",
      "RiderDuration='end-of-casters-next-turn'",
      "RiderDuration='start-of-targets-next-turn'",
      "RiderDuration='end-of-targets-next-turn'",
      "RiderDuration='end-of-current-turn'",
    ]);
    expect(unused.map((member) => member.label)).not.toContain(
      "RiderDuration='end-of-current-turn'",
    );
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
   * **The probe is as fine as the value can carry, and no finer.**
   *
   * A member is looked up by the field name, the value, and the `kind` of the
   * object that writes it — because that is everything the usage walk can read
   * off a value, which carries no type. An arm's own field is therefore probed
   * under its arm, and that is what the first version of this reader could not
   * do: it probed by field name over the whole union, so one arm's writer
   * answered for every arm's member, and `save-damage` went without
   * `addSpellcastingModifier` in plain sight.
   *
   * **What is still coarse is what a value cannot say.** An object nested
   * inside an arm — a `repeats: { at, onSuccess }`, a `DiceScaling` — carries
   * no kind of its own, so it keeps the plain probe. Tagging it with the
   * *enclosing* arm's kind is the alternative that was written and measured
   * and is worse: `DiceScaling.flat?` comes back unwritten when False Life
   * writes it, four false positives, which is the failure mode a guard must
   * not have.
   *
   * What that costs is stated rather than hidden: where two members share a
   * probe, one can be reported as written because the other is. The list is
   * pinned so that a new collision is a reviewed change, and the one that
   * actually masks something is named. **Reading the arms apart emptied most
   * of it**: every row that was a flat field on one arm colliding with the
   * same word elsewhere has gone, because those fields are probed under their
   * arms now. One of them — a payout's `dice`, the row that said in its own
   * comment that it was masking something — is an exemption below; one turned
   * out to have a writer after all, since Regenerate prints the payout's
   * `flat`; the rest were written on both sides and simply resolved.
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
      // A definition's own check — Sunburst's dispel clause — and a rider's,
      // which `conditionRiderOf` reads as one vocabulary. Two spellings of one
      // clause, both written, masking nothing. The `save` arm's flat `check`
      // was the third name in this row and is `SpellEffect[save].check?` now,
      // which is the arm-apart reading doing what it was added for.
      // **The one that still masks, and the one the instrument cannot reach.**
      // A repeat save's moment against an area's, which are two different
      // sentences sharing two words. Web writes `start-of-turn` as an area
      // boundary and no definition repeats a save at the start of a turn, so
      // `SpellRepeatSave.at: 'start-of-turn'` is unwritten and unsayable here.
      // Recorded rather than exempted, because it is a limit of the instrument
      // and not a decision about the format: the probe reads a field name and
      // a value, and two types that spell one word alike collide by
      // construction.
      // One field over: a repeat save's `onSuccess` against a check's.
      // Different sentences that share two words, and both are written —
      // `end-casting` on a check since SRD Ensnaring Strike's "On a success,
      // the spell ends."
      "SpellCheck.onSuccess='end-casting' + SpellRepeatSave.onSuccess='end-casting'",
      "SpellCheck.onSuccess='end-on-target' + SpellRepeatSave.onSuccess='end-on-target'",
      // A casting's own template against the one a later action draws, which
      // share a field name and nothing else: the first is pinned on the record
      // and read by the fold at every boundary, the second exists for the
      // length of one action. Both are written — every area spell in the book
      // writes the first and SRD Dragon's Breath's Cone writes the second —
      // and `checkSpellDefinition` keeps them apart on one definition.
      'SpellDefinition.area? + SpellActivation.area?',
      'SpellDefinition.check? + ConditionRider.check?',
      // **Three names now, and the third is the `elsewhere` arm's**: a
      // definition's *nested* `returns.at` and the arm's own `at` are probed
      // on the enclosing union under the bare field name, so Blink's two
      // moments — vanishing at the end of a turn, returning at the start of
      // the next — write both spellings and mask nothing here. The two rows
      // after them are the same reading: the nested `returns.at?` and
      // `returns.requiresSight?` share their probe with `AreaTrigger.at?` and
      // the definition's own `requiresSight?`, both written by Blink.
      "SpellEffect.at='end-of-turn' + AreaTrigger.at='end-of-turn' + SpellRepeatSave.at='end-of-turn'",
      "SpellEffect.at='start-of-turn' + AreaTrigger.at='start-of-turn' + SpellRepeatSave.at='start-of-turn'",
      'SpellEffect.at? + AreaTrigger.at?',
      'SpellEffect.requiresSight? + SpellDefinition.requiresSight?',
      // **The second row that masks, and it is named because it does.** The
      // span a *deepening* may carry — `SpellRepeatSave.onFailure.lasts`,
      // nested and therefore probed under the bare word — collides with the
      // rider's own `lasts`, which Color Spray writes. So this member is
      // reported written by somebody else's sentence, and no SRD spell writes
      // it: the book's deepening (Sleep's Unconscious) runs for the casting's
      // own duration, and the sentence that does print a span for one is a
      // stat block's — SRD Brass Dragon Wyrmling's minute — which reaches the
      // same `RepeatSave.onFailure` by the printed road rather than through a
      // definition. What holds the member honest instead is the validator and
      // its own test, "takes a span on the condition a failure deepens to".
      'SpellRepeatSave.lasts? + ConditionRider.lasts?',
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
   * engine resolved it, `timers.ts` declared it, the reducer branched on it,
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

    // IE's time split moved the record that declares it: a repeat save is a
    // thing a deadline is hung on, which is `timers.ts`, and `time.ts` is now
    // the clock and the two shapes of "how long" and nothing else.
    expect(read('timers.ts')).toContain("readonly onSuccess: 'end-on-target' | 'end-casting'");
    // IE-039 moved the switch out of `events.ts`, which keeps the union, and
    // IE-050 dispatched it by domain; the branch this pins is the reducer's,
    // so it is read where the reducer is — the seam that owns what a casting
    // owes later.
    expect(read('fold/timers.ts')).toContain("pending.onSuccess === 'end-casting'");
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

  /**
   * The three payout exemptions, pinned to the two payouts that exist.
   *
   * Every one of them says "the catalogue writes two payouts and neither does
   * this", so the fact that can stop being true is the pair itself: a third
   * payout, or a die or a damage type on one of these two, and the exemptions
   * are claims about a catalogue that has moved on. The effects are read out
   * of the definitions rather than the ids trusted, because the claim is about
   * what the effect says and not about which spell says it.
   */
  it('pins that both payouts in the catalogue print a flat start-of-turn benefit', () => {
    const payouts = SPELL_DEFINITIONS.flatMap((definition) =>
      definition.effects
        .filter((effect) => effect.kind === 'turn-payout')
        .map((effect) => ({ id: definition.id, effect })),
    );

    expect(payouts.map((one) => one.id)).toEqual(['heroism', 'regenerate']);
    for (const { id, effect } of payouts) {
      expect(effect.at, id).toBe('start-of-turn');
      expect(effect.dice, id).toBeUndefined();
      expect(effect.damageType, id).toBeUndefined();
      expect(effect.payout, id).not.toBe('damage');
    }
  });

  /**
   * And the cone exemption, pinned to the two facts it rests on: no cone in
   * the catalogue is cast from a point, and the branch that would read one is
   * driven anyway by a cube that is.
   */
  it('pins that every cone is cast from its caster and every value of origin has a writer', () => {
    const areas = SPELL_DEFINITIONS.map((definition) => definition.area).filter(
      (area) => area !== undefined,
    );

    expect(areas.filter((area) => area.kind === 'cone')).not.toEqual([]);
    for (const area of areas.filter((one) => one.kind === 'cone')) {
      expect(area.origin).toBe('self');
    }
    expect(
      areas.filter((area) => area.kind === 'cube' && area.origin === 'point'),
    ).not.toEqual([]);
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
 * `time.ts`, `attack.ts`, `positioning.ts` and `checks.ts` had never been
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
   * has nothing to do with the cantrip. `darkvision` is the third and the
   * book itself is the reason: the *rules glossary* defines Darkvision as one
   * of four senses a creature has, beside the conditions and the actions, and
   * the spell of that name is the catalogue entry that grants it. `SENSE_NAMES`
   * in `positioning.ts` transcribes the glossary, so the word is a mechanic
   * there in exactly the way `shield` is one in `fold/inventory.ts`.
   *
   * **`heal` and `teleport` are the fourth and fifth, and they are the
   * sharper case: both are `SpellEffect` kinds.** `{ kind: 'heal' }` has
   * restored hit points since Cure Wounds landed and `{ kind: 'teleport' }`
   * has moved a creature since IE-037, and the two words appear in the union,
   * in the validator, in the resolvers and in the conferral rules — none of it
   * about SRD Heal or SRD Teleport, neither of which had a definition until
   * the magic items came for them. The alternative to an exclusion is a
   * catalogue that may never hold two spells because their slugs collide with
   * the vocabulary every spell is written in.
   *
   * **`resistance` is the seventh, and the book is again the reason**: the
   * *rules glossary* defines Resistance as one of the three ways damage is
   * adjusted, and `monster.ts` transcribes it as a `kind` on a qualified
   * defence — `'immunity' | 'resistance' | 'vulnerability'`. SRD Resistance
   * the cantrip is a different arithmetic wearing the same word: it takes a
   * 1d4 off a total where the defence halves one. Excluded on Darkvision's
   * precedent exactly, and for the same reason.
   *
   * **`command` is the sixth, and it is the flattest collision yet**: SRD
   * Command is a level 1 Enchantment, and `command` is the field every
   * idempotent event carries. `fold/apply.ts` writes `if (!('command' in
   * event) || event.command === undefined)`, which is the retry rule the whole
   * engine is built on and has nothing whatever to do with a Cleric shouting
   * "Grovel". Excluded the day the spell catalogue gained the spell.
   *
   * **`fly` is the ninth, and it is Darkvision's case again with a different
   * glossary entry**: the rules glossary defines five Speeds — "Some creatures
   * have a Climb Speed, a Fly Speed, a Swim Speed, or a Burrow Speed" — and
   * `MovementMode` in `character.ts` transcribes exactly those five, as
   * `SENSE_NAMES` transcribes the four senses. `commands/movement.ts` then
   * writes `mode === 'fly'` deciding what a move costs and whether the mover
   * can make it at all, and not one of those lines is about the level 3
   * Transmutation. The test the feat allowance states holds: delete SRD Fly
   * from the catalogue and the engine still means the word, because a
   * Cockatrice would still have a Fly Speed. Three of the other four modes
   * collide with nothing; this one collides because the SRD named a spell
   * after the mechanic it grants, which is the same thing it did with
   * Darkvision and with Resistance.
   *
   * **`divination` is the eighth, and it is the book colliding with itself**:
   * the SRD prints eight schools of magic and names one spell after one of
   * them. `SCHOOLS` in `spell-schema.ts` transcribes the eight, which is the
   * same transcription-of-a-glossary that excuses `darkvision` and
   * `resistance` — and the alternative is a catalogue that may never hold a
   * level 4 Divination because the validator has to know what school it is
   * in. Excluded the day the spell catalogue gained the spell.
   *
   * **`slow` is the tenth, and it is the weapon table colliding with the
   * spell list**: `WeaponMastery` in `@ie/srd` transcribes the seven mastery
   * properties the book prints — Cleave, Graze, Nick, Push, Sap, Slow, Topple
   * — and `commands/mastery.ts` branches on `hit.property === 'slow'` to
   * reduce a Speed by ten feet after a blow. Not one line of it is about the
   * level 3 Transmutation, and the test the feat allowance states holds:
   * delete SRD Slow from the catalogue and a Heavy Crossbow still slows what
   * it hits. Excluded the day the spell catalogue gained the spell, which is
   * the day `save.condition` became optional.
   *
   * **`darkness` is the eleventh, and it is `darkvision`'s case one glossary
   * entry further on**: the rules glossary prints three levels of light —
   * Bright Light, Dim Light, Darkness — and `LIGHT_LEVELS` in
   * `positioning.ts` transcribes exactly those three, as `SENSE_NAMES`
   * transcribes the four senses. Every reading of the word in the engine is a
   * reading of that level: how bright a space is, what Darkvision makes of
   * it, what a `sees-through` grant pierces. Not one of them is about the
   * level 2 Illusion, and the test the feat allowance states holds — delete
   * SRD Darkness from the catalogue and a cellar is still dark. Excluded the
   * day the lattice gained a light level, which is P3-S.
   *
   * Named one word at a time rather than matched loosely, so each exclusion
   * is reviewed instead of being a heuristic that quietly stops catching
   * things.
   */
  const ALSO_VOCABULARY: ReadonlySet<string> = new Set([
    'shield',
    'light',
    'darkvision',
    'darkness',
    'heal',
    'teleport',
    'command',
    'resistance',
    'divination',
    'fly',
    'slow',
  ]);

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
    linesOf(text)
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
   * Nothing in the engine compares an id against a literal, and there is no
   * allowance left. The one there used to be — `creation.ts` asking which of
   * a character's classes was the Wizard, so the Evoker's free spells went in
   * the Wizard's book — is gone with the catalogue: a feature that offers a
   * spell choice says which class it belongs to, and creation reads that.
   */
  const ALLOWED_COMPARISONS: Readonly<Record<string, readonly string[]>> = {};

  /** The SRD catalogue's source, where the two data constructs actually live now. */
  const content = (path: string): string =>
    readFileSync(fileURLToPath(new URL(`../../content/src/${path}`, import.meta.url)), 'utf8');

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
   * **The engine holds no catalogue.** Not one definition's `id:` line, not
   * one fixed spell grant, not one class named as a string: every one of
   * those is content, and content enters through `createContent`. This is
   * the boundary the whole split exists to keep, asserted over every runtime
   * file rather than promised.
   */
  it.each(RUNTIME.map((file) => [file] as const))('%s holds no content', (file) => {
    const text = source(file);
    expect(linesOf(text).filter((line) => ID_LINE.test(line)), file).toEqual([]);
    expect([...text.matchAll(SPELL_GRANT)], file).toEqual([]);
    for (const classId of SRD_CONTENT.classes.map((c) => c.id)) {
      expect(text.includes(`'${classId}'`), `${file} names the class ${classId}`).toBe(false);
    }
  });

  /**
   * And the allowances are real rather than blankets.
   *
   * Each is asserted to be *needed* — the construct it excuses is really
   * there — and to be *narrow*: a spell id written anywhere but that construct
   * still fails, in the same file as readily as anywhere else.
   */
  it('excludes only words the engine uses for something else', () => {
    expect([...ALSO_VOCABULARY].sort()).toEqual([
      'command',
      'darkness',
      'darkvision',
      'divination',
      'fly',
      'heal',
      'light',
      'resistance',
      'shield',
      'slow',
      'teleport',
    ]);
    // `withEquipment` moved with the rest of the reducer in IE-039 and again
    // with its seam in IE-050; the construct the allowance excuses is read
    // where it now lives.
    expect(source('fold/inventory.ts')).toContain("category === 'shield'");
    expect(source('attack.ts')).toContain("weapon.properties.includes('light')");
    // And the third: the glossary's four senses, transcribed once so that the
    // validator and the union cannot drift apart. The construct is pinned, so
    // the allowance is answering for something that is really there.
    //
    // **What it is not is narrow, and neither are the two above.** The
    // exclusion is word-level and global: `namedIn` drops the word from `IDS`
    // before it scans any file, so a `'darkvision'` in `attack.ts` would go
    // unreported exactly as a `'shield'` there would. That is the price of a
    // word the book uses twice, and the compensation is the assertion below —
    // the file that owns the mechanic writes the word only where the glossary
    // is being transcribed **and in the one rule the sense is a rule about**,
    // which is checkable and is checked.
    //
    // **P3-S added that third line, and it is the point of the allowance
    // rather than a crack in it.** Darkvision's own sentence is "in Darkness
    // as if it were Dim Light", and until light was on the lattice there was
    // nothing in this engine for the sense to read — `docs/design/light-and-
    // sight.md` says so outright. `piercesObscurement` is that sentence, and
    // it is about the level 2 Illusion no more than `SENSE_NAMES` is.
    const GLOSSARY = [
      "export const SENSE_NAMES = ['blindsight', 'darkvision', 'tremorsense', 'truesight'] as const;",
      "export const SIGHT_SENSES: ReadonlySet<SenseName> = new Set<SenseName>([",
    ];
    const DARKVISION_RULE =
      "return !here.light.magical && senses.some((sense) => sense.sense === 'darkvision');";
    for (const construct of GLOSSARY) expect(source('positioning.ts')).toContain(construct);
    expect(
      linesOf(source('positioning.ts'))
        .filter((line) => line.includes("'darkvision'"))
        .map((line) => line.trim()),
    ).toEqual([DARKVISION_RULE, GLOSSARY[0], "'darkvision',"]);
    // And the two that are effect **kinds**, which is the sharper collision:
    // the word is in the union the whole vocabulary is written in.
    expect(source('spell-definitions.ts')).toContain("readonly kind: 'heal'");
    expect(source('spell-definitions.ts')).toContain("readonly kind: 'teleport'");
    // And the sixth, which is not an effect kind but the retry rule itself:
    // the field every idempotent event carries, read in the one place the
    // fold reads it.
    expect(source('fold/apply.ts')).toContain("!('command' in event)");
    expect(source('monster.ts')).toContain(
      "readonly kind: 'immunity' | 'resistance' | 'vulnerability';",
    );
    // And the eighth, which is a school of magic: the validator transcribes
    // the book's eight and one of them is spelled like a spell. Pinned the
    // way the glossary above is — the file that owns the mechanic writes the
    // word only where the eight are being listed.
    expect(source('spell-schema.ts')).toContain("const SCHOOLS: ReadonlySet<string> = new Set([");
    expect(
      linesOf(source('spell-schema.ts'))
        .filter((line) => line.includes("'divination'"))
        .map((line) => line.trim()),
    ).toEqual(["'divination',"]);
    // And the ninth, which is a Speed. `MovementMode` transcribes the
    // glossary's five in one line, the way `SENSE_NAMES` transcribes the four
    // senses, and the word is then read as one of the five wherever a rule
    // asks which Speed a move was made with. Both halves are pinned: the
    // transcription is really there, and there is really a rule reading it,
    // so the allowance is answering for a mechanic rather than for a name.
    expect(source('character.ts')).toContain(
      "export type MovementMode = 'walk' | 'fly' | 'climb' | 'swim' | 'burrow';",
    );
    expect(source('commands/movement.ts')).toContain("mode === 'fly'");
    // And the tenth, which is a weapon mastery property. `WEAPON_MASTERIES`
    // in `@ie/srd` transcribes the seven the book prints and
    // `commands/mastery.ts` branches on one of them after a blow lands — a
    // Speed reduced by ten feet by a Heavy Crossbow, not by a level 3
    // Transmutation. Both halves pinned, as the Speed above is.
    expect(WEAPON_MASTERIES).toContain('slow');
    expect(source('commands/mastery.ts')).toContain("case 'slow':");
    // And the eleventh, which is a level of light. `LIGHT_LEVELS` transcribes
    // the glossary's three in one line, the way `SENSE_NAMES` transcribes the
    // four senses, and the word is then read as one of the three wherever a
    // rule asks how bright a space is. Both halves pinned, as the Speed is:
    // the transcription is really there, and there is really a rule reading
    // it — the sentence that makes magical darkness defeat Darkvision.
    expect(source('positioning.ts')).toContain(
      "export const LIGHT_LEVELS = ['bright', 'dim', 'darkness'] as const;",
    );
    expect(source('positioning.ts')).toContain("patch.level === 'darkness'");
    expect(source('standing.ts')).toContain("export const SEES_THROUGH = ['darkness'] as const;");
  });

  it('allows the two data constructs and nothing around them', () => {
    // Each is needed: the catalogue really writes its ids that way, and the
    // class tables really write their grants that way, or it excuses nothing
    // — in the content package, which is the only place either construct is.
    expect(linesOf(content('spells.ts')).filter((line) => ID_LINE.test(line)).length)
      .toBeGreaterThan(100);
    expect([...content('classes/cleric.ts').matchAll(SPELL_GRANT)]).not.toEqual([]);

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
    const classFiles = SRD_CONTENT.classes.map((c) => `classes/${c.id}.ts`);
    const grants = classFiles.flatMap((file) =>
      [...content(file).matchAll(/fixed: \[[^\]]*\]/g)].map((match) => [file, match[0]] as const),
    );
    // Not vacuous: the class tables really do grant spells this way.
    expect(grants.length).toBeGreaterThan(3);
    for (const [file, grant] of grants) {
      expect(proseOf(grant), `${file}: ${grant}`).toBe('fixed: []');
    }
  });

  it('allowlists nothing', () => {
    expect(ALLOWED_COMPARISONS).toEqual({});
    for (const file of RUNTIME) expect(comparedIn(source(file)), file).toEqual([]);
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

  /**
   * And a second roll's own list, which is a list of effects.
   *
   * SRD Ice Knife's burst is a parent rather than a rider — see
   * `SequencedBurst` — so its children are swept in their own right rather
   * than as objects below somebody else's effect, which is what {@link below}
   * then excludes. Derived off `EVERY_EFFECT` rather than off the spell's own
   * list, so a `then` written on an activation's or an area trigger's attack
   * is swept too: the exception {@link below} makes is host-shaped, and an
   * exception wider than the sweep that pays for it is the hole this whole
   * describe block exists to refuse.
   */
  const EVERY_SEQUENCE = EVERY_EFFECT.flatMap(([path, effect]) =>
    (effect.kind === 'attack' ? (effect.then?.effects ?? []) : []).map(
      (child, n) => [`${path}.then.effects[${n}]`, child] as const,
    ),
  );

  const EVERY_EFFECT_AND_SEQUENCE = [...EVERY_EFFECT, ...EVERY_SEQUENCE];

  /**
   * Every object strictly below `value`, with the path it was found at.
   *
   * **The `then` slot of an `attack` is not below an effect in the sense this
   * sweep means**: it is a second resolution sequenced after the first, with
   * its own area and its own effect list, and every one of those is a thing
   * the sweep exists to refuse *in a rider*. Its children are in
   * `EVERY_SEQUENCE`, so they are swept as the effects they are rather than
   * skipped — and the exception is the attack host's alone, which is the same
   * line the validator draws, so a `then` on any other kind is still caught
   * here as the nested effect it would be.
   */
  const below = (
    value: unknown,
    path: string,
    top = false,
  ): readonly (readonly [string, unknown])[] => {
    if (typeof value !== 'object' || value === null) return [];
    const skipThen =
      top && !Array.isArray(value) && (value as { kind?: unknown }).kind === 'attack';
    const entries: (readonly [string, unknown])[] = Array.isArray(value)
      ? value.map((entry, i) => [`${path}[${i}]`, entry] as const)
      : Object.entries(value as Record<string, unknown>)
          .filter(([key]) => !(skipThen && key === 'then'))
          .map(([key, entry]) => [`${path}.${key}`, entry] as const);
    return entries.flatMap(([at, entry]) => [[at, entry] as const, ...below(entry, at)]);
  };

  it('has some, so the sweep below is not vacuous', () => {
    expect(EVERY_EFFECT.length).toBeGreaterThan(50);
    expect(EVERY_SEQUENCE.length).toBeGreaterThan(0);
    expect(
      EVERY_EFFECT_AND_SEQUENCE.flatMap(([path, effect]) => below(effect, path, true)).length,
    ).toBeGreaterThan(50);
  });

  it('nests no effect below an effect, anywhere in the catalogue', () => {
    for (const [path, effect] of EVERY_EFFECT_AND_SEQUENCE) {
      for (const [at, nested] of below(effect, path, true)) {
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
    for (const [path, effect] of EVERY_EFFECT_AND_SEQUENCE) {
      for (const [at, nested] of below(effect, path, true)) {
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
    for (const [path, effect] of EVERY_EFFECT_AND_SEQUENCE) {
      // The one slot that is deliberately a second effect and not a rider —
      // see `SequencedBurst`, and the entry `EVERY_EFFECT` makes for its own
      // children, which are measured on their own terms above.
      const shallow = Object.fromEntries(
        Object.entries(effect as Record<string, unknown>).filter(([key]) => key !== 'then'),
      );
      expect(depthOf(shallow), path).toBeLessThanOrEqual(6);
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

  /**
   * And the one slot that **is** a parent, held to the three rules that keep a
   * sequence of two from becoming a program.
   *
   * SRD Ice Knife's burst is a second resolution and carries everything this
   * sweep refuses in a rider — a roll, an area, a target list of its own — so
   * the leaf rule steps over it and `checkSequencedBurst` takes its place.
   */
  describe('a second roll sequenced after the first', () => {
    const shard = (then: unknown): unknown => ({
      kind: 'attack',
      attack: 'ranged',
      damage: { dice: '1d10' },
      damageType: 'piercing',
      then,
    });

    const burst = (over: Record<string, unknown> = {}): unknown => ({
      area: { kind: 'sphere', radius: 5, origin: 'point' },
      effects: [
        { kind: 'save-damage', ability: 'dex', damage: { dice: '2d6' }, damageType: 'cold', onSuccess: 'none' },
      ],
      ...over,
    });

    it('takes a Sphere with a saving throw in it', () => {
      expect(problems(shard(burst()))).toEqual([]);
    });

    /** A Cone or a Line needs a direction, and the shard is already in the air. */
    it('refuses any shape but a Sphere', () => {
      expect(
        problems(shard(burst({ area: { kind: 'cone', length: 15, origin: 'self' } }))),
      ).toContain('burst_is_not_a_sphere');
    });

    it('refuses a radius smaller than a space', () => {
      expect(
        problems(shard(burst({ area: { kind: 'sphere', radius: 2, origin: 'point' } }))),
      ).toContain('bad_burst_radius');
    });

    it('refuses a burst that resolves nothing', () => {
      expect(problems(shard(burst({ effects: [] })))).toContain('burst_resolves_nothing');
    });

    /** The recursion the rider design refuses, arriving one storey up. */
    it('refuses a burst that carries a burst', () => {
      expect(problems(shard(burst({ effects: [shard(burst())] })))).toContain(
        'nested_sequenced_roll',
      );
    });

    /**
     * And the allowance is the attack host's alone.
     *
     * `attack` is the one kind whose type declares the slot, the one kind
     * `checkEffect` validates one on, and the one kind `runEffects` reads one
     * off — so a `then` anywhere else is a second resolution nothing would
     * ever perform. It stays what it was before the slot existed: a nested
     * effect, refused by the leaf denylist rather than accepted and dropped.
     */
    it('refuses a second roll hung on a host that would never perform one', () => {
      expect(
        problems({
          kind: 'save-damage',
          ability: 'dex',
          damage: { dice: '2d6' },
          damageType: 'fire',
          onSuccess: 'none',
          then: burst(),
        }),
      ).toContain('nested_effect');
    });

    /** And the children are checked as effects, by the rules effects are held to. */
    it('checks what the burst does by the rules every effect is held to', () => {
      expect(
        problems(
          shard(
            burst({
              effects: [
                { kind: 'save-damage', ability: 'dex', damage: { dice: 'two' }, damageType: 'cold', onSuccess: 'none' },
              ],
            }),
          ),
        ),
      ).toContain('bad_dice');
    });
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
 * The rules a rider carries that the type system cannot state, because one
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

  /**
   * **A casting the rider disowns is a casting the repeat cannot end.**
   * `outlivesCasting` records the condition under the spell's bare name with
   * no casting mark in it — that is the whole of what the field does — so a
   * repeat whose success ends "the spell" would look for one and find a
   * source `castingIdOf` answers null for.
   *
   * The third door of the rule `applyConditionTo` and `checkContent` already
   * hold: a repeat save under a source that is not a casting may only be
   * `end-on-target`. This is the one that can be caught at authoring, which is
   * where a definition's defects belong.
   */
  it('refuses a repeat that ends a casting the rider has disowned', () => {
    const repeats = { at: 'end-of-turn', onSuccess: 'end-casting' } as const;
    const host = (rider: Record<string, unknown>) => ({
      kind: 'save',
      ability: 'wis',
      condition: 'charmed',
      ...rider,
    });

    expect(problems(host({ repeats, outlivesCasting: true }))).toContain('repeat_ends_no_casting');
    // Either half alone is a sentence the SRD writes, and neither is refused.
    expect(problems(host({ repeats }))).toEqual([]);
    expect(problems(host({ outlivesCasting: true }))).toEqual([]);
    expect(
      problems(host({ repeats: { at: 'end-of-turn', onSuccess: 'end-on-target' }, outlivesCasting: true })),
    ).toEqual([]);
    // And `lasts` is not the same field wearing a different name: it shortens
    // the casting's hold on the condition and leaves the link in the source,
    // so there is still a casting for the success to end.
    expect(problems(host({ repeats, lasts: { seconds: 30 } }))).toEqual([]);
  });

  /**
   * **A deepening is the moment that changes the condition, so the condition
   * has no ending of its own.**
   *
   * SRD Sleep names one moment twice: "until the end of its next turn, at
   * which point it must repeat the save". Written as a `lasts` as well, the
   * two derived passes race the roll — `expireEffects` deletes the timer and
   * `dropOrphanedSaves` drops the pending save — so the failure branch the
   * author wrote would silently never fire. Refused at authoring, which is
   * where a definition's defects belong, rather than left to four docstrings
   * to claim a rule nothing keeps.
   */
  it('refuses a deepening beside a deadline of the condition own', () => {
    const host = (repeats: unknown, rider: Record<string, unknown> = {}) => ({
      kind: 'save',
      ability: 'wis',
      condition: 'incapacitated',
      repeats,
      ...rider,
    });
    const deepens = {
      at: 'end-of-turn',
      onSuccess: 'end-on-target',
      onFailure: { condition: 'unconscious' },
    } as const;

    expect(problems(host(deepens, { lasts: { seconds: 30 } }))).toContain(
      'deepening_with_a_deadline',
    );
    // Either half alone is Sleep and Sunburst, and neither is refused.
    expect(problems(host(deepens))).toEqual([]);
    expect(
      problems(host({ at: 'end-of-turn', onSuccess: 'end-on-target' }, { lasts: { seconds: 30 } })),
    ).toEqual([]);
  });

  /**
   * **And the condition it deepens *into* may carry one**, which is the other
   * side of the same argument rather than an exception to it.
   *
   * The rule above is about the condition the repeat sits on: its deadline and
   * the save's moment are one moment, so whichever pass runs first eats the
   * other. A deepening lands at a moment that has already arrived and is
   * scheduled there, so a span of its own races nothing — SRD Brass Dragon
   * Wyrmling's "the Unconscious condition **for 1 minute**" is that sentence
   * from the printed side, and `deepenedBy` schedules either the same way.
   */
  it('takes a span on the condition a failure deepens to, and refuses a span of none', () => {
    const host = (lasts: unknown) => ({
      kind: 'save',
      ability: 'wis',
      condition: 'incapacitated',
      repeats: {
        at: 'end-of-turn',
        onSuccess: 'end-on-target',
        onFailure: { condition: 'unconscious', lasts },
      },
    });

    expect(problems(host({ seconds: 60 }))).toEqual([]);
    expect(problems(host({ seconds: 0 }))).toContain('bad_rider_duration');
    // A turn-anchored moment is not a span, and the moment it would name is
    // the boundary that raised the failed save — this moment, said again.
    expect(problems(host('end-of-targets-next-turn'))).toContain('bad_rider_duration');
  });

  /** And the condition a failure deepens to is one of the SRD's fifteen. */
  it('refuses a deepening to a condition the glossary does not print', () => {
    expect(
      problems({
        kind: 'save',
        ability: 'wis',
        condition: 'incapacitated',
        repeats: {
          at: 'end-of-turn',
          onSuccess: 'end-on-target',
          onFailure: { condition: 'bewildered' },
        },
      }),
    ).toContain('unknown_condition');
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
    /**
     * What the host definition has to say for this kind to be legal in it.
     *
     * Empty for every kind but two. `summon` carries a rule about the
     * *definition* rather than about the effect — it is on its caster, so
     * `targets` is `{ count: 1, self: true }` — and Fire Dart throws a dart at
     * somebody else. `chance` carries the same rule for the same reason from
     * the other end: the die is thrown once for the casting, so a second
     * target would throw a second one. Without this the base-validity row
     * below would fail for a reason that has nothing to do with the effect it
     * is checking, and the junk sweep would pass for it.
     */
    readonly host?: Record<string, unknown>;
    /**
     * Which effect list this kind may be written in.
     *
     * Absent is the casting's own, which is every kind but one.
     * `change-altitude` reads a fact the **activation** states — how far and
     * which way, on the turn the later action is taken — so
     * `checkAltitudePlacement` refuses it anywhere else, and a row driven
     * through `effects` would refuse for that rather than for its junk.
     */
    readonly list?: 'activation';
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
      // A printed percentage. `percent` takes a number **or** an object, so
      // the junk it is fed is the values that are neither — a string, a
      // boolean, an array, and absent — and `onFailure` is a closed list of
      // one, which any string that is not it refuses.
      kind: 'chance',
      base: { kind: 'chance', percent: 50, onFailure: 'no-answer' },
      // The second kind with a rule about the *definition*, and it is
      // `summon`'s: the die is thrown once for the casting, so the casting is
      // on its caster and on nobody else.
      host: { targets: { count: 1, self: true } },
      fields: {
        percent: [undefined, null, 'nonsense', true, []],
        onFailure: required(STRING_JUNK),
      },
    },
    {
      // Damage that simply lands. Two required fields and one optional count,
      // and **no rider rows at all**, because the member carries no
      // `& OutcomeRiders` — a rider written beside a dart is refused by the
      // shape rather than by a rule, which is why there is nothing here to
      // feed junk to.
      kind: 'auto-damage',
      base: { kind: 'auto-damage', damage: { dice: '1d4', flat: 1 }, damageType: 'force' },
      fields: {
        damage: required(OBJECT_JUNK),
        damageType: required(STRING_JUNK),
        rolls: OBJECT_JUNK,
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
      // `repeats` is the hook a casting hosts — SRD Searing Smite's minute of
      // burning — and it is optional: Divine Smite prints none. What a wrong
      // *value* would be is anything but an object, which is what this row
      // sends; the pairing rules it is held to once it reads as one are
      // asserted by name in `burning-smite.test.ts`, because they refuse wrong
      // combinations rather than wrong types.
      fields: {
        damage: required(OBJECT_JUNK),
        damageType: required(STRING_JUNK),
        againstType: OBJECT_JUNK,
        repeats: OBJECT_JUNK,
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
      kind: 'revive',
      base: { kind: 'revive', within: 60, hitPoints: 1 },
      fields: { within: required(NUMBER_JUNK), hitPoints: required(NUMBER_JUNK) },
    },
    {
      kind: 'creature-type-override',
      base: { kind: 'creature-type-override', creatureType: 'Humanoid' },
      fields: { creatureType: required(STRING_JUNK) },
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
      // The base is the decoys, because that is the shape with the most to
      // get wrong: a count, a threshold, a die and two exception lists. The
      // junk sweep below drives every one of them through the validator, and
      // the ward and the retaliation are reached by the catalogue sweep, which
      // casts all three of the SRD spells that write this kind.
      kind: 'passive-defense',
      base: {
        kind: 'passive-defense',
        defense: { kind: 'decoys', count: 3, die: '1d6', deflectsOn: 3 },
      },
      fields: { defense: required(OBJECT_JUNK) },
    },
    {
      kind: 'damage-defense',
      base: { kind: 'damage-defense', damageTypes: ['fire'], defense: 'resistant' },
      fields: { damageTypes: required(ARRAY_JUNK), defense: required(STRING_JUNK) },
    },
    {
      kind: 'condition-immunity',
      base: { kind: 'condition-immunity', conditions: ['charmed'] },
      // One field and no second one, which is the difference from the defence
      // above: there is no Vulnerability to a condition and no halfway house,
      // so the list is the whole of what a definition states.
      fields: { conditions: required(ARRAY_JUNK) },
    },
    {
      kind: 'speed',
      base: { kind: 'speed', change: 'add', feet: 10 },
      // `feet` is `NUMBER_JUNK` rather than `required(NUMBER_JUNK)` where the
      // change is `add`: absent is exactly the case the pairing rule refuses,
      // and it is asserted by name below rather than swept as junk.
      fields: { change: required(STRING_JUNK), feet: NUMBER_JUNK },
    },
    {
      // Light the target carries: a level off the glossary's closed list and
      // a radius of at least one space, with the dim band beyond it optional
      // and held to the same arithmetic.
      kind: 'light',
      base: { kind: 'light', level: 'bright', radius: 20 },
      fields: {
        level: required(STRING_JUNK),
        radius: required(NUMBER_JUNK),
        dimBeyond: NUMBER_JUNK,
      },
    },
    {
      // A sense the target gains: a name off the glossary's list and a range
      // of at least one space.
      kind: 'sense',
      base: { kind: 'sense', sense: 'darkvision', feet: 60 },
      fields: { sense: required(STRING_JUNK), feet: required(NUMBER_JUNK) },
    },
    {
      // SRD Jump: "can jump up to 30 feet by spending 10 feet of movement."
      // Both fields are required and both are distances on the 5-foot
      // lattice: a jump of nothing is not a jump, and one that costs nothing
      // is a sentence the book does not print.
      kind: 'jump-allowance',
      base: { kind: 'jump-allowance', feet: 30, costsMovement: 10 },
      fields: { feet: required(NUMBER_JUNK), costsMovement: required(NUMBER_JUNK) },
    },
    {
      // An amount taken off later damage: the adjustment half of the printed
      // line the defence above is the multiplier half of. All three fields are
      // **required** — a reduction with no notation takes nothing off, a list
      // with no type never meets a blow it is about, and the once-per-turn
      // limit is printed in every SRD sentence of this shape, so leaving it
      // out would be granting a larger rule by omission.
      kind: 'damage-reduction',
      base: {
        kind: 'damage-reduction',
        reduces: { dice: '1d4' },
        damageTypes: ['fire'],
        oncePerTurn: true,
      },
      fields: {
        reduces: required(OBJECT_JUNK),
        damageTypes: required(ARRAY_JUNK),
        // `true` is the only legal value, so everything else is junk — `false`
        // included, which is the one row where a boolean is not a boolean.
        oncePerTurn: required([null, 'nonsense', 7, false]),
      },
    },
    {
      kind: 'attack-rider',
      base: { kind: 'attack-rider', dice: '1d6', damageType: 'force' },
      // Both are **required**, which is what separates a spell's rider from
      // the feature grant it mirrors: a feature may leave the type absent and
      // deal the weapon's own, and no SRD spell of this shape does. The two
      // clauses beside them — `weaponOnly` and `marksTarget` — are booleans the
      // book either prints or does not, so there is nothing to be wrong about.
      fields: { dice: required(STRING_JUNK), damageType: required(STRING_JUNK) },
    },
    {
      kind: 'weapon-rider',
      base: { kind: 'weapon-rider', die: '1d8' },
      // **Nothing here is required**, which is what separates this from the
      // rider above it: SRD Shillelagh writes a die, an ability and a melee
      // narrowing and no plus, and SRD Magic Weapon writes a plus and nothing
      // else. What the validator refuses instead is a rider that writes *none*
      // of them, and a band table with no base under it, and both are asserted
      // by name in `weapon-rider.test.ts` rather than swept as junk. The die
      // is the one field a wrong *value* can be wrong about.
      fields: { die: STRING_JUNK },
    },
    {
      kind: 'weapon-attack',
      base: { kind: 'weapon-attack', ability: 'spellcasting' },
      // **The substitution is required and the other two are not**: SRD True
      // Strike writes all three and a definition that wrote only the first is
      // a swing made with the caster's own ability and nothing else, which is
      // a sentence the format can hold. What a *wrong* substitution would be
      // is an ability nobody named, so the field is swept as junk as well as
      // required.
      //
      // The host is the three facts `checkWeaponAttack` holds the definition
      // to — a cantrip, Range: Self, and this effect alone — asserted by name
      // in `cantrip-with-the-swing.test.ts` rather than swept here.
      fields: {
        ability: required(STRING_JUNK),
        damageTypes: ARRAY_JUNK,
        extraDamage: OBJECT_JUNK,
      },
      host: { level: 0, range: { kind: 'self' } },
    },
    {
      kind: 'turn-payout',
      base: {
        kind: 'turn-payout',
        at: 'start-of-turn',
        payout: 'temporary-hit-points',
        addSpellcastingModifier: true,
      },
      // The moment and the kind are **required**, because a payout with
      // neither hands something unnamed over at a moment nobody chose. The
      // amounts are junk-swept rather than required individually: each of the
      // three is optional on its own and the rule is that *some* one of them
      // is written, which the pairing rule below asserts by name — the shape
      // `speed` and `teleport` already take for a clause the book either
      // prints or does not.
      fields: {
        at: required(STRING_JUNK),
        payout: required(STRING_JUNK),
        dice: STRING_JUNK,
        flat: NUMBER_JUNK,
        damageType: STRING_JUNK,
      },
    },
    {
      kind: 'action-rule',
      base: {
        kind: 'action-rule',
        rule: { kind: 'allows', action: 'disengage', from: 'bonus-action' },
      },
      // One field, and it is the whole of the effect: what the spell changes
      // about the turn. `checkActionRule` reads the vocabulary out of
      // `combat.ts`, so a rule naming a slot or an action no spender knows is
      // refused by the same list the primitives enforce.
      fields: { rule: required(OBJECT_JUNK) },
    },
    {
      kind: 'healing-rule',
      base: { kind: 'healing-rule', rule: 'maximised' },
      // One field, and it is the whole of the effect: which of the two things
      // the book says about regaining hit points. There is no amount, no
      // target and no moment — the standalone kind runs for the casting's own
      // duration — so the vocabulary is the only thing there is to get wrong.
      fields: { rule: required(STRING_JUNK) },
    },
    {
      kind: 'hit-point-maximum',
      base: { kind: 'hit-point-maximum', amount: { flat: 5 } },
      // One field, and it is required: a maximum held up by nothing is not
      // held up. What is *inside* the amount — that it names no dice and that
      // its numbers are positive whole ones — is a pairing rule rather than a
      // junk sweep, asserted by name in
      // `healing-and-hit-point-maxima.test.ts` where the kind's own rules are.
      fields: { amount: required(OBJECT_JUNK) },
    },
    {
      kind: 'teleport',
      base: { kind: 'teleport', feet: 30, requiresSight: true },
      // The destination is the **casting's** to state and is nowhere on the
      // definition, so the only field below the kind is the distance — and
      // `requiresSight` is a clause the book either prints or does not, which
      // the pairing rule below asserts by name rather than sweeping as junk.
      fields: { feet: required(NUMBER_JUNK) },
    },
    {
      kind: 'elsewhere',
      base: {
        kind: 'elsewhere',
        where: 'ethereal',
        at: 'end-of-turn',
        chance: { die: '1d6', onOrAbove: 4 },
        returns: { within: 10, requiresSight: true, at: 'start-of-turn' },
      },
      // Where, and the way back; the moment and the die are pairing rules —
      // a die only beside a moment, a way in never at a moment — asserted by
      // name below rather than swept as junk. The base carries a duration
      // because a creature sent elsewhere by an Instantaneous casting has no
      // ending to bring it back: see `grantCarried`.
      host: { durationSeconds: 60 },
      fields: { where: required(STRING_JUNK), returns: required(OBJECT_JUNK) },
    },
    {
      kind: 'summon',
      base: {
        kind: 'summon',
        monster: 'otherworldly-steed',
        armorClass: { base: 10, perSpellLevel: 1 },
        hitPoints: { base: 5, perSpellLevel: 10 },
        sharesCastersInitiative: true,
      },
      // The stat block's id is required and the two numbers a spell may print
      // over its own block are not — absent is every summons whose block is
      // the whole truth. `sharesCastersInitiative` is a clause the book either
      // prints or does not, which is the pairing `requiresSight` above takes.
      fields: {
        monster: required(STRING_JUNK),
        armorClass: OBJECT_JUNK,
        hitPoints: OBJECT_JUNK,
      },
      host: { targets: { count: 1, self: true } },
    },
    {
      // SRD Levitate: "change the target's altitude by up to 20 feet in either
      // direction." One printed number, required, and on the same 5-foot
      // lattice the jump above it is measured on.
      //
      // **The one kind driven through an activation's list**, because that is
      // the only list it may be written in — see `list`. Its host concentrates
      // so that both lifetimes the junk sweep drives are legal definitions: an
      // activation needs a casting that is still running, and the sweep's
      // second pass supplies no duration.
      kind: 'change-altitude',
      base: { kind: 'change-altitude', upTo: 20 },
      fields: { upTo: required(NUMBER_JUNK) },
      host: { concentration: true },
      list: 'activation',
    },
  ];

  /**
   * The definition that carries one effect, in whichever list that kind lives
   * in.
   *
   * One builder, two drivers: the base-validity check and the junk sweep both
   * have to put the effect in the same place, and a second spelling of "wrap
   * it in an activation" would be a second place for the wrapper to be wrong.
   */
  const carrying = (
    effect: Record<string, unknown>,
    list: 'activation' | undefined,
  ): Record<string, unknown> =>
    list === 'activation'
      ? {
          effects: [],
          activation: {
            action: 'action',
            label: 'the later action',
            range: { kind: 'ranged', feet: 30 },
            effects: [effect],
          },
        }
      : { effects: [effect] };

  /**
   * The fixtures are real, which is what makes every row below mean anything.
   *
   * A base that was itself malformed would make the sweep pass for the wrong
   * reason: every row would refuse, and none of them because of the junk.
   */
  it.each(BRANCHES.map((b) => [b.kind, b.base, b.host ?? {}, b.list] as const))(
    'starts from a %s the validator accepts',
    (_kind, base, host, list) => {
      expect(
        checkSpellDefinitionValue({
          ...FIRE_DART,
          durationSeconds: 60,
          ...host,
          ...carrying(base, list),
        }),
      ).toEqual([]);
    },
  );

  /**
   * `dispel`, `interrupt-casting` and `end-attunement` contribute no rows, and
   * that is the honest entry rather than an omission: their branches read no
   * field at all, so the `kind` `checkShape` has already established is the
   * whole effect and there is nothing below it to be malformed. The third
   * joined for the first's exact reason — which object a Remove Curse unbinds
   * is stated at the casting, not printed on the definition — and what stops
   * *that* field being junk is `declaredFacts` and the pre-flight, not this.
   */
  const READ_NO_FIELD: ReadonlySet<string> = new Set([
    'dispel',
    'interrupt-casting',
    // The third, and it is the same entry for the same reason: SRD Feather
    // Fall prints an outcome rather than an amount — "takes **no** damage from
    // the fall" — so `fall-ward` carries no field at all and the `kind`
    // `checkShape` has already established is the whole effect.
    'fall-ward',
    'end-attunement',
    // The fifth, and the plainest of them: SRD Spare the Dying's whole content
    // is "The creature becomes Stable", so `stabilise` carries no field
    // either. Who it may be aimed at is `TargetRule.mustBeDying`, which is
    // swept where every other target rule is.
    'stabilise',
    // And the sixth: SRD Gentle Repose's mark carries no field either. What
    // `revive` reads is the casting's own running span, which is on the
    // ongoing record rather than on the effect.
    'preserves',
  ]);

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

  const rows = BRANCHES.flatMap(({ kind, base, fields, host, list }) =>
    Object.entries(fields).flatMap(([field, junk]) =>
      junk.map(
        (value) =>
          [
            `${kind}.${field} = ${JSON.stringify(value) ?? 'undefined'}`,
            base,
            field,
            value,
            host ?? {},
            list,
          ] as const,
      ),
    ),
  );

  // **The host travels with the row**, for the reason it travels with the
  // base-validity check above: a row whose *definition* is illegal refuses
  // before the junk is read, and `isErr` cannot tell the two apart — the
  // sweep would go on passing while testing nothing. `summon` is the one kind
  // with a rule about its host, and Fire Dart throws its dart at somebody else.
  it.each(rows)('answers with a refusal for %s', (_label, base, field, value, host, list) => {
    // Both lifetimes, because the rule that reads a rider a second time
    // returns early the moment a casting persists — which is exactly what kept
    // `grantCarried`'s unguarded walk out of reach of the case that found it.
    for (const lifetime of [{ durationSeconds: 60 }, {}]) {
      const definition = {
        ...FIRE_DART,
        ...lifetime,
        ...host,
        ...carrying({ ...base, [field]: value }, list),
      };
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
    // IE-035's band table, which the duration rules walk with `Object.keys`: a
    // value that is not an object reaches it and `Object.keys(null)` throws
    // out of the `Result` half. `{}` is deliberately absent for the reason the
    // origin's is — an empty table is readable, and refusing it would be a
    // required-field rule rather than a guard.
    ...([null, 'nonsense', 7] as const).map(
      (junk) => ['durationAtSlot', junk] as readonly [string, unknown],
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
        // **A name the union does not hold and will not.** This said
        // `d20-test`, which the engine really did not make until the family of
        // D20 Tests arrived with SRD Ray of Enfeeblement — and the fixture
        // then stopped testing the guard and started testing the new member's
        // own refusal. A synthetic that a later batch can make real is not a
        // synthetic.
        modifier: { mode: 'advantage', selector: { roll: 'wibble', relation: 'roller' } },
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
   * And the fourth list, which is the casting's own under a word the caster
   * spoke — see `SpellDefinition.options`. A second branch, because one is
   * not a choice and `one_option` would drown out the rule under test.
   */
  const inBranch = (effect: unknown) =>
    codes(
      checkSpellDefinitionValue({
        ...FIRE_DART,
        effects: [],
        options: {
          hush: { label: 'Hush', handsOver: ['the target says nothing'] },
          word: { label: 'Word', effects: [effect] },
        },
      }),
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
   * **And inside a branch**, which is the one placement rule that does not
   * follow the drop's reading. A branch resolves in the same breath the
   * casting's own list does, so the stated fact is *there* — what is not
   * there is a reader: `statesFoughtFact` walks `effects` alone, so a clause
   * written here would never raise `fought_fact_required`, nobody would be
   * asked, and a caster who volunteered the answer would be refused
   * `no_fought_clause`. The Advantage would be silently unread, which is what
   * this refusal exists to stop. The reader moves before the permission does.
   */
  it('refuses it inside a branch, where nothing would ask for the fact', () => {
    expect(inBranch({ ...SAVE, advantageIfFought: true })).toEqual([
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

  /**
   * SRD Levitate's "An **unwilling** creature that succeeds on a Constitution
   * saving throw is unaffected" is the same shape of clause over the same kind
   * of stated fact, so it is held to the same three rules and tested against
   * the same three lists. What differs is only what the clause does to the
   * roll: the fought clause changes it and this one withholds it.
   */
  it('accepts an unwilling save on the casting’s own effect list', () => {
    expect(inList('effects', { ...SAVE, unlessWilling: true })).toEqual([]);
  });

  it('refuses an unwilling clause on a host that rolls no saving throw', () => {
    expect(
      inList('effects', {
        kind: 'attack',
        damage: { dice: '1d10' },
        damageType: 'fire',
        unlessWilling: true,
      }),
    ).toEqual(['consent_without_save']);
  });

  it('refuses an unwilling clause inside an area trigger and inside an activation', () => {
    expect(inList('areaTrigger', { ...SAVE, unlessWilling: true })).toEqual([
      'consent_outside_the_casting',
    ]);
    expect(inList('activation', { ...SAVE, unlessWilling: true })).toEqual([
      'consent_outside_the_casting',
    ]);
  });

  it('refuses any value but true for the unwilling clause', () => {
    expect(inList('effects', { ...SAVE, unlessWilling: false })).toEqual(['malformed_field']);
  });

  /**
   * And the pair that would have written something untrue cannot be authored
   * at all, which is why no third rule guards it.
   *
   * SRD Zone of Truth's `recordsOutcome` keeps "whether a creature succeeds
   * **or fails**", and a creature that consented was never offered a die to do
   * either with — so a `save` carrying both clauses would record a verdict
   * about a throw that never happened. The two existing rules already make it
   * impossible from opposite ends: a verdict may be kept only in a list that
   * fires off a record that exists, and consent may be read only in the
   * casting's own list, which is the one list a verdict may not be kept in. A
   * guard for the pair would be unreachable code claiming to be a rule; this
   * is the assertion that says so instead.
   */
  it('cannot be written beside a verdict, because the two lists exclude it', () => {
    expect(inList('effects', { ...SAVE, unlessWilling: true, recordsOutcome: true })).toEqual([
      'verdict_before_the_record',
    ]);
    expect(
      inList('areaTrigger', { ...SAVE, unlessWilling: true, recordsOutcome: true }),
    ).toEqual(['consent_outside_the_casting']);
  });

  /**
   * A recorded verdict is the same shape of rule with the sides swapped, which
   * is why it is tested against the same three lists.
   *
   * SRD Zone of Truth's "You know whether a creature succeeds or fails on this
   * save" is written onto the **ongoing record**, and the casting's own effect
   * list resolves before that record exists — `runEffects` runs and *then*
   * `spell-resolution.ts` pushes `spell-ongoing`. So a `recordsOutcome` in
   * `effects` would emit `casting-save-recorded` for a casting the fold has
   * never heard of, and `fold/ongoing.ts` throws `CorruptLogError` on it. That
   * is a homebrew definition that validates clean and then takes the campaign
   * down, which is exactly the class of failure the fourth outcome and this
   * validator exist to make impossible.
   */
  /**
   * A trigger needs an area to fire in, which is a different rule and would
   * drown this one out — the same reason `SAVE` above carries
   * `outlivesCasting`.
   */
  const inTrigger = (effect: unknown) =>
    codes(
      checkSpellDefinitionValue({
        ...FIRE_DART,
        area: { kind: 'sphere', radius: 15, origin: 'point' },
        areaTrigger: { at: 'start-of-turn', effects: [effect] },
      }),
    );

  it('refuses a recorded verdict in the casting’s own list, where there is no record yet', () => {
    expect(inList('effects', { ...SAVE, recordsOutcome: true })).toEqual([
      'verdict_before_the_record',
    ]);
  });

  it('accepts one in either list that fires off a record the cast already wrote', () => {
    expect(inTrigger({ ...SAVE, recordsOutcome: true })).toEqual([]);
    // An activation has preconditions of its own that `FIRE_DART` does not
    // meet, so what is claimed here is the narrow thing: whatever else that
    // definition is wrong about, the verdict is not one of them.
    expect(
      inList('activation', { ...SAVE, recordsOutcome: true }).filter((code) =>
        code.startsWith('verdict_'),
      ),
    ).toEqual([]);
  });

  it('refuses a recorded verdict on a host that rolls no saving throw', () => {
    expect(
      inTrigger({
        kind: 'attack',
        damage: { dice: '1d10' },
        damageType: 'fire',
        recordsOutcome: true,
      }),
    ).toEqual(['verdict_without_save']);
  });

  /** Absence is how a definition says it keeps nothing — see above. */
  it('refuses any value but true for a recorded verdict', () => {
    expect(inTrigger({ ...SAVE, recordsOutcome: false })).toEqual(['malformed_field']);
    expect(inTrigger({ ...SAVE, recordsOutcome: 'yes' })).toEqual(['malformed_field']);
  });

  /**
   * And the rule it lifts, in both directions. A bare save is still a die
   * thrown for nothing; a bare save whose answer somebody keeps is the spell
   * gate G1 ruled on.
   */
  it('lifts save_imposes_nothing only for a save that keeps its answer', () => {
    const BARE = { kind: 'save', ability: 'cha' };
    expect(inTrigger(BARE)).toEqual(['save_imposes_nothing']);
    expect(inTrigger({ ...BARE, recordsOutcome: true })).toEqual([]);
  });

  /**
   * A teleport has exactly one home for the same reason and by the same rule:
   * **where the creature goes is stated at the casting**, through
   * `CastSpellRequest.teleportTo`, and pinned on a declaration so a settlement
   * can read it back. An area trigger fires a minute later off an
   * `OngoingSpell` that carries no destination, and an activation the same, so
   * a teleport written in either list would reach `resolveEffects` with
   * nowhere to go.
   */
  it('refuses a teleport anywhere the destination cannot reach it', () => {
    const STEP = { kind: 'teleport', feet: 30 };
    expect(inList('effects', STEP)).toEqual([]);
    expect(inList('areaTrigger', STEP)).toEqual(['teleport_outside_the_casting']);
    expect(inList('activation', STEP)).toEqual(['teleport_outside_the_casting']);
  });

  /**
   * And the one number a teleport prints is a whole number of feet on the
   * 5-foot lattice everything else is measured on — a teleport of two feet is
   * a distance the engine has no way to be at.
   */
  it('refuses a distance the lattice cannot hold', () => {
    expect(inList('effects', { kind: 'teleport', feet: 2 })).toEqual(['bad_teleport_distance']);
    expect(inList('effects', { kind: 'teleport', feet: 0 })).toEqual(['bad_teleport_distance']);
    expect(inList('effects', { kind: 'teleport' })).toEqual(['bad_teleport_distance']);
  });

  /**
   * SRD Web's "while in the webs" is the third rule of this shape, and the
   * only list that can answer it is the trigger's: `AreaTrigger` is pinned
   * whole onto the ongoing record at the cast, so the mark and the geometry
   * are read out of one value. The casting's own list is not pinned anywhere,
   * and an activation's is not either.
   */
  it('accepts an area-bound condition in the one list that has an area', () => {
    // `FIRE_DART` is Instantaneous, so a condition the casting owns has
    // nothing to end it — `grant_without_lifetime`, which is a different rule.
    // What is claimed here is the narrow thing: the area lifetime is not among
    // whatever else that definition is wrong about.
    expect(
      inTrigger({
        kind: 'save',
        ability: 'dex',
        condition: 'restrained',
        endsWhenOutsideArea: true,
      }).filter((code) => code.startsWith('area_lifetime_')),
    ).toEqual([]);
  });

  it('refuses an area-bound condition where no pinned area reaches it', () => {
    const BOUND = { ...SAVE, endsWhenOutsideArea: true };
    expect(inList('effects', BOUND)).toContain('area_lifetime_without_an_area');
    expect(inList('activation', BOUND)).toContain('area_lifetime_without_an_area');
  });

  /** The nested layout is the same rule at the other path. */
  it('refuses one written in a rider list too', () => {
    expect(
      inList('effects', {
        kind: 'condition',
        condition: { name: 'restrained', endsWhenOutsideArea: true, outlivesCasting: true },
      }),
    ).toContain('area_lifetime_without_an_area');
  });

  /**
   * And a condition the casting has disowned has no area to be bounded by:
   * `outlivesCasting` records it under the spell's bare name with no casting
   * mark, and the area belongs to the casting.
   */
  it('refuses an area-bound condition the casting does not keep', () => {
    expect(
      inTrigger({
        kind: 'save',
        ability: 'dex',
        condition: 'restrained',
        endsWhenOutsideArea: true,
        outlivesCasting: true,
      }),
    ).toContain('area_lifetime_without_a_casting');
  });

  /** Absence is how a definition says the condition is not bound to the area. */
  it('refuses any value but true for an area-bound condition', () => {
    expect(
      inTrigger({
        kind: 'save',
        ability: 'dex',
        condition: 'restrained',
        endsWhenOutsideArea: false,
      }),
    ).toContain('malformed_field');
  });
});

/**
 * A payout at a turn boundary, and the four things a definition can get wrong.
 *
 * Each is a sentence the SRD either prints or refuses to, and each is asserted
 * by name here rather than swept as junk — the shape `speed`'s pairing rule and
 * `teleport`'s lattice already take, for the same reason: what makes a rule a
 * *guard* is a definition built to fail it.
 */
describe('a payout at a turn boundary names its moment, its kind and its amount', () => {
  /** A minute, because the eighth grant carries no lifetime of its own. */
  const lasting = (effect: unknown): readonly string[] =>
    codes(checkSpellDefinitionValue({ ...FIRE_DART, durationSeconds: 60, effects: [effect] }));

  const PAYOUT = {
    kind: 'turn-payout',
    at: 'start-of-turn',
    payout: 'temporary-hit-points',
    addSpellcastingModifier: true,
  };

  it('accepts Heroism’s own clause', () => {
    expect(lasting(PAYOUT)).toEqual([]);
  });

  /**
   * "At the start of each of its turns" and "at the end of each of its turns"
   * are a full round apart, which is why the moment is two words and not a
   * vaguer one — the reading `AreaTrigger.at` has taken since durations landed.
   */
  it('refuses a moment that is neither the start nor the end of a turn', () => {
    expect(lasting({ ...PAYOUT, at: 'each-round' })).toEqual(['bad_payout_moment']);
    expect(lasting({ ...PAYOUT, at: undefined })).toEqual(['bad_payout_moment']);
  });

  it('refuses a payout of something the engine cannot hand over', () => {
    expect(lasting({ ...PAYOUT, payout: 'inspiration' })).toEqual(['unknown_payout']);
  });

  /**
   * A payout naming no dice, no number and no modifier hands over nothing
   * every turn for a minute, and it compiles — the reading that already
   * refuses a granted Immunity to no condition and a defence against no
   * damage type.
   */
  it('refuses a payout that hands over nothing', () => {
    expect(lasting({ kind: 'turn-payout', at: 'end-of-turn', payout: 'healing' })).toEqual([
      'pays_nothing',
    ]);
  });

  /**
   * Damage meets a creature's defences by type, so a payout of damage names
   * one and a payout of anything else may not: nothing reads a type off
   * healing, and a definition that wrote one would be stating a rule the
   * engine would silently drop.
   */
  it('pairs a damage type with a payout of damage, and refuses it anywhere else', () => {
    const hurt = { kind: 'turn-payout', at: 'end-of-turn', payout: 'damage', dice: '1d6' };
    expect(lasting({ ...hurt, damageType: 'psychic' })).toEqual([]);
    expect(lasting(hurt)).toEqual(['missing_damage_type']);
    expect(lasting({ ...hurt, damageType: 'sonic' })).toEqual(['unknown_damage_type']);
    expect(lasting({ ...PAYOUT, damageType: 'psychic' })).toEqual(['damage_type_on_a_payout']);
  });

  /** And the dice are dice, judged rather than thrown on. */
  it('refuses a notation that is not one', () => {
    expect(lasting({ ...PAYOUT, dice: 'a handful' })).toEqual(['bad_dice']);
    expect(lasting({ ...PAYOUT, flat: 1.5 })).toEqual(['bad_payout_amount']);
  });

  /**
   * And it is a **grant**, so an Instantaneous spell cannot carry one: the
   * casting is the only thing that could stop the payments, and a casting that
   * is over the moment it happens has no turns left to pay out on.
   */
  it('refuses one on a casting with nothing to end it', () => {
    expect(codes(checkSpellDefinitionValue({ ...FIRE_DART, effects: [PAYOUT] }))).toEqual([
      'grant_without_lifetime',
    ]);
  });
});

describe('a casting time of a minute or more names the minute', () => {
  /**
   * SRD writes the bucket — "minutes or even hours" — and the number is the
   * spell's own. `long` is therefore not a duration, and a definition in that
   * bucket that names no span has nothing the engine could defer the casting
   * to; there is no plausible value to fall back to, which is the
   * `packages/srd/raw` rule arriving at the definition format.
   *
   * **Twelve catalogue definitions are `long` now** and every one of them
   * obeys these rules, which is what makes them rules the format holds rather
   * than rules nothing could break: the only way to know either is a *guard*
   * is still a definition built to fail it, exactly as
   * `grant_without_lifetime`'s own test does and for the same reason.
   */
  const LONG: SpellDefinition = {
    ...FIRE_DART,
    castingTime: 'long',
    castingSeconds: 60,
  };

  it('accepts a long casting that names its seconds', () => {
    expect(checkSpellDefinition(LONG)).toEqual([]);
  });

  it('refuses a long casting with no span at all', () => {
    expect(
      codes(checkSpellDefinition({ ...FIRE_DART, castingTime: 'long' } as SpellDefinition)),
    ).toEqual(['bad_casting_seconds']);
  });

  /** A minute is the floor, because a minute is what the bucket means. */
  it('refuses a long casting shorter than the minute the bucket names', () => {
    expect(codes(checkSpellDefinition({ ...LONG, castingSeconds: 6 }))).toEqual([
      'bad_casting_seconds',
    ]);
  });

  it('refuses a span that is not a whole number of seconds', () => {
    expect(codes(checkSpellDefinition({ ...LONG, castingSeconds: 90.5 }))).toEqual([
      'bad_casting_seconds',
    ]);
  });

  /**
   * And the other direction: an Action, a Bonus Action and a Reaction are
   * moments in a turn rather than spans, so a number of seconds beside one is
   * a field nothing could read.
   */
  it('refuses a span of seconds on a casting time that is a moment', () => {
    expect(
      codes(checkSpellDefinition({ ...FIRE_DART, castingSeconds: 60 } as SpellDefinition)),
    ).toEqual(['casting_seconds_without_long']);
  });

  /** Including on a Reaction, which is the shortest moment the engine has. */
  it('refuses one on a Reaction too', () => {
    expect(
      codes(
        checkSpellDefinition({
          ...FIRE_DART,
          castingTime: 'reaction',
          trigger: 'hit-by-attack',
          castingSeconds: 60,
        } as SpellDefinition),
      ),
    ).toEqual(['casting_seconds_without_long']);
  });
});

/**
 * A higher slot lengthens the duration the spell already prints.
 *
 * Every rule here fires on **no** catalogue definition — the six spells that
 * carry a band table were driven through before the rules were written, as
 * every rule in this file was — so the only way to know any of them is a guard
 * is a definition built to fail it. That is `grant_without_lifetime`'s own
 * argument, arriving on the duration.
 */
describe('a band table is a lengthening, not a duration of its own', () => {
  /** A level 4 spell that runs a minute, which every case below mutates. */
  const HOLD_THE_LINE: SpellDefinition = {
    ...FIRE_DART,
    level: 4,
    concentration: true,
    durationSeconds: 60,
  };

  it('accepts a table that climbs above the spell’s own level', () => {
    expect(
      checkSpellDefinition({ ...HOLD_THE_LINE, durationAtSlot: { 5: 600, 6: 3600 } }),
    ).toEqual([]);
  });

  /**
   * **A table with nothing to lengthen leaves every lower slot with none.**
   * `durationSecondsAt` falls back to `durationSeconds` below the first band,
   * so a definition carrying only the table would be Instantaneous at its own
   * level and run for an hour one level up.
   */
  it('refuses a table on a spell that prints no duration', () => {
    const instantaneous: Record<string, unknown> = { ...HOLD_THE_LINE };
    delete instantaneous['durationSeconds'];
    expect(
      codes(
        checkSpellDefinition({
          ...(instantaneous as unknown as SpellDefinition),
          concentration: false,
          durationAtSlot: { 5: 600 },
        }),
      ),
    ).toEqual(['band_without_duration']);
  });

  /** A cantrip is cast from no slot, so no band of a slot table is reachable. */
  it('refuses a table on a cantrip', () => {
    expect(
      codes(
        checkSpellDefinition({
          ...HOLD_THE_LINE,
          level: 0,
          effects: [{ kind: 'attack', attack: 'ranged', damage: { dice: '1d10' }, damageType: 'fire' }],
          durationAtSlot: { 1: 600 },
        }),
      ),
    ).toEqual(['slot_scaling_on_cantrip']);
  });

  /**
   * SRD writes every one of these under *Using a Higher-Level Spell Slot*, so
   * a band at or below the spell's own level is the duration it already prints
   * said twice — and one outside the nine slot levels names no slot at all.
   */
  it.each([
    [{ 4: 600 }, 'its own level'],
    [{ 3: 600 }, 'a level it cannot be cast at'],
    [{ 10: 600 }, 'a tenth slot level'],
    [{ 0: 600 }, 'no slot at all'],
  ])('refuses a band at %o — %s', (durationAtSlot, why) => {
    expect(codes(checkSpellDefinition({ ...HOLD_THE_LINE, durationAtSlot })), why).toEqual([
      'bad_slot_level',
    ]);
  });

  /**
   * **Every band is longer than the one below it**, which is the transcription
   * guard rather than a tidiness rule: a digit dropped from 28800 reads as a
   * plausible number and *shortens* the spell, which is the class of wrong
   * number this repository calls its worst.
   */
  it.each([
    [{ 5: 30 }, 'shorter than the printed duration'],
    [{ 5: 600, 6: 600 }, 'no longer than the band below it'],
    [{ 5: 600, 6: 120 }, 'shorter than the band below it'],
  ])('refuses %o — %s', (durationAtSlot, why) => {
    expect(codes(checkSpellDefinition({ ...HOLD_THE_LINE, durationAtSlot })), why).toEqual([
      'bad_duration',
    ]);
  });

  it.each([['nonsense'], [1.5], [0], [-60]])('refuses %s seconds in a band', (seconds) => {
    expect(
      codes(
        checkSpellDefinition({
          ...HOLD_THE_LINE,
          durationAtSlot: { 5: seconds } as unknown as Readonly<Record<number, number>>,
        }),
      ),
    ).toEqual(['bad_duration']);
  });
});

/**
 * The seventh template, and the rules a definition may not break about it.
 *
 * SRD Wind Wall is the only spell in the book whose area is drawn rather than
 * printed, and everything a *definition* can say about it is a bound: how long
 * a path the caster may draw, and how high it stands. The one rule that is not
 * a number is the important one — a wall answers at the casting and nothing
 * later, because the path is not pinned on the record, so every clause that
 * would ask again is refused where it is written rather than silently doing
 * nothing.
 */
describe('a wall is bounded by its definition and asks once', () => {
  const WALL = {
    ...FIRE_DART,
    targets: { count: 0 },
    concentration: true,
    durationSeconds: 60,
    area: { kind: 'wall', length: 50, height: 15, origin: 'point' },
    effects: [
      {
        kind: 'save-damage',
        ability: 'str',
        damage: { dice: '4d8' },
        damageType: 'bludgeoning',
        onSuccess: 'half',
      },
    ],
  };

  it('accepts the bounds SRD Wind Wall prints', () => {
    expect(codes(checkSpellDefinitionValue(WALL))).toEqual([]);
  });

  it.each([
    ['length', 0],
    ['length', 12],
    ['height', -5],
    ['height', 'tall'],
  ])('refuses a %s of %s', (field, value) => {
    expect(
      codes(checkSpellDefinitionValue({ ...WALL, area: { ...WALL.area, [field]: value } })),
    ).toContain('bad_wall_dimension');
  });

  /** No SRD wall rises at its caster, and one that did could not be drawn. */
  it('refuses a wall that starts at the caster', () => {
    expect(
      codes(checkSpellDefinitionValue({ ...WALL, area: { ...WALL.area, origin: 'self' } })),
    ).toContain('wall_starts_at_a_point');
  });

  /**
   * And the rule the design rests on, narrowed by one clause: the path is
   * drawn at the casting, and the record now pins it — `OngoingSpell.path` —
   * so what a wall does to a creature standing in it (`areaStanding`, SRD Wind
   * Wall's own barrier and deflection) can be read again. A trigger, terrain,
   * light and obscurement still settle nothing against a wall and are refused
   * at authoring rather than reading a shape nothing settles against.
   */
  it.each([
    [
      'areaTrigger',
      {
        at: 'end-of-turn',
        label: 'the wind',
        effects: [
          { kind: 'save-damage', ability: 'str', damage: { dice: '1d6' }, damageType: 'bludgeoning' },
        ],
      },
    ],
    ['areaTerrain', { costPerFoot: 2 }],
    ['areaLight', { level: 'dim' }],
    ['areaObscurement', { degree: 'lightly' }],
  ])('refuses %s beside a wall', (clause, value) => {
    expect(codes(checkSpellDefinitionValue({ ...WALL, [clause]: value }))).toContain(
      'wall_answers_once',
    );
  });

  it('admits a standing clause beside a wall, now that the record keeps the path', () => {
    expect(
      codes(
        checkSpellDefinitionValue({
          ...WALL,
          areaStanding: [{ kind: 'deflects-projectiles' }],
        }),
      ),
    ).not.toContain('wall_answers_once');
  });
});

/**
 * The two clauses SRD Flaming Sphere measures from the casting's own point.
 *
 * `within` is the reach that burns and `onPointEntry` is the space the sphere
 * is rolled into, and both are about a point: a carried area's origin is a
 * creature with a volume, and "within 5 feet of the Emanation" is not a
 * sentence the book prints.
 */
describe('a trigger measured from the casting’s point', () => {
  const TRIGGER_EFFECTS = [
    {
      kind: 'save-damage',
      ability: 'dex',
      damage: { dice: '2d6' },
      damageType: 'fire',
      onSuccess: 'half',
    },
  ];
  const SPHERE = {
    ...FIRE_DART,
    targets: { count: 0 },
    concentration: true,
    durationSeconds: 60,
    area: { kind: 'sphere', radius: 20, origin: 'point' },
    effects: [],
    areaTrigger: {
      at: 'end-of-turn',
      within: 5,
      label: 'the sphere',
      effects: TRIGGER_EFFECTS,
    },
  };

  it('accepts the reach SRD Flaming Sphere prints', () => {
    expect(codes(checkSpellDefinitionValue(SPHERE))).toEqual([]);
  });

  it.each([[0], [3], ['near']])('refuses a reach of %s', (within) => {
    expect(
      codes(
        checkSpellDefinitionValue({ ...SPHERE, areaTrigger: { ...SPHERE.areaTrigger, within } }),
      ),
    ).toContain('bad_trigger_reach');
  });

  /** A carried area has no point to measure from, and none to be rolled. */
  it.each([
    ['within', 5],
    ['onPointEntry', true],
  ])('refuses %s on an area the caster carries', (field, value) => {
    expect(
      codes(
        checkSpellDefinitionValue({
          ...SPHERE,
          area: { kind: 'emanation', distance: 10, origin: 'self' },
          areaTrigger: {
            at: 'end-of-turn',
            label: 'the aura',
            effects: TRIGGER_EFFECTS,
            [field]: value,
          },
        }),
      ),
    ).toContain('point_clause_without_a_point');
  });

  /**
   * And the two arrival clauses are refused together: the area sweeping over
   * somebody and the point being rolled into them are two SRD sentences, no
   * spell prints both, and a definition carrying both would catch one creature
   * twice for one move.
   */
  it('refuses the area arriving beside the point arriving', () => {
    expect(
      codes(
        checkSpellDefinitionValue({
          ...SPHERE,
          areaTrigger: { ...SPHERE.areaTrigger, onAreaEntry: true, onPointEntry: true },
        }),
      ),
    ).toContain('two_arrival_clauses');
  });

  /** Absence is how a definition says the sphere rams nobody. */
  it('refuses any value but true for the ram', () => {
    expect(
      codes(
        checkSpellDefinitionValue({
          ...SPHERE,
          areaTrigger: { ...SPHERE.areaTrigger, onPointEntry: 'yes' },
        }),
      ),
    ).toContain('malformed_field');
  });
});
