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
    // SRD Water Elemental's Whelm: the Grappled is read, and the sentence
    // after it says three things at once — a Restrained, a suffocation and
    // damage at a turn boundary — so it is carried whole rather than read
    // down to the third of it this vocabulary could hold.
    const whelm = lineOf('water-elemental', 'Whelm').save;
    expect(whelm?.onFailure).toEqual([
      { kind: 'condition', condition: 'grappled', escapeDc: 14, ifNoLargerThan: 'large' },
    ]);
    expect(whelm?.handedOver?.[0]).toMatch(/^Until the grapple ends, the target has the Restrained/);
  });

  it('reads a second damage component after "plus"', () => {
    // SRD Vampire Spawn's Bite; the maximum lowered by the *Necrotic* damage
    // and the vampire's regained Hit Points are carried.
    const bite = lineOf('vampire-spawn', 'Bite').save;
    expect(bite?.damage).toEqual({ dice: '1d4', flat: 3, type: 'piercing', average: 5 });
    expect(bite?.plus).toEqual({ dice: '3d6', flat: 0, type: 'necrotic', average: 10 });
    expect(bite?.handedOver).toHaveLength(1);
  });

  it('reads a grapple that carries a condition for as long as it holds', () => {
    // SRD Couatl: "The target has the Grappled condition (escape DC 13), and
    // it has the Restrained condition until the grapple ends." One sentence
    // and one lifetime — the hold's — so the Restrained is filed as something
    // the grapple *implies* rather than as a condition of its own.
    expect(lineOf('couatl', 'Constrict').save).toEqual({
      ability: 'str',
      dc: 15,
      targets: 'one Medium or smaller creature the couatl can see within 5 feet',
      damage: { dice: '1d6', flat: 5, type: 'bludgeoning', average: 8 },
      onSuccess: 'none',
      onFailure: [
        { kind: 'condition', condition: 'grappled', escapeDc: 13, implies: ['restrained'] },
      ],
    });
    // SRD Salamander prints the same sentence at its own numbers, after two
    // damage components.
    const constrict = lineOf('salamander', 'Constrict').save;
    expect(constrict?.plus).toEqual({ dice: '2d6', flat: 0, type: 'fire', average: 7 });
    expect(constrict?.onFailure).toEqual([
      { kind: 'condition', condition: 'grappled', escapeDc: 14, implies: ['restrained'] },
    ]);
    expect(constrict?.handedOver).toBeUndefined();
  });

  it('reads a condition another condition carries', () => {
    // SRD Chuul: "While Poisoned, the target has the Paralyzed condition." A
    // sentence about the Poisoned this line imposed, not about the condition,
    // so it is read onto the instance that carries it.
    expect(lineOf('chuul', 'Paralyzing Tentacles').save).toEqual({
      ability: 'con',
      dc: 13,
      targets: 'one creature Grappled by the chuul',
      onSuccess: 'none',
      onFailure: [
        {
          kind: 'condition',
          condition: 'poisoned',
          implies: ['paralyzed'],
          repeats: { at: 'end', of: 'target', capSeconds: 60 },
        },
      ],
    });
  });

  it('reads the one line whose failure kills, and what it buys the creature that forced it', () => {
    // SRD Will-o'-Wisp: "_Failure:_ The target dies, and the wisp regains 10
    // (3d6) Hit Points." The one part of a targeting clause this reader takes
    // is the ceiling on it — "that has 0 Hit Points" — because a sentence that
    // kills outright is the last one to take a caller's word for.
    expect(lineOf('will-o-wisp', 'Consume Life').save).toEqual({
      ability: 'con',
      dc: 10,
      targets: 'one living creature the wisp can see within 5 feet that has 0 Hit Points',
      onSuccess: 'none',
      onFailure: [
        {
          kind: 'dies',
          ifHitPointsAtMost: 0,
          sourceRegains: { dice: '3d6', flat: 0, average: 10 },
        },
      ],
    });
  });

  it('refuses a failure that kills with no ceiling on who it may be forced on', () => {
    // The Will-o'-Wisp's sentence with its targeting clause's restriction
    // taken away: a DC 10 save that kills a creature at full health is a rule
    // nobody printed, so the line stays prose rather than reaching a caller.
    expect(
      parseSaveLine(
        '_Constitution Saving Throw:_ DC 10, one living creature the wisp can see within 5 feet. _Failure:_ The target dies, and the wisp regains 10 (3d6) Hit Points.',
      ),
    ).toBeNull();
  });

  it('reads a curse that is only conditions as those conditions, for the curse’s span', () => {
    // SRD Lamia: "the target is cursed for 1 hour. Until the curse ends, the
    // target has the Charmed and Poisoned conditions." Two sentences and one
    // rule; read together or carried together.
    expect(lineOf('lamia', 'Corrupting Touch').save).toEqual({
      ability: 'wis',
      dc: 13,
      targets: 'one creature the lamia can see within 5 feet',
      damage: { dice: '3d8', flat: 0, type: 'psychic', average: 13 },
      onSuccess: 'none',
      onFailure: [
        { kind: 'condition', condition: 'charmed', lasts: { kind: 'seconds', seconds: 3600 } },
        { kind: 'condition', condition: 'poisoned', lasts: { kind: 'seconds', seconds: 3600 } },
      ],
    });
  });

  it('reads no save off a trait, whose moment is not a use', () => {
    // SRD Ghast's Stench is the template word for word, forced on "any
    // creature that starts its turn" in the aura — nothing a creature spends.
    const stench = lineOf('ghast', 'Stench');
    expect(stench.text).toContain('Saving Throw:_');
    expect(stench.save).toBeUndefined();
  });
});

describe('a failure the line grades', () => {
  it('reads a first rung that repeats and a second rung that deepens it', () => {
    // SRD Gorgon: "_First Failure:_ The target has the Restrained condition
    // and repeats the save at the end of its next turn if it is still
    // Restrained, ending the effect on itself on a success. _Second Failure:_
    // The target has the Petrified condition instead of the Restrained
    // condition." One condition, one repeat, and what the repeat's failure
    // leaves behind — which is `RepeatSave.onFailure` word for word.
    expect(lineOf('gorgon', 'Petrifying Breath').save).toEqual({
      ability: 'con',
      dc: 15,
      targets: 'each creature in a 30-foot Cone',
      onSuccess: 'none',
      onFailure: [
        {
          kind: 'condition',
          condition: 'restrained',
          repeats: { at: 'end', of: 'target', onFailure: { condition: 'petrified' } },
        },
      ],
    });
  });

  it('carries the prose a line prints between its targets and its first rung', () => {
    // SRD Basilisk prints the Gorgon's sentence with one more of its own:
    // "If the basilisk sees its reflection in the Cone, the basilisk must
    // make this save." Nothing here makes a creature save against itself, so
    // the sentence is handed over and the line still owes it.
    const gaze = lineOf('basilisk', 'Petrifying Gaze').save;
    expect(gaze?.dc).toBe(12);
    expect(gaze?.onFailure).toEqual([
      {
        kind: 'condition',
        condition: 'restrained',
        repeats: { at: 'end', of: 'target', onFailure: { condition: 'petrified' } },
      },
    ]);
    expect(gaze?.handedOver).toEqual([
      'If the basilisk sees its reflection in the Cone, the basilisk must make this save.',
    ]);
  });

  it('reads a failure graded by how far the save missed', () => {
    // SRD Pseudodragon: "_Failure by 5 or More:_ While Poisoned, the target
    // also has the Unconscious condition, which ends early if…" — the same
    // failure with one more thing riding on the condition it imposed, chosen
    // by a margin the engine already has from the roll it made.
    const poisoned = {
      kind: 'condition',
      condition: 'poisoned',
      lasts: { kind: 'seconds', seconds: 3600 },
    };
    expect(lineOf('pseudodragon', 'Sting').save).toEqual({
      ability: 'con',
      dc: 12,
      targets: 'one creature the pseudodragon can see within 5 feet',
      damage: { dice: '2d4', flat: 0, type: 'poison', average: 5 },
      onSuccess: 'none',
      onFailure: [poisoned],
      onFailureBy: { by: 5, effects: [{ ...poisoned, implies: ['unconscious'] }] },
      // Under its own heading, so the fragment reaches a table with the rung
      // it was printed under rather than with no antecedent at all.
      handedOver: [
        '_Failure by 5 or More:_ which ends early if the target takes damage or a creature within 5 feet of it takes an action to wake it.',
      ],
    });
  });
});

describe('the lines the reader does not reach', () => {
  it('refuses a clause it cannot start on, rather than rolling a save for nothing', () => {
    // SRD Sea Hag's Death Glare: "If the target has 20 Hit Points or fewer, it
    // drops to 0 Hit Points." SRD Copper Dragon Wyrmling's Slowing Breath.
    expect(lineOf('sea-hag', 'Death Glare').save).toBeUndefined();
    expect(lineOf('copper-dragon-wyrmling', 'Slowing Breath').save).toBeUndefined();
  });

  it('refuses a graded failure whose second rung it cannot hold', () => {
    // SRD Brass Dragon Wyrmling's Sleep Breath deepens to "the Unconscious
    // condition **for 1 minute**", and SRD Silver Dragon Wyrmling's deepens to
    // a Paralyzed that repeats its own save. `repeats.onFailure` is a bare
    // condition name — a span and a second repeat are not on it — so the
    // deeper rung would be applied forever, which is worse than handing the
    // line over. Refused whole, as the family was before.
    expect(lineOf('brass-dragon-wyrmling', 'Sleep Breath').save).toBeUndefined();
    expect(lineOf('silver-dragon-wyrmling', 'Paralyzing Breath').save).toBeUndefined();
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
