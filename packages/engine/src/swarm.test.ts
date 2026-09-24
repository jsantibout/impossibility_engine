/**
 * SRD Swarm, and the first printed trait the engine reads in **part**.
 *
 * "The swarm can occupy another creature's space and vice versa, and the swarm
 * can move through any opening large enough for a Tiny rat. The swarm can't
 * regain Hit Points or gain Temporary Hit Points."
 *
 * Three sentences under one heading, and until a trait could carry a residue
 * there were only two answers to it: claim all three, which would have been
 * the engine promising a lattice it has not got, or refuse the heading whole,
 * which left seven stat blocks healable by a Cure Wounds the book forbids.
 * `MonsterTrait.handedOver` is the third answer, and it is `MonsterSave`'s own
 * on the other half of the sheet.
 *
 * **Two doors, because hit points come back through two.** `healCreature` is
 * the one door healing passes and `grantTemporaryHpTo` the one Temporary Hit
 * Points do, so the sentence's two halves are asked at the two places they
 * bite. Neither is a `GrantedHealingRule`: that record is ended by its source,
 * and a swarm's anatomy is ended by nothing.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, type Result } from '@ie/shared';
import { addCreature, grantTemporaryHpTo, healCreature, resolveDamage } from './commands.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';

const SWARM = asCharacterId('rats');
const WOLF = asCharacterId('wolf');
const SEED = 'swarm';

const supply = () => ({
  issuer: createRollIssuer('r'),
  rng: createRng(SEED) as Rng,
  content: SRD_CONTENT,
});

class Table {
  private readonly log: GameEvent[] = [];
  get state(): GameState {
    return fold(SEED, this.log);
  }
  do(step: string, produce: (state: GameState) => Result<readonly GameEvent[]>) {
    this.log.push(...unwrap(produce(this.state), step));
    return this.state;
  }
  did(
    step: string,
    produce: (state: GameState) => Result<{ readonly events: readonly GameEvent[] }>,
  ) {
    this.log.push(...unwrap(produce(this.state), step).events);
    return this.state;
  }
}

const hurt = (table: Table, who: typeof SWARM, amount: number): void => {
  table.did(`${who} is hurt`, (s) =>
    resolveDamage(s, who, { amount, source: 'a blade', types: ['slashing'] }, supply()),
  );
};

describe('a swarm regains nothing', () => {
  it('is refused healing at the one door healing comes through', () => {
    const table = new Table();
    table.did('the rats arrive', (s) => addCreature(s, SRD_CONTENT, SWARM, 'swarm-of-rats'));
    hurt(table, SWARM, 6);
    const wounded = table.state.creatures[SWARM]!.vitals.hp;
    expect(wounded).toBeLessThan(table.state.creatures[SWARM]!.vitals.hpMax);

    table.do('a Cure Wounds', (s) => healCreature(s, SWARM, 8));
    expect(table.state.creatures[SWARM]!.vitals.hp).toBe(wounded);
    // Nothing was refused: the healing was legal and restored nothing, which
    // is a log with no `healed` event in it.
    expect(unwrap(healCreature(table.state, SWARM, 8), 'a second try')).toEqual([]);
  });

  it('is refused Temporary Hit Points at the door those come through', () => {
    const table = new Table();
    table.did('the rats arrive', (s) => addCreature(s, SRD_CONTENT, SWARM, 'swarm-of-rats'));
    table.do('a False Life', (s) => grantTemporaryHpTo(s, SWARM, 9));
    expect(table.state.creatures[SWARM]!.vitals.temporaryHp).toBe(0);
  });

  it('leaves every other creature healable, which is the rule the trait is not', () => {
    const table = new Table();
    table.did('a wolf arrives', (s) => addCreature(s, SRD_CONTENT, WOLF, 'wolf'));
    hurt(table, WOLF, 4);
    const wounded = table.state.creatures[WOLF]!.vitals.hp;
    table.do('a Cure Wounds', (s) => healCreature(s, WOLF, 3));
    expect(table.state.creatures[WOLF]!.vitals.hp).toBe(wounded + 3);
    table.do('a False Life', (s) => grantTemporaryHpTo(s, WOLF, 5));
    expect(table.state.creatures[WOLF]!.vitals.temporaryHp).toBe(5);
  });

  /**
   * **The two the engine did not read, said out loud at the moment the block
   * arrives.** A trait is not spent, so there is no later moment to report a
   * residue at — which is the one thing that makes this different from the
   * residue a hit's rider reports on the hit.
   */
  it('reports the two space clauses handed over, in the book’s own words', () => {
    const arrival = unwrap(
      addCreature(fold(SEED, []), SRD_CONTENT, SWARM, 'swarm-of-rats'),
      'the rats arrive',
    );
    expect(arrival.unverified).toEqual([
      `${SWARM}: Swarm reads "The swarm can occupy another creature's space and vice versa." — the engine does not apply that; a DM does`,
      `${SWARM}: Swarm reads "the swarm can move through any opening large enough for a Tiny rat." — the engine does not apply that; a DM does`,
    ]);
  });

  it('says it of all seven swarms and of nothing else', () => {
    const swarms = SRD_CONTENT.monsters.filter((block) =>
      block.traits.some((trait) => trait.trait?.kind === 'regains-no-hit-points'),
    );
    expect(swarms).toHaveLength(7);
    for (const block of swarms) {
      const arrival = unwrap(
        addCreature(fold(SEED, []), SRD_CONTENT, SWARM, block.id),
        `${block.id} arrives`,
      );
      expect(arrival.unverified.filter((line) => line.includes('Swarm reads'))).toHaveLength(2);
    }
  });
});
