/**
 * An effect ended by something that happens.
 *
 * The fifth way a casting ends, and the only one that is neither a moment on
 * the clock nor somebody's decision: Invisibility ends when its target
 * attacks, Mage Armor when the target dons armour, Animal Friendship when the
 * caster or an ally damages the target. Nobody decides any of that, so the
 * reducer finds it — derived, with no event, exactly as it finds a lost
 * Concentration.
 *
 * **Two populations and one reading of the log.** SRD prints the same sentence
 * on things that were never cast — Potion of Invisibility ends "if you make an
 * attack roll, deal damage, or cast a spell", word for word what Invisibility
 * says — so {@link endingFactsOf} is read once and two passes consume it:
 * {@link endTriggeredCastings} over `ongoing`, and {@link endTriggeredEffects}
 * over the timers a conferral filed. One shared *rule*, not one shared loop:
 * the two end different things through different doors.
 *
 * Two things this module is careful about. A trigger hangs on a consequence
 * event, or on the one structured fact `roll-recorded` carries — that an
 * attack roll was **made**, which is the whole of SRD Invisibility's first
 * sentence and asks nothing about what the die came to. And "ally" is
 * declared allegiance with three answers, of which only two end anything —
 * `allyOfCaster` withholds rather than inventing.
 */
import type { CharacterId } from '@ie/shared';
import { itemSource } from '../catalogue.js';
import { instancesEndingEarly, sourceOfInstance } from '../conditions.js';
import {
  CONFERRAL_END_CAUSES,
  type DeedEndCause,
  type EffectEndCause,
  type EffectTarget,
  timerKey,
} from '../timers.js';
import {
  castingIdOf,
  castingNumber,
  creaturesStandingInCastingArea,
  type OngoingSpell,
  regionOfCastingArea,
} from '../spells.js';
import { isWoundSource } from '../monster.js';
import {
  apartFrom,
  dispelOnPinning,
  positionOf,
  type PositionState,
  spaceInRegion,
  type TerrainRegion,
} from '../positioning.js';
import type { CastingEndTrigger } from '../spell-definitions.js';

import type { GameEvent } from '../events.js';
import type { GameState } from '../state.js';
import { type Applying, seamOf } from './common.js';
import {
  casterOf,
  endTimedCondition,
  isOn,
  releaseCasting,
  releaseGrants,
  releaseOnTarget,
  spellOn,
} from './release.js';

/**
 * Whether the creature that dealt this damage is the caster or one of their
 * allies — and the third answer, which is the point of the function.
 *
 * SRD writes "you or your allies" in five spells and the engine holds
 * allegiance as a **declared** fact: `side` is null until somebody says so.
 * So there are three answers and not two, exactly as there are for cover and
 * for sight, and the one that matters is `unknown`. A table not tracking sides
 * must not have an ending invented for it, and must not silently lose one
 * either — which is why {@link withheldEndings} exists to be asked.
 *
 * **The caster is never in doubt**, because the sentence names them: "**you**
 * or one of your allies". That branch reads no side at all, so a Charm Person
 * cast by a creature nobody has placed on a side still ends when its own
 * caster strikes the target.
 *
 * One function, two callers — the reducer's derived pass and the query — for
 * the reason this file records everywhere else: two implementations of one
 * sentence agree until the day they do not.
 */
export type AllyVerdict = 'caster' | 'ally' | 'not-ally' | 'unknown';

export function allyOfCaster(
  state: GameState,
  casterId: string,
  dealer: string,
): AllyVerdict {
  if (dealer === casterId) return 'caster';
  const caster = state.creatures[casterId];
  const hand = state.creatures[dealer];
  if (caster?.side == null || hand?.side == null) return 'unknown';
  return caster.side === hand.side ? 'ally' : 'not-ally';
}

/**
 * What this event says happened, in the vocabulary a trigger is written in.
 *
 * **Read off the event, and off a consequence event rather than a roll** —
 * with one exception the sentence itself makes. `roll-recorded` changes no
 * state by rule, so no ending hangs on what a die came to; but SRD
 * Invisibility ends when the target "makes an attack roll", which is a fact
 * about the roll having been thrown and not about its outcome, and the only
 * event that names the roller of a swing that spent no Attack action is the
 * roll's own record. So `target-attacks` reads `roll-recorded.attackRoll`, a
 * structured mark the two attack rollers write and nothing else does, and
 * still reads `attack-made` beside it: a log written before the mark carries
 * only the action, and must fold to the state it always did.
 *
 * One event can say two things: damage names both its dealer — the fact
 * Hellish Rebuke needed, because `source` is prose and prose cannot be aimed
 * at — and its victim, and the two causes read opposite ends of it.
 */
type EndingFact =
  | {
      /** {@link DeedEndCause} — the four that name one creature and nothing else. */
      readonly cause: DeedEndCause;
      readonly who: CharacterId;
    }
  | {
      readonly cause: 'caster-or-ally-damages-target';
      readonly victim: CharacterId;
      readonly dealer: CharacterId;
    }
  /**
   * The creature a blow landed on, whoever swung and whether anybody did.
   *
   * `to` rather than `who` deliberately: `who` is the discriminant
   * {@link timerFactsOf} narrows on to hand a timer the four deeds, and a
   * second field of that name would quietly widen what an item's conferral
   * could be ended by. The drop to 0 reaches a timer by name there instead,
   * and `target-takes-damage` does not reach one at all.
   */
  | {
      readonly cause: 'target-takes-damage' | 'target-drops-to-0';
      readonly to: CharacterId;
    }
  /** The creature a casting is sustaining, found through `summonedBy`. */
  | {
      readonly cause: 'summon-takes-damage' | 'summon-drops-to-0';
      readonly summon: CharacterId;
    }
  /**
   * The sleeper a neighbour has just spent an action shaking.
   *
   * `woken` rather than `who` for the reason `to` is not `who`: the `who`
   * field is the discriminant {@link timerFactsOf} narrows on to hand a timer
   * the four deeds, and a second field of that name would quietly widen what
   * a potion's conferral could be ended by.
   */
  | {
      readonly cause: 'shaken-awake';
      readonly woken: CharacterId;
    }
  /**
   * A creature whose authoritative position just changed — a walk or a
   * teleport, which write the same `creature-moved`.
   *
   * `mover` rather than `who`, for the reason `to` and `woken` are not: the
   * `who` field is the discriminant {@link timerFactsOf} narrows on,
   * and a timer has no area for anybody to leave. Whether the mover is the
   * casting's caster, and whether they are now outside its area, is
   * {@link subjectOf}'s question — the fact says only that somebody moved.
   */
  | {
      readonly cause: 'caster-leaves-the-area';
      readonly mover: CharacterId;
    }
  /**
   * A creature a blow has just left at 0, read as a possible **caster** — SRD
   * Warding Bond's "if you drop to 0 Hit Points". `fallen` rather than `who`
   * for the reason `to` is not `who`, and rather than `to` because
   * {@link subjectOf} reads it against `record.caster` and not `isOn`. (W7-S19)
   */
  | {
      readonly cause: 'caster-drops-to-0';
      readonly fallen: CharacterId;
    }
  /**
   * A creature whose authoritative position just changed, read against the
   * distance a casting keeps between its caster and what it is on or sustains
   * — SRD Warding Bond's and Unseen Servant's sixty feet. The same event
   * `caster-leaves-the-area` reads, under its own name so the two questions are
   * asked apart. (W7-S19)
   */
  | {
      readonly cause: 'separated-beyond';
      readonly mover: CharacterId;
    }
  /**
   * A wind may have met a cloud — SRD Fog Cloud's "until a strong wind (such
   * as one created by _Gust of Wind_) disperses it". (W9-S2)
   *
   * `declared` is the table's wind: a region, or the whole scene. Absent, the
   * winds are the running castings whose record pins a `disperses` clause,
   * and this says only that one of them or one of the clouds may have moved —
   * which ones meet is {@link subjectOf}'s question, asked of each cloud.
   */
  | {
      readonly cause: 'dispersed-by-wind';
      readonly declared?: TerrainRegion | 'everywhere';
    }
  /**
   * An item taken off the creature wearing it — SRD Armor of Invulnerability's
   * "or until you are no longer wearing the armor". `unworn` rather than `who`
   * for the reason `to` is not `who`: this is not a deed, and it carries the
   * item, which a timer has to match against the source it was filed under.
   */
  | {
      readonly cause: 'source-item-removed';
      readonly unworn: CharacterId;
      readonly item: string;
    };

/**
 * SRD Mage Armor's "dons armor" is the body slot, not a Shield.
 *
 * The same question `withEquipment` asks when it derives the sheet's two
 * armour fields, and the same one `mustBeUnarmored` asks when the spell is
 * cast — "isn't wearing armor" is one sentence, and a Shield is not what it
 * refuses. Asked of the item the event names rather than of the creature,
 * because the event is what says the moment arrived.
 */
function isBodyArmor(state: GameState, event: { readonly id: CharacterId; readonly item: string }): boolean {
  // Read off the creature rather than off a catalogue: the inventory seam has
  // already put the pinned record on the creature by the time this pass runs.
  const piece = state.creatures[event.id]?.equipped.find((held) => held.id === event.item)?.armor ?? null;
  return piece !== null && piece.category !== 'shield';
}

function endingFactsOf(state: GameState, event: GameEvent): readonly EndingFact[] {
  switch (event.type) {
    // A slot of the Attack action spent on a printed use rather than a swing
    // — the Roper's Reel, the Wight's Life Drain — made no attack at all.
    // (W7-B10)
    case 'attack-made':
      return event.use === undefined ? [{ cause: 'target-attacks', who: event.id }] : [];
    // "makes an attack roll": every road — the Attack action, an Opportunity
    // Attack, a readied swing, a swing outside any fight, a later
    // activation's spell attack — and only the roll that says it was one.
    case 'roll-recorded':
      return event.attackRoll === true ? [{ cause: 'target-attacks', who: event.who }] : [];
    // The settled casting, never the declared one: SRD Counterspell makes a
    // declaration that may dissipate "with no effect", and a spell that never
    // settled is not one the target cast.
    case 'spell-cast':
      return [{ cause: 'target-casts', who: event.id }];
    case 'item-equipped':
      return isBodyArmor(state, event) ? [{ cause: 'target-dons-armor', who: event.id }] : [];
    // SRD Armor of Invulnerability: "or until you are no longer wearing the
    // armor". **The one door a worn copy leaves by**: `equipped` changes on
    // this event and no other, and every command that would take a worn copy
    // away — a loss, a hand-over, a drop — refuses while it is worn, and the
    // two that destroy one (a corroded suit, a torn fan) write this first.
    case 'item-unequipped':
      return [{ cause: 'source-item-removed', unworn: event.id, item: event.item }];
    // SRD Sleep: "…or someone within 5 feet of it takes an action to shake it
    // out of the spell's effect." The five feet and the action were spent by
    // `wakeCreature`; what is left is the fact, and it names one creature.
    case 'creature-woken':
      return [{ cause: 'shaken-awake', woken: event.id }];
    // SRD Tiny Hut: "The spell ends early if you leave the Emanation." A walk
    // and a teleport both write this event, so both are read here; which
    // casting it is the caster of, and whether they are now outside, is asked
    // per record below.
    case 'creature-moved':
      return [
        { cause: 'caster-leaves-the-area', mover: event.id },
        // And the distance a casting keeps between its two ends — SRD Warding
        // Bond's, SRD Unseen Servant's — asked per record below of whoever moved.
        { cause: 'separated-beyond', mover: event.id },
        // And SRD Gust of Wind's Line, which "blasts from you" and so walks
        // with its caster: asked only when the mover carries a wind or a
        // cloud, so an ordinary step never scans the scene. (W9-S2)
        ...(carriesWeather(state, event.id) ? [{ cause: 'dispersed-by-wind' } as const] : []),
      ];
    // SRD Fog Cloud's "until a strong wind … disperses it": the table's wind,
    // over a region or the whole scene, and the four moments a casting's own
    // wind or cloud can come to lie somewhere new — cast, turned, moved, or
    // grown by the bank its slot paid for. (W9-S2)
    case 'wind-declared':
      return [{ cause: 'dispersed-by-wind', declared: event.region ?? 'everywhere' }];
    case 'spell-ongoing':
      return weatherFact(state, event.casting.castingId);
    case 'spell-aim-changed':
    case 'spell-origin-moved':
      return weatherFact(state, event.castingId);
    case 'obscurement-declared':
      return event.source === undefined ? [] : weatherFact(state, event.source);
    case 'damage-taken':
      return [
        // **The three that read the creature the blow landed on**, so a trap
        // naming nobody still pulls them — and none of them fires on a hit
        // that dealt nothing. "If it takes **any** damage" is the widest
        // sentence in the vocabulary and a blow a Resistance took down to zero
        // is still not damage taken: `breakLostConcentration` reads
        // `amount > 0` off this same event for that reason, and two passes in
        // one fold disagreeing about whether a `damage-taken` was damage is a
        // defect rather than a nuance.
        ...(event.amount > 0
          ? [
              { cause: 'target-takes-damage', to: event.id } as const,
              { cause: 'summon-takes-damage', summon: event.id } as const,
              // `drops-to-0` is the state the event left behind, which is the
              // reading `target-dons-armor` already takes: this pass runs
              // after the fold applied the event. **It is the total and not
              // the transition**, so a creature already at 0 taking another
              // blow pulls it too. That costs nothing for the castings in the
              // book, whose first drop ended them — but a casting laid on a
              // creature that was *already* down would end on the next blow
              // rather than on a fall, and the honest name for that is a
              // residue and not a rule. A maximum lowered onto 0 is no blow
              // at all and reaches this nowhere.
              // And the same drop read of the creature a casting is
              // *sustaining* — SRD Unseen Servant's "If it drops to 0 Hit
              // Points, the spell ends" — which `subjectOf` finds through
              // `summonedBy` as it finds the steed's blow.
              ...(state.creatures[event.id]?.vitals.hp === 0
                ? [
                    { cause: 'target-drops-to-0', to: event.id } as const,
                    { cause: 'summon-drops-to-0', summon: event.id } as const,
                    // And the same drop read of a casting's **caster** — SRD
                    // Warding Bond's "if you drop to 0 Hit Points" — found
                    // through `record.caster`, since the caster holds nothing
                    // of a bond laid on somebody else.
                    { cause: 'caster-drops-to-0', fallen: event.id } as const,
                  ]
                : []),
            ]
          : []),
        // And the two that read the other end of it. A trap names nobody, and
        // that is a real answer rather than a gap: there is no creature that
        // dealt it, so neither of these can fire — and neither fires on
        // nothing, for the same reason the three above do not. An amount of 0
        // is also a blow a damage **threshold** turned aside: SRD calls that
        // "superficial" and says it "doesn't reduce Hit Points", which is
        // Immunity and so damage *not taken*. Two tracks reached that reading
        // independently, one from Resistance and one from thresholds, which is
        // the strongest evidence it is the right one.
        ...(event.by === undefined || event.amount === 0
          ? []
          : [
              { cause: 'target-deals-damage', who: event.by } as const,
              {
                cause: 'caster-or-ally-damages-target',
                victim: event.id,
                dealer: event.by,
              } as const,
            ]),
      ];
    default:
      return [];
  }
}

/**
 * The creature this fact makes *this* casting's business, or null.
 *
 * **Every sentence in the vocabulary says whom it is about, and all but one of
 * them say "the target".** `spellOn` is the engine's answer to which creatures
 * those are, so a Mage Armor on the wizard is untouched by the fighter putting
 * a breastplate on and a Charm Person is untouched by damage dealt to somebody
 * it never caught. The exception is the creature a casting is **sustaining**:
 * `isOn` asks what a creature is holding of the casting and a steed holds
 * nothing, so `summonedBy` is the only link that can answer and the eligibility
 * rule is its own.
 *
 * One function rather than a gate written beside the loop, because the gate is
 * the *rule* — that a fact belongs to a casting — and a second cause read by
 * an `isOn` somebody remembered to skip is how a Phantom Steed comes to end on
 * a blow struck three rooms away.
 */
function subjectOf(
  state: GameState,
  record: OngoingSpell,
  fact: EndingFact,
  trigger: CastingEndTrigger,
): CharacterId | null {
  switch (fact.cause) {
    case 'summon-takes-damage':
    case 'summon-drops-to-0':
      return state.creatures[fact.summon]?.summonedBy?.castingId === record.castingId
        ? fact.summon
        : null;

    // SRD Warding Bond: "The spell ends if you drop to 0 Hit Points." The
    // casting's own caster and nobody else, whatever the casting is on.
    case 'caster-drops-to-0':
      return fact.fallen === record.caster ? fact.fallen : null;

    // "…or if you and the target become separated by more than 60 feet." The
    // mover has to be one end of the bond, and then the pair is measured — see
    // {@link separatedBeyond}.
    case 'separated-beyond':
      return separatedBeyond(state, record, fact.mover, trigger.feet);

    case 'caster-or-ally-damages-target':
      // Withheld rather than invented: only a verdict that says yes ends
      // anything, and `unknown` is reported by `withheldEndings`.
      return ['caster', 'ally'].includes(allyOfCaster(state, record.caster, fact.dealer)) &&
        isOn(state, record, fact.victim)
        ? fact.victim
        : null;

    case 'target-takes-damage':
    case 'target-drops-to-0':
      return isOn(state, record, fact.to) ? fact.to : null;

    case 'shaken-awake':
      return isOn(state, record, fact.woken) ? fact.woken : null;

    // The one cause about the caster and a place: this casting's own caster,
    // and the area it pinned no longer holding them.
    case 'caster-leaves-the-area':
      return fact.mover === record.caster && casterOutsideArea(state, record) ? fact.mover : null;

    // An item's conferral alone: `checkSpellDefinition` refuses it on a
    // definition, so no casting is ever about a garment.
    case 'source-item-removed':
      return null;

    // A cloud is on nobody, so the creature it names is its caster — the
    // subject `caster-leaves-the-area` names for the same reason — and the
    // scope is always the whole casting. (W9-S2)
    case 'dispersed-by-wind':
      return blownAway(state, record, fact.declared) ? (record.caster as CharacterId) : null;

    default:
      return isOn(state, record, fact.who) ? fact.who : null;
  }
}

/**
 * Whether a casting's caster is standing outside the area it pinned.
 *
 * Off the record's own geometry — the stationary Emanation's pinned point, its
 * distance — through the same reader every standing clause uses, so the dome
 * the barrier refuses a goblin at is the dome the wizard has to leave. A
 * casting whose area cannot be located, or a caster nobody has placed, is
 * nowhere in particular and has left nothing: the withholding direction.
 */
function casterOutsideArea(state: GameState, record: OngoingSpell): boolean {
  const scene = state.scene;
  if (scene === null || positionOf(scene, record.caster as CharacterId) === null) return false;
  const inside = creaturesStandingInCastingArea(scene, record);
  return inside !== null && !inside.has(record.caster as CharacterId);
}

/**
 * The creature a casting has been separated from past its feet, or null.
 *
 * SRD Warding Bond: "if you and the target become separated by more than 60
 * feet"; SRD Unseen Servant: "a task that would move it more than 60 feet away
 * from you". **The other end is whatever the casting is on or sustains** —
 * `spellOn` for the bond's target, `summonedBy` for the servant — measured
 * from the caster through the same ruler every distance in the engine uses. A
 * move by anybody else changes no distance in the bond and is not read; a pair
 * nobody can measure, because one of them is unplaced or away in another
 * place, has not been separated, which is the withholding direction. A
 * trigger that prints no feet is one the validator refused, and fires on
 * nothing. (W7-S19)
 */
function separatedBeyond(
  state: GameState,
  record: OngoingSpell,
  mover: CharacterId,
  feet: number | undefined,
): CharacterId | null {
  if (feet === undefined) return null;
  const caster = record.caster as CharacterId;
  const others = new Set<string>(spellOn(state, record).filter((who) => who !== caster));
  for (const creature of Object.values(state.creatures)) {
    if (creature.summonedBy?.castingId === record.castingId) others.add(creature.id);
  }
  if (mover !== caster && !others.has(mover)) return null;
  for (const other of [...others].sort()) {
    const apart = apartFrom(state, caster, other as CharacterId);
    if (apart !== null && apart > feet) return other as CharacterId;
  }
  return null;
}

/** Whether a running casting's area disperses gas — SRD Gust of Wind's Line. (W9-S2) */
const blowsWind = (record: OngoingSpell): boolean =>
  record.areaStanding?.some((standing) => standing.kind === 'disperses') === true;

/** Whether a running casting is ended by a strong wind — SRD Fog Cloud. (W9-S2) */
const windEnds = (record: OngoingSpell): boolean =>
  record.endsEarly?.some((trigger) => trigger.on === 'dispersed-by-wind') === true;

/** The wind fact, where this casting is a wind or a cloud and not otherwise. */
function weatherFact(state: GameState, castingId: string): readonly EndingFact[] {
  const record = state.ongoing[castingId];
  return record !== undefined && (blowsWind(record) || windEnds(record))
    ? [{ cause: 'dispersed-by-wind' }]
    : [];
}

/** Whether this creature is the caster of a running wind or cloud. */
function carriesWeather(state: GameState, mover: CharacterId): boolean {
  return Object.values(state.ongoing).some(
    (record) => record.caster === mover && (blowsWind(record) || windEnds(record)),
  );
}

/** The side of a lattice space, in feet. */
const SPACE = 5;

/**
 * Whether two sets of regions share a space of the scene.
 *
 * "Some space in both", on the lattice every other area is read on — the
 * scan {@link lightDispelledBy} makes for the mutual dispel of light, over
 * {@link spaceInRegion}, the one reader of a region against a space. Stops at
 * the first shared space. An unplaced carrier covers nothing, which is
 * `spaceInRegion`'s own answer.
 */
function shareASpace(
  scene: PositionState,
  these: readonly TerrainRegion[],
  those: readonly TerrainRegion[],
): boolean {
  for (let x = 0; x <= scene.extent.width; x += SPACE) {
    for (let y = 0; y <= scene.extent.depth; y += SPACE) {
      for (let z = 0; z <= scene.extent.height; z += SPACE) {
        const space = { x, y, z };
        if (
          these.some((region) => spaceInRegion(scene, region, space)) &&
          those.some((region) => spaceInRegion(scene, region, space))
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * Whether a strong wind reaches this cloud. (W9-S2)
 *
 * SRD Fog Cloud: "until a strong wind (such as one created by _Gust of
 * Wind_) disperses it." The table's wind over the whole scene reaches every
 * cloud; one over a region, or a running casting's own `disperses` area,
 * reaches a cloud whose area it shares a space with.
 *
 * **The cloud is its pinned area and every patch it laid**: SRD Fog Cloud's
 * higher slot grows the bank on the lattice and not the template on the
 * record — see `FOG_CLOUD` — so the bank a level 3 casting spread is fog a
 * gust can reach. A casting whose area cannot be located, and no patch, is
 * nowhere, and nowhere is not blown: the withholding direction
 * {@link casterOutsideArea} takes.
 */
function blownAway(
  state: GameState,
  record: OngoingSpell,
  declared: TerrainRegion | 'everywhere' | undefined,
): boolean {
  if (declared === 'everywhere') return true;
  const scene = state.scene;
  if (scene === null) return false;

  const winds =
    declared !== undefined
      ? [declared]
      : Object.keys(state.ongoing)
          .sort((a, b) => castingNumber(a) - castingNumber(b))
          .flatMap((castingId) => {
            const wind = state.ongoing[castingId];
            if (wind === undefined || castingId === record.castingId || !blowsWind(wind)) return [];
            const region = regionOfCastingArea(wind);
            return region === null ? [] : [region];
          });
  if (winds.length === 0) return false;

  const area = regionOfCastingArea(record);
  const cloud = [
    ...(area === null ? [] : [area]),
    ...Object.keys(scene.obscurement)
      .sort()
      .flatMap((name) => {
        const patch = scene.obscurement[name];
        return patch?.source === record.castingId ? [patch.region] : [];
      }),
  ];
  if (cloud.length === 0) return false;

  return shareASpace(scene, winds, cloud);
}

/** One casting to end, and whether it ends outright or on one creature. */
interface Ending {
  readonly castingId: string;
  /** Null ends the casting; a creature releases it on them and no one else. */
  readonly on: CharacterId | null;
  /** The creature the trigger named, whichever scope it ends at. */
  readonly subject: CharacterId;
}

/**
 * The first casting these facts end, in the order the castings happened.
 *
 * Numerically rather than lexically, as every walk over `ongoing` is, so two
 * folds of one log end them in one order.
 *
 * **The fact has to be this casting's**, which {@link subjectOf} is the whole
 * of: for all but one cause that means a creature the casting is *on*, and for
 * the one it means the creature the casting is sustaining.
 *
 * `settled` is the loop's own memory rather than a rule — see
 * {@link endTriggeredCastings} for why termination is not left to what a
 * release happens to remove.
 */
function nextEnding(
  state: GameState,
  facts: readonly EndingFact[],
  settled: ReadonlySet<string>,
): Ending | null {
  for (const castingId of Object.keys(state.ongoing).sort(
    (a, b) => castingNumber(a) - castingNumber(b),
  )) {
    const record = state.ongoing[castingId];
    if (record?.endsEarly === undefined) continue;

    for (const trigger of record.endsEarly) {
      for (const fact of facts) {
        if (fact.cause !== trigger.on) continue;

        const subject = subjectOf(state, record, fact, trigger);
        if (subject === null) continue;
        if (settled.has(endingKey(castingId, subject))) continue;
        return { castingId, on: trigger.ends === 'target' ? subject : null, subject };
      }
    }
  }
  return null;
}

const endingKey = (castingId: string, subject: CharacterId): string =>
  `${castingId}|${subject}`;

/**
 * End every casting whose trigger this event pulled.
 *
 * Derived rather than commanded, for the reason a broken Concentration and an
 * expired deadline are: **nobody decides that the target swung**. The engine
 * finds it, so no log — however assembled — can show an Invisibility running
 * on a creature that has just cast a spell, and no caller has to remember a
 * sentence printed on somebody else's spell.
 *
 * **Cheap first.** Seven event types can say anything at all here — the six
 * consequence events (`endingFactsOf`'s cases, `roll-recorded` the newest of
 * them) and `creature-moved`, for the one cause about a place —
 * and every other event returns before `ongoing` is touched. (An
 * `item-unequipped` reaches the walk too and matches nothing: its one fact is
 * an item's conferral's, which no definition may print.) That is the
 * discipline `anyCreature` established for the three passes that sort the
 * whole cast.
 *
 * **And it terminates *structurally*, which is the whole reason `settled`
 * exists.** A release changes the state the next pass reads, so the loop has
 * to consume something it cannot recreate — the move `expireEffects` makes by
 * deleting the timer key *before* it acts on it. Here the consumed thing is
 * the `(casting, creature)` pair, recorded before the release and skipped
 * afterwards, so the candidate set is finite by construction and shrinks by
 * one every iteration whatever a release does.
 *
 * **That was measured rather than assumed.** Progress really is implied today
 * by what the two doors do — `releaseCasting` deletes the record and
 * `releaseOnTarget` takes the subject out of `on`, which the match above
 * requires it to have been in — and a mutation dropping that `on` check
 * **hung the fold** rather than failing a test. Termination resting on what a
 * function three hundred lines away happens to remove is the kind of coupling
 * that is correct until somebody edits the other end, and a wedged fold is the
 * worst possible way to find out.
 *
 * Today it settles in a single step for every registered spell. The loop is
 * what keeps it correct when one blow ends two castings, which the tests do
 * drive: a strike on a charmed Beast by an invisible ally is two causes off
 * one `damage-taken`.
 */
/**
 * The event this module owns: the table's strong wind. (W9-S2)
 *
 * **A seam that writes nothing**, the shape `fold/rolls.ts` keeps for
 * `roll-recorded`: a wind is a moment rather than a state, and what it does —
 * disperse every cloud it reaches — is {@link endTriggeredCastings}' derived
 * reading of the same event, run after this.
 */
export const ENDINGS_EVENTS = ['wind-declared'] as const;

/** The narrowed union this seam reduces, `Extract`ed from the list above. */
export type EndingsEvent = Extract<GameEvent, { type: (typeof ENDINGS_EVENTS)[number] }>;

/** Whether an event is this seam's. Built from the same list, so the two cannot drift. */
export const isEndingsEvent = seamOf(ENDINGS_EVENTS);

/**
 * Reduce one of this seam's events. Exported so `applyOne` may call it and for
 * no other reason.
 */
export function applyEndings({ next }: Applying, event: EndingsEvent): GameState {
  // One member, so there is nothing to switch on: the type is the whole of
  // the claim, and `applyOne`'s own backstop sees what no seam claims.
  void event;
  return next;
}

/**
 * A rite's targets that have strayed out of its range, marked as it happens.
 *
 * > SRD Prayer of Healing: "Up to five creatures of your choice who **remain
 * > within range for the spell's entire casting**".
 *
 * **A drift measured during the rite rather than at its end**, so it is read
 * after every event rather than off a settlement that could only see where
 * everybody finished: a creature that walked off and came back did not remain.
 * Every declaration that pinned a range (`PendingCasting.stayWithin`) has each
 * of its targets measured from its caster through the one ruler every distance
 * uses; one farther than the range is added to `strayed` and stays there.
 * Whoever moved — the target walking off and the caster walking away are one
 * fact, two creatures drifting apart. A pair nobody can measure, because one
 * of them is unplaced, has not strayed: the withholding direction
 * `separatedBeyond` takes for the same question about a running casting.
 *
 * **Derived and writing nothing**, for the reason every pass in this chain is:
 * nobody decides that the ally walked out of the prayer. Cheap first: a log
 * holding no such declaration returns before anything is measured.
 */
export function markStrayedTargets(state: GameState): GameState {
  const watching = Object.values(state.pendingCastings).filter((pending) => pending.stayWithin !== undefined);
  if (watching.length === 0 || state.scene === null) return state;

  let pendingCastings = state.pendingCastings;
  for (const pending of watching) {
    const already = new Set<string>(pending.strayed ?? []);
    const strayed = pending.targets.filter((target) => {
      if (already.has(target) || target === pending.caster) return false;
      const apart = apartFrom(state, pending.caster, target);
      return apart !== null && apart > pending.stayWithin!;
    });
    if (strayed.length === 0) continue;
    pendingCastings = {
      ...pendingCastings,
      [pending.castingId]: { ...pending, strayed: [...already, ...strayed].sort() as CharacterId[] },
    };
  }
  return pendingCastings === state.pendingCastings ? state : { ...state, pendingCastings };
}

export function endTriggeredCastings(state: GameState, event: GameEvent): GameState {
  const facts = endingFactsOf(state, event);
  if (facts.length === 0) return state;

  const settled = new Set<string>();
  let current = state;
  for (;;) {
    const ending = nextEnding(current, facts, settled);
    if (ending === null) return current;
    settled.add(endingKey(ending.castingId, ending.subject));

    current =
      ending.on === null
        ? releaseCasting(current, casterOf(current, ending.castingId), ending.castingId)
        : releaseOnTarget(current, ending.on, ending.castingId);
  }
}

/**
 * A printed condition ended by a blow or by a neighbour shaking the creature.
 *
 * SRD Incubus' Nightmare: "the Unconscious condition **for 1 hour, until it
 * takes damage, or until a creature within 5 feet of it takes an action to
 * wake it**." SRD Brass Dragon Wyrmling's Sleep Breath and SRD Pseudodragon's
 * Sting print the same pair over a condition no spell ever cast.
 *
 * **The third population reading the same facts**, beside the castings above
 * and the timed conferrals beside them, and it is a third rather than a case
 * in either because what holds these is neither an `ongoing` record nor a
 * timer: the Pseudodragon's Unconscious is a condition its Poisoned *carries*,
 * with no deadline of its own for an `endsEarly` to sit on. What holds them
 * all is the **instance**, which is why the marks are there — see
 * `ConditionInstance.endsOnDamage`.
 *
 * **Derived and writing nothing**, for the reason every pass in this chain is:
 * nobody decides that a blow woke somebody. And it reads the same
 * {@link EndingFact}s the two passes above read, so a sleeper whose casting
 * says `shaken-awake` and a sleeper whose stat block printed the clause are
 * ended by one reading of one log.
 *
 * **It terminates structurally.** The instance ids are read off the state this
 * pass was handed, each is visited once, and each visit either removes that
 * instance or finds it already gone — so nothing a removal does can hand the
 * loop back an instance it has settled.
 *
 * **Cheap first**: two event types can say anything at all here, and every
 * other one returns before a creature is touched.
 */
export function endEarlyEndedConditions(state: GameState, event: GameEvent): GameState {
  // Only the two facts this rule is about. `endingFactsOf` answers more
  // questions than this one asks, and reading its whole answer would be this
  // pass discovering a cause it has no sentence for.
  const woken = event.type === 'creature-woken' ? event.id : null;
  const hurt =
    event.type === 'damage-taken' && event.amount > 0 ? event.id : null;
  const subject = woken ?? hurt;
  if (subject === null) return state;

  const creature = state.creatures[subject];
  if (creature === undefined) return state;
  const doomed = instancesEndingEarly(
    creature.conditions,
    woken === null ? 'damage' : 'waking',
  ).map((instance) => instance.id);
  if (doomed.length === 0) return state;

  let current = state;
  for (const instance of doomed) {
    const held = current.creatures[subject];
    if (held === undefined) continue;
    // Gone already, because an instance this loop lifted carried it: the
    // Pseudodragon's Unconscious would go with its Poisoned if a line ever
    // marked both, and lifting what is not there is not an operation.
    if (!held.conditions.instances.some((one) => one.id === instance)) continue;
    // The same door a deadline arriving goes through, so the instance's own
    // timer and anything sourced to the instance go with it. `timerKey` is the
    // derivation `applyConditionTo` filed it under; a key naming no timer is
    // deleted harmlessly, which is every carried instance's case.
    current = endTimedCondition(
      current,
      timerKey({ kind: 'condition', on: subject, instance }),
      { kind: 'condition', on: subject, instance },
    );
  }
  return current;
}

/**
 * SRD Bearded Devil's Infernal Glaive: "The wound closes … **after a spell
 * restores Hit Points to the target**."
 *
 * The third of the wound's three endings, and the only one nothing could
 * schedule or command. The minute is the grant's own deadline, the stanch is
 * the check on the same timer, and this is a fact about a `healed` that has
 * just landed: derived, with no event, the way {@link endEarlyEndedConditions}
 * derives a sleeper woken by a blow.
 *
 * **"A spell", read off the source the heal names** — `castingIdOf` on
 * `healed.source` — so a Cure Wounds closes it and a Healer's Kit, a Lay On
 * Hands, a Hit Die spent on a Short Rest and a DM's award do not. A heal that
 * names nothing closes nothing, which is the withholding direction every
 * unstated fact in the fold takes: the engine cannot show the healing was
 * magical, and closing the wound on a maybe would be the rule quietly doing
 * more than the book says.
 *
 * **Every wound goes, not merely one.** The sentence is about the wound and
 * not about which devil made it, and the same heal that closes one closes the
 * other — a creature can only have one anyway, which `woundOn` is what keeps.
 * The timer goes with the grant, because the deadline and the check are both
 * about a wound that is no longer there.
 */
export function closeHealedWounds(state: GameState, event: GameEvent): GameState {
  if (event.type !== 'healed' || event.source === undefined) return state;
  if (castingIdOf(event.source) === null) return state;
  const creature = state.creatures[event.id];
  if (creature === undefined) return state;

  const doomed = creature.payouts
    .filter((held) => isWoundSource(held.source))
    .map((held) => held.source);
  if (doomed.length === 0) return state;

  const timers = { ...state.timers };
  for (const source of doomed) {
    delete timers[timerKey({ kind: 'grants', on: event.id, source })];
  }
  return {
    ...state,
    timers,
    creatures: {
      ...state.creatures,
      [event.id]: doomed.reduce(releaseGrants, creature),
    },
  };
}

/**
 * What a fact says to a timer: the creature it happened to, the cause, and —
 * for a removal — the item that came off.
 *
 * **A timer knows the creature it sits on and nothing else** — no caster, no
 * allegiance, no area — so only a fact that names that one creature can reach
 * it: the four deeds, the fall, and the removal. Everything else a casting
 * reads is dropped here, before the walk.
 */
interface TimerFact {
  readonly cause: EffectEndCause;
  readonly on: CharacterId;
  /** The catalogue id taken off, for `source-item-removed` and nothing else. */
  readonly item?: string;
}

function timerFactsOf(fact: EndingFact): readonly TimerFact[] {
  if ('who' in fact) return [{ cause: fact.cause, on: fact.who }];
  if (fact.cause === 'target-drops-to-0') return [{ cause: fact.cause, on: fact.to }];
  if (fact.cause === 'source-item-removed') {
    return [{ cause: fact.cause, on: fact.unworn, item: fact.item }];
  }
  return [];
}

/**
 * Whether this fact ends a timer on `on` whose effect came from `source`.
 *
 * The creature first, then the sentence, then — for a removal only — that the
 * item taken off is the one the effect was filed under: a Potion of
 * Invisibility's Invisible and a Cloak of Invisibility's are two instances
 * under two sources, and taking the cloak off ends one of them.
 */
const pulls = (
  fact: TimerFact,
  on: CharacterId,
  source: string,
  triggers: readonly EffectEndCause[],
): boolean =>
  fact.on === on &&
  triggers.includes(fact.cause) &&
  (fact.item === undefined || itemSource(fact.item) === source);

/** What a conferral may end on a `grants` timer: its own two causes, never a deed. */
const ENDS_A_GRANT: ReadonlySet<EffectEndCause> = new Set(CONFERRAL_END_CAUSES);

/**
 * Lift a hung grant before its deadline, through the reading its deadline
 * arriving already takes.
 *
 * The key first and the grants by their bare source second — `expireEffects`'
 * `grants` branch, asked early — so what ends is what that source granted on
 * that creature and nothing else. A worn item's *standing* benefit is derived
 * on every read and stored nowhere, so the armour's own Resistance is not what
 * this takes away.
 */
function endTimedGrants(
  state: GameState,
  key: string,
  target: Extract<EffectTarget, { kind: 'grants' }>,
): GameState {
  const timers = { ...state.timers };
  delete timers[key];
  const creature = state.creatures[target.on];
  return {
    ...state,
    timers,
    ...(creature === undefined
      ? {}
      : { creatures: { ...state.creatures, [target.on]: releaseGrants(creature, target.source) } }),
  };
}

/**
 * A timed effect ended by something that happens, with no casting anywhere.
 *
 * SRD Potion of Invisibility: "you have the Invisible condition for 1 hour.
 * The effect ends early if you make an attack roll, deal damage, or cast a
 * spell." The same three sentences Invisibility prints, on a thing that was
 * never cast — so there is no `ongoing` record for {@link
 * endTriggeredCastings} to walk and nothing for `releaseCasting` to address.
 * What holds it is the **timer**, and the timer is what this pass reads.
 *
 * Beside that function rather than inside it, and reading the same
 * {@link EndingFact}s off the same events: one reading of the log, two
 * populations. Folding the two loops together would mean one walk over two
 * unrelated records answering to two different release doors, which is a
 * shared loop rather than a shared rule.
 *
 * **Only a fact naming one creature can reach a timer** — see
 * {@link timerFactsOf} — and **only a conferral's own two causes reach a
 * grant.** SRD Armor of Invulnerability's Immunity "for 10 minutes or until
 * you are no longer wearing the armor" and a Potion of Gaseous Form's
 * Resistance, which ends where the spell's "drops to 0 Hit Points" does, are
 * grants; the deeds end a condition and nothing else, because no item prints
 * one over a grant.
 *
 * **Derived, and it writes nothing**, for the reason every pass in the fold's
 * chain does: nobody decides that the drinker swung, or that the armour came
 * off with its shell still up. And it terminates structurally — the candidate
 * keys are read from the state this pass was handed, each is visited once,
 * and both doors delete the key before they touch the creature, so nothing a
 * release does can hand the loop back a timer it has already settled.
 *
 * **Cheap first.** Only the events {@link endingFactsOf} reads can say
 * anything to a timer, and every other one returns before `timers` is
 * touched — including a `creature-moved`, whose facts name no creature a
 * timer can sit on and so are dropped before the walk rather than discarded
 * once per timer inside it.
 */
export function endTriggeredEffects(state: GameState, event: GameEvent): GameState {
  const facts = endingFactsOf(state, event).flatMap(timerFactsOf);
  if (facts.length === 0) return state;

  let current = state;
  // Sorted, as every walk over a keyed record in the fold is, so two folds of
  // one log settle them in one order.
  for (const key of Object.keys(state.timers).sort()) {
    const timer = current.timers[key];
    if (timer === undefined) continue;

    const target = timer.target;
    const triggers = timer.endsEarly;
    if (triggers === undefined) continue;

    if (target.kind === 'condition') {
      const source = sourceOfInstance(target.instance);
      if (!facts.some((fact) => pulls(fact, target.on, source, triggers))) continue;
      current = endTimedCondition(current, key, target);
    } else if (target.kind === 'grants') {
      const pulled = facts.some(
        (fact) => ENDS_A_GRANT.has(fact.cause) && pulls(fact, target.on, target.source, triggers),
      );
      if (!pulled) continue;
      current = endTimedGrants(current, key, target);
    }
    // A casting's own early endings live on its `ongoing` record, where a
    // scope can be written beside them; a feature's activation has no SRD
    // sentence asking for one.
  }
  return current;
}

/**
 * SRD Darkness's dispel, read of a light that **moves** into it. (E-L2)
 *
 * "If any of this spell's area overlaps with an area of Bright Light or Dim
 * Light created by a spell of level 2 or lower, that other spell is
 * dispelled." A light sourced to a creature — SRD Light on the fighter's
 * shield, a Flame Blade in the druid's hand, a Faerie Fire glow on a goblin,
 * or a Darkness cast on an object somebody picks up — moves with that creature
 * and is never laid again, so the pinning that asks the question in the
 * commands never runs: the bearer walking into the Darkness *is* the moment.
 *
 * **Derived and eventless**, for the reason a lost Concentration is: nobody
 * decides that a Light carried into a Darkness goes out. Asked only of the
 * creatures whose position this event changed, and only of the magical
 * patches carried by one of them, so an ordinary step with no light about
 * never scans a space. Each such patch asks `dispelOnPinning` both ways, as a
 * pinning would: what it now puts out, and whether it is now put out.
 */
export function dispelMovedLight(before: GameState, state: GameState): GameState {
  const was = before.scene;
  const scene = state.scene;
  if (scene === null || was === null) return state;
  const movers = new Set(
    Object.keys(scene.positions).filter((who) => {
      const now = scene.positions[who];
      const then = was.positions[who];
      return now !== undefined && (then === undefined || now.x !== then.x || now.y !== then.y || now.z !== then.z);
    }),
  );
  if (movers.size === 0) return state;

  const carried = (current: GameState) =>
    Object.keys(current.scene?.light ?? {})
      .sort()
      .flatMap((name) => {
        const patch = current.scene!.light[name]!;
        const origin = patch.region.origin;
        if (patch.magical === undefined || patch.covered === true) return [];
        if (!('creature' in origin) || !movers.has(origin.creature)) return [];
        if (patch.source !== undefined && current.ongoing[patch.source] === undefined) return [];
        if (patch.lapsesWith !== undefined && current.timers[patch.lapsesWith] === undefined) return [];
        return [patch];
      });
  if (carried(state).length === 0) return state;

  let current = state;
  for (const patch of carried(state)) {
    // Gone already, to an earlier patch's verdict in this same pass.
    if (patch.source !== undefined && current.ongoing[patch.source] === undefined) continue;
    if (patch.lapsesWith !== undefined && current.timers[patch.lapsesWith] === undefined) continue;
    const verdict = dispelOnPinning(current, patch.region, patch.level, patch.magical!, {
      ...(patch.source === undefined ? {} : { source: patch.source }),
      ...(patch.lapsesWith === undefined ? {} : { lapsesWith: patch.lapsesWith }),
    });
    for (const castingId of verdict.castings) current = dispelCasting(current, castingId);
    for (const key of verdict.glows) current = dispelGlow(current, key);
    if (verdict.itself) {
      if (patch.source !== undefined) current = dispelCasting(current, patch.source);
      else if (patch.lapsesWith !== undefined) current = dispelGlow(current, patch.lapsesWith);
    }
  }
  return current;
}

/** A running casting put out by the dispel, through the one door. */
function dispelCasting(state: GameState, castingId: string): GameState {
  return state.ongoing[castingId] === undefined
    ? state
    : releaseCasting(state, casterOf(state, castingId), castingId);
}

/** A glow on a deadline of its own put out by the dispel — `effect-dispelled`'s release. */
function dispelGlow(state: GameState, key: string): GameState {
  const timer = state.timers[key];
  return timer === undefined || timer.target.kind !== 'grants'
    ? state
    : endTimedGrants(state, key, timer.target);
}
