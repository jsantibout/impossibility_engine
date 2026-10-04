import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, type CharacterId, type Result } from '@ie/shared';
import { itemStandingEffects, type CatalogueItem } from './catalogue.js';
import type { CharacterSheet } from './character.js';
import { checkContent, extendContent } from './content.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { declaredCasting } from './spellcasting.js';
import { breathesWater } from './hazards.js';
import {
  addCreature,
  equipItem,
  resolveAttack,
  resolveMove,
  resolveSpell,
  transferItem,
  unequipItem,
} from './commands.js';
import { checkBonuses, defendingModes } from './commands/rolls.js';
import {
  hasSpeedInModeOn,
  rollModesFor,
  speedOf,
  standingAttackDamage,
  standingBonuses,
} from './standing.js';

/**
 * Treasure T-B1: the standing readers, each driven by the SRD items it finishes.
 *
 * Five things a worn item says and the engine could not hear:
 *
 * 1. **A Speed.** SRD Ring of Swimming: "You have a Swim Speed of 40 feet while
 *    wearing this ring." `speedOf` read the sheet alone.
 * 2. **What the target is.** SRD Dragon Slayer: "an extra 3d6 damage of the
 *    weapon's type if the target is a Dragon." `attack-damage` and `flat-bonus`
 *    tested the weapon and nothing about the creature it was swung at.
 * 3. **A critical taken back.** SRD Adamantine Armor: "any Critical Hit against
 *    you becomes a normal hit." A critical was decided by the die alone.
 * 4. **One skill.** SRD Gloves of Thievery: "a +5 bonus to Dexterity (Sleight
 *    of Hand) checks." `flat-bonus` reached the whole family.
 * 5. **Spell attacks against the holder.** SRD Spellguard Shield: "spell attack
 *    rolls have Disadvantage against you." The validator refused the relation.
 */

const id = (s: string) => asCharacterId(s);
const WIZARD = id('wizard');
const SQUIRE = id('squire');
const STRANGER = id('stranger');
const HORSE = id('horse');
const DRAKE = id('drake');
const GOLEM = id('golem');
const ORC = id('orc');
const MYSTERY = id('mystery');
const ZOMBIE = id('zombie');
const IMP = id('imp');
const OGRE = id('ogre');
const WITCH = id('witch');
const GOBLIN = id('goblin');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 5,
  abilities: { str: 16, dex: 14, con: 14, int: 16, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: null,
  weaponProficiencies: ['simple', 'martial'],
  ...over,
});

const added = (
  who: CharacterId,
  side: string,
  creatureType: string | undefined,
  over: Partial<CharacterSheet> = {},
): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(over),
  maxHp: 200,
  diesAtZero: false,
  ...(creatureType === undefined ? {} : { creatureType }),
  side,
});

const at = (who: CharacterId, from: CharacterId, feet: number, bearing = 0): GameEvent => ({
  type: 'creature-placed',
  id: who,
  placement: { from: { creature: from }, feet, bearing },
});

const TABLE: readonly GameEvent[] = [
  added(WIZARD, 'party', 'Humanoid'),
  added(SQUIRE, 'party', 'Humanoid'),
  added(STRANGER, 'party', 'Humanoid'),
  added(DRAKE, 'monsters', 'Dragon'),
  added(GOLEM, 'monsters', 'Construct'),
  added(ORC, 'monsters', 'Humanoid'),
  added(MYSTERY, 'monsters', undefined),
  added(ZOMBIE, 'monsters', 'Undead'),
  added(IMP, 'monsters', 'Fiend'),
  added(OGRE, 'monsters', 'Giant'),
  added(WITCH, 'coven', 'Humanoid', { spellcastingAbility: 'int' }),
  {
    type: 'spellcasting-declared',
    id: WITCH,
    spellcasting: declaredCasting({ ability: 'int', cantrips: ['fire-bolt'] }),
  },
  { type: 'scene-set', extent: { width: 600, depth: 600, height: 40 } },
  { type: 'landmark-added', name: 'the road', at: { x: 200, y: 200, z: 0 } },
  { type: 'creature-placed', id: WIZARD, placement: { from: { landmark: 'the road' }, feet: 0 } },
  at(SQUIRE, WIZARD, 5, 90),
  at(STRANGER, WIZARD, 30, 180),
  at(DRAKE, WIZARD, 5, 0),
  at(GOLEM, WIZARD, 5, 45),
  at(ORC, WIZARD, 5, 135),
  at(MYSTERY, WIZARD, 5, 225),
  at(ZOMBIE, WIZARD, 5, 270),
  at(IMP, WIZARD, 5, 315),
  at(OGRE, WIZARD, 10, 0),
  at(WITCH, WIZARD, 5, 200),
];

const supply = (seed = 'swing') => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

const run = (
  log: readonly GameEvent[],
  command: (s: GameState) => Result<GameEvent[]>,
): readonly GameEvent[] => [...log, ...unwrap(command(fold('seed', log)), 'command')];

/** A stat block into the game, through the door a DM uses. */
const arrive = (log: readonly GameEvent[], who: CharacterId, monster: string): readonly GameEvent[] => [
  ...log,
  ...unwrap(addCreature(fold('seed', log), SRD_CONTENT, who, monster), monster).events,
];

const item = (itemId: string): CatalogueItem => {
  const found = SRD_CONTENT.item(itemId);
  if (found === null) throw new Error(`${itemId} is not in the catalogue`);
  return found;
};

/** Hand it over through the door a DM uses. */
const gained = (log: readonly GameEvent[], who: CharacterId, itemId: string): readonly GameEvent[] => [
  ...log,
  { type: 'items-gained', id: who, items: [{ id: itemId, quantity: 1 }], source: 'the hoard' },
];

/** Put it on through the command, which pins what it grants. */
const worn = (log: readonly GameEvent[], who: CharacterId, itemId: string): readonly GameEvent[] =>
  run(gained(log, who, itemId), (s) => equipItem(s, SRD_CONTENT, who, itemId));

/**
 * And attuned, as the fold records it — the command's rest and its class
 * prerequisite are `attunement.test.ts`'s, and a Holy Avenger's "by a Paladin"
 * would otherwise need a whole Paladin built to ask what the aura does.
 */
const attuned = (log: readonly GameEvent[], who: CharacterId, itemId: string): readonly GameEvent[] => [
  ...log,
  { type: 'attuned', id: who, item: itemId, grants: itemStandingEffects(item(itemId)) },
];

const wornAndAttuned = (log: readonly GameEvent[], who: CharacterId, itemId: string) =>
  attuned(worn(log, who, itemId), who, itemId);

// — 1. a Speed a worn item grants ——————————————————————————————————————————————

describe('a Speed a worn item grants', () => {
  it('swims at 40 in the Ring of Swimming and walks as before', () => {
    const before = fold('seed', TABLE);
    expect(speedOf(before, WIZARD, 'swim')).toBe(0);
    expect(hasSpeedInModeOn(before, WIZARD, 'swim')).toBe(false);

    const ringed = fold('seed', worn(TABLE, WIZARD, 'ring-of-swimming'));
    expect(speedOf(ringed, WIZARD, 'swim')).toBe(40);
    expect(hasSpeedInModeOn(ringed, WIZARD, 'swim')).toBe(true);
    expect(speedOf(ringed, WIZARD)).toBe(30);
  });

  it('takes the Swim Speed away with the ring', () => {
    const off = run(worn(TABLE, WIZARD, 'ring-of-swimming'), (s) =>
      unequipItem(s, SRD_CONTENT, WIZARD, 'ring-of-swimming'),
    );
    expect(speedOf(fold('seed', off), WIZARD, 'swim')).toBe(0);
    expect(hasSpeedInModeOn(fold('seed', off), WIZARD, 'swim')).toBe(false);
  });

  /** "A Swim Speed of 40 feet" is a Speed, and Slow halves it once. */
  it('halves the ring’s Swim Speed for a Slowed wearer', () => {
    const slowed: readonly GameEvent[] = [
      ...worn(TABLE, WIZARD, 'ring-of-swimming'),
      {
        type: 'speed-modifier-granted',
        id: WIZARD,
        modifier: { source: 'Slow#cast:1', change: 'halve' },
      },
    ];
    expect(speedOf(fold('seed', slowed), WIZARD, 'swim')).toBe(20);
  });

  it('gives the manta cloak’s 60 feet only to a wearer attuned to it', () => {
    const cloaked = worn(TABLE, WIZARD, 'cloak-of-the-manta-ray');
    expect(speedOf(fold('seed', cloaked), WIZARD, 'swim')).toBe(0);
    expect(speedOf(fold('seed', attuned(cloaked, WIZARD, 'cloak-of-the-manta-ray')), WIZARD, 'swim')).toBe(60);
  });

  /**
   * "While wearing this cloak, you can breathe underwater" — M-HOLD. The one
   * rule that asks is SRD Whelm's "unless it can breathe water", so the cloak's
   * gills are a standing grant the same bracket withholds; and SRD Necklace of
   * Adaptation's "breathe normally in any environment" answers the same
   * question the same way.
   */
  it('lets the manta cloak’s and the adaptation necklace’s attuned wearer breathe water, and nobody else', () => {
    const cloaked = worn(TABLE, WIZARD, 'cloak-of-the-manta-ray');
    expect(breathesWater(fold('seed', TABLE), WIZARD)).toBe(false);
    expect(breathesWater(fold('seed', cloaked), WIZARD)).toBe(false);
    expect(breathesWater(fold('seed', attuned(cloaked, WIZARD, 'cloak-of-the-manta-ray')), WIZARD)).toBe(true);
    expect(breathesWater(fold('seed', wornAndAttuned(TABLE, WIZARD, 'necklace-of-adaptation')), WIZARD)).toBe(true);
  });

  /** Two Speeds in one mode are two Speeds, and the creature uses the higher. */
  it('keeps the higher of two Swim Speeds rather than their sum', () => {
    const both = wornAndAttuned(worn(TABLE, WIZARD, 'ring-of-swimming'), WIZARD, 'cloak-of-the-manta-ray');
    expect(speedOf(fold('seed', both), WIZARD, 'swim')).toBe(60);
  });

  it('matches the walking Speed in both modes the gloves name', () => {
    const gloved = fold('seed', wornAndAttuned(TABLE, WIZARD, 'gloves-of-swimming-and-climbing'));
    expect(speedOf(gloved, WIZARD, 'climb')).toBe(30);
    expect(speedOf(gloved, WIZARD, 'swim')).toBe(30);
    // Worn and not attuned, the bracket withholds both.
    const unattuned = fold('seed', worn(TABLE, WIZARD, 'gloves-of-swimming-and-climbing'));
    expect(speedOf(unattuned, WIZARD, 'climb')).toBe(0);
  });

  /**
   * SRD Slippers of Spider Climbing: "You have a Climb Speed equal to your
   * Speed. ... the slippers don't allow you to move this way on a slippery
   * surface". Back in the catalogue under rule 3's amendment (owner,
   * 2026-09-27): the limit is a flagged debt, and it can be, because the fact
   * it turns on is one every climb already asks the table for.
   */
  it('matches the walking Speed with the slippers, and still asks what is being climbed', () => {
    const slippered = wornAndAttuned(TABLE, WIZARD, 'slippers-of-spider-climbing');
    const state = fold('seed', slippered);
    expect(speedOf(state, WIZARD, 'climb')).toBe(30);
    expect(speedOf(state, WIZARD, 'swim')).toBe(0);
    // Worn and not attuned, the bracket withholds the climb.
    expect(speedOf(fold('seed', worn(TABLE, WIZARD, 'slippers-of-spider-climbing')), WIZARD, 'climb')).toBe(0);

    const climbed = unwrap(
      resolveMove(
        state,
        WIZARD,
        { placement: { from: { creature: WIZARD }, feet: 0, elevation: 10 }, mode: 'climb' },
        supply('climb'),
      ),
      'the climb',
    );
    // A Climb Speed: no surcharge.
    expect(climbed.cost).toBe(10);
    // And the surface is the table's to say, on this climb as on every one.
    expect(climbed.unverified.some((note) => note.includes(`nobody has said what ${WIZARD} is climbing`))).toBe(
      true,
    );
    expect(item('slippers-of-spider-climbing').unmodelled?.some((note) => note.includes('slippery surface'))).toBe(
      true,
    );
  });

  /**
   * A walking Speed added by something a **mount** wears, on a homebrew item
   * loaded through the door homebrew uses. The SRD's Horseshoes of Speed print
   * this sentence and stay out of the catalogue — "the hoof of a horse or
   * similar creature" is a wearer the equip door cannot tell from a character
   * — so what is proved here is the reader and the two doors a mount's gear
   * goes through: handed over by the rider, then put on the horse.
   */
  it('lets a horse wear a homebrew set of shoes and walk 30 feet faster', () => {
    const shoes: CatalogueItem = {
      id: 'homebrew-iron-shoes',
      name: 'Homebrew Iron Shoes',
      kind: 'wondrous',
      weightLb: null,
      costCp: null,
      armor: null,
      weapon: null,
      contents: [],
      grants: [
        { kind: 'standing', reach: 'self', effects: [{ kind: 'speed', feet: 30 }], requires: [{ kind: 'while-worn' }] },
      ],
    };
    const content = unwrap(extendContent(SRD_CONTENT, { items: [shoes] }), 'homebrew');

    const stabled = arrive(TABLE, HORSE, 'riding-horse');
    expect(speedOf(fold('seed', stabled), HORSE)).toBe(60);

    const handed = run(gained(stabled, WIZARD, shoes.id), (s) =>
      transferItem(s, WIZARD, HORSE, shoes.id, 1, 'shoeing'),
    );
    const shod = run(handed, (s) => equipItem(s, content, HORSE, shoes.id));
    expect(speedOf(fold('seed', shod), HORSE)).toBe(90);
  });
});

describe('the item door holds a Speed to what the reader reads', () => {
  const base: CatalogueItem = {
    id: 'homebrew-anklet',
    name: 'Homebrew Anklet',
    kind: 'wondrous',
    weightLb: null,
    costCp: null,
    armor: null,
    weapon: null,
    contents: [],
  };
  const codesOf = (effects: readonly unknown[], requires?: readonly unknown[]) =>
    checkContent({
      items: [
        {
          ...base,
          grants: [
            {
              kind: 'standing',
              reach: 'self',
              effects,
              ...(requires === undefined ? {} : { requires }),
            },
          ],
        } as unknown as CatalogueItem,
      ],
    }).map((problem) => problem.code);

  it('accepts a Speed given, matched and added', () => {
    expect(codesOf([{ kind: 'speed', change: 'at-least', mode: 'swim', feet: 40 }], [{ kind: 'while-worn' }])).toEqual([]);
    expect(codesOf([{ kind: 'speed', change: 'match-walk', mode: 'climb' }])).toEqual([]);
    expect(codesOf([{ kind: 'speed', feet: 30 }])).toEqual([]);
  });

  /**
   * The one pairing that asks the question of its own answer: `has-speed` is
   * answered by `speedOf`, and `speedOf` now reads this grant.
   */
  it('refuses a Speed that asks whether its wearer has a Speed', () => {
    expect(codesOf([{ kind: 'speed', feet: 10 }], [{ kind: 'has-speed' }])).toContain(
      'item_speed_asks_for_speed',
    );
  });

  /** `speedOf` reads the holder's own grants, so an aura would move its wearer alone. */
  it('refuses a Speed given in an aura', () => {
    const codes = checkContent({
      items: [
        {
          ...base,
          grants: [
            {
              kind: 'standing',
              reach: 'aura',
              auraFeet: 10,
              effects: [{ kind: 'speed', feet: 10 }],
            },
          ],
        } as unknown as CatalogueItem,
      ],
    }).map((problem) => problem.code);
    expect(codes).toContain('item_speed_in_an_aura');
    expect(codesOf([{ kind: 'speed', feet: 10 }])).not.toContain('item_speed_in_an_aura');
  });

  it('refuses a floor with no mode, no feet, or a change it cannot give', () => {
    expect(codesOf([{ kind: 'speed', change: 'at-least', feet: 40 }])).toContain('bad_speed_change');
    expect(codesOf([{ kind: 'speed', change: 'at-least', mode: 'fly', feet: 0 }])).toContain('bad_speed_change');
    expect(codesOf([{ kind: 'speed', change: 'halve' }])).toContain('bad_speed_change');
    expect(codesOf([{ kind: 'speed', change: 'at-least', mode: 'fly', feet: 30, hover: true }])).toContain(
      'bad_speed_change',
    );
  });
});

// — 2. a die for what the target is ———————————————————————————————————————————

const context = (weaponOf: string, target: CharacterId) => ({
  ability: 'str' as const,
  melee: true,
  weapon: item(weaponOf).weapon,
  withItem: weaponOf,
  mode: 'normal' as const,
  target,
  turn: null,
});

describe('a die for what the target is', () => {
  const slayer = fold('seed', worn(TABLE, WIZARD, 'dragon-slayer'));

  it('lands Dragon Slayer’s 3d6 on a Dragon and not on an orc', () => {
    expect(standingAttackDamage(slayer, WIZARD, context('dragon-slayer', DRAKE)).bonuses).toContainEqual({
      source: 'Dragon Slayer',
      dice: '3d6',
    });
    expect(
      standingAttackDamage(slayer, WIZARD, context('dragon-slayer', ORC)).bonuses.some(
        (bonus) => bonus.dice === '3d6',
      ),
    ).toBe(false);
  });

  it('reports a target nobody has typed rather than guessing', () => {
    const out = standingAttackDamage(slayer, WIZARD, context('dragon-slayer', MYSTERY));
    expect(out.bonuses.some((bonus) => bonus.dice === '3d6')).toBe(false);
    expect(out.unverified.some((line) => line.includes('Dragon Slayer') && line.includes('mystery'))).toBe(true);
  });

  /**
   * "If the target is a Dragon" is a magic weapon asking, so it reads the type
   * a magical effect sees — SRD Arcanist's Magic Aura's Mask fools it.
   */
  it('reads the type a magical effect sees, the Mask included', () => {
    const masked = fold('seed', [
      ...worn(TABLE, WIZARD, 'dragon-slayer'),
      {
        type: 'creature-type-masked',
        id: ORC,
        mask: { source: "Arcanist's Magic Aura#cast:1", creatureType: 'Dragon' },
      },
    ]);
    expect(standingAttackDamage(masked, WIZARD, context('dragon-slayer', ORC)).bonuses).toContainEqual({
      source: 'Dragon Slayer',
      dice: '3d6',
    });
  });

  it('lands Giant Slayer’s 2d6 of the weapon’s type on a Giant alone', () => {
    const state = fold('seed', worn(TABLE, WIZARD, 'giant-slayer'));
    expect(standingAttackDamage(state, WIZARD, context('giant-slayer', OGRE)).bonuses).toContainEqual({
      source: 'Giant Slayer',
      dice: '2d6',
    });
    expect(standingAttackDamage(state, WIZARD, context('giant-slayer', DRAKE)).bonuses.some((b) => b.dice === '2d6')).toBe(
      false,
    );
  });

  it('lands the Radiant of Holy Avenger and Mace of Disruption on a Fiend or an Undead', () => {
    for (const [weapon, dice] of [
      ['holy-avenger', '2d10'],
      ['mace-of-disruption', '2d6'],
    ] as const) {
      const state = fold('seed', wornAndAttuned(TABLE, WIZARD, weapon));
      for (const target of [ZOMBIE, IMP]) {
        expect(standingAttackDamage(state, WIZARD, context(weapon, target)).extra, `${weapon} ${target}`).toContainEqual({
          source: item(weapon).name,
          type: 'radiant',
          dice,
        });
      }
      expect(standingAttackDamage(state, WIZARD, context(weapon, ORC)).extra, weapon).toEqual([]);
    }
  });

  /** "The bonus increases to +3 when you use the weapon to attack a Construct." */
  it('swings the Mace of Smiting at +3 against a Construct and +1 against an orc', () => {
    const state = fold('seed', worn(TABLE, WIZARD, 'mace-of-smiting'));
    const mace = item('mace-of-smiting').weapon;
    const bonusAt = (target: CharacterId, applies: 'attack' | 'damage') =>
      standingBonuses(state, WIZARD, applies, { withItem: 'mace-of-smiting', weapon: mace, target });
    expect(bonusAt(GOLEM, 'attack')).toEqual([{ source: 'Mace of Smiting', flat: 3 }]);
    expect(bonusAt(GOLEM, 'damage')).toEqual([{ source: 'Mace of Smiting', flat: 3 }]);
    expect(bonusAt(ORC, 'attack')).toEqual([{ source: 'Mace of Smiting', flat: 1 }]);
    expect(bonusAt(MYSTERY, 'attack')).toEqual([{ source: 'Mace of Smiting', flat: 1 }]);
  });

  it('writes the +3 into the roll the log keeps, and reports an untyped target', () => {
    const armed = worn(TABLE, WIZARD, 'mace-of-smiting');
    const swingAt = (target: CharacterId) =>
      unwrap(
        resolveAttack(fold('seed', armed), WIZARD, { target, weapon: 'mace-of-smiting', free: true }, supply()),
        'attack',
      );
    const contributions = (events: readonly GameEvent[]) => {
      const record = events.find((e) => e.type === 'roll-recorded');
      if (record?.type !== 'roll-recorded') throw new Error('no roll');
      return Object.fromEntries(record.contributions.map((c) => [c.source, c.amount]));
    };
    expect(contributions(swingAt(GOLEM).events)['Mace of Smiting']).toBe(3);
    expect(contributions(swingAt(ORC).events)['Mace of Smiting']).toBe(1);
    const unknown = swingAt(MYSTERY);
    expect(contributions(unknown.events)['Mace of Smiting']).toBe(1);
    expect(unknown.unverified.some((line) => line.includes('Mace of Smiting') && line.includes('mystery'))).toBe(true);
    expect(swingAt(ORC).unverified.some((line) => line.includes('Mace of Smiting'))).toBe(false);
  });
});

describe('the validator holds a target narrowing to the book’s types and to a roll with a target', () => {
  const blade = (effect: Record<string, unknown>): CatalogueItem =>
    ({
      ...item('longsword-plus-1'),
      id: 'homebrew-bane',
      name: 'Homebrew Bane',
      grants: [{ kind: 'standing', reach: 'self', effects: [effect] }],
    }) as unknown as CatalogueItem;
  const codes = (effect: Record<string, unknown>) =>
    checkContent({ items: [blade(effect)] }).map((problem) => problem.code);

  it('accepts a narrowing to types the SRD prints', () => {
    expect(codes({ kind: 'attack-damage', dice: '1d6', onlyWithItem: true, targetTypes: ['Undead'] })).toEqual([]);
    expect(
      codes({ kind: 'flat-bonus', applies: ['attack', 'damage'], flat: 2, onlyWithItem: true, targetTypes: ['Beast'] }),
    ).toEqual([]);
  });

  /**
   * A bonus narrowed to the target and aimed at the **damage alone** is a
   * sentence the validator accepts, so it must not vanish from an untyped
   * target unreported: the swing tells the table what it went without.
   */
  it('reports a damage-only narrowing the swing went without', () => {
    const bane: CatalogueItem = {
      ...item('longsword-plus-1'),
      id: 'homebrew-bane',
      name: 'Homebrew Bane',
      grants: [
        {
          kind: 'standing',
          reach: 'self',
          effects: [{ kind: 'flat-bonus', applies: ['damage'], flat: 2, onlyWithItem: true, targetTypes: ['Undead'] }],
        },
      ],
    };
    const content = unwrap(extendContent(SRD_CONTENT, { items: [bane] }), 'homebrew');
    const armed = run(gained(TABLE, WIZARD, bane.id), (s) => equipItem(s, content, WIZARD, bane.id));
    const swingAt = (target: CharacterId) =>
      unwrap(
        resolveAttack(fold('seed', armed), WIZARD, { target, weapon: bane.id, free: true }, { ...supply(), content }),
        'attack',
      );
    const said = (target: CharacterId) =>
      swingAt(target).unverified.some((line) => line.includes('Homebrew Bane') && line.includes('Undead'));
    expect(said(MYSTERY)).toBe(true);
    expect(said(ZOMBIE)).toBe(false);
    expect(said(ORC)).toBe(false);
  });

  /**
   * And a bonus this swing could never have had is not reported: a charm whose
   * +2 against a Beast reaches only Ranged weapons says nothing about a sword.
   */
  it('reports nothing for a narrowing the weapon in hand could never meet', () => {
    const charm: CatalogueItem = {
      id: 'homebrew-hunters-charm',
      name: 'Homebrew Hunter Charm',
      kind: 'wondrous',
      weightLb: null,
      costCp: null,
      armor: null,
      weapon: null,
      contents: [],
      grants: [
        {
          kind: 'standing',
          reach: 'self',
          effects: [
            {
              kind: 'flat-bonus',
              applies: ['attack'],
              flat: 2,
              onlyWithWeapon: { weapons: [{ kind: 'ranged' }] },
              targetTypes: ['Beast'],
            },
          ],
          requires: [{ kind: 'while-worn' }],
        },
      ],
    };
    const content = unwrap(extendContent(SRD_CONTENT, { items: [charm] }), 'homebrew');
    const armed = run(
      run(gained(gained(TABLE, WIZARD, charm.id), WIZARD, 'longsword'), (s) => equipItem(s, content, WIZARD, charm.id)),
      (s) => equipItem(s, content, WIZARD, 'longsword'),
    );
    const out = unwrap(
      resolveAttack(fold('seed', armed), WIZARD, { target: MYSTERY, weapon: 'longsword', free: true }, { ...supply(), content }),
      'attack',
    );
    expect(out.unverified.some((line) => line.includes('Homebrew Hunter Charm'))).toBe(false);
  });

  it('refuses a subtype, an empty list, and a narrowing on a roll with no target', () => {
    expect(codes({ kind: 'attack-damage', dice: '1d6', targetTypes: ['Goblinoid'] })).toContain('bad_target_types');
    expect(codes({ kind: 'attack-damage', dice: '1d6', targetTypes: [] })).toContain('bad_target_types');
    expect(codes({ kind: 'flat-bonus', applies: ['ac'], flat: 1, targetTypes: ['Dragon'] })).toContain(
      'target_narrowing_without_a_target',
    );
  });

  it('refuses the same on a class feature', () => {
    const fighter = SRD_CONTENT.classes.find((definition) => definition.id === 'fighter')!;
    const problems = checkContent({
      classes: [
        {
          ...fighter,
          features: [
            {
              id: 'fighter:a-typed-die',
              name: 'A Typed Die',
              level: 1,
              automation: 'engine',
              note: 'Extra damage against a subtype, which is no type.',
              grants: {
                kind: 'standing',
                reach: 'self',
                effects: [{ kind: 'attack-damage', dice: '1d6', targetTypes: ['Goblinoid'] }],
              },
            },
          ],
        },
      ],
    });
    expect(problems.map((problem) => problem.code)).toContain('bad_target_types');
  });
});

// — 3. a critical that becomes a normal hit ———————————————————————————————————

describe('Adamantine Armor: a critical against the wearer is a normal hit', () => {
  const paralysed = (armour: string): readonly GameEvent[] => {
    const goblin = arrive(TABLE, GOBLIN, 'goblin-warrior');
    return [
      ...worn(goblin, WIZARD, armour),
      // The imp steps back to make room: every square beside the wizard is taken.
      { type: 'creature-moved', id: IMP, placement: { from: { creature: WIZARD }, feet: 40, bearing: 90 } },
      at(GOBLIN, WIZARD, 5, 315),
      // SRD Paralyzed: "Any attack roll that hits you is a Critical Hit if the
      // attacker is within 5 feet of you." Every hit is a critical to begin with.
      { type: 'condition-applied', id: WIZARD, condition: 'paralyzed', source: 'a spell' },
    ];
  };

  /** The goblin's printed Scimitar, which a stat block states and no weapon row does. */
  const scimitar = (armour: string, seed: string) =>
    unwrap(
      resolveAttack(fold('seed', paralysed(armour)), GOBLIN, { target: WIZARD, weapon: null, action: 'Scimitar', free: true }, supply(seed)),
      'scimitar',
    );

  const hittingSeed = (roll: (seed: string) => { attack?: { hit: boolean } | null }): string => {
    for (let n = 0; n < 60; n += 1) if (roll(`s${n}`).attack?.hit === true) return `s${n}`;
    throw new Error('no seed in sixty hits');
  };

  it('turns a monster’s critical into a hit that deals normal dice', () => {
    const seed = hittingSeed((s) => scimitar('plate-armor', s));
    const plain = scimitar('plate-armor', seed);
    const adamant = scimitar('adamantine-plate-armor', seed);

    expect(plain.attack!.critical).toBe(true);
    expect(adamant.attack!.hit).toBe(true);
    expect(adamant.attack!.critical).toBe(false);
    // Same seed, same die: the plate's critical doubled the dice and the
    // adamantine did not.
    expect(adamant.damage!).toBeLessThan(plain.damage!);
    expect(adamant.events.some((e) => 'critical' in e && (e as { critical?: boolean }).critical === true)).toBe(false);
  });

  it('turns a spell attack’s critical into a hit as well', () => {
    const bolt = (armour: string, seed: string) =>
      unwrap(
        resolveSpell(fold('seed', paralysed(armour)), WITCH, { spellId: 'fire-bolt', targets: [WIZARD] }, supply(seed)),
        'fire bolt',
      );
    const hits = (seed: string) =>
      bolt('plate-armor', seed).events.some((e) => e.type === 'roll-recorded' && e.outcome === 'hit');
    let seed: string | null = null;
    for (let n = 0; n < 60 && seed === null; n += 1) if (hits(`b${n}`)) seed = `b${n}`;
    if (seed === null) throw new Error('no seed in sixty bolts');

    const critical = (events: readonly GameEvent[]) =>
      events.some((e) => 'critical' in e && (e as { critical?: boolean }).critical === true);
    expect(critical(bolt('plate-armor', seed).events)).toBe(true);
    expect(critical(bolt('adamantine-plate-armor', seed).events)).toBe(false);
  });
});

// — 4. a flat bonus to one skill —————————————————————————————————————————————

describe('Gloves of Thievery: +5 to Sleight of Hand and to nothing else', () => {
  const gloved = fold('seed', worn(TABLE, WIZARD, 'gloves-of-thievery'));

  it('adds five to a Sleight of Hand check', () => {
    expect(checkBonuses(gloved, WIZARD, undefined, 'sleight-of-hand')).toContainEqual({
      source: 'Gloves of Thievery',
      flat: 5,
    });
  });

  it('adds nothing to Stealth, to a bare Dexterity check, or to Initiative', () => {
    expect(checkBonuses(gloved, WIZARD, undefined, 'stealth')).toEqual([]);
    expect(checkBonuses(gloved, WIZARD, undefined)).toEqual([]);
  });

  it('refuses a skill on anything but an ability check, and a skill the book does not print', () => {
    const gloves = item('gloves-of-thievery');
    const codes = (effect: Record<string, unknown>) =>
      checkContent({
        items: [
          { ...gloves, id: 'homebrew-gloves', grants: [{ kind: 'standing', reach: 'self', effects: [effect] }] } as unknown as CatalogueItem,
        ],
      }).map((problem) => problem.code);
    expect(codes({ kind: 'flat-bonus', applies: ['ability-check'], flat: 2, skill: 'stealth' })).toEqual([]);
    expect(codes({ kind: 'flat-bonus', applies: ['ability-check', 'save'], flat: 2, skill: 'stealth' })).toContain(
      'skill_narrowing_off_a_check',
    );
    expect(codes({ kind: 'flat-bonus', applies: ['ability-check'], flat: 2, skill: 'lockpicking' })).toContain(
      'bad_bonus_skill',
    );
  });
});

// — 5. spell attacks against the holder ——————————————————————————————————————

describe('Spellguard Shield', () => {
  const guarded = fold('seed', wornAndAttuned(TABLE, WIZARD, 'spellguard-shield'));

  it('gives a spell attack against its bearer Disadvantage and a sword swing none', () => {
    expect(defendingModes(guarded, WITCH, WIZARD, 'int', {}).modes).toContainEqual({
      source: 'Spellguard Shield',
      mode: 'disadvantage',
    });
    expect(
      defendingModes(guarded, ORC, WIZARD, 'str').modes.some((mode) => mode.source === 'Spellguard Shield'),
    ).toBe(false);
  });

  it('gives its bearer Advantage on a save a spell forced and not on any other', () => {
    const modes = (magical: boolean) =>
      rollModesFor(guarded, {
        family: 'saving-throw',
        roller: WIZARD,
        ability: 'dex',
        ...(magical ? { magical: true } : {}),
      }).modes;
    expect(modes(true)).toContainEqual({ source: 'Spellguard Shield', mode: 'advantage' });
    expect(modes(false).some((mode) => mode.source === 'Spellguard Shield')).toBe(false);
  });
});

// — the aura and the one content-only record ————————————————————————————————

describe('Holy Avenger’s Emanation', () => {
  const avenger = fold('seed', wornAndAttuned(TABLE, WIZARD, 'holy-avenger'));
  const saveModes = (who: CharacterId, magical: boolean) =>
    rollModesFor(avenger, {
      family: 'saving-throw',
      roller: who,
      ability: 'wis',
      ...(magical ? { magical: true } : {}),
    }).modes.filter((mode) => mode.source === 'Holy Avenger');

  it('gives an ally within 10 feet Advantage on a save a spell forced, and not on a trap’s', () => {
    expect(saveModes(SQUIRE, true)).toEqual([{ source: 'Holy Avenger', mode: 'advantage' }]);
    expect(saveModes(SQUIRE, false)).toEqual([]);
    expect(saveModes(WIZARD, true)).toEqual([{ source: 'Holy Avenger', mode: 'advantage' }]);
  });

  it('reaches nobody further than 10 feet and nobody on the other side', () => {
    expect(saveModes(STRANGER, true)).toEqual([]);
    expect(saveModes(ORC, true)).toEqual([]);
  });
});

describe('Luck Blade', () => {
  it('adds one to its attuned wielder’s saving throws and nothing before the attunement', () => {
    const held = worn(TABLE, WIZARD, 'luck-blade');
    expect(standingBonuses(fold('seed', held), WIZARD, 'save')).toEqual([]);
    expect(standingBonuses(fold('seed', attuned(held, WIZARD, 'luck-blade')), WIZARD, 'save')).toEqual([
      { source: 'Luck Blade', flat: 1 },
    ]);
  });
});
