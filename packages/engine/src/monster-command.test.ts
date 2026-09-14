import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  asCharacterId,
  type CharacterId,
  isErr,
  ok,
  expect as unwrap,
  type Result,
} from '@ie/shared';
import { parseMonsters, type Monster } from '@ie/srd';
import {
  addCreature,
  addSceneLandmark,
  applyConditionTo,
  beginCombat,
  declareResourcePool,
  declareSpellcasting,
  placeCreatureInScene,
  resolveAttack,
  resolveSpell,
  rollInitiativeFor,
  setScene,
} from './commands.js';
import { expandConditions, hasCondition } from './conditions.js';
import { createRng, type Rng } from './dice.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { conditionApplicability } from './monster.js';
import { remaining, spellSlotKey } from './resources.js';
import { createRollIssuer } from './rolls.js';
import { declaredCasting } from './spellcasting.js';
import { conditionImmunitiesOf } from './standing.js';
import { adaptMonster } from './monster.js';
import { createCharacter, type CharacterChoices } from './creation.js';

/**
 * A monster entering the game, and the immunities its stat block prints.
 *
 * Two halves of one correctness gap, and the second is the kind this
 * repository calls its worst: a shipped wrong number with no symptom.
 * `adaptMonster` has produced `defenses.conditionImmunities` and
 * `conditionApplicability` has answered three ways since the adapter landed,
 * and **nothing outside `monster.ts` called either** — every caller was a
 * test. So a Zombie was Poisoned by Ray of Sickness like anybody, and the only
 * way to put a monster into a game at all was to fold a `creature-added` by
 * hand, which is narration writing straight to truth.
 *
 * This is the fourteenth recorded instance of the repository's most persistent
 * finding — a rule implemented and reachable from nothing.
 */

const id = (s: string) => asCharacterId(s);
const BREN = id('bren');
const ZOMBIE = id('zombie');
const FAMILIAR = id('familiar');

const bestiary = parseMonsters(
  readFileSync(fileURLToPath(new URL('../../srd/raw/monsters-A-Z.md', import.meta.url)), 'utf8'),
  'monsters-A-Z.md',
).items;

const statBlock = (slug: string): Monster => {
  const found = bestiary.find((m) => m.id === slug);
  if (found === undefined) throw new Error(`no such monster: ${slug}`);
  return found;
};

const supply = (seed = 'monster') => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
});

/** A level 1 Fighter, so that every creature in this file arrives by command. */
const walkOn = (name: string): CharacterChoices => ({
  name,
  classId: 'fighter',
  level: 1,
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
  },
  abilityIncreases: { con: 2, wis: 1 },
  classSkills: ['athletics', 'survival'],
  languages: ['Dwarvish', 'Orc'],
  alignment: 'Neutral',
  cantrips: [],
  spellbook: [],
  preparedSpells: [],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: ['chain-mail'],
  hitPoints: { method: 'fixed' },
  featureChoices: { 'human:skillful': ['perception'], 'fighter:weapon-mastery': [] },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int',
      cantrips: ['mage-hand', 'light'],
      levelOneSpell: 'ray-of-sickness',
    },
    'human:versatile': { featId: 'alert' },
    'fighter:fighting-style': { featId: 'archery' },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
});

/**
 * A log built only from things the engine produced.
 *
 * The same `Table` `scene-commands.test.ts` uses, and for its reason: nothing
 * here writes an event literal, and the scenario at the bottom checks that
 * against this source rather than asserting it.
 */
class Table {
  private readonly log: GameEvent[] = [];

  get state(): GameState {
    return fold('monster', this.log);
  }

  get events(): readonly GameEvent[] {
    return this.log;
  }

  do(step: string, produce: (state: GameState) => Result<readonly GameEvent[]>): GameState {
    this.log.push(...unwrap(produce(this.state), step));
    return this.state;
  }

  did(step: string, produce: (state: GameState) => Result<{ readonly events: readonly GameEvent[] }>): GameState {
    this.log.push(...unwrap(produce(this.state), step).events);
    return this.state;
  }
}

const withZombie = (): Table => {
  const table = new Table();
  table.do('the fighter arrives', () => createCharacter(walkOn('Bren'), BREN));
  table.did('the zombie shambles in', (s) => addCreature(s, ZOMBIE, statBlock('zombie')));
  return table;
};

/**
 * The same, with a fight running and the caster first in the order.
 *
 * Ray of Sickness's Poisoned lasts "until the end of your next turn", which is
 * a turn-anchored duration — and `resolveDuration` refuses one outside combat,
 * because there are no turns to anchor it to. The Initiative numbers are
 * *given* rather than rolled so the caster reliably has the turn; rolling for
 * them is the acceptance scenario's job below, where it is the point.
 */
const fightingA = (who: CharacterId, slug: string): Table => {
  const table = new Table();
  table.do('the fighter arrives', () => createCharacter(walkOn('Bren'), BREN));
  table.did('the monster arrives', (s) => addCreature(s, who, statBlock(slug)));
  table.do('the crypt', (s) => setScene(s, { width: 60, depth: 40, height: 20 }));
  table.do('the slab', (s) => addSceneLandmark(s, 'the slab', { x: 20, y: 20, z: 0 }));
  table.do('Bren by the slab', (s) =>
    placeCreatureInScene(s, BREN, { from: { landmark: 'the slab' }, feet: 0 }),
  );
  table.do('the monster beside him', (s) =>
    placeCreatureInScene(s, who, { from: { creature: BREN }, feet: 10, bearing: 90 }),
  );
  table.do('the order', (s) =>
    beginCombat(s, [
      { id: BREN, initiative: 20, speed: 30 },
      { id: who, initiative: 1, speed: 20 },
    ]),
  );
  return table;
};

describe('a monster enters through a command', () => {
  it('carries the whole adapted stat block into state', () => {
    const zombie = withZombie().state.creatures[ZOMBIE]!;
    const adapted = adaptMonster(statBlock('zombie'), ZOMBIE);

    // The printed numbers, not derived ones.
    expect(zombie.sheet.stated?.armorClass).toBe(8);
    expect(zombie.creatureType).toBe('Undead');
    expect(zombie.vitals.hpMax).toBe(adapted.vitals.hpMax);
    // SRD: "A monster dies the instant it drops to 0 Hit Points." Compared
    // against the adapter rather than against `true`, because the adapter is
    // where that sentence is decided — a literal here would be a second
    // answer, and the two could disagree in silence.
    expect(zombie.vitals.diesAtZero).toBe(adapted.vitals.diesAtZero);
    expect(adapted.vitals.diesAtZero).toBe(true);
    expect(zombie.defenses).toEqual({ poison: { immune: true } });
    expect(zombie.conditionImmunities).toEqual(['exhaustion', 'poisoned']);
  });

  /**
   * Exactly what the reducer would call corrupt, and nothing more: the
   * `creature-added` case throws "is already in this game" for a second one.
   */
  it('refuses a creature already in the game', () => {
    const table = withZombie();
    const again = addCreature(table.state, ZOMBIE, statBlock('zombie'));
    expect(isErr(again) ? again.code : 'ok').toBe('already_present');
  });

  it('is a no-op under a command id it has already been sent with', () => {
    const table = withZombie();
    const first = unwrap(
      addCreature(table.state, id('second'), statBlock('zombie'), { commandId: 'c1' }),
      'first',
    );
    expect(first.events.length).toBeGreaterThan(0);
    expect(first.duplicate).toBe(false);

    const after = fold('monster', [...table.events, ...first.events]);
    const retry = unwrap(
      addCreature(after, id('second'), statBlock('zombie'), { commandId: 'c1' }),
      'retry',
    );
    expect(retry.events).toEqual([]);
    expect(retry.duplicate).toBe(true);
  });

  /**
   * And the duplicate check comes first, which is the trap this repository has
   * sprung eight times: the command's **own** first run is what makes the
   * world answer `already_present`, so a guard above the identity would tell a
   * retry its command was impossible when it had in fact landed.
   */
  it('tells a retry its command landed rather than telling it the creature is there', () => {
    const table = withZombie();
    const sent = unwrap(
      addCreature(table.state, id('third'), statBlock('zombie'), { commandId: 'c2' }),
      'sent',
    );
    const after = fold('monster', [...table.events, ...sent.events]);
    const retry = addCreature(after, id('third'), statBlock('zombie'), { commandId: 'c2' });
    expect(isErr(retry) ? retry.code : 'ok').toBe('ok');
  });
});

describe('a printed condition immunity is honoured', () => {
  it('gathers the creature’s own printed immunities', () => {
    expect(conditionImmunitiesOf(withZombie().state, ZOMBIE)).toEqual(['exhaustion', 'poisoned']);
    // A character has none, and that is a normal state rather than a gap.
    expect(conditionImmunitiesOf(withZombie().state, BREN)).toEqual([]);
  });

  /**
   * The DM-facing command refuses, so the refusal can be narrated: the spell
   * lands and does nothing. No caller supplies the list any more — the
   * creature's own record is where it comes from.
   */
  it('refuses a condition the stat block is immune to', () => {
    const out = applyConditionTo(withZombie().state, ZOMBIE, 'poisoned', 'a bad mushroom');
    expect(isErr(out) ? out.code : 'ok').toBe('immune');
  });

  it('allows one it is not immune to', () => {
    const out = applyConditionTo(withZombie().state, ZOMBIE, 'restrained', 'a net');
    expect(isErr(out) ? out.code : 'ok').toBe('ok');
  });

  /**
   * **The acceptance criterion, through the public resolution path.**
   *
   * SRD Ray of Sickness imposes the Poisoned condition on a hit. A Zombie
   * prints "Immunities Poison; Exhaustion, Poisoned" — one damage type and two
   * conditions — and before this the condition half reached nothing at all.
   *
   * The casting is **not** refused: SRD leaves an immune creature simply
   * unaffected by that clause, and a whole spell that failed because one
   * target could not be Poisoned would be a rules bug in the other direction.
   */
  it('a Zombie cannot be Poisoned by Ray of Sickness, and the casting still resolves', () => {
    const table = fightingA(ZOMBIE, 'zombie');
    const cast = unwrap(
      resolveSpell(
        table.state,
        BREN,
        { spellId: 'ray-of-sickness', targets: [ZOMBIE], payment: 'free-casting' },
        supply('ray'),
      ),
      'ray of sickness',
    );

    const after = fold('monster', [...table.events, ...cast.events]);
    // **The attack landed**, and that is asserted rather than assumed: Ray of
    // Sickness imposes its condition on a hit, so on a miss `applyRiders` is
    // never reached and every assertion below would pass for the wrong
    // reason — the vacuity the positive test beside this one loops seeds to
    // avoid.
    expect(cast.outcomes[0]?.attack?.hit).toBe(true);
    expect(hasCondition(after.creatures[ZOMBIE]!.conditions, 'poisoned')).toBe(false);
    // The spell happened: it was aimed, it rolled, and it reported an outcome.
    expect(cast.outcomes.map((o) => o.target)).toEqual([ZOMBIE]);
    // Absent rather than empty, which is what `SpellTargetOutcome.conditions`
    // means when nothing landed.
    expect(cast.outcomes[0]?.conditions).toBeUndefined();
  });

  /**
   * And the same spell at somebody with no such immunity does impose it, or
   * the assertion above would pass for a spell that never poisons anybody.
   */
  it('and the same spell poisons a creature whose stat block does not print it', () => {
    const table = fightingA(FAMILIAR, 'vampire-familiar');

    // A seed that hits: the assertion is about the rider, so the attack has to
    // land for it to mean anything, and a miss would pass vacuously.
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
      const cast = unwrap(
        resolveSpell(
          table.state,
          BREN,
          { spellId: 'ray-of-sickness', targets: [FAMILIAR], payment: 'free-casting' },
          supply(seed),
        ),
        'ray of sickness',
      );
      if (cast.outcomes[0]?.attack?.hit !== true) continue;
      const after = fold('monster', [...table.events, ...cast.events]);
      expect(hasCondition(after.creatures[FAMILIAR]!.conditions, 'poisoned')).toBe(true);
      expect(cast.outcomes[0]?.conditions).toEqual(['poisoned']);
      return;
    }
    throw new Error('no seed landed the attack');
  });
});

/**
 * The other condition site, through the same shared function.
 *
 * `imposeCondition` is reached from an outcome's riders and from the
 * standalone `condition` kind, so its immune branch has to be driven from
 * both or the two are one function spelled alike. **No SRD stat block prints
 * an immunity to Invisible** — the only condition a `condition` effect
 * imposes — so the immunity here comes from a hand-written log rather than
 * from `addCreature`, which is what a fixture reaching a guard looks like when
 * the bestiary cannot construct the case. The *field* means "conditions this
 * creature cannot be given", and a log saying so is exactly what the fold
 * reads.
 */
describe('the standalone condition kind reads the same answer', () => {
  const GHOST = id('ghost');

  /** A caster who can cast Greater Invisibility, immune to it or not. */
  const ghost = (immune: boolean): Table => {
    const table = new Table();
    table.do('the caster', () =>
      ok([
        {
          type: 'creature-added',
          id: GHOST,
          name: 'ghost',
          sheet: {
            level: 5,
            abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 16, cha: 10 },
            skills: {},
            saveProficiencies: [],
            armor: null,
            shield: null,
            armorTraining: { light: true, medium: true, heavy: true, shields: true },
            baseSpeed: 30,
            spellcastingAbility: 'wis',
          },
          maxHp: 40,
          ...(immune ? { conditionImmunities: ['invisible' as const] } : {}),
        },
      ]),
    );
    table.do('what it casts', (s) =>
      declareSpellcasting(
        s,
        GHOST,
        declaredCasting({ ability: 'wis', prepared: ['greater-invisibility'] }),
      ),
    );
    table.do('a level 4 slot', (s) =>
      declareResourcePool(s, GHOST, {
        key: spellSlotKey(4),
        label: 'Level 4 slots',
        max: 1,
        recovers: 'long-rest',
      }),
    );
    // Touch is a distance, so the room and the standing are the caster's own.
    table.do('the crypt', (s) => setScene(s, { width: 60, depth: 40, height: 20 }));
    table.do('the slab', (s) => addSceneLandmark(s, 'the slab', { x: 20, y: 20, z: 0 }));
    table.do('standing on it', (s) =>
      placeCreatureInScene(s, GHOST, { from: { landmark: 'the slab' }, feet: 0 }),
    );
    return table;
  };

  const castOnSelf = (table: Table) =>
    unwrap(
      resolveSpell(
        table.state,
        GHOST,
        { spellId: 'greater-invisibility', targets: [GHOST], slotLevel: 4 },
        supply('unseen'),
      ),
      'greater invisibility',
    );

  it('leaves the caster unaffected and still resolves the casting', () => {
    const table = ghost(true);
    const cast = castOnSelf(table);

    const after = fold('monster', [...table.events, ...cast.events]);
    expect(hasCondition(after.creatures[GHOST]!.conditions, 'invisible')).toBe(false);
    // A real outcome rather than an error, and `conditions` absent rather than
    // empty — the reading `end-condition` already takes for a spell that finds
    // nothing to cure.
    expect(cast.outcomes).toEqual([{ target: GHOST, affected: false }]);
    // And the slot went: the casting happened, it simply did nothing here.
    expect(remaining(after.creatures[GHOST]!.resources, spellSlotKey(4))).toBe(0);
  });

  /** The same caster without the immunity does turn Invisible, or the above is vacuous. */
  it('and one with no such immunity does turn Invisible', () => {
    const table = ghost(false);
    const cast = castOnSelf(table);

    const after = fold('monster', [...table.events, ...cast.events]);
    expect(hasCondition(after.creatures[GHOST]!.conditions, 'invisible')).toBe(true);
    expect(cast.outcomes[0]?.conditions).toEqual(['invisible']);
  });
});

/**
 * The residue: an *implied* condition is not checked against the immunity.
 *
 * `applyCondition` expands SRD's implication table in the **fold**, after the
 * command has asked about the condition the caller named — so a creature
 * immune to Prone and Incapacitated but not to Unconscious acquires both the
 * moment something makes it Unconscious.
 *
 * **What is pinned here is the witness, not the answer.** The SRD says
 * Unconscious "includes" the other two and says nothing about what an immunity
 * to one of them does to that sentence, so a test asserting either outcome
 * would freeze a ruling the book declines to give — the reading
 * `TurnBudget.movementGained` already takes of an open question. What a test
 * *can* say is that the case is real and reachable, so the residue in
 * `conditionImmunitiesOf` cannot quietly stop being about a live stat block.
 */
describe('an implied condition is a residue the SRD does not settle', () => {
  const CLAWS = id('claws');

  it('has a real witness in the bestiary', () => {
    const adapted = adaptMonster(statBlock('swarm-of-crawling-claws'), CLAWS);
    const immune = adapted.defenses.conditionImmunities;

    // Immune to both of Unconscious's implications, and not to Unconscious.
    expect(immune).toContain('prone');
    expect(immune).toContain('incapacitated');
    expect(immune).not.toContain('unconscious');
  });

  /**
   * And the implication edge that meets it is the one SRD prints.
   *
   * **There is deliberately no third case here asserting what a Swarm made
   * Unconscious ends up with.** That is the answer the book does not give, and
   * a test pinning today's would have to be deleted by whoever finally has the
   * ruling — which is the same mistake as filtering the implications now, in
   * the other direction. The two cases above pin the *witness*: the stat
   * block's list and the implication edge, both of which are facts the SRD
   * prints and neither of which a ruling would change.
   */
  it('and the implication that reaches past it is real too', () => {
    expect(expandConditions(['unconscious'])).toEqual(
      expect.arrayContaining(['incapacitated', 'prone']),
    );
  });
});

describe('a qualified immunity is withheld and reported, never applied', () => {
  /**
   * SRD Vampire Familiar: "**Immunities** Charmed (except from its vampire
   * master)". Applied as flat immunity that makes the vampire unable to charm
   * the one creature the entry exists to let it charm — the documented wrong
   * answer, and the reason `conditionApplicability` has three outcomes.
   */
  it('leaves the condition allowed', () => {
    const adapted = adaptMonster(statBlock('vampire-familiar'), FAMILIAR);
    expect(adapted.defenses.conditionImmunities).toEqual([]);
    expect(conditionApplicability(adapted, 'charmed').kind).toBe('needs-adjudication');

    const table = new Table();
    table.did('the familiar arrives', (s) => addCreature(s, FAMILIAR, statBlock('vampire-familiar')));
    expect(conditionImmunitiesOf(table.state, FAMILIAR)).toEqual([]);
    const out = applyConditionTo(table.state, FAMILIAR, 'charmed', 'a honeyed word');
    expect(isErr(out) ? out.code : 'ok').toBe('ok');
  });

  it('reports the qualification in unverified, verbatim', () => {
    const added = unwrap(
      addCreature(fold('monster', []), FAMILIAR, statBlock('vampire-familiar')),
      'familiar',
    );
    expect(added.unverified).toEqual([
      'familiar: Charmed (except from its vampire master) — the engine cannot evaluate "except from its vampire master", so the immunity is not applied',
    ]);
  });

  /** And a stat block with nothing qualified reports nothing. */
  it('says nothing about a stat block whose entries are all unconditional', () => {
    const added = unwrap(addCreature(fold('monster', []), ZOMBIE, statBlock('zombie')), 'zombie');
    expect(added.unverified).toEqual([]);
  });
});

/**
 * An encounter with a monster in it, driven from nothing.
 *
 * Every event below is produced by a command or by something the engine
 * exports; not one of them is written down here. Until `addCreature` existed
 * the only way to reach a fight with a monster in it was to forge the log by
 * hand — which is what `unknownCreature`'s request had to tell a caller to do,
 * and no longer does.
 */
const encounter = (): Table => {
  const table = new Table();

  table.do('the fighter arrives', () => createCharacter(walkOn('Bren'), BREN));
  table.did('the zombie shambles in', (s) => addCreature(s, ZOMBIE, statBlock('zombie')));

  table.do('the crypt', (s) => setScene(s, { width: 60, depth: 40, height: 20 }));
  table.do('the slab', (s) => addSceneLandmark(s, 'the slab', { x: 20, y: 20, z: 0 }));
  table.do('Bren by the slab', (s) =>
    placeCreatureInScene(s, BREN, { from: { landmark: 'the slab' }, feet: 0 }),
  );
  table.do('the zombie beside him', (s) =>
    placeCreatureInScene(s, ZOMBIE, { from: { creature: BREN }, feet: 5, bearing: 90 }),
  );

  // Rolled, not chosen: the order is whatever the dice said.
  const dice = supply('initiative');
  const rolled = [BREN, ZOMBIE].map((who) => {
    const roll = unwrap(rollInitiativeFor(table.state, who, dice.issuer, dice.rng), 'initiative');
    return { id: who, initiative: roll.total, speed: 30 };
  });
  table.do('roll for Initiative', (s) => beginCombat(s, rolled));

  return table;
};

describe('a monster can be added, placed, rolled for and fought, with nothing forged', () => {
  it('reaches a started fight with the zombie in the order', () => {
    const state = encounter().state;
    expect(state.combat?.order.map((c) => c.id).sort()).toEqual([BREN, ZOMBIE].sort());
    expect(state.combat?.round).toBe(1);
  });

  /**
   * The half that makes the scenario a fight rather than a tableau: the
   * greatsword the Fighter's own package granted, swung at a creature that
   * arrived through `addCreature` and nothing else.
   *
   * `free: true` because whose turn it is comes out of the dice — the swing is
   * about the monster being a creature the rules can reach, not about the
   * economy, which `action-economy.test.ts` owns.
   */
  it('and the fighter can swing at it', () => {
    const table = encounter();
    const swung = unwrap(
      resolveAttack(
        table.state,
        BREN,
        { target: ZOMBIE, weapon: 'greatsword', free: true },
        supply('swing'),
      ),
      'the swing',
    );
    expect(swung.attack).not.toBeNull();
    expect(swung.events.length).toBeGreaterThan(0);
  });

  it('replays byte-identically, which is what makes it a log rather than a script', () => {
    const log = encounter().events;
    expect(fold('monster', log)).toEqual(fold('monster', log));
    expect(encounter().events).toEqual(log);
  });

  /**
   * And the claim above is read off this file rather than promised.
   *
   * A scenario that quietly hand-writes one event proves nothing about whether
   * a caller could have got here, and "no hand-written event anywhere in it"
   * is precisely the acceptance criterion — the move `scene-commands.test.ts`
   * makes for its own.
   */
  it('writes no event by hand', () => {
    const source = readFileSync(fileURLToPath(import.meta.url), 'utf8');
    const opener = source.indexOf('const encounter = (): Table => {');
    const closer = source.indexOf('\n};', opener);
    expect(opener).toBeGreaterThan(-1);
    expect(closer).toBeGreaterThan(opener);
    expect(source.slice(opener, closer)).not.toMatch(/\btype: '/);

    // And the scan would see one if it were there: the `ghost` fixture above
    // forges a `creature-added` deliberately — no stat block prints an
    // immunity to Invisible — and this is the pattern that finds it.
    expect(source.slice(0, opener)).toMatch(/\btype: '/);
  });
});
