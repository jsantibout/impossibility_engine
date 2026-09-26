import { SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import { asCharacterId, expect as unwrap, isErr, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { declaredCasting } from './spellcasting.js';
import { checkSpellDefinitionValue } from './spell-schema.js';
import type { Point } from './positioning.js';
import { availableChecks, resolveEffectCheck, resolveSpell } from './commands.js';

/**
 * SRD Spike Growth, the sentence the ground track left:
 *
 * > "The transformation of the ground is camouflaged to look natural. Any
 * > creature that can't see the area when the spell is cast must take a Search
 * > action and succeed on a **Wisdom (Perception or Survival)** check against
 * > your spell save DC to recognize the terrain as hazardous before entering
 * > it."
 *
 * A check with a **choice of skill**. `SpellCheck.skill` names one skill and
 * `EffectCheckCommand` stated none, so "Perception or Survival" — the
 * attempter's choice — had no field to be said in. `SpellCheck.skills` is the
 * list the spell prints, pinned on the casting record it belongs to
 * (`OngoingSpell.checkSkills`, beside `singledOut`, for the same reason: the
 * timer's check is a vocabulary `timers.ts` owns this wave), and
 * `EffectCheckCommand.skill` is the attempter's pick — refused off the list,
 * refused when the list is printed and nothing is picked, and never defaulted.
 * The Search action is the check's price, which `resolveEffectCheck` has always
 * charged as the Action in a fight. "Any creature that can't see the area when
 * the spell is cast" is the table's to know, and the definition says so.
 */

const id = (s: string) => asCharacterId(s);
const DRUID = id('druid');
const GOBLIN = id('goblin');

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
});

const added = (who: CharacterId): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 40,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side: who === DRUID ? 'party' : 'foes',
});

const HALL: Point = { x: 100, y: 200, z: 0 };
const AT: Point = { x: 240, y: 200, z: 0 };
const EDGE: Point = { x: 265, y: 200, z: 0 };

const SETUP: readonly GameEvent[] = [
  added(DRUID),
  added(GOBLIN),
  {
    type: 'spellcasting-declared',
    id: DRUID,
    spellcasting: declaredCasting({ ability: 'wis', prepared: ['spike-growth'] }),
  },
  {
    type: 'resource-pool-declared',
    id: DRUID,
    pool: { key: 'spell-slot:2', label: 'level 2', max: 3, recovers: 'long-rest' },
  },
  { type: 'scene-set', extent: { width: 600, depth: 600, height: 60 } },
  { type: 'landmark-added', name: 'the hall', at: HALL },
  { type: 'landmark-added', name: 'the edge', at: EDGE },
  { type: 'creature-placed', id: DRUID, placement: { from: { landmark: 'the hall' }, feet: 0 } },
  { type: 'creature-placed', id: GOBLIN, placement: { from: { landmark: 'the edge' }, feet: 0 } },
];

const supply = (seed = 'thorns') => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

const state = (log: readonly GameEvent[]): GameState => fold('seed', log);

/** The spikes conjured and the fight begun, with the goblin's turn first. */
const spiked = (): { log: readonly GameEvent[]; castingId: string } => {
  const cast = unwrap(
    resolveSpell(state(SETUP), DRUID, { spellId: 'spike-growth', targets: [], at: AT, slotLevel: 2 }, supply()),
    'the spikes',
  );
  const fight: GameEvent = {
    type: 'combat-started',
    combatants: [
      { id: GOBLIN, initiative: 20, speed: 30 },
      { id: DRUID, initiative: 10, speed: 30 },
    ],
  };
  return { log: [...SETUP, ...cast.events, fight], castingId: cast.castingId! };
};

describe('a check with a choice of skill — SRD Spike Growth', () => {
  it('offers anybody the check, naming both skills the spell prints', () => {
    const { log } = spiked();
    const offered = availableChecks(state(log), GOBLIN);
    expect(offered).toHaveLength(1);
    expect(offered[0]!.ability).toBe('wis');
    expect(offered[0]!.skill).toBeNull();
    expect(offered[0]!.skills).toEqual(['perception', 'survival']);
    expect(offered[0]!.onSuccess).toBe('none');
    // The druid's own spell save DC: 8 + 3 + 4.
    expect(offered[0]!.dc).toBe(15);
  });

  it('records a Search-action Survival check against the casting’s DC, and spends the Action', () => {
    const { log, castingId } = spiked();
    const before = state(log);
    const [offered] = availableChecks(before, GOBLIN);
    const out = unwrap(
      resolveEffectCheck(before, GOBLIN, { effectKey: offered!.effectKey, skill: 'survival' }, supply()),
      'the Search',
    );
    expect(out.check?.skill).toBe('survival');
    expect(out.check?.ability).toBe('wis');
    expect(out.check?.dc).toBe(15);
    expect(out.events.some((event) => event.type === 'roll-recorded' && event.who === GOBLIN)).toBe(true);
    expect(out.events.some((event) => event.type === 'action-spent' && event.id === GOBLIN)).toBe(true);
    // Knowing the ground is sharp changes nothing the engine holds: the spikes stay.
    const after = fold('seed', [...log, ...out.events]);
    expect(after.ongoing[castingId]).toBeDefined();
    expect(after.combat?.budgets[GOBLIN]?.action).toBe(false);
  });

  it('records the Perception check the same way', () => {
    const { log } = spiked();
    const before = state(log);
    const [offered] = availableChecks(before, GOBLIN);
    const out = unwrap(
      resolveEffectCheck(before, GOBLIN, { effectKey: offered!.effectKey, skill: 'perception' }, supply('eyes')),
      'the Search',
    );
    expect(out.check?.skill).toBe('perception');
  });

  it('refuses a skill the spell does not print, before anything is spent', () => {
    const { log } = spiked();
    const before = state(log);
    const [offered] = availableChecks(before, GOBLIN);
    const held = supply();
    const refused = resolveEffectCheck(
      before,
      GOBLIN,
      { effectKey: offered!.effectKey, skill: 'athletics' },
      held,
    );
    expect(isErr(refused) && refused.code).toBe('skill_not_offered');
    // No die was thrown, and the goblin's Action is where it was.
    expect(held.issuer.count).toBe(0);
    expect(before.combat?.budgets[GOBLIN]?.action).toBe(true);
  });

  it('refuses to choose between the two when the attempter names neither', () => {
    const { log } = spiked();
    const before = state(log);
    const [offered] = availableChecks(before, GOBLIN);
    const refused = resolveEffectCheck(before, GOBLIN, { effectKey: offered!.effectKey }, supply());
    expect(isErr(refused) && refused.code).toBe('skill_required');
  });

  it('lets a check that prints one skill be attempted with that skill named, and no other', () => {
    // SRD Minor Illusion prints "Intelligence (Investigation)": naming it
    // restates the book, naming Arcana contradicts it, and naming nothing is
    // the ordinary attempt it always was.
    const definition = SRD_CONTENT.spell('minor-illusion')!;
    expect(definition.check?.skill).toBe('investigation');
    expect(definition.check?.skills).toBeUndefined();

    const armed: readonly GameEvent[] = [
      ...SETUP,
      {
        type: 'spellcasting-declared',
        id: DRUID,
        spellcasting: declaredCasting({ ability: 'wis', prepared: ['spike-growth'], cantrips: ['minor-illusion'] }),
      },
    ];
    const cast = unwrap(
      resolveSpell(state(armed), DRUID, { spellId: 'minor-illusion', targets: [] }, supply('image')),
      'the image',
    );
    const before = state([
      ...armed,
      ...cast.events,
      {
        type: 'combat-started',
        combatants: [
          { id: GOBLIN, initiative: 20, speed: 30 },
          { id: DRUID, initiative: 10, speed: 30 },
        ],
      },
    ]);
    const [offered] = availableChecks(before, GOBLIN);
    expect(offered?.skill).toBe('investigation');
    expect(offered?.skills).toBeUndefined();

    const restated = unwrap(
      resolveEffectCheck(before, GOBLIN, { effectKey: offered!.effectKey, skill: 'investigation' }, supply('look')),
      'restated',
    );
    expect(restated.check?.skill).toBe('investigation');
    const unnamed = unwrap(
      resolveEffectCheck(before, GOBLIN, { effectKey: offered!.effectKey }, supply('look')),
      'unnamed',
    );
    expect(unnamed.check?.skill).toBe('investigation');
    const other = resolveEffectCheck(before, GOBLIN, { effectKey: offered!.effectKey, skill: 'arcana' }, supply('look'));
    expect(isErr(other) && other.code).toBe('skill_not_offered');
  });

  it('is validated: one skill or a list, never both, and every listed skill belongs to the ability', () => {
    const base = SRD_CONTENT.spell('spike-growth')!;
    expect(base.check).toEqual({ ability: 'wis', skills: ['perception', 'survival'], onSuccess: 'none' });

    const both = checkSpellDefinitionValue({
      ...base,
      check: { ability: 'wis', skill: 'perception', skills: ['perception', 'survival'], onSuccess: 'none' },
    });
    expect(both.map((problem) => problem.code)).toContain('check_skill_and_skills');

    const mismatched = checkSpellDefinitionValue({
      ...base,
      check: { ability: 'wis', skills: ['perception', 'athletics'], onSuccess: 'none' },
    });
    expect(mismatched.map((problem) => problem.code)).toContain('skill_ability_mismatch');

    const lonely = checkSpellDefinitionValue({
      ...base,
      check: { ability: 'wis', skills: ['perception'], onSuccess: 'none' },
    });
    expect(lonely.map((problem) => problem.code)).toContain('malformed_field');
  });
});
