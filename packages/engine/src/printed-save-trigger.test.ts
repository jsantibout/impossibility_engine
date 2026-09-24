import { SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import {
  asCharacterId,
  type CharacterId,
  contextRequestsOf,
  isErr,
  ok,
  expect as unwrap,
  type Result,
} from '@ie/shared';
import {
  addCreature,
  addSceneLandmark,
  applyConditionTo,
  beginCombat,
  declareCreatureSide,
  declareDamageType,
  forcePrintedSave,
  placeCreatureInScene,
  removeCreatureEverywhere,
  resolvePendingSaves,
  resolveTurn,
  rollImprovisedDamage,
  setScene,
} from './commands.js';
import { createRng, type Rng } from './dice.js';
import { applyEvent, fold, type GameEvent, type GameState } from './events.js';
import { adaptMonster, printedSaveOf, triggeredSavesOf } from './monster.js';
import { createRollIssuer } from './rolls.js';
import { createCharacter, type CharacterChoices } from './creation.js';

/**
 * A save no creature spends: one a **moment** forces.
 *
 * Eight CR ≤ 5 lines and one more at CR 19 begin with a moment rather than a
 * use. SRD Magmin: "The magmin explodes when it dies." SRD Ghast: "any
 * creature that starts its turn in a 5-foot Emanation originating from the
 * ghast." Both were prose until this, and for one reason: the reader had
 * nowhere to put the *when*, so a line read without it would have been a Death
 * Burst a creature could set off on purpose.
 *
 * **The shape is the one `docs/design/time-and-turns.md` already names:
 * raising is derived, rolling is commanded.** A turn boundary raises the saves
 * it owes and `resolvePendingSaves` rolls them; this adds two raisers to the
 * same machinery — death, and a turn beginning inside an aura — and no second
 * machine. Nothing here rolls a die on its own initiative and the fold rolls
 * nothing at all.
 *
 * And one line whose damage type the book hands to the table: SRD Half-Dragon's
 * "damage of the type chosen for the Draconic Origin trait". The amount is the
 * book's, the dice are the engine's, and the word is the DM's — asked for
 * rather than invented, and refused at the door rather than at the dice.
 */

const id = (s: string) => asCharacterId(s);
const BREN = id('bren');
const NYX = id('nyx');
const FAR = id('far');
const MONSTER = id('monster');
const DOOR = id('door');

const supply = (seed: string) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

const statBlock = (slug: string) => {
  const found = SRD_CONTENT.monsterById(slug);
  if (found === null) throw new Error(`no such monster: ${slug}`);
  return found;
};

const common = {
  speciesId: 'human',
  backgroundId: 'sage',
  languages: ['Dwarvish', 'Orc'],
  alignment: 'Neutral',
  spellbook: [],
  backgroundEquipment: 'A' as const,
  classEquipment: 'A' as const,
  hitPoints: { method: 'fixed' as const },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
  cantrips: [],
  preparedSpells: [],
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int' as const,
      cantrips: ['mage-hand', 'light'],
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId: 'alert' },
  },
};

const walkOn = (name: string): CharacterChoices => ({
  ...common,
  name,
  classId: 'fighter',
  level: 1,
  abilities: {
    method: 'standard-array',
    assignment: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
  },
  abilityIncreases: { con: 2, wis: 1 },
  classSkills: ['athletics', 'survival'],
  equipped: ['chain-mail'],
  featureChoices: { 'human:skillful': ['perception'], 'fighter:weapon-mastery': [] },
  feats: { ...common.feats, 'fighter:fighting-style': { featId: 'archery' } },
});

class Table {
  private readonly log: GameEvent[] = [];

  get state(): GameState {
    return fold('burst', this.log);
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
}

/**
 * A monster and two people: one within five feet of it, one twenty away.
 *
 * Five and twenty because every trigger here is measured in feet and the two
 * distances have to straddle the shortest one in the book — a Magma Mephit's
 * five-foot Emanation.
 */
const aRoomWith = (slug: string, options: { readonly combat?: boolean } = {}): Table => {
  const table = new Table();
  table.do('the fighter arrives', () => createCharacter(SRD_CONTENT, walkOn('Bren'), BREN));
  table.do('the rogue arrives', () => createCharacter(SRD_CONTENT, walkOn('Nyx'), NYX));
  table.do('the watcher arrives', () => createCharacter(SRD_CONTENT, walkOn('Far'), FAR));
  table.did('the monster arrives', (s) => addCreature(s, SRD_CONTENT, MONSTER, slug));
  table.do('the room', (s) => setScene(s, { width: 120, depth: 80, height: 20 }));
  table.do('the brazier', (s) => addSceneLandmark(s, 'the brazier', { x: 40, y: 40, z: 0 }));
  table.do('the monster at the brazier', (s) =>
    placeCreatureInScene(s, MONSTER, { from: { landmark: 'the brazier' }, feet: 0 }),
  );
  table.do('Bren beside it', (s) =>
    placeCreatureInScene(s, BREN, { from: { creature: MONSTER }, feet: 5, bearing: 90 }),
  );
  table.do('Nyx a little back', (s) =>
    placeCreatureInScene(s, NYX, { from: { creature: MONSTER }, feet: 10, bearing: 270 }),
  );
  table.do('Far across the room', (s) =>
    placeCreatureInScene(s, FAR, { from: { creature: MONSTER }, feet: 40, bearing: 180 }),
  );
  for (const who of [BREN, NYX, FAR]) {
    table.do(`${who}'s side`, (s) => declareCreatureSide(s, who, 'party'));
  }
  table.do("the monster's side", (s) => declareCreatureSide(s, MONSTER, 'wild'));
  if (options.combat === true) {
    table.do('the order', (s) =>
      beginCombat(s, [
        { id: MONSTER, initiative: 20, speed: 30 },
        { id: BREN, initiative: 10, speed: 30 },
        { id: NYX, initiative: 5, speed: 30 },
        { id: FAR, initiative: 1, speed: 30 },
      ]),
    );
  }
  return table;
};

/** Enough to kill anything at this tier, at an amount the DM stated. */
const flatten = (table: Table, who: CharacterId, seed: string): GameState =>
  table.did('the blow lands', (s) =>
    rollImprovisedDamage(
      s,
      who,
      { dice: '20d10', damageType: 'force', source: "the fighter's hammer" },
      supply(seed),
    ),
  );

/** Whom the state owes a save, and against what. */
const owed = (state: GameState) =>
  Object.values(state.pendingSaves).map((pending) => ({
    target: pending.target,
    dc: pending.dc,
    ability: pending.ability,
    line: pending.printed?.line ?? null,
    by: pending.printed?.by ?? null,
  }));

/**
 * What one damage component of a named type came to on one creature.
 *
 * `damage-dice-recorded` carries the faces and the total, and the pair is what
 * lets a test assert the *rule* — "the halved damage is equal to half the
 * damage that would be dealt on a failed save" — without asserting a number
 * the engine rolled.
 */
const damageOn = (
  events: readonly GameEvent[],
  target: CharacterId,
  type: string,
): { readonly raw: number; readonly total: number; readonly type: string } | null => {
  for (const event of events) {
    if (event.type !== 'damage-dice-recorded' || event.target !== target) continue;
    const component = event.components.find((one) => one.type === type);
    if (component === undefined) continue;
    return {
      raw: component.dice.reduce((sum, die) => sum + die.value, 0) + component.flat,
      total: component.total,
      type: component.type,
    };
  }
  return null;
};

/**
 * The first seed in a short list that made the save go the way the test is
 * about.
 *
 * A test that pinned a seed would be a test about which face a die showed;
 * this searches for the branch and then asserts the *rule* on it, which is how
 * every other test of this family is written.
 */
const seedWhere = (
  want: boolean,
  settle: (seed: string) => { readonly success: boolean | null },
): string => {
  for (const seed of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l']) {
    if (settle(seed).success === want) return seed;
  }
  throw new Error(`no seed made the save ${want ? 'succeed' : 'fail'}`);
};

describe('the block carries a triggered save onto the sheet', () => {
  it('pins a Death Burst off a trait line, which no door can spend', () => {
    const sheet = adaptMonster(statBlock('magmin'), MONSTER).sheet;
    expect(sheet.stated?.traitSaves?.map((line) => line.name)).toEqual(['Death Burst']);
    expect(printedSaveOf(sheet, 'Death Burst')).toEqual({
      ability: 'dex',
      dc: 11,
      targets: 'each creature in a 10-foot Emanation originating from the magmin',
      trigger: { kind: 'dies' },
      damage: { dice: '2d6', flat: 0, type: 'fire', average: 7 },
      onSuccess: 'half',
    });
    // And the raisers' whole view of the block: a line and its save, with the
    // heading a string nothing branches on.
    expect(triggeredSavesOf(sheet).map((line) => line.line)).toEqual(['Death Burst']);
  });

  it('refuses to let a caller spend a line a moment forces', () => {
    const table = aRoomWith('magmin', { combat: true });
    const refused = forcePrintedSave(
      table.state,
      MONSTER,
      { line: 'Death Burst', targets: [BREN] },
      supply('x'),
    );
    expect(isErr(refused) && refused.code).toBe('save_is_triggered');
  });
});

describe('a Death Burst the fold raises when the creature dies', () => {
  it('raises one save per creature inside the Emanation and none outside it', () => {
    const table = aRoomWith('magmin', { combat: true });
    const after = flatten(table, MONSTER, 'kill');

    expect(after.creatures[MONSTER]?.vitals.dead).toBe(true);
    // Bren at 5 feet and Nyx at 10 are inside the ten-foot Emanation; Far at
    // 40 is not, and neither is the magmin, which is already gone.
    expect(owed(after).map((debt) => debt.target).sort()).toEqual([BREN, NYX]);
    expect(owed(after).every((debt) => debt.dc === 11 && debt.ability === 'dex')).toBe(true);
    expect(owed(after).every((debt) => debt.line === 'Death Burst' && debt.by === MONSTER)).toBe(
      true,
    );
  });

  it('raises nothing when nobody is near, and nothing for a block with no burst', () => {
    const alone = new Table();
    alone.did('the magmin arrives', (s) => addCreature(s, SRD_CONTENT, MONSTER, 'magmin'));
    alone.do('the room', (s) => setScene(s, { width: 60, depth: 60, height: 20 }));
    alone.do('the brazier', (s) => addSceneLandmark(s, 'the brazier', { x: 20, y: 20, z: 0 }));
    alone.do('it stands alone', (s) =>
      placeCreatureInScene(s, MONSTER, { from: { landmark: 'the brazier' }, feet: 0 }),
    );
    expect(Object.keys(flatten(alone, MONSTER, 'kill').pendingSaves)).toEqual([]);

    // And a creature whose block prints no such line owes nothing at all,
    // which is what keeps the pass from being a rule about dying.
    const wolf = aRoomWith('wolf', { combat: true });
    expect(Object.keys(flatten(wolf, MONSTER, 'kill').pendingSaves)).toEqual([]);
  });

  it('refuses to end the turn while the burst is owed, and clears it when rolled', () => {
    const table = aRoomWith('magmin', { combat: true });
    const after = flatten(table, MONSTER, 'kill');

    const refused = resolveTurn(after, supply('turn'));
    expect(isErr(refused) && refused.code).toBe('saves_pending');

    const rolled = unwrap(resolvePendingSaves(after, supply('roll')), 'the burst goes off');
    expect(rolled.saves).toHaveLength(2);
    expect(rolled.pending).toEqual([]);
    const settled = rolled.events.reduce(
      applyEvent,
      after,
    );
    expect(Object.keys(settled.pendingSaves)).toEqual([]);
  });

  it('discharges a burst whose target has left, and says so rather than wedging', () => {
    const table = aRoomWith('magmin', { combat: true });
    const after = flatten(table, MONSTER, 'kill');
    expect(owed(after).map((debt) => debt.target).sort()).toEqual([BREN, NYX]);

    // Nothing drops one of these — there is no timer for `dropOrphanedSaves`
    // to find gone — so a creature leaving between the burst and the roll must
    // leave a debt that can still be settled, or every later turn wedges on it.
    const left = table.do('Nyx walks out of the game', (s) =>
      removeCreatureEverywhere(s, NYX),
    );
    const rolled = unwrap(resolvePendingSaves(left, supply('roll')), 'the burst goes off');
    expect(rolled.saves.map((save) => save.target)).toEqual([BREN]);
    expect(rolled.unverified.join(' ')).toContain('beyond');
    const settled = rolled.events.reduce(applyEvent, left);
    expect(Object.keys(settled.pendingSaves)).toEqual([]);
    // And the turn can move again, which is the whole of what the debt was
    // holding up.
    expect(isErr(resolveTurn(settled, supply('turn')))).toBe(false);
  });

  it('deals the printed dice through the funnel — all of them, or half on a save', () => {
    const table = aRoomWith('magmin', { combat: true });
    const after = flatten(table, MONSTER, 'kill');
    const rolled = unwrap(resolvePendingSaves(after, supply('roll')), 'the burst goes off');

    for (const save of rolled.saves) {
      const faces = damageOn(rolled.events, save.target, 'fire');
      expect(faces, `${save.target} took Fire`).not.toBeNull();
      expect(faces!.type).toBe('fire');
      // SRD: "The halved damage is equal to half the damage that would be
      // dealt on a failed save." The rule, not the number.
      expect(faces!.total).toBe(save.success ? Math.floor(faces!.raw / 2) : faces!.raw);
    }
    // Both were hurt, which is what makes the halving assertion non-vacuous.
    const settled = rolled.events.reduce(applyEvent, after);
    expect(settled.creatures[BREN]!.vitals.hp).toBeLessThan(after.creatures[BREN]!.vitals.hp);
    // And Far, who was never in it, is untouched.
    expect(settled.creatures[FAR]!.vitals.hp).toBe(after.creatures[FAR]!.vitals.hp);
  });
});

describe('an aura that asks at the start of a turn', () => {
  /** A ghast, a fighter beside it and one ten feet away, with the fight open. */
  const withTheGhast = (): Table => aRoomWith('ghast', { combat: true });

  /**
   * Advance the turn **without a generator**, so the debt the boundary raised
   * can be read before anything rolls it.
   *
   * `resolveTurn` given a supply raises *and settles* in one call, which is
   * what an ordinary caller wants and what makes the debt invisible to a test
   * about who was caught. Given none, the saves stay in state exactly as they
   * do for a caller who advanced without one — which is the state
   * `resolvePendingSaves` exists to clear.
   */
  const advanceQuietly = (table: Table, step: string): GameState =>
    table.did(step, (s) => resolveTurn(s));

  it('catches the creature whose turn begins inside it and nobody else', () => {
    const table = withTheGhast();
    // The ghast is first in the order; ending its turn begins Bren's, five
    // feet away and inside the five-foot Emanation.
    expect(owed(advanceQuietly(table, 'the ghast finishes'))).toEqual([
      { target: BREN, dc: 10, ability: 'con', line: 'Stench', by: MONSTER },
    ]);

    const settled = table.did('the stench is answered', (s) =>
      resolvePendingSaves(s, supply('s1')),
    );
    expect(Object.keys(settled.pendingSaves)).toEqual([]);

    // Nyx, ten feet off, is outside a five-foot Emanation: her turn raises
    // nothing at all.
    expect(owed(advanceQuietly(table, 'Bren finishes'))).toEqual([]);
  });

  it('asks nothing while the aura’s holder has the Incapacitated condition', () => {
    const table = aRoomWith('gibbering-mouther', { combat: true });
    table.do('the mouther is stunned', (s) =>
      applyConditionTo(s, MONSTER, 'incapacitated', 'the ruling'),
    );
    // Bren is five feet away and the Gibbering reaches twenty, so the holder's
    // own condition is the only thing that can be keeping the save off him —
    // which is SRD's "while it is babbling", read as the sentence that defines
    // it.
    expect(owed(advanceQuietly(table, 'the mouther finishes'))).toEqual([]);

    // And without the condition the same boundary catches him, which is what
    // makes the assertion above about the gate rather than about the geometry.
    const babbling = aRoomWith('gibbering-mouther', { combat: true });
    expect(owed(advanceQuietly(babbling, 'the mouther finishes')).map((d) => d.target)).toEqual([
      BREN,
    ]);
  });

  it('rolls the Gibbering’s save and hands its d8 table back', () => {
    const table = aRoomWith('gibbering-mouther', { combat: true });
    const brensTurn = advanceQuietly(table, 'the mouther finishes');
    expect(owed(brensTurn)).toEqual([
      { target: BREN, dc: 10, ability: 'wis', line: 'Gibbering', by: MONSTER },
    ]);

    const rolled = unwrap(resolvePendingSaves(brensTurn, supply('s1')), 'the babbling');
    expect(rolled.saves).toHaveLength(1);
    // The engine applied nothing of the failure, because the failure is a d8
    // table nobody could structure — and it says so, at the moment the save
    // was rolled rather than never.
    expect(rolled.unverified.join(' ')).toContain('rolls 1d8');
    expect(rolled.unverified.join(' ')).toContain("this sentence is the table's");
  });

  /**
   * The ghast's Stench, rolled on one seed and **kept**.
   *
   * The events go into the log rather than being read out of a return value,
   * because what follows is a question about the world the save left: a
   * search that rolled on one seed and then re-rolled on another would be
   * asserting about a different die than the one it chose.
   */
  const stenchOn = (seed: string): { readonly table: Table; readonly success: boolean | null } => {
    const table = withTheGhast();
    advanceQuietly(table, 'the ghast finishes');
    const brensTurn = table.state;
    const rolled = unwrap(resolvePendingSaves(brensTurn, supply(seed)), 'the stench');
    table.did('the stench is answered', () => ok(rolled));
    return { table, success: rolled.saves[0]?.success ?? null };
  };

  it('grants the day’s grace on a made save, and asks nothing the next turn', () => {
    const made = stenchOn(seedWhere(true, (seed) => stenchOn(seed)));

    // SRD: "_Success:_ The target is immune to this ghast's Stench for 24
    // hours" — one creature's one line, and not an immunity to being Poisoned.
    const after = made.table.state;
    expect(after.creatures[BREN]!.lineImmunities.map((held) => held.line)).toEqual(['Stench']);
    expect(after.creatures[BREN]!.conditions.instances).toEqual([]);

    // And the next time Bren's turn begins in it, nothing is raised: four more
    // advances bring the order back round to him.
    for (const step of ['t2', 't3', 't4', 't5']) advanceQuietly(made.table, step);
    const round = made.table.state;
    expect(round.combat?.order[round.combat.turnIndex]?.id).toBe(BREN);
    expect(owed(round)).toEqual([]);
  });

  it('applies the Poisoned condition on a failure, and buys no immunity', () => {
    const failed = stenchOn(seedWhere(false, (seed) => stenchOn(seed)));

    const after = failed.table.state;
    expect(after.creatures[BREN]!.conditions.instances.map((one) => one.condition)).toEqual([
      'poisoned',
    ]);
    expect(after.creatures[BREN]!.lineImmunities).toEqual([]);
  });

  it('narrows a Sea Hag’s aura to the types the clause names', () => {
    // SRD Sea Hag: "any **Beast or Humanoid** that starts its turn within 30
    // feet of the hag and can see the hag's true form." Thirty feet reaches
    // both of them, so the only thing that can tell them apart is the type.
    const table = new Table();
    table.do('the fighter arrives', () => createCharacter(SRD_CONTENT, walkOn('Bren'), BREN));
    table.did('the hag arrives', (s) => addCreature(s, SRD_CONTENT, MONSTER, 'sea-hag'));
    table.did('the armour arrives', (s) => addCreature(s, SRD_CONTENT, NYX, 'animated-armor'));
    table.do('the room', (s) => setScene(s, { width: 120, depth: 80, height: 20 }));
    table.do('the brazier', (s) => addSceneLandmark(s, 'the brazier', { x: 40, y: 40, z: 0 }));
    table.do('the hag at the brazier', (s) =>
      placeCreatureInScene(s, MONSTER, { from: { landmark: 'the brazier' }, feet: 0 }),
    );
    table.do('Bren beside her', (s) =>
      placeCreatureInScene(s, BREN, { from: { creature: MONSTER }, feet: 5, bearing: 90 }),
    );
    table.do('the armour beside her', (s) =>
      placeCreatureInScene(s, NYX, { from: { creature: MONSTER }, feet: 5, bearing: 270 }),
    );
    table.do('Bren’s side', (s) => declareCreatureSide(s, BREN, 'party'));
    table.do('the hag’s side', (s) => declareCreatureSide(s, MONSTER, 'wild'));
    table.do('the armour’s side', (s) => declareCreatureSide(s, NYX, 'wild'));
    table.do('the order', (s) =>
      beginCombat(s, [
        { id: MONSTER, initiative: 20, speed: 30 },
        { id: BREN, initiative: 10, speed: 30 },
        { id: NYX, initiative: 5, speed: 30 },
      ]),
    );
    expect(table.state.creatures[NYX]?.creatureType).toBe('Construct');

    // Bren is a Humanoid: his turn beginning inside the aura owes a save.
    expect(owed(advanceQuietly(table, 'the hag finishes')).map((d) => d.target)).toEqual([BREN]);
    table.did('the glare is answered', (s) => resolvePendingSaves(s, supply('s1')));
    // The armour is a Construct standing in the same place, and is not asked.
    expect(owed(advanceQuietly(table, 'Bren finishes'))).toEqual([]);
  });
});

describe('a damage type the block leaves to the table', () => {
  it('asks for the type before it will roll the breath, and names the door', () => {
    const table = aRoomWith('half-dragon', { combat: true });
    const asked = forcePrintedSave(
      table.state,
      MONSTER,
      { line: "Dragon's Breath (Recharge 5–6)", targets: [BREN] },
      supply('breath'),
    );
    expect(isErr(asked) && asked.code).toBe('undeclared_damage_type');
    expect(contextRequestsOf(asked).map((request) => request.satisfyWith).join(' ')).toContain(
      'declareDamageType',
    );
  });

  it('rolls the breath in the declared type once a DM has said which', () => {
    const table = aRoomWith('half-dragon', { combat: true });
    table.do('the dragon is a fire one', (s) => declareDamageType(s, MONSTER, 'Fire'));
    expect(table.state.creatures[MONSTER]!.declaredDamageType).toBe('fire');

    const breathed = unwrap(
      forcePrintedSave(
        table.state,
        MONSTER,
        { line: "Dragon's Breath (Recharge 5–6)", targets: [BREN] },
        supply('breath'),
      ),
      'the breath',
    );
    const faces = damageOn(breathed.events, BREN, 'fire');
    expect(faces, 'the breath dealt Fire').not.toBeNull();
    // 8d6 and nothing added, which is the book's own amount — and the type is
    // the table's answer and not a word the parser invented.
    expect(faces!.raw).toBeGreaterThanOrEqual(8);
    expect(faces!.raw).toBeLessThanOrEqual(48);
    expect(breathed.outcomes[0]!.damage).toBeGreaterThan(0);
  });

  it('refuses a word that is not a damage type', () => {
    const table = aRoomWith('half-dragon', { combat: true });
    const refused = declareDamageType(table.state, MONSTER, 'sunshine');
    expect(isErr(refused) && refused.code).toBe('not_a_damage_type');
  });

  it('records the same answer once and lets a table change its mind', () => {
    const table = aRoomWith('half-dragon', { combat: true });
    table.do('Fire', (s) => declareDamageType(s, MONSTER, 'fire'));
    // Saying it again says nothing new.
    expect(unwrap(declareDamageType(table.state, MONSTER, 'fire'), 'again')).toEqual([]);
    // And a different dragon is a different answer, not a contradiction.
    table.do('Cold after all', (s) => declareDamageType(s, MONSTER, 'cold'));
    expect(table.state.creatures[MONSTER]!.declaredDamageType).toBe('cold');
  });

  it('refuses an unknown creature rather than inventing one', () => {
    const table = aRoomWith('half-dragon', { combat: true });
    expect(isErr(declareDamageType(table.state, DOOR, 'fire'))).toBe(true);
  });
});
