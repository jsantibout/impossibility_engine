/**
 * **Regeneration, and a death that waits** — W7-B12.
 *
 * SRD Troll, Regeneration: "The troll regains 15 Hit Points at the start of
 * each of its turns. If the troll takes Acid or Fire damage, this trait doesn't
 * function on the troll's next turn. The troll dies only if it starts its turn
 * with 0 Hit Points and doesn't regenerate." SRD Troll Limb prints the same
 * with 5.
 *
 * Three rules and three readers: the turn's start heals, the damage pipeline
 * hangs a marker "until the end of its next turn" where the type is one the
 * sentence names, and the drop to 0 is held at 0 rather than killing — the
 * death comes at the start of the turn, and only if the marker stands.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, type CharacterId, expect as unwrap } from '@ie/shared';
import { addCreature, beginCombat, declareCreatureSide, resolveTurn } from './commands.js';
import { dealSpellDamage } from './commands/damage.js';
import { hasCondition } from './conditions.js';
import { createRng, type Rng } from './dice.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { createRollIssuer } from './rolls.js';

const id = (s: string) => asCharacterId(s);
const SEED = 'regeneration';
const TROLL = id('troll');
const GOBLIN = id('goblin');

const supply = (seed = SEED) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

/** A goblin and a troll in a fight, the goblin's turn running. */
function fight(block = 'troll', withCombat = true): GameEvent[] {
  const log: GameEvent[] = [];
  const state = (): GameState => fold(SEED, log);
  log.push(...unwrap(addCreature(state(), SRD_CONTENT, TROLL, block), block).events);
  log.push(...unwrap(addCreature(state(), SRD_CONTENT, GOBLIN, 'goblin-warrior'), 'goblin').events);
  log.push(...unwrap(declareCreatureSide(state(), TROLL, 'monsters'), 'a side'));
  log.push(...unwrap(declareCreatureSide(state(), GOBLIN, 'party'), 'the other'));
  if (withCombat) {
    log.push({
      type: 'combat-started',
      combatants: [
        { id: GOBLIN, initiative: 20, speed: 30 },
        { id: TROLL, initiative: 10, speed: 30 },
      ],
    });
  }
  return log;
}

const at = (log: readonly GameEvent[]): GameState => fold(SEED, log);
const hp = (log: readonly GameEvent[], who: CharacterId = TROLL): number =>
  at(log).creatures[who]!.vitals.hp;

/** A blow of one type from the goblin, landed through the funnel every spell uses. */
function hit(log: GameEvent[], type: string, amount: number): void {
  const struck = unwrap(
    dealSpellDamage(
      at(log),
      TROLL,
      [{ source: 'a blow', type, roll: null, flat: amount, total: amount }],
      'a blow',
      supply(),
      { by: GOBLIN },
    ),
    'the blow',
  );
  log.push(...struck.events);
}

/** Advance the order once, and keep what it wrote. */
function advance(log: GameEvent[]): readonly string[] {
  const turned = unwrap(resolveTurn(at(log), supply()), 'the turn');
  log.push(...turned.events);
  return turned.unverified;
}

describe('SRD Regeneration: the Hit Points a turn’s start brings back', () => {
  it('heals a troll at 10 Hit Points by 15 when its turn begins', () => {
    const log = fight();
    const max = at(log).creatures[TROLL]!.vitals.hpMax;
    log.push({ type: 'damage-taken', id: TROLL, amount: max - 10 });
    expect(hp(log)).toBe(10);
    advance(log);
    expect(hp(log)).toBe(25);
  });

  it('heals the limb by the 5 its own sentence prints', () => {
    const log = fight('troll-limb');
    log.push({ type: 'damage-taken', id: TROLL, amount: 10 });
    const before = hp(log);
    advance(log);
    expect(hp(log)).toBe(before + 5);
  });

  it('heals nobody on a turn that is not the troll’s', () => {
    const log = fight();
    log.push({ type: 'damage-taken', id: TROLL, amount: 50 });
    advance(log); // the troll's turn begins, and it heals
    const healed = hp(log);
    advance(log); // the goblin's begins, and the troll does not
    expect(hp(log)).toBe(healed);
  });

  it('heals a troll whose turn is the one a fight opens on', () => {
    const log = fight('troll', false);
    log.push({ type: 'damage-taken', id: TROLL, amount: 50 });
    const before = hp(log);
    log.push(
      ...unwrap(
        beginCombat(
          at(log),
          [
            { id: TROLL, initiative: 20, speed: 30 },
            { id: GOBLIN, initiative: 10, speed: 30 },
          ],
          {},
          supply(),
        ),
        'the fight',
      ),
    );
    expect(hp(log)).toBe(before + 15);
  });

  it('writes nothing for a troll already at its maximum', () => {
    const log = fight();
    const turned = unwrap(resolveTurn(at(log), supply()), 'the turn');
    expect(turned.events.some((event) => event.type === 'healed' && event.id === TROLL)).toBe(false);
  });
});

describe('SRD Regeneration: acid or fire switches it off for the next turn', () => {
  it('regains nothing on the turn after fire, and regains again the turn after that', () => {
    const log = fight();
    log.push({ type: 'damage-taken', id: TROLL, amount: 50 });
    hit(log, 'fire', 10);
    const burnt = hp(log);
    advance(log); // the troll's turn begins: nothing
    expect(hp(log)).toBe(burnt);
    advance(log); // the goblin's
    advance(log); // the troll's again: 15
    expect(hp(log)).toBe(burnt + 15);
  });

  it('is switched off by acid as well, and not by a type its sentence does not name', () => {
    const acid = fight();
    acid.push({ type: 'damage-taken', id: TROLL, amount: 50 });
    hit(acid, 'acid', 10);
    const eaten = hp(acid);
    advance(acid);
    expect(hp(acid)).toBe(eaten);

    const cold = fight();
    cold.push({ type: 'damage-taken', id: TROLL, amount: 50 });
    hit(cold, 'cold', 10);
    const frozen = hp(cold);
    advance(cold);
    expect(hp(cold)).toBe(frozen + 15);
  });

  it('says what it could not hang outside a fight, where there is no next turn', () => {
    const log = fight('troll', false);
    const struck = unwrap(
      dealSpellDamage(
        at(log),
        TROLL,
        [{ source: 'a torch', type: 'fire', roll: null, flat: 5, total: 5 }],
        'a torch',
        supply(),
        { by: GOBLIN },
      ),
      'the torch',
    );
    expect(struck.unverified.some((note) => note.includes('next turn'))).toBe(true);
  });
});

describe('SRD Regeneration: the troll dies only at the start of its turn', () => {
  it('lies at 0 Hit Points, Unconscious and alive, where a monster would have died', () => {
    const log = fight();
    hit(log, 'slashing', 500);
    const troll = at(log).creatures[TROLL]!;
    expect(troll.vitals.hp).toBe(0);
    expect(troll.vitals.dead).toBe(false);
    expect(hasCondition(troll.conditions, 'unconscious')).toBe(true);
  });

  it('stands again with the 15 it regains when its turn begins', () => {
    const log = fight();
    hit(log, 'slashing', 500);
    advance(log);
    const troll = at(log).creatures[TROLL]!;
    expect(troll.vitals.hp).toBe(15);
    expect(troll.vitals.dead).toBe(false);
    expect(hasCondition(troll.conditions, 'unconscious')).toBe(false);
  });

  it('dies when its turn begins at 0 with the fire’s marker standing', () => {
    const log = fight();
    hit(log, 'fire', 500);
    expect(at(log).creatures[TROLL]!.vitals.dead).toBe(false);
    advance(log);
    const troll = at(log).creatures[TROLL]!;
    expect(troll.vitals.dead).toBe(true);
    expect(hasCondition(troll.conditions, 'unconscious')).toBe(false);
  });

  it('is not killed by more blows while it lies at 0, and throws no Death Saving Throw', () => {
    const log = fight();
    hit(log, 'slashing', 500);
    hit(log, 'slashing', 500);
    hit(log, 'bludgeoning', 20);
    const troll = at(log).creatures[TROLL]!;
    expect(troll.vitals.dead).toBe(false);
    expect(troll.vitals.deathSaveFailures).toBe(0);
    const turned = unwrap(resolveTurn(at(log), supply()), 'the turn');
    expect(turned.events.some((event) => event.type === 'death-save-recorded')).toBe(false);
  });

  it('dies at the next start when the torch reaches a troll already at 0', () => {
    const log = fight();
    hit(log, 'slashing', 500);
    hit(log, 'fire', 3);
    advance(log);
    expect(at(log).creatures[TROLL]!.vitals.dead).toBe(true);
  });

  it('leaves every monster without the trait dying at 0 as it always has', () => {
    const log = fight('ogre');
    hit(log, 'slashing', 500);
    expect(at(log).creatures[TROLL]!.vitals.dead).toBe(true);
  });
});
