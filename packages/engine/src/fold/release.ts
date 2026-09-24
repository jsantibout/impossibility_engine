/**
 * What a casting is on, what it hung there, and taking both away.
 *
 * `releaseCasting` is the single door every ending converges on — Concentration
 * broken, a deadline arrived, a dispel, the caster leaving — and
 * `releaseOnTarget` is the same operation narrowed to one creature, which is
 * the whole of Dispel Magic's "one creature, object, or magical effect"
 * distinction. Beneath them is the grant enumerator: `grantsOf`,
 * `grantSourcesOf` and `withoutGrants`, the one walk over the eighteen sourced
 * grant families that five call sites used to make by hand.
 *
 * `spellOn` and `withoutTarget` are here for the same reason as each other:
 * they are the two directions of being *on* a creature. `spellOn` is the one
 * answer to "who is this casting on now" — `OngoingSpell.aimed` unioned with
 * whoever the casting is holding something on, which is the rule
 * `holdsNothingOf` states — and `withoutTarget` is the only thing that edits
 * the stored half. Reading that rule in one module is what keeps the four
 * readers of it agreeing.
 *
 * It is the bottom of the fold's own graph — it calls nothing else in `fold/`,
 * and expiry, the triggered endings, the grants seam and the switch all call
 * it. The grants seam is the newest and the shortest: `roll-modifier-consumed`
 * is `releaseGrants` reached by a die rather than by the clock.
 */
import type { CharacterId } from '@ie/shared';
import { removeConditionInstance } from '../conditions.js';
import { settleToGround } from '../positioning.js';
import { type EffectTarget, type ScheduledDamage, type TimedEffect } from '../timers.js';
import { castingIdOf, castingNumber, type AreaTriggerStamp, type OngoingSpell } from '../spells.js';

import type { CreatureState, GameState, PendingCasting } from '../state.js';

/**
 * A grant a running effect hung on a creature, read only for what hung it.
 *
 * The eighteen families below all carry more than this — a `Bonus`, a base Armour
 * Class, a `RollModifier`, a list of damage types, a change to a Speed, a die
 * on later attacks, a list of condition names, a payout at a turn boundary, a
 * rule about what a turn may be spent on —
 * and
 * every operation that *ends* one reads nothing but the `source`. So this is
 * the shape the enumerator works in, and it is deliberately the smallest one
 * that answers the question.
 */
interface SourcedGrant {
  readonly source: string;
}

/**
 * The keys of `CreatureState` holding grants a running effect hung there.
 *
 * **Derived from the shape rather than listed.** `bonuses`, `armorClasses`,
 * `rollModifiers` and `grantedDefenses` were enumerated by hand in five
 * separate places — `releaseCasting`, `releaseOnTarget`, `releaseGrants`,
 * `expireEffects` and `holdsNothingOf` — and the fourth of them had to be
 * threaded through every one when it arrived. A fifth added to three of the
 * five is how a grant comes to be released by a dispel and not by a deadline,
 * silently, because each site is correct on its own terms. Deriving the set
 * means a fifth family joins it on the day it is declared, and {@link grantsOf}
 * then stops compiling until the enumerator names it.
 *
 * `initiativeBonuses` matches the shape and is excluded, because it is not a
 * grant: creation derives it from the character's own feats, nothing hangs it
 * on them, and no casting, deadline or dispel takes it away. It was in none of
 * the five walks, and putting it in one would end a feat the rules never ended.
 */
type GrantFamily = Exclude<
  {
    [K in keyof CreatureState]-?: CreatureState[K] extends readonly SourcedGrant[] ? K : never;
  }[keyof CreatureState],
  'initiativeBonuses'
>;

/** What a creature is carrying, by family. */
type HeldGrants = { readonly [K in GrantFamily]: readonly SourcedGrant[] };

/**
 * The eighteen families as one value, and the only place the list is written.
 *
 * The annotation is a mapped type over {@link GrantFamily}, so a family
 * declared on `CreatureState` makes **this literal** a compile error naming the
 * property it lacks. That is the guard: the enumerator cannot quietly stop
 * seeing a family, and there is nowhere else for a hand-kept list to rot. It
 * has fired ten times now — for `speedModifiers`, for `attackRiders`, for
 * `weaponRiders`, for
 * `grantedConditionImmunities`, for `lineImmunities`, for `payouts`, for `actionRules`, for
 * `grantedReactions`, for `healingRules`, for `hitPointMaxima`, for
 * `deniedBenefits` and for `damageReductions` — and each time the whole of the
 * plumbing was the one line
 * the compiler insisted on, which is what the guard was built to buy. Each of
 * the last several named two sites in the whole engine: this literal, and the
 * empty list `creature-added` starts a creature with.
 *
 * Nothing is copied — each value is the creature's own array.
 */
const grantsOf = (creature: CreatureState): HeldGrants => ({
  bonuses: creature.bonuses,
  armorClasses: creature.armorClasses,
  rollModifiers: creature.rollModifiers,
  grantedDefenses: creature.grantedDefenses,
  speedModifiers: creature.speedModifiers,
  senseModifiers: creature.senseModifiers,
  damageReductions: creature.damageReductions,
  fallWards: creature.fallWards,
  lifts: creature.lifts,
  jumpAllowances: creature.jumpAllowances,
  attackRiders: creature.attackRiders,
  weaponRiders: creature.weaponRiders,
  grantedConditionImmunities: creature.grantedConditionImmunities,
  lineImmunities: creature.lineImmunities,
  payouts: creature.payouts,
  actionRules: creature.actionRules,
  grantedReactions: creature.grantedReactions,
  healingRules: creature.healingRules,
  hitPointMaxima: creature.hitPointMaxima,
  deniedBenefits: creature.deniedBenefits,
  passiveDefenses: creature.passiveDefenses,
});

/** How many grants are in a record of families, which a `filter` can only lower. */
const countGrants = (held: Record<string, readonly SourcedGrant[]>): number =>
  Object.values(held).reduce((n, family) => n + family.length, 0);

/**
 * Every source that has hung a grant on this creature.
 *
 * One enumerator over the eighteen families — the bonuses Bless adds, the Armour
 * Class Mage Armor supplies, the Advantage Blur grants, the Resistance
 * Stoneskin grants, the ten feet Longstrider adds, the die Divine Favor hangs
 * on later attacks, the d8 Shillelagh puts in a Quarterstaff, the Charmed Mind
 * Blank refuses, the Temporary Hit Points Heroism pays each turn, the Action
 * Stinking Cloud forbids, the die a Bard put in somebody's hand — so a reader
 * asking "is this casting still holding anything here" asks it once rather
 * than eighteen times.
 *
 * **Sorted and deduplicated**, so the answer is fixed however the families are
 * visited and whatever order the grants arrived in; serialised state reaches
 * the log. One casting commonly grants in several families at once, and every
 * caller is asking whether a source granted anything rather than counting.
 * Beacon of Hope's two roll modifiers come back as one source for the same
 * reason: `rollModifierKey`'s two-part identity decides whether a **re-grant**
 * replaces or stacks, and it is not what an ending matches on — a casting that
 * ends, or a `grants` deadline that arrives, takes both of them.
 *
 * **`scheduledDamage` is not a grant and is deliberately not here.** A hit
 * that is still owed is the casting's debt rather than something the casting
 * is *doing* to the creature — the same reading that keeps a creature Insect
 * Plague merely damaged off {@link spellOn}'s answer. It is not even
 * per-creature: `releaseCasting` drops it through `withoutScheduledDamage`, at
 * state level.
 * Nor are the creature's conditions, which are a link of their own with their
 * own instances and implications; {@link holdsNothingOf} asks them separately.
 */
export function grantSourcesOf(creature: CreatureState): readonly string[] {
  const sources = new Set<string>();
  for (const family of Object.values(grantsOf(creature))) {
    for (const grant of family) sources.add(grant.source);
  }
  return [...sources].sort();
}

/**
 * Every grant whose source the predicate names, taken off all eighteen families.
 *
 * The one removal. The three callers differ only in which sources they name —
 * `releaseCasting` and `releaseOnTarget` match the casting id inside the
 * source, `releaseGrants` matches the bare source a feature's deadline carries
 * — so the predicate is the whole of what varies and the walk is shared.
 *
 * **The creature itself comes back when nothing matched**, by reference, which
 * is load-bearing rather than an optimisation: `releaseCasting` compares
 * identity to decide whether a derived pass touched anybody, and a fresh object
 * every time would mark the whole cast changed on every event.
 */
export function withoutGrants(
  creature: CreatureState,
  doomed: (source: string) => boolean,
): CreatureState {
  const held = grantsOf(creature);
  const kept: Record<string, readonly SourcedGrant[]> = {};
  for (const [family, grants] of Object.entries(held)) {
    kept[family] = grants.filter((grant) => !doomed(grant.source));
  }

  // `filter` only ever removes, so an unchanged total is an unchanged creature.
  if (countGrants(kept) === countGrants(held)) return creature;

  // The cast is sound by construction rather than by assertion: the keys came
  // out of {@link grantsOf}, whose type *is* `GrantFamily`, and `filter`
  // returns the element type it was given. What it buys is that
  // {@link grantsOf} is the **only** list of families — writing the four out
  // again here would be a second place a fifth family has to be added, which is
  // the failure this whole enumerator exists to end, arriving one level up.
  return { ...creature, ...(kept as Pick<CreatureState, GrantFamily>) };
}

/**
 * End a casting: drop the caster's Concentration and every effect that casting
 * created, wherever it landed.
 *
 * The link is the casting id carried in each effect's source, so this removes
 * exactly one Cleric's Hold Person and leaves the other Cleric's standing —
 * and leaves alone anything the casting did not create.
 */
export function releaseCasting(
  state: GameState,
  casterId: CharacterId | null,
  castingId: string,
): GameState {
  const creatures: Record<string, CreatureState> = {};
  let changed = false;
  let scene = state.scene;

  for (const key of Object.keys(state.creatures)) {
    const creature = state.creatures[key];
    if (creature === undefined) continue;

    let updated = creature;

    // **The one grant whose release the book gives a consequence to.** SRD
    // *Levitate*: "When the spell ends, the target floats gently to the ground
    // if it is still aloft." Read *before* the grant goes, because the grant is
    // the whole of what says this casting is what was holding them up.
    //
    // Derived and written nowhere, exactly as the endings around it are: a
    // deadline arriving is nobody's decision, and a `creature-moved` the fold
    // invented would be an event no command issued. `landsWhenReleased` is the
    // one reader of the rule, so the two doors out of a casting cannot come to
    // disagree about who is set down.
    if (scene !== null && landsWhenReleased(creature, (source) => castingIdOf(source) === castingId)) {
      scene = settleToGround(scene, creature.id);
    }

    const doomed = creature.conditions.instances.filter(
      (instance) => castingIdOf(instance.source) === castingId,
    );
    if (doomed.length > 0) {
      let conditions = creature.conditions;
      for (const instance of doomed) conditions = removeConditionInstance(conditions, instance.id);
      updated = { ...updated, conditions };
    }

    // And every grant the casting hung here, through the one enumerator: the
    // bonus Bless adds, the Armour Class Mage Armor supplies, the Advantage
    // Blur grants, the Resistance Stoneskin grants. Same link, same door —
    // Bless stopping when the Cleric's Concentration breaks is not a separate
    // rule from any of the other three, and a convergence point that forgot
    // one kind of debt is the hole `releaseOnTarget`’s bonuses were. Naming
    // them one at a time here is how a fifth would come to be forgotten.
    updated = withoutGrants(updated, (source) => castingIdOf(source) === castingId);

    if (key === casterId && updated.concentration?.castingId === castingId) {
      updated = { ...updated, concentration: null };
    }

    if (updated !== creature) changed = true;
    creatures[key] = updated;
  }

  // A casting that ends early takes its own deadlines with it, or a stale timer
  // would sit waiting to end a spell that is already over. Every per-target
  // hook it placed goes too.
  const timers: Record<string, TimedEffect> = {};
  for (const [key, timer] of Object.entries(state.timers)) {
    const owned =
      (timer.target.kind === 'casting' && timer.target.castingId === castingId) ||
      (timer.target.kind === 'condition' &&
        castingIdOf(`${timer.target.instance}`) === castingId) ||
      // A deadline the casting put on its own grant. The grant has just gone;
      // a timer left waiting to end it is the stale timer this loop exists for.
      (timer.target.kind === 'grants' && castingIdOf(timer.target.source) === castingId);
    if (owned) {
      changed = true;
      continue;
    }
    timers[key] = timer;
  }

  // A hit the casting promised for a later moment goes with it. No ongoing
  // casting schedules one yet — both delayed-damage spells are Instantaneous —
  // but the schedule already names its casting, and a convergence point that
  // forgot one kind of debt is the hole `releaseOnTarget`'s bonuses were.
  const scheduledDamage = withoutScheduledDamage(state, castingId, null).scheduledDamage;
  if (scheduledDamage !== state.scheduledDamage) changed = true;

  // And the live record goes with them. **This is the one place it is removed**
  // — whether the casting ended because Concentration broke, because its
  // deadline arrived, or because somebody dispelled it — so there is exactly
  // one answer to "is this spell still running", and no route by which a
  // finished spell stays queryable.
  let ongoing: Readonly<Record<string, OngoingSpell>> = state.ongoing;
  let castingsEnded = state.castingsEnded;
  if (ongoing[castingId] !== undefined) {
    const rest: Record<string, OngoingSpell> = { ...ongoing };
    delete rest[castingId];
    ongoing = rest;
    // And the door records who went through it, so a later `spell-ongoing`
    // naming the same casting is a corrupt log rather than a resurrection.
    // Only here: a `releaseCasting` for a casting that never had a record is
    // not an ending, and marking one would refuse the record its own batch is
    // still about to write.
    castingsEnded = [...castingsEnded, castingId].sort(
      (a, b) => castingNumber(a) - castingNumber(b),
    );
    changed = true;
  }

  // An effect the area owed and the record of who it had already caught this
  // turn. Both belong to the casting and neither outlives it: a debt against a
  // Web that has been dispelled is one nothing could settle, and the turn
  // would refuse to advance past it for ever.
  const owedAreaEffects = state.owedAreaEffects.filter((owed) => owed.castingId !== castingId);
  if (owedAreaEffects.length !== state.owedAreaEffects.length) changed = true;

  const areaTriggers: Record<string, AreaTriggerStamp> = {};
  for (const [key, stamp] of Object.entries(state.areaTriggers)) {
    if (key.startsWith(`${castingId}|`)) {
      changed = true;
      continue;
    }
    areaTriggers[key] = stamp;
  }

  // And a casting that has not taken effect yet. SRD "Longer Casting Times":
  // "If your Concentration is broken, the spell fails, but you don't expend a
  // spell slot." A casting of a minute or more is concentrated on from the
  // moment it begins, so every route by which Concentration ends — damage, a
  // dismissal, the derived Incapacitated pass, a second Concentration spell —
  // arrives here, and the pending record has to go with it or the window would
  // outlive the thing holding it open. Nothing is refunded, because the slot
  // was never taken: the same asymmetry `spell-interrupted` already writes.
  //
  // **The single door stays single.** An ordinary casting's caster is not
  // concentrating on its pending id — Concentration starts at settlement — so
  // no other route reaches this with a pending casting's id in hand.
  //
  // **And it addresses one casting id**, which is the whole of what the keyed
  // record changed here: a caster may have two castings open, and the one that
  // ends is the one this call names. Deleting by key preserves the order of
  // whatever is left, so the record stays in casting-number order.
  let pendingCastings = state.pendingCastings;
  if (pendingCastings[castingId] !== undefined) {
    pendingCastings = withoutPendingCasting(state, castingId);
    changed = true;
  }

  if (scene !== state.scene) changed = true;

  return changed
    ? {
        ...state,
        creatures,
        timers,
        ongoing,
        castingsEnded,
        scheduledDamage,
        owedAreaEffects,
        areaTriggers,
        pendingCastings,
        scene,
      }
    : state;
}

/**
 * Whether ending what the predicate names leaves this creature with nothing
 * holding it up.
 *
 * SRD *Levitate*'s "if it is still aloft", asked as the only question the fold
 * can answer about it: the lattice holds a height and the creature holds the
 * list of castings suspending it, and the landing happens when the **last** of
 * them lets go. Two Levitates on one creature is not a contradiction and the
 * first ending must not drop it — which is the whole reason `lifts` is a list
 * like every other grant family rather than a single hold.
 *
 * A creature the casting never lifted answers `false` and is left where it is,
 * so a Bless ending does not set down a flier, and a Fly Speed is not this
 * rule's business at all: nothing granted it through this door, nothing here
 * takes it away, and a creature flying under its own power is still flying.
 */
function landsWhenReleased(
  creature: CreatureState,
  doomed: (source: string) => boolean,
): boolean {
  const held = creature.lifts;
  return held.some((lift) => doomed(lift.source)) && held.every((lift) => doomed(lift.source));
}

/**
 * Add a declared casting, keeping the record in casting-number order.
 *
 * Ids run in sequence and a declaration always allocates the next one, so
 * insertion order *is* casting-number order today. The sort is what makes that
 * structural rather than lucky: the record serialises, and a key order that
 * followed the accidents of declaration would be a fold that is not a pure
 * function of the log's content. `castingsEnded` is sorted for the same reason
 * and by the same comparison.
 */
export function withPendingCasting(
  pending: Readonly<Record<string, PendingCasting>>,
  casting: PendingCasting,
): Readonly<Record<string, PendingCasting>> {
  const next: Record<string, PendingCasting> = {};
  for (const key of [...Object.keys(pending), casting.castingId].sort(
    (a, b) => castingNumber(a) - castingNumber(b),
  )) {
    next[key] = key === casting.castingId ? casting : pending[key]!;
  }
  return next;
}

/**
 * Drop one declared casting, leaving the rest in the order they were in.
 *
 * The settling `spell-cast` closes exactly the window its own id names, and
 * `releaseCasting` takes the one it was called for; the other castings a
 * caster or anybody else has open are none of either's business. **One
 * spelling, two callers**: the removal was written out inline in both, which
 * is two answers to one question in a single file.
 */
export function withoutPendingCasting(
  state: GameState,
  castingId: string,
): Readonly<Record<string, PendingCasting>> {
  const rest: Record<string, PendingCasting> = { ...state.pendingCastings };
  delete rest[castingId];
  return rest;
}

/**
 * Drop the hits a casting promised for later — all of them, or one creature's.
 *
 * The schedule's source carries the casting id exactly as a condition's does,
 * so ending a casting can find what it owes without a second index. Returns
 * the state it was given when nothing matched, so callers can tell.
 */
function withoutScheduledDamage(
  state: GameState,
  castingId: string,
  targetId: CharacterId | null,
): GameState {
  let scheduled: Record<string, ScheduledDamage> | null = null;

  for (const [key, hit] of Object.entries(state.scheduledDamage)) {
    if (castingIdOf(hit.source) !== castingId) continue;
    if (targetId !== null && hit.target !== targetId) continue;
    scheduled ??= { ...state.scheduledDamage };
    delete scheduled[key];
  }

  return scheduled === null ? state : { ...state, scheduledDamage: scheduled };
}

/**
 * Take a creature off an ongoing spell without ending the spell.
 *
 * Two things do this and they are the same thing: a target shaking the spell
 * off, and a target leaving the game. Either way the casting carries on for
 * whoever is left, and it has to stop being **aimed** at somebody it no longer
 * covers.
 *
 * **It edits the stored half, and that is the whole of why it is kept.** The
 * derived half needs no help: a Bless released on one creature loses its bonus
 * there in the same breath, so `spellOn` stops naming them without being told.
 * A tracked spell holds nothing anywhere — a dispelled Darkvision has no grant
 * to lose — so `aimed` is the only place it is recorded and this is the only
 * thing that can take it off. Without it, a dispel on one creature would leave
 * the casting aimed at them for ever.
 */
export function withoutTarget(
  state: GameState,
  targetId: CharacterId,
  castingId: string | null,
): GameState {
  let ongoing: Record<string, OngoingSpell> | null = null;

  for (const [key, record] of Object.entries(state.ongoing)) {
    if (castingId !== null && key !== castingId) continue;
    if (!record.aimed.includes(targetId)) continue;
    ongoing ??= { ...state.ongoing };
    ongoing[key] = { ...record, aimed: record.aimed.filter((who) => who !== targetId) };
  }

  return ongoing === null ? state : { ...state, ongoing };
}

/** Who is concentrating on a casting, if anybody still is. */
export const casterOf = (state: GameState, castingId: string): CharacterId | null =>
  Object.values(state.creatures).find((c) => c.concentration?.castingId === castingId)?.id ?? null;

/**
 * End one casting's effect on one creature, leaving the casting running.
 *
 * SRD Hold Person: a successful repeat save ends the spell "on itself". The
 * casting carries on for anyone else it caught, and the caster keeps
 * concentrating, because the spell is still doing something.
 */
export function releaseOnTarget(
  state: GameState,
  targetId: CharacterId,
  castingId: string,
): GameState {
  const creature = state.creatures[targetId];
  if (creature === undefined) return state;

  // The live record loses this creature whatever else changes — a tracked
  // spell like Darkvision is *on* somebody and hangs nothing on them, so the
  // condition-and-bonus test below would say there was nothing to release.
  const base = withoutScheduledDamage(
    withoutTarget(state, targetId, castingId),
    castingId,
    targetId,
  );

  const doomed = creature.conditions.instances.filter(
    (instance) => castingIdOf(instance.source) === castingId,
  );
  // And every grant this casting hung on this creature, through the one
  // enumerator: a Mage Armor dispelled on one creature stops being that
  // creature’s calculation, a Dispel Magic aimed at one blurred creature stops
  // attacks against *that* creature being made at Disadvantage, and a
  // Stoneskin dispelled on one fighter stops halving *their* damage — each
  // leaving the rest of the casting alone. The enumerator returns the creature
  // itself when the casting held nothing here, which is what says so.
  const released = withoutGrants(creature, (source) => castingIdOf(source) === castingId);
  if (doomed.length === 0 && released === creature) {
    return base;
  }

  let conditions = creature.conditions;
  for (const instance of doomed) conditions = removeConditionInstance(conditions, instance.id);

  // Every timer this casting hung on this creature goes with it, so no later
  // turn raises a hook for an effect that has ended. Filtering rather than
  // rebuilding one key: `doomed` includes the conditions the effect *implied*,
  // and those sort ahead of it — `incapacitated:...` before `paralyzed:...` —
  // so guessing from the first entry pointed at the wrong timer and left the
  // real one running.
  const timers: Record<string, TimedEffect> = {};
  for (const [key, timer] of Object.entries(base.timers)) {
    const mine =
      (timer.target.kind === 'condition' &&
        timer.target.on === targetId &&
        castingIdOf(timer.target.instance) === castingId) ||
      // The deadline this casting put on its own grant on *this* creature. The
      // grant is going below; the timer that was going to end it goes too.
      (timer.target.kind === 'grants' &&
        timer.target.on === targetId &&
        castingIdOf(timer.target.source) === castingId);
    if (!mine) timers[key] = timer;
  }

  // **And the same landing the other door performs**, asked of the one
  // creature this call is about. SRD *Levitate*'s "When the spell ends, the
  // target floats gently to the ground" is as true of a Dispel Magic aimed at
  // the levitating creature as it is of the deadline running out, and a door
  // that lifted the grant without setting the creature down would leave it
  // hanging in the air with nothing holding it there. Read before the grant
  // goes, for the reason `releaseCasting` reads it before the grant goes.
  const scene =
    base.scene !== null && landsWhenReleased(creature, (source) => castingIdOf(source) === castingId)
      ? settleToGround(base.scene, targetId)
      : base.scene;

  return {
    ...base,
    timers,
    ...(scene === base.scene ? {} : { scene }),
    // **The grants go too.** The bonuses were computed and then dropped on the
    // floor here from the day this function was written, and nothing noticed
    // because every spell that released on one target hung a *condition* —
    // Hold Person, Black Tentacles. Dispel Magic is the first thing to release
    // a spell that hung a bonus, and a Bless the rules had ended went on
    // adding its d4. Applying `released` rather than four named fields is what
    // keeps that from happening again to a family nobody has added yet.
    creatures: {
      ...base.creatures,
      [targetId]: { ...released, conditions },
    },
  };
}

/**
 * Every grant one source made on one creature, taken away.
 *
 * The same operation `releaseOnTarget` performs, asked by **source** rather
 * than by casting — which is what lets a feature and a casting share it. SRD
 * Superior Hunter's Defense grants a Resistance and no casting exists to hang
 * it on; a Stoneskin's grant with a deadline of its own is the same sentence
 * with a casting id inside the source.
 *
 * **Every grant kind, not the one the deadline was written for.** What ends is
 * what that source granted, which is one question however many of the families
 * answer it — and it is why the `grants` timer needs no per-kind identity. So
 * it is {@link withoutGrants} with the bare source as its predicate, and the
 * roll modifiers are matched on that bare source rather than through
 * `rollModifierKey` for exactly the same reason: Beacon of Hope's two modifiers
 * are one source's grant, and one deadline ends both.
 *
 * Nothing here touches the casting itself. A casting whose grant has expired is
 * still running, still concentrated on, and still in `ongoing`.
 *
 * **It performs no landing, and nothing can reach it with a lift.** A
 * `GrantedLift` is hung by a movement rider, which carries no `lasts` and so
 * never gets a `grants` timer — the only thing that addresses a bare source.
 * Said out loud because the omission would otherwise be invisible: a deadline
 * that could end a lift here would leave a creature in the air with nothing
 * holding it, and the day a rider learns to end sooner than its casting this
 * function needs {@link landsWhenReleased} too.
 */
export function releaseGrants(creature: CreatureState, source: string): CreatureState {
  return withoutGrants(creature, (held) => held === source);
}

/**
 * The condition instances one change took off a creature, by id.
 *
 * The difference between two condition states rather than the name on an
 * event, because a removal by name lifts every instance of that name *and*
 * whatever each of them implied — so the population is what actually left, and
 * a reader working from the event's own word would miss the implied ones.
 *
 * Shared by the two doors a condition can leave through, which is the reason
 * it is a function: `condition-removed` in `fold/vitals.ts` and
 * {@link endTimedCondition} below. A second copy of this line would be
 * correct until the day somebody fixed one of them.
 */
export const instancesLifted = (
  before: readonly { readonly id: string }[],
  after: readonly { readonly id: string }[],
): readonly string[] =>
  before
    .filter((instance) => !after.some((kept) => kept.id === instance.id))
    .map((instance) => instance.id);

/**
 * Every grant sourced to a condition **instance** that has just lifted.
 *
 * **A lifetime the vocabulary did not have, built out of the source string
 * rather than out of a new kind of deadline.** SRD Swarm of Ravens: "The
 * target has the Deafened condition until the start of the swarm's next turn.
 * While Deafened, the target also has Disadvantage on ability checks and
 * attack rolls." The mode lasts exactly as long as *that* Deafened — not the
 * condition in general, and not a span of its own — so the clause that lands
 * it uses `conditionInstanceId(condition, source)` as the grant's source, and
 * the instance leaving is the whole of its ending.
 *
 * That works because `conditionInstanceId` is deterministic and because the
 * fold already knows, at both doors a condition leaves by, exactly which
 * instances went: no new event, no new field on `CreatureState`, and no new
 * member of `EffectTarget`. A grant so sourced must carry **no `grants`
 * deadline of its own** — the instance is its deadline, and a second one could
 * only disagree with it — and nothing writes one: `applyPrintedClauses` hangs
 * the timer for a *spanned* clause and never for a hosted one, and no content
 * route can reach this source at all, because a definition's grants are
 * sourced to a casting id.
 *
 * Quiet where nothing lifted, and {@link withoutGrants} hands the creature
 * back by reference where nothing matched — which is what keeps a removal that
 * touched no grant from marking the creature changed.
 */
export function releaseInstanceGrants(
  creature: CreatureState,
  instances: readonly string[],
): CreatureState {
  if (instances.length === 0) return creature;
  const gone = new Set(instances);
  return withoutGrants(creature, (held) => gone.has(held));
}

/**
 * One source's hold on a **Hit Point maximum**, taken off and nothing else.
 *
 * The one narrow release in this module, and deliberately not
 * {@link releaseGrants}. Every other ending here answers "is this source still
 * doing anything to this creature" and takes the whole answer, because a
 * casting that ends ends in every family at once. SRD's Long Rest asks a
 * narrower question — "If your Hit Point maximum was reduced, it returns to
 * normal" — about one number and no other, and a printed line that lowered a
 * maximum is free to have hung a condition or a Speed cut under the same
 * source. A night's sleep is not a dispel.
 *
 * **The creature itself comes back when nothing matched**, by reference, for
 * {@link withoutGrants}'s reason: the fold compares identity to decide whether
 * anything moved.
 */
export function releaseHitPointMaximum(creature: CreatureState, source: string): CreatureState {
  const kept = creature.hitPointMaxima.filter((held) => held.source !== source);
  return kept.length === creature.hitPointMaxima.length
    ? creature
    : { ...creature, hitPointMaxima: kept };
}

/**
 * A timed condition ending, **however its moment arrived**.
 *
 * One door, and for the reason {@link releaseCasting} is one: a condition on a
 * timer can stop two ways — the deadline passes, or something the SRD printed
 * happens — and the two used to be one branch inside `expireEffects` with no
 * name and no second caller. `endTriggeredEffects` is that second caller, and a
 * near-copy of this five lines long would have been correct until the day
 * somebody fixed one of them.
 *
 * **The key goes before the instance does**, which is not tidiness: it is what
 * makes the trigger pass terminate. A pass that acts on a timer it has not
 * consumed can be handed the same timer again by whatever its own release
 * changed, and the version of that mistake on the casting side **hung the
 * fold** rather than failing a test. The deletion is inside this function so a
 * caller cannot forget it.
 *
 * **And nothing about the casting.** There is usually none — an item's
 * condition is filed under `item:<id>`, which `castingIdOf` answers null for —
 * and where there is one, the casting is on whoever holds something of its,
 * asked at every read: removing the last thing removes them, and nothing has
 * to say so. A shrink written here would be half a rule, exactly as the one
 * this branch used to carry was.
 *
 * **And whatever was sourced to the instance goes with it**, which is
 * {@link releaseInstanceGrants} — the second of the two doors a condition
 * leaves by, the first being `condition-removed` in `fold/vitals.ts`. SRD
 * Swarm of Ravens' Disadvantage lasts as long as the Deafened it names, so a
 * span running out has to take it exactly as a cure does.
 *
 * A condition whose creature has left is the deletion and nothing else, which
 * is the right answer rather than a missing case: there is nobody to take it
 * off.
 */
export function endTimedCondition(
  state: GameState,
  key: string,
  target: Extract<EffectTarget, { kind: 'condition' }>,
): GameState {
  const timers = { ...state.timers };
  delete timers[key];
  const current: GameState = { ...state, timers };

  const creature = current.creatures[target.on];
  if (creature === undefined) return current;
  const conditions = removeConditionInstance(creature.conditions, target.instance);
  return {
    ...current,
    creatures: {
      ...current.creatures,
      [target.on]: {
        ...releaseInstanceGrants(
          creature,
          instancesLifted(creature.conditions.instances, conditions.instances),
        ),
        conditions,
      },
    },
  };
}

/**
 * Whether a casting is on a creature, **now**.
 *
 * The single answer to SRD Dispel Magic's "any ongoing spell ... on the
 * target", and the one function all four readers of that question ask —
 * `ongoingSpellsOn`, the Dispel resolver, `endOngoingSpell`'s refusal and the
 * triggered-endings pass. One reader is the point: they used to share a
 * *field*, which is not the same thing as sharing a rule, and the field went
 * stale in one of the two places it was maintained by hand.
 *
 * Two halves of different provenance, unioned:
 *
 * - **stored** — `OngoingSpell.aimed`, the creatures the cast put the spell on
 *   and nothing in state can say so: the caster of a Range: Self spell, and a
 *   target a tracked spell like Darkvision reported nothing about. There is no
 *   world fact to read for either, which is what the measurement in
 *   `derived-on.test.ts` established.
 * - **derived** — every creature the casting is still holding something on,
 *   which is {@link holdsNothingOf} read the other way. No event has to
 *   remember to say it, so a Web that restrains somebody an hour later is on
 *   them the instant the condition lands, and a grant that lapses takes the
 *   casting off them in the same breath.
 *
 * **What the derived half deliberately is not** is "everyone the area has ever
 * touched". A creature Insect Plague damaged is not carrying anything of the
 * swarm's, so the swarm is not on them and a Dispel Magic pointed their way
 * finds nothing — scheduled damage is a debt the casting owes rather than
 * something it is doing to them, and `grantSourcesOf` leaves it out for that
 * reason.
 *
 * A creature who is not in the game is on nothing: `holdsNothingOf` says so
 * for the derived half, and the existence check below says so for the stored
 * one, which `withoutTarget` has usually emptied already.
 */
export function isOn(state: GameState, record: OngoingSpell, who: CharacterId): boolean {
  if (state.creatures[who] === undefined) return false;
  return record.aimed.includes(who) || !holdsNothingOf(state, who, record.castingId);
}

/**
 * Every creature a casting is on, sorted — {@link isOn} asked of the world.
 *
 * Sorted and deduplicated so two readers of one state agree, and so the answer
 * does not depend on which half a creature arrived in.
 *
 * The derived half is a walk over the creatures rather than a lookup, because
 * the question is "who is holding something of this casting's" and nothing
 * indexes grants by their source. It is the same walk `releaseCasting` makes,
 * and the population is the creatures in one scene.
 */
export function spellOn(state: GameState, record: OngoingSpell): readonly string[] {
  const on = new Set<string>();
  for (const who of record.aimed) {
    if (state.creatures[who] !== undefined) on.add(who);
  }
  for (const creature of Object.values(state.creatures)) {
    if (!holdsNothingOf(state, creature.id, record.castingId)) on.add(creature.id);
  }
  return [...on].sort();
}

/**
 * Whether a casting has no live effect left on a creature.
 *
 * The same links `releaseCasting` walks, asked of one creature: the conditions
 * it hung, and every grant {@link grantSourcesOf} enumerates — the bonuses, the
 * Armour Class it supplied, the roll modifiers, the defences it granted, the
 * Speed it changed, the die it hung on later attacks and the conditions it
 * made the creature immune to.
 * Reading them through the enumerator is what keeps this in step with the
 * release: a family this could see and `releaseCasting` could not would keep a
 * finished casting on the creature, which is a wrong answer to Dispel Magic
 * that no frozen log would catch.
 *
 * The conditions stay a question of their own, because they are a different
 * link — instances, sources and implications rather than a bare grant. And
 * scheduled damage is deliberately in neither: a hit that is still owed is the
 * casting's debt rather than something the casting is *doing* to the creature,
 * which is the same reading that keeps a creature Insect Plague merely damaged
 * off the list.
 *
 * **`who` is a bare id** rather than a `CharacterId`, because one caller has
 * one that came out of a log: the compatibility path asks this of the names a
 * pre-version-3 record wrote, which are strings until something says otherwise.
 */
export function holdsNothingOf(state: GameState, who: string, castingId: string): boolean {
  const creature = state.creatures[who];
  if (creature === undefined) return true;

  const owns = (source: string): boolean => castingIdOf(source) === castingId;
  return (
    !creature.conditions.instances.some((instance) => owns(instance.source)) &&
    !grantSourcesOf(creature).some(owns)
  );
}

