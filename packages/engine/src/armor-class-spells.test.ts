import { describe, expect, it } from 'vitest';
import { asCharacterId, isErr, expect as unwrap, type CharacterId } from '@ie/shared';
import { itemFor } from './catalogue.js';
import type { CharacterSheet } from './character.js';
import { armorClass } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { spellSlotKey } from './resources.js';
import { declaredCasting } from './spellcasting.js';
import { resolveSpell } from './commands.js';
import { armorClassOf } from './standing.js';
import { definitionFor } from './spell-definitions.js';

/**
 * An Armour Class a spell **sets**, rather than one it adds to.
 *
 * SRD Mage Armor: "the target's base AC becomes 13 plus its Dexterity
 * modifier." The tempting implementation is a flat `+3` on `ac`, and for the
 * ordinary case it gives exactly the same number — which is what makes it
 * dangerous rather than merely wrong. Two cases separate them and both are
 * silent:
 *
 * - a Barbarian's Unarmoured Defense already replaces the calculation, and SRD
 *   Multiclassing says "If you have multiple ways to calculate your Armor
 *   Class, you can benefit from only **one** at a time";
 * - Mage Armor's own sentence targets a creature "who isn't wearing armor".
 *
 * So it joins the comparison `armorClassCalculation` already runs for class
 * features rather than being applied after it. Two mechanics, one primitive —
 * which is the evidence the generalization rule asks for, and the reason this
 * is not `buff`.
 *
 * Tier 2 of the LLM boundary experiment hit this live: a level 2 Wizard
 * reached for Mage Armor and got `no_definition`.
 */

const id = (s: string) => asCharacterId(s);
const WIZARD = id('wizard');
const FIGHTER = id('fighter');
const BARBARIAN = id('barbarian');

const leather = () => itemFor('leather-armor')?.armor ?? null;
const shield = () => itemFor('shield')?.armor ?? null;

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 14, con: 16, int: 18, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
  ...over,
});

const added = (who: CharacterId, over: Partial<CharacterSheet> = {}): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(over),
  maxHp: 40,
  diesAtZero: false,
  creatureType: 'Humanoid',
});

const BARBARIAN_DEFENSE = {
  source: 'barbarian:unarmored-defense',
  ability: 'con' as const,
  shieldAllowed: true,
};

const SETUP: readonly GameEvent[] = [
  added(WIZARD),
  added(FIGHTER),
  added(BARBARIAN, { unarmoredDefense: [BARBARIAN_DEFENSE] }),
  ...[1, 2, 3].map(
    (level): GameEvent => ({
      type: 'resource-pool-declared',
      id: WIZARD,
      pool: {
        key: spellSlotKey(level),
        label: `level ${level} spell slot`,
        max: 4,
        recovers: 'long-rest',
      },
    }),
  ),
  { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
  { type: 'landmark-added', name: 'the camp', at: { x: 50, y: 50, z: 0 } },
  { type: 'creature-placed', id: WIZARD, placement: { from: { landmark: 'the camp' }, feet: 0 } },
  { type: 'creature-placed', id: FIGHTER, placement: { from: { creature: WIZARD }, feet: 5, bearing: 0 } },
  { type: 'creature-placed', id: BARBARIAN, placement: { from: { creature: WIZARD }, feet: 5, bearing: 90 } },
  { type: 'sight-declared', from: WIZARD, to: FIGHTER, seen: true },
  { type: 'sight-declared', from: WIZARD, to: BARBARIAN, seen: true },
  {
    type: 'spellcasting-declared',
    id: WIZARD,
    spellcasting: declaredCasting({
      ability: 'int',
      classId: 'wizard',
      cantrips: ['fire-bolt'],
      prepared: ['mage-armor', 'dispel-magic', 'shield-of-faith'],
    }),
  },
];

const base = (): GameState => fold('seed', SETUP);

const supply = (seed = 'cast') => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
});

const castOn = (state: GameState, target: CharacterId) =>
  resolveSpell(state, WIZARD, { spellId: 'mage-armor', targets: [target], slotLevel: 1 }, supply());

describe('Mage Armor replaces the calculation rather than adding to it', () => {
  /** Dexterity +2, so 10 + 2 becomes 13 + 2. */
  it('makes the base 13 plus Dexterity', () => {
    const before = base();
    expect(armorClassOf(before, FIGHTER)).toBe(12);

    const out = unwrap(castOn(before, FIGHTER), 'mage armor');
    const after = fold('seed', [...SETUP, ...out.events]);

    expect(armorClassOf(after, FIGHTER)).toBe(15);
    expect(out.outcomes[0]?.armorClass).toBe(15);
    expect(out.outcomes[0]?.affected).toBe(true);
  });

  /**
   * The case a flat `+3` gets wrong. SRD Multiclassing: one calculation at a
   * time. The Barbarian's Constitution +3 gives 10 + 2 + 3 = 15, which beats
   * 13 + 2, so their own feature wins and Mage Armor adds nothing.
   */
  it('does not stack with a feature that already replaces the calculation', () => {
    const before = base();
    expect(armorClassOf(before, BARBARIAN)).toBe(15);

    const out = unwrap(castOn(before, BARBARIAN), 'mage armor');
    const after = fold('seed', [...SETUP, ...out.events]);

    expect(armorClassOf(after, BARBARIAN)).toBe(15);
    expect(out.outcomes[0]?.armorClass).toBe(15);
  });

  /** And the better of the two wins, whichever it is. */
  it('wins when it beats the feature', () => {
    const frail = fold('seed', [
      ...SETUP.filter((e) => !(e.type === 'creature-added' && e.id === BARBARIAN)),
      added(BARBARIAN, {
        abilities: { str: 10, dex: 14, con: 8, int: 10, wis: 10, cha: 10 },
        unarmoredDefense: [BARBARIAN_DEFENSE],
      }),
    ]);
    // Constitution -1, so the feature gives 10 + 2 - 1 = 11 and loses to the
    // ordinary 10 + Dexterity, which is why the baseline is 12.
    expect(armorClassOf(frail, BARBARIAN)).toBe(12);

    const out = unwrap(castOn(frail, BARBARIAN), 'mage armor');
    expect(out.outcomes[0]?.armorClass).toBe(15);
  });

  /**
   * SRD: "You touch a willing creature **who isn't wearing armor**." A refusal,
   * not a silent no-op — nothing is spent, so the wizard still has the slot.
   */
  it('refuses a target already wearing armour, and spends nothing', () => {
    const armoured = fold('seed', [
      ...SETUP.filter((e) => !(e.type === 'creature-added' && e.id === FIGHTER)),
      added(FIGHTER, { armor: leather() }),
    ]);

    const out = castOn(armoured, FIGHTER);
    expect(isErr(out)).toBe(true);
    if (!isErr(out)) return;
    expect(out.code).toBe('target_wearing_armor');
    expect(out.kind).toBe('refusal');
  });

  /**
   * A Shield is not body armour. The sheet has held the two apart since
   * equipment landed, and the spell's clause is about the body slot — so the
   * Shield's +2 still lands on top of the new base.
   */
  it('leaves a Shield adding on top', () => {
    const shielded = fold('seed', [
      ...SETUP.filter((e) => !(e.type === 'creature-added' && e.id === FIGHTER)),
      added(FIGHTER, { shield: shield() }),
    ]);
    expect(armorClassOf(shielded, FIGHTER)).toBe(14);

    const out = unwrap(castOn(shielded, FIGHTER), 'mage armor');
    expect(out.outcomes[0]?.armorClass).toBe(17);
  });

  /**
   * And the calculation is consulted only where the SRD consults it: a
   * creature wearing armour is back to their armour's number, because the
   * granted base loses the comparison.
   *
   * **That inertness is no longer the whole answer**, and it never was the
   * spell's own sentence. IE-032 built "The spell ends early if the target
   * dons armor", so the casting goes too — which
   * `casting-end-triggers.test.ts` drives through `equipItem`. What is
   * asserted here is the arithmetic that has always been right, and that the
   * definition now carries the trigger rather than a note saying it does not.
   */
  it('is inert once armour is worn, and the casting ends when it is donned', () => {
    const out = unwrap(castOn(base(), FIGHTER), 'mage armor');
    const after = fold('seed', [...SETUP, ...out.events]);
    expect(armorClassOf(after, FIGHTER)).toBe(15);

    const granted = after.creatures.fighter!.armorClasses;
    expect(granted).toHaveLength(1);
    expect(armorClass(sheet({ armor: leather() }), granted)).toBe(
      armorClass(sheet({ armor: leather() })),
    );

    expect(definitionFor('mage-armor')?.endsEarly).toEqual([
      { on: 'target-dons-armor', ends: 'casting' },
    ]);
    expect(out.unverified.join(' ')).not.toContain('dons armor');
  });
});

describe('the grant ends with the casting, through the door that already existed', () => {
  it('goes when the spell is dispelled', () => {
    const cast = unwrap(castOn(base(), FIGHTER), 'mage armor');
    const log = [...SETUP, ...cast.events];
    const held = fold('seed', log);
    expect(armorClassOf(held, FIGHTER)).toBe(15);

    const dispelled = unwrap(
      resolveSpell(
        held,
        WIZARD,
        { spellId: 'dispel-magic', targets: [FIGHTER], slotLevel: 3 },
        supply('dispel'),
      ),
      'dispel',
    );
    const after = fold('seed', [...log, ...dispelled.events]);

    expect(armorClassOf(after, FIGHTER)).toBe(12);
    expect(after.creatures.fighter!.armorClasses).toEqual([]);
    // And nothing of the casting is left anywhere in the serialised state,
    // beyond the one deliberate mention: `castingsEnded`, which is how the
    // fold refuses a later `spell-ongoing` naming a casting that is over.
    expect(JSON.stringify({ ...after, castingsEnded: [] })).not.toContain(cast.castingId);
  });

  /** SRD Mage Armor: "8 hours". The clock ends it without anybody deciding. */
  it('goes when the eight hours run out', () => {
    expect(definitionFor('mage-armor')?.durationSeconds).toBe(28_800);

    const cast = unwrap(castOn(base(), FIGHTER), 'mage armor');
    const log: readonly GameEvent[] = [
      ...SETUP,
      ...cast.events,
      { type: 'time-advanced', seconds: 28_800, reason: 'the night passes' },
    ];
    const after = fold('seed', log);
    expect(after.creatures.fighter!.armorClasses).toEqual([]);
    expect(armorClassOf(after, FIGHTER)).toBe(12);
  });

  /** Nine minutes in, it is still up: the timer is a deadline, not a flag. */
  it('is still up before then', () => {
    const cast = unwrap(castOn(base(), FIGHTER), 'mage armor');
    const after = fold('seed', [
      ...SETUP,
      ...cast.events,
      { type: 'time-advanced', seconds: 540, reason: 'nine minutes of walking' },
    ]);
    expect(armorClassOf(after, FIGHTER)).toBe(15);
  });
});

describe('the spell replays like every other', () => {
  it('folds the same way prefix by prefix', () => {
    const out = unwrap(castOn(base(), FIGHTER), 'mage armor');
    const log = [...SETUP, ...out.events];
    for (let n = 0; n <= log.length; n += 1) {
      expect(fold('seed', log.slice(0, n))).toEqual(fold('seed', log.slice(0, n)));
    }
  });

  it('is a no-op on a retried command id', () => {
    const first = unwrap(
      resolveSpell(
        base(),
        WIZARD,
        { spellId: 'mage-armor', targets: [FIGHTER], slotLevel: 1, commandId: 'c1' },
        supply(),
      ),
      'first',
    );
    const log = [...SETUP, ...first.events];
    const again = unwrap(
      resolveSpell(
        fold('seed', log),
        WIZARD,
        { spellId: 'mage-armor', targets: [FIGHTER], slotLevel: 1, commandId: 'c1' },
        supply(),
      ),
      'retry',
    );
    expect(again.events).toEqual([]);
  });

  /** A second casting from the same caster is a second grant, not a stack. */
  it('replaces its own earlier grant rather than stacking', () => {
    const first = unwrap(castOn(base(), FIGHTER), 'first');
    const log = [...SETUP, ...first.events];
    const second = unwrap(castOn(fold('seed', log), FIGHTER), 'second');
    const after = fold('seed', [...log, ...second.events]);

    // Two castings, two records — the SRD does not say a second Mage Armor
    // replaces the first — but the number is the best of them, not the sum.
    expect(armorClassOf(after, FIGHTER)).toBe(15);
  });
});
