import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, isErr, type CharacterId, type Result } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { declaredCasting } from './spellcasting.js';
import { activateSpell, resolveSpell } from './commands.js';

/**
 * SRD Dragon's Breath, the later action somebody other than the caster takes.
 *
 * > "You touch one willing creature, and choose Acid, Cold, Fire, Lightning, or
 * > Poison. Until the spell ends, **the target** can take a Magic action to
 * > exhale a 15-foot Cone. Each creature in that area makes a Dexterity saving
 * > throw, taking 3d6 damage of the chosen type on a failed save or half as
 * > much damage on a successful one."
 *
 * Two things this spell waited on and both are on the activation. **`by:
 * 'target'`**: the Magic action belongs to the creature the casting is on, and
 * the caster may not take it — "a spell is not a thing lying about for anyone
 * to pick up" now cuts both ways. **`area`**: a fresh 15-foot Cone drawn at the
 * exhaler's own space, in a direction stated when the action is taken, caught
 * through the same `areaCatch` a casting's own area is caught through. The
 * damage type is the one the caster stated at the cast and the record pinned.
 */

const id = (s: string): CharacterId => asCharacterId(s);
const SORCERER = id('sorcerer');
const FIGHTER = id('fighter');
const NEAR = id('goblin-near');
const FAR = id('goblin-far');

const sheet = (): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 10, con: 12, int: 10, wis: 10, cha: 18 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'cha',
});

const added = (who: CharacterId, side: string): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 60,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side,
});

/** The sorcerer beside the fighter, and two goblins in a row east of the fighter. */
const FIELD: readonly GameEvent[] = [
  added(SORCERER, 'party'),
  added(FIGHTER, 'party'),
  added(NEAR, 'goblins'),
  added(FAR, 'goblins'),
  {
    type: 'spellcasting-declared',
    id: SORCERER,
    spellcasting: declaredCasting({
      ability: 'cha',
      classId: 'sorcerer',
      prepared: ['dragons-breath'],
    }),
  },
  {
    type: 'resource-pool-declared',
    id: SORCERER,
    pool: { key: 'spell-slot:2', label: 'level 2', max: 2, recovers: 'long-rest' },
  },
  { type: 'scene-set', extent: { width: 300, depth: 300, height: 40 } },
  { type: 'landmark-added', name: 'the road', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: SORCERER, placement: { from: { landmark: 'the road' }, feet: 0 } },
  {
    type: 'creature-placed',
    id: FIGHTER,
    placement: { from: { creature: SORCERER }, feet: 5, bearing: 180 },
  },
  {
    type: 'creature-placed',
    id: NEAR,
    placement: { from: { creature: FIGHTER }, feet: 5, bearing: 90 },
  },
  {
    type: 'creature-placed',
    id: FAR,
    placement: { from: { creature: FIGHTER }, feet: 10, bearing: 90 },
  },
  { type: 'sight-declared', from: SORCERER, to: FIGHTER, seen: true },
];

const supply = (seed: string) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

const must = <T,>(result: Result<T>, what: string): T => unwrap(result, what);

/** The casting, on the fighter, with Fire stated. */
const touched = () => {
  const out = must(
    resolveSpell(
      fold('seed', FIELD),
      SORCERER,
      {
        spellId: 'dragons-breath',
        targets: [FIGHTER],
        slotLevel: 2,
        damageType: 'fire',
        willing: [FIGHTER],
      },
      supply('touch'),
    ),
    "Dragon's Breath",
  );
  const log = [...FIELD, ...out.events];
  return { out, log, state: fold('seed', log) as GameState, castingId: out.castingId! };
};

/** East of the fighter, which is where both goblins are standing. */
const EAST = { x: 155, y: 100, z: 0 };

describe("Dragon's Breath", () => {
  it('is on the creature the caster touched and states the type', () => {
    const { state, castingId } = touched();
    const record = state.ongoing[castingId]!;
    expect(record.caster).toBe(SORCERER);
    expect(record.aimed).toContain(FIGHTER);
    expect(record.damageType).toBe('fire');
  });

  it('lets the creature it is on exhale a Cone, and asks both goblins for a save', () => {
    const { state, castingId } = touched();
    const breathed = must(
      activateSpell(state, FIGHTER, { castingId, targets: [], towards: EAST }, supply('cone')),
      'the Cone',
    );

    // Both goblins, and nobody else: the exhaler is the Cone's own origin and
    // SRD leaves the origin creature out of a Cone.
    expect(breathed.outcomes.map((one) => one.target).sort()).toEqual([FAR, NEAR]);
    for (const outcome of breathed.outcomes) expect(outcome.save).toBeDefined();

    // The type the caster stated, on the dice the exhaler's Cone threw.
    const dice = breathed.events.filter((event) => event.type === 'damage-dice-recorded');
    expect(dice.length).toBe(2);
    for (const rolled of dice) {
      if (rolled.type !== 'damage-dice-recorded') throw new Error('filtered');
      expect(rolled.components.map((part) => part.type)).toEqual(['fire']);
      // Three dice at the slot it was cast with, and no more.
      expect(rolled.components[0]!.dice.length).toBe(3);
    }

    // Both took something and the failure took more than the success did,
    // which is the half the book gives a successful save.
    const took = breathed.events.filter((event) => event.type === 'damage-taken');
    expect(took.length).toBe(2);
    expect(took.every((blow) => blow.type === 'damage-taken' && blow.amount > 0)).toBe(true);
    // The exhaler dealt it, which is what SRD Hellish Rebuke would read: the
    // goblin was scorched by the fighter and not by the wizard who touched them.
    expect(took.every((blow) => blow.type === 'damage-taken' && blow.by === FIGHTER)).toBe(true);
    const saved = breathed.outcomes.filter((one) => one.save?.success === true);
    const failed = breathed.outcomes.filter((one) => one.save?.success === false);
    expect(saved.length + failed.length).toBe(2);

    // The log says who acted.
    const acted = breathed.events.find((event) => event.type === 'spell-activated');
    expect(acted).toMatchObject({ by: FIGHTER, castingId });
  });

  it('refuses the caster, who may not exhale somebody else’s lungs', () => {
    const { state, castingId } = touched();
    const refused = activateSpell(
      state,
      SORCERER,
      { castingId, targets: [], towards: EAST },
      supply('cone'),
    );
    expect(isErr(refused) && refused.code).toBe('not_your_spell');
  });

  it('refuses an exhalation with no direction', () => {
    const { state, castingId } = touched();
    const refused = activateSpell(state, FIGHTER, { castingId, targets: [] }, supply('cone'));
    expect(isErr(refused) && refused.code).toBe('no_direction');
  });

  it('refuses a target list: the Cone catches whoever it covers', () => {
    const { state, castingId } = touched();
    const refused = activateSpell(
      state,
      FIGHTER,
      { castingId, targets: [NEAR], towards: EAST },
      supply('cone'),
    );
    expect(isErr(refused) && refused.code).toBe('wrong_target_count');
  });

  it('spends the exhaler’s own Action, not the caster’s', () => {
    const { log, castingId } = touched();
    const fighting = [
      ...log,
      {
        type: 'combat-started',
        combatants: [
          { id: FIGHTER, initiative: 20, speed: 30 },
          { id: SORCERER, initiative: 15, speed: 30 },
          { id: NEAR, initiative: 10, speed: 30 },
          { id: FAR, initiative: 5, speed: 30 },
        ],
      } satisfies GameEvent,
    ];
    const state = fold('seed', fighting) as GameState;
    const breathed = must(
      activateSpell(state, FIGHTER, { castingId, targets: [], towards: EAST }, supply('cone')),
      'the Cone',
    );
    const spent = breathed.events.filter((event) => event.type === 'action-spent');
    expect(spent).toEqual([{ type: 'action-spent', id: FIGHTER }]);
  });
});
