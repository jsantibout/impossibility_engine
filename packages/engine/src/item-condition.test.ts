import { SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import {
  asCharacterId,
  isErr,
  expect as unwrap,
  type CharacterId,
  type Result,
} from '@ie/shared';
import { itemConferral, itemSource, type CatalogueItem } from './catalogue.js';
import { checkContent, loadContent, type Content } from './content.js';
import { conditionInstanceId } from './conditions.js';
import { createRng, type Rng } from './dice.js';
import { EFFECT_END_CAUSES, timerKey } from './duration.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { createRollIssuer } from './rolls.js';
import { END_TRIGGER_CAUSES } from './spell-schema.js';
import { castingIdOf } from './spells.js';
import { declaredCasting } from './spellcasting.js';
import type { CharacterSheet } from './character.js';
import {
  advanceTime,
  ongoingSpellsOn,
  resolveAttack,
  resolveDamage,
  resolveSpell,
  useItem,
} from './commands.js';

/**
 * A condition an item confers, with no casting anywhere.
 *
 * SRD Potion of Invisibility: "When you drink the potion, you have the
 * Invisible condition for 1 hour. The effect ends early if you make an attack
 * roll, deal damage, or cast a spell."
 *
 * Everything about it is the potion's. There is no casting id, nothing in
 * `ongoing`, nothing for Dispel Magic to find and nothing for `releaseCasting`
 * to address: the condition is filed under the bare source `item:<id>`, which
 * `castingIdOf` answers null for, so every casting-shaped door passes over it
 * by construction rather than by having been told to.
 *
 * What holds it is therefore the **timer**, and the timer is the whole record:
 * its deadline is the hour, and `endsEarly` is the three sentences that stop it
 * sooner. Both ends go through one door — `endTimedCondition` — exactly as
 * every casting's ending converges on `releaseCasting`.
 */

const id = (s: string) => asCharacterId(s);
const DRINKER = id('drinker');
const FRIEND = id('friend');
const FOE = id('foe');

const POTION = 'potion-of-invisibility';
const HEROISM = 'potion-of-heroism';
const INSTANCE = conditionInstanceId('invisible', itemSource(POTION));
const KEY = timerKey({ kind: 'condition', on: DRINKER, instance: INSTANCE });

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 5,
  abilities: { str: 14, dex: 14, con: 12, int: 16, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
  weaponProficiencies: ['simple', 'martial'],
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

const casts = (who: CharacterId): readonly GameEvent[] => [
  {
    type: 'spellcasting-declared',
    id: who,
    spellcasting: declaredCasting({ ability: 'int', prepared: ['fire-bolt'] }),
  },
];

const SCENE: readonly GameEvent[] = [
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
  { type: 'landmark-added', name: 'the cellar', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: DRINKER, placement: { from: { landmark: 'the cellar' }, feet: 0 } },
  {
    type: 'creature-placed',
    id: FRIEND,
    placement: { from: { creature: DRINKER }, feet: 5, bearing: 90 },
  },
  {
    type: 'creature-placed',
    id: FOE,
    placement: { from: { creature: DRINKER }, feet: 5, bearing: 180 },
  },
  { type: 'sight-declared', from: DRINKER, to: FOE, seen: true },
  { type: 'sight-declared', from: FRIEND, to: FOE, seen: true },
];

const TABLE: readonly GameEvent[] = [
  added(DRINKER),
  added(FRIEND),
  added(FOE),
  ...casts(DRINKER),
  ...SCENE,
];

const carrying = (
  itemId: string,
  quantity = 1,
  who: CharacterId = DRINKER,
): readonly GameEvent[] => [
  { type: 'items-gained', id: who, items: [{ id: itemId, quantity }], source: 'the hoard' },
];

const supply = (seed = 'potion', content: Content = SRD_CONTENT) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content,
});

type Emitted = readonly GameEvent[] | { readonly events: readonly GameEvent[] };
const eventsOf = (value: Emitted): readonly GameEvent[] =>
  Array.isArray(value) ? value : (value as { readonly events: readonly GameEvent[] }).events;

const run = (
  log: readonly GameEvent[],
  command: (s: GameState) => Result<Emitted>,
): readonly GameEvent[] => [...log, ...eventsOf(unwrap(command(fold('seed', log)), 'command'))];

/**
 * A fight, so an Attack action can be spent and `attack-made` written.
 *
 * The named creature goes first, because the action economy only lets the
 * creature whose turn it is swing and every fixture below is about one swing.
 */
const fightLedBy = (who: CharacterId): readonly GameEvent[] => [
  {
    type: 'combat-started',
    combatants: [
      { id: who, initiative: 20, speed: 30 },
      ...[DRINKER, FRIEND, FOE]
        .filter((other) => other !== who)
        .map((other, index) => ({ id: other, initiative: 15 - index, speed: 30 })),
    ],
  },
];

const IN_COMBAT = fightLedBy(DRINKER);

const conditionsOf = (log: readonly GameEvent[], who: CharacterId = DRINKER): readonly string[] =>
  fold('seed', log).creatures[who]?.conditions.conditions ?? [];

const drink = (
  log: readonly GameEvent[],
  who: CharacterId = DRINKER,
  seed = 'drink',
): readonly GameEvent[] =>
  run(log, (s) => useItem(s, who, { item: POTION }, supply(seed)));

const READY = [...TABLE, ...carrying(POTION, 2)];

describe('the potion is content, and what it confers is a condition', () => {
  it('confers the Invisible condition for an hour, and says what ends it early', () => {
    const potion = SRD_CONTENT.item(POTION);
    expect(potion?.kind).toBe('potion');

    const conferral = itemConferral(potion!);
    expect(conferral?.action).toBe('bonus-action');
    expect(conferral?.durationSeconds).toBe(3600);
    expect(conferral?.effects.map((effect) => effect.kind)).toEqual(['condition']);
    expect(conferral?.endsEarly).toEqual([
      'target-attacks',
      'target-deals-damage',
      'target-casts',
    ]);
  });

  /**
   * The four who-shaped causes are one vocabulary with two readers, and this
   * is the guard that keeps the casting-side list a superset of it.
   */
  it('names causes the casting side already knows', () => {
    for (const cause of EFFECT_END_CAUSES) expect(END_TRIGGER_CAUSES.has(cause)).toBe(true);
    expect(END_TRIGGER_CAUSES.has('caster-or-ally-damages-target')).toBe(true);
  });
});

describe('Potion of Invisibility, end to end', () => {
  const drunk = drink(READY);

  it('makes the drinker Invisible under the item’s own source', () => {
    expect(conditionsOf(drunk)).toContain('invisible');

    const instances = fold('seed', drunk).creatures['drinker']!.conditions.instances;
    expect(instances.map((i) => i.source)).toEqual([itemSource(POTION)]);
    expect(instances.map((i) => i.id)).toEqual([INSTANCE]);
  });

  /** No casting, so nothing a casting-shaped door could ever address. */
  it('leaves nothing in ongoing and no casting to find', () => {
    const state = fold('seed', drunk);
    expect(state.ongoing).toEqual({});
    expect(ongoingSpellsOn(state, DRINKER)).toEqual([]);
    expect(castingIdOf(INSTANCE)).toBeNull();
  });

  /** The timer is the record: one, on the condition, for the hour. */
  it('files one condition timer and no grants timer', () => {
    const state = fold('seed', drunk);
    expect(Object.keys(state.timers)).toEqual([KEY]);
    expect(state.timers[KEY]?.deadline).toEqual({ kind: 'elapsed', at: 3600 });
    expect(state.timers[KEY]?.endsEarly).toEqual([
      'target-attacks',
      'target-deals-damage',
      'target-casts',
    ]);
    expect(state.timers[KEY]?.repeatSave).toBeUndefined();
    expect(state.timers[KEY]?.check).toBeUndefined();

    // The bug this design uncovered: `held` gains the condition's target, and
    // a `grants` timer over `held` would be filed for a creature holding no
    // grant at all.
    expect(timerKey({ kind: 'grants', on: DRINKER, source: itemSource(POTION) }) in state.timers)
      .toBe(false);
  });

  it('runs the hour out on the clock, and not a second before', () => {
    const nearly = run(drunk, (s) => advanceTime(s, 3599, 'the hour all but gone'));
    expect(conditionsOf(nearly)).toContain('invisible');

    const over = run(nearly, (s) => advanceTime(s, 2, 'and past it'));
    expect(conditionsOf(over)).not.toContain('invisible');
    expect(fold('seed', over).timers).toEqual({});
  });

  it('rolls nothing and spends the potion', () => {
    const state = fold('seed', drunk);
    expect(drunk.some((e) => e.type === 'rolls-issued')).toBe(false);
    expect(state.creatures['drinker']!.inventory).toEqual([{ id: POTION, quantity: 1 }]);
  });
});

describe('the effect ends early when the drinker acts', () => {
  it('ends when the drinker makes an attack', () => {
    const drunk = [...drink(READY), ...IN_COMBAT];
    expect(conditionsOf(drunk)).toContain('invisible');

    const swung = run(drunk, (s) =>
      resolveAttack(s, DRINKER, { target: FOE, weapon: null }, supply('swing')),
    );

    expect(conditionsOf(swung)).not.toContain('invisible');
    expect(fold('seed', swung).timers).toEqual({});
  });

  it('ends when the drinker deals damage', () => {
    const drunk = drink(READY);
    const dealt = run(drunk, (s) =>
      resolveDamage(s, FOE, { amount: 5, source: 'a dagger', by: DRINKER }, supply('stab')),
    );

    expect(conditionsOf(dealt)).not.toContain('invisible');
    expect(fold('seed', dealt).timers).toEqual({});
  });

  it('ends when the drinker casts a spell', () => {
    const drunk = drink(READY);
    const cast = run(drunk, (s) =>
      resolveSpell(s, DRINKER, { spellId: 'fire-bolt', targets: [FOE] }, supply('bolt')),
    );

    expect(conditionsOf(cast)).not.toContain('invisible');
  });

  /**
   * The trigger reads the creature the **timer** is on, never whoever the
   * event names — the same reading `endTriggeredCastings` takes.
   */
  it('is unmoved by somebody else attacking, or dealing damage', () => {
    const drunk = [...drink(READY), ...fightLedBy(FRIEND)];

    const elsewhere = run(drunk, (s) =>
      resolveAttack(s, FRIEND, { target: FOE, weapon: null }, supply('bystander')),
    );
    expect(conditionsOf(elsewhere)).toContain('invisible');

    const hit = run(elsewhere, (s) =>
      resolveDamage(s, DRINKER, { amount: 4, source: 'a club', by: FOE }, supply('clubbed')),
    );
    expect(conditionsOf(hit)).toContain('invisible');
  });

  /**
   * Derived means the log says nothing. A `condition-removed` here would be
   * the engine claiming somebody decided this.
   */
  it('records no event for an ending nobody decided', () => {
    const drunk = [...drink(READY), ...IN_COMBAT];
    const before = drunk.length;
    const swung = run(drunk, (s) =>
      resolveAttack(s, DRINKER, { target: FOE, weapon: null }, supply('swing')),
    );

    const written = swung.slice(before).map((e) => e.type);
    expect(written).not.toContain('condition-removed');
    expect(written).not.toContain('spell-ended');
    expect(written).not.toContain('effect-scheduled');
  });

  it('folds the same log to the same state, at every prefix', () => {
    const swung = run([...drink(READY), ...IN_COMBAT], (s) =>
      resolveAttack(s, DRINKER, { target: FOE, weapon: null }, supply('swing')),
    );

    for (let n = 0; n <= swung.length; n += 1) {
      const slice = swung.slice(0, n);
      expect(() => fold('seed', slice)).not.toThrow();
      expect(JSON.stringify(fold('seed', slice))).toEqual(JSON.stringify(fold('seed', slice)));
    }
  });

  /** The fold opens no catalogue, so the content it is handed cannot matter. */
  it('folds to the same bytes with and without the catalogue', () => {
    const swung = run([...drink(READY), ...IN_COMBAT], (s) =>
      resolveAttack(s, DRINKER, { target: FOE, weapon: null }, supply('swing')),
    );
    expect(JSON.stringify(fold('seed', swung))).toEqual(
      JSON.stringify(fold('seed', swung, SRD_CONTENT)),
    );
  });
});

describe('two of the same potion refresh rather than stack', () => {
  it('holds one instance and one timer, with the later deadline', () => {
    const once = drink(READY);
    const again = run(
      run(once, (s) => advanceTime(s, 600, 'ten minutes later')),
      (s) => useItem(s, DRINKER, { item: POTION }, supply('second')),
    );

    const state = fold('seed', again);
    expect(state.creatures['drinker']!.conditions.instances).toHaveLength(1);
    expect(Object.keys(state.timers)).toEqual([KEY]);
    // SRD "Combining Magical Effects": the same effect from the same source
    // does not stack — the second draught moves the hour, it does not add one.
    expect(state.timers[KEY]?.deadline).toEqual({ kind: 'elapsed', at: 4200 });

    const late = run(state === state ? again : again, (s) => advanceTime(s, 3599, 'nearly'));
    expect(conditionsOf(late)).toContain('invisible');
    expect(conditionsOf(run(late, (s) => advanceTime(s, 2, 'and past')))).not.toContain('invisible');
  });
});

/** Rule 4: a condition-conferring flask nobody wrote engine code for. */
const PHILTRE = {
  id: 'philtre-of-the-quiet-step',
  name: 'Philtre of the Quiet Step',
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
      durationSeconds: 60,
      endsEarly: ['target-casts'],
      effects: [{ kind: 'condition', condition: { name: 'invisible' } }],
    },
  ],
};

describe('a homebrew condition goes through the same door as the book', () => {
  const content = unwrap(loadContent({ items: [JSON.parse(JSON.stringify(PHILTRE))] }), 'load');
  const FLASK = 'philtre-of-the-quiet-step';

  it('is drunk through the public API with no engine change', () => {
    const log = [...TABLE, ...carrying(FLASK)];
    const drunk = run(log, (s) => useItem(s, DRINKER, { item: FLASK }, supply('philtre', content)));

    expect(conditionsOf(drunk)).toContain('invisible');
    const key = timerKey({
      kind: 'condition',
      on: DRINKER,
      instance: conditionInstanceId('invisible', itemSource(FLASK)),
    });
    expect(fold('seed', drunk).timers[key]?.deadline).toEqual({ kind: 'elapsed', at: 60 });

    // Its one sentence, and only its one: a swing is not on the list, so the
    // flask is untouched by the thing the printed potion ends on.
    const swung = run([...drunk, ...IN_COMBAT], (s) =>
      resolveAttack(s, DRINKER, { target: FOE, weapon: null }, supply('swing')),
    );
    expect(conditionsOf(swung)).toContain('invisible');

    const cast = run(drunk, (s) =>
      resolveSpell(s, DRINKER, { spellId: 'fire-bolt', targets: [FOE] }, supply('bolt')),
    );
    expect(conditionsOf(cast)).not.toContain('invisible');
  });
});

describe('what an item may not say about a condition it confers', () => {
  const codesOf = (grant: unknown): readonly string[] =>
    checkContent({
      items: [
        { ...PHILTRE, id: 'trial-flask', grants: [grant] } as unknown as CatalogueItem,
      ],
    }).map((problem) => `${problem.code} @ ${problem.field}`);

  const GOOD = PHILTRE.grants[0]!;

  it('accepts the shape the printed potion uses', () => {
    expect(codesOf(GOOD)).toEqual([]);
  });

  /**
   * The four fields a rider carries that all need a casting: a lifetime the
   * casting would own, an escape check and a repeat save whose debts name a
   * casting id, and a mark that says the casting does not keep it.
   */
  const WELL_FORMED: Record<string, unknown> = {
    lasts: { seconds: 60 },
    check: { ability: 'str', skill: 'athletics', onSuccess: 'end-on-target', dc: 13 },
    outlivesCasting: true,
  };

  it.each(Object.keys(WELL_FORMED))('refuses "%s" on a conferred condition', (field) => {
    const codes = codesOf({
      ...GOOD,
      effects: [
        { kind: 'condition', condition: { name: 'invisible', [field]: WELL_FORMED[field] } },
      ],
    });
    // Well-formed on its own terms — `checkEffectValue` passes it — and
    // refused only because the item it is printed on casts nothing.
    expect(codes).toEqual([
      `conferral_condition_needs_a_casting @ items[trial-flask].grants[0].effects[0].condition.${field}`,
    ]);
  });

  /**
   * The fourth rider field, refused a step earlier and for a better reason:
   * SRD writes "the target repeats **the** save" and a `condition` rolled
   * none, so this is refused on a spell's list too. A second code for the
   * same defect would name a rule the author did not break.
   */
  it('leaves "repeats" to the refusal every condition host already meets', () => {
    expect(
      codesOf({
        ...GOOD,
        effects: [
          {
            kind: 'condition',
            condition: {
              name: 'invisible',
              repeats: { at: 'end-of-turn', onSuccess: 'end-on-target' },
            },
          },
        ],
      }),
    ).toContain('repeats_without_save @ items[trial-flask].grants[0].effects[0].condition.repeats');
  });

  it('requires a lifetime for a condition it hangs', () => {
    const rest: Record<string, unknown> = { ...GOOD };
    delete rest['durationSeconds'];
    expect(codesOf(rest)).toContain(
      'conferral_without_lifetime @ items[trial-flask].grants[0].durationSeconds',
    );
  });

  it('refuses an end trigger on a conferral that hangs no condition', () => {
    expect(
      codesOf({
        kind: 'confers',
        action: 'bonus-action',
        endsEarly: ['target-casts'],
        effects: [{ kind: 'heal', healing: { dice: '2d4' }, addSpellcastingModifier: false }],
      }),
    ).toContain('conferral_end_trigger_ends_nothing @ items[trial-flask].grants[0].endsEarly');
  });

  it('refuses a cause the engine cannot see happen', () => {
    expect(codesOf({ ...GOOD, endsEarly: ['target-sneezes'] })).toContain(
      'unknown_conferral_end_trigger @ items[trial-flask].grants[0].endsEarly[0]',
    );
    // The casting-only cause is not one of these either: it needs a caster,
    // and there is none.
    expect(codesOf({ ...GOOD, endsEarly: ['caster-or-ally-damages-target'] })).toContain(
      'unknown_conferral_end_trigger @ items[trial-flask].grants[0].endsEarly[0]',
    );
  });

  it('refuses an empty or malformed list', () => {
    expect(codesOf({ ...GOOD, endsEarly: [] })).toContain(
      'bad_conferral_end_trigger @ items[trial-flask].grants[0].endsEarly',
    );
    expect(codesOf({ ...GOOD, endsEarly: 'target-casts' })).toContain(
      'bad_conferral_end_trigger @ items[trial-flask].grants[0].endsEarly',
    );
  });

  it('still refuses a save, which brings a repeat nothing here could raise', () => {
    const codes = codesOf({
      ...GOOD,
      effects: [{ kind: 'save', ability: 'con', condition: 'poisoned' }],
    });
    expect(codes.join(' ')).toContain('conferral_effect_not_read');
  });
});

describe('a timer filed with no trigger has no such key', () => {
  it('folds an effect-scheduled without endsEarly to a timer without it', () => {
    const log: readonly GameEvent[] = [
      ...TABLE,
      { type: 'condition-applied', id: DRINKER, condition: 'invisible', source: 'the fog' },
      {
        type: 'effect-scheduled',
        target: {
          kind: 'condition',
          on: DRINKER,
          instance: conditionInstanceId('invisible', 'the fog'),
        },
        deadline: { kind: 'elapsed', at: 60 },
      },
    ];
    const key = timerKey({
      kind: 'condition',
      on: DRINKER,
      instance: conditionInstanceId('invisible', 'the fog'),
    });
    const timer = fold('seed', log).timers[key]!;
    expect('endsEarly' in timer).toBe(false);

    // And nothing ends it early, because it says nothing about what would.
    const swung = run([...log, ...IN_COMBAT], (s) =>
      resolveAttack(s, DRINKER, { target: FOE, weapon: null }, supply('swing')),
    );
    expect(conditionsOf(swung)).toContain('invisible');
  });
});

describe('a conferral that hangs a grant still files one', () => {
  it('leaves Potion of Heroism exactly as it was', () => {
    const log = [...TABLE, ...carrying(HEROISM)];
    const drunk = run(log, (s) => useItem(s, DRINKER, { item: HEROISM }, supply('heroism')));
    const state = fold('seed', drunk);

    const key = timerKey({ kind: 'grants', on: DRINKER, source: itemSource(HEROISM) });
    expect(Object.keys(state.timers)).toEqual([key]);
    expect(state.timers[key]?.deadline).toEqual({ kind: 'elapsed', at: 3600 });
  });

  it('refuses the potion to somebody who cannot be reached', () => {
    const refused = useItem(
      fold('seed', READY),
      DRINKER,
      { item: POTION, target: id('nobody') },
      supply(),
    );
    expect(isErr(refused)).toBe(true);
  });
});
