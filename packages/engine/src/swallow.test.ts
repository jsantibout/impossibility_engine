import { SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import { asCharacterId, expect as unwrap, isErr, isNeedsContext, type Result } from '@ie/shared';
import {
  addCreature,
  addSceneLandmark,
  beginCombat,
  damageCreature,
  declareCreatureSide,
  declareSightBetween,
  placeCreatureInScene,
  resolveAttack,
  resolveSpell,
  resolveTurn,
  returnFromElsewhere,
  setScene,
  takePrintedPlaneShift,
  takePrintedSwallow,
} from './commands.js';
import { createRng, restoreRng, type Rng } from './dice.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { createRollIssuer } from './rolls.js';
import { createCharacter, type CharacterChoices } from './creation.js';
import { elsewhereOf } from './elsewhere.js';
import { distanceBetween, positionOf } from './positioning.js';
import { grapplesOn } from './commands/unarmed.js';
import { declaredCasting } from './spellcasting.js';

/**
 * The bestiary's two roads into the second place.
 *
 * SRD Giant Frog, Swallow: "The frog swallows a Small or smaller target it is
 * grappling. While swallowed, the target isn't Grappled but has the Blinded
 * and Restrained conditions, and it has Total Cover against attacks and other
 * effects outside the frog … At the end of the frog's next turn, the swallowed
 * target takes 5 (2d4) Acid damage. If that damage doesn't kill it, the frog
 * disgorges it, causing it to exit Prone." SRD Ghost, Etherealness; SRD
 * Nightmare, Ethereal Stride: out of the scene and back by the same line.
 */

const id = (s: string) => asCharacterId(s);
const ROSIE = id('rosie');
const PIP = id('pip');
const FROG = id('frog');
const GHOST = id('ghost');
const NIGHTMARE = id('nightmare');
const WIZARD = id('wizard');

/** A Small fighter — SRD Halfling — for the frog to swallow. */
const halfling = (name: string): CharacterChoices => ({
  name,
  classId: 'fighter',
  level: 1,
  speciesId: 'halfling',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
  },
  abilityIncreases: { con: 2, int: 1 },
  classSkills: ['athletics', 'survival'],
  languages: ['Dwarvish', 'Orc'],
  alignment: 'Neutral',
  cantrips: [],
  spellbook: [],
  preparedSpells: [],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: { 'fighter:weapon-mastery': [] },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int',
      cantrips: ['mage-hand', 'light'],
      levelOneSpell: 'find-familiar',
    },
    'fighter:fighting-style': { featId: 'archery' },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
});

const supply = (state: GameState, seed = 'lily-pad') => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: (state.rng === null ? createRng(seed) : restoreRng(state.rng)) as Rng,
  content: SRD_CONTENT,
});

class Table {
  readonly log: GameEvent[] = [];
  get state(): GameState {
    return fold('gulp', this.log);
  }
  do(step: string, produce: (state: GameState) => Result<readonly GameEvent[]>): GameState {
    this.log.push(...unwrap(produce(this.state), step));
    return this.state;
  }
  did(step: string, produce: (state: GameState) => Result<{ readonly events: readonly GameEvent[] }>): GameState {
    this.log.push(...unwrap(produce(this.state), step).events);
    return this.state;
  }
}

const SWALLOW = SRD_CONTENT.monsterById('giant-frog')!.actions.find((line) => line.name === 'Swallow')!.name;

/** Rosie and Pip by the pond, the frog beside Rosie and holding her, and a wizard watching. */
const atThePond = (): Table => {
  const table = new Table();
  table.do('Rosie arrives', () => createCharacter(SRD_CONTENT, halfling('Rosie'), ROSIE));
  table.do('Pip arrives', () => createCharacter(SRD_CONTENT, halfling('Pip'), PIP));
  table.did('the frog arrives', (s) => addCreature(s, SRD_CONTENT, FROG, 'giant-frog'));
  table.log.push({
    type: 'creature-added',
    id: WIZARD,
    name: 'wizard',
    sheet: {
      level: 5,
      abilities: { str: 10, dex: 10, con: 10, int: 16, wis: 10, cha: 10 },
      skills: {},
      saveProficiencies: [],
      armor: null,
      shield: null,
      armorTraining: { light: true, medium: true, heavy: true, shields: true },
      baseSpeed: 30,
      spellcastingAbility: 'int',
      weaponProficiencies: [],
    },
    maxHp: 30,
    diesAtZero: false,
    creatureType: 'Humanoid',
    side: 'party',
  });
  table.log.push({
    type: 'spellcasting-declared',
    id: WIZARD,
    spellcasting: declaredCasting({ ability: 'int', classId: 'wizard', prepared: ['fire-bolt'] }),
  });
  table.do('the pond', (s) => setScene(s, { width: 100, depth: 100, height: 20 }));
  table.do('the reeds', (s) => addSceneLandmark(s, 'the reeds', { x: 50, y: 50, z: 0 }));
  table.do('Rosie by the reeds', (s) => placeCreatureInScene(s, ROSIE, { from: { landmark: 'the reeds' }, feet: 0 }));
  table.do('the frog beside her', (s) => placeCreatureInScene(s, FROG, { from: { creature: ROSIE }, feet: 5, bearing: 90 }));
  table.do('Pip behind her', (s) => placeCreatureInScene(s, PIP, { from: { creature: ROSIE }, feet: 5, bearing: 270 }));
  table.do('the wizard at a distance', (s) => placeCreatureInScene(s, WIZARD, { from: { landmark: 'the reeds' }, feet: 30, bearing: 0 }));
  for (const who of [ROSIE, PIP, FROG]) {
    table.do('sight', (s) => declareSightBetween(s, WIZARD, who, true));
    table.do('sight back', (s) => declareSightBetween(s, who, WIZARD, true));
  }
  table.do('Rosie’s side', (s) => declareCreatureSide(s, ROSIE, 'party'));
  table.do('Pip’s side', (s) => declareCreatureSide(s, PIP, 'party'));
  table.do('the frog’s side', (s) => declareCreatureSide(s, FROG, 'wild'));
  table.do('the order', (s) =>
    beginCombat(s, [
      { id: FROG, initiative: 20, speed: 30 },
      { id: ROSIE, initiative: 10, speed: 25 },
      { id: PIP, initiative: 8, speed: 25 },
      { id: WIZARD, initiative: 5, speed: 30 },
    ]),
  );
  // The frog's Bite lands and its printed grapple takes hold; the frog's turn
  // then ends and comes round again, so the Swallow has an Action to spend.
  table.did('the bite', (s) =>
    resolveAttack(s, FROG, { target: ROSIE, weapon: null, action: 'Bite', attackBonuses: [{ source: 'forced', flat: 40 }] }, supply(s)),
  );
  for (const step of ['frog', 'rosie', 'pip', 'wizard']) {
    table.did(`${step}’s turn ends`, (s) => resolveTurn(s, supply(s), { commandId: `end ${step}` }));
  }
  return table;
};

describe('a Giant Frog’s Swallow', () => {
  it('needs a grappled target, asks whom, and refuses one it is not holding', () => {
    const table = atThePond();
    expect(grapplesOn(table.state, ROSIE).map((held) => held.grappler)).toEqual([FROG]);
    const whom = takePrintedSwallow(table.state, FROG, { line: SWALLOW });
    expect(isNeedsContext(whom) && isErr(whom) && whom.code === 'undeclared_swallow_target').toBe(true);
    const notHeld = takePrintedSwallow(table.state, FROG, { line: SWALLOW, target: PIP });
    expect(isErr(notHeld) && notHeld.code === 'not_grappling_target').toBe(true);
    const wrongLine = takePrintedSwallow(table.state, FROG, { line: 'Bite', target: ROSIE });
    expect(isErr(wrongLine) && wrongLine.code === 'no_such_line').toBe(true);
  });

  it('ends the grapple, hangs Blinded and Restrained, and takes Rosie inside', () => {
    const table = atThePond();
    const out = unwrap(takePrintedSwallow(table.state, FROG, { line: SWALLOW, target: ROSIE }), 'the swallow');
    table.log.push(...out.events);
    const state = table.state;
    expect(out.swallowed).toBe(ROSIE);
    expect(out.unverified.join(' ')).toContain("can't use Bite");
    expect(grapplesOn(state, ROSIE)).toEqual([]);
    expect(state.creatures[ROSIE]!.conditions.conditions).toEqual(['blinded', 'restrained']);
    const record = elsewhereOf(state, ROSIE);
    expect(record?.kind).toBe('inside');
    expect(record?.host).toBe(FROG);
    expect(record?.returns).toEqual({ within: 5, near: FROG, prone: true });
    expect(record?.damage).toMatchObject({ dice: '2d4', damageType: 'acid', disgorges: true });
    expect(positionOf(state.scene!, ROSIE)).toBeNull();
  });

  it('refuses a second target while one is inside, and a target too large', () => {
    const table = atThePond();
    table.did('the swallow', (s) => takePrintedSwallow(s, FROG, { line: SWALLOW, target: ROSIE }));
    // Pip grappled too, by a hand-written hold, so the cap is what refuses.
    table.log.push({ type: 'condition-applied', id: PIP, condition: 'grappled', source: 'grapple:frog' });
    const second = takePrintedSwallow(table.state, FROG, { line: SWALLOW, target: PIP, commandId: 'again' });
    expect(isErr(second) && second.code === 'already_holding_one').toBe(true);

    const fresh = atThePond();
    fresh.log.push({ type: 'condition-applied', id: WIZARD, condition: 'grappled', source: 'grapple:frog' });
    const big = takePrintedSwallow(fresh.state, FROG, { line: SWALLOW, target: WIZARD });
    expect(isErr(big) && big.code === 'too_large_to_swallow').toBe(true);
  });

  it('lets Rosie’s blade reach the frog and nothing else, and nothing reach her', () => {
    const table = atThePond();
    table.did('the swallow', (s) => takePrintedSwallow(s, FROG, { line: SWALLOW, target: ROSIE }));
    const state = table.state;
    expect(distanceBetween(state.scene!, ROSIE, FROG)).toEqual({ ok: true, value: 0 });
    const apart = distanceBetween(state.scene!, ROSIE, PIP);
    expect(isErr(apart) && apart.code === 'not_here').toBe(true);
    const bolt = resolveSpell(state, WIZARD, { spellId: 'fire-bolt', targets: [ROSIE] }, supply(state));
    expect(isErr(bolt) && bolt.code === 'not_here').toBe(true);
    // Her own turn: the frog is the one creature in reach.
    const frogDone = unwrap(resolveTurn(state, supply(state), { commandId: 'frog again' }), 'the frog’s turn');
    const herTurn = fold('gulp', [...table.log, ...frogDone.events]);
    const stab = resolveAttack(herTurn, ROSIE, { target: FROG, weapon: null }, supply(herTurn));
    expect(stab.ok).toBe(true);
    const wild = resolveAttack(herTurn, ROSIE, { target: PIP, weapon: null }, supply(herTurn));
    expect(wild.ok).toBe(false);
  });

  it('takes 2d4 Acid at the end of the frog’s next turn and is disgorged Prone where the caller says', () => {
    const table = atThePond();
    table.did('the swallow', (s) => takePrintedSwallow(s, FROG, { line: SWALLOW, target: ROSIE }));
    const before = table.state.creatures[ROSIE]!.vitals.hp;
    // "At the end of the frog's **next** turn": this turn's end is not it, and
    // the round comes back to the frog with Rosie still inside.
    for (const step of ['frog', 'rosie', 'pip', 'wizard']) {
      table.did(`${step}’s turn ends again`, (s) => resolveTurn(s, supply(s), { commandId: `end ${step} again` }));
    }
    expect(elsewhereOf(table.state, ROSIE)).not.toBeNull();
    expect(table.state.creatures[ROSIE]!.vitals.hp).toBe(before);
    const asked = resolveTurn(table.state, supply(table.state));
    expect(!asked.ok && asked.code === 'return_space_required').toBe(true);
    const done = unwrap(
      resolveTurn(table.state, supply(table.state), {
        returns: [{ who: ROSIE, to: { from: { creature: FROG }, feet: 5, bearing: 0 } }],
      }),
      'the frog’s turn',
    );
    table.log.push(...done.events);
    const state = table.state;
    expect(state.creatures[ROSIE]!.vitals.hp).toBeLessThan(before);
    expect(done.events.some((event) => event.type === 'damage-taken' && event.id === ROSIE)).toBe(true);
    expect(elsewhereOf(state, ROSIE)).toBeNull();
    expect(positionOf(state.scene!, ROSIE)).not.toBeNull();
    // Out, and Prone; the Blinded and the Restrained went with the record.
    // Whether the acid also dropped her is the dice's, so it is not asserted.
    const conditions = state.creatures[ROSIE]!.conditions.conditions;
    expect(conditions).toContain('prone');
    expect(conditions).not.toContain('blinded');
    expect(conditions).not.toContain('restrained');
  });

  it('frees a swallowed creature of the Restrained when the frog dies, and asks where she lands', () => {
    const table = atThePond();
    table.did('the swallow', (s) => takePrintedSwallow(s, FROG, { line: SWALLOW, target: ROSIE }));
    const held = returnFromElsewhere(table.state, ROSIE, {});
    expect(isErr(held) && held.code === 'no_way_back').toBe(true);
    table.do('the frog dies', (s) => damageCreature(s, FROG, { amount: 500, source: 'a boulder' }));
    const state = table.state;
    expect(state.creatures[FROG]!.vitals.dead).toBe(true);
    expect(state.creatures[ROSIE]!.conditions.conditions).toEqual(['blinded']);
    const where = returnFromElsewhere(state, ROSIE, {});
    expect(!where.ok && where.code === 'return_space_required').toBe(true);
    const tooFar = returnFromElsewhere(state, ROSIE, { to: { from: { creature: FROG }, feet: 10, bearing: 90 } });
    expect(isErr(tooFar) && tooFar.code === 'return_too_far').toBe(true);
    const out = unwrap(returnFromElsewhere(state, ROSIE, { to: { from: { creature: FROG }, feet: 5, bearing: 90 } }), 'the escape');
    const after = fold('gulp', [...table.log, ...out.events]);
    expect(after.creatures[ROSIE]!.conditions.conditions).toEqual(['prone']);
    expect(distanceBetween(after.scene!, ROSIE, FROG)).toEqual({ ok: true, value: 5 });
  });
});

describe('a step onto the Ethereal Plane', () => {
  const ETHEREALNESS = SRD_CONTENT.monsterById('ghost')!.actions.find((line) => line.name === 'Etherealness')!.name;
  const STRIDE = SRD_CONTENT.monsterById('nightmare')!.actions.find((line) => line.name === 'Ethereal Stride')!.name;

  const haunted = (): Table => {
    const table = new Table();
    table.did('the ghost arrives', (s) => addCreature(s, SRD_CONTENT, GHOST, 'ghost'));
    table.did('the nightmare arrives', (s) => addCreature(s, SRD_CONTENT, NIGHTMARE, 'nightmare'));
    table.do('Rosie arrives', () => createCharacter(SRD_CONTENT, halfling('Rosie'), ROSIE));
    table.do('Pip arrives', () => createCharacter(SRD_CONTENT, halfling('Pip'), PIP));
    table.do('the hall', (s) => setScene(s, { width: 200, depth: 200, height: 40 }));
    table.do('the hearth', (s) => addSceneLandmark(s, 'the hearth', { x: 100, y: 100, z: 0 }));
    table.do('the ghost', (s) => placeCreatureInScene(s, GHOST, { from: { landmark: 'the hearth' }, feet: 0 }));
    // The nightmare is Large: its box is 100..110 by 80..90. Rosie stands in
    // the cube touching its east flank, five feet off, and Pip ten feet south.
    table.do('the nightmare', (s) =>
      placeCreatureInScene(s, NIGHTMARE, { from: { landmark: 'the hearth' }, feet: 20, bearing: 180, size: 'large' }),
    );
    table.do('Rosie', (s) => placeCreatureInScene(s, ROSIE, { from: { point: { x: 110, y: 85, z: 0 } }, feet: 0 }));
    table.do('Pip', (s) => placeCreatureInScene(s, PIP, { from: { point: { x: 100, y: 70, z: 0 } }, feet: 0 }));
    table.do('sight', (s) => declareSightBetween(s, ROSIE, GHOST, true));
    table.do('the order', (s) =>
      beginCombat(s, [
        { id: GHOST, initiative: 20, speed: 40 },
        { id: NIGHTMARE, initiative: 15, speed: 60 },
        { id: ROSIE, initiative: 10, speed: 25 },
        { id: PIP, initiative: 5, speed: 25 },
      ]),
    );
    return table;
  };

  it('takes the Ghost out of reach and its own line brings it back to the spot it left', () => {
    const table = haunted();
    const out = unwrap(takePrintedPlaneShift(table.state, GHOST, { line: ETHEREALNESS }), 'the step out');
    table.log.push(...out.events);
    expect(out.direction).toBe('out');
    const away = table.state;
    expect(elsewhereOf(away, GHOST)?.kind).toBe('ethereal');
    expect(positionOf(away.scene!, GHOST)).toBeNull();
    const swing = resolveAttack(away, ROSIE, { target: GHOST, weapon: null }, supply(away));
    expect(swing.ok).toBe(false);
    // Round the order to the ghost's next turn.
    for (const step of ['ghost', 'nightmare', 'rosie', 'pip']) {
      table.did(`${step}’s turn ends`, (s) => resolveTurn(s, supply(s), { commandId: `end ${step}` }));
    }
    const back = unwrap(takePrintedPlaneShift(table.state, GHOST, { line: ETHEREALNESS, commandId: 'back' }), 'the step back');
    table.log.push(...back.events);
    expect(back.direction).toBe('back');
    expect(positionOf(table.state.scene!, GHOST)).toEqual({ x: 100, y: 100, z: 0 });
    expect(elsewhereOf(table.state, GHOST)).toBeNull();
  });

  it('takes the Nightmare’s willing companions within five feet, and refuses one farther or too many', () => {
    const table = haunted();
    table.did('the ghost’s turn ends', (s) => resolveTurn(s, supply(s), { commandId: 'end ghost' }));
    expect(positionOf(table.state.scene!, NIGHTMARE)).toEqual({ x: 100, y: 80, z: 0 });
    expect(table.state.scene!.sizes[NIGHTMARE]).toBe('large');
    expect(positionOf(table.state.scene!, ROSIE)).toEqual({ x: 110, y: 85, z: 0 });
    expect(distanceBetween(table.state.scene!, NIGHTMARE, ROSIE)).toEqual({ ok: true, value: 5 });
    const far = takePrintedPlaneShift(table.state, NIGHTMARE, { line: STRIDE, companions: [PIP] });
    expect(isErr(far) && far.code === 'companion_too_far').toBe(true);
    const crowd = takePrintedPlaneShift(table.state, NIGHTMARE, { line: STRIDE, companions: [ROSIE, PIP, GHOST, ROSIE] });
    expect(isErr(crowd) && crowd.code === 'too_many_companions').toBe(true);
    const alone = takePrintedPlaneShift(table.state, GHOST, { line: ETHEREALNESS, companions: [ROSIE] });
    expect(isErr(alone) && alone.code === 'no_companions').toBe(true);
    const out = unwrap(takePrintedPlaneShift(table.state, NIGHTMARE, { line: STRIDE, companions: [ROSIE] }), 'the stride');
    table.log.push(...out.events);
    expect(out.moved).toEqual([NIGHTMARE, ROSIE]);
    expect(elsewhereOf(table.state, ROSIE)?.kind).toBe('ethereal');
    expect(out.unverified.join(' ')).toContain('willing');
  });

  it('refuses a line that steps to no plane, and a swallow on a line that swallows nothing', () => {
    const table = haunted();
    const other = takePrintedPlaneShift(table.state, GHOST, { line: 'Horrific Visage' });
    expect(isErr(other) && other.code === 'line_shifts_no_plane').toBe(true);
    const gulp = takePrintedSwallow(table.state, GHOST, { line: ETHEREALNESS, target: ROSIE });
    expect(isErr(gulp) && gulp.code === 'line_swallows_nothing').toBe(true);
  });
});
