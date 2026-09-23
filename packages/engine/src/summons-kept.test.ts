import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, isErr, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { extendContent } from './content.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { declaredCasting } from './spellcasting.js';
import type { SpellDefinition, SpellEffect } from './spell-definitions.js';
import { checkSpellDefinition } from './spell-schema.js';
import { actionRulesOn } from './standing.js';
import {
  damageCreature,
  dismissStrandedSummons,
  joinCombat,
  resolveAttack,
  resolveSpell,
  resolveTurn,
  strandedSummons,
  summonCreature,
} from './commands.js';

/**
 * A summons on the spell's terms: what SRD Find Familiar and Find Steed print
 * beyond "a creature appears".
 *
 * The `summon` effect kind raised a creature out of the bestiary, pinned its
 * numbers and bound it to the casting that holds it — and left four sentences
 * of the two spells a level 5 character actually casts unread:
 *
 * - **A lifetime that is not a casting's.** Both spells are Instantaneous, so
 *   nothing binds the creature and nothing takes it away. The book takes it
 *   away twice: "When the familiar drops to 0 Hit Points, it disappears";
 *   "The steed disappears if it drops to 0 Hit Points or if you die." That is
 *   a creature the caster *keeps*, bound to its summoner rather than to a
 *   spell, and it is the same debt `strandedSummons` already settles for a
 *   casting — asked of a different fact.
 * - **One at a time.** "If you cast this spell while you have a familiar, you
 *   instead cause it to adopt a new eligible form" / "If you already have a
 *   steed from this spell, the steed is replaced by the new one."
 * - **A form and a type chosen at the casting.** "an animal form you choose:
 *   Bat, Cat, … or another Beast that has a Challenge Rating of 0", "it is a
 *   Celestial, Fey, or Fiend (your choice) instead of a Beast".
 * - **What the spell prints over the block that is neither of the two
 *   computed numbers**: "Fly 60 ft. (requires level 4+ spell)", "A familiar
 *   can't attack", and a rung "immediately after yours".
 *
 * Every fold below is `fold(seed, events)` with no content, so a creature the
 * replay raises could only have been read out of the log.
 */

const id = (s: string) => asCharacterId(s);
const WIZ = id('wiz');
const FOE = id('foe');
const RIVAL = id('rival');

/** SRD Find Familiar's shape, over the SRD's own CR 0 Beasts. */
const CALL_A_COMPANION: SpellDefinition = {
  id: 'call-a-companion',
  name: 'Call a Companion',
  level: 1,
  school: 'conjuration',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 10 },
  targets: { count: 1, self: true },
  choiceStated: { of: 'creature-type', options: ['Celestial', 'Fey', 'Fiend'] },
  effects: [
    {
      kind: 'summon',
      monster: { among: ['cat', 'bat', 'owl'], orAny: { type: 'Beast', cr: 0 } },
      creatureType: 'Celestial',
      kept: {},
      cannotAttack: true,
    },
  ],
};

/** SRD Find Steed's shape: a mount the rider keeps, that goes when the rider does. */
const CALL_A_MOUNT: SpellDefinition = {
  id: 'call-a-mount',
  name: 'Call a Mount',
  level: 2,
  school: 'conjuration',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 30 },
  targets: { count: 1, self: true },
  effects: [
    {
      kind: 'summon',
      monster: 'riding-horse',
      kept: { untilSummonerDies: true },
      sharesCastersInitiative: true,
      speeds: { fly: { feet: 60, fromSpellLevel: 4 } },
    },
  ],
};

const CONTENT = unwrap(
  extendContent(SRD_CONTENT, { spells: [CALL_A_COMPANION, CALL_A_MOUNT] }),
  'the two summoning spells beside the book',
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
      prepared: ['call-a-companion', 'call-a-mount'],
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

interface CastExtras {
  readonly slotLevel?: number;
  readonly form?: string;
  readonly choice?: string;
}

class Game {
  constructor(readonly events: GameEvent[] = [...SETUP]) {}

  get state(): GameState {
    return fold('seed', this.events);
  }

  push(more: readonly GameEvent[]): this {
    this.events.push(...more);
    return this;
  }

  tryCast(spellId: string, extras: CastExtras = {}) {
    return resolveSpell(this.state, WIZ, { spellId, targets: [WIZ], ...extras }, supply(spellId));
  }

  cast(spellId: string, extras: CastExtras = {}): string {
    const out = unwrap(this.tryCast(spellId, extras), `${WIZ} casting ${spellId}`);
    this.push(out.events);
    return out.castingId!;
  }

  fight(tiebreak = 0): this {
    return this.push([
      {
        type: 'combat-started',
        combatants: [
          { id: WIZ, initiative: 15, speed: 30, tiebreak },
          { id: FOE, initiative: 5, speed: 30 },
        ],
      },
    ]);
  }
}

/** The log through JSON and back, so nothing in memory can be helping. */
const replayed = (log: readonly GameEvent[]): GameState =>
  fold('seed', JSON.parse(JSON.stringify(log)) as GameEvent[]);

const KNOWN = new Set<string>([WIZ, FOE, RIVAL]);

/** Every creature a casting put in the world, whatever the engine called them. */
const summonedIn = (state: GameState): readonly CharacterId[] =>
  (Object.keys(state.creatures) as CharacterId[]).filter((key) => !KNOWN.has(key)).sort();

const companion = (state: GameState): CharacterId => {
  const [who] = summonedIn(state);
  if (who === undefined) throw new Error('nothing was summoned');
  return who;
};

describe('a creature the caster keeps', () => {
  it('is bound to its summoner and to no casting, and the log still folds', () => {
    const g = new Game();
    g.cast('call-a-companion', { form: 'cat', choice: 'Fey' });
    const cat = companion(g.state);

    const state = replayed(g.events);
    expect(state.creatures[cat]?.name).toBe('Cat');
    expect(state.creatures[cat]?.summonedBy).toEqual({
      by: WIZ,
      castingId: null,
      kept: { spell: 'call-a-companion', untilSummonerDies: false },
    });
    // Nothing is running and nothing is owed: an Instantaneous casting left
    // no record, and the creature is the wizard's rather than a spell's.
    expect(Object.keys(state.ongoing)).toEqual([]);
    expect(strandedSummons(state)).toEqual([]);
  });

  it('is owed a departure when it drops to 0 Hit Points, and the sweep performs it', () => {
    const g = new Game();
    g.cast('call-a-companion', { form: 'cat', choice: 'Fey' });
    const cat = companion(g.state);

    g.push(unwrap(damageCreature(g.state, cat, { amount: 5 }), 'a boot'));
    expect(g.state.creatures[cat]?.vitals.hp).toBe(0);
    expect(strandedSummons(g.state)).toEqual([cat]);

    g.push(unwrap(dismissStrandedSummons(g.state), 'sweeping'));
    expect(g.state.creatures[cat]).toBeUndefined();
  });

  it('stops the turn order until somebody sweeps', () => {
    const g = new Game().fight();
    g.cast('call-a-companion', { form: 'cat', choice: 'Fey' });
    const cat = companion(g.state);
    g.push(unwrap(damageCreature(g.state, cat, { amount: 5 }), 'a boot'));

    const refused = resolveTurn(g.state, supply('turn'));
    expect(isErr(refused) && refused.code).toBe('summons_stranded');
  });

  it('goes when its summoner dies, where the spell says so', () => {
    const g = new Game();
    g.cast('call-a-mount');
    const horse = companion(g.state);
    expect(g.state.creatures[horse]?.summonedBy?.kept?.untilSummonerDies).toBe(true);
    expect(strandedSummons(g.state)).toEqual([]);

    // Massive Damage: the wizard is killed outright.
    g.push(unwrap(damageCreature(g.state, WIZ, { amount: 200 }), 'a boulder'));
    expect(g.state.creatures[WIZ]?.vitals.dead).toBe(true);
    expect(strandedSummons(g.state)).toEqual([horse]);
  });

  it('outlives a dead summoner where the spell says nothing about it', () => {
    const g = new Game();
    g.cast('call-a-companion', { form: 'owl', choice: 'Celestial' });
    const owl = companion(g.state);

    g.push(unwrap(damageCreature(g.state, WIZ, { amount: 200 }), 'a boulder'));
    expect(g.state.creatures[WIZ]?.vitals.dead).toBe(true);
    expect(strandedSummons(g.state)).toEqual([]);
    expect(g.state.creatures[owl]).toBeDefined();
  });

  it('is replaced when the spell is cast again', () => {
    const g = new Game();
    g.cast('call-a-companion', { form: 'cat', choice: 'Fey' });
    const cat = companion(g.state);

    const out = unwrap(g.tryCast('call-a-companion', { form: 'owl', choice: 'Fey' }), 'again');
    g.push(out.events);
    const [owl] = summonedIn(g.state);
    expect(summonedIn(g.state)).toHaveLength(1);
    expect(owl).not.toBe(cat);
    expect(g.state.creatures[owl!]?.name).toBe('Owl');
    // The departure is in the same batch as the arrival, and it is the
    // ordinary one: the old form leaves the map, the order and the cast.
    expect(out.events.some((e) => e.type === 'creature-removed' && e.id === cat)).toBe(true);
    expect(replayed(g.events).creatures[cat]).toBeUndefined();
  });

  it('replaces only its own: a mount and a companion stand together', () => {
    const g = new Game();
    g.cast('call-a-companion', { form: 'cat', choice: 'Fey' });
    g.cast('call-a-mount');
    expect(summonedIn(g.state)).toHaveLength(2);
  });
});

describe('a form chosen at the casting', () => {
  it('raises the block the caster named, out of the printed list', () => {
    const g = new Game();
    g.cast('call-a-companion', { form: 'bat', choice: 'Fey' });
    expect(g.state.creatures[companion(g.state)]?.name).toBe('Bat');
  });

  it('accepts any block the spell’s wider clause admits', () => {
    // "or another Beast that has a Challenge Rating of 0" — a Badger is one.
    const g = new Game();
    g.cast('call-a-companion', { form: 'badger', choice: 'Fey' });
    expect(g.state.creatures[companion(g.state)]?.name).toBe('Badger');
  });

  it('refuses a block outside both the list and the clause', () => {
    const g = new Game();
    // A Wolf is a Beast of CR 1/4; a Goblin is CR 1/4 and not a Beast.
    for (const form of ['wolf', 'goblin-warrior']) {
      const refused = g.tryCast('call-a-companion', { form, choice: 'Fey' });
      expect(isErr(refused) && refused.code).toBe('form_not_offered');
    }
  });

  it('refuses a block the world does not hold', () => {
    const g = new Game();
    const refused = g.tryCast('call-a-companion', { form: 'sky-whale', choice: 'Fey' });
    expect(isErr(refused) && refused.code).toBe('unknown_monster');
  });

  it('refuses to choose the form on the caster’s behalf', () => {
    const g = new Game();
    const refused = g.tryCast('call-a-companion', { choice: 'Fey' });
    expect(isErr(refused) && refused.code).toBe('form_required');
  });

  it('refuses a form for a spell whose block is fixed', () => {
    const g = new Game();
    const refused = g.tryCast('call-a-mount', { form: 'cat' });
    expect(isErr(refused) && refused.code).toBe('no_form_clause');
  });
});

describe('a creature type chosen at the casting', () => {
  it('pins the chosen type into the arrival instead of the block’s own', () => {
    const g = new Game();
    g.cast('call-a-companion', { form: 'cat', choice: 'Fiend' });
    const cat = companion(g.state);
    expect(replayed(g.events).creatures[cat]?.creatureType).toBe('Fiend');
  });

  it('is required and must be one the spell prints', () => {
    const g = new Game();
    const missing = g.tryCast('call-a-companion', { form: 'cat' });
    expect(isErr(missing) && missing.code).toBe('choice_required');
    const wrong = g.tryCast('call-a-companion', { form: 'cat', choice: 'Undead' });
    expect(isErr(wrong) && wrong.code).toBe('unknown_choice');
  });

  it('leaves the block’s type alone where the spell prints no choice', () => {
    const g = new Game();
    g.cast('call-a-mount');
    expect(g.state.creatures[companion(g.state)]?.creatureType).toBe('Beast');
  });
});

describe('what the spell prints over its block', () => {
  it('forbids the creature to attack, and says which spell forbade it', () => {
    const g = new Game();
    g.cast('call-a-companion', { form: 'cat', choice: 'Fey' });
    const cat = companion(g.state);
    // The rule is the creature's own for as long as it stands, sourced to the
    // summons rather than to a casting there is no record of.
    const rules = actionRulesOn(g.state, cat);
    expect(rules.map((one) => one.label)).toEqual(['Call a Companion']);
    expect(rules[0]?.rule).toEqual({ kind: 'forbids', actions: ['attack', 'opportunity-attack'] });

    // A rule on the action economy bites where the economy is charged: in a
    // fight, on the creature's own turn. The cat wins Initiative.
    g.push([
      {
        type: 'creature-placed',
        id: cat,
        placement: { from: { creature: FOE }, feet: 5, bearing: 0 },
      },
      {
        type: 'combat-started',
        combatants: [
          { id: cat, initiative: 20, speed: 40 },
          { id: WIZ, initiative: 15, speed: 30 },
          { id: FOE, initiative: 5, speed: 30 },
        ],
      },
    ]);
    const swing = resolveAttack(g.state, cat, { target: FOE, weapon: null }, supply('claw'));
    expect(isErr(swing) && swing.code).toBe('action_forbidden');
    expect(isErr(swing) && swing.reason).toContain('Call a Companion');
  });

  it('lets a mount attack, where the spell forbids nothing', () => {
    const g = new Game();
    g.cast('call-a-mount');
    expect(actionRulesOn(g.state, companion(g.state))).toEqual([]);
  });

  it('withholds a Speed gated on a slot the casting did not pay for', () => {
    const g = new Game();
    g.cast('call-a-mount', { slotLevel: 2 });
    expect(g.state.creatures[companion(g.state)]?.sheet.speeds?.fly).toBeUndefined();
  });

  it('grants the Speed once the slot is big enough, pinned into the arrival', () => {
    const g = new Game();
    g.cast('call-a-mount', { slotLevel: 4 });
    const horse = companion(g.state);
    expect(replayed(g.events).creatures[horse]?.sheet.speeds?.fly).toBe(60);
    // The walking Speed is still the block's.
    expect(replayed(g.events).creatures[horse]?.sheet.baseSpeed).toBe(60);
  });
});

describe('a rung immediately after the rider', () => {
  /**
   * SRD Find Steed: "it shares your Initiative count … the steed takes its turn
   * immediately after yours." A creature the DM put on the rider's count at
   * the rider's own tiebreak, and seated before the steed arrived, used to
   * come between the two; a position is not a number.
   */
  it('seats the mount after its rider even when a third creature ties the rider exactly', () => {
    const g = new Game().fight(5);
    g.push([
      added(RIVAL, 'foes'),
      {
        type: 'combatant-joined',
        combatant: { id: RIVAL, initiative: 15, speed: 30, tiebreak: 5 },
      },
    ]);
    expect(g.state.combat?.order.map((c) => c.id)).toEqual([WIZ, RIVAL, FOE]);

    g.cast('call-a-mount');
    const horse = companion(g.state);
    const order = replayed(g.events).combat?.order;
    expect(order?.map((c) => c.id)).toEqual([WIZ, horse, RIVAL, FOE]);
    expect(order?.[1]).toMatchObject({ initiative: 15, tiebreak: 5, after: WIZ });
  });

  it('keeps the mount behind its rider when a later joiner ties them too', () => {
    const g = new Game().fight(5);
    g.cast('call-a-mount');
    const horse = companion(g.state);
    g.push([
      added(RIVAL, 'foes'),
      {
        type: 'combatant-joined',
        combatant: { id: RIVAL, initiative: 15, speed: 30, tiebreak: 5 },
      },
    ]);
    expect(g.state.combat?.order.map((c) => c.id)).toEqual([WIZ, horse, RIVAL, FOE]);
  });

  it('arrives with no rung when no fight is running, exactly as before', () => {
    const g = new Game();
    g.cast('call-a-mount');
    expect(g.state.combat).toBeNull();
  });
});

describe('the door a DM summons through', () => {
  it('refuses a creature with two lifetimes', () => {
    const g = new Game();
    // A running casting to hold it: the wizard's own Mage-Armor-shaped spell
    // is not in this book, so the mount's casting stands in — it leaves no
    // record, which is the point: the refusal is about the *request*.
    const refused = summonCreature(g.state, CONTENT, {
      id: id('doubly-bound'),
      monsterId: 'cat',
      by: WIZ,
      castingId: 'cast:1',
      kept: { spell: 'call-a-companion', untilSummonerDies: false },
    });
    expect(isErr(refused) && refused.code).toBe('two_lifetimes');
  });

  it('refuses a seat after a combatant who is not in the fight', () => {
    const g = new Game().fight();
    g.push([added(RIVAL, 'foes')]);
    const refused = joinCombat(g.state, {
      id: RIVAL,
      initiative: 15,
      speed: 30,
      after: id('nobody'),
    });
    expect(isErr(refused) && refused.code).toBe('unknown_anchor');
  });
});

describe('the validator', () => {
  const summonWith = (over: Record<string, unknown>, definition: Partial<SpellDefinition> = {}) =>
    checkSpellDefinition({
      ...CALL_A_MOUNT,
      ...definition,
      effects: [{ ...(CALL_A_MOUNT.effects[0] as object), ...over } as SpellEffect],
    }).map((problem) => problem.code);

  it('accepts both spells as written', () => {
    expect(checkSpellDefinition(CALL_A_COMPANION)).toEqual([]);
    expect(checkSpellDefinition(CALL_A_MOUNT)).toEqual([]);
  });

  it('refuses a kept creature on a casting that also leaves a record running', () => {
    // Two lifetimes: the casting's hour and the summoner's life.
    expect(summonWith({}, { durationSeconds: 3600 })).toContain('kept_beside_a_duration');
    expect(summonWith({}, { concentration: true })).toContain('kept_beside_a_duration');
  });

  it('refuses a stated form that lists nothing, or a clause naming no creature type', () => {
    expect(summonWith({ monster: { among: [] } })).toContain('empty_form_list');
    expect(summonWith({ monster: { among: ['cat'], orAny: { type: 'Goose', cr: 0 } } })).toContain(
      'unknown_creature_type',
    );
  });

  it('refuses a creature type the book does not print, and a Speed with no feet', () => {
    expect(summonWith({ creatureType: 'Goose' })).toContain('unknown_creature_type');
    expect(summonWith({ speeds: { fly: { fromSpellLevel: 4 } } })).toContain('bad_summon_speed');
    expect(summonWith({ cannotAttack: false })).toContain('malformed_field');
  });

  it('refuses a creature-type choice that reaches no summons', () => {
    const codes = checkSpellDefinition({
      ...CALL_A_COMPANION,
      effects: [{ kind: 'temp-hp', amount: { dice: '1d4' } } as SpellEffect],
    }).map((p) => p.code);
    expect(codes).toContain('stated_choice_reaches_nothing');
  });
});

describe('determinism', () => {
  it('replays byte-identically from the same seed', () => {
    const play = () => {
      // Two castings before the fight (a turn allows one levelled spell), a
      // replacement among them, and the mount seated after its rider once the
      // fight is on.
      const g = new Game();
      g.cast('call-a-companion', { form: 'cat', choice: 'Fey' });
      g.cast('call-a-companion', { form: 'owl', choice: 'Fiend' });
      g.fight(3);
      g.cast('call-a-mount', { slotLevel: 4 });
      return g.events;
    };
    const a = play();
    const b = play();
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(JSON.stringify(replayed(a))).toBe(JSON.stringify(fold('seed', a)));
  });
});
