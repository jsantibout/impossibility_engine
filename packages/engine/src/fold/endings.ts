/**
 * A casting ended by something that happens.
 *
 * The fifth way a casting ends, and the only one that is neither a moment on
 * the clock nor somebody's decision: Invisibility ends when its target
 * attacks, Mage Armor when the target dons armour, Animal Friendship when the
 * caster or an ally damages the target. Nobody decides any of that, so the
 * reducer finds it — derived, with no event, exactly as it finds a lost
 * Concentration.
 *
 * Two things this module is careful about. A trigger hangs on a consequence
 * event and never on `roll-recorded`, which changes no state by rule. And
 * "ally" is declared allegiance with three answers, of which only two end
 * anything — `allyOfCaster` withholds rather than inventing.
 */
import type { CharacterId } from '@ie/shared';
import { castingNumber } from '../spells.js';

import type { GameEvent } from '../events.js';
import type { GameState } from '../state.js';
import { casterOf, isOn, releaseCasting, releaseOnTarget } from './release.js';

/**
 * Whether the creature that dealt this damage is the caster or one of their
 * allies — and the third answer, which is the point of the function.
 *
 * SRD writes "you or your allies" in five spells and the engine holds
 * allegiance as a **declared** fact: `side` is null until somebody says so.
 * So there are three answers and not two, exactly as there are for cover and
 * for sight, and the one that matters is `unknown`. A table not tracking sides
 * must not have an ending invented for it, and must not silently lose one
 * either — which is why {@link withheldEndings} exists to be asked.
 *
 * **The caster is never in doubt**, because the sentence names them: "**you**
 * or one of your allies". That branch reads no side at all, so a Charm Person
 * cast by a creature nobody has placed on a side still ends when its own
 * caster strikes the target.
 *
 * One function, two callers — the reducer's derived pass and the query — for
 * the reason this file records everywhere else: two implementations of one
 * sentence agree until the day they do not.
 */
export type AllyVerdict = 'caster' | 'ally' | 'not-ally' | 'unknown';

export function allyOfCaster(
  state: GameState,
  casterId: string,
  dealer: string,
): AllyVerdict {
  if (dealer === casterId) return 'caster';
  const caster = state.creatures[casterId];
  const hand = state.creatures[dealer];
  if (caster?.side == null || hand?.side == null) return 'unknown';
  return caster.side === hand.side ? 'ally' : 'not-ally';
}

/**
 * What this event says happened, in the vocabulary a trigger is written in.
 *
 * **Read off the event, and off a consequence event rather than a roll.**
 * `roll-recorded` changes no state by rule — that is what the event is for —
 * so hanging an ending on one would end a spell on the strength of a number
 * whose outcome had not happened. `attack-made` is therefore what
 * `target-attacks` reads: it is the Attack action rather than every attack
 * roll, and Invisibility's own `unmodelled` records what that leaves out.
 *
 * One event can say two things: damage names both its dealer — the fact
 * Hellish Rebuke needed, because `source` is prose and prose cannot be aimed
 * at — and its victim, and the two causes read opposite ends of it.
 */
type EndingFact =
  | {
      readonly cause: 'target-attacks' | 'target-deals-damage' | 'target-casts' | 'target-dons-armor';
      readonly who: CharacterId;
    }
  | {
      readonly cause: 'caster-or-ally-damages-target';
      readonly victim: CharacterId;
      readonly dealer: CharacterId;
    };

/**
 * SRD Mage Armor's "dons armor" is the body slot, not a Shield.
 *
 * The same question `withEquipment` asks when it derives the sheet's two
 * armour fields, and the same one `mustBeUnarmored` asks when the spell is
 * cast — "isn't wearing armor" is one sentence, and a Shield is not what it
 * refuses. Asked of the item the event names rather than of the creature,
 * because the event is what says the moment arrived.
 */
function isBodyArmor(state: GameState, event: { readonly id: CharacterId; readonly item: string }): boolean {
  // Read off the creature rather than off a catalogue: the inventory seam has
  // already put the pinned record on the creature by the time this pass runs.
  const piece = state.creatures[event.id]?.equipped.find((held) => held.id === event.item)?.armor ?? null;
  return piece !== null && piece.category !== 'shield';
}

function endingFactsOf(state: GameState, event: GameEvent): readonly EndingFact[] {
  switch (event.type) {
    case 'attack-made':
      return [{ cause: 'target-attacks', who: event.id }];
    // The settled casting, never the declared one: SRD Counterspell makes a
    // declaration that may dissipate "with no effect", and a spell that never
    // settled is not one the target cast.
    case 'spell-cast':
      return [{ cause: 'target-casts', who: event.id }];
    case 'item-equipped':
      return isBodyArmor(state, event) ? [{ cause: 'target-dons-armor', who: event.id }] : [];
    case 'damage-taken':
      // A trap names nobody, and that is a real answer rather than a gap:
      // there is no creature that dealt it, so neither cause can fire.
      return event.by === undefined
        ? []
        : [
            { cause: 'target-deals-damage', who: event.by },
            { cause: 'caster-or-ally-damages-target', victim: event.id, dealer: event.by },
          ];
    default:
      return [];
  }
}

/** One casting to end, and whether it ends outright or on one creature. */
interface Ending {
  readonly castingId: string;
  /** Null ends the casting; a creature releases it on them and no one else. */
  readonly on: CharacterId | null;
  /** The creature the trigger named, whichever scope it ends at. */
  readonly subject: CharacterId;
}

/**
 * The first casting these facts end, in the order the castings happened.
 *
 * Numerically rather than lexically, as every walk over `ongoing` is, so two
 * folds of one log end them in one order.
 *
 * **The creature has to be one the casting is on.** Every sentence here says
 * "the target", and `spellOn` is the engine's answer to which creatures those
 * are — so a Mage Armor on the wizard is untouched by the fighter putting a
 * breastplate on, and a Charm Person is untouched by damage dealt to somebody
 * it never caught.
 *
 * `settled` is the loop's own memory rather than a rule — see
 * {@link endTriggeredCastings} for why termination is not left to what a
 * release happens to remove.
 */
function nextEnding(
  state: GameState,
  facts: readonly EndingFact[],
  settled: ReadonlySet<string>,
): Ending | null {
  for (const castingId of Object.keys(state.ongoing).sort(
    (a, b) => castingNumber(a) - castingNumber(b),
  )) {
    const record = state.ongoing[castingId];
    if (record?.endsEarly === undefined) continue;

    for (const trigger of record.endsEarly) {
      for (const fact of facts) {
        if (fact.cause !== trigger.on) continue;

        const subject =
          fact.cause === 'caster-or-ally-damages-target'
            ? // Withheld rather than invented: only a verdict that says yes
              // ends anything, and `unknown` is reported by `withheldEndings`.
              ['caster', 'ally'].includes(allyOfCaster(state, record.caster, fact.dealer))
              ? fact.victim
              : null
            : fact.who;

        if (subject === null || !isOn(state, record, subject)) continue;
        if (settled.has(endingKey(castingId, subject))) continue;
        return { castingId, on: trigger.ends === 'target' ? subject : null, subject };
      }
    }
  }
  return null;
}

const endingKey = (castingId: string, subject: CharacterId): string =>
  `${castingId}|${subject}`;

/**
 * End every casting whose trigger this event pulled.
 *
 * Derived rather than commanded, for the reason a broken Concentration and an
 * expired deadline are: **nobody decides that the target swung**. The engine
 * finds it, so no log — however assembled — can show an Invisibility running
 * on a creature that has just cast a spell, and no caller has to remember a
 * sentence printed on somebody else's spell.
 *
 * **Cheap first.** Four event types can say anything at all here, and every
 * other event returns before `ongoing` is touched. That is the discipline
 * `anyCreature` established for the three passes that sort the whole cast.
 *
 * **And it terminates *structurally*, which is the whole reason `settled`
 * exists.** A release changes the state the next pass reads, so the loop has
 * to consume something it cannot recreate — the move `expireEffects` makes by
 * deleting the timer key *before* it acts on it. Here the consumed thing is
 * the `(casting, creature)` pair, recorded before the release and skipped
 * afterwards, so the candidate set is finite by construction and shrinks by
 * one every iteration whatever a release does.
 *
 * **That was measured rather than assumed.** Progress really is implied today
 * by what the two doors do — `releaseCasting` deletes the record and
 * `releaseOnTarget` takes the subject out of `on`, which the match above
 * requires it to have been in — and a mutation dropping that `on` check
 * **hung the fold** rather than failing a test. Termination resting on what a
 * function three hundred lines away happens to remove is the kind of coupling
 * that is correct until somebody edits the other end, and a wedged fold is the
 * worst possible way to find out.
 *
 * Today it settles in a single step for every registered spell. The loop is
 * what keeps it correct when one blow ends two castings, which the tests do
 * drive: a strike on a charmed Beast by an invisible ally is two causes off
 * one `damage-taken`.
 */
export function endTriggeredCastings(state: GameState, event: GameEvent): GameState {
  const facts = endingFactsOf(state, event);
  if (facts.length === 0) return state;

  const settled = new Set<string>();
  let current = state;
  for (;;) {
    const ending = nextEnding(current, facts, settled);
    if (ending === null) return current;
    settled.add(endingKey(ending.castingId, ending.subject));

    current =
      ending.on === null
        ? releaseCasting(current, casterOf(current, ending.castingId), ending.castingId)
        : releaseOnTarget(current, ending.on, ending.castingId);
  }
}

