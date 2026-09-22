/**
 * The two moments an attack consults the defender's passive defences.
 *
 * Owner's ruling, 2026-09-22: **the defender takes no Reaction, and the
 * attack path must check nonetheless.** So this module is a pair of
 * questions the attack asks of the creature it is aimed at, in the same
 * spirit it asks for an Armour Class — and never a window, an offer or a
 * hold.
 *
 * | | Asked | By |
 * |---|---|---|
 * | {@link wardAgainst} | before anything is spent, before the roll | both attack paths |
 * | {@link answerTheBlow} | the instant a hit is known, before the hold | both attack paths |
 *
 * **Its own module because two callers need it.** `resolveAttack` swings a
 * weapon and `resolveAttackEffect` throws a Fire Bolt, and the SRD sentences
 * here say "an attack roll" without caring which — the same reason
 * `defendingModes` is shared rather than copied. A copy is how the spell
 * attack came to miss Dodge and Blur for as long as it did.
 *
 * ## What must not move
 *
 * The ruling's own fence, and it is the thing to check first in any change
 * here: a passive defence decides **whether the hit that would open a window
 * happened**, and never reorders one. A blow a duplicate took is not a blow
 * that hit you — SRD Shield is cast "when you are hit by an attack roll" —
 * so the caller builds no `attack-landed` for it and nobody is offered
 * anything. "The defender answers first" is untouched, because the defender
 * being attacked at all is what this settles.
 */

import { type Ability, type CharacterId, err, ok, type Result } from '@ie/shared';
import { applyEvent, type GameEvent, type GameState } from '../events.js';
import { PASSIVE_DEFENSE_LEDGER } from '../combat.js';
import { rollSavingThrow } from '../checks.js';
import {
  decoysExcuse,
  type PassiveDefenseState,
  retaliationReaches,
} from '../passive-defenses.js';
import { castingIdOf, spellOfSource } from '../spells.js';
import { distanceBetween } from '../positioning.js';
import { effectiveConditions, sensesPerceiving, sheetAsItStands } from '../standing.js';
import { dealSpellDamage } from './damage.js';
import { type Supply } from './casting.js';
import { rollRecorded } from '../rolls.js';
import { recordD20Test, rollSpellDice, savingSupport } from './rolls.js';

/** Every passive defence standing on a creature, of one shape. */
function defensesOfKind<K extends PassiveDefenseState['kind']>(
  state: GameState,
  who: CharacterId,
  kind: K,
): readonly { readonly source: string; readonly defense: Extract<PassiveDefenseState, { kind: K }> }[] {
  const held = state.creatures[who]?.passiveDefenses ?? [];
  const found: { source: string; defense: Extract<PassiveDefenseState, { kind: K }> }[] = [];
  for (const entry of held) {
    if (entry.defense.kind === kind) {
      found.push({
        source: entry.source,
        defense: entry.defense as Extract<PassiveDefenseState, { kind: K }>,
      });
    }
  }
  return found;
}

/**
 * The ledger slot that records an attacker having settled one ward this turn.
 *
 * **Its own namespace, and not the Multiattack one.** The brief that
 * commissioned this said to write it under `MULTIATTACK_LEDGER`, and that
 * would have been a live bug rather than a stylistic choice:
 * `attacksMadeThisTurn` filters the ledger on that prefix and then splits
 * every key it finds on the last `#` to recover an attack's name. A key with
 * no `#` in it comes back as a nonsense name with a count of one, and a
 * creature that had been warded would find its Multiattack sequence holding a
 * swing it never made. The ledger is one key space and every reader picks its
 * own entries out of it by prefix, so a fourth namespace is what a fourth
 * reader costs.
 *
 * Keyed by the casting rather than by the warded creature: two Sanctuaries on
 * two clerics are two wards, and an attacker turned away by one has not been
 * asked about the other.
 */
const wardSlot = (source: string, outcome: 'barred' | 'cleared'): string =>
  `${PASSIVE_DEFENSE_LEDGER}ward:${castingIdOf(source) ?? source}:${outcome}`;

/** What this attacker has already settled about this ward, on this turn. */
function settledThisTurn(
  state: GameState,
  attacker: CharacterId,
  source: string,
): 'barred' | 'cleared' | null {
  const combat = state.combat;
  if (combat === null) return null;
  const spent = combat.budgets[attacker]?.featureUsedOnTurn ?? {};
  for (const outcome of ['barred', 'cleared'] as const) {
    if (spent[wardSlot(source, outcome)] === combat.turnsTaken) return outcome;
  }
  return null;
}

export interface WardVerdict {
  /** Events to emit, whichever way the save went: the roll, and the ledger slot. */
  readonly events: readonly GameEvent[];
  /** True when the attack is lost and no roll may be made. */
  readonly barred: boolean;
  readonly unverified: readonly string[];
}

/**
 * What the defender's wards say about a swing that has not been thrown yet.
 *
 * SRD Sanctuary: "any creature who targets the warded creature with an attack
 * roll or a damaging spell must succeed on a Wisdom saving throw or either
 * choose a new target or lose the attack or spell."
 *
 * ## Where the two branches went
 *
 * The book gives the **attacker** a choice on a failure and the engine may
 * not choose targets for anybody. Owner's ruling, 2026-09-22: the attack is
 * lost, **nothing is spent**, and both of the book's branches stay reachable
 * — redirecting is a second command against a creature nobody warded, and
 * declining to issue one is losing the attack, which is what losing it looks
 * like at a table.
 *
 * ## Why it cannot simply refuse
 *
 * A refusal carries no events, and by the time the verdict is known a d20 has
 * been thrown: the generator has moved and only an emitted `rolls-issued`
 * records that it did. "Validate first, roll second, emit last" is exactly
 * why a failed save comes back as an `ok` the caller returns rather than an
 * `err` it propagates. A *re-declaration* is refused outright, because that
 * one is settled off the ledger with no die thrown at all.
 *
 * ## One save per attacker per ward per turn
 *
 * The owner's ruling, and a limit the book does not print. Without it a
 * failure costs nothing and can be re-declared until it passes, which is the
 * whole spell undone. Both outcomes are recorded, so an attacker who cleared
 * the ward is through for the turn and one who did not is barred for it.
 */
export function wardAgainst(
  state: GameState,
  attacker: CharacterId,
  target: CharacterId,
  supply: Supply,
): Result<WardVerdict> {
  const wards = defensesOfKind(state, target, 'ward');
  if (wards.length === 0) return ok({ events: [], barred: false, unverified: [] });

  const events: GameEvent[] = [];
  const unverified: string[] = [];
  let current = state;

  for (const ward of wards) {
    const already = settledThisTurn(current, attacker, ward.source);
    if (already === 'cleared') continue;
    if (already === 'barred') {
      return err(
        'warded',
        `${attacker} already failed to get past the ward on ${target} this turn; the book gives one save each time they target, and this engine gives one a turn`,
      );
    }

    const victim = current.creatures[attacker];
    if (victim === undefined) {
      return err('unknown_creature', `${attacker} has no record here yet; add it first`);
    }
    const sheet = sheetAsItStands(current, attacker) ?? victim.sheet;
    const support = savingSupport(current, attacker, victim, ward.defense.ability, {});
    const rolled = rollSavingThrow(supply.issuer, supply.rng, sheet, ward.defense.ability, {
      dc: ward.defense.dc,
      conditions: support.conditions,
      modes: support.modes,
      bonuses: support.bonuses,
    });
    if (!rolled.ok) return rolled;

    const label = `${spellOfSource(ward.source) ?? 'a ward'} (${ward.defense.ability.toUpperCase()} save)`;
    events.push(
      recordD20Test(attacker, label, rolled.value, rolled.value.success ? 'success' : 'failure'),
    );

    // Outside a fight there is no turn to count one against, which is the
    // answer Cleave, Slow, Sap and Vex all give to the same absence. The save
    // still happens and still bars the swing; what is missing is the record
    // that stops a second one, so it is said out loud.
    if (current.combat === null) {
      unverified.push(
        `${attacker} saved against the ward on ${target}, and there are no turns here to hold them to one save — a re-declared swing will be asked again`,
      );
    } else {
      events.push({
        type: 'feature-used',
        id: attacker,
        feature: wardSlot(ward.source, rolled.value.success ? 'cleared' : 'barred'),
        turn: current.combat.turnsTaken,
      });
    }
    current = events.slice(-2).reduce(applyEvent, current);

    // **The first ward that bars the swing ends it**, and no later ward is
    // asked: the attack is already lost, so a second save would be a die
    // thrown against a swing nobody is making. Nothing in the SRD puts two
    // Sanctuaries on one creature, and if a table does, the one that answered
    // is the one that answered.
    if (!rolled.value.success) return ok({ events, barred: true, unverified });
  }

  return ok({ events, barred: false, unverified });
}

export interface BlowAnswer {
  readonly events: readonly GameEvent[];
  /** True when a decoy took the blow, so nothing of it reaches the defender. */
  readonly deflected: boolean;
  readonly unverified: readonly string[];
}

/**
 * What the defender's passive defences do to a blow that has just landed.
 *
 * SRD Mirror Image: "Each time a creature **hits** you with an attack roll
 * during the spell's duration, roll a d6 for each of your remaining
 * duplicates. If any of the d6s rolls a 3 or higher, one of the duplicates is
 * hit instead of you, and the duplicate is destroyed."
 *
 * SRD Fire Shield: "whenever a creature within 5 feet of you **hits** you with
 * a melee attack roll, the shield erupts with flame."
 *
 * ## The order, which is a rule rather than an accident
 *
 * **Decoys answer first.** Where both stand, a blow a duplicate took never
 * reached the caster at all, so nothing wreathing the caster has been hit and
 * the flames do not erupt. The other order would burn an attacker for hitting
 * an illusion.
 *
 * ## The flames are a casting's damage, so they open nothing
 *
 * `landDamage` is the weapon path's funnel and holds a blow open where
 * somebody may answer it; `dealSpellDamage` is what a casting's damage goes
 * through, and the note on `landDamage` says why — "a spell rolls its damage
 * once for every target it caught, so holding one target's share open would
 * mean holding the whole casting open per target". A shield's eruption is a
 * casting's damage. That is not a convenience: a window opened here would put
 * a `pendingDamage` in front of the attack's own damage roll, and the attack
 * would then refuse to settle itself.
 */
export function answerTheBlow(
  state: GameState,
  attacker: CharacterId,
  target: CharacterId,
  supply: Supply,
  blow: { readonly melee: boolean },
): Result<BlowAnswer> {
  const events: GameEvent[] = [];
  const unverified: string[] = [];
  let current = state;

  for (const decoys of defensesOfKind(current, target, 'decoys')) {
    if (decoys.defense.remaining < 1) continue;
    // **Read off the attacker, and read as facts.** `sensesPerceiving` is the
    // attacker's own senses filtered to those whose printed range reaches —
    // never `canSee`, because ordinary sight is exactly what a hall of
    // duplicates defeats and a declared sight line must excuse nobody.
    // `effectiveConditions` rather than the raw set, because a condition a
    // feature has suppressed gives its holder nothing.
    if (
      decoysExcuse(decoys.defense, {
        perceivesWith: sensesPerceiving(current, attacker, target),
        conditions: effectiveConditions(current, attacker).conditions,
      })
    ) {
      continue;
    }

    // One die per duplicate still standing, thrown as one roll and read one
    // die at a time: "If **any** of the d6s rolls a 3 or higher". The notation
    // is the definition's own die repeated, so a spell that threw d8s would
    // throw d8s.
    // **Not a damage roll and not a D20 Test**, which is why it goes through
    // `rollRecorded` rather than either of the two rollers a spell usually
    // reaches for: a handful of d6s read individually is neither. The notation
    // is the definition's own die repeated once per duplicate still standing,
    // so a homebrew that threw d8s would throw d8s.
    const faces = decoys.defense.die.replace(/^\d+/, '');
    const rolled = rollRecorded(
      supply.issuer,
      supply.rng,
      `${decoys.defense.remaining}${faces}`,
    );
    if (!rolled.ok) return rolled;

    // "If **any** of the d6s rolls a 3 or higher" — any, not all, so the dice
    // are read one at a time and the best of them decides.
    const best = rolled.value.dice.reduce((high, die) => Math.max(high, die.value), 0);
    events.push({
      type: 'roll-recorded',
      who: target,
      label: `${spellOfSource(decoys.source) ?? 'a duplicate'} (${decoys.defense.remaining}${faces})`,
      natural: best,
      total: best,
      contributions: [{ source: 'the duplicates', amount: 0 }],
      outcome: best >= decoys.defense.deflectsOn ? 'deflected' : 'no deflection',
    });

    if (best < decoys.defense.deflectsOn) {
      current = events.slice(-1).reduce(applyEvent, current);
      continue;
    }

    events.push({ type: 'decoy-destroyed', id: target, source: decoys.source });
    current = events.slice(-2).reduce(applyEvent, current);

    // "The spell ends when all three duplicates are destroyed." Emitted by the
    // command rather than derived in the fold, because a casting ending is a
    // thing the log says happened — and only where the definition printed the
    // sentence, so a homebrew hall of mirrors that outlives its duplicates is
    // allowed to.
    const left = current.creatures[target]?.passiveDefenses.find(
      (held) => held.source === decoys.source,
    );
    const castingId = castingIdOf(decoys.source);
    if (
      decoys.defense.endsWhenSpent === true &&
      castingId !== null &&
      left !== undefined &&
      left.defense.kind === 'decoys' &&
      left.defense.remaining < 1
    ) {
      events.push({ type: 'spell-ended', castingId, on: null, reason: 'spent' });
      current = events.slice(-1).reduce(applyEvent, current);
    }

    return ok({ events, deflected: true, unverified });
  }

  for (const shield of defensesOfKind(current, target, 'retaliation')) {
    // Null where nobody has placed them, which is a real answer here rather
    // than a failure — the reading the whole attack path takes of an unplaced
    // creature, reported below rather than guessed either way.
    const measured =
      current.scene === null ? null : distanceBetween(current.scene, target, attacker);
    const apart = measured !== null && measured.ok ? measured.value : null;
    const reaches = retaliationReaches(shield.defense, { melee: blow.melee, apart });
    if (reaches === 'unknown') {
      unverified.push(
        `nobody has said where ${target} and ${attacker} are standing, so the ${shield.defense.withinFeet}-foot fence on ${spellOfSource(shield.source) ?? 'a passive defence'} went unapplied rather than checked — the flames did not erupt`,
      );
      continue;
    }
    if (reaches === 'no') continue;

    const name = spellOfSource(shield.source) ?? 'a passive defence';
    const burn = rollSpellDice(
      supply,
      sheetAsItStands(current, target) ?? current.creatures[target]!.sheet,
      name,
      shield.defense.damageType,
      shield.defense.damage,
    );
    if (!burn.ok) return burn;

    // Through the casting's own funnel: no window, and the attacker's
    // Concentration is put at risk by it exactly as any other spell damage
    // would be.
    const burned = dealSpellDamage(current, attacker, burn.value, name, supply, { by: target });
    if (!burned.ok) return burned;
    events.push(...burned.value.events);
    current = burned.value.events.reduce(applyEvent, current);
  }

  return ok({ events, deflected: false, unverified });
}

/** The abilities a ward may ask for, re-exported so a caller need not reach past this. */
export type WardAbility = Ability;

/** Whether anything at all is standing on this creature that an attack must consult. */
export function hasPassiveDefense(state: GameState, who: CharacterId): boolean {
  return (state.creatures[who]?.passiveDefenses ?? []).length > 0;
}
