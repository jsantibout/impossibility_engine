/**
 * Who is in the game, and the character sheet behind them.
 *
 * The seam owns the `creatures` **keyspace** — the two events that add a key
 * and take one away — and the durable facts that hang off a creature rather
 * than change during a fight: the sheet, the character record a level came
 * from, what it can cast, what kind of thing it is and whose side it is on.
 *
 * What happens *to* a creature already in the game is `vitals.ts`; what it
 * spends and recovers is `upkeep.ts`. The line is the one `state.ts` already
 * draws, and it is the reason a task that adds a monster and a task that
 * changes a condition no longer meet in one file.
 */
import { conditionState } from '../conditions.js';
import { resourceState } from '../resources.js';
import { noSpellcasting } from '../spellcasting.js';
import { vitals } from '../vitals.js';
import type { GameEvent } from '../events.js';
import type { GameState, SummonBond } from '../state.js';
import {
  CorruptLogError,
  creatureOf,
  withCreature,
  seamOf,
  unhandledEvent,
  type Applying,
} from './common.js';
import { releaseCasting, withoutTarget } from './release.js';
import { timersApartFrom } from './expiry.js';
import { withEquipment } from './inventory.js';

/** The event types this seam owns. Every one of them, and no other seam's. */
export const ROSTER_EVENTS = [
  'creature-added',
  'creature-summoned',
  'creature-removed',
  'summons-control-renewed',
  'character-created',
  'character-advanced',
  'creature-side-declared',
  'creature-heads-declared',
  'spellcasting-declared',
  'creature-type-declared',
  'damage-type-declared',
] as const;

/** The narrowed union this seam reduces, `Extract`ed from the list above. */
export type RosterEvent = Extract<GameEvent, { type: (typeof ROSTER_EVENTS)[number] }>;

/** Whether an event is this seam's. Built from the same list, so the two cannot drift. */
export const isRosterEvent = seamOf(ROSTER_EVENTS);

/**
 * Reduce one of this seam's events.
 *
 * Exported so `applyOne` may call it and for no other reason: it is not in
 * `fold/index.ts`, nothing under `commands/` can reach it, and a log becomes a
 * state by exactly one route.
 */
export function applyRoster({ state, next }: Applying, event: RosterEvent): GameState {
  switch (event.type) {
    case 'creature-added': {
      if (state.creatures[event.id] !== undefined) {
        throw new CorruptLogError(event, `${event.id} is already in this game`);
      }
      return {
        ...next,
        creatures: {
          ...state.creatures,
          [event.id]: {
            id: event.id,
            name: event.name,
            sheet: event.sheet,
            vitals: vitals(event.maxHp, { diesAtZero: event.diesAtZero ?? false }),
            conditions: conditionState(),
            resources: resourceState(),
            concentration: null,
            resting: null,
            lastLongRestAt: null,
            lastShortRestAt: null,
            spellcasting: noSpellcasting(),
            creatureType: event.creatureType ?? null,
            // Nobody has said, which is what every log written before this
            // field existed says — so both frozen fixtures fold unchanged.
            alignment: event.alignment ?? null,
            // Nobody has said, which is what every log written before this
            // field existed says — so both frozen fixtures fold unchanged, and
            // the one line in the book that wants it asks rather than guesses.
            declaredDamageType: null,
            defenses: event.defenses ?? {},
            // Absent means none, which is what every log written before this
            // field existed says — so both frozen fixtures fold unchanged.
            conditionImmunities: event.conditionImmunities ?? [],
            // Absent means nobody pinned one, and `placeCreature` then defaults
            // to Medium exactly as it always has — so both frozen fixtures fold
            // unchanged and neither was regenerated.
            size: event.size ?? null,
            // Absent means nobody has said, which is what every log written
            // before this field existed says and what a character says for
            // ever — so both frozen fixtures fold unchanged and neither was
            // regenerated, and the rule that reads a rating asks rather than
            // reading an absence as a zero.
            cr: event.cr ?? null,
            side: event.side ?? null,
            // Nobody has said, which is what every log written before this
            // field existed says — so both frozen fixtures fold unchanged and
            // an Attack action holds the one swing it always held.
            heads: null,
            // Nobody's, until a `creature-summoned` says otherwise. Which is
            // what every log written before summoning existed says, so both
            // frozen fixtures fold unchanged.
            summonedBy: null,
            // Nothing made it, which is what every log written before a
            // feature could make a thing says — so both frozen fixtures fold
            // unchanged and neither was regenerated.
            device: event.device ?? null,
            activeFeatures: [],
            // In its own shape, which is what every log written before a form
            // could be worn says — so both frozen fixtures fold unchanged.
            shape: null,
            // And in the form its own line returns to, which is what every log
            // written before a printed form could be taken says — so both
            // frozen fixtures fold unchanged. Null is the printed default
            // rather than an absence; see `formWornBy`.
            form: null,
            // Nothing has been spent, which is what every log says on the
            // event that adds a creature — so both frozen fixtures fold
            // unchanged and a fresh stat block has every line it prints.
            expendedLines: [],
            readied: null,
            lastDamage: null,
            // Nobody falls into a game. Absent is what every log written
            // before this field existed says, so both frozen fixtures fold
            // unchanged.
            falling: null,
            // In the scene, which is what every log written before a creature
            // could be sent elsewhere says — so both frozen fixtures fold
            // unchanged.
            elsewhere: null,
            bonuses: [],
            armorClasses: [],
            rollModifiers: [],
            grantedDefenses: [],
            speedModifiers: [],
            senseModifiers: [],
            damageReductions: [],
            damagePenalties: [],
            // Nothing has drained a score. Empty is what every log written
            // before a score could be lowered says, so both frozen fixtures
            // fold unchanged.
            abilityLowerings: [],
            fallWards: [],
            lifts: [],
            jumpAllowances: [],
            attackRiders: [],
            weaponRiders: [],
            grantedConditionImmunities: [],
            creatureTypeMasks: [],
            lineImmunities: [],
            payouts: [],
            attachments: [],
            // Nothing is on fire. Empty is what every log written before the
            // glossary's hazards existed says, so both frozen fixtures fold
            // unchanged.
            hazards: [],
            actionRules: [],
            grantedReactions: [],
            healingRules: [],
            hitPointMaxima: [],
            deniedBenefits: [],
            passiveDefenses: [],
            initiativeBonuses: [],
            inventory: [],
            equipped: [],
            attuned: [],
            coins: 0,
            character: null,
          },
        },
      };
    }

    case 'creature-summoned': {
      const creature = creatureOf(state, event, event.id);
      // A creature is held by a casting, kept by its summoner or controlled by
      // them — one of the three, never two and never none. Two lifetimes would
      // end it at whichever ran out first, and no lifetime is a link saying
      // nothing.
      const lifetimes = [
        event.castingId !== undefined ? 'a casting' : null,
        event.kept !== undefined ? 'the terms it is kept on' : null,
        event.controlled !== undefined ? 'the terms it is controlled on' : null,
      ].filter((named): named is string => named !== null);
      if (lifetimes.length !== 1) {
        throw new CorruptLogError(
          event,
          `${event.id} is summoned by ${event.by} naming ${
            lifetimes.length === 0
              ? 'neither a casting nor any terms it is bound on'
              : `both ${lifetimes.join(' and ')}`
          }`,
        );
      }
      const bond: SummonBond =
        event.castingId !== undefined
          ? { by: event.by, castingId: event.castingId }
          : event.kept !== undefined
            ? { by: event.by, castingId: null, kept: event.kept }
            : { by: event.by, castingId: null, controlled: event.controlled! };
      // A casting that is not running cannot be what is holding a creature
      // here: the link would be born already broken, and `strandedSummons`
      // would report a departure that was owed from the creature's first
      // moment. The command refuses it (`not_ongoing`) on the same reading
      // the duplicate below is refused on, and `state.ongoing` is the seam's
      // to read — the record is written by `ongoing.ts` from the same log.
      if (bond.castingId !== null && state.ongoing[bond.castingId] === undefined) {
        throw new CorruptLogError(
          event,
          `${bond.castingId} is not a spell that is still running; it cannot be what holds ${event.id} here`,
        );
      }
      // Restating the same binding is harmless; two castings claiming one
      // creature is not a new fact but a rewrite of one whose ending was
      // about to take the creature away. The command refuses that, so a
      // contradiction in the log means it was bypassed — the corrupt-log
      // case, exactly as `creature-type-declared` reads it.
      if (creature.summonedBy !== null && sameBond(creature.summonedBy, bond)) {
        return next;
      }
      if (creature.summonedBy !== null) {
        throw new CorruptLogError(
          event,
          `${event.id} is already ${describeBond(creature.summonedBy)}; it cannot also be ${describeBond(bond)}`,
        );
      }
      return withCreature(next, event.id, { summonedBy: bond }, creature);
    }

    case 'summons-control-renewed': {
      const creature = creatureOf(state, event, event.id);
      // A renewal moves the clock on a control somebody holds. One nobody
      // holds, or somebody else holds, is not a later fact about the same bond
      // but a bond written from nowhere — the command reads the bond first and
      // refuses (`target_not_dead`, since a creature the caster does not
      // control is a live one the spell is not cast on), so one in the log
      // means it was bypassed: the corrupt-log case.
      const held = creature.summonedBy;
      if (held === null || held.controlled === undefined) {
        throw new CorruptLogError(event, `${event.id} is under nobody's control; there is nothing to renew`);
      }
      if (held.by !== event.by) {
        throw new CorruptLogError(
          event,
          `${event.id} is controlled by ${held.by}; ${event.by} cannot renew a control they do not hold`,
        );
      }
      return withCreature(
        next,
        event.id,
        { summonedBy: { ...held, controlled: { ...held.controlled, until: event.until } } },
        creature,
      );
    }

    case 'creature-removed': {
      const creature = creatureOf(state, event, event.id);
      // A caster who leaves the game takes their ongoing spell with them.
      // Their record is about to be deleted, so the casting id has to be read
      // off it first or the effects it created would dangle for good.
      const cleaned =
        creature.concentration === null
          ? next
          : releaseCasting(next, event.id, creature.concentration.castingId);
      const creatures = { ...cleaned.creatures };
      delete creatures[event.id];
      // Every *other* spell that was on them stops being on them. Not ended —
      // SRD does not end a Cleric's Bless because one of the blessed walked
      // out — but a name in `on` that no longer belongs to anybody is a
      // dispellable target that does not exist.
      return withoutTarget(
        { ...cleaned, creatures, timers: timersApartFrom(cleaned.timers, event.id) },
        event.id,
        null,
      );
    }

    case 'character-created': {
      const creature = creatureOf(state, event, event.id);
      return withCreature(
        next,
        event.id,
        {
          character: event.record,
          spellcasting: event.spellcasting,
          initiativeBonuses: event.initiativeBonuses,
        },
        creature,
      );
    }

    case 'character-advanced': {
      const creature = creatureOf(state, event, event.id);
      if (creature.character === null) {
        throw new CorruptLogError(event, `${event.id} was not created from character choices`);
      }
      return withCreature(
        next,
        event.id,
        {
          character: event.record,
          // The new level derives a fresh sheet — new hit points, new
          // proficiency, new everything the level changes — and it knows
          // nothing about what this character is wearing. So the sheet is the
          // new one, and its armour comes from the equipment state, which the
          // level did not touch. Gaining a level does not take your armour off,
          // and it does not put back what you took off either.
          sheet: withEquipment(event.sheet, creature.equipped),
          spellcasting: event.spellcasting,
          initiativeBonuses: event.initiativeBonuses,
        },
        creature,
      );
    }

    case 'creature-side-declared': {
      const creature = creatureOf(state, event, event.id);
      return withCreature(next, event.id, { side: event.side }, creature);
    }

    case 'creature-heads-declared': {
      const creature = creatureOf(state, event, event.id);
      // Overwritten rather than refused, for the reason a side is: SRD's Hydra
      // loses a head to 25 damage and grows two back at the end of its turn,
      // so a second declaration is the next thing that happened rather than a
      // contradiction of the first. What the reducer will not accept is a
      // count no creature could have — the command refuses it too, so one in
      // the log means the command was bypassed.
      if (!Number.isInteger(event.heads) || event.heads < 1) {
        throw new CorruptLogError(event, `${event.heads} is not a number of heads`);
      }
      return withCreature(next, event.id, { heads: event.heads }, creature);
    }

    case 'spellcasting-declared': {
      const creature = creatureOf(state, event, event.id);
      return withCreature(next, event.id, { spellcasting: event.spellcasting }, creature);
    }

    case 'creature-type-declared': {
      const creature = creatureOf(state, event, event.id);
      // A type is durable: a stat block prints it, a species grants it, a DM
      // declares it once. Restating it is harmless and changes nothing;
      // contradicting it is not a new fact but a rewrite of one that Hold
      // Person may already have been cast on the strength of. The command
      // layer refuses that, so a contradiction in the log means it was
      // bypassed — the corrupt-log case. A transformation that legitimately
      // changes a type (Wild Shape, Polymorph) will be its own event.
      if (creature.creatureType === event.creatureType) return next;
      if (creature.creatureType !== null) {
        throw new CorruptLogError(
          event,
          `${event.id} is already established as ${creature.creatureType}; a declaration cannot make them ${event.creatureType}`,
        );
      }
      return withCreature(next, event.id, { creatureType: event.creatureType }, creature);
    }

    case 'damage-type-declared': {
      const creature = creatureOf(state, event, event.id);
      // **Replaced rather than held against a contradiction**, which is the
      // opposite of the neighbour above and for the reason the neighbour gives:
      // a creature's type is what it *is*, and this is a choice a table made
      // about a block that printed five and chose none. A DM who says "Fire"
      // and then "Cold" has changed their mind about a half-dragon, not
      // rewritten a fact a spell was cast on the strength of.
      return withCreature(next, event.id, { declaredDamageType: event.damageType }, creature);
    }
  }

  return unhandledEvent(event);
}

/** Two bonds that say the same thing: the same summoner, and the same lifetime. */
const sameBond = (a: SummonBond, b: SummonBond): boolean =>
  a.by === b.by &&
  a.castingId === b.castingId &&
  a.kept?.spell === b.kept?.spell &&
  a.kept?.untilSummonerDies === b.kept?.untilSummonerDies &&
  a.controlled?.spell === b.controlled?.spell &&
  a.controlled?.until === b.controlled?.until;

/** How a refusal names a bond: by the casting that holds it, or the spell it is kept or controlled through. */
const describeBond = (bond: SummonBond): string =>
  bond.castingId !== null
    ? `held by ${bond.castingId}`
    : bond.controlled !== undefined
      ? `controlled by ${bond.by} through ${bond.controlled.spell}`
      : `kept by ${bond.by} through ${bond.kept?.spell ?? 'an unnamed spell'}`;

/**
 * SRD Animate Dead: "The creature is under your control for 24 hours, after
 * which it stops obeying any command you've given it."
 *
 * A control whose `until` the clock has passed is over, and the creature is
 * nobody's — still in the scene, still on the map, no longer bound. Derived
 * rather than written, for the reason `expireEffects` is: a deadline arriving
 * is not a decision anybody makes, and the two commands that move the clock
 * are not this seam's to teach. What differs from a timer is only what runs
 * out — a bond on the creature rather than a line the fold can delete — and a
 * bond ending takes nothing else with it, which is exactly why it needs no
 * batch and can live here.
 *
 * By reference where nothing changed, which is what keeps every other pass
 * from marking the world moved.
 */
export function lapseExpiredControl(state: GameState): GameState {
  let current = state;
  for (const key of Object.keys(state.creatures).sort()) {
    const creature = state.creatures[key];
    const until = creature?.summonedBy?.controlled?.until;
    if (creature === undefined || until === undefined || state.elapsed < until) continue;
    current = {
      ...current,
      creatures: { ...current.creatures, [key]: { ...creature, summonedBy: null } },
    };
  }
  return current;
}
