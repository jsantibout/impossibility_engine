import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap, type CharacterId, type Result } from '@ie/shared';
import type { CharacterSheet } from '@ie/engine';
import {
  advanceTime,
  attuneItem,
  awardItems,
  beginRest,
  chargesLeft,
  createRng,
  createRollIssuer,
  declareDawn,
  equipItem,
  fold,
  itemConferral,
  itemSource,
  resolveDamage,
  useItem,
  type GameEvent,
  type GameState,
  type Rng,
} from '@ie/engine';

/**
 * The two entries the item map's re-derivation freed, driven end to end.
 *
 * `ITEM_SHAPES` claimed two things that had stopped being true. It said of
 * `a-condition-an-item-imposes` that "what is **not** built is a condition
 * whose duration the item **rolls** for, which no conferral can state" — and
 * `durationRolled` had been a field on a conferral since the Potion of
 * Diminution landed, thrown once at the use and pinned. And it said of
 * `a-charge-spent-on-something-other-than-a-casting` that a priced conferral
 * was built while every entry naming the shape for a price still named it.
 *
 * So the two records below are not new mechanism; they are two SRD entries
 * that the vocabulary could already write down and nobody had. Each is driven
 * against the half of the claim it disproves:
 *
 * | | |
 * |---|---|
 * | Dust of Disappearance | a **condition** whose span the item rolls — "for 2d4 minutes" — ending early on the three causes the book prints |
 * | Periapt of Health | a conferral **priced in a charge**, out of a per-day pool of one on a worn item, recovering at a declared dawn |
 *
 * Both are partial transcriptions and say so in `unmodelled`: the dust's
 * Emanation catches companions a conferral has no second target for, and the
 * pendant's Advantage on saves against one named condition is
 * `a-save-keyed-to-a-condition`. What is driven here is what the records
 * claim, which is the only thing a transcription may be believed about.
 */

const id = (s: string) => asCharacterId(s);
const USER = id('user');
const FOE = id('foe');

const DUST = 'dust-of-disappearance';
const PERIAPT = 'periapt-of-health';

const sheet = (): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 12, con: 12, int: 10, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: null,
  weaponProficiencies: ['simple'],
});

const added = (who: CharacterId, maxHp = 40): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side: 'party',
});

const supply = (seed: string) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

const carrying = (itemId: string, quantity = 1): GameEvent => ({
  type: 'items-gained',
  id: USER,
  items: [{ id: itemId, quantity }],
  source: 'the hoard',
});

const TABLE: readonly GameEvent[] = [
  added(USER),
  added(FOE),
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
  { type: 'landmark-added', name: 'the table', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: USER, placement: { from: { landmark: 'the table' }, feet: 0 } },
  { type: 'creature-placed', id: FOE, placement: { from: { landmark: 'the table' }, feet: 5 } },
];

type Emitted = readonly GameEvent[] | { readonly events: readonly GameEvent[] };
const eventsOf = (value: Emitted): readonly GameEvent[] =>
  Array.isArray(value) ? value : (value as { readonly events: readonly GameEvent[] }).events;

const run = (
  log: readonly GameEvent[],
  command: (s: GameState) => Result<Emitted>,
): readonly GameEvent[] => [...log, ...eventsOf(unwrap(command(fold('seed', log)), 'command'))];

const conditionsOf = (log: readonly GameEvent[]): readonly string[] =>
  fold('seed', log).creatures[USER]?.conditions.conditions ?? [];

const hpOf = (log: readonly GameEvent[]): number =>
  fold('seed', log).creatures[USER]?.vitals.hp ?? 0;

describe('Dust of Disappearance: a condition whose span the dust rolls', () => {
  const dust = SRD_CONTENT.item(DUST);

  it('is a conferral with a rolled span and no printed one', () => {
    expect(dust?.kind).toBe('wondrous');
    const conferral = itemConferral(dust!);
    expect(conferral?.action).toBe('action');
    expect(conferral?.durationSeconds).toBeUndefined();
    expect(conferral?.durationRolled).toEqual({ dice: '2d4', secondsEach: 60 });
    expect(conferral?.effects.map((effect) => effect.kind)).toEqual(['condition']);
    expect(conferral?.endsEarly).toEqual([
      'target-attacks',
      'target-deals-damage',
      'target-casts',
    ]);
  });

  const thrown = run([...TABLE, carrying(DUST)], (s) => useItem(s, USER, { item: DUST }, supply('dust')));

  it('makes the thrower Invisible under the item’s own source', () => {
    expect(conditionsOf(thrown)).toContain('invisible');
    const instances = fold('seed', thrown).creatures[USER]!.conditions.instances;
    expect(instances.map((one) => one.source)).toEqual([itemSource(DUST)]);
  });

  /**
   * The die is the point: the span is thrown once, at the use, and what
   * reaches the fold is the deadline it decided rather than the dice.
   */
  it('throws 2d4 minutes once and pins the moment it decided', () => {
    const rolled = thrown.filter((e) => e.type === 'roll-recorded');
    expect(rolled).toHaveLength(1);
    const roll = rolled[0] as { label: string; total: number };
    expect(roll.label).toContain('2d4');
    expect(roll.total).toBeGreaterThanOrEqual(2);
    expect(roll.total).toBeLessThanOrEqual(8);

    const timers = Object.values(fold('seed', thrown).timers);
    expect(timers).toHaveLength(1);
    expect(timers[0]?.deadline).toEqual({ kind: 'elapsed', at: roll.total * 60 });
  });

  it('runs that span out on the clock, and not a second before', () => {
    const at = (Object.values(fold('seed', thrown).timers)[0]?.deadline as { at: number }).at;
    const nearly = run(thrown, (s) => advanceTime(s, at - 1, 'all but gone'));
    expect(conditionsOf(nearly)).toContain('invisible');
    const over = run(nearly, (s) => advanceTime(s, 2, 'and past it'));
    expect(conditionsOf(over)).not.toContain('invisible');
  });

  /** "Immediately after an affected creature ... deals damage" — the book's own cause. */
  it('ends the moment the thrower deals damage', () => {
    const dealt = run(thrown, (s) =>
      resolveDamage(s, FOE, { amount: 5, source: 'a dagger', by: USER }, supply('stab')),
    );
    expect(conditionsOf(dealt)).not.toContain('invisible');
  });

  /** "the dust is consumed when its magic takes effect": one use, and it is gone. */
  it('consumes the dust', () => {
    expect(fold('seed', thrown).creatures[USER]!.inventory).toEqual([]);
  });

  /**
   * The die is the whole reason this needs saying: a conferral that threw its
   * span at the *fold* rather than at the command would give a different hour
   * to every replay. So the use is **driven a second time** from the same seed
   * against the same state, and the two logs are compared — which is a claim
   * about the command, where folding one array twice would have been a claim
   * about `toEqual`.
   */
  it('emits the same log when the same use is driven again from the same seed', () => {
    const again = run([...TABLE, carrying(DUST)], (s) =>
      useItem(s, USER, { item: DUST }, supply('dust')),
    );
    expect(again).toEqual(thrown);
    expect(fold('seed', again)).toEqual(fold('seed', thrown));

    // And a different seed really can move it, so the agreement above is the
    // seed's doing rather than a span that was never random.
    const spans = new Set(
      ['dust', 'ash', 'chalk', 'grit', 'powder', 'sand'].map((seed) => {
        const log = run([...TABLE, carrying(DUST)], (s) =>
          useItem(s, USER, { item: DUST }, supply(seed)),
        );
        return (Object.values(fold('seed', log).timers)[0]?.deadline as { at: number }).at;
      }),
    );
    expect(spans.size).toBeGreaterThan(1);
  });
});

describe('Periapt of Health: a conferral priced in a charge', () => {
  const periapt = SRD_CONTENT.item(PERIAPT);

  it('prices one use at one charge out of a per-day pool of one', () => {
    const conferral = itemConferral(periapt!);
    expect(conferral?.action).toBe('action');
    expect(conferral?.charges).toBe(1);
    expect(conferral?.effects.map((effect) => effect.kind)).toEqual(['heal']);

    const pool = (periapt?.grants ?? []).find((grant) => grant.kind === 'pool');
    expect(pool).toMatchObject({ uses: 1, recovers: 'dawn' });
    expect(periapt?.attunement).toBeDefined();
  });

  /**
   * Handed over, worn, rested over and attuned — the whole path the bracket
   * asks for, and the pendant arrives through `awardItems` because a copy
   * with a charge pool is labelled at its birth or it has no pool at all.
   */
  const given = run([...TABLE], (s) =>
    awardItems(s, supply('hoard'), USER, [{ id: PERIAPT }], 'the hoard'),
  );
  const worn = run(
    run(
      run(given, (s) => equipItem(s, SRD_CONTENT, USER, PERIAPT)),
      (s) => beginRest(s, USER, 'short'),
    ),
    (s) => attuneItem(s, SRD_CONTENT, USER, PERIAPT),
  );

  const wounded: readonly GameEvent[] = [
    ...worn,
    { type: 'damage-taken', id: USER, amount: 20, source: 'a fall' } as GameEvent,
  ];

  it('heals 2d4 + 2 and spends the day’s one use', () => {
    const before = hpOf(wounded);
    const used = run(wounded, (s) => useItem(s, USER, { item: PERIAPT }, supply('periapt')));
    const healed = hpOf(used) - before;
    expect(healed).toBeGreaterThanOrEqual(4);
    expect(healed).toBeLessThanOrEqual(10);
    expect(chargesLeft(fold('seed', used), SRD_CONTENT, USER, PERIAPT)).toBe(0);
  });

  it('refuses a second use before the morning, and gives it back at a declared dawn', () => {
    const used = run(wounded, (s) => useItem(s, USER, { item: PERIAPT }, supply('periapt')));
    const again = useItem(fold('seed', used), USER, { item: PERIAPT }, supply('again'));
    expect(isErr(again)).toBe(true);

    const morning = run(used, (s) => declareDawn(s, supply('dawn')));
    expect(chargesLeft(fold('seed', morning), SRD_CONTENT, USER, PERIAPT)).toBe(1);
    const twice = run(morning, (s) => useItem(s, USER, { item: PERIAPT }, supply('twice')));
    expect(hpOf(twice)).toBeGreaterThan(hpOf(morning));
  });

  /** The bracket the book prints is a requirement: worn is not enough. */
  it('refuses the use to a wearer who has not attuned', () => {
    const unattuned = run(given, (s) => equipItem(s, SRD_CONTENT, USER, PERIAPT));
    const refused = useItem(fold('seed', unattuned), USER, { item: PERIAPT }, supply('bare'));
    expect(isErr(refused)).toBe(true);
    if (isErr(refused)) expect(refused.code).toBe('not_attuned');
  });

  /** And a worn item that costs a charge is used where it is worn, not taken off. */
  it('is used while it is worn', () => {
    const used = run(wounded, (s) => useItem(s, USER, { item: PERIAPT }, supply('periapt')));
    expect(fold('seed', used).creatures[USER]!.equipped.map((one) => one.id)).toContain(PERIAPT);
    expect(fold('seed', used).creatures[USER]!.inventory.map((one) => one.id)).toContain(PERIAPT);
  });
});
