/**
 * A printed save's failure, executed beyond the damage.
 *
 * `printed-save.test.ts` proves the template the first reader took — an
 * ability, a DC, dice and what a success buys. This file proves the clauses
 * the second reader added, each executed by a primitive the casting path
 * already had: a condition to a turn anchor on the source or the target, a
 * grapple with the block's escape DC that `escapeGrapple` can answer, a push
 * straight away and the Prone that comes with it, a Speed cut for a turn, a
 * Hit Point maximum lowered by the damage the line dealt, a save the target
 * repeats at the end of its turns with a minute's cap, and a size gate. And
 * the two honesties around them: a sentence the reader carried and did not
 * read comes back in `unverified` at the moment of use, and an immune target
 * is reported rather than silently skipped.
 *
 * And the four the third reader added: a condition another one **carries**
 * for exactly its own lifetime (the Chuul's Paralyzed under its Poisoned, the
 * Couatl's Restrained under its grapple), a curse that is only conditions
 * (the Lamia's hour), a failure the line **grades** (the Gorgon's Restrained,
 * repeated once, deepening to Petrified), and one graded by the **margin** the
 * engine already has from the roll it made (the Pseudodragon's Unconscious).
 *
 * Both branches of every save are exercised by running each line under a
 * handful of seeds and asserting the *rule* on whichever way the die fell —
 * a failure lands the clause, a success does not — and that both were seen.
 */

import { SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import { asCharacterId, type CharacterId, type Result } from '@ie/shared';
import {
  addCreature,
  addSceneLandmark,
  beginCombat,
  declareCreatureSide,
  escapeGrapple,
  forcePrintedSave,
  liftConditionFrom,
  placeCreatureInScene,
  resolveTurn,
  setScene,
} from './commands.js';
import { createRng, type Rng } from './dice.js';
import { applyEvent, fold, type GameEvent, type GameState } from './events.js';
import { distanceBetween } from './positioning.js';
import { createRollIssuer } from './rolls.js';
import { speedOf } from './standing.js';
import { createCharacter, type CharacterChoices } from './creation.js';

const id = (s: string) => asCharacterId(s);
const BREN = id('bren');
const FOE = id('foe');
const OGRE = id('ogre');
const ZOMBIE = id('zombie');
const GRISH = id('grish');

const supply = (seed: string) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

const unwrap = <T>(result: Result<T>, label = 'ok'): T => {
  if (!result.ok) throw new Error(`${label}: ${result.code} — ${result.reason}`);
  return result.value;
};

const bren = (): CharacterChoices => ({
  name: 'Bren',
  classId: 'fighter',
  level: 1,
  speciesId: 'human',
  backgroundId: 'sage',
  languages: ['Dwarvish', 'Orc'],
  alignment: 'Neutral',
  spellbook: [],
  backgroundEquipment: 'A',
  classEquipment: 'A',
  hitPoints: { method: 'fixed' },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
  cantrips: [],
  preparedSpells: [],
  abilities: {
    method: 'standard-array',
    assignment: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
  },
  abilityIncreases: { con: 2, wis: 1 },
  classSkills: ['athletics', 'survival'],
  equipped: ['chain-mail'],
  featureChoices: { 'human:skillful': ['perception'], 'fighter:weapon-mastery': [] },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int',
      cantrips: ['mage-hand', 'light'],
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId: 'alert' },
    'fighter:fighting-style': { featId: 'archery' },
  },
});

/** Apply a command's events to a state. */
const after = (state: GameState, events: readonly GameEvent[]): GameState =>
  events.reduce((s, e) => applyEvent(s, e), state);

/**
 * A monster, Bren beside it, and a fight with the monster acting first — the
 * shape `printed-save.test.ts` builds, with room for a second and third body.
 */
function inTheWoods(
  monster: string,
  extra: readonly { readonly id: CharacterId; readonly monster: string }[] = [],
): { readonly state: GameState; readonly log: readonly GameEvent[] } {
  const log: GameEvent[] = [];
  let state = fold('woods', []);
  const land = (events: readonly GameEvent[]): void => {
    log.push(...events);
    state = after(state, events);
  };
  const step = (result: Result<readonly GameEvent[]>, label: string): void =>
    land(unwrap(result, label));
  const arrive = (who: CharacterId, block: string): void =>
    land(unwrap(addCreature(state, SRD_CONTENT, who, block), block).events);
  step(createCharacter(SRD_CONTENT, bren(), BREN), 'Bren');
  arrive(FOE, monster);
  for (const one of extra) arrive(one.id, one.monster);
  step(setScene(state, { width: 120, depth: 80, height: 20 }), 'scene');
  step(addSceneLandmark(state, 'the stump', { x: 40, y: 40, z: 0 }), 'stump');
  step(placeCreatureInScene(state, BREN, { from: { landmark: 'the stump' }, feet: 0 }), 'place Bren');
  step(placeCreatureInScene(state, FOE, { from: { creature: BREN }, feet: 5, bearing: 90 }), 'place foe');
  extra.forEach((one, index) => {
    step(
      placeCreatureInScene(state, one.id, { from: { creature: BREN }, feet: 10 + index * 5, bearing: 270 }),
      `place ${one.id}`,
    );
  });
  step(declareCreatureSide(state, BREN, 'party'), 'side');
  step(declareCreatureSide(state, FOE, 'wild'), 'side');
  step(
    beginCombat(state, [
      { id: FOE, initiative: 20, speed: 30 },
      { id: BREN, initiative: 1, speed: 30 },
      ...extra.map((one, index) => ({ id: one.id, initiative: 10 - index, speed: 30 })),
    ]),
    'combat',
  );
  return { state, log };
}

const SEEDS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'];

/** The line forced under one seed: the outcome and the world after it. */
function forced(monster: string, line: string, seed: string, targets: readonly CharacterId[] = [BREN], extra?: readonly { id: CharacterId; monster: string }[]) {
  const table = inTheWoods(monster, extra);
  const out = unwrap(
    forcePrintedSave(table.state, FOE, { line, targets, commandId: `use-${seed}` }, supply(seed)),
    `${monster} uses ${line}`,
  );
  return { before: table.state, out, state: after(table.state, out.events), log: [...table.log, ...out.events] };
}

const has = (state: GameState, who: CharacterId, condition: string): boolean =>
  state.creatures[who]!.conditions.conditions.includes(condition as never);

const timersOn = (state: GameState, who: CharacterId) =>
  Object.values(state.timers).filter((t) => t.target.kind === 'condition' && t.target.on === who);

/** Both branches of a save seen across the seeds, so neither assertion is vacuous. */
function bothBranches(outcomes: readonly { success: boolean }[]): void {
  expect(outcomes.some((one) => one.success)).toBe(true);
  expect(outcomes.some((one) => !one.success)).toBe(true);
}

describe('a condition a failure imposes', () => {
  it("lands the Lion's Roar as Frightened until the start of the lion's next turn, and rolls no damage", () => {
    const seen: { success: boolean }[] = [];
    for (const seed of SEEDS) {
      const { out, state } = forced('lion', 'Roar', seed);
      const [one] = out.outcomes;
      seen.push({ success: one!.save.success });
      expect(one!.damage).toBe(0);
      expect(out.events.some((e) => e.type === 'damage-dice-recorded')).toBe(false);
      if (one!.save.success) {
        expect(has(state, BREN, 'frightened')).toBe(false);
        expect(one!.conditions ?? []).toEqual([]);
      } else {
        expect(has(state, BREN, 'frightened')).toBe(true);
        expect(one!.conditions).toEqual(['frightened']);
        // The anchor is the *lion's* turn: "until the start of the lion's next turn".
        const [timer] = timersOn(state, BREN);
        expect(timer?.deadline).toMatchObject({ kind: 'turn-start', of: FOE });
      }
    }
    bothBranches(seen);
  });

  it('lands damage and the Blinded riding on it, or neither, off one save', () => {
    const seen: { success: boolean }[] = [];
    for (const seed of SEEDS) {
      const { out, state } = forced('gibbering-mouther', 'Blinding Spittle (Recharge 5–6)', seed);
      const [one] = out.outcomes;
      seen.push({ success: one!.save.success });
      if (one!.save.success) {
        // No `_Success:_` clause: a success buys nothing, and nothing was rolled.
        expect(one!.damage).toBe(0);
        expect(has(state, BREN, 'blinded')).toBe(false);
      } else {
        expect(one!.damage).toBeGreaterThan(0);
        expect(has(state, BREN, 'blinded')).toBe(true);
        expect(timersOn(state, BREN)[0]?.deadline).toMatchObject({ kind: 'turn-end', of: FOE });
      }
    }
    bothBranches(seen);
  });

  it('anchors "until the end of its next turn" on the target', () => {
    for (const seed of SEEDS) {
      const { out, state } = forced('dretch', 'Fetid Cloud (1/Day)', seed);
      if (out.outcomes[0]!.save.success) continue;
      expect(has(state, BREN, 'poisoned')).toBe(true);
      expect(timersOn(state, BREN)[0]?.deadline).toMatchObject({ kind: 'turn-end', of: BREN });
      // And the sentence the reader carried comes back, once, at the moment of use.
      expect(out.unverified.some((line) => line.includes('While Poisoned, the creature can take either'))).toBe(true);
      return;
    }
    throw new Error('no seed failed the save');
  });
});

describe('a grapple, a push, a Speed cut and a lowered maximum', () => {
  it("lands the Bugbear Stalker's Quick Grapple as a grapple the target can escape at the printed DC", () => {
    for (const seed of SEEDS) {
      const { out, state } = forced('bugbear-stalker', 'Quick Grapple', seed);
      if (out.outcomes[0]!.save.success) continue;
      expect(out.events.some((e) => e.type === 'bonus-action-spent')).toBe(true);
      expect(has(state, BREN, 'grappled')).toBe(true);
      const [timer] = timersOn(state, BREN);
      expect(timer?.check).toMatchObject({ dc: 13, onSuccess: 'end-on-target' });
      // The same door every grapple is escaped through, on Bren's own turn.
      const next = applyEvent(state, { type: 'turn-advanced' });
      const escape = escapeGrapple(next, BREN, { ability: 'str' }, supply(`${seed}-escape`));
      expect(escape.ok, JSON.stringify(escape)).toBe(true);
      return;
    }
    throw new Error('no seed failed the save');
  });

  it("pushes the target straight away from the Air Elemental and knocks it Prone", () => {
    const seen: { success: boolean }[] = [];
    for (const seed of SEEDS) {
      const { before, out, state } = forced('air-elemental', 'Whirlwind (Recharge 4–6)', seed);
      const [one] = out.outcomes;
      seen.push({ success: one!.save.success });
      const was = unwrap(distanceBetween(before.scene!, FOE, BREN));
      const now = unwrap(distanceBetween(state.scene!, FOE, BREN));
      if (one!.save.success) {
        // "Half damage only": halved, and nothing else — no push, no Prone
        // from the line (a Bren the damage dropped is Prone by being
        // Unconscious, which is the vitals' sentence and not this one's).
        expect(now).toBe(was);
        expect(one!.pushedFeet).toBeUndefined();
        expect(one!.conditions ?? []).not.toContain('prone');
        expect(one!.damage).toBeGreaterThan(0);
      } else {
        expect(now).toBe(was + 20);
        expect(one!.pushedFeet).toBe(20);
        expect(one!.conditions).toContain('prone');
        expect(has(state, BREN, 'prone')).toBe(true);
      }
    }
    bothBranches(seen);
  });

  it("cuts the target's Speed by ten feet until the end of the Steam Mephit's next turn", () => {
    for (const seed of SEEDS) {
      const { out, state } = forced('steam-mephit', 'Steam Breath (Recharge 6)', seed);
      if (out.outcomes[0]!.save.success) continue;
      expect(speedOf(state, BREN)).toBe(20);
      const grant = Object.values(state.timers).find(
        (t) => t.target.kind === 'grants' && t.target.on === BREN,
      );
      expect(grant?.deadline).toMatchObject({ kind: 'turn-end', of: FOE });
      // The coda the reader carried: "Being underwater doesn't grant Resistance…"
      expect(out.unverified.some((line) => line.includes('Being underwater'))).toBe(true);
      return;
    }
    throw new Error('no seed failed the save');
  });

  it("lowers the maximum by the damage the Wight's Life Drain dealt, and hands the zombie over", () => {
    for (const seed of SEEDS) {
      const { before, out, state } = forced('wight', 'Life Drain', seed);
      const [one] = out.outcomes;
      if (one!.save.success) continue;
      expect(one!.damage).toBeGreaterThan(0);
      expect(state.creatures[BREN]!.vitals.hpMax).toBe(before.creatures[BREN]!.vitals.hpMax - one!.damage);
      expect(out.unverified.some((line) => line.includes('rises 24 hours later'))).toBe(true);
      return;
    }
    throw new Error('no seed failed the save');
  });

  it("lowers the maximum on either outcome of the Succubus's Draining Kiss, by what landed", () => {
    const seen: { success: boolean }[] = [];
    for (const seed of SEEDS) {
      const { before, out, state } = forced('succubus', 'Draining Kiss', seed);
      const [one] = out.outcomes;
      seen.push({ success: one!.save.success });
      // Half damage on a success, whole on a failure; the coda applies to both.
      expect(one!.damage).toBeGreaterThan(0);
      expect(state.creatures[BREN]!.vitals.hpMax).toBe(before.creatures[BREN]!.vitals.hpMax - one!.damage);
    }
    bothBranches(seen);
  });
});

describe('a save the target repeats, a size gate, an immunity, and a carried success', () => {
  it("files the Doppelganger's Frightened with a repeat save at the end of the target's turns, for a minute", () => {
    for (const seed of SEEDS) {
      const { before, out, state } = forced('doppelganger', 'Unsettling Visage (Recharge 6)', seed);
      if (out.outcomes[0]!.save.success) continue;
      expect(has(state, BREN, 'frightened')).toBe(true);
      const [timer] = timersOn(state, BREN);
      expect(timer?.repeatSave).toMatchObject({
        at: 'end-of-turn',
        of: BREN,
        ability: 'wis',
        dc: 12,
        onSuccess: 'end-on-target',
      });
      expect(timer?.deadline).toEqual({ kind: 'elapsed', at: before.elapsed + 60 });
      return;
    }
    throw new Error('no seed failed the save');
  });

  it("leaves an Ogre standing where the Gladiator's Shield Bash would floor a Medium creature", () => {
    let floored = false;
    let spared = false;
    for (const seed of SEEDS) {
      const { out, state } = forced('gladiator', 'Shield Bash', seed, [BREN, OGRE], [{ id: OGRE, monster: 'ogre' }]);
      const [onBren, onOgre] = out.outcomes;
      if (!onBren!.save.success) {
        expect(has(state, BREN, 'prone')).toBe(true);
        floored = true;
      }
      if (!onOgre!.save.success) {
        expect(has(state, OGRE, 'prone')).toBe(false);
        expect(onOgre!.damage).toBeGreaterThan(0);
        expect(out.unverified.some((line) => line.includes('ogre is large'))).toBe(true);
        spared = true;
      }
    }
    expect(floored && spared).toBe(true);
  });

  it("reports a Zombie immune to the Dretch's Poisoned rather than skipping it in silence", () => {
    for (const seed of SEEDS) {
      const { out, state } = forced('dretch', 'Fetid Cloud (1/Day)', seed, [ZOMBIE], [{ id: ZOMBIE, monster: 'zombie' }]);
      const [one] = out.outcomes;
      if (one!.save.success) continue;
      expect(has(state, ZOMBIE, 'poisoned')).toBe(false);
      expect(one!.immuneTo).toEqual(['poisoned']);
      return;
    }
    throw new Error('no seed failed the save');
  });

  it("carries the Mummy's success clause to the table and applies the failure", () => {
    const { out } = forced('mummy', 'Dreadful Glare', 'a');
    expect(out.unverified.some((line) => line.includes("immune to this mummy's Dreadful Glare for 24 hours"))).toBe(true);
    expect(out.unverified.some((line) => line.includes('one creature the mummy can see within 60 feet'))).toBe(true);
  });
});

describe('a condition the line says another one carries', () => {
  it("leaves the Chuul's target Poisoned and Paralyzed, and a cure for the Poisoned lifts both", () => {
    for (const seed of SEEDS) {
      const { out, state } = forced('chuul', 'Paralyzing Tentacles', seed);
      if (out.outcomes[0]!.save.success) continue;
      expect(has(state, BREN, 'poisoned')).toBe(true);
      // "While Poisoned, the target has the Paralyzed condition": one
      // lifetime, so the Paralyzed is filed as implied by the Poisoned.
      expect(has(state, BREN, 'paralyzed')).toBe(true);
      const held = state.creatures[BREN]!.conditions.instances;
      const poison = held.find((one) => one.condition === 'poisoned')!;
      expect(held.find((one) => one.condition === 'paralyzed')?.impliedBy).toBe(poison.id);

      // SRD Lesser Restoration names the condition and says nothing about the
      // cause, and what it carried goes with it.
      const cured = after(state, unwrap(liftConditionFrom(state, BREN, 'poisoned'), 'cure'));
      expect(has(cured, BREN, 'poisoned')).toBe(false);
      expect(has(cured, BREN, 'paralyzed')).toBe(false);
      return;
    }
    throw new Error('no seed failed the save');
  });

  it("leaves the Couatl's target Grappled and Restrained, and the escape lifts both", () => {
    for (const seed of SEEDS) {
      const { out, state } = forced('couatl', 'Constrict', seed);
      if (out.outcomes[0]!.save.success) continue;
      expect(has(state, BREN, 'grappled')).toBe(true);
      expect(has(state, BREN, 'restrained')).toBe(true);
      // Through the door every grapple is escaped through, at the block's DC.
      // One attempt a turn, because it costs the Action.
      let world = applyEvent(state, { type: 'turn-advanced' });
      for (const attempt of SEEDS) {
        const escape = escapeGrapple(world, BREN, { ability: 'str' }, supply(`${seed}-${attempt}`));
        if (!escape.ok) throw new Error(`${escape.code}: ${escape.reason}`);
        world = after(world, escape.value.events);
        if (!has(world, BREN, 'grappled')) {
          expect(has(world, BREN, 'restrained')).toBe(false);
          return;
        }
        world = applyEvent(applyEvent(world, { type: 'turn-advanced' }), {
          type: 'turn-advanced',
        });
      }
      throw new Error('never escaped');
    }
    throw new Error('no seed failed the save');
  });

  it("reads the Lamia's curse as the two conditions it carries, for the hour", () => {
    for (const seed of SEEDS) {
      const { before, out, state } = forced('lamia', 'Corrupting Touch', seed);
      if (out.outcomes[0]!.save.success) continue;
      expect(out.outcomes[0]!.conditions).toEqual(['charmed', 'poisoned']);
      expect(has(state, BREN, 'charmed')).toBe(true);
      expect(has(state, BREN, 'poisoned')).toBe(true);
      for (const timer of timersOn(state, BREN)) {
        expect(timer.deadline).toEqual({ kind: 'elapsed', at: before.elapsed + 3600 });
      }
      return;
    }
    throw new Error('no seed failed the save');
  });
});

describe('a failure the line grades', () => {
  /** End turns until the boundary has raised and rolled whatever it owes. */
  const turn = (state: GameState, seed: string): GameState => {
    const out = unwrap(resolveTurn(state, supply(seed), { commandId: `turn-${seed}` }), 'turn');
    return after(state, out.events);
  };

  it("Restrains the Gorgon's target, repeats the save once, and Petrifies a second failure", () => {
    let petrified = false;
    let freed = false;
    for (const seed of SEEDS) {
      const { out, state } = forced('gorgon', 'Petrifying Breath (Recharge 5–6)', seed);
      if (out.outcomes[0]!.save.success) continue;
      expect(has(state, BREN, 'restrained')).toBe(true);
      expect(has(state, BREN, 'petrified')).toBe(false);
      // The repeat the first rung scheduled, and what its failure leaves.
      const [timer] = timersOn(state, BREN);
      expect(timer?.repeatSave).toMatchObject({
        at: 'end-of-turn',
        of: BREN,
        ability: 'con',
        dc: 15,
        onSuccess: 'end-on-target',
        onFailure: { condition: 'petrified' },
      });

      // Round the order to the end of Bren's own turn, which is when the
      // boundary owes the save.
      let world = state;
      for (let guard = 0; guard < 4 && has(world, BREN, 'restrained'); guard += 1) {
        world = turn(world, `${seed}-${guard}`);
      }
      if (has(world, BREN, 'petrified')) {
        // The deeper condition under the same cause, the shallow one gone,
        // and nothing left to ask: the book's "second" failure is the last.
        expect(has(world, BREN, 'restrained')).toBe(false);
        expect(timersOn(world, BREN)).toEqual([]);
        expect(Object.keys(world.pendingSaves)).toEqual([]);
        petrified = true;
      } else {
        expect(has(world, BREN, 'restrained')).toBe(false);
        freed = true;
      }
    }
    expect(petrified, 'no seed ever failed the repeat').toBe(true);
    expect(freed, 'no seed ever made the repeat').toBe(true);
  });
});

describe('a failure graded by how far the save missed', () => {
  it("adds the Pseudodragon's Unconscious only where the save missed by five", () => {
    let deep = false;
    let shallow = false;
    // A Goblin Warrior rather than Bren: a first-level Fighter's Constitution
    // save is proficient and misses a DC 12 by five about one roll in twenty,
    // which is a fixture that proves one branch and asserts the other by luck.
    for (const seed of SEEDS) {
      const { out, state } = forced('pseudodragon', 'Sting', seed, [GRISH], [
        { id: GRISH, monster: 'goblin-warrior' },
      ]);
      const [one] = out.outcomes;
      if (one!.save.success) continue;
      expect(has(state, GRISH, 'poisoned')).toBe(true);
      // The margin is the engine's own: it rolled the save and the block
      // printed the DC, so nothing is asked of a caller.
      if (12 - one!.save.total >= 5) {
        expect(has(state, GRISH, 'unconscious')).toBe(true);
        const held = state.creatures[GRISH]!.conditions.instances;
        const poison = held.find((instance) => instance.condition === 'poisoned')!;
        expect(held.find((instance) => instance.condition === 'unconscious')?.impliedBy).toBe(
          poison.id,
        );
        deep = true;
      } else {
        expect(has(state, GRISH, 'unconscious')).toBe(false);
        shallow = true;
      }
      // Either way the rule the engine does not execute is said out loud.
      expect(out.unverified.some((line) => line.includes('which ends early if'))).toBe(true);
    }
    expect(deep, 'no seed missed by five').toBe(true);
    expect(shallow, 'no seed missed by less than five').toBe(true);
  });
});

describe('the log', () => {
  it('folds byte-identically with a forced save in it, and survives JSON', () => {
    const { log } = forced('air-elemental', 'Whirlwind (Recharge 4–6)', 'c');
    const folded = fold('woods', log);
    expect(folded).toStrictEqual(log.reduce((s, e) => applyEvent(s, e), fold('woods', [])));
    const throughJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
    expect(fold('woods', throughJson(log))).toStrictEqual(folded);
  });
});
