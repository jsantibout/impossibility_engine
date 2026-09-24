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
 * **Nothing here reads the block.** The clauses arrive already pinned on the
 * sheet (`StatedAction.save`), which is what `creature-added` pinned when the
 * block was read; the fold opens no catalogue and this opens no block.
 *
 * Two honesties the caller reports: an immune target is *named* rather than
 * silently skipped (`immuneTo`), and a size gate that spared a creature says
 * so in `unverified`, exactly as the attack path's rider does.
 */

import { ABILITY_NAMES, type CharacterId, type ConditionName, ok, type Result } from '@ie/shared';
import type { MonsterSave, PrintedSaveEffect, PrintedSpan } from '@ie/srd';
import { applyEvent, type GameEvent, type GameState } from '../events.js';
import { sizeAtMost, sizeOf } from '../positioning.js';
import type { Duration } from '../time.js';
import type { RepeatSave } from '../timers.js';
import { applyConditionTo, schedule } from './conditions.js';
import { healCreature } from './creatures.js';
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

/**
 * Apply the clauses one outcome of a printed save carries to one creature.
 *
 * @param dealt what the line's damage came to on this target after its own
 * defences, which is what "an amount equal to the damage taken" reads.
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
  dealt: number,
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
        const repeat: RepeatSave | undefined =
          clause.repeats === undefined
            ? undefined
            : {
                at: 'end-of-turn',
                of: target,
                ability: save.ability,
                dc: save.dc,
                onSuccess: 'end-on-target',
                // SRD Gorgon: "_Second Failure:_ The target has the Petrified
                // condition instead of the Restrained condition." The printed
                // field is `RepeatSave.onFailure` word for word, so it is
                // pinned on and `deepenedBy` does the rest — the deeper
                // condition under the same source, the shallow one lifted and
                // the timer gone with it, which is why the save is repeated
                // once. A line that printed both a span and a deepening would
                // race its own deadline; none does, and the reader is what
                // says so.
                ...(clause.repeats.onFailure === undefined
                  ? {}
                  : { onFailure: { condition: clause.repeats.onFailure.condition } }),
                label: `${ABILITY_NAMES[save.ability]} save vs ${line}`,
              };
        const landed = conditionLanding(
          applyConditionTo(
            current,
            target,
            clause.condition,
            grapple ? grappleSource(source) : lineSource,
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
          ),
        );
        if (!landed.ok) return landed;
        if (!landed.value.landed) {
          immuneTo.push(clause.condition);
          break;
        }
        land(landed.value.events);
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

      case 'dies': {
        // SRD Will-o'-Wisp: "The target dies, and the wisp regains 10 (3d6)
        // Hit Points." **`creature-died` and not damage**, which is the
        // engine's own distinction: a healthy creature taking exactly its
        // maximum drops to 0 and does not die, and a sentence that kills is
        // not a blow — no Resistance halves it, no Concentration save answers
        // it and no Temporary Hit Points stand in front of it.
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

      case 'hit-point-maximum-decrease': {
        // "by an amount equal to the damage taken" — nothing taken, nothing
        // lowered. Sourced per use, so a second bite lowers it again.
        if (dealt <= 0) break;
        land([
          {
            type: 'hit-point-maximum-adjusted',
            id: target,
            adjustment: { source: `${lineSource}:${useTag}`, amount: -dealt },
          },
        ]);
        break;
      }
    }
  }

  return ok({ events, unverified, conditions, immuneTo, pushedFeet, died: died.length > 0 });
}
