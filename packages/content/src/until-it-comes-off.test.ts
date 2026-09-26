import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import {
  asCharacterId,
  isErr,
  expect as unwrap,
  type CharacterId,
  type Result,
} from '@ie/shared';
import {
  LONG_REST,
  SHORT_REST,
  advanceTime,
  attuneItem,
  awardItems,
  beginRest,
  chargesLeft,
  createRng,
  createRollIssuer,
  damageCreature,
  declareDawn,
  endRest,
  equipItem,
  fold,
  rollImprovisedDamage,
  speedOf,
  unequipItem,
  useItem,
  type CharacterSheet,
  type GameEvent,
  type GameState,
  type Rng,
} from '@ie/engine';

/**
 * Treasure whose benefit lasts **until it comes off**, and a draught whose
 * benefit lasts until its drinker falls.
 *
 * SRD Armor of Invulnerability's Metal Shell lasts "for 10 minutes or until
 * you are no longer wearing the armor"; the Cloak of Invisibility's Invisible
 * "ends early if you pull the hood down (no action required) or cease wearing
 * the cloak"; Boots of Speed double a Speed "while you wear these boots". Each
 * was out under `items.ts` rule 3 — a conferral ran its span after the item
 * came off, which is a better item than the book prints — and the removal is
 * the cause that brings them in.
 *
 * Driven through the doors a player holds: `awardItems`, `equipItem`, a Short
 * Rest and `attuneItem`, `useItem`, and `unequipItem` to take the thing off.
 * Where the page prints a number the engine rolls, the test holds the roll to
 * the relation the page states and never to a face.
 */

const id = (s: string) => asCharacterId(s);
const USER = id('user');
const OTHER = id('other');

const ARMOR = 'armor-of-invulnerability';
const CLOAK = 'cloak-of-invisibility';
const BOOTS = 'boots-of-speed';
const MIST = 'potion-of-gaseous-form';
const POTION = 'potion-of-invisibility';

const sheet = (): CharacterSheet => ({
  level: 5,
  abilities: { str: 16, dex: 14, con: 12, int: 10, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: null,
  weaponProficiencies: ['simple', 'martial'],
});

const added = (who: CharacterId): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 200,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side: 'party',
});

const TABLE: readonly GameEvent[] = [added(USER), added(OTHER)];

const supply = (state: GameState, seed = 'treasure') => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

type Emitted = readonly GameEvent[] | { readonly events: readonly GameEvent[] };
const eventsOf = (value: Emitted): readonly GameEvent[] =>
  Array.isArray(value) ? value : (value as { readonly events: readonly GameEvent[] }).events;

const run = (
  log: readonly GameEvent[],
  command: (s: GameState) => Result<Emitted>,
  label = 'command',
): readonly GameEvent[] => [...log, ...eventsOf(unwrap(command(fold('seed', log)), label))];

/** A log built on first use, so a missing record fails its own tests rather than the file. */
const lazy = <T,>(build: () => T): (() => T) => {
  let built: { readonly value: T } | null = null;
  return () => (built ??= { value: build() }).value;
};

const awarded = (log: readonly GameEvent[], itemId: string, who: CharacterId = USER) =>
  run(log, (s) => awardItems(s, supply(s, 'hoard'), who, [{ id: itemId }], 'the hoard'), 'award');

/** Put on, rested an hour over, attuned, and up again: the whole path the bracket asks for. */
const attunedTo = (log: readonly GameEvent[], itemId: string, who: CharacterId = USER) => {
  const resting = run(
    run(
      run(log, (s) => equipItem(s, SRD_CONTENT, who, itemId), 'equip'),
      (s) => beginRest(s, who, 'short', `attune-${itemId}-${who}`),
      'rest',
    ),
    (s) => attuneItem(s, SRD_CONTENT, who, itemId),
    'attune',
  );
  return run(
    [...resting, { type: 'time-advanced', seconds: SHORT_REST, reason: 'attuning' }],
    (s) => endRest(s, who, { commandId: `attuned-${itemId}-${who}` }),
    'up',
  );
};

const use = (log: readonly GameEvent[], itemId: string, who: CharacterId = USER, seed = 'use') =>
  run(log, (s) => useItem(s, who, { item: itemId }, supply(s, seed)), `use ${itemId}`);

const takeOff = (log: readonly GameEvent[], itemId: string, who: CharacterId = USER) =>
  run(log, (s) => unequipItem(s, SRD_CONTENT, who, itemId), `unequip ${itemId}`);

const conditionsOf = (log: readonly GameEvent[], who: CharacterId = USER) =>
  fold('seed', log).creatures[who]?.conditions.conditions ?? [];

/** A sword's worth of Slashing, as the DM rolls it at the table. */
const sword = (log: readonly GameEvent[], seed: string) => {
  const state = fold('seed', log);
  return unwrap(
    rollImprovisedDamage(
      state,
      USER,
      { dice: '2d6', damageType: 'slashing', source: 'a sword' },
      supply(state, seed),
    ),
    'sword',
  );
};

/**
 * SRD Armor of Invulnerability: "You have Resistance to Bludgeoning, Piercing,
 * and Slashing damage while you wear this armor. **_Metal Shell._** You can
 * take a Magic action to give yourself Immunity to Bludgeoning, Piercing, and
 * Slashing damage for 10 minutes or until you are no longer wearing the armor.
 * Once this property is used, it can't be used again until the next dawn."
 */
describe('Armor of Invulnerability: Metal Shell, until the armour comes off', () => {
  const worn = lazy(() => attunedTo(awarded(TABLE, ARMOR), ARMOR));
  const shelled = lazy(() => use(worn(), ARMOR));

  it('is complete', () => {
    expect(SRD_CONTENT.item(ARMOR)?.unmodelled).toBeUndefined();
  });

  it('halves a sword while worn, and turns it aside entirely inside the shell', () => {
    const plain = sword(worn(), 'before');
    expect(plain.amount).toBe(Math.floor(plain.rolled / 2));
    const shelledCut = sword(shelled(), 'inside');
    expect(shelledCut.rolled).toBeGreaterThan(0);
    expect(shelledCut.amount).toBe(0);
  });

  it('ends when the armour comes off, and the next sword cuts', () => {
    const doffed = takeOff(shelled(), ARMOR);
    const cut = sword(doffed, 'after');
    expect(cut.amount).toBe(cut.rolled);
  });

  it('ends at ten minutes with the armour still on', () => {
    const nearly = run(shelled(), (s) => advanceTime(s, 599, 'all but'));
    expect(sword(nearly, 'nearly').amount).toBe(0);
    const over = run(nearly, (s) => advanceTime(s, 1, 'the ten minutes are up'));
    const cut = sword(over, 'over');
    expect(cut.amount).toBe(Math.floor(cut.rolled / 2));
  });

  it('cannot be raised again before a declared dawn, and can after it', () => {
    const again = run(takeOff(shelled(), ARMOR), (s) => equipItem(s, SRD_CONTENT, USER, ARMOR));
    const refused = useItem(fold('seed', again), USER, { item: ARMOR }, supply(fold('seed', again)));
    expect(isErr(refused) && refused.code).toBe('exhausted');

    const morning = run(again, (s) => declareDawn(s, supply(s, 'dawn')), 'dawn');
    expect(chargesLeft(fold('seed', morning), SRD_CONTENT, USER, ARMOR)).toBe(1);
    const raised = use(morning, ARMOR, USER, 'second');
    expect(sword(raised, 'second').amount).toBe(0);
  });
});

/**
 * SRD Cloak of Invisibility: "This cloak has 3 charges and regains 1d3
 * expended charges daily at dawn. While wearing the cloak, you can take a
 * Magic action to pull its hood over your head and expend 1 charge to give
 * yourself the Invisible condition for 1 hour. The effect ends early if you
 * pull the hood down (no action required) or cease wearing the cloak."
 */
describe('Cloak of Invisibility: an hour, until the cloak comes off', () => {
  const worn = lazy(() => attunedTo(awarded(TABLE, CLOAK), CLOAK));
  const hooded = lazy(() => use(worn(), CLOAK));

  it('is partial, and says the hood is the one clause it leaves out', () => {
    const notes = SRD_CONTENT.item(CLOAK)?.unmodelled ?? [];
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain('pull the hood down (no action required)');
  });

  it('spends a charge on the Invisible condition', () => {
    expect(chargesLeft(fold('seed', worn()), SRD_CONTENT, USER, CLOAK)).toBe(3);
    expect(conditionsOf(hooded())).toContain('invisible');
    expect(chargesLeft(fold('seed', hooded()), SRD_CONTENT, USER, CLOAK)).toBe(2);
  });

  it('ends the moment the cloak comes off', () => {
    expect(conditionsOf(takeOff(hooded(), CLOAK))).not.toContain('invisible');
  });

  it('keeps the hour for a wearer who keeps it on, and ends at the deadline', () => {
    const second = use(attunedTo(awarded(TABLE, CLOAK, OTHER), CLOAK, OTHER), CLOAK, OTHER);
    const nearly = run(second, (s) => advanceTime(s, 3599, 'all but'));
    expect(conditionsOf(nearly, OTHER)).toContain('invisible');
    const over = run(nearly, (s) => advanceTime(s, 1, 'the hour is up'));
    expect(conditionsOf(over, OTHER)).not.toContain('invisible');
  });

  it('refuses a wearer who has not attuned', () => {
    const merelyWorn = run(awarded(TABLE, CLOAK), (s) => equipItem(s, SRD_CONTENT, USER, CLOAK));
    const state = fold('seed', merelyWorn);
    const refused = useItem(state, USER, { item: CLOAK }, supply(state));
    expect(isErr(refused) && refused.code).toBe('not_attuned');
  });

  it('gives the Invisible to its wearer and to nobody else', () => {
    const state = fold('seed', worn());
    const refused = useItem(state, USER, { item: CLOAK, target: OTHER }, supply(state));
    expect(isErr(refused) && refused.code).toBe('not_the_wearer');
  });

  /**
   * **A Potion of Invisibility prints no garment.** Its Invisible is its own
   * instance under its own source, and taking the cloak off — or anything
   * else — leaves its hour running.
   */
  it('leaves a Potion of Invisibility’s Invisible alone when the cloak comes off', () => {
    const drunk = use(
      [...worn(), { type: 'items-gained', id: USER, items: [{ id: POTION, quantity: 1 }], source: 'kit' }],
      POTION,
    );
    expect(conditionsOf(takeOff(drunk, CLOAK))).toContain('invisible');
  });
});

/**
 * SRD Boots of Speed: "While you wear these boots, you can take a Bonus Action
 * to click the boots' heels together. If you do, the boots double your Speed,
 * and any creature that makes an Opportunity Attack against you has
 * Disadvantage on the attack roll. If you click your heels together again, you
 * end the effect. When you've used the boots' property for a total of 10
 * minutes, the magic ceases to function for you until you finish a Long Rest."
 */
describe('Boots of Speed: a doubled Speed, until the boots come off', () => {
  const worn = lazy(() => attunedTo(awarded(TABLE, BOOTS), BOOTS));
  const clicked = lazy(() => use(worn(), BOOTS));

  it('is partial, and names the three clauses it leaves out', () => {
    const notes = SRD_CONTENT.item(BOOTS)?.unmodelled ?? [];
    expect(notes.some((note) => note.includes('Opportunity Attack'))).toBe(true);
    expect(notes.some((note) => note.includes('click your heels together again'))).toBe(true);
    expect(notes.some((note) => note.includes('for a total of 10 minutes'))).toBe(true);
  });

  it('doubles the wearer’s Speed', () => {
    expect(speedOf(fold('seed', worn()), USER)).toBe(30);
    expect(speedOf(fold('seed', clicked()), USER)).toBe(60);
  });

  it('gives the Speed back when the boots come off', () => {
    expect(speedOf(fold('seed', takeOff(clicked(), BOOTS)), USER)).toBe(30);
  });

  it('runs its ten minutes and no longer', () => {
    const nearly = run(clicked(), (s) => advanceTime(s, 599, 'all but'));
    expect(speedOf(fold('seed', nearly), USER)).toBe(60);
    const over = run(nearly, (s) => advanceTime(s, 1, 'the ten minutes are up'));
    expect(speedOf(fold('seed', over), USER)).toBe(30);
  });

  it('works again after a Long Rest, and not before', () => {
    const spent = run(clicked(), (s) => advanceTime(s, 600, 'spent'));
    const early = useItem(fold('seed', spent), USER, { item: BOOTS }, supply(fold('seed', spent)));
    expect(isErr(early) && early.code).toBe('exhausted');

    // A dawn is not a Long Rest, and the boots are not a dawn item.
    const morning = run(spent, (s) => declareDawn(s, supply(s, 'dawn')), 'dawn');
    expect(chargesLeft(fold('seed', morning), SRD_CONTENT, USER, BOOTS)).toBe(0);

    const slept = run(
      [
        ...run(spent, (s) => beginRest(s, USER, 'long', 'sleep'), 'sleep'),
        { type: 'time-advanced', seconds: LONG_REST, reason: 'sleeping' },
      ],
      (s) => endRest(s, USER, { commandId: 'woke' }),
      'wake',
    );
    expect(chargesLeft(fold('seed', slept), SRD_CONTENT, USER, BOOTS)).toBe(1);
    expect(speedOf(fold('seed', use(slept, BOOTS, USER, 'again')), USER)).toBe(60);
  });
});

/**
 * SRD Gaseous Form, which a Potion of Gaseous Form confers for an hour: "The
 * spell ends on the target if it drops to 0 Hit Points."
 */
describe('Potion of Gaseous Form: the cloud ends at 0 Hit Points', () => {
  const drunk = lazy(() =>
    use(
      [...TABLE, { type: 'items-gained', id: USER, items: [{ id: MIST, quantity: 1 }], source: 'kit' }],
      MIST,
    ),
  );
  const hurt = (log: readonly GameEvent[], amount: number) =>
    run(log, (s) => damageCreature(s, USER, { amount, source: 'a fall' }), 'hurt');

  it('no longer says the drinker keeps it at 0', () => {
    const notes = SRD_CONTENT.item(MIST)?.unmodelled ?? [];
    expect(notes.some((note) => note.includes('0 Hit Points'))).toBe(false);
  });

  it('survives a blow the drinker stands up to', () => {
    const state = fold('seed', hurt(drunk(), 199));
    expect(state.creatures[USER]!.vitals.hp).toBe(1);
    expect(speedOf(state, USER, 'fly')).toBe(10);
    expect(state.creatures[USER]!.grantedDefenses).toHaveLength(1);
  });

  it('ends on the blow that drops the drinker to 0', () => {
    const state = fold('seed', hurt(drunk(), 200));
    expect(state.creatures[USER]!.vitals.hp).toBe(0);
    expect(state.creatures[USER]!.grantedDefenses).toEqual([]);
    expect(speedOf(state, USER, 'fly')).toBe(0);
  });
});
