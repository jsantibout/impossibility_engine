import { describe, expect, it } from 'vitest';
import { SPELL_DEFINITIONS, SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, isErr, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { declaredCasting } from './spellcasting.js';
import { checkSpellDefinitionValue } from './spell-schema.js';
import { dmDecisionsIn } from './spell-definitions.js';
import { activateSpell, resolveSpell } from './commands.js';

/**
 * A later action that buys only knowledge.
 *
 * > SRD Detect Thoughts: "You activate one of the effects below. Until the
 * > spell ends, you can activate either effect as a Magic action on your
 * > later turns."
 *
 * Sense Thoughts and Read Thoughts resolve nothing the engine holds — which
 * thinking creatures are near, what is on a mind — and both are handed to the
 * table. What is the engine's is the price: the Magic action. So the
 * activation names its errands, and taking one spends the action, rolls
 * nothing, aims at nobody and reports the errand for the table to answer.
 */

const id = (s: string): CharacterId => asCharacterId(s);
const WIZARD = id('wizard');
const GOBLIN = id('goblin');

const sheet = (): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 10, con: 12, int: 18, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
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

const ROOM: readonly GameEvent[] = [
  added(WIZARD, 'party'),
  added(GOBLIN, 'goblins'),
  {
    type: 'spellcasting-declared',
    id: WIZARD,
    spellcasting: declaredCasting({ ability: 'int', classId: 'wizard', prepared: ['detect-thoughts'] }),
  },
  {
    type: 'resource-pool-declared',
    id: WIZARD,
    pool: { key: 'spell-slot:2', label: 'level 2', max: 3, recovers: 'long-rest' },
  },
  { type: 'scene-set', extent: { width: 200, depth: 200, height: 30 } },
  { type: 'landmark-added', name: 'the study', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: WIZARD, placement: { from: { landmark: 'the study' }, feet: 0 } },
  { type: 'creature-placed', id: GOBLIN, placement: { from: { creature: WIZARD }, feet: 15, bearing: 90 } },
  { type: 'sight-declared', from: WIZARD, to: GOBLIN, seen: true },
  {
    type: 'combat-started',
    combatants: [
      { id: WIZARD, initiative: 20, speed: 30 },
      { id: GOBLIN, initiative: 10, speed: 30 },
    ],
  },
];

const supply = (seed = 'think') => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

const state = (log: readonly GameEvent[]): GameState => fold('seed', log);

/** Cast on the wizard's first turn; the second turn is where a later action is taken. */
const laterTurn = () => {
  const out = unwrap(
    resolveSpell(state(ROOM), WIZARD, { spellId: 'detect-thoughts', targets: [], slotLevel: 2 }, supply()),
    'Detect Thoughts',
  );
  const log: readonly GameEvent[] = [
    ...ROOM,
    ...out.events,
    { type: 'turn-advanced' },
    { type: 'turn-advanced' },
  ];
  return { log, castingId: out.castingId! };
};

describe('the definition names its errands', () => {
  const definition = () => SPELL_DEFINITIONS.find((one) => one.id === 'detect-thoughts')!;

  it('prints Sense Thoughts and Read Thoughts, and owes nothing now', () => {
    expect(definition().activation?.errands).toEqual(['Sense Thoughts', 'Read Thoughts']);
    expect(definition().unmodelled ?? []).toEqual([]);
    expect(checkSpellDefinitionValue(definition())).toEqual([]);
  });

  it('refuses an errand list that is empty, repeats a name, or names nothing', () => {
    const codes = (errands: unknown): readonly string[] =>
      checkSpellDefinitionValue({
        ...definition(),
        activation: { ...definition().activation!, errands },
      }).map((one) => one.code);
    expect(codes([])).toContain('bad_errands');
    expect(codes(['Sense Thoughts', 'Sense Thoughts'])).toContain('bad_errands');
    expect(codes(['  '])).toContain('bad_errands');
    expect(codes('Sense Thoughts')).toContain('bad_errands');
  });
});

describe('an errand through Detect Thoughts', () => {
  it('spends the Magic action, rolls nothing, aims at nobody and hands the errand over', () => {
    const { log, castingId } = laterTurn();
    const out = unwrap(
      activateSpell(state(log), WIZARD, { castingId, targets: [], errand: 'Sense Thoughts' }, supply()),
      'Sense Thoughts',
    );
    expect(out.events.map((event) => event.type)).toEqual(['action-spent', 'spell-activated']);
    expect(out.outcomes).toEqual([]);
    expect(dmDecisionsIn(out.unverified)).toEqual(['Sense Thoughts']);

    const after = state([...log, ...out.events]);
    // Still running, and nobody singled out: the errand probed no mind.
    expect(after.ongoing[castingId]).toBeDefined();
    expect(after.ongoing[castingId]!.singledOut).toBeUndefined();

    // The Action is gone: a second errand this turn is refused.
    const again = activateSpell(after, WIZARD, { castingId, targets: [], errand: 'Read Thoughts' }, supply());
    expect(isErr(again)).toBe(true);
  });

  it('leaves the probe rolling its save', () => {
    const { log, castingId } = laterTurn();
    const out = unwrap(
      activateSpell(state(log), WIZARD, { castingId, targets: [GOBLIN] }, supply()),
      'the probe',
    );
    expect(out.outcomes[0]?.save).toBeDefined();
    expect(out.events.some((event) => event.type === 'roll-recorded')).toBe(true);
  });

  it('refuses an errand the spell does not print, and a target beside one', () => {
    const { log, castingId } = laterTurn();
    const probe = activateSpell(state(log), WIZARD, { castingId, targets: [], errand: 'Probe' }, supply());
    expect(isErr(probe) && probe.code).toBe('unknown_errand');

    const aimed = activateSpell(
      state(log),
      WIZARD,
      { castingId, targets: [GOBLIN], errand: 'Read Thoughts' },
      supply(),
    );
    expect(isErr(aimed) && aimed.code).toBe('errand_takes_nothing');
  });
});
