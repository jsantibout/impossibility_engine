import { SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import { asCharacterId, type CharacterId, expect as unwrap, type Result } from '@ie/shared';
import {
  addCreature,
  beginCombat,
  declareCreatureSide,
  placeCreatureInScene,
  resolveAttack,
  resolveTurn,
  setScene,
  addSceneLandmark,
  settleDamage,
  takeDamageReaction,
} from './commands.js';
import { createRng, type Rng } from './dice.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { readPrintedRider } from './monster.js';
import { createRollIssuer } from './rolls.js';
import { createCharacter, type CharacterChoices } from './creation.js';

/**
 * **What a stat block says a hit does**, for the clauses the engine can read.
 *
 * A 2024 attack line is a template up to the damage and English after it:
 * "_Hit:_ 7 (2d4 + 2) Piercing damage. **If the target is a Medium or smaller
 * creature, it has the Prone condition.**" The numbers before the rider have
 * been the engine's since the bestiary landed; the sentence after it was
 * carried verbatim and handed to the DM, which is honest and makes every
 * creature that prints one weaker than the book.
 *
 * Two shapes are read here, and they are read because the engine already has
 * every part of what they ask for:
 *
 * - **a condition the hit imposes**, gated on the target's size where the book
 *   gates it — the Wolf's Prone, the Earth Elemental's, the Tiger's;
 * - **a condition that lasts until a moment in the attacker's next turn** —
 *   the Ettercap's Poisoned, the Sprite's Charmed.
 *
 * Nothing new executes them. What a hit buys is `HitOption`, the effect list
 * SRD Stunning Strike already rides on, and a printed rider is one built off
 * the line rather than off a sheet: the same `runEffects`, the same deadline
 * filed by `fileDeadlines`, and — the rule the owner fixed on 2026-09-20 — the
 * same hold, so **the defender answers first**.
 *
 * Every other rider in the book is still prose, still reported, and still the
 * DM's. `readPrintedRider` returns null for it rather than guessing, which is
 * what the sweep at the bottom of this file holds over the whole bestiary.
 */

const id = (s: string) => asCharacterId(s);
const BREN = id('bren');
const WOLF = id('wolf');
const ETTERCAP = id('ettercap');
const GHOUL = id('ghoul');
const OGRE = id('ogre');

const supply = (seed = 'fangs') => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

/** A level 1 Fighter, Medium, for the wolves to bite. */
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

/** A level 5 Rogue, who can answer a damage roll with Uncanny Dodge. */
const rogue = (): CharacterChoices => ({
  ...walkOn('Bren'),
  classId: 'rogue',
  level: 5,
  subclassId: 'thief',
  classSkills: ['stealth', 'sleight-of-hand', 'acrobatics', 'investigation'],
  equipped: [],
  featureChoices: {
    'human:skillful': ['perception'],
    'rogue:expertise': ['stealth', 'sleight-of-hand'],
  },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int',
      cantrips: ['mage-hand', 'light'],
      levelOneSpell: 'ray-of-sickness',
    },
    'human:versatile': { featId: 'alert' },
    'rogue:ability-score-improvement': { featId: 'savage-attacker' },
  },
});

/** A log built only out of what the engine produced. */
class Table {
  readonly log: GameEvent[] = [];

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

/**
 * A fighter with a monster beside him, everybody placed and the order rolled.
 *
 * The monster goes first, because a rider anchored on "the start of its next
 * turn" is only observable from a turn that has not happened yet.
 */
const inTheWoods = (monster: string, who: CharacterId, victim = walkOn('Bren')): Table => {
  const table = new Table();
  table.do('the fighter arrives', () => createCharacter(SRD_CONTENT, victim, BREN));
  table.did('the monster arrives', (s) => addCreature(s, SRD_CONTENT, who, monster));
  table.do('the clearing', (s) => setScene(s, { width: 60, depth: 40, height: 20 }));
  table.do('the stump', (s) => addSceneLandmark(s, 'the stump', { x: 20, y: 20, z: 0 }));
  table.do('Bren by the stump', (s) =>
    placeCreatureInScene(s, BREN, { from: { landmark: 'the stump' }, feet: 0 }),
  );
  table.do('the monster beside him', (s) =>
    placeCreatureInScene(s, who, { from: { creature: BREN }, feet: 5, bearing: 90 }),
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

/** Bite, with the attack roll forced to land: a miss answers nothing here. */
const bite = (table: Table, who: CharacterId, action: string, target = BREN, seed = 'fangs') => {
  const out = unwrap(
    resolveAttack(
      table.state,
      who,
      {
        target,
        weapon: null,
        action,
        attackBonuses: [{ source: 'forced', flat: 40 }],
      },
      supply(seed),
    ),
    'the bite',
  );
  const log = [...table.log, ...out.events];
  return { ...out, log, state: fold('fangs', log) };
};

const conditionsOn = (state: GameState, who: CharacterId): readonly string[] =>
  state.creatures[who]?.conditions.conditions ?? [];

// — the Wolf's Prone ——————————————————————————————————————————————————————————

describe('a condition the line prints, gated on the target’s size', () => {
  /**
   * SRD Wolf, Bite: "_Hit:_ 5 (1d6 + 2) Piercing damage. If the target is a
   * Medium or smaller creature, it has the Prone condition."
   *
   * The Bite's numbers were already the engine's. This is the sentence after
   * them, and it is the single most printed rider in the book.
   */
  it('knocks a Medium creature Prone', () => {
    const out = bite(inTheWoods('wolf', WOLF), WOLF, 'Bite');

    expect(out.attack?.hit).toBe(true);
    expect(conditionsOn(out.state, BREN)).toContain('prone');
  });

  /**
   * **And says nothing about it**, because there is nothing left over. A
   * printed rider the engine executes is not an unapplied rule, so the clause
   * the DM used to be handed goes away — which is the whole of what "freed"
   * means for a stat block.
   */
  it('stops handing the line to the DM once it executes it', () => {
    const out = bite(inTheWoods('wolf', WOLF), WOLF, 'Bite');

    expect(out.unverified.join(' ')).not.toContain('the engine does not apply that');
  });

  /**
   * The gate is the book's and it is evaluated rather than assumed: an Ogre is
   * Large, and a Wolf's sentence stops at Medium. Nothing is refused — the
   * Bite landed and dealt its damage — and the clause that did not fire says
   * so, the answer Push's mastery property already gives to the same sentence.
   */
  it('leaves a creature the sentence does not reach standing', () => {
    const table = inTheWoods('wolf', WOLF);
    table.did('an ogre wanders in', (s) => addCreature(s, SRD_CONTENT, OGRE, 'ogre'));
    table.do('the ogre beside the wolf', (s) =>
      placeCreatureInScene(s, OGRE, { from: { creature: WOLF }, feet: 5, bearing: 0 }),
    );

    const out = bite(table, WOLF, 'Bite', OGRE);

    expect(out.attack?.hit).toBe(true);
    expect(conditionsOn(out.state, OGRE)).not.toContain('prone');
    expect(out.unverified.join(' ')).toContain('large');
  });
});

// — a condition with the attacker's own deadline ——————————————————————————————

describe('a condition that lasts until a moment in the attacker’s next turn', () => {
  /**
   * SRD Ettercap, Bite: "_Hit:_ 5 (1d6 + 2) Piercing damage, and the target
   * has the Poisoned condition until the start of the ettercap's next turn."
   *
   * "The ettercap's" is the attacker's, which is the anchor `HitOption.lasts`
   * already names — so the deadline is filed by `fileDeadlines` exactly as
   * Stunning Strike's is, and lifts at the boundary the clock raises.
   */
  it('poisons the target and lifts it at the attacker’s next turn', () => {
    const table = inTheWoods('ettercap', ETTERCAP);
    const out = bite(table, ETTERCAP, 'Bite');
    expect(conditionsOn(out.state, BREN)).toContain('poisoned');

    // Round the order: the ettercap ends its turn, Bren takes one, and the
    // ettercap's next turn begins — which is the moment the book names.
    const log = [...out.log];
    const turn = (step: string) => {
      const done = unwrap(resolveTurn(fold('fangs', log), supply(), { commandId: step }), step);
      log.push(...done.events);
    };
    turn('the ettercap’s turn ends');
    turn('Bren’s turn ends');

    expect(conditionsOn(fold('fangs', log), BREN)).not.toContain('poisoned');
  });
});

// — the defender answers first ————————————————————————————————————————————————

describe('the defender answers first', () => {
  /**
   * The owner's ruling of 2026-09-20, on the rider a stat block prints rather
   * than the one a feature buys: a blow that opens a Reaction window must not
   * close it with what the same blow bought. SRD Uncanny Dodge is "when an
   * attack hits you"; a Wolf that knocked its target Prone before the Rogue
   * could answer would be taking a Reaction away with a rule that has no such
   * sentence in it.
   */
  const withARogue = () => inTheWoods('wolf', WOLF, rogue());

  it('offers the window, and knocks nobody down yet', () => {
    const out = bite(withARogue(), WOLF, 'Bite');

    expect(out.reactions?.length).toBeGreaterThan(0);
    expect(out.state.pendingDamage).not.toBeNull();
    expect(conditionsOn(out.state, BREN)).not.toContain('prone');
  });

  it('pins the printed rider onto the hold the damage opened', () => {
    const out = bite(withARogue(), WOLF, 'Bite');

    expect(out.state.pendingDamage?.rider?.attacker).toBe(WOLF);
  });

  it('lands it once the settlement closes the window', () => {
    const out = bite(withARogue(), WOLF, 'Bite');
    const settled = unwrap(settleDamage(out.state, supply('settle')), 'the settlement');
    const after = fold('fangs', [...out.log, ...settled.events]);

    expect(after.pendingDamage).toBeNull();
    expect(conditionsOn(after, BREN)).toContain('prone');
  });

  it('lands it after the Reaction the defender actually took', () => {
    const out = bite(withARogue(), WOLF, 'Bite');
    const feature = out.reactions![0]!.feature;
    const dodged = unwrap(
      takeDamageReaction(out.state, BREN, { feature }, supply('dodge')),
      'the dodge',
    );
    const answered = [...out.log, ...dodged.events];
    // SRD Uncanny Dodge: "halve the attack's damage against you" — taken, and
    // the blow is still standing open with the rider it owes.
    expect(fold('fangs', answered).pendingDamage?.reductions).toHaveLength(1);
    expect(conditionsOn(fold('fangs', answered), BREN)).not.toContain('prone');

    const settled = unwrap(settleDamage(fold('fangs', answered), supply('settle')), 'the settlement');
    const after = fold('fangs', [...answered, ...settled.events]);

    expect(after.pendingDamage).toBeNull();
    expect(conditionsOn(after, BREN)).toContain('prone');
  });
});

// — what is still the DM's ————————————————————————————————————————————————————

describe('every other rider is still prose, and still reported', () => {
  /**
   * SRD Ghoul, Claw: "If the target is a creature that isn't an Undead or elf,
   * it is subjected to the following effect. _Constitution Saving Throw:_ DC
   * 10. _Failure:_ The target has the Paralyzed condition until the end of its
   * next turn."
   *
   * A printed saving throw with a printed DC, and the DC has nowhere to ride:
   * `HitOption` derives its save DC from the holder's sheet, which is the
   * right answer for a class feature and the wrong one for a number the book
   * states. So the line is left where it was — carried whole, reported at the
   * hit, and applied by a DM — rather than executed at a DC the engine made up.
   */
  it('hands the Ghoul’s printed saving throw to the DM, unchanged', () => {
    const out = bite(inTheWoods('ghoul', GHOUL), GHOUL, 'Claw');

    expect(conditionsOn(out.state, BREN)).not.toContain('paralyzed');
    expect(out.unverified.join(' ')).toContain('the engine does not apply that');
  });
});

// — the parser, over the book ————————————————————————————————————————————————

describe('the reader claims only the sentences it can execute', () => {
  it('reads the two shapes, in the book’s own words', () => {
    expect(
      readPrintedRider('If the target is a Medium or smaller creature, it has the Prone condition.'),
    ).toEqual({ kind: 'condition', conditions: ['prone'], ifNoLargerThan: 'medium' });

    expect(
      readPrintedRider(
        'and the target has the Poisoned condition until the start of the ettercap’s next turn.',
      ),
    ).toEqual({ kind: 'condition', conditions: ['poisoned'], lasts: 'start-of-next-turn' });

    expect(
      readPrintedRider(
        'and the target has the Blinded and Deafened conditions until the end of the giant’s next turn.',
      ),
    ).toEqual({
      kind: 'condition',
      conditions: ['blinded', 'deafened'],
      lasts: 'end-of-next-turn',
    });
  });

  /**
   * **Null is the answer to everything else**, and that is the guard rather
   * than a gap. A near-miss on one of these sentences is a creature given a
   * rule the book did not print — the failure the verbatim string was carried
   * to avoid — so the four below are refused by name: a save whose DC has
   * nowhere to ride, a grapple whose escape DC the escape command could not
   * find, a deadline anchored on the *target's* turn, and a clause gated on a
   * movement nobody has declared.
   */
  it('refuses the sentences whose mechanism it does not have', () => {
    for (const text of [
      'If the target is a creature that isn’t an Undead or elf, it is subjected to the following effect. _Constitution Saving Throw:_ DC 10. _Failure:_ The target has the Paralyzed condition until the end of its next turn.',
      'If the target is a Large or smaller creature, it has the Grappled condition (escape DC 13).',
      'and the target has the Poisoned condition until the end of its next turn.',
      'If the target is a Large or smaller creature and the elk moved 20+ feet straight toward it immediately before the hit, the target has the Prone condition.',
      'or 2 (1d4) Piercing damage if the swarm is Bloodied.',
      'Being underwater doesn’t grant Resistance to this Fire damage.',
    ]) {
      expect(readPrintedRider(text), text).toBeNull();
    }
  });

  /**
   * And the population it moves, read off the book rather than claimed: a
   * sweep over an empty set is a green test that checks nothing, and a floor
   * here is what fails the day a parser change quietly stops reading a line it
   * used to read.
   */
  it('reads a printed rider on a real and countable part of the bestiary', () => {
    let read = 0;
    let carried = 0;
    for (const monster of SRD_CONTENT.monsters) {
      for (const line of monster.actions) {
        const rider = line.attack?.rider;
        if (rider == null) continue;
        carried += 1;
        if (readPrintedRider(rider) !== null) read += 1;
      }
    }

    expect(carried).toBeGreaterThan(100);
    expect(read).toBeGreaterThanOrEqual(29);
  });
});
