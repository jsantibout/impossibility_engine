import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, isErr, type CharacterId, type Result } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { declaredCasting } from './spellcasting.js';
import { hasSpeedInModeOn, weaponRidersFor } from './standing.js';
import { activateSpell, resolveAttack, resolveSpell, resolveTurn } from './commands.js';

/**
 * SRD Alter Self, three forms and a Magic action that swaps them.
 *
 * > "Choose one of the following options. Its effects last for the duration,
 * > during which you can take a Magic action to replace the option you chose
 * > with a different one. _Aquatic Adaptation._ … gain a Swim Speed equal to
 * > your Speed. _Change Appearance._ … _Natural Weapons._ You grow claws
 * > (Slashing), fangs (Piercing), horns (Piercing), or hooves (Bludgeoning).
 * > When you use your Unarmed Strike to deal damage with that new growth, it
 * > deals 1d6 damage of the type in parentheses instead of dealing the normal
 * > damage for your Unarmed Strike, and you use your spellcasting ability
 * > modifier for the attack and damage rolls rather than using Strength."
 *
 * Three things this spell waited on. **A rider on the Unarmed Strike**: a
 * `weapon-rider` is keyed to one weapon's id and a fist has none, so `unarmed`
 * hangs it where a punch is read — the same imbued branch `strikeStyleFor`
 * gives Shillelagh — with the type and the ability **imposed** rather than
 * offered, because the sentence says "instead" and "rather than". **A Swim
 * Speed**: `match-walk` in the swim mode, which the vocabulary had for exactly
 * this sentence. And **an activation that re-chooses**: `reoptions` is a Magic
 * action that names a different branch, `spell-option-changed` releases what
 * the casting hung on the caster and re-pins the word, and the new branch runs
 * off the record's own numbers.
 */

const id = (s: string): CharacterId => asCharacterId(s);
const SORCERER = id('sorcerer');
const GOBLIN = id('goblin');

/** Weak arms and a strong voice, so the two abilities are told apart by the number. */
const sheet = (): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 12, con: 12, int: 10, wis: 10, cha: 18 },
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
  maxHp: 60,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side,
});

const SHORE: readonly GameEvent[] = [
  added(SORCERER, 'party'),
  added(GOBLIN, 'goblins'),
  {
    type: 'spellcasting-declared',
    id: SORCERER,
    spellcasting: declaredCasting({ ability: 'cha', classId: 'sorcerer', prepared: ['alter-self'] }),
  },
  {
    type: 'resource-pool-declared',
    id: SORCERER,
    pool: { key: 'spell-slot:2', label: 'level 2', max: 2, recovers: 'long-rest' },
  },
  { type: 'scene-set', extent: { width: 300, depth: 300, height: 40 } },
  { type: 'landmark-added', name: 'the shore', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: SORCERER, placement: { from: { landmark: 'the shore' }, feet: 0 } },
  { type: 'creature-placed', id: GOBLIN, placement: { from: { creature: SORCERER }, feet: 5, bearing: 0 } },
  { type: 'sight-declared', from: SORCERER, to: GOBLIN, seen: true },
];

/** The same shore with a fight on it, for the one assertion about the Action. */
const FIGHT: readonly GameEvent[] = [
  ...SHORE,
  {
    type: 'combat-started',
    combatants: [
      { id: SORCERER, initiative: 20, speed: 30 },
      { id: GOBLIN, initiative: 10, speed: 30 },
    ],
  },
];

const supply = (seed: string, flat?: number) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
  ...(flat === undefined ? {} : { bonuses: [{ source: 'the test insists', flat }] }),
});

const HITS = 40;

const must = <T,>(result: Result<T>, what: string): T => unwrap(result, what);

const shaped = (option: string, over: Record<string, unknown> = {}) => {
  const out = must(
    resolveSpell(
      fold('seed', SHORE),
      SORCERER,
      { spellId: 'alter-self', targets: [SORCERER], option, ...over },
      supply('form'),
    ),
    option,
  );
  const log = [...SHORE, ...out.events];
  return { out, log, state: fold('seed', log) as GameState, castingId: out.castingId! };
};

/** A punch at the goblin that cannot miss, and what it dealt. */
const punch = (state: GameState) =>
  must(resolveAttack(state, SORCERER, { target: GOBLIN, weapon: null }, supply('fist', HITS)), 'punch');

/** The types the blow's components were rolled as, off the dice the log records. */
const typesDealt = (events: readonly GameEvent[]): readonly string[] =>
  events.flatMap((event) =>
    event.type === 'damage-dice-recorded' && event.target === GOBLIN
      ? event.components.map((one) => one.type)
      : [],
  );

describe('SRD Alter Self’s Natural Weapons', () => {
  it('makes the Unarmed Strike deal 1d6 of the stated type with the spellcasting ability', () => {
    const { state } = shaped('natural-weapons', { damageType: 'slashing' });
    const struck = punch(state);
    expect(typesDealt(struck.events)).toEqual(['slashing']);
    // 1d6 + 4 (Charisma), never 1 + 0 (Strength): the floor is what tells them apart.
    expect(struck.damage!).toBeGreaterThanOrEqual(5);
    expect(
      struck.events.some(
        (event) =>
          event.type === 'roll-recorded' &&
          event.who === SORCERER &&
          event.contributions.some((one) => one.amount === 4 + 3),
      ),
    ).toBe(true);
  });

  it('asks which growth, because the type is the caster’s choice', () => {
    const out = resolveSpell(
      fold('seed', SHORE),
      SORCERER,
      { spellId: 'alter-self', targets: [SORCERER], option: 'natural-weapons' },
      supply('form'),
    );
    expect(isErr(out) && out.code).toBe('damage_type_required');
  });
});

describe('SRD Alter Self’s Magic action replaces the option', () => {
  it('swaps the claws for gills: the swim comes, the rider goes, and the word is re-pinned', () => {
    const { state, log, castingId } = shaped('natural-weapons', { damageType: 'slashing' });
    expect(weaponRidersFor(state.creatures[SORCERER], null)).toHaveLength(1);
    expect(hasSpeedInModeOn(state, SORCERER, 'swim')).toBe(false);

    const swapped = must(
      activateSpell(state, SORCERER, { castingId, targets: [], option: 'aquatic-adaptation' }, supply('gills')),
      'swap',
    );
    const after = fold('seed', [...log, ...swapped.events]);
    expect(hasSpeedInModeOn(after, SORCERER, 'swim')).toBe(true);
    expect(weaponRidersFor(after.creatures[SORCERER], null)).toHaveLength(0);
    expect(after.ongoing[castingId]?.option).toBe('aquatic-adaptation');
    // And a punch is a punch again: 1 + Strength's 0, with no die to record.
    const struck = punch(after);
    expect(struck.damage).toBe(1);
    expect(typesDealt(struck.events)).not.toContain('slashing');
  });

  /** "take a Magic action": the swap is paid for out of the turn. */
  it('spends the Action on the swap', () => {
    const cast = must(
      resolveSpell(
        fold('seed', FIGHT),
        SORCERER,
        { spellId: 'alter-self', targets: [SORCERER], option: 'natural-weapons', damageType: 'slashing' },
        supply('form'),
      ),
      'cast in the fight',
    );
    // Round the order once, back to the sorcerer, whose Action is fresh again.
    let log: readonly GameEvent[] = [...FIGHT, ...cast.events];
    for (let turns = 0; turns < 2; turns += 1) {
      log = [...log, ...must(resolveTurn(fold('seed', log), supply('turn')), 'turn').events];
    }
    const before = fold('seed', log);
    expect(before.combat?.budgets[SORCERER]?.action).toBe(true);
    const swapped = must(
      activateSpell(before, SORCERER, { castingId: cast.castingId!, targets: [], option: 'aquatic-adaptation' }, supply('gills')),
      'swap',
    );
    expect(fold('seed', [...log, ...swapped.events]).combat?.budgets[SORCERER]?.action).toBe(false);
  });

  it('refuses the same word, an unprinted one, and none at all', () => {
    const { state, castingId } = shaped('natural-weapons', { damageType: 'slashing' });
    const same = activateSpell(state, SORCERER, { castingId, targets: [], option: 'natural-weapons' }, supply('x'));
    expect(isErr(same) && same.code).toBe('same_option');
    const unknown = activateSpell(state, SORCERER, { castingId, targets: [], option: 'wings' }, supply('x'));
    expect(isErr(unknown) && unknown.code).toBe('unknown_option');
    const none = activateSpell(state, SORCERER, { castingId, targets: [] }, supply('x'));
    expect(isErr(none) && none.code).toBe('option_required');
  });

  it('hands Change Appearance over whole', () => {
    const { out, state } = shaped('change-appearance');
    expect(out.unverified.some((line) => line.includes('You decide what you look like'))).toBe(true);
    expect(weaponRidersFor(state.creatures[SORCERER], null)).toHaveLength(0);
    expect(hasSpeedInModeOn(state, SORCERER, 'swim')).toBe(false);
  });
});
