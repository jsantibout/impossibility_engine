import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { detectEntryLevel, parseMonsters, parseSignedNumber } from './monsters.js';
import { MonsterSchema } from '../schemas.js';

/** U+2212 MINUS SIGN — what the source actually uses for negative modifiers. */
const MINUS = '−';

const abilityTable = (rows: readonly [string, number, string, string][]) => {
  const cells = rows
    .map(
      ([abbr, score, mod, save]) =>
        `      <td><strong>${abbr}</strong></td>\n      <td>${score}</td>\n      <td>${mod}</td>\n      <td>${save}</td>`,
    )
    .join('\n');
  return `<table>\n  <tbody>\n    <tr>\n${cells}\n    </tr>\n  </tbody>\n</table>`;
};

const GOBLIN_MINION = `### Goblin Minion

_Small Fey (Goblinoid), Chaotic Neutral_

**AC** 12 **Initiative** +2 (12) <br>
**HP** 7 (2d6) <br>
**Speed** 30 ft. <br>

${abilityTable([
  ['STR', 8, `${MINUS}1`, `${MINUS}1`],
  ['DEX', 15, '+2', '+2'],
  ['CON', 10, '+0', '+0'],
  ['INT', 10, '+0', '+0'],
  ['WIS', 8, `${MINUS}1`, `${MINUS}1`],
  ['CHA', 8, `${MINUS}1`, `${MINUS}1`],
])}

**Skills** Stealth +6<br>
**Gear** Daggers (3)<br>
**Senses** Darkvision 60 ft.; Passive Perception 9<br>
**Languages** Common, Goblin<br>
**CR** 1/8 (XP 25; PB +2)

#### Actions

<hr>

**_Dagger._** _Melee or Ranged Attack Roll:_ +4, reach 5 ft. or range 20/60 ft. _Hit:_ 4 (1d4 + 2) Piercing damage.

#### Bonus Actions

<hr>

**_Nimble Escape._** The goblin takes the Disengage or Hide action.
`;

const one = (md: string) => {
  const { items, problems } = parseMonsters(md, 'test.md');
  expect(problems).toEqual([]);
  expect(items).toHaveLength(1);
  return items[0]!;
};

describe('parseSignedNumber', () => {
  it('parses a plain positive number', () => {
    expect(parseSignedNumber('12')).toBe(12);
  });

  it('parses an explicit plus', () => {
    expect(parseSignedNumber('+4')).toBe(4);
  });

  it('parses an ASCII hyphen minus', () => {
    expect(parseSignedNumber('-1')).toBe(-1);
  });

  // The whole reason this helper exists: 498 of the modifier cells in
  // monsters-A-Z.md use U+2212, not a hyphen. parseInt returns NaN on those.
  it('parses a U+2212 MINUS SIGN', () => {
    expect(parseSignedNumber(`${MINUS}1`)).toBe(-1);
    expect(parseSignedNumber(`${MINUS}12`)).toBe(-12);
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseSignedNumber(`  ${MINUS}3  `)).toBe(-3);
  });

  it('returns null for anything that is not a number', () => {
    expect(parseSignedNumber('')).toBeNull();
    expect(parseSignedNumber('none')).toBeNull();
    expect(parseSignedNumber('+')).toBeNull();
  });
});

describe('parseMonsters', () => {
  it('parses identity from the type line', () => {
    expect(one(GOBLIN_MINION)).toMatchObject({
      id: 'goblin-minion',
      name: 'Goblin Minion',
      size: 'small',
      type: 'Fey',
      subtype: 'Goblinoid',
      alignment: 'Chaotic Neutral',
    });
  });

  it('parses AC and the inline initiative modifier', () => {
    expect(one(GOBLIN_MINION)).toMatchObject({ ac: 12, initiative: 2 });
  });

  it('parses hit points and the dice formula', () => {
    expect(one(GOBLIN_MINION).hp).toEqual({ average: 7, formula: '2d6' });
  });

  it('parses a walk-only speed', () => {
    expect(one(GOBLIN_MINION).speed).toEqual({
      walk: 30,
      burrow: null,
      climb: null,
      fly: null,
      swim: null,
      hover: false,
    });
  });

  it('parses negative ability modifiers written with U+2212', () => {
    const { abilities } = one(GOBLIN_MINION);
    expect(abilities.str).toEqual({ score: 8, modifier: -1, save: -1 });
    expect(abilities.dex).toEqual({ score: 15, modifier: 2, save: 2 });
    expect(abilities.con).toEqual({ score: 10, modifier: 0, save: 0 });
    expect(abilities.cha).toEqual({ score: 8, modifier: -1, save: -1 });
  });

  it('parses skills, gear, senses and languages', () => {
    const m = one(GOBLIN_MINION);
    expect(m.skills).toEqual({ stealth: 6 });
    expect(m.gear).toEqual(['Daggers (3)']);
    expect(m.senses).toEqual(['Darkvision 60 ft.']);
    expect(m.passivePerception).toBe(9);
    expect(m.languages).toEqual(['Common', 'Goblin']);
  });

  it('parses a fractional challenge rating into a number and a label', () => {
    expect(one(GOBLIN_MINION)).toMatchObject({
      cr: 0.125,
      crLabel: '1/8',
      xp: 25,
      proficiencyBonus: 2,
    });
  });

  it('splits features into their sections', () => {
    const m = one(GOBLIN_MINION);
    expect(m.actions).toHaveLength(1);
    expect(m.actions[0]!.name).toBe('Dagger');
    expect(m.actions[0]!.text).toContain('1d4 + 2');
    expect(m.bonusActions).toHaveLength(1);
    expect(m.bonusActions[0]!.name).toBe('Nimble Escape');
    expect(m.traits).toEqual([]);
    expect(m.reactions).toEqual([]);
    expect(m.legendaryActions).toEqual([]);
  });

  it('parses multiple movement modes and the hover annotation', () => {
    const md = GOBLIN_MINION.replace(
      '**Speed** 30 ft. <br>',
      '**Speed** 10 ft., Climb 20 ft., Fly 90 ft. (hover), Swim 40 ft., Burrow 15 ft. <br>',
    );
    expect(one(md).speed).toEqual({
      walk: 10,
      burrow: 15,
      climb: 20,
      fly: 90,
      swim: 40,
      hover: true,
    });
  });

  it('handles an initiative given on its own line instead of inline', () => {
    // The Succubus is the one stat block of 235 that does this.
    const md = GOBLIN_MINION.replace(
      '**AC** 12 **Initiative** +2 (12) <br>',
      '**AC** 15 <br>',
    ).replace('**CR** 1/8 (XP 25; PB +2)', '**CR** 1/8 (XP 25; PB +2)\n\n**Initiative** +3 (13)');
    expect(one(md)).toMatchObject({ ac: 15, initiative: 3 });
  });

  it('parses resistances, immunities and vulnerabilities when present', () => {
    const md = GOBLIN_MINION.replace(
      '**Skills** Stealth +6<br>',
      '**Skills** Stealth +6<br>\n**Vulnerabilities** Radiant<br>\n**Resistances** Cold, Fire<br>\n**Immunities** Poison; Charmed, Frightened<br>',
    );
    const m = one(md);
    expect(m.vulnerabilities).toEqual(['Radiant']);
    expect(m.resistances).toEqual(['Cold', 'Fire']);
    expect(m.immunities).toEqual(['Poison', 'Charmed', 'Frightened']);
  });

  it('reports a problem rather than throwing on a malformed entry', () => {
    const broken = GOBLIN_MINION.replace('**AC** 12 **Initiative** +2 (12) <br>', '');
    const { items, problems } = parseMonsters(broken, 'test.md');
    expect(items).toEqual([]);
    expect(problems).toHaveLength(1);
    expect(problems[0]!.entry).toBe('Goblin Minion');
  });

  it('ignores group headings that are not stat blocks', () => {
    const { items, problems } = parseMonsters('## Goblins\n\nSome flavour text.\n', 'test.md');
    expect(items).toEqual([]);
    expect(problems).toEqual([]);
  });
});

describe('the vendored SRD bestiary', () => {
  const read = (file: string) =>
    readFileSync(fileURLToPath(new URL(`../../raw/${file}`, import.meta.url)), 'utf8');

  const monsters = parseMonsters(read('monsters-A-Z.md'), 'monsters-A-Z.md');
  const animals = parseMonsters(read('animals.md'), 'animals.md');

  it('parses monsters-A-Z.md without problems', () => {
    expect(monsters.problems).toEqual([]);
  });

  it('parses animals.md without problems', () => {
    expect(animals.problems).toEqual([]);
  });

  it('finds all 235 stat blocks in monsters-A-Z.md', () => {
    expect(monsters.items).toHaveLength(235);
  });

  // animals.md shifts its heading hierarchy up a level relative to
  // monsters-A-Z.md. Asserting only "no problems" let a silent zero through
  // once already, so both files assert a count.
  it('finds all 95 stat blocks in animals.md', () => {
    expect(animals.items).toHaveLength(95);
  });

  it('detects the entry heading level per file rather than assuming it', () => {
    expect(detectEntryLevel(read('monsters-A-Z.md'))).toBe(3);
    expect(detectEntryLevel(read('animals.md'))).toBe(2);
  });

  it('parses animal sections at the shifted level', () => {
    const ape = animals.items.find((m) => m.id === 'ape');
    expect(ape).toMatchObject({ size: 'medium', type: 'Beast' });
    expect(ape?.actions.length).toBeGreaterThan(0);
  });

  it('validates every entry against the schema', () => {
    for (const monster of [...monsters.items, ...animals.items]) {
      const parsed = MonsterSchema.safeParse(monster);
      expect(parsed.success, `${monster.name}: ${parsed.error?.message ?? ''}`).toBe(true);
    }
  });

  it('has unique ids within each file', () => {
    const ids = monsters.items.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('never produces NaN for an ability modifier', () => {
    for (const m of [...monsters.items, ...animals.items]) {
      for (const [ability, block] of Object.entries(m.abilities)) {
        expect(Number.isInteger(block.modifier), `${m.name} ${ability}.modifier`).toBe(true);
        expect(Number.isInteger(block.save), `${m.name} ${ability}.save`).toBe(true);
        expect(Number.isInteger(block.score), `${m.name} ${ability}.score`).toBe(true);
      }
    }
  });

  it('actually exercises the U+2212 path', () => {
    // If this ever hits zero the encoding regression test above has gone stale.
    const negatives = monsters.items.filter((m) =>
      Object.values(m.abilities).some((a) => a.modifier < 0),
    );
    expect(negatives.length).toBeGreaterThan(50);
  });

  const find = (id: string) => monsters.items.find((m) => m.id === id);

  it.each([
    ['goblin-minion', { size: 'small', type: 'Fey', ac: 12, cr: 0.125, crLabel: '1/8' }],
    ['goblin-warrior', { ac: 15, cr: 0.25, crLabel: '1/4' }],
    ['adult-red-dragon', { size: 'huge', type: 'Dragon', cr: 17 }],
    ['succubus', { ac: 15, initiative: 3 }],
  ])('spot-checks %s', (id, expected) => {
    const monster = find(id);
    expect(monster, `${id} missing from parsed bestiary`).toBeDefined();
    expect(monster).toMatchObject(expected);
  });

  it('spot-checks the Goblin Minion dagger action', () => {
    const dagger = find('goblin-minion')?.actions[0];
    expect(dagger?.name).toBe('Dagger');
    expect(dagger?.text).toContain('+4');
    expect(dagger?.text).toContain('Piercing damage');
  });

  it('covers the full challenge rating range', () => {
    const crs = new Set(monsters.items.map((m) => m.cr));
    expect(crs.has(0)).toBe(true);
    expect(crs.has(0.125)).toBe(true);
    expect(Math.max(...crs)).toBe(30);
  });

  it('gives every monster at least one feature of some kind', () => {
    // Not necessarily an action: the Shrieker Fungus has only a Reaction.
    for (const m of monsters.items) {
      const total =
        m.traits.length +
        m.actions.length +
        m.bonusActions.length +
        m.reactions.length +
        m.legendaryActions.length;
      expect(total, `${m.name} has no features at all`).toBeGreaterThan(0);
    }
  });

  it('parses the Shrieker Fungus, which has only a Reaction', () => {
    const shrieker = find('shrieker-fungus');
    expect(shrieker?.actions).toEqual([]);
    expect(shrieker?.traits).toEqual([]);
    expect(shrieker?.reactions.map((r) => r.name)).toEqual(['Shriek']);
  });

  it('parses "Medium or Small" entries with the alternate size recorded', () => {
    const commoner = find('commoner');
    expect(commoner?.size).toBe('medium');
    expect(commoner?.alternateSizes).toEqual(['small']);
    expect(commoner?.type).toBe('Humanoid');
  });

  it('keeps the class tag on entries like Mage that have both a size choice and a tag', () => {
    const mage = find('mage');
    expect(mage).toMatchObject({
      size: 'medium',
      alternateSizes: ['small'],
      type: 'Humanoid',
      subtype: 'Wizard',
    });
  });

  it('parses a swarm into its own size, member size and member type', () => {
    const swarm = find('swarm-of-crawling-claws');
    expect(swarm).toMatchObject({
      size: 'medium',
      swarmMemberSize: 'tiny',
      type: 'Undead',
    });
  });

  it('leaves swarmMemberSize null for ordinary creatures', () => {
    expect(find('goblin-minion')?.swarmMemberSize).toBeNull();
    expect(find('goblin-minion')?.alternateSizes).toEqual([]);
  });

  // The three stat blocks whose ability tables are mangled upstream. Values
  // come from the official PDF via overrides.ts; see that file for why.
  it.each([
    ['will-o-wisp', { str: 1, dex: 28, con: 10, int: 13, wis: 14, cha: 11 }],
    ['ancient-red-dragon', { str: 30, dex: 10, con: 29, int: 18, wis: 15, cha: 27 }],
    ['remorhaz', { str: 24, dex: 13, con: 21, int: 4, wis: 10, cha: 5 }],
  ])('applies the ability override for %s', (id, scores) => {
    const monster = find(id);
    expect(monster, `${id} missing`).toBeDefined();
    const abilities = monster!.abilities;
    for (const [ability, score] of Object.entries(scores)) {
      expect(abilities[ability as keyof typeof abilities].score, `${id} ${ability}`).toBe(score);
    }
  });

  it('keeps overridden modifiers consistent with their scores', () => {
    for (const id of ['will-o-wisp', 'ancient-red-dragon', 'remorhaz']) {
      const monster = find(id)!;
      for (const [ability, block] of Object.entries(monster.abilities)) {
        expect(block.modifier, `${id} ${ability} modifier`).toBe(
          Math.floor((block.score - 10) / 2),
        );
      }
    }
  });

  it('still refuses a mangled ability table that has no override', () => {
    // Guards the override path from becoming a silent catch-all: a future
    // upstream defect must fail loudly, not inherit someone else's numbers.
    const mangled = `### Unknown Beast

_Medium Beast, Unaligned_

**AC** 12 **Initiative** +0 (10) <br>
**HP** 10 (2d8) <br>
**Speed** 30 ft. <br>

<table><tbody><tr>
<td><strong>STR</strong></td><td>+7 +7</td><td>DEX</td><td>junk</td>
</tr></tbody></table>

**Senses** Passive Perception 10<br>
**Languages** None<br>
**CR** 1 (XP 200; PB +2)
`;
    const { items, problems } = parseMonsters(mangled, 'test.md');
    expect(items).toEqual([]);
    expect(problems).toHaveLength(1);
    expect(problems[0]!.message).toContain('ability score table');
  });
});
