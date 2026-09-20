import { SRD_CONTENT } from '@ie/content';
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
  setScene,
  addSceneLandmark,
} from './commands.js';
import { createRng, type Rng } from './dice.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { adaptMonster, printedAttackOf } from './monster.js';
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
