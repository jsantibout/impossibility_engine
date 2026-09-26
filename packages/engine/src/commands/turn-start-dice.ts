/**
 * **A die a stat block's trait throws at the start of its holder's turn** —
 * W7-B13.
 *
 * SRD Flesh Golem's Berserk: "Whenever the golem starts its turn Bloodied,
 * roll 1d6. On a 6, the golem goes berserk. On each of its turns while
 * berserk, the golem attacks the nearest creature it can see …"
 *
 * **The die is the engine's and the berserk golem is the table's.** A d6 at a
 * turn boundary, gated on a fact the engine holds, is thrown exactly as a
 * recharge's is — out of the generator, recorded, the generator's position
 * written back — and the face is reported with the sentences the trait files
 * under it. What those sentences describe is a creature played by a rule: the
 * owner ruled a compulsion the table's (2026-09-24), so what the golem attacks,
 * and whether its creator has calmed it since, is for the table to read
 * against the face.
 *
 * **Thrown at every such start**, which is the book's word — "whenever" — and
 * the reason nothing here remembers that the golem went berserk last turn: its
 * creator may have calmed it since, which is the table's to know, and the book
 * has it roll again either way ("at which point it resumes rolling for the
 * Berserk trait again if it is still Bloodied").
 *
 * **Its own module**, so the one hunk the boundary grew is a call rather than a
 * body — `commands/turns.ts` is shared by more tracks than one.
 */

import { type CharacterId, err, ok, type Result } from '@ie/shared';
import type { MonsterTrait } from '@ie/srd';
import type { GameEvent, GameState } from '../events.js';
import { rollRecorded } from '../rolls.js';
import { isBloodied } from '../standing.js';
import type { Supply } from './casting.js';
import { filedFor, reportFiled } from './filed-handovers.js';

type TurnStartDie = Extract<MonsterTrait, { readonly kind: 'rolls-to-go-berserk' }>;

/** What a turn start's trait dice came to: the throws, and what they hand the table. */
export interface TurnStartDice {
  readonly events: readonly GameEvent[];
  readonly unverified: readonly string[];
}

const NOTHING: TurnStartDice = { events: [], unverified: [] };

/**
 * Throw every die the beginning creature's traits print for a Bloodied start.
 *
 * Nothing at all for a creature with no such trait, one that is not Bloodied,
 * or one that is dead — a die thrown for a sentence that cannot arrive moves
 * the generator for nothing. Without a generator a throw that is owed is
 * refused, on `settleStartOfTurnRecharges`' rule.
 */
export function settleStartOfTurnTraitDice(
  state: GameState,
  supply: Supply | undefined,
  begun: CharacterId | undefined,
): Result<TurnStartDice> {
  if (begun === undefined) return ok(NOTHING);
  const creature = state.creatures[begun];
  if (creature === undefined || creature.vitals.dead) return ok(NOTHING);
  const dice = (creature.sheet.stated?.traits ?? []).filter(
    (trait): trait is TurnStartDie => trait.kind === 'rolls-to-go-berserk',
  );
  if (dice.length === 0 || !dice.some((trait) => trait.whileBloodied) || !isBloodied(creature)) {
    return ok(NOTHING);
  }
  if (supply === undefined) {
    return err(
      'trait_die_owed',
      `${begun} starts its turn Bloodied owing ${dice.length} die from its own traits; advancing needs a generator to throw them`,
    );
  }

  const events: GameEvent[] = [];
  const unverified: string[] = [];
  for (const trait of dice) {
    const issuedBefore = supply.issuer.count;
    const rolled = rollRecorded(supply.issuer, supply.rng, trait.dice);
    if (!rolled.ok) return rolled;
    const face = rolled.value.total;
    events.push(
      {
        type: 'roll-recorded',
        who: begun,
        label: `${begun} starts its turn Bloodied (${trait.dice}; ${trait.on} or more)`,
        natural: face,
        total: face,
        contributions: [],
        outcome: face >= trait.on ? 'reached' : 'not reached',
      },
      {
        type: 'rolls-issued',
        count: supply.issuer.count - issuedBefore,
        rng: supply.rng.snapshot(),
      },
    );
    unverified.push(
      ...reportFiled(
        `${begun} starts its turn Bloodied and the ${trait.dice} shows ${face}`,
        filedFor(trait.forTheTable, 'use', face),
      ),
    );
  }
  return ok({ events, unverified });
}
