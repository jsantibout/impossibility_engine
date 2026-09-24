/**
 * The moment a creature reaches 0 Hit Points, from three sides.
 *
 * **A drop that is not damage.** SRD Sea Hag: "If the target has 20 Hit Points
 * or fewer, **it drops to 0 Hit Points**." Damage is the wrong instrument and
 * the difference is observable — Temporary Hit Points would soak it, a
 * Concentration save would answer it, and neither is in the sentence — so
 * `hit-points-dropped-to-zero` is its own event, and nothing that watches
 * `damage-taken` fires on it.
 *
 * **A failure that branches on the target's Hit Points.** The same line's
 * other arm: "Otherwise, the target takes 13 (3d8) Psychic damage." Which arm
 * happens is decided by a number the engine already holds, read before
 * anything is rolled, and the dice are thrown on one arm only. SRD Incubus'
 * Nightmare prints the same branch over an Unconscious hour.
 *
 * **A feature that watches an enemy fall.** SRD Dark One's Blessing: "When you
 * reduce an enemy to 0 Hit Points, you gain Temporary Hit Points equal to your
 * Charisma modifier plus your Warlock level (minimum of 1). You also gain this
 * benefit if someone else reduces an enemy within 10 feet of you to 0 Hit
 * Points." Both halves are read off the world the blow landed in: the sides
 * the table declared, and the distance the scene answers.
 */

import { SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import { asCharacterId, type CharacterId, type Result } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import {
  addCreature,
  addSceneLandmark,
  beginCombat,
  declareCreatureSide,
  forcePrintedSave,
  grantTemporaryHpTo,
  placeCreatureInScene,
  resolveAttack,
  resolveDamage,
  resolveSpell,
  resolveTurn,
  setScene,
  settleDamage,
} from './commands.js';
import { createCharacter, type CharacterChoices } from './creation.js';
import { createRng, type Rng } from './dice.js';
import { applyEvent, fold, type GameEvent, type GameState } from './events.js';
import { createRollIssuer } from './rolls.js';
import { declaredCasting } from './spellcasting.js';

const id = (s: string) => asCharacterId(s);
const FOE = id('foe');
const BREN = id('bren');
const WARLOCK = id('kael');
const ALLY = id('rook');
const ADJACENT = id('grish');
const NEAR = id('snik');
const FAR = id('pip');
const THIEF = id('nyx');

/** A Warlock 3 of the Fiend with Charisma 16: the modifier is +3 and the level is 3. */
const kael = (): CharacterChoices => ({
  name: 'Kael',
  classId: 'warlock',
  level: 3,
  speciesId: 'human',
  // Acolyte, because it is one of the backgrounds that offers Charisma: 15
  // from the array and 1 from the background is the 16 the fixture is about.
  backgroundId: 'acolyte',
  abilities: {
    method: 'standard-array',
    assignment: { str: 13, dex: 14, con: 12, int: 10, wis: 8, cha: 15 },
  },
  abilityIncreases: { wis: 2, cha: 1 },
  classSkills: ['arcana', 'deception'],
  languages: ['Draconic', 'Goblin'],
  alignment: 'Neutral Evil',
  subclassId: 'fiend-patron',
  cantrips: ['eldritch-blast', 'chill-touch'],
  spellbook: [],
  preparedSpells: ['hex', 'hellish-rebuke', 'hold-person', 'mind-spike'],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: ['leather-armor'],
  hitPoints: { method: 'fixed' },
  featureChoices: { 'human:skillful': ['perception'] },
  feats: {
    'acolyte:magic-initiate-cleric': {
      featId: 'magic-initiate',
      spellList: 'cleric',
      spellcastingAbility: 'wis',
      cantrips: ['guidance', 'sacred-flame'],
      levelOneSpell: 'bless',
    },
    'human:versatile': { featId: 'alert' },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
});

/**
 * A Rogue 5, who is here for one sentence: SRD Uncanny Dodge holds a blow open
 * while its target decides. Nothing else in this file opens a damage window,
 * and the held road is the one whose event order this file is about.
 */
const nyx = (): CharacterChoices => ({
  name: 'Nyx',
  classId: 'rogue',
  level: 5,
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 8, dex: 15, con: 13, int: 14, wis: 12, cha: 10 },
  },
  abilityIncreases: { con: 2, int: 1 },
  classSkills: ['stealth', 'sleight-of-hand', 'acrobatics', 'investigation'],
  languages: ['Dwarvish', 'Orc'],
  alignment: 'Neutral',
  subclassId: 'thief',
  cantrips: [],
  spellbook: [],
  preparedSpells: [],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: {
    'human:skillful': ['perception'],
    'rogue:expertise': ['stealth', 'sleight-of-hand'],
  },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int',
      cantrips: ['mage-hand', 'light'],
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId: 'alert' },
    'rogue:ability-score-improvement': { featId: 'savage-attacker' },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
});

const supply = (seed: string) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

const unwrap = <T>(result: Result<T>, label = 'ok'): T => {
  if (!result.ok) throw new Error(`${label}: ${result.code} — ${result.reason}`);
  return result.value;
};

const after = (state: GameState, events: readonly GameEvent[]): GameState =>
  events.reduce((s, e) => applyEvent(s, e), state);

/** A Wisdom low enough that most seeds fail the DC 11 and DC 15 the blocks print. */
const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 5,
  abilities: { str: 14, dex: 12, con: 12, int: 10, wis: 1, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'wis',
  weaponProficiencies: ['simple'],
  ...over,
});

const SEEDS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'];

/**
 * A monster and one victim, whose Hit Point maximum is the whole point: the
 * branch is decided on the number, so the fixture states it rather than
 * whittling a character down to it.
 */
function facing(
  monster: string,
  hitPoints: number,
  options: { readonly concentrating?: boolean } = {},
): { readonly state: GameState; readonly log: readonly GameEvent[] } {
  const log: GameEvent[] = [];
  let state = fold('the-glare', []);
  const land = (events: readonly GameEvent[]): void => {
    log.push(...events);
    state = after(state, events);
  };
  const step = (result: Result<readonly GameEvent[]>, label: string): void =>
    land(unwrap(result, label));

  land(unwrap(addCreature(state, SRD_CONTENT, FOE, monster), monster).events);
  land([
    {
      type: 'creature-added',
      id: BREN,
      name: 'Bren',
      sheet: sheet(),
      maxHp: hitPoints,
      // A character rather than a monster: the whole question is what a
      // creature the rules leave Unconscious does at 0.
      diesAtZero: false,
      creatureType: 'Humanoid',
    },
  ]);
  if (options.concentrating === true) {
    land([
      {
        type: 'spellcasting-declared',
        id: BREN,
        spellcasting: declaredCasting({ ability: 'wis', prepared: ['shield-of-faith'] }),
      },
      {
        type: 'resource-pool-declared',
        id: BREN,
        pool: { key: 'spell-slot:1', label: 'level 1', max: 2, recovers: 'long-rest' },
      },
    ]);
  }
  step(setScene(state, { width: 120, depth: 80, height: 20 }), 'scene');
  step(addSceneLandmark(state, 'the shore', { x: 40, y: 40, z: 0 }), 'shore');
  step(placeCreatureInScene(state, BREN, { from: { landmark: 'the shore' }, feet: 0 }), 'place Bren');
  step(placeCreatureInScene(state, FOE, { from: { creature: BREN }, feet: 5, bearing: 90 }), 'place foe');
  step(declareCreatureSide(state, BREN, 'party'), 'Bren’s side');
  step(declareCreatureSide(state, FOE, 'wild'), 'the foe’s side');
  if (options.concentrating === true) {
    // The victim's own Concentration, so the control below has one to break.
    // Cast **before** the fight starts: outside combat there is no turn to
    // take it out of, which is the reading every casting door already takes.
    const cast = unwrap(
      resolveSpell(state, BREN, { spellId: 'shield-of-faith', targets: [BREN], slotLevel: 1 }, supply('faith')),
      'shield of faith',
    );
    land(cast.events);
  }
  step(
    beginCombat(state, [
      { id: FOE, initiative: 20, speed: 30 },
      { id: BREN, initiative: 1, speed: 30 },
    ]),
    'combat',
  );
  return { state, log };
}

/** Force one line under one seed, and report the world it left. */
function force(
  monster: string,
  line: string,
  hitPoints: number,
  seed: string,
  options: { readonly concentrating?: boolean; readonly temporaryHp?: number } = {},
) {
  const table = facing(monster, hitPoints, options);
  let state = table.state;
  if (options.temporaryHp !== undefined) {
    const granted = unwrap(grantTemporaryHpTo(state, BREN, options.temporaryHp), 'temporary hit points');
    state = after(state, granted);
  }
  const out = unwrap(
    forcePrintedSave(state, FOE, { line, targets: [BREN], commandId: `use-${seed}` }, supply(seed)),
    `${monster} uses ${line}`,
  );
  return { before: state, out, state: after(state, out.events) };
}

/** The first seed on which the save failed, so the failure arm can be driven. */
function onAFailure(
  monster: string,
  line: string,
  hitPoints: number,
  options: { readonly concentrating?: boolean; readonly temporaryHp?: number } = {},
) {
  for (const seed of SEEDS) {
    const run = force(monster, line, hitPoints, seed, options);
    if (!run.out.outcomes[0]!.save.success) return run;
  }
  throw new Error(`no seed failed ${monster}'s ${line}`);
}

const conditionsOn = (state: GameState, who: CharacterId): readonly string[] =>
  state.creatures[who]?.conditions.conditions ?? [];

describe('a printed failure that branches on the target’s Hit Points', () => {
  const GLARE = 'Death Glare (Recharge 5–6)';

  it('drops a creature at the ceiling to 0 without hurting it', () => {
    const { out, state } = onAFailure('sea-hag', GLARE, 20, { temporaryHp: 7 });

    // The whole of the drop, as one event that is not damage.
    expect(out.events.filter((e) => e.type === 'hit-points-dropped-to-zero')).toEqual([
      { type: 'hit-points-dropped-to-zero', id: BREN, source: GLARE },
    ]);
    expect(state.creatures[BREN]!.vitals.hp).toBe(0);
    expect(state.creatures[BREN]!.vitals.dead).toBe(false);
    expect(conditionsOn(state, BREN)).toContain('unconscious');

    // **The Temporary Hit Points are untouched.** The book says the creature
    // drops, not that it is hurt, and a pool that soaked this would have made
    // the sentence about a number nobody printed.
    expect(state.creatures[BREN]!.vitals.temporaryHp).toBe(7);

    // No damage anywhere: not an amount, not a die, not a total on the outcome.
    expect(out.events.some((e) => e.type === 'damage-taken')).toBe(false);
    expect(out.events.some((e) => e.type === 'damage-dice-recorded')).toBe(false);
    expect(out.outcomes[0]!.damage).toBe(0);
  });

  it('raises no Concentration save on the drop, where a blow would', () => {
    const { out, state } = onAFailure('sea-hag', GLARE, 20, { concentrating: true });

    // The spell is over — a creature at 0 is Unconscious and therefore
    // Incapacitated, which the fold's derived pass reads — but **nothing was
    // rolled for it**: no save, and no ending that blames one.
    expect(state.creatures[BREN]!.concentration ?? null).toBeNull();
    expect(out.outcomes[0]!.concentration).toEqual({ kind: 'none' });
    expect(
      out.events.some((e) => e.type === 'roll-recorded' && e.label.includes('maintain')),
    ).toBe(false);
    expect(
      out.events.some((e) => e.type === 'concentration-ended' && e.reason === 'failed-save'),
    ).toBe(false);
  });

  it('deals the line’s dice to a creature over the ceiling, and drops nobody', () => {
    const { out, state } = onAFailure('sea-hag', GLARE, 21);

    expect(out.events.some((e) => e.type === 'hit-points-dropped-to-zero')).toBe(false);
    const [dice] = out.events.filter((e) => e.type === 'damage-dice-recorded');
    expect(dice).toBeDefined();
    // 3d8 Psychic, with the faces in the log.
    const rolled = (dice as { components: readonly { type: string; dice: readonly unknown[] }[] })
      .components;
    expect(rolled.flatMap((c) => c.dice)).toHaveLength(3);
    expect(rolled.every((c) => c.type === 'psychic')).toBe(true);
    expect(out.outcomes[0]!.damage).toBeGreaterThan(0);
    expect(state.creatures[BREN]!.vitals.hp).toBeLessThan(21);
  });

  it('raises the Concentration save that ordinary damage puts at risk', () => {
    // The control the drop is measured against: the same creature, the same
    // Concentration, damage instead of a sentence.
    const table = facing('sea-hag', 21, { concentrating: true });
    const hurt = unwrap(
      resolveDamage(table.state, BREN, { amount: 9, source: 'a rock', types: ['bludgeoning'] }, supply('rock')),
      'a rock',
    );
    expect(hurt.concentration.kind).toBe('resolved');
    expect(
      hurt.events.some((e) => e.type === 'roll-recorded' && e.label.includes('maintain')),
    ).toBe(true);
  });

  it('does not roll the "Otherwise" dice on a save that was made', () => {
    for (const seed of SEEDS) {
      const run = force('sea-hag', GLARE, 21, seed);
      if (!run.out.outcomes[0]!.save.success) continue;
      expect(run.out.events.some((e) => e.type === 'damage-dice-recorded')).toBe(false);
      expect(run.out.events.some((e) => e.type === 'hit-points-dropped-to-zero')).toBe(false);
      expect(run.out.outcomes[0]!.damage).toBe(0);
      return;
    }
    throw new Error('no seed made the save');
  });

  const NIGHTMARE = 'Nightmare (Recharge 6)';

  it('leaves a creature at the ceiling Unconscious for the printed hour', () => {
    const { out, state } = onAFailure('incubus', NIGHTMARE, 20);

    expect(conditionsOn(state, BREN)).toContain('unconscious');
    expect(state.creatures[BREN]!.vitals.hp).toBe(20);
    const [timer] = Object.values(state.timers).filter(
      (t) => t.target.kind === 'condition' && t.target.on === BREN,
    );
    expect(timer?.deadline).toEqual({ kind: 'elapsed', at: 3600 });

    // The two endings the reader carried, handed to the table at the moment
    // of use with the noun the book's clause hangs on.
    expect(
      out.unverified.some((line) =>
        line.includes('The Unconscious condition ends early: until it takes damage'),
      ),
    ).toBe(true);
    expect(out.events.some((e) => e.type === 'damage-taken')).toBe(false);
  });

  it('deals the Incubus’ 4d8 to a creature over the ceiling', () => {
    const { out, state } = onAFailure('incubus', NIGHTMARE, 21);
    expect(conditionsOn(state, BREN)).not.toContain('unconscious');
    const [dice] = out.events.filter((e) => e.type === 'damage-dice-recorded');
    const rolled = (dice as { components: readonly { type: string; dice: readonly unknown[] }[] })
      .components;
    expect(rolled.flatMap((c) => c.dice)).toHaveLength(4);
    expect(rolled.every((c) => c.type === 'psychic')).toBe(true);
  });
});
/**
 * A Warlock 3 of the Fiend, an ally beside them, and three enemies: one within
 * reach, one at exactly the ten feet the second sentence prints, and one well
 * outside it.
 *
 * **The hag is on a side of her own**, so none of this turns on whose enemy
 * *she* thought the goblin was. That is the reading under test: "an enemy" in
 * a feature written in the second person is the holder's enemy, and the hag is
 * only "someone else".
 */
function theWarlock(options: { readonly scene?: boolean } = {}) {
  const laid = options.scene ?? true;
  const log: GameEvent[] = [];
  let state = fold('the-blessing', []);
  const land = (events: readonly GameEvent[]): void => {
    log.push(...events);
    state = after(state, events);
  };
  const step = (result: Result<readonly GameEvent[]>, label: string): void =>
    land(unwrap(result, label));

  step(createCharacter(SRD_CONTENT, kael(), WARLOCK), 'Kael');
  land(
    [ALLY, ADJACENT, NEAR, FAR].map(
      (who): GameEvent => ({
        type: 'creature-added',
        id: who,
        name: who,
        // A Dexterity nothing misses and one Hit Point, so every fixture below
        // is about what a fall pays rather than about whether a d20 obliged.
        sheet: sheet({ abilities: { str: 8, dex: 1, con: 8, int: 8, wis: 8, cha: 8 } }),
        maxHp: 1,
        diesAtZero: false,
        creatureType: 'Humanoid',
      }),
    ),
  );
  land(unwrap(addCreature(state, SRD_CONTENT, FOE, 'sea-hag'), 'hag').events);

  if (laid) {
    step(setScene(state, { width: 300, depth: 300, height: 20 }), 'scene');
    step(addSceneLandmark(state, 'the stump', { x: 100, y: 100, z: 0 }), 'stump');
    step(placeCreatureInScene(state, WARLOCK, { from: { landmark: 'the stump' }, feet: 0 }), 'Kael');
    step(placeCreatureInScene(state, ALLY, { from: { creature: WARLOCK }, feet: 5, bearing: 0 }), 'Rook');
    step(placeCreatureInScene(state, ADJACENT, { from: { creature: WARLOCK }, feet: 5, bearing: 90 }), 'the one in reach');
    step(placeCreatureInScene(state, NEAR, { from: { creature: WARLOCK }, feet: 10, bearing: 180 }), 'the one at ten feet');
    step(placeCreatureInScene(state, FAR, { from: { creature: WARLOCK }, feet: 25, bearing: 270 }), 'the one out of it');
    step(placeCreatureInScene(state, FOE, { from: { creature: WARLOCK }, feet: 40, bearing: 315 }), 'the hag');
  }

  step(declareCreatureSide(state, WARLOCK, 'party'), 'Kael’s side');
  step(declareCreatureSide(state, ALLY, 'party'), 'Rook’s side');
  for (const goblin of [ADJACENT, NEAR, FAR]) {
    step(declareCreatureSide(state, goblin, 'goblins'), `${goblin}’s side`);
  }
  step(declareCreatureSide(state, FOE, 'the deep'), 'the hag’s side');
  step(
    beginCombat(state, [
      { id: WARLOCK, initiative: 20, speed: 30 },
      { id: ALLY, initiative: 15, speed: 30 },
      { id: FOE, initiative: 10, speed: 30 },
      { id: ADJACENT, initiative: 7, speed: 30 },
      { id: NEAR, initiative: 5, speed: 30 },
      { id: FAR, initiative: 1, speed: 30 },
    ]),
    'combat',
  );
  return { state, log };
}

/** Swing until somebody connects, because a natural 1 misses whatever the target. */
function swing(state: GameState, target: CharacterId, tag: string) {
  for (const seed of SEEDS) {
    const out = unwrap(
      resolveAttack(
        state,
        WARLOCK,
        // An Unarmed Strike, so no fixture depends on what a class’s
        // equipment pack happened to contain.
        { target, weapon: null, commandId: `${tag}-${seed}` },
        supply(`${tag}-${seed}`),
      ),
      'a swing',
    );
    const landed = after(state, out.events);
    if (landed.creatures[target]!.vitals.hp === 0) return { out, state: landed };
  }
  throw new Error(`no seed dropped ${target}`);
}

/**
 * The Warlock's own cantrip, on the first seed whose beam connects.
 *
 * A spell's damage rather than a weapon's: the same fall, reached down the
 * road a casting takes, which is the other half of "every road" and the one a
 * Fireball would take if a Warlock 3 had one.
 */
function zap(state: GameState, target: CharacterId, tag: string) {
  for (const seed of SEEDS) {
    const out = unwrap(
      resolveSpell(
        state,
        WARLOCK,
        { spellId: 'eldritch-blast', targets: [target], commandId: `${tag}-${seed}` },
        supply(`${tag}-${seed}`),
      ),
      'a beam',
    );
    if (after(state, out.events).creatures[target]!.vitals.hp === 0) return out;
  }
  throw new Error(`no seed dropped ${target} with a beam`);
}

/** Round the initiative order until the hag is up, so she may spend her Action. */
function untilTheHag(state: GameState): GameState {
  let current = state;
  for (let step = 0; step < 12; step += 1) {
    const combat = current.combat;
    if (combat === null) throw new Error('there is no fight to advance');
    if (combat.order[combat.turnIndex]?.id === FOE) return current;
    current = applyEvent(current, { type: 'turn-advanced' });
  }
  throw new Error('the hag never got a turn');
}

/** The hag glares at one creature, on the first seed that fails the save. */
function glare(before: GameState, target: CharacterId) {
  const state = untilTheHag(before);
  for (const seed of SEEDS) {
    const out = unwrap(
      forcePrintedSave(
        state,
        FOE,
        { line: 'Death Glare (Recharge 5–6)', targets: [target], commandId: `glare-${seed}` },
        supply(seed),
      ),
      'the glare',
    );
    if (out.outcomes[0]!.save.success) continue;
    return { out, state: after(state, out.events) };
  }
  throw new Error(`no seed failed the glare at ${target}`);
}

const temporaryHp = (state: GameState, who: CharacterId): number =>
  state.creatures[who]!.vitals.temporaryHp;

/**
 * Rook puts SRD Spirit Guardians up: a 15-foot Emanation on themselves, whose
 * damage falls due at the end of somebody else's turn rather than at the cast.
 *
 * Declared rather than created, because what the fixture needs is a caster
 * with one spell and a slot to spend on it — the same shape `facing` uses for
 * Bren's Shield of Faith.
 */
function guardians(from: GameState): GameState {
  let state = after(from, [
    {
      type: 'spellcasting-declared',
      id: ALLY,
      spellcasting: declaredCasting({ ability: 'wis', classId: 'cleric', prepared: ['spirit-guardians'] }),
    },
    {
      type: 'resource-pool-declared',
      id: ALLY,
      pool: { key: 'spell-slot:3', label: 'level 3', max: 2, recovers: 'long-rest' },
    },
  ]);

  // Kael is up first; the spirits are Rook's, so the turn moves to them.
  state = after(state, unwrap(resolveTurn(state, supply('to-rook'), { commandId: 'to-rook' }), 'to Rook').events);

  const cast = unwrap(
    resolveSpell(
      state,
      ALLY,
      {
        spellId: 'spirit-guardians',
        targets: [],
        slotLevel: 3,
        // "Radiant (if you are good or neutral) or Necrotic (if you are evil)"
        // — an alignment the engine does not hold, so the caster states it.
        damageType: 'radiant',
        // Kael is inside the Emanation and this fixture is not about a Warlock
        // taking Radiant damage from their own ally.
        unaffected: [WARLOCK],
        commandId: 'the-spirits',
      },
      supply('the-spirits'),
    ),
    'Spirit Guardians',
  );
  return after(state, cast.events);
}

/**
 * Kael, and a Rogue on one Hit Point whose Uncanny Dodge holds the blow open.
 *
 * The **held** road: `landDamage` sees an eligible reactor and writes
 * `damage-rolled` instead of dealing the damage, and `settleDamage` is the one
 * door out. Nobody answers here — an unanswered offer settles as a pass — so
 * what the fixture is about is the settlement and not the Reaction.
 */
function theRogueOnHerLastLeg(options: { readonly side?: string } = {}): GameState {
  const table = theWarlock();
  // The fight is reopened with the Rogue in the order, because Uncanny Dodge
  // costs a Reaction and a creature outside the order has no budget to spend
  // one from — a window nobody can afford is a window that never opens.
  let state = fold(
    'the-blessing',
    table.log.filter((event) => event.type !== 'combat-started'),
  );
  const step = (result: Result<readonly GameEvent[]>, label: string): void => {
    state = after(state, unwrap(result, label));
  };

  step(createCharacter(SRD_CONTENT, nyx(), THIEF), 'Nyx');
  step(
    placeCreatureInScene(state, THIEF, { from: { creature: WARLOCK }, feet: 5, bearing: 45 }),
    'Nyx stands',
  );
  if (options.side !== undefined) {
    step(declareCreatureSide(state, THIEF, options.side), 'Nyx’s side');
  }

  // Down to one Hit Point, so any blow that lands at all is the blow that
  // drops her. Dealt by nobody, so this whittling pays no watcher.
  const hp = state.creatures[THIEF]!.vitals.hp;
  state = after(
    state,
    unwrap(
      resolveDamage(
        state,
        THIEF,
        { amount: hp - 1, source: 'the road here', commandId: 'the-road' },
        supply('the-road'),
      ),
      'the road here',
    ).events,
  );

  step(
    beginCombat(state, [
      { id: WARLOCK, initiative: 20, speed: 30 },
      { id: ALLY, initiative: 15, speed: 30 },
      { id: THIEF, initiative: 12, speed: 30 },
      { id: FOE, initiative: 10, speed: 30 },
      { id: ADJACENT, initiative: 7, speed: 30 },
      { id: NEAR, initiative: 5, speed: 30 },
      { id: FAR, initiative: 1, speed: 30 },
    ]),
    'combat',
  );
  return state;
}

/** Swing at the Rogue until a blow connects, and settle the window it opened. */
function heldThenSettled(from: GameState) {
  for (const seed of SEEDS) {
    const swung = unwrap(
      resolveAttack(
        from,
        WARLOCK,
        { target: THIEF, weapon: null, commandId: `held-${seed}` },
        supply(`held-${seed}`),
      ),
      'a swing',
    );
    if (!swung.events.some((event) => event.type === 'damage-rolled')) continue;
    const held = after(from, swung.events);
    const out = unwrap(settleDamage(held, supply(`settle-${seed}`)), 'the settlement');
    return { out, state: after(held, out.events) };
  }
  throw new Error('no seed held a blow open against the Rogue');
}

/**
 * Rook puts SRD Acid Arrow into a goblin: a hit now and "2d4 Acid damage at
 * the end of its next turn", which is a debt in state that falls due at a
 * boundary and is collected by `resolveTurn` rather than by any casting.
 *
 * The goblin's Hit Point maximum is raised first so the arrow itself does not
 * finish it — the whole point is the hit that arrives a turn later.
 */
function acidArrowInto(from: GameState, target: CharacterId) {
  const armed = after(from, [
    { type: 'hit-point-maximum-raised', id: target, amount: 40 },
    {
      type: 'spellcasting-declared',
      id: ALLY,
      spellcasting: declaredCasting({ ability: 'int', classId: 'wizard', prepared: ['acid-arrow'] }),
    },
    {
      type: 'resource-pool-declared',
      id: ALLY,
      pool: { key: 'spell-slot:2', label: 'level 2', max: 2, recovers: 'long-rest' },
    },
  ]);

  // Rook is second in the order, so the turn moves to them before they cast.
  const rooksTurn = after(
    armed,
    unwrap(resolveTurn(armed, supply('to-rook'), { commandId: 'to-rook' }), 'to Rook').events,
  );

  for (const seed of SEEDS) {
    const cast = unwrap(
      resolveSpell(
        rooksTurn,
        ALLY,
        { spellId: 'acid-arrow', targets: [target], slotLevel: 2, commandId: `arrow-${seed}` },
        supply(`arrow-${seed}`),
      ),
      'Acid Arrow',
    );
    const struck = after(rooksTurn, cast.events);
    // A miss splashes for half and schedules nothing, and a hit that finished
    // the goblin leaves no later hit to fall due either.
    if (!cast.events.some((event) => event.type === 'damage-scheduled')) continue;
    if (struck.creatures[target]!.vitals.hp === 0) continue;
    // And down to one Hit Point, so the 2d4 a turn from now is the blow that
    // drops them rather than a scratch. Dealt by nobody, so this pays no
    // watcher of its own.
    const left = struck.creatures[target]!.vitals.hp;
    return after(
      struck,
      unwrap(
        resolveDamage(
          struck,
          target,
          { amount: left - 1, source: 'a long day', commandId: 'a-long-day' },
          supply('a-long-day'),
        ),
        'a long day',
      ).events,
    );
  }
  throw new Error(`no seed put an Acid Arrow into ${target}`);
}

/** Advance the order until a scheduled hit has fallen due. */
function untilTheAcidBites(from: GameState) {
  let state = from;
  for (let step = 0; step < 14; step += 1) {
    const out = unwrap(
      resolveTurn(state, supply(`acid-${step}`), { commandId: `acid-${step}` }),
      'the boundary',
    );
    state = after(state, out.events);
    if (out.events.some((event) => event.type === 'scheduled-damage-collected')) {
      return { out, state };
    }
  }
  throw new Error('the acid never fell due');
}

/** Advance the order until the boundary's own areas have dropped the goblin. */
function untilTheGoblinFalls(from: GameState) {
  let state = from;
  for (let step = 0; step < 12; step += 1) {
    const out = unwrap(
      resolveTurn(state, supply(`boundary-${step}`), { commandId: `boundary-${step}` }),
      'the boundary',
    );
    state = after(state, out.events);
    if (state.creatures[NEAR]!.vitals.hp === 0) return { out, state };
  }
  throw new Error('the spirits never reached the goblin');
}

describe('the feature that watches an enemy fall', () => {
  it('pays a Warlock 3 with Charisma 16 six Temporary Hit Points for their own kill', () => {
    const table = theWarlock();
    // The grant reached the sheet, with the Warlock’s own class level on it.
    expect(table.state.creatures[WARLOCK]!.sheet.onDroppingAHostile).toEqual([
      {
        feature: 'fiend-patron:dark-ones-blessing',
        name: "Dark One's Blessing",
        ability: 'cha',
        classLevel: 3,
        minimum: 1,
        within: 10,
      },
    ]);

    const dropped = swing(table.state, ADJACENT, 'kael-swings').state;
    // Charisma 16 is +3, and the Warlock level is 3.
    expect(temporaryHp(dropped, WARLOCK)).toBe(6);
    expect(
      dropped.creatures[WARLOCK]!.vitals.hp,
    ).toBe(table.state.creatures[WARLOCK]!.vitals.hp);
  });

  it('refreshes rather than stacks on a second enemy falling', () => {
    const first = swing(theWarlock().state, ADJACENT, 'kael-swings').state;
    expect(temporaryHp(first, WARLOCK)).toBe(6);
    // SRD: "you choose whether to keep the ones you have or gain the new ones"
    // — and the larger pool is that choice made the only way it is ever made,
    // so two sixes are six.
    const second = glare(first, NEAR);
    expect(temporaryHp(second.state, WARLOCK)).toBe(6);
  });

  it('pays for somebody else’s kill within ten feet, and not for one beyond', () => {
    const table = theWarlock();

    const near = glare(table.state, NEAR);
    expect(near.state.creatures[NEAR]!.vitals.hp).toBe(0);
    // And it was no blow at all: the hag’s glare drops rather than hurts, and
    // the sentence counts it because "reduce an enemy to 0 Hit Points" is what
    // happened.
    expect(near.out.events.some((e) => e.type === 'damage-taken')).toBe(false);
    expect(temporaryHp(near.state, WARLOCK)).toBe(6);
    expect(near.out.events.filter((e) => e.type === 'temporary-hp-granted')).toEqual([
      { type: 'temporary-hp-granted', id: WARLOCK, amount: 6, source: "Dark One's Blessing" },
    ]);

    const far = glare(table.state, FAR);
    expect(far.state.creatures[FAR]!.vitals.hp).toBe(0);
    expect(temporaryHp(far.state, WARLOCK)).toBe(0);
  });

  it('pays nothing for a creature on the Warlock’s own side', () => {
    const dropped = swing(theWarlock().state, ALLY, 'kael-turns-on-rook').state;
    expect(dropped.creatures[ALLY]!.vitals.hp).toBe(0);
    expect(temporaryHp(dropped, WARLOCK)).toBe(0);
  });

  it('counts only the Warlock’s own kills where nobody has laid out a scene', () => {
    const table = theWarlock({ scene: false });
    const { out, state } = glare(table.state, NEAR);
    expect(state.creatures[NEAR]!.vitals.hp).toBe(0);
    expect(temporaryHp(state, WARLOCK)).toBe(0);
    expect(
      out.unverified.some(
        (line) =>
          line.includes('nobody has laid out a scene') && line.includes("Dark One's Blessing"),
      ),
    ).toBe(true);
  });

  it('says so rather than guessing when nobody has declared a side', () => {
    // A side is fiction and re-declarable, so a table that has not said is a
    // real state rather than a broken fixture.
    const unsided = fold(
      'the-blessing',
      theWarlock().log.filter(
        (event) => !(event.type === 'creature-side-declared' && event.id === NEAR),
      ),
    );
    const { out, state } = glare(unsided, NEAR);
    expect(temporaryHp(state, WARLOCK)).toBe(0);
    expect(
      out.unverified.some((line) => line.includes(`nobody has said whose side ${NEAR} is on`)),
    ).toBe(true);
  });

  /**
   * And it says the same thing on the **other road to the same fall**.
   *
   * A creature reaches 0 two ways — a sentence that drops it, and damage that
   * takes it there — and the two travel through different code: the printed
   * clause executor and `dealSpellDamage`. A report written into one of them
   * would be an engine that answers the same missing fact only when the fall
   * happened to arrive by the road somebody remembered.
   */
  it('says the same about a missing side when the fall was dealt by damage', () => {
    const unsided = fold(
      'the-blessing',
      theWarlock().log.filter(
        (event) => !(event.type === 'creature-side-declared' && event.id === ADJACENT),
      ),
    );
    const { out, state } = swing(unsided, ADJACENT, 'kael-swings-at-a-stranger');
    expect(state.creatures[ADJACENT]!.vitals.hp).toBe(0);
    expect(out.events.some((e) => e.type === 'damage-taken')).toBe(true);
    expect(out.events.some((e) => e.type === 'hit-points-dropped-to-zero')).toBe(false);
    expect(temporaryHp(state, WARLOCK)).toBe(0);
    expect(
      out.unverified.some((line) => line.includes(`nobody has said whose side ${ADJACENT} is on`)),
    ).toBe(true);
  });

  /**
   * And the **other arm of the same printed line** says it too.
   *
   * The glare reaches a creature two ways — a drop under its ceiling and 3d8
   * over it — and only the first goes through the clause executor. The second
   * is `dealSpellDamage`'s, reached from `forcePrintedSave`, and a report
   * written into one of them would be a line that answers the same missing
   * fact differently depending on how many Hit Points its target had.
   */
  it('says the same about a missing side when the line’s own damage does the dropping', () => {
    const table = theWarlock();
    // Over the ceiling, so the line rolls its 3d8 rather than dropping
    // anybody outright — and Vulnerable to Psychic, so the 3d8 gets there.
    const cursed: readonly GameEvent[] = [
      { type: 'hit-point-maximum-raised', id: NEAR, amount: 20 },
      {
        type: 'damage-defense-granted',
        id: NEAR,
        defense: { source: 'a curse', damageTypes: ['psychic'], defense: 'vulnerable' },
      },
    ];
    const over = after(
      fold(
        'the-blessing',
        table.log.filter(
          (event) => !(event.type === 'creature-side-declared' && event.id === NEAR),
        ),
      ),
      cursed,
    );

    const { out, state } = glare(over, NEAR);
    expect(state.creatures[NEAR]!.vitals.hp).toBe(0);
    expect(out.events.some((e) => e.type === 'hit-points-dropped-to-zero')).toBe(false);
    expect(out.events.some((e) => e.type === 'damage-taken')).toBe(true);
    expect(temporaryHp(state, WARLOCK)).toBe(0);
    expect(
      out.unverified.some((line) => line.includes(`nobody has said whose side ${NEAR} is on`)),
    ).toBe(true);
  });
});

/**
 * **Every road to the same moment, and the same answer on each of them.**
 *
 * A creature reaches 0 Hit Points by more roads than the two the blocks above
 * walk: a sentence that drops it, a spell's damage, a weapon's damage somebody
 * was offered a Reaction against, and an amount a DM adjudicated for a falling
 * chandelier. Dark One's Blessing is written about the *outcome* — "when you
 * reduce an enemy to 0 Hit Points" — so a reader wired into some of the roads
 * is a rule that stops working on the rest.
 *
 * `resolveDamage` is the one funnel every road that deals damage passes
 * through, so that is where the watcher is paid. The printed clause that drops
 * a creature without damage asks separately, because it never gets here.
 */
describe('the watcher is paid on every road that drops a hostile', () => {
  /** The blow a DM adjudicated: no spell, no attack, no dice the engine threw. */
  const improvised = (state: GameState, target: CharacterId, by: CharacterId) =>
    unwrap(
      resolveDamage(
        state,
        target,
        { amount: 20, source: 'a falling chandelier', by, commandId: 'the-chandelier' },
        supply('chandelier'),
      ),
      'the chandelier',
    );

  const blessing = (events: readonly GameEvent[]): readonly GameEvent[] =>
    events.filter((event) => event.type === 'temporary-hp-granted');

  const paid = {
    type: 'temporary-hp-granted',
    id: WARLOCK,
    amount: 6,
    source: "Dark One's Blessing",
  };

  it('pays the Warlock for an ally’s improvised blow ten feet away', () => {
    const table = theWarlock();
    const out = improvised(table.state, NEAR, ALLY);
    const landed = after(table.state, out.events);
    expect(landed.creatures[NEAR]!.vitals.hp).toBe(0);
    expect(temporaryHp(landed, WARLOCK)).toBe(6);
    expect(out.unverified).toEqual([]);
  });

  /**
   * **And the held road, where a blow waits for the defender to answer.**
   *
   * `settleDamage` asked `rewardsForDropping` for itself until now, and it was
   * the one road whose *event order* this change moves: the spoils used to be
   * appended after the hit's rider resolved and now ride with the damage.
   * "Within 10 feet of you" is measured at the reduction, which is before the
   * rider — a rider can push somebody across the floor — so this is the
   * instant the sentence names.
   */
  it('pays the Warlock on the road where the blow was held open', () => {
    const settled = heldThenSettled(theRogueOnHerLastLeg({ side: 'goblins' }));
    expect(settled.state.creatures[THIEF]!.vitals.hp).toBe(0);
    expect(temporaryHp(settled.state, WARLOCK)).toBe(6);
    expect(blessing(settled.out.events)).toEqual([paid]);

    // And it rides with the damage rather than trailing the settlement: what
    // the creature was paid for is the blow, and the blow is where it sits.
    const order = settled.out.events.map((event) => event.type);
    expect(order.indexOf('temporary-hp-granted')).toBeGreaterThan(
      order.indexOf('damage-taken'),
    );
  });

  it('gives a chandelier, a swing and a spell the same log shape', () => {
    const table = theWarlock();
    expect(blessing(improvised(table.state, ADJACENT, ALLY).events)).toEqual([paid]);
    expect(blessing(swing(table.state, ADJACENT, 'kael-swings-for-shape').out.events)).toEqual([
      paid,
    ]);
    expect(blessing(zap(table.state, ADJACENT, 'kael-zaps-for-shape').events)).toEqual([paid]);
  });

  /**
   * And the report reaches the caller on the improvised road too: the amount
   * a DM states carries no map, so the second half of the sentence — "within
   * 10 feet of you" — is a question only a scene answers.
   */
  it('reports the missing scene on the improvised road', () => {
    const table = theWarlock({ scene: false });
    const out = improvised(table.state, NEAR, ALLY);
    expect(temporaryHp(after(table.state, out.events), WARLOCK)).toBe(0);
    expect(
      out.unverified.some(
        (line) =>
          line.includes('nobody has laid out a scene') && line.includes("Dark One's Blessing"),
      ),
    ).toBe(true);
  });
});

/**
 * **And the report reaches whoever called, on every road that deals damage.**
 *
 * `dealSpellDamage` has reported what a watching feature could not settle
 * since the Resistance cantrip needed a sentence for it, and eleven commands
 * call it. One of them threaded the report into the accumulator it already
 * returns and ten dropped it on the floor — so the engine knew a side had not
 * been declared, said so to itself, and handed the caller a clean outcome.
 *
 * A side is fiction and re-declarable, so a table that has not said is a real
 * state rather than a broken fixture, and it is the missing fact every one of
 * these fixtures is built on: it needs no scene, no distance and no second
 * creature, so what each test discriminates is the road rather than the rule.
 */
describe('what the engine could not check reaches the caller on every road', () => {
  /** The same table, with one goblin's side never declared. */
  const unsided = (who: CharacterId, options: { readonly scene?: boolean } = {}): GameState =>
    fold(
      'the-blessing',
      theWarlock(options).log.filter(
        (event) => !(event.type === 'creature-side-declared' && event.id === who),
      ),
    );

  /**
   * The watcher's own sentence, and not merely a line naming the same gap.
   *
   * A missing side is reported by more than one rule — a ranged attack's
   * Disadvantage asks it too — so the tail is matched as well as the head, or
   * this whole block would pass on a road that still drops the report.
   */
  const watcherSaid = (lines: readonly string[], who: CharacterId): boolean =>
    lines.some(
      (line) =>
        line.includes(`nobody has said whose side ${who} is on`) &&
        line.includes("Dark One's Blessing") &&
        line.includes('reaching 0 Hit Points was an enemy falling'),
    );

  /**
   * A spell attack that drops its target — SRD Eldritch Blast.
   *
   * `resolveAttackEffect`'s road, which is `dealSpellDamage`'s caller for
   * every spell that rolls to hit.
   */
  it('reports it on a spell attack’s casting', () => {
    const state = unsided(ADJACENT);
    const out = zap(state, ADJACENT, 'kael-zaps-a-stranger');
    expect(after(state, out.events).creatures[ADJACENT]!.vitals.hp).toBe(0);
    expect(temporaryHp(after(state, out.events), WARLOCK)).toBe(0);
    expect(watcherSaid(out.unverified, ADJACENT)).toBe(true);
  });

  /**
   * A spell whose damage a saving throw halves — SRD Sacred Flame, which Kael
   * holds through Magic Initiate. `resolveSaveDamageEffect`'s road, and the
   * one a Fireball and a Hellish Rebuke both take.
   */
  it('reports it on a save-damage casting', () => {
    // Sacred Flame's target must be one the caster can see, and sight is a
    // fact the table declares rather than one the engine derives.
    const state = after(unsided(NEAR), [
      { type: 'sight-declared', from: WARLOCK, to: NEAR, seen: true },
    ]);
    for (const seed of SEEDS) {
      const out = unwrap(
        resolveSpell(
          state,
          WARLOCK,
          { spellId: 'sacred-flame', targets: [NEAR], commandId: `flame-${seed}` },
          supply(`flame-${seed}`),
        ),
        'sacred flame',
      );
      if (after(state, out.events).creatures[NEAR]!.vitals.hp > 0) continue;
      expect(watcherSaid(out.unverified, NEAR)).toBe(true);
      return;
    }
    throw new Error('no seed dropped the goblin with Sacred Flame');
  });

  /**
   * **The same resolver reached through the Reaction door** — SRD Hellish
   * Rebuke, which Kael casts in answer to being hit rather than on a turn of
   * their own. It is `resolveSaveDamageEffect`'s road again, and that is the
   * claim: a Reaction is a casting, so the report comes home the same way.
   */
  it('reports it on a Reaction spell’s casting', () => {
    // "a creature within 60 feet of you that you can see" — sight again, and
    // a fact the table declares rather than one the engine derives.
    const state = after(unsided(ADJACENT), [
      { type: 'sight-declared', from: WARLOCK, to: ADJACENT, seen: true },
    ]);
    const struck = after(
      state,
      unwrap(
        resolveDamage(
          state,
          WARLOCK,
          { amount: 4, source: 'a scimitar', by: ADJACENT, commandId: 'the-scimitar' },
          supply('scimitar'),
        ),
        'the scimitar',
      ).events,
    );

    const out = unwrap(
      resolveSpell(
        struck,
        WARLOCK,
        {
          spellId: 'hellish-rebuke',
          targets: [ADJACENT],
          // A Warlock 3's Pact Magic slots are level 2, and Hellish Rebuke
          // upcast is Hellish Rebuke: there is no smaller slot to spend.
          slotKind: 'pact',
          slotLevel: 2,
          commandId: 'the-rebuke',
        },
        supply('rebuke'),
      ),
      'Hellish Rebuke',
    );
    expect(after(struck, out.events).creatures[ADJACENT]!.vitals.hp).toBe(0);
    expect(watcherSaid(out.unverified, ADJACENT)).toBe(true);
  });

  /**
   * And the same road reports the same missing fact: `settleDamage` was
   * dropping `resolveDamage`'s whole report, the watcher's half included.
   */
  it('reports it on the road where the blow was held open', () => {
    const settled = heldThenSettled(theRogueOnHerLastLeg());
    expect(settled.state.creatures[THIEF]!.vitals.hp).toBe(0);
    expect(temporaryHp(settled.state, WARLOCK)).toBe(0);
    expect(watcherSaid(settled.out.unverified, THIEF)).toBe(true);
  });

  /**
   * **A hit the last turn promised**, collected at a boundary by
   * `collectDueDamage` — SRD Acid Arrow's "2d4 Acid damage at the end of its
   * next turn". No casting is running when it lands and its caster need not
   * even be alive, which is why it is its own road.
   */
  it('reports it on a scheduled hit falling due', () => {
    const state = acidArrowInto(unsided(NEAR), NEAR);
    const bite = untilTheAcidBites(state);
    expect(bite.state.creatures[NEAR]!.vitals.hp).toBe(0);
    expect(watcherSaid(bite.out.unverified, NEAR)).toBe(true);
  });

  /**
   * **A persistent area settling at a turn boundary**, which reaches the same
   * resolver by a road no casting command is on: SRD Spirit Guardians is a
   * clause on the spell — "ends its turn there" — and what settles it is
   * `resolveTurn`, a round after anybody cast anything.
   *
   * `settleAreaEffects` has gathered the report since it was written; the
   * boundary that calls it was throwing it away.
   */
  it('reports it on a persistent area settling at a turn boundary', () => {
    const state = guardians(unsided(NEAR));
    const boundary = untilTheGoblinFalls(state);
    expect(boundary.state.creatures[NEAR]!.vitals.hp).toBe(0);
    expect(watcherSaid(boundary.out.unverified, NEAR)).toBe(true);
  });
});
