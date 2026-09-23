/**
 * The Light property's extra attack, the Nick mastery, and the feat.
 *
 * Three SRD sentences that had nothing to read. The Light property has been
 * parsed onto the weapons that print it since the equipment tables landed and
 * was read for one thing only — whether a class narrowed to Light weapons was
 * proficient with this one — and the sentence the property is *for* had no
 * door at all:
 *
 * > "When you take the Attack action on your turn and attack with a Light
 * > weapon, you can make one extra attack as a Bonus Action later on the same
 * > turn. That extra attack must be made with a different Light weapon, and
 * > you don't add your ability modifier to the extra attack's damage unless
 * > that modifier is negative."
 *
 * **The fact it turns on is a per-turn record and not a hand.** The SRD has no
 * off-hand: what the sentence asks is which Light weapon the Attack action has
 * already swung *this turn*, which is a fact about the turn — so it lives in
 * the turn budget beside the feet a Dash banked. The note that used to say
 * "nothing records which hand an attack came from" was asking a question the
 * book does not.
 *
 * **"A different Light weapon" is a different copy**, and that is the reading
 * the count answers: two daggers are two weapons, and the engine knows a
 * creature has two of them. So the same kind is legal exactly when a second
 * copy is owned, which is the rule `resolveAttack` already keeps about a
 * weapon at all — "owning is not wielding, but you cannot wield what you do
 * not own".
 *
 * Nick — "you can make it as part of the Attack action instead" — is the same
 * extra attack at a different price, and the feat is the modifier put back.
 */
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
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { applyEvent, fold, type GameEvent, type GameState } from './events.js';
import { resolveAttack, resolveTurn } from './commands.js';

const id = (s: string) => asCharacterId(s);
const PIP = id('pip'); // the Rogue with two daggers and a shortsword
const GOBLIN = id('goblin');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 1,
  abilities: { str: 10, dex: 16, con: 12, int: 10, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: false, heavy: false, shields: false },
  baseSpeed: 30,
  spellcastingAbility: null,
  weaponProficiencies: ['simple', 'martial'],
  ...over,
});

const added = (
  who: CharacterId,
  side: string,
  over: Partial<CharacterSheet> = {},
  maxHp = 400,
): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(over),
  maxHp,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side,
});

const supply = (seed: string) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

const must = <T,>(result: Result<T>): T => unwrap(result, 'two-weapon fighting');

const applyAll = (state: GameState, events: readonly GameEvent[]): GameState =>
  events.reduce(applyEvent, state);

/**
 * A Rogue carrying two daggers, a shortsword and a greatclub.
 *
 * Two daggers because that is the SRD Rogue's own kit and the case the
 * property is written for; a shortsword because it is Light and prints Vex
 * rather than Nick; a greatclub because it is neither Light nor anything else.
 */
const table = (over: Partial<CharacterSheet> = {}, daggers = 2): readonly GameEvent[] => [
  added(PIP, 'party', over),
  added(GOBLIN, 'goblins', { abilities: { str: 8, dex: 6, con: 8, int: 8, wis: 8, cha: 8 } }),
  {
    type: 'items-gained',
    id: PIP,
    items: [
      { id: 'dagger', quantity: daggers },
      { id: 'shortsword', quantity: 1 },
      { id: 'greatclub', quantity: 1 },
    ],
    source: 'kit',
  },
  { type: 'scene-set', extent: { width: 600, depth: 600, height: 40 } },
  { type: 'landmark-added', name: 'the road', at: { x: 200, y: 200, z: 0 } },
  { type: 'creature-placed', id: PIP, placement: { from: { landmark: 'the road' }, feet: 0 } },
  {
    type: 'creature-placed',
    id: GOBLIN,
    placement: { from: { creature: PIP }, feet: 5, bearing: 90 },
  },
];

const fighting = (over: Partial<CharacterSheet> = {}, daggers = 2): readonly GameEvent[] => [
  ...table(over, daggers),
  {
    type: 'combat-started',
    combatants: [
      { id: PIP, initiative: 20, speed: 30 },
      { id: GOBLIN, initiative: 5, speed: 30 },
    ],
  },
];

/** The Attack action, swung with a dagger. */
const swingDagger = (state: GameState, seed = 'a') =>
  must(resolveAttack(state, PIP, { target: GOBLIN, weapon: 'dagger' }, supply(seed)));

const budget = (state: GameState) => state.combat?.budgets[PIP];

/**
 * What the weapon's own damage slice added without rolling for it.
 *
 * The ability modifier is the whole of it for a mundane weapon, which is what
 * makes it the thing to assert: the SRD sentence is about the modifier and not
 * about the total.
 */
const flatOf = (events: readonly GameEvent[]): number | null => {
  for (const event of events) {
    if (event.type !== 'damage-dice-recorded') continue;
    return event.components[0]?.flat ?? null;
  }
  return null;
};

describe('the Light property buys one extra attack with a different Light weapon', () => {
  const ready = () => fold('seed', fighting());

  it('records which Light weapon the Attack action swung', () => {
    const state = ready();
    expect(budget(state)?.lightWeaponSwung).toBeNull();
    const after = applyAll(state, swingDagger(state).events);
    expect(budget(after)?.lightWeaponSwung).toBe('dagger');
  });

  it('is refused before the Attack action has been taken', () => {
    const refused = resolveAttack(
      ready(),
      PIP,
      { target: GOBLIN, weapon: 'dagger', lightAttack: 'bonus-action' },
      supply('x'),
    );
    expect(isErr(refused) && refused.code).toBe('no_light_swing');
  });

  /** The Attack action was taken, and with something the property says nothing about. */
  it('is refused where the Attack action swung no Light weapon', () => {
    const state = ready();
    const clubbed = must(
      resolveAttack(state, PIP, { target: GOBLIN, weapon: 'greatclub' }, supply('c')),
    );
    const refused = resolveAttack(
      applyAll(state, clubbed.events),
      PIP,
      { target: GOBLIN, weapon: 'dagger', lightAttack: 'bonus-action' },
      supply('x'),
    );
    expect(isErr(refused) && refused.code).toBe('no_light_swing');
  });

  it('is refused with a weapon that is not Light', () => {
    const state = ready();
    const after = applyAll(state, swingDagger(state).events);
    const refused = resolveAttack(
      after,
      PIP,
      { target: GOBLIN, weapon: 'greatclub', lightAttack: 'bonus-action' },
      supply('x'),
    );
    expect(isErr(refused) && refused.code).toBe('not_light');
  });

  /** One dagger is one weapon, and the sentence asks for a different one. */
  it('is refused with the same dagger where only one is owned', () => {
    const state = fold('seed', fighting({}, 1));
    const after = applyAll(state, swingDagger(state).events);
    const refused = resolveAttack(
      after,
      PIP,
      { target: GOBLIN, weapon: 'dagger', lightAttack: 'bonus-action' },
      supply('x'),
    );
    expect(isErr(refused) && refused.code).toBe('same_weapon');
  });

  it('is refused with a Light weapon nobody owns', () => {
    const state = fold('seed', fighting({}, 2));
    const after = applyAll(
      state,
      must(resolveAttack(state, PIP, { target: GOBLIN, weapon: 'dagger' }, supply('a'))).events,
    );
    const refused = resolveAttack(
      after,
      PIP,
      { target: GOBLIN, weapon: 'scimitar', lightAttack: 'bonus-action' },
      supply('x'),
    );
    expect(isErr(refused) && refused.code).toBe('not_owned');
  });

  /**
   * The swing itself, and the whole of what the second sentence changes: the
   * Dexterity modifier is on the Attack action's damage and off the extra
   * attack's.
   */
  it('takes the other dagger as a Bonus Action with no ability modifier on its damage', () => {
    const state = ready();
    const first = swingDagger(state, 'hit');
    const after = applyAll(state, first.events);

    const extra = must(
      resolveAttack(
        after,
        PIP,
        { target: GOBLIN, weapon: 'dagger', lightAttack: 'bonus-action' },
        supply('hit'),
      ),
    );
    const spent = applyAll(after, extra.events);
    expect(budget(spent)?.bonusAction).toBe(false);
    // The extra attack is not the Attack action and spends none of it.
    expect(extra.events.some((e) => e.type === 'attack-made')).toBe(false);

    expect(first.attack?.hit).toBe(true);
    expect(extra.attack?.hit).toBe(true);
    expect(flatOf(first.events)).toBe(3);
    expect(flatOf(extra.events)).toBe(0);
  });

  it('is refused a second time in the same turn', () => {
    const state = ready();
    const after = applyAll(state, swingDagger(state).events);
    const once = must(
      resolveAttack(
        after,
        PIP,
        { target: GOBLIN, weapon: 'shortsword', lightAttack: 'bonus-action' },
        supply('b'),
      ),
    );
    const again = resolveAttack(
      applyAll(after, once.events),
      PIP,
      { target: GOBLIN, weapon: 'dagger', lightAttack: 'bonus-action', commandId: 'second' },
      supply('c'),
    );
    expect(isErr(again) && again.code).toBe('already_swung');
  });

  /** And the record is the turn's: a new turn has swung nothing. */
  it('forgets the Light weapon at the end of the turn', () => {
    const start = fighting();
    let log: readonly GameEvent[] = [...start, ...swingDagger(fold('seed', start)).events];
    for (let step = 0; step < 2; step += 1) {
      log = [...log, ...must(resolveTurn(fold('seed', log), supply(`turn${step}`))).events];
    }
    expect(budget(fold('seed', log))?.lightWeaponSwung).toBeNull();
  });
});

describe('Nick pays for the same extra attack out of the Attack action', () => {
  const nimble = { weaponMasteries: ['dagger'] };

  it('rides the Attack action and leaves the Bonus Action alone', () => {
    const state = fold('seed', fighting(nimble));
    const after = applyAll(state, swingDagger(state).events);
    const extra = must(
      resolveAttack(
        after,
        PIP,
        { target: GOBLIN, weapon: 'dagger', lightAttack: 'attack-action' },
        supply('n'),
      ),
    );
    const spent = applyAll(after, extra.events);
    expect(budget(spent)?.bonusAction).toBe(true);
    // And it is still the Light property's extra attack: no modifier on it.
    if (extra.attack?.hit === true) expect(flatOf(extra.events)).toBe(0);
  });

  it('is refused to a character who has not unlocked the mastery', () => {
    const state = fold('seed', fighting());
    const after = applyAll(state, swingDagger(state).events);
    const refused = resolveAttack(
      after,
      PIP,
      { target: GOBLIN, weapon: 'dagger', lightAttack: 'attack-action' },
      supply('n'),
    );
    expect(isErr(refused) && refused.code).toBe('no_mastery');
  });

  it('is refused with a Light weapon that does not print Nick', () => {
    const state = fold('seed', fighting({ weaponMasteries: ['shortsword'] }));
    const after = applyAll(state, swingDagger(state).events);
    const refused = resolveAttack(
      after,
      PIP,
      { target: GOBLIN, weapon: 'shortsword', lightAttack: 'attack-action' },
      supply('n'),
    );
    expect(isErr(refused) && refused.code).toBe('no_nick');
  });

  it('is still only once a turn', () => {
    const state = fold('seed', fighting(nimble));
    const after = applyAll(state, swingDagger(state).events);
    const once = must(
      resolveAttack(
        after,
        PIP,
        { target: GOBLIN, weapon: 'dagger', lightAttack: 'attack-action' },
        supply('n'),
      ),
    );
    const again = resolveAttack(
      applyAll(after, once.events),
      PIP,
      {
        target: GOBLIN,
        weapon: 'shortsword',
        lightAttack: 'bonus-action',
        commandId: 'second',
      },
      supply('m'),
    );
    expect(isErr(again) && again.code).toBe('already_swung');
  });
});

describe('the Two-Weapon Fighting feat puts the modifier back', () => {
  const styled = {
    standing: [
      {
        feature: 'test:two-weapon-fighting',
        name: 'Two-Weapon Fighting',
        reach: { kind: 'self' as const },
        grant: { kind: 'light-extra-attack-damage' as const },
      },
    ],
  };

  const extraAttack = (over: Partial<CharacterSheet>, seed = 'hit') => {
    const state = fold('seed', fighting(over));
    const after = applyAll(state, swingDagger(state, seed).events);
    return must(
      resolveAttack(
        after,
        PIP,
        { target: GOBLIN, weapon: 'dagger', lightAttack: 'bonus-action' },
        supply(seed),
      ),
    );
  };

  it('adds the ability modifier to the extra attack’s damage', () => {
    const without = extraAttack({});
    const withFeat = extraAttack(styled);
    expect(without.attack?.hit).toBe(true);
    expect(withFeat.attack?.hit).toBe(true);
    expect(flatOf(without.events)).toBe(0);
    expect(flatOf(withFeat.events)).toBe(3);
  });

  /**
   * "unless that modifier is negative" — a floor rather than a switch, which
   * is what `withoutAbilityModifier` has always meant for Cleave. A Rogue with
   * a Dexterity of 8 still subtracts, feat or no feat.
   */
  it('keeps a negative modifier whether or not the feat is held', () => {
    // Both scores, because a Dagger is Finesse and the swing takes the better
    // of the two: a Strength of 10 beside a Dexterity of 8 is a +0 and not the
    // negative the clause is about.
    const feeble = { abilities: { str: 8, dex: 8, con: 12, int: 10, wis: 10, cha: 10 } };
    const bare = extraAttack(feeble, 's0');
    const withFeat = extraAttack({ ...feeble, ...styled }, 's0');
    expect(bare.attack?.hit).toBe(true);
    expect(withFeat.attack?.hit).toBe(true);
    expect(flatOf(bare.events)).toBe(-1);
    expect(flatOf(withFeat.events)).toBe(-1);
  });
});
