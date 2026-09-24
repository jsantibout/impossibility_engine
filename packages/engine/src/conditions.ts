import type { Ability, ConditionName } from '@ie/shared';
import type { Bonus, ModeSource } from './bonuses.js';

/**
 * The fifteen conditions and their mechanical effects.
 *
 * This is the first module that feeds *back* into the rolls: conditions supply
 * advantage and disadvantage to checks, saves and attacks, and in a few cases
 * decide the outcome outright.
 *
 * Rules verified against SRD 5.2.1 (see ATTRIBUTION.md). Purely narrative
 * effects — Incapacitated's "you can't speak", Unconscious's "you're unaware of
 * your surroundings", Petrified's tenfold weight — are deliberately not
 * modelled here; they belong to narration, not arithmetic.
 */

/** Display names, for attributing a mode to the condition that caused it. */
const LABEL: Readonly<Record<ConditionName, string>> = {
  blinded: 'Blinded',
  charmed: 'Charmed',
  deafened: 'Deafened',
  exhaustion: 'Exhaustion',
  frightened: 'Frightened',
  grappled: 'Grappled',
  incapacitated: 'Incapacitated',
  invisible: 'Invisible',
  paralyzed: 'Paralyzed',
  petrified: 'Petrified',
  poisoned: 'Poisoned',
  prone: 'Prone',
  restrained: 'Restrained',
  stunned: 'Stunned',
  unconscious: 'Unconscious',
};

/**
 * Conditions that carry others with them. Unconscious is the compound one:
 * "You have the Incapacitated and Prone conditions."
 */
const IMPLIES: Partial<Readonly<Record<ConditionName, readonly ConditionName[]>>> = {
  paralyzed: ['incapacitated'],
  petrified: ['incapacitated'],
  stunned: ['incapacitated'],
  unconscious: ['incapacitated', 'prone'],
};

/**
 * Expand implied conditions to a fixed point, sorted.
 *
 * Sorting matters beyond tidiness: condition state ends up in the event log,
 * and a set that serialises differently depending on the order effects were
 * applied would break replay comparison.
 */
export function expandConditions(conditions: readonly ConditionName[]): ConditionName[] {
  const present = new Set<ConditionName>(conditions);

  let added = true;
  while (added) {
    added = false;
    for (const condition of [...present]) {
      for (const implied of IMPLIES[condition] ?? []) {
        if (!present.has(implied)) {
          present.add(implied);
          added = true;
        }
      }
    }
  }

  return [...present].sort();
}

/**
 * One reason a creature has a condition.
 *
 * Conditions were a flat list of names, which loses *why* — and the why is
 * load-bearing. A creature held by one effect and knocked unconscious by
 * another has two independent reasons to be Incapacitated; removing the second
 * must not lift the first. Flattening them made the two indistinguishable.
 */
export interface ConditionInstance {
  /** Stable and deterministic, so it survives the event log and a replay. */
  readonly id: string;
  readonly condition: ConditionName;
  /** What caused it: a spell, a feature, dropping to 0 hit points. */
  readonly source: string;
  /** The instance that carried this one, for conditions another implies. */
  readonly impliedBy: string | null;
}

export interface ConditionState {
  readonly instances: readonly ConditionInstance[];
  /** Distinct condition names present, derived and sorted. */
  readonly conditions: readonly ConditionName[];
  /** 0 to 6. Exhaustion is a level, not a flag. */
  readonly exhaustion: number;
  /**
   * Conditions the creature **has** and can no longer benefit from.
   *
   * SRD Starry Wisp: "it … can't benefit from the Invisible condition." That
   * is not the condition ending and not the condition being suppressed: the
   * creature is still Invisible for everything that reads the fact, and what
   * it has lost is what the condition would otherwise have bought it. So this
   * sits beside the condition set rather than filtering it, and the readers
   * that hand a condition its benefits ask {@link benefitsFrom} instead of
   * {@link hasCondition}.
   *
   * **Derived rather than folded, and absent on the stored record.** The
   * `conditions` stored on a creature is the record of what is on them; this
   * is filled by `effectiveConditions`, the one gatherer every reader of
   * condition *effects* goes through, out of the sourced grants the creature
   * is carrying. Absent and empty mean the same thing, which is what every
   * log ever written folds to.
   */
  readonly withoutBenefit?: readonly ConditionName[];
}

/** Deterministic identity: the same condition from the same source is one instance. */
export const conditionInstanceId = (condition: ConditionName, source: string): string =>
  `${condition}:${source}`;

/**
 * What put a condition there, read back out of its instance id.
 *
 * The inverse of {@link conditionInstanceId}, and here because that is where
 * the encoding is: an id is a condition name, a colon and the source, and a
 * condition name has no colon in it, so the first one is the whole of the
 * rule. A second place that split the string would be a second place for the
 * encoding to change out from under.
 *
 * **Read off the id rather than off the creature**, which is the same choice
 * `castingIdOf(timer.target.instance)` already made and for the same reason: a
 * timer knows its instance and may outlive the instance it names —
 * `condition-removed` lifts one and leaves the timer standing — so a lookup
 * through `conditions.instances` would answer differently depending on a bug
 * that is somebody else's to fix.
 *
 * The id unchanged where there is no colon at all, which no id this module
 * writes can be: a caller that made one up gets back what it put in rather
 * than an exception, because this answers a question about a string.
 */
export const sourceOfInstance = (instance: string): string => {
  const at = instance.indexOf(':');
  return at < 0 ? instance : instance.slice(at + 1);
};

const derive = (
  instances: readonly ConditionInstance[],
  exhaustion: number,
): ConditionState => ({
  // Sorted by id so state serialises identically however it was reached.
  instances: [...instances].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  conditions: [...new Set(instances.map((i) => i.condition))].sort(),
  exhaustion: Math.max(0, Math.trunc(exhaustion)),
});

/**
 * The same state with certain conditions taken out of it.
 *
 * Not a removal: the instances are dropped from a *copy*, for a reader asking
 * what actually bites right now. SRD Aura of Courage says a Frightened ally's
 * condition "has no effect on that ally while there" — the condition is still
 * on them, and it comes back when they leave. See `standing.ts`, which is the
 * only caller and explains why suppression is not removal.
 */
export function withoutConditions(
  state: ConditionState,
  names: readonly ConditionName[],
): ConditionState {
  if (names.length === 0) return state;
  return derive(
    state.instances.filter((instance) => !names.includes(instance.condition)),
    state.exhaustion,
  );
}

/** The default source for a condition whose cause nobody recorded. */
const UNATTRIBUTED = 'unattributed';

export function conditionState(
  conditions: readonly ConditionName[] = [],
  exhaustion = 0,
): ConditionState {
  let state = derive([], exhaustion);
  for (const condition of conditions) {
    state = applyCondition(state, condition, UNATTRIBUTED);
  }
  return { ...state, exhaustion: Math.max(0, Math.trunc(exhaustion)) };
}

/**
 * Give a creature a condition, along with anything that condition carries.
 *
 * Implied instances record which instance carried them, so removing the cause
 * removes exactly what it brought and nothing else.
 */
export function applyCondition(
  state: ConditionState,
  condition: ConditionName,
  source: string,
  /**
   * Conditions **this** cause carries, beyond the ones the condition always
   * does.
   *
   * SRD Crocodile: "While Grappled, the target has the Restrained condition."
   * {@link IMPLIES} cannot say it — that table is what a condition *means*,
   * and a Wolf's grapple carries nothing while a Crocodile's carries
   * Restrained — but the *lifetime* the sentence names is exactly the one
   * implication already has: `removeConditionInstance` takes an implied
   * instance off with the instance that carried it, so the Restrained lifts at
   * the escape, at either automatic lapse and at a release, through doors that
   * already existed.
   *
   * Expanded like any other, so a source that carried Unconscious would carry
   * the Incapacitated and Prone underneath it too; and unioned rather than
   * replacing, because a caller may add to what a condition means and none may
   * take any of it away.
   */
  implies: readonly ConditionName[] = [],
): ConditionState {
  const id = conditionInstanceId(condition, source);
  if (state.instances.some((i) => i.id === id)) return state;

  const added: ConditionInstance[] = [{ id, condition, source, impliedBy: null }];

  for (const implied of expandConditions([condition, ...implies]).filter((c) => c !== condition)) {
    const impliedId = conditionInstanceId(implied, source);
    if (state.instances.some((i) => i.id === impliedId)) continue;
    if (added.some((i) => i.id === impliedId)) continue;
    added.push({ id: impliedId, condition: implied, source, impliedBy: id });
  }

  return derive([...state.instances, ...added], state.exhaustion);
}

/**
 * Conditions that outlast the effect that brought them.
 *
 * SRD Unconscious: "When this condition ends, you remain Prone." Everything
 * else an ending condition carried goes with it.
 */
const PERSISTS_AFTER_CAUSE: ReadonlySet<ConditionName> = new Set(['prone']);

/**
 * Remove one instance — one *reason* — and whatever it carried.
 *
 * Other sources of the same condition are untouched, which is the whole point:
 * a creature Incapacitated by Hold Person and separately knocked unconscious
 * stays Incapacitated when the unconsciousness lifts.
 */
export function removeConditionInstance(state: ConditionState, id: string): ConditionState {
  const remaining = state.instances.filter((i) => {
    if (i.id === id) return false;
    if (i.impliedBy === id) return PERSISTS_AFTER_CAUSE.has(i.condition);
    return true;
  });

  // A condition that outlives its cause is no longer implied by anything.
  return derive(
    remaining.map((i) => (i.impliedBy === id ? { ...i, impliedBy: null } : i)),
    state.exhaustion,
  );
}

/**
 * Remove a condition by name, optionally only from one source.
 *
 * Without a source this lifts every instance of that condition, which is what
 * a blanket "the paralysis ends" means. With one it lifts only that cause.
 */
export function removeCondition(
  state: ConditionState,
  condition: ConditionName,
  source?: string,
): ConditionState {
  const targets = state.instances.filter(
    (i) => i.condition === condition && (source === undefined || i.source === source),
  );

  return targets.reduce((acc, instance) => removeConditionInstance(acc, instance.id), state);
}

/** Every reason a creature currently has a given condition. */
export function reasonsFor(
  state: ConditionState,
  condition: ConditionName,
): readonly ConditionInstance[] {
  return state.instances.filter((i) => i.condition === condition);
}

export function setExhaustion(state: ConditionState, level: number): ConditionState {
  return derive(state.instances, level);
}

export function hasCondition(state: ConditionState, name: ConditionName): boolean {
  // Exhaustion is tracked as a level, so its presence is derived from that.
  if (name === 'exhaustion') return state.exhaustion > 0;
  return state.conditions.includes(name);
}

/**
 * Whether a condition is doing for this creature what the book says it does.
 *
 * {@link hasCondition} asks whether the condition is *there*; this asks
 * whether it is *working*, and they are two questions because the SRD writes
 * a clause that separates them — Starry Wisp's "can't benefit from the
 * Invisible condition", Faerie Fire's and Mind Spike's. Every reader that
 * hands a condition an Advantage, a Disadvantage or any other good thing asks
 * this one; every reader of the fact itself asks the other.
 */
export function benefitsFrom(state: ConditionState, name: ConditionName): boolean {
  return hasCondition(state, name) && !(state.withoutBenefit ?? []).includes(name);
}

const disadvantage = (condition: ConditionName): ModeSource => ({
  source: LABEL[condition],
  mode: 'disadvantage',
});

const advantage = (condition: ConditionName): ModeSource => ({
  source: LABEL[condition],
  mode: 'advantage',
});

export interface AttackerContext {
  /**
   * The target can **somehow** see the attacker, which negates Invisible's
   * Advantage — and the adverb is the whole of the difference.
   *
   * SRD Invisible: "If a creature can somehow see you, you don't gain this
   * benefit against that creature." That is *not* the sight question the rest
   * of the engine asks. **Owner's ruling, 2026-09-20: Truesight and Blindsight
   * satisfy this sentence; Darkvision does not** — Darkvision is a rule about
   * light, and an Invisible creature is not hidden by the dark. So the fact
   * this field wants is `canSomehowSee` in `standing.ts`, never `canSee`:
   * asking the wider question here would take Hide's and Greater
   * Invisibility's Advantage away from every elf, dwarf, gnome, orc and
   * dragonborn in range, silently, because a sense answers `true` rather than
   * `null`.
   *
   * **And the asymmetry is deliberate.** `defendingModes` asks `canSee` whole,
   * on purpose: Dodge's "if you can see the attacker" is a sentence Darkvision
   * genuinely satisfies. One sense, two sentences, two answers — see
   * `canSomehowSee`'s own note for the table, and `hide.test.ts` for both
   * halves asserted on one dwarf.
   *
   * **Absent means nobody has said.** The reader below asks `!== true`, so an
   * unsaid fact leaves the Advantage standing, which is what the clause's
   * "if" requires; the caller reports the silence rather than refusing the
   * swing.
   */
  readonly targetCanSeeAttacker?: boolean;
  /** The source of fear is in the attacker's line of sight. */
  readonly fearSourceVisible?: boolean;
  /** The target is the creature grappling the attacker. */
  readonly targetIsGrappler?: boolean;
}

/** Advantage and disadvantage the attacker's own conditions impose on their roll. */
export function attackerConditionModes(
  state: ConditionState,
  context: AttackerContext,
): ModeSource[] {
  const modes: ModeSource[] = [];

  if (hasCondition(state, 'blinded')) modes.push(disadvantage('blinded'));
  if (hasCondition(state, 'poisoned')) modes.push(disadvantage('poisoned'));
  if (hasCondition(state, 'prone')) modes.push(disadvantage('prone'));
  if (hasCondition(state, 'restrained')) modes.push(disadvantage('restrained'));

  // SRD Frightened: only "while the source of fear is within line of sight".
  if (hasCondition(state, 'frightened') && context.fearSourceVisible === true) {
    modes.push(disadvantage('frightened'));
  }

  // SRD Grappled: disadvantage "against any target other than the grappler".
  if (hasCondition(state, 'grappled') && context.targetIsGrappler !== true) {
    modes.push(disadvantage('grappled'));
  }

  // SRD Invisible: "If a creature can somehow see you, you don't gain this
  // benefit against that creature." **And `benefitsFrom` rather than
  // `hasCondition`**, because a second sentence takes the same benefit away
  // without taking the condition: SRD Starry Wisp's "can't benefit from the
  // Invisible condition".
  if (benefitsFrom(state, 'invisible') && context.targetCanSeeAttacker !== true) {
    modes.push(advantage('invisible'));
  }

  return modes;
}

export interface TargetContext {
  /**
   * Whether the attacker is within 5 feet, or **absent for "nobody has said"**.
   *
   * Three states rather than two, because Prone is the one condition whose
   * effect flips on distance rather than merely switching off, so there is no
   * conservative direction to fall back on. Reading an unknown distance as
   * "not within 5 feet" would hand the attacker Disadvantage on the strength
   * of a fact nobody established — the engine inventing a position by
   * implication, which is what `position: Point | null` exists to prevent.
   */
  readonly withinFiveFeet?: boolean;
  /**
   * The attacker can **somehow** see the target, negating Invisible's
   * protection — SRD Invisible's "Attack rolls against you have Disadvantage"
   * read from the other end, and the same sentence and the same ruling as
   * {@link AttackerContext.targetCanSeeAttacker}. `canSomehowSee`, never
   * `canSee`: Truesight and Blindsight satisfy it, Darkvision does not.
   */
  readonly attackerCanSeeTarget?: boolean;
}

/** Advantage and disadvantage the target's conditions impose on attacks against them. */
export function targetConditionModes(
  state: ConditionState,
  context: TargetContext,
): ModeSource[] {
  const modes: ModeSource[] = [];

  for (const condition of ['blinded', 'paralyzed', 'petrified', 'restrained', 'stunned', 'unconscious'] as const) {
    if (hasCondition(state, condition)) modes.push(advantage(condition));
  }

  // The same benefit read from the other end, and the same two questions: a
  // creature that cannot benefit from being Invisible is no harder to hit.
  if (benefitsFrom(state, 'invisible') && context.attackerCanSeeTarget !== true) {
    modes.push(disadvantage('invisible'));
  }

  // SRD Prone: "An attack roll against you has Advantage if the attacker is
  // within 5 feet of you. Otherwise, that attack roll has Disadvantage."
  // The second half is the half that gets forgotten — a prone target is harder
  // to hit at range, not merely no easier.
  // SRD Prone: "An attack roll against you has Advantage if the attacker is
  // within 5 feet of you. Otherwise, that attack roll has Disadvantage." The
  // second half is the half that gets forgotten; the *third* case is the one
  // that gets invented. Without the distance the rule has no answer, so it
  // gives none — see `withinFiveFeet` above.
  if (hasCondition(state, 'prone') && context.withinFiveFeet !== undefined) {
    modes.push(context.withinFiveFeet ? advantage('prone') : disadvantage('prone'));
  }

  return modes;
}

/** Modes plus, where a condition decides the outcome outright, a reason. */
export interface ConditionEffect {
  readonly modes: readonly ModeSource[];
  /** Set when a condition makes the test fail regardless of the roll. */
  readonly autoFail: string | null;
}

/** SRD: these four automatically fail Strength and Dexterity saving throws. */
const AUTO_FAILS_STR_DEX = ['paralyzed', 'petrified', 'stunned', 'unconscious'] as const;

export function saveConditionEffect(state: ConditionState, ability: Ability): ConditionEffect {
  const modes: ModeSource[] = [];
  let autoFail: string | null = null;

  if (ability === 'str' || ability === 'dex') {
    for (const condition of AUTO_FAILS_STR_DEX) {
      if (hasCondition(state, condition)) {
        autoFail = `${LABEL[condition]} automatically fails Strength and Dexterity saving throws`;
        break;
      }
    }
  }

  // SRD Restrained: "You have Disadvantage on Dexterity saving throws."
  if (ability === 'dex' && hasCondition(state, 'restrained')) {
    modes.push(disadvantage('restrained'));
  }

  return { modes, autoFail };
}

export interface CheckContext {
  /** The check depends on sight, which Blinded fails outright. */
  readonly requiresSight?: boolean;
  /** The check depends on hearing, which Deafened fails outright. */
  readonly requiresHearing?: boolean;
  readonly fearSourceVisible?: boolean;
}

export function checkConditionEffect(
  state: ConditionState,
  context: CheckContext,
): ConditionEffect {
  const modes: ModeSource[] = [];
  let autoFail: string | null = null;

  // SRD Blinded and Deafened fail sense-dependent checks outright. Note neither
  // imposes blanket disadvantage on every ability check.
  if (context.requiresSight === true && hasCondition(state, 'blinded')) {
    autoFail = 'Blinded automatically fails an ability check that requires sight';
  } else if (context.requiresHearing === true && hasCondition(state, 'deafened')) {
    autoFail = 'Deafened automatically fails an ability check that requires hearing';
  }

  if (hasCondition(state, 'poisoned')) modes.push(disadvantage('poisoned'));
  if (hasCondition(state, 'frightened') && context.fearSourceVisible === true) {
    modes.push(disadvantage('frightened'));
  }

  return { modes, autoFail };
}

/**
 * SRD Paralyzed and Unconscious: "Any attack roll that hits you is a Critical
 * Hit if the attacker is within 5 feet of you."
 *
 * Petrified and Stunned grant advantage but not automatic criticals — an easy
 * over-generalisation to make from "helpless target".
 */
export function isAutomaticCritical(state: ConditionState, withinFiveFeet: boolean): boolean {
  if (!withinFiveFeet) return false;
  return hasCondition(state, 'paralyzed') || hasCondition(state, 'unconscious');
}

/**
 * SRD Exhaustion: "When you make a D20 Test, the roll is reduced by 2 times
 * your Exhaustion level." A flat penalty, not disadvantage — so it stacks with
 * advantage rather than being cancelled by it.
 */
export function exhaustionBonus(state: ConditionState): Bonus | null {
  if (state.exhaustion <= 0) return null;
  return {
    source: `Exhaustion ${state.exhaustion}`,
    flat: -2 * state.exhaustion,
  };
}

/** SRD: "You die if your Exhaustion level is 6." */
export function isDeadFromExhaustion(state: ConditionState): boolean {
  return state.exhaustion >= 6;
}

/** Conditions that flatly set Speed to 0. */
const SPEED_ZERO = ['grappled', 'paralyzed', 'petrified', 'restrained', 'unconscious'] as const;

/**
 * Speed after conditions: 0 if anything pins the creature, otherwise the base
 * reduced by 5 feet per Exhaustion level.
 */
export function conditionSpeed(state: ConditionState, baseSpeed: number): number {
  if (SPEED_ZERO.some((c) => hasCondition(state, c))) return 0;
  return Math.max(0, baseSpeed - 5 * state.exhaustion);
}

/**
 * SRD "Flying": the conditions that take a flier out of the air.
 *
 * > "If a flying creature is knocked Prone, has its Speed reduced to 0, or is
 * > otherwise deprived of the ability to move, the creature falls unless it
 * > has the Hover trait or is being held aloft by magic."
 *
 * Two of the sentence's three clauses, and only the two this module can see:
 * being knocked Prone, and the five conditions that pin a creature outright.
 * A Speed reduced to 0 by anything *else* — Hypnotic Pattern's grant, an
 * Emanation that halves it away — is not a fact about a condition, so it is
 * asked of `speedOf` by the caller rather than guessed at here. See
 * `fallingFromTheAir` in `commands/movement.ts`, which is where the two halves
 * meet and where the Hover exception is read.
 *
 * Prone rather than "cannot move" is the whole of why this is not
 * {@link conditionSpeed} asked for 0: SRD Prone leaves a creature able to
 * crawl at half speed, so a Prone flier's Speed is not 0 and it still falls.
 */
export function deprivedOfFlight(state: ConditionState): boolean {
  return hasCondition(state, 'prone') || SPEED_ZERO.some((c) => hasCondition(state, c));
}

/** SRD Incapacitated: "You can't take any action, Bonus Action, or Reaction." */
export function isIncapacitated(state: ConditionState): boolean {
  return hasCondition(state, 'incapacitated');
}

/**
 * SRD: Incapacitated gives Disadvantage on Initiative, Invisible gives
 * Advantage — and a creature that is somehow both rolls normally, since these
 * cancel like any other pair.
 */
export function initiativeConditionModes(state: ConditionState): ModeSource[] {
  const modes: ModeSource[] = [];
  // The third of the three sentences Invisible buys, and the third reader
  // that asks whether this creature may still have it.
  if (benefitsFrom(state, 'invisible')) modes.push(advantage('invisible'));
  if (isIncapacitated(state)) modes.push(disadvantage('incapacitated'));
  return modes;
}

/** SRD Petrified: "You have Resistance to all damage." */
export function resistsAllDamage(state: ConditionState): boolean {
  return hasCondition(state, 'petrified');
}

/** SRD Petrified: "You have Immunity to the Poisoned condition." */
export function canReceiveCondition(state: ConditionState, name: ConditionName): boolean {
  if (name === 'poisoned' && hasCondition(state, 'petrified')) return false;
  return true;
}

/**
 * A condition Immunity an ongoing effect has hung on a creature.
 *
 * The seventh member of the family `bonuses`, `armorClasses`, `rollModifiers`,
 * `grantedDefenses`, `speedModifiers` and `attackRiders` already form, and it
 * needed no lifecycle of its own: the casting is in the `source`, so
 * `releaseCasting`, `releaseOnTarget` and a `grants` deadline all end it
 * through the door the other six already use.
 *
 * **Separate from `CreatureState.conditionImmunities`, which is the stat
 * block's**, and separate for the reason `GrantedDefense` is separate from
 * `CreatureState.defenses`: that table is written when the creature enters the
 * game, carries no source, and holds only *unconditional* entries — a
 * qualified one ("Charmed, except from its vampire master") deliberately stays
 * out of it, because no boolean captures a qualification. A grant is
 * unconditional by construction, and keeping the two apart is what lets one end
 * without disturbing the other. `conditionImmunitiesOf` is the one gatherer
 * that reads both.
 *
 * **A list of names rather than one**, because the SRD writes it plural: SRD
 * Heroes' Feast's "Immunity to the Frightened and Poisoned conditions" is one
 * sentence, one casting and one thing to end — the same reading Stoneskin's
 * three damage types already take.
 *
 * **It lives here rather than beside the definition format**, with the
 * condition vocabulary it is written in: `ActiveBonus` is in `bonuses.ts`,
 * `GrantedArmorClass` in `character.ts`, `ActiveRollModifier` in
 * `roll-modifiers.ts`, `GrantedDefense` and `GrantedSpeed` in `attack.ts` —
 * each beside the table or the reader it belongs to. This one is about the
 * fifteen conditions, and this is the module that holds them.
 *
 * **Not the feature layer's `condition-immunity`**, which shares the name and
 * is a different rule: `StandingGrant`'s member is SRD Aura of Courage's
 * *suppression* — the condition lands, stays on the creature, and has no effect
 * while they are in the aura. This one refuses the condition outright.
 * `conditionImmunitiesOf` and `suppressedConditions` are the two readers, and
 * the docstring on each says why merging them would get both wrong.
 */
export interface GrantedConditionImmunity {
  /** The casting (`Mind Blank#cast:3`) or the feature that granted it. */
  readonly source: string;
  /** The conditions the sentence names, sorted so state serialises identically. */
  readonly conditions: readonly ConditionName[];
}

/**
 * A benefit an ongoing effect has taken away without taking the condition.
 *
 * > SRD Starry Wisp: "until the end of your next turn, it … **can't benefit
 * > from the Invisible condition**."
 *
 * The thirteenth member of the family `grantsOf` enumerates, and it needed no
 * lifecycle of its own for the reason {@link GrantedConditionImmunity} needed
 * none: the source is the whole of the link, so `releaseCasting`,
 * `releaseOnTarget` and a `grants` deadline all end it through the door the
 * other twelve already use.
 *
 * **It is neither of the two things it resembles**, and that is the whole
 * reason it is a family rather than a spelling of one of them:
 *
 * - it is not the condition **ending** — the creature is still Invisible for
 *   every reader of the fact, a Lesser Restoration would still find something
 *   to cure, and whatever caused it is still what ends it;
 * - it is not {@link GrantedConditionImmunity} — that refuses a condition
 *   *arriving*, and this one has already arrived and stays.
 *
 * The nearest neighbour is `suppressedConditions`, SRD Aura of Courage's "has
 * no effect on that ally while there", and even that differs in the direction
 * that matters: suppression takes the condition's *whole* effect away, good
 * and bad alike, and is derived from where somebody is standing. This takes
 * only the benefits, and it is hung.
 *
 * **One condition per grant.** The three SRD sentences each name one, and a
 * plural field would have to decide whether two spells denying the same
 * benefit are one grant or two — a question the `source` already answers for
 * a singular one.
 */
export interface DeniedBenefit {
  /** The casting (`Starry Wisp#cast:0`) or the feature that denied it. */
  readonly source: string;
  /** The condition whose benefits this grant withholds. */
  readonly condition: ConditionName;
}

/**
 * Every condition whose benefit something is currently withholding, sorted.
 *
 * One gatherer, so a reader asks the question once — the reading
 * `conditionImmunitiesOf` already takes of the neighbouring family — and
 * `effectiveConditions` is the one caller, because it is the one door every
 * reader of condition *effects* goes through.
 */
export function deniedBenefitsOf(denied: readonly DeniedBenefit[]): readonly ConditionName[] {
  return [...new Set(denied.map((one) => one.condition))].sort();
}
