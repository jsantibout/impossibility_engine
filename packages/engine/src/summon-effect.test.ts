import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, isErr, type CharacterId } from '@ie/shared';
import type { Monster } from '@ie/srd';
import type { CharacterSheet } from './character.js';
import { extendContent } from './content.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { declaredCasting } from './spellcasting.js';
import type { SpellDefinition } from './spell-definitions.js';
import { checkSpellDefinition, checkSpellDefinitionValue } from './spell-schema.js';
import {
  dismissStrandedSummons,
  endOngoingSpell,
  resolveSpell,
  resolveTurn,
  strandedSummons,
} from './commands.js';

/**
 * The level that was missing: a casting that **derives** its creature from the
 * spell.
 *
 * `summonCreature` and `dismissStrandedSummons` were built and shipped, and a
 * caller still had to cast, read the casting id back out of the outcome, and
 * summon by hand — so the engine never knew that a spell was the reason a
 * creature was standing there until somebody told it twice. The `summon`
 * effect kind is that one level, and this file is what it has to get right:
 *
 * - **The stat block is the catalogue's and the numbers are pinned.** Every
 *   fold below is `fold(seed, events)` with no content at all, and the stat
 *   block reaches the casting through `extendContent` — the homebrew door — so
 *   a creature the replay raises could only have been read out of the log.
 * - **The two numbers SRD Find Steed scales are computed once, at the cast.**
 *   "AC 10 + 1 per spell level" is arithmetic over the level the slot paid
 *   for, and what reaches the log is the answer rather than the formula.
 * - **The bond is written after the record it depends on.** The fold refuses a
 *   `creature-summoned` naming a casting that is not running, and a casting's
 *   `spell-ongoing` record is written *after* its effects resolve — so a
 *   summon that emitted the bond inside the effect loop would produce a log
 *   that cannot be folded. A spell that leaves nothing running binds nothing,
 *   which is SRD Animate Dead's skeleton and SRD Find Steed's steed.
 */

const id = (s: string) => asCharacterId(s);
const WIZ = id('wiz');
const FOE = id('foe');

/**
 * A stat block the SRD never printed, entering the way homebrew enters.
 *
 * Its Armour Class and hit points are deliberately unremarkable numbers, so
 * that the scaled casting below cannot be passing by accident.
 */
const SPIRIT_STAG: Monster = {
  id: 'spirit-stag',
  name: 'Spirit Stag',
  size: 'large',
  alternateSizes: [],
  type: 'Fey',
  subtype: null,
  swarmMemberSize: null,
  alignment: 'Unaligned',
  ac: 13,
  initiative: 1,
  hp: { average: 19, formula: '3d10 + 3' },
  speed: { walk: 50, burrow: null, climb: null, fly: null, swim: null, hover: false },
  abilities: {
    str: { score: 16, modifier: 3, save: 3 },
    dex: { score: 13, modifier: 1, save: 1 },
    con: { score: 12, modifier: 1, save: 1 },
    int: { score: 4, modifier: -3, save: -3 },
    wis: { score: 12, modifier: 1, save: 1 },
    cha: { score: 8, modifier: -1, save: -1 },
  },
  skills: {},
  vulnerabilities: [],
  resistances: ['cold'],
  immunities: [],
  gear: [],
  senses: [],
  passivePerception: 11,
  languages: [],
  cr: 1,
  crLabel: '1',
  xp: 200,
  proficiencyBonus: 2,
  traits: [],
  actions: [],
  bonusActions: [],
  reactions: [],
  legendaryActions: [],
};

/** A summons the casting holds here: the steed goes when the hour is up. */
const CALL_THE_STAG: SpellDefinition = {
  id: 'call-the-stag',
  name: 'Call the Stag',
  level: 2,
  school: 'conjuration',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 30 },
  targets: { count: 1, self: true },
  effects: [{ kind: 'summon', monster: 'spirit-stag' }],
  durationSeconds: 3600,
};

/** SRD Find Steed's shape: Instantaneous, and two numbers the slot scales. */
const BIND_THE_STAG: SpellDefinition = {
  id: 'bind-the-stag',
  name: 'Bind the Stag',
  level: 2,
  school: 'conjuration',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 30 },
  targets: { count: 1, self: true },
  effects: [
    {
      kind: 'summon',
      monster: 'spirit-stag',
      armorClass: { base: 10, perSpellLevel: 1 },
      hitPoints: { base: 5, perSpellLevel: 10 },
      sharesCastersInitiative: true,
    },
  ],
};

const CONTENT = unwrap(
  extendContent(SRD_CONTENT, {
    monsters: [SPIRIT_STAG],
    spells: [CALL_THE_STAG, BIND_THE_STAG],
  }),
  'the stag and its two spells beside the book',
);

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
  content: CONTENT,
});

const SETUP: readonly GameEvent[] = [
  added(WIZ, 'party'),
  added(FOE, 'foes'),
  {
    type: 'spellcasting-declared',
    id: WIZ,
    spellcasting: declaredCasting({
      ability: 'int',
      prepared: ['call-the-stag', 'bind-the-stag'],
    }),
  },
  ...[1, 2, 3, 4, 5].map(
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

class Game {
  constructor(readonly events: GameEvent[] = [...SETUP]) {}

  get state(): GameState {
    return fold('seed', this.events);
  }

  push(more: readonly GameEvent[]): this {
    this.events.push(...more);
    return this;
  }

  cast(spellId: string, slotLevel?: number): string {
    const out = unwrap(
      resolveSpell(
        this.state,
        WIZ,
        { spellId, targets: [WIZ], ...(slotLevel === undefined ? {} : { slotLevel }) },
        supply(spellId),
      ),
      `${WIZ} casting ${spellId}`,
    );
    this.push(out.events);
    return out.castingId!;
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

/** The log through JSON and back, so nothing in memory can be helping. */
const replayed = (log: readonly GameEvent[]): GameState =>
  fold('seed', JSON.parse(JSON.stringify(log)) as GameEvent[]);

/** The creature a casting put in the world, whatever the engine called it. */
const summonedIn = (state: GameState): CharacterId | undefined =>
  Object.keys(state.creatures).find((key) => key !== WIZ && key !== FOE) as
    | CharacterId
    | undefined;

describe('a casting derives its creature from the spell', () => {
  it('puts the stat block on the roster with every number pinned into the log', () => {
    const g = new Game();
    g.cast('call-the-stag');

    const who = summonedIn(g.state);
    expect(who).toBeDefined();
    const stag = replayed(g.events).creatures[who!];
    expect(stag?.name).toBe('Spirit Stag');
    expect(stag?.sheet.stated?.armorClass).toBe(13);
    expect(stag?.vitals.hpMax).toBe(19);
    expect(stag?.vitals.diesAtZero).toBe(true);
    expect(stag?.creatureType).toBe('Fey');
    expect(stag?.defenses['cold']).toEqual({ resistant: true });
    // SRD summons are the summoner's, which `summonCreature` already derived.
    expect(stag?.side).toBe('party');
  });

  it('binds it to a casting that is still running, and the log still folds', () => {
    const g = new Game();
    const castingId = g.cast('call-the-stag');
    const who = summonedIn(g.state)!;

    // The whole of the ordering claim: the bond names the casting, and a fold
    // that met it before the `spell-ongoing` record would have thrown.
    expect(replayed(g.events).creatures[who]?.summonedBy).toEqual({ by: WIZ, castingId });
    expect(strandedSummons(g.state)).toEqual([]);
  });

  it('strands it when the casting ends, and the sweep takes it away', () => {
    const g = new Game();
    const castingId = g.cast('call-the-stag');
    const who = summonedIn(g.state)!;

    g.push(unwrap(endOngoingSpell(g.state, WIZ, castingId, null), 'dismissing'));
    expect(strandedSummons(g.state)).toEqual([who]);

    g.push(unwrap(dismissStrandedSummons(g.state), 'sweeping'));
    expect(g.state.creatures[who]).toBeUndefined();
  });

  /**
   * The wedge the engine already refuses, driven through the effect: a turn
   * may not advance past a creature whose spell has ended.
   */
  it('stops the turn order until somebody sweeps', () => {
    const g = new Game().fight();
    const castingId = g.cast('call-the-stag');
    g.push(unwrap(endOngoingSpell(g.state, WIZ, castingId, null), 'dismissing'));

    const refused = resolveTurn(g.state, supply('turn'));
    expect(isErr(refused) && refused.code).toBe('summons_stranded');
  });

  /**
   * SRD Find Steed is Instantaneous and its steed is not on loan. A casting
   * that leaves nothing running has nothing to bind to, and the creature
   * outlives it — which is also the only shape the fold could accept.
   */
  it('binds nothing when the casting leaves nothing running', () => {
    const g = new Game();
    g.cast('bind-the-stag');
    const who = summonedIn(g.state)!;

    expect(g.state.creatures[who]?.summonedBy).toBeNull();
    expect(strandedSummons(g.state)).toEqual([]);
    g.push(unwrap(dismissStrandedSummons(g.state), 'sweeping'));
    expect(g.state.creatures[who]).toBeDefined();
  });
});

describe('the two numbers a spell prints over its own stat block', () => {
  it('computes them from the level the casting was made at', () => {
    const g = new Game();
    g.cast('bind-the-stag');
    const who = summonedIn(g.state)!;

    const stag = replayed(g.events).creatures[who];
    // 10 + 1 per spell level, 5 + 10 per spell level, at level 2.
    expect(stag?.sheet.stated?.armorClass).toBe(12);
    expect(stag?.vitals.hpMax).toBe(25);
  });

  it('scales with the slot that paid for it', () => {
    const g = new Game();
    g.cast('bind-the-stag', 5);
    const who = summonedIn(g.state)!;

    const stag = replayed(g.events).creatures[who];
    expect(stag?.sheet.stated?.armorClass).toBe(15);
    expect(stag?.vitals.hpMax).toBe(55);
  });

  it('leaves the block’s own numbers alone for a spell that prints none', () => {
    const g = new Game();
    g.cast('call-the-stag', 4);
    const who = summonedIn(g.state)!;

    expect(g.state.creatures[who]?.sheet.stated?.armorClass).toBe(13);
    expect(g.state.creatures[who]?.vitals.hpMax).toBe(19);
  });
});

describe('SRD Find Steed’s "it shares your Initiative count"', () => {
  it('seats it on the caster’s own rung of a running order', () => {
    const g = new Game().fight();
    g.cast('bind-the-stag');
    const who = summonedIn(g.state)!;

    const rung = g.state.combat?.order.find((c) => c.id === who);
    expect(rung?.initiative).toBe(20);
  });

  /**
   * And it settles the **tie** on that count for nobody, which is the half of
   * SRD's sentence this deliberately does not deliver: `Combatant.tiebreak`
   * takes a DM's decision as an input rather than inventing one.
   *
   * The rider is given a tiebreak of its own here so the assertion can tell
   * three rules apart that agree on a default board — the steed taking the
   * default (what the code does), the steed *copying* its rider, and the steed
   * being seated one below it (what was tried and reverted). Only the first
   * passes.
   */
  it('settles the tie on that count for nobody', () => {
    const g = new Game().push([
      {
        type: 'combat-started',
        combatants: [
          { id: WIZ, initiative: 20, speed: 30, tiebreak: 3 },
          { id: FOE, initiative: 5, speed: 30 },
        ],
      },
    ]);
    g.cast('bind-the-stag');
    const who = summonedIn(g.state)!;

    const rung = g.state.combat?.order.find((c) => c.id === who);
    expect(rung).toBeDefined();
    expect(rung?.initiative).toBe(20);
    expect(rung?.tiebreak).toBe(0);
  });

  /**
   * And what that leaves, said out loud, because the spell's `unmodelled`
   * claims exactly this width: with nobody else on the rider's count,
   * `addCombatant` seats a joiner after everyone it exactly ties with, so the
   * steed's turn *does* fall immediately after its rider's. What is missing is
   * the guarantee, not the behaviour — a third creature on that count comes
   * between them, and no rung can say "after this creature".
   */
  it('lands after its rider while nobody else shares the count', () => {
    const g = new Game().fight();
    g.cast('bind-the-stag');
    const who = summonedIn(g.state)!;

    const order = g.state.combat?.order.map((c) => c.id) ?? [];
    expect(order.indexOf(who)).toBe(order.indexOf(WIZ) + 1);

    // And the third creature that breaks it, which is the recorded gap.
    const crowded = new Game().push([
      {
        type: 'combat-started',
        combatants: [
          { id: WIZ, initiative: 20, speed: 30 },
          { id: FOE, initiative: 20, speed: 30 },
        ],
      },
    ]);
    crowded.cast('bind-the-stag');
    const there = summonedIn(crowded.state)!;
    const crowdedOrder = crowded.state.combat?.order.map((c) => c.id) ?? [];
    expect(crowdedOrder.indexOf(there)).toBe(crowdedOrder.indexOf(WIZ) + 2);
  });

  it('leaves it out of an order that is not running', () => {
    const g = new Game();
    g.cast('bind-the-stag');
    const who = summonedIn(g.state)!;

    expect(g.state.combat).toBeNull();
    expect(g.state.creatures[who]).toBeDefined();
  });

  it('seats a summons that does not share the count nowhere at all', () => {
    const g = new Game().fight();
    g.cast('call-the-stag');
    const who = summonedIn(g.state)!;

    expect(g.state.combat?.order.some((c) => c.id === who)).toBe(false);
  });
});

describe('the validator', () => {
  it('refuses an effect that names no stat block', () => {
    const problems = checkSpellDefinition({
      ...CALL_THE_STAG,
      effects: [{ kind: 'summon', monster: '' }],
    });
    expect(problems.map((p) => p.code)).toContain('unknown_monster');
  });

  it('refuses a scaled number that is not a pair of whole numbers', () => {
    const problems = checkSpellDefinition({
      ...BIND_THE_STAG,
      effects: [
        { kind: 'summon', monster: 'spirit-stag', armorClass: { base: 0, perSpellLevel: 1 } },
      ],
    });
    expect(problems.map((p) => p.code)).toContain('bad_summon_scaling');
  });

  /**
   * The bond is written after the casting's own record, and only the casting
   * has one to write it after — so a summons in an area trigger or an
   * activation would raise a creature nothing holds there.
   */
  it('refuses a summons anywhere but the casting’s own effect list', () => {
    const summon = { kind: 'summon', monster: 'spirit-stag' };
    const codes = (over: Record<string, unknown>): readonly string[] =>
      checkSpellDefinitionValue({ ...CALL_THE_STAG, ...over }).map((p) => p.code);

    expect(codes({ areaTrigger: { at: 'end-of-turn', label: 'again', effects: [summon] } })).toContain(
      'summon_outside_the_casting',
    );
    expect(
      codes({ activation: { action: 'action', label: 'again', range: { kind: 'self' }, effects: [summon] } }),
    ).toContain('summon_outside_the_casting');
    // And the casting's own list is where it belongs, so nothing is refused.
    expect(codes({})).toEqual([]);
  });

  /**
   * The creature is named for the casting rather than for the target, so two
   * targets would resolve one creature twice — and the second run would refuse
   * `already_present` and take the whole casting with it, naming a creature
   * nobody wrote. Refused at authoring instead.
   */
  it('refuses a summons aimed at anybody but its caster', () => {
    expect(
      checkSpellDefinition({ ...CALL_THE_STAG, targets: { count: 2, self: true } }).map(
        (p) => p.code,
      ),
    ).toContain('summon_over_several_targets');
    expect(
      checkSpellDefinition({ ...CALL_THE_STAG, targets: { count: 1 } }).map((p) => p.code),
    ).toContain('summon_not_on_its_caster');
    expect(checkSpellDefinition(CALL_THE_STAG)).toEqual([]);
  });

  it('refuses a casting whose stat block this world does not hold', () => {
    const world = unwrap(
      extendContent(SRD_CONTENT, {
        spells: [{ ...CALL_THE_STAG, effects: [{ kind: 'summon', monster: 'nothing-at-all' }] }],
      }),
      'a spell naming a block nobody holds',
    );
    const g = new Game();
    const refused = resolveSpell(
      g.state,
      WIZ,
      { spellId: 'call-the-stag', targets: [WIZ] },
      { issuer: createRollIssuer('r'), rng: createRng('x') as Rng, content: world },
    );
    expect(isErr(refused) && refused.code).toBe('unknown_monster');
  });
});
