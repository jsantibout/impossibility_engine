import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { weaponNarrowingHolds } from './attack.js';
import { checkContent, extendContent, loadContent, type Content } from './content.js';
import { createRng, type Rng, type RngState } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { resolveAttack } from './commands.js';
import { createCharacter, type CharacterChoices } from './creation.js';
import type { FeatDefinition } from './origins.js';

/**
 * **A narrowing that names a kind of weapon rather than one item**, and the
 * feat that may carry one.
 *
 * `StandingGrant` could already say "made with *this* magic weapon"
 * (`onlyWithItem`), which names one object out of a pack and is keyed on the
 * granting item's id. What it could not say is the other narrowing the SRD
 * writes far more often — "with Ranged weapons", "a Melee weapon that you are
 * holding with two hands … Two-Handed or Versatile" — which is a *description*
 * of a weapon rather than a name of one.
 *
 * {@link WeaponNarrowing} is that clause, and rule 4 is why it is a
 * description: the engine must not learn that a Longbow is Ranged. Every
 * assertion below drives the match off the **weapon record** the swing
 * resolved, and the homebrew half proves the whole thing is vocabulary — a
 * fighting style nobody in this repository has heard of gets the same
 * arithmetic with no engine change.
 *
 * The other half is the reader: `FEAT_GRANT_KINDS` admits a grant kind only
 * once `creation.ts` reads it off a feat, and a feat is not a feature and goes
 * through none of the class-feature passes. `standing` joins that list here.
 */

const id = (s: string) => asCharacterId(s);
const ARCHER = id('archer');
const CLEAVER = id('cleaver');
const GOBLIN = id('goblin');
const ORC = id('orc');

/**
 * A homebrew fighting style narrowed by the weapon's **kind**, as the JSON a
 * DM's file would hold.
 *
 * SRD Archery's sentence in somebody else's words, which is the point: the
 * mechanism is a vocabulary, so a style the SRD never printed writes it.
 */
const HEDGE_MARKSMAN = JSON.stringify({
  id: 'hedge-marksman',
  name: 'Hedge Marksman',
  category: 'fighting-style',
  requires: { kind: 'none' },
  repeatable: false,
  note: 'Homebrew: +2 to attack rolls made with Ranged weapons.',
  grants: {
    kind: 'standing',
    reach: 'self',
    effects: [
      {
        kind: 'flat-bonus',
        applies: ['attack'],
        flat: 2,
        onlyWithWeapon: { weapons: [{ kind: 'ranged' }] },
      },
    ],
  },
});

/** And one narrowed by kind, property **and** how the weapon is being held. */
const HEDGE_CLEAVER = JSON.stringify({
  id: 'hedge-cleaver',
  name: 'Hedge Cleaver',
  category: 'fighting-style',
  requires: { kind: 'none' },
  repeatable: false,
  note: 'Homebrew: a 1 or a 2 on a damage die counts as a 3, two-handed only.',
  grants: {
    kind: 'standing',
    reach: 'self',
    effects: [
      {
        kind: 'attack-die-rule',
        rule: { kind: 'treat-low-rolls-as', atMost: 2, as: 3 },
        onlyWithWeapon: {
          weapons: [
            { kind: 'melee', properties: ['two-handed'] },
            { kind: 'melee', properties: ['versatile'] },
          ],
          heldInTwoHands: true,
        },
      },
    ],
  },
});

const feat = (text: string): FeatDefinition => JSON.parse(text) as FeatDefinition;

const content: Content = unwrap(
  extendContent(SRD_CONTENT, { feats: [feat(HEDGE_MARKSMAN), feat(HEDGE_CLEAVER)] }),
  'extend',
);

/** A Fighter 5 who took one homebrew style with their Fighting Style feature. */
const fighter = (featId: string): CharacterChoices => ({
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
    'fighter:ability-score-improvement': { featId: 'savage-attacker' },
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

/** One styled Fighter, a goblin in reach, and an orc across the clearing. */
const field = (who: CharacterId, featId: string): readonly GameEvent[] => [
  ...(unwrap(createCharacter(content, fighter(featId), who), 'create') as GameEvent[]),
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
    ],
    source: 'the quartermaster',
  },
  { type: 'scene-set', extent: { width: 600, depth: 600, height: 40 } },
  { type: 'landmark-added', name: 'the road', at: { x: 200, y: 200, z: 0 } },
  { type: 'creature-placed', id: who, placement: { from: { landmark: 'the road' }, feet: 0 } },
  { type: 'creature-placed', id: GOBLIN, placement: { from: { creature: who }, feet: 5, bearing: 0 } },
  { type: 'creature-placed', id: ORC, placement: { from: { creature: who }, feet: 40, bearing: 90 } },
];

/**
 * A scripted generator, so the faces a die shows are the test's and the
 * substitution is readable rather than hunted for across seeds.
 */
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
  content,
});

const swing = (
  log: readonly GameEvent[],
  who: CharacterId,
  command: { readonly target: CharacterId; readonly weapon: string; readonly twoHanded?: boolean },
  rng?: Rng,
) => {
  const out = unwrap(
    resolveAttack(fold('seed', log) as GameState, who, { ...command, free: true }, supply(rng)),
    'attack',
  );
  return { ...out, log: [...log, ...out.events] };
};

/** What the d20 the log records was told it was made of, by source. */
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

/** Every damage die the log wrote down, in the order it was thrown. */
const loggedDice = (events: readonly GameEvent[]): readonly LoggedDie[] => {
  const record = events.find((e) => e.type === 'damage-dice-recorded');
  if (record?.type !== 'damage-dice-recorded') throw new Error('no damage dice were recorded');
  return record.components.flatMap((slice) => slice.dice) as readonly LoggedDie[];
};

const weaponOf = (itemId: string) => SRD_CONTENT.item(itemId)?.weapon ?? null;

describe('the narrowing reads the weapon record, and never an id', () => {
  it('matches a record that fits and refuses one that does not', () => {
    const ranged = { weapons: [{ kind: 'ranged' as const }] };
    expect(weaponNarrowingHolds(ranged, { weapon: weaponOf('shortbow') })).toBe(true);
    expect(weaponNarrowingHolds(ranged, { weapon: weaponOf('longsword') })).toBe(false);
  });

  /**
   * SRD Great Weapon Fighting asks three things at once, and the third is not
   * a fact about the weapon at all: "a **Melee** weapon that you are
   * **holding with two hands** … must have the **Two-Handed or Versatile**
   * property". A Quarterstaff is Versatile, so it qualifies in two hands and
   * not in one; a Longsword in two hands qualifies for the same reason and a
   * Dagger never does.
   */
  it('asks the wielding as well as the record', () => {
    const style = {
      weapons: [
        { kind: 'melee' as const, properties: ['two-handed' as const] },
        { kind: 'melee' as const, properties: ['versatile' as const] },
      ],
      heldInTwoHands: true as const,
    };
    expect(weaponNarrowingHolds(style, { weapon: weaponOf('greatsword'), twoHanded: true })).toBe(true);
    expect(weaponNarrowingHolds(style, { weapon: weaponOf('quarterstaff'), twoHanded: true })).toBe(true);
    expect(weaponNarrowingHolds(style, { weapon: weaponOf('quarterstaff'), twoHanded: false })).toBe(false);
    expect(weaponNarrowingHolds(style, { weapon: weaponOf('dagger'), twoHanded: true })).toBe(false);
  });

  /**
   * An Unarmed Strike is `null` and is in no set of weapons, which is
   * `weaponInSet`'s own rule — a style that covered the fist would say so in a
   * second clause, as SRD Martial Arts does.
   */
  it('refuses an Unarmed Strike, which is not a weapon', () => {
    expect(weaponNarrowingHolds({ weapons: [{ kind: 'melee' }] }, { weapon: null })).toBe(false);
  });

  /** An empty narrowing asks nothing, which is `WeaponSelector`'s reading too. */
  it('asks nothing when it says nothing', () => {
    expect(weaponNarrowingHolds({}, { weapon: weaponOf('longsword') })).toBe(true);
  });
});

describe('a homebrew style narrowed by weapon kind, end to end', () => {
  const log = field(ARCHER, 'hedge-marksman');

  it('adds its two to a Ranged weapon attack, named in the contributions', () => {
    const out = swing(log, ARCHER, { target: ORC, weapon: 'shortbow' });
    expect(contributionsOf(out.events)['Hedge Marksman']).toBe(2);
  });

  it('adds nothing at all to a Melee one', () => {
    const out = swing(log, ARCHER, { target: GOBLIN, weapon: 'longsword' });
    expect(contributionsOf(out.events)['Hedge Marksman']).toBeUndefined();
  });

  /**
   * The bonus is *named* rather than folded into a total, which is what makes
   * a refusal and a grant tellable apart in the log at all.
   */
  it('keeps the contributions summing to the modifier', () => {
    const out = swing(log, ARCHER, { target: ORC, weapon: 'shortbow' });
    const total = Object.values(contributionsOf(out.events)).reduce((n, a) => n + a, 0);
    expect(total).toBe(out.attack!.roll.modifier);
  });
});

describe('a homebrew style that states a rule about the dice', () => {
  const log = field(CLEAVER, 'hedge-cleaver');

  /**
   * A Greatsword is 2d6: a 1 and a 2 both count as 3, and no extra die is
   * thrown, because the substitution replaces rather than rerolls. The faces
   * are read out of the **log**, where a die that counted as more than it
   * showed carries both numbers.
   */
  it('turns a 1 and a 2 into 3 on a two-handed swing, readably', () => {
    const out = swing(
      log,
      CLEAVER,
      { target: GOBLIN, weapon: 'greatsword', twoHanded: true },
      scripted([18, 1, 2]),
    );
    const dice = loggedDice(out.log);
    expect(dice.map((die) => die.rolled)).toEqual([1, 2]);
    expect(dice.map((die) => die.value)).toEqual([3, 3]);
    expect(dice).toHaveLength(2);
  });

  it('leaves a 4 alone', () => {
    const out = swing(
      log,
      CLEAVER,
      { target: GOBLIN, weapon: 'greatsword', twoHanded: true },
      scripted([18, 4, 4]),
    );
    expect(loggedDice(out.log).map((die) => die.value)).toEqual([4, 4]);
  });

  /** A Longsword in one hand is Versatile and is not being held in two. */
  it('does nothing for a weapon the narrowing does not reach', () => {
    const out = swing(
      log,
      CLEAVER,
      { target: GOBLIN, weapon: 'longsword' },
      scripted([18, 1]),
    );
    const dice = loggedDice(out.log);
    expect(dice.map((die) => die.rolled)).toEqual([1]);
    expect(dice.map((die) => die.value)).toEqual([1]);
  });

  /** And the same Longsword in two hands is exactly what the style names. */
  it('reaches the same weapon once it is held in two hands', () => {
    const out = swing(
      log,
      CLEAVER,
      { target: GOBLIN, weapon: 'longsword', twoHanded: true },
      scripted([18, 1]),
    );
    expect(loggedDice(out.log).map((die) => die.value)).toEqual([3]);
  });
});

describe('the untyped door takes the same declaration', () => {
  it('loads a narrowed style out of JSON text', () => {
    const loaded = loadContent({ feats: [JSON.parse(HEDGE_MARKSMAN), JSON.parse(HEDGE_CLEAVER)] });
    expect(loaded.ok).toBe(true);
  });

  const codesOf = (definition: unknown): readonly string[] =>
    checkContent({ feats: [definition as FeatDefinition] }).map(
      (problem) => `${problem.code} @ ${problem.field}`,
    );

  /**
   * A narrowing is about a roll somebody *makes with* a weapon. An Armour
   * Class is had rather than made, which is the argument `onlyWithItem`
   * already loses at this door.
   */
  it('refuses a weapon narrowing on a bonus no weapon is used to gain', () => {
    const style = JSON.parse(HEDGE_MARKSMAN) as {
      grants: { effects: { applies: string[] }[] };
    };
    style.grants.effects[0]!.applies = ['ac'];
    expect(codesOf(style)).toContain(
      'narrowing_without_a_roll @ feats[hedge-marksman].grants.effects[0].onlyWithWeapon',
    );
  });

  /** A selector no weapon could match covers less than it says, silently. */
  it('refuses a selector outside the sets the equipment tables print', () => {
    const style = JSON.parse(HEDGE_MARKSMAN) as {
      grants: { effects: { onlyWithWeapon: { weapons: unknown[] } }[] };
    };
    style.grants.effects[0]!.onlyWithWeapon.weapons = [{ kind: 'thrown' }];
    expect(codesOf(style)).toContain(
      'unknown_weapon_kind @ feats[hedge-marksman].grants.effects[0].onlyWithWeapon.weapons[0].kind',
    );
  });

  /**
   * The fields the class-feature pass resolves are all read off a **class
   * table** at that class's own level, and a feat has no table — so a feat
   * declaring one is refused rather than accepted and quietly ignored.
   */
  it('refuses a feat a class table would have to answer for', () => {
    const style = JSON.parse(HEDGE_MARKSMAN) as { grants: Record<string, unknown> };
    style.grants['diceCountByLevel'] = [1, 2, 3];
    expect(codesOf(style)).toContain(
      'feat_grant_not_read @ feats[hedge-marksman].grants.diceCountByLevel',
    );
  });

  /**
   * The refusal the item door makes with `ITEM_EFFECT_KINDS`, at the door
   * beside it. A kind nothing grants is compiled onto the sheet and matched by
   * no reader, which looks exactly like a benefit that never applies.
   */
  it('refuses a standing effect kind nothing grants', () => {
    const style = JSON.parse(HEDGE_MARKSMAN) as {
      grants: { effects: Record<string, unknown>[] };
    };
    style.grants.effects[0]!['kind'] = 'flat-bonuss';
    expect(codesOf(style)).toContain('bad_feat_grant @ feats[hedge-marksman].grants.effects[0]');
  });

  /**
   * And a gate nobody evaluates, which fails the *other* way: `requirementsHold`
   * does not know the clause, so the benefit would simply always apply.
   */
  it('refuses a requirement this engine does not evaluate', () => {
    const style = JSON.parse(HEDGE_MARKSMAN) as { grants: Record<string, unknown> };
    style.grants['requires'] = [{ kind: 'while-whistling' }];
    expect(codesOf(style)).toContain('bad_feat_grant @ feats[hedge-marksman].grants.requires[0]');
  });

  /** And the requirement that is read against an item's id, which a feat has not. */
  it('refuses a requirement only an item could be looked up by', () => {
    const style = JSON.parse(HEDGE_MARKSMAN) as { grants: Record<string, unknown> };
    style.grants['requires'] = [{ kind: 'while-worn' }];
    expect(codesOf(style)).toContain(
      'item_requirement_on_a_feature @ feats[hedge-marksman].grants.requires[0]',
    );
  });

  /** And the narrowing that is keyed on an item's id, which a feat is not. */
  it('refuses "made with this item" on a feat', () => {
    const style = JSON.parse(HEDGE_MARKSMAN) as {
      grants: { effects: Record<string, unknown>[] };
    };
    style.grants.effects[0]!['onlyWithItem'] = true;
    expect(codesOf(style)).toContain(
      'item_narrowing_on_a_feature @ feats[hedge-marksman].grants.effects[0].onlyWithItem',
    );
  });
});
