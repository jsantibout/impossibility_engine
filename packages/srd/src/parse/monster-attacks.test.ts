import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  parseAttackLine,
  parseMonsters,
  parseMultiattack,
  parsePerDay,
  parseTraitShape,
} from './monsters.js';
import { entriesOfBranch, gateOfBranch } from '../schemas.js';

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

/**
 * The five blocks whose Multiattack names a line printed under a *qualified*
 * heading — "Handaxe (Humanoid or Hybrid Form Only)" — so the name does not
 * bind and the engine drops the sequence whole.
 *
 * Recorded rather than argued about, and recorded rather than matched through:
 * a prefix match would hand a Werebear in bear form a Handaxe, which is a rule
 * nobody printed. A sixth should be noticed instead of absorbed.
 */
const QUALIFIED_HEADINGS = ['werebear', 'wereboar', 'wererat', 'weretiger', 'werewolf'];

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
    // A trait with a mechanic somebody has matched is `monster-traits.test.ts`'s
    // subject; this is the other half, and Fire Aura is one of the many the
    // reader still says nothing about.
    expect(parseTraitShape(trait('azer-sentinel', 'Fire Aura').text)).toBeNull();
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
 * **One grammar, and nothing guessed.** A sentence stating something this
 * grammar has not read — a count nobody can resolve ("as many Bite attacks as
 * it has heads"), a branch gated on a Bonus Action nobody reads — comes back
 * null rather than as the half of itself the grammar happens to match. The
 * shapes read *beside* the named sequence, each a wording of the book rather
 * than a mechanism invented here, are in the describe below this one.
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
      // A count nobody can resolve.
      'The hydra makes as many Bite attacks as it has heads.',
      // Plural where the book prints one, and the other way round.
      'The devil makes one Beard attacks.',
      'The ghoul makes two Bite attack.',
      // A condition on a branch that the engine cannot evaluate.
      'The golem makes two Slam attacks, or it makes three Slam attacks if it used Hasten this turn.',
      // A use in the middle of the sequence rather than trailing it.
      'The roper makes two Tentacle attacks, uses Reel, and makes two Bite attacks.',
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
      find('hydra').actions.find((a) => a.name === 'Multiattack')?.multiattack,
    ).toBeUndefined();
  });

  /**
   * **The one detector the heading is part of.** Every other shape here is
   * matched by its rule, because what a line says is not a property of what it
   * is printed under — but a sequence is the composition of *the Attack
   * action*, and the only line that says so is the one the book prints it
   * under. The Aboleth's Lash writes the same sentence about a legendary
   * action; read as a Multiattack it would cage the creature in a rule nobody
   * printed.
   */
  it('reads a sequence only under the heading that makes it one', () => {
    const lash = find('aboleth').legendaryActions.find((a) => a.name === 'Lash');
    expect(lash?.text).toBe('The aboleth makes one Tentacle attack.');
    expect(parseMultiattack(lash!.text)).toEqual({
      entries: [{ count: 1, attack: 'Tentacle' }],
    });
    expect(lash?.multiattack).toBeUndefined();

    // And no section but Actions carries one anywhere in the book.
    for (const monster of bestiary) {
      for (const line of [
        ...monster.traits,
        ...monster.bonusActions,
        ...monster.reactions,
        ...monster.legendaryActions,
      ]) {
        expect(line.multiattack, `${monster.id}: ${line.name}`).toBeUndefined();
      }
    }
  });

  /**
   * Every sequence names lines the same block prints, which is what makes the
   * grammar honest rather than merely confident: a name read out of one
   * sentence has to be an action somebody can actually take.
   *
   * **Five blocks are recorded rather than argued about.** The lycanthropes
   * print their lines under *qualified* headings — "Handaxe (Humanoid or
   * Hybrid Form Only)" — and their Multiattack names the bare word. Matching
   * through the qualification would hand a Werebear in bear form a Handaxe,
   * which is a rule nobody printed; so the name does not bind, the engine
   * drops the whole sequence exactly as it drops any sequence with a loose end,
   * and these five stay where they were at one attack per action. The record is
   * here so that a sixth is noticed instead of absorbed. See
   * {@link QUALIFIED_HEADINGS}.
   */
  it('names an action the block prints, in every block it read', () => {
    let read = 0;
    for (const monster of bestiary) {
      if (QUALIFIED_HEADINGS.includes(monster.id)) continue;
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
        const parsed = line.multiattack;
        if (parsed === undefined) continue;
        read += 1;
        const printed = monster.actions.map((a) => a.name.toLowerCase());
        for (const branch of parsed.alternatives ?? [parsed.entries ?? []]) {
          for (const entry of entriesOfBranch(branch)) {
            for (const name of entry.attacks ?? [entry.attack!]) {
              expect(printed, `${monster.id}: ${name}`).toContain(name.toLowerCase());
            }
          }
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
 *
 * **On the line, because the line is what the book prints it on.** It lived on
 * the parsed *attack* while the only reader was the one that has to leave a
 * breath weapon out of an Opportunity Attack — and that argument covered two
 * lines of eighty-seven. Eighty-five of the book's recharging lines print no
 * attack roll at all: they are a saving throw, a spell, a teleport, a
 * shape-shift. A field on the attack gave every one of them nowhere to carry
 * what the book plainly printed about them.
 */
describe('a recharge on a printed line', () => {
  /** Every line in the bestiary, whichever section it is printed under. */
  const everyLine = bestiary.flatMap((monster) =>
    [
      ...monster.traits,
      ...monster.actions,
      ...monster.bonusActions,
      ...monster.reactions,
      ...monster.legendaryActions,
    ].map((line) => ({ monster: monster.id, line })),
  );

  it('reads the die the book prints, off the name', () => {
    expect(action('ape', 'Rock (Recharge 6)').recharge).toEqual({ kind: 'die', low: 6 });
    expect(action('minotaur-of-baphomet', 'Gore (Recharge 5–6)').recharge).toEqual({
      kind: 'die',
      low: 5,
    });
  });

  /**
   * The three die forms the book prints, each on a line that prints no attack
   * — which is where the field being on the attack lost eighty-five of them.
   */
  it('reads all three die thresholds off lines that print no attack', () => {
    const whirlwind = action('air-elemental', 'Whirlwind (Recharge 4–6)');
    expect(whirlwind.attack).toBeUndefined();
    expect(whirlwind.recharge).toEqual({ kind: 'die', low: 4 });

    const breath = action('young-red-dragon', 'Fire Breath (Recharge 5–6)');
    expect(breath.attack).toBeUndefined();
    expect(breath.recharge).toEqual({ kind: 'die', low: 5 });

    const spray = action('ankheg', 'Acid Spray (Recharge 6)');
    expect(spray.attack).toBeUndefined();
    expect(spray.recharge).toEqual({ kind: 'die', low: 6 });
  });

  /**
   * SRD Cloaker, and the only line in the book printed this way: "Phantasms
   * (Recharge after a Short or Long Rest)". It is the whole reason the `rest`
   * arm was written, and nothing had ever produced one — the line carries no
   * attack, so the field it would have gone in did not exist on it.
   */
  it('reads the book’s one rest form', () => {
    const phantasms = find('cloaker').bonusActions.find((line) =>
      line.name.startsWith('Phantasms'),
    );
    expect(phantasms?.attack).toBeUndefined();
    expect(phantasms?.recharge).toEqual({ kind: 'rest' });
  });

  it('leaves a line that recharges on nothing without the field', () => {
    expect(action('wolf', 'Bite').recharge).toBeUndefined();
  });

  /**
   * **Asserted against the names, and counted.** A parser that silently read
   * nothing would satisfy "no line disagrees with its name"; the count is what
   * says it read them all.
   */
  it('reads every recharging line in the book, in every section', () => {
    let read = 0;
    for (const { monster, line } of everyLine) {
      const printed = /\(Recharge/i.test(line.name);
      expect(line.recharge !== undefined, `${monster}: ${line.name}`).toBe(printed);
      if (printed) read += 1;
    }
    expect(read).toBe(87);
  });

  /** And the field is gone from the attack, so there is one place to read it. */
  it('carries it nowhere but on the line', () => {
    for (const { line } of everyLine) {
      if (line.attack === undefined) continue;
      expect(line.attack).not.toHaveProperty('recharge');
    }
  });
});

/**
 * The rest of what a Multiattack sentence says.
 *
 * The grammar above read the honest half — a named sequence and nothing else —
 * and left ninety-nine lines as prose. Four shapes account for all but three of
 * them, and each is a wording the book uses rather than a mechanism the engine
 * invented:
 *
 * - **A hand-over.** "It can replace one attack with a use of Spellcasting"
 *   names something the engine cannot execute. The book is consistent about
 *   which it means: "a *Tail attack*" is a printed line, "a *use of* X" is a
 *   save or a prose action. So the second is carried whole as text and reported
 *   to whoever is driving, and the sequence beside it is read exactly as it
 *   always was. Nothing is enforced, because nothing needed to be: making fewer
 *   swings than the sequence prints has always been legal.
 * - **The Oxford comma.** "one Bite attack, two Devilish Claw attacks, and one
 *   Fiery Mace attack" is a pure named sequence that the ` and ` split alone
 *   could not see.
 * - **A menu.** One entry, several printed names, one shared count. "in any
 *   combination", "two Javelin or Morningstar attacks" and "one X or Y attack"
 *   are three wordings of the same thing, and nothing here chooses between the
 *   names.
 * - **An alternation.** "or it makes two Hurl Flame attacks" and "It can
 *   replace one attack with a Tail attack" are one mechanism in two wordings:
 *   two whole sequences, of which the creature is doing one.
 */
describe('parseMultiattack reads the rest of the sentence', () => {
  it('carries a second sentence naming a use as text, beside the sequence it read', () => {
    expect(parseMultiattack(action('adult-black-dragon', 'Multiattack').text)).toEqual({
      entries: [{ count: 3, attack: 'Rend' }],
      handOver:
        'It can replace one attack with a use of Spellcasting to cast Acid Arrow (level 3 version).',
    });
  });

  it('carries a trailing clause naming a use the same way', () => {
    expect(parseMultiattack(action('aboleth', 'Multiattack').text)).toEqual({
      entries: [{ count: 2, attack: 'Tentacle' }],
      handOver: 'and uses either Consume Memories or Dominate Mind if available',
    });
    // "and can use", "and it uses" and "or uses" are the same clause in the
    // book's other wordings.
    expect(parseMultiattack(action('erinyes', 'Multiattack').text)).toEqual({
      entries: [{ count: 3, attack: 'Withering Sword' }],
      handOver: 'and can use Entangling Rope',
    });
    expect(parseMultiattack(action('planetar', 'Multiattack').text)).toEqual({
      entries: [{ count: 3, attack: 'Radiant Sword' }],
      handOver: 'or uses Holy Burst twice',
    });
  });

  it('reads the Oxford comma the ` and ` split alone could not', () => {
    expect(parseMultiattack(action('pit-fiend', 'Multiattack').text)).toEqual({
      entries: [
        { count: 1, attack: 'Bite' },
        { count: 2, attack: 'Devilish Claw' },
        { count: 1, attack: 'Fiery Mace' },
      ],
    });
    expect(parseMultiattack(action('chimera', 'Multiattack').text)).toEqual({
      entries: [
        { count: 1, attack: 'Ram' },
        { count: 1, attack: 'Bite' },
        { count: 1, attack: 'Claw' },
      ],
      handOver: 'It can replace the Claw attack with a use of Fire Breath if available.',
    });
  });

  it('reads a menu: one count, several names, and no choice made here', () => {
    expect(parseMultiattack(action('assassin', 'Multiattack').text)).toEqual({
      entries: [{ count: 3, attacks: ['Shortsword', 'Light Crossbow'] }],
    });
    // The book writes "and" where it plainly means "or" — the Bandit Captain
    // and the Scout — and "in any combination" is what settles it either way.
    expect(parseMultiattack(action('bandit-captain', 'Multiattack').text)).toEqual({
      entries: [{ count: 2, attacks: ['Scimitar', 'Pistol'] }],
    });
    expect(parseMultiattack(action('merrow', 'Multiattack').text)).toEqual({
      entries: [{ count: 2, attacks: ['Bite', 'Claw', 'Harpoon'] }],
    });
    // The same mechanism written inline, without the tail.
    expect(parseMultiattack(action('bugbear-stalker', 'Multiattack').text)).toEqual({
      entries: [{ count: 2, attacks: ['Javelin', 'Morningstar'] }],
    });
    expect(parseMultiattack(action('mummy-lord', 'Multiattack').text)).toEqual({
      entries: [{ count: 1, attacks: ['Rotting Fist', 'Channel Negative Energy'] }],
      handOver: 'and it uses Dreadful Glare',
    });
    // A named swing and a menu in one sentence, which is why the count stays on
    // the entry rather than on the record.
    expect(parseMultiattack(action('tarrasque', 'Multiattack').text)).toEqual({
      entries: [
        { count: 1, attack: 'Bite' },
        { count: 3, attacks: ['Claw', 'Tail'] },
      ],
    });
  });

  it('reads an alternation as two whole sequences', () => {
    expect(parseMultiattack(action('barbed-devil', 'Multiattack').text)).toEqual({
      alternatives: [
        [
          { count: 1, attack: 'Claws' },
          { count: 1, attack: 'Tail' },
        ],
        [{ count: 2, attack: 'Hurl Flame' }],
      ],
    });
    expect(parseMultiattack(action('medusa', 'Multiattack').text)).toEqual({
      alternatives: [
        [
          { count: 2, attack: 'Claw' },
          { count: 1, attack: 'Snake Hair' },
        ],
        [{ count: 3, attack: 'Poison Ray' }],
      ],
    });
  });

  it('reads a replacement naming a printed line as the same alternation', () => {
    expect(parseMultiattack(action('dragon-turtle', 'Multiattack').text)).toEqual({
      alternatives: [
        [{ count: 3, attack: 'Bite' }],
        [
          { count: 2, attack: 'Bite' },
          { count: 1, attack: 'Tail' },
        ],
      ],
    });
    // And a menu is a sequence like any other, so it alternates like one.
    expect(parseMultiattack(action('werebear', 'Multiattack').text)).toEqual({
      alternatives: [
        [{ count: 2, attacks: ['Handaxe', 'Rend'] }],
        [
          { count: 1, attacks: ['Handaxe', 'Rend'] },
          { count: 1, attack: 'Bite' },
        ],
      ],
    });
  });

  /**
   * Two lines the book prints that this still leaves as prose, each for a
   * reason worth writing down rather than a gap in the grammar.
   *
   * The golem's was a third: its gated branch is read now, and only where the
   * caller supplies the block's Bonus Actions, which is what the assertion
   * below still holds — with nothing to bind the gate to, the sentence is as
   * unreadable as it ever was.
   */
  it('still refuses the sentences nothing here can read', () => {
    // The third Slam is gated on a Bonus Action; told nothing about the block's,
    // there is nothing to bind the gate to.
    expect(parseMultiattack(action('clay-golem', 'Multiattack').text)).toBeNull();
    // "uses Reel" sits in the middle of the sequence rather than trailing it,
    // and Reel is an action line with no damage on it.
    expect(parseMultiattack(action('roper', 'Multiattack').text)).toBeNull();
    // A count that reads off a fact nobody has declared.
    expect(parseMultiattack(action('hydra', 'Multiattack').text)).toBeNull();
  });

  /**
   * The counts, because a grammar that quietly stopped reading something would
   * report no problems at all.
   */
  it('reads every Multiattack in the book but two', () => {
    let read = 0;
    const prose: string[] = [];
    for (const monster of bestiary) {
      for (const line of monster.actions) {
        if (line.name !== 'Multiattack') continue;
        if (line.multiattack === undefined) prose.push(monster.id);
        else read += 1;
      }
    }
    expect(prose.sort()).toEqual(['hydra', 'roper']);
    expect(read).toBe(175);
  });

  /**
   * **The assignment is trivial, and that is a fact about the book rather than
   * an assumption.** A turn's swings are legal when they can be assigned to
   * entries without exceeding a count, and that is only a straightforward
   * question while no name appears in two entries of one sequence — otherwise a
   * Claw could have come out of either and the engine would have to search.
   */
  it('names each attack in at most one entry of any one sequence', () => {
    for (const monster of bestiary) {
      for (const line of monster.actions) {
        const parsed = line.multiattack;
        if (parsed === undefined) continue;
        for (const branch of parsed.alternatives ?? [parsed.entries ?? []]) {
          const seen = new Set<string>();
          for (const entry of entriesOfBranch(branch)) {
            for (const name of entry.attacks ?? [entry.attack!]) {
              expect(seen.has(name.toLowerCase()), `${monster.id}: ${name}`).toBe(false);
              seen.add(name.toLowerCase());
            }
          }
        }
      }
    }
  });

  /**
   * And the five recorded in {@link QUALIFIED_HEADINGS} are the whole of what
   * does not bind: every other name in every branch is a line the same block
   * prints.
   */
  it('leaves exactly the five qualified headings unbound', () => {
    const unbound = new Set<string>();
    for (const monster of bestiary) {
      for (const line of monster.actions) {
        const parsed = line.multiattack;
        if (parsed === undefined) continue;
        const printed = monster.actions.map((a) => a.name.toLowerCase());
        for (const branch of parsed.alternatives ?? [parsed.entries ?? []]) {
          for (const entry of entriesOfBranch(branch)) {
            for (const name of entry.attacks ?? [entry.attack!]) {
              if (!printed.includes(name.toLowerCase())) unbound.add(monster.id);
            }
          }
        }
      }
    }
    expect([...unbound].sort()).toEqual(QUALIFIED_HEADINGS);
  });

  /**
   * Every **ungated** branch of every alternation totals the same, which is
   * what lets the Attack action hold one number on an ordinary turn.
   *
   * The gated branch is the exception and the reason the qualification is here:
   * the Clay Golem's third Slam is a swing the book gives it only on a turn it
   * used the line the gate names, so a reading that let it into this count
   * would be the free third Slam the gate exists to prevent. It is asserted
   * separately, in the other direction — the branches are *not* the same size,
   * and the bigger one is the one that is gated.
   */
  it('gives every ungated branch of an alternation the same total', () => {
    let alternations = 0;
    let gated = 0;
    for (const monster of bestiary) {
      for (const line of monster.actions) {
        const branches = line.multiattack?.alternatives;
        if (branches === undefined) continue;
        alternations += 1;
        const totalOf = (branch: (typeof branches)[number]) =>
          entriesOfBranch(branch).reduce((sum, e) => sum + e.count, 0);
        const open = branches.filter((b) => gateOfBranch(b) === null);
        expect(new Set(open.map(totalOf)).size, monster.id).toBe(1);

        for (const branch of branches.filter((b) => gateOfBranch(b) !== null)) {
          gated += 1;
          // A gate that bought nothing would be a clause with no consequence,
          // and a gate that bought a *smaller* branch would never be taken.
          expect(totalOf(branch), monster.id).toBeGreaterThan(totalOf(open[0]!));
        }
      }
    }
    expect(alternations).toBe(11);
    expect(gated).toBe(1);
  });
});

/**
 * **A use is handed over for what it *names*, not for how the sentence reads.**
 *
 * The clause is the book's way of saying "and then it does the other thing on
 * its sheet", and in the SRD the other thing is always a save or a prose
 * action — which is why the two patterns that recognise it could decide the
 * hand-over from the wording alone and be right in every block the book
 * prints. That is a fact about this corpus, though, and not a rule about the
 * world: a block printing "makes one Claw attack and uses Bite", where `Bite`
 * is a line with an attack roll on it, is printing a swing. So the grammar is
 * told the names the same block prints an attack for, and a use that names one
 * joins the sequence instead of being handed to the DM.
 *
 * Told, rather than guessing: a use naming anything else is exactly as much of
 * a hand-over as it was, and the default — a block whose attacks nobody passed
 * — is the reading the parser has always given.
 */
describe('a use that names an attack the block prints', () => {
  const TRAILING = 'The chimera makes one Claw attack and uses Bite.';

  it('stays a hand-over while nothing binds', () => {
    expect(parseMultiattack(TRAILING)).toEqual({
      entries: [{ count: 1, attack: 'Claw' }],
      handOver: 'and uses Bite',
    });
    expect(parseMultiattack(TRAILING, ['Claw', 'Horns'])).toEqual({
      entries: [{ count: 1, attack: 'Claw' }],
      handOver: 'and uses Bite',
    });
  });

  it('is a swing where the block prints an attack by that name', () => {
    expect(parseMultiattack(TRAILING, ['Claw', 'Bite'])).toEqual({
      entries: [
        { count: 1, attack: 'Claw' },
        { count: 1, attack: 'Bite' },
      ],
    });
  });

  /**
   * The name a caller spends is the **heading's**, so the heading's spelling is
   * what comes back — not the sentence's, which is the same word typed in a
   * second place.
   *
   * The sentence's word still has to be capitalised, because a lower-cased word
   * is this grammar's one tell that a clause says more than a name: "uses Bite
   * **twice**" and "uses Charm **or** Draining Kiss" are both caught by it, and
   * a use matched case-insensitively would read the first of those as a swing.
   */
  it('carries the heading’s spelling, and still requires the sentence to capitalise', () => {
    expect(
      parseMultiattack('The thing makes one Claw attack and uses Bite.', ['Claw', 'bite']),
    ).toEqual({
      entries: [
        { count: 1, attack: 'Claw' },
        { count: 1, attack: 'bite' },
      ],
    });
    expect(
      parseMultiattack('The thing makes one Claw attack and uses bite.', ['Claw', 'Bite']),
    ).toEqual({
      entries: [{ count: 1, attack: 'Claw' }],
      handOver: 'and uses bite',
    });
  });

  it('reads the same clause in the book’s other wording', () => {
    expect(
      parseMultiattack('The thing makes one Claw attack and it can use Bite.', ['Bite']),
    ).toEqual({
      entries: [
        { count: 1, attack: 'Claw' },
        { count: 1, attack: 'Bite' },
      ],
    });
  });

  /**
   * A second sentence says the same thing the other way up, and the same rule
   * decides it: a use of a printed attack is a swing traded for a swing.
   */
  it('reads a replacement whose use names a printed attack', () => {
    const text =
      'The thing makes three Claw attacks. It can replace one attack with a use of Bite.';
    expect(parseMultiattack(text)).toEqual({
      entries: [{ count: 3, attack: 'Claw' }],
      handOver: 'It can replace one attack with a use of Bite.',
    });
    expect(parseMultiattack(text, ['Claw', 'Bite'])).toEqual({
      alternatives: [
        [{ count: 3, attack: 'Claw' }],
        [
          { count: 2, attack: 'Claw' },
          { count: 1, attack: 'Bite' },
        ],
      ],
    });
  });

  /**
   * Shapes that name a printed attack and are still not one swing of it. Each
   * stays exactly the hand-over it was, because reading it would be the grammar
   * deciding something the sentence does not say.
   */
  it('hands over every use it cannot read as one swing', () => {
    for (const text of [
      // A count the clause states and this grammar does not read.
      'The thing makes one Claw attack and uses Bite twice.',
      // "or" offers the use instead of the swings, not beside them.
      'The thing makes one Claw attack or uses Bite.',
      // A qualification on the use.
      'The thing makes one Claw attack and uses Bite if available.',
    ]) {
      const parsed = parseMultiattack(text, ['Claw', 'Bite']);
      expect(parsed?.entries, text).toEqual([{ count: 1, attack: 'Claw' }]);
      expect(parsed?.handOver, text).toBeDefined();
    }
    // A choice of sequences: nothing says which of them the use belongs to.
    const choice = parseMultiattack(
      'The thing makes two Claw attacks, or it makes one Horn attack and uses Bite.',
      ['Claw', 'Horn', 'Bite'],
    );
    expect(choice?.alternatives).toEqual([
      [{ count: 2, attack: 'Claw' }],
      [{ count: 1, attack: 'Horn' }],
    ]);
    expect(choice?.handOver).toBe('and uses Bite');
  });

  /**
   * And a name already spent in the sequence stays prose, because the engine's
   * assignment is a single pass over entries no name appears in twice.
   */
  it('hands over a use of an attack the sequence already names', () => {
    expect(parseMultiattack('The thing makes two Bite attacks and uses Bite.', ['Bite'])).toEqual({
      entries: [{ count: 2, attack: 'Bite' }],
      handOver: 'and uses Bite',
    });
  });

  /**
   * Whole block, end to end: the names are the ones the block itself prints,
   * found by the parser rather than handed to it by a test.
   */
  it('binds a homebrew block’s own use clause to its own attack line', () => {
    const { items, problems } = parseMonsters(CLAWED_HORROR, 'homebrew.md');
    expect(problems).toEqual([]);
    expect(items[0]!.actions.find((a) => a.name === 'Multiattack')?.multiattack).toEqual({
      entries: [
        { count: 1, attack: 'Claw' },
        { count: 1, attack: 'Bite' },
      ],
    });
  });

  /**
   * **And the SRD does not move.** The rule above changes a block only where a
   * use names a line with an attack roll on it, and across the whole bestiary
   * that happens no times at all — every use clause the book prints names a
   * save, a spellcasting or a prose action. This is the measurement the change
   * rests on, kept as a number so that a block that started binding is a
   * failure here rather than a silent re-reading of the book.
   */
  it('finds no use clause in the book that names a printed attack', () => {
    let clauses = 0;
    const binding: string[] = [];
    for (const monster of bestiary) {
      const attacks = monster.actions
        .filter((a) => a.attack !== undefined)
        .map((a) => a.name.toLowerCase());
      for (const line of monster.actions) {
        const handOver = line.multiattack?.handOver;
        if (handOver === undefined) continue;
        clauses += 1;
        for (const name of attacks) {
          if (new RegExp(`\\buse(?:s|d)? (?:of )?${name}\\b`, 'i').test(handOver)) {
            binding.push(`${monster.id}: ${handOver}`);
          }
        }
      }
    }
    expect(binding).toEqual([]);
    expect(clauses).toBe(55);
  });
});

/** A block that prints the sentence the SRD never does. */
const CLAWED_HORROR = `### Clawed Horror

_Large Monstrosity, Chaotic Evil_

**AC** 14 **Initiative** +2 (12) <br>
**HP** 30 (4d10 + 8) <br>
**Speed** 30 ft. <br>

<table>
  <tbody>
    <tr>
      <td><strong>STR</strong></td>
      <td>16</td>
      <td>+3</td>
      <td>+3</td>
      <td><strong>DEX</strong></td>
      <td>14</td>
      <td>+2</td>
      <td>+2</td>
      <td><strong>CON</strong></td>
      <td>14</td>
      <td>+2</td>
      <td>+2</td>
      <td><strong>INT</strong></td>
      <td>6</td>
      <td>−2</td>
      <td>−2</td>
      <td><strong>WIS</strong></td>
      <td>10</td>
      <td>+0</td>
      <td>+0</td>
      <td><strong>CHA</strong></td>
      <td>6</td>
      <td>−2</td>
      <td>−2</td>
    </tr>
  </tbody>
</table>

**Senses** Darkvision 60 ft.; Passive Perception 10<br>
**Languages** None<br>
**CR** 2 (XP 450; PB +2)

#### Actions

<hr>

**_Multiattack._** The horror makes one Claw attack and uses Bite.

**_Claw._** _Melee Attack Roll:_ +5, reach 5 ft. _Hit:_ 7 (1d8 + 3) Slashing damage.

**_Bite._** _Melee Attack Roll:_ +5, reach 5 ft. _Hit:_ 6 (1d6 + 3) Piercing damage.
`;

/**
 * **What the parser reads, counted per section, so a silent loss is a failing
 * number.**
 *
 * A parser that quietly stopped reading something reports no problems at all,
 * which is why `animals.md` yielded zero creatures for a fortnight. These are
 * the same counts `COVERAGE.md` prints — printed lines against the ones a
 * detector got structure out of — pinned here where a change that moves them
 * fails rather than merely showing up in a regenerated table.
 *
 * **The reading of a line is not a property of its heading.** Every detector
 * runs over every section, so what separates the sections below is what the
 * book *writes* under them and nothing else: a Bonus Action that printed an
 * attack roll would be read exactly as an Action's is, and the test below this
 * one proves it on a block that prints one.
 */
describe('what a stat block’s sections print, and what is read', () => {
  const sections = [
    'traits',
    'actions',
    'bonusActions',
    'reactions',
    'legendaryActions',
  ] as const;

  const census = () => {
    const counted: Record<string, { printed: number; read: number }> = {};
    for (const section of sections) {
      let printed = 0;
      let read = 0;
      for (const monster of bestiary) {
        for (const line of monster[section]) {
          printed += 1;
          if (
            line.attack !== undefined ||
            line.trait !== undefined ||
            line.save !== undefined ||
            line.multiattack !== undefined ||
            line.spellcasting !== undefined
          ) {
            read += 1;
          }
        }
      }
      counted[section] = { printed, read };
    }
    return counted;
  };

  it('counts the printed lines and the read ones, section by section', () => {
    expect(census()).toEqual({
      // Seventy more than before the movement and breathing kinds landed: a
      // Spider Climb, a Flyby, a Standing Leap, and the four sentences that
      // say what a creature breathes. Eleven more again with the light: five
      // Sunlight Sensitivities, one Sunlight Weakness and five Illuminations.
      // Two more again with Bloodied: the Boar's Bloodied Fury and the
      // Berserker's Bloodied Frenzy. The Giant Boar prints the same heading
      // over a narrower rule and is refused, which is the count saying so.
      // Two more again with Undead Fortitude: the Zombie and the Ogre Zombie,
      // which are the only two blocks in the book that print that sentence.
      traits: { printed: 337, read: 103 },
      // Fifty-three more than before the save template was read, and the
      // Clay Golem's Multiattack before them. Forty-seven more again with the
      // Spellcasting line, which is the book's third opening and is read
      // whole: the two that are still prose are the Pit Fiend's Hellfire
      // Spellcasting, which casts one spell twice, and the Storm Giant's,
      // whose spell names the book italicised none of. Every other unread line
      // here is unread for its own reason.
      actions: { printed: 811, read: 697 },
      // **Not one prints an attack roll**, which is what the zero here used
      // to say. Three print the save template — the Trample of the Gorgon,
      // the Elephant and the Mammoth, the last of which is CR 6 — and those
      // three are read for the same reason a trait's sentence is:
      // every detector runs over every section, because what a line says is
      // not a property of the heading it is printed under. The other
      // seventy-two are a spell, another action, a teleport, a movement, a
      // shape-shift or prose, and what they need is an economy rather than a
      // reading. The fourth is the Shadow's Shadow Stealth, read for that
      // same reason: the heading says what the line costs and the sentence
      // says what it is. And ten more are that same sentence under three
      // headings — six Nimble Escapes, two Cunning Actions and two Deathless
      // Agilities — each naming which actions a Bonus Action buys. The Clay
      // Golem's Hasten is not among them: it conjoins rather than offers,
      // and it recharges.
      bonusActions: { printed: 75, read: 14 },
      reactions: { printed: 24, read: 0 },
      legendaryActions: { printed: 82, read: 0 },
    });
  });

  /**
   * And the zero above is the book's, not the parser's.
   *
   * A block printing an attack roll under **Bonus Actions** has it read, with
   * its bonus, its reach and its dice, exactly as an Action's line is — so the
   * count is a statement about what the SRD writes under that heading and a
   * regression in it is a regression in the book's transcription rather than in
   * this grammar.
   */
  it('reads an attack roll printed under Bonus Actions', () => {
    const { items, problems } = parseMonsters(HOOKED_STALKER, 'homebrew.md');
    expect(problems).toEqual([]);
    const stalker = items[0]!;
    expect(stalker.bonusActions.map((line) => line.name)).toEqual(['Hook']);
    expect(stalker.bonusActions[0]!.attack).toEqual({
      kind: 'melee',
      modifier: 5,
      reach: 10,
      range: null,
      damage: [{ dice: '1d6', flat: 3, type: 'piercing', average: 6 }],
      qualification: null,
      rider: null,
    });
  });

  /**
   * **And nothing carries it onto a creature.** `adaptMonster` takes the
   * Actions section and only that section, because a heading in a stat block
   * says what the line under it *costs* and a Bonus Action swung as part of the
   * Attack action is a swing the book did not print. So the line above is read
   * and not spendable, and this records the gap rather than leaving it to be
   * rediscovered: what is missing is a Bonus Action to spend it against, not a
   * sentence to read.
   */
  it('finds no block in the book whose Bonus Action prints an attack roll', () => {
    const printing = bestiary
      .filter((monster) => monster.bonusActions.some((line) => line.attack !== undefined))
      .map((monster) => monster.id);
    expect(printing).toEqual([]);
  });
});

/** A block that prints under Bonus Actions what the SRD never does. */
const HOOKED_STALKER = `### Hooked Stalker

_Medium Aberration, Neutral Evil_

**AC** 14 **Initiative** +2 (12) <br>
**HP** 22 (4d8 + 4) <br>
**Speed** 30 ft. <br>

<table>
  <tbody>
    <tr>
      <td><strong>STR</strong></td>
      <td>16</td>
      <td>+3</td>
      <td>+3</td>
      <td><strong>DEX</strong></td>
      <td>14</td>
      <td>+2</td>
      <td>+2</td>
      <td><strong>CON</strong></td>
      <td>12</td>
      <td>+1</td>
      <td>+1</td>
      <td><strong>INT</strong></td>
      <td>8</td>
      <td>−1</td>
      <td>−1</td>
      <td><strong>WIS</strong></td>
      <td>10</td>
      <td>+0</td>
      <td>+0</td>
      <td><strong>CHA</strong></td>
      <td>6</td>
      <td>−2</td>
      <td>−2</td>
    </tr>
  </tbody>
</table>

**Senses** Darkvision 60 ft.; Passive Perception 10<br>
**Languages** Deep Speech<br>
**CR** 1 (XP 200; PB +2)

#### Actions

<hr>

**_Claw._** _Melee Attack Roll:_ +5, reach 5 ft. _Hit:_ 7 (1d8 + 3) Slashing damage.

#### Bonus Actions

<hr>

**_Hook._** _Melee Attack Roll:_ +5, reach 10 ft. _Hit:_ 6 (1d6 + 3) Piercing damage.
`;

/**
 * **Knowing more about the block may never make the grammar read less.**
 *
 * The names are passed in to turn a hand-over into a swing where one is
 * printed. A block that gained nothing by them has to come out exactly where
 * it was — never worse, and least of all with the sequence its first sentence
 * plainly states taken away from it for a clause about a second thing.
 */
/**
 * **A branch the sentence gates on a Bonus Action the block prints.**
 *
 * SRD Clay Golem: "The golem makes two Slam attacks, or it makes three Slam
 * attacks **if it used Hasten this turn**." The line went unread for exactly as
 * long as nothing could evaluate that clause, and the reason is arithmetic
 * rather than taste: the Attack action's size is the largest branch, so a
 * reader that took the second branch without the gate would hand the golem
 * three Slams on every turn — an attack the book gates, given away free.
 *
 * So the gate is read *with* the branch or neither is read. The name it states
 * has to be a line the same block prints under Bonus Actions, and what comes
 * back is that line's **heading** — the string a caller spends and the string
 * the ledger records — so nothing downstream has to match a sentence against a
 * heading again.
 */
describe('a branch gated on a printed Bonus Action', () => {
  const GOLEM = 'The golem makes two Slam attacks, or it makes three Slam attacks if it used Hasten this turn.';

  it('reads the golem’s sentence when the block’s Bonus Actions are known', () => {
    expect(parseMultiattack(GOLEM, ['Slam'], ['Hasten (Recharge 5–6)'])).toEqual({
      alternatives: [
        [{ count: 2, attack: 'Slam' }],
        {
          entries: [{ count: 3, attack: 'Slam' }],
          requires: { usedBonusAction: 'Hasten (Recharge 5–6)' },
        },
      ],
    });
  });

  /**
   * **The gate and the branch land together or neither does.** A caller that
   * passes no Bonus Actions — every caller before this existed, and the default
   * the signature keeps — gets the reading the parser has always given, which
   * is none at all rather than a free third Slam.
   */
  it('reads nothing when nothing can bind the gate', () => {
    expect(parseMultiattack(GOLEM, ['Slam'])).toBeNull();
    expect(parseMultiattack(GOLEM, ['Slam'], ['Nimble Escape'])).toBeNull();
  });

  /** And the gate binds through the recharge the heading carries, or not at all. */
  it('binds the name the sentence prints to the heading the block prints', () => {
    const plain = parseMultiattack(GOLEM, ['Slam'], ['Hasten']);
    expect(plain?.alternatives?.[1]).toEqual({
      entries: [{ count: 3, attack: 'Slam' }],
      requires: { usedBonusAction: 'Hasten' },
    });
  });

  /**
   * A sentence that gates every branch would leave the creature no Attack
   * action at all on an ordinary turn, which is not a thing the book prints.
   */
  it('reads nothing where every branch is gated', () => {
    expect(
      parseMultiattack(
        'The golem makes two Slam attacks if it used Hasten this turn, or it makes three Slam attacks if it used Hasten this turn.',
        ['Slam'],
        ['Hasten'],
      ),
    ).toBeNull();
  });

  /** And the block itself, read through the whole parser. */
  it('reads the Clay Golem’s line out of the book', () => {
    expect(action('clay-golem', 'Multiattack').multiattack).toEqual({
      alternatives: [
        [{ count: 2, attack: 'Slam' }],
        {
          entries: [{ count: 3, attack: 'Slam' }],
          requires: { usedBonusAction: 'Hasten (Recharge 5–6)' },
        },
      ],
    });
  });
});

describe('a use that names a printed attack and is still not a swap', () => {
  it('keeps the sequence and hands the clause over when the swap cannot be written', () => {
    // Two entries in the base, so the sentence does not say which of them the
    // replaced swing came out of.
    const text =
      'The thing makes one Claw attack and one Tail attack. It can replace one attack with a use of Bite.';
    const unbound = parseMultiattack(text, ['Claw', 'Tail']);
    expect(unbound).toEqual({
      entries: [
        { count: 1, attack: 'Claw' },
        { count: 1, attack: 'Tail' },
      ],
      handOver: 'It can replace one attack with a use of Bite.',
    });
    expect(parseMultiattack(text, ['Claw', 'Tail', 'Bite'])).toEqual(unbound);
  });

  /**
   * And a replacement may not put one name in two entries of a sequence any
   * more than a trailing use may: the engine assigns a turn's swings in a
   * single pass, and a guard on one clause is worth nothing while the sentence
   * beside it can write the same thing.
   */
  it('refuses a replacement that would name one attack in two entries', () => {
    expect(
      parseMultiattack(
        'The thing makes two Bite attacks. It can replace one attack with a use of Bite.',
        ['Bite'],
      ),
    ).toEqual({
      entries: [{ count: 2, attack: 'Bite' }],
      handOver: 'It can replace one attack with a use of Bite.',
    });
    // The same sequence, in the wording the book prints for a printed line —
    // where there is no hand-over to fall back to, so the line stays prose.
    expect(
      parseMultiattack('The thing makes two Bite attacks. It can replace one attack with a Bite attack.'),
    ).toBeNull();
  });
});

/**
 * *N/Day*: the book's **other** sentence about how often a line may be used,
 * and it is not a recharge.
 *
 * "Dominate Mind (2/Day)", "Fetid Cloud (1/Day)", "Divine Aid (3/Day)". No
 * die, no turn boundary and no rest — the owner has ruled that one of these
 * comes back at **dawn**, which is a clock the engine already holds a tag for
 * and which `resources-restored` deliberately keeps apart from a rest. So the
 * two notations are two fields, read off the one place the book writes either:
 * the heading.
 *
 * **The lair number is dropped, and that is a decision rather than an
 * omission.** Twenty-seven of the book's per-day headings print a second
 * number — "Legendary Resistance (3/Day, or 4/Day in Lair)" — and every one of
 * them is a Legendary Resistance trait. The engine has no lair, no state that
 * could say a creature is in one, and no rule that reads a failed save at all,
 * so the second number would be a field with no reader in any of those three
 * senses. It is also the answer this parser already gives to the same
 * construction one field along: `CR_LINE` swallows "or 7,200 in lair" and
 * takes the XP the book prints outside it. What is carried is the number that
 * is true wherever the engine can actually put the creature.
 *
 * **A qualification is not a reason to drop the number.** SRD Night Hag prints
 * "Nightmare Haunting (1/Day; Requires Soul Bag)", and the engine cannot check
 * a soul bag. It can check the 1, and a limit it enforces is never more
 * permissive than the book — where dropping it would make the line unlimited,
 * which is wrong in the direction that matters.
 */
describe('a per-day limit on a printed line', () => {
  /** Every line in the bestiary, whichever section it is printed under. */
  const everyLine = bestiary.flatMap((monster) =>
    [
      ...monster.traits,
      ...monster.actions,
      ...monster.bonusActions,
      ...monster.reactions,
      ...monster.legendaryActions,
    ].map((line) => ({ monster: monster.id, line })),
  );

  const lineOf = (id: string, section: 'traits' | 'actions' | 'bonusActions', starts: string) => {
    const found = find(id)[section].find((line) => line.name.startsWith(starts));
    expect(found, `${id} prints no ${section} line starting ${starts}`).toBeDefined();
    return found!;
  };

  it('reads the number the book prints, off the name', () => {
    expect(action('aboleth', 'Dominate Mind (2/Day)').perDay).toBe(2);
    expect(lineOf('dretch', 'actions', 'Fetid Cloud').perDay).toBe(1);
    expect(lineOf('priest', 'bonusActions', 'Divine Aid').perDay).toBe(3);
    expect(lineOf('tarrasque', 'traits', 'Legendary Resistance').perDay).toBe(6);
  });

  /**
   * The number outside the lair, and no second field for the one inside it —
   * see the note above this block.
   */
  it('takes the number printed outside a lair and carries nothing for the one inside', () => {
    const resistance = lineOf('aboleth', 'traits', 'Legendary Resistance');
    expect(resistance.name).toContain('or 4/Day in Lair');
    expect(resistance.perDay).toBe(3);
    // Nothing anywhere on the parsed line holds the lair's number: the only 4
    // on this record is the one the heading itself prints.
    expect(JSON.stringify({ ...resistance, name: '', text: '' })).not.toContain('4');
  });

  /** The number is readable; the soul bag is not. The readable half is read. */
  it('reads through a qualification it cannot evaluate', () => {
    const haunting = lineOf('night-hag', 'actions', 'Nightmare Haunting');
    expect(haunting.name).toContain('Requires Soul Bag');
    expect(haunting.perDay).toBe(1);
  });

  it('leaves a line the book prints no limit on without the field', () => {
    expect(action('wolf', 'Bite').perDay).toBeUndefined();
    expect(action('ape', 'Rock (Recharge 6)').perDay).toBeUndefined();
  });

  /**
   * **Asserted against the names, and counted.** A parser that silently read
   * nothing would satisfy "no line disagrees with its name"; the counts are
   * what say it read them all — and the split by section is what says where
   * they are, which is the whole of what decides how many of them the engine
   * can reach today.
   */
  it('reads every per-day line in the book, in every section', () => {
    const printed = /\d+\s*\/\s*Day/i;
    let read = 0;
    for (const { monster, line } of everyLine) {
      expect(line.perDay !== undefined, `${monster}: ${line.name}`).toBe(printed.test(line.name));
      if (line.perDay !== undefined) read += 1;
    }
    expect(read).toBe(60);

    const per = (
      section: 'traits' | 'actions' | 'bonusActions' | 'reactions' | 'legendaryActions',
    ) => bestiary.flatMap((m) => m[section]).filter((line) => line.perDay !== undefined).length;
    expect(per('traits')).toBe(33);
    expect(per('actions')).toBe(10);
    expect(per('bonusActions')).toBe(12);
    expect(per('reactions')).toBe(5);
    expect(per('legendaryActions')).toBe(0);

    const blocks = bestiary.filter((m) =>
      [...m.traits, ...m.actions, ...m.bonusActions, ...m.reactions, ...m.legendaryActions].some(
        (line) => line.perDay !== undefined,
      ),
    );
    expect(blocks).toHaveLength(54);
  });

  /**
   * **The corpus fact the two rules rest on.** A recharge and a per-day limit
   * are different clocks — a die at the start of a turn against a sunrise —
   * and no heading in the SRD prints both. So nothing has to decide which of
   * the two answers first, and a line that printed both would be a rule
   * nobody has written rather than a case quietly settled by ordering.
   */
  it('never prints both notations on one heading', () => {
    const both = everyLine.filter(
      ({ line }) => line.recharge !== undefined && line.perDay !== undefined,
    );
    expect(both.map(({ monster, line }) => `${monster}: ${line.name}`)).toEqual([]);
  });

  /** And the forms themselves, read directly, including one the book does not print. */
  it('reads the notation off a heading and refuses everything else', () => {
    expect(parsePerDay('Roar (3/Day)')).toBe(3);
    expect(parsePerDay('Legendary Resistance (4/Day, or 5/Day in Lair)')).toBe(4);
    expect(parsePerDay('Nightmare Haunting (1/Day; Requires Soul Bag)')).toBe(1);
    // Two digits: nothing in the SRD prints one, and a rule that read a single
    // digit would silently turn a homebrew "12/Day" line into a 1/Day one.
    expect(parsePerDay('Homebrew Line (12/Day)')).toBe(12);
    expect(parsePerDay('Bite')).toBeNull();
    expect(parsePerDay('Whirlwind (Recharge 4–6)')).toBeNull();
    // Outside the parenthesis the book prints it in, it is prose.
    expect(parsePerDay('Three A Day')).toBeNull();
    // A count of nothing is not a limit the book prints.
    expect(parsePerDay('Broken (0/Day)')).toBeNull();
  });
});
