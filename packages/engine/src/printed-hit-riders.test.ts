import { describe, expect, it } from 'vitest';
import { readPrintedRider, readPrintedRiders } from './monster.js';

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
