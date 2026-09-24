import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, type CharacterId, expect as unwrap, type Result } from '@ie/shared';
import {
  addCreature,
  addSceneLandmark,
  beginCombat,
  declareCreatureSide,
  escapeGrapple,
  joinCombat,
  placeCreatureInScene,
  resolveAttack,
  resolveMove,
  resolveTurn,
  setScene,
} from './commands.js';
import { createCharacter, type CharacterChoices } from './creation.js';
import { createRng, type Rng } from './dice.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { readPrintedRider, readPrintedRiders } from './monster.js';
import { distanceBetween } from './positioning.js';
import { createRollIssuer } from './rolls.js';
import { speedOf } from './standing.js';
import { healingRuleOf } from './vitals.js';

/**
 * **What a stat block's hit does, read as a sequence rather than as one shape.**
 *
 * `readPrintedRider` read a whole rider against one pattern and answered null
 * for anything else, so a line that said two things — the Swarm of Crawling
 * Claws' smaller bite *and* its Prone, the Crocodile's grapple *and* the
 * Restrained that goes with it — was handed to the DM entire, including the
 * half the engine had been executing for a year on lines that printed it
 * alone. This is the other reader: clause by clause, each matched against the
 * shapes it knows, **and the rest carried back verbatim** — exactly what
 * `parsePrintedSave` does with its own `handedOver`.
 *
 * The residue is the point of the pair. A line the engine reads three quarters
 * of is not a line it has paid for, and `RIDER_HANDOVER_SHAPE` in the content
 * scripts counts it as unpaid for that reason.
 */
describe('reading a printed rider as a sequence', () => {
  it('reads a single-shape line exactly as the one-shape reader always did', () => {
    const text = 'If the target is a Medium or smaller creature, it has the Prone condition.';
    expect(readPrintedRiders(text)).toEqual({
      riders: [{ kind: 'condition', conditions: ['prone'], ifNoLargerThan: 'medium' }],
      handedOver: [],
    });
    expect(readPrintedRider(text)).toEqual({
      kind: 'condition',
      conditions: ['prone'],
      ifNoLargerThan: 'medium',
    });
  });

  /** SRD Boar: one sentence that is an extra damage die *and* a condition. */
  it('reads a charge as a gate on both halves of the sentence it is printed in', () => {
    const boar =
      'If the target is a Medium or smaller creature and the boar moved 20+ feet straight toward it immediately before the hit, the target takes an extra 3 (1d6) Piercing damage and has the Prone condition.';
    expect(readPrintedRiders(boar)).toEqual({
      riders: [
        {
          kind: 'damage',
          how: 'extra',
          dice: '1d6',
          flat: 0,
          type: 'piercing',
          ifNoLargerThan: 'medium',
          when: { kind: 'charged', feet: 20 },
        },
        {
          kind: 'condition',
          conditions: ['prone'],
          ifNoLargerThan: 'medium',
          when: { kind: 'charged', feet: 20 },
        },
      ],
      handedOver: [],
    });
  });

  /** SRD Gorgon: the same sentence with no extra die in it. */
  it('reads a charge that buys only the condition', () => {
    const gorgon =
      'If the target is a Large or smaller creature and the gorgon moved 20+ feet straight toward it immediately before the hit, the target has the Prone condition.';
    expect(readPrintedRiders(gorgon).riders).toEqual([
      {
        kind: 'condition',
        conditions: ['prone'],
        ifNoLargerThan: 'large',
        when: { kind: 'charged', feet: 20 },
      },
    ]);
  });

  /**
   * SRD Rhinoceros drops the article and SRD Triceratops drops the noun; both
   * are the same rule and a reader that refused either would hand a charge to
   * the DM over a transcription.
   */
  it('reads the two charge lines the book punctuates differently', () => {
    const rhino =
      'If target is a Large or smaller creature and the rhinoceros moved 20+ feet straight toward it immediately before the hit, the target takes an extra 9 (2d8) Piercing damage and has the Prone condition.';
    const trike =
      'If the target is Huge or smaller and the triceratops moved 20+ feet straight toward it immediately before the hit, the target takes an extra 9 (2d8) Piercing damage and has the Prone condition.';
    expect(readPrintedRiders(rhino).riders).toHaveLength(2);
    expect(readPrintedRiders(trike).riders).toHaveLength(2);
    expect(readPrintedRiders(trike).riders[0]).toMatchObject({ ifNoLargerThan: 'huge' });
  });

  /** SRD Allosaurus: a charge, and a free Bite the engine does not grant. */
  it('hands back the extra attack a charge line appends', () => {
    const read = readPrintedRiders(
      'If the target is a Large or smaller creature and the allosaurus moved 30+ feet straight toward it immediately before the hit, the target has the Prone condition, and the allosaurus can make one Bite attack against it.',
    );
    expect(read.riders).toEqual([
      {
        kind: 'condition',
        conditions: ['prone'],
        ifNoLargerThan: 'large',
        when: { kind: 'charged', feet: 30 },
      },
    ]);
    expect(read.handedOver).toEqual(['the allosaurus can make one Bite attack against it']);
  });

  /** SRD Goat: the charge as a gate on the damage the line rolls *instead*. */
  it('reads a charge gate on a damage clause', () => {
    expect(
      readPrintedRiders(
        'or 2 (1d4) Bludgeoning damage if the goat moved 20+ feet straight toward the target immediately before the hit.',
      ).riders,
    ).toEqual([
      {
        kind: 'damage',
        how: 'instead',
        dice: '1d4',
        flat: 0,
        type: 'bludgeoning',
        when: { kind: 'charged', feet: 20 },
      },
    ]);
  });

  /** SRD Merrow and SRD Satyr: the two directions the book shoves in. */
  it('reads a pull and a push a hit delivers', () => {
    expect(
      readPrintedRiders(
        'If the target is a Large or smaller creature, the merrow pulls the target up to 15 feet straight toward itself.',
      ).riders,
    ).toEqual([{ kind: 'forced-move', direction: 'pull', feet: 15, ifNoLargerThan: 'large' }]);
    expect(
      readPrintedRiders(
        'If the target is a Medium or smaller creature, the satyr pushes the target up to 10 feet straight away from itself.',
      ).riders,
    ).toEqual([{ kind: 'forced-move', direction: 'push', feet: 10, ifNoLargerThan: 'medium' }]);
    expect(
      readPrintedRiders(
        'If the target is a Medium or smaller creature, the shambling mound pulls the target 5 feet straight toward itself.',
      ).riders,
    ).toEqual([{ kind: 'forced-move', direction: 'pull', feet: 5, ifNoLargerThan: 'medium' }]);
  });

  /** SRD Swarm of Venomous Snakes: an em dash joining two damage clauses. */
  it('reads both halves of a clause the book joins with an em dash', () => {
    expect(
      readPrintedRiders(
        'or 6 (1d4 + 4) Piercing damage if the swarm is Bloodied—plus 10 (3d6) Poison damage.',
      ),
    ).toEqual({
      riders: [
        {
          kind: 'damage',
          how: 'instead',
          dice: '1d4',
          flat: 4,
          type: 'piercing',
          when: { kind: 'bloodied', who: 'attacker' },
        },
        { kind: 'damage', how: 'extra', dice: '3d6', flat: 0, type: 'poison' },
      ],
      handedOver: [],
    });
  });

  /** SRD Mimic's Bite: a gate the engine holds the fact for. */
  it('reads "Grappled by the mimic" as a gate rather than handing it back', () => {
    expect(
      readPrintedRiders(
        'or 12 (2d8 + 3) Piercing damage if the target is Grappled by the mimic—plus 4 (1d8) Acid damage.',
      ).riders,
    ).toEqual([
      {
        kind: 'damage',
        how: 'instead',
        dice: '2d8',
        flat: 3,
        type: 'piercing',
        when: { kind: 'grappled-by-attacker' },
      },
      { kind: 'damage', how: 'extra', dice: '1d8', flat: 0, type: 'acid' },
    ]);
  });

  /** SRD Swarm of Crawling Claws: two sentences, two shapes, nothing left over. */
  it('reads a composite of a damage clause and a condition clause', () => {
    expect(
      readPrintedRiders(
        'or 11 (2d8 + 2) Necrotic damage if the swarm is Bloodied. If the target is a Medium or smaller creature, it has the Prone condition.',
      ),
    ).toEqual({
      riders: [
        {
          kind: 'damage',
          how: 'instead',
          dice: '2d8',
          flat: 2,
          type: 'necrotic',
          when: { kind: 'bloodied', who: 'attacker' },
        },
        { kind: 'condition', conditions: ['prone'], ifNoLargerThan: 'medium' },
      ],
      handedOver: [],
    });
  });

  /** SRD Gibbering Mouther: one sentence read, two handed back. */
  it('applies what it read and hands back the rest of a composite', () => {
    const read = readPrintedRiders(
      'If the target is a Medium or smaller creature, it has the Prone condition. The target dies if it is reduced to 0 Hit Points by this attack. Its body is then absorbed into the mouther, leaving only equipment behind.',
    );
    expect(read.riders).toEqual([
      { kind: 'condition', conditions: ['prone'], ifNoLargerThan: 'medium' },
    ]);
    expect(read.handedOver).toEqual([
      'The target dies if it is reduced to 0 Hit Points by this attack.',
      'Its body is then absorbed into the mouther, leaving only equipment behind.',
    ]);
  });

  /** SRD Merfolk Skirmisher: a Speed cut, and a spear that comes back. */
  it('reads a Speed cut and hands back the returning spear', () => {
    const read = readPrintedRiders(
      "If the target is a creature, its Speed decreases by 10 feet until the end of its next turn. _Hit or Miss:_ The spear magically returns to the merfolk's hand immediately after a ranged attack.",
    );
    expect(read.riders).toEqual([
      { kind: 'speed-cut', feet: 10, lasts: 'end-of-next-turn', lastsOn: 'target' },
    ]);
    expect(read.handedOver).toEqual([
      '_Hit or Miss:_ The spear magically returns to the merfolk’s hand immediately after a ranged attack.'.replace(
        '’',
        "'",
      ),
    ]);
  });

  /**
   * SRD Salamander: the whole rider is the residue. Read, and nothing applied —
   * which is the truth about the line, and why the two ledger rows overlap.
   */
  it('hands back a line it can read nothing of', () => {
    const read = readPrintedRiders(
      "_Hit or Miss:_ The spear magically returns to the salamander's hand immediately after a ranged attack.",
    );
    expect(read.riders).toEqual([]);
    expect(read.handedOver).toHaveLength(1);
  });

  /** SRD Ettin and SRD Worg: a mode on one later roll, from either end. */
  it('reads a mode on the next attack roll, on both sides of the relation', () => {
    expect(
      readPrintedRiders(
        'and the target has Disadvantage on the next attack roll it makes before the end of its next turn.',
      ).riders,
    ).toEqual([
      {
        kind: 'roll-mode',
        mode: 'disadvantage',
        relation: 'roller',
        lasts: 'end-of-next-turn',
        lastsOn: 'target',
      },
    ]);
    expect(
      readPrintedRiders(
        "and the next attack roll made against the target before the start of the worg's next turn has Advantage.",
      ).riders,
    ).toEqual([
      {
        kind: 'roll-mode',
        mode: 'advantage',
        relation: 'against-holder',
        lasts: 'start-of-next-turn',
        lastsOn: 'attacker',
      },
    ]);
  });

  /** SRD Specter and SRD Wraith. */
  it('reads a Hit Point maximum lowered by the damage', () => {
    expect(
      readPrintedRiders(
        'If the target is a creature, its Hit Point maximum decreases by an amount equal to the damage taken.',
      ).riders,
    ).toEqual([{ kind: 'hit-point-maximum' }]);
  });

  /** SRD Crocodile: a hold that implies a condition for as long as it lasts. */
  it('folds "While Grappled" into the grapple the sentence before it made', () => {
    expect(
      readPrintedRiders(
        'If the target is a Medium or smaller creature, it has the Grappled condition (escape DC 12). While Grappled, the target has the Restrained condition.',
      ),
    ).toEqual({
      riders: [
        {
          kind: 'grapple',
          escapeDc: 12,
          ifNoLargerThan: 'medium',
          whileHeld: ['restrained'],
        },
      ],
      handedOver: [],
    });
  });

  /** SRD Giant Octopus: the same, with the limb clause the book appends. */
  it('keeps the limbs a grapple is made with beside what it implies', () => {
    expect(
      readPrintedRiders(
        'If the target is a Medium or smaller creature, it has the Grappled condition (escape DC 13) from all eight tentacles. While Grappled, the target has the Restrained condition.',
      ).riders,
    ).toEqual([
      {
        kind: 'grapple',
        escapeDc: 13,
        ifNoLargerThan: 'medium',
        withLimbs: 'all eight tentacles',
        whileHeld: ['restrained'],
      },
    ]);
  });

  /** SRD Giant Crocodile: the implication, and a targeting rule nobody built. */
  it('hands back the clause a while-held sentence carries beyond the condition', () => {
    const read = readPrintedRiders(
      "If the target is a Large or smaller creature, it has the Grappled condition (escape DC 15). While Grappled, the target has the Restrained condition and can't be targeted by the crocodile's Tail.",
    );
    expect(read.riders).toEqual([
      { kind: 'grapple', escapeDc: 15, ifNoLargerThan: 'large', whileHeld: ['restrained'] },
    ]);
    expect(read.handedOver).toEqual(["can't be targeted by the crocodile's Tail"]);
  });

  /**
   * SRD Mimic's Pseudopod. The Disadvantage is a mode on an **ability check**
   * narrowed to the condition it would end, and `RollSelector.condition` is
   * legal only on a saving throw today — so the grapple is made and the
   * sentence is handed back rather than half-read.
   */
  it('hands back the Disadvantage on a Mimic escape and still makes the grapple', () => {
    const read = readPrintedRiders(
      'If the target is a Large or smaller creature, it has the Grappled condition (escape DC 13). Ability checks made to escape this grapple have Disadvantage.',
    );
    expect(read.riders).toEqual([{ kind: 'grapple', escapeDc: 13, ifNoLargerThan: 'large' }]);
    expect(read.handedOver).toEqual([
      'Ability checks made to escape this grapple have Disadvantage.',
    ]);
  });

  /** SRD Bearded Devil's Beard: an anchored Poisoned, and no healing while it runs. */
  it('folds "the target can\'t regain Hit Points" into the condition it names', () => {
    expect(
      readPrintedRiders(
        "and the target has the Poisoned condition until the start of the devil's next turn. Until this poison ends, the target can't regain Hit Points.",
      ),
    ).toEqual({
      riders: [
        {
          kind: 'condition',
          conditions: ['poisoned'],
          lasts: 'start-of-next-turn',
          lastsOn: 'attacker',
          preventsHealing: true,
        },
      ],
      handedOver: [],
    });
  });

  /**
   * SRD Half-Dragon's Claw. The damage type is on the block's Draconic Origin
   * trait, which the parser kept nothing structured of — "(GM's choice)" — so
   * there is no fact to read and the whole clause is the table's.
   */
  it('hands back a damage type only the GM has chosen', () => {
    const read = readPrintedRiders(
      '7 (2d6) damage of the type chosen for the Draconic Origin trait.',
    );
    expect(read.riders).toEqual([]);
    expect(read.handedOver).toHaveLength(1);
  });

  /** The reader's own refusals, unchanged: a sentence it cannot read is the DM's. */
  it('still refuses what it never read', () => {
    const mummy =
      "If the target is a creature, it is cursed. While cursed, the target can't regain Hit Points.";
    const read = readPrintedRiders(mummy);
    expect(read.riders).toEqual([]);
    expect(read.handedOver).toHaveLength(2);
    expect(readPrintedRider(mummy)).toBeNull();
  });
});

// — through the commands ——————————————————————————————————————————————————————

const id = (s: string) => asCharacterId(s);
const BREN = id('bren');
const BEAST = id('beast');
const OTHER = id('other');
const THIRD = id('third');
const BIG = id('big');
const SEED = 'hooves';

const supply = (seed = SEED) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

/** A level 1 Fighter, Medium, for the beasts to run at. */
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
  readonly log: GameEvent[] = [];

  get state(): GameState {
    return fold(SEED, this.log);
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

/** A fighter in a field with a beast a stated distance due south of him. */
const field = (block: string, away: number, inCombat = true, victim = walkOn('Bren')): Table => {
  const table = new Table();
  table.do('the fighter arrives', () => createCharacter(SRD_CONTENT, victim, BREN));
  table.did('the beast arrives', (s) => addCreature(s, SRD_CONTENT, BEAST, block));
  table.do('the field', (s) => setScene(s, { width: 400, depth: 400, height: 100 }));
  table.do('the oak', (s) => addSceneLandmark(s, 'the oak', { x: 200, y: 200, z: 0 }));
  table.do('Bren by the oak', (s) =>
    placeCreatureInScene(s, BREN, { from: { landmark: 'the oak' }, feet: 0 }),
  );
  table.do('the beast downfield', (s) =>
    placeCreatureInScene(s, BEAST, { from: { creature: BREN }, feet: away, bearing: 180 }),
  );
  table.do('Bren’s side', (s) => declareCreatureSide(s, BREN, 'party'));
  table.do('the beast’s side', (s) => declareCreatureSide(s, BEAST, 'wild'));
  if (inCombat) {
    table.do('the order', (s) =>
      beginCombat(s, [
        { id: BEAST, initiative: 20, speed: 40 },
        { id: BREN, initiative: 1, speed: 30 },
      ]),
    );
  }
  return table;
};

/** A move the beast makes on its own turn, stated as feet along a bearing. */
const run = (table: Table, feet: number, bearing: number, step: string): GameState =>
  table.did(step, (s) =>
    resolveMove(
      s,
      BEAST,
      { placement: { from: { creature: BEAST }, feet, bearing }, commandId: step },
      supply(),
    ),
  );

/** A swing with the attack roll forced to land: a miss answers nothing here. */
const swing = (
  table: Table,
  /** The stat-block line this swing is, or null for a character's own fist. */
  action: string | null,
  options: {
    readonly who?: CharacterId;
    readonly target?: CharacterId;
    readonly seed?: string;
    readonly commandId?: string;
    /** SRD's "_Melee or Ranged Attack Roll:_": which of the two this swing is. */
    readonly thrown?: true;
  } = {},
) => {
  const out = unwrap(
    resolveAttack(
      table.state,
      options.who ?? BEAST,
      {
        target: options.target ?? BREN,
        weapon: null,
        ...(action === null ? {} : { action }),
        attackBonuses: [{ source: 'forced', flat: 40 }],
        ...(options.thrown === undefined ? {} : { thrown: options.thrown }),
        ...(options.commandId === undefined ? {} : { commandId: options.commandId }),
      },
      supply(options.seed ?? SEED),
    ),
    `the ${action ?? 'swing'}`,
  );
  const log = [...table.log, ...out.events];
  return { ...out, log, state: fold(SEED, log) };
};

const conditionsOn = (state: GameState, who: CharacterId): readonly string[] =>
  state.creatures[who]?.conditions.conditions ?? [];

/** The slices a blow was made of, as the log recorded the faces. */
const slices = (events: readonly GameEvent[]): readonly { source: string; type: string }[] =>
  events.flatMap((e) => (e.type === 'damage-dice-recorded' ? [...e.components] : []));

const apart = (state: GameState, a: CharacterId, b: CharacterId): number | null =>
  state.scene === null ? null : unwrap(distanceBetween(state.scene, a, b), 'the gap');

// — the charge ————————————————————————————————————————————————————————————————

/**
 * SRD Boar, Gore: "If the target is a Medium or smaller creature **and the
 * boar moved 20+ feet straight toward it immediately before the hit**, the
 * target takes an extra 3 (1d6) Piercing damage and has the Prone condition."
 *
 * The gate `readPrintedRider`'s own comment refused for as long as it did:
 * "nothing records the shape of the move that preceded a swing." Something
 * does now — `movement-spent` carries the two ends of the move and the combat
 * seam keeps the turn's segments on the budget — so the question is answered
 * off the engine's own record rather than asked of the table.
 */
describe('the move that preceded the swing', () => {
  it('knocks a charged target Prone and deals the extra die', () => {
    const table = field('boar', 25);
    run(table, 20, 0, 'the boar charges');
    const out = swing(table, 'Gore');

    expect(out.attack?.hit).toBe(true);
    expect(conditionsOn(out.state, BREN)).toContain('prone');
    // The extra die is a **component of the blow**, so it meets the target's
    // defences with it and a critical would double it — which is why it is in
    // the damage the line rolls rather than dealt separately afterwards.
    expect(slices(out.events).filter((c) => c.type === 'piercing')).toHaveLength(2);
    expect(out.unverified.join(' ')).not.toContain('the engine does not apply that');
  });

  /** Fifteen feet is not twenty, and the line says twenty. */
  it('leaves a short run alone', () => {
    const table = field('boar', 20);
    run(table, 15, 0, 'the boar trots');
    const out = swing(table, 'Gore');

    expect(out.attack?.hit).toBe(true);
    expect(conditionsOn(out.state, BREN)).not.toContain('prone');
    expect(slices(out.events).filter((c) => c.type === 'piercing')).toHaveLength(1);
  });

  /**
   * **"Straight" is the half feet cannot express.** Twenty feet north and then
   * ten feet west is thirty feet of movement and a run of ten, because the run
   * is read back from the swing only while the bearing holds.
   */
  it('leaves a run that bent alone', () => {
    const table = field('boar', 25);
    run(table, 20, 0, 'the boar starts north');
    run(table, 5, 90, 'the boar turns');
    const out = swing(table, 'Gore');

    expect(out.attack?.hit).toBe(true);
    expect(conditionsOn(out.state, BREN)).not.toContain('prone');
  });

  /**
   * **And the bearing is measured against where the target is standing at the
   * swing.** A boar that ran twenty feet north straight past its target and
   * gored backwards did not move toward it, which is the same sentence "a move
   * away" is.
   */
  it('leaves a run that went past the target alone', () => {
    const table = field('boar', 20);
    run(table, 25, 0, 'the boar overshoots');
    const out = swing(table, 'Gore');

    expect(out.attack?.hit).toBe(true);
    expect(conditionsOn(out.state, BREN)).not.toContain('prone');
  });

  /**
   * **No record is no charge, said out loud.** Outside a fight there is no
   * turn and therefore no budget, so the engine records no moves at all — and
   * a gate that cannot be answered is reported rather than assumed either way.
   */
  it('says why the gate was not met where there is no turn keeping the record', () => {
    const table = field('boar', 5, false);
    const out = swing(table, 'Gore');

    expect(out.attack?.hit).toBe(true);
    expect(conditionsOn(out.state, BREN)).not.toContain('prone');
    expect(out.unverified.join(' ')).toContain('straight at bren before the hit');
    expect(out.unverified.join(' ')).toContain('outside a fight');
  });
});

// — the shove on a hit ————————————————————————————————————————————————————————

describe('a shove the hit itself delivers', () => {
  /**
   * SRD Satyr, Hooves: "If the target is a Medium or smaller creature, the
   * satyr pushes the target up to 10 feet straight away from itself."
   */
  it('pushes a Medium target ten feet away', () => {
    const table = field('satyr', 5);
    const out = swing(table, 'Hooves');

    expect(out.attack?.hit).toBe(true);
    expect(apart(out.state, BREN, BEAST)).toBe(15);
  });

  /**
   * SRD Merrow, Harpoon: "the merrow pulls the target up to 15 feet straight
   * toward itself" — the same arithmetic with the bearing reversed, thrown
   * from the far end of the line's own range.
   */
  it('pulls a target fifteen feet toward the puller', () => {
    const table = field('merrow', 20);
    // A Large merrow's own volume fills five of the twenty feet between the
    // two anchors, so the gap the rules measure is fifteen — the whole of
    // what the line pulls.
    expect(apart(table.state, BREN, BEAST)).toBe(15);
    const out = swing(table, 'Harpoon', { thrown: true });

    expect(out.attack?.hit).toBe(true);
    expect(apart(out.state, BREN, BEAST)).toBe(0);
  });

  /**
   * **"Up to", capped at the gap.** A pull is the one direction that can run
   * out of room: fifteen feet of pull across a five-foot gap would drag the
   * target through the thing pulling it.
   */
  it('stops a pull at the puller’s own face', () => {
    const table = field('merrow', 10);
    const out = swing(table, 'Harpoon');

    expect(out.attack?.hit).toBe(true);
    expect(apart(out.state, BREN, BEAST)).toBe(0);
  });

  /** The size the line prints, evaluated rather than assumed. */
  it('leaves a creature the size gate does not reach standing where it was', () => {
    const table = field('satyr', 5);
    table.did('an elephant wanders in', (s) => addCreature(s, SRD_CONTENT, BIG, 'elephant'));
    table.do('the elephant beside the satyr', (s) =>
      placeCreatureInScene(s, BIG, { from: { creature: BEAST }, feet: 5, bearing: 90 }),
    );

    const out = swing(table, 'Hooves', { target: BIG });

    expect(out.attack?.hit).toBe(true);
    expect(apart(out.state, BIG, BEAST)).toBe(5);
    expect(out.unverified.join(' ')).toContain('medium or smaller');
  });
});

// — a mode on one later roll ——————————————————————————————————————————————————

describe('a mode a hit puts on one later roll', () => {
  /**
   * SRD Worg, Bite: "the next attack roll made against the target before the
   * start of the worg's next turn has Advantage." `RollModifier.oneShot` is
   * the half that says *the next*; the span is the half that says *before*.
   */
  it('gives the next attack roll against the target Advantage, and the one after it none', () => {
    const table = field('worg', 10);
    for (const [who, bearing, initiative] of [
      [OTHER, 90, 15],
      [THIRD, 270, 10],
    ] as const) {
      table.did(`a guard at ${bearing}`, (s) => addCreature(s, SRD_CONTENT, who, 'guard'));
      table.do(`the guard at ${bearing} beside Bren`, (s) =>
        placeCreatureInScene(s, who, { from: { creature: BREN }, feet: 5, bearing }),
      );
      table.do(`its side at ${bearing}`, (s) => declareCreatureSide(s, who, 'wild'));
      table.do(`it joins at ${bearing}`, (s) =>
        joinCombat(s, { id: who, initiative, speed: 40 }),
      );
    }

    const bitten = swing(table, 'Bite');
    expect(bitten.attack?.hit).toBe(true);
    table.log.push(...bitten.events);
    table.did('the worg’s turn ends', (s) =>
      resolveTurn(s, supply(), { commandId: 'the worg is done' }),
    );

    const first = swing(table, 'Spear', { who: OTHER, commandId: 'the first spear' });
    expect(first.attack?.mode).toBe('advantage');
    table.log.push(...first.events);
    table.did('the first guard’s turn ends', (s) =>
      resolveTurn(s, supply(), { commandId: 'the first guard is done' }),
    );

    const second = swing(table, 'Spear', { who: THIRD, commandId: 'the second spear' });
    expect(second.attack?.mode).toBe('normal');
  });

  /**
   * SRD Ettin, Morningstar: "the target has Disadvantage on the next attack
   * roll **it makes**" — the same mechanic from the other end of the relation,
   * which is a different rule and not a different wording.
   */
  it('puts Disadvantage on the target’s own next attack and no other', () => {
    // An ogre rather than the fighter, because the Ettin's morningstar puts a
    // level 1 character on the floor and an Incapacitated creature makes no
    // attack roll for the clause to be about.
    const table = field('ettin', 10);
    table.did('an ogre arrives', (s) => addCreature(s, SRD_CONTENT, OTHER, 'ogre'));
    table.do('the ogre beside the ettin', (s) =>
      placeCreatureInScene(s, OTHER, { from: { creature: BEAST }, feet: 10, bearing: 180 }),
    );
    table.do('its side', (s) => declareCreatureSide(s, OTHER, 'party'));
    table.do('it joins', (s) => joinCombat(s, { id: OTHER, initiative: 10, speed: 40 }));

    const hit = swing(table, 'Morningstar', { target: OTHER });
    expect(hit.attack?.hit).toBe(true);
    table.log.push(...hit.events);
    expect(table.state.creatures[OTHER]!.rollModifiers).toHaveLength(1);
    table.did('the ettin’s turn ends', (s) =>
      resolveTurn(s, supply(), { commandId: 'the ettin is done' }),
    );

    const swung = swing(table, 'Greatclub', {
      who: OTHER,
      target: BEAST,
      commandId: 'the ogre swings',
    });
    expect(swung.attack?.mode).toBe('disadvantage');
    table.log.push(...swung.events);

    // **The roll it reached, not the roll it changed**: one attack spends it,
    // and `roll-modifier-consumed` is how it ends. Nothing of the ettin's is
    // left on the ogre for the next one.
    expect(swung.events.some((e) => e.type === 'roll-modifier-consumed')).toBe(true);
    expect(table.state.creatures[OTHER]!.rollModifiers).toEqual([]);
  });
});

// — a maximum lowered by the blow ——————————————————————————————————————————————

describe('a Hit Point maximum the blow lowers', () => {
  /**
   * SRD Specter, Life Drain: "its Hit Point maximum decreases by an amount
   * equal to **the damage taken**" — what the target actually took, after its
   * own defences, which is why the number is read off the settled damage and
   * not off the roll.
   */
  it('lowers the maximum by exactly what the blow dealt', () => {
    const table = field('specter', 5);
    const before = table.state.creatures[BREN]!.vitals.hpMax;
    const out = swing(table, 'Life Drain');

    expect(out.attack?.hit).toBe(true);
    expect(out.damage).toBeGreaterThan(0);
    expect(out.state.creatures[BREN]!.vitals.hpMax).toBe(before - out.damage!);
  });
});

// — a hold that implies a condition ————————————————————————————————————————————

describe('a grapple that carries a condition for as long as it lasts', () => {
  /**
   * SRD Crocodile, Bite: "it has the Grappled condition (escape DC 12). While
   * Grappled, the target has the Restrained condition."
   *
   * The lifetime is `ConditionInstance.impliedBy` — the one Unconscious
   * carries Prone with — so the Restrained is lifted by whatever lifts the
   * grapple, through the door that already existed.
   */
  it('leaves the target Grappled and Restrained, and the escape lifts both', () => {
    const table = field('crocodile', 10);
    const bitten = swing(table, 'Bite');
    expect(bitten.attack?.hit).toBe(true);
    expect(conditionsOn(bitten.state, BREN)).toContain('grappled');
    expect(conditionsOn(bitten.state, BREN)).toContain('restrained');
    table.log.push(...bitten.events);

    // Bren's turn, and an escape check the table hands enough to pass.
    table.did('the crocodile’s turn ends', (s) =>
      resolveTurn(s, supply(), { commandId: 'end of the crocodile’s turn' }),
    );
    const escaped = unwrap(
      escapeGrapple(
        table.state,
        BREN,
        { ability: 'str', bonuses: [{ source: 'forced', flat: 40 }] },
        supply(),
      ),
      'the escape',
    );
    expect(escaped.success).toBe(true);
    const after = fold(SEED, [...table.log, ...escaped.events]);
    expect(conditionsOn(after, BREN)).not.toContain('grappled');
    expect(conditionsOn(after, BREN)).not.toContain('restrained');
  });
});

// — the residue ———————————————————————————————————————————————————————————————

describe('a composite line applies what it read and reports the rest', () => {
  /**
   * SRD Gibbering Mouther, Bite: the Prone the engine has executed for a year
   * on every line that prints it alone, followed by two sentences about a
   * victim being absorbed that nothing in the engine does.
   *
   * Before this the whole line was the DM's, including the Prone. Now the
   * Prone lands and the residue is reported — and the ledger counts the line
   * as **unpaid** on the strength of that residue, which is what keeps
   * learning to recognise three quarters of a sentence from retiring a debt.
   */
  it('knocks the target Prone and hands back the sentences it read nothing of', () => {
    const table = field('gibbering-mouther', 5);
    const out = swing(table, 'Bite');

    expect(out.attack?.hit).toBe(true);
    expect(conditionsOn(out.state, BREN)).toContain('prone');
    const said = out.unverified.join(' ');
    expect(said).toContain('The target dies if it is reduced to 0 Hit Points by this attack.');
    expect(said).toContain('absorbed into the mouther');
    // And not the half it executed.
    expect(said).not.toContain('it has the Prone condition.');
  });
});

// — a Speed the hit cuts, and a healing the poison forbids ————————————————————

describe('the rest of what a printed hit buys', () => {
  /**
   * SRD Merfolk Skirmisher, Ocean Spear: "If the target is a creature, its
   * Speed decreases by 10 feet until the end of its next turn. _Hit or Miss:_
   * The spear magically returns to the merfolk's hand."
   *
   * The Speed cut is the `speed-modifier-granted` grant a spell's slow already
   * hangs, released by the `grants` deadline `fileDeadlines` files over it.
   * The returning spear is a sentence about an object nobody is tracking, so
   * it goes back to the table — which is what leaves the line **unpaid** even
   * though half of it now runs.
   */
  it('cuts the Speed and hands back the spear that comes home', () => {
    const table = field('merfolk-skirmisher', 5);
    const before = speedOf(table.state, BREN);
    const out = swing(table, 'Ocean Spear');

    expect(out.attack?.hit).toBe(true);
    expect(speedOf(out.state, BREN)).toBe(before - 10);
    expect(out.unverified.join(' ')).toContain('The spear magically returns');
  });

  /**
   * SRD Bearded Devil, Beard: "the target has the Poisoned condition until the
   * start of the devil's next turn. Until this poison ends, the target can't
   * regain Hit Points."
   *
   * Two sentences about one span, so they are one `HitOption`: the condition
   * and a `healing-rule` grant that ends with it.
   */
  it('poisons the target and stops its healing while the poison lasts', () => {
    const table = field('bearded-devil', 5);
    const out = swing(table, 'Beard');

    expect(out.attack?.hit).toBe(true);
    expect(conditionsOn(out.state, BREN)).toContain('poisoned');
    expect(healingRuleOf(out.state.creatures[BREN]!.healingRules)).toBe('prevented');
    expect(out.unverified.join(' ')).not.toContain('the engine does not apply that');
  });
});
