import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import {
  asCharacterId,
  expect as unwrap,
  type CharacterId,
  type ConditionName,
  SKILL_ABILITY,
} from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent } from './events.js';
import { resolveSpell, resolveTurn } from './commands.js';
import { declaredCasting } from './spellcasting.js';
import { spellSlotKey } from './resources.js';
import { extendContent } from './content.js';
import { rollSelectorProblems, selectorMatches, rollModifierKey } from './roll-modifiers.js';
import type { RollSelector } from './roll-modifiers.js';
import type { SpellDefinition } from './spell-definitions.js';

/**
 * A saving throw selected by **what it is against** rather than by the ability
 * that rolls it.
 *
 * Four SRD sentences, three of them species traits, and all four write the
 * same shape:
 *
 * > Dwarven Resilience: "You have Advantage on saving throws you make to avoid
 * > or end the Poisoned condition."
 * > Fey Ancestry: "… to avoid or end the Charmed condition."
 * > Brave: "… to avoid or end the Frightened condition."
 * > Protection from Poison: "the target has Advantage on saving throws to
 * > avoid or end the Poisoned condition."
 *
 * A `RollSelector` named a family, an ability and a skill, and the nearest
 * sayable thing was **Advantage on every Constitution save the dwarf ever
 * makes** — a different and much larger trait. So the axis is `condition`, and
 * the fact it reads is what the roll is about: {@link RollQuery.aboutConditions},
 * the conditions this saving throw would avoid or end.
 *
 * **Both halves of "avoid or end" are one field**, because they are one save
 * seen at two moments. The save a casting forces is the avoiding; the save a
 * turn boundary repeats against a condition already on the creature is the
 * ending; the reader is the same in both places, and the second derives its
 * answer from the timer rather than from a field on the debt.
 */

const id = (s: string) => asCharacterId(s);
const WIZARD = id('wizard');
const ELF = id('elf');
const DWARF = id('dwarf');
const HALFLING = id('halfling');
const HUMAN = id('human');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 9,
  abilities: { str: 12, dex: 12, con: 12, int: 16, wis: 12, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
  ...over,
});

/**
 * The trait as the catalogue writes it: a self-reaching standing grant of a
 * roll mode, keyed to the condition the save is about.
 */
const advantageAgainst = (name: string, condition: ConditionName) =>
  ({
    feature: `a-species:${condition}`,
    name,
    reach: { kind: 'self' },
    grant: {
      kind: 'roll-mode',
      modifier: {
        mode: 'advantage',
        selector: { roll: 'saving-throw', relation: 'roller', condition },
      },
    },
  }) as const;

const added = (who: CharacterId, over: Partial<CharacterSheet> = {}): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(over),
  maxHp: 90,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side: 'party',
});

const slots = (who: CharacterId): readonly GameEvent[] =>
  [1, 2, 3, 4, 5, 6, 7].map(
    (level): GameEvent => ({
      type: 'resource-pool-declared',
      id: who,
      pool: {
        key: spellSlotKey(level),
        label: `level ${level} spell slot`,
        max: 4,
        recovers: 'long-rest',
      },
    }),
  );

/**
 * A homebrew fright, so Brave is driven end to end like the other two.
 *
 * No SRD spell in the catalogue imposes the Frightened condition through a
 * plain ranged saving throw — Fear is a Cone and Weird is a Sphere at a point
 * — and a trait asserted only in the predicate is a trait nobody has watched
 * work. It goes through `extendContent`, the same door homebrew uses, which
 * is also the claim that the axis is content and not a special case.
 */
const A_FRIGHT: SpellDefinition = {
  id: 'a-sudden-fright',
  name: 'A Sudden Fright',
  level: 1,
  school: 'illusion',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 1 },
  effects: [{ kind: 'save', ability: 'wis', condition: 'frightened' }],
  durationSeconds: 60,
};

/**
 * A save whose failure imposes nothing, which SRD Slow and SRD Faerie Fire are
 * and which track D made writable.
 *
 * Neither of those is castable at one named creature — Slow centres a Cube and
 * Faerie Fire a Cube too — and the claim here is about the *save*, not the
 * geometry, so the shape is borrowed rather than the spell. One Wisdom saving
 * throw, three words of penalty on a failure, and no condition at all.
 */
const A_SAPPING: SpellDefinition = {
  id: 'a-sapping-word',
  name: 'A Sapping Word',
  level: 1,
  school: 'enchantment',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 1 },
  effects: [
    {
      kind: 'save',
      ability: 'wis',
      modifiers: [{ kind: 'speed-change', change: 'halve' }],
    },
  ],
  durationSeconds: 60,
};

const CONTENT = unwrap(extendContent(SRD_CONTENT, { spells: [A_FRIGHT, A_SAPPING] }), 'extend');

const supply = (seed = 'roll') => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: CONTENT,
});

const PREPARED = [
  'charm-person',
  'contagion',
  'hold-person',
  'protection-from-poison',
  'a-sudden-fright',
  'a-sapping-word',
];

/**
 * One caster and four creatures to aim at, three carrying a trait and one
 * carrying none — because the assertion that matters is a pair.
 */
const table = (...extra: readonly GameEvent[]): readonly GameEvent[] => [
  added(WIZARD),
  added(ELF, { standing: [advantageAgainst('Fey Ancestry', 'charmed')] }),
  added(DWARF, { standing: [advantageAgainst('Dwarven Resilience', 'poisoned')] }),
  added(HALFLING, { standing: [advantageAgainst('Brave', 'frightened')] }),
  added(HUMAN),
  ...slots(WIZARD),
  { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
  { type: 'landmark-added', name: 'the hall', at: { x: 60, y: 60, z: 0 } },
  { type: 'creature-placed', id: WIZARD, placement: { from: { landmark: 'the hall' }, feet: 0 } },
  ...[ELF, DWARF, HALFLING, HUMAN].flatMap((who, i): readonly GameEvent[] => [
    {
      type: 'creature-placed',
      id: who,
      placement: { from: { creature: WIZARD }, feet: 5, bearing: 90 * i },
    },
    { type: 'sight-declared', from: WIZARD, to: who, seen: true },
    { type: 'sight-declared', from: who, to: WIZARD, seen: true },
  ]),
  {
    type: 'spellcasting-declared',
    id: WIZARD,
    spellcasting: declaredCasting({ ability: 'int', cantrips: [], prepared: PREPARED }),
  },
  ...extra,
];

/** Cast at one creature and hand back the mode its saving throw came out under. */
const saveMode = (
  spellId: string,
  target: CharacterId,
  log: readonly GameEvent[] = table(),
  slotLevel?: number,
): string | undefined =>
  unwrap(
    resolveSpell(
      fold('seed', log),
      WIZARD,
      {
        spellId,
        targets: [target],
        // SRD Charm Person asks whether you are fighting the target and the
        // engine refuses the slot until somebody says; every other spell here
        // refuses the fact for not asking. Nobody is fighting anybody, which
        // is the answer that leaves the save alone.
        ...(spellId === 'charm-person' ? { fought: [] } : {}),
        ...(slotLevel === undefined ? {} : { slotLevel }),
      },
      supply(`${spellId}:${target}`),
    ),
    spellId,
  ).outcomes[0]?.save?.mode;

// — the predicate and the vocabulary ——————————————————————————————————————————

describe('a selector can name the condition a saving throw is about', () => {
  const againstCharm: RollSelector = {
    roll: 'saving-throw',
    relation: 'roller',
    condition: 'charmed',
  };

  it('matches the save that would impose it and no other', () => {
    const query = { family: 'saving-throw', roller: ELF, ability: 'wis' } as const;

    expect(selectorMatches(againstCharm, ELF, { ...query, aboutConditions: ['charmed'] })).toBe(true);
    // SRD writes the sentence plural — Hideous Laughter imposes two conditions
    // on one save — so a save that is *among other things* about being
    // Charmed is a save made to avoid the Charmed condition.
    expect(
      selectorMatches(againstCharm, ELF, { ...query, aboutConditions: ['prone', 'charmed'] }),
    ).toBe(true);
    expect(selectorMatches(againstCharm, ELF, { ...query, aboutConditions: ['frightened'] })).toBe(false);
    expect(selectorMatches(againstCharm, ELF, { ...query, aboutConditions: [] })).toBe(false);
    // Nobody said what the save was about, so a selector that names one misses
    // it: an unkeyed Wisdom save is not the elf's sentence.
    expect(selectorMatches(againstCharm, ELF, query)).toBe(false);
  });

  it('is part of what makes two grants the same grant', () => {
    const bare: RollSelector = { roll: 'saving-throw', relation: 'roller' };
    expect(rollModifierKey('Fey Ancestry', bare)).not.toBe(
      rollModifierKey('Fey Ancestry', againstCharm),
    );
    expect(rollModifierKey('Fey Ancestry', againstCharm)).not.toBe(
      rollModifierKey('Fey Ancestry', { ...againstCharm, condition: 'frightened' }),
    );
  });

  /**
   * The two refusals, and the second is the one that keeps the vocabulary
   * honest rather than merely typed: a family whose roller supplies no
   * condition would carry a selector that never matched anything.
   */
  it('refuses a condition on a roll nothing keys, and a condition nobody prints', () => {
    const problems = (selector: RollSelector) =>
      rollSelectorProblems(selector, (skill) => SKILL_ABILITY[skill]).map((p) => p.code);

    // **`ability-check` left this list**, which is the refusal's own reason
    // coming true: it named the ability check that ends a Grapple as the next
    // roll that would say what it is about, and two check rollers say now —
    // see `condition-keyed-checks.test.ts` and SRD Powerful Build. The three
    // left record no such fact and are refused exactly as they were.
    for (const roll of ['attack', 'initiative', 'death-save'] as const) {
      expect(
        problems({ roll, relation: 'roller', condition: 'charmed' }),
      ).toContain('condition_off_a_saving_throw');
    }
    expect(problems({ roll: 'ability-check', relation: 'roller', condition: 'grappled' })).toEqual(
      [],
    );
    expect(
      problems({
        roll: 'saving-throw',
        relation: 'roller',
        condition: 'bewildered' as never,
      }),
    ).toContain('bad_condition');
    expect(problems(againstCharm)).toEqual([]);
  });
});

// — the three traits, through the public API ——————————————————————————————————

describe('the species traits that name a condition', () => {
  /**
   * SRD Fey Ancestry against SRD Charm Person: the elf rolls the Wisdom save
   * at Advantage and the human beside her rolls it straight. The pair is the
   * assertion — a mode in isolation proves the grant landed, not that it
   * reached the roll it names.
   */
  it('gives Fey Ancestry its Advantage against Charm Person', () => {
    expect(saveMode('charm-person', ELF)).toBe('advantage');
    expect(saveMode('charm-person', HUMAN)).toBe('normal');
  });

  /** SRD Brave, through a fright nobody printed: one axis, any content. */
  it('gives Brave its Advantage against the Frightened condition', () => {
    expect(saveMode('a-sudden-fright', HALFLING)).toBe('advantage');
    expect(saveMode('a-sudden-fright', HUMAN)).toBe('normal');
    // And not to the halfling's other Wisdom save, which is the narrowing.
    expect(saveMode('charm-person', HALFLING)).toBe('normal');
  });

  /**
   * SRD Dwarven Resilience against SRD Contagion, which is the **other** save
   * resolver: a save for half damage whose failure also imposes the Poisoned
   * condition. Two resolvers roll two saves, and a trait that reached only one
   * of them would work against a spell and not against its neighbour.
   */
  it('gives Dwarven Resilience its Advantage against a save that also deals damage', () => {
    expect(saveMode('contagion', DWARF, table(), 7)).toBe('advantage');
    expect(saveMode('contagion', HUMAN, table(), 7)).toBe('normal');
    // And the dwarf's Wisdom save against a fright is untouched.
    expect(saveMode('a-sudden-fright', DWARF)).toBe('normal');
  });

  /**
   * **The adjacent wrong roll, and it is the whole point of the axis.** The
   * nearest thing the old vocabulary could say was "Advantage on Wisdom saving
   * throws", which is a different trait: the elf saving against being
   * Frightened rolls straight, and so does the dwarf saving against a charm.
   */
  it('does not widen to every save of the same ability', () => {
    expect(saveMode('a-sudden-fright', ELF)).toBe('normal');
    expect(saveMode('charm-person', DWARF)).toBe('normal');
    expect(saveMode('charm-person', HALFLING)).toBe('normal');
  });

  /**
   * **A save that is about no condition at all**, which is the case the query
   * field has to be able to say rather than merely leave out. SRD Slow forces
   * one Wisdom saving throw whose failure hands out three grants and imposes
   * nothing, so the list of conditions it is about is *empty* — the caller
   * answered, and the answer is none. It goes through as itself rather than
   * being collapsed into "nobody asked", and a condition-keyed grant misses
   * it either way. The elf beside the halfling makes that a pair rather than
   * a single reading: neither trait reaches a save about nothing.
   */
  it('reaches no trait when the save it forces is about no condition', () => {
    expect(saveMode('a-sapping-word', ELF)).toBe('normal');
    expect(saveMode('a-sapping-word', HALFLING)).toBe('normal');
    expect(saveMode('a-sapping-word', DWARF)).toBe('normal');
    expect(saveMode('a-sapping-word', HUMAN)).toBe('normal');
  });

  /** And the catalogue writes them, rather than this file inventing the shape. */
  it('is what the SRD species carry', () => {
    const traitOf = (speciesId: string, featureId: string) =>
      SRD_CONTENT.species
        .find((s) => s.id === speciesId)
        ?.features.find((f) => f.id === featureId);

    for (const [speciesId, featureId, condition] of [
      ['dwarf', 'dwarf:dwarven-resilience', 'poisoned'],
      ['elf', 'elf:fey-ancestry', 'charmed'],
      ['halfling', 'halfling:brave', 'frightened'],
    ] as const) {
      const trait = traitOf(speciesId, featureId);
      expect(trait?.automation).toBe('engine');
      const grants = trait?.grants;
      const effects =
        grants !== undefined && grants.kind === 'standing' ? (grants.effects ?? []) : [];
      const modes = effects.filter((e) => e.kind === 'roll-mode');
      expect(modes).toHaveLength(1);
      expect(modes[0]).toMatchObject({
        modifier: {
          mode: 'advantage',
          selector: { roll: 'saving-throw', relation: 'roller', condition },
        },
      });
    }
  });
});

// — "or end", which is the same sentence at a turn boundary ————————————————————

/**
 * The second half of "avoid **or end**", and the half a field on the debt
 * would have got wrong.
 *
 * A repeat save is raised by a turn boundary against a condition that is
 * already on the creature, and what it is about is not written on the debt: it
 * is the timer's, which names the condition instance it will end. So the
 * boundary reads the timer rather than carrying a fifth field, and the same
 * selector answers both moments.
 *
 * Driven with SRD Hold Person, because it is the only SRD spell in reach that
 * both imposes a condition and repeats its save — and the condition it imposes
 * is Paralyzed, which no species trait names. That is what makes it the right
 * spell for this claim: the grant below is homebrew written against the
 * published vocabulary, so what is proved is the **mechanism** rather than one
 * trait's luck.
 */
describe('a save repeated to end a condition is keyed to the same condition', () => {
  const STOIC = id('stoic');
  const PLAIN = id('plain');

  const held = (...extra: readonly GameEvent[]): readonly GameEvent[] => [
    added(WIZARD),
    added(STOIC, { standing: [advantageAgainst('Unbending', 'paralyzed')] }),
    added(PLAIN),
    ...slots(WIZARD),
    { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
    { type: 'landmark-added', name: 'the hall', at: { x: 60, y: 60, z: 0 } },
    { type: 'creature-placed', id: WIZARD, placement: { from: { landmark: 'the hall' }, feet: 0 } },
    ...[STOIC, PLAIN].flatMap((who, i): readonly GameEvent[] => [
      {
        type: 'creature-placed',
        id: who,
        placement: { from: { creature: WIZARD }, feet: 5, bearing: 90 * i },
      },
      { type: 'sight-declared', from: WIZARD, to: who, seen: true },
      { type: 'sight-declared', from: who, to: WIZARD, seen: true },
    ]),
    {
      type: 'spellcasting-declared',
      id: WIZARD,
      spellcasting: declaredCasting({
        ability: 'int',
        cantrips: [],
        prepared: ['hold-person', 'a-sudden-fright'],
      }),
    },
    ...extra,
  ];

  /** Hold Person, then a fight, then the boundary that owes the repeat. */
  const paralyse = (who: CharacterId): readonly GameEvent[] => {
    const log = held();
    /**
     * A generator that always rolls a 1, so the save fails and the condition
     * lands whatever the seed would have done. The claim below is about the
     * *mode* of the next save, which needs the condition to be there.
     */
    const failing = {
      issuer: createRollIssuer('r'),
      rng: { int: () => 1, snapshot: () => [0, 0, 0, 0] } as unknown as Rng,
      content: CONTENT,
    };
    const cast = unwrap(
      resolveSpell(
        fold('seed', log),
        WIZARD,
        { spellId: 'hold-person', targets: [who], slotLevel: 2 },
        failing,
      ),
      'hold',
    );
    return [
      ...log,
      ...cast.events,
      {
        type: 'combat-started',
        combatants: [
          { id: who, initiative: 20, speed: 30 },
          { id: WIZARD, initiative: 10, speed: 30 },
        ],
      },
    ];
  };

  const repeatMode = (who: CharacterId): string | undefined => {
    const out = unwrap(resolveTurn(fold('seed', paralyse(who)), supply('turn')), 'turn');
    return out.saves[0]?.save.mode;
  };

  /** The avoiding, first, so the ending below is not the only thing asserted. */
  it('keys the save the casting forces', () => {
    const initial = (who: CharacterId) =>
      unwrap(
        resolveSpell(
          fold('seed', held()),
          WIZARD,
          { spellId: 'hold-person', targets: [who], slotLevel: 2 },
          supply(`hold:${who}`),
        ),
        'hold',
      ).outcomes[0]?.save?.mode;

    expect(initial(STOIC)).toBe('advantage');
    expect(initial(PLAIN)).toBe('normal');
    // The narrowing, on the same creature: a fright is a Wisdom save too, and
    // a grant keyed to Paralyzed says nothing about it.
    expect(saveMode('a-sudden-fright', STOIC, held())).toBe('normal');
  });

  /**
   * And the ending. The boundary owes one save, it is against the condition
   * the timer names, and the grant that names that condition reaches it.
   */
  it('keys the save the turn boundary repeats', () => {
    expect(repeatMode(STOIC)).toBe('advantage');
    expect(repeatMode(PLAIN)).toBe('normal');
    // The debt itself carries no condition: the boundary reads the timer that
    // names the instance it would end, which is what a fifth field on
    // `PendingSave` would have duplicated and been free to disagree with.
    const timers = fold('seed', paralyse(STOIC)).timers;
    expect(
      Object.values(timers).some(
        (timer) => timer !== undefined && timer.target.kind === 'condition' && timer.repeatSave !== undefined,
      ),
    ).toBe(true);
  });
});

// — the spell that grants the same sentence to somebody else ————————————————————

describe('Protection from Poison hands the same Advantage to its target', () => {
  const warded = (who: CharacterId): readonly GameEvent[] => {
    const log = table();
    return [
      ...log,
      ...unwrap(
        resolveSpell(
          fold('seed', log),
          WIZARD,
          { spellId: 'protection-from-poison', targets: [who] },
          supply('ward'),
        ),
        'ward',
      ).events,
    ];
  };

  it('lands a durable modifier keyed to the Poisoned condition', () => {
    const state = fold('seed', warded(HUMAN));
    const grants = state.creatures.human?.rollModifiers ?? [];
    expect(grants).toHaveLength(1);
    expect(grants[0]?.modifier.mode).toBe('advantage');
    expect(grants[0]?.modifier.selector).toEqual({
      roll: 'saving-throw',
      relation: 'roller',
      condition: 'poisoned',
    });
  });

  /**
   * The die changes, on the spell whose entry named this shape: SRD's "the
   * target has Advantage on saving throws to avoid or end the Poisoned
   * condition", where the nearest sayable thing was Advantage on every
   * Constitution save the target ever made.
   */
  it('changes the save Contagion forces, and no other', () => {
    expect(saveMode('contagion', HUMAN, warded(HUMAN), 7)).toBe('advantage');
    expect(saveMode('charm-person', HUMAN, warded(HUMAN))).toBe('normal');
    // And it is the target's, not the caster's table-wide.
    expect(saveMode('contagion', ELF, warded(HUMAN), 7)).toBe('normal');
  });
});
