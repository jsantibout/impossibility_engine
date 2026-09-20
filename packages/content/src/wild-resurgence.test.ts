import { describe, expect, it } from 'vitest';
import { SRD_CONTENT, WILD_SHAPE_USES } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap, type CharacterId } from '@ie/shared';
import { createCharacter, type CharacterChoices } from '@ie/engine';
import { fold, remaining, tradeResource, type GameEvent, type GameState } from '@ie/engine';

/**
 * SRD Wild Resurgence, the Druid's level 5 feature:
 *
 * > "Once on each of your turns, if you have no uses of Wild Shape left, you
 * > can give yourself one use by expending a spell slot (no action required).
 * >
 * > In addition, you can expend one use of Wild Shape (no action required) to
 * > give yourself a level 1 spell slot, but you can't do so again until you
 * > finish a Long Rest."
 *
 * Two sentences, two limits, two conditions, one feature — which is why a
 * trade carries its limit rather than the feature carrying one. The numbers
 * asserted are a level 5 Druid's own: two Wild Shape uses off the class table,
 * four level 1 slots off the slot table, and one use of the daily half.
 */

const id = (s: string): CharacterId => asCharacterId(s);
const FENN = id('fenn');

const druid = (): CharacterChoices => ({
  name: 'Fenn',
  classId: 'druid',
  level: 5,
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 10, dex: 13, con: 14, int: 8, wis: 15, cha: 12 },
  },
  abilityIncreases: { con: 2, wis: 1 },
  classSkills: ['nature', 'survival'],
  languages: ['Dwarvish', 'Orc'],
  alignment: 'Neutral',
  subclassId: 'circle-of-the-land',
  cantrips: ['poison-spray', 'guidance', 'druidcraft'],
  spellbook: [],
  preparedSpells: [
    'cure-wounds',
    'charm-person',
    'thunderwave',
    'animal-friendship',
    'healing-word',
    'hold-person',
    'lesser-restoration',
    'call-lightning',
    'sleet-storm',
  ],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: {
    'human:skillful': ['perception'],
    'druid:primal-order': ['Magician'],
    'druid:ability-score-improvement': [],
  },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int' as const,
      cantrips: ['mage-hand', 'light'],
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId: 'alert' },
    'druid:ability-score-improvement': {
      featId: 'ability-score-improvement',
      abilities: ['wis', 'wis'],
    },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
});

const made = (): readonly GameEvent[] => unwrap(createCharacter(SRD_CONTENT, druid(), FENN), 'create');

const built = (spent: readonly GameEvent[] = []): GameState => fold('seed', [...made(), ...spent]);

const spend = (key: string, amount = 1): GameEvent => ({
  type: 'resource-spent',
  id: FENN,
  key,
  amount,
});

const trade = (state: GameState, name: string, over: Record<string, unknown> = {}) =>
  tradeResource(state, FENN, { feature: 'druid:wild-resurgence', trade: name, ...over });

const left = (state: GameState, key: string): number =>
  remaining(state.creatures[FENN]!.resources, key);

describe('Wild Resurgence', () => {
  /** A level 5 Druid: two Wild Shape uses, four level 1 slots, one daily trade. */
  it('starts with the class table’s own numbers', () => {
    const state = built();
    expect(left(state, 'wild-shape')).toBe(WILD_SHAPE_USES[4]);
    expect(left(state, 'wild-shape')).toBe(2);
    expect(left(state, 'spell-slot:1')).toBe(4);
    expect(left(state, 'druid:wild-resurgence')).toBe(1);
  });

  /** "You can expend one use of Wild Shape to give yourself a level 1 spell slot." */
  it('turns a Wild Shape use into a level 1 slot, once a day', () => {
    const drained = [spend('spell-slot:1', 4)];
    const events = unwrap(trade(built(drained), 'wild-shape-for-slot'), 'trade');
    const now = built([...drained, ...events]);
    expect(left(now, 'spell-slot:1')).toBe(1);
    expect(left(now, 'wild-shape')).toBe(1);
    expect(left(now, 'druid:wild-resurgence')).toBe(0);

    const again = trade(now, 'wild-shape-for-slot', { commandId: 'second' });
    expect(isErr(again) && again.code).toBe('exhausted');
  });

  /** "If you have no uses of Wild Shape left ... by expending a spell slot." */
  it('turns a slot into a Wild Shape use only once they are all gone', () => {
    const tooSoon = trade(built([spend('wild-shape')]), 'slot-for-wild-shape', { slotLevel: 1 });
    expect(isErr(tooSoon) && tooSoon.code).toBe('not_yet');

    const empty = [spend('wild-shape', 2)];
    const events = unwrap(trade(built(empty), 'slot-for-wild-shape', { slotLevel: 2 }), 'trade');
    const now = built([...empty, ...events]);
    expect(left(now, 'wild-shape')).toBe(1);
    // The slot the caster named, and no other: the level is theirs to choose.
    expect(left(now, 'spell-slot:2')).toBe(2);
    expect(left(now, 'spell-slot:1')).toBe(4);
  });

  /**
   * And the sentence this engine has nowhere to put, refused rather than
   * guessed: a trade gives back what was spent.
   */
  it('refuses to mint a slot for a Druid who has spent none', () => {
    const refused = trade(built(), 'wild-shape-for-slot');
    expect(isErr(refused) && refused.code).toBe('nothing_to_regain');
  });
});
