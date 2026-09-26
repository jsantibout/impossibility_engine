import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseAttackLine, parseSaveLine, type Monster } from '@ie/srd';
import { OTHERWORLDLY_STEED, PHANTOM_STEED_BLOCK, SPELL_STAT_BLOCKS } from './bestiary.js';

/**
 * The two stat blocks the book prints inside a spell's own entry, held to the
 * book.
 *
 * Everything else in the bestiary is generated: the parser reads the Monsters
 * chapter and `coverage.test.ts` asserts the catalogue carries exactly what it
 * produced. These two are typed by hand, which means every number in them is
 * somebody's reading — and a hand-written stat block nobody compares to
 * anything is the one place in this catalogue where an invented number would
 * sit unchallenged for ever. Nothing reads `hp.formula`; `type` is read by
 * `mustBeType` and by every Beast-gated effect; a Speed is read by the ruler.
 *
 * So the claims each block makes about the book are asserted rather than
 * documented:
 *
 * - **Phantom Steed is the Riding Horse with one thing changed**, because the
 *   SRD prints exactly one exception — "except it has a Speed of 100 feet" —
 *   and this compares the two blocks field for field with the differences
 *   named. A second deviation has to be added to that list, where a reader
 *   will ask what printed it.
 * - **The Otherworldly Steed's numbers are the ones its own entry prints**,
 *   quoted out of the parsed spell text rather than restated here.
 */

const parsedMonsters = JSON.parse(
  readFileSync('packages/srd/src/generated/monsters.json', 'utf8'),
) as readonly Monster[];

interface ParsedSpell {
  readonly id: string;
  readonly description: string;
  readonly higherLevel: string | null;
}

const parsedSpells = JSON.parse(
  readFileSync('packages/srd/src/generated/spells.json', 'utf8'),
) as readonly ParsedSpell[];

/** The whole of a spell's printed text, both halves, as the parser kept it. */
const printedText = (id: string): string => {
  const entry = parsedSpells.find((s) => s.id === id);
  expect(entry, `${id} is not in the parsed SRD`).toBeDefined();
  return `${entry!.description}\n${entry!.higherLevel ?? ''}`;
};

describe('a stat block the book prints inside a spell', () => {
  it('is one of the two, and both are in the catalogue’s list', () => {
    expect(SPELL_STAT_BLOCKS.map((m) => m.id)).toEqual(['otherworldly-steed', 'phantom-steed']);
  });

  /**
   * The rule the note on `PHANTOM_STEED_BLOCK` states, as a test: one printed
   * exception, one difference, and the three identity fields a new entry
   * cannot avoid.
   */
  it('copies the Riding Horse for Phantom Steed, with only the Speed the spell prints', () => {
    const horse = parsedMonsters.find((m) => m.id === 'riding-horse');
    expect(horse, 'the parsed Riding Horse').toBeDefined();

    const differs = (Object.keys(horse!) as (keyof Monster)[]).filter(
      (key) =>
        JSON.stringify(PHANTOM_STEED_BLOCK[key]) !== JSON.stringify(horse![key]),
    );
    // Its own id and its own name, because it is its own entry; and the Speed,
    // which is the one thing the SRD's sentence changes. The **type** is not
    // here, which is the claim that matters: "quasi-real" is an argument for
    // something other than a Beast and the book prints no such exception.
    expect(differs.sort()).toEqual(['id', 'name', 'speed']);
    expect(PHANTOM_STEED_BLOCK.speed).toEqual({ ...horse!.speed, walk: 100 });
    expect(PHANTOM_STEED_BLOCK.type).toBe('Beast');
  });

  it('quotes the sentence that licenses the one difference', () => {
    const printed = printedText('phantom-steed');
    expect(printed).toContain('uses the Riding Horse stat block');
    expect(printed).toContain('except it has a Speed of 100 feet');
  });

  /**
   * And the Otherworldly Steed's own entry, read out of the spell text the
   * parser kept rather than out of a reader's memory. The Armour Class and the
   * hit points are formulae the casting computes — `SpellEffect`'s `summon`
   * arm carries them — and what is asserted here is that the integers in the
   * block are those formulae at the spell's own level.
   */
  it('transcribes the Otherworldly Steed from the entry Find Steed prints', () => {
    const printed = printedText('find-steed');

    expect(printed).toContain('**AC** 10 + 1 per spell level');
    expect(printed).toContain('**HP** 5 + 10 per spell level');
    expect(printed).toContain('_Large Celestial, Fey, or Fiend (Your Choice), Neutral_');
    expect(printed).toContain('Telepathy 1 mile (works only with you)');
    expect(printed).toContain('**CR** None');

    const level = 2;
    expect(OTHERWORLDLY_STEED.ac).toBe(10 + 1 * level);
    expect(OTHERWORLDLY_STEED.hp.average).toBe(5 + 10 * level);
    // "a number of Hit Dice [d10s] equal to the spell's level", and nothing
    // added to them: no `+ N` is printed anywhere in the entry.
    expect(OTHERWORLDLY_STEED.hp.formula).toBe(`${level}d10`);
    expect(OTHERWORLDLY_STEED.size).toBe('large');
    expect(OTHERWORLDLY_STEED.alignment).toBe('Neutral');
    // The three the book offers, unpicked: choosing one here would answer a
    // question the SRD asks the caster.
    expect(OTHERWORLDLY_STEED.type).toBe('Celestial, Fey, or Fiend');
    expect(OTHERWORLDLY_STEED.passivePerception).toBe(11);
    // The walking Speed is printed flat and the flying one is gated on a level
    // 4 slot, so one is carried and the other is withheld — see the spell's
    // own `unmodelled`.
    expect(printed).toContain('**Speed** 60 ft., Fly 60 ft. (requires level 4+ spell)');
    expect(OTHERWORLDLY_STEED.speed.walk).toBe(60);
    expect(OTHERWORLDLY_STEED.speed.fly).toBeNull();
  });

  /**
   * The lines the block prints, each carried as the parser would read it.
   *
   * The Otherworldly Slam's numbers are the summoner's — "Bonus equals your
   * spell attack modifier", "1d8 plus the spell's level" of a type per choice
   * — and the parser reads exactly those words into marks; what is asserted
   * is that the transcription is byte for byte what `parseAttackLine` gives
   * for the printed sentence, so no reader's memory stands between the book
   * and the catalogue. The three Bonus Actions and Life Bond are prose: Fell
   * Glare's span is "until the end of **your** next turn", the summoner's,
   * which the save reader cannot name, and the other three print no template.
   */
  it('carries the Otherworldly Steed’s printed lines as the parser reads them', () => {
    const slam = OTHERWORLDLY_STEED.actions.find((line) => line.name === 'Otherworldly Slam');
    expect(slam).toBeDefined();
    expect(slam!.text).toBe(
      "_Melee Attack Roll:_ Bonus equals your spell attack modifier, reach 5 ft. _Hit:_ 1d8 plus the spell's level of Radiant (Celestial), Psychic (Fey), or Necrotic (Fiend) damage.",
    );
    expect(slam!.attack).toEqual(parseAttackLine(slam!.text));
    expect(slam!.attack).toMatchObject({
      bonusFromSummoner: 'spell-attack',
      damage: [
        {
          flatFromSlotLevel: true,
          typeFromChoice: { Celestial: 'radiant', Fey: 'psychic', Fiend: 'necrotic' },
        },
      ],
    });

    expect(OTHERWORLDLY_STEED.traits.map((line) => line.name)).toEqual(['Life Bond']);
    expect(OTHERWORLDLY_STEED.bonusActions.map((line) => line.name)).toEqual([
      'Fell Glare (Fiend Only; Recharges after a Long Rest)',
      'Fey Step (Fey Only; Recharges after a Long Rest)',
      'Healing Touch (Celestial Only; Recharges after a Long Rest)',
    ]);
    for (const line of [...OTHERWORLDLY_STEED.traits, ...OTHERWORLDLY_STEED.bonusActions]) {
      expect(line.attack, line.name).toBeUndefined();
      expect(line.save, line.name).toBeUndefined();
      // Prose because the parser reads nothing out of the sentence, not
      // because the transcription chose to leave it: the same reader answers
      // the same way for the printed text.
      expect(parseAttackLine(line.text), line.name).toBeNull();
      expect(parseSaveLine(line.text), line.name).toBeNull();
    }
  });

  /** The ability block the entry's table prints, score and modifier. */
  it.each([
    ['str', 18, 4],
    ['dex', 12, 1],
    ['con', 14, 2],
    ['int', 6, -2],
    ['wis', 12, 1],
    ['cha', 8, -1],
  ] as const)('gives the Otherworldly Steed the printed %s', (ability, score, modifier) => {
    expect(OTHERWORLDLY_STEED.abilities[ability]).toEqual({ score, modifier, save: modifier });
  });
});
