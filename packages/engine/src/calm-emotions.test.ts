import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, isErr, type CharacterId, type Result } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { hasCondition } from './conditions.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent } from './events.js';
import { declaredCasting } from './spellcasting.js';
import { conditionImmunitiesOf, effectiveConditions } from './standing.js';
import { endConcentration, resolveSpell } from './commands.js';

/**
 * SRD Calm Emotions, whole.
 *
 * > "Each Humanoid in a 20-foot-radius Sphere centered on a point you choose
 * > within range must succeed on a Charisma saving throw or be affected by one
 * > of the following effects (**choose for each creature**): The creature has
 * > Immunity to the Charmed and Frightened conditions until the spell ends.
 * > If the creature was already Charmed or Frightened, those conditions are
 * > suppressed for the duration. / The creature becomes Indifferent about
 * > creatures of your choice that it's Hostile toward."
 *
 * Two things this spell waited on. **A choice made creature by creature**:
 * `SpellDefinition.optionPerTarget` says the branch is chosen per target and
 * `CastSpellRequest.optionByTarget` is where the caster says which, one word
 * per creature the Sphere caught, refused where a creature is unnamed or a
 * name is uncaught. And **a condition a spell suppresses**: the `immunity`
 * rider grants the Immunity a casting already could, with `suppressesHeld`
 * saying the Charmed or Frightened the creature already has goes quiet rather
 * than being ended — `suppressedConditions` reads a casting's grant exactly as
 * it reads Aura of Courage's, and the condition comes back when the spell ends
 * without anybody having to remember to put it back.
 */

const id = (s: string): CharacterId => asCharacterId(s);
const BARD = id('bard');
/** Chosen for the Immunity; already Frightened by something else. */
const SHAKEN = id('shaken');
/** Chosen for indifference; the sentence is the table's. */
const HOSTILE = id('hostile');
/** Outside the Sphere. */
const FAR = id('far');

const sheet = (): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 12, con: 12, int: 10, wis: 12, cha: 18 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'cha',
});

const added = (who: CharacterId, side: string): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 40,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side,
});

const SQUARE: readonly GameEvent[] = [
  added(BARD, 'party'),
  added(SHAKEN, 'goblins'),
  added(HOSTILE, 'goblins'),
  added(FAR, 'goblins'),
  {
    type: 'spellcasting-declared',
    id: BARD,
    spellcasting: declaredCasting({ ability: 'cha', classId: 'bard', prepared: ['calm-emotions'] }),
  },
  {
    type: 'resource-pool-declared',
    id: BARD,
    pool: { key: 'spell-slot:2', label: 'level 2', max: 3, recovers: 'long-rest' },
  },
  { type: 'scene-set', extent: { width: 300, depth: 300, height: 40 } },
  { type: 'landmark-added', name: 'the well', at: { x: 100, y: 100, z: 0 } },
  { type: 'landmark-added', name: 'the square', at: { x: 100, y: 140, z: 0 } },
  { type: 'creature-placed', id: BARD, placement: { from: { landmark: 'the well' }, feet: 0 } },
  { type: 'creature-placed', id: SHAKEN, placement: { from: { landmark: 'the square' }, feet: 0 } },
  { type: 'creature-placed', id: HOSTILE, placement: { from: { creature: SHAKEN }, feet: 10, bearing: 90 } },
  { type: 'creature-placed', id: FAR, placement: { from: { creature: SHAKEN }, feet: 60, bearing: 0 } },
  // Frightened by something that is not this casting, before the bard speaks.
  { type: 'condition-applied', id: SHAKEN, condition: 'frightened', source: 'a dragon' },
];

const supply = (seed: string, flat?: number) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
  ...(flat === undefined ? {} : { bonuses: [{ source: 'the test insists', flat }] }),
});

const DOOMED = -40;
const SPARED = 40;
const AT = { x: 100, y: 140, z: 0 };

const must = <T,>(result: Result<T>, what: string): T => unwrap(result, what);

const calmed = (
  optionByTarget: Readonly<Record<string, string>>,
  flat = DOOMED,
  over: Record<string, unknown> = {},
) =>
  resolveSpell(
    fold('seed', SQUARE),
    BARD,
    { spellId: 'calm-emotions', targets: [], at: AT, optionByTarget, ...over },
    supply('calm', flat),
  );

const CHOSEN = { [SHAKEN]: 'immunity', [HOSTILE]: 'indifference' };

const settled = (flat = DOOMED) => {
  const out = must(calmed(CHOSEN, flat), 'calm emotions');
  const log = [...SQUARE, ...out.events];
  return { out, log, state: fold('seed', log) };
};

describe('SRD Calm Emotions chooses per creature', () => {
  it('grants the chosen Immunity to one and hands the other its sentence', () => {
    const { out, state } = settled();
    expect(out.outcomes.find((one) => one.target === SHAKEN)?.affected).toBe(true);
    expect(out.outcomes.find((one) => one.target === HOSTILE)?.affected).toBe(true);
    expect(out.outcomes.some((one) => one.target === FAR)).toBe(false);

    expect(conditionImmunitiesOf(state, SHAKEN)).toEqual(['charmed', 'frightened']);
    expect(conditionImmunitiesOf(state, HOSTILE)).toEqual([]);
    expect(out.unverified.some((line) => line.includes('becomes Indifferent'))).toBe(true);
  });

  it('suppresses the Frightened already on the creature, and gives it back when the spell ends', () => {
    const { log, state } = settled();
    // Still on the record, and doing nothing.
    expect(hasCondition(state.creatures[SHAKEN]!.conditions, 'frightened')).toBe(true);
    expect(effectiveConditions(state, SHAKEN).conditions).not.toContain('frightened');

    const after = fold('seed', [...log, ...must(endConcentration(state, BARD, 'voluntary'), 'let go')]);
    expect(effectiveConditions(after, SHAKEN).conditions).toContain('frightened');
    expect(conditionImmunitiesOf(after, SHAKEN)).toEqual([]);
  });

  it('grants nothing to a creature that makes its save', () => {
    const { out, state } = settled(SPARED);
    expect(out.outcomes.every((one) => one.affected === false)).toBe(true);
    expect(conditionImmunitiesOf(state, SHAKEN)).toEqual([]);
    expect(effectiveConditions(state, SHAKEN).conditions).toContain('frightened');
  });

  it('pins which creature got which word on the record', () => {
    const { state } = settled();
    const record = Object.values(state.ongoing).find((one) => one.spell === 'Calm Emotions');
    expect(record?.optionByTarget).toEqual(CHOSEN);
  });
});

describe('the words a per-creature choice is refused for', () => {
  const code = (result: Result<unknown>): string | null => (isErr(result) ? result.code : null);

  it('refuses one word for everybody', () => {
    expect(code(calmed(CHOSEN, DOOMED, { optionByTarget: undefined, option: 'immunity' }))).toBe(
      'option_per_target',
    );
  });

  it('asks for the map when none is given', () => {
    expect(code(calmed(CHOSEN, DOOMED, { optionByTarget: undefined }))).toBe(
      'option_by_target_required',
    );
  });

  it('refuses a creature the Sphere caught and nobody chose for', () => {
    expect(code(calmed({ [SHAKEN]: 'immunity' }))).toBe('option_required_for_target');
  });

  it('refuses a choice for a creature the Sphere did not catch', () => {
    expect(code(calmed({ ...CHOSEN, [FAR]: 'immunity' }))).toBe('option_for_uncaught_target');
  });

  /** A declaration takes no fresh request, and an area has caught nobody yet. */
  it('refuses to hold a casting whose word is per creature', () => {
    expect(code(calmed(CHOSEN, DOOMED, { hold: true }))).toBe(
      'per_target_option_on_a_declaration',
    );
  });

  it('refuses a branch the spell does not print', () => {
    expect(code(calmed({ ...CHOSEN, [HOSTILE]: 'serenity' }))).toBe('unknown_option');
  });

  it('refuses the map on a spell that chooses once for all', () => {
    const out = resolveSpell(
      fold('seed', [
        ...SQUARE.filter((e) => e.type !== 'spellcasting-declared'),
        {
          type: 'spellcasting-declared',
          id: BARD,
          spellcasting: declaredCasting({ ability: 'cha', classId: 'bard', prepared: ['enlarge-reduce'] }),
        },
      ]),
      BARD,
      {
        spellId: 'enlarge-reduce',
        targets: [SHAKEN],
        option: 'enlarge',
        optionByTarget: { [SHAKEN]: 'enlarge' },
      },
      supply('grow'),
    );
    expect(code(out)).toBe('no_per_target_option_clause');
  });
});
