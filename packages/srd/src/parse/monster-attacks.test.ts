import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  parseAttackLine,
  parseMonsters,
  parseMultiattack,
  parseTraitShape,
} from './monsters.js';

/**
 * The two shapes this parser now reads out of a stat block's prose.
 *
 * 2024 stat blocks are written to a template rather than in free English —
 * `_Melee Attack Roll:_ +4, reach 5 ft. _Hit:_ 5 (1d6 + 2) Piercing damage` is
 * the same sentence in four hundred blocks — and the template carries every
 * number the engine needs to *make* the attack. So the numbers are read here,
 * once, and the sentence is kept verbatim beside them: what the parser could
 * not read stays prose, and nothing guesses.
 *
 * **The rider is the honest half.** "If the target is a Medium or smaller
 * creature, it has the Prone condition" is a rule the parser deliberately does
 * not structure — the effect vocabulary a hit could buy is being written
 * elsewhere — so it comes back as the text after the damage, for the command
 * to report and a DM to apply. A parser that dropped it would silently make
 * the Wolf's bite a lesser attack than the book prints.
 */

const read = (file: string) =>
  readFileSync(fileURLToPath(new URL(`../../raw/${file}`, import.meta.url)), 'utf8');

const bestiary = [
  ...parseMonsters(read('monsters-A-Z.md'), 'monsters-A-Z.md').items,
  ...parseMonsters(read('animals.md'), 'animals.md').items,
];

const find = (id: string) => {
  const monster = bestiary.find((m) => m.id === id);
  expect(monster, `${id} missing from the parsed bestiary`).toBeDefined();
  return monster!;
};

const action = (id: string, name: string) => {
  const found = find(id).actions.find((a) => a.name === name);
  expect(found, `${id} prints no action called ${name}`).toBeDefined();
  return found!;
};

describe('parseAttackLine', () => {
  it('reads the Wolf’s Bite: the bonus, the reach, the die and the modifier', () => {
    expect(parseAttackLine(action('wolf', 'Bite').text)).toEqual({
      kind: 'melee',
      modifier: 4,
      reach: 5,
      range: null,
      damage: [{ dice: '1d6', flat: 2, type: 'piercing', average: 5 }],
      qualification: null,
      rider:
        'If the target is a Medium or smaller creature, it has the Prone condition.',
    });
  });

  it('reads a second damage type as its own component', () => {
    expect(parseAttackLine(action('ghoul', 'Bite').text)).toEqual({
      kind: 'melee',
      modifier: 4,
      reach: 5,
      range: null,
      damage: [
        { dice: '1d6', flat: 2, type: 'piercing', average: 5 },
        { dice: '1d6', flat: 0, type: 'necrotic', average: 3 },
      ],
      qualification: null,
      rider: null,
    });
  });

  it('keeps the save a hit buys as prose rather than structuring it', () => {
    const claw = parseAttackLine(action('ghoul', 'Claw').text);
    expect(claw?.damage).toEqual([{ dice: '1d4', flat: 2, type: 'slashing', average: 4 }]);
    expect(claw?.rider).toContain('Constitution Saving Throw:');
    expect(claw?.rider).toContain('DC 10');
  });

  it('reads a ranged line’s two ranges', () => {
    expect(parseAttackLine(action('goblin-warrior', 'Shortbow').text)).toMatchObject({
      kind: 'ranged',
      modifier: 4,
      reach: null,
      range: { normal: 80, long: 320 },
    });
  });

  it('reads a line that prints both a reach and a range', () => {
    expect(parseAttackLine(action('ogre', 'Javelin').text)).toMatchObject({
      kind: 'melee-or-ranged',
      modifier: 6,
      reach: 5,
      range: { normal: 30, long: 120 },
    });
  });

  it('reads a Reach weapon’s ten feet rather than assuming five', () => {
    expect(parseAttackLine(action('bugbear-warrior', 'Grab').text)).toMatchObject({
      kind: 'melee',
      modifier: 4,
      reach: 10,
    });
  });

  /**
   * SRD Ankheg: "_Melee Attack Roll:_ +5 (with Advantage if the target is
   * Grappled by the ankheg)". A condition on the **roll**, which is a
   * different moment from a condition on the hit — so it is its own field,
   * and the command that rolls reports it whether the attack lands or not.
   */
  it('keeps a condition on the roll apart from what a hit buys', () => {
    const bite = parseAttackLine(action('ankheg', 'Bite').text);
    expect(bite?.modifier).toBe(5);
    expect(bite?.qualification).toBe('with Advantage if the target is Grappled by the ankheg');
    expect(bite?.rider).toContain('Grappled condition');
  });

  /**
   * SRD Goblin Warrior: "5 (1d6 + 2) Slashing damage, plus 2 (1d4) Slashing
   * damage **if the attack roll had Advantage**." Read as a second component
   * that goblin deals the extra die on every hit it ever makes, so the chain
   * stops — and it stops before the book's own "plus", which goes into the
   * rider with the clause it introduced rather than being eaten.
   */
  it('stops at damage the book only deals sometimes, connective and all', () => {
    const scimitar = parseAttackLine(action('goblin-warrior', 'Scimitar').text);
    expect(scimitar?.damage).toEqual([
      { dice: '1d6', flat: 2, type: 'slashing', average: 5 },
    ]);
    expect(scimitar?.rider).toBe(
      'plus 2 (1d4) Slashing damage if the attack roll had Advantage.',
    );
  });

  /**
   * And an alternative the book prints with "or" is not a component either:
   * SRD Blood Hawk's Beak deals one die "or" a larger one against a Bloodied
   * target, and reading both would deal them both.
   */
  it('stops at an alternative damage the book offers', () => {
    const beak = parseAttackLine(action('blood-hawk', 'Beak').text);
    expect(beak?.damage).toEqual([{ dice: '1d4', flat: 2, type: 'piercing', average: 4 }]);
    expect(beak?.rider).toContain('or 6 (1d8 + 2) Piercing damage if the target is Bloodied');
  });

  it('is null for a line that is not an attack', () => {
    expect(parseAttackLine(action('ghoul', 'Multiattack').text)).toBeNull();
    expect(parseAttackLine(action('giant-spider', 'Web (Recharge 5–6)').text)).toBeNull();
  });
});

describe('parseTraitShape', () => {
  const trait = (id: string, name: string) => {
    const found = find(id).traits.find((t) => t.name === name);
    expect(found, `${id} prints no trait called ${name}`).toBeDefined();
    return found!;
  };

  it('reads Pack Tactics off the sentence, in both the printings the book uses', () => {
    expect(parseTraitShape(trait('wolf', 'Pack Tactics').text)).toEqual({
      kind: 'advantage-when-ally-is-within-5-feet-of-the-target',
    });
    expect(parseTraitShape(trait('dire-wolf', 'Pack Tactics').text)).toEqual({
      kind: 'advantage-when-ally-is-within-5-feet-of-the-target',
    });
  });

  it('is null for a trait whose sentence nothing reads', () => {
    expect(parseTraitShape(trait('giant-spider', 'Spider Climb').text)).toBeNull();
  });
});

describe('the bestiary, read through the parser', () => {
  const attacks = bestiary.flatMap((m) =>
    [...m.actions, ...m.bonusActions, ...m.reactions, ...m.legendaryActions].flatMap((a) =>
      a.attack === undefined ? [] : [{ monster: m.id, name: a.name, attack: a.attack }],
    ),
  );

  /**
   * Named rather than counted: a threshold would go on passing while a whole
   * family of lines quietly stopped being read. The Roper's Tentacle is the
   * one line in the book that makes an attack roll and deals **no damage** on
   * a hit — it grapples — so there is nothing for an attack to carry, and it
   * stays the prose it always was.
   */
  it('structures every printed attack line but the one that deals no damage', () => {
    const unread = bestiary.flatMap((m) =>
      [...m.actions, ...m.bonusActions, ...m.reactions, ...m.legendaryActions].flatMap((a) =>
        /Attack Roll:_/.test(a.text) && a.attack === undefined ? [`${m.id}: ${a.name}`] : [],
      ),
    );

    expect(attacks.length).toBeGreaterThan(400);
    expect(unread).toEqual(['roper: Tentacle']);
  });

  /**
   * The check that says the numbers were read rather than invented: the SRD
   * prints the average beside the dice, so a die count or a modifier read
   * wrongly disagrees with the book's own arithmetic. Every component of every
   * attack this parser structured agrees with it, so one that does not is a
   * misread line rather than a rounding argument — and the loop below walks
   * all of them rather than a sample.
   */
  it('reads dice that come to the average the book prints beside them', () => {
    for (const { monster, name, attack } of attacks) {
      for (const damage of attack.damage) {
        const dice = damage.dice;
        const rolled =
          dice === null ? 0 : (() => {
            const [count, sides] = dice.split('d').map(Number);
            return Math.floor((count! * (sides! + 1)) / 2);
          })();
        expect(rolled + damage.flat, `${monster} ${name}: ${dice ?? 'flat'}`).toBe(
          damage.average,
        );
      }
    }
  });

  it('gives every structured attack somewhere to reach: a reach, a range, or both', () => {
    for (const { monster, name, attack } of attacks) {
      const reaches = attack.reach !== null || attack.range !== null;
      expect(reaches, `${monster} ${name} states neither a reach nor a range`).toBe(true);
      if (attack.kind === 'ranged') expect(attack.range).not.toBeNull();
      if (attack.kind === 'melee') expect(attack.reach).not.toBeNull();
    }
  });

  /**
   * Every structured line's two English fields are prose or absent — never an
   * empty string, which would read as "the book said nothing" while meaning
   * "the parser dropped something".
   */
  it('leaves what it did not read as prose or as nothing', () => {
    for (const { monster, name, attack } of attacks) {
      for (const [field, value] of [
        ['rider', attack.rider],
        ['qualification', attack.qualification],
      ] as const) {
        expect(value === null || value.trim().length > 0, `${monster} ${name}.${field}`).toBe(
          true,
        );
      }
    }
  });

  it('reads Pack Tactics on every block that prints it', () => {
    const printed = bestiary.filter((m) => m.traits.some((t) => t.name === 'Pack Tactics'));
    const read = bestiary.filter((m) =>
      m.traits.some(
        (t) => t.trait?.kind === 'advantage-when-ally-is-within-5-feet-of-the-target',
      ),
    );

    expect(printed.length).toBeGreaterThan(15);
    expect(read.map((m) => m.id)).toEqual(printed.map((m) => m.id));
  });

  it('leaves a line it could not read as prose', () => {
    const multiattack = find('ghoul').actions.find((a) => a.name === 'Multiattack');
    expect(multiattack?.attack).toBeUndefined();
    expect(multiattack?.text).toContain('two Bite attacks');
  });
});

/**
 * The third shape read out of a stat block's prose: a Multiattack's **named
 * sequence**.
 *
 * "The elemental makes two Thunderous Slam attacks" is a count *and* a name,
 * and the count on its own is not the rule — a Ghoul allowed two attacks is a
 * Ghoul allowed two Claws, which the book does not print. So what is read is
 * the sequence, and a sentence that is not one is left as prose exactly as
 * every unread line is.
 *
 * **One grammar, and nothing guessed.** A block that offers alternatives ("or
 * it makes two Hurl Flame attacks"), a free choice ("using Scimitar and Pistol
 * in any combination"), a use that is not an attack ("and uses Consume
 * Memories") or a count nobody can resolve ("as many Bite attacks as it has
 * heads") is a different mechanism, and each comes back null rather than as
 * the half of itself this grammar happens to match.
 */
describe('parseMultiattack', () => {
  it('reads a count and the name it attaches to', () => {
    expect(parseMultiattack('The elemental makes two Thunderous Slam attacks.')).toEqual({
      entries: [{ count: 2, attack: 'Thunderous Slam' }],
    });
    expect(parseMultiattack(action('ghoul', 'Multiattack').text)).toEqual({
      entries: [{ count: 2, attack: 'Bite' }],
    });
  });

  it('reads a sequence of two differently named attacks, in printed order', () => {
    expect(parseMultiattack(action('bone-devil', 'Multiattack').text)).toEqual({
      entries: [
        { count: 2, attack: 'Claw' },
        { count: 1, attack: 'Infernal Sting' },
      ],
    });
  });

  it('refuses every sentence that is not a named sequence', () => {
    for (const text of [
      // An alternative the engine would have to choose between.
      'The devil makes one Claws attack and one Tail attack, or it makes two Hurl Flame attacks.',
      // A free choice from a menu, which is a count and not a sequence.
      'The assassin makes three attacks, using Shortsword or Light Crossbow in any combination.',
      // A use that is not an attack at all.
      'The aboleth makes two Tentacle attacks and uses either Consume Memories or Dominate Mind if available.',
      // A second sentence, saying something this grammar has not read.
      'The dragon makes three Rend attacks. It can replace one attack with a use of Spellcasting.',
      // A count nobody can resolve.
      'The hydra makes as many Bite attacks as it has heads.',
      // Plural where the book prints one, and the other way round.
      'The devil makes one Beard attacks.',
      'The ghoul makes two Bite attack.',
    ]) {
      expect(parseMultiattack(text), text).toBeNull();
    }
  });

  /**
   * The parse is carried on the line, beside `attack` and `trait`, and only
   * where the sentence was read whole — so a reader can tell a sequence the
   * engine holds from prose a DM still applies.
   */
  it('carries the sequence on the line that prints it, and on no other', () => {
    const ghoul = find('ghoul').actions;
    expect(ghoul.find((a) => a.name === 'Multiattack')?.multiattack).toEqual({
      entries: [{ count: 2, attack: 'Bite' }],
    });
    expect(ghoul.find((a) => a.name === 'Bite')?.multiattack).toBeUndefined();
    expect(
      find('aboleth').actions.find((a) => a.name === 'Multiattack')?.multiattack,
    ).toBeUndefined();
  });

  /**
   * Every sequence names lines the same block prints, which is what makes the
   * grammar honest rather than merely confident: a name read out of one
   * sentence has to be an action somebody can actually take.
   */
  it('names an action the block prints, in every block it read', () => {
    let read = 0;
    for (const monster of bestiary) {
      // Every section, because the grammar reads a sentence and not a heading:
      // three legendary actions print one too — "The aboleth makes one Tentacle
      // attack" — and a name read there has to be a line as well.
      for (const line of [
        ...monster.traits,
        ...monster.actions,
        ...monster.bonusActions,
        ...monster.reactions,
        ...monster.legendaryActions,
      ]) {
        if (line.multiattack === undefined) continue;
        read += 1;
        const printed = monster.actions.map((a) => a.name.toLowerCase());
        for (const entry of line.multiattack.entries) {
          expect(printed, `${monster.id}: ${entry.attack}`).toContain(entry.attack.toLowerCase());
        }
      }
    }
    expect(read).toBeGreaterThan(60);
  });

  /**
   * And a sentence that says something *besides* a sequence is not one.
   *
   * The dragons' Pounce — "The dragon moves up to half its Speed, and it makes
   * one Rend attack" — is the whole reason the subject of the sentence is a
   * few plain words rather than anything at all: a looser opening reads this
   * as a lone Rend and drops the move without saying so.
   */
  it('refuses a sentence that does something before it attacks', () => {
    expect(
      parseMultiattack('The dragon moves up to half its Speed, and it makes one Rend attack.'),
    ).toBeNull();
    const pounce = bestiary
      .find((m) => m.id === 'adult-black-dragon')
      ?.legendaryActions.find((a) => a.name === 'Pounce');
    expect(pounce?.text).toContain('moves up to half its Speed');
    expect(pounce?.multiattack).toBeUndefined();
  });
});

/**
 * A recharge is printed in the action's **name** — "Whirlwind (Recharge 4–6)"
 * — and the engine may not branch on a name. So it is read here into a field,
 * once, and whatever filters on it downstream reads structure.
 */
describe('a recharge on a printed attack', () => {
  it('reads the die the book prints, off the name', () => {
    expect(action('ape', 'Rock (Recharge 6)').attack?.recharge).toEqual({ kind: 'die', low: 6 });
    expect(action('minotaur-of-baphomet', 'Gore (Recharge 5–6)').attack?.recharge).toEqual({
      kind: 'die',
      low: 5,
    });
  });

  it('leaves an attack that recharges on nothing without the field', () => {
    expect(action('wolf', 'Bite').attack?.recharge).toBeUndefined();
  });

  it('reads every recharging attack line in the book', () => {
    for (const monster of bestiary) {
      for (const line of monster.actions) {
        if (line.attack === undefined) continue;
        expect(line.attack.recharge !== undefined, `${monster.id}: ${line.name}`).toBe(
          /\(Recharge/i.test(line.name),
        );
      }
    }
  });
});
