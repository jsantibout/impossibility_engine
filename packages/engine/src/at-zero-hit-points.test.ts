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
  setScene,
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
  preparedSpells: ['hex', 'charm-person', 'hold-person', 'mind-spike'],
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

  step(declareCreatureSide(state, WARLOCK, 'party'), 'Kael\u2019s side');
  step(declareCreatureSide(state, ALLY, 'party'), 'Rook\u2019s side');
  for (const goblin of [ADJACENT, NEAR, FAR]) {
    step(declareCreatureSide(state, goblin, 'goblins'), `${goblin}\u2019s side`);
  }
  step(declareCreatureSide(state, FOE, 'the deep'), 'the hag\u2019s side');
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
function swing(state: GameState, target: CharacterId, tag: string): GameState {
  for (const seed of SEEDS) {
    const out = unwrap(
      resolveAttack(
        state,
        WARLOCK,
        // An Unarmed Strike, so no fixture depends on what a class\u2019s
        // equipment pack happened to contain.
        { target, weapon: null, commandId: `${tag}-${seed}` },
        supply(`${tag}-${seed}`),
      ),
      'a swing',
    );
    const landed = after(state, out.events);
    if (landed.creatures[target]!.vitals.hp === 0) return landed;
  }
  throw new Error(`no seed dropped ${target}`);
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
        { line: 'Death Glare (Recharge 5\u20136)', targets: [target], commandId: `glare-${seed}` },
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

describe('the feature that watches an enemy fall', () => {
  it('pays a Warlock 3 with Charisma 16 six Temporary Hit Points for their own kill', () => {
    const table = theWarlock();
    // The grant reached the sheet, with the Warlock\u2019s own class level on it.
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

    const dropped = swing(table.state, ADJACENT, 'kael-swings');
    // Charisma 16 is +3, and the Warlock level is 3.
    expect(temporaryHp(dropped, WARLOCK)).toBe(6);
    expect(
      dropped.creatures[WARLOCK]!.vitals.hp,
    ).toBe(table.state.creatures[WARLOCK]!.vitals.hp);
  });

  it('refreshes rather than stacks on a second enemy falling', () => {
    const first = swing(theWarlock().state, ADJACENT, 'kael-swings');
    expect(temporaryHp(first, WARLOCK)).toBe(6);
    // SRD: "you choose whether to keep the ones you have or gain the new ones"
    // \u2014 and the larger pool is that choice made the only way it is ever made,
    // so two sixes are six.
    const second = glare(first, NEAR);
    expect(temporaryHp(second.state, WARLOCK)).toBe(6);
  });

  it('pays for somebody else\u2019s kill within ten feet, and not for one beyond', () => {
    const table = theWarlock();

    const near = glare(table.state, NEAR);
    expect(near.state.creatures[NEAR]!.vitals.hp).toBe(0);
    // And it was no blow at all: the hag\u2019s glare drops rather than hurts, and
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

  it('pays nothing for a creature on the Warlock\u2019s own side', () => {
    const dropped = swing(theWarlock().state, ALLY, 'kael-turns-on-rook');
    expect(dropped.creatures[ALLY]!.vitals.hp).toBe(0);
    expect(temporaryHp(dropped, WARLOCK)).toBe(0);
  });

  it('counts only the Warlock\u2019s own kills where nobody has laid out a scene', () => {
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
});
