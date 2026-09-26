import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, isErr, type CharacterId, type Result } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { declaredCasting } from './spellcasting.js';
import { activateSpell, resolveSpell } from './commands.js';

/**
 * SRD Call Lightning, the bolt at the cast and the bolts after it.
 *
 * > "A storm cloud appears at a point within range that you can see above
 * > yourself. It takes the shape of a Cylinder that is 10 feet tall with a
 * > 60-foot radius. When you cast the spell, choose a point you can see under
 * > the cloud. A lightning bolt shoots from the cloud to that point. Each
 * > creature within 5 feet of that point makes a Dexterity saving throw, taking
 * > 3d10 Lightning damage on a failed save or half as much damage on a
 * > successful one." / "Until the spell ends, you can take a Magic action to
 * > call down lightning in that way again, targeting the same point or a
 * > different one." / "If you're outdoors in a storm when you cast this spell …
 * > the spell's damage increases by 1d10."
 *
 * Two things this spell waited on. **`SpellActivation.redrawsArea`**: the bolt
 * is one printed template and one printed number, placed at the cast and drawn
 * again at a point stated when the later action is taken — so the definition
 * writes the 5-foot Sphere and the 3d10 once, and the cloud is the point the
 * casting keeps, whose 60-foot radius is how far a later bolt may fall from it.
 * **The storm is a stated fact**: whether it is raining outdoors is a fact about
 * the world the engine does not hold, so the caster says at the cast, the record
 * pins the answer, and the dice read it ten minutes later.
 */

const id = (s: string): CharacterId => asCharacterId(s);
const DRUID = id('druid');
const NEAR = id('goblin-near');
const OFF = id('goblin-off');

const sheet = (): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 10, con: 12, int: 10, wis: 18, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'wis',
});

const added = (who: CharacterId, side: string): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 80,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side,
});

/** The first bolt's point, 40 feet east of the druid, with a goblin standing on it. */
const FIRST = { x: 140, y: 100, z: 0 };
/** Another point, 30 feet on again — still inside the cloud's 60-foot radius. */
const SECOND = { x: 170, y: 100, z: 0 };
/** And one 90 feet from the first, which is outside it. */
const BEYOND = { x: 230, y: 100, z: 0 };

const FIELD: readonly GameEvent[] = [
  added(DRUID, 'party'),
  added(NEAR, 'goblins'),
  added(OFF, 'goblins'),
  {
    type: 'spellcasting-declared',
    id: DRUID,
    spellcasting: declaredCasting({
      ability: 'wis',
      classId: 'druid',
      prepared: ['call-lightning', 'moonbeam'],
    }),
  },
  {
    type: 'resource-pool-declared',
    id: DRUID,
    pool: { key: 'spell-slot:3', label: 'level 3', max: 3, recovers: 'long-rest' },
  },
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 60 } },
  { type: 'landmark-added', name: 'the moor', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: DRUID, placement: { from: { landmark: 'the moor' }, feet: 0 } },
  { type: 'creature-placed', id: NEAR, placement: { from: { point: FIRST }, feet: 0 } },
  { type: 'creature-placed', id: OFF, placement: { from: { point: SECOND }, feet: 0 } },
];

const supply = (seed: string) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

const must = <T,>(result: Result<T>, what: string): T => unwrap(result, what);

const called = (over: Record<string, unknown> = {}) => {
  const out = must(
    resolveSpell(
      fold('seed', FIELD),
      DRUID,
      { spellId: 'call-lightning', targets: [], slotLevel: 3, at: FIRST, ...over },
      supply('bolt'),
    ),
    'Call Lightning',
  );
  const log = [...FIELD, ...out.events];
  return { out, log, state: fold('seed', log) as GameState, castingId: out.castingId! };
};

/** Every die of Lightning this batch of events rolled, by slice. */
const diceThrown = (events: readonly GameEvent[]): readonly number[] =>
  events
    .filter((event) => event.type === 'damage-dice-recorded')
    .flatMap((event) =>
      event.type === 'damage-dice-recorded'
        ? event.components.map((part) => part.dice.length)
        : [],
    );

describe('Call Lightning', () => {
  it('drops a bolt at the cast and asks whoever is within five feet of it', () => {
    const { out } = called();
    expect(out.outcomes.map((one) => one.target)).toEqual([NEAR]);
    expect(out.outcomes[0]!.save).toBeDefined();
    // 3d10 at a level 3 slot, Lightning, and nothing else.
    expect(diceThrown(out.events)).toEqual([3]);
    const dice = out.events.find((event) => event.type === 'damage-dice-recorded');
    if (dice?.type !== 'damage-dice-recorded') throw new Error('no dice');
    expect(dice.components.map((part) => part.type)).toEqual(['lightning']);
  });

  it('keeps the cloud as the point it measures the next bolt from', () => {
    const { state, castingId } = called();
    expect(state.ongoing[castingId]!.origin).toEqual(FIRST);
  });

  it('calls another one down at a different point under the cloud', () => {
    const { state, castingId } = called();
    const again = must(
      activateSpell(state, DRUID, { castingId, targets: [], at: SECOND }, supply('again')),
      'the second bolt',
    );
    expect(again.outcomes.map((one) => one.target)).toEqual([OFF]);
    expect(again.outcomes[0]!.save).toBeDefined();
    expect(diceThrown(again.events)).toEqual([3]);
  });

  it('refuses a point outside the cloud', () => {
    const { state, castingId } = called();
    const refused = activateSpell(
      state,
      DRUID,
      { castingId, targets: [], at: BEYOND },
      supply('again'),
    );
    expect(isErr(refused) && refused.code).toBe('outside_the_kept_point');
  });

  it('refuses a later action that names no point at all', () => {
    const { state, castingId } = called();
    const refused = activateSpell(state, DRUID, { castingId, targets: [] }, supply('again'));
    expect(isErr(refused) && refused.code).toBe('point_required');
  });

  it('adds a die when the caster said they were outdoors in a storm', () => {
    const stormy = called({ inAStorm: true });
    expect(diceThrown(stormy.out.events)).toEqual([4]);
    // Pinned, so the bolt called down ten minutes later still knows the weather.
    expect(stormy.state.ongoing[stormy.castingId]!.inAStorm).toBe(true);
    const again = must(
      activateSpell(
        stormy.state,
        DRUID,
        { castingId: stormy.castingId, targets: [], at: SECOND },
        supply('again'),
      ),
      'the second bolt',
    );
    expect(diceThrown(again.events)).toEqual([4]);
  });

  it('refuses the storm on a spell that prints no such clause', () => {
    const refused = resolveSpell(
      fold('seed', FIELD),
      DRUID,
      { spellId: 'moonbeam', targets: [], slotLevel: 3, at: FIRST, inAStorm: true },
      supply('bolt'),
    );
    expect(isErr(refused) && refused.code).toBe('storm_states_nothing');
  });

  it('refuses a point on a later action of a spell that draws no template', () => {
    const out = must(
      resolveSpell(
        fold('seed', FIELD),
        DRUID,
        { spellId: 'moonbeam', targets: [], slotLevel: 3, at: FIRST },
        supply('beam'),
      ),
      'Moonbeam',
    );
    const state = fold('seed', [...FIELD, ...out.events]) as GameState;
    const refused = activateSpell(
      state,
      DRUID,
      { castingId: out.castingId!, targets: [], to: SECOND, at: SECOND },
      supply('move'),
    );
    expect(isErr(refused) && refused.code).toBe('no_point_clause');
  });
});
