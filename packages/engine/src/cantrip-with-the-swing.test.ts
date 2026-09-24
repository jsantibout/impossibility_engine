import { describe, expect, it } from 'vitest';
import { SPELL_DEFINITIONS, SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap, type CharacterId, type Result } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import type { Rng, RngState } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, grantSourcesOf, type GameEvent, type GameState } from './events.js';
import { declaredCasting } from './spellcasting.js';
import { resolveAttack, resolveSpell } from './commands.js';

/**
 * A cantrip cast **with** the swing it makes — SRD True Strike.
 *
 * > _Divination Cantrip._ **Casting Time:** Action. **Range:** Self.
 * > **Duration:** Instantaneous. Material: "a weapon with which you have
 * > proficiency".
 * > "Guided by a flash of magical insight, you make one attack with the weapon
 * > used in the spell's casting. The attack uses your spellcasting ability for
 * > the attack and damage rolls instead of using Strength or Dexterity. If the
 * > attack deals damage, it can be Radiant damage or the weapon's normal
 * > damage type (your choice)." _Cantrip Upgrade._ "the attack deals extra
 * > Radiant damage when you reach levels 5 (1d6), 11 (2d6), and 17 (3d6)."
 *
 * **The casting and the swing are one moment**, which is the whole shape of
 * it. Divine Smite is the mirror image one command later — a spell cast on a
 * hit that has already happened, through `resolveAttackDamage` — and this is a
 * spell cast *as* the hit, through `resolveAttack`. Neither can be cast by
 * `resolveSpell`, because the attack is the thing they need and that command
 * has none to give.
 *
 * So: one Action, spent as the casting's Magic action; `spell-cast` ahead of
 * the roll in the log; the substitution and the Radiant die on this roll and
 * no other; nothing granted and nothing left standing afterwards. A one-shot
 * grant left on the caster would be two Actions where the book prints one.
 */

const id = (s: string): CharacterId => asCharacterId(s);
const CASTER = id('caster');
const DUMMY = id('dummy');

/**
 * The d20 is whatever the test asks for; every die after it comes up on its
 * highest face — `weapon-rider.test.ts`'s generator, for its reason.
 *
 * A damage total is then a number the SRD sentence predicts rather than one
 * sampled out of a seed: a Mace's `1d6` is 6 and the upgrade's `1d6` is 6, so
 * which dice were thrown is read off the total.
 */
const scripted = (d20: number): Rng => {
  let thrown = 0;
  return {
    int: (sides: number) => (thrown++ === 0 ? d20 : sides),
    snapshot: (): RngState => [0, 0, 0, 0],
  };
};

const supply = (d20 = 15) => ({
  issuer: createRollIssuer('r'),
  rng: scripted(d20),
  content: SRD_CONTENT,
});

/**
 * Strength 8 and Wisdom 18, which is what makes the substitution readable: a
 * Mace swung by this caster subtracts one, and the same Mace swung through the
 * casting adds four.
 */
const sheet = (level: number, over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level,
  abilities: { str: 8, dex: 10, con: 10, int: 10, wis: 18, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'wis',
  // Simple weapons and no more, which is what the Greatsword below is for.
  weaponProficiencies: ['simple'],
  ...over,
});

const table = (level = 5, over: Partial<CharacterSheet> = {}): readonly GameEvent[] => [
  {
    type: 'creature-added',
    id: CASTER,
    name: CASTER,
    sheet: sheet(level, over),
    maxHp: 400,
    diesAtZero: false,
    creatureType: 'Humanoid',
  },
  {
    type: 'spellcasting-declared',
    id: CASTER,
    spellcasting: declaredCasting({
      ability: 'wis',
      cantrips: ['true-strike', 'sacred-flame'],
      prepared: ['cure-wounds'],
    }),
  },
  {
    type: 'items-gained',
    id: CASTER,
    items: [
      { id: 'mace', quantity: 1 },
      { id: 'greatsword', quantity: 1 },
    ],
    source: 'kit',
  },
  {
    type: 'creature-added',
    id: DUMMY,
    name: DUMMY,
    sheet: sheet(1),
    maxHp: 400,
    diesAtZero: false,
    creatureType: 'Humanoid',
  },
  { type: 'scene-set', extent: { width: 600, depth: 600, height: 40 } },
  { type: 'landmark-added', name: 'the gate', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: CASTER, placement: { from: { landmark: 'the gate' }, feet: 0 } },
  {
    type: 'creature-placed',
    id: DUMMY,
    placement: { from: { creature: CASTER }, feet: 5, bearing: 0 },
  },
  { type: 'sight-declared', from: CASTER, to: DUMMY, seen: true },
];

/** The same table, with a fight running so the economy has something to spend. */
const fighting = (level = 5): readonly GameEvent[] => [
  ...table(level),
  {
    type: 'combat-started',
    combatants: [
      { id: CASTER, initiative: 20, speed: 30 },
      { id: DUMMY, initiative: 10, speed: 30 },
    ],
  },
];

const must = <T,>(result: Result<T>): T => unwrap(result, 'the swing');

type Swing = Parameters<typeof resolveAttack>[2];

const swing = (log: readonly GameEvent[], command: Partial<Swing> = {}, d20 = 15) =>
  resolveAttack(
    fold('seed', log),
    CASTER,
    {
      target: DUMMY,
      weapon: 'mace',
      cantrip: { spellId: 'true-strike' },
      ...command,
    } as Swing,
    supply(d20),
  );

const state = (log: readonly GameEvent[]): GameState => fold('seed', log);

const typesOf = (events: readonly GameEvent[]): readonly string[] => {
  const record = events.find((event) => event.type === 'damage-dice-recorded');
  if (record?.type !== 'damage-dice-recorded') throw new Error('no damage dice were recorded');
  return record.components.map((component) => component.type);
};

describe('the definition says what the swing is made of', () => {
  const trueStrike = () => SPELL_DEFINITIONS.find((one) => one.id === 'true-strike');

  it('carries the one effect kind the attack command resolves', () => {
    expect(trueStrike()?.effects).toEqual([
      {
        kind: 'weapon-attack',
        ability: 'spellcasting',
        damageTypes: ['radiant'],
        extraDamage: {
          damageType: 'radiant',
          diceAtLevel: { 5: '1d6', 11: '2d6', 17: '3d6' },
        },
      },
    ]);
  });

  /** Nothing is left over: the swing is the whole spell. */
  it('leaves nothing for the table to adjudicate', () => {
    expect(trueStrike()?.unmodelled).toBeUndefined();
  });
});

/**
 * The control: the same Mace, swung by the same caster, with no casting in it.
 * Every assertion below is a delta against this.
 */
describe('the unaided Mace', () => {
  it('rolls its own d6 and subtracts the caster’s Strength', () => {
    const hit = must(swing(table(), { cantrip: undefined }));
    expect(hit.attack?.ability).toBe('str');
    expect(hit.damage).toBe(6 - 1);
  });
});

describe('True Strike is cast with the swing it makes', () => {
  it('rolls the attack and the damage with the spellcasting ability', () => {
    const hit = must(swing(table()));
    expect(hit.attack?.ability).toBe('wis');
    // A Mace's 1d6 with Wisdom 18 behind it, and the level 5 Radiant die.
    expect(hit.damage).toBe(6 + 4 + 6);
  });

  /**
   * The attack roll's own modifier says it too: +4 for the Wisdom and +3 for
   * the Proficiency Bonus a level 5 character has, where the unaided swing
   * would have added +2.
   */
  it('puts the substituted modifier on the attack roll', () => {
    const rolled = must(swing(table())).attack!;
    expect(rolled.roll.modifier).toBe(4 + 3);
    expect(must(swing(table(), { cantrip: undefined })).attack!.roll.modifier).toBe(-1 + 3);
  });

  it('casts the spell before it swings', () => {
    const events = must(swing(table())).events;
    const cast = events.findIndex((event) => event.type === 'spell-cast');
    const rolled = events.findIndex(
      (event) => event.type === 'roll-recorded' && event.label.includes('attack'),
    );
    expect(cast).toBeGreaterThanOrEqual(0);
    expect(rolled).toBeGreaterThan(cast);
  });

  it('records the casting as a cantrip, spending no slot', () => {
    const cast = must(swing(table())).events.find((event) => event.type === 'spell-cast');
    expect(cast).toMatchObject({ spell: 'True Strike', level: 0, slot: null, slotless: 'cantrip' });
  });

  /**
   * SRD Cantrip Upgrade, read off the **character's** level: the die arrives
   * at 5 and there is none below it. The band table says so with no entry
   * rather than with a notation that rolls nothing.
   */
  it('adds no die below level 5', () => {
    expect(must(swing(table(4))).damage).toBe(6 + 4);
    expect(typesOf(must(swing(table(4))).events)).toEqual(['bludgeoning']);
  });

  it('rolls the Radiant die as its own component, so the log shows the faces', () => {
    const events = must(swing(table())).events;
    const record = events.find((event) => event.type === 'damage-dice-recorded');
    if (record?.type !== 'damage-dice-recorded') throw new Error('no damage dice were recorded');
    const radiant = record.components.find((component) => component.source === 'True Strike');
    expect(radiant?.type).toBe('radiant');
    expect(radiant?.dice.map((die) => die.value)).toEqual([6]);
  });

  /** "it can be Radiant damage **or** the weapon's normal damage type". */
  it('deals the weapon’s own type where nobody names one', () => {
    expect(typesOf(must(swing(table())).events)).toEqual(['bludgeoning', 'radiant']);
  });

  it('deals Radiant in place of the weapon’s type when the caster says so', () => {
    const hit = must(swing(table(), { cantrip: { spellId: 'true-strike', damageType: 'radiant' } }));
    expect(typesOf(hit.events)).toEqual(['radiant', 'radiant']);
    // Only the type moved: the die and the modifier are what they were.
    expect(hit.damage).toBe(6 + 4 + 6);
  });

  /**
   * **Nothing outlives the swing**, which is the ruling this shape was chosen
   * for: a grant left on the caster would be a second Action's worth of
   * benefit bought with one.
   */
  it('leaves no grant, no timer and no running casting', () => {
    const after = state([...table(), ...must(swing(table())).events]);
    expect(after.creatures.caster!.weaponRiders).toEqual([]);
    expect(grantSourcesOf(after.creatures.caster!)).toEqual([]);
    expect(Object.keys(after.timers)).toEqual([]);
    expect(Object.keys(after.ongoing)).toEqual([]);
    expect(after.creatures.caster!.concentration).toBeNull();
  });
});

describe('the Action it costs is the casting’s', () => {
  const budgetOf = (log: readonly GameEvent[]): GameState['combat'] => state(log).combat;

  it('spends the Action once and takes no Attack action', () => {
    const hit = must(swing(fighting()));
    expect(hit.events.filter((event) => event.type === 'action-spent')).toHaveLength(1);
    // Not the Attack action: `attack-made` is what spends one swing of one,
    // and Extra Attack has nothing to put in a Magic action.
    expect(hit.events.some((event) => event.type === 'attack-made')).toBe(false);

    const after = budgetOf([...fighting(), ...hit.events]);
    expect(after?.budgets.caster?.action).toBe(false);
    expect(after?.budgets.caster?.attacksRemaining).toBeNull();
  });

  /** And the Action is gone whether or not the swing landed. */
  it('spends the Action and the casting on a miss', () => {
    const missed = must(swing(fighting(), {}, 1));
    expect(missed.attack?.hit).toBe(false);
    expect(missed.events.some((event) => event.type === 'spell-cast')).toBe(true);
    expect(budgetOf([...fighting(), ...missed.events])?.budgets.caster?.action).toBe(false);
  });

  it('refuses a second Action-priced swing in the same turn', () => {
    const first = must(swing(fighting()));
    const again = swing([...fighting(), ...first.events]);
    expect(isErr(again)).toBe(true);
    if (isErr(again)) expect(again.code).toBe('no_action');
  });
});

describe('what the swing refuses, before anything is spent', () => {
  const refusal = (result: Result<unknown>): string => {
    expect(isErr(result)).toBe(true);
    return isErr(result) ? result.code : 'not refused';
  };

  it('refuses a weapon the caster has no proficiency with', () => {
    expect(refusal(swing(table(), { weapon: 'greatsword' }))).toBe('not_proficient');
  });

  it('refuses an Unarmed Strike, which is no weapon to cast with', () => {
    expect(refusal(swing(table(), { weapon: null }))).toBe('no_weapon_for_the_casting');
  });

  it('refuses a cantrip the caster cannot cast', () => {
    // The same table with True Strike off the cantrip list: the door is right
    // and the caster has no route through it.
    const unlearned = table().map((event) =>
      event.type === 'spellcasting-declared'
        ? {
            ...event,
            spellcasting: declaredCasting({ ability: 'wis', cantrips: ['sacred-flame'] }),
          }
        : event,
    );
    expect(refusal(swing(unlearned))).toBe('spell_not_available');
  });

  it('refuses a spell that is not cast with a swing', () => {
    expect(refusal(swing(table(), { cantrip: { spellId: 'sacred-flame' } }))).toBe(
      'not_cast_with_a_swing',
    );
  });

  it('refuses a damage type the spell does not offer', () => {
    expect(
      refusal(swing(table(), { cantrip: { spellId: 'true-strike', damageType: 'fire' } })),
    ).toBe('bad_damage_type');
  });

  it('refuses a second price beside the casting’s Action', () => {
    expect(refusal(swing(fighting(), { free: true }))).toBe('cantrip_pays_for_the_swing');
    expect(refusal(swing(fighting(), { bonusAction: true, weapon: null }))).toBe(
      'cantrip_pays_for_the_swing',
    );
    expect(refusal(swing(fighting(), { lightAttack: 'bonus-action' }))).toBe(
      'cantrip_pays_for_the_swing',
    );
  });

  /**
   * A held swing settles its damage in a second command, off what the hold
   * wrote down — and the hold has nowhere to write a substituted ability or an
   * extra die, so a held cantrip swing would roll its damage with the Strength
   * the spell replaced.
   */
  it('refuses to hold the damage of a swing that is a casting', () => {
    expect(refusal(swing(table(), { hold: true }))).toBe('cantrip_swing_not_held');
  });

  /** And nothing was spent by any of them. */
  it('costs nothing when it refuses', () => {
    const log = fighting();
    const refused = swing(log, { weapon: 'greatsword' });
    expect(isErr(refused)).toBe(true);
    expect(state(log).combat?.budgets.caster?.action).toBe(true);
  });
});

/**
 * The other door, which is the wrong one: `resolveSpell` has no attack to make
 * and cannot invent one. An `err` rather than a `needsContext`, because
 * nothing is missing that a caller could supply — the door is simply not this
 * spell's.
 */
describe('a standalone casting is refused', () => {
  it('refuses to cast True Strike as an ordinary spell', () => {
    const cast = resolveSpell(
      fold('seed', table()),
      CASTER,
      { spellId: 'true-strike', targets: [CASTER] },
      supply(),
    );
    expect(isErr(cast)).toBe(true);
    if (isErr(cast)) expect(cast.code).toBe('cast_with_a_swing');
  });
});
