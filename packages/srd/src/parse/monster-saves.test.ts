import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseMonsters, parseSaveLine } from './monsters.js';

/**
 * The save a printed line forces, read out of the book's other template.
 *
 * `_Dexterity Saving Throw:_ DC 12, each creature in a 15-foot Cone.
 * _Failure:_ 17 (5d6) Fire damage. _Success:_ Half damage.` is the same
 * sentence in every dragon wyrmling, the Hell Hound and the Winter Wolf — a
 * template exactly as regular as `_Melee Attack Roll:_` is, carrying the two
 * numbers the engine must supply itself: the DC and the dice.
 *
 * **What is read is the template and the regular clauses after it.** The
 * opening is anchored, so a trigger or a movement printed before the save
 * refuses the line whole, as does a graded failure and a damage type the block
 * leaves to another trait. After the opening, `parsePrintedSave` reads the six
 * regular clauses a failure prints — a condition to a turn anchor, a grapple
 * with its escape DC, a push and Prone, a Speed cut, a Hit Point maximum
 * lowered by the damage — one sentence at a time and **transactionally**: a
 * sentence half of which it does not know is carried whole in `handedOver`,
 * never half-applied. What it carries is still handed to the DM at the moment
 * of use, and the ledger keeps the block until the last sentence is spent.
 */

const read = (file: string) =>
  readFileSync(fileURLToPath(new URL(`../../raw/${file}`, import.meta.url)), 'utf8');

const bestiary = [
  ...parseMonsters(read('monsters-A-Z.md'), 'monsters-A-Z.md').items,
  ...parseMonsters(read('animals.md'), 'animals.md').items,
];

const find = (id: string) => {
  const monster = bestiary.find((m) => m.id === id);
  if (monster === undefined) throw new Error(`no stat block called ${id}`);
  return monster;
};

/**
 * A line by its heading, from **whichever section** the block prints it under.
 *
 * Every detector in this parser runs over every section, because what a line
 * says is not a property of the heading it is printed under — and the book
 * proves it here: the Gorgon's Trample is a Bonus Action, the Magma Mephit's
 * Death Burst is a trait, and both write the save template.
 */
const lineOf = (id: string, startsWith: string) => {
  const monster = find(id);
  const line = [
    ...monster.traits,
    ...monster.actions,
    ...monster.bonusActions,
    ...monster.reactions,
    ...monster.legendaryActions,
  ].find((printed) => printed.name.startsWith(startsWith));
  if (line === undefined) throw new Error(`${id} prints no line called ${startsWith}`);
  return line;
};

describe('a line whose sentence is the save template', () => {
  it('reads the Winter Wolf’s breath as an ability, a DC, dice and what a success buys', () => {
    expect(lineOf('winter-wolf', 'Cold Breath').save).toEqual({
      ability: 'con',
      dc: 12,
      targets: 'each creature in a 15-foot Cone',
      damage: { dice: '4d8', flat: 0, type: 'cold', average: 18 },
      onSuccess: 'half',
    });
  });

  it('reads the addend the book prints inside the parenthesis', () => {
    // "16 (2d10 + 5) Bludgeoning damage" — the same trap Finger of Death fell
    // into: dice with no addend is a smaller number than the book prints.
    expect(lineOf('gorgon', 'Trample').save).toEqual({
      ability: 'dex',
      dc: 16,
      targets: 'one creature within 5 feet that has the Prone condition',
      damage: { dice: '2d10', flat: 5, type: 'bludgeoning', average: 16 },
      onSuccess: 'half',
    });
  });

  it('reads a line that offers a success nothing at all', () => {
    // SRD Satyr's Mockery prints no `_Success:_` clause, and a success that
    // bought half anyway would be a rule nobody printed.
    expect(lineOf('satyr', 'Mockery').save).toEqual({
      ability: 'wis',
      dc: 12,
      targets: 'one creature the satyr can see within 90 feet',
      damage: { dice: '1d6', flat: 2, type: 'psychic', average: 5 },
      onSuccess: 'none',
    });
  });

  it('keeps the line’s recharge and its sentence beside the save', () => {
    const line = lineOf('hell-hound', 'Fire Breath');
    expect(line.recharge).toEqual({ kind: 'die', low: 5 });
    expect(line.text).toContain('_Success:_ Half damage.');
    expect(line.save?.dc).toBe(12);
  });
});

describe('the clauses a failure prints besides the damage', () => {
  it('reads a condition to a turn anchor on the source, and one on the target', () => {
    // SRD Lion: "The target has the Frightened condition until the start of
    // the lion's next turn."
    expect(lineOf('lion', 'Roar').save).toEqual({
      ability: 'wis',
      dc: 11,
      targets: 'one creature within 15 feet',
      onSuccess: 'none',
      onFailure: [
        {
          kind: 'condition',
          condition: 'frightened',
          lasts: { kind: 'turn', moment: 'start', of: 'source' },
        },
      ],
    });
    // SRD Dretch's Fetid Cloud: "until the end of its next turn" — the
    // target's own — with the second sentence carried, not applied.
    const cloud = lineOf('dretch', 'Fetid Cloud').save;
    expect(cloud?.onFailure).toEqual([
      {
        kind: 'condition',
        condition: 'poisoned',
        lasts: { kind: 'turn', moment: 'end', of: 'target' },
      },
    ]);
    expect(cloud?.handedOver).toEqual([
      "While Poisoned, the creature can take either an action or a Bonus Action on its turn, not both, and it can't take Reactions.",
    ]);
  });

  it('reads damage and a condition riding on it, and a Speed cut for a turn', () => {
    // SRD Gibbering Mouther's Blinding Spittle.
    expect(lineOf('gibbering-mouther', 'Blinding Spittle').save).toMatchObject({
      damage: { dice: '2d6', flat: 0, type: 'radiant', average: 7 },
      onSuccess: 'none',
      onFailure: [
        {
          kind: 'condition',
          condition: 'blinded',
          lasts: { kind: 'turn', moment: 'end', of: 'source' },
        },
      ],
    });
    // SRD Steam Mephit: "and the target's Speed decreases by 10 feet until the
    // end of the mephit's next turn. _Success:_ Half damage only. _Failure or
    // Success:_ Being underwater doesn't grant Resistance to this Fire damage."
    expect(lineOf('steam-mephit', 'Steam Breath').save).toEqual({
      ability: 'con',
      dc: 10,
      targets: 'each creature in a 15-foot Cone',
      damage: { dice: '2d4', flat: 0, type: 'fire', average: 5 },
      onSuccess: 'half',
      onFailure: [
        { kind: 'speed-decrease', feet: 10, lasts: { kind: 'turn', moment: 'end', of: 'source' } },
      ],
      handedOver: [
        "_Failure or Success:_ Being underwater doesn't grant Resistance to this Fire damage.",
      ],
    });
  });

  it('reads a push straight away and the Prone that comes with it', () => {
    // SRD Air Elemental's Whirlwind, and the Bronze Dragon Wyrmling's Repulsion Breath.
    expect(lineOf('air-elemental', 'Whirlwind').save).toMatchObject({
      damage: { dice: '4d10', flat: 2, type: 'thunder', average: 24 },
      onSuccess: 'half',
      onFailure: [{ kind: 'push', feet: 20 }, { kind: 'condition', condition: 'prone' }],
    });
    expect(lineOf('bronze-dragon-wyrmling', 'Repulsion Breath').save?.onFailure).toEqual([
      { kind: 'push', feet: 30 },
      { kind: 'condition', condition: 'prone' },
    ]);
  });

  it('reads a grapple with its escape DC, and a size gate on a condition', () => {
    // SRD Bugbear Stalker's Quick Grapple; SRD Constrictor Snake's Constrict.
    expect(lineOf('bugbear-stalker', 'Quick Grapple').save?.onFailure).toEqual([
      { kind: 'condition', condition: 'grappled', escapeDc: 13 },
    ]);
    expect(lineOf('constrictor-snake', 'Constrict').save).toMatchObject({
      damage: { dice: '3d4', flat: 0, type: 'bludgeoning', average: 7 },
      onFailure: [{ kind: 'condition', condition: 'grappled', escapeDc: 12 }],
    });
    // SRD Gladiator's Shield Bash: "If the target is a Medium or smaller
    // creature, it has the Prone condition."
    expect(lineOf('gladiator', 'Shield Bash').save?.onFailure).toEqual([
      { kind: 'condition', condition: 'prone', ifNoLargerThan: 'medium' },
    ]);
  });

  it('reads a save the target repeats at the end of its turns, in both word orders, capped at a minute', () => {
    const repeated = {
      kind: 'condition',
      condition: 'frightened',
      repeats: { at: 'end', of: 'target', capSeconds: 60 },
    };
    // SRD Doppelganger: "…and repeats the save at the end of each of its turns,
    // ending the effect on itself on a success. After 1 minute, it succeeds
    // automatically."
    expect(lineOf('doppelganger', 'Unsettling Visage').save?.onFailure).toEqual([repeated]);
    // SRD Quasit's Scare: "At the end of each of its turns, the target repeats
    // the save, ending the effect on itself on a success."
    expect(lineOf('quasit', 'Scare').save?.onFailure).toEqual([repeated]);
  });

  it('reads a Hit Point maximum lowered by the damage, on a failure and on either outcome', () => {
    // SRD Wight's Life Drain, with the zombie paragraph carried.
    const drain = lineOf('wight', 'Life Drain').save;
    expect(drain).toMatchObject({
      damage: { dice: '1d8', flat: 2, type: 'necrotic', average: 6 },
      onFailure: [{ kind: 'hit-point-maximum-decrease', by: 'damage-taken' }],
    });
    expect(drain?.handedOver?.[0]).toMatch(/^A Humanoid slain by this attack rises 24 hours later/);
    // SRD Succubus's Draining Kiss: "_Failure or Success:_ The target's Hit
    // Point maximum decreases by an amount equal to the damage taken."
    expect(lineOf('succubus', 'Draining Kiss').save).toEqual({
      ability: 'con',
      dc: 15,
      targets: 'one creature Charmed by the succubus within 5 feet',
      damage: { dice: '3d8', flat: 0, type: 'psychic', average: 13 },
      onSuccess: 'half',
      either: [{ kind: 'hit-point-maximum-decrease', by: 'damage-taken' }],
    });
  });

  it('carries a sentence it did not read, and a success that is not half damage', () => {
    // SRD Mummy's Dreadful Glare: the Frightened is read; the immunity is the table's.
    expect(lineOf('mummy', 'Dreadful Glare').save).toEqual({
      ability: 'wis',
      dc: 11,
      targets: 'one creature the mummy can see within 60 feet',
      onSuccess: 'none',
      onFailure: [
        {
          kind: 'condition',
          condition: 'frightened',
          lasts: { kind: 'turn', moment: 'end', of: 'source' },
        },
      ],
      handedOver: ["_Success:_ The target is immune to this mummy's Dreadful Glare for 24 hours."],
    });
    // SRD Couatl's Constrict: the damage is read; a Grappled tied to a
    // Restrained "until the grapple ends" is one sentence, carried whole
    // rather than half-applied.
    const constrict = lineOf('couatl', 'Constrict').save;
    expect(constrict?.damage).toEqual({ dice: '1d6', flat: 5, type: 'bludgeoning', average: 8 });
    expect(constrict?.onFailure).toBeUndefined();
    expect(constrict?.handedOver).toEqual([
      'The target has the Grappled condition (escape DC 13), and it has the Restrained condition until the grapple ends.',
    ]);
  });

  it('reads a second damage component after "plus"', () => {
    // SRD Vampire Spawn's Bite; the maximum lowered by the *Necrotic* damage
    // and the vampire's regained Hit Points are carried.
    const bite = lineOf('vampire-spawn', 'Bite').save;
    expect(bite?.damage).toEqual({ dice: '1d4', flat: 3, type: 'piercing', average: 5 });
    expect(bite?.plus).toEqual({ dice: '3d6', flat: 0, type: 'necrotic', average: 10 });
    expect(bite?.handedOver).toHaveLength(1);
  });

  it('reads no save off a trait, whose moment is not a use', () => {
    // SRD Ghast's Stench is the template word for word, forced on "any
    // creature that starts its turn" in the aura — nothing a creature spends.
    const stench = lineOf('ghast', 'Stench');
    expect(stench.text).toContain('Saving Throw:_');
    expect(stench.save).toBeUndefined();
  });
});

describe('the lines the reader does not reach', () => {
  it('refuses a clause it cannot start on, rather than rolling a save for nothing', () => {
    // SRD Sea Hag's Death Glare: "If the target has 20 Hit Points or fewer, it
    // drops to 0 Hit Points." SRD Copper Dragon Wyrmling's Slowing Breath.
    expect(lineOf('sea-hag', 'Death Glare').save).toBeUndefined();
    expect(lineOf('copper-dragon-wyrmling', 'Slowing Breath').save).toBeUndefined();
  });

  it('refuses a failure graded by margin', () => {
    // SRD Pseudodragon's Sting prints `_Failure by 5 or More:_`.
    expect(lineOf('pseudodragon', 'Sting').save).toBeUndefined();
  });

  it('refuses a trigger printed before the save', () => {
    // "The mephit explodes when it dies." A line read without it is a Death
    // Burst a creature could set off on purpose.
    expect(lineOf('magma-mephit', 'Death Burst').save).toBeUndefined();
  });

  it('refuses a line whose damage type the block leaves to a trait', () => {
    // SRD Half-Dragon: "damage of the type chosen for the Draconic Origin
    // trait" — a type nobody has declared is not a type.
    expect(lineOf('half-dragon', "Dragon's Breath").save).toBeUndefined();
  });

  it('refuses a second rung of failure', () => {
    // SRD Gorgon's Petrifying Breath prints `_First Failure:_` and
    // `_Second Failure:_`, which is a repeat save this shape cannot hold.
    expect(lineOf('gorgon', 'Petrifying Breath').save).toBeUndefined();
  });

  it('reads a save whose failure imposes a condition rather than damage', () => {
    // SRD Dust Mephit's Blinding Breath — refused by the first reader, and the
    // reason this one exists.
    expect(lineOf('dust-mephit', 'Blinding Breath').save).toEqual({
      ability: 'dex',
      dc: 10,
      targets: 'each creature in a 15-foot Cone',
      onSuccess: 'none',
      onFailure: [
        {
          kind: 'condition',
          condition: 'blinded',
          lasts: { kind: 'turn', moment: 'end', of: 'source' },
        },
      ],
    });
  });

  it('reads nothing out of a line that is not the template at all', () => {
    expect(parseSaveLine('The wolf makes two Bite attacks.')).toBeNull();
    expect(
      parseSaveLine('_Melee Attack Roll:_ +4, reach 5 ft. _Hit:_ 5 (1d6 + 2) Piercing damage.'),
    ).toBeNull();
  });

  it('leaves an attack line’s own printed save alone', () => {
    // SRD Ghoul's Bite carries a Constitution save in its *rider*, which
    // `readPrintedRider` has read at the hit since P1-T10. A second reading of
    // the same sentence here would be two engines for one clause.
    const bite = find('ghoul').actions.find((action) => action.name === 'Bite');
    expect(bite?.attack).toBeDefined();
    expect(bite?.save).toBeUndefined();
  });
});

describe('the corpus, so a format change is a failing test rather than a smaller number', () => {
  const saves = bestiary.flatMap((monster) =>
    [
      ...monster.traits,
      ...monster.actions,
      ...monster.bonusActions,
      ...monster.reactions,
      ...monster.legendaryActions,
    ].filter((line) => line.save !== undefined),
  );

  it('reads a save off more than a handful of lines', () => {
    expect(saves.length).toBeGreaterThan(40);
  });

  it('reads a save only off a line a creature spends', () => {
    const spendable = new Set(
      bestiary.flatMap((monster) => [...monster.actions, ...monster.bonusActions]),
    );
    expect(saves.filter((line) => !spendable.has(line))).toEqual([]);
  });

  it('never reads one off a line that also prints an attack roll', () => {
    expect(saves.filter((line) => line.attack !== undefined)).toEqual([]);
  });

  /**
   * **The engine's door searches two sections and Actions wins**, so a
   * heading printed under both would be a Bonus Action line the door refused
   * `line_states_no_save` while its twin sat one section up. It is a fact
   * about this transcription rather than a rule of the book, which is exactly
   * the sort of thing that changes under a re-vendor.
   */
  it('prints no heading under both Actions and Bonus Actions', () => {
    const collisions = bestiary.flatMap((monster) => {
      const bonus = new Set(monster.bonusActions.map((line) => line.name.toLowerCase()));
      return monster.actions
        .filter((line) => bonus.has(line.name.toLowerCase()))
        .map((line) => `${monster.name} / ${line.name}`);
    });
    expect(collisions).toEqual([]);
    // Not vacuous: there are blocks with lines under both headings to collide.
    expect(bestiary.filter((m) => m.actions.length > 0 && m.bonusActions.length > 0).length)
      .toBeGreaterThan(20);
  });

  it('gives every save it read something the engine spends: damage, or a clause', () => {
    for (const line of saves) {
      const save = line.save!;
      expect(save.dc).toBeGreaterThan(0);
      if (save.damage !== undefined) {
        expect(save.damage.dice).toMatch(/^\d+d\d+$/);
        expect(save.damage.type).toMatch(/^[a-z]+$/);
      } else {
        expect(save.onFailure?.length ?? 0, line.name).toBeGreaterThan(0);
        expect(save.onSuccess).toBe('none');
      }
    }
  });

  it('carries every unread sentence as words a DM can act on', () => {
    for (const line of saves) {
      for (const sentence of line.save?.handedOver ?? []) {
        expect(sentence.length, line.name).toBeGreaterThan(10);
      }
    }
    // Non-vacuous in both directions: some lines carry one and most do not.
    const carrying = saves.filter((line) => (line.save?.handedOver?.length ?? 0) > 0);
    expect(carrying.length).toBeGreaterThan(3);
    expect(carrying.length).toBeLessThan(saves.length / 2);
  });
});
