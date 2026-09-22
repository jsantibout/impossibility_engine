import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, type CharacterId, type Result } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { attackerConditionModes, targetConditionModes } from './conditions.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { spellSlotKey } from './resources.js';
import { declaredCasting } from './spellcasting.js';
import { checkSpellDefinitionValue } from './spell-schema.js';
import { conditionRiderOf } from './spell-definitions.js';
import { resolveSpell } from './commands.js';
import { armorClassOf, effectiveConditions, speedOf } from './standing.js';

/**
 * A saving throw whose failure imposes **no condition**.
 *
 * > SRD Slow: "Each target must succeed on a Wisdom saving throw or be
 * > affected by this spell for the duration. An affected target's Speed is
 * > halved, it takes a −2 penalty to AC ... and it can't take Reactions."
 * > SRD Faerie Fire: "Each creature in the Cube is also outlined if it fails
 * > a Dexterity saving throw ... affected creatures ... can't benefit from
 * > the Invisible condition."
 *
 * `save.condition` was required and its own docstring said why: a die thrown
 * for nothing. That was true while a failure could carry nothing *but* a
 * condition, and it stopped being true when {@link ModifierRider} arrived —
 * the two sentences above are a failure that hands out **grants and nothing
 * else**, which is the whole of the missing shape
 * `a-save-whose-failure-imposes-no-condition`.
 *
 * So the field is optional and the guard moves rather than going: a `save`
 * that imposes no condition **and hangs nothing** is still a die thrown for
 * nothing and is refused at authoring by `save_imposes_nothing`. What would
 * lift that is a door publishing the outcome — the engine may hold a fact
 * only the table reads when the fact is a roll it made and something says so
 * — and no such door exists, which is why Zone of Truth is still tracked.
 */

const id = (s: string): CharacterId => asCharacterId(s);
const WIZARD = id('wizard');
const OGRE = id('ogre');
const DRUID = id('druid');
const SNEAK = id('sneak');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 9,
  abilities: { str: 10, dex: 10, con: 10, int: 20, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
  ...over,
});

const added = (who: CharacterId, over: Partial<CharacterSheet> = {}): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(over),
  maxHp: 60,
  diesAtZero: false,
  creatureType: 'Humanoid',
});

const slot = (who: CharacterId, level: number, max: number): GameEvent => ({
  type: 'resource-pool-declared',
  id: who,
  pool: { key: spellSlotKey(level), label: `level ${level} spell slot`, max, recovers: 'long-rest' },
});

const must = <T,>(result: Result<T>): T => unwrap(result, 'the bare save');

/**
 * A bonus large enough to settle the save either way, so every assertion
 * below is about the branch and not about which way a die fell.
 */
const supply = (seed: string, bonus: number) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
  bonuses: [{ source: 'forced', flat: bonus }],
});

const FAILS = -40;
const SAVES = 40;

describe('what a definition may say about a save that imposes no condition', () => {
  const definition = (effect: unknown): unknown => ({
    id: 'homebrew-lag',
    name: 'Homebrew Lag',
    level: 3,
    school: 'transmutation',
    castingTime: 'action',
    concentration: true,
    range: { kind: 'ranged', feet: 120 },
    targets: { count: 1 },
    effects: [effect],
    durationSeconds: 60,
  });

  const codes = (effect: unknown): readonly string[] =>
    checkSpellDefinitionValue(definition(effect)).map((one) => one.code);

  it('accepts a save whose failure hands out a grant and nothing else', () => {
    expect(
      codes({
        kind: 'save',
        ability: 'wis',
        modifiers: [{ kind: 'speed-change', change: 'halve' }],
      }),
    ).toEqual([]);
  });

  it('still accepts the twenty-odd definitions that name a condition', () => {
    expect(codes({ kind: 'save', ability: 'wis', condition: 'restrained' })).toEqual([]);
  });

  /**
   * The guard the old requirement was standing in for, kept at the one place
   * it is still true: a `save` with neither a condition nor a rider settles
   * an outcome nothing reads and no door publishes.
   */
  it('refuses a save that imposes nothing and hangs nothing', () => {
    expect(codes({ kind: 'save', ability: 'wis' })).toContain('save_imposes_nothing');
  });

  /**
   * SRD writes "the target repeats the save" of a condition it imposed, and
   * the repeat is filed **on the condition instance** — so a failure that
   * imposes none has nothing to hang one on and no boundary would ever raise
   * it. Slow prints exactly that sentence, and it is the one clause of the
   * spell this shape does not finish.
   */
  it('refuses a repeat save on a failure that imposes no condition', () => {
    expect(
      codes({
        kind: 'save',
        ability: 'wis',
        modifiers: [{ kind: 'speed-change', change: 'halve' }],
        repeats: { at: 'end-of-turn', onSuccess: 'end-on-target' },
      }),
    ).toContain('repeat_without_condition');
  });

  /**
   * `conditions` is documented as *the rest* — the flat fields are the first
   * rider — so a list with the flat slot left empty is a second spelling of
   * one sentence, which is the fork `conditionRiderOf` exists to prevent.
   */
  it('refuses further conditions with no first one written flat', () => {
    expect(codes({ kind: 'save', ability: 'wis', conditions: [{ name: 'prone' }] })).toContain(
      'further_conditions_without_a_first',
    );
  });

  it('reads a condition-less save as carrying no condition rider at all', () => {
    expect(
      conditionRiderOf({
        kind: 'save',
        ability: 'wis',
        modifiers: [{ kind: 'speed-change', change: 'halve' }],
      }),
    ).toEqual([]);
  });
});

/**
 * SRD Slow, against a target that fails its save.
 *
 * Three grants off one Wisdom save: the Speed halved, the −2 to Armour Class
 * and the Reaction taken away. A second `save` effect for any of them would
 * have rolled a second saving throw, so a creature could have been slowed and
 * not penalised — which is not the spell.
 */
describe('Slow', () => {
  const SETUP: readonly GameEvent[] = [
    added(WIZARD),
    added(OGRE, { baseSpeed: 40, stated: { armorClass: 12, proficiencyBonus: 2, initiative: 0 } }),
    {
      type: 'spellcasting-declared',
      id: WIZARD,
      spellcasting: declaredCasting({
        ability: 'int',
        classId: 'wizard',
        prepared: ['slow'],
      }),
    },
    slot(WIZARD, 3, 2),
    { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
    { type: 'landmark-added', name: 'the road', at: { x: 100, y: 100, z: 0 } },
    { type: 'creature-placed', id: WIZARD, placement: { from: { landmark: 'the road' }, feet: 0 } },
    {
      type: 'creature-placed',
      id: OGRE,
      placement: { from: { creature: WIZARD }, feet: 20, bearing: 0 },
    },
  ];

  const cast = (bonus: number): GameState => {
    const out = must(
      resolveSpell(
        fold('seed', SETUP),
        WIZARD,
        {
          spellId: 'slow',
          targets: [OGRE],
          // The near corner of the 40-foot Cube on the wizard's own square,
          // pointed north up the line the ogre stands on twenty feet away.
          at: { x: 100, y: 100, z: 0 },
          towards: { x: 100, y: 200, z: 0 },
          slotLevel: 3,
        },
        supply('slow', bonus),
      ),
    );
    return fold('seed', [...SETUP, ...out.events]);
  };

  const reactionRules = (state: GameState): readonly string[] =>
    (state.creatures[OGRE]?.actionRules ?? [])
      .filter((one) => one.rule.kind === 'forbids' && one.rule.slots?.includes('reaction') === true)
      .map((one) => one.label);

  it('halves the Speed, subtracts two from the Armour Class and takes the Reaction away', () => {
    const state = cast(FAILS);

    expect(speedOf(state, OGRE), 'the ogre’s 40 halved').toBe(20);
    expect(armorClassOf(state, OGRE), '12 less the printed −2').toBe(10);
    expect(reactionRules(state)).toEqual(['Slow']);
  });

  /** And the failure imposes no condition at all, which is the whole point. */
  it('imposes no condition', () => {
    expect(effectiveConditions(cast(FAILS), OGRE).conditions).toEqual([]);
  });

  it('does none of it to a target that makes the save', () => {
    const state = cast(SAVES);

    expect(speedOf(state, OGRE)).toBe(40);
    expect(armorClassOf(state, OGRE)).toBe(12);
    expect(reactionRules(state)).toEqual([]);
  });
});

/**
 * SRD Faerie Fire's failed save, which takes a benefit away and gives nothing.
 *
 * The `benefit` rider was built before the save that hosts it could be
 * written, so this is the first casting in the catalogue to reach it off a
 * saving throw rather than off a hit — and the Cube picks its own targets,
 * because the sentence is "**each** creature in the Cube".
 */
describe('Faerie Fire', () => {
  const SETUP: readonly GameEvent[] = [
    added(DRUID, {
      spellcastingAbility: 'wis',
      abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 20, cha: 10 },
    }),
    added(SNEAK, { stated: { armorClass: 12, proficiencyBonus: 2, initiative: 0 } }),
    {
      type: 'spellcasting-declared',
      id: DRUID,
      spellcasting: declaredCasting({
        ability: 'wis',
        classId: 'druid',
        prepared: ['faerie-fire'],
      }),
    },
    slot(DRUID, 1, 2),
    { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
    { type: 'landmark-added', name: 'the road', at: { x: 100, y: 100, z: 0 } },
    { type: 'creature-placed', id: DRUID, placement: { from: { landmark: 'the road' }, feet: 0 } },
    {
      type: 'creature-placed',
      id: SNEAK,
      placement: { from: { creature: DRUID }, feet: 15, bearing: 0 },
    },
    { type: 'condition-applied', id: SNEAK, condition: 'invisible', source: 'a potion' },
  ];

  const cast = (bonus: number): GameState => {
    const out = must(
      resolveSpell(
        fold('seed', SETUP),
        DRUID,
        {
          spellId: 'faerie-fire',
          targets: [],
          // The near corner of the Cube on the druid's own square, pointed
          // north up the line the sneak stands on fifteen feet away.
          at: { x: 100, y: 100, z: 0 },
          towards: { x: 100, y: 200, z: 0 },
          slotLevel: 1,
        },
        supply('faerie', bonus),
      ),
    );
    return fold('seed', [...SETUP, ...out.events]);
  };

  /** What the two readers that hand Invisible its benefits say, in one list. */
  const invisibility = (state: GameState): readonly string[] =>
    [
      ...attackerConditionModes(effectiveConditions(state, SNEAK), {}),
      ...targetConditionModes(effectiveConditions(state, SNEAK), {}),
    ]
      .filter((mode) => mode.source === 'Invisible')
      .map((mode) => `${mode.mode} on ${mode.source}`);

  it('takes the benefit of the Invisible condition away on a failed save', () => {
    expect(invisibility(cast(FAILS))).toEqual([]);
  });

  it('leaves the condition itself standing, and imposes none of its own', () => {
    const state = cast(FAILS);

    expect(effectiveConditions(state, SNEAK).conditions).toEqual(['invisible']);
  });

  it('leaves a creature that makes its save benefiting from it', () => {
    expect(invisibility(cast(SAVES))).toEqual([
      'advantage on Invisible',
      'disadvantage on Invisible',
    ]);
  });
});
