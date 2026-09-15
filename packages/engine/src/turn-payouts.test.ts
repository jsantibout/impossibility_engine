import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap, type CharacterId, type Result } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, restoreRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { spellSlotKey } from './resources.js';
import { declaredCasting } from './spellcasting.js';
import { endConcentration, resolveSpell, resolveTurn } from './commands.js';
import { conditionImmunitiesOf } from './standing.js';
import { extendContent, type Content } from './content.js';
import { checkSpellDefinition } from './spell-schema.js';
import { type SpellDefinition } from './spell-definitions.js';

/**
 * A payout at a turn boundary: what a casting hands a creature at the start or
 * the end of each of *its* turns, for as long as the casting runs.
 *
 * SRD Heroism is the sentence: "Until the spell ends, the creature is immune to
 * the Frightened condition and **gains Temporary Hit Points equal to your
 * spellcasting ability modifier at the start of each of its turns**." The first
 * half is a `condition-immunity` and was built; the second half is this — no
 * saving throw to raise, no area to be standing in, and nothing anybody has to
 * remember.
 *
 * What is asserted here is the mechanism (a homebrew definition, because no SRD
 * spell pays damage or healing on this schedule), the pinning (the grant event
 * carries its own numbers and the fold opens no catalogue), and Heroism itself
 * end to end through the public API.
 */

const id = (s: string) => asCharacterId(s);
const BARD = id('bard');
const FIGHTER = id('fighter');
const OGRE = id('ogre');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 14, con: 14, int: 10, wis: 10, cha: 16 },
  skills: {},
  saveProficiencies: ['con'],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'cha',
  ...over,
});

const added = (who: CharacterId, over: Partial<CharacterSheet> = {}): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(over),
  maxHp: 40,
  diesAtZero: false,
});

const slots = (who: CharacterId): GameEvent[] =>
  [1, 2, 3].map((level) => ({
    type: 'resource-pool-declared',
    id: who,
    pool: {
      key: spellSlotKey(level),
      label: `level ${level} spell slot`,
      max: 4,
      recovers: 'long-rest',
    },
  }));

/** Order: bard, fighter, ogre — so the bard casts and the fighter's turn is next. */
const setup = (prepared: readonly string[]): readonly GameEvent[] => [
  added(BARD),
  added(FIGHTER),
  added(OGRE),
  ...slots(BARD),
  { type: 'scene-set', extent: { width: 100, depth: 100, height: 20 } },
  { type: 'landmark-added', name: 'the hall', at: { x: 50, y: 50, z: 0 } },
  { type: 'creature-placed', id: BARD, placement: { from: { landmark: 'the hall' }, feet: 0 } },
  {
    type: 'creature-placed',
    id: FIGHTER,
    placement: { from: { creature: BARD }, feet: 5, bearing: 0 },
  },
  {
    type: 'creature-placed',
    id: OGRE,
    placement: { from: { creature: BARD }, feet: 10, bearing: 180 },
  },
  { type: 'sight-declared', from: BARD, to: FIGHTER, seen: true },
  { type: 'sight-declared', from: BARD, to: OGRE, seen: true },
  {
    type: 'spellcasting-declared',
    id: BARD,
    spellcasting: declaredCasting({
      ability: 'cha',
      classId: 'bard',
      cantrips: [],
      prepared: [...prepared],
    }),
  },
  {
    type: 'combat-started',
    combatants: [
      { id: BARD, initiative: 20, speed: 30 },
      { id: FIGHTER, initiative: 10, speed: 30 },
      { id: OGRE, initiative: 5, speed: 30 },
    ],
  },
];

const must = <T,>(result: Result<T>): T => unwrap(result, 'turn payout');

const supplyFor = (state: GameState, content: Content = SRD_CONTENT) => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: (state.rng === null ? createRng('payout') : restoreRng(state.rng)) as Rng,
  content,
});

/** Advance one turn, appending what the boundary did to the log. */
const advance = (log: readonly GameEvent[], content: Content = SRD_CONTENT): GameEvent[] => {
  const state = fold('seed', log);
  return [...log, ...must(resolveTurn(state, supplyFor(state, content))).events];
};

/**
 * What the curse's 1d6 comes to on this seed.
 *
 * Pinned rather than bounded: a range of 1 to 6 cannot tell one payment from
 * two, which is exactly the mistake a payout that repeats invites. The number
 * is the generator's, and if it moves the determinism ship criterion has moved
 * with it.
 */
const SENTINEL_DAMAGE = 2;

const tempHpOf = (state: GameState, who: CharacterId): number =>
  state.creatures[who]?.vitals.temporaryHp ?? 0;

// ---------------------------------------------------------------------------
// The mechanism, on a homebrew definition
// ---------------------------------------------------------------------------

/**
 * A homebrew ward that pays Temporary Hit Points at the start of each of its
 * target's turns, and a homebrew curse that deals damage at the end of them.
 *
 * Homebrew rather than an SRD spell because the *shape* covers three payouts
 * and the book only prints one of them on this schedule: Heroism's Temporary
 * Hit Points. Regenerate's healing and Phantasmal Force's Psychic damage are
 * both blocked on something else, so the only honest way to drive the other two
 * arms is content the test supplies — which is also the claim that adding a
 * spell of this shape needs no engine change.
 */
const WARD: SpellDefinition = {
  id: 'test-ward',
  name: 'Test Ward',
  level: 1,
  school: 'abjuration',
  castingTime: 'action',
  range: { kind: 'touch' },
  targets: { count: 1, self: true },
  concentration: true,
  durationSeconds: 60,
  effects: [
    {
      kind: 'turn-payout',
      at: 'start-of-turn',
      payout: 'temporary-hit-points',
      flat: 2,
      addSpellcastingModifier: true,
    },
  ],
};

const CURSE: SpellDefinition = {
  id: 'test-curse',
  name: 'Test Curse',
  level: 1,
  school: 'necromancy',
  castingTime: 'action',
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 1 },
  concentration: true,
  durationSeconds: 60,
  effects: [
    {
      kind: 'turn-payout',
      at: 'end-of-turn',
      payout: 'damage',
      dice: '1d6',
      damageType: 'necrotic',
    },
  ],
};

/**
 * And a homebrew mending that restores a printed number of Hit Points at the
 * start of each of its target's turns.
 *
 * **Regenerate's own sentence, minus the minute it takes to cast**: "For the
 * duration, the target regains 1 Hit Point at the start of each of its turns."
 * That spell is blocked on `a-long-casting-time` and stays undefined, so its
 * clause is driven here instead — because the adjudication map now says this
 * half of it is built, and a map count standing on an untested branch is the
 * green tick this repository exists to refuse.
 */
const MENDING: SpellDefinition = {
  id: 'test-mending',
  name: 'Test Mending',
  level: 1,
  school: 'transmutation',
  castingTime: 'action',
  range: { kind: 'touch' },
  targets: { count: 1, self: true },
  concentration: true,
  durationSeconds: 60,
  effects: [{ kind: 'turn-payout', at: 'start-of-turn', payout: 'healing', flat: 1 }],
};

const PREPARED = ['test-ward', 'test-curse', 'test-mending'];

const homebrew = (): Content =>
  must(extendContent(SRD_CONTENT, { spells: [WARD, CURSE, MENDING] }));

describe('a casting pays out at its recipient’s turn boundary', () => {
  const content = homebrew();
  const cast = (log: readonly GameEvent[], spellId: string, target: CharacterId): GameEvent[] => {
    const state = fold('seed', log);
    return [
      ...log,
      ...must(
        resolveSpell(state, BARD, { spellId, targets: [target], slotLevel: 1 }, supplyFor(state, content)),
      ).events,
    ];
  };

  it('pays at the start of the recipient’s turn, and at no other moment', () => {
    const warded = cast(setup(PREPARED), 'test-ward', FIGHTER);
    // Nothing yet: the casting hands over at a boundary, not at the cast.
    expect(tempHpOf(fold('seed', warded), FIGHTER)).toBe(0);

    // The bard's turn ends and the fighter's begins: +2 and a Charisma of 16.
    let log = advance(warded, content);
    expect(tempHpOf(fold('seed', log), FIGHTER)).toBe(5);

    // Spent, so the next boundary's answer is visible rather than swallowed by
    // "Temporary Hit Points do not stack".
    log = [...log, { type: 'temporary-hp-cleared', id: FIGHTER }];

    // The fighter's turn *ends* and the ogre's begins. The clause says "at the
    // start of each of its turns", and the two moments are a round apart: the
    // fighter gets nothing for finishing, and the ogre gets nothing at all.
    log = advance(log, content);
    expect(tempHpOf(fold('seed', log), FIGHTER)).toBe(0);
    expect(tempHpOf(fold('seed', log), OGRE)).toBe(0);
  });

  it('pays again every turn, for as long as the casting runs', () => {
    let log = cast(setup(PREPARED), 'test-ward', FIGHTER);
    log = advance(log, content);
    expect(tempHpOf(fold('seed', log), FIGHTER)).toBe(5);

    // Spend them, so the next payout is observable rather than swallowed by
    // "Temporary Hit Points do not stack".
    log = [...log, { type: 'temporary-hp-cleared', id: FIGHTER }];
    expect(tempHpOf(fold('seed', log), FIGHTER)).toBe(0);

    // Round the table: ogre, bard, fighter.
    log = advance(log, content);
    log = advance(log, content);
    log = advance(log, content);
    expect(tempHpOf(fold('seed', log), FIGHTER)).toBe(5);
  });

  it('stops the turn after the casting ends', () => {
    let log = cast(setup(PREPARED), 'test-ward', FIGHTER);
    log = advance(log, content);
    log = [...log, { type: 'temporary-hp-cleared', id: FIGHTER }];

    const castingId = Object.keys(fold('seed', log).ongoing)[0]!;
    log = [...log, { type: 'spell-ended', castingId, on: null, reason: 'dispelled' }];
    // The grant went with the casting, through the door every other grant ends
    // through.
    expect(fold('seed', log).creatures[FIGHTER]?.payouts).toEqual([]);

    log = advance(log, content);
    log = advance(log, content);
    log = advance(log, content);
    expect(tempHpOf(fold('seed', log), FIGHTER)).toBe(0);
  });

  it('deals damage at the end of the recipient’s turn, rolled by the engine', () => {
    const cursed = cast(setup(PREPARED), 'test-curse', OGRE);
    const before = fold('seed', cursed).creatures[OGRE]!.vitals.hp;

    // The bard's turn ends: the ogre is not ending a turn, so nothing lands.
    const first = advance(cursed, content);
    expect(fold('seed', first).creatures[OGRE]?.vitals.hp).toBe(before);

    // The fighter's turn ends and the ogre's *begins*, which is the other
    // moment and not this clause's.
    const second = advance(first, content);
    expect(fold('seed', second).creatures[OGRE]?.vitals.hp).toBe(before);

    // The ogre's turn ends, which is the boundary the curse named.
    const third = advance(second, content);
    const after = fold('seed', third);
    // **One die, and the exact total.** The seed is fixed, so the number is
    // knowable and a range would not tell a second payment from a lucky roll:
    // the engine threw this at the boundary, once.
    expect(before - after.creatures[OGRE]!.vitals.hp).toBe(SENTINEL_DAMAGE);
  });

  /**
   * SRD Regenerate: "For the duration, the target regains 1 Hit Point at the
   * start of each of its turns." Healing rather than Temporary Hit Points, and
   * a printed number rather than a modifier — the third arm, and the one the
   * map's own arithmetic now leans on.
   *
   * Through `healCreature`, so it caps at the maximum: a creature at full gains
   * nothing and the boundary still passes, which is the case a payout that
   * repeats for a minute meets on nearly every turn of it.
   */
  it('restores hit points at the start of the recipient’s turn, capped at the maximum', () => {
    const hpOf = (log: readonly GameEvent[]) => fold('seed', log).creatures[FIGHTER]?.vitals.hp;
    let log = cast(setup(PREPARED), 'test-mending', FIGHTER);
    // Two off a maximum of forty, so the payout has somewhere to go twice and
    // nowhere to go the third time.
    log = [...log, { type: 'damage-taken', id: FIGHTER, amount: 2, source: 'a test' }];
    expect(hpOf(log)).toBe(38);

    // The bard's turn ends and the fighter's begins.
    log = advance(log, content);
    expect(hpOf(log)).toBe(39);

    // Round the table — ogre, bard, fighter — and it pays again.
    for (let n = 0; n < 3; n += 1) log = advance(log, content);
    expect(hpOf(log)).toBe(40);

    // And again at full, where `healCreature`'s cap is the whole of what
    // happens: nothing is gained, nothing is refused, and the boundary passes.
    // That is the state a payout repeating for a minute is in on nearly every
    // turn of it, so it is the one that must not wedge the fight.
    for (let n = 0; n < 3; n += 1) log = advance(log, content);
    expect(hpOf(log)).toBe(40);
  });

  it('refuses to advance without a generator when a payout falls due', () => {
    const warded = cast(setup(PREPARED), 'test-ward', FIGHTER);
    const refused = resolveTurn(fold('seed', warded));
    expect(isErr(refused)).toBe(true);
    if (isErr(refused)) expect(refused.code).toBe('payout_owed');
  });
});

// ---------------------------------------------------------------------------
// Pinning
// ---------------------------------------------------------------------------

describe('a payout carries its own numbers', () => {
  const content = homebrew();

  it('pins what it read from the definition into the event it emits', () => {
    const log = setup(['test-ward']);
    const state = fold('seed', log);
    const cast = must(
      resolveSpell(
        state,
        BARD,
        { spellId: 'test-ward', targets: [FIGHTER], slotLevel: 1 },
        supplyFor(state, content),
      ),
    );

    const granted = cast.events.find((event) => event.type === 'turn-payout-granted');
    expect(granted).toBeDefined();
    if (granted?.type !== 'turn-payout-granted') return;
    expect(granted.payout.at).toBe('start-of-turn');
    expect(granted.payout.payout).toBe('temporary-hit-points');
    // 2 printed plus a Charisma of 16 — resolved at the cast, so a bard who
    // levels between casting and the boundary pays what they promised.
    expect(granted.payout.flat).toBe(5);
  });

  it('folds to the same state with no content at all', () => {
    const log = setup(['test-ward']);
    const state = fold('seed', log);
    const cast = must(
      resolveSpell(
        state,
        BARD,
        { spellId: 'test-ward', targets: [FIGHTER], slotLevel: 1 },
        supplyFor(state, content),
      ),
    );
    const whole = [...log, ...cast.events];
    const paid = advance(whole, content);

    // The fold opens no catalogue: the same log, folded with nothing to look
    // anything up in, is the same state.
    expect(fold('seed', paid)).toEqual(fold('seed', paid, content));
    expect(tempHpOf(fold('seed', paid), FIGHTER)).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Heroism, end to end
// ---------------------------------------------------------------------------

describe('SRD Heroism runs both halves of its one sentence', () => {
  const heroism = (log: readonly GameEvent[]): GameEvent[] => {
    const state = fold('seed', log);
    return [
      ...log,
      ...must(
        resolveSpell(
          state,
          BARD,
          { spellId: 'heroism', targets: [FIGHTER], slotLevel: 1 },
          supplyFor(state),
        ),
      ).events,
    ];
  };

  it('is a definition the schema accepts', () => {
    const definition = SRD_CONTENT.spell('heroism');
    expect(definition).not.toBeNull();
    expect(checkSpellDefinition(definition!)).toEqual([]);
  });

  it('grants the Immunity at the cast and the Temporary Hit Points at the turn', () => {
    const cast = heroism(setup(['heroism']));
    const during = fold('seed', cast);
    // "the creature is immune to the Frightened condition" — at once.
    expect(conditionImmunitiesOf(during, FIGHTER)).toEqual(['frightened']);
    // "at the start of each of its turns" — not yet.
    expect(tempHpOf(during, FIGHTER)).toBe(0);

    const paid = fold('seed', advance(cast));
    expect(tempHpOf(paid, FIGHTER)).toBe(3);
  });

  it('ends both halves when the Concentration breaks', () => {
    let log = heroism(setup(['heroism']));
    log = advance(log);
    log = [...log, { type: 'temporary-hp-cleared', id: FIGHTER }];

    const state = fold('seed', log);
    log = [...log, ...must(endConcentration(state, BARD, 'voluntary'))];
    const ended = fold('seed', log);
    expect(conditionImmunitiesOf(ended, FIGHTER)).toEqual([]);
    expect(ended.creatures[FIGHTER]?.payouts).toEqual([]);

    // Round the table, and nothing arrives.
    log = advance(log);
    log = advance(log);
    log = advance(log);
    expect(tempHpOf(fold('seed', log), FIGHTER)).toBe(0);
  });
});
