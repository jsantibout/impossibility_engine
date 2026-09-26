/**
 * **A body that becomes another block** — W7-B12.
 *
 * SRD Incubus, Succubus Form: "When the incubus finishes a Long Rest, it can
 * shape-shift into a **Succubus**, using that stat block instead of this one.
 * Any equipment it is wearing or carrying isn't transformed." SRD Succubus,
 * Incubus Form, the other way round.
 *
 * SRD Troll Limb, Troll Spawn: "If the limb isn't destroyed within 24 hours,
 * roll 1d12. On a 12, the limb turns into a **Troll**. Otherwise, the limb
 * withers away."
 *
 * Two printed lines and one change, reached by two moments: a Long Rest the
 * creature has just finished, which the DM's door takes at the creature's
 * choice, and a deadline the arrival hung, which is a debt the engine throws
 * the die for. The change itself is `stat-block-replaced` — the other block's
 * arrival over the same creature, every number the adapter read pinned — and
 * not `assumeStatBlock`, which is SRD Wild Shape's merge of two sheets and
 * keeps the holder's Hit Points; "using that stat block instead of this one"
 * keeps nothing the book prints.
 */

import { type CharacterId, err, needsContext, ok, type Result } from '@ie/shared';
import { hasCondition } from '../conditions.js';
import type { Content } from '../content.js';
import { applyEvent, type CommandStamp, type GameEvent, type GameState } from '../events.js';
import { type CommandIdentity, once } from '../idempotency.js';
import { adaptMonster } from '../monster.js';
import { rollRecorded } from '../rolls.js';
import type { Supply } from './casting.js';
import { creatureOf, unknownCreature, ZERO_HIT_POINTS } from './command.js';
import { removeCreatureEverywhere } from './creatures.js';

/**
 * The events that make an existing creature another stat block — the adapter's
 * reading of the block, pinned whole, and the Unconscious a 0 the old block
 * lay at leaves behind lifted, because the new block arrives at full.
 */
export function becomeBlock(
  state: GameState,
  content: Content,
  id: CharacterId,
  blockId: string,
  cause: string,
  stamp: CommandStamp | null,
): Result<GameEvent[]> {
  const creature = creatureOf(state, id);
  if (creature === null) return unknownCreature(id);
  const block = content.monsterById(blockId);
  if (block === null) {
    return err('unknown_monster', `${blockId} is not a stat block this world holds`);
  }
  const adapted = adaptMonster(block, id);
  return ok([
    {
      type: 'stat-block-replaced',
      id,
      block: blockId,
      name: adapted.name,
      sheet: adapted.sheet,
      maxHp: adapted.vitals.hpMax,
      diesAtZero: adapted.vitals.diesAtZero,
      creatureType: adapted.creatureType,
      alignment: adapted.alignment,
      defenses: adapted.defenses.byDamageType,
      conditionImmunities: adapted.defenses.conditionImmunities,
      size: adapted.size,
      cr: adapted.cr,
      spellcasting: adapted.spellcasting,
      pools: adapted.pools,
      cause,
      ...(stamp === null ? {} : { command: stamp }),
    },
    ...(creature.vitals.hp === 0 && hasCondition(creature.conditions, 'unconscious')
      ? [
          {
            type: 'condition-removed' as const,
            id,
            condition: 'unconscious' as const,
            source: ZERO_HIT_POINTS,
          },
        ]
      : []),
  ]);
}

/** What the DM's door takes a rest form with — the block, where the line offers several. */
export interface RestFormCommand extends CommandIdentity {
  /** The block to become, by its id in content. Optional where the line offers one. */
  readonly block?: string;
}

/**
 * Take the form a creature's own line offers at the end of a Long Rest.
 *
 * SRD Succubus Form: "When the incubus finishes a Long Rest, it **can**
 * shape-shift" — a choice, so a door the DM takes rather than something the
 * rest does by itself, and a window the rest opens: the creature's last Long
 * Rest ended at this very instant on the clock. Once per rest: a creature that
 * has already changed at this instant is refused a second change, so the
 * succubus the incubus became cannot take its own line straight back.
 */
export function takeRestForm(
  state: GameState,
  content: Content,
  id: CharacterId,
  command: RestFormCommand = {},
): Result<GameEvent[]> {
  return once(state, `rest-form:${id}`, command, () => [], (stamp) => {
    const creature = creatureOf(state, id);
    if (creature === null) return unknownCreature(id);

    const offered = (creature.sheet.stated?.traits ?? []).flatMap((trait) =>
      trait.kind === 'becomes-another-block-at-a-long-rest' ? [trait.block] : [],
    );
    if (offered.length === 0) {
      return err('no_rest_form', `${id}'s block prints no form it takes at a Long Rest`);
    }
    if (command.block !== undefined && !offered.includes(command.block)) {
      return err(
        'not_this_lines_form',
        `${id}'s block becomes ${offered.join(' or ')} at a Long Rest, and ${command.block} is not one of them`,
      );
    }
    const block = command.block ?? (offered.length === 1 ? offered[0]! : undefined);
    if (block === undefined) {
      return needsContext('undeclared_form', `${id} may become ${offered.join(' or ')}, and nobody has said which`, [
        {
          kind: 'creature',
          subject: id,
          need: `which of ${offered.join(', ')} ${id} becomes`,
          because: 'the block offers more than one form at a Long Rest and the engine chooses none',
          satisfyWith: 'takeRestForm again with its block named',
        },
      ]);
    }
    // "When the incubus **finishes** a Long Rest": the rest ended at this very
    // instant, and nothing has changed the creature's block since.
    const finished = creature.lastLongRestAt;
    if (finished === null || finished !== state.elapsed || creature.blockReplacedAt === state.elapsed) {
      return err(
        'no_long_rest_just_finished',
        `${id} takes this form when it finishes a Long Rest, and ${
          finished === null
            ? 'it has not finished one'
            : creature.blockReplacedAt === state.elapsed
              ? 'it has already changed at the end of this one'
              : 'time has passed since its last one ended'
        }`,
      );
    }
    return becomeBlock(state, content, id, block, `a Long Rest's end (${block})`, stamp);
  });
}

/**
 * Every creature whose block's own countdown has run out, alive, in id order —
 * SRD Troll Spawn's "if the limb isn't destroyed within 24 hours".
 *
 * **Derived from the world as it stands**, which is `strandedSummons`' reading
 * of the same kind of debt: a limb destroyed before the day is up is dead and
 * owes nothing, and one taken out of the game took its countdown with it.
 */
export function blockDeadlinesDue(state: GameState): readonly CharacterId[] {
  return (Object.keys(state.creatures) as CharacterId[]).sort().filter((who) => {
    const creature = state.creatures[who];
    const deadline = creature?.blockDeadline;
    return (
      creature !== undefined &&
      deadline !== undefined &&
      !creature.vitals.dead &&
      state.elapsed >= deadline.at
    );
  });
}

/** What settling the due countdowns threw, and what it did with each face. */
export interface BlockDeadlinesSettled {
  readonly events: readonly GameEvent[];
  readonly duplicate: boolean;
}

/**
 * Throw the die every due countdown owes, and change or remove each creature.
 *
 * SRD Troll Spawn: "roll 1d12. On a 12, the limb turns into a **Troll**.
 * Otherwise, the limb withers away." The die is the engine's, thrown out of
 * the generator and recorded; on the printed face or better the creature
 * becomes the block its line names (read out of content now and pinned), and
 * otherwise it leaves the game through the door every departure takes.
 *
 * **Refused without a generator** where a throw is owed, on
 * `settleStartOfTurnRecharges`' rule, and **an empty batch** where nothing is
 * due — a caller sweeping after every passage of time must not have to tell
 * "nothing to do" from a refusal. The turn boundary refuses to advance while
 * anything is owed, so a fight cannot run past a limb's day.
 */
export function settleBlockDeadlines(
  state: GameState,
  supply: Supply | undefined,
  command: CommandIdentity = {},
): Result<BlockDeadlinesSettled> {
  return once(state, 'settle-block-deadlines', { ...command }, () => ({ events: [], duplicate: true }), (stamp) => {
    const due = blockDeadlinesDue(state);
    if (due.length === 0) return ok({ events: [], duplicate: false });
    if (supply === undefined) {
      return err(
        'block_change_owed',
        `${due.join(', ')} ${due.length === 1 ? 'owes' : 'owe'} the die a printed line throws when its day runs out; settling needs a generator to throw it`,
      );
    }

    const events: GameEvent[] = [];
    let current = state;
    for (const who of due) {
      const deadline = current.creatures[who]?.blockDeadline;
      if (deadline === undefined) continue;
      const issuedBefore = supply.issuer.count;
      const rolled = rollRecorded(supply.issuer, supply.rng, deadline.dice);
      if (!rolled.ok) return rolled;
      const face = rolled.value.total;
      const thrown: GameEvent[] = [
        {
          type: 'roll-recorded',
          who,
          label: `${who}'s ${deadline.line} (${deadline.dice}; ${deadline.on} or more)`,
          natural: face,
          total: face,
          contributions: [],
          outcome: face >= deadline.on ? `becomes ${deadline.block}` : 'withers away',
        },
        {
          type: 'rolls-issued',
          count: supply.issuer.count - issuedBefore,
          rng: supply.rng.snapshot(),
        },
      ];
      events.push(...thrown);
      current = thrown.reduce(applyEvent, current);

      const ending =
        face >= deadline.on
          ? becomeBlock(current, supply.content, who, deadline.block, deadline.line, null)
          : removeCreatureEverywhere(current, who);
      if (!ending.ok) return ending;
      events.push(...ending.value);
      current = ending.value.reduce(applyEvent, current);
    }

    // The stamp rides the first die's record, the one event this command is
    // certain to have written if it wrote anything.
    if (stamp === null) return ok({ events, duplicate: false });
    return ok({
      events: events.map((event, index) =>
        index === 0 && event.type === 'roll-recorded' ? { ...event, command: stamp } : event,
      ),
      duplicate: false,
    });
  });
}
