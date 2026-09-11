import { describe, expect, it } from 'vitest';
import { asCharacterId, isErr, expect as unwrap, type CharacterId , isNeedsContext, contextRequestsOf } from '@ie/shared';
import { createRng, restoreRng } from './dice.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { remaining, spellSlotKey } from './resources.js';
import { createRollIssuer } from './rolls.js';
import { levelGrantedSpells, type SpellbookEntry } from './spellbook.js';
import { freeCastPoolKey, createCharacter, type CharacterChoices } from './creation.js';
import { eligibleTargets, resolveSpell, rollInitiativeFor } from './commands.js';

/**
 * Three boundaries, tightened.
 *
 * **Targeting.** The engine takes ids and checks mechanics; working out that
 * "him" means the goblin is the orchestrator's job. What the engine owes that
 * layer is a straight answer about what it can and cannot see: a fact it is
 * missing comes back as a structured request to go and establish it, not as a
 * refusal a player would ever be shown, and never as a silent pass.
 *
 * **Alert.** A feat that adds to a roll the engine already makes should be on
 * the roll, once, without anybody remembering it.
 *
 * **Sources.** A spell available two ways is a choice, and spending a feat's
 * one free casting when a slot would have done is not a choice the engine gets
 * to make quietly.
 */

const id = (s: string) => asCharacterId(s);
const WIZARD = id('kessa');
const THUG = id('thug');
const GOBLIN = id('goblin');

const book = (level: number): SpellbookEntry[] =>
  ['magic-missile', 'shield', 'detect-magic', 'feather-fall', 'mage-armor', 'hold-person',
   'thunderwave', 'charm-person', 'misty-step', 'web']
    .slice(0, levelGrantedSpells(level))
    .map((spellId, index) => ({
      spellId,
      acquiredAt: index < 6 ? 1 : Math.ceil((index - 5) / 2) + 1,
      origin: 'level' as const,
    }));

const kessa = (over: Partial<CharacterChoices> = {}): CharacterChoices => ({
  name: 'Kessa',
  classId: 'wizard',
  level: 3,
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 },
  },
  abilityIncreases: { int: 2, con: 1 },
  classSkills: ['investigation', 'insight'],
  languages: ['Draconic', 'Elvish'],
  alignment: 'Chaotic Good',
  subclassId: 'evoker',
  cantrips: ['fire-bolt', 'light', 'prestidigitation'],
  spellbook: book(3),
  preparedSpells: ['magic-missile', 'shield', 'mage-armor', 'hold-person', 'burning-hands', 'scorching-ray'],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: {
    'wizard:scholar': ['arcana'],
    'human:skillful': ['perception'],
    'evoker:evocation-savant': ['burning-hands', 'scorching-ray'],
  },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int',
      cantrips: ['mage-hand', 'ray-of-frost'],
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId: 'skilled', proficiencies: ['stealth', 'nature', 'survival'] },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
  ...over,
});

const creature = (
  who: CharacterId,
  name: string,
  creatureType: string | null,
): GameEvent => ({
  type: 'creature-added',
  id: who,
  name,
  maxHp: 30,
  ...(creatureType === null ? {} : { creatureType }),
  sheet: {
    level: 1,
    abilities: { str: 10, dex: 12, con: 12, int: 8, wis: 8, cha: 8 },
    skills: {},
    saveProficiencies: [],
    armor: null,
    shield: null,
    armorTraining: { light: true, medium: true, heavy: false, shields: true },
    baseSpeed: 30,
    spellcastingAbility: null,
    stated: { armorClass: 13, proficiencyBonus: 2, initiative: 1 },
  },
});

/**
 * A thug (Humanoid, a legal Hold Person target) and a goblin.
 *
 * SRD 2024 makes a Goblin Warrior **Fey**, not Humanoid — which means Hold
 * Person cannot touch one. That is easy to miss and the engine now catches it.
 */
const table = (over: Partial<CharacterChoices> = {}): GameEvent[] => [
  ...unwrap(createCharacter(kessa(over), WIZARD), 'create'),
  creature(THUG, 'Thug', 'Humanoid'),
  creature(GOBLIN, 'Goblin Warrior', 'Fey'),
  { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
  { type: 'landmark-added', name: 'the door', at: { x: 20, y: 20, z: 0 } },
  { type: 'creature-placed', id: WIZARD, placement: { from: { landmark: 'the door' }, feet: 0 } },
  { type: 'creature-placed', id: THUG, placement: { from: { creature: WIZARD }, feet: 20, bearing: 0 } },
  { type: 'creature-placed', id: GOBLIN, placement: { from: { creature: WIZARD }, feet: 20, bearing: 90 } },
  { type: 'sight-declared', from: WIZARD, to: THUG, seen: true },
  { type: 'sight-declared', from: WIZARD, to: GOBLIN, seen: true },
  {
    type: 'combat-started',
    combatants: [
      { id: WIZARD, initiative: 20, speed: 30 },
      { id: THUG, initiative: 10, speed: 30 },
      { id: GOBLIN, initiative: 5, speed: 30 },
    ],
  },
];

const supply = (state: GameState, flat?: number) => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: state.rng === null ? createRng('seed') : restoreRng(state.rng),
  ...(flat === undefined ? {} : { bonuses: [{ source: 'the test insists', flat }] }),
});

const DOOMED = -40;

const castOn = (
  log: readonly GameEvent[],
  request: Parameters<typeof resolveSpell>[2],
  flat?: number,
) => {
  const state = fold('seed', log);
  return resolveSpell(state, WIZARD, request, supply(state, flat));
};

// — 1. targeting ————————————————————————————————————————————————————————————

describe('creature type is authoritative, not assumed', () => {
  /**
   * SRD Hold Person: "Choose a **Humanoid** that you can see within range."
   * SRD 2024 Goblin Warrior: Small **Fey**. So this has never been a legal
   * target, and until the engine carried a creature type it could not say so.
   */
  it('refuses Hold Person on a creature of the wrong type', () => {
    const result = castOn(table(), { spellId: 'hold-person', targets: [GOBLIN], slotLevel: 2 });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.code).toBe('wrong_creature_type');
      expect(result.reason).toContain('Humanoid');
    }
  });

  it('allows it on a Humanoid', () => {
    const result = castOn(table(), { spellId: 'hold-person', targets: [THUG], slotLevel: 2 }, DOOMED);
    expect(isErr(result)).toBe(false);
  });

  it('takes the type a character species gives', () => {
    const state = fold('seed', table());
    expect(state.creatures.kessa!.creatureType).toBe('Humanoid');
  });

  /** A spell that names no type does not care. */
  it('lets Fire Bolt hit anything', () => {
    expect(isErr(castOn(table(), { spellId: 'fire-bolt', targets: [GOBLIN] }))).toBe(false);
  });
});

describe('a missing fact is a request, not a refusal', () => {
  const untyped = (): GameEvent[] => [
    ...unwrap(createCharacter(kessa(), WIZARD), 'create'),
    creature(THUG, 'Thug', null),
    { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
    { type: 'landmark-added', name: 'the door', at: { x: 20, y: 20, z: 0 } },
    { type: 'creature-placed', id: WIZARD, placement: { from: { landmark: 'the door' }, feet: 0 } },
    { type: 'creature-placed', id: THUG, placement: { from: { creature: WIZARD }, feet: 20, bearing: 0 } },
    { type: 'sight-declared', from: WIZARD, to: THUG, seen: true },
  ];

  /**
   * The engine does not know what a Thug is, and will not guess. It says what
   * it needs and how to give it — addressed to the layer that can go and find
   * out, never to a player, who should not be told the database is thin.
   */
  it('asks for a creature type it does not have', () => {
    const outcome = castOn(untyped(), { spellId: 'hold-person', targets: [THUG], slotLevel: 2 });
    expect(isNeedsContext(outcome)).toBe(true);

    const requests = contextRequestsOf(outcome);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ kind: 'creature-type', subject: THUG });
    expect(requests[0]?.satisfyWith.length).toBeGreaterThan(0);
  });

  it('asks for a position rather than guessing a distance', () => {
    const unplaced: GameEvent[] = [
      ...unwrap(createCharacter(kessa(), WIZARD), 'create'),
      creature(THUG, 'Thug', 'Humanoid'),
      { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
      { type: 'landmark-added', name: 'the door', at: { x: 20, y: 20, z: 0 } },
      { type: 'creature-placed', id: WIZARD, placement: { from: { landmark: 'the door' }, feet: 0 } },
      { type: 'sight-declared', from: WIZARD, to: THUG, seen: true },
    ];
    const outcome = castOn(unplaced, { spellId: 'hold-person', targets: [THUG], slotLevel: 2 });
    expect(isNeedsContext(outcome)).toBe(true);
    expect(contextRequestsOf(outcome).map((r) => r.kind)).toContain('position');
  });

  /** SRD Hold Person: "a Humanoid that you can **see**." */
  it('asks whether the caster can see a target, when the spell requires it', () => {
    const unseen = table().filter(
      (e) => !(e.type === 'sight-declared' && e.to === THUG),
    );
    const outcome = castOn(unseen, { spellId: 'hold-person', targets: [THUG], slotLevel: 2 });
    expect(isNeedsContext(outcome)).toBe(true);
    expect(contextRequestsOf(outcome).map((r) => r.kind)).toContain('visibility');
  });

  it('does not ask about sight for a spell that does not need it', () => {
    const unseen = table().filter((e) => e.type !== 'sight-declared');
    const outcome = unwrap(castOn(unseen, { spellId: 'fire-bolt', targets: [GOBLIN] }), 'cast');
    expect(outcome.castingId.length).toBeGreaterThan(0);
  });

  /** Declared unseen is an answer, and the answer is no. */
  it('refuses outright once sight has been established as absent', () => {
    const hidden: GameEvent[] = [
      ...table().filter((e) => !(e.type === 'sight-declared' && e.to === THUG)),
      { type: 'sight-declared', from: WIZARD, to: THUG, seen: false },
    ];
    const result = castOn(hidden, { spellId: 'hold-person', targets: [THUG], slotLevel: 2 });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.code).toBe('cannot_see_target');
  });

  /** Asking costs nothing: no slot, no action, no die. */
  it('changes nothing while it is asking', () => {
    const before = fold('seed', untyped());
    const asked = castOn(untyped(), { spellId: 'hold-person', targets: [THUG], slotLevel: 2 });
    expect(isNeedsContext(asked)).toBe(true);
    expect(fold('seed', untyped())).toEqual(before);
    expect(before.rollsIssued).toBe(0);
  });

  /** And once the fact is supplied, the same cast goes through. */
  it('resolves once the request is satisfied', () => {
    const answered: GameEvent[] = [
      ...untyped(),
      { type: 'creature-type-declared', id: THUG, creatureType: 'Humanoid' },
    ];
    const outcome = unwrap(
      castOn(answered, { spellId: 'hold-person', targets: [THUG], slotLevel: 2 }, DOOMED),
      'cast',
    );
    expect(outcome.castingId.length).toBeGreaterThan(0);
  });
});

describe('the engine offers the targets it can see', () => {
  /**
   * Reference resolution is the orchestrator's job — "him" is interpretation,
   * not mechanics. What the engine can do is hand over the shortlist, so the
   * layer above has something to be obvious *about*.
   */
  it('lists who a spell could legally be cast at', () => {
    const state = fold('seed', table());
    const eligible = eligibleTargets(state, WIZARD, 'hold-person', 2);

    expect(eligible.eligible).toEqual([THUG]);
    // The goblin is Fey; it is excluded, with the reason attached.
    expect(eligible.excluded.find((e) => e.target === GOBLIN)?.reason).toContain('Fey');
  });

  it('excludes what is out of range, and says so', () => {
    const far: GameEvent[] = [
      ...table(),
      { type: 'creature-moved', id: THUG, placement: { from: { creature: WIZARD }, feet: 150, bearing: 0 } },
    ];
    const eligible = eligibleTargets(fold('seed', far), WIZARD, 'hold-person', 2);
    expect(eligible.eligible).toEqual([]);
    expect(eligible.excluded.find((e) => e.target === THUG)?.reason).toContain('range');
  });

  it('reports what it would need to decide, rather than dropping the target', () => {
    const untyped: GameEvent[] = [
      ...table().filter((e) => e.type !== 'creature-added' || e.id !== THUG),
      creature(THUG, 'Thug', null),
    ];
    const eligible = eligibleTargets(fold('seed', untyped), WIZARD, 'hold-person', 2);
    expect(eligible.needsContext.map((r) => r.subject)).toContain(THUG);
  });

  /**
   * Magic Missile is a real SRD spell with no definition — it hits without an
   * attack roll, which is a shape the engine does not have. A shortlist for a
   * spell the engine cannot resolve is empty rather than a guess at who looks
   * plausible. (This was Fireball until Fireball became executable; the point
   * is the missing definition, not the spell.)
   */
  it('says nothing useful about a spell it cannot execute', () => {
    const eligible = eligibleTargets(fold('seed', table()), WIZARD, 'magic-missile', 1);
    expect(eligible.eligible).toEqual([]);
    expect(eligible.excluded).toEqual([]);
  });
});

// — 2. Alert ————————————————————————————————————————————————————————————————

describe('Alert rides on the Initiative roll by itself', () => {
  const alertKessa = () =>
    kessa({ feats: { ...kessa().feats, 'human:versatile': { featId: 'alert' } } });

  const rolled = (choices: CharacterChoices) => {
    const log = unwrap(createCharacter(choices, WIZARD), 'create');
    const state = fold('seed', log);
    const { issuer, rng } = supply(state);
    return unwrap(rollInitiativeFor(state, WIZARD, issuer, rng), 'initiative');
  };

  /** SRD Alert: "When you roll Initiative, you can add your Proficiency Bonus." */
  it('adds the Proficiency Bonus without the caller passing it', () => {
    const withAlert = rolled(alertKessa());
    const without = rolled(kessa());
    expect(withAlert.modifier - without.modifier).toBe(2);
    expect(withAlert.roll.provenance.source).toBe('engine');
  });

  it('adds nothing for a character without the feat', () => {
    const plain = rolled(kessa());
    // Dexterity 14 alone: no Proficiency Bonus on an ordinary Initiative check.
    expect(plain.modifier).toBe(2);
  });

  /**
   * Exactly once, even if a caller helpfully supplies it as well. A flat bonus
   * folds into the die's own modifier by design, so the arithmetic is the
   * assertion: +2 over the baseline, never +4.
   */
  it('does not double when a caller passes it too', () => {
    const log = unwrap(createCharacter(alertKessa(), WIZARD), 'create');
    const state = fold('seed', log);
    const { issuer, rng } = supply(state);
    const outcome = unwrap(
      rollInitiativeFor(state, WIZARD, issuer, rng, {
        bonuses: [{ source: 'Alert', flat: 2 }],
      }),
      'initiative',
    );
    expect(outcome.modifier).toBe(rolled(alertKessa()).modifier);
  });

  it('still takes an unrelated bonus alongside it', () => {
    const log = unwrap(createCharacter(alertKessa(), WIZARD), 'create');
    const state = fold('seed', log);
    const { issuer, rng } = supply(state);
    const outcome = unwrap(
      rollInitiativeFor(state, WIZARD, issuer, rng, {
        bonuses: [{ source: 'a hasty draught', flat: 1 }],
      }),
      'initiative',
    );
    // Dexterity 2, Alert 2, the draught 1.
    expect(outcome.modifier).toBe(5);
  });

  it('refuses a creature that is not in the game', () => {
    const state = fold('seed', table());
    const { issuer, rng } = supply(state);
    expect(isErr(rollInitiativeFor(state, id('nobody'), issuer, rng))).toBe(true);
  });
});

// — 3. source and payment ————————————————————————————————————————————————————

describe('which grant pays, and with what', () => {
  /**
   * Ray of Frost comes only from Magic Initiate; Fire Bolt comes from the
   * Wizard's own cantrip list. A spell available both ways is a choice, and
   * the default is documented rather than silent: the class route wins.
   */
  it('prefers the class route when both supply the spell', () => {
    const both = kessa({
      feats: {
        ...kessa().feats,
        'sage:magic-initiate-wizard': {
          featId: 'magic-initiate',
          spellList: 'wizard',
          spellcastingAbility: 'wis',
          cantrips: ['fire-bolt', 'mage-hand'],
          levelOneSpell: 'find-familiar',
        },
      },
    });
    const state = fold('seed', table(both));
    const eligible = eligibleTargets(state, WIZARD, 'fire-bolt', 0);
    expect(eligible.eligible).toContain(GOBLIN);

    const outcome = unwrap(
      resolveSpell(state, WIZARD, { spellId: 'fire-bolt', targets: [GOBLIN] }, supply(state, 40)),
      'cast',
    );
    // Intelligence 17 (+3) and Proficiency 2: the Wizard's number, not Wisdom's.
    expect(outcome.events.find((e) => e.type === 'roll-recorded')).toMatchObject({
      contributions: [{ source: 'spell attack', amount: 5 }],
    });
  });

  it('takes the grant when it is named, and uses that ability', () => {
    const wisInitiate = kessa({
      feats: {
        ...kessa().feats,
        'sage:magic-initiate-wizard': {
          featId: 'magic-initiate',
          spellList: 'wizard',
          spellcastingAbility: 'wis',
          cantrips: ['fire-bolt', 'mage-hand'],
          levelOneSpell: 'find-familiar',
        },
      },
    });
    const state = fold('seed', table(wisInitiate));
    const outcome = unwrap(
      resolveSpell(
        state,
        WIZARD,
        { spellId: 'fire-bolt', targets: [GOBLIN], source: 'sage:magic-initiate-wizard' },
        supply(state, 40),
      ),
      'cast',
    );
    // Wisdom 12 (+1) and Proficiency 2.
    expect(outcome.events.find((e) => e.type === 'roll-recorded')).toMatchObject({
      contributions: [{ source: 'spell attack', amount: 3 }],
    });
  });

  it('refuses a source that does not supply the spell', () => {
    const state = fold('seed', table());
    const result = resolveSpell(
      state,
      WIZARD,
      { spellId: 'fire-bolt', targets: [GOBLIN], source: 'human:versatile' },
      supply(state),
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.code).toBe('source_does_not_supply');
  });

  /**
   * The one that mattered. A granted spell used to spend the feat's single
   * free casting whenever no slot was named — a resource decision the engine
   * was making on the caller's behalf, and the expensive way round.
   */
  it('refuses to choose between a free casting and a slot', () => {
    const state = fold('seed', holdViaFeat());
    const result = resolveSpell(
      state,
      WIZARD,
      { spellId: 'hold-person', targets: [THUG], source: 'sage:magic-initiate-wizard' },
      supply(state, DOOMED),
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.code).toBe('payment_required');
      expect(result.reason).toContain('free-casting');
      expect(result.reason).toContain('slot');
    }
  });

  it('spends the free casting when told to', () => {
    const log = holdViaFeat();
    const state = fold('seed', log);
    const outcome = unwrap(
      resolveSpell(
        state,
        WIZARD,
        {
          spellId: 'hold-person',
          targets: [THUG],
          source: 'sage:magic-initiate-wizard',
          payment: 'free-casting',
        },
        supply(state, DOOMED),
      ),
      'cast',
    );

    const after = fold('seed', [...log, ...outcome.events]);
    expect(remaining(after.creatures.kessa!.resources, freeCastPoolKey('sage:magic-initiate-wizard'))).toBe(0);
    // The slots are untouched.
    expect(remaining(after.creatures.kessa!.resources, spellSlotKey(2))).toBe(2);
  });

  it('spends a slot when told to, leaving the free casting alone', () => {
    const log = holdViaFeat();
    const state = fold('seed', log);
    const outcome = unwrap(
      resolveSpell(
        state,
        WIZARD,
        {
          spellId: 'hold-person',
          targets: [THUG],
          source: 'sage:magic-initiate-wizard',
          payment: 'slot',
          slotLevel: 2,
        },
        supply(state, DOOMED),
      ),
      'cast',
    );

    const after = fold('seed', [...log, ...outcome.events]);
    expect(remaining(after.creatures.kessa!.resources, spellSlotKey(2))).toBe(1);
    expect(remaining(after.creatures.kessa!.resources, freeCastPoolKey('sage:magic-initiate-wizard'))).toBe(1);
  });

  it('refuses a free casting that has already been used', () => {
    const log = holdViaFeat();
    const state = fold('seed', log);
    // The thug resists, so nothing is Paralyzed and no turn-boundary save is
    // left owed to get in the way of the second attempt.
    const first = unwrap(
      resolveSpell(
        state,
        WIZARD,
        {
          spellId: 'hold-person',
          targets: [THUG],
          source: 'sage:magic-initiate-wizard',
          payment: 'free-casting',
        },
        supply(state, 40),
      ),
      'cast',
    );

    const after = fold('seed', [...log, ...first.events, { type: 'turn-advanced' }, { type: 'turn-advanced' }, { type: 'turn-advanced' }]);
    const again = resolveSpell(
      after,
      WIZARD,
      {
        spellId: 'hold-person',
        targets: [THUG],
        source: 'sage:magic-initiate-wizard',
        payment: 'free-casting',
      },
      supply(after, DOOMED),
    );
    expect(isErr(again)).toBe(true);
    if (isErr(again)) expect(again.code).toBe('no_free_casting');
  });

  /** A class spell is paid for with a slot, and asks nobody anything. */
  it('needs no payment choice for a spell with only one route', () => {
    const state = fold('seed', table());
    expect(
      isErr(
        resolveSpell(
          state,
          WIZARD,
          { spellId: 'hold-person', targets: [THUG], slotLevel: 2 },
          supply(state, DOOMED),
        ),
      ),
    ).toBe(false);
  });
});

/** A Kessa whose Magic Initiate grant is Hold Person, so it has two routes. */
function holdViaFeat(): GameEvent[] {
  return table(
    kessa({
      feats: {
        ...kessa().feats,
        'sage:magic-initiate-wizard': {
          featId: 'magic-initiate',
          spellList: 'wizard',
          spellcastingAbility: 'int',
          cantrips: ['mage-hand', 'ray-of-frost'],
          levelOneSpell: 'find-familiar',
        },
      },
    }),
  ).map((event) =>
    event.type === 'character-created'
      ? {
          ...event,
          spellcasting: {
            ...event.spellcasting,
            granted: [
              ...event.spellcasting.granted,
              {
                spellId: 'hold-person',
                source: 'sage:magic-initiate-wizard',
                ability: 'int' as const,
                freeCastPool: freeCastPoolKey('sage:magic-initiate-wizard'),
                slotCasting: true,
              },
            ],
          },
        }
      : event,
  );
}

describe('an invalid target is refused, never swapped for a better one', () => {
  /**
   * The division of labour, stated as a test.
   *
   * Maestro resolves who "him" is **before** the engine is called: it reads the
   * fiction, picks a creature, and hands over an id. The engine then checks
   * that id and only that id. Nothing in here may quietly aim the spell at
   * somebody else, however obviously better a candidate they are — a player who
   * said "the goblin" and hit the thug has been lied to about what happened.
   */
  it('refuses the named target even when a legal one is standing right there', () => {
    const state = fold('seed', table());
    // The thug is a perfectly good Hold Person target, and is ignored.
    expect(eligibleTargets(state, WIZARD, 'hold-person', 2).eligible).toEqual([THUG]);

    const result = resolveSpell(
      state,
      WIZARD,
      { spellId: 'hold-person', targets: [GOBLIN], slotLevel: 2 },
      supply(state, DOOMED),
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.reason).toContain('goblin');

    // And nothing happened to anybody: no slot, no condition, no die.
    expect(fold('seed', table())).toEqual(state);
  });

  /**
   * `eligibleTargets` is a shortlist for the layer doing the interpreting, not
   * a substitution mechanism. It never names a replacement: it says who is in
   * and, for everyone else, why they are out.
   */
  it('lists the excluded with a reason rather than offering an alternative', () => {
    const listing = eligibleTargets(fold('seed', table()), WIZARD, 'hold-person', 2);
    const excluded = listing.excluded.find((e) => e.target === GOBLIN);

    expect(excluded?.reason).toContain('Fey');
    // No field on this shape suggests a stand-in, and the shortlist is exactly
    // the creatures that pass — never one of them singled out.
    expect(Object.keys(listing).sort()).toEqual(['eligible', 'excluded', 'needsContext']);
    expect(listing.eligible).not.toContain(GOBLIN);
  });

  it('refuses every target when the one named is the only one named', () => {
    const state = fold('seed', table());
    const result = resolveSpell(
      state,
      WIZARD,
      { spellId: 'hold-person', targets: [GOBLIN, THUG], slotLevel: 3 },
      supply(state, DOOMED),
    );
    // One bad target spoils the casting; the good one is not quietly kept.
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.code).toBe('wrong_creature_type');
    expect(fold('seed', table())).toEqual(state);
  });
});

describe('answering a request keeps what was already established', () => {
  /** Position and sight are known; only the creature type is missing. */
  const missingTypeOnly = (): GameEvent[] => [
    ...unwrap(createCharacter(kessa(), WIZARD), 'create'),
    creature(THUG, 'Thug', null),
    { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
    { type: 'landmark-added', name: 'the door', at: { x: 20, y: 20, z: 0 } },
    { type: 'creature-placed', id: WIZARD, placement: { from: { landmark: 'the door' }, feet: 0 } },
    { type: 'creature-placed', id: THUG, placement: { from: { creature: WIZARD }, feet: 20, bearing: 0 } },
    { type: 'sight-declared', from: WIZARD, to: THUG, seen: true },
  ];

  /**
   * Completing the record adds a fact; it does not restate the world. A
   * declaration that quietly reset a position would make the second attempt
   * resolve against a different game than the first.
   */
  it('leaves position and sight exactly as they were', () => {
    const before = fold('seed', missingTypeOnly());
    const after = fold('seed', [
      ...missingTypeOnly(),
      { type: 'creature-type-declared', id: THUG, creatureType: 'Humanoid' },
    ]);

    expect(after.scene?.positions).toEqual(before.scene?.positions);
    expect(after.scene?.sight).toEqual(before.scene?.sight);
    expect(after.creatures.thug?.creatureType).toBe('Humanoid');
    // And nothing else about the creature moved.
    expect(after.creatures.thug?.vitals).toEqual(before.creatures.thug?.vitals);
  });

  /** Two facts missing, answered one at a time, both surviving. */
  it('accumulates answers rather than replacing them', () => {
    const bare: GameEvent[] = [
      ...unwrap(createCharacter(kessa(), WIZARD), 'create'),
      creature(THUG, 'Thug', null),
      { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
      { type: 'landmark-added', name: 'the door', at: { x: 20, y: 20, z: 0 } },
      { type: 'creature-placed', id: WIZARD, placement: { from: { landmark: 'the door' }, feet: 0 } },
      { type: 'creature-placed', id: THUG, placement: { from: { creature: WIZARD }, feet: 20, bearing: 0 } },
    ];

    const asked = castOn(bare, { spellId: 'hold-person', targets: [THUG], slotLevel: 2 });
    expect(isNeedsContext(asked)).toBe(true);
    expect(contextRequestsOf(asked).map((r) => r.kind).sort()).toEqual([
      'creature-type',
      'visibility',
    ]);

    // Answer the first. The second is still outstanding, and the first stands.
    const half = [
      ...bare,
      { type: 'creature-type-declared' as const, id: THUG, creatureType: 'Humanoid' },
    ];
    const stillAsking = castOn(half, { spellId: 'hold-person', targets: [THUG], slotLevel: 2 });
    expect(isNeedsContext(stillAsking)).toBe(true);
    expect(contextRequestsOf(stillAsking).map((r) => r.kind)).toEqual(['visibility']);

    // Answer the second, and the cast goes through with both facts intact.
    const whole: GameEvent[] = [
      ...half,
      { type: 'sight-declared', from: WIZARD, to: THUG, seen: true },
    ];
    const resolved = unwrap(
      castOn(whole, { spellId: 'hold-person', targets: [THUG], slotLevel: 2 }, DOOMED),
      'cast',
    );
    expect(resolved.castingId.length).toBeGreaterThan(0);

    const state = fold('seed', whole);
    expect(state.creatures.thug?.creatureType).toBe('Humanoid');
    expect(state.scene?.positions.thug).toBeDefined();
  });

  /** An answer that has already been given is not disturbed by giving it again. */
  it('is idempotent when the same fact is declared twice', () => {
    const once = fold('seed', [
      ...missingTypeOnly(),
      { type: 'creature-type-declared', id: THUG, creatureType: 'Humanoid' },
    ]);
    const twice = fold('seed', [
      ...missingTypeOnly(),
      { type: 'creature-type-declared', id: THUG, creatureType: 'Humanoid' },
      { type: 'creature-type-declared', id: THUG, creatureType: 'Humanoid' },
    ]);
    expect({ ...twice, eventCount: 0 }).toEqual({ ...once, eventCount: 0 });
  });

  /** The retry resolves the cast the caller originally meant, not a new one. */
  it('resolves the original intent once the record is complete', () => {
    const whole: GameEvent[] = [
      ...missingTypeOnly(),
      { type: 'creature-type-declared', id: THUG, creatureType: 'Humanoid' },
    ];
    const outcome = unwrap(
      castOn(whole, { spellId: 'hold-person', targets: [THUG], slotLevel: 2 }, DOOMED),
      'cast',
    );
    expect(outcome.outcomes.map((o) => o.target)).toEqual([THUG]);
  });
});
