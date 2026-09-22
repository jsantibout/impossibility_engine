import { SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import { asCharacterId, isErr, type CharacterId, expect as unwrap, type Result } from '@ie/shared';
import {
  addCreature,
  beginCombat,
  declareCreatureSide,
  placeCreatureInScene,
  resolveAttack,
  resolveAttackDamage,
  resolveSpell,
  setScene,
  addSceneLandmark,
} from './commands.js';
import { createRng, type Rng } from './dice.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { createRollIssuer } from './rolls.js';
import { createCharacter, type CharacterChoices } from './creation.js';
import type { SpellbookEntry } from './spellbook.js';

/**
 * **A monster's swing can be held, so the spells that answer one are reachable.**
 *
 * SRD Shield is "Reaction, which you take when you are hit by an attack roll",
 * and `triggerRefusal` reads that clause off exactly one fact: `pendingAttack`,
 * a hit that is known and not yet settled. A hit only becomes one when the
 * *attacker* asks for the hold — which is the right rule for SRD Divine Smite,
 * whose window is the attacker's own — and a stat block's line refused the hold
 * outright (`cannot_hold`). So a Wizard standing in front of a Wolf could never
 * cast Shield: the only attacks the engine would hold were the ones a character
 * swung with a catalogue weapon, and a party fights monsters.
 *
 * The owner ruled on 2026-09-21 that **a monster's attack is holdable**, and
 * what the refusal was really about is one missing fact rather than a rule:
 * `attack-landed` pinned a weapon's catalogue id and had nowhere to say *which
 * printed line* was swung, so the damage could not be rolled a command later.
 * `PendingAttack.action` is that fact, and it is pinned exactly as `weapon` is
 * — the line's identity, re-read off the creature's own sheet at settlement in
 * the same breath as `sheetAsItStands`.
 *
 * Three claims are worth more than the rest and are tested here:
 *
 * 1. **The damage a held line deals is the damage the block prints**, and the
 *    same damage the unheld swing dealt from the same seed. A hold that rolled
 *    an Unarmed Strike would be the engine rewriting the stat block.
 * 2. **A window that opens can always be closed.** `docs/design/claude-integration.md`
 *    is plain about it, and a monster's held Bite that could not be settled
 *    would wedge the fight it was opened in.
 * 3. **A printed rider rides the swing through the hold.** The Wolf's Prone is
 *    pinned at the hit and applied at settlement, after the damage — which is
 *    where the defender-answers-first ruling already put it — and its size gate
 *    still bites on the far side of the hold.
 */

const id = (s: string) => asCharacterId(s);
const ANDER = id('ander');
const WOLF = id('wolf');
const OGRE = id('ogre');

const supply = (seed = 'fangs') => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

/** The six spells a level 1 Wizard's book holds. */
const BOOK: readonly SpellbookEntry[] = [
  'magic-missile',
  'shield',
  'detect-magic',
  'feather-fall',
  'mage-armor',
  'sleep',
].map((spellId) => ({ spellId, acquiredAt: 1, origin: 'level' as const }));

/** A level 1 Wizard with Shield prepared, Medium, for the wolf to bite. */
const walkOn = (): CharacterChoices => ({
  name: 'Ander',
  classId: 'wizard',
  level: 1,
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 },
  },
  abilityIncreases: { int: 2, con: 1 },
  classSkills: ['investigation', 'insight'],
  languages: ['Draconic', 'Elvish'],
  alignment: 'Neutral',
  cantrips: ['fire-bolt', 'light', 'prestidigitation'],
  spellbook: [...BOOK],
  preparedSpells: ['magic-missile', 'shield', 'mage-armor', 'sleep'],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: { 'human:skillful': ['perception'] },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int',
      cantrips: ['mage-hand', 'ray-of-frost'],
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId: 'alert' },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
});

/** A log built only out of what the engine produced. */
class Table {
  readonly log: GameEvent[] = [];

  get state(): GameState {
    return fold('fangs', this.log);
  }

  do(step: string, produce: (state: GameState) => Result<readonly GameEvent[]>): GameState {
    this.log.push(...unwrap(produce(this.state), step));
    return this.state;
  }

  did(
    step: string,
    produce: (state: GameState) => Result<{ readonly events: readonly GameEvent[] }>,
  ): GameState {
    this.log.push(...unwrap(produce(this.state), step).events);
    return this.state;
  }
}

/**
 * A wizard with a monster beside him, everybody placed and the order rolled.
 *
 * The monster goes first, because the window a Reaction answers is only open
 * on somebody else's turn.
 */
const inTheWoods = (monster: string, who: CharacterId): Table => {
  const table = new Table();
  table.do('the wizard arrives', () => createCharacter(SRD_CONTENT, walkOn(), ANDER));
  table.did('the monster arrives', (s) => addCreature(s, SRD_CONTENT, who, monster));
  table.do('the clearing', (s) => setScene(s, { width: 60, depth: 40, height: 20 }));
  table.do('the stump', (s) => addSceneLandmark(s, 'the stump', { x: 20, y: 20, z: 0 }));
  table.do('Ander by the stump', (s) =>
    placeCreatureInScene(s, ANDER, { from: { landmark: 'the stump' }, feet: 0 }),
  );
  table.do('the monster beside him', (s) =>
    placeCreatureInScene(s, who, { from: { creature: ANDER }, feet: 5, bearing: 90 }),
  );
  table.do('Ander’s side', (s) => declareCreatureSide(s, ANDER, 'party'));
  table.do('the monster’s side', (s) => declareCreatureSide(s, who, 'wild'));
  table.do('the order', (s) =>
    beginCombat(s, [
      { id: who, initiative: 20, speed: 40 },
      { id: ANDER, initiative: 1, speed: 30 },
    ]),
  );
  return table;
};

/**
 * Bite, with the attack roll forced to land.
 *
 * A miss answers nothing here: the window under test opens on a hit, and a die
 * deciding which branch ran would only obscure it.
 */
const bite = (
  table: Table,
  who: CharacterId,
  action: string,
  over: { readonly target?: CharacterId; readonly hold?: boolean; readonly seed?: string } = {},
) => {
  const out = unwrap(
    resolveAttack(
      table.state,
      who,
      {
        target: over.target ?? ANDER,
        weapon: null,
        action,
        ...(over.hold === undefined ? {} : { hold: over.hold }),
        attackBonuses: [{ source: 'forced', flat: 40 }],
      },
      supply(over.seed ?? 'fangs'),
    ),
    'the bite',
  );
  const log = [...table.log, ...out.events];
  return { ...out, log, state: fold('fangs', log) };
};

const conditionsOn = (state: GameState, who: CharacterId): readonly string[] =>
  state.creatures[who]?.conditions.conditions ?? [];

const hpOf = (state: GameState, who: CharacterId): number =>
  state.creatures[who]?.vitals.hp ?? 0;

// — the hold a stat block's line may now take ————————————————————————————————

describe('a stat block’s attack takes the hold', () => {
  /**
   * The refusal this replaces read "its damage cannot be held for a second
   * command", and it was true of the record rather than of the rules: nothing
   * in the SRD says a monster's blow is settled in one breath where a
   * character's is not.
   */
  it('holds the Wolf’s Bite between its two rolls', () => {
    const out = bite(inTheWoods('wolf', WOLF), WOLF, 'Bite', { hold: true });

    expect(out.attack?.hit).toBe(true);
    expect(out.state.pendingAttack).not.toBeNull();
    expect(out.state.pendingAttack?.attacker).toBe(WOLF);
    expect(out.state.pendingAttack?.target).toBe(ANDER);
  });

  /**
   * **The line's identity, pinned exactly as a weapon's id is.** A hold that
   * remembered only "no weapon" would settle a Bite as an Unarmed Strike, which
   * is why the refusal stood as long as it did.
   */
  it('pins which printed line was swung, and no weapon beside it', () => {
    const out = bite(inTheWoods('wolf', WOLF), WOLF, 'Bite', { hold: true });

    expect(out.state.pendingAttack?.action).toBe('Bite');
    expect(out.state.pendingAttack?.weapon).toBeNull();
  });

  /**
   * **The damage the block prints, not the engine's fallback.** SRD Wolf,
   * Bite: "_Hit:_ 5 (1d6 + 2) Piercing damage." An Unarmed Strike from a
   * creature with Strength 12 would be 1 Bludgeoning, so the two are never
   * confusable — and the held swing must deal exactly what the unheld one
   * dealt from the same seed, because a hold is a pause and not a different
   * attack.
   */
  it('settles for the damage the block prints, and the unheld swing’s own', () => {
    const straight = bite(inTheWoods('wolf', WOLF), WOLF, 'Bite');

    // The same generator across both halves, because that is what a hold *is*:
    // a pause between two rolls of one swing, not a second swing. A fresh seed
    // for the settlement would throw a different d6 and prove nothing about
    // which line's damage was rolled.
    const table = inTheWoods('wolf', WOLF);
    const paused = supply('fangs');
    const out = unwrap(
      resolveAttack(
        table.state,
        WOLF,
        {
          target: ANDER,
          weapon: null,
          action: 'Bite',
          hold: true,
          attackBonuses: [{ source: 'forced', flat: 40 }],
        },
        paused,
      ),
      'the held bite',
    );
    const held = fold('fangs', [...table.log, ...out.events]);
    const settled = unwrap(resolveAttackDamage(held, WOLF, {}, paused), 'the settlement');

    expect(out.damage).toBeUndefined();
    expect(settled.damage).toBe(straight.damage);
    expect(hpOf(fold('fangs', [...table.log, ...out.events, ...settled.events]), ANDER)).toBe(
      hpOf(straight.state, ANDER),
    );
  });

  /**
   * And the blow is the Bite's, in the record as well as in the arithmetic.
   * SRD Wolf: "_Hit:_ 5 (1d6 + 2) Piercing damage" — an Unarmed Strike from a
   * creature of Strength 12 is 1 Bludgeoning, so a settlement that lost the
   * line would be visible in both the amount and the name.
   */
  it('files the blow under the line’s own heading, in the line’s own dice', () => {
    const held = bite(inTheWoods('wolf', WOLF), WOLF, 'Bite', { hold: true });
    const settled = unwrap(
      resolveAttackDamage(held.state, WOLF, {}, supply('settle')),
      'the settlement',
    );

    const taken = settled.events.find((e) => e.type === 'damage-taken');
    expect(taken?.type === 'damage-taken' ? taken.source : null).toBe('Bite');

    // "5 (1d6 + 2) Piercing damage": one d6, a flat 2, and a type an Unarmed
    // Strike never deals. The dice are what discriminate — a fallback strike
    // is a flat Strength modifier with no die at all.
    const dice = settled.events.find((e) => e.type === 'damage-dice-recorded');
    expect(dice?.type === 'damage-dice-recorded' ? dice.components : []).toMatchObject([
      { source: 'Bite', type: 'piercing', flat: 2 },
    ]);
    const faces =
      dice?.type === 'damage-dice-recorded' ? (dice.components[0]?.dice ?? []) : [];
    expect(faces).toHaveLength(1);
    expect(faces[0]?.value).toBeGreaterThanOrEqual(1);
    expect(faces[0]?.value).toBeLessThanOrEqual(6);
  });

  /**
   * **Every window that holds something has a door that closes it**, and a
   * monster's held Bite with no settlement would wedge the fight it was opened
   * in — the failure `docs/design/claude-integration.md` names.
   */
  it('can always be settled, and the hold is gone when it is', () => {
    const held = bite(inTheWoods('wolf', WOLF), WOLF, 'Bite', { hold: true });
    const settled = resolveAttackDamage(held.state, WOLF, {}, supply('settle'));

    expect(isErr(settled)).toBe(false);
    expect(fold('fangs', [...held.log, ...unwrap(settled, 'settled').events]).pendingAttack).toBeNull();
  });

  /**
   * SRD Ogre: "_Melee or Ranged Attack Roll:_ +6, reach 5 ft. or range 30/120
   * ft. _Hit:_ 11 (2d6 + 4) Piercing damage." One line and two halves, and
   * which half this swing was is the attacker's choice — a fact `thrown`
   * already pinned and which the settlement now has a line to read it against.
   * A hold that lost either would roll the wrong dice or call a javelin in
   * flight a melee blow.
   */
  it('keeps a thrown half of a line that prints both', () => {
    const table = inTheWoods('ogre', OGRE);
    const out = unwrap(
      resolveAttack(
        table.state,
        OGRE,
        {
          target: ANDER,
          weapon: null,
          action: 'Javelin',
          thrown: true,
          hold: true,
          attackBonuses: [{ source: 'forced', flat: 40 }],
        },
        supply('moor'),
      ),
      'the javelin',
    );
    const held = fold('fangs', [...table.log, ...out.events]);
    expect(held.pendingAttack?.action).toBe('Javelin');
    expect(held.pendingAttack?.thrown).toBe(true);

    const settled = unwrap(resolveAttackDamage(held, OGRE, {}, supply('moor')), 'the settlement');
    const dice = settled.events.find((e) => e.type === 'damage-dice-recorded');
    expect(dice?.type === 'damage-dice-recorded' ? dice.components : []).toMatchObject([
      { source: 'Javelin', type: 'piercing', flat: 4 },
    ]);
    expect(
      dice?.type === 'damage-dice-recorded' ? (dice.components[0]?.dice.length ?? 0) : 0,
    ).toBe(2);
  });

  /** A line the block does not print is still refused, and before the hold. */
  it('still refuses a line the block does not print', () => {
    const refused = resolveAttack(
      inTheWoods('wolf', WOLF).state,
      WOLF,
      { target: ANDER, weapon: null, action: 'Tail Swipe', hold: true },
      supply(),
    );

    expect(isErr(refused) ? refused.code : 'ok').toBe('unknown_action');
  });
});

// — the spell the window exists for ——————————————————————————————————————————

describe('Shield answers a monster’s swing', () => {
  const castShield = (state: GameState) =>
    resolveSpell(state, ANDER, { spellId: 'shield', targets: [ANDER], slotLevel: 1 }, supply('ward'));

  /**
   * The whole point of the ruling: SRD Shield's trigger is a hit that is still
   * undecided, and until a monster's swing could be held there was never one
   * for a party to answer.
   */
  it('is legal into a Bite that is still undecided', () => {
    const held = bite(inTheWoods('wolf', WOLF), WOLF, 'Bite', { hold: true });

    expect(castShield(held.state).ok).toBe(true);
  });

  it('is still refused when no Bite is waiting', () => {
    const table = inTheWoods('wolf', WOLF);

    const refused = castShield(table.state);
    expect(isErr(refused) ? refused.code : 'ok').toBe('no_trigger');
  });

  /**
   * "Including against the triggering attack" — so a Bite that beat the Armour
   * Class by less than 5 becomes a miss, the hold closes, and the Wolf deals
   * nothing.
   *
   * The Wolf's +4 cannot be trusted to land in the narrow band the rule reads,
   * so the hit is put in the log with its numbers stated, exactly as
   * `reaction-triggers.test.ts` does for the thug: whether +5 is enough is the
   * arithmetic under test and a d20 in the middle of it would obscure which
   * branch ran.
   */
  it('turns a Bite aside and closes the hold without damage', () => {
    const table = inTheWoods('wolf', WOLF);
    const before = hpOf(table.state, ANDER);
    table.log.push({
      type: 'attack-landed',
      attack: {
        attacker: WOLF,
        target: ANDER,
        weapon: null,
        action: 'Bite',
        twoHanded: false,
        thrown: false,
        critical: false,
        ability: 'str',
        targetAc: 10,
        total: 12,
        natural: 11,
      },
    });

    const warded = unwrap(castShield(table.state), 'shield');
    const after = fold('fangs', [...table.log, ...warded.events]);

    expect(after.pendingAttack).toBeNull();
    expect(hpOf(after, ANDER)).toBe(before);
  });

  /**
   * And a Bite that still clears the raised number is still owed: the hold
   * stands, and the Wolf settles it for the damage its own block prints.
   */
  it('leaves a Bite that beats the raised number still to be settled', () => {
    const table = inTheWoods('wolf', WOLF);
    table.log.push({
      type: 'attack-landed',
      attack: {
        attacker: WOLF,
        target: ANDER,
        weapon: null,
        action: 'Bite',
        twoHanded: false,
        thrown: false,
        critical: false,
        ability: 'str',
        targetAc: 10,
        total: 18,
        natural: 17,
      },
    });

    const warded = unwrap(castShield(table.state), 'shield');
    const standing = fold('fangs', [...table.log, ...warded.events]);
    expect(standing.pendingAttack).not.toBeNull();

    const settled = unwrap(
      resolveAttackDamage(standing, WOLF, {}, supply('settle')),
      'the settlement',
    );
    const after = fold('fangs', [...table.log, ...warded.events, ...settled.events]);

    expect(after.pendingAttack).toBeNull();
    expect(hpOf(after, ANDER)).toBeLessThan(hpOf(table.state, ANDER));
  });
});

// — the printed rider, through the hold ——————————————————————————————————————

describe('a printed rider rides the swing through the hold', () => {
  /**
   * SRD Wolf, Bite: "If the target is a Medium or smaller creature, it has the
   * Prone condition." The rider is pinned onto the hold at the hit and applied
   * at settlement — the ordering the owner fixed on 2026-09-20, and the
   * interaction a newly holdable monster swing is most likely to break.
   */
  it('knocks nobody down while the swing is held', () => {
    const held = bite(inTheWoods('wolf', WOLF), WOLF, 'Bite', { hold: true });

    expect(held.state.pendingAttack?.rider).toBeDefined();
    expect(conditionsOn(held.state, ANDER)).not.toContain('prone');
  });

  it('lands it when the settlement closes the hold', () => {
    const held = bite(inTheWoods('wolf', WOLF), WOLF, 'Bite', { hold: true });
    const settled = unwrap(
      resolveAttackDamage(held.state, WOLF, {}, supply('settle')),
      'the settlement',
    );
    const after = fold('fangs', [...held.log, ...settled.events]);

    expect(after.pendingAttack).toBeNull();
    expect(conditionsOn(after, ANDER)).toContain('prone');
  });

  /**
   * And Shield takes the rider with the blow: "when you hit a creature" is what
   * buys one, and a deflected swing never hit. Nothing is refunded because a
   * held swing spends nothing until it settles.
   */
  it('drops it with the hold Shield closed', () => {
    const table = inTheWoods('wolf', WOLF);

    // The Wolf's own hold, with the arithmetic moved to where the rule reads
    // it: whether +5 is enough is what this test is about, and a forced +40
    // sails past any Armour Class. The rider is the one the swing really
    // pinned, not one typed out here.
    const swung = bite(table, WOLF, 'Bite', { hold: true });
    const real = swung.state.pendingAttack;
    expect(real?.rider).toBeDefined();
    const log: readonly GameEvent[] = [
      ...table.log,
      { type: 'attack-landed', attack: { ...real!, targetAc: 10, total: 12, natural: 11 } },
    ];

    const warded = unwrap(
      resolveSpell(
        fold('fangs', log),
        ANDER,
        { spellId: 'shield', targets: [ANDER], slotLevel: 1 },
        supply('ward'),
      ),
      'shield',
    );
    const after = fold('fangs', [...log, ...warded.events]);

    expect(after.pendingAttack).toBeNull();
    expect(conditionsOn(after, ANDER)).not.toContain('prone');
  });

  /**
   * The size gate is the book's and it is evaluated on the far side of the
   * hold too: an Ogre is Large, and a Wolf's sentence stops at Medium. The
   * Bite still lands and still deals its damage, and the clause that did not
   * fire says so.
   */
  it('leaves a creature the sentence does not reach standing', () => {
    const table = inTheWoods('wolf', WOLF);
    table.did('an ogre wanders in', (s) => addCreature(s, SRD_CONTENT, OGRE, 'ogre'));
    table.do('the ogre beside the wolf', (s) =>
      placeCreatureInScene(s, OGRE, { from: { creature: WOLF }, feet: 5, bearing: 0 }),
    );

    const held = bite(table, WOLF, 'Bite', { target: OGRE, hold: true });
    expect(held.unverified.join(' ')).toContain('large');

    const settled = unwrap(
      resolveAttackDamage(held.state, WOLF, {}, supply('settle')),
      'the settlement',
    );
    const after = fold('fangs', [...held.log, ...settled.events]);

    expect(conditionsOn(after, OGRE)).not.toContain('prone');
    expect(hpOf(after, OGRE)).toBeLessThan(hpOf(table.state, OGRE));
  });
});
