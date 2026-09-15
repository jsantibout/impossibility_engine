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
import { timerKey } from './duration.js';
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
 * Two potions carry the file: Potion of Healing end to end, and Potion of
 * Heroism as the case with something to address.
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
    expect(Object.keys(state.timers)).toEqual([key]);
  });

  it('folds the same with the catalogue and without it', () => {
    expect(fold('seed', drunk)).toStrictEqual(fold('seed', drunk, SRD_CONTENT));
  });

  /**
   * The half of the printed potion this record does **not** do, written where
   * a report can count it rather than left in a comment.
   *
   * Two open decisions, neither of them this brief's. A flat `temp-hp` amount
   * cannot be written at all — `DiceScaling.dice` is required and no notation
   * rolls nothing — and even once it can, nothing could put an hour on it:
   * `temporary-hp-granted` carries no source and no `EffectTarget` names
   * Temporary Hit Points.
   */
  it('says plainly that the Temporary Hit Points are not conferred', () => {
    const notes = SRD_CONTENT.item(HEROISM)?.unmodelled ?? [];
    expect(notes).toHaveLength(2);
    expect(notes.join(' ')).toContain('10 Temporary Hit Points');
    expect(notes.join(' ')).toContain('last for 1 hour');
    // And the potion really does confer nothing but the Bless half.
    expect(fold('seed', drunk).creatures['drinker']!.vitals.temporaryHp).toBe(0);
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

  const problems = (grant: unknown): readonly string[] => {
    const found = checkContent({ items: [potion(grant) as unknown as CatalogueItem] });
    // And the same input is refused at the door a DM's file comes through.
    expect(isErr(loadContent({ items: [potion(grant)] }))).toBe(true);
    return found.map((problem) => problem.code);
  };

  it('refuses charges, which nothing pays yet', () => {
    expect(
      problems({
        kind: 'confers',
        action: 'action',
        charges: 1,
        effects: [{ kind: 'heal', healing: { dice: '1d4' }, addSpellcastingModifier: false }],
      }),
    ).toContain('conferral_charges_unread');
  });

  it('refuses a printed save DC, because nothing it could roll is admitted', () => {
    expect(
      problems({
        kind: 'confers',
        action: 'action',
        saveDc: 13,
        effects: [{ kind: 'heal', healing: { dice: '1d4' }, addSpellcastingModifier: false }],
      }),
    ).toContain('conferral_save_dc_unread');
  });

  it('refuses an effect kind an item cannot resolve without a casting', () => {
    expect(
      problems({
        kind: 'confers',
        action: 'action',
        effects: [{ kind: 'condition', condition: { name: 'poisoned' } }],
      }),
    ).toContain('conferral_effect_not_read');
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
