/**
 * A creature entering the game, hit points, Exhaustion, and a creature leaving
 * it.
 *
 * The batches this file was named for. Dropping to 0 hit points makes a
 * creature Unconscious; healing from 0 lifts *that* unconsciousness and
 * nothing else; Exhaustion 6 kills. Leaving those follow-ups to the caller
 * meant relying on a language model to remember bookkeeping the rules already
 * mandate.
 *
 * **Nothing in it is an action in the turn economy**, which is a claim about
 * the whole module rather than about `addCreature` alone, and it is the reason
 * this file joins `commands/scene.ts` and `commands/declarations.ts` in
 * `DECLARED_NOT_ACTED`. Damage, healing, an Exhaustion level, Temporary Hit
 * Points and a creature leaving are every one of them the *outcome* of
 * something that spent its own cost through its own command — the reading
 * `stabiliseCreature` already takes — and a monster walking through the door
 * spends nobody anything. None of them consults `mayAct`, and the sweep checks
 * that against the code rather than against this sentence.
 */

import { type CharacterId, err, ok, type Result } from '@ie/shared';
import { hasCondition } from '../conditions.js';
import type { Content } from '../content.js';
import { applyEvent, type GameEvent, type GameState } from '../events.js';
import { type CommandIdentity, once } from '../idempotency.js';
import { addCombatant } from '../combat.js';
import { adaptMonster } from '../monster.js';
import type { Placement } from '../positioning.js';
import { speedOf } from '../standing.js';
import { applyDamageToVitals, healingRuleOf, isDown } from '../vitals.js';
import { creatureOf, unknownCreature, ZERO_HIT_POINTS } from './command.js';
import { settleHoldsInvolving } from './holds.js';

export interface AddCreatureOutcome {
  readonly events: readonly GameEvent[];
  /**
   * Facts the engine could not check — see `AttackResolution.unverified`.
   *
   * A stat block's *qualified* defences land here and nowhere else: this
   * command is the only thing that ever sees them, because the qualification
   * is a rule the engine cannot evaluate and therefore has no business
   * carrying in state as though it could.
   */
  readonly unverified: readonly string[];
  readonly duplicate: boolean;
}

/**
 * Put a monster into the game, with the numbers and defences it prints.
 *
 * **The fourteenth instance of this repository's most persistent finding**, and
 * the largest since the scene commands: `adaptMonster` has turned a parsed stat
 * block into something the engine can fight since the bestiary landed, and
 * every caller of it was a test. So nothing above the engine could put a
 * monster into a game without folding a `creature-added` by hand — which is
 * narration writing straight to truth, the first thing the doctrine forbids,
 * and which `unknownCreature`'s own context request had to tell a caller to
 * do.
 *
 * It **wraps** `adaptMonster` and computes nothing of its own. Every number in
 * the event is the adapter's: the printed Armour Class, the stated saves and
 * skills, the average hit points, "a monster dies the instant it drops to 0",
 * the creature type the parser has read since `Small Fey (Goblinoid)`, and the
 * two halves of the defence run a stat block prints in one line.
 *
 * **It takes the stat block's id and reads the block out of `content`**, which
 * is what `equipItem` does with an item and for a sharper reason. An engine
 * entry point that accepts a whole stat block is a door a model-authored
 * Armour Class can walk through, and nothing guards it: `boundary.test.ts`
 * proves `recordExternalD20` and `recordExternalDamage` are unreachable *by
 * name*, and a value parameter is on nobody's list. So the caller states which
 * monster and the engine supplies every number.
 *
 * This is also what makes `unknown_monster` a rule rather than a comment. It
 * used to be withheld on the grounds that there was no catalogue to look a
 * block up in and a guard nothing can reach is not a rule; a monster is
 * content now, and the refusal is reachable from the first line.
 *
 * **It does not declare what the creature casts**, and that is the parser
 * rather than a gap: a stat block prints its spellcasting as English prose in
 * a trait, and `Monster` carries no ability, no list and no slots. Reading one
 * out of that prose would be the engine deciding a fact the SRD wrote for a
 * person; `declareSpellcasting` is the command that states it, and an NPC who
 * casts takes two commands exactly as `scene-commands.test.ts`'s priest does.
 * `declareCreatureSide` is the same answer for allegiance, which changes in
 * play and therefore cannot be a property of arriving.
 *
 * **It refuses what the reducer would call corrupt** — a creature already in
 * the game — which is the rule the scene commands settled, **and the one
 * thing the reducer cannot see**: a stat block this world does not hold. That
 * second refusal is not a duplicated check but the only one there is, because
 * the event carries the adapted sheet and never the id, so there is no
 * catalogue lookup left in the fold to disagree with. Both sit *below* the
 * duplicate check, because this command's own first run is what makes the
 * world answer `already_present`: `once` is why there is nowhere above to
 * write one. The order between them is the roster first, on the same reading
 * `summonCreature` states — the world as it stands before the book it is
 * being asked to open.
 */
export function addCreature(
  state: GameState,
  content: Content,
  id: CharacterId,
  monsterId: string,
  command: CommandIdentity = {},
): Result<AddCreatureOutcome> {
  // The stat block's **id** and not the block: a fingerprint is stored in
  // state for as long as the game lasts, and a parsed monster is kilobytes of
  // JSON. The id is the stat block's identity — the parser assigns one per
  // entry, and `checkContent` refuses a catalogue that files two under one —
  // and the kind already carries the creature being added.
  return once(
    state,
    `add-creature:${id}`,
    { ...command, monster: monsterId },
    () => ({ events: [], unverified: [], duplicate: true }),
    (stamp) => {
      if (creatureOf(state, id) !== null) {
        return err('already_present', `${id} is already in this game`);
      }

      // Asked of content, which is where a monster comes from. A world that
      // does not hold this stat block cannot raise it, and that is a wrong
      // fact rather than a missing one — nothing a caller could go and find
      // out would make an absent catalogue entry present.
      const monster = content.monsterById(monsterId);
      if (monster === null) {
        return err('unknown_monster', `${monsterId} is not a stat block this world holds`);
      }

      const adapted = adaptMonster(monster, id);
      const { byDamageType, conditionImmunities, qualified } = adapted.defenses;

      return ok({
        events: [
          {
            type: 'creature-added',
            id,
            name: adapted.name,
            sheet: adapted.sheet,
            maxHp: adapted.vitals.hpMax,
            diesAtZero: adapted.vitals.diesAtZero,
            creatureType: adapted.creatureType,
            defenses: byDamageType,
            // Pinned so that placing this creature is not a second reading of
            // a fact the book already answered, and so that nobody above the
            // engine is asked to state one.
            size: adapted.size,
            ...(conditionImmunities.length === 0 ? {} : { conditionImmunities }),
            ...(stamp === null ? {} : { command: stamp }),
          },
        ],
        // **Withheld and reported, never applied.** "Charmed (except from its
        // vampire master)" as a flat immunity makes the vampire unable to
        // charm the one creature the entry exists to let it charm, which is
        // the documented wrong answer and the reason
        // `conditionApplicability` answers three ways rather than two. The
        // entries the adapter could classify as neither a damage type nor a
        // condition come back for the same reason: the engine read them and
        // could do nothing with them.
        unverified: [
          ...qualified.map(
            (entry) =>
              `${id}: ${entry.printed} — the engine cannot evaluate "${entry.qualification}", so the ${entry.kind} is not applied`,
          ),
          ...adapted.caveats.map(
            (printed) => `${id}: ${printed} — a defence the engine does not recognise`,
          ),
        ],
        duplicate: false,
      });
    },
  );
}

/**
 * A creature a casting is putting into the world, and where it arrives.
 *
 * Everything here except `monster` and `by` is optional, and each absence is
 * a real answer rather than a gap: a creature bound to no casting outlives
 * every spell, a summoner with no declared side gives none, a creature nobody
 * placed is unplaced exactly as any other creature is, and a fight that is
 * not running has no order to join.
 */
export interface Summons {
  /** What to call the new creature. */
  readonly id: CharacterId;
  /** Which stat block, by its id in content — exactly as {@link addCreature} takes one. */
  readonly monsterId: string;
  /** The summoner. */
  readonly by: CharacterId;
  /**
   * The casting that holds it here, if one does.
   *
   * Omitted for a creature a spell *made* rather than sustains — SRD Animate
   * Dead is Instantaneous and its Skeleton is still standing next week — and
   * for a stat block a DM simply walks through the door, which is what
   * {@link addCreature} is.
   */
  readonly castingId?: string;
  /**
   * Which side it is on, when it is not the summoner's.
   *
   * Defaults to the summoner's own, because that is what a summons is. It is
   * still `side` — declared, changeable, the thing a bribed bandit and a
   * turned summons both move — rather than a second notion of ownership.
   */
  readonly side?: string;
  /** Where it appears. Its size is the stat block's and is not the caller's to state. */
  readonly placement?: Omit<Placement, 'size'>;
  /**
   * A **stated** Initiative total, for a DM who gives one.
   *
   * SRD's glossary: "sometimes a GM might have combatants use their
   * Initiative scores instead of rolling Initiative", which is the same
   * number `beginCombat` and `joinCombat` already take from a caller. The
   * engine ranks and does not roll on anybody's behalf here.
   *
   * **Absent is not a refusal.** A creature that does not exist yet cannot be
   * rolled for — `rollInitiativeFor` answers `unknown_creature` — so a
   * `needs-context` asking for a total would name no route a caller could
   * take, and the only way to satisfy it would be to invent a number. So the
   * creature arrives without a rung in the order, and the two commands that
   * have always given one now work, because the creature is in the game:
   * `rollInitiativeFor` throws the die, `joinCombat` seats it. The same "two
   * commands" {@link addCreature} already documents for what a monster casts
   * and whose side it is on.
   */
  readonly initiative?: number;
  /** Ties, as `beginCombat` and `joinCombat` take them. */
  readonly tiebreak?: number;
}

/**
 * Bring a creature into a scene that is already running, on a spell's terms.
 *
 * **A door rather than a subsystem**, and the measurement that says so is the
 * body: every line below calls something that was already built.
 * {@link addCreature} turns the stat block into a creature with its numbers
 * pinned into `creature-added`; `creature-placed` puts it on the map at the
 * size the stat block prints; `combatant-joined` gives it a rung in a running
 * order. What did not exist is the one event between them —
 * `creature-summoned` — saying that a **casting** is the reason it is there.
 *
 * That link is the whole of what a summons adds, and what it buys is half of
 * the sentence every summoning spell prints: the engine can *tell* you the
 * creature should be gone. {@link strandedSummons} is where it says so,
 * {@link dismissStrandedSummons} is what acts on it, and `resolveTurn`
 * refuses to advance the order until somebody has.
 *
 * **Everything about the creature is read from content once, and nothing is
 * derived.** The sheet, the printed Armour Class, the average hit points, "a
 * monster dies the instant it drops to 0", the creature type, both halves of
 * the defence run and the size are the adapter's, read off the stat block the
 * caller named and pinned into the log at the moment of arrival — so a log
 * replayed next year raises this creature without opening anything. The
 * reading is `addCreature`'s and this command does not repeat it: even the
 * size the placement carries is read back off the arrival rather than adapted
 * a second time.
 *
 * **Three things it deliberately does not do.** It does not roll Initiative,
 * for the reason `joinCombat` does not. It does not decide what the creature
 * can cast — `declareSpellcasting` is that, exactly as it is for any monster.
 * And it does not derive a statistic from the summoner: a stat block whose
 * numbers come from a caster's level or a spell's slot is a different
 * mechanic, and `Summons` has nowhere to put one on purpose.
 */
export function summonCreature(
  state: GameState,
  content: Content,
  summons: Summons,
  command: CommandIdentity = {},
): Result<AddCreatureOutcome> {
  const { id, monsterId, by, castingId } = summons;

  // **Everything the caller stated, whole.** A retry that moved the placement
  // or changed the Initiative total is a *different* command, and
  // fingerprinting only the creature would answer it `duplicate` and drop it
  // silently, which is exactly the outcome `identify` exists to refuse. What
  // used to need care here — a parsed stat block being kilobytes of JSON in a
  // fingerprint that lives as long as the game — is gone: `monsterId` is the
  // id, which is what the fingerprint always reduced it to.
  return once(
    state,
    `summon-creature:${id}`,
    { ...command, ...summons },
    () => ({ events: [], unverified: [], duplicate: true }),
    (stamp) => {
      const summoner = creatureOf(state, by);
      if (summoner === null) return unknownCreature(by);

      const holding = castingId === undefined ? null : state.ongoing[castingId];
      // A binding to a casting that is not running would be taken away by the
      // very next fold, so the creature would arrive and vanish in one batch.
      // Refusing is the honest answer, and it is the same code
      // `endOngoingSpell` answers for a casting nobody is running.
      if (castingId !== undefined && holding === undefined) {
        return err('not_ongoing', `${castingId} is not a spell that is still running`);
      }
      // SRD: "**you** can dismiss it" — a casting is its caster's, which is
      // the rule `endOngoingSpell` states in the same words and the same
      // code. A creature held here by somebody else's spell would have a
      // summoner and a lifetime that disagreed about whose it was.
      if (holding != null && holding.caster !== by) {
        return err(
          'not_your_spell',
          `${castingId} is ${holding.caster}'s casting; it cannot be what holds ${by}'s ${id} here`,
        );
      }

      // Everything the creature *is* comes from here, unchanged and
      // uncomputed. Unstamped on purpose: a summons is **one** command, and
      // the arrival minting an identity of its own would put two entries in
      // `appliedCommands` for one thing that happened.
      const arrival = addCreature(state, content, id, monsterId);
      if (!arrival.ok) return arrival;

      // The one event this command always emits, so the stamp rides it rather
      // than a placement or a rung in the order that a summons may not have.
      const events: GameEvent[] = arrival.value.events.map((event, index) =>
        index === 0 && stamp !== null ? { ...event, command: stamp } : event,
      );

      // SRD summons are the summoner's. Declared rather than derived even
      // here: if nobody has said whose side the caster is on, nobody has said
      // whose side its hound is on either.
      const side = summons.side ?? summoner.side;
      if (side !== null && side !== undefined) {
        events.push({ type: 'creature-side-declared', id, side });
      }

      if (castingId !== undefined) {
        events.push({ type: 'creature-summoned', id, by, castingId });
      }

      if (summons.placement !== undefined) {
        // The size is the stat block's, and it is **read back** off the
        // arrival rather than adapted a second time — the same reading
        // `speedOf` takes below, asked of the world the arrival leaves. A
        // caller restating it is the one place the two could disagree about
        // how many cubes a Conjured Hound holds, which is why `Summons`
        // has nowhere to put one.
        const pinned = arrival.value.events.reduce(applyEvent, state).creatures[id]?.size;
        events.push({
          type: 'creature-placed',
          id,
          placement: {
            ...summons.placement,
            ...(pinned == null ? {} : { size: pinned }),
          },
        });
      }

      // A fight is running and the DM stated a total. See `Summons.initiative`
      // for why its absence is silence rather than a refusal.
      if (state.combat !== null && summons.initiative !== undefined) {
        const joining = {
          id,
          initiative: summons.initiative,
          // **Asked of the one reader, against the world the arrival leaves.**
          // The order pins a walking Speed and the command layer derives none
          // of its own — so rather than reading the stat block a second time,
          // this folds the `creature-added` forward and asks `speedOf` about a
          // creature that now exists. The same reading `removeCreatureEverywhere`
          // takes when it asks what a settlement left behind.
          speed: speedOf(events.reduce(applyEvent, state), id),
          ...(summons.tiebreak === undefined ? {} : { tiebreak: summons.tiebreak }),
        };
        // Asked here and asked again by the reducer, so the command and the
        // fold cannot disagree about where the creature landed.
        const joined = addCombatant(state.combat, joining);
        if (!joined.ok) return joined;
        events.push({ type: 'combatant-joined', combatant: joining });
      }

      return ok({ events, unverified: arrival.value.unverified, duplicate: false });
    },
  );
}

/**
 * Every creature still standing on a casting that is over.
 *
 * **What the engine knows, said out loud, because it may not act on it
 * alone.** A summons goes when its spell does, and a casting ends five ways
 * of which four are things nobody decides — a deadline arrived, a
 * Concentration broken by unconsciousness, a trigger pulled, the caster
 * leaving. The fold finds all four, and the fold emits nothing; a creature
 * leaving is a **batch** (`removeCreatureEverywhere`), because it has to
 * settle what the leaver owed before the key goes. So the two halves cannot
 * meet inside the reducer, and this is the seam: the engine reports who is
 * owed a departure and {@link dismissStrandedSummons} performs it.
 *
 * `withheldEndings` is the same shape for the same reason — an ending the
 * engine can see and will not invent.
 *
 * **And the turn refuses to advance while this answers anybody.** That was
 * once the gap here — nothing called the sweep, so the order went on past a
 * hound whose Bless had ended and the hound kept its rung, kept attacking and
 * kept being attacked. It is now a debt of the kind `owedAreaEffects` is, for
 * the same reason: forgetting a rule stops the game rather than quietly
 * losing it, and a ghost creature still standing is precisely the thing that
 * goes unnoticed for months. `resolveTurn` answers `summons_stranded` and
 * names whoever is owed a departure.
 *
 * **Derived rather than filed**, which is the one way it differs from an area
 * debt: that one records a moment that has passed and could not be recomputed
 * later, while this is a question about the world as it stands. So there is
 * no field, and nothing to keep in step with the answer below.
 *
 * The *settlement* still cannot live in the fold, which is why the debt
 * exists at all: a reducer emits nothing, and a departure is a batch that has
 * to close the leaver's holds before its key goes — a derived departure once
 * deleted a creature out from under the very command that was about to settle
 * its hold, which wedged the fight either way.
 *
 * Sorted, so the answer is fixed however the cast was assembled.
 */
export function strandedSummons(state: GameState): readonly CharacterId[] {
  return Object.keys(state.creatures)
    .sort()
    .flatMap((key) => {
      const creature = state.creatures[key];
      const bond = creature?.summonedBy;
      if (creature === undefined || bond == null) return [];
      return state.ongoing[bond.castingId] === undefined ? [creature.id] : [];
    });
}

/**
 * Take away every creature whose casting is over.
 *
 * The settling half of {@link strandedSummons}, and like `settleAreaEffects`
 * in both halves now: it performs whatever is owed rather than something the
 * caller has to name, and the turn refuses to advance until it has been
 * called. See {@link strandedSummons}.
 *
 * **The departure is the one the engine already models**, unchanged: each
 * creature goes through {@link removeCreatureEverywhere}, which settles the
 * holds it owed, ends the spell it was itself sustaining, takes it off the
 * map and out of the Initiative order, and ends the fight rather than
 * emptying it. Nothing about a summons leaving is different from anything
 * else leaving, so nothing about it is written twice.
 *
 * **To a fixed point, each removal folded forward before the next is asked
 * for.** A summons may be sustaining a summons — the hound's own spell
 * holding a sprite — and the sprite is stranded only in the world the
 * hound's departure leaves. Same reading `removeCreatureEverywhere` takes of
 * its own settlement, one level up. It terminates because every pass removes
 * a creature from `state.creatures` and {@link strandedSummons} only ever
 * names creatures that are still in it.
 *
 * **An empty batch is a real answer.** Nothing stranded is not a rule
 * anybody broke, and a caller sweeping after every ending must not have to
 * tell "nothing to do" from a refusal.
 */
export function dismissStrandedSummons(
  state: GameState,
  command: CommandIdentity = {},
): Result<GameEvent[]> {
  return once(state, 'dismiss-stranded-summons', { ...command }, () => [], (stamp) => {
    const events: GameEvent[] = [];
    let current = state;

    for (;;) {
      const who = strandedSummons(current)[0];
      if (who === undefined) break;
      const gone = removeCreatureEverywhere(current, who);
      if (!gone.ok) return gone;
      events.push(...gone.value);
      current = gone.value.reduce(applyEvent, current);
    }

    if (events.length === 0 || stamp === null) return ok(events);
    // The stamp rides the last event — the `creature-removed` of the last
    // creature to go, which is the one event this command is certain to have
    // emitted if it emitted anything at all.
    return ok([...events.slice(0, -1), { ...events[events.length - 1]!, command: stamp }]);
  });
}

export interface DamageCommand extends CommandIdentity {
  readonly amount: number;
  readonly critical?: boolean;
  /** What dealt it, for the audit trail. */
  readonly source?: string;
  /**
   * Which creature dealt it, where one did.
   *
   * Separate from `source`, which is prose and cannot be aimed at. A Reaction
   * that answers damage needs an id to answer; a trap has none, and that is a
   * real answer rather than a gap.
   */
  readonly by?: CharacterId;
}

/**
 * Damage a creature, with every consequence the rules attach to it.
 *
 * Returns the whole batch: the damage itself, and the unconsciousness that
 * follows a character dropping to 0 without dying.
 */
export function damageCreature(
  state: GameState,
  id: CharacterId,
  command: DamageCommand,
): Result<GameEvent[]> {
  // Before anything else: a retry of a command that already landed is a no-op,
  // not a second hit. This has to precede validation too — otherwise a retry
  // reports whatever the first attempt caused rather than that it happened.
  return once(state, `damage:${id}`, command, () => [], (stamp) => {
    const creature = creatureOf(state, id);
    if (creature === null) return unknownCreature(id);

    if (!Number.isFinite(command.amount) || command.amount < 0) {
      return err('bad_amount', `damage must be a non-negative number, got ${command.amount}`);
    }

    const events: GameEvent[] = [
      {
        type: 'damage-taken',
        id,
        amount: command.amount,
        ...(command.critical === undefined ? {} : { critical: command.critical }),
        ...(command.source === undefined ? {} : { source: command.source }),
        ...(command.by === undefined ? {} : { by: command.by }),
        ...(stamp === null ? {} : { command: stamp }),
      },
    ];

    // Ask the rules what this damage does before deciding what follows it.
    const outcome = applyDamageToVitals(creature.vitals, command.amount, {
      ...(command.critical === undefined ? {} : { critical: command.critical }),
    });

    // SRD: "If you reach 0 Hit Points and don't die instantly, you have the
    // Unconscious condition ... until you regain any Hit Points."
    if (outcome.droppedToZero && !outcome.died) {
      events.push({ type: 'condition-applied', id, condition: 'unconscious', source: ZERO_HIT_POINTS });
    }

    // A creature that dies is no longer unconscious from its hit points; it is
    // dead, which is a different state entirely.
    if (outcome.died && hasCondition(creature.conditions, 'unconscious')) {
      events.push({ type: 'condition-removed', id, condition: 'unconscious', source: ZERO_HIT_POINTS });
    }

    return ok(events);
  });
}

/**
 * Heal a creature, lifting the unconsciousness that having no hit points caused
 * and leaving every other cause of it alone.
 */
export function healCreature(
  state: GameState,
  id: CharacterId,
  amount: number,
  command: CommandIdentity = {},
): Result<GameEvent[]> {
  // The mirror of `damageCreature`, which has been guarded since command ids
  // landed. Healing was not, and a retried heal healed twice — the same bug in
  // the opposite direction, and the easier one to miss because nobody
  // complains about extra hit points until a boss fight.
  return once(state, `heal:${id}`, { ...command, amount }, () => [], (stamp) => {
    const creature = creatureOf(state, id);
    if (creature === null) return unknownCreature(id);

    if (!Number.isFinite(amount) || amount <= 0) {
      return err('bad_amount', `healing must be a positive number, got ${amount}`);
    }
    if (creature.vitals.dead) {
      return err('dead', `${id} is dead; hit points alone will not bring them back`);
    }

    // SRD Chill Touch: "it can't regain Hit Points until the end of your next
    // turn." **The door is here, so every caller of this function meets it** —
    // a Cure Wounds, a potion, a turn boundary's payout, a pool's use, a
    // feature's own self-heal — which is the whole reason a rule standing in
    // front of healing is a grant on the creature rather than a clause inside
    // one spell, and what a door a DM award ever gets would meet as well.
    //
    // **`rest.ts` is the one healing that does not come through here**, and it
    // is named rather than left to be discovered: a rest writes its `healed`
    // events itself, so a rule standing on a creature is not consulted by the
    // Hit Dice of a Short Rest or by a Long Rest's restoration. Nothing the
    // SRD prints can reach that gap — the two sentences of this shape are
    // Beacon of Hope's minute and Chill Touch's single turn, and the shortest
    // rest is an hour — so what is missing is a guard against homebrew rather
    // than a rule the book owns. It goes here when a rule outlives an hour.
    //
    // **An empty batch rather than a refusal**, and the distinction is the one
    // `err` exists to draw. Nothing was done wrong: the Cure Wounds was legal,
    // the slot is gone, the casting happened. What the rule says is that no
    // hit points were regained, and a log with no `healed` event in it says
    // exactly that. A refusal here would unwind a casting that the book says
    // took place.
    if (healingRuleOf(creature.healingRules) === 'prevented') return ok([]);

    const events: GameEvent[] = [
      { type: 'healed', id, amount, ...(stamp === null ? {} : { command: stamp }) },
    ];

    // SRD: the Unconscious condition from 0 hit points lasts "until you regain
    // any Hit Points". Only that cause lifts — a creature also held by Sleep
    // stays asleep.
    if (isDown(creature.vitals) && hasCondition(creature.conditions, 'unconscious')) {
      events.push({ type: 'condition-removed', id, condition: 'unconscious', source: ZERO_HIT_POINTS });
    }

    return ok(events);
  });
}

/**
 * Set a creature's Exhaustion level, and kill it if that reaches 6.
 *
 * SRD: "You die if your Exhaustion level is 6." Bundled here so the death is
 * not something a caller has to remember to apply separately.
 */
export function setExhaustionLevel(
  state: GameState,
  id: CharacterId,
  level: number,
  command: CommandIdentity = {},
): Result<GameEvent[]> {
  return once(state, `exhaustion:${id}`, { ...command, level }, () => [], (stamp) => {
    if (creatureOf(state, id) === null) {
      return unknownCreature(id);
    }

    if (!Number.isInteger(level) || level < 0 || level > 6) {
      return err('bad_level', `an Exhaustion level runs from 0 to 6, got ${level}`);
    }

    // The reducer applies the death itself, since "you die if your Exhaustion
    // level is 6" is a rule rather than a caller's decision. Damage would be the
    // wrong instrument: a healthy creature taking exactly its maximum drops to 0
    // rather than dying.
    return ok([{ type: 'exhaustion-set', id, level, ...(stamp === null ? {} : { command: stamp }) }]);
  });
}

/**
 * Take a creature out of the game, cleaning up everywhere it is referenced.
 *
 * A creature removed from the cast but left standing on the map and sitting in
 * the initiative order is a dangling reference waiting to be tripped over.
 */
export function removeCreatureEverywhere(
  state: GameState,
  id: CharacterId,
  command: CommandIdentity = {},
): Result<GameEvent[]> {
  // Before the creature is looked up. A retry arrives at a world where the
  // creature has already gone, and reporting `unknown_creature` for a removal
  // that succeeded is exactly the confusion command ids exist to prevent.
  return once(state, `remove:${id}`, command, () => [], (stamp) => {
    if (creatureOf(state, id) === null) {
      return unknownCreature(id);
    }

    // Anything this creature was holding up has to be settled first, or the
    // fight cannot continue without them.
    const events: GameEvent[] = [...settleHoldsInvolving(state, id)];

    // A caster leaving takes their ongoing spell with them, and the log should
    // say so rather than leaving the reader to infer it from the disappearance.
    //
    // **Read off the world the settlement above leaves, not the one before
    // it.** `settleHoldsInvolving` interrupts a casting the caster had
    // declared, and a casting of a minute or more is *concentrated on* — so
    // the interruption has already taken that Concentration, and a
    // `concentration-ended` naming it would be an event the fold refuses. Two
    // events about one fact, written against two different worlds, is a batch
    // built against a snapshot; this is the same reading `resolveDamage`
    // already takes when it asks what the damage left behind.
    const creature = creatureOf(events.reduce(applyEvent, state), id);
    if (creature?.concentration != null) {
      events.push({
        type: 'concentration-ended',
        id,
        castingId: creature.concentration.castingId,
        reason: 'removed',
      });
    }

    // Order matters: leave the map and the initiative order before leaving the
    // cast, so each of those events still finds the creature it refers to.
    if (state.scene?.positions[id] !== undefined) {
      events.push({ type: 'creature-unplaced', id });
    }
    // A combat of one cannot lose its last combatant, so the fight ends instead.
    //
    // **And this one stays unstamped and pins no `ending`**, which is what the
    // field being optional is for. A fight closing because the order ran out
    // is not any of the three endings a table elects — nobody was defeated,
    // nobody yielded and nobody ran, the last body was simply carried off —
    // and `endCombat` in `commands/scene.ts` is the door for the ones that
    // are. The stamp rides on `creature-removed` below, the one event this
    // command always emits.
    if (state.combat?.order.some((c) => c.id === id) === true) {
      events.push(
        state.combat.order.length === 1
          ? { type: 'combat-ended' }
          : { type: 'combatant-removed', id },
      );
    }

    // The one event this command always emits, whatever the creature was in the
    // middle of, so the stamp rides here rather than on a hold it happened to
    // be settling.
    events.push({ type: 'creature-removed', id, ...(stamp === null ? {} : { command: stamp }) });
    return ok(events);
  });
}

/**
 * Grant Temporary Hit Points.
 *
 * SRD: they are not healing and do not stack — "If you have Temporary Hit
 * Points and receive more of them, you choose whether to keep the ones you
 * have or gain the new ones." Keeping the larger pool is that choice made the
 * only way it is ever made.
 */
export function grantTemporaryHpTo(
  state: GameState,
  id: CharacterId,
  amount: number,
  command: CommandIdentity = {},
): Result<GameEvent[]> {
  return once(state, `temp-hp:${id}`, { ...command, amount }, () => [], (stamp) => {
  if (creatureOf(state, id) === null) {
    return unknownCreature(id);
  }
  if (!Number.isFinite(amount) || amount < 0) {
    return err('bad_amount', `temporary hit points must be a non-negative number, got ${amount}`);
  }
  return ok([
    { type: 'temporary-hp-granted', id, amount, ...(stamp === null ? {} : { command: stamp }) },
  ]);
  });
}

