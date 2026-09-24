import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import {
  asCharacterId,
  isErr,
  expect as unwrap,
  type CharacterId,
  type Result,
} from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { bonusesFor, type ActiveBonus } from './bonuses.js';
import { createRng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { declaredCasting } from './spellcasting.js';
import { resolveSpell } from './commands.js';
import { checkBonuses } from './commands/rolls.js';
import { rollModesFor } from './standing.js';
import { checkSpellDefinition } from './spell-schema.js';
import type { SpellDefinition } from './spell-definitions.js';

/**
 * A choice the caster makes at the casting, and a bonus narrowed to a skill.
 *
 * Two shapes, and one spell needs both. SRD Guidance: "You touch a willing
 * creature and **choose a skill**. Until the spell ends, the creature adds 1d4
 * to any ability check **using the chosen skill**." The first half is a value
 * the definition cannot hold — a book prints the list and the caster picks —
 * and the second is a narrowing `ActiveBonus` had no axis for, so the bonus
 * would have landed on every ability check the target ever made.
 *
 * | SRD sentence | What is chosen | Where the choice lands |
 * |---|---|---|
 * | Blindness/Deafness, "the Blinded or Deafened condition (your choice)" | a condition | the save's condition |
 * | Lesser Restoration, "end **one** condition on it" | a condition | the removal's list |
 * | Enhance Ability, "choose Strength, Dexterity, …" | an ability | the granted mode's selector |
 * | Guidance, "choose a skill" | a skill | the granted bonus's narrowing |
 *
 * The mechanism is `damageTypeStated`'s, generalised the way that field's own
 * docstring said a second user would generalise it: the definition prints the
 * list, the casting states one value, anything off the list is refused, and
 * the answer is **pinned** — into the events the resolution emits and onto the
 * ongoing record, because the fold opens no catalogue.
 */

const id = (s: string) => asCharacterId(s);
const CLERIC = id('cleric');
const FRIEND = id('friend');
const RIVAL = id('rival');

const PREPARED = [
  'blindness-deafness',
  'lesser-restoration',
  'enhance-ability',
  'guidance',
  'bless',
];

const sheet = (): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 18, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'wis',
  weaponProficiencies: ['simple'],
});

const added = (who: CharacterId): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 200,
  diesAtZero: false,
  creatureType: 'Humanoid',
});

const LOG: readonly GameEvent[] = [
  added(CLERIC),
  added(FRIEND),
  added(RIVAL),
  {
    type: 'spellcasting-declared',
    id: CLERIC,
    spellcasting: declaredCasting({ ability: 'wis', prepared: PREPARED }),
  },
  ...[1, 2, 3].map(
    (level): GameEvent => ({
      type: 'resource-pool-declared',
      id: CLERIC,
      pool: { key: `spell-slot:${level}`, label: `level ${level}`, max: 8, recovers: 'long-rest' },
    }),
  ),
  { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
  { type: 'landmark-added', name: 'the chapel', at: { x: 50, y: 50, z: 0 } },
  { type: 'creature-placed', id: CLERIC, placement: { from: { landmark: 'the chapel' }, feet: 0 } },
  { type: 'creature-placed', id: FRIEND, placement: { from: { creature: CLERIC }, feet: 5, bearing: 0 } },
  { type: 'creature-placed', id: RIVAL, placement: { from: { creature: CLERIC }, feet: 10, bearing: 90 } },
  { type: 'sight-declared', from: CLERIC, to: FRIEND, seen: true },
  { type: 'sight-declared', from: CLERIC, to: RIVAL, seen: true },
];

const supply = (state: GameState, seed = 'choice') => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: createRng(seed),
  content: SRD_CONTENT,
});

type Request = Parameters<typeof resolveSpell>[2];

const attempt = (
  extra: readonly GameEvent[],
  request: Request,
  seed = 'choice',
): Result<{ readonly events: readonly GameEvent[] }> => {
  const log = [...LOG, ...extra];
  const state = fold('seed', log);
  return resolveSpell(state, CLERIC, request, supply(state, seed)) as Result<{
    readonly events: readonly GameEvent[];
  }>;
};

const cast = (extra: readonly GameEvent[], request: Request, seed = 'choice') => {
  const log = [...LOG, ...extra];
  const result = unwrap(attempt(extra, request, seed), 'cast');
  const after = [...log, ...result.events];
  return { events: result.events, state: fold('seed', after) };
};

const request = (over: Record<string, unknown>): Request =>
  ({ slotLevel: 2, ...over }) as Request;

// — a choice made at the casting —————————————————————————————————————————

describe('a spell that prints a choice is refused until the casting makes it', () => {
  /**
   * SRD Blindness/Deafness: "it has the Blinded or Deafened condition (**your
   * choice**)". Picking Blinded because it is printed first is the engine
   * answering a question the book asked the caster.
   */
  it('refuses a casting that says nothing', () => {
    const out = attempt([], request({ spellId: 'blindness-deafness', targets: [RIVAL] }));
    expect(isErr(out) && out.code).toBe('choice_required');
  });

  it('refuses a value the spell does not print', () => {
    const out = attempt(
      [],
      request({ spellId: 'blindness-deafness', targets: [RIVAL], choice: 'paralyzed' }),
    );
    expect(isErr(out) && out.code).toBe('unknown_choice');
  });

  it('refuses a choice on a spell that prints none', () => {
    const out = attempt(
      [],
      request({ spellId: 'bless', targets: [FRIEND], choice: 'deafened' }),
    );
    expect(isErr(out) && out.code).toBe('no_choice_clause');
  });
});

describe('the chosen value is what lands, and it is pinned', () => {
  /**
   * The point of the whole shape: the definition carries Blinded so it is
   * well-formed and castable, and a casting that chose Deafened deafens.
   */
  it('deafens when the casting chose Deafened', () => {
    const { events } = cast(
      [],
      request({ spellId: 'blindness-deafness', targets: [RIVAL], choice: 'deafened' }),
      'fails-the-save',
    );
    const applied = events.filter((e) => e.type === 'condition-applied');
    expect(applied.map((e) => (e as { condition: string }).condition)).toEqual(['deafened']);
  });

  it('blinds when the casting chose Blinded', () => {
    const { events } = cast(
      [],
      request({ spellId: 'blindness-deafness', targets: [RIVAL], choice: 'blinded' }),
      'fails-the-save',
    );
    const applied = events.filter((e) => e.type === 'condition-applied');
    expect(applied.map((e) => (e as { condition: string }).condition)).toEqual(['blinded']);
  });

  /**
   * Pinned onto the record for the reason every other number on a casting is
   * pinned: the fold opens no catalogue, and a spell already cast does not
   * change when the book does.
   */
  it('pins the choice onto the ongoing record', () => {
    const { state } = cast(
      [],
      request({ spellId: 'blindness-deafness', targets: [RIVAL], choice: 'deafened' }),
      'fails-the-save',
    );
    const running = Object.values(state.ongoing).find((one) => one.spellId === 'blindness-deafness');
    // The pair, not the value: which field the answer replaces is a fact about
    // the definition, and a record that kept only the value would ask the
    // catalogue for the other half every time a later trigger fired.
    expect(running?.choice).toEqual({ of: 'condition', value: 'deafened' });
  });

  /**
   * SRD Lesser Restoration: "end **one** condition on it: Blinded, Deafened,
   * Paralyzed, or Poisoned." The engine ended all four it found, which is a
   * spell doing more than the book says.
   */
  it('ends only the condition Lesser Restoration chose', () => {
    const ailing: readonly GameEvent[] = [
      { type: 'condition-applied', id: FRIEND, condition: 'poisoned', source: 'bad meat' },
      { type: 'condition-applied', id: FRIEND, condition: 'blinded', source: 'the smoke' },
    ];
    const { state } = cast(
      ailing,
      request({ spellId: 'lesser-restoration', targets: [FRIEND], choice: 'poisoned' }),
    );
    expect(state.creatures[FRIEND]!.conditions.conditions).toEqual(['blinded']);
  });
});

describe('an ability chosen at the casting reaches the mode it narrows', () => {
  /**
   * SRD Enhance Ability: "choose Strength, Dexterity, Intelligence, Wisdom, or
   * Charisma. For the duration, the target has Advantage on ability checks
   * using the chosen ability."
   */
  it('grants Advantage on the chosen ability and on no other', () => {
    const { state } = cast(
      [],
      request({ spellId: 'enhance-ability', targets: [FRIEND], choice: 'str' }),
    );
    const strength = rollModesFor(state, {
      family: 'ability-check',
      roller: FRIEND,
      ability: 'str',
    }).modes;
    const wisdom = rollModesFor(state, {
      family: 'ability-check',
      roller: FRIEND,
      ability: 'wis',
    }).modes;
    expect(strength.map((m) => (typeof m === 'string' ? m : m.mode))).toContain('advantage');
    expect(wisdom.map((m) => (typeof m === 'string' ? m : m.mode))).not.toContain('advantage');
  });

  /** It is still a save, so the ability check and the saving throw stay apart. */
  it('leaves a saving throw of the same ability alone', () => {
    const { state } = cast(
      [],
      request({ spellId: 'enhance-ability', targets: [FRIEND], choice: 'str' }),
    );
    const saving = rollModesFor(state, {
      family: 'saving-throw',
      roller: FRIEND,
      ability: 'str',
    }).modes;
    expect(saving.map((m) => (typeof m === 'string' ? m : m.mode))).not.toContain('advantage');
  });
});

// — a bonus narrowed to a skill ——————————————————————————————————————————

describe('bonusesFor narrows a stored bonus the way a selector narrows a mode', () => {
  const guidance: ActiveBonus = {
    source: 'Guidance#cast:1',
    bonus: { source: 'Guidance', dice: '1d4' },
    applies: ['ability-check'],
    direction: 'add',
    only: { skill: 'religion' },
  };
  const bless: ActiveBonus = {
    source: 'Bless#cast:2',
    bonus: { source: 'Bless', dice: '1d4' },
    applies: ['attack', 'save'],
    direction: 'add',
  };

  it('answers for the skill the bonus names', () => {
    expect(bonusesFor([guidance], 'ability-check', { skill: 'religion' })).toHaveLength(1);
  });

  it('withholds it from a check using another skill', () => {
    expect(bonusesFor([guidance], 'ability-check', { skill: 'stealth' })).toHaveLength(0);
  });

  /**
   * The conservative direction `checkBonuses` already takes for a feature's
   * narrowed bonus: a caller with no skill to name — Initiative, a bare
   * ability check — gets only the bonuses that name none either.
   */
  it('withholds it from a check that names no skill at all', () => {
    expect(bonusesFor([guidance], 'ability-check')).toHaveLength(0);
  });

  it('leaves a bonus that names nothing reaching everything it applies to', () => {
    expect(bonusesFor([bless], 'save', { ability: 'wis' })).toHaveLength(1);
    expect(bonusesFor([bless], 'save')).toHaveLength(1);
  });

  it('narrows a save by the ability it is made with', () => {
    const slowed: ActiveBonus = {
      source: 'a penalty#cast:3',
      bonus: { source: 'a penalty', flat: 2 },
      applies: ['save'],
      direction: 'subtract',
      only: { ability: 'dex' },
    };
    expect(bonusesFor([slowed], 'save', { ability: 'dex' })).toHaveLength(1);
    expect(bonusesFor([slowed], 'save', { ability: 'wis' })).toHaveLength(0);
  });
});

describe('Guidance adds its die to the chosen skill and to nothing else', () => {
  const withGuidance = (skill: string) =>
    cast([], request({ spellId: 'guidance', targets: [FRIEND], willing: [FRIEND], choice: skill, slotLevel: undefined }));

  it('reaches a check using the chosen skill', () => {
    const { state } = withGuidance('religion');
    const bonuses = checkBonuses(state, FRIEND, undefined, 'religion');
    expect(bonuses.map((b) => b.source)).toContain('Guidance');
  });

  it('does not reach a check using another skill', () => {
    const { state } = withGuidance('religion');
    const bonuses = checkBonuses(state, FRIEND, undefined, 'stealth');
    expect(bonuses.map((b) => b.source)).not.toContain('Guidance');
  });
});

// — what the validator refuses ————————————————————————————————————————————

describe('the validator refuses a choice nothing could read', () => {
  const base: SpellDefinition = {
    id: 'homebrew-choice',
    name: 'Homebrew Choice',
    level: 1,
    school: 'transmutation',
    castingTime: 'action',
    concentration: false,
    range: { kind: 'touch' },
    targets: { count: 1, self: true },
    effects: [{ kind: 'end-condition', conditions: ['blinded'] }],
  };
  const codes = (definition: SpellDefinition) =>
    checkSpellDefinition(definition).map((problem) => problem.code);

  it('refuses a list of one', () => {
    expect(
      codes({ ...base, choiceStated: { of: 'condition', options: ['blinded'] } }),
    ).toContain('stated_choice_needs_choice');
  });

  it('refuses a value that is not of the kind the choice names', () => {
    expect(
      codes({ ...base, choiceStated: { of: 'condition', options: ['blinded', 'sleepy'] } }),
    ).toContain('unknown_condition');
  });

  it('refuses a choice that substitutes into nothing', () => {
    expect(
      codes({
        ...base,
        effects: [{ kind: 'heal', healing: { dice: '1d8' }, addSpellcastingModifier: false }],
        choiceStated: { of: 'condition', options: ['blinded', 'deafened'] },
      }),
    ).toContain('stated_choice_reaches_nothing');
  });

  it('accepts a condition choice over a removal', () => {
    expect(
      codes({ ...base, choiceStated: { of: 'condition', options: ['blinded', 'deafened'] } }),
    ).toEqual([]);
  });

  /**
   * An ability and a skill are a pair and must agree, and a substitution
   * replaces one of the two. A definition that prints both and offers one to
   * the caster validates and then contradicts itself at the table — a
   * selector matching nothing for ever, silently.
   */
  it('refuses a choice printed against a pinned sibling', () => {
    const insight: SpellDefinition = {
      ...base,
      effects: [
        {
          kind: 'roll-mode',
          modifier: {
            mode: 'advantage',
            selector: { roll: 'ability-check', relation: 'roller', ability: 'wis', skill: 'insight' },
          },
        },
      ],
      durationSeconds: 60,
      choiceStated: { of: 'skill', options: ['insight', 'stealth'] },
    };
    expect(codes(insight)).toContain('stated_choice_collides');
  });

  it('accepts the same choice once the sibling is dropped', () => {
    const free: SpellDefinition = {
      ...base,
      effects: [
        {
          kind: 'roll-mode',
          modifier: {
            mode: 'advantage',
            selector: { roll: 'ability-check', relation: 'roller', skill: 'insight' },
          },
        },
      ],
      durationSeconds: 60,
      choiceStated: { of: 'skill', options: ['insight', 'stealth'] },
    };
    expect(codes(free)).toEqual([]);
  });
});

describe('the validator keeps a bonus narrowing where it can be read', () => {
  const buff = (only: unknown, applies: readonly string[]): SpellDefinition =>
    ({
      id: 'homebrew-narrowed',
      name: 'Homebrew Narrowed',
      level: 1,
      school: 'divination',
      castingTime: 'action',
      concentration: false,
      range: { kind: 'touch' },
      targets: { count: 1, self: true },
      effects: [
        {
          kind: 'buff',
          bonus: { source: 'Homebrew Narrowed', dice: '1d4' },
          applies,
          direction: 'add',
          only,
        },
      ],
      durationSeconds: 60,
    }) as unknown as SpellDefinition;

  const codes = (definition: SpellDefinition) =>
    checkSpellDefinition(definition).map((problem) => problem.code);

  it('accepts a skill on an ability check', () => {
    expect(codes(buff({ skill: 'religion' }, ['ability-check']))).toEqual([]);
  });

  it('refuses a skill on a saving throw, which uses none', () => {
    expect(codes(buff({ skill: 'religion' }, ['save']))).toContain('narrowing_unreadable');
  });

  /** SRD Slow: "a -2 penalty to ... Dexterity saving throws". */
  it('accepts an ability on a saving throw, which is told one', () => {
    expect(codes(buff({ ability: 'dex' }, ['save']))).toEqual([]);
  });

  /**
   * One readable pairing per filter. An ability check is made *with* an
   * ability and `checkBonuses` is not handed it, so the filter would withhold
   * the bonus from every check there is — the quiet direction of the same
   * failure the attack roll fails in the loud one.
   */
  it('refuses an ability on an ability check, whose gatherer is told no ability', () => {
    expect(codes(buff({ ability: 'str' }, ['ability-check']))).toContain('narrowing_unreadable');
  });

  it('refuses a narrowing on an attack roll, which gathers none', () => {
    expect(codes(buff({ ability: 'str' }, ['attack']))).toContain('narrowing_unreadable');
    expect(codes(buff({ skill: 'religion' }, ['attack']))).toContain('narrowing_unreadable');
  });

  it('refuses a skill and an ability that disagree', () => {
    expect(codes(buff({ ability: 'str', skill: 'religion' }, ['ability-check']))).toContain(
      'skill_ability_mismatch',
    );
  });

  it('refuses an empty narrowing', () => {
    expect(codes(buff({}, ['ability-check']))).toContain('narrowing_narrows_nothing');
  });
});
