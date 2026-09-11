import { describe, expect, it } from 'vitest';
import { asCharacterId, expect as unwrap, type CharacterId } from '@ie/shared';
import { bonusesFor } from './bonuses.js';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { spellSlotKey } from './resources.js';
import { endConcentration, resolveSpell } from './commands.js';

/**
 * A bonus that later rolls read, and hit points that are not hit points.
 *
 * The rule these two share, and the reason they are one batch: **a modifier
 * somebody has to remember is a modifier a character silently stops having.**
 * Bless lives on the creature and every save the engine rolls picks it up,
 * exactly as Alert's Initiative bonus does — no caller passes it, and a caller
 * who passes it anyway does not apply it twice.
 *
 * The other half is that it ends when the spell does. Bless is linked to its
 * casting through the same source string conditions use, so a Cleric losing
 * Concentration takes the bonus off everyone it was on, and off nobody else.
 */

const id = (s: string) => asCharacterId(s);
const CLERIC = id('cleric');
const ALLY = id('ally');
const FOE = id('foe');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 16, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'wis',
  ...over,
});

const added = (who: CharacterId): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 60,
  diesAtZero: false,
  creatureType: 'Humanoid',
});

const SETUP: readonly GameEvent[] = [
  added(CLERIC),
  added(ALLY),
  added(FOE),
  ...[1, 2, 3].map(
    (level): GameEvent => ({
      type: 'resource-pool-declared',
      id: CLERIC,
      pool: {
        key: spellSlotKey(level),
        label: `level ${level} spell slot`,
        max: 4,
        recovers: 'long-rest',
      },
    }),
  ),
  { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
  { type: 'landmark-added', name: 'the shrine', at: { x: 50, y: 50, z: 0 } },
  { type: 'creature-placed', id: CLERIC, placement: { from: { landmark: 'the shrine' }, feet: 0 } },
  { type: 'creature-placed', id: ALLY, placement: { from: { creature: CLERIC }, feet: 5, bearing: 0 } },
  { type: 'creature-placed', id: FOE, placement: { from: { creature: CLERIC }, feet: 10, bearing: 90 } },
  { type: 'sight-declared', from: CLERIC, to: ALLY, seen: true },
  { type: 'sight-declared', from: CLERIC, to: FOE, seen: true },
  {
    type: 'spellcasting-declared',
    id: CLERIC,
    spellcasting: {
      ability: 'wis',
      cantrips: ['guidance', 'sacred-flame'],
      prepared: ['bane', 'bless', 'false-life', 'inflict-wounds'],
      granted: [],
    },
  },
];

const base = (): GameState => fold('seed', SETUP);

const supply = (seed: string, bonus?: number) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  ...(bonus === undefined ? {} : { bonuses: [{ source: 'forced', flat: bonus }] }),
});

/**
 * Cast against a log, and hand back the longer log.
 *
 * `fold` folds a whole log from the seed — that is the whole point of it — so
 * a test that wants successive casts carries the log rather than trying to
 * apply events onto a state it already has.
 */
const cast = (
  log: readonly GameEvent[],
  request: Parameters<typeof resolveSpell>[2],
  seed = 'cast',
  bonus?: number,
): { events: readonly GameEvent[]; log: readonly GameEvent[]; state: GameState } => {
  const out = unwrap(resolveSpell(fold('seed', log), CLERIC, request, supply(seed, bonus)), 'cast');
  if (out.kind !== 'resolved') throw new Error('expected a resolved cast');
  const next = [...log, ...out.events];
  return { events: out.events, log: next, state: fold('seed', next) };
};

describe('a blessing lands on the creature, not in the caller’s head', () => {
  it('puts the bonus on everyone it was cast on', () => {
    const log = [...SETUP];
    const out = cast(SETUP, { spellId: 'bless', targets: [CLERIC, ALLY], slotLevel: 1 });
    const after = fold('seed', [...log, ...out.events]);

    for (const who of [CLERIC, ALLY]) {
      const held = after.creatures[who]?.bonuses ?? [];
      expect(held).toHaveLength(1);
      expect(held[0]?.bonus.source).toBe('Bless');
      expect(held[0]?.direction).toBe('add');
      expect(held[0]?.applies).toContain('save');
      expect(held[0]?.applies).toContain('attack');
    }
    // And on nobody it was not cast on.
    expect(after.creatures.foe?.bonuses).toEqual([]);
  });

  /** SRD Bless: "adds 1d4 to the attack roll or save." */
  it('is read by a saving throw the engine rolls, without anyone passing it', () => {
    const blessed = cast(SETUP, { spellId: 'bless', targets: [FOE], slotLevel: 1 });

    // The same spell, same seed, against a blessed target and an unblessed
    // one. The blessed save is higher by whatever the d4 came up.
    const plain = unwrap(
      resolveSpell(
        base(),
        CLERIC,
        { spellId: 'sacred-flame', targets: [FOE] },
        supply('same'),
      ),
      'plain',
    );
    const helped = unwrap(
      resolveSpell(
        blessed.state,
        CLERIC,
        { spellId: 'sacred-flame', targets: [FOE] },
        supply('same'),
      ),
      'helped',
    );
    if (plain.kind !== 'resolved' || helped.kind !== 'resolved') throw new Error('unresolved');

    const before = plain.outcomes[0]?.save?.total ?? 0;
    const after = helped.outcomes[0]?.save?.total ?? 0;
    expect(after).toBeGreaterThan(before);
    expect(after - before).toBeGreaterThanOrEqual(1);
    expect(after - before).toBeLessThanOrEqual(4);
  });

  /** SRD Bane: "must subtract 1d4", which is Bless with the sign flipped. */
  it('subtracts for Bane where it adds for Bless', () => {
    const baned = cast(SETUP, { spellId: 'bane', targets: [FOE], slotLevel: 1 }, 'bane', -40);
    const held = baned.state.creatures.foe?.bonuses ?? [];
    expect(held[0]?.direction).toBe('subtract');

    const plain = unwrap(
      resolveSpell(
        base(),
        CLERIC,
        { spellId: 'sacred-flame', targets: [FOE] },
        supply('same'),
      ),
      'plain',
    );
    const hindered = unwrap(
      resolveSpell(
        baned.state,
        CLERIC,
        { spellId: 'sacred-flame', targets: [FOE] },
        supply('same'),
      ),
      'hindered',
    );
    if (plain.kind !== 'resolved' || hindered.kind !== 'resolved') throw new Error('unresolved');
    expect(hindered.outcomes[0]?.save?.total ?? 0).toBeLessThan(plain.outcomes[0]?.save?.total ?? 0);
  });

  /** Bane asks for a save first; a target that makes it is untouched. */
  it('lands Bane only on a creature that failed its save', () => {
    const saved = cast(SETUP, { spellId: 'bane', targets: [FOE], slotLevel: 1 }, 'bane', 40);
    expect(saved.state.creatures.foe?.bonuses).toEqual([]);

    const failed = cast(SETUP, { spellId: 'bane', targets: [FOE], slotLevel: 1 }, 'bane', -40);
    expect(failed.state.creatures.foe?.bonuses).toHaveLength(1);
  });

  /** Bless asks nobody: you bless your friends and they do not resist. */
  it('lands Bless with no save at all', () => {
    const out = cast(SETUP, { spellId: 'bless', targets: [ALLY], slotLevel: 1 });
    expect(out.events.filter((e) => e.type === 'roll-recorded')).toHaveLength(0);
  });
});

describe('a bonus ends when its spell does', () => {
  it('comes off everyone when the caster stops concentrating', () => {
    const log = [...SETUP];
    const blessed = cast(SETUP, { spellId: 'bless', targets: [CLERIC, ALLY], slotLevel: 1 });
    const running = fold('seed', [...log, ...blessed.events]);
    expect(running.creatures.ally?.bonuses).toHaveLength(1);

    const ended = unwrap(endConcentration(running, CLERIC, 'voluntary'), 'end');
    const after = fold('seed', [...log, ...blessed.events, ...ended]);

    expect(after.creatures.ally?.bonuses).toEqual([]);
    expect(after.creatures.cleric?.bonuses).toEqual([]);
    expect(after.creatures.cleric?.concentration).toBeNull();
  });

  /**
   * SRD: "You lose Concentration on an effect the moment you start casting a
   * spell that requires Concentration." Bane replaces Bless, and the blessing
   * goes with it.
   */
  it('is replaced when the caster starts a second Concentration spell', () => {
    const blessed = cast(SETUP, { spellId: 'bless', targets: [ALLY], slotLevel: 1 });
    const baned = cast(blessed.log, { spellId: 'bane', targets: [FOE], slotLevel: 1 }, 'bane', -40);
    const after = baned.state;

    expect(after.creatures.ally?.bonuses).toEqual([]);
    expect(after.creatures.foe?.bonuses).toHaveLength(1);
  });

  it('survives a round trip through JSON with the rest of the state', () => {
    const log = [...SETUP];
    const blessed = cast(SETUP, { spellId: 'bless', targets: [ALLY], slotLevel: 1 });
    const state = fold('seed', [...log, ...blessed.events]);
    const revived = JSON.parse(JSON.stringify(state)) as GameState;
    expect(revived).toEqual(state);
    expect(revived.creatures.ally?.bonuses[0]?.bonus.source).toBe('Bless');
  });
});

describe('bonusesFor answers with modifiers, not a sign convention', () => {
  it('hands back an addition for Bless and a subtraction for Bane', () => {
    const plus = bonusesFor(
      [
        {
          source: 'Bless#cast:1',
          bonus: { source: 'Bless', dice: '1d4' },
          applies: ['save'],
          direction: 'add',
        },
      ],
      'save',
    );
    expect(plus[0]?.direction).toBeUndefined();

    const minus = bonusesFor(
      [
        {
          source: 'Bane#cast:1',
          bonus: { source: 'Bane', dice: '1d4' },
          applies: ['save'],
          direction: 'subtract',
        },
      ],
      'save',
    );
    expect(minus[0]?.direction).toBe('subtract');
  });

  it('leaves out a bonus that does not apply to this kind of roll', () => {
    const held = [
      {
        source: 'Guidance#cast:1',
        bonus: { source: 'Guidance', dice: '1d4' },
        applies: ['ability-check'] as const,
        direction: 'add' as const,
      },
    ];
    expect(bonusesFor(held, 'save')).toEqual([]);
    expect(bonusesFor(held, 'ability-check')).toHaveLength(1);
  });
});

describe('Temporary Hit Points sit beside hit points, never in them', () => {
  /** SRD False Life: "You gain 2d4 + 4 Temporary Hit Points." */
  it('grants the dice plus the printed flat amount', () => {
    const out = cast(SETUP, { spellId: 'false-life', targets: [CLERIC], slotLevel: 1 });
    const after = fold('seed', [...SETUP, ...out.events]);

    const temporary = after.creatures.cleric?.vitals.temporaryHp ?? 0;
    expect(temporary).toBeGreaterThanOrEqual(6);
    expect(temporary).toBeLessThanOrEqual(12);
    // And the hit points themselves are untouched: these are not healing.
    expect(after.creatures.cleric?.vitals.hp).toBe(60);
  });

  /**
   * SRD False Life upcast: "You gain 5 additional Temporary Hit Points for
   * each spell slot level above 1" — five flat, and no extra dice at all.
   */
  it('adds a flat five a level and rolls no more dice for it', () => {
    const low = cast(SETUP, { spellId: 'false-life', targets: [CLERIC], slotLevel: 1 }, 'fl');
    const high = cast(SETUP, { spellId: 'false-life', targets: [CLERIC], slotLevel: 3 }, 'fl');

    const one = fold('seed', [...SETUP, ...low.events]).creatures.cleric?.vitals.temporaryHp ?? 0;
    const three = fold('seed', [...SETUP, ...high.events]).creatures.cleric?.vitals.temporaryHp ?? 0;
    expect(three - one).toBe(10);
  });

  /** SRD: Temporary Hit Points do not stack; the larger set is kept. */
  it('keeps the larger set rather than adding them up', () => {
    const first = cast(SETUP, { spellId: 'false-life', targets: [CLERIC], slotLevel: 3 }, 'a');
    const before = fold('seed', [...SETUP, ...first.events]).creatures.cleric?.vitals.temporaryHp ?? 0;

    const second = cast(first.log, { spellId: 'false-life', targets: [CLERIC], slotLevel: 1 }, 'b');
    const after =
      fold('seed', [...SETUP, ...first.events, ...second.events]).creatures.cleric?.vitals
        .temporaryHp ?? 0;

    expect(after).toBe(before);
  });
});
