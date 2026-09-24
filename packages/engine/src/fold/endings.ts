/**
 * An effect ended by something that happens.
 *
 * The fifth way a casting ends, and the only one that is neither a moment on
 * the clock nor somebody's decision: Invisibility ends when its target
 * attacks, Mage Armor when the target dons armour, Animal Friendship when the
 * caster or an ally damages the target. Nobody decides any of that, so the
 * reducer finds it — derived, with no event, exactly as it finds a lost
 * Concentration.
 *
 * **Two populations and one reading of the log.** SRD prints the same sentence
 * on things that were never cast — Potion of Invisibility ends "if you make an
 * attack roll, deal damage, or cast a spell", word for word what Invisibility
 * says — so {@link endingFactsOf} is read once and two passes consume it:
 * {@link endTriggeredCastings} over `ongoing`, and {@link endTriggeredEffects}
 * over the timers a conferral filed. One shared *rule*, not one shared loop:
 * the two end different things through different doors.
 *
 * Two things this module is careful about. A trigger hangs on a consequence
 * event and never on `roll-recorded`, which changes no state by rule. And
 * "ally" is declared allegiance with three answers, of which only two end
 * anything — `allyOfCaster` withholds rather than inventing.
 */
import type { CharacterId } from '@ie/shared';
import { instancesEndingEarly } from '../conditions.js';
import { type EffectEndCause, timerKey } from '../timers.js';
import { castingNumber, creaturesStandingInCastingArea, type OngoingSpell } from '../spells.js';
import { positionOf } from '../positioning.js';

import type { GameEvent } from '../events.js';
import type { GameState } from '../state.js';
import { casterOf, endTimedCondition, isOn, releaseCasting, releaseOnTarget } from './release.js';

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
      /** {@link EffectEndCause} — the four that name one creature and nothing else. */
      readonly cause: EffectEndCause;
      readonly who: CharacterId;
    }
  | {
      readonly cause: 'caster-or-ally-damages-target';
      readonly victim: CharacterId;
      readonly dealer: CharacterId;
    }
  /**
   * The creature a blow landed on, whoever swung and whether anybody did.
   *
   * `to` rather than `who` deliberately: `who` is the discriminant
   * {@link endTriggeredEffects} narrows on to prove that only
   * {@link EffectEndCause} can reach a timer, and a second field of that name
   * would quietly widen what an item's conferral could be ended by.
   */
  | {
      readonly cause: 'target-takes-damage' | 'target-drops-to-0';
      readonly to: CharacterId;
    }
  /** The creature a casting is sustaining, found through `summonedBy`. */
  | {
      readonly cause: 'summon-takes-damage';
      readonly summon: CharacterId;
    }
  /**
   * The sleeper a neighbour has just spent an action shaking.
   *
   * `woken` rather than `who` for the reason `to` is not `who`: the `who`
   * field is the discriminant {@link endTriggeredEffects} narrows on to prove
   * that only {@link EffectEndCause} can reach a timer, and a second field of
   * that name would quietly widen what a potion's conferral could be ended by.
   */
  | {
      readonly cause: 'shaken-awake';
      readonly woken: CharacterId;
    }
  /**
   * A creature whose authoritative position just changed — a walk or a
   * teleport, which write the same `creature-moved`.
   *
   * `mover` rather than `who`, for the reason `to` and `woken` are not: the
   * `who` field is the discriminant {@link endTriggeredEffects} narrows on,
   * and a timer has no area for anybody to leave. Whether the mover is the
   * casting's caster, and whether they are now outside its area, is
   * {@link subjectOf}'s question — the fact says only that somebody moved.
   */
  | {
      readonly cause: 'caster-leaves-the-area';
      readonly mover: CharacterId;
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
    // SRD Sleep: "…or someone within 5 feet of it takes an action to shake it
    // out of the spell's effect." The five feet and the action were spent by
    // `wakeCreature`; what is left is the fact, and it names one creature.
    case 'creature-woken':
      return [{ cause: 'shaken-awake', woken: event.id }];
    // SRD Tiny Hut: "The spell ends early if you leave the Emanation." A walk
    // and a teleport both write this event, so both are read here; which
    // casting it is the caster of, and whether they are now outside, is asked
    // per record below.
    case 'creature-moved':
      return [{ cause: 'caster-leaves-the-area', mover: event.id }];
    case 'damage-taken':
      return [
        // **The three that read the creature the blow landed on**, so a trap
        // naming nobody still pulls them — and none of them fires on a hit
        // that dealt nothing. "If it takes **any** damage" is the widest
        // sentence in the vocabulary and a blow a Resistance took down to zero
        // is still not damage taken: `breakLostConcentration` reads
        // `amount > 0` off this same event for that reason, and two passes in
        // one fold disagreeing about whether a `damage-taken` was damage is a
        // defect rather than a nuance.
        ...(event.amount > 0
          ? [
              { cause: 'target-takes-damage', to: event.id } as const,
              { cause: 'summon-takes-damage', summon: event.id } as const,
              // `drops-to-0` is the state the event left behind, which is the
              // reading `target-dons-armor` already takes: this pass runs
              // after the fold applied the event. **It is the total and not
              // the transition**, so a creature already at 0 taking another
              // blow pulls it too. That costs nothing for the castings in the
              // book, whose first drop ended them — but a casting laid on a
              // creature that was *already* down would end on the next blow
              // rather than on a fall, and the honest name for that is a
              // residue and not a rule. A maximum lowered onto 0 is no blow
              // at all and reaches this nowhere.
              ...(state.creatures[event.id]?.vitals.hp === 0
                ? [{ cause: 'target-drops-to-0', to: event.id } as const]
                : []),
            ]
          : []),
        // And the two that read the other end of it. A trap names nobody, and
        // that is a real answer rather than a gap: there is no creature that
        // dealt it, so neither of these can fire — and neither fires on
        // nothing, for the same reason the three above do not. An amount of 0
        // is also a blow a damage **threshold** turned aside: SRD calls that
        // "superficial" and says it "doesn't reduce Hit Points", which is
        // Immunity and so damage *not taken*. Two tracks reached that reading
        // independently, one from Resistance and one from thresholds, which is
        // the strongest evidence it is the right one.
        ...(event.by === undefined || event.amount === 0
          ? []
          : [
              { cause: 'target-deals-damage', who: event.by } as const,
              {
                cause: 'caster-or-ally-damages-target',
                victim: event.id,
                dealer: event.by,
              } as const,
            ]),
      ];
    default:
      return [];
  }
}

/**
 * The creature this fact makes *this* casting's business, or null.
 *
 * **Every sentence in the vocabulary says whom it is about, and all but one of
 * them say "the target".** `spellOn` is the engine's answer to which creatures
 * those are, so a Mage Armor on the wizard is untouched by the fighter putting
 * a breastplate on and a Charm Person is untouched by damage dealt to somebody
 * it never caught. The exception is the creature a casting is **sustaining**:
 * `isOn` asks what a creature is holding of the casting and a steed holds
 * nothing, so `summonedBy` is the only link that can answer and the eligibility
 * rule is its own.
 *
 * One function rather than a gate written beside the loop, because the gate is
 * the *rule* — that a fact belongs to a casting — and a second cause read by
 * an `isOn` somebody remembered to skip is how a Phantom Steed comes to end on
 * a blow struck three rooms away.
 */
function subjectOf(
  state: GameState,
  record: OngoingSpell,
  fact: EndingFact,
): CharacterId | null {
  switch (fact.cause) {
    case 'summon-takes-damage':
      return state.creatures[fact.summon]?.summonedBy?.castingId === record.castingId
        ? fact.summon
        : null;

    case 'caster-or-ally-damages-target':
      // Withheld rather than invented: only a verdict that says yes ends
      // anything, and `unknown` is reported by `withheldEndings`.
      return ['caster', 'ally'].includes(allyOfCaster(state, record.caster, fact.dealer)) &&
        isOn(state, record, fact.victim)
        ? fact.victim
        : null;

    case 'target-takes-damage':
    case 'target-drops-to-0':
      return isOn(state, record, fact.to) ? fact.to : null;

    case 'shaken-awake':
      return isOn(state, record, fact.woken) ? fact.woken : null;

    // The one cause about the caster and a place: this casting's own caster,
    // and the area it pinned no longer holding them.
    case 'caster-leaves-the-area':
      return fact.mover === record.caster && casterOutsideArea(state, record) ? fact.mover : null;

    default:
      return isOn(state, record, fact.who) ? fact.who : null;
  }
}

/**
 * Whether a casting's caster is standing outside the area it pinned.
 *
 * Off the record's own geometry — the stationary Emanation's pinned point, its
 * distance — through the same reader every standing clause uses, so the dome
 * the barrier refuses a goblin at is the dome the wizard has to leave. A
 * casting whose area cannot be located, or a caster nobody has placed, is
 * nowhere in particular and has left nothing: the withholding direction.
 */
function casterOutsideArea(state: GameState, record: OngoingSpell): boolean {
  const scene = state.scene;
  if (scene === null || positionOf(scene, record.caster as CharacterId) === null) return false;
  const inside = creaturesStandingInCastingArea(scene, record);
  return inside !== null && !inside.has(record.caster as CharacterId);
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
 * **The fact has to be this casting's**, which {@link subjectOf} is the whole
 * of: for all but one cause that means a creature the casting is *on*, and for
 * the one it means the creature the casting is sustaining.
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

        const subject = subjectOf(state, record, fact);
        if (subject === null) continue;
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

/**
 * A timed effect ended by something that happens, with no casting anywhere.
 *
 * SRD Potion of Invisibility: "you have the Invisible condition for 1 hour.
 * The effect ends early if you make an attack roll, deal damage, or cast a
 * spell." The same three sentences Invisibility prints, on a thing that was
 * never cast — so there is no `ongoing` record for {@link
 * endTriggeredCastings} to walk and nothing for `releaseCasting` to address.
 * What holds it is the **timer**, and the timer is what this pass reads.
 *
 * Beside that function rather than inside it, and reading the same
 * {@link EndingFact}s off the same four events: one reading of the log, two
 * populations. Folding the two loops together would mean one walk over two
 * unrelated records answering to two different release doors, which is a
 * shared loop rather than a shared rule.
 *
 * **Only the who-shaped causes can reach a timer.** A timer knows the creature
 * it sits on and nothing else — no caster, no allegiance — so
 * `caster-or-ally-damages-target` has nothing here to be about, and
 * {@link EffectEndCause} is exactly the four that do. That is a property of
 * the type rather than a filter written by hand: the `'who' in fact` narrowing
 * below is what the compiler checks `endsEarly.includes` against.
 *
 * **Derived, and it writes nothing**, for the reason every pass in the fold's
 * chain does: nobody decides that the drinker swung. And it terminates
 * structurally — the candidate keys are read from the state this pass was
 * handed, each is visited once, and `endTimedCondition` deletes the key before
 * it touches the condition, so nothing a release does can hand the loop back
 * a timer it has already settled.
 *
 * **Cheap first.** Four event types can say anything at all, and every other
 * one returns before `timers` is touched.
 */
/**
 * A printed condition ended by a blow or by a neighbour shaking the creature.
 *
 * SRD Incubus' Nightmare: "the Unconscious condition **for 1 hour, until it
 * takes damage, or until a creature within 5 feet of it takes an action to
 * wake it**." SRD Brass Dragon Wyrmling's Sleep Breath and SRD Pseudodragon's
 * Sting print the same pair over a condition no spell ever cast.
 *
 * **The third population reading the same facts**, beside the castings above
 * and the timed conferrals beside them, and it is a third rather than a case
 * in either because what holds these is neither an `ongoing` record nor a
 * timer: the Pseudodragon's Unconscious is a condition its Poisoned *carries*,
 * with no deadline of its own for an `endsEarly` to sit on. What holds them
 * all is the **instance**, which is why the marks are there — see
 * `ConditionInstance.endsOnDamage`.
 *
 * **Derived and writing nothing**, for the reason every pass in this chain is:
 * nobody decides that a blow woke somebody. And it reads the same
 * {@link EndingFact}s the two passes above read, so a sleeper whose casting
 * says `shaken-awake` and a sleeper whose stat block printed the clause are
 * ended by one reading of one log.
 *
 * **It terminates structurally.** The instance ids are read off the state this
 * pass was handed, each is visited once, and each visit either removes that
 * instance or finds it already gone — so nothing a removal does can hand the
 * loop back an instance it has settled.
 *
 * **Cheap first**: two event types can say anything at all here, and every
 * other one returns before a creature is touched.
 */
export function endEarlyEndedConditions(state: GameState, event: GameEvent): GameState {
  // Only the two facts this rule is about. `endingFactsOf` answers more
  // questions than this one asks, and reading its whole answer would be this
  // pass discovering a cause it has no sentence for.
  const woken = event.type === 'creature-woken' ? event.id : null;
  const hurt =
    event.type === 'damage-taken' && event.amount > 0 ? event.id : null;
  const subject = woken ?? hurt;
  if (subject === null) return state;

  const creature = state.creatures[subject];
  if (creature === undefined) return state;
  const doomed = instancesEndingEarly(
    creature.conditions,
    woken === null ? 'damage' : 'waking',
  ).map((instance) => instance.id);
  if (doomed.length === 0) return state;

  let current = state;
  for (const instance of doomed) {
    const held = current.creatures[subject];
    if (held === undefined) continue;
    // Gone already, because an instance this loop lifted carried it: the
    // Pseudodragon's Unconscious would go with its Poisoned if a line ever
    // marked both, and lifting what is not there is not an operation.
    if (!held.conditions.instances.some((one) => one.id === instance)) continue;
    // The same door a deadline arriving goes through, so the instance's own
    // timer and anything sourced to the instance go with it. `timerKey` is the
    // derivation `applyConditionTo` filed it under; a key naming no timer is
    // deleted harmlessly, which is every carried instance's case.
    current = endTimedCondition(
      current,
      timerKey({ kind: 'condition', on: subject, instance }),
      { kind: 'condition', on: subject, instance },
    );
  }
  return current;
}

export function endTriggeredEffects(state: GameState, event: GameEvent): GameState {
  const facts = endingFactsOf(state, event);
  if (facts.length === 0) return state;

  let current = state;
  // Sorted, as every walk over a keyed record in the fold is, so two folds of
  // one log settle them in one order.
  for (const key of Object.keys(state.timers).sort()) {
    const timer = current.timers[key];
    if (timer === undefined) continue;

    const target = timer.target;
    const triggers = timer.endsEarly;
    // A casting's own early endings live on its `ongoing` record, where a
    // scope can be written beside them; nothing else a timer can end has an
    // SRD sentence asking for one.
    if (target.kind !== 'condition' || triggers === undefined) continue;

    const pulled = facts.some(
      (fact) => 'who' in fact && fact.who === target.on && triggers.includes(fact.cause),
    );
    if (!pulled) continue;

    current = endTimedCondition(current, key, target);
  }
  return current;
}
