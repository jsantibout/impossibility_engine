import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, isErr, type CharacterId, type Result } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, restoreRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { declaredCasting } from './spellcasting.js';
import { checkSpellDefinitionValue } from './spell-schema.js';
import {
  resolveDeclaredCast,
  resolveMove,
  resolveSpell,
  type SpellResolution,
} from './commands.js';

/**
 * SRD Tiny Hut, whole.
 *
 * > "A 10-foot Emanation springs into existence around you and remains
 * > stationary for the duration. … Creatures and objects within the Emanation
 * > when you cast the spell can move through it freely. All other creatures
 * > and objects are barred from passing through it. Spells of level 3 or lower
 * > can't be cast through it, and the effects of such spells can't extend into
 * > it. … The spell ends early if you leave the Emanation or if you cast it
 * > again."
 *
 * Three shapes the movement model and the casting pipeline had never
 * consulted, on one dome: a **barrier** the movement command refuses a crossing
 * of (`bars-passage`, with the creatures inside at the cast pinned on the
 * record as the exception), a **ward** a casting of level three or lower is
 * refused across and an area effect does not reach into (`wards-magic`), and a
 * casting **ended by its caster leaving** the area it filled — a fact the fold
 * derives off `creature-moved` exactly as it derives a target's swing ending an
 * Invisibility.
 */

const id = (s: string) => asCharacterId(s);
const WIZARD = id('wizard');
const FIGHTER = id('fighter');
const GOBLIN = id('goblin');

const sheet = (): CharacterSheet => ({
  level: 9,
  abilities: { str: 10, dex: 14, con: 12, int: 18, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
});

const added = (who: CharacterId, side: string): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 400,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side,
});

const slots = (who: CharacterId, upTo: number): readonly GameEvent[] =>
  Array.from({ length: upTo }, (_, i) => i + 1).map((level) => ({
    type: 'resource-pool-declared',
    id: who,
    pool: { key: `spell-slot:${level}`, label: `level ${level}`, max: 4, recovers: 'long-rest' },
  }));

/** Every place anybody stands or walks to, named so no bearing has to be read. */
const LANDMARKS = {
  'the hearth': { x: 200, y: 200, z: 0 },
  'beside the hearth': { x: 205, y: 200, z: 0 },
  'the dome’s edge': { x: 210, y: 200, z: 0 },
  'just outside': { x: 215, y: 200, z: 0 },
  'the road': { x: 230, y: 200, z: 0 },
  'the field': { x: 200, y: 230, z: 0 },
} as const;
type Landmark = keyof typeof LANDMARKS;

const FIELD: readonly GameEvent[] = [
  added(WIZARD, 'party'),
  added(FIGHTER, 'party'),
  added(GOBLIN, 'foes'),
  {
    type: 'spellcasting-declared',
    id: WIZARD,
    spellcasting: declaredCasting({
      ability: 'int',
      classId: 'wizard',
      prepared: ['tiny-hut', 'fireball', 'cone-of-cold'],
    }),
  },
  {
    type: 'spellcasting-declared',
    id: GOBLIN,
    spellcasting: declaredCasting({
      ability: 'int',
      classId: 'wizard',
      cantrips: ['fire-bolt'],
      prepared: ['fireball'],
    }),
  },
  ...slots(WIZARD, 5),
  ...slots(GOBLIN, 3),
  { type: 'scene-set', extent: { width: 600, depth: 600, height: 40 } },
  ...Object.entries(LANDMARKS).map(
    ([name, at]): GameEvent => ({ type: 'landmark-added', name, at }),
  ),
  { type: 'creature-placed', id: WIZARD, placement: { from: { landmark: 'the hearth' }, feet: 0 } },
  {
    type: 'creature-placed',
    id: FIGHTER,
    placement: { from: { landmark: 'beside the hearth' }, feet: 0 },
  },
  { type: 'creature-placed', id: GOBLIN, placement: { from: { landmark: 'the road' }, feet: 0 } },
  ...[WIZARD, FIGHTER].flatMap((who): readonly GameEvent[] => [
    { type: 'sight-declared', from: GOBLIN, to: who, seen: true },
    { type: 'sight-declared', from: who, to: GOBLIN, seen: true },
  ]),
];

const supply = (state: GameState) => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: (state.rng === null ? createRng('hut') : restoreRng(state.rng)) as Rng,
  content: SRD_CONTENT,
});

class Game {
  readonly events: GameEvent[] = [...FIELD];
  castingId = '';

  get state(): GameState {
    return fold('hut', this.events);
  }

  push(more: readonly GameEvent[]): this {
    this.events.push(...more);
    return this;
  }

  /**
   * The rite: a minute's casting declared, the minute passing, the settlement.
   *
   * SRD: "Casting Time: 1 minute or Ritual", so the casting is declared and
   * settles on the clock — outside a fight, on `time-advanced`.
   */
  raiseTheHut(): this {
    const declared = unwrap(
      resolveSpell(this.state, WIZARD, { spellId: 'tiny-hut', targets: [] }, supply(this.state)),
      'declare tiny hut',
    );
    this.push(declared.events);
    this.push([{ type: 'time-advanced', seconds: 60, reason: 'the rite' }]);
    const settled = unwrap(
      resolveDeclaredCast(this.state, declared.castingId!, supply(this.state)),
      'settle tiny hut',
    );
    this.push(settled.events);
    this.castingId = declared.castingId!;
    return this;
  }

  move(who: CharacterId, to: Landmark) {
    return resolveMove(
      this.state,
      who,
      { placement: { from: { landmark: to }, feet: 0 } },
      supply(this.state),
    );
  }

  moved(who: CharacterId, to: Landmark): this {
    this.push(unwrap(this.move(who, to), `${who} to ${to}`).events);
    return this;
  }

  hut() {
    return this.state.ongoing[this.castingId];
  }
}

const codeOf = (result: Result<unknown>): string | null => (isErr(result) ? result.code : null);

describe('SRD Tiny Hut: the definition', () => {
  it('validates, and pins its three clauses on the emanation that stays put', () => {
    const hut = SRD_CONTENT.spell('tiny-hut')!;
    expect(checkSpellDefinitionValue(hut)).toEqual([]);
    expect(hut.area).toMatchObject({ kind: 'emanation', distance: 10, origin: 'self', stays: true });
    expect(hut.areaStanding?.map((clause) => clause.kind).sort()).toEqual([
      'bars-passage',
      'wards-magic',
    ]);
    expect(hut.endsEarly).toEqual([{ on: 'caster-leaves-the-area', ends: 'casting' }]);
    expect(hut.replacesPriorCasting).toBe(true);
  });
});

describe('SRD Tiny Hut: the record', () => {
  it('pins the point the dome stays at and who was inside when it rose', () => {
    const game = new Game().raiseTheHut();
    const record = game.hut();
    expect(record).toBeDefined();
    expect(record?.origin).toEqual(LANDMARKS['the hearth']);
    // Sorted, so two folds of one log write one list.
    expect(record?.insideAtTheCast).toEqual([FIGHTER, WIZARD]);
    expect(record?.areaStanding).toEqual(SRD_CONTENT.spell('tiny-hut')!.areaStanding);
  });
});

describe('SRD Tiny Hut: "All other creatures … are barred from passing through it"', () => {
  it('refuses the goblin a step into the dome, before anything is spent', () => {
    const game = new Game().raiseTheHut();
    const refused = game.move(GOBLIN, 'the dome’s edge');
    expect(codeOf(refused)).toBe('barred');
    // Nothing moved: a refusal is a value and the goblin is still on the road.
    expect(game.state.scene?.positions[GOBLIN]).toEqual(LANDMARKS['the road']);
  });

  it('lets the goblin walk up to the dome and no further', () => {
    const game = new Game().raiseTheHut();
    expect(game.move(GOBLIN, 'just outside').ok).toBe(true);
  });

  it('lets a creature that was inside at the cast walk out and back in', () => {
    const game = new Game().raiseTheHut();
    expect(game.move(FIGHTER, 'the field').ok).toBe(true);
    game.moved(FIGHTER, 'the field');
    expect(game.move(FIGHTER, 'beside the hearth').ok).toBe(true);
    // And the hut is still standing: the fighter leaving is not the caster leaving.
    expect(game.hut()).toBeDefined();
  });
});

describe('SRD Tiny Hut: "Spells of level 3 or lower can’t be cast through it"', () => {
  it('refuses a Fire Bolt from outside at the wizard inside', () => {
    const game = new Game().raiseTheHut();
    const shot = resolveSpell(
      game.state,
      GOBLIN,
      { spellId: 'fire-bolt', targets: [WIZARD] },
      supply(game.state),
    );
    expect(codeOf(shot)).toBe('warded');
  });

  it('refuses a Fireball cast out of the dome at level 3, and passes a Cone of Cold at level 5', () => {
    const game = new Game().raiseTheHut();
    const fireball = resolveSpell(
      game.state,
      WIZARD,
      { spellId: 'fireball', targets: [], at: LANDMARKS['the road'], slotLevel: 3 },
      supply(game.state),
    );
    expect(codeOf(fireball)).toBe('warded');

    const cold: SpellResolution = unwrap(
      resolveSpell(
        game.state,
        WIZARD,
        { spellId: 'cone-of-cold', targets: [], towards: LANDMARKS['the road'], slotLevel: 5 },
        supply(game.state),
      ),
      'cone of cold',
    );
    expect(cold.outcomes.map((one) => one.target)).toContain(GOBLIN);
  });

  it('lets a Fireball from outside catch nobody inside the dome', () => {
    const game = new Game().raiseTheHut();
    // Centred just outside the dome: a 20-foot Sphere that covers the hearth,
    // the fighter beside it and the goblin on the road.
    const out = unwrap(
      resolveSpell(
        game.state,
        GOBLIN,
        { spellId: 'fireball', targets: [], at: LANDMARKS['just outside'], slotLevel: 3 },
        supply(game.state),
      ),
      'fireball from outside',
    );
    const caught = out.outcomes.map((one) => one.target);
    expect(caught).toContain(GOBLIN);
    expect(caught).not.toContain(WIZARD);
    expect(caught).not.toContain(FIGHTER);
  });
});

describe('SRD Tiny Hut: "The spell ends early if you leave the Emanation"', () => {
  it('ends the casting when the wizard walks out, and not when they move inside it', () => {
    const game = new Game().raiseTheHut();
    // A step that stays inside the dome — the hearth to the space beside the
    // fighter — ends nothing.
    game.moved(WIZARD, 'the dome’s edge');
    expect(game.hut()).toBeDefined();
    // And the step out ends it, with no event written for the ending: the
    // fold derives it off the move.
    game.moved(WIZARD, 'the field');
    expect(game.hut()).toBeUndefined();
    expect(game.events.filter((e) => e.type === 'spell-ended')).toEqual([]);
  });

  it('ends the casting when the wizard is teleported out', () => {
    const game = new Game().raiseTheHut();
    game.push([
      { type: 'creature-moved', id: WIZARD, placement: { from: { landmark: 'the field' }, feet: 0 } },
    ]);
    expect(game.hut()).toBeUndefined();
  });
});
