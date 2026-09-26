import { describe, expect, it } from 'vitest';
import { parseAttackLine, parseSaveLine } from './monsters.js';
import { DECLARED_DAMAGE_TYPE } from '../schemas.js';

/**
 * A printed line whose numbers are the **summoner's**.
 *
 * SRD Find Steed's Otherworldly Steed prints three casting facts inside its
 * own stat block: "_Melee Attack Roll:_ Bonus equals your spell attack
 * modifier", "_Hit:_ 1d8 plus the spell's level of Radiant (Celestial),
 * Psychic (Fey), or Necrotic (Fiend) damage", and "DC equals your spell save
 * DC". No integer stands where the template wants one, so until now every
 * such line was prose and the steed arrived with no attack.
 *
 * The parser reads exactly those words into **marks** beside the fields they
 * stand in for — `bonusFromSummoner`, `flatFromSlotLevel`, `typeFromChoice`,
 * `dcFromSummoner` — and leaves the number itself at the placeholder the
 * schema admits. Nothing here invents a value: the mark says whose number it
 * is, and `adaptMonster` either resolves it from the casting that raised the
 * creature or demotes the line to prose with a caveat, so a DM who walks the
 * block in with no casting never swings a number nobody supplied.
 */

const SLAM =
  "_Melee Attack Roll:_ Bonus equals your spell attack modifier, reach 5 ft. _Hit:_ 1d8 plus the spell's level of Radiant (Celestial), Psychic (Fey), or Necrotic (Fiend) damage.";

const GLARE =
  '_Wisdom Saving Throw:_ DC equals your spell save DC, one creature within 60 feet the warden can see. _Failure:_ The target has the Frightened condition until the end of its next turn.';

/** The steed's own Bonus Action, whose span is the **summoner's** turn. */
const FELL_GLARE =
  '_Wisdom Saving Throw:_ DC equals your spell save DC, one creature within 60 feet the steed can see. _Failure:_ The target has the Frightened condition until the end of your next turn.';

describe('an attack line whose bonus and damage are the summoner’s', () => {
  it('reads the Otherworldly Slam into marks rather than numbers', () => {
    expect(parseAttackLine(SLAM)).toEqual({
      kind: 'melee',
      modifier: 0,
      bonusFromSummoner: 'spell-attack',
      reach: 5,
      range: null,
      damage: [
        {
          dice: '1d8',
          flat: 0,
          flatFromSlotLevel: true,
          // Not a damage type: the word every reader refuses to roll on until
          // somebody says which of the three it is.
          type: DECLARED_DAMAGE_TYPE,
          typeFromChoice: { Celestial: 'radiant', Fey: 'psychic', Fiend: 'necrotic' },
          average: 0,
        },
      ],
      qualification: null,
      rider: null,
    });
  });

  it('reads a slot-level flat over a single printed type', () => {
    const line = "_Melee Attack Roll:_ Bonus equals your spell attack modifier, reach 5 ft. _Hit:_ 2d6 plus the spell's level of Radiant damage.";
    expect(parseAttackLine(line)?.damage).toEqual([
      { dice: '2d6', flat: 0, flatFromSlotLevel: true, type: 'radiant', average: 0 },
    ]);
  });

  it('leaves a numbered line exactly as it always read it', () => {
    const attack = parseAttackLine('_Melee Attack Roll:_ +6, reach 5 ft. _Hit:_ 7 (1d8 + 3) Psychic damage.');
    expect(attack).toEqual({
      kind: 'melee',
      modifier: 6,
      reach: 5,
      range: null,
      damage: [{ dice: '1d8', flat: 3, type: 'psychic', average: 7 }],
      qualification: null,
      rider: null,
    });
    expect(attack).not.toHaveProperty('bonusFromSummoner');
    expect(attack?.damage[0]).not.toHaveProperty('flatFromSlotLevel');
    expect(attack?.damage[0]).not.toHaveProperty('typeFromChoice');
  });

  it('still refuses a line whose hit it cannot read', () => {
    expect(
      parseAttackLine(
        '_Melee Attack Roll:_ Bonus equals your spell attack modifier, reach 5 ft. _Hit:_ the target is knocked flat.',
      ),
    ).toBeNull();
  });

  it('refuses a damage type the book does not print, even behind a choice', () => {
    expect(
      parseAttackLine(
        "_Melee Attack Roll:_ Bonus equals your spell attack modifier, reach 5 ft. _Hit:_ 1d8 plus the spell's level of Radiant (Celestial) or Sparkle (Fey) damage.",
      ),
    ).toBeNull();
  });
});

describe('a save line whose DC is the summoner’s', () => {
  it('reads "DC equals your spell save DC" into a mark', () => {
    const save = parseSaveLine(GLARE);
    expect(save).toMatchObject({
      ability: 'wis',
      dc: 0,
      dcFromSummoner: 'spell-save',
      targets: 'one creature within 60 feet the warden can see',
      onFailure: [
        {
          kind: 'condition',
          condition: 'frightened',
          lasts: { kind: 'turn', moment: 'end', of: 'target' },
        },
      ],
    });
  });

  it('leaves a numbered DC without the mark', () => {
    const save = parseSaveLine(GLARE.replace('DC equals your spell save DC', 'DC 14'));
    expect(save?.dc).toBe(14);
    expect(save).not.toHaveProperty('dcFromSummoner');
  });

  /**
   * The limit, pinned so it is a fact rather than a surprise: SRD Fell Glare
   * lasts "until the end of **your** next turn" — the summoner's, a third
   * creature's turn the span vocabulary (`of: 'target' | 'source'`) cannot
   * name. The line stays prose for the span, not for the DC, and the
   * bestiary's transcription carries it that way.
   */
  it('cannot read Fell Glare, whose span is the summoner’s turn', () => {
    expect(parseSaveLine(FELL_GLARE)).toBeNull();
  });
});
