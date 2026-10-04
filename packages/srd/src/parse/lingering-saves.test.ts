import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseMonsters, parseSaveLine } from './monsters.js';
import { parseRiderSave } from './printed-save.js';

/**
 * **A poison that outlasts the fight, read out of a hit's own save** — M-LINGER.
 *
 * SRD Death Dog, Bite: "If the target is a creature, it is subjected to the
 * following effect. _Constitution Saving Throw:_ DC 12. _First Failure:_ The
 * target has the Poisoned condition. While Poisoned, the target's Hit Point
 * maximum doesn't return to normal when finishing a Long Rest, and it repeats
 * the save every 24 hours that elapse, ending the effect on itself on a
 * success. _Subsequent Failures:_ The Poisoned target's Hit Point maximum
 * decreases by 5 (1d10)."
 *
 * The Poisoned is a condition with no span — its ending is the save the clock
 * owes — and the two sentences after it are what it does while it stands:
 * the Long Rest's maximum withheld, and a toll every 24 hours whose failure is
 * the "Subsequent Failures" rung. All three are read onto the condition as one
 * `lingers` record, which is the shape the engine's hit-rider reader writes
 * for the Mummy's, the Otyugh's and the Incubus's lines too.
 */

const read = (file: string) =>
  readFileSync(fileURLToPath(new URL(`../../raw/${file}`, import.meta.url)), 'utf8');

const bestiary = parseMonsters(read('monsters-A-Z.md'), 'monsters-A-Z.md').items;

const DEATH_DOG_RIDER =
  "If the target is a creature, it is subjected to the following effect. _Constitution Saving Throw:_ DC 12. _First Failure:_ The target has the Poisoned condition. While Poisoned, the target's Hit Point maximum doesn't return to normal when finishing a Long Rest, and it repeats the save every 24 hours that elapse, ending the effect on itself on a success. _Subsequent Failures:_ The Poisoned target's Hit Point maximum decreases by 5 (1d10).";

const LINGERING_POISON = {
  ability: 'con',
  dc: 12,
  targets: 'a creature',
  onSuccess: 'none',
  onFailure: [
    {
      kind: 'condition',
      condition: 'poisoned',
      lingers: {
        withholdsMaximum: true,
        tolls: {
          everySeconds: 86_400,
          repeatsSave: true,
          decreases: { dice: '1d10', flat: 0, average: 5 },
        },
      },
    },
  ],
};

describe('a death dog’s bite', () => {
  it('reads the rider’s save whole, with nothing handed over', () => {
    expect(parseRiderSave(DEATH_DOG_RIDER)).toEqual(LINGERING_POISON);
  });

  it('lifts it off the rider in the catalogue, leaving no prose behind', () => {
    const bite = bestiary
      .find((monster) => monster.id === 'death-dog')!
      .actions.find((line) => line.name === 'Bite')!;
    expect(bite.attack!.rider).toBeNull();
    expect(bite.attack!.riderSave).toEqual(LINGERING_POISON);
  });

  /**
   * **A rung about a toll that is not there names nothing**, and a line read
   * down to its first rung would be a Poisoned that never ends. Both refuse.
   */
  it('refuses a Subsequent Failures rung with no toll in front of it', () => {
    expect(
      parseSaveLine(
        '_Constitution Saving Throw:_ DC 12, one creature within 5 feet. ' +
          '_First Failure:_ The target has the Poisoned condition for 1 hour. ' +
          "_Subsequent Failures:_ The Poisoned target's Hit Point maximum decreases by 5 (1d10).",
      ),
    ).toBeNull();
  });

  it('refuses a toll whose rung names some other condition', () => {
    expect(
      parseRiderSave(DEATH_DOG_RIDER.replace("The Poisoned target's", "The Blinded target's")),
    ).toBeNull();
  });
});
