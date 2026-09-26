import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, type CharacterId } from '@ie/shared';
import { parseAttackLine, parseSaveLine, type Monster } from '@ie/srd';
import type { CharacterSheet } from './character.js';
import { extendContent } from './content.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { declaredCasting } from './spellcasting.js';
import type { SpellDefinition } from './spell-definitions.js';
import { addCreature, resolveAttack, resolveSpell } from './commands.js';

/**
 * SRD Find Steed, whole: a printed line that carries the **casting's** numbers.
 *
 * The Otherworldly Steed's block prints "_Otherworldly Slam._ Melee Attack
 * Roll: Bonus equals your spell attack modifier, reach 5 ft. Hit: 1d8 plus the
 * spell's level of Radiant (Celestial), Psychic (Fey), or Necrotic (Fiend)
 * damage", and Bonus Actions whose DC "equals your spell save DC". Three
 * casting facts in one line — the summoner's attack modifier, a flat that is
 * the slot level, and a type that is the caster's stated choice — which no
 * integer in a stat block could hold.
 *
 * The parser reads them as marks; the arrival resolves them from the casting
 * before the block is adapted, so the sheet pinned into `creature-added` reads
 * plain numbers and the swing opens no book. A block that reaches the game
 * with a mark unresolved — a DM walking the steed in by hand — carries the
 * line as prose with a caveat rather than swinging a number nobody supplied.
 */

const id = (s: string) => asCharacterId(s);
const PAL = id('paladin');
const FOE = id('foe');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  // Level 5: a Proficiency Bonus of 3. Charisma 16: a modifier of 3. So the
  // spell attack modifier is 6 and the spell save DC is 14.
  level: 5,
  abilities: { str: 16, dex: 10, con: 14, int: 8, wis: 10, cha: 16 },
  skills: {},
  saveProficiencies: ['wis', 'cha'],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'cha',
  weaponProficiencies: ['simple', 'martial'],
  ...over,
});

const added = (who: CharacterId, side: string): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 44,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side,
});

/**
 * A homebrew warden whose Bonus Action prints the book's save template with
 * the summoner's DC — SRD Fell Glare's sentence with a span the reader can
 * hold. The steed's own Fell Glare lasts "until the end of **your** next
 * turn", the summoner's, which the span vocabulary cannot name, so that line
 * is carried as prose in the bestiary and the DC mark is proved here instead.
 */
const GLARE_TEXT =
  '_Wisdom Saving Throw:_ DC equals your spell save DC, one creature within 60 feet the warden can see. _Failure:_ The target has the Frightened condition until the end of its next turn.';
const SLAM_TEXT =
  "_Melee Attack Roll:_ Bonus equals your spell attack modifier, reach 5 ft. _Hit:_ 1d8 plus the spell's level of Radiant (Celestial), Psychic (Fey), or Necrotic (Fiend) damage.";

const WARDEN: Monster = {
  ...SRD_CONTENT.monsterById('otherworldly-steed')!,
  id: 'otherworldly-warden',
  name: 'Otherworldly Warden',
  actions: [{ name: 'Warden Slam', text: SLAM_TEXT, attack: parseAttackLine(SLAM_TEXT)! }],
  bonusActions: [{ name: 'Baleful Glare', text: GLARE_TEXT, save: parseSaveLine(GLARE_TEXT)! }],
};

const CALL_A_WARDEN: SpellDefinition = {
  id: 'call-a-warden',
  name: 'Call a Warden',
  level: 2,
  school: 'conjuration',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 30 },
  targets: { count: 1, self: true },
  choiceStated: { of: 'creature-type', options: ['Celestial', 'Fey', 'Fiend'] },
  effects: [
    {
      kind: 'summon',
      monster: 'otherworldly-warden',
      creatureType: 'Celestial',
      kept: { untilSummonerDies: true },
    },
  ],
};

const CONTENT = unwrap(
  extendContent(SRD_CONTENT, { spells: [CALL_A_WARDEN], monsters: [WARDEN] }),
  'the warden beside the book',
);

const supply = (seed = 'steed') => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: CONTENT,
});

const SETUP: readonly GameEvent[] = [
  added(PAL, 'party'),
  added(FOE, 'foes'),
  {
    type: 'spellcasting-declared',
    id: PAL,
    spellcasting: declaredCasting({ ability: 'cha', prepared: ['find-steed', 'call-a-warden'] }),
  },
  ...[1, 2, 3].map(
    (level): GameEvent => ({
      type: 'resource-pool-declared',
      id: PAL,
      pool: { key: `spell-slot:${level}`, label: `level ${level}`, max: 4, recovers: 'long-rest' },
    }),
  ),
  { type: 'scene-set', extent: { width: 600, depth: 600, height: 40 } },
  { type: 'landmark-added', name: 'the road', at: { x: 200, y: 200, z: 0 } },
  { type: 'creature-placed', id: PAL, placement: { from: { landmark: 'the road' }, feet: 0 } },
  { type: 'creature-placed', id: FOE, placement: { from: { creature: PAL }, feet: 5, bearing: 0 } },
];

const KNOWN = new Set<string>([PAL, FOE]);

class Game {
  constructor(readonly events: GameEvent[] = [...SETUP]) {}

  get state(): GameState {
    return fold('seed', this.events);
  }

  push(more: readonly GameEvent[]): this {
    this.events.push(...more);
    return this;
  }

  cast(spellId: string, choice: string, slotLevel: number): this {
    const out = unwrap(
      resolveSpell(this.state, PAL, { spellId, targets: [PAL], choice, slotLevel }, supply(spellId)),
      `${PAL} casting ${spellId}`,
    );
    return this.push(out.events);
  }

  summoned(): CharacterId {
    const [who, ...rest] = (Object.keys(this.state.creatures) as CharacterId[]).filter((k) => !KNOWN.has(k));
    if (who === undefined || rest.length > 0) throw new Error('expected exactly one summons');
    return who;
  }
}

const slamOf = (state: GameState, who: CharacterId) =>
  state.creatures[who]?.sheet.stated?.attacks?.find((one) => one.name === 'Otherworldly Slam');

describe('the steed’s slam carries the Paladin’s numbers', () => {
  it('swings at the spell attack modifier for 1d8 plus the slot level of the chosen type', () => {
    const g = new Game().cast('find-steed', 'Fey', 3);
    const steed = g.summoned();
    const slam = slamOf(g.state, steed);

    expect(slam).toEqual({
      name: 'Otherworldly Slam',
      kind: 'melee',
      modifier: 6,
      reach: 5,
      range: null,
      damage: [{ dice: '1d8', flat: 3, type: 'psychic', average: 7 }],
      qualification: null,
      rider: null,
    });
    // Plain numbers and no marks: nothing downstream has to know where they
    // came from, and the log replays them without a catalogue.
    expect(slam).not.toHaveProperty('bonusFromSummoner');
    expect(slam?.damage[0]).not.toHaveProperty('flatFromSlotLevel');
    expect(slam?.damage[0]).not.toHaveProperty('typeFromChoice');
    expect(fold('seed', JSON.parse(JSON.stringify(g.events)) as GameEvent[])).toEqual(g.state);
  });

  it.each([
    ['Celestial', 'radiant'],
    ['Fey', 'psychic'],
    ['Fiend', 'necrotic'],
  ])('deals the type the caster chose: %s is %s', (choice, type) => {
    const g = new Game().cast('find-steed', choice, 2);
    const slam = slamOf(g.state, g.summoned());
    expect(slam?.damage).toEqual([{ dice: '1d8', flat: 2, type, average: 6 }]);
    expect(g.state.creatures[g.summoned()]?.creatureType).toBe(choice);
  });

  it('rolls the slam with the Paladin’s bonus and the chosen type', () => {
    const g = new Game().cast('find-steed', 'Fiend', 3);
    const steed = g.summoned();
    // Where it appears is a second command, as it is for every summons.
    g.push([{ type: 'creature-placed', id: steed, placement: { from: { creature: PAL }, feet: 5, bearing: 90 } }]);
    const swing = unwrap(resolveAttack(g.state, steed, { target: FOE, weapon: null }, supply('slam')), 'the slam');

    const roll = swing.events.find((e) => e.type === 'roll-recorded');
    expect(roll).toBeDefined();
    if (roll?.type === 'roll-recorded') {
      expect(roll.total - roll.natural).toBe(6);
    }
    const dice = swing.events.find((e) => e.type === 'damage-dice-recorded');
    if (dice?.type === 'damage-dice-recorded') {
      expect(dice.components.map((part) => [part.type, part.flat])).toEqual([['necrotic', 3]]);
    }
  });

  it('gives a Bonus Action whose DC is the summoner’s the summoner’s DC', () => {
    const g = new Game().cast('call-a-warden', 'Fey', 2);
    const warden = g.state.creatures[g.summoned()]!;
    const glare = warden.sheet.stated?.bonusActions?.find((line) => line.name === 'Baleful Glare');
    expect(glare?.save).toMatchObject({ ability: 'wis', dc: 14 });
    expect(glare?.save).not.toHaveProperty('dcFromSummoner');
    const slam = warden.sheet.stated?.attacks?.find((line) => line.name === 'Warden Slam');
    expect(slam).toMatchObject({ modifier: 6, damage: [{ dice: '1d8', flat: 2, type: 'psychic' }] });
  });
});

describe('a steed nobody cast', () => {
  it('carries the slam as prose with a caveat rather than swinging a number nobody supplied', () => {
    const arrival = unwrap(
      addCreature(fold('seed', SETUP), SRD_CONTENT, id('stray'), 'otherworldly-steed'),
      'a stray steed',
    );
    const state = fold('seed', [...SETUP, ...arrival.events]);
    const stray = state.creatures[id('stray')]!;

    expect(stray.sheet.stated?.attacks).toBeUndefined();
    expect(stray.sheet.stated?.unreadActions?.map((line) => line.name)).toContain('Otherworldly Slam');
    expect(arrival.unverified.some((gap) => gap.includes('Otherworldly Slam'))).toBe(true);
  });
});
