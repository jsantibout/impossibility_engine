/**
 * An object a block is born holding — SRD Night Hag, Soul Bag: "The hag has a
 * soul bag. While holding or carrying the bag, the hag can use its Nightmare
 * Haunting action. / The bag has AC 15, HP 20, and Resistance to all damage. The
 * bag turns to dust if reduced to 0 Hit Points. If the bag is destroyed, any
 * souls the bag is holding are released. The hag can create a new bag after 7
 * days."
 *
 * **Every thing in a game exists because somebody described it or because a use
 * spun it**, and this is the one line in the book that makes a third: a thing
 * the stat block arrives with. `raisePrintedObject` is the door the Giant
 * Spider's web already comes through, so the numbers are the line's own and
 * pinned; what is new is the **id**, `carriedObjectId`, derived from the block's
 * own noun and the creature so that nothing has to remember it.
 *
 * The gate is the other half. "Requires Soul Bag" is printed inside a heading —
 * exactly what nothing downstream may branch on — so the parser reads the word
 * once and the adapter compiles it into a `while-carrying` requirement, which is
 * the vocabulary a standing effect and a granted spell route are already gated
 * by and is asked through the one reader `requirementsHold`. Both doors on the
 * heading ask it, so they cannot come to disagree.
 *
 * What the engine cannot see it says so about: the souls in the bag and the
 * seven days before a second one are on the trait's own `handedOver` and come
 * back at the arrival, in the book's words.
 */

import { SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import { asCharacterId, DAMAGE_TYPES, isErr, type Result } from '@ie/shared';
import {
  addCreature,
  beginCombat,
  damageCreature,
  declareCreatureSide,
  takeStatedAction,
} from './commands.js';
import { applyEvent, fold, type GameEvent, type GameState } from './events.js';
import { adaptMonster, statedActionOf } from './monster.js';
import { armorClassOf } from './standing.js';
import { OBJECT_DAMAGE_IMMUNITIES } from './objects.js';
import { carriedObjectId } from './state.js';

const id = (s: string) => asCharacterId(s);
const HAG = id('hag');
const BAG = carriedObjectId(HAG, 'soul bag');

/** The block's own headings, read off the block rather than retyped. */
const TRAIT = SRD_CONTENT.monsterById('night-hag')!.traits.find((t) => t.name === 'Soul Bag')!;
const HAUNTING = SRD_CONTENT.monsterById('night-hag')!.actions.find((a) =>
  a.name.startsWith('Nightmare Haunting'),
)!.name;

const unwrap = <T>(result: Result<T>, label = 'ok'): T => {
  if (!result.ok) throw new Error(`${label}: ${result.code} — ${result.reason}`);
  return result.value;
};

const after = (state: GameState, events: readonly GameEvent[]): GameState =>
  events.reduce((s, e) => applyEvent(s, e), state);

function inTheHovel(): { readonly state: GameState; readonly unverified: readonly string[] } {
  const arrived = unwrap(addCreature(fold('hovel', []), SRD_CONTENT, HAG, 'night-hag'), 'the hag');
  let state = after(fold('hovel', []), arrived.events);
  state = after(state, unwrap(declareCreatureSide(state, HAG, 'monsters'), 'side'));
  state = after(
    state,
    unwrap(beginCombat(state, [{ id: HAG, initiative: 20, speed: 30 }]), 'combat'),
  );
  return { state, unverified: arrived.unverified };
}

describe('the trait as the parser reads it', () => {
  it('reads the noun and the three statistics, and hands the souls and the days over', () => {
    expect(TRAIT.trait).toEqual({
      kind: 'carries-printed-object',
      noun: 'soul bag',
      armorClass: 15,
      hitPoints: 20,
      resistsAllDamage: true,
      handedOver: [
        'If the bag is destroyed, any souls the bag is holding are released.',
        'The hag can create a new bag after 7 days.',
      ],
    });
  });

  it('reads the gate off the heading and compiles it into the requirement vocabulary', () => {
    const hag = adaptMonster(SRD_CONTENT.monsterById('night-hag')!, HAG);
    const haunting = statedActionOf(hag.sheet, HAUNTING);
    expect(haunting?.requires).toEqual([{ kind: 'while-carrying', object: 'Soul Bag' }]);
    expect(hag.carries).toEqual([
      { noun: 'soul bag', armorClass: 15, hitPoints: 20, resistsAllDamage: true },
    ]);
  });
});

describe('the hag arrives holding it', () => {
  it('raises the bag beside her, with the line’s own numbers', () => {
    const { state, unverified } = inTheHovel();
    const bag = state.creatures[BAG];
    expect(bag).toBeDefined();
    expect(bag!.vitals.hpMax).toBe(20);
    expect(armorClassOf(state, BAG)).toBe(15);
    // Resistance to all damage: the thirteen types the glossary names — except
    // the two every object in the rules is outright **immune** to, which
    // `raisePrintedObject` lays over the line's own run and which is the
    // stronger answer. SRD "Damage Types and Objects" is the rule; the line
    // prints nothing that contradicts it.
    for (const type of DAMAGE_TYPES) {
      if (OBJECT_DAMAGE_IMMUNITIES.includes(type)) {
        expect(bag!.defenses[type]?.immune, type).toBe(true);
        continue;
      }
      expect(bag!.defenses[type]?.resistant, type).toBe(true);
    }
    // And the two sentences the engine cannot hold come back at the arrival.
    expect(unverified.join(' ')).toContain('souls');
    expect(unverified.join(' ')).toContain('7 days');
  });
});

describe('the gate the heading prints', () => {
  it('lets the hag take Nightmare Haunting while the bag stands, and refuses her without it', () => {
    const { state } = inTheHovel();
    // The line's own sentence is prose the engine hands over — SRD Dream is a
    // level 5 spell with no definition — so what is under test is the *gate*:
    // the door takes the Action and reports the sentence.
    const taken = unwrap(
      takeStatedAction(state, HAG, { line: HAUNTING, commandId: 'haunt' }),
      'the haunting',
    );
    expect(taken.events.some((e) => e.type === 'action-spent')).toBe(true);
    expect(taken.unverified.join(' ')).toContain('Dream');

    // The bag turns to dust at 0 Hit Points, through the ordinary death every
    // printed object dies by — nothing is remembered and nothing is swept.
    const dusted = after(
      state,
      unwrap(damageCreature(state, BAG, { amount: 40, types: ['force'], commandId: 'burn' }), 'the fire'),
    );
    expect(dusted.creatures[BAG]!.vitals.dead).toBe(true);

    const refused = takeStatedAction(dusted, HAG, { line: HAUNTING, commandId: 'again' });
    expect(isErr(refused) && refused.code).toBe('requirement_unmet');
    if (!refused.ok) expect(refused.reason).toContain('Soul Bag');
    // Nothing was spent being refused.
    expect(dusted.combat!.budgets[HAG]!.action).toBe(true);
  });
});
