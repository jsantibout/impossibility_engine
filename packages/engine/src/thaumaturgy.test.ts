import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, restoreRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { declaredCasting } from './spellcasting.js';
import { rollModesFor } from './standing.js';
import { checkSpellDefinition } from './spell-schema.js';
import type { SpellDefinition } from './spell-definitions.js';
import { eligibleTargets, resolveSpell } from './commands.js';

/**
 * SRD Thaumaturgy, _Booming Voice_: "Your voice booms up to three times as loud
 * as normal for 1 minute. For the duration, you have Advantage on Charisma
 * (Intimidation) checks."
 *
 * **The mode was always ordinary; the creature was the gap.** A `RollModifier`
 * naming a Charisma ability check narrowed to the Intimidation skill is the pair
 * `RollSelector` already carries, and Thaumaturgy printed `targets: { count: 0 }`
 * — the wonder happens "within range" rather than on somebody — so the per-target
 * loop ran no times and the mode had nowhere to land. `{ count: 1, self: true }`
 * would have let a cleric boom an ally's voice, which the book does not grant.
 *
 * `TargetRule.casterOnly` is the sentence that was missing: the caster is the
 * one legal target, and anybody else is `not_the_caster`. It is
 * `notTheCaster`'s opposite number, and the family now has both halves.
 */

const id = (s: string) => asCharacterId(s);
const CLERIC = id('cleric');
const ALLY = id('ally');

const sheet = (): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 10, con: 12, int: 10, wis: 16, cha: 14 },
  skills: { intimidation: 'proficient' },
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
  maxHp: 40,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side: 'party',
});

const SETUP: readonly GameEvent[] = [
  added(CLERIC),
  added(ALLY),
  {
    type: 'spellcasting-declared',
    id: CLERIC,
    spellcasting: declaredCasting({ ability: 'wis', classId: 'cleric', cantrips: ['thaumaturgy'] }),
  },
  { type: 'scene-set', extent: { width: 300, depth: 300, height: 40 } },
  { type: 'landmark-added', name: 'the shrine', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: CLERIC, placement: { from: { landmark: 'the shrine' }, feet: 0 } },
  { type: 'creature-placed', id: ALLY, placement: { from: { creature: CLERIC }, feet: 10 } },
  { type: 'sight-declared', from: CLERIC, to: ALLY, seen: true },
];

const supply = (state: GameState) => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: (state.rng === null ? createRng('boom') : restoreRng(state.rng)) as Rng,
  content: SRD_CONTENT,
});

const boom = (log: readonly GameEvent[], on: CharacterId) =>
  resolveSpell(
    fold('seed', log),
    CLERIC,
    { spellId: 'thaumaturgy', targets: [on], option: 'booming-voice' } as never,
    supply(fold('seed', log)),
  );

/** The modes standing on a creature's check of one ability and skill. */
const modesOn = (state: GameState, who: CharacterId, ability: string, skill: string) =>
  rollModesFor(state, {
    family: 'ability-check',
    roller: who,
    ability: ability as never,
    skill: skill as never,
  }).modes;

describe('SRD Thaumaturgy: the caster and nobody else', () => {
  it('grants the caster Advantage on Charisma (Intimidation) checks', () => {
    const cast = unwrap(boom(SETUP, CLERIC), 'booming voice');
    const state = fold('seed', [...SETUP, ...cast.events]);

    expect(modesOn(state, CLERIC, 'cha', 'intimidation')).toEqual([
      { source: 'Thaumaturgy#cast:1', mode: 'advantage' },
    ]);
  });

  it('withholds it from a check the sentence does not name', () => {
    const cast = unwrap(boom(SETUP, CLERIC), 'booming voice');
    const state = fold('seed', [...SETUP, ...cast.events]);

    // "Charisma (Intimidation)": a Charisma check of another skill is a
    // different roll, and so is somebody else's Intimidation.
    expect(modesOn(state, CLERIC, 'cha', 'persuasion')).toEqual([]);
    expect(modesOn(state, ALLY, 'cha', 'intimidation')).toEqual([]);
  });

  it('refuses to boom an ally’s voice', () => {
    const refused = boom(SETUP, ALLY);
    expect(isErr(refused)).toBe(true);
    if (isErr(refused)) expect(refused.code).toBe('not_the_caster');
  });

  it('offers the caster alone on the shortlist, and says why the ally is off it', () => {
    const state = fold('seed', SETUP);
    const shortlist = eligibleTargets(state, SRD_CONTENT, CLERIC, 'thaumaturgy', 0);

    expect(shortlist.eligible).toEqual([CLERIC]);
    expect(shortlist.excluded.map((one) => one.target)).toEqual([ALLY]);
    expect(shortlist.excluded[0]?.reason).toContain('nobody else');
  });

  /**
   * The three things the clause can be wrong about, each one silent without a
   * refusal: a value this validator read as absent would leave the spell castable
   * at anybody, a spell that does not admit the caster would refuse *everybody*,
   * and a count above one promises a creature the clause forbids.
   */
  it('holds the clause to the two things it can mean', () => {
    const cantrip = SRD_CONTENT.spell('thaumaturgy')!;
    const withTargets = (targets: unknown): SpellDefinition =>
      ({ ...cantrip, targets } as SpellDefinition);
    const codes = (targets: unknown): readonly string[] =>
      checkSpellDefinition(withTargets(targets)).map((one) => one.code);

    expect(checkSpellDefinition(cantrip)).toEqual([]);
    expect(codes({ count: 1, self: true, casterOnly: 'yes' })).toContain('malformed_field');
    expect(codes({ count: 1, casterOnly: true })).toContain('caster_only_without_self');
    expect(codes({ count: 2, self: true, casterOnly: true })).toContain('caster_only_count');
    expect(codes({ count: 0, unlimited: true, self: true, casterOnly: true })).toContain(
      'caster_only_unlimited',
    );
  });

  it('lets go of the mode when the minute is up', () => {
    const cast = unwrap(boom(SETUP, CLERIC), 'booming voice');
    const later = fold('seed', [
      ...SETUP,
      ...cast.events,
      { type: 'time-advanced', seconds: 61, reason: 'the minute' },
    ]);

    expect(modesOn(later, CLERIC, 'cha', 'intimidation')).toEqual([]);
  });
});

/**
 * SRD Thaumaturgy's last sentence: "If you cast this spell multiple times, you
 * can have up to three of its **1-minute effects** active at a time."
 *
 * Two of the six wonders are not 1-minute effects at all — _Invisible Hand_
 * "instantaneously" flings a door open and _Phantom Sound_ is "an instantaneous
 * sound" — so the duration is the branch's to set and not the spell's. A branch
 * that is over in an instant leaves nothing running: no record for the cap to
 * count, no deadline, and so no Booming Voice ended early because a door was
 * flung open. (`SpellOption.instantaneous`)
 */
describe('SRD Thaumaturgy: the wonders that are over in an instant', () => {
  const work = (log: readonly GameEvent[], option: string) =>
    unwrap(
      resolveSpell(
        fold('seed', log),
        CLERIC,
        { spellId: 'thaumaturgy', targets: [CLERIC], option } as never,
        supply(fold('seed', log)),
      ),
      option,
    );

  it('leaves no running record for a door flung open or a sound made', () => {
    for (const option of ['invisible-hand', 'phantom-sound']) {
      const cast = work(SETUP, option);
      const state = fold('seed', [...SETUP, ...cast.events]);
      expect(state.ongoing).toEqual({});
      expect(cast.events.some((event) => event.type === 'spell-ongoing')).toBe(false);
      // And no deadline is scheduled for a casting that has nothing to end.
      expect(state.timers).toEqual(fold('seed', SETUP).timers);
    }
  });

  it('still leaves a minute running for a wonder the book gives a minute', () => {
    const cast = work(SETUP, 'tremors');
    expect(Object.keys(fold('seed', [...SETUP, ...cast.events]).ongoing)).toHaveLength(1);
  });

  it('does not count an instant wonder against the three, nor end one of them to make room', () => {
    let log = SETUP;
    for (const option of ['booming-voice', 'fire-play', 'tremors']) {
      log = [...log, ...work(log, option).events];
    }
    for (const option of ['invisible-hand', 'phantom-sound', 'invisible-hand']) {
      log = [...log, ...work(log, option).events];
    }
    const running = Object.values(fold('seed', log).ongoing);
    expect(running.map((one) => one.option).sort()).toEqual(['booming-voice', 'fire-play', 'tremors']);
    expect(modesOn(fold('seed', log), CLERIC, 'cha', 'intimidation')).toEqual([
      { source: 'Thaumaturgy#cast:1', mode: 'advantage' },
    ]);
  });

  it('holds the field to what it can mean', () => {
    const cantrip = SRD_CONTENT.spell('thaumaturgy')!;
    const sound = cantrip.options!['phantom-sound']!;
    const withBranch = (branch: unknown, over: Partial<SpellDefinition> = {}): SpellDefinition =>
      ({
        ...cantrip,
        ...over,
        options: { ...cantrip.options, 'phantom-sound': branch },
      }) as SpellDefinition;
    const codes = (branch: unknown, over: Partial<SpellDefinition> = {}): readonly string[] =>
      checkSpellDefinition(withBranch(branch, over)).map((one) => one.code);

    expect(sound.instantaneous).toBe(true);
    expect(codes(sound)).toEqual([]);
    expect(codes({ ...sound, instantaneous: 'yes' })).toContain('malformed_field');
    // A branch over in an instant hangs nothing: a grant with no record under it
    // would outlive the casting for ever, because nothing would ever end it.
    expect(
      codes({ ...sound, effects: cantrip.options!['booming-voice']!.effects }),
    ).toContain('instant_branch_hangs_effects');
    // And it overrides a duration, so a spell that prints none has nothing to
    // override; nor may a Concentration spell be over in an instant.
    const { durationSeconds: _dropped, maxRunning: _cap, ...instant } = cantrip;
    void _dropped;
    void _cap;
    expect(
      checkSpellDefinition({
        ...instant,
        options: { ...cantrip.options, 'phantom-sound': sound },
      } as SpellDefinition).map((one) => one.code),
    ).toContain('instant_branch_of_an_instant_spell');
    expect(codes(sound, { concentration: true })).toContain('instant_branch_of_a_concentration_spell');
  });
});
