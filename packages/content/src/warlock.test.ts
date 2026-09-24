import { describe, expect, it } from 'vitest';
import { ELDRITCH_INVOCATIONS, FIEND_PATRON, SRD_CONTENT, WARLOCK, WIZARD } from '@ie/content';
import { classCasting, type SpellcastingState } from '@ie/engine';
import { asCharacterId, isErr, expect as unwrap } from '@ie/shared';
import { proficiencyBonusForLevel } from '@ie/engine';
import { fold, type GameEvent, type GameState } from '@ie/engine';
import { pactSlotKey, spellSlotKey } from '@ie/engine';
import { slotsAt } from '@ie/engine';
import { highestSlotLevel } from '@ie/engine';
import { createCharacter, planCharacter, type CharacterChoices } from '@ie/engine';

/**
 * Pact Magic: few slots, all at one level, back on a Short Rest.
 *
 * Two slots that come back every hour is a different resource from eight that
 * come back every day, and it is most of what makes a Warlock a Warlock. The
 * engine needed exactly one new field for it — `spellcasting.slotRecovery` —
 * because the slot table already stores counts per spell level, and "two level
 * 3 slots and nothing below" is `[0, 0, 2]`.
 *
 * That zeros-below representation is the load-bearing choice. A Warlock at
 * level 5 genuinely has no level 1 or 2 slots: their slots *become* level 3.
 * Every reader of the slot table already handles a zero, so nothing else had
 * to change.
 */

const id = (s: string) => asCharacterId(s);
const KAEL = id('kael');

const warlock = (over: Partial<CharacterChoices> = {}): CharacterChoices => ({
  name: 'Kael',
  classId: 'warlock',
  level: 5,
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 8, dex: 14, con: 13, int: 12, wis: 10, cha: 15 },
  },
  abilityIncreases: { con: 2, int: 1 },
  classSkills: ['arcana', 'deception'],
  languages: ['Draconic', 'Goblin'],
  alignment: 'Neutral Evil',
  subclassId: 'fiend-patron',
  cantrips: ['eldritch-blast', 'chill-touch', 'poison-spray'],
  spellbook: [],
  // A level 5 Warlock knows 6, from the Warlock list.
  preparedSpells: [
    'hex',
    'charm-person',
    'hold-person',
    'hypnotic-pattern',
    'mind-spike',
    'fear',
  ],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: ['leather-armor'],
  hitPoints: { method: 'fixed' },
  // The five the Invocations column asks a level 5 Warlock for. Each is one
  // that asks no second question, so a test about slots stays about slots;
  // `eldritch-invocations.test.ts` is where the invocations themselves are.
  featureChoices: {
    'human:skillful': ['perception'],
    'warlock:eldritch-invocations': [
      'Armor of Shadows',
      'Eldritch Mind',
      "Devil's Sight",
      'Fiendish Vigor',
      'Misty Visions',
    ],
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
    'warlock:ability-score-improvement': { featId: 'savage-attacker' },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
  ...over,
});

/** The warlock half of the sheet, which is the only half this class has. */
const casting = (plan: { spellcasting: SpellcastingState }) =>
  classCasting(plan.spellcasting, 'warlock')!;

const made = (over: Partial<CharacterChoices> = {}): GameEvent[] =>
  unwrap(createCharacter(SRD_CONTENT,warlock(over), KAEL), 'create');

const built = (over: Partial<CharacterChoices> = {}): GameState => fold('seed', made(over));

const rejects = (over: Partial<CharacterChoices>, code: string): void => {
  const result = planCharacter(SRD_CONTENT,warlock(over));
  expect(isErr(result)).toBe(true);
  if (isErr(result)) expect(result.code).toBe(code);
};

describe('the Warlock table agrees with the engine', () => {
  it('prints the Proficiency Bonus the formula gives', () => {
    for (const row of WARLOCK.table) {
      expect(row.proficiencyBonus).toBe(proficiencyBonusForLevel(row.level));
    }
  });

  it('runs from level 1 to 20 with no gaps', () => {
    expect(WARLOCK.table.map((r) => r.level)).toEqual(
      Array.from({ length: 20 }, (_, i) => i + 1),
    );
  });

  it('never loses an Eldritch Invocation as levels rise', () => {
    for (let i = 1; i < ELDRITCH_INVOCATIONS.length; i += 1) {
      expect(ELDRITCH_INVOCATIONS[i] ?? 0).toBeGreaterThanOrEqual(
        ELDRITCH_INVOCATIONS[i - 1] ?? 0,
      );
    }
    expect(ELDRITCH_INVOCATIONS[19]).toBe(10);
  });
});

describe('Pact Magic slots are few, high and level with the class', () => {
  /** SRD level 1: one slot, at level 1. */
  it('starts with a single level 1 slot', () => {
    expect(WARLOCK.table[0]?.spellSlots).toEqual([1]);
  });

  /**
   * SRD level 5: two slots, at **level 3** — and none at 1 or 2. A Warlock's
   * slots do not accumulate, they move up.
   */
  it('has no low slots once its slots have moved up', () => {
    const slots = slotsAt(WARLOCK, 5);
    // Not a pool of zero: no level 1 or 2 pool at all, so nothing can spend
    // one. `spellSlotTable` drops empty levels, which is what makes the
    // zeros-below representation safe.
    expect(slots[1]).toBeUndefined();
    expect(slots[2]).toBeUndefined();
    expect(slots[3]).toBe(2);
    expect(highestSlotLevel(slots)).toBe(3);
  });

  /** SRD: a Warlock's slots stop at level 5 and only the count grows after. */
  it('stops at level 5 slots and grows only in number', () => {
    expect(highestSlotLevel(slotsAt(WARLOCK, 20))).toBe(5);
    expect(highestSlotLevel(slotsAt(WIZARD, 20))).toBe(9);
    expect(slotsAt(WARLOCK, 9)[5]).toBe(2);
    expect(slotsAt(WARLOCK, 20)[5]).toBe(4);
    // And still only one pool, however many slots are in it.
    expect(Object.keys(slotsAt(WARLOCK, 20))).toEqual(['5']);
  });

  /** SRD Pact Magic: "when you finish a Short or Long Rest." */
  it('recharges its slots on a Short Rest, unlike every other caster', () => {
    expect(WARLOCK.spellcasting?.feature).toBe('pact-magic');
    expect(WIZARD.spellcasting?.feature).toBeUndefined();

    // And in its own pool: SRD keeps Pact Magic out of the Spellcasting table
    // entirely, so a Warlock's slots are never `spell-slot:` keys.
    const pools = built().creatures.kael!.resources.pools;
    expect(pools[pactSlotKey(3)]?.recovers).toBe('short-rest');
    expect(pools[spellSlotKey(3)]).toBeUndefined();
  });

  it('declares a Wizard’s slots on a Long Rest, as before', () => {
    const events = unwrap(
      createCharacter(
        SRD_CONTENT,
        {
          ...warlock(),
          classId: 'wizard',
          level: 3,
          subclassId: 'evoker',
          cantrips: ['fire-bolt', 'light', 'prestidigitation'],
          classSkills: ['investigation', 'insight'],
          spellbook: [
            'magic-missile',
            'shield',
            'detect-magic',
            'feather-fall',
            'mage-armor',
            'hold-person',
            'thunderwave',
            'charm-person',
            'misty-step',
            'web',
          ].map((spellId, index) => ({
            spellId,
            acquiredAt: index < 6 ? 1 : Math.ceil((index - 5) / 2) + 1,
            origin: 'level' as const,
          })),
          preparedSpells: ['magic-missile', 'shield', 'mage-armor', 'hold-person', 'burning-hands', 'scorching-ray'],
          equipped: [],
          featureChoices: {
            'human:skillful': ['perception'],
            'wizard:scholar': ['arcana'],
            'evoker:evocation-savant': ['burning-hands', 'scorching-ray'],
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
        },
        id('wren'),
      ),
      'wizard',
    );
    const pools = fold('seed', events).creatures.wren!.resources.pools;
    expect(pools[spellSlotKey(1)]?.recovers).toBe('long-rest');
  });
});

describe('a Warlock knows its spells, from the Warlock list', () => {
  it('is made with no spellbook and a known list', () => {
    const plan = unwrap(planCharacter(SRD_CONTENT,warlock()), 'plan');
    expect(casting(plan).ability).toBe('cha');
    expect(casting(plan).prepared).toContain('hex');
    expect(WARLOCK.spellcasting?.style).toBe('known');
  });

  it('refuses a spell that is not on the Warlock list', () => {
    rejects(
      {
        preparedSpells: [
          'cure-wounds',
          'charm-person',
          'hold-person',
          'hypnotic-pattern',
          'mind-spike',
          'fear',
        ],
      },
      'spell_not_on_class_list',
    );
  });

  /** SRD Fiend Spells: always prepared, over and above the class table. */
  it('always has its patron spells prepared', () => {
    const plan = unwrap(planCharacter(SRD_CONTENT,warlock()), 'plan');
    for (const spell of ['burning-hands', 'command', 'scorching-ray', 'suggestion']) {
      expect(casting(plan).prepared).toContain(spell);
    }
    expect(casting(plan).prepared).toHaveLength(10);
  });

  /**
   * Eldritch Blast is the Warlock cantrip, and it is executable — the only
   * class cantrip on this sheet the engine can actually resolve.
   */
  it('knows Eldritch Blast, which the engine can cast', () => {
    const plan = unwrap(planCharacter(SRD_CONTENT,warlock()), 'plan');
    expect(casting(plan).cantrips).toContain('eldritch-blast');
  });
});

/**
 * SRD Dark One's Blessing: "When you reduce an enemy to 0 Hit Points, you gain
 * Temporary Hit Points equal to your Charisma modifier plus your Warlock level
 * (minimum of 1 Temporary Hit Point). You also gain this benefit if someone
 * else reduces an enemy within 10 feet of you to 0 Hit Points."
 *
 * The catalogue's half of it: the grant the engine reads, and a note that says
 * what the scene answers. The engine's half — which enemy, whose enemy, and
 * both roads to 0 — is `at-zero-hit-points.test.ts`.
 */
describe("the Fiend's blessing is declared rather than left to a table", () => {
  const blessing = FIEND_PATRON.features.find(
    (feature) => feature.id === 'fiend-patron:dark-ones-blessing',
  )!;

  it('declares both sentences as one grant the engine executes', () => {
    expect(blessing.automation).toBe('engine');
    expect(blessing.grants).toEqual({
      kind: 'on-dropping-a-hostile',
      temporaryHitPoints: { ability: 'cha', plusClassLevel: true, minimum: 1 },
      within: 10,
    });
  });

  it('says what the scene answers and what the table answers', () => {
    expect(blessing.note).toContain('scene');
    expect(blessing.note).toContain('sides');
  });

  it('reaches the sheet at the Warlock’s own class level', () => {
    const state = built();
    expect(state.creatures[KAEL]!.sheet.onDroppingAHostile).toEqual([
      {
        feature: 'fiend-patron:dark-ones-blessing',
        name: "Dark One's Blessing",
        ability: 'cha',
        classLevel: 5,
        minimum: 1,
        within: 10,
      },
    ]);
  });
});

describe('a Warlock is a creature the rest of the engine accepts', () => {
  it('explains every feature it does not execute', () => {
    for (const feature of [...WARLOCK.features, ...FIEND_PATRON.features]) {
      expect(feature.note.length).toBeGreaterThan(20);
    }
  });

  it('has hit points from a d8', () => {
    const plan = unwrap(planCharacter(SRD_CONTENT,warlock()), 'plan');
    // Level 5, d8, Constitution 15 (+2): 8 + 4×5 + 5×2 = 38.
    expect(plan.hitPointMaximum).toBe(38);
  });

  it('folds, survives JSON, and replays prefix by prefix', () => {
    const log = made();
    const state = fold('seed', log);
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
    for (let n = 0; n <= log.length; n += 1) {
      expect(fold('seed', log.slice(0, n))).toEqual(fold('seed', log.slice(0, n)));
    }
  });
});
