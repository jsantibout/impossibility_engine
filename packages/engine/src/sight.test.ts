/**
 * Light a casting carries, and senses that see past declared sight.
 *
 * - **SRD Light and Continual Flame** shed from an object a creature holds:
 *   a `light` effect lays patches carried by the casting's target, derived at
 *   read time from where the bearer stands, gone when the casting is.
 * - **SRD Dancing Lights** is a dim patch at a point the caster moves with
 *   the spell's own Bonus Action.
 * - **SRD Darkvision** confers a sense for the duration, read by `sensesOf`
 *   beside the ones a species grants.
 * - **SRD Faerie Fire**'s Advantage "if the attacker can see it" is a mode
 *   hung on the outlined creature, gated on the roller's declared sight.
 */
import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, type CharacterId, type Result } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createCharacter, type CharacterChoices } from './creation.js';
import { createRng, type Rng } from './dice.js';
import { applyEvent, fold, type GameEvent, type GameState } from './events.js';
import { lightAt, type Point } from './positioning.js';
import { createRollIssuer } from './rolls.js';
import { canSee, rollModesFor, sensesOf } from './standing.js';
import { activateSpell, advanceTime, resolveAttack, resolveMove, resolveSpell } from './commands.js';

const WIZ = asCharacterId('wiz');
const ALLY = asCharacterId('ally');
const GOBLIN = asCharacterId('goblin');

const supply = (seed: string) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

const unwrap = <T>(result: Result<T>, label = 'ok'): T => {
  if (!result.ok) throw new Error(`${label}: ${result.code} — ${result.reason}`);
  return result.value;
};

const run = (state: GameState, events: readonly GameEvent[]): GameState =>
  events.reduce((s, e) => applyEvent(s, e), state);

// — Fixtures —————————————————————————————————————————————————————————————————

const MAGIC_INITIATE = {
  'sage:magic-initiate-wizard': {
    featId: 'magic-initiate',
    spellList: 'wizard',
    spellcastingAbility: 'int' as const,
    cantrips: ['mage-hand', 'ray-of-frost'],
    levelOneSpell: 'find-familiar',
  },
};

/** A Wizard 3 who carries the light spells and the sense one. */
const wizard = (): CharacterChoices => ({
  name: 'Ander',
  classId: 'wizard',
  level: 3,
  subclassId: 'evoker',
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 },
  },
  abilityIncreases: { int: 2, con: 1 },
  classSkills: ['investigation', 'insight'],
  languages: ['Dwarvish', 'Elvish'],
  alignment: 'Neutral',
  cantrips: ['fire-bolt', 'light', 'dancing-lights'],
  spellbook: [
    'magic-missile',
    'shield',
    'detect-magic',
    'find-familiar',
    'mage-armor',
    'sleep',
    'misty-step',
    'darkness',
    'continual-flame',
    'darkvision',
  ].map((spellId, index) => ({
    spellId,
    acquiredAt: index < 6 ? 1 : index < 8 ? 2 : 3,
    origin: 'level' as const,
  })),
  preparedSpells: ['magic-missile', 'shield', 'darkness', 'continual-flame', 'darkvision', 'misty-step'],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: {
    'wizard:scholar': ['arcana'],
    'human:skillful': ['perception'],
    'evoker:evocation-savant': ['burning-hands', 'scorching-ray'],
  },
  feats: { ...MAGIC_INITIATE, 'human:versatile': { featId: 'alert' } },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
});

/** A Druid 2 with Faerie Fire prepared. */
const druid = (): CharacterChoices => ({
  name: 'Fenn',
  classId: 'druid',
  level: 2,
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 10, dex: 14, con: 13, int: 8, wis: 15, cha: 12 },
  },
  abilityIncreases: { wis: 2, con: 1 },
  classSkills: ['nature', 'perception'],
  languages: ['Dwarvish', 'Elvish'],
  alignment: 'Neutral',
  cantrips: ['druidcraft', 'guidance'],
  spellbook: [],
  preparedSpells: ['cure-wounds', 'faerie-fire', 'fog-cloud', 'goodberry', 'healing-word'],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: { 'human:skillful': ['perception'], 'druid:primal-order': ['Magician'] },
  feats: { ...MAGIC_INITIATE, 'human:versatile': { featId: 'alert' } },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
  knownForms: ['wolf', 'rat', 'spider', 'riding-horse'],
});

const plain = (): CharacterSheet => ({
  level: 1,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: null,
});

const added = (who: CharacterId, side: string, sheet: CharacterSheet = plain()): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet,
  maxHp: 60,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side,
});

const made = (who: CharacterId, choices: CharacterChoices): readonly GameEvent[] =>
  unwrap(createCharacter(SRD_CONTENT, choices, who), choices.name);

/** A wizard at the gate with an ally five feet east — a touch away — in a scene nobody has lit. */
const hall = (caster: readonly GameEvent[], who: CharacterId, allyFeet = 5): GameEvent[] => [
  ...caster,
  { type: 'creature-side-declared', id: who, side: 'party' },
  added(ALLY, 'party'),
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
  { type: 'landmark-added', name: 'the gate', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: who, placement: { from: { landmark: 'the gate' }, feet: 0 } },
  { type: 'creature-placed', id: ALLY, placement: { from: { creature: who }, feet: allyFeet, bearing: 90 } },
];

const at = (x: number, y: number): Point => ({ x, y, z: 0 });

const HOUR = 3600;

// — Light and Continual Flame ————————————————————————————————————————————————

describe('SRD Light, on a thing a creature holds', () => {
  it('lights twenty feet bright and twenty more dim around the bearer, and moves with them', () => {
    const state = fold('seed', hall(made(WIZ, wizard()), WIZ));
    const allyAt = at(105, 100);
    expect(lightAt(state, allyAt).level).toBeNull();

    const cast = unwrap(resolveSpell(state, WIZ, { spellId: 'light', targets: [ALLY] }, supply('light')), 'light');
    const lit = run(state, cast.events);
    expect(lightAt(lit, allyAt)).toMatchObject({ level: 'bright', magical: true });
    expect(lightAt(lit, at(135, 100)).level).toBe('dim');
    expect(lightAt(lit, at(155, 100)).level).toBeNull();

    // The ally walks off with the torch: the light goes with them, and nothing
    // is written down for it.
    const walked = run(
      lit,
      unwrap(
        resolveMove(lit, ALLY, { placement: { from: { landmark: 'the gate' }, feet: 100, bearing: 90 } }, supply('walk')),
        'walk',
      ).events,
    );
    expect(lightAt(walked, allyAt).level).toBeNull();
    expect(lightAt(walked, at(200, 100)).level).toBe('bright');
    expect(lightAt(walked, at(100, 100)).level).toBeNull();
  });

  it('goes out when the hour does', () => {
    const state = fold('seed', hall(made(WIZ, wizard()), WIZ));
    const lit = run(state, unwrap(resolveSpell(state, WIZ, { spellId: 'light', targets: [ALLY] }, supply('l')), 'light').events);
    const later = run(lit, unwrap(advanceTime(lit, HOUR, 'an hour'), 'time'));
    expect(lightAt(later, at(105, 100)).level).toBeNull();
  });

  it('is put out by a Darkness laid over it, as the book says a level 2 spell is', () => {
    const state = fold('seed', hall(made(WIZ, wizard()), WIZ));
    const lit = run(state, unwrap(resolveSpell(state, WIZ, { spellId: 'light', targets: [WIZ] }, supply('l')), 'light').events);
    expect(lightAt(lit, at(100, 100)).level).toBe('bright');

    const dark = unwrap(
      resolveSpell(lit, WIZ, { spellId: 'darkness', targets: [], slotLevel: 2, at: at(100, 100) }, supply('d')),
      'darkness',
    );
    expect(dark.events.some((e) => e.type === 'spell-ended' && e.reason === 'dispelled')).toBe(true);
    expect(lightAt(run(lit, dark.events), at(100, 100)).level).toBe('darkness');
  });

  it('Continual Flame burns until dispelled', () => {
    const state = fold('seed', hall(made(WIZ, wizard()), WIZ));
    const lit = run(
      state,
      unwrap(resolveSpell(state, WIZ, { spellId: 'continual-flame', targets: [ALLY], slotLevel: 2 }, supply('cf')), 'flame').events,
    );
    expect(lightAt(lit, at(105, 100)).level).toBe('bright');
    const days = run(lit, unwrap(advanceTime(lit, 3 * 24 * HOUR, 'three days'), 'time'));
    expect(lightAt(days, at(105, 100)).level).toBe('bright');
  });
});

// — Dancing Lights ————————————————————————————————————————————————————————————

describe('SRD Dancing Lights', () => {
  it('sheds dim light where it is placed, and moves where its Bonus Action sends it', () => {
    const state = fold('seed', hall(made(WIZ, wizard()), WIZ));
    const cast = unwrap(
      resolveSpell(state, WIZ, { spellId: 'dancing-lights', targets: [], at: at(150, 100) }, supply('dl')),
      'dancing lights',
    );
    const lit = run(state, cast.events);
    expect(lightAt(lit, at(150, 100))).toMatchObject({ level: 'dim', magical: true });
    expect(lightAt(lit, at(165, 100)).level).toBeNull();

    const moved = unwrap(
      activateSpell(lit, WIZ, { castingId: cast.castingId!, targets: [], to: at(190, 100) }, supply('move')),
      'move',
    );
    const after = run(lit, moved.events);
    expect(lightAt(after, at(150, 100)).level).toBeNull();
    expect(lightAt(after, at(190, 100)).level).toBe('dim');
  });
});

// — Darkvision ————————————————————————————————————————————————————————————————

describe('SRD Darkvision, the spell', () => {
  it('gives the target Darkvision to 150 feet for eight hours', () => {
    const state = fold('seed', hall(made(WIZ, wizard()), WIZ));
    expect(sensesOf(state, ALLY)).toEqual([]);
    const cast = unwrap(
      resolveSpell(state, WIZ, { spellId: 'darkvision', targets: [ALLY], slotLevel: 2 }, supply('dv')),
      'darkvision',
    );
    const seeing = run(state, cast.events);
    expect(sensesOf(seeing, ALLY)).toContainEqual({ sense: 'darkvision', feet: 150 });

    const almost = run(seeing, unwrap(advanceTime(seeing, 8 * HOUR - 1, 'the night'), 'time'));
    expect(sensesOf(almost, ALLY).map((s) => s.sense)).toContain('darkvision');
    const over = run(almost, unwrap(advanceTime(almost, 1, 'dawn'), 'time'));
    expect(sensesOf(over, ALLY)).toEqual([]);
  });

  it('lengthens a Darkvision the creature already has rather than shortening it', () => {
    // The wizard is Human and has none; the casting is on somebody with sixty feet.
    const dwarfish: CharacterSheet = {
      ...plain(),
      standing: [
        {
          feature: 'test:eyes',
          name: 'Eyes of the Deep',
          reach: { kind: 'self' },
          grant: { kind: 'sense', sense: 'darkvision', feet: 60 },
        },
      ],
    };
    const state = fold(
      'seed',
      hall(made(WIZ, wizard()), WIZ).map((e) =>
        e.type === 'creature-added' && e.id === ALLY ? { ...e, sheet: dwarfish } : e,
      ),
    );
    const before = sensesOf(state, ALLY);
    const cast = unwrap(
      resolveSpell(state, WIZ, { spellId: 'darkvision', targets: [ALLY], slotLevel: 2 }, supply('dv')),
      'darkvision',
    );
    const feet = sensesOf(run(state, cast.events), ALLY).find((s) => s.sense === 'darkvision')?.feet;
    expect(feet).toBe(Math.max(150, before.find((s) => s.sense === 'darkvision')?.feet ?? 0));
  });
});

// — Faerie Fire ———————————————————————————————————————————————————————————————

describe('SRD Faerie Fire: Advantage if the attacker can see it', () => {
  const field = (): GameEvent[] => [
    ...made(WIZ, druid()),
    { type: 'creature-side-declared', id: WIZ, side: 'party' },
    added(GOBLIN, 'goblins'),
    added(ALLY, 'party'),
    { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
    { type: 'landmark-added', name: 'the gate', at: { x: 100, y: 100, z: 0 } },
    { type: 'creature-placed', id: WIZ, placement: { from: { landmark: 'the gate' }, feet: 0 } },
    // The goblin thirty feet east of the druid, the swordsman five feet
    // beyond it, and the Cube laid over the goblin's space pointing east.
    { type: 'creature-placed', id: GOBLIN, placement: { from: { creature: WIZ }, feet: 30, bearing: 90 } },
    { type: 'creature-placed', id: ALLY, placement: { from: { creature: GOBLIN }, feet: 5, bearing: 90 } },
    { type: 'items-gained', id: ALLY, items: [{ id: 'longsword', quantity: 1 }], source: 'loot' },
  ];

  const FIGHT: GameEvent = {
    type: 'combat-started',
    combatants: [
      { id: ALLY, initiative: 20, speed: 30 },
      { id: WIZ, initiative: 15, speed: 30 },
      { id: GOBLIN, initiative: 10, speed: 30 },
    ],
  };

  /** Cast until the goblin fails its save, which the seed decides. */
  const outlined = (): GameState => {
    const state = fold('seed', field());
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l']) {
      const cast = resolveSpell(
        state,
        WIZ,
        { spellId: 'faerie-fire', targets: [], slotLevel: 1, at: at(125, 100), towards: at(165, 100) },
        supply(seed),
      );
      if (!cast.ok) throw new Error(`${cast.code}: ${cast.reason}`);
      const after = run(state, cast.value.events);
      // A rider's source is the casting's label, which ends in the casting id.
      if (after.creatures[GOBLIN]!.rollModifiers.some((held) => held.source.endsWith(cast.value.castingId!))) {
        return after;
      }
    }
    throw new Error('the goblin made twelve saves in a row');
  };

  // The roll sites read the roller's sight themselves; a reader asking the
  // question directly says what the sites say.
  const modes = (state: GameState) =>
    rollModesFor(state, {
      family: 'attack',
      roller: ALLY,
      against: GOBLIN,
      ability: 'str',
      rollerSees: canSee(state, ALLY, GOBLIN),
    });

  it('is Advantage for an attacker who can see the outlined creature, and nothing for one who cannot', () => {
    const state = outlined();
    const seen = run(state, [{ type: 'sight-declared', from: ALLY, to: GOBLIN, seen: true }]);
    expect(modes(seen).modes.map((m) => m.mode)).toContain('advantage');
    const blind = run(state, [{ type: 'sight-declared', from: ALLY, to: GOBLIN, seen: false }]);
    expect(modes(blind).modes.map((m) => m.mode)).not.toContain('advantage');
  });

  it('is applied and reported where nobody has said whether the attacker can see', () => {
    const state = outlined();
    const read = modes(state);
    expect(read.modes.map((m) => m.mode)).toContain('advantage');
    expect(read.unverified.some((line) => line.includes('see'))).toBe(true);
  });

  it('reaches the attack roll', () => {
    const state = run(outlined(), [FIGHT, { type: 'sight-declared', from: ALLY, to: GOBLIN, seen: true }]);
    const swing = unwrap(resolveAttack(state, ALLY, { target: GOBLIN, weapon: 'longsword' }, supply('swing')), 'attack');
    // The attack's own mode: its roll record names contributions and the face,
    // not the modes, which is a gap of the record's and not of this rule.
    expect(swing.attack?.mode).toBe('advantage');
  });
});
