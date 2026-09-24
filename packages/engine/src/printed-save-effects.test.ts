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
 * And the one failure that kills: the Will-o'-Wisp consumes a creature already
 * at 0 Hit Points and regains the dice its block prints. The ceiling on who it
 * may be forced on is read off the targeting clause and enforced here, which
 * is the one part of that clause the reader takes — a sentence that kills
 * outright is the last one to take a caller's word for.
 *
 * And the one the fourth reader added, which is a **lifetime** rather than a
 * clause: SRD Swarm of Ravens' Disadvantage lasts as long as the Deafened the
 * same failure imposed, so the grant is sourced to that condition instance and
 * lifts whichever way the instance does — the printed span, a cure, or never
 * at all on a creature the condition could not reach.
 *
 * Both branches of every save are exercised by running each line under a
 * handful of seeds and asserting the *rule* on whichever way the die fell —
 * a failure lands the clause, a success does not — and that both were seen.
 */

import { SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import { asCharacterId, type CharacterId, type Result } from '@ie/shared';
import type { Bonus } from './bonuses.js';
import {
  addCreature,
  advanceTime,
  applyConditionTo,
  endCombat,
  addSceneLandmark,
  beginCombat,
  declareCreatureSide,
  damageCreature,
  escapeGrapple,
  forcePrintedSave,
  liftConditionFrom,
  placeCreatureInScene,
  resolveTurn,
  setScene,
  takeDodge,
  wakeableOn,
  wakeCreature,
} from './commands.js';
import { canSpendSlot } from './combat.js';
import { createRng, type Rng } from './dice.js';
import { applyEvent, fold, type GameEvent, type GameState } from './events.js';
import { distanceBetween } from './positioning.js';
import { grantedRollModes } from './roll-modifiers.js';
import { createRollIssuer } from './rolls.js';
import { actionRulesOn, speedOf } from './standing.js';
import { createCharacter, type CharacterChoices } from './creation.js';

const id = (s: string) => asCharacterId(s);
const BREN = id('bren');
const FOE = id('foe');
const OGRE = id('ogre');
const ZOMBIE = id('zombie');
const GRISH = id('grish');
const CUBE = id('cube');

const supply = (seed: string, bonuses: readonly Bonus[] = []) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
  ...(bonuses.length === 0 ? {} : { bonuses }),
});

/**
 * A repeat the boundary cannot miss and one it cannot make.
 *
 * The line's own save is rolled by `forcePrintedSave`, which takes no bonuses
 * — so which creatures a breath catches is still the die's. What a *repeat*
 * does is the rule under test, and a test that discovered it by scanning seeds
 * would assert the rule on whichever branch that seed happened to take.
 */
const SHAKEN_OFF: readonly Bonus[] = [{ source: 'the test insists', flat: 40 }];
const STILL_HELD: readonly Bonus[] = [{ source: 'the test insists', flat: -40 }];

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
      // The sentence the reader used to carry — "While Poisoned, the creature
      // can take either an action or a Bonus Action…" — is applied now, and
      // nothing of this line is handed over but the area it names, which
      // needs an origin and a facing nobody declared. See the block below.
      expect(out.unverified.some((line) => line.includes('either an action'))).toBe(false);
      expect(out.unverified).toHaveLength(1);
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

  it("buys a day's grace from the Mummy's glare on a success, and carries nothing but the Cone", () => {
    const { out } = forced('mummy', 'Dreadful Glare', 'a');
    // The one sentence the corpus prints under `_Success:_` that is not "Half
    // damage" is executed now rather than handed over; the targeting clause
    // still is, because who the line caught is the table's answer.
    expect(
      out.unverified.some((line) => line.includes("immune to this mummy's Dreadful Glare")),
    ).toBe(false);
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

/**
 * SRD Swarm of Ravens, Cacophony: "The target has the Deafened condition until
 * the start of the swarm's next turn. **While Deafened, the target also has
 * Disadvantage on ability checks and attack rolls.**"
 *
 * The mode is not a condition and cannot be one the Deafened *implies*, so it
 * is a grant — and the whole of what is new is **how long it lasts**. The
 * sentence names no span; it names a condition instance, so the grant is
 * sourced to that instance's id and the instance lifting takes it, whichever
 * way the instance lifts. Three doors, and all three are tested below: the
 * printed span running out, a cure, and a target the condition never reached.
 */
describe('a mode a condition this line imposed carries', () => {
  const SOURCE = `deafened:printed:${FOE}:Cacophony (Recharge 6)`;

  const modesOn = (state: GameState, who: CharacterId, family: 'attack' | 'ability-check' | 'saving-throw') =>
    grantedRollModes(state, { family, roller: who }).map((one) => one.mode);

  it("puts Disadvantage on the target's own checks and attacks, sourced to the Deafened it imposed", () => {
    const seen: { success: boolean }[] = [];
    for (const seed of SEEDS) {
      const { out, state } = forced('swarm-of-ravens', 'Cacophony (Recharge 6)', seed);
      const [one] = out.outcomes;
      seen.push({ success: one!.save.success });
      if (one!.save.success) {
        expect(has(state, BREN, 'deafened')).toBe(false);
        expect(state.creatures[BREN]!.rollModifiers).toEqual([]);
        continue;
      }
      expect(has(state, BREN, 'deafened')).toBe(true);
      // The instance the *failure* created, and nothing else: no `grants`
      // deadline beside it, because the instance is the deadline.
      expect(state.creatures[BREN]!.rollModifiers.map((held) => held.source)).toEqual([
        SOURCE,
        SOURCE,
      ]);
      expect(
        Object.values(state.timers).some((t) => t.target.kind === 'grants' && t.target.on === BREN),
      ).toBe(false);
      // The two rolls the sentence names, and not the third.
      expect(modesOn(state, BREN, 'attack')).toEqual(['disadvantage']);
      expect(modesOn(state, BREN, 'ability-check')).toEqual(['disadvantage']);
      expect(modesOn(state, BREN, 'saving-throw')).toEqual([]);
      // And nothing landed on the swarm that made the noise.
      expect(modesOn(state, FOE, 'attack')).toEqual([]);
    }
    bothBranches(seen);
  });

  it('takes the Disadvantage away when the printed span lifts the Deafened', () => {
    for (const seed of SEEDS) {
      const { state } = forced('swarm-of-ravens', 'Cacophony (Recharge 6)', seed);
      if (!has(state, BREN, 'deafened')) continue;
      // "until the start of the swarm's next turn": the swarm goes first, so
      // Bren's turn and then the swarm's start is the moment.
      const later = applyEvent(applyEvent(state, { type: 'turn-advanced' }), {
        type: 'turn-advanced',
      });
      expect(has(later, BREN, 'deafened')).toBe(false);
      expect(later.creatures[BREN]!.rollModifiers).toEqual([]);
      expect(modesOn(later, BREN, 'attack')).toEqual([]);
      return;
    }
    throw new Error('no seed failed the save');
  });

  it('takes the Disadvantage away when a cure lifts the Deafened early', () => {
    for (const seed of SEEDS) {
      const { state } = forced('swarm-of-ravens', 'Cacophony (Recharge 6)', seed);
      if (!has(state, BREN, 'deafened')) continue;
      // SRD Lesser Restoration names the condition and says nothing about the
      // cause; `liftConditionFrom` is the same `condition-removed`. The mode's
      // lifetime is the instance's, so it goes in the same breath.
      const cured = after(state, unwrap(liftConditionFrom(state, BREN, 'deafened'), 'cure'));
      expect(has(cured, BREN, 'deafened')).toBe(false);
      expect(cured.creatures[BREN]!.rollModifiers).toEqual([]);
      expect(modesOn(cured, BREN, 'ability-check')).toEqual([]);
      return;
    }
    throw new Error('no seed failed the save');
  });

  it('hangs nothing on a Gelatinous Cube the Deafened never reached, and says so', () => {
    for (const seed of SEEDS) {
      const { out, state } = forced(
        'swarm-of-ravens',
        'Cacophony (Recharge 6)',
        seed,
        [CUBE],
        [{ id: CUBE, monster: 'gelatinous-cube' }],
      );
      const [one] = out.outcomes;
      if (one!.save.success) continue;
      expect(one!.immuneTo).toEqual(['deafened']);
      // A grant sourced to an instance that was never created would be a
      // Disadvantage nothing could ever lift, so it is not written — and the
      // caller is told, which is the honesty `immuneTo` already has.
      expect(state.creatures[CUBE]!.rollModifiers).toEqual([]);
      expect(out.unverified.some((line) => line.includes('Deafened'))).toBe(true);
      return;
    }
    throw new Error('no seed failed the save');
  });
});

/**
 * SRD Dretch, Fetid Cloud: "While Poisoned, the creature can take either an
 * action or a Bonus Action on its turn, not both, and it can't take
 * Reactions." SRD Copper Dragon Wyrmling, Slowing Breath: "The target can't
 * take Reactions; its Speed is halved; and it can take either an action or a
 * Bonus Action on its turn, not both. This effect lasts until the end of its
 * next turn."
 *
 * Two dressings of one rule, and both lifetimes the vocabulary offers: the
 * Dretch's hangs on the condition instance the same failure created, exactly
 * as the Ravens' Disadvantage does, and the Copper Dragon's hangs under a
 * `grants` timer, exactly as the Steam Mephit's Speed cut does. Nothing new
 * below either of them — the `one-of` rule is `combat.ts`'s and the halving is
 * `SpeedChange`'s, both of which SRD Slow already needed.
 */
describe('a rule a failure puts on the target’s turn', () => {
  const rulesOn = (state: GameState, who: CharacterId) =>
    [...(state.creatures[who]?.actionRules ?? [])].map((held) => held.rule);

  /** The engine's own door onto "may this slot be spent", with the rules standing. */
  const maySpend = (
    state: GameState,
    who: CharacterId,
    slot: 'action' | 'bonus-action' | 'reaction',
  ) =>
    canSpendSlot(state.combat!, who, slot, state.creatures[who]!.conditions, {
      rules: actionRulesOn(state, who),
    });

  describe('the Dretch’s cloud, whose lifetime is the Poisoned it imposed', () => {
    const CLOUD = 'Fetid Cloud (1/Day)';
    const SOURCE = `poisoned:printed:${FOE}:${CLOUD}`;

    const poisoned = () => {
      for (const seed of SEEDS) {
        const one = forced('dretch', CLOUD, seed);
        if (has(one.state, BREN, 'poisoned')) return one;
      }
      throw new Error('no seed failed the save');
    };

    it('reads the line whole, with nothing left for the table', () => {
      const seen: { success: boolean }[] = [];
      for (const seed of SEEDS) {
        const { out, state } = forced('dretch', CLOUD, seed);
        const [one] = out.outcomes;
        seen.push({ success: one!.save.success });
        // The sentence used to come back in `unverified` at every use. It is
        // applied now, so nothing about the coupling is handed over.
        expect(out.unverified.some((line) => line.includes('either an action'))).toBe(false);
        if (one!.save.success) expect(rulesOn(state, BREN)).toEqual([]);
      }
      bothBranches(seen);
    });

    it('hangs both rules on the condition instance, with no deadline of their own', () => {
      const { state } = poisoned();
      expect(state.creatures[BREN]!.actionRules.map((held) => held.source)).toEqual([
        SOURCE,
        SOURCE,
      ]);
      // The instance is the deadline, so no `grants` timer stands beside it —
      // the reading the Ravens' Disadvantage already takes.
      expect(
        Object.values(state.timers).some((t) => t.target.kind === 'grants' && t.target.on === BREN),
      ).toBe(false);
      expect(rulesOn(state, BREN)).toEqual([
        { kind: 'forbids', slots: ['reaction'] },
        { kind: 'one-of', slots: ['action', 'bonus-action'] },
      ]);
    });

    it('couples the two slots and takes the Reaction away, live', () => {
      const { state } = poisoned();
      const theirTurn = applyEvent(state, { type: 'turn-advanced' });

      // The Reaction is gone outright: the second half of the same sentence.
      const reaction = maySpend(theirTurn, BREN, 'reaction');
      expect(reaction.ok ? 'permitted' : reaction.code).toBe('action_forbidden');

      // And either slot may be taken, but not both. The Dodge is a real
      // command spending a real Action; the Bonus Action has no spender a
      // level 1 Fighter holds, so the budget is asked at the engine's own
      // door — which is the door every Bonus Action command goes through.
      expect(maySpend(theirTurn, BREN, 'bonus-action').ok).toBe(true);
      const dodged = after(theirTurn, unwrap(takeDodge(theirTurn, BREN, {}), 'dodge'));
      const refused = maySpend(dodged, BREN, 'bonus-action');
      expect(refused.ok ? 'permitted' : refused.code).toBe('slot_foreclosed');
    });

    it('lifts all of it when the printed span ends the Poisoned', () => {
      const { state } = poisoned();
      // "until the end of its next turn" — the target's. The dretch went
      // first, so Bren's turn and the end of it is the moment.
      const later = applyEvent(applyEvent(state, { type: 'turn-advanced' }), {
        type: 'turn-advanced',
      });
      expect(has(later, BREN, 'poisoned')).toBe(false);
      expect(later.creatures[BREN]!.actionRules).toEqual([]);
    });

    it('lifts all of it when a Lesser Restoration ends the Poisoned early', () => {
      const { state } = poisoned();
      const cured = after(state, unwrap(liftConditionFrom(state, BREN, 'poisoned'), 'cure'));
      expect(has(cured, BREN, 'poisoned')).toBe(false);
      expect(cured.creatures[BREN]!.actionRules).toEqual([]);
      expect(maySpend(applyEvent(cured, { type: 'turn-advanced' }), BREN, 'reaction').ok).toBe(
        true,
      );
    });

    it('hangs nothing on a Zombie the Poisoned never reached, and says so', () => {
      for (const seed of SEEDS) {
        const { out, state } = forced('dretch', CLOUD, seed, [ZOMBIE], [
          { id: ZOMBIE, monster: 'zombie' },
        ]);
        if (out.outcomes[0]!.save.success) continue;
        expect(out.outcomes[0]!.immuneTo).toEqual(['poisoned']);
        // A grant sourced to an instance nobody created would be a coupling
        // nothing could ever lift, so it is not written — and the caller is
        // told, exactly as the Ravens' Disadvantage tells them.
        expect(state.creatures[ZOMBIE]!.actionRules).toEqual([]);
        expect(out.unverified.some((line) => line.includes('Poisoned'))).toBe(true);
        return;
      }
      throw new Error('no seed failed the save');
    });
  });

  describe('the Copper Dragon’s breath, whose lifetime is a printed span', () => {
    const breathed = () => {
      for (const seed of SEEDS) {
        const one = forced('copper-dragon-wyrmling', 'Slowing Breath', seed);
        if (!one.out.outcomes[0]!.save.success) return one;
      }
      throw new Error('no seed failed the save');
    };

    it('halves the Speed, couples the slots and takes the Reaction away', () => {
      const seen: { success: boolean }[] = [];
      for (const seed of SEEDS) {
        const { out, state } = forced('copper-dragon-wyrmling', 'Slowing Breath', seed);
        seen.push({ success: out.outcomes[0]!.save.success });
        // The area is the table's; every sentence of the failure is read.
        expect(out.unverified).toEqual([
          `Slowing Breath reads "each creature in a 15-foot Cone" — the engine rolled the save for the creatures named and measured no area; who stands in it is the table's`,
        ]);
        if (out.outcomes[0]!.save.success) {
          expect(speedOf(state, BREN)).toBe(30);
          expect(rulesOn(state, BREN)).toEqual([]);
          continue;
        }
        expect(speedOf(state, BREN)).toBe(15);
        expect(rulesOn(state, BREN)).toEqual([
          { kind: 'forbids', slots: ['reaction'] },
          { kind: 'one-of', slots: ['action', 'bonus-action'] },
        ]);
      }
      bothBranches(seen);
    });

    it('holds the three under deadlines that end together', () => {
      const { out, state } = breathed();
      // **Two timers and two events.** The two rules share a source, because
      // `actionRuleKey` tells two statements of one source apart and one
      // ending takes both — so a timer is raised once per source rather than
      // once per clause, and the log says so as well as the state.
      expect(out.events.filter((e) => e.type === 'effect-scheduled')).toHaveLength(2);
      const deadlines = Object.values(state.timers)
        .filter((t) => t.target.kind === 'grants' && t.target.on === BREN)
        .map((t) => t.deadline);
      // Two sourced grants under two timers — the rules share one source and
      // the halving has its own, because `speed-modifier-granted` is keyed by
      // the source alone and a line may cut *and* halve.
      expect(deadlines).toHaveLength(2);
      for (const deadline of deadlines) expect(deadline).toMatchObject({ kind: 'turn-end', of: BREN });
    });

    it('gives it all back at the end of the target’s next turn', () => {
      const { state } = breathed();
      const later = applyEvent(applyEvent(state, { type: 'turn-advanced' }), {
        type: 'turn-advanced',
      });
      expect(speedOf(later, BREN)).toBe(30);
      expect(later.creatures[BREN]!.actionRules).toEqual([]);
    });

    it('couples the two slots while it stands', () => {
      const { state } = breathed();
      const theirTurn = applyEvent(state, { type: 'turn-advanced' });
      expect(maySpend(theirTurn, BREN, 'bonus-action').ok).toBe(true);
      const dodged = after(theirTurn, unwrap(takeDodge(theirTurn, BREN, {}), 'dodge'));
      const refused = maySpend(dodged, BREN, 'bonus-action');
      expect(refused.ok ? 'permitted' : refused.code).toBe('slot_foreclosed');
    });
  });
});

describe('a failure that kills', () => {
  /**
   * The wisp, a goblin already down, and the line forced on it.
   *
   * SRD Will-o'-Wisp: "one living creature the wisp can see within 5 feet
   * **that has 0 Hit Points**." The ceiling is the line's own, so the fixture
   * has to put somebody under it before the save is thrown.
   */
  function overTheDying(seed: string, hitPoints: number, who: CharacterId = BREN) {
    const table = inTheWoods('will-o-wisp', [{ id: GRISH, monster: 'goblin-warrior' }]);
    let state = table.state;
    const standing = state.creatures[who]!.vitals.hp;
    if (hitPoints < standing) {
      state = after(
        state,
        unwrap(
          damageCreature(state, who, { amount: standing - hitPoints, source: 'a falling rock' }),
          `downing ${who}`,
        ),
      );
    }
    const out = unwrap(
      forcePrintedSave(
        state,
        FOE,
        { line: 'Consume Life', targets: [who], commandId: `wisp-${seed}` },
        supply(seed),
      ),
      'Consume Life',
    );
    return { before: state, out, state: after(state, out.events) };
  }

  it("kills the Will-o'-Wisp's target outright and heals the wisp by the dice it rolled", () => {
    for (const seed of SEEDS) {
      const { before, out, state } = overTheDying(seed, 0);
      if (out.outcomes[0]!.save.success) continue;
      // Death rather than damage: the target does not drop to 0, it dies, and
      // the outcome says so rather than leaving a caller to read a nought.
      expect(out.outcomes[0]!.damage).toBe(0);
      expect(out.outcomes[0]!.died).toBe(true);
      expect(state.creatures[BREN]!.vitals.dead).toBe(true);
      expect(out.events.some((e) => e.type === 'creature-died')).toBe(true);
      expect(out.events.some((e) => e.type === 'damage-taken')).toBe(false);

      // "and the wisp regains 10 (3d6) Hit Points" — the block's dice, thrown
      // by the engine, in the range 3d6 can reach and no further.
      const healed = out.events.find((e) => e.type === 'healed');
      expect(healed, 'the wisp regained nothing').toBeDefined();
      const amount = (healed as { amount: number }).amount;
      expect(amount).toBeGreaterThanOrEqual(3);
      expect(amount).toBeLessThanOrEqual(18);
      // Capped at its own maximum, which is `heal`'s rule and not this one's.
      expect(state.creatures[FOE]!.vitals.hp).toBe(
        Math.min(
          before.creatures[FOE]!.vitals.hpMax,
          before.creatures[FOE]!.vitals.hp + amount,
        ),
      );
      // And the generator's position is written back, once, for everything
      // this command threw — the save and the healing dice alike.
      expect(out.events.filter((e) => e.type === 'rolls-issued')).toHaveLength(1);
      return;
    }
    throw new Error('no seed failed the save');
  });

  it('kills nobody above the ceiling the line prints, and says so', () => {
    for (const seed of SEEDS) {
      const { before, out, state } = overTheDying(seed, 3);
      if (out.outcomes[0]!.save.success) continue;
      // The save was thrown and failed, and the line still reached nobody it
      // could kill: a DC 10 Constitution save does not kill a creature with
      // hit points left, however the die fell.
      expect(state.creatures[BREN]!.vitals.dead).toBe(false);
      expect(out.outcomes[0]!.died).toBeUndefined();
      expect(out.events.some((e) => e.type === 'creature-died')).toBe(false);
      // And the wisp regained nothing, because nothing died.
      expect(state.creatures[FOE]!.vitals.hp).toBe(before.creatures[FOE]!.vitals.hp);
      expect(
        out.unverified.some((line) => line.includes('0 Hit Points or fewer')),
        JSON.stringify(out.unverified),
      ).toBe(true);
      return;
    }
    throw new Error('no seed failed the save');
  });

  it('does not make a corpse deader, and buys the wisp nothing for it', () => {
    // A Goblin Warrior brought to 0 is a Goblin Warrior dead: a monster does
    // not lie there making death saves. Forcing the line over the body is the
    // reading `declareCreatureDead` already takes of the same event —
    // nothing is written, and nothing is regained for it.
    let saw = false;
    for (const seed of SEEDS) {
      const { before, out, state } = overTheDying(seed, 0, GRISH);
      expect(before.creatures[GRISH]!.vitals.dead).toBe(true);
      if (out.outcomes[0]!.save.success) continue;
      expect(out.outcomes[0]!.died).toBeUndefined();
      expect(out.events.some((e) => e.type === 'creature-died')).toBe(false);
      expect(out.events.some((e) => e.type === 'healed')).toBe(false);
      expect(state.creatures[FOE]!.vitals.hp).toBe(before.creatures[FOE]!.vitals.hp);
      saw = true;
    }
    expect(saw, 'no seed failed the save').toBe(true);
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

/**
 * The second rung with a lifetime of its own.
 *
 * SRD Brass Dragon Wyrmling's Sleep Breath deepens into "the Unconscious
 * condition **for 1 minute**" and SRD Silver Dragon Wyrmling's Paralyzing
 * Breath into a Paralyzed that "repeats the save at the end of each of its
 * turns, ending the effect on itself on a success. After 1 minute, it succeeds
 * automatically." Both rungs are the Gorgon's deepening with something more on
 * it, and the something is what the deeper condition is **ended by**: a span
 * on the clock for one and a standing save for the other.
 *
 * The first rung of both is the sentence that names one moment twice — "until
 * the end of its next turn, at which point it repeats the save" — so the
 * shallow condition carries no deadline and the save is what changes it.
 */
describe('a deepening with a lifetime of its own', () => {
  /** End the current turn, rolling whatever the boundary owes. */
  const turn = (state: GameState, seed: string, bonuses: readonly Bonus[] = []) => {
    const out = unwrap(
      resolveTurn(state, supply(seed, bonuses), { commandId: `turn-${seed}` }),
      'turn',
    );
    return { state: after(state, out.events), saves: out.saves };
  };

  /** Force the line until a seed fails the save, and take the world it left. */
  const caught = (monster: string, line: string): { state: GameState; unverified: readonly string[] } => {
    for (const seed of SEEDS) {
      const { out, state } = forced(monster, line, seed);
      if (!out.outcomes[0]!.save.success) return { state, unverified: out.unverified };
    }
    throw new Error(`no seed failed ${monster}'s ${line}`);
  };

  /** Round the order to the end of Bren's own turn, which is when the save falls. */
  const toBrensBoundary = (state: GameState, seed: string, bonuses: readonly Bonus[]) => {
    let world = state;
    for (let guard = 0; guard < 3; guard += 1) {
      const stepped = turn(world, `${seed}-${guard}`, bonuses);
      world = stepped.state;
      if (stepped.saves.length > 0) return { state: world, saves: stepped.saves };
    }
    throw new Error('the boundary never raised the save it owed');
  };

  it("sleeps the Brass Dragon's target for the minute the block prints", () => {
    const { state, unverified } = caught('brass-dragon-wyrmling', 'Sleep Breath');
    expect(has(state, BREN, 'incapacitated')).toBe(true);
    expect(has(state, BREN, 'unconscious')).toBe(false);

    // The first rung's repeat, with the second rung pinned onto it: the span
    // is the *deepening's* and the shallow condition has no deadline at all.
    const [first] = timersOn(state, BREN);
    expect(first?.deadline).toEqual({ kind: 'indefinite' });
    expect(first?.repeatSave).toMatchObject({
      at: 'end-of-turn',
      of: BREN,
      ability: 'con',
      dc: 11,
      onSuccess: 'end-on-target',
      onFailure: { condition: 'unconscious', lasts: { seconds: 60 } },
    });

    // The end of Bren's own next turn: the save is raised, missed, and what it
    // leaves behind is the deeper condition under a minute of its own.
    const { state: slept } = toBrensBoundary(state, 'brass', STILL_HELD);
    expect(has(slept, BREN, 'unconscious')).toBe(true);
    expect(has(slept, BREN, 'incapacitated')).toBe(true); // carried by the Unconscious
    const [deep] = timersOn(slept, BREN);
    expect(deep?.deadline).toEqual({ kind: 'elapsed', at: slept.elapsed + 60 });
    // And it asks nothing further: the book's "second" failure is the last.
    expect(deep?.repeatSave).toBeUndefined();

    // The minute passes and the sleeper wakes, with no save anywhere in it.
    const out = after(slept, unwrap(endCombat(slept, { kind: 'surrender', side: 'wild' }), 'end'));
    const nearly = after(out, unwrap(advanceTime(out, 59, 'the fight breaks up'), 'a minute less one'));
    expect(has(nearly, BREN, 'unconscious')).toBe(true);
    const after60 = after(nearly, unwrap(advanceTime(nearly, 1, 'the last second'), 'the minute'));
    expect(has(after60, BREN, 'unconscious')).toBe(false);
    expect(timersOn(after60, BREN)).toEqual([]);

    // And the two endings the rung prints are the engine's now rather than a
    // sentence handed over: nothing of this line is carried but the Cone.
    expect(unverified.some((one) => one.includes('This effect ends for the target'))).toBe(false);
    expect(unverified).toHaveLength(1);
  });

  /**
   * "This effect ends for the target if it takes damage or a creature within 5
   * feet of it takes an action to wake it."
   *
   * Two endings on the **deepened** Unconscious, and on that condition alone;
   * the minute above is what the sleeper gets when nobody does either.
   */
  it("wakes the Brass Dragon's sleeper on a blow and on a neighbour's action", () => {
    const asleep = () => {
      const { state } = caught('brass-dragon-wyrmling', 'Sleep Breath');
      const { state: slept } = toBrensBoundary(state, 'brass', STILL_HELD);
      expect(has(slept, BREN, 'unconscious')).toBe(true);
      return slept;
    };

    const slept = asleep();
    const struck = after(
      slept,
      unwrap(
        damageCreature(slept, BREN, { amount: 3, source: 'a falling rock', commandId: 'rock' }),
        'a rock',
      ),
    );
    expect(has(struck, BREN, 'unconscious')).toBe(false);
    expect(timersOn(struck, BREN)).toEqual([]);

    const dozing = asleep();
    expect(wakeableOn(dozing, BREN)).toHaveLength(1);
    const shaken = after(
      dozing,
      unwrap(wakeCreature(dozing, FOE, { target: BREN }, { commandId: 'shake' }), 'shaking'),
    );
    expect(has(shaken, BREN, 'unconscious')).toBe(false);
    expect(timersOn(shaken, BREN)).toEqual([]);
  });

  it("paralyses the Silver Dragon's target until it shakes it off or the minute is up", () => {
    const { state } = caught('silver-dragon-wyrmling', 'Paralyzing Breath');
    expect(has(state, BREN, 'incapacitated')).toBe(true);

    const { state: held } = toBrensBoundary(state, 'silver', STILL_HELD);
    expect(has(held, BREN, 'paralyzed')).toBe(true);
    expect(has(held, BREN, 'incapacitated')).toBe(true); // carried by the Paralyzed

    // A repeat of its own on the deeper condition, under the minute after
    // which the block says the save succeeds automatically.
    const [deep] = timersOn(held, BREN);
    expect(deep?.deadline).toEqual({ kind: 'elapsed', at: held.elapsed + 60 });
    expect(deep?.repeatSave).toMatchObject({
      at: 'end-of-turn',
      of: BREN,
      ability: 'con',
      dc: 13,
      onSuccess: 'end-on-target',
    });
    expect(deep?.repeatSave?.onFailure).toBeUndefined();

    // A failed repeat keeps it and asks again at the next boundary, which is
    // the difference between this rung and the Brass Dragon's.
    const { state: stillHeld, saves } = toBrensBoundary(held, 'silver-again', STILL_HELD);
    expect(saves.map((one) => one.dc)).toEqual([13]);
    expect(has(stillHeld, BREN, 'paralyzed')).toBe(true);

    // And a made one ends it on this target, which is the whole of what the
    // sentence says a success buys.
    const { state: freed, saves: made } = toBrensBoundary(stillHeld, 'shaken', SHAKEN_OFF);
    expect(made.map((one) => one.success)).toEqual([true]);
    expect(has(freed, BREN, 'paralyzed')).toBe(false);
    expect(timersOn(freed, BREN)).toEqual([]);
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
      // Either way nothing of this line is carried but the targeting clause:
      // the early endings the book prints are the engine's now.
      expect(out.unverified.some((line) => line.includes('which ends early if'))).toBe(false);
      expect(out.unverified).toHaveLength(1);
      if (12 - one!.save.total >= 5) {
        expect(wakeableOn(state, GRISH)).toHaveLength(1);
        // The goblin is fifteen feet from the pseudodragon, so the shake is
        // written as the fact the fold reads rather than spent from here —
        // `waking-a-sleeper.test.ts` drives the Action and the five feet.
        const woken = applyEvent(state, { type: 'creature-woken', id: GRISH, by: BREN });
        expect(has(woken, GRISH, 'unconscious')).toBe(false);
        // **The hour of Poison is not what a shake ends.** The book's "which"
        // names the Unconscious, and the Poisoned carrying it runs on — which
        // is the whole reason the two marks are names rather than a flag.
        expect(has(woken, GRISH, 'poisoned')).toBe(true);
      }
    }
    expect(deep, 'no seed missed by five').toBe(true);
    expect(shallow, 'no seed missed by less than five').toBe(true);
  });
});

/**
 * SRD Ghost: "_Success:_ The target is immune to this ghost's Horrific Visage
 * for 24 hours." SRD Mummy's Dreadful Glare prints it word for word.
 *
 * **An immunity to one printed line**, which is the whole of the reading: a
 * creature that shrugged off the visage is still Frightenable by everything
 * else in the room, and what it has bought is a day's grace from *this*
 * creature's *this* line.
 */
describe("a success that buys a day's grace from the line itself", () => {
  /** A seed whose save Bren makes, and one Bren misses. */
  const madeIt = (monster: string, line: string, want: boolean): string => {
    for (const seed of SEEDS) {
      const { out } = forced(monster, line, seed);
      if (out.outcomes[0]!.save.success === want) return seed;
    }
    throw new Error(`no seed ${want ? 'made' : 'missed'} the save`);
  };

  it('grants it on a success, hangs a day on it, and skips the next glare', () => {
    const seed = madeIt('ghost', 'Horrific Visage', true);
    const { out, state } = forced('ghost', 'Horrific Visage', seed);
    expect(out.outcomes[0]!.save.success).toBe(true);
    expect(has(state, BREN, 'frightened')).toBe(false);

    const [held] = state.creatures[BREN]!.lineImmunities;
    expect(held).toMatchObject({ by: FOE, line: 'Horrific Visage' });
    // A `grants` deadline of a printed day, which is what ends it.
    const grant = Object.values(state.timers).find(
      (timer) => timer.target.kind === 'grants' && timer.target.on === BREN,
    );
    expect(grant?.deadline).toEqual({ kind: 'elapsed', at: state.elapsed + 86400 });

    // The same ghost's next visage does not reach them at all: no save is
    // rolled, no outcome is reported, and the caller is told why. A round
    // later, so the ghost has an Action to spend on it.
    const round = (from: GameState, tag: string): GameState => {
      let current = from;
      for (let step = 0; step < 2; step += 1) {
        current = after(current, unwrap(resolveTurn(current, supply(`${tag}-${step}`)), 'a turn').events);
      }
      return current;
    };
    const later = round(state, `${seed}-round`);
    const again = unwrap(
      forcePrintedSave(
        later,
        FOE,
        { line: 'Horrific Visage', targets: [BREN], commandId: 'again' },
        supply(`${seed}-again`),
      ),
      'a second visage',
    );
    expect(again.outcomes).toEqual([]);
    expect(again.events.some((event) => event.type === 'roll-recorded')).toBe(false);
    expect(again.unverified.some((one) => one.includes('is immune to foe'))).toBe(true);

    // And the day running out gives them back: the deadline is the whole of
    // the lifetime, exactly as it is for the seventeen grants beside it.
    const done = after(state, unwrap(endCombat(state, { kind: 'surrender', side: 'wild' }), 'end'));
    const tomorrow = after(done, unwrap(advanceTime(done, 86400, 'a day and a night'), 'a day'));
    expect(tomorrow.creatures[BREN]!.lineImmunities).toEqual([]);
  });

  it('buys nothing on a failure, and nothing against a different creature', () => {
    const seed = madeIt('ghost', 'Horrific Visage', false);
    const { state } = forced('ghost', 'Horrific Visage', seed);
    expect(has(state, BREN, 'frightened')).toBe(true);
    expect(state.creatures[BREN]!.lineImmunities).toEqual([]);

    // A second ghost's visage still catches a creature the first one spared:
    // the grace is one creature's one heading and not the Frightened
    // condition. The two are told apart by the source the grant carries.
    const made = madeIt('ghost', 'Horrific Visage', true);
    const spared = forced('ghost', 'Horrific Visage', made).state;
    const other = id('wraith');
    const withOther = after(
      spared,
      unwrap(addCreature(spared, SRD_CONTENT, other, 'ghost'), 'a second ghost').events,
    );
    const shielded = withOther.creatures[BREN]!.lineImmunities;
    expect(shielded.map((one) => one.by)).toEqual([FOE]);
    expect(
      shielded.some((one) => one.source === `printed:${other}:Horrific Visage`),
    ).toBe(false);
  });

  it("grants it on the Mummy's glare too, under that mummy's own heading", () => {
    const seed = madeIt('mummy', 'Dreadful Glare', true);
    const { state } = forced('mummy', 'Dreadful Glare', seed);
    expect(state.creatures[BREN]!.lineImmunities.map((one) => one.line)).toEqual([
      'Dreadful Glare',
    ]);
  });
});

/**
 * SRD Water Elemental's Whelm: "Until the grapple ends, the target has the
 * Restrained condition, is suffocating unless it can breathe water, and takes
 * 9 (2d8) Bludgeoning damage **at the start of each of the elemental's
 * turns**."
 *
 * A hold that owes a payout, on the save side — the arrangement the attach
 * track built on the hit side, reached through a saving throw instead of an
 * attack roll. The suffocation, the limb count and the neighbour's pull are
 * carried with the line's own words.
 */
describe('a hold that owes a payout at its holder boundary', () => {
  it('grapples, restrains, and pays 2d8 at the start of each of the elemental turns', () => {
    for (const seed of SEEDS) {
      const { out, state } = forced('water-elemental', 'Whelm (Recharge 4–6)', seed);
      if (out.outcomes[0]!.save.success) continue;
      expect(has(state, BREN, 'grappled')).toBe(true);
      // "Until the grapple ends, the target has the Restrained condition":
      // carried by the hold, so the escape lifts both.
      expect(has(state, BREN, 'restrained')).toBe(true);

      // **The arrangement sits on the elemental and names the other end**, so
      // its own boundary collects it and the damage lands on what it holds.
      const [owed] = state.creatures[FOE]!.payouts;
      expect(owed).toEqual({
        source: `grapple:${FOE}`,
        at: 'start-of-turn',
        payout: 'damage',
        dice: '2d8',
        flat: 0,
        damageType: 'bludgeoning',
        to: BREN,
      });

      // It falls due at the elemental's next turn and lands on the creature
      // it is holding, a round away from the target's own boundary. The blow
      // is what the assertion reads rather than the hit points: the whelm's
      // own 4d8 + 4 may already have put Bren on the floor.
      const paidBy = (from: GameState, tag: string): readonly GameEvent[] => {
        const round = unwrap(resolveTurn(from, supply(`${tag}-1`)), 'bren finishes');
        const mid = after(from, round.events);
        const back = unwrap(resolveTurn(mid, supply(`${tag}-2`)), 'round to the elemental');
        return back.events.filter(
          (event) => event.type === 'damage-taken' && event.id === BREN && event.by === FOE,
        );
      };
      expect(paidBy(state, seed)).toHaveLength(1);

      // And the escape stops it: `holdStillStands` reads the source.
      const freed = after(
        state,
        unwrap(
          liftConditionFrom(state, BREN, 'grappled', `grapple:${FOE}`, { commandId: 'wriggle' }),
          'the escape',
        ),
      );
      expect(has(freed, BREN, 'restrained')).toBe(false);
      expect(paidBy(freed, `${seed}-free`)).toEqual([]);

      // The three sentences the reader carried reach the table at the moment
      // of use, in the book's own words.
      expect(out.unverified.some((one) => one.includes('suffocating unless it can breathe water'))).toBe(true);
      expect(out.unverified.some((one) => one.includes('one Large creature or up to two Medium'))).toBe(true);
      expect(out.unverified.some((one) => one.includes('pull a creature out of it'))).toBe(true);
      return;
    }
    throw new Error('no seed failed the save');
  });
});

/**
 * SRD Vampire Spawn's Bite: "_Failure:_ 5 (1d4 + 3) Piercing damage plus 10
 * (3d6) Necrotic damage. The target's Hit Point maximum decreases by an amount
 * equal to the **Necrotic** damage taken, and the vampire regains Hit Points
 * equal to that amount."
 *
 * Three readings in one sentence: the component the maximum follows, the
 * regain that is not a roll, and the targeting clause that says who may be
 * bitten at all.
 */
describe('a bite that feeds', () => {
  /** The vampire's line reaches a creature that is held, or one that agrees. */
  const bite = (
    state: GameState,
    targets: readonly CharacterId[],
    seed: string,
    willing?: readonly CharacterId[],
  ) =>
    forcePrintedSave(
      state,
      FOE,
      {
        line: 'Bite',
        targets,
        commandId: `bite-${seed}`,
        ...(willing === undefined ? {} : { willing }),
      },
      supply(seed),
    );

  it('asks about a target that is neither held nor declared willing', () => {
    const table = inTheWoods('vampire-spawn');
    const asked = bite(table.state, [BREN], 'a');
    expect(asked.ok).toBe(false);
    if (!asked.ok) {
      expect(asked.code).toBe('undeclared_consent');
      expect(asked.kind).toBe('needs-context');
    }
  });

  it("lowers the maximum by the Necrotic alone and feeds the vampire the same", () => {
    for (const seed of SEEDS) {
      const table = inTheWoods('vampire-spawn');
      // Grappled, which is one of the three the targeting clause names.
      const held = after(
        table.state,
        unwrap(
          applyConditionTo(table.state, BREN, 'grappled', `grapple:${FOE}`, [], undefined, undefined, {
            commandId: 'seized',
          }),
          'the grapple',
        ),
      );
      // The vampire starts hurt, so a regain has somewhere to go.
      const hurt = after(
        held,
        unwrap(
          damageCreature(held, FOE, { amount: 20, source: 'a torch', commandId: 'burn' }),
          'burning the vampire',
        ),
      );
      const fangs = hurt.creatures[FOE]!.vitals.hp;

      const out = unwrap(bite(hurt, [BREN], seed), 'the bite');
      if (out.outcomes[0]!.save.success) continue;
      const bitten = after(hurt, out.events);

      // The **Necrotic** component alone, out of a blow that was Piercing
      // and Necrotic at once: the lowered maximum is less than the damage.
      const [lowered] = bitten.creatures[BREN]!.hitPointMaxima;
      const necrotic = -lowered!.amount;
      expect(necrotic).toBeGreaterThan(0);
      expect(necrotic).toBeLessThan(out.outcomes[0]!.damage);
      expect(bitten.creatures[BREN]!.vitals.hpMax).toBe(
        held.creatures[BREN]!.vitals.hpMax - necrotic,
      );

      // "and the vampire regains Hit Points equal to that amount" — the same
      // number, with no dice anywhere in it.
      expect(bitten.creatures[FOE]!.vitals.hp).toBe(fangs + necrotic);
      // And nothing of the line is carried but the clause about who it caught.
      expect(out.unverified).toHaveLength(1);
      return;
    }
    throw new Error('no seed failed the save');
  });

  it('lands on a creature the DM says is willing', () => {
    const table = inTheWoods('vampire-spawn');
    const out = unwrap(bite(table.state, [BREN], 'b', [BREN]), 'a willing throat');
    expect(out.outcomes).toHaveLength(1);
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
