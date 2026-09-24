/**
 * What a printed save does to one creature besides its damage.
 *
 * `parsePrintedSave` in `@ie/srd` reads a stat block's `_Failure:_` into a
 * small vocabulary — a condition to a turn anchor, a grapple with its escape
 * DC, a push straight away, a Speed cut, a Hit Point maximum lowered by the
 * damage — and this is the one executor over it. Every clause lands through
 * the primitive the casting path already uses for the same sentence:
 * `applyConditionTo` with a `Duration` and a `RepeatSave`, the grapple's own
 * `escapeCheck` so `escapeGrapple` answers it, `shoveAwayFrom` for the push,
 * the `speed-modifier-granted` + `grants` timer a spell's slow uses, and the
 * `hit-point-maximum-adjusted` Aid raises with — lowered, for the first time,
 * because a Wight's is the sentence that lowers one.
 *
 * **One clause has a lifetime none of the others do**, and it is the reason
 * `roll-mode` is here rather than folded into the condition beside it. SRD
 * Swarm of Ravens: "While Deafened, the target also has Disadvantage on
 * ability checks and attack rolls." The sentence names no span; it names the
 * condition instance the same failure just created. So the grant is sourced to
 * `conditionInstanceId(condition, source)` and carries no deadline of its own
 * — the instance *is* the deadline, and the fold takes the grant off at both
 * doors a condition leaves by. See `releaseInstanceGrants` in
 * `fold/release.ts`.
 *
 * **Nothing here reads the block.** The clauses arrive already pinned on the
 * sheet (`StatedAction.save`), which is what `creature-added` pinned when the
 * block was read; the fold opens no catalogue and this opens no block.
 *
 * Two honesties the caller reports: an immune target is *named* rather than
 * silently skipped (`immuneTo`), and a size gate that spared a creature says
 * so in `unverified`, exactly as the attack path's rider does.
 */

import { ABILITY_NAMES, type CharacterId, type ConditionName, ok, type Result } from '@ie/shared';
import type { MonsterDamage, MonsterSave, PrintedSaveEffect, PrintedSpan } from '@ie/srd';
import { applyEvent, type GameEvent, type GameState } from '../events.js';
import { sizeAtMost, sizeOf } from '../positioning.js';
import type { RollFamily } from '../roll-modifiers.js';
import type { Duration } from '../time.js';
import type { RepeatSave } from '../timers.js';
import { conditionInstanceId, hasCondition } from '../conditions.js';
import { dropToZero } from '../vitals.js';
import { applyConditionTo, schedule } from './conditions.js';
import { ZERO_HIT_POINTS } from './command.js';
import { healCreature } from './creatures.js';
import { rewardsForDropping } from './drop-rewards.js';
import type { Supply } from './casting.js';
import { rollSpellDice } from './rolls.js';
import { shoveAwayFrom } from './spell-effect-movement.js';
import { conditionLanding } from './spell-effect-riders.js';
import { escapeCheck, grappleSource } from './unarmed.js';

export interface PrintedClausesLanded {
  readonly events: readonly GameEvent[];
  /** What the engine could not settle, in words a table can act on. */
  readonly unverified: readonly string[];
  /** The conditions that landed, in the order the line prints them. */
  readonly conditions: readonly ConditionName[];
  /** The conditions the target is immune to, which the line therefore did not impose. */
  readonly immuneTo: readonly ConditionName[];
  /** The feet the target was pushed, or null where the line pushed nobody. */
  readonly pushedFeet: number | null;
  /** Whether the line killed the target outright — SRD Will-o'-Wisp's is the one that does. */
  readonly died: boolean;
}

/** The source a printed line's clauses are hung on: the creature and the heading. */
export const printedLineSource = (who: CharacterId, line: string): string => `printed:${who}:${line}`;

/**
 * The book's three roll nouns in the engine's five families.
 *
 * The same two-vocabulary seam `monster.ts`'s `SUNLIT_ROLL` is, reading the
 * same three words out of the same glossary sentence: `@ie/srd` types a
 * sentence in the nouns the book prints and `RollFamily` is the engine's own,
 * and neither package may import the other's. Initiative and the death save
 * are families of this engine's rather than members of the book's list, so
 * they are not here — the cost that file records, unchanged.
 */
const PRINTED_ROLL: Readonly<Record<'ability-check' | 'attack-roll' | 'saving-throw', RollFamily>> =
  {
    'ability-check': 'ability-check',
    'attack-roll': 'attack',
    'saving-throw': 'saving-throw',
  };

/** How a condition reads in a sentence handed to a table: the book's own word. */
const conditionTitle = (condition: ConditionName): string =>
  condition.charAt(0).toUpperCase() + condition.slice(1);

/** Which arm of a printed branch the target's Hit Points chose, and what is left to do. */
export interface BranchesTaken {
  /** The clause list with every branch replaced by the arm that fired. */
  readonly clauses: readonly PrintedSaveEffect[];
  /** The `Otherwise` damage, where an `otherwise` arm was the one taken. */
  readonly damage: MonsterDamage | null;
  /** Its `plus` component, where the book printed one. */
  readonly plus: MonsterDamage | null;
}

/**
 * Resolve every branch in a clause list against the target's Hit Points.
 *
 * SRD Sea Hag: "If the target has 20 Hit Points or fewer, it drops to 0 Hit
 * Points. Otherwise, the target takes 13 (3d8) Psychic damage."
 *
 * **The number is the target's *current* Hit Points, Temporary Hit Points
 * excluded**, and that is the sentence rather than a convenience: Temporary
 * Hit Points are not Hit Points — "receiving Temporary Hit Points doesn't
 * restore you to consciousness" and a creature at 0 may hold them — so a
 * target on 3 behind a pool of 30 "has 3 Hit Points" and the hag's glare
 * reaches it.
 *
 * **Read before anything is rolled**, which is why this is a separate pass
 * rather than a case in `applyPrintedClauses`: the `otherwise` arm's dice must
 * not be thrown on a failure that took the other arm, and the clause executor
 * runs after the damage.
 *
 * Pure, and takes the number rather than the state: its caller has already
 * looked the creature up to roll the save at it, and a second lookup is a
 * second place for the two to disagree.
 */
export function takeBranches(
  hitPoints: number,
  clauses: readonly PrintedSaveEffect[],
): BranchesTaken {
  const taken: PrintedSaveEffect[] = [];
  let damage: MonsterDamage | null = null;
  let plus: MonsterDamage | null = null;
  for (const clause of clauses) {
    if (clause.kind !== 'branch') {
      taken.push(clause);
      continue;
    }
    if (hitPoints <= clause.ifHitPointsAtMost) {
      taken.push(...clause.then);
      continue;
    }
    damage = clause.otherwise.damage;
    plus = clause.otherwise.plus ?? null;
  }
  return { clauses: taken, damage, plus };
}

/**
 * A span the book printed, as the engine's own `Duration`.
 *
 * "its next turn" is the target's; "the mephit's next turn" is the source's;
 * a span in seconds is itself. A repeat save with a cap and no span — "After
 * 1 minute, it succeeds automatically" — runs for the cap.
 */
function durationOf(
  lasts: PrintedSpan | undefined,
  capSeconds: number | undefined,
  source: CharacterId,
  target: CharacterId,
): Duration | undefined {
  if (lasts?.kind === 'turn') {
    return {
      kind: lasts.moment === 'start' ? 'start-of-next-turn' : 'end-of-next-turn',
      of: lasts.of === 'target' ? target : source,
    };
  }
  if (lasts?.kind === 'seconds') return { kind: 'seconds', seconds: lasts.seconds };
  if (capSeconds !== undefined) return { kind: 'seconds', seconds: capSeconds };
  return undefined;
}

/** Every clause that carries a lifetime of either kind — see {@link hangTo}. */
type LastingClause = Extract<PrintedSaveEffect, { kind: 'action-rule' | 'speed-halved' }>;

/** Where a clause's grant is filed, and how a refusal finishes its sentence. */
interface Hung {
  /** A condition instance's id, or a key of the line's own that a timer ends. */
  readonly source: string;
  /** The span a `grants` timer holds, where the clause printed one. */
  readonly deadline?: PrintedSpan;
  /** `GrantedActionRule.until`: "the end of its own next turn", "the Poisoned condition ends". */
  readonly until: string;
}

/**
 * A printed span in the words a refusal ends with.
 *
 * `durationOf` above answers the same question for the clock; this answers it
 * for the **person reading the refusal**, which is what `GrantedActionRule`
 * carries `until` for: "you cannot do this" with no end in sight is the least
 * useful true thing a rules engine can say.
 */
function spanWords(span: PrintedSpan): string {
  if (span.kind === 'turn') {
    return `the ${span.moment} of ${span.of === 'target' ? 'its own' : "the source's"} next turn`;
  }
  const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;
  if (span.seconds % 3600 === 0) return plural(span.seconds / 3600, 'hour');
  if (span.seconds % 60 === 0) return plural(span.seconds / 60, 'minute');
  return plural(span.seconds, 'second');
}

/**
 * Where one clause's grant goes, or null where it has nowhere to go.
 *
 * **Two lifetimes and the corpus prints both**, which is why the pair of
 * clauses share this. A `whileCondition` is the Ravens' reading: the grant is
 * sourced to the condition instance *this failure* created and carries no
 * deadline, because the instance is the deadline. A `lasts` is the Steam
 * Mephit's: a key of the line's own with a `grants` timer over it.
 *
 * Null on the two ways a clause can end up with no host — a condition that did
 * not land, and a clause that named no lifetime at all. Both are reported
 * rather than hung, for the reason the mode clause gives: a rule sourced to an
 * instance nobody created, or to nothing, is one that could never be lifted.
 */
function hangTo(
  clause: LastingClause,
  lineSource: string,
  landed: ReadonlyMap<ConditionName, string>,
): Hung | null {
  if (clause.whileCondition !== undefined) {
    const instance = landed.get(clause.whileCondition);
    if (instance === undefined) return null;
    return {
      source: instance,
      until: `the ${conditionTitle(clause.whileCondition)} condition ends`,
    };
  }
  if (clause.lasts === undefined) return null;
  // Keyed by the **kind** as well as the line, because the two clauses are
  // stored in different families and `speed-modifier-granted` is identified by
  // its source alone: a line that both cut and halved a Speed would lose the
  // first to the second under one key. `speed-decrease` is the neighbour that
  // already takes `:speed`.
  return { source: `${lineSource}:${clause.kind}`, deadline: clause.lasts, until: spanWords(clause.lasts) };
}

/** What the caller is told about a clause that found nothing to hang on. */
function describeUnhung(clause: LastingClause, line: string, target: CharacterId): string {
  const what =
    clause.kind === 'speed-halved'
      ? `halves ${target}'s Speed`
      : `changes what ${target}'s turn may hold`;
  if (clause.whileCondition === undefined) {
    return `${line} ${what} and says no span and names no condition to end it — nothing was hung`;
  }
  const title = conditionTitle(clause.whileCondition);
  return `${line} ${what} while ${title}, and the ${title} condition did not land on them — nothing was hung`;
}

/**
 * What a line's damage came to on one target, in total and by type.
 *
 * Two numbers rather than one because the book asks both questions: SRD
 * Wight's Life Drain lowers a maximum "by an amount equal to the damage
 * taken", and SRD Vampire Spawn's Bite by "an amount equal to the **Necrotic**
 * damage taken" out of a blow that was Piercing and Necrotic at once.
 * {@link byType} is what the target's own defences left of each component, and
 * {@link total} is what was actually taken — a threshold turns a whole blow
 * aside, and nought taken is nought of every type.
 */
export interface PrintedDamageDealt {
  readonly total: number;
  readonly byType: Readonly<Record<string, number>>;
}

/** Nothing at all, for a target the line's damage never reached. */
export const NOTHING_DEALT: PrintedDamageDealt = { total: 0, byType: {} };

/**
 * Apply the clauses one outcome of a printed save carries to one creature.
 *
 * @param dealt what the line's damage came to on this target after its own
 * defences, which is what "an amount equal to the damage taken" reads — and,
 * per type, what "the Necrotic damage taken" reads.
 * @param useTag a number unique to this use — the roll issuer's position —
 * so two Life Drains on one creature lower the maximum twice rather than the
 * second replacing the first under one source key.
 */
export function applyPrintedClauses(
  state: GameState,
  source: CharacterId,
  target: CharacterId,
  line: string,
  save: MonsterSave,
  clauses: readonly PrintedSaveEffect[],
  dealt: PrintedDamageDealt,
  useTag: number,
  supply: Supply,
): Result<PrintedClausesLanded> {
  let current = state;
  const events: GameEvent[] = [];
  const unverified: string[] = [];
  const conditions: ConditionName[] = [];
  const immuneTo: ConditionName[] = [];
  let pushedFeet: number | null = null;
  const died: CharacterId[] = [];
  const lineSource = printedLineSource(source, line);
  /**
   * The instance id each condition **this line** imposed actually landed
   * under, so a clause naming one as its lifetime can be sourced to it.
   *
   * Recorded as the conditions land rather than looked up afterwards, because
   * the two facts a later clause needs are both moments in this loop: whether
   * the condition landed at all — an immune target has no instance — and which
   * source it went on, the line's or the grapple's.
   */
  const landedInstances = new Map<ConditionName, string>();
  /**
   * The sources a `grants` timer has already been raised for.
   *
   * One line may print two rules under one span — SRD Copper Dragon Wyrmling
   * prints a `forbids` and a `one-of` — and they share a source, because
   * `actionRuleKey` tells two statements of one source apart and one ending
   * takes both. A second timer under the same key would be a second deadline
   * for one sentence, with nothing to keep the two in step.
   */
  const scheduled = new Set<string>();

  const land = (more: readonly GameEvent[]): void => {
    events.push(...more);
    current = more.reduce(applyEvent, current);
  };

  for (const clause of clauses) {
    switch (clause.kind) {
      case 'condition': {
        // The size gate, read as the attack path reads its rider's: what
        // somebody said before what the map assumed.
        if (clause.ifNoLargerThan !== undefined) {
          const size =
            current.creatures[target]?.size ??
            (current.scene === null ? null : sizeOf(current.scene, target));
          if (size !== null && !sizeAtMost(size, clause.ifNoLargerThan)) {
            unverified.push(
              `${target} is ${size}, and ${line} reaches a creature that is ${clause.ifNoLargerThan} or smaller — the ${clause.condition} condition was not applied`,
            );
            break;
          }
          if (size === null) {
            unverified.push(
              `nobody has said how big ${target} is, so ${line} took them for Medium; a creature larger than ${clause.ifNoLargerThan} would have been left alone`,
            );
          }
        }

        // A grapple is the grapple every other door makes: sourced to the
        // grappler, escaped at the printed DC through `escapeGrapple`.
        const grapple = clause.escapeDc !== undefined;
        const conditionSource = grapple ? grappleSource(source) : lineSource;
        // The host's own ability and DC on every repeat this line hangs: SRD
        // writes "repeats **the** save", and the anchor is the printed `end`
        // of the `target`'s turn, which is the only pair the reader produces.
        const repeatOf = (onFailure?: RepeatSave['onFailure']): RepeatSave => ({
          at: 'end-of-turn',
          of: target,
          ability: save.ability,
          dc: save.dc,
          onSuccess: 'end-on-target',
          ...(onFailure === undefined ? {} : { onFailure }),
          label: `${ABILITY_NAMES[save.ability]} save vs ${line}`,
        });
        // SRD Gorgon: "_Second Failure:_ The target has the Petrified
        // condition instead of the Restrained condition." The printed field is
        // `RepeatSave.onFailure` word for word, so it is pinned on and
        // `deepenedBy` does the rest — the deeper condition under the same
        // source, the shallow one lifted and the timer gone with it, which is
        // why the save is repeated once.
        //
        // **And what the deeper condition is ended by comes with it.** SRD
        // Brass Dragon Wyrmling's minute is a span on the clock; SRD Silver
        // Dragon Wyrmling's ending is a save of its own, under the minute
        // after which the block says that save succeeds automatically — so a
        // cap is read into the deepening's span exactly as the first rung's
        // cap is read into the condition's, by `durationOf` below.
        const deepening = clause.repeats?.onFailure;
        const deepenedFor = deepening?.lasts?.seconds ?? deepening?.repeats?.capSeconds;
        const deeper: RepeatSave['onFailure'] =
          deepening === undefined
            ? undefined
            : {
                condition: deepening.condition,
                ...(deepenedFor === undefined ? {} : { lasts: { seconds: deepenedFor } }),
                ...(deepening.repeats === undefined ? {} : { repeats: repeatOf() }),
                // **And so do the deeper condition's early endings.** SRD
                // Brass Dragon Wyrmling: "This effect ends for the target if
                // it takes damage or a creature within 5 feet of it takes an
                // action to wake it." `deepenedBy` widens the flag back to
                // the condition's name when the boundary writes the event.
                ...(deepening.endsOnDamage === true ? { endsOnDamage: true as const } : {}),
                ...(deepening.endsWhenWoken === true ? { endsWhenWoken: true as const } : {}),
              };
        const repeat: RepeatSave | undefined =
          clause.repeats === undefined ? undefined : repeatOf(deeper);
        const landed = conditionLanding(
          applyConditionTo(
            current,
            target,
            clause.condition,
            conditionSource,
            [],
            durationOf(clause.lasts, clause.repeats?.capSeconds, source, target),
            repeat,
            {},
            grapple ? escapeCheck(source, clause.escapeDc!) : undefined,
            // SRD Couatl: "it has the Restrained condition until the grapple
            // ends." SRD Chuul: "While Poisoned, the target has the Paralyzed
            // condition." One lifetime, the cause's, which is exactly what
            // `ConditionInstance.impliedBy` means — so the implied condition
            // lifts at the escape, at the cure and at the deadline, through
            // the doors those already go through.
            clause.implies,
            // SRD Incubus: "for 1 hour, **until it takes damage, or until a
            // creature within 5 feet of it takes an action to wake it**." Two
            // endings nobody schedules — a blow and an onlooker's Action —
            // pinned onto the instances they are about, which is why they are
            // names: SRD Pseudodragon ends the Unconscious its Poisoned
            // carries and lets the hour of Poison run on.
            {
              ...(clause.endsOnDamage === undefined ? {} : { onDamage: clause.endsOnDamage }),
              ...(clause.endsWhenWoken === undefined ? {} : { whenWoken: clause.endsWhenWoken }),
            },
          ),
        );
        if (!landed.ok) return landed;
        if (!landed.value.landed) {
          immuneTo.push(clause.condition);
          break;
        }
        land(landed.value.events);
        // **What the hold costs at a turn boundary**, filed under the
        // grapple's own source so `holdStillStands` stops reading it the
        // moment the escape succeeds — the hit side's shape exactly, because
        // it is the same sentence. SRD Water Elemental's Whelm: "takes 9 (2d8)
        // Bludgeoning damage at the start of each of **the elemental's**
        // turns", which is the holder's boundary and the held creature's
        // hit points, a round apart.
        //
        // Only onto a grapple: the sentence the book writes here says "until
        // the grapple ends", and an arrangement filed under the line instead
        // would be a debt nothing could ever settle.
        if (clause.payout !== undefined && grapple) {
          const collector = clause.payout.onTurnOf === 'source' ? source : target;
          land([
            {
              type: 'turn-payout-granted',
              id: collector,
              payout: {
                source: conditionSource,
                at: clause.payout.at === 'start' ? 'start-of-turn' : 'end-of-turn',
                payout: 'damage',
                // A notation, thrown at each boundary and never here — and
                // absent where a homebrew line prints a flat amount alone,
                // which is what a null `dice` means everywhere in `@ie/srd`.
                ...(clause.payout.damage.dice === null ? {} : { dice: clause.payout.damage.dice }),
                flat: clause.payout.damage.flat,
                damageType: clause.payout.damage.type,
                ...(collector === target ? {} : { to: target }),
              },
            },
          ]);
        }
        landedInstances.set(clause.condition, conditionInstanceId(clause.condition, conditionSource));
        // What the **line** said, which is this clause and whatever it said
        // the clause carries. The implications a condition always has are not
        // here and should not be: those are what the condition means, and a
        // caller reading this is reading what the block printed.
        conditions.push(clause.condition, ...(clause.implies ?? []));
        break;
      }

      case 'push': {
        // "pushed up to 20 feet straight away from the elemental": the shove
        // a spell delivers, with the forcing creature as the origin.
        const pushed = shoveAwayFrom(current, target, source, { feet: clause.feet }, line);
        land(pushed.events);
        unverified.push(...pushed.unverified);
        if (pushed.events.length > 0) pushedFeet = clause.feet;
        break;
      }

      case 'speed-decrease': {
        // A signed grant on the target for the span, exactly as Ray of Frost's
        // ten feet are hung and released.
        const grantSource = `${lineSource}:speed`;
        const duration = durationOf(clause.lasts, undefined, source, target);
        if (duration === undefined) break;
        const timer = schedule(current, { kind: 'grants', on: target, source: grantSource }, duration);
        if (!timer.ok) return timer;
        land([
          {
            type: 'speed-modifier-granted',
            id: target,
            modifier: { source: grantSource, change: 'add', feet: -clause.feet },
          },
          timer.value,
        ]);
        break;
      }

      case 'roll-mode': {
        // SRD Swarm of Ravens: "While Deafened, the target also has
        // Disadvantage on ability checks and attack rolls." The mode is the
        // same grant every other door hangs; what is new is the **lifetime**,
        // and the sentence names no span at all. It names a condition — the
        // one *this failure* just imposed — so the grant is sourced to that
        // instance's id, and the instance lifting is the whole of its ending:
        // the printed span running out, a cure, a repeat save succeeded.
        //
        // **And therefore no `grants` timer beside it.** The instance is the
        // deadline, and a second one could only come to disagree with it — see
        // `releaseInstanceGrants` in `fold/release.ts`, where the release is.
        const instance = landedInstances.get(clause.whileCondition);
        if (instance === undefined) {
          // The condition is not there, so there is nothing for the mode to
          // live on — an immune target, which is the one way a clause the
          // reader gated can still find no host. A grant sourced to an
          // instance nobody created would be a Disadvantage nothing could ever
          // lift, so it is not written and the caller is told, exactly as
          // `immuneTo` tells them about the condition itself.
          unverified.push(
            `${line} gives ${target} ${clause.mode} while ${conditionTitle(clause.whileCondition)}, and the ${conditionTitle(clause.whileCondition)} condition did not land on them — nothing was hung`,
          );
          break;
        }
        // One grant per roll the sentence names, because a `RollModifier`
        // carries one selector — `printedSunlight` reads the same two nouns
        // the same way. They share a source, so one ending takes both.
        land(
          clause.rolls.map((roll) => ({
            type: 'roll-modifier-granted',
            id: target,
            modifier: {
              source: instance,
              modifier: { mode: clause.mode, selector: { roll: PRINTED_ROLL[roll], relation: 'roller' } },
            },
          })),
        );
        break;
      }

      case 'action-rule':
      case 'speed-halved': {
        // SRD Dretch: "While Poisoned, the creature can take either an action
        // or a Bonus Action on its turn, not both, and it can't take
        // Reactions." SRD Copper Dragon Wyrmling: the same rules, and a Speed
        // halved beside them, under one printed span.
        //
        // **Two lifetimes, one clause**, which is why these two share a case:
        // the corpus prints each of them both ways. A `whileCondition` is
        // sourced to the instance the same failure created and carries no
        // deadline of its own — the Ravens' reading exactly — and a `lasts` is
        // a `grants` timer, which is the Steam Mephit's Speed cut exactly.
        const hung = hangTo(clause, lineSource, landedInstances);
        if (hung === null) {
          // Either the sentence named a condition that did not land — an
          // immune target, which is the one way a clause the reader gated can
          // still find no host — or it reached here with no lifetime at all,
          // which `parsePrintedSave` refuses and a pinned record from some
          // other door might not. A rule nothing could ever lift is not
          // written, and the caller is told.
          unverified.push(describeUnhung(clause, line, target));
          break;
        }
        if (hung.deadline !== undefined && !scheduled.has(hung.source)) {
          const duration = durationOf(hung.deadline, undefined, source, target);
          if (duration === undefined) break;
          const timer = schedule(
            current,
            { kind: 'grants', on: target, source: hung.source },
            duration,
          );
          if (!timer.ok) return timer;
          scheduled.add(hung.source);
          land([timer.value]);
        }
        land([
          clause.kind === 'speed-halved'
            ? {
                type: 'speed-modifier-granted',
                id: target,
                modifier: { source: hung.source, change: 'halve' },
              }
            : {
                type: 'action-rule-granted',
                id: target,
                // The vocabulary is `combat.ts`'s and the clause is
                // `@ie/srd`'s, and this assignment is the seam: a slot word
                // the book's side gains and the engine's side has not is a
                // compile error here rather than a rule nobody enforces.
                rule: { source: hung.source, rule: clause.rule, label: line, until: hung.until },
              },
        ]);
        break;
      }

      case 'dies': {
        // SRD Will-o'-Wisp: "The target dies, and the wisp regains 10 (3d6)
        // Hit Points." **`creature-died` and not damage**, which is the
        // engine's own distinction: a healthy creature taking exactly its
        // maximum drops to 0 and does not die, and a sentence that kills is
        // not a blow — no Resistance halves it, no Concentration save answers
        // it and no Temporary Hit Points stand in front of it.
        // **The ceiling the line prints on who it may be forced on**, read off
        // the targeting clause because it is a number the engine holds rather
        // than an area it would have to measure. Reported and not applied, the
        // reading the size gate above already takes: the save was thrown, the
        // line reached nobody it could kill, and a caller is told so rather
        // than left to read a nought.
        const vitals = current.creatures[target]?.vitals;
        if (vitals === undefined) break;
        if (
          clause.ifHitPointsAtMost !== undefined &&
          vitals.hp > clause.ifHitPointsAtMost
        ) {
          unverified.push(
            `${line} kills a creature with ${clause.ifHitPointsAtMost} Hit Points or fewer, and ${target} has ${vitals.hp} — nothing here died`,
          );
          break;
        }
        // A creature already dead is not made deader, and nothing is written —
        // the reading `declareCreatureDead` takes of the same event. A second
        // use on the same corpse buys the creature that forced it nothing.
        if (vitals.dead) break;
        land([{ type: 'creature-died', id: target, cause: line }]);
        died.push(target);
        if (clause.sourceRegains === undefined) break;
        // The second half of the same sentence, in the same order the book
        // prints it: the dice are the block's, so the engine throws them.
        const sheet = current.creatures[source]?.sheet;
        if (sheet === undefined) break;
        const rolled = rollSpellDice(supply, sheet, line, 'healing', clause.sourceRegains.dice);
        if (!rolled.ok) return rolled;
        const amount = Math.max(
          0,
          rolled.value.reduce((sum, one) => sum + one.total, 0) + clause.sourceRegains.flat,
        );
        if (amount <= 0) break;
        land([
          {
            type: 'roll-recorded',
            who: source,
            label: `${line} healing`,
            natural: 0,
            total: amount,
            contributions: [],
            outcome: 'healed',
          },
        ]);
        // The one door every restoration but a rest goes through, so a rule
        // standing in front of this creature's healing is consulted here too.
        const healed = healCreature(current, source, amount);
        if (!healed.ok) return healed;
        land(healed.value);
        break;
      }

      case 'drops-to-zero': {
        // SRD Sea Hag: "it drops to 0 Hit Points." **Not damage**, which is
        // the whole of why the event exists: the temporary pool is not spent,
        // no Concentration save is raised, and no floor is offered. See
        // `hit-points-dropped-to-zero`.
        const creature = current.creatures[target];
        if (creature === undefined) break;
        const dropped = dropToZero(creature.vitals);
        // A creature already at 0 does not drop again and the dead are not
        // made deader — `dropToZero` answers both by coming back unchanged,
        // and nothing is written, the reading the `dies` clause above takes.
        if (dropped === creature.vitals) break;
        land([{ type: 'hit-points-dropped-to-zero', id: target, source: line }]);
        if (dropped.dead) {
          // A monster that dies the instant it drops. The Unconscious a drop
          // would have caused is not applied, and one it was already carrying
          // goes, which is `damageCreature`'s pair of clauses exactly.
          if (hasCondition(creature.conditions, 'unconscious')) {
            land([
              { type: 'condition-removed', id: target, condition: 'unconscious', source: ZERO_HIT_POINTS },
            ]);
          }
          died.push(target);
        } else {
          // SRD: "If you reach 0 Hit Points and don't die instantly, you have
          // the Unconscious condition ... until you regain any Hit Points."
          // The same source every other drop to 0 hangs it on, so healing
          // lifts this one exactly as it lifts a blow's.
          land([
            { type: 'condition-applied', id: target, condition: 'unconscious', source: ZERO_HIT_POINTS },
          ]);
          conditions.push('unconscious');
        }
        // "When you reduce an enemy to 0 Hit Points" is what happened, so the
        // feature that watches for it is asked here as well as on the two
        // damage roads. The creature that forced the save is the one who did
        // it — see {@link rewardsForDropping}.
        const spoils = rewardsForDropping(current, target, source);
        land(spoils.events);
        unverified.push(...spoils.unverified);
        break;
      }

      case 'hit-point-maximum-decrease': {
        // "by an amount equal to the damage taken" — nothing taken, nothing
        // lowered. Sourced per use, so a second bite lowers it again.
        //
        // **And where the sentence names a component, it is that component
        // alone.** SRD Vampire Spawn's Bite is Piercing *plus* Necrotic and
        // lowers the maximum "by an amount equal to the Necrotic damage
        // taken"; the whole blow would be the Wight's reading applied to a
        // line the book wrote differently. A blow that landed nothing at all
        // — a threshold turned it aside — is nothing of every type, which is
        // the clause above.
        if (dealt.total <= 0) break;
        const amount =
          clause.ofType === undefined ? dealt.total : (dealt.byType[clause.ofType] ?? 0);
        if (amount <= 0) break;
        land([
          {
            type: 'hit-point-maximum-adjusted',
            id: target,
            adjustment: { source: `${lineSource}:${useTag}`, amount: -amount },
          },
        ]);
        if (clause.sourceRegains === undefined) break;
        // "and the vampire regains Hit Points equal to that amount" — the
        // second half of the same sentence, in the order the book prints it
        // and with no dice anywhere: the amount is the one just computed. The
        // Will-o'-Wisp's regain is the neighbouring shape and throws the
        // block's own dice, which is why the two are spelled apart.
        if (current.creatures[source] === undefined) break;
        const fed = healCreature(current, source, amount);
        if (!fed.ok) return fed;
        land(fed.value);
        break;
      }

      case 'line-immunity': {
        // SRD Ghost: "_Success:_ The target is immune to this ghost's Horrific
        // Visage for 24 hours." An immunity to **one printed line** and not to
        // the condition it imposes — a second ghost's visage still frightens
        // them — so it is hung on the line's own source with a `grants`
        // deadline over it, and `forcePrintedSave` reads it where it gathers
        // who the line caught.
        //
        // **The heading the sentence names is checked**, because the reader
        // was handed the line's text without its heading and this is where the
        // two meet. A block that named some other line of its own would be a
        // sentence nobody here can honour, so it is reported rather than
        // guessed at — the reading every unhosted clause above takes.
        if (!line.startsWith(clause.line)) {
          unverified.push(
            `${line} says the target becomes immune to "${clause.line}", which is not this line — nothing was granted`,
          );
          break;
        }
        const timer = schedule(
          current,
          { kind: 'grants', on: target, source: lineSource },
          { kind: 'seconds', seconds: clause.seconds },
        );
        if (!timer.ok) return timer;
        land([
          {
            type: 'printed-line-immunity-granted',
            id: target,
            immunity: { source: lineSource, by: source, line },
          },
          timer.value,
        ]);
        break;
      }
    }
  }

  return ok({ events, unverified, conditions, immuneTo, pushedFeet, died: died.length > 0 });
}
