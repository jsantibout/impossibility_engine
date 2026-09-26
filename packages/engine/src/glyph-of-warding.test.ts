import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, isErr, type CharacterId, type Result } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { declaredCasting } from './spellcasting.js';
import {
  advanceTime,
  pendingCastingsOf,
  resolveDeclaredCast,
  resolveSpell,
  triggerGlyph,
} from './commands.js';

/**
 * SRD Glyph of Warding's explosive rune.
 *
 * > "You inscribe a glyph that later unleashes a magical effect … When you
 * > inscribe the glyph, you set its trigger … Once a glyph is triggered, this
 * > spell ends. _Explosive Rune._ When triggered, the glyph erupts with
 * > magical energy in a 20-foot-radius Sphere centered on the glyph. Each
 * > creature in the area makes a Dexterity saving throw. A creature takes 5d8
 * > Acid, Cold, Fire, Lightning, or Thunder damage (your choice when you
 * > create the glyph) on a failed save or half as much damage on a successful
 * > one." _Using a Higher-Level Spell Slot._ "The damage of an explosive rune
 * > increases by 1d8 for each spell slot level above 3."
 *
 * The trigger is whatever the caster invented and the engine holds nothing it
 * could read it from, so it is a **DM's decision** — `triggerGlyph`, on the
 * DM's door alone — and everything after the decision is the engine's: the
 * Sphere measured from the glyph's pinned point, one Dexterity save per
 * creature standing in it, the dice at the slot the glyph was inscribed with,
 * the type the caster stated, and the casting ending because it fired.
 * `SpellDefinition.triggered` is the effect list the door runs, pinned onto
 * the record at the casting with its stated type substituted, so the fold and
 * the door open no catalogue.
 */

const id = (s: string): CharacterId => asCharacterId(s);
const WIZARD = id('wizard');
/** Ten feet from the glyph: inside the Sphere. */
const NEAR = id('near');
/** Forty feet from the glyph: outside it. */
const FAR = id('far');

const sheet = (): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 12, con: 12, int: 18, wis: 10, cha: 10 },
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
  maxHp: 60,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side,
});

const VAULT: readonly GameEvent[] = [
  added(WIZARD, 'party'),
  added(NEAR, 'thieves'),
  added(FAR, 'thieves'),
  {
    type: 'spellcasting-declared',
    id: WIZARD,
    spellcasting: declaredCasting({
      ability: 'int',
      classId: 'wizard',
      prepared: ['glyph-of-warding', 'mage-armor'],
    }),
  },
  ...[1, 3, 4].map(
    (level): GameEvent => ({
      type: 'resource-pool-declared',
      id: WIZARD,
      pool: { key: `spell-slot:${level}`, label: `level ${level}`, max: 2, recovers: 'long-rest' },
    }),
  ),
  { type: 'scene-set', extent: { width: 300, depth: 300, height: 40 } },
  { type: 'landmark-added', name: 'the door', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: WIZARD, placement: { from: { landmark: 'the door' }, feet: 0 } },
  { type: 'creature-placed', id: NEAR, placement: { from: { landmark: 'the door' }, feet: 10, bearing: 0 } },
  { type: 'creature-placed', id: FAR, placement: { from: { landmark: 'the door' }, feet: 40, bearing: 0 } },
];

/** The glyph is drawn on the threshold, five feet from the wizard: touch. */
const THRESHOLD = { x: 100, y: 105, z: 0 };

const supply = (seed: string, flat?: number) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
  ...(flat === undefined ? {} : { bonuses: [{ source: 'the test insists', flat }] }),
});

const DOOMED = -40;

const must = <T,>(result: Result<T>, what: string): T => unwrap(result, what);

/** An hour's inscription: declared, waited out, settled. */
const inscribed = (slotLevel = 3, damageType = 'fire') => {
  const declared = must(
    resolveSpell(
      fold('seed', VAULT),
      WIZARD,
      { spellId: 'glyph-of-warding', targets: [], at: THRESHOLD, slotLevel, damageType },
      supply('ink'),
    ),
    'declare',
  );
  let log: GameEvent[] = [...VAULT, ...declared.events];
  const castingId = pendingCastingsOf(fold('seed', log))[0]!.castingId;
  log = [...log, ...must(advanceTime(fold('seed', log), 3600, 'the hour'), 'hour')];
  log = [...log, ...must(resolveDeclaredCast(fold('seed', log), castingId, supply('settle')), 'settle').events];
  return { log, castingId, state: fold('seed', log) as GameState };
};

const hp = (state: GameState, who: CharacterId): number => state.creatures[who]!.vitals.hp;

describe('SRD Glyph of Warding’s explosive rune', () => {
  it('stands inscribed until dispelled, with the rune and its type pinned on the record', () => {
    const { state, castingId } = inscribed();
    const record = state.ongoing[castingId];
    expect(record?.spell).toBe('Glyph of Warding');
    expect(Object.values(state.timers).some((one) => one.target.kind === 'casting')).toBe(false);
    expect(record?.triggered?.effects[0]).toMatchObject({ kind: 'save-damage', damageType: 'fire' });
    // Nobody standing on the threshold was hurt by the inscribing.
    expect(hp(state, NEAR)).toBe(60);
  });

  it('erupts on whoever stands in the Sphere when the DM says the trigger occurred, and ends', () => {
    const { log, castingId, state } = inscribed();
    const fired = must(triggerGlyph(state, { castingId }, supply('boom', DOOMED)), 'trigger');
    const after = fold('seed', [...log, ...fired.events]);

    expect(hp(after, NEAR)).toBeLessThan(60);
    expect(hp(after, FAR)).toBe(60);
    expect(fired.outcomes.find((one) => one.target === NEAR)?.affected).toBe(true);
    expect(fired.outcomes.some((one) => one.target === FAR)).toBe(false);
    expect(after.ongoing[castingId]).toBeUndefined();
    expect(
      fired.events.some(
        (event) => event.type === 'spell-ended' && event.castingId === castingId && event.reason === 'triggered',
      ),
    ).toBe(true);
  });

  it('carries the slot it was inscribed with into the rune', () => {
    const { state, castingId } = inscribed(4);
    expect(state.ongoing[castingId]?.level).toBe(4);
    expect(state.ongoing[castingId]?.triggered?.effects[0]).toMatchObject({
      damage: { dice: '5d8', perSlotLevelAbove: '1d8' },
    });
  });

  it('is a decision taken once: the same command id fires it once', () => {
    const { log, castingId, state } = inscribed();
    const first = must(triggerGlyph(state, { castingId, commandId: 'the-thief-steps-on-it' }, supply('boom', DOOMED)), 'first');
    const again = must(
      triggerGlyph(fold('seed', [...log, ...first.events]), { castingId, commandId: 'the-thief-steps-on-it' }, supply('boom', DOOMED)),
      'again',
    );
    expect(again.events).toEqual([]);
  });

  it('refuses a casting that has already fired, and one that prints no trigger', () => {
    const { log, castingId, state } = inscribed();
    const fired = must(triggerGlyph(state, { castingId }, supply('boom', DOOMED)), 'trigger');
    const spent = triggerGlyph(fold('seed', [...log, ...fired.events]), { castingId }, supply('twice'));
    expect(isErr(spent) && spent.code).toBe('not_ongoing');

    const armoured = must(
      resolveSpell(state, WIZARD, { spellId: 'mage-armor', targets: [WIZARD] }, supply('armour')),
      'mage armor',
    );
    const other = triggerGlyph(
      fold('seed', [...log, ...armoured.events]),
      { castingId: armoured.castingId! },
      supply('nothing'),
    );
    expect(isErr(other) && other.code).toBe('no_trigger');
  });
});
