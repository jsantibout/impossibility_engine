import { writeFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import { parsePrintedSave } from './printed-save.js';

const lines: Record<string, string> = {
  cockatrice:
    '_Constitution Saving Throw:_ DC 11, a creature. _First Failure:_ The target has the Restrained condition. The target repeats the save at the end of its next turn if it is still Restrained, ending the effect on itself on a success. _Second Failure:_ The target has the Petrified condition, instead of the Restrained condition, for 24 hours.',
  homunculus:
    "_Constitution Saving Throw:_ DC 12, the target. _Failure:_ The target has the Poisoned condition until the end of the homunculus's next turn. _Failure by 5 or More:_ The target has the Poisoned condition for 1 minute. While Poisoned, the target has the Unconscious condition, which ends early if the target takes any damage.",
  beardedDevil:
    "_Constitution Saving Throw:_ DC 12, a creature. _Failure:_ The target receives an infernal wound. While wounded, the target loses 5 (1d10) Hit Points at the start of each of its turns. The wound closes after 1 minute, after a spell restores Hit Points to the target, or after the target or a creature within 5 feet of it takes an action to stanch the wound, doing so by succeeding on a DC 12 Wisdom (Medicine) check.",
  deathDog:
    "_Constitution Saving Throw:_ DC 12, a creature. _First Failure:_ The target has the Poisoned condition. While Poisoned, the target's Hit Point maximum doesn't return to normal when finishing a Long Rest, and it repeats the save every 24 hours that elapse, ending the effect on itself on a success. _Subsequent Failures:_ The Poisoned target's Hit Point maximum decreases by 5 (1d10).",
  web: '_Dexterity Saving Throw:_ DC 13, one creature the spider can see within 60 feet. _Failure:_ The target has the Restrained condition until the web is destroyed (AC 10; HP 5; Vulnerability to Fire damage; Immunity to Poison and Psychic damage).',
};

describe('scratch', () => {
  it('reads', () => {
    const out: string[] = [];
    for (const [k, v] of Object.entries(lines)) {
      out.push(`===== ${k}\n${JSON.stringify(parsePrintedSave(v), null, 1)}`);
    }
    writeFileSync('zz-save.out.txt', out.join('\n'));
  });
});
