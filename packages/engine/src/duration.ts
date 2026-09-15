import { err, ok, type Ability, type CharacterId, type Result, type Skill } from '@ie/shared';
import type { CombatState, TurnCount } from './combat.js';

/**
 * How long an effect lasts, and when it stops.
 *
 * The SRD writes durations two ways, and they are **not** interchangeable:
 *
 * | | |
 * |---|---|
 * | A span of time | "1 minute", "8 hours", "10 days" |
 * | A moment in the turn order | "until the start of your next turn", "until the end of your next turn" |
 *
 * It is tempting to fold the second into the first, since a round is six
 * seconds. That is wrong. Where "the start of your next turn" falls depends on
 * where the anchor sits in the Initiative order and on whose turn the effect
 * began — anything from the very next moment to a full round away. Outside
 * combat it has no meaning at all, because there are no turns.
 *
 * So there are two types. {@link Duration} is what a caller asks for, relative
 * and possibly impossible; {@link Deadline} is what the log records, absolute
 * and already resolved. {@link resolveDuration} is the one conversion between
 * them, and it can refuse — which is what keeps the two from being silently
 * swapped.
 */

/** What a caller asks for. Relative, and not always answerable. */
export type Duration =
  | { readonly kind: 'seconds'; readonly seconds: number }
  | { readonly kind: 'start-of-next-turn'; readonly of: CharacterId }
  | { readonly kind: 'end-of-next-turn'; readonly of: CharacterId }
  /**
   * The turn **in progress** ending — SRD's "until the end of the current
   * turn", which is not anybody's *next* turn.
   *
   * `end-of-next-turn` said of the creature whose turn it is resolves **two**
   * turn-endings away, because the turn in progress has not ended yet; that is
   * a full round late for this sentence. Three SRD consumers write it —
   * Stinking Cloud's Poisoned, Superior Hunter's Defense's Resistance, Steady
   * Aim's Advantage — and none of them could be said before this member.
   *
   * **It names no anchor, and that is the member rather than an omission.**
   * "The current turn" is a moment in the order, not a fact about a creature:
   * Superior Hunter's Defense is a Reaction to damage taken on somebody
   * *else's* turn, and the turn it ends at is the attacker's. So the anchor is
   * derived at resolution from whoever is taking the turn, and an `of` field
   * naming a creature would be one no reader could honestly use — the
   * speculative member this repository's sweeps exist to refuse.
   */
  | { readonly kind: 'end-of-current-turn' }
  | { readonly kind: 'indefinite' };

/** What the log records. Absolute, and always answerable. */
export type Deadline =
  | { readonly kind: 'elapsed'; readonly at: number }
  /** Fires when the anchor has begun this many turns. */
  | { readonly kind: 'turn-start'; readonly of: CharacterId; readonly count: number }
  /** Fires when the anchor has ended this many turns. */
  | { readonly kind: 'turn-end'; readonly of: CharacterId; readonly count: number }
  | { readonly kind: 'indefinite' };

export const forSeconds = (seconds: number): Duration => ({ kind: 'seconds', seconds });
export const startOfNextTurn = (of: CharacterId): Duration => ({ kind: 'start-of-next-turn', of });
export const endOfNextTurn = (of: CharacterId): Duration => ({ kind: 'end-of-next-turn', of });
/**
 * SRD "until the end of the current turn".
 *
 * A constant rather than a function, because it takes no anchor — which is the
 * whole difference between it and {@link endOfNextTurn}. It is still a
 * constructor in the sense that matters here: nobody writes a turn count by
 * hand, and {@link resolveDuration} is the only thing that turns it into one.
 */
export const endOfCurrentTurn: Duration = { kind: 'end-of-current-turn' };
export const indefinite: Duration = { kind: 'indefinite' };

/**
 * Everything a deadline needs to know about the world.
 *
 * Narrower than `GameState` so this module does not have to import it — which
 * would be a cycle, since the reducer is what asks whether a deadline has
 * passed.
 */
export interface TimeView {
  readonly elapsed: number;
  readonly combat: CombatState | null;
}

/** The slice of a GameState a deadline reads. Keeps this module free of a cycle. */
export const timeView = (state: { elapsed: number; combat: CombatState | null }): TimeView => ({
  elapsed: state.elapsed,
  combat: state.combat,
});

const turnsOf = (combat: CombatState | null, of: CharacterId): TurnCount | null =>
  combat?.turnCounts[of] ?? null;

/**
 * Pin a relative duration to an absolute moment.
 *
 * Turn-anchored durations refuse outside combat and refuse for an anchor that
 * is not in the fight. Approximating them in seconds would be the one mistake
 * this whole two-type split exists to prevent.
 */
export function resolveDuration(view: TimeView, duration: Duration): Result<Deadline> {
  switch (duration.kind) {
    case 'indefinite':
      return ok({ kind: 'indefinite' });

    case 'seconds': {
      if (!Number.isInteger(duration.seconds) || duration.seconds < 0) {
        return err('bad_duration', `a duration runs forwards in whole seconds, got ${duration.seconds}`);
      }
      return ok({ kind: 'elapsed', at: view.elapsed + duration.seconds });
    }

    case 'start-of-next-turn':
    case 'end-of-next-turn': {
      if (view.combat === null) {
        return err('no_turns', 'there are no turns outside combat to anchor a duration to');
      }
      const turns = turnsOf(view.combat, duration.of);
      if (turns === null) {
        return err('not_in_combat', `${duration.of} is not in this combat`);
      }

      const theirTurn = view.combat.order[view.combat.turnIndex]?.id === duration.of;

      if (duration.kind === 'start-of-next-turn') {
        // `begun` already counts the turn in progress, so the next start is
        // one more either way.
        return ok({ kind: 'turn-start', of: duration.of, count: turns.begun + 1 });
      }

      // `ended` does *not* count the turn in progress. Said on the anchor's own
      // turn, "your next turn" is the one after this, so its end is two away;
      // said on anybody else's, the upcoming turn is the next one and its end
      // is one away. This asymmetry is the whole reason the constructors exist
      // rather than callers writing counts.
      return ok({ kind: 'turn-end', of: duration.of, count: turns.ended + (theirTurn ? 2 : 1) });
    }

    case 'end-of-current-turn': {
      if (view.combat === null) {
        return err('no_turns', 'there are no turns outside combat to anchor a duration to');
      }

      // The anchor is whoever is taking the turn, which is what makes this a
      // different member rather than `end-of-next-turn` said of them: `ended`
      // does not count the turn in progress, so its end is always exactly one
      // away — never the two that "your next turn" comes to on your own turn.
      const holder = view.combat.order[view.combat.turnIndex];
      const turns = holder === undefined ? null : turnsOf(view.combat, holder.id);
      if (holder === undefined || turns === null) {
        // Not reachable through any command: `turnCounts` is kept in exact step
        // with `order` by every operation that changes either. It is a value
        // rather than a throw because this function's contract is to hand back
        // a refusal, and it is `not_in_combat` because a caller branching on a
        // turn-anchored duration's refusals should not need a third code to
        // learn the same thing — there is no turn here to anchor to.
        return err('not_in_combat', 'this combat holds no turn in progress to end');
      }

      return ok({ kind: 'turn-end', of: holder.id, count: turns.ended + 1 });
    }
  }
}

/** Whether a deadline has arrived. */
export function hasExpired(view: TimeView, deadline: Deadline): boolean {
  switch (deadline.kind) {
    case 'indefinite':
      return false;
    case 'elapsed':
      return view.elapsed >= deadline.at;
    case 'turn-start':
    case 'turn-end': {
      const turns = turnsOf(view.combat, deadline.of);
      // Turn-anchored timing is combat-scoped. With the fight over or the
      // anchor gone there is no moment left for the effect to end at, and an
      // effect that can never expire is worse than one that ends with the
      // fight.
      if (turns === null) return true;
      return deadline.kind === 'turn-start'
        ? turns.begun >= deadline.count
        : turns.ended >= deadline.count;
    }
  }
}

/** What an expiring timer ends. */
export type EffectTarget =
  /** One condition instance on one creature, by its deterministic id. */
  | { readonly kind: 'condition'; readonly on: CharacterId; readonly instance: string }
  /** A whole casting, and everything it created. */
  | { readonly kind: 'casting'; readonly castingId: string }
  /**
   * A feature a creature turned on and is still in.
   *
   * SRD Rage: "The Rage lasts until the end of your next turn" — a deadline
   * like any other, on a thing that is neither a condition nor a casting.
   */
  | { readonly kind: 'feature'; readonly on: CharacterId; readonly feature: string }
  /**
   * Every grant one source made on one creature.
   *
   * The operation already existed — `releaseOnTarget` performs it by casting —
   * and what was missing was a *deadline* on it. Nothing ended a grant before
   * the thing that made it ended, which is why `ModifierRider` carries no
   * `lasts` and why SRD Superior Hunter's Defense ("Resistance to that damage
   * ... until the end of the current turn") had nowhere to be written.
   *
   * **`source` rather than a casting id**, so a feature and a casting use the
   * same member. A casting's grants carry `Stoneskin#cast:3`; a feature's
   * carry the feature's own id, and neither needs a member of its own.
   *
   * **One member rather than one per grant kind.** A per-kind member would
   * need a per-kind identity here — `rollModifierKey` against a bare `source`,
   * which are not the same string — and would be four ways to write one
   * sentence. What ends is *what that source granted*, which is one question
   * however many of the four answers it.
   */
  | { readonly kind: 'grants'; readonly on: CharacterId; readonly source: string };

/**
 * A saving throw an effect gets at a turn boundary.
 *
 * SRD Hold Person: "At the end of each of its turns, the target repeats the
 * save, ending the spell on itself on a success." Effects like that are
 * everywhere — held, restrained, charmed, dominated — and they all have the
 * same shape: a moment, a save, and something that happens when it lands.
 *
 * Everything the resolution needs lives here rather than in the caller's head,
 * because the point of the hook is that nobody has to remember it: the turn
 * knows what it owes.
 */
export interface RepeatSave {
  /** Which boundary it fires on. */
  readonly at: 'start-of-turn' | 'end-of-turn';
  /** Whose turn. Usually the held creature's own, but the SRD does vary it. */
  readonly of: CharacterId;
  readonly ability: Ability;
  readonly dc: number;
  /**
   * What a success does.
   *
   * `end-on-target` is Hold Person's "ending the spell **on itself**" — the
   * casting carries on for anyone else it caught. `end-casting` is for effects
   * that end outright when anyone shakes them off.
   */
  readonly onSuccess: 'end-on-target' | 'end-casting';
  /** How the roll reads in the log. */
  readonly label: string;
}

/**
 * An ability check a creature may attempt against an ongoing effect.
 *
 * The SRD writes this shape twenty times and it is **not** the repeat save
 * above it, however similar the words look. A repeat save is an *obligation*
 * the turn boundary raises whether anybody remembers it or not; this is an
 * *opportunity* somebody takes when the fiction says they did. Nothing raises
 * it, nothing owes it, and no turn is blocked waiting for it — which is
 * precisely why it needs no pending-debt machinery of its own.
 *
 * | | Repeat save | This |
 * |---|---|---|
 * | Who decides it happens | the turn boundary | the table |
 * | If forgotten | the turn refuses to advance | nothing; it was never owed |
 * | What it costs | nothing | the Action, in combat |
 *
 * **The DC is written down when the effect is created, not derived later.**
 * Same rule as {@link RepeatSave.dc}, and for a sharper reason here: the check
 * can be attempted an hour after the casting, by which time the caster may
 * have gained a level, changed which grant supplies the spell, or left the
 * game entirely. The number the spell was cast at is the number it is escaped
 * at.
 *
 * Who may attempt it is **derived from what the timer is on**, not stated: an
 * effect on a creature is that creature's to shake off, and a casting with no
 * victim — an illusion — is anybody's to see through. SRD Ensnaring Strike is
 * the one exception ("the target **or a creature within reach of it**"), and a
 * field with one user is a guess dressed as a structure; it waits for a
 * second.
 */
export interface EffectCheck {
  readonly ability: Ability;
  /** The skill applied, when the SRD names one: "Strength (Athletics)". */
  readonly skill?: Skill;
  readonly dc: number;
  /**
   * What a success does.
   *
   * `none` is the illusion case, and it is a real answer rather than a stub:
   * SRD Minor Illusion's successful Study "determines that it is an illusion"
   * and changes nothing the engine holds. The number is still the engine's —
   * the examiner's Investigation, their Expertise, their conditions, against
   * the caster's own save DC — and the knowledge is the table's.
   *
   * `end-on-target` is Black Tentacles' "ending the condition on itself on a
   * success", which is the same release the repeat save already performs.
   *
   * There is deliberately no `end-casting`: SRD writes it (Maze, Phantasmal
   * Force, Detect Thoughts) and every one of those spells is blocked on
   * something else, so it would be a value nothing could be written with.
   */
  readonly onSuccess: 'none' | 'end-on-target';
  /** How the roll reads in the log. */
  readonly label: string;
}

export interface TimedEffect {
  readonly target: EffectTarget;
  readonly deadline: Deadline;
  /** A save this effect takes at a turn boundary, if it takes one. */
  readonly repeatSave?: RepeatSave;
  /** A check a creature may attempt against it, if the spell offers one. */
  readonly check?: EffectCheck;
}

/**
 * Who may attempt a check, derived from what the effect is on.
 *
 * An effect sitting on a creature is that creature's to shake off; a casting
 * with no victim — an illusion standing in a corridor — is anybody's to see
 * through. Derived rather than declared because every SRD spell the engine can
 * currently offer a check for reads this way, and a field with one exception
 * is a guess dressed as a structure.
 */
export const mayAttempt = (timer: TimedEffect, who: CharacterId): boolean =>
  timer.target.kind !== 'condition' || timer.target.on === who;

/**
 * A save a turn boundary raised and nobody has rolled yet.
 *
 * Persisted in state rather than handed back in a return value, which is the
 * whole difference between this and the pending Concentration save that had to
 * be torn out: that one lived only in the caller's hands and vanished on a
 * reload. This is derived from `turn-advanced` by the fold, so it survives
 * anything the log survives — and the engine refuses to advance another turn
 * while one is outstanding, so forgetting it stops the game rather than
 * quietly losing a rule.
 */
export interface PendingSave {
  /** The timer this belongs to, which is also how it is keyed. */
  readonly effectKey: string;
  readonly target: CharacterId;
  readonly castingId: string;
  readonly ability: Ability;
  readonly dc: number;
  readonly onSuccess: 'end-on-target' | 'end-casting';
  readonly label: string;
  /** The turn it was raised on. Part of the key, so one turn raises it once. */
  readonly turn: number;
}

/**
 * Damage a spell promised and a later moment collects.
 *
 * SRD Acid Arrow: "the target takes 4d4 Acid damage **and 2d4 Acid damage at
 * the end of its next turn**." Nothing about the target changes in between —
 * no condition, no bonus, nothing an effect could be hung on — so this is
 * neither a timer nor a repeat save. It is a debt with a due date.
 *
 * **The dice are a notation, not a number.** Rolling at cast time and storing
 * the total would put a number in the log before the moment that produced it,
 * and would let a player learn the second hit early. Randomness enters the log
 * once, at the point of the roll, and the roll is at the boundary.
 *
 * Deliberately *not* a {@link TimedEffect}: a timer's deadline says when
 * something **stops**, and `hasExpired` answers true for an anchor who has
 * left the fight precisely so that nothing runs forever. Reading that same
 * answer as "collect the damage" would fire the acid the instant the last
 * enemy dropped. Same deadline type, opposite policy at the edge — see
 * {@link isDue}.
 */
export interface ScheduledDamage {
  readonly target: CharacterId;
  /**
   * The caster who promised it.
   *
   * Acid Arrow's second hit is still the wizard's doing, arriving a turn late,
   * so it names its dealer like any other damage — and can be answered.
   */
  readonly by: CharacterId;
  /** When it falls due. Always the end of the target's next turn, so far. */
  readonly deadline: Deadline;
  /** Rolled when the moment arrives, never before. */
  readonly notation: string;
  readonly damageType: string;
  /** `Acid Arrow#cast:3` — the casting that promised it. */
  readonly source: string;
  /** How the roll reads in the log. */
  readonly label: string;
}

/**
 * The key a schedule is filed under.
 *
 * By casting and target, so two Acid Arrows at one goblin each keep their own
 * debt, and folding the same log twice produces one of each rather than two.
 */
export const scheduledDamageKey = (source: string, target: CharacterId): string =>
  `${source}|${target}`;

/**
 * What a payout at a turn boundary hands over.
 *
 * Three members, and the adjudication map's own evidence is why there are three
 * rather than one: Heroism pays Temporary Hit Points, Regenerate pays Hit
 * Points, and Phantasmal Force deals damage — all three at a turn boundary, all
 * three with no save and no area. The engine already had one route to each
 * (`grantTemporaryHpTo`, `healCreature`, `dealSpellDamage`) and no schedule to
 * reach them on, which is the gap rather than three missing mechanisms.
 *
 * Spelled out rather than borrowed from the effect kinds that share the words:
 * `temp-hp` and `heal` are *effects*, with their own scaling and their own
 * riders, and a payout reusing those names would read as one of them repeated.
 *
 * Declared here rather than in `spell-definitions.ts` because the *record* is
 * what the fold and the boundary read, and the definitions module already
 * depends on this one — the reverse edge would be a cycle that survives only
 * because a type is erased.
 */
export type PayoutKind = 'temporary-hit-points' | 'healing' | 'damage';

/**
 * What a running casting hands a creature at every one of its turn boundaries.
 *
 * SRD Heroism: "gains Temporary Hit Points equal to your spellcasting ability
 * modifier **at the start of each of its turns**." The neighbour above is the
 * shape this is most easily confused with, and the difference is the whole
 * reason it is a separate record:
 *
 * | | {@link ScheduledDamage} | This |
 * |---|---|---|
 * | How often | once, at one named moment | every turn, until the casting ends |
 * | Where it lives | `state.scheduledDamage`, keyed by casting and target | on the creature, as the eighth sourced grant |
 * | What ends it | collecting it | the casting ending, by any of its doors |
 * | What it can be | damage | damage, healing or Temporary Hit Points |
 *
 * So a debt with a due date is filed and discharged, and this is a standing
 * arrangement that is *read* at each boundary and never filed at all. That is
 * what keeps a payout out of the pending-debt machinery: nothing can be owed
 * between turns, because the arrangement is the fact and the boundary is the
 * only thing that reads it.
 *
 * **Every number here was pinned at the cast** — {@link flat} already carries
 * the caster's spellcasting modifier, resolved against the sheet they cast
 * with — for the reason `CastingNumbers` is pinned: a spell already cast does
 * not change when its caster does, and the fold opens no catalogue.
 *
 * **{@link dice} is a notation and not a total**, exactly as a scheduled hit's
 * is: a payout that repeats throws its die at each boundary, and rolling once
 * at the cast would put the number in the log before the moment that produced
 * it.
 */
export interface GrantedPayout {
  /** The casting (`Heroism#cast:3`) that promised it. */
  readonly source: string;
  /** The recipient's own boundary — never the caster's. */
  readonly at: 'start-of-turn' | 'end-of-turn';
  readonly payout: PayoutKind;
  /** Rolled when the boundary arrives, never before. Absent when none is printed. */
  readonly dice?: string;
  /** The printed number plus the spellcasting modifier, resolved at the cast. */
  readonly flat: number;
  /** Present exactly when {@link payout} is `damage`. */
  readonly damageType?: string;
}


/**
 * Whether a scheduled hit is due **now**.
 *
 * The difference from {@link hasExpired} is the whole reason this exists. That
 * function answers "is there no moment left for this to end at", and returns
 * true when the fight is over or the anchor has gone — which is right for an
 * effect that must not outlive the fight, and exactly wrong for a debt, which
 * would then be collected at the moment it should have been forgiven.
 *
 * So a schedule whose anchor is no longer taking turns is never due. Dropping
 * it is a separate pass, and dropping is what happens to it.
 */
export function isDue(view: TimeView, deadline: Deadline): boolean {
  switch (deadline.kind) {
    case 'indefinite':
      return false;
    case 'elapsed':
      return view.elapsed >= deadline.at;
    case 'turn-start':
    case 'turn-end': {
      const turns = turnsOf(view.combat, deadline.of);
      if (turns === null) return false;
      return deadline.kind === 'turn-start'
        ? turns.begun >= deadline.count
        : turns.ended >= deadline.count;
    }
  }
}

/** One pending save can exist per effect per turn, and no more. */
export const pendingSaveKey = (effectKey: string, turn: number): string =>
  `${effectKey}@${turn}`;

/**
 * The key a timer is filed under.
 *
 * Derived from the target rather than a counter, so re-applying the same
 * effect from the same source *replaces* its deadline instead of leaving a
 * stale one behind to end it early.
 */
export function timerKey(target: EffectTarget): string {
  switch (target.kind) {
    case 'condition':
      return `condition|${target.on}|${target.instance}`;
    case 'feature':
      return `feature|${target.on}|${target.feature}`;
    case 'grants':
      return `grants|${target.on}|${target.source}`;
    default:
      return `casting|${target.castingId}`;
  }
}
