import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, isErr, type CharacterId, type Result } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { CorruptLogError } from './fold/common.js';
import type { Placement } from './positioning.js';
import type { SpellDefinition } from './spell-definitions.js';
import { checkSpellDefinitionValue } from './spell-schema.js';
import { declaredCasting } from './spellcasting.js';
import {
  addCreature,
  advanceTime,
  pendingCastingsOf,
  resolveAttack,
  resolveDeclaredCast,
  resolveSpell,
  strandedSummons,
} from './commands.js';

/**
 * SRD Animate Dead: a bond that **lapses while the creature stays**.
 *
 * "Choose a pile of bones or a corpse of a Medium or Small Humanoid within
 * range. The target becomes an Undead creature: a Skeleton if you chose bones
 * or a Zombie if you chose a corpse … The creature is under your control for
 * 24 hours, after which it stops obeying any command you've given it. To
 * maintain control … you must cast this spell on the creature again before the
 * current 24-hour period ends … You animate or reassert control over two
 * additional Undead creatures for each spell slot level above 3."
 *
 * A kept bond is the wrong lifetime: a kept creature is owed a departure at 0
 * Hit Points, and a Zombie at 0 is a corpse the book leaves lying. So the
 * third `SummonBond` kind is **controlled** — a summoner and a clock reading —
 * and what runs out at the clock is the control, not the creature:
 * `strandedSummons` never names it, the fold's derived pass ends the bond when
 * `until` passes, and the creature is the table's, still in the scene.
 *
 * Every fold below is `fold(seed, events)` with no content, so a creature the
 * replay raises could only have been read out of the log.
 */

const id = (s: string) => asCharacterId(s);
const WIZ = id('wiz');
const RIVAL = id('rival');
const BANDIT = id('bandit');
const SECOND = id('second-bandit');
const BIG = id('big-bandit');
const LIVE = id('live-bandit');
const GHOUL = id('ghoul-1');

const DAY = 24 * 60 * 60;

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

const caster = (who: CharacterId, side: string): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 80,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side,
});

/** A Humanoid who dies at zero, as a stat block's does — a body waiting to be a corpse. */
const bandit = (who: CharacterId, size: 'medium' | 'large' = 'medium'): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet({ level: 1, abilities: { str: 11, dex: 12, con: 12, int: 10, wis: 10, cha: 10 } }),
  maxHp: 11,
  diesAtZero: true,
  creatureType: 'Humanoid',
  size,
  side: 'foes',
});

const killed = (who: CharacterId): GameEvent => ({ type: 'damage-taken', id: who, amount: 11, source: 'the fight before' });

const supply = (seed = 'rite') => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

const casting = (who: CharacterId, prepared: readonly string[]): readonly GameEvent[] => [
  {
    type: 'spellcasting-declared',
    id: who,
    spellcasting: declaredCasting({ ability: 'int', prepared }),
  },
  ...[1, 2, 3, 4, 5].map(
    (level): GameEvent => ({
      type: 'resource-pool-declared',
      id: who,
      pool: { key: `spell-slot:${level}`, label: `level ${level}`, max: 4, recovers: 'long-rest' },
    }),
  ),
];

const SETUP: readonly GameEvent[] = [
  caster(WIZ, 'party'),
  caster(RIVAL, 'party'),
  bandit(BANDIT),
  bandit(SECOND),
  bandit(BIG, 'large'),
  bandit(LIVE),
  ...casting(WIZ, ['animate-dead', 'detect-magic']),
  ...casting(RIVAL, ['animate-dead']),
  { type: 'scene-set', extent: { width: 600, depth: 600, height: 40 } },
  { type: 'landmark-added', name: 'the crypt', at: { x: 200, y: 200, z: 0 } },
  { type: 'creature-placed', id: WIZ, placement: { from: { landmark: 'the crypt' }, feet: 0 } },
  // Beside the wizard, so the same corpses are inside both casters' ten feet.
  { type: 'creature-placed', id: RIVAL, placement: { from: { creature: WIZ }, feet: 5, bearing: 315 } },
  { type: 'creature-placed', id: BANDIT, placement: { from: { creature: WIZ }, feet: 5, bearing: 0 } },
  { type: 'creature-placed', id: SECOND, placement: { from: { creature: WIZ }, feet: 5, bearing: 90 } },
  { type: 'creature-placed', id: BIG, placement: { from: { creature: WIZ }, feet: 10, bearing: 180 } },
  { type: 'creature-placed', id: LIVE, placement: { from: { creature: WIZ }, feet: 5, bearing: 225 } },
  killed(BANDIT),
  killed(SECOND),
  killed(BIG),
];

interface Rite {
  readonly targets?: readonly CharacterId[];
  readonly bonesAt?: readonly Placement[];
  readonly slotLevel?: number;
}

const KNOWN = new Set<string>([WIZ, RIVAL, BANDIT, SECOND, BIG, LIVE, GHOUL]);

class Game {
  constructor(readonly events: GameEvent[] = [...SETUP]) {}

  get state(): GameState {
    return fold('seed', this.events);
  }

  push(more: readonly GameEvent[]): this {
    this.events.push(...more);
    return this;
  }

  /** A live Ghoul out of the bestiary, five feet from the wizard and nobody's. */
  withGhoul(): this {
    this.push(unwrap(addCreature(this.state, SRD_CONTENT, GHOUL, 'ghoul'), 'a ghoul').events);
    return this.push([
      { type: 'creature-placed', id: GHOUL, placement: { from: { creature: WIZ }, feet: 5, bearing: 270 } },
    ]);
  }

  /** Declare the minute-long rite, let the minute pass, and settle it. */
  animate(rite: Rite = {}, by: CharacterId = WIZ): Result<readonly GameEvent[]> {
    const declared = resolveSpell(
      this.state,
      by,
      {
        spellId: 'animate-dead',
        targets: rite.targets ?? [],
        slotLevel: rite.slotLevel ?? 3,
        ...(rite.bonesAt === undefined ? {} : { bonesAt: rite.bonesAt }),
      },
      supply(),
    );
    if (!declared.ok) return declared;
    this.push(declared.value.events);
    this.push(unwrap(advanceTime(this.state, 60, 'the rite'), 'the minute'));
    const open = pendingCastingsOf(this.state).find((pending) => pending.caster === by);
    if (open === undefined) throw new Error('the rite was not declared');
    const settled = resolveDeclaredCast(this.state, open.castingId, supply('settle'));
    if (!settled.ok) return settled;
    this.push(settled.value.events);
    return { ok: true, value: settled.value.events };
  }

  /** Every creature a casting put in the world, whatever the engine called them. */
  raised(): readonly CharacterId[] {
    return (Object.keys(this.state.creatures) as CharacterId[]).filter((key) => !KNOWN.has(key)).sort();
  }

  one(): CharacterId {
    const [who, ...rest] = this.raised();
    if (who === undefined || rest.length > 0) throw new Error(`expected one raised creature, got ${this.raised().join(', ')}`);
    return who;
  }
}

/** The log through JSON and back, so nothing in memory can be helping. */
const replayed = (log: readonly GameEvent[]): GameState =>
  fold('seed', JSON.parse(JSON.stringify(log)) as GameEvent[]);

describe('a corpse becomes a Zombie under the caster’s control', () => {
  it('raises a Zombie where the bandit fell, on the wizard’s side, controlled for a day', () => {
    const g = new Game();
    const where = g.state.scene!.positions[BANDIT];
    unwrap(g.animate({ targets: [BANDIT] }), 'the rite');

    const zombie = g.one();
    const creature = g.state.creatures[zombie]!;
    expect(creature.name).toBe('Zombie');
    expect(creature.creatureType).toBe('Undead');
    expect(creature.side).toBe('party');
    // "The target becomes an Undead creature": the corpse's key leaves and the
    // Zombie's arrives, in the space the body was lying in.
    //
    // **A bestiary corpse, so its key leaves.** The owner's ruling of
    // 2026-09-26 keeps the record of a *player character's* corpse — see
    // `a-body-that-keeps-its-name.test.ts` — and the Bandit is not one: it
    // leaves the roster as it always has, and the Zombie remembers no body.
    // Widening the ruling to every corpse is `keepsItsRecord` in
    // `commands/spell-effect-summon.ts`, and flips these two lines.
    expect(g.state.creatures[BANDIT]).toBeUndefined();
    expect(creature.raisedFrom).toBeNull();
    expect(g.state.scene!.positions[zombie]).toEqual(where);
    // The bond: a summoner and a clock reading, no casting and nothing kept.
    expect(creature.summonedBy).toEqual({
      by: WIZ,
      castingId: null,
      controlled: { spell: 'animate-dead', until: g.state.elapsed + DAY },
    });
    expect(strandedSummons(g.state)).toEqual([]);
    expect(replayed(g.events)).toEqual(g.state);
  });

  it('lets the wizard take the Zombie’s turn, which is what commanding it is', () => {
    const g = new Game().withGhoul();
    unwrap(g.animate({ targets: [BANDIT] }), 'the rite');
    const zombie = g.one();
    const swing = resolveAttack(g.state, zombie, { target: GHOUL, weapon: null }, supply('slam'));
    expect(swing.ok, isErr(swing) ? swing.reason : '').toBe(true);
    if (swing.ok) {
      expect(swing.value.events.some((e) => e.type === 'roll-recorded')).toBe(true);
    }
  });

  it('leaves a Zombie at 0 Hit Points lying as a corpse, dismissing nothing', () => {
    const g = new Game();
    unwrap(g.animate({ targets: [BANDIT] }), 'the rite');
    const zombie = g.one();
    g.push([{ type: 'damage-taken', id: zombie, amount: 40, source: 'a greataxe' }]);

    expect(g.state.creatures[zombie]?.vitals.dead).toBe(true);
    // A kept creature would be owed a departure here; a controlled one is not.
    expect(strandedSummons(g.state)).toEqual([]);
    expect(g.state.creatures[zombie]?.summonedBy?.controlled).toBeDefined();
  });

  it('ends the control when the day passes and leaves the creature in the scene', () => {
    const g = new Game();
    unwrap(g.animate({ targets: [BANDIT] }), 'the rite');
    const zombie = g.one();
    const until = g.state.creatures[zombie]!.summonedBy!.controlled!.until;

    g.push(unwrap(advanceTime(g.state, until - g.state.elapsed - 1, 'a long day'), 'almost'));
    expect(g.state.creatures[zombie]?.summonedBy?.controlled?.until).toBe(until);

    g.push(unwrap(advanceTime(g.state, 1, 'the last second'), 'the day'));
    expect(g.state.creatures[zombie]).toBeDefined();
    expect(g.state.creatures[zombie]?.summonedBy).toBeNull();
    expect(g.state.scene!.positions[zombie]).toBeDefined();
    expect(replayed(g.events)).toEqual(g.state);
  });

  it('renews the control on a recast, with no second creature', () => {
    const g = new Game();
    unwrap(g.animate({ targets: [BANDIT] }), 'the first rite');
    const zombie = g.one();
    const first = g.state.creatures[zombie]!.summonedBy!.controlled!.until;

    g.push(unwrap(advanceTime(g.state, 12 * 60 * 60, 'half a day'), 'noon'));
    const again = unwrap(g.animate({ targets: [zombie] }), 'the second rite');

    expect(again.filter((e) => e.type === 'creature-summoned')).toEqual([]);
    expect(again.filter((e) => e.type === 'creature-added')).toEqual([]);
    const renewed = again.find((e) => e.type === 'summons-control-renewed');
    expect(renewed).toMatchObject({ id: zombie, by: WIZ, until: g.state.elapsed + DAY });
    expect(g.raised()).toEqual([zombie]);
    expect(g.state.creatures[zombie]!.summonedBy!.controlled!.until).toBe(g.state.elapsed + DAY);
    expect(g.state.creatures[zombie]!.summonedBy!.controlled!.until).toBeGreaterThan(first);
    expect(replayed(g.events)).toEqual(g.state);
  });
});

describe('the count is the slot’s', () => {
  const bones = (bearing: number): Placement => ({ from: { creature: WIZ }, feet: 5, bearing });

  it('raises three at level 4: a corpse and two piles of bones at stated points', () => {
    const g = new Game();
    unwrap(g.animate({ targets: [BANDIT], bonesAt: [bones(45), bones(135)], slotLevel: 4 }), 'the rite');

    const raised = g.raised().map((who) => g.state.creatures[who]!);
    expect(raised.map((c) => c.name).sort()).toEqual(['Skeleton', 'Skeleton', 'Zombie']);
    for (const creature of raised) {
      expect(creature.summonedBy).toEqual({
        by: WIZ,
        castingId: null,
        controlled: { spell: 'animate-dead', until: g.state.elapsed + DAY },
      });
      expect(g.state.scene!.positions[creature.id]).toBeDefined();
    }
    expect(replayed(g.events)).toEqual(g.state);
  });

  it('refuses a second at level 3', () => {
    const g = new Game();
    const refused = g.animate({ targets: [BANDIT], bonesAt: [bones(45)], slotLevel: 3 });
    expect(isErr(refused) && refused.code).toBe('too_many_raised');
    expect(g.raised()).toEqual([]);
  });

  it('counts a reassertion mixed with an animation against the animating arm', () => {
    const g = new Game();
    unwrap(g.animate({ targets: [BANDIT] }), 'the first rite');
    const zombie = g.one();
    const refused = g.animate({ targets: [zombie, SECOND], slotLevel: 3 });
    expect(isErr(refused) && refused.code).toBe('too_many_targets');
  });

  /**
   * SRD: "This use of the spell reasserts your control over **up to four**
   * creatures you have animated with this spell rather than animating a new
   * creature." A level 5 rite raises five; a level 3 recast that only
   * reasserts reaches four of them and not the fifth.
   */
  it('reasserts up to four at level 3 when the casting animates nothing', () => {
    const g = new Game();
    unwrap(
      g.animate({ targets: [BANDIT, SECOND], bonesAt: [bones(45), bones(135), bones(270)], slotLevel: 5 }),
      'the great rite',
    );
    const five = g.raised();
    expect(five).toHaveLength(5);

    const refused = g.animate({ targets: five, slotLevel: 3 });
    expect(isErr(refused) && refused.code).toBe('too_many_targets');

    g.push(unwrap(advanceTime(g.state, 3600, 'an hour'), 'an hour'));
    const four = five.slice(0, 4);
    const fifthsClock = g.state.creatures[five[4]!]!.summonedBy!.controlled!.until;
    const renewed = unwrap(g.animate({ targets: four, slotLevel: 3 }), 'the reassertion');
    expect(renewed.filter((e) => e.type === 'summons-control-renewed').map((e) => (e as { id: string }).id).sort()).toEqual(four);
    expect(renewed.filter((e) => e.type === 'creature-added')).toEqual([]);
    for (const who of four) {
      expect(g.state.creatures[who]?.summonedBy?.controlled?.until).toBe(g.state.elapsed + DAY);
    }
    // The fifth keeps the clock the great rite gave it.
    expect(g.state.creatures[five[4]!]?.summonedBy?.controlled?.until).toBe(fifthsClock);
    expect(fifthsClock).toBeLessThan(g.state.elapsed + DAY);
    expect(replayed(g.events)).toEqual(g.state);
  });

  it('adds two per slot level above 3 to a pure reassertion too', () => {
    const g = new Game();
    unwrap(
      g.animate({ targets: [BANDIT, SECOND], bonesAt: [bones(45), bones(135), bones(270)], slotLevel: 5 }),
      'the great rite',
    );
    const five = g.raised();
    unwrap(g.animate({ targets: five, slotLevel: 4 }), 'six would be allowed; five are named');
    expect(g.raised()).toEqual(five);
  });

  it('refuses a casting that names neither a corpse nor bones, before anything is spent', () => {
    const g = new Game();
    const refused = g.animate({});
    expect(isErr(refused) && refused.code).toBe('nothing_to_raise');
    expect(g.state.creatures[WIZ]?.resources.pools['spell-slot:3']?.spent ?? 0).toBe(0);
  });

  it('refuses bones out of the spell’s reach', () => {
    const g = new Game();
    const refused = g.animate({ bonesAt: [{ from: { creature: WIZ }, feet: 15, bearing: 45 }] });
    expect(isErr(refused) && refused.code).toBe('out_of_range');
  });

  it('refuses bones on a spell that raises nothing from them', () => {
    const g = new Game();
    const refused = resolveSpell(
      g.state,
      WIZ,
      { spellId: 'detect-magic', targets: [], slotLevel: 1, bonesAt: [bones(45)] },
      supply(),
    );
    expect(isErr(refused) && refused.code).toBe('no_bones_to_raise');
  });
});

describe('what the target rule admits', () => {
  it('refuses a live Ghoul nobody controls: an Undead is not the Humanoid corpse the spell names', () => {
    const g = new Game().withGhoul();
    const refused = g.animate({ targets: [GHOUL] });
    expect(isErr(refused) && refused.code).toBe('wrong_creature_type');
  });

  it('refuses a live Humanoid nobody controls, naming the two things the spell is cast on', () => {
    const g = new Game();
    const refused = g.animate({ targets: [LIVE] });
    expect(isErr(refused) && refused.code).toBe('target_not_dead');
    expect(isErr(refused) && refused.reason).toContain('controls through it');
  });

  it('refuses a Zombie somebody else controls: to the wizard it is a live Undead, not a corpse', () => {
    const g = new Game();
    unwrap(g.animate({ targets: [BANDIT] }, RIVAL), 'the rival’s rite');
    const zombie = g.one();
    expect(g.state.creatures[zombie]?.summonedBy?.by).toBe(RIVAL);
    const refused = g.animate({ targets: [zombie] });
    expect(isErr(refused) && refused.code).toBe('wrong_creature_type');
    // And the rival, who controls it, renews it.
    unwrap(g.animate({ targets: [zombie] }, RIVAL), 'the rival’s second rite');
    expect(g.raised()).toEqual([zombie]);
  });

  it('refuses a Large corpse: the rule takes two sizes and no third', () => {
    const g = new Game();
    const refused = g.animate({ targets: [BIG] });
    expect(isErr(refused) && refused.code).toBe('wrong_creature_size');
  });

  it('refuses a corpse that was not a Humanoid', () => {
    const g = new Game().withGhoul();
    g.push([{ type: 'damage-taken', id: GHOUL, amount: 40, source: 'radiant fire' }]);
    expect(g.state.creatures[GHOUL]?.vitals.dead).toBe(true);
    const refused = g.animate({ targets: [GHOUL] });
    expect(isErr(refused) && refused.code).toBe('wrong_creature_type');
  });
});

describe('the fold holds the bond to one lifetime', () => {
  it('refuses a summons naming both a keeper and a controller', () => {
    const g = new Game();
    unwrap(g.animate({ targets: [BANDIT] }), 'the rite');
    const zombie = g.one();
    const log: GameEvent[] = [
      ...g.events.filter((e) => e.type !== 'creature-summoned'),
    ];
    expect(() =>
      fold('seed', [
        ...log,
        {
          type: 'creature-summoned',
          id: zombie,
          by: WIZ,
          kept: { spell: 'animate-dead', untilSummonerDies: false },
          controlled: { spell: 'animate-dead', until: 1000 },
        },
      ]),
    ).toThrow(CorruptLogError);
  });

  it('refuses a renewal of a control nobody holds', () => {
    const g = new Game();
    expect(() =>
      fold('seed', [
        ...g.events,
        { type: 'summons-control-renewed', id: SECOND, by: WIZ, until: 1000 },
      ]),
    ).toThrow(CorruptLogError);
  });

  it('refuses a renewal by somebody who does not hold the control', () => {
    const g = new Game();
    unwrap(g.animate({ targets: [BANDIT] }, RIVAL), 'the rival’s rite');
    const zombie = g.one();
    expect(() =>
      fold('seed', [
        ...g.events,
        { type: 'summons-control-renewed', id: zombie, by: WIZ, until: g.state.elapsed + DAY },
      ]),
    ).toThrow(/controlled by rival; wiz cannot renew/);
  });
});

describe('the validator holds the vocabulary', () => {
  // Judged as untyped input, which is how a homebrew definition arrives and
  // the pass the placement rules run in.
  const problems = (definition: SpellDefinition): readonly string[] =>
    checkSpellDefinitionValue(definition).map((problem) => problem.code);

  const RAISE: SpellDefinition = {
    id: 'raise-the-fallen',
    name: 'Raise the Fallen',
    level: 3,
    school: 'necromancy',
    castingTime: 'action',
    concentration: false,
    range: { kind: 'ranged', feet: 10 },
    targets: { count: 1, optional: true, mustBeDead: true, orControlled: true },
    effects: [{ kind: 'raise', fromCorpse: 'zombie', controlSeconds: 86400 }],
  };

  it('accepts the shape Animate Dead is written in', () => {
    expect(problems(RAISE)).toEqual([]);
  });

  it('refuses a control span that is not a whole positive number of seconds', () => {
    for (const controlSeconds of [0, -1, 1.5, 'a day']) {
      expect(
        problems({ ...RAISE, effects: [{ kind: 'raise', fromCorpse: 'zombie', controlSeconds } as never] }),
      ).toContain('bad_control_span');
    }
  });

  it('refuses a reassert count that is not a whole positive number', () => {
    for (const reassertsUpTo of [0, 2.5, 'four']) {
      expect(
        problems({
          ...RAISE,
          effects: [{ kind: 'raise', fromCorpse: 'zombie', controlSeconds: 86400, reassertsUpTo } as never],
        }),
      ).toContain('bad_reassert_count');
    }
  });

  it('refuses the controlled admission on a spell that raises nothing', () => {
    expect(problems({ ...RAISE, effects: [] })).toContain('controlled_without_a_raise');
  });

  /**
   * A raising inside a printed branch would be counted against a target rule
   * the branch is never sized off and placed by a request the branch never
   * reads — the same placement rule `summon` and `preserves` keep, on the
   * same seam.
   */
  it('refuses a raising anywhere but the casting’s own list', () => {
    expect(
      problems({
        ...RAISE,
        // Without the admission, which is a definition-level refusal of its
        // own (`controlled_without_a_raise`) and would end validation before
        // the branches are walked.
        targets: { count: 1, optional: true, mustBeDead: true },
        effects: [],
        options: {
          raise: { label: 'Raise', effects: [{ kind: 'raise', fromCorpse: 'zombie', controlSeconds: 86400 }] },
          leave: { label: 'Leave it', handsOver: ['the body lies'] },
        },
      }),
    ).toContain('raise_outside_the_casting');
  });

  it('holds a size list to the six sizes, and refuses an empty one', () => {
    const sized = (mustBeSize: unknown) =>
      problems({ ...RAISE, targets: { ...RAISE.targets, mustBeSize } } as SpellDefinition);
    expect(sized(['small', 'medium'])).toEqual([]);
    expect(sized([])).toContain('unknown_size');
    expect(sized(['small', 'itsy'])).toContain('unknown_size');
  });
});
