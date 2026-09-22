import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import type { StandingEffect } from './standing.js';
import { createRng, type Rng, type RngState } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { spellSlotKey } from './resources.js';
import { resolveAttack, resolveSpell } from './commands.js';
import { declaredCasting } from './spellcasting.js';
import { PASSIVE_DEFENSE_LEDGER } from './combat.js';

/**
 * Three SRD spells that intervene in somebody else's attack with **nobody
 * taking a Reaction**.
 *
 * The owner's ruling of 2026-09-22 named the shape: a passive defence is an
 * ongoing effect on the defender that the attack path must consult, and the
 * defender elects nothing. That is not the `pendingAttack` hold SRD Shield
 * answers — a hold is a window somebody steps into — and it is not a roll
 * modifier either, because none of the three changes a number on the d20.
 *
 * | | The sentence | When |
 * |---|---|---|
 * | Mirror Image | "Each time a creature **hits** you with an attack roll … roll a d6 for each of your remaining duplicates" | after the hit is known |
 * | Fire Shield | "whenever a creature within 5 feet of you **hits** you with a melee attack roll, the shield erupts" | after the hit is known |
 * | Sanctuary | "any creature who **targets** the warded creature with an attack roll … must succeed on a Wisdom saving throw" | before the roll |
 *
 * **Mirror Image fires on a hit and not on targeting**, which is the reading
 * three earlier attempts at this shape got wrong by inheriting each other's
 * prose. The book is quoted above; `packages/srd/raw/spells.md` is where it is
 * quoted from. It matters because the two moments are different pieces of
 * machinery: targeting is the casting's, and the hit is one line above the
 * hold this engine already builds.
 */

const id = (s: string) => asCharacterId(s);
const WIZARD = id('wizard');
const CLERIC = id('cleric');
const OGRE = id('ogre');
const ARCHER = id('archer');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 5,
  abilities: { str: 14, dex: 12, con: 12, int: 16, wis: 14, cha: 10 },
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

const added = (who: CharacterId, side: string, over: Partial<CharacterSheet> = {}): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(over),
  maxHp: 60,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side,
});

/** The ogre again, with one sense its block did not print. */
const SEEING_OGRE = (sense: 'truesight' | 'blindsight'): GameEvent =>
  added(OGRE, 'ogres', {
    standing: [
      {
        feature: 'a-species:a-trait',
        name: 'A Sense',
        reach: { kind: 'self' },
        grant: { kind: 'sense', sense, feet: 60 },
      },
    ] as readonly StandingEffect[],
  });

const slots = (who: CharacterId): readonly GameEvent[] =>
  [1, 2, 3, 4].map(
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

const SETUP: readonly GameEvent[] = [
  added(WIZARD, 'party'),
  added(CLERIC, 'party', { spellcastingAbility: 'wis' }),
  added(OGRE, 'ogres'),
  added(ARCHER, 'ogres'),
  ...slots(WIZARD),
  ...slots(CLERIC),
  { type: 'items-gained', id: OGRE, items: [{ id: 'greatclub', quantity: 1 }], source: 'kit' },
  { type: 'items-gained', id: ARCHER, items: [{ id: 'shortbow', quantity: 1 }], source: 'kit' },
  { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
  { type: 'landmark-added', name: 'the hall', at: { x: 60, y: 60, z: 0 } },
  { type: 'creature-placed', id: WIZARD, placement: { from: { landmark: 'the hall' }, feet: 0 } },
  {
    type: 'creature-placed',
    id: OGRE,
    placement: { from: { creature: WIZARD }, feet: 5, bearing: 0 },
  },
  {
    type: 'creature-placed',
    id: CLERIC,
    placement: { from: { creature: OGRE }, feet: 5, bearing: 90 },
  },
  {
    type: 'creature-placed',
    id: ARCHER,
    placement: { from: { creature: WIZARD }, feet: 60, bearing: 90 },
  },
  { type: 'sight-declared', from: OGRE, to: WIZARD, seen: true },
  { type: 'sight-declared', from: ARCHER, to: WIZARD, seen: true },
  { type: 'sight-declared', from: WIZARD, to: OGRE, seen: true },
  { type: 'sight-declared', from: CLERIC, to: WIZARD, seen: true },
  { type: 'sight-declared', from: CLERIC, to: OGRE, seen: true },
  {
    type: 'spellcasting-declared',
    id: WIZARD,
    spellcasting: declaredCasting({
      ability: 'int',
      cantrips: ['fire-bolt'],
      prepared: ['mirror-image', 'fire-shield'],
    }),
  },
  // The ogre casts nothing of its own; the cantrip is here so the casting side
  // of a ward can be driven by the same creature the weapon side uses, which
  // is what makes the two counts comparable.
  {
    type: 'spellcasting-declared',
    id: OGRE,
    spellcasting: declaredCasting({ ability: 'int', cantrips: ['fire-bolt'], prepared: [] }),
  },
  {
    type: 'spellcasting-declared',
    id: CLERIC,
    spellcasting: declaredCasting({
      ability: 'wis',
      cantrips: ['fire-bolt'],
      prepared: ['sanctuary'],
    }),
  },
];

/**
 * A generator that rolls exactly what it is told to, so a test can say which
 * die mattered rather than hoping a seed obliges.
 *
 * Every passive defence here turns on a threshold — a d6 that reached 3, a
 * save that beat a DC — and a seeded roll cannot show which side of one it
 * fell. Scripting the sequence makes the branch observable.
 */
const scripted = (values: readonly number[]): Rng => {
  let i = 0;
  return { int: () => values[i++ % values.length]!, snapshot: (): RngState => [0, 0, 0, 0] };
};

const supply = (rng: Rng = createRng('roll') as Rng) => ({
  issuer: createRollIssuer('r'),
  rng,
  content: SRD_CONTENT,
});

const cast = (
  log: readonly GameEvent[],
  who: CharacterId,
  request: Parameters<typeof resolveSpell>[2],
): readonly GameEvent[] => [
  ...log,
  ...unwrap(resolveSpell(fold('seed', log), who, request, supply(createRng('cast') as Rng)), 'cast')
    .events,
];

const swing = (
  log: readonly GameEvent[],
  attacker: CharacterId,
  command: Parameters<typeof resolveAttack>[2],
  rng: Rng,
) => resolveAttack(fold('seed', log), attacker, command, supply(rng));

const hit = (
  log: readonly GameEvent[],
  attacker: CharacterId,
  command: Parameters<typeof resolveAttack>[2],
  rng: Rng,
) => unwrap(swing(log, attacker, command, rng), 'attack');

const hpOf = (state: GameState, who: CharacterId): number => state.creatures[who]!.vitals.hp;

const mirrored = (log: readonly GameEvent[] = SETUP): readonly GameEvent[] =>
  cast(log, WIZARD, { spellId: 'mirror-image', targets: [WIZARD], slotLevel: 2 });

const warded = (log: readonly GameEvent[] = SETUP): readonly GameEvent[] =>
  cast(log, CLERIC, { spellId: 'sanctuary', targets: [WIZARD], slotLevel: 1 });

/** The warm shield: the caster asks for Resistance to Cold, so the flames are Fire. */
const shielded = (log: readonly GameEvent[] = SETUP): readonly GameEvent[] =>
  cast(log, WIZARD, {
    spellId: 'fire-shield',
    targets: [WIZARD],
    slotLevel: 4,
    damageType: 'cold',
  });

const CLUB = { target: WIZARD, weapon: 'greatclub' } as const;

// — Mirror Image ——————————————————————————————————————————————————————————————

describe('a duplicate takes the blow', () => {
  /**
   * The whole spell in one assertion: the ogre hits, and the wizard is not
   * touched. The d20 is a 20 so the hit is never in doubt, and every d6 after
   * it is a 6, which is the "3 or higher" the book asks for.
   */
  it('deflects a hit onto a duplicate and deals the wizard nothing', () => {
    const log = mirrored();
    const before = hpOf(fold('seed', log), WIZARD);
    const out = hit(log, OGRE, CLUB, scripted([20, 6]));

    expect(out.attack!.hit).toBe(true);
    expect(out.deflected).toBe(true);
    expect(out.damage).toBeUndefined();
    expect(hpOf(fold('seed', [...log, ...out.events]), WIZARD)).toBe(before);
  });

  /**
   * **The hold is not built**, which is the ruling's own fence: a passive
   * defence must not open, close or reorder a Reaction window. A hit taken by
   * a duplicate is not a hit on you, so SRD Shield has nothing to answer and
   * `attack-landed` must not be emitted at all.
   */
  it('builds no pending attack, because the blow never landed on the caster', () => {
    const out = hit(mirrored(), OGRE, { ...CLUB, hold: true }, scripted([20, 6]));
    expect(out.events.some((e) => e.type === 'attack-landed')).toBe(false);
    expect(fold('seed', [...mirrored(), ...out.events]).pendingAttack).toBeNull();
  });

  /** A d6 that comes up under 3 deflects nothing, and the blow lands. */
  it('lets the blow through when no duplicate answers', () => {
    const log = mirrored();
    const before = hpOf(fold('seed', log), WIZARD);
    const out = hit(log, OGRE, CLUB, scripted([20, 1, 1, 1, 4]));

    expect(out.deflected).toBeUndefined();
    expect(hpOf(fold('seed', [...log, ...out.events]), WIZARD)).toBeLessThan(before);
  });

  /**
   * "The spell ends when all three duplicates are destroyed." Three deflected
   * hits, and the third takes the casting with it.
   */
  it('spends one duplicate per deflection and ends when the last one goes', () => {
    let log = mirrored();
    const castingId = fold('seed', log).ongoing;
    expect(Object.keys(castingId)).toHaveLength(1);

    for (let blow = 1; blow <= 3; blow += 1) {
      const out = hit(log, OGRE, CLUB, scripted([20, 6]));
      expect(out.deflected, `blow ${blow}`).toBe(true);
      log = [...log, ...out.events];
    }

    expect(Object.keys(fold('seed', log).ongoing)).toHaveLength(0);

    // And with the spell gone the fourth blow is an ordinary one.
    const before = hpOf(fold('seed', log), WIZARD);
    const out = hit(log, OGRE, CLUB, scripted([20, 6]));
    expect(out.deflected).toBeUndefined();
    expect(hpOf(fold('seed', [...log, ...out.events]), WIZARD)).toBeLessThan(before);
  });

  /**
   * "A creature is unaffected by this spell if it has the Blinded condition,
   * Blindsight, or Truesight."
   *
   * Two axes, and neither was expressible before: `unlessPerceivedWith` was
   * built for Blur and names senses, and a condition is not one.
   */
  it('is unaffected by an attacker with Truesight', () => {
    const log = mirrored(SETUP.map((e) => (e.type === 'creature-added' && e.id === OGRE ? SEEING_OGRE('truesight') : e)));
    const before = hpOf(fold('seed', log), WIZARD);
    const out = hit(log, OGRE, CLUB, scripted([20, 6]));

    expect(out.deflected).toBeUndefined();
    expect(hpOf(fold('seed', [...log, ...out.events]), WIZARD)).toBeLessThan(before);
  });

  it('is unaffected by an attacker with the Blinded condition', () => {
    const log = mirrored([
      ...SETUP,
      { type: 'condition-applied', id: OGRE, condition: 'blinded', source: 'the dark' },
    ]);
    const before = hpOf(fold('seed', log), WIZARD);
    const out = hit(log, OGRE, CLUB, scripted([20, 6]));

    expect(out.deflected).toBeUndefined();
    expect(hpOf(fold('seed', [...log, ...out.events]), WIZARD)).toBeLessThan(before);
  });

  /** A miss reaches no duplicate: the sentence counts hits. */
  it('throws no d6 for a swing that missed', () => {
    const out = hit(mirrored(), OGRE, CLUB, scripted([1]));
    expect(out.attack!.hit).toBe(false);
    expect(out.deflected).toBeUndefined();
  });
});

// — Fire Shield ———————————————————————————————————————————————————————————————

describe('the shield erupts on the creature that hit it', () => {
  /**
   * "The attacker takes 2d8 Fire damage from a warm shield." The warm shield
   * is the one that grants Resistance to Cold, so a casting that states Cold
   * burns with Fire — the complement, which is content's to print and the
   * engine's to apply.
   */
  it('burns a melee attacker for the complement of the Resistance it granted', () => {
    const log = shielded();
    const before = hpOf(fold('seed', log), OGRE);
    const out = hit(log, OGRE, CLUB, scripted([20, 4]));

    expect(hpOf(fold('seed', [...log, ...out.events]), OGRE)).toBeLessThan(before);
    // And the flames are Fire, not the Cold the caster asked Resistance to.
    expect(
      out.events.some(
        (e) =>
          e.type === 'roll-recorded' && e.who === OGRE && (e.label ?? '').includes('Fire Shield'),
      ) ||
        out.events.some((e) => e.type === 'damage-taken' && e.id === OGRE && e.by === WIZARD),
    ).toBe(true);
  });

  /** "within 5 feet of you … with a melee attack roll" — an archer is neither. */
  it('does not reach an attacker shooting from sixty feet', () => {
    const log = shielded();
    const before = hpOf(fold('seed', log), ARCHER);
    const out = hit(log, ARCHER, { target: WIZARD, weapon: 'shortbow' }, scripted([20, 4]));

    expect(out.attack!.hit).toBe(true);
    expect(hpOf(fold('seed', [...log, ...out.events]), ARCHER)).toBe(before);
  });

  /** A miss is not a hit, and the sentence says "hits you". */
  it('does not erupt on a miss', () => {
    const log = shielded();
    const before = hpOf(fold('seed', log), OGRE);
    const out = hit(log, OGRE, CLUB, scripted([1]));

    expect(out.attack!.hit).toBe(false);
    expect(hpOf(fold('seed', [...log, ...out.events]), OGRE)).toBe(before);
  });

  /**
   * **A duplicate answers first.** Where both stand, the blow that a
   * duplicate took never reached the caster, so nothing wreathing the caster
   * has been hit and the flames do not erupt.
   */
  it('stays cold when a duplicate took the blow', () => {
    const log = shielded(mirrored());
    const before = hpOf(fold('seed', log), OGRE);
    const out = hit(log, OGRE, CLUB, scripted([20, 6]));

    expect(out.deflected).toBe(true);
    expect(hpOf(fold('seed', [...log, ...out.events]), OGRE)).toBe(before);
  });
});

// — Sanctuary —————————————————————————————————————————————————————————————————

describe('a ward turns an attacker away before the roll', () => {
  const IN_COMBAT = (log: readonly GameEvent[]): readonly GameEvent[] => [
    ...log,
    {
      type: 'combat-started',
      combatants: [
        { id: OGRE, initiative: 20, speed: 30 },
        { id: WIZARD, initiative: 10, speed: 30 },
      ],
    },
  ];

  /**
   * The cleric's save DC is 8 + 3 (Proficiency at level 5) + 2 (Wisdom 14) =
   * 13, and the ogre's Wisdom modifier is +2, so a scripted 1 fails it.
   *
   * **Nothing is spent.** The owner ruled that a failed ward loses the attack
   * and costs nothing, so that both of the book's branches stay reachable:
   * redirecting is a separate command against a creature nobody warded.
   */
  it('loses the attack on a failed save, with no attack roll and nothing spent', () => {
    const log = IN_COMBAT(warded());
    const out = hit(log, OGRE, CLUB, scripted([1]));

    expect(out.warded).toBe(true);
    expect(out.attack).toBeNull();
    expect(out.events.some((e) => e.type === 'attack-made')).toBe(false);
    expect(hpOf(fold('seed', [...log, ...out.events]), WIZARD)).toBe(
      hpOf(fold('seed', log), WIZARD),
    );
    // The Attack action is still there to be spent somewhere else.
    expect(fold('seed', [...log, ...out.events]).combat!.budgets[OGRE]!.attacksRemaining).toBe(
      fold('seed', log).combat!.budgets[OGRE]!.attacksRemaining,
    );
  });

  /** A save that beats the DC lets the swing through exactly as before. */
  it('lets the swing through on a successful save', () => {
    const log = IN_COMBAT(warded());
    const before = hpOf(fold('seed', log), WIZARD);
    const out = hit(log, OGRE, CLUB, scripted([20]));

    expect(out.warded).toBeUndefined();
    expect(out.attack!.hit).toBe(true);
    expect(hpOf(fold('seed', [...log, ...out.events]), WIZARD)).toBeLessThan(before);
  });

  /**
   * **One save per attacker per ward per turn**, which is the owner's ruling
   * of 2026-09-22 and a limit the book does not print. Without it a failed
   * save costs nothing and can simply be re-declared until it passes, which
   * would make the spell useless.
   */
  it('refuses a re-declaration the same turn rather than rolling a fresh save', () => {
    const log = IN_COMBAT(warded());
    const first = hit(log, OGRE, CLUB, scripted([1]));
    expect(first.warded).toBe(true);

    const again = swing([...log, ...first.events], OGRE, CLUB, scripted([20, 4]));
    expect(isErr(again)).toBe(true);
    if (isErr(again)) expect(again.code).toBe('warded');
  });

  /** And an attacker who beat the ward is through for the turn, not asked twice. */
  it('asks an attacker who cleared the ward for no second save that turn', () => {
    const log = IN_COMBAT(warded());
    const first = hit(log, OGRE, CLUB, scripted([20]));
    expect(first.warded).toBeUndefined();

    const ledger =
      fold('seed', [...log, ...first.events]).combat!.budgets[OGRE]!.featureUsedOnTurn;
    expect(Object.keys(ledger).some((key) => key.startsWith(PASSIVE_DEFENSE_LEDGER))).toBe(true);

    // A 1 on the d20 would fail the save outright; the swing goes ahead anyway
    // because the ward was already settled this turn. `free`, because the
    // Attack action went on the first swing and what is under test here is the
    // ward rather than the economy.
    const second = hit([...log, ...first.events], OGRE, { ...CLUB, free: true }, scripted([1]));
    expect(second.warded).toBeUndefined();
    expect(second.attack).not.toBeNull();
  });

  /** The ward is the wizard's; a swing at anybody else is untouched. */
  it('does not reach a swing at a creature nobody warded', () => {
    const log = IN_COMBAT(warded());
    const out = hit(log, OGRE, { target: CLERIC, weapon: 'greatclub' }, scripted([20]));
    expect(out.warded).toBeUndefined();
    expect(out.attack!.hit).toBe(true);
  });
});

// — the other attack path, and the casting's own side of the ward ————————————

describe('a spell attack meets the same defences a club does', () => {
  const IN_COMBAT = (log: readonly GameEvent[]): readonly GameEvent[] => [
    ...log,
    {
      type: 'combat-started',
      combatants: [
        { id: CLERIC, initiative: 20, speed: 30 },
        { id: WIZARD, initiative: 10, speed: 30 },
      ],
    },
  ];

  const bolt = (
    log: readonly GameEvent[],
    caster: CharacterId,
    target: CharacterId,
    rng: Rng,
  ) => resolveSpell(fold('seed', log), caster, { spellId: 'fire-bolt', targets: [target] }, supply(rng));

  /**
   * SRD Mirror Image says "a creature hits you with an attack roll" and names
   * no weapon, so a Fire Bolt meets a duplicate exactly as a greatclub does.
   * The gatherer is shared between the two paths rather than copied, which is
   * the lesson Dodge and Blur taught this file's neighbours.
   */
  it('sends a Fire Bolt to a duplicate', () => {
    const log = mirrored([
      ...SETUP,
      { type: 'sight-declared', from: CLERIC, to: WIZARD, seen: true },
    ]);
    const before = hpOf(fold('seed', log), WIZARD);
    const out = unwrap(bolt(log, CLERIC, WIZARD, scripted([20, 6])), 'bolt');

    expect(out.outcomes[0]?.attack?.hit).toBe(true);
    expect(out.outcomes[0]?.affected).toBe(false);
    expect(hpOf(fold('seed', [...log, ...out.events]), WIZARD)).toBe(before);
    expect(out.events.some((e) => e.type === 'decoy-destroyed')).toBe(true);
  });

  /**
   * **The ward is asked at the declaration, not per roll.** SRD Sanctuary
   * turns a creature away when it *targets* the warded one, and for a casting
   * that moment is before the slot, the action and the first die — so a caster
   * who fails it has spent nothing and may aim elsewhere.
   */
  it('loses a damaging casting to a ward, with the slot unspent', () => {
    const log = IN_COMBAT(warded());
    const slot = fold('seed', log).creatures[CLERIC]!.resources;
    const out = unwrap(bolt(log, CLERIC, WIZARD, scripted([1])), 'bolt');

    expect(out.warded).toBe(true);
    expect(out.castingId).toBeNull();
    expect(out.outcomes).toEqual([]);
    expect(fold('seed', [...log, ...out.events]).creatures[CLERIC]!.resources).toEqual(slot);
    expect(hpOf(fold('seed', [...log, ...out.events]), WIZARD)).toBe(
      hpOf(fold('seed', log), WIZARD),
    );
  });

  /**
   * "any creature who targets the warded creature with an attack roll **or a
   * damaging spell**" — and no other spell. A ward that turned away a Cure
   * Wounds would be the opposite of what it is for.
   */
  it('does not reach a casting that harms nobody', () => {
    const log = IN_COMBAT(warded());
    const out = resolveSpell(
      fold('seed', log),
      CLERIC,
      { spellId: 'bless', targets: [WIZARD], slotLevel: 1 },
      supply(scripted([1])),
    );
    // Whether the cleric has Bless prepared is beside the point: what matters
    // is that no ward save was rolled on the way to finding out.
    if (out.ok) expect(out.value.warded).toBeUndefined();
    else expect(out.code).not.toBe('warded');
  });
});

// — the one thing the ward may not reach ——————————————————————————————————————

describe('a ward is not a shield against an area', () => {
  /**
   * SRD Sanctuary, in so many words: "This spell doesn't protect the warded
   * creature from areas of effect."
   *
   * The sentence is a real fence rather than a free one, because a casting's
   * targets are settled the same way whichever branch filled them: an area
   * spell resolves its own catch into the very list a Fire Bolt names one
   * creature in. A ward read off that list without asking which branch wrote
   * it turns a Fireball away from everybody standing in it.
   */
  const wardedOgre = (log: readonly GameEvent[] = SETUP): readonly GameEvent[] =>
    cast(log, CLERIC, { spellId: 'sanctuary', targets: [OGRE], slotLevel: 1 });

  const WITH_FIREBALL: readonly GameEvent[] = SETUP.map((e) =>
    e.type === 'spellcasting-declared' && e.id === WIZARD
      ? {
          ...e,
          spellcasting: declaredCasting({
            ability: 'int',
            cantrips: ['fire-bolt'],
            prepared: ['mirror-image', 'fire-shield', 'fireball'],
          }),
        }
      : e,
  );

  it('catches a warded creature in a Fireball without asking it to save', () => {
    const log = wardedOgre(WITH_FIREBALL);
    const before = hpOf(fold('seed', log), OGRE);
    const at = fold('seed', log).scene!.positions[OGRE]!;
    const out = unwrap(
      resolveSpell(
        fold('seed', log),
        WIZARD,
        { spellId: 'fireball', targets: [], at, slotLevel: 3 },
        supply(scripted([1])),
      ),
      'fireball',
    );

    expect(out.warded).toBeUndefined();
    expect(out.castingId).not.toBeNull();
    expect(hpOf(fold('seed', [...log, ...out.events]), OGRE)).toBeLessThan(before);
  });

  /** And the ward still answers a damaging spell that names the creature. */
  it('still turns away a spell that names the warded creature', () => {
    const log = [
      ...wardedOgre(WITH_FIREBALL),
      {
        type: 'combat-started',
        combatants: [
          { id: WIZARD, initiative: 20, speed: 30 },
          { id: OGRE, initiative: 10, speed: 30 },
        ],
      } as GameEvent,
    ];
    const out = unwrap(
      resolveSpell(
        fold('seed', log),
        WIZARD,
        { spellId: 'fire-bolt', targets: [OGRE] },
        supply(scripted([1])),
      ),
      'bolt',
    );
    expect(out.warded).toBe(true);
    expect(out.castingId).toBeNull();
  });
});

// — the three claims this design rests on ————————————————————————————————————

describe('a passive defence changes nothing for anybody who has none', () => {
  /**
   * **A door is a creature on the roster**, which is the measurement track 9's
   * `objects.ts` rests on: an object arrives through `creature-added` with a
   * sheet, a hit point maximum and `diesAtZero`, and `resolveAttack` needed no
   * change to break one. So every consult added here runs over a door too, and
   * the question is whether it can *misfire* on one — a door carries no
   * casting, so its `passiveDefenses` is the empty list `creature-added`
   * starts every creature with, and both consults return before they read
   * anything.
   */
  const DOOR = asCharacterId('door');
  const withDoor: readonly GameEvent[] = [
    ...SETUP,
    {
      type: 'creature-added',
      id: DOOR,
      name: 'an oak door',
      sheet: sheet({ baseSpeed: 0 }),
      maxHp: 27,
      diesAtZero: true,
      side: 'the-hall',
    },
    {
      type: 'creature-placed',
      id: DOOR,
      placement: { from: { creature: OGRE }, feet: 5, bearing: 270 },
    },
  ];

  it('breaks a door exactly as it did before any of this existed', () => {
    const before = hpOf(fold('seed', withDoor), DOOR);
    const out = hit(withDoor, OGRE, { target: DOOR, weapon: 'greatclub' }, scripted([20]));

    expect(out.deflected).toBeUndefined();
    expect(out.warded).toBeUndefined();
    expect(hpOf(fold('seed', [...withDoor, ...out.events]), DOOR)).toBeLessThan(before);
    expect(
      out.events.some((e) => e.type === 'passive-defense-granted' || e.type === 'decoy-destroyed'),
    ).toBe(false);
  });

  /**
   * And a door standing next to a Fire Shield is not burned by hitting the
   * wizard's neighbour: the defences are read off the creature the blow was
   * aimed at, never off the room.
   */
  it('leaves a swing at a door alone while a shield burns beside it', () => {
    const log = shielded(withDoor);
    const out = hit(log, OGRE, { target: DOOR, weapon: 'greatclub' }, scripted([20]));
    expect(hpOf(fold('seed', [...log, ...out.events]), OGRE)).toBe(hpOf(fold('seed', log), OGRE));
  });

  /**
   * **No window is opened, closed or reordered.** The owner's ruling of
   * 2026-09-20 — the defender answers first — is pinned by four tests against
   * Uncanny Dodge, and a passive defence must not touch it. What it decides is
   * whether the hit that *would* open a window happened at all.
   *
   * So an ordinary hold is built on an ordinary swing at a creature carrying a
   * passive defence that did not answer, and the swing that a duplicate took
   * builds none — which is the pair of assertions that tells "the window moved"
   * apart from "there was no hit".
   */
  it('still builds the hold on a blow no duplicate answered', () => {
    const log = mirrored();
    const out = hit(log, OGRE, { ...CLUB, hold: true }, scripted([20, 1, 1, 1]));

    expect(out.deflected).toBeUndefined();
    expect(out.events.some((e) => e.type === 'attack-landed')).toBe(true);
    expect(fold('seed', [...log, ...out.events]).pendingAttack).not.toBeNull();
  });

  /** And a creature with no passive defence at all is untouched, hold and all. */
  it('builds the ordinary hold for a creature carrying nothing', () => {
    const out = hit(SETUP, OGRE, { ...CLUB, hold: true }, scripted([20]));
    expect(out.events.some((e) => e.type === 'attack-landed')).toBe(true);
    expect(fold('seed', [...SETUP, ...out.events]).pendingAttack).not.toBeNull();
  });
});

// — every die the command threw is counted ————————————————————————————————————

describe('a ward throws a d20, and the log says so', () => {
  const IN_COMBAT = (log: readonly GameEvent[]): readonly GameEvent[] => [
    ...log,
    {
      type: 'combat-started',
      combatants: [
        { id: OGRE, initiative: 20, speed: 30 },
        { id: WIZARD, initiative: 10, speed: 30 },
      ],
    },
  ];

  /**
   * **`rollsIssued` is the determinism contract, not an audit nicety.**
   * `rolls-issued` carries a delta, `fold/rolls.ts` accumulates it, and the
   * layer above builds the next command's issuer from the total — so a die
   * thrown and left out of the count is a `RollId` re-issued over one already
   * in the log.
   *
   * A ward's save is thrown before the attack roll and before anything is
   * spent, which makes it the easiest die in the engine to forget: it is on
   * the other side of every mark a reader would naturally put beside "the
   * roll". Both branches are asserted, because they are two returns.
   */
  const issued = (log: readonly GameEvent[], events: readonly GameEvent[]): number =>
    fold('seed', [...log, ...events]).rollsIssued - fold('seed', log).rollsIssued;

  /** A save that failed: one die, and the swing never happened. */
  it('counts the die a barred ward threw', () => {
    const log = IN_COMBAT(warded());
    const rng = scripted([1]);
    const issuer = createRollIssuer('r');
    const out = unwrap(
      resolveAttack(fold('seed', log), OGRE, CLUB, { issuer, rng, content: SRD_CONTENT }),
      'attack',
    );

    expect(out.warded).toBe(true);
    expect(issued(log, out.events)).toBe(issuer.count);
  });

  /** And a save that passed: its die plus every die the swing went on to throw. */
  it('counts the die a cleared ward threw beside the swing that followed', () => {
    const log = IN_COMBAT(warded());
    const rng = scripted([20]);
    const issuer = createRollIssuer('r');
    const out = unwrap(
      resolveAttack(fold('seed', log), OGRE, CLUB, { issuer, rng, content: SRD_CONTENT }),
      'attack',
    );

    expect(out.warded).toBeUndefined();
    expect(out.attack!.hit).toBe(true);
    expect(issuer.count).toBeGreaterThan(1);
    expect(issued(log, out.events)).toBe(issuer.count);
  });

  /** The casting's side of the same rule, on both of its returns. */
  it('counts the dice a ward threw in front of a casting', () => {
    const log = IN_COMBAT(warded());
    for (const [face, warded_] of [
      [1, true],
      [20, false],
    ] as const) {
      const issuer = createRollIssuer('r');
      const out = unwrap(
        resolveSpell(
          fold('seed', log),
          OGRE,
          { spellId: 'fire-bolt', targets: [WIZARD] },
          { issuer, rng: scripted([face]), content: SRD_CONTENT },
        ),
        'bolt',
      );
      expect(out.warded ?? false, `d20 ${face}`).toBe(warded_);
      expect(issued(log, out.events), `d20 ${face}`).toBe(issuer.count);
    }
  });
});
