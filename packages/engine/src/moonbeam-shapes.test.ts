import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap, type CharacterId, type Result } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createCharacter, type CharacterChoices } from './creation.js';
import { createRng, restoreRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { declaredCasting } from './spellcasting.js';
import { formWornBy } from './forms.js';
import { isGaseousOn } from './standing.js';
import { spellOn } from './fold/release.js';
import { type Point } from './positioning.js';
import {
  addCreature,
  assumeShape,
  resolveMove,
  resolveSpell,
  resolveTurn,
  takePrintedForm,
} from './commands.js';

/**
 * SRD Moonbeam: "On a failed save, a creature takes 2d10 Radiant damage, and
 * **if the creature is shape-shifted (as a result of the _Polymorph_ spell, for
 * example), it reverts to its true form and can't shape-shift until it leaves
 * the Cylinder**." (E-L2)
 *
 * A creature holds a shape three ways in this engine — a Wild Shape worn under
 * a feature, a form its own stat block prints, and a casting that shape-shifts
 * it (SRD Gaseous Form: "A willing creature you touch shape-shifts") — and the
 * failed save ends whichever it holds. A creature that was shape-shifted is
 * then barred from shape-shifting while it stands in the Cylinder: the bar is a
 * `forbids` rule under the casting's source, read by every door a shape is
 * taken through, and lifted the moment the creature is outside the area.
 */

const id = (s: string) => asCharacterId(s);
const CASTER = id('caster');
const WOLF = id('werewolf');
const FENN = id('fenn');
const MIST = id('mist');
const HELPER = id('helper');

const sheet = (): CharacterSheet => ({
  level: 9,
  abilities: { str: 10, dex: 10, con: 14, int: 10, wis: 18, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'wis',
});

const added = (who: CharacterId, side: string): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 200,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side,
});

const caster = (who: CharacterId, prepared: readonly string[]): readonly GameEvent[] => [
  {
    type: 'spellcasting-declared',
    id: who,
    spellcasting: declaredCasting({ ability: 'wis', classId: 'druid', prepared: [...prepared] }),
  },
  ...[1, 2, 3].map(
    (level): GameEvent => ({
      type: 'resource-pool-declared',
      id: who,
      pool: { key: `spell-slot:${level}`, label: `level ${level}`, max: 4, recovers: 'long-rest' },
    }),
  ),
];

const at = (x: number, y: number): Point => ({ x, y, z: 0 });
const placed = (who: CharacterId, where: Point): GameEvent => ({
  type: 'creature-placed',
  id: who,
  placement: { from: { point: where }, feet: 0 },
});

/** Where the beam comes down, and a space well clear of its 5-foot radius. */
const BEAM = at(200, 100);
const CLEAR = at(230, 100);

const supply = (state: GameState, flat = 0) => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: (state.rng === null ? createRng('beam') : restoreRng(state.rng)) as Rng,
  content: SRD_CONTENT,
  bonuses: [{ source: 'the fixture', flat }],
});

const FAILS = -40;
const SAVES = 40;

const codeOf = (result: Result<unknown>): string | null => (isErr(result) ? result.code : null);

/** A log that grows. */
class Table {
  readonly log: GameEvent[];
  constructor(start: readonly GameEvent[]) {
    this.log = [...start];
  }
  get state(): GameState {
    return fold('beam', this.log);
  }
  push(...more: readonly GameEvent[]): this {
    this.log.push(...more);
    return this;
  }
  run<T extends readonly GameEvent[] | { readonly events: readonly GameEvent[] }>(
    label: string,
    command: (state: GameState) => Result<T>,
  ): this {
    const out = unwrap(command(this.state), label);
    return this.push(...(Array.isArray(out) ? (out as readonly GameEvent[]) : (out as { events: readonly GameEvent[] }).events));
  }
  beam(flat: number): string {
    const out = unwrap(
      resolveSpell(this.state, CASTER, { spellId: 'moonbeam', targets: [], at: BEAM, slotLevel: 2 }, supply(this.state, flat)),
      'moonbeam',
    );
    this.push(...out.events);
    return out.castingId!;
  }
  turn(): this {
    return this.run('the turn', (state) => resolveTurn(state, supply(state)));
  }
}

// ─── a form the stat block prints ──────────────────────────────────────────

const SHIFT = SRD_CONTENT.monsterById('werewolf')!.bonusActions.find((line) => line.forms !== undefined)!
  .name;

/** A werewolf in the beam's spot, already a wolf, and the druid's turn next. */
const wolfInTheBeam = (): Table => {
  const table = new Table([
    added(CASTER, 'party'),
    ...caster(CASTER, ['moonbeam']),
    { type: 'scene-set', extent: { width: 400, depth: 200, height: 60 } },
    placed(CASTER, at(150, 100)),
  ]);
  table.run('the werewolf', (state) => addCreature(state, SRD_CONTENT, WOLF, 'werewolf'));
  table.push(placed(WOLF, BEAM), {
    type: 'combat-started',
    combatants: [
      { id: WOLF, initiative: 20, speed: 30 },
      { id: CASTER, initiative: 10, speed: 30 },
    ],
  });
  table.run('the werewolf becomes a wolf', (state) => takePrintedForm(state, WOLF, { line: SHIFT, form: 'wolf' }));
  return table.turn();
};

describe('SRD Moonbeam reverts a shape-shifted creature that fails its save', () => {
  it('puts a werewolf back in its true form, and bars another shift while it stands in the beam', () => {
    const table = wolfInTheBeam();
    expect(formWornBy(table.state.creatures[WOLF]!)).toBe('wolf');

    table.beam(FAILS);
    expect(formWornBy(table.state.creatures[WOLF]!)).toBe('humanoid');

    // The druid's turn ends; the werewolf's begins, standing in the Cylinder.
    table.turn();
    expect(codeOf(takePrintedForm(table.state, WOLF, { line: SHIFT, form: 'wolf' }))).toBe(
      'shape_shifting_forbidden',
    );
  });

  it('lets the werewolf shift again once it has left the Cylinder', () => {
    const table = wolfInTheBeam();
    table.beam(FAILS);
    table.turn();

    table.run('out of the beam', (state) =>
      resolveMove(state, WOLF, { placement: { from: { point: CLEAR }, feet: 0 } }, supply(state)),
    );
    expect(takePrintedForm(table.state, WOLF, { line: SHIFT, form: 'wolf' }).ok).toBe(true);
  });

  it('leaves a werewolf that makes its save in the shape it holds, and free to shift', () => {
    const table = wolfInTheBeam();
    table.beam(SAVES);
    expect(formWornBy(table.state.creatures[WOLF]!)).toBe('wolf');
    table.turn();
    expect(takePrintedForm(table.state, WOLF, { line: SHIFT, form: 'hybrid' }).ok).toBe(true);
  });

  /**
   * "if the creature is shape-shifted … it reverts to its true form and can't
   * shape-shift": the bar is the second half of the reverting, so a creature in
   * its own skin that fails the save is burned and nothing more.
   */
  it('bars nothing for a creature that was in its own skin when it failed', () => {
    const table = new Table([
      added(CASTER, 'party'),
      ...caster(CASTER, ['moonbeam']),
      { type: 'scene-set', extent: { width: 400, depth: 200, height: 60 } },
      placed(CASTER, at(150, 100)),
    ]);
    table.run('the werewolf', (state) => addCreature(state, SRD_CONTENT, WOLF, 'werewolf'));
    table.push(placed(WOLF, BEAM), {
      type: 'combat-started',
      combatants: [
        { id: CASTER, initiative: 20, speed: 30 },
        { id: WOLF, initiative: 10, speed: 30 },
      ],
    });
    table.beam(FAILS);
    table.turn();
    expect(takePrintedForm(table.state, WOLF, { line: SHIFT, form: 'wolf' }).ok).toBe(true);
  });
});

// ─── a Wild Shape ─────────────────────────────────────────────────────────

/** `wild-shape.test.ts`'s level 5 Druid. */
const druid = (): CharacterChoices => ({
  name: 'Fenn',
  classId: 'druid',
  level: 5,
  subclassId: 'circle-of-the-land',
  speciesId: 'human',
  backgroundId: 'acolyte',
  abilities: {
    method: 'standard-array',
    assignment: { str: 10, dex: 14, con: 13, int: 8, wis: 15, cha: 12 },
  },
  abilityIncreases: { wis: 2, cha: 1 },
  classSkills: ['nature', 'perception'],
  languages: ['Elvish', 'Dwarvish'],
  alignment: 'Neutral',
  cantrips: ['druidcraft', 'guidance', 'shillelagh'],
  spellbook: [],
  preparedSpells: [
    'aid',
    'barkskin',
    'call-lightning',
    'cure-wounds',
    'dispel-magic',
    'faerie-fire',
    'fog-cloud',
    'goodberry',
    'healing-word',
  ],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: ['leather-armor'],
  hitPoints: { method: 'fixed' },
  featureChoices: {
    'human:skillful': ['acrobatics'],
    'druid:primal-order': ['Magician'],
    'druid:primal-order:cantrip': ['mending'],
  },
  feats: {
    'acolyte:magic-initiate-cleric': {
      featId: 'magic-initiate',
      spellList: 'cleric',
      spellcastingAbility: 'wis',
      cantrips: ['guidance', 'sacred-flame'],
      levelOneSpell: 'bless',
    },
    'human:versatile': { featId: 'alert' },
    'druid:ability-score-improvement': {
      featId: 'ability-score-improvement',
      abilities: ['wis', 'wis'],
    },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard package only' },
  knownForms: ['wolf', 'rat', 'spider', 'riding-horse'],
});

describe('SRD Moonbeam ends a Wild Shape', () => {
  const wolfDruid = (): Table => {
    const table = new Table([
      added(CASTER, 'foes'),
      ...caster(CASTER, ['moonbeam']),
      ...unwrap(createCharacter(SRD_CONTENT, druid(), FENN), 'fenn'),
      { type: 'scene-set', extent: { width: 400, depth: 200, height: 60 } },
      placed(CASTER, at(150, 100)),
      placed(FENN, BEAM),
      {
        type: 'combat-started',
        combatants: [
          { id: FENN, initiative: 20, speed: 30 },
          { id: CASTER, initiative: 10, speed: 30 },
        ],
      },
    ]);
    table.run('wild shape', (state) =>
      assumeShape(state, FENN, { feature: 'druid:wild-shape', form: 'wolf' }, SRD_CONTENT),
    );
    return table.turn();
  };

  it('puts the druid back in its own sheet, and refuses a second Wild Shape in the beam', () => {
    const table = wolfDruid();
    expect(table.state.creatures[FENN]!.shape).not.toBeNull();

    table.beam(FAILS);
    expect(table.state.creatures[FENN]!.shape).toBeNull();
    expect(table.state.creatures[FENN]!.activeFeatures).not.toContain('druid:wild-shape');

    table.turn();
    expect(
      codeOf(assumeShape(table.state, FENN, { feature: 'druid:wild-shape', form: 'rat' }, SRD_CONTENT)),
    ).toBe('shape_shifting_forbidden');
  });
});

// ─── a casting that shape-shifts its target ─────────────────────────────────

describe('SRD Moonbeam ends a Gaseous Form', () => {
  it('ends the cloud on the creature the beam caught, and bars a second casting of it there', () => {
    const table = new Table([
      added(CASTER, 'foes'),
      ...caster(CASTER, ['moonbeam']),
      added(MIST, 'party'),
      ...caster(MIST, ['gaseous-form']),
      // The cloud is the helper's casting, so the beam's damage breaks no
      // Concentration of the creature it burns: what ends the cloud is the
      // reverting, and nothing else.
      added(HELPER, 'party'),
      ...caster(HELPER, ['gaseous-form']),
      { type: 'scene-set', extent: { width: 400, depth: 200, height: 60 } },
      placed(CASTER, at(150, 100)),
      placed(MIST, at(200, 150)),
      placed(HELPER, at(205, 150)),
    ]);
    const cloud = unwrap(
      resolveSpell(
        table.state,
        HELPER,
        { spellId: 'gaseous-form', targets: [MIST], slotLevel: 3, willing: [MIST] },
        supply(table.state),
      ),
      'gaseous form',
    );
    table.push(...cloud.events, {
      type: 'creature-moved',
      id: MIST,
      placement: { from: { point: BEAM }, feet: 0 },
    });
    expect(isGaseousOn(table.state, MIST)).toBe(true);

    table.beam(FAILS);
    // Released on the creature it caught: the helper's casting lets go of the
    // mist, which is a creature in its own skin again.
    expect(isGaseousOn(table.state, MIST)).toBe(false);
    expect(spellOn(table.state, table.state.ongoing[cloud.castingId!]!)).not.toContain(MIST);

    // Turned to mist again by its own hand, inside the beam: refused.
    const again = resolveSpell(
      table.state,
      MIST,
      { spellId: 'gaseous-form', targets: [MIST], slotLevel: 3, willing: [MIST] },
      supply(table.state),
    );
    expect(codeOf(again)).toBe('shape_shifting_forbidden');
  });
});
