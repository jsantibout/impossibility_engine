import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, isErr, type CharacterId, type Result } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { declaredCasting } from './spellcasting.js';
import { activateSpell, availableChecks, resolveEffectCheck, resolveSpell } from './commands.js';

/**
 * SRD Detect Thoughts, the deeper probe and the check the probed creature makes.
 *
 * > "As a Magic action on your next turn, you can try to probe deeper into the
 * > target's mind. If you probe deeper, the target makes a Wisdom saving throw.
 * > On a failed save, you discern the target's reasoning, emotions, and
 * > something that looms large in its mind. **On a successful save, the spell
 * > ends.** Either way, the target knows that you are probing into its mind,
 * > and until you shift your attention away from the target's mind, **the target
 * > can take an action on its turn to make an Intelligence (Arcana) check
 * > against your spell save DC, ending the spell on a success.**"
 *
 * Two things this spell waited on. **An activation that forces a saving throw**:
 * the machinery was standing beside it with no consumer, and what was missing
 * was a save whose *success* ends the casting — `save.onSuccess: 'end-casting'`,
 * the other end of the sentence `SpellCheck.onSuccess` already had. **A check
 * narrowed to one creature**: the casting is on the caster and holds nothing on
 * the creature being probed, so the probe pins it (`OngoingSpell.probing`) and
 * `SpellCheck.attemptBy: 'probed'` is what reads the pin — the fighter standing
 * beside the goblin may not shake off a spell that is in the goblin's head.
 */

const id = (s: string): CharacterId => asCharacterId(s);
const WIZARD = id('wizard');
const GOBLIN = id('goblin');
const FIGHTER = id('fighter');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 10, con: 12, int: 10, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
  ...over,
});

const added = (who: CharacterId, side: string, over: Partial<CharacterSheet> = {}): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(over),
  maxHp: 40,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side,
});

const ROOM: readonly GameEvent[] = [
  // A high Intelligence on the wizard so the DC is worth rolling against.
  added(WIZARD, 'party', { abilities: { str: 10, dex: 10, con: 12, int: 18, wis: 10, cha: 10 } }),
  added(GOBLIN, 'goblins'),
  added(FIGHTER, 'party'),
  {
    type: 'spellcasting-declared',
    id: WIZARD,
    spellcasting: declaredCasting({
      ability: 'int',
      classId: 'wizard',
      prepared: ['detect-thoughts'],
    }),
  },
  {
    type: 'resource-pool-declared',
    id: WIZARD,
    pool: { key: 'spell-slot:2', label: 'level 2', max: 3, recovers: 'long-rest' },
  },
  { type: 'scene-set', extent: { width: 200, depth: 200, height: 30 } },
  { type: 'landmark-added', name: 'the study', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: WIZARD, placement: { from: { landmark: 'the study' }, feet: 0 } },
  {
    type: 'creature-placed',
    id: GOBLIN,
    placement: { from: { creature: WIZARD }, feet: 15, bearing: 90 },
  },
  {
    type: 'creature-placed',
    id: FIGHTER,
    placement: { from: { creature: GOBLIN }, feet: 5, bearing: 90 },
  },
  { type: 'sight-declared', from: WIZARD, to: GOBLIN, seen: true },
];

const supply = (seed: string) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

const must = <T,>(result: Result<T>, what: string): T => unwrap(result, what);

const listening = () => {
  const out = must(
    resolveSpell(
      fold('seed', ROOM),
      WIZARD,
      { spellId: 'detect-thoughts', targets: [], slotLevel: 2 },
      supply('listen'),
    ),
    'Detect Thoughts',
  );
  const log = [...ROOM, ...out.events];
  return { out, log, state: fold('seed', log) as GameState, castingId: out.castingId! };
};

/** The probe, at whichever seed the caller wants the goblin's save thrown with. */
const probe = (seed: string) => {
  const { log, castingId } = listening();
  const out = must(
    activateSpell(
      fold('seed', log) as GameState,
      WIZARD,
      { castingId, targets: [GOBLIN] },
      supply(seed),
    ),
    'the probe',
  );
  const after = [...log, ...out.events];
  return { out, log: after, state: fold('seed', after) as GameState, castingId };
};

/** Two seeds, one for each face of the goblin's Wisdom save. */
const seedWhere = (success: boolean): string => {
  for (const seed of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l']) {
    const { out } = probe(seed);
    if (out.outcomes[0]?.save?.success === success) return seed;
  }
  throw new Error(`no seed makes the goblin's save ${success ? 'hold' : 'fail'}`);
};

describe('Detect Thoughts', () => {
  it('runs on its caster and probes nobody until the Magic action is taken', () => {
    const { state, castingId } = listening();
    const record = state.ongoing[castingId]!;
    expect(record.caster).toBe(WIZARD);
    expect(record.probing).toBeUndefined();
  });

  it('forces the probed creature’s Wisdom saving throw', () => {
    const { out } = probe('a');
    expect(out.outcomes.map((one) => one.target)).toEqual([GOBLIN]);
    expect(out.outcomes[0]!.save).toBeDefined();
    const rolled = out.events.find((event) => event.type === 'roll-recorded');
    expect(rolled).toBeDefined();
  });

  it('ends on a successful save, and pins the probed creature on a failure', () => {
    const held = probe(seedWhere(false));
    expect(held.state.ongoing[held.castingId]).toBeDefined();
    expect(held.state.ongoing[held.castingId]!.probing).toBe(GOBLIN);

    const resisted = probe(seedWhere(true));
    expect(resisted.state.ongoing[resisted.castingId]).toBeUndefined();
    const ended = resisted.out.events.find((event) => event.type === 'spell-ended');
    expect(ended).toMatchObject({ reason: 'resisted', on: null });
  });

  it('offers the Arcana check to the probed creature and to nobody else', () => {
    const { state } = probe(seedWhere(false));
    const goblins = availableChecks(state, GOBLIN);
    expect(goblins.map((one) => one.ability)).toEqual(['int']);
    expect(goblins[0]!.skill).toBe('arcana');
    expect(goblins[0]!.onSuccess).toBe('end-casting');
    // The wizard's own spell save DC, pinned at the cast: 8 + 3 + 4.
    expect(goblins[0]!.dc).toBe(15);

    expect(availableChecks(state, FIGHTER)).toEqual([]);
    const refused = resolveEffectCheck(
      state,
      FIGHTER,
      { effectKey: goblins[0]!.effectKey },
      supply('shake'),
    );
    expect(isErr(refused) && refused.code).toBe('not_yours_to_attempt');
  });

  it('ends the casting when the probed creature’s Arcana check lands', () => {
    const { state, log } = probe(seedWhere(false));
    const key = availableChecks(state, GOBLIN)[0]!.effectKey;
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
      const out = must(resolveEffectCheck(state, GOBLIN, { effectKey: key }, supply(seed)), 'the check');
      if (!out.success) continue;
      expect(out.onSuccess).toBe('end-casting');
      const after = fold('seed', [...log, ...out.events]) as GameState;
      expect(Object.keys(after.ongoing)).toEqual([]);
      return;
    }
    throw new Error('no seed makes the goblin see through it');
  });
});
