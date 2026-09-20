import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap, type CharacterId } from '@ie/shared';
import { checkContent, extendContent, parseClassDefinition } from './content.js';
import { restoreResourcesOn, tradeResource } from './commands.js';
import { createCharacter, type CharacterChoices } from './creation.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { remaining } from './resources.js';

/**
 * One resource spent to buy another.
 *
 * Every pool the engine had was spent on what its own feature does and nothing
 * converted, while the SRD writes the trade constantly — a spell slot for a
 * Bardic Inspiration, a Wild Shape use for a level 1 slot and back. The
 * `trade` grant is that conversion, and the class below is not either of the
 * SRD's writers: it is loaded from JSON text through the public door, it
 * trades in both directions with a different pool, and nothing in the engine
 * names it.
 *
 * What the two directions differ in is the whole reason a trade carries its
 * own limit and its own requirement rather than the feature carrying one:
 * SRD's two sentences are "Once on each of your turns, **if you have no uses
 * of Wild Shape left**" and "you can't do so again until you finish a Long
 * Rest", on one feature.
 */

const id = (s: string): CharacterId => asCharacterId(s);
const EBB = id('ebb');

const EBBWARDEN = {
  id: 'ebbwarden',
  name: 'Ebbwarden',
  primaryAbility: 'wis',
  hitDie: 8,
  saveProficiencies: ['wis', 'cha'],
  skillChoices: { choose: 2, from: ['athletics', 'arcana', 'survival', 'insight'] },
  weaponProficiencies: ['simple'],
  armorTraining: { light: true, medium: false, heavy: false, shields: false },
  subclassLevel: 3,
  table: Array.from({ length: 20 }, (_, index) => ({
    level: index + 1,
    proficiencyBonus: 2 + Math.floor(index / 4),
  })),
  startingEquipment: [{ option: 'A', items: [{ id: 'quarterstaff', quantity: 1 }], goldPieces: 5 }],
  multiclass: {
    weapons: ['simple'],
    armorTraining: { light: true, medium: false, heavy: false, shields: false },
    tools: [],
  },
  features: [
    {
      id: 'ebbwarden:tidepool',
      name: 'Tidepool',
      level: 1,
      automation: 'engine',
      note: 'Two uses, back on a Long Rest.',
      grants: {
        kind: 'pool',
        key: 'tide',
        label: 'Tidepool',
        usesByLevel: Array.from({ length: 20 }, () => 2),
        recovers: 'long-rest',
      },
    },
    {
      id: 'ebbwarden:ebb-and-flow',
      name: 'Ebb and Flow',
      level: 1,
      automation: 'engine',
      note: 'Once on each of your turns, if you have no uses of Tidepool left, you can give yourself one by expending a spell slot. In addition, you can expend one use of Tidepool to give yourself a level 1 spell slot, but you cannot do so again until you finish a Long Rest.',
      grants: {
        kind: 'trade',
        trades: [
          {
            id: 'slot-for-tide',
            action: 'none',
            spends: { kind: 'spell-slot' },
            gains: { kind: 'pool', key: 'tide', uses: 1 },
            limit: 'once-per-turn',
            onlyIfEmpty: 'tide',
          },
          {
            id: 'tide-for-slot',
            action: 'none',
            spends: { kind: 'pool', key: 'tide', uses: 1 },
            gains: { kind: 'spell-slot', level: 1 },
            limit: 'once-per-long-rest',
            pool: 'ebbwarden:ebb-and-flow',
            poolLabel: 'Ebb and Flow',
          },
        ],
      },
    },
  ],
};

const parsed = unwrap(parseClassDefinition(JSON.parse(JSON.stringify(EBBWARDEN))), 'parse');
const content = unwrap(extendContent(SRD_CONTENT, { classes: [parsed] }), 'extend');

const ebbwarden = (): CharacterChoices => ({
  name: 'Ilka',
  classId: 'ebbwarden',
  level: 1,
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 8, dex: 14, con: 13, int: 12, wis: 15, cha: 10 },
  },
  abilityIncreases: { con: 2, wis: 1 },
  classSkills: ['athletics', 'survival'],
  languages: ['Draconic', 'Elvish'],
  alignment: 'Neutral',
  cantrips: [],
  spellbook: [],
  preparedSpells: [],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: { 'human:skillful': ['perception'] },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int',
      cantrips: ['mage-hand', 'ray-of-frost'],
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId: 'skilled', proficiencies: ['stealth', 'nature', 'medicine'] },
  },
});

/**
 * The character, and the slots a DM declares for them.
 *
 * The class casts nothing — a trade is about pools rather than about
 * spellcasting — so the two level 1 slots arrive the way a monster's or a
 * homebrewed caster's do, through the declaration command's own event.
 */
const made = (): readonly GameEvent[] => [
  ...unwrap(createCharacter(content, ebbwarden(), EBB), 'create'),
  {
    type: 'resource-pool-declared',
    id: EBB,
    pool: { key: 'spell-slot:1', label: 'level 1 spell slot', max: 2, recovers: 'long-rest' },
  },
];

/** The character, plus whatever this scenario has already spent. */
const built = (spent: readonly GameEvent[] = []): GameState => fold('seed', [...made(), ...spent]);

const spend = (key: string, amount = 1): GameEvent => ({
  type: 'resource-spent',
  id: EBB,
  key,
  amount,
});

const trade = (state: GameState, name: string, over: Record<string, unknown> = {}) =>
  tradeResource(state, EBB, { feature: 'ebbwarden:ebb-and-flow', trade: name, ...over });

/**
 * The same character, in a fight — because "once on each of your turns" has no
 * referent where nobody is taking turns, which is the reading
 * `canUseFeatureThisTurn` takes for every other once-per-turn feature.
 */
const fighting = (spent: readonly GameEvent[] = []): GameState =>
  fold('seed', [
    ...made(),
    { type: 'scene-set', extent: { width: 300, depth: 300, height: 40 } },
    { type: 'landmark-added', name: 'here', at: { x: 100, y: 100, z: 0 } },
    { type: 'creature-placed', id: EBB, placement: { from: { landmark: 'here' }, feet: 0 } },
    { type: 'combat-started', combatants: [{ id: EBB, initiative: 20, speed: 30 }] },
    ...spent,
  ]);

describe('a resource traded for another', () => {
  it('is validated beside the printed classes and adds no problem', () => {
    expect(checkContent({ classes: [parsed] })).toEqual([]);
  });

  /** Both directions reach the sheet, each carrying its own limit. */
  it('compiles both trades onto the sheet', () => {
    expect((built().creatures[EBB]?.sheet.trades ?? []).map((one) => one.trade)).toEqual([
      'slot-for-tide',
      'tide-for-slot',
    ]);
  });

  /**
   * A pool use for a slot: one use goes, one spent slot comes back, and the
   * feature's own once-a-day pool is spent in the same batch.
   */
  it('spends a use and gives back a slot of the level the grant names', () => {
    const drained = [spend('spell-slot:1'), spend('spell-slot:1')];
    const state = built(drained);
    expect(remaining(state.creatures[EBB]!.resources, 'spell-slot:1')).toBe(0);

    const events = unwrap(trade(state, 'tide-for-slot'), 'trade');
    const now = built([...drained, ...events]);
    expect(remaining(now.creatures[EBB]!.resources, 'spell-slot:1')).toBe(1);
    expect(remaining(now.creatures[EBB]!.resources, 'tide')).toBe(1);
    // And the feature's once-per-Long-Rest limit is a pool of one, spent.
    expect(remaining(now.creatures[EBB]!.resources, 'ebbwarden:ebb-and-flow')).toBe(0);
  });

  /** "You can't do so again until you finish a Long Rest." */
  it('refuses a second trade before a Long Rest, and allows one after', () => {
    const drained = [spend('spell-slot:1'), spend('spell-slot:1')];
    const once = unwrap(trade(built(drained), 'tide-for-slot'), 'trade');
    const spent = [...drained, ...once];
    const again = trade(built(spent), 'tide-for-slot', { commandId: 'second' });
    expect(isErr(again) && again.code).toBe('exhausted');

    const rest = unwrap(restoreResourcesOn(built(spent), EBB, 'long-rest'), 'rest');
    // The slots came back with everything else, so one is spent again to
    // leave the trade something to give.
    const rested = [...spent, ...rest, spend('spell-slot:1')];
    expect(trade(built(rested), 'tide-for-slot', { commandId: 'third' }).ok).toBe(true);
  });

  /**
   * **Nothing to give back is a refusal, not a silent success** — the rule
   * `useRecovery` already follows. A slot the class table never printed is not
   * this engine's to mint, so a caster holding every slot they have is told so
   * rather than handed a tenth one.
   */
  it('refuses when the pool it would fill has nothing expended', () => {
    const refused = trade(built(), 'tide-for-slot');
    expect(isErr(refused) && refused.code).toBe('nothing_to_regain');
  });

  /** "If you have no uses of Tidepool left." */
  it('refuses the other direction while the pool it would fill has uses left', () => {
    const refused = trade(built(), 'slot-for-tide', { slotLevel: 1 });
    expect(isErr(refused) && refused.code).toBe('not_yet');
  });

  it('gives a use back for a slot once the pool is empty', () => {
    const empty = [spend('tide'), spend('tide')];
    const events = unwrap(trade(built(empty), 'slot-for-tide', { slotLevel: 1 }), 'trade');
    const now = built([...empty, ...events]);
    expect(remaining(now.creatures[EBB]!.resources, 'tide')).toBe(1);
    expect(remaining(now.creatures[EBB]!.resources, 'spell-slot:1')).toBe(1);
  });

  it('refuses a slot the caster has not got, and one they did not name', () => {
    const state = built([spend('tide'), spend('tide'), spend('spell-slot:1'), spend('spell-slot:1')]);
    const empty = trade(state, 'slot-for-tide', { slotLevel: 1 });
    expect(isErr(empty) && empty.code).toBe('exhausted');

    const unnamed = trade(built([spend('tide'), spend('tide')]), 'slot-for-tide');
    expect(isErr(unnamed) && unnamed.code).toBe('slot_level_required');
  });

  /**
   * "Once on each of your turns" — and the turn is the combat's own counter,
   * so a second trade on the same turn is refused however much the trade's own
   * condition still holds.
   */
  it('refuses a second trade on one turn, and lets the same one through outside a fight', () => {
    const empty = [spend('tide'), spend('tide')];
    const first = unwrap(trade(fighting(empty), 'slot-for-tide', { slotLevel: 1 }), 'trade');
    // The use it bought is spent again, so the trade's own condition is met
    // and the refusal can only be the turn's.
    const again = trade(fighting([...empty, ...first, spend('tide')]), 'slot-for-tide', {
      slotLevel: 1,
      commandId: 'second',
    });
    expect(isErr(again) && again.code).toBe('already_used_this_turn');

    // Outside a fight there are no turns for the limit to attach to — and
    // nothing is written to the turn's ledger either, which is what makes the
    // same pair of trades legal there.
    const outside = unwrap(trade(built(empty), 'slot-for-tide', { slotLevel: 1 }), 'trade');
    expect(outside.some((event) => event.type === 'feature-used')).toBe(false);
    const twice = trade(built([...empty, ...outside, spend('tide')]), 'slot-for-tide', {
      slotLevel: 1,
      commandId: 'second',
    });
    expect(twice.ok).toBe(true);
  });

  it('refuses a trade the holder has no feature for', () => {
    const refused = tradeResource(built(), EBB, { feature: 'ebbwarden:tidepool', trade: 'x' });
    expect(isErr(refused) && refused.code).toBe('no_such_feature');
  });

  /**
   * What a catalogue can write here that nothing downstream could recover
   * from: a slot gained with no level to gain it at, and a trade that spends
   * nothing.
   */
  it('refuses a gained slot with no level and a trade of no uses', () => {
    const codesOf = (mutate: (trades: Record<string, unknown>[]) => void): readonly string[] => {
      const written = JSON.parse(JSON.stringify(EBBWARDEN)) as typeof EBBWARDEN;
      const grants = written.features[1]?.grants as { trades: Record<string, unknown>[] };
      mutate(grants.trades);
      return checkContent({ classes: [written as never] }).map((problem) => problem.code);
    };
    expect(codesOf((trades) => (trades[1]!['gains'] = { kind: 'spell-slot' }))).toContain(
      'slot_without_a_level',
    );
    expect(
      codesOf((trades) => (trades[1]!['spends'] = { kind: 'pool', key: 'tide', uses: 0 })),
    ).toContain('bad_trade_amount');
    expect(codesOf((trades) => (trades[1]!['id'] = 'slot-for-tide'))).toContain('duplicate_trade');
  });
});
