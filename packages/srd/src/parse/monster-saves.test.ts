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
 * **What is read is the template, the sentence before it and the regular
 * clauses after it.** A movement printed before the save still refuses the
 * line whole; a **trigger** printed there is read into `MonsterSave.trigger`,
 * which is what lets a Death Burst and a start-of-turn aura be read at all —
 * the fold raises the save the moment settles and no caller can spend it. A
 * damage type the block leaves to another trait comes back as `declared`,
 * which is a word and not a type. After the opening, `parsePrintedSave` reads the six
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

describe('a failure hung on the target’s own rolls', () => {
  /**
   * SRD Gold Dragon Wyrmling's Weakening Breath: a mode over a family narrowed
   * by an ability, a penalty on the target's own damage rolls, and a repeat
   * save with a cap that both clauses share — the failure imposes no
   * condition, so the repeat is about the two clauses themselves. Nothing is
   * handed over, and the targeting clause's "isn't currently affected" is read
   * as the fact it is.
   */
  it('reads the Weakening Breath whole: the family, the ability, the penalty, one shared repeat and its cap', () => {
    const breath = lineOf('gold-dragon-wyrmling', 'Weakening Breath').save;
    const repeats = { at: 'end', of: 'target', capSeconds: 60 };
    expect(breath).toEqual({
      ability: 'str',
      dc: 13,
      targets: "each creature that isn't currently affected by this breath in a 15-foot Cone",
      onlyIfNotAffected: true,
      onSuccess: 'none',
      onFailure: [
        { kind: 'roll-mode', mode: 'disadvantage', rolls: ['d20-test'], ability: 'str', repeats },
        { kind: 'damage-penalty', dice: '1d4', flat: 0, average: 2, repeats },
      ],
    });
  });

  it('refuses a mode over a family with no ending printed under it', () => {
    // The same sentence with the repeat and the cap taken off is a
    // Disadvantage nothing ever lifts, which is the refusal every lasting
    // clause has always made.
    expect(
      parseSaveLine(
        '_Strength Saving Throw:_ DC 13, each creature in a 15-foot Cone. _Failure:_ The target has Disadvantage on Strength-based D20 Tests and subtracts 2 (1d4) from its damage rolls.',
      ),
    ).toBeNull();
  });

  it('caps a repeat only where one was printed, and hands the cap over otherwise', () => {
    // "After 1 minute" with no repeat above it caps nothing; the mode itself
    // then has no lifetime, and the whole line stays prose.
    expect(
      parseSaveLine(
        '_Strength Saving Throw:_ DC 13, one creature. _Failure:_ The target has Disadvantage on Strength-based D20 Tests. After 1 minute, it succeeds automatically.',
      ),
    ).toBeNull();
    // A span printed under the mode is the second lifetime, and reads.
    const spanned = parseSaveLine(
      '_Strength Saving Throw:_ DC 13, one creature. _Failure:_ The target has Disadvantage on Dexterity-based D20 Tests. This effect lasts until the end of its next turn.',
    );
    expect(spanned?.onFailure).toEqual([
      {
        kind: 'roll-mode',
        mode: 'disadvantage',
        rolls: ['d20-test'],
        ability: 'dex',
        lasts: { kind: 'turn', moment: 'end', of: 'target' },
      },
    ]);
  });
});

describe('a save aimed at an object somebody is wearing or holding', () => {
  /**
   * SRD Rust Monster's Antennae: the prelude names the object, the failure
   * wears it down, the second sentence states the two ceilings the executor
   * keeps and is consumed, and the Mending sentence is carried — the spells
   * side's, not this reader's.
   */
  it('reads the Antennae: the object the prelude names, the penalty, the ceilings, and hands the Mending over', () => {
    expect(lineOf('rust-monster', 'Antennae').save).toEqual({
      ability: 'dex',
      dc: 11,
      targets: 'the creature with the object',
      targetsObject: true,
      onSuccess: 'none',
      onFailure: [{ kind: 'object-penalty', points: 1 }],
      handedOver: ['The penalty can be removed by casting the _Mending_ spell on the armor or weapon.'],
    });
  });

  it('hands the ceilings back where no penalty stands in front of them', () => {
    // The rule sentence alone is a rule about nothing, and a failure the
    // grammar reads nothing out of refuses the line whole.
    expect(
      parseSaveLine(
        '_Dexterity Saving Throw:_ DC 11, the creature with the object. _Failure:_ Armor is destroyed if the penalty reduces its AC to 10, and a weapon is destroyed if its penalty reaches −5.',
      ),
    ).toBeNull();
  });
});

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
      // The other fact a targeting clause gives up, beside the Hit Point
      // ceiling a `dies` is gated by: a trample is forced on a creature that
      // is already down, and whether it is down is the engine's own to check.
      onlyIfTargetHas: { conditions: ['prone'] },
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
    // target's own. What the second sentence says is read now, and is the
    // subject of its own describe block below; here only the anchor matters.
    const cloud = lineOf('dretch', 'Fetid Cloud').save;
    expect(cloud?.onFailure?.[0]).toEqual({
      kind: 'condition',
      condition: 'poisoned',
      lasts: { kind: 'turn', moment: 'end', of: 'target' },
    });
    expect(cloud?.handedOver).toBeUndefined();
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

  it('reads a success that buys a day of immunity to the line itself', () => {
    // SRD Mummy's Dreadful Glare: the Frightened is read, and so is the one
    // sentence the corpus prints under `_Success:_` that is not "Half damage".
    // It is an immunity to **this line**, not to the Frightened condition —
    // another mummy's glare still catches them.
    expect(lineOf('mummy', 'Dreadful Glare').save).toEqual({
      ability: 'wis',
      dc: 11,
      targets: 'one creature the mummy can see within 60 feet',
      onSuccess: 'none',
      onSuccessEffects: [{ kind: 'line-immunity', line: 'Dreadful Glare', seconds: 86400 }],
      onFailure: [
        {
          kind: 'condition',
          condition: 'frightened',
          lasts: { kind: 'turn', moment: 'end', of: 'source' },
        },
      ],
    });
    // The heading the sentence names is carried, because this reader is handed
    // a line's text without its heading and the executor is where the two meet.
    expect(lineOf('ghost', 'Horrific Visage').save?.onSuccessEffects).toEqual([
      { kind: 'line-immunity', line: 'Horrific Visage', seconds: 86400 },
    ]);
  });

  it("reads the Water Elemental's whelm: a hold that carries a condition and owes a payout", () => {
    // "Until the grapple ends, the target has the Restrained condition, is
    // suffocating unless it can breathe water, and takes 9 (2d8) Bludgeoning
    // damage at the start of each of the elemental's turns." Two of the three
    // are primitives the engine has; the suffocation is not, and goes into
    // `handedOver` under the book's own opening.
    const whelm = lineOf('water-elemental', 'Whelm').save;
    expect(whelm?.onFailure).toEqual([
      {
        kind: 'condition',
        condition: 'grappled',
        escapeDc: 14,
        ifNoLargerThan: 'large',
        implies: ['restrained'],
        payout: {
          damage: { dice: '2d8', flat: 0, type: 'bludgeoning', average: 9 },
          at: 'start',
          // "each of **the elemental's** turns" — the holder's boundary, a
          // round away from the creature that pays.
          onTurnOf: 'source',
        },
      },
    ]);
    expect(whelm?.handedOver).toEqual([
      'Until the grapple ends, the target is suffocating unless it can breathe water.',
      'The elemental can grapple one Large creature or up to two Medium or smaller creatures at a time with Whelm.',
      'As an action, a creature within 5 feet of the elemental can pull a creature out of it by succeeding on a DC 14 Strength (Athletics) check.',
    ]);
  });

  it('reads a second damage component after "plus", and the bite that feeds on it', () => {
    // SRD Vampire Spawn's Bite: the maximum lowered by the **Necrotic**
    // component alone, and what the target lost the vampire gains.
    const bite = lineOf('vampire-spawn', 'Bite').save;
    expect(bite?.damage).toEqual({ dice: '1d4', flat: 3, type: 'piercing', average: 5 });
    expect(bite?.plus).toEqual({ dice: '3d6', flat: 0, type: 'necrotic', average: 10 });
    expect(bite?.onFailure).toEqual([
      {
        kind: 'hit-point-maximum-decrease',
        by: 'damage-taken',
        ofType: 'necrotic',
        sourceRegains: 'the-amount',
      },
    ]);
    // "one creature within 5 feet that is willing or that has the Grappled,
    // Incapacitated, or Restrained condition": the conditions are the
    // engine's, the willingness is the table's.
    expect(bite?.onlyIfTargetHas).toEqual({
      conditions: ['grappled', 'incapacitated', 'restrained'],
      orWilling: true,
    });
    expect(bite?.handedOver).toBeUndefined();
    // The Wight's is the same clause with neither half: the whole of what the
    // line dealt, and nothing given back.
    expect(lineOf('wight', 'Life Drain').save?.onFailure).toEqual([
      { kind: 'hit-point-maximum-decrease', by: 'damage-taken' },
    ]);
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

  it('reads a mode a condition this line imposed carries', () => {
    // SRD Swarm of Ravens: "The target has the Deafened condition until the
    // start of the swarm's next turn. While Deafened, the target also has
    // Disadvantage on ability checks and attack rolls." The second sentence
    // names no span of its own: its lifetime is the Deafened's, which is what
    // `whileCondition` says — and the Deafened is the one the first sentence
    // imposed, so nothing here is a mode with no end.
    expect(lineOf('swarm-of-ravens', 'Cacophony').save).toEqual({
      ability: 'wis',
      dc: 10,
      targets: "one creature in the swarm's space",
      onSuccess: 'none',
      onFailure: [
        {
          kind: 'condition',
          condition: 'deafened',
          lasts: { kind: 'turn', moment: 'start', of: 'source' },
        },
        {
          kind: 'roll-mode',
          mode: 'disadvantage',
          rolls: ['ability-check', 'attack-roll'],
          whileCondition: 'deafened',
        },
      ],
    });
  });

  it('hands over a mode said about a condition the line did not impose', () => {
    // The same sentence with the host changed: a "While Frightened" on a line
    // that imposed no Frightened names a lifetime that is not there, so there
    // is nothing for the mode to live on and the sentence is carried. The same
    // answer `WHILE_CONDITION` already gives a condition it cannot find.
    const read = parseSaveLine(
      "_Wisdom Saving Throw:_ DC 10, one creature in the swarm's space. _Failure:_ The target has the Deafened condition until the start of the swarm's next turn. While Frightened, the target also has Disadvantage on ability checks and attack rolls.",
    );
    expect(read?.onFailure).toEqual([
      {
        kind: 'condition',
        condition: 'deafened',
        lasts: { kind: 'turn', moment: 'start', of: 'source' },
      },
    ]);
    expect(read?.handedOver).toEqual([
      'While Frightened, the target also has Disadvantage on ability checks and attack rolls.',
    ]);
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

  it('reads a trait’s save, whose moment is not a use', () => {
    // SRD Ghast's Stench is the template word for word, forced on "any
    // creature that starts its turn" in the aura — nothing a creature spends,
    // and therefore a save nobody would ever roll if the moment were not read.
    expect(lineOf('ghast', 'Stench').save).toEqual({
      ability: 'con',
      dc: 10,
      targets: 'any creature that starts its turn in a 5-foot Emanation originating from the ghast',
      trigger: { kind: 'starts-turn-within', feet: 5, emanation: true },
      onSuccess: 'none',
      onFailure: [
        {
          kind: 'condition',
          condition: 'poisoned',
          lasts: { kind: 'turn', moment: 'start', of: 'target' },
        },
      ],
      onSuccessEffects: [{ kind: 'line-immunity', line: 'Stench', seconds: 86400 }],
    });
  });
});

describe('a save a moment forces', () => {
  it('reads a Death Burst as the sentence before the opening', () => {
    // SRD Magmin: "The magmin explodes when it dies." The trigger is what
    // keeps this off `forcePrintedSave` — a line a caller could spend would be
    // a Death Burst a creature detonates on purpose.
    expect(lineOf('magmin', 'Death Burst').save).toEqual({
      ability: 'dex',
      dc: 11,
      targets: 'each creature in a 10-foot Emanation originating from the magmin',
      trigger: { kind: 'dies' },
      damage: { dice: '2d6', flat: 0, type: 'fire', average: 7 },
      onSuccess: 'half',
    });
  });

  it('reads all five Death Bursts, each with its own emanation and type', () => {
    const bursts = ['magmin', 'dust-mephit', 'ice-mephit', 'magma-mephit', 'steam-mephit'].map(
      (id) => lineOf(id, 'Death Burst').save,
    );
    expect(bursts.every((save) => save?.trigger?.kind === 'dies')).toBe(true);
    expect(bursts.map((save) => save?.damage?.type)).toEqual([
      'fire',
      'bludgeoning',
      'cold',
      'fire',
      'fire',
    ]);
    expect(bursts.map((save) => save?.onSuccess)).toEqual(['half', 'half', 'half', 'half', 'half']);
  });

  it('reads an aura gated on the holder not being Incapacitated, and carries its table', () => {
    // SRD Gibbering Mouther: "The mouther babbles incoherently while it
    // doesn't have the Incapacitated condition. ... any creature that starts
    // its turn within 20 feet of the mouther **while it is babbling**." Two
    // sentences and one gate, read together.
    const save = lineOf('gibbering-mouther', 'Gibbering').save;
    expect(save?.trigger).toEqual({
      kind: 'starts-turn-within',
      feet: 20,
      onlyIf: 'holder-not-incapacitated',
    });
    expect(save?.ability).toBe('wis');
    expect(save?.dc).toBe(10);
    // The d8 table is the table's, and is handed back whole at the moment the
    // save fails rather than keeping the moment from ever arriving.
    expect(save?.onFailure).toBeUndefined();
    expect(save?.handedOver?.[0]).toContain('rolls 1d8');
    expect(save?.handedOver?.join(' ')).toContain('random direction');
  });

  it('reads an aura narrowed to creature types and to what the target can see', () => {
    expect(lineOf('sea-hag', 'Vile Appearance').save).toEqual({
      ability: 'wis',
      dc: 11,
      targets:
        "any Beast or Humanoid that starts its turn within 30 feet of the hag and can see the hag's true form",
      trigger: { kind: 'starts-turn-within', feet: 30, onlyIf: 'can-see-holder' },
      onlyIfTargetType: ['Beast', 'Humanoid'],
      onSuccess: 'none',
      onFailure: [
        {
          kind: 'condition',
          condition: 'frightened',
          lasts: { kind: 'turn', moment: 'start', of: 'target' },
        },
      ],
      onSuccessEffects: [{ kind: 'line-immunity', line: 'Vile Appearance', seconds: 86400 }],
    });
  });

  it('refuses a prelude it cannot read, and a babbling nothing declared', () => {
    // A sentence before the opening that is not one of the two the book writes
    // there is still a rule, and half a rule is nobody's.
    expect(
      parseSaveLine(
        'The bulette spends 5 feet of movement to jump. _Dexterity Saving Throw:_ DC 11, ' +
          'each creature in a 15-foot Cone. _Failure:_ 7 (2d6) Fire damage.',
      ),
    ).toBeNull();
    // And "while it is babbling" with nothing that says what babbling is names
    // a gate that is not there.
    expect(
      parseSaveLine(
        '_Wisdom Saving Throw:_ DC 10, any creature that starts its turn within 20 feet of ' +
          'the mouther while it is babbling. _Failure:_ 7 (2d6) Psychic damage.',
      ),
    ).toBeNull();
  });

  it('refuses a start-of-turn clause whose shape it cannot read', () => {
    // SRD Pit Fiend's Fear Aura names the aura in a sentence of its own — "any
    // enemy that starts its turn in the aura" — and a radius that is not in
    // the clause is a radius this cannot measure.
    expect(
      parseSaveLine(
        '_Wisdom Saving Throw:_ DC 21, any enemy that starts its turn in the aura. ' +
          '_Failure:_ The target has the Frightened condition until the start of its next turn.',
      ),
    ).toBeNull();
  });
});

describe('a damage type the block leaves to the table', () => {
  it('reads the Half-Dragon’s breath with the type still unanswered', () => {
    expect(lineOf('half-dragon', "Dragon's Breath").save).toEqual({
      ability: 'dex',
      dc: 14,
      targets: 'each creature in a 30-foot Cone',
      damage: { dice: '8d6', flat: 0, type: 'declared', average: 28 },
      onSuccess: 'half',
    });
  });

  it('still refuses a word in the type slot that is not a damage type', () => {
    expect(
      parseSaveLine(
        '_Dexterity Saving Throw:_ DC 12, each creature in a 15-foot Cone. ' +
          '_Failure:_ 17 (5d6) Sonorous damage. _Success:_ Half damage.',
      ),
    ).toBeNull();
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

  /**
   * SRD Brass Dragon Wyrmling's Sleep Breath: "_Failure:_ The target has the
   * Incapacitated condition until the end of its next turn, at which point it
   * repeats the save. _Second Failure:_ The target has the Unconscious
   * condition for 1 minute. This effect ends for the target if it takes damage
   * or a creature within 5 feet of it takes an action to wake it."
   *
   * Three things this family prints and the Gorgon's does not. The first rung
   * names the repeat's **moment** rather than a span of its own — "until the
   * end of its next turn, at which point it repeats the save" is one moment
   * said twice, and what the moment does is change the condition — the second
   * rung carries a lifetime of its own, and that lifetime has two early
   * endings the engine now spends: a blow, and a neighbour's action.
   */
  it('reads a second rung that deepens into a span of its own, and its two early endings', () => {
    expect(lineOf('brass-dragon-wyrmling', 'Sleep Breath').save).toEqual({
      ability: 'con',
      dc: 11,
      targets: 'each creature in a 15-foot Cone',
      onSuccess: 'none',
      onFailure: [
        {
          kind: 'condition',
          condition: 'incapacitated',
          repeats: {
            at: 'end',
            of: 'target',
            onFailure: {
              condition: 'unconscious',
              lasts: { kind: 'seconds', seconds: 60 },
              endsOnDamage: true,
              endsWhenWoken: true,
            },
          },
        },
      ],
    });
  });

  /**
   * SRD Silver Dragon Wyrmling's Paralyzing Breath: "_First Failure:_ The
   * target has the Incapacitated condition until the end of its next turn,
   * when it repeats the save. _Second Failure:_ The target has the Paralyzed
   * condition, and it repeats the save at the end of each of its turns, ending
   * the effect on itself on a success. After 1 minute, it succeeds
   * automatically."
   *
   * The other thing a second rung can carry: a repeat of its own, standing
   * rather than one-shot, with the minute it succeeds automatically after as
   * its cap. Nothing is handed over — the whole line is read.
   */
  it('reads a second rung that deepens into a repeat of its own', () => {
    expect(lineOf('silver-dragon-wyrmling', 'Paralyzing Breath').save).toEqual({
      ability: 'con',
      dc: 13,
      targets: 'each creature in a 15-foot Cone',
      onSuccess: 'none',
      onFailure: [
        {
          kind: 'condition',
          condition: 'incapacitated',
          repeats: {
            at: 'end',
            of: 'target',
            onFailure: {
              condition: 'paralyzed',
              repeats: { at: 'end', of: 'target', capSeconds: 60 },
            },
          },
        },
      ],
    });
  });

  /** And the same sentences at every tier the family prints them at. */
  it('reads the whole of both families, wyrmling to ancient', () => {
    const deepening = (id: string, line: string) => {
      const save = lineOf(id, line).save;
      const [clause] = save?.onFailure ?? [];
      return clause?.kind === 'condition' ? clause.repeats?.onFailure : undefined;
    };
    for (const id of ['young-brass-dragon', 'adult-brass-dragon', 'ancient-brass-dragon']) {
      expect(deepening(id, 'Sleep Breath')?.condition).toBe('unconscious');
      expect(deepening(id, 'Sleep Breath')?.lasts?.kind).toBe('seconds');
    }
    // The two older Brass Dragons print ten minutes where the wyrmling prints
    // one, which is the span being read rather than assumed.
    expect(deepening('adult-brass-dragon', 'Sleep Breath')?.lasts).toEqual({
      kind: 'seconds',
      seconds: 600,
    });
    for (const id of ['young-silver-dragon', 'adult-silver-dragon', 'ancient-silver-dragon']) {
      expect(deepening(id, 'Paralyzing Breath')?.repeats).toEqual({
        at: 'end',
        of: 'target',
        capSeconds: 60,
      });
    }
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
      // With the noun the book's "which" names: it is the **Unconscious**
      // that ends early and not the Poisoned hour carrying it, which is the
      // whole reason the two marks are a list of names rather than a flag.
      onFailureBy: {
        by: 5,
        effects: [
          {
            ...poisoned,
            implies: ['unconscious'],
            endsOnDamage: ['unconscious'],
            endsWhenWoken: ['unconscious'],
          },
        ],
      },
    });
  });
});

/**
 * "If the target has N Hit Points or fewer, … . Otherwise, the target takes …"
 *
 * Two sentences that are one rule: which of them happens is decided by a
 * number the engine already holds about the target, so the reader keeps them
 * together as a single `branch` clause and refuses both where it cannot read
 * either arm. Three lines in the corpus print it — SRD Sea Hag, SRD Incubus
 * and SRD Solar — and the first two are read here.
 */
describe('a failure that branches on the target’s Hit Points', () => {
  it('reads the Sea Hag’s glare: a drop to 0 under the ceiling, damage over it', () => {
    expect(lineOf('sea-hag', 'Death Glare').save).toEqual({
      ability: 'wis',
      dc: 11,
      targets: 'one Frightened creature the hag can see within 30 feet',
      onSuccess: 'none',
      onFailure: [
        {
          kind: 'branch',
          ifHitPointsAtMost: 20,
          then: [{ kind: 'drops-to-zero' }],
          otherwise: { damage: { dice: '3d8', flat: 0, type: 'psychic', average: 13 } },
        },
      ],
    });
  });

  it('reads the Incubus’ nightmare whole, early endings and all', () => {
    expect(lineOf('incubus', 'Nightmare').save).toEqual({
      ability: 'wis',
      dc: 15,
      targets: 'one creature the incubus can see within 60 feet',
      onSuccess: 'none',
      onFailure: [
        {
          kind: 'branch',
          ifHitPointsAtMost: 20,
          then: [
            {
              kind: 'condition',
              condition: 'unconscious',
              lasts: { kind: 'seconds', seconds: 3600 },
              endsOnDamage: ['unconscious'],
              endsWhenWoken: ['unconscious'],
            },
          ],
          otherwise: { damage: { dice: '4d8', flat: 0, type: 'psychic', average: 18 } },
        },
      ],
    });
  });

  /**
   * The same clause outside a branch, which is where the reader gained it:
   * SRD Nalfeshnee's Horror Nimbus prints "the Frightened condition **for 1
   * minute, until it takes damage, or until it ends its turn with the
   * nalfeshnee out of line of sight**", and the minute used to be handed over
   * with the two early endings rather than applied.
   */
  it('applies a printed span and carries the early endings beside it', () => {
    const nimbus = lineOf('nalfeshnee', 'Horror Nimbus').save!;
    expect(nimbus.onFailure).toEqual([
      { kind: 'condition', condition: 'frightened', lasts: { kind: 'seconds', seconds: 60 } },
    ]);
    expect(nimbus.handedOver).toContain(
      'The Frightened condition ends early: until it takes damage, or until it ends its turn with the nalfeshnee out of line of sight.',
    );
    // **And the pair is read only when it is the pair.** The Incubus' tail is
    // a blow and a neighbour's action, both verbs the engine spends; this one
    // ends on a line of sight nothing here holds, so the whole tail is carried
    // exactly as it always was and neither mark is set.
    expect(nimbus.onFailure).toEqual([
      { kind: 'condition', condition: 'frightened', lasts: { kind: 'seconds', seconds: 60 } },
    ]);
  });

  it('refuses the pair where the "Otherwise" sentence is not damage', () => {
    // Half a branch is worse than none: a ceiling with no arm under it is a
    // rule that decides nothing, and an arm with no ceiling is a rule that
    // always fires. Both sentences are carried instead.
    const read = parseSaveLine(
      '_Wisdom Saving Throw:_ DC 11, one creature. _Failure:_ If the target has 20 Hit Points or fewer, it drops to 0 Hit Points. Otherwise, the target is sad.',
    );
    expect(read).toBeNull();
  });

  it('refuses a ceiling whose own arm it cannot read', () => {
    const read = parseSaveLine(
      '_Wisdom Saving Throw:_ DC 11, one creature. _Failure:_ If the target has 20 Hit Points or fewer, it is sad. Otherwise, the target takes 13 (3d8) Psychic damage.',
    );
    expect(read).toBeNull();
  });
});

/**
 * "It can take either an action or a Bonus Action on its turn, not both."
 *
 * A rule about what the target's turn may hold, printed in two dressings: the
 * Dretch hangs it on the condition the same failure imposed, and the Copper
 * Dragons print a list of clauses separated by semicolons with one span
 * underneath them all. Both need the same two things the reader did not have —
 * a clause that carries a rule about a turn, and a lifetime that may be either
 * a printed span or a condition instance.
 */
describe('a failure that changes what a turn may hold', () => {
  it('reads the Dretch’s cloud whole, hung on the Poisoned it imposed', () => {
    // SRD Dretch: "The target has the Poisoned condition until the end of its
    // next turn. While Poisoned, the creature can take either an action or a
    // Bonus Action on its turn, not both, and it can't take Reactions."
    // The second sentence names no span: its lifetime is the Poisoned's, the
    // same thing `roll-mode`'s `whileCondition` says about the Ravens'.
    expect(lineOf('dretch', 'Fetid Cloud').save).toEqual({
      ability: 'con',
      dc: 11,
      targets: 'each creature in a 10-foot Emanation originating from the dretch',
      onSuccess: 'none',
      onFailure: [
        {
          kind: 'condition',
          condition: 'poisoned',
          lasts: { kind: 'turn', moment: 'end', of: 'target' },
        },
        {
          kind: 'action-rule',
          rule: { kind: 'one-of', slots: ['action', 'bonus-action'] },
          whileCondition: 'poisoned',
        },
        {
          kind: 'action-rule',
          rule: { kind: 'forbids', slots: ['reaction'] },
          whileCondition: 'poisoned',
        },
      ],
    });
  });

  it('reads the Copper Dragon’s breath whole: three clauses under one span', () => {
    // SRD Copper Dragon Wyrmling: "The target can't take Reactions; its Speed
    // is halved; and it can take either an action or a Bonus Action on its
    // turn, not both. This effect lasts until the end of its next turn."
    // A semicolon list, and a span printed once for everything above it.
    const lasts = { kind: 'turn', moment: 'end', of: 'target' };
    expect(lineOf('copper-dragon-wyrmling', 'Slowing Breath').save).toEqual({
      ability: 'con',
      dc: 11,
      targets: 'each creature in a 15-foot Cone',
      onSuccess: 'none',
      onFailure: [
        { kind: 'action-rule', rule: { kind: 'forbids', slots: ['reaction'] }, lasts },
        { kind: 'speed-halved', lasts },
        { kind: 'action-rule', rule: { kind: 'one-of', slots: ['action', 'bonus-action'] }, lasts },
      ],
    });
  });

  it('reads the same sentence on every Copper Dragon the book prints it on', () => {
    for (const id of [
      'young-copper-dragon',
      'adult-copper-dragon',
      'ancient-copper-dragon',
    ]) {
      const breath = lineOf(id, 'Slowing Breath').save;
      expect(breath?.onFailure?.map((effect) => effect.kind), id).toEqual([
        'action-rule',
        'speed-halved',
        'action-rule',
      ]);
      expect(breath?.handedOver, id).toBeUndefined();
    }
  });

  it('refuses a rule with no lifetime at all', () => {
    // The Copper Dragon's sentence with the span taken off it. A rule about a
    // turn that ends at no moment and hangs on no condition is one nothing
    // would ever lift, which is the answer the mode clause already gives.
    expect(
      parseSaveLine(
        "_Constitution Saving Throw:_ DC 11, each creature in a 15-foot Cone. _Failure:_ The target can't take Reactions; its Speed is halved; and it can take either an action or a Bonus Action on its turn, not both.",
      ),
    ).toBeNull();
  });

  it('hands over a rule said about a condition the line did not impose', () => {
    // The Dretch's sentence with the host changed: a "While Frightened" on a
    // line that imposed no Frightened names a lifetime that is not there.
    const read = parseSaveLine(
      "_Constitution Saving Throw:_ DC 11, each creature in a 10-foot Emanation originating from the dretch. _Failure:_ The target has the Poisoned condition until the end of its next turn. While Frightened, the creature can take either an action or a Bonus Action on its turn, not both, and it can't take Reactions.",
    );
    expect(read?.onFailure).toEqual([
      {
        kind: 'condition',
        condition: 'poisoned',
        lasts: { kind: 'turn', moment: 'end', of: 'target' },
      },
    ]);
    expect(read?.handedOver).toEqual([
      "While Frightened, the creature can take either an action or a Bonus Action on its turn, not both, and it can't take Reactions.",
    ]);
  });

  it('refuses a semicolon list one of whose clauses it cannot read', () => {
    // The transaction the whole reader is written under, over the new split:
    // a list is read whole or handed over whole, never half-applied. Nothing
    // of it reaches a caller, which is what null says here — the two clauses
    // it *could* read are discarded with the one it could not.
    const read = parseSaveLine(
      "_Constitution Saving Throw:_ DC 11, each creature in a 15-foot Cone. _Failure:_ The target can't take Reactions; its Speed is halved; and it is sad. This effect lasts until the end of its next turn.",
    );
    expect(read).toBeNull();
  });

  /**
   * SRD Adult Brass Dragon, Scorching Sands: "27 (6d8) Fire damage, and the
   * target's Speed is halved **until the end of its next turn**."
   *
   * The halving with a span of its own, which is the other way the corpus
   * prints the clause and the arm no Copper Dragon exercises — theirs is
   * printed once underneath a list. A reader that dropped an inline span would
   * leave this line with a halving that ends at no moment, and the lifetime
   * gate would then refuse the whole line: the DC, the targets and the 6d8
   * would all stop being read, not merely the halving.
   *
   * Read off the line's text rather than off its `save`, because a legendary
   * action is not a line this pipeline spends and so carries none — the
   * economy is what holds that block back, not the grammar.
   */
  it('reads a halving with a span of its own, on a line the economy still holds back', () => {
    for (const [id, dc, dice, average] of [
      ['adult-brass-dragon', 16, '6d8', 27],
      ['ancient-brass-dragon', 20, '8d8', 36],
    ] as const) {
      const sands = lineOf(id, 'Scorching Sands');
      expect(sands.save, id).toBeUndefined();
      expect(parseSaveLine(sands.text), id).toEqual({
        ability: 'dex',
        dc,
        targets: 'one creature the dragon can see within 120 feet',
        damage: { dice, flat: 0, type: 'fire', average },
        onSuccess: 'none',
        onFailure: [
          { kind: 'speed-halved', lasts: { kind: 'turn', moment: 'end', of: 'target' } },
        ],
        handedOver: [
          "_Failure or Success:_ The dragon can't take this action again until the start of its next turn.",
        ],
      });
    }
  });
});

describe('the lines the reader does not reach', () => {
  it('refuses a clause it cannot start on, rather than rolling a save for nothing', () => {
    // SRD Ghost's Possession. SRD Sea Hag's Death Glare used to stand here,
    // and so did SRD Copper Dragon Wyrmling's Slowing Breath; both are read
    // now, one describe block up apiece.
    expect(lineOf('ghost', 'Possession').save).toBeUndefined();
  });

  /**
   * SRD Solar's Slaying Bow prints the same branch the Sea Hag and the Incubus
   * do — "If the creature has 100 Hit Points or fewer, it dies. It otherwise
   * takes 24 (4d8 + 6) Piercing damage plus 36 (8d8) Radiant damage" — and it
   * stays prose, because its `then` arm is "it dies" and {@link DIES} reads
   * only "The target dies". Widening that word is a decision about where a
   * kill's gate may come from, and a kill is the last sentence to read on a
   * guess; the line is handed over whole until somebody makes it.
   */
  it('refuses a branch whose first arm is a clause it does not read', () => {
    expect(lineOf('solar', 'Slaying Bow').save).toBeUndefined();
  });

  /**
   * **A second rung the grammar cannot hold still refuses the whole line**,
   * which is the property the two dragon families were refused under until a
   * deepening could carry a lifetime — and it is the half most easily lost by
   * widening the rung grammar, because what it buys is a *refusal*.
   *
   * **SRD Cockatrice's spelling is read now and was the fixture here**, which
   * is worth leaving written down: "The target has the Petrified condition,
   * instead of the Restrained condition, for 24 hours" is the same sentence
   * with the phrase set off by commas and the deepened condition's own
   * lifetime on the end of it, and `RepeatSave.onFailure.lasts` is the field
   * that holds the second half. So the refusal this guard is about is the one
   * beside it: a rung that says two things, where a deepening is one condition
   * and what ends it, and a rule riding on the deeper condition has nowhere to
   * be written.
   *
   * Asserted through the template rather than off the block, because the
   * cockatrice's line opens with `_Melee Attack Roll:_` — its save reaches the
   * reader through `parseRiderSave` and would be refused here for its opening
   * whatever this did with its rung, and an assertion that passes for the
   * wrong reason is not a guard.
   */
  it('refuses a graded failure whose second rung it still cannot hold', () => {
    const graded = (rung: string) =>
      parseSaveLine(
        '_Constitution Saving Throw:_ DC 11, each creature in a 15-foot Cone. ' +
          '_First Failure:_ The target has the Restrained condition and repeats the save at the ' +
          'end of its next turn, ending the effect on itself on a success. ' +
          `_Second Failure:_ ${rung}`,
      );

    // The two rungs that are read, so the fixture is known to be a rung this
    // reader reaches at all — the Gorgon's bare spelling and the Cockatrice's
    // with its commas and its day of stone.
    expect(graded('The target has the Petrified condition instead of the Restrained condition.'))
      .not.toBeNull();
    expect(
      graded(
        'The target has the Petrified condition, instead of the Restrained condition, for 24 hours.',
      )?.onFailure,
    ).toEqual([
      {
        kind: 'condition',
        condition: 'restrained',
        repeats: {
          at: 'end',
          of: 'target',
          onFailure: { condition: 'petrified', lasts: { kind: 'seconds', seconds: 86400 } },
        },
      },
    ]);
    // And the rung that is not: a deepening is one condition and what ends it.
    expect(
      graded('The target has the Petrified condition and is pushed up to 10 feet straight away from the gorgon.'),
    ).toBeNull();
    // Nor a span this reader cannot measure, which would be a Petrified that
    // outlived its own sentence.
    expect(
      graded(
        'The target has the Petrified condition, instead of the Restrained condition, for 2 days.',
      ),
    ).toBeNull();
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

  it('reads a save off a line a creature spends, or off one a moment forces', () => {
    // The two kinds and no third: a line under Actions or Bonus Actions is
    // one `forcePrintedSave` takes, and a line anywhere else has to carry the
    // moment that forces it or it is a save nothing could ever roll.
    const spendable = new Set(
      bestiary.flatMap((monster) => [...monster.actions, ...monster.bonusActions]),
    );
    expect(
      saves
        .filter((line) => !spendable.has(line) && line.save?.trigger === undefined)
        .map((line) => line.name),
    ).toEqual([]);
    // Non-vacuous: the moments are real and every one of them is a trait.
    expect(saves.filter((line) => line.save?.trigger !== undefined).length).toBeGreaterThan(5);
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
        continue;
      }
      // **The one line whose failure the engine spends nothing of**, and it is
      // read because nothing else could ever reach it: SRD Gibbering Mouther's
      // d8 table is forced by a moment, so refusing it would mean the moment
      // never arrives rather than a DM adjudicating it off the page. The save
      // is rolled where the book says and the table is handed over.
      if (save.onFailure === undefined) {
        expect(save.trigger, line.name).toBeDefined();
        expect(save.handedOver?.length ?? 0, line.name).toBeGreaterThan(0);
        continue;
      }
      expect(save.onFailure.length, line.name).toBeGreaterThan(0);
      expect(save.onSuccess).toBe('none');
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
