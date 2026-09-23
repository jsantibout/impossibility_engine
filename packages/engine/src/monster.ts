import {
  ABILITY_NAMES,
  CONDITIONS,
  DAMAGE_TYPES,
  SKILLS,
  type Ability,
  type CharacterId,
  type ConditionName,
  type DamageType,
  type Skill,
} from '@ie/shared';
import type {
  CreatureSize,
  Monster,
  MonsterMultiattack,
  MonsterMultiattackBranch,
  MonsterMultiattackEntry,
  MonsterMultiattackGate,
  MonsterRecharge,
  MonsterTrait,
} from '@ie/srd';
// The two readers of the branch shape, from the subpath that is schemas and no
// data: a value imported from the barrel loads the whole parsed SRD into every
// process that imports the engine, which `srd-barrel.test.ts` is the guard for.
import { CREATURE_SIZES, entriesOfBranch, gateOfBranch } from '@ie/srd/schemas';
import { STATED_BONUS_ACTION_LEDGER } from './combat.js';
import type { TurnAnchor } from './time.js';
import type { HitRiderAnchor, StandingEffect, StandingRequirement } from './standing.js';
import type { RollFamily } from './roll-modifiers.js';
import type { DamageDefenses } from './attack.js';
import type {
  CharacterSheet,
  OtherSpeeds,
  StatedAction,
  StatedAttack,
  StatedBonusAction,
  StatedValues,
} from './character.js';
import { vitals, type Vitals } from './vitals.js';

/**
 * Turning a parsed stat block into something the engine can fight.
 *
 * The two halves of the model express the same quantities differently: a
 * character's Armour Class follows from their armour and Dexterity, while a
 * monster's is simply printed, and a stat block routinely carries saves and
 * skills that no derivation would produce. So a monster's numbers are carried
 * across as *stated* rather than being reverse-engineered into proficiencies
 * that happen to add up.
 */

export interface MonsterDefenses {
  /** Per damage type, for `applyDamage`. Unconditional entries only. */
  readonly byDamageType: Readonly<Record<string, DamageDefenses>>;
  /** Conditions the creature cannot be given at all. Unconditional only. */
  readonly conditionImmunities: readonly ConditionName[];
  /**
   * Defences the stat block qualifies, which the engine will not apply on its
   * own. "Charmed (except from its vampire master)" is a real restriction that
   * no boolean captures, and treating it as unconditional immunity is simply
   * wrong — it makes the vampire's own hold on its spawn impossible.
   */
  readonly qualified: readonly QualifiedDefense[];
}

export interface QualifiedDefense {
  readonly kind: 'immunity' | 'resistance' | 'vulnerability';
  /** Whichever of the two this entry names. */
  readonly condition: ConditionName | null;
  readonly damageType: string | null;
  /** The qualification itself: "except from its vampire master". */
  readonly qualification: string;
  /** The entry exactly as printed, for narration. */
  readonly printed: string;
}

/**
 * Whether a condition can be applied, and if not, why not.
 *
 * Three outcomes rather than a boolean, because they mean different things to
 * the layer above: proceed, refuse outright, or ask the DM. Collapsing the
 * third into either of the others is how a qualified immunity turns into an
 * unconditional one.
 */
export type ConditionApplicability =
  | { readonly kind: 'allowed' }
  | { readonly kind: 'immune'; readonly reason: string }
  | {
      readonly kind: 'needs-adjudication';
      readonly qualification: string;
      readonly printed: string;
    };

export interface AdaptedMonster {
  readonly id: CharacterId;
  readonly name: string;
  readonly sheet: CharacterSheet;
  readonly vitals: Vitals;
  readonly defenses: MonsterDefenses;
  /**
   * What the stat block says this creature **is** — `Fey`, `Giant`, `Undead`.
   *
   * Carried because a rule reads it: Hold Person says "Choose a Humanoid", and
   * a Goblin Warrior is `Small Fey (Goblinoid)` in 2024. The parser has held
   * this since the bestiary was first ingested and this adapter dropped it, so
   * a creature built from an SRD stat block reached `creature-added` with no
   * type at all — and the engine then had to *ask* whoever was driving it for
   * a fact it had already parsed and thrown away.
   *
   * That is the failure this field exists to make impossible. An authoritative
   * fact the Engine holds must reach the creature record; a caller may be
   * asked for what nobody knows, never for what the SRD prints.
   */
  readonly creatureType: string;
  /** The parenthesised tag — `Goblinoid`. Narrative; no rule reads it yet. */
  readonly subtype: string | null;
  readonly size: CreatureSize;
  readonly speed: Monster['speed'];
  /** The stat block's Initiative modifier, for rolling or for a passive score. */
  readonly initiativeModifier: number;
  readonly cr: number;
  readonly xp: number;
  /**
   * Entries that carried a caveat the engine cannot enforce, kept verbatim so
   * narration and the DM still have them — "Charmed (except from its vampire
   * master)" is a real restriction that no boolean captures.
   */
  readonly caveats: readonly string[];
}

const DAMAGE_SET = new Set<string>(DAMAGE_TYPES);
const CONDITION_SET = new Set<string>(CONDITIONS);
const SKILL_SET = new Set<string>(SKILLS);

interface Classified {
  readonly damage: DamageType[];
  readonly conditions: ConditionName[];
  readonly qualified: Omit<QualifiedDefense, 'kind'>[];
  readonly caveats: string[];
}

/**
 * Split a defence list into damage types and conditions.
 *
 * The stat block prints them in one run — a Zombie's immunities are "Poison,
 * Exhaustion, Poisoned", which is one damage type and two conditions — and the
 * engine treats the two completely differently. Anything parenthesised is a
 * restriction the engine cannot express, so the entry still counts but the
 * caveat is kept for narration rather than dropped.
 */
function classify(entries: readonly string[]): Classified {
  const damage: DamageType[] = [];
  const conditions: ConditionName[] = [];
  const qualified: Omit<QualifiedDefense, 'kind'>[] = [];
  const caveats: string[] = [];

  for (const entry of entries) {
    const printed = entry.trim();
    const qualifier = /\(([^)]*)\)/.exec(printed);

    const bare = printed
      .replace(/\([^)]*\)/g, '')
      .replace(/[_*]/g, '')
      .trim()
      .toLowerCase();

    const asDamage = DAMAGE_SET.has(bare) ? (bare as DamageType) : null;
    const asCondition = CONDITION_SET.has(bare) ? (bare as ConditionName) : null;

    // A qualified entry is recognised but *not* applied: the qualification is
    // a rule the engine cannot evaluate, so it goes to whoever can.
    if (qualifier !== null && (asDamage !== null || asCondition !== null)) {
      qualified.push({
        condition: asCondition,
        damageType: asDamage,
        qualification: qualifier[1]!.replace(/[_*]/g, '').trim(),
        printed,
      });
      continue;
    }

    if (asDamage !== null) damage.push(asDamage);
    else if (asCondition !== null) conditions.push(asCondition);
    else if (bare !== '') caveats.push(printed);
  }

  return { damage, conditions, qualified, caveats };
}

function buildDefenses(monster: Monster): { defenses: MonsterDefenses; caveats: string[] } {
  const immune = classify(monster.immunities);
  const resistant = classify(monster.resistances);
  const vulnerable = classify(monster.vulnerabilities);

  const byDamageType: Record<string, DamageDefenses> = {};
  const set = (type: string, patch: Partial<DamageDefenses>): void => {
    byDamageType[type] = { ...byDamageType[type], ...patch };
  };

  for (const type of immune.damage) set(type, { immune: true });
  for (const type of resistant.damage) set(type, { resistant: true });
  for (const type of vulnerable.damage) set(type, { vulnerable: true });

  const qualified: QualifiedDefense[] = [
    ...immune.qualified.map((q) => ({ ...q, kind: 'immunity' as const })),
    ...resistant.qualified.map((q) => ({ ...q, kind: 'resistance' as const })),
    ...vulnerable.qualified.map((q) => ({ ...q, kind: 'vulnerability' as const })),
  ];

  return {
    defenses: { byDamageType, conditionImmunities: immune.conditions, qualified },
    caveats: [...immune.caveats, ...resistant.caveats, ...vulnerable.caveats],
  };
}

const ABILITIES_IN_ORDER: readonly Ability[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

/**
 * The attacks the block's **Actions** section prints, and only that section.
 *
 * A heading in a stat block says what the thing under it costs. A Bonus Action
 * attack carried across as an Attack action's would let a creature swing twice
 * for one action, and a Reaction's would let it swing on somebody else's turn
 * for free — both are wrong in the direction that matters, and neither is
 * visible once the line has been flattened into a list. So one section is
 * carried, the one whose cost the attack path already spends, and the rest are
 * reported as prose a DM still applies.
 *
 * Legendary actions are outside this for the same reason and one more: they
 * have an economy of their own that the engine does not yet hold.
 */
function printedAttacks(monster: Monster): readonly StatedAttack[] {
  return monster.actions.flatMap((line) =>
    line.attack === undefined
      ? []
      : [
          {
            name: line.name,
            ...line.attack,
            // The recharge is the **line's**, because that is where the book
            // prints it; it is copied onto the attack so that the two readers
            // that hold an attack — the default Opportunity Attack and the
            // swing that spends one — ask the object they already have.
            ...(line.recharge === undefined ? {} : { recharge: line.recharge }),
            // And the other notation, carried the same way. No SRD attack line
            // prints it; a homebrew block reaching the same door can, and a
            // limit dropped here is a limit that silently becomes none.
            ...(line.perDay === undefined ? {} : { perDay: line.perDay }),
          },
        ],
  );
}

/** The trait shapes the parser read, in printed order. */
const printedTraits = (monster: Monster): readonly MonsterTrait[] =>
  monster.traits.flatMap((line) => (line.trait === undefined ? [] : [line.trait]));

/**
 * The sequence the block's Multiattack states, **bound to the lines it names**.
 *
 * The parser reads one sentence and knows nothing about the block around it,
 * so a name it read is a name and not yet an attack. Here the two meet: every
 * entry has to name an attack this creature can actually make, and a sequence
 * with one loose end is dropped whole rather than carried with a hole in it —
 * a creature owed three attacks of which one can never be rolled is worse off
 * than one whose Multiattack stayed prose.
 *
 * The bound name is the **printed** one, so what the sheet states and what a
 * caller names an attack by are the same string.
 */
function printedMultiattack(
  monster: Monster,
  attacks: readonly StatedAttack[],
): MonsterMultiattack | undefined {
  // An Action, and one that is not itself an attack: a line that states both a
  // sequence and a swing of its own is two mechanisms under one heading, and
  // the engine has no reading of it that is not a guess. The rule is
  // mechanical rather than a heading nobody here may name — content that
  // arrived from somewhere other than the SRD parser meets the same one.
  const line = monster.actions.find(
    (action) => action.multiattack !== undefined && action.attack === undefined,
  );
  const stated = line?.multiattack;
  if (stated === undefined) return undefined;

  const bind = (name: string): string | undefined =>
    attacks.find((attack) => attack.name.toLowerCase() === name.toLowerCase())?.name;

  // The gate's name is bound the same way an attack's is, against the lines the
  // block prints under Bonus Actions — so a sequence reaching the sheet never
  // names a line the creature has no way to take, and a gate that binds to
  // nothing takes its whole sequence with it exactly as a loose attack name
  // does. What comes back is the **printed** heading, which is what a caller
  // spends and what the ledger records.
  const bindLine = (name: string): string | undefined =>
    monster.bonusActions.find((line) => line.name.toLowerCase() === name.toLowerCase())?.name;

  const branches: MonsterMultiattackBranch[] = [];
  for (const branch of branchesOf(stated)) {
    const bound: MonsterMultiattackEntry[] = [];
    for (const entry of branch.entries) {
      // A menu is a list of names and a single name is a list of one, so both
      // are bound the same way and the shape the block printed is kept.
      const names = entry.attacks ?? [entry.attack!];
      const printed = names.map(bind);
      if (printed.some((name) => name === undefined)) return undefined;
      bound.push(
        entry.attacks === undefined
          ? { count: entry.count, attack: printed[0]! }
          : { count: entry.count, attacks: printed as string[] },
      );
    }

    if (branch.requires === null) {
      branches.push(bound);
      continue;
    }
    const line = bindLine(branch.requires.usedBonusAction);
    if (line === undefined) return undefined;
    branches.push({ entries: bound, requires: { usedBonusAction: line } });
  }

  return {
    ...(stated.alternatives === undefined
      ? { entries: [...entriesOfBranch(branches[0]!)] }
      : { alternatives: branches }),
    // Carried across whole. It is text rather than a mechanism, and what reads
    // it reports it to whoever is driving rather than spending anything.
    ...(stated.handOver === undefined ? {} : { handOver: stated.handOver }),
  };
}

/**
 * The branches a stated Multiattack offers, always as a list of them, each with
 * whatever it requires.
 *
 * One member for the ordinary block and two where the sentence prints a choice.
 * Every reader below works in these terms, so a one-sequence block is the
 * degenerate case of the general one rather than a branch of its own — and a
 * branch that requires nothing is the degenerate case of a gated one, which is
 * what keeps the gate out of every reader that does not care about it.
 */
const branchesOf = (
  sequence: MonsterMultiattack,
): readonly {
  readonly entries: readonly MonsterMultiattackEntry[];
  readonly requires: MonsterMultiattackGate | null;
}[] =>
  sequence.alternatives === undefined
    ? [{ entries: sequence.entries!, requires: null }]
    : sequence.alternatives.map((branch) => ({
        entries: entriesOfBranch(branch),
        requires: gateOfBranch(branch),
      }));

/**
 * The branches this creature is offered **right now**.
 *
 * A gate asks one question — did this creature take the line the gate names, on
 * the turn in progress — and the answer is the ledger's. Outside a turn, or on
 * one where nothing was taken, the list is empty and only the ungated branches
 * are offered, which is the reading that keeps a gated branch from being a
 * branch at all until it is bought.
 */
const offeredBranches = (
  sequence: MonsterMultiattack,
  linesUsed: readonly string[],
): readonly { readonly entries: readonly MonsterMultiattackEntry[] }[] =>
  branchesOf(sequence).filter(
    (branch) =>
      branch.requires === null ||
      linesUsed.some(
        (line) => line.toLowerCase() === branch.requires!.usedBonusAction.toLowerCase(),
      ),
  );

/** The printed names one entry admits — one, or the menu's several. */
const namesOf = (entry: MonsterMultiattackEntry): readonly string[] =>
  entry.attacks ?? [entry.attack!];

/**
 * How many swings a stated sequence adds up to, for a creature that has taken
 * the lines named.
 *
 * The largest branch it is **offered**, where the block prints a choice. Every
 * ungated alternation the SRD prints totals the same either way, and the
 * largest is the honest reading of one that did not: the action's size is a
 * ceiling, and which swings are legal inside it is settled by the composition
 * rather than by this number.
 *
 * **A gated branch is not in the maximum until the gate is open**, and that is
 * the whole of what stops the Clay Golem making three Slams on a turn it did
 * nothing to earn them. The default is no lines taken, which is what the
 * adapter pins onto the sheet: the number a creature has before it has done
 * anything.
 */
const sequenceTotal = (
  sequence: MonsterMultiattack,
  linesUsed: readonly string[] = [],
): number =>
  Math.max(
    ...offeredBranches(sequence, linesUsed).map((branch) =>
      branch.entries.reduce((sum, entry) => sum + entry.count, 0),
    ),
  );

/** The sequence this creature's block states, or null where it states none. */
export const multiattackOf = (sheet: CharacterSheet): MonsterMultiattack | null =>
  sheet.stated?.multiattack ?? null;

/**
 * The Actions lines this creature's block prints that the parser read nothing
 * out of, **by name**. Empty for a character and for a block read whole.
 *
 * Names, because this is the reader the *report* uses: a swing that could not
 * size the Attack action quotes what went unread and claims no more than that.
 * What each line says is on the record beside the name and is the spend's
 * business — {@link statedActionOf} is that door.
 */
export const unreadActionsOf = (sheet: CharacterSheet): readonly string[] =>
  (sheet.stated?.unreadActions ?? []).map((line) => line.name);

/**
 * How many swings this creature's Attack action holds, right now.
 *
 * Three answers in one function, so the command that spends the action and the
 * fold that re-spends it cannot come to disagree:
 *
 * - A block that states a sequence states the count with it, and
 *   `attacksPerAction` already carries that total. A class feature's Extra
 *   Attack is the same field, read the same way.
 * - A **declared head count** is the answer where the block states no sequence
 *   the engine can execute. SRD Hydra: "The hydra makes as many Bite attacks
 *   as it has heads" — the engine derives the number, from a fact the table
 *   declared rather than one it invented. What each swing may *be* is still
 *   the block's business: nothing here names an attack, and a creature whose
 *   block prints one line has one thing to bite with.
 * - One, otherwise, which is what an Attack action has always held.
 *
 * **Only for a creature whose numbers are printed.** A head count declared on
 * a character is a fact about fiction and not a licence to swing five times:
 * what a character's Attack action holds is on their sheet, put there by the
 * features they have.
 *
 * **And for any such creature, not only the ones a swing warned about.** The
 * `unverified` clause the attack path reports is narrower than this — it needs
 * a line the parser left unread to have something to name — and the two sets
 * are deliberately not one. A declaration is a thing the table said, and a
 * declared count that silently did nothing because the engine had no clause to
 * offer would be worse than a count nobody was prompted for: the prompt is a
 * courtesy, the declaration is the fact. So a block with no sequence takes the
 * count it was given, whether or not anything was reported about it.
 */
export const attacksInAction = (
  sheet: CharacterSheet,
  heads: number | null,
  linesUsed: readonly string[],
): number => {
  const sequence = multiattackOf(sheet);
  if (sequence === null) {
    // SRD Hydra, and every creature whose block states no sequence at all.
    return heads !== null && heads >= 1 && sheet.stated !== undefined
      ? heads
      : (sheet.attacksPerAction ?? 1);
  }
  // **Re-read rather than taken off the sheet**, because a branch the block
  // gates is a branch whose size changes within a turn: `attacksPerAction` was
  // pinned when the creature arrived and is the ungated reading, which is the
  // same number this gives while nothing has been taken. A creature that has
  // taken the line the gate names is offered the branch that gate buys.
  return sequenceTotal(sequence, linesUsed);
};

/**
 * Whether one branch can account for a turn's swings.
 *
 * A name is spent against the entry that admits it, and the branch holds while
 * no entry runs past its count. The search is a single pass because **no name
 * appears in two entries of one sequence anywhere in the SRD** — the
 * Tarrasque's `Bite | {Claw, Tail}` is disjoint — which the bestiary is swept
 * for rather than assumed. A block that broke that would be refused a turn it
 * could have taken, never granted one it could not.
 */
function branchAdmits(
  branch: readonly MonsterMultiattackEntry[],
  made: Readonly<Record<string, number>>,
): boolean {
  const spent = branch.map(() => 0);
  for (const [name, count] of Object.entries(made)) {
    if (count <= 0) continue;
    const wanted = name.trim().toLowerCase();
    const index = branch.findIndex((entry) =>
      namesOf(entry).some((printed) => printed.toLowerCase() === wanted),
    );
    // A name no entry admits is a swing the block does not print.
    if (index < 0) return false;
    spent[index] = spent[index]! + count;
  }
  return spent.every((count, index) => count <= branch[index]!.count);
}

/**
 * Whether a turn's swings, counted by name, are swings the sequence prints.
 *
 * The whole multiset rather than the latest swing, which is what makes this
 * the *composition* and not a per-name tally: a Ghoul that has clawed once has
 * not thereby earned a Bite, because "one Claw and one Bite" is not what its
 * block prints either.
 *
 * **Some branch, where the block prints a choice.** Nothing elects: the Barbed
 * Devil's first Claws closes the Hurl Flame branch by itself, because that
 * branch admits no Claws at all, and the swings already made are the whole of
 * what decides which sequence is being taken.
 *
 * **And some branch the creature is offered.** A gated branch is not one of
 * them until the line the gate names has been taken this turn, which is the
 * difference between a Clay Golem's third Slam and a third Slam.
 */
export const multiattackAllows = (
  sequence: MonsterMultiattack,
  made: Readonly<Record<string, number>>,
  linesUsed: readonly string[] = [],
): boolean =>
  offeredBranches(sequence, linesUsed).some((branch) => branchAdmits(branch.entries, made));

/**
 * What a stated sequence prints, in words, for a refusal to quote back.
 *
 * Built out of the block's own names and counts; nothing here is a string this
 * file chose. **A branch says what it requires**, because a caller told only
 * that a third Slam is not what is left of the sequence would not learn that
 * there is a way to have one.
 */
export function describeMultiattack(sequence: MonsterMultiattack): string {
  return branchesOf(sequence)
    .map((branch) => {
      const clauses = branch.entries
        .map((entry) => `${entry.count} × ${namesOf(entry).join(' or ')}`)
        .join(' and ');
      return branch.requires === null
        ? clauses
        : `${clauses} on a turn it used ${branch.requires.usedBonusAction}`;
    })
    .join(', or ');
}

/**
 * The attack a creature reaches for when it is provoked and nobody names one.
 *
 * SRD: "take a Reaction to make **one melee attack** with a weapon or an
 * Unarmed Strike." A monster carries neither, and the two answers the engine
 * used to have were both wrong: refuse the Reaction the book grants, or swing
 * an Unarmed Strike at a Strength modifier the block never printed.
 *
 * So it is the best of what the block *does* print, by three stated rules:
 *
 * - **Melee**, because that is the attack the sentence names. A line that is
 *   only ranged never wins this, however hard it hits.
 * - **Not on a recharge, and not on a per-day limit**, because a line the
 *   creature may not have available is not the one it reaches for by default.
 *   The two notations are different rules on different clocks and the same
 *   sentence covers both: a once-a-day strike spent on a Reaction nobody asked
 *   for is a creature robbed of the line the book printed for it.
 * - **The highest summed printed average**, the book's own arithmetic, so
 *   nothing is rolled and nothing is re-derived from notation. Ties go to the
 *   first line printed, which is a rule rather than an accident of sorting.
 *
 * Null for every character and for a block that prints no melee line, which is
 * where the caller's weapon or an Unarmed Strike takes over as before.
 */
export function bestPrintedMeleeAttack(sheet: CharacterSheet): StatedAttack | null {
  let best: StatedAttack | null = null;
  let most = -1;

  for (const attack of sheet.stated?.attacks ?? []) {
    if (attack.kind === 'ranged') continue;
    if (attack.recharge !== undefined) continue;
    if (attack.perDay !== undefined) continue;
    const average = attack.damage.reduce((sum, part) => sum + part.average, 0);
    // Strictly greater, so the first line printed keeps a tie.
    if (average > most) {
      most = average;
      best = attack;
    }
  }

  return best;
}

/**
 * Find an attack a creature's stat block prints, by the name it prints it
 * under.
 *
 * Case-insensitive, because the name is something a caller types and `Bite`
 * and `bite` are the same attack. Null where the sheet states no such attack —
 * which is every character, and every monster whose line nobody could read.
 */
export function printedAttackOf(sheet: CharacterSheet, name: string): StatedAttack | null {
  const wanted = name.trim().toLowerCase();
  return (
    sheet.stated?.attacks?.find((attack) => attack.name.toLowerCase() === wanted) ?? null
  );
}

/**
 * Find a Bonus Action line a creature's stat block prints, by its heading.
 *
 * Case-insensitive, for the reason {@link printedAttackOf} above it is: the
 * heading is something a caller types. Null where the sheet states no such
 * line, which is every character and every block that prints none.
 */
export function statedBonusActionOf(
  sheet: CharacterSheet,
  name: string,
): StatedBonusAction | null {
  const wanted = name.trim().toLowerCase();
  return sheet.stated?.bonusActions?.find((line) => line.name.toLowerCase() === wanted) ?? null;
}

/**
 * Find an Actions line a creature's stat block prints that the parser read
 * nothing out of, by its heading.
 *
 * Case-insensitive, for the reason {@link printedAttackOf} above it is: the
 * heading is something a caller types. Null where the sheet states no such
 * line — which is every character, every block the parser read whole, and
 * **every line the parser did read**: a heading with an attack under it is an
 * attack, and the command that rolls it is the one that takes it.
 */
export function statedActionOf(sheet: CharacterSheet, name: string): StatedAction | null {
  const wanted = name.trim().toLowerCase();
  return sheet.stated?.unreadActions?.find((line) => line.name.toLowerCase() === wanted) ?? null;
}

/**
 * Where a printed Bonus Action line's use is counted: the combat ledger, under
 * a namespace of its own.
 *
 * **The ledger rather than a second counter beside it.** `featureUsedOnTurn`
 * keys a string against the turn it was spent on, which is exactly the
 * question a gated Multiattack asks — "did it use that line *this turn*" —
 * and it is already how a swing inside a sequence and a once-per-turn weapon
 * property are counted. A record of its own would be a second answer to the
 * same question.
 *
 * The prefix is a constant and the name in the key comes out of the creature's
 * own block, so nothing here names a line. **It is declared where the ledger
 * is** and reserved there against content: a feature id is a key in the same
 * map, so a write-side convention alone would let a homebrew feature called
 * `stated-bonus-action:something` be read back as a line this creature took.
 */
const STATED_BONUS_ACTION = STATED_BONUS_ACTION_LEDGER;

/** The ledger key one printed Bonus Action line is spent under. */
export const statedBonusActionSlot = (line: string): string =>
  `${STATED_BONUS_ACTION}${line}`;

/**
 * The tally key one printed line's **per-day** uses are counted under.
 *
 * **A tally, not a record of its own.** `Tally` in `resources.ts` is already
 * this shape exactly: a keyed count with no ceiling, carrying a `Recovery` tag,
 * declared by nothing because it "springs into existence the first time
 * something is counted", zeroed by `restoreOn` and therefore by the
 * `resources-restored` a morning already emits. The tag is `dawn`, so a Short
 * or Long Rest leaves it standing and `declareDawn` — which writes about any
 * creature holding a dawn tally — clears it with nothing added to that command.
 * A second counter beside this one would be a second answer to one question,
 * and the one the GM's own door could not reach.
 *
 * `Tally`'s own line is why the ceiling is not here: "it cannot run out, which
 * is the whole of why it is not a pool ... whoever reads the count decides what
 * a high one costs." What a high one costs is the number the block prints, read
 * off the sheet by the command that spends the line.
 *
 * The prefix is a constant and the name in the key comes out of the creature's
 * own block, so nothing here names a line — the same construction
 * {@link statedBonusActionSlot} above is. It is **not** reserved against
 * content the way that ledger is, because the map it shares is
 * `resources.ts`'s and a homebrew feature could in principle count under the
 * same string; the prefix is spelled to make that a collision somebody has to
 * go looking for rather than one they could reach by accident.
 */
const PER_DAY_TALLY = 'printed-line-per-day:';

/** The tally key one printed line's per-day uses are counted under. */
export const perDayTallyKey = (line: string): string => `${PER_DAY_TALLY}${line}`;

/**
 * The printed Bonus Action lines a creature has taken on the turn in progress.
 *
 * Read back off the ledger rather than stored a second time, so there is one
 * record of what happened and a replay cannot disagree with it. Takes the
 * ledger and the turn rather than the combat record, so that the fold, the
 * command that spends a line and the command that swings can all ask it
 * without this file knowing what a `CombatState` is.
 */
export const statedBonusActionsUsed = (
  usedOnTurn: Readonly<Record<string, number>>,
  turn: number,
): readonly string[] =>
  Object.entries(usedOnTurn)
    .filter(([key, on]) => on === turn && key.startsWith(STATED_BONUS_ACTION))
    .map(([key]) => key.slice(STATED_BONUS_ACTION.length));

/**
 * What a stat block's line has to wait for before it can be used again, or
 * null where the block prints nothing.
 *
 * **One reader for every section a caller can spend**, because the rule is
 * about a *line* and the heading it was printed under decides what it costs
 * rather than how often it comes back. A block that printed the same heading
 * twice would answer from the attacks first, which is where the swing that
 * asks is standing; nothing in the SRD does.
 *
 * The third arm is where most of the book's recharges actually are: seventy-one
 * on an Actions line the parser read nothing out of, against thirteen under
 * Bonus Actions. Every one of them was parsed and none of them reached this
 * function for as long as no command could spend one, because the rule expends
 * a line and a line nobody can take is never expended.
 *
 * Case-insensitive for the reason {@link printedAttackOf} is: the heading is
 * something a caller types.
 */
export function rechargeOfLine(sheet: CharacterSheet, line: string): MonsterRecharge | null {
  const wanted = line.trim().toLowerCase();
  const attack = sheet.stated?.attacks?.find((one) => one.name.toLowerCase() === wanted);
  if (attack !== undefined) return attack.recharge ?? null;
  const bonus = sheet.stated?.bonusActions?.find((one) => one.name.toLowerCase() === wanted);
  if (bonus !== undefined) return bonus.recharge ?? null;
  return statedActionOf(sheet, line)?.recharge ?? null;
}

/**
 * How many times a day a stat block's line may be used, or null where the
 * block prints no limit.
 *
 * `rechargeOfLine`'s sibling, and deliberately a second function rather than a
 * second field on one answer: the two notations are two rules on two clocks —
 * a d6 at a turn boundary and a rest, against a sunrise — and no heading in
 * the SRD prints both, so nothing ever has to ask for them together.
 *
 * **Three arms, for the reason that one has three**: the rule is about a
 * *line*, and the heading it was printed under decides what it costs rather
 * than how often it comes back. Twelve of the SRD's are printed under Bonus
 * Actions and ten under Actions; none is printed on an attack, and the attack
 * arm is here because `adaptMonster` is the door homebrew comes through too.
 *
 * Case-insensitive for the reason {@link printedAttackOf} is: the heading is
 * something a caller types.
 */
export function perDayOfLine(sheet: CharacterSheet, line: string): number | null {
  const wanted = line.trim().toLowerCase();
  const attack = sheet.stated?.attacks?.find((one) => one.name.toLowerCase() === wanted);
  if (attack !== undefined) return attack.perDay ?? null;
  const bonus = sheet.stated?.bonusActions?.find((one) => one.name.toLowerCase() === wanted);
  if (bonus !== undefined) return bonus.perDay ?? null;
  return statedActionOf(sheet, line)?.perDay ?? null;
}

/**
 * The die a recharge is rolled on, in the book's own notation.
 *
 * SRD *Monsters*: "At the start of each of the monster's turns, roll 1d6." One
 * constant, because the roll and the refusal that quotes it must agree.
 */
export const RECHARGE_DIE = '1d6';

/**
 * Whether a face of that die brings the line back.
 *
 * `low` is the bottom of the printed range and 6 is always the top, so "within
 * the number range given" is a comparison rather than a set. The rest arm
 * answers no to every face: a turn is not a rest, which is exactly the
 * difference the book's second notation draws.
 */
export const rechargeMade = (recharge: MonsterRecharge, face: number): boolean =>
  recharge.kind === 'die' && face >= recharge.low;

/**
 * What the book printed, in words, for a refusal to quote back.
 *
 * Built out of the recharge's own number; nothing here is a string this file
 * chose about a particular creature. **A refusal says what would end it**,
 * because a caller told only that a line is gone cannot tell whether to wait a
 * turn or to call a rest — and for the die form the answer is both.
 */
export const describeRecharge = (recharge: MonsterRecharge): string =>
  recharge.kind === 'die'
    ? `a ${RECHARGE_DIE} at the start of its turn brings it back on a ${recharge.low}${
        recharge.low === 6 ? '' : `–6`
      }, and so does finishing a Short or Long Rest`
    : 'finishing a Short or Long Rest brings it back';

/**
 * The same, in words, for the refusal a per-day limit raises.
 *
 * Built out of the block's own number, exactly as {@link describeRecharge} is,
 * and it names **dawn** because that is the whole of the difference between
 * the two rules: a caller told only that a line is gone would reasonably call
 * a rest, and a rest is precisely what does not bring this one back.
 */
export const describePerDay = (uses: number): string =>
  `the block prints it ${uses}/Day, and dawn brings it back`;

/** Whether this creature's stat block states a trait of the given shape. */
export const hasPrintedTrait = (sheet: CharacterSheet, kind: MonsterTrait['kind']): boolean =>
  sheet.stated?.traits?.some((trait) => trait.kind === kind) === true;

/**
 * SRD Standing Leap: the two distances a block prints for itself, or null.
 *
 * "The frog's Long Jump is up to 10 feet and its High Jump is up to 5 feet
 * **with or without a running start**." Both halves are here because the
 * sentence prints both and they are the whole of the rule: the numbers replace
 * what {@link longJumpDistance} and {@link highJumpHeight} would derive from a
 * Strength score, and the running start stops being asked for. A frog has
 * Strength 1 and would otherwise have a standing Long Jump of nothing at all.
 *
 * Returned as a pair rather than read one at a time, because a caller that
 * took the distance and forgot the running start would be enforcing half a
 * sentence — and the half it dropped is the half the trait is named for.
 */
export const printedLeap = (
  sheet: CharacterSheet,
): { readonly longJumpFeet: number; readonly highJumpFeet: number } | null => {
  for (const trait of sheet.stated?.traits ?? []) {
    if (trait.kind === 'jumps-without-a-running-start') {
      return { longJumpFeet: trait.longJumpFeet, highJumpFeet: trait.highJumpFeet };
    }
  }
  return null;
};

/**
 * The Speeds a block prints beside its walking one, onto the sheet.
 *
 * The parser has read "Speed 20 ft., Fly 40 ft." into five numbers and a flag
 * since the bestiary was first ingested, and this adapter took the first of
 * them and dropped the rest — so a Cockatrice reached the game a walker, and
 * `speedOf` had nothing to answer a flight with. The same failure
 * {@link AdaptedMonster.creatureType} records: an authoritative fact the
 * Engine holds must reach the creature record.
 *
 * **A null and a zero become an absence**, which is `CharacterSheet.speeds`'s
 * own reading: a block printing no Fly Speed and a block printing one of 0
 * both say this creature does not fly. Omitted entirely where the block
 * prints only a walking Speed, so every stat block that has always had one
 * Speed reaches state carrying exactly what it always did.
 */
/** The Speeds a spell may print over a stat block, by mode — see `Summons.speeds`. */
export type PrintedSpeedMode = 'walk' | 'fly' | 'climb' | 'swim' | 'burrow';

/**
 * A sheet with the Speeds a **spell** printed over the block written in.
 *
 * SRD Find Steed's block: "**Speed** 60 ft., Fly 60 ft. (requires level 4+
 * spell)" — a Speed the creature has only when the slot was big enough, which
 * the resolver has already gated. It is written here, beside
 * {@link printedSpeeds}, because pinning a printed number onto the sheet is
 * the adapter's business and the command layer derives no Speed of its own:
 * a walking Speed replaces the block's, and any other mode joins or replaces
 * the one the block prints. The pinned sheet is what `speedOf` then reads.
 */
export function withPrintedSpeeds(
  sheet: CharacterSheet,
  printed: Partial<Record<PrintedSpeedMode, number>>,
): CharacterSheet {
  const { walk, ...modes } = printed;
  const joined: OtherSpeeds = { ...sheet.speeds, ...modes };
  return {
    ...sheet,
    ...(walk === undefined ? {} : { baseSpeed: walk }),
    ...(Object.keys(modes).length === 0 ? {} : { speeds: joined }),
  };
}

function printedSpeeds(speed: Monster['speed']): { readonly speeds?: OtherSpeeds } {
  const some = (feet: number | null): number | undefined =>
    feet === null || feet <= 0 ? undefined : feet;

  const speeds: OtherSpeeds = {
    ...(some(speed.climb) === undefined ? {} : { climb: speed.climb as number }),
    ...(some(speed.fly) === undefined ? {} : { fly: speed.fly as number }),
    ...(some(speed.swim) === undefined ? {} : { swim: speed.swim as number }),
    ...(some(speed.burrow) === undefined ? {} : { burrow: speed.burrow as number }),
    // Hovering is meaningless without a Fly Speed, and the book never prints
    // it without one; carried only beside the Speed it qualifies.
    ...(speed.hover && some(speed.fly) !== undefined ? { hover: true } : {}),
  };

  return Object.keys(speeds).length === 0 ? {} : { speeds };
}

/**
 * The rolls the book's words name, in the engine's own families.
 *
 * Two vocabularies rather than one shared string, because they are two
 * packages' and neither may import the other's: `@ie/srd` types a sentence in
 * the nouns the book prints, and `RollFamily` is the engine's five.
 *
 * **Three of the five, and the other two are a gap rather than a reading.**
 * In the book Initiative *is* a Dexterity check and a death save *is* a saving
 * throw, so the SRD's own "it affects all three of these rolls" reaches both;
 * `roll-modifiers.ts` says as much in as many words. The engine keeps them as
 * families of their own by convention — "Initiative is granted by that name
 * rather than as a Dexterity check" — and every definition in `@ie/content`
 * follows it, naming Initiative where it means Initiative. Fanning one
 * monster's trait out to five selectors would make Sunlight Sensitivity reach
 * an Initiative roll that Enhance Ability's "ability checks" does not, which
 * is one rule written two ways. So the convention is kept and the cost is
 * recorded: a Shadow in sunlight rolls Initiative and a death save without
 * the Disadvantage the book gives it. Changing that is a decision about the
 * `ability-check` family and not about this stat block.
 */
const SUNLIT_ROLL: Readonly<Record<'ability-check' | 'attack-roll' | 'saving-throw', RollFamily>> =
  {
    'ability-check': 'ability-check',
    'attack-roll': 'attack',
    'saving-throw': 'saving-throw',
  };

/**
 * A key for one printed line's grant, built out of the block's own id.
 *
 * Nothing in the engine may name a catalogue entry, so this is derived from
 * the two strings the stat block supplied. It is a label rather than a lookup:
 * only `while-worn` and `while-attuned` read `StandingEffect.feature` as an
 * item's id, and neither is a requirement any of these carries.
 */
const printedTraitKey = (monsterId: string, name: string): string =>
  `${monsterId}:${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;

/**
 * SRD Sunlight Sensitivity and Sunlight Weakness, onto the sheet as the
 * standing effects they are.
 *
 * The rule was built with the sight model and proved on a creature this
 * repository constructed: an `in-sunlight` {@link StandingRequirement} reading
 * `lightAt` at the **holder's** own space. What was missing was the creature
 * carrying it, because the sentence was untyped SRD text — so this is the last
 * step of that build and not a new mechanic.
 *
 * **One effect per roll the sentence names**, because a `roll-mode` grant
 * carries one selector and the two sentences name two lists: the glossary
 * settles the wider one at three rolls, and Initiative and the death save are
 * families of this engine's own rather than members of it. They share a
 * `name`, which is what a roll reports as its source, so a query that reaches
 * two of them still reports one Disadvantage — and Advantage is presence, so
 * counting was never what any of this did.
 *
 * Read from the **Traits** section alone, which is where the book prints both.
 */
function printedSunlight(
  line: MonsterLine,
  key: string,
): readonly StandingEffect[] {
  if (line.trait?.kind !== 'disadvantage-in-sunlight') return [];
  return line.trait.rolls.map(
    (roll): StandingEffect => ({
      feature: key,
      // The block's own heading, so a refusal or a log names the rule the
      // book printed rather than a string this file chose.
      name: line.name,
      reach: { kind: 'self' },
      grant: {
        kind: 'roll-mode',
        modifier: {
          mode: 'disadvantage',
          selector: { roll: SUNLIT_ROLL[roll], relation: 'roller' },
        },
      },
      requires: [{ kind: 'in-sunlight' }],
    }),
  );
}

/**
 * SRD Bloodied Fury and SRD Bloodied Frenzy, the same way up.
 *
 * `printedSunlight`'s mirror image and written as one: Advantage rather than
 * Disadvantage, and `while-bloodied` rather than `in-sunlight`. Both read the
 * holder's own state at the moment the question is asked, so the Advantage
 * arrives with the blow that takes the boar past half and goes with the
 * healing that lifts it back — no event, nothing to sweep.
 */
function printedBloodiedAdvantage(
  line: MonsterLine,
  key: string,
): readonly StandingEffect[] {
  if (line.trait?.kind !== 'advantage-while-bloodied') return [];
  return line.trait.rolls.map(
    (roll): StandingEffect => ({
      feature: key,
      name: line.name,
      reach: { kind: 'self' },
      grant: {
        kind: 'roll-mode',
        modifier: {
          mode: 'advantage',
          selector: { roll: SUNLIT_ROLL[roll], relation: 'roller' },
        },
      },
      requires: [{ kind: 'while-bloodied' }],
    }),
  );
}

/**
 * SRD Nimble Escape, SRD Cunning Action, SRD Deathless Agility and SRD Shadow
 * Stealth: a named action paid for out of a Bonus Action.
 *
 * **The rule a class feature is already written as.** `rogue:cunning-action`
 * compiles to three `{ kind: 'allows', action, from: 'bonus-action' }` standing
 * effects and `takeDash`, `takeDisengage` and `takeHide` each take the cheaper
 * price; nothing about that door knows or cares whether the creature asking is
 * a Rogue or a goblin. So this is the same three clauses, read off a stat
 * block's sentence instead of a class table — one effect per action the line
 * prints, because a grant carries one rule.
 *
 * **Shadow Stealth is the same rule with its own first clause**, which is why
 * it is compiled here rather than somewhere of its own: "While in Dim Light or
 * Darkness, the shadow takes the Hide action" is a Hide out of a Bonus Action
 * gated on the light, and the gate is a {@link StandingRequirement} the engine
 * now has.
 *
 * **Refused where the line prints a limit**, and that is the conservative
 * direction rather than a nicety: an `allows` rule is unlimited and re-derived
 * on every read, so a line printed "(Recharge 5–6)" or "(2/Day)" compiled here
 * would be a rule the book rations handed over free. The SRD prints no such
 * line today; a homebrew block reaching this door would, and would be left as
 * the prose it already is.
 *
 * **And refused outside the Bonus Actions section, which is the one place a
 * heading is load-bearing.** Everywhere else in this adapter the heading says
 * what a line *costs* and the sentence says what it *is* — but the whole
 * content of this rule is a cost, and the sentence the parser matched does not
 * carry one: "The goblin takes the Disengage or Hide action" is a Bonus Action
 * because of where it is printed and for no other reason. All ten SRD lines
 * that match sit under Bonus Actions; the same sentence printed under
 * **Actions** would be a creature taking an action as an action, and compiling
 * it here would hand out a free Bonus Action nobody printed.
 */
function printedBonusActionAllowance(
  line: MonsterLine,
  key: string,
  costsABonusAction: boolean,
): readonly StandingEffect[] {
  if (!costsABonusAction) return [];
  if (line.recharge !== undefined || line.perDay !== undefined) return [];

  const allowed = (
    actions: readonly ('dash' | 'disengage' | 'hide')[],
    requires: readonly StandingRequirement[],
  ): readonly StandingEffect[] =>
    actions.map((action) => ({
      feature: key,
      name: line.name,
      reach: { kind: 'self' },
      grant: {
        kind: 'action-rule',
        rule: { kind: 'allows', action, from: 'bonus-action' },
      },
      ...(requires.length === 0 ? {} : { requires }),
    }));

  if (line.trait?.kind === 'takes-a-named-action-as-a-bonus-action') {
    return allowed(line.trait.actions, []);
  }
  if (line.trait?.kind === 'hides-in-dim-light-or-darkness') {
    return allowed(['hide'], [{ kind: 'in-dim-light-or-darkness' }]);
  }
  return [];
}

/**
 * One printed line of a stat block, whichever heading it was printed under.
 *
 * Structural rather than named, for the reason the parser runs every detector
 * over every section: what a line *says* is not a property of its heading.
 */
type MonsterLine = Monster['traits'][number];

/**
 * Every printed sentence this adapter compiles into a standing effect.
 *
 * **Read from every section, not from Traits alone.** `printedSunlight` was
 * written against the Traits section because both of its sentences are printed
 * there; Shadow Stealth and Nimble Escape are printed under **Bonus Actions**,
 * and a heading says what a line costs rather than what it is. So the walk is
 * over the whole block and the dispatch is on the shape the parser read, which
 * is the same rule `parseTraitShape` is applied by.
 *
 * **The one exception carries the heading with it.** A rule whose entire
 * content is a *price* cannot be read off a sentence that does not print one,
 * so `printedBonusActionAllowance` is told which section its line came from
 * and compiles nothing outside Bonus Actions. Nothing else here is told,
 * because nothing else depends on it.
 */
function printedStanding(monster: Monster): { readonly standing?: readonly StandingEffect[] } {
  const sections: readonly (readonly [readonly MonsterLine[], boolean])[] = [
    [monster.traits, false],
    [monster.actions, false],
    [monster.bonusActions, true],
    [monster.reactions, false],
    [monster.legendaryActions, false],
  ];

  const standing = sections.flatMap(([section, costsABonusAction]) =>
    section.flatMap((line) => {
      const key = printedTraitKey(monster.id, line.name);
      return [
        ...printedSunlight(line, key),
        ...printedBloodiedAdvantage(line, key),
        ...printedBonusActionAllowance(line, key, costsABonusAction),
      ];
    }),
  );

  return standing.length === 0 ? {} : { standing };
}

export function adaptMonster(monster: Monster, id: CharacterId): AdaptedMonster {
  const { defenses, caveats } = buildDefenses(monster);

  const saves: Partial<Record<Ability, number>> = {};
  for (const ability of ABILITIES_IN_ORDER) saves[ability] = monster.abilities[ability].save;

  // Stat blocks name their skills in the same vocabulary the engine uses, but
  // an unrecognised one is dropped rather than crashing a fight.
  const skills: Partial<Record<Skill, number>> = {};
  for (const [name, bonus] of Object.entries(monster.skills)) {
    if (SKILL_SET.has(name)) skills[name as Skill] = bonus;
  }

  const attacks = printedAttacks(monster);
  const traits = printedTraits(monster);
  const multiattack = printedMultiattack(monster, attacks);
  // **What the parser did not read, carried rather than interpreted.** A line
  // with no attack, no trait and no sequence on it is one the parser got
  // nothing out of — the test is mechanical, exactly as the search for the
  // sequence above is, so a block from somewhere other than the SRD parser
  // meets the same one. Nothing branches on these names; they are what a swing
  // quotes when it says which line it could not execute, and what a spend
  // hands back when a caller takes one.
  //
  // The sentence comes with the name for the reason the Bonus Actions below
  // carry theirs: the engine applies no part of one of these and a spend that
  // did not quote it would report a creature having done something nobody
  // could act on. And the recharge comes with both, because most of the book's
  // are printed here — a fact about the economy rather than about the sentence,
  // and the one the turn boundary asks this sheet for.
  const unreadActions: readonly StatedAction[] = monster.actions
    .filter(
      (line) =>
        line.attack === undefined && line.trait === undefined && line.multiattack === undefined,
    )
    .map((line) => ({
      name: line.name,
      text: line.text,
      ...(line.recharge === undefined ? {} : { recharge: line.recharge }),
      // And the per-day limit beside it, which ten of these lines print: a
      // Dretch's Fetid Cloud, a Treant's Animate Trees, a Sphinx's Roar.
      ...(line.perDay === undefined ? {} : { perDay: line.perDay }),
      // And the save, where the sentence is the book's other template. The
      // line is still one no attack could be read out of, which is why it is
      // here and not among the attacks; what the save adds is a second thing
      // a caller may do with it besides quote it.
      ...(line.save === undefined ? {} : { save: line.save }),
    }));

  // **The Bonus Actions section, carried whole and executed not at all.** A
  // heading in a stat block says what the line under it *costs*, which is why
  // the attacks above come from the Actions section and only that one; these
  // cost a Bonus Action, and carrying them is what gives a caller something to
  // spend one on. The sentence comes with the name because the engine applies
  // none of it and a spend has to hand it back.
  const bonusActions: readonly StatedBonusAction[] = monster.bonusActions.map((line) => ({
    name: line.name,
    text: line.text,
    // And what brings it back, where the heading prints one. The engine
    // executes none of these lines and still owes the rule about *how often*:
    // thirteen of them are printed on a recharge, which is a fact about the
    // economy rather than about the sentence.
    ...(line.recharge === undefined ? {} : { recharge: line.recharge }),
    // And twelve of them are printed on a per-day limit, which is more than
    // any other section a caller can spend from.
    ...(line.perDay === undefined ? {} : { perDay: line.perDay }),
    // And the save, where the sentence is the book's other template — three
    // Trample lines write it under this heading, and a heading says what a
    // line costs rather than what it does.
    ...(line.save === undefined ? {} : { save: line.save }),
  }));

  const stated: StatedValues = {
    armorClass: monster.ac,
    proficiencyBonus: monster.proficiencyBonus,
    // Printed Initiative is authoritative and often differs from Dexterity.
    initiative: monster.initiative,
    saves,
    skills,
    // Omitted rather than empty when the block prints none this parser could
    // read, so a creature that does nothing the engine can roll carries no
    // field saying so — the reading every optional field on the sheet takes.
    ...(attacks.length === 0 ? {} : { attacks }),
    ...(traits.length === 0 ? {} : { traits }),
    ...(bonusActions.length === 0 ? {} : { bonusActions }),
    ...(multiattack === undefined ? {} : { multiattack }),
    ...(unreadActions.length === 0 ? {} : { unreadActions }),
  };

  // **The count follows the composition.** A block that states a sequence
  // states how many swings its Attack action holds, and the two must be one
  // number rather than two that could disagree; a block that states none is
  // left where it was, at the one attack the action has always held.
  const attacksPerAction = multiattack === undefined ? 1 : sequenceTotal(multiattack);

  const sheet: CharacterSheet = {
    // A monster has no level. Every derivation that would have used one is
    // stated instead, so this is inert — but it has to be something, and 1 is
    // the least misleading.
    level: 1,
    abilities: {
      str: monster.abilities.str.score,
      dex: monster.abilities.dex.score,
      con: monster.abilities.con.score,
      int: monster.abilities.int.score,
      wis: monster.abilities.wis.score,
      cha: monster.abilities.cha.score,
    },
    skills: {},
    saveProficiencies: [],
    // A stat block's AC already accounts for whatever it is wearing.
    armor: null,
    shield: null,
    // SRD: "A monster has training with any armor in its stat block."
    armorTraining: { light: true, medium: true, heavy: true, shields: true },
    baseSpeed: monster.speed.walk,
    ...printedSpeeds(monster.speed),
    // The printed sentences an engine rule already spends — see
    // {@link printedStanding}. Omitted for every block that prints none, so a
    // sheet gains no field it was not given.
    ...printedStanding(monster),
    spellcastingAbility: null,
    // Omitted at one, which is the sheet's own reading of the field: "one,
    // unless a feature says otherwise", and an explicit 1 on every stat block
    // would be a number where there was an absence.
    ...(attacksPerAction > 1 ? { attacksPerAction } : {}),
    stated,
  };

  return {
    id,
    name: monster.name,
    sheet,
    // SRD: "A monster dies the instant it drops to 0 Hit Points."
    vitals: vitals(monster.hp.average, { diesAtZero: true }),
    defenses,
    creatureType: monster.type,
    subtype: monster.subtype,
    size: monster.size,
    speed: monster.speed,
    initiativeModifier: monster.initiative,
    cr: monster.cr,
    xp: monster.xp,
    caveats,
  };
}

/**
 * Whether a condition can be applied, given the stat block's immunities.
 *
 * A qualified immunity returns `needs-adjudication` rather than resolving
 * either way, because the qualification is a rule the engine cannot evaluate.
 * Silently treating it as unconditional makes a vampire unable to charm its
 * own spawn; silently ignoring it makes the immunity meaningless.
 */
export function conditionApplicability(
  adapted: AdaptedMonster,
  condition: ConditionName,
): ConditionApplicability {
  if (adapted.defenses.conditionImmunities.includes(condition)) {
    return { kind: 'immune', reason: `${adapted.name} is immune to the ${condition} condition` };
  }

  const qualified = adapted.defenses.qualified.find(
    (q) => q.kind === 'immunity' && q.condition === condition,
  );
  if (qualified !== undefined) {
    return {
      kind: 'needs-adjudication',
      qualification: qualified.qualification,
      printed: qualified.printed,
    };
  }

  return { kind: 'allowed' };
}

/**
 * The blunt form, for callers that only need yes or no.
 *
 * A qualified immunity counts as *allowed* here, because the default when
 * nobody has adjudicated is that the condition lands — the qualification is a
 * narrower exception, not a broader one.
 */
export function monsterCanReceive(
  adapted: AdaptedMonster,
  condition: ConditionName,
): boolean {
  return conditionApplicability(adapted, condition).kind !== 'immune';
}

// — what a hit buys, where the line says it in the book's own template ————————

/**
 * The clause an attack line prints after its damage, read into a structure.
 *
 * A 2024 attack line is a template up to the damage and **English after it**.
 * `MonsterAttack.rider` carries that English verbatim and the swing reports
 * it, which is honest and leaves every creature that prints one weaker than
 * the book.
 *
 * **What is read here is what the engine already holds every part of**,
 * expressed in the vocabulary {@link HitOption} is written in: a condition, a
 * size or a creature type the SRD gates it on, a DC the block prints, a
 * grapple with the escape DC beside it, and a deadline on either creature's
 * next turn. What is deliberately *not* read is every sentence that needs
 * something `HitOption` cannot carry — see {@link readPrintedRider}'s
 * refusals — because a rider read half-way is a rule nobody printed, which is
 * the exact failure the verbatim string was carried to avoid.
 *
 * `lasts` is a `TurnAnchor` and says *which moment*; `lastsOn` says **whose
 * turn**, because the book writes both and they are a round apart. A deadline
 * read off "its next turn" and filed on the attacker is a wrong rule rather
 * than a refusal, which is what naming the anchor makes impossible.
 */
export type PrintedRider = PrintedConditionRider | PrintedGrappleRider;

/** A condition the hit imposes, with or without a saving throw against it. */
export interface PrintedConditionRider {
  readonly kind: 'condition';
  /** In printed order — SRD's "the Blinded and Deafened conditions". */
  readonly conditions: readonly ConditionName[];
  /** SRD's "If the target is a Medium or smaller creature". */
  readonly ifNoLargerThan?: CreatureSize;
  /**
   * The creature type the sentence excepts — SRD Ghast's "a non-Undead
   * creature", SRD Ghoul's "a creature that isn't an Undead".
   *
   * A fact the engine holds (`CreatureState.creatureType`) and therefore one
   * the swing evaluates, exactly as it evaluates {@link ifNoLargerThan}.
   */
  readonly unlessType?: string;
  /**
   * What the same sentence *also* excepts, as a **species** — SRD Ghoul's "or
   * **elf**".
   *
   * Beside {@link unlessType} rather than folded into it because they are two
   * records: a creature type is printed on a stat block and reaches
   * `CreatureState.creatureType`, and a species is a creation choice that
   * reaches `CharacterRecord.speciesId`. The swing reads whichever the
   * creature has; a creature with neither is reported rather than assumed.
   */
  readonly alsoExcepts?: string;
  /** SRD Ghoul's "_Constitution Saving Throw:_ DC 10", where the line prints one. */
  readonly save?: PrintedRiderSave;
  /** SRD's "until the start of the ettercap's next turn". */
  readonly lasts?: TurnAnchor;
  /**
   * Whose next turn {@link lasts} names — always stated where `lasts` is.
   *
   * The book writes both: "the ettercap's next turn" is the attacker's and
   * "its next turn" is the creature that was hit, and they are a round apart.
   */
  readonly lastsOn?: HitRiderAnchor;
}

/** SRD's "_Constitution Saving Throw:_ DC 10", as the two things it states. */
export interface PrintedRiderSave {
  readonly ability: Ability;
  readonly dc: number;
}

/**
 * A grapple the hit makes — SRD Ankheg: "it has the Grappled condition (escape
 * DC 13)".
 *
 * Its own member rather than a {@link PrintedConditionRider} whose condition
 * happens to be `grappled`, because a grapple is a relation and not a
 * condition: see {@link NOT_A_PLAIN_CONDITION} and `HitOption.grapples`.
 */
export interface PrintedGrappleRider {
  readonly kind: 'grapple';
  /** SRD's "(escape DC 13)". */
  readonly escapeDc: number;
  /** SRD's "If the target is a Large or smaller creature". */
  readonly ifNoLargerThan?: CreatureSize;
  /** SRD Giant Scorpion's "from one of two claws" — reported, never enforced. */
  readonly withLimbs?: string;
}

/** The six size words the book writes the gate with, as the book capitalises them. */
const SIZE_WORDS = '(Tiny|Small|Medium|Large|Huge|Gargantuan)';

/** Both apostrophes, because a transcription may carry either. */
const APOSTROPHE = "['’]";

/**
 * SRD Wolf: "If the target is a Medium or smaller creature, it has the Prone
 * condition."
 */
const GATED_CONDITION = new RegExp(
  `^If the target is a ${SIZE_WORDS} or smaller creature, it has the ([A-Za-z]+)(?: and (?:the )?([A-Za-z]+))? conditions?\\.$`,
);

/**
 * The deadline half of a printed clause: "until the end of its next turn",
 * "until the start of the ettercap's next turn".
 *
 * Both possessives, because the book writes both and they are a round apart:
 * `its` names the creature that was struck and a noun names the creature the
 * block belongs to. Which one a match found is {@link anchorOf}'s answer, and
 * it is the difference between two rules rather than two wordings.
 */
const UNTIL_NEXT_TURN = `until the (end|start) of (?:(its)|the (.+?)${APOSTROPHE}s) next turn`;

/**
 * SRD Ettercap: "and the target has the Poisoned condition until the start of
 * the ettercap's next turn." SRD Giant Vulture: "…until the end of its next
 * turn."
 *
 * **The possessive is captured and routed**, not merely matched, because the
 * two spellings anchor the deadline on two different creatures: a span read
 * off "its next turn" and filed on the attacker is a rule nobody printed,
 * which is the failure the verbatim string exists to prevent.
 */
const ANCHORED_CONDITION = new RegExp(
  `^and the target has the ([A-Za-z]+)(?: and ([A-Za-z]+))? conditions? ${UNTIL_NEXT_TURN}\\.$`,
);

/**
 * SRD Ankheg: "If the target is a Large or smaller creature, it has the
 * Grappled condition (escape DC 13)."
 *
 * The limb clause the book often appends — "from one of two claws", "from both
 * of the griffon's front claws" — is matched and captured rather than refused:
 * it says how many creatures the block can hold at once, which is a limit the
 * engine has no record to enforce and therefore reports.
 *
 * **What is not matched is anything after the limbs, and the comma is what
 * says so.** A second *sentence* is refused by the `$` — the Crocodile's
 * Restrained that ends when the grapple does, the Mimic's Disadvantage on the
 * escape — and the Chain Devil and the Roc write the very same Restrained
 * after a **comma** instead: "from one of two chains, **and it has the
 * Restrained condition until the grapple ends**". A capture that ran to the
 * full stop swallowed that whole clause into the limb phrase and dropped the
 * mechanic without even handing the line back, which is the half-read rider
 * this reader exists to refuse. No printed limb phrase contains a comma, so
 * excluding one refuses the compound line and keeps every plain one.
 */
const PRINTED_GRAPPLE = new RegExp(
  `^If the target is a ${SIZE_WORDS} or smaller creature, it has the Grappled condition \\(escape DC (\\d+)\\)(?: from ([^.,]+))?\\.$`,
);

/**
 * SRD Ghoul: "If the target is a creature that isn't an Undead or elf, it is
 * subjected to the following effect. _Constitution Saving Throw:_ DC 10.
 * _Failure:_ The target has the Paralyzed condition until the end of its next
 * turn."
 *
 * One sentence of gate, one of saving throw and one of failure, and the `$`
 * at the end is what keeps the shape honest: the Cockatrice's second rung of
 * failure, the Death Dog's repeat every 24 hours and the Pit Fiend's damage at
 * the start of each turn all print a fourth sentence and are refused whole
 * rather than read down to the part that fits.
 */
const PRINTED_SAVE = new RegExp(
  `^If the target is (.+?), it is subjected to the following effect\\. _([A-Za-z]+) Saving Throw:_ DC (\\d+)\\. _Failure:_ The target has the ([A-Za-z]+)(?: and (?:the )?([A-Za-z]+))? conditions?(?: ${UNTIL_NEXT_TURN})?\\.$`,
);

/** SRD Ghast's "a non-Undead creature". */
const NEGATED_TYPE = /^a non-([A-Za-z]+) creature$/;

/** SRD Ghoul's "a creature that isn't an Undead or elf". */
const EXCEPTING = new RegExp(`^a creature that isn${APOSTROPHE}t an? ([A-Za-z]+)(?: or ([A-Za-z]+))?$`);

/** The exceptions a gate sentence states, or null where it is not one of them. */
function gateOf(phrase: string): Pick<PrintedConditionRider, 'unlessType' | 'alsoExcepts'> | null {
  if (phrase === 'a creature') return {};
  const negated = NEGATED_TYPE.exec(phrase);
  if (negated !== null) return { unlessType: negated[1]! };
  const excepting = EXCEPTING.exec(phrase);
  if (excepting === null) return null;
  return {
    unlessType: excepting[1]!,
    ...(excepting[2] === undefined ? {} : { alsoExcepts: excepting[2] }),
  };
}

/**
 * A **denylist**, and it is worth saying which way round it works: a
 * possessive this does not name is taken for the attacker.
 *
 * That is the honest reading of the corpus rather than a rule out of the book.
 * Every anchored line the SRD prints writes the block's own noun and none of
 * them writes the block's *name*: "the storm giant's", "the giant centipede's"
 * — so an allowlist of creature names would refuse half of them, and one built
 * from a creature's in-play name would refuse anything a DM renamed.
 *
 * **`target` has moved out of it and become an answer.** The list was a
 * denylist because the only anchor a hit rider had was the attacker, so a
 * possessive naming the creature that was struck had nowhere to go but a
 * refusal; `HitOption.lastsOn` is that anchor, and "the target's next turn" is
 * now read as what it says. What is left is the pair of words that name
 * *somebody*, and it is not clear who: `creature` and `victim` could each be a
 * third party in a homebrew sentence, and the cost of the two readings is not
 * symmetric — a word wrongly refused is a line handed to the DM, and a word
 * wrongly accepted is a deadline filed on the wrong creature.
 *
 * Matched on the last word, because the book writes "the Grappled target" as
 * readily as "the target".
 */
const NAMES_NOBODY_IN_THE_HIT: readonly string[] = ['creature', 'victim'];

/** SRD's own noun for the creature that was struck, in the possessive. */
const NAMES_THE_TARGET: readonly string[] = ['target'];

/**
 * Which of the two creatures in the hit a captured possessive names, or null
 * where it names neither.
 *
 * `its` is the SRD's own shorthand for the creature that was struck and is
 * handed in as such; a noun is the block's unless it is one of the two words
 * above, which name somebody this reader cannot identify.
 */
function anchorOf(its: string | undefined, possessive: string | undefined): HitRiderAnchor | null {
  if (its !== undefined) return 'target';
  const last = (possessive ?? '').trim().toLowerCase().split(/\s+/).at(-1) ?? '';
  if (NAMES_THE_TARGET.includes(last)) return 'target';
  return NAMES_NOBODY_IN_THE_HIT.includes(last) ? null : 'attacker';
}

/**
 * The conditions that are **not** read out of a printed rider, whatever the
 * sentence around them.
 *
 * A grapple is not a condition in this engine, it is a relation: `grapplesOn`,
 * `lapsedGrapples` and `escapeGrapple` all find one by the `grapple:<who>`
 * source its condition instance was filed under, and SRD ends it on facts
 * about the grappler. A Grappled filed under a rider's own source would be a
 * grapple nothing could escape from and nothing could lapse — strictly worse
 * than the prose it replaced. So a printed grapple is read as
 * {@link PrintedGrappleRider} and made the way the Attack action's own is,
 * and this stays the guard over the *condition* door: a sentence that reaches
 * here with the word in it is one nothing else claimed.
 *
 * Restrained travels with it, because every printed line that imposes one
 * imposes it "until the grapple ends" — one effect ending with another, which
 * is a lifetime the engine has not got and the reason those lines are still
 * the DM's.
 *
 * Exhaustion is here for a different reason and the same rule: it is a level
 * rather than an instance, so a deadline filed on it would have nothing to
 * lift. No SRD attack line prints either, which is why this is a guard on the
 * door rather than a case anything in the book walks into.
 */
const NOT_A_PLAIN_CONDITION: readonly ConditionName[] = ['grappled', 'restrained', 'exhaustion'];

/** A printed condition word, or null where it is not one the engine imposes here. */
function conditionWord(word: string | undefined): ConditionName | null {
  if (word === undefined) return null;
  const lowered = word.toLowerCase();
  const found = CONDITIONS.find((condition) => condition === lowered) ?? null;
  return found === null || NOT_A_PLAIN_CONDITION.includes(found) ? null : found;
}

/** A printed size word, or null. */
function sizeWord(word: string): CreatureSize | null {
  const lowered = word.toLowerCase();
  return CREATURE_SIZES.find((size) => size === lowered) ?? null;
}

/** The conditions a matched sentence names, or null if any word is not one. */
function conditionsOf(first: string, second: string | undefined): readonly ConditionName[] | null {
  const one = conditionWord(first);
  if (one === null) return null;
  if (second === undefined) return [one];
  const two = conditionWord(second);
  return two === null ? null : [one, two];
}

/** The span half of a match, as the two fields a rider states it in. */
function spanRead(
  moment: string | undefined,
  its: string | undefined,
  possessive: string | undefined,
): Pick<PrintedConditionRider, 'lasts' | 'lastsOn'> | null {
  if (moment === undefined) return {};
  const lastsOn = anchorOf(its, possessive);
  if (lastsOn === null) return null;
  return { lasts: moment === 'start' ? 'start-of-next-turn' : 'end-of-next-turn', lastsOn };
}

/** The ability a printed save names, written as the book writes it out. */
function abilityWord(word: string): Ability | null {
  const found = (Object.keys(ABILITY_NAMES) as readonly Ability[]).find(
    (ability) => ABILITY_NAMES[ability] === word,
  );
  return found ?? null;
}

/**
 * The structure a printed rider states, or **null for everything else**.
 *
 * Null is the guard rather than a gap, and the refusals are worth naming
 * because each is a mechanism rather than a wording:
 *
 * - **A clause gated on a movement nobody has declared** — "moved 20+ feet
 *   straight toward it immediately before the hit" — asks a fact about the
 *   turn so far that the engine does not keep.
 * - **An extra damage die** — a Bloodied swarm's, a Goblin's when the attack
 *   roll had Advantage — belongs to the damage roll rather than to an effect
 *   list: it is doubled by a critical hit and meets the target's defences with
 *   the blow, and a rider is a leaf that rolls nothing.
 * - **A second sentence on a grapple** — the Crocodile's Restrained "until the
 *   grapple ends", the Mimic's Disadvantage on the escape — is one effect
 *   ending with another, which is a lifetime the engine has not got.
 * - **A failure that is not a condition** — the werecreatures' curse, the
 *   Mummy's, the Bearded Devil's infernal wound — has a readable DC and
 *   nothing to impose with it.
 * - **A possessive that names neither creature in the hit** — see
 *   {@link NAMES_NOBODY_IN_THE_HIT}.
 *
 * Every one of those is still carried verbatim and still reported at the hit.
 */
export function readPrintedRider(text: string): PrintedRider | null {
  const grapple = PRINTED_GRAPPLE.exec(text);
  if (grapple !== null) {
    const size = sizeWord(grapple[1]!);
    if (size === null) return null;
    return {
      kind: 'grapple',
      escapeDc: Number(grapple[2]),
      ifNoLargerThan: size,
      ...(grapple[3] === undefined ? {} : { withLimbs: grapple[3] }),
    };
  }

  const gated = GATED_CONDITION.exec(text);
  if (gated !== null) {
    const size = sizeWord(gated[1]!);
    const conditions = conditionsOf(gated[2]!, gated[3]);
    if (size === null || conditions === null) return null;
    return { kind: 'condition', conditions, ifNoLargerThan: size };
  }

  const anchored = ANCHORED_CONDITION.exec(text);
  if (anchored !== null) {
    const conditions = conditionsOf(anchored[1]!, anchored[2]);
    const span = spanRead(anchored[3], anchored[4], anchored[5]);
    if (conditions === null || span === null) return null;
    return { kind: 'condition', conditions, ...span };
  }

  const saved = PRINTED_SAVE.exec(text);
  if (saved !== null) {
    const gate = gateOf(saved[1]!);
    const ability = abilityWord(saved[2]!);
    const conditions = conditionsOf(saved[4]!, saved[5]);
    const span = spanRead(saved[6], saved[7], saved[8]);
    if (gate === null || ability === null || conditions === null || span === null) return null;
    return {
      kind: 'condition',
      conditions,
      ...gate,
      save: { ability, dc: Number(saved[3]) },
      ...span,
    };
  }

  return null;
}
