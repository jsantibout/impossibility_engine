import { SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import { asCharacterId, isErr, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng } from './dice.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { remaining, spellSlotKey } from './resources.js';
import { createRollIssuer } from './rolls.js';
import { declaredCasting } from './spellcasting.js';
import {
  ongoingSpellsOn,
  pendingCastingsOf,
  reactionOpportunities,
  resolveAttack,
  resolveDeclaredCast,
  resolveSpell,
  resolveTurn,
} from './commands.js';
import { armorClassOf } from './standing.js';

/**
 * SRD Shield's **second** trigger, and the benefit that hangs on it.
 *
 * > **Casting Time:** Reaction, which you take when you are hit by an attack
 * > roll **or targeted by the _Magic Missile_ spell**.
 * > "…you have a +5 bonus to AC, including against the triggering attack,
 * > **and you take no damage from _Magic Missile_**."
 *
 * The first trigger has been executed since the spell landed; the second
 * waited on a *moment*. It has one now, and it was already in the engine:
 * `pendingCastings` holds a declared casting between its targets and its
 * effects, which is where Counterspell stands — so Shield answers the same
 * hold from the other end of it, as one of the creatures the casting named.
 *
 * Three things this file is about, in the order the spell says them:
 *
 * 1. **The window opens where the casting is declared.** A Magic Missile
 *    resolved in one command never stops between naming its targets and
 *    throwing its darts, so what opens the window is the `hold` Counterspell
 *    already asks for. That is a stated price, not a gap: an engine that held
 *    every casting open would make every Fire Bolt a negotiation.
 * 2. **The negation is narrowed by casting id.** "You take no damage from
 *    Magic Missile" is not an Immunity to a spell — `damage-defense` names a
 *    damage type and no engine rule may name a catalogue entry — so what the
 *    record pins is the casting this Reaction was taken against, and the
 *    Fighter standing beside the wizard takes their darts.
 * 3. **The first trigger is untouched.** Shield cast against a hit still
 *    raises the Armour Class until the start of the caster's next turn.
 */

const id = (s: string) => asCharacterId(s);
const WIZARD = id('wizard');
const FIGHTER = id('fighter');
const ENEMY = id('enemy');
/** A second caster, whose darts this wizard's Shield was not raised against. */
const OTHER = id('other');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 5,
  abilities: { str: 14, dex: 10, con: 14, int: 16, wis: 12, cha: 10 },
  skills: {},
  saveProficiencies: ['con'],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
  weaponProficiencies: ['simple', 'martial'],
  ...over,
});

const added = (who: CharacterId, side: string): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 60,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side,
});

/**
 * A wizard who knows Shield, a fighter beside them who does not, and an enemy
 * with Magic Missile prepared.
 *
 * The fighter is the control the whole file turns on: the darts are aimed at
 * both, one of them answers, and what the other takes is the claim.
 */
const TABLE: readonly GameEvent[] = [
  added(ENEMY, 'foes'),
  added(OTHER, 'foes'),
  added(WIZARD, 'party'),
  added(FIGHTER, 'party'),
  ...[1, 2, 3].flatMap((level): GameEvent[] =>
    [WIZARD, ENEMY, OTHER].map((who) => ({
      type: 'resource-pool-declared',
      id: who,
      pool: { key: spellSlotKey(level), label: `l${level}`, max: 4, recovers: 'long-rest' },
    })),
  ),
  {
    type: 'spellcasting-declared',
    id: WIZARD,
    spellcasting: declaredCasting({ ability: 'int', prepared: ['shield', 'counterspell'] }),
  },
  ...[ENEMY, OTHER].map((who): GameEvent => ({
    type: 'spellcasting-declared',
    id: who,
    spellcasting: declaredCasting({ ability: 'int', prepared: ['magic-missile', 'bane'] }),
  })),
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
  { type: 'creature-placed', id: ENEMY, placement: { from: { sceneCenter: true }, feet: 0 } },
  {
    type: 'creature-placed',
    id: WIZARD,
    placement: { from: { creature: ENEMY }, feet: 30, bearing: 0 },
  },
  {
    type: 'creature-placed',
    id: FIGHTER,
    placement: { from: { creature: ENEMY }, feet: 30, bearing: 90 },
  },
  {
    type: 'creature-placed',
    id: OTHER,
    placement: { from: { creature: ENEMY }, feet: 10, bearing: 180 },
  },
  { type: 'sight-declared', from: ENEMY, to: WIZARD, seen: true },
  { type: 'sight-declared', from: OTHER, to: WIZARD, seen: true },
  { type: 'sight-declared', from: ENEMY, to: FIGHTER, seen: true },
  { type: 'sight-declared', from: WIZARD, to: ENEMY, seen: true },
  {
    type: 'combat-started',
    combatants: [
      { id: ENEMY, initiative: 20, speed: 30 },
      { id: OTHER, initiative: 15, speed: 30 },
      { id: WIZARD, initiative: 10, speed: 30 },
      { id: FIGHTER, initiative: 5, speed: 30 },
    ],
  },
];

const supply = (seed = 'shield') => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed),
  content: SRD_CONTENT,
});

const at = (log: readonly GameEvent[]): GameState => fold('shield', log);
const hp = (state: GameState, who: CharacterId): number => state.creatures[who]!.vitals.hp;

/** The enemy declares Magic Missile at both of them, holding the casting open. */
const declareMissiles = (log: readonly GameEvent[] = TABLE, spell = 'magic-missile') =>
  unwrap(
    resolveSpell(
      at(log),
      ENEMY,
      { spellId: spell, targets: [WIZARD, FIGHTER], slotLevel: 1, hold: true },
      supply(),
    ),
    'the darts',
  );

describe('the window a declared casting opens for the creatures it named', () => {
  it('offers Shield to a target of Magic Missile and to nobody else', () => {
    const declared = declareMissiles();
    const open = at([...TABLE, ...declared.events]);
    expect(pendingCastingsOf(open)).toHaveLength(1);

    const offers = reactionOpportunities(open, SRD_CONTENT).filter(
      (chance) => chance.window === 'targeted-by-spell',
    );
    expect(offers).toEqual([
      {
        window: 'targeted-by-spell',
        reactor: WIZARD,
        id: 'shield',
        name: 'Shield',
        kind: 'spell',
        costsReaction: true,
        pool: null,
        against: ENEMY,
        casting: declared.castingId,
      },
    ]);
  });

  /**
   * And a casting of something else offers nothing: the trigger names one
   * spell, and the engine compares the id it was handed against the id the
   * declaration pinned.
   */
  it('offers nothing to a creature targeted by another spell', () => {
    const declared = declareMissiles(TABLE, 'bane');
    const open = at([...TABLE, ...declared.events]);
    expect(
      reactionOpportunities(open, SRD_CONTENT).filter(
        (chance) => chance.window === 'targeted-by-spell',
      ),
    ).toEqual([]);

    // And the casting is refused rather than quietly allowed, on the trigger
    // the spell's first clause states: nothing has hit the wizard.
    const refused = resolveSpell(
      open,
      WIZARD,
      { spellId: 'shield', targets: [WIZARD], slotLevel: 1 },
      supply(),
    );
    expect(isErr(refused) && refused.code).toBe('no_trigger');
  });

  it('refuses Shield with no casting open and nothing hitting the wizard', () => {
    const refused = resolveSpell(
      at(TABLE),
      WIZARD,
      { spellId: 'shield', targets: [WIZARD], slotLevel: 1 },
      supply(),
    );
    expect(isErr(refused) && refused.code).toBe('no_trigger');
  });
});

describe('what the Reaction turns aside', () => {
  /** The wizard answers the declared darts; the fighter does not. */
  const shielded = (): { readonly log: readonly GameEvent[]; readonly castingId: string } => {
    const declared = declareMissiles();
    const withDarts = [...TABLE, ...declared.events];
    const cast = unwrap(
      resolveSpell(
        at(withDarts),
        WIZARD,
        { spellId: 'shield', targets: [WIZARD], slotLevel: 1, answers: declared.castingId! },
        supply(),
      ),
      'the shield',
    );
    return { log: [...withDarts, ...cast.events], castingId: declared.castingId! };
  };

  it('pins the casting it was taken against on the record it leaves running', () => {
    const { log, castingId } = shielded();
    const running = ongoingSpellsOn(at(log), WIZARD).filter((one) => one.spellId === 'shield');
    expect(running).toHaveLength(1);
    expect(running[0]!.negates).toBe(castingId);
  });

  it('takes no damage from the darts, while the fighter beside it takes three', () => {
    const { log, castingId } = shielded();
    const before = at(log);
    const settled = unwrap(resolveDeclaredCast(before, castingId, supply()), 'the darts land');
    const after = at([...log, ...settled.events]);

    expect(hp(after, WIZARD)).toBe(hp(before, WIZARD));
    expect(hp(after, FIGHTER)).toBeLessThan(hp(before, FIGHTER));
    // Three darts at 1d4+1 each, dealt one at a time: the fighter lost at
    // least three points and no more than fifteen.
    const lost = hp(before, FIGHTER) - hp(after, FIGHTER);
    expect(lost).toBeGreaterThanOrEqual(3);
    expect(lost).toBeLessThanOrEqual(15);
    // And the engine says what it did rather than quietly dealing nothing.
    expect(settled.unverified.join(' ')).toContain('took no damage');
  });

  /**
   * And the Reaction is spent on the thing it was taken against: a **second**
   * caster's darts are a different casting, and this Shield does not answer
   * them. That is the whole reason the pin is a casting id.
   */
  it('turns aside only the casting it names', () => {
    const { log, castingId } = shielded();
    // The first volley lands and the wizard takes none of it.
    const first = unwrap(resolveDeclaredCast(at(log), castingId, supply()), 'the first volley');
    let events: readonly GameEvent[] = [...log, ...first.events];
    // The turn passes to a **second** caster, who throws a second volley at
    // the wizard. The Shield is still up — it lasts until the start of the
    // wizard's next turn — and it was taken against the first volley, which is
    // the whole reason the pin is a casting id rather than a spell.
    const turned = unwrap(resolveTurn(at(events), supply()), 'the turn');
    events = [...events, ...turned.events];

    const again = unwrap(
      resolveSpell(
        at(events),
        OTHER,
        {
          spellId: 'magic-missile',
          targets: [WIZARD],
          slotLevel: 1,
          hold: true,
          commandId: 'second-volley',
        },
        supply('again'),
      ),
      'the second volley',
    );
    const withSecond = [...events, ...again.events];
    const before = at(withSecond);
    // Still running, and still pinned to the first casting.
    expect(
      ongoingSpellsOn(before, WIZARD).find((one) => one.spellId === 'shield')?.negates,
    ).toBe(castingId);

    const settled = unwrap(
      resolveDeclaredCast(before, again.castingId!, supply('again')),
      'the second volley lands',
    );
    expect(hp(at([...withSecond, ...settled.events]), WIZARD)).toBeLessThan(hp(before, WIZARD));
  });

  it('spends the slot and the Reaction, as any Reaction spell does', () => {
    const { log } = shielded();
    const after = at(log);
    expect(remaining(after.creatures[WIZARD]!.resources, spellSlotKey(1))).toBe(3);
    expect(after.combat!.budgets[WIZARD]!.reaction).toBe(false);
  });
});

describe('the first trigger, which the second does not disturb', () => {
  it('raises the Armour Class against a hit that is being held', () => {
    // Within reach, because the first trigger is a swing rather than a spell:
    // the same table with the wizard standing next to the enemy instead of
    // thirty feet away.
    const inReach: readonly GameEvent[] = TABLE.map((event) =>
      event.type === 'creature-placed' && event.id === WIZARD
        ? {
            ...event,
            placement: { from: { creature: ENEMY }, feet: 5, bearing: 0 },
          }
        : event,
    );
    const before = at(inReach);
    const bare = armorClassOf(before, WIZARD);

    // The enemy swings and holds the hit, which is the window Shield's first
    // clause names.
    let swung = null;
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f']) {
      const out = unwrap(
        resolveAttack(
          before,
          ENEMY,
          { target: WIZARD, weapon: null, hold: true, commandId: `swing-${seed}` },
          supply(seed),
        ),
        'the swing',
      );
      if (out.attack?.hit === true) {
        swung = out;
        break;
      }
    }
    expect(swung).not.toBeNull();

    const held = at([...inReach, ...swung!.events]);
    const cast = unwrap(
      resolveSpell(held, WIZARD, { spellId: 'shield', targets: [WIZARD], slotLevel: 1 }, supply()),
      'the shield',
    );
    const after = at([...inReach, ...swung!.events, ...cast.events]);
    expect(armorClassOf(after, WIZARD)).toBe(bare + 5);
  });
});
