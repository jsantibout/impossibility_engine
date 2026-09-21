import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import {
  asCharacterId,
  isErr,
  isNeedsContext,
  contextRequestsOf,
  expect as unwrap,
  type CharacterId,
} from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent } from './events.js';
import {
  pendingCastingsOf,
  resolveAttack,
  resolveDeclaredCast,
  resolveSpell,
  resolveTurn,
  takeDodge,
  takeHide,
  HIDE_DC,
} from './commands.js';
import { createCharacter, type CharacterChoices } from './creation.js';
import { spellSlotKey } from './resources.js';
import { canSee, canSomehowSee } from './standing.js';
import { declaredCasting } from './spellcasting.js';

/**
 * SRD Hide, the action — and the owner's ruling that it is the engine's verb.
 *
 * > "With this action, you try to conceal yourself. To do so, you must succeed
 * > on a DC 15 Dexterity (Stealth) check while you're Heavily Obscured or
 * > behind Three-Quarters Cover or Total Cover, and you must be out of any
 * > enemy's line of sight."
 *
 * It has more inputs than most, and the split between them is the whole of the
 * design: **who can see the hider is the table's** — a declaration, like cover
 * and like whose side anybody is on — and **the check and the Invisible
 * condition it buys are the engine's**. Nothing here asks a caller for a
 * number, and nothing here decides for the table whether a bar is in the way.
 */

const id = (s: string) => asCharacterId(s);
const ROGUE = id('rogue');
const FIGHTER = id('fighter');
const GOBLIN = id('goblin');

const plain = (): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: null,
});

const common = {
  backgroundId: 'sage',
  languages: ['Dwarvish', 'Orc'],
  alignment: 'Neutral',
  spellbook: [],
  backgroundEquipment: 'A' as const,
  classEquipment: 'A' as const,
  equipped: [],
  hitPoints: { method: 'fixed' as const },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
  cantrips: [],
  preparedSpells: [],
  speciesId: 'human',
};

const MAGIC_INITIATE = {
  'sage:magic-initiate-wizard': {
    featId: 'magic-initiate',
    spellList: 'wizard',
    spellcastingAbility: 'int' as const,
    cantrips: ['mage-hand', 'light'],
    levelOneSpell: 'find-familiar',
  },
};

const rogueChoices: CharacterChoices = {
  ...common,
  name: 'Nyx',
  classId: 'rogue',
  level: 5,
  abilities: {
    method: 'standard-array',
    assignment: { str: 8, dex: 15, con: 13, int: 14, wis: 12, cha: 10 },
  },
  abilityIncreases: { con: 2, int: 1 },
  classSkills: ['stealth', 'sleight-of-hand', 'acrobatics', 'investigation'],
  subclassId: 'thief',
  featureChoices: {
    'human:skillful': ['perception'],
    'rogue:expertise': ['stealth', 'sleight-of-hand'],
    'rogue:weapon-mastery': [],
  },
  feats: {
    ...MAGIC_INITIATE,
    'human:versatile': { featId: 'alert' },
    'rogue:ability-score-improvement': { featId: 'savage-attacker' },
  },
};

const fighterChoices: CharacterChoices = {
  ...common,
  name: 'Bren',
  classId: 'fighter',
  level: 5,
  abilities: {
    method: 'standard-array',
    assignment: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
  },
  abilityIncreases: { con: 2, wis: 1 },
  classSkills: ['athletics', 'survival'],
  subclassId: 'champion',
  featureChoices: { 'human:skillful': ['perception'], 'fighter:weapon-mastery': [] },
  feats: {
    ...MAGIC_INITIATE,
    'human:versatile': { featId: 'alert' },
    'fighter:fighting-style': { featId: 'archery' },
    'fighter:ability-score-improvement': { featId: 'savage-attacker' },
  },
};

/**
 * A scene with a hider, a goblin watching, and nothing declared about either
 * the bar between them or what the goblin can see. Every test below adds the
 * declarations its own sentence is about.
 */
const table = (who: CharacterId, choices: CharacterChoices): readonly GameEvent[] => [
  ...(unwrap(createCharacter(SRD_CONTENT, choices, who), 'create') as GameEvent[]),
  { type: 'creature-side-declared', id: who, side: 'party' },
  {
    type: 'creature-added',
    id: GOBLIN,
    name: 'goblin',
    sheet: plain(),
    maxHp: 200,
    diesAtZero: false,
    creatureType: 'Humanoid',
    side: 'goblins',
  },
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
  { type: 'landmark-added', name: 'the yard', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: who, placement: { from: { landmark: 'the yard' }, feet: 0 } },
  {
    type: 'creature-placed',
    id: GOBLIN,
    placement: { from: { creature: who }, feet: 20, bearing: 0 },
  },
  {
    type: 'combat-started',
    combatants: [
      { id: who, initiative: 20, speed: 30 },
      { id: GOBLIN, initiative: 10, speed: 30 },
    ],
  },
];

/** The goblin cannot see the Rogue, and there is a wall in the way. */
const CONCEALED: readonly GameEvent[] = [
  ...table(ROGUE, rogueChoices),
  { type: 'sight-declared', from: GOBLIN, to: ROGUE, seen: false },
  { type: 'cover-declared', from: GOBLIN, to: ROGUE, degree: 'three-quarters' },
];

const supply = (seed = 'hide') => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

/** The check is forced either way, so a test is about the rule and not the die. */
const forced = (flat: number) => [{ source: 'forced', flat }];

const hide = (
  log: readonly GameEvent[],
  who: CharacterId = ROGUE,
  command: Parameters<typeof takeHide>[2] = {},
) => takeHide(fold('seed', log), who, command, supply());

describe('SRD Hide: what a creature must have before the die is thrown', () => {
  it('refuses a creature with no cover and nothing obscuring them', () => {
    const exposed = [
      ...table(ROGUE, rogueChoices),
      { type: 'sight-declared', from: GOBLIN, to: ROGUE, seen: false } as GameEvent,
    ];
    const refused = hide(exposed);
    expect(isErr(refused) && refused.code).toBe('not_concealed');
    expect(isErr(refused) && refused.reason).toContain('goblin');
  });

  it('refuses a creature a watcher can see, however good the cover', () => {
    const watched = [
      ...table(ROGUE, rogueChoices),
      { type: 'cover-declared', from: GOBLIN, to: ROGUE, degree: 'total' } as GameEvent,
      { type: 'sight-declared', from: GOBLIN, to: ROGUE, seen: true } as GameEvent,
    ];
    const refused = hide(watched);
    expect(isErr(refused) && refused.code).toBe('seen');
    expect(isErr(refused) && refused.reason).toContain('goblin');
  });

  /**
   * Homework rather than a verdict: nobody has said what the goblin can see,
   * and the engine holds no light to work it out for itself.
   */
  it('asks when nobody has said whether the watcher can see them', () => {
    const undeclared = [
      ...table(ROGUE, rogueChoices),
      { type: 'cover-declared', from: GOBLIN, to: ROGUE, degree: 'three-quarters' } as GameEvent,
    ];
    const asked = hide(undeclared);
    expect(isNeedsContext(asked)).toBe(true);
    expect(isErr(asked) && asked.code).toBe('undeclared_sight');
    expect(contextRequestsOf(asked).map((request) => request.kind)).toEqual(['visibility']);
    expect(contextRequestsOf(asked)[0]?.subject).toBe(GOBLIN);
  });

  /** Half Cover is not enough: the book names Three-Quarters and Total. */
  it('refuses Half Cover, which the book does not offer', () => {
    const thin = [
      ...table(ROGUE, rogueChoices),
      { type: 'cover-declared', from: GOBLIN, to: ROGUE, degree: 'half' } as GameEvent,
      { type: 'sight-declared', from: GOBLIN, to: ROGUE, seen: false } as GameEvent,
    ];
    expect(isErr(hide(thin)) && (hide(thin) as { code: string }).code).toBe('not_concealed');
  });

  /**
   * "Heavily Obscured" is the half the engine does not model — it holds no
   * light and no fog — so it is declared for the attempt, exactly as cover is
   * declared between two creatures.
   */
  it('takes Heavily Obscured as a declared fact, with no cover anywhere', () => {
    const fogged = [
      ...table(ROGUE, rogueChoices),
      { type: 'sight-declared', from: GOBLIN, to: ROGUE, seen: false } as GameEvent,
    ];
    const out = unwrap(hide(fogged, ROGUE, { obscured: true, bonuses: forced(40) }), 'hide');
    expect(out.hidden).toBe(true);
  });
});

describe('SRD Hide: the DC 15 Dexterity (Stealth) check, and what it buys', () => {
  it('buys the Invisible condition on a success', () => {
    const out = unwrap(hide(CONCEALED, ROGUE, { bonuses: forced(40) }), 'hide');
    expect(out.hidden).toBe(true);
    expect(out.check?.dc).toBe(HIDE_DC);
    expect(HIDE_DC).toBe(15);

    const applied = out.events.find((event) => event.type === 'condition-applied');
    expect(applied && applied.type === 'condition-applied' && applied.condition).toBe('invisible');

    const after = fold('seed', [...CONCEALED, ...out.events]);
    expect(after.creatures[ROGUE]?.conditions.conditions).toContain('invisible');
    // The Action went on the attempt, and the roll is in the log to be read.
    expect(after.combat?.budgets[ROGUE]?.action).toBe(false);
    const rolled = out.events.find((event) => event.type === 'roll-recorded');
    expect(rolled && rolled.type === 'roll-recorded' && rolled.label).toContain('Stealth');
  });

  it('buys nothing on a failure, and still spends the action', () => {
    const out = unwrap(hide(CONCEALED, ROGUE, { bonuses: forced(-40) }), 'hide');
    expect(out.hidden).toBe(false);
    expect(out.events.some((event) => event.type === 'condition-applied')).toBe(false);

    const after = fold('seed', [...CONCEALED, ...out.events]);
    expect(after.creatures[ROGUE]?.conditions.conditions).not.toContain('invisible');
    expect(after.combat?.budgets[ROGUE]?.action).toBe(false);
  });

  it('is idempotent under a repeated command id', () => {
    const first = unwrap(hide(CONCEALED, ROGUE, { commandId: 'h1', bonuses: forced(40) }), 'hide');
    expect(first.events.length).toBeGreaterThan(0);
    const again = takeHide(
      fold('seed', [...CONCEALED, ...first.events]),
      ROGUE,
      { commandId: 'h1', bonuses: forced(40) },
      supply(),
    );
    expect(unwrap(again, 'again').events).toEqual([]);
    expect(unwrap(again, 'again').duplicate).toBe(true);
  });
});

describe("SRD Cunning Action's third verb", () => {
  it('lets the Rogue Hide as a Bonus Action', () => {
    const out = unwrap(
      hide(CONCEALED, ROGUE, { from: 'bonus-action', bonuses: forced(40) }),
      'hide',
    );
    expect(out.events[0]?.type).toBe('bonus-action-spent');
    expect(out.hidden).toBe(true);

    const after = fold('seed', [...CONCEALED, ...out.events]);
    expect(after.combat?.budgets[ROGUE]?.action).toBe(true);
  });

  it('refuses the same Bonus Action to a Fighter, who holds no such feature', () => {
    const covered = [
      ...table(FIGHTER, fighterChoices),
      { type: 'sight-declared', from: GOBLIN, to: FIGHTER, seen: false } as GameEvent,
      { type: 'cover-declared', from: GOBLIN, to: FIGHTER, degree: 'total' } as GameEvent,
    ];
    const refused = hide(covered, FIGHTER, { from: 'bonus-action', bonuses: forced(40) });
    expect(isErr(refused) && refused.code).toBe('action_not_allowed');

    // And the ordinary price is still theirs to pay.
    expect(unwrap(hide(covered, FIGHTER, { bonuses: forced(40) }), 'hide').hidden).toBe(true);
  });
});

// — what the hidden creature then does ————————————————————————————————————

/**
 * The Invisible condition a Hide buys, on the two rolls that read it and on
 * the sentence that ends it.
 *
 * Both halves were built and neither was wired. `attackerConditionModes` has
 * always gated SRD Invisible's Advantage on "if a creature can somehow see
 * you, you don't gain this benefit against that creature" — and `resolveAttack`
 * handed it conditions and no context, so the clause was exercised in unit
 * tests and by nothing a table could reach: declaring that the goblin is
 * looking straight at the Rogue took nothing away. And nothing at all ended
 * the condition, so a Rogue who hid once stayed Invisible for the rest of the
 * fight however loudly they swung.
 */

/** The goblin close enough to punch, with the same wall and the same blind eye. */
const WITHIN_REACH: readonly GameEvent[] = CONCEALED.map((event) =>
  event.type === 'creature-placed' && event.id === GOBLIN
    ? ({
        ...event,
        placement: { from: { creature: ROGUE }, feet: 5, bearing: 0 },
      } as GameEvent)
    : event,
);

/** Hidden as a Bonus Action, so the Action is still there to swing with. */
const hidden = (log: readonly GameEvent[] = WITHIN_REACH): readonly GameEvent[] => {
  const out = unwrap(
    takeHide(fold('seed', log), ROGUE, { from: 'bonus-action', bonuses: forced(40) }, supply()),
    'the Hide',
  );
  if (!out.hidden) throw new Error('the fixture meant this Hide to succeed');
  return [...log, ...out.events];
};

/** An Unarmed Strike at the goblin, forced to land so the test is about the mode. */
const punch = (log: readonly GameEvent[]) => {
  const out = unwrap(
    resolveAttack(
      fold('seed', log),
      ROGUE,
      { target: GOBLIN, weapon: null, attackBonuses: [{ source: 'forced', flat: 40 }] },
      supply('swung'),
    ),
    'the swing',
  );
  return { ...out, log: [...log, ...out.events] };
};

const sourcesOn = (log: readonly GameEvent[], who: CharacterId): readonly string[] =>
  (fold('seed', log).creatures[who]?.conditions.instances ?? [])
    .filter((instance) => instance.condition === 'invisible')
    .map((instance) => instance.source);

describe("SRD Invisible: “if a creature can somehow see you”", () => {
  /**
   * The ordinary case, and the one that already worked: nobody can see the
   * Rogue, so the swing has Advantage.
   */
  it('gives the hidden attacker Advantage against a watcher declared blind to them', () => {
    expect(punch(hidden()).attack?.roll.mode).toBe('advantage');
  });

  /**
   * **And the declaration reaches the roll.** The goblin has found the Rogue —
   * the table says so, exactly as it says where the cover is — and SRD takes
   * the benefit away "against that creature". The condition is untouched: the
   * Rogue is still Invisible to everybody else in the room.
   */
  it('takes it away again once that watcher is declared to see them', () => {
    const spotted: readonly GameEvent[] = [
      ...hidden(),
      { type: 'sight-declared', from: GOBLIN, to: ROGUE, seen: true },
    ];
    const out = punch(spotted);

    expect(out.attack?.roll.mode).toBe('normal');
    expect(fold('seed', spotted).creatures[ROGUE]?.conditions.conditions).toContain('invisible');
  });

  /**
   * **And undeclared is not "they can see you".** `canSee` is three-valued and
   * the third value is homework, not a verdict — so an attack nobody has
   * settled the sight lines of keeps the behaviour it has always had, and says
   * out loud that it did. An ordinary swing must not stop to ask: this is the
   * hot path, and `needs-context` here is a rule nobody has ruled on.
   */
  it('keeps the benefit, and reports it, where nobody has declared the sight', () => {
    const unwatched: readonly GameEvent[] = [
      ...WITHIN_REACH.filter((event) => event.type !== 'sight-declared'),
      { type: 'condition-applied', id: ROGUE, condition: 'invisible', source: 'dm:the mist' },
    ];
    const out = punch(unwatched);

    expect(out.attack?.roll.mode).toBe('advantage');
    expect(out.unverified.some((line) => line.includes('Invisible'))).toBe(true);
  });

  /**
   * The same sentence read from the other end — SRD Invisible: "Attack rolls
   * against you have Disadvantage" — and the same three values. An attacker
   * declared to see the Invisible creature rolls straight.
   */
  it('reads the other end of the sentence for an Invisible target', () => {
    const veiled: readonly GameEvent[] = [
      ...WITHIN_REACH.filter((event) => event.type !== 'sight-declared'),
      { type: 'condition-applied', id: GOBLIN, condition: 'invisible', source: 'dm:the mist' },
    ];
    expect(punch(veiled).attack?.roll.mode).toBe('disadvantage');

    const seen: readonly GameEvent[] = [
      ...veiled,
      { type: 'sight-declared', from: ROGUE, to: GOBLIN, seen: true },
    ];
    expect(punch(seen).attack?.roll.mode).toBe('normal');
  });
});

describe('SRD Hide: what ends it', () => {
  /**
   * > "The condition ends on you immediately after … you make an attack
   * > roll, or you cast a spell with a Verbal component."
   *
   * The attack roll, hit or miss: the sentence counts rolls and not landings,
   * which is the reading `roll-modifier-consumed` already takes of the same
   * moment. And the Advantage the swing had is the Advantage it keeps — the
   * condition ends *after* the roll, so the roll was made hidden.
   */
  it('ends the hiding on the attack roll the hider makes', () => {
    const out = punch(hidden());

    expect(out.attack?.roll.mode).toBe('advantage');
    expect(sourcesOn(out.log, ROGUE)).toEqual([]);
    expect(fold('seed', out.log).creatures[ROGUE]?.conditions.conditions).not.toContain('invisible');
  });

  /** A miss is an attack roll too, and the sentence does not ask whether it landed. */
  it('ends it on a miss as readily as on a hit', () => {
    const out = unwrap(
      resolveAttack(
        fold('seed', hidden()),
        ROGUE,
        { target: GOBLIN, weapon: null, attackBonuses: [{ source: 'forced', flat: -40 }] },
        supply('missed'),
      ),
      'the swing',
    );
    expect(out.attack?.hit).toBe(false);
    expect(sourcesOn([...hidden(), ...out.events], ROGUE)).toEqual([]);
  });

  /**
   * **And it ends that Invisible and no other.** The source `action:hide` is
   * kept distinct from a casting's precisely so this can be true: a Rogue
   * standing in somebody's Greater Invisibility who swings stops being
   * *hidden* and does not stop being invisible, because the spell said nothing
   * about attacking.
   */
  it('leaves an Invisible that came from somewhere else standing', () => {
    const doubly: readonly GameEvent[] = [
      ...hidden(),
      { type: 'condition-applied', id: ROGUE, condition: 'invisible', source: 'casting:greater' },
    ];
    const out = punch(doubly);

    expect(sourcesOn(out.log, ROGUE)).toEqual(['casting:greater']);
    expect(fold('seed', out.log).creatures[ROGUE]?.conditions.conditions).toContain('invisible');
  });

  /** A swing by somebody who was never hiding writes nothing about it. */
  it('writes no removal for an attacker who was not hiding', () => {
    const out = punch(WITHIN_REACH);
    expect(out.events.some((event) => event.type === 'condition-removed')).toBe(false);
  });

  /** The other half of the sentence: the spell. */
  it('ends the hiding on a spell the hider casts', () => {
    const casting: readonly GameEvent[] = [
      ...hidden([
        ...WITHIN_REACH,
        {
          type: 'resource-pool-declared',
          id: ROGUE,
          pool: { key: spellSlotKey(1), label: 'l1', max: 2, recovers: 'long-rest' },
        },
        {
          type: 'spellcasting-declared',
          id: ROGUE,
          spellcasting: declaredCasting({ ability: 'int', prepared: ['mage-armor'] }),
        },
      ]),
    ];
    const cast = unwrap(
      resolveSpell(
        fold('seed', casting),
        ROGUE,
        { spellId: 'mage-armor', targets: [ROGUE], slotLevel: 1 },
        supply('cast'),
      ),
      'the casting',
    );
    const after = [...casting, ...cast.events];

    expect(cast.events.some((event) => event.type === 'spell-cast')).toBe(true);
    expect(sourcesOn(after, ROGUE)).toEqual([]);
  });
});

/**
 * The third door into `hidingEndedBy`, and the one the other two cannot reach:
 * a casting **declared** on one command and settled on another.
 *
 * The two halves are a pair and only the second of them ends the hiding. SRD
 * says "you cast a spell", and a rite the caster is still muttering over has
 * not been cast — which is the same reading `target-casts` takes of
 * `spell-cast` rather than of `spell-declared`, because a declaration
 * Counterspell dissipates is not a spell anybody cast. So the declaration
 * leaves the Rogue hidden and the settlement is what gives them away.
 */
describe('SRD Hide: a casting declared on one command and settled on another', () => {
  const armed = (): readonly GameEvent[] => [
    ...WITHIN_REACH,
    {
      type: 'resource-pool-declared',
      id: ROGUE,
      pool: { key: spellSlotKey(1), label: 'l1', max: 2, recovers: 'long-rest' },
    },
    {
      type: 'spellcasting-declared',
      id: ROGUE,
      spellcasting: declaredCasting({ ability: 'int', prepared: ['mage-armor'] }),
    },
  ];

  const declare = (log: readonly GameEvent[]) =>
    unwrap(
      resolveSpell(
        fold('seed', log),
        ROGUE,
        { spellId: 'mage-armor', targets: [ROGUE], slotLevel: 1, hold: true },
        supply('declare'),
      ),
      'the declaration',
    );

  it('leaves the hiding standing while the casting is only declared', () => {
    const log = hidden(armed());
    const held = declare(log);
    const after = [...log, ...held.events];

    expect(pendingCastingsOf(fold('seed', after))).toHaveLength(1);
    expect(held.events.some((event) => event.type === 'spell-cast')).toBe(false);
    expect(sourcesOn(after, ROGUE)).toEqual(['action:hide']);
  });

  it('ends it when that casting settles', () => {
    const log = hidden(armed());
    const held = declare(log);
    const open = [...log, ...held.events];

    const settled = unwrap(
      resolveDeclaredCast(fold('seed', open), held.castingId!, supply('settle')),
      'the settlement',
    );
    const after = [...open, ...settled.events];

    expect(settled.events.some((event) => event.type === 'spell-cast')).toBe(true);
    expect(sourcesOn(after, ROGUE)).toEqual([]);
  });
});

/**
 * **The ruling this clause was waiting on, and the asymmetry it creates.**
 *
 * `canSee` is the seam every other sight rule in the engine comes through, and
 * for this one sentence it answers the wrong question: `sightBetween` reports
 * `true` from any member of `SIGHT_SENSES`, and Darkvision is one of the
 * three. Five SRD species carry Darkvision as a standing grant, so asking
 * `canSee` whether the watcher can see the hidden Rogue would take the
 * Advantage away from most of the party — silently, because a sense answers
 * `true` rather than `null` and the report below only fires on `null`.
 *
 * **Owner, 2026-09-20: Truesight and Blindsight satisfy "if a creature can
 * somehow see you". Darkvision does not.** That ruling is
 * `SENSES_THAT_SOMEHOW_SEE` and `canSomehowSee`, beside `canSee` in
 * `standing.ts`, and `senses.test.ts` holds it sense by sense.
 *
 * What this file pins is the **pair of answers on one creature**, because the
 * two questions disagree about her and a refactor that merged them would
 * silently pick a side:
 *
 * | Sentence | Question | The dwarf in the dark |
 * |---|---|---|
 * | Invisible's "if a creature can somehow see you" | `canSomehowSee` | `null` — nobody has said, and Darkvision does not answer |
 * | Dodge's "if you can see the attacker" | `canSee` | `true` — Darkvision genuinely satisfies it |
 *
 * So the hidden Rogue keeps their Advantage against her, *and* she keeps her
 * Dodge against the Rogue, out of the same sense in the same hall. Both are
 * asserted below.
 */
describe('the senses, and the ruling that parts the two sight questions', () => {
  const DWARF = id('dwarf');

  const dwarfChoices: CharacterChoices = {
    ...common,
    name: 'Dain',
    classId: 'fighter',
    level: 5,
    speciesId: 'dwarf',
    abilities: {
      method: 'standard-array',
      assignment: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
    },
    abilityIncreases: { con: 2, wis: 1 },
    classSkills: ['athletics', 'survival'],
    subclassId: 'champion',
    featureChoices: { 'fighter:weapon-mastery': [] },
    feats: {
      ...MAGIC_INITIATE,
      'fighter:fighting-style': { featId: 'archery' },
      'fighter:ability-score-improvement': { featId: 'savage-attacker' },
    },
  };

  /**
   * The Rogue Invisible and a dwarf five feet away who has declared nothing.
   * The condition is applied directly rather than hidden for, because a Hide
   * needs a declaration and the whole point here is that there is none.
   */
  const unlit = (): readonly GameEvent[] => [
    ...(unwrap(createCharacter(SRD_CONTENT, rogueChoices, ROGUE), 'the rogue') as GameEvent[]),
    { type: 'creature-side-declared', id: ROGUE, side: 'party' },
    ...(unwrap(createCharacter(SRD_CONTENT, dwarfChoices, DWARF), 'the dwarf') as GameEvent[]),
    { type: 'creature-side-declared', id: DWARF, side: 'delvers' },
    { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
    { type: 'landmark-added', name: 'the deep', at: { x: 100, y: 100, z: 0 } },
    { type: 'creature-placed', id: ROGUE, placement: { from: { landmark: 'the deep' }, feet: 0 } },
    {
      type: 'creature-placed',
      id: DWARF,
      placement: { from: { creature: ROGUE }, feet: 5, bearing: 0 },
    },
    { type: 'condition-applied', id: ROGUE, condition: 'invisible', source: 'casting:greater' },
  ];

  it('has the dwarf seeing the Rogue as far as canSee is concerned', () => {
    // The premise, stated rather than assumed: the sense really does answer,
    // so the test below is about what this clause does with that answer.
    expect(canSee(fold('seed', unlit()), DWARF, ROGUE)).toBe(true);
  });

  /**
   * **And the ruling, on the same dwarf in the same breath.** The whole point
   * of the owner's decision is that these two lines disagree; asserting them
   * together is what stops a later refactor from quietly making them agree.
   */
  it('has her not somehow seeing them, which is the ruling', () => {
    expect(canSomehowSee(fold('seed', unlit()), DWARF, ROGUE)).toBeNull();
  });

  it('does not let Darkvision alone take the Invisible attacker’s Advantage', () => {
    const out = unwrap(
      resolveAttack(
        fold('seed', unlit()),
        ROGUE,
        { target: DWARF, weapon: null, attackBonuses: [{ source: 'forced', flat: 40 }] },
        supply('deep'),
      ),
      'the swing',
    );

    expect(out.attack?.roll.mode).toBe('advantage');
    expect(out.unverified.some((line) => line.includes('Invisible'))).toBe(true);
  });

  /**
   * **The other half of the asymmetry, and the reason `defendingModes` was
   * left alone.** SRD Dodge: "any attack roll made against you has
   * Disadvantage **if you can see the attacker**." That is a sentence about
   * ordinary sight in a dark hall, and Darkvision satisfies it — so the same
   * sense that says nothing about the Invisible Rogue keeps the dwarf's Dodge
   * whole, with nobody having declared a thing.
   *
   * The silence is asserted too: `rollModesFor` reports an unverified line
   * whenever an `ifSeen` grant had to apply on a `null`, and there is no
   * `null` here — the sense answered.
   */
  it('keeps the dwarf’s Dodge against an attacker her Darkvision reaches', () => {
    const seen: readonly GameEvent[] = [
      // No Invisible on anybody: this is the plain sight question, not the clause.
      ...unlit().filter((event) => event.type !== 'condition-applied'),
      {
        type: 'combat-started',
        combatants: [
          { id: DWARF, initiative: 20, speed: 30 },
          { id: ROGUE, initiative: 10, speed: 30 },
        ],
      },
    ];
    const dodged = [...seen, ...unwrap(takeDodge(fold('seed', seen), DWARF, {}), 'the Dodge')];
    // Play passes to the Rogue, which is the only order in which they can swing.
    const passed = [
      ...dodged,
      ...unwrap(resolveTurn(fold('seed', dodged), supply('turn')), 'the turn').events,
    ];

    expect(canSee(fold('seed', passed), DWARF, ROGUE)).toBe(true);

    const out = unwrap(
      resolveAttack(
        fold('seed', passed),
        ROGUE,
        { target: DWARF, weapon: null, attackBonuses: [{ source: 'forced', flat: 40 }] },
        supply('deep'),
      ),
      'the swing',
    );

    expect(out.attack?.roll.mode).toBe('disadvantage');
    expect(out.unverified.some((line) => line.includes('can see'))).toBe(false);
  });

  /** And a declaration still outranks everything, which is the rule that did land. */
  it('still takes it away when the dwarf is declared to see them', () => {
    const declared: readonly GameEvent[] = [
      ...unlit(),
      { type: 'sight-declared', from: DWARF, to: ROGUE, seen: true },
    ];
    const out = unwrap(
      resolveAttack(
        fold('seed', declared),
        ROGUE,
        { target: DWARF, weapon: null, attackBonuses: [{ source: 'forced', flat: 40 }] },
        supply('deep'),
      ),
      'the swing',
    );

    expect(out.attack?.roll.mode).toBe('normal');
    expect(out.unverified.some((line) => line.includes('Invisible'))).toBe(false);
  });
});
