import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import {
  asCharacterId,
  isErr,
  isNeedsContext,
  expect as unwrap,
  type CharacterId,
} from '@ie/shared';
import type { Monster } from '@ie/srd';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { declaredCasting } from './spellcasting.js';
import { currentCombatant } from './combat.js';
import {
  damageCreature,
  dismissStrandedSummons,
  endConcentration,
  endOngoingSpell,
  joinCombat,
  resolveAttack,
  resolveSpell,
  resolveTurn,
  rollInitiativeFor,
  strandedSummons,
  summonCreature,
  takeDodge,
} from './commands.js';

/**
 * A creature that did not exist when the fight began.
 *
 * Everything downstream of a summons was already built — a stat block becomes
 * a fightable creature (`adaptMonster`), a creature joins the cast
 * (`addCreature`), gets a side, a place on the map and a rung in a running
 * Initiative order. What no caller could say was that a *casting* is the
 * reason the creature is standing there, and therefore that the creature goes
 * when the casting does.
 *
 * So this file proves a door rather than a subsystem, and it proves the three
 * things a door has to get right:
 *
 * - **The sheet is pinned into the log.** `creature-added` has carried the
 *   whole sheet, the printed hit points, the creature type and both halves of
 *   the defence run since the adapter landed; the summons adds nothing to
 *   that and depends on all of it. The stat block below exists nowhere but
 *   this file — there is no monster catalogue in the engine and none in the
 *   content — so a fold that reproduced the creature could only have read the
 *   log.
 * - **Whose it is, and how long it lasts, are facts that already had homes.**
 *   The side is the summoner's own; the lifetime is the casting's, which the
 *   ongoing record and the timers already run.
 * - **Its leaving is the departure the engine already models**, unchanged:
 *   `removeCreatureEverywhere`, because a creature leaving has to settle
 *   what it owed before its key goes and a reducer emits nothing. What *is*
 *   derived is the noticing, which is what catches the four endings nobody
 *   commands. So the engine says who is owed a departure
 *   (`strandedSummons`) and a command performs it
 *   (`dismissStrandedSummons`); until it is called, a summons whose spell
 *   ended is still on the roster, still on the map and still holding its
 *   rung in the order, and the tests below say so rather than pretending
 *   otherwise.
 */

const id = (s: string) => asCharacterId(s);
const WIZ = id('wiz');
const FOE = id('foe');
const HOUND = id('hound');

/**
 * A stat block that exists in this file and nowhere else.
 *
 * Homebrew on purpose. `addCreature` takes the parsed `Monster` because there
 * is no registry to look one up in, and the whole claim about pinning is that
 * the fold never needs one — so the creature the log raises has to be one no
 * catalogue could have supplied.
 */
const CONJURED_HOUND: Monster = {
  id: 'conjured-hound',
  name: 'Conjured Hound',
  size: 'large',
  alternateSizes: [],
  type: 'Elemental',
  subtype: null,
  swarmMemberSize: null,
  alignment: 'Unaligned',
  ac: 14,
  initiative: 2,
  hp: { average: 26, formula: '4d10 + 4' },
  speed: { walk: 40, burrow: null, climb: null, fly: null, swim: null, hover: false },
  abilities: {
    str: { score: 16, modifier: 3, save: 3 },
    dex: { score: 14, modifier: 2, save: 2 },
    con: { score: 13, modifier: 1, save: 1 },
    int: { score: 4, modifier: -3, save: -3 },
    wis: { score: 12, modifier: 1, save: 1 },
    cha: { score: 6, modifier: -2, save: -2 },
  },
  skills: { perception: 5 },
  vulnerabilities: [],
  resistances: ['cold'],
  immunities: ['poison', 'poisoned'],
  gear: [],
  senses: ['Darkvision 60 ft.'],
  passivePerception: 15,
  languages: [],
  cr: 2,
  crLabel: '2',
  xp: 450,
  proficiencyBonus: 2,
  traits: [],
  actions: [{ name: 'Bite', text: 'Melee Attack Roll: +5, reach 5 ft. Hit: 7 (1d10 + 2).' }],
  bonusActions: [],
  reactions: [],
  legendaryActions: [],
};

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 9,
  abilities: { str: 10, dex: 14, con: 12, int: 18, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
  weaponProficiencies: ['simple'],
  ...over,
});

const added = (who: CharacterId, side: string): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 80,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side,
});

const supply = (seed = 'cast') => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

const SETUP: readonly GameEvent[] = [
  added(WIZ, 'party'),
  added(FOE, 'foes'),
  {
    type: 'spellcasting-declared',
    id: WIZ,
    spellcasting: declaredCasting({ ability: 'int', prepared: ['bless', 'mage-armor'] }),
  },
  ...[1, 2, 3].map(
    (level): GameEvent => ({
      type: 'resource-pool-declared',
      id: WIZ,
      pool: { key: `spell-slot:${level}`, label: `level ${level}`, max: 4, recovers: 'long-rest' },
    }),
  ),
  { type: 'scene-set', extent: { width: 600, depth: 600, height: 40 } },
  { type: 'landmark-added', name: 'the circle', at: { x: 200, y: 200, z: 0 } },
  { type: 'creature-placed', id: WIZ, placement: { from: { landmark: 'the circle' }, feet: 0 } },
  { type: 'creature-placed', id: FOE, placement: { from: { creature: WIZ }, feet: 20, bearing: 0 } },
];

/** A log that folds, with the two helpers every test here wants. */
class Game {
  constructor(readonly events: GameEvent[] = [...SETUP]) {}

  get state(): GameState {
    return fold('seed', this.events);
  }

  push(more: readonly GameEvent[]): this {
    this.events.push(...more);
    return this;
  }

  /** Cast, fold, and hand back the casting id it produced. */
  cast(who: CharacterId, spellId: string, targets: readonly CharacterId[], seed = spellId): string {
    const out = unwrap(
      resolveSpell(this.state, who, { spellId, targets }, supply(seed)),
      `${who} casting ${spellId}`,
    );
    this.push(out.events);
    return out.castingId;
  }

  fight(): this {
    return this.push([
      {
        type: 'combat-started',
        combatants: [
          { id: WIZ, initiative: 20, speed: 30 },
          { id: FOE, initiative: 5, speed: 30 },
        ],
      },
    ]);
  }
}

/** The log, through JSON and back, so nothing in memory can be helping. */
const replayed = (log: readonly GameEvent[]): GameState =>
  fold('seed', JSON.parse(JSON.stringify(log)) as GameEvent[]);

// — the door ——————————————————————————————————————————————————————————————

describe('a casting brings a creature into a running fight', () => {
  it('puts it on the roster with the sheet the event pinned', () => {
    const g = new Game().fight();
    const castingId = g.cast(WIZ, 'bless', [WIZ]);

    const out = unwrap(
      summonCreature(g.state, {
        id: HOUND,
        monster: CONJURED_HOUND,
        by: WIZ,
        castingId,
        placement: { from: { creature: WIZ }, feet: 10, bearing: 90 },
        initiative: 12,
      }),
      'summoning the hound',
    );
    g.push(out.events);

    const hound = g.state.creatures[HOUND];
    expect(hound?.name).toBe('Conjured Hound');
    // Printed rather than derived, exactly as `adaptMonster` carries it.
    expect(hound?.sheet.stated?.armorClass).toBe(14);
    expect(hound?.vitals.hpMax).toBe(26);
    // "A monster dies the instant it drops to 0 Hit Points."
    expect(hound?.vitals.diesAtZero).toBe(true);
    expect(hound?.creatureType).toBe('Elemental');
    expect(hound?.defenses['cold']).toEqual({ resistant: true });
    expect(hound?.conditionImmunities).toEqual(['poisoned']);
  });

  it('gives it the summoner’s side without being told', () => {
    const g = new Game().fight();
    const castingId = g.cast(WIZ, 'bless', [WIZ]);
    g.push(
      unwrap(
        summonCreature(g.state, { id: HOUND, monster: CONJURED_HOUND, by: WIZ, castingId, initiative: 12 }),
        'summoning',
      ).events,
    );

    expect(g.state.creatures[HOUND]?.side).toBe('party');
    expect(g.state.creatures[HOUND]?.summonedBy).toEqual({ by: WIZ, castingId });
  });

  it('places it where it was put, at the size its stat block prints', () => {
    const g = new Game().fight();
    const castingId = g.cast(WIZ, 'bless', [WIZ]);
    g.push(
      unwrap(
        summonCreature(g.state, {
          id: HOUND,
          monster: CONJURED_HOUND,
          by: WIZ,
          castingId,
          placement: { from: { creature: WIZ }, feet: 10, bearing: 90 },
          initiative: 12,
        }),
        'summoning',
      ).events,
    );

    expect(g.state.scene?.positions[HOUND]).toBeDefined();
    // Large, off the stat block rather than off a caller who had to know.
    expect(g.state.scene?.sizes[HOUND]).toBe('large');
  });

  it('can act when its Initiative comes', () => {
    const g = new Game().fight();
    const castingId = g.cast(WIZ, 'bless', [WIZ]);
    g.push(
      unwrap(
        summonCreature(g.state, {
          id: HOUND,
          monster: CONJURED_HOUND,
          by: WIZ,
          castingId,
          placement: { from: { creature: WIZ }, feet: 10, bearing: 90 },
          initiative: 12,
        }),
        'summoning',
      ).events,
    );

    // 20, then 12, then 5: the hound is second.
    g.push(unwrap(resolveTurn(g.state, supply('turn')), 'the wizard’s turn').events);
    expect(currentCombatant(g.state.combat!).id).toBe(HOUND);
    expect(isErr(takeDodge(g.state, HOUND, {}))).toBe(false);
  });
});

// — the fold opens no catalogue ————————————————————————————————————————————

describe('the log alone raises the creature', () => {
  it('folds to the same state with no content anywhere', () => {
    const g = new Game().fight();
    const castingId = g.cast(WIZ, 'bless', [WIZ]);
    g.push(
      unwrap(
        summonCreature(g.state, {
          id: HOUND,
          monster: CONJURED_HOUND,
          by: WIZ,
          castingId,
          placement: { from: { creature: WIZ }, feet: 10, bearing: 90 },
          initiative: 12,
        }),
        'summoning',
      ).events,
    );

    const replay = replayed(g.events);
    expect(replay.creatures[HOUND]?.sheet).toEqual(g.state.creatures[HOUND]?.sheet);
    expect(JSON.stringify(replay)).toBe(JSON.stringify(g.state));
  });

  it('carries no stat block id into the log', () => {
    const g = new Game().fight();
    const castingId = g.cast(WIZ, 'bless', [WIZ]);
    const out = unwrap(
      summonCreature(g.state, { id: HOUND, monster: CONJURED_HOUND, by: WIZ, castingId, initiative: 12 }),
      'summoning',
    );
    // The command stamp fingerprints the stat block's id, exactly as
    // `addCreature` does; nothing else in the batch names it, because the
    // numbers are what the fold reads and they are all here.
    const withoutStamps = out.events.map((event) => ({ ...event, command: undefined }));
    expect(JSON.stringify(withoutStamps)).not.toContain('conjured-hound');
  });
});

// — it goes when the casting goes —————————————————————————

/**
 * **The engine notices; a command performs.** A casting ends five ways and
 * four of them are found in the fold rather than commanded — so the *fact*
 * that a summons is standing on a spell that is over is derived, and
 * {@link strandedSummons} is where it is said. The departure itself cannot
 * be: a creature leaving is a batch that settles what the leaver owed, and
 * the reducer emits nothing. So `dismissStrandedSummons` performs it, exactly
 * as `settleAreaEffects` performs what the boundary raised.
 */
describe('a summoned creature leaves with the casting that made it', () => {
  const summoned = (): { g: Game; castingId: string } => {
    const g = new Game().fight();
    const castingId = g.cast(WIZ, 'bless', [WIZ]);
    g.push(
      unwrap(
        summonCreature(g.state, {
          id: HOUND,
          monster: CONJURED_HOUND,
          by: WIZ,
          castingId,
          placement: { from: { creature: WIZ }, feet: 10, bearing: 90 },
          initiative: 12,
        }),
        'summoning',
      ).events,
    );
    return { g, castingId };
  };

  it('is stranded the moment the caster dismisses the spell, and goes when swept', () => {
    const { g, castingId } = summoned();
    expect(strandedSummons(g.state)).toEqual([]);

    g.push(unwrap(endOngoingSpell(g.state, WIZ, castingId, null), 'dismissing'));
    expect(strandedSummons(g.state)).toEqual([HOUND]);

    // **And it is still standing there**, which is what makes the query a
    // report rather than the removal: noticing changes nothing, so until
    // somebody sweeps the hound is on the roster, on the map and holding its
    // rung in the order. What the noticing now buys is that the turn will not
    // move on past it — see the last describe in this file.
    expect(g.state.creatures[HOUND]).toBeDefined();
    expect(g.state.scene?.positions[HOUND]).toBeDefined();
    expect(g.state.combat?.order.some((c) => c.id === HOUND)).toBe(true);

    g.push(unwrap(dismissStrandedSummons(g.state), 'sweeping'));
    expect(g.state.creatures[HOUND]).toBeUndefined();
    expect(g.state.scene?.positions[HOUND]).toBeUndefined();
    expect(g.state.combat?.order.some((c) => c.id === HOUND)).toBe(false);
    expect(strandedSummons(g.state)).toEqual([]);
  });

  it('is stranded when the Concentration is dropped', () => {
    const { g } = summoned();
    g.push(unwrap(endConcentration(g.state, WIZ, 'voluntary'), 'dropping'));
    expect(strandedSummons(g.state)).toEqual([HOUND]);
  });

  /**
   * The half no command sees. Concentration broken by unconsciousness is
   * derived in the fold — nobody decides it — and the engine still knows the
   * hound is owed a departure, which is the whole point of the query being
   * the seam rather than each ending being made to remember.
   */
  it('is stranded when nobody decided anything, because the caster fell', () => {
    const { g } = summoned();
    g.push(unwrap(damageCreature(g.state, WIZ, { amount: 200, source: 'a rockfall' }), 'felling'));

    expect(g.state.creatures[WIZ]?.concentration).toBeNull();
    expect(strandedSummons(g.state)).toEqual([HOUND]);

    g.push(unwrap(dismissStrandedSummons(g.state), 'sweeping'));
    expect(g.state.creatures[HOUND]).toBeUndefined();
  });

  it('is not held by a casting nobody bound it to', () => {
    const g = new Game().fight();
    const castingId = g.cast(WIZ, 'bless', [WIZ]);
    g.push(
      unwrap(
        summonCreature(g.state, { id: HOUND, monster: CONJURED_HOUND, by: WIZ, initiative: 12 }),
        'summoning',
      ).events,
    );
    g.push(unwrap(endOngoingSpell(g.state, WIZ, castingId, null), 'dismissing'));
    g.push(unwrap(dismissStrandedSummons(g.state), 'sweeping'));

    // An Animate Dead skeleton outlives the Instantaneous casting that raised
    // it, and a creature bound to nothing is that creature.
    expect(g.state.creatures[HOUND]).toBeDefined();
  });

  it('takes the last combatant out by ending the fight rather than emptying the order', () => {
    const g = new Game();
    const castingId = g.cast(WIZ, 'bless', [WIZ]);
    g.push([{ type: 'combat-started', combatants: [{ id: WIZ, initiative: 20, speed: 30 }] }]);
    g.push(
      unwrap(
        summonCreature(g.state, {
          id: HOUND,
          monster: CONJURED_HOUND,
          by: WIZ,
          castingId,
          initiative: 12,
        }),
        'summoning',
      ).events,
    );
    // Now take the wizard out of the order first, leaving the hound alone in it.
    g.push([{ type: 'combatant-removed', id: WIZ }]);
    expect(g.state.combat?.order.map((c) => c.id)).toEqual([HOUND]);

    g.push(unwrap(endOngoingSpell(g.state, WIZ, castingId, null), 'dismissing'));
    g.push(unwrap(dismissStrandedSummons(g.state), 'sweeping'));
    expect(g.state.creatures[HOUND]).toBeUndefined();
    expect(g.state.combat).toBeNull();
  });

  it('sweeps nothing into an empty batch rather than a refusal', () => {
    const { g } = summoned();
    expect(unwrap(dismissStrandedSummons(g.state), 'sweeping nothing')).toEqual([]);
  });

  /**
   * The reason the departure is a batch and not a fold transition, stated as
   * a test: a creature that owes a held hit cannot simply be deleted, and
   * `removeCreatureEverywhere` is what closes the hold before the key goes.
   * A derived pass, emitting nothing, would leave the debt standing — and
   * every command that could settle it then answers `unknown_creature`, so
   * the fight could never advance again.
   */
  it('settles what a departing summons owed, rather than stranding it', () => {
    const g = new Game([
      ...SETUP,
      { type: 'items-gained', id: WIZ, items: [{ id: 'dagger', quantity: 1 }], source: 'kit' },
    ]);
    const castingId = g.cast(WIZ, 'bless', [WIZ]);
    g.push(
      unwrap(
        summonCreature(g.state, {
          id: HOUND,
          monster: CONJURED_HOUND,
          by: WIZ,
          castingId,
          placement: { from: { creature: WIZ }, feet: 5, bearing: 90 },
        }),
        'the hound',
      ).events,
    );
    g.push(
      unwrap(
        resolveAttack(
          g.state,
          WIZ,
          // Held, and staged to land: the debt is the point and the dice are
          // not, which is the reading `invariants.test.ts` takes of the same
          // hold.
          {
            target: HOUND,
            weapon: 'dagger',
            hold: true,
            attackBonuses: [{ source: 'staged', flat: 40 }],
          },
          supply('hit'),
        ),
        'swing',
      ).events,
    );
    expect(g.state.pendingAttack).not.toBeNull();

    // The rockfall: nobody decides the Concentration broke, so nobody could
    // have been asked to settle the hold first.
    g.push(unwrap(damageCreature(g.state, WIZ, { amount: 200, source: 'a rockfall' }), 'felling'));
    g.push(unwrap(dismissStrandedSummons(g.state), 'sweeping'));

    expect(g.state.creatures[HOUND]).toBeUndefined();
    expect(g.state.pendingAttack).toBeNull();
  });
});

// — refusals ———————————————————————————————————————————————————————————————

describe('what a summoning refuses, and what it asks for', () => {
  it('refuses a casting that is not running', () => {
    const g = new Game().fight();
    const refused = summonCreature(g.state, {
      id: HOUND,
      monster: CONJURED_HOUND,
      by: WIZ,
      castingId: 'no-such-casting',
      initiative: 12,
    });
    expect(isErr(refused) && refused.code).toBe('not_ongoing');
  });

  it('refuses a summoner the engine has never heard of', () => {
    const g = new Game().fight();
    const refused = summonCreature(g.state, {
      id: HOUND,
      monster: CONJURED_HOUND,
      by: id('nobody'),
      initiative: 12,
    });
    expect(isNeedsContext(refused)).toBe(true);
  });

  /**
   * **A fight running and no total stated is silence, not a refusal**, and
   * the reason is that the refusal would name no route. A creature that does
   * not exist cannot be rolled for, so a `needs-context` asking for a total
   * could only be satisfied by a number the caller invented — the one thing
   * the doctrine forbids outright. The creature arrives instead, and the two
   * commands that give a rung in a running order both work the moment it is
   * in the game.
   */
  it('arrives without a rung in the order when nobody stated one', () => {
    const g = new Game().fight();
    const castingId = g.cast(WIZ, 'bless', [WIZ]);
    const out = unwrap(
      summonCreature(g.state, { id: HOUND, monster: CONJURED_HOUND, by: WIZ, castingId }),
      'summoning with no total',
    );
    g.push(out.events);

    expect(g.state.creatures[HOUND]).toBeDefined();
    expect(g.state.combat?.order.some((c) => c.id === HOUND)).toBe(false);

    // And the route exists: the engine rolls, and the roll seats it.
    const rolled = unwrap(
      rollInitiativeFor(g.state, HOUND, createRollIssuer('i'), createRng('init') as Rng),
      'rolling for the hound',
    );
    g.push(unwrap(joinCombat(g.state, { id: HOUND, initiative: rolled.total, speed: 40 }), 'joining'));
    expect(g.state.combat?.order.some((c) => c.id === HOUND)).toBe(true);
  });

  it('refuses a casting that is not the summoner’s', () => {
    const g = new Game();
    const castingId = g.cast(WIZ, 'bless', [WIZ]);
    const refused = summonCreature(g.state, {
      id: HOUND,
      monster: CONJURED_HOUND,
      by: FOE,
      castingId,
    });
    expect(isErr(refused) && refused.code).toBe('not_your_spell');
  });

  /**
   * A retry that changed where the creature stands is a different command,
   * and being told so beats being told `duplicate` and having the placement
   * silently dropped.
   */
  it('refuses a recycled command id that moved the placement', () => {
    const g = new Game();
    const castingId = g.cast(WIZ, 'bless', [WIZ]);
    const first = { id: HOUND, monster: CONJURED_HOUND, by: WIZ, castingId } as const;
    g.push(unwrap(summonCreature(g.state, first, { commandId: 'the-hound' }), 'first').events);

    const moved = summonCreature(
      g.state,
      { ...first, placement: { from: { creature: WIZ }, feet: 10, bearing: 90 } },
      { commandId: 'the-hound' },
    );
    expect(isErr(moved) && moved.code).toBe('command_id_reused');
  });

  it('needs no Initiative when no fight is running', () => {
    const g = new Game();
    const castingId = g.cast(WIZ, 'bless', [WIZ]);
    const out = unwrap(
      summonCreature(g.state, { id: HOUND, monster: CONJURED_HOUND, by: WIZ, castingId }),
      'summoning out of combat',
    );
    g.push(out.events);
    expect(g.state.creatures[HOUND]).toBeDefined();
  });

  /**
   * The casting is checked before the creature is built, so a summoning that
   * names both a casting nobody is running and a creature already in the
   * game is told about the casting. Either answer is true; what matters is
   * is the same one every time, because a caller branching on the code
   * cannot branch on a coin.
   */
  it('answers the casting before it answers the creature', () => {
    const g = new Game();
    const refused = summonCreature(g.state, {
      id: FOE,
      monster: CONJURED_HOUND,
      by: WIZ,
      castingId: 'no-such-casting',
    });
    expect(isErr(refused) && refused.code).toBe('not_ongoing');
  });

  it('refuses a creature already in the game', () => {
    const g = new Game();
    const castingId = g.cast(WIZ, 'bless', [WIZ]);
    const refused = summonCreature(g.state, {
      id: FOE,
      monster: CONJURED_HOUND,
      by: WIZ,
      castingId,
    });
    expect(isErr(refused) && refused.code).toBe('already_present');
  });

  it('answers a retry as the duplicate it is', () => {
    const g = new Game();
    const castingId = g.cast(WIZ, 'bless', [WIZ]);
    const first = unwrap(
      summonCreature(
        g.state,
        { id: HOUND, monster: CONJURED_HOUND, by: WIZ, castingId },
        { commandId: 'the-hound' },
      ),
      'first',
    );
    g.push(first.events);
    const again = unwrap(
      summonCreature(
        g.state,
        { id: HOUND, monster: CONJURED_HOUND, by: WIZ, castingId },
        { commandId: 'the-hound' },
      ),
      'again',
    );
    expect(again.duplicate).toBe(true);
    expect(again.events).toEqual([]);
  });
});

// — what the log may not say ———————————————————————————————————————————————

describe('the reducer refuses a log that contradicts itself', () => {
  it('will not let two castings hold one creature', () => {
    const g = new Game();
    const first = g.cast(WIZ, 'bless', [WIZ], 'one');
    g.push(
      unwrap(
        summonCreature(g.state, { id: HOUND, monster: CONJURED_HOUND, by: WIZ, castingId: first }),
        'summoning',
      ).events,
    );

    const second = g.cast(WIZ, 'mage-armor', [WIZ], 'two');
    expect(() =>
      fold('seed', [
        ...g.events,
        { type: 'creature-summoned', id: HOUND, by: WIZ, castingId: second },
      ]),
    ).toThrow(/already held by/);
  });

  it('will not have a finished casting holding anybody', () => {
    const g = new Game();
    const castingId = g.cast(WIZ, 'bless', [WIZ]);
    g.push(
      unwrap(
        summonCreature(g.state, { id: HOUND, monster: CONJURED_HOUND, by: WIZ }),
        'summoning, bound to nothing',
      ).events,
    );
    g.push(unwrap(endOngoingSpell(g.state, WIZ, castingId, null), 'dismissing'));

    // The command refuses this (`not_ongoing`); a log that says it anyway
    // would carry a creature owed a departure from its first moment.
    expect(() =>
      fold('seed', [...g.events, { type: 'creature-summoned', id: HOUND, by: WIZ, castingId }]),
    ).toThrow(/not a spell that is still running/);
  });

  it('will not summon a creature nobody added', () => {
    const g = new Game();
    const castingId = g.cast(WIZ, 'bless', [WIZ]);
    expect(() =>
      fold('seed', [...g.events, { type: 'creature-summoned', id: HOUND, by: WIZ, castingId }]),
    ).toThrow();
  });

  it('reads a restatement of the same binding as the restatement it is', () => {
    const g = new Game();
    const castingId = g.cast(WIZ, 'bless', [WIZ]);
    g.push(
      unwrap(
        summonCreature(g.state, { id: HOUND, monster: CONJURED_HOUND, by: WIZ, castingId }),
        'summoning',
      ).events,
    );
    const again: GameEvent = { type: 'creature-summoned', id: HOUND, by: WIZ, castingId };
    expect(fold('seed', [...g.events, again]).creatures[HOUND]?.summonedBy).toEqual({
      by: WIZ,
      castingId,
    });
  });
});

// — a summons that is itself holding something ——————————————————————————————

describe('one departure can be the end of another', () => {
  /**
   * The case a single sorted walk over the cast would lose. The hound is
   * holding a spell of its own and a second creature is standing on that
   * spell, so the wizard letting go of the first casting has to reach all the
   * way down in the one fold rather than leaving the second creature behind
   * until something else happened to happen.
   */
  it('takes a summons that a departing summons was sustaining', () => {
    const SPRITE = id('a-sprite');
    const g = new Game();
    const first = g.cast(WIZ, 'bless', [WIZ], 'one');
    g.push(
      unwrap(
        summonCreature(g.state, {
          id: HOUND,
          monster: CONJURED_HOUND,
          by: WIZ,
          castingId: first,
          placement: { from: { creature: WIZ }, feet: 10, bearing: 90 },
        }),
        'the hound',
      ).events,
    );

    // The hound can cast, which is `declareSpellcasting`'s job for any
    // monster: a stat block prints its magic as prose and the adapter reads
    // none of it.
    g.push([
      {
        type: 'spellcasting-declared',
        id: HOUND,
        spellcasting: declaredCasting({ ability: 'cha', prepared: ['bless'] }),
      },
      {
        type: 'resource-pool-declared',
        id: HOUND,
        pool: { key: 'spell-slot:1', label: 'level 1', max: 1, recovers: 'long-rest' },
      },
    ]);
    const second = g.cast(HOUND, 'bless', [HOUND], 'two');
    g.push(
      unwrap(
        summonCreature(g.state, {
          id: SPRITE,
          monster: CONJURED_HOUND,
          by: HOUND,
          castingId: second,
        }),
        'the sprite',
      ).events,
    );
    expect(g.state.creatures[SPRITE]).toBeDefined();

    g.push(unwrap(endOngoingSpell(g.state, WIZ, first, null), 'dismissing'));
    // Only the hound is stranded yet: the sprite's own spell is still
    // running, and stops only because the hound leaving takes it.
    expect(strandedSummons(g.state)).toEqual([HOUND]);

    g.push(unwrap(dismissStrandedSummons(g.state), 'sweeping'));
    expect(g.state.creatures[HOUND]).toBeUndefined();
    expect(g.state.creatures[SPRITE]).toBeUndefined();
    expect(strandedSummons(g.state)).toEqual([]);
  });
});

// — the debt the turn refuses to advance past ————————————————————————————————

/**
 * **A rule forgotten stops the game rather than being quietly lost.**
 *
 * The query and the sweep have been here since the door was built, and until
 * now nothing called either: `resolveTurn` would advance the order past a
 * hound whose spell had ended, and the hound would keep its rung, keep
 * attacking and keep being attacked. That is a weaker guarantee than
 * `owedAreaEffects` has, and the difference was never a rule — it was the
 * state of a decision.
 *
 * So a stranded summons is engine debt of exactly that kind. It is
 * **derived** rather than filed, which is the one way it differs from
 * `owedAreaEffects` and the reason it needs no field: an area debt records a
 * moment that has passed and could not be recomputed later, while "who is
 * standing on a casting that is over" is a question about the world as it is
 * now, and `strandedSummons` answers it from `creatures` and `ongoing` alone.
 * A field would be a second copy of an answer the state already gives, and
 * two copies of one fact are two things that can disagree.
 */
describe('a turn will not advance past a summons nobody took away', () => {
  /** A hound the wizard's Bless is holding here, with a fight running. */
  const summonedIntoAFight = (): { g: Game; castingId: string } => {
    const g = new Game().fight();
    const castingId = g.cast(WIZ, 'bless', [WIZ]);
    g.push(
      unwrap(
        summonCreature(g.state, {
          id: HOUND,
          monster: CONJURED_HOUND,
          by: WIZ,
          castingId,
          placement: { from: { creature: WIZ }, feet: 10, bearing: 90 },
          initiative: 12,
        }),
        'summoning',
      ).events,
    );
    return { g, castingId };
  };

  /**
   * Driven through a casting that really ended, rather than a state written
   * to look like one: the whole value of the debt is that it catches the four
   * endings nobody commands, and a synthetic fixture would prove only that
   * the guard reads its own query.
   */
  it('refuses the advance, names the creature, and advances once it is swept', () => {
    const { g, castingId } = summonedIntoAFight();
    // 20, then 12, then 5: the wizard is up, and the turn would ordinarily go.
    expect(currentCombatant(g.state.combat!).id).toBe(WIZ);
    expect(isErr(resolveTurn(g.state, supply('turn')))).toBe(false);

    g.push(unwrap(endOngoingSpell(g.state, WIZ, castingId, null), 'dismissing'));
    expect(strandedSummons(g.state)).toEqual([HOUND]);

    const refused = resolveTurn(g.state, supply('turn'));
    expect(isErr(refused) ? refused.code : 'ok').toBe('summons_stranded');
    expect(isErr(refused) ? refused.reason : '').toContain(HOUND);
    // And nothing moved: the wizard is still the one having a turn.
    expect(currentCombatant(g.state.combat!).id).toBe(WIZ);

    g.push(unwrap(dismissStrandedSummons(g.state), 'sweeping'));
    const advanced = unwrap(resolveTurn(g.state, supply('turn')), 'the turn after the sweep');
    g.push(advanced.events);
    // The hound is gone, so the rung after the wizard's is the foe's.
    expect(currentCombatant(g.state.combat!).id).toBe(FOE);
  });

  /**
   * The ending nobody decided, which is the one the debt exists for: a
   * rockfall breaks the Concentration in the fold, no command was sent, and
   * the turn is what notices.
   */
  it('refuses when nobody decided the casting was over', () => {
    const { g } = summonedIntoAFight();
    g.push(unwrap(damageCreature(g.state, WIZ, { amount: 200, source: 'a rockfall' }), 'felling'));

    const refused = resolveTurn(g.state, supply('turn'));
    expect(isErr(refused) ? refused.code : 'ok').toBe('summons_stranded');
  });

  /**
   * And a refusal spends nothing. The guard sits inside the command's own
   * identity wrapper, so the caller comes back with the same command id once
   * the debt is settled and gets the turn rather than the empty batch a spent
   * id answers with.
   */
  it('leaves the command id unspent, so the same one advances after the sweep', () => {
    const { g, castingId } = summonedIntoAFight();
    g.push(unwrap(endOngoingSpell(g.state, WIZ, castingId, null), 'dismissing'));

    expect(isErr(resolveTurn(g.state, supply('turn'), { commandId: 'end-the-wizards-turn' }))).toBe(
      true,
    );
    g.push(unwrap(dismissStrandedSummons(g.state), 'sweeping'));

    const again = unwrap(
      resolveTurn(g.state, supply('turn'), { commandId: 'end-the-wizards-turn' }),
      'the same command id',
    );
    expect(again.duplicate ?? false).toBe(false);
    expect(again.events.length).toBeGreaterThan(0);
  });
});
