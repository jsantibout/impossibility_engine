import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, type CharacterId, type Result } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent } from './events.js';
import { spellSlotKey } from './resources.js';
import { declaredCasting } from './spellcasting.js';
import { rollModesFor } from './standing.js';
import { activateSpell, resolveAttack, resolveSpell } from './commands.js';
import { checkSpellDefinition } from './spell-schema.js';
import type { SpellDefinition } from './spell-definitions.js';

/**
 * A curse that rides the caster's **later** blows.
 *
 * Three SRD sentences that are one family, and the family is what this file
 * is about rather than any one spell:
 *
 * > Hex: "Until the spell ends, you deal an extra 1d6 Necrotic damage to the
 * > target whenever you hit it with an attack roll. Also, choose one ability
 * > when you cast the spell. The target has Disadvantage on ability checks
 * > made with the chosen ability. **If the target drops to 0 Hit Points
 * > before this spell ends, you can take a Bonus Action on a later turn to
 * > curse a new creature.**"
 *
 * > Hunter's Mark: "**If the target drops to 0 Hit Points before this spell
 * > ends, you can take a Bonus Action to move the mark to a new creature you
 * > can see within range.**"
 *
 * The rider on later blows was built for Hunter's Mark and Hex is the same
 * effect with Necrotic dice; the ability the caster names is Enhance
 * Ability's stated choice with the mode reversed. What is new here is the
 * **re-aim**: a later action, legal only while the creature the casting
 * marked is down, that ends the curse on them and lays the same casting's
 * grants on somebody else.
 */

const id = (s: string) => asCharacterId(s);
const CASTER = id('caster');
const QUARRY = id('quarry');
const SECOND = id('second');
const UNSEEN = id('unseen');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 18, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'wis',
  weaponProficiencies: ['simple', 'martial'],
  ...over,
});

const added = (
  who: CharacterId,
  defenses: Readonly<Record<string, Readonly<{ resistant?: boolean }>>> = {},
  maxHp = 400,
): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp,
  diesAtZero: false,
  creatureType: 'Humanoid',
  defenses,
});

const slotsFor = (who: CharacterId): readonly GameEvent[] =>
  [1, 2, 3, 4, 5, 9].map((level) => ({
    type: 'resource-pool-declared',
    id: who,
    pool: {
      key: spellSlotKey(level),
      label: `level ${level} spell slot`,
      max: 4,
      recovers: 'long-rest',
    },
  }));

/**
 * A declared caster rather than a class one, for `attack-riders.test.ts`'s
 * reason: Hex is a Warlock's, Hunter's Mark a Ranger's, and one fixture holds
 * both without inventing a multiclass nobody asked for.
 */
const table = (
  quarryDefenses: Readonly<Record<string, Readonly<{ resistant?: boolean }>>> = {},
): readonly GameEvent[] => [
  added(CASTER),
  ...slotsFor(CASTER),
  {
    type: 'spellcasting-declared',
    id: CASTER,
    spellcasting: declaredCasting({
      ability: 'wis',
      cantrips: ['fire-bolt'],
      prepared: ['hex', 'hunters-mark', 'bestow-curse', 'magic-missile'],
    }),
  },
  {
    type: 'items-gained',
    id: CASTER,
    items: [{ id: 'mace', quantity: 1 }],
    source: 'kit',
  },
  added(QUARRY, quarryDefenses, 20),
  added(SECOND),
  added(UNSEEN),
  { type: 'scene-set', extent: { width: 600, depth: 600, height: 40 } },
  { type: 'landmark-added', name: 'the road', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: CASTER, placement: { from: { landmark: 'the road' }, feet: 0 } },
  {
    type: 'creature-placed',
    id: QUARRY,
    placement: { from: { creature: CASTER }, feet: 5, bearing: 0 },
  },
  {
    type: 'creature-placed',
    id: SECOND,
    placement: { from: { creature: CASTER }, feet: 5, bearing: 90 },
  },
  {
    type: 'creature-placed',
    id: UNSEEN,
    placement: { from: { creature: CASTER }, feet: 10, bearing: 180 },
  },
  { type: 'sight-declared', from: CASTER, to: QUARRY, seen: true },
  { type: 'sight-declared', from: CASTER, to: SECOND, seen: true },
  { type: 'sight-declared', from: CASTER, to: UNSEEN, seen: false },
];

const supply = (seed = 'curse', flat?: number) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
  ...(flat === undefined ? {} : { bonuses: [{ source: 'the test insists', flat }] }),
});

/** Certain to fail a save, and certain to make one. */
const DOOMED = -40;
const CERTAIN = 40;

const must = <T,>(result: Result<T>): T => unwrap(result, 'later blows');

const cast = (
  log: readonly GameEvent[],
  request: Parameters<typeof resolveSpell>[2],
  flat?: number,
): readonly GameEvent[] => [
  ...log,
  ...must(resolveSpell(fold('seed', log), CASTER, request, supply(request.spellId, flat))).events,
];

/** Swing with the attack roll forced to land, so the test is about the rider. */
const swing = (log: readonly GameEvent[], target: CharacterId, seed = 'blow') => {
  const out = must(
    resolveAttack(
      fold('seed', log),
      CASTER,
      { target, weapon: 'mace', attackBonuses: [{ source: 'forced', flat: 40 }] },
      supply(seed),
    ),
  );
  if (out.attack?.hit !== true) throw new Error('the fixture meant this swing to land');
  return out;
};

/** A Fire Bolt, which is an attack roll and is not a weapon. */
const bolt = (log: readonly GameEvent[], target: CharacterId, seed = 'bolt') =>
  must(
    resolveSpell(
      fold('seed', log),
      CASTER,
      { spellId: 'fire-bolt', targets: [target] },
      { ...supply(seed), bonuses: [{ source: 'forced', flat: 40 }] },
    ),
  );

const modes = (
  log: readonly GameEvent[],
  query: Parameters<typeof rollModesFor>[1],
): readonly string[] =>
  rollModesFor(fold('seed', log), query).modes.map((m) =>
    typeof m === 'string' ? m : m.mode,
  );

// — Hex's first two sentences ——————————————————————————————————————————————

describe('Hex rides every later attack the Warlock lands on the target', () => {
  const hexed = (choice = 'str') =>
    cast(table(), { spellId: 'hex', targets: [QUARRY], choice });

  it('adds its die against the cursed creature', () => {
    expect(swing(hexed(), QUARRY).damage!).toBeGreaterThan(swing(table(), QUARRY).damage!);
  });

  /**
   * "to the target" — and the second goblin is not the target, whichever
   * attack roll the Warlock makes.
   */
  it('adds nothing to a Fire Bolt aimed at somebody else', () => {
    expect(bolt(hexed(), SECOND).outcomes[0]!.damage).toBe(
      bolt(table(), SECOND).outcomes[0]!.damage,
    );
  });

  /**
   * "whenever you hit it **with an attack roll**", which a Fire Bolt is — the
   * clause `attack-rider` already keeps for Hunter's Mark, asserted here
   * because Hex is the second writer of it.
   */
  it('reaches a spell attack aimed at the cursed creature', () => {
    expect(bolt(hexed(), QUARRY).outcomes[0]!.damage!).toBeGreaterThan(
      bolt(table(), QUARRY).outcomes[0]!.damage!,
    );
  });

  /**
   * **The discriminating fixture**: a creature that resists Necrotic and not
   * Bludgeoning takes less than one that resists neither, which can only
   * happen if the 1d6 met its defences as a component of its own.
   */
  it('is Necrotic damage, resisted as Necrotic', () => {
    const open = swing(hexed(), QUARRY);
    const proof = swing(
      cast(table({ necrotic: { resistant: true } }), {
        spellId: 'hex',
        targets: [QUARRY],
        choice: 'str',
      }),
      QUARRY,
    );
    expect(proof.damage!).toBeLessThan(open.damage!);
  });
});

describe('Hex’s chosen ability', () => {
  it('gives the target Disadvantage on ability checks made with it', () => {
    const log = cast(table(), { spellId: 'hex', targets: [QUARRY], choice: 'str' });
    expect(modes(log, { family: 'ability-check', roller: QUARRY, ability: 'str' })).toContain(
      'disadvantage',
    );
    expect(
      modes(log, { family: 'ability-check', roller: QUARRY, ability: 'dex' }),
    ).not.toContain('disadvantage');
  });

  /**
   * "ability checks" and not saving throws — the narrowing `RollSelector`
   * keeps on purpose, and the line where Hex and Bestow Curse's first face
   * differ.
   */
  it('leaves a saving throw of the same ability alone', () => {
    const log = cast(table(), { spellId: 'hex', targets: [QUARRY], choice: 'str' });
    expect(
      modes(log, { family: 'saving-throw', roller: QUARRY, ability: 'str' }),
    ).not.toContain('disadvantage');
  });
});

describe('Hex’s Concentration grows with the slot', () => {
  const deadlineOf = (log: readonly GameEvent[]): number => {
    const state = fold('seed', log);
    const timer = Object.values(state.timers).find((one) => one.target.kind === 'casting');
    if (timer?.deadline.kind !== 'elapsed') throw new Error('the casting kept no deadline');
    return timer.deadline.at;
  };

  /** "level 2 (up to 4 hours), 3–4 (up to 8 hours), or 5+ (24 hours)." */
  it('buys eight hours out of a level 3 slot', () => {
    expect(
      deadlineOf(cast(table(), { spellId: 'hex', targets: [QUARRY], choice: 'str', slotLevel: 3 })),
    ).toBe(28800);
  });

  it('buys four out of a level 2 slot and an hour out of a level 1', () => {
    expect(
      deadlineOf(cast(table(), { spellId: 'hex', targets: [QUARRY], choice: 'str', slotLevel: 2 })),
    ).toBe(14400);
    expect(
      deadlineOf(cast(table(), { spellId: 'hex', targets: [QUARRY], choice: 'str' })),
    ).toBe(3600);
  });
});

// — the mark that moves when its holder drops —————————————————————————————

/** Enough damage to put the 20-hit-point quarry at 0. */
const felled = (log: readonly GameEvent[]): readonly GameEvent[] => [
  ...log,
  { type: 'damage-taken', id: QUARRY, amount: 50, source: 'a cliff' },
];

const reAim = (
  log: readonly GameEvent[],
  to: CharacterId,
  castingId = 'cast:1',
): Result<unknown> =>
  activateSpell(fold('seed', log), CASTER, { castingId, targets: [to] }, supply('re-aim'));

describe('the Bonus Action that curses a new creature', () => {
  const hexed = () => cast(table(), { spellId: 'hex', targets: [QUARRY], choice: 'str' });

  it('is refused while the quarry is still standing', () => {
    const out = reAim(hexed(), SECOND);
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.code).toBe('quarry_still_standing');
  });

  it('is refused on a creature the caster cannot see', () => {
    const out = reAim(felled(hexed()), UNSEEN);
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.code).toBe('cannot_see_target');
  });

  it('is refused on the creature it already marks', () => {
    const out = reAim(felled(hexed()), QUARRY);
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.code).toBe('already_marked');
  });

  it('moves the extra die and the Disadvantage to the new creature', () => {
    const down = felled(hexed());
    const moved = [...down, ...must(reAim(down, SECOND) as Result<{ events: readonly GameEvent[] }>).events];

    // The die rides the new creature and nobody else.
    expect(swing(moved, SECOND).damage!).toBeGreaterThan(swing(table(), SECOND).damage!);
    // And the chosen ability travels with it.
    expect(modes(moved, { family: 'ability-check', roller: SECOND, ability: 'str' })).toContain(
      'disadvantage',
    );
    expect(
      modes(moved, { family: 'ability-check', roller: QUARRY, ability: 'str' }),
    ).not.toContain('disadvantage');
  });

  /**
   * **What happens to the creature the curse was on**, which is the half the
   * grants above cannot show: the casting ends *on them* and goes on running
   * for the caster, under a reason that says a curse was moved rather than
   * given up on.
   */
  it('ends the casting on the old creature and leaves it running', () => {
    const down = felled(hexed());
    const out = must(reAim(down, SECOND) as Result<{ events: readonly GameEvent[] }>);
    const ended = out.events.find((event) => event.type === 'spell-ended');
    expect(ended).toMatchObject({
      type: 'spell-ended',
      castingId: 'cast:1',
      on: QUARRY,
      reason: 're-aimed',
    });
    // The casting itself is still there: an `on` releases one creature and
    // ends nothing else.
    expect(Object.keys(fold('seed', [...down, ...out.events]).ongoing)).toEqual(['cast:1']);
  });

  /**
   * **And it costs the Bonus Action the book prints**, asserted where a Bonus
   * Action exists to be spent: outside combat there is no budget at all, so a
   * fixture with no Initiative proves nothing about the economy.
   */
  it("spends the caster's Bonus Action, and there is only one", () => {
    const down = [
      ...felled(hexed()),
      {
        type: 'combat-started',
        combatants: [
          { id: CASTER, initiative: 20, speed: 30 },
          { id: SECOND, initiative: 10, speed: 30 },
        ],
      } as GameEvent,
    ];
    const first = must(reAim(down, SECOND) as Result<{ events: readonly GameEvent[] }>);
    expect(first.events.some((event) => event.type === 'bonus-action-spent')).toBe(true);

    // A second move on the same turn has nothing left to pay with. The new
    // quarry is put down first so the *legality* is satisfied and the economy
    // is the only thing left to refuse — a refusal before the action is
    // charged would otherwise hide it.
    const after: readonly GameEvent[] = [
      ...down,
      ...first.events,
      { type: 'damage-taken', id: SECOND, amount: 500, source: 'a cliff' },
    ];
    const again = activateSpell(
      fold('seed', after),
      CASTER,
      { castingId: 'cast:1', targets: [QUARRY] },
      supply('again'),
    );
    expect(again.ok).toBe(false);
    expect(again.ok === false && again.code).toBe('no_bonus_action');
  });
});

describe("Hunter's Mark moves the same way", () => {
  const marked = () => cast(table(), { spellId: 'hunters-mark', targets: [QUARRY] });

  it('is refused while the quarry stands and allowed once it is down', () => {
    expect((reAim(marked(), SECOND) as Result<unknown>).ok).toBe(false);
    const down = felled(marked());
    const moved = [...down, ...must(reAim(down, SECOND) as Result<{ events: readonly GameEvent[] }>).events];
    expect(swing(moved, SECOND).damage!).toBeGreaterThan(swing(table(), SECOND).damage!);
    // And the mark is off the creature it was on, which is the half a
    // re-granting from the same source performs by replacing rather than
    // stacking.
    expect(swing(moved, QUARRY).damage!).toBe(swing(table(), QUARRY).damage!);
  });
});

/**
 * A casting that marks nobody, which is what the refusal is for.
 *
 * The rider is the only record of which creature the mark is on, so a casting
 * whose rider has been released holds no answer — and the command says so
 * rather than picking a target of its own. Reached by ending the casting on
 * the creature that *holds* the rider, which is the caster: `spell-ended` with
 * an `on` releases one creature's grants and leaves the casting running.
 */
describe('a casting whose mark has gone', () => {
  it('refuses the Bonus Action rather than inventing a quarry', () => {
    const log: readonly GameEvent[] = [
      ...cast(table(), { spellId: 'hunters-mark', targets: [QUARRY] }),
      { type: 'spell-ended', castingId: 'cast:1', on: CASTER, reason: 'dispelled' },
    ];
    const out = reAim(log, SECOND);
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.code).toBe('nothing_marked');
  });
});

// — what a definition may say about re-aiming ——————————————————————————————

describe('checkSpellDefinition on a re-aiming activation', () => {
  const base = (): SpellDefinition => ({
    id: 'homebrew-curse',
    name: 'Homebrew Curse',
    level: 1,
    school: 'necromancy',
    castingTime: 'bonus-action',
    concentration: true,
    range: { kind: 'ranged', feet: 90 },
    targets: { count: 1 },
    effects: [{ kind: 'attack-rider', dice: '1d6', damageType: 'necrotic', marksTarget: true }],
    durationSeconds: 3600,
    activation: {
      action: 'bonus-action',
      range: { kind: 'ranged', feet: 90 },
      reAims: true,
      label: 'Homebrew Curse (again)',
      effects: [],
    },
  });

  const codes = (definition: SpellDefinition): readonly string[] =>
    checkSpellDefinition(definition).map((problem) => problem.code);

  it('accepts one that marks somebody and resolves nothing of its own', () => {
    expect(codes(base())).toEqual([]);
  });

  /** There is nothing to move where the spell marks nobody. */
  it('refuses one whose spell hangs no mark', () => {
    const marksNobody: SpellDefinition = {
      ...base(),
      effects: [{ kind: 'attack-rider', dice: '1d6', damageType: 'necrotic' }],
    };
    expect(codes(marksNobody)).toContain('re_aims_nothing');
  });

  /** The new creature gets the casting's own effects, so a list here is a second sentence. */
  it('refuses one that resolves a list of its own', () => {
    const resolves: SpellDefinition = {
      ...base(),
      activation: {
        ...base().activation!,
        effects: [{ kind: 'temp-hp', amount: { dice: '1d4' }, addSpellcastingModifier: false }],
      },
    };
    expect(codes(resolves)).toContain('re_aim_resolves_effects');
  });
});

// — Bestow Curse: four faces, of which a casting runs one —————————————————

describe('Bestow Curse picks one of the four the book prints', () => {
  const curse = (option: string, over: Record<string, unknown> = {}, flat = DOOMED) =>
    cast(table(), { spellId: 'bestow-curse', targets: [QUARRY], slotLevel: 3, option, ...over }, flat);

  /**
   * "Choose one ability. The target has Disadvantage on ability checks **and
   * saving throws** made with that ability." Two families and one ability,
   * which is two riders on the save that gates them.
   */
  it('gives Disadvantage on checks and saves with the chosen ability', () => {
    const log = curse('ability', { choice: 'dex' });
    expect(modes(log, { family: 'ability-check', roller: QUARRY, ability: 'dex' })).toContain(
      'disadvantage',
    );
    expect(modes(log, { family: 'saving-throw', roller: QUARRY, ability: 'dex' })).toContain(
      'disadvantage',
    );
    expect(
      modes(log, { family: 'ability-check', roller: QUARRY, ability: 'str' }),
    ).not.toContain('disadvantage');
  });

  /** "or become cursed" — a creature that makes the save is cursed with nothing. */
  it('curses nobody on a made save', () => {
    const log = curse('ability', { choice: 'dex' }, CERTAIN);
    expect(
      modes(log, { family: 'ability-check', roller: QUARRY, ability: 'dex' }),
    ).not.toContain('disadvantage');
  });

  /**
   * "The target has Disadvantage on attack rolls **against you**" — the
   * counterpart, which is the sentence `ModifierRider.counterpart` was written
   * for and named after.
   */
  it('narrows the attack Disadvantage to the caster', () => {
    const log = curse('attacks-against-you');
    expect(
      modes(log, { family: 'attack', roller: QUARRY, against: CASTER }),
    ).toContain('disadvantage');
    expect(
      modes(log, { family: 'attack', roller: QUARRY, against: SECOND }),
    ).not.toContain('disadvantage');
  });

  /**
   * The branch decides whether the ability is asked for: the first bullet
   * prints "Choose one ability" and the other three print no such words.
   */
  it('asks for the ability on the branch that prints it and on no other', () => {
    const state = fold('seed', table());
    const unanswered = resolveSpell(
      state,
      CASTER,
      { spellId: 'bestow-curse', targets: [QUARRY], slotLevel: 3, option: 'ability' },
      supply('bestow-curse', DOOMED),
    );
    expect(unanswered.ok).toBe(false);
    expect(unanswered.ok === false && unanswered.code).toBe('choice_required');

    const unwanted = resolveSpell(
      state,
      CASTER,
      {
        spellId: 'bestow-curse',
        targets: [QUARRY],
        slotLevel: 3,
        option: 'attacks-against-you',
        choice: 'dex',
      },
      supply('bestow-curse', DOOMED),
    );
    expect(unwanted.ok).toBe(false);
    expect(unwanted.ok === false && unwanted.code).toBe('no_choice_clause');
  });
});

describe('Bestow Curse’s slot table', () => {
  const deadline = (log: readonly GameEvent[]): number => {
    const state = fold('seed', log);
    const timer = Object.values(state.timers).find((one) => one.target.kind === 'casting');
    if (timer?.deadline.kind !== 'elapsed') throw new Error('the casting kept no deadline');
    return timer.deadline.at;
  };
  const concentrating = (log: readonly GameEvent[]): boolean =>
    fold('seed', log).creatures[CASTER]?.concentration !== null;

  it('runs a minute of Concentration out of a level 3 slot', () => {
    const log = cast(
      table(),
      { spellId: 'bestow-curse', targets: [QUARRY], slotLevel: 3, option: 'attacks-against-you' },
      DOOMED,
    );
    expect(deadline(log)).toBe(60);
    expect(concentrating(log)).toBe(true);
  });

  it('runs ten minutes of Concentration out of a level 4 slot', () => {
    const log = cast(
      table(),
      { spellId: 'bestow-curse', targets: [QUARRY], slotLevel: 4, option: 'attacks-against-you' },
      DOOMED,
    );
    expect(deadline(log)).toBe(600);
    expect(concentrating(log)).toBe(true);
  });

  /** "If you use a level 5+ spell slot, the spell doesn’t require Concentration." */
  it('runs eight hours and holds nothing out of a level 5 slot', () => {
    const log = cast(
      table(),
      { spellId: 'bestow-curse', targets: [QUARRY], slotLevel: 5, option: 'attacks-against-you' },
      DOOMED,
    );
    expect(deadline(log)).toBe(28800);
    expect(concentrating(log)).toBe(false);
  });

  /** "If you use a level 9 spell slot, the spell lasts until dispelled." */
  it('keeps no deadline at all out of a level 9 slot', () => {
    const log = cast(
      table(),
      { spellId: 'bestow-curse', targets: [QUARRY], slotLevel: 9, option: 'attacks-against-you' },
      DOOMED,
    );
    const state = fold('seed', log);
    expect(Object.values(state.timers).some((one) => one.target.kind === 'casting')).toBe(false);
    expect(Object.values(state.ongoing).some((record) => record.spell === 'Bestow Curse')).toBe(true);
    expect(concentrating(log)).toBe(false);
  });
});

describe('Bestow Curse’s fourth face rides a spell as well as an attack', () => {
  const cursed = () =>
    cast(
      table(),
      { spellId: 'bestow-curse', targets: [QUARRY], slotLevel: 3, option: 'extra-damage' },
      DOOMED,
    );

  /** "with an attack roll" — the Cleric's mace, which is the road the gatherer already walked. */
  it('adds its die to a weapon attack on the cursed creature', () => {
    expect(swing(cursed(), QUARRY).damage!).toBeGreaterThan(swing(table(), QUARRY).damage!);
  });

  /** "or a spell" — a Magic Missile, which no attack roll bought. */
  const missiles = (log: readonly GameEvent[], target: CharacterId) =>
    must(
      resolveSpell(
        fold('seed', log),
        CASTER,
        { spellId: 'magic-missile', targets: [target] },
        supply('missile'),
      ),
    );

  it('adds its die to the damage of a spell that rolls no attack', () => {
    const open = missiles(table(), QUARRY);
    const under = missiles(cursed(), QUARRY);
    const sum = (out: ReturnType<typeof missiles>) =>
      out.outcomes.reduce((total, one) => total + (one.damage ?? 0), 0);
    expect(sum(under)).toBeGreaterThan(sum(open));
  });

  /** "**the target**" — and the second goblin is not it. */
  it('leaves a spell aimed at anybody else alone', () => {
    const sum = (out: ReturnType<typeof missiles>) =>
      out.outcomes.reduce((total, one) => total + (one.damage ?? 0), 0);
    expect(sum(missiles(cursed(), SECOND))).toBe(sum(missiles(table(), SECOND)));
  });

  /**
   * **The discriminating fixture**: a creature that resists Necrotic and not
   * Force takes less, which can only happen if the 1d8 met its defences as a
   * component of its own rather than being folded into the darts.
   */
  it('is Necrotic damage, resisted as Necrotic', () => {
    const open = missiles(cursed(), QUARRY);
    const proof = missiles(
      cast(
        table({ necrotic: { resistant: true } }),
        { spellId: 'bestow-curse', targets: [QUARRY], slotLevel: 3, option: 'extra-damage' },
        DOOMED,
      ),
      QUARRY,
    );
    const sum = (out: ReturnType<typeof missiles>) =>
      out.outcomes.reduce((total, one) => total + (one.damage ?? 0), 0);
    expect(sum(proof)).toBeLessThan(sum(open));
  });

  /** A made save hands out nothing at all. */
  it('hangs nothing on a made save', () => {
    const made = cast(
      table(),
      { spellId: 'bestow-curse', targets: [QUARRY], slotLevel: 3, option: 'extra-damage' },
      CERTAIN,
    );
    expect(swing(made, QUARRY).damage!).toBe(swing(table(), QUARRY).damage!);
  });
});

/**
 * The negative of the sentence above, and the reason `alsoSpells` is a field
 * rather than the behaviour of every rider.
 *
 * SRD Hex and SRD Hunter's Mark both print "whenever you hit it **with an
 * attack roll**", and a Magic Missile is not one: the darts strike
 * automatically. A rider that reached this road whatever its sentence said
 * would have handed both spells a die the book does not give them, on the
 * road nothing measures.
 */
describe('a rider printed about an attack roll stays off a spell that rolls none', () => {
  const sum = (out: { readonly outcomes: readonly { readonly damage?: number }[] }) =>
    out.outcomes.reduce((total, one) => total + (one.damage ?? 0), 0);
  const missiles = (log: readonly GameEvent[]) =>
    must(
      resolveSpell(
        fold('seed', log),
        CASTER,
        { spellId: 'magic-missile', targets: [QUARRY] },
        supply('missile'),
      ),
    );

  it('adds nothing to Magic Missile against a hexed creature', () => {
    const hexed = cast(table(), { spellId: 'hex', targets: [QUARRY], choice: 'str' });
    expect(sum(missiles(hexed))).toBe(sum(missiles(table())));
  });

  it("adds nothing to Magic Missile against Hunter's Mark's quarry", () => {
    const marked = cast(table(), { spellId: 'hunters-mark', targets: [QUARRY] });
    expect(sum(missiles(marked))).toBe(sum(missiles(table())));
  });
});
