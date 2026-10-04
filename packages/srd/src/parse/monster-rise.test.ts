import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  parseHealLine,
  parseMonsters,
  parseRaiseLine,
  parseRecharge,
  parseSaveLine,
  parseTeleportLine,
  parseTraitShape,
  parseTypeQualification,
} from './monsters.js';
import { MonsterRechargeSchema, MonsterSaveSchema } from '../schemas.js';

/**
 * M-RISE: limbs, specters and the steed — what the parser reads out of the
 * last six CR ≤ 5 lines of the slice.
 *
 * SRD Troll's Loathsome Limbs, SRD Wraith's Create Specter, and four lines SRD
 * Find Steed prints on its Otherworldly Steed: Life Bond, Fell Glare (Fiend
 * Only), Fey Step (Fey Only), Healing Touch (Celestial Only). Each sentence is
 * matched end to end, so a sentence one clause longer is refused whole.
 */

const read = (file: string) =>
  readFileSync(fileURLToPath(new URL(`../../raw/${file}`, import.meta.url)), 'utf8');

const bestiary = parseMonsters(read('monsters-A-Z.md'), 'monsters-A-Z.md').items;

const find = (id: string) => {
  const monster = bestiary.find((m) => m.id === id);
  if (monster === undefined) throw new Error(`no stat block called ${id}`);
  return monster;
};

const LIFE_BOND =
  "When you regain Hit Points from a level 1+ spell, the steed regains the same number of Hit Points if you're within 5 feet of it.";
const FELL_GLARE =
  '_Wisdom Saving Throw:_ DC equals your spell save DC, one creature within 60 feet the steed can see. _Failure:_ The target has the Frightened condition until the end of your next turn.';
const FEY_STEP =
  'The steed teleports, along with its rider, to an unoccupied space of your choice up to 60 feet away from itself.';
const HEALING_TOUCH =
  "One creature within 5 feet of the steed regains a number of Hit Points equal to 2d8 plus the spell's level.";

describe('the steed’s headings', () => {
  it('reads "Recharges after a Long Rest" as the Long Rest alone', () => {
    expect(parseRecharge('Fell Glare (Fiend Only; Recharges after a Long Rest)')).toEqual({
      kind: 'long-rest',
    });
    expect(MonsterRechargeSchema.safeParse({ kind: 'long-rest' }).success).toBe(true);
    // The other rest notation is still the Short or Long Rest it was.
    expect(parseRecharge('Breath (Recharge after a Short or Long Rest)')).toEqual({ kind: 'rest' });
    expect(parseRecharge('Fire Breath (Recharge 5–6)')).toEqual({ kind: 'die', low: 5 });
  });

  it('reads "(Fiend Only; …)" as the creature type the line is printed for', () => {
    expect(parseTypeQualification('Fell Glare (Fiend Only; Recharges after a Long Rest)')).toEqual([
      'Fiend',
    ]);
    expect(parseTypeQualification('Fey Step (Fey Only; Recharges after a Long Rest)')).toEqual(['Fey']);
    expect(
      parseTypeQualification('Healing Touch (Celestial Only; Recharges after a Long Rest)'),
    ).toEqual(['Celestial']);
  });

  it('reads no type out of a form clause or a heading that prints none', () => {
    expect(parseTypeQualification('Bite (Wolf or Hybrid Form Only)')).toBeNull();
    expect(parseTypeQualification('Rend')).toBeNull();
    expect(parseTypeQualification('Nightmare Haunting (1/Day; Requires Soul Bag)')).toBeNull();
  });
});

describe('the steed’s lines', () => {
  it('reads Fell Glare whole, its span anchored on the summoner’s turn', () => {
    const save = parseSaveLine(FELL_GLARE);
    expect(save).toEqual({
      ability: 'wis',
      dc: 0,
      dcFromSummoner: 'spell-save',
      targets: 'one creature within 60 feet the steed can see',
      onSuccess: 'none',
      onFailure: [
        {
          kind: 'condition',
          condition: 'frightened',
          lasts: { kind: 'turn', moment: 'end', of: 'summoner' },
        },
      ],
      reach: { feet: 60, count: 1, seen: true },
    });
    expect(MonsterSaveSchema.safeParse(save).success).toBe(true);
  });

  it('reads Fey Step as a teleport of 60 feet with no sight clause', () => {
    expect(parseTeleportLine(FEY_STEP)).toEqual({ feet: 60 });
    // Blink Dog's sentence still carries its sight clause.
    expect(
      parseTeleportLine('The dog teleports up to 40 feet to an unoccupied space it can see.'),
    ).toEqual({ feet: 40, mustSee: true });
  });

  it('reads Healing Touch as 2d8 plus the slot level, to one creature within 5 feet', () => {
    expect(parseHealLine(HEALING_TOUCH)).toEqual({
      dice: '2d8',
      flat: 0,
      flatFromSlotLevel: true,
      within: 5,
    });
    expect(parseHealLine('One creature within 5 feet of the steed regains 2d8 Hit Points.')).toBeNull();
  });

  it('reads Life Bond as healing shared with the summoner, from a level 1+ spell, within 5 feet', () => {
    expect(parseTraitShape(LIFE_BOND)).toEqual({
      kind: 'regains-what-its-summoner-regains-from-a-spell',
      minimumSpellLevel: 1,
      within: 5,
    });
  });
});

describe('SRD Troll, Loathsome Limbs', () => {
  it('reads the trigger, the block, and the heading’s day', () => {
    const line = find('troll').traits.find((one) => one.name === 'Loathsome Limbs (4/Day)');
    expect(line?.perDay).toBe(4);
    expect(line?.trait).toEqual({
      kind: 'severs-a-limb',
      damageType: 'slashing',
      atLeast: 15,
      block: 'troll-limb',
      perDay: 4,
    });
  });

  it('refuses the sentence one clause longer', () => {
    const text = find('troll').traits.find((one) => one.name === 'Loathsome Limbs (4/Day)')!.text;
    expect(parseTraitShape(`${text} The limb is Prone.`)).toBeNull();
  });
});

describe('SRD Wraith, Create Specter', () => {
  it('reads the corpse it targets, the block that rises, and the seven it may control', () => {
    const line = find('wraith').actions.find((one) => one.name === 'Create Specter');
    expect(line?.raises).toEqual({
      block: 'specter',
      within: 10,
      corpseType: 'Humanoid',
      deadForAtMostSeconds: 60,
      controlsAtMost: 7,
    });
  });

  it('refuses a sentence that does not say the creature is controlled', () => {
    expect(
      parseRaiseLine(
        "The wraith targets a Humanoid corpse within 10 feet of itself that has been dead for no longer than 1 minute. The target's spirit rises as a **Specter** in the space of its corpse or in the nearest unoccupied space.",
      ),
    ).toBeNull();
  });
});
