import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import {
  asCharacterId,
  contextRequestsOf,
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
  endConcentration,
  endOngoingSpell,
  resolveSpell,
  resolveTurn,
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
 * - **Its leaving is the departure the engine already models.** The same
 *   function `creature-removed` folds through, reached by a derived pass
 *   rather than by a second answer, because four of the five ways a casting
 *   ends are things nobody decides.
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

// — it goes when the casting goes ——————————————————————————————————————————

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

  it('goes when the caster dismisses it', () => {
    const { g, castingId } = summoned();
    g.push(unwrap(endOngoingSpell(g.state, WIZ, castingId, null), 'dismissing'));

    expect(g.state.creatures[HOUND]).toBeUndefined();
    expect(g.state.scene?.positions[HOUND]).toBeUndefined();
    expect(g.state.combat?.order.some((c) => c.id === HOUND)).toBe(false);
  });

  it('goes when the Concentration is dropped', () => {
    const { g } = summoned();
    g.push(unwrap(endConcentration(g.state, WIZ, 'voluntary'), 'dropping'));
    expect(g.state.creatures[HOUND]).toBeUndefined();
  });

  /**
   * The half no command sees. Concentration broken by unconsciousness is
   * derived in the fold — nobody decides it — so a summons that only went
   * when somebody sent a command would outlive its spell exactly here.
   */
  it('goes when nobody decided anything, because the caster fell', () => {
    const { g } = summoned();
    g.push(unwrap(damageCreature(g.state, WIZ, { amount: 200, source: 'a rockfall' }), 'felling'));

    expect(g.state.creatures[WIZ]?.concentration).toBeNull();
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
        summonCreature(g.state, { id: HOUND, monster: CONJURED_HOUND, by: WIZ, castingId, initiative: 12 }),
        'summoning',
      ).events,
    );
    // Now take the wizard out of the order first, leaving the hound alone in it.
    g.push([{ type: 'combatant-removed', id: WIZ }]);
    expect(g.state.combat?.order.map((c) => c.id)).toEqual([HOUND]);

    g.push(unwrap(endOngoingSpell(g.state, WIZ, castingId, null), 'dismissing'));
    expect(g.state.creatures[HOUND]).toBeUndefined();
    expect(g.state.combat).toBeNull();
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

  it('asks for an Initiative total rather than inventing one', () => {
    const g = new Game().fight();
    const castingId = g.cast(WIZ, 'bless', [WIZ]);
    const asked = summonCreature(g.state, { id: HOUND, monster: CONJURED_HOUND, by: WIZ, castingId });

    expect(isNeedsContext(asked)).toBe(true);
    expect(isErr(asked) && asked.code).toBe('initiative_required');
    expect(contextRequestsOf(asked).map((r) => r.kind)).toEqual(['turn-order']);
    // And it names the command that would settle it, which is what every
    // `needs-context` in this engine owes its caller.
    expect(contextRequestsOf(asked)[0]?.satisfyWith).toContain('rollInitiativeFor');
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
   * A rules refusal beats a missing fact. Asking for an Initiative total for
   * a creature that is already standing there would send the caller off to
   * establish something it was never going to use.
   */
  it('says what is wrong before it says what is missing', () => {
    const g = new Game().fight();
    const castingId = g.cast(WIZ, 'bless', [WIZ]);
    const refused = summonCreature(g.state, { id: FOE, monster: CONJURED_HOUND, by: WIZ, castingId });
    expect(isErr(refused) && refused.code).toBe('already_present');
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
    const SPRITE = id('sprite');
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

    expect(g.state.creatures[HOUND]).toBeUndefined();
    expect(g.state.creatures[SPRITE]).toBeUndefined();
  });
});
