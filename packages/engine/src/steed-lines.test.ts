import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, type CharacterId } from '@ie/shared';
import { parseSaveLine, type Monster } from '@ie/srd';
import { extendContent } from './content.js';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { declaredCasting } from './spellcasting.js';
import type { SpellDefinition } from './spell-definitions.js';
import {
  addCreature,
  beginCombat,
  forcePrintedSave,
  raisePrintedLine,
  resolveSpell,
  resolveTurn,
  takePrintedHeal,
  takePrintedTeleport,
} from './commands.js';

/**
 * M-RISE: SRD Find Steed's Otherworldly Steed, the four lines its block prints
 * beside the Slam.
 *
 * > **Life Bond.** When you regain Hit Points from a level 1+ spell, the steed
 * > regains the same number of Hit Points if you're within 5 feet of it.
 * > **Fell Glare (Fiend Only; Recharges after a Long Rest).** _Wisdom Saving
 * > Throw:_ DC equals your spell save DC, one creature within 60 feet the
 * > steed can see. _Failure:_ The target has the Frightened condition until
 * > the end of your next turn.
 * > **Fey Step (Fey Only; Recharges after a Long Rest).** The steed teleports,
 * > along with its rider, to an unoccupied space of your choice up to 60 feet
 * > away from itself.
 * > **Healing Touch (Celestial Only; Recharges after a Long Rest).** One
 * > creature within 5 feet of the steed regains a number of Hit Points equal
 * > to 2d8 plus the spell's level.
 *
 * "You" is the Paladin who cast the spell, the type is the one they chose, and
 * "the spell's level" is the level the slot paid for.
 */

const id = (s: string) => asCharacterId(s);
const PAL = id('paladin');
const FOE = id('foe');

const GLARE = 'Fell Glare (Fiend Only; Recharges after a Long Rest)';
const FEY_STEP = 'Fey Step (Fey Only; Recharges after a Long Rest)';
const TOUCH = 'Healing Touch (Celestial Only; Recharges after a Long Rest)';

const sheet = (): CharacterSheet => ({
  // Level 5, Charisma 16: a spell attack modifier of 6 and a spell save DC of 14.
  level: 5,
  abilities: { str: 16, dex: 10, con: 14, int: 8, wis: 10, cha: 16 },
  skills: {},
  saveProficiencies: ['wis', 'cha'],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'cha',
  weaponProficiencies: ['simple', 'martial'],
});

const added = (who: CharacterId, side: string): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 44,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side,
});

const supply = (seed = 'steed') => ({
  issuer: createRollIssuer(`r-${seed}`),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

const SETUP: readonly GameEvent[] = [
  added(PAL, 'party'),
  added(FOE, 'foes'),
  {
    type: 'spellcasting-declared',
    id: PAL,
    spellcasting: declaredCasting({ ability: 'cha', prepared: ['find-steed', 'cure-wounds', 'vampiric-touch', 'test-mending'] }),
  },
  ...[1, 2, 3].map(
    (level): GameEvent => ({
      type: 'resource-pool-declared',
      id: PAL,
      pool: { key: `spell-slot:${level}`, label: `level ${level}`, max: 4, recovers: 'long-rest' },
    }),
  ),
  { type: 'scene-set', extent: { width: 600, depth: 600, height: 40 } },
  { type: 'landmark-added', name: 'the road', at: { x: 200, y: 200, z: 0 } },
  { type: 'creature-placed', id: PAL, placement: { from: { landmark: 'the road' }, feet: 0 } },
  { type: 'creature-placed', id: FOE, placement: { from: { creature: PAL }, feet: 30, bearing: 0 } },
];

const STEED = id('steed');

class Game {
  constructor(readonly events: GameEvent[] = [...SETUP]) {}

  get state(): GameState {
    return fold('seed', this.events);
  }

  push(more: readonly GameEvent[]): this {
    this.events.push(...more);
    return this;
  }

  /** Find Steed at a slot, the steed placed beside the Paladin, and a fight begun. */
  static withSteed(choice: string, slotLevel = 2, inCombat = true): Game {
    const g = new Game();
    const out = unwrap(
      resolveSpell(g.state, PAL, { spellId: 'find-steed', targets: [PAL], choice, slotLevel }, supply('cast')),
      'Find Steed',
    );
    g.push(out.events);
    const steed = Object.keys(g.state.creatures).find((k) => k !== PAL && k !== FOE) as CharacterId;
    // Renamed by reading it back, so the tests can say `STEED`.
    expect(steed).toBeDefined();
    g.push([{ type: 'creature-placed', id: steed, placement: { from: { creature: PAL }, feet: 5, bearing: 90, size: 'large' } }]);
    if (inCombat) {
      g.push(
        unwrap(
          beginCombat(g.state, [
            { id: PAL, initiative: 20, speed: 30 },
            { id: steed, initiative: 19, speed: 60 },
            { id: FOE, initiative: 10, speed: 30 },
          ]),
          'combat',
        ),
      );
    }
    g.steed = steed;
    return g;
  }

  steed: CharacterId = STEED;

  /** Advance the order to the steed's turn. */
  toSteedsTurn(): this {
    return this.push([{ type: 'turn-advanced' }]);
  }
}

describe('Fell Glare (Fiend Only)', () => {
  it('frightens a creature that fails until the end of the summoner’s next turn', () => {
    // Seeds until the foe fails, so the span is asserted on a real failure.
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
      const g = Game.withSteed('Fiend').toSteedsTurn();
      const out = unwrap(
        forcePrintedSave(g.state, g.steed, { line: GLARE, targets: [FOE] }, supply(seed)),
        'Fell Glare',
      );
      const outcome = out.outcomes[0]!;
      if (outcome.save?.success !== false) continue;
      // The Paladin's spell save DC, which the casting wrote over the mark.
      expect(outcome.save.dc).toBe(14);
      g.push(out.events);
      const foe = g.state.creatures[FOE]!;
      expect(foe.conditions.instances.map((one) => one.condition)).toContain('frightened');
      const timer = Object.values(g.state.timers).find(
        (one) => one.target.kind === 'condition' && one.target.on === FOE,
      );
      // "until the end of **your** next turn" — the Paladin's, not the steed's.
      expect(timer?.deadline).toMatchObject({ kind: 'turn-end', of: PAL });
      return;
    }
    throw new Error('no seed made the foe fail');
  });

  it('is refused to a steed whose caster chose another type, before anything is spent', () => {
    const g = Game.withSteed('Celestial').toSteedsTurn();
    const refused = forcePrintedSave(g.state, g.steed, { line: GLARE, targets: [FOE] }, supply());
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.code).toBe('wrong_form');
  });

  it('comes back after a Long Rest and not after a Short one', () => {
    const g = Game.withSteed('Fiend').toSteedsTurn();
    g.push(unwrap(forcePrintedSave(g.state, g.steed, { line: GLARE, targets: [FOE] }, supply()), 'glare').events);
    expect(g.state.creatures[g.steed]!.expendedLines).toContain(GLARE);

    g.push([{ type: 'resources-restored', id: g.steed, recovers: 'short-rest' }]);
    expect(g.state.creatures[g.steed]!.expendedLines).toContain(GLARE);

    g.push([{ type: 'resources-restored', id: g.steed, recovers: 'long-rest' }]);
    expect(g.state.creatures[g.steed]!.expendedLines).not.toContain(GLARE);
  });
});

describe('a span on the summoner’s turn', () => {
  it('is refused to a creature nobody summoned, before anything is rolled', () => {
    const text =
      '_Wisdom Saving Throw:_ DC 13, one creature within 60 feet the warden can see. _Failure:_ The target has the Frightened condition until the end of your next turn.';
    const warden: Monster = {
      ...SRD_CONTENT.monsterById('otherworldly-steed')!,
      id: 'glaring-warden',
      name: 'Glaring Warden',
      type: 'Fiend',
      traits: [],
      actions: [],
      bonusActions: [{ name: 'Glare', text, save: parseSaveLine(text)! }],
    };
    const content = unwrap(extendContent(SRD_CONTENT, { monsters: [warden] }), 'the warden');
    const events: GameEvent[] = [...SETUP];
    events.push(...unwrap(addCreature(fold('seed', events), content, id('warden'), 'glaring-warden'), 'warden').events);
    events.push({ type: 'creature-placed', id: id('warden'), placement: { from: { creature: PAL }, feet: 10, bearing: 90, size: 'large' } });
    events.push(
      ...unwrap(
        beginCombat(fold('seed', events), [
          { id: id('warden'), initiative: 20, speed: 60 },
          { id: FOE, initiative: 10, speed: 30 },
          { id: PAL, initiative: 5, speed: 30 },
        ]),
        'combat',
      ),
    );
    const refused = forcePrintedSave(fold('seed', events), id('warden'), { line: 'Glare', targets: [FOE] }, { ...supply(), content });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.code).toBe('no_summoner');
  });
});

describe('Fey Step (Fey Only)', () => {
  it('teleports the steed and its rider up to 60 feet, with no sight clause to meet', () => {
    const g = Game.withSteed('Fey').toSteedsTurn();
    g.push([{ type: 'mounted', rider: PAL, mount: g.steed, willing: true }]);
    const before = g.state.scene!.positions[g.steed]!;
    const out = unwrap(
      takePrintedTeleport(g.state, g.steed, {
        line: FEY_STEP,
        to: { from: { creature: g.steed }, feet: 55, bearing: 180 },
      }),
      'Fey Step',
    );
    g.push(out.events);
    const after = g.state.scene!.positions[g.steed]!;
    expect(after).not.toEqual(before);
    // The rider goes with the mount.
    const rider = g.state.scene!.positions[PAL]!;
    expect([rider.x, rider.y]).toEqual([after.x, after.y]);
    expect(g.state.creatures[g.steed]!.expendedLines).toContain(FEY_STEP);
  });

  it('refuses a space beyond 60 feet', () => {
    const g = Game.withSteed('Fey').toSteedsTurn();
    const refused = takePrintedTeleport(g.state, g.steed, {
      line: FEY_STEP,
      to: { from: { creature: g.steed }, feet: 90, bearing: 180 },
    });
    expect(refused.ok).toBe(false);
  });

  it('is refused to a Fiend steed', () => {
    const g = Game.withSteed('Fiend').toSteedsTurn();
    const refused = takePrintedTeleport(g.state, g.steed, {
      line: FEY_STEP,
      to: { from: { creature: g.steed }, feet: 20, bearing: 180 },
    });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.code).toBe('wrong_form');
  });
});

describe('Healing Touch (Celestial Only)', () => {
  const wounded = (g: Game, who: CharacterId, amount: number): Game =>
    g.push([{ type: 'damage-taken', id: who, amount }]);

  it('heals one creature within 5 feet 2d8 plus the slot level, as a Bonus Action', () => {
    const g = wounded(Game.withSteed('Celestial', 3).toSteedsTurn(), PAL, 30);
    const before = g.state.creatures[PAL]!.vitals.hp;
    const out = unwrap(
      takePrintedHeal(g.state, g.steed, { line: TOUCH, target: PAL }, supply('touch')),
      'Healing Touch',
    );
    const roll = out.events.find((e) => e.type === 'roll-recorded');
    expect(roll?.type).toBe('roll-recorded');
    if (roll?.type !== 'roll-recorded') return;
    // The dice, and the slot level of 3 the casting wrote over the mark.
    expect(roll.total - roll.natural).toBe(3);
    expect(roll.natural).toBeGreaterThanOrEqual(2);
    expect(roll.natural).toBeLessThanOrEqual(16);
    g.push(out.events);
    expect(g.state.creatures[PAL]!.vitals.hp - before).toBe(roll.total);
    expect(out.events.some((e) => e.type === 'bonus-action-spent' && e.id === g.steed)).toBe(true);
    expect(g.state.creatures[g.steed]!.expendedLines).toContain(TOUCH);
    // Spent until a Long Rest.
    const again = takePrintedHeal(g.state, g.steed, { line: TOUCH, target: PAL }, supply('again'));
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.code).toBe('line_expended');
  });

  it('refuses a creature beyond 5 feet', () => {
    const g = wounded(Game.withSteed('Celestial').toSteedsTurn(), FOE, 10);
    const refused = takePrintedHeal(g.state, g.steed, { line: TOUCH, target: FOE }, supply());
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.code).toBe('out_of_range');
  });

  it('asks who, rather than choosing', () => {
    const g = Game.withSteed('Celestial').toSteedsTurn();
    const asked = takePrintedHeal(g.state, g.steed, { line: TOUCH }, supply());
    expect(asked.ok).toBe(false);
    if (!asked.ok) {
      expect(asked.kind).toBe('needs-context');
      expect(asked.code).toBe('undeclared_target');
    }
  });

  it('is a door for a heal and nothing else', () => {
    const g = Game.withSteed('Fey').toSteedsTurn();
    const notAHeal = takePrintedHeal(g.state, g.steed, { line: FEY_STEP, target: PAL }, supply());
    expect(notAHeal.ok).toBe(false);
    if (!notAHeal.ok) expect(notAHeal.code).toBe('line_states_no_heal');
  });

  it('is no door for raising either', () => {
    const g = Game.withSteed('Celestial').toSteedsTurn();
    const refused = raisePrintedLine(g.state, g.steed, { line: TOUCH, corpse: FOE, into: id('risen') }, supply());
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.code).toBe('line_states_no_raise');
  });

  it('is refused to a Fey steed', () => {
    const g = wounded(Game.withSteed('Fey').toSteedsTurn(), PAL, 10);
    const refused = takePrintedHeal(g.state, g.steed, { line: TOUCH, target: PAL }, supply());
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.code).toBe('wrong_form');
  });

  it('is prose on a steed nobody cast, because the spell’s level was never supplied', () => {
    const base = fold('seed', SETUP);
    const arrival = unwrap(addCreature(base, SRD_CONTENT, id('stray'), 'otherworldly-steed'), 'stray');
    const state = fold('seed', [...SETUP, ...arrival.events]);
    expect(arrival.unverified.some((gap) => gap.includes('Healing Touch'))).toBe(true);
    const line = state.creatures[id('stray')]!.sheet.stated?.bonusActions?.find((one) => one.name === TOUCH);
    expect(line?.heals).toBeUndefined();
  });
});

describe('Life Bond', () => {
  const wound = (g: Game, amount: number): Game =>
    g.push([
      { type: 'damage-taken', id: PAL, amount },
      { type: 'damage-taken', id: g.steed, amount },
    ]);

  it('heals the steed what a level 1+ spell heals its summoner within 5 feet', () => {
    const g = wound(Game.withSteed('Fey', 2, false), 20);
    const palBefore = g.state.creatures[PAL]!.vitals.hp;
    const steedBefore = g.state.creatures[g.steed]!.vitals.hp;
    const out = unwrap(
      resolveSpell(g.state, PAL, { spellId: 'cure-wounds', targets: [PAL], slotLevel: 1 }, supply('cure')),
      'Cure Wounds',
    );
    g.push(out.events);
    const regained = g.state.creatures[PAL]!.vitals.hp - palBefore;
    expect(regained).toBeGreaterThan(0);
    expect(g.state.creatures[g.steed]!.vitals.hp - steedBefore).toBe(regained);
  });

  it('shares nothing when the summoner is further than 5 feet from the steed', () => {
    const g = wound(Game.withSteed('Fey', 2, false), 20);
    g.push([
      { type: 'creature-moved', id: g.steed, placement: { from: { creature: PAL }, feet: 20, bearing: 180 }, forced: true },
    ]);
    const steedBefore = g.state.creatures[g.steed]!.vitals.hp;
    g.push(
      unwrap(
        resolveSpell(g.state, PAL, { spellId: 'cure-wounds', targets: [PAL], slotLevel: 1 }, supply('cure')),
        'Cure Wounds',
      ).events,
    );
    expect(g.state.creatures[g.steed]!.vitals.hp).toBe(steedBefore);
  });

  it('shares nothing from a spell that heals somebody else', () => {
    const g = wound(Game.withSteed('Fey', 2, false), 20);
    g.push([{ type: 'damage-taken', id: FOE, amount: 10 }]);
    g.push([
      { type: 'creature-moved', id: FOE, placement: { from: { creature: PAL }, feet: 5, bearing: 270 }, forced: true },
    ]);
    const steedBefore = g.state.creatures[g.steed]!.vitals.hp;
    g.push(
      unwrap(
        resolveSpell(g.state, PAL, { spellId: 'cure-wounds', targets: [FOE], slotLevel: 1 }, supply('cure')),
        'Cure Wounds on the foe',
      ).events,
    );
    expect(g.state.creatures[g.steed]!.vitals.hp).toBe(steedBefore);
  });

  it('shares what a spell’s drain gives back — SRD Vampiric Touch, a level 3 spell', () => {
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
      const g = wound(Game.withSteed('Fey', 2, false), 20);
      g.push([{ type: 'creature-moved', id: FOE, placement: { from: { creature: PAL }, feet: 5, bearing: 270 }, forced: true }]);
      const palBefore = g.state.creatures[PAL]!.vitals.hp;
      const steedBefore = g.state.creatures[g.steed]!.vitals.hp;
      g.push(
        unwrap(
          resolveSpell(g.state, PAL, { spellId: 'vampiric-touch', targets: [FOE], slotLevel: 3 }, supply(seed)),
          'Vampiric Touch',
        ).events,
      );
      const regained = g.state.creatures[PAL]!.vitals.hp - palBefore;
      if (regained <= 0) continue;
      expect(g.state.creatures[g.steed]!.vitals.hp - steedBefore).toBe(regained);
      return;
    }
    throw new Error('no seed landed the touch');
  });

  it('shares a running spell’s payout at the summoner’s turn boundary', () => {
    const MENDING: SpellDefinition = {
      id: 'test-mending',
      name: 'Test Mending',
      level: 1,
      school: 'transmutation',
      castingTime: 'action',
      range: { kind: 'touch' },
      targets: { count: 1, self: true },
      concentration: true,
      durationSeconds: 60,
      effects: [{ kind: 'turn-payout', at: 'start-of-turn', payout: 'healing', flat: 1 }],
    };
    const content = unwrap(extendContent(SRD_CONTENT, { spells: [MENDING] }), 'mending');
    const withMending = (seed: string) => ({ ...supply(seed), content });
    const g = wound(Game.withSteed('Fey'), 20);
    g.push(
      unwrap(
        resolveSpell(g.state, PAL, { spellId: 'test-mending', targets: [PAL], slotLevel: 1 }, withMending('m')),
        'Test Mending',
      ).events,
    );
    const steedBefore = g.state.creatures[g.steed]!.vitals.hp;
    // The Paladin's turn ends, the steed's, the foe's; the Paladin's begins.
    for (const seed of ['t1', 't2', 't3']) {
      g.push(unwrap(resolveTurn(g.state, withMending(seed)), seed).events);
    }
    expect(g.state.creatures[g.steed]!.vitals.hp - steedBefore).toBe(1);
  });
});
