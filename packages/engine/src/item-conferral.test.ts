import { SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import {
  asCharacterId,
  isErr,
  isNeedsContext,
  expect as unwrap,
  type CharacterId,
  type Result,
} from '@ie/shared';
import { itemConferral, itemSource, type CatalogueItem } from './catalogue.js';
import { checkContent, type Content, loadContent } from './content.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { timerKey } from './timers.js';
import { castingIdOf } from './spells.js';
import type { CharacterSheet } from './character.js';
import {
  advanceTime,
  damageCreature,
  ongoingSpellsOn,
  removeBonusFrom,
  useItem,
} from './commands.js';

/**
 * An item that confers an effect **without casting one**.
 *
 * SRD "Magic Items" settles the shape in one sentence and the engine does not
 * have to have an opinion: "Many items, such as Potions, **bypass the casting
 * of a spell** and confer the spell's effects with its usual duration." So a
 * potion is not a casting — there is no casting id, no `spell-cast`, nothing in
 * `ongoing` and nothing for Dispel Magic to find — and what it leaves behind is
 * addressed by the bare source `item:<catalogue id>`, exactly as a feature's
 * grant is addressed by the feature's own id.
 *
 * The casting is **absent rather than faked**. `castingIdOf` matches only
 * `cast:N`, so `releaseCasting`, `ongoingSpellsOn`, `spellOn` and the Dispel
 * resolver skip an item's effect by construction rather than by being told to.
 *
 * Two printed potions carry the file — Potion of Healing end to end, and
 * Potion of Heroism as the case with something to address — and two homebrew
 * flasks carry the saving throw, because no SRD item this catalogue has
 * transcribed rolls one.
 */

const id = (s: string) => asCharacterId(s);
const DRINKER = id('drinker');
const FRIEND = id('friend');
const STRANGER = id('stranger');

const HEALING = 'potion-of-healing';
const HEROISM = 'potion-of-heroism';

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: null,
  weaponProficiencies: ['simple'],
  ...over,
});

const added = (who: CharacterId): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 40,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side: 'party',
});

const supply = (seed = 'potion', content: Content = SRD_CONTENT) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content,
});

/** Drinker and friend side by side; the stranger is thirty feet off. */
const SCENE: readonly GameEvent[] = [
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
  { type: 'landmark-added', name: 'the table', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: DRINKER, placement: { from: { landmark: 'the table' }, feet: 0 } },
  {
    type: 'creature-placed',
    id: FRIEND,
    placement: { from: { creature: DRINKER }, feet: 5, bearing: 90 },
  },
  {
    type: 'creature-placed',
    id: STRANGER,
    placement: { from: { creature: DRINKER }, feet: 30, bearing: 180 },
  },
];

const carrying = (
  itemId: string,
  quantity = 1,
  who: CharacterId = DRINKER,
): readonly GameEvent[] => [
  { type: 'items-gained', id: who, items: [{ id: itemId, quantity }], source: 'the hoard' },
];

const TABLE: readonly GameEvent[] = [added(DRINKER), added(FRIEND), added(STRANGER), ...SCENE];

/** A command's events, whether it returns a bare batch or a resolution. */
type Emitted = readonly GameEvent[] | { readonly events: readonly GameEvent[] };
const eventsOf = (value: Emitted): readonly GameEvent[] =>
  Array.isArray(value) ? value : (value as { readonly events: readonly GameEvent[] }).events;

const run = (
  log: readonly GameEvent[],
  command: (s: GameState) => Result<Emitted>,
): readonly GameEvent[] => [...log, ...eventsOf(unwrap(command(fold('seed', log)), 'command'))];

const hurt = (who: CharacterId, amount: number): ((log: readonly GameEvent[]) => readonly GameEvent[]) =>
  (log) => [
    ...log,
    ...unwrap(damageCreature(fold('seed', log), who, { amount, source: 'a spear' }), 'hurt'),
  ];

const bonusesOf = (log: readonly GameEvent[], who: CharacterId = DRINKER) =>
  fold('seed', log).creatures[who]!.bonuses;

describe('a potion is content, and what it confers is a grant kind', () => {
  it('carries a confers grant the catalogue reader finds', () => {
    const potion = SRD_CONTENT.item(HEALING);
    expect(potion?.kind).toBe('potion');
    const conferral = itemConferral(potion!);
    expect(conferral?.action).toBe('bonus-action');
    expect(conferral?.effects.map((effect) => effect.kind)).toEqual(['heal']);
  });

  /** One spelling of the source, shared with the casting route's label. */
  it('names its source the way the log spells one', () => {
    expect(itemSource(HEROISM)).toBe('item:potion-of-heroism');
  });

  it('confers nothing from an item that confers nothing', () => {
    expect(itemConferral(SRD_CONTENT.item('longsword')!)).toBeNull();
  });
});

describe('Potion of Healing, end to end', () => {
  const thirsty = hurt(DRINKER, 20)([...TABLE, ...carrying(HEALING)]);

  it('heals the drinker, uses the potion up and rolls the engine’s dice', () => {
    const out = unwrap(
      useItem(fold('seed', thirsty), DRINKER, { item: HEALING }, supply()),
      'drink',
    );

    // SRD: "The creature that drinks ... regains 2d4 + 2 Hit Points."
    const healed = out.events.find((e) => e.type === 'roll-recorded');
    expect(healed?.label).toBe('Potion of Healing healing');
    expect(healed!.total).toBeGreaterThanOrEqual(4);
    expect(healed!.total).toBeLessThanOrEqual(10);

    // The potion is used up: one of them, gone, in the same batch.
    const lost = out.events.find((e) => e.type === 'items-lost');
    expect(lost?.items).toEqual([{ id: HEALING, quantity: 1 }]);

    // And the generator's movement is recorded, so a replay lands where the
    // original did.
    expect(out.events.at(-1)?.type).toBe('rolls-issued');

    const after = fold('seed', [...thirsty, ...out.events]);
    expect(after.creatures['drinker']!.inventory).toEqual([]);
    expect(after.creatures['drinker']!.vitals.hp).toBe(20 + healed!.total);
  });

  /** The determinism ship criterion, on the smallest thing that rolls. */
  it('rolls the same total from the same seed, and a different one from another', () => {
    const once = unwrap(useItem(fold('seed', thirsty), DRINKER, { item: HEALING }, supply('a')), 'a');
    const again = unwrap(useItem(fold('seed', thirsty), DRINKER, { item: HEALING }, supply('a')), 'a');
    expect(again.events).toEqual(once.events);

    const elsewhere = unwrap(
      useItem(fold('seed', thirsty), DRINKER, { item: HEALING }, supply('b')),
      'b',
    );
    expect(elsewhere.events).not.toEqual(once.events);
  });

  /**
   * SRD: "you can drink it **or administer it to another creature within 5
   * feet of yourself**." The reach rule is the one `commands/features.ts`
   * already writes for a Paladin's touch, lifted rather than copied.
   */
  it('administers it to somebody else within five feet', () => {
    const log = hurt(FRIEND, 15)(thirsty);
    const out = unwrap(
      useItem(fold('seed', log), DRINKER, { item: HEALING, target: FRIEND }, supply()),
      'administer',
    );
    const after = fold('seed', [...log, ...out.events]);
    expect(after.creatures['friend']!.vitals.hp).toBeGreaterThan(25);
    // The drinker paid for it and did not drink it.
    expect(after.creatures['drinker']!.vitals.hp).toBe(20);
    expect(after.creatures['drinker']!.inventory).toEqual([]);
  });

  it('refuses a creature out of reach, and the potion is not spent', () => {
    const issuer = createRollIssuer('r');
    const out = useItem(
      fold('seed', thirsty),
      DRINKER,
      { item: HEALING, target: STRANGER },
      { ...supply(), issuer },
    );
    expect(isErr(out) ? out.code : 'ok').toBe('out_of_reach');
    expect(issuer.count).toBe(0);
    expect(fold('seed', thirsty).creatures['drinker']!.inventory).toEqual([
      { id: HEALING, quantity: 1 },
    ]);
  });

  /** Unknown is not false: a creature nobody has added is asked about. */
  it('asks about a target nobody has added rather than refusing it', () => {
    const out = useItem(
      fold('seed', thirsty),
      DRINKER,
      { item: HEALING, target: id('nobody') },
      supply(),
    );
    expect(isNeedsContext(out)).toBe(true);
    expect(isErr(out) ? out.requests?.map((request) => request.kind) : []).toEqual(['creature']);
  });

  it('refuses a potion nobody is carrying', () => {
    const out = useItem(fold('seed', TABLE), DRINKER, { item: HEALING }, supply());
    expect(isErr(out) ? out.code : 'ok').toBe('not_owned');
  });

  it('refuses an item that confers nothing', () => {
    const log = [...TABLE, ...carrying('longsword')];
    const out = useItem(fold('seed', log), DRINKER, { item: 'longsword' }, supply());
    expect(isErr(out) ? out.code : 'ok').toBe('item_confers_nothing');
  });

  /** SRD: "Drinking a potion ... requires a Bonus Action." */
  it('spends a Bonus Action in combat, and nothing outside one', () => {
    const fighting: readonly GameEvent[] = [
      ...thirsty,
      { type: 'combat-started', combatants: [{ id: DRINKER, initiative: 15, speed: 30 }] },
    ];
    const out = unwrap(useItem(fold('seed', fighting), DRINKER, { item: HEALING }, supply()), 'sip');
    expect(out.events[0]).toEqual({ type: 'bonus-action-spent', id: DRINKER });

    const calm = unwrap(useItem(fold('seed', thirsty), DRINKER, { item: HEALING }, supply()), 'sip');
    expect(calm.events.some((e) => e.type === 'bonus-action-spent')).toBe(false);
  });

  /**
   * Rule 5: what a command reads from content is pinned into the events it
   * emits, so the fold never opens a catalogue.
   */
  it('folds the same with the catalogue and without it', () => {
    const drunk = run(thirsty, (s) => useItem(s, DRINKER, { item: HEALING }, supply()));
    expect(fold('seed', drunk)).toStrictEqual(fold('seed', drunk, SRD_CONTENT));
  });
});

describe('Potion of Heroism: an effect with something to address', () => {
  const held = [...TABLE, ...carrying(HEROISM, 2)];
  const drunk = run(held, (s) => useItem(s, DRINKER, { item: HEROISM }, supply()));

  it('hangs the bonus under a bare item source that belongs to no casting', () => {
    const [bonus] = bonusesOf(drunk);
    expect(bonus?.source).toBe('item:potion-of-heroism');
    expect(castingIdOf(bonus!.source)).toBeNull();
    expect(bonus?.applies).toEqual(['attack', 'save']);
  });

  /**
   * The casting is absent rather than faked, which is the whole decision: no
   * record for Dispel Magic to find and nothing in `ongoing`.
   */
  it('makes no casting, so nothing ongoing is on the drinker', () => {
    const state = fold('seed', drunk);
    expect(state.ongoing).toEqual({});
    expect(ongoingSpellsOn(state, DRINKER)).toEqual([]);
    expect(drunk.some((e) => e.type === 'spell-cast')).toBe(false);
  });

  /** SRD: "that last for 1 hour". The hour is a `grants` timer on the clock. */
  it('files a grants timer an hour out', () => {
    const before = fold('seed', held);
    const state = fold('seed', drunk);
    const key = timerKey({ kind: 'grants', on: DRINKER, source: itemSource(HEROISM) });
    expect(state.timers[key]?.deadline).toEqual({ kind: 'elapsed', at: before.elapsed + 3600 });
  });

  it('wears off on the clock, with no event and no command', () => {
    const later = run(drunk, (s) => advanceTime(s, 3599, 'most of an hour'));
    expect(bonusesOf(later)).toHaveLength(1);

    const gone = run(later, (s) => advanceTime(s, 1, 'the last second'));
    expect(bonusesOf(gone)).toEqual([]);
    expect(fold('seed', gone).timers).toEqual({});
  });

  /** The early door, which `removeBonusFrom`'s docstring already named. */
  it('can be ended early by name', () => {
    const ended = run(drunk, (s) => removeBonusFrom(s, DRINKER, itemSource(HEROISM)));
    expect(bonusesOf(ended)).toEqual([]);
  });

  /**
   * SRD "Combining Magical Effects": "the effects of the same spell cast
   * multiple times don't combine ... only the effect of the longer duration
   * applies." A second potion is the same source, so the fold replaces rather
   * than stacks and the hour starts again.
   */
  it('replaces and refreshes when a second one is drunk inside the hour', () => {
    const halfway = run(drunk, (s) => advanceTime(s, 1800, 'half an hour'));
    const again = run(halfway, (s) => useItem(s, DRINKER, { item: HEROISM }, supply('second')));

    expect(bonusesOf(again)).toHaveLength(1);
    const state = fold('seed', again);
    const key = timerKey({ kind: 'grants', on: DRINKER, source: itemSource(HEROISM) });
    expect(state.timers[key]?.deadline).toEqual({ kind: 'elapsed', at: 1800 + 3600 });

    // **The Temporary Hit Points are the exception, and it is the pool's own
    // rule rather than this potion's.** SRD: they do not stack — "you choose
    // whether to keep the ones you have or gain the new ones" — and a second
    // ten over a held ten leaves the pool exactly where it was, so the points
    // being held are still the *first* draught's and they keep the hour that
    // was hung on them. `fold/vitals.ts` decides that, by the pool moving or
    // not; `useItem` asks the same question and gets the same answer, which is
    // the only way the two cannot come to disagree.
    const pool = timerKey({ kind: 'temporary-hit-points', on: DRINKER });
    expect(state.timers[pool]?.deadline).toEqual({ kind: 'elapsed', at: 3600 });
    expect(Object.keys(state.timers).sort()).toEqual([key, pool].sort());
  });

  it('folds the same with the catalogue and without it', () => {
    expect(fold('seed', drunk)).toStrictEqual(fold('seed', drunk, SRD_CONTENT));
  });

  /**
   * SRD: "you gain 10 Temporary Hit Points". A printed number with no dice
   * behind it, which is what `DiceScaling.dice` became optional for — so the
   * ten are handed over exactly, and nothing is thrown for them.
   */
  it('hands over the ten Temporary Hit Points, rolling nothing for them', () => {
    expect(fold('seed', drunk).creatures['drinker']!.vitals.temporaryHp).toBe(10);
    // Bless's 1d4 is a stored bonus rolled when a later roll reads it, and the
    // potion's own numbers are all printed — so the whole draught throws
    // nothing and the generator stands where it was.
    expect(drunk.some((e) => e.type === 'rolls-issued')).toBe(false);
  });

  /**
   * SRD: "you gain 10 Temporary Hit Points **that last for 1 hour**." The
   * clause the item's line used to record as unmodelled, because nothing could
   * hang a deadline on a pool. `EffectTarget` names one now, so the conferral
   * files a third timer beside the condition's and the grant's — keyed by the
   * creature, because a creature holds exactly one pool.
   */
  it('puts the printed hour on the Temporary Hit Points', () => {
    const key = timerKey({ kind: 'temporary-hit-points', on: DRINKER });
    expect(fold('seed', drunk).timers[key]?.deadline).toEqual({ kind: 'elapsed', at: 3600 });
  });

  it('keeps them for the hour and takes them at the end of it', () => {
    const nearly = run(drunk, (s) => advanceTime(s, 3599, 'most of an hour'));
    expect(fold('seed', nearly).creatures['drinker']!.vitals.temporaryHp).toBe(10);

    const after = run(nearly, (s) => advanceTime(s, 1, 'the last second'));
    const state = fold('seed', after);
    expect(state.creatures['drinker']!.vitals.temporaryHp).toBe(0);
    // The Bless half goes on the same second, and nothing is left standing.
    expect(state.creatures['drinker']!.bonuses).toEqual([]);
    expect(state.timers).toEqual({});
  });

  /** And the potion's line no longer records a clause it now keeps. */
  it('records nothing unmodelled about the hour', () => {
    expect(SRD_CONTENT.item(HEROISM)?.unmodelled ?? []).toEqual([]);
  });

  /**
   * **The timer is filed only where the grant was taken.**
   *
   * `grantTemporaryHp` keeps the larger pool, so a ten poured over a held
   * twenty changes nothing — and the key is the *creature*, not the source, so
   * a deadline filed anyway would sit over points this potion never granted
   * and end them an hour early. The owner's ruling of 2026-09-18 is what that
   * would break: Temporary Hit Points with no stated duration last until they
   * are spent or until a Long Rest.
   */
  it('files no deadline over a bigger pool it did not replace', () => {
    const stocked: readonly GameEvent[] = [
      ...held,
      { type: 'temporary-hp-granted', id: DRINKER, amount: 20 },
    ];
    const sipped = run(stocked, (s) => useItem(s, DRINKER, { item: HEROISM }, supply()));
    const state = fold('seed', sipped);

    expect(state.creatures['drinker']!.vitals.temporaryHp).toBe(20);
    expect(state.timers[timerKey({ kind: 'temporary-hit-points', on: DRINKER })]).toBeUndefined();

    // The twenty outlive the potion's hour, which is the whole point.
    const after = run(sipped, (s) => advanceTime(s, 3600, 'the hour'));
    expect(fold('seed', after).creatures['drinker']!.vitals.temporaryHp).toBe(20);
  });

  /** A bigger grant *does* replace the pool, and brings its own hour with it. */
  it('files one over a smaller pool it did replace', () => {
    const stocked: readonly GameEvent[] = [
      ...held,
      { type: 'temporary-hp-granted', id: DRINKER, amount: 4 },
    ];
    const sipped = run(stocked, (s) => useItem(s, DRINKER, { item: HEROISM }, supply()));
    const state = fold('seed', sipped);

    expect(state.creatures['drinker']!.vitals.temporaryHp).toBe(10);
    expect(state.timers[timerKey({ kind: 'temporary-hit-points', on: DRINKER })]?.deadline).toEqual(
      { kind: 'elapsed', at: 3600 },
    );
  });

  /**
   * **A potion whose only clause is the pool may state the hour too.**
   *
   * `conferral_lifetime_ends_nothing` refuses a duration that would end
   * nothing, and the hour on Temporary Hit Points ends something — so the
   * validator lets one through where nothing else is hung. It is still not
   * *required*: unstated, the points last until they are spent or until a
   * Long Rest, which is the owner's ruling of 2026-09-18 and a complete item
   * rather than an unfinished one.
   */
  it('lets an item hang an hour on nothing but the pool, and lets it hang none', () => {
    const vigour = (over: Record<string, unknown>) => ({
      id: 'potion-of-vigour',
      name: 'Potion of Vigour',
      kind: 'potion',
      weightLb: 0.5,
      costCp: null,
      armor: null,
      weapon: null,
      contents: [],
      grants: [
        {
          kind: 'confers',
          action: 'bonus-action',
          effects: [{ kind: 'temp-hp', amount: { flat: 8 }, addSpellcastingModifier: false }],
          ...over,
        },
      ],
    });
    expect(checkContent({ items: [vigour({ durationSeconds: 60 }) as unknown as CatalogueItem] }))
      .toEqual([]);
    expect(checkContent({ items: [vigour({}) as unknown as CatalogueItem] })).toEqual([]);

    // And the one that states an hour really files it, while the one that
    // states none files nothing at all.
    const timed = unwrap(loadContent({ items: [vigour({ durationSeconds: 60 })] }), 'load');
    const open = unwrap(loadContent({ items: [vigour({})] }), 'load');
    const pool = timerKey({ kind: 'temporary-hit-points', on: DRINKER });
    const log = [...TABLE, ...carrying('potion-of-vigour')];

    const withHour = run(log, (s) =>
      useItem(s, DRINKER, { item: 'potion-of-vigour' }, supply('vigour', timed)),
    );
    expect(fold('seed', withHour).timers[pool]?.deadline).toEqual({ kind: 'elapsed', at: 60 });

    const without = run(log, (s) =>
      useItem(s, DRINKER, { item: 'potion-of-vigour' }, supply('vigour', open)),
    );
    expect(fold('seed', without).timers).toEqual({});
    expect(fold('seed', without).creatures['drinker']!.vitals.temporaryHp).toBe(8);

    // And two helpings in one line are one pool, so they are one deadline:
    // the key is the creature, and a second identical `effect-scheduled`
    // would be a line in the log saying nothing the first did not.
    const twice = unwrap(
      loadContent({
        items: [
          {
            ...vigour({ durationSeconds: 60 }),
            grants: [
              {
                kind: 'confers',
                action: 'bonus-action',
                durationSeconds: 60,
                effects: [
                  { kind: 'temp-hp', amount: { flat: 8 }, addSpellcastingModifier: false },
                  { kind: 'temp-hp', amount: { flat: 12 }, addSpellcastingModifier: false },
                ],
              },
            ],
          },
        ],
      }),
      'load',
    );
    const doubled = unwrap(
      useItem(
        fold('seed', log),
        DRINKER,
        { item: 'potion-of-vigour' },
        supply('vigour', twice),
      ),
      'drink',
    );
    expect(
      doubled.events.filter(
        (event) =>
          event.type === 'effect-scheduled' && event.target.kind === 'temporary-hit-points',
      ),
    ).toHaveLength(1);
    expect(fold('seed', [...log, ...doubled.events]).creatures['drinker']!.vitals.temporaryHp).toBe(
      12,
    );
  });

  /**
   * The order the fold needs, asserted as an order.
   *
   * `temporary-hp-granted` drops whatever deadline stood over the pool it
   * replaced, so an `effect-scheduled` written *before* it would be thrown
   * away by the very event that made it necessary. `applyConditionTo` writes
   * the condition first and its timer behind it, and this is the same rule on
   * the pool.
   */
  it('logs the grant before the deadline that measures it', () => {
    const granted = drunk.findIndex((event) => event.type === 'temporary-hp-granted');
    const scheduled = drunk.findIndex(
      (event) => event.type === 'effect-scheduled' && event.target.kind === 'temporary-hit-points',
    );
    expect(granted).toBeGreaterThanOrEqual(0);
    expect(scheduled).toBeGreaterThan(granted);

    // And the order is load-bearing rather than incidental: the same two
    // events the other way round fold to a pool with no deadline on it.
    const reversed = [...drunk];
    [reversed[granted], reversed[scheduled]] = [reversed[scheduled]!, reversed[granted]!];
    expect(fold('seed', reversed).timers[timerKey({ kind: 'temporary-hit-points', on: DRINKER })])
      .toBeUndefined();
  });
});

/**
 * Rule 4: a potion nobody wrote engine code for, loaded from JSON text and
 * drunk through the public API.
 */
const DRAUGHT = JSON.stringify({
  id: 'draught-of-the-steady-hand',
  name: 'Draught of the Steady Hand',
  kind: 'potion',
  weightLb: 0.5,
  costCp: null,
  armor: null,
  weapon: null,
  contents: [],
  grants: [
    {
      kind: 'confers',
      action: 'bonus-action',
      durationSeconds: 600,
      effects: [
        {
          kind: 'buff',
          bonus: { source: 'Draught of the Steady Hand', flat: 2 },
          applies: ['attack'],
          direction: 'add',
        },
        { kind: 'temp-hp', amount: { dice: '1d6', flat: 1 }, addSpellcastingModifier: false },
      ],
    },
  ],
});

describe('a homebrew potion goes through the same door as the book', () => {
  const content = unwrap(loadContent({ items: [JSON.parse(DRAUGHT)] }), 'load');
  const DRAFT = 'draught-of-the-steady-hand';

  it('is parsed from JSON text and validated beside the printed potions', () => {
    expect(itemConferral(content.item(DRAFT)!)?.durationSeconds).toBe(600);
    expect(SRD_CONTENT.item(DRAFT)).toBeNull();
  });

  it('is drunk through the public API with no engine change', () => {
    const log = [...TABLE, ...carrying(DRAFT)];
    const out = unwrap(
      useItem(fold('seed', log), DRINKER, { item: DRAFT }, supply('draught', content)),
      'drink',
    );
    const after = fold('seed', [...log, ...out.events]);

    expect(after.creatures['drinker']!.bonuses.map((b) => b.source)).toEqual([
      'item:draught-of-the-steady-hand',
    ]);
    expect(after.creatures['drinker']!.vitals.temporaryHp).toBeGreaterThanOrEqual(2);
    expect(after.creatures['drinker']!.inventory).toEqual([]);

    // Ten minutes, on the clock, from an item the engine has never heard of.
    const key = timerKey({ kind: 'grants', on: DRINKER, source: itemSource(DRAFT) });
    expect(after.timers[key]?.deadline).toEqual({ kind: 'elapsed', at: 600 });

    // And the log stands on its own.
    expect(fold('seed', [...log, ...out.events])).toStrictEqual(
      fold('seed', [...log, ...out.events], content),
    );
  });
});

/**
 * **A conferral that prints a save DC.**
 *
 * The DC is the **item's**. SRD writes it as the item's own clause — Wand of
 * Fireballs' "(save DC 15)" — so a wand held by an archmage still saves
 * against fifteen, and the number reaches the roll from the grant rather than
 * from anybody's sheet. It is read at resolution and never by the fold: what
 * the log keeps is the die, the total and what the outcome did.
 *
 * Both potions here are homebrew, because **no SRD item this brief transcribed
 * fits**: Potion of Poison's 4d6 lands whether the save is made or not, and an
 * unconditional hit is the shape Magic Missile is blocked on. See the note
 * above `POTIONS` in `packages/content/src/items.ts`.
 */
const VENOM = JSON.stringify({
  id: 'flask-of-plain-venom',
  name: 'Flask of Plain Venom',
  kind: 'potion',
  weightLb: 0.5,
  costCp: null,
  armor: null,
  weapon: null,
  contents: [],
  grants: [
    {
      kind: 'confers',
      action: 'bonus-action',
      saveDc: 13,
      effects: [
        {
          kind: 'save-damage',
          ability: 'con',
          // A printed number rather than dice, so the halving is exact and the
          // assertion is about the rule instead of about the seed.
          damage: { flat: 8 },
          damageType: 'poison',
          onSuccess: 'half',
        },
      ],
    },
  ],
});

const BILE = JSON.stringify({
  id: 'flask-of-rolled-bile',
  name: 'Flask of Rolled Bile',
  kind: 'potion',
  weightLb: 0.5,
  costCp: null,
  armor: null,
  weapon: null,
  contents: [],
  grants: [
    {
      kind: 'confers',
      action: 'bonus-action',
      saveDc: 18,
      effects: [
        {
          kind: 'save-damage',
          ability: 'con',
          damage: { dice: '2d6' },
          damageType: 'poison',
          onSuccess: 'none',
        },
      ],
    },
  ],
});

/**
 * The second kind that rolls against the item's DC: a bonus the target may
 * shrug off, which is Bane's shape rather than Bless's. It was refused for
 * want of a DC and for no other reason, so admitting the number admits it.
 */
const DREAD = JSON.stringify({
  id: 'flask-of-faint-dread',
  name: 'Flask of Faint Dread',
  kind: 'potion',
  weightLb: 0.5,
  costCp: null,
  armor: null,
  weapon: null,
  contents: [],
  grants: [
    {
      kind: 'confers',
      action: 'bonus-action',
      saveDc: 15,
      durationSeconds: 600,
      effects: [
        {
          kind: 'buff',
          ability: 'wis',
          bonus: { source: 'Flask of Faint Dread', flat: 2 },
          applies: ['attack'],
          direction: 'subtract',
        },
      ],
    },
  ],
});

describe('an item that prints a save DC, and the saves rolled against it', () => {
  const content = unwrap(
    loadContent({ items: [JSON.parse(VENOM), JSON.parse(BILE), JSON.parse(DREAD)] }),
    'load',
  );
  const VENOMOUS = 'flask-of-plain-venom';
  const BILIOUS = 'flask-of-rolled-bile';
  const DREADFUL = 'flask-of-faint-dread';

  /** Forced past the DC, or forced under it, so the branch is the assertion. */
  const drink = (item: string, push: number, seed = 'venom') => {
    const issuer = createRollIssuer('r');
    const log = [...TABLE, ...carrying(item)];
    const out = unwrap(
      useItem(fold('seed', log), DRINKER, { item }, {
        ...supply(seed, content),
        issuer,
        bonuses: [{ source: 'the test insists', flat: push }],
      }),
      'drink',
    );
    return { log, out, issuer };
  };

  it('lays exactly the DC the item prints, and not the drinker’s own', () => {
    const { out } = drink(VENOMOUS, 40);
    expect(out.outcomes.map((outcome) => outcome.save?.dc)).toEqual([13]);
    // And the second potion's line is its own number, not a shared one.
    expect(drink(BILIOUS, 40).out.outcomes.map((outcome) => outcome.save?.dc)).toEqual([18]);
  });

  it('takes the whole of it on a failure and half on a success', () => {
    const failed = drink(VENOMOUS, -40);
    expect(failed.out.outcomes[0]?.save?.success).toBe(false);
    expect(fold('seed', [...failed.log, ...failed.out.events]).creatures['drinker']!.vitals.hp)
      .toBe(40 - 8);

    const saved = drink(VENOMOUS, 40);
    expect(saved.out.outcomes[0]?.save?.success).toBe(true);
    expect(fold('seed', [...saved.log, ...saved.out.events]).creatures['drinker']!.vitals.hp)
      .toBe(40 - 4);
  });

  /** SRD's other success clause: nothing at all, and no damage roll either. */
  it('rolls no damage at all where a success buys none', () => {
    const { out, issuer } = drink(BILIOUS, 40);
    expect(out.outcomes[0]?.save?.success).toBe(true);
    expect(out.events.some((e) => e.type === 'damage-taken')).toBe(false);
    expect(issuer.count).toBe(1);
  });

  it('rolls the damage the item prints, and the log carries the number', () => {
    const { log, out, issuer } = drink(BILIOUS, -40);
    // The saving throw and the damage: two rolls, both the engine's.
    expect(issuer.count).toBe(2);
    expect(out.events.filter((e) => e.type === 'rolls-issued').map((e) => e.count)).toEqual([2]);

    const taken = out.events.find((e) => e.type === 'damage-taken');
    expect(taken?.amount).toBeGreaterThanOrEqual(2);
    expect(taken?.amount).toBeLessThanOrEqual(12);
    expect(fold('seed', [...log, ...out.events]).creatures['drinker']!.vitals.hp).toBe(
      40 - taken!.amount,
    );
  });

  /** Same seed, same numbers; the determinism ship criterion again. */
  it('rolls the same from the same seed and differently from another', () => {
    expect(drink(BILIOUS, -40, 'a').out.events).toEqual(drink(BILIOUS, -40, 'a').out.events);
    expect(drink(BILIOUS, -40, 'b').out.events).not.toEqual(drink(BILIOUS, -40, 'a').out.events);
  });

  /**
   * **Every refusal before anything is spent**, and this is the case that
   * matters most: the save is a die, and a refused use must not have thrown
   * one or taken the flask off the shelf.
   */
  it('refuses out of reach with no die thrown and the flask still held', () => {
    const issuer = createRollIssuer('r');
    const log = [...TABLE, ...carrying(VENOMOUS)];
    const out = useItem(
      fold('seed', log),
      DRINKER,
      { item: VENOMOUS, target: STRANGER },
      { ...supply('venom', content), issuer },
    );
    expect(isErr(out) ? out.code : 'ok').toBe('out_of_reach');
    expect(issuer.count).toBe(0);
    expect(fold('seed', log).creatures['drinker']!.inventory).toEqual([
      { id: VENOMOUS, quantity: 1 },
    ]);
  });

  it('administers it to somebody else, who rolls their own save', () => {
    const issuer = createRollIssuer('r');
    const log = [...TABLE, ...carrying(VENOMOUS)];
    const out = unwrap(
      useItem(fold('seed', log), DRINKER, { item: VENOMOUS, target: FRIEND }, {
        ...supply('venom', content),
        issuer,
        bonuses: [{ source: 'the test insists', flat: -40 }],
      }),
      'administer',
    );
    const after = fold('seed', [...log, ...out.events]);
    expect(after.creatures['friend']!.vitals.hp).toBe(40 - 8);
    expect(after.creatures['drinker']!.vitals.hp).toBe(40);
  });

  /**
   * The other conferred kind that rolls against the number: a bonus with a
   * save. A failure hangs it and the hour is filed; a success buys nothing at
   * all, so there is no grant and therefore no timer either.
   */
  it('hangs a bonus the target failed to shrug off, and nothing where they did', () => {
    const failed = drink(DREADFUL, -40);
    expect(failed.out.outcomes[0]?.save?.dc).toBe(15);
    expect(failed.out.outcomes[0]?.save?.success).toBe(false);
    const after = fold('seed', [...failed.log, ...failed.out.events]);
    expect(after.creatures['drinker']!.bonuses.map((granted) => granted.source)).toEqual([
      itemSource(DREADFUL),
    ]);
    expect(
      after.timers[timerKey({ kind: 'grants', on: DRINKER, source: itemSource(DREADFUL) })]
        ?.deadline,
    ).toEqual({ kind: 'elapsed', at: 600 });

    const saved = drink(DREADFUL, 40);
    expect(saved.out.outcomes[0]?.save?.success).toBe(true);
    const shrugged = fold('seed', [...saved.log, ...saved.out.events]);
    expect(shrugged.creatures['drinker']!.bonuses).toEqual([]);
    // Nothing was hung, so the item's hour has nothing to end and is not filed.
    expect(shrugged.timers).toEqual({});
    // And the flask is drunk either way: a save is not a refusal.
    expect(shrugged.creatures['drinker']!.inventory).toEqual([]);
  });

  /** Rule 5: the DC was read at resolution and the fold never needs it. */
  it('folds the same with the catalogue and without it', () => {
    const { log, out } = drink(BILIOUS, -40);
    const whole = [...log, ...out.events];
    expect(fold('seed', whole)).toStrictEqual(fold('seed', whole, content));
    expect(fold('seed', whole)).toStrictEqual(fold('seed', whole, SRD_CONTENT));
  });

  /** Rule 4: it came through the same door, as JSON text, with no engine change. */
  it('is a homebrew item the SRD catalogue has never heard of', () => {
    expect(SRD_CONTENT.item(VENOMOUS)).toBeNull();
    expect(itemConferral(content.item(VENOMOUS)!)?.saveDc).toBe(13);
  });
});

describe('what a conferral may not say yet', () => {
  const potion = (grant: unknown) => ({
    id: 'a-potion',
    name: 'A Potion',
    kind: 'potion',
    weightLb: 0.5,
    costCp: null,
    armor: null,
    weapon: null,
    contents: [],
    grants: [grant],
  });

  /** Every code the registry finds, whether or not there are any. */
  const problemsOf = (grant: unknown): readonly string[] =>
    checkContent({ items: [potion(grant) as unknown as CatalogueItem] }).map(
      (problem) => problem.code,
    );

  const problems = (grant: unknown): readonly string[] => {
    const found = problemsOf(grant);
    // And the same input is refused at the door a DM's file comes through.
    expect(isErr(loadContent({ items: [potion(grant)] }))).toBe(true);
    return found;
  };

  /**
   * **A price is read now, and what is refused is a price with no pool.**
   * `conferral_charges_unread` is gone: `useItem` spends the charge through
   * `expendCharges`, so the cost is a cost somebody pays. What survives is the
   * economy rule a `casts` grant already keeps — see `item-honesty.test.ts`
   * for the whole of the price's validation and
   * `item-conferral-charges.test.ts` for what spends it.
   */
  it('refuses a price with no pool for it to come out of', () => {
    expect(
      problems({
        kind: 'confers',
        action: 'action',
        charges: 1,
        effects: [{ kind: 'heal', healing: { dice: '1d4' }, addSpellcastingModifier: false }],
      }),
    ).toContain('confers_without_charges');
  });

  /**
   * The mirror of `conferral_lifetime_ends_nothing`: a number the item prints
   * and nothing on its list ever rolls against is a number that never reaches
   * a die, which is what `unmodelled` exists to prevent one field lower down.
   */
  it('refuses a printed save DC that nothing on the list rolls against', () => {
    expect(
      problems({
        kind: 'confers',
        action: 'action',
        saveDc: 13,
        effects: [{ kind: 'heal', healing: { dice: '1d4' }, addSpellcastingModifier: false }],
      }),
    ).toContain('conferral_dc_rolls_nothing');
  });

  it('refuses a DC that is not a DC', () => {
    const bad = (saveDc: unknown) =>
      problems({
        kind: 'confers',
        action: 'action',
        saveDc,
        effects: [
          {
            kind: 'save-damage',
            ability: 'con',
            damage: { dice: '2d6' },
            damageType: 'poison',
            onSuccess: 'half',
          },
        ],
      });
    expect(bad(0)).toContain('bad_conferral_dc');
    expect(bad(13.5)).toContain('bad_conferral_dc');
    expect(bad('13')).toContain('bad_conferral_dc');
  });

  /** And the other way round: a save with no number to beat. */
  it('refuses a save on a conferral that prints no DC', () => {
    expect(
      problems({
        kind: 'confers',
        action: 'action',
        effects: [
          {
            kind: 'save-damage',
            ability: 'con',
            damage: { dice: '2d6' },
            damageType: 'poison',
            onSuccess: 'half',
          },
        ],
      }),
    ).toContain('conferral_save_without_dc');

    // A `buff` that offers a save is the second kind that rolls one, and it
    // was refused for exactly this reason and no other.
    expect(
      problems({
        kind: 'confers',
        action: 'action',
        durationSeconds: 60,
        effects: [
          {
            kind: 'buff',
            ability: 'wis',
            bonus: { source: 'A Potion', flat: 1 },
            applies: ['attack'],
            direction: 'subtract',
          },
        ],
      }),
    ).toContain('conferral_save_without_dc');
  });

  /**
   * The codes this brief admits: with a DC printed, neither the old blanket
   * refusal nor the `buff`-offers-a-save one fires any more.
   */
  it('admits a save DC that something rolls against', () => {
    const codes = problemsOf({
      kind: 'confers',
      action: 'action',
      saveDc: 13,
      effects: [
        {
          kind: 'save-damage',
          ability: 'con',
          damage: { dice: '2d6' },
          damageType: 'poison',
          onSuccess: 'half',
        },
      ],
    });
    expect(codes).toEqual([]);

    expect(
      problemsOf({
        kind: 'confers',
        action: 'action',
        saveDc: 15,
        durationSeconds: 60,
        effects: [
          {
            kind: 'buff',
            ability: 'wis',
            bonus: { source: 'A Potion', flat: 1 },
            applies: ['attack'],
            direction: 'subtract',
          },
        ],
      }),
    ).toEqual([]);
  });

  /**
   * **A `save` is admitted, and the lifetime it prints flat is not.** Every
   * `save` effect imposes a condition on its failure — `condition` is required
   * on the effect — and a conferred one is filed under `item:<id>` and held by
   * the timer the conferral's own `durationSeconds` files. What it may not
   * carry is a lifetime the *casting* would own, which is the same refusal a
   * conferred `condition`'s rider gets and is written at the flat path this
   * kind uses. `item-repeat-save.test.ts` holds the rest of the rule.
   */
  it('refuses a lifetime on a save whose failure imposes a condition', () => {
    const found = checkContent({
      items: [
        potion({
          kind: 'confers',
          action: 'action',
          saveDc: 13,
          durationSeconds: 3600,
          effects: [{ kind: 'save', ability: 'con', condition: 'poisoned', lasts: { seconds: 3600 } }],
        }) as unknown as CatalogueItem,
      ],
    });
    expect(found.map((problem) => problem.code)).toEqual([
      'conferral_condition_needs_a_casting',
    ]);
    expect(found.map((problem) => problem.reason).join(' ')).toContain('casts nothing');
  });

  /**
   * A rider hangs off an outcome and is welded to the casting that hung it —
   * a condition instance, a granted modifier, a `damage-scheduled` naming the
   * casting. A conferral has none, so an admitted save may carry none.
   */
  it('refuses a rider on a conferred save, whichever of the three it is', () => {
    const riding = (over: Record<string, unknown>) =>
      problems({
        kind: 'confers',
        action: 'action',
        saveDc: 13,
        effects: [
          {
            kind: 'save-damage',
            ability: 'con',
            damage: { dice: '2d6' },
            damageType: 'poison',
            onSuccess: 'half',
            ...over,
          },
        ],
      });

    expect(riding({ conditions: [{ name: 'poisoned', lasts: { seconds: 3600 } }] })).toContain(
      'conferral_rider_needs_a_casting',
    );
    expect(
      riding({ delayed: { damage: { dice: '1d6' }, damageType: 'poison' } }),
    ).toContain('conferral_rider_needs_a_casting');
    expect(
      riding({
        modifiers: [
          { kind: 'speed-change', change: 'add', feet: -10, lasts: { seconds: 60 } },
        ],
      }),
    ).toContain('conferral_rider_needs_a_casting');
  });

  /**
   * **The `condition` kind has moved off this list**, because SRD Potion of
   * Invisibility confers one with nothing cast at all and the four fields that
   * would need a casting are refused one by one instead — see
   * `item-condition.test.ts`. **And `save` has followed it**, because a
   * `PendingSave` names the source rather than a casting id, so the repeat
   * that was the last of the weld is raised and rolled under a bare `item:`
   * source — see `item-repeat-save.test.ts`. What is still refused is every
   * kind that needs the casting for something other than a condition's source:
   * an attack modifier nobody printed, a destination stated at the cast, and a
   * casting read from both ends.
   */
  it('refuses an effect kind an item cannot resolve without a casting', () => {
    for (const effect of [
      { kind: 'attack', damage: { dice: '1d10' }, damageType: 'fire' },
      { kind: 'teleport', feet: 30 },
      { kind: 'dispel', maxLevel: 3 },
    ]) {
      expect(problems({ kind: 'confers', action: 'action', effects: [effect] })).toContain(
        'conferral_effect_not_read',
      );
    }
  });

  it('refuses a grant with no lifetime, and a lifetime with nothing to end', () => {
    expect(
      problems({
        kind: 'confers',
        action: 'action',
        effects: [
          { kind: 'buff', bonus: { source: 'A Potion', flat: 1 }, applies: ['attack'], direction: 'add' },
        ],
      }),
    ).toContain('conferral_without_lifetime');

    expect(
      problems({
        kind: 'confers',
        action: 'action',
        durationSeconds: 60,
        effects: [{ kind: 'heal', healing: { dice: '1d4' }, addSpellcastingModifier: false }],
      }),
    ).toContain('conferral_lifetime_ends_nothing');
  });

  it('refuses a spellcasting modifier an item has no caster for', () => {
    expect(
      problems({
        kind: 'confers',
        action: 'action',
        effects: [{ kind: 'heal', healing: { dice: '1d4' }, addSpellcastingModifier: true }],
      }),
    ).toContain('conferral_has_no_caster');
  });

  it('refuses dice that scale with a slot nothing spends', () => {
    expect(
      problems({
        kind: 'confers',
        action: 'action',
        effects: [
          {
            kind: 'heal',
            healing: { dice: '1d4', perSlotLevelAbove: '1d4' },
            addSpellcastingModifier: false,
          },
        ],
      }),
    ).toContain('conferral_scales_with_a_casting');

    // And the same question of a save's damage, which is the third place an
    // item can now write an amount down — including under `plus`.
    expect(
      problems({
        kind: 'confers',
        action: 'action',
        saveDc: 13,
        effects: [
          {
            kind: 'save-damage',
            ability: 'con',
            damage: { dice: '2d6', perSlotLevelAbove: '1d6' },
            damageType: 'poison',
            onSuccess: 'half',
          },
        ],
      }),
    ).toContain('conferral_scales_with_a_casting');

    expect(
      problems({
        kind: 'confers',
        action: 'action',
        saveDc: 13,
        effects: [
          {
            kind: 'save-damage',
            ability: 'con',
            damage: { dice: '2d6' },
            damageType: 'poison',
            onSuccess: 'half',
            plus: [{ damage: { dice: '1d6', flatPerSlotLevelAbove: 2 }, damageType: 'fire' }],
          },
        ],
      }),
    ).toContain('conferral_scales_with_a_casting');
  });

  it('refuses a conferral on a class feature, which spends no item', () => {
    const codes = checkContent({
      classes: [
        {
          id: 'test',
          name: 'Test',
          hitDie: 8,
          table: [],
          features: [
            {
              id: 'test:swig',
              name: 'Swig',
              level: 1,
              note: '',
              automation: 'engine',
              grants: {
                kind: 'confers',
                action: 'action',
                effects: [{ kind: 'heal', healing: { dice: '1d4' }, addSpellcastingModifier: false }],
              },
            },
          ],
        } as never,
      ],
    }).map((problem) => problem.code);
    expect(codes).toContain('item_conferral_on_a_feature');
  });

  it('refuses two conferrals on one item, which is a choice nothing can make', () => {
    const heals = {
      kind: 'confers',
      action: 'bonus-action',
      effects: [{ kind: 'heal', healing: { dice: '1d4' }, addSpellcastingModifier: false }],
    };
    const codes = checkContent({
      items: [
        {
          id: 'twice-over',
          name: 'Twice Over',
          kind: 'potion',
          weightLb: 0,
          costCp: null,
          armor: null,
          weapon: null,
          contents: [],
          grants: [heals, heals],
        } as unknown as CatalogueItem,
      ],
    }).map((problem) => problem.code);
    expect(codes).toContain('two_item_conferrals');
  });
});

describe('using an item is safe to retry', () => {
  const thirsty = hurt(DRINKER, 20)([...TABLE, ...carrying(HEALING, 2), ...carrying(HEROISM)]);

  it('does the work once and reports nothing the second time', () => {
    const first = unwrap(
      useItem(fold('seed', thirsty), DRINKER, { item: HEALING, commandId: 'sip-1' }, supply()),
      'first',
    );
    const after = fold('seed', [...thirsty, ...first.events]);

    const retry = unwrap(
      useItem(after, DRINKER, { item: HEALING, commandId: 'sip-1' }, supply()),
      'retry',
    );
    expect(retry.events).toEqual([]);
    expect(fold('seed', [...thirsty, ...first.events, ...retry.events])).toEqual(after);
  });

  it('refuses one id used for a different item, or a different target', () => {
    const first = unwrap(
      useItem(fold('seed', thirsty), DRINKER, { item: HEALING, commandId: 'sip-1' }, supply()),
      'first',
    );
    const after = fold('seed', [...thirsty, ...first.events]);

    const other = useItem(after, DRINKER, { item: HEROISM, commandId: 'sip-1' }, supply());
    expect(isErr(other) ? other.code : 'ok').toBe('command_id_reused');

    const elsewhere = useItem(
      after,
      DRINKER,
      { item: HEALING, target: FRIEND, commandId: 'sip-1' },
      supply(),
    );
    expect(isErr(elsewhere) ? elsewhere.code : 'ok').toBe('command_id_reused');
  });
});
