import { err, needsContext, ok, type CharacterId, type Result } from '@ie/shared';
import { abilityModifier, type CharacterSheet } from './character.js';
import type { Content } from './content.js';
import {
  rechooseCharacter,
  restRechoices,
  type ClassSpellChoices,
  type RestRechoiceOffer,
} from './creation.js';
import { HOUR, hours } from './time.js';
import type { Rng } from './dice.js';
import { timerKey } from './timers.js';
import type { GameEvent, GameState } from './events.js';
import { once, type CommandIdentity } from './idempotency.js';
import { rechosenSpellKey } from './progression.js';
import { hitDieSides, remaining } from './resources.js';
import { rollRecorded, type RollIssuer } from './rolls.js';
import { castingIdOf } from './spells.js';
import { sheetAsItStands } from './standing.js';
import type { CreatureState } from './state.js';
import { settleHitPointMaximum, type GrantedHitPointMaximum } from './vitals.js';

/**
 * Short and Long Rests.
 *
 * Two things make this more than a pair of "restore everything" buttons.
 *
 * **A rest is a span, not a moment.** It starts, time passes, and it ends — so
 * the engine can tell a completed rest from an abandoned one, and can apply
 * the rule that turns a Long Rest broken after an hour into a Short Rest
 * rather than into nothing.
 *
 * **The engine notices its own interruptions.** SRD lists four, three of which
 * the engine can actually see: rolling Initiative, casting a spell other than
 * a cantrip, and taking any damage. Those mark the rest as they happen, so
 * ending it reads what occurred rather than asking the caller to report it. A
 * caller who had to report them would eventually miss one, and the party would
 * collect a rest the rules had already broken. The fourth — "1 hour of walking
 * or other physical exertion" — is fiction the engine cannot see, so that one
 * is passed in.
 */

/** SRD: "A Short Rest is a 1-hour period of downtime". */
export const SHORT_REST = HOUR;
/** SRD: "a period of extended downtime—at least 8 hours". */
export const LONG_REST = hours(8);
/** SRD: "you must wait at least 16 hours before starting another one." */
export const LONG_REST_COOLDOWN = hours(16);

export type RestKind = 'short' | 'long';

export interface RestState {
  readonly kind: RestKind;
  /** Clock reading when it began. */
  readonly startedAt: number;
  /** What broke it off, set by the rules as it happened. */
  readonly interruptedBy: string | null;
  /**
   * The clock reading when it broke off.
   *
   * SRD pays out on the time rested *before the interruption*, so the moment
   * matters and not just the fact. Without it, ten minutes of sleep followed
   * by an hour of standing around counted as seventy minutes of rest.
   */
  readonly interruptedAt: number | null;
}

/** What a rest actually earned, which is not always what was attempted. */
export type RestBenefit = 'none' | 'short' | 'long';

/**
 * How long a rest of this kind takes **this** creature.
 *
 * SRD Trance: "You can finish a Long Rest in 4 hours if you spend those hours
 * in a trancelike meditation." A Long Rest was one constant for everybody and
 * this is the per-creature answer, read off the sheet the rest belongs to;
 * every sheet written before it says nothing and gets the eight hours it
 * always got. Only the Long Rest asks, because the SRD prints no trait that
 * shortens a Short one.
 */
function restRequires(kind: RestKind, sheet?: CharacterSheet | null): number {
  if (kind === 'short') return SHORT_REST;
  return sheet?.longRestSeconds ?? LONG_REST;
}

/**
 * What a rest ending at this moment would grant.
 *
 * SRD: "An interrupted Short Rest confers no benefits", but for a Long Rest,
 * "If you rested at least 1 hour **before the interruption**, you gain the
 * benefits of a Short Rest."
 *
 * Before the interruption. Time spent lying there afterwards is not rest —
 * the rest was over the moment it broke — so this measures to
 * `interruptedAt`, not to `now`. Reading total elapsed time instead paid out a
 * Short Rest for ten minutes of sleep and an hour of waiting around.
 */
export function restEarned(rest: RestState, now: number, requires?: number): RestBenefit {
  if (rest.interruptedBy !== null) {
    if (rest.kind === 'short') return 'none';
    const rested = (rest.interruptedAt ?? now) - rest.startedAt;
    // **The interruption pays out on a Short Rest's hour and never on the
    // shortened one.** SRD's clause is "If you rested at least 1 hour before
    // the interruption, you gain the benefits of a Short Rest", and a Short
    // Rest is an hour for an Elf as for anybody. Trance shortens what a Long
    // Rest takes, not what a broken one is worth.
    return rested >= SHORT_REST ? 'short' : 'none';
  }
  // The length this rest actually takes, supplied by whoever holds the
  // creature. A caller that has only a `RestState` — the two frozen logs, and
  // every test that asks what a span would earn — gets the engine's constant.
  return now - rest.startedAt >= (requires ?? restRequires(rest.kind)) ? rest.kind : 'none';
}

const creatureOf = (state: GameState, id: CharacterId) => state.creatures[id] ?? null;

/**
 * Begin a rest.
 *
 * SRD: "To start a Short Rest, you must have at least 1 Hit Point", and the
 * same for a Long Rest. A creature at 0 is making death saves, not resting.
 */
export function beginRest(
  state: GameState,
  id: CharacterId,
  kind: RestKind,
  commandId?: string,
): Result<GameEvent[]> {
  // The same identity check the casting commands use. A bare "have I seen this
  // id" test returned an empty success for *any* previously used id — another
  // creature's rest, a different kind of rest — which is the silent no-op an
  // idempotency key exists to avoid.
  // Named rather than inlined so the kind travels into the fingerprint: two
  // rests differing only in kind must not share an id.
  const inputs: { commandId?: string; kind: RestKind } =
    commandId === undefined ? { kind } : { commandId, kind };
  return once(state, `rest:${id}`, inputs, () => [], (stamp) => {
    const creature = creatureOf(state, id);
    if (creature === null) return needsContext('unknown_creature', `${id} is not in this game`);
    if (creature.vitals.dead) return err('dead', `${id} is dead and is past resting`);
    if (creature.vitals.hp < 1) {
      return err('no_hit_points', `${id} needs at least 1 hit point to start a rest`);
    }
    if (creature.resting !== null) {
      return err('already_resting', `${id} is already taking a ${creature.resting.kind} rest`);
    }

    if (kind === 'long' && creature.lastLongRestAt !== null) {
      const since = state.elapsed - creature.lastLongRestAt;
      if (since < LONG_REST_COOLDOWN) {
        return err(
          'too_soon',
          `${id} finished a Long Rest ${since} seconds ago and must wait ${LONG_REST_COOLDOWN}`,
        );
      }
    }

    return ok([
      { type: 'rest-begun', id, kind, ...(stamp === null ? {} : { command: stamp }) },
    ]);
  });
}

/** One Hit Die spent, and what it gave back. */
export interface HitDieSpent {
  readonly key: string;
  readonly sides: number;
  /** What the die showed. */
  readonly natural: number;
  /** The die plus Constitution, never below 1. */
  readonly regained: number;
}

/** One prepared spell studied out of the list and one studied in. */
export interface StudiedSpell {
  /** The prepared spell being put down. */
  readonly replaces: string;
  /** The one taken up in its place, out of what the character already has. */
  readonly prepares: string;
}

export interface RestOptions extends CommandIdentity {
  /** Hit Dice to spend, by pool key. Only a Short Rest offers this. */
  readonly hitDice?: readonly string[];
  /** An interruption the engine cannot see, such as an hour of hard walking. */
  readonly interrupted?: string;
  /**
   * A question the rest re-asks, answered again — SRD Circle of the Land
   * Spells' "Whenever you finish a Long Rest, choose one type of land", keyed
   * by the feature that asks it.
   *
   * **Silence keeps the last answer**, because the SRD's sentence is a
   * permission rather than a demand: a Druid who sleeps without thinking about
   * it wakes up in the land they chose yesterday.
   */
  readonly choosesAgain?: Readonly<Record<string, readonly string[]>>;
  /**
   * Prepared spells swapped over the rest — SRD Memorize Spell's "you can study
   * your spellbook and replace one of the level 1+ Wizard spells you have
   * prepared … with another level 1+ spell from the book".
   *
   * A list because the count is the feature's: the grant says how many swaps a
   * rest buys, and asking for more is refused rather than truncated.
   */
  readonly studies?: readonly StudiedSpell[];
}

export interface HitDiceSupply {
  readonly issuer: RollIssuer;
  readonly rng: Rng;
  /**
   * The world this character was built out of.
   *
   * Optional, and needed only where the rest re-asks something: reading which
   * questions a rest re-asks means reading the holder's features, and
   * re-planning the character means reading the catalogue those features grant
   * out of. Every other benefit a rest pays is written in the log already.
   */
  readonly content?: Content;
}

export interface RestResolution {
  readonly events: readonly GameEvent[];
  readonly benefit: RestBenefit;
  readonly hitDice: readonly HitDieSpent[];
  readonly hitPointsRegained: number;
  /**
   * Whether this answer is a retry's rather than a settlement's.
   *
   * The contract `resolveAttack` and `resolveDamage` already keep, and for the
   * same reason: a retry must not look like a settlement that earned nothing.
   * The three numbers beside it are the empty ones a duplicate has to report,
   * because what the first settlement rolled is not kept anywhere the second
   * could read it — a Hit Die is spent and healed for in the events, and the
   * rest is over. A caller that needs the figures reads the log it already
   * has; a caller that needs to know its command landed reads this.
   */
  readonly duplicate: boolean;
}

/**
 * The rest whose questions are re-asked is the rest that was **finished**.
 *
 * Both printed features open "Whenever you finish a Short/Long Rest", and a
 * Long Rest broken after an hour is not a Short Rest anybody finished — it is a
 * Long Rest that pays out a Short Rest's benefits, which is a sentence about
 * hit points and pools and not about studying a spellbook. So a rest re-asks
 * its own kind's questions when it earned its own kind's benefit, and nothing
 * otherwise.
 */
const restFinished = (rest: RestState, benefit: RestBenefit): RestKind | null =>
  benefit === rest.kind ? rest.kind : null;

/**
 * The choices a finished rest hands back, applied.
 *
 * Every refusal here is about the *rest*: whether this rest re-asks anything,
 * whether the holder has a feature that re-asks what the caller answered, and
 * whether the answer is the size the feature offers. Whether the answer itself
 * is legal — a land the subclass does not print, a spell the book does not hold
 * — is `planCharacter`'s question, asked by `rechooseCharacter` and reported
 * with the same path creation reports it with.
 */
function rechoiceEvents(
  state: GameState,
  id: CharacterId,
  creature: NonNullable<GameState['creatures'][CharacterId]>,
  rest: RestState,
  benefit: RestBenefit,
  options: RestOptions,
  content: Content | undefined,
): Result<readonly GameEvent[]> {
  const choosesAgain = options.choosesAgain ?? {};
  const studies = options.studies ?? [];
  if (Object.keys(choosesAgain).length === 0 && studies.length === 0) return ok([]);

  if (content === undefined) {
    return err('no_content', 'a rest that re-asks a choice reads the holder’s features, which needs the content');
  }

  const record = creature.character;
  if (record === null || record === undefined) {
    return err('not_a_character', `${id} was not created from character choices`);
  }

  const finished = restFinished(rest, benefit);
  const offers = restRechoices(content, record.choices);

  /** The one offer that answers for this patch, or the refusal it earns. */
  const offerFor = (
    matches: (offer: RestRechoiceOffer) => boolean,
    what: string,
  ): Result<RestRechoiceOffer> => {
    const held = offers.filter(matches);
    const first = held[0];
    if (first === undefined) {
      return err('no_such_rechoice', `${id} holds no feature that re-asks ${what} on a rest`);
    }
    const earned = held.find((offer) => offer.rest === finished);
    if (earned === undefined) {
      return err(
        'rest_rechoice_not_earned',
        `${first.featureName} re-asks ${what} whenever a ${first.rest} rest is finished, and this ${rest.kind} rest earned ${benefit === 'none' ? 'nothing' : `a ${benefit} rest’s benefits`}`,
      );
    }
    return ok(earned);
  };

  const featureChoices: Record<string, readonly string[]> = {};
  for (const [feature, answer] of Object.entries(choosesAgain)) {
    // **Both re-choices a feature answers for, found by the feature rather than
    // by the kind.** The caller names the feature that re-asks, which is the
    // one thing a player can see; which of the two questions that feature
    // re-asks — its own option, or the spell one of its grants hands over — is
    // read off the offer, and the answer is filed under the key that offer
    // names. A caller that had to know the difference would be reading the
    // grant vocabulary to answer a rest.
    const offer = offerFor(
      (one) =>
        one.feature === feature &&
        (one.rechooses.kind === 'this-features-choice' ||
          one.rechooses.kind === 'granted-spell'),
      `${feature}’s own choice`,
    );
    if (!offer.ok) return offer;
    const rechooses = offer.value.rechooses;
    if (rechooses.kind !== 'granted-spell') {
      featureChoices[feature] = answer;
      continue;
    }

    // SRD Elven Lineage: "you can replace that cantrip with a **different**
    // cantrip". **"That cantrip" is the one they are holding**, which is the
    // answer they gave last time and the printed spell until they have given
    // one — and this is the only place both are visible, because a
    // `CharacterChoices` holds what the character will be afterwards and the
    // record holds what they are now. Whether the replacement is legal at all
    // is `planCharacter`'s, asked through `rechooseCharacter` below.
    //
    // A refusal rather than a quiet no-op, and the difference matters in one
    // direction only: naming the spell a swap already stands on emits nothing
    // (`sameAnswer`), while naming the *printed* spell for the first time
    // would file an answer nobody asked for and write a `character-advanced`
    // that records a night's sleep and no decision.
    const key = rechosenSpellKey(feature, rechooses.granted);
    const standing = record.choices.featureChoices[key]?.[0] ?? rechooses.granted;
    if (answer.length === 1 && answer[0] === standing) {
      return err(
        'spell_not_replaced',
        `${offer.value.featureName} replaces ${standing} with a different spell, and ${standing} is the one it hands over now`,
      );
    }
    featureChoices[key] = answer;
  }

  let preparedSpells: readonly string[] | undefined;
  const spellsByClass: Record<string, ClassSpellChoices> = {};
  if (studies.length > 0) {
    const offer = offerFor(
      (one) => one.rechooses.kind === 'prepared-spells',
      'a prepared spell',
    );
    if (!offer.ok) return offer;
    const rechooses = offer.value.rechooses;
    const allowed = rechooses.kind === 'prepared-spells' ? rechooses.swap : 0;
    if (studies.length > allowed) {
      return err(
        'too_many_studied',
        `${offer.value.featureName} swaps ${allowed} prepared spell(s) on a ${offer.value.rest} rest, and ${studies.length} were asked for`,
      );
    }

    // Which list the spell is prepared in: a single-class character's flat one,
    // or the entry for whichever class prepared it. The swap follows the spell
    // rather than asking the caller which class it belonged to, because the
    // character already answered that when they prepared it.
    for (const { replaces, prepares } of studies) {
      const flat = preparedSpells ?? record.choices.preparedSpells ?? [];
      if (flat.includes(replaces)) {
        preparedSpells = flat.map((one) => (one === replaces ? prepares : one));
        continue;
      }
      const named = Object.entries(record.choices.spellsByClass ?? {}).find(([classId, entry]) =>
        (spellsByClass[classId]?.preparedSpells ?? entry.preparedSpells ?? []).includes(replaces),
      );
      if (named === undefined) {
        return err('not_prepared', `${id} does not have ${replaces} prepared, so it cannot be studied out`);
      }
      const [classId, entry] = named;
      const held = spellsByClass[classId]?.preparedSpells ?? entry.preparedSpells ?? [];
      spellsByClass[classId] = {
        ...entry,
        ...spellsByClass[classId],
        preparedSpells: held.map((one) => (one === replaces ? prepares : one)),
      };
    }
  }

  return rechooseCharacter(state, content, id, {
    ...(Object.keys(featureChoices).length === 0 ? {} : { featureChoices }),
    ...(preparedSpells === undefined ? {} : { preparedSpells }),
    ...(Object.keys(spellsByClass).length === 0 ? {} : { spellsByClass }),
  });
}

/**
 * The reductions a completed Long Rest lets go of.
 *
 * SRD rules glossary, Long Rest, *Regain All HP*: "If your Hit Point maximum
 * was reduced, it returns to normal." A rule about **the rest** rather than
 * about any line that lowers a maximum, which is why it is read here and not
 * in the three commands that write one — a Specter's Life Drain, a Wraith's,
 * a Wight's, and a homebrew that prints the same sentence tomorrow.
 *
 * Two questions, and the creature's own list answers both:
 *
 * - **Downwards only.** A raise belongs to what raised it: SRD Aid's five
 *   points run the casting's eight hours, through the night and out the other
 *   side. A rest gives back what was taken; it does not take back what was
 *   given.
 * - **Nothing with a lifetime of its own.** A source carrying a casting id is
 *   a casting's, and a source a `grants` deadline stands over ends when that
 *   deadline arrives. Either way somebody else is already coming for it, and
 *   two owners of one ending is how a grant comes to be released twice.
 * **A third question has no field to ask yet**, and this is where it would be
 * asked. SRD Mummy's Rotting Fist prints the exception in as many words — "its
 * Hit Point maximum doesn't return to normal when finishing a Long Rest" — and
 * that line is handed to the table whole today, so no adjustment in any log
 * this engine writes is marked to survive. The mark is
 * `GrantedHitPointMaximum`'s to grow when a reader for the line is built; a
 * clause for it in the filter before then would be a guard over a fact
 * nothing can state.
 */
function loweringsALongRestEnds(
  state: GameState,
  id: CharacterId,
  creature: CreatureState,
): readonly GrantedHitPointMaximum[] {
  return creature.hitPointMaxima.filter(
    (held) =>
      held.amount < 0 &&
      castingIdOf(held.source) === null &&
      state.timers[timerKey({ kind: 'grants', on: id, source: held.source })] === undefined,
  );
}

/** What a retry is told, and the whole of what it is told. */
const ALREADY_SETTLED: RestResolution = {
  events: [],
  benefit: 'none',
  hitDice: [],
  hitPointsRegained: 0,
  duplicate: true,
};

/**
 * End a rest and grant exactly what it earned.
 *
 * The engine decides the benefit from the clock and from the interruptions it
 * recorded as they happened — a completed Long Rest, a Long Rest broken after
 * three hours (a Short Rest), a Short Rest broken at all (nothing). The caller
 * says only what the engine could not see.
 *
 * **And it takes an identity now, which it was the last command not to.** The
 * sweep in `invariants.test.ts` had excused it with a sentence that described
 * the gap rather than closing it: a retry finds nobody resting and is refused
 * `not_resting`, "but the caller cannot tell that from never having rested".
 * That is the eight-times-recorded shape `once` exists to prevent — *a retry
 * looks at the world its first run made, and is told about that world instead
 * of being told its command already landed* — and it mattered here more than
 * most, because a settlement is the call that rolls Hit Dice and heals for
 * them. It was also the one call on the tool surface above that could not be
 * idempotent under the transport's id, which is where it was found.
 *
 * The id rides in `RestOptions` beside the Hit Dice, so the fingerprint covers
 * what the settlement was asked to spend: the same id sent with a different
 * die is a different command and is refused rather than swallowed.
 */
export function endRest(
  state: GameState,
  id: CharacterId,
  options: RestOptions = {},
  supply?: HitDiceSupply,
): Result<RestResolution> {
  return once(state, `end-rest:${id}`, options, () => ALREADY_SETTLED, (stamp) => {
    const creature = creatureOf(state, id);
    if (creature === null) return needsContext('unknown_creature', `${id} is not in this game`);

    const rest = creature.resting;
    if (rest === null) return err('not_resting', `${id} is not resting`);

    // The sheet as it stands, for `rollRecorded`'s reason one paragraph down:
    // what a Long Rest takes this creature is a fact about the creature, and a
    // reader that took the built sheet would miss anything put on since.
    const standing = sheetAsItStands(state, id) ?? creature.sheet;
    const requires = restRequires(rest.kind, standing);

    const interrupted = rest.interruptedBy ?? options.interrupted ?? null;
    // An interruption the engine could not see happens when it is reported;
    // one it saw for itself carries the moment it actually happened.
    const interruptedAt =
      rest.interruptedBy !== null ? rest.interruptedAt : interrupted === null ? null : state.elapsed;
    const benefit = restEarned(
      { ...rest, interruptedBy: interrupted, interruptedAt },
      state.elapsed,
      requires,
    );
    const elapsed = state.elapsed - rest.startedAt;

    // Nothing interrupted it and it has not run its course, so it is not over.
    // Ending it here would quietly grant nothing for a rest still in progress.
    if (benefit === 'none' && interrupted === null) {
      return err(
        'rest_incomplete',
        `${id} has rested ${elapsed} of the ${requires} seconds a ${rest.kind} rest takes`,
      );
    }

    const requested = options.hitDice ?? [];
    const events: GameEvent[] = [];
    const spent: HitDieSpent[] = [];
    /**
     * The requested dice, with the size the validation pass read off each key.
     *
     * Carried forward rather than looked up again in the rolling loop below,
     * where a second `hitDieSides` could only ever answer what this one already
     * has — so its refusal was a `bad_hit_die` nothing could reach, spelled
     * identically to the live one. Two sites for one rule is two places to get
     * it wrong, and the dead one is the one nobody would notice changing.
     */
    const dice: { readonly key: string; readonly sides: number }[] = [];

    // SRD: spending Hit Point Dice is a benefit of a Short Rest. A completed
    // Long Rest restores hit points and Hit Dice outright, so spending them
    // there would be burning a resource the rest is about to hand back.
    if (requested.length > 0) {
      if (benefit !== 'short') {
        return err(
          'no_hit_dice_here',
          benefit === 'long'
            ? 'a completed Long Rest restores hit points and Hit Dice; there is nothing to spend them on'
            : 'a rest that earned nothing offers no Hit Dice',
        );
      }
      if (supply === undefined) {
        return err('no_generator', 'spending a Hit Die rolls it, which needs a generator');
      }

      // Validate every die before rolling any: a request for more dice than are
      // left must cost neither a die nor a turn of the generator.
      const needed = new Map<string, number>();
      for (const key of requested) {
        const sides = hitDieSides(key);
        if (sides === null) return err('bad_hit_die', `${key} is not a Hit Die pool`);
        dice.push({ key, sides });
        needed.set(key, (needed.get(key) ?? 0) + 1);
      }
      for (const [key, count] of needed) {
        const left = remaining(creature.resources, key);
        if (left < count) {
          return err('not_enough_hit_dice', `${id} has ${left} ${key} left, and asked to spend ${count}`);
        }
      }
    }

    switch (benefit) {
      case 'none':
        break;

      case 'short': {
        events.push({ type: 'resources-restored', id, recovers: 'short-rest' });
        // SRD Shadow's Draining Swipe, in the glossary's words: "The reduction
        // lasts until the target finishes a Short or Long Rest." Either rest,
        // so both arms write it; one event per lowering, naming its source.
        for (const held of creature.abilityLowerings) {
          events.push({ type: 'ability-score-restored', id, source: held.source });
        }

        if (requested.length > 0 && supply !== undefined) {
          // The sheet as it stands, not the one the character was built with:
          // "add your Constitution modifier" is read at the moment the die is
          // thrown, so an item that *sets* Constitution — an Amulet of Health —
          // reaches it. This command holds the state and the id, which is the
          // whole reason the substitution is available here.
          const constitution = abilityModifier(standing.abilities.con);
          const issuedBefore = supply.issuer.count;
          let regained = 0;

          for (const { key, sides } of dice) {
            const rolled = rollRecorded(supply.issuer, supply.rng, `1d${sides}`);
            if (!rolled.ok) return rolled;

            // SRD: "You regain Hit Points equal to the total (minimum of 1)."
            const natural = rolled.value.total;
            const gain = Math.max(1, natural + constitution);
            regained += gain;
            spent.push({ key, sides, natural, regained: gain });

            events.push(
              { type: 'resource-spent', id, key, amount: 1 },
              {
                type: 'roll-recorded',
                who: id,
                label: `Hit Die (d${sides})`,
                natural,
                total: natural + constitution,
                contributions: [{ source: 'Constitution', amount: constitution }],
                outcome: `${gain} hit points`,
              },
            );
          }

          events.push({
            type: 'rolls-issued',
            count: supply.issuer.count - issuedBefore,
            rng: supply.rng.snapshot(),
          });
          if (regained > 0) events.push({ type: 'healed', id, amount: regained });
        }
        break;
      }

      case 'long': {
        // SRD rules glossary, Long Rest, *Regain All HP*: "You regain all lost
        // Hit Points and all spent Hit Point Dice. **If your Hit Point maximum
        // was reduced, it returns to normal.**"
        //
        // **The ceiling before the refill**, because the first sentence's "all
        // lost Hit Points" are measured against the maximum the second gives
        // back: a fighter a Specter drained wakes at the maximum he had before
        // he met it, and not at the lowered one.
        const released = loweringsALongRestEnds(state, id, creature);
        for (const held of released) {
          events.push({ type: 'hit-point-maximum-restored', id, source: held.source });
        }
        // And the drained scores, which a Short Rest gives back too — see the
        // arm above. Before the refill for the ceiling's reason: a Hit Die
        // spent later reads the Constitution as it then stands.
        for (const held of creature.abilityLowerings) {
          events.push({ type: 'ability-score-restored', id, source: held.source });
        }

        // What the release leaves, worked out by **the same function the
        // fold's derived pass will run** rather than by arithmetic of this
        // command's own, so the healing is never counted against a ceiling the
        // fold is about to move.
        //
        // For a rester it answers what the old subtraction answered, and
        // deliberately by a different route: a maximum that rises carries the
        // hit points up with it, so `hpMax - hp` is unchanged by the release
        // and both readings agree. They part over the one creature whose total
        // a rising maximum does **not** carry — 0 hit points, or dead — which
        // no rest can reach today, because `beginRest` refuses a creature with
        // none and damage during the night interrupts the rest before it can
        // pay out as a long one. Asking `settleHitPointMaximum` costs a line
        // and means the refill is right by construction rather than by that
        // coincidence, which is a reading of SRD Aid and could be settled the
        // other way for a drain.
        const stillHeld = creature.hitPointMaxima
          .filter((held) => !released.includes(held))
          .reduce((sum, held) => sum + held.amount, 0);
        const restored = settleHitPointMaximum(creature.vitals, stillHeld);

        const missing = restored.hpMax - restored.hp;
        if (missing > 0) events.push({ type: 'healed', id, amount: missing });

        // SRD: "Temporary Hit Points last until they're depleted or you finish a
        // Long Rest." They are not hit points and healing does not touch them,
        // so the rest has to clear them itself.
        //
        // **And whether or not a deadline was ever hung on them.** The owner's
        // ruling of 2026-09-18 makes the rest the end of the default lifetime
        // *and* the outer bound of a stated one: a stated duration says when
        // they run out earlier, never that they survive the night. So the event
        // goes out for a standing deadline as well as for a live pool — the
        // fold drops the deadline with the points, and a pool already spent to
        // nothing would otherwise leave its hour behind to come due over
        // whatever the creature is holding by then.
        if (
          creature.vitals.temporaryHp > 0 ||
          state.timers[timerKey({ kind: 'temporary-hit-points', on: id })] !== undefined
        ) {
          events.push({ type: 'temporary-hp-cleared', id });
        }

        // A feature that recharges on a Short Rest recharges on a Long one too,
        // so both tags fire. The pool says which it is; the rest does not guess.
        events.push(
          { type: 'resources-restored', id, recovers: 'short-rest' },
          { type: 'resources-restored', id, recovers: 'long-rest' },
        );

        // SRD: "If you have the Exhaustion condition, its level decreases by 1."
        if (creature.conditions.exhaustion > 0) {
          events.push({
            type: 'exhaustion-set',
            id,
            level: creature.conditions.exhaustion - 1,
          });
        }
        break;
      }
    }

    // What the rest re-asked, settled after the benefit it paid and before the
    // rest is declared over: a pool the re-choice declares is born full either
    // way, and a pool it resizes keeps what has been spent, so the order is
    // about the reading rather than about the arithmetic — the character who
    // woke up is the one the choices describe.
    const rechosen = rechoiceEvents(state, id, creature, rest, benefit, options, supply?.content);
    if (!rechosen.ok) return rechosen;
    events.push(...rechosen.value);

    events.push({
      type: 'rest-ended',
      id,
      kind: rest.kind,
      benefit,
      ...(interrupted === null ? {} : { interrupted }),
      ...(stamp === null ? {} : { command: stamp }),
    });

    return ok({
      events,
      benefit,
      hitDice: spent,
      hitPointsRegained: spent.reduce((total, die) => total + die.regained, 0),
      duplicate: false,
    });
  });
}
