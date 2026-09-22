import { describe, expect, it } from 'vitest';
import { SORCERY_POINTS, SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap, type CharacterId } from '@ie/shared';
import {
  createCharacter,
  fold,
  remaining,
  spellSlotKey,
  tradeResource,
  type CharacterChoices,
  type GameEvent,
  type GameState,
} from '@ie/engine';
import { repeatImprovements } from './advancement-slots.js';

/**
 * The two features whose whole content was a pool nothing could spend.
 *
 * SRD Font of Magic:
 *
 * > "**Converting Spell Slots to Sorcery Points.** You can expend a spell slot
 * > to gain a number of Sorcery Points equal to the slot's level (no action
 * > required).
 * >
 * > **Creating Spell Slots.** You can transform unexpended Sorcery Points into
 * > one spell slot as a Bonus Action. The Created Spell Slots table shows the
 * > cost of creating a spell slot of a given level … You can create a spell
 * > slot no higher than level 5."
 *
 * SRD Arcane Recovery:
 *
 * > "When you finish a Short Rest, you can choose expended spell slots to
 * > recover. The spell slots can have a combined level equal to no more than
 * > half your Wizard level (round up), and none of them can be level 6+. Once
 * > you use this feature, you can't do so again until you finish a Long Rest."
 *
 * Both buy **spell slots**, which is the half of a trade nothing could say: a
 * slot's key carries a level, so which one is bought is the caller's and the
 * price is read off a printed table or a printed budget rather than a flat
 * number.
 *
 * **The one thing neither of them decides here is minting.** `tradeResource`
 * gives back what was spent and refuses `nothing_to_regain` above a pool's
 * maximum, and that refusal is untouched: Arcane Recovery says "choose
 * **expended** spell slots" and never wanted it, and Font of Magic's create
 * is held to the same reading until the owner rules otherwise.
 */

const id = (s: string): CharacterId => asCharacterId(s);
const WHO = id('who');

const common = {
  speciesId: 'human',
  backgroundId: 'sage',
  languages: ['Dwarvish', 'Orc'],
  alignment: 'Neutral',
  backgroundEquipment: 'A' as const,
  classEquipment: 'A' as const,
  equipped: [],
  hitPoints: { method: 'fixed' as const },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int' as const,
      cantrips: ['mage-hand', 'light'],
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId: 'alert' },
  },
};

const sorcerer = (): CharacterChoices => ({
  ...common,
  name: 'Veska',
  classId: 'sorcerer',
  level: 5,
  subclassId: 'draconic-sorcery',
  abilities: {
    method: 'standard-array',
    assignment: { str: 8, dex: 14, con: 13, int: 12, wis: 10, cha: 15 },
  },
  abilityIncreases: { con: 2, int: 1 },
  classSkills: ['arcana', 'persuasion'],
  cantrips: ['fire-bolt', 'ray-of-frost', 'shocking-grasp', 'acid-splash', 'light'],
  spellbook: [],
  preparedSpells: [
    'burning-hands',
    'charm-person',
    'thunderwave',
    'hold-person',
    'shatter',
    'mind-spike',
    'fly',
    'sleep',
    'misty-step',
  ],
  featureChoices: {
    'human:skillful': ['perception'],
    'sorcerer:metamagic': ['Empowered Spell', 'Quickened Spell'],
  },
  feats: {
    ...common.feats,
    'sorcerer:ability-score-improvement': { featId: 'savage-attacker' },
    ...repeatImprovements('sorcerer', 5),
  },
});

const wizard = (): CharacterChoices => ({
  ...common,
  name: 'Ilbert',
  classId: 'wizard',
  level: 5,
  subclassId: 'evoker',
  abilities: {
    method: 'standard-array',
    assignment: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 },
  },
  abilityIncreases: { con: 2, wis: 1 },
  classSkills: ['arcana', 'history'],
  cantrips: ['fire-bolt', 'ray-of-frost', 'shocking-grasp', 'acid-splash'],
  spellbook: [
    'burning-hands',
    'charm-person',
    'thunderwave',
    'magic-missile',
    'shield',
    'sleep',
    'hold-person',
    'shatter',
    'misty-step',
    'invisibility',
    'fireball',
    'fly',
    'counterspell',
    'haste',
  ].map((spellId, index) => ({
    spellId,
    acquiredAt: index < 6 ? 1 : Math.ceil((index - 5) / 2) + 1,
    origin: 'level' as const,
  })),
  preparedSpells: [
    'burning-hands',
    'charm-person',
    'thunderwave',
    'magic-missile',
    'shield',
    'hold-person',
    'shatter',
    'fireball',
    'fly',
  ],
  featureChoices: {
    'human:skillful': ['perception'],
    'wizard:scholar': ['arcana'],
    'evoker:evocation-savant': ['chromatic-orb', 'scorching-ray'],
  },
  feats: {
    ...common.feats,
    'wizard:ability-score-improvement': { featId: 'savage-attacker' },
    ...repeatImprovements('wizard', 5),
  },
});

const made = (choices: CharacterChoices): readonly GameEvent[] => {
  const built = createCharacter(SRD_CONTENT, choices, WHO);
  if (!built.ok) throw new Error(`${choices.classId}: ${built.code} — ${built.reason}`);
  return built.value as GameEvent[];
};

const built = (choices: CharacterChoices, extra: readonly GameEvent[] = []): GameState =>
  fold('seed', [...made(choices), ...extra]);

const spend = (key: string, amount = 1): GameEvent => ({
  type: 'resource-spent',
  id: WHO,
  key,
  amount,
});

const left = (state: GameState, key: string): number =>
  remaining(state.creatures[WHO]!.resources, key);

describe('SRD Font of Magic: a slot for points, and points for a slot', () => {
  it('turns an expended spell slot into Sorcery Points equal to its level', () => {
    // Three points already spent, so there is something to give back: a trade
    // gives back what was expended and never mints above a maximum.
    const state = built(sorcerer(), [spend('sorcery-points', 3)]);
    expect(left(state, 'sorcery-points')).toBe(SORCERY_POINTS[4]! - 3);

    const done = unwrap(
      tradeResource(state, WHO, {
        feature: 'sorcerer:font-of-magic',
        trade: 'slot-for-points',
        slotLevel: 2,
      }),
      'slot for points',
    );
    const after = fold('seed', [...made(sorcerer()), spend('sorcery-points', 3), ...done]);

    // "A number of Sorcery Points equal to the slot's level": a level 2 slot
    // is two points.
    expect(left(after, 'sorcery-points')).toBe(SORCERY_POINTS[4]! - 1);
    expect(left(after, spellSlotKey(2))).toBe(2);
  });

  it('creates a spell slot at the Created Spell Slots table’s price', () => {
    // One level 1 slot spent, which is the one this buys back.
    const log = [...made(sorcerer()), spend(spellSlotKey(1), 1)];
    const state = fold('seed', log);
    expect(left(state, spellSlotKey(1))).toBe(3);

    const done = unwrap(
      tradeResource(state, WHO, {
        feature: 'sorcerer:font-of-magic',
        trade: 'points-for-slot',
        gainedSlotLevels: [1],
      }),
      'points for slot',
    );
    const after = fold('seed', [...log, ...done]);

    // SRD's table: a level 1 slot costs 2 Sorcery Points.
    expect(left(after, 'sorcery-points')).toBe(SORCERY_POINTS[4]! - 2);
    expect(left(after, spellSlotKey(1))).toBe(4);
  });

  it('refuses a slot it cannot afford, and spends nothing', () => {
    // A level 3 slot costs 5 points. Spend one and there are four.
    const log = [...made(sorcerer()), spend('sorcery-points', 1), spend(spellSlotKey(3), 1)];
    const refused = tradeResource(fold('seed', log), WHO, {
      feature: 'sorcerer:font-of-magic',
      trade: 'points-for-slot',
      gainedSlotLevels: [3],
    });
    expect(isErr(refused) && refused.code).toBe('exhausted');
  });

  it('refuses to mint a slot the class table did not print — the ruling still open', () => {
    const refused = tradeResource(built(sorcerer()), WHO, {
      feature: 'sorcerer:font-of-magic',
      trade: 'points-for-slot',
      gainedSlotLevels: [1],
    });
    expect(isErr(refused) && refused.code).toBe('nothing_to_regain');
  });

  it('creates one slot, and refuses a caller who named two', () => {
    const log = [...made(sorcerer()), spend(spellSlotKey(1), 2)];
    const refused = tradeResource(fold('seed', log), WHO, {
      feature: 'sorcerer:font-of-magic',
      trade: 'points-for-slot',
      gainedSlotLevels: [1, 1],
    });
    expect(isErr(refused) && refused.code).toBe('one_slot_only');
  });

  it('creates no slot above the table’s last row', () => {
    const refused = tradeResource(built(sorcerer()), WHO, {
      feature: 'sorcerer:font-of-magic',
      trade: 'points-for-slot',
      gainedSlotLevels: [6],
    });
    expect(isErr(refused) && refused.code).toBe('slot_level_too_high');
  });

  it('refuses a level the Sorcerer’s own table never reached', () => {
    const refused = tradeResource(built(sorcerer()), WHO, {
      feature: 'sorcerer:font-of-magic',
      trade: 'points-for-slot',
      gainedSlotLevels: [5],
    });
    expect(isErr(refused) && refused.code).toBe('unknown_pool');
  });
});

describe('SRD Arcane Recovery: slots the Wizard names, inside a level budget', () => {
  /** "When you finish a Short Rest" — the clock has not moved since it ended. */
  const RESTED: readonly GameEvent[] = [
    { type: 'rest-begun', id: WHO, kind: 'short' },
    { type: 'rest-ended', id: WHO, kind: 'short', benefit: 'short' },
  ];

  it('gives back the slots the caller names, up to half the Wizard level rounded up', () => {
    const log = [
      ...made(wizard()),
      spend(spellSlotKey(1), 2),
      spend(spellSlotKey(2), 1),
      ...RESTED,
    ];
    const state = fold('seed', log);
    expect(left(state, spellSlotKey(1))).toBe(2);
    expect(left(state, spellSlotKey(2))).toBe(2);

    const done = unwrap(
      tradeResource(state, WHO, {
        feature: 'wizard:arcane-recovery',
        trade: 'recover-slots',
        gainedSlotLevels: [1, 2],
      }),
      'arcane recovery',
    );
    const after = fold('seed', [...log, ...done]);

    // A level 5 Wizard recovers three combined levels: a level 1 and a level 2.
    expect(left(after, spellSlotKey(1))).toBe(3);
    expect(left(after, spellSlotKey(2))).toBe(3);
    expect(left(after, 'wizard:arcane-recovery')).toBe(0);
  });

  it('refuses to hand back more of a level than were expended, and keeps the use', () => {
    // One level 1 slot spent, two named: paying the day's single use in full
    // and being refunded in part is the quiet loss a refusal exists to stop.
    const log = [...made(wizard()), spend(spellSlotKey(1), 1), ...RESTED];
    const refused = tradeResource(fold('seed', log), WHO, {
      feature: 'wizard:arcane-recovery',
      trade: 'recover-slots',
      gainedSlotLevels: [1, 1],
    });
    expect(isErr(refused) && refused.code).toBe('nothing_to_regain');
  });

  it('recovers no slot of level 6 or higher', () => {
    const log = [...made(wizard()), ...RESTED];
    const refused = tradeResource(fold('seed', log), WHO, {
      feature: 'wizard:arcane-recovery',
      trade: 'recover-slots',
      gainedSlotLevels: [6],
    });
    expect(isErr(refused) && refused.code).toBe('slot_level_too_high');
  });

  it('refuses a combined level above the budget, and gives nothing back', () => {
    const log = [...made(wizard()), spend(spellSlotKey(2), 2), ...RESTED];
    const refused = tradeResource(fold('seed', log), WHO, {
      feature: 'wizard:arcane-recovery',
      trade: 'recover-slots',
      gainedSlotLevels: [2, 2],
    });
    expect(isErr(refused) && refused.code).toBe('over_budget');
  });

  it('happens when a Short Rest finishes and not otherwise', () => {
    const log = [...made(wizard()), spend(spellSlotKey(1), 1)];
    const refused = tradeResource(fold('seed', log), WHO, {
      feature: 'wizard:arcane-recovery',
      trade: 'recover-slots',
      gainedSlotLevels: [1],
    });
    expect(isErr(refused) && refused.code).toBe('not_the_moment');
  });

  it('is once a day: the second Short Rest finds the use gone', () => {
    const log = [
      ...made(wizard()),
      spend(spellSlotKey(1), 2),
      ...RESTED,
      spend('wizard:arcane-recovery', 1),
    ];
    const refused = tradeResource(fold('seed', log), WHO, {
      feature: 'wizard:arcane-recovery',
      trade: 'recover-slots',
      gainedSlotLevels: [1],
    });
    expect(isErr(refused) && refused.code).toBe('exhausted');
  });
});
