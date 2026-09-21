import { SRD_CONTENT } from '@ie/content';
import type { MonsterMultiattack } from '@ie/srd';
import { describe, expect, it } from 'vitest';
import {
  asCharacterId,
  type CharacterId,
  isErr,
  expect as unwrap,
  type Result,
} from '@ie/shared';
import {
  addCreature,
  applyConditionTo,
  beginCombat,
  declareCreatureSide,
  placeCreatureInScene,
  resolveAttack,
  resolveMove,
  resolveTurn,
  setScene,
  addSceneLandmark,
  takeOpportunityAttack,
  takeStatedBonusAction,
} from './commands.js';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { fold, type GameEvent, type GameState } from './events.js';
import {
  adaptMonster,
  bestPrintedMeleeAttack,
  multiattackAllows,
  printedAttackOf,
  statedBonusActionsUsed,
} from './monster.js';
import { createRollIssuer } from './rolls.js';
import { createCharacter, type CharacterChoices } from './creation.js';

/**
 * What a monster does on its turn, for the two shapes a stat block states in a
 * form the engine can read.
 *
 * Until this, a stat block arrived as a *body*: an Armour Class to beat, hit
 * points to take off, saves to roll and a type a spell reads. What the
 * creature did was prose. A Goblin could swing a Scimitar only because a
 * Scimitar is a catalogue weapon and somebody had put one in its hands — and a
 * Wolf, whose Bite is nobody's weapon, could not attack at all.
 *
 * Both shapes here are the same claim in two places: **a number the book
 * prints is the Engine's to supply**, never the caller's to state. The Wolf's
 * +4 and its 1d6 + 2 come out of the block, and Pack Tactics' Advantage is
 * decided by where the creatures are standing rather than by whoever is
 * narrating.
 */

const id = (s: string) => asCharacterId(s);
const BREN = id('bren');
const WOLF = id('wolf');
const PACK = id('pack');
const GHOUL = id('ghoul');
const GOBLIN = id('goblin');
const OGRE = id('ogre');
const MUMMY = id('mummy');
const ANKHEG = id('ankheg');
const MERROW = id('merrow');
const DEVIL = id('barbed-devil');

const supply = (seed = 'fangs') => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

/** A level 1 Fighter for the wolves to bite. */
const walkOn = (name: string): CharacterChoices => ({
  name,
  classId: 'fighter',
  level: 1,
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
  cantrips: [],
  spellbook: [],
  preparedSpells: [],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: ['chain-mail'],
  hitPoints: { method: 'fixed' },
  featureChoices: { 'human:skillful': ['perception'], 'fighter:weapon-mastery': [] },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int',
      cantrips: ['mage-hand', 'light'],
      levelOneSpell: 'ray-of-sickness',
    },
    'human:versatile': { featId: 'alert' },
    'fighter:fighting-style': { featId: 'archery' },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
});

/** A log built only out of what the engine produced. */
class Table {
  private readonly log: GameEvent[] = [];

  get state(): GameState {
    return fold('fangs', this.log);
  }

  /** Everything that happened, for a claim about the record rather than the state. */
  get events(): readonly GameEvent[] {
    return this.log;
  }

  do(step: string, produce: (state: GameState) => Result<readonly GameEvent[]>): GameState {
    this.log.push(...unwrap(produce(this.state), step));
    return this.state;
  }

  did(
    step: string,
    produce: (state: GameState) => Result<{ readonly events: readonly GameEvent[] }>,
  ): GameState {
    this.log.push(...unwrap(produce(this.state), step).events);
    return this.state;
  }
}

const statBlock = (slug: string) => {
  const found = SRD_CONTENT.monsterById(slug);
  if (found === null) throw new Error(`no such monster: ${slug}`);
  return found;
};

const GOLEM = id('golem');

/**
 * The golem's Bonus Action line, by the heading its own block prints it under
 * — read off the block rather than typed out, because the heading carries the
 * book's recharge and the book's en dash and a test that retyped either would
 * be testing its own transcription.
 */
const HASTEN = statBlock('clay-golem').bonusActions[0]!.name;

/**
 * A fighter with a wolf ten feet away, and everybody's side declared.
 *
 * Ten feet is out of the Wolf's five-foot reach on purpose: each test moves
 * what it needs to and the reach refusal is one of them.
 */
const inTheWoods = (monster: string, who: CharacterId, feet = 5): Table => {
  const table = new Table();
  table.do('the fighter arrives', () => createCharacter(SRD_CONTENT, walkOn('Bren'), BREN));
  table.did('the monster arrives', (s) => addCreature(s, SRD_CONTENT, who, monster));
  table.do('the clearing', (s) => setScene(s, { width: 60, depth: 40, height: 20 }));
  table.do('the stump', (s) => addSceneLandmark(s, 'the stump', { x: 20, y: 20, z: 0 }));
  table.do('Bren by the stump', (s) =>
    placeCreatureInScene(s, BREN, { from: { landmark: 'the stump' }, feet: 0 }),
  );
  table.do('the monster beside him', (s) =>
    placeCreatureInScene(s, who, { from: { creature: BREN }, feet, bearing: 90 }),
  );
  table.do('Bren’s side', (s) => declareCreatureSide(s, BREN, 'party'));
  table.do('the monster’s side', (s) => declareCreatureSide(s, who, 'wild'));
  table.do('the order', (s) =>
    beginCombat(s, [
      { id: who, initiative: 20, speed: 40 },
      { id: BREN, initiative: 1, speed: 30 },
    ]),
  );
  return table;
};

describe('the adapter carries what a block says it does', () => {
  it('carries the Wolf’s Bite with the numbers the block prints', () => {
    const wolf = adaptMonster(statBlock('wolf'), WOLF);
    expect(wolf.sheet.stated?.attacks).toEqual([
      {
        name: 'Bite',
        kind: 'melee',
        modifier: 4,
        reach: 5,
        range: null,
        damage: [{ dice: '1d6', flat: 2, type: 'piercing', average: 5 }],
        qualification: null,
        rider: 'If the target is a Medium or smaller creature, it has the Prone condition.',
      },
    ]);
  });

  it('carries the trait shapes the parser read and no others', () => {
    const wolf = adaptMonster(statBlock('wolf'), WOLF);
    const spider = adaptMonster(statBlock('giant-spider'), id('spider'));

    expect(wolf.sheet.stated?.traits).toEqual([
      { kind: 'advantage-when-ally-is-within-5-feet-of-the-target' },
    ]);
    expect(spider.sheet.stated?.traits ?? []).toEqual([]);
  });

  /**
   * Multiattack is an action the engine does not carry, and the Ghoul's two
   * are. A line the parser left as prose must not arrive as an attack with
   * invented numbers — that is the failure the whole shape exists to avoid.
   */
  it('carries the attacks a block prints and not the lines it cannot read', () => {
    const ghoul = adaptMonster(statBlock('ghoul'), GHOUL);
    expect(ghoul.sheet.stated?.attacks?.map((a) => a.name)).toEqual(['Bite', 'Claw']);
  });

  /**
   * A stat block prints its attacks under headings that say what they *cost*,
   * and the attack path spends the Attack action. A Bonus Action attack
   * carried across as one of those would be a creature swinging twice for one
   * action, so only the Actions section is carried.
   *
   * **The SRD prints no attack line anywhere else today** — every one of them
   * is under Actions — so this is a rule kept rather than a bug fixed, and it
   * is asserted over the whole catalogue rather than over one block, because a
   * guard checked against an empty population checks nothing.
   */
  it('carries an attack only from the section whose cost the engine spends', () => {
    let checked = 0;
    for (const monster of SRD_CONTENT.monsters) {
      const adapted = adaptMonster(monster, id(monster.id));
      const actions = monster.actions.map((a) => a.name);
      for (const attack of adapted.sheet.stated?.attacks ?? []) {
        expect(actions, `${monster.id}: ${attack.name}`).toContain(attack.name);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(400);
  });

  it('finds a printed attack by name, however it is capitalised', () => {
    const wolf = adaptMonster(statBlock('wolf'), WOLF);
    expect(printedAttackOf(wolf.sheet, 'bite')?.modifier).toBe(4);
    expect(printedAttackOf(wolf.sheet, 'Bite')?.modifier).toBe(4);
    expect(printedAttackOf(wolf.sheet, 'Multiattack')).toBeNull();
  });
});

describe('a monster attacks with what its block prints', () => {
  it('rolls the printed bonus, and nothing derived from an ability', () => {
    const table = inTheWoods('wolf', WOLF);
    const bite = unwrap(
      resolveAttack(table.state, WOLF, { target: BREN, weapon: null, action: 'Bite' }, supply()),
      'the bite',
    );

    expect(bite.attack?.roll.modifier).toBe(4);
    expect(bite.attack?.total).toBe(bite.attack!.roll.natural + 4);
  });

  /**
   * And the block's number is the number even where a derivation would have
   * given another. A Ghoul's Bite is +4; its Strength modifier is +1 and its
   * Proficiency Bonus is +2, so an attack derived the way a character's is
   * would roll at +3. The Wolf above happens to agree with its own derivation,
   * which is why the claim is made here as well as there.
   */
  it('rolls the block’s number where a derived one would differ', () => {
    const ghoul = statBlock('ghoul');
    expect(ghoul.abilities.str.modifier + ghoul.proficiencyBonus).toBe(3);

    const table = inTheWoods('ghoul', GHOUL);
    const bite = unwrap(
      resolveAttack(table.state, GHOUL, { target: BREN, weapon: null, action: 'Bite' }, supply()),
      'the bite',
    );

    expect(bite.attack?.roll.modifier).toBe(4);
    // The block names no ability behind that number, and the result says so
    // rather than reporting the Strength a weaponless swing falls back to.
    expect(bite.attack?.ability).toBeNull();
  });

  /**
   * `1d6 + 2`, which is 3 to 8 — and never the `1 + Strength` an Unarmed
   * Strike deals, which is what a weaponless attacker used to get. A dozen
   * fixed seeds, because one seed proves a number and a spread proves the die:
   * a bite over 6 can only have come from the modifier the block prints.
   */
  it('deals the die and the modifier the block prints, of the type it prints', () => {
    const table = inTheWoods('wolf', WOLF);
    const dealt: number[] = [];

    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l']) {
      const swing = unwrap(
        resolveAttack(
          table.state,
          WOLF,
          { target: BREN, weapon: null, action: 'Bite', commandId: seed },
          supply(seed),
        ),
        'the bite',
      );
      if (swing.attack?.hit !== true) continue;

      const taken = swing.events.find((e) => e.type === 'damage-taken');
      expect(taken?.type === 'damage-taken' ? taken.source : null).toBe('Bite');
      dealt.push(swing.damage!);
    }

    expect(dealt.length, 'no seed in the list landed a bite').toBeGreaterThan(2);
    expect(Math.min(...dealt)).toBeGreaterThanOrEqual(3);
    expect(Math.max(...dealt)).toBeLessThanOrEqual(8);
    expect(Math.max(...dealt)).toBeGreaterThan(6);
  });

  /**
   * The Wolf's Bite prints "If the target is a Medium or smaller creature, it
   * has the Prone condition", and the engine does not apply it. Saying so is
   * the difference between a shape that is honest about its edges and one that
   * quietly makes the Wolf weaker than the book.
   */
  it('reports the rider the block prints and the engine does not apply', () => {
    const table = inTheWoods('wolf', WOLF);
    const bite = unwrap(
      resolveAttack(table.state, WOLF, { target: BREN, weapon: null, action: 'Bite' }, supply()),
      'the bite',
    );

    expect(bite.unverified.join(' ')).toContain('Prone condition');
  });

  /**
   * SRD Ankheg: "+5 (with Advantage if the target is Grappled by the ankheg)".
   *
   * The engine cannot evaluate that clause, and the outcome it matters most to
   * is the **miss** — Advantage is exactly what would have changed one. So it
   * is reported beside the roll rather than beside the hit, and this asserts it
   * on both, because a report only a landed blow carries is a report missing
   * where it counts.
   */
  it('reports a condition on the roll whether the swing lands or not', () => {
    let missed = 0;
    let landed = 0;

    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
      const table = inTheWoods('ankheg', ANKHEG);
      const bite = unwrap(
        resolveAttack(
          table.state,
          ANKHEG,
          { target: BREN, weapon: null, action: 'Bite', commandId: seed },
          supply(seed),
        ),
        'the bite',
      );

      expect(bite.unverified.join(' ')).toContain('with Advantage if the target is Grappled');
      if (bite.attack?.hit === true) landed += 1;
      else missed += 1;
    }

    expect(landed).toBeGreaterThan(0);
    expect(missed).toBeGreaterThan(0);
  });

  it('measures reach against the reach the block prints', () => {
    const table = inTheWoods('wolf', WOLF, 20);
    const bite = resolveAttack(
      table.state,
      WOLF,
      { target: BREN, weapon: null, action: 'Bite' },
      supply(),
    );
    expect(isErr(bite) ? bite.code : 'ok').toBe('out_of_reach');
  });

  it('refuses an action the creature’s block does not print', () => {
    const table = inTheWoods('wolf', WOLF);
    const bite = resolveAttack(
      table.state,
      WOLF,
      { target: BREN, weapon: null, action: 'Tail Swipe' },
      supply(),
    );
    expect(isErr(bite) ? bite.code : 'ok').toBe('unknown_action');
  });

  it('refuses a swing that is both a weapon and a printed attack', () => {
    const table = inTheWoods('wolf', WOLF);
    const bite = resolveAttack(
      table.state,
      WOLF,
      { target: BREN, weapon: 'scimitar', action: 'Bite' },
      supply(),
    );
    expect(isErr(bite) ? bite.code : 'ok').toBe('two_attacks');
  });

  /**
   * A held attack is SRD's "immediately after hitting" window, and everything
   * it needs is written into `attack-landed` — which carries a weapon's id and
   * has nowhere to put a printed line. Refused before anything is spent rather
   * than rolled and then lost.
   */
  it('refuses to hold a printed attack’s damage', () => {
    const table = inTheWoods('wolf', WOLF);
    const bite = resolveAttack(
      table.state,
      WOLF,
      { target: BREN, weapon: null, action: 'Bite', hold: true },
      supply(),
    );
    expect(isErr(bite) ? bite.code : 'ok').toBe('cannot_hold');
  });

  /** The whole point: the Wolf owns nothing, and bites anyway. */
  it('needs no catalogue weapon in the creature’s hands', () => {
    const table = inTheWoods('wolf', WOLF);
    expect(table.state.creatures[WOLF]?.inventory ?? []).toEqual([]);
    const bite = resolveAttack(
      table.state,
      WOLF,
      { target: BREN, weapon: null, action: 'Bite' },
      supply(),
    );
    expect(isErr(bite)).toBe(false);
  });
});

/**
 * A printed line that reaches across a room, and one that does both.
 *
 * The scene is wide because the numbers under test are the book's: a
 * Shortbow's 80/320 and a Javelin's 30/120 are only checkable on a map big
 * enough to stand beyond them.
 */
const onTheMoor = (monster: string, who: CharacterId, feet: number): Table => {
  const table = new Table();
  table.do('the fighter arrives', () => createCharacter(SRD_CONTENT, walkOn('Bren'), BREN));
  table.did('the monster arrives', (s) => addCreature(s, SRD_CONTENT, who, monster));
  table.do('the moor', (s) => setScene(s, { width: 600, depth: 60, height: 40 }));
  table.do('the cairn', (s) => addSceneLandmark(s, 'the cairn', { x: 20, y: 20, z: 0 }));
  table.do('Bren by the cairn', (s) =>
    placeCreatureInScene(s, BREN, { from: { landmark: 'the cairn' }, feet: 0 }),
  );
  table.do('the monster off across the moor', (s) =>
    placeCreatureInScene(s, who, { from: { creature: BREN }, feet, bearing: 90 }),
  );
  table.do('Bren’s side', (s) => declareCreatureSide(s, BREN, 'party'));
  table.do('the monster’s side', (s) => declareCreatureSide(s, who, 'wild'));
  return table;
};

describe('a printed line that carries rather than reaches', () => {
  /** SRD Goblin Warrior: "_Ranged Attack Roll:_ +4, range 80/320 ft." */
  it('shoots at the range the block prints', () => {
    const table = onTheMoor('goblin-warrior', GOBLIN, 60);
    const shot = unwrap(
      resolveAttack(
        table.state,
        GOBLIN,
        { target: BREN, weapon: null, action: 'Shortbow' },
        supply(),
      ),
      'the shot',
    );

    expect(shot.attack?.roll.modifier).toBe(4);
    expect(shot.attack?.mode).toBe('normal');
  });

  /**
   * SRD: "Your attack roll has Disadvantage when your target is beyond normal
   * range" — read off the printed line's own two numbers, which is a rule that
   * could only ever fire for a monster once the line was read.
   */
  it('takes Disadvantage beyond the printed normal range', () => {
    const table = onTheMoor('goblin-warrior', GOBLIN, 120);
    const shot = unwrap(
      resolveAttack(
        table.state,
        GOBLIN,
        { target: BREN, weapon: null, action: 'Shortbow' },
        supply(),
      ),
      'the shot',
    );

    expect(shot.attack?.mode).toBe('disadvantage');
    expect(shot.attack?.roll.rolls).toHaveLength(2);
  });

  it('refuses a shot beyond the printed long range', () => {
    const table = onTheMoor('goblin-warrior', GOBLIN, 400);
    const shot = resolveAttack(
      table.state,
      GOBLIN,
      { target: BREN, weapon: null, action: 'Shortbow' },
      supply(),
    );
    expect(isErr(shot) ? shot.code : 'ok').toBe('out_of_range');
  });

  /**
   * SRD Ogre: "_Melee or Ranged Attack Roll:_ +6, reach 5 ft. or range 30/120
   * ft." One line, two halves, and which one this swing is belongs to the
   * attacker — so the Javelin that cannot reach twenty feet carries a hundred
   * when it is thrown.
   */
  it('lets a line that prints both halves be thrown', () => {
    const table = onTheMoor('ogre', OGRE, 20);

    const stabbed = resolveAttack(
      table.state,
      OGRE,
      { target: BREN, weapon: null, action: 'Javelin' },
      supply(),
    );
    expect(isErr(stabbed) ? stabbed.code : 'ok').toBe('out_of_reach');

    const thrown = unwrap(
      resolveAttack(
        table.state,
        OGRE,
        { target: BREN, weapon: null, action: 'Javelin', thrown: true },
        supply(),
      ),
      'the javelin',
    );
    expect(thrown.attack?.roll.modifier).toBe(6);
    expect(thrown.attack?.mode).toBe('normal');
  });
});

describe('every component of a printed line meets the target’s own defences', () => {
  /**
   * SRD Ghoul: "5 (1d6 + 2) Piercing damage plus 3 (1d6) Necrotic damage."
   *
   * Two components rather than one number, which is the whole reason damage is
   * typed: a Mummy is immune to Necrotic and to nothing the other half deals,
   * so its bite lands the piercing and none of the rest. Folded into one
   * component the Mummy would take necrotic damage it is immune to, silently.
   */
  it('lands the half a Necrotic-immune target has no answer to, and no more', () => {
    const mummy = statBlock('mummy');
    expect(mummy.immunities).toContain('Necrotic');

    const seeds = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'];
    const against = (target: string, who: CharacterId): readonly number[] => {
      const table = new Table();
      table.did('the ghoul arrives', (s) => addCreature(s, SRD_CONTENT, GHOUL, 'ghoul'));
      table.did('its prey arrives', (s) => addCreature(s, SRD_CONTENT, who, target));
      const dealt: number[] = [];
      for (const seed of seeds) {
        const bite = unwrap(
          resolveAttack(
            table.state,
            GHOUL,
            { target: who, weapon: null, action: 'Bite', commandId: seed },
            supply(seed),
          ),
          'the bite',
        );
        if (bite.attack?.hit === true) dealt.push(bite.damage!);
      }
      return dealt;
    };

    // 1d6 + 2 Piercing and 1d6 Necrotic: 4 to 14 against a creature with no
    // answer to either, and 3 to 8 against one immune to the second.
    const onFlesh = against('bandit', id('bandit'));
    const onTheMummy = against('mummy', MUMMY);

    expect(onFlesh.length).toBeGreaterThan(2);
    expect(onTheMummy.length).toBeGreaterThan(2);
    expect(Math.max(...onFlesh)).toBeGreaterThan(8);
    expect(Math.min(...onTheMummy)).toBeGreaterThanOrEqual(3);
    expect(Math.max(...onTheMummy)).toBeLessThanOrEqual(8);
  });

  /**
   * SRD Critical Hits: "Roll the attack's damage dice twice." A printed line's
   * dice are damage dice, so they double and the modifier the block printed
   * beside them does not.
   *
   * The critical is forced rather than waited for: SRD Paralyzed says "Any
   * attack roll that hits you is a Critical Hit if the attacker is within 5
   * feet", which is a rule the engine already keeps — so every bite that lands
   * here is one.
   */
  it('doubles the printed dice on a critical hit and not the printed modifier', () => {
    const dealt: number[] = [];
    let criticals = 0;

    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
      const table = inTheWoods('wolf', WOLF);
      table.do('Bren is held fast', (s) => applyConditionTo(s, BREN, 'paralyzed', 'a spell'));
      const bite = unwrap(
        resolveAttack(
          table.state,
          WOLF,
          { target: BREN, weapon: null, action: 'Bite', commandId: seed },
          supply(seed),
        ),
        'the bite',
      );
      if (bite.attack?.hit !== true) continue;
      expect(bite.attack.critical).toBe(true);
      criticals += 1;
      dealt.push(bite.damage!);
    }

    expect(criticals).toBeGreaterThan(2);
    // 2d6 + 2, so 4 to 14 — and a spread that reaches past 8 could not have
    // come from the single die an ordinary hit rolls.
    expect(Math.min(...dealt)).toBeGreaterThanOrEqual(4);
    expect(Math.max(...dealt)).toBeLessThanOrEqual(14);
    expect(Math.max(...dealt)).toBeGreaterThan(8);
  });

  /**
   * And whatever the caller brings still rides on top. A bonus is of the
   * attack's own type and extra damage is not — the same two rules a weapon's
   * damage keeps, through the same walk, so the two cannot drift.
   */
  it('carries a bonus of its own type and extra damage of another', () => {
    const table = inTheWoods('wolf', WOLF);
    const bare: number[] = [];
    const laden: number[] = [];

    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l']) {
      const plain = unwrap(
        resolveAttack(
          table.state,
          WOLF,
          { target: BREN, weapon: null, action: 'Bite', commandId: `plain-${seed}` },
          supply(seed),
        ),
        'the bite',
      );
      const blessed = unwrap(
        resolveAttack(
          table.state,
          WOLF,
          {
            target: BREN,
            weapon: null,
            action: 'Bite',
            commandId: `laden-${seed}`,
            damageBonuses: [{ source: 'a curse', flat: 2 }],
            extraDamage: [{ source: 'the moon', type: 'radiant', flat: 3 }],
          },
          supply(seed),
        ),
        'the bite',
      );
      if (plain.attack?.hit !== true) continue;
      bare.push(plain.damage!);
      laden.push(blessed.damage!);
    }

    expect(bare.length).toBeGreaterThan(2);
    for (const [i, amount] of bare.entries()) expect(laden[i]).toBe(amount + 5);
  });
});

describe('Pack Tactics is where the creatures are standing', () => {
  /** A second wolf, placed against the fighter. */
  const withPack = (feet: number): Table => {
    const table = inTheWoods('wolf', WOLF);
    table.did('the other wolf', (s) => addCreature(s, SRD_CONTENT, PACK, 'wolf'));
    table.do('its side', (s) => declareCreatureSide(s, PACK, 'wild'));
    table.do('where it stands', (s) =>
      placeCreatureInScene(s, PACK, { from: { creature: BREN }, feet, bearing: 270 }),
    );
    return table;
  };

  it('gives Advantage while an ally is within 5 feet of the target', () => {
    const table = withPack(5);
    const bite = unwrap(
      resolveAttack(table.state, WOLF, { target: BREN, weapon: null, action: 'Bite' }, supply()),
      'the bite',
    );
    expect(bite.attack?.mode).toBe('advantage');
    expect(bite.attack?.roll.rolls).toHaveLength(2);
  });

  it('gives none when the ally is further off', () => {
    const table = withPack(15);
    const bite = unwrap(
      resolveAttack(table.state, WOLF, { target: BREN, weapon: null, action: 'Bite' }, supply()),
      'the bite',
    );
    expect(bite.attack?.mode).toBe('normal');
    expect(bite.attack?.roll.rolls).toHaveLength(1);
  });

  /**
   * SRD: "…and the ally doesn't have the Incapacitated condition." A wolf
   * standing in the right place and unable to act helps nobody.
   */
  it('gives none when the ally is Incapacitated', () => {
    const table = withPack(5);
    table.do('the other wolf is stunned', (s) =>
      applyConditionTo(s, PACK, 'stunned', 'a spell'),
    );
    const bite = unwrap(
      resolveAttack(table.state, WOLF, { target: BREN, weapon: null, action: 'Bite' }, supply()),
      'the bite',
    );
    expect(bite.attack?.mode).toBe('normal');
  });

  /** It is the creature's trait, not the attack's: a Ghoul gets nothing. */
  it('is read off the creature that has the trait', () => {
    const table = inTheWoods('ghoul', GHOUL);
    table.did('a wolf joins it', (s) => addCreature(s, SRD_CONTENT, PACK, 'wolf'));
    table.do('its side', (s) => declareCreatureSide(s, PACK, 'wild'));
    table.do('where it stands', (s) =>
      placeCreatureInScene(s, PACK, { from: { creature: BREN }, feet: 5, bearing: 270 }),
    );
    const bite = unwrap(
      resolveAttack(table.state, GHOUL, { target: BREN, weapon: null, action: 'Bite' }, supply()),
      'the bite',
    );
    expect(bite.attack?.mode).toBe('normal');
  });
});

/**
 * A stat block's Multiattack is a **named sequence**, and a count carried
 * without its names is a fabrication.
 *
 * "The ghoul makes two Bite attacks" says two things, and the engine used to
 * hold neither: the Attack action held one attack, so the Ghoul could not bite
 * twice at all — and a count on its own would have let it make two Claws
 * instead, which is not a step towards the book but a rule nobody printed.
 *
 * So the sentence is read in `@ie/srd`, the sequence is stated on the sheet
 * beside the printed numbers, and the swings are counted against it per name
 * within the turn. The engine names nothing: what it spends is the structure
 * the block stated.
 */
describe('a Multiattack is a named sequence', () => {
  /** Fold a swing into the table, with one supply so the dice run on. */
  const swinging = (table: Table, who: CharacterId, dice = supply('teeth')) =>
    (action: string, commandId?: string) =>
      table.did(`${who} swings ${action}`, (s) =>
        resolveAttack(
          s,
          who,
          { target: BREN, weapon: null, action, ...(commandId === undefined ? {} : { commandId }) },
          dice,
        ),
      );

  const refused = (table: Table, who: CharacterId, action: string): string => {
    const out = resolveAttack(
      table.state,
      who,
      { target: BREN, weapon: null, action },
      supply('teeth'),
    );
    return isErr(out) ? out.code : 'ok';
  };

  it('states the sequence the block prints, and the economy it adds up to', () => {
    const ghoul = adaptMonster(statBlock('ghoul'), GHOUL);
    expect(ghoul.sheet.stated?.multiattack).toEqual({ entries: [{ count: 2, attack: 'Bite' }] });
    expect(ghoul.sheet.attacksPerAction).toBe(2);

    // Two names, in printed order, and the action holds their sum.
    const ettin = adaptMonster(statBlock('ettin'), id('ettin'));
    expect(ettin.sheet.stated?.multiattack).toEqual({
      entries: [
        { count: 1, attack: 'Battleaxe' },
        { count: 1, attack: 'Morningstar' },
      ],
    });
    expect(ettin.sheet.attacksPerAction).toBe(2);
  });

  /**
   * And a block whose Multiattack says something else states none of it. The
   * Hydra's count reads off a fact nobody has declared, so the engine holds one
   * attack per action for it, exactly as it did before any of this.
   */
  it('states nothing for a block whose sentence nobody could read', () => {
    const hydra = adaptMonster(statBlock('hydra'), id('hydra'));
    expect(hydra.sheet.stated?.multiattack).toBeUndefined();
    expect(hydra.sheet.attacksPerAction).toBeUndefined();

    const wolf = adaptMonster(statBlock('wolf'), WOLF);
    expect(wolf.sheet.stated?.multiattack).toBeUndefined();
  });

  /**
   * And a sequence with one loose end is still dropped whole. The Werebear's
   * line names "Handaxe"; the block prints it under "Handaxe (Humanoid or
   * Hybrid Form Only)", and matching through the qualification would hand a
   * bear a hand axe. A creature owed two swings of which one can never be
   * rolled is worse off than one whose Multiattack stayed prose.
   */
  it('drops a sequence naming a line the block prints only under a qualification', () => {
    const werebear = adaptMonster(statBlock('werebear'), id('werebear'));
    expect(werebear.sheet.stated?.multiattack).toBeUndefined();
    expect(werebear.sheet.attacksPerAction).toBeUndefined();
  });

  it('lets a Ghoul make the two Bites its block prints', () => {
    const table = inTheWoods('ghoul', GHOUL);
    const bite = swinging(table, GHOUL);
    bite('Bite', 'one');
    bite('Bite', 'two');

    const bites = table.events.filter(
      (e) => e.type === 'roll-recorded' && e.label === 'Bite attack',
    );
    expect(bites).toHaveLength(2);
    // One Attack action, two swings inside it.
    expect(table.state.combat?.budgets[GHOUL]?.action).toBe(false);
    expect(table.state.combat?.budgets[GHOUL]?.attacksRemaining).toBe(0);
  });

  /** The fabrication the ruling names: a Ghoul's two attacks are not two Claws. */
  it('refuses the second Claw a count-only Multiattack would have allowed', () => {
    const table = inTheWoods('ghoul', GHOUL);
    // The first is the Ghoul taking its Claw action, which the book prints and
    // this does not touch.
    swinging(table, GHOUL)('Claw', 'one');
    expect(refused(table, GHOUL, 'Claw')).toBe('not_in_multiattack');
  });

  /**
   * And the pair is refused as well as the repeat: a Claw and a Bite is two
   * attacks, and the Ghoul's line prints two Bites.
   */
  it('refuses a Bite after a Claw', () => {
    const table = inTheWoods('ghoul', GHOUL);
    swinging(table, GHOUL)('Claw', 'one');
    expect(refused(table, GHOUL, 'Bite')).toBe('not_in_multiattack');
  });

  it('refuses a third Bite', () => {
    const table = inTheWoods('ghoul', GHOUL);
    const bite = swinging(table, GHOUL);
    bite('Bite', 'one');
    bite('Bite', 'two');
    expect(refused(table, GHOUL, 'Bite')).toBe('not_in_multiattack');
  });

  /**
   * A retry is not a second Bite. The command id is what tells them apart, and
   * a sequence spent by a duplicate would be a creature disarmed by a dropped
   * connection.
   */
  it('counts a repeated command id once', () => {
    const table = inTheWoods('ghoul', GHOUL);
    const bite = swinging(table, GHOUL);
    bite('Bite', 'one');
    bite('Bite', 'one');
    expect(
      table.events.filter((e) => e.type === 'roll-recorded' && e.label === 'Bite attack'),
    ).toHaveLength(1);
    // The second Bite the block prints is still there to be made.
    bite('Bite', 'two');
    expect(
      table.events.filter((e) => e.type === 'roll-recorded' && e.label === 'Bite attack'),
    ).toHaveLength(2);
  });

  /**
   * Outside combat there is no turn to count a sequence against, so nothing
   * holds a swing to it — and that is said out loud, which is the answer
   * Cleave's once-per-turn allowance already gives to the same absence. A rule
   * that checked and a rule that could not look identical from outside.
   */
  it('reports that nothing held the swing to it, where there are no turns', () => {
    const table = new Table();
    table.do('the fighter arrives', () => createCharacter(SRD_CONTENT, walkOn('Bren'), BREN));
    table.did('the ghoul arrives', (s) => addCreature(s, SRD_CONTENT, GHOUL, 'ghoul'));

    const claw = (commandId: string) =>
      table.did('the ghoul claws', (s) =>
        resolveAttack(
          s,
          GHOUL,
          { target: BREN, weapon: null, action: 'Claw', commandId },
          supply('teeth'),
        ),
      );

    const first = unwrap(
      resolveAttack(
        table.state,
        GHOUL,
        { target: BREN, weapon: null, action: 'Claw', commandId: 'one' },
        supply('teeth'),
      ),
      'the claw',
    );
    expect(first.unverified.join(' ')).toContain('no turns here to count one against');

    // And the swing it could not hold to the sequence happens anyway, twice.
    claw('one');
    claw('two');
    expect(
      table.events.filter((e) => e.type === 'roll-recorded' && e.label === 'Claw attack'),
    ).toHaveLength(2);
  });

  /** A creature stating no sequence is where it always was: one swing. */
  it('leaves a creature with no stated sequence exactly as it was', () => {
    const table = inTheWoods('wolf', WOLF);
    swinging(table, WOLF)('Bite', 'one');
    expect(refused(table, WOLF, 'Bite')).toBe('no_attacks_left');
  });

  /**
   * The sequence counts the Attack action's swings and nothing else. An
   * Opportunity Attack is paid for with a Reaction, which is why it is `free`
   * here — and a Ghoul that bit somebody walking past still has its two.
   */
  it('counts nothing against a swing the Attack action did not pay for', () => {
    const table = inTheWoods('ghoul', GHOUL);
    table.did('a free swing', (s) =>
      resolveAttack(
        s,
        GHOUL,
        { target: BREN, weapon: null, action: 'Claw', free: true, commandId: 'free' },
        supply('teeth'),
      ),
    );
    const bite = swinging(table, GHOUL);
    bite('Bite', 'one');
    bite('Bite', 'two');
    expect(
      table.events.filter((e) => e.type === 'roll-recorded' && e.label === 'Bite attack'),
    ).toHaveLength(2);
  });

  /**
   * **A menu is one entry with several names and one shared count.** SRD Merrow:
   * "two attacks, using Bite, Claw, or Harpoon in any combination." The Attack
   * action still holds two swings, the names are still the block's, and what
   * changes is only that either name may fill either slot.
   *
   * The engine never picks. The caller elects swing by swing through the name
   * it asks for, and what is checked is whether the turn's swings so far can be
   * assigned to entries without running past a count.
   */
  it('lets a menu be spent in any combination the block allows', () => {
    const merrow = adaptMonster(statBlock('merrow'), id('merrow'));
    expect(merrow.sheet.stated?.multiattack).toEqual({
      entries: [{ count: 2, attacks: ['Bite', 'Claw', 'Harpoon'] }],
    });
    expect(merrow.sheet.attacksPerAction).toBe(2);

    const table = inTheWoods('merrow', MERROW);
    const swing = swinging(table, MERROW);
    swing('Bite', 'one');
    swing('Claw', 'two');
    expect(
      table.events.filter((e) => e.type === 'roll-recorded' && e.label === 'Bite attack'),
    ).toHaveLength(1);
    expect(
      table.events.filter((e) => e.type === 'roll-recorded' && e.label === 'Claw attack'),
    ).toHaveLength(1);
    // And the count is shared, so the third is refused whichever name it wears.
    expect(refused(table, MERROW, 'Harpoon')).toBe('not_in_multiattack');
    expect(refused(table, MERROW, 'Bite')).toBe('not_in_multiattack');
  });

  /**
   * And the shared count is a count, not three: two Bites is the same two
   * swings as a Bite and a Claw.
   */
  it('refuses a third swing of one name from a shared count', () => {
    const table = inTheWoods('merrow', MERROW);
    const swing = swinging(table, MERROW);
    swing('Bite', 'one');
    swing('Bite', 'two');
    expect(refused(table, MERROW, 'Claw')).toBe('not_in_multiattack');
  });

  /**
   * **An alternation is two whole sequences, and nothing chooses between them.**
   * SRD Barbed Devil: "one Claws attack and one Tail attack, or it makes two
   * Hurl Flame attacks." The branch is settled by the swings already made — a
   * Claws closes the Hurl Flame branch, because that branch admits no Claws at
   * all — so the engine reads the turn rather than asking anybody to elect.
   */
  it('closes the other branch of an alternation with the first swing', () => {
    const devil = adaptMonster(statBlock('barbed-devil'), DEVIL);
    expect(devil.sheet.stated?.multiattack).toEqual({
      alternatives: [
        [
          { count: 1, attack: 'Claws' },
          { count: 1, attack: 'Tail' },
        ],
        [{ count: 2, attack: 'Hurl Flame' }],
      ],
    });
    // Both branches total the same, so the Attack action still holds one number.
    expect(devil.sheet.attacksPerAction).toBe(2);

    const table = inTheWoods('barbed-devil', DEVIL);
    swinging(table, DEVIL)('Claws', 'one');
    expect(refused(table, DEVIL, 'Hurl Flame')).toBe('not_in_multiattack');
    // The branch it did take is still open.
    swinging(table, DEVIL)('Tail', 'two');
    expect(
      table.events.filter((e) => e.type === 'roll-recorded' && e.label === 'Tail attack'),
    ).toHaveLength(1);
  });

  it('lets the other branch be taken whole, when it is the one begun', () => {
    const table = inTheWoods('barbed-devil', DEVIL);
    const hurl = swinging(table, DEVIL);
    hurl('Hurl Flame', 'one');
    hurl('Hurl Flame', 'two');
    expect(
      table.events.filter((e) => e.type === 'roll-recorded' && e.label === 'Hurl Flame attack'),
    ).toHaveLength(2);
    expect(refused(table, DEVIL, 'Claws')).toBe('not_in_multiattack');
  });

  /**
   * **What the line says that the engine cannot execute is handed over, not
   * enforced.** SRD Mummy: "makes two Rotting Fist attacks **and uses Dreadful
   * Glare**." A use is a save or a prose action, and there is nothing here to
   * spend — making fewer swings than a sequence prints has always been legal.
   *
   * So it is reported through the channel a hit's printed rider already uses,
   * once, at the swing that opens the action: a permission silently dropped is
   * a creature made weaker than the book, and a permission repeated at every
   * swing is noise.
   */
  it('reports what the line hands over, at the swing that opens the action', () => {
    const mummy = adaptMonster(statBlock('mummy'), MUMMY);
    expect(mummy.sheet.stated?.multiattack).toEqual({
      entries: [{ count: 2, attack: 'Rotting Fist' }],
      handOver: 'and uses Dreadful Glare',
    });

    const table = inTheWoods('mummy', MUMMY);
    const first = unwrap(
      resolveAttack(
        table.state,
        MUMMY,
        { target: BREN, weapon: null, action: 'Rotting Fist', commandId: 'one' },
        supply('linen'),
      ),
      'the first fist',
    );
    expect(first.unverified.join(' ')).toContain('and uses Dreadful Glare');

    // And once: the second swing of the same action says nothing about it.
    const fist = swinging(table, MUMMY, supply('linen'));
    fist('Rotting Fist', 'one');
    const second = unwrap(
      resolveAttack(
        table.state,
        MUMMY,
        { target: BREN, weapon: null, action: 'Rotting Fist', commandId: 'two' },
        supply('linen'),
      ),
      'the second fist',
    );
    expect(second.unverified.join(' ')).not.toContain('Dreadful Glare');
  });

  /**
   * **A sequence pinned before any of this still reads.** `creature-added` pins
   * what the command found in content, so a Ghoul that entered a game this
   * morning carries `{ entries: [{ count, attack }] }` and always will. Every
   * field the shape has grown since is optional, and the readers take the old
   * value as the one-name, one-sequence case it is.
   */
  it('reads a sequence pinned in the shape that predates the menu', () => {
    const pinned: MonsterMultiattack = { entries: [{ count: 2, attack: 'Bite' }] };
    expect(multiattackAllows(pinned, { Bite: 2 })).toBe(true);
    expect(multiattackAllows(pinned, { Bite: 3 })).toBe(false);
    expect(multiattackAllows(pinned, { Bite: 1, Claw: 1 })).toBe(false);
    // Which is exactly what the Ghoul's own block still pins.
    expect(adaptMonster(statBlock('ghoul'), GHOUL).sheet.stated?.multiattack).toEqual(pinned);
  });
});

/**
 * What a monster swings when somebody walks out of its reach.
 *
 * SRD: "take a Reaction to make one melee attack with a weapon or an Unarmed
 * Strike against the provoking creature." A Wolf has no weapon, so the swing
 * came out as an Unarmed Strike at Strength plus proficiency — a number the
 * engine invented, against a block that prints a Bite.
 *
 * So the default is **the creature's best printed melee attack**: the highest
 * summed printed average, among the lines that are melee and do not recharge,
 * ties to the first printed. Every part of that is read off the block. A
 * caller who wants another names it.
 */
describe('a monster’s Opportunity Attack takes its printed line', () => {
  /** The monster beside Bren, and Bren's turn to walk away. */
  const cornered = (monster: string, who: CharacterId): Table => {
    const table = inTheWoods(monster, who);
    table.did('the monster waits', (s) => resolveTurn(s, supply('turn')));
    return table;
  };

  const walksAway = (table: Table): GameState =>
    table.did('Bren steps back', (s) =>
      resolveMove(
        s,
        BREN,
        { placement: { from: { landmark: 'the stump' }, feet: 15, bearing: 270 } },
        supply('walk'),
      ),
    );

  const answered = (
    table: Table,
    who: CharacterId,
    command: { readonly action?: string } = {},
    seed = 'swing',
  ) => unwrap(takeOpportunityAttack(table.state, who, command, supply(seed)), 'the swing');

  it('reaches for the Bite the block prints, at the numbers it prints', () => {
    const table = cornered('wolf', WOLF);
    walksAway(table);
    // A seed the Bite lands on: an Opportunity Attack takes no forced bonus,
    // so which way it goes is a fact about the dice.
    const struck = answered(table, WOLF, {}, 'd');

    // The block's +4, not a Strength modifier and a Proficiency Bonus.
    expect(struck.attack?.roll.modifier).toBe(4);
    const rolled = struck.events.find((e) => e.type === 'roll-recorded');
    expect(rolled?.type === 'roll-recorded' ? rolled.label : null).toBe('Bite attack');

    // And the damage is the Bite's own 1d6 + 2, landed under the name the
    // block prints — where a fist would have dealt a flat 1 plus Strength
    // under no name at all.
    expect(struck.attack?.hit).toBe(true);
    const taken = struck.events.find((e) => e.type === 'damage-taken');
    expect(taken?.type === 'damage-taken' ? taken.source : null).toBe('Bite');
    expect(struck.damage).toBeGreaterThanOrEqual(3);
    expect(struck.damage).toBeLessThanOrEqual(8);
  });

  /**
   * SRD's Opportunity Attack is **one melee attack**, so a ranged line does not
   * win it however hard it hits. A Barbed Devil's Hurl Flame averages more than
   * its Tail and reaches across the room; the Tail is what swings at somebody
   * stepping away from it.
   */
  it('never reaches for a ranged line, however much harder it hits', () => {
    const devil = adaptMonster(statBlock('barbed-devil'), id('devil'));
    const printed = (name: string) =>
      (printedAttackOf(devil.sheet, name)?.damage ?? []).reduce((sum, d) => sum + d.average, 0);
    expect(printed('Hurl Flame')).toBeGreaterThan(printed('Tail'));

    const table = cornered('barbed-devil', id('devil'));
    walksAway(table);
    const struck = answered(table, id('devil'));
    const rolled = struck.events.find((e) => e.type === 'roll-recorded');
    expect(rolled?.type === 'roll-recorded' ? rolled.label : null).toBe('Tail attack');
  });

  /** Two lines that hit for the same: the one the book printed first. */
  it('breaks a tie towards the first line printed', () => {
    const ettin = adaptMonster(statBlock('ettin'), id('ettin'));
    const printed = (name: string) =>
      (printedAttackOf(ettin.sheet, name)?.damage ?? []).reduce((sum, d) => sum + d.average, 0);
    expect(printed('Battleaxe')).toBe(printed('Morningstar'));

    const table = cornered('ettin', id('ettin'));
    walksAway(table);
    const struck = answered(table, id('ettin'));
    const rolled = struck.events.find((e) => e.type === 'roll-recorded');
    expect(rolled?.type === 'roll-recorded' ? rolled.label : null).toBe('Battleaxe attack');
  });

  /**
   * A line that is not available every round is not what a creature reaches
   * for when it is provoked.
   *
   * **Stated over a block that prints one**, because the SRD prints no melee
   * attack on a recharge that outranks its creature's ordinary swing — the
   * Minotaur's Gore recharges and its Abyssal Glaive hits harder anyway — and
   * a rule checked only against a population that cannot exercise it is a rule
   * nobody has checked.
   */
  it('passes over a printed attack that recharges', () => {
    const sheet: CharacterSheet = {
      ...adaptMonster(statBlock('wolf'), WOLF).sheet,
      stated: {
        attacks: [
          {
            name: 'Gouge',
            kind: 'melee',
            modifier: 5,
            reach: 5,
            range: null,
            damage: [{ dice: '2d6', flat: 3, type: 'slashing', average: 10 }],
            qualification: null,
            rider: null,
            recharge: { kind: 'die', low: 5 },
          },
          {
            name: 'Nip',
            kind: 'melee',
            modifier: 5,
            reach: 5,
            range: null,
            damage: [{ dice: '1d4', flat: 1, type: 'piercing', average: 3 }],
            qualification: null,
            rider: null,
          },
        ],
      },
    };

    expect(bestPrintedMeleeAttack(sheet)?.name).toBe('Nip');
  });

  /** And a caller who wants the other line says so. */
  it('takes the attack a caller names instead', () => {
    const table = cornered('barbed-devil', id('devil'));
    walksAway(table);
    const struck = answered(table, id('devil'), { action: 'Claws' });
    const rolled = struck.events.find((e) => e.type === 'roll-recorded');
    expect(rolled?.type === 'roll-recorded' ? rolled.label : null).toBe('Claws attack');
  });

  /**
   * A swing whose numbers come from two places is refused here exactly as it
   * is refused at the Attack action: the default fills in what nobody said and
   * decides nothing anybody did say.
   */
  it('refuses a Reaction that names both a weapon and a printed line', () => {
    const table = cornered('ogre', OGRE);
    walksAway(table);
    const both = takeOpportunityAttack(
      table.state,
      OGRE,
      { weapon: 'greatclub', action: 'Javelin' },
      supply('swing'),
    );
    expect(isErr(both) ? both.code : 'ok').toBe('two_attacks');
  });

  /**
   * A character prints no lines at all, so nothing about them changes: there is
   * no default to reach for, and the swing is the Unarmed Strike it always was.
   */
  it('leaves a creature with no printed attack where it was', () => {
    const table = cornered('wolf', WOLF);
    const bren = table.state.creatures[BREN];
    expect(bren?.sheet.stated?.attacks).toBeUndefined();
    expect(bestPrintedMeleeAttack(bren!.sheet)).toBeNull();
  });
});

/**
 * What a stat block prints under **Bonus Actions**.
 *
 * Seventy-five lines in the SRD and not one of them prints an attack roll:
 * they cast a spell, force a saving throw, take another action, move,
 * shape-shift, teleport, or are prose. So there was never a sentence here for
 * a parser to read — what was missing is an economy to spend one against, and
 * a record of which line was spent, which is what a Multiattack gated on one
 * has to read.
 *
 * The engine executes none of them. It spends the Bonus Action, writes down
 * which line was taken, and hands the sentence back the way a Multiattack's
 * `handOver` clause is already handed back.
 */
describe('a Bonus Action a stat block prints', () => {
  const taking = (table: Table, who: CharacterId, line: string, commandId?: string) =>
    takeStatedBonusAction(table.state, who, {
      line,
      ...(commandId === undefined ? {} : { commandId }),
    });

  const usedBy = (state: GameState, who: CharacterId): readonly string[] =>
    statedBonusActionsUsed(
      state.combat?.budgets[who]?.featureUsedOnTurn ?? {},
      state.combat?.turnsTaken ?? 0,
    );

  it('carries the section onto the sheet, by the name and the sentence', () => {
    const goblin = adaptMonster(statBlock('goblin-warrior'), GOBLIN);
    expect(goblin.sheet.stated?.bonusActions).toEqual([
      { name: 'Nimble Escape', text: 'The goblin takes the Disengage or Hide action.' },
    ]);

    // A block that prints none carries no field saying so, which is the
    // reading every optional field on the sheet takes — and a character
    // prints none either.
    expect(adaptMonster(statBlock('wolf'), WOLF).sheet.stated?.bonusActions).toBeUndefined();
  });

  it('spends the creature’s Bonus Action and records which line it was', () => {
    const table = inTheWoods('goblin-warrior', GOBLIN);
    table.did('the goblin slips away', (s) =>
      takeStatedBonusAction(s, GOBLIN, { line: 'Nimble Escape', commandId: 'escape' }),
    );

    const state = table.state;
    expect(state.combat?.budgets[GOBLIN]?.bonusAction).toBe(false);
    expect(usedBy(state, GOBLIN)).toEqual(['Nimble Escape']);

    // And the log says which line, by the name the block prints it under.
    const taken = table.events.filter((e) => e.type === 'stated-bonus-action-taken');
    expect(taken).toHaveLength(1);
    expect(taken[0]?.type === 'stated-bonus-action-taken' ? taken[0].line : null).toBe(
      'Nimble Escape',
    );
  });

  /**
   * **The sentence is handed over rather than executed.** The goblin's line
   * says it takes the Disengage or Hide action; nothing here takes either, and
   * a caller told that the Bonus Action was spent and nothing else would have
   * been told the creature did something it did not.
   */
  it('reports the sentence, because the engine applies none of it', () => {
    const table = inTheWoods('goblin-warrior', GOBLIN);
    const out = unwrap(taking(table, GOBLIN, 'Nimble Escape', 'escape'), 'the escape');
    expect(out.unverified.join(' ')).toContain('The goblin takes the Disengage or Hide action.');

    // And it really did not take one: the Disengage a DM applies is not here.
    expect(out.events.map((e) => e.type)).toEqual([
      'bonus-action-spent',
      'stated-bonus-action-taken',
    ]);
  });

  /** SRD: "You can't take more than one Bonus Action on a turn." */
  it('refuses a second line in the same turn', () => {
    const table = inTheWoods('clay-golem', GOLEM);
    table.did('the golem hastens', (s) =>
      takeStatedBonusAction(s, GOLEM, { line: HASTEN, commandId: 'one' }),
    );
    const again = taking(table, GOLEM, HASTEN, 'two');
    expect(isErr(again) ? again.code : 'ok').toBe('no_bonus_action');
  });

  it('refuses a line the block does not print', () => {
    const table = inTheWoods('goblin-warrior', GOBLIN);
    const out = taking(table, GOBLIN, HASTEN, 'wrong');
    expect(isErr(out) ? out.code : 'ok').toBe('no_such_line');
  });

  /** A retry is not a second Bonus Action. */
  it('counts a repeated command id once', () => {
    const table = inTheWoods('goblin-warrior', GOBLIN);
    table.did('the goblin slips away', (s) =>
      takeStatedBonusAction(s, GOBLIN, { line: 'Nimble Escape', commandId: 'escape' }),
    );
    const retry = unwrap(taking(table, GOBLIN, 'Nimble Escape', 'escape'), 'the retry');
    expect(retry.events).toEqual([]);
    expect(retry.duplicate).toBe(true);
    expect(table.events.filter((e) => e.type === 'stated-bonus-action-taken')).toHaveLength(1);
  });

  /**
   * **A log with none of this in it folds exactly as it did.** The event is
   * additive and optional, and a creature that never took a printed Bonus
   * Action has nothing in the ledger to show for it.
   */
  it('leaves a turn nobody spent one on exactly where it was', () => {
    const table = inTheWoods('goblin-warrior', GOBLIN);
    expect(usedBy(table.state, GOBLIN)).toEqual([]);
    expect(table.state.combat?.budgets[GOBLIN]?.bonusAction).toBe(true);
  });
});

/**
 * **A branch the block gates on one of those lines.**
 *
 * SRD Clay Golem: "The golem makes two Slam attacks, or it makes three Slam
 * attacks **if it used Hasten this turn**." The sentence went unread for as
 * long as nothing could evaluate the clause, and the reason is arithmetic: the
 * Attack action's size is the largest branch it is offered, so a gated branch
 * read with nothing to gate it hands the golem three Slams every turn — an
 * attack the book gates, given away free.
 *
 * So the size of the action is the largest branch the creature is **offered
 * right now**: two on an ordinary turn, three on a turn it took the line. The
 * sheet pins the unconditional reading, and the gate is read off the ledger by
 * the swing that spends the action and by the fold that re-spends it, which
 * are the same question asked with the same inputs.
 */
describe('a Multiattack branch gated on a printed Bonus Action', () => {
  const GATED: MonsterMultiattack = {
    alternatives: [
      [{ count: 2, attack: 'Slam' }],
      {
        entries: [{ count: 3, attack: 'Slam' }],
        requires: { usedBonusAction: HASTEN },
      },
    ],
  };

  const swinging = (table: Table, who: CharacterId, dice = supply('clay')) =>
    (action: string, commandId?: string) =>
      table.did(`${who} swings ${action}`, (s) =>
        resolveAttack(
          s,
          who,
          { target: BREN, weapon: null, action, ...(commandId === undefined ? {} : { commandId }) },
          dice,
        ),
      );

  const refused = (table: Table, who: CharacterId, action: string): string => {
    const out = resolveAttack(table.state, who, { target: BREN, weapon: null, action }, supply('clay'));
    return isErr(out) ? out.code : 'ok';
  };

  const hasten = (table: Table) =>
    table.did('the golem hastens', (s) =>
      takeStatedBonusAction(s, GOLEM, { line: HASTEN, commandId: 'hasten' }),
    );

  it('states the alternation the block prints, gate and all', () => {
    const golem = adaptMonster(statBlock('clay-golem'), GOLEM);
    expect(golem.sheet.stated?.multiattack).toEqual(GATED);
  });

  /**
   * **The number pinned onto the sheet is the unconditional one.** It is read
   * at the moment the creature arrives, when nothing has been spent and no turn
   * has begun, so a maximum taken over the gated branch there would be the free
   * third Slam written onto the creature for the rest of the game.
   */
  it('pins the action at the size the gate does not buy', () => {
    expect(adaptMonster(statBlock('clay-golem'), GOLEM).sheet.attacksPerAction).toBe(2);
  });

  /** The failure mode this exists to prevent: two Slams, when nothing was spent. */
  it('holds the Attack action to two Slams on a turn with no Hasten in it', () => {
    const table = inTheWoods('clay-golem', GOLEM);
    const slam = swinging(table, GOLEM);
    slam('Slam', 'one');
    slam('Slam', 'two');
    expect(table.state.combat?.budgets[GOLEM]?.attacksRemaining).toBe(0);
    expect(refused(table, GOLEM, 'Slam')).toBe('not_in_multiattack');
  });

  it('holds it to three on a turn the golem took the line', () => {
    const table = inTheWoods('clay-golem', GOLEM);
    hasten(table);
    const slam = swinging(table, GOLEM);
    slam('Slam', 'one');
    expect(table.state.combat?.budgets[GOLEM]?.attacksRemaining).toBe(2);
    slam('Slam', 'two');
    slam('Slam', 'three');
    expect(
      table.events.filter((e) => e.type === 'roll-recorded' && e.label === 'Slam attack'),
    ).toHaveLength(3);
    // And no more than three: the branch the gate opened is a ceiling too.
    expect(refused(table, GOLEM, 'Slam')).toBe('not_in_multiattack');
  });

  /**
   * And the gate reads the line's own name off the ledger. A creature that
   * spent its Bonus Action on something else has not opened it — which is what
   * makes this a gate rather than a second reading of the Bonus Action budget.
   */
  it('is opened by that line and by nothing else', () => {
    expect(multiattackAllows(GATED, { Slam: 3 }, [])).toBe(false);
    expect(multiattackAllows(GATED, { Slam: 3 }, ['Nimble Escape'])).toBe(false);
    expect(multiattackAllows(GATED, { Slam: 3 }, [HASTEN])).toBe(true);
    // The ungated branch is offered either way.
    expect(multiattackAllows(GATED, { Slam: 2 }, [])).toBe(true);
    expect(multiattackAllows(GATED, { Slam: 2 }, [HASTEN])).toBe(true);
  });

  /**
   * And the refusal quotes the whole sentence back, gate included, because a
   * caller told only "three Slams is not what is left of it" would not know
   * there was a way to have three.
   */
  it('says what the gated branch requires when it refuses', () => {
    const table = inTheWoods('clay-golem', GOLEM);
    const slam = swinging(table, GOLEM);
    slam('Slam', 'one');
    slam('Slam', 'two');
    const out = resolveAttack(
      table.state,
      GOLEM,
      { target: BREN, weapon: null, action: 'Slam' },
      supply('clay'),
    );
    expect(isErr(out) ? out.reason : '').toContain(HASTEN);
  });
});
