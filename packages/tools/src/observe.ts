/**
 * Everything authoritative a caller could reasonably need, in one object.
 *
 * Not a second source of truth: every field is read off `GameState` through
 * an engine reader, and nothing here computes a rule. The two that matter are
 * read through the engine's *effective* readers rather than the record —
 * {@link armorClassOf} folds in a Shield of Faith, {@link movementLeftFor}
 * folds in a Dash and a feature grant — because a caller shown the base
 * number would be narrating against a number the engine never attacks with.
 *
 * `owed` is the half a caller forgets exists. Every engine debt refuses most
 * commands while it stands, so a surface that does not report them leaves the
 * caller discovering them one refusal at a time, and — for a held move with
 * two Opportunity Attacks outstanding — with no way to learn *who* owes what.
 *
 * `printed` is the other half a caller forgets exists, and it was missing for
 * longer. `attack.action` demands an attack the creature's own block prints,
 * *by its printed name*, and `unknown_action` is what anything else meets — so
 * until a Wolf's `Bite` was reported somewhere, a human DM had to know the
 * block out of band and a model, which holds no book, could not be told one at
 * all. See {@link ObservedBlock}.
 */

import type { CharacterId } from '@ie/shared';
import { asCharacterId } from '@ie/shared';
import type { CharacterSheet, GameState, StatedAttack } from '@ie/engine';
import {
  armorClassOf,
  carrying,
  describeRecharge,
  distanceBetween,
  movementLeftFor,
  positionOf,
  remaining,
  speedOf,
  spellSlotKey,
  strandedSummons,
} from '@ie/engine';

const SLOT_LEVELS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

export interface ObservedBudget {
  readonly action: boolean;
  readonly bonusAction: boolean;
  readonly reaction: boolean;
  readonly movementFeet: number;
  readonly spentASlotThisTurn: boolean;
}

/**
 * One attack this creature's stat block prints, under the heading it prints it.
 *
 * `name` is the whole point: it is the string `attack.action` takes, so a
 * caller can round-trip what it read into a swing. The rest is what the block
 * says *about* that swing and nothing derived from it.
 *
 * **The two numbers a swing is made of are deliberately absent.** The attack
 * bonus and the damage are the engine's to roll and its outcome's to report;
 * a caller told `+5` and `2d6 + 3` before the die is thrown is a caller one
 * step from narrating a number nobody rolled. `reach` and `range` are here
 * because they answer a different question — whether this line can be used
 * from where the creature is standing — and the engine already reports a
 * printed Armour Class and Speed for the same reason.
 */
export interface ObservedPrintedAttack {
  readonly name: string;
  readonly kind: StatedAttack['kind'];
  /** Feet of reach, for the melee half. Null for a purely ranged attack. */
  readonly reach: number | null;
  /** Normal and long range in feet. Null for a purely melee attack. */
  readonly range: StatedAttack['range'];
  /** A condition the book puts on the roll, evaluated by nobody. */
  readonly qualification: string | null;
  /** Everything the line says after the damage, which a hit hands back. */
  readonly rider: string | null;
  /** What brings the line back, in the words a refusal quotes. Null where it never went. */
  readonly recharge: string | null;
  /** Whether this line has been used and not yet got back. */
  readonly expended: boolean;
}

/**
 * One line printed under **Actions** or **Bonus Actions** that is not an
 * attack, as printed.
 *
 * The heading and the book's sentence, because the engine applies no part of
 * one: a line reported without its text is a creature doing something nobody
 * could act on, which is the same argument the spend makes when it hands the
 * sentence back.
 */
export interface ObservedPrintedLine {
  readonly name: string;
  readonly text: string;
  /** See {@link ObservedPrintedAttack.recharge}. */
  readonly recharge: string | null;
  readonly expended: boolean;
}

/**
 * One clause of a Multiattack: a count, and the printed names it attaches to.
 *
 * `attacks` is a list because the book writes menus — "two attacks, using
 * Scimitar and Pistol in any combination" is several printed lines sharing one
 * count — and a list of one in the ordinary case, where the book names a
 * single line.
 */
export interface ObservedMultiattackClause {
  readonly count: number;
  readonly attacks: readonly string[];
}

/** One sequence a Multiattack offers, and what must have happened for it. */
export interface ObservedMultiattackSequence {
  readonly clauses: readonly ObservedMultiattackClause[];
  /**
   * The printed Bonus Action line this sequence is gated on, or null.
   *
   * The Clay Golem's "three Slam attacks **if it used Hasten this turn**" is
   * the only one the SRD prints, and the name is a heading the same block
   * prints — so a caller told it can find the line it must take first.
   */
  readonly requires: string | null;
}

/**
 * What this creature's stat block prints, read off the sheet the arrival
 * pinned.
 *
 * Null for every creature whose sheet states no block, which is every
 * character: a caller is told what a creature *has*, and nothing is invented
 * for one that has nothing. Nothing here opens a catalogue — a block nobody
 * added is a block nobody can read.
 *
 * **The Multiattack is a named sequence rather than a count**, which is the
 * difference between "a Ghoul makes two attacks" and what the book prints: a
 * Ghoul makes two *Bite* attacks, and it prints a Claw as well. A creature
 * allowed two of anything is a creature the book did not print.
 *
 * Out of it: a block's **Traits** and its **Legendary Actions**, and the two
 * are out for different reasons. `adaptMonster` carries no Legendary Action
 * onto the sheet at all, so there is nothing on this side to report. It does
 * carry `stated.traits` — but that is the handful of *parsed mechanics* a
 * trait was recognised as, which `hasPrintedTrait` asks about by kind and
 * which names no sentence a caller could act on; the English stays in the
 * catalogue, where a DM reads it. A list of kinds is not what "what can this
 * creature do" is asking, and reporting one would be half an answer wearing
 * the whole one's name.
 */
export interface ObservedBlock {
  readonly attacks: readonly ObservedPrintedAttack[];
  /** Printed Actions lines that are not attacks — a breath weapon, a gaze. */
  readonly actions: readonly ObservedPrintedLine[];
  readonly bonusActions: readonly ObservedPrintedLine[];
  /** Null where the block prints no Multiattack this engine can execute. */
  readonly multiattack: {
    readonly sequences: readonly ObservedMultiattackSequence[];
    /** The line the sentence trails that the engine executes no part of. */
    readonly handOver: string | null;
  } | null;
  /**
   * Every line this creature has used and not got back, by its printed name.
   *
   * The creature's own record, reported beside the per-line `expended` flags
   * it explains: a caller that reads one line at a time cannot see at a glance
   * what a fight has already cost this creature.
   */
  readonly expendedLines: readonly string[];
}

export interface ObservedCreature {
  readonly id: string;
  readonly name: string;
  readonly side: string | null;
  readonly hp: number;
  readonly hpMax: number;
  readonly temporaryHp: number;
  readonly dead: boolean;
  /**
   * At 0 hit points and no longer dying — SRD's Stable.
   *
   * Beside `dead` because it is the other end of the same sentence, and
   * reported at all because `stabilise_creature` is what changes it: a caller
   * that cannot see whether somebody on the floor is still bleeding cannot
   * tell whether the kneeling was worth anything, and every other creature at
   * 0 hit points looks exactly the same from here.
   */
  readonly stable: boolean;
  readonly armorClass: number;
  readonly speed: number;
  readonly creatureType: string | null;
  readonly conditions: readonly string[];
  readonly carrying: readonly string[];
  /** What this creature's stat block prints, or null where it states none. */
  readonly printed: ObservedBlock | null;
  readonly concentratingOn: string | null;
  readonly placed: boolean | null;
  /** Feet to every other creature, or null where nobody has said. */
  readonly feetTo: Readonly<Record<string, number | null>>;
  readonly spellSlots: Readonly<Record<string, number>>;
  readonly budget: ObservedBudget | null;
}

export interface ObservedDebts {
  readonly pendingSaves: number;
  readonly pendingAttack: string | null;
  readonly pendingDamage: string | null;
  readonly pendingTest: string | null;
  readonly pendingCastings: readonly string[];
  readonly pendingMove: {
    readonly mover: string;
    readonly mustAnswerOpportunityAttack: readonly string[];
  } | null;
  readonly owedAreaEffects: number;
  /**
   * Who is still standing on a casting that has ended.
   *
   * **Named rather than counted**, which is the one debt here that has to be:
   * the others are settled by a call that takes no argument and this one is
   * too, but a caller narrating the room has to know *which* creature is
   * about to vanish — and the refusal it would otherwise meet
   * (`summons_stranded`, from every attempt to end a turn) is the engine's
   * way of saying the same thing one wasted call later.
   *
   * Derived rather than filed, as the engine derives it: a question about the
   * world as it stands rather than a record of a moment that has passed.
   * `dismiss_stranded_summons` is the door that empties it.
   */
  readonly strandedSummons: readonly string[];
  readonly turnStartUnsettled: string | null;
}

export interface Observation {
  readonly round: number | null;
  readonly turnOf: string | null;
  readonly initiativeOrder: readonly string[] | null;
  readonly elapsedSeconds: number;
  readonly scene: {
    readonly extent: { readonly width: number; readonly depth: number; readonly height: number };
    readonly landmarks: readonly string[];
  } | null;
  readonly creatures: readonly ObservedCreature[];
  readonly owed: ObservedDebts;
}

type Stated = NonNullable<CharacterSheet['stated']>;
type PrintedMultiattack = NonNullable<Stated['multiattack']>;
type PrintedBranch = NonNullable<PrintedMultiattack['alternatives']>[number];
type PrintedClause = NonNullable<PrintedMultiattack['entries']>[number];

/**
 * A branch's clauses and its gate.
 *
 * The engine reads the same union through `entriesOfBranch` / `gateOfBranch`
 * in `@ie/srd/schemas`, which this package does not depend on and the engine
 * does not re-export — so the discrimination is written once more here, over
 * `requires` rather than over `Array.isArray`, because `entries` is a method
 * every array has and `in` would find it.
 */
const clausesOfBranch = (branch: PrintedBranch): readonly PrintedClause[] =>
  'requires' in branch ? branch.entries : branch;

const gateOf = (branch: PrintedBranch): string | null =>
  'requires' in branch ? branch.requires.usedBonusAction : null;

const clauses = (entries: readonly PrintedClause[]): readonly ObservedMultiattackClause[] =>
  entries.map((entry) => ({
    count: entry.count,
    // One name or a menu of them; the schema guarantees exactly one of the two.
    attacks: entry.attacks ?? (entry.attack === undefined ? [] : [entry.attack]),
  }));

const sequencesOf = (multiattack: PrintedMultiattack): readonly ObservedMultiattackSequence[] =>
  multiattack.entries === undefined
    ? (multiattack.alternatives ?? []).map((branch) => ({
        clauses: clauses(clausesOfBranch(branch)),
        requires: gateOf(branch),
      }))
    : [{ clauses: clauses(multiattack.entries), requires: null }];

/** What the block printed about coming back, in the words a refusal quotes. */
const rechargeSaid = (recharge: StatedAttack['recharge']): string | null =>
  recharge === undefined ? null : describeRecharge(recharge);

/**
 * The block, or null for a creature whose sheet states none.
 *
 * Every field is read off the sheet the arrival pinned and the creature's own
 * `expendedLines`. Nothing is computed and no catalogue is opened, so what a
 * caller reads here cannot disagree with what the engine will accept.
 */
function printedBlock(
  sheet: CharacterSheet,
  expendedLines: readonly string[],
): ObservedBlock | null {
  const stated = sheet.stated;
  if (stated === undefined) return null;

  const line = (one: {
    readonly name: string;
    readonly text: string;
    readonly recharge?: StatedAttack['recharge'];
  }): ObservedPrintedLine => ({
    name: one.name,
    text: one.text,
    recharge: rechargeSaid(one.recharge),
    expended: expendedLines.includes(one.name),
  });

  return {
    attacks: (stated.attacks ?? []).map((attack) => ({
      name: attack.name,
      kind: attack.kind,
      reach: attack.reach,
      range: attack.range,
      qualification: attack.qualification,
      rider: attack.rider,
      recharge: rechargeSaid(attack.recharge),
      expended: expendedLines.includes(attack.name),
    })),
    actions: (stated.unreadActions ?? []).map(line),
    bonusActions: (stated.bonusActions ?? []).map(line),
    multiattack:
      stated.multiattack === undefined
        ? null
        : {
            sequences: sequencesOf(stated.multiattack),
            handOver: stated.multiattack.handOver ?? null,
          },
    expendedLines,
  };
}

const feet = (state: GameState, a: CharacterId, b: CharacterId): number | null => {
  if (state.scene === null) return null;
  const apart = distanceBetween(state.scene, a, b);
  return apart.ok ? apart.value : null;
};

export function observe(state: GameState): Observation {
  const ids = Object.keys(state.creatures).sort();
  const combat = state.combat;

  const creatures = ids.map((key): ObservedCreature => {
    const c = state.creatures[key]!;
    const budget = combat?.budgets[key];
    const slots: Record<string, number> = {};
    for (const level of SLOT_LEVELS) {
      const left = remaining(c.resources, spellSlotKey(level));
      if (left > 0) slots[String(level)] = left;
    }
    return {
      id: c.id,
      name: c.name,
      side: c.side ?? null,
      hp: c.vitals.hp,
      hpMax: c.vitals.hpMax,
      temporaryHp: c.vitals.temporaryHp,
      dead: c.vitals.dead,
      stable: c.vitals.stable,
      armorClass: armorClassOf(state, c.id),
      speed: speedOf(state, c.id),
      creatureType: c.creatureType ?? null,
      conditions: c.conditions.conditions,
      carrying: carrying(state, c.id).map((line) => line.id),
      printed: printedBlock(c.sheet, c.expendedLines),
      concentratingOn: c.concentration?.spell ?? null,
      placed: state.scene === null ? null : positionOf(state.scene, c.id) !== null,
      feetTo: Object.fromEntries(
        ids.filter((other) => other !== key).map((other) => [other, feet(state, c.id, asCharacterId(other))]),
      ),
      spellSlots: slots,
      budget:
        budget === undefined
          ? null
          : {
              action: budget.action,
              bonusAction: budget.bonusAction,
              reaction: budget.reaction,
              movementFeet: movementLeftFor(state, c.id) ?? 0,
              spentASlotThisTurn: budget.spellSlotSpentOnTurn !== null,
            },
    };
  });

  return {
    round: combat?.round ?? null,
    turnOf: combat?.order[combat.turnIndex]?.id ?? null,
    initiativeOrder: combat?.order.map((entry) => entry.id) ?? null,
    elapsedSeconds: state.elapsed,
    scene:
      state.scene === null
        ? null
        : { extent: state.scene.extent, landmarks: Object.keys(state.scene.landmarks).sort() },
    creatures,
    owed: {
      pendingSaves: state.pendingSaves === undefined ? 0 : Object.keys(state.pendingSaves).length,
      pendingAttack: state.pendingAttack?.attacker ?? null,
      pendingDamage: state.pendingDamage?.target ?? null,
      pendingTest: state.pendingTest?.who ?? null,
      pendingCastings: Object.keys(state.pendingCastings),
      pendingMove:
        state.pendingMove === null
          ? null
          : {
              mover: state.pendingMove.mover,
              mustAnswerOpportunityAttack: state.pendingMove.provoked.map((p) => p.reactor),
            },
      owedAreaEffects: state.owedAreaEffects.length,
      strandedSummons: strandedSummons(state).map(String),
      turnStartUnsettled: state.pendingTurnStart?.who ?? null,
    },
  };
}
