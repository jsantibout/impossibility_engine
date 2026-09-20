/**
 * A monster is content, and a command comes by it the way it comes by an item.
 *
 * Three claims, and each of them is a door rather than a table:
 *
 * - **`Content` carries the bestiary.** `monsters` is a field on
 *   `ContentInput` like `items` is, `SRD_CONTENT` holds the SRD's own, and
 *   homebrew arrives through `loadContent` and `extendContent` with no
 *   privileged path for the printed book. There is no second registry, no
 *   fourth field on `Supply` and no extra parameter on a command.
 * - **`addCreature` takes the id and not the value.** An engine entry point
 *   that accepts a whole stat block is the one door a model-authored Armour
 *   Class could walk through, and nothing guards it — `boundary.test.ts`
 *   proves the two external-roll functions are unreachable *by name*, and a
 *   value parameter is not on that list. So the caller states an id, the
 *   engine looks it up, and `unknown_monster` is a refusal something can
 *   actually reach.
 * - **The size is the stat block's.** It is pinned into `creature-added` at
 *   arrival and read back by `placeCreatureInScene`, so nobody above the
 *   engine supplies a fact the book prints. A caller who states one still
 *   wins, because a DM shrinking a hound is a fact only they have.
 */
import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap } from '@ie/shared';
import type { Monster } from '@ie/srd';
import {
  addCreature,
  addSceneLandmark,
  placeCreatureInScene,
  setScene,
  summonCreature,
} from './commands.js';
import { checkContent, extendContent, loadContent, type Content } from './content.js';
import { applyEvent, fold, type GameEvent, type GameState } from './events.js';
import { adaptMonster } from './monster.js';

const id = (s: string) => asCharacterId(s);
const ZOMBIE = id('zombie');
const HOUND = id('hound');
const WIZ = id('wiz');

const empty = (): GameState => fold('monster-content', []);
const push = (state: GameState, events: readonly GameEvent[]): GameState =>
  events.reduce(applyEvent, state);

/**
 * A stat block that exists in this file and nowhere the SRD prints.
 *
 * Homebrew on purpose, and in the shape the book's own entries are in:
 * `Monster` is the vocabulary a stat block is written in and `adaptMonster` is
 * written against it, so a second `MonsterDefinition` would be a twin waiting
 * for a second consumer that does not exist.
 */
const CONJURED_HOUND: Monster = {
  id: 'conjured-hound',
  name: 'Conjured Hound',
  size: 'large',
  alternateSizes: [],
  type: 'Elemental',
  subtype: null,
  swarmMemberSize: null,
  alignment: 'Unaligned',
  ac: 14,
  initiative: 2,
  hp: { average: 26, formula: '4d10 + 4' },
  speed: { walk: 40, burrow: null, climb: null, fly: null, swim: null, hover: false },
  abilities: {
    str: { score: 16, modifier: 3, save: 3 },
    dex: { score: 14, modifier: 2, save: 2 },
    con: { score: 13, modifier: 1, save: 1 },
    int: { score: 4, modifier: -3, save: -3 },
    wis: { score: 12, modifier: 1, save: 1 },
    cha: { score: 6, modifier: -2, save: -2 },
  },
  skills: { perception: 5 },
  vulnerabilities: [],
  resistances: ['cold'],
  immunities: ['poison', 'poisoned'],
  gear: [],
  senses: ['Darkvision 60 ft.'],
  passivePerception: 15,
  languages: [],
  cr: 2,
  crLabel: '2',
  xp: 450,
  proficiencyBonus: 2,
  traits: [],
  actions: [{ name: 'Bite', text: 'Melee Attack Roll: +5, reach 5 ft. Hit: 7 (1d10 + 2).' }],
  bonusActions: [],
  reactions: [],
  legendaryActions: [],
};

const withHound = (): Content =>
  unwrap(extendContent(SRD_CONTENT, { monsters: [CONJURED_HOUND] }), 'the hound beside the book');

describe('the bestiary is content, and the SRD supplies its own', () => {
  it('answers a printed monster by its id, and null for one it does not hold', () => {
    const zombie = SRD_CONTENT.monsterById('zombie');
    expect(zombie?.name).toBe('Zombie');
    expect(zombie?.size).toBe('medium');
    expect(SRD_CONTENT.monsterById('conjured-hound')).toBeNull();
  });

  it('carries the printed bestiary on the array beside the lookup', () => {
    expect(SRD_CONTENT.monsters.length).toBeGreaterThan(300);
    expect(SRD_CONTENT.monsters.every((m) => SRD_CONTENT.monsterById(m.id) === m)).toBe(true);
  });

  /**
   * The one thing `checkContent` adds over what `MonsterSchema` already pins.
   * A skill key outside the engine's vocabulary is dropped by `adaptMonster`
   * without a word, so a homebrew line that should have bought a bonus quietly
   * buys nothing — the class of failure this repository calls its worst.
   */
  it('refuses a skill the engine has no vocabulary for, with a path', () => {
    const problems = checkContent({
      monsters: [{ ...CONJURED_HOUND, skills: { perception: 5, 'tail-wagging': 7 } }],
    });
    expect(problems.map((p) => p.code)).toEqual(['unknown_skill']);
    expect(problems[0]?.field).toBe('monsters[conjured-hound].skills');
    expect(problems[0]?.reason).toContain('tail-wagging');
  });

  /**
   * And what it deliberately does not refuse. The SRD prints qualified and
   * unrecognised defence runs, `adaptMonster` classifies them and
   * `addCreature` reports them through `unverified` — a validator that
   * rejected them would refuse the printed book.
   */
  it('accepts a qualified or unrecognised defence, and reports it at arrival', () => {
    const bound: Monster = {
      ...CONJURED_HOUND,
      id: 'bound-hound',
      name: 'Bound Hound',
      immunities: ['Charmed (except from its binder)', 'Radiant Backlash'],
    };
    expect(checkContent({ monsters: [bound] })).toEqual([]);

    const content = unwrap(extendContent(SRD_CONTENT, { monsters: [bound] }), 'the bound hound');
    const added = unwrap(addCreature(empty(), content, HOUND, 'bound-hound'), 'the hound arrives');
    expect(added.unverified).toEqual([
      'hound: Charmed (except from its binder) — the engine cannot evaluate "except from its binder", so the immunity is not applied',
      'hound: Radiant Backlash — a defence the engine does not recognise',
    ]);
  });
});

describe('a monster comes into the game by its id', () => {
  it('pins the stat block the content holds, whole, into the event', () => {
    const added = unwrap(addCreature(empty(), SRD_CONTENT, ZOMBIE, 'zombie'), 'the zombie');
    const event = added.events[0] as Extract<GameEvent, { type: 'creature-added' }>;
    const block = SRD_CONTENT.monsterById('zombie');
    expect(block).not.toBeNull();
    const adapted = adaptMonster(block!, ZOMBIE);

    expect(event.type).toBe('creature-added');
    expect(event.name).toBe('Zombie');
    expect(event.maxHp).toBe(adapted.vitals.hpMax);
    expect(event.sheet).toEqual(adapted.sheet);
    expect(event.creatureType).toBe(adapted.creatureType);
    expect(event.conditionImmunities).toEqual(adapted.defenses.conditionImmunities);
  });

  /**
   * The refusal the old comment withheld because nothing could reach it: "there
   * is no monster catalogue to look one up in, so there is nothing for an
   * unknown stat block refusal to refuse". There is one now.
   */
  it('refuses an id this world does not hold, as a value naming what it does', () => {
    const refused = addCreature(empty(), SRD_CONTENT, HOUND, 'conjured-hound');
    expect(isErr(refused)).toBe(true);
    if (!isErr(refused)) return;
    expect(refused.code).toBe('unknown_monster');
    expect(refused.reason).toContain('conjured-hound');
  });

  /**
   * Either answer is true; what matters is that it is the same one every time,
   * because a caller branching on the code cannot branch on a coin. The same
   * claim `summonCreature` already makes about the casting and the creature.
   */
  it('answers the roster before it answers the book', () => {
    const state = push(empty(), unwrap(addCreature(empty(), SRD_CONTENT, ZOMBIE, 'zombie'), 'a zombie').events);
    const refused = addCreature(state, SRD_CONTENT, ZOMBIE, 'no-such-monster');
    expect(isErr(refused) && refused.code).toBe('already_present');
  });

  it('holds a homebrew monster loaded beside the book, on the same door', () => {
    const content = withHound();
    const added = unwrap(addCreature(empty(), content, HOUND, 'conjured-hound'), 'the hound');
    const event = added.events[0] as Extract<GameEvent, { type: 'creature-added' }>;
    expect(event.name).toBe('Conjured Hound');
    expect(event.maxHp).toBe(26);
    // The same world still holds everything the book printed.
    expect(content.monsterById('zombie')?.name).toBe('Zombie');
  });

  it('is summoned by id too, so the two paths stay one shape', () => {
    const content = withHound();
    const state = push(empty(), unwrap(addCreature(empty(), content, WIZ, 'zombie'), 'a summoner').events);
    const summoned = unwrap(
      summonCreature(state, content, { id: HOUND, monsterId: 'conjured-hound', by: WIZ }),
      'the hound is summoned',
    );
    expect(summoned.events[0]).toMatchObject({ type: 'creature-added', name: 'Conjured Hound' });

    const refused = summonCreature(state, content, {
      id: HOUND,
      monsterId: 'no-such-hound',
      by: WIZ,
    });
    expect(isErr(refused) && refused.code).toBe('unknown_monster');
  });
});

describe('the size a stat block prints is pinned, and read back', () => {
  const room = (): GameState => {
    const set = push(empty(), unwrap(setScene(empty(), { width: 60, depth: 60, height: 20 }), 'a room'));
    return push(set, unwrap(addSceneLandmark(set, 'the altar', { x: 30, y: 30, z: 0 }), 'an altar'));
  };
  const standing = (content: Content, monsterId: string): GameState => {
    const stage = room();
    return push(stage, unwrap(addCreature(stage, content, HOUND, monsterId), 'it arrives').events);
  };

  it('pins it on creature-added', () => {
    const added = unwrap(addCreature(empty(), SRD_CONTENT, ZOMBIE, 'zombie'), 'the zombie');
    expect(added.events[0]).toMatchObject({ type: 'creature-added', size: 'medium' });

    const hound = unwrap(addCreature(empty(), withHound(), HOUND, 'conjured-hound'), 'the hound');
    expect(hound.events[0]).toMatchObject({ type: 'creature-added', size: 'large' });
  });

  it('is what placeCreatureInScene uses when the caller states none', () => {
    const state = standing(withHound(), 'conjured-hound');
    const placed = unwrap(
      placeCreatureInScene(state, HOUND, { from: { landmark: 'the altar' }, feet: 0 }),
      'the hound stands somewhere',
    );
    expect(placed[0]).toMatchObject({ type: 'creature-placed', placement: { size: 'large' } });
    expect(push(state, placed).scene?.sizes[HOUND]).toBe('large');
  });

  it('still lets a caller who states one win', () => {
    const state = standing(withHound(), 'conjured-hound');
    const placed = unwrap(
      placeCreatureInScene(state, HOUND, { from: { landmark: 'the altar' }, feet: 0, size: 'tiny' }),
      'a shrunken hound',
    );
    expect(placed[0]).toMatchObject({ type: 'creature-placed', placement: { size: 'tiny' } });
    expect(push(state, placed).scene?.sizes[HOUND]).toBe('tiny');
  });

  /**
   * Absent means Medium, which is what every log written before the field
   * existed says — the reading `conditionImmunities` already has, and the
   * reason neither frozen fixture moved.
   */
  it('leaves a creature nobody pinned a size for exactly where it was', () => {
    const stage = room();
    const state = push(stage, [
      {
        type: 'creature-added',
        id: HOUND,
        name: 'Somebody',
        sheet: adaptMonster(CONJURED_HOUND, HOUND).sheet,
        maxHp: 10,
      },
    ]);
    const placed = unwrap(
      placeCreatureInScene(state, HOUND, { from: { landmark: 'the altar' }, feet: 0 }),
      'they stand somewhere',
    );
    const event = placed[0] as Extract<GameEvent, { type: 'creature-placed' }>;
    expect(event.placement.size).toBeUndefined();
    expect(push(state, placed).scene?.sizes[HOUND]).toBe('medium');
  });
});

describe('a homebrew monster arrives through the untyped door', () => {
  const JSON_TEXT = JSON.stringify({ monsters: [CONJURED_HOUND] });

  it('is parsed from JSON text and validated beside the printed bestiary', () => {
    const loaded = unwrap(loadContent(JSON.parse(JSON_TEXT)), 'the hound as JSON');
    expect(loaded.monsterById('conjured-hound')?.name).toBe('Conjured Hound');
    const added = unwrap(addCreature(empty(), loaded, HOUND, 'conjured-hound'), 'the hound');
    expect(added.events[0]).toMatchObject({ type: 'creature-added', size: 'large', maxHp: 26 });
  });

  it('refuses a malformed stat block at the door, with a path', () => {
    const refused = loadContent({ monsters: [{ ...CONJURED_HOUND, ac: 0 }] });
    expect(isErr(refused) && refused.code).toBe('bad_content');
    // The parser's own code and path inside the door's reason, exactly as a
    // malformed item reads.
    expect(isErr(refused) && refused.reason).toContain('bad_monster');
    expect(isErr(refused) && refused.reason).toContain('monsters[conjured-hound]: ac');
  });
});
