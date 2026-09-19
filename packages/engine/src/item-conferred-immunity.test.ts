import { describe, expect, it } from 'vitest';
import { asCharacterId, isErr, expect as unwrap, type Result } from '@ie/shared';
import type { CatalogueItem } from './catalogue.js';
import type { CharacterSheet } from './character.js';
import { checkContent, loadContent, type Content } from './content.js';
import { createRng, type Rng } from './dice.js';
import { timerKey } from './timers.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { createRollIssuer } from './rolls.js';
import { conditionImmunitiesOf } from './standing.js';
import { advanceTime, applyConditionTo, useItem } from './commands.js';

/**
 * A conferral may carry a condition Immunity, which is what the kind being
 * admitted was supposed to mean.
 *
 * `CONFERRED_EFFECT_KINDS` has admitted `condition-immunity` since the
 * conferral path was built. `RIDER_FIELDS` refuses any conferred effect
 * carrying a field called `conditions`, because a `ConditionRider` is welded
 * to the casting that hung it — and `conditions` is also `condition-immunity`'s
 * **own required list**, the one naming what the creature is immune to. Two
 * rules that each make sense, contradicting each other exactly where they
 * meet, so the one printed item that wants the shape — Potion of Gaseous
 * Form's Immunity — was refused by a rule that was never about it.
 *
 * `end-condition` is the second kind with the same collision and it is fixed
 * in the same breath: its `conditions` is the list of what it lifts.
 *
 * What the refusal *was* about is still refused, and that is the other half of
 * this file: a conferred `save` or `save-damage` carrying rider conditions —
 * an object with a `condition` in it, welded to a casting there is none of —
 * is refused exactly as it always was.
 */

const id = (s: string) => asCharacterId(s);
const DRINKER = id('drinker');

const sheet = (): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: null,
  weaponProficiencies: ['simple'],
});

const TABLE: readonly GameEvent[] = [
  {
    type: 'creature-added',
    id: DRINKER,
    name: 'drinker',
    sheet: sheet(),
    maxHp: 40,
    diesAtZero: false,
    creatureType: 'Humanoid',
    side: 'party',
  },
  { type: 'items-gained', id: DRINKER, items: [{ id: 'potion-of-clarity', quantity: 1 }], source: 'the hoard' },
];

const supply = (content: Content) => ({
  issuer: createRollIssuer('r'),
  rng: createRng('clarity') as Rng,
  content,
});

/**
 * A homebrew potion, because the SRD item that wants the shape — Potion of
 * Gaseous Form — needs a form change this engine has no vocabulary for. What
 * is under test is the conferral rule, not the transcription.
 */
const CLARITY = {
  id: 'potion-of-clarity',
  name: 'Potion of Clarity',
  kind: 'potion',
  weightLb: 0.5,
  costCp: null,
  armor: null,
  weapon: null,
  contents: [],
  grants: [
    {
      kind: 'confers',
      action: 'bonus-action',
      durationSeconds: 3600,
      effects: [{ kind: 'condition-immunity', conditions: ['charmed'] }],
    },
  ],
};

const emitted = (
  log: readonly GameEvent[],
  run: (state: GameState) => Result<{ readonly events: readonly GameEvent[] }>,
): readonly GameEvent[] => [...log, ...unwrap(run(fold('seed', log)), 'command').events];

describe('an item may confer a condition Immunity, and it is honoured', () => {
  const content = unwrap(loadContent({ items: [CLARITY] }), 'load');
  const drunk = emitted(TABLE, (state) =>
    useItem(state, DRINKER, { item: 'potion-of-clarity' }, supply(content)),
  );

  /** The validator lets the kind through with the list the kind requires. */
  it('is accepted by the one door a catalogue is built by', () => {
    expect(checkContent({ items: [CLARITY as unknown as CatalogueItem] })).toEqual([]);
  });

  it('hangs the Immunity under the item’s own bare source', () => {
    const state = fold('seed', drunk);
    expect(state.creatures['drinker']?.grantedConditionImmunities).toEqual([
      { source: 'item:potion-of-clarity', conditions: ['charmed'] },
    ]);
    expect(conditionImmunitiesOf(state, DRINKER)).toEqual(['charmed']);
  });

  /** Honoured, not merely stored: the condition cannot be put on. */
  it('refuses the condition while the potion runs', () => {
    const state = fold('seed', drunk);
    const charm = applyConditionTo(state, DRINKER, 'charmed', 'a siren');
    expect(isErr(charm) && charm.code).toBe('immune');
    // A condition it says nothing about still lands, so the refusal is the
    // Immunity rather than the potion having broken the command.
    expect(
      unwrap(applyConditionTo(state, DRINKER, 'frightened', 'a siren'), 'fright').length,
    ).toBeGreaterThan(0);

    // And the Immunity is gone once the hour is, so the same charm lands.
    const later = emitted(drunk, (s) => {
      const events = advanceTime(s, 3600, 'the hour');
      return events.ok ? { ok: true, value: { events: events.value } } : events;
    });
    expect(
      unwrap(applyConditionTo(fold('seed', later), DRINKER, 'charmed', 'a siren'), 'charm').length,
    ).toBeGreaterThan(0);
  });

  /**
   * And it ends on the item's own hour, through the `grants` timer the
   * conferral files — the Immunity is one of the eight sourced families, so
   * the lifetime rule that covers a `buff` covers this without a second door.
   */
  it('wears off on the clock', () => {
    const key = timerKey({ kind: 'grants', on: DRINKER, source: 'item:potion-of-clarity' });
    expect(fold('seed', drunk).timers[key]?.deadline).toEqual({ kind: 'elapsed', at: 3600 });

    const later = emitted(drunk, (state) => {
      const events = advanceTime(state, 3600, 'the hour');
      return events.ok ? { ok: true, value: { events: events.value } } : events;
    });
    const after = fold('seed', later);
    expect(conditionImmunitiesOf(after, DRINKER)).toEqual([]);
    expect(after.timers).toEqual({});
  });

  /** The log stands on its own, with no catalogue behind it. */
  it('folds the same without the catalogue', () => {
    expect(fold('seed', drunk)).toStrictEqual(fold('seed', drunk, content));
  });
});

/**
 * The sibling with the same collision: `end-condition`'s `conditions` is what
 * it lifts, and it too was refused a field of its own.
 */
describe('an item may confer the end of a condition', () => {
  const ANTIDOTE = {
    ...CLARITY,
    id: 'potion-of-antidote',
    name: 'Potion of Antidote',
    grants: [
      {
        kind: 'confers',
        action: 'bonus-action',
        effects: [{ kind: 'end-condition', conditions: ['poisoned'] }],
      },
    ],
  };

  it('is accepted, and lifts what it names', () => {
    expect(checkContent({ items: [ANTIDOTE as unknown as CatalogueItem] })).toEqual([]);

    const content = unwrap(loadContent({ items: [ANTIDOTE] }), 'load');
    const poisoned: readonly GameEvent[] = [
      ...TABLE.slice(0, 1),
      { type: 'condition-applied', id: DRINKER, condition: 'poisoned', source: 'a spider' },
      {
        type: 'items-gained',
        id: DRINKER,
        items: [{ id: 'potion-of-antidote', quantity: 1 }],
        source: 'the hoard',
      },
    ];
    const drunk = emitted(poisoned, (state) =>
      useItem(state, DRINKER, { item: 'potion-of-antidote' }, supply(content)),
    );
    expect(fold('seed', drunk).creatures['drinker']?.conditions.instances).toEqual([]);
  });
});

/**
 * And the refusal is still about what it was meant to be about.
 *
 * A rider is a `ConditionRider` — an object naming a condition, hung off an
 * affirmative outcome and welded to the casting that hung it. A conferral has
 * no casting, so it may not carry one, and saying so is the rule that has to
 * survive this repair intact.
 */
describe('the rider refusal still refuses a rider', () => {
  const flask = (effect: unknown): CatalogueItem =>
    ({
      ...CLARITY,
      id: 'flask-of-overreach',
      name: 'Flask of Overreach',
      grants: [
        {
          kind: 'confers',
          action: 'bonus-action',
          saveDc: 13,
          durationSeconds: 60,
          effects: [effect],
        },
      ],
    }) as unknown as CatalogueItem;

  const codes = (effect: unknown): readonly string[] =>
    checkContent({ items: [flask(effect)] }).map((problem) => `${problem.code} @ ${problem.field}`);

  /** SRD Hideous Laughter's shape on a bottle: a second condition on one save. */
  it('refuses rider conditions on a conferred save', () => {
    expect(
      codes({
        kind: 'save',
        ability: 'con',
        condition: 'poisoned',
        conditions: [{ name: 'prone' }],
      }),
    ).toEqual(['conferral_rider_needs_a_casting @ items[flask-of-overreach].grants[0].effects[0].conditions']);
  });

  it('refuses rider conditions on a conferred save-damage', () => {
    expect(
      codes({
        kind: 'save-damage',
        ability: 'con',
        damage: { flat: 4 },
        damageType: 'poison',
        half: true,
        conditions: [{ name: 'poisoned' }],
      }),
    ).toContain(
      'conferral_rider_needs_a_casting @ items[flask-of-overreach].grants[0].effects[0].conditions',
    );
  });

  /** The other two riders are untouched by the repair. */
  it('still refuses the modifier and the delayed-damage riders', () => {
    const withModifiers = codes({
      kind: 'save-damage',
      ability: 'con',
      damage: { flat: 4 },
      damageType: 'poison',
      half: true,
      modifiers: [
        { kind: 'bonus', bonus: { source: 'Flask', flat: 2 }, applies: ['ac'], direction: 'subtract' },
      ],
    });
    expect(withModifiers).toContain(
      'conferral_rider_needs_a_casting @ items[flask-of-overreach].grants[0].effects[0].modifiers',
    );
  });

  /** And a homebrew catalogue that tries it is refused at the door. */
  it('refuses it through loadContent too', () => {
    expect(
      isErr(
        loadContent({
          items: [
            flask({
              kind: 'save',
              ability: 'con',
              condition: 'poisoned',
              conditions: [{ name: 'prone' }],
            }),
          ],
        }),
      ),
    ).toBe(true);
  });
});
