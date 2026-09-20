import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap, type CharacterId } from '@ie/shared';
import {
  checkContent,
  createCharacter,
  fold,
  remaining,
  tradeResource,
  type CharacterChoices,
  type GameEvent,
  type GameState,
} from '@ie/engine';
import { repeatImprovements } from './advancement-slots.js';

/**
 * The three trades the SRD prints with no limit on them at all.
 *
 * `ResourceTradeGrant.limit` was closed over Wild Resurgence's two clauses —
 * "Once on each of your turns" and "you can't do so again until you finish a
 * Long Rest" — and its own declaration named the three features that wanted
 * the member it did not have:
 *
 * | SRD | The trade |
 * |---|---|
 * | Bard, Font of Inspiration | "you can expend a spell slot (no action required) to regain one expended use of Bardic Inspiration" |
 * | Sorcerer, Sorcery Incarnate | "you can expend 2 Sorcery Points to give yourself one use of Innate Sorcery" |
 * | Paladin, Holy Nimbus | "you can expend a level 5 spell slot to restore your use of it" |
 *
 * So what each of them is held to here is the *absence* of a limit, which is
 * the one thing a closed pair could not say: spent twice inside one turn, and
 * spent twice with no rest in between. The fourth test is the other direction
 * — a trade the book *does* limit is still refused on its second use in a
 * turn — because a widened union whose old members stopped biting would pass
 * the first three tests and break the feature they were written from.
 */

const id = (s: string): CharacterId => asCharacterId(s);
const WHO = id('who');

const common = {
  speciesId: 'human',
  backgroundId: 'sage',
  languages: ['Dwarvish', 'Orc'],
  alignment: 'Neutral',
  spellbook: [],
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

const made = (choices: CharacterChoices): readonly GameEvent[] => {
  const built = createCharacter(SRD_CONTENT, choices, WHO);
  if (!built.ok) throw new Error(`${choices.classId}: ${built.code} — ${built.reason}`);
  return built.value as GameEvent[];
};

const built = (choices: CharacterChoices, extra: readonly GameEvent[] = []): GameState =>
  fold('seed', [...made(choices), ...extra]);

/** A turn of this creature's own, which is what "once on each of your turns" needs. */
const FIGHTING: GameEvent = {
  type: 'combat-started',
  combatants: [{ id: WHO, initiative: 20, speed: 30 }],
};

const spend = (key: string, amount = 1): GameEvent => ({
  type: 'resource-spent',
  id: WHO,
  key,
  amount,
});

const left = (state: GameState, key: string): number =>
  remaining(state.creatures[WHO]!.resources, key);

/**
 * A Bard at the level Font of Inspiration arrives, with a Charisma that buys
 * three uses of the die it trades for.
 */
const bard = (): CharacterChoices => ({
  ...common,
  name: 'Ilva',
  classId: 'bard',
  level: 5,
  abilities: {
    method: 'manual',
    assignment: { str: 8, dex: 14, con: 13, int: 10, wis: 12, cha: 17 },
  },
  abilityIncreases: { con: 2, int: 1 },
  classSkills: ['performance', 'stealth', 'deception'],
  subclassId: 'college-of-lore',
  cantrips: ['vicious-mockery', 'dancing-lights', 'light'],
  preparedSpells: [
    'bane',
    'charm-person',
    'dissonant-whispers',
    'heroism',
    'healing-word',
    'hold-person',
    'invisibility',
    'fear',
    'hypnotic-pattern',
  ],
  featureChoices: {
    'human:skillful': ['perception'],
    'bard:expertise': ['performance', 'stealth'],
    'college-of-lore:bonus-proficiencies': ['acrobatics', 'athletics', 'insight'],
  },
  feats: {
    ...common.feats,
    'bard:ability-score-improvement': { featId: 'savage-attacker' },
  },
});

/** A Sorcerer at the level Sorcery Incarnate arrives. */
const sorcerer = (): CharacterChoices => ({
  ...common,
  name: 'Yrsa',
  classId: 'sorcerer',
  level: 7,
  abilities: {
    method: 'standard-array',
    assignment: { str: 8, dex: 14, con: 13, int: 10, wis: 12, cha: 15 },
  },
  abilityIncreases: { int: 2, con: 1 },
  classSkills: ['arcana', 'persuasion'],
  subclassId: 'draconic-sorcery',
  cantrips: ['fire-bolt', 'ray-of-frost', 'shocking-grasp', 'acid-splash', 'light'],
  preparedSpells: [
    'magic-missile',
    'burning-hands',
    'charm-person',
    'thunderwave',
    'sleep',
    'shatter',
    'hold-person',
    'misty-step',
    'fireball',
    'counterspell',
    'fly',
  ],
  featureChoices: {
    'human:skillful': ['perception'],
    'sorcerer:metamagic': ['Distant Spell', 'Extended Spell'],
    'draconic-sorcery:elemental-affinity': ['Fire'],
  },
  feats: {
    ...common.feats,
    'sorcerer:ability-score-improvement': { featId: 'savage-attacker' },
    ...repeatImprovements('sorcerer', 7),
  },
});

/** A Paladin at the one level Holy Nimbus is printed at. */
const paladin = (): CharacterChoices => ({
  ...common,
  name: 'Ser',
  classId: 'paladin',
  level: 20,
  abilities: {
    method: 'standard-array',
    assignment: { str: 15, dex: 10, con: 13, int: 8, wis: 12, cha: 14 },
  },
  abilityIncreases: { int: 2, wis: 1 },
  classSkills: ['athletics', 'persuasion'],
  subclassId: 'oath-of-devotion',
  cantrips: [],
  preparedSpells: [
    'cure-wounds',
    'bless',
    'heroism',
    'divine-favor',
    'shield-of-faith',
    'lesser-restoration',
    'magic-weapon',
    'aid',
    'prayer-of-healing',
    'revivify',
    'dispel-magic',
    'raise-dead',
    'death-ward',
    'banishment',
    'greater-restoration',
  ],
  featureChoices: { 'human:skillful': ['perception'] },
  feats: {
    ...common.feats,
    'paladin:fighting-style': { featId: 'defense' },
    'paladin:ability-score-improvement': { featId: 'savage-attacker' },
    ...repeatImprovements('paladin', 20),
    'paladin:epic-boon': { featId: 'boon-of-combat-prowess', abilities: ['cha'] },
  },
});

const trade = (
  state: GameState,
  feature: string,
  name: string,
  over: Record<string, unknown> = {},
) => tradeResource(state, WHO, { feature, trade: name, ...over });

describe('Font of Inspiration buys a die back with a slot, as often as it likes', () => {
  /** SRD: "expend a spell slot ... to regain one expended use". */
  it('trades twice inside one turn and twice between Long Rests', () => {
    // Every die spent, so there is something for a trade to give back.
    const log: GameEvent[] = [...made(bard()), FIGHTING, spend('bardic-inspiration', 3)];

    const first = unwrap(
      trade(fold('seed', log), 'bard:font-of-inspiration', 'slot-for-inspiration', {
        slotLevel: 1,
      }),
      'first',
    );
    log.push(...first);

    // The same turn, no rest, and the caster names a slot again.
    const second = unwrap(
      trade(fold('seed', log), 'bard:font-of-inspiration', 'slot-for-inspiration', {
        slotLevel: 1,
        commandId: 'second',
      }),
      'second',
    );
    log.push(...second);

    const now = fold('seed', log);
    expect(left(now, 'bardic-inspiration')).toBe(2);
    // A level 5 Bard has four level 1 slots and two of them paid for this.
    expect(left(now, 'spell-slot:1')).toBe(2);
  });

  /** The engine never picks which slot is burned — the caster does. */
  it('refuses to choose a slot level for the caster', () => {
    const state = built(bard(), [spend('bardic-inspiration', 3)]);
    const refused = trade(state, 'bard:font-of-inspiration', 'slot-for-inspiration');
    expect(isErr(refused) && refused.code).toBe('slot_level_required');
  });
});

describe('Sorcery Incarnate buys a use of Innate Sorcery with Sorcery Points', () => {
  /** SRD: "you can expend 2 Sorcery Points to give yourself one use of it." */
  it('trades twice inside one turn and twice between Long Rests', () => {
    const log: GameEvent[] = [...made(sorcerer()), FIGHTING, spend('innate-sorcery', 2)];

    const first = unwrap(
      trade(fold('seed', log), 'sorcerer:sorcery-incarnate', 'points-for-innate-sorcery'),
      'first',
    );
    log.push(...first, spend('innate-sorcery'));

    const second = unwrap(
      trade(fold('seed', log), 'sorcerer:sorcery-incarnate', 'points-for-innate-sorcery', {
        commandId: 'second',
      }),
      'second',
    );
    log.push(...second);

    const now = fold('seed', log);
    expect(left(now, 'innate-sorcery')).toBe(1);
    // A level 7 Sorcerer has seven points and four of them paid for this.
    expect(left(now, 'sorcery-points')).toBe(3);
  });

  /** SRD: "If you use Innate Sorcery when you have no uses of it left." */
  it('is refused while a use of Innate Sorcery is still in hand', () => {
    const state = built(sorcerer(), [spend('innate-sorcery')]);
    const refused = trade(state, 'sorcerer:sorcery-incarnate', 'points-for-innate-sorcery');
    expect(isErr(refused) && refused.code).toBe('not_yet');
  });
});

describe('Holy Nimbus buys its own use back with a level 5 slot', () => {
  /** SRD: "you can expend a level 5 spell slot to restore your use of it." */
  it('trades twice inside one turn and twice between Long Rests', () => {
    const log: GameEvent[] = [...made(paladin()), FIGHTING, spend('holy-nimbus')];

    const first = unwrap(
      trade(fold('seed', log), 'oath-of-devotion:holy-nimbus', 'slot-for-holy-nimbus'),
      'first',
    );
    log.push(...first, spend('holy-nimbus'));

    const second = unwrap(
      trade(fold('seed', log), 'oath-of-devotion:holy-nimbus', 'slot-for-holy-nimbus', {
        commandId: 'second',
      }),
      'second',
    );
    log.push(...second);

    const now = fold('seed', log);
    expect(left(now, 'holy-nimbus')).toBe(1);
    // A level 20 Paladin has two level 5 slots and both paid for this.
    expect(left(now, 'spell-slot:5')).toBe(0);
  });

  /** The level is the feature's here, so naming one is not on offer. */
  it('spends the slot the feature names and no other', () => {
    const state = built(paladin(), [spend('holy-nimbus')]);
    const events = unwrap(
      trade(state, 'oath-of-devotion:holy-nimbus', 'slot-for-holy-nimbus', { slotLevel: 1 }),
      'trade',
    );
    const now = built(paladin(), [spend('holy-nimbus'), ...events]);
    expect(left(now, 'spell-slot:5')).toBe(1);
    expect(left(now, 'spell-slot:1')).toBe(4);
  });
});

describe('a trade the book does limit is still limited', () => {
  const druid = (): CharacterChoices => ({
    ...common,
    name: 'Fenn',
    classId: 'druid',
    level: 5,
    abilities: {
      method: 'standard-array',
      assignment: { str: 10, dex: 13, con: 14, int: 8, wis: 15, cha: 12 },
    },
    abilityIncreases: { con: 2, wis: 1 },
    classSkills: ['nature', 'survival'],
    subclassId: 'circle-of-the-land',
    cantrips: ['poison-spray', 'guidance', 'druidcraft'],
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
    featureChoices: {
      'human:skillful': ['perception'],
      'druid:primal-order': ['Magician'],
    },
    feats: {
      ...common.feats,
      'druid:ability-score-improvement': { featId: 'savage-attacker' },
    },
  });

  /**
   * SRD Wild Resurgence: "**Once on each of your turns**, if you have no uses
   * of Wild Shape left, you can give yourself one use by expending a spell
   * slot."
   */
  /**
   * And the catalogue's own half of the widening. A union content is
   * validated against grows a member, so what a class file may write has to
   * grow with it and no further: a limit the engine has never heard of is
   * refused, and the pool of one an unlimited trade declares is refused
   * anywhere but on the use it buys back — which is `pool_without_a_limit`'s
   * failure, a pool nothing would ever spend, wearing the new member's name.
   */
  it('refuses a limit the engine does not have, and a pool nothing fills', () => {
    const codesFor = (over: Record<string, unknown>): readonly string[] =>
      checkContent({
        ...SRD_CONTENT,
        classes: SRD_CONTENT.classes.map((one) =>
          one.id !== 'druid'
            ? one
            : {
                ...one,
                features: one.features.map((feature) =>
                  feature.id !== 'druid:wild-resurgence'
                    ? feature
                    : {
                        ...feature,
                        grants: {
                          kind: 'trade',
                          trades: [
                            {
                              id: 'slot-for-wild-shape',
                              action: 'none',
                              spends: { kind: 'spell-slot' },
                              gains: { kind: 'pool', key: 'wild-shape', uses: 1 },
                              ...over,
                            },
                          ],
                        } as never,
                      },
                ),
              },
        ),
      })
        .filter((one) => one.field.includes('grants.trades'))
        .map((one) => one.code);

    expect(codesFor({ limit: 'unlimited' })).toEqual([]);
    expect(codesFor({ limit: 'once-a-week' })).toContain('bad_trade_limit');
    // A pool of one beside an unlimited trade is the use it fills, or nothing.
    expect(codesFor({ limit: 'unlimited', pool: 'druid:wild-resurgence' })).toContain(
      'pool_without_a_limit',
    );
    expect(codesFor({ limit: 'unlimited', pool: 'wild-shape' })).toEqual([]);
  });

  it('refuses the second use of a once-a-turn trade in the same turn', () => {
    const log: GameEvent[] = [...made(druid()), FIGHTING, spend('wild-shape', 2)];

    const first = unwrap(
      trade(fold('seed', log), 'druid:wild-resurgence', 'slot-for-wild-shape', { slotLevel: 1 }),
      'first',
    );
    log.push(...first, spend('wild-shape'));

    const again = trade(
      fold('seed', log),
      'druid:wild-resurgence',
      'slot-for-wild-shape',
      { slotLevel: 1, commandId: 'second' },
    );
    expect(isErr(again) && again.code).toBe('already_used_this_turn');
  });
});
