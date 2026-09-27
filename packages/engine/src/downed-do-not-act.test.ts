import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap, type CharacterId, type Result } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { applyEvent, fold, type GameEvent, type GameState } from './events.js';
import { spellSlotKey } from './resources.js';
import { declaredCasting } from './spellcasting.js';
import {
  activateFeature,
  damageCreature,
  healCreature,
  resolveAttack,
  resolveMove,
  resolveSpell,
  resolveTurn,
  stabiliseCreature,
  takeDash,
  takeDodge,
} from './commands.js';
import { createCharacter, type CharacterChoices } from './creation.js';
import { spendReactionCost } from './commands/damage.js';
import type { ReactionFeature } from './reactions.js';

/**
 * The downed and the dead do not act.
 *
 * Found by the first live playtest: Bram, a level-3 Fighter, dropped to 0 Hit
 * Points, failed three death saves and was dead — and the engine then accepted
 * a `move` by the corpse, and a goblin took an Opportunity Attack on it. A
 * creature that dies stops being Unconscious (it is dead, which is a different
 * state), so nothing about its *conditions* stopped it: nothing asked whether
 * it was alive.
 *
 * SRD 5.2.1:
 *
 * > **Unconscious.** "You have the Incapacitated and Prone conditions" …
 * > "Your Speed is 0 and can't increase."
 * >
 * > **Incapacitated.** "You can't take any action, Bonus Action, or Reaction."
 * >
 * > **Dead.** "A dead creature has no Hit Points and can't regain them unless
 * > it is first revived by magic such as the Raise Dead or Revivify spell."
 */

const id = (s: string): CharacterId => asCharacterId(s);
const BRAM = id('bram');
const GRUM = id('grum');
const GOBLIN = id('goblin');
const CLERIC = id('cleric');

const plain = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 18, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'wis',
  ...over,
});

/** A level-3 Fighter with Magic Initiate, so he has a spell to be refused. */
const fighter = (): CharacterChoices => ({
  name: 'Bram',
  classId: 'fighter',
  level: 3,
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
  },
  abilityIncreases: { con: 2, wis: 1 },
  classSkills: ['athletics', 'survival'],
  languages: ['Dwarvish', 'Orc'],
  alignment: 'Neutral',
  subclassId: 'champion',
  cantrips: [],
  spellbook: [],
  preparedSpells: [],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
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
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
});

/** A level-3 Barbarian, who has a feature to switch on: Rage. */
const barbarian = (): CharacterChoices => ({
  name: 'Grum',
  classId: 'barbarian',
  level: 3,
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
  },
  abilityIncreases: { con: 2, wis: 1 },
  classSkills: ['athletics', 'survival'],
  languages: ['Dwarvish', 'Orc'],
  alignment: 'Chaotic Neutral',
  subclassId: 'path-of-the-berserker',
  cantrips: [],
  spellbook: [],
  preparedSpells: [],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: {
    'human:skillful': ['perception'],
    'barbarian:primal-knowledge': ['intimidation'],
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
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
});

const RAGE = 'barbarian:rage';

/**
 * The yard: Bram with a goblin five feet north of him, Grum ten feet west, a
 * Cleric five feet east. The goblin sees Bram, so a walk away from it is a walk
 * out of its reach that it may swing at.
 */
const room = (): readonly GameEvent[] => [
  ...unwrap(createCharacter(SRD_CONTENT, fighter(), BRAM), 'Bram'),
  ...unwrap(createCharacter(SRD_CONTENT, barbarian(), GRUM), 'Grum'),
  { type: 'creature-side-declared', id: BRAM, side: 'party' },
  { type: 'creature-side-declared', id: GRUM, side: 'party' },
  { type: 'items-gained', id: BRAM, items: [{ id: 'longsword', quantity: 1 }], source: 'loot' },
  {
    type: 'creature-added',
    id: GOBLIN,
    name: 'goblin',
    sheet: plain({ spellcastingAbility: null }),
    maxHp: 200,
    diesAtZero: false,
    creatureType: 'Humanoid',
    side: 'goblins',
  },
  {
    type: 'creature-added',
    id: CLERIC,
    name: 'cleric',
    sheet: plain(),
    maxHp: 20,
    diesAtZero: false,
    creatureType: 'Humanoid',
    side: 'party',
  },
  {
    type: 'spellcasting-declared',
    id: CLERIC,
    spellcasting: declaredCasting({ ability: 'wis', classId: 'cleric', prepared: ['revivify'] }),
  },
  {
    type: 'resource-pool-declared',
    id: CLERIC,
    pool: { key: spellSlotKey(3), label: 'level 3 spell slot', max: 3, recovers: 'long-rest' },
  },
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
  { type: 'landmark-added', name: 'the yard', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: BRAM, placement: { from: { landmark: 'the yard' }, feet: 0 } },
  { type: 'creature-placed', id: GOBLIN, placement: { from: { creature: BRAM }, feet: 5, bearing: 0 } },
  { type: 'creature-placed', id: GRUM, placement: { from: { creature: BRAM }, feet: 10, bearing: 270 } },
  { type: 'creature-placed', id: CLERIC, placement: { from: { creature: BRAM }, feet: 5, bearing: 90 } },
  { type: 'sight-declared', from: GOBLIN, to: BRAM, seen: true },
  { type: 'sight-declared', from: CLERIC, to: BRAM, seen: true },
];

/** The same room with a fight running and the first hero's turn begun — Bram's, unless Grum's is asked for. */
const fight = (first: CharacterId = BRAM): readonly GameEvent[] => [
  ...room(),
  {
    type: 'combat-started',
    combatants: [
      { id: BRAM, initiative: first === BRAM ? 20 : 15, speed: 30 },
      { id: GRUM, initiative: first === GRUM ? 20 : 15, speed: 30 },
      { id: GOBLIN, initiative: 10, speed: 30 },
      { id: CLERIC, initiative: 5, speed: 30 },
    ],
  },
];

const supply = (seed = 'down') => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

/** Apply one command's events to a log. */
const then = (log: readonly GameEvent[], events: readonly GameEvent[]): readonly GameEvent[] => [
  ...log,
  ...events,
];

/** Knock a hero down to nought: exactly the hit points they have. */
const downed = (log: readonly GameEvent[], who: CharacterId = BRAM): readonly GameEvent[] => {
  const state = fold('s', log);
  const hp = state.creatures[who]!.vitals.hp;
  return then(log, unwrap(damageCreature(state, who, { amount: hp, source: 'a goblin’s knife' }), 'down'));
};

/**
 * And kill them the way the playtest did: three Death Saving Throw failures.
 * SRD: "If you take any damage while you have 0 Hit Points, you suffer a Death
 * Saving Throw failure" — three blows of one, so no die decides it.
 */
const killed = (log: readonly GameEvent[], who: CharacterId = BRAM): readonly GameEvent[] => {
  let out = downed(log, who);
  for (let blow = 0; blow < 3; blow += 1) {
    out = then(out, unwrap(damageCreature(fold('s', out), who, { amount: 1, source: 'the knife again' }), 'fail'));
  }
  return out;
};

const stabilised = (log: readonly GameEvent[]): readonly GameEvent[] => {
  const down = downed(log);
  return then(down, unwrap(stabiliseCreature(fold('s', down), BRAM), 'stable'));
};

const code = (out: Result<unknown>): string => (isErr(out) ? out.code : 'ok');

/** Walk ten feet south, out of the goblin's reach. */
const AWAY = { from: { creature: GOBLIN }, feet: 15, bearing: 180 } as const;

/** The doors the playtest's tool surface reaches — move, attack, cast_spell, take_action, activate_feature — by the engine command behind each. */
const DOORS: readonly { readonly name: string; readonly run: (s: GameState, who: CharacterId) => Result<unknown> }[] = [
  { name: 'move', run: (s, who) => resolveMove(s, who, { placement: AWAY }, supply()) },
  { name: 'attack', run: (s, who) => resolveAttack(s, who, { target: GOBLIN, weapon: 'longsword' }, supply()) },
  {
    name: 'cast_spell',
    run: (s, who) => resolveSpell(s, who, { spellId: 'mage-hand', targets: [] }, supply()),
  },
  { name: 'take_action (Dash)', run: (s, who) => takeDash(s, who, {}) },
  { name: 'take_action (Dodge)', run: (s, who) => takeDodge(s, who, {}) },
  { name: 'activate_feature', run: (s, who) => activateFeature(s, who, { feature: RAGE }, SRD_CONTENT) },
];

describe('the fixture is what it says', () => {
  it('Bram is dead, and no longer Unconscious — which is why nothing stopped him', () => {
    const bram = fold('s', killed(fight())).creatures[BRAM]!;
    expect(bram.vitals.dead).toBe(true);
    expect(bram.conditions.conditions.includes('unconscious')).toBe(false);
  });

  it('a downed Bram is dying: at nought, Unconscious, not stable', () => {
    const bram = fold('s', downed(fight())).creatures[BRAM]!;
    expect(bram.vitals.hp).toBe(0);
    expect(bram.vitals.dead).toBe(false);
    expect(bram.vitals.stable).toBe(false);
    expect(bram.conditions.conditions.includes('unconscious')).toBe(true);
  });

  it('a stabilised Bram is stable at nought and still Unconscious', () => {
    const bram = fold('s', stabilised(fight())).creatures[BRAM]!;
    expect(bram.vitals.stable).toBe(true);
    expect(bram.conditions.conditions.includes('unconscious')).toBe(true);
  });

  it('and on his feet, every door is open to him — the refusals below are his state talking', () => {
    const state = fold('s', fight());
    for (const door of DOORS.filter((one) => one.name !== 'activate_feature')) {
      expect([door.name, code(door.run(state, BRAM))]).toEqual([door.name, 'ok']);
    }
    expect(code(activateFeature(fold('s', fight(GRUM)), GRUM, { feature: RAGE }, SRD_CONTENT))).toBe('ok');
  });

  it('and the walk away provokes the goblin, alive — which is what the corpse did', () => {
    const state = fold('s', fight());
    const out = unwrap(resolveMove(state, BRAM, { placement: AWAY }, supply()), 'walk');
    const held = out.events.reduce(applyEvent, state).pendingMove;
    expect(held?.provoked.map((one) => one.reactor)).toEqual([GOBLIN]);
  });
});

describe('the playtest, reproduced: a dead hero does not move, and nobody swings at the corpse', () => {
  it('refuses the move, so no move is held open for an Opportunity Attack', () => {
    const out = resolveMove(fold('s', killed(fight())), BRAM, { placement: AWAY }, supply());
    expect(code(out)).toBe('actor_dead');
  });

  it('refuses it outside a fight as well, where there is no budget to run out of', () => {
    expect(code(resolveMove(fold('s', killed(room())), BRAM, { placement: AWAY }, supply()))).toBe('actor_dead');
  });
});

describe('a dead creature is refused everything it would do itself', () => {
  for (const door of DOORS) {
    it(`${door.name}: actor_dead`, () => {
      const who = door.name === 'activate_feature' ? GRUM : BRAM;
      expect(code(door.run(fold('s', killed(fight(who), who)), who))).toBe('actor_dead');
    });
  }
});

describe('an Unconscious creature at nought hit points does not act either', () => {
  for (const [name, log] of [
    ['dying', () => downed(fight())],
    ['stable', () => stabilised(fight())],
  ] as const) {
    it(`${name}: its move is refused, because its Speed is 0`, () => {
      expect(code(resolveMove(fold('s', log()), BRAM, { placement: AWAY }, supply()))).toBe('no_speed');
    });

    it(`${name}: and so outside a fight, where no budget would have caught it`, () => {
      const outside = name === 'dying' ? downed(room()) : then(downed(room()), unwrap(stabiliseCreature(fold('s', downed(room())), BRAM), 'stable'));
      expect(code(resolveMove(fold('s', outside), BRAM, { placement: AWAY }, supply()))).toBe('no_speed');
    });

    for (const door of DOORS.filter((one) => one.name !== 'move' && one.name !== 'activate_feature')) {
      it(`${name}: ${door.name} is refused, because it is Incapacitated`, () => {
        expect(code(door.run(fold('s', log()), BRAM))).toBe('incapacitated');
      });
    }
  }

  /**
   * Outside a fight there is no budget, so `spendAction`'s own refusal is never
   * reached — the actor's state has to be asked for itself.
   */
  for (const door of DOORS.filter((one) => one.name !== 'move' && one.name !== 'activate_feature')) {
    it(`dying, outside a fight: ${door.name} is refused, because it is Incapacitated`, () => {
      expect(code(door.run(fold('s', downed(room())), BRAM))).toBe('incapacitated');
    });
  }

  it('Grum, dying, cannot Rage', () => {
    expect(code(activateFeature(fold('s', downed(fight(GRUM), GRUM)), GRUM, { feature: RAGE }, SRD_CONTENT))).toBe(
      'incapacitated',
    );
  });
});

describe('Speed 0 without being downed is refused a walk too', () => {
  const restrained = (log: readonly GameEvent[]): readonly GameEvent[] => [
    ...log,
    { type: 'condition-applied', id: BRAM, condition: 'restrained', source: 'a net' },
  ];

  it('in a fight', () => {
    expect(code(resolveMove(fold('s', restrained(fight())), BRAM, { placement: AWAY }, supply()))).toBe('no_speed');
  });

  it('and out of one', () => {
    expect(code(resolveMove(fold('s', restrained(room())), BRAM, { placement: AWAY }, supply()))).toBe('no_speed');
  });

  /**
   * "Your Speed is 0 and can't increase": a Dash taken before the net landed
   * banked feet the budget still holds, and they buy no step.
   */
  it('and a Dash banked before the Speed fell to 0 buys no step', () => {
    const dashed = then(fight(), unwrap(takeDash(fold('s', fight()), BRAM, {}), 'dash'));
    const state = fold('s', restrained(dashed));
    expect(state.combat?.budgets[BRAM]?.movementGained).toBeGreaterThan(0);
    expect(code(resolveMove(state, BRAM, { placement: AWAY }, supply()))).toBe('no_speed');
  });

  it('but a Restrained creature is not Incapacitated, so it may still swing', () => {
    expect(code(resolveAttack(fold('s', restrained(fight())), BRAM, { target: GOBLIN, weapon: 'longsword' }, supply()))).not.toBe(
      'incapacitated',
    );
  });
});

/**
 * A Reaction is the reactor's own act too. Every window's command asks what a
 * Reaction costs in one place — `spendReactionCost` — so that is where the
 * reactor's state is asked, in a fight and out of one.
 */
describe('a dead or Incapacitated creature answers no window', () => {
  const feature = (costsReaction: boolean): ReactionFeature =>
    ({
      feature: 'test:parry',
      name: 'Parry',
      window: 'hit-by-attack',
      costsReaction,
      pool: null,
      reach: { kind: 'self' },
      does: { kind: 'raise-ac', amount: 2 },
    }) as ReactionFeature;

  const cost = (log: readonly GameEvent[], costsReaction: boolean): string => {
    const state = fold('s', log);
    return code(spendReactionCost(state, BRAM, state.creatures[BRAM]!, feature(costsReaction)));
  };

  it('refuses a dead reactor, whatever the Reaction costs', () => {
    expect(cost(killed(room()), true)).toBe('actor_dead');
    expect(cost(killed(room()), false)).toBe('actor_dead');
  });

  it('refuses an Incapacitated one what costs the Reaction, and nothing else', () => {
    expect(cost(downed(room()), true)).toBe('incapacitated');
    expect(cost(downed(room()), false)).toBe('ok');
  });
});

describe('what is done to the downed and the dead stays open', () => {
  it('a forced move of an Unconscious creature is performed, and provokes nothing', () => {
    const state = fold('s', downed(fight()));
    const out = unwrap(resolveMove(state, BRAM, { placement: AWAY, forced: true }, supply()), 'dragged');
    // SRD: an Opportunity Attack needs the creature to leave "using its action,
    // its Bonus Action, its Reaction, or one of its speeds" — being dragged is
    // none of those.
    const after = out.events.reduce(applyEvent, state);
    expect(after.pendingMove).toBeNull();
    expect(out.events.some((event) => event.type === 'creature-moved')).toBe(true);
    expect(out.events.some((event) => event.type === 'movement-spent')).toBe(false);
  });

  it('and so is a forced move of a corpse', () => {
    const state = fold('s', killed(fight()));
    const out = unwrap(resolveMove(state, BRAM, { placement: AWAY, forced: true }, supply()), 'dragged');
    expect(out.events.reduce(applyEvent, state).pendingMove).toBeNull();
  });

  it('Revivify is cast on the dead, not by them', () => {
    const state = fold('s', killed(fight()));
    // The Cleric's turn, so the casting has an Action to spend.
    let log = killed(fight());
    for (let step = 0; step < 3; step += 1) {
      log = then(log, unwrap(resolveTurn(fold('s', log), supply(`turn-${step}`)), 'turn').events);
    }
    expect(fold('s', log).combat?.order[fold('s', log).combat!.turnIndex]?.id).toBe(CLERIC);
    const raised = unwrap(
      resolveSpell(fold('s', log), CLERIC, { spellId: 'revivify', targets: [BRAM], slotLevel: 3 }, supply()),
      'revivify',
    );
    const after = fold('s', [...log, ...raised.events]).creatures[BRAM]!;
    expect(after.vitals.dead).toBe(false);
    expect(after.vitals.hp).toBeGreaterThan(0);
    // And ordinary healing still meets the corpse with the target's own refusal.
    expect(code(healCreature(state, BRAM, 5))).toBe('dead');
  });

  it('a dead creature’s turn still ends, so the fight goes on past it', () => {
    const out = resolveTurn(fold('s', killed(fight())), supply());
    expect(code(out)).toBe('ok');
  });

  it('a dying creature’s turn still ends too, which is where its death save is rolled', () => {
    // Round the table to Bram's next turn start and past it.
    let log = downed(fight());
    for (let step = 0; step < 5; step += 1) {
      const out = resolveTurn(fold('s', log), supply(`round-${step}`));
      expect(code(out)).toBe('ok');
      log = then(log, unwrap(out, 'turn').events);
    }
    expect(log.some((event) => event.type === 'death-save-recorded')).toBe(true);
  });
});
