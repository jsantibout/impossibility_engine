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
import { checkContent, extendContent, loadContent, type Content } from './content.js';
import { conditionInstanceId } from './conditions.js';
import { createRng, type Rng } from './dice.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { createRollIssuer } from './rolls.js';
import { END_TRIGGER_CAUSES } from './spell-schema.js';
import { timerKey } from './timers.js';
import type { CharacterSheet } from './character.js';
import {
  advanceTime,
  awardItems,
  chargesLeft,
  damageCreature,
  equipItem,
  unequipItem,
  useItem,
} from './commands.js';

/**
 * An effect an item confers that ends **when the item comes off** — or, for a
 * draught, when its drinker drops to 0 Hit Points.
 *
 * SRD Armor of Invulnerability: "Immunity to Bludgeoning, Piercing, and
 * Slashing damage for 10 minutes **or until you are no longer wearing the
 * armor**." SRD Cloak of Invisibility: "the Invisible condition for 1 hour.
 * The effect ends early if you pull the hood down (no action required) **or
 * cease wearing the cloak**." SRD Gaseous Form, which a Potion of Gaseous Form
 * confers: "The spell ends on the target if it drops to 0 Hit Points."
 *
 * The four causes a conferral could name before were things the creature
 * *does*. These two are things that happen *to* it — a garment coming off, a
 * fall — and the second of them ends a **grant** as well as a condition,
 * because Metal Shell's Immunity and the cloud's Resistance are grants.
 *
 * Every item here is homebrew and arrives as JSON text: the mechanism is the
 * engine's, and the SRD records that use it are driven in `@ie/content`.
 */

const id = (s: string) => asCharacterId(s);
const WEARER = id('wearer');
const FRIEND = id('friend');

const RING = 'ring-of-the-brief-shell';
const HOOD = 'hood-of-the-quiet-hour';
const FLASK = 'flask-of-the-fragile-cloud';
const POTION = 'potion-of-invisibility';

/** A ring whose use hangs a grant that lasts while the ring stays on. */
const RING_JSON = JSON.stringify({
  id: RING,
  name: 'Ring of the Brief Shell',
  kind: 'ring',
  weightLb: null,
  costCp: null,
  armor: null,
  weapon: null,
  contents: [],
  grants: [
    {
      kind: 'pool',
      key: `${RING}:charges`,
      label: 'Ring of the Brief Shell charges',
      uses: 1,
      recovers: 'dawn',
    },
    {
      kind: 'confers',
      action: 'action',
      charges: 1,
      durationSeconds: 600,
      endsEarly: ['source-item-removed'],
      effects: [{ kind: 'damage-defense', damageTypes: ['slashing'], defense: 'immune' }],
    },
  ],
});

/** A hood whose use hangs a condition that lasts while the hood stays on. */
const HOOD_JSON = JSON.stringify({
  id: HOOD,
  name: 'Hood of the Quiet Hour',
  kind: 'wondrous',
  weightLb: null,
  costCp: null,
  armor: null,
  weapon: null,
  contents: [],
  grants: [
    {
      kind: 'pool',
      key: `${HOOD}:charges`,
      label: 'Hood of the Quiet Hour charges',
      uses: 3,
      recovers: 'dawn',
    },
    {
      kind: 'confers',
      action: 'action',
      charges: 1,
      durationSeconds: 3600,
      endsEarly: ['source-item-removed'],
      effects: [{ kind: 'condition', condition: { name: 'invisible' } }],
    },
  ],
});

/** A draught whose grant ends when its drinker drops to 0 Hit Points. */
const FLASK_JSON = JSON.stringify({
  id: FLASK,
  name: 'Flask of the Fragile Cloud',
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
      durationSeconds: 3600,
      endsEarly: ['target-drops-to-0'],
      effects: [{ kind: 'damage-defense', damageTypes: ['slashing'], defense: 'resistant' }],
    },
  ],
});

const HOMEBREW: readonly CatalogueItem[] = [RING_JSON, HOOD_JSON, FLASK_JSON].map(
  (text) => JSON.parse(text) as CatalogueItem,
);

/** The three, beside the SRD's Potion of Invisibility and a plain dagger. */
const CONTENT: Content = unwrap(extendContent(SRD_CONTENT, { items: HOMEBREW }), 'extend');

const sheet = (): CharacterSheet => ({
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
  added(WEARER),
  added(FRIEND),
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
  { type: 'landmark-added', name: 'the hall', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: WEARER, placement: { from: { landmark: 'the hall' }, feet: 0 } },
  {
    type: 'creature-placed',
    id: FRIEND,
    placement: { from: { creature: WEARER }, feet: 5, bearing: 90 },
  },
];

const supply = (state: GameState, seed = 'use') => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: createRng(seed) as Rng,
  content: CONTENT,
});

type Emitted = readonly GameEvent[] | { readonly events: readonly GameEvent[] };
const eventsOf = (value: Emitted): readonly GameEvent[] =>
  Array.isArray(value) ? value : (value as { readonly events: readonly GameEvent[] }).events;

const run = (
  log: readonly GameEvent[],
  command: (s: GameState) => Result<Emitted>,
  label = 'command',
): readonly GameEvent[] => [...log, ...eventsOf(unwrap(command(fold('seed', log)), label))];

/** Handed over through the door that declares a copy's pool, then put on. */
const wearing = (log: readonly GameEvent[], itemId: string, who: CharacterId = WEARER) =>
  run(
    run(log, (s) => awardItems(s, supply(s, 'hoard'), who, [{ id: itemId }], 'the hoard'), 'award'),
    (s) => equipItem(s, CONTENT, who, itemId),
    'equip',
  );

const use = (log: readonly GameEvent[], itemId: string, who: CharacterId = WEARER) =>
  run(log, (s) => useItem(s, who, { item: itemId }, supply(s, itemId)), `use ${itemId}`);

const takeOff = (log: readonly GameEvent[], itemId: string, who: CharacterId = WEARER) =>
  run(log, (s) => unequipItem(s, CONTENT, who, itemId), `unequip ${itemId}`);

const defensesOf = (log: readonly GameEvent[], who: CharacterId = WEARER) =>
  fold('seed', log).creatures[who]?.grantedDefenses ?? [];

const conditionsOf = (log: readonly GameEvent[], who: CharacterId = WEARER) =>
  fold('seed', log).creatures[who]?.conditions.conditions ?? [];

const RING_TIMER = timerKey({ kind: 'grants', on: WEARER, source: itemSource(RING) });
const HOOD_TIMER = timerKey({
  kind: 'condition',
  on: WEARER,
  instance: conditionInstanceId('invisible', itemSource(HOOD)),
});
const FLASK_TIMER = timerKey({ kind: 'grants', on: WEARER, source: itemSource(FLASK) });

describe('the vocabulary: two causes a conferral may name', () => {
  const codesOf = (grant: unknown): readonly string[] =>
    checkContent({
      items: [{ ...(HOMEBREW[0] as CatalogueItem), id: 'trial-ring', grants: [
        (HOMEBREW[0] as CatalogueItem).grants![0]!,
        grant,
      ] } as unknown as CatalogueItem],
    }).map((problem) => `${problem.code} @ ${problem.field}`);

  it('loads a ring, a hood and a flask that name them, from JSON text', () => {
    expect(checkContent({ items: HOMEBREW })).toEqual([]);
    expect(isErr(loadContent({ items: HOMEBREW }))).toBe(false);
  });

  /**
   * **The removal ends a hung grant, and the four deeds still do not.** Metal
   * Shell's Immunity is a grant, which is the whole reason the removal had to
   * reach one; a deed-shaped cause on a conferral that hangs no condition is
   * still the sentence that could never fire.
   */
  it('lets the removal end a grant, and still refuses a deed that ends nothing', () => {
    const ring = (HOMEBREW[0] as CatalogueItem).grants![1] as Record<string, unknown>;
    expect(codesOf(ring)).toEqual([]);
    expect(codesOf({ ...ring, endsEarly: ['target-attacks'] })).toEqual([
      'conferral_end_trigger_ends_nothing @ items[trial-ring].grants[1].endsEarly',
    ]);
    expect(codesOf({ ...ring, endsEarly: ['source-item-removed', 'target-casts'] })).toEqual([
      'conferral_end_trigger_ends_nothing @ items[trial-ring].grants[1].endsEarly',
    ]);
  });

  /**
   * **A bottle is never worn while it is used** — `useItem` refuses one still
   * in hand — and it is gone afterwards, so "until it comes off" on an item
   * that is used up is a sentence that can never fire.
   */
  it('refuses the removal on an item that is used up rather than spent', () => {
    const flask = (HOMEBREW[2] as CatalogueItem).grants![0] as Record<string, unknown>;
    const problems = checkContent({
      items: [
        {
          ...(HOMEBREW[2] as CatalogueItem),
          id: 'trial-flask',
          grants: [{ ...flask, endsEarly: ['source-item-removed'] }],
        } as unknown as CatalogueItem,
      ],
    }).map((problem) => `${problem.code} @ ${problem.field}`);
    expect(problems).toEqual([
      'conferral_removal_of_a_used_up_item @ items[trial-flask].grants[0].endsEarly[0]',
    ]);
  });

  /** A spell prints no garment, so the casting side's validator knows no removal. */
  it('keeps the removal off a spell definition, and shares the fall with one', () => {
    expect(END_TRIGGER_CAUSES.has('source-item-removed')).toBe(false);
    expect(END_TRIGGER_CAUSES.has('target-drops-to-0')).toBe(true);
  });

  it('still refuses a cause nobody can see happen', () => {
    const ring = (HOMEBREW[0] as CatalogueItem).grants![1] as Record<string, unknown>;
    expect(codesOf({ ...ring, endsEarly: ['source-item-sneezes'] })).toEqual([
      'unknown_conferral_end_trigger @ items[trial-ring].grants[1].endsEarly[0]',
    ]);
  });
});

describe('a grant that lasts while the item stays on', () => {
  const shelled = use(wearing(SCENE, RING), RING);

  it('hangs the Immunity, and files the removal on the grant’s own timer', () => {
    expect(defensesOf(shelled)).toEqual([
      { source: itemSource(RING), damageTypes: ['slashing'], defense: 'immune' },
    ]);
    expect(fold('seed', shelled).timers[RING_TIMER]).toMatchObject({
      deadline: { kind: 'elapsed', at: 600 },
      endsEarly: ['source-item-removed'],
    });
    expect(chargesLeft(fold('seed', shelled), CONTENT, WEARER, RING)).toBe(0);
  });

  it('ends the moment the ring comes off, timer and all', () => {
    const off = takeOff(shelled, RING);
    expect(defensesOf(off)).toEqual([]);
    expect(fold('seed', off).timers[RING_TIMER]).toBeUndefined();
  });

  it('is untouched by taking something else off', () => {
    const armed = run(
      [...SCENE, { type: 'items-gained', id: WEARER, items: [{ id: 'dagger', quantity: 1 }], source: 'kit' }],
      (s) => equipItem(s, CONTENT, WEARER, 'dagger'),
    );
    const worn = use(wearing(armed, RING), RING);
    const dropped = takeOff(worn, 'dagger');
    expect(defensesOf(dropped)).toHaveLength(1);
    expect(fold('seed', dropped).timers[RING_TIMER]).toBeDefined();
  });

  it('is untouched by somebody else taking theirs off', () => {
    const both = use(wearing(wearing(SCENE, RING, FRIEND), RING), RING);
    const theirs = takeOff(both, RING, FRIEND);
    expect(defensesOf(theirs)).toHaveLength(1);
  });

  it('runs to its deadline while the ring stays on', () => {
    const nearly = run(shelled, (s) => advanceTime(s, 599, 'all but'));
    expect(defensesOf(nearly)).toHaveLength(1);
    const over = run(nearly, (s) => advanceTime(s, 1, 'the ten minutes are up'));
    expect(defensesOf(over)).toEqual([]);
  });

  /**
   * **A log written before the cause existed folds the same.** The timer is
   * the whole record of the sentence, so a stored `effect-scheduled` carrying
   * no `endsEarly` is a ten minutes nothing cuts short — the ring comes off
   * and the grant stays, exactly as it always folded.
   */
  it('reads the sentence off the log, so an older log keeps its ten minutes', () => {
    const older = shelled.map((event) => {
      if (event.type !== 'effect-scheduled') return event;
      const rest: Record<string, unknown> = { ...event };
      delete rest['endsEarly'];
      return rest as unknown as GameEvent;
    });
    const off = takeOff(older, RING);
    expect(defensesOf(off)).toHaveLength(1);
    expect(fold('seed', off).timers[RING_TIMER]).toBeDefined();
  });

  /**
   * **A deed still ends a condition and nothing else.** No command files one
   * on a grant's timer, so this log is written by hand: a `grants` timer
   * naming "deals damage", and the wearer dealing it. The grant stays — the
   * deeds' sentences are about a condition, and only the conferral's own two
   * causes reach a grant.
   */
  it('lets no deed end a grant, even on a timer that names one', () => {
    const deed = shelled.map((event) =>
      event.type === 'effect-scheduled' && event.target.kind === 'grants'
        ? ({ ...event, endsEarly: ['target-deals-damage'] } as GameEvent)
        : event,
    );
    const struck = run(deed, (s) =>
      damageCreature(s, FRIEND, { amount: 5, source: 'a punch', by: WEARER }),
    );
    expect(defensesOf(struck)).toHaveLength(1);
    expect(fold('seed', struck).timers[RING_TIMER]).toBeDefined();
  });
});

describe('a condition that lasts while the item stays on', () => {
  const hooded = use(wearing(SCENE, HOOD), HOOD);

  it('makes the wearer Invisible and files the removal on the condition’s timer', () => {
    expect(conditionsOf(hooded)).toContain('invisible');
    expect(fold('seed', hooded).timers[HOOD_TIMER]).toMatchObject({
      endsEarly: ['source-item-removed'],
    });
  });

  it('ends when the hood comes off', () => {
    const off = takeOff(hooded, HOOD);
    expect(conditionsOf(off)).not.toContain('invisible');
    expect(fold('seed', off).timers[HOOD_TIMER]).toBeUndefined();
  });

  /**
   * **Only what the item that came off conferred.** A Potion of Invisibility's
   * Invisible is a second instance under a second source, and its sentence
   * names no garment: taking the hood off leaves the potion's hour running.
   */
  it('leaves a Potion of Invisibility’s Invisible alone', () => {
    const drunk = use(
      [...hooded, { type: 'items-gained', id: WEARER, items: [{ id: POTION, quantity: 1 }], source: 'kit' }],
      POTION,
    );
    const off = takeOff(drunk, HOOD);
    expect(conditionsOf(off)).toContain('invisible');
    expect(fold('seed', off).creatures[WEARER]!.conditions.instances.map((one) => one.id)).toEqual([
      conditionInstanceId('invisible', itemSource(POTION)),
    ]);
  });

  /**
   * **Lands on its wearer and on nobody else.** The sentence is "until you
   * cease wearing the cloak"; on a friend who never wore it the removal could
   * never fire, and the hour would outlast the doffing it was printed with.
   * Refused before anything is spent.
   */
  it('refuses to be administered to a creature not wearing it, and spends nothing', () => {
    const worn = wearing(SCENE, HOOD);
    const state = fold('seed', worn);
    const out = useItem(state, WEARER, { item: HOOD, target: FRIEND }, supply(state));
    expect(isErr(out) && out.code).toBe('not_the_wearer');
    expect(chargesLeft(state, CONTENT, WEARER, HOOD)).toBe(3);
  });
});

describe('a grant that ends when its holder drops to 0 Hit Points', () => {
  const drunk = use(
    [...SCENE, { type: 'items-gained', id: WEARER, items: [{ id: FLASK, quantity: 1 }], source: 'kit' }],
    FLASK,
  );
  const hurt = (log: readonly GameEvent[], amount: number) =>
    run(log, (s) => damageCreature(s, WEARER, { amount, source: 'a spear' }), 'hurt');

  it('files the fall on the grant’s timer', () => {
    expect(fold('seed', drunk).timers[FLASK_TIMER]).toMatchObject({
      endsEarly: ['target-drops-to-0'],
    });
  });

  it('survives a blow that leaves the drinker standing', () => {
    const bruised = hurt(drunk, 39);
    expect(fold('seed', bruised).creatures[WEARER]!.vitals.hp).toBe(1);
    expect(defensesOf(bruised)).toHaveLength(1);
  });

  it('ends on the blow that drops the drinker to 0', () => {
    const felled = hurt(drunk, 40);
    expect(fold('seed', felled).creatures[WEARER]!.vitals.hp).toBe(0);
    expect(defensesOf(felled)).toEqual([]);
    expect(fold('seed', felled).timers[FLASK_TIMER]).toBeUndefined();
  });

  it('is not ended by somebody else falling', () => {
    const other = run(drunk, (s) => damageCreature(s, FRIEND, { amount: 40, source: 'a spear' }));
    expect(defensesOf(other)).toHaveLength(1);
  });
});
