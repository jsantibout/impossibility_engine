/**
 * A condition whose lifetime is a **thing**.
 *
 * SRD Giant Spider's Web: "_Dexterity Saving Throw:_ DC 13, one creature the
 * spider can see within 60 feet. _Failure:_ The target has the Restrained
 * condition until the web is destroyed (AC 10; HP 5; Vulnerability to Fire
 * damage; Immunity to Poison and Psychic damage)." SRD Ettercap's Web Strand
 * prints the same sentence with Bludgeoning in the immunity run.
 *
 * Every other span the engine holds is a clock or another condition. This one
 * is an object in the room: it has an Armour Class, Hit Points and defences of
 * its own, anybody may burn it, and the Restrained ends the moment somebody
 * does — and never otherwise, because the sentence prints no repeat.
 *
 * **The engine mints the id.** A web exists because a creature spun it rather
 * than because a DM described it, so `printedObjectId` derives the name from
 * the use that made it — the noun the line prints, the spinner, the creature
 * caught and the count of the use — which is the rule `summonedId` and
 * `itemInstanceFor` already keep: no clock, no counter, no randomness.
 *
 * **And the ending is derived.** Nothing writes an event when a web burns:
 * reaching 0 Hit Points destroys a thing inside `applyDamageToVitals`, which
 * is itself derived off the damage. So `liftWhatBrokenObjectsHeld` reads the
 * condition's source — `held-by:<object>`, the third member of the family
 * `grapple:<who>` and `attach:<who>` belong to — and lifts what a broken thing
 * was holding.
 */

import { SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import { asCharacterId, type CharacterId, type Result, expect as unwrap } from '@ie/shared';
import {
  addCreature,
  addSceneLandmark,
  beginCombat,
  declareCreatureSide,
  forcePrintedSave,
  placeCreatureInScene,
  resolveAttack,
  resolveTurn,
  setScene,
} from './commands.js';
import { hasCondition } from './conditions.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';

const SPINNER = asCharacterId('spinner');
const FIGHTER = asCharacterId('bren');
const ROGUE = asCharacterId('sable');
const MAGMIN = asCharacterId('ember');

/** The heading a block prints, read off the block rather than retyped. */
const webLineOf = (block: string): string =>
  SRD_CONTENT.monsterById(block)!.actions.find((line) => line.name.startsWith('Web'))!.name;
const WEB = webLineOf('giant-spider');

class Table {
  constructor(private readonly seed: string) {}
  private readonly log: GameEvent[] = [];
  get state(): GameState {
    return fold(this.seed, this.log);
  }
  do(step: string, produce: (state: GameState) => Result<readonly GameEvent[]>): GameState {
    this.log.push(...unwrap(produce(this.state), step));
    return this.state;
  }
  did(
    step: string,
    produce: (state: GameState) => Result<{ readonly events: readonly GameEvent[] }>,
  ): GameState {
    this.log.push(...unwrap(produce(this.state), step).events);
    return this.state;
  }
  private draws = 0;
  /**
   * A fresh generator per call, salted by how many have been asked for.
   *
   * A `Rng` is stateful and a `Supply` holds one, so a table that handed out
   * the same seed every time would throw the same faces every time — which
   * reads as a rule that never fires rather than as a die that never moved.
   * The log is unaffected: every command records what its generator produced.
   */
  supply() {
    this.draws += 1;
    return {
      issuer: createRollIssuer('r'),
      rng: createRng(`${this.seed}:${this.draws}`) as Rng,
      content: SRD_CONTENT,
    };
  }
}

function lair(seed: string, spinner: string): Table {
  const table = new Table(seed);
  table.did('the spinner arrives', (s) => addCreature(s, SRD_CONTENT, SPINNER, spinner));
  table.did('the fighter arrives', (s) => addCreature(s, SRD_CONTENT, FIGHTER, 'commoner'));
  table.did('the rogue arrives', (s) => addCreature(s, SRD_CONTENT, ROGUE, 'commoner'));
  table.did('the magmin arrives', (s) => addCreature(s, SRD_CONTENT, MAGMIN, 'magmin'));
  table.do('the cave', (s) => setScene(s, { width: 100, depth: 60, height: 30 }));
  table.do('the crack', (s) => addSceneLandmark(s, 'the crack', { x: 10, y: 10, z: 0 }));
  let feet = 0;
  for (const who of [SPINNER, FIGHTER, ROGUE, MAGMIN]) {
    feet += 10;
    const at = feet;
    table.do('a creature stands', (s) =>
      placeCreatureInScene(s, who, { from: { landmark: 'the crack' }, feet: at, bearing: 90 }),
    );
    table.do('a side is declared', (s) =>
      declareCreatureSide(s, who, who === SPINNER ? 'wild' : 'party'),
    );
  }
  table.do('the order', (s) =>
    beginCombat(s, [
      { id: SPINNER, initiative: 20, speed: 30 },
      { id: FIGHTER, initiative: 15, speed: 30 },
      { id: ROGUE, initiative: 10, speed: 30 },
      { id: MAGMIN, initiative: 5, speed: 30 },
    ]),
  );
  return table;
}

const turnOf = (table: Table, who: CharacterId): void => {
  for (let guard = 0; guard < 12; guard += 1) {
    if (table.state.combat!.order[table.state.combat!.turnIndex]!.id === who) return;
    table.did('the boundary', (s) => resolveTurn(s, table.supply()));
  }
  throw new Error('never reached that turn');
};

const webs = (state: GameState): readonly CharacterId[] =>
  Object.keys(state.creatures)
    .filter((id) => id.startsWith('web:'))
    .sort()
    .map(asCharacterId);

/**
 * Throw the web until it catches, seed by seed, and hang the strands on the
 * map beside whoever is in them.
 *
 * A printed object arrives in the game unplaced, exactly as a declared one
 * does: where a web hangs is a fact about the room, and placing it is the
 * table's.
 */
function caught(
  prefix: string,
  spinner = 'giant-spider',
  target: CharacterId = FIGHTER,
  /** Who the strands end up within reach of, for the tests that cut at them. */
  beside: CharacterId = FIGHTER,
): Table {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const table = lair(`${prefix}-${attempt}`, spinner);
    turnOf(table, SPINNER);
    const thrown = forcePrintedSave(
      table.state,
      SPINNER,
      { line: webLineOf(spinner), targets: [target] },
      table.supply(),
    );
    if (!thrown.ok) continue;
    table.did('the web', () => thrown);
    if (!hasCondition(table.state.creatures[target]!.conditions, 'restrained')) continue;
    for (const web of webs(table.state)) {
      table.do('the strands hang', (s) =>
        placeCreatureInScene(s, web, { from: { creature: beside }, feet: 5, bearing: 0 }),
      );
    }
    return table;
  }
  throw new Error('the spinner never caught anybody');
}

describe('a web is a thing the line makes', () => {
  it('reads the whole stat line out of the parenthesis', () => {
    const line = SRD_CONTENT.monsterById('giant-spider')!.actions.find(
      (one) => one.name === WEB,
    )!;
    expect(line.save!.onFailure).toEqual([
      {
        kind: 'condition',
        condition: 'restrained',
        heldByObject: {
          noun: 'web',
          armorClass: 10,
          hitPoints: 5,
          vulnerabilities: ['fire'],
          immunities: ['poison', 'psychic'],
        },
      },
    ]);
    // The ettercap's is the same sentence with one more immunity — and neither
    // prints a repeat, which is what makes the object the whole lifetime.
    const strand = SRD_CONTENT.monsterById('ettercap')!.actions.find((one) =>
      one.name.startsWith('Web Strand'),
    )!;
    expect(
      (strand.save!.onFailure![0] as { readonly heldByObject: { readonly immunities: string[] } })
        .heldByObject.immunities,
    ).toEqual(['bludgeoning', 'poison', 'psychic']);
    expect(strand.save!.handedOver).toBeUndefined();
  });

  it('raises an object with the printed numbers and restrains the target', () => {
    const table = caught('web');
    const [web] = webs(table.state);
    expect(web).toBeDefined();
    const thing = table.state.creatures[web!]!;
    expect(thing.vitals.hpMax).toBe(5);
    expect(thing.sheet.stated?.armorClass).toBe(10);
    expect(thing.creatureType).toBe('Object');
    expect(thing.defenses['fire']).toEqual({ vulnerable: true });
    expect(thing.defenses['poison']).toEqual({ immune: true });
    expect(hasCondition(table.state.creatures[FIGHTER]!.conditions, 'restrained')).toBe(true);
  });

  /**
   * **The sentence prints no repeat**, and a Restrained the boundary went on
   * asking for a save against would be a rule nobody wrote: the only way out
   * of a web is through the web.
   */
  it('offers the restrained creature no repeat save, ever', () => {
    const table = caught('web-repeat');
    expect(Object.keys(table.state.pendingSaves)).toEqual([]);
    for (let round = 0; round < 6; round += 1) {
      table.did('the boundary', (s) => resolveTurn(s, table.supply()));
      expect(Object.keys(table.state.pendingSaves)).toEqual([]);
    }
    expect(hasCondition(table.state.creatures[FIGHTER]!.conditions, 'restrained')).toBe(true);
  });

  /**
   * **A creature attacks the web through the paths an object already takes.**
   * The magmin's Touch deals 7 (2d6) Fire, the line prints Vulnerability to
   * Fire, and `landDamage` doubles what lands — so the strands are always well
   * past five, and the Restrained goes with them through no event at all.
   */
  it('lifts the Restrained when somebody burns the web away', () => {
    const table = caught('web-burn', 'giant-spider', FIGHTER, MAGMIN);
    const [web] = webs(table.state);
    for (let attempt = 0; attempt < 24; attempt += 1) {
      turnOf(table, MAGMIN);
      const swing = resolveAttack(
        table.state,
        MAGMIN,
        { target: web!, weapon: null, action: 'Touch', commandId: `touch-${attempt}` },
        table.supply(),
      );
      if (!swing.ok) continue;
      table.did('the magmin touches it', () => swing);
      if (table.state.creatures[web!]!.vitals.dead) break;
    }

    expect(table.state.creatures[web!]!.vitals.dead).toBe(true);
    expect(hasCondition(table.state.creatures[FIGHTER]!.conditions, 'restrained')).toBe(false);
  });

  /**
   * **And the immunity run reaches the blow.** SRD Ettercap's Web Strand
   * prints Immunity to Bludgeoning where the spider's does not, so a
   * commoner's club takes something off one web and nothing at all off the
   * other.
   */
  it('meets a blow with the defences its own line printed', () => {
    const dealt = (spinner: string): number => {
      const table = caught(`club-${spinner}`, spinner, FIGHTER, ROGUE);
      const [web] = webs(table.state);
      turnOf(table, ROGUE);
      let refused = '';
      for (let attempt = 0; attempt < 24; attempt += 1) {
        const swing = resolveAttack(
          table.state,
          ROGUE,
          { target: web!, weapon: null, action: 'Club', commandId: `club-${attempt}` },
          table.supply(),
        );
        if (swing.ok) {
          const landed = swing.value.attack?.hit === true;
          table.did('the club', () => swing);
          if (landed) return swing.value.damage ?? 0;
        } else {
          refused = JSON.stringify(swing);
        }
        // Round the order and back, so the next try is a fresh Attack action.
        table.did('the boundary', (s) => resolveTurn(s, table.supply()));
        turnOf(table, ROGUE);
      }
      throw new Error(`the club never landed: ${refused}`);
    };

    expect(dealt('giant-spider')).toBeGreaterThan(0);
    expect(dealt('ettercap')).toBe(0);
  });

  /**
   * **A second use is a second thing**, which is the whole of what deriving
   * the id from the use buys: two webs in the room, each with its own five hit
   * points and its own creature held in it.
   */
  it('makes a second web with a different id', () => {
    const table = caught('web-two');
    const first = webs(table.state);
    expect(first).toHaveLength(1);

    // Round by round, because the line is a Recharge: the spider gets it back
    // on a 5 or a 6 at the start of one of its turns and not before.
    for (let attempt = 0; attempt < 30; attempt += 1) {
      table.did('the boundary', (s) => resolveTurn(s, table.supply()));
      turnOf(table, SPINNER);
      const thrown = forcePrintedSave(
        table.state,
        SPINNER,
        { line: WEB, targets: [ROGUE], commandId: `again-${attempt}` },
        table.supply(),
      );
      if (!thrown.ok) continue;
      table.did('the second web', () => thrown);
      if (hasCondition(table.state.creatures[ROGUE]!.conditions, 'restrained')) break;
    }

    const both = webs(table.state);
    expect(both.length).toBe(2);
    expect(new Set(both).size).toBe(2);
    expect(hasCondition(table.state.creatures[ROGUE]!.conditions, 'restrained')).toBe(true);
    // And each holds its own creature: the fighter's web is not the rogue's.
    expect(first[0]).not.toBe(both[1]);
  });
});
