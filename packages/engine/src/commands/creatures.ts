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
import type { Monster } from '@ie/srd';
import type { Content } from '../content.js';
import { applyEvent, type GameEvent, type GameState } from '../events.js';
import type { CommandStamp } from '../state.js';
import type { KeptBond } from '../state.js';
import { type CommandIdentity, once } from '../idempotency.js';
import { addCombatant } from '../combat.js';
import {
  adaptMonster,
  hasPrintedTrait,
  type PrintedSpeedMode,
  withPrintedSpeeds,
} from '../monster.js';
import type { Placement } from '../positioning.js';
import { hitPointFloorFor, speedOf } from '../standing.js';
import { applyDamageToVitals, damagePastThreshold, healingRuleOf, isDown } from '../vitals.js';
import type { Recovery } from '../resources.js';
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
 * **And it declares what the creature casts, where the block prints it.** That
 * paragraph used to say the opposite, and the reason it did was the parser
 * rather than a rule: a stat block's Spellcasting line was English prose and
 * `Monster` carried no ability, no list and no prices, so reading one out would
 * have been the engine deciding a fact the SRD wrote for a person. The line is
 * *structure* now — an ability, the numbers the block prints, and one price per
 * spell — so the block answers, and a Cultist Fanatic walks in already casting.
 * `declareSpellcasting` remains the command for an NPC whose block says nothing,
 * and it remains restatable: nothing here makes a declaration durable.
 * `declareCreatureSide` is still the other answer, for an allegiance that
 * changes in play and therefore cannot be a property of arriving.
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

      return ok(arrivalOf(id, monster, stamp, false));
    },
  );
}

/**
 * The arrival a stat block makes, with every number the adapter read pinned.
 *
 * The body {@link addCreature} has always had, in a function of its own so
 * that a block a *spell* prints inside itself (SRD Unseen Servant, through
 * `Summons.block`) takes the identical road: the same adapter, the same
 * pinned sheet, the same withheld caveats. Not exported — the door a caller
 * walks a whole stat block through is the one `addCreature` refuses to be,
 * and a summons reaches here only with a block its definition printed.
 *
 * `untyped` is the one thing a printed sentence can leave out that a bestiary
 * entry cannot: SRD Unseen Servant gives its force no creature type, and the
 * absence is pinned as an absence rather than as a placeholder a type-gated
 * spell would then believe.
 */
function arrivalOf(
  id: CharacterId,
  monster: Monster,
  stamp: CommandStamp | null,
  untyped: boolean,
): AddCreatureOutcome {
  const adapted = adaptMonster(monster, id);
  const { byDamageType, conditionImmunities, qualified } = adapted.defenses;

  return {
        events: [
          {
            type: 'creature-added',
            id,
            name: adapted.name,
            sheet: adapted.sheet,
            maxHp: adapted.vitals.hpMax,
            diesAtZero: adapted.vitals.diesAtZero,
            ...(untyped ? {} : { creatureType: adapted.creatureType }),
            // And the alignment beside it, for the one line that reads one:
            // SRD Sprite's Heart Sight. Pinned rather than looked up, so the
            // fold opens no catalogue when the sprite looks.
            alignment: adapted.alignment,
            defenses: byDamageType,
            // Pinned so that placing this creature is not a second reading of
            // a fact the book already answered, and so that nobody above the
            // engine is asked to state one.
            size: adapted.size,
            // And the rating the block prints beside it, for the same reason
            // and to the same end: SRD Animal Messenger reads the *target's*
            // Challenge Rating, and until it was pinned here the adapter read
            // one off every block and the creature carried it nowhere.
            cr: adapted.cr,
            ...(conditionImmunities.length === 0 ? {} : { conditionImmunities }),
            ...(stamp === null ? {} : { command: stamp }),
          },
          // **What the block's Spellcasting line declares, in the same
          // batch.** Its own event rather than a field on the arrival, for the
          // reason `declareSpellcasting` already exists: a spell list is not
          // durable the way a creature's type is, and the SRD nowhere forbids
          // restating one. But a creature whose block prints the line arrives
          // casting, because the block prints it — nobody above the engine
          // should have to declare a fact the book already states, which is
          // the rule `creatureType` settled.
          ...(adapted.spellcasting === null
            ? []
            : [{ type: 'spellcasting-declared' as const, id, spellcasting: adapted.spellcasting }]),
          // And the pools its per-day uses come out of, which a pool is
          // declared rather than derived for: the size is a fact somebody has
          // to state, and here the block states it. The Spellcasting line's
          // castings are most of them; a printed Reaction's "(2/Day)" is the
          // other, and both arrive as the same declaration.
          ...adapted.pools.map((pool) => ({
            type: 'resource-pool-declared' as const,
            id,
            pool,
          })),
        ] satisfies GameEvent[],
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
          // **What a trait the engine read says besides what it read.** SRD
          // Swarm prints three sentences under one heading and the engine
          // holds the last of them; the other two describe a lattice it has
          // not got — a creature standing in another's space, an opening with
          // a width — and go to the table with the heading they came under,
          // in the book's own words.
          //
          // Reported at *arrival* rather than at use, which is the one thing
          // that makes this different from a rider's residue: a trait is not
          // spent, so there is no later moment to say it at.
          ...monster.traits.flatMap((line) =>
            (line.trait?.handedOver ?? []).map(
              (clause) =>
                `${id}: ${line.name} reads "${clause}" — the engine does not apply that; a DM does`,
            ),
          ),
        ],
        duplicate: false,
  };
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
  /**
   * Which stat block, by its id in content — exactly as {@link addCreature}
   * takes one. With {@link block}, the key the arrival is filed under rather
   * than an id content holds.
   */
  readonly monsterId: string;
  /**
   * A stat block the **spell** printed, in place of one content holds.
   *
   * SRD Unseen Servant prints "AC 10, 1 Hit Point, and a Strength of 2" in a
   * sentence, and the resolver builds the block from the definition's
   * `inline` — so what arrives here is content's, read by a command, and not a
   * value a caller produced: no door above the engine can put one here, for
   * the reason `addCreature` takes an id. `untyped` says the sentence printed
   * no creature type and the arrival pins none. Left out of the command's
   * fingerprint, which the key carries for it.
   */
  readonly block?: { readonly monster: Monster; readonly untyped?: true };
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
   * The terms the summoner **keeps** the creature on, where no casting holds
   * it — see `SummonBond.kept`. Exclusive with `castingId`: a creature with
   * two lifetimes is refused (`two_lifetimes`).
   */
  readonly kept?: KeptBond;
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
  /**
   * The Armour Class this creature arrives with, where the **spell** prints
   * one over the stat block's own.
   *
   * SRD Find Steed prints its steed's block inside the spell's entry and
   * writes the Armour Class as a formula: "**AC** 10 + 1 per spell level". So
   * one number in that block belongs to the casting rather than to the
   * bestiary, and there is nowhere else it could be pinned from.
   *
   * **A whole number, and nothing derived here.** This command still computes
   * nothing: the caller states the answer and it is written into
   * `creature-added` beside every other number the arrival pins, so the fold
   * raising the creature reads one Armour Class and never a formula. What
   * works the formula out is `resolveSummonEffect`, once, at the cast, from
   * the level the slot paid for.
   *
   * Absent is every summons whose block is the whole truth — SRD Phantom
   * Steed's Riding Horse — and then the printed Armour Class stands.
   */
  readonly armorClass?: number;
  /** The same, for SRD Find Steed's "**HP** 5 + 10 per spell level". */
  readonly hitPointMaximum?: number;
  /**
   * The creature type the summons arrives with, where the spell prints one
   * over the block's own — SRD Find Familiar's "a Celestial, Fey, or Fiend
   * (your choice) instead of a Beast". Pinned into `creature-added` in place
   * of the block's, as the Armour Class is.
   */
  readonly creatureType?: string;
  /**
   * Speeds the spell prints over the block, already gated on the slot by the
   * resolver — SRD Find Steed's "Fly 60 ft. (requires level 4+ spell)". A
   * walking Speed replaces the block's; any other joins or replaces the mode
   * the block prints.
   */
  readonly speeds?: Partial<Record<PrintedSpeedMode, number>>;
  /**
   * SRD Find Familiar: "A familiar can't attack". The creature arrives with a
   * stored `action-rule` forbidding the Attack action and the Opportunity
   * Attack, sourced to the summons and labelled with what forbade it.
   */
  readonly forbidsAttacks?: { readonly label: string };
  /**
   * Seat the creature immediately after this combatant — SRD Find Steed's
   * "the steed takes its turn immediately after yours". Read beside
   * `initiative`; see `CombatantInput.after`.
   */
  readonly after?: CharacterId;
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
 * And it **derives no statistic of its own**: SRD Find Steed does print two
 * numbers over its steed's block — "AC 10 + 1 per spell level", "HP 5 + 10 per
 * spell level" — and {@link Summons.armorClass} and
 * {@link Summons.hitPointMaximum} carry the *answers* rather than the
 * formulae. The arithmetic belongs to whoever knows what level the casting was
 * made at, which is `resolveSummonEffect`; what happens here is that the
 * stated number is written into the arrival instead of the printed one, so the
 * log pins exactly one Armour Class per creature.
 *
 * **That last paragraph reverses one this file used to carry**, and the
 * reversal is recorded rather than quietly performed. It read: "a stat block
 * whose numbers come from a caster's level or a spell's slot is a different
 * mechanic, and `Summons` has nowhere to put one on purpose". It was written
 * when the only caller was a DM naming a monster, and what it was guarding
 * against — a number arriving here that somebody made up — is still guarded:
 * the two fields take a whole number and this command computes neither, so
 * what changed is that the *engine* now has a place to work one out from a
 * printed formula and a slot level. A model still cannot reach either field;
 * a `summon` effect is the only thing in the tree that writes them.
 */
export function summonCreature(
  state: GameState,
  content: Content,
  summons: Summons,
  command: CommandIdentity = {},
): Result<AddCreatureOutcome> {
  const { id, monsterId, by, castingId, kept, block, ...stated } = summons;

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
    // The block is left out and the key stands for it: a printed block is
    // kilobytes of JSON in a fingerprint kept for as long as the game lasts,
    // which is the reason `addCreature` takes an id.
    { ...command, ...stated, id, monsterId, by, ...(castingId === undefined ? {} : { castingId }), ...(kept === undefined ? {} : { kept }) },
    () => ({ events: [], unverified: [], duplicate: true }),
    (stamp) => {
      const summoner = creatureOf(state, by);
      if (summoner === null) return unknownCreature(by);

      // One lifetime. A creature both held by a casting and kept by its
      // summoner would go at whichever ended first, and no spell prints that.
      if (castingId !== undefined && kept !== undefined) {
        return err(
          'two_lifetimes',
          `${id} cannot be both held by ${castingId} and kept by ${by}; a summons has one lifetime`,
        );
      }

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
      // A block the spell printed takes the same road without opening the
      // catalogue: there is no entry to look up, and the roster check is the
      // one thing `addCreature` would have done first.
      const arrival =
        block === undefined
          ? addCreature(state, content, id, monsterId)
          : creatureOf(state, id) !== null
            ? err('already_present', `${id} is already in this game`)
            : ok(arrivalOf(id, block.monster, null, block.untyped === true));
      if (!arrival.ok) return arrival;

      // The one event this command always emits, so the stamp rides it rather
      // than a placement or a rung in the order that a summons may not have —
      // and the one the spell's own numbers are written into, because a second
      // event carrying an Armour Class would be a second place to read one.
      const events: GameEvent[] = arrival.value.events.map((event, index) => {
        if (index !== 0) return event;
        const pinned = printedOver(event, summons);
        return stamp === null ? pinned : { ...pinned, command: stamp };
      });

      // SRD summons are the summoner's. Declared rather than derived even
      // here: if nobody has said whose side the caster is on, nobody has said
      // whose side its hound is on either.
      const side = summons.side ?? summoner.side;
      if (side !== null && side !== undefined) {
        events.push({ type: 'creature-side-declared', id, side });
      }

      if (castingId !== undefined) {
        events.push({ type: 'creature-summoned', id, by, castingId });
      } else if (kept !== undefined) {
        // Bound at the arrival, because the terms it is kept on need no
        // record to exist first — which is the whole difference from a
        // casting's bond, written after the record by `resolveEffects`.
        events.push({ type: 'creature-summoned', id, by, kept });
      }

      // SRD Find Familiar: "A familiar can't attack, but it can take other
      // actions as normal." Stored on the creature rather than derived, for
      // the reason a casting's rule is: `refuseSpend` reads the stored half,
      // and a summons has no feature to hang a standing rule on. Sourced to
      // the summons, so it stands for as long as the creature does and goes
      // with it — there is no casting for `releaseGrants` to end it by.
      if (summons.forbidsAttacks !== undefined) {
        events.push({
          type: 'action-rule-granted',
          id,
          rule: {
            source: `summons:${id}`,
            rule: { kind: 'forbids', actions: ['attack', 'opportunity-attack'] },
            label: summons.forbidsAttacks.label,
            until: 'it is dismissed',
          },
        });
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
          // SRD Find Steed's "immediately after yours" — a position, which
          // `addCombatant` keeps. See `Combatant.after`.
          ...(summons.after === undefined ? {} : { after: summons.after }),
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
 * The arrival, with whatever the **spell** printed over the stat block.
 *
 * SRD Find Steed writes its steed's Armour Class and hit points as formulae in
 * the spell's own entry, its Fly Speed gated on the slot, and its creature
 * type as the caster's choice; SRD Find Familiar prints the type the same
 * way. So for those summons some of what the block would otherwise settle is
 * the casting's. They are written *into the arrival* rather than emitted
 * beside it: `creature-added` is where every number a creature has is pinned,
 * and a second event carrying an Armour Class would give the fold two answers
 * to one question.
 *
 * Nothing here computes; the caller has already worked the formula out. An
 * event of any other type is handed back untouched, which is the honest answer
 * for a batch whose shape this function does not get to assume.
 */
function printedOver(event: GameEvent, summons: Summons): GameEvent {
  if (event.type !== 'creature-added') return event;
  const { armorClass, hitPointMaximum, creatureType, speeds } = summons;
  if (
    armorClass === undefined &&
    hitPointMaximum === undefined &&
    creatureType === undefined &&
    speeds === undefined
  ) {
    return event;
  }
  // SRD Find Steed's "Fly 60 ft. (requires level 4+ spell)": a Speed the
  // spell prints is pinned by the adapter, which is the one place a printed
  // number reaches a sheet — the command layer derives no Speed of its own.
  const sheet = speeds === undefined ? event.sheet : withPrintedSpeeds(event.sheet, speeds);
  return {
    ...event,
    ...(hitPointMaximum === undefined ? {} : { maxHp: hitPointMaximum }),
    // SRD Find Familiar: "a Celestial, Fey, or Fiend (your choice) instead of
    // a Beast" — the block's type, replaced at the arrival and nowhere else.
    ...(creatureType === undefined ? {} : { creatureType }),
    sheet: armorClass === undefined ? sheet : { ...sheet, stated: { ...sheet.stated, armorClass } },
  };
}

/**
 * The link that says a casting is what holds a creature here.
 *
 * **Its own function, and the only other place `creature-summoned` is
 * written**, because a casting cannot bind its creature at the moment it
 * raises it. The fold refuses a bond naming a casting that is not in
 * `state.ongoing` — the link would be born already broken — and a casting's
 * `spell-ongoing` record is written *after* its effects have resolved. So a
 * `summon` effect raises the creature inside the effect loop and the bond is
 * written here, by `resolveEffects`, immediately after the record it depends
 * on. Two facts with two moments, which is what the event's own docstring says
 * they are.
 *
 * {@link summonCreature}'s two refusals are the same two facts, checked
 * against a world that already holds the record: this is reached only with the
 * casting the caster is making now, so "is it running" is answered by the
 * event one line above and "is it theirs" by the caster being the summoner.
 * A DM binding a creature to some other casting still goes through the command
 * and still meets both.
 *
 * An empty list is a real answer — most castings summon nothing.
 */
export function bindSummonsToCasting(
  summoned: readonly CharacterId[],
  by: CharacterId,
  castingId: string,
): readonly GameEvent[] {
  return summoned.map((id) => ({ type: 'creature-summoned', id, by, castingId }));
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
      if (bond.castingId !== null) {
        return state.ongoing[bond.castingId] === undefined ? [creature.id] : [];
      }
      // A creature its summoner keeps. SRD Find Familiar: "When the familiar
      // drops to 0 Hit Points, it disappears"; SRD Find Steed: "The steed
      // disappears if it drops to 0 Hit Points or if you die." The first is
      // what being kept means and the second is the spell's to print — and a
      // summoner who has left the game is read as the second, because a
      // creature kept by nobody is kept by nothing.
      if (creature.vitals.hp <= 0 || creature.vitals.dead) return [creature.id];
      // SRD Gnomish Lineage: "each falls apart 8 hours after its creation" —
      // a span the bond carries, measured from the clock at the binding. The
      // fifth way a kept creature goes and the only one that is a deadline:
      // there is no casting left running for a timer to hang on, because the
      // ten minutes of Prestidigitation that made it are over.
      const span = bond.kept?.lastsSeconds;
      if (span !== undefined && state.elapsed >= (bond.kept?.since ?? 0) + span) {
        return [creature.id];
      }
      if (bond.kept?.untilSummonerDies === true) {
        const summoner = state.creatures[bond.by];
        if (summoner === undefined || summoner.vitals.dead) return [creature.id];
      }
      // SRD Wild Companion: "disappears when you finish a Long Rest" — the
      // summoner's last completed Long Rest, and only one later than the bond:
      // a familiar called the morning after is not owed the night before.
      if (bond.kept?.untilSummonerLongRests === true) {
        const summoner = state.creatures[bond.by];
        if (summoner === undefined) return [creature.id];
        const rested = summoner.lastLongRestAt;
        if (rested !== null && rested > (bond.kept.since ?? -1)) return [creature.id];
      }
      return [];
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
  /**
   * The damage types this blow was made of, where the caller had any.
   *
   * **A fact the engine computed, never one a caller decided.** The amount is
   * already summed and the defences already met by the time this command runs
   * — `dealSpellDamage` does both — so this says nothing about how much and
   * everything about what kind, which is what SRD Undead Fortitude's "unless
   * the damage is Radiant" reads and nothing else here does.
   *
   * Absent is a caller that never had a type for the engine to see: a DM's
   * improvised amount, which no defence can meet either, for the reason
   * `improvised_damage` states.
   */
  readonly types?: readonly string[];
}

/**
 * A floor the caller settled before the blow was written down.
 *
 * `hitPointFloorFor` answers for every floor a creature *stands* on, and
 * `damageCreature` can ask it because it needs nothing but state. SRD Undead
 * Fortitude is the other kind: a floor that a Constitution saving throw
 * decides, and this command holds no generator to throw one. So the roll is
 * made where the damage arrives with a `Supply` — `resolveDamage` — and what
 * it decided arrives here rather than being asked for again.
 */
export interface SettledFloor {
  /** SRD's "1 Hit Point": what the blow may not take the creature below. */
  readonly at: number;
  /** The rule that said so, pinned for the log exactly as a standing one is. */
  readonly feature: string;
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
  settled: SettledFloor | null = null,
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

    // SRD "Damage Threshold": "A creature or an object that has a damage
    // threshold has Immunity to all damage unless it takes an amount of damage
    // from a single attack or effect equal to or greater than its damage
    // threshold, in which case it takes that entire instance of damage. Any
    // damage that fails to meet or exceed the damage threshold is superficial
    // and doesn't reduce Hit Points."
    //
    // **Here, because this is the one place damage becomes hit points lost.**
    // Every route — a swing, a spell, a fall, a chandelier a DM dropped —
    // arrives at `damage-taken`, and a threshold applied anywhere else would
    // be one a second route walked past. It is the same seam Resistance
    // already resolves at: the log records what was *taken*, not what was
    // swung, so a blow the threshold turned aside is a `damage-taken` of 0
    // rather than an event nobody wrote. The event stays, because the thing
    // still happened and narration should be able to say the axe rang off the
    // stone.
    //
    // Read off the sheet, which is where `creature-added` pinned it, so the
    // fold needs nothing new and neither frozen fixture moves.
    const amount = damagePastThreshold(
      creature.sheet.stated?.damageThreshold ?? 0,
      command.amount,
    );

    const critical = command.critical === undefined ? {} : { critical: command.critical };

    // **What this blow would do, asked before it is written down.** SRD
    // Relentless Endurance is "when you are reduced to 0 Hit Points but not
    // killed outright", and the only way to know whether that is what happened
    // is to run the rules — so they are run once with nothing under the
    // creature, and only then is the trait asked about. A dry run costs
    // nothing: `applyDamageToVitals` is pure arithmetic over a `Vitals` and
    // touches neither the log nor the generator.
    const unheld = applyDamageToVitals(creature.vitals, amount, critical);
    // **The standing floors, and the clause that narrows them.** SRD Relentless
    // Endurance is "reduced to 0 Hit Points **but not killed outright**", and
    // this is where that clause lives: a floor nothing decided is offered only
    // to a blow that did not kill, so it can never rescue a creature from a
    // monster's death at 0 or from Massive Damage.
    const standing =
      unheld.droppedToZero && !unheld.died ? hitPointFloorFor(state, id) : null;
    // **And the floor a die already settled**, whose sentence is about exactly
    // the death the clause above excludes: SRD Undead Fortitude. It is offered
    // wherever the blow reached 0, and it carries no price — see
    // `damage-taken.floor.spent`. No SRD creature holds both; where one did,
    // the settled floor would win, because its die has already been thrown and
    // cannot be un-thrown.
    const settledFloor = unheld.droppedToZero ? settled : null;
    const floor: {
      readonly at: number;
      readonly feature: string;
      readonly spent?: { readonly key: string; readonly recovers: Recovery };
    } | null =
      settledFloor !== null
        ? { at: settledFloor.at, feature: settledFloor.feature }
        : standing === null
          ? null
          : {
              at: standing.at,
              feature: standing.feature,
              spent: { key: standing.key, recovers: standing.recovers },
            };

    const events: GameEvent[] = [
      {
        type: 'damage-taken',
        id,
        amount,
        ...critical,
        ...(command.source === undefined ? {} : { source: command.source }),
        ...(command.by === undefined ? {} : { by: command.by }),
        // Pinned, because the fold recomputes the blow from this event and a
        // decision the command kept to itself would be undone on replay. The
        // price rides with it, so the claim and what paid for it cannot come
        // apart. See `damage-taken.floor`.
        ...(floor === null ? {} : { floor }),
        ...(stamp === null ? {} : { command: stamp }),
      },
    ];

    // Ask the rules what this damage does before deciding what follows it —
    // now with whatever the trait put under the creature.
    const outcome = applyDamageToVitals(creature.vitals, amount, {
      ...critical,
      ...(floor === null ? {} : { floor: floor.at }),
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
  /**
   * What is restoring them, where the caller knows — a casting's own source.
   *
   * Fifth and appended, the reading `applyConditionTo`'s late parameters
   * already take: no existing call site passes one and none has to. It reaches
   * the event and nothing here, because the *rule* that reads it is a fold
   * pass — SRD Bearded Devil's wound closing "after a spell restores Hit
   * Points to the target" — and hit points coming back are hit points coming
   * back whoever sent them.
   */
  source?: string,
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

    // **And what the creature's own block says it is.** SRD Swarm: "The swarm
    // can't regain Hit Points or gain Temporary Hit Points."
    //
    // Read off the printed trait rather than hung as a `GrantedHealingRule`,
    // and the record is the argument: that one is "a healing rule a running
    // effect hung on a creature, ended by its source", and a swarm's anatomy
    // is not a running effect and is ended by nothing. It is the same reading
    // `hasPrintedTrait` already serves Pack Tactics and Undead Fortitude —
    // a permanent fact the block states, pinned onto the sheet at arrival and
    // asked for where the rule bites.
    //
    // **At this door and nowhere else**, for the reason the grant above is at
    // this door: every way hit points come back passes through here.
    if (hasPrintedTrait(creature.sheet, 'regains-no-hit-points')) return ok([]);

    const events: GameEvent[] = [
      {
        type: 'healed',
        id,
        amount,
        ...(source === undefined ? {} : { source }),
        ...(stamp === null ? {} : { command: stamp }),
      },
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
 *
 * **The one creature the book says may not have any** is the swarm, and this
 * is the door its sentence's second half meets: "The swarm can't regain Hit
 * Points **or gain Temporary Hit Points**." The first half is `healCreature`'s
 * and the two are asked separately because they are two doors, not because
 * they are two rules — a `HealingRule` of `prevented` is Chill Touch's
 * sentence, which says nothing whatever about Temporary Hit Points and must
 * not be read as though it did.
 */
export function grantTemporaryHpTo(
  state: GameState,
  id: CharacterId,
  amount: number,
  command: CommandIdentity = {},
): Result<GameEvent[]> {
  return once(state, `temp-hp:${id}`, { ...command, amount }, () => [], (stamp) => {
  const creature = creatureOf(state, id);
  if (creature === null) {
    return unknownCreature(id);
  }
  if (!Number.isFinite(amount) || amount < 0) {
    return err('bad_amount', `temporary hit points must be a non-negative number, got ${amount}`);
  }
  // **An empty batch rather than a refusal**, which is the answer
  // `healCreature` gives the other half of the same sentence and for its
  // reason: nothing was done wrong, and a log with no `temporary-hp-granted`
  // in it says exactly what happened.
  if (hasPrintedTrait(creature.sheet, 'regains-no-hit-points')) return ok([]);
  return ok([
    { type: 'temporary-hp-granted', id, amount, ...(stamp === null ? {} : { command: stamp }) },
  ]);
  });
}

