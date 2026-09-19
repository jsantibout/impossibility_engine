import { SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import {
  asCharacterId,
  isErr,
  expect as unwrap,
  type CharacterId,
  type Result,
} from '@ie/shared';
import { itemSource, type CatalogueItem } from './catalogue.js';
import { checkContent, loadContent, type Content } from './content.js';
import { conditionInstanceId } from './conditions.js';
import { createRng, restoreRng, type Rng } from './dice.js';
import { timerKey } from './duration.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { createRollIssuer } from './rolls.js';
import { spellSlotKey } from './resources.js';
import type { CharacterSheet } from './character.js';
import {
  applyConditionTo,
  applySpellEffect,
  castSpell,
  pendingSavesOf,
  resolvePendingSaves,
  resolveTurn,
  useItem,
} from './commands.js';

/**
 * A repeat save that names no casting.
 *
 * SRD writes "repeats the save at the end of each of its turns, ending the
 * effect on itself on a success" on things that were never cast: a poison in
 * a bottle, a trap, a disease the table declares. The engine could hold the
 * sentence and could not honour it — `raiseTurnSaves` asked
 * `castingIdOf(timer.target.instance)` for a casting id and walked past every
 * timer that answered null, so the obligation was dropped without a word.
 *
 * Two shapes were dropped by that one line, which is why they are one file:
 *
 * - a repeat save a caller hung on a source of its own through
 *   `applyConditionTo`, which STATUS recorded as "silently unhonoured";
 * - the `save` conferred effect kind, which `content.ts` refused outright
 *   because its `repeats` "is a `PendingSave` that names a casting id".
 *
 * What replaces the casting id is the **source**: `PendingSave.source` carries
 * whatever put the condition there, `castingIdOf` still reads a casting out of
 * one when there is one, and a source that is not a casting ends on its own
 * timer — the same door `endTimedCondition` already opened for a conferred
 * condition running out of time.
 *
 * `end-casting` is the one thing that does not generalise: a success that ends
 * "the spell" needs a spell. It is refused at every door a source is settled
 * at — `checkContent` for a conferral, `applyConditionTo` for a caller, and
 * `checkSpellDefinition` for a rider that disowned its own casting, which
 * `spell-schema.test.ts` holds — rather than quietly treated as
 * `end-on-target`, because a rule silently changed is the failure this whole
 * file exists about. The two below are this file's; the third is a
 * definition's defect and belongs with the definitions.
 */

const id = (s: string) => asCharacterId(s);
const DRINKER = id('drinker');
const FRIEND = id('friend');

const VENOM = 'flask-of-creeping-venom';
const VENOM_INSTANCE = conditionInstanceId('poisoned', itemSource(VENOM));
const VENOM_KEY = timerKey({ kind: 'condition', on: DRINKER, instance: VENOM_INSTANCE });

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 10, con: 10, int: 16, wis: 10, cha: 10 },
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

const SCENE: readonly GameEvent[] = [
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
  { type: 'landmark-added', name: 'the cellar', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: DRINKER, placement: { from: { landmark: 'the cellar' }, feet: 0 } },
  {
    type: 'creature-placed',
    id: FRIEND,
    placement: { from: { creature: DRINKER }, feet: 5, bearing: 90 },
  },
];

/** The drinker acts first, so one advance ends their turn. */
const FIGHT: readonly GameEvent[] = [
  {
    type: 'combat-started',
    combatants: [
      { id: DRINKER, initiative: 20, speed: 30 },
      { id: FRIEND, initiative: 10, speed: 30 },
    ],
  },
];

const TABLE: readonly GameEvent[] = [
  added(DRINKER),
  added(FRIEND),
  {
    type: 'resource-pool-declared',
    id: FRIEND,
    pool: { key: spellSlotKey(2), label: 'l2', max: 3, recovers: 'long-rest' },
  },
  ...SCENE,
];

const carrying = (itemId: string, quantity = 1): readonly GameEvent[] => [
  { type: 'items-gained', id: DRINKER, items: [{ id: itemId, quantity }], source: 'the hoard' },
];

/**
 * The die is the engine's; which side of the DC it lands is the test's.
 *
 * A flat bonus large enough to swamp the roll, exactly as `turn-hooks.test.ts`
 * settles the same question for a casting — so every assertion below is about
 * a rule rather than about a seed.
 */
const CERTAIN = 40;
const DOOMED = -40;

const supply = (
  state: GameState,
  flat: number,
  content: Content = SRD_CONTENT,
  seed = 'venom',
) => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: (state.rng === null ? createRng(seed) : restoreRng(state.rng)) as Rng,
  content,
  bonuses: [{ source: 'the test insists', flat }],
});

type Emitted = readonly GameEvent[] | { readonly events: readonly GameEvent[] };
const eventsOf = (value: Emitted): readonly GameEvent[] =>
  Array.isArray(value) ? value : (value as { readonly events: readonly GameEvent[] }).events;

const run = (
  log: readonly GameEvent[],
  command: (s: GameState) => Result<Emitted>,
): readonly GameEvent[] => [...log, ...eventsOf(unwrap(command(fold('seed', log)), 'command'))];

const conditionsOf = (log: readonly GameEvent[], who: CharacterId = DRINKER): readonly string[] =>
  fold('seed', log).creatures[who]?.conditions.conditions ?? [];

/** One advance, settling whatever the boundary owes with the given dice. */
const advance = (log: readonly GameEvent[], flat: number): readonly GameEvent[] =>
  run(log, (s) => resolveTurn(s, supply(s, flat)));

// — the bug STATUS called silently unhonoured ————————————————————————————

const feverish = (
  onSuccess: 'end-on-target' | 'end-casting' = 'end-on-target',
): ((state: GameState) => Result<GameEvent[]>) =>
  (state) =>
    applyConditionTo(state, DRINKER, 'poisoned', 'the swamp fever', [], undefined, {
      at: 'end-of-turn',
      of: DRINKER,
      ability: 'con',
      dc: 13,
      onSuccess,
      label: 'Constitution save vs the swamp fever',
    });

describe('a repeat save a caller hung on a source of its own', () => {
  const sickened: readonly GameEvent[] = run([...TABLE, ...FIGHT], feverish());

  it('is filed on a timer, as it always was', () => {
    const key = timerKey({
      kind: 'condition',
      on: DRINKER,
      instance: conditionInstanceId('poisoned', 'the swamp fever'),
    });
    expect(fold('seed', sickened).timers[key]?.repeatSave).toMatchObject({
      at: 'end-of-turn',
      dc: 13,
    });
  });

  /**
   * The reproduction. The boundary used to walk past this timer because its
   * source is not a casting, so the save was never owed and never rolled —
   * a rule the engine held in state and quietly did not apply.
   */
  it('is raised and rolled when the turn it names ends', () => {
    const state = fold('seed', sickened);
    const outcome = unwrap(resolveTurn(state, supply(state, DOOMED)), 'turn');

    expect(outcome.saves).toHaveLength(1);
    expect(outcome.saves[0]).toMatchObject({
      target: DRINKER,
      ability: 'con',
      dc: 13,
      success: false,
      label: 'Constitution save vs the swamp fever',
    });
    expect(outcome.events.some((e) => e.type === 'roll-recorded')).toBe(true);
  });

  it('keeps the condition on a failure', () => {
    expect(conditionsOf(advance(sickened, DOOMED))).toContain('poisoned');
  });

  it('ends the condition, and its timer, on a success', () => {
    const shaken = advance(sickened, CERTAIN);
    expect(conditionsOf(shaken)).not.toContain('poisoned');
    expect(fold('seed', shaken).timers).toEqual({});
    expect(pendingSavesOf(fold('seed', shaken))).toEqual([]);
  });

  /**
   * A debt is a debt whoever raised it: advancing with no generator leaves it
   * in state and the engine refuses to move on, exactly as it does for a
   * casting's.
   */
  it('stops the turn order until somebody rolls it', () => {
    const deferred = run(sickened, (s) => resolveTurn(s));
    expect(pendingSavesOf(fold('seed', deferred))).toHaveLength(1);

    const blocked = resolveTurn(fold('seed', deferred));
    expect(isErr(blocked)).toBe(true);
    if (isErr(blocked)) expect(blocked.code).toBe('saves_pending');

    const state = fold('seed', deferred);
    const settled = unwrap(resolvePendingSaves(state, supply(state, CERTAIN)), 'settle');
    expect(conditionsOf([...deferred, ...settled.events])).not.toContain('poisoned');
  });

  /**
   * **`end-casting` is refused rather than quietly downgraded.** A success
   * that ends "the spell" needs a spell, and there is none here.
   */
  it('is refused outright when it says end-casting', () => {
    const refused = feverish('end-casting')(fold('seed', [...TABLE, ...FIGHT]));
    expect(isErr(refused)).toBe(true);
    if (isErr(refused)) {
      expect(refused.code).toBe('repeat_needs_a_casting');
      expect(refused.reason).toContain('the swamp fever');
      expect(refused.reason).toContain('ends on its target');
    }
  });
});

// — the conferred `save` kind ——————————————————————————————————————————————

/**
 * A homebrew flask, because no SRD item fits.
 *
 * SRD Potion of Poison is the entry `content.ts` named as waiting on this and
 * it does **not** come off the map: "you take 4d6 Poison damage and must
 * succeed on a DC 13 Constitution saving throw or have the Poisoned condition
 * for 1 hour". The middle clause is what this file builds; the 4d6 lands
 * whether the save is made or not, which is damage with neither an attack roll
 * nor a save behind it — the shape Magic Missile is blocked on. So the flask
 * here is the sentence with the unconditional damage taken out of it.
 */
const FLASK = {
  id: VENOM,
  name: 'Flask of Creeping Venom',
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
      durationSeconds: 3600,
      effects: [
        {
          kind: 'save',
          ability: 'con',
          condition: 'poisoned',
          repeats: { at: 'end-of-turn', onSuccess: 'end-on-target' },
        },
      ],
    },
  ],
};

/**
 * Built on demand rather than at module scope, so a refusal of the flask is
 * one failing test rather than a whole suite that never ran.
 */
let loaded: Content | null = null;
const VENOM_CONTENT = (): Content => {
  loaded ??= unwrap(
    loadContent({ items: [JSON.parse(JSON.stringify(FLASK)) as CatalogueItem] }),
    'load',
  );
  return loaded;
};

const READY: readonly GameEvent[] = [...TABLE, ...carrying(VENOM), ...FIGHT];

const drink = (log: readonly GameEvent[], flat: number): readonly GameEvent[] =>
  run(log, (s) => useItem(s, DRINKER, { item: VENOM }, supply(s, flat, VENOM_CONTENT())));

describe('an item may roll a save that imposes a condition', () => {
  const codesOf = (grant: unknown): readonly string[] =>
    checkContent({
      items: [{ ...FLASK, id: 'trial-flask', grants: [grant] } as unknown as CatalogueItem],
    }).map((problem) => `${problem.code} @ ${problem.field}`);

  const GOOD = FLASK.grants[0]!;

  it('is admitted, with its condition and its repeat', () => {
    expect(codesOf(GOOD)).toEqual([]);
  });

  /**
   * The DC is the item's own printed clause, and the rule `save-damage`
   * already keeps: required exactly where something rolls against it.
   */
  it('still needs the DC it rolls against', () => {
    const priceless = { ...GOOD, saveDc: undefined };
    expect(codesOf(priceless)).toContain(
      'conferral_save_without_dc @ items[trial-flask].grants[0].saveDc',
    );
  });

  /** Nothing ends it but its own timer, so the hour is still required. */
  it('still needs the lifetime its condition outlasts the moment by', () => {
    const forever = { ...GOOD, durationSeconds: undefined };
    expect(codesOf(forever)).toContain(
      'conferral_without_lifetime @ items[trial-flask].grants[0].durationSeconds',
    );
  });

  /**
   * The three flat fields `save` spells out that a casting owns: a lifetime
   * the casting would keep, an escape whose resolution releases a casting, and
   * a mark that the casting does not keep the condition. A conferral has no
   * casting for any of them.
   */
  const WELDED: Record<string, unknown> = {
    lasts: { seconds: 60 },
    check: { ability: 'str', skill: 'athletics', onSuccess: 'end-on-target', dc: 13 },
    outlivesCasting: true,
  };

  it.each(Object.keys(WELDED))('refuses "%s" on a conferred save', (field) => {
    expect(codesOf({ ...GOOD, effects: [{ ...GOOD.effects[0], [field]: WELDED[field] }] })).toContain(
      `conferral_condition_needs_a_casting @ items[trial-flask].grants[0].effects[0].${field}`,
    );
  });

  /**
   * **And the repeat that ends a casting.** The other spelling is admitted and
   * this one is a refusal rather than a silent fall back to `end-on-target`,
   * which would be the engine deciding a rule the item did not print.
   */
  it('refuses a repeat that would end a casting there is none of', () => {
    expect(
      codesOf({
        ...GOOD,
        effects: [
          {
            ...GOOD.effects[0],
            repeats: { at: 'end-of-turn', onSuccess: 'end-casting' },
          },
        ],
      }),
    ).toContain(
      'conferral_repeat_needs_a_casting @ items[trial-flask].grants[0].effects[0].repeats.onSuccess',
    );
  });
});

describe('Flask of Creeping Venom, end to end', () => {
  it('rolls against the DC the item prints and nothing else', () => {
    // A drinker with no Constitution proficiency and a +0 modifier: the DC is
    // thirteen because the flask says thirteen.
    const state = fold('seed', READY);
    const used = unwrap(
      useItem(state, DRINKER, { item: VENOM }, supply(state, DOOMED, VENOM_CONTENT())),
      'drink',
    );
    expect(used.events.some((e) => e.type === 'roll-recorded')).toBe(true);
    expect(used.outcomes[0]?.save).toMatchObject({ ability: 'con', dc: 13, success: false });
    expect(used.outcomes[0]).toMatchObject({ target: DRINKER, affected: true });
  });

  it('makes the drinker Poisoned under the item’s own source', () => {
    const poisoned = drink(READY, DOOMED);
    expect(conditionsOf(poisoned)).toContain('poisoned');

    const instances = fold('seed', poisoned).creatures['drinker']!.conditions.instances;
    expect(instances.map((i) => i.source)).toEqual([itemSource(VENOM)]);
    expect(fold('seed', poisoned).ongoing).toEqual({});
  });

  it('leaves nothing at all on a successful save', () => {
    const resisted = drink(READY, CERTAIN);
    expect(conditionsOf(resisted)).not.toContain('poisoned');
    expect(fold('seed', resisted).timers).toEqual({});
  });

  /**
   * One timer, carrying both sentences the flask prints: the hour it lasts,
   * and the save it repeats. They are one timer because `timerKey` is the
   * condition's, so a second `effect-scheduled` on the same key is the same
   * record being completed rather than a second obligation.
   */
  it('files the hour and the repeat on one timer', () => {
    const state = fold('seed', drink(READY, DOOMED));
    expect(Object.keys(state.timers)).toEqual([VENOM_KEY]);
    expect(state.timers[VENOM_KEY]?.deadline).toEqual({ kind: 'elapsed', at: 3600 });
    expect(state.timers[VENOM_KEY]?.repeatSave).toMatchObject({
      at: 'end-of-turn',
      of: DRINKER,
      ability: 'con',
      dc: 13,
      onSuccess: 'end-on-target',
    });
  });

  it('raises the repeat at the boundary and keeps the condition on a failure', () => {
    const poisoned = drink(READY, DOOMED);
    const state = fold('seed', poisoned);
    const outcome = unwrap(resolveTurn(state, supply(state, DOOMED)), 'turn');

    expect(outcome.saves).toHaveLength(1);
    expect(outcome.saves[0]).toMatchObject({ target: DRINKER, dc: 13, success: false });
    expect(conditionsOf([...poisoned, ...outcome.events])).toContain('poisoned');
  });

  it('ends on the target on a success, an hour early', () => {
    const shaken = advance(drink(READY, DOOMED), CERTAIN);
    expect(conditionsOf(shaken)).not.toContain('poisoned');
    expect(fold('seed', shaken).timers).toEqual({});
    expect(fold('seed', shaken).pendingSaves).toEqual({});
  });

  /** The debt survives a reload, because it is derived from the log. */
  it('survives a round trip through JSON', () => {
    const deferred = run(drink(READY, DOOMED), (s) => resolveTurn(s));
    const revived = fold('seed', JSON.parse(JSON.stringify(deferred)) as GameEvent[]);
    expect(pendingSavesOf(revived)).toHaveLength(1);
    expect(pendingSavesOf(revived)[0]?.source).toBe(itemSource(VENOM));
  });
});

// — two owed saves, two kinds of source ————————————————————————————————————

/**
 * The drinker is poisoned by the flask **and** held by a casting, and both
 * repeat at the end of their own turn. One boundary therefore owes two saves
 * whose sources are of different kinds, and the order they are rolled in
 * decides which of them gets which die.
 *
 * It is proved by **replaying** rather than by asserting the comparator: the
 * same log settled twice from the same seed produces the same events, byte for
 * byte, which is the property the ordering exists for. A test that read the
 * rule out of the code would pass however the rule was written.
 */
const doublyAfflicted = (): readonly GameEvent[] => {
  // Before the fight, because the friend has to act and the drinker holds the
  // first turn: a creature only acts on its own. Nothing here depends on the
  // order of the two afflictions, and that is half of what the replay proves.
  const poisoned = drink([...TABLE, ...carrying(VENOM)], DOOMED);
  const cast = run(poisoned, (s) =>
    castSpell(s, FRIEND, { spell: 'Hold Person', level: 2, concentration: true, slotLevel: 2 }),
  );
  const held = run(cast, (s) =>
    applySpellEffect(s, DRINKER, 'paralyzed', FRIEND, {
      repeatSave: {
        at: 'end-of-turn',
        of: DRINKER,
        ability: 'wis',
        dc: 15,
        onSuccess: 'end-on-target',
        label: 'Wisdom save vs Hold Person',
      },
    }),
  );
  return [...held, ...FIGHT];
};

describe('two owed saves of different kinds', () => {

  it('are both raised by the one boundary', () => {
    const deferred = run(doublyAfflicted(), (s) => resolveTurn(s));
    const owed = pendingSavesOf(fold('seed', deferred));
    expect(owed).toHaveLength(2);
    expect(owed.map((save) => save.source)).toEqual([
      'Hold Person#cast:1',
      itemSource(VENOM),
    ]);
  });

  it('settle in one fixed order, and the same one on a replay', () => {
    const afflicted = doublyAfflicted();
    const settle = (): readonly GameEvent[] => {
      const state = fold('seed', afflicted);
      return unwrap(resolveTurn(state, supply(state, DOOMED)), 'turn').events;
    };

    const once = settle();
    const again = settle();
    expect(JSON.stringify(again)).toBe(JSON.stringify(once));

    const labels = once
      .filter((e) => e.type === 'roll-recorded')
      .map((e) => (e as { readonly label: string }).label);
    expect(labels).toEqual([
      'Wisdom save vs Hold Person',
      'Constitution save vs Flask of Creeping Venom',
    ]);
  });

  /**
   * And each success ends its own effect and nothing else: the casting's
   * release is the casting's, the flask's is the flask's, and the two do not
   * reach each other even though they sit on one creature.
   */
  it('each end exactly what raised them', () => {
    const shaken = advance(doublyAfflicted(), CERTAIN);
    expect(conditionsOf(shaken)).not.toContain('poisoned');
    expect(conditionsOf(shaken)).not.toContain('paralyzed');
    expect(fold('seed', shaken).timers).toEqual({});
  });

  /** The whole thing folds identically from its seed, twice. */
  it('replays byte-identically', () => {
    const played = advance(doublyAfflicted(), CERTAIN);
    expect(JSON.stringify(fold('seed', played))).toBe(
      JSON.stringify(fold('seed', JSON.parse(JSON.stringify(played)) as GameEvent[])),
    );
  });
});
