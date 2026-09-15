import { SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import { asCharacterId, expect as unwrap, type CharacterId } from '@ie/shared';
import type { Armor, Weapon } from '@ie/srd';
import { attackAbility, attackModifier, attackRollModes } from './attack.js';
import type { CatalogueItem } from './catalogue.js';
import { modifierFor, proficiencyBonus, type CharacterSheet } from './character.js';
import { extendContent, type Content } from './content.js';
import { createRng, type Rng } from './dice.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { equipItem, resolveSpell } from './commands.js';
import { createRollIssuer } from './rolls.js';
import { declaredCasting, type SpellcastingState } from './spellcasting.js';

/**
 * **"Spell attack modifier = your spellcasting ability modifier + your
 * Proficiency Bonus."** SRD 5.2.1, "Spells" → "Attack Rolls". That sentence is
 * the whole of the flat bonus, and every claim in this file is arithmetic off
 * it rather than off what the engine happens to sum.
 *
 * The bug it was written against: `weapon: null` meant two things to two
 * callers. For an Unarmed Strike it means "your Strength modifier plus your
 * Proficiency Bonus, and there is no unproficient version"; for a spell attack
 * the spell path used it to mean "not a weapon attack" and inherited the
 * Unarmed Strike's arithmetic on top of the spell attack modifier it had
 * already handed in as a flat bonus. A level 5 Wizard with Strength 16 rolled
 * at +13 where the book says +7.
 *
 * So the file proves the corrected number **and** the three neighbours a
 * careless correction breaks: the Unarmed Strike the sentinel was built for,
 * the weapon attack beside it, and the casting from an item that rides the
 * same path.
 */

const id = (s: string) => asCharacterId(s);
const CASTER = id('kessa');
const VICTIM = id('victim');

/**
 * A level 5 Wizard: Proficiency Bonus +3, Intelligence 18 (+4), so the book's
 * spell attack modifier is **+7**.
 *
 * Strength 16 is the point of the fixture rather than flavour. The bug added
 * the caster's Strength modifier and a second Proficiency Bonus, so a strong
 * caster was wrong by more — and a Strength of 10 would have hidden half of it.
 */
const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 5,
  abilities: { str: 16, dex: 14, con: 14, int: 18, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
  weaponProficiencies: ['simple'],
  ...over,
});

/** Heavy armour, for the one rule that reads which ability a roll involves. */
const PLATE: Armor = {
  id: 'test-plate',
  name: 'Test Plate',
  category: 'heavy',
  baseAc: 18,
  acBonus: null,
  addsDexModifier: false,
  maxDexBonus: null,
  strengthRequirement: null,
  stealthDisadvantage: false,
  weightLb: 65,
  cost: { amount: 1500, currency: 'gp' },
};

const modesOn = (modes: readonly { readonly mode: string }[]): string[] =>
  modes.map((m) => m.mode);

const PROFICIENCY = 3;
const INTELLIGENCE = 4;
const STRENGTH = 3;
/** The book's sentence, as arithmetic. */
const BY_THE_BOOK = INTELLIGENCE + PROFICIENCY;

const added = (who: CharacterId, over: Partial<CharacterSheet> = {}): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(over),
  maxHp: 200,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side: who === CASTER ? 'party' : 'foes',
});

const WIZARDLY: SpellcastingState = declaredCasting({
  ability: 'int',
  classId: 'wizard',
  cantrips: ['fire-bolt'],
  prepared: ['guiding-bolt'],
});

const scene = (casting: SpellcastingState = WIZARDLY): readonly GameEvent[] => [
  added(CASTER),
  added(VICTIM),
  { type: 'spellcasting-declared', id: CASTER, spellcasting: casting },
  { type: 'scene-set', extent: { width: 900, depth: 900, height: 60 } },
  { type: 'landmark-added', name: 'here', at: { x: 200, y: 200, z: 0 } },
  { type: 'creature-placed', id: CASTER, placement: { from: { landmark: 'here' }, feet: 0 } },
  { type: 'creature-placed', id: VICTIM, placement: { from: { creature: CASTER }, feet: 30, bearing: 0 } },
  { type: 'sight-declared', from: CASTER, to: VICTIM, seen: true },
  { type: 'sight-declared', from: VICTIM, to: CASTER, seen: true },
];

/** No bonus of the fixture's own, so the roll's total is die plus modifier. */
const supply = (seed = 'bolt', content: Content = SRD_CONTENT) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content,
});

const state = (log: readonly GameEvent[]): GameState => fold('seed', log);

/** What the d20 was rolled with: the total less the face that was rolled. */
const bonusOn = (
  log: readonly GameEvent[],
  request: Parameters<typeof resolveSpell>[2],
  seed = 'bolt',
  content: Content = SRD_CONTENT,
): number => {
  const out = unwrap(resolveSpell(state(log), CASTER, request, supply(seed, content)), 'the casting');
  const attack = out.outcomes[0]?.attack;
  expect(attack).toBeDefined();
  return attack!.total - attack!.roll.natural;
};

describe('a spell attack rolls at the spell attack modifier, and nothing else', () => {
  /**
   * The claim, end to end through the public API and over several seeds so it
   * is the modifier being asserted rather than one lucky die.
   */
  it.each(['bolt', 'ember', 'cinder', 'spark'])(
    'adds the spellcasting ability modifier and the Proficiency Bonus once each (%s)',
    (seed) => {
      expect(bonusOn(scene(), { spellId: 'fire-bolt', targets: [VICTIM] }, seed)).toBe(BY_THE_BOOK);
    },
  );

  /**
   * **The caster's Strength is not part of a spell attack.** Two casters
   * identical but for it roll at the same bonus — the assertion that fails
   * loudest under the bug, which added the Strength modifier outright.
   */
  it('gives the same bonus to a feeble caster as to a strong one', () => {
    const feeble = [
      added(CASTER, { abilities: { str: 6, dex: 14, con: 14, int: 18, wis: 10, cha: 10 } }),
      ...scene().slice(1),
    ];
    expect(bonusOn(feeble, { spellId: 'fire-bolt', targets: [VICTIM] })).toBe(BY_THE_BOOK);
  });

  /**
   * **The roll is made with the spellcasting ability, and says so.** SRD's
   * Attack Roll Abilities table gives a spell attack "Varies (the ability used
   * is determined by the spellcaster's spellcasting feature)" — which for this
   * wizard is Intelligence. Under the bug it reported Strength, because
   * `weapon: null` fell through to the Unarmed Strike's row.
   */
  it('is made with the spellcasting ability the caster casts with', () => {
    const out = unwrap(
      resolveSpell(state(scene()), CASTER, { spellId: 'fire-bolt', targets: [VICTIM] }, supply()),
      'Fire Bolt',
    );
    expect(out.outcomes[0]?.attack?.ability).toBe('int');
  });

  /**
   * And the ability is not decoration: SRD "Armor Training" hampers "any D20
   * Test that involves Strength or Dexterity", so armour the caster is
   * untrained in reaches their fist and not their Fire Bolt.
   *
   * (The same rule's other clause — that untrained armour stops you casting at
   * all — is not modelled; this is about which ability the roll involves.)
   */
  it('does not take the Strength penalty untrained armour puts on a fist', () => {
    const encumbered = sheet({
      armor: PLATE,
      armorTraining: { light: true, medium: true, heavy: false, shields: true },
    });
    expect(modesOn(attackRollModes(encumbered, { weapon: null, targetAc: 10 }))).toEqual([
      'disadvantage',
    ]);
    expect(
      modesOn(
        attackRollModes(encumbered, {
          weapon: null,
          targetAc: 10,
          spellAttack: { modifier: BY_THE_BOOK, ability: 'int' },
        }),
      ),
    ).toEqual([]);
  });

  /**
   * **A bonus the item printed involves no ability of the wielder's at all.**
   * SRD answers that wielder with a number — "+0 for the item, and the user's
   * Proficiency Bonus applies" — and names no ability, so nothing that reads
   * one may read the Strength the weaponless sentinel falls back to.
   */
  it('reads no ability where an item stated the bonus and the wielder has none', () => {
    const encumbered = sheet({
      spellcastingAbility: null,
      armor: PLATE,
      armorTraining: { light: true, medium: true, heavy: false, shields: true },
    });
    expect(
      modesOn(
        attackRollModes(encumbered, {
          weapon: null,
          targetAc: 10,
          spellAttack: { modifier: 9, ability: null },
        }),
      ),
    ).toEqual([]);
  });

  /**
   * **The log has to account for the number the die was rolled with.** The
   * `roll-recorded` event states one contribution — the spell attack modifier
   * — and it stated the book's number all along while the roll carried more.
   * That gap is the form this bug took in the record: an audit trail whose
   * stated contribution did not add up to its own total.
   *
   * The claim is this casting, not a general invariant of the event:
   * `recordD20Test` does not state flat attack bonuses or an exhaustion
   * penalty as contributions, so the two sides part company again wherever
   * there are any. Nothing here has either.
   */
  it('records contributions that sum to the total it rolled', () => {
    const out = unwrap(
      resolveSpell(state(scene()), CASTER, { spellId: 'fire-bolt', targets: [VICTIM] }, supply()),
      'Fire Bolt',
    );
    const recorded = out.events.find(
      (e) => e.type === 'roll-recorded' && e.label === 'Fire Bolt attack',
    );
    expect(recorded).toBeDefined();
    const event = recorded as Extract<GameEvent, { type: 'roll-recorded' }>;
    const stated = event.contributions.reduce((sum, c) => sum + c.amount, 0);
    expect(stated).toBe(BY_THE_BOOK);
    expect(event.total - event.natural).toBe(stated);
  });
});

describe('an Unarmed Strike is untouched', () => {
  /**
   * SRD Unarmed Strike: "Your bonus to the roll equals your Strength modifier
   * plus your Proficiency Bonus" — and there is no unproficient version, which
   * is what the `weapon: null` sentinel was built to say.
   */
  it('adds Strength and the Proficiency Bonus', () => {
    expect(attackModifier(sheet(), { weapon: null, targetAc: 10 })).toBe(STRENGTH + PROFICIENCY);
    expect(attackAbility(sheet(), { weapon: null, targetAc: 10 })).toBe('str');
  });

  it('stays proficient even where the caller says otherwise', () => {
    expect(attackModifier(sheet(), { weapon: null, targetAc: 10, proficient: false })).toBe(
      STRENGTH + PROFICIENCY,
    );
  });
});

describe('a weapon attack is untouched', () => {
  const weapon = (weaponId: string): Weapon => {
    const found = SRD_CONTENT.item(weaponId)?.weapon;
    if (found === undefined || found === null) throw new Error(`no weapon ${weaponId}`);
    return found;
  };

  it('adds Strength and the Proficiency Bonus for a simple melee weapon', () => {
    expect(attackModifier(sheet(), { weapon: weapon('club'), targetAc: 10 })).toBe(
      STRENGTH + PROFICIENCY,
    );
  });

  /** SRD Finesse: "you can use your Strength or Dexterity"; the better of the two. */
  it('takes the better ability on a Finesse weapon', () => {
    const nimble = sheet({ abilities: { str: 8, dex: 18, con: 14, int: 18, wis: 10, cha: 10 } });
    expect(attackAbility(nimble, { weapon: weapon('dagger'), targetAc: 10 })).toBe('dex');
    expect(attackModifier(nimble, { weapon: weapon('dagger'), targetAc: 10 })).toBe(4 + PROFICIENCY);
  });

  /** No Proficiency Bonus where there is no proficiency. */
  it('withholds the Proficiency Bonus from a weapon the attacker lacks', () => {
    expect(
      attackModifier(sheet(), { weapon: weapon('longsword'), targetAc: 10, proficient: false }),
    ).toBe(STRENGTH);
  });
});

describe('a casting from an item', () => {
  const WAND = 'wand-of-bolts';
  const PRINTED = 'wand-of-printed-bolts';

  const wand = (over: { readonly attackBonus?: number } = {}): CatalogueItem => ({
    id: over.attackBonus === undefined ? WAND : PRINTED,
    name: over.attackBonus === undefined ? 'Wand of Bolts' : 'Wand of Printed Bolts',
    kind: 'wand',
    weightLb: 1,
    costCp: null,
    armor: null,
    weapon: null,
    contents: [],
    grants: [
      {
        kind: 'pool',
        key: `${over.attackBonus === undefined ? WAND : PRINTED}:charges`,
        label: 'charges',
        uses: 7,
        recovers: 'dawn',
      },
      { kind: 'casts', spell: 'guiding-bolt', charges: 1, ...over },
    ],
  });

  const withWands: Content = unwrap(
    extendContent(SRD_CONTENT, { items: [wand(), wand({ attackBonus: 9 })] }),
    'the bolt wands',
  );

  const holding = (itemId: string): readonly GameEvent[] => {
    const base: readonly GameEvent[] = [
      ...scene(),
      {
        type: 'items-gained',
        id: CASTER,
        items: [{ id: itemId, quantity: 1 }],
        source: 'the hoard',
      },
    ];
    return [
      ...base,
      ...unwrap(equipItem(state(base), withWands, CASTER, itemId), 'equipping the wand'),
    ];
  };

  /**
   * SRD "Spells Cast from Items": what the item does not print falls to the
   * wielder — "using your spell save DC and spell attack bonus" — which is the
   * same sentence as above and therefore the same number.
   */
  it('rolls at the wielder’s own spell attack modifier where the item prints none', () => {
    expect(
      bonusOn(
        holding(WAND),
        { spellId: 'guiding-bolt', targets: [VICTIM], item: WAND },
        'wand',
        withWands,
      ),
    ).toBe(BY_THE_BOOK);
  });

  /** SRD Circlet of Blasting prints "(+5 to hit)": a printed bonus is the bonus. */
  it('rolls at the bonus the item printed, where it prints one', () => {
    expect(
      bonusOn(
        holding(PRINTED),
        { spellId: 'guiding-bolt', targets: [VICTIM], item: PRINTED },
        'wand',
        withWands,
      ),
    ).toBe(9);
  });
});

/** The arithmetic the fixture claims, so a changed sheet cannot go unnoticed. */
it('is built on the numbers it says it is', () => {
  expect(proficiencyBonus(sheet())).toBe(PROFICIENCY);
  expect(modifierFor(sheet(), 'int')).toBe(INTELLIGENCE);
  expect(modifierFor(sheet(), 'str')).toBe(STRENGTH);
});
