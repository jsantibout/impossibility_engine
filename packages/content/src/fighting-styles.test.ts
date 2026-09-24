import { describe, expect, it } from 'vitest';
import { asCharacterId, expect as unwrap, type CharacterId } from '@ie/shared';
import {
  applyEvent,
  armorClassOf,
  createCharacter,
  createRng,
  createRollIssuer,
  equipItem,
  fold,
  resolveAttack,
  type CharacterChoices,
  type CharacterSheet,
  type GameEvent,
  type Rng,
  type RngState,
} from '@ie/engine';
import { SRD_CONTENT } from './index.js';
import { FIGHTING_STYLE_FEATS } from './origins.js';

/**
 * **The SRD's four Fighting Style feats, and which of them now does
 * something.**
 *
 * Every one of the four was a `FeatDefinition` with no grant at all —
 * arithmetic the catalogue described in a note and the engine never applied.
 * All four are declarations now, and what each of them wanted was different,
 * which is the finding this file records:
 *
 * | | SRD's own clause | What it needed |
 * |---|---|---|
 * | **Archery** | "+2 bonus to attack rolls you make with **Ranged weapons**" | a weapon narrowing |
 * | **Great Weapon Fighting** | "a **Melee** weapon that you are **holding with two hands** … **Two-Handed or Versatile**" | the same narrowing, and a rule about the dice |
 * | **Defense** | "While you're **wearing Light, Medium, or Heavy armor**" | a `StandingRequirement` about **armour**, which is a different clause entirely |
 * | **Two-Weapon Fighting** | "an extra attack as a result of using the **Light** property" | which Light weapon the turn had already swung |
 *
 * Defense was the last of them because an earlier note filed it under the
 * weapon clause and it was never one: `unarmored` and `not-wearing-heavy-armor`
 * are its opposites, and no member of the union said "wearing armour" until
 * `wearing-armor` was written beside them.
 */

const id = (s: string) => asCharacterId(s);
const SHOOTER = id('shooter');
const HEWER = id('hewer');
const WARDEN = id('warden');
const GOBLIN = id('goblin');
const ORC = id('orc');

const choices = (featId: string): CharacterChoices => ({
  name: 'Bren',
  classId: 'fighter',
  level: 5,
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
    'fighter:fighting-style': { featId },
    'fighter:ability-score-improvement': { featId: 'ability-score-improvement', abilities: ['str', 'str'] },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
});

const plain = (): CharacterSheet => ({
  level: 3,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: null,
});

const added = (who: CharacterId, side: string): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: plain(),
  maxHp: 60,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side,
});

const field = (who: CharacterId, featId: string): readonly GameEvent[] => [
  ...(unwrap(createCharacter(SRD_CONTENT, choices(featId), who), 'create') as GameEvent[]),
  { type: 'creature-side-declared', id: who, side: 'party' },
  added(GOBLIN, 'goblins'),
  added(ORC, 'goblins'),
  {
    type: 'items-gained',
    id: who,
    items: [
      { id: 'shortbow', quantity: 1 },
      { id: 'longsword', quantity: 1 },
      { id: 'greatsword', quantity: 1 },
      { id: 'arrow', quantity: 20 },
      // Owned rather than equipped, so it changes nothing until a test puts it
      // on: SRD Defense is about armour and a Shield is the thing beside it.
      { id: 'shield', quantity: 1 },
    ],
    source: 'the quartermaster',
  },
  { type: 'scene-set', extent: { width: 600, depth: 600, height: 40 } },
  { type: 'landmark-added', name: 'the road', at: { x: 200, y: 200, z: 0 } },
  { type: 'creature-placed', id: who, placement: { from: { landmark: 'the road' }, feet: 0 } },
  { type: 'creature-placed', id: GOBLIN, placement: { from: { creature: who }, feet: 5, bearing: 0 } },
  { type: 'creature-placed', id: ORC, placement: { from: { creature: who }, feet: 40, bearing: 90 } },
];

const scripted = (values: readonly number[]): Rng => {
  let i = 0;
  return {
    int: () => values[i++ % values.length]!,
    snapshot: (): RngState => [0, 0, 0, 0],
  };
};

const supply = (rng: Rng = createRng('swing') as Rng) => ({
  issuer: createRollIssuer('r'),
  rng,
  content: SRD_CONTENT,
});

const swing = (
  log: readonly GameEvent[],
  who: CharacterId,
  command: {
    readonly target: CharacterId;
    readonly weapon: string;
    readonly twoHanded?: boolean;
    readonly extraDamage?: readonly { readonly source: string; readonly type: string; readonly dice: string }[];
  },
  rng?: Rng,
) => {
  const out = unwrap(
    resolveAttack(fold('seed', log), who, { ...command, free: true }, supply(rng)),
    'attack',
  );
  return { ...out, log: [...log, ...out.events] };
};

const contributionsOf = (events: readonly GameEvent[]): Record<string, number> => {
  const record = events.find((e) => e.type === 'roll-recorded');
  if (record?.type !== 'roll-recorded') throw new Error('no roll was recorded');
  return Object.fromEntries(record.contributions.map((c) => [c.source, c.amount]));
};

interface LoggedDie {
  readonly rolled: number;
  readonly value: number;
  readonly cause: string | null;
}

const loggedDice = (events: readonly GameEvent[]): readonly LoggedDie[] => {
  const record = events.find((e) => e.type === 'damage-dice-recorded');
  if (record?.type !== 'damage-dice-recorded') throw new Error('no damage dice were recorded');
  return record.components.flatMap((slice) => slice.dice) as readonly LoggedDie[];
};

const styleOf = (featId: string) => FIGHTING_STYLE_FEATS.find((one) => one.id === featId);

describe('SRD Archery: "+2 bonus to attack rolls you make with Ranged weapons"', () => {
  const log = field(SHOOTER, 'archery');

  it('declares the bonus rather than describing it', () => {
    const grant = styleOf('archery')?.grants;
    expect(grant?.kind).toBe('standing');
    if (grant?.kind !== 'standing') throw new Error('unreachable');
    expect(grant.effects?.[0]).toMatchObject({
      kind: 'flat-bonus',
      applies: ['attack'],
      flat: 2,
      onlyWithWeapon: { weapons: [{ kind: 'ranged' }] },
    });
  });

  it('adds two to a Shortbow attack, named in the roll', () => {
    const out = swing(log, SHOOTER, { target: ORC, weapon: 'shortbow' });
    expect(contributionsOf(out.events)['Archery']).toBe(2);
  });

  it('adds nothing to a Longsword attack', () => {
    const out = swing(log, SHOOTER, { target: GOBLIN, weapon: 'longsword' });
    expect(contributionsOf(out.events)['Archery']).toBeUndefined();
  });

  /** Named rather than folded in: the pieces still account for the whole. */
  it('keeps the contributions summing to the modifier', () => {
    const out = swing(log, SHOOTER, { target: ORC, weapon: 'shortbow' });
    const total = Object.values(contributionsOf(out.events)).reduce((n, a) => n + a, 0);
    expect(total).toBe(out.attack!.roll.modifier);
  });
});

describe('SRD Great Weapon Fighting: "treat any 1 or 2 on a damage die as a 3"', () => {
  const log = field(HEWER, 'great-weapon-fighting');

  it('declares the rule and the weapons it is narrowed to', () => {
    const grant = styleOf('great-weapon-fighting')?.grants;
    expect(grant?.kind).toBe('standing');
    if (grant?.kind !== 'standing') throw new Error('unreachable');
    expect(grant.effects?.[0]).toMatchObject({
      kind: 'attack-die-rule',
      rule: { kind: 'treat-low-rolls-as', atMost: 2, as: 3 },
      onlyWithWeapon: { heldInTwoHands: true },
    });
  });

  /**
   * The load-bearing one: the substitution is **readable in the log**, which a
   * parallel track made possible for every damage roll. A die shows the 1 it
   * physically rolled and the 3 it counts as, side by side, so a narrator can
   * say a blow was better than the dice were without being told.
   *
   * The die's `cause` stays null and that is the dice layer's own reading
   * rather than a gap here: it names the effect that **produced or replaced** a
   * die, which is what a bonus die and a reroll do, and a substitution
   * produces no die at all. The two numbers are what a substitution leaves
   * behind, and both are in the log.
   */
  it('turns a 1 and a 2 into 3 on a Greatsword, and says so in the log', () => {
    const out = swing(
      log,
      HEWER,
      { target: GOBLIN, weapon: 'greatsword', twoHanded: true },
      scripted([18, 1, 2]),
    );
    const dice = loggedDice(out.log);
    expect(dice.map((die) => die.rolled)).toEqual([1, 2]);
    expect(dice.map((die) => die.value)).toEqual([3, 3]);
    // No die was added or thrown again: the 2024 wording substitutes.
    expect(dice).toHaveLength(2);
  });

  it('leaves a 4 alone', () => {
    const out = swing(
      log,
      HEWER,
      { target: GOBLIN, weapon: 'greatsword', twoHanded: true },
      scripted([18, 4, 4]),
    );
    expect(loggedDice(out.log).map((die) => die.value)).toEqual([4, 4]);
  });

  /**
   * "The weapon must have the Two-Handed or Versatile property to gain this
   * benefit", and a Longsword held in one hand is not being held in two.
   */
  it('does nothing for a weapon the sentence does not reach', () => {
    const out = swing(log, HEWER, { target: GOBLIN, weapon: 'longsword' }, scripted([18, 1]));
    const dice = loggedDice(out.log);
    expect(dice.map((die) => die.rolled)).toEqual([1]);
    expect(dice.map((die) => die.value)).toEqual([1]);
  });

  it('reaches the same Longsword once it is Versatile in two hands', () => {
    const out = swing(
      log,
      HEWER,
      { target: GOBLIN, weapon: 'longsword', twoHanded: true },
      scripted([18, 1]),
    );
    expect(loggedDice(out.log).map((die) => die.value)).toEqual([3]);
  });

  /**
   * **The scope, pinned where it now lives.**
   *
   * A die rule supplied at the attack's scope reaches every damage die the
   * swing throws, riders included, and that is the reading of the printed
   * sentence rather than an accident of the plumbing: SRD conditions the
   * benefit on "an attack you make with a Melee weapon that you are holding
   * with two hands" and says nothing whatever about where a die came from.
   * `attack.test.ts` pins the same answer one layer down, for a caller who
   * passes `damageEffects` by hand; this is the road that is new, where a
   * standing grant supplies it and nobody asked.
   *
   * It is written down because the other reading is arguable and a future
   * narrowing of `standingDamageEffects` to the weapon's own component would
   * otherwise pass every test in this file.
   */
  it('reaches a rider’s die on the same swing, because the sentence is about the attack', () => {
    const out = swing(
      log,
      HEWER,
      {
        target: GOBLIN,
        weapon: 'greatsword',
        twoHanded: true,
        extraDamage: [{ source: 'a rider', type: 'force', dice: '1d6' }],
      },
      // The d20, the Greatsword's 2d6, then the rider's d6.
      scripted([18, 1, 2, 1]),
    );
    const dice = loggedDice(out.log);
    expect(dice.map((die) => die.rolled)).toEqual([1, 2, 1]);
    expect(dice.map((die) => die.value)).toEqual([3, 3, 3]);
  });

  /** A style nobody took changes nothing, which is the control. */
  it('leaves an unstyled Fighter’s dice where they fell', () => {
    const plainLog = field(SHOOTER, 'archery');
    const out = swing(
      plainLog,
      SHOOTER,
      { target: GOBLIN, weapon: 'greatsword', twoHanded: true },
      scripted([18, 1, 2]),
    );
    expect(loggedDice(out.log).map((die) => die.value)).toEqual([1, 2]);
  });
});

/**
 * SRD Defense: "While you're wearing Light, Medium, or Heavy armor, you gain a
 * +1 bonus to Armor Class."
 *
 * The clause is about **armour**, not about a weapon, which is why this style
 * was the last of the four to be written: `unarmored` and
 * `not-wearing-heavy-armor` are its two opposites and neither could be negated
 * into it — a Barbarian in a chain shirt satisfies `not-wearing-heavy-armor`
 * and a Wizard in a robe satisfies both. `wearing-armor` is the third member
 * on the axis and it reads the same slot the other two read.
 */
describe('SRD Defense: "While you’re wearing Light, Medium, or Heavy armor"', () => {
  const armourClassWith = (featId: string, items: readonly string[]): number => {
    let state = fold('seed', field(WARDEN, featId));
    for (const item of items) {
      state = unwrap(equipItem(state, SRD_CONTENT, WARDEN, item), `equip ${item}`).reduce(
        applyEvent,
        state,
      );
    }
    return armorClassOf(state, WARDEN);
  };

  it('declares the bonus and the armour clause that gates it', () => {
    const grant = styleOf('defense')?.grants;
    expect(grant?.kind).toBe('standing');
    if (grant?.kind !== 'standing') throw new Error('unreachable');
    expect(grant.effects?.[0]).toEqual({ kind: 'flat-bonus', applies: ['ac'], flat: 1 });
    expect(grant.requires).toEqual([{ kind: 'wearing-armor' }]);
  });

  it('gives a Fighter in Chain Mail the point', () => {
    expect(armourClassWith('defense', ['chain-mail'])).toBe(
      armourClassWith('archery', ['chain-mail']) + 1,
    );
  });

  it('gives the same Fighter nothing wearing nothing', () => {
    expect(armourClassWith('defense', [])).toBe(armourClassWith('archery', []));
  });

  /**
   * A Shield is not armour, which is the half of the clause a requirement
   * written about "the sheet's two slots" would have got wrong: `unarmored`
   * asks about both slots because its own sentence names both, and Defense's
   * names one.
   */
  it('gives nothing for a Shield alone', () => {
    expect(armourClassWith('defense', ['shield'])).toBe(armourClassWith('archery', ['shield']));
  });

  /** And the armour and the Shield together is still one point, not two. */
  it('gives one point to armour worn behind a Shield', () => {
    expect(armourClassWith('defense', ['chain-mail', 'shield'])).toBe(
      armourClassWith('archery', ['chain-mail', 'shield']) + 1,
    );
  });

  it('says in its own note that it is applied', () => {
    const defense = styleOf('defense');
    expect(defense?.note).toContain('Applied');
    expect(defense?.note).not.toContain('is not applied');
  });
});

describe('the last one to stop being a note', () => {
  /**
   * And Two-Weapon Fighting has left this describe by building: its note used
   * to say "the engine does not model which hand an attack came from", and the
   * book never asks which hand. It asks which Light weapon this turn's Attack
   * action already swung, which is a fact about the turn, so the feat is a
   * standing grant that puts the ability modifier back on the extra attack the
   * property buys.
   */
  it('gives Two-Weapon Fighting the grant that puts the modifier back', () => {
    const two = styleOf('two-weapon-fighting');
    expect(two?.grants).toEqual({
      kind: 'standing',
      reach: 'self',
      effects: [{ kind: 'light-extra-attack-damage' }],
    });
    expect(two?.note).toContain('Applied');
    expect(two?.note).not.toContain('does not model which hand');
  });
});
