import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import {
  asCharacterId,
  isErr,
  expect as unwrap,
  type CharacterId,
  type Result,
} from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, restoreRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { declaredCasting } from './spellcasting.js';
import { HIT_POINT_LOSS, woundOn } from './commands/printed-save-clauses.js';
import { addCreature, resolveAttack, resolveEffectCheck, resolveSpell, resolveTurn } from './commands.js';

/**
 * SRD Bearded Devil's Infernal Glaive, and the three sentences that are one
 * clause.
 *
 * > "_Hit:_ 8 (1d10 + 3) Slashing damage. If the target is a creature **and
 * > doesn't already have an infernal wound**, it is subjected to the following
 * > effect. _Constitution Saving Throw:_ DC 12. _Failure:_ The target receives
 * > an infernal wound. While wounded, the target loses 5 (1d10) Hit Points at
 * > the start of each of its turns. The wound closes after 1 minute, after a
 * > spell restores Hit Points to the target, or after the target or a creature
 * > within 5 feet of it takes an action to stanch the wound, doing so by
 * > succeeding on a DC 12 Wisdom (Medicine) check."
 *
 * **Three primitives the engine already had, filed under one source.** The
 * loss is a `GrantedPayout` at the wounded creature's own start of turn — the
 * shape SRD Stirge's drink and the glossary's Burning both take. The minute is
 * that grant's `grants` deadline. The stanch is the `EffectCheck` on the same
 * timer, widened to a neighbour by the clause the creatures track built for
 * SRD Ensnaring Strike. One source and one timer, so each of the three endings
 * takes the whole wound.
 *
 * **And one the engine did not have**: a spell restoring hit points. `healed`
 * carried no source, so a Cure Wounds and a swig from a flask were the same
 * event; it names its casting now, and `closeHealedWounds` is the derived pass
 * that reads it.
 *
 * "Loses Hit Points" is the only sentence in the bestiary that lowers hit
 * points without naming a kind of damage, and the loss goes through the one
 * arithmetic the engine has for that under the book's own noun — see
 * {@link HIT_POINT_LOSS}.
 */

const DEVIL = asCharacterId('grizzle');
/** A second devil, so "doesn't already have an infernal wound" can be tested. */
const OTHER_DEVIL = asCharacterId('gnash');
const ROGUE = asCharacterId('nix');
const CLERIC = asCharacterId('ilda');

const GLAIVE = SRD_CONTENT.monsterById('bearded-devil')!.actions.find((one) =>
  one.name.includes('Glaive'),
)!.name;

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 5,
  abilities: { str: 12, dex: 16, con: 14, int: 10, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: null,
  ...over,
});

const added = (who: CharacterId, over: Partial<CharacterSheet> = {}): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(over),
  // High, so a minute of 1d10s cannot end the test by killing the rogue.
  maxHp: 300,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side: 'party',
});

/**
 * A cleric who can make the DC 12 check comfortably and can cast Cure Wounds.
 *
 * Proficient in Medicine with a Wisdom of 20, so a +7 clears the DC on
 * anything but a 4 or less — which is what lets one seed show a success and a
 * penalty show the failure beside it.
 */
const CLERIC_SHEET: Partial<CharacterSheet> = {
  abilities: { str: 10, dex: 12, con: 12, int: 10, wis: 20, cha: 12 },
  skills: { medicine: 'proficient' },
  spellcastingAbility: 'wis',
};

const LANDMARKS = {
  'the brazier': { x: 100, y: 100, z: 0 },
} as const;

/** The devil at the length of its glaive, the cleric at the rogue's elbow. */
const field = (): readonly GameEvent[] => [
  added(ROGUE),
  added(CLERIC, CLERIC_SHEET),
  {
    type: 'spellcasting-declared',
    id: CLERIC,
    spellcasting: declaredCasting({
      ability: 'wis',
      classId: 'cleric',
      prepared: ['cure-wounds'],
    }),
  },
  {
    type: 'resource-pool-declared',
    id: CLERIC,
    pool: { key: 'spell-slot:1', label: 'level 1', max: 4, recovers: 'long-rest' },
  },
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
  ...Object.entries(LANDMARKS).map(
    ([name, at]): GameEvent => ({ type: 'landmark-added', name, at }),
  ),
  { type: 'creature-placed', id: ROGUE, placement: { from: { landmark: 'the brazier' }, feet: 0 } },
  {
    type: 'creature-placed',
    id: CLERIC,
    placement: { from: { creature: ROGUE }, feet: 5, bearing: 270 },
  },
];

class Table {
  readonly events: GameEvent[] = [];

  constructor(private readonly seed: string) {
    let opening = fold(seed, []);
    for (const who of [DEVIL, OTHER_DEVIL]) {
      const arrived = unwrap(addCreature(opening, SRD_CONTENT, who, 'bearded-devil'), 'a devil');
      this.events.push(...arrived.events);
      opening = fold(seed, this.events);
    }
    this.events.push(...field());
    this.events.push(
      {
        type: 'creature-placed',
        id: DEVIL,
        placement: { from: { creature: ROGUE }, feet: 10, bearing: 90 },
      },
      {
        type: 'creature-placed',
        id: OTHER_DEVIL,
        placement: { from: { creature: ROGUE }, feet: 10, bearing: 0 },
      },
      { type: 'creature-side-declared', id: DEVIL, side: 'foes' },
      { type: 'creature-side-declared', id: OTHER_DEVIL, side: 'foes' },
      {
        type: 'combat-started',
        combatants: [
          { id: DEVIL, initiative: 20, speed: 30 },
          { id: OTHER_DEVIL, initiative: 15, speed: 30 },
          { id: ROGUE, initiative: 10, speed: 30 },
          { id: CLERIC, initiative: 5, speed: 30 },
        ],
      },
    );
  }

  get state(): GameState {
    return fold(this.seed, this.events);
  }

  push(more: readonly GameEvent[]): this {
    this.events.push(...more);
    return this;
  }

  supply(flat?: number) {
    const state = this.state;
    return {
      issuer: createRollIssuer('r', state.rollsIssued),
      rng: (state.rng === null ? createRng(this.seed) : restoreRng(state.rng)) as Rng,
      ...(flat === undefined ? {} : { bonuses: [{ source: 'the test insists', flat }] }),
      content: SRD_CONTENT,
    };
  }

  /**
   * A glaive the devil cannot miss with, and whatever the rogue's save came to.
   *
   * The swing is forced and the **save is not**: a printed rider's save is
   * rolled by `forcePrintedSaveOn`, which reads what the target's sheet and its
   * standing effects say and nothing a caller handed the `Supply`. So the
   * failure is found by seed, which is `graded-hits.test.ts`'s own way of
   * reaching a rung of a printed save.
   */
  strike(who: CharacterId = DEVIL): readonly GameEvent[] {
    const out = unwrap(
      resolveAttack(
        this.state,
        who,
        {
          target: ROGUE,
          weapon: null,
          action: GLAIVE,
          attackBonuses: [{ source: 'the test insists', flat: 40 }],
        },
        this.supply(),
      ),
      'the glaive',
    );
    this.push(out.events);
    return out.events;
  }

  turn(): readonly GameEvent[] {
    const out = unwrap(resolveTurn(this.state, this.supply()), 'the boundary');
    this.push(out.events);
    return out.events;
  }

  /** Hand the order round until it is this creature's turn. */
  until(who: CharacterId): readonly GameEvent[] {
    for (let guard = 0; guard < 12; guard += 1) {
      const combat = this.state.combat;
      if (combat !== null && combat.order[combat.turnIndex]?.id === who) return [];
      const events = this.turn();
      if (this.state.combat?.order[this.state.combat.turnIndex]?.id === who) return events;
    }
    throw new Error(`the order never reached ${who}`);
  }

  hp(who: CharacterId): number {
    return this.state.creatures[who]!.vitals.hp;
  }

  /** The key the wound's timer is filed under. */
  woundKey(): string {
    const source = woundOn(this.state, ROGUE);
    return Object.keys(this.state.timers).find(
      (key) => this.state.timers[key]!.target.kind === 'grants' && key.includes(source ?? '#none'),
    )!;
  }
}

/**
 * A table whose devil has landed a wound on the rogue.
 *
 * Seed by seed until the Constitution save fails, `biteUntil`'s shape in
 * `graded-hits.test.ts`: the swing is certain and the save is the generator's,
 * so the fixture is the first seed that produces the failure the tests are
 * about. Deterministic, because the seed it settles on is a function of the
 * name it was given.
 */
const wounded = (seed: string): Table => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const table = new Table(`${seed}-${attempt}`);
    table.strike();
    if (woundOn(table.state, ROGUE) !== null) return table;
  }
  throw new Error(`no glaive under ${seed} left a wound`);
};

const codeOf = (result: Result<unknown>): string | null => (isErr(result) ? result.code : null);

describe('SRD Bearded Devil: the three sentences the reader takes as one', () => {
  it('reads the wound, its loss, its minute and its check out of the rider', () => {
    const line = SRD_CONTENT.monsterById('bearded-devil')!.actions.find(
      (one) => one.name === GLAIVE,
    )!;
    expect(line.attack!.rider).toBeNull();
    expect(line.attack!.riderSave).toEqual({
      ability: 'con',
      dc: 12,
      targets: 'a creature',
      onSuccess: 'none',
      onFailure: [
        {
          kind: 'wound',
          loss: { dice: '1d10', flat: 0, average: 5 },
          closesAfterSeconds: 60,
          stanch: { ability: 'wis', skill: 'medicine', dc: 12 },
        },
      ],
    });
  });

  /**
   * The gate the opening prints — "and doesn't already have an infernal wound"
   * — used to make the whole rider prose, on the honest ground that a gate
   * dropped in silence is a rule nobody printed. The clause keeps it now.
   */
  it('leaves nothing of the line to the table', () => {
    const line = SRD_CONTENT.monsterById('bearded-devil')!.actions.find(
      (one) => one.name === GLAIVE,
    )!;
    expect(line.attack!.riderSave!.handedOver ?? []).toEqual([]);
  });
});

describe('SRD Bearded Devil: what the wound costs', () => {
  it('takes 1d10 Hit Points off the rogue at the start of its turn', () => {
    const table = wounded('wound-1');
    const before = table.hp(ROGUE);
    const events = table.until(ROGUE);
    const lost = events.filter(
      (event) => event.type === 'damage-taken' && event.id === ROGUE,
    );
    expect(lost).toHaveLength(1);
    expect(table.hp(ROGUE)).toBeLessThan(before);
    // The book takes hit points away here and names no kind of damage, so
    // neither does the log: the phrase it prints is what the component says.
    expect(JSON.stringify(events)).toContain(HIT_POINT_LOSS);
  });

  /** And every turn after, until something closes it. */
  it('takes it again at the next turn', () => {
    const table = wounded('wound-2');
    table.until(ROGUE);
    const after = table.hp(ROGUE);
    table.until(DEVIL);
    table.until(ROGUE);
    expect(table.hp(ROGUE)).toBeLessThan(after);
  });

  /** "if the target … doesn't already have an infernal wound." */
  it('gives no creature a second wound', () => {
    const table = wounded('wound-3');
    const first = woundOn(table.state, ROGUE);
    // **A second devil, not the same one again**, because the sentence is about
    // any infernal wound and not this devil's: a second grant from one source
    // replaces rather than stacks, so one devil swinging twice could not tell
    // the rule from the bookkeeping.
    table.until(OTHER_DEVIL);
    const again = table.strike(OTHER_DEVIL);
    // The second glaive still cuts — the wound gates the rider, not the blow.
    expect(again.some((event) => event.type === 'damage-taken')).toBe(true);
    expect(woundOn(table.state, ROGUE)).toBe(first);
    expect(table.state.creatures[ROGUE]!.payouts).toHaveLength(1);
  });
});

describe('SRD Bearded Devil: the three ways the wound closes', () => {
  /**
   * "after the target or a creature within 5 feet of it takes an action to
   * stanch the wound, doing so by succeeding on a DC 12 Wisdom (Medicine)
   * check."
   */
  it('closes on the cleric’s Medicine check and stays open on a failure', () => {
    const missed = wounded('stanch-miss');
    missed.until(CLERIC);
    const key = missed.woundKey();
    const failed = unwrap(
      resolveEffectCheck(
        missed.state,
        CLERIC,
        { effectKey: key, bonuses: [{ source: 'the test insists', flat: -40 }] },
        missed.supply(),
      ),
      'a botched stanch',
    );
    expect(failed.success).toBe(false);
    missed.push(failed.events);
    expect(woundOn(missed.state, ROGUE)).not.toBeNull();
    // The Action goes whether or not the check lands, which is SRD.
    expect(failed.events.some((event) => event.type === 'action-spent')).toBe(true);

    const made = wounded('stanch-hit');
    made.until(CLERIC);
    const stanched = unwrap(
      resolveEffectCheck(
        made.state,
        CLERIC,
        { effectKey: made.woundKey(), bonuses: [{ source: 'the test insists', flat: 40 }] },
        made.supply(),
      ),
      'the stanch',
    );
    expect(stanched.success).toBe(true);
    made.push(stanched.events);
    expect(woundOn(made.state, ROGUE)).toBeNull();
    // And the wound costs nothing at the rogue's next turn.
    const before = made.hp(ROGUE);
    made.until(ROGUE);
    expect(made.hp(ROGUE)).toBe(before);
  });

  /** And nobody across the room may do it: the book says "within 5 feet of it". */
  it('refuses the stanch to a creature out of reach', () => {
    const table = wounded('stanch-far');
    table.push([
      {
        type: 'creature-moved',
        id: CLERIC,
        placement: { from: { creature: ROGUE }, feet: 40, bearing: 270 },
      },
    ]);
    table.until(CLERIC);
    const refused = resolveEffectCheck(
      table.state,
      CLERIC,
      { effectKey: table.woundKey() },
      table.supply(),
    );
    expect(codeOf(refused)).toBe('not_yours_to_attempt');
  });

  /** "after a spell restores Hit Points to the target." */
  it('closes on a Cure Wounds and not on hit points from nowhere', () => {
    const mundane = wounded('heal-mundane');
    mundane.push([{ type: 'healed', id: ROGUE, amount: 5 }]);
    expect(woundOn(mundane.state, ROGUE), 'a heal nobody named closed it').not.toBeNull();

    const table = wounded('heal-spell');
    table.until(CLERIC);
    const cast = unwrap(
      resolveSpell(
        table.state,
        CLERIC,
        { spellId: 'cure-wounds', targets: [ROGUE], slotLevel: 1 },
        table.supply(),
      ),
      'cure wounds',
    );
    // The casting names itself on the heal, which is what the pass reads.
    const healed = cast.events.find((event) => event.type === 'healed');
    expect(healed).toMatchObject({ id: ROGUE, source: expect.stringContaining('Cure Wounds') });
    table.push(cast.events);
    expect(woundOn(table.state, ROGUE)).toBeNull();
    expect(table.state.timers[table.woundKey() ?? '']).toBeUndefined();
  });

  /** "The wound closes after 1 minute" — ten rounds, and nobody lifted a finger. */
  it('closes on the minute unaided', () => {
    const table = wounded('minute');
    for (let round = 0; round < 12 && woundOn(table.state, ROGUE) !== null; round += 1) {
      table.until(ROGUE);
      table.until(DEVIL);
    }
    expect(woundOn(table.state, ROGUE)).toBeNull();
    expect(table.state.elapsed).toBeGreaterThanOrEqual(60);
  });
});
