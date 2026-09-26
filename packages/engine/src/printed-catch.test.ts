/**
 * Who a printed line catches, measured — I-E9.
 *
 * `printedLineCatch` lays the spells' own templates where a caller aims a
 * printed Cone, Line or Sphere, reads the creature's own space and whom it
 * holds, holds a ruler to one creature and dry-runs a leap — and spends
 * nothing, throws nothing and writes nothing. `forcePrintedSave` asks the same
 * function when it is aimed, so the list a query offered is the list rolled for.
 */

import { SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import { asCharacterId, type CharacterId, isErr, type Result } from '@ie/shared';
import {
  addCreature,
  addSceneLandmark,
  applyConditionTo,
  beginCombat,
  damageCreature,
  declareCoverBetween,
  declareCreatureSide,
  forcePrintedSave,
  grappleSource,
  placeCreatureInScene,
  printedLineCatch,
  setScene,
} from './commands.js';
import { createCharacter, type CharacterChoices } from './creation.js';
import { createRng, type Rng } from './dice.js';
import { applyEvent, fold, type GameEvent, type GameState } from './events.js';
import { positionOf } from './positioning.js';
import { createRollIssuer } from './rolls.js';

const id = (s: string) => asCharacterId(s);
const FOE = id('foe');
const G1 = id('g1');
const G2 = id('g2');
const G3 = id('g3');
const BREN = id('bren');

const unwrap = <T>(result: Result<T>, label = 'ok'): T => {
  if (!result.ok) throw new Error(`${label}: ${result.code} — ${result.reason}`);
  return result.value;
};
const after = (state: GameState, events: readonly GameEvent[]): GameState =>
  events.reduce((s, e) => applyEvent(s, e), state);
const supply = (seed: string) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

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
  abilities: { method: 'standard-array', assignment: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 } },
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

interface Body {
  readonly id: CharacterId;
  /** A stat block, or omitted for Bren, a character with no senses. */
  readonly monster?: string;
  readonly feet: number;
  readonly bearing: number;
  readonly side?: string;
}

/** The monster at a landmark, everybody else placed relative to it, and a fight. */
function room(monster: string, bodies: readonly Body[], side = 'wild'): GameState {
  let state = fold('the-catch', []);
  const step = (result: Result<readonly GameEvent[]>, label: string) => {
    state = after(state, unwrap(result, label));
  };
  state = after(state, unwrap(addCreature(state, SRD_CONTENT, FOE, monster), monster).events);
  for (const body of bodies) {
    if (body.monster === undefined) step(createCharacter(SRD_CONTENT, bren(), body.id), 'Bren');
    else state = after(state, unwrap(addCreature(state, SRD_CONTENT, body.id, body.monster), body.monster).events);
  }
  step(setScene(state, { width: 200, depth: 200, height: 20 }), 'scene');
  step(addSceneLandmark(state, 'the rock', { x: 100, y: 100, z: 0 }), 'rock');
  step(placeCreatureInScene(state, FOE, { from: { landmark: 'the rock' }, feet: 0 }), 'the monster');
  for (const body of bodies) {
    step(
      placeCreatureInScene(state, body.id, { from: { creature: FOE }, feet: body.feet, bearing: body.bearing }),
      `place ${body.id}`,
    );
  }
  step(declareCreatureSide(state, FOE, side), 'side');
  for (const body of bodies) step(declareCreatureSide(state, body.id, body.side ?? 'party'), 'side');
  step(
    beginCombat(state, [
      { id: FOE, initiative: 20, speed: 30 },
      ...bodies.map((body, index) => ({ id: body.id, initiative: 10 - index, speed: 30 })),
    ]),
    'combat',
  );
  return state;
}

const at = (state: GameState, who: CharacterId) => positionOf(state.scene!, who)!;
const catchOf = (state: GameState, line: string, aim?: Parameters<typeof printedLineCatch>[3]) =>
  unwrap(printedLineCatch(state, FOE, line, aim), line);

const FIRE_BREATH = 'Fire Breath (Recharge 5–6)';

describe("a red dragon wyrmling's Fire Breath, laid by the spells' own Cone", () => {
  // Two goblins north, one in front of the other; one south.
  const three = (): GameState =>
    room('red-dragon-wyrmling', [
      { id: G1, monster: 'goblin-warrior', feet: 5, bearing: 0 },
      { id: G2, monster: 'goblin-warrior', feet: 10, bearing: 0 },
      { id: G3, monster: 'goblin-warrior', feet: 5, bearing: 180 },
    ]);

  it('catches the two in front and not the one behind, aimed at the nearest', () => {
    const state = three();
    const breath = catchOf(state, FIRE_BREATH, { towards: at(state, G1), creature: G1 });
    expect(breath.caught).toEqual([G1, G2]);
    expect(breath.needs).toEqual([]);
    // It never catches itself.
    expect(breath.caught).not.toContain(FOE);
  });

  it('catches a different set aimed elsewhere', () => {
    const state = three();
    expect(catchOf(state, FIRE_BREATH, { towards: at(state, G3) }).caught).toEqual([G3]);
  });

  it("catches the dragon's own ally in the Cone: sides play no part", () => {
    const state = room('red-dragon-wyrmling', [
      { id: G1, monster: 'goblin-warrior', feet: 5, bearing: 0, side: 'wild' },
      { id: G2, monster: 'goblin-warrior', feet: 10, bearing: 0 },
    ]);
    expect(catchOf(state, FIRE_BREATH, { towards: at(state, G1) }).caught).toEqual([G1, G2]);
  });

  it('excludes the dead and one behind Total Cover, each with a reason', () => {
    let state = three();
    state = after(state, unwrap(damageCreature(state, G1, { amount: 100, source: 'a rockfall' }), 'rockfall'));
    state = after(state, unwrap(declareCoverBetween(state, FOE, G2, 'total'), 'cover'));
    const breath = catchOf(state, FIRE_BREATH, { towards: at(state, G1) });
    expect(breath.caught).toEqual([]);
    expect(breath.excluded.map((one) => one.target).sort()).toEqual([G1, G2]);
    expect(breath.excluded.find((one) => one.target === G1)!.reason).toContain('dead');
    expect(breath.excluded.find((one) => one.target === G2)!.reason).toContain('Total Cover');
  });

  it('asks where it is aimed rather than guessing, and refuses a point it cannot be centred on', () => {
    const state = three();
    const unaimed = catchOf(state, FIRE_BREATH);
    expect(unaimed.caught).toEqual([]);
    expect(unaimed.needs.map((one) => one.kind)).toEqual(['route']);
    expect(unaimed.needs[0]!.need).toContain('towards');
    const centred = printedLineCatch(state, FOE, FIRE_BREATH, { at: at(state, G1) });
    expect(isErr(centred) && centred.code).toBe('area_starts_at_caster');
  });

  it('is read-only: no events, no roll issued, the state byte-identical', () => {
    const state = three();
    const before = JSON.stringify(state);
    const answer = printedLineCatch(state, FOE, FIRE_BREATH, { towards: at(state, G1) });
    expect(answer.ok).toBe(true);
    expect(Object.keys(answer.ok ? answer.value : {})).not.toContain('events');
    expect(JSON.stringify(state)).toBe(before);
    expect(state.rollsIssued).toBe(JSON.parse(before).rollsIssued);
  });
});

describe("the clause's own filters over the template", () => {
  it("spares the Ghost's Undead and a Blinded fighter, and catches and says one nobody settled", () => {
    let state = room('ghost', [
      { id: G1, monster: 'zombie', feet: 5, bearing: 0 },
      { id: G2, monster: 'goblin-warrior', feet: 10, bearing: 0 },
      { id: BREN, feet: 15, bearing: 0 },
    ]);
    state = after(state, unwrap(applyConditionTo(state, G2, 'blinded', 'a flash'), 'blinded'));
    const visage = catchOf(state, 'Horrific Visage', { towards: at(state, G1) });
    expect(visage.excluded.find((one) => one.target === G1)!.reason).toContain('Undead');
    expect(visage.excluded.find((one) => one.target === G2)!.reason).toContain('cannot');
    expect(visage.caught).toEqual([BREN]);
    expect(visage.unverified.some((line) => line.includes(BREN) && line.includes('can see'))).toBe(true);
  });

  it("refuses the Gibbering Mouther's Sphere centred out of range, and catches it within", () => {
    const state = room('gibbering-mouther', [
      { id: G1, monster: 'goblin-warrior', feet: 35, bearing: 90 },
      { id: G2, monster: 'goblin-warrior', feet: 25, bearing: 270 },
    ]);
    const far = printedLineCatch(state, FOE, 'Blinding Spittle (Recharge 5–6)', { at: at(state, G1), creature: G1 });
    expect(isErr(far) && far.code).toBe('out_of_range');
    expect(catchOf(state, 'Blinding Spittle (Recharge 5–6)', { at: at(state, G2), creature: G2 }).caught).toEqual([G2]);
  });

  it("needs no aim for the Dretch's Emanation, and refuses one", () => {
    const state = room('dretch', [
      { id: G1, monster: 'goblin-warrior', feet: 5, bearing: 0 },
      { id: G2, monster: 'goblin-warrior', feet: 20, bearing: 0 },
    ]);
    expect(catchOf(state, 'Fetid Cloud (1/Day)').caught).toEqual([G1]);
    const aimed = printedLineCatch(state, FOE, 'Fetid Cloud (1/Day)', { towards: at(state, G1) });
    expect(isErr(aimed) && aimed.code).toBe('not_directional');
  });
});

describe('a space, a hold, a ruler and a leap', () => {
  it("catches whoever shares the Water Elemental's space, and nobody beside it", () => {
    let state = room('water-elemental', [
      { id: G1, monster: 'goblin-warrior', feet: 15, bearing: 0 },
      { id: G2, monster: 'goblin-warrior', feet: 15, bearing: 180 },
    ]);
    state = applyEvent(state, {
      type: 'creature-moved',
      id: G1,
      placement: { from: { creature: FOE }, feet: 0 },
      intoOccupied: true,
    });
    expect(catchOf(state, 'Whelm (Recharge 4–6)').caught).toEqual([G1]);
  });

  it('catches exactly whom the Otyugh grapples', () => {
    let state = room('otyugh', [
      { id: G1, monster: 'goblin-warrior', feet: 10, bearing: 0 },
      { id: G2, monster: 'goblin-warrior', feet: 10, bearing: 180 },
    ]);
    state = after(state, unwrap(applyConditionTo(state, G1, 'grappled', grappleSource(FOE)), 'held'));
    expect(catchOf(state, 'Tentacle Slam').caught).toEqual([G1]);
  });

  it("offers the Ettercap every creature within 30 it can see, Large or smaller, and says why not the Huge one", () => {
    const giant = id('giant');
    const state = room('ettercap', [
      { id: G1, monster: 'goblin-warrior', feet: 25, bearing: 0 },
      { id: G2, monster: 'goblin-warrior', feet: 45, bearing: 180 },
      { id: giant, monster: 'hill-giant', feet: 20, bearing: 90 },
    ]);
    const strand = catchOf(state, 'Web Strand (Recharge 5–6)');
    expect(strand.caught).toEqual([G1]);
    expect(strand.excluded.find((one) => one.target === giant)!.reason).toContain('huge');
    expect(strand.excluded.find((one) => one.target === G2)!.reason).toContain('reaches 30 feet');
    // Aimed at one creature, it answers for that creature alone.
    expect(catchOf(state, 'Web Strand (Recharge 5–6)', { creature: G1 }).caught).toEqual([G1]);
  });

  it("dry-runs the Bulette's leap: the landing and who is in it, or the leap's own reason", () => {
    const near = room('bulette', [{ id: G1, monster: 'goblin-warrior', feet: 10, bearing: 0 }]);
    const leap = catchOf(near, 'Deadly Leap', { creature: G1 });
    expect(leap.caught).toEqual([G1]);
    expect(leap.landing).toEqual({ from: { creature: G1 }, feet: 0 });

    const far = room('bulette', [{ id: G1, monster: 'goblin-warrior', feet: 20, bearing: 0 }]);
    const refused = printedLineCatch(far, FOE, 'Deadly Leap', { creature: G1 });
    expect(isErr(refused) && refused.code).toBe('leap_too_far');
  });

  it("asks the Centaur Trooper for the route its charge takes", () => {
    const state = room('centaur-trooper', [{ id: G1, monster: 'goblin-warrior', feet: 15, bearing: 0 }]);
    const charge = catchOf(state, 'Trampling Charge (Recharge 5–6)');
    expect(charge.caught).toEqual([]);
    expect(charge.needs.map((one) => one.kind)).toEqual(['route']);
  });
});

describe('what the line is, refused with the door’s own codes', () => {
  it('refuses a line with no save, a triggered line and a heading nobody prints', () => {
    const state = room('dretch', [{ id: G1, monster: 'goblin-warrior', feet: 5, bearing: 0 }]);
    const magmin = room('magmin', [{ id: G1, monster: 'goblin-warrior', feet: 5, bearing: 0 }]);
    const code = (result: Result<unknown>) => (isErr(result) ? result.code : 'ok');
    expect(code(printedLineCatch(magmin, FOE, 'Death Burst'))).toBe('save_is_triggered');
    expect(code(printedLineCatch(state, FOE, 'Nothing Like It'))).toBe('no_such_line');
    const golem = room('clay-golem', [{ id: G1, monster: 'goblin-warrior', feet: 15, bearing: 0 }]);
    expect(code(printedLineCatch(golem, FOE, 'Hasten (Recharge 5–6)'))).toBe('line_states_no_save');
  });
});

describe('the door rolls for exactly whom the query caught', () => {
  it('lays the aim, rolls for the catch, and refuses a list beside it before anything is spent', () => {
    const state = room('red-dragon-wyrmling', [
      { id: G1, monster: 'goblin-warrior', feet: 5, bearing: 0 },
      { id: G2, monster: 'goblin-warrior', feet: 10, bearing: 0 },
      { id: G3, monster: 'goblin-warrior', feet: 5, bearing: 180 },
    ]);
    const towards = at(state, G1);
    const caught = catchOf(state, FIRE_BREATH, { towards }).caught;
    const aimed = unwrap(
      forcePrintedSave(state, FOE, { line: FIRE_BREATH, aim: { towards }, commandId: 'aim' }, supply('same')),
      'aimed',
    );
    expect(aimed.outcomes.map((one) => one.target)).toEqual(caught);
    expect(aimed.unverified.some((line) => line.includes('measured no area'))).toBe(false);

    // The same list sent as a head count throws the same dice in the same order.
    const counted = unwrap(
      forcePrintedSave(state, FOE, { line: FIRE_BREATH, targets: caught, commandId: 'aim' }, supply('same')),
      'counted',
    );
    expect(counted.outcomes).toEqual(aimed.outcomes);

    const both = forcePrintedSave(
      state,
      FOE,
      { line: FIRE_BREATH, aim: { towards }, targets: [G3], commandId: 'both' },
      supply('both'),
    );
    expect(isErr(both) && both.code).toBe('area_picks_its_own_targets');

    // Aimed where nobody stands, it is refused rather than spent on the air.
    const here = at(state, FOE);
    const empty = forcePrintedSave(
      state,
      FOE,
      { line: FIRE_BREATH, aim: { towards: { x: here.x + 30, y: here.y, z: 0 } }, commandId: 'east' },
      supply('east'),
    );
    expect(isErr(empty) && empty.code).toBe('nobody_caught');
  });

  it('measures an Emanation with no aim and no list, and asks where there is no room to measure it', () => {
    const state = room('dretch', [
      { id: G1, monster: 'goblin-warrior', feet: 5, bearing: 0 },
      { id: G2, monster: 'goblin-warrior', feet: 20, bearing: 0 },
    ]);
    const cloud = unwrap(
      forcePrintedSave(state, FOE, { line: 'Fetid Cloud (1/Day)', commandId: 'cloud' }, supply('cloud')),
      'the cloud',
    );
    expect(cloud.outcomes.map((one) => one.target)).toEqual([G1]);

    // No scene: nothing to measure in, so the head count is asked for as ever.
    let bare = fold('bare', []);
    bare = after(bare, unwrap(addCreature(bare, SRD_CONTENT, FOE, 'dretch'), 'dretch').events);
    bare = after(bare, unwrap(beginCombat(bare, [{ id: FOE, initiative: 20, speed: 20 }]), 'combat'));
    const asked = forcePrintedSave(bare, FOE, { line: 'Fetid Cloud (1/Day)', commandId: 'cloud' }, supply('cloud'));
    expect(isErr(asked) && asked.kind === 'needs-context' && asked.code).toBe('undeclared_targets');
  });

  it("checks a head count against the creature's own space and its hold", () => {
    const state = room('otyugh', [{ id: G1, monster: 'goblin-warrior', feet: 10, bearing: 0 }]);
    const refused = forcePrintedSave(state, FOE, { line: 'Tentacle Slam', targets: [G1], commandId: 'slam' }, supply('slam'));
    expect(isErr(refused) && refused.code).toBe('target_not_eligible');
    // Nothing was spent being refused.
    expect(state.combat!.budgets[FOE]!.action).toBe(true);

    // "each creature in the elemental's space": one beside it is not in it.
    let whelm = room('water-elemental', [
      { id: G1, monster: 'goblin-warrior', feet: 15, bearing: 0 },
      { id: G2, monster: 'goblin-warrior', feet: 15, bearing: 180 },
    ]);
    whelm = applyEvent(whelm, {
      type: 'creature-moved',
      id: G1,
      placement: { from: { creature: FOE }, feet: 0 },
      intoOccupied: true,
    });
    const outside = forcePrintedSave(whelm, FOE, { line: 'Whelm (Recharge 4–6)', targets: [G2], commandId: 'w' }, supply('w'));
    expect(isErr(outside) && outside.code).toBe('target_not_eligible');
    if (isErr(outside)) expect(outside.reason).toContain(`in ${FOE}'s space`);
    expect(
      unwrap(forcePrintedSave(whelm, FOE, { line: 'Whelm (Recharge 4–6)', targets: [G1], commandId: 'w' }, supply('w')), 'in it')
        .outcomes.map((one) => one.target),
    ).toEqual([G1]);
  });

  it("holds a one-creature space to one, named or measured", () => {
    // SRD Air Elemental's Whirlwind: "one Medium or smaller creature in the
    // elemental's space" — two goblins in the Large elemental's ten feet.
    let state = room('air-elemental', [
      { id: G1, monster: 'goblin-warrior', feet: 15, bearing: 0 },
      { id: G2, monster: 'goblin-warrior', feet: 15, bearing: 180 },
    ]);
    for (const [who, bearing] of [[G1, 0], [G2, 90]] as const) {
      state = applyEvent(state, {
        type: 'creature-moved',
        id: who,
        placement: { from: { creature: FOE }, feet: 5, bearing },
        intoOccupied: true,
      });
    }
    const code = (result: Result<unknown>) => (isErr(result) ? result.code : 'ok');
    const LINE = 'Whirlwind (Recharge 4–6)';
    expect(code(forcePrintedSave(state, FOE, { line: LINE, targets: [G1, G2], commandId: 'a' }, supply('a')))).toBe(
      'too_many_targets',
    );
    // An empty aim measures the space, finds two, and is held to the clause's one.
    expect(code(forcePrintedSave(state, FOE, { line: LINE, aim: {}, commandId: 'b' }, supply('b')))).toBe(
      'too_many_targets',
    );
    expect(catchOf(state, LINE).caught).toEqual([G1, G2]);
  });

  it("refuses a head count bigger than the line's printed size cap", () => {
    const giant = id('giant');
    const state = room('ettercap', [
      { id: G1, monster: 'goblin-warrior', feet: 25, bearing: 0 },
      { id: giant, monster: 'hill-giant', feet: 20, bearing: 90 },
    ]);
    const LINE = 'Web Strand (Recharge 5–6)';
    const refused = forcePrintedSave(state, FOE, { line: LINE, targets: [giant], commandId: 'web' }, supply('web'));
    expect(isErr(refused) && refused.code).toBe('target_not_eligible');
    if (isErr(refused)) expect(refused.reason).toContain('huge');
    expect(
      unwrap(forcePrintedSave(state, FOE, { line: LINE, targets: [G1], commandId: 'web' }, supply('web')), 'the goblin')
        .outcomes.map((one) => one.target),
    ).toEqual([G1]);
  });
});
