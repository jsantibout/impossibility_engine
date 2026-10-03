import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, isErr, type CharacterId, type Result } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { declaredCasting } from './spellcasting.js';
import { checkSpellDefinitionValue } from './spell-schema.js';
import {
  advanceTime,
  availableChecks,
  pendingCastingsOf,
  resolveDeclaredCast,
  resolveEffectCheck,
  resolveSpell,
  triggerGlyph,
} from './commands.js';

/**
 * The two sentences of SRD Glyph of Warding that stood filed as debts.
 *
 * > "The glyph is nearly imperceptible and requires a successful Wisdom
 * > (Perception) check against your spell save DC to notice."
 * > "You can refine the trigger so that only creatures of certain types
 * > activate it (for example, the glyph could be set to affect Aberrations)."
 *
 * **The check rides on a deadline the glyph has none of**, which is the whole
 * of why it was a debt: Spike Growth's sentence is the same check written on a
 * definition, and a casting's check hangs on the casting's timer. A casting
 * that lasts until dispelled has no deadline — so it is given the one deadline
 * that never arrives (`indefinite`), and the check rides on that. Anybody may
 * attempt it, because a casting with no victim is anybody's to see through.
 *
 * **The refinement is a stated list the trigger reads.** The caster names the
 * creature types at the inscription (`types`, optional where the book says
 * "you can"), the record pins them as the glyph's activators, and the DM's
 * trigger then has to say who set it off — the rune or the stored spell is let
 * go only by a creature of a named type, as spells and magical effects see it.
 */

const id = (s: string): CharacterId => asCharacterId(s);
const WIZARD = id('wizard');
const THIEF = id('thief');
const GHOUL = id('ghoul');

const sheet = (wis = 10): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 12, con: 12, int: 18, wis, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
});

const added = (who: CharacterId, side: string, creatureType: string, wis = 10): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(wis),
  maxHp: 60,
  diesAtZero: false,
  creatureType,
  side,
});

const VAULT: readonly GameEvent[] = [
  added(WIZARD, 'party', 'Humanoid'),
  added(THIEF, 'thieves', 'Humanoid', 30),
  added(GHOUL, 'thieves', 'Undead'),
  {
    type: 'spellcasting-declared',
    id: WIZARD,
    spellcasting: declaredCasting({ ability: 'int', classId: 'wizard', prepared: ['glyph-of-warding'] }),
  },
  ...[1, 3].map(
    (level): GameEvent => ({
      type: 'resource-pool-declared',
      id: WIZARD,
      pool: { key: `spell-slot:${level}`, label: `level ${level}`, max: 2, recovers: 'long-rest' },
    }),
  ),
  { type: 'scene-set', extent: { width: 300, depth: 300, height: 40 } },
  { type: 'landmark-added', name: 'the door', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: WIZARD, placement: { from: { landmark: 'the door' }, feet: 0 } },
  { type: 'creature-placed', id: THIEF, placement: { from: { landmark: 'the door' }, feet: 10, bearing: 0 } },
  { type: 'creature-placed', id: GHOUL, placement: { from: { landmark: 'the door' }, feet: 10, bearing: 180 } },
];

const THRESHOLD = { x: 100, y: 105, z: 0 };

const supply = (seed: string) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

const must = <T,>(result: Result<T>, what: string): T => unwrap(result, what);

/** An hour's inscription, refined to the types named or to none. */
const inscribed = (types?: readonly string[]) => {
  const declared = must(
    resolveSpell(
      fold('seed', VAULT),
      WIZARD,
      {
        spellId: 'glyph-of-warding',
        targets: [],
        at: THRESHOLD,
        slotLevel: 3,
        damageType: 'fire',
        ...(types === undefined ? {} : { types }),
      },
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

describe('the Wisdom (Perception) check to notice the glyph', () => {
  it('is offered by the inscribed glyph, on a deadline that never arrives', () => {
    const { state, castingId } = inscribed();
    const timer = Object.values(state.timers).find(
      (one) => one.target.kind === 'casting' && one.target.castingId === castingId,
    );
    expect(timer?.deadline).toEqual({ kind: 'indefinite' });
    const offered = availableChecks(state, THIEF);
    expect(offered).toHaveLength(1);
    // Against the caster's spell save DC: 8 + 3 + 4.
    expect(offered[0]).toMatchObject({ ability: 'wis', skill: 'perception', dc: 15 });
  });

  it('is rolled by whoever looks, and changes nothing the engine holds', () => {
    const { state, castingId } = inscribed();
    const key = availableChecks(state, THIEF)[0]!.effectKey;
    const out = must(resolveEffectCheck(state, THIEF, { effectKey: key }, supply('look')), 'look');
    // Wisdom 30 (+10) against 15: the thief notices it.
    expect(out.success).toBe(true);
    expect(fold('seed', [...inscribed().log, ...out.events]).ongoing[castingId]).toBeDefined();
  });

  it('goes with the glyph when the glyph fires', () => {
    const { log, castingId, state } = inscribed();
    const fired = must(triggerGlyph(state, { castingId }, supply('boom')), 'trigger');
    const after = fold('seed', [...log, ...fired.events]);
    expect(availableChecks(after, THIEF)).toEqual([]);
  });
});

describe('a glyph refined to creatures of certain types', () => {
  it('pins the types the caster named as the glyph’s activators', () => {
    const { state, castingId } = inscribed(['Undead']);
    expect(state.ongoing[castingId]?.activatedBy).toEqual(['Undead']);
  });

  it('is not refined at all when the caster names none, because the book says "you can"', () => {
    const { state, castingId } = inscribed();
    expect(state.ongoing[castingId]?.activatedBy).toBeUndefined();
  });

  it('asks who set it off, because the refinement reads the creature', () => {
    const { state, castingId } = inscribed(['Undead']);
    const out = triggerGlyph(state, { castingId }, supply('boom'));
    expect(isErr(out) && out.code).toBe('triggerer_required');
  });

  it('refuses a creature of another type, and erupts for one of the named types', () => {
    const { log, state, castingId } = inscribed(['Undead']);
    const wrong = triggerGlyph(state, { castingId, by: THIEF }, supply('boom'));
    expect(isErr(wrong) && wrong.code).toBe('type_does_not_activate');

    const right = must(triggerGlyph(state, { castingId, by: GHOUL }, supply('boom')), 'the ghoul');
    // The rune still catches whoever stands in the Sphere: the refinement says
    // who activates it, not who it hurts.
    expect(right.outcomes.map((one) => one.target).sort()).toEqual([GHOUL, THIEF, WIZARD].sort());
    expect(fold('seed', [...log, ...right.events]).ongoing[castingId]).toBeUndefined();
  });

  it('reads the type spells and magical effects see', () => {
    const { log, castingId } = inscribed(['Fiend']);
    const bare = fold('seed', log);
    const refused = triggerGlyph(bare, { castingId, by: THIEF }, supply('boom'));
    expect(isErr(refused) && refused.code).toBe('type_does_not_activate');

    // SRD Arcanist's Magic Aura's Mask: "Spells and other magical effects treat
    // the target as if it were a creature of the chosen type."
    const masked = fold('seed', [
      ...log,
      { type: 'creature-type-masked', id: THIEF, mask: { source: 'a mask', creatureType: 'Fiend' } },
    ]);
    const fired = must(triggerGlyph(masked, { castingId, by: THIEF }, supply('boom')), 'the masked thief');
    expect(fired.events.some((event) => event.type === 'spell-ended')).toBe(true);
  });

  it('refuses a type the book does not know', () => {
    const out = resolveSpell(
      fold('seed', VAULT),
      WIZARD,
      { spellId: 'glyph-of-warding', targets: [], at: THRESHOLD, slotLevel: 3, damageType: 'fire', types: ['Goblin'] },
      supply('ink'),
    );
    expect(isErr(out) && out.code).toBe('type_not_offered');
  });
});

describe('what a definition may say about either sentence', () => {
  const base = {
    id: 'homebrew-ward',
    name: 'Homebrew Ward',
    level: 3,
    school: 'abjuration',
    castingTime: 'action',
    concentration: false,
    range: { kind: 'touch' },
    targets: { count: 0 },
    area: { kind: 'sphere', radius: 10, origin: 'point' },
    effects: [],
    untilDispelled: true,
    unmodelled: ['what the ward looks like is the DM’s'],
    triggered: {
      label: 'the ward',
      effects: [{ kind: 'save-damage', ability: 'dex', damage: { dice: '2d8' }, damageType: 'fire', onSuccess: 'half' }],
    },
  };
  const codes = (over: Record<string, unknown>): readonly string[] =>
    checkSpellDefinitionValue({ ...base, ...over }).map((one) => one.code);

  it('lets a casting that lasts until dispelled offer a check', () => {
    expect(codes({ check: { ability: 'wis', skill: 'perception', onSuccess: 'none' } })).toEqual([]);
  });

  it('lets a trigger be refined to the stated types', () => {
    expect(
      codes({
        typesStated: { options: ['Undead', 'Fiend'], orNone: true },
        triggered: { ...base.triggered, onlyStatedTypes: true },
      }),
    ).toEqual([]);
  });

  it('refuses a refinement with no types for the caster to state', () => {
    expect(codes({ triggered: { ...base.triggered, onlyStatedTypes: true } })).toContain('refines_to_nothing');
  });
});
