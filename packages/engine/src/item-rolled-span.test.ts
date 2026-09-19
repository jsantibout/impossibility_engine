import { SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import { asCharacterId, expect as unwrap, type CharacterId, type Result } from '@ie/shared';
import { itemConferral, itemSource, type CatalogueItem } from './catalogue.js';
import { checkContent, type Content, loadContent } from './content.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, grantSourcesOf, type GameEvent, type GameState } from './events.js';
import { timerKey } from './timers.js';
import type { CharacterSheet } from './character.js';
import { advanceTime, useItem } from './commands.js';

/**
 * A conferral whose span the item **rolls** rather than prints.
 *
 * SRD Potion of Diminution: "you gain the 'reduce' effect of the
 * _Enlarge/Reduce_ spell for **1d4 hours** (no Concentration required)." Every
 * other conferred benefit in the catalogue lasts a number the bottle printed —
 * Potion of Heroism's hour, Potion of Growth's ten minutes — and
 * `durationSeconds` is that number. This is the same clause with a die in it.
 *
 * **The die is thrown once, by the engine, and the answer is pinned.** It goes
 * down the path `regainsAtDawn` already goes down — `rollRecorded`, then the
 * same three-event batch: the `roll-recorded` that says what fell, the
 * `rolls-issued` that moves the generator, and the domain event that carries
 * the consequence. Here the consequence is an `effect-scheduled` whose
 * deadline is an absolute moment, so the fold reads the span out of the log
 * and never re-rolls it: replaying last year's draught cannot give it a
 * different hour.
 *
 * Two populations carry this file: a homebrew draught, which is where the
 * validator's refusals are driven, and SRD Potion of Diminution end to end.
 */

const id = (s: string) => asCharacterId(s);
const DRINKER = id('drinker');

const DIMINUTION = 'potion-of-diminution';
const DRAUGHT = 'draught-of-dwindling';

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

const supply = (seed = 'span', content: Content = SRD_CONTENT) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content,
});

const carrying = (itemId: string, quantity = 1): GameEvent => ({
  type: 'items-gained',
  id: DRINKER,
  items: [{ id: itemId, quantity }],
  source: 'the hoard',
});

const TABLE: readonly GameEvent[] = [
  added(DRINKER),
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
  { type: 'landmark-added', name: 'the table', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: DRINKER, placement: { from: { landmark: 'the table' }, feet: 0 } },
];

type Emitted = readonly GameEvent[] | { readonly events: readonly GameEvent[] };
const eventsOf = (value: Emitted): readonly GameEvent[] =>
  Array.isArray(value) ? value : (value as { readonly events: readonly GameEvent[] }).events;

const run = (
  log: readonly GameEvent[],
  command: (s: GameState) => Result<Emitted>,
): readonly GameEvent[] => [...log, ...eventsOf(unwrap(command(fold('seed', log)), 'command'))];

/** The moment the drinker's grants come off, read out of the folded state. */
const deadlineOf = (log: readonly GameEvent[], itemId: string): unknown =>
  fold('seed', log).timers[timerKey({ kind: 'grants', on: DRINKER, source: itemSource(itemId) })]
    ?.deadline;

/** A homebrew draught: one roll-mode benefit, and a span the bottle rolls. */
const draught = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: DRAUGHT,
  name: 'Draught of Dwindling',
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
      durationRolled: { dice: '1d4', secondsEach: 3600 },
      effects: [
        {
          kind: 'roll-mode',
          modifier: {
            mode: 'disadvantage',
            selector: { roll: 'ability-check', relation: 'roller', ability: 'str' },
          },
        },
      ],
      ...over,
    },
  ],
});

/** The draught with one field of its conferral replaced or removed. */
const conferring = (over: Record<string, unknown>): Record<string, unknown> => {
  const base = draught();
  const grant = { ...((base['grants'] as Record<string, unknown>[])[0] ?? {}), ...over };
  for (const [key, value] of Object.entries(over)) {
    if (value === undefined) delete grant[key];
  }
  return { ...base, grants: [grant] };
};

const codesFor = (item: Record<string, unknown>): readonly string[] =>
  checkContent({ items: [item as unknown as CatalogueItem] }).map((problem) => problem.code);

const LOADED = (item: Record<string, unknown> = draught()): Content =>
  unwrap(loadContent({ items: [item] }), 'load');

describe('the vocabulary: a span an item rolls for', () => {
  it('is a field on the conferral, beside the one that prints a number', () => {
    const conferral = itemConferral(LOADED().item(DRAUGHT)!);
    expect(conferral?.durationRolled).toEqual({ dice: '1d4', secondsEach: 3600 });
    expect(conferral?.durationSeconds).toBeUndefined();
  });

  /**
   * The refusal `usesRolled` already gives, asked about the other rolled
   * field: a rolled span is a conferral's lifetime, and a grant that confers
   * nothing has no lifetime for it to be. Written anywhere else it would be
   * inert and indistinguishable from a line the transcriber thought had
   * landed.
   */
  it('is refused by name on a grant that confers nothing', () => {
    const worn = {
      ...draught(),
      grants: [
        {
          kind: 'standing',
          durationRolled: { dice: '1d4', secondsEach: 3600 },
          effects: [{ kind: 'flat-bonus', bonus: 1, applies: ['save'] }],
        },
      ],
    };
    expect(codesFor(worn)).toContain('rolled_span_without_a_conferral');

    const charged = {
      ...draught(),
      grants: [
        {
          kind: 'pool',
          key: `${DRAUGHT}:charges`,
          uses: 3,
          recovers: 'dawn',
          durationRolled: { dice: '1d4', secondsEach: 3600 },
        },
      ],
    };
    expect(codesFor(charged)).toContain('rolled_span_without_a_conferral');
  });

  /** A span is stated or rolled, never both: two lifetimes is no lifetime. */
  it('refuses a conferral that prints a span and rolls one too', () => {
    expect(codesFor(conferring({ durationSeconds: 600 }))).toContain('conferral_span_twice');
  });

  /** The reading `usesRolled` is held to, by the same parser: dice, not a number. */
  it('refuses anything that is not dice', () => {
    expect(codesFor(conferring({ durationRolled: { dice: '4', secondsEach: 3600 } }))).toContain(
      'bad_rolled_span',
    );
    expect(
      codesFor(conferring({ durationRolled: { dice: 'a while', secondsEach: 3600 } })),
    ).toContain('bad_rolled_span');
    expect(codesFor(conferring({ durationRolled: '1d4' }))).toContain('bad_rolled_span');
  });

  /** And the unit each point is worth is a whole number of seconds above zero. */
  it('refuses a unit that is not a positive whole number of seconds', () => {
    expect(codesFor(conferring({ durationRolled: { dice: '1d4', secondsEach: 0 } }))).toContain(
      'bad_rolled_span',
    );
    expect(codesFor(conferring({ durationRolled: { dice: '1d4', secondsEach: 1.5 } }))).toContain(
      'bad_rolled_span',
    );
    expect(codesFor(conferring({ durationRolled: { dice: '1d4' } }))).toContain('bad_rolled_span');
  });

  /**
   * The two rules `durationSeconds` is held to, kept about the rolled half:
   * a conferral that hangs something has to say how long, and one that hangs
   * nothing may not say at all.
   */
  it('keeps the rules the printed span is held to', () => {
    expect(codesFor(conferring({ durationRolled: undefined }))).toContain(
      'conferral_without_lifetime',
    );

    const fleeting = {
      ...draught(),
      grants: [
        {
          kind: 'confers',
          action: 'bonus-action',
          durationRolled: { dice: '1d4', secondsEach: 3600 },
          effects: [{ kind: 'heal', amount: { flat: 4 }, addSpellcastingModifier: false }],
        },
      ],
    };
    expect(codesFor(fleeting)).toContain('conferral_lifetime_ends_nothing');
  });

  it('passes the door every catalogue passes through', () => {
    expect(codesFor(draught())).toEqual([]);
  });
});

describe('the die, thrown the way every non-d20 die is thrown', () => {
  const held = [...TABLE, carrying(DRAUGHT)];
  const content = LOADED();
  const drunk = run(held, (s) => useItem(s, DRINKER, { item: DRAUGHT }, supply('span', content)));

  it('records the roll with the engine’s own provenance and moves the generator', () => {
    const rolled = drunk.filter((event) => event.type === 'roll-recorded');
    expect(rolled).toHaveLength(1);
    expect(drunk.filter((event) => event.type === 'rolls-issued')).toHaveLength(1);
    const state = fold('seed', drunk);
    expect(state.rollsIssued).toBe(1);
    expect(rolled[0]).toMatchObject({ who: DRINKER, contributions: [] });
  });

  /** The three-event batch, in the order the fold needs to read it. */
  it('writes the roll, the issue and the deadline it decided, in that order', () => {
    const at = (type: string) => drunk.findIndex((event) => event.type === type);
    expect(at('roll-recorded')).toBeGreaterThan(-1);
    expect(at('rolls-issued')).toBe(at('roll-recorded') + 1);
    expect(at('effect-scheduled')).toBeGreaterThan(at('rolls-issued'));
  });

  /** A 1d4 of hours is one of four answers, and never something in between. */
  it('lasts a whole number of the unit the line prints', () => {
    const deadline = deadlineOf(drunk, DRAUGHT) as { kind: string; at: number };
    expect(deadline.kind).toBe('elapsed');
    expect([3600, 7200, 10800, 14400]).toContain(deadline.at);
  });

  /** Rule 3: same seed, same log, same state — the ship criterion, per die. */
  it('gives the same span twice from the same seed, and rolls its own from another', () => {
    const again = run(held, (s) => useItem(s, DRINKER, { item: DRAUGHT }, supply('span', content)));
    expect(again).toEqual(drunk);

    const seeds = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((seed) => {
      const log = run(held, (s) => useItem(s, DRINKER, { item: DRAUGHT }, supply(seed, content)));
      return (deadlineOf(log, DRAUGHT) as { at: number }).at;
    });
    expect(new Set(seeds).size).toBeGreaterThan(1);
  });

  /**
   * **Pinned, not re-rolled.** The deadline is an absolute moment written into
   * the event, so the fold has no die to throw and no catalogue to open: the
   * span a replay reads is the span that was rolled, whatever generator the
   * replay is given.
   */
  it('folds to the same moment however often it is replayed', () => {
    const once = fold('seed', drunk);
    expect(fold('seed', drunk)).toStrictEqual(once);
    expect(fold('seed', drunk, SRD_CONTENT)).toStrictEqual(once);
    expect(fold('another-seed', drunk).timers).toStrictEqual(once.timers);
  });

  /** And the ordinary timer ends it at the rolled moment, with no command. */
  it('wears off on the clock at the moment that was rolled', () => {
    const seconds = (deadlineOf(drunk, DRAUGHT) as { at: number }).at;
    const nearly = run(drunk, (s) => advanceTime(s, seconds - 1, 'nearly'));
    expect(grantSourcesOf(fold('seed', nearly).creatures['drinker']!)).toEqual([
      itemSource(DRAUGHT),
    ]);

    const after = run(nearly, (s) => advanceTime(s, 1, 'the last second'));
    expect(grantSourcesOf(fold('seed', after).creatures['drinker']!)).toEqual([]);
    expect(fold('seed', after).timers).toEqual({});
  });

  /** Nothing hung, nothing rolled: a die for a deadline nobody files. */
  it('throws no die for a conferral that hangs nothing on this drinker', () => {
    const openHanded = LOADED(
      conferring({
        durationRolled: undefined,
        effects: [{ kind: 'temp-hp', amount: { flat: 8 }, addSpellcastingModifier: false }],
      }),
    );
    const sipped = run(held, (s) =>
      useItem(s, DRINKER, { item: DRAUGHT }, supply('span', openHanded)),
    );
    expect(sipped.some((event) => event.type === 'rolls-issued')).toBe(false);
  });

  /**
   * **And nothing rolled where the deadline is not filed at run time either.**
   *
   * The item prints the die and the drinker is already holding a bigger pool,
   * so `grantTemporaryHp` keeps what it had, no timer is filed, and the die
   * must stay in the cup: a generator moved for a deadline that was never
   * written is the difference between a log that replays and one that does
   * not. The same question the potion's hour is asked — the pool moving — and
   * the reason the span is thrown at the first timer rather than at the sip.
   */
  it('throws no die where the grant it would measure was not taken', () => {
    const pooled = LOADED(
      conferring({
        effects: [{ kind: 'temp-hp', amount: { flat: 8 }, addSpellcastingModifier: false }],
      }),
    );
    const stocked: readonly GameEvent[] = [
      ...held,
      { type: 'temporary-hp-granted', id: DRINKER, amount: 20 },
    ];

    const kept = run(stocked, (s) => useItem(s, DRINKER, { item: DRAUGHT }, supply('span', pooled)));
    expect(fold('seed', kept).creatures['drinker']!.vitals.temporaryHp).toBe(20);
    expect(kept.some((event) => event.type === 'rolls-issued')).toBe(false);
    expect(fold('seed', kept).timers).toEqual({});

    // And the same draught over an empty cup does file one, and does roll for
    // it — so the silence above is the pool's answer and not a dead field.
    const taken = run(held, (s) => useItem(s, DRINKER, { item: DRAUGHT }, supply('span', pooled)));
    expect(taken.filter((event) => event.type === 'rolls-issued')).toHaveLength(1);
  });

  /**
   * **One sentence, one span, however many deadlines it measures.**
   *
   * A conferral that hangs a condition *and* a sourced grant files two timers
   * out of one printed clause, and they are two kinds keyed two ways — the
   * condition by its instance, the grants by their source. One die is thrown
   * for both: a draught whose Poisoned wore off an hour before its Advantage
   * did would be two lifetimes out of one sentence.
   */
  it('throws one die for a clause that files two kinds of deadline', () => {
    const doubled = LOADED(
      conferring({
        effects: [
          {
            kind: 'roll-mode',
            modifier: {
              mode: 'disadvantage',
              selector: { roll: 'ability-check', relation: 'roller', ability: 'str' },
            },
          },
          { kind: 'condition', condition: { name: 'poisoned' } },
        ],
      }),
    );
    const sipped = run(held, (s) =>
      useItem(s, DRINKER, { item: DRAUGHT }, supply('span', doubled)),
    );

    expect(sipped.filter((event) => event.type === 'roll-recorded')).toHaveLength(1);
    const filed = sipped.filter((event) => event.type === 'effect-scheduled');
    expect(filed.map((event) => (event as { target: { kind: string } }).target.kind).sort()).toEqual(
      ['condition', 'grants'],
    );
    const deadlines = filed.map((event) => (event as { deadline: unknown }).deadline);
    expect(deadlines[0]).toEqual(deadlines[1]);
  });
});

describe('SRD Potion of Diminution, end to end', () => {
  const held = [...TABLE, carrying(DIMINUTION)];
  const drunk = run(held, (s) => useItem(s, DRINKER, { item: DIMINUTION }, supply()));

  it('is in the catalogue, and rolls the hours its line prints', () => {
    const potion = SRD_CONTENT.item(DIMINUTION);
    expect(potion?.kind).toBe('potion');
    expect(itemConferral(potion!)?.durationRolled).toEqual({ dice: '1d4', secondsEach: 3600 });
  });

  /**
   * SRD Enlarge/Reduce, the reduce branch: "The target also has Disadvantage
   * on Strength checks and Strength saving throws." Two rolls named in one
   * clause, so two selectors — the Potion of Growth's pair with the mode
   * turned over, because the bottle makes the choice the casting cannot
   * record.
   */
  it('hangs the reduce branch under the item’s own source', () => {
    expect(grantSourcesOf(fold('seed', drunk).creatures['drinker']!)).toEqual([
      itemSource(DIMINUTION),
    ]);
    const modes = fold('seed', drunk).creatures['drinker']!.rollModifiers;
    expect(modes.map((modifier) => modifier.modifier.mode)).toEqual([
      'disadvantage',
      'disadvantage',
    ]);
  });

  it('uses the bottle up and makes no casting', () => {
    const state = fold('seed', drunk);
    expect(state.creatures['drinker']!.inventory).toEqual([]);
    expect(state.ongoing).toEqual({});
    expect(drunk.some((event) => event.type === 'spell-cast')).toBe(false);
  });

  it('runs for the hours it rolled and no longer', () => {
    const seconds = (deadlineOf(drunk, DIMINUTION) as { at: number }).at;
    expect([3600, 7200, 10800, 14400]).toContain(seconds);

    const nearly = run(drunk, (s) => advanceTime(s, seconds - 1, 'nearly'));
    expect(fold('seed', nearly).creatures['drinker']!.rollModifiers).toHaveLength(2);

    const after = run(nearly, (s) => advanceTime(s, 1, 'the last second'));
    expect(fold('seed', after).creatures['drinker']!.rollModifiers).toEqual([]);
  });

  it('folds the same with the catalogue and without it', () => {
    expect(fold('seed', drunk)).toStrictEqual(fold('seed', drunk, SRD_CONTENT));
  });
});
