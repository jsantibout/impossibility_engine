import { describe, expect, it } from 'vitest';
import { asCharacterId, isErr, expect as unwrap, type Result } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, restoreRng } from './dice.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { spellSlotKey } from './resources.js';
import { createRollIssuer } from './rolls.js';
import { dueDamageOf, resolveSpell, resolveTurn } from './commands.js';
import { declaredCasting } from './spellcasting.js';

/**
 * Damage that arrives on a later turn.
 *
 * SRD Acid Arrow: "On a hit, the target takes 4d4 Acid damage **and 2d4 Acid
 * damage at the end of its next turn**." Vitriolic Sphere does the same thing
 * off a failed save. The second hit is not a condition, not a bonus and not an
 * ongoing effect — nothing about the target changes in the meantime. It is a
 * debt the world owes, payable at a named moment.
 *
 * Which makes it the second mechanic with the shape the turn-boundary save
 * already has: a moment, and something the engine owes when it arrives. The
 * save machinery cannot carry it — `raiseTurnSaves` hangs on a condition
 * instance and derives a casting id from it, and this spell imposes no
 * condition — so the debt gets its own small structure rather than an invented
 * condition to hang on.
 *
 * **The debt lives in state, which is the whole point.** DOCTRINE.md 9:
 * incomplete multi-step resolution must survive reloads. A schedule held in a
 * caller's hands is the pending Concentration save that had to be torn out.
 */

const id = (s: string) => asCharacterId(s);

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 9,
  abilities: { str: 10, dex: 10, con: 14, int: 18, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: ['con'],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
  ...over,
});

const add = (name: string, over: Partial<CharacterSheet> = {}): GameEvent => ({
  type: 'creature-added',
  id: id(name),
  name,
  sheet: sheet(over),
  maxHp: 200,
  side: name === 'wizard' ? 'party' : 'monsters',
});

/** Turn order: wizard, goblin, ogre. */
const fight = (): GameEvent[] => [
  add('wizard'),
  add('goblin'),
  add('ogre'),
  ...[2, 3, 4, 5, 6].map(
    (level): GameEvent => ({
      type: 'resource-pool-declared',
      id: id('wizard'),
      pool: { key: spellSlotKey(level), label: `l${level}`, max: 4, recovers: 'long-rest' },
    }),
  ),
  {
    type: 'spellcasting-declared',
    id: id('wizard'),
    spellcasting: declaredCasting({
      ability: 'int',
      cantrips: [],
      prepared: ['acid-arrow', 'vitriolic-sphere'],
    }),
  },
  { type: 'scene-set', extent: { width: 300, depth: 300, height: 40 } },
  { type: 'creature-placed', id: id('wizard'), placement: { from: { sceneCenter: true }, feet: 0 } },
  {
    type: 'creature-placed',
    id: id('goblin'),
    placement: { from: { creature: id('wizard') }, feet: 20, bearing: 0 },
  },
  {
    type: 'creature-placed',
    id: id('ogre'),
    placement: { from: { creature: id('wizard') }, feet: 25, bearing: 0 },
  },
  { type: 'sight-declared', from: id('wizard'), to: id('goblin'), seen: true },
  { type: 'sight-declared', from: id('wizard'), to: id('ogre'), seen: true },
  { type: 'creature-type-declared', id: id('goblin'), creatureType: 'Fey' },
  { type: 'creature-type-declared', id: id('ogre'), creatureType: 'Giant' },
  {
    type: 'combat-started',
    combatants: [
      { id: id('wizard'), initiative: 20, speed: 30 },
      { id: id('goblin'), initiative: 10, speed: 30 },
      { id: id('ogre'), initiative: 5, speed: 30 },
    ],
  },
];

/** A supply whose flat bonus settles the roll outright, either way. */
const supplyFor = (state: GameState, flat: number) => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: state.rng === null ? createRng('seed') : restoreRng(state.rng),
  bonuses: [{ source: 'the test insists', flat }],
});

const run = (
  log: readonly GameEvent[],
  command: (s: GameState) => Result<{ readonly events: readonly GameEvent[] }>,
): GameEvent[] => [...log, ...unwrap(command(fold('seed', log)), 'command').events];

/** Advance the turn, rolling whatever the boundary owes. */
const advance = (log: readonly GameEvent[], commandId: string): GameEvent[] =>
  run(log, (s) => resolveTurn(s, supplyFor(s, 0), { commandId }));

const hp = (log: readonly GameEvent[], who: string): number =>
  fold('seed', log).creatures[who]?.vitals.hp ?? -1;

/** Cast Acid Arrow at the goblin, with the attack forced to land or to miss. */
const acidArrow = (log: readonly GameEvent[], flat: number, slotLevel = 2): GameEvent[] =>
  run(log, (s) =>
    resolveSpell(
      s,
      id('wizard'),
      { spellId: 'acid-arrow', targets: [id('goblin')], slotLevel, commandId: `arrow-${slotLevel}-${flat}` },
      supplyFor(s, flat),
    ),
  );

describe('a second hit that arrives at the end of the target\'s next turn', () => {
  it('is scheduled by a hit, and has not landed yet', () => {
    const log = acidArrow(fight(), 40);
    const state = fold('seed', log);

    // The initial 4d4 landed now.
    expect(hp(log, 'goblin')).toBeLessThan(200);

    // And the later hit is owed, recorded in state rather than remembered.
    const scheduled = Object.values(state.scheduledDamage);
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]?.target).toBe('goblin');
    expect(scheduled[0]?.damageType).toBe('acid');
  });

  /**
   * The moment itself. The goblin acts after the wizard, so its next turn is
   * the one coming up — and the debt falls due when that turn *ends*, not when
   * it begins and not when the wizard's own turn comes round again.
   */
  it('lands at the end of the target\'s next turn, and not before', () => {
    let log = acidArrow(fight(), 40);
    const afterInitial = hp(log, 'goblin');

    // Wizard → goblin. The goblin's turn has begun; nothing is owed yet.
    log = advance(log, 't1');
    expect(hp(log, 'goblin')).toBe(afterInitial);
    expect(dueDamageOf(fold('seed', log))).toHaveLength(0);

    // Goblin → ogre. The goblin's turn just ended, so the acid arrives.
    log = advance(log, 't2');
    expect(hp(log, 'goblin')).toBeLessThan(afterInitial);

    // And the debt is discharged, not left to fire every turn afterwards.
    expect(Object.keys(fold('seed', log).scheduledDamage)).toHaveLength(0);
    const settled = hp(log, 'goblin');
    log = advance(log, 't3');
    log = advance(log, 't4');
    expect(hp(log, 'goblin')).toBe(settled);
  });

  it('schedules nothing on a miss, and deals nothing later', () => {
    let log = acidArrow(fight(), -40);
    expect(hp(log, 'goblin')).toBe(200);
    expect(Object.keys(fold('seed', log).scheduledDamage)).toHaveLength(0);

    log = advance(log, 't1');
    log = advance(log, 't2');
    expect(hp(log, 'goblin')).toBe(200);
  });

  /**
   * The debt is the target's, not the casting's. Acid Arrow is Instantaneous
   * and requires no Concentration — the acid is already on them — so nothing
   * that happens to the caster calls it off.
   */
  it('survives the caster dropping dead', () => {
    let log = acidArrow(fight(), 40);
    const afterInitial = hp(log, 'goblin');

    log = [...log, { type: 'creature-died', id: id('wizard'), cause: 'a falling pillar' }];
    expect(Object.keys(fold('seed', log).scheduledDamage)).toHaveLength(1);

    log = advance(log, 't1');
    log = advance(log, 't2');
    expect(hp(log, 'goblin')).toBeLessThan(afterInitial);
  });

  /** Invariant 9, stated as a test: the debt is state, so a reload keeps it. */
  it('survives a reload, because it is in the log rather than in a return value', () => {
    const log = acidArrow(fight(), 40);
    const reloaded = fold('seed', JSON.parse(JSON.stringify(log)) as GameEvent[]);
    expect(reloaded.scheduledDamage).toStrictEqual(fold('seed', log).scheduledDamage);
  });
});

describe('the boundary refuses to be passed with a debt outstanding', () => {
  /**
   * The same guarantee `pendingSaves` makes, for the same reason: an engine
   * that quietly drops a rule when a caller forgets is worse than one that
   * stops. Advancing without a generator cannot roll, so it refuses.
   */
  it('will not advance past the moment without something to roll with', () => {
    let log = acidArrow(fight(), 40);
    log = advance(log, 't1');

    // The goblin's turn is the one that ends here, and the acid is owed.
    const state = fold('seed', log);
    const advanced = resolveTurn(state, undefined, { commandId: 't2' });
    expect(isErr(advanced)).toBe(true);
    if (!advanced.ok) expect(advanced.code).toBe('damage_owed');
  });
});

describe('a fight that ends takes the debt with it', () => {
  /**
   * Turn-anchored timing is combat-scoped — CLAUDE.md argues it at length for
   * effects, and the same reasoning applies here with one difference worth
   * stating. `hasExpired` answers **true** for an anchor who has left the
   * fight, because an effect that can never end is worse than one that ends
   * early. Reading that same answer as "the debt is due" would fire the acid
   * the instant the last enemy dropped, which is the opposite of the intent:
   * the moment never arrived, so the damage never lands.
   */
  it('drops the schedule when combat ends, rather than collecting it', () => {
    let log = acidArrow(fight(), 40);
    const afterInitial = hp(log, 'goblin');

    log = [...log, { type: 'combat-ended' }];
    expect(Object.keys(fold('seed', log).scheduledDamage)).toHaveLength(0);
    expect(hp(log, 'goblin')).toBe(afterInitial);
  });

  it('drops the schedule when the target leaves the fight', () => {
    let log = acidArrow(fight(), 40);
    const afterInitial = hp(log, 'goblin');

    log = [...log, { type: 'combatant-removed', id: id('goblin') }];
    expect(Object.keys(fold('seed', log).scheduledDamage)).toHaveLength(0);
    expect(hp(log, 'goblin')).toBe(afterInitial);
  });
});

describe('the two spells scale differently, and the book says so', () => {
  /**
   * This is the detail a shared `damage` field would have flattened.
   *
   * Acid Arrow: "The damage (**both initial and later**) increases by 1d4 for
   * each spell slot level above 2."
   *
   * Vitriolic Sphere: "The **initial** damage increases by 2d4 for each spell
   * slot level above 4." — its 5d4 later hit does not grow at all.
   *
   * So the later damage carries its own scaling rather than inheriting the
   * initial one, and one of the two spells declares no per-slot growth.
   */
  it('grows Acid Arrow\'s later hit with the slot', () => {
    const base = acidArrow(fight(), 40);
    const upcast = acidArrow(fight(), 40, 4);

    const later = (log: readonly GameEvent[]): string =>
      Object.values(fold('seed', log).scheduledDamage)[0]?.notation ?? '';

    // 2d4 at level 2; +1d4 per level above, so 4d4 at level 4.
    expect(later(base)).toBe('2d4');
    expect(later(upcast)).toBe('4d4');
  });

  it('leaves Vitriolic Sphere\'s later hit alone however it is cast', () => {
    const cast = (slotLevel: number): GameEvent[] =>
      run(fight(), (s) =>
        resolveSpell(
          s,
          id('wizard'),
          {
            spellId: 'vitriolic-sphere',
            targets: [],
          at: { x: 165, y: 150, z: 0 },
            slotLevel,
            commandId: `sphere-${slotLevel}`,
          },
          supplyFor(s, -40),
        ),
      );

    const later = (log: readonly GameEvent[]): readonly string[] =>
      Object.values(fold('seed', log).scheduledDamage).map((d) => d.notation);

    // A failed save at both levels, and the later hit is 5d4 either time.
    expect(later(cast(4))).toContain('5d4');
    expect(later(cast(6))).toContain('5d4');
  });

  /** "On a successful save, a creature takes half the initial damage only." */
  it('schedules nothing for a creature that saved', () => {
    const log = run(fight(), (s) =>
      resolveSpell(
        s,
        id('wizard'),
        {
          spellId: 'vitriolic-sphere',
          targets: [],
          at: { x: 165, y: 150, z: 0 },
          slotLevel: 4,
          commandId: 'sphere-saved',
        },
        supplyFor(s, 40),
      ),
    );

    // Everyone caught made the save, so everyone took half the initial damage
    // and nobody owes a second hit.
    expect(Object.keys(fold('seed', log).scheduledDamage)).toHaveLength(0);
    expect(hp(log, 'goblin')).toBeLessThan(200);
  });
});

describe('retrying does not schedule or collect twice', () => {
  it('is a no-op on a repeated cast id', () => {
    const log = acidArrow(fight(), 40);
    const state = fold('seed', log);

    const again = unwrap(
      resolveSpell(
        state,
        id('wizard'),
        { spellId: 'acid-arrow', targets: [id('goblin')], slotLevel: 2, commandId: 'arrow-2-40' },
        supplyFor(state, 40),
      ),
      'retry',
    );
    expect(again.events).toEqual([]);
    expect(Object.keys(state.scheduledDamage)).toHaveLength(1);
  });

  it('is a no-op on a repeated turn id, once the acid has already landed', () => {
    let log = acidArrow(fight(), 40);
    log = advance(log, 't1');
    log = advance(log, 't2');

    const settled = hp(log, 'goblin');
    const state = fold('seed', log);
    const again = unwrap(resolveTurn(state, supplyFor(state, 0), { commandId: 't2' }), 'retry');
    expect(again.events).toEqual([]);
    expect(hp(log, 'goblin')).toBe(settled);
  });
});
